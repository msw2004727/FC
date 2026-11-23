"use strict";

/**
 * T-062 S4：接進 registerForEvent／cancelRegistration 後的整合斷言（情境 11、12）。
 * 收件人與文字的前後一致由 registration-notify-characterization.test.js 鎖；這裡只驗計數 log 與 LINE 0。
 */

const {
  FakeTimestamp,
  createFakeFirestore,
  loadFunctionsIndex,
} = require("./registration-callable-harness");

const U_SELF = `U${"1".repeat(32)}`;
const U_OTHER = `U${"2".repeat(32)}`;
const U_ADMIN = `U${"9".repeat(32)}`;
const EVENT_ID = "ce_1800000000000_abc";
const TITLE = "通知測試活動";
const LOCATION = "河濱球場";
const LOG_FIELD_WHITELIST = [
  "cancelled", "cancelledRegs", "channels", "fn", "inboxFailed", "promoted", "promotedRegs", "removed", "signup",
];

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
  jest.restoreAllMocks();
});

function user(uid, extra = {}) {
  return {
    uid, lineUserId: uid, name: "n", displayName: "d", gender: "male",
    birthday: "1990-01-01", region: "taipei", role: "user", exp: 100, ...extra,
  };
}

function reg(docId, data) {
  return {
    id: `reg_${docId}`, eventId: EVENT_ID, participantType: "self", companionId: null, companionName: null,
    promotionOrder: 0, ...data,
  };
}

function setup(seed = {}) {
  fake = createFakeFirestore({
    [`users/${U_SELF}`]: user(U_SELF),
    [`users/${U_OTHER}`]: user(U_OTHER),
    [`users/${U_ADMIN}`]: user(U_ADMIN, { role: "super_admin" }),
    [`events/${EVENT_ID}`]: {
      id: EVENT_ID, title: TITLE, date: "2099/06/15 10:00~12:00", location: LOCATION, type: "play",
      status: "open", max: 1, current: 1, waitlist: 1, participants: [], waitlistNames: [],
    },
    [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
      userId: U_SELF, userName: "self", status: "confirmed", registeredAt: new FakeTimestamp(1000),
    }),
    [`events/${EVENT_ID}/registrations/r2`]: reg("r2", {
      userId: U_OTHER, userName: "other", status: "waitlisted", registeredAt: new FakeTimestamp(2000),
    }),
    ...seed,
  });
  harness.current = fake;
}

const dispatchLogs = () => harness.logs.filter((entry) => entry[1] === "[registrationNotify] dispatched");

function expectCleanLog(entry) {
  expect(Object.keys(entry[2]).sort()).toEqual(LOG_FIELD_WHITELIST);
  const serialized = JSON.stringify(entry);
  for (const secret of [U_SELF, U_OTHER, U_ADMIN, EVENT_ID, TITLE, LOCATION, "通知"]) {
    expect(serialized).not.toContain(secret);
  }
}

test("報名：恰一行計數 log，欄位白名單，不含 uid／活動代號／標題／內文；不寫 LINE 佇列", async () => {
  fake = createFakeFirestore({
    [`users/${U_SELF}`]: user(U_SELF),
    [`events/${EVENT_ID}`]: {
      id: EVENT_ID, title: TITLE, date: "2099/06/15 10:00~12:00", location: LOCATION, type: "play",
      status: "open", max: 5, current: 0, waitlist: 0, participants: [], waitlistNames: [],
    },
  });
  harness.current = fake;
  await fn.registerForEvent({
    auth: { uid: U_SELF, token: {} },
    data: { eventId: EVENT_ID, participants: [{ userId: U_SELF, userName: "self" }] },
  });
  const logs = dispatchLogs();
  expect(logs).toHaveLength(1);
  expect(logs[0][0]).toBe("info");
  expect(logs[0][2]).toEqual({
    fn: "registerForEvent", signup: 1, promoted: 0, cancelled: 0, removed: 0,
    cancelledRegs: 0, promotedRegs: 0, inboxFailed: 0, channels: "inbox",
  });
  expectCleanLog(logs[0]);
  expect(fake.paths().filter((p) => p.startsWith("linePushQueue/"))).toEqual([]);
});

