/**
 * 契約測試：橫幅圖片路徑 images/banners/{bannerId}_{時間} 的 Storage 存取規則（M-145）。
 *
 * B 後台上傳橫幅：先在前端用 canvas 壓成 WebP（品質 0.72，尺寸 1200×545；舊 WebView 降級 JPEG 0.8），
 * 再 putString(data_url)，路徑 images/banners/ban1_<Date.now()>，cacheControl public, max-age=31536000。
 * 這裡釘住 storage.rules 現況（不改 Rules）：
 *   - allow：登入者上傳 < 2MB 的 image/webp、image/jpeg（降級）、image/png；未登入者公開讀取。
 *   - deny：未登入寫入、非圖片、達到或超過 2MB、任何人刪除。
 *   - 已知缺口（現況，非目標）：路徑 images/** 只要求「登入」，沒有限制 admin.banners.entry；
 *     所以任何登入者都能覆寫既有橫幅圖片的內容（要知道路徑，而路徑在公開的 banners 文件的圖片網址裡）。
 *     下面「已知缺口」那個案例把這個現況寫成 allow，Storage Rules 之後收緊時會變紅，提醒同步改 B 的上傳流程與這份測試。
 */

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");

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
  await testEnv.clearStorage();
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

describe("已知缺口（現況）：沒有限制 admin.banners.entry", () => {
  test("allow（現況）：一般登入者也能覆寫既有橫幅圖片內容", async () => {
    await seedBanner();
    await assertSucceeds(upload(storageAs(USER), BANNER_PATH));
  });
});
