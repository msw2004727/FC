const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-plan-render.js'),
  'utf8'
);
const crudSource = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-plan.js'),
  'utf8'
);
const formV2Source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-plan-form-v2.js'),
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

async function renderPlans(plans, isStaff = true, selectedTab = 'active', overrides = {}) {
  const container = { innerHTML: '' };
  const app = {
    _courseEnrollCache: overrides.courseEnrollCache || {},
    _courseEnrollSummaryCache: overrides.courseEnrollSummaryCache || {},
    _eduCoursePlanTabByTeam: selectedTab === 'ended' ? { teamA: 'ended' } : {},
    isEduClubStaff: jest.fn(() => isStaff),
    _loadEduCoursePlans: jest.fn(() => Promise.resolve(plans)),
    _getCourseEnrollCacheKey: overrides.getCourseEnrollCacheKey || jest.fn(() => null),
    _loadCourseEnrollments: jest.fn(() => Promise.resolve([])),
    _loadCourseEnrollmentSummaries: overrides.loadCourseEnrollmentSummaries,
    _loadCourseSessions: overrides.loadCourseSessions,
    _isCourseSessionFrozenForRoster: overrides.isCourseSessionFrozenForRoster,
    _getCourseSessionSortValue: overrides.getCourseSessionSortValue || ((session) => {
      const date = String(session?.date || '');
      return date ? new Date(date).getTime() : 0;
    }),
    _todayStr: overrides.todayStr,
    getEduStudents: jest.fn(() => overrides.eduStudents || []),
    _weekdayLabel: (day) => ['日', '一', '二', '三', '四', '五', '六'][day] || String(day),
  };
  const context = {
    App: app,
    ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
    document: {
      getElementById: jest.fn((id) => id === 'edu-course-plan-list' ? container : null),
    },
    escapeHTML,
    console,
    Promise,
    Date,
    Number,
    String,
    Set,
    Object,
  };
  vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });
  await context.App.renderEduCoursePlanList('teamA', isStaff);
  if (context.App._eduCoursePlanListRefreshPromise) {
    await context.App._eduCoursePlanListRefreshPromise;
  }
  return container.innerHTML;
}

