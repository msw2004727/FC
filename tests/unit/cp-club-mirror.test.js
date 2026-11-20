"use strict";

// G4 賽事俱樂部鏡像（顧問 §3.372 方案 a）：純函式、代表定義防漂移、隊徽白名單共用向量（D9）、
// D4 有／無代表轉換、觸發器 handler（假 Firestore）。模擬器實測見 tests/emulator/cp-club-mirror-emulator.test.js。

const fs = require("fs");
const path = require("path");

const mirror = require("../../functions/cp-club-mirror");
const {
  REP_FIELDS,
  REP_LIST_FIELD,
  REP_STRING_FIELDS,
  MAX_EVENT_AGE_MS,
  TRIGGER_OPTIONS,
  allowedLogoBuckets,
  clubMirrorFromTeam,
  createOnTeamWrittenForCompetitionsHandler,
  needsWrite,
  pickTeamImage,
  planMirrorAction,
  repUidsFromTeam,
  teamLogoOf,
} = mirror;

const ROOT = path.resolve(__dirname, "..", "..");
const REP_VECTORS = require("../fixtures/cp-rep-vectors.json").vectors;
const LOGO = require("../fixtures/cp-logo-vectors.json");
const BOTH = LOGO.bucketSets.both;
const ASIA_URL = (name) => `https://firebasestorage.googleapis.com/v0/b/fc-football-6c8dc-asia-east1/o/${name}`;

function logoRaw(vector) {
  if (!vector.rawRepeat) return vector.raw;
  const { prefix, char, totalLength } = vector.rawRepeat;
  return prefix + char.repeat(totalLength - prefix.length);
}

