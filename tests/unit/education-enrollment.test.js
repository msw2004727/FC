/**
 * Education Enrollment — unit tests
 *
 * Tests the enrollment decision logic extracted from:
 *   - edu-student-join.js  (student apply / duplicate detection / accepting check)
 *   - edu-course-enrollment.js (course enrollment / approval / rejection)
 *   - edu-detail-withdraw.js (student withdrawal)
 *
 * The actual functions are DOM/Firebase-coupled, so we extract the
 * pure validation and decision logic and test it in isolation.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const enrollmentSource = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-enrollment.js'),
  'utf8'
);

function loadCourseEnrollmentModule(app, extraContext = {}) {
  const context = {
    App: app,
    FirebaseService: {},
    ApiService: {},
    document: { getElementById: jest.fn(() => null) },
    window: {},
    localStorage: { getItem: jest.fn(() => null) },
    console,
    Object,
    String,
    Date,
    ...extraContext,
  };
  vm.runInNewContext(enrollmentSource, context, { filename: 'edu-course-enrollment.js' });
  return context.App;
}

// Extracted from js/modules/education/edu-student-join.js:107-128
// Duplicate detection logic for student applications
function hasSelfDuplicate(existingStudents, uid) {
  return existingStudents.some(s => s.enrollStatus !== 'inactive' && s.selfUid === uid);
}
function hasAgentDuplicate(existingStudents, parentUid, name) {
  return existingStudents.some(s =>
    s.enrollStatus !== 'inactive' && s.parentUid === parentUid && (s.name || '').trim() === name.trim()
  );
}

// Extracted from js/modules/education/edu-student-join.js:75-128
// Enrollment validation — simulates handleEduStudentApply decision logic
function validateStudentApply({ name, birthday, gender, teamId, relation, curUser, team, existingStudents }) {
  if (!name) return { error: 'missing_name' };
  if (!birthday) return { error: 'missing_birthday' };
  if (!gender) return { error: 'missing_gender' };
  if (!teamId) return { error: 'missing_teamId' };
  if (!curUser) return { error: 'not_logged_in' };
  if (!team) return { error: 'team_not_found' };
  if (team.eduSettings && team.eduSettings.acceptingStudents === false) return { error: 'not_accepting' };
  if (relation === 'self') {
    if (hasSelfDuplicate(existingStudents, curUser.uid)) return { error: 'self_duplicate' };
  } else {
    if (hasAgentDuplicate(existingStudents, curUser.uid, name)) return { error: 'agent_duplicate' };
  }
  return { ok: true };
}

// Extracted from js/modules/education/edu-course-enrollment.js:63-67
function isCourseEnrolled(enrollments, studentId) {
  const inactiveStatuses = new Set(['rejected', 'cancelled', 'canceled', 'removed']);
  return enrollments.some(e => e.studentId === studentId && !inactiveStatuses.has(String(e.status || '').toLowerCase()));
}

// Extracted from js/modules/education/edu-course-enrollment.js:159-203
function approveEnrollment(enrollment, studentEnrollStatus) {
  if (!enrollment) return { error: 'enrollment_not_found' };
  return {
    enrollmentStatus: 'approved',
    studentEnrollStatus: studentEnrollStatus === 'pending' ? 'active' : studentEnrollStatus,
    countDelta: 1,
  };
}
function rejectEnrollment(enrollment) {
  if (!enrollment) return { error: 'enrollment_not_found' };
  return { enrollmentStatus: 'rejected' };
}

// Extracted from js/modules/education/edu-detail-withdraw.js:72-90
function withdrawStudent(students, studentId) {
  const student = students.find(s => s.id === studentId);
  if (!student) return { error: 'student_not_found' };
  const updatedStudents = students.map(s =>
    s.id === studentId ? { ...s, enrollStatus: 'inactive' } : { ...s }
  );
  return { updatedStudents, withdrawnStudent: { ...student, enrollStatus: 'inactive' } };
}

// Pure helper: count active students
function countActiveStudents(students) {
  return students.filter(s => s.enrollStatus === 'active').length;
}

// ===========================================================================
// TESTS
// ===========================================================================

const BASE_INPUT = {
  name: 'Alice', birthday: '2015-06-15', gender: 'female', teamId: 'team1',
  relation: 'self', curUser: { uid: 'u1', displayName: 'Alice' },
  team: { id: 'team1', name: 'FC Youth', eduSettings: { acceptingStudents: true } },
  existingStudents: [],
};
const withStudents = (students, extra) => ({ ...BASE_INPUT, ...extra, existingStudents: students });

describe('Student enrollment — happy path & validation', () => {
  test('new self-enrollment is accepted', () => {
    expect(validateStudentApply(BASE_INPUT).ok).toBe(true);
  });

  test('new agent (parent) enrollment is accepted', () => {
    expect(validateStudentApply({ ...BASE_INPUT, relation: 'parent', name: 'Bobby' }).ok).toBe(true);
  });

  test.each([
    ['missing_name', { name: '' }],
    ['missing_birthday', { birthday: '' }],
    ['not_logged_in', { curUser: null }],
    ['team_not_found', { team: null }],
  ])('rejects with %s', (expected, override) => {
    expect(validateStudentApply({ ...BASE_INPUT, ...override }).error).toBe(expected);
  });
});

describe('Student enrollment — duplicate detection', () => {
  test('self duplicate detected (active)', () => {
    expect(validateStudentApply(
      withStudents([{ id: 's1', selfUid: 'u1', enrollStatus: 'active', name: 'Alice' }])
    ).error).toBe('self_duplicate');
  });

  test('self duplicate detected (pending)', () => {
    expect(validateStudentApply(
      withStudents([{ id: 's1', selfUid: 'u1', enrollStatus: 'pending', name: 'Alice' }])
    ).error).toBe('self_duplicate');
  });

  test('inactive self record does NOT block new apply', () => {
    expect(validateStudentApply(
      withStudents([{ id: 's1', selfUid: 'u1', enrollStatus: 'inactive', name: 'Alice' }])
    ).ok).toBe(true);
  });

  test('agent duplicate detected (same parent + same name)', () => {
    expect(validateStudentApply(
      withStudents([{ id: 's2', parentUid: 'u1', enrollStatus: 'active', name: 'Bobby' }],
        { relation: 'parent', name: 'Bobby' })
    ).error).toBe('agent_duplicate');
  });

  test('different name under same parent is NOT duplicate', () => {
    expect(validateStudentApply(
      withStudents([{ id: 's2', parentUid: 'u1', enrollStatus: 'active', name: 'Bobby' }],
        { relation: 'parent', name: 'Charlie' })
    ).ok).toBe(true);
  });

  test('same name under different parent is NOT duplicate', () => {
    expect(validateStudentApply(
      withStudents([{ id: 's2', parentUid: 'u_other', enrollStatus: 'active', name: 'Bobby' }],
        { relation: 'parent', name: 'Bobby' })
    ).ok).toBe(true);
  });
});

describe('Student enrollment — accepting check', () => {
  const applyWith = (eduSettings) => validateStudentApply({
    ...BASE_INPUT, team: { id: 't1', name: 'FC', eduSettings },
  });

  test('rejects when acceptingStudents is false', () => {
    expect(applyWith({ acceptingStudents: false }).error).toBe('not_accepting');
  });

  test('accepts when acceptingStudents is true', () => {
    expect(applyWith({ acceptingStudents: true }).ok).toBe(true);
  });

  test('accepts when eduSettings omits acceptingStudents', () => {
    expect(applyWith({}).ok).toBe(true);
  });

  test('accepts when eduSettings is undefined', () => {
    expect(validateStudentApply({ ...BASE_INPUT, team: { id: 't1', name: 'FC' } }).ok).toBe(true);
  });
});

describe('Student withdrawal', () => {
  test('withdrawal changes enrollStatus to inactive', () => {
    const students = [
      { id: 's1', name: 'Alice', enrollStatus: 'active' },
      { id: 's2', name: 'Bob', enrollStatus: 'active' },
    ];
    const result = withdrawStudent(students, 's1');
    expect(result.withdrawnStudent.enrollStatus).toBe('inactive');
    expect(result.updatedStudents.find(s => s.id === 's1').enrollStatus).toBe('inactive');
    expect(result.updatedStudents.find(s => s.id === 's2').enrollStatus).toBe('active');
  });

  test('non-existent student returns error', () => {
    expect(withdrawStudent([], 's999').error).toBe('student_not_found');
  });

  test('does not mutate original array', () => {
    const students = [{ id: 's1', name: 'Alice', enrollStatus: 'active' }];
    withdrawStudent(students, 's1');
    expect(students[0].enrollStatus).toBe('active');
  });
});

describe('Active student count', () => {
  test('counts only active students', () => {
    expect(countActiveStudents([
      { id: 's1', enrollStatus: 'active' }, { id: 's2', enrollStatus: 'pending' },
      { id: 's3', enrollStatus: 'inactive' }, { id: 's4', enrollStatus: 'active' },
    ])).toBe(2);
  });

  test('count decreases after withdrawal', () => {
    const students = [{ id: 's1', enrollStatus: 'active' }, { id: 's2', enrollStatus: 'active' }];
    const result = withdrawStudent(students, 's1');
    expect(countActiveStudents(result.updatedStudents)).toBe(1);
  });

  test('empty list returns 0', () => {
    expect(countActiveStudents([])).toBe(0);
  });
});

describe('Course enrollment', () => {
  test('course enrollment signup action keeps button loading scoped and cancellable', () => {
    expect(enrollmentSource).toContain('async applyCourseEnrollment(teamId, planId, actionButton)');
    expect(enrollmentSource).toContain("btn.dataset.eduActionLoading === '1'");
    expect(enrollmentSource).toContain("sourceOverlay.isConnected === false || sourceOverlay.hidden === true");
    expect(enrollmentSource).toContain('edu-inline-spinner');
  });

  test('pending enrollment cancel action uses confirmation and callable cancellation', () => {
    expect(enrollmentSource).toContain('async showCourseEnrollmentPendingCancelDialog(teamId, planId, actionButton)');
    expect(enrollmentSource).toContain('FirebaseService.cancelCourseEnrollment(teamId, planId, studentIds)');
    expect(enrollmentSource).toContain('await this.appConfirm');
    expect(enrollmentSource).toContain('_mergeCourseEnrollmentCacheAfterCancel(teamId, planId, cancelledIds)');
  });

  test('coach notes save is capped to 30 characters and refreshes roster', async () => {
    const input = { value: 'abcdefghijklmnopqrstuvwxyzABCDE' };
    const updateCourseEnrollment = jest.fn(async () => {});
    const app = {
      _isEduAutoEnrollmentMaterializationAllowed: jest.fn(() => true),
      _renderCourseEnrollmentList: jest.fn(async () => {}),
      showToast: jest.fn(),
    };

    const loaded = loadCourseEnrollmentModule(app, {
      document: { getElementById: jest.fn(() => input) },
      FirebaseService: { updateCourseEnrollment },
    });
    loaded._courseEnrollCache = {
      'teamA:planA': [{ id: 'enrA', coachNotes: '' }],
    };
    loaded._renderCourseEnrollmentList = app._renderCourseEnrollmentList;

    await loaded._saveEnrollNotes('teamA', 'planA', 'enrA', 'noteInput');

    expect(updateCourseEnrollment).toHaveBeenCalledWith('teamA', 'planA', 'enrA', {
      coachNotes: 'abcdefghijklmnopqrstuvwxyzABCD',
    });
    expect(input.value).toBe('abcdefghijklmnopqrstuvwxyzABCD');
    expect(loaded._courseEnrollCache['teamA:planA'][0].coachNotes).toBe('abcdefghijklmnopqrstuvwxyzABCD');
    expect(app._renderCourseEnrollmentList).toHaveBeenCalledWith('teamA', 'planA');
  });

  test('approved enrollment removal marks roster entry removed and refreshes views', async () => {
    const updateCourseEnrollment = jest.fn(async () => {});
    const refreshCourseViewsAfterEnrollmentChange = jest.fn(async () => {});
    const restore = jest.fn();
    const app = {
      appConfirm: jest.fn(async () => true),
      _setEduBtnLoading: jest.fn(() => ({ restore })),
      _renderCourseEnrollmentList: jest.fn(async () => {}),
      showToast: jest.fn(),
    };
    const loaded = loadCourseEnrollmentModule(app, {
      FirebaseService: { updateCourseEnrollment },
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'staffA', displayName: 'Staff A' })) },
    });
    loaded._getCourseEnrollCacheKey = (teamId, planId) => teamId + ':' + planId;
    loaded._courseEnrollCache = {
      'teamA:planA': [{ id: 'enrA', studentId: 'stuA', status: 'approved' }],
    };
    loaded._courseEnrollSummaryCache = {
      'teamA:planA': { effectiveApprovedCount: 1 },
    };
    loaded._refreshCourseViewsAfterEnrollmentChange = refreshCourseViewsAfterEnrollmentChange;

    await loaded._removeApprovedCourseEnrollment('teamA', 'planA', 'enrA', {});

    expect(app.appConfirm).toHaveBeenCalledWith('確定刪除此學員的課程報名？一旦確認就無法還原，學員需要重新申請。');
    expect(updateCourseEnrollment).toHaveBeenCalledWith('teamA', 'planA', 'enrA', expect.objectContaining({
      status: 'removed',
      removedByUid: 'staffA',
      removedByName: 'Staff A',
      previousStatus: 'approved',
    }));
    expect(loaded._courseEnrollCache['teamA:planA']).toBeUndefined();
    expect(loaded._courseEnrollSummaryCache['teamA:planA']).toBeUndefined();
    expect(app._renderCourseEnrollmentList).toHaveBeenCalledWith('teamA', 'planA');
    expect(refreshCourseViewsAfterEnrollmentChange).toHaveBeenCalledWith('teamA', 'planA', { force: true });
    expect(restore).toHaveBeenCalled();
  });

  test('register result is merged into enrollment cache before background refresh', () => {
    const plan = { id: 'planA', name: 'Plan A' };
    const loaded = loadCourseEnrollmentModule({
      getEduCoursePlans: jest.fn(() => [plan]),
    });
    loaded._courseEnrollCache = {};
    loaded._courseEnrollSummaryCache = {};
    loaded._getCourseEnrollCacheKey = (teamId, planId) => teamId + ':' + planId;

    const list = loaded._mergeCourseEnrollmentCacheAfterRegister(
      'teamA',
      'planA',
      [{ id: 'enrA', studentId: 'stuA', status: 'pending', appliedAt: '2099-01-01T00:00:00.000Z' }],
      [{ id: 'stuA', name: '小明', selfUid: 'viewer' }],
      { uid: 'viewer' }
    );

    expect(list).toHaveLength(1);
    expect(loaded._courseEnrollCache['teamA:planA'][0]).toMatchObject({
      id: 'enrA',
      studentId: 'stuA',
      studentName: '小明',
      status: 'pending',
    });
    expect(loaded._courseEnrollSummaryCache['teamA:planA'].viewerStatuses).toEqual({ stuA: 'pending' });
    expect(plan._enrollments).toBe(loaded._courseEnrollCache['teamA:planA']);
    expect(plan._enrollmentSummary.viewerStatuses.stuA).toBe('pending');
  });

  test('cancel result removes pending enrollment from local cache before refresh', () => {
    const plan = { id: 'planA', name: 'Plan A' };
    const loaded = loadCourseEnrollmentModule({
      getEduCoursePlans: jest.fn(() => [plan]),
    });
    loaded._getCourseEnrollCacheKey = (teamId, planId) => teamId + ':' + planId;
    const cached = [
      { id: 'enrA', studentId: 'stuA', status: 'pending' },
      { id: 'enrB', studentId: 'stuB', status: 'approved' },
    ];
    Object.defineProperty(cached, '_summary', {
      value: { viewerStatuses: { stuA: 'pending', stuB: 'approved' }, viewerStudentIds: ['stuA', 'stuB'] },
      enumerable: false,
      configurable: true,
    });
    loaded._courseEnrollCache = { 'teamA:planA': cached };
    loaded._courseEnrollSummaryCache = { 'teamA:planA': cached._summary };

    const next = loaded._mergeCourseEnrollmentCacheAfterCancel('teamA', 'planA', ['stuA']);

    expect(next).toEqual([{ id: 'enrB', studentId: 'stuB', status: 'approved' }]);
    expect(loaded._courseEnrollSummaryCache['teamA:planA'].viewerStatuses).toEqual({ stuB: 'approved' });
    expect(plan._enrollments).toBe(next);
    expect(plan._enrollmentSummary.viewerStatuses.stuA).toBeUndefined();
  });

  test('coach note editor expands below controls and keeps the trigger visible', () => {
    const input = { focus: jest.fn() };
    const panel = {
      style: { display: 'none' },
      querySelector: jest.fn(() => input),
    };
    const trigger = {
      setAttribute: jest.fn(),
      classList: { toggle: jest.fn(), remove: jest.fn() },
    };
    const documentMock = {
      getElementById: jest.fn((id) => ({ notePanel: panel, noteTrigger: trigger }[id] || null)),
    };

    const loaded = loadCourseEnrollmentModule({}, { document: documentMock });

    loaded._toggleEnrollNoteEditor('notePanel', 'noteTrigger');
    expect(panel.style.display).toBe('');
    expect(trigger.setAttribute).toHaveBeenCalledWith('aria-expanded', 'true');
    expect(trigger.classList.toggle).toHaveBeenCalledWith('is-open', true);
    expect(input.focus).toHaveBeenCalled();

    loaded._toggleEnrollNoteEditor('notePanel', 'noteTrigger');
    expect(panel.style.display).toBe('none');
    expect(trigger.setAttribute).toHaveBeenCalledWith('aria-expanded', 'false');
    expect(trigger.classList.toggle).toHaveBeenCalledWith('is-open', false);
  });

  test('coach note cancel closes editor and restores unsaved text', () => {
    const input = {
      value: 'unsaved',
      getAttribute: jest.fn(() => 'saved'),
    };
    const panel = {
      style: { display: '' },
      querySelector: jest.fn(() => input),
    };
    const trigger = {
      setAttribute: jest.fn(),
      classList: { remove: jest.fn() },
    };
    const documentMock = {
      getElementById: jest.fn((id) => ({ notePanel: panel, noteTrigger: trigger }[id] || null)),
    };

    const loaded = loadCourseEnrollmentModule({}, { document: documentMock });

    loaded._cancelEnrollNotes('notePanel', 'noteTrigger');

    expect(input.value).toBe('saved');
    expect(panel.style.display).toBe('none');
    expect(trigger.setAttribute).toHaveBeenCalledWith('aria-expanded', 'false');
    expect(trigger.classList.remove).toHaveBeenCalledWith('is-open');
  });

  test('detects enrolled student (pending)', () => {
    expect(isCourseEnrolled([{ studentId: 's1', status: 'pending' }], 's1')).toBe(true);
  });

  test('detects enrolled student (approved)', () => {
    expect(isCourseEnrolled([{ studentId: 's1', status: 'approved' }], 's1')).toBe(true);
  });

  test('rejected enrollment does NOT block re-enrollment', () => {
    expect(isCourseEnrolled([{ studentId: 's1', status: 'rejected' }], 's1')).toBe(false);
  });

  test('cancelled enrollment does NOT block re-enrollment', () => {
    expect(isCourseEnrolled([{ studentId: 's1', status: 'cancelled' }], 's1')).toBe(false);
  });

  test('different student not detected', () => {
    expect(isCourseEnrolled([{ studentId: 's2', status: 'approved' }], 's1')).toBe(false);
  });

  test('empty enrollments returns false', () => {
    expect(isCourseEnrolled([], 's1')).toBe(false);
  });

  test('approval activates pending student', () => {
    const r = approveEnrollment({ id: 'e1', status: 'pending' }, 'pending');
    expect(r.enrollmentStatus).toBe('approved');
    expect(r.studentEnrollStatus).toBe('active');
    expect(r.countDelta).toBe(1);
  });

  test('approval keeps already-active student as active', () => {
    expect(approveEnrollment({ id: 'e1' }, 'active').studentEnrollStatus).toBe('active');
  });

  test('rejection sets status to rejected', () => {
    expect(rejectEnrollment({ id: 'e1' }).enrollmentStatus).toBe('rejected');
  });

  test('null enrollment returns error', () => {
    expect(approveEnrollment(null, 'pending').error).toBe('enrollment_not_found');
    expect(rejectEnrollment(null).error).toBe('enrollment_not_found');
  });
});
