const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-lesson-share.js'),
  'utf8'
);

function loadLessonShare(overrides = {}) {
  const plan = {
    id: 'planA',
    name: 'Summer Course',
    planType: 'session',
    visibleOnTeamPage: true,
    coverImage: 'https://cdn.example/course.webp',
    ...(overrides.plan || {}),
  };
  const session = {
    id: 'sessionA',
    title: 'Lesson One',
    date: '2099-07-13',
    startTime: '10:00',
    endTime: '11:30',
    location: 'Field A',
    ...(overrides.session || {}),
  };
  const copyToClipboard = jest.fn(async () => true);
  const shareTargetPicker = jest.fn(async () => ({ status: 'success' }));
  const showShareActionSheet = overrides.showShareActionSheet
    || jest.fn(async () => overrides.choice || 'line');
  const app = {
    _shareInProgress: false,
    _eduCoursePlanTabByTeam: { teamA: 'active' },
    _eduCourseLessonsContext: { teamId: 'teamA', planId: 'planA', mode: 'list', plan, sessions: [session] },
    getEduCoursePlans: jest.fn(() => [plan]),
    _getCourseLessonsCachedSessions: jest.fn(() => [session]),
    _canUseShareTargetPicker: jest.fn(async () => overrides.canPicker !== false),
    _showShareActionSheet: showShareActionSheet,
    _copyToClipboard: copyToClipboard,
    isEduClubStaff: jest.fn(() => false),
    showToast: jest.fn(),
  };
  const context = {
    App: app,
    ApiService: { getTeam: jest.fn(() => ({ id: 'teamA', name: 'Club A' })) },
    LineAuth: { isLoggedIn: jest.fn(() => overrides.lineLoggedIn !== false) },
    liff: { shareTargetPicker },
    MINI_APP_BASE_URL: 'https://miniapp.line.me/demo',
    navigator: { share: overrides.navigatorShare },
    window: { open: jest.fn() },
    URL,
    URLSearchParams,
    encodeURIComponent,
    console,
    Promise,
    Date,
    Number,
    String,
    Object,
    Array,
  };
  vm.runInNewContext(source, context, { filename: 'edu-course-lesson-share.js' });
  return { app, copyToClipboard, shareTargetPicker, showShareActionSheet, plan, session };
}

describe('edu course lesson share', () => {
  test('builds canonical Mini App and web roster URLs', () => {
    const { app } = loadLessonShare();

    const mini = new URL(app._buildEduCourseLessonMiniAppShareUrl('team_A', 'plan-A', 'session_A', { courseTab: 'ended' }));
    const web = new URL(app._buildEduCourseLessonWebShareUrl('team_A', 'plan-A', 'session_A', { courseTab: 'ended' }));

    expect(mini.origin + mini.pathname).toBe('https://miniapp.line.me/demo/teams/team_A/courses/plan-A/lessons/session_A');
    expect(mini.searchParams.get('team')).toBeNull();
    expect(mini.searchParams.get('course')).toBeNull();
    expect(mini.searchParams.get('lesson')).toBeNull();
    expect(mini.searchParams.get('courseTab')).toBe('ended');
    expect(web.pathname).toBe('/teams/team_A/courses/plan-A/lessons/session_A');
    expect(web.searchParams.get('team')).toBeNull();
    expect(web.searchParams.get('lesson')).toBeNull();
    expect(web.searchParams.get('courseTab')).toBe('ended');
    expect(app._buildEduCourseLessonWebShareUrl('team A', 'planA', 'sessionA')).toBe('');
  });

  test('shares a Flex card whose action opens the exact lesson roster', async () => {
    const { app, shareTargetPicker } = loadLessonShare({ choice: 'line' });

    await app.shareEduCourseLesson('teamA', 'planA', 'sessionA');

    expect(shareTargetPicker).toHaveBeenCalledTimes(1);
    const message = shareTargetPicker.mock.calls[0][0][0];
    expect(message.type).toBe('flex');
    expect(message.altText).toContain('Lesson One');
    const actionUrl = new URL(message.contents.footer.contents[0].action.uri);
    expect(actionUrl.pathname).toBe('/demo/teams/teamA/courses/planA/lessons/sessionA');
    expect(actionUrl.searchParams.get('courseTab')).toBe('active');
    expect(actionUrl.searchParams.get('lesson')).toBeNull();
    expect(message.contents.footer.contents[0].action.label).toBe('查看課堂名單');
  });

  test('copy action uses the web URL and repeated taps share only once', async () => {
    let resolveChoice;
    const choicePromise = new Promise(resolve => { resolveChoice = resolve; });
    const showShareActionSheet = jest.fn(() => choicePromise);
    const { app, copyToClipboard } = loadLessonShare({ showShareActionSheet });

    const first = app.shareEduCourseLesson('teamA', 'planA', 'sessionA');
    const second = app.shareEduCourseLesson('teamA', 'planA', 'sessionA');
    await new Promise(resolve => setImmediate(resolve));
    expect(showShareActionSheet).toHaveBeenCalledTimes(1);
    resolveChoice('copy');
    await Promise.all([first, second]);

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    const copiedText = copyToClipboard.mock.calls[0][0];
    expect(copiedText).toContain('https://toosterx.com/teams/teamA/courses/planA/lessons/sessionA');
    expect(copiedText).toContain('courseTab=active');
  });
});
