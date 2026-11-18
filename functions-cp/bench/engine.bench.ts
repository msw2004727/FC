/**
 * 賽事引擎基準。代號隊伍 t1…、球員 pl_1…。比分用 mulberry32，種子固定。
 * B1–B7 量整段情境。Bx-* 把同一情境拆開，用來算耗時占比。
 * 文件數是觸發器讀寫估計，不連 Firestore。
 */
import { bench, describe } from 'vitest';
import {
  RANKING_RULES,
  buildGroupKnockoutFormat,
  buildMatches,
  buildRoundRobinFormat,
  buildStanding,
  checkSchedule,
  computeFairPlayBoard,
  computeFinalRanking,
  computeRows,
  computeScorers,
  placeMatches,
  previewSchedule,
  rankRows,
  refreshAfterMatchChange,
  resolveStage,
  taipeiMs
} from '../src/engine/index.js';
import { buildGroups } from '../src/engine/schedule.js';
import type { Format, MatchLike, RankingRule, StandingDoc, TeamInfo, TimelineEvent } from '../src/engine/types.js';

const RULE: RankingRule = RANKING_RULES.RR_FEDA_DEFAULT;
const TWO_FIELDS = [
  { venueId: 'f1', name: 'f1', fieldType: '9v9', order: 1 },
  { venueId: 'f2', name: 'f2', fieldType: '9v9', order: 2 }
];
const FOUR_FIELDS = [
  ...TWO_FIELDS,
  { venueId: 'f3', name: 'f3', fieldType: '9v9', order: 3 },
  { venueId: 'f4', name: 'f4', fieldType: '5v5', order: 4 }
];

let sink = 0;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function teamsOf(n: number): Array<{ teamId: string; name: string }> {
  return Array.from({ length: n }, (_, i) => ({ teamId: `t${i + 1}`, name: `t${i + 1}` }));
}

/** 約 45% 平手，故意讓多隊同分。 */
function scorePair(rng: () => number): [number, number] {
  if (rng() < 0.45) {
    const g = Math.floor(rng() * 4);
    return [g, g];
  }
  return [Math.floor(rng() * 5), Math.floor(rng() * 5)];
}

function placeAllDays(
  matches: Array<{ matchId: string; teamIds?: Array<string | null>; divisionId?: string }>,
  venues: typeof TWO_FIELDS,
  {
    startDate = '2026-10-10',
    dayStart = '08:30',
    dayEnd = '18:00',
    slotMin = 30,
    bufferMin = 0,
    durationMin = 30,
    playersOnField = 5,
    minRestMin = 0,
    maxDays = 80
  } = {}
) {
  let pending = matches;
  const placed: Array<(typeof matches)[number] & { kickoffMs: number; venueId: string; venueName: string }> = [];
  let days = 0;
  while (pending.length && days < maxDays) {
    const dayStartMs = (taipeiMs(startDate, dayStart) as number) + days * 86400000;
    const dayEndMs = (taipeiMs(startDate, dayEnd) as number) + days * 86400000;
    const out = placeMatches({
      matches: pending,
      venues,
      dayStartMs,
      dayEndMs,
      slotMin,
      bufferMin,
      durationMin,
      playersOnField,
      minRestMin
    });
    if (!out.placed.length) break;
    placed.push(...out.placed);
    pending = out.unplaced.map(u => u.match);
    days += 1;
  }
  return { placed, unplaced: pending, days };
}

function finishRegulation<T extends { kickoffMs?: number | null }>(
  match: T,
  rng: () => number
): T & { status: string; score: { home: number; away: number }; result: { winner: string; method: string }; kickoffAt: number | null } {
  const [home, away] = scorePair(rng);
  return {
    ...match,
    status: 'finished',
    score: { home, away },
    kickoffAt: match.kickoffMs ?? null,
    result: {
      winner: home > away ? 'home' : home < away ? 'away' : 'draw',
      method: 'regulation'
    }
  };
}

