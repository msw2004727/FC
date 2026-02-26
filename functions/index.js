const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
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

function normalizeRole(role) {
  if (typeof role !== "string") return "user";
  return VALID_ROLES.has(role) ? role : "user";
}

function getAuthErrorCode(err) {
  return err?.errorInfo?.code || err?.code || "";
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

async function getUserRoleFromFirestore(uidOrDocId) {
  const found = await findUserDocByUidOrLineUserId(uidOrDocId);
  if (!found) return "user";
  return normalizeRole(found.data?.role);
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

exports.syncUserRole = onCall(
  { region: "asia-east1", timeoutSeconds: 15 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    let callerRole = normalizeRole(request.auth.token?.role);
    if (!["admin", "super_admin"].includes(callerRole)) {
      callerRole = await getUserRoleFromFirestore(request.auth.uid);
    }
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
    const { uid, title, body, status } = data;

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
            text: `【${title}】\n${body}`,
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

      // 推播失敗 → 自動解綁用戶的 LINE 推播
      try {
        const userDoc = db.collection("users").doc(uid);
        const userSnap = await userDoc.get();
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
