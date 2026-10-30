"use strict";

// 只釘住既有 Rules；本卡不修改 Rules，也不執行 emulator。
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, setDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove, serverTimestamp, setLogLevel } = require("firebase/firestore");

const PERMISSION = "admin.repair.event_blocklist";
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
let env;
jest.setTimeout(20000);

beforeAll(async () => {
  setLogLevel("error");
  env = await initializeTestEnvironment({
    projectId: "demo-t070-event-blocklist",
    firestore: {
      host: HOST, port: Number(PORT),
      rules: fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8"),
    },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, role] of [
      ["uidA", "user"], ["uidB", "user"], ["coachA", "coach"], ["captainA", "captain"],
      ["adminA", "admin"], ["superA", "super_admin"],
    ]) {
      await setDoc(doc(db, "users", uid), { uid, role });
      await setDoc(doc(db, "userPermissionGrants", uid), { enabled: true, permissions: [] });
    }
    for (const role of ["user", "coach", "captain", "admin"]) {
      await setDoc(doc(db, "rolePermissions", role), { permissions: [] });
    }
    await setDoc(doc(db, "roleActivityCapabilities", "user"), {
      capabilities: ["user.activity.own_edit_basic", "user.activity.site_operate", "user.activity.own_cancel"],
    });
    const event = {
      id: "evtA", title: "測試活動", creatorUid: "uidA", ownerUid: "uidA",
      captainUid: "", delegateUids: ["uidB"], delegates: [], privateEvent: false, isPublic: true,
      status: "open", max: 10, current: 0, waitlist: 0, courseLinked: false,
      blockedUids: [], blockedUidsLog: [],
    };
    await setDoc(doc(db, "events", "evtA"), event);
    await setDoc(doc(db, "events", "evtCourse"), {
      ...event, id: "evtCourse", courseLinked: true, courseLinkId: "linkA", courseLinkSource: "eduCourseLesson",
    });
  });
});

afterAll(async () => { await env.cleanup(); });

const database = (uid) => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
const entry = (by, action = "add") => ({
  uid: "targetA", by, action, at: "2026-10-30T00:00:00.000Z", reason: action === "add" ? "測試原因" : "",
});
const writeBlocklist = (uid, extra = {}, eventId = "evtA") => updateDoc(doc(database(uid), "events", eventId), {
  blockedUids: arrayUnion("targetA"), blockedUidsLog: arrayUnion(entry(uid)), ...extra,
});
// 現況：一般 user 靠 userPermissionGrants 個別授權時，events update 規則會超過 1000 個運算式而被擋（專案已知上限）。
async function assertBudgetDenied(promise) {
  await expect(promise).rejects.toThrow(/maximum of 1000 expressions/);
}
async function seed(pathParts, data) {
  await env.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), ...pathParts), data));
}

