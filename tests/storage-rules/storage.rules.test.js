/**
 * 契約測試：FC 一般圖片與第二身份頭像的 Storage 存取規則。
 *
 * 路徑比照 A 前端：一般圖片為 images/events/<id>_<timestamp>；
 * 第二身份頭像為 images/users/<uid>/identities/secondary/avatar_<timestamp>。
 *
 * 驗證範圍（Storage Rules emulator）：
 *   - allow：登入者新增／覆寫一般圖片；本人新增／覆寫第二身份頭像。
 *   - allow：未登入公開讀取；非第二身份結構的圖片路徑不受排除條件誤傷。
 *   - deny：未登入寫入、非圖片、大小達到或超過 2MB、任何人刪除任何檔案（含本人頭像，與正式版一致）。
 *   - deny：他人寫入／覆寫／刪除第二身份頭像；任何人寫入 secondary 深層路徑。
 *   - deny：images/ 以外路徑；第二 bucket 同樣禁止他人寫入第二身份頭像。
 *
 * 每個案例清空 Storage；既有檔案透過停用規則的 context 建立，
 * 避免把新增誤當覆寫，或把不存在的檔案誤當刪除權限測試。
 */

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");

const PROJECT_ID = "demo-storage-rules-test";
const RULES_PATH = path.resolve(__dirname, "..", "..", "storage.rules");
const [HOST, PORT] = (
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199"
).split(":");

const USER_A = "userA";
const USER_B = "userB";
const SECOND_BUCKET = "gs://demo-asia-upload-bucket";
const EVENT_PATH = "images/events/event_1_1760000000000";
const AVATAR_PATH = "images/users/userA/identities/secondary/avatar_1";
const DEEP_AVATAR_PATH = "images/users/userA/identities/secondary/x/y";
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const TWO_MB = 2 * 1024 * 1024;

jest.setTimeout(20000);

let testEnv;

function storageAs(uid, bucket) {
  const context = uid == null
    ? testEnv.unauthenticatedContext()
    : testEnv.authenticatedContext(uid);
  return bucket ? context.storage(bucket) : context.storage();
}

