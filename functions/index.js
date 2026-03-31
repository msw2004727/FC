const {
  onDocumentCreated,
  onDocumentWrittenWithAuthContext,
} = require("firebase-functions/v2/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, FieldPath, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
// @line/bot-sdk: lazy-loaded — 只有 processLinePushQueue 使用
let _messagingApi;
function getMessagingApi() {
  if (!_messagingApi) {
    _messagingApi = require("@line/bot-sdk").messagingApi;
  }
  return _messagingApi;
}
const https = require("https");

initializeApp();
const db = getFirestore();
const authAdmin = getAuth();

const LINE_CHANNEL_ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");
const NEWS_API_KEY = defineSecret("NEWS_API_KEY");
const VALID_ROLES = new Set([
  "user",
  "coach",
  "captain",
  "venue_owner",
  "admin",
  "super_admin",
]);
const DISABLED_PERMISSION_CODES = new Set(["admin.roles.entry"]);
const ADMIN_USER_EDIT_PROFILE_PERMISSION = "admin.users.edit_profile";
const ADMIN_USER_CHANGE_ROLE_PERMISSION = "admin.users.change_role";
const ADMIN_USER_RESTRICT_PERMISSION = "admin.users.restrict";
const ADMIN_MANAGED_USER_PROFILE_FIELDS = Object.freeze([
  "region",
  "gender",
  "birthday",
  "sports",
  "phone",
]);
const ROLE_LEVELS = Object.freeze({
  user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5,
});
// ⚠️ 同步規則：修改此常數時必須同步更新 js/config.js 中的同名常數 INHERENT_ROLE_PERMISSIONS
const INHERENT_ROLE_PERMISSIONS = Object.freeze({
  coach:       ["activity.manage.entry", "admin.tournaments.entry"],
  captain:     ["activity.manage.entry", "admin.tournaments.entry"],
  venue_owner: ["activity.manage.entry", "admin.tournaments.entry"],
});
const ALLOWED_AUDIT_ACTIONS = new Set([
  "login_success",
  "login_failure",
  "logout",
  "event_signup",
  "event_cancel_signup",
  "team_join_request",
  "team_join_approve",
  "team_join_reject",
  "role_change",
  "admin_user_edit",
]);
const ALLOWED_AUDIT_TARGET_TYPES = new Set([
  "system",
  "user",
  "event",
  "team",
  "message",
]);
const ALLOWED_AUDIT_RESULTS = new Set(["success", "failure"]);
const ALLOWED_AUDIT_SOURCES = new Set(["web", "liff", "system", "cloud_function"]);
const ALLOWED_AUDIT_META_KEYS = new Set([
  "eventId",
  "teamId",
  "messageId",
  "reasonCode",
  "statusFrom",
  "statusTo",
]);
const AUDIT_RETENTION_DAYS = 180;
const CHANGE_WATCH_RETENTION_DAYS = 180;
const CHANGE_WATCH_FUNCTION_OPTIONS = Object.freeze({
  region: "asia-east1",
  timeoutSeconds: 15,
  memory: "128MiB",
  cpu: "gcf_gen1",
  maxInstances: 2,
});
const CHANGE_WATCH_ROLE_CACHE_TTL_MS = 5 * 60 * 1000;
const CHANGE_WATCH_EVENT_CACHE_TTL_MS = 5 * 60 * 1000;
const CHANGE_WATCH_TRUSTED_ROLES = new Set([
  "coach",
  "captain",
  "venue_owner",
  "admin",
  "super_admin",
]);
const CHANGE_WATCH_SYSTEM_ACTOR_TYPES = new Set([
  "service_account",
  "system",
]);
const CHANGE_WATCH_USER_SAFE_PROFILE_FIELDS = new Set([
  "displayName",
  "photoURL",
  "pictureUrl",
  "phone",
  "updatedAt",
  "gender",
  "birthday",
  "region",
  "sports",
  "favorites",
  "socialLinks",
  "titleBig",
  "titleNormal",
  "lineNotify",
  "companions",
]);
const CHANGE_WATCH_USER_SAFE_LOGIN_FIELDS = new Set([
  "displayName",
  "pictureUrl",
  "lastLogin",
]);
const CHANGE_WATCH_USER_TEAM_FIELDS = new Set([
  "teamId",
  "teamName",
  "teamIds",
  "teamNames",
  "updatedAt",
]);
const CHANGE_WATCH_USER_PRIVILEGE_FIELDS = new Set([
  "role",
  "manualRole",
  "claims",
  "exp",
  "level",
  "isAdmin",
]);
const CHANGE_WATCH_EVENT_SIGNUP_FIELDS = new Set([
  "status",
  "current",
  "waitlist",
  "participants",
  "waitlistNames",
  "updatedAt",
]);
const CHANGE_WATCH_EVENT_OWNER_FIELDS = new Set([
  "ownerUid",
  "creatorUid",
  "captainUid",
]);
const CHANGE_WATCH_EVENT_CAPACITY_FIELDS = new Set([
  "max",
]);
const CHANGE_WATCH_MAX_NORMAL_SIGNUP_DELTA = 6;
const CHANGE_WATCH_REGISTRATION_IDENTITY_FIELDS = new Set([
  "eventId",
  "userId",
  "uid",
  "promotionOrder",
  "participantType",
  "companionId",
  "companionName",
]);
const CHANGE_WATCH_REGISTRATION_STATUS_FIELDS = new Set([
  "status",
  "cancelledAt",
  "updatedAt",
]);
const CHANGE_WATCH_ATTENDANCE_IDENTITY_FIELDS = new Set([
  "eventId",
  "uid",
]);
const CHANGE_WATCH_ATTENDANCE_STATUS_FIELDS = new Set([
  "status",
  "checkOutTime",
  "removedAt",
  "removedByUid",
  "updatedAt",
]);
const changeWatchRoleCache = new Map();
const changeWatchEventOwnerCache = new Map();
const ALLOWED_LINE_NOTIFICATION_CATEGORIES = new Set([
  "system",
  "activity",
  "tournament",
  "private",
]);
const DEFAULT_NOTIFICATION_TEMPLATES = Object.freeze([
  {
    key: "welcome",
    title: "歡迎加入 SportHub！",
    body: "嗨 {userName}，歡迎加入 SportHub 平台！\n\n您可以在這裡瀏覽並報名各類足球活動、加入俱樂部、參與聯賽。\n祝您使用愉快！",
  },
  {
    key: "signup_success",
    title: "報名成功通知",
    body: "您已成功報名以下活動：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n報名狀態：{status}\n\n請準時出席，如需取消請提前至活動頁面操作。",
  },
  {
    key: "cancel_signup",
    title: "取消報名通知",
    body: "{status}。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如需再次參加，可回到活動頁重新報名。",
  },
  {
    key: "waitlist_promoted",
    title: "候補遞補通知",
    body: "恭喜！由於有人取消報名，您已從候補名單自動遞補為正式參加者。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n請準時出席！",
  },
  {
    key: "waitlist_demoted",
    title: "候補降級通知",
    body: "因活動名額調整，您目前已改為候補狀態。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n若後續有名額釋出，系統會再通知您。",
  },
  {
    key: "event_cancelled",
    title: "活動取消通知",
    body: "很抱歉通知您，以下活動因故取消：\n\n活動名稱：{eventName}\n原定時間：{date}\n原定地點：{location}\n\n如您已繳費，費用將於 3 個工作天內退還。造成不便深感抱歉。",
  },
  {
    key: "role_upgrade",
    title: "身份變更通知",
    body: "恭喜 {userName}！您的身份已變更為「{roleName}」。\n\n新身份可能帶來新的權限與功能，請至個人資料頁面查看詳情。\n感謝您對社群的貢獻！",
  },
  {
    key: "event_changed",
    title: "活動變更通知",
    body: "您報名的活動資訊有所變更，請留意：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如因變更需要取消報名，請至活動頁面操作。",
  },
  {
    key: "event_relisted",
    title: "活動重新上架通知",
    body: "您先前報名的活動已重新上架：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n您的報名資格仍然保留，請留意活動時間。",
  },
  {
    key: "tournament_friendly_host_opened",
    title: "友誼賽已建立",
    body: "主辦俱樂部「{hostTeamName}」已開啟友誼賽「{tournamentName}」。\n\n報名截止：{regEnd}\n\n若您為主辦俱樂部成員，現在可前往賽事頁加入球員名單。",
  },
  {
    key: "tournament_friendly_team_apply_host",
    title: "有新俱樂部申請參賽",
    body: "俱樂部「{teamName}」已申請參加「{tournamentName}」。\n申請人：{applicantName}\n\n請前往賽事詳細頁進行審核。",
  },
  {
    key: "tournament_friendly_team_approved_applicant",
    title: "俱樂部申請已通過",
    body: "恭喜！您代表「{teamName}」申請參加「{tournamentName}」已通過審核。\n審核人：{reviewerName}\n\n隊員現在可加入該隊參賽名單。",
  },
  {
    key: "tournament_friendly_team_rejected_applicant",
    title: "俱樂部申請結果通知",
    body: "很抱歉，您代表「{teamName}」申請參加「{tournamentName}」未獲通過。\n審核人：{reviewerName}\n\n如有疑問請聯繫主辦方。",
  },
  {
    key: "tournament_friendly_team_approved_broadcast",
    title: "俱樂部已可加入名單",
    body: "俱樂部「{teamName}」已通過「{tournamentName}」參賽審核。\n\n若您是該隊成員，現在可前往賽事頁加入球員名單。",
  },
]);
const SHARE_SITE_ORIGIN = "https://toosterx.com";
const DEFAULT_TEAM_SHARE_OG_IMAGE = "https://firebasestorage.googleapis.com/v0/b/fc-football-6c8dc.firebasestorage.app/o/images%2Ftest%2FS__174522375.jpg?alt=media&token=73eb0e3f-a94a-4368-a6df-d4afafaa4ea0";
const DEFAULT_EVENT_SHARE_OG_IMAGE = "https://toosterx.com/assets/icons/icon-512x512.png";

function normalizeRole(role) {
  if (typeof role !== "string") return "user";
  const trimmed = role.trim();
  return trimmed || "user";
}

function normalizeBuiltInRole(role) {
  const normalized = normalizeRole(role);
  return VALID_ROLES.has(normalized) ? normalized : "user";
}

function sanitizePermissionCodeList(codes) {
  return Array.from(new Set(
    (Array.isArray(codes) ? codes : [])
      .filter(code => typeof code === "string")
      .map(code => code.trim())
      .filter(code => code && !DISABLED_PERMISSION_CODES.has(code))
  ));
}

function sanitizeAdminManagedProfileUpdates(rawUpdates) {
  if (!rawUpdates || typeof rawUpdates !== "object" || Array.isArray(rawUpdates)) {
    return {};
  }

  const next = {};
  ADMIN_MANAGED_USER_PROFILE_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(rawUpdates, field)) return;
    const value = rawUpdates[field];
    if (value == null) {
      next[field] = null;
      return;
    }
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (field === "birthday") {
      next[field] = trimmed ? trimmed.replace(/-/g, "/") : null;
      return;
    }
    next[field] = trimmed;
  });

  return next;
}

function hasAnyOwnKeys(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function getAuthErrorCode(err) {
  return err?.errorInfo?.code || err?.code || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeImageUrl(rawUrl) {
  if (typeof rawUrl !== "string") return DEFAULT_TEAM_SHARE_OG_IMAGE;
  const trimmed = rawUrl.trim();
  if (!trimmed) return DEFAULT_TEAM_SHARE_OG_IMAGE;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return DEFAULT_TEAM_SHARE_OG_IMAGE;
}

function parseTeamShareId(req) {
  const rawQueryValue = req.query?.teamId;
  const queryValue = Array.isArray(rawQueryValue) ? rawQueryValue[0] : rawQueryValue;
  if (typeof queryValue === "string" && queryValue.trim()) {
    return queryValue.trim();
  }

  const parts = String(req.path || "")
    .split("/")
    .filter(Boolean);
  if (!parts.length) return "";

  const lastSegment = parts[parts.length - 1];
  try {
    return decodeURIComponent(lastSegment).trim();
  } catch (_) {
    return String(lastSegment || "").trim();
  }
}

function buildTeamShareHtml({
  ogTitle,
  ogDescription,
  ogImage,
  ogUrl,
  redirectUrl,
}) {
  const escapedTitle = escapeHtml(ogTitle);
  const escapedDescription = escapeHtml(ogDescription);
  const escapedImage = escapeHtml(ogImage);
  const escapedOgUrl = escapeHtml(ogUrl);
  const escapedRedirectUrl = escapeHtml(redirectUrl);
  const scriptRedirectUrl = JSON.stringify(redirectUrl);

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapedTitle}</title>
  <meta property="og:title" content="${escapedTitle}">
  <meta property="og:description" content="${escapedDescription}">
  <meta property="og:image" content="${escapedImage}">
  <meta property="og:url" content="${escapedOgUrl}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapedTitle}">
  <meta name="twitter:description" content="${escapedDescription}">
  <meta name="twitter:image" content="${escapedImage}">
  <meta name="robots" content="noindex,nofollow">
  <meta http-equiv="refresh" content="0;url=${escapedRedirectUrl}">
</head>
<body>
  <script>
    location.replace(${scriptRedirectUrl});
  </script>
</body>
</html>`;
}

async function getTeamByShareId(teamId) {
  if (!teamId) return null;

  const directSnap = await db.collection("teams").doc(teamId).get();
  if (directSnap.exists) return directSnap.data() || {};

  const querySnap = await db.collection("teams")
    .where("id", "==", teamId)
    .limit(1)
    .get();
  if (querySnap.empty) return null;
  return querySnap.docs[0].data() || {};
}

async function ensureAuthUser(uid) {
  try {
    return await authAdmin.getUser(uid);
  } catch (err) {
    if (getAuthErrorCode(err) !== "auth/user-not-found") throw err;
  }

  try {
    return await authAdmin.createUser({ uid });
  } catch (err) {
    if (getAuthErrorCode(err) !== "auth/uid-already-exists") throw err;
    // Race condition: another request created the user first.
    return await authAdmin.getUser(uid);
  }
}

async function findUserDocByUidOrLineUserId(uidOrDocId) {
  const directSnap = await db.collection("users").doc(uidOrDocId).get();
  if (directSnap.exists) {
    return { docId: directSnap.id, data: directSnap.data() || {} };
  }

  const uidSnap = await db.collection("users")
    .where("uid", "==", uidOrDocId)
    .limit(1)
    .get();
  if (!uidSnap.empty) {
    const doc = uidSnap.docs[0];
    return { docId: doc.id, data: doc.data() || {} };
  }

  const qSnap = await db.collection("users")
    .where("lineUserId", "==", uidOrDocId)
    .limit(1)
    .get();
  if (!qSnap.empty) {
    const doc = qSnap.docs[0];
    return { docId: doc.id, data: doc.data() || {} };
  }

  return null;
}

function getAuthUidFromUserDoc(found, fallbackUid) {
  const data = found?.data || {};
  if (typeof data.uid === "string" && data.uid) return data.uid;
  if (typeof data.lineUserId === "string" && data.lineUserId) return data.lineUserId;
  if (typeof found?.docId === "string" && found.docId) return found.docId;
  return fallbackUid;
}

function getLineRecipientUidFromUserDoc(found, fallbackUid) {
  const data = found?.data || {};
  if (typeof data.lineUserId === "string" && data.lineUserId) return data.lineUserId;
  if (typeof data.uid === "string" && data.uid) return data.uid;
  if (typeof found?.docId === "string" && found.docId) return found.docId;
  return fallbackUid;
}

function getDisplayNameFromAuthRecord(userRecord, fallbackUid) {
  if (!userRecord || typeof userRecord !== "object") return fallbackUid;
  if (typeof userRecord.displayName === "string" && userRecord.displayName.trim()) {
    return userRecord.displayName.trim();
  }
  const providerName = Array.isArray(userRecord.providerData)
    ? userRecord.providerData.find(item => typeof item?.displayName === "string" && item.displayName.trim())
    : null;
  if (providerName?.displayName) {
    return providerName.displayName.trim();
  }
  return fallbackUid;
}

async function resolveAuditActorName(uidOrDocId, fallbackUid = "") {
  const safeFallback = String(fallbackUid || uidOrDocId || "").trim();
  const found = uidOrDocId ? await findUserDocByUidOrLineUserId(uidOrDocId) : null;
  const authUid = getAuthUidFromUserDoc(found, safeFallback);
  let authDisplayName = "";
  try {
    const authUser = await authAdmin.getUser(authUid);
    authDisplayName = getDisplayNameFromAuthRecord(authUser, "");
  } catch (_) {}

  return normalizeAuditText(
    found?.data?.displayName
      || found?.data?.name
      || authDisplayName
      || safeFallback,
    80
  );
}

function formatOperationLogTime(now = new Date()) {
  const { dayKey, timeKey } = getTaipeiAuditDateInfo(now);
  return `${dayKey.slice(4, 6)}/${dayKey.slice(6, 8)} ${timeKey.slice(0, 5)}`;
}

function buildOperationLogPayload({
  operator = "系統",
  type = "",
  typeName = "",
  content = "",
  now = new Date(),
}) {
  const safeNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  return {
    time: formatOperationLogTime(safeNow),
    operator: normalizeAuditText(operator || "系統", 80),
    type: normalizeAuditText(type, 64),
    typeName: normalizeAuditText(typeName, 80),
    content: normalizeAuditText(content, 500),
    createdAt: FieldValue.serverTimestamp(),
  };
}

async function writeOperationLog({
  operator = "系統",
  type = "",
  typeName = "",
  content = "",
  now = new Date(),
}) {
  const safeNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const docId = `op_${safeNow.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = buildOperationLogPayload({ operator, type, typeName, content, now: safeNow });
  await db.collection("operationLogs").doc(docId).set(payload, { merge: true });
  return { ...payload, _docId: docId };
}

async function getUserRoleFromFirestore(uidOrDocId) {
  const found = await findUserDocByUidOrLineUserId(uidOrDocId);
  if (!found) return "user";
  return normalizeRole(found.data?.role);
}

async function getCallerRoleWithFallback(request) {
  if (request.auth?.uid) {
    const firestoreRole = await getUserRoleFromFirestore(request.auth.uid);
    if (firestoreRole) {
      return firestoreRole;
    }
  }
  return normalizeRole(request.auth?.token?.role);
}

async function getRolePermissionsFromFirestore(roleKey) {
  const safeRole = normalizeRole(roleKey);
  if (safeRole === "user" || safeRole === "super_admin") return [];
  const snapshot = await db.collection("rolePermissions").doc(safeRole).get();
  if (!snapshot.exists) return [];
  return sanitizePermissionCodeList(snapshot.data()?.permissions);
}

async function getCallerAccessContext(request) {
  const role = await getCallerRoleWithFallback(request);
  const stored = role === "super_admin"
    ? []
    : await getRolePermissionsFromFirestore(role);
  const inherent = INHERENT_ROLE_PERMISSIONS[role] || [];
  const permissions = Array.from(new Set([...stored, ...inherent]));
  return {
    role,
    permissions,
    isSuperAdmin: role === "super_admin",
    hasPermission(code) {
      return role === "super_admin" || permissions.includes(code);
    },
  };
}

async function roleExists(roleKey) {
  const safeRole = normalizeRole(roleKey);
  if (VALID_ROLES.has(safeRole)) return true;
  if (safeRole === "user") return true;
  const snapshot = await db.collection("customRoles").doc(safeRole).get();
  return snapshot.exists;
}

async function setRoleClaimMerged(uid, role) {
  const userRecord = await authAdmin.getUser(uid);
  const currentClaims = (userRecord.customClaims && typeof userRecord.customClaims === "object")
    ? userRecord.customClaims
    : {};
  await authAdmin.setCustomUserClaims(uid, {
    ...currentClaims,
    role: normalizeRole(role),
  });
}

function normalizeLineNotificationCategory(category) {
  if (typeof category !== "string") return "";
  const trimmed = category.trim();
  return ALLOWED_LINE_NOTIFICATION_CATEGORIES.has(trimmed) ? trimmed : "";
}

function normalizeLineNotificationText(value, maxLength) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return "";
  return trimmed;
}

function getDefaultNotificationTemplates() {
  return DEFAULT_NOTIFICATION_TEMPLATES.map((template) => ({...template}));
}

async function ensureDefaultNotificationTemplates() {
  const defaults = getDefaultNotificationTemplates();
  const snapshot = await db.collection("notifTemplates").get();
  const existing = new Set(snapshot.docs.map((doc) => doc.id));
  const missing = defaults.filter((template) => !existing.has(template.key));

  if (missing.length) {
    const batch = db.batch();
    missing.forEach((template) => {
      batch.set(
        db.collection("notifTemplates").doc(template.key),
        {
          ...template,
          createdAt: FieldValue.serverTimestamp(),
        },
        {merge: true}
      );
    });
    await batch.commit();
  }

  return defaults;
}

function normalizeAuditText(value, maxLength = 120) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.slice(0, maxLength);
}

function normalizeAuditEnum(value, allowedValues, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return allowedValues.has(trimmed) ? trimmed : fallback;
}

function sanitizeAuditMeta(rawMeta) {
  if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) {
    return {};
  }

  const next = {};
  for (const [key, value] of Object.entries(rawMeta)) {
    if (!ALLOWED_AUDIT_META_KEYS.has(key)) continue;
    if (value == null) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) next[key] = trimmed.slice(0, 120);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      next[key] = value;
    }
  }
  return next;
}

function getLineNotificationSettingsKey(category) {
  return category === "private" ? "system" : category;
}

