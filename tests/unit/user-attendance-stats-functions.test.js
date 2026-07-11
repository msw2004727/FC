const { createUserAttendanceStatsExports } = require('../../functions/user-attendance-stats');

function buildExports() {
  const onDocumentWritten = jest.fn((options, handler) => ({ options, handler }));
  const onSchedule = jest.fn((options, handler) => ({ options, handler }));
  const exportsMap = createUserAttendanceStatsExports({
    db: {},
    FieldValue: {},
    Timestamp: { now: jest.fn() },
    onDocumentWritten,
    onSchedule,
  });
  return { exportsMap, onDocumentWritten, onSchedule };
}

describe('user attendance stats Cloud Function wiring', () => {
  test('exports all source triggers, serialized queue worker, and weekly reconcile', () => {
    const { exportsMap } = buildExports();
    expect(Object.keys(exportsMap).sort()).toEqual([
      'onUserAttendanceActivityWrite',
      'onUserAttendanceEventWrite',
      'onUserAttendanceRecordWrite',
      'onUserAttendanceRegistrationWrite',
      'rebuildUserAttendanceStatsFromQueue',
      'reconcileUserAttendanceStatsWeekly',
    ]);
  });

  test('source triggers retry and watch every authoritative path', () => {
    const { exportsMap } = buildExports();
    expect(exportsMap.onUserAttendanceRegistrationWrite.options).toMatchObject({
      document: 'events/{eventId}/registrations/{recordId}', retry: true,
    });
    expect(exportsMap.onUserAttendanceRecordWrite.options).toMatchObject({
      document: 'events/{eventId}/attendanceRecords/{recordId}', retry: true,
    });
    expect(exportsMap.onUserAttendanceActivityWrite.options).toMatchObject({
      document: 'events/{eventId}/activityRecords/{recordId}', retry: true,
    });
    expect(exportsMap.onUserAttendanceEventWrite.options).toMatchObject({
      document: 'events/{eventId}', retry: true,
    });
  });

  test('queue worker is retryable and bounded', () => {
    const { exportsMap } = buildExports();
    expect(exportsMap.rebuildUserAttendanceStatsFromQueue.options).toMatchObject({
      document: 'userAttendanceStatsQueue/{uid}',
      retry: true,
      maxInstances: 20,
    });
  });

  test('weekly reconcile uses Taipei time and one scheduler instance', () => {
    const { exportsMap } = buildExports();
    expect(exportsMap.reconcileUserAttendanceStatsWeekly.options).toMatchObject({
      schedule: '20 4 * * 0',
      timeZone: 'Asia/Taipei',
      maxInstances: 1,
    });
  });

  test('irrelevant non-terminal event transition performs no database work', async () => {
    const { exportsMap } = buildExports();
    await expect(exportsMap.onUserAttendanceEventWrite.handler({
      data: {
        before: { exists: true, data: () => ({ id: 'e1', status: 'open' }) },
        after: { exists: true, data: () => ({ id: 'e1', status: 'full' }) },
      },
    })).resolves.toBe(0);
  });

  test('queue delete event exits without rebuilding', async () => {
    const { exportsMap } = buildExports();
    await expect(exportsMap.rebuildUserAttendanceStatsFromQueue.handler({
      data: { after: { exists: false } },
      params: { uid: 'uidA' },
    })).resolves.toBeUndefined();
  });
});
