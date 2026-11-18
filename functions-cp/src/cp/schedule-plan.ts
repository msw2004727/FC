/**
 * 賽程第 3 步純函式：單組循環排程、公開場次文件、積分計入、比分對帳。
 * 不讀時鐘、不用 Math.random、不碰 Firestore。抽籤只靠呼叫端給的 seed。
 */
import {
  RANKING_RULES,
  assignMatchNos,
  buildRoundRobinFormat,
  drawOrder,
  placeMatches,
  planGeneration,
  taipeiMs,
  type RankingRule
} from '../engine/index.js';

export interface PlanTeam { enId: string; name: string }
export interface PlanDay { date: string; start: string; end: string }
export interface PlanVenue { venueIdx: number; name: string }
export interface PlanInput {
  dvId: string;
  teams: PlanTeam[];
  legs: 1 | 2;
  matchMinutes: number;
  bufferMinutes: number;
  minRestMinutes: number;
  days: PlanDay[];
  venues: PlanVenue[];
  playersOnField: number;
  seed: number;
  /** 預設 '+08:00'。只拿來換算開賽毫秒，不看執行環境時區。 */
  utcOffset?: string;
}
export interface PlannedMatch {
  round: number;
  matchNo: number;
  kickoffMs: number | null;
  venueIdx: number | null;
  venueName: string | null;
  home: { teamId: string; name: string };
  away: { teamId: string; name: string };
}
export interface PlanResult {
  matches: PlannedMatch[];
  matchCount: number;
  unplacedCount: number;
  unplacedReasons: string[];
  daysUsed: string[];
  groups: Array<{ groupId: 'A'; teamIds: string[] }>;
}

const HHMM_RE = /^(\d{2}):(\d{2})$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET_RE = /^[+-]\d{2}:\d{2}$/;

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function fail(field: string): never {
  throw new RangeError(field);
}

function intBetween(field: string, value: unknown, min: number, max: number): number {
  if (!isInt(value) || value < min || value > max) fail(field);
  return value;
}

