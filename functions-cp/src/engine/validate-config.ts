/**
 * 賽事設定檢查。回傳 messageKey，不組中文句子。
 */

import { buildGroupKnockoutFormat, buildKnockoutFormat, buildRoundRobinFormat } from './formats.js';
import type { Criterion } from './types.js';

export interface ConfigIssue {
  path: string;
  messageKey: string;
  params?: Record<string, string | number | boolean | null>;
}

export interface ConfigValidation {
  ok: boolean;
  errors: ConfigIssue[];
}

export interface DivisionConfig {
  divisionId?: unknown;
  teamCount?: unknown;
  playersOnField?: unknown;
  matchDurationMin?: unknown;
  periods?: unknown;
  format?: unknown;
}

export interface FormatConfig {
  kind?: unknown;
  teamCount?: unknown;
  legs?: unknown;
  thirdPlace?: unknown;
  drawRule?: unknown;
  groupCount?: unknown;
  groupSize?: unknown;
  advancePerGroup?: unknown;
}

export interface CompetitionConfig {
  divisions?: unknown;
  format?: unknown;
  fields?: unknown;
  time?: unknown;
  points?: unknown;
  criteria?: unknown;
  fairPlay?: unknown;
}

const CRITERIA: readonly Criterion[] = [
  'points', 'headToHeadPoints', 'headToHeadGoalDiff', 'headToHeadGoalsFor', 'headToHeadWins',
  'goalDiff', 'goalsFor', 'goalsAgainstAsc', 'wins', 'fairPlay', 'seed', 'drawLots', 'manual'
];

const DRAW_RULES = ['none', 'penalty', 'goldenGoal'] as const;

export const CONFIG_MESSAGE_KEYS = [
  'cp.config.divisions.required',
  'cp.config.division.id.required',
  'cp.config.division.id.duplicate',
  'cp.config.division.playersOnField.invalid',
  'cp.config.division.matchDurationMin.invalid',
  'cp.config.division.periods.invalid',
  'cp.config.teamCount.required',
  'cp.config.teamCount.notInteger',
  'cp.config.teamCount.tooFew',
  'cp.config.teamCount.tooMany',
  'cp.config.teamCount.mismatch',
  'cp.config.format.required',
  'cp.config.format.kind.invalid',
  'cp.config.format.legs.invalid',
  'cp.config.format.drawRule.invalid',
  'cp.config.format.thirdPlace.invalid',
  'cp.config.format.thirdPlace.unavailable',
  'cp.config.format.groupCount.invalid',
  'cp.config.format.groupSize.invalid',
  'cp.config.format.advance.invalid',
  'cp.config.fields.required',
  'cp.config.fields.venueId.required',
  'cp.config.fields.venueId.duplicate',
  'cp.config.fields.tooSmall',
  'cp.config.time.required',
  'cp.config.time.invalid',
  'cp.config.time.dayEnd.beforeStart',
  'cp.config.time.matchMinutes.invalid',
  'cp.config.time.bufferMinutes.invalid',
  'cp.config.time.window.tooShort',
  'cp.config.time.date.invalid',
  'cp.config.points.required',
  'cp.config.points.invalid',
  'cp.config.criteria.required',
  'cp.config.criteria.unknown',
  'cp.config.criteria.duplicate',
  'cp.config.fairPlay.required',
  'cp.config.fairPlay.invalid'
] as const;

