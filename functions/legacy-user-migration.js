"use strict";

/**
 * 健檢 C1-03 第二步：舊格式會員文件由後端代為轉成正本 users/{uid}（migrateLegacyUserDoc）。
 *
 * 適用：正本 users/{uid} 不存在、users 中恰有一筆 lineUserId == uid 的舊文件（文件 ID ≠ uid），
 * 而前端因 Rules 建立條件（俱樂部欄位、createdAt、exp、level、白名單外欄位）無法自行轉移。
 *
 * 守則（顧問 §3.144）：
 *  - 只遷呼叫者本人：uid 一律取自 request.auth，不讀 request.data。
 *  - 交易內以 create 寫正本；正本已存在一律回 already、不覆寫。
 *  - createdAt／exp／level 照舊文件原值；限制類欄位（isRestricted 等）原樣帶過去。
 *  - role 缺欄或 'user' 才遷；其他角色、Rules 禁止的鍵、白名單外的鍵、型別不符一律回 not-migratable，
 *    不靜默改值；此函式不碰 custom claims。
 *  - 舊文件不刪不改。稽核紀錄與 log 只留遮罩後的 uid。
 */

const crypto = require("crypto");

const AUDIT_COLLECTION = "userMigrationAudits";

// 與 firestore.rules users#userRootCreateAllowedKeys() 同步。
const RULES_CREATE_ALLOWED_KEYS = Object.freeze([
  "uid", "lineUserId", "displayName", "photoURL", "pictureUrl", "phone", "email",
  "role", "exp", "level",
  "gender", "birthday", "region", "sports",
  "teamId", "teamName", "teamIds", "teamNames",
  "titleBig", "titleNormal",
  "totalGames", "completedGames", "attendanceRate", "badgeCount",
  "profileCompleted",
  "createdAt", "lastLogin", "updatedAt",
  "termsAcceptedAt", "privacyAcceptedAt", "termsVersion", "privacyVersion", "legalAcceptedSource",
  "favorites", "socialLinks", "lineNotify", "companions", "eduChildren", "stealth",
]);

// 與 firestore.rules users#forbiddenUserRootCreateKeys() 同步：舊文件有任何一個就不代遷。
const FORBIDDEN_KEYS = Object.freeze([
  "identities", "profileActiveIdentityId", "identityPrivate", "activeIdentity", "selectedIdentity",
  "permissions", "permissionCodes", "rolePermissions", "claims", "manualRole",
  "isAdmin", "isSuperAdmin", "admin", "super_admin", "customClaims",
]);

// 帳號限制欄位（adminManageUser 與 A 用戶管理頁寫入；user-directory／team-role-promotion 讀 restricted 別名）：
// 不在 Rules 建立白名單，但必須原樣帶到正本，不得因代遷被洗掉。
const RESTRICTION_KEYS = Object.freeze([
  "isRestricted", "restricted", "restrictedAt", "restrictedByUid", "restrictedByName",
]);

// 伺服器維護的放鴿子統計（calcNoShowCounts 會重算）：照帶，避免重算前短暫歸零。
const SERVER_STAT_KEYS = Object.freeze(["noShowCount", "endedRegCount", "lastEventWasNoShow"]);

const TEAM_KEYS = Object.freeze(["teamId", "teamName", "teamIds", "teamNames"]);
// 由本函式決定的欄位：不從舊文件照抄。
const SERVER_SET_KEYS = Object.freeze(["uid", "lineUserId", "displayName", "role", "lastLogin", "updatedAt"]);

const CARRY_KEYS = new Set([...RULES_CREATE_ALLOWED_KEYS, ...RESTRICTION_KEYS, ...SERVER_STAT_KEYS]);
const MAX_TEAMS = 10;

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNullOr = (check) => (value) => value === null || check(value);
const isString = (value) => typeof value === "string";
const isInt = (value) => Number.isInteger(value);
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

// 型別條件取自 Rules isSafeUserRootCreate；exp／level 只要求有限數字（原值照帶，不要求 0／1）。
const TYPE_CHECKS = Object.freeze({
  photoURL: isNullOr(isString),
  pictureUrl: isNullOr(isString),
  phone: isNullOr(isString),
  email: isNullOr(isString),
  gender: isNullOr(isString),
  birthday: isNullOr(isString),
  region: isNullOr(isString),
  sports: isNullOr(isString),
  titleBig: isNullOr(isString),
  titleNormal: isNullOr(isString),
  totalGames: isInt,
  completedGames: isInt,
  attendanceRate: isFiniteNumber,
  badgeCount: isInt,
  profileCompleted: (value) => typeof value === "boolean",
  favorites: isNullOr((value) => isPlainObject(value) || Array.isArray(value)),
  socialLinks: isNullOr(isPlainObject),
  lineNotify: isNullOr(isPlainObject),
  companions: isNullOr(Array.isArray),
  eduChildren: isNullOr(Array.isArray),
  stealth: isNullOr((value) => typeof value === "boolean"),
  exp: isFiniteNumber,
  level: isFiniteNumber,
  createdAt: (value) => value !== null && value !== undefined,
});

