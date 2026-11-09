"use strict";

// 營運儀表板排程的 Firestore 讀寫。計算在 ops-rollup-core.js。
// 失敗直接拋出，不寫 opsSummary，讓 generatedAt 停在上一份成功的彙總。

const {
  SUMMARY_LOOKBACK_DAYS,
  activeSnapshotSubtractingQa,
  applyPreservedUserSnapshot,
  buildCost,
  buildDayDocs,
  buildOpsSummaries,
  buildStuckAttention,
  countUnparsableEvents,
  dateKeyToDocId,
  docIdToDateKey,
  eventDateQueryBounds,
  isQaUid,
  reconcileDateKeys,
  reconcileMismatch,
  recomputeDateKeys,
  resolveAsOf,
  resolveTodayKey,
  selectUpcomingLowFill,
  summarizeUserDirectory,
  taipeiStartMs,
} = require("./ops-rollup-core");
const { normalizeEventDateKey } = require("./noshow-v2-core");
const { addDaysKey } = require("./ops-ltv-report");

const SCHEDULE_BASE = Object.freeze({
  region: "asia-east1",
  timeZone: "Asia/Taipei",
  memory: "512MiB",
  timeoutSeconds: 300,
  maxInstances: 1,
  retryCount: 0,
});
const CHILD_CONCURRENCY = 8;
const QA_ID_START = `U${"0".repeat(28)}0000`;
const QA_ID_END = `U${"0".repeat(28)}9999`;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function emptyCounter() {
  return {
    total: 0,
    events: 0,
    registrations: 0,
    attendance: 0,
    flags: 0,
    users: 0,
    counts: 0,
    existing: 0,
    dailyStats: 0,
    usage: 0,
  };
}

function addReads(counter, kind, count) {
  const safe = Number(count) || 0;
  counter[kind] = (counter[kind] || 0) + safe;
  counter.total += safe;
}

function asEvent(doc) {
  const data = doc.data() || {};
  return { ...data, _docId: doc.id, id: text(data.id) || doc.id };
}

