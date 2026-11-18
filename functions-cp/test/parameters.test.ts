/**
 * 原本寫死的常數改成參數。省略參數時結果與舊值相同。
 */
import { describe, expect, test } from 'vitest';
import {
  APPEAL_RULES,
  DIVISIONS,
  REFUND_RULES,
  REGISTRATION_LIMITS,
  SCHEDULE_DEFAULTS,
  buildClockCorrection,
  buildFinishPatch,
  checkSchedule,
  clockLimitSec,
  taipeiMs
} from '../src/engine/index.js';

describe('參數預設值', () => {
  test('taipeiMs 預設仍是 +08:00', () => {
    expect(taipeiMs('2026-10-11', '08:30')).toBe(Date.parse('2026-10-11T00:30:00Z'));
    expect(taipeiMs('2026-10-11', '08:30', '+08:00')).toBe(taipeiMs('2026-10-11', '08:30'));
  });

  test('可以改 utcOffset', () => {
    expect(taipeiMs('2026-10-11', '08:30', '-05:00')).toBe(Date.parse('2026-10-11T13:30:00Z'));
  });

  test('時區格式不對回 null', () => {
    expect(taipeiMs('2026-10-11', '08:30', '+8:00')).toBeNull();
    expect(taipeiMs('2026-10-11', '08:30', 'Asia/Taipei')).toBeNull();
    expect(taipeiMs('2026-10-11', '08:30', '')).toBeNull();
  });

  test('延長賽半場預設 5 分，可改成 10 分', () => {
    const match = { status: 'live', period: 'et1', clock: { running: false, elapsedSecAtPause: 0 } };
    const division = { periods: 2, matchDurationMin: 30 };
    expect(clockLimitSec(match, division)).toBe(300);
    expect(clockLimitSec(match, division, 10)).toBe(600);
    expect(clockLimitSec(match, division, 0)).toBe(300);

    const correction = buildClockCorrection({ match, division, seconds: 400, nowMs: 0 });
    expect(correction.addedTimeSec).toBe(100);
    const longer = buildClockCorrection({ match, division, seconds: 400, nowMs: 0, etHalfMin: 10 });
    expect(longer.addedTimeSec).toBe(0);

    const finished = buildFinishPatch({
      score: { home: 1, away: 1 },
      matchDurationMin: 30,
      periods: 2,
      clock: { elapsedSecAtPause: 400, periodId: 'et1' }
    });
    expect(finished.clock.addedTimeSec).toBe(100);
    const finishedLong = buildFinishPatch({
      score: { home: 1, away: 1 },
      matchDurationMin: 30,
      periods: 2,
      clock: { elapsedSecAtPause: 400, periodId: 'et1' },
      etHalfMin: 10
    });
    expect(finishedLong.clock.addedTimeSec).toBe(0);
  });

  test('組別沒寫比賽長度時，defaultDurationMin 會改變重疊判斷', () => {
    const start = taipeiMs('2026-10-11', '10:00');
    const matches = [
      {
        matchId: 'm1', divisionId: 'd', venueId: 'f1', kickoffMs: start,
        teamIds: ['a', 'b'], home: { teamId: 'a', name: 'a' }, away: { teamId: 'b', name: 'b' }
      },
      {
        matchId: 'm2', divisionId: 'd', venueId: 'f1', kickoffMs: start + 10 * 60000,
        teamIds: ['c', 'd'], home: { teamId: 'c', name: 'c' }, away: { teamId: 'd', name: 'd' }
      }
    ];
    const venues = [{ venueId: 'f1', name: 'f1', fieldType: '9v9' }];
    const divisions = [{ divisionId: 'd' }];
    const overlap = checkSchedule({ matches, venues, divisions, minRestMin: 0, maxGapMin: 9999 });
    expect(overlap.findings.some(f => f.code === 'VENUE_OVERLAP')).toBe(true);
    const short = checkSchedule({
      matches, venues, divisions, minRestMin: 0, maxGapMin: 9999, defaultDurationMin: 5
    });
    expect(short.findings.some(f => f.code === 'VENUE_OVERLAP')).toBe(false);
  });

  test('飛達盃專屬常數還在，數值沒改', () => {
    expect(APPEAL_RULES).toMatchObject({ windowMin: 30, deposit: 2000 });
    expect(REFUND_RULES).toMatchObject({ noRefundWithinDays: 15, transferNoticeDays: 3 });
    expect(REGISTRATION_LIMITS).toMatchObject({ maxPlayers: 15, maxStaff: 3 });
    expect(SCHEDULE_DEFAULTS).toMatchObject({
      startTime: '08:30', endTime: '18:00', bufferMin: 10, minRestMin: 20, maxGapMin: 240
    });
    expect(DIVISIONS).toHaveLength(6);
  });
});
