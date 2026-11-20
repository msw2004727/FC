"use strict";

/**
 * 賽事俱樂部鏡像（G4 方案 a，顧問 §3.372）：主站 (default) teams/{teamId} → asia-main cpClubs/{teamId}。
 *
 * 鏡像只有四欄：{ repUids, name, image, srcUpdatedAt }。寫入一律整份 set（不 merge），
 * 所以舊欄位（例如臨時 seed 的 seededBy）會被清掉。觸發器 onTeamWrittenForCompetitions 與
 * 回填腳本 functions/cp-club-mirror-backfill.js 共用本檔的純函式，全 repo 只有這一份實作。
 *
 * 代表定義＝主站 firestore.rules isCurrentUserTeamCaptainOrLeader：
 *   captainUid、creatorUid、ownerUid、leaderUid（是字串才算）＋ leaderUids（清單內的字串）；教練不算。
 * 防漂移：tests/unit/cp-club-mirror.test.js 比對 Rules 原文；共用向量 tests/fixtures/cp-rep-vectors.json
 * 同時跑本檔、Rules 模擬器（tests/firestore-rules/cp-rep-vectors-rules.test.js），
 * 新站 FC-B rep-clubs.ts:isClubRepresentative 另一個 repo，向量檔要複製過去（改一邊要同步另一邊）。
 *
 * 隊徽白名單移植自 functions-cp/src/cp/logo-hosts.ts 與 validate.ts:teamLogoOf（不同部署包、ESM TS，無法 require）；
 * 共用向量 tests/fixtures/cp-logo-vectors.json，兩邊改動要同步。
 */

const { isDeepStrictEqual } = require("util");

const REGION = "asia-east1";
const CP_DATABASE_ID = "asia-main";
const CP_CLUBS_COLLECTION = "cpClubs";
const TEAMS_COLLECTION = "teams";
// 與 functions-cp/src/cp/context.ts TEAM_ID_RE 相同
const TEAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// retry: true 的事件最長會被重送 7 天；超過 6 小時直接丟棄，交給回填腳本 --team 重同步。
const MAX_EVENT_AGE_MS = 6 * 60 * 60 * 1000;

const REP_STRING_FIELDS = Object.freeze(["captainUid", "creatorUid", "ownerUid", "leaderUid"]);
const REP_LIST_FIELD = "leaderUids";
const REP_FIELDS = Object.freeze([...REP_STRING_FIELDS, REP_LIST_FIELD]);
const MIRROR_FIELDS = Object.freeze(["repUids", "name", "image", "srcUpdatedAt"]);
const MIRROR_CONTENT_FIELDS = Object.freeze(["image", "name", "repUids"]);
// 觸發器的投影：這些欄位都沒變（且不是建立／刪除）就 0 讀 0 寫直接結束
const PROJECTION_FIELDS = Object.freeze([...REP_FIELDS, "name", "image", "imageVariants"]);
// 主站畫面 _getTeamImageUrl(team, 'card')（js/modules/image-upload.js _getImageVariantUrl）的順序
const IMAGE_VARIANT_ORDER = Object.freeze(["card", "cover"]);

// ── 隊徽白名單（移植自 functions-cp/src/cp/logo-hosts.ts）──────────────────────
const LOGO_HOST = "firebasestorage.googleapis.com";
const BUCKET_RE = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;
// 移植自 functions-cp/src/cp/validate.ts
const TEAM_LOGO_MAX = 1200;
const TEAM_LOGO_RE = /^https:\/\/[!-~]+$/;

/** 允許的 bucket 清單：CP_LOGO_BUCKETS（逗號分隔）＋ FIREBASE_CONFIG.storageBucket；都沒有就空（fail-closed）。 */
function allowedLogoBuckets(env = process.env) {
  const out = new Set();
  for (const b of String(env.CP_LOGO_BUCKETS ?? "").split(",")) {
    const t = b.trim();
    if (BUCKET_RE.test(t)) out.add(t);
  }
  try {
    const cfg = env.FIREBASE_CONFIG ? JSON.parse(env.FIREBASE_CONFIG) : null;
    const b = typeof cfg?.storageBucket === "string" ? cfg.storageBucket.trim() : "";
    if (BUCKET_RE.test(b)) out.add(b);
  } catch {
    // FIREBASE_CONFIG 格式不對：當成沒有，不放寬
  }
  return [...out];
}

