/**
 * 賽事引擎公開 API。
 * 名稱撞車時改別名：行為分以 ranking 的 FAIR_PLAY 為準，formats 的同名常數叫 FORMAT_FAIR_PLAY。
 * 射手榜的 SCORING_TYPES 不含烏龍；賽務台那份含 own_goal，叫 LIVE_SCORING_TYPES。
 */

export * from './berger.js';
export * from './group-name.js';
export * from './result.js';
export * from './timeline.js';
export * from './clock.js';
export * from './phase.js';
export * from './match-clock.js';
export * from './tally.js';
export * from './rules.js';
export * from './ranking.js';
export * from './util.js';

export {
  computeRows,
  buildStanding,
  standingIdOf,
  isStaleWrite,
  diffRanking,
  clearedManualOverride,
  tieDecisionView
} from './standing.js';
export type { TieDecisionView } from './standing.js';

export {
  FORMATS,
  FORMAT_TEMPLATES,
  RANKING_RULES,
  DIVISIONS,
  FAIR_PLAY as FORMAT_FAIR_PLAY,
  STAGE_CODE,
  REGISTRATION_LIMITS,
  APPEAL_RULES,
  REFUND_RULES,
  buildRoundRobinFormat,
  buildKnockoutFormat,
  buildGroupKnockoutFormat
} from './formats.js';

export {
  SCHEDULE_DEFAULTS,
  taipeiMs,
  drawOrder,
  buildGroups,
  pickFormatFor,
  genericFormat,
  teamRefOf,
  placeholderRefOf,
  buildMatches,
  sortByStructure,
  slotSpanMin,
  fieldFits,
  placeMatches,
  shiftMatches,
  kickoffMsOf,
  assignMatchNos,
  checkSchedule
} from './schedule.js';

export { civilYmd, matchDayOf, matchDayWindow, scheduleDayWindow } from './match-day.js';
export type { ScheduleDayWindow } from './match-day.js';

export { planGeneration, matchDocOf } from './schedule-doc.js';

export {
  resolveTeamSource,
  explainTeamSource,
  describeTeamSource,
  isSlotWritable,
  resolveStage,
  canResolve,
  computeFinalRanking
} from './advancement.js';

export {
  SCORING_TYPES,
  computeScorers,
  computeGoalkeepers,
  computeFairPlayBoard,
  countedMatchIdsOf
} from './awards.js';

export {
  SCORING_TYPES as LIVE_SCORING_TYPES,
  nextSeq,
  consistencyCheck,
  buildGoalEvent,
  buildCardEvent,
  buildSubEvent,
  buildPeriodEvent,
  buildNoteEvent,
  cardsOf,
  suggestCardType,
  sentOffPlayerIds,
  onFieldCount,
  matchFairPlay,
  subCount,
  checkSubLimit,
  buildFinishPatch,
  UNDO_WINDOW_SEC,
  SHEET_ROLES,
  isPlayerRow,
  onFieldIds,
  sortRosterForMatch,
  undoState,
  buildUndoPatch,
  finishSummary,
  sortEventsDesc,
  EVENT_ICON,
  eventText,
  CARD_LABEL,
  ROSTER_ROLE_TEXT
} from './live-actions.js';

export {
  affectedByMatchChange,
  refreshAfterMatchChange
} from './incremental.js';

export {
  CONFIG_MESSAGE_KEYS,
  validateCompetitionConfig
} from './validate-config.js';

export { previewSchedule } from './preview.js';

export type {
  AffectedMatch,
  MatchChangeEffect,
  RefreshIo,
  RefreshResult
} from './incremental.js';

export type {
  CompetitionConfig,
  ConfigIssue,
  ConfigValidation,
  DivisionConfig,
  FormatConfig
} from './validate-config.js';

export type {
  PreviewFormatSpec,
  PreviewIssue,
  PreviewSchedule,
  PreviewScheduleInput
} from './preview.js';

export type * from './types.js';
