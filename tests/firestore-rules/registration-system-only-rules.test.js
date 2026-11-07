/**
 * 2026-11-07 站長定案 F4：活動底下報名 `events/{eventId}/registrations/{regId}` 的建立、取消、刪除只准
 * 系統（registerForEvent／cancelRegistration Callable 以 Admin SDK 寫入，不經 Rules）與管理員。
 *
 * 修正前：`isSubRegOwnerRequest()` 只比 userId＝本人，一般用戶可直接建立自己的報名並自填
 * status／registeredAt（插隊、超收），可把自己的報名改成 cancelled（不遞補、製造空洞），也可直接刪除。
 *
 * 保留：本人只改 displayBadges、self-select 模式下改自己的 teamKey；活動主辦／委託人的遞補、降級、移除。
 */
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  Timestamp,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} = require('firebase/firestore');

const PROJECT_ID = 'demo-rules-test';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const EVENT = 'evt_f4';
let testEnv;

jest.setTimeout(30000);

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port: Number(port),
      rules: fs.readFileSync(path.resolve(__dirname, '../..', 'firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, role] of [['uidUser', 'user'], ['uidOther', 'user'], ['uidAdmin', 'admin'], ['uidSuper', 'super_admin']]) {
      await setDoc(doc(db, 'users', uid), { uid, lineUserId: uid, role });
    }
    await setDoc(doc(db, 'events', EVENT), {
      id: EVENT,
      title: 'F4 event',
      creatorUid: 'uidOther',
      status: 'full',
      max: 1,
      current: 1,
      startTimestamp: Timestamp.fromDate(new Date('2099-06-15T02:00:00Z')),
      teamSplit: { enabled: true, mode: 'self-select', lockAt: null, teams: [{ key: 'A' }, { key: 'B' }] },
    });
    await setDoc(doc(db, 'events', EVENT, 'registrations', 'regUser'), {
      id: 'regUser', eventId: EVENT, userId: 'uidUser', userName: 'U', participantType: 'self',
      status: 'confirmed', registeredAt: Timestamp.fromDate(new Date('2026-11-01T00:00:00Z')),
    });
    await setDoc(doc(db, 'events', EVENT, 'registrations', 'regOtherWait'), {
      id: 'regOtherWait', eventId: EVENT, userId: 'uidOther', userName: 'O', participantType: 'self',
      status: 'waitlisted', registeredAt: Timestamp.fromDate(new Date('2026-11-02T00:00:00Z')),
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const ctx = (uid) => testEnv.authenticatedContext(uid).firestore();
const regRef = (db, id) => doc(db, 'events', EVENT, 'registrations', id);

describe('F4 一般用戶不能直接寫報名', () => {
  test('不能建立自己的正取報名（自填狀態與舊報名時間插隊）', async () => {
    await assertFails(setDoc(regRef(ctx('uidUser'), 'regSelfConfirmed'), {
      id: 'regSelfConfirmed', eventId: EVENT, userId: 'uidUser', participantType: 'self',
      status: 'confirmed', registeredAt: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
    }));
  });

  test('連候補報名也不能自己建立（一律走 registerForEvent）', async () => {
    await assertFails(setDoc(regRef(ctx('uidUser'), 'regSelfWait'), {
      id: 'regSelfWait', eventId: EVENT, userId: 'uidUser', participantType: 'self',
      status: 'waitlisted', registeredAt: serverTimestamp(),
    }));
  });

  test('不能把自己的報名改成取消（取消要走 cancelRegistration 才會遞補）', async () => {
    await assertFails(updateDoc(regRef(ctx('uidUser'), 'regUser'), {
      status: 'cancelled', cancelledAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });

  test('不能刪除自己的報名', async () => {
    await assertFails(deleteDoc(regRef(ctx('uidUser'), 'regUser')));
  });

  test('不能改自己的報名時間或狀態以外的排序欄位', async () => {
    await assertFails(updateDoc(regRef(ctx('uidOther'), 'regOtherWait'), {
      registeredAt: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
    }));
    await assertFails(updateDoc(regRef(ctx('uidOther'), 'regOtherWait'), { waitlistSortAt: null }));
  });
});

describe('F4 保留的本人更新', () => {
  test('只改徽章可以', async () => {
    await assertSucceeds(updateDoc(regRef(ctx('uidUser'), 'regUser'), { displayBadges: ['b1'] }));
  });

  test('徽章夾帶取消不行', async () => {
    await assertFails(updateDoc(regRef(ctx('uidUser'), 'regUser'), { displayBadges: ['b1'], status: 'cancelled' }));
  });

  test('self-select 模式下改自己的 teamKey 可以', async () => {
    await assertSucceeds(updateDoc(regRef(ctx('uidUser'), 'regUser'), { teamKey: 'A', updatedAt: serverTimestamp() }));
  });
});

describe('F4 管理員仍可直寫', () => {
  test.each([['admin', 'uidAdmin'], ['super_admin', 'uidSuper']])('%s 可建立、取消、刪除', async (_role, uid) => {
    await assertSucceeds(setDoc(regRef(ctx(uid), 'regByAdmin'), {
      id: 'regByAdmin', eventId: EVENT, userId: 'uidOther', participantType: 'self',
      status: 'waitlisted', registeredAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(regRef(ctx(uid), 'regUser'), { status: 'cancelled' }));
    await assertSucceeds(deleteDoc(regRef(ctx(uid), 'regByAdmin')));
  });
});
