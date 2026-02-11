const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { messagingApi } = require("@line/bot-sdk");

initializeApp();
const db = getFirestore();

const LINE_CHANNEL_ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");

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