function getLineHttpStatus(err) {
  const candidates = [
    err?.statusCode,
    err?.status,
    err?.response?.status,
    err?.originalError?.response?.status,
    err?.originalError?.status,
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

async function shouldAutoUnbindLineRecipient(client, recipientUid, pushErr) {
  if (!recipientUid) {
    return { shouldUnbind: false, reason: "missing_recipient_uid" };
  }

  const pushStatus = getLineHttpStatus(pushErr);
  if (pushStatus !== 400) {
    return {
      shouldUnbind: false,
      reason: pushStatus ? `push_status_${pushStatus}` : "push_status_unknown",
    };
  }

  try {
    await client.getProfile(recipientUid);
    return { shouldUnbind: false, reason: "profile_status_200" };
  } catch (profileErr) {
    const profileStatus = getLineHttpStatus(profileErr);
    if (profileStatus === 400 || profileStatus === 404) {
      return { shouldUnbind: true, reason: `profile_status_${profileStatus}` };
    }
    return {
      shouldUnbind: false,
      reason: profileStatus ? `profile_status_${profileStatus}` : "profile_status_unknown",
    };
  }
}

/**
 * getLineUserIdByAccessToken
 * 用 LINE Access Token 呼叫 /v2/profile 取得 lineUserId（有效期 30 天，不會過期）
 */
function getLineUserIdByAccessToken(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.line.me",
      path: "/v2/profile",
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`LINE profile API error: ${res.statusCode} - ${data}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          if (!json.userId) {
            reject(new Error("LINE profile response missing userId"));
          } else {
            resolve(json.userId);
          }
        } catch (e) {
          reject(new Error("LINE profile response parse error"));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * createCustomToken
 * 接收 LINE Access Token，驗證身份後簽發 Firebase Custom Token（UID = LINE userId）
 */
exports.createCustomToken = onCall(
  { region: "asia-east1", timeoutSeconds: 15, minInstances: 1 },
  async (request) => {
    const { accessToken } = request.data;
    if (!accessToken || typeof accessToken !== "string") {
      throw new HttpsError("invalid-argument", "accessToken is required");
    }

    let lineUserId;
    try {
      lineUserId = await getLineUserIdByAccessToken(accessToken);
    } catch (err) {
      console.error("[createCustomToken] LINE Access Token 驗證失敗:", err.message);
      try {
        await writeAuditEntry({
          action: "login_failure",
          actorRole: "user",
          targetType: "system",
          targetLabel: "LINE login",
          result: "failure",
          source: "cloud_function",
          meta: { reasonCode: "line_access_token_invalid" },
        });
      } catch (auditErr) {
        console.warn("[createCustomToken] failed to write login_failure audit log:", auditErr);
      }
      throw new HttpsError("unauthenticated", "LINE 驗證失敗");
    }

    await ensureAuthUser(lineUserId);
    const role = await getUserRoleFromFirestore(lineUserId);
    await setRoleClaimMerged(lineUserId, role);

    const customToken = await authAdmin.createCustomToken(lineUserId);
    console.log("[createCustomToken] 成功為 LINE 用戶簽發 Custom Token:", lineUserId, "role=", role);
    return { customToken, role };
  }
);

exports.writeAuditLog = onCall(
  { region: "asia-east1", timeoutSeconds: 15 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const payload = request.data || {};
    const callerUid = request.auth.uid;
    const callerRole = await getCallerRoleWithFallback(request);
    const callerUser = await findUserDocByUidOrLineUserId(callerUid);
    let authDisplayName = "";
    try {
      const authUser = await authAdmin.getUser(callerUid);
      authDisplayName = getDisplayNameFromAuthRecord(authUser, "");
    } catch (_) {}
    const actorName = normalizeAuditText(
      callerUser?.data?.displayName
        || callerUser?.data?.name
        || authDisplayName
        || request.auth.token?.name
        || callerUid,
      80
    );

    const entry = await writeAuditEntry({
      actorUid: callerUid,
      actorName,
      actorRole: callerRole,
      action: payload.action,
      targetType: payload.targetType,
      targetId: payload.targetId,
      targetLabel: payload.targetLabel,
      result: payload.result,
      source: payload.source || "web",
      meta: payload.meta,
    });

    return {
      success: true,
      dayKey: entry.dayKey,
      timeKey: entry.timeKey,
    };
  }
);

exports.backfillAuditActorNames = onCall(
  { region: "asia-east1", timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const callerRole = await getCallerRoleWithFallback(request);
    if (callerRole !== "super_admin") {
      throw new HttpsError("permission-denied", "Super admin only");
    }

    const callerUid = request.auth.uid;
    const callerUser = await findUserDocByUidOrLineUserId(callerUid);
    let authDisplayName = "";
    try {
      const authUser = await authAdmin.getUser(callerUid);
      authDisplayName = getDisplayNameFromAuthRecord(authUser, "");
    } catch (_) {}
    const operatorName = normalizeAuditText(
      callerUser?.data?.displayName
        || callerUser?.data?.name
        || authDisplayName
        || request.auth.token?.name
        || callerUid,
      80
    );

    const requestedDayKey = String(request.data?.dayKey || "").replace(/\D/g, "").slice(0, 8);
    const dayKey = requestedDayKey || getTaipeiAuditDateInfo(new Date()).dayKey;
    if (dayKey.length !== 8) {
      throw new HttpsError("invalid-argument", "dayKey must be YYYYMMDD");
    }

    const snapshot = await db.collection("auditLogsByDay")
      .doc(dayKey)
      .collection("auditEntries")
      .get();

    if (snapshot.empty) {
      return {
        success: true,
        dayKey,
        scanned: 0,
        updated: 0,
      };
    }

    let scanned = 0;
    let updated = 0;
    let batch = db.batch();
    let pendingWrites = 0;
    const updatedUsers = new Map();

    for (const doc of snapshot.docs) {
      scanned += 1;
      const data = doc.data() || {};
      const actorUid = String(data.actorUid || "").trim();
      const actorName = String(data.actorName || "").trim();
      if (!actorUid) continue;
      if (actorName && actorName !== actorUid) continue;

      const resolvedName = await resolveAuditActorName(actorUid, actorUid);
      if (!resolvedName || resolvedName === actorUid) continue;

      batch.update(doc.ref, { actorName: resolvedName });
      if (!updatedUsers.has(actorUid)) {
        updatedUsers.set(actorUid, resolvedName);
      }
      updated += 1;
      pendingWrites += 1;

      if (pendingWrites >= 400) {
        await batch.commit();
        batch = db.batch();
        pendingWrites = 0;
      }
    }

    if (pendingWrites > 0) {
      await batch.commit();
    }

    const uniqueUsers = updatedUsers.size;
    if (updated > 0) {
      const previewUsers = Array.from(updatedUsers.entries())
        .slice(0, 8)
        .map(([uid, name]) => `${name}（${uid}）`);
      const extraCount = Math.max(0, uniqueUsers - previewUsers.length);
      const dateLabel = `${dayKey.slice(0, 4)}-${dayKey.slice(4, 6)}-${dayKey.slice(6, 8)}`;
      const summary = previewUsers.join("、");
      const content = `補齊 ${dateLabel} 稽核日誌暱稱，共 ${updated} 筆紀錄、${uniqueUsers} 位用戶${summary ? `：${summary}` : ""}${extraCount > 0 ? ` 等 ${uniqueUsers} 位用戶` : ""}`;
      try {
        await writeOperationLog({
          operator: operatorName,
          type: "audit_backfill",
          typeName: "稽核暱稱補齊",
          content,
        });
      } catch (opLogErr) {
        console.warn("[backfillAuditActorNames] failed to write operation log:", opLogErr);
      }
    }

    return {
      success: true,
      dayKey,
      scanned,
      updated,
      uniqueUsers,
    };
  }
);

exports.ensureNotificationTemplates = onCall(
  { region: "asia-east1", timeoutSeconds: 15 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const templates = await ensureDefaultNotificationTemplates();
    return { templates };
  }
);

exports.syncUserRole = onCall(
  { region: "asia-east1", timeoutSeconds: 15 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const access = await getCallerAccessContext(request);
    if (!access.hasPermission(ADMIN_USER_CHANGE_ROLE_PERMISSION)) {
      throw new HttpsError("permission-denied", "Missing role-change permission");
    }

    const { targetUid } = request.data || {};
    if (!targetUid || typeof targetUid !== "string") {
      throw new HttpsError("invalid-argument", "targetUid is required");
    }

    const targetUser = await findUserDocByUidOrLineUserId(targetUid);
    if (!targetUser) {
      throw new HttpsError("not-found", "Target user not found");
    }
    const resolvedTargetUid = getAuthUidFromUserDoc(targetUser, targetUid);
    const targetRole = normalizeRole(targetUser.data?.role);

    await ensureAuthUser(resolvedTargetUid);
    await setRoleClaimMerged(resolvedTargetUid, targetRole);

    console.log("[syncUserRole] synced claims", {
      callerUid: request.auth.uid,
      callerRole: access.role,
      targetUid: resolvedTargetUid,
      targetDocId: targetUser.docId,
      targetRole,
    });

    return {
      success: true,
      targetUid: resolvedTargetUid,
      targetDocId: targetUser.docId,
      role: targetRole,
    };
  }
);

exports.adminManageUser = onCall(
  { region: "asia-east1", timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const access = await getCallerAccessContext(request);
    const callerUid = request.auth.uid;
    const { targetUid, profileUpdates, restrictionUpdate, roleChange } = request.data || {};
    if (!targetUid || typeof targetUid !== "string") {
      throw new HttpsError("invalid-argument", "targetUid is required");
    }

    const targetUser = await findUserDocByUidOrLineUserId(targetUid);
    if (!targetUser) {
      throw new HttpsError("not-found", "Target user not found");
    }

    const targetData = targetUser.data || {};
    const resolvedTargetUid = getAuthUidFromUserDoc(targetUser, targetUid);
    const targetRole = normalizeRole(targetData.role);
    const isTargetSuperAdmin = targetRole === "super_admin";
    if (!access.isSuperAdmin && isTargetSuperAdmin) {
      throw new HttpsError("permission-denied", "Cannot manage super admin");
    }

    const nextUpdates = {};
    const sanitizedProfileUpdates = sanitizeAdminManagedProfileUpdates(profileUpdates);
    if (hasAnyOwnKeys(sanitizedProfileUpdates)) {
      if (!access.hasPermission(ADMIN_USER_EDIT_PROFILE_PERMISSION)) {
        throw new HttpsError("permission-denied", "Missing profile edit permission");
      }
      Object.assign(nextUpdates, sanitizedProfileUpdates);
    }

    if (restrictionUpdate != null) {
      if (!access.hasPermission(ADMIN_USER_RESTRICT_PERMISSION)) {
        throw new HttpsError("permission-denied", "Missing restriction permission");
      }
      if (resolvedTargetUid === callerUid) {
        throw new HttpsError("failed-precondition", "Cannot restrict yourself");
      }
      const callerUser = await findUserDocByUidOrLineUserId(callerUid);
      let authDisplayName = "";
      try {
        const authUser = await authAdmin.getUser(callerUid);
        authDisplayName = getDisplayNameFromAuthRecord(authUser, "");
      } catch (_) {}
      const actorName = normalizeAuditText(
        callerUser?.data?.displayName
          || callerUser?.data?.name
          || authDisplayName
          || request.auth.token?.name
          || callerUid,
        80
      );
      const nextRestricted = restrictionUpdate === true
        || restrictionUpdate?.restricted === true
        || restrictionUpdate?.isRestricted === true;
      nextUpdates.isRestricted = nextRestricted;
      nextUpdates.restrictedAt = nextRestricted ? FieldValue.serverTimestamp() : null;
      nextUpdates.restrictedByUid = nextRestricted ? callerUid : null;
      nextUpdates.restrictedByName = nextRestricted ? actorName : null;
    }

    if (roleChange && typeof roleChange === "object") {
      if (!access.hasPermission(ADMIN_USER_CHANGE_ROLE_PERMISSION)) {
        throw new HttpsError("permission-denied", "Missing role-change permission");
      }
      const callerLevel = ROLE_LEVELS[access.role] ?? 0;
      if (callerLevel < ROLE_LEVELS.admin) {
        throw new HttpsError("permission-denied", "Only admin or above can change roles");
      }
      const nextRole = normalizeRole(roleChange.role);
      if (!(await roleExists(nextRole))) {
        throw new HttpsError("invalid-argument", "Target role does not exist");
      }
      if (!access.isSuperAdmin && (ROLE_LEVELS[nextRole] ?? 0) >= ROLE_LEVELS.admin) {
        throw new HttpsError("permission-denied", "Only super_admin can assign admin-level roles");
      }
      const targetLevel = ROLE_LEVELS[targetRole] ?? 0;
      if (!access.isSuperAdmin && targetLevel >= callerLevel) {
        throw new HttpsError("permission-denied", "Cannot modify user with equal or higher role");
      }
      const nextManualRole = normalizeRole(roleChange.manualRole || nextRole);
      if (!(await roleExists(nextManualRole))) {
        throw new HttpsError("invalid-argument", "manualRole does not exist");
      }
      nextUpdates.role = nextRole;
      nextUpdates.manualRole = nextManualRole;
      nextUpdates.isAdmin = ["admin", "super_admin"].includes(normalizeBuiltInRole(nextRole));
      nextUpdates.claims = {
        ...(targetData.claims && typeof targetData.claims === "object" ? targetData.claims : {}),
        role: nextRole,
      };
      nextUpdates.claimsUpdatedAt = FieldValue.serverTimestamp();
    }

    if (!hasAnyOwnKeys(nextUpdates)) {
      throw new HttpsError("invalid-argument", "No supported updates requested");
    }

    nextUpdates.updatedAt = FieldValue.serverTimestamp();
    await db.collection("users").doc(targetUser.docId).update(nextUpdates);

    if (typeof nextUpdates.role === "string") {
      await ensureAuthUser(resolvedTargetUid);
      await setRoleClaimMerged(resolvedTargetUid, nextUpdates.role);
    }

    return {
      success: true,
      targetUid: resolvedTargetUid,
      targetDocId: targetUser.docId,
      role: typeof nextUpdates.role === "string" ? nextUpdates.role : targetRole,
      forceRefreshToken: typeof nextUpdates.role === "string" && resolvedTargetUid === callerUid,
    };
  }
);

// ═══════════════════════════════════════════════════
//  adjustExp — EXP 調整（用戶 EXP / 俱樂部積分）
//  修復：原 client SDK 直寫 users.exp 被 Firestore rules 擋住
// ═══════════════════════════════════════════════════
const ADMIN_EXP_PERMISSION = "admin.exp.entry";

exports.adjustExp = onCall(
  { region: "asia-east1", timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const callerUid = request.auth.uid;
    const { mode, targets, teamId, amount, reason, operatorLabel, requestId, ruleKey } = request.data || {};

    // ── 冪等性保護（可選） ──
    if (typeof requestId === "string" && requestId.length > 0) {
      const dedupRef = db.collection("_expDedupe").doc(requestId);
      try {
        await dedupRef.create({ callerUid, createdAt: FieldValue.serverTimestamp() });
      } catch (e) {
        if (e.code === 6 || e.code === "already-exists") {
          return { success: true, deduplicated: true };
        }
        // 其他錯誤不阻塞（dedup 失敗不影響主流程）
      }
    }

    // ── 參數驗證 ──
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
      throw new HttpsError("invalid-argument", "amount must be a non-zero finite number");
    }
    if (typeof reason !== "string" || !reason.trim()) {
      throw new HttpsError("invalid-argument", "reason is required");
    }

    const validModes = ["auto", "manual", "batch", "team", "teamExp"];
    if (!validModes.includes(mode)) {
      throw new HttpsError("invalid-argument", `Invalid mode: ${mode}`);
    }

    // ── 權限檢查 ──
    if (mode === "auto") {
      // auto 模式：任何已登入用戶可觸發，限制幅度 ±100 + 冪等性保護
      if (amount < -100 || amount > 100) {
        throw new HttpsError("invalid-argument", "Auto mode amount must be between -100 and +100");
      }
    } else {
      // manual / batch / team / teamExp：需要 admin.exp.entry 權限
      const access = await getCallerAccessContext(request);
      if (!access.hasPermission(ADMIN_EXP_PERMISSION)) {
        throw new HttpsError("permission-denied", `Missing permission: ${ADMIN_EXP_PERMISSION}`);
      }
    }

    const safeReason = reason.trim().slice(0, 200);
    const safeOperator = (typeof operatorLabel === "string" && operatorLabel.trim())
      ? operatorLabel.trim().slice(0, 50)
      : "管理員";
    const now = new Date();
    const timeStr = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    // ═══ 俱樂部積分模式 ═══
    if (mode === "teamExp") {
      if (typeof teamId !== "string" || !teamId) {
        throw new HttpsError("invalid-argument", "teamId is required for teamExp mode");
      }
      const teamRef = db.collection("teams").doc(teamId);
      const teamSnap = await teamRef.get();
      if (!teamSnap.exists) {
        throw new HttpsError("not-found", "Team not found");
      }
      const teamData = teamSnap.data() || {};
      const oldExp = typeof teamData.teamExp === "number" ? teamData.teamExp : 0;
      const newExp = Math.min(10000, Math.max(0, oldExp + amount));

      const log = {
        time: timeStr,
        target: teamData.name || teamId,
        targetId: teamId,
        amount: (amount > 0 ? "+" : "") + amount,
        reason: safeReason,
        operator: safeOperator,
        operatorUid: callerUid,
        createdAt: FieldValue.serverTimestamp(),
      };

      const batch = db.batch();
      batch.update(teamRef, { teamExp: newExp, updatedAt: FieldValue.serverTimestamp() });
      batch.create(db.collection("teamExpLogs").doc(), log);
      await batch.commit();

      return { success: true, teamId, oldExp, newExp, teamName: teamData.name || teamId };
    }

    // ═══ 用戶 EXP 模式（manual / batch / team / auto） ═══
    const targetList = [];

    if (mode === "auto") {
      // auto 模式：單一目標，targets[0] 為 uid
      if (!Array.isArray(targets) || targets.length !== 1) {
        throw new HttpsError("invalid-argument", "Auto mode requires exactly 1 target");
      }
      targetList.push(targets[0]);
    } else if (mode === "batch" || mode === "team") {
      if (!Array.isArray(targets) || targets.length === 0) {
        throw new HttpsError("invalid-argument", "targets array is required");
      }
      if (targets.length > 50) {
        throw new HttpsError("invalid-argument", "Maximum 50 targets per batch");
      }
      targets.forEach((t) => targetList.push(t));
    } else {
      // manual：單一目標
      if (!Array.isArray(targets) || targets.length !== 1) {
        throw new HttpsError("invalid-argument", "Manual mode requires exactly 1 target");
      }
      targetList.push(targets[0]);
    }

    const results = [];
    for (const targetId of targetList) {
      if (typeof targetId !== "string" || !targetId) continue;
      const targetUser = await findUserDocByUidOrLineUserId(targetId);
      if (!targetUser) {
        results.push({ targetId, success: false, error: "not_found" });
        continue;
      }

      const userData = targetUser.data || {};
      const oldExp = typeof userData.exp === "number" ? userData.exp : 0;
      const newExp = Math.max(0, oldExp + amount);

      const log = {
        time: timeStr,
        uid: userData.uid || userData.lineUserId || targetUser.docId,
        target: userData.displayName || userData.name || targetId,
        amount: (amount > 0 ? "+" : "") + amount,
        reason: safeReason,
        operator: safeOperator,
        operatorUid: callerUid,
        createdAt: FieldValue.serverTimestamp(),
      };
      if (typeof ruleKey === "string" && ruleKey) log.ruleKey = ruleKey;

      const batch = db.batch();
      batch.update(db.collection("users").doc(targetUser.docId), {
        exp: newExp,
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.create(db.collection("expLogs").doc(), log);
      await batch.commit();

      results.push({
        targetId,
        docId: targetUser.docId,
        name: userData.displayName || userData.name || targetId,
        oldExp,
        newExp,
        success: true,
      });
    }

    return { success: true, results };
  }
);

// ═══════════════════════════════════════════════════
//  autoPromoteTeamRole — 俱樂部職位變動觸發的自動角色晉升/降級
//  修復：原 client SDK 直寫 users.role 被 Firestore rules 擋住
//  僅允許 user / coach / captain 三層角色變動
// ═══════════════════════════════════════════════════
const AUTO_PROMOTE_ALLOWED_ROLES = new Set(["user", "coach", "captain"]);

exports.autoPromoteTeamRole = onCall(
  { region: "asia-east1", timeoutSeconds: 15 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const callerUid = request.auth.uid;
    const callerRole = await getCallerRoleWithFallback(request);
    const callerLevel = ROLE_LEVELS[callerRole] ?? 0;

    // 只有 coach 以上可以觸發（管理俱樂部的人）
    if (callerLevel < ROLE_LEVELS.coach) {
      throw new HttpsError("permission-denied", "Coach or above required");
    }

    const { targetUid, newRole } = request.data || {};
    if (typeof targetUid !== "string" || !targetUid) {
      throw new HttpsError("invalid-argument", "targetUid is required");
    }
    const safeNewRole = normalizeRole(newRole);
    if (!AUTO_PROMOTE_ALLOWED_ROLES.has(safeNewRole)) {
      throw new HttpsError("invalid-argument", `Role must be one of: ${[...AUTO_PROMOTE_ALLOWED_ROLES].join(", ")}`);
    }

    const targetUser = await findUserDocByUidOrLineUserId(targetUid);
    if (!targetUser) {
      throw new HttpsError("not-found", "Target user not found");
    }

    const targetData = targetUser.data || {};
    const currentRole = normalizeRole(targetData.role);
    const currentLevel = ROLE_LEVELS[currentRole] ?? 0;

    // venue_owner 以上由管理員手動管理，不做自動變更
    if (currentLevel >= ROLE_LEVELS.venue_owner) {
      return { success: true, skipped: true, reason: "role_too_high", currentRole };
    }

    // 角色沒變就不寫
    if (currentRole === safeNewRole) {
      return { success: true, skipped: true, reason: "no_change", currentRole };
    }

    const resolvedTargetUid = getAuthUidFromUserDoc(targetUser, targetUid);

    // 更新 Firestore
    await db.collection("users").doc(targetUser.docId).update({
      role: safeNewRole,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 同步 Auth custom claims
    await ensureAuthUser(resolvedTargetUid);
    await setRoleClaimMerged(resolvedTargetUid, safeNewRole);

    console.log("[autoPromoteTeamRole]", {
      callerUid,
      callerRole,
      targetUid: resolvedTargetUid,
      targetDocId: targetUser.docId,
      oldRole: currentRole,
      newRole: safeNewRole,
    });

    return {
      success: true,
      targetUid: resolvedTargetUid,
      targetDocId: targetUser.docId,
      oldRole: currentRole,
      newRole: safeNewRole,
    };
  }
);

exports.backfillRoleClaims = onCall(
  { region: "asia-east1", timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const callerRole = await getCallerRoleWithFallback(request);
    if (callerRole !== "super_admin") {
      throw new HttpsError("permission-denied", "Super admin only");
    }

    const rawLimit = Number(request.data?.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(200, Math.floor(rawLimit)))
      : 100;
    const dryRun = request.data?.dryRun === true;
    const startAfterDocId = (typeof request.data?.startAfterDocId === "string" && request.data.startAfterDocId)
      ? request.data.startAfterDocId
      : null;

    let query = db.collection("users")
      .orderBy(FieldPath.documentId())
      .limit(limit);
    if (startAfterDocId) {
      query = query.startAfter(startAfterDocId);
    }

    const snap = await query.get();
    const failures = [];
    let updated = 0;
    let legacyResolved = 0;

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const targetUid = getAuthUidFromUserDoc({ docId: doc.id, data }, doc.id);
      const role = normalizeRole(data.role);
      const isLegacyResolved = targetUid !== doc.id;
      if (isLegacyResolved) legacyResolved += 1;

      try {
        if (!dryRun) {
          await ensureAuthUser(targetUid);
          await setRoleClaimMerged(targetUid, role);
        }
        updated += 1;
      } catch (err) {
        failures.push({
          docId: doc.id,
          targetUid,
          role,
          code: getAuthErrorCode(err),
          message: err?.message || String(err),
        });
      }
    }

    const nextCursor = snap.size === limit ? snap.docs[snap.docs.length - 1].id : null;
    const result = {
      success: failures.length === 0,
      dryRun,
      limit,
      processed: snap.size,
      updated,
      failed: failures.length,
      legacyResolved,
      nextCursor,
      hasMore: !!nextCursor,
      failures: failures.slice(0, 20),
    };

    console.log("[backfillRoleClaims] batch result", {
      callerUid: request.auth.uid,
      callerRole,
      dryRun,
      startAfterDocId,
      ...result,
    });

    return result;
  }
);

exports.enqueuePrivilegedLineNotification = onCall(
  { region: "asia-east1", timeoutSeconds: 15 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const callerRole = await getCallerRoleWithFallback(request);

    const uid = normalizeLineNotificationText(request.data?.uid, 128);
    const title = normalizeLineNotificationText(request.data?.title, 200);
    const body = normalizeLineNotificationText(request.data?.body, 2000);
    const category = normalizeLineNotificationCategory(request.data?.category);
    const source = normalizeLineNotificationText(request.data?.source, 120) || "client:unknown";
    const dedupeKey = normalizeLineNotificationText(request.data?.dedupeKey, 160);

    if (!uid || !title || !body || !category) {
      throw new HttpsError("invalid-argument", "uid/title/body/category are required");
    }

    const found = await findUserDocByUidOrLineUserId(uid);
    if (!found) {
      return { queued: false, skipped: true, reason: "target_not_found" };
    }

    const lineNotify = (found.data && typeof found.data.lineNotify === "object")
      ? found.data.lineNotify
      : {};
    const settings = {
      activity: true,
      system: true,
      tournament: false,
      ...((lineNotify.settings && typeof lineNotify.settings === "object")
        ? lineNotify.settings
        : {}),
    };
    const settingsKey = getLineNotificationSettingsKey(category);
    if (!lineNotify.bound) {
      return { queued: false, skipped: true, reason: "not_bound" };
    }
    if (!settings[settingsKey]) {
      return { queued: false, skipped: true, reason: "category_disabled" };
    }

    const targetUid = getLineRecipientUidFromUserDoc(found, uid);
    const queuePayload = {
      uid: targetUid,
      targetDocId: found.docId,
      title,
      body,
      category,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      source,
      requestedByUid: request.auth.uid,
      requestedByRole: callerRole,
    };
    if (dedupeKey) queuePayload.dedupeKey = dedupeKey;

    const ref = await db.collection("linePushQueue").add(queuePayload);
    console.log("[enqueuePrivilegedLineNotification] queued", {
      queueId: ref.id,
      source,
      requestedByUid: request.auth.uid,
      requestedByRole: callerRole,
      targetUid,
      category,
    });

    return {
      queued: true,
      skipped: false,
      queueId: ref.id,
    };
  }
);

/**
 * processLinePushQueue
 * 監聽 linePushQueue 新文件，透過 LINE Messaging API 發送推播
 */
exports.processLinePushQueue = onDocumentCreated(
  {
    document: "linePushQueue/{docId}",
    region: "asia-east1",
    secrets: [LINE_CHANNEL_ACCESS_TOKEN],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    const docRef = snap.ref;
    const {
      uid,
      title,
      body,
      status,
      source = "unknown",
      requestedByUid = "",
      requestedByRole = "",
      targetDocId = "",
    } = data;

    // 冪等性：僅處理 pending 狀態
    if (status !== "pending") {
      console.log(`[LinePush] 跳過非 pending 文件: ${snap.id}, status=${status}`);
      return;
    }

    if (!uid || !title || !body) {
      console.error(`[LinePush] 缺少必要欄位: ${snap.id}`, { uid, title, body });
      await docRef.update({
        status: "failed",
        error: "缺少必要欄位 (uid/title/body)",
        processedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const client = new (getMessagingApi()).MessagingApiClient({
      channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN.value(),
    });

    try {
      await client.pushMessage({
        to: uid,
        messages: [
          {
            type: "text",
            text: `${title}\n${body}`,
          },
        ],
      });

      await docRef.update({
        status: "sent",
        processedAt: FieldValue.serverTimestamp(),
      });

      console.log(`[LinePush] 發送成功: ${snap.id} → ${uid}`);
    } catch (err) {
      console.error(`[LinePush] 發送失敗: ${snap.id}`, err);

      await docRef.update({
        status: "failed",
        error: err.message || String(err),
        processedAt: FieldValue.serverTimestamp(),
      });
      const unbindDecision = await shouldAutoUnbindLineRecipient(client, uid, err);
      if (!unbindDecision.shouldUnbind) {
        console.log("[LinePush] keep binding after failed push", {
          uid,
          queueId: snap.id,
          reason: unbindDecision.reason,
          source,
          requestedByUid,
          requestedByRole,
        });
        return;
      }

      // 推播失敗 → 自動解綁用戶的 LINE 推播
      try {
        let userDoc = db.collection("users").doc(uid);
        let userSnap = await userDoc.get();
        if (!userSnap.exists && typeof targetDocId === "string" && targetDocId) {
          userDoc = db.collection("users").doc(targetDocId);
          userSnap = await userDoc.get();
        }
        if (!userSnap.exists) {
          const foundUser = await findUserDocByUidOrLineUserId(uid);
          if (foundUser?.docId) {
            userDoc = db.collection("users").doc(foundUser.docId);
            userSnap = await userDoc.get();
          }
        }
        if (userSnap.exists) {
          await userDoc.update({ "lineNotify.bound": false });
          console.log(`[LinePush] 已自動解綁用戶推播: ${uid}`);
        }
      } catch (unbindErr) {
        console.error(`[LinePush] 自動解綁失敗: ${uid}`, unbindErr);
      }
    }
  }
);

// ─────────────────────────────────────────────────────────────
//  Shot Game — 射門小遊戲分數提交
//  Phase 1：驗證 payload → 寫入 shotGameScores → 更新日榜
// ─────────────────────────────────────────────────────────────

/**
 * 將 Date 物件轉為 Asia/Taipei 時區的日期資訊，計算 period bucket。
 * 直接用 UTC+8 偏移，不依賴 Intl（Cloud Functions 環境更穩定）。
 */
function getTaipeiDateInfo(now) {
  const offsetMs = 8 * 60 * 60 * 1000;
  const t = new Date(now.getTime() + offsetMs);
  const year = t.getUTCFullYear();
  const month = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");

  // ISO week number（週一為週起點）
  const d = new Date(Date.UTC(year, t.getUTCMonth(), t.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = String(Math.ceil(((d - yearStart) / 86400000 + 1) / 7)).padStart(2, "0");

  return {
    daily: `daily_${year}-${month}-${day}`,
    weekly: `weekly_${year}-W${week}`,
    monthly: `monthly_${year}-${month}`,
  };
}

function getTaipeiAuditDateInfo(now) {
  const offsetMs = 8 * 60 * 60 * 1000;
  const t = new Date(now.getTime() + offsetMs);
  const year = t.getUTCFullYear();
  const month = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  const hours = String(t.getUTCHours()).padStart(2, "0");
  const minutes = String(t.getUTCMinutes()).padStart(2, "0");
  const seconds = String(t.getUTCSeconds()).padStart(2, "0");

  return {
    dayKey: `${year}${month}${day}`,
    timeKey: `${hours}:${minutes}:${seconds}`,
  };
}

function parseEventStartDateInTaipei(dateStr) {
  if (typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  const [rawDatePart = "", rawTimePart = ""] = trimmed.split(/\s+/, 2);
  const dateParts = rawDatePart.split("/").map(part => Number(part));
  if (dateParts.length < 3 || dateParts.some(part => !Number.isFinite(part))) {
    return null;
  }

  const [year, month, day] = dateParts;
  let hours = 0;
  let minutes = 0;
  if (rawTimePart) {
    const startTimePart = rawTimePart.split("~")[0];
    const timeParts = startTimePart.split(":").map(part => Number(part));
    if (timeParts.length >= 2 && Number.isFinite(timeParts[0]) && Number.isFinite(timeParts[1])) {
      [hours, minutes] = timeParts;
    }
  }

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes)
  ) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  // Treat the stored event date/time as Asia/Taipei local time.
  return new Date(Date.UTC(year, month - 1, day, hours - 8, minutes, 0, 0));
}

function shouldAutoEndEvent(data, now = new Date()) {
  const status = String(data?.status || "").trim();
  if (!["open", "full", "upcoming"].includes(status)) return false;

  const startDate = parseEventStartDateInTaipei(data?.date);
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return false;
  return startDate.getTime() <= now.getTime();
}

async function autoEndStartedEventsBatch({ now = new Date(), batchSize = 400 } = {}) {
  const snapshot = await db.collection("events")
    .where("status", "in", ["open", "full", "upcoming"])
    .select("status", "date")
    .get();

  const targets = snapshot.docs.filter(doc => shouldAutoEndEvent(doc.data() || {}, now));
  let updatedCount = 0;

  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = db.batch();
    const chunk = targets.slice(i, i + batchSize);
    chunk.forEach(doc => {
      batch.update(doc.ref, {
        status: "ended",
      });
    });
    await batch.commit();
    updatedCount += chunk.length;
  }

  return {
    scannedCount: snapshot.size,
    updatedCount,
  };
}

function buildAuditEntryPayload({
  actorUid = "",
  actorName = "",
  actorRole = "user",
  action = "",
  targetType = "system",
  targetId = "",
  targetLabel = "",
  result = "success",
  source = "web",
  meta = {},
  now = new Date(),
}) {
  const normalizedAction = normalizeAuditEnum(action, ALLOWED_AUDIT_ACTIONS);
  if (!normalizedAction) {
    throw new HttpsError("invalid-argument", "Unsupported audit action");
  }

  const { dayKey, timeKey } = getTaipeiAuditDateInfo(now);
  return {
    dayKey,
    timeKey,
    actorUid: normalizeAuditText(actorUid, 128),
    actorName: normalizeAuditText(actorName, 80),
    actorRole: normalizeRole(actorRole),
    action: normalizedAction,
    targetType: normalizeAuditEnum(targetType, ALLOWED_AUDIT_TARGET_TYPES, "system"),
    targetId: normalizeAuditText(targetId, 160),
    targetLabel: normalizeAuditText(targetLabel, 160),
    result: normalizeAuditEnum(result, ALLOWED_AUDIT_RESULTS, "success"),
    source: normalizeAuditEnum(source, ALLOWED_AUDIT_SOURCES, "web"),
    meta: sanitizeAuditMeta(meta),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(now.getTime() + AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
  };
}

async function writeAuditEntry(payload) {
  const entry = buildAuditEntryPayload(payload);
  await db.collection("auditLogsByDay")
    .doc(entry.dayKey)
    .collection("auditEntries")
    .add(entry);
  return entry;
}

function getChangeWatchDayInfo(now) {
  return getTaipeiAuditDateInfo(now);
}

function normalizeChangeWatchActorType(actorType) {
  return typeof actorType === "string" && actorType.trim()
    ? actorType.trim()
    : "unknown";
}

function normalizeChangeWatchActorId(actorId) {
  return typeof actorId === "string" ? actorId.trim() : "";
}

function isSystemChangeWatchActor(actorType) {
  return CHANGE_WATCH_SYSTEM_ACTOR_TYPES.has(normalizeChangeWatchActorType(actorType));
}

function isTrustedChangeWatchRole(actorRole) {
  return CHANGE_WATCH_TRUSTED_ROLES.has(normalizeRole(actorRole));
}

function hasOwnField(data, field) {
  return !!data
    && typeof data === "object"
    && Object.prototype.hasOwnProperty.call(data, field);
}

function timestampLikeToIso(value) {
  if (!value || typeof value !== "object") return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch (_) {}
  }
  if (typeof value.seconds === "number") {
    const millis = (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
    return new Date(millis).toISOString();
  }
  return null;
}

function normalizeComparableValue(value) {
  if (typeof value === "undefined") return "__undefined__";
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  const maybeTimestamp = timestampLikeToIso(value);
  if (maybeTimestamp) return maybeTimestamp;
  if (Array.isArray(value)) {
    return value.map(item => normalizeComparableValue(item));
  }
  if (typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        if (typeof value[key] === "undefined") return acc;
        acc[key] = normalizeComparableValue(value[key]);
        return acc;
      }, {});
  }
  return String(value);
}

function areChangeWatchValuesEqual(beforeValue, afterValue) {
  return JSON.stringify(normalizeComparableValue(beforeValue))
    === JSON.stringify(normalizeComparableValue(afterValue));
}

function getChangeType(beforeData, afterData) {
  if (!beforeData && afterData) return "create";
  if (beforeData && !afterData) return "delete";
  if (beforeData && afterData) return "update";
  return "";
}

function getChangedFields(beforeData = {}, afterData = {}) {
  const keys = new Set([
    ...Object.keys(beforeData || {}),
    ...Object.keys(afterData || {}),
  ]);
  return Array.from(keys).filter(key => !areChangeWatchValuesEqual(
    beforeData?.[key],
    afterData?.[key],
  ));
}

function hasOnlyFields(changedFields, allowedFields) {
  if (!Array.isArray(changedFields) || changedFields.length === 0) return false;
  return changedFields.every(field => allowedFields.has(field));
}

function collectFieldNames(...fieldGroups) {
  return fieldGroups.reduce((acc, group) => {
    Array.from(group || []).forEach(field => acc.add(field));
    return acc;
  }, new Set());
}

function pickSensitiveDiff(beforeData, afterData, watchedFields) {
  const changedFields = getChangedFields(beforeData, afterData)
    .filter(field => !watchedFields || watchedFields.has(field));
  const before = {};
  const after = {};
  changedFields.forEach(field => {
    before[field] = hasOwnField(beforeData, field) ? beforeData[field] ?? null : null;
    after[field] = hasOwnField(afterData, field) ? afterData[field] ?? null : null;
  });
  return { changedFields, before, after };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item || "").trim())
    .filter(Boolean);
}

function listSymmetricDiffSize(beforeList, afterList) {
  const before = new Set(normalizeStringList(beforeList));
  const after = new Set(normalizeStringList(afterList));
  let diff = 0;
  before.forEach(item => {
    if (!after.has(item)) diff += 1;
  });
  after.forEach(item => {
    if (!before.has(item)) diff += 1;
  });
  return diff;
}

function getNumericValue(data, field, fallback = 0) {
  const value = Number(data?.[field]);
  return Number.isFinite(value) ? value : fallback;
}

function matchesActorId(actorId, ...candidates) {
  const safeActorId = normalizeChangeWatchActorId(actorId);
  if (!safeActorId) return false;
  return candidates.some(candidate => {
    if (candidate === null || typeof candidate === "undefined") return false;
    return String(candidate).trim() === safeActorId;
  });
}

function getUserTeamIds(data) {
  const list = normalizeStringList(data?.teamIds);
  if (list.length > 0) return list;
  return normalizeStringList(data?.teamId ? [data.teamId] : []);
}

function hasNonEmptyUserTeamMembership(data) {
  if (!data || typeof data !== "object") return false;
  return getUserTeamIds(data).length > 0
    || normalizeStringList(data?.teamNames).length > 0
    || (typeof data?.teamName === "string" && data.teamName.trim().length > 0);
}

function isUserTeamMembershipShrinkOrClear(beforeData, afterData) {
  const oldIds = getUserTeamIds(beforeData);
  const newIds = getUserTeamIds(afterData);
  if (newIds.length === 0) return true;
  if (oldIds.length === 0) return false;
  if (newIds.length >= oldIds.length) return false;
  return newIds.every(teamId => oldIds.includes(teamId));
}

function isSelfUserDocumentActor(actorId, documentId, beforeData, afterData) {
  return matchesActorId(
    actorId,
    documentId,
    beforeData?.uid,
    beforeData?.lineUserId,
    afterData?.uid,
    afterData?.lineUserId,
  );
}

async function getChangeWatchActorRole(actorId, actorType) {
  const safeActorId = normalizeChangeWatchActorId(actorId);
  const safeActorType = normalizeChangeWatchActorType(actorType);
  if (!safeActorId) return "user";
  if (isSystemChangeWatchActor(safeActorType)) return safeActorType;

  const cached = changeWatchRoleCache.get(safeActorId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.role;
  }

  let role = "user";
  try {
    role = normalizeRole(await getUserRoleFromFirestore(safeActorId));
  } catch (err) {
    console.warn("[changeWatch] failed to resolve actor role:", safeActorId, err?.message || err);
  }
  changeWatchRoleCache.set(safeActorId, {
    role,
    expiresAt: Date.now() + CHANGE_WATCH_ROLE_CACHE_TTL_MS,
  });
  return role;
}

function getEventOwnerIdsFromData(data) {
  if (!data || typeof data !== "object") return [];
  return [
    data.ownerUid,
    data.creatorUid,
    data.captainUid,
  ]
    .map(value => String(value || "").trim())
    .filter(Boolean);
}

async function getChangeWatchEventOwnerIds(eventIdentifier) {
  const safeEventIdentifier = String(eventIdentifier || "").trim();
  if (!safeEventIdentifier) return [];

  const cached = changeWatchEventOwnerCache.get(safeEventIdentifier);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ownerIds;
  }

  let ownerIds = [];
  try {
    const querySnap = await db.collection("events")
      .where("id", "==", safeEventIdentifier)
      .limit(1)
      .get();
    if (!querySnap.empty) {
      ownerIds = getEventOwnerIdsFromData(querySnap.docs[0].data() || {});
    } else {
      const directSnap = await db.collection("events").doc(safeEventIdentifier).get();
      if (directSnap.exists) {
        ownerIds = getEventOwnerIdsFromData(directSnap.data() || {});
      }
    }
  } catch (err) {
    console.warn("[changeWatch] failed to resolve event owners:", safeEventIdentifier, err?.message || err);
  }

  changeWatchEventOwnerCache.set(safeEventIdentifier, {
    ownerIds,
    expiresAt: Date.now() + CHANGE_WATCH_EVENT_CACHE_TTL_MS,
  });
  return ownerIds;
}

async function isChangeWatchEventOwner(actorId, eventIdentifier) {
  if (!normalizeChangeWatchActorId(actorId)) return false;
  const ownerIds = await getChangeWatchEventOwnerIds(eventIdentifier);
  return matchesActorId(actorId, ...ownerIds);
}

function isPlausibleEventSignupDelta(beforeData, afterData) {
  const currentDelta = Math.abs(getNumericValue(afterData, "current") - getNumericValue(beforeData, "current"));
  const waitlistDelta = Math.abs(getNumericValue(afterData, "waitlist") - getNumericValue(beforeData, "waitlist"));
  const participantDelta = listSymmetricDiffSize(beforeData?.participants, afterData?.participants);
  const waitlistNameDelta = listSymmetricDiffSize(beforeData?.waitlistNames, afterData?.waitlistNames);
  const safeStatusValues = new Set(["", "open", "full"]);
  const nextStatus = String(afterData?.status || "").trim();
  const nextMax = getNumericValue(afterData, "max", getNumericValue(beforeData, "max", 0));
  const nextCurrent = getNumericValue(afterData, "current");
  const nextWaitlist = getNumericValue(afterData, "waitlist");

  if (nextCurrent < 0 || nextWaitlist < 0) return false;
  if (nextMax > 0 && nextCurrent > nextMax) return false;
  if (currentDelta > CHANGE_WATCH_MAX_NORMAL_SIGNUP_DELTA) return false;
  if (waitlistDelta > CHANGE_WATCH_MAX_NORMAL_SIGNUP_DELTA) return false;
  if (participantDelta > CHANGE_WATCH_MAX_NORMAL_SIGNUP_DELTA) return false;
  if (waitlistNameDelta > CHANGE_WATCH_MAX_NORMAL_SIGNUP_DELTA) return false;
  if (!safeStatusValues.has(nextStatus)) return false;
  return true;
}

function buildChangeWatchResult({
  riskLevel = "medium",
  reasonCodes = [],
  changedFields = [],
  before = {},
  after = {},
}) {
  const uniqueReasons = Array.from(new Set(reasonCodes.filter(Boolean)));
  const uniqueFields = Array.from(new Set(changedFields.filter(Boolean)));
  if (uniqueReasons.length === 0 || uniqueFields.length === 0) return null;
  return {
    riskLevel,
    reasonCodes: uniqueReasons,
    changedFields: uniqueFields,
    before,
    after,
  };
}

function shouldPersistWatchLog(result) {
  return !!(result
    && typeof result === "object"
    && Array.isArray(result.reasonCodes)
    && result.reasonCodes.length > 0
    && Array.isArray(result.changedFields)
    && result.changedFields.length > 0);
}

function buildChangeWatchEntry({
  eventId = "",
  collectionName = "",
  documentPath = "",
  documentId = "",
  changeType = "",
  actorType = "unknown",
  actorId = "",
  actorRole = "user",
  riskLevel = "medium",
  reasonCodes = [],
  changedFields = [],
  before = {},
  after = {},
  now = new Date(),
}) {
  const { dayKey, timeKey } = getChangeWatchDayInfo(now);
  return {
    eventId: String(eventId || "").trim(),
    dayKey,
    timeKey,
    collectionName: String(collectionName || "").trim(),
    documentPath: String(documentPath || "").trim(),
    documentId: String(documentId || "").trim(),
    changeType: String(changeType || "").trim(),
    actorType: normalizeChangeWatchActorType(actorType),
    actorId: normalizeChangeWatchActorId(actorId),
    actorRole: String(actorRole || "user").trim() || "user",
    riskLevel: String(riskLevel || "medium").trim() || "medium",
    reasonCodes: Array.from(new Set(reasonCodes.filter(Boolean))),
    changedFields: Array.from(new Set(changedFields.filter(Boolean))),
    before,
    after,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(now.getTime() + CHANGE_WATCH_RETENTION_DAYS * 24 * 60 * 60 * 1000),
  };
}

async function writeChangeWatchEntry(payload) {
  const entry = buildChangeWatchEntry(payload);
  const safeEventId = entry.eventId || `${entry.collectionName}_${entry.documentId}_${entry.timeKey}`;
  await db.collection("changeWatchByDay")
    .doc(entry.dayKey)
    .collection("changeWatchEntries")
    .doc(safeEventId)
    .set(entry, { merge: true });
  return entry;
}

async function classifyUsersChange({
  changeType,
  beforeData,
  afterData,
  actorType,
  actorId,
  actorRole,
  documentId,
}) {
  const watchedFields = collectFieldNames(
    CHANGE_WATCH_USER_PRIVILEGE_FIELDS,
    CHANGE_WATCH_USER_TEAM_FIELDS,
    new Set(["uid", "lineUserId"]),
  );
  const trustedActor = isTrustedChangeWatchRole(actorRole) || isSystemChangeWatchActor(actorType);
  const selfActor = isSelfUserDocumentActor(actorId, documentId, beforeData, afterData);

  if (changeType === "delete") {
    if (isSystemChangeWatchActor(actorType)) return null;
    const diff = pickSensitiveDiff(beforeData, null, watchedFields);
    return buildChangeWatchResult({
      riskLevel: "high",
      reasonCodes: ["delete_sensitive_doc"],
      changedFields: diff.changedFields,
      before: diff.before,
      after: diff.after,
    });
  }

  if (changeType === "create") {
    if (isSystemChangeWatchActor(actorType)) return null;
    const reasons = [];
    if (normalizeRole(afterData?.role) !== "user" || normalizeRole(afterData?.manualRole) !== "user") {
      reasons.push("user_role_changed");
    }
    if ((afterData?.claims && typeof afterData.claims === "object" && Object.keys(afterData.claims).length > 0)
      || getNumericValue(afterData, "exp") !== 0
      || getNumericValue(afterData, "level", 1) > 1
      || afterData?.isAdmin === true) {
      reasons.push("user_privilege_field_changed");
    }
    if (hasNonEmptyUserTeamMembership(afterData) && !trustedActor) {
      reasons.push("user_team_membership_changed");
    }
    if (actorId && !matchesActorId(actorId, documentId, afterData?.uid, afterData?.lineUserId)) {
      reasons.push("user_identity_mismatch");
    }
    if (reasons.length === 0) return null;
    const diff = pickSensitiveDiff(null, afterData, watchedFields);
    return buildChangeWatchResult({
      riskLevel: reasons.some(code => code === "user_role_changed" || code === "user_privilege_field_changed")
        ? "high"
        : "medium",
      reasonCodes: reasons,
      changedFields: diff.changedFields,
      before: diff.before,
      after: diff.after,
    });
  }

  const changedFields = getChangedFields(beforeData, afterData);
  if (changedFields.length === 0) return null;

  if (selfActor && hasOnlyFields(changedFields, CHANGE_WATCH_USER_SAFE_PROFILE_FIELDS)) return null;
  if (selfActor && hasOnlyFields(changedFields, CHANGE_WATCH_USER_SAFE_LOGIN_FIELDS)) return null;
  if (selfActor
    && hasOnlyFields(changedFields, CHANGE_WATCH_USER_TEAM_FIELDS)
    && isUserTeamMembershipShrinkOrClear(beforeData, afterData)) {
    return null;
  }
  if (trustedActor && !selfActor && hasOnlyFields(changedFields, CHANGE_WATCH_USER_TEAM_FIELDS)) return null;

  const reasons = [];
  if (changedFields.some(field => CHANGE_WATCH_USER_PRIVILEGE_FIELDS.has(field))) {
    if (changedFields.includes("role") || changedFields.includes("manualRole")) {
      reasons.push("user_role_changed");
    }
    reasons.push("user_privilege_field_changed");
  }
  if (changedFields.some(field => CHANGE_WATCH_USER_TEAM_FIELDS.has(field))) {
    reasons.push("user_team_membership_changed");
  }
  if (changedFields.includes("uid") || changedFields.includes("lineUserId")) {
    reasons.push("user_identity_mismatch");
  }
  if (reasons.length === 0) return null;

  const diff = pickSensitiveDiff(beforeData, afterData, watchedFields);
  return buildChangeWatchResult({
    riskLevel: reasons.some(code => code === "user_role_changed" || code === "user_privilege_field_changed")
      ? "high"
      : "medium",
    reasonCodes: reasons,
    changedFields: diff.changedFields,
    before: diff.before,
    after: diff.after,
  });
}

async function classifyEventsChange({
  changeType,
  beforeData,
  afterData,
  actorType,
  actorId,
  actorRole,
}) {
  const watchedFields = collectFieldNames(
    CHANGE_WATCH_EVENT_SIGNUP_FIELDS,
    CHANGE_WATCH_EVENT_OWNER_FIELDS,
    CHANGE_WATCH_EVENT_CAPACITY_FIELDS,
  );
  const ownerActor = matchesActorId(
    actorId,
    beforeData?.ownerUid,
    beforeData?.creatorUid,
    beforeData?.captainUid,
    afterData?.ownerUid,
    afterData?.creatorUid,
    afterData?.captainUid,
  );
  const trustedActor = isTrustedChangeWatchRole(actorRole)
    || isSystemChangeWatchActor(actorType)
    || ownerActor;

  if (changeType === "delete") {
    if (trustedActor) return null;
    const diff = pickSensitiveDiff(beforeData, null, watchedFields);
    return buildChangeWatchResult({
      riskLevel: "high",
      reasonCodes: ["delete_sensitive_doc"],
      changedFields: diff.changedFields,
      before: diff.before,
      after: diff.after,
    });
  }

  if (changeType === "create") {
    if (isSystemChangeWatchActor(actorType)) return null;
    const reasons = [];
    if (actorId
      && !matchesActorId(actorId, afterData?.creatorUid, afterData?.ownerUid, afterData?.captainUid)) {
      reasons.push("event_owner_field_changed");
    }
    if (getNumericValue(afterData, "current") !== 0
      || getNumericValue(afterData, "waitlist") !== 0
      || normalizeStringList(afterData?.participants).length > 0
      || normalizeStringList(afterData?.waitlistNames).length > 0) {
      reasons.push("event_signup_state_changed");
    }
    if (getNumericValue(afterData, "max") < 0) {
      reasons.push("event_capacity_changed");
    }
    if (reasons.length === 0) return null;
    const diff = pickSensitiveDiff(null, afterData, watchedFields);
    return buildChangeWatchResult({
      riskLevel: reasons.includes("event_owner_field_changed") ? "high" : "medium",
      reasonCodes: reasons,
      changedFields: diff.changedFields,
      before: diff.before,
      after: diff.after,
    });
  }

  const changedFields = getChangedFields(beforeData, afterData);
  if (changedFields.length === 0) return null;

  const reasons = [];
  if (!trustedActor && changedFields.some(field => CHANGE_WATCH_EVENT_OWNER_FIELDS.has(field))) {
    reasons.push("event_owner_field_changed");
  }
  if (!trustedActor && changedFields.some(field => CHANGE_WATCH_EVENT_CAPACITY_FIELDS.has(field))) {
    reasons.push("event_capacity_changed");
  }
  if (!trustedActor && changedFields.some(field => CHANGE_WATCH_EVENT_SIGNUP_FIELDS.has(field))) {
    if (!isPlausibleEventSignupDelta(beforeData, afterData)) {
      reasons.push("event_signup_state_changed");
    }
  }
  if (reasons.length === 0) return null;

  const diff = pickSensitiveDiff(beforeData, afterData, watchedFields);
  return buildChangeWatchResult({
    riskLevel: reasons.some(code => code === "event_owner_field_changed" || code === "event_signup_state_changed")
      ? "high"
      : "medium",
    reasonCodes: reasons,
    changedFields: diff.changedFields,
    before: diff.before,
    after: diff.after,
  });
}

async function classifyRegistrationsChange({
  changeType,
  beforeData,
  afterData,
  actorType,
  actorId,
  actorRole,
}) {
  const watchedFields = collectFieldNames(
    CHANGE_WATCH_REGISTRATION_IDENTITY_FIELDS,
    CHANGE_WATCH_REGISTRATION_STATUS_FIELDS,
  );
  const eventIdentifier = afterData?.eventId || beforeData?.eventId || "";
  const eventOwnerActor = await isChangeWatchEventOwner(actorId, eventIdentifier);
  const trustedActor = isTrustedChangeWatchRole(actorRole)
    || isSystemChangeWatchActor(actorType)
    || eventOwnerActor;
  const selfActor = matchesActorId(actorId, beforeData?.userId, beforeData?.uid, afterData?.userId, afterData?.uid);

  if (changeType === "delete") {
    if (trustedActor) return null;
    const diff = pickSensitiveDiff(beforeData, null, watchedFields);
    return buildChangeWatchResult({
      riskLevel: "high",
      reasonCodes: ["delete_sensitive_doc"],
      changedFields: diff.changedFields,
      before: diff.before,
      after: diff.after,
    });
  }

  if (changeType === "create") {
    if (trustedActor) return null;
    const reasons = [];
    if (actorId && !selfActor) {
      reasons.push("registration_identity_changed");
    }
    if (getNumericValue(afterData, "promotionOrder") < 0) {
      reasons.push("registration_identity_changed");
    }
    if (afterData?.status && !["confirmed", "waitlisted", "cancelled", "removed"].includes(String(afterData.status))) {
      reasons.push("registration_status_changed");
    }
    if (reasons.length === 0) return null;
    const diff = pickSensitiveDiff(null, afterData, watchedFields);
    return buildChangeWatchResult({
      riskLevel: reasons.includes("registration_identity_changed") ? "high" : "medium",
      reasonCodes: reasons,
      changedFields: diff.changedFields,
      before: diff.before,
      after: diff.after,
    });
  }

  const changedFields = getChangedFields(beforeData, afterData);
  if (changedFields.length === 0) return null;

  if (trustedActor) return null;
  if (selfActor
    && hasOnlyFields(changedFields, CHANGE_WATCH_REGISTRATION_STATUS_FIELDS)
    && String(afterData?.status || "") === "cancelled") {
    return null;
  }

  const reasons = [];
  if (changedFields.some(field => CHANGE_WATCH_REGISTRATION_IDENTITY_FIELDS.has(field))) {
    reasons.push("registration_identity_changed");
  }
  if (changedFields.includes("status")) {
    reasons.push("registration_status_changed");
  }
  if (reasons.length === 0) return null;

  const diff = pickSensitiveDiff(beforeData, afterData, watchedFields);
  return buildChangeWatchResult({
    riskLevel: reasons.some(code => code === "registration_identity_changed" || code === "registration_status_changed")
      ? "high"
      : "medium",
    reasonCodes: reasons,
    changedFields: diff.changedFields,
    before: diff.before,
    after: diff.after,
  });
}

async function classifyAttendanceChange({
  changeType,
  beforeData,
  afterData,
  actorType,
  actorId,
  actorRole,
}) {
  const watchedFields = collectFieldNames(
    CHANGE_WATCH_ATTENDANCE_IDENTITY_FIELDS,
    CHANGE_WATCH_ATTENDANCE_STATUS_FIELDS,
  );
  const eventIdentifier = afterData?.eventId || beforeData?.eventId || "";
  const eventOwnerActor = await isChangeWatchEventOwner(actorId, eventIdentifier);
  const trustedActor = isTrustedChangeWatchRole(actorRole)
    || isSystemChangeWatchActor(actorType)
    || eventOwnerActor;
  const selfActor = matchesActorId(actorId, beforeData?.uid, afterData?.uid);

  if (changeType === "delete") {
    if (trustedActor) return null;
    const diff = pickSensitiveDiff(beforeData, null, watchedFields);
    return buildChangeWatchResult({
      riskLevel: "high",
      reasonCodes: ["delete_sensitive_doc"],
      changedFields: diff.changedFields,
      before: diff.before,
      after: diff.after,
    });
  }

  if (changeType === "create") {
    if (trustedActor) return null;
    const reasons = [];
    if (!selfActor) {
      reasons.push("attendance_status_changed");
    }
    if (afterData?.status === "removed" || afterData?.removedAt || afterData?.removedByUid) {
      reasons.push("attendance_removal_changed");
    }
    if (reasons.length === 0) return null;
    const diff = pickSensitiveDiff(null, afterData, watchedFields);
    return buildChangeWatchResult({
      riskLevel: "high",
      reasonCodes: reasons,
      changedFields: diff.changedFields,
      before: diff.before,
      after: diff.after,
    });
  }

  const changedFields = getChangedFields(beforeData, afterData);
  if (changedFields.length === 0) return null;

  if (trustedActor) return null;

  const reasons = [];
  if (changedFields.some(field => CHANGE_WATCH_ATTENDANCE_IDENTITY_FIELDS.has(field))) {
    reasons.push("attendance_status_changed");
  }
  if (changedFields.some(field => field === "status" || field === "checkOutTime") && !selfActor) {
    reasons.push("attendance_status_changed");
  }
  if (changedFields.some(field => field === "removedAt" || field === "removedByUid")
    || String(afterData?.status || "") === "removed") {
    reasons.push("attendance_removal_changed");
  }
  if (reasons.length === 0) return null;

  const diff = pickSensitiveDiff(beforeData, afterData, watchedFields);
  return buildChangeWatchResult({
    riskLevel: "high",
    reasonCodes: reasons,
    changedFields: diff.changedFields,
    before: diff.before,
    after: diff.after,
  });
}

async function processChangeWatchEvent(event, collectionName, classifyChange) {
  const beforeData = event?.data?.before?.exists ? (event.data.before.data() || {}) : null;
  const afterData = event?.data?.after?.exists ? (event.data.after.data() || {}) : null;
  const changeType = getChangeType(beforeData, afterData);
  if (!changeType) return null;

  const documentPath = String(
    event?.document
      || event?.data?.after?.ref?.path
      || event?.data?.before?.ref?.path
      || "",
  ).trim();
  const documentId = documentPath ? documentPath.split("/").pop() : "";
  const actorType = normalizeChangeWatchActorType(event?.authType);
  const actorId = normalizeChangeWatchActorId(event?.authId);
  const actorRole = await getChangeWatchActorRole(actorId, actorType);
  const result = await classifyChange({
    changeType,
    beforeData,
    afterData,
    actorType,
    actorId,
    actorRole,
    documentId,
    documentPath,
    event,
  });

  if (!shouldPersistWatchLog(result)) return null;

  return writeChangeWatchEntry({
    eventId: event?.id || `${collectionName}_${documentId}_${Date.now()}`,
    collectionName,
    documentPath,
    documentId,
    changeType,
    actorType,
    actorId,
    actorRole,
    riskLevel: result.riskLevel,
    reasonCodes: result.reasonCodes,
    changedFields: result.changedFields,
    before: result.before,
    after: result.after,
  });
}

exports.autoEndStartedEvents = onSchedule(
  {
    region: "asia-east1",
    schedule: "* * * * *",
    timeZone: "Asia/Taipei",
    timeoutSeconds: 60,
    memory: "256MiB",
    maxInstances: 1,
  },
  async () => {
    const now = new Date();
    const result = await autoEndStartedEventsBatch({ now });
    console.log("[autoEndStartedEvents]", {
      now: now.toISOString(),
      scannedCount: result.scannedCount,
      updatedCount: result.updatedCount,
    });
  },
);

exports.watchUsersChanges = onDocumentWrittenWithAuthContext(
  {
    ...CHANGE_WATCH_FUNCTION_OPTIONS,
    document: "users/{userId}",
  },
  async (event) => processChangeWatchEvent(event, "users", classifyUsersChange),
);

exports.watchEventsChanges = onDocumentWrittenWithAuthContext(
  {
    ...CHANGE_WATCH_FUNCTION_OPTIONS,
    document: "events/{eventId}",
  },
  async (event) => processChangeWatchEvent(event, "events", classifyEventsChange),
);

exports.watchRegistrationsChanges = onDocumentWrittenWithAuthContext(
  {
    ...CHANGE_WATCH_FUNCTION_OPTIONS,
    document: "registrations/{regId}",
  },
  async (event) => processChangeWatchEvent(event, "registrations", classifyRegistrationsChange),
);

exports.watchAttendanceChanges = onDocumentWrittenWithAuthContext(
  {
    ...CHANGE_WATCH_FUNCTION_OPTIONS,
    document: "attendanceRecords/{recordId}",
  },
  async (event) => processChangeWatchEvent(event, "attendanceRecords", classifyAttendanceChange),
);

exports.submitShotGameScore = onCall(
  { region: "asia-east1", timeoutSeconds: 30 },
  async (request) => {
    // 1. 登入驗證
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "必須登入才能提交分數");
    }
    const uid = request.auth.uid;
    const authProvider = String(request.auth?.token?.firebase?.sign_in_provider || "");
    if (authProvider === "anonymous") {
      throw new HttpsError("permission-denied", "匿名登入不可提交射門排行榜");
    }
    const { score, shots, streak, durationMs, displayName } = request.data || {};

    // 2. Payload 驗證
    if (!Number.isInteger(score) || score < 0 || score > 9999) {
      throw new HttpsError("invalid-argument", "score 必須為 0~9999 的整數");
    }
    if (!Number.isInteger(shots) || shots < 1) {
      throw new HttpsError("invalid-argument", "shots 必須 >= 1");
    }
    if (!Number.isFinite(durationMs) || durationMs < 5000) {
      throw new HttpsError("invalid-argument", "durationMs 必須 >= 5000");
    }
    const rawDisplayName =
      typeof displayName === "string" ? displayName.trim() : "";
    const tokenDisplayName =
      typeof request.auth?.token?.name === "string" ? request.auth.token.name.trim() : "";
    const isPlaceholderDisplayName = (name) => /^玩家[\w-]{2,}$/u.test(String(name || "").trim());
    const safeDisplayNameCandidate = [rawDisplayName, tokenDisplayName]
      .find((name) => name && !isPlaceholderDisplayName(name))
      || [rawDisplayName, tokenDisplayName].find((name) => !!name)
      || `玩家${String(uid).slice(-4)}`;
    const safeDisplayName = safeDisplayNameCandidate.slice(0, 50);
    const safeStreak =
      Number.isInteger(streak) && streak >= 0 ? streak : 0;
    const safeDurationMs = Math.round(durationMs);
    const safeDurationSec = Math.max(5, Math.round(safeDurationMs / 1000));

    // 3. 計算 period buckets（Asia/Taipei）
    const now = new Date();
    const {
      daily: dailyBucket,
      weekly: weeklyBucket,
      monthly: monthlyBucket,
    } = getTaipeiDateInfo(now);
    const bucketMap = {
      daily: dailyBucket,
      weekly: weeklyBucket,
      monthly: monthlyBucket,
    };

    // 4. 節流：同 uid（任一榜）10 秒最多 1 次
    const rankingRefs = Object.entries(bucketMap).reduce((acc, [period, bucket]) => {
      acc[period] = db
        .collection("shotGameRankings")
        .doc(bucket)
        .collection("entries")
        .doc(uid);
      return acc;
    }, {});
    const rankingSnaps = Object.fromEntries(
      await Promise.all(
        Object.entries(rankingRefs).map(async ([period, ref]) => [period, await ref.get()])
      )
    );
    for (const snap of Object.values(rankingSnaps)) {
      if (snap.exists) {
        const lastSubmitAt = snap.data().lastSubmitAt;
        if (lastSubmitAt && now.getTime() - lastSubmitAt.toMillis() < 10000) {
          throw new HttpsError("resource-exhausted", "提交過於頻繁，請稍後再試");
        }
      }
    }

    // 5. 稽核 flags（純記錄，不阻擋正常玩家）
    const flags = [];
    if (score > 7000) flags.push("near_max_score");
    if (safeDurationMs < 8000) flags.push("fast_game");
    if (shots > 0 && score / shots > 150) flags.push("high_score_per_shot");
    if (safeStreak > 20) flags.push("high_streak");
    if (flags.length > 0) {
      console.warn("[submitShotGameScore] flags detected", { uid, score, shots, durationMs: safeDurationMs, safeStreak, flags });
    }

    // 6. 寫入原始成績（稽核用）
    const attemptRef = db
      .collection("shotGameScores")
      .doc(uid)
      .collection("attempts")
      .doc();
    await attemptRef.set({
      uid,
      displayName: safeDisplayName,
      score,
      shots,
      streak: safeStreak,
      durationMs: safeDurationMs,
      durationSec: safeDurationSec,
      createdAt: FieldValue.serverTimestamp(),
      source: "function",
      authProvider,
      flags,
    });

    // 7. 更新日/周/月榜（同分時以連進數、再以遊戲時間排序）
    const rankingUpdateResults = await Promise.all(
      Object.keys(rankingRefs).map(async (period) => {
        const rankingData = rankingSnaps[period] && rankingSnaps[period].exists
          ? (rankingSnaps[period].data() || {})
          : {};
        const existingScore = Number.isFinite(rankingData.bestScore) ? rankingData.bestScore : -1;
        const existingStreak = Number.isFinite(rankingData.bestStreak) ? rankingData.bestStreak : -1;
        const existingDurationSec =
          Number.isFinite(rankingData.bestDurationSec) && rankingData.bestDurationSec > 0
            ? rankingData.bestDurationSec
            : (
              Number.isFinite(rankingData.bestDurationMs) && rankingData.bestDurationMs > 0
                ? Math.round(rankingData.bestDurationMs / 1000)
                : Number.MAX_SAFE_INTEGER
            );
        const isNewBest = (
          score > existingScore
          || (score === existingScore && safeStreak > existingStreak)
          || (score === existingScore && safeStreak === existingStreak && safeDurationSec < existingDurationSec)
        );
        const rankingUpdate = {
          uid,
          displayName: safeDisplayName,
          authProvider,
          lastSubmitAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (isNewBest) {
          rankingUpdate.bestScore = score;
          rankingUpdate.bestStreak = safeStreak;
          rankingUpdate.bestDurationMs = safeDurationMs;
          rankingUpdate.bestDurationSec = safeDurationSec;
          rankingUpdate.bestAt = FieldValue.serverTimestamp();
        }
        await rankingRefs[period].set(rankingUpdate, { merge: true });
        return { period, isNewBest };
      })
    );
    const isNewBestByPeriod = rankingUpdateResults.reduce((acc, item) => {
      acc[item.period] = item.isNewBest;
      return acc;
    }, {});
    const isNewBest = !!isNewBestByPeriod.daily;

    console.log("[submitShotGameScore]", {
      uid,
      score,
      streak: safeStreak,
      durationMs: safeDurationMs,
      durationSec: safeDurationSec,
      buckets: bucketMap,
      isNewBestByPeriod,
      authProvider,
    });
    return {
      success: true,
      isNewBest,
      bucket: dailyBucket,
      buckets: bucketMap,
      isNewBestByPeriod,
    };
  }
);

exports.teamShareOg = onRequest(
  { region: "asia-east1", timeoutSeconds: 15 },
  async (req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.set("Allow", "GET, HEAD");
      res.status(405).send("Method Not Allowed");
      return;
    }

    const teamId = parseTeamShareId(req);
    const encodedTeamId = encodeURIComponent(teamId || "");
    const teamShareUrl = teamId
      ? `${SHARE_SITE_ORIGIN}/team-share/${encodedTeamId}`
      : `${SHARE_SITE_ORIGIN}/team-share`;

    let team = null;
    if (teamId) {
      try {
        team = await getTeamByShareId(teamId);
      } catch (err) {
        console.error("[teamShareOg] failed to read team data:", teamId, err);
      }
    }

    const teamName = String(team?.name || "").trim();
    const hasTeam = !!teamName;
    const teamLabel = hasTeam ? `「${teamName}」俱樂部` : "俱樂部";
    const ogTitle = hasTeam
      ? `加入「${teamName}」俱樂部｜ToosterX Hub`
      : "ToosterX Hub 俱樂部邀請";
    const ogDescription = `這是在ToosterX Hub上創立的${teamLabel}，誠摯邀請您加入俱樂部，跟我們一起享受活動~`;
    const ogImage = sanitizeImageUrl(
      team?.image || team?.coverImage || team?.cover || team?.banner || team?.logo
    );
    const MINI_APP_ID = "2009525300-AuPGQ0sh";
    // [備用] 舊 LIFF_ID：const LIFF_ID = "2009084941-zgn7tQOp";
    const redirectUrl = (teamId && team)
      ? `https://miniapp.line.me/${MINI_APP_ID}?team=${encodedTeamId}`
      : `${SHARE_SITE_ORIGIN}/`;
    // [備用] 舊 LIFF 跳轉：`https://liff.line.me/${LIFF_ID}?team=${encodedTeamId}`
    const html = buildTeamShareHtml({
      ogTitle,
      ogDescription,
      ogImage,
      ogUrl: teamShareUrl,
      redirectUrl,
    });

    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "public, max-age=60, s-maxage=300");
    res.status(200).send(html);
  }
);

