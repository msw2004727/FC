/**
 * 個人獎項統計。
 * 只有射手榜是全自動；門將榜是系統排行加上人工評選。
 * MVP、運動精神獎、Team Award 一律人工，這裡不做。
 */

import type { FairPlayConfig, MatchLike, TeamInfo, TimelineEvent } from './types.js';
import { FAIR_PLAY, fairPlayByTeam } from './ranking.js';
import { tallyMatches } from './tally.js';

/** 計入射手榜的事件型別。烏龍球（own_goal）不計入射手。 */
export const SCORING_TYPES = ['goal', 'penalty_scored'] as const;

/** 只有這些狀態的場次才納入統計 */
const COUNTED_STATUSES = ['finished', 'confirmed', 'walkover'];

interface ScorerOpts {
  enabled?: boolean;
  countedMatchIds?: Set<string> | string[];
  playerMeta?: Record<string, {
    name?: string | null;
    teamId?: string | null;
    teamName?: string | null;
    jerseyNo?: number | null;
  }>;
  appearances?: Record<string, { matches?: number; minutes?: number | null }>;
}

interface ScorerRow {
  playerId: string;
  name: string | null;
  teamId: string | null;
  teamName: string | null;
  jerseyNo: number | null;
  goals: number;
  penalties: number;
  openPlay: number;
  matchesPlayed: number;
  minutesPlayed: number | null;
  rank?: number;
}

/**
 * 射手榜。
 * periodId === 'pk' 的罰球不計入個人進球。
 * 沒有 matchId 的事件，在有 countedMatchIds 時仍會計入（原行為，不在這裡改）。
 */
export function computeScorers(
  events: TimelineEvent[] | null | undefined,
  opts: ScorerOpts = {}
): ScorerRow[] {
  if (opts.enabled === false) return [];
  const only = opts.countedMatchIds ? new Set(opts.countedMatchIds) : null;

  const byPlayer = new Map<string, {
    playerId: string;
    goals: number;
    penalties: number;
    openPlay: number;
    matchIds: Set<string>;
  }>();

  for (const e of events || []) {
    if (!e || e.voided) continue;
    if (!SCORING_TYPES.includes(e.type as typeof SCORING_TYPES[number])) continue;
    // goalType 'own' 也要擋，否則烏龍球會混進射手榜
    if (e.goalType === 'own') continue;
    // PK 大戰的罰球不計入個人進球。它跟比賽中的罰球是同一個事件型別，只差在期別。
    if (e.periodId === 'pk') continue;
    if (!e.playerId) continue;
    if (only && e.matchId && !only.has(e.matchId)) continue;

    let p = byPlayer.get(e.playerId);
    if (!p) {
      p = { playerId: e.playerId, goals: 0, penalties: 0, openPlay: 0, matchIds: new Set() };
      byPlayer.set(e.playerId, p);
    }
    p.goals += 1;
    if (e.type === 'penalty_scored' || e.goalType === 'penalty') p.penalties += 1;
    else p.openPlay += 1;
    if (e.matchId) p.matchIds.add(e.matchId);
  }

  const meta = opts.playerMeta || {};
  const app = opts.appearances || {};

  const rows: ScorerRow[] = [...byPlayer.values()].map(p => {
    const m = meta[p.playerId] || {};
    const a = app[p.playerId] || {};
    return {
      playerId: p.playerId,
      name: m.name ?? null,
      teamId: m.teamId ?? null,
      teamName: m.teamName ?? null,
      jerseyNo: m.jerseyNo ?? null,
      goals: p.goals,
      penalties: p.penalties,
      openPlay: p.openPlay,
      // 同分判定：出賽場次少者優先 → 上場時間少者優先（缺資料時以進球場次數代替）
      matchesPlayed: a.matches ?? p.matchIds.size,
      minutesPlayed: a.minutes ?? null
    };
  });

  rows.sort(compareScorers);
  return assignRanks(rows, (a, b) => compareScorers(a, b) === 0);
}

function compareScorers(a: ScorerRow, b: ScorerRow): number {
  if (b.goals !== a.goals) return b.goals - a.goals;
  if (a.matchesPlayed !== b.matchesPlayed) return a.matchesPlayed - b.matchesPlayed;
  const am = a.minutesPlayed ?? Number.MAX_SAFE_INTEGER;
  const bm = b.minutesPlayed ?? Number.MAX_SAFE_INTEGER;
  if (am !== bm) return am - bm;
  return 0;
}

interface KeeperRow {
  playerId: string;
  matches: number;
  minutes: number;
  goalsAgainst: number;
  cleanSheets: number;
  name: string | null;
  teamName: string | null;
  goalsAgainstPerMatch: number;
  rank?: number;
}

/**
 * 門將榜（半自動）：失球數 ÷ 上場場次，越低越好。
 * 沒有 GK 上場紀錄的球員不列入。
 */
