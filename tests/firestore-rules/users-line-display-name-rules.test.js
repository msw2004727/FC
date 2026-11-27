const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteField,
  serverTimestamp,
} = require('firebase/firestore');

// projectId 只能小寫（見 rules-budget skill）。
const PROJECT_ID = 'demo-users-line-name-rules';
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
    await setDoc(doc(db, 'users', 'uidA'), {
      uid: 'uidA',
      lineUserId: 'uidA',
      displayName: '甲',
      role: 'user',
      lineDisplayName: '甲的LINE',
      teamIds: ['teamX'],
      teamNames: ['X隊'],
      teamId: 'teamX',
      teamName: 'X隊',
    });
    await setDoc(doc(db, 'users', 'uidSuper'), {
      uid: 'uidSuper',
      displayName: '超管',
      role: 'super_admin',
    });
    await setDoc(doc(db, 'users', 'uidAdmin'), {
      uid: 'uidAdmin',
      displayName: '管理',
      role: 'admin',
    });
    await setDoc(doc(db, 'users', 'uidNoName'), {
      uid: 'uidNoName',
      lineUserId: 'uidNoName',
      displayName: '乙',
      role: 'user',
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const guest = () => testEnv.unauthenticatedContext().firestore();
const member = (uid, role = 'user') => testEnv.authenticatedContext(uid, { role }).firestore();

describe('users.lineDisplayName 只允許 Admin SDK 寫（前端任何身分都不能新增／修改／刪除）', () => {
  test('本人更新路徑：同時改 displayName 與 lineDisplayName 被拒；只改 displayName（對照組）允許', async () => {
    const db = member('uidA');
    await assertFails(
      updateDoc(doc(db, 'users', 'uidA'), {
        displayName: '新甲',
        lineDisplayName: '偽造',
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'uidA'), { displayName: '新甲' }),
    );
  });

  test('本人只改 lineDisplayName 被拒；原本沒有該欄位的人新增也被拒', async () => {
    await assertFails(
      updateDoc(doc(member('uidA', 'user'), 'users', 'uidA'), {
        lineDisplayName: '偽造',
      }),
    );
    await assertFails(
      updateDoc(doc(member('uidNoName', 'user'), 'users', 'uidNoName'), {
        lineDisplayName: '偽造',
      }),
    );
  });

  test('登入更新路徑：帶 lineDisplayName 被拒；不帶（對照組）允許', async () => {
    const db = member('uidA');
    await assertFails(
      updateDoc(doc(db, 'users', 'uidA'), {
        displayName: '甲',
        pictureUrl: null,
        lastLogin: serverTimestamp(),
        lineDisplayName: '偽造',
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'uidA'), {
        displayName: '甲',
        pictureUrl: null,
        lastLogin: serverTimestamp(),
      }),
    );
  });

  test('本人刪掉 lineDisplayName 欄位被拒', async () => {
    await assertFails(
      updateDoc(doc(member('uidA', 'user'), 'users', 'uidA'), {
        lineDisplayName: deleteField(),
      }),
    );
  });

  test('建立路徑：帶 lineDisplayName 被拒；不帶（對照組）允許', async () => {
    // 對照組只帶 isSafeUserRootCreate 的最小必填：uid＝本人、lineUserId＝本人、displayName、role='user'、teamId=null（規則要求 teamId == null，缺欄位會被拒）
    // （lineUserId 若帶必須等於 userId；role 若帶必須是 'user'；其餘 allowedKeys 皆為選填）。
    const db = member('uidNew');
    await assertFails(
      setDoc(doc(db, 'users', 'uidNew'), {
        uid: 'uidNew',
        lineUserId: 'uidNew',
        displayName: '新',
        role: 'user',
        teamId: null,
        lineDisplayName: '偽造',
      }),
    );
    await assertSucceeds(
      setDoc(doc(db, 'users', 'uidNew'), {
        uid: 'uidNew',
        lineUserId: 'uidNew',
        displayName: '新',
        role: 'user',
        teamId: null,
      }),
    );
  });

  test('隊伍幹部／管理員改隊伍欄位路徑：帶 lineDisplayName 被拒；不帶（對照組）允許', async () => {
    const db = member('uidAdmin', 'admin');
    await assertFails(
      updateDoc(doc(db, 'users', 'uidA'), {
        teamIds: [],
        teamNames: [],
        teamId: null,
        teamName: null,
        lineDisplayName: '偽造',
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'uidA'), {
        teamIds: [],
        teamNames: [],
        teamId: null,
        teamName: null,
      }),
    );
  });

  test('超管路徑：黑名單 lineDisplayName 被拒；改其他欄位（對照組）允許；刪除 lineDisplayName 也被拒', async () => {
    const db = member('uidSuper', 'super_admin');
    await assertFails(
      updateDoc(doc(db, 'users', 'uidA'), { lineDisplayName: '偽造' }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'uidA'), { displayName: '超管改' }),
    );
    await assertFails(
      updateDoc(doc(db, 'users', 'uidA'), { lineDisplayName: deleteField() }),
    );
  });

  test('Admin SDK 寫入 lineDisplayName 後，本人登入更新（不帶 lineDisplayName）仍允許', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await updateDoc(doc(db, 'users', 'uidA'), { lineDisplayName: '真實LINE' });
    });
    await assertSucceeds(
      updateDoc(doc(member('uidA', 'user'), 'users', 'uidA'), {
        displayName: '甲',
        pictureUrl: null,
        lastLogin: serverTimestamp(),
      }),
    );
  });

  test('已登入的其他使用者可讀 users/uidA；訪客讀被拒', async () => {
    await assertSucceeds(getDoc(doc(member('uidZ', 'user'), 'users', 'uidA')));
    await assertFails(getDoc(doc(guest(), 'users', 'uidA')));
  });
});
