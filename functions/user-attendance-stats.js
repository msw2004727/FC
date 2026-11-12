"use strict";

const {
  SOURCE_VERSION,
  collectRelevantEventIds,
  computeUserAttendanceStats,
  isCompanion,
  normalizeText,
} = require("./user-attendance-stats-core");
const {
  ATTENDANCE_FLAG_COLLECTION,
  NOSHOW_V2_SINCE,
  computeEventCountedCheckoutFlag,
  isOnOrAfterSince,
  normalizeEventDateKey,
} = require("./noshow-v2-core");
const { maskUid } = require("./notification-fields");

const REGION = "asia-east1";
const SUMMARY_COLLECTION = "userAttendanceStats";
const QUEUE_COLLECTION = "userAttendanceStatsQueue";
const EVENT_ID_QUERY_CHUNK = 30;
const WRITE_BATCH_SIZE = 400;
// O4（顧問 §3.117）：retry: true 的觸發器失敗會被重送最長 7 天，遇到必定失敗的資料會一路重算。
// 事件發生超過此年齡就記 log 放棄，由 reconcileUserAttendanceStatsWeekly 每週把相關 uid 全部重新入隊補算。
// 只套用在週對帳補得到的觸發器（三支入隊觸發器與佇列重算）；旗標觸發器不套，週對帳不重算 eventAttendanceFlags。
const MAX_RETRY_EVENT_AGE_MS = 2 * 60 * 60 * 1000;

function safeUid(value) {
  const uid = normalizeText(value);
  return uid && uid.length <= 128 && !uid.includes("/") ? uid : "";
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function mapSubcollectionDocs(snapshot) {
  return (snapshot?.docs || [])
    .filter((doc) => doc.ref.parent.parent !== null)
    .map((doc) => ({ ...doc.data(), _docId: doc.id }));
}

async function loadEventsByPublicIds(db, eventIds) {
  const ids = [...new Set(eventIds)].filter(Boolean);
  if (!ids.length) return [];
  const snapshots = await Promise.all(chunks(ids, EVENT_ID_QUERY_CHUNK).map((group) => (
    db.collection("events")
      .where("id", "in", group)
      .select("id", "status", "date")
      .get()
  )));
  return snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => ({
    ...doc.data(),
    _docId: doc.id,
  })));
}

// v2 旗標：只讀「已結束且開始日 ≥ 起算點」的活動，依 public id 分塊 in 查詢；沒有旗標文件＝false。
async function loadAttendanceFlags(db, events, since = NOSHOW_V2_SINCE) {
  const candidates = (events || []).filter((event) => (
    normalizeText(event?.status) === "ended"
    && isOnOrAfterSince(normalizeEventDateKey(event?.date), since)
    && normalizeText(event?._docId)
  ));
  const flags = new Map();
  if (!candidates.length) return flags;
  const docIds = new Set(candidates.map((event) => normalizeText(event._docId)));
  const publicIds = [...new Set(candidates.map((event) => normalizeText(event.id || event._docId)))];
  const snapshots = await Promise.all(chunks(publicIds, EVENT_ID_QUERY_CHUNK).map((group) => (
    db.collection(ATTENDANCE_FLAG_COLLECTION)
      .where("eventId", "in", group)
      .select("eventId", "hasCountedCheckout")
      .get()
  )));
  snapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => {
    if (docIds.has(doc.id)) flags.set(doc.id, doc.data()?.hasCountedCheckout === true);
  }));
  return flags;
}

async function loadUserAttendanceStatsInput({ db, uid }) {
  const targetUid = safeUid(uid);
  if (!targetUid) throw new Error("invalid attendance stats uid");
  const [registrationSnap, activitySnap, attendanceSnap] = await Promise.all([
    db.collectionGroup("registrations")
      .where("userId", "==", targetUid)
      .select("userId", "eventId", "status", "participantType", "companionId", "promotedAt")
      .get(),
    db.collectionGroup("activityRecords")
      .where("uid", "==", targetUid)
      .select("uid", "eventId", "status", "participantType", "companionId")
      .get(),
    db.collectionGroup("attendanceRecords")
      .where("uid", "==", targetUid)
      .select("uid", "eventId", "type", "status", "participantType", "companionId")
      .get(),
  ]);
  const registrations = mapSubcollectionDocs(registrationSnap);
  const activityRecords = mapSubcollectionDocs(activitySnap);
  const attendanceRecords = mapSubcollectionDocs(attendanceSnap);
  const eventIds = collectRelevantEventIds({
    uid: targetUid,
    registrations,
    activityRecords,
  });
  const events = await loadEventsByPublicIds(db, [...eventIds]);
  const attendanceFlags = await loadAttendanceFlags(db, events);
  return { uid: targetUid, events, registrations, activityRecords, attendanceRecords, attendanceFlags };
}