export function computeGoalkeepers(
  keeperAppearances: Array<{ playerId?: string; matchId?: string; teamId?: string; minutes?: number }> | null | undefined,
  concededByMatchTeam: Record<string, { goalsAgainst?: number }> | null | undefined,
  opts: {
    playerMeta?: Record<string, { name?: string | null; teamName?: string | null }>;
    minMatches?: number;
  } = {}
): KeeperRow[] {
  const minMatches = opts.minMatches ?? 2;
  const byPlayer = new Map<string, {
    playerId: string;
    matches: number;
    minutes: number;
    goalsAgainst: number;
    cleanSheets: number;
  }>();

  for (const a of keeperAppearances || []) {
    if (!a?.playerId || !a.matchId) continue;
    let p = byPlayer.get(a.playerId);
    if (!p) {
      p = { playerId: a.playerId, matches: 0, minutes: 0, goalsAgainst: 0, cleanSheets: 0 };
      byPlayer.set(a.playerId, p);
    }
    const conceded = concededByMatchTeam?.[`${a.matchId}__${a.teamId}`]?.goalsAgainst ?? 0;
    p.matches += 1;
    p.minutes += a.minutes ?? 0;
    p.goalsAgainst += conceded;
    if (conceded === 0) p.cleanSheets += 1;
  }

  const meta = opts.playerMeta || {};
  const rows: KeeperRow[] = [...byPlayer.values()]
    .filter(p => p.matches >= minMatches)
    .map(p => ({
      ...p,
      name: meta[p.playerId]?.name ?? null,
      teamName: meta[p.playerId]?.teamName ?? null,
      goalsAgainstPerMatch: round2(p.goalsAgainst / p.matches)
    }));

  rows.sort((a, b) =>
    a.goalsAgainstPerMatch - b.goalsAgainstPerMatch ||
    b.cleanSheets - a.cleanSheets ||
    b.matches - a.matches);

  return assignRanks(rows, (a, b) =>
    a.goalsAgainstPerMatch === b.goalsAgainstPerMatch && a.cleanSheets === b.cleanSheets);
}

interface FairPlayBoardRow {
  teamId: string;
  name: string;
  divisionId?: string;
  fairPlayPoints: number;
  yellow: number;
  red: number;
  secondYellow: number;
  played: number;
  rank?: number;
}

/**
 * 紅黃牌統計：從有效完賽場次累計。
 * fairPlay 預設 FAIR_PLAY，賽事可整包覆寫。
 */
export function computeFairPlayBoard({
  matches = [],
  cardEvents = [],
  teams = {},
  withdrawalPolicy,
  fairPlay = FAIR_PLAY
}: {
  matches?: MatchLike[];
  cardEvents?: TimelineEvent[];
  teams?: Record<string, TeamInfo>;
  withdrawalPolicy?: string;
  fairPlay?: FairPlayConfig;
} = {}): FairPlayBoardRow[] {
  const counted = countedMatchIdsOf(matches, { teams, withdrawalPolicy });
  const byMatch = new Map<string, Set<string>>();
  const byTeam = new Map<string, FairPlayBoardRow>();
  for (const m of matches) {
    const ids = [m.home?.teamId, m.away?.teamId];
    if (!m.matchId || !counted.has(m.matchId) || byMatch.has(m.matchId)) continue;
    if (ids.some(id => !id || !teams[id]) || ids[0] === ids[1]) continue;
    const homeId = ids[0];
    const awayId = ids[1];
    if (!homeId || !awayId) continue;
    byMatch.set(m.matchId, new Set([homeId, awayId]));
    for (const teamId of [homeId, awayId]) {
      const key = `${m.divisionId}|${teamId}`;
      const team = teams[teamId];
      if (!team) continue;
      if (!byTeam.has(key)) {
        byTeam.set(key, {
          teamId,
          name: team.name || team.shortName || teamId,
          divisionId: m.divisionId,
          fairPlayPoints: 0,
          yellow: 0,
          red: 0,
          secondYellow: 0,
          played: 0
        });
      }
      const row = byTeam.get(key);
      if (row) row.played += 1;
    }
  }
  for (const row of byTeam.values()) {
    const cards = cardEvents.filter(c => c?.type === 'card' && !c.voided && c.teamId === row.teamId
      && byMatch.get(c.matchId ?? '')?.has(c.teamId)
      && matches.some(m => m.matchId === c.matchId && m.divisionId === row.divisionId));
    const score = fairPlayByTeam(cards, fairPlay).get(row.teamId);
    if (score) {
      row.secondYellow = cards.filter(c => c.cardType === 'second_yellow').length;
      row.yellow = score.yellow + row.secondYellow; // 牌數含第二黃；扣分仍沿用 −3 的合併規則。
      row.red = score.red;
      row.fairPlayPoints = score.fairPlayPoints;
    }
  }
  const rows = [...byTeam.values()];
  rows.sort((a, b) => b.fairPlayPoints - a.fairPlayPoints || a.yellow - b.yellow);
  return assignRanks(rows, (a, b) => a.fairPlayPoints === b.fairPlayPoints && a.yellow === b.yellow);
}

/** 並列時給同一個名次，下一個名次跳號（1,2,2,4） */
function assignRanks<T extends { rank?: number }>(rows: T[], isTie: (a: T, b: T) => boolean): T[] {
  let rank = 0;
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (i === 0 || !prev || !isTie(prev, r)) rank = i + 1;
    r.rank = rank;
  });
  return rows;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 只納入已完賽場次，供呼叫端先篩一輪 */
export function countedMatchIdsOf(
  matches: MatchLike[] | null | undefined,
  opts?: { teams?: Record<string, TeamInfo>; withdrawalPolicy?: string }
): Set<string> {
  const completed = (matches || []).filter(m => COUNTED_STATUSES.includes(m.status ?? ''));
  if (!opts?.teams) return new Set(completed.map(m => m.matchId).filter((id): id is string => !!id));
  // 與積分引擎共用有效比分、棄賽及退賽作廢判定，避免兩種統計各算各的。
  return tallyMatches(Object.keys(opts.teams), completed, {
    onlyBetweenTeams: true,
    withdrawalPolicy: opts.withdrawalPolicy,
    withdrawnTeamIds: Object.entries(opts.teams).filter(([, t]) => t.withdrawn === true).map(([id]) => id)
  }).countedMatchIds;
}
