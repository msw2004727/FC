/**
 * 課程資料讀取權限收斂：舊站 A 的學員／出缺席讀取改成依身分縮小範圍。
 * - 幹部讀整份學員名單；非幹部只讀 selfUid／parentUid 是自己的學員（兩次查詢合併）。
 * - 非幹部不掛整個學員子集合的即時監聽。
 * - 名下學員沒載到時，申請重複檢查與報名自動建立本人都停下，不重複建檔。
 * - 固定週期課堂的已報名數只有幹部查詢與顯示。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function snapshotOf(docs) {
  return {
    docs: docs.map(item => ({ id: item.id, data: () => ({ ...item }) })),
  };
}

function loadCrud() {
  const FirebaseService = {};
  const sandbox = {
    FirebaseService,
    db: {},
    _stripDocId: obj => {
      const { _docId, ...rest } = obj || {};
      return rest;
    },
    firebase: { firestore: { FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') } } },
    console,
  };
  vm.runInNewContext(read('js/firebase-crud.js'), sandbox, { filename: 'js/firebase-crud.js' });
  return FirebaseService;
}

describe('FirebaseService.listEduStudents read scope', () => {
  test('without ownerUid reads the whole students subcollection (staff path)', async () => {
    const FirebaseService = loadCrud();
    const collRef = {
      get: jest.fn(async () => snapshotOf([{ id: 'stu1', name: 'A' }, { id: 'stu2', name: 'B' }])),
      where: jest.fn(),
    };
    FirebaseService._getTeamSubcollectionRef = jest.fn(async () => collRef);

    const students = await FirebaseService.listEduStudents('teamA');

    expect(FirebaseService._getTeamSubcollectionRef).toHaveBeenCalledWith('teamA', 'students');
    expect(collRef.get).toHaveBeenCalledTimes(1);
    expect(collRef.where).not.toHaveBeenCalled();
    expect(students.map(s => s.id)).toEqual(['stu1', 'stu2']);
  });

  test('with ownerUid queries selfUid and parentUid separately and merges by doc id', async () => {
    const FirebaseService = loadCrud();
    const bySelf = [{ id: 'stuSelf', selfUid: 'uidA' }, { id: 'stuBoth', selfUid: 'uidA', parentUid: 'uidA' }];
    const byParent = [{ id: 'stuChild', parentUid: 'uidA' }, { id: 'stuBoth', selfUid: 'uidA', parentUid: 'uidA' }];
    const collRef = {
      get: jest.fn(),
      where: jest.fn((field, op, value) => ({
        get: jest.fn(async () => {
          expect(op).toBe('==');
          expect(value).toBe('uidA');
          return snapshotOf(field === 'selfUid' ? bySelf : byParent);
        }),
      })),
    };
    FirebaseService._getTeamSubcollectionRef = jest.fn(async () => collRef);

    const students = await FirebaseService.listEduStudents('teamA', { ownerUid: 'uidA' });

    expect(collRef.get).not.toHaveBeenCalled();
    expect(collRef.where.mock.calls.map(call => call[0]).sort()).toEqual(['parentUid', 'selfUid']);
    expect(students.map(s => s.id).sort()).toEqual(['stuBoth', 'stuChild', 'stuSelf']);
    expect(students.every(s => s._docId === s.id)).toBe(true);
  });
});

function loadStudentListContext({ isStaff, uid = 'uidA', listEduStudents }) {
  const currentUser = uid ? { uid } : null;
  const ApiService = {
    getCurrentUser: jest.fn(() => currentUser),
    listEduStudents: listEduStudents || jest.fn(async () => []),
  };
  const app = {
    isEduClubStaff: jest.fn(() => isStaff),
    showToast: jest.fn(),
  };
  const context = { App: app, ApiService, console: { ...console, error: jest.fn() }, Promise, Map, Set, Array, String, Object };
  vm.runInNewContext(read('js/modules/education/edu-student-list.js'), context, { filename: 'edu-student-list.js' });
  return { app, ApiService, context };
}

describe('App._loadEduStudents read scope', () => {
  test('staff loads the full roster', async () => {
    const { app, ApiService } = loadStudentListContext({ isStaff: true });
    await app._loadEduStudents('teamA');
    expect(ApiService.listEduStudents).toHaveBeenCalledWith('teamA', undefined);
  });

  test('non-staff loads only students owned by the current uid', async () => {
    const owned = [{ id: 'stuSelf', selfUid: 'uidA', enrollStatus: 'active' }];
    const { app, ApiService } = loadStudentListContext({
      isStaff: false,
      listEduStudents: jest.fn(async () => owned),
    });
    const students = await app._loadEduStudents('teamA');
    expect(ApiService.listEduStudents).toHaveBeenCalledWith('teamA', { ownerUid: 'uidA' });
    expect(students).toEqual(owned);
    expect(app._eduStudentsLoadFailedByTeam.teamA).toBe(false);
  });

  test('signed-out non-staff does not query at all', async () => {
    const { app, ApiService } = loadStudentListContext({ isStaff: false, uid: null });
    await expect(app._loadEduStudents('teamA')).resolves.toEqual([]);
    expect(ApiService.listEduStudents).not.toHaveBeenCalled();
  });

  test('a denied query degrades to an empty list and marks the load as failed', async () => {
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    const { app } = loadStudentListContext({
      isStaff: false,
      listEduStudents: jest.fn(async () => { throw denied; }),
    });
    await expect(app._loadEduStudents('teamA')).resolves.toEqual([]);
    expect(app._eduStudentsLoadFailedByTeam.teamA).toBe(true);
  });
});

describe('students realtime listeners are staff only', () => {
  function loadRealtime({ staffTeamIds }) {
    const onSnapshot = jest.fn(() => jest.fn());
    const collection = jest.fn(() => ({
      doc: jest.fn(() => ({ collection: jest.fn(() => ({ onSnapshot })) })),
    }));
    const app = {
      _eduStudentsCache: {},
      isEduClubStaff: jest.fn(teamOrId => staffTeamIds.includes(typeof teamOrId === 'string' ? teamOrId : teamOrId?.id)),
    };
    const context = {
      App: app,
      firebase: { firestore: jest.fn(() => ({ collection })) },
      FirebaseService: { _cache: { teams: [] } },
      console,
      Set,
    };
    vm.runInNewContext(read('js/modules/education/edu-detail-realtime.js'), context, { filename: 'edu-detail-realtime.js' });
    return { app, onSnapshot, collection };
  }

  test('club detail listener is not mounted for non-staff', () => {
    const { app, onSnapshot } = loadRealtime({ staffTeamIds: [] });
    app._startEduStudentsListener('teamA');
    expect(onSnapshot).not.toHaveBeenCalled();
  });

  test('club detail listener is mounted for staff', () => {
    const { app, onSnapshot } = loadRealtime({ staffTeamIds: ['teamA'] });
    app._startEduStudentsListener('teamA');
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });

  test('club list only mounts student listeners for clubs the viewer staffs', () => {
    const { app, onSnapshot } = loadRealtime({ staffTeamIds: ['teamStaff'] });
    app._ensureEduTeamsStudentListeners([
      { id: 'teamStaff', type: 'education' },
      { id: 'teamOther', type: 'education' },
      { id: 'teamGeneral', type: 'general' },
    ]);
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(app._eduTeamsStudentUnsubs.map(unsub => unsub._teamId)).toEqual(['teamStaff']);
  });
});

function makeElement(value = '') {
  return { value, readOnly: false, disabled: false, textContent: '', style: {} };
}

function loadJoinContext({ listEduStudents, relation = 'self', name = 'Self Student' }) {
  const elements = {
    'edu-apply-team-id': makeElement('teamA'),
    'edu-apply-name': makeElement(name),
    'edu-apply-birthday': makeElement('2015-01-01'),
    'edu-apply-gender': makeElement('male'),
    'edu-apply-relation': makeElement(relation),
  };
  const currentUser = { uid: 'uidA', displayName: 'Self Student' };
  const ApiService = {
    getCurrentUser: jest.fn(() => currentUser),
    getTeam: jest.fn(() => ({ id: 'teamA', name: 'Club A', type: 'education' })),
    listEduStudents,
    updateCurrentUser: jest.fn(),
  };
  const FirebaseService = { createEduStudent: jest.fn(async () => ({})) };
  const app = {
    isEduClubStaff: jest.fn(() => false),
    isEducationClub: jest.fn(() => true),
    showToast: jest.fn(),
    _setEduBtnLoading: jest.fn(() => ({ restore: jest.fn() })),
    _generateEduId: jest.fn(() => 'stuNew'),
    calcAge: jest.fn(() => 10),
    _loadEduGroups: jest.fn(async () => []),
    autoMatchGroups: jest.fn(() => []),
  };
  const context = {
    App: app,
    ApiService,
    FirebaseService,
    document: { getElementById: jest.fn(id => elements[id] || null) },
    console: { ...console, error: jest.fn() },
    Promise, Map, Set, Array, String, Object, Number, Date, Error,
  };
  vm.runInNewContext(read('js/modules/education/edu-student-list.js'), context, { filename: 'edu-student-list.js' });
  vm.runInNewContext(read('js/modules/education/edu-student-join.js'), context, { filename: 'edu-student-join.js' });
  return { app, ApiService, FirebaseService };
}

describe('student apply duplicate check under owner-scoped reads', () => {
  test('finds the existing self student through the owner query and blocks a duplicate', async () => {
    const listEduStudents = jest.fn(async (teamId, options) => (
      options?.ownerUid === 'uidA' ? [{ id: 'stuSelf', selfUid: 'uidA', enrollStatus: 'pending' }] : []
    ));
    const { app, ApiService, FirebaseService } = loadJoinContext({ listEduStudents });

    await app.handleEduStudentApply();

    expect(ApiService.listEduStudents).toHaveBeenCalledWith('teamA', { ownerUid: 'uidA' });
    expect(app.showToast).toHaveBeenCalledWith('您已以本人身份加入此俱樂部');
    expect(FirebaseService.createEduStudent).not.toHaveBeenCalled();
  });

  test('finds an existing child applied by the same parent and blocks a duplicate', async () => {
    const listEduStudents = jest.fn(async () => [{ id: 'stuChild', parentUid: 'uidA', name: 'Kid', enrollStatus: 'active' }]);
    const { app, FirebaseService } = loadJoinContext({ listEduStudents, relation: 'parent', name: 'Kid' });

    await app.handleEduStudentApply();

    expect(app.showToast).toHaveBeenCalledWith(expect.stringContaining('已申請過此俱樂部'));
    expect(FirebaseService.createEduStudent).not.toHaveBeenCalled();
  });

  test('stops instead of creating when the owner query fails', async () => {
    const listEduStudents = jest.fn(async () => { throw new Error('permission-denied'); });
    const { app, FirebaseService } = loadJoinContext({ listEduStudents });

    await app.handleEduStudentApply();

    expect(app.showToast).toHaveBeenCalledWith('學員資料載入失敗，請稍後再試');
    expect(FirebaseService.createEduStudent).not.toHaveBeenCalled();
  });
});

function loadEnrollmentContext({ listEduStudents }) {
  const overlay = { className: '', innerHTML: '', onclick: null, remove: jest.fn(), querySelectorAll: jest.fn(() => []) };
  const currentUser = { uid: 'uidA', displayName: 'Self Student' };
  const ApiService = {
    getCurrentUser: jest.fn(() => currentUser),
    listEduStudents,
  };
  const FirebaseService = { createEduStudent: jest.fn(async (teamId, data) => ({ ...data })) };
  const app = {
    isEduClubStaff: jest.fn(() => false),
    showToast: jest.fn(),
    getEduCoursePlans: jest.fn(() => [{ id: 'planA', name: 'Plan A', planType: 'session', price: 0 }]),
    _setEduCourseActionLoading: jest.fn(() => ({ active: true, restore: jest.fn() })),
    _loadCourseEnrollments: jest.fn(async () => []),
    _isCourseEnrollmentActiveStatus: jest.fn(() => false),
    _generateEduId: jest.fn(() => 'stuNew'),
  };
  const context = {
    App: app,
    ApiService,
    FirebaseService,
    document: {
      createElement: jest.fn(() => overlay),
      body: { appendChild: jest.fn() },
      getElementById: jest.fn(() => ({})),
    },
    escapeHTML,
    console: { ...console, error: jest.fn() },
    Promise, Map, Set, Array, String, Object, Number, Date, Error,
  };
  vm.runInNewContext(read('js/modules/education/edu-student-list.js'), context, { filename: 'edu-student-list.js' });
  vm.runInNewContext(read('js/modules/education/edu-course-enrollment.js'), context, { filename: 'edu-course-enrollment.js' });
  return { app, FirebaseService, overlay };
}

describe('course enrollment self-student auto-create under owner-scoped reads', () => {
  test('uses the owner-scoped student and does not auto-create another self student', async () => {
    const listEduStudents = jest.fn(async (teamId, options) => (
      options?.ownerUid === 'uidA' ? [{ id: 'stuSelf', name: 'Self Student', selfUid: 'uidA', enrollStatus: 'active' }] : []
    ));
    const { app, FirebaseService, overlay } = loadEnrollmentContext({ listEduStudents });
    await app._loadEduStudents('teamA');

    await app.applyCourseEnrollment('teamA', 'planA', null);

    expect(FirebaseService.createEduStudent).not.toHaveBeenCalled();
    expect(overlay.innerHTML).toContain('Self Student');
  });

  test('stops instead of auto-creating when the owner query failed', async () => {
    const listEduStudents = jest.fn(async () => { throw new Error('permission-denied'); });
    const { app, FirebaseService } = loadEnrollmentContext({ listEduStudents });
    await app._loadEduStudents('teamA');

    await app.applyCourseEnrollment('teamA', 'planA', null);

    expect(app.showToast).toHaveBeenCalledWith('學員資料載入失敗，請稍後再試');
    expect(FirebaseService.createEduStudent).not.toHaveBeenCalled();
  });
});

describe('weekly lesson list count visibility', () => {
  function loadRender() {
    const app = {
      _getCourseSessionStatusMeta: jest.fn(() => ({ label: '已排課', cls: 'scheduled' })),
      _formatCourseLessonDateTime: jest.fn(() => '2099-06-01 09:00'),
    };
    const context = { App: app, escapeHTML, escapeJsAttr: value => String(value ?? ''), ApiService: {}, Date, Number, String, Object, Array };
    vm.runInNewContext(read('js/modules/education/edu-course-lessons-render.js'), context, { filename: 'edu-course-lessons-render.js' });
    return app;
  }
  const session = { id: 'weeklyA', title: 'Lesson 1', date: '2099-06-01', capacity: 6, studentIds: ['stu1', 'stu2', 'stu3'] };

  test('non-staff does not see the weekly registered count', () => {
    const app = loadRender();
    const html = app._renderCourseLessonList({ id: 'weeklyPlan', planType: 'weekly' }, [session], {
      teamId: 'teamA', planId: 'weeklyPlan', isStaff: false, planType: 'weekly', confirmedCountBySessionId: null,
    });
    expect(html).toContain('Lesson 1');
    expect(html).not.toContain('edu-course-lesson-meta-count');
    expect(html).not.toContain(' 人');
  });

  test('staff still sees the weekly registered count', () => {
    const app = loadRender();
    const html = app._renderCourseLessonList({ id: 'weeklyPlan', planType: 'weekly' }, [session], {
      teamId: 'teamA', planId: 'weeklyPlan', isStaff: true, planType: 'weekly', confirmedCountBySessionId: { weeklyA: 2 },
    });
    expect(html).toContain('edu-course-lesson-meta-count');
    expect(html).toContain('2/6 人');
  });

  test('session plans keep their count for non-staff (roster count, no attendance read)', () => {
    const app = loadRender();
    const html = app._renderCourseLessonList({ id: 'planA', planType: 'session' }, [session], {
      teamId: 'teamA', planId: 'planA', isStaff: false, planType: 'session', currentStudentCount: 3,
    });
    expect(html).toContain('edu-course-lesson-meta-count');
  });
});
