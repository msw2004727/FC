/**
 * 賽事引擎共用型別。
 * 時間欄位在邊界先用 toMillis 收斂，這裡保留 unknown。
 */

export interface Score {
  home: number | null;
  away: number | null;
}

export interface TeamRef {
  teamId: string | null;
  name?: string | null;
  abbr?: string | null;
  logoUrl?: string | null;
  colorPrimary?: string | null;
  placeholder?: TeamSource | null;
  displayName?: string | null;
}

export type TeamSource =
  | { type: 'standing'; stageId: string; groupId: string; rank: number }
  | { type: 'matchWinner'; matchKey: string }
  | { type: 'matchLoser'; matchKey: string }
  | { type: 'fixed'; teamId: string }
  | { type: 'seed'; rank: number };

export interface Slot {
  matchKey: string;
  label: string;
  home: TeamSource;
  away: TeamSource;
  round?: number;
}

export type DrawRule = 'none' | 'penalty' | 'goldenGoal';
export type StageType = 'roundRobin' | 'knockout';
export type SeedingMethod = 'snake' | 'manual' | 'random';

export interface Stage {
  stageId: string;
  name: string;
  type: StageType;
  order: number;
  groupCount?: number;
  groupSize?: number;
  legs?: 1 | 2;
  seedingMethod?: SeedingMethod;
  slots?: Slot[];
  thirdPlaceMatch?: boolean;
  drawRule?: DrawRule;
}

export interface RankSource {
  rank: number;
  from: TeamSource;
}

export interface Format {
  formatId: string;
  name: string;
  teamCount: number;
  description: string;
  stages: Stage[];
  finalRankingMap: RankSource[];
  groupNames?: Record<string, string>;
  matchNames?: Record<string, string>;
  generated?: boolean;
}

export type Criterion =
  | 'points'
  | 'headToHeadPoints'
  | 'headToHeadGoalDiff'
  | 'headToHeadGoalsFor'
  | 'headToHeadWins'
  | 'goalDiff'
  | 'goalsFor'
  | 'goalsAgainstAsc'
  | 'wins'
  | 'fairPlay'
  | 'seed'
  | 'drawLots'
  | 'manual';

export interface FairPlayConfig {
  yellow: number;
  secondYellow: number;
  directRed: number;
  yellowThenRed: number;
}

export interface PointsRule {
  win: number;
  draw: number;
  loss: number;
}

export interface RankingRule {
  rankingRuleId: string;
  name: string;
  points: PointsRule;
  criteria: Criterion[];
  fairPlay: FairPlayConfig;
}

export interface WalkoverConfig {
  scoreFor: number;
  scoreAgainst: number;
  awardPoints: number;
  penaltyPoints: number;
  countInGoalStats: boolean;
}

export interface MercyRule {
  enabled: boolean;
  cap?: number;
}

export type WithdrawalPolicy = 'voidAll' | 'keepAsWalkover';

export interface ClockState {
  running: boolean;
  periodStartedAt: unknown;
  elapsedSecAtPause: number;
  addedTimeSec?: number;
  periodId?: string | null;
}

export interface TimelineEvent {
  matchId?: string;
  seq?: number;
  type?: string;
  periodId?: string;
  clockSec?: number;
  minute?: number;
  side?: string | null;
  teamId?: string | null;
  playerId?: string | null;
  playerName?: string | null;
  jerseyNo?: number | null;
  cardType?: string;
  goalType?: string;
  voided?: boolean;
  voidedBy?: string | null;
  voidedAt?: unknown;
  voidReason?: string | null;
  note?: string;
  assistPlayerId?: string | null;
  subInPlayerId?: string | null;
  subInPlayerName?: string | null;
  subInJerseyNo?: number | null;
  createdBy?: string;
  divisionId?: string;
}

export interface MatchResult {
  winner: 'home' | 'away' | 'draw' | null;
  method: 'regulation' | 'penalty' | 'walkover' | null;
  homePoints: number;
  awayPoints: number;
}