function childDocsInIdOrder(docs) {
  return docs
    .slice()
    .sort((a, b) => text(a.id).localeCompare(text(b.id)))
    .map((doc) => doc.data() || {});
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function loadEventsForDateKeys(db, dateKeys, counter) {
  const keys = new Set(dateKeys.filter(Boolean));
  const sorted = [...keys].sort();
  const found = new Map();
  if (!sorted.length) return [];
  const bounds = eventDateQueryBounds(sorted[0], sorted[sorted.length - 1]);
  for (const bound of bounds) {
    const snap = await db.collection("events")
      .where("date", ">=", bound.start)
      .where("date", "<", bound.endExclusive)
      .get();
    addReads(counter, "events", snap.size || 0);
    snap.docs.forEach((doc) => {
      const event = asEvent(doc);
      const dateKey = normalizeEventDateKey(event.date);
      if (keys.has(dateKey)) found.set(doc.id, event);
    });
  }
  return [...found.values()];
}

async function loadEventChildren(db, events, counter) {
  const registrationsByDocId = {};
  const attendanceByDocId = {};
  await mapPool(events, CHILD_CONCURRENCY, async (event) => {
    const ref = db.collection("events").doc(event._docId);
    const [regSnap, attendanceSnap] = await Promise.all([
      ref.collection("registrations").get(),
      ref.collection("attendanceRecords").get(),
    ]);
    addReads(counter, "registrations", regSnap.size || 0);
    addReads(counter, "attendance", attendanceSnap.size || 0);
    registrationsByDocId[event._docId] = childDocsInIdOrder(regSnap.docs);
    attendanceByDocId[event._docId] = childDocsInIdOrder(attendanceSnap.docs);
  });
  return { registrationsByDocId, attendanceByDocId };
}

async function loadFlagMap(db, eventIds, counter) {
  const flagsByDocId = {};
  await mapPool(eventIds, CHILD_CONCURRENCY, async (eventId) => {
    const snap = await db.collection("eventAttendanceFlags").doc(eventId).get();
    addReads(counter, "flags", 1);
    flagsByDocId[eventId] = !!(snap.exists && snap.data()?.hasCountedCheckout === true);
  });
  return flagsByDocId;
}

async function loadExistingDailies(db, dateKeys, counter) {
  const existing = {};
  await mapPool(dateKeys, CHILD_CONCURRENCY, async (dateKey) => {
    const snap = await db.collection("opsDailyStats").doc(dateKeyToDocId(dateKey)).get();
    addReads(counter, "existing", 1);
    if (snap.exists) existing[dateKey] = snap.data() || {};
  });
  return existing;
}

async function loadExistingParticipants(db, dateKeys, counter) {
  const existing = {};
  await mapPool(dateKeys, CHILD_CONCURRENCY, async (dateKey) => {
    const snap = await db.collection("opsParticipantDays").doc(dateKeyToDocId(dateKey)).get();
    addReads(counter, "existing", 1);
    if (snap.exists) existing[dateKey] = snap.data() || {};
  });
  return existing;
}

function stampComputed(doc, Timestamp, nowMs) {
  const next = { ...doc };
  delete next.computedAtMs;
  delete next.generatedAtMs;
  if (Object.prototype.hasOwnProperty.call(doc, "computedAtMs")) {
    next.computedAt = Timestamp.fromMillis(nowMs);
  }
  if (Object.prototype.hasOwnProperty.call(doc, "generatedAtMs")) {
    next.generatedAt = Timestamp.fromMillis(nowMs);
  }
  return next;
}

async function loadOpenEvents(db, counter) {
  const snap = await db.collection("events").where("status", "in", ["open", "full", "upcoming"]).get();
  addReads(counter, "events", snap.size || 0);
  return snap.docs.map(asEvent);
}

async function loadQaUsers(db, FieldPath, counter) {
  const snap = await db.collection("users")
    .where(FieldPath.documentId(), ">=", QA_ID_START)
    .where(FieldPath.documentId(), "<=", QA_ID_END)
    .get();
  addReads(counter, "users", snap.size || 0);
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((user) => isQaUid(user.id) || isQaUid(user.uid));
}

async function loadSnapshotCounts(db, Timestamp, asOf, counter) {
  const asOfEnd = taipeiStartMs(addDaysKey(asOf, 1));
  const windows = {
    d7: taipeiStartMs(addDaysKey(asOf, -6)),
    d30: taipeiStartMs(addDaysKey(asOf, -29)),
    d90: taipeiStartMs(addDaysKey(asOf, -89)),
    d365: taipeiStartMs(addDaysKey(asOf, -364)),
  };
  const totalSnap = await db.collection("users").count().get();
  addReads(counter, "counts", 1);
  const raw = { total: totalSnap.data().count };
  const keys = Object.keys(windows);
  for (const key of keys) {
    const snap = await db.collection("users")
      .where("lastLogin", ">=", Timestamp.fromMillis(windows[key]))
      .where("lastLogin", "<", Timestamp.fromMillis(asOfEnd))
      .count()
      .get();
    addReads(counter, "counts", 1);
    raw[key] = snap.data().count;
  }
  return raw;
}

async function loadScheduledUserFacts(db, Timestamp, FieldPath, { asOf, dateKeys, includeSnapshot, counter }) {
  const sorted = [...dateKeys].sort();
  const start = Timestamp.fromMillis(taipeiStartMs(sorted[0]));
  const end = Timestamp.fromMillis(taipeiStartMs(addDaysKey(sorted[sorted.length - 1], 1)));
  const [createdSnap, joinSnap] = await Promise.all([
    db.collection("users").where("createdAt", ">=", start).where("createdAt", "<", end).get(),
    db.collection("users").where("joinDate", ">=", start).where("joinDate", "<", end).get(),
  ]);
  addReads(counter, "users", (createdSnap.size || 0) + (joinSnap.size || 0));
  const byId = new Map();
  [...createdSnap.docs, ...joinSnap.docs].forEach((doc) => {
    byId.set(doc.id, { id: doc.id, ...(doc.data() || {}) });
  });
  const partial = summarizeUserDirectory([...byId.values()], asOf);
  const facts = {
    newUsersByDate: partial.newUsersByDate,
    unknownCreated: 0,
    snapshot: null,
    totalUsers: null,
    qaUsers: null,
  };
  if (includeSnapshot) {
    const [raw, qaUsers] = await Promise.all([
      loadSnapshotCounts(db, Timestamp, asOf, counter),
      loadQaUsers(db, FieldPath, counter),
    ]);
    const snapshot = activeSnapshotSubtractingQa(raw, qaUsers, asOf);
    facts.snapshot = snapshot.snapshot;
    facts.totalUsers = snapshot.totalUsers;
    facts.qaUsers = snapshot.qaUsers;
  }
  return facts;
}

function mergeOpenEvents(datedEvents, openEvents, dateKeys) {
  const keys = new Set(dateKeys);
  const byId = new Map(datedEvents.map((event) => [event._docId, event]));
  openEvents.forEach((event) => {
    if (keys.has(normalizeEventDateKey(event.date))) byId.set(event._docId, event);
  });
  return [...byId.values()];
}

async function loadUsageCost(db, FieldPath, nowMs, counter) {
  const todayKey = resolveTodayKey(nowMs);
  const yesterdayKey = addDaysKey(todayKey, -1);
  const [todaySnap, yesterdaySnap] = await Promise.all([
    db.collection("usageMetrics").doc(dateKeyToDocId(todayKey)).get(),
    db.collection("usageMetrics").doc(dateKeyToDocId(yesterdayKey)).get(),
  ]);
  addReads(counter, "usage", 2);
  const metricOf = (snap) => {
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const billing = data.billing || {};
    return {
      totalCost: billing.totalCost == null ? null : Number(billing.totalCost),
      currency: billing.currency || "USD",
      month: billing.billingPeriod || "",
      sourceDateKey: docIdToDateKey(snap.id) || docIdToDateKey(data.dateKey),
    };
  };
  const todayMetric = metricOf(todaySnap);
  const yesterdayMetric = metricOf(yesterdaySnap);
  const latest = todayMetric && todayMetric.totalCost != null ? todayMetric : (yesterdayMetric || todayMetric);
  const [year, month] = todayKey.split("-").map(Number);
  const prevLast = new Date(Date.UTC(year, month - 1, 0));
  const prevYear = prevLast.getUTCFullYear();
  const prevMonth = String(prevLast.getUTCMonth() + 1).padStart(2, "0");
  const prevDay = String(prevLast.getUTCDate()).padStart(2, "0");
  const prevSnap = await db.collection("usageMetrics")
    .where(FieldPath.documentId(), ">=", `${prevYear}${prevMonth}01`)
    .where(FieldPath.documentId(), "<=", `${prevYear}${prevMonth}${prevDay}`)
    .orderBy(FieldPath.documentId(), "desc")
    .limit(1)
    .get();
  addReads(counter, "usage", prevSnap.size || 0);
  const prevDoc = prevSnap.docs && prevSnap.docs[0];
  const prevMetric = prevDoc ? metricOf(prevDoc) : null;
  if (!latest) return null;
  return buildCost({
    todayKey,
    monthToDate: latest.totalCost,
    currency: latest.currency,
    month: latest.month,
    sourceDateKey: latest.sourceDateKey,
    prevMonthTotal: prevMetric ? prevMetric.totalCost : null,
  });
}

async function readSummaryWindow(db, FieldPath, asOf, counter) {
  const fromId = dateKeyToDocId(addDaysKey(asOf, -(SUMMARY_LOOKBACK_DAYS - 1)));
  const toId = dateKeyToDocId(asOf);
  const snap = await db.collection("opsDailyStats")
    .where(FieldPath.documentId(), ">=", fromId)
    .where(FieldPath.documentId(), "<=", toId)
    .get();
  addReads(counter, "dailyStats", snap.size || 0);
  const dailyByDate = {};
  snap.docs.forEach((doc) => {
    const dateKey = docIdToDateKey(doc.id);
    if (dateKey) dailyByDate[dateKey] = doc.data() || {};
  });
  return dailyByDate;
}

async function writeDayPair(db, Timestamp, { dateKey, asOf, built, nowMs }) {
  const docId = dateKeyToDocId(dateKey);
  const dailyRef = db.collection("opsDailyStats").doc(docId);
  const participantRef = db.collection("opsParticipantDays").doc(docId);
  await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(dailyRef);
    const existing = existingSnap.exists ? (existingSnap.data() || {}) : null;
    const preserved = applyPreservedUserSnapshot(built.daily, existing, { dateKey, asOf });
    tx.set(dailyRef, stampComputed(preserved, Timestamp, nowMs));
    tx.set(participantRef, stampComputed(built.participant, Timestamp, nowMs));
  });
}