// ── 代表定義防漂移：比對主站 firestore.rules 原文 ─────────────────────────────
describe("代表定義與主站 Rules isCurrentUserTeamCaptainOrLeader 一致（防漂移）", () => {
  const rules = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8").replace(/\r\n/g, "\n");
  const start = rules.indexOf("function isCurrentUserTeamCaptainOrLeader(teamId) {");
  const end = rules.indexOf("\n    }\n", start);
  const body = rules.slice(start, end);

  // 顧問 Opus 審 P3-1：只抓「比對 request.auth.uid」的條件會漏掉 `isAdmin() ||`、改呼叫其他 helper 等改動；
  // 改成整段 helper 去註解、空白收斂後全文比對，期望文字由 REP_STRING_FIELDS／REP_LIST_FIELD 組出來。
  // Rules 的這段 helper 有任何語意改動（含加條件、換 helper、改欄位）都會紅；改了 Rules 要同步改鏡像模組與本測試。
  function normalizeRules(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/\s+/g, " ").trim();
  }
  function expectedHelperText() {
    const clause = (f) => `(get(teamPath).data.keys().hasAny(['${f}']) && (get(teamPath).data.${f} is string) && get(teamPath).data.${f} == request.auth.uid)`;
    const listClause = `(get(teamPath).data.keys().hasAny(['${REP_LIST_FIELD}']) && (get(teamPath).data.${REP_LIST_FIELD} is list) && request.auth.uid in get(teamPath).data.${REP_LIST_FIELD})`;
    return "function isCurrentUserTeamCaptainOrLeader(teamId) { let teamPath = /databases/$(database)/documents/teams/$(teamId); "
      + "return isAuth() && teamId is string && exists(teamPath) && ( "
      + [...REP_STRING_FIELDS.map(clause), listClause].join(" || ")
      + " ); }";
  }
  const helperText = (src) => {
    const s = src.indexOf("function isCurrentUserTeamCaptainOrLeader(teamId) {");
    return normalizeRules(src.slice(s, src.indexOf("\n    }\n", s) + 6));
  };

  // 只改 helper 這一段（其他 helper 也有 `return isAuth()` 等相同字串，不能整檔 replace）
  const rawHelperEnd = end + 6;
  const mutateHelper = (fn) => rules.slice(0, start) + fn(rules.slice(start, rawHelperEnd)) + rules.slice(rawHelperEnd);

  test("整段 helper 全文比對（去註解、收斂空白）與鏡像模組欄位組出的期望完全相同", () => {
    expect(helperText(rules)).toBe(expectedHelperText());
  });

  test.each([
    ["加 isAdmin() ||", (b) => b.replace("return isAuth()", "return isAdmin() || isAuth()")],
    ["改呼叫其他 helper", (b) => b.replace("exists(teamPath)", "exists(teamPath) && isTeamActive(teamId)")],
    ["多一個欄位", (b) => b.replace("|| (get(teamPath).data.keys().hasAny(['leaderUids'])", "|| (get(teamPath).data.keys().hasAny(['coachUid']) && (get(teamPath).data.coachUid is string) && get(teamPath).data.coachUid == request.auth.uid) || (get(teamPath).data.keys().hasAny(['leaderUids'])")],
    ["型別條件改寬", (b) => b.replace("(get(teamPath).data.ownerUid is string)", "true")],
    ["刪一個欄位", (b) => b.replace(/\s*\|\| \(get\(teamPath\)\.data\.keys\(\)\.hasAny\(\['creatorUid'\]\)[^\n]*/, "")],
  ])("Rules 被改（%s）全文比對會紅", (_name, mutate) => {
    const mutated = mutateHelper(mutate);
    expect(mutated).not.toBe(rules);
    expect(helperText(mutated)).not.toBe(expectedHelperText());
  });

  test("只改縮排與註解不影響全文比對", () => {
    const reformatted = mutateHelper((b) => b.replace("return isAuth()", "// 註解\n      return   isAuth()"));
    expect(reformatted).not.toBe(rules);
    expect(helperText(reformatted)).toBe(expectedHelperText());
  });

  test("Rules 內找得到 helper 本文", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(body).toContain("isAuth()");
    expect(body).toContain("exists(teamPath)");
  });

  test("字串欄位與清單欄位都和 REP_STRING_FIELDS／REP_LIST_FIELD 相同，且沒有其他條件", () => {
    const stringRe = /get\(teamPath\)\.data\.keys\(\)\.hasAny\(\['(\w+)'\]\)\s*&&\s*\(get\(teamPath\)\.data\.(\w+) is string\)\s*&&\s*get\(teamPath\)\.data\.(\w+) == request\.auth\.uid/g;
    const listRe = /get\(teamPath\)\.data\.keys\(\)\.hasAny\(\['(\w+)'\]\)\s*&&\s*\(get\(teamPath\)\.data\.(\w+) is list\)\s*&&\s*request\.auth\.uid in get\(teamPath\)\.data\.(\w+)/g;
    const stringFields = [...body.matchAll(stringRe)].map((m) => {
      expect(new Set([m[1], m[2], m[3]]).size).toBe(1);
      return m[1];
    });
    const listFields = [...body.matchAll(listRe)].map((m) => {
      expect(new Set([m[1], m[2], m[3]]).size).toBe(1);
      return m[1];
    });
    expect([...stringFields].sort()).toEqual([...REP_STRING_FIELDS].sort());
    expect(listFields).toEqual([REP_LIST_FIELD]);
    // 每個比對 request.auth.uid 的條件都要被上面兩種樣式認出來，不能多出別的代表來源
    expect((body.match(/request\.auth\.uid/g) || []).length).toBe(stringFields.length + listFields.length);
    expect(REP_FIELDS).toEqual([...REP_STRING_FIELDS, REP_LIST_FIELD]);
    expect(body).not.toMatch(/coach/i);
  });
});

describe("代表共用向量 tests/fixtures/cp-rep-vectors.json", () => {
  test.each(REP_VECTORS.map((v) => [v.name, v]))("%s", (_name, v) => {
    const reps = repUidsFromTeam(v.team);
    expect(reps).toEqual([...v.reps].sort());
    for (const uid of v.nonReps) expect(reps).not.toContain(uid);
    expect(clubMirrorFromTeam(v.team, { buckets: BOTH }).repUids).toEqual(reps);
  });

  test("向量本身：reps 已排序、與 nonReps 不重疊", () => {
    for (const v of REP_VECTORS) {
      expect(v.reps).toEqual([...v.reps].sort());
      expect(v.reps.filter((uid) => v.nonReps.includes(uid))).toEqual([]);
    }
  });
});

// ── 隊徽（D9）────────────────────────────────────────────────────────────
describe("隊徽白名單共用向量 teamLogoOf", () => {
  test.each(LOGO.teamLogoOf.map((v) => [v.name, v]))("%s", (_name, v) => {
    const raw = logoRaw(v);
    const expected = v.expected === "SAME_AS_RAW" ? raw : v.expected;
    expect(teamLogoOf(raw, LOGO.bucketSets[v.buckets])).toBe(expected);
  });
});

