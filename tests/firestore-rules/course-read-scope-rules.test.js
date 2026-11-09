/**
 * 課程資料讀取權限收斂：teams/{teamId}/students 與 eduAttendance 的讀取範圍。
 * 每種身分的單筆讀取，以及舊站 A 實際使用的列表查詢（Rules 對列表是整查詢判定，查詢條件必須能證明每筆可讀）。
 */
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} = require('firebase/firestore');

const PROJECT_ID = 'demo-rules-test';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
let testEnv;

jest.setTimeout(30000);

const TEAM = 'teamCourse';
const PLAN = 'planWeekly';

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
    const users = {
      uidCaptain: 'captain',
      uidCoach: 'coach',
      uidLeader: 'user',
      uidSelf: 'user',
      uidParent: 'user',
      uidOther: 'user',
      uidAgent: 'user',
      uidSA: 'super_admin',
      uidManageAll: 'admin',
      uidGrant: 'user',
      uidAdminNoPerm: 'admin',
    };
    for (const [uid, role] of Object.entries(users)) {
      await setDoc(doc(db, 'users', uid), { uid, role, displayName: uid });
    }
    await setDoc(doc(db, 'rolePermissions', 'admin'), { permissions: [] });
    await setDoc(doc(db, 'rolePermissions', 'manage_all_role'), { permissions: ['team.manage_all'] });
    await setDoc(doc(db, 'users', 'uidManageAll'), { uid: 'uidManageAll', role: 'manage_all_role', displayName: 'MA' });
    await setDoc(doc(db, 'userPermissionGrants', 'uidGrant'), { uid: 'uidGrant', permissions: ['team.manage_all'], enabled: true });

    await setDoc(doc(db, 'teams', TEAM), {
      id: TEAM,
      name: 'Course Club',
      type: 'education',
      captainUid: 'uidCaptain',
      leaderUids: ['uidLeader'],
      coachUids: ['uidCoach'],
    });
    await setDoc(doc(db, 'teams', 'teamOther'), {
      id: 'teamOther',
      name: 'Other Club',
      captainUid: 'uidOther',
    });
    await setDoc(doc(db, 'teams', TEAM, 'coursePlans', PLAN), {
      name: 'Weekly',
      planType: 'weekly',
      rosterAgentUids: ['uidAgent'],
    });

    const students = {
      stuSelf: { name: 'Self', selfUid: 'uidSelf', parentUid: null, enrollStatus: 'active' },
      stuChild: { name: 'Child', selfUid: null, parentUid: 'uidParent', enrollStatus: 'active' },
      stuStranger: { name: 'Stranger', selfUid: 'uidStranger', parentUid: null, enrollStatus: 'active' },
      stuNoUid: { name: 'External', enrollStatus: 'pending' },
    };
    for (const [id, data] of Object.entries(students)) {
      await setDoc(doc(db, 'teams', TEAM, 'students', id), { id, ...data });
    }

    const base = { teamId: TEAM, coursePlanId: PLAN, groupId: 'grp1', sessionId: 's1', date: '2099-06-01', kind: 'registered', status: 'active' };
    // 舊資料多半沒有 selfUid／parentUid，本人／家長要靠學員文件判定
    await setDoc(doc(db, 'eduAttendance', 'attSelf'), { ...base, studentId: 'stuSelf', selfUid: 'uidSelf', parentUid: null });
    await setDoc(doc(db, 'eduAttendance', 'attChildLegacy'), { ...base, studentId: 'stuChild' });
    await setDoc(doc(db, 'eduAttendance', 'attStranger'), { ...base, studentId: 'stuStranger', selfUid: 'uidStranger' });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

function as(uid) {
  return testEnv.authenticatedContext(uid, { role: 'user' }).firestore();
}

function guest() {
  return testEnv.unauthenticatedContext().firestore();
}

const studentDoc = (db, id) => doc(db, 'teams', TEAM, 'students', id);
const studentsCol = db => collection(db, 'teams', TEAM, 'students');
const attendanceCol = db => collection(db, 'eduAttendance');

