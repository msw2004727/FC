const {
  createUserAttendanceStatsExports,
  loadAttendanceFlags,
} = require('../../functions/user-attendance-stats');
const { NOSHOW_V2_SINCE } = require('../../functions/noshow-v2-core');

// 日期一律由起算點常數推出，PM 部署前改常數也不會讓測試失效。
const AFTER_DATE = `${NOSHOW_V2_SINCE.replace(/-/g, '/')} 19:00~21:00`;
const BEFORE_DATE = '2020/1/1 19:00~21:00';

function matches(row, filter) {
  const value = row[filter.field];
  if (filter.op === '==') return value === filter.value;
  if (filter.op === 'in') return filter.value.includes(value);
  throw new Error(`unsupported op ${filter.op}`);
}

// attempts：模擬 transaction 重試次數；beforeAttempt(n) 在第 n 次（從 0 起）嘗試前呼叫，可改資料；只有最後一次嘗試的寫入生效。
function createFakeDb({ events = {}, flags = {}, attempts = 1, beforeAttempt } = {}) {
  const calls = { flagWrites: [], queued: [], queries: [] };
  function makeQuery(label, rowsFn) {
    const filters = [];
    const query = {
      where(field, op, value) { filters.push({ field, op, value }); return query; },
      select() { return query; },
      async get() {
        calls.queries.push({ label, filters: filters.map((f) => ({ ...f })) });
        const rows = rowsFn().filter((row) => filters.every((f) => matches(row.data, f)));
        return { size: rows.length, docs: rows.map((row) => ({ id: row.id, exists: true, data: () => row.data })) };
      },
    };
    return query;
  }
  function eventRef(docId) {
    return {
      id: docId,
      async get() {
        const entry = events[docId];
        return { exists: !!entry, id: docId, data: () => entry && entry.data };
      },
      collection(name) {
        return makeQuery(`${docId}/${name}`, () => ((events[docId] || {})[name] || [])
          .map((data, index) => ({ id: `${name}-${index}`, data })));
      },
    };
  }
  function flagRef(docId) {
    return {
      id: docId,
      async get() {
        const data = flags[docId];
        return { exists: !!data, id: docId, data: () => data };
      },
    };
  }
  const db = {
    collection(name) {
      if (name === 'events') return { doc: eventRef };
      if (name === 'eventAttendanceFlags') {
        return {
          doc: flagRef,
          where: (...args) => makeQuery('flags', () => Object.entries(flags).map(([id, data]) => ({ id, data }))).where(...args),
        };
      }
      if (name === 'userAttendanceStatsQueue') return { doc: (id) => ({ id }) };
      throw new Error(`unexpected collection ${name}`);
    },
    async runTransaction(fn) {
      let result;
      let pending = [];
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (beforeAttempt) beforeAttempt(attempt);
        pending = [];
        result = await fn({
          get: (target) => target.get(),
          set: (ref, data) => pending.push({ id: ref.id, data }),
        });
      }
      pending.forEach(({ id, data }) => {
        flags[id] = data;
        calls.flagWrites.push({ id, data });
      });
      return result;
    },
    batch() {
      const ops = [];
      return {
        set: (ref, data) => ops.push({ ref, data }),
        commit: async () => { ops.forEach((op) => calls.queued.push({ uid: op.ref.id, reason: op.data.lastReason })); },
      };
    },
  };
  return { db, calls, flags };
}

function build(db) {
  return createUserAttendanceStatsExports({
    db,
    FieldValue: { increment: (n) => ({ inc: n }), serverTimestamp: () => 'ts' },
    Timestamp: { now: jest.fn() },
    onDocumentWritten: jest.fn((options, handler) => ({ options, handler })),
    onSchedule: jest.fn((options, handler) => ({ options, handler })),
  });
}

function snap(data) {
  return data ? { exists: true, data: () => data } : { exists: false };
}

const reg = (userId, overrides = {}) => ({ userId, eventId: 'e1', status: 'confirmed', participantType: 'self', ...overrides });
const checkout = (uid, overrides = {}) => ({ uid, eventId: 'e1', type: 'checkout', status: 'active', ...overrides });
const endedEvent = (overrides = {}) => ({
  id: 'e1', status: 'ended', date: AFTER_DATE, creatorUid: 'U-host', delegateUids: ['U-del'], ...overrides,
});

