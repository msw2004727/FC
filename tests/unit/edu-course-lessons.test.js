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
const appSource = fs.readFileSync(
  path.join(__dirname, '../../app.js'),
  'utf8'
);
const planRenderSource = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-plan-render.js'),
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

async function flushPromises(times = 8) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function extractPageshowHandler(App, documentMock) {
  const marker = "window.addEventListener('pageshow', (event) => {";
  const start = appSource.indexOf(marker);
  const bodyStart = start + marker.length;
  const end = appSource.indexOf('\n    });\n  } catch (e) {}', bodyStart);
  if (start < 0 || end < 0) throw new Error('Unable to extract pageshow handler');
  const body = appSource.slice(bodyStart, end);
  const factory = new Function(
    'App',
    'document',
    'return function pageshowHandler(event) {' + body + '\n};'
  );
  return factory(App, documentMock);
}

function createRosterPayload(displayName, payloadVersion = 'test-version') {
  return {
    rosterPublic: true,
    cacheMeta: { payloadVersion, cacheTtlMs: 30000 },
    session: {
      id: 'sessionA',
      title: 'Test Session',
      date: '2099-06-02',
      startTime: '10:00',
      endTime: '11:30',
      status: 'scheduled',
    },
    students: [{
      studentId: 'stu1',
      displayName,
      attendanceKind: null,
    }],
  };
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
    price: 1200,
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
  const authState = { uid: overrides.authUid || null };
  const localStorageStore = overrides.localStorageStore || {};
  const localStorageMock = overrides.localStorage || {
    getItem: jest.fn((key) => Object.prototype.hasOwnProperty.call(localStorageStore, key) ? localStorageStore[key] : null),
    setItem: jest.fn((key, value) => { localStorageStore[key] = String(value); }),
    removeItem: jest.fn((key) => { delete localStorageStore[key]; }),
    clear: jest.fn(() => {
      Object.keys(localStorageStore).forEach(key => { delete localStorageStore[key]; });
    }),
  };
  const createEventFromCourseLessonCallable = overrides.createEventFromCourseLessonCallable || jest.fn(async () => ({
    data: overrides.createEventFromCourseLessonData || {
      success: true,
      alreadyExists: false,
      eventId: 'eventFromLessonA',
      courseLinkId: 'courseLinkA',
      privateEvent: true,
    },
  }));
  const httpsCallable = overrides.httpsCallable || jest.fn((name) => {
    if (name === 'createEventFromCourseLesson') return createEventFromCourseLessonCallable;
    return jest.fn(async () => ({ data: {} }));
  });
  const ensureFirebaseFunctionsSdk = overrides.ensureFirebaseFunctionsSdk || jest.fn(async () => ({ httpsCallable }));
  const app = {

    currentPage: 'page-team-detail',
    _pageTransitionSeq: 0,
    _activePageTransitionSeq: 0,
    _eduCourseLessonsRequestSeq: 0,
    _courseSessionCache: overrides.courseSessionCache || {},
    _courseEnrollCache: overrides.courseEnrollCache || {},
    _eduStudentsCache: overrides.eduStudentsCache || {},
    _claimPageTransition: jest.fn((_pageId, options = {}) => {
      const inherited = Number(options?._navigationTransitionSeq);
      return Number.isSafeInteger(inherited) && inherited > 0
        ? inherited
        : ++app._pageTransitionSeq;
    }),
    _isPageTransitionCurrent: jest.fn(transitionSeq => transitionSeq === app._pageTransitionSeq),
    _abortStalePageTransition: jest.fn((source, pageId, transitionSeq) => ({
      ok: false,
      reason: 'stale_transition',
      source,
      pageId,
      transitionSeq,
    })),
    showPage: jest.fn(async (_pageId, options = {}) => {
      app.currentPage = 'page-edu-course-lessons';
      app._activePageTransitionSeq = Number(options?._navigationTransitionSeq) || app._pageTransitionSeq;
    }),
    _loadEduCoursePlans: jest.fn(async () => plans),
    getEduCoursePlans: jest.fn(() => plans),
    getEduStudents: jest.fn((teamId) => app._eduStudentsCache?.[teamId] || []),
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
    _getCourseSessionDisplayStudentCount: overrides.getCourseSessionDisplayStudentCount,
    _renderCourseSessionStudentAvatar: (_student, name) => '<span class="avatar">' + escapeHTML(name) + '</span>',
    _bindCourseSessionStudentAvatarFallbacks: jest.fn(),
    _withButtonLoading: jest.fn((_button, _text, fn) => fn()),
    appConfirm: overrides.appConfirm || jest.fn(async () => overrides.appConfirmResult !== false),
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
      saveEduCourseSelfAttendance: jest.fn(async () => ({ changed: 1 })),
      updateCourseSession: jest.fn(async () => ({ ok: true })),
      queryEduAttendance: jest.fn(async () => overrides.attendanceRecords || []),
      ...(overrides.FirebaseService || {}),
    },
    ensureFirebaseFunctionsSdk,
    ApiService: overrides.ApiService || {
      getCurrentUser: jest.fn(() => overrides.currentUser || null),
    },
    document: {

      getElementById: jest.fn((id) => {
        if (overrides.elements && overrides.elements[id]) return overrides.elements[id];
        if (id === 'edu-course-lessons-page') return container;
        if (id === 'edu-course-lessons-title') return title;
        if (id === 'edu-course-roster-notes-input') return overrides.notesInput || null;
        if (id === '_eduSelfLeaveConfirmBtn') return overrides.selfLeaveConfirmBtn || null;
        if (id === '_eduSelfRegisterConfirmBtn') return overrides.selfRegisterConfirmBtn || null;
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
    _withSportHubTimeout: overrides.withSportHubTimeout || (promise => Promise.resolve(promise)),
    Date,
    String,
    Number,
    Object,
    parseInt,
    firebase: {
      auth: () => ({
        currentUser: authState.uid ? { uid: authState.uid } : null,
      }),
      firestore: overrides.firestore,
    },
    localStorage: localStorageMock,
    ...(overrides.window ? { window: overrides.window, URL } : {}),
  };
  vm.runInNewContext(renderSource, context, { filename: 'edu-course-lessons-render.js' });
  vm.runInNewContext(controllerSource, context, { filename: 'edu-course-lessons.js' });
  return {
    context,
    app: context.App,
    firebase: context.FirebaseService,
    container,
    title,
    authState,
    localStorage: localStorageMock,
    localStorageStore,
    functions: { ensureFirebaseFunctionsSdk, httpsCallable, createEventFromCourseLessonCallable },
  };

}

describe('edu course lessons', () => {
  test('renders session lesson cards from existing sessions', async () => {
    const { app, container, title } = loadCourseLessonsContext();

    await app.showCourseLessons('teamA', 'planA');

    expect(app.showPage).toHaveBeenCalledWith('page-edu-course-lessons', { _navigationTransitionSeq: 1 });
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
    expect(container.innerHTML).toContain('edu-course-lesson-share-btn');
    expect(container.innerHTML).toContain("App.shareEduCourseLesson('teamA','planA','sessionA')");
    expect(container.innerHTML).toContain('onkeydown="event.stopPropagation()"');
    expect(container.innerHTML).toContain('onclick="event.stopPropagation();return App.shareEduCourseLesson');
  });

  test('lesson list keeps scheduled lessons first then done and cancelled by nearest time', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2099-06-10T12:00:00').getTime());
    try {
      const { app, container } = loadCourseLessonsContext({
        sessions: [
          { id: 'done-old', title: 'Done Older', status: 'done', date: '2099-06-01', startTime: '10:00', endTime: '11:30', location: 'A', studentIds: [], capacity: 6 },
          { id: 'cancel-recent', title: 'Cancelled Recent', status: 'cancelled', date: '2099-06-08', startTime: '10:00', endTime: '11:30', location: 'A', studentIds: [], capacity: 6 },
          { id: 'scheduled-far', title: 'Scheduled Far', status: 'scheduled', date: '2099-06-20', startTime: '10:00', endTime: '11:30', location: 'A', studentIds: [], capacity: 6 },
          { id: 'done-recent', title: 'Done Recent', status: 'done', date: '2099-06-09', startTime: '10:00', endTime: '11:30', location: 'A', studentIds: [], capacity: 6 },
          { id: 'scheduled-near', title: 'Scheduled Near', status: 'scheduled', date: '2099-06-11', startTime: '10:00', endTime: '11:30', location: 'A', studentIds: [], capacity: 6 },
        ],
        getCourseSessionStatusMeta: (session) => {
          if (session.status === 'cancelled') return { label: 'Cancelled', cls: 'cancelled' };
          if (session.status === 'done') return { label: 'Done', cls: 'done' };
          return { label: 'Scheduled', cls: 'scheduled' };
        },
      });

      await app.showCourseLessons('teamA', 'planA');

      const html = container.innerHTML;
      const positions = ['Scheduled Near', 'Scheduled Far', 'Done Recent', 'Cancelled Recent', 'Done Older']
        .map(title => html.indexOf(title));
      positions.forEach(position => expect(position).toBeGreaterThanOrEqual(0));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    } finally {
      nowSpy.mockRestore();
    }
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

  test('weekly staff lesson cards show conversion action and hide it for unsupported rows', async () => {
    const weeklyPlan = {
      id: 'weeklyPlan',
      name: 'Weekly Plan',
      planType: 'weekly',
      startDate: '2099-06-01',
      endDate: '2099-06-30',
    };
    const weeklySessions = [
      { id: 'weeklyA', title: '\u7b2c 1 \u5802\u8ab2', status: 'scheduled', date: '2099-06-01', startTime: '09:00', endTime: '10:30', location: 'Court A', studentIds: [], capacity: 6 },
      { id: 'weeklyLinked', title: '\u5df2\u8f49\u5316\u8ab2', status: 'scheduled', date: '2099-06-03', startTime: '09:00', endTime: '10:30', location: 'Court A', studentIds: [], capacity: 6, convertedEventId: 'eventLinked', courseLinked: true, courseLinkId: 'linkLinked' },
      { id: 'weeklyCancelled', title: '\u53d6\u6d88\u8ab2', status: 'cancelled', date: '2099-06-08', startTime: '09:00', endTime: '10:30', location: 'Court A', studentIds: [], capacity: 6 },
    ];
    const getCourseSessionStatusMeta = (session) => session.status === 'cancelled'
      ? { label: 'Cancelled', cls: 'cancelled' }
      : { label: 'Scheduled', cls: 'scheduled' };
    const staff = loadCourseLessonsContext({
      isStaff: true,
      plans: [weeklyPlan],
      sessions: weeklySessions,
      getCourseSessionStatusMeta,
    });

    await staff.app.showCourseLessons('teamA', 'weeklyPlan');

    expect(staff.container.innerHTML).toContain('edu-course-lesson-head-actions');
    expect(staff.container.innerHTML).toContain('edu-course-lesson-convert-event-btn');
    expect(staff.container.innerHTML).toContain('\u8f49\u5316\u6210\u6d3b\u52d5');
    expect(staff.container.innerHTML).toContain('onkeydown="event.stopPropagation()"');
    expect(staff.container.innerHTML).toContain("App.convertCourseLessonToEvent('teamA','weeklyPlan','weeklyA',this)");
    expect(staff.container.innerHTML).toContain("App.convertCourseLessonToEvent('teamA','weeklyPlan','weeklyLinked',this)");
    expect(staff.container.innerHTML).toContain('data-converted-event-id="eventLinked"');
    expect(staff.container.innerHTML).toContain('edu-course-lesson-convert-event-btn is-converted');
    expect(staff.container.innerHTML).toContain('\u5df2\u8f49\u5316');
    expect(staff.container.innerHTML).toContain('title="\u8a72\u8ab2\u7a0b\u5df2\u8f49\u5316\u6210\u6d3b\u52d5"');

    expect(staff.container.innerHTML).not.toContain("App.convertCourseLessonToEvent('teamA','weeklyPlan','weeklyCancelled',this)");

    const sessionStaff = loadCourseLessonsContext({ isStaff: true });
    await sessionStaff.app.showCourseLessons('teamA', 'planA');
    expect(sessionStaff.container.innerHTML).not.toContain('edu-course-lesson-convert-event-btn');

    const viewer = loadCourseLessonsContext({ plans: [weeklyPlan], sessions: weeklySessions });
    await viewer.app.showCourseLessons('teamA', 'weeklyPlan');
    expect(viewer.container.innerHTML).not.toContain('edu-course-lesson-convert-event-btn');
  });

  test('missing linked event renders a repair action instead of a converted lock', async () => {
    const weeklyPlan = {
      id: 'weeklyPlan',
      name: 'Weekly Plan',
      planType: 'weekly',
      startDate: '2099-06-01',
      endDate: '2099-06-30',
    };
    const ApiService = {
      getCurrentUser: jest.fn(() => null),
      getEvent: jest.fn(() => null),
    };
    const staff = loadCourseLessonsContext({
      isStaff: true,
      plans: [weeklyPlan],
      sessions: [{
        id: 'weeklyLinkedDeleted',
        title: '\u5df2\u522a\u9664\u6d3b\u52d5\u7684\u8ab2',
        status: 'scheduled',
        date: '2099-06-03',
        startTime: '09:00',
        endTime: '10:30',
        location: 'Court A',
        studentIds: [],
        capacity: 6,
        convertedEventId: 'deletedEvent',
        courseLinked: true,
        courseLinkId: 'oldLink',
      }],
      ApiService,
    });

    await staff.app.showCourseLessons('teamA', 'weeklyPlan');

    expect(ApiService.getEvent).toHaveBeenCalledWith('deletedEvent');
    expect(staff.container.innerHTML).toContain('\u4fee\u5fa9\u6d3b\u52d5');
    expect(staff.container.innerHTML).toContain("App.convertCourseLessonToEvent('teamA','weeklyPlan','weeklyLinkedDeleted',this)");
    expect(staff.container.innerHTML).not.toContain('edu-course-lesson-convert-event-btn is-converted');
    expect(staff.container.innerHTML).not.toContain('data-converted-event-id="deletedEvent"');
  });

  test('convertCourseLessonToEvent uses callable and marks action as converted', async () => {
    const { app, functions } = loadCourseLessonsContext({
      isStaff: true,
      plans: [{ id: 'weeklyPlan', coverImage: 'https://cdn.example/course-cover.webp' }],
      currentUser: { uid: 'host-1', displayName: 'Coach Ada' },
      createEventFromCourseLessonData: {
        success: true,
        alreadyExists: false,
        eventId: 'eventA',
        courseLinkId: 'courseLinkA',
        privateEvent: true,
      },
    });
    const button = {
      dataset: {},
      disabled: false,
      textContent: '\u8f49\u5316\u6210\u6d3b\u52d5',
      style: { opacity: '' },
      isConnected: true,
      getAttribute: jest.fn(() => null),
      setAttribute: jest.fn(),
      removeAttribute: jest.fn(),
      classList: { add: jest.fn() },
    };

    const result = await app.convertCourseLessonToEvent('teamA', 'weeklyPlan', 'weeklyA', button);

    expect(app._withButtonLoading).toHaveBeenCalledWith(button, '\u8f49\u5316\u4e2d...', expect.any(Function));
    expect(functions.ensureFirebaseFunctionsSdk).toHaveBeenCalledWith('asia-east1');
    expect(functions.httpsCallable).toHaveBeenCalledWith('createEventFromCourseLesson');
    expect(functions.createEventFromCourseLessonCallable).toHaveBeenCalledWith({
      teamId: 'teamA',
      planId: 'weeklyPlan',
      sessionId: 'weeklyA',
      courseCoverImage: 'https://cdn.example/course-cover.webp',
      creatorName: 'Coach Ada',
      displayName: 'Coach Ada',
      name: 'Coach Ada',
    });
    expect(result).toMatchObject({ success: true, eventId: 'eventA', privateEvent: true });
    expect(app.appConfirm).toHaveBeenCalledWith(expect.stringContaining('\u6d3b\u52d5\u9810\u8a2d\u70ba\u4e0d\u516c\u958b'));
    expect(app.appConfirm).toHaveBeenCalledWith(expect.stringContaining('\u9ede\u64ca\u8f49\u5316\u7684\u8077\u54e1\u6703\u7d81\u5b9a\u70ba\u6d3b\u52d5\u4e3b\u8fa6\u4eba'));
    expect(app.showToast).toHaveBeenCalledWith('\u8ab2\u7a0b\u5df2\u8f49\u5316\u6210\u6d3b\u52d5\u5b8c\u6210');
    expect(button.dataset.convertedEventId).toBe('eventA');
    expect(button.disabled).toBe(false);
    expect(button.setAttribute).toHaveBeenCalledWith('aria-disabled', 'true');
    expect(button.setAttribute).toHaveBeenCalledWith('title', '\u8a72\u8ab2\u7a0b\u5df2\u8f49\u5316\u6210\u6d3b\u52d5');
    expect(button.classList.add).toHaveBeenCalledWith('is-converted');
    expect(button.textContent).toBe('\u5df2\u8f49\u5316');
  });


  test('convertCourseLessonToEvent rerenders converted state after successful conversion', async () => {
    const weeklyPlan = {
      id: 'weeklyPlan',
      name: 'Weekly Plan',
      planType: 'weekly',
      startDate: '2099-06-01',
      endDate: '2099-06-30',
    };
    const ApiService = {
      getCurrentUser: jest.fn(() => null),
      getEvent: jest.fn(() => null),
    };
    const { app, container } = loadCourseLessonsContext({
      isStaff: true,
      plans: [weeklyPlan],
      sessions: [{
        id: 'weeklyA',
        title: 'Weekly A',
        status: 'scheduled',
        date: '2099-06-03',
        startTime: '09:00',
        endTime: '10:30',
        location: 'Court A',
        studentIds: [],
        capacity: 6,
      }],
      ApiService,
      createEventFromCourseLessonData: {
        success: true,
        alreadyExists: false,
        eventId: 'eventA',
        courseLinkId: 'courseLinkA',
        privateEvent: true,
      },
    });
    await app.showCourseLessons('teamA', 'weeklyPlan');

    const button = {
      dataset: {},
      disabled: false,
      textContent: '\u8f49\u5316\u6210\u6d3b\u52d5',
      style: { opacity: '' },
      isConnected: true,
      getAttribute: jest.fn(() => null),
      setAttribute: jest.fn(),
      removeAttribute: jest.fn(),
      classList: { add: jest.fn(), contains: jest.fn(() => false) },
    };

    await app.convertCourseLessonToEvent('teamA', 'weeklyPlan', 'weeklyA', button);

    expect(app.showToast).toHaveBeenLastCalledWith('\u8ab2\u7a0b\u5df2\u8f49\u5316\u6210\u6d3b\u52d5\u5b8c\u6210');
    expect(app._eduCourseLessonsContext.sessions[0]).toMatchObject({
      convertedEventId: 'eventA',
      linkedEventId: 'eventA',
      courseLinked: true,
      courseLinkId: 'courseLinkA',
      courseLinkSource: 'eduCourseLesson',
    });
    expect(container.innerHTML).toContain('data-converted-event-id="eventA"');
    expect(container.innerHTML).toContain('\u5df2\u8f49\u5316');
    expect(container.innerHTML).not.toContain('\u4fee\u5fa9\u6d3b\u52d5');
  });

  test('convertCourseLessonToEvent rerenders converted state and repair toast after rebuild', async () => {
    const weeklyPlan = {
      id: 'weeklyPlan',
      name: 'Weekly Plan',
      planType: 'weekly',
      startDate: '2099-06-01',
      endDate: '2099-06-30',
    };
    const ApiService = {
      getCurrentUser: jest.fn(() => null),
      getEvent: jest.fn(() => null),
    };
    const { app, container } = loadCourseLessonsContext({
      isStaff: true,
      plans: [weeklyPlan],
      sessions: [{
        id: 'weeklyLinkedDeleted',
        title: 'Linked Deleted',
        status: 'scheduled',
        date: '2099-06-03',
        startTime: '09:00',
        endTime: '10:30',
        location: 'Court A',
        studentIds: [],
        capacity: 6,
        convertedEventId: 'deletedEvent',
        courseLinked: true,
        courseLinkId: 'oldLink',
      }],
      ApiService,
      createEventFromCourseLessonData: {
        success: true,
        rebuilt: true,
        previousEventId: 'deletedEvent',
        eventId: 'rebuiltEvent',
        courseLinkId: 'newLink',
        privateEvent: true,
      },
    });
    await app.showCourseLessons('teamA', 'weeklyPlan');
    expect(container.innerHTML).toContain('\u4fee\u5fa9\u6d3b\u52d5');

    const button = {
      dataset: {},
      disabled: false,
      textContent: '\u4fee\u5fa9\u6d3b\u52d5',
      style: { opacity: '' },
      isConnected: true,
      getAttribute: jest.fn(() => null),
      setAttribute: jest.fn(),
      removeAttribute: jest.fn(),
      classList: { add: jest.fn(), contains: jest.fn(() => false) },
    };

    await app.convertCourseLessonToEvent('teamA', 'weeklyPlan', 'weeklyLinkedDeleted', button);

    expect(app.showToast).toHaveBeenLastCalledWith('\u8ab2\u7a0b\u6d3b\u52d5\u5df2\u4fee\u5fa9\u5b8c\u6210');
    expect(app._eduCourseLessonsContext.sessions[0]).toMatchObject({
      convertedEventId: 'rebuiltEvent',
      linkedEventId: 'rebuiltEvent',
      courseLinked: true,
      courseLinkId: 'newLink',
      courseLinkSource: 'eduCourseLesson',
    });
    expect(container.innerHTML).toContain('data-converted-event-id="rebuiltEvent"');
    expect(container.innerHTML).toContain('\u5df2\u8f49\u5316');
    expect(container.innerHTML).not.toContain('\u4fee\u5fa9\u6d3b\u52d5');
  });
  test('convertCourseLessonToEvent shows toast and skips callable for already converted action', async () => {
    const { app, functions } = loadCourseLessonsContext({
      isStaff: true,
      plans: [{ id: 'weeklyPlan', name: 'Weekly Plan' }],
    });
    const button = {
      dataset: { convertedEventId: 'eventA' },
      getAttribute: jest.fn(() => 'true'),
      classList: { contains: jest.fn(() => true) },
    };

    const result = await app.convertCourseLessonToEvent('teamA', 'weeklyPlan', 'weeklyA', button);

    expect(result).toBe(false);
    expect(app.showToast).toHaveBeenCalledWith('\u8a72\u8ab2\u7a0b\u5df2\u8f49\u5316\u6210\u6d3b\u52d5');
    expect(app.appConfirm).not.toHaveBeenCalled();
    expect(functions.ensureFirebaseFunctionsSdk).not.toHaveBeenCalled();
    expect(functions.createEventFromCourseLessonCallable).not.toHaveBeenCalled();
  });

  test('convertCourseLessonToEvent stops before callable when staff cancels explanation dialog', async () => {
    const appConfirm = jest.fn(async () => false);
    const { app, functions } = loadCourseLessonsContext({
      isStaff: true,
      appConfirm,
      plans: [{ id: 'weeklyPlan', name: 'Weekly Plan' }],
    });

    const result = await app.convertCourseLessonToEvent('teamA', 'weeklyPlan', 'weeklyA', { dataset: {}, style: {} });

    expect(result).toBeNull();
    expect(appConfirm).toHaveBeenCalledWith(expect.stringContaining('Weekly Plan'));
    expect(functions.ensureFirebaseFunctionsSdk).not.toHaveBeenCalled();
    expect(app._withButtonLoading).not.toHaveBeenCalled();
  });
  test('convertCourseLessonToEvent blocks non-staff before calling functions', async () => {
    const { app, functions } = loadCourseLessonsContext({ isStaff: false });

    await app.convertCourseLessonToEvent('teamA', 'weeklyPlan', 'weeklyA', { dataset: {}, style: {} });

    expect(functions.ensureFirebaseFunctionsSdk).not.toHaveBeenCalled();
    expect(app.showToast).toHaveBeenCalledWith('\u50c5\u4ff1\u6a02\u90e8\u8077\u54e1\u53ef\u4ee5\u8f49\u5316\u6d3b\u52d5');
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
    expect(cssSource).toContain('.edu-course-lesson-head-actions');
    expect(cssSource).toContain('.edu-course-lesson-convert-event-btn');
    expect(cssSource).toContain('data-btn-loading="1"');
    expect(cssSource).toContain('@keyframes edu-course-convert-glow');
    expect(cssSource).toContain('@keyframes edu-course-convert-shine');
    expect(cssSource).toContain('@keyframes edu-course-convert-spin');
    expect(cssSource).toContain('linear-gradient(180deg, #34d399');
    expect(cssSource).toContain('letter-spacing: 0;');
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
    expect(cssSource).toContain('.edu-course-roster-refresh-status');
    expect(cssSource).toContain('[data-theme="dark"] .edu-course-roster-refresh-status');
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

  test('preloads only a small uncached course lesson batch', async () => {
    const loadCourseSessions = jest.fn(async () => []);
    const { app } = loadCourseLessonsContext({
      loadCourseSessions,
      courseSessionCache: {
        'teamA:planCached': [{ id: 'cachedSession' }],
      },
    });

    app._preloadCourseLessonsForPlans('teamA', [
      { id: 'planCached' },
      { id: 'planA' },
      { id: 'planB' },
      { id: 'planC' },
      { id: 'planD' },
    ]);

    expect(loadCourseSessions).toHaveBeenCalledTimes(3);
    expect(loadCourseSessions).toHaveBeenNthCalledWith(1, 'teamA', 'planA');
    expect(loadCourseSessions).toHaveBeenNthCalledWith(2, 'teamA', 'planB');
    expect(loadCourseSessions).toHaveBeenNthCalledWith(3, 'teamA', 'planC');
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


  test('weekly lesson cards count only registered and signed-in students', async () => {
    const { app, container, firebase } = loadCourseLessonsContext({
      plans: [{
        id: 'weeklyPlan',
        name: '\u56fa\u5b9a\u9031\u671f\u73ed',
        planType: 'weekly',
        weekdays: [1, 3],
        timeSlot: '09:00-10:30',
        startDate: '2099-06-01',
        endDate: '2099-06-30',
      }],
      sessions: [{
        id: 'weeklyA',
        title: '\u7b2c 1 \u5802\u8ab2',
        date: '2099-06-01',
        startTime: '09:00',
        endTime: '10:30',
        location: '\u7403\u5834 B',
        studentIds: ['stu1', 'stu2', 'stu3'],
        capacity: 6,
      }],
      attendanceRecords: [
        { studentId: 'stu1', sessionId: 'weeklyA', kind: 'registered', status: 'active' },
        { studentId: 'stu2', sessionId: 'weeklyA', kind: 'signin', status: 'active' },
        { studentId: 'stu3', sessionId: 'weeklyA', kind: 'leave', status: 'active' },
        { studentId: 'stu4', sessionId: 'weeklyA', kind: 'registered', status: 'removed' },
      ],
      getCourseSessionDisplayStudentCount: jest.fn(() => 3),
    });

    await app.showCourseLessons('teamA', 'weeklyPlan');

    expect(firebase.queryEduAttendance).toHaveBeenCalledWith({ teamId: 'teamA', coursePlanId: 'weeklyPlan' });
    expect(app._getCourseSessionDisplayStudentCount).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain('2/6 \u4eba');
    expect(container.innerHTML).not.toContain('3/6 \u4eba');
    expect(app._getCachedCourseLessonConfirmedCounts('teamA', 'weeklyPlan', [{ id: 'weeklyA' }]).weeklyA).toBe(2);
  });

  test('weekly lesson cards update counts from one attendance listener without a duplicate query', async () => {
    let emitSnapshot;
    const unsubscribe = jest.fn();
    const query = {
      where: jest.fn(function where() { return this; }),
      onSnapshot: jest.fn((next) => {
        emitSnapshot = next;
        return unsubscribe;
      }),
    };
    const collection = jest.fn(() => query);
    const firestore = jest.fn(() => ({ collection }));
    const weeklySessions = [{
      id: 'weeklyA',
      title: '\u7b2c 1 \u5802\u8ab2',
      date: '2099-06-01',
      startTime: '09:00',
      endTime: '10:30',
      capacity: 6,
    }];
    const { app, container, firebase } = loadCourseLessonsContext({
      firestore,
      plans: [{
        id: 'weeklyPlan',
        name: '\u56fa\u5b9a\u9031\u671f\u73ed',
        planType: 'weekly',
        startDate: '2099-06-01',
        endDate: '2099-06-30',
      }],
      sessions: weeklySessions,
      courseSessionCache: { 'teamA:weeklyPlan': weeklySessions },
    });

    let settled = false;
    const openPromise = app.showCourseLessons('teamA', 'weeklyPlan').then((result) => {
      settled = true;
      return result;
    });
    for (let attempt = 0; attempt < 100 && typeof emitSnapshot !== 'function'; attempt += 1) {
      await Promise.resolve();
    }

    expect(settled).toBe(false);
    expect(container.innerHTML).toContain('\u7b2c 1 \u5802\u8ab2');
    expect(container.innerHTML).toContain('0/6 \u4eba');
    expect(typeof emitSnapshot).toBe('function');

    emitSnapshot({
      docs: [{
        id: 'attendanceA',
        data: () => ({ studentId: 'stu1', sessionId: 'weeklyA', kind: 'registered', status: 'active' }),
      }],
    });
    await openPromise;

    expect(collection).toHaveBeenCalledWith('eduAttendance');
    expect(query.where.mock.calls).toEqual([
      ['teamId', '==', 'teamA'],
      ['coursePlanId', '==', 'weeklyPlan'],
    ]);
    expect(firebase.queryEduAttendance).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain('1/6 \u4eba');

    emitSnapshot({
      docs: [
        {
          id: 'attendanceA',
          data: () => ({ studentId: 'stu1', sessionId: 'weeklyA', kind: 'registered', status: 'active' }),
        },
        {
          id: 'attendanceB',
          data: () => ({ studentId: 'stu2', sessionId: 'weeklyA', kind: 'signin', status: 'active' }),
        },
      ],
    });

    expect(container.innerHTML).toContain('2/6 \u4eba');
    expect(app._eduCourseLessonsContext.confirmedCountBySessionId.weeklyA).toBe(2);
    expect(app._getCachedCourseLessonConfirmedCounts('teamA', 'weeklyPlan', weeklySessions).weeklyA).toBe(2);
    app._stopCourseLessonAttendanceCountListener();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('weekly lesson cards reuse the last count while the background listener refreshes it', async () => {
    let emitSnapshot;
    const unsubscribe = jest.fn();
    const query = {
      where: jest.fn(function where() { return this; }),
      onSnapshot: jest.fn((next) => {
        emitSnapshot = next;
        return unsubscribe;
      }),
    };
    const weeklySessions = [{
      id: 'weeklyA',
      title: '\u7b2c 1 \u5802\u8ab2',
      date: '2099-06-01',
      startTime: '09:00',
      endTime: '10:30',
      capacity: 6,
    }];
    const { app, container } = loadCourseLessonsContext({
      firestore: jest.fn(() => ({ collection: jest.fn(() => query) })),
      plans: [{
        id: 'weeklyPlan',
        name: '\u56fa\u5b9a\u9031\u671f\u73ed',
        planType: 'weekly',
        startDate: '2099-06-01',
        endDate: '2099-06-30',
      }],
      sessions: weeklySessions,
      courseSessionCache: { 'teamA:weeklyPlan': weeklySessions },
    });
    app._rememberCourseLessonConfirmedCounts('teamA', 'weeklyPlan', { weeklyA: 2 });

    let settled = false;
    const openPromise = app.showCourseLessons('teamA', 'weeklyPlan').then((result) => {
      settled = true;
      return result;
    });
    for (let attempt = 0; attempt < 100 && typeof emitSnapshot !== 'function'; attempt += 1) {
      await Promise.resolve();
    }

    expect(settled).toBe(false);
    expect(container.innerHTML).toContain('2/6 \u4eba');
    expect(app._getCachedCourseLessonConfirmedCounts('teamA', 'otherPlan', weeklySessions)).toBeNull();

    emitSnapshot({ docs: [] });
    await openPromise;

    expect(container.innerHTML).toContain('0/6 \u4eba');
    expect(app._getCachedCourseLessonConfirmedCounts('teamA', 'weeklyPlan', weeklySessions).weeklyA).toBe(0);
    app._stopCourseLessonAttendanceCountListener();
  });

  test('weekly lesson cards keep the last count when live and fallback refreshes are unavailable', async () => {
    const weeklySessions = [{
      id: 'weeklyA',
      title: '\u7b2c 1 \u5802\u8ab2',
      date: '2099-06-01',
      startTime: '09:00',
      endTime: '10:30',
      capacity: 6,
    }];
    const queryEduAttendance = jest.fn(async () => {
      throw new Error('offline');
    });
    const { app, container } = loadCourseLessonsContext({
      plans: [{
        id: 'weeklyPlan',
        name: '\u56fa\u5b9a\u9031\u671f\u73ed',
        planType: 'weekly',
        startDate: '2099-06-01',
        endDate: '2099-06-30',
      }],
      sessions: weeklySessions,
      courseSessionCache: { 'teamA:weeklyPlan': weeklySessions },
      FirebaseService: { queryEduAttendance },
    });
    app._rememberCourseLessonConfirmedCounts('teamA', 'weeklyPlan', { weeklyA: 2 });

    await app.showCourseLessons('teamA', 'weeklyPlan');

    expect(queryEduAttendance).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toContain('2/6 \u4eba');
  });

  test('a stale fallback cannot overwrite a newer listener count cache', async () => {
    const oldFallback = deferred();
    const queryEduAttendance = jest.fn(() => oldFallback.promise);
    let emitNewSnapshot;
    const unsubscribe = jest.fn();
    const query = {
      where: jest.fn(function where() { return this; }),
      onSnapshot: jest.fn((next) => {
        emitNewSnapshot = next;
        return unsubscribe;
      }),
    };
    const weeklySessions = [{
      id: 'weeklyA',
      title: '\u7b2c 1 \u5802\u8ab2',
      date: '2099-06-01',
      startTime: '09:00',
      endTime: '10:30',
      capacity: 6,
    }];
    const { app, context, container } = loadCourseLessonsContext({
      plans: [{
        id: 'weeklyPlan',
        name: '\u56fa\u5b9a\u9031\u671f\u73ed',
        planType: 'weekly',
        startDate: '2099-06-01',
        endDate: '2099-06-30',
      }],
      sessions: weeklySessions,
      courseSessionCache: { 'teamA:weeklyPlan': weeklySessions },
      FirebaseService: { queryEduAttendance },
    });

    const oldOpen = app.showCourseLessons('teamA', 'weeklyPlan');
    for (let attempt = 0; attempt < 100 && queryEduAttendance.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(queryEduAttendance).toHaveBeenCalledTimes(1);

    context.firebase.firestore = jest.fn(() => ({ collection: jest.fn(() => query) }));
    const newOpen = app.showCourseLessons('teamA', 'weeklyPlan');
    for (let attempt = 0; attempt < 100 && typeof emitNewSnapshot !== 'function'; attempt += 1) {
      await Promise.resolve();
    }
    emitNewSnapshot({
      docs: Array.from({ length: 3 }, (_, index) => ({
        id: 'newAttendance' + index,
        data: () => ({
          studentId: 'newStudent' + index,
          sessionId: 'weeklyA',
          kind: 'registered',
          status: 'active',
        }),
      })),
    });
    await newOpen;
    expect(container.innerHTML).toContain('3/6 \u4eba');
    expect(app._getCachedCourseLessonConfirmedCounts('teamA', 'weeklyPlan', weeklySessions).weeklyA).toBe(3);

    oldFallback.resolve([
      { studentId: 'oldStudent', sessionId: 'weeklyA', kind: 'registered', status: 'active' },
    ]);
    await expect(oldOpen).resolves.toMatchObject({ ok: false, reason: 'stale' });

    expect(app._getCachedCourseLessonConfirmedCounts('teamA', 'weeklyPlan', weeklySessions).weeklyA).toBe(3);
    expect(container.innerHTML).toContain('3/6 \u4eba');
    app._stopCourseLessonAttendanceCountListener();
  });

  test('stopping the attendance listener settles a pending initial snapshot', async () => {
    const unsubscribe = jest.fn();
    const query = {
      where: jest.fn(function where() { return this; }),
      onSnapshot: jest.fn(() => unsubscribe),
    };
    const { app } = loadCourseLessonsContext({
      firestore: jest.fn(() => ({ collection: jest.fn(() => query) })),
    });

    const initialSnapshot = app._startCourseLessonAttendanceCountListener('teamA', 'weeklyPlan', []);
    app._stopCourseLessonAttendanceCountListener();

    await expect(initialSnapshot).resolves.toBeNull();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('opening a lesson roster stops the lesson-list attendance listener', async () => {
    const { app } = loadCourseLessonsContext();
    const stopListener = jest.spyOn(app, '_stopCourseLessonAttendanceCountListener');

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    expect(stopListener).toHaveBeenCalledTimes(1);
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

  test('lesson share handoff forwards the verified page-lock bypass to navigation', async () => {
    const { app } = loadCourseLessonsContext();
    app._pageTransitionSeq = 7;
    app._activePageTransitionSeq = 7;

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA', {
      _navigationTransitionSeq: 7,
      bypassPageLock: true,
      preserveRouteUrl: true,
      skipPageHistory: true,
      suppressHashSync: true,
    });

    expect(app.showPage).toHaveBeenCalledWith('page-edu-course-lessons', {
      _navigationTransitionSeq: 7,
      bypassPageLock: true,
      skipPageHistory: true,
      suppressHashSync: true,
    });
  });

  test('canonical roster retries preserve the nested lesson URL automatically', async () => {
    const href = 'https://toosterx.com/teams/teamA/courses/planA/lessons/sessionA?courseTab=active';
    const { app } = loadCourseLessonsContext({
      window: {
        location: {
          href,
          pathname: '/teams/teamA/courses/planA/lessons/sessionA',
          hostname: 'toosterx.com',
        },
      },
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA', { forceRefresh: true });

    expect(app.showPage).toHaveBeenCalledWith('page-edu-course-lessons', {
      _navigationTransitionSeq: 1,
      bypassPageLock: false,
      suppressHashSync: true,
    });
  });

  test('canonical roster detection rejects extra and unsafe Mini App prefixes', () => {
    const validHref = 'https://miniapp.line.me/demo/teams/teamA/courses/planA/lessons/sessionA?courseTab=active';
    const valid = loadCourseLessonsContext({
      window: {
        location: {
          href: validHref,
          pathname: '/demo/teams/teamA/courses/planA/lessons/sessionA',
          hostname: 'miniapp.line.me',
        },
      },
    });
    expect(valid.app._isCurrentEduCourseLessonCanonicalRoute('teamA', 'planA', 'sessionA')).toBe(true);

    const invalidPaths = [
      '/a/b/teams/teamA/courses/planA/lessons/sessionA',
      '/demo%2Fextra/teams/teamA/courses/planA/lessons/sessionA',
      '/demo%5Cextra/teams/teamA/courses/planA/lessons/sessionA',
    ];
    invalidPaths.forEach((pathname) => {
      const invalid = loadCourseLessonsContext({
        window: {
          location: {
            href: 'https://miniapp.line.me' + pathname + '?courseTab=active',
            pathname,
            hostname: 'miniapp.line.me',
          },
        },
      });
      expect(invalid.app._isCurrentEduCourseLessonCanonicalRoute('teamA', 'planA', 'sessionA')).toBe(false);
    });
  });

  test('fresh owned roster cards are stable-pinned with a theme-aware background tint', async () => {
    const { app, container } = loadCourseLessonsContext({
      rosterPayload: {
        rosterPublic: true,
        session: { id: 'sessionA', title: 'Session A', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
        students: [
          { studentId: 'other1', displayName: 'Other One', attendanceKind: null, canSelfLeave: false },
          { studentId: 'mine1', displayName: 'Owned One', attendanceKind: null, canSelfLeave: true },
          { studentId: 'mine2', displayName: 'Owned Two', attendanceKind: null, canSelfLeave: true },
          { studentId: 'other2', displayName: 'Other Two', attendanceKind: null, canSelfLeave: false },
        ],
      },
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    const html = container.innerHTML;
    expect(html.indexOf('Owned One')).toBeLessThan(html.indexOf('Owned Two'));
    expect(html.indexOf('Owned Two')).toBeLessThan(html.indexOf('Other One'));
    expect(html.indexOf('Other One')).toBeLessThan(html.indexOf('Other Two'));
    expect((html.match(/edu-course-roster-card-self/g) || [])).toHaveLength(2);
    const selfCardRule = cssSource.match(/(?:^|\n)\.edu-course-roster-card-self\s*\{([^}]*)\}/s)?.[1] || '';
    const darkSelfCardRule = cssSource.match(/\[data-theme="dark"\]\s+\.edu-course-roster-card-self\s*\{([^}]*)\}/s)?.[1] || '';
    expect(selfCardRule).toContain('background:');
    expect(selfCardRule).toContain('var(--accent-bg');
    expect(selfCardRule).toContain('var(--bg-card)');
    expect(selfCardRule).not.toMatch(/box-shadow|outline|border/);
    expect(darkSelfCardRule).toContain('background:');
    expect(darkSelfCardRule).toContain('var(--accent-bg)');
    expect(cssSource.indexOf('.edu-course-roster-card-self {'))
      .toBeGreaterThan(cssSource.indexOf('.edu-course-roster-card-unpaid {'));
    expect(cssSource.indexOf('[data-theme="dark"] .edu-course-roster-card-self {'))
      .toBeGreaterThan(cssSource.indexOf('[data-theme="dark"] .edu-course-roster-card-unpaid {'));
  });

  test('staff owned unpaid card stays above paid and unpaid sections without duplication', async () => {
    const { app, container } = loadCourseLessonsContext({
      isStaff: true,
      enrollments: [
        { id: 'enr-paid', studentId: 'paid-other', status: 'approved', paidAt: '2099-06-01' },
        { id: 'enr-owned', studentId: 'owned-unpaid', status: 'approved', paidAt: null },
        { id: 'enr-unpaid', studentId: 'other-unpaid', status: 'approved', paidAt: null },
      ],
      rosterPayload: {
        rosterPublic: true,
        session: { id: 'sessionA', title: 'Session A', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
        students: [
          { studentId: 'paid-other', displayName: 'Paid Other', attendanceKind: null, canSelfLeave: false },
          { studentId: 'owned-unpaid', displayName: 'Owned Unpaid', attendanceKind: null, canSelfLeave: true },
          { studentId: 'other-unpaid', displayName: 'Other Unpaid', attendanceKind: null, canSelfLeave: false },
        ],
      },
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    const html = container.innerHTML;
    const selfSection = html.indexOf('edu-course-roster-section-self');
    const mainSection = html.indexOf('edu-course-roster-section-main');
    const unpaidSection = html.indexOf('edu-course-roster-section-unpaid');
    expect(selfSection).toBeGreaterThanOrEqual(0);
    expect(selfSection).toBeLessThan(mainSection);
    expect(mainSection).toBeLessThan(unpaidSection);
    expect((html.match(/edu-course-roster-card-self/g) || [])).toHaveLength(1);
    expect(html.slice(unpaidSection)).not.toContain('Owned Unpaid');
    const ownedCardStart = html.indexOf('edu-course-roster-card-self');
    const ownedNameStart = html.indexOf('Owned Unpaid');
    expect(html.slice(ownedCardStart, ownedNameStart)).toContain('edu-course-roster-card-unpaid');
  });

  test('roster loading shell renders a stable back-to-lessons label', () => {
    const { app } = loadCourseLessonsContext();

    const html = app._renderCourseLessonRosterLoadingShell(
      { id: 'planA', name: 'Plan A' },
      { id: 'sessionA', title: 'Session A', date: '2099-06-02', startTime: '10:00', endTime: '11:30' },
      'loading',
    );

    expect(html).toContain('\u8fd4\u56de\u8ab2\u5802');
    expect(html).not.toContain('&#35406;');
  });

  test('names-first preview renders cached students before fresh roster resolves', async () => {
    let resolveFresh;
    const freshPromise = new Promise(resolve => { resolveFresh = resolve; });
    const sessions = [{
      id: 'sessionA',
      title: 'Cached Session',
      date: '2099-06-02',
      startTime: '10:00',
      endTime: '11:30',
      studentIds: ['stu1', 'stu2'],
      capacity: 6,
    }];
    const { app, container, firebase, localStorage } = loadCourseLessonsContext({
      sessions,
      courseSessionCache: { 'teamA:planA': sessions },
      courseEnrollCache: {
        'teamA:planA': [
          { id: 'enr1', studentId: 'stu1', studentName: 'Cached Alpha', status: 'approved' },
          { id: 'enr2', studentId: 'stu2', studentName: 'Cached Beta', status: 'approved' },
        ],
      },
    });
    firebase.listEduCoursePublicRoster.mockImplementationOnce(() => freshPromise);

    const loading = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length === 0) {
      await Promise.resolve();
    }
    await flushPromises();

    expect(container.innerHTML).toContain('Cached Alpha');
    expect(container.innerHTML).toContain('Cached Beta');
    expect(container.innerHTML).toContain('edu-course-roster-refresh-status');
    expect(container.innerHTML).toContain('edu-inline-spinner');
    expect(container.innerHTML).toContain('edu-course-roster-status-pending');
    expect(container.innerHTML).not.toContain('edu-course-roster-status-signin');
    expect(container.innerHTML).not.toContain('edu-roster-self-leave-btn');
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(app._eduCourseRosterPerfTimeline.map(entry => entry.stage)).toContain('names_first_preview');

    resolveFresh({
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'fresh-names-first', cacheTtlMs: 30000 },
      session: { id: 'sessionA', title: 'Fresh Session', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Fresh Alpha', attendanceKind: 'signin', canSelfLeave: true }],
    });
    await expect(loading).resolves.toMatchObject({ ok: true });

    expect(container.innerHTML).toContain('Fresh Alpha');
    expect(container.innerHTML).not.toContain('edu-course-roster-refresh-status');
    expect(container.innerHTML).toContain('edu-course-roster-status-signin');
    expect(container.innerHTML).toContain('edu-roster-self-leave-btn');
  });

  test('names-first preview keeps private and staff fields out of the temporary payload', async () => {
    let resolveFresh;
    const freshPromise = new Promise(resolve => { resolveFresh = resolve; });
    const sessions = [{
      id: 'sessionA',
      title: 'Cached Session',
      notes: 'private session note',
      date: '2099-06-02',
      startTime: '10:00',
      endTime: '11:30',
      studentIds: ['stu1'],
      students: [{
        id: 'stu1',
        displayName: 'Preview Sensitive',
        attendanceKind: 'signin',
        canSelfLeave: true,
        selfUid: 'uidA',
        parentUid: 'parentA',
        uid: 'profileA',
        lineUserId: 'lineA',
      }],
    }];
    const { app, container, firebase } = loadCourseLessonsContext({
      isStaff: true,
      sessions,
      courseSessionCache: { 'teamA:planA': sessions },
      courseEnrollCache: {
        'teamA:planA': [{ id: 'enr1', studentId: 'stu1', studentName: 'Preview Sensitive', status: 'approved', coachNotes: 'private coach note' }],
      },
    });
    firebase.listEduCoursePublicRoster.mockImplementationOnce(() => freshPromise);

    const loading = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length === 0) {
      await Promise.resolve();
    }
    await flushPromises();

    const previewPayload = app._eduCourseLessonsContext.rosterPayload;
    expect(previewPayload.cacheMeta.namesFirstPreview).toBe(true);
    expect(previewPayload.canManageRoster).toBe(false);
    expect(previewPayload.staffEnrollmentByStudentId).toBeNull();
    expect(previewPayload.session.notes).toBeUndefined();
    expect(previewPayload.students[0]).toMatchObject({ studentId: 'stu1', displayName: 'Preview Sensitive' });
    expect(previewPayload.students[0]).not.toHaveProperty('attendanceKind');
    expect(previewPayload.students[0]).not.toHaveProperty('canSelfLeave');
    expect(previewPayload.students[0]).not.toHaveProperty('selfUid');
    expect(previewPayload.students[0]).not.toHaveProperty('parentUid');
    expect(previewPayload.students[0]).not.toHaveProperty('uid');
    expect(previewPayload.students[0]).not.toHaveProperty('lineUserId');
    expect(container.innerHTML).not.toContain('private coach note');
    expect(container.innerHTML).not.toContain('App.startCourseLessonRosterManage()');

    resolveFresh({
      rosterPublic: true,
      canManageRoster: true,
      cacheMeta: { payloadVersion: 'fresh-staff', cacheTtlMs: 30000 },
      session: { id: 'sessionA', title: 'Fresh Session', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      staffEnrollmentByStudentId: { stu1: { enrollmentId: 'enr1', coachNotes: 'fresh coach note' } },
      students: [{ studentId: 'stu1', displayName: 'Fresh Sensitive', attendanceKind: 'signin' }],
    });
    await loading;
  });

  test('names-first preview is skipped when cached plan closes public roster visibility', async () => {
    let resolveFresh;
    const freshPromise = new Promise(resolve => { resolveFresh = resolve; });
    const plans = [{
      id: 'planA',
      name: 'Private Plan',
      planType: 'session',
      rosterPublic: false,
      startDate: '2099-06-01',
    }];
    const sessions = [{
      id: 'sessionA',
      title: 'Private Session',
      date: '2099-06-02',
      startTime: '10:00',
      endTime: '11:30',
      studentIds: ['stu1'],
    }];
    const { app, container, firebase } = loadCourseLessonsContext({
      plans,
      sessions,
      courseSessionCache: { 'teamA:planA': sessions },
      courseEnrollCache: { 'teamA:planA': [{ id: 'enr1', studentId: 'stu1', studentName: 'Hidden Student', status: 'approved' }] },
    });
    firebase.listEduCoursePublicRoster.mockImplementationOnce(() => freshPromise);

    const loading = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length === 0) {
      await Promise.resolve();
    }
    await flushPromises();

    expect(container.innerHTML).not.toContain('Hidden Student');
    expect(app._eduCourseRosterPerfTimeline.map(entry => entry.stage)).not.toContain('names_first_preview');

    resolveFresh({
      rosterPublic: false,
      session: { id: 'sessionA', title: 'Private Session', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [],
    });
    await loading;
  });

  test('names-first preview stays visible with retry when fresh roster fails', async () => {
    const sessions = [{
      id: 'sessionA',
      title: 'Cached Session',
      date: '2099-06-02',
      startTime: '10:00',
      endTime: '11:30',
      studentIds: ['stu1'],
    }];
    const { app, container, firebase } = loadCourseLessonsContext({
      sessions,
      courseSessionCache: { 'teamA:planA': sessions },
      courseEnrollCache: {
        'teamA:planA': [{ id: 'enr1', studentId: 'stu1', studentName: 'Cached Retry', status: 'approved' }],
      },
    });
    firebase.listEduCoursePublicRoster.mockRejectedValueOnce(new Error('network down'));

    await expect(app.showCourseLessonRoster('teamA', 'planA', 'sessionA')).resolves.toMatchObject({
      ok: false,
      reason: 'roster_failed',
      preview: true,
    });

    expect(container.innerHTML).toContain('Cached Retry');
    expect(container.innerHTML).toContain('edu-course-roster-refresh-alert');
    expect(container.innerHTML).not.toContain('edu-course-roster-refresh-status');
    expect(container.innerHTML).toContain('{forceRefresh:true}');
    expect(container.innerHTML).not.toContain('&#21517;&#21934;&#36617;&#20837;&#22833;&#25943;');
  });

  test('renders cached roster preview first and refreshes attendance in background', async () => {
    let resolveRefresh;
    const refreshPromise = new Promise(resolve => { resolveRefresh = resolve; });
    const cachedPayload = {
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'v1', cacheTtlMs: 30000 },
      session: { id: 'sessionA', title: 'Cached', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Cached Student', level: '1', attendanceKind: 'leave', canSelfLeave: true, selfUid: 'uidA' }],
    };
    const freshPayload = {
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'v1', cacheTtlMs: 30000 },
      session: { id: 'sessionA', title: 'Fresh', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Fresh Student', level: '1', attendanceKind: 'signin', canSelfLeave: true, selfUid: 'uidA' }],
    };
    const { app, container, firebase } = loadCourseLessonsContext({ rosterPayload: cachedPayload });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    expect(container.innerHTML).toContain('Cached Student');

    firebase.listEduCoursePublicRoster.mockImplementationOnce(() => refreshPromise);
    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    expect(container.innerHTML).toContain('Cached Student');
    expect(container.innerHTML).toContain('edu-course-roster-refresh-status');
    expect(container.innerHTML).toContain('edu-inline-spinner');
    expect(container.innerHTML).toContain('edu-course-roster-status-leave');
    expect(container.innerHTML).not.toContain('edu-course-roster-status-pending');
    expect(container.innerHTML).not.toContain('edu-roster-self-leave-btn');
    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(2);
    expect(app._eduCourseRosterPerfTimeline.map(entry => entry.stage)).toEqual(
      expect.arrayContaining(['start', 'skeleton', 'cache_preview']),
    );

    resolveRefresh(freshPayload);
    await flushPromises();

    expect(container.innerHTML).toContain('Fresh Student');
    expect(container.innerHTML).not.toContain('edu-course-roster-refresh-status');
    expect(container.innerHTML).toContain('edu-course-roster-status-signin');
    expect(container.innerHTML).toContain('edu-roster-self-leave-btn');
    expect(app._eduCourseRosterPerfTimeline.map(entry => entry.stage)).toContain('fresh_overlay');
  });

  test('staff roster paints cached public preview before fresh staff fields arrive', async () => {
    let resolveRefresh;
    const refreshPromise = new Promise(resolve => { resolveRefresh = resolve; });
    const cachedPayload = {
      rosterPublic: true,
      canManageRoster: true,
      cacheMeta: { payloadVersion: 'staff-v1', cacheTtlMs: 15000 },
      session: { id: 'sessionA', title: 'Cached Staff', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      staffEnrollmentByStudentId: { stu1: { jerseyNumber: '7', position: 'ST', coachNotes: 'old private note' } },
      students: [{ studentId: 'stu1', displayName: 'Cached Staff Student', level: '1', attendanceKind: null }],
    };
    const freshPayload = {
      rosterPublic: true,
      canManageRoster: true,
      cacheMeta: { payloadVersion: 'staff-v1', cacheTtlMs: 15000 },
      session: { id: 'sessionA', title: 'Fresh Staff', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      staffEnrollmentByStudentId: { stu1: { jerseyNumber: '8', position: 'MF', coachNotes: 'fresh private note' } },
      students: [{ studentId: 'stu1', displayName: 'Fresh Staff Student', level: '1', attendanceKind: 'signin' }],
    };
    const { app, container, firebase } = loadCourseLessonsContext({
      isStaff: true,
      rosterPayload: cachedPayload,
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    expect(container.innerHTML).toContain('Cached Staff Student');

    firebase.listEduCoursePublicRoster.mockImplementationOnce(() => refreshPromise);
    const secondLoad = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length < 2) {
      await Promise.resolve();
    }

    await expect(secondLoad).resolves.toMatchObject({ ok: true, cached: true });
    expect(container.innerHTML).toContain('Cached Staff Student');
    expect(container.innerHTML).toContain('edu-course-roster-status-none');
    expect(container.innerHTML).not.toContain('edu-course-roster-status-signin');
    expect(container.innerHTML).toContain('old private note');
    expect(container.innerHTML).not.toContain('App.startCourseLessonRosterManage()');
    expect(container.innerHTML).not.toContain('App.editCourseSessionRosterNote');

    resolveRefresh(freshPayload);
    await flushPromises();

    expect(container.innerHTML).toContain('Fresh Staff Student');
    expect(container.innerHTML).toContain('fresh private note');
    expect(container.innerHTML).toContain('App.startCourseLessonRosterManage()');
  });

  test('keeps stale staff roster read only when background refresh fails', async () => {
    const cachedPayload = {
      rosterPublic: true,
      canManageRoster: true,
      cacheMeta: { payloadVersion: 'staff-fail-v1', cacheTtlMs: 15000 },
      session: { id: 'sessionA', title: 'Cached Staff', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      staffEnrollmentByStudentId: { stu1: { jerseyNumber: '7', position: 'ST', coachNotes: 'old private note' } },
      students: [{ studentId: 'stu1', displayName: 'Cached Staff Student', level: '1', attendanceKind: null }],
    };
    const { app, container, firebase } = loadCourseLessonsContext({
      isStaff: true,
      rosterPayload: cachedPayload,
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    firebase.listEduCoursePublicRoster.mockRejectedValueOnce(new Error('network down'));

    await expect(app.showCourseLessonRoster('teamA', 'planA', 'sessionA')).resolves.toMatchObject({ ok: true, cached: true });
    await flushPromises();

    expect(container.innerHTML).toContain('Cached Staff Student');
    expect(container.innerHTML).toContain('old private note');
    expect(container.innerHTML).toContain('edu-course-roster-refresh-alert');
    expect(container.innerHTML).not.toContain('edu-course-roster-refresh-status');
    expect(container.innerHTML).not.toContain('App.startCourseLessonRosterManage()');
    expect(container.innerHTML).not.toContain('App.editCourseSessionRosterNote');
    expect(container.innerHTML).toContain('返回課堂');
    expect(container.innerHTML).not.toContain('App.showCourseLessons');
    expect(app._eduCourseLessonsContext.staleCached).toBe(true);
  });

  test('keeps roster preview back action disabled while background refresh is pending', async () => {
    let resolveRefresh;
    const refreshPromise = new Promise(resolve => { resolveRefresh = resolve; });
    const { app, container, firebase } = loadCourseLessonsContext({
      isStaff: true,
      rosterPayload: {
        rosterPublic: true,
        canManageRoster: true,
        cacheMeta: { payloadVersion: 'preview-v1', cacheTtlMs: 15000 },
        session: { id: 'sessionA', title: 'Preview Session', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
        students: [{ studentId: 'stu1', displayName: 'Preview Student', level: '1', attendanceKind: null }],
      },
    });

    firebase.listEduCoursePublicRoster.mockImplementationOnce(() => refreshPromise);
    const loadPromise = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length < 1) {
      await Promise.resolve();
    }

    expect(container.innerHTML).toContain('返回課堂');
    expect(container.innerHTML).not.toContain('App.showCourseLessons');

    resolveRefresh({
      rosterPublic: true,
      canManageRoster: true,
      cacheMeta: { payloadVersion: 'preview-v2', cacheTtlMs: 15000 },
      session: { id: 'sessionA', title: 'Fresh Session', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Fresh Student', level: '1', attendanceKind: null }],
    });
    await loadPromise;
    await flushPromises();

    expect(container.innerHTML).toContain('App.showCourseLessons');
  });

  test('persistent roster preview stores only sanitized public fields', async () => {
    const { app, localStorageStore } = loadCourseLessonsContext({
      authUid: 'viewerA',
      isStaff: true,
      rosterPayload: {
        rosterPublic: true,
        canManageRoster: true,
        cacheMeta: { payloadVersion: 'sensitive-v1', cacheTtlMs: 15000 },
        session: {
          id: 'sessionA',
          title: 'Private Session',
          date: '2099-06-02',
          startTime: '10:00',
          endTime: '11:30',
          status: 'scheduled',
          notes: 'staff only session notes',
        },
        staffEnrollmentByStudentId: { stu1: { coachNotes: 'private note', enrollmentId: 'enr1' } },
        students: [{
          studentId: 'stu1',
          displayName: 'Sensitive Student',
          level: '2',
          attendanceKind: 'signin',
          canSelfLeave: true,
          selfUid: 'uidA',
          parentUid: 'parentA',
          uid: 'profileA',
          lineUserId: 'lineA',
          position: 'ST',
        }],
      },
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    const storeKey = app._getCourseLessonRosterPersistentStorageKey('viewerA');
    const saved = JSON.parse(localStorageStore[storeKey]);
    const entry = Object.values(saved.entries)[0];

    expect(entry.payload.cacheMeta.persistentPreview).toBe(true);
    expect(entry.payload.canManageRoster).toBe(false);
    expect(entry.payload.staffEnrollmentByStudentId).toBeNull();
    expect(entry.payload.session.notes).toBeUndefined();
    expect(entry.payload.students[0]).toMatchObject({
      studentId: 'stu1',
      displayName: 'Sensitive Student',
      level: '2',
      position: 'ST',
    });
    expect(entry.payload.students[0]).not.toHaveProperty('attendanceKind');
    expect(entry.payload.students[0]).not.toHaveProperty('canSelfLeave');
    expect(entry.payload.students[0]).not.toHaveProperty('selfUid');
    expect(entry.payload.students[0]).not.toHaveProperty('parentUid');
    expect(entry.payload.students[0]).not.toHaveProperty('uid');
    expect(entry.payload.students[0]).not.toHaveProperty('lineUserId');
  });

  test('persistent roster preview renders first and same-version fresh payload still overlays it', async () => {
    let resolveRefresh;
    const refreshPromise = new Promise(resolve => { resolveRefresh = resolve; });
    const { app, container, firebase } = loadCourseLessonsContext({ authUid: 'viewerA' });
    app._rememberCourseLessonRosterPersistentPreviewPayload('teamA', 'planA', 'sessionA', {
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'same-version' },
      session: { id: 'sessionA', title: 'Persistent Cached', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Persistent Cached Student', attendanceKind: 'leave', canSelfLeave: true, selfUid: 'uidA' }],
    }, 'viewerA');
    firebase.listEduCoursePublicRoster.mockImplementationOnce(() => refreshPromise);

    await expect(app.showCourseLessonRoster('teamA', 'planA', 'sessionA')).resolves.toMatchObject({ ok: true, cached: true });

    expect(container.innerHTML).toContain('Persistent Cached Student');
    expect(container.innerHTML).toContain('edu-course-roster-status-pending');
    expect(container.innerHTML).not.toContain('edu-roster-self-leave-btn');

    resolveRefresh({
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'same-version' },
      session: { id: 'sessionA', title: 'Fresh Same Version', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Fresh Same Version Student', attendanceKind: 'signin', canSelfLeave: true, selfUid: 'uidA' }],
    });
    await flushPromises();

    expect(container.innerHTML).toContain('Fresh Same Version Student');
    expect(container.innerHTML).toContain('edu-course-roster-status-signin');
    expect(container.innerHTML).toContain('edu-roster-self-leave-btn');
  });

  test('persistent roster preview is viewer scoped and not read through staff scope', async () => {
    const localStorageStore = {};
    const first = loadCourseLessonsContext({ authUid: 'viewerA', localStorageStore });
    first.app._rememberCourseLessonRosterPersistentPreviewPayload('teamA', 'planA', 'sessionA', {
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'viewer-a' },
      session: { id: 'sessionA', title: 'Viewer A Cached', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Viewer A Cached Student' }],
    }, 'viewerA');

    const second = loadCourseLessonsContext({
      authUid: 'viewerB',
      localStorageStore,
      rosterPayload: {
        rosterPublic: true,
        cacheMeta: { payloadVersion: 'viewer-b' },
        session: { id: 'sessionA', title: 'Viewer B Fresh', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
        students: [{ studentId: 'stu1', displayName: 'Viewer B Fresh Student' }],
      },
    });

    expect(second.app._getCourseLessonRosterPersistentCachedPayload('teamA', 'planA', 'sessionA', 'staff', 'viewerA')).toBeNull();
    await second.app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    expect(second.container.innerHTML).toContain('Viewer B Fresh Student');
    expect(second.container.innerHTML).not.toContain('Viewer A Cached Student');
  });

  test('persistent roster preview write failure does not block fresh roster rendering', async () => {
    const localStorage = {
      getItem: jest.fn(() => null),
      setItem: jest.fn(() => { throw new Error('quota exceeded'); }),
      removeItem: jest.fn(),
    };
    const { app, container } = loadCourseLessonsContext({ authUid: 'viewerA', localStorage });

    await expect(app.showCourseLessonRoster('teamA', 'planA', 'sessionA')).resolves.toMatchObject({ ok: true });

    expect(localStorage.setItem).toHaveBeenCalled();
    expect(container.innerHTML).toContain('edu-course-roster-card');
  });

  test('server roster permission denial overrides stale local staff state', async () => {
    const loadCourseEnrollments = jest.fn(async () => [{
      id: 'enr1',
      studentId: 'stu1',
      status: 'approved',
      paidAt: null,
      coachNotes: 'cached private note',
    }]);
    const { app, container } = loadCourseLessonsContext({
      isStaff: true,
      loadCourseEnrollments,
      rosterPayload: {
        rosterPublic: true,
        canManageRoster: false,
        cacheMeta: { payloadVersion: 'public-after-revoke', cacheTtlMs: 30000 },
        session: { id: 'sessionA', title: 'Public', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
        students: [{ studentId: 'stu1', displayName: 'Public Student', level: '1', attendanceKind: null }],
      },
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    expect(loadCourseEnrollments).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain('Public Student');
    expect(container.innerHTML).not.toContain('cached private note');
    expect(container.innerHTML).not.toContain('管理名單');
    expect(container.innerHTML).not.toContain('未繳費區');
  });

  test('background roster refresh does not rerender while manage mode is active', async () => {
    const { app, container, firebase } = loadCourseLessonsContext({
      rosterPayload: {
        rosterPublic: true,
        cacheMeta: { payloadVersion: 'v1', cacheTtlMs: 30000 },
        session: { id: 'sessionA', title: 'Cached', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
        students: [{ studentId: 'stu1', displayName: 'Cached Student', level: '1', attendanceKind: null }],
      },
    });
    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    app._eduCourseLessonsContext.manageMode = true;
    app._eduCourseLessonsContext.refreshPending = true;
    const pendingStatus = { remove: jest.fn() };
    container.querySelector = jest.fn((selector) => (
      selector === '.edu-course-roster-refresh-status' ? pendingStatus : null
    ));
    const applySpy = jest.spyOn(app, '_applyCourseLessonRosterPayload');
    firebase.listEduCoursePublicRoster.mockResolvedValueOnce({
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'v2', cacheTtlMs: 30000 },
      session: { id: 'sessionA', title: 'Fresh', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Fresh Student', level: '1', attendanceKind: 'signin' }],
    });

    const result = await app._refreshCourseLessonRosterInBackground(
      app._eduCourseLessonsRequestSeq,
      'teamA',
      'planA',
      'sessionA',
      app._findEduCoursePlan('teamA', 'planA'),
      false,
      'v1',
    );

    expect(result).toMatchObject({ ok: true, deferred: true });
    expect(applySpy).not.toHaveBeenCalled();
    expect(app._eduCourseLessonsContext.refreshPending).toBe(false);
    expect(container.querySelector).toHaveBeenCalledWith('.edu-course-roster-refresh-status');
    expect(pendingStatus.remove).toHaveBeenCalled();
  });

  test('roster invalidation forces the next load past local and server snapshots', async () => {
    const cachedPayload = {
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'v1', cacheTtlMs: 30000 },
      session: { id: 'sessionA', title: 'Cached', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Cached Student', level: '1', attendanceKind: null }],
    };
    const freshPayload = {
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'v2', cacheTtlMs: 30000 },
      session: { id: 'sessionA', title: 'Fresh', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Fresh Student', level: '1', attendanceKind: 'signin' }],
    };
    const { app, container, firebase } = loadCourseLessonsContext({ rosterPayload: cachedPayload });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    expect(container.innerHTML).toContain('Cached Student');

    firebase.listEduCoursePublicRoster.mockResolvedValueOnce(freshPayload);
    app._markCourseLessonRosterRefreshNeeded('teamA', 'planA');
    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    expect(firebase.listEduCoursePublicRoster).toHaveBeenLastCalledWith(
      'teamA',
      'planA',
      'sessionA',
      { forceRefresh: true },
    );
    expect(container.innerHTML).toContain('Fresh Student');
  });

  test('real BFCache pageshow recovers the same roster with the new transition owner', async () => {
    const staleRoster = deferred();
    const { app, container, firebase } = loadCourseLessonsContext();
    firebase.listEduCoursePublicRoster
      .mockImplementationOnce(() => staleRoster.promise)
      .mockResolvedValueOnce(createRosterPayload('Recovered Roster Student', 'bfcache-recovery'));

    const load = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length === 0) {
      await Promise.resolve();
    }
    expect(container.innerHTML).toMatch(/edu-course-(?:lessons-loading|roster-shell-loading)/);
    expect(app.showPage).toHaveBeenCalledTimes(1);

    const pageshowHandler = extractPageshowHandler(app, {
      querySelector: jest.fn(() => ({ id: 'page-edu-course-lessons' })),
    });
    pageshowHandler({ persisted: true });
    expect(app._claimPageTransition).toHaveBeenCalledWith('page-edu-course-lessons');

    await flushPromises(24);
    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(2);
    expect(firebase.listEduCoursePublicRoster).toHaveBeenLastCalledWith('teamA', 'planA', 'sessionA');
    expect(app.showPage).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toContain('Recovered Roster Student');
    expect(container.innerHTML).not.toContain('edu-course-roster-refresh-status');

    staleRoster.resolve(createRosterPayload('Should Not Render From Stale Transition', 'stale-bfcache'));
    await expect(load).resolves.toMatchObject({ ok: false, reason: 'stale_transition' });
    await flushPromises();

    expect(container.innerHTML).toContain('Recovered Roster Student');
    expect(container.innerHTML).not.toContain('Should Not Render From Stale Transition');
    expect(container.innerHTML).not.toContain('edu-course-lessons-loading');
    expect(container.innerHTML).not.toContain('edu-course-roster-shell-loading');
    expect(container.innerHTML).not.toContain('&#21517;&#21934;&#36617;&#20837;&#22833;&#25943;');
  });

  test('orphaned same-roster load recovers under the current active transition without pageshow', async () => {
    const staleRoster = deferred();
    const { app, container, firebase } = loadCourseLessonsContext();
    firebase.listEduCoursePublicRoster
      .mockImplementationOnce(() => staleRoster.promise)
      .mockResolvedValueOnce(createRosterPayload('Recovered Cold Route Student', 'cold-route-recovery'));

    const load = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length === 0) {
      await Promise.resolve();
    }
    expect(container.innerHTML).toMatch(/edu-course-(?:lessons-loading|roster-shell-loading)/);

    app._pageTransitionSeq = 2;
    app._activePageTransitionSeq = 2;
    app._userIntendedPage = 'page-edu-course-lessons';
    staleRoster.resolve(createRosterPayload('Stale Cold Route Student', 'stale-cold-route'));

    await expect(load).resolves.toMatchObject({ ok: false, reason: 'stale_transition' });
    await flushPromises(30);

    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toContain('Recovered Cold Route Student');
    expect(container.innerHTML).not.toContain('Stale Cold Route Student');
    expect(container.innerHTML).not.toContain('&#21517;&#21934;&#36617;&#20837;&#22833;&#25943;');
  });

  test('orphaned roster adopts the latest same-page transition before activation', async () => {
    const staleRoster = deferred();
    const { app, container, firebase } = loadCourseLessonsContext();
    firebase.listEduCoursePublicRoster
      .mockImplementationOnce(() => staleRoster.promise)
      .mockResolvedValueOnce(createRosterPayload('Recovered Pending Transition Student', 'pending-recovery'));

    const load = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length === 0) {
      await Promise.resolve();
    }
    expect(app._activePageTransitionSeq).toBe(1);
    expect(app._claimPageTransition).toHaveBeenCalledTimes(1);

    app._pageTransitionSeq = 2;
    app._userIntendedPage = 'page-edu-course-lessons';
    staleRoster.resolve(createRosterPayload('Stale Pending Transition Student', 'stale-pending'));

    await expect(load).resolves.toMatchObject({ ok: false, reason: 'stale_transition' });
    await flushPromises(30);

    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(2);
    expect(app._claimPageTransition).toHaveBeenCalledTimes(1);
    expect(app.showPage).toHaveBeenCalledTimes(1);
    expect(app._activePageTransitionSeq).toBe(1);
    expect(container.innerHTML).toContain('Recovered Pending Transition Student');
    expect(container.innerHTML).not.toContain('Stale Pending Transition Student');
    expect(container.innerHTML).not.toContain('&#21517;&#21934;&#36617;&#20837;&#22833;&#25943;');
  });

  test.each([
    [
      'a lesson list context',
      (app) => {
        app._eduCourseLessonsContext = {
          teamId: 'teamA',
          planId: 'planA',
          mode: 'list',
        };
      },
    ],
    [
      'a newer different-roster request owner',
      (app) => {
        app._eduCourseLessonsRequestSeq = 2;
        app._eduCourseLessonsContext = {
          teamId: 'teamA',
          planId: 'planA',
          sessionId: 'sessionB',
          mode: 'roster',
        };
      },
    ],
    [
      'a different-page intent',
      (app) => {
        app._userIntendedPage = 'page-home';
      },
    ],
  ])('pending roster recovery ignores %s without claiming navigation', async (_label, arrange) => {
    const { app, container, firebase } = loadCourseLessonsContext();
    app.currentPage = 'page-edu-course-lessons';
    app._userIntendedPage = 'page-edu-course-lessons';
    app._pageTransitionSeq = 2;
    app._activePageTransitionSeq = 1;
    app._eduCourseLessonsRequestSeq = 1;
    app._eduCourseLessonsContext = {
      teamId: 'teamA',
      planId: 'planA',
      sessionId: 'sessionA',
      mode: 'roster',
    };
    container.innerHTML = '<div class="edu-course-lessons-loading">Loading</div>';
    arrange(app);

    expect(app._tryResumeCourseLessonRosterForCurrentTransition(1, 1, 'pending-negative')).toBe(false);
    await flushPromises(12);

    expect(firebase.listEduCoursePublicRoster).not.toHaveBeenCalled();
    expect(app._claimPageTransition).not.toHaveBeenCalled();
    expect(app.showPage).not.toHaveBeenCalled();
  });

  test('same-roster transition recovery stops writing after the user leaves the roster', async () => {
    const staleRoster = deferred();
    const recoveredRoster = deferred();
    const { app, container, firebase } = loadCourseLessonsContext();
    firebase.listEduCoursePublicRoster
      .mockImplementationOnce(() => staleRoster.promise)
      .mockImplementationOnce(() => recoveredRoster.promise);

    const load = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length === 0) {
      await Promise.resolve();
    }

    app._pageTransitionSeq = 2;
    app._activePageTransitionSeq = 2;
    app._userIntendedPage = 'page-edu-course-lessons';
    staleRoster.resolve(createRosterPayload('Stale Before Leave Student', 'stale-before-leave'));

    await expect(load).resolves.toMatchObject({ ok: false, reason: 'stale_transition' });
    while (firebase.listEduCoursePublicRoster.mock.calls.length < 2) {
      await Promise.resolve();
    }

    app.currentPage = 'page-home';
    app._userIntendedPage = 'page-home';
    app._pageTransitionSeq = 3;
    app._activePageTransitionSeq = 3;
    container.innerHTML = '<div id="home-after-roster">Home</div>';
    recoveredRoster.resolve(createRosterPayload('Recovered After Leave Student', 'recovered-after-leave'));
    await flushPromises(30);

    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toContain('home-after-roster');
    expect(container.innerHTML).not.toContain('Stale Before Leave Student');
    expect(container.innerHTML).not.toContain('Recovered After Leave Student');
    expect(container.innerHTML).not.toContain('&#21517;&#21934;&#36617;&#20837;&#22833;&#25943;');
  });

  test('real BFCache pageshow isolates a rejected roster recovery hook', async () => {
    const { app } = loadCourseLessonsContext();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    app.currentPage = 'page-edu-course-lessons';
    app._resumeCourseLessonRosterAfterBFCache = jest.fn(() => Promise.reject(new Error('recovery failed')));

    try {
      const pageshowHandler = extractPageshowHandler(app, {
        querySelector: jest.fn(() => ({ id: 'page-edu-course-lessons' })),
      });
      pageshowHandler({ persisted: true });
      await flushPromises(12);

      expect(app._resumeCourseLessonRosterAfterBFCache).toHaveBeenCalledWith(1);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test.each([
    [
      'newer different-page',
      'page-home',
      {
        teamId: 'teamA',
        planId: 'planA',
        sessionId: 'sessionA',
        mode: 'roster',
      },
    ],
    [
      'same-page lesson list',
      'page-edu-course-lessons',
      {
        teamId: 'teamA',
        planId: 'planA',
        mode: 'list',
      },
    ],
    [
      'same-page different lesson roster',
      'page-edu-course-lessons',
      {
        teamId: 'teamA',
        planId: 'planA',
        sessionId: 'sessionB',
        mode: 'roster',
      },
    ],
    [
      'same-page same lesson roster',
      'page-edu-course-lessons',
      {
        teamId: 'teamA',
        planId: 'planA',
        sessionId: 'sessionA',
        mode: 'roster',
      },
    ],
  ])('real BFCache pageshow preserves a pending %s transition', async (
    _label,
    intendedPage,
    pendingContext,
  ) => {
    const { app, container, firebase } = loadCourseLessonsContext();
    app.currentPage = 'page-edu-course-lessons';
    app._userIntendedPage = intendedPage;
    app._pageTransitionSeq = 9;
    app._activePageTransitionSeq = 8;
    app._eduCourseLessonsContext = { ...pendingContext };
    container.innerHTML = '<div class="edu-course-lessons-loading">Loading</div>';
    const resumeSpy = jest.spyOn(app, '_resumeCourseLessonRosterAfterBFCache');
    const pageshowHandler = extractPageshowHandler(app, {
      querySelector: jest.fn(() => ({ id: 'page-edu-course-lessons' })),
    });

    pageshowHandler({ persisted: true });
    await flushPromises(12);

    expect(app._claimPageTransition).not.toHaveBeenCalled();
    expect(resumeSpy).not.toHaveBeenCalled();
    expect(app._pageTransitionSeq).toBe(9);
    expect(app._activePageTransitionSeq).toBe(8);
    expect(app._userIntendedPage).toBe(intendedPage);
    expect(app._eduCourseLessonsContext).toEqual(pendingContext);
    expect(firebase.listEduCoursePublicRoster).not.toHaveBeenCalled();
  });

  test('BFCache roster recovery ignores terminal, error, non-roster, and superseded states', async () => {
    const { app, container, firebase } = loadCourseLessonsContext();
    app.currentPage = 'page-edu-course-lessons';
    app._userIntendedPage = 'page-edu-course-lessons';
    app._pageTransitionSeq = 7;
    app._activePageTransitionSeq = 7;
    app._eduCourseLessonsContext = {
      teamId: 'teamA',
      planId: 'planA',
      sessionId: 'sessionA',
      mode: 'roster',
      refreshPending: false,
    };

    container.innerHTML = '<div class="edu-course-roster-shell">Finished roster</div>';
    await Promise.resolve(app._resumeCourseLessonRosterAfterBFCache(7));

    app._eduCourseLessonsContext.refreshPending = true;
    app._eduCourseLessonsContext.refreshError = true;
    container.innerHTML = '<div class="edu-course-roster-refresh-status">Failed refresh</div>';
    await Promise.resolve(app._resumeCourseLessonRosterAfterBFCache(7));

    app._eduCourseLessonsContext.refreshError = false;
    app._eduCourseLessonsContext.mode = 'list';
    container.innerHTML = '<div class="edu-course-lessons-loading">Loading</div>';
    await Promise.resolve(app._resumeCourseLessonRosterAfterBFCache(7));

    app._eduCourseLessonsContext.mode = 'roster';
    app.currentPage = 'page-home';
    container.innerHTML = '<div class="edu-course-lessons-loading">Loading</div>';
    await Promise.resolve(app._resumeCourseLessonRosterAfterBFCache(7));

    app.currentPage = 'page-edu-course-lessons';
    app._pageTransitionSeq = 8;
    await Promise.resolve(app._resumeCourseLessonRosterAfterBFCache(7));

    expect(firebase.listEduCoursePublicRoster).not.toHaveBeenCalled();
    expect(app.showPage).not.toHaveBeenCalled();
  });

  test('BFCache roster recovery deduplicates the same restore transition', async () => {
    const roster = deferred();
    const { app, container, firebase } = loadCourseLessonsContext();
    app.currentPage = 'page-edu-course-lessons';
    app._userIntendedPage = 'page-edu-course-lessons';
    app._pageTransitionSeq = 12;
    app._activePageTransitionSeq = 12;
    app._eduCourseLessonsContext = {
      teamId: 'teamA',
      planId: 'planA',
      sessionId: 'sessionA',
      mode: 'roster',
    };
    container.innerHTML = '<div class="edu-course-lessons-loading">Loading</div>';
    firebase.listEduCoursePublicRoster.mockImplementationOnce(() => roster.promise);

    const first = app._resumeCourseLessonRosterAfterBFCache(12);
    const duplicate = app._resumeCourseLessonRosterAfterBFCache(12);
    await flushPromises(12);

    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(1);
    expect(app.showPage).not.toHaveBeenCalled();

    roster.resolve(createRosterPayload('Deduplicated Recovery Student', 'deduplicated-recovery'));
    await Promise.all([Promise.resolve(first), Promise.resolve(duplicate)]);

    expect(container.innerHTML).toContain('Deduplicated Recovery Student');
  });

  test('BFCache roster recovery resumes a pending names-first preview', async () => {
    const staleRoster = deferred();
    const { app, container, firebase } = loadCourseLessonsContext({
      eduStudentsCache: {
        teamA: [
          { id: 'stu1', displayName: 'Preview Student One' },
          { id: 'stu2', displayName: 'Preview Student Two' },
        ],
      },
    });
    firebase.listEduCoursePublicRoster
      .mockImplementationOnce(() => staleRoster.promise)
      .mockResolvedValueOnce(createRosterPayload('Fresh Names First Student', 'names-first-recovery'));

    const load = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    await flushPromises(20);

    expect(container.innerHTML).toContain('Preview Student One');
    expect(container.innerHTML).toContain('edu-course-roster-refresh-status');
    expect(app._eduCourseLessonsContext.refreshPending).toBe(true);

    const pageshowHandler = extractPageshowHandler(app, {
      querySelector: jest.fn(() => ({ id: 'page-edu-course-lessons' })),
    });
    pageshowHandler({ persisted: true });
    await flushPromises(30);

    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(2);
    expect(app.showPage).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toContain('Fresh Names First Student');
    expect(container.innerHTML).not.toContain('edu-course-roster-refresh-status');
    expect(container.innerHTML).toContain('App.showCourseLessons');

    staleRoster.resolve(createRosterPayload('Stale Names First Student', 'stale-names-first'));
    await expect(load).resolves.toMatchObject({ ok: false, reason: 'stale_transition' });
    await flushPromises();

    expect(container.innerHTML).toContain('Fresh Names First Student');
    expect(container.innerHTML).not.toContain('Stale Names First Student');
  });

  test('orphaned names-first preview recovers under the current roster transition without pageshow', async () => {
    const staleRoster = deferred();
    const { app, container, firebase } = loadCourseLessonsContext({
      eduStudentsCache: {
        teamA: [
          { id: 'stu1', displayName: 'Cold Preview Student One' },
          { id: 'stu2', displayName: 'Cold Preview Student Two' },
        ],
      },
    });
    firebase.listEduCoursePublicRoster
      .mockImplementationOnce(() => staleRoster.promise)
      .mockResolvedValueOnce(createRosterPayload('Fresh Cold Names Student', 'fresh-cold-names'));

    const load = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    await flushPromises(20);

    expect(container.innerHTML).toContain('Cold Preview Student One');
    expect(container.innerHTML).toContain('edu-course-roster-refresh-status');
    expect(app._eduCourseLessonsContext.refreshPending).toBe(true);

    app._pageTransitionSeq = 2;
    app._activePageTransitionSeq = 2;
    app._userIntendedPage = 'page-edu-course-lessons';
    staleRoster.resolve(createRosterPayload('Stale Cold Names Student', 'stale-cold-names'));

    await expect(load).resolves.toMatchObject({ ok: false, reason: 'stale_transition' });
    await flushPromises(30);

    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(2);
    expect(app.showPage).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toContain('Fresh Cold Names Student');
    expect(container.innerHTML).not.toContain('Stale Cold Names Student');
    expect(container.innerHTML).not.toContain('edu-course-roster-refresh-status');
  });

  test('BFCache roster recovery replaces a stale cached background refresh owner', async () => {
    const staleRefresh = deferred();
    const { app, container, firebase } = loadCourseLessonsContext({
      rosterPayload: createRosterPayload('Cached Preview Student', 'cached-preview'),
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    firebase.listEduCoursePublicRoster
      .mockImplementationOnce(() => staleRefresh.promise)
      .mockResolvedValueOnce(createRosterPayload('Fresh Cached Recovery Student', 'cached-recovery'));

    await expect(app.showCourseLessonRoster('teamA', 'planA', 'sessionA')).resolves.toMatchObject({
      ok: true,
      cached: true,
    });
    expect(container.innerHTML).toContain('Cached Preview Student');
    expect(container.innerHTML).toContain('edu-course-roster-refresh-status');
    expect(app._eduCourseLessonsContext.refreshPending).toBe(true);
    expect(app.showPage).toHaveBeenCalledTimes(2);

    const pageshowHandler = extractPageshowHandler(app, {
      querySelector: jest.fn(() => ({ id: 'page-edu-course-lessons' })),
    });
    pageshowHandler({ persisted: true });
    await flushPromises(30);

    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(3);
    expect(app.showPage).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toContain('Fresh Cached Recovery Student');
    expect(container.innerHTML).not.toContain('edu-course-roster-refresh-status');
    expect(container.innerHTML).toContain('App.showCourseLessons');

    staleRefresh.resolve(createRosterPayload('Stale Background Student', 'stale-background'));
    await flushPromises(20);

    expect(container.innerHTML).toContain('Fresh Cached Recovery Student');
    expect(container.innerHTML).not.toContain('Stale Background Student');
  });

  test('orphaned cached refresh recovers under the current roster transition without pageshow', async () => {
    const staleRefresh = deferred();
    const { app, container, firebase } = loadCourseLessonsContext({
      rosterPayload: createRosterPayload('Cached Cold Route Student', 'cached-cold-route'),
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    firebase.listEduCoursePublicRoster
      .mockImplementationOnce(() => staleRefresh.promise)
      .mockResolvedValueOnce(createRosterPayload('Fresh Cold Route Preview Student', 'fresh-cold-preview'));

    await expect(app.showCourseLessonRoster('teamA', 'planA', 'sessionA')).resolves.toMatchObject({
      ok: true,
      cached: true,
    });
    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toContain('Cached Cold Route Student');
    expect(container.innerHTML).toContain('edu-course-roster-refresh-status');

    app._pageTransitionSeq = 2;
    app._activePageTransitionSeq = 2;
    app._userIntendedPage = 'page-edu-course-lessons';
    staleRefresh.resolve(createRosterPayload('Stale Cold Route Preview Student', 'stale-cold-preview'));
    await flushPromises(30);

    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(3);
    expect(app.showPage).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toContain('Fresh Cold Route Preview Student');
    expect(container.innerHTML).not.toContain('Stale Cold Route Preview Student');
    expect(container.innerHTML).not.toContain('edu-course-roster-refresh-status');
  });

  test('canonical course lesson intent reaches the real roster controller and DOM', async () => {
    const replaceState = jest.fn();
    const pathname = '/teams/teamA/courses/planA/lessons/sessionA';
    const { app, container, context, firebase } = loadCourseLessonsContext({
      window: {
        location: {
          href: 'https://toosterx.com' + pathname + '?courseTab=active',
          pathname,
          hostname: 'toosterx.com',
        },
        history: {
          state: { source: 'sportshub', pageId: 'page-team-detail', id: 'teamA' },
          replaceState,
        },
      },
    });
    context.setTimeout = (fn) => {
      fn();
      return 0;
    };
    app.currentPage = 'page-team-detail';
    app._userIntendedPage = 'page-team-detail';
    app._teamDetailId = 'teamA';
    app._pageTransitionSeq = 9;
    app._activePageTransitionSeq = 9;
    app._buildRouteStateForCurrentPage = jest.fn(() => ({
      source: 'sportshub',
      pageId: 'page-team-detail',
      id: 'teamA',
    }));
    vm.runInNewContext(planRenderSource, context, { filename: 'edu-course-plan-render.js' });

    const intent = app._primeEduCoursePlanShareIntent('teamA', {
      skipPageHistory: true,
      suppressHashSync: true,
      _navigationTransitionSeq: 9,
    });
    const applied = app._applyEduCoursePlanShareFocus('teamA');
    await flushPromises(30);

    expect(intent).toMatchObject({ planId: 'planA', lessonId: 'sessionA', openRoster: true });
    expect(applied).toBe(true);
    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledWith('teamA', 'planA', 'sessionA');
    expect(app.showPage).toHaveBeenCalledWith('page-edu-course-lessons', {
      _navigationTransitionSeq: 9,
      bypassPageLock: true,
      skipPageHistory: true,
      suppressHashSync: true,
    });
    expect(container.innerHTML).toContain('小明');
    expect(container.innerHTML).not.toContain('&#21517;&#21934;&#36617;&#20837;&#22833;&#25943;');
    expect(app._eduCoursePlanShareFocusByTeam.teamA).toBeUndefined();
    expect(replaceState).not.toHaveBeenCalled();
  });

  test('renderer exception after payload assignment settles to a visible retry', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { app, container } = loadCourseLessonsContext({
      rosterPayload: createRosterPayload('Renderer Exception Student', 'renderer-exception'),
    });
    jest.spyOn(app, '_renderCourseLessonRosterFromContext').mockImplementation(() => {
      throw new Error('renderer exploded');
    });

    try {
      await expect(app.showCourseLessonRoster('teamA', 'planA', 'sessionA')).resolves.toMatchObject({
        ok: false,
        reason: 'roster_flow_failed',
      });
    } finally {
      errorSpy.mockRestore();
    }

    expect(app._eduCourseLessonsContext.rosterPayload).toBeTruthy();
    expect(container.innerHTML).not.toContain('edu-course-lessons-loading');
    expect(container.innerHTML).not.toContain('edu-course-roster-shell-loading');
    expect(container.innerHTML).toContain('primary-btn small');
  });

  test('viewer-change delegate rejection is caught after the delegated promise settles', async () => {
    const roster = deferred();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { app, container, firebase, authState } = loadCourseLessonsContext({ authUid: 'uidA' });
    firebase.listEduCoursePublicRoster.mockImplementationOnce(() => roster.promise);
    app._handleCourseLessonRosterViewerChange = jest.fn(() => Promise.reject(new Error('viewer retry failed')));

    const load = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length === 0) {
      await Promise.resolve();
    }
    authState.uid = 'uidB';
    roster.resolve(createRosterPayload('Stale Viewer Student', 'viewer-rejection'));

    try {
      await expect(load).resolves.toMatchObject({ ok: false, reason: 'roster_flow_failed' });
    } finally {
      errorSpy.mockRestore();
    }

    expect(app._handleCourseLessonRosterViewerChange).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).not.toContain('Stale Viewer Student');
    expect(container.innerHTML).not.toContain('edu-course-lessons-loading');
    expect(container.innerHTML).not.toContain('edu-course-roster-shell-loading');
    expect(container.innerHTML).toContain('primary-btn small');
  });

  test('older roster finalizer cannot overwrite a newer successful request', async () => {
    const firstRoster = deferred();
    const { app, container, firebase } = loadCourseLessonsContext();
    firebase.listEduCoursePublicRoster
      .mockImplementationOnce(() => firstRoster.promise)
      .mockResolvedValueOnce(createRosterPayload('New Owner Student', 'new-owner'));

    const firstLoad = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length === 0) {
      await Promise.resolve();
    }

    await expect(app.showCourseLessonRoster('teamA', 'planA', 'sessionA')).resolves.toMatchObject({
      ok: true,
    });
    expect(container.innerHTML).toContain('New Owner Student');

    firstRoster.resolve(createRosterPayload('Old Owner Student', 'old-owner'));
    await expect(firstLoad).resolves.toMatchObject({ ok: false, reason: 'stale' });

    expect(container.innerHTML).toContain('New Owner Student');
    expect(container.innerHTML).not.toContain('Old Owner Student');
    expect(container.innerHTML).not.toContain('&#21517;&#21934;&#36617;&#20837;&#22833;&#25943;');
  });

  test('new same-roster request terminalizes inherited loading when it fails before its spinner', async () => {
    const firstRoster = deferred();
    const { app, container, firebase } = loadCourseLessonsContext();
    firebase.listEduCoursePublicRoster.mockImplementationOnce(() => firstRoster.promise);

    const firstLoad = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length === 0) {
      await Promise.resolve();
    }
    expect(container.innerHTML).toMatch(/edu-course-(?:lessons-loading|roster-shell-loading)/);

    app.showPage.mockImplementationOnce(async (_pageId, options = {}) => {
      app.currentPage = 'page-edu-course-lessons';
      app._activePageTransitionSeq = Number(options?._navigationTransitionSeq) || app._pageTransitionSeq;
      app._pageTransitionSeq += 1;
    });

    await expect(app.showCourseLessonRoster('teamA', 'planA', 'sessionA')).resolves.toMatchObject({
      ok: false,
      reason: 'stale_transition',
    });
    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).not.toContain('edu-course-lessons-loading');
    expect(container.innerHTML).not.toContain('edu-course-roster-shell-loading');
    expect(container.innerHTML).toContain('primary-btn small');

    firstRoster.resolve(createRosterPayload('Superseded Owner Student', 'superseded-owner'));
    await expect(firstLoad).resolves.toMatchObject({ ok: false });
    expect(container.innerHTML).not.toContain('Superseded Owner Student');
    expect(container.innerHTML).toContain('primary-btn small');
  });

  test('retries roster once when auth viewer changes during load', async () => {
    let resolveFirst;
    const firstPromise = new Promise(resolve => { resolveFirst = resolve; });
    const firstPayload = {
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'a-viewer', cacheTtlMs: 30000 },
      session: { id: 'sessionA', title: 'First', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Viewer A Student', canSelfLeave: true, selfUid: 'uidA' }],
    };
    const secondPayload = {
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'b-viewer', cacheTtlMs: 30000 },
      session: { id: 'sessionA', title: 'Second', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Viewer B Student', canSelfLeave: false }],
    };
    const { app, container, firebase, authState } = loadCourseLessonsContext({ authUid: 'uidA' });
    firebase.listEduCoursePublicRoster
      .mockImplementationOnce(() => firstPromise)
      .mockResolvedValueOnce(secondPayload);

    const firstLoad = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length === 0) {
      await Promise.resolve();
    }
    authState.uid = 'uidB';
    resolveFirst(firstPayload);

    await expect(firstLoad).resolves.toMatchObject({ ok: true });
    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(2);
    expect(firebase.listEduCoursePublicRoster).toHaveBeenLastCalledWith(
      'teamA',
      'planA',
      'sessionA',
      { forceRefresh: true },
    );
    expect(container.innerHTML).toContain('Viewer B Student');
    expect(container.innerHTML).not.toContain('Viewer A Student');
  });

  test('stops viewer-change retries with a visible retry action', async () => {
    let resolveFirst;
    let resolveSecond;
    const firstPromise = new Promise(resolve => { resolveFirst = resolve; });
    const secondPromise = new Promise(resolve => { resolveSecond = resolve; });
    const payload = {
      rosterPublic: true,
      session: { id: 'sessionA', title: 'Session', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Stale Viewer Student' }],
    };
    const { app, container, firebase, authState } = loadCourseLessonsContext({ authUid: 'uidA' });
    firebase.listEduCoursePublicRoster
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(() => secondPromise);

    const load = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (firebase.listEduCoursePublicRoster.mock.calls.length === 0) await Promise.resolve();
    authState.uid = 'uidB';
    resolveFirst(payload);
    while (firebase.listEduCoursePublicRoster.mock.calls.length < 2) await Promise.resolve();
    authState.uid = 'uidC';
    resolveSecond(payload);

    await expect(load).resolves.toMatchObject({
      ok: false,
      reason: 'viewer_changed',
      retryExhausted: true,
    });
    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toContain('primary-btn small');
    expect(container.innerHTML).not.toContain('Stale Viewer Student');
    expect(container.innerHTML).not.toContain('edu-loading');
  });

  test('renders fresh roster without waiting for stalled lesson state when the plan is cached', async () => {
    const { app, container } = loadCourseLessonsContext();
    app._loadEduCourseLessonsState = jest.fn(() => new Promise(() => {}));
    let settled = false;

    const load = app.showCourseLessonRoster('teamA', 'planA', 'sessionA').then((result) => {
      settled = true;
      return result;
    });
    await flushPromises(20);

    expect(settled).toBe(true);
    await expect(load).resolves.toMatchObject({ ok: true });
    expect(container.innerHTML).toContain('edu-course-roster');
    expect(container.innerHTML).not.toContain('edu-loading');
  });

  test('turns a roster request timeout into a visible retry action', async () => {
    const timeoutError = Object.assign(new Error('timeout'), { code: 'COURSE_LESSON_ROSTER_TIMEOUT' });
    const withSportHubTimeout = jest.fn((promise, _timeoutMs, code) => (
      code === 'COURSE_LESSON_ROSTER_TIMEOUT' ? Promise.reject(timeoutError) : Promise.resolve(promise)
    ));
    const { app, container } = loadCourseLessonsContext({ withSportHubTimeout });

    await expect(app.showCourseLessonRoster('teamA', 'planA', 'sessionA')).resolves.toMatchObject({
      ok: false,
      reason: 'roster_failed',
    });

    expect(withSportHubTimeout).toHaveBeenCalledWith(
      expect.any(Promise),
      35000,
      'COURSE_LESSON_ROSTER_TIMEOUT',
      'Course lesson roster request timed out',
    );
    expect(container.innerHTML).toContain('primary-btn small');
    expect(container.innerHTML).not.toContain('edu-loading');
  });

  test('turns a lesson state timeout without cached plan into a visible retry action', async () => {
    const timeoutError = Object.assign(new Error('timeout'), { code: 'COURSE_LESSON_STATE_TIMEOUT' });
    const withSportHubTimeout = jest.fn((promise, _timeoutMs, code) => (
      code === 'COURSE_LESSON_STATE_TIMEOUT' ? Promise.reject(timeoutError) : Promise.resolve(promise)
    ));
    const { app, container } = loadCourseLessonsContext({ plans: [], withSportHubTimeout });

    await expect(app.showCourseLessonRoster('teamA', 'planA', 'sessionA')).resolves.toMatchObject({
      ok: false,
      reason: 'state_failed',
    });

    expect(withSportHubTimeout).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      15000,
      'COURSE_LESSON_STATE_TIMEOUT',
      'Course lesson state request timed out',
    );
    expect(container.innerHTML).toContain('primary-btn small');
    expect(container.innerHTML).not.toContain('edu-loading');
  });

  test('retries cached roster refresh when auth viewer changes before it finishes', async () => {
    let resolveState;
    let resolveRefresh;
    const statePromise = new Promise(resolve => { resolveState = resolve; });
    const refreshPromise = new Promise(resolve => { resolveRefresh = resolve; });
    const cachedPayload = {
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'a-cached-viewer', cacheTtlMs: 30000 },
      session: { id: 'sessionA', title: 'Cached', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Viewer A Cached', canSelfLeave: true, selfUid: 'uidA' }],
    };
    const { app, container, firebase, authState } = loadCourseLessonsContext({
      authUid: 'uidA',
      rosterPayload: cachedPayload,
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    expect(container.innerHTML).toContain('Viewer A Cached');

    const originalLoadState = app._loadEduCourseLessonsState.bind(app);
    app._loadEduCourseLessonsState = jest.fn(() => statePromise);
    firebase.listEduCoursePublicRoster.mockImplementationOnce(() => refreshPromise);
    const secondLoad = app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    while (app._loadEduCourseLessonsState.mock.calls.length === 0) {
      await Promise.resolve();
    }
    await expect(secondLoad).resolves.toMatchObject({ ok: true, cached: true });
    expect(container.innerHTML).toContain('Viewer A Cached');

    firebase.listEduCoursePublicRoster.mockResolvedValueOnce({
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'b-fresh-viewer', cacheTtlMs: 30000 },
      session: { id: 'sessionA', title: 'Fresh', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Viewer B Fresh', canSelfLeave: false }],
    });
    authState.uid = 'uidB';
    resolveState(await originalLoadState('teamA', 'planA'));
    resolveRefresh({
      rosterPublic: true,
      cacheMeta: { payloadVersion: 'stale-viewer-response', cacheTtlMs: 30000 },
      session: { id: 'sessionA', title: 'Stale', date: '2099-06-02', startTime: '10:00', endTime: '11:30', status: 'scheduled' },
      students: [{ studentId: 'stu1', displayName: 'Stale Viewer A', canSelfLeave: true, selfUid: 'uidA' }],
    });
    await flushPromises(20);

    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledTimes(3);
    expect(container.innerHTML).toContain('Viewer B Fresh');
    expect(container.innerHTML).not.toContain('Viewer A Cached');
    expect(container.innerHTML).not.toContain('Stale Viewer A');
  });

  test('stale background roster work cannot retry after the auth viewer changes', async () => {
    const { app, authState } = loadCourseLessonsContext({ authUid: 'uidA' });
    app.currentPage = 'page-edu-course-lessons';
    app._eduCurrentTeamId = 'teamA';
    app._eduCourseLessonsRequestSeq = 2;
    app._eduCourseLessonsContext = { teamId: 'teamA', planId: 'planA', sessionId: 'sessionA', mode: 'roster' };
    const showRoster = jest.spyOn(app, 'showCourseLessonRoster').mockResolvedValue({ ok: true });
    authState.uid = 'uidB';

    const result = await app._refreshCourseLessonRosterInBackground(
      1,
      'teamA',
      'planA',
      'sessionA',
      app._findEduCoursePlan('teamA', 'planA'),
      false,
      '',
      'uidA',
    );

    expect(result).toMatchObject({ ok: false, reason: 'stale' });
    expect(showRoster).not.toHaveBeenCalled();
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

  test('staff roster uses callable enrollment projection without fallback enrollment load', async () => {
    const loadCourseEnrollments = jest.fn(async () => []);
    const { app, container, firebase } = loadCourseLessonsContext({
      isStaff: true,
      loadCourseEnrollments,
      rosterPayload: {
        rosterPublic: true,
        canManageRoster: true,
        session: {
          id: 'sessionA',
          title: 'Session A',
          date: '2099-06-02',
          startTime: '10:00',
          endTime: '11:30',
          status: 'scheduled',
        },
        staffEnrollmentByStudentId: {
          stu2: { enrollmentId: 'enr2', paidAt: null, paymentStatus: 'unpaid', coachNotes: 'projected note' },
        },
        students: [
          { studentId: 'stu1', displayName: 'Projected Paid', attendanceKind: 'signin' },
          { studentId: 'stu2', displayName: 'Projected Unpaid', attendanceKind: null },
        ],
      },
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');
    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledWith('teamA', 'planA', 'sessionA');
    expect(loadCourseEnrollments).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain('Projected Unpaid');
    expect(container.innerHTML).toContain('edu-course-roster-section-unpaid');
    expect(container.innerHTML).toContain("App.editCourseSessionRosterNote('teamA','planA','stu2','enr2')");
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
        price: 1200,
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

  test('roster manager can open closed roster using callable permission', async () => {
    const { app, container } = loadCourseLessonsContext({
      isStaff: false,
      rosterPayload: {
        rosterPublic: false,
        canManageRoster: true,
        session: {
          id: 'sessionA',
          title: 'Private Session',
          date: '2099-06-02',
          startTime: '10:00',
          endTime: '11:30',
          status: 'scheduled',
        },
        staffEnrollmentByStudentId: {},
        students: [
          { studentId: 'stu1', displayName: 'Roster Agent Visible', attendanceKind: null },
        ],
      },
    });

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    expect(container.innerHTML).toContain('Roster Agent Visible');
    expect(app._eduCourseLessonsContext.isStaff).toBe(true);
    expect(app._eduCourseLessonsContext.canManageRoster).toBe(true);
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
    expect(app.showCourseLessonRoster).toHaveBeenCalledWith('teamA', 'planA', 'sessionA', { forceRefresh: true });
  });


  test('weekly roster defaults owned students to leave and lets them register', async () => {
    const { app, container, firebase } = loadCourseLessonsContext({
      plans: [{
        id: 'weeklyPlan',
        name: '\u56fa\u5b9a\u9031\u671f\u73ed',
        planType: 'weekly',
        startDate: '2099-06-01',
        endDate: '2099-06-30',
      }],
      rosterPayload: {
        rosterPublic: true,
        session: {
          id: 'weeklyA',
          title: '\u7b2c 1 \u5802',
          date: '2099-06-02',
          startTime: '10:00',
          endTime: '11:30',
          status: 'scheduled',
        },
        students: [
          { studentId: 'stu2', displayName: '\u5c0f\u83ef', level: null, attendanceKind: null, canSelfLeave: true, selfUid: 'uidA', parentUid: null },
        ],
      },
    });

    await app.showCourseLessonRoster('teamA', 'weeklyPlan', 'weeklyA');

    expect(container.innerHTML).toContain('\u8acb\u5047');
    expect(container.innerHTML).toContain('edu-course-roster-status-leave');
    expect(container.innerHTML).toContain("App.showCourseLessonSelfRegisterDialog('stu2','registered',this)");
    expect(container.innerHTML).toMatch(/edu-roster-self-register-btn[^>]*>\u6211\u8981\u5831\u540d<\/button>/);
    expect(container.innerHTML).not.toContain('App.showCourseLessonSelfLeaveDialog');

    app.showCourseLessonRoster = jest.fn(async () => ({ ok: true }));
    await app.saveCourseLessonSelfRegistration('stu2', 'registered', { dataset: {}, disabled: false, style: {}, isConnected: true });

    expect(firebase.saveEduCourseSelfAttendance).toHaveBeenCalledWith({
      teamId: 'teamA',
      planId: 'weeklyPlan',
      sessionId: 'weeklyA',
      date: '2099-06-02',
      studentId: 'stu2',
      studentName: '\u5c0f\u83ef',
      selfUid: 'uidA',
      parentUid: null,
      kind: 'registered',
    });
    expect(app.showToast).toHaveBeenCalledWith('\u5df2\u5b8c\u6210\u5831\u540d');
    expect(app.showCourseLessonRoster).toHaveBeenCalledWith('teamA', 'weeklyPlan', 'weeklyA', { forceRefresh: true });
  });

  test('weekly registered roster lets owned students cancel registration back to leave', async () => {
    const { app, container, firebase } = loadCourseLessonsContext({
      plans: [{
        id: 'weeklyPlan',
        name: '\u56fa\u5b9a\u9031\u671f\u73ed',
        planType: 'weekly',
        startDate: '2099-06-01',
        endDate: '2099-06-30',
      }],
      rosterPayload: {
        rosterPublic: true,
        session: {
          id: 'weeklyA',
          title: '\u7b2c 1 \u5802',
          date: '2099-06-02',
          startTime: '10:00',
          endTime: '11:30',
          status: 'scheduled',
        },
        students: [
          { studentId: 'stu2', displayName: '\u5c0f\u83ef', attendanceKind: 'registered', canSelfLeave: true, selfUid: 'uidA', parentUid: null },
        ],
      },
    });

    await app.showCourseLessonRoster('teamA', 'weeklyPlan', 'weeklyA');

    expect(container.innerHTML).toContain('\u5df2\u5831\u540d');
    expect(container.innerHTML).toContain('\u53d6\u6d88\u5831\u540d');

    app.showCourseLessonRoster = jest.fn(async () => ({ ok: true }));
    await app.saveCourseLessonSelfRegistration('stu2', 'leave', { dataset: {}, disabled: false, style: {}, isConnected: true });

    expect(firebase.saveEduCourseSelfAttendance).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'teamA',
      planId: 'weeklyPlan',
      sessionId: 'weeklyA',
      studentId: 'stu2',
      kind: 'leave',
    }));
    expect(app.showToast).toHaveBeenCalledWith('\u5df2\u53d6\u6d88\u5831\u540d');
  });

  test('weekly self registration preserves server signin responses', async () => {
    const { app, firebase } = loadCourseLessonsContext({
      FirebaseService: {
        saveEduCourseSelfAttendance: jest.fn(async () => ({ changed: 0, kind: 'signin', signedIn: true })),
      },
      plans: [{
        id: 'weeklyPlan',
        name: '\u56fa\u5b9a\u9031\u671f\u73ed',
        planType: 'weekly',
        startDate: '2099-06-01',
        endDate: '2099-06-30',
      }],
      rosterPayload: {
        rosterPublic: true,
        session: {
          id: 'weeklyA',
          title: '\u7b2c 1 \u5802',
          date: '2099-06-02',
          startTime: '10:00',
          endTime: '11:30',
          status: 'scheduled',
        },
        students: [
          { studentId: 'stu2', displayName: '\u5c0f\u83ef', attendanceKind: 'registered', canSelfLeave: true, selfUid: 'uidA', parentUid: null },
        ],
      },
    });

    await app.showCourseLessonRoster('teamA', 'weeklyPlan', 'weeklyA');

    app.showCourseLessonRoster = jest.fn(async () => ({ ok: true }));
    await app.saveCourseLessonSelfRegistration('stu2', 'leave', { dataset: {}, disabled: false, style: {}, isConnected: true });

    expect(firebase.saveEduCourseSelfAttendance).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'teamA',
      planId: 'weeklyPlan',
      sessionId: 'weeklyA',
      studentId: 'stu2',
      kind: 'leave',
    }));
    expect(app._eduCourseLessonsContext.rosterPayload.students[0].attendanceKind).toBe('signin');
    expect(app.showToast).toHaveBeenCalledWith('\u5df2\u7c3d\u5230\uff0c\u4fdd\u7559\u7c3d\u5230\u72c0\u614b');
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
