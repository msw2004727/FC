"use strict";

/**
 * confirmEventAttendance — 活動現場出席確認（伺服器端移植自 event-manage-confirm.js#_confirmAllAttendance + batchWriteAttendance）
 *
 * 【desired 參數 JSON 形狀說明】
 * 舊站 A 從 DOM 讀取 `manual-checkin-${p.uid}`、`manual-checkout-${p.uid}`、`manual-note-${p.uid}`，
 * 轉換為明確的 JSON 結構傳入伺服器，支援兩種等價輸入格式：
 *
 * 1) 物件 Map（推薦，直接對應 A 的 `desiredStateByUid`）：
 *    desired: {
 *      [personUid: string]: {
 *        checkin: boolean,
 *        checkout?: boolean,
 *        note?: string, // 會自動 trim 並截斷至 20 字元
 *      }
 *    }
 *
 * 2) 陣列格式：
 *    desired: Array<{
 *      uid: string,          // 本人為 userId (LINE UID)；同行者為 companionId 或 `${userId}_${companionName}`
 *      checkin: boolean,
 *      checkout?: boolean,
 *      note?: string,
 *    }>
 *
 * 注意：如同 A 的 `_normalizeAttendanceSelection`，若 `checkin === false`，則 `checkout` 會強制正規化為 `false`。
 *
 * 【刻意偏離舊站 A 的項目（R-STAT-003 / R-ID-002）】
 * - 舊站 A 在 `participantsWithUid` 長度不符時，會 fallback 掃描 `e.participants` 並透過 `_userByName`
 *   以顯示名稱（displayName / name）反查 UID。
 * - 伺服器版 **不移植以名稱比對使用者的分支**，只使用 `confirmed` 報名紀錄（`userId` / `companionId`）
 *   與有效的 `eventData.participantsWithUid`（必須含真 `uid`）。無 UID 之純名稱項目一律略過。
 */

function isCompanionPseudoUid(value) {
  return String(value || "").trim().startsWith("comp_");
}

