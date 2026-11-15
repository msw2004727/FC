"use strict";

// HC-A3-03：events 報名投影欄位（current、participants、status、teamReservationSummaries…）的 isSignupFieldsOnly 分支
// 原本不檢查操作者，任何登入者都能改別人活動的人數、名單與額滿狀態。收緊為「活動現場營運者（主辦／委託人／有權管理者）或管理員」，
// 與 registrations 的候補遞補規則（isWaitlistPromotion && isEventSiteOperatorForData）同一組身分。
// 報名、取消、遞補的正式流程走 Callable（Admin SDK，不受 Rules 限制）；新站不從用戶端寫這些欄位。
// 拒絕案例無法以錯誤訊息區分「條件不符」與「撞 1000 運算式上限」，以 HEAD 差分佐證（HEAD 下拒絕案例為允許）。
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, setDoc, updateDoc, serverTimestamp, setLogLevel } = require("firebase/firestore");

const RULES_PATH = path.resolve(__dirname, "..", "..", "firestore.rules");
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
let env;
jest.setTimeout(20000);

const ROLES = {
  owner: "user", delegate: "user", other: "user", ownerNoCap: "user",
  coachOwner: "coach", adminA: "admin", superA: "super_admin",
};

beforeAll(async () => {
  setLogLevel("error");
  env = await initializeTestEnvironment({
    projectId: "demo-hc-a303-signup-fields",
    firestore: { host: HOST, port: Number(PORT), rules: fs.readFileSync(RULES_PATH, "utf8") },
  });
});

const baseEvent = (id, overrides = {}) => ({
  id, title: "報名投影測試", creatorUid: "owner", ownerUid: "owner", captainUid: "",
  delegateUids: ["delegate"], delegates: [], privateEvent: false, isPublic: true,
  status: "open", max: 2, current: 0, realCurrent: 0, waitlist: 0,
  participants: [], waitlistNames: [], participantsWithUid: [], waitlistWithUid: [], teamReservationSummaries: [],
  courseLinked: false, ...overrides,
});
const COURSE = { courseLinked: true, courseLinkId: "linkA", courseLinkSource: "eduCourseLesson" };

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const writes = [];
    for (const [uid, role] of Object.entries(ROLES)) {
      writes.push(setDoc(doc(db, "users", uid), { uid, role }));
      writes.push(setDoc(doc(db, "userPermissionGrants", uid), { enabled: true, permissions: [] }));
    }
    for (const role of ["user", "coach", "admin"]) {
      writes.push(setDoc(doc(db, "rolePermissions", role), { permissions: [] }));
    }
    writes.push(setDoc(doc(db, "roleActivityCapabilities", "user"), {
      capabilities: ["user.activity.own_edit_basic", "user.activity.site_operate", "user.activity.own_cancel"],
    }));
    writes.push(setDoc(doc(db, "events", "evt"), baseEvent("evt")));
    writes.push(setDoc(doc(db, "events", "evtCoach"), baseEvent("evtCoach", { creatorUid: "coachOwner", ownerUid: "coachOwner", delegateUids: [] })));
    writes.push(setDoc(doc(db, "events", "evtNoCap"), baseEvent("evtNoCap", { creatorUid: "ownerNoCap", ownerUid: "ownerNoCap", delegateUids: [] })));
    writes.push(setDoc(doc(db, "events", "evtCourse"), baseEvent("evtCourse", COURSE)));
    await Promise.all(writes);
  });
});

afterAll(async () => { if (env) await env.cleanup(); });

const db = (uid) => env.authenticatedContext(uid, { role: ROLES[uid] }).firestore();
const update = (uid, eventId, data) => updateDoc(doc(db(uid), "events", eventId), data);

const PAYLOADS = {
  current: () => ({ current: 0, realCurrent: 0, updatedAt: serverTimestamp() }),
  participants: () => ({ participants: ["假名單"], participantsWithUid: [{ uid: "x", name: "假名單" }] }),
  status: () => ({ current: 2, status: "full" }),
  teamReservationSummaries: () => ({ teamReservationSummaries: [{ teamId: "tm", teamName: "假保留", reservedSlots: 99 }] }),
};

describe("無關登入者不可改報名投影欄位（A3-03）", () => {
  test.each(Object.keys(PAYLOADS))("一般活動：無關 user 只改 %s → 拒", async (key) => {
    await assertFails(update("other", "evt", PAYLOADS[key]()));
  });

  test.each(Object.keys(PAYLOADS))("課程連結活動：無關 user 只改 %s → 拒", async (key) => {
    await assertFails(update("other", "evtCourse", PAYLOADS[key]()));
  });

  test("user 主辦但沒有 user.activity.site_operate → 拒（與 registrations 遞補規則同一組身分）", async () => {
    await env.withSecurityRulesDisabled(async (context) => setDoc(
      doc(context.firestore(), "roleActivityCapabilities", "user"),
      { capabilities: ["user.activity.own_edit_basic", "user.activity.own_cancel"] },
    ));
    await assertFails(update("ownerNoCap", "evtNoCap", PAYLOADS.participants()));
  });
});

describe("管理員與活動現場營運者仍可寫報名投影欄位", () => {
  test.each(Object.keys(PAYLOADS))("admin 只改 %s → 允許", async (key) => {
    await assertSucceeds(update("adminA", "evt", PAYLOADS[key]()));
  });

  test("super_admin 改人數與名單 → 允許", async () => {
    await assertSucceeds(update("superA", "evt", { ...PAYLOADS.current(), ...PAYLOADS.participants() }));
  });

  test("課程連結活動：admin 改人數與名單 → 允許", async () => {
    await assertSucceeds(update("adminA", "evtCourse", { ...PAYLOADS.current(), ...PAYLOADS.participants() }));
  });

  test.each(Object.keys(PAYLOADS))("user 主辦（site_operate）只改 %s → 允許", async (key) => {
    await assertSucceeds(update("owner", "evt", PAYLOADS[key]()));
  });

  test.each(Object.keys(PAYLOADS))("user 委託人只改 %s → 允許", async (key) => {
    await assertSucceeds(update("delegate", "evt", PAYLOADS[key]()));
  });

  test("教練主辦改人數、名單與額滿狀態 → 允許", async () => {
    await assertSucceeds(update("coachOwner", "evtCoach", {
      ...PAYLOADS.participants(), ...PAYLOADS.status(),
    }));
  });

  test("主辦夾帶白名單外欄位（title）→ 拒（欄位限制不變）", async () => {
    await env.withSecurityRulesDisabled(async (context) => setDoc(
      doc(context.firestore(), "roleActivityCapabilities", "user"), { capabilities: ["user.activity.site_operate"] },
    ));
    await assertFails(update("owner", "evt", { ...PAYLOADS.participants(), title: "改標題" }));
  });

  test("admin 的 status 仍須與 current／max 一致（自洽檢查不變）", async () => {
    await assertFails(update("adminA", "evtCourse", { current: 1, status: "full" }));
  });
});
