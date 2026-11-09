"use strict";

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} = require("firebase/firestore");

const PROJECT_ID = "demo-rules-test";
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
let testEnv;

jest.setTimeout(30000);

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port: Number(port),
      rules: fs.readFileSync(path.resolve(__dirname, "../..", "firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

function dbAs(uid, role) {
  return testEnv.authenticatedContext(uid, { role }).firestore();
}

async function seed({ adminPerms = [], grants = [] } = {}) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "opsSummary", "latest"), { schemaVersion: 1, asOf: "2026-11-08" });
    await setDoc(doc(db, "opsSummary", "noshow"), { schemaVersion: 1, asOf: "2026-11-08" });
    await setDoc(doc(db, "opsSummary", "other"), { schemaVersion: 1 });
    await setDoc(doc(db, "opsParticipantDays", "20261108"), { schemaVersion: 1, events: [] });
    await setDoc(doc(db, "opsDailyStats", "20261108"), { schemaVersion: 1 });
    await setDoc(doc(db, "rolePermissions", "admin"), { permissions: adminPerms });
    await Promise.all(grants.map((grant) => setDoc(doc(db, "userPermissionGrants", grant.uid), {
      permissions: grant.permissions,
      enabled: grant.enabled !== false,
    })));
  });
}

describe("ops dashboard rules", () => {
  test("super_admin 可讀 latest、noshow、參與索引，不可 list summary、不可讀每日統計、不可寫", async () => {
    await seed();
    const db = dbAs("super1", "super_admin");
    await assertSucceeds(getDoc(doc(db, "opsSummary", "latest")));
    await assertSucceeds(getDoc(doc(db, "opsSummary", "noshow")));
    await assertSucceeds(getDoc(doc(db, "opsParticipantDays", "20261108")));
    await assertSucceeds(getDocs(collection(db, "opsParticipantDays")));
    await assertFails(getDoc(doc(db, "opsSummary", "other")));
    await assertFails(getDocs(collection(db, "opsSummary")));
    await assertFails(getDoc(doc(db, "opsDailyStats", "20261108")));
    await assertFails(setDoc(doc(db, "opsSummary", "latest"), { schemaVersion: 2 }));
    await assertFails(updateDoc(doc(db, "opsSummary", "noshow"), { asOf: "2026-11-09" }));
    await assertFails(deleteDoc(doc(db, "opsSummary", "latest")));
    await assertFails(setDoc(doc(db, "opsParticipantDays", "20261109"), { schemaVersion: 1 }));
    await assertFails(updateDoc(doc(db, "opsParticipantDays", "20261108"), { events: [] }));
    await assertFails(deleteDoc(doc(db, "opsParticipantDays", "20261108")));
    await assertFails(setDoc(doc(db, "opsDailyStats", "20261108"), { schemaVersion: 1 }));
  });

  test("有 admin.dashboard.entry 的 admin 可讀 latest 與參與索引，不可讀 noshow", async () => {
    await seed({ adminPerms: ["admin.dashboard.entry"] });
    const db = dbAs("admin1", "admin");
    await assertSucceeds(getDoc(doc(db, "opsSummary", "latest")));
    await assertSucceeds(getDoc(doc(db, "opsParticipantDays", "20261108")));
    await assertSucceeds(getDocs(collection(db, "opsParticipantDays")));
    await assertFails(getDoc(doc(db, "opsSummary", "noshow")));
    await assertFails(getDocs(collection(db, "opsSummary")));
    await assertFails(getDoc(doc(db, "opsDailyStats", "20261108")));
    await assertFails(setDoc(doc(db, "opsSummary", "latest"), { schemaVersion: 2 }));
  });

  test("再加 activity.view_noshow 可讀 noshow", async () => {
    await seed({ adminPerms: ["admin.dashboard.entry", "activity.view_noshow"] });
    const db = dbAs("admin2", "admin");
    await assertSucceeds(getDoc(doc(db, "opsSummary", "latest")));
    await assertSucceeds(getDoc(doc(db, "opsSummary", "noshow")));
    await assertSucceeds(getDocs(collection(db, "opsParticipantDays")));
  });

  test("個別授予入口與 activity.view_noshow 可讀 noshow，仍不可讀每日統計、不可寫", async () => {
    await seed({
      grants: [{ uid: "bothGrant", permissions: ["admin.dashboard.entry", "activity.view_noshow"] }],
    });
    const db = dbAs("bothGrant", "user");
    await assertSucceeds(getDoc(doc(db, "opsSummary", "latest")));
    await assertSucceeds(getDoc(doc(db, "opsSummary", "noshow")));
    await assertSucceeds(getDoc(doc(db, "opsParticipantDays", "20261108")));
    await assertSucceeds(getDocs(collection(db, "opsParticipantDays")));
    await assertFails(getDocs(collection(db, "opsSummary")));
    await assertFails(getDoc(doc(db, "opsDailyStats", "20261108")));
    await assertFails(setDoc(doc(db, "opsSummary", "noshow"), { schemaVersion: 2 }));
  });

  test("只有 activity.view_noshow、沒有入口權限，三者都不可讀", async () => {
    await seed({ grants: [{ uid: "noshowOnly", permissions: ["activity.view_noshow"] }] });
    const db = dbAs("noshowOnly", "user");
    await assertFails(getDoc(doc(db, "opsSummary", "latest")));
    await assertFails(getDoc(doc(db, "opsSummary", "noshow")));
    await assertFails(getDoc(doc(db, "opsParticipantDays", "20261108")));
    await assertFails(getDocs(collection(db, "opsParticipantDays")));
    await assertFails(getDoc(doc(db, "opsDailyStats", "20261108")));
  });

  test("一般 user 與未登入全部不可讀；個別授予入口權限可讀 latest 與參與索引", async () => {
    await seed({ grants: [{ uid: "granted", permissions: ["admin.dashboard.entry"] }] });
    const userDb = dbAs("user1", "user");
    const guestDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(userDb, "opsSummary", "latest")));
    await assertFails(getDoc(doc(userDb, "opsSummary", "noshow")));
    await assertFails(getDocs(collection(userDb, "opsParticipantDays")));
    await assertFails(getDoc(doc(userDb, "opsDailyStats", "20261108")));
    await assertFails(setDoc(doc(userDb, "opsParticipantDays", "20261108"), { schemaVersion: 1 }));
    await assertFails(getDoc(doc(guestDb, "opsSummary", "latest")));
    await assertFails(getDoc(doc(guestDb, "opsDailyStats", "20261108")));

    const granted = dbAs("granted", "user");
    await assertSucceeds(getDoc(doc(granted, "opsSummary", "latest")));
    await assertSucceeds(getDocs(collection(granted, "opsParticipantDays")));
    await assertFails(getDoc(doc(granted, "opsSummary", "noshow")));
  });
});
