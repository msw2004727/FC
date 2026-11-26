/**
 * cpOutboxRelay：純函式 + handler 對假 Firestore。
 * 自寫最小 fake：doc().get/create/update/set、collection().where().limit().get()、runTransaction(fn) 傳入 tx.get/update/set。
 */

const fs = require("fs");
const path = require("path");
const {
  ADMIN_QUERY_LIMIT,
  BUILD_DUMMY,
  LINE_MONTHLY_MAX,
  TRIGGER_OPTIONS,
  buildBody,
  createCpOutboxRelayHandler,
  parseOutbox,
  planLineReservation,
  sanitizeText,
  taipeiMonthKey,
} = (() => {
  const mod = require("../../functions/cp-outbox-relay");
  return {
    ADMIN_QUERY_LIMIT: mod.ADMIN_QUERY_LIMIT,
    BUILD_DUMMY: undefined,
    LINE_MONTHLY_MAX: mod.LINE_MONTHLY_MAX,
    TRIGGER_OPTIONS: mod.TRIGGER_OPTIONS,
    buildBody: mod.buildBody,
    createCpOutboxRelayHandler: mod.createCpOutboxRelayHandler,
    parseOutbox: mod.parseOutbox,
    planLineReservation: mod.planLineReservation,
    sanitizeText: mod.sanitizeText,
    taipeiMonthKey: mod.taipeiMonthKey,
  };
})();

const T0 = Date.UTC(2026, 10, 15, 2, 0, 0); // 2026-11-15 10:00 Taipei（月=202611）

const FieldValue = {
  serverTimestamp() { return "__ts__"; },
};

function createFakeDb({ seed = {}, faults } = {}) {
  const store = new Map();
  for (const [itemPath, data] of Object.entries(seed)) {
    store.set(itemPath, JSON.parse(JSON.stringify(data)));
  }

  function maybeFault(op, itemPath) {
    if (faults && typeof faults.write === "function") {
      const err = faults.write({ op, path: itemPath });
      if (err) throw err;
    }
  }

  function makeCollection(name) {
    return {
      doc(id) { return makeDocRef(`${name}/${id}`); },
      where(field, op, values) {
        return {
          limit(n) {
            return {
              async get() {
                const docs = [];
                const prefix = `${name}/`;
                for (const [itemPath, data] of store) {
                  if (!itemPath.startsWith(prefix)) continue;
                  const rest = itemPath.slice(prefix.length);
                  if (rest.includes("/")) continue;
                  let match = false;
                  if (op === "in" && Array.isArray(values)) match = values.includes(data[field]);
                  else if (op === "==") match = data[field] === values;
                  if (match) {
                    docs.push({
                      id: rest,
                      data() { return { ...store.get(itemPath) }; },
                    });
                  }
                }
                return { docs: docs.slice(0, n) };
              },
            };
          },
        };
      },
    };
  }

  function makeDocRef(itemPath) {
    return {
      id: itemPath.split("/").pop(),
      path: itemPath,
      async get() {
        const exists = store.has(itemPath);
        return {
          exists,
          id: itemPath.split("/").pop(),
          data() { return exists ? { ...store.get(itemPath) } : undefined; },
        };
      },
      async create(data) {
        maybeFault("create", itemPath);
        if (store.has(itemPath)) {
          const err = new Error("Document already exists");
          err.code = 6;
          throw err;
        }
        store.set(itemPath, JSON.parse(JSON.stringify(data)));
      },
      async set(data, opts) {
        maybeFault("set", itemPath);
        if (opts && opts.merge) {
          const existing = store.get(itemPath) || {};
          store.set(itemPath, { ...existing, ...JSON.parse(JSON.stringify(data)) });
        } else {
          store.set(itemPath, JSON.parse(JSON.stringify(data)));
        }
      },
      async update(data) {
        maybeFault("update", itemPath);
        const existing = store.get(itemPath);
        if (!existing) {
          const err = new Error("Not found");
          err.code = 5;
          throw err;
        }
        store.set(itemPath, { ...existing, ...JSON.parse(JSON.stringify(data)) });
      },
      collection(name) {
        return makeCollection(`${itemPath}/${name}`);
      },
    };
  }

  return {
    collection(name) { return makeCollection(name); },
    async runTransaction(fn) {
      const tx = {
        async get(ref) { return ref.get(); },
        update(ref, data) {
          maybeFault("update", ref.path);
          const existing = store.get(ref.path);
          if (!existing) {
            const err = new Error("Not found");
            err.code = 5;
            throw err;
          }
          store.set(ref.path, { ...existing, ...JSON.parse(JSON.stringify(data)) });
        },
        set(ref, data, opts) {
          maybeFault("set", ref.path);
          if (opts && opts.merge) {
            const existing = store.get(ref.path) || {};
            store.set(ref.path, { ...existing, ...JSON.parse(JSON.stringify(data)) });
          } else {
            store.set(ref.path, JSON.parse(JSON.stringify(data)));
          }
        },
        delete(ref) { store.delete(ref.path); },
      };
      return await fn(tx);
    },
    _store: store,
    paths(prefix) { return [...store.keys()].filter((k) => k.startsWith(prefix)); },
    read(itemPath) { return store.get(itemPath); },
    has(itemPath) { return store.has(itemPath); },
    setRaw(itemPath, data) { store.set(itemPath, JSON.parse(JSON.stringify(data))); },
    getRaw(itemPath) { return store.get(itemPath); },
  };
}

