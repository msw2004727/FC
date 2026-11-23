/**
 * placeMatches 改寫後必須與改寫前的掃描結果相同。
 * placeReference 是改寫前的迴圈：每個時段掃整份 busy，不跳格、不提前放棄。
 */
import { describe, expect, test } from 'vitest';
import {
  buildGroups,
  buildMatches,
  buildRoundRobinFormat,
  fieldFits,
  placeMatches,
  slotSpanMin,
  sortByStructure,
  taipeiMs
} from '../src/engine/index.js';

const intOr = (v, fallback) => (typeof v === 'number' && Number.isInteger(v) ? v : fallback);
const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
const UNPLACED = '當天排不下（場地或時間不足）。可以增加場地、延後結束時間，或降低休息下限。';

function placeReference({
  matches, occupied = [], venues = [],
  dayStartMs, dayEndMs, slotMin, bufferMin = 0,
  divisions = [], durationMin, playersOnField, minRestMin = 0
}) {
  if (!Number.isFinite(dayStartMs) || !Number.isFinite(dayEndMs)) {
    throw new TypeError('placeMatches：dayStartMs / dayEndMs 必須是毫秒數字');
  }
  if (!Number.isInteger(slotMin) || slotMin < 1) {
    throw new RangeError('placeMatches：slotMin 必須是 >= 1 的整數');
  }
  if (!venues.length) return { placed: [], unplaced: matches.map(m => ({ match: m, reason: '當天沒有可用場地' })) };

  const divById = Object.fromEntries(divisions.map(d => [d.divisionId, d]));
  const specOf = (m) => {
    const d = m.divisionId ? divById[m.divisionId] : undefined;
    const dur = intOr(d?.matchDurationMin, durationMin ?? NaN);
    const pof = Number.isInteger(d?.playersOnField) ? d?.playersOnField : playersOnField;
    if (!Number.isInteger(dur)) {
      throw new Error(`placeMatches：${m.matchId} 查不到比賽長度（缺 divisions 或 durationMin）`);
    }
    return { durationMin: dur, playersOnField: pof };
  };

  const busy = occupied.map(o => ({ ...o }));
  const placed = [];
  const unplaced = [];
  const slotCount = Math.max(0, Math.floor((dayEndMs - dayStartMs) / (slotMin * 60000)) + 1);
  const restMs = intOr(minRestMin, 0) * 60000;

  for (const m of sortByStructure(matches)) {
    const spec = specOf(m);
    const span = slotSpanMin(spec.durationMin, bufferMin);
    let fitted = null;
    for (let i = 0; i < slotCount && !fitted; i++) {
      const startMs = dayStartMs + i * slotMin * 60000;
      const endMs = startMs + span * 60000;
      if (startMs + spec.durationMin * 60000 > dayEndMs) break;
      const teamBusy = busy.some(o =>
        (o.teamIds || []).some(t => (m.teamIds || []).includes(t)) &&
        overlaps(startMs - restMs, endMs + restMs, o.startMs, o.endMs));
      if (teamBusy) continue;
      for (const v of venues) {
        if (!fieldFits(spec.playersOnField, v)) continue;
        const clash = busy.some(o => o.venueId === v.venueId && overlaps(startMs, endMs, o.startMs, o.endMs));
        if (clash) continue;
        fitted = { startMs, endMs, venue: v };
        break;
      }
    }
    if (!fitted) {
      unplaced.push({ match: m, reason: UNPLACED });
      continue;
    }
    busy.push({
      venueId: fitted.venue.venueId,
      startMs: fitted.startMs,
      endMs: fitted.endMs,
      teamIds: m.teamIds || []
    });
    placed.push({
      ...m,
      kickoffMs: fitted.startMs,
      venueId: fitted.venue.venueId,
      venueName: fitted.venue.name ?? fitted.venue.venueId
    });
  }
  return { placed, unplaced };
}

function digest(out) {
  return {
    placed: out.placed.map(m => ({
      matchId: m.matchId,
      kickoffMs: m.kickoffMs,
      venueId: m.venueId,
      venueName: m.venueName
    })),
    unplaced: out.unplaced.map(u => ({ matchId: u.match.matchId, reason: u.reason }))
  };
}

