"use strict";

const {
  SOURCE_VERSION,
  collectRelevantEventIds,
  computeUserAttendanceStats,
  isCompanion,
  normalizeText,
} = require("./user-attendance-stats-core");

const REGION = "asia-east1";
const SUMMARY_COLLECTION = "userAttendanceStats";
const QUEUE_COLLECTION = "userAttendanceStatsQueue";
const EVENT_ID_QUERY_CHUNK = 30;
const WRITE_BATCH_SIZE = 400;

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
      .select("id", "status")
      .get()
  )));
  return snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => ({
    ...doc.data(),
    _docId: doc.id,
  })));
}

async function loadUserAttendanceStatsInput({ db, uid }) {
  const targetUid = safeUid(uid);
  if (!targetUid) throw new Error("invalid attendance stats uid");
  const [registrationSnap, activitySnap, attendanceSnap] = await Promise.all([
    db.collectionGroup("registrations")
      .where("userId", "==", targetUid)
      .select("userId", "eventId", "status", "participantType", "companionId")
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
  return { uid: targetUid, events, registrations, activityRecords, attendanceRecords };
}

function buildSummaryPayload(uid, result, updatedAt) {
  return {
    uid,
    sourceVersion: SOURCE_VERSION,
    expectedCount: result.expectedCount,
    attendedCount: result.attendedCount,
    completedCount: result.completedCount,
    attendRate: result.attendRate,
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
  if (!snapshot?.ref) return [];
  const [registrationSnap, activitySnap] = await Promise.all([
    snapshot.ref.collection("registrations")
      .select("userId", "participantType", "companionId")
      .get(),
    snapshot.ref.collection("activityRecords")
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
    memory: "128MiB",
    cpu: "gcf_gen1",
    retry: true,
  };
  const enqueueChanged = (uidField, reason) => async (event) => (
    enqueueUserAttendanceStats({
      db,
      FieldValue,
      uids: changedRecordUids(event, uidField),
      reason,
    })
  );

  return {
    onUserAttendanceRegistrationWrite: onDocumentWritten(
      { ...sourceOptions, document: "events/{eventId}/registrations/{recordId}" },
      enqueueChanged("userId", "registration_write"),
    ),
    onUserAttendanceRecordWrite: onDocumentWritten(
      { ...sourceOptions, document: "events/{eventId}/attendanceRecords/{recordId}" },
      enqueueChanged("uid", "attendance_write"),
    ),
    onUserAttendanceActivityWrite: onDocumentWritten(
      { ...sourceOptions, document: "events/{eventId}/activityRecords/{recordId}" },
      enqueueChanged("uid", "activity_write"),
    ),
    onUserAttendanceEventWrite: onDocumentWritten(
      { ...sourceOptions, document: "events/{eventId}", memory: "256MiB" },
      async (event) => {
        if (!eventStatsStateChanged(event)) return 0;
        return enqueueUserAttendanceStats({
          db,
          FieldValue,
          uids: await eventParticipantUids(event),
          reason: "event_terminal_state",
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
        const uid = safeUid(event.params?.uid);
        const generation = Number(event.data.after.data()?.generation || 0);
        if (!uid || !generation) return;
        const payload = await calculateUserAttendanceSummary({ db, Timestamp, uid });
        const queueRef = db.collection(QUEUE_COLLECTION).doc(uid);
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
  QUEUE_COLLECTION,
  SUMMARY_COLLECTION,
  calculateUserAttendanceSummary,
  createUserAttendanceStatsExports,
  enqueueUserAttendanceStats,
  loadUserAttendanceStatsInput,
  rebuildUserAttendanceSummary,
  safeUid,
};
