/**
 * 比賽時鐘。只移植純函式案例。
 * 不移植（測 format.js 的畫面文字，或測已刪除的伺服器時間 offset／now）：
 * - offset 會反映在 now()：依賴 setServerOffset／now／getServerOffset，引擎不移植這三支
 * - 離譜的 offset 一律忽略（超過一天視為資料錯誤）：同上
 * - 成人組 30 分鐘：上半場 15 分、下半場從 15 分起算：displayMinute，屬 UI 格式化
 * - 兒童組 20 分鐘：下半場從 10 分起算：displayMinute，屬 UI 格式化
 * - ⭐ 補時顯示 15+2 而不是 17（且分界依 matchDurationMin）：displayMinute，屬 UI 格式化
 * - 90 分鐘制沿用同一套公式，得到熟悉的 45+3：displayMinute，屬 UI 格式化
 * - 非比賽期別不顯示分鐘：displayMinute，屬 UI 格式化
 * - 計時器文字是等寬的 mm:ss：clockText，屬 UI 格式化
 */
import {
  elapsedSec, startClock, pauseClock, resetClock, emptyClock,
  nextPeriod, statusForPeriod, isPlayingPeriod, periodLimitSec, isInAddedTime
} from '../src/engine/clock.js';

const T0 = Date.parse('2026-10-11T09:30:00+08:00');

describe('計時基本行為', () => {
  test('未開始時是 0', () => {
    expect(elapsedSec(emptyClock(), T0)).toBe(0);
    expect(elapsedSec(null, T0)).toBe(0);
  });

  test('跑動中依現在時間累加', () => {
    const c = startClock(emptyClock(), T0);
    expect(elapsedSec(c, T0)).toBe(0);
    expect(elapsedSec(c, T0 + 63_000)).toBe(63);
  });

  test('暫停後固定秒數，時間再過也不動', () => {
    const c = pauseClock(startClock(emptyClock(), T0), T0 + 63_000);
    expect(c.running).toBe(false);
    expect(c.elapsedSecAtPause).toBe(63);
    expect(elapsedSec(c, T0 + 999_000)).toBe(63);
  });

  test('繼續後從暫停點累加', () => {
    const paused = pauseClock(startClock(emptyClock(), T0), T0 + 60_000);
    const resumed = startClock(paused, T0 + 300_000);
    expect(elapsedSec(resumed, T0 + 300_000)).toBe(60);
    expect(elapsedSec(resumed, T0 + 310_000)).toBe(70);
  });

  test('⭐ 手機時間往回跳時不可倒退（校時、換時區）', () => {
    const c = startClock({ ...emptyClock(), elapsedSecAtPause: 100 }, T0);
    expect(elapsedSec(c, T0 - 60_000)).toBe(100);   // 不是 40
  });

  test('重複按開始不會重置已跑秒數', () => {
    const c = startClock(emptyClock(), T0);
    const again = startClock(c, T0 + 30_000);
    expect(elapsedSec(again, T0 + 30_000)).toBe(30);
  });

  test('換期別歸零，但保留補時設定', () => {
    const c = resetClock({ elapsedSecAtPause: 900, addedTimeSec: 120 });
    expect(c.elapsedSecAtPause).toBe(0);
    expect(c.running).toBe(false);
    expect(c.addedTimeSec).toBe(120);
  });

  test('periodStartedAt 可以是 Firestore Timestamp 或 ISO 字串', () => {
    const iso = { running: true, periodStartedAt: '2026-10-11T09:30:00+08:00', elapsedSecAtPause: 0 };
    expect(elapsedSec(iso, T0 + 45_000)).toBe(45);
    const ts = { running: true, periodStartedAt: { toMillis: () => T0 }, elapsedSecAtPause: 0 };
    expect(elapsedSec(ts, T0 + 45_000)).toBe(45);
  });

  test('running 但缺 periodStartedAt 時退回暫停秒數，不會算出 NaN', () => {
    expect(elapsedSec({ running: true, periodStartedAt: null, elapsedSecAtPause: 12 }, T0)).toBe(12);
  });
});

