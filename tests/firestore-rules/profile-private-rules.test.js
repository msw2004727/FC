const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  Timestamp,
  updateDoc,
} = require('firebase/firestore');

const PROJECT_ID = 'demo-profile-private-rules';
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
    const ts = Timestamp.fromMillis(1700000000000);

    await setDoc(doc(db, 'users', 'uidA'), { role: 'user', uid: 'uidA' });
    await setDoc(doc(db, 'users', 'uidB'), { role: 'user', uid: 'uidB' });
    await setDoc(doc(db, 'users', 'uidAdmin'), { role: 'admin', uid: 'uidAdmin' });
    await setDoc(doc(db, 'users', 'uidSuper'), { role: 'super_admin', uid: 'uidSuper' });
    await setDoc(doc(db, 'users', 'uidCoach'), { role: 'coach', uid: 'uidCoach' });
    await setDoc(doc(db, 'users', 'uidGrant'), { role: 'user', uid: 'uidGrant' });
    await setDoc(doc(db, 'userPermissionGrants', 'uidGrant'), {
      permissions: ['admin.users.entry'],
      enabled: true,
    });

    await setDoc(doc(db, 'users', 'uidA', 'profilePrivate', 'profile'), {
      phone: 'test-phone-1',
      email: 'a@example.com',
      companions: [],
      eduChildren: null,
      backfilledAt: ts,
      createdAt: ts,
      updatedAt: ts,
    });

    await setDoc(doc(db, 'events', 'e1', 'profilePrivate', 'x'), { note: 'test' });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const guest = () => testEnv.unauthenticatedContext().firestore();
const as = (uid) => testEnv.authenticatedContext(uid, {}).firestore();

const profilePath = (uid) => doc(as(uid), 'users', uid, 'profilePrivate', 'profile');
const profilePathFor = (db, uid) => doc(db, 'users', uid, 'profilePrivate', 'profile');

describe('私密子文件：讀取', () => {
  test('未登入不可讀', async () => {
    await assertFails(getDoc(doc(guest(), 'users', 'uidA', 'profilePrivate', 'profile')));
  });

  test('他人不可讀', async () => {
    await assertFails(getDoc(profilePathFor(as('uidB'), 'uidA')));
  });

  test('本人可讀', async () => {
    await assertSucceeds(getDoc(profilePathFor(as('uidA'), 'uidA')));
  });

  test('admin 可讀', async () => {
    await assertSucceeds(getDoc(profilePathFor(as('uidAdmin'), 'uidA')));
  });

  test('super_admin 可讀', async () => {
    await assertSucceeds(getDoc(profilePathFor(as('uidSuper'), 'uidA')));
  });

  test('coach 不可讀', async () => {
    await assertFails(getDoc(profilePathFor(as('uidCoach'), 'uidA')));
  });

  test('持有管理權限的一般使用者不可讀', async () => {
    await assertFails(getDoc(profilePathFor(as('uidGrant'), 'uidA')));
  });
});

