/**
 * 建賽預覽。只算場數、每隊場數、天數下限，不呼叫 placeMatches。
 * 時段步長＝比賽時間＋場間緩衝，與 placeMatches 在 slotMin 等於這個步長時的格子相同。
 * 天數是場地容量與每隊每日場數的下限，不是休息限制下排得下的證明。
 */

import type { Format, Slot, TeamSource } from './types.js';

export interface PreviewFormatSpec {
  kind?: unknown;
  teamCount?: unknown;
  legs?: unknown;
  thirdPlace?: unknown;
  drawRule?: unknown;
  groupCount?: unknown;
  groupSize?: unknown;
  advancePerGroup?: unknown;
}

export interface PreviewScheduleInput {
  teamCount?: number;
  format?: Format | PreviewFormatSpec;
  fields: number | ReadonlyArray<{ fieldType?: string | null }>;
  matchMinutes: number;
  bufferMinutes: number;
  dayStart: string;
  dayEnd: string;
  maxMatchesPerTeamPerDay?: number;
  playersOnField?: number;
}

export interface PreviewIssue {
  path: string;
  messageKey: string;
  params?: Record<string, string | number | boolean | null>;
}

export interface PreviewSchedule {
  matchCount: number;
  dayCount: number;
  matchesPerTeam: { min: number; max: number };
  errors?: PreviewIssue[];
}

interface Load {
  matchCount: number;
  min: number;
  max: number;
}

const EMPTY: PreviewSchedule = {
  matchCount: 0,
  dayCount: 0,
  matchesPerTeam: { min: 0, max: 0 }
};

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function push(
  errors: PreviewIssue[],
  path: string,
  messageKey: string,
  params?: PreviewIssue['params']
) {
  errors.push(params ? { path, messageKey, params } : { path, messageKey });
}