describe('期別狀態機', () => {
  test('正常流程 pre → h1 → ht → h2 → ft', () => {
    expect(nextPeriod('pre')).toBe('h1');
    expect(nextPeriod('h1')).toBe('ht');
    expect(nextPeriod('ht')).toBe('h2');
    expect(nextPeriod('h2')).toBe('ft');
    expect(nextPeriod('ft')).toBeNull();
  });

  test('平手且採 PK：延長下半之後進 PK', () => {
    expect(nextPeriod('et2', { tied: true, drawRule: 'penalty' })).toBe('pk');
    expect(nextPeriod('et2', { tied: false, drawRule: 'penalty' })).toBe('ft');
    expect(nextPeriod('pk')).toBe('ft');
  });

  test('黃金進球制才會從下半場進延長', () => {
    expect(nextPeriod('h2', { tied: true, drawRule: 'goldenGoal' })).toBe('et1');
    expect(nextPeriod('h2', { tied: true, drawRule: 'penalty' })).toBe('ft');
  });

  test('期別 → 場次狀態（公開端靠這個分辨中場與進行中）', () => {
    expect(statusForPeriod('pre')).toBe('ready');
    expect(statusForPeriod('h1')).toBe('live');
    expect(statusForPeriod('ht')).toBe('halftime');
    expect(statusForPeriod('h2')).toBe('live');
    expect(statusForPeriod('et1')).toBe('live');
    expect(statusForPeriod('ft')).toBe('finished');
  });

  test('只有比賽進行中的期別要跑計時器', () => {
    expect(['h1', 'h2', 'et1', 'et2'].every(isPlayingPeriod)).toBe(true);
    expect(['pre', 'ht', 'pk', 'ft'].some(isPlayingPeriod)).toBe(false);
  });
});

describe('補時判斷', () => {
  test('⭐ periods:1 時 h1 直接走到 ft，沒有中場與下半場', () => {
    // 競賽規章第十八條第 2 款：「不分上、下半場」。六個組別都是這樣。
    // 少了這個分支，賽務台會畫「結束上半場」，賽務按下去比賽就卡在中場——
    // 而且畫面上沒有任何一顆按鈕走得出來。
    expect(nextPeriod('h1', { periods: 1 })).toBe('ft');
    expect(nextPeriod('h1', { periods: 1, tied: true, drawRule: 'penalty' })).toBe('ft');
    expect(nextPeriod('h1', { periods: 1, tied: true, drawRule: 'goldenGoal' })).toBe('et1');
  });

  test('沒指定 periods 時維持原本的上下半場流程', () => {
    expect(nextPeriod('h1')).toBe('ht');
    expect(nextPeriod('h1', { periods: 2 })).toBe('ht');
  });

  test('⭐ periods:1 時 h1 的正規長度是整場，不是一半', () => {
    // 25 分鐘的比賽若照半場算，第 13 分鐘就會顯示補時，
    // 而賽務看到補時通常就準備吹哨了。
    expect(periodLimitSec('h1', 25, 5, 1)).toBe(25 * 60);
    expect(periodLimitSec('h1', 30, 5, 1)).toBe(30 * 60);
    // 兩個半場的情況不受影響
    expect(periodLimitSec('h1', 30, 5, 2)).toBe(15 * 60);
  });

  test('各期別的正規長度依 matchDurationMin 推算', () => {
    expect(periodLimitSec('h1', 30)).toBe(900);
    expect(periodLimitSec('h2', 20)).toBe(600);
    expect(periodLimitSec('et1', 30, 5)).toBe(300);
    expect(periodLimitSec('ht', 30)).toBe(0);
  });

  test('超過正規時間才算進入補時', () => {
    const at = sec => ({ running: false, elapsedSecAtPause: sec });
    expect(isInAddedTime(at(899), 'h1', 30)).toBe(false);
    expect(isInAddedTime(at(901), 'h1', 30)).toBe(true);
    expect(isInAddedTime(at(9999), 'ht', 30)).toBe(false);
  });
});
