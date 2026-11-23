import { buildGroups, buildMatches } from '../src/engine/schedule.js';
import {
  FORMAT_TEMPLATES,
  FORMATS,
  buildGroupKnockoutFormat,
  buildKnockoutFormat,
  buildRoundRobinFormat
} from '../src/engine/formats.js';

const division = { divisionId: 'd', code: 'D' };

function teams(n: number) {
  return Array.from({ length: n }, (_, i) => ({ teamId: `t${i + 1}` }));
}

function built(format: ReturnType<typeof buildRoundRobinFormat>, groupCount = 1) {
  const n = format.teamCount;
  const groups = format.stages.some(s => s.type === 'roundRobin')
    ? buildGroups(teams(n), groupCount)
    : [teams(n)];
  return buildMatches({ division, format, groups });
}

describe('賽制產生器', () => {
  test('FORMAT_TEMPLATES 與 FORMATS 是同一份', () => {
    expect(FORMAT_TEMPLATES).toBe(FORMATS);
    expect(Object.keys(FORMATS)).toEqual([
      'F8_GROUP_CROSS',
      'F8_GROUP_TOP_SEED_BYE',
      'F6_TWO_GROUPS_MIRROR',
      'F6_TWO_GROUPS_CROSS',
      'F4_RR_FINAL'
    ]);
  });

  test('單循環場數是 n(n-1)/2，雙循環再乘 legs', () => {
    const single = buildRoundRobinFormat({ teamCount: 4 });
    expect(single.stages[0]?.groupCount).toBe(1);
    expect(single.stages[0]?.legs).toBe(1);
    expect(built(single).matches).toHaveLength(6);

    const dbl = buildRoundRobinFormat({ teamCount: 4, legs: 2 });
    expect(dbl.stages[0]?.legs).toBe(2);
    expect(built(dbl).matches).toHaveLength(12);
    expect(buildRoundRobinFormat({ teamCount: 5 }).stages[0]?.groupSize).toBe(5);
    expect(built(buildRoundRobinFormat({ teamCount: 5 })).matches).toHaveLength(10);
  });

  test('單淘汰場數是 n-1，輪空不另排場，季軍賽再加一場', () => {
    expect(built(buildKnockoutFormat({ teamCount: 8 })).matches).toHaveLength(7);
    expect(built(buildKnockoutFormat({ teamCount: 2 })).matches).toHaveLength(1);
    expect(built(buildKnockoutFormat({ teamCount: 6 })).matches).toHaveLength(5);
    expect(built(buildKnockoutFormat({ teamCount: 5 })).matches).toHaveLength(4);
    expect(built(buildKnockoutFormat({ teamCount: 7 })).matches).toHaveLength(6);

    const bye = buildKnockoutFormat({ teamCount: 6 });
    const sources = (bye.stages[0]?.slots ?? []).flatMap(s => [s.home, s.away]);
    expect(sources.some(s => s.type === 'seed')).toBe(true);
    expect(bye.finalRankingMap.map(r => r.rank)).toEqual([1, 2, 3, 3, 5, 5]);

    const withThird = buildKnockoutFormat({ teamCount: 8, thirdPlace: true });
    expect(built(withThird).matches).toHaveLength(8);
    expect(withThird.stages[0]?.slots?.some(s => s.matchKey === 'F3')).toBe(true);
    expect(withThird.finalRankingMap.map(r => r.rank)).toEqual([1, 2, 3, 4, 5, 5, 5, 5]);
    expect(withThird.stages[0]?.drawRule).toBe('penalty');
  });

  test('分組加淘汰：各組循環場數加上晉級隊數減一', () => {
    const format = buildGroupKnockoutFormat({ groupCount: 2, groupSize: 4, advancePerGroup: 2 });
    const plan = built(format, 2);
    const rr = plan.matches.filter(m => m.stageId === 'group');
    const ko = plan.matches.filter(m => m.stageId === 'final');
    expect(rr).toHaveLength(12);
    expect(ko).toHaveLength(3);
    const byKey = Object.fromEntries(ko.map(m => [m.matchKey, m]));
    expect(byKey.SF1?.home?.placeholder).toEqual({ type: 'standing', stageId: 'group', groupId: 'A', rank: 1 });
    expect(byKey.SF1?.away?.placeholder).toEqual({ type: 'standing', stageId: 'group', groupId: 'B', rank: 2 });
    expect(byKey.SF2?.home?.placeholder).toEqual({ type: 'standing', stageId: 'group', groupId: 'B', rank: 1 });
    expect(byKey.SF2?.away?.placeholder).toEqual({ type: 'standing', stageId: 'group', groupId: 'A', rank: 2 });

    const wide = buildGroupKnockoutFormat({ groupCount: 4, groupSize: 2, advancePerGroup: 1 });
    const widePlan = built(wide, 4);
    expect(widePlan.matches.filter(m => m.stageId === 'group')).toHaveLength(4);
    expect(widePlan.matches.filter(m => m.stageId === 'final')).toHaveLength(3);

    const third = buildGroupKnockoutFormat({
      groupCount: 2, groupSize: 4, advancePerGroup: 2, thirdPlace: true
    });
    expect(built(third, 2).matches.filter(m => m.stageId === 'final')).toHaveLength(4);
    expect(third.finalRankingMap.map(r => [r.rank, r.from.type])).toEqual([
      [1, 'matchWinner'],
      [2, 'matchLoser'],
      [3, 'matchWinner'],
      [4, 'matchLoser'],
      [5, 'standing'],
      [5, 'standing'],
      [7, 'standing'],
      [7, 'standing']
    ]);
  });

  test('不合法輸入丟 RangeError', () => {
    expect(() => buildRoundRobinFormat({ teamCount: 1 })).toThrow(RangeError);
    expect(() => buildRoundRobinFormat({ teamCount: 65 })).toThrow(RangeError);
    expect(() => buildRoundRobinFormat({ teamCount: 2.5 })).toThrow(RangeError);
    expect(() => buildRoundRobinFormat({ teamCount: 4, legs: 3 })).toThrow(RangeError);
    expect(() => buildKnockoutFormat({ teamCount: 1 })).toThrow(RangeError);
    expect(() => buildKnockoutFormat({ teamCount: 3, thirdPlace: true })).toThrow(RangeError);
    expect(() => buildKnockoutFormat({ teamCount: 4, drawRule: 'coin' })).toThrow(RangeError);
    expect(() => buildGroupKnockoutFormat({ groupCount: 3, groupSize: 4, advancePerGroup: 2 })).toThrow(RangeError);
    expect(() => buildGroupKnockoutFormat({ groupCount: 2, groupSize: 1, advancePerGroup: 1 })).toThrow(RangeError);
    expect(() => buildGroupKnockoutFormat({ groupCount: 2, groupSize: 4, advancePerGroup: 0 })).toThrow(RangeError);
    expect(() => buildGroupKnockoutFormat({ groupCount: 2, groupSize: 4, advancePerGroup: 5 })).toThrow(RangeError);
    expect(() => buildGroupKnockoutFormat({
      groupCount: 2, groupSize: 4, advancePerGroup: 3, thirdPlace: true
    })).toThrow(RangeError);
    expect(() => buildGroupKnockoutFormat({ groupCount: 16, groupSize: 8, advancePerGroup: 1 })).toThrow(RangeError);
    expect(() => buildGroupKnockoutFormat({ groupCount: 32, groupSize: 2, advancePerGroup: 1 })).toThrow(RangeError);
    expect(() => buildGroupKnockoutFormat({ groupCount: 27, groupSize: 2, advancePerGroup: 1 })).toThrow(RangeError);
  });

  test('組數 16 仍可用，組名停在 A–P', () => {
    const format = buildGroupKnockoutFormat({ groupCount: 16, groupSize: 2, advancePerGroup: 1 });
    const ids = format.stages
      .flatMap(stage => stage.slots ?? [])
      .flatMap(slot => [slot.home, slot.away])
      .flatMap(src => src.type === 'standing' ? [src.groupId] : []);
    expect([...new Set(ids)].sort().join('')).toBe('ABCDEFGHIJKLMNOP');
    expect(format.finalRankingMap).toHaveLength(32);
  });
});
