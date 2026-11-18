/**
 * previewSchedule 用公式估天數，不排真的場次。
 */
import { describe, expect, test } from 'vitest';
import {
  buildGroupKnockoutFormat,
  buildGroups,
  buildKnockoutFormat,
  buildMatches,
  buildRoundRobinFormat,
  placeMatches,
  previewSchedule,
  taipeiMs
} from '../src/engine/index.js';

const CJK = /[\u3400-\u9fff]/;

function countMatches(format, groupCount) {
  const n = format.teamCount;
  const teams = Array.from({ length: n }, (_, i) => ({ teamId: `t${i + 1}`, name: `t${i + 1}` }));
  return buildMatches({
    division: { code: 'D', divisionId: 'div' },
    format,
    groups: buildGroups(teams, groupCount)
  }).matches.length;
}

const base = {
  fields: 2,
  matchMinutes: 30,
  bufferMinutes: 0,
  dayStart: '08:30',
  dayEnd: '18:00'
};

describe('previewSchedule', () => {
  test('32 隊單循環、2 場地、30 分、緩衝 0、08:30–18:00', () => {
    const out = previewSchedule({
      ...base,
      teamCount: 32,
      format: { kind: 'roundRobin', legs: 1 }
    });
    expect(out.errors).toBeUndefined();
    expect(out.matchCount).toBe(496);
    expect(out.matchesPerTeam).toEqual({ min: 31, max: 31 });
    expect(out.dayCount).toBe(14);
    expect(out.matchCount).toBe(countMatches(buildRoundRobinFormat({ teamCount: 32 }), 1));
  });

  test('32 隊單次呼叫低於 5 毫秒', () => {
    const input = { ...base, teamCount: 32, format: { kind: 'roundRobin', legs: 1 } };
    const t0 = performance.now();
    let sink = 0;
    for (let i = 0; i < 1000; i++) sink += previewSchedule(input).dayCount;
    const each = (performance.now() - t0) / 1000;
    expect(sink).toBe(14000);
    expect(each).toBeLessThan(5);
  });

  test('每天每隊上限會把天數拉長', () => {
    const out = previewSchedule({
      ...base,
      teamCount: 32,
      format: { kind: 'roundRobin' },
      maxMatchesPerTeamPerDay: 2
    });
    expect(out.dayCount).toBe(16);
  });

  test('緩衝 10 分時步長是 40，單場地格子與 placeMatches 相同', () => {
    const out = previewSchedule({
      teamCount: 8,
      format: { kind: 'roundRobin' },
      fields: 1,
      matchMinutes: 30,
      bufferMinutes: 10,
      dayStart: '08:30',
      dayEnd: '18:00'
    });
    const dayStartMs = taipeiMs('2026-10-11', '08:30');
    const dayEndMs = taipeiMs('2026-10-11', '18:00');
    const matches = Array.from({ length: 40 }, (_, i) => ({
      matchId: `m${i}`,
      teamIds: [`h${i}`, `a${i}`],
      _sortKey: [0, 0, 0, i]
    }));
    const placed = placeMatches({
      matches,
      venues: [{ venueId: 'f1', name: 'f1', fieldType: '9v9' }],
      dayStartMs,
      dayEndMs,
      slotMin: 40,
      bufferMin: 10,
      durationMin: 30,
      playersOnField: 5
    });
    const perField = placed.placed.length;
    expect(out.matchCount).toBe(28);
    expect(Math.ceil(out.matchCount / perField)).toBe(out.dayCount);
    expect(perField).toBe(Math.floor((570 - 30) / 40) + 1);
  });

  test('淘汰與分組淘汰的場數跟產生器一致', () => {
    const ko = previewSchedule({
      ...base,
      teamCount: 16,
      format: { kind: 'knockout', thirdPlace: true }
    });
    expect(ko.matchCount).toBe(countMatches(buildKnockoutFormat({ teamCount: 16, thirdPlace: true }), 1));
    expect(ko.matchesPerTeam).toEqual({ min: 1, max: 4 });

    const gk = previewSchedule({
      ...base,
      teamCount: 32,
      format: { kind: 'groupKnockout', groupCount: 8, groupSize: 4, advancePerGroup: 2 }
    });
    expect(gk.matchCount).toBe(63);
    expect(gk.matchCount).toBe(countMatches(
      buildGroupKnockoutFormat({ groupCount: 8, groupSize: 4, advancePerGroup: 2 }),
      8
    ));
    expect(gk.matchesPerTeam).toEqual({ min: 3, max: 7 });
  });

  test('已產生的 Format 也可以預覽', () => {
    const format = buildRoundRobinFormat({ teamCount: 8, legs: 2 });
    const out = previewSchedule({ ...base, format });
    expect(out.matchCount).toBe(56);
    expect(out.matchesPerTeam).toEqual({ min: 14, max: 14 });
  });

  test('季軍賽排不出來時回錯誤與 0', () => {
    const out = previewSchedule({
      ...base,
      teamCount: 3,
      format: { kind: 'knockout', thirdPlace: true }
    });
    expect(out.matchCount).toBe(0);
    expect(out.dayCount).toBe(0);
    expect(out.matchesPerTeam).toEqual({ min: 0, max: 0 });
    expect(out.errors.some(e => e.messageKey === 'cp.config.format.thirdPlace.unavailable')).toBe(true);
    expect(CJK.test(JSON.stringify(out.errors))).toBe(false);
  });

  test('隊數太少、時間倒過來，都是 0 與 key', () => {
    const few = previewSchedule({ ...base, teamCount: 1, format: { kind: 'roundRobin' } });
    expect(few.matchCount).toBe(0);
    expect(few.errors[0].messageKey).toBe('cp.config.teamCount.tooFew');
    const time = previewSchedule({
      ...base,
      teamCount: 4,
      format: { kind: 'roundRobin' },
      dayStart: '18:00',
      dayEnd: '08:30'
    });
    expect(time.dayCount).toBe(0);
    expect(time.errors.some(e => e.messageKey === 'cp.config.time.dayEnd.beforeStart')).toBe(true);
  });

  test('9 人制會把 5 人制場地扣掉', () => {
    const mixed = previewSchedule({
      ...base,
      teamCount: 32,
      format: { kind: 'roundRobin' },
      playersOnField: 9,
      fields: [{ fieldType: '5v5' }, { fieldType: '9v9' }]
    });
    const one = previewSchedule({ ...base, teamCount: 32, format: { kind: 'roundRobin' }, fields: 1 });
    const two = previewSchedule({ ...base, teamCount: 32, format: { kind: 'roundRobin' }, fields: 2 });
    expect(mixed.dayCount).toBe(one.dayCount);
    expect(mixed.dayCount).toBe(27);
    expect(two.dayCount).toBe(14);
  });
});
