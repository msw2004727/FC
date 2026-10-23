"use strict";

// 與 functions/qa-test-mode-core.js 同步。腳本獨立執行，不 require functions/。

const QA_UID_RE = /^U0{28}[0-9]{4}$/;
const QA_DISPLAY_NAME_PREFIX = "QA測試-";
const QA_ALLOWED_ROLES = new Set(["user", "coach", "captain", "venue_owner"]);
const QA_CONFIG_COLLECTION = "qaTestMode";
const QA_CONFIG_DOC_ID = "config";
const QA_THROTTLE_COLLECTION = "qaTestAuthThrottle";
const QA_DEFAULT_SESSION_CAP_HOURS = 12;
const QA_DEFAULT_MAX_FUTURE_HOURS = 168;
const QA_DEFAULT_THROTTLE = Object.freeze({
  perIp: Object.freeze({ maxFailures: 5, windowSec: 600, lockSec: 900 }),
  global: Object.freeze({ maxFailures: 100, windowSec: 600, lockSec: 300 }),
});
// 與核心 QA_CLIENT_IP_XFF_FROM_RIGHT 同步：x-forwarded-for 由右數第幾段視為客戶端 IP。
const QA_CLIENT_IP_XFF_FROM_RIGHT = 1;
const DANGEROUS_CLAIM_EXACT_KEYS = new Set([
  "role",
  "admin",
  "isAdmin",
  "super_admin",
  "superAdmin",
]);
const QA_TEAM_NAME = "QA測試俱樂部";
const QA_UID_RANGE_START = "U" + "0".repeat(28) + "0000";
const QA_UID_RANGE_END = "U" + "0".repeat(28) + "9999";
const QA_APPLICANT_UID = "U" + "0".repeat(28) + "0012";

const GRPC_CODE_NAMES = {
  1: "CANCELLED",
  2: "UNKNOWN",
  3: "INVALID_ARGUMENT",
  4: "DEADLINE_EXCEEDED",
  5: "NOT_FOUND",
  7: "PERMISSION_DENIED",
  8: "RESOURCE_EXHAUSTED",
  9: "FAILED_PRECONDITION",
  10: "ABORTED",
  13: "INTERNAL",
  14: "UNAVAILABLE",
  16: "UNAUTHENTICATED",
};