// ═══════════════════════════════════════════════════════════════
//  eventShareOg — 活動分享 OG 中繼頁（動態縮圖）
// ═══════════════════════════════════════════════════════════════

function sanitizeEventImageUrl(rawUrl) {
  if (typeof rawUrl !== "string") return DEFAULT_EVENT_SHARE_OG_IMAGE;
  const trimmed = rawUrl.trim();
  if (!trimmed) return DEFAULT_EVENT_SHARE_OG_IMAGE;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return DEFAULT_EVENT_SHARE_OG_IMAGE;
}

function parseEventShareId(req) {
  const rawQueryValue = req.query?.eventId;
  const queryValue = Array.isArray(rawQueryValue) ? rawQueryValue[0] : rawQueryValue;
  if (typeof queryValue === "string" && queryValue.trim()) {
    return queryValue.trim();
  }

  const parts = String(req.path || "")
    .split("/")
    .filter(Boolean);
  if (!parts.length) return "";

  const lastSegment = parts[parts.length - 1];
  try {
    return decodeURIComponent(lastSegment).trim();
  } catch (_) {
    return String(lastSegment || "").trim();
  }
}

function buildEventShareHtml({ ogTitle, ogDescription, ogImage, ogUrl, redirectUrl }) {
  const escapedTitle = escapeHtml(ogTitle);
  const escapedDescription = escapeHtml(ogDescription);
  const escapedImage = escapeHtml(ogImage);
  const escapedOgUrl = escapeHtml(ogUrl);
  const escapedRedirectUrl = escapeHtml(redirectUrl);
  const scriptRedirectUrl = JSON.stringify(redirectUrl);

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapedTitle}</title>
  <meta property="og:title" content="${escapedTitle}">
  <meta property="og:description" content="${escapedDescription}">
  <meta property="og:image" content="${escapedImage}">
  <meta property="og:url" content="${escapedOgUrl}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapedTitle}">
  <meta name="twitter:description" content="${escapedDescription}">
  <meta name="twitter:image" content="${escapedImage}">
  <meta name="robots" content="noindex,nofollow">
  <meta http-equiv="refresh" content="0;url=${escapedRedirectUrl}">