describe('teams/{teamId}/students read scope', () => {
  test('team staff (captain, leader, coach) can get and list the full roster', async () => {
    for (const uid of ['uidCaptain', 'uidLeader', 'uidCoach']) {
      await assertSucceeds(getDoc(studentDoc(as(uid), 'stuStranger')));
      await assertSucceeds(getDocs(studentsCol(as(uid))));
    }
  });

  test('super admin, team.manage_all role and team.manage_all grant can list the full roster', async () => {
    for (const uid of ['uidSA', 'uidManageAll', 'uidGrant']) {
      await assertSucceeds(getDocs(studentsCol(as(uid))));
      await assertSucceeds(getDoc(studentDoc(as(uid), 'stuNoUid')));
    }
  });

  test('student self and parent can get their own student', async () => {
    await assertSucceeds(getDoc(studentDoc(as('uidSelf'), 'stuSelf')));
    await assertSucceeds(getDoc(studentDoc(as('uidParent'), 'stuChild')));
  });

  test('signed-in users cannot get students that are not theirs', async () => {
    await assertFails(getDoc(studentDoc(as('uidSelf'), 'stuChild')));
    await assertFails(getDoc(studentDoc(as('uidOther'), 'stuSelf')));
    await assertFails(getDoc(studentDoc(as('uidOther'), 'stuNoUid')));
    await assertFails(getDoc(studentDoc(as('uidAdminNoPerm'), 'stuSelf')));
    await assertFails(getDoc(studentDoc(guest(), 'stuSelf')));
  });

  test('staff of another club cannot read this roster', async () => {
    await assertFails(getDocs(studentsCol(as('uidOther'))));
  });

  test('course roster agents are not given student read access', async () => {
    await assertFails(getDoc(studentDoc(as('uidAgent'), 'stuSelf')));
    await assertFails(getDocs(studentsCol(as('uidAgent'))));
  });

  test('non-staff full-roster list is rejected (old full-collection query and listeners)', async () => {
    await assertFails(getDocs(studentsCol(as('uidSelf'))));
    await assertFails(getDocs(studentsCol(as('uidParent'))));
    await assertFails(getDocs(studentsCol(guest())));
  });

  test('non-staff owner queries (where selfUid / parentUid == me) are allowed and return only own students', async () => {
    const selfSnap = await assertSucceeds(getDocs(query(studentsCol(as('uidSelf')), where('selfUid', '==', 'uidSelf'))));
    expect(selfSnap.docs.map(d => d.id)).toEqual(['stuSelf']);
    const parentSnap = await assertSucceeds(getDocs(query(studentsCol(as('uidParent')), where('parentUid', '==', 'uidParent'))));
    expect(parentSnap.docs.map(d => d.id)).toEqual(['stuChild']);
    // A 的另一半查詢：沒有名下學員時也要能成功（空結果）
    const emptySnap = await assertSucceeds(getDocs(query(studentsCol(as('uidSelf')), where('parentUid', '==', 'uidSelf'))));
    expect(emptySnap.docs).toEqual([]);
  });

  test('owner queries for someone else are rejected', async () => {
    await assertFails(getDocs(query(studentsCol(as('uidOther')), where('selfUid', '==', 'uidSelf'))));
    await assertFails(getDocs(query(studentsCol(as('uidOther')), where('parentUid', '==', 'uidParent'))));
  });
});

