const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { messagingApi } = require("@line/bot-sdk");
const https = require("https");

initializeApp();
const db = getFirestore();
const authAdmin = getAuth();

const LINE_CHANNEL_ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");
const VALID_ROLES = new Set([
  "user",
  "coach",
  "captain",
  "venue_owner",
  "admin",
  "super_admin",
]);
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
    body: "嗨 {userName}，歡迎加入 SportHub 平台！\n\n您可以在這裡瀏覽並報名各類足球活動、加入球隊、參與聯賽。\n祝您使用愉快！",
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
]);
const SHARE_SITE_ORIGIN = "https://toosterx.com";
const DEFAULT_TEAM_SHARE_OG_IMAGE = "https://firebasestorage.googleapis.com/v0/b/fc-football-6c8dc.firebasestorage.app/o/images%2Ftest%2FS__174522375.jpg?alt=media&token=73eb0e3f-a94a-4368-a6df-d4afafaa4ea0";

function normalizeRole(role) {
  if (typeof role !== "string") return "user";
  return VALID_ROLES.has(role) ? role : "user";
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

async function getUserRoleFromFirestore(uidOrDocId) {
  const found = await findUserDocByUidOrLineUserId(uidOrDocId);
  if (!found) return "user";
  return normalizeRole(found.data?.role);
}

async function getCallerRoleWithFallback(request) {
  let callerRole = normalizeRole(request.auth?.token?.role);
  if (!["admin", "super_admin"].includes(callerRole) && request.auth?.uid) {
    callerRole = await getUserRoleFromFirestore(request.auth.uid);
  }
  return callerRole;
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
  { region: "asia-east1", timeoutSeconds: 15 },
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
    const actorName = normalizeAuditText(
      callerUser?.data?.displayName
        || callerUser?.data?.name
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

    const callerRole = await getCallerRoleWithFallback(request);
    if (!["admin", "super_admin"].includes(callerRole)) {
      throw new HttpsError("permission-denied", "Admin only");
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
      callerRole,
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

    const client = new messagingApi.MessagingApiClient({
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
    const teamLabel = hasTeam ? `「${teamName}」球隊` : "球隊";
    const ogTitle = hasTeam
      ? `加入「${teamName}」球隊｜TooSterx Hub`
      : "TooSterx Hub 球隊邀請";
    const ogDescription = `這是在TooSterx Hub上創立的${teamLabel}，誠摯邀請您加入球隊，跟我們一起享受活動~`;
    const ogImage = sanitizeImageUrl(
      team?.image || team?.coverImage || team?.cover || team?.banner || team?.logo
    );
    const redirectUrl = (teamId && team)
      ? `${SHARE_SITE_ORIGIN}/?team=${encodedTeamId}`
      : `${SHARE_SITE_ORIGIN}/`;
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
