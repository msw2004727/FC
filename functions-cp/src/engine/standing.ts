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
import { applyManualRanking, fairPlayByTeam, manualPinsOf, rankRows } from './ranking.js';

export { applyManualRanking, manualPinsOf };
export { DEFAULT_POINTS, DEFAULT_WALKOVER, WITHDRAWAL_POLICY, isCompleted, effectiveScore };

const FORM_LIMIT = 5;

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

  const manualOverride = prev?.manualOverride ?? { enabled: false, by: null, at: null, reason: null };
  const pins = manualPins ?? (manualOverride.enabled ? manualPinsOf(prev) : null);
  if (pins?.length) {
    rows = applyManualRanking(rows, pins);
    hasUnresolvedTie = rows.some(r => r.hasUnresolvedTie === true);
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
