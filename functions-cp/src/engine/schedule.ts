/**
 * 賽程產生與排定。
 * 純函式：不碰 Firestore、不呼叫 Date.now()、不用 Math.random。
 * 抽籤的亂數由呼叫端給 seed，同一個 seed 一定得到同一個結果。
 *
 * 循環場次：legs === 2 才排雙循環（多賽事產生器需要）。
 * 其他 legs 仍只排一輪，與原本一律呼叫 berger 的結果相同。
 * roundRobin 本身把任何非 1 的 legs 都當成「再主客對調一輪」，這裡不把 legs 3 做成三循環。
 */

import { groupLabel, roundRobin, snakeSeed } from './berger.js';
import { STAGE_CODE } from './formats.js';
import { groupNameOf } from './group-name.js';
import type { Format, TeamSource } from './types.js';

export interface Finding {
  level: 'error' | 'warn' | 'ok';
  code: string;
  message: string;
  source: string;
  matchIds?: string[];
}

/** 還沒開打、可以任意搬動的狀態 */
const MOVABLE_STATUSES = ['scheduled', 'checkin', 'ready'];

/**
 * 排程設定的預設值。開賽時間、場間緩衝、休息下限、可用場地是營運決定，
 * 相關檢查一律是 warn 不是 error。
 */
export const SCHEDULE_DEFAULTS = {
  startTime: '08:30',
  endTime: '18:00',
  bufferMin: 10,
  minRestMin: 20,
  maxGapMin: 240,
  venuesByDate: {} as Record<string, unknown>
};

/**
 * `2026-10-09` + `08:30` → 毫秒。
 * 預設 `+08:00`（Asia/Taipei）。呼叫端可傳 `utcOffset`，不靠執行環境的時區。
 */
export function taipeiMs(dateYmd: unknown, hhmm: unknown = '00:00', utcOffset: unknown = '+08:00'): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateYmd ?? ''))) return null;
  if (!/^\d{2}:\d{2}$/.test(String(hhmm ?? ''))) return null;
  if (typeof utcOffset !== 'string' || !/^[+-]\d{2}:\d{2}$/.test(utcOffset)) return null;
  const ms = Date.parse(`${dateYmd}T${hhmm}:00${utcOffset}`);
  return Number.isFinite(ms) ? ms : null;
}

/** mulberry32：小、快、決定性。只用於抽籤，不用於任何安全性用途。 */
function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 抽籤：把清單洗成一個順序。
 * seed 必須是整數，由呼叫端產生並記錄下來。
 */
export function drawOrder<T>(items: readonly T[], seed: number): T[] {
  if (!Array.isArray(items)) throw new TypeError('drawOrder：items 必須是陣列');
  if (!Number.isInteger(seed)) {
    throw new TypeError('drawOrder：seed 必須是整數，由呼叫端提供並記錄（R-ENG-004）');
  }
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const left = out[i] as T;
    const right = out[j] as T;
    out[i] = right;
    out[j] = left;
  }
  return out;
}

export interface SeededTeam {
  teamId: string;
  seed?: number;
  name?: string | null;
  shortName?: string | null;
  abbr?: string | null;
  logoUrl?: string | null;
  colors?: { primary?: string | null } | null;
}

/**
 * 依給定的順序蛇形分組。這一支不自己排序，傳進來的順序就是權威。
 */
export function buildGroups<T extends { teamId: string }>(
  orderedTeams: readonly T[],
  groupCount: number
): Array<Array<T & { seed: number }>> {
  if (!Array.isArray(orderedTeams)) throw new TypeError('buildGroups：orderedTeams 必須是陣列');
  if (!Number.isInteger(groupCount) || groupCount < 1) {
    throw new RangeError('buildGroups：groupCount 必須是 >= 1 的整數');
  }
  // 明確標上 seed 再交給 snakeSeed，不倚賴 Array.prototype.sort 的穩定性
  const withSeed = orderedTeams.map((t, i) => ({ ...t, seed: i + 1 }));
  return snakeSeed(withSeed, groupCount);
}

/**
 * 找一個現成的範本。找不到回 null，不猜一個隊數不合的範本。
 */
export function pickFormatFor(
  teamCount: number,
  formats: Record<string, { teamCount?: number } | null | undefined> = {}
): { teamCount?: number } | null {
  const hit = Object.values(formats).find(f => f?.teamCount === teamCount);
  return hit ?? null;
}

