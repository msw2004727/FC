"use strict";

// 黑名單管理（新站 changeEventBlocklist）走 runTransaction（tx.get → tx.update）；
// 本檔證明交易內的更新與單次 updateDoc 受同一組 Rules 判定，沒有因交易多出的 get 而超過 1000 運算式。
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, runTransaction, arrayUnion, arrayRemove, setLogLevel } = require("firebase/firestore");

const PERMISSION = "admin.repair.event_blocklist";
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
let env;
jest.setTimeout(20000);

beforeAll(async () => {
  setLogLevel("error");
  env = await initializeTestEnvironment({
    projectId: "demo-t072-event-blocklist-tx",
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
    for (const [uid, role] of [["uidA", "user"], ["uidB", "user"], ["coachA", "coach"], ["superA", "super_admin"]]) {
      await setDoc(doc(db, "users", uid), { uid, role });
      await setDoc(doc(db, "userPermissionGrants", uid), { enabled: true, permissions: [] });
    }
    for (const role of ["user", "coach"]) {
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

const database = (uid) => env.authenticatedContext(uid).firestore();
const entry = (by, action = "add") => ({
  uid: "targetA", by, action, at: "2026-10-30T00:00:00.000Z", reason: action === "add" ? "測試原因" : "",
});
// 與 changeEventBlocklist 同形：tx.get 後 tx.update 兩欄、不帶 updatedAt。
const changeInTransaction = (uid, action = "add", eventId = "evtA") => {
  const db = database(uid);
  const ref = doc(db, "events", eventId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("EVENT_MISSING");
    tx.update(ref, {
      blockedUids: action === "add" ? arrayUnion("targetA") : arrayRemove("targetA"),
      blockedUidsLog: arrayUnion(entry(uid, action)),
    });
  });
};
async function seed(pathParts, data) {
  await env.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), ...pathParts), data));
}
async function readEvent() {
  let data;
  await env.withSecurityRulesDisabled(async (context) => { data = (await getDoc(doc(context.firestore(), "events", "evtA"))).data(); });
  return data;
}

describe("交易內寫入黑名單欄位（U7）", () => {
  test("super_admin 加入後再移除皆 allow，且欄位內容正確", async () => {
    await assertSucceeds(changeInTransaction("superA", "add"));
    expect((await readEvent()).blockedUids).toEqual(["targetA"]);
    expect((await readEvent()).blockedUidsLog).toHaveLength(1);
    await assertSucceeds(changeInTransaction("superA", "remove"));
    expect((await readEvent()).blockedUids).toEqual([]);
    expect((await readEvent()).blockedUidsLog).toHaveLength(2);
  });

  test("只持角色權限的教練：加入與移除皆 allow", async () => {
    await seed(["rolePermissions", "coach"], { permissions: [PERMISSION] });
    await assertSucceeds(changeInTransaction("coachA", "add"));
    await assertSucceeds(changeInTransaction("coachA", "remove"));
    expect((await readEvent()).blockedUids).toEqual([]);
  });

  test.each(["uidA", "uidB", "coachA"])("沒有黑名單權限 %s 在交易內 deny，文件不變", async (uid) => {
    await assertFails(changeInTransaction(uid, "add"));
    expect((await readEvent()).blockedUids).toEqual([]);
  });

  test("課程連動活動即使 super_admin 也在交易內 deny", async () => {
    await assertFails(changeInTransaction("superA", "add", "evtCourse"));
  });

  test("交易內多帶 updatedAt 欄位 deny（只允許兩欄）", async () => {
    await seed(["rolePermissions", "coach"], { permissions: [PERMISSION] });
    const db = database("coachA");
    const ref = doc(db, "events", "evtA");
    await assertFails(runTransaction(db, async (tx) => {
      await tx.get(ref);
      tx.update(ref, {
        blockedUids: arrayUnion("targetA"), blockedUidsLog: arrayUnion(entry("coachA")), title: "改名",
      });
    }));
  });
});
