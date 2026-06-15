const fs = require('fs');
const path = require('path');
const vm = require('vm');

const renderSource = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-lessons-render.js'),
  'utf8'
);
const controllerSource = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-lessons.js'),
  'utf8'
);
const cssSource = fs.readFileSync(
  path.join(__dirname, '../../css/education.css'),
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

function loadCourseLessonsContext(overrides = {}) {
  const container = { innerHTML: '' };
  const title = { textContent: '' };
  const plans = overrides.plans || [{
    id: 'planA',
    name: '暑期堂數班',
    planType: 'session',
    startDate: '2099-06-01',
    endDate: '2099-08-31',
  }];
  const sessions = overrides.sessions || [{
    id: 'sessionA',
    title: '第一堂',
    date: '2099-06-02',
    startTime: '10:00',
    endTime: '11:30',
    location: '球場 A',
    studentIds: ['stu1', 'stu2'],
    capacity: 6,
  }];
  const app = {
    currentPage: 'page-team-detail',
    _eduCourseLessonsRequestSeq: 0,
    _courseSessionCache: overrides.courseSessionCache || {},
    showPage: jest.fn(async () => { app.currentPage = 'page-edu-course-lessons'; }),
    _loadEduCoursePlans: jest.fn(async () => plans),
    getEduCoursePlans: jest.fn(() => plans),
    _loadCourseSessions: overrides.loadCourseSessions || jest.fn(async () => sessions),
    isEduClubStaff: jest.fn(() => overrides.isStaff === true),
    _loadCourseEnrollments: overrides.loadCourseEnrollments || jest.fn(async () => overrides.enrollments || []),
    _loadCourseEnrollmentSummaries: jest.fn(async () => overrides.summaries || null),
    _ensureCoursePlanSessionsFromPlan: overrides.ensureCoursePlanSessionsFromPlan,
    _getCourseSessionSortValue: overrides.getCourseSessionSortValue || ((session) => {
      const ms = new Date(`${session?.date || ''}T${session?.startTime || '00:00'}`).getTime();
      return Number.isFinite(ms) ? ms : 0;
    }),
    _formatCourseSessionDate: (session) => session.date,
    _formatCourseSessionTime: (session) => [session.startTime, session.endTime].filter(Boolean).join(' - '),
    _getCourseSessionStatusMeta: overrides.getCourseSessionStatusMeta || (() => ({ label: '已排課', cls: 'scheduled' })),
    _renderCourseSessionStudentAvatar: (_student, name) => '<span class="avatar">' + escapeHTML(name) + '</span>',
    _bindCourseSessionStudentAvatarFallbacks: jest.fn(),
    _withButtonLoading: jest.fn((_button, _text, fn) => fn()),
    showToast: jest.fn(),
  };
  const context = {
    App: app,
    FirebaseService: {
      listEduCoursePublicRoster: jest.fn(async () => overrides.rosterPayload || {
        rosterPublic: true,
        session: {
          id: 'sessionA',
          title: '第一堂',
          date: '2099-06-02',
          startTime: '10:00',
          endTime: '11:30',
          status: 'scheduled',
          notes: '帶水壺',
        },
        students: [
          { studentId: 'stu1', displayName: '小明', level: '3', attendanceKind: 'signin' },
          { studentId: 'stu2', displayName: '小華', level: null, attendanceKind: null },
        ],
      }),
      saveEduSessionAttendanceChanges: jest.fn(async () => ({ changed: 1 })),
      saveEduCourseSelfLeave: jest.fn(async () => ({ changed: 1 })),
      updateCourseSession: jest.fn(async () => ({ ok: true })),
      queryEduAttendance: jest.fn(async () => overrides.attendanceRecords || []),
    },
    document: {
      getElementById: jest.fn((id) => {
        if (overrides.elements && overrides.elements[id]) return overrides.elements[id];
        if (id === 'edu-course-lessons-page') return container;
        if (id === 'edu-course-lessons-title') return title;
        if (id === 'edu-course-roster-notes-input') return overrides.notesInput || null;
        if (id === '_eduSelfLeaveConfirmBtn') return overrides.selfLeaveConfirmBtn || null;
        return null;
      }),
      querySelector: jest.fn((selector) => (
        typeof overrides.querySelector === 'function' ? overrides.querySelector(selector) : null
      )),
      createElement: jest.fn(() => (
        typeof overrides.createElement === 'function'
          ? overrides.createElement()
          : overrides.selfLeaveOverlay || { className: '', innerHTML: '', onclick: null, remove: jest.fn(), querySelectorAll: jest.fn(() => []) }
      )),
      body: { appendChild: jest.fn(overrides.onAppendChild || (() => {})) },
    },
    escapeHTML,
    console,
    Promise,
    Date,
    String,
    Number,
    Object,
    parseInt,
    localStorage: { getItem: jest.fn(() => null) },
  };
  vm.runInNewContext(renderSource, context, { filename: 'edu-course-lessons-render.js' });
  vm.runInNewContext(controllerSource, context, { filename: 'edu-course-lessons.js' });
  return { app: context.App, firebase: context.FirebaseService, container, title };
}

describe('edu course lessons', () => {
  test('renders session lesson cards from existing sessions', async () => {
    const { app, container, title } = loadCourseLessonsContext();

    await app.showCourseLessons('teamA', 'planA');

    expect(app.showPage).toHaveBeenCalledWith('page-edu-course-lessons');
    expect(title.textContent).toBe('課堂列表');
    expect(container.innerHTML).toContain('暑期堂數班');
    expect(container.innerHTML).toContain('<div class="edu-course-lesson-index"><strong>1</strong></div>');
    expect(container.innerHTML).not.toContain('第</span><strong>1</strong><span>堂');
    expect(container.innerHTML).toContain('第一堂');
    expect(container.innerHTML).toContain('edu-course-lesson-meta-time');
    expect(container.innerHTML).toContain('edu-course-lesson-meta-location');
    expect(container.innerHTML).toContain('edu-course-lesson-meta-count');
    expect(container.innerHTML).toContain('2/6 人');
    expect(container.innerHTML).toContain("App.showCourseLessonRoster('teamA','planA','sessionA')");
  });

  test('lesson quick adjust edit button is visible only to club staff', async () => {
    const staff = loadCourseLessonsContext({ isStaff: true });
    await staff.app.showCourseLessons('teamA', 'planA');

    expect(staff.container.innerHTML).toContain('edu-course-lesson-adjust-btn');
    expect(staff.container.innerHTML).toContain('App.openCourseLessonQuickAdjust');
    expect(staff.container.innerHTML).toContain('<svg viewBox="0 0 24 24"');

    const viewer = loadCourseLessonsContext({ isStaff: false });
    await viewer.app.showCourseLessons('teamA', 'planA');

    expect(viewer.container.innerHTML).not.toContain('edu-course-lesson-adjust-btn');
    expect(viewer.container.innerHTML).not.toContain('App.openCourseLessonQuickAdjust');
  });

  test('quick adjust shows shared loading animation before lesson data resolves', async () => {
    let resolveSessions;
    const sessionsPromise = new Promise(resolve => { resolveSessions = resolve; });
    const overlay = {
      className: '',
      innerHTML: '',
      onclick: null,
      isConnected: true,
      remove: jest.fn(),
      setAttribute: jest.fn(),
      removeAttribute: jest.fn(),
    };
    const appendSpy = jest.fn();
    const { app } = loadCourseLessonsContext({
      isStaff: true,
      loadCourseSessions: jest.fn(() => sessionsPromise),
      createElement: () => overlay,
      onAppendChild: appendSpy,
    });

    const opening = app.openCourseLessonQuickAdjust('teamA', 'planA', 'sessionA');

    expect(appendSpy).toHaveBeenCalledWith(overlay);
    expect(overlay.setAttribute).toHaveBeenCalledWith('aria-busy', 'true');
    expect(overlay.innerHTML).toContain('edu-course-lesson-adjust-loading-dialog');
    expect(overlay.innerHTML).toContain('edu-loading');

    resolveSessions([{
      id: 'sessionA',
      title: 'Session A',
      date: '2099-06-02',
      startTime: '10:00',
      endTime: '11:30',
      location: 'Court A',
      studentIds: ['stu1', 'stu2'],
      capacity: 6,
    }]);
    await opening;

    expect(overlay.removeAttribute).toHaveBeenCalledWith('aria-busy');
    expect(overlay.innerHTML).toContain('edu-course-lesson-adjust-grid');
  });

  test('quick adjust does not reopen when loading overlay is dismissed', async () => {
    let resolveSessions;
    const sessionsPromise = new Promise(resolve => { resolveSessions = resolve; });
    const overlay = {
      className: '',
      innerHTML: '',
      onclick: null,
      isConnected: false,
      remove: jest.fn(),
      setAttribute: jest.fn(),
      removeAttribute: jest.fn(),
    };
    const { app } = loadCourseLessonsContext({
      isStaff: true,
      loadCourseSessions: jest.fn(() => sessionsPromise),
      createElement: () => overlay,
    });

    const opening = app.openCourseLessonQuickAdjust('teamA', 'planA', 'sessionA');
    overlay.onclick({ target: overlay });

    resolveSessions([{ id: 'sessionA', date: '2099-06-02', startTime: '10:00', endTime: '11:30' }]);
    await opening;

    expect(overlay.remove).toHaveBeenCalled();
    expect(overlay.removeAttribute).not.toHaveBeenCalledWith('aria-busy');
    expect(overlay.innerHTML).not.toContain('edu-course-lesson-adjust-grid');
  });

  test('lesson card meta keeps location and count on one compact row with ellipsis support', () => {
    expect(cssSource).toContain('grid-template-columns: minmax(0, 1fr) max-content;');
    expect(cssSource).toContain('.edu-course-lesson-meta-time');
    expect(cssSource).toContain('grid-column: 1 / -1;');
    expect(cssSource).toContain('.edu-course-lesson-meta-time.has-adjust');
    expect(cssSource).toContain('.edu-course-lesson-adjust-btn svg');
    expect(cssSource).toContain('.edu-course-lesson-adjust-loading-dialog');
    expect(cssSource).toContain('.edu-course-lesson-meta-location');
    expect(cssSource).toContain('text-overflow: ellipsis;');
    expect(cssSource).toContain('.edu-course-lesson-meta-count');
    expect(cssSource).toContain('width: max-content;');
  });

  test('roster cards keep student names and notes on one compact row', () => {
    expect(cssSource).toMatch(/\.edu-course-roster-card\s*\{[^}]*min-height: 48px;[^}]*padding: \.36rem \.48rem;/s);
    expect(cssSource).toMatch(/\.edu-course-roster-name-line\s*\{[^}]*flex-wrap: nowrap;/s);
    expect(cssSource).toMatch(/\.edu-course-member-pill\.td-member-name-pill\s*\{[^}]*max-width: min\(6\.5em, 50%\);/s);
    expect(cssSource).toMatch(/\.edu-course-roster-note\s*\{[^}]*flex: 1 1 auto;/s);
    expect(cssSource).toContain('.edu-course-roster-section-unpaid');
    expect(cssSource).toContain('.edu-course-roster-payment-unpaid');
  });

  test('preloads course lesson sessions without duplicate pending requests', async () => {
    let resolveLoad;
    const pending = new Promise(resolve => { resolveLoad = resolve; });
    const loadCourseSessions = jest.fn(() => pending);
    const { app } = loadCourseLessonsContext({ loadCourseSessions });

    app._preloadCourseLessonsForPlans('teamA', [{ id: 'planA' }, { id: 'planB' }]);
    app._preloadCourseLessonsForPlans('teamA', [{ id: 'planA' }]);

    expect(loadCourseSessions).toHaveBeenCalledTimes(2);
    expect(loadCourseSessions).toHaveBeenCalledWith('teamA', 'planA');
    expect(loadCourseSessions).toHaveBeenCalledWith('teamA', 'planB');
    resolveLoad([]);
    await pending;
  });

  test('showCourseLessons paints cached sessions before slow refresh completes', async () => {
    let resolveSessions;
    const slowSessions = new Promise(resolve => { resolveSessions = resolve; });
    const { app, container } = loadCourseLessonsContext({
      courseSessionCache: {
        'teamA:planA': [{
          id: 'cachedA',
          title: 'Cached Lesson',
          date: '2099-06-01',
          startTime: '10:00',
          endTime: '11:30',
          location: 'A',
          studentIds: ['stu1'],
          capacity: 6,
        }],
      },
      loadCourseSessions: jest.fn(() => slowSessions),
    });

    const renderPromise = app.showCourseLessons('teamA', 'planA');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(container.innerHTML).toContain('Cached Lesson');
    expect(container.innerHTML).toContain('cachedA');

    resolveSessions([{
      id: 'freshA',
      title: 'Fresh Lesson',
      date: '2099-06-02',
      startTime: '10:00',
      endTime: '11:30',
      location: 'A',
      studentIds: ['stu1', 'stu2'],
      capacity: 6,
    }]);
    await renderPromise;

    expect(container.innerHTML).toContain('Fresh Lesson');
    expect(container.innerHTML).not.toContain('Cached Lesson');
  });

  test('lesson cards freeze done counts and use current enrollment count before completion', async () => {
    const { app, container } = loadCourseLessonsContext({
      sessions: [
        {
          id: 'doneA',
          title: 'Done Lesson',
          status: 'done',
          date: '2099-06-01',
          startTime: '10:00',
          endTime: '11:30',
          location: 'A',
          studentIds: ['stu1', 'stu2'],
          capacity: 6,
        },
        {
          id: 'scheduledA',
          title: 'Future Lesson',
          status: 'scheduled',
          date: '2099-06-08',
          startTime: '10:00',
          endTime: '11:30',
          location: 'A',
          studentIds: ['stu1'],
          capacity: 6,
        },
      ],
      summaries: {
        planA: { effectiveApprovedCount: 4 },
      },
      getCourseSessionStatusMeta: (session) => session.status === 'done'
        ? { label: '已完成', cls: 'done' }
        : { label: '已排課', cls: 'scheduled' },
    });

    await app.showCourseLessons('teamA', 'planA');

    expect(app._loadCourseEnrollmentSummaries).toHaveBeenCalledWith('teamA', ['planA']);
    expect(container.innerHTML).toContain('Done Lesson');
    expect(container.innerHTML).toContain('Future Lesson');
    expect(container.innerHTML).toContain('2/6 人');
    expect(container.innerHTML).toContain('4/6 人');
  });

  test('lesson list hero renders course cover as a clipped right-side visual', async () => {
    const { app, container } = loadCourseLessonsContext({
      plans: [{
        id: 'planA',
        name: 'Cover Plan',
        planType: 'session',
        startDate: '2099-06-01',
        endDate: '2099-08-31',
        coverImage: 'https://cdn.example/course-cover.webp',
      }],
    });

    await app.showCourseLessons('teamA', 'planA');

    expect(container.innerHTML).toContain('edu-course-lessons-hero has-cover');
    expect(container.innerHTML).toContain("--edu-course-lessons-cover:url('https://cdn.example/course-cover.webp')");
    expect(container.innerHTML).toContain('edu-course-lessons-hero-copy');
  });

  test('done lesson cards are visually greyed and covered', () => {
    expect(cssSource).toContain('.edu-course-lesson-card-done::after');
    expect(cssSource).toContain('content: "\\5DF2\\7D50\\675F"');
    expect(cssSource).toContain('filter: grayscale(1)');
  });

  test('renders weekly lesson cards from course sessions', async () => {
    const { app, container } = loadCourseLessonsContext({
      plans: [{
        id: 'weeklyPlan',
        name: '固定週期班',
        planType: 'weekly',
        weekdays: [1, 3],
        timeSlot: '09:00-10:30',
        startDate: '2099-06-01',
        endDate: '2099-06-30',
      }],
      sessions: [{
        id: 'weeklyA',
        title: '第 1 堂課',
        date: '2099-06-01',
        startTime: '09:00',
        endTime: '10:30',
        location: '球場 B',
        studentIds: ['stu1'],
        capacity: 6,
      }],
    });

    await app.showCourseLessons('teamA', 'weeklyPlan');

    expect(container.innerHTML).toContain('固定週期課程');
    expect(container.innerHTML).toContain('固定週期班');
    expect(container.innerHTML).toContain('第 1 堂課');
    expect(container.innerHTML).toContain("App.showCourseLessonRoster('teamA','weeklyPlan','weeklyA')");
    expect(container.innerHTML).not.toContain('固定週期課程維持方案層級顯示');
  });

  test('staff lesson list uses auto session sync result', async () => {
    const ensureCoursePlanSessionsFromPlan = jest.fn(async () => ({
      created: 2,
      sessions: [{
        id: 'auto_session_1',
        title: '第 1 堂課',
        date: '2099-06-01',
        startTime: '19:00',
        endTime: '20:30',
        studentIds: [],
      }],
    }));
    const { app, container } = loadCourseLessonsContext({
      isStaff: true,
      sessions: [],
      ensureCoursePlanSessionsFromPlan,
    });

    await app.showCourseLessons('teamA', 'planA');

    expect(ensureCoursePlanSessionsFromPlan).toHaveBeenCalledWith('teamA', expect.objectContaining({ id: 'planA' }));
    expect(container.innerHTML).toContain('auto_session_1');
    expect(container.innerHTML).toContain('第 1 堂課');
  });

  test('renders public roster without staff notes', async () => {
    const { app, container, title, firebase } = loadCourseLessonsContext();

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledWith('teamA', 'planA', 'sessionA');
    expect(title.textContent).toBe('課堂名單');
    expect(container.innerHTML).toContain('小明');
    expect(container.innerHTML).toContain('td-member-name-pill');
    expect(container.innerHTML).toContain('edu-course-member-pill');
    expect(container.innerHTML).toContain("App.showUserProfile('小明')");
    expect(container.innerHTML).toContain('edu-course-roster-side');
    expect(container.innerHTML).not.toContain('edu-course-roster-level-pill');
    expect(container.innerHTML).not.toContain('Lv 3');
    expect(container.innerHTML).toContain('已簽到');
    expect(container.innerHTML).not.toContain('尚未填寫備註');
    expect(container.innerHTML).not.toContain('未繳費區');
  });

  test('staff roster separates unpaid students from paid lesson roster', async () => {
    const { app, container } = loadCourseLessonsContext({
      isStaff: true,
      enrollments: [
        { id: 'enr1', studentId: 'stu1', status: 'approved', paidAt: '2099-06-01', coachNotes: '' },
        { id: 'enr2', studentId: 'stu2', status: 'approved', paidAt: null, coachNotes: '' },
      ],
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    const html = container.innerHTML;
    expect(app._loadCourseEnrollments).toHaveBeenCalledWith('teamA', 'planA');
    expect(html).toContain('本堂名單');
    expect(html).toContain('未繳費區');
    expect(html).toContain('edu-course-roster-section-unpaid');
    expect(html).toContain('edu-course-roster-card-unpaid');
    expect(html).toContain('edu-course-roster-payment-unpaid">未繳費</span>');
    expect(html.indexOf('小明')).toBeLessThan(html.indexOf('未繳費區'));
    expect(html.indexOf('小華')).toBeGreaterThan(html.indexOf('未繳費區'));
  });

  test('staff roster matches payment data when roster students use id fields', async () => {
    const { app, container, firebase } = loadCourseLessonsContext({
      isStaff: true,
      rosterPayload: {
        rosterPublic: true,
        session: {
          id: 'sessionA',
          title: 'Session A',
          date: '2099-06-02',
          startTime: '10:00',
          endTime: '11:30',
          status: 'scheduled',
        },
        students: [
          { id: 'stu1', displayName: 'Paid Id Student', attendanceKind: 'signin' },
          { _docId: 'stu2', displayName: 'Unpaid Doc Student', attendanceKind: null },
        ],
      },
      enrollments: [
        { id: 'enr1', studentId: 'stu1', status: 'approved', paidAt: '2099-06-01', coachNotes: 'paid note' },
        { id: 'enr2', studentId: 'stu2', status: 'approved', paidAt: null, coachNotes: 'unpaid note' },
      ],
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    const html = container.innerHTML;
    expect(html).toContain('未繳費區');
    expect(html.indexOf('Paid Id Student')).toBeLessThan(html.indexOf('未繳費區'));
    expect(html.indexOf('Unpaid Doc Student')).toBeGreaterThan(html.indexOf('未繳費區'));
    expect(html).toContain("App.editCourseSessionRosterNote('teamA','planA','stu2','enr2')");

    app.startCourseLessonRosterManage();
    app.setCourseLessonRosterDraft('stu2', 'leave');
    await app.saveCourseLessonRosterManage({ dataset: {}, disabled: false, style: {}, isConnected: true });

    expect(firebase.saveEduSessionAttendanceChanges).toHaveBeenCalledWith({
      teamId: 'teamA',
      planId: 'planA',
      sessionId: 'sessionA',
      date: '2099-06-02',
      changes: [{
        studentId: 'stu2',
        studentName: 'Unpaid Doc Student',
        parentUid: null,
        selfUid: null,
        kind: 'leave',
      }],
    });
  });

  test('per-session billing roster disables payment split without plan attendance stats', async () => {
    const { app, container, firebase } = loadCourseLessonsContext({
      isStaff: true,
      plans: [{
        id: 'planA',
        name: 'Per Session Course',
        planType: 'session',
        perSessionBilling: true,
      }],
      sessions: [
        { id: 's0', title: 'Lesson 0', status: 'done', date: '2026-05-01', startTime: '10:00', studentIds: ['stu1', 'stu2'] },
        { id: 's1', title: 'Lesson 1', status: 'done', date: '2026-05-08', startTime: '10:00', studentIds: ['stu1', 'stu2'] },
        { id: 'sessionA', title: 'Lesson 2', status: 'done', date: '2026-05-15', startTime: '10:00', studentIds: ['stu1', 'stu2'] },
      ],
      rosterPayload: {
        rosterPublic: true,
        session: {
          id: 'sessionA',
          title: 'Lesson 2',
          date: '2026-05-15',
          startTime: '10:00',
          endTime: '11:30',
          status: 'done',
        },
        students: [
          { studentId: 'stu1', displayName: 'Student A', attendanceKind: 'signin' },
          { studentId: 'stu2', displayName: 'Student B', attendanceKind: null },
        ],
      },
      enrollments: [
        { id: 'enr1', studentId: 'stu1', status: 'approved', paidAt: null, reviewedAt: '2026-04-20', coachNotes: '' },
        { id: 'enr2', studentId: 'stu2', status: 'approved', paidAt: null, reviewedAt: '2026-05-08', coachNotes: '' },
      ],
      attendanceRecords: [
        { studentId: 'stu1', sessionId: 's0', date: '2026-05-01', kind: 'signin', status: 'active' },
        { studentId: 'stu1', sessionId: 's1', date: '2026-05-08', kind: 'signin', status: 'active' },
        { studentId: 'stu2', sessionId: 's1', date: '2026-05-08', kind: 'signin', status: 'active' },
        { studentId: 'stu2', sessionId: 'sessionA', date: '2026-05-15', kind: 'leave', status: 'active' },
      ],
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    const html = container.innerHTML;
    expect(firebase.queryEduAttendance).not.toHaveBeenCalled();
    expect(html).not.toContain('未繳費區');
    expect(html).not.toContain('edu-course-roster-payment-unpaid');
    expect(html).not.toContain('簽到 2/3 · 出席率 67%');
    expect(html).not.toContain('簽到 1/2 · 出席率 50%');
  });

  test('weekly roster keeps payment split without plan attendance stats', async () => {
    const { app, container, firebase } = loadCourseLessonsContext({
      isStaff: true,
      plans: [{
        id: 'planA',
        name: 'Weekly Course',
        planType: 'weekly',
      }],
      sessions: [
        { id: 's0', status: 'done', date: '2026-05-01', startTime: '10:00', studentIds: ['stu1', 'stu2'] },
        { id: 'sessionA', status: 'done', date: '2026-05-08', startTime: '10:00', studentIds: ['stu1', 'stu2'] },
      ],
      rosterPayload: {
        rosterPublic: true,
        session: {
          id: 'sessionA',
          title: 'Weekly Lesson',
          date: '2026-05-08',
          startTime: '10:00',
          endTime: '11:30',
          status: 'done',
        },
        students: [
          { studentId: 'stu1', displayName: 'Paid Weekly', attendanceKind: 'signin' },
          { studentId: 'stu2', displayName: 'Unpaid Weekly', attendanceKind: null },
        ],
      },
      enrollments: [
        { id: 'enr1', studentId: 'stu1', status: 'approved', paidAt: '2026-05-01', reviewedAt: '2026-04-20', coachNotes: '' },
        { id: 'enr2', studentId: 'stu2', status: 'approved', paidAt: null, reviewedAt: '2026-04-20', coachNotes: '' },
      ],
      attendanceRecords: [
        { studentId: 'stu1', sessionId: 's0', date: '2026-05-01', kind: 'signin', status: 'active' },
        { studentId: 'stu1', sessionId: 'sessionA', date: '2026-05-08', kind: 'signin', status: 'active' },
      ],
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    const html = container.innerHTML;
    expect(html).toContain('未繳費區');
    expect(html).toContain('edu-course-roster-payment-unpaid">未繳費</span>');
    expect(firebase.queryEduAttendance).not.toHaveBeenCalled();
    expect(html).not.toContain('簽到 2/2 · 出席率 100%');
    expect(html).not.toContain('簽到 0/2 · 出席率 0%');
  });

  test('staff roster keeps the normal list when payment data cannot load', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, container } = loadCourseLessonsContext({
      isStaff: true,
      loadCourseEnrollments: jest.fn(async () => { throw new Error('load failed'); }),
    });

    try {
      await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    } finally {
      warnSpy.mockRestore();
    }

    expect(container.innerHTML).toContain('小明');
    expect(container.innerHTML).toContain('小華');
    expect(container.innerHTML).not.toContain('未繳費區');
    expect(container.innerHTML).not.toContain('edu-course-roster-card-unpaid');
  });

  test('shows closed roster state for non-staff when rosterPublic is false', async () => {
    const { app, container } = loadCourseLessonsContext({
      rosterPayload: {
        rosterPublic: false,
        session: { id: 'sessionA', title: '第一堂' },
        students: [],
      },
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    expect(container.innerHTML).toContain('名單未公開');
  });

  test('staff can draft and save lesson attendance changes', async () => {
    const { app, container, firebase } = loadCourseLessonsContext({ isStaff: true });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    expect(container.innerHTML).toContain('管理名單');

    app.startCourseLessonRosterManage();
    expect(container.innerHTML).toContain('edu-roster-cb-signin');
    expect(container.innerHTML).toContain('edu-roster-cb-leave');

    app.setCourseLessonRosterDraft('stu2', 'leave');
    expect(app._eduCourseLessonsContext.draftByStudentId.stu2).toBe('leave');

    await app.saveCourseLessonRosterManage({ dataset: {}, disabled: false, style: {}, isConnected: true });

    expect(firebase.saveEduSessionAttendanceChanges).toHaveBeenCalledWith({
      teamId: 'teamA',
      planId: 'planA',
      sessionId: 'sessionA',
      date: '2099-06-02',
      changes: [{
        studentId: 'stu2',
        studentName: '小華',
        parentUid: null,
        selfUid: null,
        kind: 'leave',
      }],
    });
    expect(app.showToast).toHaveBeenCalledWith('名單已更新');
  });

  test('staff can edit course lesson notes from roster', async () => {
    const notesInput = { value: '新的課堂備註' };
    const { app, container, firebase } = loadCourseLessonsContext({ isStaff: true, notesInput });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    expect(container.innerHTML).toContain('課堂備註');
    expect(container.innerHTML).toMatch(/edu-course-roster-name-line[\s\S]*edu-course-member-pill[\s\S]*edu-course-roster-note/);
    expect(container.innerHTML).toContain('App.startCourseLessonNotesEdit()');

    app.startCourseLessonNotesEdit();
    expect(container.innerHTML).toContain('edu-course-roster-notes-input');

    await app.saveCourseLessonNotes({ dataset: {}, disabled: false, style: {}, isConnected: true });

    expect(firebase.updateCourseSession).toHaveBeenCalledWith('teamA', 'planA', 'sessionA', { notes: '新的課堂備註' });
    expect(app.showToast).toHaveBeenCalledWith('課堂備註已更新');
  });

  test('quick adjust blocks a lesson time that exceeds the next lesson', async () => {
    const sessions = [
      {
        id: 'sessionA',
        title: 'Session A',
        date: '2099-06-02',
        startTime: '10:00',
        endTime: '11:00',
        location: 'Court A',
        studentIds: ['stu1', 'stu2'],
        capacity: 6,
      },
      {
        id: 'sessionB',
        title: 'Session B',
        date: '2099-06-02',
        startTime: '12:00',
        endTime: '13:00',
        location: 'Court A',
        studentIds: ['stu1', 'stu2'],
        capacity: 6,
      },
    ];
    const elements = {
      'edu-lesson-adjust-date': { value: '2099-06-02' },
      'edu-lesson-adjust-start': { value: '11:30' },
      'edu-lesson-adjust-end': { value: '12:30' },
      'edu-lesson-adjust-location': { value: 'Court B' },
      'edu-lesson-adjust-capacity': { value: '6' },
      'edu-lesson-adjust-cancelled': { checked: false },
    };
    const { app, firebase } = loadCourseLessonsContext({ isStaff: true, sessions, elements });
    app._eduCourseLessonAdjustContext = {
      teamId: 'teamA',
      planId: 'planA',
      sessionId: 'sessionA',
      session: sessions[0],
      sessions,
      studentCount: 2,
      nextStartMs: app._getCourseLessonDateTimeValue('2099-06-02', '12:00'),
      nextLabel: '2099-06-02 12:00',
    };

    await app.saveCourseLessonQuickAdjust({ dataset: {}, disabled: false, style: {}, isConnected: true });

    expect(firebase.updateCourseSession).not.toHaveBeenCalled();
    expect(app.showToast).toHaveBeenCalledWith(expect.stringContaining('下一堂課'));
  });

  test('quick adjust saves date location capacity and cancelled status', async () => {
    const overlay = { remove: jest.fn() };
    const sessions = [
      {
        id: 'sessionA',
        title: 'Session A',
        status: 'scheduled',
        date: '2099-06-02',
        startTime: '10:00',
        endTime: '11:00',
        location: 'Court A',
        studentIds: ['stu1', 'stu2'],
        capacity: 6,
      },
    ];
    const elements = {
      'edu-lesson-adjust-date': { value: '2099-06-03' },
      'edu-lesson-adjust-start': { value: '09:00' },
      'edu-lesson-adjust-end': { value: '10:30' },
      'edu-lesson-adjust-location': { value: 'Court C' },
      'edu-lesson-adjust-capacity': { value: '5' },
      'edu-lesson-adjust-cancelled': { checked: true },
    };
    const { app, firebase } = loadCourseLessonsContext({
      isStaff: true,
      sessions,
      elements,
      querySelector: selector => selector === '.edu-course-lesson-adjust-overlay' ? overlay : null,
    });
    app._refreshCourseLessonsAfterSessionSave = jest.fn(async () => true);
    app._eduCourseLessonAdjustContext = {
      teamId: 'teamA',
      planId: 'planA',
      sessionId: 'sessionA',
      session: sessions[0],
      sessions,
      studentCount: 2,
      nextStartMs: null,
      nextLabel: '',
    };

    await app.saveCourseLessonQuickAdjust({ dataset: {}, disabled: false, style: {}, isConnected: true });

    expect(firebase.updateCourseSession).toHaveBeenCalledWith('teamA', 'planA', 'sessionA', {
      date: '2099-06-03',
      startTime: '09:00',
      endTime: '10:30',
      location: 'Court C',
      capacity: 5,
      status: 'cancelled',
    });
    expect(sessions[0]).toMatchObject({
      date: '2099-06-03',
      startTime: '09:00',
      endTime: '10:30',
      location: 'Court C',
      capacity: 5,
      status: 'cancelled',
    });
    expect(overlay.remove).toHaveBeenCalled();
    expect(app._refreshCourseLessonsAfterSessionSave).toHaveBeenCalledWith('teamA', 'planA', 'sessionA');
    expect(app.showToast).toHaveBeenCalledWith('課堂調整已儲存');
  });

  test('refreshes the visible lesson list after a course session save', async () => {
    const { app } = loadCourseLessonsContext();
    app.currentPage = 'page-edu-course-lessons';
    app._eduCourseLessonsContext = { teamId: 'teamA', planId: 'planA', mode: 'list' };
    app.showCourseLessons = jest.fn(async () => ({ ok: true }));

    const refreshed = await app._refreshCourseLessonsAfterSessionSave('teamA', 'planA', 'sessionA');

    expect(refreshed).toBe(true);
    expect(app.showCourseLessons).toHaveBeenCalledWith('teamA', 'planA');
  });

  test('refreshes the visible lesson roster after the active course session save', async () => {
    const { app } = loadCourseLessonsContext();
    app.currentPage = 'page-edu-course-lessons';
    app._eduCourseLessonsContext = { teamId: 'teamA', planId: 'planA', sessionId: 'sessionA', mode: 'roster' };
    app.showCourseLessonRoster = jest.fn(async () => ({ ok: true }));

    const refreshed = await app._refreshCourseLessonsAfterSessionSave('teamA', 'planA', 'sessionA');

    expect(refreshed).toBe(true);
    expect(app.showCourseLessonRoster).toHaveBeenCalledWith('teamA', 'planA', 'sessionA');
  });

  test('owned student can submit self leave from roster', async () => {
    const { app, container, firebase } = loadCourseLessonsContext({
      rosterPayload: {
        rosterPublic: true,
        session: {
          id: 'sessionA',
          title: '第一堂',
          date: '2099-06-02',
          startTime: '10:00',
          endTime: '11:30',
          status: 'scheduled',
        },
        students: [
          { studentId: 'stu1', displayName: '小明', level: '3', attendanceKind: null, canSelfLeave: false },
          { studentId: 'stu2', displayName: '小華', level: null, attendanceKind: null, canSelfLeave: true, selfUid: 'uidA', parentUid: null },
        ],
      },
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    expect(container.innerHTML).toContain('我要請假');
    expect(container.innerHTML).toContain('App.showCourseLessonSelfLeaveDialog');

    await app.saveCourseLessonSelfLeave('stu2', 'leave', { dataset: {}, disabled: false, style: {}, isConnected: true });

    expect(firebase.saveEduCourseSelfLeave).toHaveBeenCalledWith({
      teamId: 'teamA',
      planId: 'planA',
      sessionId: 'sessionA',
      date: '2099-06-02',
      studentId: 'stu2',
      studentName: '小華',
      selfUid: 'uidA',
      parentUid: null,
      leave: true,
    });
    expect(app.showToast).toHaveBeenCalledWith('已登記請假');
  });

  test('parent-owned student can submit self leave from roster', async () => {
    const { app, container, firebase } = loadCourseLessonsContext({
      rosterPayload: {
        rosterPublic: true,
        session: {
          id: 'sessionA',
          title: 'Session A',
          date: '2099-06-02',
          startTime: '10:00',
          endTime: '11:30',
          status: 'scheduled',
        },
        students: [
          { studentId: 'stu3', displayName: 'Student C', level: null, attendanceKind: null, canSelfLeave: true, selfUid: null, parentUid: 'uidA' },
        ],
      },
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    expect(container.innerHTML).toContain('App.showCourseLessonSelfLeaveDialog');

    await app.saveCourseLessonSelfLeave('stu3', 'leave', { dataset: {}, disabled: false, style: {}, isConnected: true });

    expect(firebase.saveEduCourseSelfLeave).toHaveBeenCalledWith({
      teamId: 'teamA',
      planId: 'planA',
      sessionId: 'sessionA',
      date: '2099-06-02',
      studentId: 'stu3',
      studentName: 'Student C',
      selfUid: null,
      parentUid: 'uidA',
      leave: true,
    });
  });

  test('self leave button opens a student picker before submitting', async () => {
    const confirmBtn = {};
    const overlay = {
      className: '',
      innerHTML: '',
      onclick: null,
      remove: jest.fn(),
      querySelectorAll: jest.fn(() => [{ value: 'stu2' }]),
    };
    const appended = [];
    const { app, firebase } = loadCourseLessonsContext({
      selfLeaveConfirmBtn: confirmBtn,
      selfLeaveOverlay: overlay,
      onAppendChild: (node) => appended.push(node),
      rosterPayload: {
        rosterPublic: true,
        session: {
          id: 'sessionA',
          title: '第一堂',
          date: '2099-06-02',
          startTime: '10:00',
          endTime: '11:30',
          status: 'scheduled',
        },
        students: [
          { studentId: 'stu2', displayName: '小華', level: null, attendanceKind: null, canSelfLeave: true, selfUid: 'uidA', parentUid: null },
          { studentId: 'stu3', displayName: '小美', level: null, attendanceKind: null, canSelfLeave: true, selfUid: null, parentUid: 'uidA' },
        ],
      },
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    app.showCourseLessonSelfLeaveDialog('stu2', 'leave', { dataset: {}, disabled: false, style: {}, isConnected: true });

    expect(appended).toHaveLength(1);
    expect(overlay.innerHTML).toContain('請假登記');
    expect(overlay.innerHTML).toContain('小華');
    expect(overlay.innerHTML).toContain('小美');
    expect(typeof confirmBtn.onclick).toBe('function');

    await confirmBtn.onclick();

    expect(firebase.saveEduCourseSelfLeave).toHaveBeenCalledTimes(1);
    expect(firebase.saveEduCourseSelfLeave).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'teamA',
      planId: 'planA',
      sessionId: 'sessionA',
      studentId: 'stu2',
      leave: true,
    }));
    expect(app.showToast).toHaveBeenCalledWith('已登記請假');
  });
});
