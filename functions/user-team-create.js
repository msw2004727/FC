"use strict";

/**
 * T-090i 一般用戶建立俱樂部 Callable（createUserTeam）。
 * 顧問裁定（6.3.5 第 1 點）：一般用戶建俱樂部的唯一寫入路徑；教練以上與 team.create 持有者仍走既有建立機制。
 * 同一個 transaction 內完成：身分（users.role 必須明確為 user）、開關（roleActivityCapabilities/user）、
 * 每人自建上限與冪等（同一查詢）、伺服器產生 id、teams create、建立者 users 四欄追加。
 * 欄位語意對齊 A js/modules/team/team-form.js#handleSaveTeam 建立分支與 B teams-create.ts basicKeys；
 * 幹部欄位、管理員專屬欄位與身分欄位一律由伺服器決定。
 * T-090d（P2-1）：教學功能（B2）對自建俱樂部一律不開放，故拒絕 type==='education'、任何 eduSettings 與
 * teachingEnabled:true（固定回 invalid-argument／CREATE_USER_TEAM_TYPE_NOT_ALLOWED），teachingEnabled 一律寫 false；
 * 取代原「education 可建、teachingEnabled 由分類推導」，避免出現「教學俱樂部卻無課程」的半套狀態。
 */

const crypto = require("crypto");
const { normalizeId } = require("./team-membership-core");
const { buildJoinedMembership } = require("./team-join-review");

const TEAM_CREATE_CAPABILITY = "user.activity.team_create";
// 每人經本 Callable 自建的俱樂部上限（可調；早報給站長改數字）。
const MAX_USER_CREATED_TEAMS = 3;
// 同 Rules isSafeGrantedTeamReviewJoinUpdate 的 oldTeamIds.size() <= 10 上限：建立後最多 10 個。
const MAX_MEMBERSHIP_TEAMS = 10;
const MAX_ID_ATTEMPTS = 5;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const TEAM_ID_RE = /^tm_\d{13}_[a-z0-9]{6}$/;

// B teams-create.ts basicKeys；以外的欄位（id、createdVia、ownerUid、members、pinned…）一律拒絕。
const BASIC_KEYS = new Set([
  "name", "nameEn", "nationality", "region", "founded", "contact", "bio",
  "contactLinksEnabled", "contactLinks",
  "leader", "leaderUid", "leaders", "leaderUids", "leaderNames",
  "captain", "captainUid", "captainName",
  "coaches", "coachUids", "coachNames",
  "type", "sportTag", "teachingEnabled", "eduSettings",
  "image", "imageVariants",
]);
// 幹部欄位（leader*／captain*／coach*）在 basicKeys 內但由伺服器決定（經理＝建立者、領隊與教練為空），
// sanitizeTeamInput 不讀取客戶端值。
// 長度上限取 A pages/team.html 與 B TeamFormModal.tsx 的 maxlength；nameEn 無 UI 上限，取 50。
const TEXT_LIMITS = Object.freeze({ nameEn: 50, nationality: 20, region: 20, contact: 100, bio: 500 });
const NAME_MAX = 15;
// 自建俱樂部可用分類；education 由 rejectTeachingInput 先以 CREATE_USER_TEAM_TYPE_NOT_ALLOWED 拒絕（T-090d）。
const TEAM_TYPES = new Set(["none", "competitive", "leisure"]);
const SPORT_TAG_RE = /^[a-z][a-z0-9_]{0,31}$/;
// 同 B team-contact-links.ts TEAM_CONTACT_LINKS_MAX 與 TeamContactPlatformKey。
const CONTACT_LINKS_MAX = 5;
const CONTACT_PLATFORMS = new Set([
  "line", "facebook", "instagram", "threads", "x", "youtube", "tiktok", "discord", "telegram", "linktree", "link",
]);
const URL_MAX = 2048;

const isPlainObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const hasOnlyKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const isHttpsUrl = value => typeof value === "string" && value.length <= URL_MAX && /^https:\/\/[^\s]+$/.test(value);
const isWebUrl = value => typeof value === "string" && value.length <= URL_MAX && /^https?:\/\/[^\s]+$/.test(value);

