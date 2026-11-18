import { FORMATS, DIVISIONS } from '../src/engine/formats.js';
import { planGeneration } from '../src/engine/schedule-doc.js';
import { resolveStage, computeFinalRanking } from '../src/engine/advancement.js';
import { groupNameOf } from '../src/engine/group-name.js';

const format = FORMATS.F8_GROUP_TOP_SEED_BYE;
const division = { divisionId: 'd', code: 'D', date: '2026-10-10', matchDurationMin: 30, playersOnField: 9 };
const teams = Array.from({ length: 8 }, (_, i) => ({ teamId: `t${i + 1}`, name: `隊${i + 1}` }));
const plan = () => planGeneration({ division, orderedTeams: teams, format });
const groupsOf = p => Object.fromEntries(p.groupDocs.map(g => [g.groupId, g.teamIds]));

test('核定賽制為12場分組加8場淘汰，四個階段與輪空來源正確', () => {
  const p = plan();
  expect(p.matches).toHaveLength(20);
  expect(p.stages.map(s => s.stageId)).toEqual(['group', 'qualifier', 'placement', 'final']);
  const slots = Object.fromEntries(format.stages.flatMap(s => s.slots ?? []).map(s => [s.matchKey, s]));
  expect([slots.QF1.home.rank, slots.QF1.away.rank, slots.QF2.home.rank, slots.QF2.away.rank]).toEqual([2, 3, 3, 2]);
  expect(slots.SF1.home).toMatchObject({ groupId: 'A', rank: 1 });
  expect(slots.SF1.away).toEqual({ type: 'matchWinner', matchKey: 'QF2' });
  expect(slots.SF2.home).toMatchObject({ groupId: 'B', rank: 1 });
  expect(slots.SF2.away).toEqual({ type: 'matchWinner', matchKey: 'QF1' });
  expect([slots.F7.home.rank, slots.F7.away.rank]).toEqual([4, 4]);
  expect(slots.F5.home).toEqual({ type: 'matchLoser', matchKey: 'QF1' });
  expect(slots.F5.away).toEqual({ type: 'matchLoser', matchKey: 'QF2' });
  expect(DIVISIONS.find(d => d.divisionId === 'adult-fun').formatId).toBe(format.formatId);
  expect(DIVISIONS.every(d => d.requiredFormatId === format.formatId)).toBe(true);
});

test('完整256種淘汰勝負結果都排出八個不重複名次，兩組第一不得掉入五至八名', () => {
  for (let outcome = 0; outcome < 256; outcome++) {
    const p = plan(), groups = groupsOf(p);
    const ctx = { divisionId: 'd', teams: Object.fromEntries(teams.map(t => [t.teamId, t])),
      standings: Object.fromEntries(Object.entries(groups).map(([groupId, ids]) => [`d__group__${groupId}`, {
        rows: ids.map((teamId, i) => ({ rank: i + 1, teamId })), hasUnresolvedTie: false
      }])), matchesByKey: Object.fromEntries(p.matches.filter(m => m.matchKey).map(m => [m.matchKey, { ...m, status: 'scheduled', score: { home: 0, away: 0 } }])) };
    let bit = 0;
    for (const stageId of ['qualifier', 'placement', 'final']) {
      const r = resolveStage(format, stageId, ctx);
      expect(r.blocked).toEqual([]);
      for (const u of r.updates) {
        const m = ctx.matchesByKey[u.matchKey];
        Object.assign(m, u.patch, { status: 'confirmed', result: { winner: (outcome >> bit++) & 1 ? 'away' : 'home' } });
      }
    }
    const r = computeFinalRanking(format, ctx);
    expect(r.complete).toBe(true);
    expect(new Set(r.ranking.map(x => x.teamId)).size).toBe(8);
    expect(r.ranking.slice(4).map(x => x.teamId)).not.toContain(groups.A[0]);
    expect(r.ranking.slice(4).map(x => x.teamId)).not.toContain(groups.B[0]);
    expect(new Set(r.ranking.slice(6).map(x => x.teamId))).toEqual(new Set([groups.A[3], groups.B[3]]));
  }
});

test('甲乙名稱由設定產生，內部小組代碼與晉級來源維持一致', () => {
  const p = plan();
  expect(p.groupDocs.map(g => [g.groupId,g.name])).toEqual([['A','甲組'],['B','乙組']]);
  expect(p.matches.find(m => m.matchKey === 'QF1').home.displayName).toBe('甲組第2名');
  expect(p.matches.find(m => m.matchKey === 'QF1').away.displayName).toBe('乙組第3名');
  expect(p.matches.filter(m => m.groupId === 'A').every(m => m.label.startsWith('甲組'))).toBe(true);
  expect(groupNameOf('A')).toBe('A組');
  expect(groupNameOf('A', {groupNames:{A:'自訂小組'}})).toBe('自訂小組');
  const custom = planGeneration({division:{...division,groupNames:{A:'東組',B:'西組'}},orderedTeams:teams,format});
  expect(custom.groupDocs.map(g => g.name)).toEqual(['東組','西組']);
});