function expectSame(args) {
  expect(digest(placeMatches(args))).toEqual(digest(placeReference(args)));
}

const DAY = '2026-10-11';
const start = taipeiMs(DAY, '08:30');
const end = taipeiMs(DAY, '18:00');
const FIELDS = [
  { venueId: 'f1', name: 'f1', fieldType: '9v9', order: 1 },
  { venueId: 'f2', name: 'f2', fieldType: '9v9', order: 2 }
];

function rr(teamCount) {
  const teams = Array.from({ length: teamCount }, (_, i) => ({ teamId: `t${i + 1}`, name: `t${i + 1}` }));
  return buildMatches({
    division: { code: 'D', divisionId: 'div' },
    format: buildRoundRobinFormat({ teamCount }),
    groups: buildGroups(teams, 1)
  }).matches;
}

describe('placeMatches 與舊掃描等價', () => {
  test('8 隊整天、休息 20、緩衝 10、格 40、9 人制', () => {
    expectSame({
      matches: rr(8),
      venues: FIELDS,
      dayStartMs: start,
      dayEndMs: end,
      slotMin: 40,
      bufferMin: 10,
      durationMin: 30,
      playersOnField: 9,
      minRestMin: 20
    });
  });

  test('16 隊單循環只排一天', () => {
    expectSame({
      matches: rr(16),
      venues: FIELDS,
      dayStartMs: start,
      dayEndMs: end,
      slotMin: 30,
      bufferMin: 0,
      durationMin: 30,
      playersOnField: 5,
      minRestMin: 0
    });
  });

  test('32 隊單循環只排一天', () => {
    expectSame({
      matches: rr(32),
      venues: FIELDS,
      dayStartMs: start,
      dayEndMs: end,
      slotMin: 30,
      bufferMin: 0,
      durationMin: 30,
      playersOnField: 5,
      minRestMin: 0
    });
  });

  test('視窗比一場比賽還短', () => {
    const args = {
      matches: rr(4),
      venues: FIELDS,
      dayStartMs: start,
      dayEndMs: start + 20 * 60000,
      slotMin: 30,
      bufferMin: 0,
      durationMin: 30,
      playersOnField: 9,
      minRestMin: 0
    };
    expectSame(args);
    expect(placeMatches(args).placed).toEqual([]);
    expect(placeMatches(args).unplaced[0].reason).toBe(UNPLACED);
  });

  test('沒有場地', () => {
    const args = {
      matches: rr(4),
      venues: [],
      dayStartMs: start,
      dayEndMs: end,
      slotMin: 30,
      durationMin: 30
    };
    expectSame(args);
    expect(placeMatches(args).unplaced.every(u => u.reason === '當天沒有可用場地')).toBe(true);
  });

  test('當天已有佔用', () => {
    expectSame({
      matches: rr(6),
      occupied: [{
        venueId: 'f1',
        startMs: start,
        endMs: start + 90 * 60000,
        teamIds: ['t1']
      }],
      venues: FIELDS,
      dayStartMs: start,
      dayEndMs: end,
      slotMin: 30,
      bufferMin: 10,
      durationMin: 30,
      playersOnField: 9,
      minRestMin: 20
    });
  });

  test('null 與 undefined 隊伍編號不是同一把鑰匙', () => {
    const matches = [
      { matchId: 'a', teamIds: [null, 't1'], _sortKey: [0, 0, 0, 1] },
      { matchId: 'b', teamIds: [undefined, 't2'], _sortKey: [0, 0, 0, 2] },
      { matchId: 'c', teamIds: [null, 't3'], _sortKey: [0, 0, 0, 3] }
    ];
    const args = {
      matches,
      venues: FIELDS,
      dayStartMs: start,
      dayEndMs: end,
      slotMin: 30,
      bufferMin: 0,
      durationMin: 30,
      playersOnField: 5,
      minRestMin: 0
    };
    expectSame(args);
    const placed = placeMatches(args).placed;
    const a = placed.find(m => m.matchId === 'a');
    const b = placed.find(m => m.matchId === 'b');
    const c = placed.find(m => m.matchId === 'c');
    expect(a.kickoffMs).toBe(b.kickoffMs);
    expect(c.kickoffMs).toBe(a.kickoffMs + 30 * 60000);
  });

  test('不同組別的比賽長度', () => {
    const matches = [
      { matchId: 'long', divisionId: 'slow', teamIds: ['t1', 't2'], _sortKey: [0, 0, 0, 1] },
      { matchId: 'short', divisionId: 'fast', teamIds: ['t3', 't4'], _sortKey: [0, 0, 0, 2] },
      { matchId: 'long2', divisionId: 'slow', teamIds: ['t1', 't3'], _sortKey: [0, 0, 0, 3] }
    ];
    expectSame({
      matches,
      venues: FIELDS,
      divisions: [
        { divisionId: 'slow', matchDurationMin: 40, playersOnField: 9 },
        { divisionId: 'fast', matchDurationMin: 20, playersOnField: 5 }
      ],
      dayStartMs: start,
      dayEndMs: end,
      slotMin: 20,
      bufferMin: 10,
      minRestMin: 15
    });
  });

  test('9 人制不進 5 人制場地，5 人制可以進大場', () => {
    const venues = [
      { venueId: 'small', name: 'small', fieldType: '5v5' },
      { venueId: 'big', name: 'big', fieldType: '9v9' }
    ];
    const matches = [
      { matchId: 'nine', teamIds: ['t1', 't2'], _sortKey: [0, 0, 0, 1] },
      { matchId: 'five', teamIds: ['t3', 't4'], _sortKey: [0, 0, 0, 2] }
    ];
    const args = {
      matches,
      venues,
      divisions: [
        { divisionId: 'nine', matchDurationMin: 30, playersOnField: 9 },
        { divisionId: 'five', matchDurationMin: 30, playersOnField: 5 }
      ],
      dayStartMs: start,
      dayEndMs: end,
      slotMin: 30,
      bufferMin: 0,
      minRestMin: 0
    };
    args.matches[0].divisionId = 'nine';
    args.matches[1].divisionId = 'five';
    expectSame(args);
    const placed = placeMatches(args).placed;
    expect(placed.find(m => m.matchId === 'nine').venueId).toBe('big');
    expect(placed.find(m => m.matchId === 'five').venueId).toBe('small');
  });

  test('第二天的佔用是第一天排定的場次', () => {
    const matches = rr(8);
    const common = {
      venues: FIELDS,
      slotMin: 40,
      bufferMin: 10,
      durationMin: 30,
      playersOnField: 9,
      minRestMin: 20
    };
    const day1Args = { ...common, matches, dayStartMs: start, dayEndMs: end };
    expectSame(day1Args);
    const day1 = placeReference(day1Args);
    const occupied = day1.placed.map(m => ({
      venueId: m.venueId,
      startMs: m.kickoffMs,
      endMs: m.kickoffMs + slotSpanMin(30, 10) * 60000,
      teamIds: m.teamIds
    }));
    const day2Start = start + 86400000;
    const day2Args = {
      ...common,
      matches: day1.unplaced.map(u => u.match),
      occupied,
      dayStartMs: day2Start,
      dayEndMs: end + 86400000
    };
    expectSame(day2Args);
  });

  test('不改呼叫端傳入的 occupied', () => {
    const occupied = [{
      venueId: 'f1',
      startMs: start,
      endMs: start + 30 * 60000,
      teamIds: ['t1']
    }];
    const before = occupied.map(o => ({ ...o, teamIds: [...o.teamIds] }));
    placeMatches({
      matches: rr(4),
      occupied,
      venues: FIELDS,
      dayStartMs: start,
      dayEndMs: end,
      slotMin: 30,
      durationMin: 30,
      playersOnField: 5
    });
    expect(occupied).toEqual(before);
    expect(occupied).toHaveLength(1);
  });
});
