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

async function renderPlans(plans, isStaff = true, selectedTab = 'active') {
  const container = { innerHTML: '' };
  const app = {
    _courseEnrollCache: {},
    _eduCoursePlanTabByTeam: selectedTab === 'ended' ? { teamA: 'ended' } : {},
    isEduClubStaff: jest.fn(() => isStaff),
    _loadEduCoursePlans: jest.fn(() => Promise.resolve(plans)),
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
  await context.App.renderEduCoursePlanList('teamA', isStaff);
  return container.innerHTML;
}

describe('edu course plan render', () => {
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
    expect(cssSource).toContain('.edu-cp-manage-danger');
    expect(cssSource).toContain('width: 5.8rem;');
    expect(cssSource).toContain('min-width: 5.8rem;');
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

    const activeHtml = await renderPlans(plans, true, 'active');
    const endedHtml = await renderPlans(plans, true, 'ended');

    expect(activeHtml).toContain('edu-cp-view-tabs');
    expect(activeHtml).toContain('Active Plan');
    expect(activeHtml).not.toContain('Ended Plan');
    expect(endedHtml).toContain('Ended Plan');
    expect(endedHtml).not.toContain('Active Plan');
    expect(endedHtml).toContain('edu-cp-status-ended');
  });

  test('session course cards open lessons while weekly cards keep explicit actions only', async () => {
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
    expect(html).not.toContain("App.showCourseLessons('teamA','weeklyPlan')");
    expect(html).toContain('data-course-plan-id="sessionPlan"');
    expect(html).toContain('edu-cp-card-clickable');
    expect(html).toContain("App.showCourseLessons('teamA','sessionPlan')");
    expect(html).toContain('edu-cp-detail-btn');
    expect(html).toContain("App.applyCourseEnrollment('teamA','weeklyPlan',this)");
    expect(html).toContain('App.showCourseEnrollmentList');
    expect(html).toContain('edu-cp-manage-btn edu-cp-manage-list');
    expect(html).toContain('edu-cp-manage-btn edu-cp-manage-edit');
    expect(html).toContain('edu-cp-manage-btn edu-cp-manage-danger');
    expect(html).toContain('edu-cp-manage-sort');
    expect(html.indexOf('App.showEduCoursePlanDetail')).toBeLessThan(html.indexOf('App.showCourseEnrollmentList'));
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

  test('staff course detail uses shared content and compact management action', async () => {
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
    expect(overlay.innerHTML).toContain('編輯課程');
    expect(overlay.innerHTML).toContain('名單管理');
    expect(overlay.innerHTML).toContain("App.showEduCoursePlanForm('teamA','planStaff')");
    expect(overlay.innerHTML).toContain("App.showCourseEnrollmentList('teamA','planStaff')");
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
      _updateCoursePlanPreview: jest.fn(),
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
    expect(container.innerHTML).toContain('核心設定');
    expect((container.innerHTML.match(/<details class="edu-cp-section edu-cp-advanced-section"/g) || [])).toHaveLength(4);
    expect(container.innerHTML).toContain('id="edu-cp-name"');
    expect(container.innerHTML).toContain('id="edu-cp-price"');
    expect(container.innerHTML).toContain('value="0"');
    expect(container.innerHTML).toContain('id="edu-cp-visible-on-team"');
    expect(container.innerHTML).not.toContain('id="edu-cp-visible-on-team" checked');
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
    expect(container.innerHTML).toContain('Bank transfer');
    expect(container.innerHTML).toContain('id="edu-cp-payment-deadline"');
    expect(container.innerHTML).toContain('Before first class');
    expect(container.innerHTML).toContain('id="edu-cp-makeup-policy"');
    expect(container.innerHTML).toContain('Makeup policy');
    expect(container.innerHTML).toContain('id="edu-cp-description"');
    expect(container.innerHTML).toContain('id="edu-cp-save-btn"');
    expect(app._updateCoursePlanPreview).toHaveBeenCalled();
  });

  test('course plan save preserves optional field payloads', async () => {
    let savedPayload = null;
    const elements = {
      'edu-cp-name': { value: 'Plan A' },
      'edu-cp-group': { value: 'groupA', selectedOptions: [{ dataset: { name: 'Group A' } }] },
      'edu-cp-type': { value: 'weekly' },
      'edu-cp-signup': { checked: true },
      'edu-cp-visible-on-team': { checked: false },
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
      'edu-cp-payment-method': { value: 'Bank transfer' },
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
    expect(savedPayload.paymentMethod).toBe('Bank transfer');
    expect(savedPayload.paymentDeadline).toBe('Before class');
    expect(savedPayload.makeupPolicy).toBe('Makeup once');
    expect(savedPayload.cancellationPolicy).toBe('Safe cancellation policy');
    expect(savedPayload.description).toBe('Safe description');
    expect(savedPayload.price).toBe(2400);
    expect(savedPayload.featured).toBe(true);
    expect(savedPayload).not.toHaveProperty('active');
  });
});
