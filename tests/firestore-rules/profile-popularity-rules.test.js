const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, collectionGroup } = require('firebase/firestore');

// projectId 只能小寫（見 rules-budget skill）。
const PROJECT_ID = 'demo-profile-popularity-rules';
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
    const db = context.firestore();
    await setDoc(doc(db, 'profilePopularity', 'uidA'), { views: 12 });
    await setDoc(doc(db, 'profilePopularity', 'uidA', 'viewers', 'uidB'), { viewerUid: 'uidB' });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const guest = () => testEnv.unauthenticatedContext().firestore();
const member = (uid, role = 'user') => testEnv.authenticatedContext(uid, { role }).firestore();

describe('profilePopularity（人氣指數）', () => {
  test('任何人（含訪客）都能讀計數文件', async () => {
    await assertSucceeds(getDoc(doc(guest(), 'profilePopularity', 'uidA')));
    await assertSucceeds(getDoc(doc(member('uidZ'), 'profilePopularity', 'uidA')));
    await assertSucceeds(getDoc(doc(member('uidA'), 'profilePopularity', 'uidA')));
  });

  test('不能列舉整個 profilePopularity 集合（避免任何人列出所有被看過的 uid）', async () => {
    for (const db of [guest(), member('uidZ'), member('uidA'), member('adminX', 'admin')]) {
      await assertFails(getDocs(collection(db, 'profilePopularity')));
    }
  });

  test('任何人（含登入者、本人、admin）都不能寫計數文件', async () => {
    for (const db of [guest(), member('uidZ'), member('uidA'), member('adminX', 'admin'), member('rootX', 'super_admin')]) {
      await assertFails(setDoc(doc(db, 'profilePopularity', 'uidA'), { views: 9999 }));
      await assertFails(setDoc(doc(db, 'profilePopularity', 'uidNew'), { views: 1 }));
      await assertFails(updateDoc(doc(db, 'profilePopularity', 'uidA'), { views: 9999 }));
      await assertFails(deleteDoc(doc(db, 'profilePopularity', 'uidA')));
    }
  });

  test('viewers 子集合：任何人都不能讀也不能寫（觀看紀錄不外洩）', async () => {
    for (const db of [guest(), member('uidZ'), member('uidB'), member('uidA'), member('adminX', 'admin')]) {
      await assertFails(getDoc(doc(db, 'profilePopularity', 'uidA', 'viewers', 'uidB')));
      await assertFails(getDocs(collection(db, 'profilePopularity', 'uidA', 'viewers')));
      await assertFails(setDoc(doc(db, 'profilePopularity', 'uidA', 'viewers', 'uidNew'), { viewerUid: 'uidNew' }));
      await assertFails(deleteDoc(doc(db, 'profilePopularity', 'uidA', 'viewers', 'uidB')));
      await assertFails(getDocs(collectionGroup(db, 'viewers')));
    }
  });
});
