const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-plan-render.js'),
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
        groupName: '成人班',
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
      },
    ]);

    expect(html).toContain('edu-course-plan-sections');
    expect(html).toContain('edu-course-plan-section-weekly');
    expect(html).toContain('edu-course-plan-section-session');
    expect(html.indexOf('固定週期課程')).toBeLessThan(html.indexOf('堂數制課程'));
    expect(html).toContain('edu-cp-card-v3 edu-cp-card-weekly');
    expect(html).toContain('edu-cp-card-v3 edu-cp-card-session');
    expect(html).toContain('成人固定班');
    expect(html).toContain('週一、週三 19:00-20:30');
    expect(html).toContain('NT$ 2,400');
    expect(html).toContain('共 8 堂');
    expect(html).toContain('個訓班');
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
});
