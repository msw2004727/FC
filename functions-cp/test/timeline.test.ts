/**
 * T32 由事件流推算比分（js/engine/timeline.js）
 * ------------------------------------------------------------------
 * 這段邏輯 M3.9 之前只長在賽務端。搬進引擎之後，Cloud Function 對帳
 * 用的是同一份實作（R-ENG-001），所以它的邊界要在這裡守住，
 * 而不是散在 live-actions 的測試裡。
 */
import { scoreFromTimeline, reconcileScore, GOAL_EVENT_TYPES, isLive } from '../src/engine/timeline.js';

const ev = (over = {}) => ({ type: 'goal', side: 'home', voided: false, ...over });

describe('T32-1 scoreFromTimeline', () => {
  test('進球與罰球進都算分', () => {
    expect(scoreFromTimeline([ev(), ev({ type: 'penalty_scored' }), ev({ side: 'away' })]))
      .toEqual({ home: 2, away: 1 });
  });

  test('⭐ 烏龍球記給對隊', () => {
    expect(scoreFromTimeline([ev({ type: 'own_goal', side: 'home' })])).toEqual({ home: 0, away: 1 });
    expect(scoreFromTimeline([ev({ type: 'own_goal', side: 'away' })])).toEqual({ home: 1, away: 0 });
  });

  test('作廢的事件不算，非進球型別不算，side 不明的不算', () => {
    expect(scoreFromTimeline([
      ev({ voided: true }),
      ev({ type: 'card' }),
      ev({ type: 'penalty_missed' }),
      ev({ side: 'neutral' }),
      ev({ side: null })
    ])).toEqual({ home: 0, away: 0 });
  });

  test('null / 空陣列不會爆', () => {
    expect(scoreFromTimeline(null)).toEqual({ home: 0, away: 0 });
    expect(scoreFromTimeline([])).toEqual({ home: 0, away: 0 });
  });

  test('⭐ GOAL_EVENT_TYPES 必須含 own_goal——它跟射手榜那組是兩回事', async () => {
    expect(GOAL_EVENT_TYPES).toContain('own_goal');
    const { SCORING_TYPES } = await import('../src/engine/awards.js');
    expect(SCORING_TYPES).not.toContain('own_goal');   // 烏龍球不是他的進球
  });

  test('isLive 只看 voided', () => {
    expect(isLive({ voided: false })).toBe(true);
    expect(isLive({ voided: true })).toBe(false);
    expect(isLive(null)).toBe(false);
  });
});

describe('T32-2 reconcileScore', () => {
  test('一致與不一致', () => {
    expect(reconcileScore({ home: 1, away: 0 }, [ev()]).ok).toBe(true);
    expect(reconcileScore({ home: 2, away: 0 }, [ev()]).ok).toBe(false);
    expect(reconcileScore({ home: 3, away: 0 }, []).ok).toBe(false);
  });

  test('⭐ 比分沒填不可以當成 0（R-ENG-002）', () => {
    // Number(null) 是 0。若用它換算，「還沒登錄比分」＋「還沒有任何事件」
    // 會被判成 0:0 一致——一場根本沒記錄的比賽會安靜地通過對帳。
    const r = reconcileScore({ home: null, away: null }, []);
    expect(r.complete).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.entered).toEqual({ home: null, away: null });

    expect(reconcileScore({ home: '2', away: 0 }, [ev(), ev()]).complete).toBe(false);
    expect(reconcileScore(undefined, []).complete).toBe(false);
  });

  test('derived 一定算得出來，就算比分沒填', () => {
    expect(reconcileScore(null, [ev(), ev({ side: 'away' })]).derived).toEqual({ home: 1, away: 1 });
  });
});
