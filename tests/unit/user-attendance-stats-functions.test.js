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
      'onEventAttendanceFlagWrite',
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

  describe('event document delete enqueues stats rebuild', () => {
    function buildDb() {
      const batchSet = jest.fn();
      const batchCommit = jest.fn().mockResolvedValue(undefined);
      const db = {
        batch: () => ({ set: batchSet, commit: batchCommit }),
        collection: (name) => ({ doc: (id) => ({ name, id }) }),
      };
      return { db, batchSet, batchCommit };
    }
    function subSnap(rows) {
      const query = { select: () => query, get: async () => ({ docs: rows.map((d) => ({ data: () => d })) }) };
      return query;
    }
    function eventSnapshot(data, exists = true) {
      return {
        exists,
        data: () => data,
        ref: {
          collection: (name) => subSnap(name === 'registrations'
            ? [{ userId: 'uidA' }, { userId: 'uidComp', participantType: 'companion', companionId: 'c1' }]
            : [{ uid: 'uidB' }]),
        },
      };
    }
    function build(db) {
      const onDocumentWritten = jest.fn((options, handler) => ({ options, handler }));
      return createUserAttendanceStatsExports({
        db,
        FieldValue: { increment: (n) => ({ inc: n }), serverTimestamp: () => 'ts' },
        Timestamp: { now: jest.fn() },
        onDocumentWritten,
        onSchedule: jest.fn((options, handler) => ({ options, handler })),
      });
    }

    test('deleted event (before exists, after missing) enqueues its participants', async () => {
      const { db, batchSet, batchCommit } = buildDb();
      const exportsMap = build(db);
      const result = await exportsMap.onUserAttendanceEventWrite.handler({
        data: {
          before: eventSnapshot({ id: 'e1', status: 'open' }),
          after: { exists: false },
        },
      });
      expect(result).toBe(2);
      expect(batchCommit).toHaveBeenCalledTimes(1);
      const queuedUids = batchSet.mock.calls.map((call) => call[0].id).sort();
      expect(queuedUids).toEqual(['uidA', 'uidB']);
      expect(batchSet.mock.calls[0][1]).toMatchObject({ lastReason: 'event_terminal_state' });
    });

    test('ordinary update with unchanged id and non-terminal status enqueues nothing', async () => {
      const { db, batchCommit } = buildDb();
      const exportsMap = build(db);
      const result = await exportsMap.onUserAttendanceEventWrite.handler({
        data: {
          before: eventSnapshot({ id: 'e1', status: 'open' }),
          after: eventSnapshot({ id: 'e1', status: 'full' }),
        },
      });
      expect(result).toBe(0);
      expect(batchCommit).not.toHaveBeenCalled();
    });
  });

  test('queue delete event exits without rebuilding', async () => {
    const { exportsMap } = buildExports();
    await expect(exportsMap.rebuildUserAttendanceStatsFromQueue.handler({
      data: { after: { exists: false } },
      params: { uid: 'uidA' },
    })).resolves.toBeUndefined();
  });
});
