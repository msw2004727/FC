"use strict";

/**
 * T-062 S4：報名／取消／候補遞補站內信的特性測試（收件人與文字）。
 * 期望值取自收斂前（origin/main 133e5c122）functions/index.js 的 registerForEvent P2／P4、
 * cancelRegistration P1／P2 實際輸出；收斂到 functions/registration-notify.js 後同一批測試必須照綠。
 * 唯一允許改期望值的是顧問 §3.637 Q3（同一人多筆取消／遞補改每人一則），另開 commit 並寫明前後差異。
 *
 * 用記憶體版 Firestore 跑真的 handler（tests/unit/registration-callable-harness.js），不碰正式資料。
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  FakeTimestamp,
  createFakeFirestore,
  loadFunctionsIndex,
} = require("./registration-callable-harness");

const U_SELF = `U${"1".repeat(32)}`;
const U_OTHER = `U${"2".repeat(32)}`;
const U_THIRD = `U${"3".repeat(32)}`;
const U_FOURTH = `U${"4".repeat(32)}`;
const U_ADMIN = `U${"9".repeat(32)}`;
const EVENT_ID = "ce_1800000000000_abc";
const TITLE = "通知測試活動";
const DATE = "2099/06/15 10:00~12:00";
const LOCATION = "河濱球場";

// ── 改前文字基準（逐字取自 133e5c122 的 functions/index.js） ──
const TAIL = `活動名稱：${TITLE}\n活動時間：${DATE}\n活動地點：${LOCATION}`;
const SIGNUP_TITLE = "報名成功通知";
const signupBody = (label, earlyBirdCost = null) => `報名結果：${label}\n\n`
  + (earlyBirdCost !== null ? `早鳥報名扣除：${earlyBirdCost} 積分\n\n` : "")
  + TAIL;
const PROMOTED = { title: "候補遞補通知", body: `恭喜！您已從候補升為正取：\n\n${TAIL}` };
const CANCELLED = { title: "取消報名通知", body: TAIL };
const REMOVED = { title: "報名已被管理員移除", body: TAIL };

let fn;
let harness;
let fake;

beforeAll(() => {
  const loaded = loadFunctionsIndex();
  fn = loaded.exports;
  harness = loaded.harness;
});

beforeEach(() => {
  harness.logs.length = 0;
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  // 情境 11：任何情境都不得寫 LINE 佇列（報名類 LINE 增量必須為 0）
  if (fake) expect(fake.paths().filter((p) => p.startsWith("linePushQueue/"))).toEqual([]);
  fake = null;
  jest.restoreAllMocks();
});

function user(uid, extra = {}) {
  return {
    uid, lineUserId: uid, name: `name-${uid.slice(1, 3)}`, displayName: `user-${uid.slice(1, 3)}`,
    gender: "male", birthday: "1990-01-01", region: "taipei", role: "user", exp: 100, ...extra,
  };
}

function event(extra = {}) {
  return {
    id: EVENT_ID, title: TITLE, date: DATE, location: LOCATION, type: "play",
    status: "open", max: 10, current: 0, waitlist: 0, participants: [], waitlistNames: [], ...extra,
  };
}

function reg(docId, data) {
  return {
    id: `reg_${docId}`, eventId: EVENT_ID, participantType: "self", companionId: null, companionName: null,
    promotionOrder: 0, ...data,
  };
}

function companion(docId, uid, n, data = {}) {
  return reg(docId, {
    userId: uid, userName: `comp-${n}`, participantType: "companion", companionId: `cmp${n}`,
    companionName: `comp-${n}`, ...data,
  });
}

function setup(seed = {}) {
  fake = createFakeFirestore({
    [`users/${U_SELF}`]: user(U_SELF),
    [`users/${U_OTHER}`]: user(U_OTHER),
    [`users/${U_THIRD}`]: user(U_THIRD),
    [`users/${U_FOURTH}`]: user(U_FOURTH),
    [`users/${U_ADMIN}`]: user(U_ADMIN, { role: "super_admin" }),
    ...seed,
  });
  harness.current = fake;
  return fake;
}

const register = (uid, data) => fn.registerForEvent({ auth: { uid, token: {} }, data });
const selfPayload = (uid, extra = {}) => ({
  eventId: EVENT_ID, participants: [{ userId: uid, userName: `n-${uid.slice(1, 3)}` }], ...extra,
});
const cancel = (uid, data) => fn.cancelRegistration({ auth: { uid, token: {} }, data });

// 新路徑 users/{uid}/inbox 的全部通知，依收件人、標題、內文排序
function inboxNotices() {
  return fake.paths()
    .filter((p) => /^users\/[^/]+\/inbox\/[^/]+$/.test(p))
    .map((p) => {
      const doc = fake.get(p);
      return { to: p.split("/")[1], title: doc.title, body: doc.body };
    })
    .sort(byNotice);
}

// 舊路徑 messages/ 的全部通知（同一 batch 雙寫，必須與新路徑一一對應）
function legacyNotices() {
  return fake.list("messages")
    .map((id) => {
      const doc = fake.get(`messages/${id}`);
      return { to: doc.recipientUid, title: doc.title, body: doc.body };
    })
    .sort(byNotice);
}

function byNotice(a, b) {
  return `${a.to}|${a.title}|${a.body}`.localeCompare(`${b.to}|${b.title}|${b.body}`);
}

function expectNotices(expected) {
  const sorted = [...expected].sort(byNotice);
  expect(inboxNotices()).toEqual(sorted);
  expect(legacyNotices()).toEqual(sorted);
}

const n = (to, notice) => ({ to, ...notice });

const postCommitErrors = () => harness.logs
  .filter((entry) => entry[0] === "error")
  .filter((entry) => JSON.stringify(entry.slice(1)).match(/bestEffortPostCommitOps/));

describe("情境 1～3：registerForEvent", () => {
  test("1a 本人報名正取：本人恰 1 則「報名成功通知／正取」", async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    const result = await register(U_SELF, selfPayload(U_SELF));
    expect(result.registrations[0].status).toBe("confirmed");
    expectNotices([n(U_SELF, { title: SIGNUP_TITLE, body: signupBody("正取") })]);
    expect(postCommitErrors()).toEqual([]);
  });

  test("1b 本人報名候補：本人恰 1 則「報名成功通知／候補」", async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 1, current: 1, participants: ["other"] }),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
        userId: U_OTHER, userName: "other", status: "confirmed", registeredAt: new FakeTimestamp(1000),
      }),
    });
    const result = await register(U_SELF, selfPayload(U_SELF));
    expect(result.registrations[0].status).toBe("waitlisted");
    expectNotices([n(U_SELF, { title: SIGNUP_TITLE, body: signupBody("候補") })]);
  });

  test("1c 早鳥報名：內文多一行「早鳥報名扣除：20 積分」", async () => {
    const notOpen = new FakeTimestamp(Date.now() + 24 * 60 * 60 * 1000);
    setup({
      [`events/${EVENT_ID}`]: event({ regOpenTime: notOpen, earlyBirdEnabled: true, earlyBirdCost: 20, status: "upcoming" }),
    });
    const result = await register(U_SELF, selfPayload(U_SELF, { earlyBirdAccepted: true, earlyBirdExpectedCost: 20 }));
    expect(result.earlyBirdCharged).toBe(true);
    expectNotices([n(U_SELF, { title: SIGNUP_TITLE, body: signupBody("正取", 20) })]);
  });

  test("2 本人＋2 同行者報名：本人 1 則，同行者不另發", async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    const result = await register(U_SELF, {
      eventId: EVENT_ID,
      participants: [
        { userId: U_SELF, userName: "self" },
        { userId: U_SELF, userName: "comp-1", companionId: "cmp1", companionName: "comp-1" },
        { userId: U_SELF, userName: "comp-2", companionId: "cmp2", companionName: "comp-2" },
      ],
    });
    expect(result.registrations).toHaveLength(3);
    expectNotices([n(U_SELF, { title: SIGNUP_TITLE, body: signupBody("正取") })]);
  });

  test("3 報名觸發空洞遞補（含同組同行者）：每個被遞補 uid 1 則，新報名者 1 則", async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 4, current: 1, waitlist: 3, participants: ["self"] }),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
        userId: U_SELF, userName: "self", status: "confirmed", registeredAt: new FakeTimestamp(1000),
      }),
      [`events/${EVENT_ID}/registrations/r2`]: reg("r2", {
        userId: U_OTHER, userName: "other", status: "waitlisted", registeredAt: new FakeTimestamp(2000),
      }),
      [`events/${EVENT_ID}/registrations/r3`]: companion("r3", U_OTHER, 1, {
        status: "waitlisted", registeredAt: new FakeTimestamp(2001),
      }),
      [`events/${EVENT_ID}/registrations/r4`]: reg("r4", {
        userId: U_FOURTH, userName: "fourth", status: "waitlisted", registeredAt: new FakeTimestamp(3000),
      }),
    });
    const result = await register(U_THIRD, selfPayload(U_THIRD));
    expect(result.registrations[0].status).toBe("waitlisted");
    expect(["r2", "r3", "r4"].map((id) => fake.get(`events/${EVENT_ID}/registrations/${id}`).status))
      .toEqual(["confirmed", "confirmed", "confirmed"]);
    expectNotices([
      n(U_OTHER, PROMOTED),
      n(U_FOURTH, PROMOTED),
      n(U_THIRD, { title: SIGNUP_TITLE, body: signupBody("候補") }),
    ]);
  });
});

describe("情境 4～7、9：cancelRegistration", () => {
  test("4 本人取消正取並觸發遞補 1 人：取消者 1 則、被遞補者 1 則", async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 1, current: 1, waitlist: 1 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
        userId: U_SELF, userName: "self", status: "confirmed", registeredAt: new FakeTimestamp(1000),
      }),
      [`events/${EVENT_ID}/registrations/r2`]: reg("r2", {
        userId: U_OTHER, userName: "other", status: "waitlisted", registeredAt: new FakeTimestamp(2000),
      }),
    });
    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"] });
    expect(result.promoted.map((r) => r.docId)).toEqual(["r2"]);
    expectNotices([n(U_SELF, CANCELLED), n(U_OTHER, PROMOTED)]);
    expect(postCommitErrors()).toEqual([]);
  });

  // Q3（顧問 §3.637）：改前逐筆 3 則 → 改後每人 1 則
  test("5 取消本人＋2 同行者（3 筆）：本人 1 則（Q3）", async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ current: 3 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
        userId: U_SELF, userName: "self", status: "confirmed", registeredAt: new FakeTimestamp(1000),
      }),
      [`events/${EVENT_ID}/registrations/c1`]: companion("c1", U_SELF, 1, { status: "confirmed", registeredAt: new FakeTimestamp(1001) }),
      [`events/${EVENT_ID}/registrations/c2`]: companion("c2", U_SELF, 2, { status: "confirmed", registeredAt: new FakeTimestamp(1002) }),
    });
    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1", "c1", "c2"] });
    expect(result.cancelled).toHaveLength(3);
    expectNotices([n(U_SELF, CANCELLED)]);
  });

  // Q3：改前取消者 2 則、被遞補者 2 則 → 改後各 1 則
  test("6 取消後遞補一組（主＋同行者）：取消者 1 則、被遞補者 1 則（Q3）", async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 2, current: 2, waitlist: 2 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
        userId: U_SELF, userName: "self", status: "confirmed", registeredAt: new FakeTimestamp(1000),
      }),
      [`events/${EVENT_ID}/registrations/c1`]: companion("c1", U_SELF, 1, { status: "confirmed", registeredAt: new FakeTimestamp(1001) }),
      [`events/${EVENT_ID}/registrations/r2`]: reg("r2", {
        userId: U_OTHER, userName: "other", status: "waitlisted", registeredAt: new FakeTimestamp(2000),
      }),
      [`events/${EVENT_ID}/registrations/c2`]: companion("c2", U_OTHER, 2, { status: "waitlisted", registeredAt: new FakeTimestamp(2001) }),
    });
    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1", "c1"] });
    expect(result.promoted.map((r) => r.docId).sort()).toEqual(["c2", "r2"]);
    expectNotices([n(U_SELF, CANCELLED), n(U_OTHER, PROMOTED)]);
  });

  test("7a manager_remove：被移除者收「報名已被管理員移除」，呼叫者不收", async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ current: 1 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
        userId: U_SELF, userName: "self", status: "confirmed", registeredAt: new FakeTimestamp(1000),
      }),
    });
    await cancel(U_ADMIN, { eventId: EVENT_ID, registrationIds: ["r1"], reason: "manager_remove" });
    expectNotices([n(U_SELF, REMOVED)]);
  });

  // Q3：改前帶同行者的那人 2 則 → 改後 1 則；其他人照舊每人 1 則
  test("7b 主辦一次移除多人（其中一人帶同行者）：仍是每人 1 則（Q3）", async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ current: 4 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
        userId: U_SELF, userName: "self", status: "confirmed", registeredAt: new FakeTimestamp(1000),
      }),
      [`events/${EVENT_ID}/registrations/c1`]: companion("c1", U_SELF, 1, { status: "confirmed", registeredAt: new FakeTimestamp(1001) }),
      [`events/${EVENT_ID}/registrations/r2`]: reg("r2", {
        userId: U_OTHER, userName: "other", status: "confirmed", registeredAt: new FakeTimestamp(2000),
      }),
      [`events/${EVENT_ID}/registrations/r3`]: reg("r3", {
        userId: U_THIRD, userName: "third", status: "confirmed", registeredAt: new FakeTimestamp(3000),
      }),
    });
    const result = await cancel(U_ADMIN, {
      eventId: EVENT_ID, registrationIds: ["r1", "c1", "r2", "r3"], reason: "manager_remove",
    });
    expect(result.cancelled).toHaveLength(4);
    expectNotices([n(U_SELF, REMOVED), n(U_OTHER, REMOVED), n(U_THIRD, REMOVED)]);
  });

  test("7c capacity_change：標題為「取消報名通知」", async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ current: 1 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
        userId: U_SELF, userName: "self", status: "confirmed", registeredAt: new FakeTimestamp(1000),
      }),
    });
    await cancel(U_ADMIN, { eventId: EVENT_ID, registrationIds: ["r1"], reason: "capacity_change" });
    expectNotices([n(U_SELF, CANCELLED)]);
  });

  test("7d 全部已取消的冪等重送：0 則", async () => {
    setup({
      [`events/${EVENT_ID}`]: event(),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
        userId: U_SELF, userName: "self", status: "cancelled", registeredAt: new FakeTimestamp(1000),
      }),
    });
    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"] });
    expect(result.cancelled).toEqual([]);
    expectNotices([]);
  });

  test("9 課程連動報名的家長請假：收件人照改前（報名上的 userId），1 則", async () => {
    const teamId = "tm_1800000000000_abcdef";
    const courseLinkId = "link-1";
    const courseFields = {
      courseLinkId, courseTeamId: teamId, coursePlanId: "plan-1", courseSessionId: "sess-1",
    };
    setup({
      [`events/${EVENT_ID}`]: event({
        max: 1, current: 1, courseLinked: true, courseLinkSource: "eduCourseLesson", ...courseFields,
      }),
      [`events/${EVENT_ID}/registrations/rc`]: reg("rc", {
        userId: "student-a", userName: "kid", status: "confirmed", registeredAt: new FakeTimestamp(1000),
        source: "eduCourseLesson", ...courseFields, courseStudentId: "student-a",
      }),
      [`teams/${teamId}`]: { id: teamId, name: "team" },
      [`teams/${teamId}/coursePlans/plan-1`]: { id: "plan-1" },
      [`teams/${teamId}/coursePlans/plan-1/sessions/sess-1`]: { id: "sess-1", date: "2099/06/15" },
      [`teams/${teamId}/coursePlans/plan-1/sessionEventLinks/sess-1`]: { eventId: EVENT_ID, courseLinkId },
      [`teams/${teamId}/students/student-a`]: { id: "student-a", name: "kid", parentUid: U_SELF },
    });
    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["rc"] });
    expect(result.cancelled.map((r) => r.docId)).toEqual(["rc"]);
    expectNotices([n("student-a", CANCELLED)]);
  });
});

describe("情境 8：同 requestId 重送", () => {
  test("registerForEvent 第二次 0 則", async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    await register(U_SELF, selfPayload(U_SELF, { requestId: "notify-r1" }));
    const replay = await register(U_SELF, selfPayload(U_SELF, { requestId: "notify-r1" }));
    expect(replay.deduplicated).toBe(true);
    expectNotices([n(U_SELF, { title: SIGNUP_TITLE, body: signupBody("正取") })]);
  });

  test("cancelRegistration 第二次 0 則", async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 1, current: 1, waitlist: 1 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
        userId: U_SELF, userName: "self", status: "confirmed", registeredAt: new FakeTimestamp(1000),
      }),
      [`events/${EVENT_ID}/registrations/r2`]: reg("r2", {
        userId: U_OTHER, userName: "other", status: "waitlisted", registeredAt: new FakeTimestamp(2000),
      }),
    });
    const payload = { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "notify-c1" };
    await cancel(U_SELF, payload);
    const replay = await cancel(U_SELF, payload);
    expect(replay.deduplicated).toBe(true);
    expectNotices([n(U_SELF, CANCELLED), n(U_OTHER, PROMOTED)]);
  });
});

describe("情境 10：站內信寫入失敗不影響已成功的交易", () => {
  function failInboxBatches() {
    const realBatch = fake.db.batch.bind(fake.db);
    fake.db.batch = () => {
      const batch = realBatch();
      batch.commit = async () => { throw new Error("inbox batch down"); };
      return batch;
    };
  }

  test("registerForEvent 仍回 success，報名已寫入", async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    failInboxBatches();
    const result = await register(U_SELF, selfPayload(U_SELF));
    expect(result.success).toBe(true);
    expect(result.registrations[0].status).toBe("confirmed");
    expect(fake.get(`events/${EVENT_ID}/registrations/${result.registrations[0].docId}`).status).toBe("confirmed");
    expectNotices([]);
  });

  test("cancelRegistration 仍回 success，取消與遞補已寫入", async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 1, current: 1, waitlist: 1 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
        userId: U_SELF, userName: "self", status: "confirmed", registeredAt: new FakeTimestamp(1000),
      }),
      [`events/${EVENT_ID}/registrations/r2`]: reg("r2", {
        userId: U_OTHER, userName: "other", status: "waitlisted", registeredAt: new FakeTimestamp(2000),
      }),
    });
    failInboxBatches();
    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"] });
    expect(result.success).toBe(true);
    expect(fake.get(`events/${EVENT_ID}/registrations/r1`).status).toBe("cancelled");
    expect(fake.get(`events/${EVENT_ID}/registrations/r2`).status).toBe("confirmed");
    expectNotices([]);
  });
});

describe("過渡期不重複：舊站 A 正式環境一律走 Callable（只讀 js/config.js，不改舊站）", () => {
  function loadConfigHelpers() {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", "js", "config.js"), "utf8");
    const pick = (name) => {
      const start = source.indexOf(`function ${name}(`);
      expect(start).toBeGreaterThanOrEqual(0);
      let depth = 0;
      for (let i = source.indexOf("{", start); i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        if (source[i] === "}") { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
      }
      throw new Error(`unterminated ${name}`);
    };
    const modeLine = source.split("\n").find((line) => line.startsWith("const ModeManager = "));
    expect(modeLine).toBeDefined();
    // 最壞情況：featureFlags 把 useServerRegistration 關掉，正式模式仍必須走 Callable
    const context = {
      FirebaseService: { getCachedDoc: () => ({ useServerRegistration: false }) },
      App: { currentUser: { uid: "u" } },
    };
    vm.createContext(context);
    vm.runInContext([
      modeLine,
      pick("shouldUseServerRegistration"),
      pick("shouldUseServerRegistrationForSignup"),
      pick("shouldUseServerRegistrationForCancel"),
      "this.helpers = { mode: ModeManager.getMode(), signup: shouldUseServerRegistrationForSignup(), cancel: shouldUseServerRegistrationForCancel() };",
    ].join("\n"), context);
    return context.helpers;
  }

  test("ModeManager 固定 production，報名與取消都回 true（前端 !useCF 分支的通知不會跑）", () => {
    expect(loadConfigHelpers()).toEqual({ mode: "production", signup: true, cancel: true });
  });
});
