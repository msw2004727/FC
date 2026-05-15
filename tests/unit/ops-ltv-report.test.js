const {
  buildOpsLtvReport,
  clampDateRange,
} = require('../../functions/ops-ltv-report');

describe('ops LTV report helper', () => {
  test('builds DNU, DAU, WAU, MAU and retention from users and login audit entries', () => {
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
    });

    expect(report.summary.dnu).toBe(2);
    expect(report.summary.activeUsers).toBe(3);
    expect(report.summary.avgDau).toBe(1.3);
    expect(report.summary.peakDau).toBe(2);
    expect(report.summary.peakDauDate).toBe('2026-05-02');
    expect(report.summary.wau).toBe(3);
    expect(report.summary.mau).toBe(3);
    expect(report.summary.rangeReturnRate).toBe(50);
    expect(report.retention.nextDay).toMatchObject({ denominator: 2, retained: 1, rate: 50 });
    expect(report.retention.day7).toMatchObject({ denominator: 2, retained: 1, rate: 50 });
    expect(report.retention.day30).toMatchObject({ denominator: 2, retained: 1, rate: 50 });
    expect(report.series).toEqual([
      { date: '2026-05-01', dnu: 1, dau: 1, wau: 1, mau: 1 },
      { date: '2026-05-02', dnu: 1, dau: 2, wau: 2, mau: 2 },
      { date: '2026-05-03', dnu: 0, dau: 1, wau: 3, mau: 3 },
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