function formatDefaultTimeStr(date = new Date()) {
  // ASSUMPTION: 對齊 App._formatDateTime 預設的 YYYY/MM/DD HH:mm 格式（台灣時區 UTC+8）
  const tw = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const yyyy = tw.getUTCFullYear();
  const mm = String(tw.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(tw.getUTCDate()).padStart(2, "0");
  const hh = String(tw.getUTCHours()).padStart(2, "0");
  const min = String(tw.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

function normalizeAttendanceSelection(raw = {}) {
  // 照 A event-manage-attendance.js#_normalizeAttendanceSelection：勾簽退即視為已簽到（不是丟掉簽退）。
  const checkout = Boolean(raw?.checkout);
  const checkin = Boolean(raw?.checkin) || checkout;
  const note = String(raw?.note || "").trim().slice(0, 20);
  return { checkin, checkout, note };
}

function normalizeDesiredMap(desired) {
  const map = Object.create(null);
  if (!desired || typeof desired !== "object") return map;

  if (Array.isArray(desired)) {
    for (const item of desired) {
      if (!item || typeof item !== "object") continue;
      const uid = String(item.uid || "").trim();
      if (!uid) continue;
      map[uid] = normalizeAttendanceSelection(item);
    }
    return map;
  }

  for (const [key, val] of Object.entries(desired)) {
    const uid = String(key || "").trim();
    if (!uid || !val || typeof val !== "object") continue;
    map[uid] = normalizeAttendanceSelection(val);
  }
  return map;
}

/**
 * 照舊站 A 建立參加者清單（排除 _userByName 名稱反查分支，R-STAT-003 / R-ID-002）
 */
function buildPeopleList({ eventData = {}, registrations = [] } = {}) {
  const allRegs = Array.isArray(registrations) ? registrations : [];
  const confirmedRegs = allRegs.filter((r) => r && r.status === "confirmed");
  const people = [];
  const addedNames = new Set();
  const addedUids = new Set();

  if (confirmedRegs.length > 0) {
    const groups = new Map();
    confirmedRegs.forEach((r) => {
      if (!r.userId) return;
      if (!groups.has(r.userId)) groups.set(r.userId, []);
      groups.get(r.userId).push(r);
    });

    groups.forEach((regs) => {
      const selfReg = regs.find((r) => r.participantType === "self");
      const companions = regs.filter((r) => r.participantType === "companion");
      const mainUid = regs[0].userId;

      if (selfReg) {
        const mainName = selfReg.userName;
        people.push({ name: mainName, uid: mainUid, isCompanion: false });
        if (mainName) addedNames.add(mainName);
        if (mainUid) addedUids.add(String(mainUid));
      }

      companions.forEach((c) => {
        const cName = c.companionName || c.userName;
        const cUid = c.companionId || `${mainUid}_${c.companionName}`;
        people.push({
          name: cName,
          uid: cUid,
          ownerUid: mainUid,
          isCompanion: true,
        });
        if (cName) addedNames.add(cName);
        if (cUid) addedUids.add(String(cUid));
      });
    });
  }

  // Phase 3 路徑：只讀 participantsWithUid（含真 UID）；刻意不移植 _userByName 名稱反查（R-STAT-003 / R-ID-002）
  const wu = Array.isArray(eventData?.participantsWithUid)
    ? eventData.participantsWithUid
    : [];
  const wuValid = wu.length > 0 && wu.length === Number(eventData?.current || 0);
  if (wuValid) {
    wu.forEach((entry) => {
      if (!entry || !entry.uid || !entry.name) return;
      const uidStr = String(entry.uid).trim();
      if (!uidStr || addedUids.has(uidStr) || addedNames.has(entry.name)) return;
      const isComp = Boolean(entry.isCompanion) || isCompanionPseudoUid(uidStr);
      people.push({ name: entry.name, uid: uidStr, isCompanion: isComp });
      addedNames.add(entry.name);
      addedUids.add(uidStr);
    });
  }

  return people;
}

function findCompanionRegistrationForAttendance(person, allActiveRegs) {
  const safeUid = String(person?.uid || "").trim();
  const safeName = String(person?.name || "").trim();
  const ownerUid = String(person?.ownerUid || person?.userId || "").trim();
  const companionRegs = (Array.isArray(allActiveRegs) ? allActiveRegs : []).filter(
    (r) =>
      r
      && r.status !== "cancelled"
      && r.status !== "removed"
      && (r.participantType === "companion" || r.companionId)
  );

  const byId = companionRegs.find((r) => String(r.companionId || "").trim() === safeUid);
  if (byId) return byId;

  const scopedRegs = ownerUid
    ? companionRegs.filter((r) => String(r.userId || "").trim() === ownerUid)
    : companionRegs;

  const byDerivedUid = scopedRegs.find((r) => {
    const regOwnerUid = String(r.userId || "").trim();
    const regName = String(r.companionName || r.userName || "").trim();
    return regOwnerUid && regName && `${regOwnerUid}_${regName}` === safeUid;
  });
  if (byDerivedUid) return byDerivedUid;

  // 刻意不透過純名稱猜測跨報名者的同行者（僅在明確限定 ownerUid 且唯一時輔助定位）
  if (isCompanionPseudoUid(safeUid) || !safeName || !ownerUid) return null;
  const nameMatches = scopedRegs.filter(
    (r) => String(r.companionName || r.userName || "").trim() === safeName
  );
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

function buildBaseRecord(person, allActiveRegs, eventId) {
  const safeUid = String(person?.uid || "").trim();
  const safeName = String(person?.name || "").trim();
  const mustBeCompanion = Boolean(person?.isCompanion) || isCompanionPseudoUid(safeUid);

  if (mustBeCompanion) {
    const cReg = findCompanionRegistrationForAttendance(person, allActiveRegs);
    if (!cReg || !cReg.userId || isCompanionPseudoUid(cReg.userId)) {
      return { ok: false, reason: "companion_registration_missing" };
    }
    return {
      ok: true,
      record: {
        eventId,
        uid: cReg.userId,
        userName: cReg.userName,
        participantType: "companion",
        companionId: cReg.companionId || safeUid,
        companionName: cReg.companionName || safeName,
      },
    };
  }

  if (!safeUid || isCompanionPseudoUid(safeUid)) {
    return { ok: false, reason: "invalid_self_uid" };
  }

  return {
    ok: true,
    record: {
      eventId,
      uid: safeUid,
      userName: safeName,
      participantType: "self",
      companionId: null,
      companionName: null,
    },
  };
}

/**
 * 比對出席紀錄是否屬於特定參加者（嚴格以 UID / companionId 比對，不做名稱 fallback：R-STAT-003 / R-ID-002）
 */
function matchAttendanceRecord(record, person) {
  if (!record || !person) return false;
  if (record.status === "removed" || record.status === "cancelled") return false;
  const personUid = String(person.uid || "").trim();
  if (!personUid) return false;

  if (person.isCompanion || isCompanionPseudoUid(personUid)) {
    const recCompId = String(record.companionId || "").trim();
    if (recCompId) return recCompId === personUid;
    if (record.participantType === "companion" && record.uid && record.companionName) {
      return `${record.uid}_${record.companionName}` === personUid;
    }
    return false;
  }

  if (record.participantType === "companion" || record.companionId) {
    return false;
  }
  return String(record.uid || "").trim() === personUid;
}

function getLatestAttendanceRecord(currentRecords, person, type) {
  const matches = (Array.isArray(currentRecords) ? currentRecords : []).filter(
    (r) => matchAttendanceRecord(r, person) && r.type === type
  );
  if (matches.length === 0) return null;
  return matches[matches.length - 1];
}

function collectAttendanceOps(
  person,
  wanted,
  currentRecords,
  eventId,
  timeStr,
  baseRecord,
  idCounter,
  randomSuffixFn
) {
  const adds = [];
  const removes = [];
  let grantExp = false;

  const activeRecords = (Array.isArray(currentRecords) ? currentRecords : []).filter(
    (r) => r && r.status !== "removed" && r.status !== "cancelled"
  );

  const hasCheckin = activeRecords.some(
    (r) => matchAttendanceRecord(r, person) && r.type === "checkin"
  );
  const hasCheckout = activeRecords.some(
    (r) => matchAttendanceRecord(r, person) && r.type === "checkout"
  );
  const existingNote = getLatestAttendanceRecord(activeRecords, person, "note");
  const existingNoteText = String(existingNote?.note || "").trim();

  if (
    wanted.checkin === hasCheckin
    && wanted.checkout === hasCheckout
    && wanted.note === existingNoteText
  ) {
    return { adds, removes, grantExp };
  }

  if (isCompanionPseudoUid(baseRecord?.uid)) {
    return {
      adds,
      removes,
      grantExp,
      blocked: true,
      reason: "companion_pseudo_uid_as_attendance_uid",
    };
  }

  // 取消簽退
  if (!wanted.checkout && hasCheckout) {
    const rec = getLatestAttendanceRecord(activeRecords, person, "checkout");
    if (rec) removes.push(rec);
  }
  // 取消簽到（連帶取消簽退）
  if (!wanted.checkin && hasCheckin) {
    const recOut = getLatestAttendanceRecord(activeRecords, person, "checkout");
    if (recOut && !removes.some((r) => (r.id && r.id === recOut.id) || (r._docId && r._docId === recOut._docId))) {
      removes.push(recOut);
    }
    const recIn = getLatestAttendanceRecord(activeRecords, person, "checkin");
    if (recIn) removes.push(recIn);
  }
  // 新增簽到
  if (wanted.checkin && !hasCheckin) {
    const suffix = randomSuffixFn();
    adds.push({
      ...baseRecord,
      id: `att_${idCounter.v++}_${suffix}`,
      type: "checkin",
      time: timeStr,
    });
  }
  // 新增簽退
  if (wanted.checkout && !hasCheckout) {
    const suffix = randomSuffixFn();
    adds.push({
      ...baseRecord,
      id: `att_${idCounter.v++}_${suffix}`,
      type: "checkout",
      time: timeStr,
    });
    if (wanted.checkin && baseRecord.uid) grantExp = true;
  }
  // 備註變更
  if (wanted.note !== existingNoteText) {
    adds.push({
      ...baseRecord,
      id: `att_note_${idCounter.v++}`,
      type: "note",
      time: timeStr,
      note: wanted.note,
    });
  }

  return { adds, removes, grantExp };
}

/**
 * 純函式：規劃出席確認的新增與軟刪除操作
 */
function planAttendanceConfirm({
  eventData = {},
  registrations = [],
  currentRecords = [],
  desired = {},
  timeStr = formatDefaultTimeStr(),
  nowMs = Date.now(),
  randomSuffixFn = () => Math.random().toString(36).slice(2, 6),
} = {}) {
  const eventId = String(eventData?.id || "").trim();
  const allActiveRegs = (Array.isArray(registrations) ? registrations : []).filter(
    (r) => r && r.status !== "cancelled" && r.status !== "removed"
  );
  const activeCurrentRecords = (Array.isArray(currentRecords) ? currentRecords : []).filter(
    (r) => r && r.status !== "removed" && r.status !== "cancelled"
  );

  const people = buildPeopleList({ eventData, registrations: allActiveRegs });
  const desiredStateByUid = normalizeDesiredMap(desired);

  const adds = [];
  const removes = [];
  const expTargets = [];
  const skipped = [];
  const idCounter = { v: Number.isFinite(nowMs) ? nowMs : Date.now() };

  for (const p of people) {
    const pUidKey = String(p.uid);
    if (!(pUidKey in desiredStateByUid)) continue;
    const wanted = desiredStateByUid[pUidKey];

    const resolved = buildBaseRecord(p, allActiveRegs, eventId);
    if (!resolved.ok) {
      skipped.push({ uid: p.uid, name: p.name, reason: resolved.reason });
      continue;
    }

    const baseRecord = resolved.record;
    const person = { uid: p.uid, name: p.name, isCompanion: p.isCompanion };
    const ops = collectAttendanceOps(
      person,
      wanted,
      activeCurrentRecords,
      eventId,
      timeStr,
      baseRecord,
      idCounter,
      randomSuffixFn
    );

    if (ops.blocked) {
      skipped.push({ uid: p.uid, name: p.name, reason: ops.reason });
      continue;
    }

    adds.push(...ops.adds);
    removes.push(...ops.removes);
    if (ops.grantExp) expTargets.push(baseRecord.uid);
  }

  return {
    people,
    adds,
    removes,
    expTargets,
    skipped,
  };
}

async function defaultGetEventDocByPublicIdInTransaction(transaction, db, eventId) {
  const query = db.collection("events").where("id", "==", eventId).limit(1);
  const snap = await transaction.get(query);
  if (snap && Array.isArray(snap.docs) && snap.docs.length > 0) {
    return snap.docs[0];
  }
  return null;
}

function stripDocId(record) {
  const copy = { ...record };
  delete copy._docId;
  return copy;
}

function createConfirmEventAttendanceHandler({
  HttpsError,
  db,
  FieldValue,
  getCallerAccessContext,
  canOperateEventSiteForAccess,
  getEventDocByPublicIdInTransaction,
  formatTimeStr = formatDefaultTimeStr,
  logger = console,
}) {
  if (typeof HttpsError !== "function") {
    throw new TypeError("HttpsError is required");
  }
  if (!db || typeof db.runTransaction !== "function") {
    throw new TypeError("db with runTransaction is required");
  }
  if (typeof getCallerAccessContext !== "function") {
    throw new TypeError("getCallerAccessContext helper is required");
  }
  if (typeof canOperateEventSiteForAccess !== "function") {
    throw new TypeError("canOperateEventSiteForAccess helper is required");
  }

  return async (request) => {
    if (!request?.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const callerUid = request.auth.uid;
    const { eventId, desired } = request.data || {};

    if (typeof eventId !== "string" || !eventId.trim()) {
      throw new HttpsError("invalid-argument", "eventId is required");
    }
    const safeEventId = eventId.trim();

    if (!desired || typeof desired !== "object") {
      throw new HttpsError("invalid-argument", "desired attendance state is required");
    }

    const callerAccess = await getCallerAccessContext(request);

    try {
      const txResult = await db.runTransaction(async (transaction) => {
        // T1: 解析活動 public id -> docRef（R-ID-009 / R-ID-010）
        const eventDoc = typeof getEventDocByPublicIdInTransaction === "function"
          ? await getEventDocByPublicIdInTransaction(transaction, safeEventId)
          : await defaultGetEventDocByPublicIdInTransaction(transaction, db, safeEventId);

        if (!eventDoc || (typeof eventDoc.exists === "boolean" && !eventDoc.exists)) {
          throw new HttpsError("not-found", "EVENT_NOT_FOUND");
        }

        const eventRef = eventDoc.ref;
        const ed = { ...(eventDoc.data() || {}), id: safeEventId };

        // 權限檢查：現場操作權限（canOperateEventSiteForAccess）
        if (!canOperateEventSiteForAccess(callerAccess, ed, callerUid)) {
          throw new HttpsError("permission-denied", "PERMISSION_DENIED");
        }

        // T2: 讀取子集合 registrations & attendanceRecords（R-REG-014：只讀 events/{docId}/* 子集合）
        const regsSnap = await transaction.get(eventRef.collection("registrations"));
        const allRegs = (regsSnap?.docs || []).map((d) => ({
          ...(d.data() || {}),
          _docId: d.id,
        }));

        const attSnap = await transaction.get(eventRef.collection("attendanceRecords"));
        const currentRecords = (attSnap?.docs || []).map((d) => ({
          ...(d.data() || {}),
          _docId: d.id,
        }));

        // T3: 規劃變更
        const plan = planAttendanceConfirm({
          eventData: ed,
          registrations: allRegs,
          currentRecords,
          desired,
          timeStr: formatTimeStr(new Date()),
        });

        const attColRef = eventRef.collection("attendanceRecords");

        // T4: 寫入新增紀錄（只寫 events/{docId}/attendanceRecords，形狀對齊 batchWriteAttendance）
        let addedCount = 0;
        for (const record of plan.adds) {
          const newDocRef = attColRef.doc();
          const payload = {
            ...stripDocId(record),
            eventId: safeEventId,
            status: record.status || "active",
          };
          if (FieldValue && typeof FieldValue.serverTimestamp === "function") {
            payload.createdAt = FieldValue.serverTimestamp();
          }
          transaction.set(newDocRef, payload);
          addedCount += 1;
        }

        // T5: 軟刪除紀錄（status='removed', removedAt, removedByUid）
        const removedDocIds = new Set();
        let removedCount = 0;
        for (const record of plan.removes) {
          const targetDocId = record._docId
            || currentRecords.find((r) => r.id && r.id === record.id)?._docId;
          if (!targetDocId || removedDocIds.has(targetDocId)) continue;
          removedDocIds.add(targetDocId);

          const removeUpdates = {
            status: "removed",
            removedByUid: callerUid,
          };
          if (FieldValue && typeof FieldValue.serverTimestamp === "function") {
            removeUpdates.removedAt = FieldValue.serverTimestamp();
          }
          transaction.update(attColRef.doc(targetDocId), removeUpdates);
          removedCount += 1;
        }

        return {
          added: addedCount,
          removed: removedCount,
        };
      });

      return {
        success: true,
        added: txResult.added,
        removed: txResult.removed,
      };
    } catch (err) {
      if (err instanceof HttpsError) {
        throw err;
      }
      logger.error(JSON.stringify({
        fn: "confirmEventAttendance",
        eventId: safeEventId,
        errorCode: err?.code || "unknown",
        message: err?.message || "Transaction failed",
      }));
      throw new HttpsError("internal", "ATTENDANCE_CONFIRM_FAILED");
    }
  };
}

function createConfirmEventAttendanceCallable({ onCall, ...dependencies }) {
  return onCall(
    { region: "asia-east1", timeoutSeconds: 30 },
    createConfirmEventAttendanceHandler(dependencies)
  );
}

module.exports = {
  isCompanionPseudoUid,
  normalizeAttendanceSelection,
  buildPeopleList,
  findCompanionRegistrationForAttendance,
  buildBaseRecord,
  matchAttendanceRecord,
  collectAttendanceOps,
  planAttendanceConfirm,
  createConfirmEventAttendanceHandler,
  createConfirmEventAttendanceCallable,
};
