const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');

const PROJECT_ID = 'demo-rules-test';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
let testEnv;

jest.setTimeout(30000);

// 通知發送授權強化：兩個內部集合只由 Admin SDK 讀寫，客戶端（含訪客、一般登入者、管理員）一律拒絕。
const INTERNAL_COLLECTIONS = [
  ['notificationGuardCounters', '20261027_target_abc'],
  ['linePushDedupe', 'abc123'],
];

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
    for (const [collection, id] of INTERNAL_COLLECTIONS) {
      await setDoc(doc(context.firestore(), collection, id), { count: 1 });
    }
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

function guest() {
  return testEnv.unauthenticatedContext().firestore();
}

function member(uid) {
  return testEnv.authenticatedContext(uid, { role: 'user' }).firestore();
}

function admin() {
  return testEnv.authenticatedContext('uidAdmin', { role: 'admin', admin: true }).firestore();
}

function superAdmin() {
  return testEnv.authenticatedContext('uidSuper', { role: 'super_admin', admin: true }).firestore();
}

describe.each(INTERNAL_COLLECTIONS)('%s 內部集合', (collection, id) => {
  test('訪客不能讀寫', async () => {
    await assertFails(getDoc(doc(guest(), collection, id)));
    await assertFails(setDoc(doc(guest(), collection, 'new'), { count: 1 }));
  });

  test('一般登入者不能讀、建立、更新或刪除', async () => {
    await assertFails(getDoc(doc(member('uidA'), collection, id)));
    await assertFails(setDoc(doc(member('uidA'), collection, 'new'), { count: 1 }));
    await assertFails(updateDoc(doc(member('uidA'), collection, id), { count: 99 }));
    await assertFails(deleteDoc(doc(member('uidA'), collection, id)));
  });

  test('管理員與超級管理員也不能由客戶端讀寫', async () => {
    await assertFails(getDoc(doc(admin(), collection, id)));
    await assertFails(setDoc(doc(admin(), collection, 'new'), { count: 1 }));
    await assertFails(updateDoc(doc(superAdmin(), collection, id), { count: 99 }));
    await assertFails(deleteDoc(doc(superAdmin(), collection, id)));
  });
});