interface World {
  format: Format;
  groups: Array<Record<string, unknown>>;
  matches: MatchLike[];
  standings: Record<string, StandingDoc>;
  events: TimelineEvent[];
  teams: Record<string, TeamInfo>;
  days: number;
  unplaced: number;
}

function standingsOf(groups: Array<Record<string, unknown>>, matches: MatchLike[]): Record<string, StandingDoc> {
  const out: Record<string, StandingDoc> = {};
  for (const g of groups) {
    const groupId = String(g.groupId);
    const teamIds = g.teamIds as string[];
    const doc = buildStanding({
      competitionId: 'c1',
      divisionId: 'div',
      stageId: 'group',
      groupId,
      teamIds,
      matches: matches.filter(m => m.stageId === 'group' && m.groupId === groupId),
      rule: RULE
    });
    out[doc.standingId] = doc;
  }
  return out;
}

function eventsFor(matches: MatchLike[], seed: number): TimelineEvent[] {
  const rng = mulberry32(seed);
  const events: TimelineEvent[] = [];
  let seq = 1;
  let player = 1;
  for (const m of matches) {
    const n = 6 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const side = rng() < 0.5 ? 'home' : 'away';
      const teamId = side === 'home' ? m.home?.teamId : m.away?.teamId;
      const playerId = `pl_${player++}`;
      if (rng() < 0.72) {
        events.push({
          matchId: m.matchId, seq: seq++, type: 'goal', side, teamId, playerId,
          periodId: 'h1', voided: false, goalType: 'open'
        });
      } else {
        events.push({
          matchId: m.matchId, seq: seq++, type: 'card', side, teamId, playerId,
          cardType: rng() < 0.85 ? 'yellow' : 'red', periodId: 'h1', voided: false
        });
      }
    }
  }
  return events;
}

function roundRobinWorld(teamCount: number, seed: number): World {
  const format = buildRoundRobinFormat({ teamCount });
  const ordered = teamsOf(teamCount);
  const groups = buildGroups(ordered, 1);
  const built = buildMatches({ division: { code: 'D', divisionId: 'div' }, format, groups });
  const schedule = placeAllDays(built.matches, TWO_FIELDS);
  const rng = mulberry32(seed);
  const matches = schedule.placed.map(m => finishRegulation(m, rng)) as MatchLike[];
  const teams = Object.fromEntries(ordered.map(t => [t.teamId, { teamId: t.teamId, name: t.name }]));
  return {
    format,
    groups: built.groups,
    matches,
    standings: standingsOf(built.groups, matches),
    events: [],
    teams,
    days: schedule.days,
    unplaced: schedule.unplaced.length
  };
}

function playKnockout(format: Format, matches: MatchLike[], standings: Record<string, StandingDoc>, teams: Record<string, TeamInfo>, rng: () => number) {
  const matchesByKey: Record<string, MatchLike> = {};
  for (const m of matches) if (m.matchKey) matchesByKey[m.matchKey] = m;
  for (let step = 0; step < 8; step++) {
    const ctx = {
      divisionId: 'div',
      standings,
      matchesByKey,
      teams,
      stageMatches: {
        group: matches.filter(m => m.stageId === 'group'),
        final: matches.filter(m => m.stageId === 'final')
      }
    };
    const resolved = resolveStage(format, 'final', ctx);
    let applied = 0;
    for (const u of resolved.updates) {
      if (u.noop || !u.patch || !u.matchId) continue;
      const m = matches.find(x => x.matchId === u.matchId);
      if (!m || m.status === 'finished') continue;
      m.home = u.patch.home;
      m.away = u.patch.away;
      m.teamIds = u.patch.teamIds;
      m.status = 'finished';
      let [home, away] = scorePair(rng);
      let winner: 'home' | 'away' = home === away ? (rng() < 0.5 ? 'home' : 'away') : (home > away ? 'home' : 'away');
      const method = home === away ? 'penalty' : 'regulation';
      if (home === away) {
        m.penaltyScore = winner === 'home' ? { home: 3, away: 1 } : { home: 1, away: 3 };
      }
      m.score = { home, away };
      m.result = { winner, method };
      m.kickoffAt = m.kickoffMs ?? null;
      if (m.matchKey) matchesByKey[m.matchKey] = m;
      applied += 1;
    }
    if (!applied) break;
  }
  return computeFinalRanking(format, {
    divisionId: 'div',
    standings,
    matchesByKey,
    teams,
    stageMatches: {
      group: matches.filter(m => m.stageId === 'group'),
      final: matches.filter(m => m.stageId === 'final')
    }
  });
}

