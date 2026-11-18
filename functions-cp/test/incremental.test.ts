/**
 * 一場比賽改變後只重算受影響的組別與下游晉級。
 */
import { describe, expect, test } from 'vitest';
import {
  affectedByMatchChange,
  buildGroupKnockoutFormat,
  buildGroups,
  buildMatches,
  buildStanding,
  refreshAfterMatchChange,
  resolveStage,
  standingIdOf
} from '../src/engine/index.js';
import { RANKING_RULES } from '../src/engine/formats.js';

const RULE = RANKING_RULES.RR_FEDA_DEFAULT;

function world() {
  const format = buildGroupKnockoutFormat({ groupCount: 4, groupSize: 4, advancePerGroup: 2 });
  const teams = Array.from({ length: 16 }, (_, i) => ({ teamId: `t${i + 1}`, name: `t${i + 1}` }));
  const built = buildMatches({
    division: { code: 'D', divisionId: 'div' },
    format,
    groups: buildGroups(teams, 4)
  });
  const matches = built.matches.map(m => {
    if (m.stageId !== 'group') return { ...m, status: 'scheduled' };
    const home = m.home.teamId;
    const away = m.away.teamId;
    const homeWins = Number(home.slice(1)) < Number(away.slice(1));
    return {
      ...m,
      status: 'finished',
      score: { home: homeWins ? 1 : 0, away: homeWins ? 0 : 1 },
      result: { winner: homeWins ? 'home' : 'away', method: 'regulation' }
    };
  });
  return { format, groups: built.groups, matches, teams };
}

describe('affectedByMatchChange', () => {
  const { format, matches } = world();
  const group = matches.find(m => m.groupId === 'A');

  test('完賽且事件有變，要重算射手榜', () => {
    const effect = affectedByMatchChange(format, {
      divisionId: 'div', stageId: group.stageId, groupId: 'A', matchKey: group.matchKey, status: 'finished'
    });
    expect(effect.standingIds).toEqual([standingIdOf('div', 'group', 'A')]);
    expect(effect.needScorers).toBe(true);
    expect(effect.stageIds).toEqual(['final']);
  });

  test('只改比分時不重算射手榜', () => {
    const effect = affectedByMatchChange(format, {
      divisionId: 'div', stageId: 'group', groupId: 'A', status: 'finished'
    }, { eventsChanged: false });
    expect(effect.needScorers).toBe(false);
  });

  test('live 與 postponed 不重算射手榜', () => {
    for (const status of ['live', 'postponed', 'cancelled', 'scheduled']) {
      const effect = affectedByMatchChange(format, {
        divisionId: 'div', stageId: 'group', groupId: 'A', status
      });
      expect(effect.needScorers).toBe(false);
    }
  });
});

