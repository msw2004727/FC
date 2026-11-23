/**
 * 場次統計原語。
 * standing 與 ranking 的迷你對戰表共用，避免循環相依。
 * 純函式：同樣的輸入永遠得到同樣的輸出。
 */

import type { MatchLike, PointsRule, TallyOpts, WalkoverConfig } from './types.js';

/** 納入統計的場次狀態。其餘狀態（含 postponed / cancelled）一律略過。 */
export const COMPLETED_STATUSES = ['finished', 'confirmed', 'walkover'];

export const DEFAULT_POINTS: PointsRule = { win: 3, draw: 1, loss: 0 };

/**
 * 棄賽判定。scoreFor/scoreAgainst 只在 countInGoalStats 為真時計入得失球。
 * 規章是棄權 0:2（勝方 2、負方 0），不是常見的 3:0。
 */
export const DEFAULT_WALKOVER: WalkoverConfig = {
  scoreFor: 2,
  scoreAgainst: 0,
  awardPoints: 3,
  penaltyPoints: 0,
  countInGoalStats: true
};

function strictNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 整隊退賽。voidAll 為預設。 */
export const WITHDRAWAL_POLICY = { VOID_ALL: 'voidAll', KEEP_AS_WALKOVER: 'keepAsWalkover' } as const;

export interface TeamStat {
  teamId: string;
  played: number;
  win: number;
  draw: number;
  loss: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  form: Array<'W' | 'D' | 'L'>;
}

export function emptyStat(teamId: string): TeamStat {
  return {
    teamId,
    played: 0, win: 0, draw: 0, loss: 0,
    goalsFor: 0, goalsAgainst: 0, goalDiff: 0,
    points: 0,
    form: []
  };
}

export function isCompleted(m: MatchLike | null | undefined): boolean {
  return COMPLETED_STATUSES.includes(m?.status ?? '');
}

export interface EffectiveScore {
  home: number;
  away: number;
  diff: number;
  countGoals: boolean;
  isWalkover: boolean;
  winSide: 'home' | 'away' | null;
  points: { home: number; away: number } | null;
}

/**
 * 計入積分榜的比分。棄賽改用判定比分；仁慈規則只壓每場 goalDiff；
 * PK 決勝的正規時間比分仍視為平手。
 */
export function effectiveScore(m: MatchLike, opts: TallyOpts = {}): EffectiveScore | null {
  if (!isCompleted(m)) return null;

  const wo: WalkoverConfig = { ...DEFAULT_WALKOVER, ...(opts.walkover || {}) };

  if (m.status === 'walkover') {
    const forfeit = m.walkoverSide;
    if (forfeit !== 'home' && forfeit !== 'away') return null;
    return walkoverScore(forfeit, wo);
  }

  const raw = m.score || {};
  const home = strictNum(raw.home);
  const away = strictNum(raw.away);
  if (home === null || away === null) return null;

  let diff = home - away;
  const mercy = opts.mercyRule;
  if (mercy?.enabled) {
    const cap = Math.max(1, Math.trunc(mercy.cap ?? 7));
    diff = Math.max(-cap, Math.min(cap, diff));
  }

  return {
    home, away, diff,
    countGoals: true,
    isWalkover: false,
    winSide: null,
    points: null
  };
}

function walkoverScore(forfeitSide: 'home' | 'away', wo: WalkoverConfig): EffectiveScore {
  const winFor = forfeitSide === 'home' ? 'away' : 'home';
  const home = winFor === 'home' ? wo.scoreFor : wo.scoreAgainst;
  const away = winFor === 'away' ? wo.scoreFor : wo.scoreAgainst;
  return {
    home, away,
    diff: home - away,
    countGoals: wo.countInGoalStats,
    isWalkover: true,
    winSide: winFor,
    points: {
      home: winFor === 'home' ? wo.awardPoints : wo.penaltyPoints,
      away: winFor === 'away' ? wo.awardPoints : wo.penaltyPoints
    }
  };
}

export function tallyMatches(
  teamIds: string[],
  matches: MatchLike[],
  opts: TallyOpts = {}
): { stats: Map<string, TeamStat>; countedMatchIds: Set<string> } {
  const pts: PointsRule = { ...DEFAULT_POINTS, ...(opts.points || {}) };
  const withdrawn = new Set(opts.withdrawnTeamIds || []);
  const policy = opts.withdrawalPolicy || WITHDRAWAL_POLICY.VOID_ALL;
  const voidWithdrawn = policy === WITHDRAWAL_POLICY.VOID_ALL;

  const pool = new Set(teamIds);
  const stats = new Map<string, TeamStat>();
  for (const id of teamIds) {
    if (voidWithdrawn && withdrawn.has(id)) continue;
    stats.set(id, emptyStat(id));
  }

  const ordered = [...matches].sort(compareByKickoff);
  const counted = new Set<string>();

  for (const m of ordered) {
    const h = m.home?.teamId;
    const a = m.away?.teamId;
    if (!h || !a) continue;

    if (voidWithdrawn && (withdrawn.has(h) || withdrawn.has(a))) continue;

    const homeIn = pool.has(h) && stats.has(h);
    const awayIn = pool.has(a) && stats.has(a);
    if (!homeIn && !awayIn) continue;
    if (opts.onlyBetweenTeams && !(homeIn && awayIn)) continue;

    let sc = effectiveScore(m, opts);

    if (!sc && !voidWithdrawn && !isCompleted(m)) {
      const forfeit = withdrawn.has(h) ? 'home' : withdrawn.has(a) ? 'away' : null;
      if (forfeit) sc = walkoverScore(forfeit, { ...DEFAULT_WALKOVER, ...(opts.walkover || {}) });
    }
    if (!sc) continue;

    if (m.matchId) counted.add(m.matchId);
    if (homeIn) applyOne(stats.get(h) as TeamStat, 'home', sc, pts);
    if (awayIn) applyOne(stats.get(a) as TeamStat, 'away', sc, pts);
  }

  return { stats, countedMatchIds: counted };
}

function applyOne(st: TeamStat, side: 'home' | 'away', sc: EffectiveScore, pts: PointsRule): void {
  const other = side === 'home' ? 'away' : 'home';
  const gf = sc[side];
  const ga = sc[other];

  st.played += 1;
  if (sc.countGoals) {
    st.goalsFor += gf;
    st.goalsAgainst += ga;
    st.goalDiff += side === 'home' ? sc.diff : -sc.diff;
  }

  const outcome = sc.winSide
    ? (sc.winSide === side ? 'W' : 'L')
    : gf > ga ? 'W' : gf < ga ? 'L' : 'D';

  if (outcome === 'W') st.win += 1;
  else if (outcome === 'L') st.loss += 1;
  else st.draw += 1;
  st.form.push(outcome);

  const forced = sc.points?.[side];
  st.points += typeof forced === 'number'
    ? forced
    : outcome === 'W' ? pts.win : outcome === 'L' ? pts.loss : pts.draw;
}

/** 開賽時間排序；缺欄位時用 matchId 保證穩定。缺值排到最後。 */
export function compareByKickoff(x: MatchLike, y: MatchLike): number {
  const tx = kickoffSortKey(x.kickoffAt);
  const ty = kickoffSortKey(y.kickoffAt);
  if (tx !== ty) return tx - ty;
  return String(x.matchId || '').localeCompare(String(y.matchId || ''));
}

function kickoffSortKey(v: unknown): number {
  if (v == null) return Number.MAX_SAFE_INTEGER;
  if (typeof v === 'object' && v !== null && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}
