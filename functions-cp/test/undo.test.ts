/**
 * T31 完賽後三分鐘自撤回
 * ------------------------------------------------------------------
 * 規格：docs/10 §5.3、firestore.rules 分支 (D)
 *
 * 這個功能最容易做錯的地方不是「三分鐘算對沒有」，
 * 而是**離線時畫出一個倒數**：賽務照著按，恢復連線的瞬間被 rules 擋掉，
 * 那就是假成功——不可協商的產品行為第 1 條。
 */

import {
  undoState, buildUndoPatch, lastPlayedPeriod, UNDO_WINDOW_SEC
} from '../src/engine/live-actions.js';

const T0 = Date.parse('2026-10-09T10:00:00+08:00');
const ts = ms => ({ toMillis: () => ms });          // 模擬 Firestore Timestamp

const finished = (over = {}) => ({
  matchId: 'm1', status: 'finished', venueId: 'venue-a',
  scoreSubmittedBy: 'u1', scoreSubmittedAt: ts(T0),
  score: { home: 2, away: 1 },
  lock: { locked: true, lockedBy: 'u1' },
  ...over
});

const ask = ({ match, ...rest } = {}, at = T0 + 1000) =>
  undoState({ nowMs: at, online: true, uid: 'u1', ...rest, match: finished(match) });

describe('T31-1 時間視窗', () => {
  test('剛送出：可以撤回，倒數接近三分鐘', () => {
    const u = ask({}, T0 + 1000);
    expect(u.can).toBe(true);
    expect(u.leftSec).toBe(UNDO_WINDOW_SEC - 1);
  });

  test('第 179 秒還可以，第 180 秒整就不行了', () => {
    expect(ask({}, T0 + 179_000).can).toBe(true);
    expect(ask({}, T0 + 180_000).can).toBe(false);
    expect(ask({}, T0 + 180_000).reason).toContain('3 分鐘');
  });

  test('⭐ 超時之後不給倒數，只給下一步（找管理員）', () => {
    const u = ask({}, T0 + 600_000);
    expect(u.can).toBe(false);
    expect(u.leftSec).toBeNull();
    expect(u.reason).toContain('管理員');
  });
});

describe('T31-2 ⭐ 離線一律不給撤回，而且不畫倒數', () => {
  test('離線時即使時間還在視窗內也不可以', () => {
    const u = ask({ online: false }, T0 + 1000);
    expect(u.can).toBe(false);
    expect(u.leftSec).toBeNull();
    expect(u.reason).toContain('待同步');
  });

  test('⭐ scoreSubmittedAt 還沒被伺服器填（離線寫入）→ 不可以，也不畫倒數', () => {
    // 這是離線最真實的樣子：serverTimestamp() 在本機快照裡是 null。
    // 若這裡用 Number(null) 算時間，會得到 1970 年 → 「早就超過三分鐘」，
    // 訊息就會變成「已超過 3 分鐘」，而正確答案是「還在待同步」（R-ENG-002）。
    const u = ask({ match: { scoreSubmittedAt: null } }, T0 + 1000);
    expect(u.can).toBe(false);
    expect(u.leftSec).toBeNull();
    expect(u.reason).toContain('待同步');
    expect(u.reason).not.toContain('超過');
  });

  test('本機還有待送的寫入時也不給（pendingWrite）', () => {
    expect(ask({ pendingWrite: true }, T0 + 1000).can).toBe(false);
  });
});

describe('T31-3 誰可以撤回', () => {
  test('⭐ 只有送出的那個人可以，同場地的另一位賽務不行', () => {
    const u = ask({ uid: 'u2' }, T0 + 1000);
    expect(u.can).toBe(false);
    expect(u.reason).toContain('送出完賽');
  });

  test('⭐ 主辦覆核（confirmed）之後就不能自撤回', () => {
    const u = ask({ match: { status: 'confirmed' } }, T0 + 1000);
    expect(u.can).toBe(false);
    expect(u.reason).toContain('覆核');
  });

  test('還沒完賽的場次沒有撤回這件事', () => {
    expect(ask({ match: { status: 'live' } }, T0 + 1000).can).toBe(false);
    expect(undoState({ match: null, nowMs: T0, online: true, uid: 'u1' }).can).toBe(false);
  });

  test('沒有登入就不行（uid 為 null 時不可以誤判成「送出者也是 null」）', () => {
    expect(ask({ uid: null, match: { scoreSubmittedBy: null } }, T0 + 1000).can).toBe(false);
  });
});