async function buildDaysForKeys({
  dateKeys,
  events,
  registrationsByDocId,
  attendanceByDocId,
  flagsByDocId,
  userFacts,
  asOf,
  runId,
  nowMs,
  unparsableCount,
  writeSnapshot,
}) {
  const built = {};
  dateKeys.forEach((dateKey) => {
    built[dateKey] = buildDayDocs({
      dateKey,
      events,
      registrationsByDocId,
      attendanceByDocId,
      flagsByDocId,
      userFacts,
      asOf,
      writeSnapshot: writeSnapshot && dateKey === asOf,
      countUnknown: false,
      runId,
      nowMs,
      unparsableCount: dateKey === asOf ? unparsableCount : 0,
    });
  });
  return built;
}

async function runOpsRollup({ db, Timestamp, nowMs = Date.now(), mode = "daily", log = console.log } = {}) {
  const { FieldPath } = require("firebase-admin/firestore");
  const counter = emptyCounter();
  const asOf = resolveAsOf(nowMs);
  const todayId = dateKeyToDocId(resolveTodayKey(nowMs));
  const runId = mode === "reconcile" ? `reconcile-${todayId}` : `daily-${todayId}`;
  const openEvents = await loadOpenEvents(db, counter);
  const stuckAttention = buildStuckAttention(openEvents, nowMs);
  const lowFill = selectUpcomingLowFill(openEvents, nowMs);
  const previousSnap = await db.collection("opsSummary").doc("latest").get();
  addReads(counter, "existing", 1);
  const previous = previousSnap.exists ? (previousSnap.data() || {}) : null;
  const dateKeys = mode === "reconcile"
    ? reconcileDateKeys(asOf)
    : recomputeDateKeys({
      asOf,
      previousAttention: previous?.attention || [],
      stuckRefIds: new Set(stuckAttention.map((item) => item.refId)),
    });
  const datedEvents = await loadEventsForDateKeys(db, dateKeys, counter);
  const events = mergeOpenEvents(datedEvents, openEvents, dateKeys);
  const unparsableCount = countUnparsableEvents([...openEvents, ...events]);
  const { registrationsByDocId, attendanceByDocId } = await loadEventChildren(db, events, counter);
  const flagsByDocId = await loadFlagMap(db, events.map((event) => event._docId), counter);
  const userFacts = await loadScheduledUserFacts(db, Timestamp, FieldPath, {
    asOf,
    dateKeys,
    includeSnapshot: mode !== "reconcile",
    counter,
  });
  const built = await buildDaysForKeys({
    dateKeys,
    events,
    registrationsByDocId,
    attendanceByDocId,
    flagsByDocId,
    userFacts,
    asOf,
    runId,
    nowMs,
    unparsableCount,
    writeSnapshot: mode !== "reconcile",
  });

  let mismatches = [];
  if (mode === "reconcile") {
    const [existingDaily, existingParticipant] = await Promise.all([
      loadExistingDailies(db, dateKeys, counter),
      loadExistingParticipants(db, dateKeys, counter),
    ]);
    mismatches = dateKeys.filter((dateKey) => reconcileMismatch(
      existingDaily[dateKey],
      built[dateKey].daily,
      existingParticipant[dateKey],
      built[dateKey].participant,
    )).sort();
    for (const dateKey of mismatches) {
      await writeDayPair(db, Timestamp, { dateKey, asOf, built: built[dateKey], nowMs });
    }
  } else {
    for (const dateKey of dateKeys) {
      await writeDayPair(db, Timestamp, { dateKey, asOf, built: built[dateKey], nowMs });
    }
  }

  const dailyByDate = await readSummaryWindow(db, FieldPath, asOf, counter);
  const cost = await loadUsageCost(db, FieldPath, nowMs, counter);
  const integrity = mode === "reconcile"
    ? { lastReconcileAt: Timestamp.fromMillis(nowMs), lastMismatchDays: mismatches }
    : {
      lastReconcileAt: previous?.integrity?.lastReconcileAt ?? null,
      lastMismatchDays: previous?.integrity?.lastMismatchDays || [],
    };
  const summaries = buildOpsSummaries({
    asOf,
    nowMs,
    dailyByDate,
    stuckAttention,
    lowFill,
    cost,
    integrity,
  });
  await db.collection("opsSummary").doc("latest").set(stampComputed(summaries.latest, Timestamp, nowMs));
  await db.collection("opsSummary").doc("noshow").set(stampComputed(summaries.noshow, Timestamp, nowMs));
  log(JSON.stringify({
    tag: mode === "reconcile" ? "[opsWeeklyReconcile]" : "[opsDailyRollup]",
    mode,
    asOf,
    runId,
    days: dateKeys.length,
    mismatches,
    stuck: stuckAttention.length,
    lowFill: lowFill.upcomingLowFill.length,
    lowFillOverflow: lowFill.upcomingLowFillOverflow,
    reads: counter,
  }));
  return { asOf, dateKeys, mismatches, counter };
}

function createOpsRollupExports({ db, Timestamp, onSchedule }) {
  return {
    opsDailyRollup: onSchedule(
      { ...SCHEDULE_BASE, schedule: "0 3 * * *" },
      async () => runOpsRollup({ db, Timestamp, mode: "daily" }),
    ),
    opsWeeklyReconcile: onSchedule(
      { ...SCHEDULE_BASE, schedule: "30 3 * * 1" },
      async () => runOpsRollup({ db, Timestamp, mode: "reconcile" }),
    ),
  };
}

module.exports = {
  SCHEDULE_BASE,
  createOpsRollupExports,
  loadEventChildren,
  loadEventsForDateKeys,
  loadExistingDailies,
  loadFlagMap,
  runOpsRollup,
  stampComputed,
};
