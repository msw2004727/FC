"use strict";

const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const {
  SOURCE_VERSION,
  computeUserAttendanceStats,
  isCompanion,
  normalizeText,
} = require("./user-attendance-stats-core");
const { SUMMARY_COLLECTION, safeUid } = require("./user-attendance-stats");

const PROJECT_ID = "fc-football-6c8dc";
const BATCH_SIZE = 400;
const applyChanges = process.argv.includes("--apply");

if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

function isSubcollectionDoc(doc) {
  return doc.ref.parent.parent !== null;
}

function mapDocs(snapshot) {
  return snapshot.docs
    .filter(isSubcollectionDoc)
    .map((doc) => ({ ...doc.data(), _docId: doc.id }));
}

function addByUid(map, uid, record) {
  const safe = safeUid(uid);
  if (!safe) return;
  if (!map.has(safe)) map.set(safe, []);
  map.get(safe).push(record);
}

function sameSummary(current, next) {
  return Number(current?.sourceVersion || 0) === SOURCE_VERSION
    && Number(current?.expectedCount || 0) === next.expectedCount
    && Number(current?.attendedCount || 0) === next.attendedCount
    && Number(current?.completedCount || 0) === next.completedCount
    && Number(current?.attendRate || 0) === next.attendRate;
}

async function loadInputs() {
  const [eventsSnap, registrationsSnap, activitySnap, attendanceSnap, summarySnap] = await Promise.all([
    db.collection("events").select("id", "status").get(),
    db.collectionGroup("registrations")
      .select("userId", "eventId", "status", "participantType", "companionId")
      .get(),
    db.collectionGroup("activityRecords")
      .select("uid", "eventId", "status", "participantType", "companionId")
      .get(),
    db.collectionGroup("attendanceRecords")
      .select("uid", "eventId", "type", "status", "participantType", "companionId")
      .get(),
    db.collection(SUMMARY_COLLECTION).get(),
  ]);
  return {
    events: eventsSnap.docs.map((doc) => ({ ...doc.data(), _docId: doc.id })),
    registrations: mapDocs(registrationsSnap),
    activityRecords: mapDocs(activitySnap),
    attendanceRecords: mapDocs(attendanceSnap),
    currentSummaries: new Map(summarySnap.docs.map((doc) => [doc.id, doc.data() || {}])),
  };
}

function buildSummaries(input) {
  const registrationsByUid = new Map();
  const activityByUid = new Map();
  const attendanceByUid = new Map();
  const uids = new Set(input.currentSummaries.keys());

  input.registrations.forEach((record) => {
    if (isCompanion(record)) return;
    const uid = safeUid(record.userId);
    if (uid) uids.add(uid);
    addByUid(registrationsByUid, uid, record);
  });
  input.activityRecords.forEach((record) => {
    if (isCompanion(record)) return;
    const uid = safeUid(record.uid);
    if (uid) uids.add(uid);
    addByUid(activityByUid, uid, record);
  });
  input.attendanceRecords.forEach((record) => {
    if (isCompanion(record)) return;
    const uid = safeUid(record.uid);
    if (uid) uids.add(uid);
    addByUid(attendanceByUid, uid, record);
  });

  const updatedAt = Timestamp.now();
  const summaries = [];
  [...uids].sort().forEach((uid) => {
    const result = computeUserAttendanceStats({
      uid,
      events: input.events,
      registrations: registrationsByUid.get(uid) || [],
      activityRecords: activityByUid.get(uid) || [],
      attendanceRecords: attendanceByUid.get(uid) || [],
    });
    summaries.push({
      uid,
      sourceVersion: SOURCE_VERSION,
      expectedCount: result.expectedCount,
      attendedCount: result.attendedCount,
      completedCount: result.completedCount,
      attendRate: result.attendRate,
      updatedAt,
    });
  });
  return summaries;
}

function aggregate(summaries) {
  return summaries.reduce((total, item) => ({
    users: total.users + 1,
    expectedCount: total.expectedCount + item.expectedCount,
    attendedCount: total.attendedCount + item.attendedCount,
    completedCount: total.completedCount + item.completedCount,
  }), { users: 0, expectedCount: 0, attendedCount: 0, completedCount: 0 });
}

async function writeSummaries(summaries) {
  for (let index = 0; index < summaries.length; index += BATCH_SIZE) {
    const batch = db.batch();
    summaries.slice(index, index + BATCH_SIZE).forEach((summary) => {
      batch.set(db.collection(SUMMARY_COLLECTION).doc(summary.uid), summary);
    });
    await batch.commit();
  }
}

async function main() {
  const input = await loadInputs();
  const allSummaries = buildSummaries(input);
  const changed = allSummaries.filter((summary) => (
    !sameSummary(input.currentSummaries.get(summary.uid), summary)
  ));
  const report = {
    mode: applyChanges ? "apply" : "dry-run",
    source: {
      events: input.events.length,
      registrations: input.registrations.length,
      activityRecords: input.activityRecords.length,
      attendanceRecords: input.attendanceRecords.length,
      existingSummaries: input.currentSummaries.size,
    },
    calculated: aggregate(allSummaries),
    changedUsers: changed.length,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!applyChanges) return;
  await writeSummaries(changed);
  const verifySnap = await db.collection(SUMMARY_COLLECTION).get();
  const verified = verifySnap.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
  const verification = aggregate(verified);
  if (verification.users !== allSummaries.length
    || verification.expectedCount !== report.calculated.expectedCount
    || verification.attendedCount !== report.calculated.attendedCount
    || verification.completedCount !== report.calculated.completedCount) {
    throw new Error(`attendance stats verification failed: ${JSON.stringify(verification)}`);
  }
  console.log(JSON.stringify({ verified: true, ...verification }, null, 2));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("[backfill-user-attendance-stats]", normalizeText(error?.stack || error));
  process.exit(1);
});
