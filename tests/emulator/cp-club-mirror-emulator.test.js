"use strict";

// G4 賽事俱樂部鏡像對真 Firestore Emulator 的實測（兩個資料庫：(default) 與 asia-main）。
// 補單元測試假 Firestore 無法證明的部分：跨庫讀寫、transaction 內 set 不帶 merge 真的清掉 seededBy、
// serverTimestamp、並發重複事件結果一致、回填的 updateTime 前置條件、count() 查詢、備份還原。
//
// 只能在 Firestore Emulator 內執行（不在 tests/unit/，`npm run test:unit` 不會收進來）：
//   npx firebase emulators:exec --only firestore --project demo-cp-club-mirror "npx jest --runInBand tests/emulator/cp-club-mirror-emulator.test.js"
// 沒有 FIRESTORE_EMULATOR_HOST 或 project id 不是 demo- 開頭時直接失敗（不跳過），避免 Admin SDK 連到正式專案。

const fs = require("fs");
const os = require("os");
const path = require("path");

const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "functions");
const fromFunctions = (id) => require(require.resolve(id, { paths: [FUNCTIONS_DIR] }));
const { initializeApp, deleteApp } = fromFunctions("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = fromFunctions("firebase-admin/firestore");
const { createOnTeamWrittenForCompetitionsHandler, CP_DATABASE_ID } = require("../../functions/cp-club-mirror");
const { loadState, buildPlan, runExecute, runRollback } = require("../../scripts/cp-club-mirror-backfill");

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-cp-club-mirror";
const BUCKETS = ["fc-football-6c8dc-asia-east1", "fc-football-6c8dc.firebasestorage.app"];
const ENV = { CP_LOGO_BUCKETS: BUCKETS.join(",") };
const ASIA_URL = (name) => `https://firebasestorage.googleapis.com/v0/b/fc-football-6c8dc-asia-east1/o/${name}`;
const logger = { info() {}, warn() {}, error() {} };

jest.setTimeout(60000);

let app, db, cpDb, outDir;

beforeAll(() => {
  if (!EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST 未設定：本檔只能在 firebase emulators:exec 內執行");
  if (!PROJECT_ID.startsWith("demo-")) throw new Error("project id 必須是 demo- 開頭，避免連到正式專案：" + PROJECT_ID);
  app = initializeApp({ projectId: PROJECT_ID }, "cp-club-mirror-emulator-" + Date.now());
  db = getFirestore(app);
  cpDb = getFirestore(app, CP_DATABASE_ID);
});

afterAll(async () => { if (app) await deleteApp(app); });

async function clearAll() {
  for (const [store, col] of [[db, "teams"], [cpDb, "cpClubs"]]) {
    const snap = await store.collection(col).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

beforeEach(async () => {
  await clearAll();
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-club-mirror-emu-"));
});
afterEach(() => { fs.rmSync(outDir, { recursive: true, force: true }); });

const handler = () => createOnTeamWrittenForCompetitionsHandler({ db, getCpDb: () => cpDb, FieldValue, logger, env: ENV });

async function writeTeamAndEvent(teamId, after) {
  const ref = db.collection("teams").doc(teamId);
  const before = await ref.get();
  if (after === null) await ref.delete(); else await ref.set(after);
  const afterSnap = await ref.get();
  return { params: { teamId }, time: new Date().toISOString(), data: { before, after: afterSnap } };
}

const mirrorOf = async (teamId) => (await cpDb.collection("cpClubs").doc(teamId).get());

describe("觸發器 handler × 真 Emulator（跨庫）", () => {
  test("seed 文件被整份重寫：欄位剩四個、srcUpdatedAt 是伺服器時間、image 依 D9", async () => {
    const id = "tm_emu_seed_1";
    await cpDb.collection("cpClubs").doc(id).set({ repUids: ["U_cap"], name: "隊", image: null, srcUpdatedAt: Timestamp.fromMillis(1), seededBy: "g4-seed" });
    await db.collection("teams").doc(id).set({ captainUid: "U_cap", name: "舊名" });
    const event = await writeTeamAndEvent(id, { captainUid: "U_cap", name: "隊", imageVariants: { card: "https://example.com/c.png", cover: ASIA_URL("cover.webp") } });
    await expect(handler()(event)).resolves.toEqual({ status: "set" });
    const snap = await mirrorOf(id);
    expect(Object.keys(snap.data()).sort()).toEqual(["image", "name", "repUids", "srcUpdatedAt"]);
    expect(snap.get("image")).toBe(ASIA_URL("cover.webp"));
    expect(snap.get("srcUpdatedAt")).toBeInstanceOf(Timestamp);
    expect(snap.get("srcUpdatedAt").toMillis()).toBeGreaterThan(1);
    expect((await cpDb.collection("cpClubs").where("seededBy", "==", "g4-seed").count().get()).data().count).toBe(0);
  });

  test("D4：建立 → 代表全移除（空名單）→ 再加代表 → 刪隊（刪鏡像）；無代表新隊不建", async () => {
    const id = "tm_emu_d4_1";
    const h = handler();
    await expect(h(await writeTeamAndEvent(id, { captainUid: "U_a", leaderUids: ["U_b"], name: "隊" }))).resolves.toEqual({ status: "set" });
    expect((await mirrorOf(id)).get("repUids")).toEqual(["U_a", "U_b"]);
    await expect(h(await writeTeamAndEvent(id, { name: "隊", coachUids: ["U_a"] }))).resolves.toEqual({ status: "set" });
    expect((await mirrorOf(id)).get("repUids")).toEqual([]);
    await expect(h(await writeTeamAndEvent(id, { name: "隊", ownerUid: "U_c" }))).resolves.toEqual({ status: "set" });
    expect((await mirrorOf(id)).get("repUids")).toEqual(["U_c"]);
    await expect(h(await writeTeamAndEvent(id, null))).resolves.toEqual({ status: "delete" });
    expect((await mirrorOf(id)).exists).toBe(false);
    await expect(h(await writeTeamAndEvent("tm_emu_d4_2", { name: "無代表" }))).resolves.toEqual({ status: "skip-no-reps" });
    expect((await mirrorOf("tm_emu_d4_2")).exists).toBe(false);
  });

  test("重送與並發：同一事件 5 次並發、結果只由主站現況決定", async () => {
    const id = "tm_emu_dup_1";
    const event = await writeTeamAndEvent(id, { captainUid: "U_a", name: "隊" });
    await db.collection("teams").doc(id).set({ captainUid: "U_new", name: "新隊" });
    const results = await Promise.all(Array.from({ length: 5 }, () => handler()(event)));
    expect(results.filter((r) => r.status === "set").length).toBeGreaterThanOrEqual(1);
    const snap = await mirrorOf(id);
    expect(snap.get("repUids")).toEqual(["U_new"]);
    expect(snap.get("name")).toBe("新隊");
    const updateTime = snap.updateTime;
    await expect(handler()(event)).resolves.toEqual({ status: "none" });
    expect((await mirrorOf(id)).updateTime.isEqual(updateTime)).toBe(true);
  });
});

describe("回填 × 真 Emulator", () => {
  async function seedWorld() {
    await db.collection("teams").doc("tm_emu_bf_a").set({ captainUid: "U_a", name: "甲", image: ASIA_URL("a.webp") });
    await db.collection("teams").doc("tm_emu_bf_b").set({ leaderUids: ["U_b"], name: "乙" });
    await db.collection("teams").doc("tm_emu_bf_seed").set({ creatorUid: "U_s", name: "種子" });
    await db.collection("teams").doc("tm_emu_bf_none").set({ name: "無代表" });
    await cpDb.collection("cpClubs").doc("tm_emu_bf_seed").set({ repUids: ["U_s"], name: "種子", image: null, srcUpdatedAt: Timestamp.fromMillis(5), seededBy: "g4-seed" });
    await cpDb.collection("cpClubs").doc("tm_emu_bf_orphan").set({ repUids: ["U_o"], name: "孤兒", image: null, srcUpdatedAt: Timestamp.fromMillis(5) });
  }

  test("dry-run → execute（含觸發器搶先、前置條件略過）→ 讀回 → 回退還原", async () => {
    await seedWorld();
    const state = await loadState({ db, cpDb, teamIds: null });
    const plan = buildPlan({ ...state, buckets: BUCKETS });
    expect(plan.entries.map((e) => [e.id, e.op])).toEqual([
      ["tm_emu_bf_a", "create"], ["tm_emu_bf_b", "create"], ["tm_emu_bf_orphan", "delete"], ["tm_emu_bf_seed", "update"],
    ]);
    // 在 execute 的每筆 transaction 前插入「觸發器」寫入：b 搶先建立、orphan 被改過
    let injected = false;
    const racingCpDb = {
      collection: (...a) => cpDb.collection(...a),
      runTransaction: async (fn) => {
        if (!injected) {
          injected = true;
          await cpDb.collection("cpClubs").doc("tm_emu_bf_b").set({ repUids: ["U_b"], name: "乙", image: null, srcUpdatedAt: FieldValue.serverTimestamp() });
          await cpDb.collection("cpClubs").doc("tm_emu_bf_orphan").set({ repUids: ["U_o2"], name: "孤兒", image: null, srcUpdatedAt: FieldValue.serverTimestamp() });
        }
        return cpDb.runTransaction(fn);
      },
    };
    const args = { execute: true, teamIds: null, confirmCount: plan.entries.length, planHash: plan.planHash, outDir };
    const res = await runExecute({ db, cpDb: racingCpDb, FieldValue, args, buckets: BUCKETS, log: () => {} });
    expect(res).toMatchObject({ applied: 2, skipped: 2, readbackMismatch: 0, seedLeft: 0 });
    expect((await mirrorOf("tm_emu_bf_a")).get("image")).toBe(ASIA_URL("a.webp"));
    expect(Object.keys((await mirrorOf("tm_emu_bf_seed")).data()).sort()).toEqual(["image", "name", "repUids", "srcUpdatedAt"]);
    expect((await mirrorOf("tm_emu_bf_orphan")).get("repUids")).toEqual(["U_o2"]);
    expect((await mirrorOf("tm_emu_bf_none")).exists).toBe(false);

    const back = await runRollback({ cpDb, Timestamp, args: { backup: res.backupFile, execute: true, confirmCount: 2 }, log: () => {} });
    expect(back.executed).toBe(2);
    expect((await mirrorOf("tm_emu_bf_a")).exists).toBe(false);
    const seed = await mirrorOf("tm_emu_bf_seed");
    expect(seed.get("seededBy")).toBe("g4-seed");
    expect(seed.get("srcUpdatedAt").toMillis()).toBe(5);
  });

  test("P2-1：loadState 後代表被移除（觸發器判 skip-no-reps 不寫）→ 回填重讀主站、不寫舊代表（skip-team-changed）", async () => {
    await seedWorld();
    const state = await loadState({ db, cpDb, teamIds: null });
    const plan = buildPlan({ ...state, buckets: BUCKETS });
    expect(plan.entries.find((e) => e.id === "tm_emu_bf_a").doc.repUids).toEqual(["U_a"]);
    let injected = false;
    const racingCpDb = {
      collection: (...a) => cpDb.collection(...a),
      runTransaction: async (fn) => {
        if (!injected) {
          injected = true;
          // 主站移除隊長 A，觸發器照現況判斷（無鏡像＋無代表 → 不寫）
          const event = await writeTeamAndEvent("tm_emu_bf_a", { name: "甲", image: ASIA_URL("a.webp") });
          await expect(handler()(event)).resolves.toEqual({ status: "skip-no-reps" });
          // 主站改了 seed 隊的代表，觸發器尚未跑（模擬延遲）
          await db.collection("teams").doc("tm_emu_bf_seed").set({ name: "種子", coachUids: ["U_s"] });
        }
        return cpDb.runTransaction(fn);
      },
    };
    const args = { execute: true, teamIds: null, confirmCount: plan.entries.length, planHash: plan.planHash, outDir };
    const res = await runExecute({ db, cpDb: racingCpDb, FieldValue, args, buckets: BUCKETS, log: () => {} });
    const record = JSON.parse(fs.readFileSync(res.backupFile, "utf8"));
    expect(record.skipped).toEqual([
      { id: "tm_emu_bf_a", op: "create", reason: "skip-team-changed" },
      { id: "tm_emu_bf_seed", op: "update", reason: "skip-team-changed" },
    ]);
    expect((await mirrorOf("tm_emu_bf_a")).exists).toBe(false);
    expect((await mirrorOf("tm_emu_bf_b")).get("repUids")).toEqual(["U_b"]);
    expect((await mirrorOf("tm_emu_bf_orphan")).exists).toBe(false);
    // seed 文件未被回填改寫成舊代表（仍是原狀），之後由觸發器依現況處理
    expect((await mirrorOf("tm_emu_bf_seed")).get("seededBy")).toBe("g4-seed");
  });

  test("回退預設略過回填後又被改過的文件", async () => {
    await seedWorld();
    const state = await loadState({ db, cpDb, teamIds: null });
    const plan = buildPlan({ ...state, buckets: BUCKETS });
    const args = { execute: true, teamIds: null, confirmCount: plan.entries.length, planHash: plan.planHash, outDir };
    const res = await runExecute({ db, cpDb, FieldValue, args, buckets: BUCKETS, log: () => {} });
    expect(res.applied).toBe(4);
    const event = await writeTeamAndEvent("tm_emu_bf_a", { captainUid: "U_a2", name: "甲" });
    await expect(handler()(event)).resolves.toEqual({ status: "set" });
    const dry = await runRollback({ cpDb, Timestamp, args: { backup: res.backupFile, execute: false }, log: () => {} });
    expect(dry).toMatchObject({ changedSince: 1, toApply: 3 });
    const done = await runRollback({ cpDb, Timestamp, args: { backup: res.backupFile, execute: true, confirmCount: 3 }, log: () => {} });
    expect(done).toMatchObject({ executed: 3, skipped: 1 });
    expect((await mirrorOf("tm_emu_bf_a")).get("repUids")).toEqual(["U_a2"]);
    expect((await mirrorOf("tm_emu_bf_seed")).get("seededBy")).toBe("g4-seed");
    expect((await mirrorOf("tm_emu_bf_orphan")).get("repUids")).toEqual(["U_o"]);
  });

  test("雜湊不符拒絕、不寫", async () => {
    await seedWorld();
    const args = { execute: true, teamIds: null, confirmCount: 4, planHash: "0".repeat(64), outDir };
    await expect(runExecute({ db, cpDb, FieldValue, args, buckets: BUCKETS, log: () => {} })).rejects.toThrow("PLAN_HASH_MISMATCH");
    expect((await mirrorOf("tm_emu_bf_a")).exists).toBe(false);
  });
});
