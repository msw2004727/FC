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
    _formatCourseSessionDate: (session) => session.date,
    _formatCourseSessionTime: (session) => [session.startTime, session.endTime].filter(Boolean).join(' - '),
    _getCourseSessionStatusMeta: () => ({ label: '已排課', cls: 'scheduled' }),
    _renderCourseSessionStudentAvatar: (_student, name) => '<span class="avatar">' + escapeHTML(name) + '</span>',
    _bindCourseSessionStudentAvatarFallbacks: jest.fn(),
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
    },
    document: {
      getElementById: jest.fn((id) => {
        if (id === 'edu-course-lessons-page') return container;
        if (id === 'edu-course-lessons-title') return title;
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

  test('renders public roster without staff notes', async () => {
    const { app, container, title, firebase } = loadCourseLessonsContext();

    await app.showCourseLessonRoster('teamA', 'planA', 'sessionA');

    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledWith('teamA', 'planA', 'sessionA');
    expect(title.textContent).toBe('課堂名單');
    expect(container.innerHTML).toContain('小明');
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
});