/** 名次賽的名稱：1→冠軍賽、2→季軍賽，之後照名次寫 */
function placementLabel(k: number): string {
  if (k === 1) return '冠軍賽';
  if (k === 2) return '季軍賽';
  return `第${2 * k - 1}、${2 * k}名賽`;
}

/**
 * 通用範本：任何隊數都排得出來。
 * groupCount = 1 單循環；groupCount = 2 兩組循環加同名次對決。
 * 兩組隊數不等時，多出來的那一隊沒有名次賽。
 * 兩組的 groupSize 只存較大組的人數（原行為）。
 */
export function genericFormat(teamCount: number, { groupCount }: { groupCount?: number } = {}): Format {
  if (!Number.isInteger(teamCount) || teamCount < 2) {
    throw new RangeError('genericFormat：teamCount 必須是 >= 2 的整數');
  }
  const gc = groupCount ?? (teamCount <= 5 ? 1 : 2);
  if (gc !== 1 && gc !== 2) {
    throw new RangeError('genericFormat：目前只支援 1 或 2 組（3 組以上的交叉排名沒有定義）');
  }
  if (gc === 2 && teamCount < 4) {
    throw new RangeError('genericFormat：分兩組至少要 4 隊');
  }

  const formatId = `GEN_${teamCount}T_${gc}G`;

  if (gc === 1) {
    const total = (teamCount * (teamCount - 1)) / 2;
    return {
      formatId,
      name: `${teamCount}隊 單循環（系統產生）`,
      teamCount,
      generated: true,
      description: `每隊 ${teamCount - 1} 場，共 ${total} 場。名次由積分榜決定，沒有名次賽。`,
      stages: [{
        stageId: 'group', name: '單循環', type: 'roundRobin', order: 1,
        groupCount: 1, groupSize: teamCount, legs: 1, seedingMethod: 'snake'
      }],
      finalRankingMap: Array.from({ length: teamCount }, (_, i) => ({
        rank: i + 1,
        from: { type: 'standing' as const, stageId: 'group', groupId: 'A', rank: i + 1 }
      }))
    };
  }

  const sizeA = Math.ceil(teamCount / 2);
  const sizeB = teamCount - sizeA;
  const pairs = Math.min(sizeA, sizeB);
  const bigger = sizeA >= sizeB ? 'A' : 'B';
  const biggerSize = Math.max(sizeA, sizeB);

  const slots: Format['stages'][number]['slots'] = [];
  const finalRankingMap: Format['finalRankingMap'] = [];
  for (let k = 1; k <= pairs; k++) {
    const matchKey = `F${2 * k - 1}`;
    slots.push({
      matchKey, label: placementLabel(k), round: 1,
      home: { type: 'standing', stageId: 'group', groupId: 'A', rank: k },
      away: { type: 'standing', stageId: 'group', groupId: 'B', rank: k }
    });
    finalRankingMap.push({ rank: 2 * k - 1, from: { type: 'matchWinner', matchKey } });
    finalRankingMap.push({ rank: 2 * k, from: { type: 'matchLoser', matchKey } });
  }
  for (let j = pairs + 1; j <= biggerSize; j++) {
    finalRankingMap.push({
      rank: 2 * pairs + (j - pairs),
      from: { type: 'standing', stageId: 'group', groupId: bigger, rank: j }
    });
  }

  const rrMatches = rrCount(sizeA) + rrCount(sizeB);
  const uneven = sizeA !== sizeB;
  return {
    formatId,
    name: `${teamCount}隊 兩組循環＋同名次對決（系統產生）`,
    teamCount,
    generated: true,
    description:
      `A組 ${sizeA} 隊、B組 ${sizeB} 隊，共 ${rrMatches + pairs} 場。` +
      (uneven ? `注意：隊數不齊，${bigger}組第 ${biggerSize} 名沒有名次賽，比別隊少打一場。` : ''),
    stages: [
      {
        stageId: 'group', name: '分組循環', type: 'roundRobin', order: 1,
        groupCount: 2, groupSize: sizeA, legs: 1, seedingMethod: 'snake'
      },
      { stageId: 'final', name: '名次對決', type: 'knockout', order: 2, drawRule: 'penalty', slots }
    ],
    finalRankingMap
  };
}

const rrCount = (n: number) => (n < 2 ? 0 : (n * (n - 1)) / 2);

/** 場次上的隊伍參照。沒有 abbr／隊色時容忍為 null。 */
export function teamRefOf(t: SeededTeam | null | undefined) {
  const name = t?.shortName || t?.name || null;
  return {
    teamId: t?.teamId ?? null,
    name,
    abbr: t?.abbr ?? null,
    logoUrl: t?.logoUrl ?? null,
    colorPrimary: t?.colors?.primary ?? null,
    placeholder: null as TeamSource | null,
    displayName: name
  };
}