function eventEntry({ data = endedEvent(), registrations, attendanceRecords = [], activityRecords = [] } = {}) {
  return {
    data,
    registrations: registrations || [reg('U-a'), reg('U-b'), reg('U-c', { participantType: 'companion', companionId: 'c1' })],
    attendanceRecords,
    activityRecords,
  };
}

function attendanceWrite(before, after) {
  return { params: { eventId: 'doc-e1', recordId: 'r1' }, data: { before: snap(before), after: snap(after) } };
}

describe('onEventAttendanceFlagWrite', () => {
  test('is wired on the attendanceRecords subcollection in asia-east1 with retry', () => {
    const exportsMap = build({});
    expect(exportsMap.onEventAttendanceFlagWrite.options).toMatchObject({
      document: 'events/{eventId}/attendanceRecords/{recordId}', region: 'asia-east1', retry: true,
    });
  });

  test('checkin-only writes do no database work', async () => {
    const exportsMap = build({});
    await expect(exportsMap.onEventAttendanceFlagWrite.handler(
      attendanceWrite(null, { uid: 'U-a', type: 'checkin' }),
    )).resolves.toBe(0);
  });

  test('first valid checkout flips the flag on and enqueues all non-companion participants', async () => {
    const { db, calls, flags } = createFakeDb({
      events: { 'doc-e1': eventEntry({ attendanceRecords: [checkout('U-a')], activityRecords: [{ uid: 'U-legacy' }] }) },
    });
    const queued = await build(db).onEventAttendanceFlagWrite.handler(attendanceWrite(null, checkout('U-a')));
    expect(flags['doc-e1']).toEqual({ eventId: 'e1', hasCountedCheckout: true, updatedAt: 'ts' });
    expect(queued).toBe(3);
    expect(calls.queued.map((q) => q.uid).sort()).toEqual(['U-a', 'U-b', 'U-legacy']);
    expect(calls.queued[0].reason).toBe('attendance_flag_flip');
  });

  test('unchanged flag value writes nothing and enqueues nothing', async () => {
    const { db, calls } = createFakeDb({
      events: { 'doc-e1': eventEntry({ attendanceRecords: [checkout('U-a'), checkout('U-b')] }) },
      flags: { 'doc-e1': { eventId: 'e1', hasCountedCheckout: true } },
    });
    await expect(build(db).onEventAttendanceFlagWrite.handler(attendanceWrite(null, checkout('U-b')))).resolves.toBe(0);
    expect(calls.flagWrites).toEqual([]);
    expect(calls.queued).toEqual([]);
  });

  test('soft-removing the only valid checkout flips the flag off and re-enqueues', async () => {
    const { db, calls, flags } = createFakeDb({
      events: { 'doc-e1': eventEntry({ attendanceRecords: [checkout('U-a', { status: 'removed' })] }) },
      flags: { 'doc-e1': { eventId: 'e1', hasCountedCheckout: true } },
    });
    const queued = await build(db).onEventAttendanceFlagWrite.handler(
      attendanceWrite(checkout('U-a'), checkout('U-a', { status: 'removed' })),
    );
    expect(flags['doc-e1'].hasCountedCheckout).toBe(false);
    expect(queued).toBe(2);
    expect(calls.flagWrites).toHaveLength(1);
  });

  test('host / delegate / walk-in checkouts never create a flag document', async () => {
    const { db, calls } = createFakeDb({
      events: { 'doc-e1': eventEntry({
        registrations: [reg('U-host'), reg('U-del'), reg('U-a')],
        attendanceRecords: [checkout('U-host'), checkout('U-del'), checkout('U-stranger')],
      }) },
    });
    await expect(build(db).onEventAttendanceFlagWrite.handler(attendanceWrite(null, checkout('U-host')))).resolves.toBe(0);
    expect(calls.flagWrites).toEqual([]);
  });

  test.each([
    ['not ended', endedEvent({ status: 'open' })],
    ['before since', endedEvent({ date: BEFORE_DATE })],
    ['unparsable date', endedEvent({ date: 'TBD' })],
  ])('%s event is skipped without reading subcollections', async (_label, data) => {
    const { db, calls } = createFakeDb({
      events: { 'doc-e1': eventEntry({ data, attendanceRecords: [checkout('U-a')] }) },
    });
    await expect(build(db).onEventAttendanceFlagWrite.handler(attendanceWrite(null, checkout('U-a')))).resolves.toBe(0);
    expect(calls.queries).toEqual([]);
    expect(calls.flagWrites).toEqual([]);
  });

  test('hard-deleting the only valid checkout (after missing) flips the flag off', async () => {
    const { db, calls, flags } = createFakeDb({
      events: { 'doc-e1': eventEntry({ attendanceRecords: [] }) },
      flags: { 'doc-e1': { eventId: 'e1', hasCountedCheckout: true } },
    });
    const queued = await build(db).onEventAttendanceFlagWrite.handler(attendanceWrite(checkout('U-a'), null));
    expect(flags['doc-e1'].hasCountedCheckout).toBe(false);
    expect(queued).toBe(2);
    expect(calls.queued[0].reason).toBe('attendance_flag_flip');
  });

  test('transaction retry re-reads the event: latest delegateUids decide the flag', async () => {
    const events = { 'doc-e1': eventEntry({ attendanceRecords: [checkout('U-a')] }) };
    const { db, calls, flags } = createFakeDb({
      events,
      attempts: 2,
      beforeAttempt: (attempt) => {
        if (attempt === 1) events['doc-e1'].data = endedEvent({ delegateUids: ['U-del', 'U-a'] });
      },
    });
    await expect(build(db).onEventAttendanceFlagWrite.handler(attendanceWrite(null, checkout('U-a')))).resolves.toBe(0);
    expect(flags['doc-e1']).toBeUndefined();
    expect(calls.flagWrites).toEqual([]);
    expect(calls.queued).toEqual([]);
  });

  test('transaction retry re-reads the event: event re-opened mid-retry is skipped', async () => {
    const events = { 'doc-e1': eventEntry({ attendanceRecords: [checkout('U-a')] }) };
    const { db, calls } = createFakeDb({
      events,
      attempts: 2,
      beforeAttempt: (attempt) => {
        if (attempt === 1) events['doc-e1'].data = endedEvent({ status: 'open' });
      },
    });
    await expect(build(db).onEventAttendanceFlagWrite.handler(attendanceWrite(null, checkout('U-a')))).resolves.toBe(0);
    expect(calls.flagWrites).toEqual([]);
  });

  test('stale eventId on an existing flag is rewritten without re-enqueue', async () => {
    const { db, calls, flags } = createFakeDb({
      events: { 'doc-e1': eventEntry({ attendanceRecords: [checkout('U-a')] }) },
      flags: { 'doc-e1': { eventId: 'old-id', hasCountedCheckout: true } },
    });
    await expect(build(db).onEventAttendanceFlagWrite.handler(attendanceWrite(null, checkout('U-a')))).resolves.toBe(0);
    expect(flags['doc-e1'].eventId).toBe('e1');
    expect(calls.queued).toEqual([]);
  });
});