// 設計表 §13 的 11 類。probes 用既有 type 即可擴充，不在此增刪類別。
const CLEANUP_CATEGORIES = [
  {
    key: "userRoot",
    label: "使用者主檔與子集合",
    kind: "doc",
    probes: [
      {
        type: "docTree",
        collection: "users",
        subcollections: [
          "inbox",
          "pmMeta",
          "identityPrivate",
          "achievements",
          "autoExpTracking",
          "game",
          "gamePublic",
          "gameInbox",
        ],
        nested: [{ parent: "pmThreads", child: "messages" }],
      },
    ],
  },
  {
    key: "uidDocCollections",
    label: "以 uid 為文件 id 的頂層集合",
    kind: "doc",
    probes: [
      {
        type: "docId",
        docs: [
          { collection: "userCorrections" },
          { collection: "userPermissionGrants" },
          { collection: "userPermissionGrantAudit", subcollections: ["entries"] },
          { collection: "shotGameScores", subcollections: ["attempts"] },
          { collection: "kickGameScores", subcollections: ["attempts"] },
          { collection: "userAttendanceStats" },
          { collection: "userAttendanceStatsQueue" },
        ],
      },
    ],
  },
  {
    key: "uidFieldCollections",
    label: "以 uid 欄位為鍵的頂層集合",
    kind: "collectionQuery",
    probes: [
      { type: "where", scope: "collection", name: "attendanceRecords", field: "uid", op: "eq" },
      { type: "where", scope: "collection", name: "activityRecords", field: "uid", op: "eq" },
      { type: "where", scope: "collection", name: "expLogs", field: "uid", op: "eq" },
      { type: "where", scope: "collection", name: "registrations", field: "userId", op: "eq" },
      { type: "where", scope: "collection", name: "operationLogs", field: "uid", op: "eq" },
      { type: "where", scope: "collection", name: "operationLogs", field: "actorUid", op: "eq" },
      { type: "where", scope: "collection", name: "operationLogs", field: "userId", op: "eq" },
      { type: "where", scope: "collection", name: "linePushQueue", field: "uid", op: "eq" },
      { type: "where", scope: "collection", name: "linePushQueue", field: "targetDocId", op: "eq" },
      { type: "where", scope: "collection", name: "linePushQueue", field: "requestedByUid", op: "eq" },
    ],
  },
  {
    key: "eventSubcollections",
    label: "活動子集合",
    kind: "collectionGroup",
    probes: [
      { type: "where", scope: "collectionGroup", name: "registrations", field: "userId", op: "eq" },
      { type: "where", scope: "collectionGroup", name: "registrations", field: "uid", op: "eq" },
      { type: "where", scope: "collectionGroup", name: "attendanceRecords", field: "uid", op: "eq" },
      { type: "where", scope: "collectionGroup", name: "activityRecords", field: "uid", op: "eq" },
      { type: "where", scope: "collectionGroup", name: "comments", field: "uid", op: "eq" },
      { type: "where", scope: "collectionGroup", name: "replies", field: "uid", op: "eq" },
      { type: "where", scope: "collectionGroup", name: "likes", field: "uid", op: "eq" },
    ],
  },
  {
    key: "events",
    label: "活動本體",
    kind: "collectionQuery",
    note: "QA 建立的活動需站長確認後才可刪；非 QA 建立者只清欄位",
    probes: [
      { type: "where", scope: "collection", name: "events", field: "creatorUid", op: "eq", warn: "event" },
      { type: "where", scope: "collection", name: "events", field: "captainUid", op: "eq", warn: "event" },
      { type: "where", scope: "collection", name: "events", field: "delegateUids", op: "array-contains", warn: "event" },
    ],
  },
  {
    key: "teams",
    label: "俱樂部",
    kind: "collectionQuery",
    note: "測試俱樂部依設定留或刪；真實俱樂部若含 QA UID 只清欄位",
    probes: [
      { type: "where", scope: "collection", name: "teams", field: "captainUid", op: "eq", warn: "team" },
      { type: "where", scope: "collection", name: "teams", field: "creatorUid", op: "eq", warn: "team" },
      { type: "where", scope: "collection", name: "teams", field: "leaderUids", op: "array-contains", warn: "team" },
      { type: "where", scope: "collection", name: "teams", field: "coachUids", op: "array-contains", warn: "team" },
      { type: "where", scope: "collection", name: "users", field: "teamId", op: "eq", values: "qaTeamIds", warn: "userTeam" },
      { type: "where", scope: "collection", name: "users", field: "teamIds", op: "array-contains", values: "qaTeamIds", warn: "userTeam" },
    ],
  },
  {
    key: "joinRequests",
    label: "入隊申請",
    kind: "collectionQuery",
    note: "含真人那一側的收件匣副本，刪除前需人工確認",
    probes: [
      {
        type: "subWhere",
        parent: "users",
        subcollection: "inbox",
        field: "actionType",
        value: "team_join_request",
      },
      {
        type: "where",
        scope: "collectionGroup",
        name: "inbox",
        field: "meta.applicantUid",
        op: "eq",
        filterAction: "team_join_request",
      },
      { type: "where", scope: "collection", name: "messages", field: "fromUid", op: "eq" },
      { type: "where", scope: "collection", name: "messages", field: "toUid", op: "eq" },
      { type: "where", scope: "collection", name: "messages", field: "recipientUid", op: "eq" },
    ],
  },
  {
    key: "tournaments",
    label: "賽事",
    kind: "collectionQuery",
    matches: "未盤點",
    note: "matches 裁判欄位未盤點",
    probes: [
      { type: "where", scope: "collection", name: "tournaments", field: "delegateUids", op: "array-contains" },
      { type: "where", scope: "collectionGroup", name: "applications", field: "requestedByUid", op: "eq" },
      { type: "where", scope: "collectionGroup", name: "members", field: "uid", op: "eq" },
    ],
  },
  {
    key: "pmPeerCopies",
    label: "私訊對方側副本",
    kind: "collectionGroup",
    note: "真人側副本需人工確認",
    probes: [{ type: "pmPeer" }],
  },
  {
    key: "auditEntries",
    label: "稽核（只讀）",
    kind: "readOnly",
    note: "不刪，180 天自然到期",
    probes: [
      { type: "where", scope: "collectionGroup", name: "auditEntries", field: "actorUid", op: "eq" },
    ],
  },
  {
    key: "authUsers",
    label: "Firebase Auth",
    kind: "authUsers",
    probes: [{ type: "authUsers" }],
  },
];

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function qaUid(tail) {
  return "U" + "0".repeat(28) + String(tail);
}

function normalizeHours(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) &&
    value > 0 && value <= 720 ? value : fallback;
}

function normalizeXffFromRight(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5
    ? value : QA_CLIENT_IP_XFF_FROM_RIGHT;
}

