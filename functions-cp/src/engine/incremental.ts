/**
 * 一場比賽改變之後，只重算受影響的積分榜與下游晉級 slot。
 * 文件數是觸發器應讀寫的估計，函式本身不連 Firestore。
 */

import { computeFairPlayBoard, computeScorers } from './awards.js';
import { resolveStage, type StageBlock, type StageUpdate } from './advancement.js';
import { buildStanding, standingIdOf } from './standing.js';
import type {
  AdvanceCtx, Format, MatchLike, RankingRule, StandingDoc, TallyOpts, TeamInfo, TeamSource, TimelineEvent
} from './types.js';

const BOARD_STATUSES = new Set(['finished', 'confirmed', 'walkover']);

export interface AffectedMatch {
  divisionId: string;
  stageId?: string | null;
  groupId?: string | null;
  matchKey?: string | null;
  status?: string | null;
}

export interface MatchChangeEffect {
  standingIds: string[];
  stageIds: string[];
  needScorers: boolean;
}

export interface RefreshIo {
  matchReads: number;
  standingReads: number;
  standingWrites: number;
  slotMatchReads: number;
  slotMatchWrites: number;
  eventReads: number;
  awardWrites: number;
}

export interface RefreshResult {
  affected: MatchChangeEffect;
  standings: StandingDoc[];
  resolutions: Array<{
    stageId: string;
    updates: StageUpdate[];
    blocked: StageBlock[];
    resolvedCount: number;
    allResolved: boolean;
  }>;
  slotMatchKeys: string[];
  scorers?: ReturnType<typeof computeScorers>;
  fairPlay?: ReturnType<typeof computeFairPlayBoard>;
  io: RefreshIo;
}

function sourceHits(
  src: TeamSource | null | undefined,
  divisionId: string,
  standingIds: Set<string>,
  keys: Set<string>,
  changedKey: string | null
): boolean {
  if (!src) return false;
  if (src.type === 'standing') {
    return standingIds.has(standingIdOf(divisionId, src.stageId, src.groupId));
  }
  if (src.type === 'matchWinner' || src.type === 'matchLoser') {
    return src.matchKey === changedKey || keys.has(src.matchKey);
  }
  return false;
}

function affectedSlotKeys(
  format: Format | null | undefined,
  divisionId: string,
  standingIds: string[],
  changedKey: string | null
): string[] {
  const standingSet = new Set(standingIds);
  const keys = new Set<string>();
  const slots = (format?.stages ?? []).flatMap(stage => stage.slots ?? []);
  let grew = true;
  while (grew) {
    grew = false;
    for (const slot of slots) {
      if (keys.has(slot.matchKey)) continue;
      if (sourceHits(slot.home, divisionId, standingSet, keys, changedKey)
        || sourceHits(slot.away, divisionId, standingSet, keys, changedKey)) {
        keys.add(slot.matchKey);
        grew = true;
      }
    }
  }
  return [...keys];
}

/**
 * 一場比賽改變後要重算的範圍。
 * `eventsChanged` 預設 true。純比分更正（進球與牌沒變）傳 false，射手榜不用重算。
 * 射手榜只吃已完賽場次的事件，live／postponed 不會把 needScorers 設成 true。
 */
export function affectedByMatchChange(
  format: Format | null | undefined,
  match: AffectedMatch,
  opts: { eventsChanged?: boolean } = {}
): MatchChangeEffect {
  const eventsChanged = opts.eventsChanged !== false;
  const stage = (format?.stages ?? []).find(s => s.stageId === match.stageId)
    ?? (match.groupId ? (format?.stages ?? []).find(s => s.type === 'roundRobin') : undefined);
  const standingIds: string[] = [];
  if (stage?.type === 'roundRobin' && match.groupId && match.divisionId) {
    standingIds.push(standingIdOf(match.divisionId, stage.stageId, match.groupId));
  }
  const slotMatchKeys = affectedSlotKeys(format, match.divisionId, standingIds, match.matchKey ?? null);
  const keySet = new Set(slotMatchKeys);
  const stageIds: string[] = [];
  for (const item of format?.stages ?? []) {
    if (item.slots?.some(slot => keySet.has(slot.matchKey))) stageIds.push(item.stageId);
  }
  return {
    standingIds,
    stageIds,
    needScorers: eventsChanged && BOARD_STATUSES.has(match.status ?? '')
  };
}

