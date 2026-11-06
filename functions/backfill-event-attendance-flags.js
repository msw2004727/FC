"use strict";

// 一次性回填 eventAttendanceFlags（放鴿子 v2 旗標）。預設 dry-run，只讀不寫；加 --apply 才寫入。
// 用法（functions/ 目錄）：node backfill-event-attendance-flags.js [--apply]
// 建議順序：部署 Functions 之前跑（那時旗標觸發器還不存在，不會互搶）；之後用 SOURCE_VERSION 2 全量重排個人統計。
// 本腳本不排個人重算佇列。

const { getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const {
  ATTENDANCE_FLAG_COLLECTION,
  NOSHOW_V2_SINCE,
  computeEventCountedCheckoutFlag,
  isOnOrAfterSince,
  normalizeEventDateKey,
} = require("./noshow-v2-core");

const PROJECT_ID = "fc-football-6c8dc";
const BATCH_SIZE = 400;
const applyChanges = process.argv.includes("--apply");

if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

function text(value) {
  return String(value == null ? "" : value).trim();
}

async function main() {
  const [eventsSnap, flagSnap] = await Promise.all([
    db.collection("events")
      .where("status", "==", "ended")
      .select("id", "status", "date", "creatorUid", "delegateUids")
      .get(),
    db.collection(ATTENDANCE_FLAG_COLLECTION).select("eventId", "hasCountedCheckout").get(),
  ]);
  const currentFlags = new Map(flagSnap.docs.map((doc) => [doc.id, doc.data() || {}]));

  const unparsableDates = [];
  const candidates = [];
  eventsSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const dateKey = normalizeEventDateKey(data.date);
    if (!dateKey) {
      unparsableDates.push({ eventDocId: doc.id, eventId: text(data.id), date: text(data.date).slice(0, 40) });
      return;
    }
    if (isOnOrAfterSince(dateKey, NOSHOW_V2_SINCE)) candidates.push({ ...data, _docId: doc.id });
  });

  const writes = [];
  let flaggedTrue = 0;
  for (const event of candidates) {
    const eventRef = db.collection("events").doc(event._docId);
    const [registrationSnap, checkoutSnap] = await Promise.all([
      eventRef.collection("registrations")
        .where("status", "==", "confirmed")
        .select("userId", "status", "participantType", "companionId")
        .get(),
      eventRef.collection("attendanceRecords")
        .where("type", "==", "checkout")
        .select("uid", "eventId", "type", "status", "participantType", "companionId")
        .get(),
    ]);
    const value = computeEventCountedCheckoutFlag({
      event,
      registrations: registrationSnap.docs.map((doc) => doc.data() || {}),
      attendanceRecords: checkoutSnap.docs.map((doc) => doc.data() || {}),
    });
    if (value) flaggedTrue += 1;
    const publicId = text(event.id) || event._docId;
    const current = currentFlags.get(event._docId);
    const currentValue = current?.hasCountedCheckout === true;
    const idStale = !!current && text(current.eventId) !== publicId;
    if (value !== currentValue || idStale) {
      writes.push({ eventDocId: event._docId, eventId: publicId, from: current ? currentValue : null, to: value });
    }
  }

  console.log(JSON.stringify({
    mode: applyChanges ? "apply" : "dry-run",
    since: NOSHOW_V2_SINCE,
    endedEvents: eventsSnap.size,
    candidates: candidates.length,
    flaggedTrue,
    existingFlagDocs: flagSnap.size,
    plannedWrites: writes.length,
    writes,
    unparsableDates,
  }, null, 2));
  if (!applyChanges || !writes.length) return;

  for (let index = 0; index < writes.length; index += BATCH_SIZE) {
    const batch = db.batch();
    writes.slice(index, index + BATCH_SIZE).forEach((item) => {
      batch.set(db.collection(ATTENDANCE_FLAG_COLLECTION).doc(item.eventDocId), {
        eventId: item.eventId,
        hasCountedCheckout: item.to,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }
  console.log(JSON.stringify({ applied: writes.length }, null, 2));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("[backfill-event-attendance-flags]", text(error?.stack || error));
  process.exit(1);
});