describe("D9 隊徽來源順序 card → cover → image，取第一個通過白名單的", () => {
  test.each(LOGO.teamImage.map((v) => [v.name, v]))("%s", (_name, v) => {
    const buckets = LOGO.bucketSets[v.buckets];
    expect(pickTeamImage(v.team, buckets)).toEqual({ image: v.expected, reason: v.reason });
    expect(clubMirrorFromTeam(v.team, { buckets }).image).toBe(v.expected);
  });

  test("全 repo 只有 functions/cp-club-mirror.js 一份代表／隊徽實作", () => {
    const dirs = ["functions", "scripts"];
    expect(fs.existsSync(path.join(ROOT, "functions", "cp-club-mirror-backfill.js"))).toBe(false);
    const defs = /function\s+(teamLogoOf|isAllowedLogoUrl|repUidsFromTeam|pickTeamImage|clubMirrorFromTeam)\b/;
    const hits = [];
    for (const dir of dirs) {
      for (const name of fs.readdirSync(path.join(ROOT, dir))) {
        if (!/\.(c?js|mjs)$/.test(name)) continue;
        const src = fs.readFileSync(path.join(ROOT, dir, name), "utf8");
        if (defs.test(src)) hits.push(`${dir}/${name}`);
      }
    }
    expect(hits).toEqual(["functions/cp-club-mirror.js"]);
  });
});

describe("allowedLogoBuckets", () => {
  test("CP_LOGO_BUCKETS 逗號分隔＋FIREBASE_CONFIG.storageBucket，去重、略過不合格名稱", () => {
    const env = {
      CP_LOGO_BUCKETS: " fc-football-6c8dc-asia-east1 , BAD_UPPER ,,fc-football-6c8dc.firebasestorage.app",
      FIREBASE_CONFIG: JSON.stringify({ storageBucket: "fc-football-6c8dc.firebasestorage.app" }),
    };
    expect(allowedLogoBuckets(env)).toEqual(["fc-football-6c8dc-asia-east1", "fc-football-6c8dc.firebasestorage.app"]);
  });

  test("都沒設回空清單（fail-closed）；FIREBASE_CONFIG 壞掉不放寬", () => {
    expect(allowedLogoBuckets({})).toEqual([]);
    expect(allowedLogoBuckets({ FIREBASE_CONFIG: "{not json" })).toEqual([]);
  });
});

// ── 寫入判斷與 D4 ─────────────────────────────────────────────────────────
describe("needsWrite", () => {
  const planned = { repUids: ["U_a", "U_b"], name: "隊", image: null };

  test("不存在 → 寫；完全相同（srcUpdatedAt 不比）→ 不寫；repUids 順序不同視為相同", () => {
    expect(needsWrite(null, planned)).toBe(true);
    expect(needsWrite({ repUids: ["U_b", "U_a"], name: "隊", image: null, srcUpdatedAt: { t: 1 } }, planned)).toBe(false);
    expect(needsWrite({ repUids: ["U_a", "U_b"], name: "隊", image: null }, planned)).toBe(false);
  });

  test("帶 seededBy 即使三欄相同也要重寫", () => {
    expect(needsWrite({ repUids: ["U_a", "U_b"], name: "隊", image: null, srcUpdatedAt: 1, seededBy: "g4-seed" }, planned)).toBe(true);
  });

  test("少欄位、內容不同、repUids 型別不對 → 寫", () => {
    expect(needsWrite({ repUids: ["U_a", "U_b"], name: "隊" }, planned)).toBe(true);
    expect(needsWrite({ repUids: ["U_a"], name: "隊", image: null }, planned)).toBe(true);
    expect(needsWrite({ repUids: ["U_a", "U_c"], name: "隊", image: null }, planned)).toBe(true);
    expect(needsWrite({ repUids: ["U_a", "U_b"], name: "隊2", image: null }, planned)).toBe(true);
    expect(needsWrite({ repUids: ["U_a", "U_b"], name: "隊", image: ASIA_URL("x") }, planned)).toBe(true);
    expect(needsWrite({ repUids: "U_a,U_b", name: "隊", image: null }, planned)).toBe(true);
  });
});