function buildSummaryPayload(uid, result, updatedAt) {
  return {
    uid,
    sourceVersion: SOURCE_VERSION,
    expectedCount: result.expectedCount,
    attendedCount: result.attendedCount,
    completedCount: result.completedCount,
    attendRate: result.attendRate,
    participatedCount: result.participatedCount,
    countedCount: result.countedCount,
    countedCompletedCount: result.countedCompletedCount,
    countedIncompleteCount: result.countedIncompleteCount,
    countedNoShowCount: result.countedNoShowCount,
    countedSince: result.countedSince,
    updatedAt,
  };
}

async function calculateUserAttendanceSummary({ db, Timestamp, uid }) {
  const input = await loadUserAttendanceStatsInput({ db, uid });
  const result = computeUserAttendanceStats(input);
  return buildSummaryPayload(input.uid, result, Timestamp.now());
}

async function rebuildUserAttendanceSummary({ db, Timestamp, uid }) {
  const payload = await calculateUserAttendanceSummary({ db, Timestamp, uid });
  await db.collection(SUMMARY_COLLECTION).doc(payload.uid).set(payload);
  return payload;
}

async function enqueueUserAttendanceStats({ db, FieldValue, uids, reason }) {
  const targets = [...new Set((uids || []).map(safeUid).filter(Boolean))];
  for (const group of chunks(targets, WRITE_BATCH_SIZE)) {
    const batch = db.batch();
    group.forEach((uid) => {
      batch.set(db.collection(QUEUE_COLLECTION).doc(uid), {
        generation: FieldValue.increment(1),
        lastReason: normalizeText(reason).slice(0, 80) || "source_write",
        requestedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
  }
  return targets.length;
}

function eventAgeMs(event, nowMs = Date.now()) {
  const eventMs = Date.parse(normalizeText(event?.time));
  return Number.isFinite(eventMs) ? Math.max(0, nowMs - eventMs) : 0;
}

// 事件過舊就記 log 並回 true（呼叫端直接結束、不丟錯，觸發器便不再重試）；路徑參數一律遮罩。
function dropStaleRetryEvent(fnName, event, nowMs = Date.now()) {
  const ageMs = eventAgeMs(event, nowMs);
  if (ageMs <= MAX_RETRY_EVENT_AGE_MS) return false;
  const params = {};
  Object.entries(event?.params || {}).forEach(([key, value]) => {
    params[key] = maskUid(normalizeText(value));
  });
  console.warn(`[${fnName}] stale event dropped without retry; weekly reconcile will recompute`, {
    params,
    ageMinutes: Math.round(ageMs / 60000),
    maxAgeMinutes: MAX_RETRY_EVENT_AGE_MS / 60000,
  });
  return true;
}

function changedRecordUids(event, uidField) {
  const uids = new Set();
  [event?.data?.before, event?.data?.after].forEach((snapshot) => {
    if (!snapshot?.exists) return;
    const data = snapshot.data() || {};
    const uid = safeUid(data[uidField]);
    if (uid) uids.add(uid);
  });
  return [...uids];
}

async function eventParticipantUids(event) {
  const before = event?.data?.before;
  const after = event?.data?.after;
  const snapshot = after?.exists ? after : before;
  return participantUidsForEventRef(snapshot?.ref);
}

async function participantUidsForEventRef(eventRef) {
  if (!eventRef) return [];
  const [registrationSnap, activitySnap] = await Promise.all([
    eventRef.collection("registrations")
      .select("userId", "participantType", "companionId")
      .get(),
    eventRef.collection("activityRecords")
      .select("uid", "participantType", "companionId")
      .get(),
  ]);
  const uids = new Set();
  registrationSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (!isCompanion(data)) uids.add(safeUid(data.userId));
  });
  activitySnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (!isCompanion(data)) uids.add(safeUid(data.uid));
  });
  uids.delete("");
  return [...uids];
}

function eventStatsStateChanged(event) {
  const before = event?.data?.before?.exists ? event.data.before.data() || {} : {};
  const after = event?.data?.after?.exists ? event.data.after.data() || {} : {};
  const beforeStatus = normalizeText(before.status);
  const afterStatus = normalizeText(after.status);
  const idChanged = normalizeText(before.id) !== normalizeText(after.id);
  const touchesTerminalState = beforeStatus === "ended" || afterStatus === "ended";
  return idChanged || (beforeStatus !== afterStatus && touchesTerminalState);
}