function groupKnockoutWorld(): World & { rankingComplete: boolean } {
  const format = buildGroupKnockoutFormat({ groupCount: 8, groupSize: 4, advancePerGroup: 2 });
  const ordered = teamsOf(32);
  const seeded = buildGroups(ordered, 8);
  const built = buildMatches({ division: { code: 'D', divisionId: 'div' }, format, groups: seeded });
  const groupMatches = built.matches.filter(m => m.stageId === 'group');
  const koMatches = built.matches.filter(m => m.stageId !== 'group');
  const groupSchedule = placeAllDays(groupMatches, TWO_FIELDS, { startDate: '2026-10-10' });
  const koSchedule = placeAllDays(koMatches, TWO_FIELDS, {
    startDate: '2026-10-10',
    maxDays: 20
  });
  const rng = mulberry32(3);
  const matches: MatchLike[] = [
    ...groupSchedule.placed.map(m => finishRegulation(m, rng)),
    ...koSchedule.placed
  ];
  const teams = Object.fromEntries(ordered.map(t => [t.teamId, { teamId: t.teamId, name: t.name }]));
  const standings = standingsOf(built.groups, matches);
  const ranking = playKnockout(format, matches, standings, teams, rng);
  return {
    format,
    groups: built.groups,
    matches,
    standings,
    events: eventsFor(matches, 6),
    teams,
    days: groupSchedule.days + koSchedule.days,
    unplaced: groupSchedule.unplaced.length + koSchedule.unplaced.length,
    rankingComplete: ranking.complete
  };
}

/** 目前觸發器：一場比分變更就重算全部組別、整段淘汰、整份射手榜。 */
function fullRefresh(world: World) {
  const standings = standingsOf(world.groups, world.matches);
  const matchesByKey: Record<string, MatchLike> = {};
  for (const m of world.matches) if (m.matchKey) matchesByKey[m.matchKey] = m;
  const stage = resolveStage(world.format, 'final', {
    divisionId: 'div',
    standings,
    matchesByKey,
    teams: world.teams,
    stageMatches: {
      group: world.matches.filter(m => m.stageId === 'group'),
      final: world.matches.filter(m => m.stageId === 'final')
    }
  });
  const scorers = computeScorers(world.events, {
    countedMatchIds: world.matches.map(m => m.matchId).filter((id): id is string => !!id)
  });
  const fair = computeFairPlayBoard({
    matches: world.matches,
    cardEvents: world.events,
    teams: world.teams
  });
  return { standings, stage, scorers, fair };
}

function tieWorld() {
  const ids = teamsOf(8).map(t => t.teamId);
  const matches: MatchLike[] = [];
  let n = 1;
  const push = (home: string, away: string, hs: number, as: number) => {
    matches.push({
      matchId: `m${n++}`,
      competitionId: 'c1',
      divisionId: 'div',
      stageId: 'group',
      groupId: 'A',
      home: { teamId: home, name: home },
      away: { teamId: away, name: away },
      teamIds: [home, away],
      score: { home: hs, away: as },
      status: 'finished',
      result: { winner: hs === as ? 'draw' : hs > as ? 'home' : 'away', method: 'regulation', homePoints: 0, awayPoints: 0 },
      kickoffAt: `2026-10-10T${String(8 + (n % 10)).padStart(2, '0')}:00:00+08:00`
    });
  };
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] as string;
      const b = ids[j] as string;
      const aIn4 = i < 4;
      const bIn4 = j < 4;
      const aIn3 = i >= 4 && i < 7;
      const bIn3 = j >= 4 && j < 7;
      if (aIn4 && bIn4) push(a, b, 1, 1);
      else if (aIn3 && bIn3) push(a, b, 1, 1);
      else push(a, b, 0, 0);
    }
  }
  return { ids, matches };
}

