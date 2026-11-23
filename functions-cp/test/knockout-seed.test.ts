/**
 * 純淘汰的種子來源，以及產生器的全隊名次（含並列）。
 */
import { describe, expect, test } from 'vitest';
import {
  RANKING_RULES,
  buildGroupKnockoutFormat,
  buildKnockoutFormat,
  buildRoundRobinFormat,
  buildStanding,
  computeFinalRanking,
  describeTeamSource,
  explainTeamSource,
  planGeneration,
  refreshAfterMatchChange,
  resolveStage,
  resolveTeamSource
} from '../src/engine/index.js';
import type { Format, MatchLike, TeamSource } from '../src/engine/types.js';

const RULE = RANKING_RULES.RR_FEDA_DEFAULT;
const DIVISION = { divisionId: 'd', code: 'D' };

function seedsOf(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t${i + 1}`);
}

function teamNo(id: string): number {
  return Number(id.replace(/\D/g, ''));
}

function knockoutSlots(format: Format) {
  return format.stages.find(stage => stage.type === 'knockout')?.slots ?? [];
}

function isSeed(src: TeamSource): src is { type: 'seed'; rank: number } {
  return src.type === 'seed';
}

/** 較小的種子序（或隊號）勝。比分固定，不靠亂數。 */
function play(format: Format, opts: { seeds?: string[] } = {}) {
  const teamIds = opts.seeds ?? seedsOf(format.teamCount);
  const teams = teamIds.map(teamId => ({ teamId, name: teamId }));
  const plan = planGeneration({ division: DIVISION, orderedTeams: teams, format });
  const played: MatchLike[] = plan.matches.map(match => {
    const home = match.home?.teamId;
    const away = match.away?.teamId;
    if (match.stageId !== 'group' || !home || !away) return match;
    const homeWins = teamNo(home) < teamNo(away);
    return {
      ...match,
      status: 'finished',
      score: { home: homeWins ? 1 : 0, away: homeWins ? 0 : 1 },
      result: { winner: homeWins ? 'home' : 'away', method: 'regulation' }
    };
  });

  const standings: Record<string, ReturnType<typeof buildStanding>> = {};
  for (const group of plan.groupDocs) {
    if (group.stageId !== 'group') continue;
    const doc = buildStanding({
      competitionId: 'c',
      divisionId: 'd',
      stageId: 'group',
      groupId: String(group.groupId),
      teamIds: group.teamIds as string[],
      matches: played.filter(match => match.stageId === 'group' && match.groupId === group.groupId),
      rule: RULE
    });
    standings[doc.standingId] = doc;
  }

  const matchesByKey: Record<string, MatchLike> = {};
  for (const match of played) {
    if (!match.matchKey) continue;
    matchesByKey[match.matchKey] = {
      ...match,
      status: match.status === 'finished' ? 'finished' : 'scheduled',
      score: match.score ?? { home: 0, away: 0 },
      home: { ...(match.home ?? {}), teamId: match.home?.teamId ?? null },
      away: { ...(match.away ?? {}), teamId: match.away?.teamId ?? null }
    };
  }

  const ctx = {
    divisionId: 'd',
    seeds: opts.seeds,
    teams: Object.fromEntries(teams.map(team => [team.teamId, team])),
    standings,
    matchesByKey
  };

  const stageId = format.stages.find(stage => stage.type === 'knockout')?.stageId;
  if (stageId) for (let step = 0; step < 16; step++) {
    const resolved = resolveStage(format, stageId, ctx);
    let applied = 0;
    for (const update of resolved.updates) {
      if (update.noop || !update.patch) continue;
      const match = matchesByKey[update.matchKey];
      if (!match) throw new Error(`找不到 ${update.matchKey}`);
      const homeId = update.patch.home.teamId;
      const awayId = update.patch.away.teamId;
      const homeWins = opts.seeds
        ? opts.seeds.indexOf(homeId) < opts.seeds.indexOf(awayId)
        : teamNo(homeId) < teamNo(awayId);
      match.home = { teamId: homeId };
      match.away = { teamId: awayId };
      match.teamIds = [homeId, awayId];
      match.status = 'finished';
      match.score = { home: homeWins ? 2 : 0, away: homeWins ? 0 : 2 };
      match.result = { winner: homeWins ? 'home' : 'away', method: 'regulation' };
      applied += 1;
    }
    if (applied === 0) {
      const unfinished = Object.values(matchesByKey).filter(match => match.status !== 'finished');
      expect(unfinished.map(match => match.matchKey)).toEqual([]);
      break;
    }
  }

  return { plan, ctx, ranking: computeFinalRanking(format, ctx) };
}

function expectOneRankEach(format: Format, ranking: ReturnType<typeof computeFinalRanking>) {
  expect(format.finalRankingMap).toHaveLength(format.teamCount);
  expect(ranking.complete).toBe(true);
  expect(ranking.missing).toEqual([]);
  const ids = ranking.ranking.map(item => item.teamId);
  expect(ids).toHaveLength(format.teamCount);
  expect(new Set(ids).size).toBe(format.teamCount);
}

const FIRST_ROUND: Record<number, number[][]> = {
  5: [[4, 5]],
  6: [[4, 5], [3, 6]],
  7: [[4, 5], [2, 7], [3, 6]],
  8: [[1, 8], [4, 5], [2, 7], [3, 6]],
  12: [[8, 9], [5, 12], [7, 10], [6, 11]],
  16: [[1, 16], [8, 9], [4, 13], [5, 12], [2, 15], [7, 10], [3, 14], [6, 11]]
};

describe('純淘汰種子來源', () => {
  test('5、6、7、8、12、16 隊：有種子就解析第一輪，最高種子輪空進第二輪，打完有冠軍', () => {
    for (const teamCount of [5, 6, 7, 8, 12, 16]) {
      const format = buildKnockoutFormat({ teamCount });
      const seeds = seedsOf(teamCount);
      const slots = knockoutSlots(format);
      const first = slots.filter(slot => slot.round === 1);
      expect(first.length).toBeGreaterThan(0);
      expect(first.every(slot => isSeed(slot.home) && isSeed(slot.away))).toBe(true);
      expect(first.map(slot => [slot.home.rank, slot.away.rank])).toEqual(FIRST_ROUND[teamCount]);

      const ctx = { divisionId: 'd', seeds };
      for (const slot of first) {
        expect(resolveTeamSource(slot.home, ctx)).toBe(seeds[slot.home.rank - 1]);
        expect(resolveTeamSource(slot.away, ctx)).toBe(seeds[slot.away.rank - 1]);
      }

      const top = slots.filter(slot =>
        (isSeed(slot.home) && slot.home.rank === 1) || (isSeed(slot.away) && slot.away.rank === 1)
      );
      expect(top).toHaveLength(1);
      const bye = !Number.isInteger(Math.log2(teamCount));
      expect(top[0]?.round).toBe(bye ? 2 : 1);

      const { ranking } = play(format, { seeds });
      expectOneRankEach(format, ranking);
      expect(ranking.ranking.find(item => item.rank === 1)?.teamId).toBe(seeds[0]);
    }
  });

  test('沒給種子、或名次超出時是待定，不丟例外', () => {
    const format = buildKnockoutFormat({ teamCount: 6 });
    const slot = knockoutSlots(format).find(item => isSeed(item.home) && isSeed(item.away));
    if (!slot) throw new Error('找不到第一輪');
    for (const ctx of [
      { divisionId: 'd' },
      { divisionId: 'd', seeds: undefined },
      { divisionId: 'd', seeds: [] },
      { divisionId: 'd', seeds: ['t1'] }
    ]) {
      expect(resolveTeamSource(slot.home, ctx)).toBeNull();
      const explained = explainTeamSource(slot.away, ctx);
      expect(explained.ready).toBe(false);
      expect(explained.teamId).toBeNull();
      expect(explained.reason).toContain('種子');
    }
    expect(resolveTeamSource({ type: 'seed', rank: 0 }, { divisionId: 'd', seeds: ['t1'] })).toBeNull();
    expect(describeTeamSource({ type: 'seed', rank: 4 })).toBe('種子第4名');
    expect(describeTeamSource(null)).toBe('待定');
  });

  test('planGeneration 到冠軍：純淘汰場次吃 seed 來源', () => {
    const format = buildKnockoutFormat({ teamCount: 6 });
    const seeds = seedsOf(6);
    const { plan, ranking } = play(format, { seeds });
    expect(plan.matches).toHaveLength(5);
    const qf = plan.matches.find(match => match.matchKey === 'QF1');
    expect(qf?.home?.teamId).toBeNull();
    expect(qf?.home?.placeholder).toEqual({ type: 'seed', rank: 4 });
    expect(qf?.home?.displayName).toBe('種子第4名');
    expect(qf?.away?.placeholder).toEqual({ type: 'seed', rank: 5 });
    expect(qf?.away?.displayName).toBe('種子第5名');
    const sf = plan.matches.find(match => match.matchKey === 'SF1');
    expect(sf?.home?.placeholder).toEqual({ type: 'seed', rank: 1 });
    expect(sf?.home?.displayName).toBe('種子第1名');
    expect(sf?.round).toBe(2);
    expectOneRankEach(format, ranking);
    expect(ranking.ranking.find(item => item.rank === 1)?.teamId).toBe('t1');
    expect(ranking.ranking.filter(item => item.rank === 3).map(item => item.teamId).sort()).toEqual(['t3', 't4']);
    expect(ranking.ranking.filter(item => item.rank === 5).map(item => item.teamId).sort()).toEqual(['t5', 't6']);
  });

  test('種子來源的影響範圍只含下游場次，有 seeds 才能解出輪空隊', () => {
    const format = buildKnockoutFormat({ teamCount: 6 });
    const teams = seedsOf(6).map(teamId => ({ teamId, name: teamId }));
    const plan = planGeneration({ division: DIVISION, orderedTeams: teams, format });
    const matches = plan.matches.map(match => {
      if (match.matchKey !== 'QF1') {
        return { ...match, status: 'scheduled', score: { home: 0, away: 0 } };
      }
      return {
        ...match,
        status: 'finished',
        home: { teamId: 't4' },
        away: { teamId: 't5' },
        teamIds: ['t4', 't5'],
        score: { home: 1, away: 0 },
        result: { winner: 'home', method: 'regulation' }
      };
    });
    const common = {
      format,
      match: { divisionId: 'd', stageId: 'final', matchKey: 'QF1', status: 'finished' },
      groups: [{ groupId: 'A', teamIds: seedsOf(6) }],
      matches,
      rule: RULE,
      teams: Object.fromEntries(teams.map(team => [team.teamId, team])),
      eventsChanged: false
    };
    const withSeeds = refreshAfterMatchChange({ ...common, seeds: seedsOf(6) });
    expect(withSeeds.affected.standingIds).toEqual([]);
    expect(withSeeds.affected.stageIds).toEqual(['final']);
    expect(withSeeds.slotMatchKeys.slice().sort()).toEqual(['F1', 'SF1']);
    const sf = withSeeds.resolutions[0]?.updates.find(update => update.matchKey === 'SF1');
    expect(sf?.patch?.home.teamId).toBe('t1');
    expect(sf?.patch?.away.teamId).toBe('t4');

    const without = refreshAfterMatchChange(common);
    expect(without.slotMatchKeys.slice().sort()).toEqual(['F1', 'SF1']);
    expect(without.resolutions[0]?.updates.find(update => update.matchKey === 'SF1')).toBeUndefined();
    expect(without.resolutions[0]?.blocked.some(block => block.matchKey === 'SF1')).toBe(true);
    expect(without.io.slotMatchWrites).toBe(0);
  });
});

describe('最終名次涵蓋全部隊伍', () => {
  test('每種產生器的 finalRankingMap 隊數等於 teamCount，固定比分後每隊恰好一個名次', () => {
    const formats: Format[] = [
      buildRoundRobinFormat({ teamCount: 5 }),
      buildKnockoutFormat({ teamCount: 2 }),
      buildKnockoutFormat({ teamCount: 3 }),
      buildKnockoutFormat({ teamCount: 4 }),
      buildKnockoutFormat({ teamCount: 4, thirdPlace: true }),
      buildKnockoutFormat({ teamCount: 5 }),
      buildKnockoutFormat({ teamCount: 6 }),
      buildKnockoutFormat({ teamCount: 6, thirdPlace: true }),
      buildKnockoutFormat({ teamCount: 7 }),
      buildKnockoutFormat({ teamCount: 8 }),
      buildKnockoutFormat({ teamCount: 8, thirdPlace: true }),
      buildKnockoutFormat({ teamCount: 12 }),
      buildKnockoutFormat({ teamCount: 16, thirdPlace: true }),
      buildGroupKnockoutFormat({ groupCount: 2, groupSize: 2, advancePerGroup: 1 }),
      buildGroupKnockoutFormat({ groupCount: 2, groupSize: 4, advancePerGroup: 1 }),
      buildGroupKnockoutFormat({ groupCount: 2, groupSize: 4, advancePerGroup: 2 }),
      buildGroupKnockoutFormat({ groupCount: 2, groupSize: 4, advancePerGroup: 2, thirdPlace: true }),
      buildGroupKnockoutFormat({ groupCount: 2, groupSize: 4, advancePerGroup: 3 }),
      buildGroupKnockoutFormat({ groupCount: 4, groupSize: 2, advancePerGroup: 1 }),
      buildGroupKnockoutFormat({ groupCount: 4, groupSize: 4, advancePerGroup: 2 }),
      buildGroupKnockoutFormat({ groupCount: 8, groupSize: 4, advancePerGroup: 2 }),
      buildGroupKnockoutFormat({ groupCount: 8, groupSize: 4, advancePerGroup: 2, thirdPlace: true })
    ];
    for (const format of formats) {
      const seeds = format.stages.some(stage => stage.type === 'roundRobin')
        ? undefined
        : seedsOf(format.teamCount);
      const { ranking } = play(format, { seeds });
      expectOneRankEach(format, ranking);
    }
  });

  test('沒有季軍賽時四強敗者並列第 3，有季軍賽時第 3、4 名分開', () => {
    const plain = buildKnockoutFormat({ teamCount: 8 });
    expect(plain.finalRankingMap.map(item => item.rank)).toEqual([1, 2, 3, 3, 5, 5, 5, 5]);
    const played = play(plain, { seeds: seedsOf(8) });
    expect(played.ranking.ranking.filter(item => item.rank === 3).map(item => item.teamId).sort()).toEqual(['t3', 't4']);
    expect(played.ranking.ranking.filter(item => item.rank === 5)).toHaveLength(4);

    const third = buildKnockoutFormat({ teamCount: 8, thirdPlace: true });
    expect(third.finalRankingMap.map(item => item.rank)).toEqual([1, 2, 3, 4, 5, 5, 5, 5]);
    const withThird = play(third, { seeds: seedsOf(8) });
    expect(withThird.ranking.ranking.find(item => item.rank === 3)?.teamId).toBe('t3');
    expect(withThird.ranking.ranking.find(item => item.rank === 4)?.teamId).toBe('t4');
  });

  test('8 組×4 隊每組前 2：分組第 3 並列第 17、第 4 並列第 25', () => {
    const format = buildGroupKnockoutFormat({ groupCount: 8, groupSize: 4, advancePerGroup: 2 });
    const at = (rank: number) => format.finalRankingMap.filter(item => item.rank === rank);
    expect(at(17).map(item => item.from)).toEqual(
      'ABCDEFGH'.split('').map(groupId => ({ type: 'standing', stageId: 'group', groupId, rank: 3 }))
    );
    expect(at(25).map(item => item.from)).toEqual(
      'ABCDEFGH'.split('').map(groupId => ({ type: 'standing', stageId: 'group', groupId, rank: 4 }))
    );
    expect(format.finalRankingMap.map(item => item.rank).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 3, 5, 5, 5, 5,
      9, 9, 9, 9, 9, 9, 9, 9,
      17, 17, 17, 17, 17, 17, 17, 17,
      25, 25, 25, 25, 25, 25, 25, 25
    ]);
    const { ranking } = play(format);
    expectOneRankEach(format, ranking);
    const thirds = ranking.ranking.filter(item => item.rank === 17).map(item => item.teamId);
    expect(thirds).toHaveLength(8);
    expect(new Set(thirds).size).toBe(8);
  });
});
