/**
 * 賽事內 audits（K3-fix2）。Rules 未改，斷言照 firestore.asia-main.rules 的實際結果。
 * get：canManageComp。list：limit 有值且 ≤100 且 canManageComp。write：一律 false。
 * 公開已發布賽事的主辦、共同主辦、管理員可以 get／list，不能寫。不是全拒。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc } from 'firebase/firestore';
import { assertFails, assertSucceeds, clearDb, clientDb, closeClients, loadRules } from './_harness.js';
import { seedBase } from './_fixtures.js';

const as = (uid: string, role?: string) => clientDb({ uid, ...(role ? { role } : {}) });
const anon = () => clientDb(null);
const pathOf = (cid: string, id = 'a1') => `competitions/${cid}/audits/${id}`;

beforeAll(async () => {
  await loadRules();
  await clearDb();
  await seedBase();
});
afterEach(async () => { await closeClients(); });
afterAll(async () => { await clearDb(); });

describe('audits get', () => {
  it('公開已發布：主辦、共同主辦、管理員可 get；記分員、一般會員、未登入不可', async () => {
    for (const db of [as('host'), as('co'), as('admin', 'admin')]) {
      const snap = await assertSucceeds(getDoc(doc(db, pathOf('cp_pub'))));
      expect(snap.get('action')).toBe('x');
    }
    for (const db of [as('s1'), as('stranger'), anon()]) {
      await assertFails(getDoc(doc(db, pathOf('cp_pub'))));
    }
  });

  it('內部賽事：管理員可 get；主辦（非測試者）、記分員、未登入不可', async () => {
    expect((await assertSucceeds(getDoc(doc(as('admin', 'admin'), pathOf('cp_int'))))).get('action')).toBe('x');
    for (const db of [as('host'), as('co'), as('s1'), as('tester'), anon()]) {
      await assertFails(getDoc(doc(db, pathOf('cp_int'))));
    }
  });
});

describe('audits list', () => {
  it('公開已發布：主辦、共同主辦、管理員在 limit ≤100 可 list；不帶 limit、limit 101、其他人不可', async () => {
    for (const db of [as('host'), as('co'), as('admin', 'admin')]) {
      const snap = await assertSucceeds(getDocs(query(collection(db, 'competitions/cp_pub/audits'), limit(100))));
      expect(snap.docs.map(d => d.id)).toContain('a1');
      await assertFails(getDocs(collection(db, 'competitions/cp_pub/audits')));
      await assertFails(getDocs(query(collection(db, 'competitions/cp_pub/audits'), limit(101))));
    }
    for (const db of [as('s1'), as('stranger'), anon()]) {
      await assertFails(getDocs(query(collection(db, 'competitions/cp_pub/audits'), limit(100))));
      await assertFails(getDocs(collection(db, 'competitions/cp_pub/audits')));
    }
  });

  it('內部賽事：管理員 limit ≤100 可 list；主辦不可', async () => {
    const snap = await assertSucceeds(getDocs(query(collection(as('admin', 'admin'), 'competitions/cp_int/audits'), limit(1))));
    expect(snap.docs.map(d => d.id)).toContain('a1');
    await assertFails(getDocs(query(collection(as('host'), 'competitions/cp_int/audits'), limit(100))));
    await assertFails(getDocs(query(collection(as('admin', 'admin'), 'competitions/cp_int/audits'), limit(101))));
  });
});

describe('audits 用戶端寫入一律拒', () => {
  it('未登入、記分員、主辦、共同主辦、管理員都不能 create／update／delete', async () => {
    for (const db of [anon(), as('s1'), as('stranger'), as('host'), as('co'), as('admin', 'admin')]) {
      await assertFails(setDoc(doc(db, pathOf('cp_pub', 'a_new')), { action: 'x' }));
      await assertFails(updateDoc(doc(db, pathOf('cp_pub')), { action: 'y' }));
      await assertFails(deleteDoc(doc(db, pathOf('cp_pub'))));
    }
  });
});