const b1 = roundRobinWorld(16, 1);
const b2 = roundRobinWorld(32, 2);
const b3 = groupKnockoutWorld();
const b5Match = b3.matches.find(m => m.stageId === 'group' && m.status === 'finished');
if (b5Match?.score) b5Match.score = { home: (b5Match.score.home ?? 0) + 1, away: b5Match.score.away ?? 0 };
const b7 = tieWorld();
const b7rows = computeRows(b7.ids, b7.matches, RULE);

const b4Built = buildMatches({
  division: { code: 'D', divisionId: 'div' },
  format: buildRoundRobinFormat({ teamCount: 16 }),
  groups: buildGroups(teamsOf(16), 1)
});
const b4Matches = b4Built.matches.filter(m => (m.round ?? 0) <= 8);

function incrementalRefresh(world: World) {
  const match = world.matches.find(m => m.stageId === 'group' && m.status === 'finished');
  if (!match) throw new Error('bench：找不到可增量的小組場次');
  return refreshAfterMatchChange({
    format: world.format,
    match: {
      divisionId: 'div',
      stageId: match.stageId,
      groupId: match.groupId,
      matchKey: match.matchKey,
      status: match.status
    },
    groups: world.groups.map(g => ({ groupId: String(g.groupId), teamIds: g.teamIds as string[] })),
    matches: world.matches,
    rule: RULE,
    standings: world.standings,
    teams: world.teams,
    events: world.events,
    eventsChanged: false,
    competitionId: 'c1'
  });
}

function ioOf() {
  const refresh = fullRefresh(b3);
  const inc = incrementalRefresh(b3);
  const slotWrites = refresh.stage.updates.filter(u => !u.noop).length;
  const tie = rankRows(b7rows, b7.matches, RULE);
  const four = tie.rows.filter(r => r.goalsFor === 3).length;
  const three = tie.rows.filter(r => r.goalsFor === 2).length;
  return {
    meta: {
      b1matches: b1.matches.length,
      b1days: b1.days,
      b1unplaced: b1.unplaced,
      b2matches: b2.matches.length,
      b2days: b2.days,
      b2unplaced: b2.unplaced,
      b3matches: b3.matches.length,
      b3days: b3.days,
      b3unplaced: b3.unplaced,
      b3groups: b3.groups.length,
      b3events: b3.events.length,
      b3rankingComplete: b3.rankingComplete,
      b4matches: b4Matches.length,
      b5slotWrites: slotWrites,
      b5koMatches: b3.matches.filter(m => m.stageId === 'final').length,
      b5incMatchReads: inc.io.matchReads,
      b5incStandingWrites: inc.io.standingWrites,
      b5incSlotReads: inc.io.slotMatchReads,
      b5incSlotWrites: inc.io.slotMatchWrites,
      b5incEventReads: inc.io.eventReads,
      b5incAwardWrites: inc.io.awardWrites,
      b7fourWay: four,
      b7threeWay: three,
      b7unresolved: tie.hasUnresolvedTie
    },
    B1: { matchReads: b1.matches.length, matchWrites: b1.matches.length, standingReads: 1, standingWrites: 1, eventReads: 0, awardWrites: 0, slotMatchReads: 0, slotMatchWrites: 0 },
    B2: { matchReads: b2.matches.length, matchWrites: b2.matches.length, standingReads: 1, standingWrites: 1, eventReads: 0, awardWrites: 0, slotMatchReads: 0, slotMatchWrites: 0 },
    B3: {
      matchReads: b3.matches.length,
      matchWrites: b3.matches.length,
      standingReads: b3.groups.length,
      standingWrites: b3.groups.length,
      eventReads: 0,
      awardWrites: 0,
      slotMatchReads: b3.matches.filter(m => m.stageId === 'final').length,
      slotMatchWrites: b3.matches.filter(m => m.stageId === 'final' && m.status === 'finished').length
    },
    B4: { matchReads: b4Matches.length, matchWrites: b4Matches.length, standingReads: 0, standingWrites: 0, eventReads: 0, awardWrites: 0, slotMatchReads: 0, slotMatchWrites: 0 },
    B5: {
      matchReads: b3.matches.length,
      matchWrites: 0,
      standingReads: b3.groups.length,
      standingWrites: b3.groups.length,
      eventReads: b3.events.length,
      awardWrites: 2,
      slotMatchReads: b3.matches.filter(m => m.stageId === 'final').length,
      slotMatchWrites: slotWrites
    },
    B5incremental: inc.io,
    B6: { matchReads: b3.matches.length, matchWrites: 0, standingReads: 0, standingWrites: 0, eventReads: b3.events.length, awardWrites: 2, slotMatchReads: 0, slotMatchWrites: 0 },
    B7: { matchReads: b7.matches.length, matchWrites: 0, standingReads: 1, standingWrites: 1, eventReads: 0, awardWrites: 0, slotMatchReads: 0, slotMatchWrites: 0 }
  };
}

