const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } = require("firebase/firestore");

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

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "uidUser"), { role: "user" });
    await setDoc(doc(db, "users", "uidAdmin"), { role: "admin" });
    await setDoc(doc(db, "users", "uidSuper"), { role: "super_admin" });
    await setDoc(doc(db, "contactMessages", "msg1"), {
      uid: "uidUser",
      name: "王小明",
      contact: "line:owner",
      content: "想問場地",
      userName: "王小明",
      status: "new",
      source: "fcb",
    });
    await setDoc(doc(db, "contactMessageLimits", "uidUser"), {
      uid: "uidUser",
      sentAtMs: [1],
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

function guest() {
  return testEnv.unauthenticatedContext().firestore();
}

function member() {
  return testEnv.authenticatedContext("uidUser", { role: "user" }).firestore();
}

function admin() {
  return testEnv.authenticatedContext("uidAdmin", { role: "admin", admin: true }).firestore();
}

function superAdmin() {
  return testEnv.authenticatedContext("uidSuper", { role: "super_admin", admin: true }).firestore();
}

function userClaimingSuperAdmin() {
  return testEnv.authenticatedContext("uidUser", { role: "super_admin", admin: true }).firestore();
}

const IDENTITIES = [
  ["訪客", () => guest()],
  ["一般使用者", () => member()],
  ["admin", () => admin()],
  ["super_admin", () => superAdmin()],
];

describe("contactMessages", () => {
  test("super_admin 可讀", async () => {
    await assertSucceeds(getDoc(doc(superAdmin(), "contactMessages", "msg1")));
  });

  test.each([
    ["訪客", () => guest()],
    ["一般使用者", () => member()],
    ["admin", () => admin()],
  ])("%s 不能讀", async (_label, getDb) => {
    await assertFails(getDoc(doc(getDb(), "contactMessages", "msg1")));
  });

  test("users 文件 role 是 user 但 token 宣稱 super_admin 時讀取被拒", async () => {
    await assertFails(getDoc(doc(userClaimingSuperAdmin(), "contactMessages", "msg1")));
  });

  test("super_admin 可 list contactMessages，一般使用者不可", async () => {
    await assertSucceeds(getDocs(collection(superAdmin(), "contactMessages")));
    await assertFails(getDocs(collection(member(), "contactMessages")));
  });

  describe.each(IDENTITIES)("%s 不能寫", (_label, getDb) => {
    test("不能建立", async () => {
      await assertFails(setDoc(doc(getDb(), "contactMessages", "msg2"), {
        uid: "uidUser",
        name: "A",
        contact: "B",
        content: "C",
        status: "new",
        source: "fcb",
      }));
    });

    test("不能更新", async () => {
      await assertFails(updateDoc(doc(getDb(), "contactMessages", "msg1"), { status: "read" }));
    });

    test("不能刪除", async () => {
      await assertFails(deleteDoc(doc(getDb(), "contactMessages", "msg1")));
    });
  });
});

describe("contactMessageLimits", () => {
  describe.each(IDENTITIES)("%s 不能讀寫", (_label, getDb) => {
    test("不能讀取", async () => {
      await assertFails(getDoc(doc(getDb(), "contactMessageLimits", "uidUser")));
    });

    test("不能建立或覆寫", async () => {
      await assertFails(setDoc(doc(getDb(), "contactMessageLimits", "uidUser"), { sentAtMs: [] }));
      await assertFails(setDoc(doc(getDb(), "contactMessageLimits", "other"), { sentAtMs: [1] }));
    });

    test("不能更新", async () => {
      await assertFails(updateDoc(doc(getDb(), "contactMessageLimits", "uidUser"), { sentAtMs: [] }));
    });

    test("不能刪除", async () => {
      await assertFails(deleteDoc(doc(getDb(), "contactMessageLimits", "uidUser")));
    });
  });
});