describe('私密子文件：父根文件不存在', () => {
  test('本人可建立並讀取', async () => {
    const db = as('uidNew');
    await assertSucceeds(setDoc(doc(db, 'users', 'uidNew', 'profilePrivate', 'profile'), {
      phone: 'test-phone-2',
      email: 'new@example.com',
      companions: [],
      eduChildren: null,
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(db, 'users', 'uidNew', 'profilePrivate', 'profile')));
  });
});

describe('私密子文件：列舉', () => {
  test('一般使用者不可直接列舉子集合', async () => {
    await assertFails(getDocs(collection(as('uidA'), 'users', 'uidA', 'profilePrivate')));
  });

  test('一般使用者不可 collectionGroup 列舉', async () => {
    await assertFails(getDocs(collectionGroup(as('uidA'), 'profilePrivate')));
  });

  test('admin 可 collectionGroup 列舉', async () => {
    await assertSucceeds(getDocs(collectionGroup(as('uidAdmin'), 'profilePrivate')));
  });

  test('coach 不可 collectionGroup 列舉', async () => {
    await assertFails(getDocs(collectionGroup(as('uidCoach'), 'profilePrivate')));
  });
});

describe('私密子文件：寫入', () => {
  test('他人不可寫', async () => {
    await assertFails(setDoc(profilePathFor(as('uidB'), 'uidA'), {
      phone: 'test-phone-3',
      updatedAt: serverTimestamp(),
    }));
  });

  test('本人不可帶 role 欄位', async () => {
    await assertFails(updateDoc(profilePathFor(as('uidA'), 'uidA'), {
      role: 'admin',
      updatedAt: serverTimestamp(),
    }));
  });

  test('本人不可帶 backfilledAt 欄位', async () => {
    await assertFails(updateDoc(profilePathFor(as('uidA'), 'uidA'), {
      backfilledAt: Timestamp.fromMillis(1700000000001),
      updatedAt: serverTimestamp(),
    }));
  });

  test('本人不可帶白名單外欄位', async () => {
    await assertFails(updateDoc(profilePathFor(as('uidA'), 'uidA'), {
      foo: 'bar',
      updatedAt: serverTimestamp(),
    }));
  });

  test('updatedAt 不是 serverTimestamp() 時不可寫', async () => {
    await assertFails(updateDoc(profilePathFor(as('uidA'), 'uidA'), {
      phone: 'test-phone-4',
      updatedAt: Timestamp.fromMillis(1),
    }));
  });

  test('email 空字串不可寫', async () => {
    await assertFails(updateDoc(profilePathFor(as('uidA'), 'uidA'), {
      email: '',
      updatedAt: serverTimestamp(),
    }));
  });

  test('email 超過 254 字不可寫', async () => {
    await assertFails(updateDoc(profilePathFor(as('uidA'), 'uidA'), {
      email: 'a'.repeat(255),
      updatedAt: serverTimestamp(),
    }));
  });

  test('phone 為數字不可寫', async () => {
    await assertFails(updateDoc(profilePathFor(as('uidA'), 'uidA'), {
      phone: 123,
      updatedAt: serverTimestamp(),
    }));
  });

  test('companions 為 map 不可寫', async () => {
    await assertFails(updateDoc(profilePathFor(as('uidA'), 'uidA'), {
      companions: { a: 1 },
      updatedAt: serverTimestamp(),
    }));
  });

  test('本人可建立（無 createdAt）', async () => {
    await assertSucceeds(setDoc(doc(as('uidNew'), 'users', 'uidNew', 'profilePrivate', 'profile'), {
      phone: 'test-phone-2',
      email: 'new@example.com',
      companions: [],
      eduChildren: null,
      updatedAt: serverTimestamp(),
    }));
  });

  test('本人可建立（createdAt 為 serverTimestamp()）', async () => {
    await assertSucceeds(setDoc(doc(as('uidNew'), 'users', 'uidNew', 'profilePrivate', 'profile'), {
      phone: 'test-phone-2',
      email: 'new@example.com',
      companions: [],
      eduChildren: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  test('本人在已有 backfilledAt 的文件可更新 phone', async () => {
    await assertSucceeds(updateDoc(profilePathFor(as('uidA'), 'uidA'), {
      phone: 'test-phone-5',
      updatedAt: serverTimestamp(),
    }));
  });

  test('本人不可更新 createdAt', async () => {
    await assertFails(updateDoc(profilePathFor(as('uidA'), 'uidA'), {
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  test('merge 寫入只帶 companions 與 updatedAt 時，文件不存在與已存在皆可', async () => {
    await assertSucceeds(setDoc(doc(as('uidNew'), 'users', 'uidNew', 'profilePrivate', 'profile'), {
      companions: [],
      updatedAt: serverTimestamp(),
    }, { merge: true }));

    await assertSucceeds(setDoc(profilePathFor(as('uidA'), 'uidA'), {
      companions: [],
      updatedAt: serverTimestamp(),
    }, { merge: true }));
  });

  test('欄位寫 null 可更新', async () => {
    await assertSucceeds(updateDoc(profilePathFor(as('uidA'), 'uidA'), {
      phone: null,
      updatedAt: serverTimestamp(),
    }));
  });

  test('未登入不可對他人 profilePrivate/profile 做 set', async () => {
    await assertFails(setDoc(profilePathFor(guest(), 'uidA'), {
      phone: 'test-phone-7',
      updatedAt: serverTimestamp(),
    }));
  });

  test('admin 不可對他人 profilePrivate/profile 做 set', async () => {
    await assertFails(setDoc(profilePathFor(as('uidAdmin'), 'uidA'), {
      phone: 'test-phone-8',
      updatedAt: serverTimestamp(),
    }));
  });

  test('本人 create 時 createdAt 固定時間不可寫', async () => {
    await assertFails(setDoc(doc(as('uidNew'), 'users', 'uidNew', 'profilePrivate', 'profile'), {
      phone: 'test-phone-9',
      email: 'new@example.com',
      companions: [],
      eduChildren: null,
      createdAt: Timestamp.fromMillis(1700000000000),
      updatedAt: serverTimestamp(),
    }));
  });

  test('本人 create 時 updatedAt 固定時間不可寫', async () => {
    await assertFails(setDoc(doc(as('uidNew'), 'users', 'uidNew', 'profilePrivate', 'profile'), {
      phone: 'test-phone-10',
      email: 'new@example.com',
      companions: [],
      eduChildren: null,
      updatedAt: Timestamp.fromMillis(1700000000000),
    }));
  });
});

describe('私密子文件：docId 限制', () => {
  test('docId 不是 profile 時本人不可讀', async () => {
    await assertFails(getDoc(doc(as('uidA'), 'users', 'uidA', 'profilePrivate', 'other')));
  });

  test('docId 不是 profile 時本人不可建立', async () => {
    await assertFails(setDoc(doc(as('uidA'), 'users', 'uidA', 'profilePrivate', 'other'), {
      phone: 'test-phone-6',
      updatedAt: serverTimestamp(),
    }));
  });

  test('本人不可刪除 profile', async () => {
    await assertFails(deleteDoc(profilePathFor(as('uidA'), 'uidA')));
  });

  test('admin 不可刪除 profile', async () => {
    await assertFails(deleteDoc(profilePathFor(as('uidAdmin'), 'uidA')));
  });
});

describe('私密子文件：同名子集合名稱全域生效', () => {
  test('一般使用者不可讀 events 下的同名子集合文件', async () => {
    await assertFails(getDoc(doc(as('uidA'), 'events', 'e1', 'profilePrivate', 'x')));
  });

  test('admin collectionGroup 列舉允許（記錄名稱全域生效的已知行為）', async () => {
    await assertSucceeds(getDocs(collectionGroup(as('uidAdmin'), 'profilePrivate')));
  });
});