function getLineRecipientUidFromUserDoc(found, fallbackUid) {
  const data = found?.data || {};
  if (typeof data.lineUserId === "string" && data.lineUserId) return data.lineUserId;
  if (typeof data.uid === "string" && data.uid) return data.uid;
  if (typeof found?.docId === "string" && found.docId) return found.docId;
  return fallbackUid;
}

function makeLogger() {
  return {
    logs: [], warns: [], errors: [],
    log(...args) { this.logs.push(args); },
    warn(...args) { this.warns.push(args); },
    error(...args) { this.errors.push(args); },
  };
}

function validOutbox(overrides = {}) {
  return {
    kind: "cpReportFiled",
    audienceRoles: ["admin", "super_admin"],
    channels: ["inbox"],
    cid: "cp_abc123",
    reportId: "r1",
    reason: "fake",
    compName: "測試賽",
    status: "pending",
    ...overrides,
  };
}

function defaultAdmins() {
  return {
    u_admin1: { role: "admin", lineUserId: "UlineAdmin1", lineNotify: { bound: true } },
    u_super1: { role: "super_admin", lineNotify: { bound: false } },
    u_user1: { role: "user" },
  };
}

function loadRelay(options = {}) {
  const outboxId = options.outboxId || "out1";
  const users = options.users || defaultAdmins();
  const seed = {};
  for (const [uid, data] of Object.entries(users)) seed[`users/${uid}`] = data;
  if (options.outbox !== undefined) {
    seed[`cpOutbox/${outboxId}`] = options.outbox;
  }
  if (options.flags !== undefined) seed["siteConfig/featureFlags"] = options.flags;
  if (options.monthCount !== undefined) {
    const month = taipeiMonthKey(options.now ? options.now() : T0);
    seed[`cpLineThrottle/m_${month}`] = { count: options.monthCount };
  }
  if (options.extraSeed) {
    Object.assign(seed, options.extraSeed);
  }
  const db = createFakeDb({ seed, faults: options.faults });
  const logger = makeLogger();
  const handler = createCpOutboxRelayHandler({
    db,
    getCpDb: () => db,
    FieldValue,
    logger,
    getLineRecipientUidFromUserDoc,
    now: options.now || (() => T0),
  });
  return { db, handler, logger };
}

function eventFor(outId = "out1", timeMs = T0) {
  return { params: { outId }, time: new Date(timeMs).toISOString() };
}

