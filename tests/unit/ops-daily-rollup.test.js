"use strict";

const { contiguousDateSegments } = require("../../functions/ops-rollup-core");
const { runOpsRollup } = require("../../functions/ops-daily-rollup");

const QA = `U${"0".repeat(28)}0001`;
const NOW = Date.UTC(2026, 10, 8, 19, 0, 0);
const NEXT = Date.UTC(2026, 10, 9, 19, 0, 0);
const FIELD_PATH = { documentId: () => "__name__" };
const Timestamp = {
  fromMillis(ms) {
    return { toMillis: () => ms, seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 };
  },
};

function taipeiMs(dateKey, hours, minutes = 0) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day, hours - 8, minutes, 0, 0);
}

function ts(ms) {
  return Timestamp.fromMillis(ms);
}

function isDocId(field) {
  return field === "__name__";
}

function norm(value) {
  if (value == null) return value;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  return value;
}

function compareDoc(doc, filter) {
  const left = isDocId(filter.field) ? doc.id : doc.data[filter.field];
  if (filter.op === "in") return Array.isArray(filter.value) && filter.value.includes(left);
  const a = norm(left);
  const b = norm(filter.value);
  if (filter.op === "==") return a === b;
  if (a == null || b == null || typeof a !== typeof b) return false;
  if (filter.op === ">=") return a >= b;
  if (filter.op === ">") return a > b;
  if (filter.op === "<=") return a <= b;
  if (filter.op === "<") return a < b;
  throw new Error(`bad op ${filter.op}`);
}

function createFakeDb(seed, hooks = {}) {
  const store = {};
  const writes = [];
  const commits = [];
  const queries = [];
  const subGets = [];
  const flagGets = [];
  const eventReadIds = [];
  const userReadIds = [];
  let readDocs = 0;
  let batchCalls = 0;

  function ensure(name) {
    if (!store[name]) store[name] = new Map();
    return store[name];
  }

  Object.entries(seed || {}).forEach(([name, docs]) => {
    if (name === "sub") return;
    (docs || []).forEach((doc) => ensure(name).set(doc.id, { ...doc.data }));
  });

  function writeDoc(collectionName, id, data) {
    ensure(collectionName).set(id, data);
    writes.push({ path: `${collectionName}/${id}`, data });
  }

  function toSnap(collectionName, docs) {
    readDocs += docs.length;
    docs.forEach((doc) => {
      if (collectionName === "events") eventReadIds.push(doc.id);
      if (collectionName === "users") userReadIds.push(doc.id);
    });
    return {
      size: docs.length,
      empty: docs.length === 0,
      docs: docs.map((doc) => ({
        id: doc.id,
        exists: true,
        data: () => ({ ...doc.data }),
      })),
    };
  }

  function matchDocs(collectionName, filters) {
    return [...ensure(collectionName).entries()]
      .map(([id, data]) => ({ id, data }))
      .filter((doc) => filters.every((filter) => compareDoc(doc, filter)));
  }

  function createQuery(collectionName, filters, order, limitN) {
    return {
      where(field, op, value) {
        if (hooks.failStatus && field === "status") throw new Error(hooks.failStatus);
        if (hooks.failDate && field === "date") throw new Error(hooks.failDate);
        return createQuery(collectionName, filters.concat([{ field, op, value }]), order, limitN);
      },
      orderBy(field, direction) {
        return createQuery(collectionName, filters, { field, direction: direction || "asc" }, limitN);
      },
      limit(n) {
        return createQuery(collectionName, filters, order, n);
      },
      count() {
        return {
          get: async () => {
            readDocs += 1;
            return { data: () => ({ count: matchDocs(collectionName, filters).length }) };
          },
        };
      },
      get: async () => {
        queries.push({
          collection: collectionName,
          filters: filters.map((filter) => ({ field: filter.field, op: filter.op, value: filter.value })),
        });
        let matched = matchDocs(collectionName, filters);
        if (order) {
          matched = matched.slice().sort((a, b) => {
            const left = norm(isDocId(order.field) ? a.id : a.data[order.field]);
            const right = norm(isDocId(order.field) ? b.id : b.data[order.field]);
            if (left < right) return order.direction === "desc" ? 1 : -1;
            if (left > right) return order.direction === "desc" ? -1 : 1;
            return 0;
          });
        }
        if (limitN != null) matched = matched.slice(0, limitN);
        return toSnap(collectionName, matched);
      },
    };
  }

  function docRef(collectionName, id) {
    return {
      id,
      collectionName,
      path: `${collectionName}/${id}`,
      collection(sub) {
        return {
          get: async () => {
            subGets.push({ eventId: id, sub });
            const list = (seed.sub && seed.sub[id] && seed.sub[id][sub]) || [];
            return toSnap(collectionName, list.map((data, index) => ({
              id: data._id || String(index),
              data,
            })));
          },
        };
      },
      get: async () => {
        readDocs += 1;
        if (collectionName === "eventAttendanceFlags") flagGets.push(id);
        const data = ensure(collectionName).get(id);
        return {
          id,
          exists: data != null,
          data: () => (data == null ? undefined : { ...data }),
        };
      },
    };
  }

  return {
    writes,
    commits,
    queries,
    subGets,
    flagGets,
    eventReadIds,
    userReadIds,
    get readDocs() { return readDocs; },
    get batchCalls() { return batchCalls; },
    saved(collectionName, id) {
      const data = ensure(collectionName).get(id);
      return data == null ? null : data;
    },
    insert(collectionName, id, data) {
      ensure(collectionName).set(id, data);
    },
    collection(name) {
      if (hooks.failCollections && hooks.failCollections[name]) {
        throw new Error(hooks.failCollections[name]);
      }
      return {
        where(field, op, value) {
          return createQuery(name, []).where(field, op, value);
        },
        count() {
          return createQuery(name, []).count();
        },
        doc(id) {
          return docRef(name, id);
        },
      };
    },
    batch() {
      batchCalls += 1;
      const ops = [];
      return {
        set(ref, data) {
          ops.push({ collectionName: ref.collectionName, id: ref.id, data });
        },
        commit: async () => {
          const paths = [];
          ops.forEach((op) => {
            writeDoc(op.collectionName, op.id, op.data);
            paths.push(`${op.collectionName}/${op.id}`);
          });
          commits.push(paths);
        },
      };
    },
    async runTransaction(fn) {
      const pending = [];
      await fn({
        get: (ref) => ref.get(),
        set: (ref, data) => pending.push({ collectionName: ref.collectionName, id: ref.id, data }),
      });
      pending.forEach((op) => writeDoc(op.collectionName, op.id, op.data));
    },
  };
}