/** 網址是否為白名單 bucket 的 Firebase Storage 下載網址（已正規化的字串）。 */
function isAllowedLogoUrl(url, buckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.hostname !== LOGO_HOST || u.port !== "" || u.username !== "" || u.password !== "") return false;
  const m = /^\/v0\/b\/([^/]+)\/o\/[^/]+/.exec(u.pathname);
  if (!m) return false;
  let bucket;
  try {
    bucket = decodeURIComponent(m[1]);
  } catch {
    return false;
  }
  return buckets.includes(bucket);
}

/**
 * 隊徽不合格的原因；合格回 null。分類只給回填 dry-run 統計用：
 * none＝沒有值、format＝非字串／過長／格式錯、not-allowed＝不是白名單 bucket 的 Storage 網址。
 */
function logoRejectReason(raw, buckets) {
  if (raw === undefined || raw === null || raw === "") return "none";
  if (typeof raw !== "string") return "format";
  const s = raw.normalize("NFKC").trim();
  if (s.length === 0) return "none";
  if (s.length > TEAM_LOGO_MAX || !TEAM_LOGO_RE.test(s)) return "format";
  if (!isAllowedLogoUrl(s, buckets)) return "not-allowed";
  return null;
}

/** 與 functions-cp validate.ts:teamLogoOf 同規則：合格回正規化字串，否則 null。 */
function teamLogoOf(raw, buckets) {
  if (logoRejectReason(raw, buckets) !== null) return null;
  return raw.normalize("NFKC").trim();
}

/** 隊徽候選：imageVariants.card → imageVariants.cover → image（D9）。 */
function teamImageCandidates(teamData) {
  if (!teamData || typeof teamData !== "object") return [];
  const variants = teamData.imageVariants && typeof teamData.imageVariants === "object" && !Array.isArray(teamData.imageVariants)
    ? teamData.imageVariants
    : {};
  return [...IMAGE_VARIANT_ORDER.map((key) => variants[key]), teamData.image];
}

/**
 * 依 D9 選隊徽：照順序取「第一個通過白名單」的網址（不是第一個有值的）；都不過回 null。
 * reason 只給回填統計：ok／none／format／not-allowed（取第一個有值候選的不合格原因）。
 */
function pickTeamImage(teamData, buckets) {
  let firstReason = null;
  for (const raw of teamImageCandidates(teamData)) {
    const reason = logoRejectReason(raw, buckets);
    if (reason === null) return { image: teamLogoOf(raw, buckets), reason: "ok" };
    if (reason !== "none" && firstReason === null) firstReason = reason;
  }
  return { image: null, reason: firstReason || "none" };
}

// ── 代表 ────────────────────────────────────────────────────────────────
/** 主站 Rules 代表 uid：非空字串才收，去重、排序（只為比對穩定）。沒有代表回 []。 */
function repUidsFromTeam(teamData) {
  const out = new Set();
  if (!teamData || typeof teamData !== "object") return [];
  for (const field of REP_STRING_FIELDS) {
    const v = teamData[field];
    if (typeof v === "string" && v.length > 0) out.add(v);
  }
  const list = teamData[REP_LIST_FIELD];
  if (Array.isArray(list)) {
    for (const v of list) {
      if (typeof v === "string" && v.length > 0) out.add(v);
    }
  }
  return [...out].sort();
}

/** 鏡像內容（不含 srcUpdatedAt）。name：非空字串原樣（不 trim），否則 null。 */
function clubMirrorFromTeam(teamData, { buckets } = {}) {
  const data = teamData && typeof teamData === "object" ? teamData : {};
  return {
    repUids: repUidsFromTeam(data),
    name: typeof data.name === "string" && data.name.length > 0 ? data.name : null,
    image: pickTeamImage(data, buckets).image,
  };
}

/**
 * 既有鏡像是否要重寫：不存在 → 寫；欄位名集合（去掉 srcUpdatedAt）不是剛好 {repUids,name,image}
 * （例如多了 seededBy）→ 寫；三欄內容不同 → 寫。srcUpdatedAt 不參與比對。
 */
function needsWrite(existingData, planned) {
  if (!existingData || typeof existingData !== "object") return true;
  const keys = Object.keys(existingData).filter((key) => key !== "srcUpdatedAt").sort();
  if (!isDeepStrictEqual(keys, [...MIRROR_CONTENT_FIELDS])) return true;
  const existingReps = existingData.repUids;
  if (!Array.isArray(existingReps) || existingReps.length !== planned.repUids.length) return true;
  const sortedExisting = [...existingReps].sort();
  if (sortedExisting.some((v, i) => v !== planned.repUids[i])) return true;
  return existingData.name !== planned.name || existingData.image !== planned.image;
}

