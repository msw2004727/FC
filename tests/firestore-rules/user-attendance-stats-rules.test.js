const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');

const PROJECT_ID = 'demo-rules-test';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
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
    await setDoc(doc(context.firestore(), 'userAttendanceStats', 'uidA'), {
      uid: 'uidA',
      expectedCount: 4,
      attendedCount: 3,
      completedCount: 2,
      attendRate: 75,
    });
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

describe('userAttendanceStats materialized summaries', () => {
  test('requires authentication to read', async () => {
    await assertFails(getDoc(doc(guest(), 'userAttendanceStats', 'uidA')));
  });

  test('authenticated users can read their own and public-card summaries', async () => {
    await assertSucceeds(getDoc(doc(member('uidA'), 'userAttendanceStats', 'uidA')));
    await assertSucceeds(getDoc(doc(member('uidB'), 'userAttendanceStats', 'uidA')));
  });

  test('clients cannot create, update, or delete summaries', async () => {
    await assertFails(setDoc(doc(member('uidA'), 'userAttendanceStats', 'uidB'), { expectedCount: 1 }));
    await assertFails(updateDoc(doc(admin(), 'userAttendanceStats', 'uidA'), { expectedCount: 99 }));
    await assertFails(deleteDoc(doc(admin(), 'userAttendanceStats', 'uidA')));
  });

  test('internal rebuild queue is not client-readable or writable', async () => {
    await assertFails(getDoc(doc(member('uidA'), 'userAttendanceStatsQueue', 'uidA')));
    await assertFails(setDoc(doc(admin(), 'userAttendanceStatsQueue', 'uidA'), { generation: 1 }));
  });
});