export interface MatchLike {
  matchId?: string;
  competitionId?: string;
  divisionId?: string;
  stageId?: string;
  groupId?: string | null;
  round?: number;
  matchNo?: number | null;
  label?: string | null;
  matchKey?: string | null;
  date?: string | null;
  kickoffAt?: unknown;
  kickoffMs?: number | null;
  venueId?: string | null;
  venueName?: string | null;
  home?: TeamRef | null;
  away?: TeamRef | null;
  teamIds?: string[];
  score?: Partial<Score> | null;
  htScore?: Partial<Score> | null;
  penaltyScore?: Partial<Score> | null;
  status?: string;
  period?: string;
  clock?: ClockState | null;
  result?: Partial<MatchResult> | null;
  walkoverSide?: string | null;
  walkoverReason?: string | null;
  lock?: { locked?: boolean; lockedAt?: unknown; lockedBy?: string | null } | null;
  scoreMismatch?: boolean;
  revisionCount?: number;
  resetRevision?: number;
  managementRevision?: number;
  scoreSubmittedAt?: unknown;
  scoreSubmittedBy?: string | null;
  _sortKey?: number[];
}

/** 排序追蹤的一步（字串，例如 `pts=7`、`decided@headToHeadPoints`）。 */
export type TieBreakStep = string;

export interface StandingRow {
  teamId: string;
  name?: string | null;
  abbr?: string | null;
  logoUrl?: string | null;
  seed?: number | null;
  played: number;
  win: number;
  draw: number;
  loss: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  yellow?: number;
  red?: number;
  fairPlayPoints?: number;
  form?: string[];
  tieBreakTrace: TieBreakStep[];
  locked?: boolean;
  note?: string;
  rank?: number;
  hasUnresolvedTie?: boolean;
  tiedWith?: string[];
}

export interface ManualOverride {
  enabled: boolean;
  by: string | null;
  at: unknown;
  reason: string | null;
}

export interface StandingDoc {
  standingId: string;
  competitionId: string;
  divisionId: string;
  stageId: string;
  groupId: string;
  rows: StandingRow[];
  computedBy: string;
  version: number;
  hasUnresolvedTie: boolean;
  manualOverride: ManualOverride;
}

/** 晉級／排名讀到的積分榜。列可以只有 teamId 與 rank。 */
export interface StandingView {
  standingId?: string;
  competitionId?: string;
  divisionId?: string;
  stageId?: string;
  groupId?: string;
  rows?: Array<{ teamId?: string | null; rank?: number; name?: string | null }>;
  hasUnresolvedTie?: boolean;
  version?: number;
  manualOverride?: ManualOverride | null;
}

export interface TeamInfo {
  teamId?: string;
  name?: string | null;
  shortName?: string | null;
  abbr?: string | null;
  logoUrl?: string | null;
  colors?: { primary?: string | null } | null;
  seed?: number | null;
  withdrawn?: boolean;
}

export interface AdvanceCtx {
  divisionId: string;
  standings?: Record<string, StandingView>;
  matchesByKey?: Record<string, MatchLike>;
  teams?: Record<string, TeamInfo>;
  stageMatches?: Record<string, MatchLike[] | undefined>;
  /** 種子序的 teamId。第 1 種子在 index 0。純淘汰的 `{ type: 'seed' }` 靠這份名單解算。 */
  seeds?: string[];
}

export interface TallyOpts {
  points?: Partial<PointsRule>;
  walkover?: Partial<WalkoverConfig>;
  mercyRule?: MercyRule | null;
  withdrawnTeamIds?: string[];
  withdrawalPolicy?: string;
  onlyBetweenTeams?: boolean;
  fairPlay?: FairPlayConfig;
  cardEvents?: TimelineEvent[];
  teamMeta?: Record<string, TeamInfo>;
}

export type CompetitionPhaseName =
  | 'draft'
  | 'cancelled'
  | 'postponed'
  | 'ended'
  | 'recruiting'
  | 'warmup'
  | 'live';

export interface CompetitionDoc {
  status?: string;
  regOpenAt?: unknown;
  regCloseAt?: unknown;
  firstMatchAt?: unknown;
  lastMatchAt?: unknown;
  endedAt?: unknown;
  endedBy?: unknown;
}

export interface CompetitionPhase {
  phase: CompetitionPhaseName;
  regOpen: boolean;
  scorePending: boolean;
  autoEndDue: boolean;
}

export interface Division {
  divisionId: string;
  name: string;
  shortName: string;
  officialName: string;
  date: string;
  teamCount: number;
  playersOnField: number;
  matchDurationMin: number;
  periods: number;
  ballSize: number;
  eligibility: { bornOnOrAfter: string | null; note: string };
  formatId: string;
  rankingRuleId: string;
  colorToken: string;
  order: number;
  code: string;
  stats?: { scorers: boolean };
  display: { mercyRule: MercyRule; scorerBoard: boolean };
  requiredFormatId: string;
  groupNames: Record<string, string>;
}