/**
 * 觸發器與回填共用的決策（D4）：
 * - 主站隊伍不存在：鏡像存在 → delete；否則 none。
 * - 主站隊伍存在、鏡像不存在、沒有代表 → skip-no-reps（從未建過鏡像的無代表隊不寫）。
 * - 其他：needsWrite 為真 → set（含已有鏡像但代表全被移除 → 寫 repUids: []），否則 none。
 */
function planMirrorAction({ teamExists, teamData, mirrorExists, mirrorData, buckets }) {
  if (!teamExists) return { action: mirrorExists ? "delete" : "none", doc: null };
  const doc = clubMirrorFromTeam(teamData, { buckets });
  if (!mirrorExists && doc.repUids.length === 0) return { action: "skip-no-reps", doc: null };
  if (mirrorExists && !needsWrite(mirrorData, doc)) return { action: "none", doc };
  return { action: "set", doc };
}

function projectTeamForMirror(data) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  for (const field of PROJECTION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) out[field] = data[field];
  }
  return out;
}

/** 遮罩 teamId：只留前 13 碼（tm_ 加時間戳前 10 碼），不留亂數尾碼。 */
function maskTeamId(teamId) {
  const id = String(teamId || "");
  return id.length <= 13 ? `${id.slice(0, 4)}…` : `${id.slice(0, 13)}…`;
}

// 需要人處理的錯誤（多半是 IAM 或資料庫不存在）：除了一般失敗 log，另記一行固定前綴的告警方便搜尋。
const ACCESS_ALERT_PREFIX = "[CP_CLUB_MIRROR_ACCESS_ALERT]";
const ACCESS_ALERT_CODES = new Map([
  [7, "PERMISSION_DENIED"], ["permission-denied", "PERMISSION_DENIED"], ["PERMISSION_DENIED", "PERMISSION_DENIED"],
  [5, "NOT_FOUND"], ["not-found", "NOT_FOUND"], ["NOT_FOUND", "NOT_FOUND"],
]);

