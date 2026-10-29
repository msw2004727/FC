"use strict";

/**
 * 通知發送授權強化測試共用輔助：可控時鐘、記憶體版 Firestore、真實的 notification-guards。
 */

const {
  createNotificationGuards,
  NOTIFICATION_GUARD_LIMITS,
  COUNTER_COLLECTION,
  DEDUPE_COLLECTION,
} = require('../../functions/notification-guards');
const { createFakeDb, FieldValue } = require('./notification-guards-fake-db');

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// 與 functions/index.js 的 ROLE_LEVELS 相同（notification-guards-limits.test.js 有一致性檢查）
const ROLE_LEVELS = Object.freeze({
  user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5,
});

// 台北 2026-10-27 12:00（UTC 04:00）；台北日期 20261027
const T0 = Date.UTC(2026, 9, 27, 4, 0, 0);
const DAY = '20261027';
const MINUTE_MS = 60 * 1000;
const CALLER = `U${'c'.repeat(32)}`;
const TARGET = `U${'t'.repeat(32)}`;
const OTHER = `U${'o'.repeat(32)}`;
const RATE_LIMITED = { code: 'resource-exhausted', message: 'RATE_LIMITED' };

function makeLogger() {
  const logger = { warns: [], errors: [], logs: [] };
  logger.warn = (...args) => logger.warns.push(args);
  logger.error = (...args) => logger.errors.push(args);
  logger.log = (...args) => logger.logs.push(args);
  logger.info = () => {};
  return logger;
}

function createGuardsEnv({ seed = {}, faults, clock = { t: T0 } } = {}) {
  const db = createFakeDb({ seed, faults });
  const logger = makeLogger();
  const guards = createNotificationGuards({
    db,
    FieldValue,
    HttpsError: TestHttpsError,
    roleLevels: ROLE_LEVELS,
    now: () => clock.t,
    random: () => 0,
    logger,
  });
  return { db, clock, logger, guards };
}

// 把某個計數器預先設到指定值（用於測試上限邊界，不必真的跑滿）
async function seedCounter(db, docId, count) {
  await db.collection(COUNTER_COLLECTION).doc(docId).set({ count });
}

function sumCounters(db, fragment) {
  return db.paths(`${COUNTER_COLLECTION}/`)
    .filter((docPath) => docPath.includes(fragment))
    .reduce((sum, docPath) => sum + (db.read(docPath).count || 0), 0);
}

async function repeat(count, fn) {
  for (let i = 0; i < count; i += 1) {
    await fn(i);
  }
}

module.exports = {
  TestHttpsError,
  ROLE_LEVELS,
  T0,
  DAY,
  MINUTE_MS,
  CALLER,
  TARGET,
  OTHER,
  RATE_LIMITED,
  NOTIFICATION_GUARD_LIMITS,
  COUNTER_COLLECTION,
  DEDUPE_COLLECTION,
  makeLogger,
  createGuardsEnv,
  seedCounter,
  sumCounters,
  repeat,
};
