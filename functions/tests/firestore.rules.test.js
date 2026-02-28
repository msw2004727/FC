const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc } = require('firebase/firestore');

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