/** 未定隊伍的佔位 */
export function placeholderRefOf(
  src: TeamSource | null | undefined,
  config: { groupNames?: Record<string, string> } = {},
  labels: Record<string, string> = {}
) {
  const label =
    src?.type === 'standing' ? `${groupNameOf(src.groupId, config)}第${src.rank}名`
    : src?.type === 'seed' ? `種子第${src.rank}名`
    : src?.type === 'matchWinner' ? `${labels[src.matchKey] || src.matchKey} 勝隊`
    : src?.type === 'matchLoser' ? `${labels[src.matchKey] || src.matchKey} 敗隊`
    : '待定';
  return {
    teamId: null as string | null,
    name: null as string | null,
    abbr: null as string | null,
    logoUrl: null as string | null,
    colorPrimary: null as string | null,
    placeholder: src ?? null,
    displayName: label
  };
}

export interface SchedMatch {
  matchId: string;
  divisionId?: string;
  stageId?: string;
  groupId?: string | null;
  round?: number;
  label?: string | null;
  matchKey?: string | null;
  home?: ReturnType<typeof teamRefOf> | ReturnType<typeof placeholderRefOf> | null;
  away?: ReturnType<typeof teamRefOf> | ReturnType<typeof placeholderRefOf> | null;
  teamIds?: Array<string | null>;
  _sortKey?: number[];
  kickoffMs?: number | null;
  kickoffAt?: unknown;
  venueId?: string | null;
  venueName?: string | null;
  status?: string;
  matchNo?: number | null;
}

/**
 * 依 Format 產生一個組別的全部對戰。
 */
export function buildMatches({
  division,
  format,
  groups
}: {
  division: { code?: string; divisionId?: string; groupNames?: Record<string, string> };
  format: Format;
  groups: Array<Array<SeededTeam>>;
}): {
  stages: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
  matches: SchedMatch[];
  groupAssign: Record<string, string>;
} {
  if (!division?.code) {
    throw new Error(`組別 ${division?.divisionId ?? '(未知)'} 沒有 code，產不出 matchId`);
  }
  if (!format?.stages?.length) throw new Error('Format 沒有 stages');
  if (!Array.isArray(groups) || !groups.length) throw new Error('buildMatches：缺少分組');

  const teamTotal = groups.reduce((n, g) => n + g.length, 0);
  if (Number.isInteger(format.teamCount) && format.teamCount !== teamTotal) {
    throw new Error(
      `${division.divisionId}：Format「${format.name}」需要 ${format.teamCount} 隊，` +
      `實際 ${teamTotal} 隊。請換一個範本，或讓系統產生通用範本。`
    );
  }

  const stages: Array<Record<string, unknown>> = [];
  const groupDocs: Array<Record<string, unknown>> = [];
  const matches: SchedMatch[] = [];
  const groupAssign: Record<string, string> = {};
  const names = { groupNames: { ...format.groupNames, ...division.groupNames } };
  const labels = format.matchNames ?? {};

  for (const st of format.stages) {
    stages.push({
      stageId: st.stageId, name: st.name, type: st.type, order: st.order,
      groupCount: st.groupCount ?? null, legs: st.legs ?? null,
      drawRule: st.drawRule ?? 'none',
      status: 'pending', advancementResolved: false
    });

    const code = STAGE_CODE[st.stageId];
    if (!code) throw new Error(`STAGE_CODE 沒有 ${st.stageId}，matchId 產不出來`);

    if (st.type === 'roundRobin') {
      groups.forEach((teamsInGroup, gi) => {
        const gid = groupLabel(gi);
        groupDocs.push({
          stageId: st.stageId, groupId: gid, name: groupNameOf(gid, names),
          teamIds: teamsInGroup.map(t => t.teamId), order: gi + 1
        });
        teamsInGroup.forEach(t => { groupAssign[t.teamId] = gid; });

        const rounds = roundRobin(teamsInGroup.length, st.legs === 2 ? 2 : 1);
        let seq = 0;
        rounds.forEach((round, ri) => {
          round.forEach(([h, a]) => {
            seq += 1;
            const home = teamsInGroup[h];
            const away = teamsInGroup[a];
            matches.push({
              matchId: `${division.code}-${code}-${gid}-${String(seq).padStart(2, '0')}`,
              divisionId: division.divisionId,
              stageId: st.stageId,
              groupId: gid,
              round: ri + 1,
              label: `${groupNameOf(gid, names)} 第${ri + 1}輪`,
              matchKey: null,
              home: teamRefOf(home),
              away: teamRefOf(away),
              teamIds: [home?.teamId ?? null, away?.teamId ?? null],
              _sortKey: [st.order, ri + 1, gi, seq]
            });
          });
        });
      });
    } else {
      (st.slots || []).forEach((slot, si) => {
        matches.push({
          matchId: `${division.code}-${code}-${slot.matchKey}`,
          divisionId: division.divisionId,
          stageId: st.stageId,
          groupId: null,
          round: slot.round ?? 1,
          label: slot.label,
          matchKey: slot.matchKey,
          home: placeholderRefOf(slot.home, names, labels),
          away: placeholderRefOf(slot.away, names, labels),
          teamIds: [],
          _sortKey: [st.order, slot.round ?? 1, 0, si + 1]
        });
      });
    }
  }

  return { stages, groups: groupDocs, matches, groupAssign };
}

