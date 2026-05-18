const {
  buildOpsLtvReport,
  clampDateRange,
} = require('../../functions/ops-ltv-report');

describe('ops LTV report helper', () => {
  test('builds active, participation, completion, no-show, and cohort conversion metrics', () => {
    const report = buildOpsLtvReport({
      startDate: '2026-05-01',
      endDate: '2026-05-03',
      nowMs: Date.UTC(2026, 5, 14, 16),
      users: [
        { id: 'u1', data: { createdAt: '2026-05-01T01:00:00+08:00' } },
        { id: 'u2', data: { createdAt: '2026-05-02T01:00:00+08:00' } },
        { id: 'u3', data: { createdAt: '2026-04-01T01:00:00+08:00' } },
      ],
      activeEntriesByDay: {
        '2026-05-01': ['u1'],
        '2026-05-02': ['u1', 'u2'],
        '2026-05-03': ['u3'],
        '2026-05-08': ['u1'],
      },
      events: [
        { id: 'e1', data: { id: 'e1', date: '2026/05/02 19:00~21:00', status: 'ended', type: 'play' } },
        { id: 'e2', data: { id: 'e2', date: '2026/05/03 19:00~21:00', status: 'ended', type: 'play' } },
      ],
      registrations: [
        { id: 'r1', data: { userId: 'u1', eventId: 'e1', status: 'confirmed', participantType: 'self', registeredAt: '2026-05-01T08:00:00+08:00' } },
        { id: 'r2', data: { userId: 'u2', eventId: 'e2', status: 'confirmed', participantType: 'self', registeredAt: '2026-05-02T08:00:00+08:00' } },
        { id: 'r3', data: { userId: 'u3', eventId: 'e2', status: 'confirmed', participantType: 'self', registeredAt: '2026-05-01T08:00:00+08:00' } },
        { id: 'r4', data: { userId: 'u1', eventId: 'e2', status: 'confirmed', participantType: 'companion', companionId: 'c1', registeredAt: '2026-05-01T08:00:00+08:00' } },
      ],
      attendanceRecords: [
        { id: 'a1', data: { uid: 'u1', eventId: 'e1', type: 'checkin', status: 'active', time: '2026/05/02 19:10' } },
        { id: 'a2', data: { uid: 'u1', eventId: 'e1', type: 'checkout', status: 'active', time: '2026/05/02 21:00' } },
        { id: 'a3', data: { uid: 'u3', eventId: 'e2', type: 'checkin', status: 'active', time: '2026/05/03 19:10' } },
      ],
    });

    expect(report.summary.dnu).toBe(2);
    expect(report.summary.activeUsers).toBe(3);
    expect(report.summary.avgDau).toBe(1.3);
    expect(report.summary.peakDau).toBe(2);
    expect(report.summary.peakDauDate).toBe('2026-05-02');
    expect(report.summary.wau).toBe(3);
    expect(report.summary.mau).toBe(3);
    expect(report.summary.rangeReturnRate).toBe(50);
    expect(report.summary.participationUsers).toBe(3);
    expect(report.summary.participationEvents).toBe(3);
    expect(report.summary.completedUsers).toBe(1);
    expect(report.summary.completedEvents).toBe(1);
    expect(report.summary.completionRate).toBe(33.3);
    expect(report.summary.checkinRate).toBe(66.7);
    expect(report.summary.noShowEvents).toBe(1);
    expect(report.summary.noShowRate).toBe(33.3);
    expect(report.summary.participantToActiveRate).toBe(100);
    expect(report.summary.newUserParticipation).toMatchObject({
      cohortSize: 2,
      registeredByRange: 2,
      registeredByRangeRate: 100,
      signup7d: { denominator: 2, converted: 2, rate: 100 },
      complete30d: { denominator: 2, converted: 1, rate: 50 },
      medianDaysToFirstRegistration: 0,
    });
    expect(report.retention.nextDay).toMatchObject({ denominator: 2, retained: 1, rate: 50 });
    expect(report.retention.day7).toMatchObject({ denominator: 2, retained: 1, rate: 50 });
    expect(report.retention.day30).toMatchObject({ denominator: 2, retained: 1, rate: 50 });
    expect(report.series).toEqual([
      { date: '2026-05-01', dnu: 1, dau: 1, wau: 1, mau: 1, participationUsers: 0, participationEvents: 0, completedUsers: 0, completedEvents: 0, completionRate: 0, noShowEvents: 0 },
      { date: '2026-05-02', dnu: 1, dau: 2, wau: 2, mau: 2, participationUsers: 1, participationEvents: 1, completedUsers: 1, completedEvents: 1, completionRate: 100, noShowEvents: 0 },
      { date: '2026-05-03', dnu: 0, dau: 1, wau: 3, mau: 3, participationUsers: 2, participationEvents: 2, completedUsers: 0, completedEvents: 0, completionRate: 0, noShowEvents: 1 },
    ]);
  });

  test('adds lastLogin fallback as an active day when audit entries are missing', () => {
    const report = buildOpsLtvReport({
      startDate: '2026-05-01',
      endDate: '2026-05-01',
      nowMs: Date.UTC(2026, 4, 1, 16),
      users: [
        { id: 'u1', data: { createdAt: '2026-04-01T01:00:00+08:00', lastLogin: '2026-05-01T12:00:00+08:00' } },
      ],
      activeEntriesByDay: {},
    });

    expect(report.series[0].dau).toBe(1);
    expect(report.source.lastLoginFallbackCount).toBe(1);
  });

  test('rejects ranges over 180 days and clamps future end date to today', () => {
    expect(() => clampDateRange({
      startDate: '2025-01-01',
      endDate: '2025-07-01',
      nowMs: Date.UTC(2026, 0, 1, 16),
    })).toThrow('DATE_RANGE_TOO_LARGE');

    expect(clampDateRange({
      startDate: '2026-05-01',
      endDate: '2026-05-20',
      nowMs: Date.UTC(2026, 4, 9, 16),
    })).toMatchObject({ startDate: '2026-05-01', endDate: '2026-05-10' });
  });
});