</head>
<body>
  <script>
    location.replace(${scriptRedirectUrl});
  </script>
</body>
</html>`;
}

async function getEventById(eventId) {
  if (!eventId) return null;
  const snap = await db.collection("events").doc(eventId).get();
  if (snap.exists) return snap.data() || {};
  return null;
}

exports.eventShareOg = onRequest(
  { region: "asia-east1", timeoutSeconds: 15 },
  async (req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.set("Allow", "GET, HEAD");
      res.status(405).send("Method Not Allowed");
      return;
    }

    const eventId = parseEventShareId(req);
    const encodedEventId = encodeURIComponent(eventId || "");
    const eventShareUrl = eventId
      ? `${SHARE_SITE_ORIGIN}/event-share/${encodedEventId}`
      : `${SHARE_SITE_ORIGIN}/event-share`;

    let event = null;
    if (eventId) {
      try {
        event = await getEventById(eventId);
      } catch (err) {
        console.error("[eventShareOg] failed to read event data:", eventId, err);
      }
    }

    const eventTitle = String(event?.title || "").trim();
    const hasEvent = !!eventTitle;
    const ogTitle = hasEvent
      ? `${eventTitle}｜ToosterX Hub`
      : "ToosterX Hub 活動";
    const descParts = [];
    if (event?.date) descParts.push(event.date);
    if (event?.location) descParts.push(event.location);
    if (event?.max) descParts.push(`${event.current || 0}/${event.max} 人`);
    const ogDescription = descParts.length > 0
      ? descParts.join(" · ")
      : "在 ToosterX Hub 上瀏覽並報名運動活動";
    const ogImage = sanitizeEventImageUrl(event?.image);
    const MINI_APP_ID = "2009525300-AuPGQ0sh";
    const redirectUrl = (eventId && event)
      ? `https://miniapp.line.me/${MINI_APP_ID}?event=${encodedEventId}`
      : `${SHARE_SITE_ORIGIN}/`;
    const html = buildEventShareHtml({
      ogTitle,
      ogDescription,
      ogImage,
      ogUrl: eventShareUrl,
      redirectUrl,
    });

    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "public, max-age=60, s-maxage=300");
    res.status(200).send(html);
  }
);