/** 對戰表的排列順序：階段 → 輪次 → 小組 → 序號 */
export function sortByStructure<T extends { _sortKey?: number[]; matchId?: string }>(matches: readonly T[]): T[] {
  return [...matches].sort((x, y) => {
    const kx = x._sortKey ?? [0, 0, 0, 0];
    const ky = y._sortKey ?? [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const d = (kx[i] ?? 0) - (ky[i] ?? 0);
      if (d !== 0) return d;
    }
    return String(x.matchId).localeCompare(String(y.matchId));
  });
}

/** 一場比賽在場地上佔用的時間（分）＝ 比賽時間 ＋ 場間緩衝 */
export function slotSpanMin(durationMin: number, bufferMin: number): number {
  return intOr(durationMin, 0) + intOr(bufferMin, 0);
}

const intOr = (v: unknown, fallback: number): number =>
  (typeof v === 'number' && Number.isInteger(v) ? v : fallback);
const overlaps = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;

/** 9 人制不能排進 5 人制場地；5 人制排進大場沒問題 */
export function fieldFits(
  playersOnField: number | null | undefined,
  venue: { fieldType?: string } | null | undefined
): boolean {
  if (playersOnField !== 9) return true;
  return venue?.fieldType !== '5v5';
}

interface Venue {
  venueId: string;
  name?: string;
  fieldType?: string;
  order?: number;
}

interface DivisionClock {
  divisionId: string;
  matchDurationMin?: number;
  playersOnField?: number;
}

interface PlaceMatch extends SchedMatch {
  matchId: string;
  divisionId?: string;
  teamIds?: Array<string | null>;
}

/**
 * 把一批場次排進時段與場地（貪婪：每一場放進最早排得下的位置）。
 * occupied 帶入當天其他組別已排定的場次。
 */
