/**
 * 同分排序。
 * 先依 points 分出同分群；群內只比成員彼此的比賽；
 * 拆出子群後 criteria 從頭再跑（剩下兩隊不沿用大群迷你表）。
 * 條件用盡仍同分 → hasUnresolvedTie，依 teamId 排穩定順序，不隨機。
 */

import type { Criterion, FairPlayConfig, MatchLike, RankingRule, StandingRow, TallyOpts, TimelineEvent } from './types.js';
import { DEFAULT_POINTS, tallyMatches } from './tally.js';

export const FAIR_PLAY: FairPlayConfig = { yellow: -1, secondYellow: -3, directRed: -4, yellowThenRed: -5 };

const HUMAN_CRITERIA = new Set(['manual', 'drawLots']);

const TRACE_CODE: Record<string, string> = {
  points: 'pts',
  headToHeadPoints: 'h2h-pts',
  headToHeadGoalDiff: 'h2h-gd',
  headToHeadGoalsFor: 'h2h-gf',
  headToHeadWins: 'h2h-w',
  goalDiff: 'gd',
  goalsFor: 'gf',
  goalsAgainstAsc: 'ga',
  wins: 'w',
  fairPlay: 'fp',
  seed: 'seed'
};

export interface FairPlayStat {
  fairPlayPoints: number;
  yellow: number;
  red: number;
}

/**
 * 單一球員、單一場的行為分。
 * fairPlay 預設為 FAIR_PLAY，賽事設定可整包覆寫。
 */
export function fairPlayPoints(
  cards: TimelineEvent[] | null | undefined,
  fairPlay: FairPlayConfig = FAIR_PLAY
): number {
  const list = sortCards(cards);
  if (!list.length) return 0;

  const redAt = list.findIndex(c => c.cardType === 'red');
  if (redAt >= 0) {
    const priorYellow = list
      .slice(0, redAt)
      .some(c => c.cardType === 'yellow' || c.cardType === 'second_yellow');
    return priorYellow ? fairPlay.yellowThenRed : fairPlay.directRed;
  }

  if (list.some(c => c.cardType === 'second_yellow')) return fairPlay.secondYellow;
  return list.filter(c => c.cardType === 'yellow').length * fairPlay.yellow;
}

function sortCards(cards: TimelineEvent[] | null | undefined): TimelineEvent[] {
  return (cards || [])
    .filter(c => c && !c.voided && c.cardType)
    .map((c, i) => ({ c, i }))
    .sort((x, y) => {
      const a = x.c.clockSec ?? x.c.seq;
      const b = y.c.clockSec ?? y.c.seq;
      if (typeof a === 'number' && typeof b === 'number' && a !== b) return a - b;
      return x.i - y.i;
    })
    .map(x => x.c);
}

/** 多場卡片彙總。分堆鍵含 matchId，−3／−5 不可跨場合併。 */
export function fairPlayByTeam(
  cardEvents: TimelineEvent[] | null | undefined,
  fairPlay: FairPlayConfig = FAIR_PLAY
): Map<string, FairPlayStat> {
  const live = (cardEvents || []).filter(c => c && !c.voided && c.cardType);
  const byTeamPlayer = new Map<string, { team: string; cards: TimelineEvent[] }>();
  for (const c of live) {
    const team = c.teamId || c.side;
    if (!team) continue;
    const key = [c.matchId ?? '?', team, c.playerId ?? 'unknown'].join('|');
    let bucket = byTeamPlayer.get(key);
    if (!bucket) {
      bucket = { team, cards: [] };
      byTeamPlayer.set(key, bucket);
    }
    bucket.cards.push(c);
  }

  const out = new Map<string, FairPlayStat>();
  const bump = (t: string): FairPlayStat => {
    let st = out.get(t);
    if (!st) {
      st = { fairPlayPoints: 0, yellow: 0, red: 0 };
      out.set(t, st);
    }
    return st;
  };

  for (const { team, cards } of byTeamPlayer.values()) {
    const st = bump(team);
    st.fairPlayPoints += fairPlayPoints(cards, fairPlay);
    st.yellow += cards.filter(c => c.cardType === 'yellow').length;
    st.red += cards.filter(c => c.cardType === 'red' || c.cardType === 'second_yellow').length;
  }
  return out;
}

interface RawSeparation {
  kind: 'separated' | 'unresolved';
  criterion: string;
  aboveTeamIds: string[];
  belowTeamIds: string[];
  teamIds: string[];
}

interface RankCtx {
  matches: MatchLike[];
  criteria: string[];
  points: { win: number; draw: number; loss: number };
  opts: TallyOpts;
  separations: RawSeparation[];
}

/** 第幾名與第幾名靠哪一條分開。messageKey 給畫面，引擎不組中文句子。 */
export interface TieBreakSeparation {
  messageKey: 'cp.tiebreak.separated' | 'cp.tiebreak.unresolved';
  params: {
    criterion: string;
    aboveTeamIds?: string[];
    belowTeamIds?: string[];
    aboveRanks?: number[];
    belowRanks?: number[];
    teamIds?: string[];
    ranks?: number[];
  };
}

