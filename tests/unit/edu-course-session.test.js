const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-session.js'),
  'utf8'
);

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadCourseSessionContext(overrides = {}) {
  const container = { innerHTML: '' };
  const plan = {
    id: 'planA',
    name: 'Plan A',
    startDate: '2099-06-01',
    endDate: '2099-06-30',
  };
  const app = {
    _eduCourseEnrollmentRequestSeq: 7,
    getEduCoursePlans: jest.fn(() => [plan]),
    getEduStudents: jest.fn(() => []),
    isEduClubStaff: jest.fn(() => false),
    _loadCourseEnrollments: jest.fn(async () => []),
    _bindCourseSessionStudentAvatarFallbacks: jest.fn(),
    ...(overrides.app || {}),
  };
  const firebase = {
    listCourseSessions: jest.fn(async () => overrides.sessions || []),
    queryEduAttendance: jest.fn(async () => overrides.attendance || []),
    ...(overrides.FirebaseService || {}),
  };
  const context = {
    App: app,
    FirebaseService: firebase,
    document: {
      getElementById: jest.fn((id) => (id === 'edu-ce-list' ? container : null)),
    },
    escapeHTML,
    console,
    Date,
    Math,
    Number,
    Object,
    String,
    Array,
    Set,
    Map,
    Promise,
  };
  vm.runInNewContext(source, context, { filename: 'edu-course-session.js' });
  return { app: context.App, firebase, container };
}

describe('edu course session loading', () => {
  test('course session loader reuses the same pending request for a plan', async () => {
    let resolveLoad;
    const pending = new Promise(resolve => { resolveLoad = resolve; });
    const listCourseSessions = jest.fn(() => pending);
    const { app } = loadCourseSessionContext({
      FirebaseService: { listCourseSessions },
    });

    const first = app._loadCourseSessions('teamA', 'planA');
    const second = app._loadCourseSessions('teamA', 'planA');

    expect(listCourseSessions).toHaveBeenCalledTimes(1);
    resolveLoad([
      { id: 'late', date: '2099-06-03', startTime: '10:00' },
      { id: 'early', date: '2099-06-01', startTime: '10:00' },
    ]);

    await expect(first).resolves.toEqual([
      { id: 'early', date: '2099-06-01', startTime: '10:00' },
      { id: 'late', date: '2099-06-03', startTime: '10:00' },
    ]);
    await expect(second).resolves.toEqual([
      { id: 'early', date: '2099-06-01', startTime: '10:00' },
      { id: 'late', date: '2099-06-03', startTime: '10:00' },
    ]);
    expect(app._courseSessionLoadPromises['teamA:planA']).toBeUndefined();
  });

  test('older session load does not clear a newer pending load after mutation', async () => {
    const resolvers = [];
    const listCourseSessions = jest.fn(() => new Promise(resolve => { resolvers.push(resolve); }));
    const { app } = loadCourseSessionContext({
      FirebaseService: { listCourseSessions },
    });

    const first = app._loadCourseSessions('teamA', 'planA');
    app._markCourseSessionCacheMutated('teamA', 'planA');
    const second = app._loadCourseSessions('teamA', 'planA');

    expect(listCourseSessions).toHaveBeenCalledTimes(2);
    resolvers[0]([{ id: 'old', date: '2099-06-01', startTime: '10:00' }]);
    await first;

    const third = app._loadCourseSessions('teamA', 'planA');
    expect(listCourseSessions).toHaveBeenCalledTimes(2);

    resolvers[1]([{ id: 'new', date: '2099-06-02', startTime: '10:00' }]);
    await expect(second).resolves.toEqual([{ id: 'new', date: '2099-06-02', startTime: '10:00' }]);
    await expect(third).resolves.toEqual([{ id: 'new', date: '2099-06-02', startTime: '10:00' }]);
  });

  test('session board starts enrollments, sessions, and attendance in parallel', async () => {
    const { app, firebase, container } = loadCourseSessionContext();
    let resolveEnrollments;
    let resolveSessions;
    let resolveAttendance;
    const enrollmentsPromise = new Promise(resolve => { resolveEnrollments = resolve; });
    const sessionsPromise = new Promise(resolve => { resolveSessions = resolve; });
    const attendancePromise = new Promise(resolve => { resolveAttendance = resolve; });
    app._loadCourseEnrollments = jest.fn(() => enrollmentsPromise);
    app._loadCourseSessions = jest.fn(() => sessionsPromise);
    firebase.queryEduAttendance = jest.fn(() => attendancePromise);

    const renderPromise = app._renderCourseSessionBoard('teamA', 'planA', 7);
    await Promise.resolve();

    expect(app._loadCourseEnrollments).toHaveBeenCalledWith('teamA', 'planA');
    expect(app._loadCourseSessions).toHaveBeenCalledWith('teamA', 'planA');
    expect(firebase.queryEduAttendance).toHaveBeenCalledWith({ teamId: 'teamA', coursePlanId: 'planA' });

    resolveEnrollments([]);
    resolveSessions([{ id: 'sessionA', date: '2099-06-02', startTime: '10:00', endTime: '11:00' }]);
    resolveAttendance([{ studentId: 'stuA', kind: 'signin' }]);
    await renderPromise;

    expect(container.innerHTML).toContain('edu-session-board');
    expect(app._courseAttendanceCount).toEqual({ stuA: 1 });
  });
});