export function placeMatches({
  matches, occupied = [], venues = [],
  dayStartMs, dayEndMs, slotMin, bufferMin = 0,
  divisions = [], durationMin, playersOnField, minRestMin = 0
}: {
  matches: PlaceMatch[];
  occupied?: Array<{ venueId?: string; startMs: number; endMs: number; teamIds?: Array<string | null> }>;
  venues?: Venue[];
  dayStartMs: number;
  dayEndMs: number;
  slotMin: number;
  bufferMin?: number;
  divisions?: DivisionClock[];
  durationMin?: number;
  playersOnField?: number;
  minRestMin?: number;
}): { placed: Array<PlaceMatch & { kickoffMs: number; venueId: string; venueName: string }>; unplaced: Array<{ match: PlaceMatch; reason: string }> } {
  if (!Number.isFinite(dayStartMs) || !Number.isFinite(dayEndMs)) {
    throw new TypeError('placeMatches：dayStartMs / dayEndMs 必須是毫秒數字');
  }
  if (!Number.isInteger(slotMin) || slotMin < 1) {
    throw new RangeError('placeMatches：slotMin 必須是 >= 1 的整數');
  }
  if (!venues.length) return { placed: [], unplaced: matches.map(m => ({ match: m, reason: '當天沒有可用場地' })) };

  const divById = Object.fromEntries(divisions.map(d => [d.divisionId, d]));
  const specOf = (m: PlaceMatch) => {
    const d = m.divisionId ? divById[m.divisionId] : undefined;
    const dur = intOr(d?.matchDurationMin, durationMin ?? NaN);
    const pof = Number.isInteger(d?.playersOnField) ? d?.playersOnField : playersOnField;
    if (!Number.isInteger(dur)) {
      throw new Error(`placeMatches：${m.matchId} 查不到比賽長度（缺 divisions 或 durationMin）`);
    }
    return { durationMin: dur, playersOnField: pof };
  };

  const index = createBusyIndex();
  for (const o of occupied) index.add({ ...o });
  const placed: Array<PlaceMatch & { kickoffMs: number; venueId: string; venueName: string }> = [];
  const unplaced: Array<{ match: PlaceMatch; reason: string }> = [];
  const slotMs = slotMin * 60000;
  const slotCount = Math.max(0, Math.floor((dayEndMs - dayStartMs) / slotMs) + 1);
  const restMs = intOr(minRestMin, 0) * 60000;
  const unplacedReason = '當天排不下（場地或時間不足）。可以增加場地、延後結束時間，或降低休息下限。';
  // 同一規格的場地已經沒有空隙時，後面更長或一樣長的場次不必再掃。
  let saturated: { durationMin: number; playersOnField: number | undefined } | null = null;
  let freeCache: { key: string; free: boolean } | null = null;

  const jumpTo = (clearStart: number, i: number): number => {
    if (!(clearStart > dayStartMs)) return i + 1;
    const slot = Math.ceil((clearStart - dayStartMs) / slotMs);
    return slot > i ? slot : i + 1;
  };

  const venuesHaveSlot = (players: number | undefined, durationMin: number, spanMin: number): boolean => {
    const key = `${durationMin}|${String(players)}|${spanMin}`;
    if (freeCache?.key === key) return freeCache.free;
    const spanMs = spanMin * 60000;
    const playMs = durationMin * 60000;
    let free = false;
    for (let i = 0; i < slotCount; i++) {
      const startMs = dayStartMs + i * slotMs;
      if (startMs + playMs > dayEndMs) break;
      const endMs = startMs + spanMs;
      for (const v of venues) {
        if (!fieldFits(players, v)) continue;
        if (venueBlockClear(index.byVenue.get(v.venueId), startMs, endMs) == null) {
          free = true;
          break;
        }
      }
      if (free) break;
    }
    freeCache = { key, free };
    return free;
  };

  for (const m of sortByStructure(matches)) {
    const spec = specOf(m);
    const span = slotSpanMin(spec.durationMin, bufferMin);
    if (
      saturated &&
      spec.durationMin >= saturated.durationMin &&
      spec.playersOnField === saturated.playersOnField
    ) {
      unplaced.push({ match: m, reason: unplacedReason });
      continue;
    }

    let fitted: { startMs: number; endMs: number; venue: Venue } | null = null;
    let i = 0;
    while (i < slotCount && !fitted) {
      const startMs = dayStartMs + i * slotMs;
      const endMs = startMs + span * 60000;
      if (startMs + spec.durationMin * 60000 > dayEndMs) break;

      const teamClear = teamBlockClear(index.byTeam, m.teamIds, startMs - restMs, endMs + restMs, restMs);
      if (teamClear != null) {
        i = jumpTo(teamClear, i);
        continue;
      }

      let anyField = false;
      let venueClear = Infinity;
      for (const v of venues) {
        if (!fieldFits(spec.playersOnField, v)) continue;
        anyField = true;
        const block = venueBlockClear(index.byVenue.get(v.venueId), startMs, endMs);
        if (block == null) {
          fitted = { startMs, endMs, venue: v };
          break;
        }
        if (block < venueClear) venueClear = block;
      }
      if (fitted) break;
      if (!anyField || venueClear === Infinity) break;
      i = jumpTo(venueClear, i);
    }

    if (!fitted) {
      if (!venuesHaveSlot(spec.playersOnField, spec.durationMin, span)) {
        saturated = { durationMin: spec.durationMin, playersOnField: spec.playersOnField };
      }
      unplaced.push({ match: m, reason: unplacedReason });
      continue;
    }

    index.add({
      venueId: fitted.venue.venueId,
      startMs: fitted.startMs,
      endMs: fitted.endMs,
      teamIds: m.teamIds || []
    });
    freeCache = null;
    placed.push({
      ...m,
      kickoffMs: fitted.startMs,
      venueId: fitted.venue.venueId,
      venueName: fitted.venue.name ?? fitted.venue.venueId
    });
  }

  return { placed, unplaced };
}

interface BusySlot {
  venueId?: string;
  startMs: number;
  endMs: number;
  teamIds?: ReadonlyArray<string | null | undefined>;
}

