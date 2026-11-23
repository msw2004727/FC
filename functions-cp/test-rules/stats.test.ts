/**
 * 射手榜 stats（顧問 §3.338 補二）。Rules 已由 PM 寫入，本檔只測。
 * get 走 canReadComp；list 與任何用戶端寫入一律拒。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { adminDb, ago, assertFails, assertSucceeds, clearDb, clientDb, closeClients, loadRules } from './_harness.js';
import { seedBase } from './_fixtures.js';

const as = (uid: string, role?: string) => clientDb({ uid, ...(role ? { role } : {}) });
const anon = () => clientDb(null);
const statsPath = (cid: string, dvId = 'dv_1') => `competitions/${cid}/stats/${dvId}`;

beforeAll(async () => {
  await loadRules();
  await clearDb();
  await seedBase();
  const db = adminDb();
  const b = db.batch();
  for (const cid of ['cp_pub', 'cp_int', 'cp_hidden']) {
    b.set(db.doc(statsPath(cid)), {
      m: { mt_1: { pl_1: { n: '球員', g: 1, y: 0, r: 0 } } },
      updatedAt: ago(30)
    });
  }
  await b.commit();
});
afterEach(async () => { await closeClients(); });
afterAll(async () => { await clearDb(); });

describe('stats get', () => {
  it('公開且已發布：未登入與一般會員可 get', async () => {
    for (const db of [anon(), as('stranger')]) {
      const snap = await assertSucceeds(getDoc(doc(db, statsPath('cp_pub'))));
      expect(snap.data()?.m).toEqual({ mt_1: { pl_1: { n: '球員', g: 1, y: 0, r: 0 } } });
    }
  });

  it('內部期：非測試者不可 get；測試者可 get；管理員可 get', async () => {
    for (const db of [anon(), as('stranger'), as('host'), as('co'), as('rep')]) {
      await assertFails(getDoc(doc(db, statsPath('cp_int'))));
    }
    expect((await assertSucceeds(getDoc(doc(as('tester'), statsPath('cp_int'))))).data()?.m.mt_1.pl_1.n).toBe('球員');
    expect((await assertSucceeds(getDoc(doc(as('admin', 'admin'), statsPath('cp_int'))))).data()?.m.mt_1.pl_1.n).toBe('球員');
  });

  it('已下架：一般人不可 get；主辦、共同主辦、管理員可 get；測試者不可', async () => {
    for (const db of [anon(), as('stranger'), as('tester'), as('rep')]) {
      await assertFails(getDoc(doc(db, statsPath('cp_hidden'))));
    }
    for (const db of [as('host'), as('co'), as('admin', 'admin')]) {
      expect((await assertSucceeds(getDoc(doc(db, statsPath('cp_hidden'))))).data()?.m.mt_1.pl_1.n).toBe('球員');
    }
  });
});

describe('stats list 一律拒', () => {
  it('未登入、一般會員、主辦、測試者、管理員，帶 limit 或不帶，都拒', async () => {
    for (const db of [anon(), as('stranger'), as('host'), as('co'), as('tester'), as('admin', 'admin')]) {
      await assertFails(getDocs(collection(db, 'competitions/cp_pub/stats')));
      await assertFails(getDocs(query(collection(db, 'competitions/cp_pub/stats'), limit(1))));
      await assertFails(getDocs(query(collection(db, 'competitions/cp_pub/stats'), limit(100))));
    }
    // 讀得到單份的人也不能 list
    await assertFails(getDocs(query(collection(as('tester'), 'competitions/cp_int/stats'), limit(1))));
    await assertFails(getDocs(query(collection(as('admin', 'admin'), 'competitions/cp_hidden/stats'), limit(1))));
    await assertFails(getDocs(query(collection(as('host'), 'competitions/cp_hidden/stats'), limit(50))));
  });
});

describe('stats 用戶端寫入一律拒', () => {
  it('未登入、一般會員、主辦、管理員不能 create／update／delete', async () => {
    for (const db of [anon(), as('stranger'), as('host'), as('admin', 'admin')]) {
      await assertFails(setDoc(doc(db, statsPath('cp_pub', 'dv_new')), { m: {}, updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(db, statsPath('cp_pub')), { 'm.mt_1': {} }));
      await assertFails(deleteDoc(doc(db, statsPath('cp_pub'))));
    }
    const co = as('co');
    await assertFails(setDoc(doc(co, statsPath('cp_pub', 'dv_co')), { m: {} }));
    await assertFails(updateDoc(doc(co, statsPath('cp_pub')), { updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(co, statsPath('cp_pub'))));
  });
});
