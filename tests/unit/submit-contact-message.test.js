/**
 * submitContactMessage：登入、欄位、頻率、contactMessages 與 linePushQueue。
 * Firestore 用 notification-guards-fake-db（本檔為 limit 查詢補上 .limit）。
 */

const fs = require("fs");
const path = require("path");
const { createFakeDb, FieldValue } = require("./notification-guards-fake-db");
const { ROLE_LEVELS, makeLogger } = require("./notification-guards-test-helpers");
const {
  createSubmitContactMessageCallable,
  createSubmitContactMessageHandler,
} = require("../../functions/contact-message");

const CALLER = "UcallerContact0001";
const T0 = Date.UTC(2026, 10, 8, 2, 0, 0);
const MIN = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

class ContactHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details || null;
  }
}

function isStaffRole(role) {
  const key = typeof role === "string" ? role.trim() : "";
  const level = Object.prototype.hasOwnProperty.call(ROLE_LEVELS, key) ? ROLE_LEVELS[key] : 0;
  return level >= ROLE_LEVELS.coach;
}

function getLineRecipientUidFromUserDoc(found, fallbackUid) {
  const data = found?.data || {};
  if (typeof data.lineUserId === "string" && data.lineUserId) return data.lineUserId;
  if (typeof data.uid === "string" && data.uid) return data.uid;
  if (typeof found?.docId === "string" && found.docId) return found.docId;
  return fallbackUid;
}

function valid(extra = {}) {
  return { name: "王小明", contact: "line:owner", content: "想問週三的場地", ...extra };
}

function defaultUsers() {
  return {
    [CALLER]: { uid: CALLER, role: "user", displayName: "王小明", name: "不該用這個" },
    sa1: {
      uid: "UauthSa1",
      role: "super_admin",
      lineUserId: "UlineSa1",
      displayName: "站長一",
      lineNotify: { bound: true },
    },
    sa2: { uid: "UauthSa2", role: "super_admin", lineNotify: { bound: true } },
    admin1: { uid: "Uadmin1", role: "admin", lineUserId: "UadminLine1" },
  };
}

function failSuperAdminQuery(db) {
  const original = db.collection.bind(db);
  return {
    collection(name) {
      const col = original(name);
      if (name !== "users") return col;
      return {
        doc: (id) => col.doc(id),
        where() {
          return {
            limit() {
              return {
                get: async () => {
                  const err = new Error("query down");
                  err.code = "unavailable";
                  throw err;
                },
              };
            },
          };
        },
      };
    },
    runTransaction: (fn) => db.runTransaction(fn),
  };
}

function load(options = {}) {
  const clock = { t: options.t0 ?? T0 };
  const users = options.users === undefined ? defaultUsers() : options.users;
  const seed = {};
  Object.entries(users).forEach(([id, data]) => {
    seed[`users/${id}`] = data;
  });
  const db = createFakeDb({ seed, faults: options.faults });
  const database = options.failAdminQuery ? failSuperAdminQuery(db) : db;
  const logger = makeLogger();
  const roles = options.roles || {};
  const handler = createSubmitContactMessageHandler({
    db: database,
    HttpsError: ContactHttpsError,
    FieldValue,
    now: options.now || (() => clock.t),
    logger,
    getCallerRoleWithFallback: async (request) => {
      if (options.roleError) {
        const err = new Error("role down");
        err.code = "unavailable";
        throw err;
      }
      return roles[request.auth.uid] || "user";
    },
    findUserDocByUidOrLineUserId: async (uid) => {
      if (options.userLookupError) {
        const err = new Error("lookup down");
        err.code = "unavailable";
        throw err;
      }
      const snap = await db.collection("users").doc(uid).get();
      return snap.exists ? { docId: snap.id, data: snap.data() } : null;
    },
    getLineRecipientUidFromUserDoc,
    isStaffRole,
  });
  return {
    db,
    logger,
    clock,
    handler,
    call: (data, uid = CALLER) => handler({
      auth: uid ? { uid } : null,
      data,
    }),
  };
}

