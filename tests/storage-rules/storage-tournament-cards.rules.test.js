/**
 * 契約測試：新站賽事卡片圖片路徑 images/tournamentCards/{cardId}/{檔名}（T-089）。
 *
 * B 上傳：裁切成 800×300 WebP 後 putString(data_url)，路徑 images/tournamentCards/{cardId}/cover_{時間}.webp，
 * cacheControl public, max-age=31536000；不刪舊檔。
 * 這裡釘住 storage.rules 現況（不改 Rules，沿用 images/** 泛用規則）：登入可上傳圖片、任何人都不能刪除。
 * 權限只由 Firestore tournamentCards 把關（顧問 2026-11-02 裁定 Storage 不讀 Firestore）。
 * 泛用規則的大小、類型、未登入等細節由 storage.rules.test.js 覆蓋；本檔只鎖 B 依賴的這條路徑，
 * Storage Rules 之後若收緊 images/**，這裡會變紅，提醒同步改 B 的上傳流程。
 */

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");

const PROJECT_ID = "demo-storage-tournament-cards-rules-test";
const RULES_PATH = path.resolve(__dirname, "..", "..", "storage.rules");
const [HOST, PORT] = (
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199"
).split(":");

const IMAGE_PATH = "images/tournamentCards/tc_1760000000000_abc123/cover_1760000000000.webp";
const BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

jest.setTimeout(20000);

let testEnv;

function upload(storage) {
  return storage.ref(IMAGE_PATH).put(BYTES, {
    contentType: "image/webp",
    cacheControl: "public, max-age=31536000",
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

describe("賽事卡片圖片 images/tournamentCards/{cardId}/{檔名}", () => {
  test("allow：登入者可上傳圖片", async () => {
    await assertSucceeds(upload(testEnv.authenticatedContext("uidAdmin").storage()));
  });

  test("deny：刪除一律被拒（含上傳者本人）", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await assertSucceeds(upload(ctx.storage()));
    });
    await assertFails(testEnv.authenticatedContext("uidAdmin").storage().ref(IMAGE_PATH).delete());
  });
});
