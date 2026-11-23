// 網頁推播 W2-B：webPushQueue、webPushDaily、webPushControl 只由 Functions（Admin SDK）讀寫，
// 用戶端任何身分讀、列、建、改、刪都要被拒。firestore.rules 不另加規則，靠預設拒絕（R-QA-008）；
// 本檔只證明這件事，不改也不部署 Rules（比照 web-push-subscriptions-rules.test.js）。
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
let testEnv;

jest.setTimeout(30000);

const COLLECTIONS = [
  {
    name: "webPushQueue",
    existingId: "q_existing",
    data: () => ({
      schema: 1, source: "registration", kind: "signup", recipientUid: "uidUser", title: "t", body: "b",
      url: "/inbox", status: "pending", createdAt: new Date(0), expireAt: new Date(0),
    }),
    patch: { status: "claimed" },
    queryField: "recipientUid",
  },
  {
    name: "webPushDaily",
    existingId: "20991231_existing",
    data: () => ({ count: 1, updatedAt: new Date(0), expireAt: new Date(0) }),
    patch: { count: 0 },
    queryField: "count",
  },
  {
    name: "webPushControl",
    existingId: "sender",
    data: () => ({ sendEnabled: false, updatedAt: new Date(0), note: "test" }),
    patch: { sendEnabled: true },
    queryField: "sendEnabled",
  },
];

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
    await setDoc(doc(db, "users", "uidSuper"), { role: "super_admin" });
    for (const c of COLLECTIONS) {
      await setDoc(doc(db, c.name, c.existingId), c.data());
    }
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const IDENTITIES = [
  ["訪客", () => testEnv.unauthenticatedContext().firestore()],
  ["一般使用者", () => testEnv.authenticatedContext("uidUser", { role: "user" }).firestore()],
  ["super_admin", () => testEnv.authenticatedContext("uidSuper", { role: "super_admin", admin: true }).firestore()],
];

const CASES = [];
for (const c of COLLECTIONS) for (const [label, getDb] of IDENTITIES) CASES.push([c.name, label, c, getDb]);

describe("webPushQueue／webPushDaily／webPushControl 用戶端一律拒絕", () => {
  test.each(CASES)("%s｜%s 不能讀單筆", async (_n, _l, c, getDb) => {
    await assertFails(getDoc(doc(getDb(), c.name, c.existingId)));
  });

  test.each(CASES)("%s｜%s 不能列集合", async (_n, _l, c, getDb) => {
    await assertFails(getDocs(collection(getDb(), c.name)));
  });

  test.each(CASES)("%s｜%s 不能條件查詢", async (_n, _l, c, getDb) => {
    await assertFails(getDocs(query(collection(getDb(), c.name), where(c.queryField, "==", c.data()[c.queryField]))));
  });

  test.each(CASES)("%s｜%s 不能建立", async (_n, _l, c, getDb) => {
    await assertFails(setDoc(doc(getDb(), c.name, "new_doc"), c.data()));
  });

  test.each(CASES)("%s｜%s 不能修改", async (_n, _l, c, getDb) => {
    await assertFails(updateDoc(doc(getDb(), c.name, c.existingId), c.patch));
  });

  test.each(CASES)("%s｜%s 不能刪除", async (_n, _l, c, getDb) => {
    await assertFails(deleteDoc(doc(getDb(), c.name, c.existingId)));
  });
});