describe("blocklist-only effective permission allow／deny", () => {
  test("super_admin allow", async () => {
    await assertSucceeds(writeBlocklist("superA"));
  });

  test.each(["uidA", "uidB", "coachA", "captainA", "adminA"])("無黑名單權限 %s deny（包含 owner/delegate）", async (uid) => {
    await assertFails(writeBlocklist(uid));
  });

  test("未登入 deny", async () => {
    await assertFails(writeBlocklist(null));
  });

  test.each([true, undefined])("一般 user 個別授權 enabled=%s：現況被 1000 運算式上限擋下（deny）", async (enabled) => {
    await seed(["userPermissionGrants", "uidB"], { permissions: [PERMISSION], ...(enabled === undefined ? {} : { enabled }) });
    await assertBudgetDenied(writeBlocklist("uidB"));
  });

  test("個別授權停用 deny", async () => {
    await seed(["userPermissionGrants", "uidB"], { permissions: [PERMISSION], enabled: false });
    await assertFails(writeBlocklist("uidB"));
  });

  test.each([["coachA", "coach"], ["captainA", "captain"], ["adminA", "admin"]])(
    "非 user 角色 %s 有角色權限 allow", async (uid, role) => {
      await seed(["rolePermissions", role], { permissions: [PERMISSION] });
      await assertSucceeds(writeBlocklist(uid));
    },
  );

  test("rolePermissions/user 就算含碼也不授予；一般主辦人仍 deny", async () => {
    await seed(["rolePermissions", "user"], { permissions: [PERMISSION, "event.edit_self", "event.edit_all"] });
    await assertFails(writeBlocklist("uidA"));
    await assertFails(writeBlocklist("uidB"));
  });

  test("角色文件缺失不回退預設權限", async () => {
    await env.withSecurityRulesDisabled(async (context) => deleteDoc(doc(context.firestore(), "rolePermissions", "coach")));
    await assertFails(writeBlocklist("coachA"));
  });

  test("只持 blocklist 角色權限者：黑名單欄位有變且多帶 updatedAt 會 deny", async () => {
    await seed(["rolePermissions", "coach"], { permissions: [PERMISSION] });
    await assertSucceeds(writeBlocklist("coachA"));
    await assertFails(updateDoc(doc(database("coachA"), "events", "evtA"), {
      blockedUids: arrayUnion("targetB"), blockedUidsLog: arrayUnion({ ...entry("coachA"), uid: "targetB" }),
      updatedAt: serverTimestamp(),
    }));
  });

  test("現況：只改 updatedAt（黑名單欄位不變）的更新目前放行", async () => {
    await assertSucceeds(updateDoc(doc(database("captainA"), "events", "evtA"), { updatedAt: serverTimestamp() }));
  });

  test.each(["blockedUids", "blockedUidsLog"])("只寫 %s 一欄 allow（角色權限）", async (field) => {
    await seed(["rolePermissions", "coach"], { permissions: [PERMISSION] });
    const value = field === "blockedUids" ? arrayUnion("targetA") : arrayUnion(entry("coachA"));
    await assertSucceeds(updateDoc(doc(database("coachA"), "events", "evtA"), { [field]: value }));
  });

  test("加入／移除皆沿用兩欄 array 操作 allow（角色權限）", async () => {
    await seed(["rolePermissions", "coach"], { permissions: [PERMISSION] });
    await assertSucceeds(writeBlocklist("coachA"));
    await assertSucceeds(updateDoc(doc(database("coachA"), "events", "evtA"), {
      blockedUids: arrayRemove("targetA"), blockedUidsLog: arrayUnion(entry("coachA", "remove")),
    }));
  });

  test.each(["superA", "uidB", "coachA"])("課程連動活動 %s 即使有黑名單權限也 deny", async (uid) => {
    await seed(["userPermissionGrants", uid], { permissions: [PERMISSION], enabled: true });
    await assertFails(writeBlocklist(uid, {}, "evtCourse"));
  });
});

describe("其他 OR 分支的現況，不把 blocklist-only 限制誤稱為全域限制", () => {
  test.each(["superA", "coachA"])("broad 管理者 %s 可同時帶 updatedAt", async (uid) => {
    await seed(["rolePermissions", "coach"], { permissions: ["event.edit_all"] });
    await assertSucceeds(writeBlocklist(uid, { updatedAt: serverTimestamp() }));
  });

  test("owner 的 event.edit_self 個別授權：現況同樣被 1000 運算式上限擋下（deny）", async () => {
    await seed(["userPermissionGrants", "uidA"], { permissions: ["event.edit_self"], enabled: true });
    await assertBudgetDenied(writeBlocklist("uidA"));
  });

  test("現況只驗欄位集合，不驗 blockedUidsLog 的 by／內容", async () => {
    await seed(["rolePermissions", "coach"], { permissions: [PERMISSION] });
    await assertSucceeds(writeBlocklist("coachA", { blockedUidsLog: [{ ...entry("uidOther"), reason: "fixture" }] }));
  });
});

describe("operationLogs create 擁有者契約", () => {
  test("actorUid == auth.uid create allow", async () => {
    await assertSucceeds(setDoc(doc(database("uidA"), "operationLogs", "opA"), {
      actorUid: "uidA", type: "force_demote", content: "測試操作", createdAt: serverTimestamp(),
    }));
  });

  test("actorUid 非自己且沒有 legacy 自己別名 create deny", async () => {
    await assertFails(setDoc(doc(database("uidA"), "operationLogs", "opA"), { actorUid: "uidB" }));
  });

  test("legacy uid == auth.uid 即使 actorUid 非自己仍 allow（既有 OR 語意）", async () => {
    await assertSucceeds(setDoc(doc(database("uidA"), "operationLogs", "opA"), { actorUid: "uidB", uid: "uidA" }));
  });

  test("未登入即使帶 actorUid 也 deny", async () => {
    await assertFails(setDoc(doc(database(null), "operationLogs", "opA"), { actorUid: "uidA" }));
  });

  test.each(["uidA", "superA"])("%s 不可 delete", async (uid) => {
    await seed(["operationLogs", "opA"], { actorUid: "uidA" });
    await assertFails(deleteDoc(doc(database(uid), "operationLogs", "opA")));
  });
});
