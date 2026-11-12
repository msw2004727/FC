// O4（顧問 §3.117）：統計觸發器事件年齡上限與佇列世代預檢；不改統計算法與寫入欄位。
const {
  MAX_RETRY_EVENT_AGE_MS,
  calculateUserAttendanceSummary,
  createUserAttendanceStatsExports,
} = require('../../functions/user-attendance-stats');
const { computeUserAttendanceStats } = require('../../functions/user-attendance-stats-core');

const UID = 'U1234567890abcdef';
const NOW = Date.parse('2026-11-12T10:00:00Z');

function matches(row, filter) {
  const value = row[filter.field];
  if (filter.op === '==') return value === filter.value;
  if (filter.op === 'in') return filter.value.includes(value);
  throw new Error(`unsupported op ${filter.op}`);
}

function createFakeDb({ queue = {}, events = [], registrations = [], activityRecords = [], attendanceRecords = [] } = {}) {
  const state = { queue: { ...queue }, summaries: {} };
  const calls = { collectionGroup: 0, queueReads: 0, batches: [] };
  const groups = { registrations, activityRecords, attendanceRecords };
  function makeQuery(rowsFn, onGet) {
    const filters = [];
    const query = {
      where(field, op, value) { filters.push({ field, op, value }); return query; },
      select() { return query; },
      async get() {
        if (onGet) onGet();
        const rows = rowsFn().filter((row) => filters.every((f) => matches(row.data, f)));
        return {
          docs: rows.map((row) => ({ id: row.id, ref: { parent: { parent: {} } }, data: () => row.data })),
        };
      },
    };
    return query;
  }
  function queueRef(id) {
    return {
      kind: 'queue',
      id,
      async get() {
        calls.queueReads += 1;
        const data = state.queue[id];
        return { exists: !!data, data: () => data };
      },
    };
  }
  const db = {
    collection(name) {
      if (name === 'userAttendanceStatsQueue') return { doc: queueRef };
      if (name === 'userAttendanceStats') return { doc: (id) => ({ kind: 'summary', id }) };
      if (name === 'events') {
        return makeQuery(() => events.map((data, index) => ({ id: data._docId || `doc-${index}`, data })));
      }
      if (name === 'eventAttendanceFlags') return makeQuery(() => []);
      throw new Error(`unexpected collection ${name}`);
    },
    collectionGroup(name) {
      return makeQuery(
        () => (groups[name] || []).map((data, index) => ({ id: `${name}-${index}`, data })),
        () => { calls.collectionGroup += 1; },
      );
    },
    async runTransaction(fn) {
      const pending = [];
      await fn({
        get: (ref) => ref.get(),
        set: (ref, data) => pending.push(() => { state.summaries[ref.id] = data; }),
        delete: (ref) => pending.push(() => { delete state.queue[ref.id]; }),
      });
      pending.forEach((apply) => apply());
    },
    batch() {
      const ops = [];
      return {
        set: (ref, data) => ops.push({ id: ref.id, data }),
        commit: async () => { calls.batches.push(ops); },
      };
    },
  };
  return { db, state, calls };
}

function build(db) {
  return createUserAttendanceStatsExports({
    db,
    FieldValue: { increment: (n) => ({ inc: n }), serverTimestamp: () => 'ts' },
    Timestamp: { now: () => 'now-ts' },
    onDocumentWritten: jest.fn((options, handler) => ({ options, handler })),
    onSchedule: jest.fn((options, handler) => ({ options, handler })),
  });
}

const isoAgo = (ms) => new Date(NOW - ms).toISOString();
const queueEvent = (generation, time) => ({
  time,
  params: { uid: UID },
  data: { after: { exists: true, data: () => ({ generation }) } },
});

// 沿用 user-attendance-stats.test.js「rounds attendance rate」的資料：三場已結束、報名三場、簽到兩場。
const fixture = () => ({
  events: [
    { id: 'e1', _docId: 'doc-e1', status: 'ended' },
    { id: 'e2', _docId: 'doc-e2', status: 'ended' },
    { id: 'e3', _docId: 'doc-e3', status: 'ended' },
  ],
  registrations: ['e1', 'e2', 'e3'].map((eventId) => ({
    userId: UID, eventId, status: 'confirmed', participantType: 'self',
  })),
  activityRecords: [],
  attendanceRecords: ['e1', 'e2'].map((eventId) => ({
    uid: UID, eventId, type: 'checkin', status: 'active',
  })),
});