/** 錯誤訊息寫進 log 前遮罩：teamId 原文、文件路徑（含 projects/…/documents/ 全路徑）一律換成遮罩版。 */
function sanitizeErrorMessage(message, teamId) {
  // 先遮罩全文、最後才截斷（取代原「先截 500」：teamId 跨在截斷邊界時，半截不會被整段比對遮掉，複審 P3）
  let text = String(message || "");
  text = text.replace(/projects\/[^\s"'`]*?\/documents\/[^\s"'`]+/g, "<doc-path>");
  text = text.replace(/\b(teams|cpClubs)\/[^\s"'`/]+/g, (_m, col) => `${col}/<id>`);
  if (typeof teamId === "string" && teamId.length > 0) text = text.split(teamId).join(maskTeamId(teamId));
  return text.slice(0, 300);
}

function eventAgeMs(event, nowMs) {
  const eventMs = Date.parse(String(event?.time || ""));
  return Number.isFinite(eventMs) ? Math.max(0, nowMs - eventMs) : 0;
}

/**
 * 觸發器 handler（可注入，供單元測試與模擬器測試直接呼叫）。
 * 冪等：不信事件 payload，在 asia-main transaction 內先讀鏡像、再重讀主站 teams 現況後決定；
 * 結果只由主站現況決定。Firestore 讀寫失敗記 error 後重拋，讓平台重試（retry: true）。
 */
function createOnTeamWrittenForCompetitionsHandler({
  db,
  getCpDb,
  FieldValue,
  logger,
  env = process.env,
  now = () => Date.now(),
}) {
  let warnedEmptyBuckets = false;
  return async (event) => {
    const teamId = event?.params?.teamId;
    if (typeof teamId !== "string" || !TEAM_ID_RE.test(teamId)) {
      logger.warn("[onTeamWrittenForCompetitions] bad teamId, skipped", { teamId: maskTeamId(teamId) });
      return { status: "bad-id" };
    }
    const ageMs = eventAgeMs(event, now());
    if (ageMs > MAX_EVENT_AGE_MS) {
      logger.warn("[onTeamWrittenForCompetitions] stale event dropped; resync with backfill --team", {
        teamId: maskTeamId(teamId),
        ageMinutes: Math.round(ageMs / 60000),
      });
      return { status: "stale" };
    }
    const before = event?.data?.before;
    const after = event?.data?.after;
    if (before?.exists && after?.exists
      && isDeepStrictEqual(projectTeamForMirror(before.data()), projectTeamForMirror(after.data()))) {
      return { status: "unchanged" };
    }

    const buckets = allowedLogoBuckets(env);
    if (buckets.length === 0 && !warnedEmptyBuckets) {
      warnedEmptyBuckets = true;
      logger.error("[onTeamWrittenForCompetitions] logo bucket allowlist is empty; image will be null", {
        hint: "set CP_LOGO_BUCKETS",
      });
    }

    const cpDb = getCpDb();
    const mirrorRef = cpDb.collection(CP_CLUBS_COLLECTION).doc(teamId);
    const teamRef = db.collection(TEAMS_COLLECTION).doc(teamId);
    try {
      const result = await cpDb.runTransaction(async (tx) => {
        // 先讀鏡像（transaction 內），再讀主站現況：並發事件之間不會用舊的主站狀態蓋掉新的鏡像。
        const mirrorSnap = await tx.get(mirrorRef);
        const teamSnap = await teamRef.get();
        const plan = planMirrorAction({
          teamExists: teamSnap.exists,
          teamData: teamSnap.exists ? teamSnap.data() : null,
          mirrorExists: mirrorSnap.exists,
          mirrorData: mirrorSnap.exists ? mirrorSnap.data() : null,
          buckets,
        });
        if (plan.action === "delete") {
          tx.delete(mirrorRef);
        } else if (plan.action === "set") {
          tx.set(mirrorRef, {
            repUids: plan.doc.repUids,
            name: plan.doc.name,
            image: plan.doc.image,
            srcUpdatedAt: FieldValue.serverTimestamp(),
          });
        }
        return { action: plan.action, created: plan.action === "set" && !mirrorSnap.exists, repCount: plan.doc ? plan.doc.repUids.length : 0 };
      });
      if (result.action === "set" || result.action === "delete") {
        logger.info("[onTeamWrittenForCompetitions] mirror written", {
          teamId: maskTeamId(teamId),
          action: result.action === "set" ? (result.created ? "create" : "update") : "delete",
          repCount: result.repCount,
        });
      }
      return { status: result.action };
    } catch (err) {
      const code = err?.code ?? null;
      logger.error("[onTeamWrittenForCompetitions] mirror sync failed; will retry", {
        teamId: maskTeamId(teamId),
        code,
        message: sanitizeErrorMessage(err?.message || err, teamId),
      });
      const alert = ACCESS_ALERT_CODES.get(code);
      if (alert) {
        logger.error(`${ACCESS_ALERT_PREFIX} ${alert} on cross-database mirror sync; check IAM / asia-main database`, {
          teamId: maskTeamId(teamId),
          code,
        });
      }
      throw err;
    }
  };
}

const TRIGGER_OPTIONS = Object.freeze({
  region: REGION,
  document: `${TEAMS_COLLECTION}/{teamId}`,
  database: "(default)",
  memory: "256MiB",
  cpu: "gcf_gen1",
  timeoutSeconds: 60,
  maxInstances: 2,
  retry: true,
});

function createCpClubMirrorExports({ onDocumentWritten, db, getFirestore, FieldValue, logger }) {
  let cpDb = null;
  const getCpDb = () => {
    if (!cpDb) cpDb = getFirestore(CP_DATABASE_ID);
    return cpDb;
  };
  return {
    onTeamWrittenForCompetitions: onDocumentWritten(
      { ...TRIGGER_OPTIONS },
      createOnTeamWrittenForCompetitionsHandler({ db, getCpDb, FieldValue, logger }),
    ),
  };
}

module.exports = {
  ACCESS_ALERT_PREFIX,
  CP_CLUBS_COLLECTION,
  CP_DATABASE_ID,
  IMAGE_VARIANT_ORDER,
  LOGO_HOST,
  MAX_EVENT_AGE_MS,
  MIRROR_CONTENT_FIELDS,
  MIRROR_FIELDS,
  PROJECTION_FIELDS,
  REP_FIELDS,
  REP_LIST_FIELD,
  REP_STRING_FIELDS,
  TEAMS_COLLECTION,
  TEAM_ID_RE,
  TEAM_LOGO_MAX,
  TRIGGER_OPTIONS,
  allowedLogoBuckets,
  clubMirrorFromTeam,
  createCpClubMirrorExports,
  createOnTeamWrittenForCompetitionsHandler,
  isAllowedLogoUrl,
  logoRejectReason,
  maskTeamId,
  needsWrite,
  pickTeamImage,
  planMirrorAction,
  projectTeamForMirror,
  repUidsFromTeam,
  sanitizeErrorMessage,
  teamImageCandidates,
  teamLogoOf,
};
