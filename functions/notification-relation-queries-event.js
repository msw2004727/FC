"use strict";

/**
 * 通知發送授權強化（第 2 批）：R1 活動關係查詢。
 * 每個函式 async (ctx) => boolean；讀取失敗直接丟出，由決策層轉 deny。
 */

const { str, memoByCtx, recipientIdentities } = require("./notification-relation-queries-shared");

// 報名比對欄位：userId → uid → courseOwnerUids（單欄查詢，不需複合索引）。
const REGISTRATION_LOOKUPS = Object.freeze([
  Object.freeze({ field: "userId", op: "==" }),
  Object.freeze({ field: "uid", op: "==" }),
  Object.freeze({ field: "courseOwnerUids", op: "array-contains" }),
]);

function createEventQueries({ db, helpers, readAccess }) {
  // 活動讀法同 getEventDocByPublicId（由 index.js 注入）；同一次決策只讀一次。
  const loadEvent = memoByCtx(async (ctx) => {
    const eventId = str(ctx?.keys?.eventId);
    if (!eventId) return null;
    const snap = await helpers.getEventDocByPublicId(eventId);
    if (!snap || snap.exists === false || typeof snap.data !== "function") return null;
    const data = snap.data();
    if (!data || typeof data !== "object") return null;
    return { docId: snap.id, data };
  });

  return {
    // creatorUid／ownerUid／captainUid、delegateUids（只有 delegates[].uid 不算），
    // 或 Rules 對齊的 event.edit_all（私人活動再套 canOperatePrivateEventForAccess）。
    async callerMayManageEvent(ctx) {
      const caller = str(ctx?.callerUid);
      if (!caller) return false;
      const event = await loadEvent(ctx);
      if (!event) return false;
      const data = event.data;
      if ([data.creatorUid, data.ownerUid, data.captainUid].some((value) => str(value) === caller)) return true;
      if (helpers.isEventDelegateForUid(data, caller) === true) return true;
      const access = await readAccess(ctx);
      if (!access.hasPermission("event.edit_all")) return false;
      return helpers.canOperatePrivateEventForAccess(access, data, caller) === true;
    },

    // events/{docId}/registrations 內有 confirmed／waitlisted（isActiveRegistration）的報名。
    async recipientHasActiveRegistration(ctx) {
      const identities = recipientIdentities(ctx);
      if (identities.length === 0) return false;
      const event = await loadEvent(ctx);
      if (!event) return false;
      const registrations = db.collection("events").doc(event.docId).collection("registrations");
      for (const { field, op } of REGISTRATION_LOOKUPS) {
        for (const identity of identities) {
          const snap = await registrations.where(field, op, identity).get();
          const docs = Array.isArray(snap?.docs) ? snap.docs : [];
          if (docs.some((doc) => helpers.isActiveRegistration(doc.data() || {}) === true)) return true;
        }
      }
      return false;
    },
  };
}

module.exports = { createEventQueries };
