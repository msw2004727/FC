"use strict";

// G4 賽事俱樂部鏡像全量回填（顧問 §3.372 方案 a）：主站 (default) teams → asia-main cpClubs（只做代表，不做 members）。
// 與觸發器 onTeamWrittenForCompetitions 共用 functions/cp-club-mirror.js 的純函式（planMirrorAction 等）。
//
// 用法（不加旗標＝dry-run，只讀不寫）。隊徽白名單只讀環境變數 CP_LOGO_BUCKETS（與觸發器同一份），白名單空就停：
//   CP_LOGO_BUCKETS=<bucket1>,<bucket2> node scripts/cp-club-mirror-backfill.js
//   CP_LOGO_BUCKETS=... node scripts/cp-club-mirror-backfill.js --team <teamId,...>
//   CP_LOGO_BUCKETS=... node scripts/cp-club-mirror-backfill.js --execute --confirm-count <N> --plan-hash <sha256> [--team ...]
//   node scripts/cp-club-mirror-backfill.js --rollback --backup <檔>                       （回退 dry-run）
//   node scripts/cp-club-mirror-backfill.js --rollback --backup <檔> --execute --confirm-count <N> [--overwrite-changed]
//     回退預設略過「回填後又被改過」的文件；--overwrite-changed 才連這些也蓋回備份。
//   --out <dir>：備份與紀錄輸出位置，只能在 docs/（local-only）或系統暫存目錄下。
//
// --execute 與 --rollback --execute 都是正式資料寫入（GATED，站長按鈕，R-SAFE-013）。
// 只用站長本人登入後的既有 ADC（設了 GOOGLE_APPLICATION_CREDENTIALS 就拒絕），不得使用金鑰檔。
// 輸出一律遮罩：teamId 只留前 13 碼、uid 只留前 4 碼；備份檔含原文（含 uid），只放 local-only，不進 Git、不貼對話。

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { isDeepStrictEqual } = require("util");

const {
  CP_CLUBS_COLLECTION,
  CP_DATABASE_ID,
  MIRROR_FIELDS,
  REP_LIST_FIELD,
  REP_STRING_FIELDS,
  TEAM_AVATAR_FIELDS,
  TEAMS_COLLECTION,
  TEAM_ID_RE,
  allowedLogoBuckets,
  maskTeamId,
  pickTeamImage,
  planMirrorAction,
  repUidsFromTeam,
} = require("../functions/cp-club-mirror");

const PROJECT_ID = "fc-football-6c8dc";
const SEED_MARK = "g4-seed";
const SAMPLE_SIZE = 10;
const SAMPLE_SEED = "cp-club-mirror-sample-v1";
const TEAM_SELECT_FIELDS = [...REP_STRING_FIELDS, REP_LIST_FIELD, "name", ...TEAM_AVATAR_FIELDS, "image", "imageVariants", "id"];

const REPO_ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = path.resolve(REPO_ROOT, "docs");
const DEFAULT_OUT_DIR = path.resolve(DOCS_DIR, "reports", "cp-club-mirror-backfill");

