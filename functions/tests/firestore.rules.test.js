const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, addDoc, collection } = require('firebase/firestore');

const PROJECT_ID = 'demo-rules-test';
const RULES_PATH = path.resolve(__dirname, '..', '..', 'firestore.rules');

let testEnv;

async function seedUsers() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', 'userA'), {
      uid: 'userA',
      displayName: 'User A',
      role: 'user',
    });
    await setDoc(doc(db, 'users', 'userB'), {
      uid: 'userB',
      displayName: 'User B',
      role: 'user',
    });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedUsers();
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Firestore rules: users write constraints', () => {
  test('User A cannot update user B profile document', async () => {
    const dbA = testEnv.authenticatedContext('userA').firestore();
    await assertFails(
      updateDoc(doc(dbA, 'users', 'userB'), {
        displayName: 'Hacked By A',
      })
    );
  });

  test('No one can update users.role (including owner)', async () => {
    const dbA = testEnv.authenticatedContext('userA').firestore();
    await assertFails(
      updateDoc(doc(dbA, 'users', 'userA'), {
        role: 'admin',
      })
    );
  });

  test('Owner can update own users.displayName', async () => {
    const dbA = testEnv.authenticatedContext('userA').firestore();
    await assertSucceeds(
      updateDoc(doc(dbA, 'users', 'userA'), {
        displayName: 'User A New Name',
      })
    );
  });
});

describe('Firestore rules: messages create constraints', () => {
  test('Authenticated sender can create a direct inbox message', async () => {
    const dbA = testEnv.authenticatedContext('userA').firestore();
    await assertSucceeds(
      addDoc(collection(dbA, 'messages'), {
        id: 'msg_test_1',
        type: 'system',
        typeName: '系統',
        title: '測試通知',
        preview: '測試通知內容',
        body: '測試通知內容',
        time: '2026/03/08 16:00',
        unread: true,
        readBy: [],
        hiddenBy: [],
        senderName: '系統',
        fromUid: 'userA',
        toUid: 'userB',
        targetUid: 'userB',
        timestamp: new Date(),
        createdAt: new Date(),
      })
    );
  });

  test('Sender cannot forge a different fromUid when creating a message', async () => {
    const dbA = testEnv.authenticatedContext('userA').firestore();
    await assertFails(
      addDoc(collection(dbA, 'messages'), {
        id: 'msg_test_2',
        type: 'system',
        typeName: '系統',
        title: '偽造通知',
        preview: '偽造通知內容',
        body: '偽造通知內容',
        time: '2026/03/08 16:00',
        unread: true,
        readBy: [],
        hiddenBy: [],
        senderName: '系統',
        fromUid: 'userB',
        toUid: 'userB',
        targetUid: 'userB',
        timestamp: new Date(),
        createdAt: new Date(),
      })
    );
  });
});