function eventDoc(id, data) {
  return {
    id,
    data: {
      id,
      status: "ended",
      type: "pickup",
      creatorUid: "host-1",
      creator: "主辦",
      title: id,
      max: 10,
      realCurrent: 1,
      ...data,
    },
  };
}

function baseSeed(extra = {}) {
  return {
    events: [
      eventDoc("held", { date: "2026/11/08 19:00~21:00", title: "夜場" }),
      ...(extra.events || []),
    ],
    users: [
      { id: "u1", data: { uid: "u1", createdAt: ts(taipeiMs("2026-11-08", 9)), lastLogin: ts(taipeiMs("2026-11-08", 12)) } },
      { id: "u2", data: { uid: "u2", createdAt: ts(taipeiMs("2026-01-15", 9)), lastLogin: ts(taipeiMs("2026-11-08", 12)) } },
      { id: QA, data: { uid: QA, createdAt: ts(taipeiMs("2026-11-08", 8)), lastLogin: ts(taipeiMs("2026-11-08", 12)) } },
      ...(extra.users || []),
    ],
    eventAttendanceFlags: [{ id: "held", data: { hasCountedCheckout: true } }, ...(extra.flags || [])],
    opsDailyStats: extra.opsDailyStats || [],
    opsParticipantDays: extra.opsParticipantDays || [],
    opsSummary: extra.opsSummary || [],
    usageMetrics: extra.usageMetrics || [
      { id: "20261109", data: { billing: { totalCost: 80, currency: "USD", billingPeriod: "2026-11" } } },
      { id: "20261108", data: { billing: { totalCost: 10, currency: "USD", billingPeriod: "2026-11" } } },
      { id: "20261015", data: { billing: { totalCost: 1, currency: "USD", billingPeriod: "2026-10" } } },
      { id: "20261031", data: { billing: { totalCost: 200, currency: "USD", billingPeriod: "2026-10" } } },
    ],
    sub: {
      held: {
        registrations: [{ _id: "r1", userId: "u1", status: "confirmed", eventId: "held" }],
        attendanceRecords: [
          { _id: "a1", uid: "u1", type: "checkin", status: "active", eventId: "held" },
          { _id: "a2", uid: "u1", type: "checkout", status: "active", eventId: "held" },
        ],
      },
      ...(extra.sub || {}),
    },
  };
}

