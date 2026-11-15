/**
 * HC-A3-08 第一批：根層 attendanceRecords、根層 activityRecords、
 * events/{eventId}/registrationLocks 的建立與（鎖除外的）更新只准管理員。
 * 報名鎖的 update 維持全拒。子集合 events/{id}/attendanceRecords 不在本卡。
 *
 * 舊大檔 tests/firestore.rules.test.js 中原本斷言「一般用戶可直寫」的 8 則測試，已在另一個 commit 同步改為只限管理員。
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
const EVENT_HOST = 'evtHost';
const EVENT_PRIVATE = 'evtPrivateCourse';
const EVENT_LOCKS = 'evtLocks';
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
    ]) {
      await setDoc(doc(db, 'users', uid), { uid, lineUserId: uid, role });
    }
    await setDoc(doc(db, 'roleActivityCapabilities', 'user'), { capabilities: [] });
    await setDoc(doc(db, 'events', EVENT_HOST), {
      id: EVENT_HOST,
      title: '主辦簽到',
      creatorUid: 'uidCoach',
      status: 'open',
      privateEvent: false,
    });
    await setDoc(doc(db, 'events', EVENT_PRIVATE), {
      id: EVENT_PRIVATE,
      title: '私人課程',
      creatorUid: 'uidOther',
      status: 'open',
      privateEvent: true,
      courseLinked: true,
    });
    await setDoc(doc(db, 'events', EVENT_LOCKS), {
      id: EVENT_LOCKS,
      title: '報名鎖',
      creatorUid: 'uidOther',
      status: 'open',
    });
    await setDoc(doc(db, 'attendanceRecords', 'attOwn'), {
      uid: 'uidUser',
      eventId: EVENT_HOST,
      type: 'checkin',
      status: 'active',
    });
    await setDoc(doc(db, 'attendanceRecords', 'attOther'), {
      uid: 'uidOther',
      eventId: EVENT_HOST,
      type: 'checkin',
      status: 'active',
    });
    await setDoc(doc(db, 'activityRecords', 'actOwn'), {
      uid: 'uidUser',
      eventId: EVENT_HOST,
      status: 'active',
    });
    await setDoc(doc(db, 'activityRecords', 'actOther'), {
      uid: 'uidOther',
      eventId: EVENT_HOST,
      status: 'active',
    });
    await setDoc(doc(db, 'activityRecords', 'actCourse'), {
      uid: 'uidOther',
      eventId: EVENT_HOST,
      status: 'active',
      courseLinkId: 'link-seed',
    });
    await setDoc(doc(db, 'events', EVENT_LOCKS, 'registrationLocks', 'self_uidUser'), legalLock('self_uidUser', 'uidUser'));
    await setDoc(doc(db, 'events', EVENT_LOCKS, 'registrationLocks', 'lockAdmin'), legalLock('lockAdmin', 'uidOther'));
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const ctx = (uid) => testEnv.authenticatedContext(uid).firestore();
const guestDb = () => testEnv.unauthenticatedContext().firestore();

function legalLock(lockId, userId) {
  return {
    key: lockId,
    eventId: EVENT_LOCKS,
    userId,
    participantType: 'self',
    companionId: null,
    registrationDocId: 'regUser',
    status: 'active',
  };
}

describe('一般登入者不能直寫根層出席紀錄', () => {
  test('建立根層 attendanceRecords 被拒', async () => {
    await assertFails(setDoc(doc(ctx('uidUser'), 'attendanceRecords', 'attNew'), {
      uid: 'uidUser',
      eventId: EVENT_HOST,
      type: 'checkin',
      status: 'active',
    }));
  });

  test('改他人根層 attendanceRecords 的 status 與 removedAt 被拒', async () => {
    await assertFails(updateDoc(doc(ctx('uidUser'), 'attendanceRecords', 'attOther'), {
      status: 'removed',
      removedAt: new Date(),
      removedByUid: 'uidUser',
      updatedAt: new Date(),
    }));
  });

  test('改自己的根層 attendanceRecords 被拒', async () => {
    await assertFails(updateDoc(doc(ctx('uidUser'), 'attendanceRecords', 'attOwn'), {
      status: 'checkout',
      checkOutTime: new Date(),
      updatedAt: new Date(),
    }));
  });
});

describe('一般登入者不能直寫根層活動紀錄', () => {
  test('建立根層 activityRecords 被拒', async () => {
    await assertFails(setDoc(doc(ctx('uidUser'), 'activityRecords', 'actNew'), {
      uid: 'uidUser',
      eventId: EVENT_HOST,
      status: 'active',
    }));
  });

  test('改自己的根層 activityRecords（只改 status）被拒', async () => {
    await assertFails(updateDoc(doc(ctx('uidUser'), 'activityRecords', 'actOwn'), {
      status: 'cancelled',
      updatedAt: new Date(),
    }));
  });

  test('改他人的根層 activityRecords（只改 status）被拒', async () => {
    await assertFails(updateDoc(doc(ctx('uidUser'), 'activityRecords', 'actOther'), {
      status: 'cancelled',
    }));
  });
});

describe('一般登入者不能直寫報名鎖', () => {
  test('建立自己的 registrationLock（欄位完全合法）被拒', async () => {
    const lockId = 'self_uidUser_new';
    await assertFails(setDoc(
      doc(ctx('uidUser'), 'events', EVENT_LOCKS, 'registrationLocks', lockId),
      legalLock(lockId, 'uidUser'),
    ));
  });

  test('刪除自己的 registrationLock 被拒', async () => {
    await assertFails(deleteDoc(
      doc(ctx('uidUser'), 'events', EVENT_LOCKS, 'registrationLocks', 'self_uidUser'),
    ));
  });
});

describe('管理員可寫根層紀錄，course-linked 仍拒', () => {
  test('管理員可建立並更新根層 attendanceRecords', async () => {
    const ref = doc(ctx('uidAdmin'), 'attendanceRecords', 'attByAdmin');
    await assertSucceeds(setDoc(ref, {
      uid: 'uidOther',
      eventId: EVENT_HOST,
      type: 'checkin',
      status: 'active',
    }));
    await assertSucceeds(updateDoc(ref, {
      status: 'checkout',
      checkOutTime: new Date(),
    }));
  });

  test('管理員可建立並更新根層 activityRecords', async () => {
    const ref = doc(ctx('uidAdmin'), 'activityRecords', 'actByAdmin');
    await assertSucceeds(setDoc(ref, {
      uid: 'uidOther',
      eventId: EVENT_HOST,
      status: 'active',
    }));
    await assertSucceeds(updateDoc(ref, { status: 'cancelled' }));
  });

  test('管理員建立指向私人課程活動的根層 attendanceRecords 仍被拒', async () => {
    await assertFails(setDoc(doc(ctx('uidAdmin'), 'attendanceRecords', 'attPrivate'), {
      uid: 'uidOther',
      eventId: EVENT_PRIVATE,
      type: 'checkin',
      status: 'active',
    }));
  });

  test('管理員建立帶 courseLinkId 的根層 activityRecords 仍被拒', async () => {
    await assertFails(setDoc(doc(ctx('uidAdmin'), 'activityRecords', 'actLinked'), {
      uid: 'uidOther',
      eventId: EVENT_HOST,
      status: 'active',
      courseLinkId: 'link-1',
    }));
  });

  test('管理員更新已帶 courseLinkId 的根層 activityRecords 仍被拒', async () => {
    await assertFails(updateDoc(doc(ctx('uidAdmin'), 'activityRecords', 'actCourse'), {
      status: 'cancelled',
    }));
  });
});

describe('管理員可建立與刪除報名鎖，更新仍全拒', () => {
  test('管理員可建立 registrationLock', async () => {
    const lockId = 'lock_by_admin';
    await assertSucceeds(setDoc(
      doc(ctx('uidAdmin'), 'events', EVENT_LOCKS, 'registrationLocks', lockId),
      legalLock(lockId, 'uidOther'),
    ));
  });

  test('管理員更新 registrationLock 仍被拒', async () => {
    await assertFails(updateDoc(
      doc(ctx('uidAdmin'), 'events', EVENT_LOCKS, 'registrationLocks', 'lockAdmin'),
      { status: 'released' },
    ));
  });

  test('管理員可刪除 registrationLock', async () => {
    await assertSucceeds(deleteDoc(
      doc(ctx('uidAdmin'), 'events', EVENT_LOCKS, 'registrationLocks', 'lockAdmin'),
    ));
  });
});

describe('讀取不受影響', () => {
  test('一般登入者可讀根層紀錄與報名鎖', async () => {
    const db = ctx('uidUser');
    await assertSucceeds(getDoc(doc(db, 'attendanceRecords', 'attOwn')));
    await assertSucceeds(getDoc(doc(db, 'activityRecords', 'actOwn')));
    await assertSucceeds(getDoc(doc(db, 'events', EVENT_LOCKS, 'registrationLocks', 'self_uidUser')));
  });

  test('未登入讀根層紀錄與報名鎖被拒', async () => {
    const db = guestDb();
    await assertFails(getDoc(doc(db, 'attendanceRecords', 'attOwn')));
    await assertFails(getDoc(doc(db, 'activityRecords', 'actOwn')));
    await assertFails(getDoc(doc(db, 'events', EVENT_LOCKS, 'registrationLocks', 'self_uidUser')));
  });
});

describe('子集合簽到未被誤傷', () => {
  test('活動主辦（coach）仍可在 events/{id}/attendanceRecords 新增簽到', async () => {
    await assertSucceeds(setDoc(
      doc(ctx('uidCoach'), 'events', EVENT_HOST, 'attendanceRecords', 'hostCheckin'),
      {
        eventId: EVENT_HOST,
        uid: 'uidOther',
        type: 'checkin',
        status: 'active',
      },
    ));
  });
});
