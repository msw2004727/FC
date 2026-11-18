/**
 * 積分榜計算。純函式，不呼叫 Date.now()。
 * standing id 維持 `${divisionId}__${stageId}__${groupId}`，不帶 competitionId。
 * 參數與輸出欄位的 eventId 改名為 competitionId。
 */

import type { MatchLike, RankingRule, StandingDoc, StandingRow, TallyOpts, TeamInfo } from './types.js';
import {
  DEFAULT_POINTS, DEFAULT_WALKOVER, WITHDRAWAL_POLICY,
  effectiveScore, isCompleted, tallyMatches
} from './tally.js';
import { applyManualRanking, fairPlayByTeam, manualPinsOf, pendingTieGroups, rankRows } from './ranking.js';

export { applyManualRanking, manualPinsOf };
export { DEFAULT_POINTS, DEFAULT_WALKOVER, WITHDRAWAL_POLICY, isCompleted, effectiveScore };

const FORM_LIMIT = 5;

function orderOf(order: StandingDoc['manualOverride']['order']): order is string[] {
  return Array.isArray(order) && order.length >= 2 && order.every(id => typeof id === 'string') && new Set(order).size === order.length;
}

function sameMembers(group: readonly string[], order: readonly string[]): boolean {
  return group.length === order.length && order.every(id => group.includes(id));
}

/** 撤銷裁定時寫回的空覆寫。多出來的鍵明示清掉，避免舊順序留在文件上。 */
export function clearedManualOverride(): StandingDoc['manualOverride'] {
  return { enabled: false, by: null, at: null, reason: null, method: null, order: null, decidedAt: null };
}

export interface TieDecisionView {
  active: boolean;
  method: 'host' | 'drawLots' | null;
  reason: string | null;
  decidedAt: unknown;
  order: string[];
  by: string | null;
}

/**
 * 積分榜上的裁定紀錄。沒有紀錄回 null。
 * 有傳 rows 時，active 還要這次名次真的套上（列上有 decidedBy）。
 * 沒傳 rows 時，active 只看 enabled 與 order。
 */
export function tieDecisionView(
  o: StandingDoc['manualOverride'] | null | undefined,
  rows?: Array<{ teamId?: string | null; decidedBy?: string | null }> | null
): TieDecisionView | null {
  if (!o) return null;
  const order = Array.isArray(o.order) ? o.order.filter((id): id is string => typeof id === 'string') : [];
  const method = o.method === 'host' || o.method === 'drawLots' ? o.method : null;
  const reason = typeof o.reason === 'string' && o.reason ? o.reason : null;
  const by = typeof o.by === 'string' && o.by ? o.by : null;
  const marked = !rows || order.every(id => {
    const row = rows.find(r => r.teamId === id);
    return row?.decidedBy === 'host' || row?.decidedBy === 'drawLots';
  });
  const active = o.enabled === true && order.length >= 2 && marked;
  if (o.enabled !== true && order.length === 0 && method == null && reason == null) return null;
  return { active, method, reason, decidedAt: o.decidedAt ?? o.at ?? null, order, by };
}

export function computeRows(
  teamIds: string[],
  matches: MatchLike[],
  rule: Pick<RankingRule, 'points'> | null | undefined,
  opts: TallyOpts = {}
): StandingRow[] {
  const tallyOpts: TallyOpts = { ...opts, points: { ...DEFAULT_POINTS, ...(rule?.points || {}) } };
  const { stats, countedMatchIds } = tallyMatches(teamIds, matches, tallyOpts);

  const cards = (opts.cardEvents || []).filter(c => c.matchId && countedMatchIds.has(c.matchId));
  const fp = fairPlayByTeam(cards, opts.fairPlay);

  const meta: Record<string, TeamInfo> = opts.teamMeta || {};
  const rows: StandingRow[] = [];
  for (const [teamId, st] of stats) {
    const f = fp.get(teamId) || { fairPlayPoints: 0, yellow: 0, red: 0 };
    const m = meta[teamId] || {};
    rows.push({
      teamId,
      name: m.name ?? null,
      abbr: m.abbr ?? null,
      logoUrl: m.logoUrl ?? null,
      seed: m.seed ?? null,
      played: st.played, win: st.win, draw: st.draw, loss: st.loss,
      goalsFor: st.goalsFor, goalsAgainst: st.goalsAgainst, goalDiff: st.goalDiff,
      points: st.points,
      yellow: f.yellow, red: f.red, fairPlayPoints: f.fairPlayPoints,
      form: st.form.slice(-FORM_LIMIT),
      tieBreakTrace: [],
      locked: false,
      note: ''
    });
  }
  return rows;
}