function validYmd(date: string): boolean {
  if (!YMD_RE.test(date)) return false;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function validHhmm(value: string): boolean {
  const m = HHMM_RE.exec(value);
  if (!m) return false;
  return Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

function assertTeams(teams: unknown): PlanTeam[] {
  if (!Array.isArray(teams) || teams.length < 2 || teams.length > 16) fail('teams');
  for (const raw of teams) {
    if (!raw || typeof raw !== 'object') fail('teams');
    const team = raw as PlanTeam;
    if (typeof team.enId !== 'string' || typeof team.name !== 'string') fail('teams');
  }
  return teams as PlanTeam[];
}

function assertDays(days: unknown): PlanDay[] {
  if (!Array.isArray(days) || days.length < 1 || days.length > 14) fail('days');
  let prev = '';
  for (const raw of days) {
    if (!raw || typeof raw !== 'object') fail('days');
    const day = raw as PlanDay;
    if (typeof day.date !== 'string' || !validYmd(day.date)) fail('days');
    if (typeof day.start !== 'string' || typeof day.end !== 'string') fail('days');
    if (!validHhmm(day.start) || !validHhmm(day.end)) fail('days');
    if (day.start >= day.end) fail('days');
    if (prev && day.date <= prev) fail('days');
    prev = day.date;
  }
  return days as PlanDay[];
}

function assertVenues(venues: unknown): PlanVenue[] {
  if (!Array.isArray(venues) || venues.length < 1 || venues.length > 10) fail('venues');
  const seen = new Set<number>();
  for (const raw of venues) {
    if (!raw || typeof raw !== 'object') fail('venues');
    const venue = raw as PlanVenue;
    if (!isInt(venue.venueIdx) || typeof venue.name !== 'string') fail('venues');
    if (seen.has(venue.venueIdx)) fail('venues');
    seen.add(venue.venueIdx);
  }
  return venues as PlanVenue[];
}

function assertOffset(utcOffset: string | undefined): string {
  const offset = utcOffset ?? '+08:00';
  if (!OFFSET_RE.test(offset)) fail('utcOffset');
  const hours = Number(offset.slice(1, 3));
  const mins = Number(offset.slice(4, 6));
  if (hours > 23 || mins > 59) fail('utcOffset');
  return offset;
}

function sideOf(ref: { teamId?: string | null; name?: string | null } | null | undefined): { teamId: string; name: string } {
  return {
    teamId: ref?.teamId ?? '',
    name: ref?.name ?? ''
  };
}

/**
 * 單組循環。teams 2～16、legs 1 或 2。違規拋 RangeError，訊息是欄位名。
 * 抽籤順序 → buildRoundRobinFormat → planGeneration（division.code = 'D'）
 * → 逐日 placeMatches（前幾天放進 occupied）→ assignMatchNos（非 frozen）。
 */
export function planRoundRobin(input: PlanInput): PlanResult {
  const teams = assertTeams(input?.teams);
  if (input.legs !== 1 && input.legs !== 2) fail('legs');
  const matchMinutes = intBetween('matchMinutes', input.matchMinutes, 5, 180);
  const bufferMinutes = intBetween('bufferMinutes', input.bufferMinutes, 0, 60);
  const minRestMinutes = intBetween('minRestMinutes', input.minRestMinutes, 0, 240);
  const days = assertDays(input.days);
  const venues = assertVenues(input.venues);
  if (!isInt(input.seed)) fail('seed');
  const utcOffset = assertOffset(input.utcOffset);

  const ordered = drawOrder(teams, input.seed);
  const generation = planGeneration({
    division: { divisionId: input.dvId, code: 'D' },
    orderedTeams: ordered.map(t => ({ teamId: t.enId, name: t.name })),
    format: buildRoundRobinFormat({ teamCount: teams.length, legs: input.legs })
  });

  // 9 人制只拒絕 5v5。fieldType 用 9v9，任何 playersOnField 都放得進去。
  const engineVenues = venues.map((v, i) => ({
    venueId: `v${v.venueIdx}`,
    name: v.name,
    fieldType: '9v9',
    order: i
  }));
  const venueIdxOf = new Map(venues.map(v => [`v${v.venueIdx}`, v.venueIdx]));
  const spanMs = (matchMinutes + bufferMinutes) * 60_000;

  let pending = generation.matches;
  const occupied: Array<{ venueId: string; startMs: number; endMs: number; teamIds: Array<string | null> }> = [];
  const placedRows: Array<{ match: (typeof pending)[number] & { kickoffMs: number; venueId: string; venueName: string }; date: string }> = [];
  let finalUnplaced: Array<{ reason: string }> = [];

  for (const day of days) {
    const dayStartMs = taipeiMs(day.date, day.start, utcOffset);
    const dayEndMs = taipeiMs(day.date, day.end, utcOffset);
    if (dayStartMs == null || dayEndMs == null) fail('days');

    const { placed, unplaced } = placeMatches({
      matches: pending,
      occupied,
      venues: engineVenues,
      dayStartMs,
      dayEndMs,
      slotMin: 5,
      durationMin: matchMinutes,
      bufferMin: bufferMinutes,
      minRestMin: minRestMinutes,
      playersOnField: input.playersOnField
    });

    for (const m of placed) {
      placedRows.push({ match: m, date: day.date });
      occupied.push({
        venueId: m.venueId,
        startMs: m.kickoffMs,
        endMs: m.kickoffMs + spanMs,
        teamIds: m.teamIds ?? []
      });
    }
    finalUnplaced = unplaced;
    pending = unplaced.map(u => u.match);
    if (pending.length === 0) break;
  }

  const pool = [
    ...placedRows.map(r => r.match),
    ...pending.map(m => ({ ...m, kickoffMs: null as number | null }))
  ];
  const noOf = new Map(assignMatchNos(pool, { frozen: false }).map(row => [row.matchId, row.matchNo]));

  const placedById = new Map(placedRows.map(r => [r.match.matchId, r]));
  const matches: PlannedMatch[] = pool.map(m => {
    const hit = placedById.get(m.matchId);
    const venueIdx = hit ? venueIdxOf.get(hit.match.venueId) ?? null : null;
    return {
      round: m.round ?? 0,
      matchNo: noOf.get(m.matchId) ?? 0,
      kickoffMs: hit ? hit.match.kickoffMs : null,
      venueIdx,
      venueName: hit ? hit.match.venueName : null,
      home: sideOf(m.home),
      away: sideOf(m.away)
    };
  });
  matches.sort((a, b) => a.matchNo - b.matchNo);

  const daysUsed: string[] = [];
  for (const row of placedRows) {
    if (!daysUsed.includes(row.date)) daysUsed.push(row.date);
  }
  const unplacedReasons: string[] = [];
  for (const row of finalUnplaced) {
    if (!unplacedReasons.includes(row.reason)) unplacedReasons.push(row.reason);
  }

  return {
    matches,
    matchCount: matches.length,
    unplacedCount: pending.length,
    unplacedReasons,
    daysUsed,
    groups: [{ groupId: 'A', teamIds: ordered.map(t => t.enId) }]
  };
}

/** 契約 §1.2。kickoff 用毫秒數字 kickoffMs；不帶 kickoffAt、updatedAt、uid。 */
export function publicMatchDoc(m: PlannedMatch, ids: { mtId: string; dvId: string }): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    matchId: ids.mtId,
    divisionId: ids.dvId,
    stageId: 'group',
    groupId: 'A',
    round: m.round,
    matchNo: m.matchNo,
    label: null,
    matchKey: null,
    kickoffMs: m.kickoffMs,
    venueIdx: m.venueIdx,
    venueName: m.venueName,
    home: { teamId: m.home.teamId, name: m.home.name },
    away: { teamId: m.away.teamId, name: m.away.name },
    teamIds: [m.home.teamId, m.away.teamId],
    score: { home: 0, away: 0 },
    penaltyScore: null,
    status: 'scheduled',
    rev: 0,
    resetRev: 0,
    lock: { locked: false },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'pre' },
    finishedAt: null,
    confirmedAt: null,
    walkoverSide: null,
    result: null,
    resultSource: null
  };
  return doc;
}

