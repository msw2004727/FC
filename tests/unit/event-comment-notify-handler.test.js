"use strict";

// 活動留言通知批 1：onEventCommentCreated handler 整條流程（記憶體版 Firestore＋注入的 LINE helper mock）。
// 涵蓋：公開、私密、累積、重送、管理者留言、_config 缺漏、capped、站內信 ALREADY_EXISTS、交易失敗、log 遮罩。
// getAuthUidFromUserDoc 從 functions/index.js 切真實原始碼執行，不另寫一份。

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  createOnEventCommentCreatedHandler,
  COMMENT_NOTIFY_SOURCE,
  COMMENT_NOTIFY_WINDOW_MS,
  LINK_PLACEHOLDER,
} = require("../../functions/event-comment-notify");
const { maskUid } = require("../../functions/notification-fields");

const indexSource = fs.readFileSync(path.resolve(__dirname, "../../functions/index.js"), "utf8");

function loadIndexFunction(name) {
  const start = indexSource.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`Missing helper: ${name}`);
  const end = indexSource.indexOf("\n}", start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${indexSource.slice(start, end + 2)}\nthis.fn = ${name};`, context);
  return context.fn;
}

const getAuthUidFromUserDoc = loadIndexFunction("getAuthUidFromUserDoc");

// ─── 記憶體版 Firestore（只實作本 handler 用到的 API） ───

const SERVER_TIMESTAMP = { __serverTimestamp: true };
const FieldValue = { serverTimestamp: () => SERVER_TIMESTAMP };

function alreadyExistsError() {
  const error = new Error("6 ALREADY_EXISTS: Document already exists");
  error.code = 6;
  return error;
}

function createFakeDb() {
  const store = new Map();
  const failures = { transaction: null, eventGet: null };
  const writes = [];
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  function snapshot(id, docPath) {
    const data = store.get(docPath);
    return { id, exists: data !== undefined, data: () => clone(data) };
  }

  function docRef(docPath) {
    const id = docPath.split("/").pop();
    return {
      id,
      path: docPath,
      async get() {
        if (docPath.startsWith("events/") && failures.eventGet) throw failures.eventGet;
        return snapshot(id, docPath);
      },
      async create(data) {
        if (store.has(docPath)) throw alreadyExistsError();
        store.set(docPath, clone(data));
        writes.push({ type: "create", path: docPath });
      },
      collection: (name) => collectionRef(`${docPath}/${name}`),
    };
  }

  function collectionRef(collectionPath) {
    return {
      doc: (id) => docRef(`${collectionPath}/${id}`),
      where(field, op, values) {
        return {
          async get() {
            const docs = [];
            for (const [docPath, data] of store) {
              const rest = docPath.slice(collectionPath.length + 1);
              if (!docPath.startsWith(`${collectionPath}/`) || rest.includes("/")) continue;
              if (op === "in" && values.includes(data[field])) docs.push(snapshot(rest, docPath));
            }
            return { docs, empty: docs.length === 0 };
          },
        };
      },
    };
  }

  const db = {
    collection: (name) => collectionRef(name),
    async runTransaction(fn) {
      if (failures.transaction && failures.transaction(fn)) throw new Error("10 ABORTED: contention");
      const pending = [];
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data) => pending.push([ref.path, data]),
      };
      const result = await fn(tx);
      for (const [docPath, data] of pending) {
        store.set(docPath, clone(data));
        writes.push({ type: "set", path: docPath });
      }
      return result;
    },
  };
  return { db, store, failures, writes };
}

// ─── 測試資料 ───

const NOW = Date.UTC(2026, 10, 9, 2, 0); // 台北 11-09 10:00
const EVENT_DOC_ID = "evDoc01";
const EVENT_END_MS = Date.UTC(2026, 10, 10, 2, 0);

function ts(ms) {
  return { toMillis: () => ms };
}

function seed(store, { config = { enabled: true, lineEnabled: true, adminLineEnabled: true, caps: { globalPerDay: 15, authorPerDay: 3, recipientPerDay: 6 } }, event } = {}) {
  if (config) store.set("eventCommentNotify/_config", config);
  store.set(`events/${EVENT_DOC_ID}`, event || {
    id: "ce_public_01",
    title: "週六友誼賽",
    status: "open",
    creatorUid: "hostUid01",
    delegateUids: ["delegateUid01"],
    endTimestamp: EVENT_END_MS,
  });
  store.set("users/adminUid01", { role: "admin", uid: "adminUid01" });
  store.set("users/superUid001", { role: "super_admin", uid: "superUid001" });
  store.set("users/memberUid01", { role: "user", uid: "memberUid01" });
}

function comment({ id, authorUid = "memberUid01", body = "明天會下雨嗎？", visibility = "public", createdAtMs = NOW, extra = {} }) {
  const data = { eventId: "ce_public_01", authorUid, authorName: "小明", body, visibility, deleted: false, ...extra };
  if (createdAtMs !== null) data.createdAt = createdAtMs;
  return { params: { eventId: EVENT_DOC_ID, commentId: id }, data: { data: () => ({ ...data, createdAt: data.createdAt === undefined ? undefined : ts(data.createdAt) }) } };
}

function setup({ resolver, enqueue, configOverride, event, nowMs = NOW } = {}) {
  const fake = createFakeDb();
  seed(fake.store, { config: configOverride === undefined ? undefined : configOverride, event });
  // 事件的 endTimestamp 存成數字只為了 JSON 複製；讀出時轉回 Timestamp 形狀。
  const originalCollection = fake.db.collection;
  fake.db.collection = (name) => {
    const ref = originalCollection(name);
    if (name !== "events") return ref;
    return {
      ...ref,
      doc: (id) => {
        const doc = ref.doc(id);
        return {
          ...doc,
          async get() {
            const snap = await doc.get();
            if (!snap.exists) return snap;
            const data = snap.data();
            if (typeof data.endTimestamp === "number") data.endTimestamp = ts(data.endTimestamp);
            return { ...snap, data: () => data };
          },
        };
      },
    };
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const resolveLineNotificationRecipient = jest.fn(resolver || (async ({ uid }) => ({ found: { docId: uid }, targetUid: uid })));
  const enqueueLineFromServer = jest.fn(enqueue || (async () => ({ queued: true, skipped: false, queueId: "q" })));
  const parseEventEndDateInTaipei = jest.fn(() => null);
  let clock = nowMs;
  const handler = createOnEventCommentCreatedHandler({
    db: fake.db,
    FieldValue,
    logger,
    enqueueLineFromServer,
    resolveLineNotificationRecipient,
    parseEventEndDateInTaipei,
    getAuthUidFromUserDoc,
    maskUid,
    now: () => clock,
  });
  return {
    ...fake,
    handler,
    logger,
    resolveLineNotificationRecipient,
    enqueueLineFromServer,
    setClock: (ms) => { clock = ms; },
    lastLog: () => {
      const calls = [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls];
      return calls[calls.length - 1][1];
    },
    inboxPaths: () => [...fake.store.keys()].filter((key) => key.includes("/inbox/")).sort(),
  };
}

const RECIPIENTS = ["hostUid01", "delegateUid01", "adminUid01", "superUid001"];

describe("onEventCommentCreated handler：整條流程", () => {
  test("公開首則：站內信寫給四位收件人、LINE 入列、狀態與每日文件寫入、log 一行", async () => {
    const t = setup();
    await t.handler(comment({ id: "cm1" }));

    expect(t.inboxPaths()).toEqual(RECIPIENTS.map((uid) => `users/${uid}/inbox/ecn_${EVENT_DOC_ID}_cm1`).sort());
    const inbox = t.store.get(`users/hostUid01/inbox/ecn_${EVENT_DOC_ID}_cm1`);
    expect(inbox).toMatchObject({
      id: `ecn_${EVENT_DOC_ID}_cm1`,
      title: "【活動留言】週六友誼賽",
      body: "小明：明天會下雨嗎？",
      type: "activity",
      typeName: "活動",
      senderName: "系統",
      fromUid: "system",
      actionType: "event_comment",
      actionStatus: null,
      meta: { eventDocId: EVENT_DOC_ID, eventId: "ce_public_01", commentId: "cm1", eventTitle: "週六友誼賽" },
    });

    expect(t.enqueueLineFromServer).toHaveBeenCalledTimes(4);
    expect(t.enqueueLineFromServer).toHaveBeenCalledWith({
      uid: "hostUid01",
      title: "【活動留言】週六友誼賽",
      body: "小明：明天會下雨嗎？",
      category: "activity",
      source: COMMENT_NOTIFY_SOURCE,
      dedupeKey: `event_comment:${EVENT_DOC_ID}:cm1`,
      requestedByUid: "system",
      requestedByRole: "admin",
    });
    expect(t.resolveLineNotificationRecipient).toHaveBeenCalledWith({ uid: "hostUid01", category: "activity", source: "event_comment:new" });

    const state = t.store.get(`eventCommentNotify/${EVENT_DOC_ID}`);
    expect(state).toMatchObject({ lastPublicNotifiedAtMs: NOW, pendingPublic: 0, recentCommentIds: ["cm1"] });
    expect(new Date(state.expireAt).getTime()).toBe(EVENT_END_MS + 7 * 86400000);
    const daily = t.store.get("eventCommentNotify/_daily_20261109");
    expect(daily).toMatchObject({
      global: 4,
      byAuthor: { memberUid01: 1 },
      inboxByAuthor: { memberUid01: 1 },
      byRecipient: { hostUid01: 1, delegateUid01: 1, adminUid01: 1, superUid001: 1 },
    });
    expect(new Date(daily.expireAt).getTime()).toBe(NOW + 3 * 86400000);

    expect(t.logger.info).toHaveBeenCalledTimes(1);
    expect(t.logger.warn).not.toHaveBeenCalled();
    expect(t.lastLog()).toMatchObject({
      outcome: "sent",
      configStatus: "ok",
      kind: "public",
      action: "send_public",
      batchCount: 1,
      recipients: 4,
      shadowEligible: 4,
      inbox: { written: 4, duplicate: 0, failed: 0 },
      line: { queued: 4, skipped: {}, failed: {} },
    });
  });

  test("log 不含 uid 原值與留言內文", async () => {
    const t = setup();
    await t.handler(comment({ id: "cm1", body: "秘密內容 abc" }));
    const text = JSON.stringify(t.lastLog());
    ["hostUid01", "delegateUid01", "adminUid01", "superUid001", "memberUid01", EVENT_DOC_ID, "秘密內容"]
      .forEach((raw) => expect(text).not.toContain(raw));
  });

  test("視窗內累積不發；跨視窗下一則帶累積數；尾端不補發", async () => {
    const t = setup();
    await t.handler(comment({ id: "cm1" }));
    await t.handler(comment({ id: "cm2", createdAtMs: NOW + 60000 }));
    expect(t.lastLog()).toMatchObject({ outcome: "accumulate", action: "accumulate" });
    expect(t.inboxPaths().filter((p) => p.endsWith("_cm2"))).toEqual([]);
    expect(t.enqueueLineFromServer).toHaveBeenCalledTimes(4);

    await t.handler(comment({ id: "cm3", body: "+1", createdAtMs: NOW + COMMENT_NOTIFY_WINDOW_MS }));
    expect(t.store.get(`users/hostUid01/inbox/ecn_${EVENT_DOC_ID}_cm3`).body).toBe("新增 2 則留言，最新 小明：+1");
    expect(t.lastLog()).toMatchObject({ outcome: "sent", batchCount: 2 });
  });

  test("私密留言在公開視窗內也立即發，文案標私密、內文淨化", async () => {
    const t = setup();
    await t.handler(comment({ id: "cm1" }));
    await t.handler(comment({ id: "pv1", visibility: "private", body: "我要請假\n加我 line.me/ti/p/abc", createdAtMs: NOW + 1000 }));
    expect(t.store.get(`users/adminUid01/inbox/ecn_${EVENT_DOC_ID}_pv1`).body).toBe(`小明（私密）：我要請假 加我 ${LINK_PLACEHOLDER}`);
    expect(t.lastLog()).toMatchObject({ outcome: "sent", kind: "private", action: "send_private" });
    expect(t.store.get(`eventCommentNotify/${EVENT_DOC_ID}`)).toMatchObject({ lastPublicNotifiedAtMs: NOW, pendingPublic: 0 });
  });

  test("重送：同一則留言再觸發一次不重複寫站內信、不再入列 LINE", async () => {
    const t = setup();
    const evt = comment({ id: "cm1" });
    await t.handler(evt);
    const writesBefore = t.writes.length;
    await t.handler(evt);
    expect(t.lastLog()).toMatchObject({ outcome: "skip", skipReason: "duplicate" });
    expect(t.writes.length).toBe(writesBefore);
    expect(t.enqueueLineFromServer).toHaveBeenCalledTimes(4);
  });

  test.each([
    ["主辦", "hostUid01"],
    ["委託", "delegateUid01"],
    ["管理員", "adminUid01"],
  ])("管理者（%s）自己留言：整則不通知、不寫狀態", async (_label, authorUid) => {
    const t = setup();
    await t.handler(comment({ id: "cm1", authorUid }));
    expect(t.lastLog()).toMatchObject({ outcome: "skip", skipReason: "author_is_manager" });
    expect(t.writes).toEqual([]);
    expect(t.enqueueLineFromServer).not.toHaveBeenCalled();
  });

  test("_config 缺漏：站內信照寫、LINE 不發、shadow 照算、log config_missing_line_disabled", async () => {
    const t = setup({ configOverride: null });
    await t.handler(comment({ id: "cm1" }));
    expect(t.inboxPaths()).toHaveLength(4);
    expect(t.enqueueLineFromServer).not.toHaveBeenCalled();
    expect(t.lastLog()).toMatchObject({
      outcome: "sent",
      configStatus: "missing",
      configNote: "config_missing_line_disabled",
      shadowEligible: 4,
      lineSkipped: { line_disabled: 4 },
    });
    expect(t.store.get("eventCommentNotify/_daily_20261109")).toMatchObject({ global: 0, byAuthor: {}, inboxByAuthor: { memberUid01: 1 } });
  });

  test("_config 讀取失敗：fail-closed（不發 LINE）並以 warn 記錄", async () => {
    const t = setup();
    const originalCollection = t.db.collection;
    t.db.collection = (name) => {
      const ref = originalCollection(name);
      if (name !== "eventCommentNotify") return ref;
      return { ...ref, doc: (id) => (id === "_config" ? { get: async () => { throw new Error("unavailable"); } } : ref.doc(id)) };
    };
    await t.handler(comment({ id: "cm1" }));
    expect(t.enqueueLineFromServer).not.toHaveBeenCalled();
    expect(t.inboxPaths()).toHaveLength(4);
    expect(t.logger.warn).toHaveBeenCalledTimes(1);
    expect(t.lastLog()).toMatchObject({ configStatus: "error", configError: { message: "unavailable" } });
  });

  test("_config enabled=false：整個停（站內信也不寫）", async () => {
    const t = setup({ configOverride: { enabled: false, lineEnabled: true } });
    await t.handler(comment({ id: "cm1" }));
    expect(t.lastLog()).toMatchObject({ outcome: "skip", skipReason: "disabled" });
    expect(t.writes).toEqual([]);
  });

  test("adminLineEnabled 關：管理員只收站內信，活動管理者照發 LINE", async () => {
    const t = setup({ configOverride: { lineEnabled: true, adminLineEnabled: false, caps: { globalPerDay: 15, authorPerDay: 3, recipientPerDay: 6 } } });
    await t.handler(comment({ id: "cm1" }));
    expect(t.enqueueLineFromServer.mock.calls.map(([arg]) => arg.uid)).toEqual(["hostUid01", "delegateUid01"]);
    expect(t.inboxPaths()).toHaveLength(4);
    expect(t.lastLog().lineSkipped).toEqual({ admin_line_off: 2 });
  });

  test("capped：全站額度只剩 1 則時只發第一位（主辦），其餘只收站內信", async () => {
    const t = setup();
    t.store.set("eventCommentNotify/_daily_20261109", { global: 14 });
    await t.handler(comment({ id: "cm1" }));
    expect(t.enqueueLineFromServer.mock.calls.map(([arg]) => arg.uid)).toEqual(["hostUid01"]);
    expect(t.inboxPaths()).toHaveLength(4);
    expect(t.lastLog()).toMatchObject({ lineCapped: { global_cap: 3 }, line: { queued: 1 } });
  });

  test("LINE 全數 capped：LINE 計數不動、只記站內信次數", async () => {
    const t = setup();
    t.store.set("eventCommentNotify/_daily_20261109", { global: 15 });
    await t.handler(comment({ id: "cm1" }));
    expect(t.enqueueLineFromServer).not.toHaveBeenCalled();
    expect(t.store.get("eventCommentNotify/_daily_20261109")).toMatchObject({ global: 15, byAuthor: {}, byRecipient: {}, inboxByAuthor: { memberUid01: 1 } });
    expect(t.lastLog()).toMatchObject({ capReason: "comment_cap", lineCapped: { global_cap: 4 } });
  });

  test("作者站內信達上限：整則不寫站內信、_daily_ 零寫入", async () => {
    const t = setup();
    t.store.set("eventCommentNotify/_daily_20261109", { inboxByAuthor: { memberUid01: 30 } });
    await t.handler(comment({ id: "pv1", visibility: "private" }));
    expect(t.inboxPaths()).toEqual([]);
    expect(t.enqueueLineFromServer).not.toHaveBeenCalled();
    expect(t.writes.map((w) => w.path)).toEqual([`eventCommentNotify/${EVENT_DOC_ID}`]);
    expect(t.lastLog()).toMatchObject({ outcome: "skip", skipReason: "inbox_author_capped" });
  });

  test("站內信 ALREADY_EXISTS：視為重複，其他收件人照寫", async () => {
    const t = setup();
    t.store.set(`users/adminUid01/inbox/ecn_${EVENT_DOC_ID}_cm1`, { id: "old" });
    await t.handler(comment({ id: "cm1" }));
    expect(t.store.get(`users/adminUid01/inbox/ecn_${EVENT_DOC_ID}_cm1`)).toEqual({ id: "old" });
    expect(t.lastLog()).toMatchObject({ outcome: "sent", inbox: { written: 3, duplicate: 1, failed: 0 } });
    expect(t.logger.warn).not.toHaveBeenCalled();
  });

  test("_daily_ transaction 失敗：不發 LINE（fail-closed），站內信照寫，log capsTxFailed", async () => {
    const t = setup();
    let calls = 0;
    t.failures.transaction = () => { calls += 1; return calls === 2; };
    await t.handler(comment({ id: "cm1" }));
    expect(t.enqueueLineFromServer).not.toHaveBeenCalled();
    expect(t.inboxPaths()).toHaveLength(4);
    expect(t.store.has("eventCommentNotify/_daily_20261109")).toBe(false);
    expect(t.logger.warn).toHaveBeenCalledTimes(1);
    expect(t.lastLog()).toMatchObject({ capReason: "comment_cap_tx_failed", lineCapped: { comment_cap_tx_failed: 4 }, capsTxFailed: { message: expect.stringContaining("ABORTED") } });
  });

  test("LINE 入列失敗（RATE_LIMITED）與資格解析錯誤：只記錄、不影響站內信", async () => {
    const t = setup({
      resolver: async ({ uid }) => {
        if (uid === "superUid001") throw new Error("users read failed");
        if (uid === "delegateUid01") return { skipped: "not_bound" };
        return { found: {} };
      },
      enqueue: async ({ uid }) => {
        if (uid === "adminUid01") {
          const error = new Error("RATE_LIMITED");
          error.code = "resource-exhausted";
          throw error;
        }
        return { queued: false, skipped: true, reason: "category_disabled" };
      },
    });
    await t.handler(comment({ id: "cm1" }));
    expect(t.inboxPaths()).toHaveLength(4);
    expect(t.logger.warn).toHaveBeenCalledTimes(1);
    const log = t.lastLog();
    expect(log).toMatchObject({
      outcome: "sent",
      lineSkipped: { resolve_error: 1, not_bound: 1 },
      line: { queued: 0, skipped: { category_disabled: 1 }, failed: { rate_limited: 1 } },
    });
    expect(log.resolveErrors).toEqual([{ uid: maskUid("superUid001"), code: "unknown", message: "users read failed" }]);
  });

  test("活動取消、已結束、刪除留言、eventDocId 撞保留字：不通知", async () => {
    const cancelled = setup({ event: { title: "x", status: "cancelled", creatorUid: "hostUid01" } });
    await cancelled.handler(comment({ id: "cm1" }));
    expect(cancelled.lastLog()).toMatchObject({ skipReason: "event_cancelled" });

    const ended = setup({ event: { title: "x", creatorUid: "hostUid01", endTimestamp: NOW } });
    await ended.handler(comment({ id: "cm1" }));
    expect(ended.lastLog()).toMatchObject({ skipReason: "event_ended_skip" });

    const deleted = setup();
    await deleted.handler(comment({ id: "cm1", extra: { deleted: true } }));
    expect(deleted.lastLog()).toMatchObject({ skipReason: "deleted" });

    const reserved = setup();
    await reserved.handler({ ...comment({ id: "cm1" }), params: { eventId: "_config", commentId: "cm1" } });
    expect(reserved.lastLog()).toMatchObject({ skipReason: "reserved_event_doc_id" });
    [cancelled, ended, deleted, reserved].forEach((t) => expect(t.writes).toEqual([]));
  });

  test("留言缺 createdAt 時用觸發時間；活動沒有結束時間時狀態 expireAt＝留言時間＋7 天", async () => {
    const t = setup({ event: { title: "無結束時間", creatorUid: "hostUid01" } });
    t.setClock(NOW + 5000);
    await t.handler(comment({ id: "cm1", createdAtMs: null }));
    expect(t.lastLog()).toMatchObject({ outcome: "sent", nowSource: "trigger_time" });
    const state = t.store.get(`eventCommentNotify/${EVENT_DOC_ID}`);
    expect(state.lastPublicNotifiedAtMs).toBe(NOW + 5000);
    expect(new Date(state.expireAt).getTime()).toBe(NOW + 5000 + 7 * 86400000);
  });

  test("主流程意外錯誤：logger.error 一行後重拋", async () => {
    const t = setup();
    t.failures.eventGet = new Error("events read failed");
    await expect(t.handler(comment({ id: "cm1" }))).rejects.toThrow("events read failed");
    expect(t.logger.error).toHaveBeenCalledTimes(1);
    expect(t.lastLog()).toMatchObject({ outcome: "error", error: { message: "events read failed" } });
  });

  test("缺必要依賴時建立 handler 就丟錯", () => {
    expect(() => createOnEventCommentCreatedHandler({ db: {} })).toThrow(TypeError);
  });
});