function cancelAudit() {
  return fake.paths().filter((p) => /^auditLogsByDay\/[^/]+\/auditEntries\/[^/]+$/.test(p))
    .map((p) => fake.get(p))
    .find((entry) => entry.action === "event_cancel_signup");
}

test("取消並遞補：Regs 與 audit 的 cancelledCount／promotedCount 一致；不寫 LINE 佇列", async () => {
  setup();
  await fn.cancelRegistration({ auth: { uid: U_SELF, token: {} }, data: { eventId: EVENT_ID, registrationIds: ["r1"] } });
  const logs = dispatchLogs();
  expect(logs).toHaveLength(1);
  expect(logs[0][2]).toEqual({
    fn: "cancelRegistration", signup: 0, promoted: 1, cancelled: 1, removed: 0,
    cancelledRegs: 1, promotedRegs: 1, inboxFailed: 0, channels: "inbox",
  });
  expectCleanLog(logs[0]);
  const audit = cancelAudit();
  expect(audit).toBeDefined();
  expect(audit.meta).toMatchObject({ cancelledCount: logs[0][2].cancelledRegs, promotedCount: logs[0][2].promotedRegs });
  expect(fake.paths().filter((p) => p.startsWith("linePushQueue/"))).toEqual([]);
});

test("本人＋2 同行者取消、遞補一組 2 筆：Regs 等於 audit 筆數，人數 ≤ 筆數（審查 P2-2）", async () => {
  const companion = (docId, uid, n, status, ms) => reg(docId, {
    userId: uid, userName: `comp-${n}`, participantType: "companion", companionId: `cmp${n}`,
    companionName: `comp-${n}`, status, registeredAt: new FakeTimestamp(ms),
  });
  setup({
    [`events/${EVENT_ID}`]: {
      id: EVENT_ID, title: TITLE, date: "2099/06/15 10:00~12:00", location: LOCATION, type: "play",
      status: "full", max: 3, current: 3, waitlist: 2, participants: [], waitlistNames: [],
    },
    [`events/${EVENT_ID}/registrations/c1`]: companion("c1", U_SELF, 1, "confirmed", 1001),
    [`events/${EVENT_ID}/registrations/c2`]: companion("c2", U_SELF, 2, "confirmed", 1002),
    [`events/${EVENT_ID}/registrations/r2`]: reg("r2", {
      userId: U_OTHER, userName: "other", status: "waitlisted", registeredAt: new FakeTimestamp(2000),
    }),
    [`events/${EVENT_ID}/registrations/c3`]: companion("c3", U_OTHER, 3, "waitlisted", 2001),
  });
  await fn.cancelRegistration({
    auth: { uid: U_SELF, token: {} }, data: { eventId: EVENT_ID, registrationIds: ["r1", "c1", "c2"] },
  });
  const logs = dispatchLogs();
  expect(logs).toHaveLength(1);
  const summary = logs[0][2];
  expect(summary).toMatchObject({ cancelled: 1, cancelledRegs: 3, promoted: 1, promotedRegs: 2, signup: 0 });
  const audit = cancelAudit();
  expect(audit.meta).toMatchObject({ cancelledCount: summary.cancelledRegs, promotedCount: summary.promotedRegs });
  expect(summary.cancelled).toBeLessThanOrEqual(summary.cancelledRegs);
  expect(summary.promoted).toBeLessThanOrEqual(summary.promotedRegs);
  expectCleanLog(logs[0]);
});

test("manager_remove：計入 removed，不計 cancelled", async () => {
  setup();
  await fn.cancelRegistration({
    auth: { uid: U_ADMIN, token: {} },
    data: { eventId: EVENT_ID, registrationIds: ["r1"], reason: "manager_remove" },
  });
  const logs = dispatchLogs();
  expect(logs).toHaveLength(1);
  expect(logs[0][2]).toMatchObject({ fn: "cancelRegistration", cancelled: 0, removed: 1, promoted: 1 });
  expectCleanLog(logs[0]);
});

test("同 requestId 重送：第二次不再寫計數 log（去重 early return）", async () => {
  setup();
  const payload = { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "notify-log-1" };
  await fn.cancelRegistration({ auth: { uid: U_SELF, token: {} }, data: payload });
  await fn.cancelRegistration({ auth: { uid: U_SELF, token: {} }, data: payload });
  expect(dispatchLogs()).toHaveLength(1);
});
