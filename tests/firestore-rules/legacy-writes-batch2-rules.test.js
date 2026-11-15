/**
 * HC-A3-08 第二批：expLogs、teamExpLogs、users/{userId}/gameInbox 的建立全拒。
 * events/{eventId}/activityRecords 不再允許本人自建或本人任意更新；
 * 建立與只改 status／updatedAt 留給活動現場操作者，其餘更新留給管理員。
 * course-linked 條件與讀取、刪除維持原規則。
 */
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} = require('firebase/firestore');

const PROJECT_ID = 'demo-rules-test';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const EVENT_ID = 'evtHostActivity';
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
    for (const [uid, role] of [
      ['uidUser', 'user'],
      ['uidOther', 'user'],
      ['uidAdmin', 'admin'],
      ['uidCoach', 'coach'],
      ['uidCoachOther', 'coach'],
    ]) {
      await setDoc(doc(db, 'users', uid), { uid, lineUserId: uid, role });
    }
    await setDoc(doc(db, 'events', EVENT_ID), {
      id: EVENT_ID,
      title: '主辦活動',
      creatorUid: 'uidCoach',
      status: 'open',
      privateEvent: false,
    });
    await setDoc(doc(db, 'events', EVENT_ID, 'activityRecords', 'actOwn'), {
      eventId: EVENT_ID,
      uid: 'uidUser',
      status: 'registered',
      name: '自己的紀錄',
    });
    await setDoc(doc(db, 'events', EVENT_ID, 'activityRecords', 'actHost'), {
      eventId: EVENT_ID,
      uid: 'uidOther',
      status: 'waitlisted',
      name: '候補紀錄',
    });
    await setDoc(doc(db, 'events', EVENT_ID, 'activityRecords', 'actCourse'), {
      eventId: EVENT_ID,
      uid: 'uidOther',
      status: 'registered',
      courseLinkId: 'link-seed',
    });
    await setDoc(doc(db, 'expLogs', 'expExisting'), { targetUid: 'uidUser', amount: 1 });
    await setDoc(doc(db, 'teamExpLogs', 'teamExpExisting'), { teamId: 'teamA', amount: 1 });
    await setDoc(doc(db, 'users', 'uidUser', 'gameInbox', 'msgOwn'), {
      fromUid: 'uidOther',
      body: 'hello',
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const ctx = (uid) => testEnv.authenticatedContext(uid).firestore();
const guestDb = () => testEnv.unauthenticatedContext().firestore();

describe('expLogs 與 teamExpLogs 用戶端不能建立', () => {
  test('一般登入者建立 expLogs 被拒', async () => {
    await assertFails(setDoc(doc(ctx('uidUser'), 'expLogs', 'expByUser'), {
      targetUid: 'uidUser',
      amount: 10,
    }));
  });

  test('管理員建立 expLogs 被拒', async () => {
    await assertFails(setDoc(doc(ctx('uidAdmin'), 'expLogs', 'expByAdmin'), {
      targetUid: 'uidUser',
      amount: 10,
    }));
  });

  test('一般登入者建立 teamExpLogs 被拒', async () => {
    await assertFails(setDoc(doc(ctx('uidUser'), 'teamExpLogs', 'teamExpByUser'), {
      teamId: 'teamA',
      amount: 10,
    }));
  });

  test('管理員建立 teamExpLogs 被拒', async () => {
    await assertFails(setDoc(doc(ctx('uidAdmin'), 'teamExpLogs', 'teamExpByAdmin'), {
      teamId: 'teamA',
      amount: 10,
    }));
  });

  test('一般登入者可讀 expLogs 與 teamExpLogs', async () => {
    const db = ctx('uidUser');
    await assertSucceeds(getDoc(doc(db, 'expLogs', 'expExisting')));
    await assertSucceeds(getDoc(doc(db, 'teamExpLogs', 'teamExpExisting')));
  });
});

describe('gameInbox 用戶端不能建立', () => {
  test('一般登入者在別人的 gameInbox 建立被拒', async () => {
    await assertFails(setDoc(doc(ctx('uidOther'), 'users', 'uidUser', 'gameInbox', 'msgFromOther'), {
      fromUid: 'uidOther',
      body: 'gift',
    }));
  });

  test('一般登入者在自己的 gameInbox 建立被拒', async () => {
    await assertFails(setDoc(doc(ctx('uidUser'), 'users', 'uidUser', 'gameInbox', 'msgSelf'), {
      fromUid: 'uidUser',
      body: 'note',
    }));
  });

  test('擁有者可讀並刪除自己的 gameInbox', async () => {
    const db = ctx('uidUser');
    await assertSucceeds(getDoc(doc(db, 'users', 'uidUser', 'gameInbox', 'msgOwn')));
    await assertSucceeds(deleteDoc(doc(db, 'users', 'uidUser', 'gameInbox', 'msgOwn')));
  });
});

describe('events/{id}/activityRecords 不再允許本人直寫', () => {
  test('一般用戶建立自己的活動紀錄（uid 為自己、eventId 對）被拒', async () => {
    await assertFails(setDoc(doc(ctx('uidUser'), 'events', EVENT_ID, 'activityRecords', 'actSelf'), {
      eventId: EVENT_ID,
      uid: 'uidUser',
      status: 'registered',
    }));
  });

  test('一般用戶只改自己的 status 被拒', async () => {
    await assertFails(updateDoc(doc(ctx('uidUser'), 'events', EVENT_ID, 'activityRecords', 'actOwn'), {
      status: 'cancelled',
    }));
  });

  test('一般用戶改自己的其他欄位被拒', async () => {
    await assertFails(updateDoc(doc(ctx('uidUser'), 'events', EVENT_ID, 'activityRecords', 'actOwn'), {
      name: '自行改名',
    }));
  });

  test('活動主辦（coach 且 creatorUid 為自己）可建立', async () => {
    await assertSucceeds(setDoc(doc(ctx('uidCoach'), 'events', EVENT_ID, 'activityRecords', 'actByHost'), {
      eventId: EVENT_ID,
      uid: 'uidOther',
      status: 'registered',
    }));
  });

  test('活動主辦只改 status 與 updatedAt 放行', async () => {
    await assertSucceeds(updateDoc(doc(ctx('uidCoach'), 'events', EVENT_ID, 'activityRecords', 'actHost'), {
      status: 'registered',
      updatedAt: new Date(),
    }));
  });

  test('活動主辦改其他欄位被拒', async () => {
    await assertFails(updateDoc(doc(ctx('uidCoach'), 'events', EVENT_ID, 'activityRecords', 'actHost'), {
      name: '主辦改名',
    }));
  });

  test('管理員更新活動紀錄放行', async () => {
    await assertSucceeds(updateDoc(doc(ctx('uidAdmin'), 'events', EVENT_ID, 'activityRecords', 'actOwn'), {
      name: '管理員修改',
    }));
  });

  test('活動主辦建立帶 courseLinkId 的活動紀錄仍被拒', async () => {
    await assertFails(setDoc(doc(ctx('uidCoach'), 'events', EVENT_ID, 'activityRecords', 'actLinked'), {
      eventId: EVENT_ID,
      uid: 'uidOther',
      status: 'registered',
      courseLinkId: 'link-1',
    }));
  });

  test('管理員更新已帶 courseLinkId 的活動紀錄仍被拒', async () => {
    await assertFails(updateDoc(doc(ctx('uidAdmin'), 'events', EVENT_ID, 'activityRecords', 'actCourse'), {
      status: 'cancelled',
    }));
  });

  test('coach 但不是這場活動主辦：建立與只改 status 都被拒（對照組）', async () => {
    const db = ctx('uidCoachOther');
    await assertFails(setDoc(doc(db, 'events', EVENT_ID, 'activityRecords', 'actByOtherCoach'), {
      eventId: EVENT_ID,
      uid: 'uidOther',
      status: 'registered',
    }));
    await assertFails(updateDoc(doc(db, 'events', EVENT_ID, 'activityRecords', 'actHost'), {
      status: 'registered',
      updatedAt: new Date(),
    }));
  });

  test('活動主辦只改已帶 courseLinkId 紀錄的 status 仍被拒', async () => {
    await assertFails(updateDoc(doc(ctx('uidCoach'), 'events', EVENT_ID, 'activityRecords', 'actCourse'), {
      status: 'cancelled',
      updatedAt: new Date(),
    }));
  });

  test('一般登入者可讀子集合活動紀錄，未登入被拒', async () => {
    await assertSucceeds(getDoc(doc(ctx('uidUser'), 'events', EVENT_ID, 'activityRecords', 'actOwn')));
    await assertFails(getDoc(doc(guestDb(), 'events', EVENT_ID, 'activityRecords', 'actOwn')));
  });
});