function hostKey(data) {
  const delegates = (Array.isArray(data?.delegateUids) ? data.delegateUids : [])
    .map(normalizeText).filter(Boolean).sort();
  return `${normalizeText(data?.creatorUid)}|${delegates.join(",")}`;
}

function warnUnparsableEventDate(fnName, eventDocId) {
  console.warn(`[${fnName}] unparsable event date; treated as not counted`, {
    eventDocId: maskUid(normalizeText(eventDocId)),
  });
}

function flagSkipReason(data, since, eventDocId) {
  if (normalizeText(data?.status) !== "ended") return "not_ended";
  const dateKey = normalizeEventDateKey(data?.date);
  if (!dateKey) {
    warnUnparsableEventDate("recomputeEventAttendanceFlag", eventDocId);
    return "unparsable_date";
  }
  if (!isOnOrAfterSince(dateKey, since)) return "before_since";
  return "";
}

/**
 * 整場重算旗標 eventAttendanceFlags/{eventDocId}.hasCountedCheckout，只在值翻轉（或 eventId 對不上）時寫入。
 * 只算「已結束且開始日 ≥ 起算點」的活動；其他活動不讀子集合、不寫旗標（使用端本來就要求 ended＋日期）。
 * 活動主檔、旗標文件與子集合查詢都在同一個 transaction 內讀，結論只以 transaction 內的最新活動內容為準
 * （重試時會重讀）；eventData（觸發器 payload）與 transaction 外的讀取只用來快速篩掉不必算的活動。
 * （Grok 第一輪審查：原本在 transaction 外讀活動主檔，重試或寫入亂序時可能用舊的 status／date／主辦委託人寫出錯誤旗標。）
 * @returns {Promise<{ skipped?: string, flipped: boolean, value: boolean }>}
 */
async function recomputeEventAttendanceFlag({ db, FieldValue, eventDocId, eventData, since = NOSHOW_V2_SINCE }) {
  const docId = safeUid(eventDocId);
  if (!docId) return { skipped: "invalid_event", flipped: false, value: false };
  const eventRef = db.collection("events").doc(docId);
  let hint = eventData;
  if (!hint) {
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) return { skipped: "missing_event", flipped: false, value: false };
    hint = eventSnap.data() || {};
  }
  const hintSkip = flagSkipReason(hint, since, docId);
  if (hintSkip) return { skipped: hintSkip, flipped: false, value: false };
  const flagRef = db.collection(ATTENDANCE_FLAG_COLLECTION).doc(docId);
  return db.runTransaction(async (transaction) => {
    const [eventSnap, flagSnap] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(flagRef),
    ]);
    if (!eventSnap.exists) return { skipped: "missing_event", flipped: false, value: false };
    const data = eventSnap.data() || {};
    const skipped = flagSkipReason(data, since, docId);
    if (skipped) return { skipped, flipped: false, value: false };
    const event = { ...data, _docId: docId };
    const publicId = normalizeText(data.id) || docId;
    const [registrationSnap, checkoutSnap] = await Promise.all([
      transaction.get(eventRef.collection("registrations")
        .where("status", "==", "confirmed")
        .select("userId", "status", "participantType", "companionId")),
      transaction.get(eventRef.collection("attendanceRecords")
        .where("type", "==", "checkout")
        .select("uid", "eventId", "type", "status", "participantType", "companionId")),
    ]);
    const current = flagSnap.exists ? flagSnap.data() || {} : null;
    const currentValue = current?.hasCountedCheckout === true;
    const value = computeEventCountedCheckoutFlag({
      event,
      registrations: registrationSnap.docs.map((doc) => doc.data() || {}),
      attendanceRecords: checkoutSnap.docs.map((doc) => doc.data() || {}),
    });
    const flipped = value !== currentValue;
    const idStale = !!current && normalizeText(current.eventId) !== publicId;
    if (flipped || idStale) {
      transaction.set(flagRef, {
        eventId: publicId,
        hasCountedCheckout: value,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return { flipped, value };
  });
}

function recordTouchesCheckout(event) {
  return [event?.data?.before, event?.data?.after].some((snapshot) => (
    snapshot?.exists && normalizeText((snapshot.data() || {}).type) === "checkout"
  ));
}

