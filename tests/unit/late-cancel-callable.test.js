"use strict";

const fs = require("fs");
const path = require("path");
const {
  FakeTimestamp,
  HttpsError,
  createFakeFirestore,
  loadFunctionsIndex,
} = require("./registration-callable-harness");

const U_SELF = `U${"1".repeat(32)}`;
const U_OTHER = `U${"2".repeat(32)}`;
const U_SUPER = `U${"9".repeat(32)}`;
const U_ADMIN_WITH = `U${"3".repeat(32)}`;
const U_ADMIN_NO = `U${"4".repeat(32)}`;
const U_BLACK = `U${"5".repeat(32)}`;
const EVENT_ID = "ce_1800000000000_abc";
const EVENT_ID_2 = "ce_1800000000001_def";
const EVENT_ID_3 = "ce_1800000000002_ghi";
const EVENT_ID_4 = "ce_1800000000003_jkl";
const EVENT_ID_5 = "ce_1800000000004_mno";
const EVENT_ID_6 = "ce_1800000000005_pqr";
const TAIPEI_MS = 8 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, "0");

function taipeiEventDate(ms, endHour = "23:59") {
  const d = new Date(ms + TAIPEI_MS);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}~${endHour}`;
}

function makeEvent(overrides = {}) {
  return {
    id: EVENT_ID,
    title: "測試活動",
    date: taipeiEventDate(Date.now() + 60 * 60 * 1000),
    location: "台北",
    type: "activity",
    max: 10,
    status: "open",
    current: 1,
    realCurrent: 1,
    waitlist: 0,
    participants: [U_SELF],
    waitlistNames: [],
    participantsWithUid: [],
    waitlistWithUid: [],
    teamReservationSummaries: [],
    ...overrides,
  };
}

function makeReg(id, overrides = {}) {
  return {
    id,
    userId: U_SELF,
    userName: "self",
    status: "confirmed",
    registeredAt: new FakeTimestamp(1000),
    ...overrides,
  };
}

function seedStore(overrides = {}) {
  const seed = {
    [`events/${EVENT_ID}`]: makeEvent(),
    [`events/${EVENT_ID}/registrations/r1`]: makeReg("r1"),
    [`users/${U_SELF}`]: { uid: U_SELF, name: "self", exp: 100 },
  };
  return { ...seed, ...overrides };
}

function expectNoLateCancelFields(userData) {
  expect(userData).not.toHaveProperty("lateCancelLevel");
  expect(userData).not.toHaveProperty("lateCancelTotal");
  expect(userData).not.toHaveProperty("lateCancelRecent");
  expect(userData).not.toHaveProperty("lateCancelUntil");
  expect(userData).not.toHaveProperty("lateCancelReleaseAt");
}

// writeAuditEntry 寫 auditLogsByDay/{dayKey}/auditEntries/{autoId}（functions/index.js writeAuditEntry）。
function findAuditLogIds(fakeDb, action) {
  return fakeDb.state.writes
    .filter((w) => /^auditLogsByDay\/[^/]+\/auditEntries\/[^/]+$/.test(w.path))
    .map((w) => w.path)
    .filter((path) => fakeDb.get(path)?.action === action);
}

function auditEntries(fakeDb, action) {
  return findAuditLogIds(fakeDb, action).map((p) => fakeDb.get(p));
}

let fnStub;
let harnessStub;
let fake;
let fnNoStub;
let harnessNoStub;

beforeAll(() => {
  const lateCancel = require("../../functions/late-cancel");
  const loadedStub = loadFunctionsIndex({
    stubs: {
      "./late-cancel": {
        ...lateCancel,
        LATE_CANCEL_SINCE_MS: 0,
      },
    },
  });
  fnStub = loadedStub.exports;
  harnessStub = loadedStub.harness;

  const loadedNoStub = loadFunctionsIndex();
  fnNoStub = loadedNoStub.exports;
  harnessNoStub = loadedNoStub.harness;
});

beforeEach(() => {
  fake = createFakeFirestore(seedStore());
  harnessStub.current = fake;
  harnessNoStub.current = fake;
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  harnessStub.logs.length = 0;
  harnessNoStub.logs.length = 0;
});

function cancel(uid, data, fn = fnStub) {
  return fn.cancelRegistration({ auth: { uid }, data });
}

describe("cancelRegistration 臨時取消接線", () => {
  test("開始前 1 小時取消本人正取：標記、去重文件、users black、total 1", async () => {
    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "req-1" });
    expect(result.success).toBe(true);
    expect(result.lateCancelMarked).toBe(true);
    // 既有 P3：本人取消正取扣回 10 EXP（顧問 §3.620，原 −5；P3b 不影響）。
    expect(fake.get(`users/${U_SELF}`).exp).toBe(90);

    const regData = fake.get(`events/${EVENT_ID}/registrations/r1`);
    expect(regData.status).toBe("cancelled");
    expect(regData.lateCancel).toBe(true);
    expect(fake.has(`lateCancelMarks/${EVENT_ID}_${U_SELF}`)).toBe(true);

    const userData = fake.get(`users/${U_SELF}`);
    expect(userData.lateCancelLevel).toBe("black");
    expect(userData.lateCancelTotal).toBe(1);
    expect(userData.lateCancelUntil).toBeTruthy();

    const cancelAudits = auditEntries(fake, "event_cancel_signup");
    expect(cancelAudits.length).toBeGreaterThan(0);
    expect(cancelAudits.every((entry) => entry.actorUid === U_SELF)).toBe(true);
  });

  test("開始前 3 小時（時限外）不記", async () => {
    fake = createFakeFirestore(seedStore({
      [`events/${EVENT_ID}`]: makeEvent({ date: taipeiEventDate(Date.now() + 3 * 60 * 60 * 1000) }),
    }));
    harnessStub.current = fake;

    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "req-2" });
    expect(result.lateCancelMarked).toBe(false);
    expect(fake.get(`events/${EVENT_ID}/registrations/r1`)).not.toHaveProperty("lateCancel");
    expect(fake.has(`lateCancelMarks/${EVENT_ID}_${U_SELF}`)).toBe(false);
    expect(fake.get(`users/${U_SELF}`)).not.toHaveProperty("lateCancelLevel");
  });

  test("活動 lateCancelHours: 0 不記", async () => {
    fake = createFakeFirestore(seedStore({
      [`events/${EVENT_ID}`]: makeEvent({ lateCancelHours: 0 }),
    }));
    harnessStub.current = fake;

    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "req-3" });
    expect(result.lateCancelMarked).toBe(false);
    expect(fake.has(`lateCancelMarks/${EVENT_ID}_${U_SELF}`)).toBe(false);
  });

  test("取消候補不記", async () => {
    fake = createFakeFirestore(seedStore({
      [`events/${EVENT_ID}/registrations/r1`]: makeReg("r1", { status: "waitlisted" }),
    }));
    harnessStub.current = fake;

    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "req-4" });
    expect(result.lateCancelMarked).toBe(false);
    expect(fake.has(`lateCancelMarks/${EVENT_ID}_${U_SELF}`)).toBe(false);
  });

  test("課程連結活動不記", async () => {
    fake = createFakeFirestore(seedStore({
      [`events/${EVENT_ID}`]: makeEvent({ courseLinkId: "course-1" }),
    }));
    harnessStub.current = fake;

    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "req-5" });
    expect(result.lateCancelMarked).toBe(false);
    expect(fake.has(`lateCancelMarks/${EVENT_ID}_${U_SELF}`)).toBe(false);
  });

  // 起算點改為 2026-11-25（站長 11-25 指示提前）後，實際時間已過起算點，「起算點前不記」無法再用真時鐘測
  // （函式在 vm 沙箱跑，假時鐘進不去）；改測反方向：未 stub 的 loader 用正式常數，起算點後的活動在時限內會記。
  // 起算點前不記的判斷由 late-cancel.test.js 以注入 sinceMs 覆蓋，接線字串另有「sinceMs: lateCancel.LATE_CANCEL_SINCE_MS」檢查。
  test("起算點後時限內會記（未 stub 的 loader，正式常數）", async () => {
    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "req-6" }, fnNoStub);
    expect(result.lateCancelMarked).toBe(true);
    expect(fake.has(`lateCancelMarks/${EVENT_ID}_${U_SELF}`)).toBe(true);
  });

  test("時限內遞補不記；時限外遞補記", async () => {
    const startMs = Date.now() + 60 * 60 * 1000;
    fake = createFakeFirestore(seedStore({
      [`events/${EVENT_ID}`]: makeEvent({ date: taipeiEventDate(startMs) }),
      [`events/${EVENT_ID}/registrations/r2`]: makeReg("r2", {
        promotedAt: new FakeTimestamp(Date.now() + 30 * 60 * 1000),
      }),
    }));
    harnessStub.current = fake;

    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r2"], requestId: "req-7" });
    expect(result.lateCancelMarked).toBe(false);
    expect(fake.has(`lateCancelMarks/${EVENT_ID}_${U_SELF}`)).toBe(false);
  });

  test("本人＋同行者一起取消只記操作者一次、兩筆都 lateCancel: true", async () => {
    fake = createFakeFirestore(seedStore({
      [`events/${EVENT_ID}/registrations/r1c`]: makeReg("r1c", {
        participantType: "companion",
        companionId: "c1",
        companionName: "friend",
      }),
    }));
    harnessStub.current = fake;

    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1", "r1c"], requestId: "req-8" });
    expect(result.lateCancelMarked).toBe(true);
    expect(fake.get(`events/${EVENT_ID}/registrations/r1`).lateCancel).toBe(true);
    expect(fake.get(`events/${EVENT_ID}/registrations/r1c`).lateCancel).toBe(true);
    expect(fake.get(`users/${U_SELF}`).lateCancelTotal).toBe(1);
    expect(fake.list("lateCancelMarks")).toHaveLength(1);
  });

  test("只取消同行者（本人留下）→ 記在操作者；本人那筆不動", async () => {
    fake = createFakeFirestore(seedStore({
      [`events/${EVENT_ID}/registrations/r1c`]: makeReg("r1c", {
        participantType: "companion",
        companionId: "c1",
        companionName: "friend",
      }),
    }));
    harnessStub.current = fake;

    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1c"], requestId: "req-8c" });
    expect(result.success).toBe(true);
    expect(result.lateCancelMarked).toBe(true);

    const companionReg = fake.get(`events/${EVENT_ID}/registrations/r1c`);
    expect(companionReg.status).toBe("cancelled");
    expect(companionReg.lateCancel).toBe(true);

    const selfReg = fake.get(`events/${EVENT_ID}/registrations/r1`);
    expect(selfReg.status).toBe("confirmed");
    expect(selfReg).not.toHaveProperty("lateCancel");

    expect(fake.get(`users/${U_SELF}`).lateCancelTotal).toBe(1);
    expect(fake.list("lateCancelMarks")).toHaveLength(1);
  });

  test("同場重複取消：第二次回 marked true，但 users total 仍 1", async () => {
    await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "req-9a" });
    fake.put(`events/${EVENT_ID}/registrations/r2`, makeReg("r2"));
    await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r2"], requestId: "req-9b" });
    expect(fake.get(`users/${U_SELF}`).lateCancelTotal).toBe(1);
    expect(fake.list("lateCancelMarks")).toHaveLength(1);
  });

  test("同 requestId 重送回 lateCancelMarked: true 且不再記點", async () => {
    const first = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "req-10" });
    expect(first.lateCancelMarked).toBe(true);
    const second = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "req-10" });
    expect(second.deduplicated).toBe(true);
    expect(second.lateCancelMarked).toBe(true);
    expect(fake.get(`users/${U_SELF}`).lateCancelTotal).toBe(1);
  });

  test("manager_remove 在時限內不記", async () => {
    fake = createFakeFirestore(seedStore({
      [`users/${U_SELF}`]: { uid: U_SELF, role: "admin", exp: 100 },
    }));
    harnessStub.current = fake;

    const result = await cancel(U_SELF, {
      eventId: EVENT_ID,
      registrationIds: ["r1"],
      reason: "manager_remove",
      requestId: "req-11",
    });
    expect(result.success).toBe(true);
    expect(result.lateCancelMarked).toBe(false);

    expect(fake.get(`events/${EVENT_ID}/registrations/r1`)).not.toHaveProperty("lateCancel");
    expect(fake.has(`lateCancelMarks/${EVENT_ID}_${U_SELF}`)).toBe(false);
    expectNoLateCancelFields(fake.get(`users/${U_SELF}`));
  });

  test("postOps 記點失敗取消仍成功；log 有 [lateCancelMark] failed 且不含 UID", async () => {
    // 讓第二個交易（記點交易）的 commit 前 hook 丟錯；主交易（第一個）正常 commit。
    let txCount = 0;
    const failSecondTx = async () => {
      txCount += 1;
      if (txCount === 2) {
        throw new Error("simulated postOps failure");
      }
      fake.state.beforeTransactionCommit = failSecondTx;
    };
    fake.state.beforeTransactionCommit = failSecondTx;

    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "req-13" });

    // 交易內判定成功，因此 Callable 回傳 lateCancelMarked: true；取消本身成功。
    expect(result.success).toBe(true);
    expect(result.lateCancelMarked).toBe(true);
    expect(fake.get(`events/${EVENT_ID}/registrations/r1`).status).toBe("cancelled");

    // 記點交易失敗，故 users 未加點、去重文件未建立。
    expect(fake.has(`lateCancelMarks/${EVENT_ID}_${U_SELF}`)).toBe(false);
    expectNoLateCancelFields(fake.get(`users/${U_SELF}`));

    // log 有固定原因碼；參數 JSON 不含 UID 原文。
    const failLogs = harnessStub.logs.filter((row) => row[0] === "error" && row[1] === "[lateCancelMark] failed");
    expect(failLogs.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(failLogs);
    expect(serialized).not.toContain(U_SELF);
    // 交給 settleBestEffortPostCommitOps 記錄（R-CF-003）。
    expect(harnessStub.logs.some((row) => row[0] === "error" && row[1] === "[bestEffortPostCommitOps]")).toBe(true);
  });
});

describe("審查補案（Opus §P3）", () => {
  test("時限外才遞補的正取（開始前 7 小時遞補、時限 6 小時、開始前 5 小時取消）→ 記", async () => {
    const startMs = Date.now() + 5 * 60 * 60 * 1000;
    fake = createFakeFirestore(seedStore({
      [`events/${EVENT_ID}`]: makeEvent({ date: taipeiEventDate(startMs), lateCancelHours: 6 }),
      [`events/${EVENT_ID}/registrations/r1`]: makeReg("r1", {
        promotedAt: new FakeTimestamp(startMs - 7 * 60 * 60 * 1000),
      }),
    }));
    harnessStub.current = fake;
    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "req-p3-1" });
    expect(result.lateCancelMarked).toBe(true);
    expect(fake.get(`events/${EVENT_ID}/registrations/r1`).lateCancel).toBe(true);
    expect(fake.get(`users/${U_SELF}`).lateCancelTotal).toBe(1);
  });

  test("主交易讀取數：時限內（會記點）與時限外（不記點）相同", async () => {
    const mainTxReads = async (startOffsetMs, requestId) => {
      fake = createFakeFirestore(seedStore({
        [`events/${EVENT_ID}`]: makeEvent({ date: taipeiEventDate(Date.now() + startOffsetMs) }),
      }));
      harnessStub.current = fake;
      let snapshot = null;
      // 第一個交易（主交易）commit 前記下交易內讀取數；P3b 的記點交易不算。
      fake.state.beforeTransactionCommit = async () => { snapshot = fake.state.reads.tx; };
      const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"], requestId });
      return { snapshot, marked: result.lateCancelMarked };
    };
    const inside = await mainTxReads(60 * 60 * 1000, "req-p3-2a");
    const outside = await mainTxReads(5 * 60 * 60 * 1000, "req-p3-2b");
    expect(inside.marked).toBe(true);
    expect(outside.marked).toBe(false);
    expect(typeof inside.snapshot).toBe("number");
    expect(inside.snapshot).toBe(outside.snapshot);
  });

  test("clearLateCancelRed：只靠 userPermissionGrants 個別授權也可解除", async () => {
    fake = createFakeFirestore({
      [`users/${U_SELF}`]: { uid: U_SELF, name: "self", exp: 100, lateCancelLevel: "red", lateCancelTotal: 3 },
      [`users/${U_ADMIN_NO}`]: { uid: U_ADMIN_NO, role: "user", name: "granted", exp: 100 },
      [`userPermissionGrants/${U_ADMIN_NO}`]: { permissions: ["admin.repair.no_show_adjust"] },
    });
    harnessStub.current = fake;
    const res = await fnStub.clearLateCancelRed({ auth: { uid: U_ADMIN_NO }, data: { targetUid: U_SELF } });
    expect(res).toEqual({ ok: true });
    expect(fake.get(`users/${U_SELF}`).lateCancelLevel).toBe(null);
    expect(fake.get(`users/${U_SELF}`).lateCancelTotal).toBe(3);
  });
});

describe("clearLateCancelRed", () => {
  test("T1 黑標未到期解除 → 清欄位、total 保留、稽核 statusFrom black", async () => {
    fake = createFakeFirestore({
      [`users/${U_BLACK}`]: {
        uid: U_BLACK,
        name: "black",
        lateCancelLevel: "black",
        lateCancelUntil: new FakeTimestamp(Date.now() + 3 * 86400000),
        lateCancelReleaseAt: 3,
        lateCancelRecent: [new FakeTimestamp(Date.now() - 86400000)],
        lateCancelTotal: 1,
      },
      "rolePermissions/repair_admin": { permissions: ["admin.repair.no_show_adjust"] },
      [`users/${U_ADMIN_WITH}`]: { uid: U_ADMIN_WITH, role: "repair_admin", name: "with-perm", exp: 100 },
    });
    harnessStub.current = fake;

    const res = await fnStub.clearLateCancelRed({
      auth: { uid: U_ADMIN_WITH },
      data: { targetUid: U_BLACK },
    });
    expect(res).toEqual({ ok: true });

    const after = fake.get(`users/${U_BLACK}`);
    expect(after.lateCancelLevel).toBeNull();
    expect(after.lateCancelRecent).toEqual([]);
    expect(after).not.toHaveProperty("lateCancelUntil");
    expect(after).not.toHaveProperty("lateCancelReleaseAt");
    expect(after.lateCancelTotal).toBe(1);

    const entries = auditEntries(fake, "late_cancel_red_clear");
    expect(entries).toHaveLength(1);
    expect(entries[0].meta).toEqual({
      reasonCode: "late_cancel_red_clear",
      statusFrom: "black",
      statusTo: "none",
    });
    expect(entries[0].targetId).toBe(U_BLACK);
    expect(entries[0].targetType).toBe("user");
  });

  test("T2 黑標已過期解除 → 照樣清、稽核 statusFrom black", async () => {
    fake = createFakeFirestore({
      [`users/${U_BLACK}`]: {
        uid: U_BLACK,
        name: "black",
        lateCancelLevel: "black",
        lateCancelUntil: new FakeTimestamp(Date.now() - 86400000),
        lateCancelReleaseAt: 3,
        lateCancelRecent: [],
        lateCancelTotal: 1,
      },
      "rolePermissions/repair_admin": { permissions: ["admin.repair.no_show_adjust"] },
      [`users/${U_ADMIN_WITH}`]: { uid: U_ADMIN_WITH, role: "repair_admin", name: "with-perm", exp: 100 },
    });
    harnessStub.current = fake;

    const res = await fnStub.clearLateCancelRed({
      auth: { uid: U_ADMIN_WITH },
      data: { targetUid: U_BLACK },
    });
    expect(res).toEqual({ ok: true });

    const after = fake.get(`users/${U_BLACK}`);
    expect(after.lateCancelLevel).toBeNull();
    expect(after.lateCancelRecent).toEqual([]);
    expect(after).not.toHaveProperty("lateCancelUntil");
    expect(after).not.toHaveProperty("lateCancelReleaseAt");
    expect(after.lateCancelTotal).toBe(1);

    const entries = auditEntries(fake, "late_cancel_red_clear");
    expect(entries).toHaveLength(1);
    expect(entries[0].meta).toEqual({
      reasonCode: "late_cancel_red_clear",
      statusFrom: "black",
      statusTo: "none",
    });
  });

  test("T4 正常狀態冪等：不寫 users、不寫稽核", async () => {
    fake = createFakeFirestore({
      [`users/${U_SELF}`]: { uid: U_SELF, name: "self", exp: 100 },
      [`users/${U_OTHER}`]: { uid: U_OTHER, name: "other", lateCancelLevel: null, lateCancelRecent: [], lateCancelTotal: 2 },
      "rolePermissions/repair_admin": { permissions: ["admin.repair.no_show_adjust"] },
      [`users/${U_ADMIN_WITH}`]: { uid: U_ADMIN_WITH, role: "repair_admin", name: "with-perm", exp: 100 },
    });
    harnessStub.current = fake;
    const writesBefore = fake.state.writes.length;

    const r1 = await fnStub.clearLateCancelRed({ auth: { uid: U_ADMIN_WITH }, data: { targetUid: U_SELF } });
    expect(r1).toEqual({ ok: true });
    const r2 = await fnStub.clearLateCancelRed({ auth: { uid: U_ADMIN_WITH }, data: { targetUid: U_OTHER } });
    expect(r2).toEqual({ ok: true });

    const userWrites = fake.state.writes.slice(writesBefore).filter((w) => w.path.startsWith("users/"));
    expect(userWrites).toHaveLength(0);
    expect(auditEntries(fake, "late_cancel_red_clear")).toHaveLength(0);
    expect(fake.get(`users/${U_OTHER}`).lateCancelLevel).toBeNull();
    expect(fake.get(`users/${U_OTHER}`).lateCancelRecent).toEqual([]);
    expect(fake.get(`users/${U_OTHER}`).lateCancelTotal).toBe(2);
  });

  test("T6 解除後可立刻報名；不解除也可報名（臨取不擋報名）", async () => {
    const userDoc = (uid) => ({
      uid,
      lineUserId: uid,
      name: "王小明",
      displayName: "王小明",
      gender: "male",
      birthday: "1990-01-01",
      region: "taipei",
      role: "user",
      exp: 100,
    });
    const makeBlackEvent = () => makeEvent({
      id: EVENT_ID_2,
      date: taipeiEventDate(Date.now() + 3 * 86400000),
      current: 0,
      realCurrent: 0,
      participants: [],
    });

    fake = createFakeFirestore({
      [`users/${U_BLACK}`]: {
        ...userDoc(U_BLACK),
        lateCancelLevel: "black",
        lateCancelUntil: new FakeTimestamp(Date.now() + 3 * 86400000),
        lateCancelReleaseAt: 3,
        lateCancelRecent: [],
        lateCancelTotal: 1,
      },
      [`events/${EVENT_ID_2}`]: makeBlackEvent(),
    });
    harnessStub.current = fake;
    const direct = await fnStub.registerForEvent({
      auth: { uid: U_BLACK, token: {} },
      data: { eventId: EVENT_ID_2, participants: [{ userId: U_BLACK, userName: "black" }] },
    });
    expect(direct.success).toBe(true);

    fake = createFakeFirestore({
      [`users/${U_BLACK}`]: {
        ...userDoc(U_BLACK),
        lateCancelLevel: "black",
        lateCancelUntil: new FakeTimestamp(Date.now() + 3 * 86400000),
        lateCancelReleaseAt: 3,
        lateCancelRecent: [],
        lateCancelTotal: 1,
      },
      "rolePermissions/repair_admin": { permissions: ["admin.repair.no_show_adjust"] },
      [`users/${U_ADMIN_WITH}`]: { uid: U_ADMIN_WITH, role: "repair_admin", name: "with-perm", exp: 100 },
      [`events/${EVENT_ID_2}`]: makeBlackEvent(),
    });
    harnessStub.current = fake;
    await fnStub.clearLateCancelRed({ auth: { uid: U_ADMIN_WITH }, data: { targetUid: U_BLACK } });
    const afterClear = await fnStub.registerForEvent({
      auth: { uid: U_BLACK, token: {} },
      data: { eventId: EVENT_ID_2, participants: [{ userId: U_BLACK, userName: "black" }] },
    });
    expect(afterClear.success).toBe(true);
  });

  test("T7a 解除黑標後再臨時取消一次 → black、total 2、releaseAt 3、until 約 7 天", async () => {
    const beforeMs = Date.now();
    fake = createFakeFirestore({
      [`users/${U_BLACK}`]: {
        uid: U_BLACK,
        name: "black",
        lateCancelLevel: null,
        lateCancelRecent: [],
        lateCancelTotal: 1,
      },
      [`events/${EVENT_ID}`]: makeEvent(),
      [`events/${EVENT_ID}/registrations/rb`]: makeReg("rb", { userId: U_BLACK }),
    });
    harnessStub.current = fake;

    const result = await cancel(U_BLACK, { eventId: EVENT_ID, registrationIds: ["rb"], requestId: "req-t7a" });
    expect(result.lateCancelMarked).toBe(true);

    const after = fake.get(`users/${U_BLACK}`);
    expect(after.lateCancelLevel).toBe("black");
    expect(after.lateCancelRecent).toHaveLength(1);
    expect(after.lateCancelTotal).toBe(2);
    expect(after.lateCancelReleaseAt).toBe(3);
    const untilMs = after.lateCancelUntil.toMillis();
    expect(untilMs).toBeGreaterThanOrEqual(beforeMs + 7 * 86400000);
    expect(untilMs).toBeLessThanOrEqual(Date.now() + 7 * 86400000);
  });

  test("T7b 解除紅標後再取消：先 black，第 3 次才 red", async () => {
    fake = createFakeFirestore({
      [`users/${U_SELF}`]: {
        uid: U_SELF,
        name: "self",
        exp: 100,
        lateCancelLevel: null,
        lateCancelRecent: [],
        lateCancelTotal: 3,
      },
      [`events/${EVENT_ID_4}`]: makeEvent({ id: EVENT_ID_4 }),
      [`events/${EVENT_ID_5}`]: makeEvent({ id: EVENT_ID_5 }),
      [`events/${EVENT_ID_6}`]: makeEvent({ id: EVENT_ID_6 }),
      [`events/${EVENT_ID_4}/registrations/r4`]: makeReg("r4"),
      [`events/${EVENT_ID_5}/registrations/r5`]: makeReg("r5"),
      [`events/${EVENT_ID_6}/registrations/r6`]: makeReg("r6"),
    });
    harnessStub.current = fake;

    await cancel(U_SELF, { eventId: EVENT_ID_4, registrationIds: ["r4"], requestId: "req-t7b-1" });
    let u = fake.get(`users/${U_SELF}`);
    expect(u.lateCancelLevel).toBe("black");
    expect(u.lateCancelTotal).toBe(4);

    await cancel(U_SELF, { eventId: EVENT_ID_5, registrationIds: ["r5"], requestId: "req-t7b-2" });
    u = fake.get(`users/${U_SELF}`);
    expect(u.lateCancelLevel).toBe("black");
    expect(u.lateCancelTotal).toBe(5);

    await cancel(U_SELF, { eventId: EVENT_ID_6, registrationIds: ["r6"], requestId: "req-t7b-3" });
    u = fake.get(`users/${U_SELF}`);
    expect(u.lateCancelLevel).toBe("red");
    expect(u.lateCancelTotal).toBe(6);
    expect(u.lateCancelRecent).toHaveLength(3);
  });

  test("T8 稽核記操作者、meta 僅三鍵、log 不含 UID", async () => {
    fake = createFakeFirestore({
      [`users/${U_BLACK}`]: {
        uid: U_BLACK,
        name: "black",
        lateCancelLevel: "black",
        lateCancelUntil: new FakeTimestamp(Date.now() + 3 * 86400000),
        lateCancelReleaseAt: 3,
        lateCancelRecent: [],
        lateCancelTotal: 1,
      },
      "rolePermissions/repair_admin": { permissions: ["admin.repair.no_show_adjust"] },
      [`users/${U_ADMIN_WITH}`]: { uid: U_ADMIN_WITH, role: "repair_admin", name: "with-perm", exp: 100 },
    });
    harnessStub.current = fake;

    await fnStub.clearLateCancelRed({ auth: { uid: U_ADMIN_WITH }, data: { targetUid: U_BLACK } });
    const entries = auditEntries(fake, "late_cancel_red_clear");
    expect(entries).toHaveLength(1);
    expect(entries[0].actorUid).toBe(U_ADMIN_WITH);
    expect(Object.keys(entries[0].meta).sort()).toEqual(["reasonCode", "statusFrom", "statusTo"]);
    const serializedLogs = JSON.stringify(harnessStub.logs);
    expect(serializedLogs).not.toContain(U_BLACK);
    expect(serializedLogs).not.toContain(U_ADMIN_WITH);
  });

  test("T9 交易錯誤 → internal、不寫稽核、log 只有 code", async () => {
    fake = createFakeFirestore({
      [`users/${U_BLACK}`]: {
        uid: U_BLACK,
        name: "black",
        lateCancelLevel: "black",
        lateCancelUntil: new FakeTimestamp(Date.now() + 3 * 86400000),
        lateCancelReleaseAt: 3,
        lateCancelRecent: [],
        lateCancelTotal: 1,
      },
      "rolePermissions/repair_admin": { permissions: ["admin.repair.no_show_adjust"] },
      [`users/${U_ADMIN_WITH}`]: { uid: U_ADMIN_WITH, role: "repair_admin", name: "with-perm", exp: 100 },
    });
    harnessStub.current = fake;
    fake.state.beforeTransactionCommit = async () => { throw new Error("boom"); };

    await expect(fnStub.clearLateCancelRed({ auth: { uid: U_ADMIN_WITH }, data: { targetUid: U_BLACK } }))
      .rejects.toMatchObject({ code: "internal" });

    const after = fake.get(`users/${U_BLACK}`);
    expect(after.lateCancelLevel).toBe("black");
    expect(after.lateCancelReleaseAt).toBe(3);
    expect(after.lateCancelUntil).toBeTruthy();
    expect(auditEntries(fake, "late_cancel_red_clear")).toHaveLength(0);

    const errorLogs = harnessStub.logs.filter((row) => row[0] === "error" && row[1] === "[clearLateCancelRed]");
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs[0][2]).toEqual({ code: "unknown" });
    expect(JSON.stringify(errorLogs)).not.toContain(U_BLACK);
    expect(JSON.stringify(errorLogs)).not.toContain(U_ADMIN_WITH);
  });

  test("同一人 90 天內三場臨時取消 → red；super_admin 解除 → level null、recent []、total 保留；再呼叫冪等", async () => {
    fake = createFakeFirestore({
      [`events/${EVENT_ID}`]: makeEvent({ id: EVENT_ID }),
      [`events/${EVENT_ID_2}`]: makeEvent({ id: EVENT_ID_2 }),
      [`events/${EVENT_ID_3}`]: makeEvent({ id: EVENT_ID_3 }),
      [`events/${EVENT_ID}/registrations/r1`]: makeReg("r1"),
      [`events/${EVENT_ID_2}/registrations/r2`]: makeReg("r2"),
      [`events/${EVENT_ID_3}/registrations/r3`]: makeReg("r3"),
      [`users/${U_SELF}`]: { uid: U_SELF, name: "self", exp: 100 },
      [`users/${U_SUPER}`]: { uid: U_SUPER, role: "super_admin", name: "super", exp: 100 },
    });
    harnessStub.current = fake;

    await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "req-15a" });
    await cancel(U_SELF, { eventId: EVENT_ID_2, registrationIds: ["r2"], requestId: "req-15b" });
    await cancel(U_SELF, { eventId: EVENT_ID_3, registrationIds: ["r3"], requestId: "req-15c" });

    const userAfter3 = fake.get(`users/${U_SELF}`);
    expect(userAfter3.lateCancelLevel).toBe("red");
    expect(userAfter3.lateCancelTotal).toBe(3);
    expect(Array.isArray(userAfter3.lateCancelRecent)).toBe(true);
    expect(userAfter3.lateCancelRecent).toHaveLength(3);

    expect(findAuditLogIds(fake, "late_cancel_red_clear")).toHaveLength(0);

    const clearResult = await fnStub.clearLateCancelRed({
      auth: { uid: U_SUPER },
      data: { targetUid: U_SELF },
    });
    expect(clearResult).toEqual({ ok: true });

    const userAfterClear = fake.get(`users/${U_SELF}`);
    expect(userAfterClear.lateCancelLevel).toBeNull();
    expect(userAfterClear.lateCancelRecent).toEqual([]);
    expect(userAfterClear.lateCancelTotal).toBe(3);
    expect(userAfterClear).not.toHaveProperty("lateCancelUntil");
    expect(userAfterClear).not.toHaveProperty("lateCancelReleaseAt");

    expect(findAuditLogIds(fake, "late_cancel_red_clear")).toHaveLength(1);
    const redAudit = auditEntries(fake, "late_cancel_red_clear")[0];
    expect(redAudit.meta.statusFrom).toBe("red");

    const clearAgain = await fnStub.clearLateCancelRed({
      auth: { uid: U_SUPER },
      data: { targetUid: U_SELF },
    });
    expect(clearAgain).toEqual({ ok: true });
    // 冪等：不再寫入 audit。
    expect(findAuditLogIds(fake, "late_cancel_red_clear")).toHaveLength(1);
  });

  test("權限與參數驗證", async () => {
    fake = createFakeFirestore({
      [`users/${U_SELF}`]: { uid: U_SELF, name: "self", exp: 100 },
      [`rolePermissions/exp_clerk`]: { permissions: ["admin.exp.entry"] },
      [`users/${U_ADMIN_NO}`]: { uid: U_ADMIN_NO, role: "exp_clerk", name: "no-perm", exp: 100 },
      [`rolePermissions/repair_admin`]: { permissions: ["admin.repair.no_show_adjust"] },
      [`users/${U_ADMIN_WITH}`]: { uid: U_ADMIN_WITH, role: "repair_admin", name: "with-perm", exp: 100 },
      [`users/${U_SUPER}`]: { uid: U_SUPER, role: "super_admin", name: "super", exp: 100 },
      [`users/${U_BLACK}`]: {
        uid: U_BLACK,
        name: "black",
        lateCancelLevel: "black",
        lateCancelUntil: new FakeTimestamp(Date.now() + 86400000),
        lateCancelReleaseAt: 3,
      },
    });
    harnessStub.current = fake;

    // 未登入
    await expect(fnStub.clearLateCancelRed({ auth: null, data: { targetUid: U_SELF } }))
      .rejects.toMatchObject({ code: "unauthenticated" });

    // 一般 user（無任何權限）→ permission-denied
    await expect(fnStub.clearLateCancelRed({ auth: { uid: U_SELF }, data: { targetUid: U_SELF } }))
      .rejects.toMatchObject({ code: "permission-denied" });

    // admin 沒有 admin.repair.no_show_adjust → permission-denied
    await expect(fnStub.clearLateCancelRed({ auth: { uid: U_ADMIN_NO }, data: { targetUid: U_SELF } }))
      .rejects.toMatchObject({ code: "permission-denied" });

    // admin 有該碼 → 參數驗證
    await expect(fnStub.clearLateCancelRed({ auth: { uid: U_ADMIN_WITH }, data: {} }))
      .rejects.toMatchObject({ code: "invalid-argument" });
    await expect(fnStub.clearLateCancelRed({ auth: { uid: U_ADMIN_WITH }, data: { targetUid: "" } }))
      .rejects.toMatchObject({ code: "invalid-argument" });
    await expect(fnStub.clearLateCancelRed({ auth: { uid: U_ADMIN_WITH }, data: { targetUid: "   " } }))
      .rejects.toMatchObject({ code: "invalid-argument" });
    await expect(fnStub.clearLateCancelRed({ auth: { uid: U_ADMIN_WITH }, data: { targetUid: "abc/def" } }))
      .rejects.toMatchObject({ code: "invalid-argument" });

    // 查無用戶
    await expect(fnStub.clearLateCancelRed({ auth: { uid: U_ADMIN_WITH }, data: { targetUid: "U_NONEXISTENT" } }))
      .rejects.toMatchObject({ code: "not-found" });

    // 非 red（一般 user）→ ok 且不改任何欄位
    const regularResult = await fnStub.clearLateCancelRed({
      auth: { uid: U_ADMIN_WITH },
      data: { targetUid: U_SELF },
    });
    expect(regularResult).toEqual({ ok: true });
    expectNoLateCancelFields(fake.get(`users/${U_SELF}`));

    // 無權限者對黑標對象 → permission-denied，黑標欄位不變
    const blackBefore = fake.get(`users/${U_BLACK}`);
    await expect(fnStub.clearLateCancelRed({
      auth: { uid: U_ADMIN_NO },
      data: { targetUid: U_BLACK },
    })).rejects.toMatchObject({ code: "permission-denied" });
    const blackAfter = fake.get(`users/${U_BLACK}`);
    expect(blackAfter.lateCancelLevel).toBe("black");
    expect(blackAfter.lateCancelReleaseAt).toBe(3);
    expect(blackAfter.lateCancelUntil.toMillis()).toBe(blackBefore.lateCancelUntil.toMillis());

    // 沒有任何 audit
    expect(findAuditLogIds(fake, "late_cancel_red_clear")).toHaveLength(0);
  });
});

describe("source contract", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, "../../functions/index.js"), "utf8");
  const lateCancelSource = fs.readFileSync(path.join(__dirname, "../../functions/late-cancel.js"), "utf8");

  test("clearLateCancelRed 存在且 region 正確", () => {
    expect(indexSource).toContain("exports.clearLateCancelRed = onCall(");
    expect(indexSource).toMatch(/exports\.clearLateCancelRed = onCall\(\s*\{[^}]*region: "asia-east1"/s);
  });

  test("cancelRegistration 區段含必要接線", () => {
    const start = indexSource.indexOf("exports.cancelRegistration = onCall(");
    const next = indexSource.indexOf("\nexports.", start + 1);
    const section = indexSource.slice(start, next === -1 ? undefined : next);
    expect(section).toContain("lateCancel.evaluateLateCancel(");
    expect(section).toContain("sinceMs: lateCancel.LATE_CANCEL_SINCE_MS");
    expect(section).toContain("regUpdate.lateCancel = true");
    expect(section).toContain("lateCancelMarked");
    expect(section.indexOf("lateCancel.evaluateLateCancel(")).toBeGreaterThan(section.indexOf("evaluateUserCancelDeadline("));
    expect(section.indexOf("lateCancel.evaluateLateCancel(")).toBeLessThan(section.indexOf('transaction.update(eventDoc.ref.collection("registrations")'));
  });

  test("cancelRegistration 交易段未新增讀取（主交易讀取數不變）", () => {
    // 案例 14：主交易讀取數與 HEAD 相同。HEAD 交易內讀取全部是 T0／T1／T2 既有呼叫；
    // 本次 diff 只新增 lateCancel.evaluateLateCancel 的判定段（純函式，無 DB 讀），
    // 故新增行不代表任何 .get／.getAll。以 source contract 直接斷言：
    // 從 evaluateLateCancel 呼叫到 regUpdate.lateCancel = true 之間不得有讀取呼叫。
    const start = indexSource.indexOf("exports.cancelRegistration = onCall(");
    const next = indexSource.indexOf("\nexports.", start + 1);
    const section = indexSource.slice(start, next === -1 ? undefined : next);

    const evaluateIdx = section.indexOf("lateCancel.evaluateLateCancel(");
    const regUpdateIdx = section.indexOf("regUpdate.lateCancel = true");
    expect(evaluateIdx).toBeGreaterThan(-1);
    expect(regUpdateIdx).toBeGreaterThan(evaluateIdx);

    const lateCancelPrelude = section.slice(evaluateIdx, regUpdateIdx);
    expect(lateCancelPrelude).not.toMatch(/\.get\s*\(/);
    expect(lateCancelPrelude).not.toMatch(/\.getAll\s*\(/);
  });

  test("late-cancel.js 不 require firebase、不呼叫團隊預留函式", () => {
    expect(lateCancelSource).not.toContain('require("firebase');
    expect(lateCancelSource).not.toContain("normalizeReleaseHours");
    expect(lateCancelSource).not.toContain("team-reservation-release");
  });

  test("T10 clearLateCancelRed 區段清 until／releaseAt，statusFrom 用變數", () => {
    const start = indexSource.indexOf("exports.clearLateCancelRed = onCall(");
    const next = indexSource.indexOf("\nexports.", start + 1);
    const section = indexSource.slice(start, next === -1 ? undefined : next);
    expect(section).toContain("lateCancelUntil: FieldValue.delete()");
    expect(section).toContain("lateCancelReleaseAt: FieldValue.delete()");
    expect(section).toContain('"late_cancel_red_clear"');
    expect(section).not.toContain('statusFrom: "red"');
  });

  test("ALLOWED_AUDIT_ACTIONS 含 late_cancel_red_clear", () => {
    const setStart = indexSource.indexOf("const ALLOWED_AUDIT_ACTIONS = new Set([");
    expect(setStart).toBeGreaterThan(-1);
    const setEnd = indexSource.indexOf("]);", setStart);
    expect(setEnd).toBeGreaterThan(setStart);
    const setBody = indexSource.slice(setStart, setEnd);
    expect(setBody).toContain('"late_cancel_red_clear"');
  });
});