describe('onUserAttendanceEventWrite v2 flag maintenance', () => {
  function eventWrite(before, after) {
    return { params: { eventId: 'doc-e1' }, data: { before: snap(before), after: snap(after) } };
  }

  test('transition to ended computes the flag before enqueueing participants', async () => {
    const { db, calls, flags } = createFakeDb({
      events: { 'doc-e1': eventEntry({ attendanceRecords: [checkout('U-a')] }) },
    });
    const write = eventWrite(endedEvent({ status: 'open' }), endedEvent());
    write.data.after.ref = db.collection('events').doc('doc-e1');
    const queued = await build(db).onUserAttendanceEventWrite.handler(write);
    expect(flags['doc-e1'].hasCountedCheckout).toBe(true);
    expect(queued).toBe(2);
    expect(calls.queued.every((q) => q.reason === 'event_terminal_state')).toBe(true);
  });

  test('delegate change that invalidates the only checkout flips the flag and enqueues', async () => {
    const { db, calls, flags } = createFakeDb({
      // 資料庫裡是寫入後的最新內容（transaction 內以它為準）。
      events: { 'doc-e1': eventEntry({
        data: endedEvent({ delegateUids: ['U-del', 'U-a'] }),
        attendanceRecords: [checkout('U-a')],
      }) },
      flags: { 'doc-e1': { eventId: 'e1', hasCountedCheckout: true } },
    });
    const write = eventWrite(endedEvent(), endedEvent({ delegateUids: ['U-del', 'U-a'] }));
    write.data.after.ref = db.collection('events').doc('doc-e1');
    const queued = await build(db).onUserAttendanceEventWrite.handler(write);
    expect(flags['doc-e1'].hasCountedCheckout).toBe(false);
    expect(queued).toBe(2);
    expect(calls.queued[0].reason).toBe('attendance_flag_event');
  });

  test('stale trigger payload does not decide the flag: latest event document wins', async () => {
    // payload 的 after 只有 U-del 是委託人（U-a 簽退有效），但資料庫最新內容已把 U-a 設為委託人。
    const { db, calls, flags } = createFakeDb({
      events: { 'doc-e1': eventEntry({
        data: endedEvent({ delegateUids: ['U-del', 'U-a'] }),
        attendanceRecords: [checkout('U-a')],
      }) },
    });
    const write = eventWrite(endedEvent({ delegateUids: [] }), endedEvent());
    write.data.after.ref = db.collection('events').doc('doc-e1');
    await expect(build(db).onUserAttendanceEventWrite.handler(write)).resolves.toBe(0);
    expect(flags['doc-e1']).toBeUndefined();
    expect(calls.flagWrites).toEqual([]);
  });

  test('date moved before since re-enqueues only when the stored flag was on', async () => {
    const withFlag = createFakeDb({ flags: { 'doc-e1': { eventId: 'e1', hasCountedCheckout: true } }, events: { 'doc-e1': eventEntry() } });
    const write = eventWrite(endedEvent(), endedEvent({ date: BEFORE_DATE }));
    write.data.after.ref = withFlag.db.collection('events').doc('doc-e1');
    await expect(build(withFlag.db).onUserAttendanceEventWrite.handler(write)).resolves.toBe(2);

    const withoutFlag = createFakeDb({ events: { 'doc-e1': eventEntry() } });
    const write2 = eventWrite(endedEvent(), endedEvent({ date: BEFORE_DATE }));
    write2.data.after.ref = withoutFlag.db.collection('events').doc('doc-e1');
    await expect(build(withoutFlag.db).onUserAttendanceEventWrite.handler(write2)).resolves.toBe(0);
  });

  test('date moved across since into range with a valid checkout flips on and enqueues', async () => {
    const { db, flags } = createFakeDb({ events: { 'doc-e1': eventEntry({ attendanceRecords: [checkout('U-a')] }) } });
    const write = eventWrite(endedEvent({ date: BEFORE_DATE }), endedEvent());
    write.data.after.ref = db.collection('events').doc('doc-e1');
    await expect(build(db).onUserAttendanceEventWrite.handler(write)).resolves.toBe(2);
    expect(flags['doc-e1'].hasCountedCheckout).toBe(true);
  });

  test('unrelated field change on an ended event does no database work', async () => {
    const exportsMap = build({});
    await expect(exportsMap.onUserAttendanceEventWrite.handler(
      eventWrite(endedEvent({ current: 3 }), endedEvent({ current: 4 })),
    )).resolves.toBe(0);
  });
});

