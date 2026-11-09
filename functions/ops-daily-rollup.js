"use strict";

// 營運儀表板排程的 Firestore 讀寫。計算在 ops-rollup-core.js。
// 重算日期先切成連續區段再查，避免卡住活動解除後從最小日掃到最大日。
// 失敗先寫結構化 log 再拋出，不寫 opsSummary，讓 generatedAt 停在上一份成功的彙總。

const {
  SUMMARY_LOOKBACK_DAYS,
  activeSnapshotSubtractingQa,
  applyPreservedUserSnapshot,
  buildCost,
  buildDayDocs,
  buildOpsSummaries,
  buildStuckAttention,
  classifyEvent,
  contiguousDateSegments,
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
  const keys = new Set((dateKeys || []).filter(Boolean));
  const found = new Map();
  const segments = contiguousDateSegments([...keys]);
  const queried = new Set();
  for (const segment of segments) {
    const bounds = eventDateQueryBounds(segment.start, segment.end);
    for (const bound of bounds) {
      const boundKey = `${bound.start}|${bound.endExclusive}`;
      if (queried.has(boundKey)) continue;
      queried.add(boundKey);
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
  }
  return [...found.values()];
}

// 已結束、非取消、非外部、非 QA 主辦才有報名與簽到可彙總。其餘不讀子集合。
function eventsNeedingRoster(events) {
  return (Array.isArray(events) ? events : []).filter((event) => classifyEvent(event).bucket === "held");
}

async function loadEventChildren(db, events, counter) {
  const registrationsByDocId = {};
  const attendanceByDocId = {};
  const targets = eventsNeedingRoster(events);
  await mapPool(targets, CHILD_CONCURRENCY, async (event) => {
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
  const byId = new Map();
  // 近 14 天是一段；解除卡住後補進來的歸屬日各自成段。不要用最小日～最大日一次掃過缺口。
  // joinDate 若是字串，Timestamp 範圍比不到（型別不同）。不另掃全表；整包解析只在回填腳本。
  const segments = contiguousDateSegments(dateKeys);
  for (const segment of segments) {
    const start = Timestamp.fromMillis(taipeiStartMs(segment.start));
    const end = Timestamp.fromMillis(taipeiStartMs(addDaysKey(segment.end, 1)));
    const [createdSnap, joinSnap] = await Promise.all([
      db.collection("users").where("createdAt", ">=", start).where("createdAt", "<", end).get(),
      db.collection("users").where("joinDate", ">=", start).where("joinDate", "<", end).get(),
    ]);
    addReads(counter, "users", (createdSnap.size || 0) + (joinSnap.size || 0));
    [...createdSnap.docs, ...joinSnap.docs].forEach((doc) => {
      byId.set(doc.id, { id: doc.id, ...(doc.data() || {}) });
    });
  }
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

async function writeDayPair(db, Timestamp, { dateKey, asOf, built, nowMs, counter }) {
  const docId = dateKeyToDocId(dateKey);
  const dailyRef = db.collection("opsDailyStats").doc(docId);
  const participantRef = db.collection("opsParticipantDays").doc(docId);
  await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(dailyRef);
    if (counter) addReads(counter, "existing", 1);
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

function logRollupFailure({ mode, asOf, step, err }) {
  console.error(JSON.stringify({
    tag: mode === "reconcile" ? "opsWeeklyReconcile" : "opsDailyRollup",
    mode,
    asOf,
    step,
    error: String((err && err.message) || err),
  }));
}

async function runOpsRollup({ db, Timestamp, fieldPath, nowMs = Date.now(), mode = "daily", log = console.log } = {}) {
  const FieldPath = fieldPath || require("firebase-admin/firestore").FieldPath;
  const counter = emptyCounter();
  const asOf = resolveAsOf(nowMs);
  let step = "init";
  try {
    const todayId = dateKeyToDocId(resolveTodayKey(nowMs));
    const runId = mode === "reconcile" ? `reconcile-${todayId}` : `daily-${todayId}`;
    step = "openEvents";
    const openEvents = await loadOpenEvents(db, counter);
    const stuckAttention = buildStuckAttention(openEvents, nowMs);
    const lowFill = selectUpcomingLowFill(openEvents, nowMs);
    step = "previousSummary";
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
    step = "loadEvents";
    const datedEvents = await loadEventsForDateKeys(db, dateKeys, counter);
    const events = mergeOpenEvents(datedEvents, openEvents, dateKeys);
    const unparsableCount = countUnparsableEvents([...openEvents, ...events]);
    const roster = eventsNeedingRoster(events);
    step = "loadChildren";
    const { registrationsByDocId, attendanceByDocId } = await loadEventChildren(db, roster, counter);
    step = "loadFlags";
    const flagsByDocId = await loadFlagMap(db, roster.map((event) => event._docId), counter);
    step = "loadUsers";
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
      step = "reconcileRead";
      const [existingDaily, existingParticipant] = await Promise.all([
        loadExistingDailies(db, dateKeys, counter),
        loadExistingParticipants(db, dateKeys, counter),
      ]);
      const missing = [];
      dateKeys.forEach((dateKey) => {
        if (!existingDaily[dateKey] || !existingParticipant[dateKey]) {
          missing.push(dateKey);
          return;
        }
        if (reconcileMismatch(
          existingDaily[dateKey],
          built[dateKey].daily,
          existingParticipant[dateKey],
          built[dateKey].participant,
        )) mismatches.push(dateKey);
      });
      mismatches.sort();
      const toWrite = [...missing, ...mismatches].sort();
      step = "writeDays";
      for (const dateKey of toWrite) {
        await writeDayPair(db, Timestamp, { dateKey, asOf, built: built[dateKey], nowMs, counter });
      }
    } else {
      step = "writeDays";
      for (const dateKey of dateKeys) {
        await writeDayPair(db, Timestamp, { dateKey, asOf, built: built[dateKey], nowMs, counter });
      }
    }

    step = "summaryWindow";
    const dailyByDate = await readSummaryWindow(db, FieldPath, asOf, counter);
    step = "loadCost";
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
    step = "writeSummary";
    const batch = db.batch();
    batch.set(db.collection("opsSummary").doc("latest"), stampComputed(summaries.latest, Timestamp, nowMs));
    batch.set(db.collection("opsSummary").doc("noshow"), stampComputed(summaries.noshow, Timestamp, nowMs));
    await batch.commit();
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
  } catch (err) {
    logRollupFailure({ mode, asOf, step, err });
    throw err;
  }
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
  eventsNeedingRoster,
  loadEventChildren,
  loadEventsForDateKeys,
  loadExistingDailies,
  loadFlagMap,
  runOpsRollup,
  stampComputed,
};
