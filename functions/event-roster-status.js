"use strict";

const { createPlanRosterStatus, requireFunctions } = require("./event-roster-status-plan");

// 沿用取消報名的交易外 create；已領取的 requestId 即使主交易失敗仍保留至 TTL 清除。
function createRosterRequestClaim({ db, FieldValue, Timestamp, now, logger }) {
  requireFunctions(db, ["collection"]);
  requireFunctions(FieldValue, ["serverTimestamp"]);
  requireFunctions(Timestamp, ["fromDate"]);
  requireFunctions({ now }, ["now"]);
  requireFunctions(logger, ["warn"]);
  return async ({ requestId, callerUid, fn }) => {
    // 未提供 requestId 就只靠狀態前置條件，不建立沒有去重作用的文件。
    if (!requestId) return true;
    const dedupRef = db.collection("_regDedupe").doc(requestId);
    requireFunctions(dedupRef, ["create"]);
    try {
      await dedupRef.create({
        callerUid,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromDate(new Date(now() + 10 * 60 * 1000)),
      });
      return true;
    } catch (error) {
      if (error?.code === 6 || error?.code === "already-exists") return false;
      // 對齊 cancelRegistration：去重儲存失敗仍執行主交易，不記原始錯誤內容。
      logger.warn({ fn, errorCode: "DEDUPE_CREATE_FAILED" });
      return true;
    }
  };
}

