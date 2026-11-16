"use strict";

// readTeamById 對真 Firestore Emulator 的五種情形（T-062 C2）。
// 補單元測試的記憶體 Firestore 無法證明的部分：where("id").limit(3) 在真查詢上的命中與排除。
//
// 只能在 Firestore Emulator 內執行（不在 tests/unit/，所以 `npm run test:unit` 不會收進來）：
//   npm run test:functions:emulator
// 或（需 Java）：
//   npx firebase emulators:exec --only firestore --project demo-delete-event "npx jest tests/emulator/notification-team-legacy-id-emulator.test.js --runInBand"
// 沒有 FIRESTORE_EMULATOR_HOST 或 project id 不是 demo- 開頭時直接失敗（不跳過），避免 Admin SDK 連到正式專案。

const path = require("path");

const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "functions");
const fromFunctions = (id) => require(require.resolve(id, { paths: [FUNCTIONS_DIR] }));
const { initializeApp, deleteApp } = fromFunctions("firebase-admin/app");
const { getFirestore } = fromFunctions("firebase-admin/firestore");
const { readTeamById } = require("../../functions/notification-relation-queries-shared");

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-delete-event";
const BAD_KEYS = ["", "   ", "a/b", "t1/students/forged", ".", "..", "__x__", "x".repeat(129), null, 12, undefined];

jest.setTimeout(60000);

let app, db;

beforeAll(() => {
  if (!EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST 未設定：本檔只能在 firebase emulators:exec 內執行");
  if (!PROJECT_ID.startsWith("demo-")) throw new Error("project id 必須是 demo- 開頭，避免連到正式專案：" + PROJECT_ID);
  app = initializeApp({ projectId: PROJECT_ID }, "notification-team-legacy-id-" + Date.now());
  db = getFirestore(app);
});

afterAll(async () => { if (app) await deleteApp(app); });

beforeEach(async () => {
  const res = await fetch(`http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error("清空 emulator 失敗：" + res.status);
});

async function seed(docs) {
  const batch = db.batch();
  for (const [p, data] of Object.entries(docs)) batch.set(db.doc(p), data);
  await batch.commit();
}

// 包一層真 Firestore，只計次，查詢仍打到 emulator。不合格式的鍵不該出現在 calls。
function watch(raw) {
  const calls = [];
  return {
    calls,
    collection(name) {
      calls.push({ op: "collection", name });
      const col = raw.collection(name);
      return {
        doc(id) {
          calls.push({ op: "doc", name, id });
          const ref = col.doc(id);
          return {
            get: () => {
              calls.push({ op: "get", path: name + "/" + id });
              return ref.get();
            },
          };
        },
        where(field, op, value) {
          calls.push({ op: "where", name, field, op, value });
          const q = col.where(field, op, value);
          return {
            limit(n) {
              calls.push({ op: "limit", n });
              const limited = q.limit(n);
              return { get: () => limited.get() };
            },
          };
        },
      };
    },
  };
}

test("① 文件 id 命中且 id 欄位不同：讀到，不再 where", async () => {
  await seed({ "teams/docHit": { id: "logicHit", captainUid: "uidCap" } });
  const watched = watch(db);
  await expect(readTeamById(watched, "docHit")).resolves.toEqual({
    docId: "docHit", data: { id: "logicHit", captainUid: "uidCap" },
  });
  expect(watched.calls.some((item) => item.op === "where")).toBe(false);
  expect(watched.calls).toContainEqual({ op: "get", path: "teams/docHit" });
});

test("② 文件 id 查無、唯一非自建舊 id：讀到", async () => {
  await seed({ "teams/docOld": { id: "logicOld", captainUid: "uidCap" } });
  const watched = watch(db);
  await expect(readTeamById(watched, "logicOld")).resolves.toEqual({
    docId: "docOld", data: { id: "logicOld", captainUid: "uidCap" },
  });
  expect(watched.calls).toContainEqual({ op: "where", name: "teams", field: "id", op: "==", value: "logicOld" });
  expect(watched.calls).toContainEqual({ op: "limit", n: 3 });
});

test("③ 文件 id 查無、兩筆舊 id：null，不丟錯", async () => {
  await seed({
    "teams/dupA": { id: "logicDup", captainUid: "uidA" },
    "teams/dupB": { id: "logicDup", captainUid: "uidB" },
  });
  await expect(readTeamById(watch(db), "logicDup")).resolves.toBeNull();
});

test("④ 文件 id 查無、唯一候選是自建隊：null；同一隊用文件 id 仍讀得到", async () => {
  const data = { id: "logicOwn", createdVia: "user_capability", captainUid: "uidOwn" };
  await seed({ "teams/docOwn": data });
  const watched = watch(db);
  await expect(readTeamById(watched, "logicOwn")).resolves.toBeNull();
  await expect(readTeamById(watched, "docOwn")).resolves.toEqual({ docId: "docOwn", data });
});

test("⑤ 不合格式鍵：null 且沒有發出查詢", async () => {
  await seed({ "teams/t1": { id: "t1", captainUid: "uidCap" } });
  const watched = watch(db);
  for (const key of BAD_KEYS) await expect(readTeamById(watched, key)).resolves.toBeNull();
  expect(watched.calls).toEqual([]);
});