export function refreshAfterMatchChange({
  format,
  match,
  groups,
  matches,
  rule,
  opts,
  standings = {},
  prevStandings = {},
  teams = {},
  events,
  eventsChanged,
  competitionId = '',
  stageMatches
}: {
  format: Format;
  match: AffectedMatch;
  groups: Array<{ groupId: string; teamIds: string[] }>;
  matches: MatchLike[];
  rule: RankingRule;
  opts?: TallyOpts;
  standings?: AdvanceCtx['standings'];
  prevStandings?: Record<string, { version?: number; manualOverride?: StandingDoc['manualOverride']; rows?: StandingDoc['rows'] }>;
  teams?: Record<string, TeamInfo>;
  events?: TimelineEvent[];
  eventsChanged?: boolean;
  competitionId?: string;
  stageMatches?: AdvanceCtx['stageMatches'];
}): RefreshResult {
  const affected = affectedByMatchChange(format, match, { eventsChanged });
  const slotMatchKeys = affectedSlotKeys(format, match.divisionId, affected.standingIds, match.matchKey ?? null);
  const keySet = new Set(slotMatchKeys);
  const rebuilt: StandingDoc[] = [];
  let matchReads = 0;

  for (const standingId of affected.standingIds) {
    let found: { stageId: string; groupId: string; teamIds: string[] } | null = null;
    for (const stage of format.stages) {
      if (stage.type !== 'roundRobin') continue;
      for (const group of groups) {
        if (standingIdOf(match.divisionId, stage.stageId, group.groupId) === standingId) {
          found = { stageId: stage.stageId, groupId: group.groupId, teamIds: group.teamIds };
          break;
        }
      }
      if (found) break;
    }
    if (!found) continue;
    const groupMatches = matches.filter(m => m.stageId === found?.stageId && m.groupId === found?.groupId);
    matchReads += groupMatches.length;
    rebuilt.push(buildStanding({
      competitionId,
      divisionId: match.divisionId,
      stageId: found.stageId,
      groupId: found.groupId,
      teamIds: found.teamIds,
      matches: groupMatches,
      rule,
      opts,
      prev: prevStandings[standingId] ?? null
    }));
  }

  const merged: NonNullable<AdvanceCtx['standings']> = { ...standings };
  for (const doc of rebuilt) merged[doc.standingId] = doc;
  const matchesByKey: NonNullable<AdvanceCtx['matchesByKey']> = {};
  for (const item of matches) {
    if (item.matchKey && keySet.has(item.matchKey)) matchesByKey[item.matchKey] = item;
  }
  const ctx: AdvanceCtx = {
    divisionId: match.divisionId,
    standings: merged,
    matchesByKey,
    teams,
    stageMatches
  };

  const resolutions: RefreshResult['resolutions'] = [];
  let slotMatchWrites = 0;
  for (const stageId of affected.stageIds) {
    const stage = format.stages.find(s => s.stageId === stageId);
    const only = (stage?.slots ?? []).map(slot => slot.matchKey).filter(key => keySet.has(key));
    const result = resolveStage(format, stageId, ctx, only);
    resolutions.push({
      stageId,
      updates: result.updates,
      blocked: result.blocked,
      resolvedCount: result.resolvedCount,
      allResolved: result.allResolved
    });
    slotMatchWrites += result.updates.filter(update => !update.noop).length;
  }

  const io: RefreshIo = {
    matchReads,
    standingReads: affected.standingIds.length,
    standingWrites: rebuilt.length,
    slotMatchReads: slotMatchKeys.length,
    slotMatchWrites,
    eventReads: 0,
    awardWrites: 0
  };

  let scorers: RefreshResult['scorers'];
  let fairPlay: RefreshResult['fairPlay'];
  if (affected.needScorers) {
    io.awardWrites = 2;
    io.eventReads = events?.length ?? 0;
    if (events) {
      const countedMatchIds = matches.map(m => m.matchId).filter((id): id is string => !!id);
      scorers = computeScorers(events, { countedMatchIds });
      fairPlay = computeFairPlayBoard({
        matches,
        cardEvents: events,
        teams,
        fairPlay: rule.fairPlay
      });
    }
  }

  return { affected, standings: rebuilt, resolutions, slotMatchKeys, scorers, fairPlay, io };
}
