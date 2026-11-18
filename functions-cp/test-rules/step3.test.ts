/**
 * 第 3 步 Rules：伺服器寫的積分、摘要、賽程欄位，用戶端一律不能寫；
 * 已確認／棄權／改期／待確認（主辦登錄）場次不能直寫記分；公開讀取照父文件條件。
 * F1：用戶端不能把場次改成 cancelled，也不能寫賽事 endedBy／endReason。
 * F3：用戶端不能直寫積分榜的 manualOverride 或列上的 decidedBy。
 * F4：用戶端不能直寫賽事根文件的 notices、contactNote，也不能直寫積分榜的 divisionName。
 * F2：用戶端不能直寫賽事根文件的 lastMatchAt、lastMatchOriginAt。
 * （Rules 檔本步未改；本檔只補拒絕與通過案例，防止之後改 Rules 時退步。）
 */
import { afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import { adminDb, assertFails, assertSucceeds, clearDb, clientDb, closeClients, loadRules } from './_harness.js';
import { patchMatch, seedBase, setCurrentScorer } from './_fixtures.js';

const as = (uid: string, role?: string) => clientDb({ uid, ...(role ? { role } : {}) });
const base = (cid = 'cp_pub', mt = 'mt_1') => `competitions/${cid}/matches/${mt}`;

function goalBatch(uid: string, fromRev: number, cid = 'cp_pub', role?: string, score = { home: 2, away: 0 }) {
  const db = as(uid, role);
  const b = writeBatch(db);
  b.update(doc(db, base(cid)), { rev: fromRev + 1, score, updatedAt: serverTimestamp() });
  b.set(doc(db, `${base(cid)}/timeline/e${fromRev + 1}`), {
    seq: fromRev + 1, type: 'goal', side: 'home', plId: 'pl_1', goalKind: 'normal', matchSecond: 900, createdAt: serverTimestamp()
  });
  return b.commit();
}

beforeAll(async () => { await loadRules(); });
beforeEach(async () => { await clearDb(); await seedBase(); });
afterEach(async () => { await closeClients(); });

describe('伺服器寫的文件：用戶端不能寫', () => {
  for (const who of [['host'], ['co'], ['s1'], ['admin', 'admin'], ['tester']] as Array<[string, string?]>) {
    it(`${who[0]} 不能寫 standings／summary／divisions，也不能刪`, async () => {
      const db = as(who[0], who[1]);
      await assertFails(setDoc(doc(db, 'competitions/cp_pub/standings/dv_1__group__A'), { rows: [] }));
      await assertFails(updateDoc(doc(db, 'competitions/cp_pub/standings/dv_1__group__A'), { version: 9 }));
      await assertFails(deleteDoc(doc(db, 'competitions/cp_pub/standings/dv_1__group__A')));
      await assertFails(setDoc(doc(db, 'competitions/cp_pub/summary/d20990101'), { m: {} }));
      await assertFails(updateDoc(doc(db, 'competitions/cp_pub/summary/d1'), { m: { x: 1 } }));
      await assertFails(updateDoc(doc(db, 'competitions/cp_pub/divisions/dv_1'), { schedule: { legs: 2 } }));
      await assertFails(setDoc(doc(db, 'competitions/cp_pub/matches/mt_new'), { status: 'scheduled' }));
      await assertFails(deleteDoc(doc(db, base())));
    });
  }
});

describe('場次：伺服器欄位與狀態不能被直寫', () => {
  const forbidden: Array<[string, Record<string, unknown>]> = [
    ['status → confirmed', { status: 'confirmed' }],
    ['status → walkover', { status: 'walkover', walkoverSide: 'away' }],
    ['status → postponed', { status: 'postponed' }],
    ['status → cancelled', { status: 'cancelled' }],
    ['cancelReason', { cancelReason: '場地下雨' }],
    ['cancelledAt', { cancelledAt: new Date() }],
    ['resetRev', { resetRev: 0 }],
    ['resultSource', { resultSource: 'host' }],
    ['result', { result: { winner: 'home' } }],
    ['kickoffAt', { kickoffAt: new Date() }],
    ['confirmedAt', { confirmedAt: new Date() }],
    ['venueName', { venueName: '別的場' }]
  ];
  for (const [name, patch] of forbidden) {
    it(`目前記分者帶 ${name}（附合法事件）被拒`, async () => {
      const db = as('s1');
      const b = writeBatch(db);
      b.update(doc(db, base()), { rev: 4, updatedAt: serverTimestamp(), ...patch });
      b.set(doc(db, `${base()}/timeline/e4`), { seq: 4, type: 'card', side: 'away', plId: 'pl_2', cardType: 'yellow', matchSecond: 900, createdAt: serverTimestamp() });
      await assertFails(b.commit());
    });
  }

  it('對照：同一位目前記分者的合法進球通過（證明上面是被條件擋下）', async () => {
    await assertSucceeds(goalBatch('s1', 3));
  });

  for (const status of ['confirmed', 'walkover', 'postponed', 'scheduled', 'cancelled'] as const) {
    it(`場次為 ${status} 時不能記進球`, async () => {
      await patchMatch('cp_pub', { status, lock: { locked: status === 'confirmed' || status === 'walkover' } });
      await assertFails(goalBatch('s1', 3));
    });
  }

  it('主辦登錄後待確認（finished＋locked）不能記進球；非目前記分者不能撤回（目前記分者可否撤回主辦結果留第 4 步定）', async () => {
    await patchMatch('cp_pub', { status: 'finished', lock: { locked: true }, finishedAt: new Date(), resultSource: 'host' });
    await assertFails(goalBatch('s1', 3));
    await setCurrentScorer('cp_pub', 's2');
    const db = as('s1');
    const b = writeBatch(db);
    b.update(doc(db, base()), { rev: 4, status: 'live', lock: { locked: false }, finishedAt: null, updatedAt: serverTimestamp() });
    b.set(doc(db, `${base()}/timeline/e4`), { seq: 4, type: 'undoFinish', matchSecond: 900, createdAt: serverTimestamp() });
    await assertFails(b.commit());
  });

  it('重置後（rev 只增）用舊 rev 的離線寫入被拒', async () => {
    await adminDb().doc(base()).set({ rev: 5, resetRev: 5, status: 'live', score: { home: 0, away: 0 } }, { merge: true });
    await assertFails(goalBatch('s1', 3, 'cp_pub', undefined, { home: 1, away: 0 }));
    await assertSucceeds(goalBatch('s1', 5, 'cp_pub', undefined, { home: 1, away: 0 }));
  });
});

describe('F1：用戶端不能寫取消與結束欄位', () => {
  for (const who of [['host'], ['co'], ['s1'], ['admin', 'admin']] as Array<[string, string?]>) {
    it(`${who[0]} 不能寫 endedBy／endReason，也不能把場次改成 cancelled`, async () => {
      const db = as(who[0], who[1]);
      await assertFails(updateDoc(doc(db, 'competitions/cp_pub'), { endedBy: 'host' }));
      await assertFails(updateDoc(doc(db, 'competitions/cp_pub'), { endReason: '提前結束' }));
      await assertFails(updateDoc(doc(db, 'competitions/cp_pub'), { endedAt: new Date(), endedBy: 'host', endReason: '提前結束' }));
      await assertFails(updateDoc(doc(db, base()), { status: 'cancelled', rev: 4, updatedAt: serverTimestamp() }));
    });
  }
});

describe('F3：用戶端不能直寫同分裁定', () => {
  for (const who of [['host'], ['co'], ['s1'], ['admin', 'admin']] as Array<[string, string?]>) {
    it(`${who[0]} 不能寫 manualOverride，也不能寫列上的 decidedBy`, async () => {
      const db = as(who[0], who[1]);
      const ref = doc(db, 'competitions/cp_pub/standings/dv_1__group__A');
      await assertFails(updateDoc(ref, {
        manualOverride: { enabled: true, by: 'x', at: null, reason: '裁定', method: 'host', order: ['en_h'], decidedAt: null }
      }));
      await assertFails(updateDoc(ref, {
        rows: [{ teamId: 'en_h', decidedBy: 'host', rank: 1, locked: true }]
      }));
      await assertFails(setDoc(ref, {
        manualOverride: { enabled: true, method: 'drawLots', order: ['en_h'] },
        rows: [{ teamId: 'en_h', decidedBy: 'drawLots' }]
      }));
    });
  }
});

describe('公開讀取：積分與摘要照父文件條件', () => {
  it('公開已發布賽事：未登入可讀積分與摘要（list 要帶 limit）', async () => {
    const db = clientDb(null);
    await assertSucceeds(getDoc(doc(db, 'competitions/cp_pub/standings/dv_1__group__A')));
    await assertSucceeds(getDocs(query(collection(db, 'competitions/cp_pub/summary'), limit(14))));
    await assertFails(getDocs(collection(db, 'competitions/cp_pub/summary')));
    await assertFails(getDocs(query(collection(db, 'competitions/cp_pub/summary'), limit(101))));
  });
  for (const cid of ['cp_draft', 'cp_hidden', 'cp_int']) {
    it(`${cid}：一般會員讀不到積分、摘要、場次`, async () => {
      const db = as('stranger');
      await assertFails(getDoc(doc(db, `competitions/${cid}/standings/dv_1__group__A`)));
      await assertFails(getDoc(doc(db, `competitions/${cid}/summary/d1`)));
      await assertFails(getDocs(query(collection(db, `competitions/${cid}/matches`), limit(10))));
    });
  }
  it('內部賽事：測試者讀得到積分與摘要', async () => {
    const db = as('tester');
    await assertSucceeds(getDoc(doc(db, 'competitions/cp_int/standings/dv_1__group__A')));
    await assertSucceeds(getDoc(doc(db, 'competitions/cp_int/summary/d1')));
  });
});

describe('F4：用戶端不能直寫公告、聯絡文字、組別名稱', () => {
  for (const who of [['host'], ['co'], ['s1'], ['admin', 'admin'], ['stranger']] as Array<[string, string?]>) {
    it(`${who[0]} 不能寫 notices、contactNote、divisionName`, async () => {
      const db = as(who[0], who[1]);
      const comp = doc(db, 'competitions/cp_pub');
      await assertFails(updateDoc(comp, { notices: [{ id: 'nt_x', text: '公告', kind: 'host' }] }));
      await assertFails(updateDoc(comp, { contactNote: '加我的 LINE' }));
      await assertFails(updateDoc(comp, { notices: [], contactNote: null }));
      await assertFails(setDoc(comp, { notices: [], contactNote: '窗口' }, { merge: true }));
      const standing = doc(db, 'competitions/cp_pub/standings/dv_1__group__A');
      await assertFails(updateDoc(standing, { divisionName: '假組別' }));
      await assertFails(setDoc(standing, { divisionName: '假組別', rows: [] }));
      // 沒有開放 notices 子集合。預設拒絕。
      await assertFails(setDoc(doc(db, 'competitions/cp_pub/notices/nt_1'), { text: '公告', kind: 'host' }));
    });
  }

  it('公開已發布賽事：未登入讀得到根文件（公告與聯絡文字在這份文件上）', async () => {
    const db = clientDb(null);
    await assertSucceeds(getDoc(doc(db, 'competitions/cp_pub')));
    await assertSucceeds(getDoc(doc(db, 'competitions/cp_pub/standings/dv_1__group__A')));
  });
});

describe('F2：用戶端不能直寫末場與原末場', () => {
  for (const who of [['host'], ['co'], ['s1'], ['admin', 'admin'], ['stranger']] as Array<[string, string?]>) {
    it(`${who[0]} 不能寫 lastMatchAt、lastMatchOriginAt`, async () => {
      const db = as(who[0], who[1]);
      const comp = doc(db, 'competitions/cp_pub');
      const later = new Date(Date.now() + 86400_000);
      await assertFails(updateDoc(comp, { lastMatchAt: later }));
      await assertFails(updateDoc(comp, { lastMatchOriginAt: later }));
      await assertFails(updateDoc(comp, { lastMatchAt: later, lastMatchOriginAt: later }));
      await assertFails(setDoc(comp, { lastMatchAt: later, lastMatchOriginAt: later }, { merge: true }));
    });
  }
});
