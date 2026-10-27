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

// 四種身分 × 兩個集合 × get／set／update／delete，全部拒絕
const IDENTITIES = [
  ['訪客', () => guest()],
  ['一般登入者', () => member('uidA')],
  ['admin', () => admin()],
  ['super_admin', () => superAdmin()],
];

describe.each(INTERNAL_COLLECTIONS)('%s 內部集合', (collection, id) => {
  describe.each(IDENTITIES)('%s', (_label, getDb) => {
    test('不能讀取（get）', async () => {
      await assertFails(getDoc(doc(getDb(), collection, id)));
    });

    test('不能建立或覆寫（set）', async () => {
      await assertFails(setDoc(doc(getDb(), collection, 'new'), { count: 1 }));
      await assertFails(setDoc(doc(getDb(), collection, id), { count: 99 }));
    });

    test('不能更新（update）', async () => {
      await assertFails(updateDoc(doc(getDb(), collection, id), { count: 99 }));
    });

    test('不能刪除（delete）', async () => {
      await assertFails(deleteDoc(doc(getDb(), collection, id)));
    });
  });
});
