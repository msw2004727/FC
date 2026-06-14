const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-ui-adapter.js'),
  'utf8'
);

function loadAdapter() {
  const app = {
    _weekdayLabel: (day) => ['日', '一', '二', '三', '四', '五', '六'][Number(day)] || String(day),
  };
  vm.runInNewContext(source, { App: app, Date, Number, String, Array, Object, RegExp, Math, console });
  return app;
}

describe('education course UI adapter', () => {
  test('normalizes the card view model without demo-only data', () => {
    const app = loadAdapter();
    const vmData = app._normalizeCoursePlanViewModel({
      id: 'planA',
      name: 'U12 Weekly',
      planType: 'weekly',
      weekdays: [1, 3],
      timeSlot: '19:00-20:30',
      startDate: '2026-05-01',
      endDate: '2026-06-30',
      price: 2400,
      maxCapacity: 12,
      _effectiveCount: 5,
      categoryTags: ['fixed'],
      featureTags: ['small-group'],
      requirementTags: ['bring-shoes'],
      coverImage: 'javascript:alert(1)',
    });

    expect(vmData.id).toBe('planA');
    expect(vmData.name).toBe('U12 Weekly');
    expect(vmData.typeLabel).toBe('每週課');
    expect(vmData.scheduleText).toContain('週一');
    expect(vmData.scheduleText).toContain('週三');
    expect(vmData.priceText).toBe('NT$ 2,400');
    expect(vmData.countText).toBe('5/12 人');
    expect(vmData.coverUrl).toBe('');
    expect(vmData.tags).toEqual(['fixed', 'small-group']);
  });

  test('formats blank and zero course prices distinctly', () => {
    const app = loadAdapter();

    expect(app._formatCoursePlanPrice(null)).toBe('');
    expect(app._formatCoursePlanPrice('')).toBe('');
    expect(app._formatCoursePlanPrice(0)).toBe('\u514d\u8cbb');
    expect(app._formatCoursePlanPrice('0')).toBe('\u514d\u8cbb');
    expect(app._isEduCoursePaymentRequired(null)).toBe(false);
    expect(app._isEduCoursePaymentRequired('')).toBe(false);
    expect(app._isEduCoursePaymentRequired(0)).toBe(false);
    expect(app._isEduCoursePaymentRequired({ price: '0' })).toBe(false);
    expect(app._isEduCoursePaymentRequired({ price: '1200' })).toBe(true);
  });

  test('groups current and ended plans by selected tab', () => {
    const app = loadAdapter();
    const buckets = app._getCoursePlanDisplayBuckets([
      { id: 'current', active: true, planType: 'weekly', endDate: '2099-01-01' },
      { id: 'ended', active: true, planType: 'session', endDate: '2000-01-01' },
      { id: 'hidden', active: false, planType: 'weekly', endDate: '2099-01-01' },
    ], 'ended', '2026-05-25');

    expect(buckets.currentPlans.map(plan => plan.id)).toEqual(['current']);
    expect(buckets.endedPlans.map(plan => plan.id)).toEqual(['ended']);
    expect(buckets.visiblePlans.map(plan => plan.id)).toEqual(['ended']);
    expect(buckets.groupedPlans[0].type).toBe('session');
  });

  test('derives the next weekly occurrence from plan fields', () => {
    const app = loadAdapter();
    const next = app._getCoursePlanNextWeeklyOccurrence({
      planType: 'weekly',
      weekdays: [1, 3],
      timeSlot: '09:00-10:30',
      startDate: '2026-05-01',
      endDate: '2026-06-30',
    }, new Date('2026-05-25T10:00:00'));

    expect(next.date).toBe('2026-05-27');
    expect(next.startTime).toBe('09:00');
  });

  test('allows staff and enrolled students to view hidden course plan details', () => {
    const app = loadAdapter();
    app.getEduStudents = jest.fn(() => [
      { id: 'studentA', selfUid: 'viewer', enrollStatus: 'active', groupIds: [] },
      { id: 'studentB', selfUid: 'other', enrollStatus: 'active', groupIds: ['groupA'] },
    ]);

    const hiddenPlan = {
      id: 'planHidden',
      visibleOnTeamPage: false,
      _enrollments: [{ studentId: 'studentA', status: 'pending' }],
    };

    expect(app._isCoursePlanVisibleToUser(hiddenPlan, { teamId: 'teamA', uid: 'viewer', isStaff: false })).toBe(true);
    expect(app._isCoursePlanVisibleToUser(hiddenPlan, { teamId: 'teamA', uid: 'stranger', isStaff: false })).toBe(false);
    expect(app._isCoursePlanVisibleToUser(hiddenPlan, { teamId: 'teamA', uid: 'stranger', isStaff: true })).toBe(true);
  });

  test('does not treat rejected hidden-plan enrollments as view permission', () => {
    const app = loadAdapter();
    app.getEduStudents = jest.fn(() => [
      { id: 'studentA', parentUid: 'viewer', enrollStatus: 'active', groupIds: [] },
    ]);

    expect(app._isCoursePlanVisibleToUser({
      visibleOnTeamPage: false,
      _enrollments: [{ studentId: 'studentA', status: 'rejected' }],
    }, { teamId: 'teamA', uid: 'viewer', isStaff: false })).toBe(false);
  });
});
