// 網頁推播設計卡 W3：webPushSubscriptions 只由 Functions（Admin SDK）讀寫，
// 用戶端任何身分對自己或他人的訂閱，讀、列、建、改、刪都要被拒。
// firestore.rules 不另加規則，靠預設拒絕（R-QA-008）；本檔只證明這件事，不改也不部署 Rules。
const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where,
} = require("firebase/firestore");

const PROJECT_ID = "demo-rules-test";
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
const OWN_SUB = "sub_own";
const OTHER_SUB = "sub_other";
let testEnv;

jest.setTimeout(30000);

function subscription(uid) {
  return {
    uid,
    endpoint: "https://push.example.test/send/abc",
    keys: { p256dh: "test-p256dh", auth: "test-auth" },
    platform: "android",
    createdAt: new Date(0),
    lastSeenAt: new Date(0),
  };
}

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

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "uidUser"), { role: "user" });
    await setDoc(doc(db, "users", "uidOther"), { role: "user" });
    await setDoc(doc(db, "users", "uidSuper"), { role: "super_admin" });
    await setDoc(doc(db, "webPushSubscriptions", OWN_SUB), subscription("uidUser"));
    await setDoc(doc(db, "webPushSubscriptions", OTHER_SUB), subscription("uidOther"));
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const IDENTITIES = [
  ["訪客", () => testEnv.unauthenticatedContext().firestore()],
  ["一般使用者（訂閱本人）", () => testEnv.authenticatedContext("uidUser", { role: "user" }).firestore()],
  ["super_admin", () => testEnv.authenticatedContext("uidSuper", { role: "super_admin", admin: true }).firestore()],
];

describe("webPushSubscriptions 用戶端一律拒絕", () => {
  test.each(IDENTITIES)("%s 不能讀本人的訂閱", async (_label, getDb) => {
    await assertFails(getDoc(doc(getDb(), "webPushSubscriptions", OWN_SUB)));
  });

  test.each(IDENTITIES)("%s 不能讀他人的訂閱", async (_label, getDb) => {
    await assertFails(getDoc(doc(getDb(), "webPushSubscriptions", OTHER_SUB)));
  });

  test.each(IDENTITIES)("%s 不能列集合", async (_label, getDb) => {
    await assertFails(getDocs(collection(getDb(), "webPushSubscriptions")));
  });

  test.each(IDENTITIES)("%s 不能用 uid 條件查本人的訂閱", async (_label, getDb) => {
    await assertFails(getDocs(query(collection(getDb(), "webPushSubscriptions"), where("uid", "==", "uidUser"))));
  });

  test.each(IDENTITIES)("%s 不能建立訂閱", async (_label, getDb) => {
    await assertFails(setDoc(doc(getDb(), "webPushSubscriptions", "sub_new"), subscription("uidUser")));
  });

  test.each(IDENTITIES)("%s 不能修改本人的訂閱", async (_label, getDb) => {
    await assertFails(updateDoc(doc(getDb(), "webPushSubscriptions", OWN_SUB), { lastSeenAt: new Date(1) }));
  });

  test.each(IDENTITIES)("%s 不能修改他人的訂閱", async (_label, getDb) => {
    await assertFails(updateDoc(doc(getDb(), "webPushSubscriptions", OTHER_SUB), { uid: "uidUser" }));
  });

  test.each(IDENTITIES)("%s 不能刪除本人的訂閱", async (_label, getDb) => {
    await assertFails(deleteDoc(doc(getDb(), "webPushSubscriptions", OWN_SUB)));
  });

  test.each(IDENTITIES)("%s 不能刪除他人的訂閱", async (_label, getDb) => {
    await assertFails(deleteDoc(doc(getDb(), "webPushSubscriptions", OTHER_SUB)));
  });
});
