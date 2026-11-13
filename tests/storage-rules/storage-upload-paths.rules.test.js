/**
 * 契約測試：舊站 A 與新站 FC-B 實際使用的每一條 images/ 上傳路徑（2026-11-13 健檢 A3-01）。
 *
 * 兩站上傳都把時間戳放進檔名（A FirebaseService._uploadImage／_uploadImageWithRef 為 images/<path>_<ms>；
 * B uploadImageDataUrl 同樣格式，賽事卡片為 images/tournamentCards/<cardId>/cover_<ms>.webp，
 * 第二身份頭像為 images/users/<uid>/identities/secondary/avatar_<ms>），每次都是新物件。
 *
 * 驗證範圍（兩個 bucket 都跑）：
 *   - allow：登入者在每一條路徑新增圖片；未登入者讀取既有圖片。
 *   - allow：第一個 bucket 已有同名檔時，改傳第二個 bucket 的同一路徑仍是新增（兩站的 bucket 備援流程）。
 *   - deny：任何人覆寫每一條路徑上的既有圖片（第二身份頭像本人除外，見 storage.rules.test.js）。
 */

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { clearBuckets } = require("./clear-buckets");

const PROJECT_ID = "demo-storage-upload-paths-rules-test";
const RULES_PATH = path.resolve(__dirname, "..", "..", "storage.rules");
const [HOST, PORT] = (
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199"
).split(":");

const UPLOADER = "uidUploader";
const OTHER = "uidOther";
const SECOND_BUCKET = "gs://demo-asia-upload-bucket";
const TS = 1760000000000;
const BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

// [說明, 物件路徑]；路徑形狀照兩站上傳程式產生的格式。
const UPLOAD_PATHS = [
  ["A／B 活動主圖", `images/events/ce_1_${TS}`],
  ["A／B 活動封面 cover", `images/events/ce_1_cover_${TS}`],
  ["A／B 活動首頁圖 homeNext", `images/events/ce_1_homeNext_${TS}`],
  ["A／B 活動範本", `images/eventTemplates/${UPLOADER}_${TS}`],
  ["A 賽事主圖", `images/tournaments/ct_1_${TS}`],
  ["A 賽事內文圖", `images/tournaments/ct_1_content_${TS}`],
  ["A 俱樂部主圖", `images/teams/tm_1_${TS}`],
  ["A／B 俱樂部頭像", `images/teams/tm_1_avatar_${TS}`],
  ["A／B 俱樂部封面", `images/teams/tm_1_cover_${TS}`],
  ["A／B 俱樂部卡片圖", `images/teams/tm_1_card_${TS}`],
  ["A／B 首頁橫幅", `images/banners/ban1_${TS}`],
  ["A 觀賽背景", `images/banners/watch-party-bg_${TS}`],
  ["A 浮動廣告", `images/floatingAds/fa1_${TS}`],
  ["A 彈窗廣告", `images/popupAds/pa1_${TS}`],
  ["A 贊助商", `images/sponsors/sp1_${TS}`],
  ["A 開機品牌圖", `images/boot-brand/logo_${TS}`],
  ["A 商品圖", `images/shopItems/si_1_0_${TS}`],
  ["A 主題圖", `images/siteThemes/th1_${TS}`],
  ["A 徽章圖", `images/badges/bd1_${TS}`],
  ["B 賽事卡片", `images/tournamentCards/tc_${TS}_abc123/cover_${TS}.webp`],
];
const AVATAR_PATH = `images/users/${UPLOADER}/identities/secondary/avatar_${TS}`;

jest.setTimeout(30000);

let testEnv;

function storageAs(uid, bucket) {
  const context = uid == null
    ? testEnv.unauthenticatedContext()
    : testEnv.authenticatedContext(uid);
  return bucket ? context.storage(bucket) : context.storage();
}

function upload(storage, objectPath, contentType = "image/webp") {
  return storage.ref(objectPath).put(BYTES, {
    contentType,
    cacheControl: "public, max-age=31536000",
  });
}

async function seedFile(objectPath, bucket) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const storage = bucket ? ctx.storage(bucket) : ctx.storage();
    await assertSucceeds(upload(storage, objectPath));
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
  await clearBuckets(testEnv, [SECOND_BUCKET]);
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe.each([
  ["預設 bucket", undefined],
  ["第二 bucket", SECOND_BUCKET],
])("%s：兩站上傳路徑", (_label, bucket) => {
  test.each(UPLOAD_PATHS)("allow：登入者新增 %s", async (_name, objectPath) => {
    await assertSucceeds(upload(storageAs(UPLOADER, bucket), objectPath));
  });

  test.each(UPLOAD_PATHS)("allow：未登入者讀取既有 %s", async (_name, objectPath) => {
    await seedFile(objectPath, bucket);
    await assertSucceeds(storageAs(null, bucket).ref(objectPath).getMetadata());
  });

  test.each(UPLOAD_PATHS)("deny：他人覆寫既有 %s", async (_name, objectPath) => {
    await seedFile(objectPath, bucket);
    await assertFails(upload(storageAs(OTHER, bucket), objectPath));
  });

  test.each(UPLOAD_PATHS)("deny：重傳同一路徑覆寫既有 %s", async (_name, objectPath) => {
    await seedFile(objectPath, bucket);
    await assertFails(upload(storageAs(UPLOADER, bucket), objectPath));
  });

  test("allow：本人新增第二身份頭像（A／B）", async () => {
    await assertSucceeds(upload(storageAs(UPLOADER, bucket), AVATAR_PATH, "image/jpeg"));
  });

  test("deny：他人覆寫既有第二身份頭像", async () => {
    await seedFile(AVATAR_PATH, bucket);
    await assertFails(upload(storageAs(OTHER, bucket), AVATAR_PATH, "image/jpeg"));
  });
});

describe("bucket 備援：第一個 bucket 已有同名檔，第二個 bucket 仍是新增", () => {
  test.each(UPLOAD_PATHS)("allow：%s", async (_name, objectPath) => {
    await seedFile(objectPath);
    await assertSucceeds(upload(storageAs(UPLOADER, SECOND_BUCKET), objectPath));
  });

  test("allow：第二身份頭像（B 兩個 bucket 用同一路徑）", async () => {
    await seedFile(AVATAR_PATH);
    await assertSucceeds(upload(storageAs(UPLOADER, SECOND_BUCKET), AVATAR_PATH, "image/jpeg"));
  });
});