describe('T31-4 撤回的 patch', () => {
  const ev = (seq, periodId) => ({ seq, type: 'period_start', periodId });

  test('⭐ 退回「實際打過的最後一個期別」，不是一律當成下半場', () => {
    expect(lastPlayedPeriod([ev(1, 'h1'), ev(9, 'h2'), ev(14, 'et1')])).toBe('et1');
    expect(lastPlayedPeriod([ev(1, 'h1')])).toBe('h1');
    // 沒資料時退回第一期：六個組別都是單節，退回 'h2' 會顯示「下半場」、時鐘從 13 分起（驗收 D-06）
    expect(lastPlayedPeriod([])).toBe('h1');
  });

  test('作廢掉的 period_start 不算', () => {
    expect(lastPlayedPeriod([ev(1, 'h1'), { ...ev(9, 'et1'), voided: true }])).toBe('h1');
  });

  test('patch 會解鎖、清掉送出記錄與 result，但不碰比分', () => {
    const p = buildUndoPatch({ uid: 'u1', events: [ev(1, 'h1'), ev(9, 'h2')] });
    expect(p.status).toBe('live');
    expect(p.period).toBe('h2');
    // lockedAt 必須在：updateDoc 對巢狀 map 是整包取代，漏一個欄位就是刪掉它
    expect(p.lock).toEqual({ locked: false, lockedAt: null, lockedBy: null });
    expect(p.result).toBeNull();
    expect(p.scoreSubmittedAt).toBeNull();
    expect(p.scoreSubmittedBy).toBeNull();
    expect(p.updatedBy).toBe('u1');
    expect('score' in p).toBe(false);      // 比分是使用者的資料，撤回不該動它
  });

  test('⭐ patch 的欄位必須全部在 rules 分支 (D) 的白名單內', async () => {
    const fs = await import('node:fs');
        // ported: 這個 repo 的 firestore.rules 不是飛達盃賽務規則，改讀測試夾具，斷言不變
    const rules = fs.readFileSync(new URL('./fixtures/feda-match-undo.rules', import.meta.url), 'utf8');
    const d = rules.slice(rules.indexOf('// (D) 三分鐘自撤回'));
    const allowed = [...d.slice(0, d.indexOf(';')).matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]);

    const p = buildUndoPatch({ uid: 'u1', events: [] });
    // updatedAt 由 data.js 補上，不在 patch 裡
    for (const k of Object.keys(p)) expect(allowed).toContain(k);
  });

  test('⭐ 視窗長度與 rules 的 duration.value 一致', async () => {
    const fs = await import('node:fs');
        // ported: 這個 repo 的 firestore.rules 不是飛達盃賽務規則，改讀測試夾具，斷言不變
    const rules = fs.readFileSync(new URL('./fixtures/feda-match-undo.rules', import.meta.url), 'utf8');
    const m = rules.match(/duration\.value\((\d+),\s*'m'\)/);
    expect(m).not.toBeNull();
    expect(Number(m[1]) * 60).toBe(UNDO_WINDOW_SEC);
  });

  test('⭐ rules 必須守住「完賽即鎖定」——這是三分鐘視窗的前提', async () => {
    // 分支 (D) 之所以有存在的必要，是因為完賽當下場次就被鎖了。
    // 一旦「完賽但不上鎖」是允許的，分支 (B) 的 lock.locked == false
    // 會永遠成立，已完賽的比分就變成可以無限期改寫，三分鐘形同虛設。
    const fs = await import('node:fs');
        // ported: 這個 repo 的 firestore.rules 不是飛達盃賽務規則，改讀測試夾具，斷言不變
    const rules = fs.readFileSync(new URL('./fixtures/feda-match-undo.rules', import.meta.url), 'utf8');

    const fn = rules.slice(rules.indexOf('function finishMustLock()'));
    const body = fn.slice(0, fn.indexOf('}'));
    expect(body).toMatch(/status\s*!=\s*'finished'/);
    expect(body).toMatch(/lock\.locked\s*==\s*true/);

    // 函式寫得再對，分支 (B) 沒呼叫它也是白搭
    const b = rules.slice(rules.indexOf('// (B) 賽務'), rules.indexOf('// (C)'));
    expect(b).toContain('finishMustLock()');
  });
});