console.log('IO_ESTIMATE ' + JSON.stringify(ioOf()));

const HEAVY = { time: 250, iterations: 6, warmupTime: 40, warmupIterations: 1 };
const LIGHT = { time: 200, iterations: 8, warmupTime: 40, warmupIterations: 1 };

describe('B1 16 隊單循環', () => {
  bench('B1', () => {
    const world = roundRobinWorld(16, 1);
    sink = world.matches.length + Object.keys(world.standings).length;
  }, HEAVY);
  bench('B1-build', () => {
    const format = buildRoundRobinFormat({ teamCount: 16 });
    const built = buildMatches({
      division: { code: 'D', divisionId: 'div' },
      format,
      groups: buildGroups(teamsOf(16), 1)
    });
    sink = built.matches.length;
  }, LIGHT);
  bench('B1-place', () => {
    const format = buildRoundRobinFormat({ teamCount: 16 });
    const built = buildMatches({
      division: { code: 'D', divisionId: 'div' },
      format,
      groups: buildGroups(teamsOf(16), 1)
    });
    const schedule = placeAllDays(built.matches, TWO_FIELDS);
    sink = schedule.placed.length;
  }, HEAVY);
  bench('B1-standing', () => {
    const doc = buildStanding({
      competitionId: 'c1', divisionId: 'div', stageId: 'group', groupId: 'A',
      teamIds: b1.groups[0]?.teamIds as string[],
      matches: b1.matches,
      rule: RULE
    });
    sink = doc.rows.length;
  }, LIGHT);
});

describe('B2 32 隊單循環', () => {
  bench('B2', () => {
    const world = roundRobinWorld(32, 2);
    sink = world.matches.length;
  }, HEAVY);
  bench('B2-build', () => {
    const built = buildMatches({
      division: { code: 'D', divisionId: 'div' },
      format: buildRoundRobinFormat({ teamCount: 32 }),
      groups: buildGroups(teamsOf(32), 1)
    });
    sink = built.matches.length;
  }, LIGHT);
  bench('B2-place', () => {
    const built = buildMatches({
      division: { code: 'D', divisionId: 'div' },
      format: buildRoundRobinFormat({ teamCount: 32 }),
      groups: buildGroups(teamsOf(32), 1)
    });
    sink = placeAllDays(built.matches, TWO_FIELDS).placed.length;
  }, { time: 400, iterations: 4, warmupTime: 20, warmupIterations: 1 });
  bench('B2-standing', () => {
    const doc = buildStanding({
      competitionId: 'c1', divisionId: 'div', stageId: 'group', groupId: 'A',
      teamIds: b2.groups[0]?.teamIds as string[],
      matches: b2.matches,
      rule: RULE
    });
    sink = doc.rows.length;
  }, LIGHT);
});