// ── 參數 ───────────────────────────────────────────────────────────────
function isPathUnder(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

function parseArgs(argv, env = {}) {
  if (typeof env.GOOGLE_APPLICATION_CREDENTIALS === "string" && env.GOOGLE_APPLICATION_CREDENTIALS.length > 0) {
    throw new Error("KEY_FILE_NOT_ALLOWED");
  }
  const tokens = Array.isArray(argv) ? argv.slice(2) : [];
  const out = { execute: false, rollback: false, overwriteChanged: false, teamIds: null, confirmCount: null, planHash: null, backup: null, outDir: DEFAULT_OUT_DIR };
  const value = (i, code) => {
    const v = tokens[i + 1];
    if (typeof v !== "string" || v === "" || v.startsWith("--")) throw new Error(code);
    return v;
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === "--execute") out.execute = true;
    else if (t === "--rollback") out.rollback = true;
    else if (t === "--overwrite-changed") out.overwriteChanged = true;
    else if (t === "--team") {
      const ids = value(i, "MISSING_TEAM").split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0 || ids.some((id) => !TEAM_ID_RE.test(id))) throw new Error("INVALID_TEAM_ID");
      out.teamIds = [...new Set(ids)];
      i += 1;
    } else if (t === "--confirm-count") {
      const n = Number(value(i, "MISSING_CONFIRM_COUNT"));
      if (!Number.isInteger(n) || n < 0) throw new Error("INVALID_CONFIRM_COUNT");
      out.confirmCount = n;
      i += 1;
    } else if (t === "--plan-hash") {
      const h = value(i, "MISSING_PLAN_HASH");
      if (!/^[0-9a-f]{64}$/.test(h)) throw new Error("INVALID_PLAN_HASH");
      out.planHash = h;
      i += 1;
    } else if (t === "--backup") {
      out.backup = path.resolve(value(i, "MISSING_BACKUP"));
      i += 1;
    } else if (t === "--out") {
      out.outDir = path.resolve(value(i, "MISSING_OUT"));
      i += 1;
    } else {
      throw new Error("UNKNOWN_FLAG");
    }
  }
  if (!isPathUnder(out.outDir, DOCS_DIR) && !isPathUnder(out.outDir, os.tmpdir())) throw new Error("OUT_NOT_LOCAL_ONLY");
  if (out.rollback) {
    if (!out.backup) throw new Error("ROLLBACK_REQUIRES_BACKUP");
    if (out.teamIds || out.planHash) throw new Error("ROLLBACK_FLAG_CONFLICT");
    if (out.execute && out.confirmCount === null) throw new Error("ROLLBACK_EXECUTE_REQUIRES_CONFIRM_COUNT");
  } else {
    if (out.backup) throw new Error("BACKUP_REQUIRES_ROLLBACK");
    if (out.overwriteChanged) throw new Error("OVERWRITE_CHANGED_REQUIRES_ROLLBACK");
    if (out.execute && (out.confirmCount === null || out.planHash === null)) throw new Error("EXECUTE_REQUIRES_COUNT_AND_HASH");
    if (!out.execute && (out.confirmCount !== null || out.planHash !== null)) throw new Error("COUNT_AND_HASH_REQUIRE_EXECUTE");
  }
  out.mode = out.rollback ? (out.execute ? "rollback-execute" : "rollback-dry-run") : (out.execute ? "execute" : "dry-run");
  return out;
}

// ── 遮罩與比對 ─────────────────────────────────────────────────────────
function maskUid(uid) {
  return typeof uid === "string" && uid.length > 0 ? `${uid.slice(0, 4)}…` : String(uid);
}

function describeValue(v) {
  if (typeof v === "string") return v.length === 0 ? "\"\"" : maskUid(v);
  if (Array.isArray(v)) return `[${v.map(describeValue).join(",")}]`;
  if (v === undefined) return "-";
  if (v === null) return "null";
  return `<${typeof v}>`;
}

function fingerprint(v) {
  if (v === null || v === undefined) return String(v);
  return `#${crypto.createHash("sha256").update(String(v)).digest("hex").slice(0, 8)}`;
}

function bucketOf(url) {
  if (typeof url !== "string") return String(url);
  const m = /\/v0\/b\/([^/]+)\/o\//.exec(url);
  return m ? m[1] : "(非 Storage 網址)";
}

/** 獨立重寫版（抽樣比對用）：簡單 if 串，不呼叫 repUidsFromTeam。兩者不同整個 dry-run 標紅、不得執行。 */
function independentRepUids(team) {
  const s = new Set();
  if (typeof team.captainUid === "string" && team.captainUid !== "") s.add(team.captainUid);
  if (typeof team.creatorUid === "string" && team.creatorUid !== "") s.add(team.creatorUid);
  if (typeof team.ownerUid === "string" && team.ownerUid !== "") s.add(team.ownerUid);
  if (typeof team.leaderUid === "string" && team.leaderUid !== "") s.add(team.leaderUid);
  if (Array.isArray(team.leaderUids)) {
    team.leaderUids.forEach((u) => { if (typeof u === "string" && u !== "") s.add(u); });
  }
  return Array.from(s).sort();
}