const TEAM_MIN = 2;
const TEAM_MAX = 64;

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function push(
  errors: ConfigIssue[],
  path: string,
  messageKey: (typeof CONFIG_MESSAGE_KEYS)[number],
  params?: ConfigIssue['params']
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

function teamCountError(errors: ConfigIssue[], path: string, value: unknown): number | null {
  if (value == null) {
    push(errors, path, 'cp.config.teamCount.required');
    return null;
  }
  if (!isInt(value)) {
    push(errors, path, 'cp.config.teamCount.notInteger');
    return null;
  }
  if (value < TEAM_MIN) {
    push(errors, path, 'cp.config.teamCount.tooFew', { min: TEAM_MIN, actual: value });
    return null;
  }
  if (value > TEAM_MAX) {
    push(errors, path, 'cp.config.teamCount.tooMany', { max: TEAM_MAX, actual: value });
    return null;
  }
  return value;
}

function validateFormat(errors: ConfigIssue[], path: string, value: unknown): number | null {
  if (!isRecord(value)) {
    push(errors, path, 'cp.config.format.required');
    return null;
  }
  const kind = value.kind;
  if (kind !== 'roundRobin' && kind !== 'knockout' && kind !== 'groupKnockout') {
    push(errors, path + '.kind', 'cp.config.format.kind.invalid');
    return null;
  }
  if (value.drawRule != null && !(DRAW_RULES as readonly unknown[]).includes(value.drawRule)) {
    push(errors, path + '.drawRule', 'cp.config.format.drawRule.invalid');
  }
  if ((kind === 'knockout' || kind === 'groupKnockout') && value.thirdPlace != null && typeof value.thirdPlace !== 'boolean') {
    push(errors, path + '.thirdPlace', 'cp.config.format.thirdPlace.invalid');
  }

  if (kind === 'roundRobin') {
    if (value.legs != null && value.legs !== 1 && value.legs !== 2) {
      push(errors, path + '.legs', 'cp.config.format.legs.invalid');
    }
    const teamCount = teamCountError(errors, path + '.teamCount', value.teamCount);
    if (teamCount == null || (value.legs != null && value.legs !== 1 && value.legs !== 2)) return null;
    buildRoundRobinFormat({ teamCount, legs: value.legs === 2 ? 2 : 1 });
    return teamCount;
  }

  if (kind === 'knockout') {
    const teamCount = teamCountError(errors, path + '.teamCount', value.teamCount);
    if (teamCount == null) return null;
    const thirdPlace = value.thirdPlace === true;
    const drawRule = typeof value.drawRule === 'string' ? value.drawRule : 'penalty';
    if ((DRAW_RULES as readonly string[]).includes(drawRule)) {
      try {
        buildKnockoutFormat({ teamCount, thirdPlace, drawRule });
      } catch {
        push(errors, path + '.thirdPlace', 'cp.config.format.thirdPlace.unavailable', { teamCount });
      }
    }
    return teamCount;
  }

  const groupCount = value.groupCount;
  const groupSize = value.groupSize;
  const advance = value.advancePerGroup;
  if (!isInt(groupCount) || groupCount < 2 || (groupCount & (groupCount - 1)) !== 0) {
    push(errors, path + '.groupCount', 'cp.config.format.groupCount.invalid');
  }
  if (!isInt(groupSize) || groupSize < 2) {
    push(errors, path + '.groupSize', 'cp.config.format.groupSize.invalid');
  }
  if (!isInt(advance) || !isInt(groupSize) || advance < 1 || advance > groupSize) {
    push(errors, path + '.advancePerGroup', 'cp.config.format.advance.invalid');
  }
  if (!isInt(groupCount) || !isInt(groupSize) || groupCount < 2 || groupSize < 2) return null;
  const total = groupCount * groupSize;
  const limited = teamCountError(errors, path + '.teamCount', total);
  if (limited == null) return null;
  if (value.teamCount != null && value.teamCount !== total) {
    push(errors, path + '.teamCount', 'cp.config.teamCount.mismatch', {
      expected: total,
      actual: typeof value.teamCount === 'number' ? value.teamCount : null
    });
  }
  const thirdPlace = value.thirdPlace === true;
  const drawRule = typeof value.drawRule === 'string' ? value.drawRule : 'penalty';
  if (isInt(advance) && advance >= 1 && advance <= groupSize && (DRAW_RULES as readonly string[]).includes(drawRule)
    && (groupCount & (groupCount - 1)) === 0) {
    try {
      buildGroupKnockoutFormat({
        groupCount, groupSize, advancePerGroup: advance, thirdPlace, drawRule
      });
    } catch {
      push(errors, path + '.thirdPlace', 'cp.config.format.thirdPlace.unavailable', { teamCount: total });
    }
  }
  return total;
}

export function validateCompetitionConfig(config: CompetitionConfig | null | undefined): ConfigValidation {
  const errors: ConfigIssue[] = [];
  const root = isRecord(config) ? config : {};

  if (!Array.isArray(root.divisions) || root.divisions.length === 0) {
    push(errors, 'divisions', 'cp.config.divisions.required');
  } else {
    const seen = new Set<string>();
    let rootExpected: number | null | undefined;
    root.divisions.forEach((item, index) => {
      const path = `divisions[${index}]`;
      if (!isRecord(item)) {
        push(errors, path, 'cp.config.division.id.required');
        return;
      }
      if (typeof item.divisionId !== 'string' || item.divisionId.trim() === '') {
        push(errors, path + '.divisionId', 'cp.config.division.id.required');
      } else if (seen.has(item.divisionId)) {
        push(errors, path + '.divisionId', 'cp.config.division.id.duplicate', { divisionId: item.divisionId });
      } else {
        seen.add(item.divisionId);
      }
      const teamCount = teamCountError(errors, path + '.teamCount', item.teamCount);
      if (item.playersOnField != null && (!isInt(item.playersOnField) || item.playersOnField < 1)) {
        push(errors, path + '.playersOnField', 'cp.config.division.playersOnField.invalid');
      }
      if (item.matchDurationMin != null && (!isInt(item.matchDurationMin) || item.matchDurationMin < 1)) {
        push(errors, path + '.matchDurationMin', 'cp.config.division.matchDurationMin.invalid');
      }
      if (item.periods != null && item.periods !== 1 && item.periods !== 2) {
        push(errors, path + '.periods', 'cp.config.division.periods.invalid');
      }
      let expected: number | null;
      if (item.format !== undefined) {
        expected = validateFormat(errors, path + '.format', item.format);
      } else if (rootExpected === undefined) {
        rootExpected = validateFormat(errors, 'format', root.format);
        expected = rootExpected;
      } else {
        expected = rootExpected;
      }
      if (teamCount != null && expected != null && teamCount !== expected) {
        push(errors, path + '.teamCount', 'cp.config.teamCount.mismatch', { expected, actual: teamCount });
      }
    });
  }

  if (!Array.isArray(root.fields) || root.fields.length === 0) {
    push(errors, 'fields', 'cp.config.fields.required');
  } else {
    const venues = new Set<string>();
    let nineNeedsBigField = false;
    if (Array.isArray(root.divisions)) {
      nineNeedsBigField = root.divisions.some(item => isRecord(item) && item.playersOnField === 9);
    }
    let hasBigField = false;
    root.fields.forEach((field, index) => {
      const path = `fields[${index}]`;
      if (!isRecord(field) || typeof field.venueId !== 'string' || field.venueId.trim() === '') {
        push(errors, path + '.venueId', 'cp.config.fields.venueId.required');
        return;
      }
      if (venues.has(field.venueId)) {
        push(errors, path + '.venueId', 'cp.config.fields.venueId.duplicate', { venueId: field.venueId });
      }
      venues.add(field.venueId);
      if (field.fieldType !== '5v5') hasBigField = true;
    });
    if (nineNeedsBigField && !hasBigField) {
      push(errors, 'fields', 'cp.config.fields.tooSmall', { playersOnField: 9 });
    }
  }

  if (!isRecord(root.time)) {
    push(errors, 'time', 'cp.config.time.required');
  } else {
    const start = minutesOf(root.time.dayStart);
    const end = minutesOf(root.time.dayEnd);
    if (start == null) push(errors, 'time.dayStart', 'cp.config.time.invalid');
    if (end == null) push(errors, 'time.dayEnd', 'cp.config.time.invalid');
    if (start != null && end != null && end <= start) {
      push(errors, 'time.dayEnd', 'cp.config.time.dayEnd.beforeStart', { dayStart: start, dayEnd: end });
    }
    if (!isInt(root.time.matchMinutes) || root.time.matchMinutes < 1) {
      push(errors, 'time.matchMinutes', 'cp.config.time.matchMinutes.invalid');
    }
    if (!isInt(root.time.bufferMinutes) || root.time.bufferMinutes < 0) {
      push(errors, 'time.bufferMinutes', 'cp.config.time.bufferMinutes.invalid');
    }
    if (start != null && end != null && end > start && isInt(root.time.matchMinutes) && root.time.matchMinutes > end - start) {
      push(errors, 'time.matchMinutes', 'cp.config.time.window.tooShort', {
        windowMin: end - start,
        matchMinutes: root.time.matchMinutes
      });
    }
    if (root.time.dates != null) {
      if (!Array.isArray(root.time.dates)) {
        push(errors, 'time.dates', 'cp.config.time.date.invalid');
      } else {
        root.time.dates.forEach((date, index) => {
          if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            push(errors, `time.dates[${index}]`, 'cp.config.time.date.invalid');
          }
        });
      }
    }
  }

  if (!isRecord(root.points)) {
    push(errors, 'points', 'cp.config.points.required');
  } else {
    for (const key of ['win', 'draw', 'loss'] as const) {
      const value = root.points[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        push(errors, 'points.' + key, 'cp.config.points.invalid', { field: key });
      }
    }
  }

  let needsFairPlay = false;
  if (!Array.isArray(root.criteria) || root.criteria.length === 0) {
    push(errors, 'criteria', 'cp.config.criteria.required');
  } else {
    const seen = new Set<string>();
    root.criteria.forEach((item, index) => {
      if (typeof item !== 'string' || !(CRITERIA as readonly string[]).includes(item)) {
        push(errors, `criteria[${index}]`, 'cp.config.criteria.unknown');
        return;
      }
      if (seen.has(item)) push(errors, `criteria[${index}]`, 'cp.config.criteria.duplicate', { criterion: item });
      seen.add(item);
      if (item === 'fairPlay') needsFairPlay = true;
    });
  }

  if (needsFairPlay && !isRecord(root.fairPlay)) {
    push(errors, 'fairPlay', 'cp.config.fairPlay.required');
  } else if (root.fairPlay != null) {
    if (!isRecord(root.fairPlay)) {
      push(errors, 'fairPlay', 'cp.config.fairPlay.invalid');
    } else {
      for (const key of ['yellow', 'secondYellow', 'directRed', 'yellowThenRed'] as const) {
        const value = root.fairPlay[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          push(errors, 'fairPlay.' + key, 'cp.config.fairPlay.invalid', { field: key });
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
