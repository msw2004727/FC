"use strict";

// G4 俱樂部鏡像回填腳本（functions/cp-club-mirror-backfill.js）：假 Firestore 驗 dry-run 數字、雜湊／筆數不符拒絕、
// create 衝突略過、前置條件（updateTime）略過、收編 seed、孤兒刪除、讀回、備份與回退。不連任何真實環境。

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildPlan,
  deserialize,
  formatPlanReport,
  independentRepUids,
  loadState,
  parseArgs,
  runDryRun,
  runExecute,
  runRollback,
  serialize,
} = require("../../functions/cp-club-mirror-backfill");
const { repUidsFromTeam } = require("../../functions/cp-club-mirror");

const REP_VECTORS = require("../fixtures/cp-rep-vectors.json").vectors;
const BUCKETS = ["fc-football-6c8dc-asia-east1", "fc-football-6c8dc.firebasestorage.app"];
const ASIA_URL = (name) => `https://firebasestorage.googleapis.com/v0/b/fc-football-6c8dc-asia-east1/o/${name}`;
const SERVER_TS = { __serverTimestamp: true };
const FieldValue = { serverTimestamp: () => SERVER_TS };

class FakeTimestamp {
  constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  toDate() { return new Date(this.seconds * 1000); }
  isEqual(other) { return !!other && other.seconds === this.seconds && other.nanoseconds === this.nanoseconds; }
}

function createWorld({ teams = {}, clubs = {} } = {}) {
  let clock = 1000;
  const store = { teams: {}, cpClubs: {} };
  const put = (col, id, data) => { clock += 1; store[col][id] = { data: JSON.parse(JSON.stringify(data)), updateTime: new FakeTimestamp(clock, 0) }; };
  Object.entries(teams).forEach(([id, d]) => put("teams", id, d));
  Object.entries(clubs).forEach(([id, d]) => put("cpClubs", id, d));
  const hooks = { beforeTx: null, failOnTx: null };
  const counters = { reads: 0, writes: 0 };
  const snapOf = (col, id) => {
    const e = store[col][id];
    return { id, exists: !!e, updateTime: e ? e.updateTime : undefined, data: () => (e ? JSON.parse(JSON.stringify(e.data)) : undefined) };
  };
  const makeDb = (col0) => ({
    collection: (col) => ({
      doc: (id) => ({ col, id, get: async () => { counters.reads += 1; return snapOf(col, id); } }),
      select: (...fields) => ({
        get: async () => ({
          docs: Object.keys(store[col]).map((id) => {
            counters.reads += 1;
            const s = snapOf(col, id);
            const full = s.data();
            const picked = {};
            fields.forEach((f) => { if (Object.prototype.hasOwnProperty.call(full, f)) picked[f] = full[f]; });
            return { ...s, data: () => picked };
          }),
        }),
      }),
      get: async () => ({ docs: Object.keys(store[col]).map((id) => { counters.reads += 1; return snapOf(col, id); }) }),
      where: (field, op, value) => ({
        count: () => ({
          get: async () => ({ data: () => ({ count: Object.values(store[col]).filter((e) => e.data[field] === value).length }) }),
        }),
      }),
    }),
    runTransaction: async (fn) => {
      if (col0 !== "cp") throw new Error("transactions only on cpDb in tests");
      const pending = [];
      const tx = {
        get: async (ref) => {
          if (hooks.beforeTx) hooks.beforeTx(ref.id, { put, store });
          counters.reads += 1;
          return snapOf(ref.col, ref.id);
        },
        set: (ref, data, options) => pending.push(["set", ref, data, options]),
        delete: (ref) => pending.push(["delete", ref]),
      };
      const result = await fn(tx);
      if (hooks.failOnTx) hooks.failOnTx();
      for (const [op, ref, data, options] of pending) {
        counters.writes += 1;
        if (op === "set") {
          if (options !== undefined) throw new Error("set must not carry options (no merge)");
          put(ref.col, ref.id, data);
        } else {
          delete store[ref.col][ref.id];
        }
      }
      return result;
    },
  });
  return { store, hooks, counters, put, db: makeDb("main"), cpDb: makeDb("cp") };
}

