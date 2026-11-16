"use strict";

/**
 * 通知關係查詢／決策測試共用工具（不是測試檔）。
 * - createMemoryDb：以路徑為鍵的記憶體 Firestore，支援 doc().get、collection().where(==、array-contains).limit().get，
 *   並記錄每次讀取（reads），可用 faults 讓指定文件或查詢丟錯。
 * - createHelpers：複製 functions/index.js 內注入給查詢模組的純邏輯 helper 行為（查詢模組不 require index.js）。
 * - bindReviewAccess：把 index.js 的 getCallerAccessContext／assertCallerCanReviewGroupActionDocs 綁到同一份記憶體 db，
 *   讓 R4 通知與審核動作用同一套權限函式（2026-11-16 顧問 §3.180）。
 * uid 一律用假值（uidA、uidB…），不放真實識別資料。
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { parse } = require("@babel/parser");
const { isUserCreatedTeamOwner, resolveTeamSnapshot } = require("../../functions/team-membership-core");

const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

function createMemoryDb({ seed = {}, faults = {} } = {}) {
  const store = new Map(Object.entries(seed).map(([path, data]) => [path, clone(data)]));
  const reads = [];

  const snapshot = (path) => ({
    id: path.split("/").pop(),
    exists: store.has(path),
    data: () => clone(store.get(path)),
  });

  function docRef(path) {
    return {
      path,
      get: async () => {
        reads.push(`get:${path}`);
        const failure = faults.get ? faults.get(path) : null;
        if (failure) throw failure;
        return snapshot(path);
      },
      collection: (name) => collectionRef(`${path}/${name}`),
    };
  }

  function query(path, filters = [], max = Infinity) {
    return {
      where: (field, op, value) => query(path, [...filters, { field, op, value }], max),
      limit: (n) => query(path, filters, n),
      get: async () => {
        reads.push(`query:${path}:${filters.map((item) => `${item.field}${item.op}${item.value}`).join("&")}`);
        const failure = faults.query ? faults.query(path, filters) : null;
        if (failure) throw failure;
        const prefix = `${path}/`;
        const docs = [...store.keys()]
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
          .filter((key) => filters.every(({ field, op, value }) => {
            const actual = store.get(key)?.[field];
            return op === "array-contains" ? Array.isArray(actual) && actual.includes(value) : actual === value;
          }))
          .sort()
          .slice(0, max)
          .map(snapshot);
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }

  function collectionRef(path) {
    return { ...query(path), path, doc: (id) => docRef(`${path}/${id}`) };
  }

  return {
    collection: (name) => collectionRef(name),
    reads,
    readsOf: (prefix) => reads.filter((item) => item.includes(prefix)),
    set: (path, data) => store.set(path, clone(data)),
  };
}

const trimmed = (value) => String(value || "").trim();

// 與 index.js 的 isTeamStaffForData 同邏輯。
function isTeamStaffForData(team, uid) {
  if (!team || !uid) return false;
  const safeUid = trimmed(uid);
  if (!safeUid) return false;
  const leaderUids = Array.isArray(team.leaderUids)
    ? team.leaderUids.map(trimmed)
    : (team.leaderUid ? [trimmed(team.leaderUid)] : []);
  const coachUids = Array.isArray(team.coachUids) ? team.coachUids.map(trimmed) : [];
  return trimmed(team.captainUid) === safeUid || trimmed(team.creatorUid) === safeUid
    || trimmed(team.ownerUid) === safeUid || trimmed(team.leaderUid) === safeUid
    || leaderUids.includes(safeUid) || coachUids.includes(safeUid);
}

// 與 index.js 的 isTournamentTeamOfficerForData 同邏輯（含 leaderUids，不含 coachUids）。
function isTournamentTeamOfficerForData(team, uid) {
  if (!team || !uid) return false;
  const safeUid = trimmed(uid);
  if (!safeUid) return false;
  const leaderUids = Array.isArray(team.leaderUids) ? team.leaderUids.map(trimmed) : [];
  return trimmed(team.captainUid) === safeUid || trimmed(team.creatorUid) === safeUid
    || trimmed(team.ownerUid) === safeUid || trimmed(team.leaderUid) === safeUid
    || leaderUids.includes(safeUid);
}

function isEventDelegateForUid(eventData, uid) {
  const safeUid = trimmed(uid);
  if (!safeUid || !eventData) return false;
  const delegateUids = Array.isArray(eventData.delegateUids) ? eventData.delegateUids : [];
  return delegateUids.map(trimmed).includes(safeUid);
}

const ROLE_LEVELS = { user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5 };

function canOperatePrivateEventForAccess(access, eventData, uid) {
  if (!access || !eventData || !uid) return false;
  if (eventData.privateEvent !== true) return true;
  if (access.isSuperAdmin || (ROLE_LEVELS[access.role] || 0) >= ROLE_LEVELS.admin) return true;
  const owner = [eventData.creatorUid, eventData.ownerUid, eventData.captainUid].map(trimmed).includes(trimmed(uid));
  return owner || isEventDelegateForUid(eventData, uid);
}

// db：記憶體 Firestore。legacyDefaults：{ role: [權限碼] }＝舊路徑 getDefaultRolePermissions 的預設清單。
function createHelpers({ db, legacyDefaults = {} } = {}) {
  return {
    isTeamStaffForData,
    isTournamentTeamOfficerForData,
    isEventDelegateForUid,
    canOperatePrivateEventForAccess,
    isActiveRegistration: (reg = {}) => reg.status === "confirmed" || reg.status === "waitlisted",
    // 與 index.js 的 getEventDocByPublicId 同讀法：安全文件 id 且 data.id 相等才直取，否則 where(id).limit(1)。
    getEventDocByPublicId: async (eventId) => {
      if (!eventId) return null;
      if (/^[A-Za-z0-9_-]{1,120}$/.test(eventId)) {
        const direct = await db.collection("events").doc(eventId).get();
        if (direct.exists && (direct.data() || {}).id === eventId) return direct;
      }
      const snap = await db.collection("events").where("id", "==", eventId).limit(1).get();
      return snap.docs.length > 0 ? snap.docs[0] : null;
    },
    // 與 index.js 的 getRolePermissionsFromFirestore 同行為：user／super_admin 為空；文件不存在或沒有 permissions 欄位走預設。
    legacyHasPermission: async (role, code) => {
      if (role === "user" || role === "super_admin" || !role) return false;
      const snap = await db.collection("rolePermissions").doc(role).get();
      if (!snap.exists) return (legacyDefaults[role] || []).includes(code);
      const data = snap.data() || {};
      if (!Object.prototype.hasOwnProperty.call(data, "permissions")) return (legacyDefaults[role] || []).includes(code);
      return Array.isArray(data.permissions) && data.permissions.includes(code);
    },
    // 與 index.js helpers.callableAccess 相同的 request 形狀，裡頭是真正的 getCallerAccessContext。
    callableAccess: (ctx) => bindReviewAccess(db).getCallerAccessContext({
      auth: {
        uid: typeof ctx?.callerUid === "string" ? ctx.callerUid.trim() : "",
        token: { role: typeof ctx?.callerRole === "string" ? ctx.callerRole : "" },
      },
    }),
  };
}

const REVIEW_CONSTS = [
  "VALID_ROLES",
  "DISABLED_PERMISSION_CODES",
  "LEGACY_PERMISSION_CODE_REPLACEMENTS",
  "SECONDARY_IDENTITY_PERMISSION",
  "ROLE_LEVELS",
  "INHERENT_ROLE_PERMISSIONS",
  "DEFAULT_ROLE_ENTRY_PERMISSION_RULES",
  "DEFAULT_ADMIN_PERMISSION_CODES",
  "USER_PERMISSION_GRANT_ALLOWED_CODES",
  "ROLE_ACTIVITY_CAPABILITY_CODES",
  "DEFAULT_USER_ACTIVITY_CAPABILITIES",
];
const REVIEW_FNS = [
  "normalizeRole",
  "normalizeBuiltInRole",
  "normalizePermissionCode",
  "sanitizePermissionCodeList",
  "sanitizeUserPermissionGrantCodeList",
  "getDefaultRolePermissions",
  "sanitizeRoleActivityCapabilityList",
  "findUserDocByUidOrLineUserId",
  "getUserRoleFromFirestore",
  "getCallerRoleWithFallback",
  "getRolePermissionsFromFirestore",
  "getUserPermissionGrantsFromFirestore",
  "getRoleActivityCapabilitiesFromFirestore",
  "getCallerAccessContext",
  "isRoleAdminOrAbove",
  "isTeamStaffForData",
  "getTeamDocByTeamId",
  "assertCallerCanReviewGroupActionDocs",
];

let reviewScript = null;

function buildReviewSource() {
  const file = path.join(__dirname, "../../functions/index.js");
  const source = fs.readFileSync(file, "utf8");
  const ast = parse(source, { sourceType: "script" });
  const consts = [];
  const fns = new Map();
  for (const node of ast.program.body) {
    if (node.type === "VariableDeclaration") {
      for (const declarator of node.declarations) {
        if (declarator.id.type === "Identifier" && REVIEW_CONSTS.includes(declarator.id.name)) {
          consts.push(`${node.kind} ${source.slice(declarator.start, declarator.end)};`);
        }
      }
    }
    if (node.type === "FunctionDeclaration" && node.id && REVIEW_FNS.includes(node.id.name)) {
      fns.set(node.id.name, source.slice(node.start, node.end));
    }
  }
  const missing = REVIEW_FNS.filter((name) => !fns.has(name));
  const missingConsts = REVIEW_CONSTS.filter((name) => !consts.some((line) => line.includes(` ${name} `) || line.startsWith(`const ${name} `) || line.startsWith(`let ${name} `)));
  if (missing.length > 0 || missingConsts.length > 0) {
    throw new Error(`R4 review sandbox missing: ${[...missingConsts, ...missing].join(", ")}`);
  }
  return `${consts.join("\n")}\n${REVIEW_FNS.map((name) => fns.get(name)).join("\n")}`;
}

class ReviewHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "HttpsError";
  }
}

const reviewSandboxes = new WeakMap();

// 同一 db 只組一次。callableAccess 與 mayReviewAction 共用這份 getCallerAccessContext。
function bindReviewAccess(db) {
  if (reviewSandboxes.has(db)) return reviewSandboxes.get(db);
  if (!reviewScript) reviewScript = new vm.Script(buildReviewSource(), { filename: "r4-review-access.vm.js" });
  const sandbox = {
    db,
    console: { warn() {}, log() {}, error() {}, info() {} },
    resolveTeamSnapshot,
    isUserCreatedTeamOwner,
    HttpsError: ReviewHttpsError,
  };
  reviewScript.runInNewContext(sandbox);
  const api = {
    getCallerAccessContext: sandbox.getCallerAccessContext,
    // 入隊審核動作的布林結果：可審核 true；permission-denied false；其他錯誤往外丟。
    async mayReviewAction(uid, teamId = "t1") {
      const docs = [{ data: () => ({ actionType: "team_join_request", meta: { teamId } }) }];
      try {
        await sandbox.assertCallerCanReviewGroupActionDocs(
          { auth: { uid, token: {} } },
          docs,
          "g1",
        );
        return true;
      } catch (err) {
        if (err && err.code === "permission-denied") return false;
        throw err;
      }
    },
  };
  reviewSandboxes.set(db, api);
  return api;
}

// 常用 ctx 組裝器：預設呼叫者 uidA（role user），收件者 uidB。
function makeCtx(overrides = {}) {
  return {
    source: "client:line-push",
    keys: {},
    callerUid: "uidA",
    callerRole: "user",
    recipientUid: "uidB",
    recipientFound: null,
    extra: {},
    ...overrides,
  };
}

module.exports = { createMemoryDb, createHelpers, makeCtx, bindReviewAccess };
