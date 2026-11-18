/**
 * V13：離線佇列中某筆被拒時，後續待送寫入的行為（模擬器實測，寫成測試鎖住結論）
 *
 * 情境 A：s1 離線連記兩球（rev 3→4→5），期間 s2 接手 → 連線後兩筆都被拒（非目前記分者），
 *         本機快取回滾到伺服器狀態。
 * 情境 B：同一帳號兩支裝置（都是目前記分者）。裝置 1 離線記兩球；裝置 2 在線先記一球（rev 4）
 *         → 裝置 1 第一筆（rev 4）被拒，但第二筆（rev 5、比分以本機快照 +1）可能剛好符合伺服器狀態而成功。
 *         這是「被拒不一定連鎖」的反例：§6.3 第 5 點的動作日誌必須以伺服器確認結果為準，不能假設後續一定失敗。
 */
import { describe, it, beforeAll, beforeEach, afterEach, expect } from 'vitest';
import { doc, getDoc, onSnapshot, writeBatch, serverTimestamp, disableNetwork, enableNetwork, setDoc, type Firestore } from 'firebase/firestore';
import { loadRules, clearDb, clientDb, closeClients, adminDb, assertSucceeds } from './_harness.js';
import { seedBase, setCurrentScorer } from './_fixtures.js';

function goalBatch(db: Firestore, fromRev: number, home: number) {
  const base = 'competitions/cp_pub/matches/mt_1';
  const b = writeBatch(db);
  b.update(doc(db, base), { rev: fromRev + 1, updatedAt: serverTimestamp(), score: { home, away: 0 } });
  b.set(doc(db, `${base}/timeline/e${fromRev + 1}`),
    { seq: fromRev + 1, type: 'goal', side: 'home', goalKind: 'normal', matchSecond: 1000 + fromRev, createdAt: serverTimestamp() });
  return b.commit();
}
const settle = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => `rejected:${e.code}`);

beforeAll(async () => { await loadRules(); });
beforeEach(async () => { await clearDb(); await seedBase(); });
afterEach(async () => { await closeClients(); });

describe('V13 離線佇列被拒的連鎖', () => {
  it('情境 A：離線期間被接手 → 兩筆都被拒，快取回滾', async () => {
    const db = clientDb({ uid: 's1' });
    // 用監聽讓文件留在記憶體快取（記分頁實際也是監聽場次文件）
    let latest: Record<string, unknown> | undefined;
    let firstResolve!: () => void;
    const first = new Promise<void>(r => { firstResolve = r; });
    const unsub = onSnapshot(doc(db, 'competitions/cp_pub/matches/mt_1'), s => { latest = s.data(); firstResolve(); });
    await first;
    await disableNetwork(db);
    const p1 = settle(goalBatch(db, 3, 2));
    const p2 = settle(goalBatch(db, 4, 3));
    await new Promise(r => setTimeout(r, 200));
    // 離線時本機立即看到 3:0（樂觀）
    expect(latest?.score).toEqual({ home: 3, away: 0 });
    await assertSucceeds(setDoc(doc(clientDb({ uid: 's2' }), 'competitions/cp_pub/matches/mt_1/control/scorer'),
      { uid: 's2', takenAt: serverTimestamp() }));
    await enableNetwork(db);
    expect(await p1).toBe('rejected:permission-denied');
    expect(await p2).toBe('rejected:permission-denied');
    const server = (await adminDb().doc('competitions/cp_pub/matches/mt_1').get()).data();
    expect(server?.rev).toBe(3);
    await new Promise(r => setTimeout(r, 500));
    expect(latest?.score).toEqual({ home: 1, away: 0 });   // 被拒後 SDK 自動回滾樂觀值
    unsub();
  });

  it('情境 B：同帳號第二裝置先寫 → 第一筆被拒、第二筆可能成功（不保證連鎖失敗）', async () => {
    await setCurrentScorer('cp_pub', 's1');
    const dev1 = clientDb({ uid: 's1' });
    const dev2 = clientDb({ uid: 's1' });
    await getDoc(doc(dev1, 'competitions/cp_pub/matches/mt_1'));
    await disableNetwork(dev1);
    const p1 = settle(goalBatch(dev1, 3, 2));   // 意圖：第 2 球
    const p2 = settle(goalBatch(dev1, 4, 3));   // 意圖：第 3 球
    await assertSucceeds(goalBatch(dev2, 3, 2)); // 第二裝置在線記了一球（rev 4）
    await enableNetwork(dev1);
    const r1 = await p1, r2 = await p2;
    expect(r1).toBe('rejected:permission-denied');
    // 實測結論鎖在這裡：第二筆在伺服器 rev 4、score 2:0 的狀態下 rev 5／3:0／e5 全部合法 → 成功
    expect(r2).toBe('ok');
    const server = (await adminDb().doc('competitions/cp_pub/matches/mt_1').get()).data();
    expect(server?.rev).toBe(5);
    expect(server?.score).toEqual({ home: 3, away: 0 });
  });
});