function createRosterStatusHandler(action, dependencies) {
  const planner = createPlanRosterStatus(dependencies);
  requireFunctions(dependencies, [
    "getCallerAccessContext", "canOperateEventSiteForAccess", "canRemoveConfirmedParticipantForAccess",
    "getEventDocByPublicIdInTransaction", "sanitizeStr", "claimRequestId", "maskId",
    "writeInboxNotification", "writeAuditEntryInternal", "settleBestEffortPostCommitOps",
  ]);
  const {
    db, HttpsError, FieldValue, logger, getCallerAccessContext, canOperateEventSiteForAccess,
    canRemoveConfirmedParticipantForAccess, getEventDocByPublicIdInTransaction, sanitizeStr,
    claimRequestId, maskId, writeInboxNotification, writeAuditEntryInternal, settleBestEffortPostCommitOps,
  } = dependencies;
  requireFunctions(db, ["runTransaction"]);
  requireFunctions(FieldValue, ["serverTimestamp"]);
  requireFunctions(logger, ["info", "warn", "error"]);
  const demote = action === "demote";
  const fn = demote ? "forceDemoteToWaitlist" : "forcePromoteWaitlist";
  const internalCode = demote ? "FORCE_DEMOTE_FAILED" : "FORCE_PROMOTE_FAILED";

  return async function rosterStatusHandler(request) {
    let eventId = "";
    try {
      const callerUid = request?.auth?.uid;
      if (!callerUid) throw new HttpsError("unauthenticated", "Authentication required", { code: "UNAUTHENTICATED" });
      const data = request.data || {};
      // 長度先驗再 sanitize，避免截斷後意外指向另一個實體或去重鍵。
      const validId = (value, limit) => typeof value === "string" && value.length <= limit
        && !!value.trim() && !/[\/\u0000-\u001f]/.test(value) && ![".", ".."].includes(value.trim());
      if (!validId(data.eventId, 120) || !validId(data.userId, 128)
        || (data.registrationId !== undefined && !validId(data.registrationId, 120))
        || (data.requestId !== undefined && !validId(data.requestId, 100))
        || (!demote && data.allowOverCapacity !== undefined && typeof data.allowOverCapacity !== "boolean")) {
        throw new HttpsError("invalid-argument", "eventId and userId are required", { code: "INVALID_ARGUMENT" });
      }
      eventId = sanitizeStr(data.eventId, 120);
      const userId = sanitizeStr(data.userId, 128);
      const registrationId = sanitizeStr(data.registrationId, 120);
      const requestId = sanitizeStr(data.requestId, 100);
      if (!await claimRequestId({ requestId, callerUid, fn })) {
        logger.info({ fn, eventId: maskId(eventId), errorCode: "DEDUPLICATED", count: 0 });
        return { success: true, deduplicated: true };
      }
      const access = await getCallerAccessContext(request);
      const result = await db.runTransaction(async (transaction) => {
        const eventDoc = await getEventDocByPublicIdInTransaction(transaction, eventId);
        if (!eventDoc || !eventDoc.exists) throw new HttpsError("not-found", "EVENT_NOT_FOUND", { code: "EVENT_NOT_FOUND" });
        const eventRef = eventDoc.ref;
        const eventData = eventDoc.data();
        const canAct = demote ? canRemoveConfirmedParticipantForAccess : canOperateEventSiteForAccess;
        if (!canAct(access, eventData, callerUid)) throw new HttpsError("permission-denied", "PERMISSION_DENIED", { code: "PERMISSION_DENIED" });

        // 只讀活動子集合；所有讀取與權限重驗都在任何寫入之前。
        const regsSnap = await transaction.get(eventRef.collection("registrations"));
        const arsSnap = await transaction.get(eventRef.collection("activityRecords"));
        const plan = planner({
          action, eventData, userId, registrationId,
          registrations: regsSnap.docs.map((doc) => ({ ...doc.data(), _docId: doc.id })),
          activityRecords: arsSnap.docs.map((doc) => ({ ...doc.data(), _docId: doc.id })),
        });
        if (plan.overCapacity) {
          if (data.allowOverCapacity !== true) throw new HttpsError("failed-precondition", "CAPACITY_EXCEEDED", { code: "CAPACITY_EXCEEDED" });
          if (!canRemoveConfirmedParticipantForAccess(access, eventData, callerUid)) {
            throw new HttpsError("permission-denied", "PERMISSION_DENIED", { code: "PERMISSION_DENIED" });
          }
        }
        for (const update of plan.registrationUpdates) {
          transaction.update(eventRef.collection("registrations").doc(update.docId), {
            status: update.status,
            [demote ? "demotedAt" : "promotedAt"]: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        for (const update of plan.activityRecordUpdates) {
          transaction.update(eventRef.collection("activityRecords").doc(update.docId), { status: update.status });
        }
        transaction.update(eventRef, plan.eventUpdate);
        return {
          count: plan.registrationUpdates.length, event: plan.occupancy, overCapacity: plan.overCapacity,
          recipientUid: plan.recipientUid, registrationId: plan.registrationId,
          title: eventData.title || "", date: eventData.date || "", location: eventData.location || "",
        };
      });

      // 對齊 A 模板；同組同行者只通知主報名者一次。
      const details = `活動名稱：${result.title}\n活動時間：${result.date}\n活動地點：${result.location}`;
      const body = demote
        ? `因活動名額調整，您目前已改為候補狀態。\n\n${details}\n\n若後續有名額釋出，系統會再通知您。`
        : `恭喜！由於有人取消報名，您已從候補名單自動遞補為正式參加者。\n\n${details}\n\n請準時出席！`;
      // 包住同步與非同步失敗；交給既有 settle helper 前先去除原始錯誤中的個資。
      // 僅能處理外拋錯誤；既有通知／稽核 helper 內部吞錯與原始 log 無法在這層攔截。
      const postOp = async (operation) => {
        try { return await operation(); } catch (_error) {
          throw new HttpsError("internal", "ROSTER_POST_COMMIT_FAILED", { code: "ROSTER_POST_COMMIT_FAILED" });
        }
      };
      const postOps = [
        postOp(() => writeInboxNotification({
          recipientUid: result.recipientUid, title: demote ? "候補降級通知" : "候補遞補通知",
          body, category: "activity", categoryLabel: "活動",
        })),
        postOp(() => writeAuditEntryInternal({
          action: demote ? "event_waitlist_demote" : "event_waitlist_promote",
          targetType: "event", targetId: eventId, targetLabel: result.title,
          result: "success", source: "cloud_function",
          meta: { registrationId: result.registrationId }, actorUid: callerUid,
        })),
      ];
      try {
        const settled = await settleBestEffortPostCommitOps(fn, postOps);
        if (settled.failureCount) logger.error({
          fn, eventId: maskId(eventId), errorCode: "POST_COMMIT_FAILED", count: settled.failureCount,
        });
      } catch (_error) {
        // 即使 settle 本身失敗也須收齊 promises，不能把已提交的名單回報為失敗。
        const outcomes = await Promise.allSettled(postOps);
        logger.error({
          fn, eventId: maskId(eventId), errorCode: "POST_COMMIT_FAILED",
          count: outcomes.filter((outcome) => outcome.status === "rejected").length,
        });
      }
      logger.info({ fn, eventId: maskId(eventId), errorCode: "OK", count: result.count });
      return {
        success: true, [demote ? "demoted" : "promoted"]: result.count,
        current: result.event.current, waitlist: result.event.waitlist, status: result.event.status,
        ...(!demote ? { overCapacity: result.overCapacity } : {}),
        event: result.event,
      };
    } catch (error) {
      const knownCodes = ["unauthenticated", "invalid-argument", "not-found", "permission-denied", "failed-precondition"];
      const expected = error instanceof HttpsError && knownCodes.includes(error.code);
      const errorCode = expected ? error.code : internalCode;
      // 預期中的拒絕（權限不足、狀態不符等）記 warn；其餘為內部錯誤，記去敏後的錯誤碼。
      if (expected) logger.warn({ fn, eventId: maskId(eventId), errorCode });
      else logger.error({ fn, eventId: maskId(eventId), errorCode, cause: String(error?.code ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "unknown" });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", internalCode, { code: internalCode });
    }
  };
}

function createForceDemoteHandler(dependencies) {
  return createRosterStatusHandler("demote", dependencies);
}

function createForcePromoteHandler(dependencies) {
  return createRosterStatusHandler("promote", dependencies);
}

function createForceDemoteCallable({ onCall, ...dependencies }) {
  requireFunctions({ onCall }, ["onCall"]);
  return onCall({ region: "asia-east1", timeoutSeconds: 30 }, createForceDemoteHandler(dependencies));
}

function createForcePromoteCallable({ onCall, ...dependencies }) {
  requireFunctions({ onCall }, ["onCall"]);
  return onCall({ region: "asia-east1", timeoutSeconds: 30 }, createForcePromoteHandler(dependencies));
}

module.exports = {
  createRosterRequestClaim, createForceDemoteHandler, createForcePromoteHandler,
  createForceDemoteCallable, createForcePromoteCallable,
};