export const TIEBREAK_MESSAGE_KEYS = ['cp.tiebreak.separated', 'cp.tiebreak.unresolved'] as const;

function rankInternal(
  rows: StandingRow[],
  matches: MatchLike[] | null | undefined,
  rule: Pick<RankingRule, 'criteria' | 'points'> | null | undefined,
  opts: TallyOpts = {}
): { rows: StandingRow[]; hasUnresolvedTie: boolean; separations: RawSeparation[] } {
  const criteria: string[] = rule?.criteria?.length ? [...rule.criteria] : ['points'];
  const points = { ...DEFAULT_POINTS, ...(rule?.points || {}) };
  const work = rows.map(r => ({ ...r, tieBreakTrace: [] as string[], hasUnresolvedTie: false, tiedWith: [] as string[] }));
  const separations: RawSeparation[] = [];
  const ctx: RankCtx = { matches: matches || [], criteria, points, opts, separations };
  const result = orderTied(work, ctx, 0);
  result.ordered.forEach((r, i) => { r.rank = i + 1; });
  return { rows: result.ordered, hasUnresolvedTie: result.unresolved, separations };
}

export function rankRows(
  rows: StandingRow[],
  matches: MatchLike[] | null | undefined,
  rule: Pick<RankingRule, 'criteria' | 'points'> | null | undefined,
  opts: TallyOpts = {}
): { rows: StandingRow[]; hasUnresolvedTie: boolean } {
  const ranked = rankInternal(rows, matches, rule, opts);
  return { rows: ranked.rows, hasUnresolvedTie: ranked.hasUnresolvedTie };
}

/** 與 rankRows 同一套順序，另外給出名次是被哪一條規則分開的。 */
export function explainRanking(
  rows: StandingRow[],
  matches: MatchLike[] | null | undefined,
  rule: Pick<RankingRule, 'criteria' | 'points'> | null | undefined,
  opts: TallyOpts = {}
): { rows: StandingRow[]; hasUnresolvedTie: boolean; separations: TieBreakSeparation[] } {
  const ranked = rankInternal(rows, matches, rule, opts);
  const rankOf = new Map(ranked.rows.map(r => [r.teamId, r.rank ?? 0]));
  const separations: TieBreakSeparation[] = ranked.separations.map(s => {
    if (s.kind === 'unresolved') {
      return {
        messageKey: 'cp.tiebreak.unresolved',
        params: {
          criterion: s.criterion,
          teamIds: s.teamIds,
          ranks: s.teamIds.map(id => rankOf.get(id) ?? 0)
        }
      };
    }
    return {
      messageKey: 'cp.tiebreak.separated',
      params: {
        criterion: s.criterion,
        aboveTeamIds: s.aboveTeamIds,
        belowTeamIds: s.belowTeamIds,
        aboveRanks: s.aboveTeamIds.map(id => rankOf.get(id) ?? 0),
        belowRanks: s.belowTeamIds.map(id => rankOf.get(id) ?? 0)
      }
    };
  });
  return { rows: ranked.rows, hasUnresolvedTie: ranked.hasUnresolvedTie, separations };
}

function orderTied(
  group: StandingRow[],
  ctx: RankCtx,
  startAt: number
): { ordered: StandingRow[]; unresolved: boolean } {
  if (group.length <= 1) return { ordered: group, unresolved: false };

  const ids = group.map(r => r.teamId);

  for (let i = startAt; i < ctx.criteria.length; i++) {
    const c = ctx.criteria[i] as string;
    if (HUMAN_CRITERIA.has(c)) {
      const ordered = [...group].sort(byTeamId);
      for (const r of ordered) {
        r.tieBreakTrace.push(`unresolved@${c}`);
        r.hasUnresolvedTie = true;
        r.tiedWith = ids.filter(id => id !== r.teamId);
      }
      ctx.separations.push({
        kind: 'unresolved', criterion: c, aboveTeamIds: [], belowTeamIds: [], teamIds: [...ids]
      });
      return { ordered, unresolved: true };
    }

    const values = criterionValues(c, group, ctx);
    if (!values) continue;

    const code = TRACE_CODE[c] || c;
    const isH2H = c.startsWith('headToHead');
    const scopeFor = (r: StandingRow): string => !isH2H ? ''
      : ids.length === 2 ? `(vs ${ids.find(id => id !== r.teamId)})`
      : `(群 ${ids.join('/')})`;

    for (const r of group) trace(r, `${code}=${fmt(values.get(r.teamId))}${scopeFor(r)}`);

    const buckets = splitByValue(group, values);
    if (buckets.length <= 1) continue;

    for (let b = 0; b < buckets.length - 1; b++) {
      const above = buckets[b];
      const below = buckets[b + 1];
      if (!above || !below) continue;
      ctx.separations.push({
        kind: 'separated',
        criterion: c,
        aboveTeamIds: above.map(r => r.teamId),
        belowTeamIds: below.map(r => r.teamId),
        teamIds: []
      });
    }

    const ordered: StandingRow[] = [];
    let unresolved = false;
    for (const bucket of buckets) {
      if (bucket.length === 1) {
        const only = bucket[0] as StandingRow;
        only.tieBreakTrace.push(`decided@${c}`);
        ordered.push(only);
        continue;
      }
      const sub = orderTied(bucket, ctx, 0);
      ordered.push(...sub.ordered);
      unresolved = unresolved || sub.unresolved;
    }
    return { ordered, unresolved };
  }

  const ordered = [...group].sort(byTeamId);
  for (const r of ordered) {
    r.tieBreakTrace.push('unresolved@exhausted');
    r.hasUnresolvedTie = true;
    r.tiedWith = ids.filter(id => id !== r.teamId);
  }
  ctx.separations.push({
    kind: 'unresolved', criterion: 'exhausted', aboveTeamIds: [], belowTeamIds: [], teamIds: [...ids]
  });
  return { ordered, unresolved: true };
}

