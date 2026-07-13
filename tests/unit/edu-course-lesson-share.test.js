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
  test('builds encoded Mini App and web roster URLs', () => {
    const { app } = loadLessonShare();

    const mini = new URL(app._buildEduCourseLessonMiniAppShareUrl('team A', 'plan/A', 'session?A', { courseTab: 'ended' }));
    const web = new URL(app._buildEduCourseLessonWebShareUrl('team A', 'plan/A', 'session?A', { courseTab: 'ended' }));

    expect(mini.origin + mini.pathname).toBe('https://miniapp.line.me/demo');
    expect(mini.searchParams.get('team')).toBe('team A');
    expect(mini.searchParams.get('teamTab')).toBe('courses');
    expect(mini.searchParams.get('course')).toBe('plan/A');
    expect(mini.searchParams.get('lesson')).toBe('session?A');
    expect(mini.searchParams.get('courseView')).toBe('roster');
    expect(mini.searchParams.get('courseTab')).toBe('ended');
    expect(web.pathname).toBe('/teams/team%20A');
    expect(web.searchParams.get('team')).toBeNull();
    expect(web.searchParams.get('lesson')).toBe('session?A');
  });

  test('shares a Flex card whose action opens the exact lesson roster', async () => {
    const { app, shareTargetPicker } = loadLessonShare({ choice: 'line' });

    await app.shareEduCourseLesson('teamA', 'planA', 'sessionA');

    expect(shareTargetPicker).toHaveBeenCalledTimes(1);
    const message = shareTargetPicker.mock.calls[0][0][0];
    expect(message.type).toBe('flex');
    expect(message.altText).toContain('Lesson One');
    const actionUrl = new URL(message.contents.footer.contents[0].action.uri);
    expect(actionUrl.searchParams.get('team')).toBe('teamA');
    expect(actionUrl.searchParams.get('course')).toBe('planA');
    expect(actionUrl.searchParams.get('lesson')).toBe('sessionA');
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
    expect(copiedText).toContain('https://toosterx.com/teams/teamA?');
    expect(copiedText).toContain('lesson=sessionA');
  });
});
