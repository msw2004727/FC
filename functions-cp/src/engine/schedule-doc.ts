/** 賽程計畫與比賽文件形狀。純函式，不寫 Firestore。 */
import { buildGroups, buildMatches } from './schedule.js';
import type { Format, MatchLike, TeamRef } from './types.js';

interface DivisionLike {
  divisionId?: string;
  code?: string;
  date?: string | null;
  groupNames?: Record<string, string>;
}

interface OrderedTeam {
  teamId: string;
  name?: string | null;
  shortName?: string | null;
  abbr?: string | null;
  logoUrl?: string | null;
  colors?: { primary?: string | null } | null;
}

export function planGeneration({
  division,
  orderedTeams,
  format
}: {
  division: DivisionLike;
  orderedTeams: OrderedTeam[];
  format: Format;
}) {
  const rr = (format?.stages ?? []).find(s => s.type === 'roundRobin');
  const groups = buildGroups(orderedTeams, rr?.groupCount ?? 1);
  const { stages, groups: groupDocs, matches, groupAssign } =
    buildMatches({ division, format, groups });

  return {
    stages,
    groupDocs,
    matches,
    groups,
    assignments: orderedTeams.map((t, i) => ({
      teamId: t.teamId,
      seed: i + 1,
      groupId: groupAssign[t.teamId] ?? null
    }))
  };
}

/**
 * 完整的場次文件（新產生的場次）。
 * 多賽事：原 eventId 參數與輸出欄位改名 competitionId。
 */
export function matchDocOf({
  m,
  division,
  competitionId,
  matchNo = null,
  venueName = null
}: {
  m: MatchLike & { home: TeamRef; away: TeamRef };
  division: { date?: string | null };
  competitionId: string;
  matchNo?: number | null;
  venueName?: string | null;
}) {
  return {
    matchId: m.matchId,
    competitionId,
    divisionId: m.divisionId,
    stageId: m.stageId,
    groupId: m.groupId,
    round: m.round,
    matchNo,
    label: m.label,
    matchKey: m.matchKey ?? null,
    date: division.date ?? null,
    kickoffAt: m.kickoffMs != null ? new Date(m.kickoffMs) : null,
    venueId: m.venueId ?? null,
    venueName,
    home: m.home,
    away: m.away,
    teamIds: m.teamIds ?? [],
    score: { home: 0, away: 0 },
    htScore: { home: 0, away: 0 },
    penaltyScore: { home: null, away: null },
    status: 'scheduled',
    period: 'pre',
    clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 0, addedTimeSec: 0 },
    result: { winner: null, method: null, homePoints: 0, awayPoints: 0 },
    walkoverSide: null,
    walkoverReason: null,
    officials: { referee: null, assistants: [], scorer: null },
    stream: { enabled: false, provider: 'youtube', videoId: null, startOffsetSec: 0, status: 'off' },
    checkin: { homeConfirmed: false, awayConfirmed: false, confirmedAt: null },
    lock: { locked: false, lockedAt: null, lockedBy: null },
    scoreMismatch: false,
    revisionCount: 0
  };
}