export function buildStanding({
  competitionId,
  divisionId,
  stageId,
  groupId,
  teamIds,
  matches,
  rule,
  opts = {},
  prev = null,
  manualPins = null
}: {
  competitionId: string;
  divisionId: string;
  stageId: string;
  groupId: string;
  teamIds: string[];
  matches: MatchLike[];
  rule: RankingRule;
  opts?: TallyOpts;
  prev?: { version?: number; manualOverride?: StandingDoc['manualOverride']; rows?: StandingRow[] } | null;
  manualPins?: Array<{ teamId: string; rank: number }> | null;
}): StandingDoc {
  const raw = computeRows(teamIds, matches, rule, opts);
  let { rows, hasUnresolvedTie } = rankRows(raw, matches, rule, opts);

  // 先複製再決定要不要套用，避免改到呼叫端手上的前一版。
  const manualOverride: StandingDoc['manualOverride'] = prev?.manualOverride
    ? { ...prev.manualOverride }
    : { enabled: false, by: null, at: null, reason: null };

  if (manualPins != null) {
    // 呼叫端明示釘名次（舊測試與舊路徑）。不在這裡判斷失效。
    if (manualPins.length) {
      rows = applyManualRanking(rows, manualPins);
      hasUnresolvedTie = rows.some(r => r.hasUnresolvedTie === true);
    }
  } else if (manualOverride.enabled && orderOf(manualOverride.order)) {
    const order = manualOverride.order as string[];
    const hit = pendingTieGroups(rows).find(g => sameMembers(g, order));
    const start = hit ? rows.find(r => r.teamId === hit[0])?.rank : undefined;
    if (hit && typeof start === 'number') {
      // 成員與目前待裁定群完全相同才套用。名次帶跟這群現在的起始名次走，可以整段上移或下移。
      rows = applyManualRanking(rows, order.map((teamId, i) => ({ teamId, rank: start + i })));
      const method: 'host' | 'drawLots' = manualOverride.method === 'drawLots' ? 'drawLots' : 'host';
      const set = new Set(order);
      rows = rows.map(r => (set.has(r.teamId) ? { ...r, decidedBy: method } : r));
      hasUnresolvedTie = rows.some(r => r.hasUnresolvedTie === true);
    }
    // 不再同分或成員變了：不套用。列是新算的，沒有 decidedBy。
    // 紀錄留在 manualOverride。之後若又是同一群人同分，會再套用。撤銷才把紀錄清掉。
  } else if (manualOverride.enabled) {
    // 舊資料沒有 order，仍用被鎖住的列撐過重算。
    const pins = manualPinsOf(prev);
    if (pins.length) {
      rows = applyManualRanking(rows, pins);
      hasUnresolvedTie = rows.some(r => r.hasUnresolvedTie === true);
    }
  }

  return {
    standingId: standingIdOf(divisionId, stageId, groupId),
    competitionId,
    divisionId,
    stageId,
    groupId,
    rows,
    computedBy: 'fn:recalcStanding',
    version: (prev?.version ?? 0) + 1,
    hasUnresolvedTie,
    manualOverride
  };
}

/** id 格式：`${divisionId}__${stageId}__${groupId}`，不含 competitionId。 */
export function standingIdOf(divisionId: string, stageId: string, groupId: string): string {
  return `${divisionId}__${stageId}__${groupId}`;
}

export function isStaleWrite(
  current: { version?: number } | null | undefined,
  incoming: { version?: number } | null | undefined
): boolean {
  if (!current) return false;
  return (incoming?.version ?? 0) <= (current.version ?? 0);
}

export function diffRanking(
  before: { rows?: Array<{ teamId: string; rank?: number }> } | null | undefined,
  after: { rows?: Array<{ teamId: string; rank?: number }> } | null | undefined
): { changed: boolean; movedTeamIds: string[]; removedTeamIds: string[]; addedTeamIds: string[] } {
  const b = new Map((before?.rows || []).map(r => [r.teamId, r.rank]));
  const a = new Map((after?.rows || []).map(r => [r.teamId, r.rank]));
  const moved = [...a.keys()].filter(id => b.has(id) && b.get(id) !== a.get(id));
  const removed = [...b.keys()].filter(id => !a.has(id));
  const added = [...a.keys()].filter(id => !b.has(id));
  return {
    changed: moved.length + removed.length + added.length > 0,
    movedTeamIds: moved.sort(),
    removedTeamIds: removed.sort(),
    addedTeamIds: added.sort()
  };
}
