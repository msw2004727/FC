// K1（iPhone 主畫面 App 登入轉交）：loginHandoffs 只由 Functions（Admin SDK）讀寫，
// 用戶端任何身分的讀、列、建、改、刪都要被拒。firestore.rules 不另加規則，靠檔尾預設拒絕（R-QA-008）。
const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
} = require("@firebase/rules-unit-testing");
const { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } = require("firebase/firestore");

const PROJECT_ID = "demo-rules-test";
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
const HANDOFF_ID = "a".repeat(64);
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

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "uidUser"), { role: "user" });
    await setDoc(doc(db, "users", "uidSuper"), { role: "super_admin" });
    await setDoc(doc(db, "loginHandoffs", HANDOFF_ID), {
      code: "test-code",
      liffClientId: "123",
      liffRedirectUri: "https://toosterx.com/",
      createdAt: new Date(0),
      expiresAt: new Date(300000),
    });
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

describe("loginHandoffs 用戶端一律拒絕", () => {
  test.each(IDENTITIES)("%s 不能讀單筆", async (_label, getDb) => {
    await assertFails(getDoc(doc(getDb(), "loginHandoffs", HANDOFF_ID)));
  });

  test.each(IDENTITIES)("%s 不能列集合", async (_label, getDb) => {
    await assertFails(getDocs(collection(getDb(), "loginHandoffs")));
  });

  test.each(IDENTITIES)("%s 不能建立", async (_label, getDb) => {
    await assertFails(setDoc(doc(getDb(), "loginHandoffs", "b".repeat(64)), {
      code: "x",
      liffClientId: "1",
      liffRedirectUri: "https://toosterx.com/",
    }));
  });

  test.each(IDENTITIES)("%s 不能修改", async (_label, getDb) => {
    await assertFails(updateDoc(doc(getDb(), "loginHandoffs", HANDOFF_ID), { code: "changed" }));
  });

  test.each(IDENTITIES)("%s 不能刪除", async (_label, getDb) => {
    await assertFails(deleteDoc(doc(getDb(), "loginHandoffs", HANDOFF_ID)));
  });
});