describe('O4 stats trigger stale-event guard', () => {
  let warnSpy;
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('threshold is two hours', () => {
    expect(MAX_RETRY_EVENT_AGE_MS).toBe(2 * 60 * 60 * 1000);
  });

  test('queue worker drops an event older than the threshold, reads nothing, and logs masked ids', async () => {
    const { db, state, calls } = createFakeDb({ queue: { [UID]: { generation: 1 } }, ...fixture() });
    const exportsMap = build(db);
    await expect(exportsMap.rebuildUserAttendanceStatsFromQueue.handler(
      queueEvent(1, isoAgo(MAX_RETRY_EVENT_AGE_MS + 60 * 1000)),
    )).resolves.toBeUndefined();
    expect(calls.queueReads).toBe(0);
    expect(calls.collectionGroup).toBe(0);
    expect(state.summaries).toEqual({});
    expect(state.queue[UID]).toEqual({ generation: 1 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message, detail] = warnSpy.mock.calls[0];
    expect(message).toContain('[rebuildUserAttendanceStatsFromQueue]');
    expect(detail).toMatchObject({ ageMinutes: 121, maxAgeMinutes: 120 });
    expect(detail.params.uid).toMatch(/^U1\*+ef$/);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(UID);
  });

  test('source enqueue trigger drops a stale event without writing the queue', async () => {
    const { db, calls } = createFakeDb();
    const exportsMap = build(db);
    const result = await exportsMap.onUserAttendanceRegistrationWrite.handler({
      time: isoAgo(3 * 60 * 60 * 1000),
      params: { eventId: 'evtDoc123456', recordId: `reg_${UID}` },
      data: { before: { exists: false }, after: { exists: true, data: () => ({ userId: UID }) } },
    });
    expect(result).toBe(0);
    expect(calls.batches).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[onUserAttendanceRegistrationWrite]');
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(UID);
  });

  test('source enqueue trigger within the threshold enqueues as before', async () => {
    const { db, calls } = createFakeDb();
    const exportsMap = build(db);
    const result = await exportsMap.onUserAttendanceActivityWrite.handler({
      time: isoAgo(MAX_RETRY_EVENT_AGE_MS - 60 * 1000),
      params: { eventId: 'evtDoc123456', recordId: 'act1' },
      data: { before: { exists: false }, after: { exists: true, data: () => ({ uid: UID }) } },
    });
    expect(result).toBe(1);
    expect(calls.batches).toHaveLength(1);
    expect(calls.batches[0][0]).toMatchObject({ id: UID, data: { lastReason: 'activity_write' } });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('missing or unparsable event time is treated as fresh (never dropped)', async () => {
    const { db, calls } = createFakeDb();
    const exportsMap = build(db);
    await exportsMap.onUserAttendanceRecordWrite.handler({
      time: 'not-a-date',
      params: {},
      data: { before: { exists: false }, after: { exists: true, data: () => ({ uid: UID }) } },
    });
    expect(calls.batches).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('fresh queue event with current generation rebuilds with unchanged algorithm output', async () => {
    const data = fixture();
    const { db, state } = createFakeDb({ queue: { [UID]: { generation: 2 } }, ...data });
    const exportsMap = build(db);
    await exportsMap.rebuildUserAttendanceStatsFromQueue.handler(queueEvent(2, isoAgo(5 * 60 * 1000)));
    const written = state.summaries[UID];
    const core = computeUserAttendanceStats({ uid: UID, ...data, attendanceFlags: new Map() });
    expect(written).toEqual({
      uid: UID,
      sourceVersion: core.sourceVersion,
      expectedCount: 3,
      attendedCount: 2,
      completedCount: 0,
      attendRate: 67,
      participatedCount: core.participatedCount,
      countedCount: core.countedCount,
      countedCompletedCount: core.countedCompletedCount,
      countedIncompleteCount: core.countedIncompleteCount,
      countedNoShowCount: core.countedNoShowCount,
      countedSince: core.countedSince,
      updatedAt: 'now-ts',
    });
    const direct = await calculateUserAttendanceSummary({
      db: createFakeDb(data).db, Timestamp: { now: () => 'now-ts' }, uid: UID,
    });
    expect(written).toEqual(direct);
    expect(state.queue[UID]).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('superseded generation skips the full-history reads (same discard rule as the transaction)', async () => {
    const { db, state, calls } = createFakeDb({ queue: { [UID]: { generation: 3 } }, ...fixture() });
    const exportsMap = build(db);
    await exportsMap.rebuildUserAttendanceStatsFromQueue.handler(queueEvent(2, isoAgo(1000)));
    expect(calls.queueReads).toBe(1);
    expect(calls.collectionGroup).toBe(0);
    expect(state.summaries).toEqual({});
    expect(state.queue[UID]).toEqual({ generation: 3 });
  });

  test('already processed queue (doc deleted by the newer generation) skips the rebuild', async () => {
    const { db, state, calls } = createFakeDb({ queue: {}, ...fixture() });
    const exportsMap = build(db);
    await exportsMap.rebuildUserAttendanceStatsFromQueue.handler(queueEvent(1, isoAgo(1000)));
    expect(calls.collectionGroup).toBe(0);
    expect(state.summaries).toEqual({});
  });

  test('flag triggers keep retrying regardless of age (weekly reconcile does not rebuild flags)', async () => {
    const { db } = createFakeDb();
    const exportsMap = build(db);
    const result = await exportsMap.onEventAttendanceFlagWrite.handler({
      time: isoAgo(3 * 60 * 60 * 1000),
      params: { eventId: 'evtDoc123456', recordId: 'r1' },
      data: { before: { exists: false }, after: { exists: true, data: () => ({ type: 'checkin' }) } },
    });
    expect(result).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