function createBusyIndex() {
  const byVenue = new Map<string, BusySlot[]>();
  const byTeam = new Map<string | null | undefined, BusySlot[]>();
  const add = (o: BusySlot) => {
    if (o.venueId) {
      let list = byVenue.get(o.venueId);
      if (!list) {
        list = [];
        byVenue.set(o.venueId, list);
      }
      list.push(o);
    }
    const seen = new Set<string | null | undefined>();
    for (const t of o.teamIds || []) {
      if (seen.has(t)) continue;
      seen.add(t);
      let list = byTeam.get(t);
      if (!list) {
        list = [];
        byTeam.set(t, list);
      }
      list.push(o);
    }
  };
  return { byVenue, byTeam, add };
}

/** 與原本 busy.some + includes 相同。回傳「下一個不再重疊」的開賽毫秒；沒重疊則 null。 */
function teamBlockClear(
  byTeam: Map<string | null | undefined, BusySlot[]>,
  teamIds: ReadonlyArray<string | null | undefined> | undefined,
  windowStart: number,
  windowEnd: number,
  restMs: number
): number | null {
  let clear = -Infinity;
  const seen = new Set<string | null | undefined>();
  for (const t of teamIds || []) {
    if (seen.has(t)) continue;
    seen.add(t);
    const list = byTeam.get(t);
    if (!list) continue;
    for (const o of list) {
      if (!overlaps(windowStart, windowEnd, o.startMs, o.endMs)) continue;
      const next = o.endMs + restMs;
      if (next > clear) clear = next;
    }
  }
  return clear === -Infinity ? null : clear;
}

function venueBlockClear(
  list: BusySlot[] | undefined,
  startMs: number,
  endMs: number
): number | null {
  if (!list?.length) return null;
  let clear = -Infinity;
  for (const o of list) {
    if (!overlaps(startMs, endMs, o.startMs, o.endMs)) continue;
    if (o.endMs > clear) clear = o.endMs;
  }
  return clear === -Infinity ? null : clear;
}

/**
 * 把某個時間點之後的場次整體順延。
 * 已經開打的場次不動。
 */
export function shiftMatches(
  matches: SchedMatch[],
  { fromMs, deltaMin }: { fromMs: number; deltaMin: number }
): { updates: Array<{ matchId: string; kickoffMs: number }>; skipped: Array<{ matchId: string; reason: string }> } {
  if (!Number.isFinite(fromMs)) throw new TypeError('shiftMatches：fromMs 必須是毫秒數字');
  if (!Number.isInteger(deltaMin) || deltaMin === 0) {
    throw new RangeError('shiftMatches：deltaMin 必須是非零整數（分鐘）');
  }
  const updates: Array<{ matchId: string; kickoffMs: number }> = [];
  const skipped: Array<{ matchId: string; reason: string }> = [];
  for (const m of matches) {
    const ms = kickoffMsOf(m);
    if (ms == null || ms < fromMs) continue;
    if (!MOVABLE_STATUSES.includes(m.status ?? '')) {
      skipped.push({ matchId: m.matchId, reason: `已經是「${m.status}」，不順延` });
      continue;
    }
    updates.push({ matchId: m.matchId, kickoffMs: ms + deltaMin * 60000 });
  }
  return { updates, skipped };
}

/** 場次的開賽毫秒。相容 Timestamp、Date、數字，也讀 seconds／nanoseconds。 */
export function kickoffMsOf(m: { kickoffMs?: unknown; kickoffAt?: unknown } | null | undefined): number | null {
  const v = m?.kickoffMs ?? m?.kickoffAt;
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object') {
    const o = v as { toMillis?: unknown; seconds?: unknown; nanoseconds?: unknown };
    if (typeof o.toMillis === 'function') return (o.toMillis as () => number)();
    if (typeof o.seconds === 'number') {
      const nanos = typeof o.nanoseconds === 'number' ? o.nanoseconds : 0;
      return o.seconds * 1000 + Math.floor(nanos / 1e6);
    }
  }
  return null;
}

/**
 * 全賽事流水號。frozen 時只給還沒有號碼的場次接續編下去。
 */