function criterionValues(c: string, group: StandingRow[], ctx: RankCtx): Map<string, number | null> | null {
  const ids = group.map(r => r.teamId);
  const out = new Map<string, number | null>();

  if (c.startsWith('headToHead')) {
    const mini = miniTable(ids, ctx);
    for (const r of group) {
      const s = mini.get(r.teamId);
      if (!s) return null;
      out.set(r.teamId,
        c === 'headToHeadPoints' ? s.points :
        c === 'headToHeadGoalDiff' ? s.goalDiff :
        c === 'headToHeadGoalsFor' ? s.goalsFor :
        c === 'headToHeadWins' ? s.win : null);
    }
    return out;
  }

  if (c === 'seed') {
    if (group.some(r => typeof r.seed !== 'number')) return null;
    for (const r of group) out.set(r.teamId, -(r.seed as number));
    return out;
  }

  for (const r of group) {
    const v =
      c === 'points' ? num(r.points) :
      c === 'goalDiff' ? num(r.goalDiff) :
      c === 'goalsFor' ? num(r.goalsFor) :
      c === 'goalsAgainstAsc' ? -num(r.goalsAgainst) :
      c === 'wins' ? num(r.win) :
      c === 'fairPlay' ? num(r.fairPlayPoints) :
      null;
    if (v === null) return null;
    out.set(r.teamId, v);
  }
  return out;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function miniTable(ids: string[], ctx: RankCtx) {
  return tallyMatches(ids, ctx.matches, {
    ...ctx.opts,
    points: ctx.points,
    onlyBetweenTeams: true,
    withdrawnTeamIds: []
  }).stats;
}

function splitByValue(group: StandingRow[], values: Map<string, number | null>): StandingRow[][] {
  const uniq = [...new Set(group.map(r => values.get(r.teamId)))].sort((a, b) => Number(b) - Number(a));
  return uniq.map(v => group.filter(r => values.get(r.teamId) === v));
}

const byTeamId = (a: StandingRow, b: StandingRow): number => String(a.teamId).localeCompare(String(b.teamId));
const fmt = (v: unknown): string => String(v);

function trace(row: StandingRow, entry: string): void {
  if (row.tieBreakTrace.at(-1) !== entry) row.tieBreakTrace.push(entry);
}

export function applyManualRanking(
  rows: StandingRow[],
  pins: Array<{ teamId: string; rank: number }> = []
): StandingRow[] {
  const pinBy = new Map(pins.map(p => [p.teamId, p.rank]));
  const settled = new Set(pinBy.keys());
  for (const r of rows) {
    if (!pinBy.has(r.teamId)) continue;
    for (const other of r.tiedWith || []) settled.add(other);
  }

  const clean = (r: StandingRow): StandingRow => ({
    ...r,
    hasUnresolvedTie: settled.has(r.teamId) ? false : (r.hasUnresolvedTie ?? false),
    tiedWith: settled.has(r.teamId) ? [] : (r.tiedWith ?? [])
  });

  const slots: Array<StandingRow | null> = new Array(rows.length).fill(null);
  for (const r of rows) {
    const want = pinBy.get(r.teamId);
    if (want != null && want >= 1 && want <= rows.length && slots[want - 1] === null) {
      slots[want - 1] = { ...clean(r), rank: want, locked: true };
    }
  }
  const taken = new Set(slots.filter((s): s is StandingRow => s != null).map(s => s.teamId));
  const rest = rows.filter(r => !taken.has(r.teamId));
  let k = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === null) {
      const nxt = rest[k++];
      if (!nxt) break;
      slots[i] = { ...clean(nxt), rank: i + 1, locked: false };
    }
  }
  return slots.filter((s): s is StandingRow => s != null);
}

export function manualPinsOf(standing: { rows?: StandingRow[] } | null | undefined): Array<{ teamId: string; rank: number }> {
  return (standing?.rows || [])
    .filter(r => r.locked === true && typeof r.rank === 'number')
    .map(r => ({ teamId: r.teamId, rank: r.rank as number }));
}

export type { Criterion };