describe("planMirrorAction（D4）", () => {
  const team = { captainUid: "U_cap", name: "隊" };
  test("從未建過鏡像、沒有代表 → 不寫", () => {
    expect(planMirrorAction({ teamExists: true, teamData: { name: "隊" }, mirrorExists: false, buckets: BOTH }).action).toBe("skip-no-reps");
  });
  test("已有鏡像、代表全被移除 → 寫 repUids: []（不留舊名單）", () => {
    const plan = planMirrorAction({ teamExists: true, teamData: { name: "隊" }, mirrorExists: true, mirrorData: { repUids: ["U_cap"], name: "隊", image: null }, buckets: BOTH });
    expect(plan).toEqual({ action: "set", doc: { repUids: [], name: "隊", image: null } });
  });
  test("已有空名單鏡像、仍無代表 → 不寫", () => {
    const plan = planMirrorAction({ teamExists: true, teamData: { name: "隊" }, mirrorExists: true, mirrorData: { repUids: [], name: "隊", image: null }, buckets: BOTH });
    expect(plan.action).toBe("none");
  });
  test("有代表、無鏡像 → 建立", () => {
    expect(planMirrorAction({ teamExists: true, teamData: team, mirrorExists: false, buckets: BOTH }))
      .toEqual({ action: "set", doc: { repUids: ["U_cap"], name: "隊", image: null } });
  });
  test("刪隊：鏡像存在 → delete；不存在 → none", () => {
    expect(planMirrorAction({ teamExists: false, mirrorExists: true, mirrorData: {} }).action).toBe("delete");
    expect(planMirrorAction({ teamExists: false, mirrorExists: false }).action).toBe("none");
  });
  test("name：非空字串原樣（不 trim），否則 null", () => {
    expect(clubMirrorFromTeam({ name: " 隊 " }).name).toBe(" 隊 ");
    expect(clubMirrorFromTeam({ name: "" }).name).toBeNull();
    expect(clubMirrorFromTeam({ name: 5 }).name).toBeNull();
    expect(clubMirrorFromTeam(null)).toEqual({ repUids: [], name: null, image: null });
  });
});

// ── 觸發器 handler（假 Firestore）────────────────────────────────────────
const SERVER_TS = { __serverTimestamp: true };
const FieldValue = { serverTimestamp: () => SERVER_TS };

function createWorld({ teams = {}, clubs = {} } = {}) {
  const store = { teams: { ...teams }, cpClubs: { ...clubs } };
  const counters = { teamReads: 0, mirrorReads: 0, sets: [], deletes: [] };
  const failures = { teamGet: null, commit: null };
  const snap = (data) => ({ exists: data !== undefined, data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))) });
  const db = {
    collection: (name) => ({
      doc: (id) => ({
        path: `${name}/${id}`,
        get: async () => {
          counters.teamReads += 1;
          if (failures.teamGet) throw failures.teamGet;
          return snap(store[name][id]);
        },
      }),
    }),
  };
  const cpDb = {
    collection: (name) => ({ doc: (id) => ({ path: `${name}/${id}`, name, id }) }),
    runTransaction: async (fn) => {
      const pending = [];
      const tx = {
        get: async (ref) => {
          counters.mirrorReads += 1;
          return snap(store[ref.name][ref.id]);
        },
        set: (...args) => pending.push(["set", ...args]),
        delete: (...args) => pending.push(["delete", ...args]),
      };
      const result = await fn(tx);
      if (failures.commit) throw failures.commit;
      for (const [op, ref, data, options] of pending) {
        if (op === "set") {
          counters.sets.push({ path: ref.path, data, options, argCount: data === undefined ? 1 : (options === undefined ? 2 : 3) });
          store[ref.name][ref.id] = { ...data };
        } else {
          counters.deletes.push(ref.path);
          delete store[ref.name][ref.id];
        }
      }
      return result;
    },
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { store, counters, failures, db, cpDb, logger };
}

const NOW = Date.parse("2026-11-20T12:00:00Z");
const TEAM_ID = "tm_1777000000000_abcdef";

function makeHandler(world, env = { CP_LOGO_BUCKETS: BOTH.join(",") }) {
  return createOnTeamWrittenForCompetitionsHandler({
    db: world.db,
    getCpDb: () => world.cpDb,
    FieldValue,
    logger: world.logger,
    env,
    now: () => NOW,
  });
}

function makeEvent(before, after, { teamId = TEAM_ID, ageMs = 1000 } = {}) {
  const side = (data) => ({ exists: data !== undefined, data: () => data });
  return { params: { teamId }, time: new Date(NOW - ageMs).toISOString(), data: { before: side(before), after: side(after) } };
}