// 6 碼 base36 小寫；同 A generateId('tm_') 格式，但固定 6 碼（A 的 Math.random 偶爾少於 6 碼）。
function defaultRandomSuffix() {
  return crypto.randomInt(0, 36 ** 6).toString(36).padStart(6, "0");
}

// 回傳 null 表示該欄位不合格；回傳 { value } 表示合格（含預設值）。
function sanitizeTeamInput(team) {
  const out = {};
  const name = typeof team.name === "string" ? team.name.trim() : "";
  if (!name || name.length > NAME_MAX) return null;
  out.name = name;
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    if (team[key] === undefined) { out[key] = ""; continue; }
    if (typeof team[key] !== "string") return null;
    const value = team[key].trim();
    if (value.length > max) return null;
    out[key] = value;
  }
  if (team.founded === undefined || team.founded === "") out.founded = "";
  else if (typeof team.founded === "string" && /^\d{4}$/.test(team.founded.trim())) out.founded = team.founded.trim();
  else return null;

  if (team.contactLinksEnabled === undefined) out.contactLinksEnabled = false;
  else if (typeof team.contactLinksEnabled === "boolean") out.contactLinksEnabled = team.contactLinksEnabled;
  else return null;
  if (team.contactLinks === undefined) out.contactLinks = [];
  else {
    if (!Array.isArray(team.contactLinks) || team.contactLinks.length > CONTACT_LINKS_MAX) return null;
    const links = [];
    for (const link of team.contactLinks) {
      if (!isPlainObject(link) || !hasOnlyKeys(link, ["url", "platform", "label", "host"])) return null;
      if (!isWebUrl(link.url) || !CONTACT_PLATFORMS.has(link.platform)) return null;
      if (typeof link.label !== "string" || link.label.length > 253) return null;
      if (typeof link.host !== "string" || link.host.length > 253) return null;
      links.push({ url: link.url, platform: link.platform, label: link.label, host: link.host });
    }
    out.contactLinks = links;
  }

  if (team.type === undefined) out.type = "none";
  else if (TEAM_TYPES.has(team.type)) out.type = team.type;
  else return null;
  if (team.sportTag === undefined || team.sportTag === "") out.sportTag = "";
  else if (typeof team.sportTag === "string" && SPORT_TAG_RE.test(team.sportTag)) out.sportTag = team.sportTag;
  else return null;
  // 自建俱樂部不開教學（T-090d）：客戶端只能省略或給 false；eduSettings 不寫入。
  if (team.teachingEnabled !== undefined && team.teachingEnabled !== false) return null;
  if (team.eduSettings !== undefined) return null;
  out.teachingEnabled = false;

  if (team.image === undefined || team.image === null) out.image = null;
  else if (isHttpsUrl(team.image)) out.image = team.image;
  else return null;
  if (team.imageVariants !== undefined) {
    const variants = team.imageVariants;
    if (!isPlainObject(variants) || !hasOnlyKeys(variants, ["cover", "card"])) return null;
    const kept = {};
    for (const key of ["cover", "card"]) {
      if (variants[key] === undefined) continue;
      if (!isHttpsUrl(variants[key])) return null;
      kept[key] = variants[key];
    }
    if (kept.cover || kept.card) out.imageVariants = kept;
  }
  return out;
}

// 教學相關輸入（education 分類、任何 eduSettings、teachingEnabled:true）回 true；先於一般欄位驗證，給固定原因碼。
function rejectTeachingInput(team) {
  return team.type === "education" || team.eduSettings !== undefined || team.teachingEnabled === true;
}

function readCapabilityDecision(capSnap) {
  // 與 functions/index.js DEFAULT_USER_ACTIVITY_CAPABILITIES 一致：文件不存在時預設清單含本碼。
  if (!capSnap.exists) return "allow";
  const capabilities = (capSnap.data() || {}).capabilities;
  // 同 sanitizeRoleActivityCapabilityList：非陣列視為空清單，不回退預設。
  if (!Array.isArray(capabilities)) return "invalid";
  return capabilities.includes(TEAM_CREATE_CAPABILITY) ? "allow" : "disabled";
}