// 只回傳鍵名。null、陣列與其他非純物件回空陣列。比對大小寫敏感。
function findDangerousClaimKeys(customClaims) {
  if (!isPlainObject(customClaims)) return [];
  const found = [];
  for (const key of Object.keys(customClaims)) {
    if (DANGEROUS_CLAIM_EXACT_KEYS.has(key) ||
        key.startsWith("permissions") ||
        key.startsWith("rolePermissions")) {
      found.push(key);
    }
  }
  return found;
}

function copyThrottle(raw, defaults) {
  const value = isPlainObject(raw) ? raw : {};
  const integer = (key, maximum) =>
    Number.isInteger(value[key]) && value[key] >= 1 && value[key] <= maximum
      ? value[key] : defaults[key];
  return {
    maxFailures: integer("maxFailures", 1000),
    windowSec: integer("windowSec", 86400),
    lockSec: integer("lockSec", 86400),
  };
}

function parseArgs(argv) {
  const source = Array.isArray(argv) ? argv : [];
  let start = 0;
  if (source[0] && !String(source[0]).startsWith("-") &&
      source[1] && !String(source[1]).startsWith("-")) {
    start = 2;
  }

  const args = {
    project: "",
    execute: false,
    production: false,
    confirmProject: "",
    enable: false,
    out: "",
    help: false,
  };
  const valued = new Set(["--project", "--confirm-project", "--out"]);
  const bools = new Set(["--execute", "--production", "--enable", "--help"]);

  for (let index = start; index < source.length; index += 1) {
    const token = String(source[index]);
    if (token === "--") break;
    if (!token.startsWith("--")) {
      throw new Error(`未知參數：${token}`);
    }
    if (bools.has(token)) {
      if (token === "--execute") args.execute = true;
      else if (token === "--production") args.production = true;
      else if (token === "--enable") args.enable = true;
      else args.help = true;
      continue;
    }
    if (!valued.has(token)) {
      throw new Error(`未知旗標：${token}`);
    }
    const value = source[index + 1];
    if (value == null || String(value).startsWith("--") || !String(value).trim()) {
      throw new Error(`旗標 ${token} 需要值`);
    }
    index += 1;
    const text = String(value).trim();
    if (token === "--project") args.project = text;
    else if (token === "--confirm-project") args.confirmProject = text;
    else args.out = text;
  }
  return args;
}

function resolveTarget({ args, env }) {
  const flags = args || {};
  const environment = env || {};
  const fromFlag = typeof flags.project === "string" ? flags.project.trim() : "";
  const fromEnv = typeof environment.GCLOUD_PROJECT === "string"
    ? environment.GCLOUD_PROJECT.trim() : "";
  const projectId = fromFlag || fromEnv;
  if (!projectId) {
    throw new Error("缺少專案 ID：請提供 --project <id> 或環境變數 GCLOUD_PROJECT（沒有預設值）");
  }

  const firestoreHost = typeof environment.FIRESTORE_EMULATOR_HOST === "string"
    ? environment.FIRESTORE_EMULATOR_HOST.trim() : "";
  const authHost = typeof environment.FIREBASE_AUTH_EMULATOR_HOST === "string"
    ? environment.FIREBASE_AUTH_EMULATOR_HOST.trim() : "";
  if ((firestoreHost && !authHost) || (!firestoreHost && authHost)) {
    throw new Error("FIRESTORE_EMULATOR_HOST 與 FIREBASE_AUTH_EMULATOR_HOST 必須同時設定，避免一半走模擬器、一半打到正式環境");
  }

  const execute = flags.execute === true;
  if (firestoreHost && authHost) {
    return { mode: "emulator", projectId, write: execute };
  }

  if (flags.production !== true) {
    throw new Error("目前不是 emulator。正式環境必須加上 --production 才繼續");
  }

  const confirm = typeof flags.confirmProject === "string" ? flags.confirmProject.trim() : "";
  if (!execute) {
    if (confirm && confirm !== projectId) {
      throw new Error("--confirm-project 與專案 ID 不符");
    }
    return { mode: "production", projectId, write: false };
  }
  if (!confirm) {
    throw new Error("正式環境寫入需要 --execute 與 --confirm-project，且值必須與專案 ID 相同");
  }
  if (confirm !== projectId) {
    throw new Error("--confirm-project 與專案 ID 不符，已拒絕寫入");
  }
  return { mode: "production", projectId, write: true };
}