function run(db, extra = {}) {
  const logs = [];
  return runOpsRollup({
    db,
    Timestamp,
    fieldPath: FIELD_PATH,
    nowMs: extra.nowMs == null ? NOW : extra.nowMs,
    mode: extra.mode || "daily",
    log: (line) => logs.push(line),
  }).then((result) => ({ ...result, logs }));
}

describe("ops-daily-rollup", () => {
  test("daily 寫入當日快照、費用，latest 與 noshow 同一個 batch", async () => {
    const db = createFakeDb(baseSeed());
    const result = await run(db);
    expect(result.asOf).toBe("2026-11-08");
    expect(result.dateKeys).toHaveLength(14);
    expect(result.counter.total).toBe(db.readDocs);
    expect(result.counter.existing).toBe(15);
    const daily = db.saved("opsDailyStats", "20261108");
    expect(daily.users.newUsers).toBe(1);
    expect(daily.users.activeSnapshot.d7).toBe(2);
    expect(daily.users.totalUsers).toBe(2);
    expect(daily.users.qaUsers).toBe(1);
    expect(daily.events.held).toBe(1);
    expect(daily.regs.confirmed).toBe(1);
    expect(daily.attend).toMatchObject({ counted: 1, completed: 1, noShow: 0 });
    expect(daily.runId).toBe("daily-20261109");
    const participant = db.saved("opsParticipantDays", "20261108");
    expect(participant.events.map((item) => item.checkedInUids)).toEqual([["u1"]]);
    expect(db.saved("opsDailyStats", "20261026").users.activeSnapshot).toBeNull();
    const latest = db.saved("opsSummary", "latest");
    expect(latest.asOf).toBe("2026-11-08");
    expect(latest.users).toEqual({ totalUsers: 2, qaUsers: 1 });
    expect(latest.cost).toMatchObject({
      monthToDate: 80,
      projected: 300,
      prevMonthTotal: 200,
      sourceDateKey: "2026-11-09",
      currency: "USD",
    });
    expect(db.saved("opsSummary", "noshow").asOf).toBe("2026-11-08");
    expect(db.batchCalls).toBe(1);
    expect(db.commits).toEqual([["opsSummary/latest", "opsSummary/noshow"]]);
    expect(result.logs[0]).toContain("[opsDailyRollup]");
    expect(result.counter.usage).toBeGreaterThan(0);
  });

  test("同日再跑保留 activeSnapshot、totalUsers、qaUsers", async () => {
    const db = createFakeDb(baseSeed({
      opsDailyStats: [{
        id: "20261108",
        data: {
          users: {
            activeSnapshot: { d7: 99, d30: 99, d90: 99, d365: 99 },
            totalUsers: 50,
            qaUsers: 7,
            newUsers: 0,
          },
        },
      }],
    }));
    await run(db);
    const daily = db.saved("opsDailyStats", "20261108");
    expect(daily.users.activeSnapshot.d7).toBe(99);
    expect(daily.users.totalUsers).toBe(50);
    expect(daily.users.qaUsers).toBe(7);
    expect(daily.users.newUsers).toBe(1);
  });

  test("隔天 daily 保留前一日快照，只在新的 asOf 寫新快照", async () => {
    const db = createFakeDb(baseSeed());
    await run(db);
    expect(db.saved("opsDailyStats", "20261108").users.activeSnapshot.d7).toBe(2);
    expect(db.saved("opsDailyStats", "20261108").users.totalUsers).toBe(2);
    db.insert("users", "u3", {
      uid: "u3",
      createdAt: ts(taipeiMs("2026-11-09", 9)),
      lastLogin: ts(taipeiMs("2026-11-09", 12)),
    });
    const next = await run(db, { nowMs: NEXT });
    expect(next.asOf).toBe("2026-11-09");
    expect(db.saved("opsDailyStats", "20261108").users.activeSnapshot.d7).toBe(2);
    expect(db.saved("opsDailyStats", "20261108").users.totalUsers).toBe(2);
    expect(db.saved("opsDailyStats", "20261108").users.qaUsers).toBe(1);
    expect(db.saved("opsDailyStats", "20261109").users.activeSnapshot.d7).toBe(3);
    expect(db.saved("opsDailyStats", "20261109").users.totalUsers).toBe(3);
    expect(db.saved("opsDailyStats", "20261109").users.newUsers).toBe(1);
  });

  test("已取消、外部、QA 主辦、尚未結束的場次不讀報名與簽到", async () => {
    const db = createFakeDb(baseSeed({
      events: [
        eventDoc("ext", { type: "external", date: "2026/11/08 18:00~19:00", title: "外部" }),
        eventDoc("cancelled", { status: "cancelled", date: "2026/11/08 17:00~18:00", title: "取消" }),
        eventDoc("qaHost", { creatorUid: QA, date: "2026/11/08 16:00~17:00", title: "QA" }),
        eventDoc("open", { status: "open", date: "2026/11/12 19:00~21:00", title: "未結束" }),
      ],
      sub: {
        ext: { registrations: [{ userId: "u1", status: "confirmed", eventId: "ext" }], attendanceRecords: [] },
        cancelled: { registrations: [{ userId: "u1", status: "confirmed", eventId: "cancelled" }], attendanceRecords: [] },
        qaHost: { registrations: [{ userId: "u1", status: "confirmed", eventId: "qaHost" }], attendanceRecords: [] },
        open: { registrations: [{ userId: "u1", status: "confirmed", eventId: "open" }], attendanceRecords: [] },
      },
    }));
    const result = await run(db);
    expect([...new Set(db.subGets.map((item) => item.eventId))]).toEqual(["held"]);
    expect(db.flagGets).toEqual(["held"]);
    expect(result.counter.total).toBe(db.readDocs);
    const daily = db.saved("opsDailyStats", "20261108");
    expect(daily.events).toMatchObject({ held: 1, cancelled: 1, external: 1 });
    expect(daily.regs.confirmed).toBe(1);
  });

  test("對帳：內容不同才記入 lastMismatchDays；文件不存在視為待補並寫入", async () => {
    const emptyDaily = {
      events: { held: 0 },
      regs: { confirmed: 0 },
      attend: { counted: 0, completed: 0, noShow: 0 },
      users: { activeSnapshot: { d7: 1 }, totalUsers: 4, qaUsers: 0 },
    };
    const db = createFakeDb(baseSeed({
      opsDailyStats: [
        { id: "20261004", data: { ...emptyDaily, runId: "seed" } },
        { id: "20261005", data: { ...emptyDaily, events: { held: 9 } } },
        { id: "20261007", data: { ...emptyDaily, runId: "daily-only" } },
      ],
      opsParticipantDays: [
        { id: "20261004", data: { events: [] } },
        { id: "20261005", data: { events: [] } },
      ],
    }));
    const result = await run(db, { mode: "reconcile" });
    expect(result.mismatches).toEqual(["2026-10-05"]);
    expect(result.dateKeys).toHaveLength(22);
    expect(db.saved("opsDailyStats", "20261004").runId).toBe("seed");
    expect(db.saved("opsDailyStats", "20261004").users.totalUsers).toBe(4);
    expect(db.saved("opsDailyStats", "20261006").runId).toBe("reconcile-20261109");
    expect(db.saved("opsDailyStats", "20261007").runId).toBe("reconcile-20261109");
    expect(db.saved("opsParticipantDays", "20261007").events).toEqual([]);
    const latest = db.saved("opsSummary", "latest");
    expect(latest.integrity.lastMismatchDays).toEqual(["2026-10-05"]);
    expect(latest.integrity.lastReconcileAt.toMillis()).toBe(NOW);
    expect(result.counter.total).toBe(db.readDocs);
  });

  test("重算集合是最近 14 天加 2025-03-01 時，查詢只有兩段且不讀中間月份", async () => {
    const events = [
      eventDoc("released", { date: "2025/3/1 19:00~21:00", title: "已解除" }),
      eventDoc("recent", { date: "2026/11/08 19:00~21:00", title: "最近" }),
    ];
    for (let index = 0; index < 3; index += 1) {
      events.push(eventDoc(`july-${index}`, { date: "2025/7/2 19:00~21:00", title: "中間月" }));
    }
    const users = [
      { id: "march-user", data: { uid: "march-user", createdAt: ts(taipeiMs("2025-03-01", 10)) } },
      { id: "recent-user", data: { uid: "recent-user", createdAt: ts(taipeiMs("2026-11-08", 10)) } },
      { id: "string-join", data: { uid: "string-join", joinDate: "2026/11/08" } },
    ];
    for (let index = 0; index < 3; index += 1) {
      users.push({
        id: `july-user-${index}`,
        data: { uid: `july-user-${index}`, createdAt: ts(taipeiMs("2025-07-02", 10)) },
      });
    }
    const db = createFakeDb({
      events,
      users,
      eventAttendanceFlags: [],
      opsSummary: [{
        id: "latest",
        data: {
          attention: [{ kind: "stuck_event", refId: "released", dateKey: "2025-03-01", title: "已解除" }],
          integrity: { lastReconcileAt: null, lastMismatchDays: [] },
        },
      }],
      usageMetrics: [],
      sub: {},
    });
    const result = await run(db);
    expect(contiguousDateSegments(result.dateKeys)).toEqual([
      { start: "2025-03-01", end: "2025-03-01" },
      { start: "2026-10-26", end: "2026-11-08" },
    ]);
    const createdRanges = db.queries.filter((query) => (
      query.collection === "users" && query.filters.some((filter) => filter.field === "createdAt")
    ));
    expect(createdRanges).toHaveLength(2);
    const dateStarts = db.queries
      .filter((query) => query.collection === "events" && query.filters.some((filter) => filter.field === "date"))
      .map((query) => query.filters.find((filter) => filter.op === ">=").value);
    expect(dateStarts.some((start) => String(start).includes("2025/7") || String(start).includes("2025-7"))).toBe(false);
    expect(result.counter.events).toBe(2);
    expect(db.eventReadIds.filter((id) => id.startsWith("july"))).toEqual([]);
    expect(result.counter.users).toBe(2);
    expect(db.userReadIds.filter((id) => id.startsWith("july") || id === "string-join")).toEqual([]);
    expect(db.saved("opsDailyStats", "20251108")).toBeNull();
    expect(db.saved("opsDailyStats", "20260301")).toBeNull();
    expect(db.saved("opsDailyStats", "20250301").users.newUsers).toBe(1);
    expect(db.saved("opsDailyStats", "20261108").users.newUsers).toBe(1);
    expect(result.counter.total).toBe(db.readDocs);
  });

  test("失敗時先寫結構化 log 再拋出，不寫 opsSummary，step 能分開", async () => {
    const errors = [];
    const spy = jest.spyOn(console, "error").mockImplementation((line) => errors.push(String(line)));
    try {
      const openDb = createFakeDb(baseSeed(), { failStatus: "open events failed" });
      await expect(run(openDb)).rejects.toThrow("open events failed");
      expect(JSON.parse(errors[0])).toEqual({
        tag: "opsDailyRollup",
        mode: "daily",
        asOf: "2026-11-08",
        step: "openEvents",
        error: "open events failed",
      });
      expect(errors[0]).not.toContain(QA);
      expect(errors[0]).not.toContain("host-1");
      expect(openDb.writes.some((item) => item.path.startsWith("opsSummary/"))).toBe(false);

      const costDb = createFakeDb(baseSeed(), { failCollections: { usageMetrics: "cost failed" } });
      await expect(run(costDb)).rejects.toThrow("cost failed");
      expect(JSON.parse(errors[1])).toEqual({
        tag: "opsDailyRollup",
        mode: "daily",
        asOf: "2026-11-08",
        step: "loadCost",
        error: "cost failed",
      });
      expect(costDb.writes.some((item) => item.path.startsWith("opsSummary/"))).toBe(false);
      expect(costDb.saved("opsDailyStats", "20261108").users.newUsers).toBe(1);

      const reconcileDb = createFakeDb(baseSeed(), { failDate: "events failed" });
      await expect(run(reconcileDb, { mode: "reconcile" })).rejects.toThrow("events failed");
      expect(JSON.parse(errors[2])).toMatchObject({
        tag: "opsDailyRollup",
        mode: "reconcile",
        asOf: "2026-11-08",
        step: "loadEvents",
        error: "events failed",
      });
      expect(Object.keys(JSON.parse(errors[2])).sort()).toEqual(["asOf", "error", "mode", "step", "tag"]);
      expect(reconcileDb.writes.some((item) => item.path.startsWith("opsSummary/"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