// ═══════════════════════════════════════════════════════════════
//  submitKickGameScore — 開球王分數提交（距離排行）
// ═══════════════════════════════════════════════════════════════
exports.submitKickGameScore = onCall(
  { region: "asia-east1", timeoutSeconds: 30 },
  async (request) => {
    // 1. 登入驗證
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "必須登入才能提交分數");
    }
    const uid = request.auth.uid;
    const authProvider = String(request.auth?.token?.firebase?.sign_in_provider || "");
    if (authProvider === "anonymous") {
      throw new HttpsError("permission-denied", "匿名登入不可提交開球排行榜");
    }
    const { distance, maxSpeed, kicks, durationMs, displayName } = request.data || {};

    // 2. Payload 驗證
    if (!Number.isFinite(distance) || distance < 0 || distance > 99999) {
      throw new HttpsError("invalid-argument", "distance 必須為 0~99999 的數字");
    }
    if (!Number.isFinite(maxSpeed) || maxSpeed < 0) {
      throw new HttpsError("invalid-argument", "maxSpeed 必須 >= 0");
    }
    if (!Number.isInteger(kicks) || kicks < 1) {
      throw new HttpsError("invalid-argument", "kicks 必須 >= 1");
    }
    if (!Number.isFinite(durationMs) || durationMs < 3000) {
      throw new HttpsError("invalid-argument", "durationMs 必須 >= 3000");
    }
    const rawDisplayName =
      typeof displayName === "string" ? displayName.trim() : "";
    const tokenDisplayName =
      typeof request.auth?.token?.name === "string" ? request.auth.token.name.trim() : "";
    const isPlaceholderDisplayName = (name) => /^玩家[\w-]{2,}$/u.test(String(name || "").trim());
    const safeDisplayNameCandidate = [rawDisplayName, tokenDisplayName]
      .find((name) => name && !isPlaceholderDisplayName(name))
      || [rawDisplayName, tokenDisplayName].find((name) => !!name)
      || `玩家${String(uid).slice(-4)}`;
    const safeDisplayName = safeDisplayNameCandidate.slice(0, 50);
    const safeMaxSpeed = Math.round(maxSpeed * 100) / 100;
    const safeDistance = Math.round(distance * 100) / 100;
    const safeDurationMs = Math.round(durationMs);
    const safeDurationSec = Math.max(3, Math.round(safeDurationMs / 1000));

    // 3. 計算 period buckets（Asia/Taipei）
    const now = new Date();
    const {
      daily: dailyBucket,
      weekly: weeklyBucket,
      monthly: monthlyBucket,
    } = getTaipeiDateInfo(now);
    const bucketMap = {
      daily: dailyBucket,
      weekly: weeklyBucket,
      monthly: monthlyBucket,
    };

    // 4. 節流：同 uid（任一榜）10 秒最多 1 次
    const rankingRefs = Object.entries(bucketMap).reduce((acc, [period, bucket]) => {
      acc[period] = db
        .collection("kickGameRankings")
        .doc(bucket)
        .collection("entries")
        .doc(uid);
      return acc;
    }, {});
    const rankingSnaps = Object.fromEntries(
      await Promise.all(
        Object.entries(rankingRefs).map(async ([period, ref]) => [period, await ref.get()])
      )
    );
    for (const snap of Object.values(rankingSnaps)) {
      if (snap.exists) {
        const lastSubmitAt = snap.data().lastSubmitAt;
        if (lastSubmitAt && now.getTime() - lastSubmitAt.toMillis() < 10000) {
          throw new HttpsError("resource-exhausted", "提交過於頻繁，請稍後再試");
        }
      }
    }

    // 5. 稽核 flags — 超出物理合理值直接拒絕
    const flags = [];
    if (safeDistance > 150) flags.push("extreme_distance");
    if (safeDurationMs < 5000) flags.push("fast_game");
    if (safeMaxSpeed > 250) flags.push("extreme_speed");
    // 交叉驗證：低速不可能遠距
    if (safeDistance > 80 && safeMaxSpeed < 60) flags.push("distance_speed_mismatch");
    if (flags.length > 0) {
      console.warn("[submitKickGameScore] rejected — flags detected", { uid, distance: safeDistance, maxSpeed: safeMaxSpeed, kicks, durationMs: safeDurationMs, flags });
      throw new HttpsError("invalid-argument", "成績數據異常，提交被拒絕");
    }

    // 6. 寫入原始成績（稽核用）
    const attemptRef = db
      .collection("kickGameScores")
      .doc(uid)
      .collection("attempts")
      .doc();
    await attemptRef.set({
      uid,
      displayName: safeDisplayName,
      distance: safeDistance,
      maxSpeed: safeMaxSpeed,
      kicks,
      durationMs: safeDurationMs,
      durationSec: safeDurationSec,
      createdAt: FieldValue.serverTimestamp(),
      source: "function",
      authProvider,
      flags,
    });

    // 7. 更新日/周/月榜（距離優先，同距離以球速排，再以時間排）
    const rankingUpdateResults = await Promise.all(
      Object.keys(rankingRefs).map(async (period) => {
        const rankingData = rankingSnaps[period] && rankingSnaps[period].exists
          ? (rankingSnaps[period].data() || {})
          : {};
        const existingDistance = Number.isFinite(rankingData.bestDistance) ? rankingData.bestDistance : -1;
        const existingMaxSpeed = Number.isFinite(rankingData.bestMaxSpeed) ? rankingData.bestMaxSpeed : -1;
        const existingDurationSec =
          Number.isFinite(rankingData.bestDurationSec) && rankingData.bestDurationSec > 0
            ? rankingData.bestDurationSec
            : (
              Number.isFinite(rankingData.bestDurationMs) && rankingData.bestDurationMs > 0
                ? Math.round(rankingData.bestDurationMs / 1000)
                : Number.MAX_SAFE_INTEGER
            );
        const isNewBest = (
          safeDistance > existingDistance
          || (safeDistance === existingDistance && safeMaxSpeed > existingMaxSpeed)
          || (safeDistance === existingDistance && safeMaxSpeed === existingMaxSpeed && safeDurationSec < existingDurationSec)
        );
        const rankingUpdate = {
          uid,
          displayName: safeDisplayName,
          authProvider,
          lastSubmitAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (isNewBest) {
          rankingUpdate.bestDistance = safeDistance;
          rankingUpdate.bestMaxSpeed = safeMaxSpeed;
          rankingUpdate.bestDurationMs = safeDurationMs;
          rankingUpdate.bestDurationSec = safeDurationSec;
          rankingUpdate.bestAt = FieldValue.serverTimestamp();
        }
        await rankingRefs[period].set(rankingUpdate, { merge: true });
        return { period, isNewBest };
      })
    );
    const isNewBestByPeriod = rankingUpdateResults.reduce((acc, item) => {
      acc[item.period] = item.isNewBest;
      return acc;
    }, {});
    const isNewBest = !!isNewBestByPeriod.daily;

    console.log("[submitKickGameScore]", {
      uid,
      distance: safeDistance,
      maxSpeed: safeMaxSpeed,
      kicks,
      durationMs: safeDurationMs,
      durationSec: safeDurationSec,
      buckets: bucketMap,
      isNewBestByPeriod,
      authProvider,
    });
    return {
      success: true,
      isNewBest,
      bucket: dailyBucket,
      buckets: bucketMap,
      isNewBestByPeriod,
    };
  }
);

// ═══════════════════════════════════════════════════════════════
//  fetchSportsNews — 定時抓取中文體育新聞（每 6 小時）
// ═══════════════════════════════════════════════════════════════

const SPORT_TAG_KEYWORDS = {
  football: [
    "足球", "世足", "世界盃", "英超", "西甲", "德甲", "義甲", "法甲", "歐冠", "歐聯", "歐霸",
    "FIFA", "soccer", "HFL", "MLS", "中超", "J聯盟", "K聯賽",
    "曼城", "曼聯", "利物浦", "切爾西", "兵工廠", "熱刺",
    "巴薩", "皇馬", "馬競", "拜仁", "多特蒙德",
    "AC米蘭", "國際米蘭", "尤文", "巴黎聖日耳曼", "PSG",
    "梅西", "哈蘭德", "姆巴佩", "薩拉赫", "C羅", "內馬爾", "維尼修斯",
    "中華男足", "中華女足", "台灣男足", "台灣女足", "國家隊",
    "世界盃資格賽", "亞洲盃", "美洲盃", "非洲盃", "歐洲盃",
    "阿根廷", "巴西", "法國", "英格蘭", "德國", "西班牙", "葡萄牙", "荷蘭", "義大利", "日本足球",
  ],
  basketball: ["籃球", "NBA", "CBA", "PLG", "T1"],
  baseball_softball: ["棒球", "壘球", "MLB", "中職", "CPBL", "大聯盟"],
  volleyball: ["排球"],
  table_tennis: ["桌球", "乒乓"],
  tennis: ["網球", "ATP", "WTA"],
  badminton: ["羽球", "羽毛球"],
  running: ["馬拉松", "路跑", "田徑"],
  cycling: ["自行車", "單車", "環法"],
  martial_arts: ["格鬥", "拳擊", "UFC", "MMA", "柔道", "跆拳"],
  yoga: ["瑜伽"],
  hiking: ["登山"],
};

function matchSportTag(title, description) {
  const text = (title || "") + " " + (description || "");
  for (const [tag, keywords] of Object.entries(SPORT_TAG_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return tag;
    }
  }
  return "general";
}

exports.fetchSportsNews = onSchedule(
  {
    region: "asia-east1",
    schedule: "0 */6 * * *",
    timeZone: "Asia/Taipei",
    timeoutSeconds: 120,
    memory: "256MiB",
    maxInstances: 1,
    secrets: [NEWS_API_KEY],
  },
  async () => {
    const apiKey = NEWS_API_KEY.value();
    if (!apiKey) {
      console.error("[fetchSportsNews] NEWS_API_KEY not set");
      return;
    }

    // 繁體中文優先：限定台灣 / 香港來源
    const baseUrl = `https://newsdata.io/api/1/latest?language=zh&category=sports&country=tw,hk&apikey=${apiKey}`;
    // 足球專用查詢（確保每次都有足球新聞，含球星與俱樂部）
    const footballUrl = `https://newsdata.io/api/1/latest?language=zh&category=sports&country=tw,hk&q=${encodeURIComponent("足球 OR 英超 OR 歐冠 OR 世足 OR FIFA OR 西甲 OR 德甲 OR 義甲 OR 法甲 OR 梅西 OR 乌克兰 OR 曼城 OR 利物浦 OR 巴薩 OR 皇馬 OR 拜仁")}&apikey=${apiKey}`;

    const fetchJson = (fetchUrl) =>
      new Promise((resolve, reject) => {
        https.get(fetchUrl, (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => {
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
          });
          res.on("error", reject);
        }).on("error", reject);
      });

    // 並行抓兩批：足球專用 + 一般體育
    let footballResponse, generalResponse;
    try {
      [footballResponse, generalResponse] = await Promise.all([
        fetchJson(footballUrl).catch(() => ({ status: "error", results: [] })),
        fetchJson(baseUrl),
      ]);
    } catch (err) {
      console.error("[fetchSportsNews] API request failed:", err.message);
      return;
    }

    if (generalResponse.status !== "success" || !Array.isArray(generalResponse.results)) {
      console.warn("[fetchSportsNews] API returned no results:", generalResponse.status);
      return;
    }

    function toArticle(item) {
      return {
        title: (item.title || "").trim(),
        description: (item.description || "").trim().slice(0, 200),
        url: item.link,
        imageUrl: item.image_url || "",
        source: (item.source_name || item.source_id || "").trim(),
        publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
        sportTag: matchSportTag(item.title, item.description),
        fetchedAt: new Date(),
        language: "zh",
      };
    }

    // 足球關鍵字（用於客戶端二次過濾，確保排前面的真的是足球）
    const FOOTBALL_VERIFY = [
      "足球", "世足", "世界盃", "英超", "西甲", "德甲", "義甲", "法甲",
      "歐冠", "歐聯", "歐霸", "亞足聯", "亞洲盃女足", "FIFA",
      "進球", "射門", "門將", "前鋒", "後衛", "中場",
      "HFL", "MLS", "中超", "J聯盟", "K聯賽",
      // 俱樂部
      "曼城", "曼聯", "利物浦", "切爾西", "兵工廠", "熱刺",
      "巴薩", "皇馬", "馬競", "拜仁", "多特蒙德",
      "AC米蘭", "國際米蘭", "尤文", "巴黎聖日耳曼", "PSG",
      // 球星
      "梅西", "哈蘭德", "姆巴佩", "薩拉赫",
      "C羅", "內馬爾", "貝林厄姆", "維尼修斯",
      // 國家隊
      "中華男足", "中華女足", "台灣男足", "台灣女足", "國家隊",
      "世界盃資格賽", "亞洲盃", "美洲盃", "非洲盃", "歐洲盃",
      "阿根廷", "巴西", "法國", "英格蘭", "德國", "西班牙", "葡萄牙", "荷蘭", "義大利",
    ];
    function isActuallyFootball(item) {
      const text = (item.title || "") + " " + (item.description || "");
      return FOOTBALL_VERIFY.some((kw) => text.includes(kw));
    }

    // 合併兩批結果，去重
    const allItems = [...(footballResponse.results || []), ...(generalResponse.results || [])]
      .filter((i) => i.title && i.link);
    const seen = new Set();
    const unique = [];
    for (const item of allItems) {
      if (!seen.has(item.link)) { seen.add(item.link); unique.push(item); }
    }

    // 足球新聞排前，其他體育補後
    const fbFirst = unique.filter(isActuallyFootball);
    const others = unique.filter((i) => !isActuallyFootball(i));
    const sorted = [...fbFirst, ...others];

    const articles = sorted.slice(0, 8).map(toArticle);
    console.log(`[fetchSportsNews] unique: ${unique.length}, football: ${fbFirst.length}, final: ${articles.length}`);

    if (articles.length === 0) {
      console.warn("[fetchSportsNews] No valid articles after filtering");
      return;
    }

    // Clear old articles and write new batch
    const batchOp = db.batch();
    const collRef = db.collection("newsArticles");
    const oldDocs = await collRef.get();
    oldDocs.forEach((doc) => batchOp.delete(doc.ref));

    articles.forEach((article) => {
      const docRef = collRef.doc();
      batchOp.set(docRef, article);
    });

    await batchOp.commit();
    console.log(`[fetchSportsNews] Wrote ${articles.length} articles`);
  }
);

// ─── UID 欄位遷移 ───────────────────────────────────────────────
// 修正 attendanceRecords / activityRecords 中 uid 為 displayName 的歷史資料
exports.migrateUidFields = onCall(
  {
    region: "asia-east1",
    timeoutSeconds: 540,
    memory: "512MiB",
    maxInstances: 1,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const access = await getCallerAccessContext(request);
    if (!access.isSuperAdmin) {
      throw new HttpsError("permission-denied", "Only super_admin can run UID migration");
    }

    const { dryRun: rawDryRun = true, collection = "both" } = request.data || {};
    // 嚴格型別：只有 boolean false 才執行寫入，"false" 字串視為 dry-run
    const dryRun = rawDryRun !== false;
    if (!["attendanceRecords", "activityRecords", "both"].includes(collection)) {
      throw new HttpsError("invalid-argument", "collection must be attendanceRecords, activityRecords, or both");
    }

    console.log(`[migrateUidFields] start — dryRun=${dryRun}, collection=${collection}, caller=${request.auth.uid}`);

    // Step 1: 載入所有用戶，建立映射表
    const usersSnap = await db.collection("users").get();
    const validUids = new Set();
    const nameToUid = new Map();
    const duplicateNames = new Set();

    usersSnap.docs.forEach((doc) => {
      const data = doc.data() || {};
      const uid = String(data.uid || data.lineUserId || doc.id || "").trim();
      if (!uid) return;
      validUids.add(uid);
      if (data.lineUserId) validUids.add(String(data.lineUserId).trim());
      // doc.id 也加入合法 UID，避免用 Firestore 文件 ID 作為 uid 的記錄被誤判
      if (doc.id && doc.id !== uid) validUids.add(doc.id);

      [data.displayName, data.name].forEach((n) => {
        const name = String(n || "").trim();
        if (!name || name === uid) return;
        if (nameToUid.has(name) && nameToUid.get(name) !== uid) {
          duplicateNames.add(name);
        }
        // 優先使用有 lineUserId 的用戶
        if (!nameToUid.has(name) || data.lineUserId) {
          nameToUid.set(name, uid);
        }
      });
    });

    console.log(`[migrateUidFields] users=${usersSnap.size}, validUids=${validUids.size}, nameMap=${nameToUid.size}, duplicateNames=${duplicateNames.size}`);

    // Step 2: 載入 registrations 用於同名用戶交叉比對
    const regsSnap = await db.collection("registrations").get();
    const regsByEventAndName = new Map(); // "eventId::userName" → userId
    regsSnap.docs.forEach((doc) => {
      const data = doc.data() || {};
      const userId = String(data.userId || "").trim();
      const eventId = String(data.eventId || "").trim();
      const userName = String(data.userName || "").trim();
      if (userId && eventId && userName) {
        regsByEventAndName.set(`${eventId}::${userName}`, userId);
      }
    });

    // Step 3: 掃描並修正目標集合
    const collections = [];
    if (collection === "attendanceRecords" || collection === "both") {
      collections.push("attendanceRecords");
    }
    if (collection === "activityRecords" || collection === "both") {
      collections.push("activityRecords");
    }

    const result = {
      success: true,
      dryRun,
      collections: {},
      totalFixed: 0,
      totalUnmapped: 0,
      totalSkipped: 0,
      duplicateNames: Array.from(duplicateNames).slice(0, 20),
    };

    for (const colName of collections) {
      const colSnap = await db.collection(colName).get();
      const colResult = {
        total: colSnap.size,
        alreadyCorrect: 0,
        fixed: 0,
        unmapped: 0,
        fixedSamples: [],
        unmappedSamples: [],
      };

      const changes = []; // { docId, oldUid, newUid }

      for (const doc of colSnap.docs) {
        const data = doc.data() || {};
        const uid = String(data.uid || "").trim();
        if (!uid) continue;

        // 已經是合法 UID → 跳過
        if (validUids.has(uid)) {
          colResult.alreadyCorrect++;
          continue;
        }

        // 嘗試用 nameToUid 映射
        let resolvedUid = nameToUid.get(uid) || null;

        // 同名用戶衝突：交叉比對 registrations，若比對失敗則標記為無法映射（避免寫入錯誤 UID）
        if (resolvedUid && duplicateNames.has(uid)) {
          const eventId = String(data.eventId || "").trim();
          const regKey = `${eventId}::${uid}`;
          const regUid = regsByEventAndName.get(regKey);
          if (regUid && validUids.has(regUid)) {
            resolvedUid = regUid;
          } else {
            resolvedUid = null; // 無法確定是哪位同名用戶，寧可不改
          }
        }

        // 二次查詢：用 doc.userName 欄位
        if (!resolvedUid) {
          const userName = String(data.userName || "").trim();
          if (userName && userName !== uid) {
            resolvedUid = nameToUid.get(userName) || null;
            // 同名衝突也做交叉比對，比對失敗則標記為無法映射
            if (resolvedUid && duplicateNames.has(userName)) {
              const eventId = String(data.eventId || "").trim();
              const regKey = `${eventId}::${userName}`;
              const regUid = regsByEventAndName.get(regKey);
              if (regUid && validUids.has(regUid)) {
                resolvedUid = regUid;
              } else {
                resolvedUid = null; // 無法確定是哪位同名用戶，寧可不改
              }
            }
          }
        }

        if (resolvedUid) {
          changes.push({ docId: doc.id, oldUid: uid, newUid: resolvedUid });
          colResult.fixed++;
          if (colResult.fixedSamples.length < 10) {
            colResult.fixedSamples.push({
              docId: doc.id,
              oldUid: uid,
              newUid: resolvedUid,
              eventId: data.eventId || "?",
              userName: data.userName || "?",
            });
          }
        } else {
          colResult.unmapped++;
          if (colResult.unmappedSamples.length < 10) {
            colResult.unmappedSamples.push({
              docId: doc.id,
              uid,
              eventId: data.eventId || "?",
              userName: data.userName || "?",
            });
          }
        }
      }

      // 實際寫入（非 dry-run）
      if (!dryRun && changes.length > 0) {
        // 備份：按 1000 筆分片
        const timestamp = Date.now();
        for (let s = 0; s < changes.length; s += 1000) {
          const slice = changes.slice(s, s + 1000);
          const backupDocId = `${colName}_${timestamp}_${Math.floor(s / 1000)}`;
          await db.collection("_migrationBackups").doc(backupDocId).set({
            collection: colName,
            timestamp,
            callerUid: request.auth.uid,
            startIndex: s,
            count: slice.length,
            changes: slice,
          });
        }

        // 批次更新：每 400 筆一個 batch
        for (let s = 0; s < changes.length; s += 400) {
          const chunk = changes.slice(s, s + 400);
          const batch = db.batch();
          chunk.forEach((c) => {
            batch.update(db.collection(colName).doc(c.docId), { uid: c.newUid });
          });
          await batch.commit();
        }

        console.log(`[migrateUidFields] ${colName}: fixed ${changes.length} docs`);
      }

      result.collections[colName] = colResult;
      result.totalFixed += colResult.fixed;
      result.totalUnmapped += colResult.unmapped;
      result.totalSkipped += colResult.alreadyCorrect;
    }

    // 寫操作日誌（非 dry-run）
    if (!dryRun && result.totalFixed > 0) {
      const callerUser = await findUserDocByUidOrLineUserId(request.auth.uid);
      const callerName = callerUser?.data?.displayName || callerUser?.data?.name || request.auth.uid;
      await writeOperationLog({
        operator: callerName,
        type: "uid_migration",
        typeName: "UID 欄位修正",
        content: `修正 ${result.totalFixed} 筆記錄的 uid 欄位（displayName → LINE userId），無法映射 ${result.totalUnmapped} 筆`,
      });
    }

    console.log(`[migrateUidFields] done — fixed=${result.totalFixed}, unmapped=${result.totalUnmapped}, skipped=${result.totalSkipped}`);
    return result;
  }
);

// ═══════════════════════════════════════════════════
//  backfillAutoExp — 回推補發歷史 Auto-EXP（模式 A：補差額）
//  掃描 registrations / attendanceRecords / events，比對 expLogs，
//  只補發從未發放過的 Auto-EXP，不重新計算已發放的歷史紀錄。
// ═══════════════════════════════════════════════════
const BACKFILL_AUTO_EXP_PERMISSION = "admin.auto_exp.entry";

