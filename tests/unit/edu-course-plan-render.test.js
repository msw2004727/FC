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

  test('compact course cards keep cover overlays and equal-width actions', () => {
    expect(cssSource).toContain('.edu-cp-compact-cover');
    expect(cssSource).toContain('.edu-course-card.edu-cp-card-compact.has-cover::before');
    expect(cssSource).toContain('.edu-course-card.edu-cp-card-compact.has-cover .edu-cp-manage-btn');
    expect(cssSource).toContain('.edu-cp-manage-danger');
    expect(cssSource).toContain('width: 5.8rem;');
    expect(cssSource).toContain('min-width: 5.8rem;');
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

  test('course cards require explicit buttons while roster management stays explicit', async () => {
    const html = await renderPlans([{
      id: 'planA',
      name: 'Plan A',
      planType: 'weekly',
      weekdays: [1],
      startDate: '2099-01-01',
      endDate: '2099-02-01',
      allowSignup: true,
    }], true);

    expect(html).toContain('data-course-plan-id="planA"');
    expect(html).not.toContain('data-course-plan-id="planA" onclick=');
    expect(html).toContain('edu-cp-detail-btn');
    expect(html).toContain('App.showCourseEnrollmentList');
    expect(html).toContain('edu-cp-manage-btn edu-cp-manage-list');
    expect(html).toContain('edu-cp-manage-btn edu-cp-manage-edit');
    expect(html).toContain('edu-cp-manage-btn edu-cp-manage-danger');
    expect(html).toContain('edu-cp-manage-sort');
    expect(html.indexOf('App.showEduCoursePlanDetail')).toBeLessThan(html.indexOf('App.showCourseEnrollmentList'));
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
    expect(overlay.innerHTML).toContain('管理課程');
    expect(overlay.innerHTML).not.toContain('管理名單');
    expect(overlay.innerHTML).not.toContain('編輯課程');
    expect(overlay.innerHTML).not.toContain('取消政策');
    expect(overlay.innerHTML).not.toContain('開課前 7 日可全額退費');
  });

  test('force refresh reloads students and cached enrollments before rendering counts', async () => {
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
    expect(app._loadCourseEnrollments).toHaveBeenCalledWith('teamA', 'planA');
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

  test('course plan save preserves optional field payloads', async () => {
    let savedPayload = null;
    const elements = {
      'edu-cp-name': { value: 'Plan A' },
      'edu-cp-group': { value: 'groupA', selectedOptions: [{ dataset: { name: 'Group A' } }] },
      'edu-cp-type': { value: 'weekly' },
      'edu-cp-signup': { checked: true },
      'edu-cp-capacity': { value: '12' },
      'edu-cp-price': { value: '2400' },
      'edu-cp-category-tags': { value: 'fixed, beginner' },
      'edu-cp-level-label': { value: 'U12' },
      'edu-cp-feature-tags': { value: 'small group, ball control' },
      'edu-cp-requirement-tags': { value: 'shoes' },
      'edu-cp-included-tags': { value: 'field, coach' },
      'edu-cp-target-tags': { value: 'newbie' },
      'edu-cp-signup-deadline': { value: '2099-01-10' },
      'edu-cp-coach-name': { value: 'Coach A' },
      'edu-cp-location': { value: 'Center A' },
      'edu-cp-manager-name': { value: 'Manager A' },
      'edu-cp-manager-contact': { value: 'line@example' },
      'edu-cp-course-content': { value: 'Safe course content' },
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
    expect(savedPayload.coachName).toBe('Coach A');
    expect(savedPayload.location).toBe('Center A');
    expect(savedPayload.managerName).toBe('Manager A');
    expect(savedPayload.managerContact).toBe('line@example');
    expect(savedPayload.courseContent).toBe('Safe course content');
    expect(savedPayload.cancellationPolicy).toBe('Safe cancellation policy');
    expect(savedPayload.description).toBe('Safe description');
    expect(savedPayload.price).toBe(2400);
    expect(savedPayload.featured).toBe(true);
  });
});
