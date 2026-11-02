/**
 * 契約測試：新站賽事卡片圖片 `tournamentCards/{cardId}/{fileName}` 的 Storage 規則（T-089）。
 *
 * B 上傳：裁切成 800×300 WebP（品質 0.9）後 putString(data_url)，路徑 tournamentCards/{id}/cover_{時間}.webp，
 * cacheControl public, max-age=31536000；換圖或刪卡後 best-effort 刪除舊檔。
 *
 *   - read：公開。
 *   - create／update／delete：與 Firestore tournamentCards 同一判斷（總管或持有 admin.tournaments.entry，
 *     含 rolePermissions 角色權限與 userPermissionGrants 個別授權）；寫入另限 image/*、< 2MB（同活動圖片）。
 *   - 判斷靠 Storage 跨服務讀 Firestore（firestore.get／exists），所以本檔要 Firestore emulator 一起跑
 *     （`npm run test:storage-rules` 已改為 `--only firestore,storage`）。
 */

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");

// 與 test:storage-rules 的 emulators:exec --project 相同，跨服務讀取才會讀到同一個 Firestore 專案。
const PROJECT_ID = "demo-storage-rules-test";
const STORAGE_RULES = path.resolve(__dirname, "..", "..", "storage.rules");
const FIRESTORE_RULES = path.resolve(__dirname, "..", "..", "firestore.rules");
const [S_HOST, S_PORT] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199").split(":");
const [F_HOST, F_PORT] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");

const PERM = "admin.tournaments.entry";
const IMAGE_PATH = "tournamentCards/tc_1/cover_1760000000000.webp";
const BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
const TWO_MB = 2 * 1024 * 1024;

jest.setTimeout(30000);

let testEnv;

function storageAs(uid, token = {}) {
  const context = uid == null
    ? testEnv.unauthenticatedContext()
    : testEnv.authenticatedContext(uid, token);
  return context.storage();
}

function upload(storage, objectPath = IMAGE_PATH, bytes = BYTES, contentType = "image/webp") {
  return storage.ref(objectPath).put(bytes, {
    contentType,
    cacheControl: "public, max-age=31536000",
  });
}

async function seedFirestore(docs) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [docPath, data] of Object.entries(docs)) {
      await db.doc(docPath).set(data);
    }
  });
}

async function seedImage() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await assertSucceeds(upload(ctx.storage()));
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      rules: fs.readFileSync(STORAGE_RULES, "utf8"),
      host: S_HOST,
      port: Number(S_PORT),
    },
    firestore: {
      rules: fs.readFileSync(FIRESTORE_RULES, "utf8"),
      host: F_HOST,
      port: Number(F_PORT),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearStorage();
  await testEnv.clearFirestore();
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe("賽事卡片圖片：讀取公開", () => {
  test("allow：未登入者可讀取 metadata", async () => {
    await seedImage();
    await assertSucceeds(storageAs(null).ref(IMAGE_PATH).getMetadata());
  });
});

describe("賽事卡片圖片：上傳需要權限", () => {
  test("allow：角色權限（rolePermissions/admin 含 admin.tournaments.entry）", async () => {
    await seedFirestore({
      "users/uidAdmin": { role: "admin" },
      "rolePermissions/admin": { permissions: [PERM] },
    });
    await assertSucceeds(upload(storageAs("uidAdmin")));
  });

  test("allow：一般用戶持有啟用中的個別授權", async () => {
    await seedFirestore({
      "users/uidGranted": { role: "user" },
      "userPermissionGrants/uidGranted": { uid: "uidGranted", permissions: [PERM], enabled: true },
    });
    await assertSucceeds(upload(storageAs("uidGranted")));
  });

  test("allow：總管（users 文件 role=super_admin）", async () => {
    await seedFirestore({ "users/uidSuper": { role: "super_admin" } });
    await assertSucceeds(upload(storageAs("uidSuper")));
  });

  test("allow：沒有 users 文件時用 token role（同 Firestore authRole）", async () => {
    await seedFirestore({ "rolePermissions/admin": { permissions: [PERM] } });
    await assertSucceeds(upload(storageAs("uidTokenAdmin", { role: "admin" })));
  });

  test("deny：一般用戶（沒有個別授權）", async () => {
    await seedFirestore({ "users/uidUser": { role: "user" } });
    await assertFails(upload(storageAs("uidUser")));
  });

  test("deny：個別授權停用", async () => {
    await seedFirestore({
      "users/uidOff": { role: "user" },
      "userPermissionGrants/uidOff": { uid: "uidOff", permissions: [PERM], enabled: false },
    });
    await assertFails(upload(storageAs("uidOff")));
  });

  test("deny：admin 的角色權限沒有這個碼", async () => {
    await seedFirestore({
      "users/uidAdmin": { role: "admin" },
      "rolePermissions/admin": { permissions: ["admin.banners.entry"] },
    });
    await assertFails(upload(storageAs("uidAdmin")));
  });

  test("deny：未登入", async () => {
    await assertFails(upload(storageAs(null)));
  });

  test("deny：權限者上傳非圖片、達到 2MB", async () => {
    await seedFirestore({ "users/uidSuper": { role: "super_admin" } });
    await assertFails(upload(storageAs("uidSuper"), IMAGE_PATH, BYTES, "text/plain"));
    await assertFails(upload(storageAs("uidSuper"), IMAGE_PATH, new Uint8Array(TWO_MB)));
  });

  test("allow：權限者剛好小於 2MB 的 JPEG", async () => {
    await seedFirestore({ "users/uidSuper": { role: "super_admin" } });
    await assertSucceeds(upload(storageAs("uidSuper"), IMAGE_PATH, new Uint8Array(TWO_MB - 1), "image/jpeg"));
  });
});

describe("賽事卡片圖片：刪除需要權限（換圖、刪卡後清舊檔）", () => {
  test("allow：權限者可刪", async () => {
    await seedImage();
    await seedFirestore({
      "users/uidAdmin": { role: "admin" },
      "rolePermissions/admin": { permissions: [PERM] },
    });
    await assertSucceeds(storageAs("uidAdmin").ref(IMAGE_PATH).delete());
  });

  test("deny：一般用戶、未登入不可刪", async () => {
    await seedImage();
    await seedFirestore({ "users/uidUser": { role: "user" } });
    await assertFails(storageAs("uidUser").ref(IMAGE_PATH).delete());
    await assertFails(storageAs(null).ref(IMAGE_PATH).delete());
  });
});

describe("既有 images/** 規則不受影響", () => {
  test("一般登入者仍可上傳 images/events 圖片、仍不可刪", async () => {
    await assertSucceeds(upload(storageAs("uidUser"), "images/events/ce_1_cover_1"));
    await assertFails(storageAs("uidUser").ref("images/events/ce_1_cover_1").delete());
  });
});