export function assignMatchNos(
  matches: SchedMatch[],
  { frozen = false }: { frozen?: boolean } = {}
): Array<{ matchId: string; matchNo: number }> {
  const sorted = [...matches].sort((a, b) => {
    const ka = kickoffMsOf(a);
    const kb = kickoffMsOf(b);
    if (ka != null && kb != null && ka !== kb) return ka - kb;
    if (ka == null && kb != null) return 1;
    if (ka != null && kb == null) return -1;
    return String(a.matchId).localeCompare(String(b.matchId));
  });

  if (!frozen) {
    const out: Array<{ matchId: string; matchNo: number }> = [];
    sorted.forEach((m, i) => {
      if (m.matchNo !== i + 1) out.push({ matchId: m.matchId, matchNo: i + 1 });
    });
    return out;
  }

  const used = matches.map(m => m.matchNo).filter((n): n is number => Number.isInteger(n) && (n ?? 0) > 0);
  let next = used.length ? Math.max(...used) + 1 : 1;
  const out: Array<{ matchId: string; matchNo: number }> = [];
  for (const m of sorted) {
    if (Number.isInteger(m.matchNo) && (m.matchNo ?? 0) > 0) continue;
    out.push({ matchId: m.matchId, matchNo: next });
    next += 1;
  }
  return out;
}

interface CheckedMatch {
  matchId: string;
  divisionId?: string;
  stageId?: string;
  label?: string | null;
  matchKey?: string | null;
  venueId?: string | null;
  teamIds?: Array<string | null>;
  kickoffMs?: unknown;
  kickoffAt?: unknown;
  home?: { teamId?: string | null; name?: string | null; displayName?: string | null; placeholder?: TeamSource | null } | null;
  away?: { teamId?: string | null; name?: string | null; displayName?: string | null; placeholder?: TeamSource | null } | null;
}

/**
 * 檢查一批場次排得對不對。
 * error 是放行之後會產生錯誤結果；warn 是提醒，主辦仍可發布。
 * 休息與空等只看時間相鄰的兩場。
 * 同一 code 加上同一組場次只留一筆（原行為，不同訊息也可能被併掉）。
 */