const SEED_A = "tm_1777088574910_seedaa";
const SEED_B = "tm_1777087499329_seedbb";

function baseWorld() {
  return createWorld({
    teams: {
      tm_a: { captainUid: "U_cap_a", name: "甲隊", imageVariants: { card: ASIA_URL("a.webp") } },
      tm_b: { leaderUids: ["U_l1", "U_l2"], name: "乙隊", image: "https://example.com/x.png" },
      tm_noreps: { name: "無代表", coachUids: ["U_coach"] },
      tm_cleared: { name: "代表被移除" },
      tm_same: { ownerUid: "U_own", name: "同隊" },
      [SEED_A]: { captainUid: "U_seed", name: "種子甲", imageVariants: { card: ASIA_URL("s.webp") } },
      [SEED_B]: { creatorUid: "U_seed2", name: "種子乙" },
      "bad id!": { captainUid: "U_bad" },
      tm_mismatch: { id: "tm_other", captainUid: "U_mm", name: "id 不同" },
    },
    clubs: {
      tm_cleared: { repUids: ["U_gone"], name: "代表被移除", image: null, srcUpdatedAt: 1 },
      tm_same: { repUids: ["U_own"], name: "同隊", image: null, srcUpdatedAt: 1 },
      [SEED_A]: { repUids: ["U_seed"], name: "種子甲", image: null, srcUpdatedAt: 1, seededBy: "g4-seed" },
      [SEED_B]: { repUids: ["U_seed2"], name: "種子乙", image: null, srcUpdatedAt: 1, seededBy: "g4-seed" },
      tm_orphan: { repUids: ["U_o"], name: "孤兒", image: null, srcUpdatedAt: 1 },
    },
  });
}