export const COUNTED_STATUSES: readonly ['confirmed', 'walkover'] = Object.freeze(['confirmed', 'walkover']);

export function countedForStanding(m: { status?: string }): boolean {
  return m.status === 'confirmed' || m.status === 'walkover';
}

/** 只留計入場次。引擎 COMPLETED_STATUSES 已含 confirmed／walkover，不用改名。 */
export function standingMatchesOf<T extends { status?: string }>(ms: T[]): T[] {
  return ms.filter(countedForStanding);
}

/**
 * 已解決（可以自動結束賽事）：確認、棄權、取消。
 * 計分仍只看 COUNTED_STATUSES。取消算已解決、不計分。
 */
export const RESOLVED_STATUSES: readonly ['confirmed', 'walkover', 'cancelled'] =
  Object.freeze(['confirmed', 'walkover', 'cancelled']);

export function resolvedForEnd(m: { status?: string }): boolean {
  return (RESOLVED_STATUSES as readonly string[]).includes(m.status ?? '');
}

/** 可直接取消。confirmed／walkover 要先重置。 */
export const CANCELLABLE_STATUSES: readonly ['scheduled', 'postponed', 'finished'] =
  Object.freeze(['scheduled', 'postponed', 'finished']);

export function canCancelMatch(status: string): boolean {
  return (CANCELLABLE_STATUSES as readonly string[]).includes(status);
}

/** 未賽不能重置。其餘（含 cancelled）可以。 */
const RESET_BLOCKED: readonly ['scheduled', 'postponed'] = Object.freeze(['scheduled', 'postponed']);

export function canResetMatch(status: string): boolean {
  return !(RESET_BLOCKED as readonly string[]).includes(status);
}

/** 有開賽時間回 scheduled，否則 postponed（kickoffAt 為 null 時維持未排定）。 */
export function statusAfterReset(kickoffMs: number | null): 'scheduled' | 'postponed' {
  return kickoffMs == null ? 'postponed' : 'scheduled';
}

function cloneRule(criteria: RankingRule['criteria']): RankingRule {
  const src = RANKING_RULES.RR_FEDA_DEFAULT;
  return {
    rankingRuleId: src.rankingRuleId,
    name: src.name,
    points: { ...src.points },
    criteria: [...criteria],
    fairPlay: { ...src.fairPlay }
  };
}

/** 回新物件。h2hFirst 是 RR_FEDA_DEFAULT 的複本；goalDiffFirst 只換 criteria。 */
export function rankingRuleOf(preset: 'h2hFirst' | 'goalDiffFirst'): RankingRule {
  const src = RANKING_RULES.RR_FEDA_DEFAULT;
  if (preset === 'h2hFirst') return cloneRule([...src.criteria] as RankingRule['criteria']);
  if (preset === 'goalDiffFirst') {
    return cloneRule(['points', 'goalDiff', 'goalsFor', 'headToHeadPoints', 'manual']);
  }
  fail('ranking');
}

/**
 * 有效進球：seq 為整數且大於 resetRev、type 為 goal、seq 未作廢。
 * side 只認 home／away。goals 是兩邊合計。
 */
export function derivedScoreOf(
  events: Array<{ seq?: unknown; type?: unknown; side?: unknown }>,
  voidedSeqs: Set<number>,
  resetRev: number
): { home: number; away: number; goals: number } {
  let home = 0;
  let away = 0;
  for (const ev of events) {
    const seq = ev?.seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || !(seq > resetRev)) continue;
    if (ev.type !== 'goal' || voidedSeqs.has(seq)) continue;
    if (ev.side === 'home') home += 1;
    else if (ev.side === 'away') away += 1;
  }
  return { home, away, goals: home + away };
}