function createUserTeamHandler({
  db, HttpsError, FieldValue, logger = console, now = Date.now, randomSuffix = defaultRandomSuffix,
  maxUserCreatedTeams = MAX_USER_CREATED_TEAMS,
}) {
  return async function createUserTeamHandlerImpl(request) {
    let stage = "input";
    let attempts = 0;
    // 只有本模組固定的原因碼可以回給前端；SDK／底層錯誤一律不外洩。
    const safeErrors = new Set();
    const fail = (code, reason) => {
      const error = new HttpsError(code, reason);
      safeErrors.add(error);
      throw error;
    };
    try {
      const callerUid = request?.auth?.uid;
      if (typeof callerUid !== "string" || !callerUid) fail("unauthenticated", "AUTH_REQUIRED");
      if (normalizeId(callerUid) !== callerUid) fail("invalid-argument", "INVALID_CALLER_UID");
      const input = request?.data;
      if (!isPlainObject(input)) fail("invalid-argument", "CREATE_USER_TEAM_INVALID_FIELD");
      if (!hasOnlyKeys(input, ["requestId", "team"])) fail("invalid-argument", "CREATE_USER_TEAM_UNKNOWN_FIELD");
      if (typeof input.requestId !== "string" || !REQUEST_ID_RE.test(input.requestId)) {
        fail("invalid-argument", "CREATE_USER_TEAM_INVALID_REQUEST_ID");
      }
      const requestId = input.requestId;
      if (!isPlainObject(input.team)) fail("invalid-argument", "CREATE_USER_TEAM_INVALID_FIELD");
      if (!Object.keys(input.team).every(key => BASIC_KEYS.has(key))) fail("invalid-argument", "CREATE_USER_TEAM_UNKNOWN_FIELD");
      if (rejectTeachingInput(input.team)) fail("invalid-argument", "CREATE_USER_TEAM_TYPE_NOT_ALLOWED");
      const basic = sanitizeTeamInput(input.team);
      if (!basic) fail("invalid-argument", "CREATE_USER_TEAM_INVALID_FIELD");

      const teams = db.collection("teams");
      // 保留 SDK retry：交易內不得把 ABORTED 轉成 HttpsError。
      return await db.runTransaction(async tx => {
        attempts += 1;
        stage = "caller";
        // 同 Rules authRole() 讀 users/{auth.uid}；但缺 role 欄位不回退 token 或 user（T-090a 保守拒絕）。
        const userRef = db.collection("users").doc(callerUid);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) fail("failed-precondition", "USER_PROFILE_NOT_FOUND");
        const userData = userSnap.data() || {};
        if (["uid", "lineUserId"].some(field => {
          const value = userData[field];
          return value !== undefined && value !== null && value !== "" && value !== callerUid;
        })) fail("failed-precondition", "USER_IDENTITY_MISMATCH");
        if (typeof userData.role !== "string" || !userData.role.trim()) fail("permission-denied", "CREATE_USER_TEAM_ROLE_UNVERIFIED");
        if (userData.role.trim() !== "user") fail("permission-denied", "CREATE_USER_TEAM_ROLE_DENIED");
        if (userData.teamIds != null && !Array.isArray(userData.teamIds)) fail("failed-precondition", "INVALID_MEMBERSHIP");
        if (userData.teamNames != null && !Array.isArray(userData.teamNames)) fail("failed-precondition", "INVALID_MEMBERSHIP");

        stage = "quota";
        const capSnap = await tx.get(db.collection("roleActivityCapabilities").doc("user"));
        // 同一查詢兼做冪等與上限：兩個等值條件可用單欄位索引合併，不需複合索引；在交易內讀，併發建立會互相 ABORT。
        const owned = await tx.get(teams.where("creatorUid", "==", callerUid)
          .where("createdVia", "==", "user_capability").limit(maxUserCreatedTeams + 1));
        // 冪等先於開關與上限：已成功的請求重送時回同一個俱樂部，不因之後關開關或達上限而報錯。
        const duplicate = owned.docs.find(doc => (doc.data() || {}).createRequestId === requestId);
        if (duplicate) return { ok: true, teamId: duplicate.id, created: false };

        stage = "capability";
        const decision = readCapabilityDecision(capSnap);
        if (decision === "invalid") fail("permission-denied", "TEAM_CREATE_CAPABILITY_INVALID");
        if (decision !== "allow") fail("permission-denied", "TEAM_CREATE_CAPABILITY_DISABLED");
        stage = "quota";
        if (owned.docs.length >= maxUserCreatedTeams) fail("resource-exhausted", "USER_TEAM_CREATE_LIMIT");
        // 追加後的筆數＝既有（teamIds ∪ teamId 去重）＋1。
        if (buildJoinedMembership(userData, "", basic.name).teamIds.length > MAX_MEMBERSHIP_TEAMS) {
          fail("resource-exhausted", "TEAM_MEMBERSHIP_LIMIT");
        }

        stage = "id";
        let teamId = "";
        for (let i = 0; i < MAX_ID_ATTEMPTS && !teamId; i++) {
          const candidate = `tm_${now()}_${randomSuffix()}`;
          if (!TEAM_ID_RE.test(candidate)) continue;
          if (!(await tx.get(teams.doc(candidate))).exists) teamId = candidate;
        }
        if (!teamId) fail("aborted", "TEAM_ID_COLLISION");
        // 形狀同 reviewTeamJoin（isSafeGrantedTeamReviewJoinUpdate）：舊清單保留、新俱樂部追加在最後。
        const membership = buildJoinedMembership(userData, teamId, basic.name);

        const captainName = String(userData.displayName || userData.name || "").trim();
        const teamDoc = {
          ...basic,
          id: teamId,
          // 幹部：建立者為經理；領隊、教練之後只能從成員中指派（B T-090d）。
          leader: "", leaderUid: null, leaders: [], leaderUids: [], leaderNames: [],
          captain: captainName, captainUid: callerUid, captainName,
          coaches: [], coachUids: [], coachNames: [],
          // 身分與來源（Rules B6／B7 不可變）。
          createdVia: "user_capability", creatorUid: callerUid, ownerUid: callerUid,
          createRequestId: requestId,
          // 建立者同交易寫入 teamIds，成員數即 1。
          members: 1,
          // 管理員專屬欄位：同 A 建立分支的預設值；pinned 以外的 attentionEffect*、teamExp、viewCount、views 不寫（缺值＝預設）。
          active: true, pinned: false, pinOrder: 0,
          wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, history: [],
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        stage = "commit";
        tx.create(teams.doc(teamId), teamDoc);
        tx.update(userRef, membership);
        return { ok: true, teamId, created: true };
      });
    } catch (error) {
      const aborted = error?.code === 10 || error?.code === "aborted" || error?.code === "ABORTED";
      const known = safeErrors.has(error);
      const code = known ? error.code : (aborted ? "aborted" : "internal");
      const reason = known ? error.message : (aborted ? "CREATE_USER_TEAM_RETRY" : "CREATE_USER_TEAM_FAILED");
      // 結構化 log 只留固定欄位，不寫 UID、teamId、requestId 或底層錯誤訊息。
      logger.error("[createUserTeam] failed", { function: "createUserTeam", stage, attempts, code, reason });
      throw new HttpsError(code, reason);
    }
  };
}

function createUserTeamCallable({ onCall, ...dependencies }) {
  return onCall({ region: "asia-east1" }, createUserTeamHandler(dependencies));
}

module.exports = {
  createUserTeamCallable,
  createUserTeamHandler,
  sanitizeTeamInput,
  BASIC_KEYS,
  MAX_USER_CREATED_TEAMS,
  MAX_MEMBERSHIP_TEAMS,
  TEAM_CREATE_CAPABILITY,
};