function sameList(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ── 讀取（先讀鏡像、再讀主站，與觸發器同順序）──────────────────────────────
async function loadState({ db, cpDb, teamIds }) {
  const mirrors = new Map();
  const teams = new Map();
  if (teamIds) {
    for (const id of teamIds) {
      const snap = await cpDb.collection(CP_CLUBS_COLLECTION).doc(id).get();
      if (snap.exists) mirrors.set(id, { data: snap.data(), updateTime: snap.updateTime });
    }
    for (const id of teamIds) {
      const snap = await db.collection(TEAMS_COLLECTION).doc(id).get();
      if (snap.exists) teams.set(id, snap.data());
    }
  } else {
    const mirrorSnap = await cpDb.collection(CP_CLUBS_COLLECTION).get();
    mirrorSnap.docs.forEach((d) => mirrors.set(d.id, { data: d.data(), updateTime: d.updateTime }));
    const teamSnap = await db.collection(TEAMS_COLLECTION).select(...TEAM_SELECT_FIELDS).get();
    teamSnap.docs.forEach((d) => teams.set(d.id, d.data()));
  }
  return { mirrors, teams };
}

// ── 計畫 ───────────────────────────────────────────────────────────────
function buildPlan({ mirrors, teams, buckets }) {
  const stats = {
    teamsRead: teams.size, mirrorsRead: mirrors.size,
    skipBadId: 0, skipNoReps: 0, dataIdMismatch: 0,
    create: 0, update: 0, same: 0, adopt: 0, clearReps: 0, orphan: 0,
    image: { ok: 0, none: 0, "not-allowed": 0, format: 0 },
    independentMismatch: 0,
  };
  const entries = [];
  const samplesPool = [];
  const adoptions = [];
  for (const id of [...teams.keys()].sort()) {
    const team = teams.get(id) || {};
    if (!TEAM_ID_RE.test(id)) { stats.skipBadId += 1; continue; }
    if (typeof team.id === "string" && team.id !== id) stats.dataIdMismatch += 1;
    const mirror = mirrors.get(id);
    const plan = planMirrorAction({ teamExists: true, teamData: team, mirrorExists: !!mirror, mirrorData: mirror ? mirror.data : null, buckets });
    const independent = independentRepUids(team);
    const reps = repUidsFromTeam(team);
    if (!sameList(independent, reps)) stats.independentMismatch += 1;
    samplesPool.push(id);
    if (plan.action === "skip-no-reps") { stats.skipNoReps += 1; continue; }
    stats.image[pickTeamImage(team, buckets).reason] += 1;
    if (plan.action === "none") { stats.same += 1; continue; }
    const extraKeys = mirror ? Object.keys(mirror.data).filter((k) => !MIRROR_FIELDS.includes(k)) : [];
    if (!mirror) stats.create += 1;
    else {
      stats.update += 1;
      if (extraKeys.length > 0) { stats.adopt += 1; adoptions.push({ id, before: mirror.data, after: plan.doc }); }
      if (plan.doc.repUids.length === 0) stats.clearReps += 1;
    }
    entries.push({ id, op: mirror ? "update" : "create", doc: plan.doc, expectUpdateTime: mirror ? mirror.updateTime : null });
  }
  for (const id of [...mirrors.keys()].sort()) {
    if (teams.has(id)) continue;
    stats.orphan += 1;
    entries.push({ id, op: "delete", doc: null, expectUpdateTime: mirrors.get(id).updateTime });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const planHash = crypto.createHash("sha256")
    .update(JSON.stringify(entries.map((e) => [e.id, e.op, e.doc])))
    .digest("hex");
  const samples = samplesPool
    .map((id) => ({ id, key: crypto.createHash("sha256").update(`${SAMPLE_SEED}:${id}`).digest("hex") }))
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .slice(0, SAMPLE_SIZE)
    .map(({ id }) => id);
  return { entries, planHash, stats, samples, adoptions };
}

function seedCount(mirrors) {
  return [...mirrors.values()].filter((m) => m.data && m.data.seededBy === SEED_MARK).length;
}

function formatPlanReport({ plan, mirrors, teams, buckets }) {
  const s = plan.stats;
  const lines = [];
  const red = s.independentMismatch > 0 || buckets.length === 0;
  if (red) lines.push("!!! 標紅：不得執行（獨立重寫版不一致或白名單空）!!!");
  lines.push(`計畫雜湊 sha256=${plan.planHash}`);
  lines.push(`寫入筆數 ${plan.entries.length}（--confirm-count 用這個）`);
  lines.push(`白名單 bucket：[${buckets.join(", ")}]${buckets.length === 0 ? "（空，停止）" : ""}`);
  lines.push(`主站 teams 讀取 ${s.teamsRead}｜cpClubs 讀取 ${s.mirrorsRead}（其中 seededBy=${SEED_MARK} ${seedCount(mirrors)} 份）`);
  lines.push(`  跳過：id 不合格 ${s.skipBadId}、無代表且從未建鏡像 ${s.skipNoReps}`);
  lines.push(`  data.id≠doc id ${s.dataIdMismatch}（只計數，鏡像一律用文件路徑 id）`);
  lines.push(`  create ${s.create}｜update ${s.update}（其中收編非四欄文件 ${s.adopt}、代表清空改空名單 ${s.clearReps}）｜相同不寫 ${s.same}｜孤兒（鏡像有、主站無，將刪）${s.orphan}`);
  lines.push(`  image：通過 ${s.image.ok}、無圖 ${s.image.none}、非白名單 bucket／網域 ${s.image["not-allowed"]}、過長或格式錯 ${s.image.format}`);
  lines.push(`  獨立重寫版與 repUidsFromTeam 不一致 ${s.independentMismatch}（全部 ${s.teamsRead - s.skipBadId} 隊逐一比對）`);
  lines.push("收編文件逐欄差異（現有 → 計畫）：");
  if (plan.adoptions.length === 0) lines.push("  （無）");
  for (const a of plan.adoptions) {
    lines.push(`  ${maskTeamId(a.id)}`);
    const keys = new Set([...Object.keys(a.before), ...MIRROR_FIELDS]);
    for (const k of [...keys].sort()) {
      if (k === "srcUpdatedAt") { lines.push("    srcUpdatedAt：改為寫入時間"); continue; }
      if (!MIRROR_FIELDS.includes(k)) { lines.push(`    ${k}：有 → 移除`); continue; }
      const before = a.before[k];
      const after = a.after[k];
      if (k === "repUids") {
        const same = Array.isArray(before) && sameList([...before].sort(), after);
        lines.push(`    repUids：${same ? "相同" : "不同"}（${Array.isArray(before) ? before.length : describeValue(before)} 人 → ${after.length} 人；計畫 ${describeValue(after)}）`);
      } else if (k === "image") {
        lines.push(`    image：${before === after ? "相同" : "不同"}（${bucketOf(before)} ${fingerprint(before)} → ${bucketOf(after)} ${fingerprint(after)}）`);
      } else {
        lines.push(`    ${k}：${before === after ? "相同" : "不同"}（長度 ${typeof before === "string" ? before.length : describeValue(before)} → ${typeof after === "string" ? after.length : describeValue(after)}）`);
      }
    }
  }
  lines.push(`抽樣 ${plan.samples.length} 筆（固定種子 ${SAMPLE_SEED}）：`);
  for (const id of plan.samples) {
    const team = teams.get(id) || {};
    const reps = repUidsFromTeam(team);
    const independent = independentRepUids(team);
    const fields = [...REP_STRING_FIELDS, REP_LIST_FIELD].map((f) => `${f}=${describeValue(team[f])}`).join(" ");
    const mirror = mirrors.get(id);
    const name = typeof team.name === "string" && team.name.length > 0 ? team.name : null;
    const nameCmp = mirror ? (mirror.data.name === name ? "與鏡像相同" : "與鏡像不同") : "無鏡像";
    const img = pickTeamImage(team, buckets);
    lines.push(`  ${maskTeamId(id)}｜${fields}｜計畫 ${describeValue(reps)}｜獨立 ${describeValue(independent)}｜${sameList(reps, independent) ? "一致" : "!!不一致!!"}｜name ${name === null ? "null" : "有"}，${nameCmp}｜image ${img.reason}${img.image ? ` ${bucketOf(img.image)}` : ""}`);
  }
  return { lines, red };
}

// ── 備份序列化（Timestamp 以外的特殊型別一律拒絕，不做有損備份）──────────────
function serialize(v) {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(serialize);
  if (v && typeof v.toDate === "function" && typeof v.seconds === "number" && typeof v.nanoseconds === "number") {
    return { __cpTimestamp: [v.seconds, v.nanoseconds] };
  }
  const proto = v && typeof v === "object" ? Object.getPrototypeOf(v) : undefined;
  if (proto === Object.prototype || proto === null) {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = serialize(x);
    return out;
  }
  throw new Error("UNSUPPORTED_BACKUP_VALUE");
}

function deserialize(v, Timestamp) {
  if (Array.isArray(v)) return v.map((x) => deserialize(x, Timestamp));
  if (v && typeof v === "object") {
    if (Array.isArray(v.__cpTimestamp) && Object.keys(v).length === 1) return new Timestamp(v.__cpTimestamp[0], v.__cpTimestamp[1]);
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = deserialize(x, Timestamp);
    return out;
  }
  return v;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

// ── 執行 ───────────────────────────────────────────────────────────────
async function runExecute({ db, cpDb, FieldValue, args, buckets, now = () => new Date(), log }) {
  const state = await loadState({ db, cpDb, teamIds: args.teamIds });
  const plan = buildPlan({ ...state, buckets });
  if (buckets.length === 0) throw new Error("LOGO_BUCKETS_EMPTY");
  if (plan.stats.independentMismatch > 0) throw new Error("INDEPENDENT_MISMATCH");
  if (plan.planHash !== args.planHash) throw new Error("PLAN_HASH_MISMATCH");
  if (plan.entries.length !== args.confirmCount) throw new Error("CONFIRM_COUNT_MISMATCH");

  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(args.outDir, `cp-club-mirror-backup-${stamp}.json`);
  const record = {
    kind: "cp-club-mirror-backfill",
    project: PROJECT_ID,
    database: CP_DATABASE_ID,
    createdAt: now().toISOString(),
    planHash: plan.planHash,
    teamIds: args.teamIds,
    // 執行前 cpClubs 原文（本次讀到的全部鏡像；回退依 applied 清單從這裡還原）
    before: Object.fromEntries([...state.mirrors.entries()].map(([id, m]) => [id, serialize(m.data)])),
    planned: plan.entries.map((e) => ({ id: e.id, op: e.op, doc: e.doc })),
    applied: [],
    skipped: [],
    finished: false,
  };
  writeJson(backupFile, record);
  log(`備份已寫入 ${backupFile}（local-only，含原文，不進 Git、不貼對話）`);

  for (const entry of plan.entries) {
    const ref = cpDb.collection(CP_CLUBS_COLLECTION).doc(entry.id);
    const teamRef = db.collection(TEAMS_COLLECTION).doc(entry.id);
    const outcome = await cpDb.runTransaction(async (tx) => {
      // 與觸發器同順序：先讀鏡像（transaction 內）、再重讀主站現況重算；任何一邊與計畫不同就不寫。
      const snap = await tx.get(ref);
      if (entry.op === "create") {
        if (snap.exists) return "skip-exists";
      } else if (!snap.exists || !snap.updateTime || !entry.expectUpdateTime || !snap.updateTime.isEqual(entry.expectUpdateTime)) {
        return "skip-changed";
      }
      const teamSnap = await teamRef.get();
      const current = planMirrorAction({
        teamExists: teamSnap.exists,
        teamData: teamSnap.exists ? teamSnap.data() : null,
        mirrorExists: snap.exists,
        mirrorData: snap.exists ? snap.data() : null,
        buckets,
      });
      const expected = entry.op === "delete" ? "delete" : "set";
      if (current.action !== expected || (expected === "set" && !isDeepStrictEqual(current.doc, entry.doc))) return "skip-team-changed";
      if (entry.op === "delete") tx.delete(ref);
      else tx.set(ref, { repUids: entry.doc.repUids, name: entry.doc.name, image: entry.doc.image, srcUpdatedAt: FieldValue.serverTimestamp() });
      return "applied";
    });
    if (outcome === "applied") record.applied.push({ id: entry.id, op: entry.op, doc: entry.doc });
    else record.skipped.push({ id: entry.id, op: entry.op, reason: outcome });
    writeJson(backupFile, record);
  }
  record.finished = true;
  writeJson(backupFile, record);

  // 讀回：逐筆比對計畫；seededBy 計數
  let readbackMismatch = 0;
  for (const a of record.applied) {
    const snap = await cpDb.collection(CP_CLUBS_COLLECTION).doc(a.id).get();
    if (a.op === "delete") { if (snap.exists) readbackMismatch += 1; continue; }
    const data = snap.exists ? snap.data() : null;
    const ok = data && Object.keys(data).sort().join(",") === [...MIRROR_FIELDS].sort().join(",")
      && sameList(data.repUids, a.doc.repUids) && data.name === a.doc.name && data.image === a.doc.image;
    if (!ok) readbackMismatch += 1;
  }
  const seedLeft = (await cpDb.collection(CP_CLUBS_COLLECTION).where("seededBy", "==", SEED_MARK).count().get()).data().count;
  log(`執行完成：寫入 ${record.applied.length}、略過 ${record.skipped.length}（已存在 ${record.skipped.filter((s) => s.reason === "skip-exists").length}、鏡像被改過 ${record.skipped.filter((s) => s.reason === "skip-changed").length}、主站已變 ${record.skipped.filter((s) => s.reason === "skip-team-changed").length}）`);
  log(`讀回不符 ${readbackMismatch}｜cpClubs where seededBy==${SEED_MARK} 計數 ${seedLeft}`);
  return { backupFile, applied: record.applied.length, skipped: record.skipped.length, readbackMismatch, seedLeft };
}

// ── 回退 ───────────────────────────────────────────────────────────────
/** 鏡像現況是否仍是回填當時寫入的內容（delete 則要求仍不存在）。 */
function isStillAsApplied(applied, snap) {
  if (applied.op === "delete") return !snap.exists;
  const data = snap.exists ? snap.data() : null;
  return !!data && Array.isArray(data.repUids) && sameList(data.repUids, applied.doc.repUids)
    && data.name === applied.doc.name && data.image === applied.doc.image;
}

async function runRollback({ cpDb, Timestamp, args, log }) {
  const record = JSON.parse(fs.readFileSync(args.backup, "utf8"));
  if (record.kind !== "cp-club-mirror-backfill" || !Array.isArray(record.applied) || !record.before) throw new Error("BAD_BACKUP_FILE");
  const steps = [...record.applied].reverse();
  let changedSince = 0;
  for (const a of steps) {
    if (!isStillAsApplied(a, await cpDb.collection(CP_CLUBS_COLLECTION).doc(a.id).get())) changedSince += 1;
  }
  const overwrite = args.overwriteChanged === true;
  const toApply = overwrite ? steps.length : steps.length - changedSince;
  const restore = steps.filter((a) => record.before[a.id] !== undefined).length;
  log(`回退計畫：共 ${steps.length} 筆（還原原文 ${restore}、刪除本次新建 ${steps.length - restore}）`);
  log(`  回填後又被改過 ${changedSince} 筆：${overwrite ? "--overwrite-changed，一併蓋回備份" : "預設略過（要覆蓋請加 --overwrite-changed）"}`);
  log(`  將回退 ${toApply} 筆（--confirm-count 用這個）`);
  if (!args.execute) return { planned: steps.length, changedSince, toApply, executed: 0, skipped: 0 };
  if (args.confirmCount !== toApply) throw new Error("CONFIRM_COUNT_MISMATCH");
  let executed = 0;
  let skipped = 0;
  for (const a of steps) {
    const ref = cpDb.collection(CP_CLUBS_COLLECTION).doc(a.id);
    const before = record.before[a.id];
    const done = await cpDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!overwrite && !isStillAsApplied(a, snap)) return false;
      if (before === undefined) { if (snap.exists) tx.delete(ref); } else tx.set(ref, deserialize(before, Timestamp));
      return true;
    });
    if (done) executed += 1; else skipped += 1;
  }
  log(`回退完成 ${executed} 筆、略過（回填後又被改過）${skipped} 筆`);
  return { planned: steps.length, changedSince, toApply, executed, skipped };
}