let outDir;
beforeEach(() => { outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-club-mirror-backfill-")); });
afterEach(() => { fs.rmSync(outDir, { recursive: true, force: true }); });

async function dryRunPlan(world, teamIds = null) {
  const state = await loadState({ db: world.db, cpDb: world.cpDb, teamIds });
  return { state, plan: buildPlan({ ...state, buckets: BUCKETS }) };
}

function execArgs(plan, extra = {}) {
  return { execute: true, teamIds: null, confirmCount: plan.entries.length, planHash: plan.planHash, outDir, ...extra };
}

describe("parseArgs", () => {
  const argv = (...a) => ["node", "x", ...a];
  test("預設 dry-run；execute 必須帶筆數與雜湊", () => {
    expect(parseArgs(argv(), {}).mode).toBe("dry-run");
    expect(() => parseArgs(argv("--execute"), {})).toThrow("EXECUTE_REQUIRES_COUNT_AND_HASH");
    expect(() => parseArgs(argv("--execute", "--confirm-count", "3"), {})).toThrow("EXECUTE_REQUIRES_COUNT_AND_HASH");
    expect(() => parseArgs(argv("--confirm-count", "3"), {})).toThrow("COUNT_AND_HASH_REQUIRE_EXECUTE");
    expect(parseArgs(argv("--execute", "--confirm-count", "3", "--plan-hash", "a".repeat(64), "--out", outDir), {}).mode).toBe("execute");
  });
  test("拒絕金鑰檔、不合格 teamId、雜湊格式錯、非 local-only 輸出目錄、未知旗標", () => {
    expect(() => parseArgs(argv(), { GOOGLE_APPLICATION_CREDENTIALS: "k.json" })).toThrow("KEY_FILE_NOT_ALLOWED");
    expect(() => parseArgs(argv("--team", "ok,bad id"), {})).toThrow("INVALID_TEAM_ID");
    expect(() => parseArgs(argv("--execute", "--confirm-count", "1", "--plan-hash", "xyz"), {})).toThrow("INVALID_PLAN_HASH");
    expect(() => parseArgs(argv("--out", path.parse(process.cwd()).root), {})).toThrow("OUT_NOT_LOCAL_ONLY");
    expect(() => parseArgs(argv("--scope", "members"), {})).toThrow("UNKNOWN_FLAG");
  });
  test("回退：必須帶備份；execute 必須帶筆數；不能混 --team／--plan-hash", () => {
    expect(() => parseArgs(argv("--rollback"), {})).toThrow("ROLLBACK_REQUIRES_BACKUP");
    expect(parseArgs(argv("--rollback", "--backup", "b.json"), {}).mode).toBe("rollback-dry-run");
    expect(() => parseArgs(argv("--rollback", "--backup", "b.json", "--execute"), {})).toThrow("ROLLBACK_EXECUTE_REQUIRES_CONFIRM_COUNT");
    expect(() => parseArgs(argv("--rollback", "--backup", "b.json", "--team", "tm_a"), {})).toThrow("ROLLBACK_FLAG_CONFLICT");
    expect(() => parseArgs(argv("--backup", "b.json"), {})).toThrow("BACKUP_REQUIRES_ROLLBACK");
  });
});

describe("dry-run 計畫", () => {
  test("數字：create／update／收編／清空／相同／孤兒／跳過／data.id 不同", async () => {
    const world = baseWorld();
    const { plan } = await dryRunPlan(world);
    expect(plan.stats).toMatchObject({
      teamsRead: 9, mirrorsRead: 5, skipBadId: 1, skipNoReps: 1, dataIdMismatch: 1,
      create: 3, update: 3, adopt: 2, clearReps: 1, same: 1, orphan: 1, independentMismatch: 0,
    });
    expect(plan.entries.map((e) => [e.id, e.op])).toEqual([
      [SEED_B, "update"], [SEED_A, "update"], ["tm_a", "create"], ["tm_b", "create"],
      ["tm_cleared", "update"], ["tm_mismatch", "create"], ["tm_orphan", "delete"],
    ]);
    const cleared = plan.entries.find((e) => e.id === "tm_cleared");
    expect(cleared.doc).toEqual({ repUids: [], name: "代表被移除", image: null });
    expect(plan.entries.find((e) => e.id === "tm_b").doc.image).toBeNull();
    expect(world.counters.writes).toBe(0);
  });

  test("雜湊只由要寫的內容決定、重算相同；內容變了雜湊就變", async () => {
    const world = baseWorld();
    const first = (await dryRunPlan(world)).plan.planHash;
    expect((await dryRunPlan(world)).plan.planHash).toBe(first);
    world.put("teams", "tm_a", { captainUid: "U_cap_a2", name: "甲隊" });
    expect((await dryRunPlan(world)).plan.planHash).not.toBe(first);
  });

  test("報告：遮罩 teamId／uid、列收編兩份逐欄差異與抽樣、不印 image 網址原文", async () => {
    const world = baseWorld();
    const lines = [];
    const { red } = await runDryRun({ db: world.db, cpDb: world.cpDb, args: { teamIds: null }, buckets: BUCKETS, log: (l) => lines.push(l) });
    const text = lines.join("\n");
    expect(red).toBe(false);
    expect(text).toMatch(/計畫雜湊 sha256=[0-9a-f]{64}/);
    expect(text).toContain("寫入筆數 7");
    expect(text).toContain("seededBy=g4-seed 2 份");
    expect(text).toContain("收編非四欄文件 2");
    expect(text).toContain("tm_1777088574…");
    expect(text).toContain("tm_1777087499…");
    expect(text).toContain("seededBy：有 → 移除");
    expect(text).toMatch(/image：不同（null null → fc-football-6c8dc-asia-east1 #[0-9a-f]{8}）/);
    expect(text).toMatch(/抽樣 8 筆/);
    expect(text).not.toContain("U_cap_a");
    expect(text).not.toContain("U_seed2");
    expect(text).not.toContain(SEED_A);
    expect(text).not.toContain("a.webp");
    expect(text).not.toContain("!!不一致!!");
  });

  test("白名單空：報告標紅", async () => {
    const world = baseWorld();
    const lines = [];
    const { red } = await runDryRun({ db: world.db, cpDb: world.cpDb, args: { teamIds: null }, buckets: [], log: (l) => lines.push(l) });
    expect(red).toBe(true);
    expect(lines[0]).toContain("標紅");
  });

  test("--team 只讀指定隊（主站隊伍不存在而鏡像存在 → 刪）", async () => {
    const world = baseWorld();
    const { plan } = await dryRunPlan(world, ["tm_a", "tm_orphan", "tm_same"]);
    expect(plan.entries.map((e) => [e.id, e.op])).toEqual([["tm_a", "create"], ["tm_orphan", "delete"]]);
    expect(plan.stats.teamsRead).toBe(2);
  });

  test("獨立重寫版與 repUidsFromTeam 在共用向量上一致", () => {
    for (const v of REP_VECTORS) expect(independentRepUids(v.team)).toEqual(repUidsFromTeam(v.team));
  });

  test("獨立重寫版不一致時標紅（模擬實作漂移）", () => {
    const state = { teams: new Map([["tm_x", { captainUid: "U_x" }]]), mirrors: new Map() };
    const plan = buildPlan({ ...state, buckets: BUCKETS });
    plan.stats.independentMismatch = 1;
    expect(formatPlanReport({ plan, ...state, buckets: BUCKETS }).red).toBe(true);
  });
});

describe("execute", () => {
  test("雜湊或筆數不符 → 拒絕、不寫", async () => {
    const world = baseWorld();
    const { plan } = await dryRunPlan(world);
    const log = () => {};
    await expect(runExecute({ db: world.db, cpDb: world.cpDb, FieldValue, args: execArgs(plan, { planHash: "0".repeat(64) }), buckets: BUCKETS, log }))
      .rejects.toThrow("PLAN_HASH_MISMATCH");
    await expect(runExecute({ db: world.db, cpDb: world.cpDb, FieldValue, args: execArgs(plan, { confirmCount: 6 }), buckets: BUCKETS, log }))
      .rejects.toThrow("CONFIRM_COUNT_MISMATCH");
    await expect(runExecute({ db: world.db, cpDb: world.cpDb, FieldValue, args: execArgs(plan), buckets: [], log }))
      .rejects.toThrow("LOGO_BUCKETS_EMPTY");
    expect(world.counters.writes).toBe(0);
  });

  test("寫入、收編 seed（欄位剩四個）、刪孤兒、讀回、seededBy 計數 0、備份檔", async () => {
    const world = baseWorld();
    const { plan } = await dryRunPlan(world);
    const lines = [];
    const res = await runExecute({ db: world.db, cpDb: world.cpDb, FieldValue, args: execArgs(plan), buckets: BUCKETS, log: (l) => lines.push(l) });
    expect(res).toMatchObject({ applied: 7, skipped: 0, readbackMismatch: 0, seedLeft: 0 });
    for (const id of [SEED_A, SEED_B, "tm_a", "tm_cleared"]) {
      expect(Object.keys(world.store.cpClubs[id].data).sort()).toEqual(["image", "name", "repUids", "srcUpdatedAt"]);
    }
    expect(world.store.cpClubs[SEED_A].data.image).toBe(ASIA_URL("s.webp"));
    expect(world.store.cpClubs.tm_cleared.data.repUids).toEqual([]);
    expect(world.store.cpClubs.tm_orphan).toBeUndefined();
    expect(world.store.cpClubs.tm_noreps).toBeUndefined();
    const record = JSON.parse(fs.readFileSync(res.backupFile, "utf8"));
    expect(record.finished).toBe(true);
    expect(record.applied).toHaveLength(7);
    expect(Object.keys(record.before).sort()).toEqual([SEED_B, SEED_A, "tm_cleared", "tm_orphan", "tm_same"].sort());
    expect(record.before[SEED_A].seededBy).toBe("g4-seed");
    expect(lines.join("\n")).not.toContain("U_seed");
  });

  test("觸發器搶先建立 → create 略過；觸發器先改過 → update／delete 前置條件略過", async () => {
    const world = baseWorld();
    const { plan } = await dryRunPlan(world);
    world.hooks.beforeTx = (id, { put }) => {
      if (id === "tm_a") put("cpClubs", "tm_a", { repUids: ["U_cap_a"], name: "甲隊", image: null, srcUpdatedAt: 2 });
      if (id === "tm_cleared") put("cpClubs", "tm_cleared", { repUids: [], name: "代表被移除", image: null, srcUpdatedAt: 2 });
      if (id === "tm_orphan") put("cpClubs", "tm_orphan", { repUids: ["U_o2"], name: "孤兒", image: null, srcUpdatedAt: 2 });
    };
    const res = await runExecute({ db: world.db, cpDb: world.cpDb, FieldValue, args: execArgs(plan), buckets: BUCKETS, log: () => {} });
    expect(res).toMatchObject({ applied: 4, skipped: 3 });
    const record = JSON.parse(fs.readFileSync(res.backupFile, "utf8"));
    expect(record.skipped).toEqual([
      { id: "tm_a", op: "create", reason: "skip-exists" },
      { id: "tm_cleared", op: "update", reason: "skip-changed" },
      { id: "tm_orphan", op: "delete", reason: "skip-changed" },
    ]);
    expect(world.store.cpClubs.tm_a.data.srcUpdatedAt).toBe(2);
    expect(world.store.cpClubs.tm_orphan.data.repUids).toEqual(["U_o2"]);
  });

  test("中途失敗即停，備份檔保留已寫入清單（finished=false）", async () => {
    const world = baseWorld();
    const { plan } = await dryRunPlan(world);
    let n = 0;
    world.hooks.failOnTx = () => { n += 1; if (n === 3) throw Object.assign(new Error("unavailable"), { code: 14 }); };
    await expect(runExecute({ db: world.db, cpDb: world.cpDb, FieldValue, args: execArgs(plan), buckets: BUCKETS, log: () => {} }))
      .rejects.toThrow("unavailable");
    const file = fs.readdirSync(outDir).find((f) => f.startsWith("cp-club-mirror-backup-"));
    const record = JSON.parse(fs.readFileSync(path.join(outDir, file), "utf8"));
    expect(record.finished).toBe(false);
    expect(record.applied).toHaveLength(2);
  });
});

describe("rollback", () => {
  test("dry-run 只列計畫；execute 依備份還原原文（含 seed）、刪除本次新建", async () => {
    const world = baseWorld();
    const beforeClubs = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(world.store.cpClubs).map(([id, e]) => [id, e.data]))));
    const { plan } = await dryRunPlan(world);
    const res = await runExecute({ db: world.db, cpDb: world.cpDb, FieldValue, args: execArgs(plan), buckets: BUCKETS, log: () => {} });
    const lines = [];
    const dry = await runRollback({ cpDb: world.cpDb, Timestamp: FakeTimestamp, args: { backup: res.backupFile, execute: false }, log: (l) => lines.push(l) });
    expect(dry).toEqual({ planned: 7, changedSince: 0, executed: 0 });
    await expect(runRollback({ cpDb: world.cpDb, Timestamp: FakeTimestamp, args: { backup: res.backupFile, execute: true, confirmCount: 6 }, log: () => {} }))
      .rejects.toThrow("CONFIRM_COUNT_MISMATCH");
    const done = await runRollback({ cpDb: world.cpDb, Timestamp: FakeTimestamp, args: { backup: res.backupFile, execute: true, confirmCount: 7 }, log: () => {} });
    expect(done.executed).toBe(7);
    const afterClubs = Object.fromEntries(Object.entries(world.store.cpClubs).map(([id, e]) => [id, e.data]));
    expect(afterClubs).toEqual(beforeClubs);
  });

  test("備份序列化保留 Timestamp、拒絕其他特殊型別", () => {
    const data = { a: new FakeTimestamp(5, 6), list: [1, "x", { b: null }] };
    const round = deserialize(JSON.parse(JSON.stringify(serialize(data))), FakeTimestamp);
    expect(round.a).toBeInstanceOf(FakeTimestamp);
    expect(round).toEqual(data);
    expect(() => serialize({ ref: new Map() })).toThrow("UNSUPPORTED_BACKUP_VALUE");
  });
});