// 與 A 的 js/config.js generateId 同格式：前綴 + 毫秒 + _ + base36 六碼。
function generateId(prefix) {
  return (prefix || "") + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

function defaultPersonas() {
  return {
    captain: {
      uid: qaUid("0001"),
      displayName: "QA測試-隊長",
      role: "captain",
      teamKey: "main",
      enabled: true,
    },
    coach: {
      uid: qaUid("0002"),
      displayName: "QA測試-教練",
      role: "coach",
      teamKey: "main",
      enabled: true,
    },
    // 場主入測試俱樂部（作一般成員）：場主權限只看 role；入隊不影響且不會被自動降級；俱樂部限定活動可見／報名需 teamId
    venueOwner: {
      uid: qaUid("0003"),
      displayName: "QA測試-場主",
      role: "venue_owner",
      teamKey: "main",
      enabled: true,
    },
    memberA: {
      uid: qaUid("0011"),
      displayName: "QA測試-會員甲",
      role: "user",
      teamKey: "main",
      enabled: true,
    },
    memberB: {
      uid: QA_APPLICANT_UID,
      displayName: "QA測試-會員乙",
      role: "user",
      teamKey: "main",
      enabled: true,
    },
  };
}

function clonePersona(persona) {
  return {
    uid: persona.uid,
    displayName: persona.displayName,
    role: persona.role,
    teamKey: persona.teamKey,
    enabled: persona.enabled !== false,
  };
}

function buildConfigDoc({ existing, enable, personas, teamId } = {}) {
  const prev = isPlainObject(existing) ? existing : {};
  const enabled = enable === true ? true : prev.enabled === true;
  const prevThrottle = isPlainObject(prev.throttle) ? prev.throttle : {};
  const personasOut = {};
  if (isPlainObject(prev.personas)) {
    for (const key of Object.keys(prev.personas)) {
      const persona = prev.personas[key];
      personasOut[key] = isPlainObject(persona) ? { ...persona } : persona;
    }
  }
  const incoming = isPlainObject(personas) ? personas : defaultPersonas();
  for (const key of Object.keys(incoming)) {
    if (!Object.prototype.hasOwnProperty.call(personasOut, key) && isPlainObject(incoming[key])) {
      personasOut[key] = clonePersona(incoming[key]);
    }
  }

  const teams = {};
  const prevTeams = isPlainObject(prev.teams) ? prev.teams : {};
  for (const key of Object.keys(prevTeams)) {
    if (key === "main") continue;
    teams[key] = prevTeams[key];
  }
  const prevMain = isPlainObject(prevTeams.main) ? prevTeams.main : {};
  const existingTeamId = typeof prevMain.teamId === "string" ? prevMain.teamId.trim() : "";
  teams.main = {
    teamId: existingTeamId || (typeof teamId === "string" ? teamId.trim() : ""),
    name: QA_TEAM_NAME,
  };

  return {
    enabled,
    clientIpXffFromRight: normalizeXffFromRight(prev.clientIpXffFromRight),
    sessionCapHours: normalizeHours(prev.sessionCapHours, QA_DEFAULT_SESSION_CAP_HOURS),
    maxFutureHours: normalizeHours(prev.maxFutureHours, QA_DEFAULT_MAX_FUTURE_HOURS),
    throttle: {
      perIp: copyThrottle(prevThrottle.perIp, QA_DEFAULT_THROTTLE.perIp),
      global: copyThrottle(prevThrottle.global, QA_DEFAULT_THROTTLE.global),
    },
    personas: personasOut,
    teams,
  };
}

// memberB（申請人槽 0012）預設不入隊；其餘 teamKey=main 的 persona 才入隊。
function shouldJoinPersona(key, persona) {
  if (!isPlainObject(persona)) return false;
  if (persona.joinTeam === false) return false;
  if (key === "memberB" || persona.key === "memberB") return false;
  if (persona.uid === QA_APPLICANT_UID) return false;
  if (typeof persona.teamKey === "string" && persona.teamKey && persona.teamKey !== "main") {
    return false;
  }
  return true;
}

function buildUserDoc({ persona, team, now } = {}) {
  const person = isPlainObject(persona) ? persona : {};
  const joins = shouldJoinPersona(person.key || "", person) &&
    isPlainObject(team) && typeof team.teamId === "string" && team.teamId;
  const teamName = joins ? (typeof team.name === "string" ? team.name : "") : null;
  return {
    uid: person.uid,
    lineUserId: person.uid,
    displayName: person.displayName,
    pictureUrl: null,
    email: null,
    role: person.role,
    exp: 0,
    level: 1,
    gender: null,
    birthday: null,
    region: null,
    sports: null,
    teamId: joins ? team.teamId : null,
    teamName,
    teamIds: joins ? [team.teamId] : [],
    teamNames: joins ? [teamName] : [],
    phone: null,
    titleBig: null,
    titleNormal: null,
    totalGames: 0,
    completedGames: 0,
    attendanceRate: 0,
    badgeCount: 0,
    createdAt: now,
    lastLogin: now,
  };
}

function personaList(personas) {
  if (Array.isArray(personas)) {
    return personas.filter(isPlainObject).map((persona) => [persona.key || "", persona]);
  }
  if (!isPlainObject(personas)) return [];
  return Object.keys(personas).map((key) => [key, personas[key]]);
}

function buildTeamDoc({ teamId, name, personas, memberCount, now } = {}) {
  const list = personaList(personas);
  const captain = list.map((entry) => entry[1]).find((persona) => persona && persona.role === "captain") || null;
  const coaches = list.map((entry) => entry[1]).filter((persona) => persona && persona.role === "coach");
  const joined = list.filter(([key, persona]) => shouldJoinPersona(key, persona)).length;
  const members = Number.isInteger(memberCount) ? memberCount : joined;
  const captainName = captain ? captain.displayName : "";
  return {
    id: teamId,
    name: typeof name === "string" && name ? name : QA_TEAM_NAME,
    nameEn: "",
    nationality: "",
    leader: "",
    leaderUid: null,
    leaders: [],
    leaderUids: [],
    leaderNames: [],
    captain: captainName,
    captainUid: captain ? captain.uid : null,
    captainName,
    coaches: coaches.map((persona) => persona.displayName),
    coachUids: coaches.map((persona) => persona.uid),
    coachNames: coaches.map((persona) => persona.displayName),
    members,
    region: "",
    founded: "",
    contact: "",
    bio: "QA 測試用俱樂部，可清理",
    image: "",
    contactLinksEnabled: false,
    contactLinks: [],
    active: true,
    pinned: false,
    pinOrder: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    history: [],
    // team-form.js:106 新建分支缺值為 competitive；:105 sportTag 缺值為空字串。
    // teachingEnabled 同 :110，type 不是 education 則為 false。
    type: "competitive",
    sportTag: "",
    teachingEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
}

function maskUid(uid) {
  return String(uid || "").slice(0, 4) + "***";
}

function maskSegment(segment, qaUidSet) {
  if (/^U[0-9a-fA-F]{32}$/.test(segment) && qaUidSet && !qaUidSet.has(segment)) {
    return maskUid(segment);
  }
  if (segment.startsWith("pm_")) {
    return segment.split("_").map((part) => {
      if (/^U[0-9a-fA-F]{32}$/.test(part) && qaUidSet && !qaUidSet.has(part)) {
        return maskUid(part);
      }
      return part;
    }).join("_");
  }
  return segment;
}

function maskPath(pathValue, qaUidSet) {
  return String(pathValue || "").split("/").map((segment) => maskSegment(segment, qaUidSet)).join("/");
}

function reasonCode(err) {
  if (!err || typeof err !== "object") return "unknown";
  const code = err.code;
  if (typeof code === "number" && GRPC_CODE_NAMES[code]) return GRPC_CODE_NAMES[code];
  if (typeof code === "string" && code.trim()) {
    const text = code.trim();
    if (/^\d+$/.test(text) && GRPC_CODE_NAMES[Number(text)]) {
      return GRPC_CODE_NAMES[Number(text)];
    }
    return text;
  }
  return "unknown";
}

function loadAdmin() {
  const path = require("path");
  return require(require.resolve("firebase-admin", {
    paths: [path.join(__dirname, "..", "..", "functions")],
  }));
}

function initAdmin(projectId) {
  const admin = loadAdmin();
  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }
  return admin;
}

module.exports = {
  QA_UID_RE,
  QA_DISPLAY_NAME_PREFIX,
  QA_ALLOWED_ROLES,
  QA_CONFIG_COLLECTION,
  QA_CONFIG_DOC_ID,
  QA_THROTTLE_COLLECTION,
  QA_DEFAULT_SESSION_CAP_HOURS,
  QA_DEFAULT_MAX_FUTURE_HOURS,
  QA_DEFAULT_THROTTLE,
  QA_CLIENT_IP_XFF_FROM_RIGHT,
  QA_TEAM_NAME,
  QA_UID_RANGE_START,
  QA_UID_RANGE_END,
  QA_APPLICANT_UID,
  CLEANUP_CATEGORIES,
  parseArgs,
  resolveTarget,
  generateId,
  defaultPersonas,
  findDangerousClaimKeys,
  buildConfigDoc,
  buildUserDoc,
  buildTeamDoc,
  shouldJoinPersona,
  maskUid,
  maskPath,
  reasonCode,
  loadAdmin,
  initAdmin,
};