async function runDryRun({ db, cpDb, args, buckets, log }) {
  const state = await loadState({ db, cpDb, teamIds: args.teamIds });
  const plan = buildPlan({ ...state, buckets });
  const { lines, red } = formatPlanReport({ plan, ...state, buckets });
  lines.forEach((line) => log(line));
  return { plan, red };
}

async function main() {
  const args = parseArgs(process.argv, process.env);
  // 根目錄沒有 firebase-admin：沿用 scripts/qa-test-mode/lib.js 的做法，從 functions/node_modules 解析。
  const fromFunctions = (id) => require(require.resolve(id, { paths: [path.join(REPO_ROOT, "functions")] }));
  const { getApps, initializeApp } = fromFunctions("firebase-admin/app");
  const { getFirestore, FieldValue, Timestamp } = fromFunctions("firebase-admin/firestore");
  const app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore(app);
  const cpDb = getFirestore(app, CP_DATABASE_ID);
  const log = (line) => console.log(line);
  const buckets = allowedLogoBuckets(process.env);
  log(`模式 ${args.mode}｜專案 ${PROJECT_ID}｜鏡像庫 ${CP_DATABASE_ID}${args.teamIds ? `｜指定 ${args.teamIds.length} 隊` : "｜全量"}`);
  if (args.rollback) return runRollback({ cpDb, Timestamp, args, log });
  if (buckets.length === 0) throw new Error("LOGO_BUCKETS_EMPTY（請設 CP_LOGO_BUCKETS）");
  if (args.execute) return runExecute({ db, cpDb, FieldValue, args, buckets, log });
  const { red } = await runDryRun({ db, cpDb, args, buckets, log });
  if (red) process.exitCode = 1;
  return null;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[cp-club-mirror-backfill] 失敗：${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_OUT_DIR,
  SEED_MARK,
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
};
