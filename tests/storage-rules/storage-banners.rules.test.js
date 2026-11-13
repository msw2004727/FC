/**
 * 契約測試：橫幅圖片路徑 images/banners/{bannerId}_{時間} 的 Storage 存取規則（M-145）。
 *
 * B 後台上傳橫幅：先在前端用 canvas 壓成 WebP（品質 0.72，尺寸 1200×545；舊 WebView 降級 JPEG 0.8），
 * 再 putString(data_url)，路徑 images/banners/ban1_<Date.now()>，cacheControl public, max-age=31536000。
 * 這裡釘住 storage.rules 現況（不改 Rules）：
 *   - allow：登入者上傳 < 2MB 的 image/webp、image/jpeg（降級）、image/png；未登入者公開讀取。
 *   - deny：未登入寫入、非圖片、達到或超過 2MB、任何人刪除、任何人覆寫既有橫幅（2026-11-13 健檢 A3-01）。
 *   - 仍存在的缺口：新增上傳只要求「登入」，沒有限制 admin.banners.entry（Storage 不讀 Firestore，
 *     顧問 2026-11-02 裁定）；換圖一律是新檔名，既有橫幅內容不會被換掉。
 */

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { clearBuckets } = require("./clear-buckets");

const PROJECT_ID = "demo-storage-banners-rules-test";
const RULES_PATH = path.resolve(__dirname, "..", "..", "storage.rules");
const [HOST, PORT] = (
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199"
).split(":");

const ADMIN = "uidAdmin";
const USER = "uidUser";
const BANNER_PATH = "images/banners/ban1_1760000000000";
const BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
const TWO_MB = 2 * 1024 * 1024;

jest.setTimeout(20000);

let testEnv;

function storageAs(uid) {
  const context = uid == null
    ? testEnv.unauthenticatedContext()
    : testEnv.authenticatedContext(uid);
  return context.storage();
}

function upload(storage, objectPath, bytes = BYTES, contentType = "image/webp") {
  return storage.ref(objectPath).put(bytes, {
    contentType,
    cacheControl: "public, max-age=31536000",
  });
}

async function seedBanner() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await assertSucceeds(upload(ctx.storage(), BANNER_PATH));
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      rules: fs.readFileSync(RULES_PATH, "utf8"),
      host: HOST,
      port: Number(PORT),
    },
  });
});

beforeEach(async () => {
  await clearBuckets(testEnv);
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe("橫幅圖片：登入上傳（WebP 為主，JPEG 降級）", () => {
  test.each([
    ["image/webp"],
    ["image/jpeg"],
    ["image/png"],
  ])("allow：登入者可新增小於 2MB 的 %s 橫幅", async (contentType) => {
    await assertSucceeds(upload(storageAs(ADMIN), BANNER_PATH, BYTES, contentType));
  });

  test("deny：未登入者不能上傳橫幅", async () => {
    await assertFails(upload(storageAs(null), BANNER_PATH));
  });

  test("deny：非圖片 contentType", async () => {
    await assertFails(upload(storageAs(ADMIN), BANNER_PATH, BYTES, "text/plain"));
  });

  test("deny：正好 2MB 與超過 2MB（大小條件為嚴格小於）", async () => {
    await assertFails(upload(storageAs(ADMIN), BANNER_PATH, new Uint8Array(TWO_MB)));
    await assertFails(upload(storageAs(ADMIN), BANNER_PATH, new Uint8Array(TWO_MB + 1)));
  });

  test("allow：剛好小於 2MB", async () => {
    await assertSucceeds(upload(storageAs(ADMIN), BANNER_PATH, new Uint8Array(TWO_MB - 1)));
  });
});

describe("橫幅圖片：讀取與刪除", () => {
  test("allow：未登入者可讀取橫幅 metadata（首頁公開顯示）", async () => {
    await seedBanner();
    await assertSucceeds(storageAs(null).ref(BANNER_PATH).getMetadata());
  });

  test("deny：任何人（含登入者）不能刪除橫幅圖片；B 換圖是上傳新檔，不刪舊檔", async () => {
    await seedBanner();
    await assertFails(storageAs(ADMIN).ref(BANNER_PATH).delete());
    await assertFails(storageAs(null).ref(BANNER_PATH).delete());
  });
});

describe("覆寫既有橫幅（A3-01 收緊）", () => {
  test("deny：一般登入者不能覆寫既有橫幅圖片", async () => {
    await seedBanner();
    await assertFails(upload(storageAs(USER), BANNER_PATH));
  });

  test("deny：管理員也不能覆寫同一路徑；B 換圖上傳新檔名", async () => {
    await seedBanner();
    await assertFails(upload(storageAs(ADMIN), BANNER_PATH));
  });

  test("allow：管理員換圖改傳新時間戳檔名", async () => {
    await seedBanner();
    await assertSucceeds(upload(storageAs(ADMIN), "images/banners/ban1_1760000000001"));
  });
});