describe("onTeamWrittenForCompetitions handler", () => {
  test("觸發器設定：asia-east1、teams/{teamId}、(default)、retry: true、maxInstances 2", () => {
    expect(TRIGGER_OPTIONS).toMatchObject({
      region: "asia-east1", document: "teams/{teamId}", database: "(default)", retry: true, maxInstances: 2, timeoutSeconds: 60,
    });
    expect(TRIGGER_OPTIONS).not.toHaveProperty("minInstances");
  });

  test("建立隊伍：重讀主站後整份 set 四欄（不帶 merge）", async () => {
    const team = { captainUid: "U_cap", leaderUids: ["U_l"], name: "隊", imageVariants: { card: ASIA_URL("c") } };
    const world = createWorld({ teams: { [TEAM_ID]: team } });
    await expect(makeHandler(world)(makeEvent(undefined, team))).resolves.toEqual({ status: "set" });
    expect(world.counters.sets).toHaveLength(1);
    expect(world.counters.sets[0].argCount).toBe(2);
    expect(world.counters.sets[0].data).toEqual({ repUids: ["U_cap", "U_l"], name: "隊", image: ASIA_URL("c"), srcUpdatedAt: SERVER_TS });
  });

  test("不信事件 payload：事件說有代表，但主站現況已無 → 依現況", async () => {
    const world = createWorld({ teams: { [TEAM_ID]: { name: "隊" } } });
    await expect(makeHandler(world)(makeEvent(undefined, { captainUid: "U_old", name: "隊" }))).resolves.toEqual({ status: "skip-no-reps" });
    expect(world.counters.sets).toHaveLength(0);
  });

  test("無關欄位變更 → 0 讀 0 寫", async () => {
    const world = createWorld();
    const before = { captainUid: "U_cap", name: "隊", memberCount: 3 };
    const after = { captainUid: "U_cap", name: "隊", memberCount: 4 };
    await expect(makeHandler(world)(makeEvent(before, after))).resolves.toEqual({ status: "unchanged" });
    expect(world.counters.teamReads + world.counters.mirrorReads).toBe(0);
  });

  test("相同內容不寫", async () => {
    const team = { captainUid: "U_cap", name: "隊" };
    const world = createWorld({ teams: { [TEAM_ID]: team }, clubs: { [TEAM_ID]: { repUids: ["U_cap"], name: "隊", image: null, srcUpdatedAt: 1 } } });
    await expect(makeHandler(world)(makeEvent({ ...team, name: "舊" }, team))).resolves.toEqual({ status: "none" });
    expect(world.counters.sets).toHaveLength(0);
  });

  test("seed 文件（seededBy）會被整份重寫、欄位剩四個", async () => {
    const team = { captainUid: "U_cap", name: "隊" };
    const world = createWorld({ teams: { [TEAM_ID]: team }, clubs: { [TEAM_ID]: { repUids: ["U_cap"], name: "隊", image: null, srcUpdatedAt: 1, seededBy: "g4-seed" } } });
    await makeHandler(world)(makeEvent({ ...team, name: "舊" }, team));
    expect(world.counters.sets).toHaveLength(1);
    expect(world.counters.sets[0].argCount).toBe(2);
    expect(Object.keys(world.store.cpClubs[TEAM_ID]).sort()).toEqual(["image", "name", "repUids", "srcUpdatedAt"]);
  });

  test("D4：有代表 → 無代表，既有鏡像改成空名單", async () => {
    const before = { captainUid: "U_cap", name: "隊" };
    const after = { name: "隊" };
    const world = createWorld({ teams: { [TEAM_ID]: after }, clubs: { [TEAM_ID]: { repUids: ["U_cap"], name: "隊", image: null, srcUpdatedAt: 1 } } });
    await expect(makeHandler(world)(makeEvent(before, after))).resolves.toEqual({ status: "set" });
    expect(world.store.cpClubs[TEAM_ID]).toEqual({ repUids: [], name: "隊", image: null, srcUpdatedAt: SERVER_TS });
  });

  test("D4：無代表 → 有代表，建立鏡像", async () => {
    const before = { name: "隊" };
    const after = { name: "隊", leaderUids: ["U_new"] };
    const world = createWorld({ teams: { [TEAM_ID]: after } });
    await expect(makeHandler(world)(makeEvent(before, after))).resolves.toEqual({ status: "set" });
    expect(world.store.cpClubs[TEAM_ID].repUids).toEqual(["U_new"]);
  });

  test("D4：從未建過鏡像的無代表隊不寫", async () => {
    const world = createWorld({ teams: { [TEAM_ID]: { name: "隊" } } });
    await expect(makeHandler(world)(makeEvent(undefined, { name: "隊" }))).resolves.toEqual({ status: "skip-no-reps" });
    expect(world.store.cpClubs).toEqual({});
  });

  test("D4：刪隊 → 刪鏡像", async () => {
    const world = createWorld({ clubs: { [TEAM_ID]: { repUids: ["U_cap"], name: "隊", image: null } } });
    await expect(makeHandler(world)(makeEvent({ captainUid: "U_cap" }, undefined))).resolves.toEqual({ status: "delete" });
    expect(world.counters.deletes).toEqual([`cpClubs/${TEAM_ID}`]);
  });

  test("事件是 update，但主站現況已刪 → 刪鏡像", async () => {
    const world = createWorld({ clubs: { [TEAM_ID]: { repUids: ["U_cap"], name: "隊", image: null } } });
    await expect(makeHandler(world)(makeEvent({ captainUid: "U_cap" }, { captainUid: "U_x" }))).resolves.toEqual({ status: "delete" });
    expect(world.store.cpClubs).toEqual({});
  });

  test("刪隊但從未有鏡像 → 不寫", async () => {
    const world = createWorld();
    await expect(makeHandler(world)(makeEvent({ name: "隊" }, undefined))).resolves.toEqual({ status: "none" });
    expect(world.counters.deletes).toEqual([]);
  });

  test("超過 6 小時的事件丟棄、不讀不寫；剛好 6 小時仍處理", async () => {
    const team = { captainUid: "U_cap", name: "隊" };
    const world = createWorld({ teams: { [TEAM_ID]: team } });
    await expect(makeHandler(world)(makeEvent(undefined, team, { ageMs: MAX_EVENT_AGE_MS + 1 }))).resolves.toEqual({ status: "stale" });
    expect(world.counters.teamReads + world.counters.mirrorReads).toBe(0);
    expect(world.logger.warn).toHaveBeenCalled();
    await expect(makeHandler(world)(makeEvent(undefined, team, { ageMs: MAX_EVENT_AGE_MS }))).resolves.toEqual({ status: "set" });
  });

  test("teamId 不合格 → 記 log 不讀不寫", async () => {
    const world = createWorld();
    await expect(makeHandler(world)(makeEvent(undefined, { captainUid: "U" }, { teamId: "bad id!" }))).resolves.toEqual({ status: "bad-id" });
    expect(world.counters.teamReads + world.counters.mirrorReads).toBe(0);
  });

  test("Firestore 讀寫失敗 → 記 error 並重拋（讓平台重試）", async () => {
    const team = { captainUid: "U_cap", name: "隊" };
    const world = createWorld({ teams: { [TEAM_ID]: team } });
    const err = Object.assign(new Error("unavailable"), { code: 14 });
    world.failures.teamGet = err;
    await expect(makeHandler(world)(makeEvent(undefined, team))).rejects.toBe(err);
    expect(world.logger.error).toHaveBeenCalledWith(expect.stringContaining("will retry"), expect.objectContaining({ code: 14 }));
    world.failures.teamGet = null;
    world.failures.commit = Object.assign(new Error("permission"), { code: 7 });
    await expect(makeHandler(world)(makeEvent(undefined, team))).rejects.toMatchObject({ code: 7 });
  });

  test("PERMISSION_DENIED／NOT_FOUND 另記固定前綴告警，錯誤訊息遮罩 teamId 與文件路徑，仍重拋", async () => {
    const team = { captainUid: "U_cap", name: "隊" };
    for (const [code, label] of [[7, "PERMISSION_DENIED"], [5, "NOT_FOUND"], ["permission-denied", "PERMISSION_DENIED"]]) {
      const world = createWorld({ teams: { [TEAM_ID]: team } });
      const err = Object.assign(new Error(`${code} denied: projects/p/databases/asia-main/documents/cpClubs/${TEAM_ID} and teams/${TEAM_ID} (${TEAM_ID})`), { code });
      world.failures.commit = err;
      await expect(makeHandler(world)(makeEvent(undefined, team))).rejects.toBe(err);
      const calls = world.logger.error.mock.calls;
      const alerts = calls.filter(([msg]) => msg.startsWith(mirror.ACCESS_ALERT_PREFIX));
      expect(alerts).toHaveLength(1);
      expect(alerts[0][0]).toContain(label);
      const logged = JSON.stringify(calls);
      expect(logged).not.toContain(TEAM_ID);
      expect(logged).not.toContain("documents/cpClubs");
      expect(logged).toContain("<doc-path>");
      expect(logged).toContain("teams/<id>");
    }
  });

  test("其他錯誤碼（UNAVAILABLE 等）不記告警行", async () => {
    const team = { captainUid: "U_cap", name: "隊" };
    const world = createWorld({ teams: { [TEAM_ID]: team } });
    world.failures.teamGet = Object.assign(new Error("unavailable"), { code: 14 });
    await expect(makeHandler(world)(makeEvent(undefined, team))).rejects.toMatchObject({ code: 14 });
    expect(world.logger.error.mock.calls.filter(([msg]) => msg.startsWith(mirror.ACCESS_ALERT_PREFIX))).toHaveLength(0);
  });

  test("sanitizeErrorMessage：非字串、超長也安全", () => {
    expect(mirror.sanitizeErrorMessage(undefined, TEAM_ID)).toBe("");
    expect(mirror.sanitizeErrorMessage(`x${TEAM_ID}`.repeat(50), TEAM_ID).length).toBeLessThanOrEqual(300);
    expect(mirror.sanitizeErrorMessage(`x${TEAM_ID}`.repeat(50), TEAM_ID)).not.toContain(TEAM_ID);
  });

  test("log 不含完整 teamId 與 uid", async () => {
    const team = { captainUid: "U_secret_uid", name: "隊" };
    const world = createWorld({ teams: { [TEAM_ID]: team } });
    await makeHandler(world)(makeEvent(undefined, team));
    const logged = JSON.stringify([world.logger.info.mock.calls, world.logger.warn.mock.calls, world.logger.error.mock.calls]);
    expect(logged).not.toContain(TEAM_ID);
    expect(logged).not.toContain("U_secret_uid");
  });

  test("白名單為空：image 寫 null，每個執行個體只記一次 error", async () => {
    const team = { captainUid: "U_cap", name: "隊", image: ASIA_URL("i") };
    const world = createWorld({ teams: { [TEAM_ID]: team } });
    const handler = makeHandler(world, {});
    await handler(makeEvent(undefined, team));
    await handler(makeEvent(team, { ...team, name: "新" }));
    expect(world.store.cpClubs[TEAM_ID].image).toBeNull();
    expect(world.logger.error.mock.calls.filter(([msg]) => /allowlist is empty/.test(msg))).toHaveLength(1);
  });
});

