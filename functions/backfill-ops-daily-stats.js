"use strict";

// 一次性回填 opsDailyStats 與 opsParticipantDays。預設 dry-run，只讀不寫；加 --apply 才寫。
// 用法（專案根目錄或 functions/）：node functions/backfill-ops-daily-stats.js [--apply] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
// 預設區間是台北昨日往回 730 天（含頭含尾）。activeSnapshot／totalUsers／qaUsers 不回填，留 null；
// 若該日已有快照，重跑時保留。不寫 opsSummary。
// --to 晚於台北昨日直接拒絕。超過 730 天（含 dry-run）拒絕，不靠 enumerateDateKeys 靜默截斷。
// unknownCreated 是全站缺註冊日人數，只寫在 --to 那天。

const { addDaysKey } = require("./ops-ltv-report");
const {
  applyPreservedUserSnapshot,
  buildDayDocs,
  countUnparsableEvents,
  dateKeyToDocId,
  enumerateDateKeys,
  resolveAsOf,
  summarizeUserDirectory,
  taipeiStartMs,
} = require("./ops-rollup-core");
const {
  eventsNeedingRoster,
  loadEventChildren,
  loadEventsForDateKeys,
  loadExistingDailies,
  loadFlagMap,
} = require("./ops-daily-rollup");

const DAY_MS = 24 * 60 * 60 * 1000;

const PROJECT_ID = "fc-football-6c8dc";
const BATCH_SIZE = 400;
const MAX_APPLY_DAYS = 730;

function isDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return "";
  const next = argv[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`MISSING_${flag.replace(/^--/, "").toUpperCase()}`);
  return next;
}

function inclusiveDayCount(fromKey, toKey) {
  const from = taipeiStartMs(fromKey);
  const to = taipeiStartMs(toKey);
  if (from == null || to == null || to < from) return 0;
  return Math.round((to - from) / DAY_MS) + 1;
}

function assertBackfillRange({ fromKey, toKey, nowMs }) {
  if (!isDateKey(fromKey) || !isDateKey(toKey) || fromKey > toKey) throw new Error("INVALID_DATE_RANGE");
  if (toKey > resolveAsOf(nowMs)) throw new Error("TO_AFTER_ASOF");
  const span = inclusiveDayCount(fromKey, toKey);
  if (span > MAX_APPLY_DAYS) throw new Error(`RANGE_EXCEEDS_${MAX_APPLY_DAYS}`);
  return span;
}

function parseBackfillArgs(argv, nowMs = Date.now()) {
  const apply = argv.includes("--apply");
  const toKey = flagValue(argv, "--to") || resolveAsOf(nowMs);
  const fromKey = flagValue(argv, "--from") || addDaysKey(toKey, -(MAX_APPLY_DAYS - 1));
  assertBackfillRange({ fromKey, toKey, nowMs });
  return { apply, fromKey, toKey };
}

function emptyCounter() {
  return { total: 0, events: 0, registrations: 0, attendance: 0, flags: 0, users: 0, existing: 0 };
}

function withoutComputedMs(doc, nowMs) {
  const next = { ...doc, computedAt: new Date(nowMs) };
  delete next.computedAtMs;
  return next;
}

async function runBackfill({ db, apply = false, fromKey, toKey, nowMs = Date.now(), log = console.log } = {}) {
  const span = assertBackfillRange({ fromKey, toKey, nowMs });
  const days = enumerateDateKeys(fromKey, toKey);
  if (days.length !== span) throw new Error(`RANGE_EXCEEDS_${MAX_APPLY_DAYS}`);
  const counter = emptyCounter();
  const events = await loadEventsForDateKeys(db, days, counter);
  const roster = eventsNeedingRoster(events);
  const { registrationsByDocId, attendanceByDocId } = await loadEventChildren(db, roster, counter);
  const flagsByDocId = await loadFlagMap(db, roster.map((event) => event._docId), counter);
  const userSnap = await db.collection("users").select("uid", "createdAt", "joinDate", "lastLogin").get();
  counter.users += userSnap.size || 0;
  counter.total += userSnap.size || 0;
  const users = userSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  const userFacts = summarizeUserDirectory(users, toKey);
  const existing = await loadExistingDailies(db, days, counter);
  const unparsable = countUnparsableEvents(events);
  const runId = `backfill-${nowMs}`;
  const plans = days.map((dateKey) => {
    const built = buildDayDocs({
      dateKey,
      events,
      registrationsByDocId,
      attendanceByDocId,
      flagsByDocId,
      userFacts,
      asOf: toKey,
      writeSnapshot: false,
      countUnknown: dateKey === toKey,
      runId,
      nowMs,
      unparsableCount: dateKey === toKey ? unparsable : 0,
    });
    built.daily = applyPreservedUserSnapshot(built.daily, existing[dateKey] || null, { dateKey, asOf: toKey });
    return built;
  });
  const report = {
    mode: apply ? "apply" : "dry-run",
    from: fromKey,
    to: toKey,
    days: days.length,
    reads: counter,
    readTotal: counter.total,
    eventDocs: events.length,
    held: plans.reduce((sum, item) => sum + item.daily.events.held, 0),
    cancelled: plans.reduce((sum, item) => sum + item.daily.events.cancelled, 0),
    external: plans.reduce((sum, item) => sum + item.daily.events.external, 0),
    confirmed: plans.reduce((sum, item) => sum + item.daily.regs.confirmed, 0),
    unparsableOnEndDay: unparsable,
    unknownCreated: userFacts.unknownCreated,
    plannedDailyWrites: plans.length,
    plannedParticipantWrites: plans.length,
    preservedSnapshots: plans.filter((item) => item.daily.users.activeSnapshot != null).length,
  };
  log(JSON.stringify(report, null, 2));
  if (!apply) return report;

  const writes = [];
  plans.forEach((plan) => {
    const docId = dateKeyToDocId(plan.daily.dateKey);
    writes.push({ collection: "opsDailyStats", id: docId, data: withoutComputedMs(plan.daily, nowMs) });
    writes.push({ collection: "opsParticipantDays", id: docId, data: withoutComputedMs(plan.participant, nowMs) });
  });
  for (let index = 0; index < writes.length; index += BATCH_SIZE) {
    const batch = db.batch();
    writes.slice(index, index + BATCH_SIZE).forEach((item) => {
      batch.set(db.collection(item.collection).doc(item.id), item.data);
    });
    await batch.commit();
  }
  log(JSON.stringify({ applied: writes.length }, null, 2));
  return report;
}

async function main() {
  const { getApps, initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  const args = parseBackfillArgs(process.argv, Date.now());
  await runBackfill({ db: getFirestore(), ...args, nowMs: Date.now() });
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error("[backfill-ops-daily-stats]", String(error?.stack || error));
    process.exit(1);
  });
}

module.exports = {
  MAX_APPLY_DAYS,
  parseBackfillArgs,
  runBackfill,
};