describe('B3 8 組×4 隊分組淘汰', () => {
  bench('B3', () => {
    const world = groupKnockoutWorld();
    sink = world.matches.length + (world.rankingComplete ? 1 : 0);
  }, HEAVY);
  bench('B3-standing', () => {
    sink = Object.keys(standingsOf(b3.groups, b3.matches)).length;
  }, LIGHT);
  bench('B3-resolve', () => {
    const matchesByKey: Record<string, MatchLike> = {};
    for (const m of b3.matches) if (m.matchKey) matchesByKey[m.matchKey] = m;
    const stage = resolveStage(b3.format, 'final', {
      divisionId: 'div',
      standings: b3.standings,
      matchesByKey,
      teams: b3.teams,
      stageMatches: {
        group: b3.matches.filter(m => m.stageId === 'group'),
        final: b3.matches.filter(m => m.stageId === 'final')
      }
    });
    sink = stage.resolvedCount;
    const ranking = computeFinalRanking(b3.format, {
      divisionId: 'div',
      standings: b3.standings,
      matchesByKey,
      teams: b3.teams
    });
    sink += ranking.ranking.length;
  }, LIGHT);
});

describe('B4 64 場排程', () => {
  bench('B4', () => {
    const schedule = placeAllDays(b4Matches, FOUR_FIELDS, { dayStart: '08:30', dayEnd: '12:30', maxDays: 8 });
    const checked = checkSchedule({
      matches: schedule.placed,
      venues: FOUR_FIELDS,
      divisions: [{ divisionId: 'div', matchDurationMin: 30, playersOnField: 5 }],
      minRestMin: 0
    });
    sink = schedule.placed.length + checked.findings.length + schedule.days;
  }, HEAVY);
});

describe('B5 改一場比分後全量重算', () => {
  bench('B5', () => {
    const out = fullRefresh(b3);
    sink = Object.keys(out.standings).length + out.scorers.length + out.fair.length;
  }, LIGHT);
  bench('B5-incremental', () => {
    const out = incrementalRefresh(b3);
    sink = out.standings.length + out.io.standingWrites + out.io.matchReads + out.slotMatchKeys.length;
  }, LIGHT);
});

describe('preview 32 隊', () => {
  bench('preview-32', () => {
    const out = previewSchedule({
      teamCount: 32,
      format: { kind: 'roundRobin', legs: 1 },
      fields: 2,
      matchMinutes: 30,
      bufferMinutes: 0,
      dayStart: '08:30',
      dayEnd: '18:00'
    });
    sink = out.dayCount + out.matchCount;
  }, LIGHT);
});

describe('B6 射手榜與行為分榜', () => {
  bench('B6', () => {
    const scorers = computeScorers(b3.events, {
      countedMatchIds: b3.matches.map(m => m.matchId).filter((id): id is string => !!id)
    });
    const fair = computeFairPlayBoard({ matches: b3.matches, cardEvents: b3.events, teams: b3.teams });
    sink = scorers.length + fair.length;
  }, LIGHT);
  bench('B6-scorers', () => {
    sink = computeScorers(b3.events).length;
  }, LIGHT);
  bench('B6-fair', () => {
    sink = computeFairPlayBoard({ matches: b3.matches, cardEvents: b3.events, teams: b3.teams }).length;
  }, LIGHT);
});

describe('B7 同分排序', () => {
  bench('B7', () => {
    const ranked = rankRows(b7rows.map(r => ({ ...r, tieBreakTrace: [] })), b7.matches, RULE);
    sink = ranked.rows.length + (ranked.hasUnresolvedTie ? 1 : 0) + (ranked.rows[0]?.tieBreakTrace.length ?? 0);
  }, LIGHT);
});