// log／稽核用：保留前 2 後 2 碼（同 notification-fields.js#maskUid）。
function maskUid(uid) {
  const text = String(uid || "");
  if (text.length <= 4) return "*".repeat(text.length);
  return `${text.slice(0, 2)}${"*".repeat(text.length - 4)}${text.slice(-2)}`;
}

// 稽核文件 ID：uid 的 SHA-256 前 32 碼，同一人只有一份紀錄，文件 ID 不含原始 uid。
function auditDocId(uid) {
  return `lm_${crypto.createHash("sha256").update(String(uid)).digest("hex").slice(0, 32)}`;
}

const nonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

/**
 * 俱樂部欄位正規化（與 Rules 增減俱樂部的 oldTeamIds 推導一致）：
 * teamIds 非空就用（去重、保序），否則以非空 teamId 補成 [teamId]；teamId = teamIds[0]、teamName = teamNames[0]。
 * 回傳 ids 與已知名稱（缺的名稱為 null，由呼叫端讀 teams 補）。
 */
function normalizeTeamMembership(legacy) {
  const rawIds = legacy.teamIds;
  const rawNames = legacy.teamNames;
  if (rawIds !== undefined && rawIds !== null && !Array.isArray(rawIds)) return { invalid: ["teamIds"] };
  if (Array.isArray(rawIds) && rawIds.some((id) => !nonEmptyString(id))) return { invalid: ["teamIds"] };
  if (legacy.teamId !== undefined && legacy.teamId !== null && !isString(legacy.teamId)) return { invalid: ["teamId"] };

  const names = new Map();
  let ids;
  if (Array.isArray(rawIds) && rawIds.length > 0) {
    ids = [];
    rawIds.forEach((id, index) => {
      if (ids.includes(id)) return;
      ids.push(id);
      const name = Array.isArray(rawNames) && rawNames.length === rawIds.length ? rawNames[index] : undefined;
      if (isString(name)) names.set(id, name);
    });
  } else if (nonEmptyString(legacy.teamId)) {
    ids = [legacy.teamId];
    if (isString(legacy.teamName)) names.set(legacy.teamId, legacy.teamName);
  } else {
    ids = [];
  }
  if (ids.length > MAX_TEAMS) return { invalid: ["teamIds"] };
  return { ids, names: ids.map((id) => (names.has(id) ? names.get(id) : null)) };
}

/**
 * 純函式：判斷舊文件能否由後端代遷。ok 為 true 時 base 是要照抄的欄位（不含俱樂部與伺服器決定的欄位）。
 * reasons 依嚴重度排序，第一個就是回傳給前端的 reason。
 */
function assessLegacyUserDoc(legacy, uid) {
  const data = isPlainObject(legacy) ? legacy : {};
  const keys = Object.keys(data);
  const reasons = [];
  const detail = {};

  if (data.lineUserId !== uid || (data.uid !== undefined && data.uid !== null && data.uid !== uid)) {
    reasons.push("uid-mismatch");
  }
  const forbiddenKeys = keys.filter((key) => FORBIDDEN_KEYS.includes(key));
  if (forbiddenKeys.length > 0) {
    reasons.push("forbidden-keys");
    detail.forbiddenKeys = forbiddenKeys;
  }
  if (data.role !== undefined && data.role !== null && data.role !== "user") {
    reasons.push("role-not-user");
    detail.legacyRole = isString(data.role) ? data.role.slice(0, 40) : typeof data.role;
  }
  const unknownKeys = keys.filter((key) => !CARRY_KEYS.has(key) && !FORBIDDEN_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    reasons.push("unknown-keys");
    detail.unknownKeys = unknownKeys;
  }
  const invalidKeys = keys.filter((key) => TYPE_CHECKS[key] && !TYPE_CHECKS[key](data[key]));
  const team = normalizeTeamMembership(data);
  if (team.invalid) invalidKeys.push(...team.invalid);
  if (invalidKeys.length > 0) {
    reasons.push("invalid-field");
    detail.invalidKeys = [...new Set(invalidKeys)];
  }

  if (reasons.length > 0) return { ok: false, reasons, detail };

  const base = {};
  keys.forEach((key) => {
    if (TEAM_KEYS.includes(key) || SERVER_SET_KEYS.includes(key)) return;
    base[key] = data[key];
  });
  return { ok: true, reasons, detail, base, team };
}

function buildMigratedUserDoc({ uid, legacy, base, teamIds, teamNames, authName, serverTimestamp }) {
  const displayName = [legacy.displayName, authName].find(nonEmptyString) || uid;
  const doc = {
    ...base,
    uid,
    lineUserId: uid,
    displayName,
    role: "user",
    teamId: teamIds.length > 0 ? teamIds[0] : null,
    teamName: teamIds.length > 0 ? teamNames[0] : null,
    teamIds,
    teamNames,
    lastLogin: serverTimestamp,
    updatedAt: serverTimestamp,
  };
  if (!("createdAt" in base)) doc.createdAt = serverTimestamp;
  return doc;
}