describe('refreshAfterMatchChange', () => {
  test('只重寫該組，C、D 的第一輪晉級場不在影響範圍', () => {
    const { format, groups, matches } = world();
    const changed = matches.find(m => m.groupId === 'A' && m.stageId === 'group');
    const standings = {};
    for (const g of groups) {
      const doc = buildStanding({
        competitionId: 'c1',
        divisionId: 'div',
        stageId: 'group',
        groupId: String(g.groupId),
        teamIds: g.teamIds,
        matches: matches.filter(m => m.stageId === 'group' && m.groupId === g.groupId),
        rule: RULE
      });
      standings[doc.standingId] = doc;
    }
    const result = refreshAfterMatchChange({
      format,
      match: {
        divisionId: 'div',
        stageId: changed.stageId,
        groupId: changed.groupId,
        matchKey: changed.matchKey,
        status: 'finished'
      },
      groups: groups.map(g => ({ groupId: String(g.groupId), teamIds: g.teamIds })),
      matches,
      rule: RULE,
      standings,
      eventsChanged: false,
      competitionId: 'c1'
    });

    const full = buildStanding({
      competitionId: 'c1',
      divisionId: 'div',
      stageId: 'group',
      groupId: 'A',
      teamIds: groups.find(g => g.groupId === 'A').teamIds,
      matches: matches.filter(m => m.stageId === 'group' && m.groupId === 'A'),
      rule: RULE
    });

    expect(result.standings).toHaveLength(1);
    expect(result.standings[0].standingId).toBe(standingIdOf('div', 'group', 'A'));
    expect(result.standings[0].hasUnresolvedTie).toBe(false);
    expect(result.standings[0].rows.map(r => r.teamId)).toEqual(full.rows.map(r => r.teamId));
    expect(result.standings[0].rows.map(r => r.points)).toEqual(full.rows.map(r => r.points));
    expect(result.io.standingWrites).toBe(1);
    expect(result.io.standingReads).toBe(1);
    expect(result.io.matchReads).toBe(6);
    expect(result.io.eventReads).toBe(0);
    expect(result.io.awardWrites).toBe(0);
    expect(result.io.slotMatchReads).toBeLessThan(format.stages.find(s => s.stageId === 'final').slots.length);
    expect(result.io.slotMatchWrites).toBeGreaterThan(0);

    const cd = format.stages.find(s => s.stageId === 'final').slots.filter(slot => {
      const srcs = [slot.home, slot.away];
      return srcs.some(s => s.type === 'standing' && (s.groupId === 'C' || s.groupId === 'D'))
        && srcs.every(s => s.type !== 'standing' || s.groupId === 'C' || s.groupId === 'D');
    }).map(s => s.matchKey);
    expect(cd.length).toBeGreaterThan(0);
    for (const key of cd) expect(result.slotMatchKeys).not.toContain(key);

    const ab = format.stages.find(s => s.stageId === 'final').slots.filter(slot => {
      const srcs = [slot.home, slot.away];
      return srcs.some(s => s.type === 'standing' && (s.groupId === 'A' || s.groupId === 'B'));
    }).map(s => s.matchKey);
    for (const key of ab) expect(result.slotMatchKeys).toContain(key);
  });

  test('事件有變時才讀事件、寫兩份獎項', () => {
    const { format, groups, matches } = world();
    const changed = matches.find(m => m.groupId === 'B');
    const events = [{
      matchId: changed.matchId, seq: 1, type: 'goal', side: 'home', teamId: changed.home.teamId,
      playerId: 'pl_1', periodId: 'h1', voided: false
    }];
    const result = refreshAfterMatchChange({
      format,
      match: {
        divisionId: 'div', stageId: 'group', groupId: 'B', status: 'finished'
      },
      groups: groups.map(g => ({ groupId: String(g.groupId), teamIds: g.teamIds })),
      matches,
      rule: RULE,
      events,
      competitionId: 'c1'
    });
    expect(result.affected.needScorers).toBe(true);
    expect(result.io.eventReads).toBe(1);
    expect(result.io.awardWrites).toBe(2);
    expect(result.scorers).toBeTruthy();
    expect(result.fairPlay).toBeTruthy();
  });

  test('只解指定 slot 時，空清單視為已解完', () => {
    const { format, matches } = world();
    const ctx = {
      divisionId: 'div',
      standings: {},
      matchesByKey: Object.fromEntries(matches.filter(m => m.matchKey).map(m => [m.matchKey, m]))
    };
    const empty = resolveStage(format, 'final', ctx, []);
    expect(empty).toMatchObject({ updates: [], blocked: [], resolvedCount: 0, allResolved: true });
    const allKeys = format.stages.find(s => s.stageId === 'final').slots.map(s => s.matchKey);
    const filtered = resolveStage(format, 'final', ctx, allKeys);
    const full = resolveStage(format, 'final', ctx);
    expect(filtered.blocked.map(b => b.matchKey)).toEqual(full.blocked.map(b => b.matchKey));
    expect(filtered.resolvedCount).toBe(full.resolvedCount);
  });
});
