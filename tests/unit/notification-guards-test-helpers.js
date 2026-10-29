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
const { decideRelation } = require('../../functions/notification-relation-decide');
const { createRelationQueries } = require('../../functions/notification-relation-queries');
const { createRelationChecker } = require('../../functions/notification-relation-log');
const { selectEnqueuePool } = require('../../functions/notification-pool');
const { relationMode } = require('../../functions/notification-relation-enforcement');
const { maskUid } = require('../../functions/notification-fields');
const { createHelpers } = require('./notification-relation-test-kit');

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

function createGuardsEnv({ seed = {}, faults, clock = { t: T0 }, random = () => 0 } = {}) {
  const db = createFakeDb({ seed, faults });
  const logger = makeLogger();
  const guards = createNotificationGuards({
    db,
    FieldValue,
    HttpsError: TestHttpsError,
    roleLevels: ROLE_LEVELS,
    now: () => clock.t,
    random,
    logger,
  });
  return { db, clock, logger, guards };
}

// 關係檢查相關識別字（vm 沙盒注入用）：真實的決策、查詢與 log，查詢用同一個記憶體資料庫，helper 複製 index.js 的純邏輯。
// 注意：fake db 沒有 where().limit()，活動請在 events/{id} 文件放 id 欄位（直取成功）。
function createRelationSandbox({ db, guards }) {
  const checker = createRelationChecker({
    decide: decideRelation,
    log: guards.logRelationOutcome,
    queries: createRelationQueries({ db, helpers: createHelpers({ db }) }),
  });
  return {
    notificationRelation: checker,
    selectEnqueuePool,
    relationMode,
    NOTIFICATION_GUARD_LIMITS,
    maskUid,
  };
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
  createRelationSandbox,
  seedCounter,
  sumCounters,
  repeat,
};