describe("cpOutboxRelay 純函式", () => {
  test("taipeiMonthKey：2026-11-30T16:30Z → 202612", () => {
    expect(taipeiMonthKey(Date.UTC(2026, 10, 30, 16, 30, 0))).toBe("202612");
    expect(taipeiMonthKey(Date.UTC(2026, 10, 15, 2, 0, 0))).toBe("202611");
  });

  test("sanitizeText：去控制字元、壓平空白、依 code point 截斷", () => {
    expect(sanitizeText("a\u0001b\u007f", 10)).toBe("ab");
    expect(sanitizeText("  hello   world  ", 20)).toBe("hello world");
    expect(sanitizeText("😀".repeat(10), 5)).toBe("😀".repeat(5));
    expect(sanitizeText(123, 5)).toBe("");
    expect(sanitizeText(null, 5)).toBe("");
    expect(sanitizeText("", 5)).toBe("");
  });

  test("parseOutbox：五種 reason 都過、wantLine 依 channels", () => {
    for (const reason of ["impersonation", "fake", "inappropriate", "privacy", "other"]) {
      const out = parseOutbox(validOutbox({ reason, channels: ["inbox"] }));
      expect(out).toMatchObject({ ok: true, reason, wantLine: false });
    }
    const wantLine = parseOutbox(validOutbox({ channels: ["inbox", "line"] }));
    expect(wantLine).toMatchObject({ ok: true, wantLine: true });
  });

  test("parseOutbox：未知 kind → unknown_kind", () => {
    expect(parseOutbox({ kind: "something_else" })).toEqual({ ok: false, reason: "unknown_kind" });
  });

  test("parseOutbox：channels 缺 inbox 或含未知值 → bad_shape", () => {
    expect(parseOutbox(validOutbox({ channels: ["line"] }))).toEqual({ ok: false, reason: "bad_shape" });
    expect(parseOutbox(validOutbox({ channels: ["inbox", "bogus"] }))).toEqual({ ok: false, reason: "bad_shape" });
    expect(parseOutbox(validOutbox({ channels: "inbox" }))).toEqual({ ok: false, reason: "bad_shape" });
  });

  test("parseOutbox：cid 不合格 → bad_shape", () => {
    expect(parseOutbox(validOutbox({ cid: "wrong" }))).toEqual({ ok: false, reason: "bad_shape" });
    expect(parseOutbox(validOutbox({ cid: "cp_ has space" }))).toEqual({ ok: false, reason: "bad_shape" });
    expect(parseOutbox(validOutbox({ cid: "cp_" }))).toEqual({ ok: false, reason: "bad_shape" });
  });

  test("buildBody：純文字模板", () => {
    expect(buildBody({ compName: "測試賽", reason: "fake" }))
      .toBe("賽事「測試賽」收到檢舉（不實賽事），請到賽事管理查看處理。");
  });

  test("planLineReservation：已預留回原值；剩 2 要 3 回 2；滿額回 0", () => {
    expect(planLineReservation({ monthCount: 10, alreadyReserved: 5, wanted: 3 })).toBe(5);
    expect(planLineReservation({ monthCount: 28, alreadyReserved: undefined, wanted: 3 })).toBe(2);
    expect(planLineReservation({ monthCount: 30, alreadyReserved: undefined, wanted: 3 })).toBe(0);
    expect(planLineReservation({ monthCount: 0, alreadyReserved: undefined, wanted: 3 })).toBe(3);
  });

  test("TRIGGER_OPTIONS：asia-main、cpOutbox/{outId}、asia-east1、retry", () => {
    expect(TRIGGER_OPTIONS.database).toBe("asia-main");
    expect(TRIGGER_OPTIONS.document).toBe("cpOutbox/{outId}");
    expect(TRIGGER_OPTIONS.region).toBe("asia-east1");
    expect(TRIGGER_OPTIONS.retry).toBe(true);
    expect(TRIGGER_OPTIONS.cpu).toBe("gcf_gen1");
    expect(TRIGGER_OPTIONS.maxInstances).toBe(2);
  });
});