// 活動文件寫入時的旗標維護：結束狀態／id／主辦委託人／日期變動才動作，其餘寫入不讀資料庫。
// 回傳 true 表示計入狀態可能改變，要把全場參加者排進重算。
async function syncAttendanceFlagOnEventWrite({ db, FieldValue, event, stateChanged }) {
  const after = event?.data?.after;
  if (!after?.exists) return false;
  const before = event?.data?.before?.exists ? event.data.before.data() || {} : {};
  const afterData = after.data() || {};
  const hostsChanged = hostKey(before) !== hostKey(afterData);
  const dateChanged = normalizeText(before.date) !== normalizeText(afterData.date);
  if (!stateChanged && !hostsChanged && !dateChanged) return false;
  if (normalizeText(afterData.status) !== "ended") return false;
  const eventDocId = safeUid(event.params?.eventId || after.id || after.ref?.id);
  if (!eventDocId) return false;
  const afterDateKey = normalizeEventDateKey(afterData.date);
  if (!afterDateKey) warnUnparsableEventDate("syncAttendanceFlagOnEventWrite", eventDocId);
  if (isOnOrAfterSince(afterDateKey)) {
    const outcome = await recomputeEventAttendanceFlag({ db, FieldValue, eventDocId, eventData: afterData });
    return outcome.flipped || (dateChanged && outcome.value);
  }
  // 日期移到起算點之前：旗標原本為 true 的場次會從計入變成不計入。
  if (!dateChanged || !isOnOrAfterSince(normalizeEventDateKey(before.date))) return false;
  const flagSnap = await db.collection(ATTENDANCE_FLAG_COLLECTION).doc(eventDocId).get();
  return !!flagSnap.exists && flagSnap.data()?.hasCountedCheckout === true;
}