function messages(db) {
  return db.paths("contactMessages/").map((itemPath) => ({ id: itemPath.split("/").pop(), ...db.read(itemPath) }));
}

function queued(db) {
  return db.paths("linePushQueue/").map((itemPath) => db.read(itemPath));
}

describe("submitContactMessage", () => {
  test("未登入拒絕，且不寫入", async () => {
    const env = load();
    await expect(env.handler({ data: valid() })).rejects.toMatchObject({
      code: "unauthenticated",
      message: "Authentication required",
    });
    await expect(env.call(valid(), "")).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(env.call(valid(), "   ")).rejects.toMatchObject({ code: "unauthenticated" });
    expect(messages(env.db)).toHaveLength(0);
    expect(env.db.paths("contactMessageLimits/")).toHaveLength(0);
    expect(queued(env.db)).toHaveLength(0);
  });

  test.each([
    ["空白稱呼", { name: "   " }, "INVALID_NAME"],
    ["稱呼過長", { name: "名".repeat(31) }, "INVALID_NAME"],
    ["稱呼不是字串", { name: 12 }, "INVALID_NAME"],
    ["空白聯絡方式", { contact: "\n\t" }, "INVALID_CONTACT"],
    ["聯絡方式過長", { contact: "c".repeat(81) }, "INVALID_CONTACT"],
    ["聯絡方式不是字串", { contact: null }, "INVALID_CONTACT"],
    ["空白內容", { content: "" }, "INVALID_CONTENT"],
    ["內容過長", { content: "文".repeat(1001) }, "INVALID_CONTENT"],
    ["內容不是字串", { content: {} }, "INVALID_CONTENT"],
  ])("%s", async (_label, patch, code) => {
    const env = load();
    await expect(env.call(valid(patch))).rejects.toMatchObject({
      code: "invalid-argument",
      message: code,
      details: { code },
    });
    expect(messages(env.db)).toHaveLength(0);
    expect(queued(env.db)).toHaveLength(0);
  });

  test("以 Array.from 計字：30 個 emoji 可送、31 個拒絕", async () => {
    const ok = load();
    await expect(ok.call(valid({ name: "😀".repeat(30) }))).resolves.toMatchObject({ ok: true });
    const bad = load();
    await expect(bad.call(valid({ name: "😀".repeat(31) }))).rejects.toMatchObject({
      message: "INVALID_NAME",
    });
    expect(messages(bad.db)).toHaveLength(0);
  });

  test("正常送出寫入 contactMessages，並只對 super_admin 入列", async () => {
    const env = load();
    const result = await env.call(valid({
      source: "evil",
      createdAt: "1999-01-01",
      sentAtMs: [1],
    }));
    const stored = messages(env.db);
    expect(result).toEqual({ ok: true, id: stored[0].id });
    expect(stored).toEqual([expect.objectContaining({
      uid: CALLER,
      name: "王小明",
      contact: "line:owner",
      content: "想問週三的場地",
      userName: "王小明",
      status: "new",
      source: "fcb",
      createdAt: "__ts__",
    })]);
    expect(stored[0].createdAt).not.toBe("1999-01-01");
    expect(env.db.read(`contactMessageLimits/${CALLER}`)).toMatchObject({
      uid: CALLER,
      sentAtMs: [T0],
      updatedAt: "__ts__",
    });
    expect(queued(env.db)).toEqual([
      expect.objectContaining({
        uid: "UlineSa1",
        targetDocId: "sa1",
        title: "聯繫站長",
        body: "稱呼：王小明\n聯絡方式：line:owner\n內容：想問週三的場地",
        category: "system",
        status: "pending",
        source: "contact_owner",
        requestedByUid: CALLER,
        requestedByRole: "user",
        pool: "user",
        createdAt: "__ts__",
      }),
      expect.objectContaining({
        uid: "UauthSa2",
        targetDocId: "sa2",
        pool: "user",
        source: "contact_owner",
        category: "system",
      }),
    ]);
    expect(queued(env.db).some((item) => item.uid === "UadminLine1" || item.targetDocId === "admin1")).toBe(false);
    expect(env.db.paths("notificationGuardCounters/")).toEqual([]);
    const dumped = JSON.stringify(env.logger);
    expect(dumped).not.toContain(CALLER);
    expect(dumped).not.toContain("想問週三的場地");
    expect(dumped).not.toContain("line:owner");
  });

  test.each([
    ["a", "a"],
    ["fcb", "fcb"],
    ["A", "fcb"],
    [" fcb", "fcb"],
  ])("source %j 存成 %s", async (input, stored) => {
    const env = load({ users: { [CALLER]: { displayName: "王小明", role: "user" }, sa1: { role: "super_admin", lineUserId: "UlineSa1" } } });
    await env.call(valid({ source: input }));
    expect(messages(env.db)[0].source).toBe(stored);
  });

  test("找不到使用者時 userName 為空字串；顯示名過長截到 80 字", async () => {
    const missing = load({ users: { sa1: { role: "super_admin", lineUserId: "UlineSa1" } } });
    await missing.call(valid());
    expect(messages(missing.db)[0].userName).toBe("");

    const longName = load({
      users: {
        [CALLER]: { displayName: "", name: "名".repeat(81), role: "user" },
        sa1: { role: "super_admin", lineUserId: "UlineSa1" },
      },
    });
    await longName.call(valid());
    expect(messages(longName.db)[0].userName).toBe("名".repeat(80));
  });

  test("使用者查詢失敗仍送出；角色查詢失敗不寫入", async () => {
    const lookup = load({ userLookupError: true });
    await expect(lookup.call(valid())).resolves.toMatchObject({ ok: true });
    expect(messages(lookup.db)[0].userName).toBe("");
    expect(lookup.logger.warns.some(([msg]) => msg === "[submitContactMessage] user lookup failed")).toBe(true);

    const role = load({ roleError: true });
    await expect(role.call(valid())).rejects.toMatchObject({
      code: "internal",
      message: "CONTACT_SUBMIT_FAILED",
    });
    expect(messages(role.db)).toHaveLength(0);
    const dumped = JSON.stringify(role.logger);
    expect(dumped).not.toContain(CALLER);
  });

  test("教練以上的 pool 為 staff", async () => {
    const env = load({ roles: { [CALLER]: "coach" } });
    await env.call(valid());
    expect(queued(env.db).every((item) => item.pool === "staff" && item.requestedByRole === "coach")).toBe(true);
  });

  test("超過 5 位 super_admin 只入列 5 筆", async () => {
    const users = { [CALLER]: { displayName: "王小明", role: "user" } };
    for (let index = 1; index <= 6; index += 1) {
      users[`sa${index}`] = { role: "super_admin", lineUserId: `Uline${index}`, lineNotify: { bound: true } };
    }
    const env = load({ users });
    await env.call(valid());
    const targets = queued(env.db).map((item) => item.targetDocId).sort();
    expect(targets).toEqual(["sa1", "sa2", "sa3", "sa4", "sa5"]);
  });

  test("60 秒內重送被拒，滿 60 秒可再送", async () => {
    const env = load();
    await env.call(valid());
    env.clock.t = T0 + MIN - 1;
    await expect(env.call(valid())).rejects.toMatchObject({
      code: "resource-exhausted",
      message: "CONTACT_RATE_LIMITED",
      details: { code: "CONTACT_RATE_LIMITED" },
    });
    expect(messages(env.db)).toHaveLength(1);
    env.clock.t = T0 + MIN;
    await expect(env.call(valid())).resolves.toMatchObject({ ok: true });
    expect(messages(env.db)).toHaveLength(2);
    expect(env.db.read(`contactMessageLimits/${CALLER}`).sentAtMs).toEqual([T0, T0 + MIN]);
  });

  test("24 小時內第 6 則被拒，滿 24 小時釋出一格", async () => {
    const env = load();
    for (let index = 0; index < 5; index += 1) {
      await env.call(valid({ content: `第${index}則` }));
      env.clock.t += MIN;
    }
    await expect(env.call(valid())).rejects.toMatchObject({ message: "CONTACT_RATE_LIMITED" });
    expect(messages(env.db)).toHaveLength(5);

    env.clock.t = T0 + DAY;
    await expect(env.call(valid({ content: "隔日" }))).resolves.toMatchObject({ ok: true });
    expect(messages(env.db)).toHaveLength(6);
    expect(env.db.read(`contactMessageLimits/${CALLER}`).sentAtMs).toEqual([
      T0 + MIN,
      T0 + 2 * MIN,
      T0 + 3 * MIN,
      T0 + 4 * MIN,
      T0 + DAY,
    ]);
  });

  test("推播入列失敗或查無站長查詢失敗仍回 ok，訊息已存", async () => {
    const writeFail = load({
      faults: {
        write: ({ path }) => (path.startsWith("linePushQueue/")
          ? Object.assign(new Error("queue down"), { code: "unavailable" })
          : null),
      },
    });
    await expect(writeFail.call(valid({ content: "SECRET_BODY" }))).resolves.toMatchObject({ ok: true });
    expect(messages(writeFail.db)).toHaveLength(1);
    expect(queued(writeFail.db)).toHaveLength(0);
    expect(writeFail.logger.warns.filter(([msg]) => msg === "[submitContactMessage] line push enqueue failed")).toHaveLength(2);
    expect(JSON.stringify(writeFail.logger)).not.toContain("SECRET_BODY");
    expect(JSON.stringify(writeFail.logger)).not.toContain(CALLER);

    const queryFail = load({ failAdminQuery: true });
    await expect(queryFail.call(valid())).resolves.toMatchObject({ ok: true });
    expect(messages(queryFail.db)).toHaveLength(1);
    expect(queued(queryFail.db)).toHaveLength(0);
    expect(queryFail.logger.warns.some(([msg]) => msg === "[submitContactMessage] notify failed")).toBe(true);
  });

  test("沒有 super_admin 仍回 ok", async () => {
    const env = load({ users: { [CALLER]: { displayName: "王小明", role: "user" } } });
    await expect(env.call(valid())).resolves.toMatchObject({ ok: true });
    expect(queued(env.db)).toHaveLength(0);
    expect(env.logger.warns.some(([msg]) => msg === "[submitContactMessage] no super_admin recipient")).toBe(true);
  });

  test("body 依序含稱呼、聯絡方式，內容超過 300 字加省略號", async () => {
    const exact = load();
    await exact.call(valid({ content: "測".repeat(300) }));
    expect(queued(exact.db)[0].body).toBe(`稱呼：王小明\n聯絡方式：line:owner\n內容：${"測".repeat(300)}`);
    expect(queued(exact.db)[0].body.includes("…")).toBe(false);

    const over = load();
    const content = "測".repeat(301);
    await over.call(valid({ content }));
    expect(messages(over.db)[0].content).toBe(content);
    expect(queued(over.db)[0].body).toBe(`稱呼：王小明\n聯絡方式：line:owner\n內容：${"測".repeat(300)}…`);

    const emoji = load();
    await emoji.call(valid({ content: "😀".repeat(301) }));
    expect(queued(emoji.db)[0].body.endsWith(`內容：${"😀".repeat(300)}…`)).toBe(true);
    expect(messages(emoji.db)[0].content).toBe("😀".repeat(301));
  });

  // 測試同步更新：被拒一律不寫入限制文件（Opus 複審 P3-1）
  test("先以 t+5 秒送一則，再以 t 送必須被拒，且被拒的那次不佔額度", async () => {
    const later = T0 + 5000;
    const env = load({ t0: later });
    await env.call(valid({ content: "未來" }));
    env.clock.t = T0;
    await expect(env.call(valid({ content: "較早" }))).rejects.toMatchObject({
      code: "resource-exhausted",
      message: "CONTACT_RATE_LIMITED",
      details: { code: "CONTACT_RATE_LIMITED" },
    });
    expect(messages(env.db).map((item) => item.content)).toEqual(["未來"]);
    expect(env.db.read(`contactMessageLimits/${CALLER}`).sentAtMs).toEqual([later]);
    expect(env.db.read("contactMessageLimits/daily-20261108").storedCount).toBe(1);
  });

  test("fake DB 模擬 20 個併發（時間遞減）只收 1 則", async () => {
    const times = Array.from({ length: 20 }, (_, index) => T0 + (19 - index) * 1000);
    let cursor = 0;
    const env = load({ now: () => times[cursor++] });
    const results = await Promise.all(times.map((_, index) => env.call(valid({ content: `n${index}` })).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, message: error.message }),
    )));
    expect(results.filter((item) => item.ok)).toHaveLength(1);
    expect(results.filter((item) => !item.ok).every((item) => item.message === "CONTACT_RATE_LIMITED")).toBe(true);
    expect(messages(env.db)).toHaveLength(1);
    expect(messages(env.db)[0].content).toBe("n0");
    const sentAtMs = env.db.read(`contactMessageLimits/${CALLER}`).sentAtMs;
    expect(sentAtMs).toEqual([times[0]]);
    expect(env.db.read("contactMessageLimits/daily-20261108").storedCount).toBe(1);
  });

  test("全站每日第 20 則照常推播、第 21 則改推上限通知、第 22 則不推", async () => {
    const env = load();
    for (let index = 1; index <= 22; index += 1) {
      await env.call(valid({ content: `第${index}則` }), `Udaily${index}`);
    }
    const items = queued(env.db);
    const notices = items.filter((item) => item.body === "今日聯繫訊息已達推播上限，請到後台查看");
    expect(messages(env.db)).toHaveLength(22);
    expect(items.filter((item) => item.body.includes("第20則"))).toHaveLength(2);
    expect(items.some((item) => item.body.includes("第21則") || item.body.includes("第22則"))).toBe(false);
    expect(notices.map((item) => item.targetDocId).sort()).toEqual(["sa1", "sa2"]);
    expect(items).toHaveLength(42);
    expect(env.db.read("contactMessageLimits/daily-20261108")).toMatchObject({
      storedCount: 22,
      capNoticeSent: true,
    });
  });

  test("全站每日第 301 則被拒且不寫入", async () => {
    const env = load();
    for (let index = 1; index <= 300; index += 1) {
      await env.call(valid({ content: `第${index}則` }), `Ucap${index}`);
    }
    await expect(env.call(valid({ content: "第301則" }), "Ucap301")).rejects.toMatchObject({
      code: "resource-exhausted",
      message: "CONTACT_DAILY_LIMIT",
      details: { code: "CONTACT_DAILY_LIMIT" },
    });
    expect(messages(env.db)).toHaveLength(300);
    expect(messages(env.db).some((item) => item.content === "第301則")).toBe(false);
    expect(env.db.read("contactMessageLimits/daily-20261108").storedCount).toBe(300);
    expect(env.db.paths("contactMessageLimits/").some((itemPath) => itemPath.includes("__"))).toBe(false);
  });

  test("未綁定的 super_admin 不推播；個人 system 關閉仍推給已綁定站長", async () => {
    const env = load({
      users: {
        [CALLER]: { displayName: "王小明", role: "user" },
        unbound: { role: "super_admin", lineUserId: "Uunbound", lineNotify: { bound: false } },
        missing: { role: "super_admin", lineUserId: "Umissing" },
        systemOff: {
          role: "super_admin",
          lineUserId: "Ubound",
          lineNotify: { bound: true, settings: { system: false } },
        },
      },
    });
    await env.call(valid());
    expect(queued(env.db).map((item) => item.targetDocId)).toEqual(["systemOff"]);
    expect(queued(env.db)[0].uid).toBe("Ubound");
  });

  test("沒有已綁定站長時只存檔並 warn", async () => {
    const env = load({
      users: {
        [CALLER]: { displayName: "王小明", role: "user" },
        sa1: { role: "super_admin", lineUserId: "UlineSa1", lineNotify: { bound: false } },
        sa2: { role: "super_admin", lineNotify: { bound: "true" } },
      },
    });
    await expect(env.call(valid())).resolves.toMatchObject({ ok: true });
    expect(messages(env.db)).toHaveLength(1);
    expect(queued(env.db)).toHaveLength(0);
    expect(env.logger.warns.some(([msg]) => msg === "[submitContactMessage] no super_admin recipient")).toBe(true);
  });

  test("只有控制字元的內容被拒，稱呼含換行被拒", async () => {
    const controls = load();
    await expect(controls.call(valid({ content: "\u0000\u0001\u0008\u000B\u001F" }))).rejects.toMatchObject({
      code: "invalid-argument",
      message: "INVALID_CONTENT",
      details: { code: "INVALID_CONTENT" },
    });
    expect(messages(controls.db)).toHaveLength(0);
    expect(controls.db.paths("contactMessageLimits/")).toHaveLength(0);

    const brokenName = load();
    await expect(brokenName.call(valid({ name: "王\n小明" }))).rejects.toMatchObject({ message: "INVALID_NAME" });
    await expect(brokenName.call(valid({ name: "王\r小明" }))).rejects.toMatchObject({ message: "INVALID_NAME" });
    await expect(brokenName.call(valid({ name: "王\t小明" }))).rejects.toMatchObject({ message: "INVALID_NAME" });
    await expect(brokenName.call(valid({ contact: "line\nowner" }))).rejects.toMatchObject({ message: "INVALID_CONTACT" });
    expect(messages(brokenName.db)).toHaveLength(0);

    const stripped = load();
    await stripped.call(valid({ name: "王\u0000小明", content: "想問\u0000場地" }));
    expect(messages(stripped.db)[0]).toMatchObject({ name: "王小明", content: "想問場地" });
  });

  test("註冊在 asia-east1，index.js 接到既有 helper", () => {
    const db = createFakeDb();
    const onCall = jest.fn((options, handler) => ({ options, handler }));
    const callable = createSubmitContactMessageCallable({
      onCall,
      db,
      HttpsError: ContactHttpsError,
      FieldValue,
      getCallerRoleWithFallback: async () => "user",
      findUserDocByUidOrLineUserId: async () => null,
      getLineRecipientUidFromUserDoc,
      isStaffRole: () => false,
    });
    expect(callable.options).toEqual({
      region: "asia-east1",
      timeoutSeconds: 20,
      memory: "256MiB",
      minInstances: 0,
      maxInstances: 5,
    });
    expect(Object.prototype.hasOwnProperty.call(callable.options, "secrets")).toBe(false);

    const indexSource = fs.readFileSync(path.join(__dirname, "..", "..", "functions", "index.js"), "utf8");
    expect(indexSource).toContain('const { createSubmitContactMessageCallable } = require("./contact-message");');
    const start = indexSource.indexOf("exports.submitContactMessage = createSubmitContactMessageCallable(");
    const block = indexSource.slice(start, indexSource.indexOf("});", start));
    expect(block).toContain("getLineRecipientUidFromUserDoc");
    expect(block).toContain("findUserDocByUidOrLineUserId");
    expect(block).toContain("getCallerRoleWithFallback");
    expect(block).toContain("isStaffRole: (role) => notificationGuards.isStaffRole(role)");
    expect(block).not.toContain("defineSecret");
  });
});