describe("cpOutboxRelay handler（假 Firestore）", () => {
  test("pending → 兩位管理員各一封 cpo_{outId} 站內信、status sent、無 actionType", async () => {
    const { db, handler } = loadRelay({ outbox: validOutbox() });
    await handler(eventFor());
    const inboxPaths = db.paths("users/").filter((itemPath) => itemPath.includes("/inbox/"));
    expect(inboxPaths.sort()).toEqual([
      "users/u_admin1/inbox/cpo_out1",
      "users/u_super1/inbox/cpo_out1",
    ]);
    const doc = db.read("users/u_admin1/inbox/cpo_out1");
    expect(doc).toMatchObject({
      id: "cpo_out1",
      title: "賽事檢舉",
      body: "賽事「測試賽」收到檢舉（不實賽事），請到賽事管理查看處理。",
      type: "system",
      typeName: "系統",
      senderName: "系統",
      fromUid: "system",
      meta: { cid: "cp_abc123", reportId: "r1", cpOutboxId: "out1" },
    });
    expect(doc.actionType).toBeNull();
    expect(db.read("cpOutbox/out1")).toMatchObject({
      status: "sent",
      inboxWritten: 2,
      inboxDuplicate: 0,
      lineQueued: 0,
      lineSkipped: null,
    });
  });

  test("重送同一事件（status 已 sent）→ 不再寫任何東西", async () => {
    const { db, handler } = loadRelay({ outbox: validOutbox({ status: "sent" }) });
    const before = JSON.stringify([...db._store.entries()].sort());
    await handler(eventFor());
    const after = JSON.stringify([...db._store.entries()].sort());
    expect(after).toBe(before);
    expect(db.paths("linePushQueue/")).toEqual([]);
    expect(db.paths("users/").filter((itemPath) => itemPath.includes("/inbox/"))).toEqual([]);
  });

  test("站內信已存在（ALREADY_EXISTS）→ duplicate，不拋，status sent", async () => {
    const { db, handler } = loadRelay({
      outbox: validOutbox(),
      extraSeed: {
        "users/u_admin1/inbox/cpo_out1": { marker: "already" },
        "users/u_super1/inbox/cpo_out1": { marker: "already" },
      },
    });
    await expect(handler(eventFor())).resolves.toBeUndefined();
    expect(db.read("users/u_admin1/inbox/cpo_out1")).toEqual({ marker: "already" });
    expect(db.read("cpOutbox/out1")).toMatchObject({
      status: "sent",
      inboxWritten: 0,
      inboxDuplicate: 2,
    });
  });

  test("channels 含 line 但旗標不存在 → 不寫 linePushQueue、lineSkipped flag_off、月計數不變", async () => {
    const { db, handler } = loadRelay({
      outbox: validOutbox({ channels: ["inbox", "line"] }),
    });
    await handler(eventFor());
    expect(db.paths("linePushQueue/")).toEqual([]);
    expect(db.paths("cpLineThrottle/")).toEqual([]);
    expect(db.read("cpOutbox/out1")).toMatchObject({
      status: "sent",
      lineQueued: 0,
      lineSkipped: "flag_off",
    });
  });

  test("旗標 true、兩位綁定 → 兩筆固定 id、月計數 +2、lineReserved=2；再跑一次（模擬 retrying）不再扣額度、不重複入列", async () => {
    const users = {
      u_admin1: { role: "admin", lineUserId: "UlineAdmin1", lineNotify: { bound: true } },
      u_super1: { role: "super_admin", uid: "UauthSuper1", lineNotify: { bound: true } },
    };
    const { db, handler } = loadRelay({
      outbox: validOutbox({ channels: ["inbox", "line"] }),
      users,
      flags: { cpReportLineEnabled: true },
    });
    await handler(eventFor());
    const qPaths = db.paths("linePushQueue/").sort();
    expect(qPaths).toEqual([
      "linePushQueue/cpo_out1_u_admin1",
      "linePushQueue/cpo_out1_u_super1",
    ]);
    expect(db.read("linePushQueue/cpo_out1_u_admin1")).toMatchObject({
      uid: "UlineAdmin1",
      targetDocId: "u_admin1",
      title: "賽事檢舉",
      category: "system",
      source: "cp_report",
      pool: "staff",
      dedupeKey: "cpo_out1_u_admin1",
    });
    expect(db.read("linePushQueue/cpo_out1_u_super1")).toMatchObject({
      uid: "UauthSuper1",
      targetDocId: "u_super1",
    });
    expect(db.read("cpLineThrottle/m_202611")).toMatchObject({ count: 2 });
    expect(db.read("cpOutbox/out1").lineReserved).toBe(2);
    expect(db.read("cpOutbox/out1")).toMatchObject({
      status: "sent",
      lineQueued: 2,
      lineSkipped: null,
    });

    // 模擬 status 改回 retrying、重跑一次
    const outbox = db.getRaw("cpOutbox/out1");
    db.setRaw("cpOutbox/out1", { ...outbox, status: "retrying" });
    await handler(eventFor());
    expect(db.paths("linePushQueue/").sort()).toEqual(qPaths);
    expect(db.read("cpLineThrottle/m_202611").count).toBe(2);
    expect(db.read("cpOutbox/out1").lineReserved).toBe(2);
  });

  test("月計數 29、綁 3 人 → 只入列 1 筆、計數 30；已 30 → 0 筆 lineSkipped monthly_cap", async () => {
    const users = {
      u_a1: { role: "admin", lineNotify: { bound: true }, lineUserId: "UlineA1" },
      u_a2: { role: "admin", lineNotify: { bound: true }, lineUserId: "UlineA2" },
      u_a3: { role: "super_admin", lineNotify: { bound: true }, lineUserId: "UlineA3" },
    };
    const partial = loadRelay({
      outbox: validOutbox({ channels: ["inbox", "line"] }),
      users,
      flags: { cpReportLineEnabled: true },
      monthCount: 29,
    });
    await partial.handler(eventFor());
    expect(partial.db.paths("linePushQueue/")).toHaveLength(1);
    expect(partial.db.read("cpLineThrottle/m_202611").count).toBe(30);
    expect(partial.db.read("cpOutbox/out1").lineReserved).toBe(1);
    expect(partial.db.read("cpOutbox/out1")).toMatchObject({ status: "sent", lineQueued: 1, lineSkipped: null });

    const capped = loadRelay({
      outbox: validOutbox({ channels: ["inbox", "line"] }),
      users,
      flags: { cpReportLineEnabled: true },
      monthCount: 30,
    });
    await capped.handler(eventFor());
    expect(capped.db.paths("linePushQueue/")).toEqual([]);
    expect(capped.db.read("cpLineThrottle/m_202611").count).toBe(30);
    expect(capped.db.read("cpOutbox/out1")).toMatchObject({
      status: "sent",
      lineQueued: 0,
      lineSkipped: "monthly_cap",
    });
  });

  test("某位站內信寫入失敗（非 ALREADY_EXISTS）→ handler 拋錯、status retrying、attempts 1", async () => {
    const { db, handler } = loadRelay({
      outbox: validOutbox(),
      faults: {
        write: ({ op, path: itemPath }) => {
          if (op === "create" && itemPath.includes("/inbox/") && itemPath.includes("u_super1")) {
            const err = new Error("inbox down");
            err.code = "unavailable";
            return err;
          }
          return null;
        },
      },
    });
    await expect(handler(eventFor())).rejects.toThrow();
    expect(db.read("cpOutbox/out1")).toMatchObject({
      status: "retrying",
      attempts: 1,
      lastError: "inbox_partial",
    });
  });

  test("attempts 已 5 → 標 failed max_attempts、不寫站內信", async () => {
    const { db, handler } = loadRelay({
      outbox: validOutbox({ status: "retrying", attempts: 5 }),
    });
    await handler(eventFor());
    expect(db.read("cpOutbox/out1")).toMatchObject({
      status: "failed",
      failReason: "max_attempts",
    });
    expect(db.paths("users/").filter((itemPath) => itemPath.includes("/inbox/"))).toEqual([]);
  });

  test("事件過舊 → 標 failed event_too_old、不拋", async () => {
    const { db, handler } = loadRelay({ outbox: validOutbox() });
    const staleTime = T0 - 7 * 60 * 60 * 1000; // 7h 前
    await expect(handler(eventFor("out1", staleTime))).resolves.toBeUndefined();
    expect(db.read("cpOutbox/out1")).toMatchObject({
      status: "failed",
      failReason: "event_too_old",
    });
  });

  test("旗標是字串 \"true\" → 視為關，不入列", async () => {
    const { db, handler } = loadRelay({
      outbox: validOutbox({ channels: ["inbox", "line"] }),
      users: { u_admin1: { role: "admin", lineNotify: { bound: true } } },
      flags: { cpReportLineEnabled: "true" },
    });
    await handler(eventFor());
    expect(db.paths("linePushQueue/")).toEqual([]);
    expect(db.read("cpOutbox/out1")).toMatchObject({ status: "sent", lineSkipped: "flag_off" });
  });

  test("旗標開但沒有綁定 LINE 的管理員 → no_bound、不扣額度", async () => {
    const { db, handler } = loadRelay({
      outbox: validOutbox({ channels: ["inbox", "line"] }),
      users: { u_admin1: { role: "admin", lineNotify: { bound: false } }, u_super1: { role: "super_admin" } },
      flags: { cpReportLineEnabled: true },
    });
    await handler(eventFor());
    expect(db.paths("linePushQueue/")).toEqual([]);
    expect(db.paths("cpLineThrottle/")).toEqual([]);
    expect(db.read("cpOutbox/out1")).toMatchObject({ status: "sent", lineSkipped: "no_bound" });
  });

  test("事件時間無法解析 → 標 failed event_too_old、不寫站內信", async () => {
    const { db, handler } = loadRelay({ outbox: validOutbox() });
    await expect(handler({ params: { outId: "out1" }, time: "not-a-date" })).resolves.toBeUndefined();
    expect(db.read("cpOutbox/out1")).toMatchObject({ status: "failed", failReason: "event_too_old" });
    expect(db.paths("users/").filter((itemPath) => itemPath.includes("/inbox/"))).toEqual([]);
  });

  test("已送出（sent）的文件被延遲重送超過 6 小時 → 不改狀態", async () => {
    const { db, handler } = loadRelay({ outbox: validOutbox({ status: "sent" }) });
    await handler(eventFor("out1", T0 - 7 * 60 * 60 * 1000));
    expect(db.read("cpOutbox/out1")).toMatchObject({ status: "sent" });
    expect(db.read("cpOutbox/out1").failReason).toBeUndefined();
  });

  test("事件時間略快於本機時鐘（1 秒後）→ 照常投遞", async () => {
    const { db, handler } = loadRelay({ outbox: validOutbox() });
    await handler(eventFor("out1", T0 + 1000));
    expect(db.read("cpOutbox/out1")).toMatchObject({ status: "sent" });
  });

  test("未知 kind → status skipped", async () => {
    const { db, handler } = loadRelay({
      outbox: validOutbox({ kind: "something_else" }),
    });
    await handler(eventFor());
    expect(db.read("cpOutbox/out1")).toMatchObject({
      status: "skipped",
      failReason: "unknown_kind",
    });
    expect(db.paths("users/").filter((itemPath) => itemPath.includes("/inbox/"))).toEqual([]);
  });

  test("index.js 原文含 createCpOutboxRelayExports 與 require('./cp-outbox-relay')", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "functions", "index.js"), "utf8");
    expect(src).toContain('require("./cp-outbox-relay")');
    expect(src).toContain("createCpOutboxRelayExports(");
  });
});
