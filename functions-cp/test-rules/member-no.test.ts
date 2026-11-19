/**
 * K10 成員固定編號（顧問 §3.352 條件②）：staffSeq（賽事文件）與 memberNo（staff 文件）只由伺服器寫。
 * Rules 未改；本檔鎖住「任何用戶端（含主辦、共同主辦、管理員）都改不了」。PM 撰寫。
 */
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { adminDb, assertFails, assertSucceeds, clearDb, clientDb, closeClients, loadRules } from './_harness.js';
import { seedBase } from './_fixtures.js';

const as = (uid: string, role?: string) => clientDb({ uid, ...(role ? { role } : {}) });
const anon = () => clientDb(null);
const compPath = 'competitions/cp_pub';
const staffPath = (uid: string) => `competitions/cp_pub/staff/${uid}`;

beforeAll(async () => {
  await loadRules();
  await clearDb();
  await seedBase();
  const db = adminDb();
  await db.doc(compPath).set({ staffSeq: 3 }, { merge: true });
  await db.doc(staffPath('host')).set({ memberNo: 1 }, { merge: true });
  await db.doc(staffPath('co')).set({ memberNo: 2 }, { merge: true });
});
afterEach(async () => { await closeClients(); });
afterAll(async () => { await clearDb(); });

describe('K10 memberNo／staffSeq 用戶端不可寫', () => {
  it('對照：主辦讀得到自己的 staff 文件（確認測試資料在）', async () => {
    await assertSucceeds(getDoc(doc(as('host'), staffPath('host'))));
  });

  it('任何用戶端都不能改賽事文件的 staffSeq', async () => {
    for (const db of [anon(), as('stranger'), as('host'), as('co'), as('admin', 'admin')]) {
      await assertFails(updateDoc(doc(db, compPath), { staffSeq: 99 }));
      await assertFails(setDoc(doc(db, compPath), { staffSeq: 1 }, { merge: true }));
    }
  });

  it('任何用戶端都不能建立或修改 staff 的 memberNo（含自己的文件）', async () => {
    for (const [uid, role] of [['stranger'], ['host'], ['co'], ['admin', 'admin']] as Array<[string, string?]>) {
      const db = as(uid, role);
      await assertFails(updateDoc(doc(db, staffPath(uid)), { memberNo: 7 }));
      await assertFails(setDoc(doc(db, staffPath(uid)), { roles: ['scorer'], memberNo: 7, updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(db, staffPath('host')), { memberNo: 9 }));
      await assertFails(deleteDoc(doc(db, staffPath('co'))));
    }
    await assertFails(setDoc(doc(anon(), staffPath('anon_x')), { memberNo: 5 }));
  });
});
