/**
 * 比分對帳與比賽時鐘的邊界。鎖定飛達盃引擎現有行為，不另發明規則。
 */
import { describe, expect, test } from 'vitest';
import {
  buildClockCorrection,
  computeRows,
  effectiveScore,
  elapsedSec,
  emptyClock,
  isInAddedTime,
  isPlayingPeriod,
  matchResult,
  nextPeriod,
  pauseClock,
  PERIOD_FLOW,
  reconcileScore,
  scoreFromTimeline,
  startClock,
  statusForPeriod
} from '../src/engine/index.js';
import { RANKING_RULES } from '../src/engine/formats.js';
import { mk } from './_helpers.js';

const RULE = RANKING_RULES.RR_FEDA_DEFAULT;
const T0 = Date.parse('2026-10-11T09:30:00+08:00');

describe('延長賽與 PK', () => {
  const events = [
    { type: 'goal', side: 'home', periodId: 'et1', voided: false },
    { type: 'goal', side: 'away', periodId: 'et2', voided: false },
    { type: 'penalty_scored', side: 'home', periodId: 'pk', voided: false }
  ];

  test('延長賽進球計入比分，PK 預設不計', () => {
    expect(scoreFromTimeline(events)).toEqual({ home: 1, away: 1 });
    expect(scoreFromTimeline(events, { includeShootout: true })).toEqual({ home: 2, away: 1 });
    expect(reconcileScore({ home: 1, away: 1 }, events).ok).toBe(true);
    expect(reconcileScore({ home: 2, away: 1 }, events).ok).toBe(false);
  });

  test('PK 決勝不改積分榜：正規時間平手仍是和局', () => {
    const decided = matchResult({ home: 1, away: 1 }, { home: 5, away: 4 });
    expect(decided).toMatchObject({ winner: 'home', method: 'penalty' });
    const rows = computeRows(['A', 'B'], [
      mk('m1', 'A', 'B', 1, 1, {
        penaltyScore: { home: 5, away: 4 },
        result: { winner: 'home', method: 'penalty' }
      })
    ], RULE);
    const by = Object.fromEntries(rows.map(r => [r.teamId, r]));
    expect(by.A.points).toBe(1);
    expect(by.B.points).toBe(1);
    expect(by.A.draw).toBe(1);
    expect(by.A.win).toBe(0);
  });
});

describe('棄權', () => {
  test('reconcileScore 不認得棄權，0:2 又沒有進球事件就是對不上', () => {
    const reconciled = reconcileScore({ home: 0, away: 2 }, []);
    expect(reconciled.ok).toBe(false);
    expect(reconciled.derived).toEqual({ home: 0, away: 0 });
  });

  test('積分榜用棄權設定，不看場上寫的比分', () => {
    const match = mk('m1', 'A', 'B', 9, 9, { status: 'walkover', walkoverSide: 'away' });
    const scored = effectiveScore(match);
    expect(scored).toMatchObject({ home: 2, away: 0, isWalkover: true });
    const rows = computeRows(['A', 'B'], [match], RULE);
    const by = Object.fromEntries(rows.map(r => [r.teamId, r]));
    expect(by.A.points).toBe(3);
    expect(by.B.points).toBe(0);
    expect(by.A.goalsFor).toBe(2);
  });
});

describe('改期、半場、補時、單節', () => {
  test('postponed 與 cancelled 不進積分榜', () => {
    const rows = computeRows(['A', 'B'], [
      mk('m1', 'A', 'B', 3, 0, { status: 'postponed' }),
      mk('m2', 'A', 'B', 2, 0, { status: 'cancelled' })
    ], RULE);
    expect(rows.find(r => r.teamId === 'A').played).toBe(0);
    expect(rows.find(r => r.teamId === 'A').points).toBe(0);
  });

  test('沒有改期這個期別；現有流程不會把 postponed 走成下一節', () => {
    expect(nextPeriod('postponed')).toBeNull();
    expect(nextPeriod('cancelled')).toBeNull();
    expect(PERIOD_FLOW.postponed).toBeUndefined();
  });

  test('半場暫停：狀態是 halftime，時鐘停住', () => {
    expect(statusForPeriod('ht')).toBe('halftime');
    expect(isPlayingPeriod('ht')).toBe(false);
    const paused = pauseClock(startClock(emptyClock(), T0), T0 + 5000);
    expect(paused.running).toBe(false);
    expect(elapsedSec(paused, T0 + 999000)).toBe(5);
  });

  test('超過正規時間才記補時', () => {
    expect(isInAddedTime({ running: false, elapsedSecAtPause: 899, periodStartedAt: null, addedTimeSec: 0 }, 'h1', 30)).toBe(false);
    expect(isInAddedTime({ running: false, elapsedSecAtPause: 901, periodStartedAt: null, addedTimeSec: 0 }, 'h1', 30)).toBe(true);
    const correction = buildClockCorrection({
      match: { status: 'live', period: 'h1', clock: { running: false, elapsedSecAtPause: 0 } },
      division: { periods: 2, matchDurationMin: 30 },
      seconds: 1000,
      nowMs: T0
    });
    expect(correction.addedTimeSec).toBe(100);
  });

  test('單節比賽 h1 結束進 ft；平手且黃金進球才進 et1。et2 黃金進球不進 PK', () => {
    expect(nextPeriod('h1', { periods: 1 })).toBe('ft');
    expect(nextPeriod('h1', { periods: 1, tied: true, drawRule: 'penalty' })).toBe('ft');
    expect(nextPeriod('h1', { periods: 1, tied: true, drawRule: 'goldenGoal' })).toBe('et1');
    expect(nextPeriod('et2', { tied: true, drawRule: 'goldenGoal' })).toBe('ft');
    expect(nextPeriod('et2', { tied: true, drawRule: 'penalty' })).toBe('pk');
    expect(nextPeriod('et2', { tied: false, drawRule: 'penalty' })).toBe('ft');
  });
});
