"use strict";

/**
 * 站內信文件形狀。對齊 functions/index.js 的 _writeToUserInbox（欄位鍵與順序、截斷、預設值）：
 * deleteTeam 仍是同 batch 直寫，不改走別的投遞路徑，所以把文件組裝抽成純函式，避免兩處慢慢分叉。
 * 本卡不要開始呼叫 _writeToUserInbox，也不要改它。
 *
 * 本檔是純函式：不接收 db、不呼叫計數器、不寫計數集合。
 * origin 僅在呼叫端傳入非空字串時原樣抄進文件（接在既有欄位之後）；本函式不填 origin，也不依它跳過節流。
 */

function buildInboxMessageDoc(msg, { createdAt } = {}) {
  // id 缺省時與 _writeToUserInbox 相同；deleteTeam 一律自帶 id，不會走到這裡。
  const docId = msg.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const doc = {
    id: docId,
    title: String(msg.title || "").slice(0, 200),
    body: String(msg.body || "").slice(0, 2000),
    preview: String(msg.preview || msg.body || "").slice(0, 43),
    type: msg.type || "system",
    typeName: msg.typeName || "系統",
    time: msg.time || "",
    senderName: msg.senderName || "系統",
    fromUid: msg.fromUid || null,
    read: false,
    readAt: null,
    actionType: msg.actionType || null,
    actionStatus: msg.actionStatus || null,
    reviewerName: msg.reviewerName || null,
    meta: msg.meta || null,
    ref: `messages/${docId}`,
    createdAt,
  };
  if (typeof msg.origin === "string" && msg.origin !== "") doc.origin = msg.origin;
  return doc;
}

module.exports = { buildInboxMessageDoc };