function upload(storage, objectPath, bytes = PNG_BYTES, contentType = "image/png") {
  return storage.ref(objectPath).put(bytes, { contentType });
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
  await testEnv.clearStorage();
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe("一般圖片：公開讀取與登入上傳", () => {
  test("allow：登入者可新增小於 2MB 的 image/png 圖片", async () => {
    await assertSucceeds(upload(storageAs(USER_A), EVENT_PATH));
  });

  test("deny：未登入者不能新增一般圖片", async () => {
    await assertFails(upload(storageAs(null), EVENT_PATH));
  });

  test("deny：登入者不能上傳超過 2MB 的一般圖片", async () => {
    await assertFails(
      upload(storageAs(USER_A), EVENT_PATH, new Uint8Array(TWO_MB + 1)),
    );
  });

  test("deny：登入者不能上傳正好 2MB 的一般圖片，大小條件為嚴格小於", async () => {
    await assertFails(
      upload(storageAs(USER_A), EVENT_PATH, new Uint8Array(TWO_MB)),
    );
  });

  test("deny：登入者不能以 text/plain 上傳一般圖片路徑", async () => {
    await assertFails(
      upload(storageAs(USER_A), EVENT_PATH, PNG_BYTES, "text/plain"),
    );
  });

  test("allow：未登入者可讀取既有一般圖片的 metadata", async () => {
    await seedFile(EVENT_PATH);
    await assertSucceeds(storageAs(null).ref(EVENT_PATH).getMetadata());
  });

  test("deny：登入者不能刪除既有一般圖片，與正式版行為一致", async () => {
    await seedFile(EVENT_PATH);
    await assertFails(storageAs(USER_A).ref(EVENT_PATH).delete());
  });

  test("allow：登入者可覆寫既有一般圖片，與正式版行為一致", async () => {
    await seedFile(EVENT_PATH);
    await assertSucceeds(upload(storageAs(USER_A), EVENT_PATH));
  });
});

describe("第二身份頭像：僅本人可寫入一層檔案", () => {
  test("allow：本人 userA 可新增自己的第二身份頭像", async () => {
    await assertSucceeds(upload(storageAs(USER_A), AVATAR_PATH));
  });

  test("allow：本人 userA 可覆寫自己的既有第二身份頭像", async () => {
    await seedFile(AVATAR_PATH);
    await assertSucceeds(upload(storageAs(USER_A), AVATAR_PATH));
  });

  test("deny：他人 userB 不能新增 userA 的第二身份頭像，泛用規則不得放行", async () => {
    await assertFails(upload(storageAs(USER_B), AVATAR_PATH));
  });

  test("deny：他人 userB 不能覆寫 userA 的既有第二身份頭像", async () => {
    await seedFile(AVATAR_PATH);
    await assertFails(upload(storageAs(USER_B), AVATAR_PATH));
  });

  test("deny：他人 userB 不能寫入 userA 的 secondary 深層路徑", async () => {
    await assertFails(upload(storageAs(USER_B), DEEP_AVATAR_PATH));
  });

  test("deny：本人 userA 也不能寫入 secondary 深層路徑，專用規則只允許一層檔名", async () => {
    await assertFails(upload(storageAs(USER_A), DEEP_AVATAR_PATH));
  });

  test("deny：本人不能以 text/plain 上傳第二身份頭像", async () => {
    await assertFails(
      upload(storageAs(USER_A), AVATAR_PATH, PNG_BYTES, "text/plain"),
    );
  });

  test("deny：本人不能上傳超過 2MB 的第二身份頭像", async () => {
    await assertFails(
      upload(storageAs(USER_A), AVATAR_PATH, new Uint8Array(TWO_MB + 1)),
    );
  });

  test("deny：本人不能上傳正好 2MB 的第二身份頭像，大小條件為嚴格小於", async () => {
    await assertFails(
      upload(storageAs(USER_A), AVATAR_PATH, new Uint8Array(TWO_MB)),
    );
  });

  test("deny：未登入者不能新增第二身份頭像", async () => {
    await assertFails(upload(storageAs(null), AVATAR_PATH));
  });

  test("deny：本人 userA 也不能刪除自己的第二身份頭像，與正式版一致（清除走 callable）", async () => {
    await seedFile(AVATAR_PATH);
    await assertFails(storageAs(USER_A).ref(AVATAR_PATH).delete());
  });

  test("deny：他人 userB 不能刪除 userA 的既有第二身份頭像", async () => {
    await seedFile(AVATAR_PATH);
    await assertFails(storageAs(USER_B).ref(AVATAR_PATH).delete());
  });

  test("deny：未登入者不能刪除既有第二身份頭像", async () => {
    await seedFile(AVATAR_PATH);
    await assertFails(storageAs(null).ref(AVATAR_PATH).delete());
  });

  test("allow：未登入者可讀取既有第二身份頭像的 metadata", async () => {
    await seedFile(AVATAR_PATH);
    await assertSucceeds(storageAs(null).ref(AVATAR_PATH).getMetadata());
  });
});

describe("路徑邊界：只排除完整第二身份目錄結構", () => {
  test("deny：登入者不能寫入 images/ 以外的 uploads/x.png", async () => {
    await assertFails(upload(storageAs(USER_A), "uploads/x.png"));
  });

  test("deny：他人 userB 不能在 userA 的 secondary 資料夾寫入含換行的檔名（(?s) 讓 . 也比對換行）", async () => {
    await assertFails(
      upload(
        storageAs(USER_B),
        "images/users/userA/identities/secondary/a\nb",
      ),
    );
  });

  test("allow：大寫 Secondary 不在排除範圍，與伺服器只接受小寫 secondary 一致", async () => {
    await assertSucceeds(
      upload(
        storageAs(USER_B),
        "images/users/userA/identities/Secondary/avatar_1",
      ),
    );
  });

  test("allow：未登入者可列舉 images/ 底下檔案，與正式版 read 含 list 一致", async () => {
    await seedFile(EVENT_PATH);
    await assertSucceeds(storageAs(null).ref("images/events").listAll());
  });

  test("allow：登入者可寫 primary 頭像路徑，泛用規則不誤傷其他身份目錄", async () => {
    await assertSucceeds(
      upload(
        storageAs(USER_B),
        "images/users/userA/identities/primary/avatar_1",
      ),
    );
  });

  test("allow：登入者可寫 events/secondary 路徑，只有 secondary 名稱不應被排除", async () => {
    await assertSucceeds(
      upload(storageAs(USER_B), "images/events/secondary/avatar_1"),
    );
  });
});

describe("第二 bucket：套用相同 Storage 規則", () => {
  test("allow：第二 bucket 允許登入者新增一般圖片", async () => {
    await assertSucceeds(
      upload(storageAs(USER_A, SECOND_BUCKET), EVENT_PATH),
    );
  });

  test("allow：第二 bucket 允許登入者覆寫既有一般圖片", async () => {
    await seedFile(EVENT_PATH, SECOND_BUCKET);
    await assertSucceeds(
      upload(storageAs(USER_A, SECOND_BUCKET), EVENT_PATH),
    );
  });

  test("deny：第二 bucket 禁止他人 userB 新增 userA 的第二身份頭像", async () => {
    await assertFails(
      upload(storageAs(USER_B, SECOND_BUCKET), AVATAR_PATH),
    );
  });

  test("deny：第二 bucket 禁止他人 userB 覆寫 userA 的既有第二身份頭像", async () => {
    await seedFile(AVATAR_PATH, SECOND_BUCKET);
    await assertFails(
      upload(storageAs(USER_B, SECOND_BUCKET), AVATAR_PATH),
    );
  });
});