describe('eduAttendance read scope', () => {
  test('team staff, super admin and team.manage_all can get any record of the club', async () => {
    for (const uid of ['uidCaptain', 'uidLeader', 'uidCoach', 'uidSA', 'uidManageAll', 'uidGrant']) {
      await assertSucceeds(getDoc(doc(as(uid), 'eduAttendance', 'attStranger')));
    }
  });

  test('course roster agent can get records of the assigned plan', async () => {
    await assertSucceeds(getDoc(doc(as('uidAgent'), 'eduAttendance', 'attStranger')));
  });

  test('self can get own record; parent can get a legacy record through the student doc', async () => {
    await assertSucceeds(getDoc(doc(as('uidSelf'), 'eduAttendance', 'attSelf')));
    await assertSucceeds(getDoc(doc(as('uidParent'), 'eduAttendance', 'attChildLegacy')));
  });

  test('other signed-in users and guests cannot get records', async () => {
    await assertFails(getDoc(doc(as('uidOther'), 'eduAttendance', 'attSelf')));
    await assertFails(getDoc(doc(as('uidSelf'), 'eduAttendance', 'attChildLegacy')));
    await assertFails(getDoc(doc(as('uidAdminNoPerm'), 'eduAttendance', 'attSelf')));
    await assertFails(getDoc(doc(guest(), 'eduAttendance', 'attSelf')));
  });

  test('staff list queries used by A pass (teamId / +coursePlanId / +date / +groupId)', async () => {
    const db = as('uidCaptain');
    await assertSucceeds(getDocs(query(attendanceCol(db), where('teamId', '==', TEAM))));
    // E1／E2：課堂列表已報名數
    await assertSucceeds(getDocs(query(attendanceCol(db), where('teamId', '==', TEAM), where('coursePlanId', '==', PLAN))));
    // E3：出席統計（月曆、單日明細）
    await assertSucceeds(getDocs(query(attendanceCol(db), where('teamId', '==', TEAM), where('coursePlanId', '==', PLAN), where('date', '==', '2099-06-01'))));
    // edu-checkin／edu-notify：分組簽到
    await assertSucceeds(getDocs(query(attendanceCol(db), where('teamId', '==', TEAM), where('groupId', '==', 'grp1'), where('date', '==', '2099-06-01'))));
    // 教練與 manage_all 也一樣
    await assertSucceeds(getDocs(query(attendanceCol(as('uidCoach')), where('teamId', '==', TEAM), where('coursePlanId', '==', PLAN))));
    await assertSucceeds(getDocs(query(attendanceCol(as('uidGrant')), where('teamId', '==', TEAM), where('coursePlanId', '==', PLAN))));
  });

  test('E3 for the roster agent: plan-scoped list (with and without date) passes', async () => {
    const db = as('uidAgent');
    await assertSucceeds(getDocs(query(attendanceCol(db), where('teamId', '==', TEAM), where('coursePlanId', '==', PLAN))));
    await assertSucceeds(getDocs(query(attendanceCol(db), where('teamId', '==', TEAM), where('coursePlanId', '==', PLAN), where('date', '==', '2099-06-01'))));
  });

  test('roster agent cannot list another plan or the whole club', async () => {
    const db = as('uidAgent');
    await assertFails(getDocs(query(attendanceCol(db), where('teamId', '==', TEAM))));
    await assertFails(getDocs(query(attendanceCol(db), where('teamId', '==', TEAM), where('coursePlanId', '==', 'planOther'))));
  });

  test('E4: self and parent can list their own student records by teamId + coursePlanId + studentId', async () => {
    const selfSnap = await assertSucceeds(getDocs(query(
      attendanceCol(as('uidSelf')),
      where('teamId', '==', TEAM),
      where('coursePlanId', '==', PLAN),
      where('studentId', '==', 'stuSelf'),
    )));
    expect(selfSnap.docs.map(d => d.id)).toEqual(['attSelf']);
    const parentSnap = await assertSucceeds(getDocs(query(
      attendanceCol(as('uidParent')),
      where('teamId', '==', TEAM),
      where('coursePlanId', '==', PLAN),
      where('studentId', '==', 'stuChild'),
    )));
    expect(parentSnap.docs.map(d => d.id)).toEqual(['attChildLegacy']);
  });

  test('E4 for a student that is not mine is rejected', async () => {
    await assertFails(getDocs(query(
      attendanceCol(as('uidOther')),
      where('teamId', '==', TEAM),
      where('coursePlanId', '==', PLAN),
      where('studentId', '==', 'stuSelf'),
    )));
    await assertFails(getDocs(query(
      attendanceCol(as('uidSelf')),
      where('teamId', '==', TEAM),
      where('coursePlanId', '==', PLAN),
      where('studentId', '==', 'stuChild'),
    )));
  });

  test('non-staff plan-wide and unfiltered lists are rejected (old E1/E2 clients)', async () => {
    for (const uid of ['uidSelf', 'uidParent', 'uidOther', 'uidAdminNoPerm']) {
      await assertFails(getDocs(query(attendanceCol(as(uid)), where('teamId', '==', TEAM), where('coursePlanId', '==', PLAN))));
      await assertFails(getDocs(attendanceCol(as(uid))));
    }
    await assertFails(getDocs(query(attendanceCol(guest()), where('teamId', '==', TEAM))));
  });

  test('staff of another club cannot list this club', async () => {
    await assertFails(getDocs(query(attendanceCol(as('uidOther')), where('teamId', '==', TEAM))));
  });
});