exports.backfillAutoExp = onCall(
  { region: "asia-east1", timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const access = await getCallerAccessContext(request);
    if (!access.hasPermission(BACKFILL_AUTO_EXP_PERMISSION)) {
      throw new HttpsError("permission-denied", `Missing permission: ${BACKFILL_AUTO_EXP_PERMISSION}`);
    }

    const { dryRun = true } = request.data || {};

    // ── 載入當前 Auto-EXP 規則 ──
    const rulesDoc = await db.collection("siteConfig").doc("autoExpRules").get();
    const rules = rulesDoc.exists ? (rulesDoc.data() || {}) : {};
    const ruleLabels = {
      complete_activity: "完成活動",
      register_activity: "報名活動",
      cancel_registration: "取消報名",
      host_activity: "主辦活動",
      line_binding: "綁定LINE推播",
      noshow_penalty: "放鴿子扣分",
      badge_bonus: "徽章獎勵",
    };

    // 若所有規則都是 0，直接返回
    const activeRules = Object.entries(ruleLabels).filter(([key]) => {
      const amount = typeof rules[key] === "number" ? rules[key] : 0;
      return amount !== 0;
    });
    if (activeRules.length === 0) {
      return { success: true, dryRun, message: "所有規則金額皆為 0，無需補發", stats: {} };
    }

    // ── 載入全域資料（用於多條規則） ──
    const allEventsSnap = await db.collection("events").get();
    const allUsersSnap = await db.collection("users").get();
    const eventTitleMap = new Map(); // eventId → title
    const eventIdByTitle = new Map(); // title → Set<eventId>（title 可能重複）
    allEventsSnap.docs.forEach((doc) => {
      const title = (doc.data() || {}).title || "";
      if (title) {
        eventTitleMap.set(doc.id, title);
        if (!eventIdByTitle.has(title)) eventIdByTitle.set(title, new Set());
        eventIdByTitle.get(title).add(doc.id);
      }
    });

    // ── 載入所有已存在的 expLogs（用於去重） ──
    const expLogsSnap = await db.collection("expLogs").get();
    // 建立已發放的 Set：key = `${uid}_${ruleKey}_${context}`
    // context 可能是 eventTitle（線上發放）或 eventId（backfill 發放）
    const grantedSet = new Set();
    expLogsSnap.docs.forEach((doc) => {
      const data = doc.data() || {};
      const reason = data.reason || "";
      const uid = data.uid || "";
      if (!uid || !reason.startsWith("自動：")) return;
      for (const [key, label] of Object.entries(ruleLabels)) {
        if (reason.includes(`自動：${label}`)) {
          const match = reason.match(/（(.+?)）/);
          const context = match ? match[1] : "";
          if (context) {
            grantedSet.add(`${uid}_${key}_${context}`);
            // 若 context 是 title，也加入對應的 eventId 映射
            const ids = eventIdByTitle.get(context);
            if (ids) {
              ids.forEach((eid) => grantedSet.add(`${uid}_${key}_${eid}`));
            }
            // 若 context 是 eventId，也加入對應的 title 映射
            const title = eventTitleMap.get(context);
            if (title) {
              grantedSet.add(`${uid}_${key}_${title}`);
            }
          }
          break;
        }
      }
    });

    // 也檢查 _expDedupe 中已有的 backfill 記錄
    const dedupeSnap = await db.collection("_expDedupe")
      .where(FieldPath.documentId(), ">=", "autoexp_backfill_")
      .where(FieldPath.documentId(), "<", "autoexp_backfill_\uf8ff")
      .get();
    const dedupeSet = new Set();
    dedupeSnap.docs.forEach((doc) => dedupeSet.add(doc.id));

    const stats = {
      register_activity: { scanned: 0, alreadyGranted: 0, toGrant: 0, granted: 0 },
      cancel_registration: { scanned: 0, alreadyGranted: 0, toGrant: 0, granted: 0 },
      complete_activity: { scanned: 0, alreadyGranted: 0, toGrant: 0, granted: 0 },
      host_activity: { scanned: 0, alreadyGranted: 0, toGrant: 0, granted: 0 },
      line_binding: { scanned: 0, alreadyGranted: 0, toGrant: 0, granted: 0 },
      noshow_penalty: { scanned: 0, alreadyGranted: 0, toGrant: 0, granted: 0 },
      badge_bonus: { scanned: 0, alreadyGranted: 0, toGrant: 0, granted: 0 },
    };
    const grantQueue = []; // { uid, amount, reason, requestId, key }
    // 防止同一次 run 內重複加入 grantQueue（同 userId+eventId 多筆 registration doc）
    const queuedSet = new Set();

    // ── 1. register_activity：registrations where status='confirmed' ──
    const registerAmount = typeof rules.register_activity === "number" ? rules.register_activity : 0;
    if (registerAmount !== 0) {
      const regSnap = await db.collection("registrations")
        .where("status", "==", "confirmed")
        .get();
      for (const doc of regSnap.docs) {
        const data = doc.data() || {};
        const uid = data.userId;
        const eventId = data.eventId || doc.id;
        if (!uid) continue;
        stats.register_activity.scanned++;
        const dedupKey = `${uid}_register_activity_${eventId}`;
        const requestId = `autoexp_backfill_${uid}_register_activity_${eventId}`;
        if (grantedSet.has(dedupKey) || dedupeSet.has(requestId) || queuedSet.has(requestId)) {
          stats.register_activity.alreadyGranted++;
          continue;
        }
        queuedSet.add(requestId);
        stats.register_activity.toGrant++;
        grantQueue.push({
          uid,
          amount: registerAmount,
          reason: `自動：報名活動（${eventId}）`,
          requestId,
          key: "register_activity",
        });
      }
    }

    // ── 2. cancel_registration：registrations where status='cancelled' ──
    const cancelAmount = typeof rules.cancel_registration === "number" ? rules.cancel_registration : 0;
    if (cancelAmount !== 0) {
      const cancelSnap = await db.collection("registrations")
        .where("status", "==", "cancelled")
        .get();
      for (const doc of cancelSnap.docs) {
        const data = doc.data() || {};
        const uid = data.userId;
        const eventId = data.eventId || doc.id;
        if (!uid) continue;
        stats.cancel_registration.scanned++;
        const dedupKey = `${uid}_cancel_registration_${eventId}`;
        const requestId = `autoexp_backfill_${uid}_cancel_registration_${eventId}`;
        if (grantedSet.has(dedupKey) || dedupeSet.has(requestId) || queuedSet.has(requestId)) {
          stats.cancel_registration.alreadyGranted++;
          continue;
        }
        queuedSet.add(requestId);
        stats.cancel_registration.toGrant++;
        grantQueue.push({
          uid,
          amount: cancelAmount,
          reason: `自動：取消報名（${eventId}）`,
          requestId,
          key: "cancel_registration",
        });
      }
    }

    // ── 3. complete_activity：attendanceRecords（checkin + checkout 同時存在） ──
    const completeAmount = typeof rules.complete_activity === "number" ? rules.complete_activity : 0;
    if (completeAmount !== 0) {
      const attendSnap = await db.collection("attendanceRecords").get();
      // 分組：eventId+uid → { hasCheckin, hasCheckout }
      const attendMap = new Map();
      for (const doc of attendSnap.docs) {
        const data = doc.data() || {};
        const uid = data.uid;
        const eventId = data.eventId;
        const type = data.type; // 'checkin' or 'checkout'
        if (!uid || !eventId || !type) continue;
        const mapKey = `${eventId}_${uid}`;
        if (!attendMap.has(mapKey)) {
          attendMap.set(mapKey, { uid, eventId, hasCheckin: false, hasCheckout: false });
        }
        const entry = attendMap.get(mapKey);
        if (type === "checkin") entry.hasCheckin = true;
        if (type === "checkout") entry.hasCheckout = true;
      }
      for (const [, entry] of attendMap) {
        if (!entry.hasCheckin || !entry.hasCheckout) continue;
        stats.complete_activity.scanned++;
        const dedupKey = `${entry.uid}_complete_activity_${entry.eventId}`;
        const requestId = `autoexp_backfill_${entry.uid}_complete_activity_${entry.eventId}`;
        if (grantedSet.has(dedupKey) || dedupeSet.has(requestId) || queuedSet.has(requestId)) {
          stats.complete_activity.alreadyGranted++;
          continue;
        }
        queuedSet.add(requestId);
        stats.complete_activity.toGrant++;
        grantQueue.push({
          uid: entry.uid,
          amount: completeAmount,
          reason: `自動：完成活動（${entry.eventId}）`,
          requestId,
          key: "complete_activity",
        });
      }
    }

    // ── 4. host_activity：events where creatorUid exists ──
    // 複用前面已載入的 allEventsSnap
    const hostAmount = typeof rules.host_activity === "number" ? rules.host_activity : 0;
    if (hostAmount !== 0) {
      for (const doc of allEventsSnap.docs) {
        const data = doc.data() || {};
        const uid = data.creatorUid;
        const eventId = doc.id;
        if (!uid) continue;
        stats.host_activity.scanned++;
        const dedupKey = `${uid}_host_activity_${eventId}`;
        const requestId = `autoexp_backfill_${uid}_host_activity_${eventId}`;
        if (grantedSet.has(dedupKey) || dedupeSet.has(requestId) || queuedSet.has(requestId)) {
          stats.host_activity.alreadyGranted++;
          continue;
        }
        queuedSet.add(requestId);
        stats.host_activity.toGrant++;
        grantQueue.push({
          uid,
          amount: hostAmount,
          reason: `自動：主辦活動（${eventId}）`,
          requestId,
          key: "host_activity",
        });
      }
    }

    // ── 5. line_binding：users where lineNotify.bound === true（一次性獎勵） ──
    const lineBindingAmount = typeof rules.line_binding === "number" ? rules.line_binding : 0;
    if (lineBindingAmount !== 0) {
      for (const doc of allUsersSnap.docs) {
        const data = doc.data() || {};
        const uid = data.uid || data.lineUserId || doc.id;
        if (!uid) continue;
        if (!data.lineNotify || data.lineNotify.bound !== true) continue;
        stats.line_binding.scanned++;
        const dedupKey = `${uid}_line_binding_binding`;
        const requestId = `autoexp_backfill_${uid}_line_binding`;
        if (grantedSet.has(dedupKey) || dedupeSet.has(requestId) || queuedSet.has(requestId)) {
          stats.line_binding.alreadyGranted++;
          continue;
        }
        // 也檢查線上發放的 dedup key（requestId = autoexp_{uid}_line_binding）
        const onlineRequestId = `autoexp_${uid}_line_binding`;
        const onlineDedupeDoc = await db.collection("_expDedupe").doc(onlineRequestId).get();
        if (onlineDedupeDoc.exists) {
          stats.line_binding.alreadyGranted++;
          continue;
        }
        queuedSet.add(requestId);
        stats.line_binding.toGrant++;
        grantQueue.push({
          uid,
          amount: lineBindingAmount,
          reason: `自動：綁定 LINE 推播`,
          requestId,
          key: "line_binding",
        });
      }
    }

    // ── 6. noshow_penalty：放鴿子扣分（reconciliation 模型：count × amount） ──
    const noshowAmount = typeof rules.noshow_penalty === "number" ? rules.noshow_penalty : 0;
    if (noshowAmount !== 0) {
      // 載入所有 registrations 與 attendanceRecords 計算放鴿子次數
      const allRegsSnap = await db.collection("registrations").get();
      const allAttendSnap = await db.collection("attendanceRecords").get();
      // 載入 userCorrections 補正值
      const correctionsSnap = await db.collection("userCorrections").get();
      const correctionMap = new Map();
      correctionsSnap.docs.forEach((doc) => {
        const d = doc.data() || {};
        const adj = Number(d?.noShow?.adjustment || 0);
        if (Number.isFinite(adj) && adj !== 0) correctionMap.set(doc.id, Math.trunc(adj));
      });

      // 建立簽到索引
      const checkinKeys = new Set();
      allAttendSnap.docs.forEach((doc) => {
        const d = doc.data() || {};
        const uid = String(d.uid || "").trim();
        const eventId = String(d.eventId || "").trim();
        const type = String(d.type || "").trim();
        const status = String(d.status || "").trim();
        if (!uid || !eventId) return;
        if (status === "removed" || status === "cancelled") return;
        if (type === "checkin") checkinKeys.add(`${uid}::${eventId}`);
      });

      // 計算每位用戶的放鴿子次數
      const today = new Date().toISOString().slice(0, 10);
      const noshowCountByUid = new Map();
      const seenRegKeys = new Set();
      allRegsSnap.docs.forEach((doc) => {
        const d = doc.data() || {};
        const uid = String(d.userId || "").trim();
        const eventId = String(d.eventId || "").trim();
        const status = String(d.status || "").trim();
        if (!uid || !eventId) return;
        if (status !== "confirmed") return;
        if (d.participantType === "companion") return;
        const regKey = `${uid}::${eventId}`;
        if (seenRegKeys.has(regKey)) return;
        seenRegKeys.add(regKey);
        // 檢查活動是否已結束
        const evt = eventTitleMap.has(eventId) ? allEventsSnap.docs.find((e) => e.id === eventId) : null;
        const evtData = evt ? (evt.data() || {}) : {};
        const dateStr = String(evtData.date || "").trim();
        if (!dateStr || dateStr >= today) return;
        if (checkinKeys.has(regKey)) return;
        noshowCountByUid.set(uid, (noshowCountByUid.get(uid) || 0) + 1);
      });

      // 套用 correction 補正
      correctionMap.forEach((adj, uid) => {
        const raw = noshowCountByUid.get(uid) || 0;
        const effective = Math.max(0, raw + adj);
        if (effective > 0) noshowCountByUid.set(uid, effective);
        else noshowCountByUid.delete(uid);
      });

      // 讀取已發放的 noshow_penalty tracking
      for (const [uid, count] of noshowCountByUid) {
        stats.noshow_penalty.scanned++;
        const expectedTotal = count * noshowAmount;
        // 檢查 autoExpTracking 中已 applied 的值
        let applied = 0;
        try {
          const trackDoc = await db.collection("users").doc(uid)
            .collection("autoExpTracking").doc("noshow_penalty").get();
          if (trackDoc.exists) applied = Number(trackDoc.data().applied) || 0;
        } catch (_) { /* ignore */ }
        const delta = expectedTotal - applied;
        if (delta === 0) {
          stats.noshow_penalty.alreadyGranted++;
          continue;
        }
        const requestId = `autoexp_backfill_${uid}_noshow_penalty_${expectedTotal}`;
        if (dedupeSet.has(requestId) || queuedSet.has(requestId)) {
          stats.noshow_penalty.alreadyGranted++;
          continue;
        }
        queuedSet.add(requestId);
        stats.noshow_penalty.toGrant++;
        grantQueue.push({
          uid,
          amount: delta,
          reason: `自動：放鴿子扣分（${count} 次 × ${noshowAmount}）`,
          requestId,
          key: "noshow_penalty",
        });
      }
    }

    // ── 7. badge_bonus：徽章獎勵（reconciliation 模型：badgeCount × amount） ──
    const badgeBonusAmount = typeof rules.badge_bonus === "number" ? rules.badge_bonus : 0;
    if (badgeBonusAmount !== 0) {
      // 載入 badges 集合（achId 映射）
      const badgesSnap = await db.collection("badges").get();
      const badgeAchIds = new Set();
      badgesSnap.docs.forEach((doc) => {
        const achId = (doc.data() || {}).achId;
        if (achId) badgeAchIds.add(achId);
      });

      // 遍歷所有用戶，讀取 achievements 子集合中已完成且對應 badge 的成就
      for (const userDoc of allUsersSnap.docs) {
        const userData = userDoc.data() || {};
        const uid = userData.uid || userData.lineUserId || userDoc.id;
        if (!uid) continue;
        let badgeCount = 0;
        try {
          const achSnap = await db.collection("users").doc(userDoc.id)
            .collection("achievements").get();
          achSnap.docs.forEach((achDoc) => {
            const achData = achDoc.data() || {};
            if (achData.completedAt && badgeAchIds.has(achDoc.id)) badgeCount++;
          });
        } catch (_) { continue; }
        if (badgeCount === 0) continue;

        stats.badge_bonus.scanned++;
        const expectedTotal = badgeCount * badgeBonusAmount;
        let applied = 0;
        try {
          const trackDoc = await db.collection("users").doc(userDoc.id)
            .collection("autoExpTracking").doc("badge_bonus").get();
          if (trackDoc.exists) applied = Number(trackDoc.data().applied) || 0;
        } catch (_) { /* ignore */ }
        const delta = expectedTotal - applied;
        if (delta === 0) {
          stats.badge_bonus.alreadyGranted++;
          continue;
        }
        const requestId = `autoexp_backfill_${uid}_badge_bonus_${expectedTotal}`;
        if (dedupeSet.has(requestId) || queuedSet.has(requestId)) {
          stats.badge_bonus.alreadyGranted++;
          continue;
        }
        queuedSet.add(requestId);
        stats.badge_bonus.toGrant++;
        grantQueue.push({
          uid,
          amount: delta,
          reason: `自動：徽章獎勵（${badgeCount} 枚 × ${badgeBonusAmount}）`,
          requestId,
          key: "badge_bonus",
        });
      }
    }

    // ── Dry-run 模式：只回傳統計 ──
    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        stats,
        totalToGrant: grantQueue.length,
        message: `預覽完成：共 ${grantQueue.length} 筆待補發`,
      };
    }

    // ── 實際發放 ──
    const now = new Date();
    const timeStr = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    let grantedCount = 0;
    let errorCount = 0;

    // 按 uid 分組以減少 user doc 讀取次數
    const byUid = new Map();
    for (const item of grantQueue) {
      if (!byUid.has(item.uid)) byUid.set(item.uid, []);
      byUid.get(item.uid).push(item);
    }

    // 建立 uid → user doc 映射（複用前面已載入的 allUsersSnap）
    const userByUid = new Map();   // uid → { docId, data }
    const userByDocId = new Map(); // docId → { docId, data }
    allUsersSnap.docs.forEach((doc) => {
      const data = doc.data() || {};
      const entry = { docId: doc.id, data };
      userByDocId.set(doc.id, entry);
      if (data.uid) userByUid.set(data.uid, entry);
      if (data.lineUserId) userByUid.set(data.lineUserId, entry);
    });

    for (const [uid, items] of byUid) {
      const targetUser = userByUid.get(uid) || userByDocId.get(uid) || null;
      if (!targetUser) {
        errorCount += items.length;
        continue;
      }
      const userData = targetUser.data || {};
      let currentExp = typeof userData.exp === "number" ? userData.exp : 0;

      // 一個 uid 的所有補發在一個 batch 內完成（Firestore batch 上限 500）
      const chunks = [];
      for (let i = 0; i < items.length; i += 200) {
        chunks.push(items.slice(i, i + 200));
      }

      for (const chunk of chunks) {
        const batch = db.batch();
        let expDelta = 0;

        for (const item of chunk) {
          // _expDedupe 冪等性保護
          const dedupRef = db.collection("_expDedupe").doc(item.requestId);
          batch.create(dedupRef, {
            callerUid: request.auth.uid,
            createdAt: FieldValue.serverTimestamp(),
            backfill: true,
          });

          // expLog
          const logRef = db.collection("expLogs").doc();
          batch.create(logRef, {
            time: timeStr,
            uid,
            target: userData.displayName || userData.name || uid,
            amount: (item.amount > 0 ? "+" : "") + item.amount,
            reason: item.reason,
            operator: "系統回推",
            operatorUid: request.auth.uid,
            createdAt: FieldValue.serverTimestamp(),
            backfill: true,
          });

          expDelta += item.amount;
          stats[item.key].granted++;
        }

        // 更新 user.exp
        const newExp = Math.max(0, currentExp + expDelta);
        batch.update(db.collection("users").doc(targetUser.docId), {
          exp: newExp,
          updatedAt: FieldValue.serverTimestamp(),
        });

        try {
          await batch.commit();
          grantedCount += chunk.length;
          currentExp = newExp;
        } catch (err) {
          // _expDedupe create 失敗代表已存在（重複執行），跳過
          if (err.code === 6 || err.code === "already-exists") {
            stats[chunk[0].key].alreadyGranted += chunk.length;
          } else {
            console.error(`[backfillAutoExp] batch error for uid=${uid}:`, err.message);
            errorCount += chunk.length;
          }
        }
      }
    }

    // ── 更新 reconciliation tracking（noshow_penalty / badge_bonus） ──
    // 記錄已 applied 的總量，讓線上 _reconcileAutoExp 不會重複計算
    const reconKeys = ["noshow_penalty", "badge_bonus"];
    for (const item of grantQueue) {
      if (!reconKeys.includes(item.key)) continue;
      // 只更新成功發放的項目（dedup 失敗的跳過）
      if (!stats[item.key].granted) continue;
      try {
        const userEntry = userByUid.get(item.uid) || userByDocId.get(item.uid);
        if (!userEntry) continue;
        const trackRef = db.collection("users").doc(userEntry.docId)
          .collection("autoExpTracking").doc(item.key);
        const trackDoc = await trackRef.get();
        const prevApplied = trackDoc.exists ? (Number(trackDoc.data().applied) || 0) : 0;
        await trackRef.set({
          applied: prevApplied + item.amount,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (err) {
        console.warn(`[backfillAutoExp] tracking update failed for ${item.uid}/${item.key}:`, err.message);
      }
    }

    // 寫操作日誌（含結構化統計欄位）
    const uniqueUsers = byUid.size;
    const totalExp = grantQueue.reduce((sum, item) => sum + item.amount, 0);
    const callerUser = await findUserDocByUidOrLineUserId(request.auth.uid);
    const callerName = callerUser?.data?.displayName || callerUser?.data?.name || request.auth.uid;
    const logResult = await writeOperationLog({
      operator: callerName,
      type: "exp_backfill",
      typeName: "EXP 回推補發",
      content: `補發 ${grantedCount} 筆 Auto-EXP、${uniqueUsers} 位用戶、總計 ${totalExp >= 0 ? "+" : ""}${totalExp} EXP${errorCount > 0 ? `（錯誤 ${errorCount} 筆）` : ""}`,
    });
    // 額外寫入結構化數值，方便前端讀取
    await db.collection("operationLogs").doc(logResult._docId).update({
      grantedCount,
      uniqueUsers,
      totalExp,
      errorCount,
    });

    console.log(`[backfillAutoExp] done — granted=${grantedCount}, errors=${errorCount}`);
    return {
      success: true,
      dryRun: false,
      stats,
      totalGranted: grantedCount,
      totalErrors: errorCount,
      message: `補發完成：成功 ${grantedCount} 筆${errorCount > 0 ? `，失敗 ${errorCount} 筆` : ""}`,
    };
  }
);

// ═══════════════════════════════════════════════════════════════════════
//  Wave 1 — 報名流程原子化 (Cloud Functions Migration)
// ═══════════════════════════════════════════════════════════════════════

// ── 純函式：重建活動佔位投影（與前端 firebase-crud.js _rebuildOccupancy 邏輯一致）──
function rebuildOccupancy(event, registrations) {
  const confirmed = registrations.filter((r) => r.status === "confirmed");
  const waitlisted = registrations.filter((r) => r.status === "waitlisted");

  const regSortTime = (r) => {
    const v = r && r.registeredAt;
    if (!v) return Number.POSITIVE_INFINITY;
    // Firestore Timestamp
    if (typeof v.toMillis === "function") {
      try { return v.toMillis(); } catch (_e) { /* ignore */ }
    }
    if (typeof v === "object" && typeof v.seconds === "number") {
      return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1000000);
    }
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  const regSort = (a, b) => {
    const ta = regSortTime(a);
    const tb = regSortTime(b);
    if (ta !== tb) return ta - tb;
    return String(a._docId || a.id || "").localeCompare(String(b._docId || b.id || ""));
  };
  confirmed.sort(regSort);
  waitlisted.sort(regSort);

  const participants = confirmed
    .map((r) =>
      r.participantType === "companion"
        ? String(r.companionName || r.userName || "").trim()
        : String(r.userName || "").trim()
    )
    .filter(Boolean);

  const waitlistNames = waitlisted
    .map((r) =>
      r.participantType === "companion"
        ? String(r.companionName || r.userName || "").trim()
        : String(r.userName || "").trim()
    )
    .filter(Boolean);

  const current = participants.length;
  const waitlist = waitlistNames.length;

  let status = event.status;
  if (status !== "ended" && status !== "cancelled") {
    status = current >= (event.max || 0) ? "full" : "open";
  }

  return { participants, waitlistNames, current, waitlist, status };
}

// ── 內部用 adjustExp（同進程直接呼叫，不走 onCall） ──
async function adjustExpInternal({ targetUid, amount, reason, ruleKey, operatorUid }) {
  if (!targetUid || typeof amount !== "number" || amount === 0) return null;

  const targetUser = await findUserDocByUidOrLineUserId(targetUid);
  if (!targetUser) return null;

  const userData = targetUser.data || {};
  const safeReason = String(reason || "").trim().slice(0, 200);

  const now = new Date();
  const timeStr =
    `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ` +
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const log = {
    time: timeStr,
    uid: userData.uid || userData.lineUserId || targetUser.docId,
    target: userData.displayName || userData.name || targetUid,
    amount: (amount > 0 ? "+" : "") + amount,
    reason: safeReason,
    operator: "系統",
    operatorUid: operatorUid || "cloud_function",
    createdAt: FieldValue.serverTimestamp(),
  };
  if (typeof ruleKey === "string" && ruleKey) log.ruleKey = ruleKey;

  const batch = db.batch();
  // 使用 FieldValue.increment 確保原子性（避免 read-then-write 的競爭條件）
  batch.update(db.collection("users").doc(targetUser.docId), {
    exp: FieldValue.increment(amount),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.create(db.collection("expLogs").doc(), log);
  await batch.commit();

  return { targetUid, amount };
}

// ── 寫入 auditLog 的內部 helper ──
async function writeAuditEntryInternal({ action, targetType, targetId, targetLabel, result, source, meta, actorUid, actorName }) {
  try {
    const payload = buildAuditEntryPayload({
      action: normalizeAuditEnum(action, ALLOWED_AUDIT_ACTIONS) || "unknown",
      targetType: normalizeAuditEnum(targetType, ALLOWED_AUDIT_TARGET_TYPES) || "system",
      targetId: normalizeAuditText(targetId || ""),
      targetLabel: normalizeAuditText(targetLabel || ""),
      result: normalizeAuditEnum(result, ALLOWED_AUDIT_RESULTS) || "success",
      source: "cloud_function",
      meta: sanitizeAuditMeta(meta || {}),
      actorId: actorUid || "system",
      actorName: actorName || "系統",
      actorRole: "system",
    });
    await writeAuditEntry(payload);
  } catch (err) {
    console.error("[writeAuditEntryInternal]", err);
  }
}

// ── 寫入 inbox 通知的內部 helper（雙寫：messages/ + users/{uid}/inbox/）──
async function writeInboxNotification({ recipientUid, title, body, category, categoryLabel }) {
  const safeTitle = String(title || "").slice(0, 200);
  const safeBody = String(body || "").slice(0, 2000);
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    // 舊路徑（向後相容）
    await db.collection("messages").add({
      recipientUid,
      title: safeTitle,
      body: safeBody,
      category: category || "activity",
      categoryLabel: categoryLabel || "活動",
      senderName: "系統",
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    // 新路徑（per-user inbox）
    if (recipientUid) {
      await db.collection("users").doc(recipientUid).collection("inbox").doc(msgId).set({
        id: msgId,
        title: safeTitle,
        body: safeBody,
        preview: safeBody.length > 40 ? safeBody.slice(0, 40) + "..." : safeBody,
        type: category || "activity",
        typeName: categoryLabel || "活動",
        senderName: "系統",
        fromUid: "system",
        read: false,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  } catch (err) {
    console.error("[writeInboxNotification]", err);
  }
}

// ── Per-user inbox 寫入 helper（供 deliverToInbox CF 使用）──
async function _writeToUserInbox(recipientUid, msgData) {
  const docId = msgData.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const doc = {
    id: docId,
    title: String(msgData.title || "").slice(0, 200),
    body: String(msgData.body || "").slice(0, 2000),
    preview: String(msgData.preview || msgData.body || "").slice(0, 43),
    type: msgData.type || "system",
    typeName: msgData.typeName || "系統",
    time: msgData.time || "",
    senderName: msgData.senderName || "系統",
    fromUid: msgData.fromUid || null,
    read: false,
    readAt: null,
    actionType: msgData.actionType || null,
    actionStatus: msgData.actionStatus || null,
    reviewerName: msgData.reviewerName || null,
    meta: msgData.meta || null,
    ref: `messages/${docId}`,
    createdAt: FieldValue.serverTimestamp(),
  };
  await db.collection("users").doc(recipientUid).collection("inbox").doc(docId).set(doc);
  return docId;
}

// ── 驗證呼叫者是否為活動管理者 ──
async function canManageEvent(eventData, callerUid) {
  if (!eventData || !callerUid) return false;
  // 活動建立者
  if (eventData.creatorUid === callerUid) return true;
  // 委託人
  if (Array.isArray(eventData.delegates) && eventData.delegates.some((d) => d.uid === callerUid)) return true;
  // 管理員角色
  const role = await getUserRoleFromFirestore(callerUid);
  const level = ROLE_LEVELS[role] || 0;
  return level >= ROLE_LEVELS.admin;
}

// ── sanitize 字串 helper ──
function sanitizeStr(val, maxLen) {
  if (typeof val !== "string") return "";
  return val.trim().slice(0, maxLen || 50);
}

// ═══════════════════════════════════════════════════════════════
//  registerForEvent — 報名 callable（含同行者）
// ═══════════════════════════════════════════════════════════════
exports.registerForEvent = onCall(
  { region: "asia-east1", timeoutSeconds: 30, memory: "512MiB" },
  async (request) => {
    // ── 身份驗證 ──
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const callerUid = request.auth.uid;

    const { eventId, participants, requestId } = request.data || {};

    // ── 參數驗證 ──
    if (typeof eventId !== "string" || !eventId.trim()) {
      throw new HttpsError("invalid-argument", "eventId is required");
    }
    if (!Array.isArray(participants) || participants.length === 0 || participants.length > 10) {
      throw new HttpsError("invalid-argument", "participants must be an array (1-10)");
    }

    // ── 冪等性保護 ──
    const safeRequestId = typeof requestId === "string" && requestId.length > 0
      ? requestId.slice(0, 100)
      : `${callerUid}_${eventId}_${Date.now()}`;
    const dedupRef = db.collection("_regDedupe").doc(safeRequestId);
    try {
      // expiresAt 供 Firestore TTL Policy 自動清理（設定 TTL 於 _regDedupe 集合的 expiresAt 欄位）
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 分鐘後過期
      await dedupRef.create({
        callerUid,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt),
      });
    } catch (e) {
      if (e.code === 6 || e.code === "already-exists") {
        return { success: true, deduplicated: true };
      }
      // 非 already-exists 錯誤：記錄但不中斷流程（dedupe 為保護性機制，非必要條件）
      console.warn("[registerForEvent] dedupe create failed:", e.message);
    }

    // ── 強制 participants[0].userId === callerUid ──
    const firstParticipant = participants[0];
    if (!firstParticipant || firstParticipant.userId !== callerUid) {
      throw new HttpsError("permission-denied", "First participant must be the caller");
    }

    // ── sanitize 所有參與者 ──
    const sanitizedParticipants = participants.map((p, idx) => ({
      userId: sanitizeStr(p.userId, 100),
      userName: sanitizeStr(p.userName, 50),
      participantType: idx === 0 && !p.companionId ? "self" : "companion",
      companionId: p.companionId ? sanitizeStr(p.companionId, 100) : null,
      companionName: p.companionName ? sanitizeStr(p.companionName, 50) : null,
    }));

    // ── 預先查詢呼叫者資料（在 Transaction 外，避免 Transaction 內做非交易讀取）──
    const callerUserDoc = await findUserDocByUidOrLineUserId(callerUid);

    // ── Firestore Transaction ──
    const regDocRefs = sanitizedParticipants.map(() => db.collection("registrations").doc());

    const result = await db.runTransaction(async (transaction) => {
      // T1: 讀取活動
      const eventRef = db.collection("events").doc(eventId);
      const eventDoc = await transaction.get(eventRef);
      if (!eventDoc.exists) {
        throw new HttpsError("not-found", "EVENT_NOT_FOUND");
      }
      const ed = eventDoc.data();
      const maxCount = ed.max || 0;

      // T2: 驗證活動狀態
      if (ed.status === "ended") throw new HttpsError("failed-precondition", "EVENT_ENDED");
      if (ed.status === "cancelled") throw new HttpsError("failed-precondition", "EVENT_CANCELLED");
      if (ed.status === "upcoming") throw new HttpsError("failed-precondition", "REG_NOT_OPEN");

      // 檢查活動開始時間
      if (ed.date) {
        const startDate = parseEventStartDateInTaipei(ed.date);
        if (startDate && startDate <= new Date()) {
          throw new HttpsError("failed-precondition", "EVENT_ENDED");
        }
      }

      // 報名開放時間檢查
      if (ed.regOpenTime) {
        const regOpen = new Date(ed.regOpenTime);
        if (!isNaN(regOpen.getTime()) && regOpen > new Date()) {
          throw new HttpsError("failed-precondition", "REG_NOT_OPEN");
        }
      }

      // T2: 查詢所有報名（在 Transaction 內查詢，確保一致性）
      const allRegsSnap = await transaction.get(
        db.collection("registrations").where("eventId", "==", eventId)
      );
      const allEventRegs = allRegsSnap.docs.map((d) => {
        const data = d.data();
        return {
          ...data,
          _docId: d.id,
          registeredAt: data.registeredAt?.toDate?.()?.toISOString?.() || data.registeredAt,
        };
      });

      // T3: 重複報名檢查
      const hasActive = allEventRegs.some(
        (r) =>
          r.userId === callerUid &&
          (r.status === "confirmed" || r.status === "waitlisted") &&
          r.participantType !== "companion"
      );
      if (hasActive) {
        throw new HttpsError("already-exists", "ALREADY_REGISTERED");
      }

      // T3: 性別限制檢查（使用 Transaction 前預查的 callerUserDoc，避免 Transaction 內非交易讀取）
      if (ed.genderRestrictionEnabled && ed.allowedGender) {
        const callerGender = callerUserDoc?.data?.gender;
        if (callerGender && ed.allowedGender !== "all") {
          const normalizedGender = callerGender === "男" || callerGender === "male" ? "male" : callerGender === "女" || callerGender === "female" ? "female" : "";
          if (normalizedGender && normalizedGender !== ed.allowedGender) {
            throw new HttpsError("failed-precondition", "GENDER_RESTRICTED");
          }
        }
      }

      // T3: 俱樂部限制檢查（使用預查的 callerUserDoc）
      // 合併 creatorTeamIds（新欄位）與 creatorTeamId（舊欄位）向後相容
      const eventLimitedTeamIds = normalizeStringList(ed.creatorTeamIds);
      if (ed.creatorTeamId && typeof ed.creatorTeamId === "string" && !eventLimitedTeamIds.includes(ed.creatorTeamId)) {
        eventLimitedTeamIds.push(ed.creatorTeamId);
      }
      if (ed.teamOnly && eventLimitedTeamIds.length > 0) {
        const callerTeamIds = getUserTeamIds(callerUserDoc?.data);
        const isMember = eventLimitedTeamIds.some((tid) => callerTeamIds.includes(tid));
        if (!isMember) {
          throw new HttpsError("failed-precondition", "TEAM_RESTRICTED");
        }
      }

      // T4-T5: 判定 confirmed/waitlisted 並寫入
      const firestoreActiveRegs = allEventRegs.filter(
        (r) => r.status !== "cancelled" && r.status !== "removed"
      );
      let confirmedCount = firestoreActiveRegs.filter((r) => r.status === "confirmed").length;

      const registrations = [];
      let newConfirmed = 0;
      let newWaitlisted = 0;
      const nowTimestamp = Timestamp.now();
      const nowISOString = nowTimestamp.toDate().toISOString();

      for (let idx = 0; idx < sanitizedParticipants.length; idx++) {
        const p = sanitizedParticipants[idx];

        // 同行者重複檢查
        if (p.companionId) {
          const dupKey = `${p.userId}_${p.companionId}`;
          const existing = allEventRegs.find((r) => {
            if (r.status === "cancelled" || r.status === "removed") return false;
            const rKey = r.companionId ? `${r.userId}_${r.companionId}` : r.userId;
            return rKey === dupKey;
          });
          if (existing) continue;
        }

        const isWaitlist = confirmedCount >= maxCount;
        const status = isWaitlist ? "waitlisted" : "confirmed";

        const reg = {
          id: "reg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
          eventId,
          userId: p.userId,
          userName: p.userName,
          participantType: p.participantType,
          companionId: p.companionId || null,
          companionName: p.companionName || null,
          status,
          promotionOrder: idx,
          registeredAt: nowTimestamp,
        };

        transaction.set(regDocRefs[idx], reg);
        // 儲存帶有統一時間源的副本供 rebuildOccupancy 使用
        registrations.push({ ...reg, _docId: regDocRefs[idx].id, registeredAt: nowISOString });

        if (status === "confirmed") {
          newConfirmed++;
          confirmedCount++;
        } else {
          newWaitlisted++;
        }
      }

      // T6: 寫入 activityRecord（僅 self，不含 companion）
      const selfReg = registrations.find((r) => r.participantType === "self");
      let activityRecordDocId = null;
      if (selfReg) {
        const dateParts = (ed.date || "").split(" ")[0].split("/");
        const dateStr = dateParts.length >= 3 ? `${dateParts[1]}/${dateParts[2]}` : "";
        const arRef = db.collection("activityRecords").doc();
        transaction.set(arRef, {
          eventId,
          name: ed.title || "",
          date: dateStr,
          status: selfReg.status === "waitlisted" ? "waitlisted" : "registered",
          uid: callerUid,
          eventType: ed.type || "",
          createdAt: FieldValue.serverTimestamp(),
        });
        activityRecordDocId = arRef.id;
      }

      // T7: 更新 event occupancy
      const allRegsForRebuild = [...firestoreActiveRegs, ...registrations];
      const occupancy = rebuildOccupancy({ max: maxCount, status: ed.status }, allRegsForRebuild);

      transaction.update(eventRef, {
        current: occupancy.current,
        waitlist: occupancy.waitlist,
        participants: occupancy.participants,
        waitlistNames: occupancy.waitlistNames,
        status: occupancy.status,
      });

      return {
        registrations: registrations.map((r) => ({
          id: r.id,
          docId: r._docId,
          status: r.status,
          userId: r.userId,
          participantType: r.participantType,
        })),
        event: occupancy,
        confirmed: newConfirmed,
        waitlisted: newWaitlisted,
        activityRecordDocId,
        eventData: { title: ed.title || "", date: ed.date || "", location: ed.location || "", type: ed.type || "" },
      };
    });

    // ── Transaction 成功：後置操作（fire-and-forget） ──
    const postOps = [];

    // P1: auditLog
    postOps.push(
      writeAuditEntryInternal({
        action: "event_signup",
        targetType: "event",
        targetId: eventId,
        targetLabel: result.eventData.title,
        result: "success",
        source: "cloud_function",
        meta: { eventId, statusTo: result.registrations[0]?.status || "confirmed" },
        actorUid: callerUid,
      })
    );

    // P2: 通知
    const selfReg = result.registrations.find((r) => r.participantType === "self");
    if (selfReg) {
      const statusLabel = selfReg.status === "waitlisted" ? "候補" : "正取";
      postOps.push(
        writeInboxNotification({
          recipientUid: callerUid,
          title: "報名成功通知",
          body:
            `報名結果：${statusLabel}\n\n` +
            `活動名稱：${result.eventData.title}\n` +
            `活動時間：${result.eventData.date}\n` +
            `活動地點：${result.eventData.location}`,
          category: "activity",
          categoryLabel: "活動",
        })
      );
    }

    // P3: adjustExp（僅 confirmed 才加分）
    if (selfReg && selfReg.status === "confirmed") {
      postOps.push(
        adjustExpInternal({
          targetUid: callerUid,
          amount: 10,
          reason: `報名活動：${result.eventData.title}`,
          ruleKey: "register_activity",
          operatorUid: callerUid,
        })
      );
    }

    // 非同步執行所有後置操作
    Promise.allSettled(postOps).catch((err) => console.error("[registerForEvent postOps]", err));

    return {
      success: true,
      registrations: result.registrations,
      event: result.event,
      confirmed: result.confirmed,
      waitlisted: result.waitlisted,
    };
  }
);

// ═══════════════════════════════════════════════════════════════
//  cancelRegistration — 取消/移除/候補調整 callable
// ═══════════════════════════════════════════════════════════════
exports.cancelRegistration = onCall(
  { region: "asia-east1", timeoutSeconds: 30, memory: "512MiB" },
  async (request) => {
    // ── 身份驗證 ──
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const callerUid = request.auth.uid;

    const { eventId, registrationIds, reason, requestId } = request.data || {};

    // ── 參數驗證 ──
    if (typeof eventId !== "string" || !eventId.trim()) {
      throw new HttpsError("invalid-argument", "eventId is required");
    }
    if (!Array.isArray(registrationIds) || registrationIds.length === 0 || registrationIds.length > 20) {
      throw new HttpsError("invalid-argument", "registrationIds must be an array (1-20)");
    }
    const validReasons = ["user_cancel", "manager_remove", "capacity_change"];
    const cancelReason = validReasons.includes(reason) ? reason : "user_cancel";

    // ── 冪等性保護 ──
    const safeRequestId = typeof requestId === "string" && requestId.length > 0
      ? requestId.slice(0, 100)
      : `cancel_${callerUid}_${eventId}_${Date.now()}`;
    const dedupRef = db.collection("_regDedupe").doc(safeRequestId);
    try {
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await dedupRef.create({
        callerUid,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt),
      });
    } catch (e) {
      if (e.code === 6 || e.code === "already-exists") {
        return { success: true, deduplicated: true };
      }
      console.warn("[cancelRegistration] dedupe create failed:", e.message);
    }

    // ── 預先查詢呼叫者角色（在 Transaction 外，避免 Transaction 內非交易讀取）──
    let callerRole = null;
    if (cancelReason !== "user_cancel") {
      callerRole = await getUserRoleFromFirestore(callerUid);
    }

    // ── Firestore Transaction ──
    const result = await db.runTransaction(async (transaction) => {
      // T1: 讀取活動
      const eventRef = db.collection("events").doc(eventId);
      const eventDoc = await transaction.get(eventRef);
      if (!eventDoc.exists) {
        throw new HttpsError("not-found", "EVENT_NOT_FOUND");
      }
      const ed = eventDoc.data();

      // T2: 查詢所有報名（在 Transaction 內查詢，確保一致性）
      const allRegsSnap = await transaction.get(
        db.collection("registrations").where("eventId", "==", eventId)
      );
      const allEventRegs = allRegsSnap.docs.map((d) => {
        const data = d.data();
        return {
          ...data,
          _docId: d.id,
          registeredAt: data.registeredAt?.toDate?.()?.toISOString?.() || data.registeredAt,
        };
      });

      // T3: 驗證 registrationIds 存在且可取消
      const targetRegs = [];
      const idSet = new Set(registrationIds);
      for (const reg of allEventRegs) {
        if (idSet.has(reg.id) || idSet.has(reg._docId)) {
          if (reg.status === "cancelled" || reg.status === "removed") {
            throw new HttpsError("failed-precondition", "ALREADY_CANCELLED");
          }
          targetRegs.push(reg);
        }
      }
      if (targetRegs.length === 0) {
        throw new HttpsError("not-found", "REG_NOT_FOUND");
      }

      // 權限檢查：user_cancel 只能取消自己的；manager_remove / capacity_change 需管理者權限
      if (cancelReason === "user_cancel") {
        const unauthorized = targetRegs.find((r) => r.userId !== callerUid);
        if (unauthorized) {
          throw new HttpsError("permission-denied", "PERMISSION_DENIED");
        }
      } else {
        // 使用 Transaction 前預查的 callerRole，避免 Transaction 內非交易讀取
        const isCreator = ed.creatorUid === callerUid;
        const isDelegate = Array.isArray(ed.delegates) && ed.delegates.some((d) => d.uid === callerUid);
        const isAdmin = callerRole && (ROLE_LEVELS[callerRole] || 0) >= ROLE_LEVELS.admin;
        if (!isCreator && !isDelegate && !isAdmin) {
          throw new HttpsError("permission-denied", "PERMISSION_DENIED");
        }
      }

      // T4: 標記取消/移除
      const newStatus = cancelReason === "manager_remove" ? "removed" : "cancelled";
      const hadConfirmed = targetRegs.some((r) => r.status === "confirmed");

      // 在副本上操作
      const simRegs = allEventRegs.map((r) => ({ ...r }));
      const cancelledDocIds = new Set(targetRegs.map((r) => r._docId));
      for (const simReg of simRegs) {
        if (cancelledDocIds.has(simReg._docId)) {
          simReg.status = newStatus;
        }
      }

      // 寫入 Firestore
      for (const reg of targetRegs) {
        transaction.update(db.collection("registrations").doc(reg._docId), {
          status: newStatus,
          [`${newStatus}At`]: FieldValue.serverTimestamp(),
        });
      }

      // T5: 候補遞補
      const promotedCandidates = [];
      if (hadConfirmed) {
        const activeRegs = simRegs.filter(
          (r) => r.status === "confirmed" || r.status === "waitlisted"
        );
        const confirmedCount = activeRegs.filter((r) => r.status === "confirmed").length;
        const maxCount = ed.max || 0;
        let slotsAvailable = maxCount - confirmedCount;

        if (slotsAvailable > 0) {
          const waitlistedCandidates = activeRegs
            .filter((r) => r.status === "waitlisted")
            .sort((a, b) => {
              const ta = new Date(a.registeredAt).getTime();
              const tb = new Date(b.registeredAt).getTime();
              if (ta !== tb) return ta - tb;
              return (a.promotionOrder || 0) - (b.promotionOrder || 0);
            });

          for (const candidate of waitlistedCandidates) {
            if (slotsAvailable <= 0) break;
            candidate.status = "confirmed";
            promotedCandidates.push(candidate);
            transaction.update(db.collection("registrations").doc(candidate._docId), {
              status: "confirmed",
              promotedAt: FieldValue.serverTimestamp(),
            });
            slotsAvailable--;
          }
        }
      }

      // T6: 更新 activityRecords（在 Transaction 內查詢，確保一致性）
      // 取消者的 activityRecord → cancelled/removed
      const arSnap = await transaction.get(
        db.collection("activityRecords").where("eventId", "==", eventId)
      );
      const allArs = arSnap.docs.map((d) => ({ ...d.data(), _docId: d.id }));

      for (const reg of targetRegs) {
        if (reg.participantType === "companion") continue;
        const ar = allArs.find((a) => a.uid === reg.userId && a.status !== "cancelled" && a.status !== "removed");
        if (ar) {
          transaction.update(db.collection("activityRecords").doc(ar._docId), { status: newStatus });
        }
      }

      // 升補者的 activityRecord → registered
      for (const candidate of promotedCandidates) {
        if (candidate.participantType === "companion") continue;
        const ar = allArs.find((a) => a.uid === candidate.userId && a.status === "waitlisted");
        if (ar) {
          transaction.update(db.collection("activityRecords").doc(ar._docId), { status: "registered" });
        }
      }

      // T7: 重建 event occupancy
      const allActive = simRegs.filter(
        (r) => r.status === "confirmed" || r.status === "waitlisted"
      );
      const occupancy = rebuildOccupancy({ max: ed.max || 0, status: ed.status }, allActive);

      transaction.update(eventRef, {
        current: occupancy.current,
        waitlist: occupancy.waitlist,
        participants: occupancy.participants,
        waitlistNames: occupancy.waitlistNames,
        status: occupancy.status,
      });

      return {
        cancelled: targetRegs.map((r) => ({ id: r.id, docId: r._docId, userId: r.userId })),
        promoted: promotedCandidates.map((r) => ({ id: r.id, docId: r._docId, userId: r.userId, userName: r.userName })),
        event: occupancy,
        eventData: { title: ed.title || "", date: ed.date || "", location: ed.location || "", type: ed.type || "" },
      };
    });

    // ── Transaction 成功：後置操作（fire-and-forget） ──
    const postOps = [];

    // P1: 通知取消者
    for (const reg of result.cancelled) {
      postOps.push(
        writeInboxNotification({
          recipientUid: reg.userId,
          title: cancelReason === "manager_remove" ? "報名已被管理員移除" : "取消報名通知",
          body:
            `活動名稱：${result.eventData.title}\n` +
            `活動時間：${result.eventData.date}\n` +
            `活動地點：${result.eventData.location}`,
          category: "activity",
          categoryLabel: "活動",
        })
      );
    }

    // P2: 通知升補者
    for (const candidate of result.promoted) {
      postOps.push(
        writeInboxNotification({
          recipientUid: candidate.userId,
          title: "候補遞補通知",
          body:
            `恭喜！您已從候補升為正取：\n\n` +
            `活動名稱：${result.eventData.title}\n` +
            `活動時間：${result.eventData.date}\n` +
            `活動地點：${result.eventData.location}`,
          category: "activity",
          categoryLabel: "活動",
        })
      );
      // 升補者補發 EXP
      postOps.push(
        adjustExpInternal({
          targetUid: candidate.userId,
          amount: 10,
          reason: `候補遞補報名：${result.eventData.title}`,
          ruleKey: "register_activity",
          operatorUid: callerUid,
        })
      );
    }

    // P3: 取消者扣 EXP（僅 user_cancel）
    if (cancelReason === "user_cancel") {
      for (const reg of result.cancelled) {
        postOps.push(
          adjustExpInternal({
            targetUid: reg.userId,
            amount: -5,
            reason: `取消報名：${result.eventData.title}`,
            ruleKey: "cancel_registration",
            operatorUid: callerUid,
          })
        );
      }
    }

    // P4: auditLog
    postOps.push(
      writeAuditEntryInternal({
        action: "event_cancel_signup",
        targetType: "event",
        targetId: eventId,
        targetLabel: result.eventData.title,
        result: "success",
        source: "cloud_function",
        meta: { eventId, reason: cancelReason, cancelledCount: result.cancelled.length, promotedCount: result.promoted.length },
        actorUid: callerUid,
      })
    );

    Promise.allSettled(postOps).catch((err) => console.error("[cancelRegistration postOps]", err));

    return {
      success: true,
      cancelled: result.cancelled,
      promoted: result.promoted,
      event: result.event,
    };
  }
);

// ═══════════════════════════════════════════════════════════════
//  Usage Metrics — 雲端用量監控
//  定時從 Google Cloud Monitoring API 抓取 Firestore / Functions 用量
//  寫入 usageMetrics/{date} 供前端儀表板顯示
// ═══════════════════════════════════════════════════════════════

const USAGE_PROJECT_ID = "fc-football-6c8dc";

/**
 * 透過 Google Cloud Monitoring API v3 查詢指定 metric
 * 使用 ADC (Application Default Credentials) — Cloud Functions 內建
 */
async function queryMonitoringMetric(metricType, hours = 24) {
  const { GoogleAuth } = require("google-auth-library");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/monitoring.read"] });
  const client = await auth.getClient();

  const now = new Date();
  const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000);

  const filter = `metric.type="${metricType}" AND resource.labels.project_id="${USAGE_PROJECT_ID}"`;
  const url = `https://monitoring.googleapis.com/v3/projects/${USAGE_PROJECT_ID}/timeSeries`
    + `?filter=${encodeURIComponent(filter)}`
    + `&interval.startTime=${startTime.toISOString()}`
    + `&interval.endTime=${now.toISOString()}`
    + `&aggregation.alignmentPeriod=${hours * 3600}s`
    + `&aggregation.perSeriesAligner=ALIGN_SUM`;

  const res = await client.request({ url, method: "GET" });
  return res.data;
}

/** 從 Monitoring API 回應中提取數值總和 */
function extractMetricSum(data) {
  if (!data || !data.timeSeries || data.timeSeries.length === 0) return 0;
  let total = 0;
  for (const series of data.timeSeries) {
    for (const point of (series.points || [])) {
      const v = point.value;
      total += v.int64Value ? parseInt(v.int64Value) : (v.doubleValue || 0);
    }
  }
  return total;
}

/** 從 Monitoring API 回應中提取分布值 (distribution) 的 count */
function extractDistributionCount(data) {
  if (!data || !data.timeSeries || data.timeSeries.length === 0) return 0;
  let total = 0;
  for (const series of data.timeSeries) {
    for (const point of (series.points || [])) {
      const v = point.value;
      if (v.distributionValue) {
        total += v.distributionValue.count ? parseInt(v.distributionValue.count) : 0;
      } else {
        total += v.int64Value ? parseInt(v.int64Value) : (v.doubleValue || 0);
      }
    }
  }
  return total;
}

/**
 * fetchUsageMetrics — 每小時自動抓取用量指標
 * 也可透過 onCall 手動觸發
 */
async function collectUsageMetrics() {
  const metrics = {};
  const errors = [];

  // 定義要抓的指標
  const metricQueries = [
    { key: "firestoreReads",   metric: "firestore.googleapis.com/document/read_count",   extractor: extractMetricSum },
    { key: "firestoreWrites",  metric: "firestore.googleapis.com/document/write_count",  extractor: extractMetricSum },
    { key: "firestoreDeletes", metric: "firestore.googleapis.com/document/delete_count", extractor: extractMetricSum },
    { key: "functionsInvocations", metric: "cloudfunctions.googleapis.com/function/execution_count", extractor: extractMetricSum },
    { key: "functionsLatency", metric: "cloudfunctions.googleapis.com/function/execution_times", extractor: extractDistributionCount },
  ];

  for (const q of metricQueries) {
    try {
      const data = await queryMonitoringMetric(q.metric, 24);
      metrics[q.key] = q.extractor(data);
    } catch (err) {
      errors.push(`${q.key}: ${err.message || err}`);
      metrics[q.key] = null;
    }
  }

  // Firestore 儲存量
  // 嘗試多種 metric 名稱（不同 Firestore 模式/方案有不同 metric）
  // 此指標在 Spark 方案或新啟用 Monitoring API 的專案可能不存在，靜默跳過不報錯
  const storageMetricCandidates = [
    "firestore.googleapis.com/storage/size",
    "firestore.googleapis.com/document/storage/size",
  ];
  metrics.firestoreStorageBytes = null;
  for (const candidate of storageMetricCandidates) {
    try {
      const data = await queryMonitoringMetric(candidate, 2);
      if (data && data.timeSeries && data.timeSeries.length > 0) {
        const points = data.timeSeries[0].points || [];
        if (points.length > 0) {
          const v = points[0].value;
          metrics.firestoreStorageBytes = v.int64Value ? parseInt(v.int64Value) : (v.doubleValue || 0);
          break; // 找到就停
        }
      }
    } catch (_) {
      // 此 metric 不存在，嘗試下一個候選
    }
  }
  if (!metrics.firestoreStorageBytes) {
    // 靜默設為 null，不計入 errors（此指標在部分方案不可用是預期行為）
    metrics.firestoreStorageBytes = null;
  }

  // ── Cloud Billing API：取得本月實際費用 ──
  const billingData = { totalCost: null, costByService: null, currency: "USD", billingPeriod: null };
  try {
    const { GoogleAuth: BillingGAuth } = require("google-auth-library");

    // 取當月起迄（UTC）
    const billingNow = new Date();
    const monthStart = new Date(Date.UTC(billingNow.getUTCFullYear(), billingNow.getUTCMonth(), 1));
    billingData.billingPeriod = `${monthStart.toISOString().slice(0, 7)}`;

    // 使用 Cloud Monitoring 的 billing/cost metric（最輕量方式，不需 BigQuery Export）
    const billingFilter = `metric.type="billing.googleapis.com/billing/cost" AND resource.labels.project_id="${USAGE_PROJECT_ID}"`;
    const billingUrl = `https://monitoring.googleapis.com/v3/projects/${USAGE_PROJECT_ID}/timeSeries`
      + `?filter=${encodeURIComponent(billingFilter)}`
      + `&interval.startTime=${monthStart.toISOString()}`
      + `&interval.endTime=${billingNow.toISOString()}`
      + `&aggregation.alignmentPeriod=${Math.max(1, Math.floor((billingNow - monthStart) / 1000))}s`
      + `&aggregation.perSeriesAligner=ALIGN_SUM`;

    const monAuth = new BillingGAuth({ scopes: ["https://www.googleapis.com/auth/monitoring.read"] });
    const monClient = await monAuth.getClient();
    const billingRes = await monClient.request({ url: billingUrl, method: "GET" });

    if (billingRes.data && billingRes.data.timeSeries) {
      const costByService = {};
      let total = 0;
      for (const series of billingRes.data.timeSeries) {
        const serviceName = (series.resource && series.resource.labels && series.resource.labels.service)
          || (series.metric && series.metric.labels && series.metric.labels.service)
          || "other";
        let seriesCost = 0;
        for (const point of (series.points || [])) {
          const v = point.value;
          seriesCost += v.doubleValue || (v.int64Value ? parseInt(v.int64Value) : 0);
        }
        costByService[serviceName] = (costByService[serviceName] || 0) + seriesCost;
        total += seriesCost;
      }
      billingData.totalCost = Math.round(total * 100) / 100;
      billingData.costByService = costByService;
    }
  } catch (err) {
    // Billing metric 可能不存在（需要 Billing Export 啟用），靜默失敗
    console.warn("[fetchUsageMetrics] billing cost fetch failed (expected if billing export not enabled):", err.message || err);
    billingData.totalCost = null;
  }

  // ── 用量估算費用（作為 Billing API 的即時備援） ──
  const estimated = { totalCost: 0, breakdown: {} };
  const PRICING = {
    firestoreReads:   { free: 50000,   pricePerUnit: 0.06 / 100000 },
    firestoreWrites:  { free: 20000,   pricePerUnit: 0.18 / 100000 },
    firestoreDeletes: { free: 20000,   pricePerUnit: 0.02 / 100000 },
    functionsInvocations: { free: 66666, pricePerUnit: 0.40 / 1000000 },
  };
  for (const [key, pricing] of Object.entries(PRICING)) {
    const used = metrics[key] || 0;
    const overage = Math.max(0, used - pricing.free);
    const cost = Math.round(overage * pricing.pricePerUnit * 10000) / 10000;
    estimated.breakdown[key] = { used, free: pricing.free, overage, cost };
    estimated.totalCost += cost;
  }
  estimated.totalCost = Math.round(estimated.totalCost * 100) / 100;

  // 寫入 Firestore
  const now = new Date();
  const taipeiOffset = 8 * 60 * 60 * 1000;
  const taipeiDate = new Date(now.getTime() + taipeiOffset);
  const dateKey = taipeiDate.toISOString().slice(0, 10).replace(/-/g, "");

  const docData = {
    ...metrics,
    billing: billingData,
    estimated,
    collectedAt: FieldValue.serverTimestamp(),
    dateKey,
    periodHours: 24,
    errors: errors.length > 0 ? errors : null,
  };

  await db.collection("usageMetrics").doc(dateKey).set(docData, { merge: true });
  console.log(`[fetchUsageMetrics] ${dateKey} written:`, JSON.stringify(metrics));
  return { dateKey, metrics, billing: billingData, estimated, errors };
}

// 定時排程：每小時執行
exports.fetchUsageMetrics = onSchedule(
  { schedule: "every 1 hours", region: "asia-east1", timeoutSeconds: 120 },
  async () => {
    await collectUsageMetrics();
  }
);

// 手動觸發（super_admin only）
exports.fetchUsageMetricsManual = onCall(
  { region: "asia-east1", timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "未登入");
    const callerUid = request.auth.uid;
    const callerDoc = await db.collection("users").doc(callerUid).get();
    const callerRole = callerDoc.exists ? callerDoc.data().role : "user";
    if (callerRole !== "super_admin") {
      throw new HttpsError("permission-denied", "僅限超級管理員");
    }
    const result = await collectUsageMetrics();
    return { success: true, ...result };
  }
);

// ═══════════════════════════════════════════
//  Education: Secure Check-in（教育簽到 — 後端驗證）
//  僅俱樂部幹部（captainUid / leaderUids / coaches）可執行簽到
// ═══════════════════════════════════════════
exports.eduCheckin = onCall(
  { region: "asia-east1", timeoutSeconds: 30 },
  async (request) => {
    // 1. 登入驗證
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "必須登入才能執行簽到");
    }
    const callerUid = request.auth.uid;

    const { teamId, records } = request.data || {};

    // 2. 參數驗證
    if (typeof teamId !== "string" || !teamId.trim()) {
      throw new HttpsError("invalid-argument", "teamId 為必填");
    }
    if (!Array.isArray(records) || records.length === 0) {
      throw new HttpsError("invalid-argument", "records 必須為非空陣列");
    }
    if (records.length > 100) {
      throw new HttpsError("invalid-argument", "單次簽到不得超過 100 筆");
    }

    // 3. 驗證呼叫者是否為該俱樂部幹部
    //    前端傳入的 teamId 是資料的 id 欄位（自訂 ID），非 Firestore 文件 ID
    const teamSnap = await db.collection("teams").where("id", "==", teamId).limit(1).get();
    if (teamSnap.empty) {
      throw new HttpsError("not-found", "俱樂部不存在");
    }
    const team = teamSnap.docs[0].data();

    const isStaff = (() => {
      if (team.captainUid === callerUid) return true;
      if (team.creatorUid === callerUid) return true;
      if (team.ownerUid === callerUid) return true;
      if (team.leaderUid === callerUid) return true;
      if (Array.isArray(team.leaderUids) && team.leaderUids.includes(callerUid)) return true;
      // coaches 是名稱陣列，需要透過 uid 查找
      // 先用 callerUid 查 users 集合取得名稱
      return false;
    })();

    // 若非直接 UID 匹配，檢查 coaches 名稱匹配
    let isCoachMatch = false;
    if (!isStaff && Array.isArray(team.coaches) && team.coaches.length > 0) {
      const callerUserDoc = await db.collection("users").doc(callerUid).get();
      if (callerUserDoc.exists) {
        const callerData = callerUserDoc.data();
        const callerNames = [callerData.displayName, callerData.name].filter(Boolean);
        isCoachMatch = team.coaches.some((c) => callerNames.includes(c));
      }
    }

    if (!isStaff && !isCoachMatch) {
      throw new HttpsError("permission-denied", "僅俱樂部幹部可執行簽到");
    }

    // 4. 驗證日期合法性（不允許未來日期，最多回溯 7 天）
    const now = new Date();
    const taipeiOffset = 8 * 60 * 60 * 1000;
    const todayTaipei = new Date(now.getTime() + taipeiOffset).toISOString().slice(0, 10);

    // 5. 收集所有 studentId + date 組合，用於重複檢查
    const checkPairs = new Set();
    const validatedRecords = [];

    for (const r of records) {
      if (typeof r.studentId !== "string" || !r.studentId.trim()) {
        throw new HttpsError("invalid-argument", "每筆記錄需包含 studentId");
      }
      if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
        throw new HttpsError("invalid-argument", "date 格式須為 YYYY-MM-DD");
      }
      // 不允許未來日期
      if (r.date > todayTaipei) {
        throw new HttpsError("invalid-argument", "不允許簽到未來日期：" + r.date);
      }
      // 最多回溯 7 天
      const diffDays = (new Date(todayTaipei) - new Date(r.date)) / (1000 * 60 * 60 * 24);
      if (diffDays > 7) {
        throw new HttpsError("invalid-argument", "簽到日期不得超過 7 天前：" + r.date);
      }
      // 同一批次內不可重複 studentId+date
      const pairKey = r.studentId + "_" + r.date;
      if (checkPairs.has(pairKey)) continue;
      checkPairs.add(pairKey);
      validatedRecords.push(r);
    }

    // 6. 查詢已存在的簽到紀錄，跳過重複
    const studentIds = [...new Set(validatedRecords.map((r) => r.studentId))];
    const dates = [...new Set(validatedRecords.map((r) => r.date))];
    const existingKeys = new Set();

    // Firestore in 查詢限制 30 個元素，分批查
    for (let i = 0; i < studentIds.length; i += 30) {
      const chunk = studentIds.slice(i, i + 30);
      for (const date of dates) {
        const snap = await db.collection("eduAttendance")
          .where("teamId", "==", teamId)
          .where("studentId", "in", chunk)
          .where("date", "==", date)
          .where("status", "==", "active")
          .get();
        snap.forEach((doc) => {
          const d = doc.data();
          existingKeys.add(d.studentId + "_" + d.date);
        });
      }
    }

    // 7. 批次寫入（僅新紀錄，伺服器端生成 ID）
    const batch = db.batch();
    const written = [];

    for (const r of validatedRecords) {
      const pairKey = r.studentId + "_" + r.date;
      if (existingKeys.has(pairKey)) continue; // 跳過已存在

      const docRef = db.collection("eduAttendance").doc(); // 伺服器生成 ID
      const docId = docRef.id;

      const payload = {
        id: docId,
        teamId: teamId,
        groupId: r.groupId || "",
        coursePlanId: r.coursePlanId || null,
        studentId: r.studentId,
        studentName: typeof r.studentName === "string" ? r.studentName.slice(0, 50) : "",
        parentUid: r.parentUid || null,
        selfUid: r.selfUid || null,
        checkedInByUid: callerUid,
        date: r.date,
        time: typeof r.time === "string" ? r.time.slice(0, 5) : "",
        sessionNumber: r.sessionNumber || null,
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      batch.set(docRef, payload);
      written.push({ id: docId, studentId: r.studentId, studentName: payload.studentName });
    }

    if (written.length > 0) {
      await batch.commit();
    }

    return { success: true, count: written.length, records: written };
  }
);

// ═══════════════════════════════════════════════════════
//  deliverToInbox — Per-user inbox fan-out 寫入
//  前端呼叫此 CF，由 Admin SDK 寫入收件人的 inbox 子集合
// ═══════════════════════════════════════════════════════
exports.deliverToInbox = onCall(
  { region: "asia-east1", timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }
    const callerUid = request.auth.uid;
    const { message, targetUid, targetTeamId, targetRoles, targetType } = request.data || {};

    if (!message || !message.id || !message.body) {
      throw new HttpsError("invalid-argument", "message with id and body is required");
    }

    // 強制 fromUid = 呼叫者（防偽造，三方審核修正）
    const safeMessage = { ...message, fromUid: callerUid };

    // 廣播權限檢查：只有 admin/super_admin 可用廣播功能（三方審核修正）
    const isBroadcast = !targetUid && (targetTeamId || (Array.isArray(targetRoles) && targetRoles.length > 0) || targetType === "all");
    if (isBroadcast) {
      const callerDoc = await db.collection("users").doc(callerUid).get();
      const callerRole = callerDoc.exists ? callerDoc.data().role : "user";
      if (!["admin", "super_admin"].includes(callerRole)) {
        // 非 admin 允許發送到自己所屬的俱樂部（團隊幹部通知用）
        if (targetTeamId) {
          const callerData = callerDoc.data() || {};
          const myTeams = [callerData.teamId, ...(callerData.teamIds || [])].filter(Boolean);
          if (!myTeams.includes(targetTeamId)) {
            throw new HttpsError("permission-denied", "You can only broadcast to your own team");
          }
        } else {
          throw new HttpsError("permission-denied", "Only admins can broadcast to roles or all users");
        }
      }
    }

    try {
      const recipientUids = new Set();

      // 1. 點對點
      if (targetUid) {
        recipientUids.add(targetUid);
      }

      // 2. 俱樂部廣播
      if (targetTeamId && !targetUid) {
        const usersSnap = await db.collection("users")
          .where("teamId", "==", targetTeamId).get();
        usersSnap.forEach(doc => recipientUids.add(doc.id));
        // 也查 teamIds array-contains
        const usersSnap2 = await db.collection("users")
          .where("teamIds", "array-contains", targetTeamId).get();
        usersSnap2.forEach(doc => recipientUids.add(doc.id));
      }

      // 3. 角色廣播
      if (Array.isArray(targetRoles) && targetRoles.length > 0 && !targetUid && !targetTeamId) {
        for (const role of targetRoles) {
          const snap = await db.collection("users").where("role", "==", role).get();
          snap.forEach(doc => recipientUids.add(doc.id));
        }
      }

      // 4. 全體廣播
      if (targetType === "all" && !targetUid && !targetTeamId && (!targetRoles || targetRoles.length === 0)) {
        const allSnap = await db.collection("users").get();
        allSnap.forEach(doc => recipientUids.add(doc.id));
      }

      // 如果展開後仍無收件人（targetUid 為空的點對點），直接 return
      if (recipientUids.size === 0) {
        return { success: true, delivered: 0 };
      }

      // 批次寫入，每 450 筆一個 batch
      const uids = [...recipientUids];
      let delivered = 0;
      for (let i = 0; i < uids.length; i += 450) {
        const chunk = uids.slice(i, i + 450);
        const batch = db.batch();
        for (const uid of chunk) {
          const ref = db.collection("users").doc(uid).collection("inbox").doc(safeMessage.id);
          batch.set(ref, {
            id: safeMessage.id,
            title: String(safeMessage.title || "").slice(0, 200),
            body: String(safeMessage.body || "").slice(0, 2000),
            preview: String(safeMessage.preview || "").slice(0, 43),
            type: safeMessage.type || "system",
            typeName: safeMessage.typeName || "系統",
            time: safeMessage.time || "",
            senderName: safeMessage.senderName || "",
            fromUid: safeMessage.fromUid,
            read: false,
            readAt: null,
            actionType: safeMessage.actionType || null,
            actionStatus: safeMessage.actionStatus || null,
            reviewerName: safeMessage.reviewerName || null,
            meta: safeMessage.meta || null,
            ref: `messages/${safeMessage.id}`,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
        delivered += chunk.length;
      }

      return { success: true, delivered };
    } catch (err) {
      console.error("[deliverToInbox]", err);
      throw new HttpsError("internal", "Failed to deliver to inbox");
    }
  }
);

// ═══════════════════════════════════════════════════════
//  syncGroupActionStatus — 跨 inbox 審核狀態同步
//  當幹部核准/拒絕團隊加入或賽事申請後，同步更新同群組其他幹部 inbox
// ═══════════════════════════════════════════════════════
exports.syncGroupActionStatus = onCall(
  { region: "asia-east1", timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }
    const { groupId, newStatus, reviewerName } = request.data || {};

    // 白名單驗證 newStatus（三方審核修正）
    const VALID_STATUSES = ["approved", "rejected", "ignored"];
    if (!groupId || !newStatus) {
      throw new HttpsError("invalid-argument", "groupId and newStatus are required");
    }
    if (!VALID_STATUSES.includes(newStatus)) {
      throw new HttpsError("invalid-argument", `newStatus must be one of: ${VALID_STATUSES.join(", ")}`);
    }

    try {
      // 用 collection group query 查詢所有 inbox 中 meta.groupId 匹配的文件
      const snapshot = await db.collectionGroup("inbox")
        .where("meta.groupId", "==", groupId)
        .where("actionStatus", "==", "pending")
        .get();

      if (snapshot.empty) {
        return { success: true, updated: 0 };
      }

      const batch = db.batch();
      let count = 0;
      snapshot.forEach(doc => {
        batch.update(doc.ref, {
          actionStatus: newStatus,
          reviewerName: reviewerName || "",
        });
        count++;
      });
      await batch.commit();

      return { success: true, updated: count };
    } catch (err) {
      console.error("[syncGroupActionStatus]", err);
      throw new HttpsError("internal", "Failed to sync group action status");
    }
  }
);