describe('edu course plan render', () => {
  test('course tab preloads current lesson sessions after rendering active plans', () => {
    expect(source).toContain('this._preloadCourseLessonsForPlans?.(teamId, currentPlans)');
  });

  test('groups weekly and session plans into separate designed containers', async () => {
    const html = await renderPlans([
      {
        id: 'w1',
        name: '成人固定班',
        planType: 'weekly',
        weekdays: [1, 3],
        timeSlot: '19:00-20:30',
        startDate: '2099-05-01',
        endDate: '2099-06-30',
        price: 2400,
        maxCapacity: 12,
        allowSignup: true,
        coverImage: 'https://example.com/course.jpg',
        groupName: '成人班',
        coachName: '林教練',
      },
      {
        id: 's1',
        name: '私人堂數包',
        planType: 'session',
        totalSessions: 8,
        price: 3200,
        maxCapacity: 6,
        allowSignup: false,
        groupName: '個訓班',
        coachName: '陳教練',
      },
    ]);

    expect(html).toContain('edu-course-plan-sections');
    expect(html).toContain('edu-course-plan-section-weekly');
    expect(html).toContain('edu-course-plan-section-session');
    expect(html.indexOf('固定週期課程')).toBeLessThan(html.indexOf('堂數制課程'));
    expect(html).toContain('edu-cp-card-v3 edu-cp-card-compact edu-cp-card-weekly');
    expect(html).toContain('edu-cp-card-v3 edu-cp-card-compact edu-cp-card-session');
    expect(html).toContain('has-cover');
    expect(html).toContain('class="edu-cp-compact-cover"');
    expect(html).not.toContain('edu-cp-visual');
    expect(html).not.toContain('class="edu-cp-bg-img"');
    expect(html).toContain('成人固定班');
    expect(html).toContain('詳細資訊');
    expect(html).toContain('我要報名');
    expect(html).toContain('2099-05-01 ~ 2099-06-30');
    expect(html).toContain('NT$ 2,400');
    expect(html).toContain('0/12 人');
    expect(html).toContain('林教練');
    expect(html).not.toContain('週一、週三 19:00-20:30');
    expect(html).not.toContain('共 8 堂');
    expect(html).not.toContain('個訓班');
  });

  test('shows a course loading shell before plan data resolves', async () => {
    const container = { innerHTML: '' };
    let resolvePlans;
    const plansPromise = new Promise(resolve => { resolvePlans = resolve; });
    const app = {
      _courseEnrollCache: {},
      _courseEnrollSummaryCache: {},
      _eduCoursePlanTabByTeam: {},
      isEduClubStaff: jest.fn(() => false),
      _loadEduCoursePlans: jest.fn(() => plansPromise),
      _getCourseEnrollCacheKey: jest.fn(() => null),
      _loadCourseEnrollments: jest.fn(() => Promise.resolve([])),
      getEduStudents: jest.fn(() => []),
      _weekdayLabel: (day) => ['日', '一', '二', '三', '四', '五', '六'][day] || String(day),
    };
    const context = {
      App: app,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        getElementById: jest.fn((id) => id === 'edu-course-plan-list' ? container : null),
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Set,
      Object,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    const renderPromise = context.App.renderEduCoursePlanList('teamA', false);

    expect(container.innerHTML).toContain('edu-course-plan-list-loading');
    expect(container.innerHTML).toContain('aria-busy="true"');

    resolvePlans([{
      id: 'planA',
      name: 'Course Plan',
      active: true,
      planType: 'weekly',
      startDate: '2099-01-01',
      endDate: '2099-02-01',
      allowSignup: true,
    }]);
    await renderPromise;

    expect(container.innerHTML).toContain('Course Plan');
    expect(container.innerHTML).not.toContain('edu-course-plan-list-loading');
  });

  test('renders cached course plans with a non-blocking refresh status before fresh data resolves', async () => {
    const container = { innerHTML: '' };
    let resolvePlans;
    const plansPromise = new Promise(resolve => { resolvePlans = resolve; });
    const app = {
      _courseEnrollCache: {},
      _courseEnrollSummaryCache: {},
      _eduCoursePlansCache: {
        teamA: [{
          id: 'cachedPlan',
          name: 'Cached Plan',
          active: true,
          planType: 'weekly',
          startDate: '2099-01-01',
          endDate: '2099-02-01',
          allowSignup: true,
        }],
      },
      _eduCoursePlanTabByTeam: {},
      isEduClubStaff: jest.fn(() => true),
      _loadEduCoursePlans: jest.fn(() => plansPromise),
      _getCourseEnrollCacheKey: jest.fn(() => null),
      _loadCourseEnrollments: jest.fn(() => Promise.resolve([])),
      getEduStudents: jest.fn(() => []),
      _weekdayLabel: (day) => ['日', '一', '二', '三', '四', '五', '六'][day] || String(day),
    };
    const context = {
      App: app,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        getElementById: jest.fn((id) => id === 'edu-course-plan-list' ? container : null),
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Set,
      Object,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    const renderPromise = context.App.renderEduCoursePlanList('teamA', true);

    expect(container.innerHTML).toContain('Cached Plan');
    expect(container.innerHTML).toContain('edu-refresh-status');
    expect(container.innerHTML).not.toContain('edu-course-plan-list-loading');
    expect(container.innerHTML).not.toContain('App.applyCourseEnrollment');
    expect(container.innerHTML).not.toContain('App.showCourseEnrollmentList');
    expect(container.innerHTML).not.toContain('App.showEduCoursePlanForm');
    expect(container.innerHTML).not.toContain('App.deleteEduCoursePlan');
    expect(container.innerHTML).not.toContain('App.showEduCoursePlanDetail');
    expect(container.innerHTML).not.toContain('App.showCourseLessons');

    resolvePlans([{
      id: 'freshPlan',
      name: 'Fresh Plan',
      active: true,
      planType: 'weekly',
      startDate: '2099-03-01',
      endDate: '2099-04-01',
      allowSignup: true,
    }]);
    await renderPromise;

    expect(container.innerHTML).toContain('Fresh Plan');
    expect(container.innerHTML).not.toContain('Cached Plan');
    expect(container.innerHTML).not.toContain('edu-refresh-status');
    expect(container.innerHTML).toContain('App.showEduCoursePlanDetail');
    expect(container.innerHTML).toContain('App.showCourseLessons');
    expect(container.innerHTML).toContain('App.applyCourseEnrollment');
    expect(container.innerHTML).toContain('App.showCourseEnrollmentList');
  });

  test('keeps cached course plans read only when refresh falls back to cache', async () => {
    const container = { innerHTML: '' };
    const cachedPlans = [{
      id: 'cachedPlan',
      name: 'Cached Plan',
      active: true,
      planType: 'weekly',
      startDate: '2099-01-01',
      endDate: '2099-02-01',
      allowSignup: true,
    }];
    const app = {
      _courseEnrollCache: {},
      _courseEnrollSummaryCache: {},
      _eduCoursePlansCache: { teamA: cachedPlans },
      _eduCoursePlanLoadFailedByTeam: {},
      _eduCoursePlanTabByTeam: {},
      isEduClubStaff: jest.fn(() => true),
      _loadEduCoursePlans: jest.fn(() => {
        app._eduCoursePlanLoadFailedByTeam.teamA = true;
        return Promise.resolve(cachedPlans);
      }),
      _getCourseEnrollCacheKey: jest.fn(() => null),
      _loadCourseEnrollments: jest.fn(() => Promise.resolve([])),
      getEduStudents: jest.fn(() => []),
      _weekdayLabel: (day) => ['日', '一', '二', '三', '四', '五', '六'][day] || String(day),
    };
    const context = {
      App: app,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        getElementById: jest.fn((id) => id === 'edu-course-plan-list' ? container : null),
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Set,
      Object,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    await context.App.renderEduCoursePlanList('teamA', true);

    expect(container.innerHTML).toContain('Cached Plan');
    expect(container.innerHTML).toContain('edu-refresh-status');
    expect(container.innerHTML).toContain('disabled');
    expect(container.innerHTML).not.toContain('App.applyCourseEnrollment');
    expect(container.innerHTML).not.toContain('App.showCourseEnrollmentList');
    expect(container.innerHTML).not.toContain('App.showEduCoursePlanForm');
    expect(container.innerHTML).not.toContain('App.deleteEduCoursePlan');
    expect(container.innerHTML).not.toContain('App.showEduCoursePlanDetail');
    expect(container.innerHTML).not.toContain('App.showCourseLessons');
  });

  test('compact course cards keep cover overlays and equal-width actions', () => {
    expect(cssSource).toContain('.edu-cp-compact-cover');
    expect(cssSource).toContain('width: 62%;');
    expect(cssSource).toContain('object-position: center right;');
    expect(cssSource).toContain('clip-path: polygon(32% 0, 100% 0, 100% 100%, 0 100%);');
    expect(cssSource).toContain('.edu-course-card.edu-cp-card-compact.has-cover::before');
    expect(cssSource).toContain('[data-theme="light"] .edu-course-card.edu-cp-card-compact.has-cover::before');
    expect(cssSource).toContain('linear-gradient(112deg, var(--bg-card) 0%, var(--bg-card) 38%, rgba(15, 23, 42, .92)');
    expect(cssSource).toContain('linear-gradient(112deg, var(--bg-card) 0%, var(--bg-card) 38%, rgba(255, 255, 255, .92)');
    expect(cssSource).toContain('[data-theme="light"] .edu-course-card.edu-cp-card-compact.has-cover .edu-course-name');
    expect(cssSource).toContain('[data-theme="light"] .edu-course-card.edu-cp-card-compact.has-cover .edu-cp-compact-pill');
    expect(cssSource).toContain('[data-theme="light"] .edu-course-card.edu-cp-card-compact.has-cover .edu-cp-card-actions .outline-btn');
    expect(cssSource).toContain('[data-theme="light"] .edu-course-card.edu-cp-card-compact.has-cover .edu-cp-manage-left');
    expect(cssSource).toContain('.edu-course-card.edu-cp-card-compact.has-cover .edu-cp-manage-btn');
    expect(cssSource).toContain('.edu-cp-top-badges');
    expect(cssSource).toContain('.edu-cp-next-lesson-action');
    expect(cssSource).toContain('.edu-cp-next-lesson-badge');
    expect(cssSource).toContain('[data-theme="light"] .edu-cp-next-lesson-badge');
    expect(cssSource).toContain('[data-theme="dark"] .edu-cp-next-lesson-badge');
    expect(cssSource).toContain('background: linear-gradient(135deg, #facc15 0%, #fef3c7 42%, #f59e0b 100%);');
    expect(cssSource).toContain('@keyframes edu-cp-next-lesson-shine');
    expect(cssSource).toContain('@media (prefers-reduced-motion: reduce)');
    expect(cssSource).toContain('font-size: .74rem;');
    expect(cssSource).toMatch(/@media \(max-width: 560px\)\s*\{[\s\S]*\.edu-cp-toggle-row\s*\{[^}]*flex-direction: row;[^}]*justify-content: space-between;/s);
    expect(cssSource).toMatch(/@media \(max-width: 560px\)\s*\{[\s\S]*\.edu-cp-toggle-row \.toggle-switch\s*\{[^}]*align-self: flex-start;/s);
    expect(cssSource).toMatch(/@media \(max-width: 420px\)\s*\{[\s\S]*\.edu-cp-top-badges\s*\{[^}]*position: relative;[^}]*grid-column: 1 \/ -1;/s);
    expect(cssSource).toMatch(/@media \(max-width: 420px\)\s*\{[\s\S]*\.edu-cp-compact-title,[\s\S]*padding-right: 0;/s);
    expect(cssSource).toMatch(/@media \(max-width: 420px\)\s*\{[\s\S]*\.edu-cp-card-actions\s*\{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/s);
    expect(cssSource).toMatch(/@media \(max-width: 360px\)\s*\{[\s\S]*\.edu-cp-card-actions\s*\{[^}]*grid-template-columns: 1fr;/s);
    expect(cssSource).toContain('[data-theme="dark"] .edu-cp-card-hidden-badge');
    expect(cssSource).toContain('.edu-cp-lessons-btn-enrolled');
    expect(cssSource).toContain('.edu-cp-lessons-check');
    expect(cssSource).toContain('.edu-cp-pending-badge');
    expect(cssSource).toContain('box-shadow: 0 2px 6px rgba(220, 38, 38, .35);');
    expect(cssSource).toContain('.edu-cp-manage-danger');
    expect(cssSource).toContain('flex-wrap: wrap;');
    expect(cssSource).toContain('min-width: 5.05rem;');
    expect(cssSource).toContain('.edu-cp-signup-pending');
    expect(cssSource).toContain('.edu-cp-signup-enrolled');
    expect(cssSource).toMatch(/\.edu-course-card\.edu-cp-card-compact \.edu-course-name\s*\{[^}]*font-weight: 900;/s);
    expect(cssSource).toMatch(/\.edu-cp-manage-btn\s*\{[^}]*font-size: \.78rem;[^}]*white-space: nowrap;/s);
  });

  test('course cards hide blank price pills and show free only for zero price', async () => {
    const html = await renderPlans([
      {
        id: 'blankPrice',
        name: 'Blank Price Plan',
        planType: 'weekly',
        startDate: '2099-01-01',
        endDate: '2099-02-01',
        price: null,
        allowSignup: true,
      },
      {
        id: 'zeroPrice',
        name: 'Zero Price Plan',
        planType: 'weekly',
        startDate: '2099-01-01',
        endDate: '2099-02-01',
        price: 0,
        allowSignup: true,
      },
    ]);
    const getCardHtml = (id) => {
      const markerIndex = html.indexOf('data-course-plan-id="' + id + '"');
      const start = html.lastIndexOf('<div class="edu-course-card', markerIndex);
      const next = html.indexOf('<div class="edu-course-card', markerIndex + 1);
      return html.slice(start, next === -1 ? html.length : next);
    };
    const blankCard = getCardHtml('blankPrice');
    const zeroCard = getCardHtml('zeroPrice');

    expect(blankCard).toContain('Blank Price Plan');
    expect(blankCard).not.toContain('edu-cp-fee-pill');
    expect(blankCard).not.toContain('\u514d\u8cbb');
    expect(zeroCard).toContain('Zero Price Plan');
    expect(zeroCard).toContain('edu-cp-fee-pill');
    expect(zeroCard).toContain('\u514d\u8cbb');
  });

  test('course detail modal keeps growing fields inside a scrollable body', () => {
    expect(cssSource).toContain('height: min(92dvh, 720px);');
    expect(cssSource).toContain('min-height: 56px;'); // Style A：meta 卡片以 min-height 成長（取代舊 grid-auto-rows）
    expect(cssSource).toContain('flex: 1 1 0;');
    expect(cssSource).toContain('overscroll-behavior: contain;'); // Style A：捲動內文容器（取代舊 max-height: none）
    expect(cssSource).toContain('overflow-wrap: anywhere;');
  });

  test('keeps existing empty state when there are no active plans', async () => {
    const html = await renderPlans([{ id: 'archived', name: '停用方案', active: false }], false);

    expect(html).toContain('尚未建立課程方案');
    expect(html).not.toContain('edu-course-plan-section');
  });

  test('separates ended plans into the ended tab', async () => {
    const plans = [
      {
        id: 'active',
        name: 'Active Plan',
        planType: 'weekly',
        weekdays: [2],
        startDate: '2026-01-01',
        endDate: '2099-02-01',
        allowSignup: true,
      },
      {
        id: 'future',
        name: 'Future Plan',
        planType: 'weekly',
        weekdays: [3],
        startDate: '2099-01-01',
        endDate: '2099-02-01',
        allowSignup: true,
      },
      {
        id: 'ended',
        name: 'Ended Plan',
        planType: 'session',
        totalSessions: 4,
        startDate: '2000-01-01',
        endDate: '2000-02-01',
        allowSignup: false,
      },
    ];

    const activeHtml = await renderPlans(plans, true, 'active', {
      todayStr: () => '2026-06-11',
      loadCourseSessions: jest.fn(async (_teamId, planId) => (planId === 'active'
        ? [{ id: 'nextA', date: '2026-06-18', startTime: '19:00', status: 'scheduled' }]
        : [])),
    });
    const endedHtml = await renderPlans(plans, true, 'ended', { todayStr: () => '2026-06-11' });

    expect(activeHtml).toContain('edu-cp-view-tabs');
    expect(activeHtml).toContain('Active Plan');
    expect(activeHtml).toContain('Future Plan');
    expect(activeHtml).toContain('edu-cp-next-lesson-badge');
    expect(activeHtml).toContain('\u4e0b\u5802\u8ab26/18');
    expect(activeHtml).not.toContain('\u4e0a\u8ab2\u4e2d');
    expect((activeHtml.match(/edu-cp-next-lesson-badge/g) || []).length).toBe(1);
    expect(activeHtml).not.toContain('Ended Plan');
    expect(endedHtml).toContain('Ended Plan');
    expect(endedHtml).not.toContain('Active Plan');
    expect(endedHtml).not.toContain('Future Plan');
    expect(endedHtml).not.toContain('edu-cp-next-lesson-badge');
    expect(endedHtml).toContain('edu-cp-status-ended');
  });

  test('course cards use explicit lesson buttons for weekly and session plans', async () => {
    const html = await renderPlans([
      {
        id: 'weeklyPlan',
        name: 'Weekly Plan',
        planType: 'weekly',
        weekdays: [1],
        startDate: '2099-01-01',
        endDate: '2099-02-01',
        allowSignup: true,
      },
      {
        id: 'sessionPlan',
        name: 'Session Plan',
        planType: 'session',
        startDate: '2099-01-01',
        endDate: '2099-02-01',
        allowSignup: true,
      },
    ], true);

    expect(html).toContain('data-course-plan-id="weeklyPlan"');
    expect(html).toContain("App.showCourseLessons('teamA','weeklyPlan')");
    expect(html).toContain('data-course-plan-id="sessionPlan"');
    expect(html).not.toContain('edu-cp-card-clickable');
    expect(html).not.toContain('tabindex="0" onclick="App.showCourseLessons');
    expect(html).not.toContain('edu-cp-lessons-btn-enrolled');
    expect(html).toContain("App.showCourseLessons('teamA','sessionPlan')");
    expect(html).toContain('edu-cp-detail-btn');
    expect(html).toContain('edu-cp-lessons-btn');
    expect(html).toContain('edu-cp-share-btn');
    expect(html).toContain("App.shareEduCoursePlan('teamA','weeklyPlan',{courseTab:'active'})");
    expect(html.indexOf('App.showEduCoursePlanDetail')).toBeLessThan(html.indexOf("App.showCourseLessons('teamA','weeklyPlan')"));
    expect(html.indexOf("App.showCourseLessons('teamA','weeklyPlan')")).toBeLessThan(html.indexOf("App.applyCourseEnrollment('teamA','weeklyPlan',this)"));
    expect(html).toContain("App.applyCourseEnrollment('teamA','weeklyPlan',this)");
    expect(html).toContain('App.showCourseEnrollmentList');
    expect(html).toContain('edu-cp-manage-btn edu-cp-manage-list');
    expect(html).toContain('edu-cp-manage-btn edu-cp-manage-edit');
    expect(html).toContain('edu-cp-manage-btn edu-cp-manage-danger');
    expect(html).toContain('edu-cp-manage-sort');
    expect(html.indexOf('App.showEduCoursePlanDetail')).toBeLessThan(html.indexOf('App.showCourseEnrollmentList'));
  });

  test('course card shows pending review cancel action for viewer students', async () => {
    const html = await renderPlans([{
      id: 'pendingPlan',
      name: 'Pending Plan',
      planType: 'weekly',
      weekdays: [1],
      startDate: '2099-01-01',
      endDate: '2099-02-01',
      allowSignup: true,
      _enrollmentSummary: { effectiveApprovedCount: 0, viewerStatuses: { stuA: 'pending' } },
    }], false, 'active', {
      eduStudents: [{ id: 'stuA', name: 'Alice', enrollStatus: 'active', selfUid: 'viewer' }],
    });

    expect(html).toContain('1位學員審核中');
    expect(html).toContain('edu-cp-signup-pending');
    expect(html).toContain("App.showCourseEnrollmentPendingCancelDialog('teamA','pendingPlan',this)");
    expect(html).not.toContain('學員皆已報名');
  });

  test('hidden course plans are visible only to staff in the course list', async () => {
    const plans = [
      {
        id: 'publicPlan',
        name: 'Public Plan',
        planType: 'weekly',
        weekdays: [1],
        startDate: '2099-01-01',
        endDate: '2099-02-01',
        allowSignup: true,
      },
      {
        id: 'hiddenPlan',
        name: 'Hidden Plan',
        planType: 'weekly',
        weekdays: [2],
        startDate: '2099-01-01',
        endDate: '2099-02-01',
        allowSignup: true,
        visibleOnTeamPage: false,
      },
    ];

    const publicHtml = await renderPlans(plans, false);
    const staffHtml = await renderPlans(plans, true);

    expect(publicHtml).toContain('Public Plan');
    expect(publicHtml).not.toContain('Hidden Plan');
    expect(publicHtml).not.toContain('edu-cp-card-hidden-badge');
    expect(staffHtml).toContain('Public Plan');
    expect(staffHtml).toContain('Hidden Plan');
    expect(staffHtml).toContain('edu-cp-card-hidden');
    expect(staffHtml).toContain('未公開');
    const hiddenCardStart = staffHtml.indexOf('data-course-plan-id="hiddenPlan"');
    const hiddenCardEnd = staffHtml.indexOf('<div class="edu-course-card', hiddenCardStart + 1);
    const hiddenCardHtml = staffHtml.slice(hiddenCardStart, hiddenCardEnd === -1 ? staffHtml.length : hiddenCardEnd);
    expect(hiddenCardHtml).not.toContain('edu-cp-share-btn');
  });

  test('course plan share links target the club course tab and selected plan', () => {
    const app = {};
    const context = {
      App: app,
      ApiService: {},
      document: {},
      window: { location: { href: 'https://toosterx.com/teams/teamA?teamTab=courses&course=planA&courseTab=ended&courseView=detail' } },
      MINI_APP_BASE_URL: 'https://miniapp.line.me/demo',
      URL,
      URLSearchParams,
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Set,
      Object,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    expect(app._buildEduCoursePlanMiniAppShareUrl('teamA', 'planA', { courseTab: 'ended' }))
      .toBe('https://miniapp.line.me/demo?teamTab=courses&course=planA&courseTab=ended&courseView=detail&team=teamA');
    expect(app._buildEduCoursePlanWebShareUrl('teamA', 'planA', { courseTab: 'ended' }))
      .toBe('https://toosterx.com/teams/teamA?teamTab=courses&course=planA&courseTab=ended&courseView=detail');
    expect(app._getEduCoursePlanShareIntent('teamA'))
      .toEqual({ teamTab: 'courses', planId: 'planA', courseTab: 'ended', openDetail: true });
    context.window.location.href = 'https://toosterx.com/teams/teamA?teamTab=courses&course=planA&courseTab=ended';
    expect(app._getEduCoursePlanShareIntent('teamA'))
      .toEqual({ teamTab: 'courses', planId: 'planA', courseTab: 'ended', openDetail: false });
  });

  test('course plan share detail intent opens the detail overlay after render', async () => {
    let html = '';
    const cards = [];
    const cardById = new Map();
    const makeCard = (id) => {
      const node = {
        getAttribute: jest.fn(name => name === 'data-course-plan-id' ? id : ''),
        classList: { add: jest.fn(), remove: jest.fn() },
        scrollIntoView: jest.fn(),
      };
      cardById.set(id, node);
      return node;
    };
    const container = {};
    Object.defineProperty(container, 'innerHTML', {
      get: () => html,
      set: (value) => {
        html = String(value || '');
        cards.length = 0;
        cardById.clear();
        const re = /data-course-plan-id="([^"]+)"/g;
        let match;
        while ((match = re.exec(html))) cards.push(makeCard(match[1]));
      },
    });
    const plans = [{
      id: 'planA',
      name: 'Plan A',
      planType: 'weekly',
      startDate: '2099-01-01',
      endDate: '2099-02-01',
      maxCapacity: 8,
      allowSignup: true,
    }];
    const app = {
      _courseEnrollCache: {},
      _courseEnrollSummaryCache: {},
      _eduCoursePlanTabByTeam: {},
      isEduClubStaff: jest.fn(() => false),
      _loadEduCoursePlans: jest.fn(() => Promise.resolve(plans)),
      _getCourseEnrollCacheKey: jest.fn(() => null),
      _loadCourseEnrollments: jest.fn(() => Promise.resolve([])),
      getEduStudents: jest.fn(() => []),
      _weekdayLabel: day => String(day),
      currentPage: 'page-team-detail',
      _eduDetailTeamId: 'teamA',
    };
    const context = {
      App: app,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        getElementById: jest.fn(id => id === 'edu-course-plan-list' ? container : null),
        querySelectorAll: jest.fn(selector => selector === '[data-course-plan-id]' ? cards : []),
      },
      window: { location: { href: 'https://toosterx.com/teams/teamA?teamTab=courses&course=planA&courseView=detail' } },
      setTimeout: (fn) => { fn(); return 0; },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Set,
      Object,
      Array,
      URL,
      URLSearchParams,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });
    app.showEduCoursePlanDetail = jest.fn(() => Promise.resolve());

    app._primeEduCoursePlanShareIntent('teamA');
    await app.renderEduCoursePlanList('teamA', false);

    expect(app._eduActiveTab).toBe('course');
    expect(app._eduCoursePlanTabByTeam.teamA).toBe('active');
    expect(app.showEduCoursePlanDetail).toHaveBeenCalledWith('teamA', 'planA');
    expect(cardById.get('planA').classList.add).toHaveBeenCalledWith('edu-cp-card-share-target');
    expect(cardById.get('planA').scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(app._eduCoursePlanShareFocusByTeam.teamA).toBeUndefined();
  });

  test('course list refreshes only visible plans in the selected tab', async () => {
    const container = { innerHTML: '' };
    const plans = [
      {
        id: 'publicActive',
        name: 'Public Active',
        planType: 'weekly',
        startDate: '2099-01-01',
        endDate: '2099-02-01',
        allowSignup: true,
      },
      {
        id: 'hiddenActive',
        name: 'Hidden Active',
        planType: 'weekly',
        startDate: '2099-01-01',
        endDate: '2099-02-01',
        allowSignup: true,
        visibleOnTeamPage: false,
      },
      {
        id: 'endedPlan',
        name: 'Ended Plan',
        planType: 'session',
        startDate: '2000-01-01',
        endDate: '2000-02-01',
        allowSignup: false,
      },
    ];
    const app = {
      _courseEnrollCache: {},
      _courseEnrollSummaryCache: {},
      _eduCoursePlanTabByTeam: {},
      isEduClubStaff: jest.fn(() => false),
      _loadEduCoursePlans: jest.fn(() => Promise.resolve(plans)),
      _getCourseEnrollCacheKey: jest.fn((teamId, planId) => teamId + ':' + planId),
      _loadCourseEnrollmentSummaries: jest.fn((teamId, planIds) => Promise.resolve(
        Object.fromEntries(planIds.map((planId) => [planId, { effectiveApprovedCount: 1, viewerStatuses: {} }]))
      )),
      _loadCourseEnrollments: jest.fn(() => Promise.resolve([])),
      getEduStudents: jest.fn(() => []),
      _weekdayLabel: (day) => ['日', '一', '二', '三', '四', '五', '六'][day] || String(day),
    };
    const context = {
      App: app,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        getElementById: jest.fn((id) => id === 'edu-course-plan-list' ? container : null),
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Set,
      Object,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    await context.App.renderEduCoursePlanList('teamA', false);
    await context.App._eduCoursePlanListRefreshPromise;

    expect(app._loadCourseEnrollmentSummaries).toHaveBeenCalledTimes(1);
    expect(app._loadCourseEnrollmentSummaries).toHaveBeenCalledWith('teamA', ['publicActive']);
    expect(app._loadCourseEnrollments).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain('Public Active');
    expect(container.innerHTML).not.toContain('Hidden Active');
    expect(container.innerHTML).not.toContain('Ended Plan');

    app._eduCoursePlanTabByTeam = { teamA: 'ended' };
    app._loadCourseEnrollmentSummaries.mockClear();
    app._loadCourseEnrollments.mockClear();
    await context.App.renderEduCoursePlanList('teamA', false);
    await context.App._eduCoursePlanListRefreshPromise;

    expect(app._loadCourseEnrollmentSummaries).toHaveBeenCalledTimes(1);
    expect(app._loadCourseEnrollmentSummaries).toHaveBeenCalledWith('teamA', ['endedPlan']);
    expect(app._loadCourseEnrollments).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain('Ended Plan');
    expect(container.innerHTML).not.toContain('Public Active');
    expect(container.innerHTML).not.toContain('Hidden Active');
  });

  test('course list falls back to enrollment refresh when batch summary fails', async () => {
    const container = { innerHTML: '' };
    const plans = [{
      id: 'fallbackPlan',
      name: 'Fallback Plan',
      planType: 'weekly',
      startDate: '2099-01-01',
      endDate: '2099-02-01',
      maxCapacity: 4,
      allowSignup: true,
    }];
    const app = {
      _courseEnrollCache: {},
      _courseEnrollSummaryCache: {},
      _eduCoursePlanTabByTeam: {},
      isEduClubStaff: jest.fn(() => false),
      _loadEduCoursePlans: jest.fn(() => Promise.resolve(plans)),
      _getCourseEnrollCacheKey: jest.fn((teamId, planId) => teamId + ':' + planId),
      _loadCourseEnrollmentSummaries: jest.fn(() => Promise.resolve(null)),
      _loadCourseEnrollments: jest.fn(() => Promise.resolve([{ studentId: 'studentA', status: 'approved' }])),
      getEduStudents: jest.fn(() => []),
      _weekdayLabel: (day) => ['??', '1', '2', '3', '4', '5', '6'][day] || String(day),
    };
    const context = {
      App: app,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        getElementById: jest.fn((id) => id === 'edu-course-plan-list' ? container : null),
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Set,
      Object,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    await context.App.renderEduCoursePlanList('teamA', false);
    await context.App._eduCoursePlanListRefreshPromise;

    expect(app._loadCourseEnrollmentSummaries).toHaveBeenCalledWith('teamA', ['fallbackPlan']);
    expect(app._loadCourseEnrollments).toHaveBeenCalledWith('teamA', 'fallbackPlan');
    expect(plans[0]._effectiveCount).toBe(1);
    expect(container.innerHTML).toContain('1/4');
  });

  test('course list paints cached summary without enrollment refresh', async () => {
    const container = { innerHTML: '' };
    const plans = [{
      id: 'planCached',
      name: 'Cached Plan',
      planType: 'weekly',
      startDate: '2099-01-01',
      endDate: '2099-02-01',
      maxCapacity: 5,
      allowSignup: true,
    }];
    const app = {
      _courseEnrollCache: {},
      _courseEnrollSummaryCache: {
        'teamA:planCached': {
          effectiveApprovedCount: 2,
          viewerStatuses: { studentA: 'approved' },
        },
      },
      _eduCoursePlanTabByTeam: {},
      isEduClubStaff: jest.fn(() => false),
      _loadEduCoursePlans: jest.fn(() => Promise.resolve(plans)),
      _getCourseEnrollCacheKey: jest.fn((teamId, planId) => teamId + ':' + planId),
      _loadCourseEnrollmentSummaries: jest.fn(() => Promise.resolve({})),
      _loadCourseEnrollments: jest.fn(() => Promise.resolve([])),
      getEduStudents: jest.fn(() => [{ id: 'studentA', enrollStatus: 'active', selfUid: 'viewer' }]),
      _weekdayLabel: (day) => ['日', '一', '二', '三', '四', '五', '六'][day] || String(day),
    };
    const context = {
      App: app,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        getElementById: jest.fn((id) => id === 'edu-course-plan-list' ? container : null),
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Set,
      Object,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    await context.App.renderEduCoursePlanList('teamA', false);
    await context.App._eduCoursePlanListRefreshPromise;

    expect(app._loadCourseEnrollmentSummaries).not.toHaveBeenCalled();
    expect(app._loadCourseEnrollments).not.toHaveBeenCalled();
    expect(plans[0]._effectiveCount).toBe(2);
    expect(container.innerHTML).toContain('2/5');
    expect(container.innerHTML).toContain('edu-cp-card-enrolled');
    expect(container.innerHTML).toContain('edu-cp-lessons-btn-enrolled');
    expect(container.innerHTML).toContain('edu-cp-lessons-check');
    expect(container.innerHTML).toContain('aria-label="課堂列表（已報名）"');
    expect(container.innerHTML).toContain('edu-cp-signup-enrolled');
  });

  test('course lesson button only marks plans approved for viewer-owned students', async () => {
    const html = await renderPlans([{
      id: 'otherPlan',
      name: 'Other Plan',
      planType: 'weekly',
      startDate: '2099-01-01',
      endDate: '2099-02-01',
      allowSignup: true,
      _enrollments: [{ studentId: 'otherStudent', status: 'approved' }],
    }], false, 'active', {
      eduStudents: [
        { id: 'studentA', enrollStatus: 'active', selfUid: 'viewer' },
        { id: 'otherStudent', enrollStatus: 'active', selfUid: 'other' },
      ],
    });

    expect(html).not.toContain('edu-cp-card-enrolled');
    expect(html).not.toContain('edu-cp-lessons-btn-enrolled');
    expect(html).not.toContain('edu-cp-lessons-check');
  });

  test('staff course cards show pending review badge from batch summary only when count is positive', async () => {
    const plans = [
      {
        id: 'planPending',
        name: 'Pending Plan',
        planType: 'weekly',
        startDate: '2099-01-01',
        endDate: '2099-02-01',
        maxCapacity: 8,
        allowSignup: true,
      },
      {
        id: 'planClear',
        name: 'Clear Plan',
        planType: 'weekly',
        startDate: '2099-01-01',
        endDate: '2099-02-01',
        maxCapacity: 8,
        allowSignup: true,
      },
    ];
    const loadCourseEnrollmentSummaries = jest.fn(() => Promise.resolve({
      planPending: { effectiveApprovedCount: 3, pendingReviewCount: 2, viewerStatuses: {} },
      planClear: { effectiveApprovedCount: 1, pendingReviewCount: 0, viewerStatuses: {} },
    }));
    const html = await renderPlans(plans, true, 'active', {
      getCourseEnrollCacheKey: jest.fn((teamId, planId) => teamId + ':' + planId),
      loadCourseEnrollmentSummaries,
    });

    expect(loadCourseEnrollmentSummaries).toHaveBeenCalledWith('teamA', ['planPending', 'planClear']);
    expect(html).toContain('aria-label="名單，2 筆待審核"');
    expect(html).toContain('edu-cp-manage-list has-pending-review');
    expect(html).toContain('edu-cp-pending-badge');
    expect(html).toContain('>2</span>');
    expect((html.match(/edu-cp-pending-badge/g) || []).length).toBe(1);
    expect(html).not.toContain('aria-label="名單，0 筆待審核"');
  });

  test('ended course cards keep frozen session count after summary refresh', async () => {
    const plans = [{
      id: 'endedPlan',
      name: 'Ended Plan',
      planType: 'session',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      maxCapacity: 5,
      allowSignup: true,
    }];
    const html = await renderPlans(plans, true, 'ended', {
      todayStr: () => '2026-06-09',
      loadCourseEnrollmentSummaries: jest.fn(() => Promise.resolve({
        endedPlan: { effectiveApprovedCount: 4, viewerStatuses: {} },
      })),
      loadCourseSessions: jest.fn(() => Promise.resolve([
        { id: 's1', status: 'done', date: '2026-05-08', studentIds: ['a'] },
        { id: 's2', status: 'done', date: '2026-05-15', studentIds: ['a', 'b'] },
      ])),
      isCourseSessionFrozenForRoster: (session) => session.status === 'done',
    });

    expect(plans[0]._effectiveCount).toBe(2);
    expect(html).toContain('2/5');
    expect(html).not.toContain('4/5');
  });

  test('course detail modal escapes plan copy and shows derived next class', async () => {
    const overlay = { className: '', innerHTML: '', onclick: null, remove: jest.fn() };
    const appended = [];
    const app = {
      getEduCoursePlans: jest.fn(() => [{
        id: 'planX',
        name: 'Safe Plan',
        planType: 'weekly',
        allowSignup: true,
        courseContent: '<img src=x onerror=alert(1)>Bring water',
        cancellationPolicy: 'Policy <safe>',
        makeupPolicy: 'Makeup <safe>',
        paymentMethod: 'Bank <safe>',
        paymentDeadline: 'Before start',
        trialSessionInfo: 'Trial <safe>',
        minCapacity: 6,
        minAge: 8,
        maxAge: 12,
        genderRestriction: 'female',
        price: 3600,
        totalSessions: 12,
        location: '<script>bad</script>',
        coachName: 'Coach <A>',
        managerName: 'Manager <B>',
        managerContact: 'contact <line>',
        requirementTags: ['需自備球鞋'],
      }]),
      isEduClubStaff: jest.fn(() => false),
      _normalizeCoursePlanViewModel: jest.fn(() => ({
        name: 'Safe Plan',
        typeLabel: '每週課',
        groupName: 'U12',
        coverUrl: '',
        dateText: '2026-05-01 ~ 2026-06-30',
        scheduleText: '週三 09:00-10:30',
        priceText: '免費',
        countText: '3/12 人',
        status: { label: '招生中' },
        tags: ['tag<script>', '需自備球鞋'],
      })),
      _getCoursePlanNextWeeklyOccurrence: jest.fn(() => ({ label: '2026-05-27 09:00' })),
      _isCoursePlanEnded: jest.fn(() => false),
    };
    const context = {
      App: app,
      document: {
        querySelector: jest.fn(() => null),
        createElement: jest.fn(() => overlay),
        body: { appendChild: jest.fn((node) => appended.push(node)) },
      },
      escapeHTML,
      Date,
      console,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    await context.App.showEduCoursePlanDetail('teamA', 'planX');

    expect(appended).toHaveLength(1);
    expect(overlay.innerHTML).toContain('2026-05-27 09:00');
    expect(overlay.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;Bring water');
    expect(overlay.innerHTML).toContain('Policy &lt;safe&gt;');
    expect(overlay.innerHTML).toContain('Makeup &lt;safe&gt;');
    expect(overlay.innerHTML).toContain('Bank &lt;safe&gt;');
    expect(overlay.innerHTML).toContain('Before start');
    expect(overlay.innerHTML).toContain('Trial &lt;safe&gt;');
    expect(overlay.innerHTML).toContain('6 人開班');
    expect(overlay.innerHTML).toContain('8 - 12 歲');
    expect(overlay.innerHTML).toContain('限女性');
    expect(overlay.innerHTML).toContain('edu-course-meta-period');
    expect(overlay.innerHTML).toContain('edu-course-meta-schedule');
    expect(overlay.innerHTML).toContain('edu-course-detail-content');
    expect(overlay.innerHTML).toContain('edu-course-detail-policy');
    expect(overlay.innerHTML).toContain('$3,600');
    expect(overlay.innerHTML).toContain('12 堂 · 約 $300/堂');
    expect(overlay.innerHTML).toContain('Coach &lt;A&gt;');
    expect(overlay.innerHTML).toContain('Manager &lt;B&gt;');
    expect(overlay.innerHTML).toContain('contact &lt;line&gt;');
    expect((overlay.innerHTML.match(/需自備球鞋/g) || []).length).toBe(1);
    expect(overlay.innerHTML).not.toContain('<script>bad</script>');
    expect(overlay.innerHTML).toContain("App.applyCourseEnrollment('teamA','planX',this)");
    expect(overlay.innerHTML).toContain('我要報名');
    expect(overlay.innerHTML).not.toContain('立即報名');
    const scrollIndex = overlay.innerHTML.indexOf('edu-course-detail-scroll');
    expect(scrollIndex).toBeGreaterThan(-1);
    expect(scrollIndex).toBeLessThan(overlay.innerHTML.indexOf('edu-course-detail-meta'));
    expect(overlay.innerHTML.indexOf('edu-course-detail-meta')).toBeLessThan(overlay.innerHTML.indexOf('edu-course-detail-progress'));
    expect(overlay.innerHTML.indexOf('edu-course-detail-progress')).toBeLessThan(overlay.innerHTML.indexOf('edu-course-detail-footer'));
  });

  test('course detail blocks hidden plans for public viewers', async () => {
    const overlay = { className: '', innerHTML: '', onclick: null, remove: jest.fn() };
    const appended = [];
    const app = {
      getEduCoursePlans: jest.fn(() => [{
        id: 'hiddenPlan',
        name: 'Hidden Plan',
        planType: 'weekly',
        allowSignup: true,
        visibleOnTeamPage: false,
      }]),
      isEduClubStaff: jest.fn(() => false),
      _loadCourseEnrollments: jest.fn(() => Promise.resolve([])),
      _isCoursePlanVisibleToUser: jest.fn(() => false),
    };
    const context = {
      App: app,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        querySelector: jest.fn(() => null),
        createElement: jest.fn(() => overlay),
        body: { appendChild: jest.fn((node) => appended.push(node)) },
      },
      escapeHTML,
      Date,
      console,
      Promise,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    await context.App.showEduCoursePlanDetail('teamA', 'hiddenPlan');

    expect(app._loadCourseEnrollments).toHaveBeenCalledWith('teamA', 'hiddenPlan');
    expect(appended).toHaveLength(1);
    expect(overlay.className).toContain('edu-course-detail-hidden-overlay');
    expect(overlay.innerHTML).toContain('課程尚未公開');
    expect(overlay.innerHTML).not.toContain('立即報名');
    expect(overlay.innerHTML).not.toContain('我要報名');
  });

  test('course detail disables signup when all viewer students already enrolled', async () => {
    const overlay = { className: '', innerHTML: '', onclick: null, remove: jest.fn() };
    const appended = [];
    const app = {
      _courseEnrollCache: {},
      _courseEnrollSummaryCache: {},
      getEduCoursePlans: jest.fn(() => [{
        id: 'planEnrolled',
        name: 'Already Enrolled Plan',
        planType: 'weekly',
        weekdays: [1],
        startDate: '2099-01-01',
        endDate: '2099-02-01',
        allowSignup: true,
        visibleOnTeamPage: true,
        maxCapacity: 12,
      }]),
      getEduStudents: jest.fn(() => [{ id: 'stuA', name: '小明', enrollStatus: 'active', selfUid: 'viewer' }]),
      isEduClubStaff: jest.fn(() => false),
      _getCourseEnrollCacheKey: jest.fn((teamId, planId) => teamId + ':' + planId),
      _loadCourseEnrollmentSummaries: jest.fn(async () => ({
        planEnrolled: { effectiveApprovedCount: 1, viewerStatuses: { stuA: 'approved' } },
      })),
      _loadCourseEnrollments: jest.fn(async () => []),
      _isCoursePlanEnded: jest.fn(() => false),
      _weekdayLabel: (day) => ['日', '一', '二', '三', '四', '五', '六'][day] || String(day),
    };
    const context = {
      App: app,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        querySelector: jest.fn(() => null),
        createElement: jest.fn(() => overlay),
        body: { appendChild: jest.fn((node) => appended.push(node)) },
      },
      escapeHTML,
      Date,
      Promise,
      Number,
      String,
      Set,
      Object,
      console,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    await context.App.showEduCoursePlanDetail('teamA', 'planEnrolled');

    expect(app._loadCourseEnrollmentSummaries).toHaveBeenCalledWith('teamA', ['planEnrolled']);
    expect(appended).toHaveLength(1);
    expect(overlay.innerHTML).toContain('學員皆已報名');
    expect(overlay.innerHTML).not.toContain("App.applyCourseEnrollment('teamA','planEnrolled',this)");
  });

  test('course detail shows pending cancel action before all-enrolled state', async () => {
    const overlay = { className: '', innerHTML: '', onclick: null, remove: jest.fn() };
    const appended = [];
    const app = {
      _courseEnrollCache: {},
      _courseEnrollSummaryCache: {},
      getEduCoursePlans: jest.fn(() => [{
        id: 'planPending',
        name: 'Pending Detail Plan',
        planType: 'weekly',
        weekdays: [1],
        startDate: '2099-01-01',
        endDate: '2099-02-01',
        allowSignup: true,
        visibleOnTeamPage: true,
        maxCapacity: 12,
      }]),
      getEduStudents: jest.fn(() => [{ id: 'stuA', name: 'Alice', enrollStatus: 'active', selfUid: 'viewer' }]),
      isEduClubStaff: jest.fn(() => false),
      _getCourseEnrollCacheKey: jest.fn((teamId, planId) => teamId + ':' + planId),
      _loadCourseEnrollmentSummaries: jest.fn(async () => ({
        planPending: { effectiveApprovedCount: 0, viewerStatuses: { stuA: 'pending' } },
      })),
      _loadCourseEnrollments: jest.fn(async () => []),
      _isCoursePlanEnded: jest.fn(() => false),
      _weekdayLabel: (day) => ['日', '一', '二', '三', '四', '五', '六'][day] || String(day),
    };
    const context = {
      App: app,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        querySelector: jest.fn(() => null),
        createElement: jest.fn(() => overlay),
        body: { appendChild: jest.fn((node) => appended.push(node)) },
      },
      escapeHTML,
      Date,
      Promise,
      Number,
      String,
      Set,
      Object,
      console,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    await context.App.showEduCoursePlanDetail('teamA', 'planPending');

    expect(appended).toHaveLength(1);
    expect(overlay.innerHTML).toContain('1位學員審核中');
    expect(overlay.innerHTML).toContain('edu-cp-signup-pending');
    expect(overlay.innerHTML).toContain("App.showCourseEnrollmentPendingCancelDialog('teamA','planPending',this)");
    expect(overlay.innerHTML).not.toContain("App.applyCourseEnrollment('teamA','planPending',this)");
  });

  test('course detail progress keeps upcoming lessons visible in long weekly plans', async () => {
    const overlay = { className: '', innerHTML: '', onclick: null, remove: jest.fn() };
    const appended = [];
    const toDateString = (offsetDays) => {
      const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const pastDates = Array.from({ length: 14 }, (_, index) => toDateString(-28 + index));
    const upcomingDate = toDateString(2);
    const lessonTitles = [
      ...pastDates.map((_, index) => `Past Lesson ${index + 1}`),
      'Upcoming Lesson',
    ];
    const app = {
      getEduCoursePlans: jest.fn(() => [{
        id: 'planLong',
        name: 'Long Plan',
        planType: 'weekly',
        allowSignup: true,
        price: 4500,
        totalSessions: 15,
        weekdays: [1],
        timeSlot: '19:00-20:30',
        lessonTitles,
      }]),
      isEduClubStaff: jest.fn(() => false),
      generateWeeklyDates: jest.fn(() => [...pastDates, upcomingDate]),
      _normalizeCoursePlanViewModel: jest.fn(() => ({
        name: 'Long Plan',
        typeLabel: 'Weekly',
        groupName: 'U12',
        coverUrl: '',
        dateText: `${pastDates[0]} ~ ${upcomingDate}`,
        scheduleText: 'Mon 19:00-20:30',
        priceText: '$4,500',
        countText: '2/12',
        status: { label: 'Open' },
        tags: [],
      })),
      _getCoursePlanNextWeeklyOccurrence: jest.fn(() => ({
        label: `${upcomingDate} 19:00`,
        timestamp: new Date(`${upcomingDate}T19:00:00`).getTime(),
      })),
      _isCoursePlanEnded: jest.fn(() => false),
    };
    const context = {
      App: app,
      document: {
        querySelector: jest.fn(() => null),
        createElement: jest.fn(() => overlay),
        body: { appendChild: jest.fn((node) => appended.push(node)) },
      },
      escapeHTML,
      Date,
      console,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    await context.App.showEduCoursePlanDetail('teamA', 'planLong');

    expect(appended).toHaveLength(1);
    expect(overlay.innerHTML).toContain('Upcoming Lesson');
    expect(overlay.innerHTML).toContain('edu-course-progress-status is-soon');
    expect((overlay.innerHTML.match(/edu-course-progress-row/g) || []).length).toBe(15);
    expect(overlay.innerHTML).not.toContain('edu-course-progress-more');
  });

  test('staff course detail uses shared content without duplicated management actions', async () => {
    const overlay = { className: '', innerHTML: '', onclick: null, remove: jest.fn() };
    const appended = [];
    const app = {
      getEduCoursePlans: jest.fn(() => [{
        id: 'planStaff',
        name: 'Staff Plan',
        planType: 'weekly',
        allowSignup: true,
        courseContent: 'Visible course content',
        cancellationPolicy: '',
        price: 0,
        totalSessions: 4,
        managerName: 'Team Manager',
        managerContact: 'https://line.me/R/ti/p/%40safe',
      }]),
      isEduClubStaff: jest.fn(() => true),
      _normalizeCoursePlanViewModel: jest.fn(() => ({
        name: 'Staff Plan',
        typeLabel: '每週課',
        groupName: 'U12',
        coverUrl: '',
        dateText: '2026-05-01 ~ 2026-06-30',
        scheduleText: '週三 09:00-10:30',
        priceText: '免費',
        countText: '0/8 人',
        status: { label: '招生中' },
        tags: [],
      })),
      _getCoursePlanNextWeeklyOccurrence: jest.fn(() => null),
      _isCoursePlanEnded: jest.fn(() => false),
    };
    const context = {
      App: app,
      document: {
        querySelector: jest.fn(() => null),
        createElement: jest.fn(() => overlay),
        body: { appendChild: jest.fn((node) => appended.push(node)) },
      },
      escapeHTML,
      Date,
      console,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    await context.App.showEduCoursePlanDetail('teamA', 'planStaff');

    expect(appended).toHaveLength(1);
    expect(overlay.innerHTML).toContain('課程內容');
    expect(overlay.innerHTML).toContain('課務聯繫');
    expect(overlay.innerHTML).toContain('課程進度');
    expect(overlay.innerHTML).toContain('edu-course-meta-manager');
    expect(overlay.innerHTML).toContain('edu-course-contact-person');
    expect(overlay.innerHTML).toContain('edu-course-contact-value');
    expect(overlay.innerHTML).toContain('Team Manager');
    expect(overlay.innerHTML).toContain('href="https://line.me/R/ti/p/%40safe"');
    expect(overlay.innerHTML).toContain('我要報名');
    expect(overlay.innerHTML).toContain("App.applyCourseEnrollment('teamA','planStaff',this)");
    expect(overlay.innerHTML).not.toContain('編輯課程');
    expect(overlay.innerHTML).not.toContain('名單管理');
    expect(overlay.innerHTML).not.toContain('edu-course-detail-staff-actions');
    expect(overlay.innerHTML).not.toContain("App.showEduCoursePlanForm('teamA','planStaff')");
    expect(overlay.innerHTML).not.toContain("App.showCourseEnrollmentList('teamA','planStaff')");
    expect(overlay.innerHTML).not.toContain('管理課程');
    expect(overlay.innerHTML).not.toContain('管理名單');
    expect(overlay.innerHTML).not.toContain('取消政策');
    expect(overlay.innerHTML).not.toContain('開課前 7 日可全額退費');
  });

  test('force refresh reloads students and batch summaries before rendering counts', async () => {
    const container = { innerHTML: '' };
    const plans = [{
      id: 'planA',
      name: '最新課程',
      planType: 'weekly',
      weekdays: [2],
      startDate: '2099-01-01',
      endDate: '2099-02-01',
      maxCapacity: 3,
      allowSignup: true,
    }];
    const app = {
      _courseEnrollCache: { 'teamA:planA': [{ studentId: 'old-student', status: 'approved' }] },
      _eduCoursePlanTabByTeam: {},
      isEduClubStaff: jest.fn(() => false),
      _loadEduStudents: jest.fn(() => {
        app._students = [{ id: 'fresh-student', enrollStatus: 'active' }];
        return Promise.resolve(app._students);
      }),
      _loadEduCoursePlans: jest.fn(() => Promise.resolve(plans)),
      _getCourseEnrollCacheKey: jest.fn((teamId, planId) => teamId + ':' + planId),
      _loadCourseEnrollmentSummaries: jest.fn(() => Promise.resolve({
        planA: { effectiveApprovedCount: 1, viewerStatuses: {} },
      })),
      _loadCourseEnrollments: jest.fn(() => Promise.resolve([{ studentId: 'fresh-student', status: 'approved' }])),
      getEduStudents: jest.fn(() => app._students || []),
      _weekdayLabel: (day) => ['日', '一', '二', '三', '四', '五', '六'][day] || String(day),
    };
    const context = {
      App: app,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        getElementById: jest.fn((id) => id === 'edu-course-plan-list' ? container : null),
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Set,
      Object,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    await context.App.renderEduCoursePlanList('teamA', false, { forceRefresh: true });

    expect(app._loadEduStudents).toHaveBeenCalledWith('teamA');
    await context.App._eduCoursePlanListRefreshPromise;
    expect(app._loadCourseEnrollmentSummaries).toHaveBeenCalledWith('teamA', ['planA']);
    expect(app._loadCourseEnrollments).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain('最新課程');
    expect(container.innerHTML).toContain('1/3 人');
    expect(container.innerHTML).not.toContain('old-student');
  });

  test('skips stale course plan list responses before rendering', async () => {
    const container = { innerHTML: '' };
    const app = {
      _courseEnrollCache: {},
      _eduCoursePlanTabByTeam: {},
      isEduClubStaff: jest.fn(() => false),
      _loadEduStudents: jest.fn(async () => {
        app._eduCoursePlanListRequestSeq += 1;
      }),
      _loadEduCoursePlans: jest.fn(() => Promise.resolve([{ id: 'planA', name: 'Plan A', active: true }])),
      _getCourseEnrollCacheKey: jest.fn(() => null),
      _loadCourseEnrollments: jest.fn(() => Promise.resolve([])),
      getEduStudents: jest.fn(() => []),
      _weekdayLabel: (day) => ['日', '一', '二', '三', '四', '五', '六'][day] || String(day),
      currentPage: 'page-team-detail',
      _eduDetailTeamId: 'teamA',
    };
    const context = {
      App: app,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        getElementById: jest.fn((id) => id === 'edu-course-plan-list' ? container : null),
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Set,
      Object,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    const result = await context.App.renderEduCoursePlanList('teamA', false, { forceRefresh: true });

    expect(result).toBe(false);
    expect(app._loadEduCoursePlans).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain('edu-loading');
  });

  test('course plan move uses the currently visible tab order', async () => {
    const app = {
      showToast: jest.fn(),
      renderEduCoursePlanList: jest.fn().mockResolvedValue(),
    };
    const updates = [];
    const context = {
      App: app,
      FirebaseService: {
        listEduCoursePlans: jest.fn(),
        updateEduCoursePlan: jest.fn((teamId, planId, update) => {
          updates.push({ teamId, planId, update });
          return Promise.resolve();
        }),
      },
      document: { getElementById: jest.fn(() => null) },
      console,
      Promise,
      Date,
      Number,
      String,
      Object,
      Array,
      Set,
    };
    vm.runInNewContext(crudSource, context, { filename: 'edu-course-plan.js' });
    app._eduCoursePlanTabByTeam = { teamA: 'active' };
    app._eduCoursePlansCache = {
      teamA: [
        { id: 'current-a', active: true, sortOrder: 10, endDate: '2099-01-01' },
        { id: 'ended-hidden', active: true, sortOrder: 15, endDate: '2000-01-01' },
        { id: 'current-b', active: true, sortOrder: 20, endDate: '2099-01-01' },
      ],
    };

    await app._moveCoursePlan('teamA', 'current-b', -1);

    expect(app._eduCoursePlansCache.teamA.find(p => p.id === 'current-a').sortOrder).toBe(20);
    expect(app._eduCoursePlansCache.teamA.find(p => p.id === 'current-b').sortOrder).toBe(10);
    expect(app._eduCoursePlansCache.teamA.find(p => p.id === 'ended-hidden').sortOrder).toBe(15);
    expect(updates.map(item => item.planId)).toEqual(['current-a', 'current-b']);
    expect(app.renderEduCoursePlanList).toHaveBeenCalledWith('teamA');
  });

  test('course plan form renders optional display fields for editing', async () => {
    const container = { innerHTML: '' };
    const app = {
      showPage: jest.fn(async () => { app.currentPage = 'page-edu-course-plan'; }),
      _loadEduGroups: jest.fn(() => Promise.resolve([])),
      _generateEduId: jest.fn(),
    };
    const context = {
      App: app,
      document: {
        getElementById: jest.fn((id) => id === 'edu-course-plan-page' ? container : null),
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Object,
      Array,
    };
    vm.runInNewContext(crudSource, context, { filename: 'edu-course-plan.js' });
    app._eduCoursePlansCache = {
      teamA: [{
        id: 'planA',
        name: 'Plan A',
        categoryTags: ['fixed', 'beginner'],
        levelLabel: 'U12',
        featureTags: ['small group'],
        requirementTags: ['shoes'],
        includedTags: ['field'],
        targetTags: ['newbie'],
        signupDeadline: '2099-01-10',
        coachName: 'Coach A',
        location: 'Center A',
        managerName: 'Manager A',
        managerContact: 'line@example',
        courseContent: 'Safe course content',
        cancellationPolicy: 'Safe cancellation policy',
        description: 'Safe description',
        featured: true,
      }],
    };

    await app.showEduCoursePlanForm('teamA', 'planA');

    expect(container.innerHTML).toContain('id="edu-cp-category-tags"');
    expect(container.innerHTML).toContain('value="fixed, beginner"');
    expect(container.innerHTML).toContain('placeholder="例：純新手or會傳接球"');
    expect(container.innerHTML).toContain('id="edu-cp-manager-name"');
    expect(container.innerHTML).toContain('Manager A');
    expect(container.innerHTML).toContain('id="edu-cp-manager-contact"');
    expect(container.innerHTML).toContain('line@example');
    expect(container.innerHTML).toContain('id="edu-cp-course-content"');
    expect(container.innerHTML).toContain('Safe course content');
    expect(container.innerHTML).toContain('id="edu-cp-cancellation-policy"');
    expect(container.innerHTML).toContain('Safe cancellation policy');
    expect(container.innerHTML).toContain('id="edu-cp-description"');
    expect(container.innerHTML).toContain('Safe description');
    expect(container.innerHTML).toContain('id="edu-cp-featured" checked');
  });

  test('course plan form v2 keeps saved field ids while grouping advanced sections', () => {
    const container = { innerHTML: '' };
    const app = {
      _buildCoursePlanPaymentMethodField: jest.fn(() => '<div class="edu-cp-payment-method-control"><select id="edu-cp-payment-method-type"><option value="轉帳">轉帳</option><option value="LINE Pay">LINE Pay</option><option value="">空白</option></select><input type="text" id="edu-cp-payment-method-note" value="Bank transfer"><input type="hidden" id="edu-cp-payment-method" value="Bank transfer"></div>'),
      _updateCoursePlanPreview: jest.fn(),
      _renderCoursePlanSessionScheduleFields: jest.fn(),
      _syncEduCoursePlanPaymentMethodField: jest.fn(),
      _renderCoursePlanTemplateSelector: jest.fn(),
      _ensureCoursePlanTemplatesReady: jest.fn(),
    };
    const context = {
      App: app,
      document: { querySelector: jest.fn(() => null) },
      escapeHTML,
      console,
      Object,
      Array,
      String,
    };
    vm.runInNewContext(formV2Source, context, { filename: 'edu-course-plan-form-v2.js' });

    context.App._renderEduCoursePlanFormV2({
      container,
      plan: {
        id: 'planA',
        name: 'Plan A',
        planType: 'weekly',
        allowSignup: true,
        visibleOnTeamPage: false,
        perSessionBilling: true,
        maxCapacity: 12,
        price: 0,
        weekdays: [1, 3],
        timeSlot: '09:00-10:30',
        startDate: '2099-01-01',
        endDate: '2099-03-01',
        description: 'Safe description',
        makeupPolicy: 'Makeup policy',
        paymentMethod: 'Bank transfer',
        paymentDeadline: 'Before first class',
        notifyTargets: 'Ops team',
        trialSessionInfo: 'One trial',
        minCapacity: 6,
        minAge: 8,
        maxAge: 12,
        genderRestriction: 'female',
        featured: true,
      },
      planId: 'planA',
      groupOptions: '<option value="groupA" selected>Group A</option>',
      isWeekly: true,
      tagsValue: () => '',
      fieldValue: (key) => escapeHTML({
        description: 'Safe description',
      }[key] || ''),
      courseContentValue: '',
      cancellationPolicyValue: '',
    });

    expect(container.innerHTML).toContain('edu-cp-form-v2');
    expect(container.innerHTML).toContain('App.expandEduCoursePlanSections()');
    expect(container.innerHTML).toContain('核心設定');
    expect((container.innerHTML.match(/<details class="edu-cp-section edu-cp-advanced-section"/g) || [])).toHaveLength(4);
    expect(container.innerHTML).toContain('id="edu-cp-name"');
    expect(container.innerHTML).toContain('id="edu-cp-price"');
    expect(container.innerHTML).toContain('value="0"');
    expect(container.innerHTML).toContain('id="edu-cp-session-schedule-list"');
    expect(container.innerHTML).toContain('id="edu-cp-visible-on-team"');
    expect(container.innerHTML).not.toContain('id="edu-cp-visible-on-team" checked');
    expect(container.innerHTML).toContain('id="edu-cp-per-session-billing" checked');
    expect(container.innerHTML).toContain('id="edu-cp-min-capacity"');
    expect(container.innerHTML).toContain('value="6"');
    expect(container.innerHTML).toContain('id="edu-cp-min-age"');
    expect(container.innerHTML).toContain('value="8"');
    expect(container.innerHTML).toContain('id="edu-cp-max-age"');
    expect(container.innerHTML).toContain('value="12"');
    expect(container.innerHTML).toContain('id="edu-cp-gender"');
    expect(container.innerHTML).toContain('<option value="female" selected>');
    expect(container.innerHTML).toContain('id="edu-cp-trial-info"');
    expect(container.innerHTML).toContain('One trial');
    expect(container.innerHTML).toContain('id="edu-cp-notify-targets"');
    expect(container.innerHTML).toContain('Ops team');
    expect(container.innerHTML).toContain('id="edu-cp-payment-method"');
    expect(container.innerHTML).toContain('id="edu-cp-payment-method-type"');
    expect(container.innerHTML).toContain('id="edu-cp-payment-method-note"');
    expect(container.innerHTML).toContain('<option value="LINE Pay">LINE Pay</option>');
    expect(container.innerHTML).toContain('<option value="">空白</option>');
    expect(container.innerHTML).toContain('Bank transfer');
    expect(container.innerHTML).toContain('id="edu-cp-payment-deadline"');
    expect(container.innerHTML).toContain('Before first class');
    expect(container.innerHTML).toContain('id="edu-cp-makeup-policy"');
    expect(container.innerHTML).toContain('Makeup policy');
    expect(container.innerHTML).toContain('id="edu-cp-description"');
    expect(container.innerHTML).toContain('edu-cp-featured-icon');
    expect(container.innerHTML).toContain('★');
    expect(container.innerHTML).toContain('id="edu-cp-manager-suggest"');
    expect(container.innerHTML).toContain("App.searchCoursePlanStaff('manager')");
    expect(container.innerHTML).toContain('id="edu-cp-coach-suggest"');
    expect(container.innerHTML).toContain('id="edu-cp-template-selector"');
    expect(container.innerHTML).toContain('id="edu-cp-template-name"');
    expect(container.innerHTML).toContain('App._saveCoursePlanTemplate()');
    expect(container.innerHTML).toContain('id="edu-cp-save-btn"');
    expect(app._updateCoursePlanPreview).toHaveBeenCalled();
    expect(app._renderCoursePlanSessionScheduleFields).toHaveBeenCalled();
    expect(app._syncEduCoursePlanPaymentMethodField).toHaveBeenCalled();
    expect(app._renderCoursePlanTemplateSelector).toHaveBeenCalled();
    expect(app._ensureCoursePlanTemplatesReady).toHaveBeenCalled();
  });

  test('course plan payment helper keeps dropdown value and manual note in the saved field', () => {
    const elements = {
      'edu-cp-payment-method-type': { value: 'LINE Pay' },
      'edu-cp-payment-method-note': { value: '付款連結' },
      'edu-cp-payment-method': { value: '' },
    };
    const context = {
      App: {},
      document: { getElementById: jest.fn((id) => elements[id] || null) },
      escapeHTML,
      console,
      Object,
      String,
      Array,
      Date,
      Math,
    };
    vm.runInNewContext(crudSource, context, { filename: 'edu-course-plan.js' });

    const html = context.App._buildCoursePlanPaymentMethodField('轉帳：台新 123');
    expect(html).toContain('id="edu-cp-payment-method-type"');
    expect(html).toContain('<option value="轉帳" selected>');
    expect(html).toContain('value="台新 123"');
    expect(html).toContain('<option value="">空白</option>');

    expect(context.App._syncEduCoursePlanPaymentMethodField()).toBe('LINE Pay 付款連結');
    expect(elements['edu-cp-payment-method'].value).toBe('LINE Pay 付款連結');
  });

  test('course plan staff search matches user nicknames with fuzzy matching', () => {
    const suggest = { innerHTML: '', classList: { add: jest.fn(), remove: jest.fn() } };
    const elements = {
      'edu-cp-coach-name': { value: '阿球' },
      'edu-cp-coach-suggest': suggest,
    };
    const app = {
      _eduCoursePlanEditTeamId: 'teamA',
    };
    const context = {
      App: app,
      ApiService: {
        getTeams: jest.fn(() => [{
          id: 'teamA',
          coachUids: ['coachA'],
          coachNames: ['王教練'],
        }]),
        getAdminUsers: jest.fn(() => [{
          uid: 'coachA',
          displayName: '王大明',
          nickname: '阿球',
        }]),
      },
      document: { getElementById: jest.fn((id) => elements[id] || null) },
      escapeHTML,
      console,
      Object,
      String,
      Array,
      Date,
      Map,
      Set,
      encodeURIComponent,
      decodeURIComponent,
    };
    vm.runInNewContext(crudSource, context, { filename: 'edu-course-plan.js' });
    context.App._eduCoursePlanEditTeamId = 'teamA';

    context.App.searchCoursePlanStaff('coach');

    expect(suggest.innerHTML).toContain('王大明');
    expect(suggest.innerHTML).toContain('教練');
    expect(suggest.classList.add).toHaveBeenCalledWith('show');
  });

  test('course plan templates save reusable fields but omit date fields', () => {
    const elements = {
      'edu-cp-group': { value: 'groupA', selectedOptions: [{ dataset: { name: 'Group A' } }] },
      'edu-cp-name': { value: '春季班' },
      'edu-cp-type': { value: 'session' },
      'edu-cp-signup': { checked: true },
      'edu-cp-visible-on-team': { checked: true },
      'edu-cp-per-session-billing': { checked: true },
      'edu-cp-capacity': { value: '12' },
      'edu-cp-price': { value: '2400' },
      'edu-cp-category-tags': { value: 'fixed, beginner' },
      'edu-cp-level-label': { value: 'U12' },
      'edu-cp-feature-tags': { value: 'small group' },
      'edu-cp-requirement-tags': { value: 'shoes' },
      'edu-cp-included-tags': { value: 'field' },
      'edu-cp-target-tags': { value: 'newbie' },
      'edu-cp-signup-deadline': { value: '2099-01-10' },
      'edu-cp-manager-name': { value: 'Manager A' },
      'edu-cp-manager-contact': { value: 'line@example' },
      'edu-cp-notify-targets': { value: 'Ops team' },
      'edu-cp-coach-name': { value: 'Coach A' },
      'edu-cp-location': { value: 'Center A' },
      'edu-cp-course-content': { value: 'Safe course content' },
      'edu-cp-description': { value: 'Safe description' },
      'edu-cp-payment-method-type': { value: '轉帳' },
      'edu-cp-payment-method-note': { value: '台新 123' },
      'edu-cp-payment-method': { value: '' },
      'edu-cp-payment-deadline': { value: 'Before class' },
      'edu-cp-makeup-policy': { value: 'Makeup once' },
      'edu-cp-cancellation-policy': { value: 'Safe cancellation policy' },
      'edu-cp-trial-info': { value: 'Trial info' },
      'edu-cp-min-capacity': { value: '6' },
      'edu-cp-min-age': { value: '8' },
      'edu-cp-max-age': { value: '12' },
      'edu-cp-gender': { value: 'female' },
      'edu-cp-featured': { checked: true },
      'edu-cp-start': { value: '2099-01-01' },
      'edu-cp-end': { value: '2099-03-01' },
      'edu-cp-timeslot': { value: '09:00-10:30' },
      'edu-cp-total': { value: '2' },
      'edu-cp-session-date-1': { value: '2099-06-03' },
      'edu-cp-session-start-1': { value: '18:00' },
      'edu-cp-session-end-1': { value: '19:00' },
      'edu-cp-session-date-2': { value: '2099-06-10' },
      'edu-cp-session-start-2': { value: '20:00' },
      'edu-cp-session-end-2': { value: '21:30' },
      'edu-cp-cover-preview': { querySelector: jest.fn(() => null) },
    };
    const context = {
      App: {},
      document: {
        getElementById: jest.fn((id) => elements[id] || null),
        querySelectorAll: jest.fn((selector) => selector === '#edu-cp-weekdays .edu-wd-checked'
          ? [{ dataset: { day: '1' } }, { dataset: { day: '3' } }]
          : []),
      },
      escapeHTML,
      console,
      Object,
      String,
      Array,
      Date,
      Math,
      Number,
      parseInt,
    };
    vm.runInNewContext(crudSource, context, { filename: 'edu-course-plan.js' });

    const tpl = context.App._buildCurrentCoursePlanTemplate('常用堂數班');

    expect(tpl.templateType).toBe('coursePlan');
    expect(tpl.name).toBe('常用堂數班');
    expect(tpl.planName).toBe('春季班');
    expect(tpl.perSessionBilling).toBe(true);
    expect(tpl.paymentMethod).toBe('轉帳 台新 123');
    expect(tpl.sessionSchedules).toEqual([
      { date: '', startTime: '18:00', endTime: '19:00' },
      { date: '', startTime: '20:00', endTime: '21:30' },
    ]);
    expect(tpl).not.toHaveProperty('startDate');
    expect(tpl).not.toHaveProperty('endDate');
    expect(tpl).not.toHaveProperty('signupDeadline');
  });

  test('session schedule fields show and update selected time preview', () => {
    const list = { innerHTML: '', querySelector: jest.fn(() => null) };
    const elements = {
      'edu-cp-session-schedule-list': list,
      'edu-cp-total': { value: '2' },
      'edu-cp-start': { value: '2099-06-01' },
      'edu-cp-end': { value: '2099-06-08' },
    };
    const app = {
      _eduCoursePlanSessionScheduleDraft: [
        { date: '2099-06-03', startTime: '18:00', endTime: '19:00' },
      ],
      _getSessionPlanAutoDate: jest.fn((_range, index) => index === 0 ? '2099-06-03' : '2099-06-10'),
    };
    const context = {
      App: app,
      document: { getElementById: jest.fn((id) => elements[id] || null) },
      escapeHTML,
      console,
      Number,
      String,
      Array,
      Math,
      parseInt,
    };
    vm.runInNewContext(crudSource, context, { filename: 'edu-course-plan.js' });

    context.App._renderCoursePlanSessionScheduleFields();

    expect(list.innerHTML).toContain('id="edu-cp-session-time-preview-1"');
    expect(list.innerHTML).toContain('已選時間：18:00~19:00');
    expect(list.innerHTML).toContain('已選時間：19:00~20:30');
    expect(list.innerHTML).toContain('oninput="App._updateCoursePlanSessionTimePreview(1)"');

    const preview = { textContent: '' };
    elements['edu-cp-session-time-preview-1'] = preview;
    elements['edu-cp-session-start-1'] = { value: '10:15' };
    elements['edu-cp-session-end-1'] = { value: '11:45' };

    context.App._updateCoursePlanSessionTimePreview(1);

    expect(preview.textContent).toBe('已選時間：10:15~11:45');
  });

  test('session schedule selected time preview has responsive styling', () => {
    expect(cssSource).toContain('.edu-cp-session-time-preview');
    expect(cssSource).toContain('grid-column: 3 / -1');
    expect(cssSource).toContain('grid-column: 2 / -1');
  });

  test('course plan save preserves optional field payloads', async () => {
    let savedPayload = null;
    const elements = {
      'edu-cp-name': { value: 'Plan A' },
      'edu-cp-group': { value: 'groupA', selectedOptions: [{ dataset: { name: 'Group A' } }] },
      'edu-cp-type': { value: 'weekly' },
      'edu-cp-signup': { checked: true },
      'edu-cp-visible-on-team': { checked: false },
      'edu-cp-per-session-billing': { checked: true },
      'edu-cp-capacity': { value: '12' },
      'edu-cp-price': { value: '2400' },
      'edu-cp-category-tags': { value: 'fixed, beginner' },
      'edu-cp-level-label': { value: 'U12' },
      'edu-cp-feature-tags': { value: 'small group, ball control' },
      'edu-cp-requirement-tags': { value: 'shoes' },
      'edu-cp-included-tags': { value: 'field, coach' },
      'edu-cp-target-tags': { value: 'newbie' },
      'edu-cp-signup-deadline': { value: '2099-01-10' },
      'edu-cp-min-capacity': { value: '6' },
      'edu-cp-min-age': { value: '8' },
      'edu-cp-max-age': { value: '12' },
      'edu-cp-gender': { value: 'female' },
      'edu-cp-trial-info': { value: 'Trial info' },
      'edu-cp-coach-name': { value: 'Coach A' },
      'edu-cp-location': { value: 'Center A' },
      'edu-cp-manager-name': { value: 'Manager A' },
      'edu-cp-manager-contact': { value: 'line@example' },
      'edu-cp-notify-targets': { value: 'Ops team' },
      'edu-cp-course-content': { value: 'Safe course content' },
      'edu-cp-payment-method-type': { value: 'LINE Pay' },
      'edu-cp-payment-method-note': { value: '付款連結' },
      'edu-cp-payment-method': { value: '' },
      'edu-cp-payment-deadline': { value: 'Before class' },
      'edu-cp-makeup-policy': { value: 'Makeup once' },
      'edu-cp-cancellation-policy': { value: 'Safe cancellation policy' },
      'edu-cp-description': { value: 'Safe description' },
      'edu-cp-featured': { checked: true },
      'edu-cp-start': { value: '2099-01-01' },
      'edu-cp-end': { value: '2099-03-01' },
      'edu-cp-timeslot': { value: '09:00-10:30' },
    };
    const app = {
      _eduCoursePlanEditTeamId: 'teamA',
      _eduCoursePlanEditId: 'planA',
      _eduCoursePlansCache: { teamA: [{ id: 'planA' }] },
      _setEduBtnLoading: jest.fn(() => ({ restore: jest.fn() })),
      showToast: jest.fn(),
      goBack: jest.fn(),
      renderEduCoursePlanList: jest.fn(),
      _ensureCoursePlanSessionsFromPlan: jest.fn(async () => ({ created: 2, sessions: [] })),
    };
    const context = {
      App: app,
      FirebaseService: {
        updateEduCoursePlan: jest.fn((_teamId, _planId, payload) => {
          savedPayload = payload;
          return Promise.resolve();
        }),
      },
      document: {
        getElementById: jest.fn((id) => elements[id] || null),
        querySelectorAll: jest.fn((selector) => selector === '#edu-cp-weekdays .edu-wd-checked'
          ? [{ dataset: { day: '1' } }, { dataset: { day: '3' } }]
          : []),
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Object,
      Array,
      parseInt,
    };
    vm.runInNewContext(crudSource, context, { filename: 'edu-course-plan.js' });
    context.App._eduCoursePlanEditTeamId = 'teamA';
    context.App._eduCoursePlanEditId = 'planA';
    context.App._eduCoursePlansCache = { teamA: [{ id: 'planA' }] };

    await context.App.handleSaveEduCoursePlan();

    expect(savedPayload.categoryTags).toEqual(['fixed', 'beginner']);
    expect(savedPayload.featureTags).toEqual(['small group', 'ball control']);
    expect(savedPayload.includedTags).toEqual(['field', 'coach']);
    expect(savedPayload.signupDeadline).toBe('2099-01-10');
    expect(savedPayload.visibleOnTeamPage).toBe(false);
    expect(savedPayload.perSessionBilling).toBe(true);
    expect(savedPayload.minCapacity).toBe(6);
    expect(savedPayload.minAge).toBe(8);
    expect(savedPayload.maxAge).toBe(12);
    expect(savedPayload.genderRestriction).toBe('female');
    expect(savedPayload.trialSessionInfo).toBe('Trial info');
    expect(savedPayload.coachName).toBe('Coach A');
    expect(savedPayload.location).toBe('Center A');
    expect(savedPayload.managerName).toBe('Manager A');
    expect(savedPayload.managerContact).toBe('line@example');
    expect(savedPayload.notifyTargets).toBe('Ops team');
    expect(savedPayload.courseContent).toBe('Safe course content');
    expect(savedPayload.paymentMethod).toBe('LINE Pay 付款連結');
    expect(elements['edu-cp-payment-method'].value).toBe('LINE Pay 付款連結');
    expect(savedPayload.paymentDeadline).toBe('Before class');
    expect(savedPayload.makeupPolicy).toBe('Makeup once');
    expect(savedPayload.cancellationPolicy).toBe('Safe cancellation policy');
    expect(savedPayload.description).toBe('Safe description');
    expect(savedPayload.price).toBe(2400);
    expect(savedPayload.featured).toBe(true);
    expect(savedPayload).not.toHaveProperty('active');
    expect(context.App._ensureCoursePlanSessionsFromPlan).toHaveBeenCalledWith('teamA', expect.objectContaining({
      id: 'planA',
      planType: 'weekly',
    }));
    expect(app.showToast).toHaveBeenCalledWith('課程方案已更新，已補齊 2 堂課堂');
  });

  test('session course plan save persists required per-session schedules', async () => {
    let savedPayload = null;
    const elements = {
      'edu-cp-name': { value: '堂數班' },
      'edu-cp-group': { value: '', selectedOptions: [{ dataset: { name: '' } }] },
      'edu-cp-type': { value: 'session' },
      'edu-cp-signup': { checked: true },
      'edu-cp-capacity': { value: '6' },
      'edu-cp-price': { value: '' },
      'edu-cp-category-tags': { value: '' },
      'edu-cp-level-label': { value: '' },
      'edu-cp-feature-tags': { value: '' },
      'edu-cp-requirement-tags': { value: '' },
      'edu-cp-included-tags': { value: '' },
      'edu-cp-target-tags': { value: '' },
      'edu-cp-signup-deadline': { value: '' },
      'edu-cp-manager-name': { value: '' },
      'edu-cp-manager-contact': { value: '' },
      'edu-cp-coach-name': { value: 'Coach A' },
      'edu-cp-location': { value: 'Center A' },
      'edu-cp-course-content': { value: '' },
      'edu-cp-cancellation-policy': { value: '' },
      'edu-cp-description': { value: '' },
      'edu-cp-featured': { checked: false },
      'edu-cp-start': { value: '' },
      'edu-cp-end': { value: '' },
      'edu-cp-total': { value: '2' },
      'edu-cp-session-date-1': { value: '2099-06-03' },
      'edu-cp-session-start-1': { value: '18:00' },
      'edu-cp-session-end-1': { value: '19:00' },
      'edu-cp-session-date-2': { value: '2099-06-10' },
      'edu-cp-session-start-2': { value: '20:00' },
      'edu-cp-session-end-2': { value: '21:30' },
    };
    const app = {
      _eduCoursePlanEditTeamId: 'teamA',
      _eduCoursePlanEditId: 'planA',
      _eduCoursePlansCache: { teamA: [{ id: 'planA' }] },
      _setEduBtnLoading: jest.fn(() => ({ restore: jest.fn() })),
      showToast: jest.fn(),
      goBack: jest.fn(),
      renderEduCoursePlanList: jest.fn(),
      _ensureCoursePlanSessionsFromPlan: jest.fn(async () => ({ created: 0, sessions: [] })),
    };
    const context = {
      App: app,
      FirebaseService: {
        updateEduCoursePlan: jest.fn((_teamId, _planId, payload) => {
          savedPayload = payload;
          return Promise.resolve();
        }),
      },
      document: {
        getElementById: jest.fn((id) => elements[id] || null),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Object,
      Array,
      Math,
      parseInt,
    };
    vm.runInNewContext(crudSource, context, { filename: 'edu-course-plan.js' });
    context.App._eduCoursePlanEditTeamId = 'teamA';
    context.App._eduCoursePlanEditId = 'planA';
    context.App._eduCoursePlansCache = { teamA: [{ id: 'planA' }] };

    await context.App.handleSaveEduCoursePlan();

    expect(savedPayload.totalSessions).toBe(2);
    expect(savedPayload.weekdays).toBeNull();
    expect(savedPayload.timeSlot).toBeNull();
    expect(savedPayload.startDate).toBe('2099-06-03');
    expect(savedPayload.endDate).toBe('2099-06-10');
    expect(savedPayload.sessionSchedules).toEqual([
      { date: '2099-06-03', startTime: '18:00', endTime: '19:00' },
      { date: '2099-06-10', startTime: '20:00', endTime: '21:30' },
    ]);
    expect(app.showToast).toHaveBeenCalledWith('課程方案已更新');
  });

  test('session course plan save blocks missing per-session schedule fields', async () => {
    const elements = {
      'edu-cp-name': { value: '堂數班' },
      'edu-cp-group': { value: '', selectedOptions: [{ dataset: { name: '' } }] },
      'edu-cp-type': { value: 'session' },
      'edu-cp-signup': { checked: true },
      'edu-cp-capacity': { value: '' },
      'edu-cp-price': { value: '' },
      'edu-cp-category-tags': { value: '' },
      'edu-cp-level-label': { value: '' },
      'edu-cp-feature-tags': { value: '' },
      'edu-cp-requirement-tags': { value: '' },
      'edu-cp-included-tags': { value: '' },
      'edu-cp-target-tags': { value: '' },
      'edu-cp-signup-deadline': { value: '' },
      'edu-cp-manager-name': { value: '' },
      'edu-cp-manager-contact': { value: '' },
      'edu-cp-coach-name': { value: '' },
      'edu-cp-location': { value: '' },
      'edu-cp-course-content': { value: '' },
      'edu-cp-cancellation-policy': { value: '' },
      'edu-cp-description': { value: '' },
      'edu-cp-featured': { checked: false },
      'edu-cp-start': { value: '' },
      'edu-cp-end': { value: '' },
      'edu-cp-total': { value: '2' },
      'edu-cp-session-date-1': { value: '2099-06-03' },
      'edu-cp-session-start-1': { value: '18:00' },
      'edu-cp-session-end-1': { value: '19:00' },
      'edu-cp-session-date-2': { value: '' },
      'edu-cp-session-start-2': { value: '20:00' },
      'edu-cp-session-end-2': { value: '21:30' },
    };
    const app = {
      _eduCoursePlanEditTeamId: 'teamA',
      _eduCoursePlanEditId: 'planA',
      _setEduBtnLoading: jest.fn(() => ({ restore: jest.fn() })),
      showToast: jest.fn(),
    };
    const context = {
      App: app,
      FirebaseService: {
        updateEduCoursePlan: jest.fn(() => Promise.resolve()),
      },
      document: {
        getElementById: jest.fn((id) => elements[id] || null),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Object,
      Array,
      Math,
      parseInt,
    };
    vm.runInNewContext(crudSource, context, { filename: 'edu-course-plan.js' });
    context.App._eduCoursePlanEditTeamId = 'teamA';
    context.App._eduCoursePlanEditId = 'planA';

    await context.App.handleSaveEduCoursePlan();

    expect(context.FirebaseService.updateEduCoursePlan).not.toHaveBeenCalled();
    expect(app.showToast).toHaveBeenCalledWith('請填寫第 2 堂的日期與時段');
  });
  test('enrolled weekly course card renders next lesson registration button', async () => {
    const html = await renderPlans([
      {
        id: 'weeklyPlan',
        name: '社區指導班',
        planType: 'weekly',
        startDate: '2099-07-01',
        endDate: '2099-08-31',
        allowSignup: false,
        _enrollments: [{ studentId: 'stu1', status: 'approved' }],
      },
    ], false, 'active', {
      todayStr: () => '2099-07-01',
      eduStudents: [{ id: 'stu1', name: '小華', enrollStatus: 'active', selfUid: 'viewer' }],
      loadCourseSessions: jest.fn(async () => [{
        id: 'sess1',
        date: '2099-07-09',
        startTime: '19:00',
        endTime: '20:30',
        status: 'scheduled',
      }]),
    });

    expect(html).toContain('下堂課');
    expect(html).toContain('edu-cp-next-lesson-action');
    expect(html).toContain('edu-cp-next-lesson-register-btn');
    expect(html).toContain('立即報名7/09的課程');
    expect(html).toContain("App.showCoursePlanNextLessonRegisterDialog('teamA','weeklyPlan','sess1',this)");
  });

  test('enrolled weekly private roster course card hides next lesson registration button', async () => {
    const html = await renderPlans([
      {
        id: 'privatePlan',
        name: 'Private weekly plan',
        planType: 'weekly',
        rosterPublic: false,
        startDate: '2099-07-01',
        endDate: '2099-08-31',
        allowSignup: false,
        _enrollments: [{ studentId: 'stu1', status: 'approved' }],
      },
    ], false, 'active', {
      todayStr: () => '2099-07-01',
      eduStudents: [{ id: 'stu1', name: 'Student 1', enrollStatus: 'active', selfUid: 'viewer' }],
      loadCourseSessions: jest.fn(async () => [{
        id: 'sess1',
        date: '2099-07-09',
        startTime: '19:00',
        endTime: '20:30',
        status: 'scheduled',
      }]),
    });

    expect(html).toContain('edu-cp-next-lesson-badge');
    expect(html).toContain('下堂課7/09');
    expect(html).not.toContain('edu-cp-next-lesson-register-btn');
  });

  test('next lesson registration dialog confirms time/place and saves registered attendance', async () => {
    const confirmButton = { onclick: null };
    const overlay = {
      className: '',
      innerHTML: '',
      onclick: null,
      remove: jest.fn(),
      querySelector: jest.fn((selector) => selector === '[data-edu-course-card-register-confirm="true"]' ? confirmButton : null),
      querySelectorAll: jest.fn(() => [{ value: 'stu1' }]),
    };
    const sourceButton = {
      textContent: '立即報名7/09的課程',
      disabled: false,
      setAttribute: jest.fn(),
      classList: { add: jest.fn() },
    };
    const app = {
      _withButtonLoading: jest.fn((_button, _text, fn) => fn()),
      _rememberCourseLessonRosterPayload: jest.fn(),
      _clearCourseLessonRosterPayloadCache: jest.fn(),
      showToast: jest.fn(),
    };
    const firebase = {
      listEduCoursePublicRoster: jest.fn(async () => ({
        session: {
          id: 'sess1',
          title: '第 1 堂',
          date: '2099-07-09',
          startTime: '19:00',
          endTime: '20:30',
          location: '南屯運動中心',
        },
        students: [{
          studentId: 'stu1',
          displayName: '小華',
          attendanceKind: 'leave',
          canSelfLeave: true,
          selfUid: 'viewer',
          parentUid: null,
        }],
      })),
      saveEduCourseSelfAttendance: jest.fn(async () => ({ success: true, changed: 1, kind: 'registered' })),
    };
    const context = {
      App: app,
      FirebaseService: firebase,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        querySelector: jest.fn(() => null),
        createElement: jest.fn(() => overlay),
        body: { appendChild: jest.fn() },
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Set,
      Object,
      Array,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    expect(context.App.showCoursePlanNextLessonRegisterDialog('teamA', 'weeklyPlan', 'sess1', sourceButton)).toBe(false);
    await app._withButtonLoading.mock.results[0].value;

    expect(firebase.listEduCoursePublicRoster).toHaveBeenCalledWith('teamA', 'weeklyPlan', 'sess1', { forceRefresh: true });
    expect(overlay.innerHTML).toContain('時間：2099-07-09 19:00 - 20:30');
    expect(overlay.innerHTML).toContain('地點：南屯運動中心');

    expect(confirmButton.onclick()).toBe(false);
    await app._withButtonLoading.mock.results[1].value;

    expect(firebase.saveEduCourseSelfAttendance).toHaveBeenCalledWith({
      teamId: 'teamA',
      planId: 'weeklyPlan',
      sessionId: 'sess1',
      date: '2099-07-09',
      studentId: 'stu1',
      studentName: '小華',
      selfUid: 'viewer',
      parentUid: null,
      kind: 'registered',
    });
    expect(sourceButton.textContent).toBe('已報名');
    expect(sourceButton.disabled).toBe(true);
    expect(app.showToast).toHaveBeenCalledWith('已完成報名上課');
  });
  test('next lesson registration dialog blocks inactive roster session', async () => {
    const overlay = {
      className: '',
      innerHTML: '',
      onclick: null,
      remove: jest.fn(),
      querySelector: jest.fn(() => null),
      querySelectorAll: jest.fn(() => []),
    };
    const sourceButton = {
      textContent: 'register',
      disabled: false,
      setAttribute: jest.fn(),
      classList: { add: jest.fn() },
    };
    const app = {
      _withButtonLoading: jest.fn((_button, _text, fn) => fn()),
      _rememberCourseLessonRosterPayload: jest.fn(),
      showToast: jest.fn(),
    };
    const firebase = {
      listEduCoursePublicRoster: jest.fn(async () => ({
        session: {
          id: 'sess1',
          date: '2099-07-09',
          startTime: '19:00',
          endTime: '20:30',
          status: 'cancelled',
        },
        students: [{
          studentId: 'stu1',
          displayName: 'Student 1',
          attendanceKind: 'leave',
          canSelfLeave: true,
        }],
      })),
      saveEduCourseSelfAttendance: jest.fn(),
    };
    const context = {
      App: app,
      FirebaseService: firebase,
      ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
      document: {
        querySelector: jest.fn(() => null),
        createElement: jest.fn(() => overlay),
        body: { appendChild: jest.fn() },
      },
      escapeHTML,
      console,
      Promise,
      Date,
      Number,
      String,
      Set,
      Object,
      Array,
    };
    vm.runInNewContext(source, context, { filename: 'edu-course-plan-render.js' });

    expect(context.App.showCoursePlanNextLessonRegisterDialog('teamA', 'weeklyPlan', 'sess1', sourceButton)).toBe(false);
    await app._withButtonLoading.mock.results[0].value;

    expect(firebase.saveEduCourseSelfAttendance).not.toHaveBeenCalled();
    expect(context.document.body.appendChild).not.toHaveBeenCalled();
    expect(app.showToast).toHaveBeenCalledWith('\u9019\u5802\u8ab2\u76ee\u524d\u7121\u6cd5\u5831\u540d');
  });

});