function minutesOf(hhmm: unknown): number | null {
  if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const h = Number(hhmm.slice(0, 2));
  const m = Number(hhmm.slice(3, 5));
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function nextPow2(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/** 標準種子位。與 formats.seedOrder 相同，只用來判斷季軍賽有沒有兩場準決賽。 */
function seedPositions(size: number): number[] {
  let positions = [1];
  while (positions.length < size) {
    const n = positions.length * 2;
    const next: number[] = [];
    for (const p of positions) next.push(p, n + 1 - p);
    positions = next;
  }
  return positions;
}

function knockoutThirdOk(teamCount: number): boolean {
  const size = nextPow2(teamCount);
  let current: Array<number | null> = seedPositions(size).map(p => (p <= teamCount ? p : null));
  const roundLens: number[] = [];
  while (current.length > 1) {
    let matches = 0;
    const next: Array<number | null> = [];
    for (let i = 0; i < current.length; i += 2) {
      const a = current[i] ?? null;
      const b = current[i + 1] ?? null;
      if (a && b) {
        matches += 1;
        next.push(1);
      } else if (a || b) {
        next.push(a ?? b);
      } else {
        next.push(null);
      }
    }
    if (matches) roundLens.push(matches);
    current = next;
  }
  return roundLens.length >= 2 && roundLens[roundLens.length - 2] === 2;
}

/** 冠軍路徑場數。奇數輪的輪空不拉長最長路徑。 */
function roundsLongest(entrants: number): number {
  let played = 0;
  let left = entrants;
  while (left > 1) {
    played += 1;
    if (left % 2 === 1) left = 1 + (left - 1) / 2;
    else left = left / 2;
  }
  return played;
}

function gkRoundSizes(firstMatches: number): number[] {
  const sizes = [firstMatches];
  let entrants = firstMatches;
  while (entrants > 1) {
    let pool = entrants;
    let next = 0;
    if (pool % 2 === 1) {
      next += 1;
      pool -= 1;
    }
    const matches = pool / 2;
    next += matches;
    sizes.push(matches);
    entrants = next;
  }
  return sizes;
}

function isBuiltFormat(value: unknown): value is Format {
  return isRecord(value) && Array.isArray((value as { stages?: unknown }).stages);
}

function sourceChain(src: TeamSource | undefined, slots: Map<string, Slot>, seen: Set<string>): number {
  if (!src || (src.type !== 'matchWinner' && src.type !== 'matchLoser')) return 0;
  if (seen.has(src.matchKey)) return 0;
  const slot = slots.get(src.matchKey);
  if (!slot) return 0;
  seen.add(src.matchKey);
  return 1 + Math.max(sourceChain(slot.home, slots, seen), sourceChain(slot.away, slots, seen));
}

function koDepth(slots: Slot[]): number {
  const byKey = new Map(slots.map(slot => [slot.matchKey, slot]));
  let max = 0;
  for (const slot of slots) {
    const depth = 1 + Math.max(
      sourceChain(slot.home, byKey, new Set([slot.matchKey])),
      sourceChain(slot.away, byKey, new Set([slot.matchKey]))
    );
    if (depth > max) max = depth;
  }
  return max;
}

function loadFromFormat(format: Format, errors: PreviewIssue[]): Load | null {
  if (!format.stages.length) {
    push(errors, 'format', 'cp.config.format.required');
    return null;
  }
  let matchCount = 0;
  let groupGames = 0;
  let sawGroup = false;
  const koSlots: Slot[] = [];
  for (const stage of format.stages) {
    if (stage.type === 'roundRobin') {
      const groups = stage.groupCount ?? 1;
      const size = stage.groupSize ?? format.teamCount;
      const legs = stage.legs === 2 ? 2 : 1;
      if (!isInt(groups) || groups < 1 || !isInt(size) || size < 2) {
        push(errors, 'format', 'cp.config.format.groupSize.invalid');
        return null;
      }
      matchCount += groups * (size * (size - 1) / 2) * legs;
      groupGames = (size - 1) * legs;
      sawGroup = true;
    } else {
      koSlots.push(...(stage.slots ?? []));
    }
  }
  matchCount += koSlots.length;
  const entrants = new Set<string>();
  for (const slot of koSlots) {
    for (const src of [slot.home, slot.away]) {
      if (src?.type === 'standing') entrants.add(`${src.stageId}|${src.groupId}|${src.rank}`);
    }
  }
  const everyone = sawGroup && format.teamCount > 0 && entrants.size >= format.teamCount;
  const min = sawGroup
    ? groupGames + (koSlots.length > 0 && everyone ? 1 : 0)
    : (koSlots.length > 0 ? 1 : groupGames);
  const max = groupGames + (koSlots.length ? koDepth(koSlots) : 0);
  return { matchCount, min, max: Math.max(max, min) };
}

function loadFromSpec(
  teamCount: number,
  spec: PreviewFormatSpec,
  errors: PreviewIssue[]
): Load | null {
  const kind = spec.kind;
  if (kind !== 'roundRobin' && kind !== 'knockout' && kind !== 'groupKnockout') {
    push(errors, 'format.kind', 'cp.config.format.kind.invalid');
    return null;
  }
  if (spec.thirdPlace != null && typeof spec.thirdPlace !== 'boolean'
    && (kind === 'knockout' || kind === 'groupKnockout')) {
    push(errors, 'format.thirdPlace', 'cp.config.format.thirdPlace.invalid');
    return null;
  }
  const third = spec.thirdPlace === true;

  if (kind === 'roundRobin') {
    if (spec.legs != null && spec.legs !== 1 && spec.legs !== 2) {
      push(errors, 'format.legs', 'cp.config.format.legs.invalid');
      return null;
    }
    const legs = spec.legs === 2 ? 2 : 1;
    const per = (teamCount - 1) * legs;
    return { matchCount: (teamCount * (teamCount - 1) / 2) * legs, min: per, max: per };
  }

  if (kind === 'knockout') {
    if (third && !knockoutThirdOk(teamCount)) {
      push(errors, 'format.thirdPlace', 'cp.config.format.thirdPlace.unavailable', { teamCount });
      return null;
    }
    const max = Math.log2(nextPow2(teamCount));
    return { matchCount: teamCount - 1 + (third ? 1 : 0), min: 1, max };
  }

  const groupCount = spec.groupCount;
  const groupSize = spec.groupSize;
  const advance = spec.advancePerGroup;
  if (!isInt(groupCount) || groupCount < 2 || (groupCount & (groupCount - 1)) !== 0) {
    push(errors, 'format.groupCount', 'cp.config.format.groupCount.invalid');
    return null;
  }
  if (!isInt(groupSize) || groupSize < 2) {
    push(errors, 'format.groupSize', 'cp.config.format.groupSize.invalid');
    return null;
  }
  if (!isInt(advance) || advance < 1 || advance > groupSize) {
    push(errors, 'format.advancePerGroup', 'cp.config.format.advance.invalid');
    return null;
  }
  const total = groupCount * groupSize;
  if (total !== teamCount) {
    push(errors, 'format.teamCount', 'cp.config.teamCount.mismatch', { expected: total, actual: teamCount });
    return null;
  }
  if (total > 64) {
    push(errors, 'format.teamCount', 'cp.config.teamCount.tooMany', { max: 64, actual: total });
    return null;
  }
  const advancing = groupCount * advance;
  const first = (groupCount / 2) * advance;
  const sizes = gkRoundSizes(first);
  if (third && (sizes.length < 2 || sizes[sizes.length - 2] !== 2)) {
    push(errors, 'format.thirdPlace', 'cp.config.format.thirdPlace.unavailable', { teamCount: total });
    return null;
  }
  const groupGames = groupSize - 1;
  const koMax = roundsLongest(advancing);
  return {
    matchCount: groupCount * (groupSize * (groupSize - 1) / 2) + (advancing - 1) + (third ? 1 : 0),
    min: groupGames + (advance === groupSize ? 1 : 0),
    max: groupGames + koMax
  };
}

function failed(errors: PreviewIssue[]): PreviewSchedule {
  return { ...EMPTY, matchesPerTeam: { min: 0, max: 0 }, errors };
}

export function previewSchedule(input: PreviewScheduleInput): PreviewSchedule {
  const errors: PreviewIssue[] = [];
  const format = input?.format;
  const built = isBuiltFormat(format);
  let teamCount: number | null = null;

  if (built) {
    if (!isInt(format.teamCount) || format.teamCount < 2) {
      push(errors, 'format.teamCount', 'cp.config.teamCount.tooFew', { min: 2, actual: format.teamCount ?? null });
    } else if (format.teamCount > 64) {
      push(errors, 'format.teamCount', 'cp.config.teamCount.tooMany', { max: 64, actual: format.teamCount });
    } else {
      teamCount = format.teamCount;
    }
    if (input.teamCount != null && teamCount != null && input.teamCount !== teamCount) {
      push(errors, 'teamCount', 'cp.config.teamCount.mismatch', { expected: teamCount, actual: input.teamCount });
    }
  } else if (input?.teamCount == null && !isRecord(format)) {
    push(errors, 'teamCount', 'cp.config.teamCount.required');
  } else if (input?.teamCount != null && !isInt(input.teamCount)) {
    push(errors, 'teamCount', 'cp.config.teamCount.notInteger');
  } else if (input?.teamCount != null && input.teamCount < 2) {
    push(errors, 'teamCount', 'cp.config.teamCount.tooFew', { min: 2, actual: input.teamCount });
  } else if (input?.teamCount != null && input.teamCount > 64) {
    push(errors, 'teamCount', 'cp.config.teamCount.tooMany', { max: 64, actual: input.teamCount });
  } else if (isInt(input?.teamCount)) {
    teamCount = input.teamCount;
  } else if (isRecord(format) && isInt(format.teamCount)) {
    teamCount = format.teamCount;
  } else {
    push(errors, 'teamCount', 'cp.config.teamCount.required');
  }

  let load: Load | null = null;
  if (teamCount != null) {
    if (built) load = loadFromFormat(format, errors);
    else if (!isRecord(format)) push(errors, 'format', 'cp.config.format.required');
    else load = loadFromSpec(teamCount, format, errors);
  }

  let fieldCount = 0;
  if (typeof input?.fields === 'number') {
    if (!isInt(input.fields) || input.fields < 1) push(errors, 'fields', 'cp.config.fields.required');
    else fieldCount = input.fields;
  } else if (!Array.isArray(input?.fields) || input.fields.length === 0) {
    push(errors, 'fields', 'cp.config.fields.required');
  } else {
    const nine = input.playersOnField === 9;
    fieldCount = input.fields.filter(field => !nine || field?.fieldType !== '5v5').length;
    if (nine && fieldCount === 0) {
      push(errors, 'fields', 'cp.config.fields.tooSmall', { playersOnField: 9 });
    } else if (fieldCount === 0) {
      push(errors, 'fields', 'cp.config.fields.required');
    }
  }

  const start = minutesOf(input?.dayStart);
  const end = minutesOf(input?.dayEnd);
  if (start == null) push(errors, 'time.dayStart', 'cp.config.time.invalid');
  if (end == null) push(errors, 'time.dayEnd', 'cp.config.time.invalid');
  if (start != null && end != null && end <= start) {
    push(errors, 'time.dayEnd', 'cp.config.time.dayEnd.beforeStart', { dayStart: start, dayEnd: end });
  }
  if (!isInt(input?.matchMinutes) || input.matchMinutes < 1) {
    push(errors, 'time.matchMinutes', 'cp.config.time.matchMinutes.invalid');
  }
  if (!isInt(input?.bufferMinutes) || input.bufferMinutes < 0) {
    push(errors, 'time.bufferMinutes', 'cp.config.time.bufferMinutes.invalid');
  }
  if (input?.playersOnField != null && (!isInt(input.playersOnField) || input.playersOnField < 1)) {
    push(errors, 'playersOnField', 'cp.config.division.playersOnField.invalid');
  }
  if (input?.maxMatchesPerTeamPerDay != null
    && (!isInt(input.maxMatchesPerTeamPerDay) || input.maxMatchesPerTeamPerDay < 1)) {
    push(errors, 'maxMatchesPerTeamPerDay', 'cp.config.time.invalid', { field: 'maxMatchesPerTeamPerDay' });
  }

  const window = start != null && end != null ? end - start : 0;
  const step = isInt(input?.matchMinutes) && isInt(input?.bufferMinutes)
    ? input.matchMinutes + input.bufferMinutes
    : 0;
  const perField = window > 0 && isInt(input?.matchMinutes) && input.matchMinutes <= window && step > 0
    ? Math.floor((window - input.matchMinutes) / step) + 1
    : 0;
  if (start != null && end != null && end > start && isInt(input?.matchMinutes) && input.matchMinutes > window) {
    push(errors, 'time.matchMinutes', 'cp.config.time.window.tooShort', {
      windowMin: window,
      matchMinutes: input.matchMinutes
    });
  }

  if (errors.length || !load) return failed(errors);

  const teamCap = input.maxMatchesPerTeamPerDay ?? perField;
  if (perField < 1 || fieldCount < 1 || teamCap < 1) {
    push(errors, 'time.matchMinutes', 'cp.config.time.window.tooShort', {
      windowMin: window,
      matchMinutes: input.matchMinutes
    });
    return failed(errors);
  }

  const daily = perField * fieldCount;
  const byFields = load.matchCount === 0 ? 0 : Math.ceil(load.matchCount / daily);
  const byTeam = load.max === 0 ? 0 : Math.ceil(load.max / teamCap);
  return {
    matchCount: load.matchCount,
    dayCount: Math.max(byFields, byTeam),
    matchesPerTeam: { min: load.min, max: load.max }
  };
}