describe('loadAttendanceFlags', () => {
  test('reads only ended on/after-since events, chunks in-queries by 30, maps by doc id', async () => {
    const flags = {};
    const events = [];
    for (let i = 0; i < 35; i += 1) {
      events.push({ id: `p${i}`, _docId: `d${i}`, status: 'ended', date: AFTER_DATE });
      if (i % 2 === 0) flags[`d${i}`] = { eventId: `p${i}`, hasCountedCheckout: i % 4 === 0 };
    }
    events.push({ id: 'old', _docId: 'd-old', status: 'ended', date: BEFORE_DATE });
    events.push({ id: 'open', _docId: 'd-open', status: 'open', date: AFTER_DATE });
    flags['d-old'] = { eventId: 'old', hasCountedCheckout: true };
    flags['other-doc'] = { eventId: 'p1', hasCountedCheckout: true };
    const { db, calls } = createFakeDb({ flags });
    const result = await loadAttendanceFlags(db, events);
    expect(calls.queries).toHaveLength(2);
    expect(calls.queries.map((q) => q.filters[0].value.length).sort((a, b) => a - b)).toEqual([5, 30]);
    expect(result.has('d-old')).toBe(false);
    expect(result.has('other-doc')).toBe(false);
    expect(result.get('d0')).toBe(true);
    expect(result.get('d2')).toBe(false);
    expect(result.has('d1')).toBe(false);
  });

  test('no candidate events means no reads', async () => {
    const { db, calls } = createFakeDb();
    const result = await loadAttendanceFlags(db, [{ id: 'x', _docId: 'x', status: 'open', date: AFTER_DATE }]);
    expect(result.size).toBe(0);
    expect(calls.queries).toEqual([]);
  });
});
