/**
 * V13：離線佇列中某筆被拒時，後續待送寫入的行為（模擬器實測，寫成測試鎖住結論）
 *
 * 情境 A：s1 離線連記兩球（rev 3→4→5），期間 s2 接手 → 連線後兩筆都被拒（非目前記分者），
 *         本機快取回滾到伺服器狀態。
 * 情境 B（K1 ② 改寫）：同一帳號第二裝置先接手（新 sid）→ 第一裝置離線兩筆都因 sid 不符被拒。
 *         舊結論「第二筆可能成功」不再成立。動作日誌仍以伺服器確認結果為準。
 */
import { describe, it, beforeAll, beforeEach, afterEach, expect } from 'vitest';
import { doc, getDoc, onSnapshot, writeBatch, serverTimestamp, disableNetwork, enableNetwork, setDoc, type Firestore } from 'firebase/firestore';
import { loadRules, clearDb, clientDb, closeClients, adminDb, assertSucceeds } from './_harness.js';
import { seedBase, SID_S1, SID_S2, OP_OK } from './_fixtures.js';

function goalBatch(db: Firestore, fromRev: number, home: number, sid = SID_S1) {
  const base = 'competitions/cp_pub/matches/mt_1';
  const b = writeBatch(db);
  b.update(doc(db, base), { rev: fromRev + 1, updatedAt: serverTimestamp(), score: { home, away: 0 } });
  b.set(doc(db, `${base}/timeline/e${fromRev + 1}`),
    { seq: fromRev + 1, type: 'goal', side: 'home', goalKind: 'normal', matchSecond: 1000 + fromRev, createdAt: serverTimestamp(), sid, op: OP_OK });
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
      { uid: 's2', takenAt: serverTimestamp(), sid: SID_S2 }));
    await enableNetwork(db);
    expect(await p1).toBe('rejected:permission-denied');
    expect(await p2).toBe('rejected:permission-denied');
    const server = (await adminDb().doc('competitions/cp_pub/matches/mt_1').get()).data();
    expect(server?.rev).toBe(3);
    await new Promise(r => setTimeout(r, 500));
    expect(latest?.score).toEqual({ home: 1, away: 0 });   // 被拒後 SDK 自動回滾樂觀值
    unsub();
  });

  it('情境 B：同帳號第二裝置先接手 → 第一裝置離線兩筆都被拒', async () => {
    const dev1 = clientDb({ uid: 's1' });
    const dev2 = clientDb({ uid: 's1' });
    await getDoc(doc(dev1, 'competitions/cp_pub/matches/mt_1'));
    await disableNetwork(dev1);
    const p1 = settle(goalBatch(dev1, 3, 2, SID_S1));
    const p2 = settle(goalBatch(dev1, 4, 3, SID_S1));
    // 同一帳號換手機：先寫新 sid。舊手機之後的寫入因 sid 不符全部被拒（V13 情境 B 翻轉）。
    await assertSucceeds(setDoc(doc(dev2, 'competitions/cp_pub/matches/mt_1/control/scorer'),
      { uid: 's1', takenAt: serverTimestamp(), sid: SID_S2 }));
    await enableNetwork(dev1);
    expect(await p1).toBe('rejected:permission-denied');
    expect(await p2).toBe('rejected:permission-denied');
    const server = (await adminDb().doc('competitions/cp_pub/matches/mt_1').get()).data();
    expect(server?.rev).toBe(3);
    expect(server?.score).toEqual({ home: 1, away: 0 });
  });
});