function isAlreadyExistsError(error) {
  return error?.code === 6 || error?.code === "already-exists" || error?.code === "ALREADY_EXISTS";
}

async function migrateLegacyUserDoc(request, { db, HttpsError, FieldValue, logger }) {
  const uid = request?.auth?.uid;
  if (!nonEmptyString(uid)) throw new HttpsError("unauthenticated", "Authentication required");
  // 只遷呼叫者本人：刻意不讀 request.data。
  const masked = maskUid(uid);
  const usersRef = db.collection("users");
  const userRef = usersRef.doc(uid);
  const auditRef = db.collection(AUDIT_COLLECTION).doc(auditDocId(uid));
  const authName = request.auth.token?.name;

  let outcome;
  try {
    outcome = await db.runTransaction(async (tx) => {
      const current = await tx.get(userRef);
      if (current.exists) return { status: "already" };

      const legacySnap = await tx.get(usersRef.where("lineUserId", "==", uid).limit(2));
      const docs = (legacySnap?.docs || []).filter((doc) => doc.id !== uid);
      if (docs.length === 0) return { status: "no-legacy" };
      if (docs.length > 1) {
        return { status: "not-migratable", reason: "ambiguous-legacy", reasons: ["ambiguous-legacy"], detail: {} };
      }

      const legacyDoc = docs[0];
      const legacy = legacyDoc.data() || {};
      const assessment = assessLegacyUserDoc(legacy, uid);
      const legacyDocPrefix = legacyDoc.id.slice(0, 4);
      if (!assessment.ok) {
        return {
          status: "not-migratable",
          reason: assessment.reasons[0],
          reasons: assessment.reasons,
          detail: assessment.detail,
          legacyDocPrefix,
        };
      }

      const { ids, names } = assessment.team;
      const missing = ids.filter((id, index) => names[index] === null);
      const teamSnaps = await Promise.all(missing.map((id) => tx.get(db.collection("teams").doc(id))));
      const fetched = new Map(missing.map((id, index) => [id, teamSnaps[index]]));
      const unresolvedTeams = [];
      const teamNames = ids.map((id, index) => {
        if (names[index] !== null) return names[index];
        const snap = fetched.get(id);
        const name = snap?.exists ? snap.data()?.name : null;
        if (isString(name)) return name;
        unresolvedTeams.push(id);
        return "";
      });

      const serverTimestamp = FieldValue.serverTimestamp();
      tx.create(userRef, buildMigratedUserDoc({
        uid, legacy, base: assessment.base, teamIds: ids, teamNames, authName, serverTimestamp,
      }));
      tx.set(auditRef, {
        uidMasked: masked,
        legacyDocPrefix,
        status: "migrated",
        reason: null,
        teamCount: ids.length,
        unresolvedTeamNames: unresolvedTeams.length,
        createdAtPreserved: "createdAt" in assessment.base,
        restricted: legacy.isRestricted === true || legacy.restricted === true,
        updatedAt: serverTimestamp,
      }, { merge: true });
      return { status: "migrated", teamCount: ids.length, unresolvedTeams: unresolvedTeams.length };
    });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      outcome = { status: "already" };
    } else {
      logger.error("[migrateLegacyUserDoc] transaction failed", {
        uid: masked,
        code: error?.code ?? null,
        message: error?.message || String(error),
      });
      throw new HttpsError("internal", "Legacy user migration failed");
    }
  }

  if (outcome.status === "migrated") {
    logger.info("[migrateLegacyUserDoc] migrated", {
      uid: masked, teamCount: outcome.teamCount, unresolvedTeams: outcome.unresolvedTeams,
    });
    return { status: "migrated" };
  }

  if (outcome.status === "not-migratable") {
    logger.warn("[migrateLegacyUserDoc] not migratable", { uid: masked, reasons: outcome.reasons });
    // 稽核是附帶紀錄：寫失敗只記錄，不改變回傳結果（R-CF-003）。
    try {
      await auditRef.set({
        uidMasked: masked,
        legacyDocPrefix: outcome.legacyDocPrefix || null,
        status: "not-migratable",
        reason: outcome.reason,
        reasons: outcome.reasons,
        legacyRole: outcome.detail.legacyRole || null,
        forbiddenKeys: outcome.detail.forbiddenKeys || [],
        unknownKeys: outcome.detail.unknownKeys || [],
        invalidKeys: outcome.detail.invalidKeys || [],
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      logger.error("[migrateLegacyUserDoc] audit write failed", {
        uid: masked,
        code: error?.code ?? null,
        message: error?.message || String(error),
      });
    }
    return { status: "not-migratable", reason: outcome.reason };
  }

  return { status: outcome.status };
}

module.exports = {
  AUDIT_COLLECTION,
  CARRY_KEYS,
  FORBIDDEN_KEYS,
  RESTRICTION_KEYS,
  RULES_CREATE_ALLOWED_KEYS,
  assessLegacyUserDoc,
  auditDocId,
  maskUid,
  migrateLegacyUserDoc,
  normalizeTeamMembership,
};