export function checkSchedule({
  matches = [], venues = [], divisions = [], minRestMin = 20, maxGapMin = 240, defaultDurationMin = 30
}: {
  matches?: CheckedMatch[];
  venues?: Venue[];
  divisions?: DivisionClock[];
  minRestMin?: number;
  maxGapMin?: number;
  /** 組別沒寫 matchDurationMin 時的場長。預設 30，與原本寫死的後備值相同。 */
  defaultDurationMin?: number;
} = {}): { findings: Finding[]; canPublish: boolean } {
  const findings: Finding[] = [];
  const add = (level: Finding['level'], code: string, message: string, source: string, matchIds?: string[]) =>
    findings.push({ level, code, message, source, matchIds: matchIds ?? [] });

  const venueById = Object.fromEntries(venues.map(v => [v.venueId, v]));
  const divById = Object.fromEntries(divisions.map(d => [d.divisionId, d]));
  const label = (m: CheckedMatch) => `${m.matchId}（${m.label ?? ''}）`;

  const spans: Array<{ m: CheckedMatch; start: number; end: number; playMin: number }> = [];
  const noSlot: CheckedMatch[] = [];
  for (const m of matches) {
    const start = kickoffMsOf(m);
    if (start == null || !m.venueId) { noSlot.push(m); continue; }
    const div: DivisionClock = (m.divisionId ? divById[m.divisionId] : undefined) ?? { divisionId: '' };
    const dur = intOr(div.matchDurationMin, defaultDurationMin);
    spans.push({ m, start, end: start + dur * 60000, playMin: dur });
  }

  if (noSlot.length) {
    add('error', 'NO_SLOT',
      `${noSlot.length} 場還沒有排定時間或場地：${briefList(noSlot.map(label))}`,
      '系統限制', noSlot.map(m => m.matchId));
  }

  for (const [venueId, list] of byKeySorted(spans, s => s.m.venueId)) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (!a || !b) continue;
      if (!overlaps(a.start, a.end, b.start, b.end)) continue;
      add('error', 'VENUE_OVERLAP',
        `${venueName(venueById, venueId)} 同時排了兩場：${label(a.m)} 與 ${label(b.m)}。`,
        '系統限制', [a.m.matchId, b.m.matchId]);
    }
  }

  for (const [teamId, list] of byKeySorted(spans, s => s.m.teamIds || [])) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (!a || !b) continue;
      if (overlaps(a.start, a.end, b.start, b.end)) {
        add('error', 'TEAM_OVERLAP',
          `${teamNameOf(a.m, teamId)} 同時要打兩場：${label(a.m)} 與 ${label(b.m)}。`,
          '系統限制', [a.m.matchId, b.m.matchId]);
        continue;
      }
      const gap = Math.round((b.start - a.end) / 60000);
      if (gap < minRestMin) {
        add('warn', 'SHORT_REST',
          `${teamNameOf(a.m, teamId)} 兩場之間只休息 ${gap} 分鐘（建議至少 ${minRestMin} 分）：${label(a.m)} 與 ${label(b.m)}。`,
          '建議', [a.m.matchId, b.m.matchId]);
      } else if (gap > maxGapMin) {
        add('warn', 'LONG_GAP',
          `${teamNameOf(a.m, teamId)} 兩場之間要等 ${Math.round((gap / 60) * 10) / 10} 小時：${label(a.m)} 與 ${label(b.m)}。`,
          '建議', [a.m.matchId, b.m.matchId]);
      }
    }
  }

  for (const s of spans) {
    const div: DivisionClock = (s.m.divisionId ? divById[s.m.divisionId] : undefined) ?? { divisionId: '' };
    const v = s.m.venueId ? venueById[s.m.venueId] : undefined;
    if (!v) {
      add('error', 'UNKNOWN_VENUE',
        `${label(s.m)} 指到不存在的場地 ${s.m.venueId}。`, '系統限制', [s.m.matchId]);
      continue;
    }
    if (!fieldFits(div.playersOnField, v)) {
      add('error', 'FIELD_TOO_SMALL',
        `${label(s.m)} 是 ${div.playersOnField} 人制，排在 ${v.name ?? v.venueId}（${v.fieldType}）。`,
        '系統限制', [s.m.matchId]);
    }
  }

  const byKey = new Map<string, { m: CheckedMatch; start: number; end: number }>();
  for (const s of spans) if (s.m.matchKey) byKey.set(`${s.m.divisionId}|${s.m.matchKey}`, s);
  const stageEnd = new Map<string, number>();
  for (const s of spans) {
    const k = `${s.m.divisionId}|${s.m.stageId}`;
    stageEnd.set(k, Math.max(stageEnd.get(k) ?? -Infinity, s.end));
  }

  for (const s of spans) {
    for (const side of ['home', 'away'] as const) {
      const ph = s.m[side]?.placeholder;
      if (!ph) continue;
      if (ph.type === 'standing') {
        const end = stageEnd.get(`${s.m.divisionId}|${ph.stageId}`);
        if (end != null && s.start < end) {
          add('error', 'SOURCE_AFTER',
            `${label(s.m)} 要用「${ph.groupId}組第${ph.rank}名」，但 ${ph.stageId} 還有場次排在它之後或同時。`,
            '系統限制', [s.m.matchId]);
        }
      } else if (ph.type === 'matchWinner' || ph.type === 'matchLoser') {
        const src = byKey.get(`${s.m.divisionId}|${ph.matchKey}`);
        if (src && s.start < src.end) {
          add('error', 'SOURCE_AFTER',
            `${label(s.m)} 要用 ${ph.matchKey} 的結果，但 ${ph.matchKey} 排在它之後或同時。`,
            '系統限制', [s.m.matchId, src.m.matchId]);
        }
      }
    }
  }

  const out = dedupe(findings);
  return { findings: out, canPublish: !out.some(f => f.level === 'error') };
}

function byKeySorted<T extends { start: number; m: { matchId: string } }>(
  spans: T[],
  keyFn: (s: T) => string | null | undefined | Array<string | null | undefined>
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const s of spans) {
    const raw = keyFn(s);
    const keys = Array.isArray(raw) ? raw : [raw];
    for (const k of keys) {
      if (k == null || k === '') continue;
      let list = map.get(k);
      if (!list) {
        list = [];
        map.set(k, list);
      }
      list.push(s);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.start - b.start || String(a.m.matchId).localeCompare(String(b.m.matchId)));
  }
  return map;
}

function teamNameOf(match: CheckedMatch, teamId: string): string {
  for (const side of ['home', 'away'] as const) {
    if (match?.[side]?.teamId === teamId) return match[side]?.name || match[side]?.displayName || teamId;
  }
  return teamId;
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter(f => {
    const key = `${f.code}|${[...(f.matchIds ?? [])].sort().join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function venueName(byId: Record<string, Venue | undefined>, venueId: string | null | undefined): string {
  if (!venueId) return '（未指定場地）';
  return byId[venueId]?.name ?? venueId;
}

function briefList(list: string[]): string {
  return list.length <= 3 ? list.join('、') : `${list.slice(0, 3).join('、')} 等 ${list.length} 場`;
}
