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

const LINE_CHANNEL_ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");

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

    const customToken = await getAuth().createCustomToken(lineUserId);
    console.log("[createCustomToken] 成功為 LINE 用戶簽發 Custom Token:", lineUserId);
    return { customToken };
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