describe("functions/index.js 接線", () => {
  const indexSource = fs.readFileSync(path.join(ROOT, "functions", "index.js"), "utf8");
  test("以獨立模組匯出 onTeamWrittenForCompetitions，不改 watchUsersChanges／onTeamUpdate", () => {
    expect(indexSource).toMatch(/require\("\.\/cp-club-mirror"\)/);
    expect(indexSource).toMatch(/Object\.assign\(exports, createCpClubMirrorExports\(\{/);
    const watchStart = indexSource.indexOf("exports.watchUsersChanges");
    const watchEnd = indexSource.indexOf("\nexports.", watchStart + 1);
    expect(indexSource.slice(watchStart, watchEnd)).not.toMatch(/cp-club-mirror|cpClubs|CpClubMirror/);
    const teamStart = indexSource.indexOf("exports.onTeamUpdate");
    const teamEnd = indexSource.indexOf("\nexports.", teamStart + 1);
    expect(indexSource.slice(teamStart, teamEnd)).not.toMatch(/cp-club-mirror|cpClubs|CpClubMirror/);
  });

  test("createCpClubMirrorExports 只產生一支函式、asia-main 延遲建立", () => {
    const calls = [];
    const getFirestore = jest.fn(() => ({}));
    const out = mirror.createCpClubMirrorExports({
      onDocumentWritten: (opts, handler) => { calls.push(opts); return handler; },
      db: {}, getFirestore, FieldValue, logger: { info() {}, warn() {}, error() {} },
    });
    expect(Object.keys(out)).toEqual(["onTeamWrittenForCompetitions"]);
    expect(calls).toEqual([{ ...TRIGGER_OPTIONS }]);
    expect(getFirestore).not.toHaveBeenCalled();
  });
});
