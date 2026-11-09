"use strict";

const { addDaysKey } = require("../../functions/ops-ltv-report");
const { enumerateDateKeys } = require("../../functions/ops-rollup-core");
const { parseBackfillArgs, runBackfill } = require("../../functions/backfill-ops-daily-stats");

const QA = `U${"0".repeat(28)}0001`;
const NOW = Date.UTC(2026, 10, 8, 19, 0, 0);

function compare(doc, filter) {
  const left = doc.data[filter.field];
  if (filter.op === ">=") return left >= filter.value;
  if (filter.op === "<") return left < filter.value;
  if (filter.op === "<=") return left <= filter.value;
  if (filter.op === "==") return left === filter.value;
  throw new Error(`bad op ${filter.op}`);
}

function createFakeDb(seed) {
  const writes = [];
  let batchCalls = 0;
  let readDocs = 0;
  function toSnap(docs) {
    readDocs += docs.length;
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
  function query(docs, filters) {
    return {
      where(field, op, value) {
        return query(docs, filters.concat([{ field, op, value }]));
      },
      select() { return this; },
      orderBy() { return this; },
      limit() { return this; },
      get: async () => toSnap(docs.filter((doc) => filters.every((filter) => compare(doc, filter)))),
    };
  }
  function docRef(collectionName, id) {
    return {
      id,
      path: `${collectionName}/${id}`,
      collection(sub) {
        const children = (seed.sub[id] && seed.sub[id][sub]) || [];
        return {
          get: async () => toSnap(children.map((data, index) => ({
            id: data._id || String(index),
            data,
          }))),
        };
      },
      get: async () => {
        readDocs += 1;
        const found = (seed[collectionName] || []).find((doc) => doc.id === id);
        return {
          id,
          exists: !!found,
          data: () => (found ? { ...found.data } : undefined),
        };
      },
    };
  }
  return {
    writes,
    get batchCalls() { return batchCalls; },
    get readDocs() { return readDocs; },
    collection(name) {
      const api = {
        where(field, op, value) {
          return query(seed[name] || [], []).where(field, op, value);
        },
        select() { return api; },
        get: async () => toSnap(seed[name] || []),
        doc(id) { return docRef(name, id); },
      };
      return api;
    },
    batch() {
      batchCalls += 1;
      const ops = [];
      return {
        set(ref, data) { ops.push({ path: ref.path, data }); },
        commit: async () => { writes.push(...ops); },
      };
    },
  };
}

function seedStore(extra = {}) {
  return {
    events: [
      {
        id: "e1",
        data: {
          id: "e1",
          status: "ended",
          type: "pickup",
          date: "2026/11/08 19:00~21:00",
          title: "夜場",
          creatorUid: "host-1",
          creator: "主辦",
          max: 10,
          realCurrent: 1,
        },
      },
      {
        id: "eExt",
        data: {
          id: "eExt",
          status: "ended",
          type: "external",
          date: "2026/11/08 18:00~19:00",
          title: "外部",
          creatorUid: "host-1",
          max: 10,
          realCurrent: 0,
        },
      },
      {
        id: "eOld",
        data: {
          id: "eOld",
          status: "ended",
          type: "pickup",
          date: "2024/5/1 19:00~21:00",
          title: "範圍外",
          creatorUid: "host-1",
        },
      },
    ],
    users: [
      { id: "u1", data: { uid: "u1", createdAt: "2026/11/08" } },
      { id: "ghost", data: { uid: "ghost" } },
      { id: QA, data: { uid: QA, createdAt: "2026/11/08" } },
    ],
    eventAttendanceFlags: [
      { id: "e1", data: { hasCountedCheckout: true } },
    ],
    opsDailyStats: extra.opsDailyStats || [],
    sub: {
      e1: {
        registrations: [
          { userId: "u1", status: "confirmed", eventId: "e1" },
          { userId: "u1", status: "confirmed", eventId: "e1", companionId: "c1" },
          { userId: QA, status: "confirmed", eventId: "e1" },
        ],
        attendanceRecords: [
          { uid: "u1", type: "checkin", status: "active", eventId: "e1" },
          { uid: "u1", type: "checkout", status: "active", eventId: "e1" },
          { uid: QA, type: "checkin", status: "active", eventId: "e1" },
        ],
      },
      eExt: { registrations: [{ userId: "u1", status: "confirmed", eventId: "eExt" }], attendanceRecords: [] },
      eOld: { registrations: [], attendanceRecords: [] },
    },
  };
}

describe("backfill-ops-daily-stats", () => {
  test("預設區間是台北昨日往回 730 天，且預設不寫入", () => {
    const nowMs = Date.UTC(2026, 10, 8, 16, 0, 0);
    const args = parseBackfillArgs(["node", "backfill-ops-daily-stats.js"], nowMs);
    expect(args).toMatchObject({ apply: false, toKey: "2026-11-08" });
    expect(enumerateDateKeys(args.fromKey, args.toKey)).toHaveLength(730);
    expect(() => parseBackfillArgs(["node", "x", "--from"], nowMs)).toThrow("MISSING_FROM");
  });

  test("dry-run 只讀、先輸出筆數與讀取量，不呼叫 batch", async () => {
    const db = createFakeDb(seedStore());
    const logs = [];
    const report = await runBackfill({
      db,
      apply: false,
      fromKey: "2026-11-08",
      toKey: "2026-11-08",
      nowMs: NOW,
      log: (line) => logs.push(line),
    });
    expect(report.mode).toBe("dry-run");
    expect(report.days).toBe(1);
    expect(report.eventDocs).toBe(2);
    expect(report.held).toBe(1);
    expect(report.external).toBe(1);
    expect(report.confirmed).toBe(1);
    expect(report.unknownCreated).toBe(1);
    expect(report.plannedDailyWrites).toBe(1);
    expect(report.plannedParticipantWrites).toBe(1);
    expect(report.readTotal).toBeGreaterThan(0);
    expect(report.readTotal).toBe(db.readDocs);
    expect(db.batchCalls).toBe(0);
    expect(db.writes).toEqual([]);
    expect(logs[0]).toContain("\"mode\": \"dry-run\"");
    expect(logs[0]).toContain("\"readTotal\":");
  });

  test("--apply 才寫入，新文件的 activeSnapshot 為 null；已有快照保留", async () => {
    const db = createFakeDb(seedStore({
      opsDailyStats: [{
        id: "20261108",
        data: { users: { activeSnapshot: { d7: 4, d30: 4, d90: 4, d365: 4 }, totalUsers: 10, qaUsers: 1 } },
      }],
    }));
    await runBackfill({
      db,
      apply: true,
      fromKey: "2026-11-08",
      toKey: "2026-11-08",
      nowMs: NOW,
      log() {},
    });
    expect(db.batchCalls).toBe(1);
    const daily = db.writes.find((item) => item.path === "opsDailyStats/20261108");
    const participant = db.writes.find((item) => item.path === "opsParticipantDays/20261108");
    expect(daily.data.users.activeSnapshot).toEqual({ d7: 4, d30: 4, d90: 4, d365: 4 });
    expect(daily.data.users.totalUsers).toBe(10);
    expect(daily.data.users.qaUsers).toBe(1);
    expect(daily.data.users.newUsers).toBe(1);
    expect(daily.data.users.unknownCreated).toBe(1);
    expect(daily.data.runId).toBe(`backfill-${NOW}`);
    expect(participant.data.events.map((item) => item.docId)).toEqual(["e1"]);
    expect(participant.data.events[0].checkedInUids).toEqual(["u1"]);
    expect(db.writes.some((item) => item.path.startsWith("opsSummary/"))).toBe(false);
  });

  test("沒有舊文件時 activeSnapshot 留 null，超過 730 天的 --apply 拒絕寫入", async () => {
    const db = createFakeDb(seedStore());
    await runBackfill({
      db,
      apply: true,
      fromKey: "2026-11-08",
      toKey: "2026-11-08",
      nowMs: NOW,
      log() {},
    });
    const daily = db.writes.find((item) => item.path === "opsDailyStats/20261108");
    expect(daily.data.users.activeSnapshot).toBeNull();
    expect(daily.data.users.totalUsers).toBeNull();
    await expect(runBackfill({
      db,
      apply: true,
      fromKey: "2024-01-01",
      toKey: "2026-11-08",
      nowMs: NOW,
      log() {},
    })).rejects.toThrow("RANGE_EXCEEDS_730");
  });

  test("unknownCreated 只寫在 --to 那天", async () => {
    const db = createFakeDb(seedStore());
    await runBackfill({
      db,
      apply: true,
      fromKey: "2026-11-07",
      toKey: "2026-11-08",
      nowMs: NOW,
      log() {},
    });
    const earlier = db.writes.find((item) => item.path === "opsDailyStats/20261107");
    const end = db.writes.find((item) => item.path === "opsDailyStats/20261108");
    expect(earlier.data.users.unknownCreated).toBe(0);
    expect(end.data.users.unknownCreated).toBe(1);
    expect(end.data.users.newUsers).toBe(1);
  });

  test("--to 晚於台北昨日、以及 dry-run 超過 730 天，都直接拒絕且不讀資料", async () => {
    expect(() => parseBackfillArgs(["node", "x", "--to", "2026-11-09"], NOW)).toThrow("TO_AFTER_ASOF");
    let reads = 0;
    const db = { collection() { reads += 1; throw new Error("should not read"); } };
    await expect(runBackfill({
      db,
      apply: false,
      fromKey: "2026-11-09",
      toKey: "2026-11-09",
      nowMs: NOW,
      log() {},
    })).rejects.toThrow("TO_AFTER_ASOF");
    await expect(runBackfill({
      db,
      apply: false,
      fromKey: addDaysKey("2026-11-08", -730),
      toKey: "2026-11-08",
      nowMs: NOW,
      log() {},
    })).rejects.toThrow("RANGE_EXCEEDS_730");
    expect(reads).toBe(0);
  });
});