function createUserAttendanceStatsExports({
  db,
  FieldValue,
  Timestamp,
  onDocumentWritten,
  onSchedule,
}) {
  const sourceOptions = {
    region: REGION,
    timeoutSeconds: 60,
    // 2026-11-04 hotfix：128MiB 在冷啟動載入大型 index.js 時 OOM（instance could not start），改 256MiB，與 onUserAttendanceEventWrite 一致。
    memory: "256MiB",
    cpu: "gcf_gen1",
    retry: true,
  };
  const enqueueChanged = (fnName, uidField, reason) => async (event) => {
    if (dropStaleRetryEvent(fnName, event)) return 0;
    return enqueueUserAttendanceStats({
      db,
      FieldValue,
      uids: changedRecordUids(event, uidField),
      reason,
    });
  };

  return {
    onUserAttendanceRegistrationWrite: onDocumentWritten(
      { ...sourceOptions, document: "events/{eventId}/registrations/{recordId}" },
      enqueueChanged("onUserAttendanceRegistrationWrite", "userId", "registration_write"),
    ),
    onUserAttendanceRecordWrite: onDocumentWritten(
      { ...sourceOptions, document: "events/{eventId}/attendanceRecords/{recordId}" },
      enqueueChanged("onUserAttendanceRecordWrite", "uid", "attendance_write"),
    ),
    onUserAttendanceActivityWrite: onDocumentWritten(
      { ...sourceOptions, document: "events/{eventId}/activityRecords/{recordId}" },
      enqueueChanged("onUserAttendanceActivityWrite", "uid", "activity_write"),
    ),
    onUserAttendanceEventWrite: onDocumentWritten(
      { ...sourceOptions, document: "events/{eventId}", memory: "256MiB" },
      async (event) => {
        // 刪除活動（before 存在、after 不存在）依賴此觸發器排入統計重算；改動此處或 event-deletion.js 的刪除主文件處，要確認另一處。
        const stateChanged = eventStatsStateChanged(event);
        // v2 旗標先算完再排重算，個人重算才讀得到新旗標。
        // 旗標失敗不得擋住舊欄位入隊：記錄錯誤、照常入隊，最後重拋讓觸發器重試（重複入隊只會多重算一次）。
        let flagChanged = false;
        let flagError = null;
        try {
          flagChanged = await syncAttendanceFlagOnEventWrite({ db, FieldValue, event, stateChanged });
        } catch (error) {
          flagError = error;
          console.error("[onUserAttendanceEventWrite] attendance flag sync failed", {
            eventDocId: maskUid(normalizeText(event?.params?.eventId)),
            stateChanged,
            error: normalizeText(error?.message || error).slice(0, 300),
          });
        }
        let queued = 0;
        if (stateChanged || flagChanged) {
          queued = await enqueueUserAttendanceStats({
            db,
            FieldValue,
            uids: await eventParticipantUids(event),
            reason: stateChanged ? "event_terminal_state" : "attendance_flag_event",
          });
        }
        if (flagError) throw flagError;
        return queued;
      },
    ),
    // v2：簽退新增／修改／刪除時整場重算旗標；值翻轉才把全場非同行者參加者排進重算。
    onEventAttendanceFlagWrite: onDocumentWritten(
      { ...sourceOptions, document: "events/{eventId}/attendanceRecords/{recordId}" },
      async (event) => {
        if (!recordTouchesCheckout(event)) return 0;
        const eventDocId = safeUid(event.params?.eventId);
        if (!eventDocId) return 0;
        const outcome = await recomputeEventAttendanceFlag({ db, FieldValue, eventDocId });
        if (!outcome.flipped) return 0;
        return enqueueUserAttendanceStats({
          db,
          FieldValue,
          uids: await participantUidsForEventRef(db.collection("events").doc(eventDocId)),
          reason: "attendance_flag_flip",
        });
      },
    ),
    rebuildUserAttendanceStatsFromQueue: onDocumentWritten(
      {
        region: REGION,
        document: `${QUEUE_COLLECTION}/{uid}`,
        timeoutSeconds: 120,
        memory: "256MiB",
        retry: true,
        maxInstances: 20,
      },
      async (event) => {
        if (!event?.data?.after?.exists) return;
        if (dropStaleRetryEvent("rebuildUserAttendanceStatsFromQueue", event)) return;
        const uid = safeUid(event.params?.uid);
        const generation = Number(event.data.after.data()?.generation || 0);
        if (!uid || !generation) return;
        const queueRef = db.collection(QUEUE_COLLECTION).doc(uid);
        // O4：一次報名同時寫 registration 與 activityRecord，佇列連被寫兩次；計算前先看佇列是否已是較新世代或已處理完，
        // 是就交給較新的那次事件算。條件與下方交易的丟棄條件相同，只是提早到讀整份歷史之前。
        const currentSnap = await queueRef.get();
        if (!currentSnap.exists || Number(currentSnap.data()?.generation || 0) !== generation) return;
        const payload = await calculateUserAttendanceSummary({ db, Timestamp, uid });
        await db.runTransaction(async (transaction) => {
          const queueSnap = await transaction.get(queueRef);
          if (!queueSnap.exists || Number(queueSnap.data()?.generation || 0) !== generation) return;
          transaction.set(db.collection(SUMMARY_COLLECTION).doc(uid), payload);
          transaction.delete(queueRef);
        });
      },
    ),
    reconcileUserAttendanceStatsWeekly: onSchedule(
      {
        region: REGION,
        schedule: "20 4 * * 0",
        timeZone: "Asia/Taipei",
        timeoutSeconds: 180,
        memory: "256MiB",
        maxInstances: 1,
      },
      async () => {
        const [summarySnap, registrationSnap, activitySnap] = await Promise.all([
          db.collection(SUMMARY_COLLECTION).select("uid").get(),
          db.collectionGroup("registrations")
            .where("status", "==", "confirmed")
            .select("userId", "participantType", "companionId")
            .get(),
          db.collectionGroup("activityRecords")
            .select("uid", "participantType", "companionId")
            .get(),
        ]);
        const uids = new Set(summarySnap.docs.map((doc) => safeUid(doc.id)));
        mapSubcollectionDocs(registrationSnap).forEach((record) => {
          if (!isCompanion(record)) uids.add(safeUid(record.userId));
        });
        mapSubcollectionDocs(activitySnap).forEach((record) => {
          if (!isCompanion(record)) uids.add(safeUid(record.uid));
        });
        uids.delete("");
        const queued = await enqueueUserAttendanceStats({
          db,
          FieldValue,
          uids: [...uids],
          reason: "weekly_reconcile",
        });
        console.log("[reconcileUserAttendanceStatsWeekly]", { queued });
      },
    ),
  };
}

module.exports = {
  ATTENDANCE_FLAG_COLLECTION,
  MAX_RETRY_EVENT_AGE_MS,
  QUEUE_COLLECTION,
  SUMMARY_COLLECTION,
  calculateUserAttendanceSummary,
  createUserAttendanceStatsExports,
  enqueueUserAttendanceStats,
  loadAttendanceFlags,
  loadUserAttendanceStatsInput,
  participantUidsForEventRef,
  rebuildUserAttendanceSummary,
  recomputeEventAttendanceFlag,
  safeUid,
};
