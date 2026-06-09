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
    showPage: jest.fn(async () => { app.currentPage = 'page-edu-course-lessons'; }),
    _loadEduCoursePlans: jest.fn(async () => plans),
    getEduCoursePlans: jest.fn(() => plans),
    _loadCourseSessions: jest.fn(async () => sessions),
    isEduClubStaff: jest.fn(() => overrides.isStaff === true),
    _loadCourseEnrollments: jest.fn(async () => overrides.enrollments || []),
    _ensureCoursePlanSessionsFromPlan: overrides.ensureCoursePlanSessionsFromPlan,
    _formatCourseSessionDate: (session) => session.date,
    _formatCourseSessionTime: (session) => [session.startTime, session.endTime].filter(Boolean).join(' - '),
    _getCourseSessionStatusMeta: () => ({ label: '已排課', cls: 'scheduled' }),
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
    },
    document: {
      getElementById: jest.fn((id) => {
        if (id === 'edu-course-lessons-page') return container;
        if (id === 'edu-course-lessons-title') return title;
        if (id === 'edu-course-roster-notes-input') return overrides.notesInput || null;
        return null;
      }),
    },
    escapeHTML,
    console,
    Promise,
    Date,
    String,
    Object,
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
    expect(container.innerHTML).toContain('第</span><strong>1</strong><span>堂');
    expect(container.innerHTML).toContain('第一堂');
    expect(container.innerHTML).toContain('2/6 人');
    expect(container.innerHTML).toContain("App.showCourseLessonRoster('teamA','planA','sessionA')");
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
    expect(container.innerHTML).toContain('edu-course-roster-name-pill');
    expect(container.innerHTML).toContain('edu-course-roster-side');
    expect(container.innerHTML).toContain('Lv 3');
    expect(container.innerHTML).toContain('已簽到');
    expect(container.innerHTML).not.toContain('尚未填寫備註');
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
    expect(container.innerHTML).toContain('App.startCourseLessonNotesEdit()');

    app.startCourseLessonNotesEdit();
    expect(container.innerHTML).toContain('edu-course-roster-notes-input');

    await app.saveCourseLessonNotes({ dataset: {}, disabled: false, style: {}, isConnected: true });

    expect(firebase.updateCourseSession).toHaveBeenCalledWith('teamA', 'planA', 'sessionA', { notes: '新的課堂備註' });
    expect(app.showToast).toHaveBeenCalledWith('課堂備註已更新');
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
});
