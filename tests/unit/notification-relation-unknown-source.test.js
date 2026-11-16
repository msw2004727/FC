"use strict";

/**
 * 卡 C1：未知 source 改 record（照送）＋節流鍵加 reason。
 * 兩個 Callable 的實際入列／寫入由 notification-guards-callables.test.js 走 index.js 原文證明。
 */

const fs = require("fs");
const path = require("path");
const { decideRelation } = require("../../functions/notification-relation-decide");
const { createRelationLogger, createRelationChecker } = require("../../functions/notification-relation-log");
const { maskUid } = require("../../functions/notification-fields");

const CALLER = "uidA-long-uid-0001";
const INDEX_PATH = path.join(__dirname, "..", "..", "functions", "index.js");

function decide(source) {
  return decideRelation({
    source,
    keys: { eventId: "ev-secret", title: "標題", body: "內文" },
    ctx: { callerUid: CALLER, callerRole: "user", recipientUid: "uidB-long-uid-0002" },
    queries: {},
  });
}

// 與 functions/index.js 的兩個 Callable 相同：只擋 skip／deny，record 與 allow 都照送。
function callableBlocks(outcome) {
  if (outcome === "skip") return true;
  if (outcome === "deny") return true;
  return false;
}

describe("未知 source 記錄（照送）", () => {
  test("classify 回 null：outcome record、reason unknown_source、relationId null", async () => {
    const result = await decide("brand_new_source");
    expect(result).toEqual({
      outcome: "record",
      relationId: null,
      gate: "relation_missing_key",
      reason: "unknown_source",
      flags: {},
    });
    expect(callableBlocks(result.outcome)).toBe(false);
  });

  test("空白與非字串 source 同樣 record，不是 deny", async () => {
    for (const source of ["", undefined, null, 7]) {
      const result = await decide(source);
      expect(result).toMatchObject({
        outcome: "record",
        relationId: null,
        gate: "relation_missing_key",
        reason: "unknown_source",
      });
      expect(callableBlocks(result.outcome)).toBe(false);
    }
  });

  test("index.js 兩個 Callable 只判斷 skip／deny，沒有擋 record", () => {
    const index = fs.readFileSync(INDEX_PATH, "utf8");
    const enqueueAt = index.indexOf("exports.enqueuePrivilegedLineNotification");
    const inboxAt = index.indexOf("exports.deliverToInbox");
    expect(enqueueAt).toBeGreaterThan(0);
    expect(inboxAt).toBeGreaterThan(enqueueAt);
    const enqueue = index.slice(enqueueAt, index.indexOf("async function resolveLineNotificationRecipient", enqueueAt));
    const inbox = index.slice(inboxAt, index.indexOf("async function assertCallerCanReviewGroupActionDocs", inboxAt));
    for (const body of [enqueue, inbox]) {
      expect(body).toContain('if (relation.outcome === "skip")');
      expect(body).toContain('if (relation.outcome === "deny")');
      expect(body).not.toContain('relation.outcome === "record"');
      expect(body).not.toContain('relation.outcome === "allow"');
    }
  });
});

describe("relation log：null relationId 與 reason 節流", () => {
  function loggerOf() {
    return { warn: jest.fn() };
  }

  test("relationId null、reason unknown_source：寫出一筆、不丟錯，不含 title／body／完整 uid", async () => {
    const logger = loggerOf();
    const log = createRelationLogger({ logger, now: () => 1700000000000 });
    const checker = createRelationChecker({ decide: decideRelation, queries: {}, log });
    const decision = await checker.check({
      kind: "inbox",
      callerUid: CALLER,
      callerRole: "user",
      source: "brand_new_source",
      data: { title: "標題不該出現", body: "內文不該出現", eventId: "ev-secret-123" },
      recipientUid: "uidB-long-uid-0002",
    });
    expect(decision).toEqual({
      outcome: "record",
      relationId: null,
      gate: "relation_missing_key",
      reason: "unknown_source",
      flags: {},
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("[notificationGuards] gate triggered", {
      gate: "relation_missing_key",
      kind: "inbox",
      caller: maskUid(CALLER),
      source: "brand_new_source",
      relation: null,
      reason: "unknown_source",
    });
    const text = JSON.stringify(logger.warn.mock.calls);
    expect(text).not.toContain(CALLER);
    expect(text).not.toContain("uidB-long-uid-0002");
    expect(text).not.toContain("標題");
    expect(text).not.toContain("內文");
    expect(text).not.toContain("ev-secret-123");
  });

  test("relationId 為 null 或 undefined 時直接呼叫 logger 不丟錯，relation 寫成 null", () => {
    const logger = loggerOf();
    const log = createRelationLogger({ logger, now: () => 1700000000000 });
    const meta = { kind: "enqueue", callerUid: CALLER, source: "brand_new_source" };
    let first;
    let second;
    expect(() => {
      first = log({ gate: "relation_missing_key", relationId: null, reason: "unknown_source", flags: {} }, meta);
      second = log({ gate: "relation_missing_key", reason: "query_error" }, { ...meta, callerUid: "uid-other-0002" });
    }).not.toThrow();
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(logger.warn.mock.calls.map((call) => call[1].relation)).toEqual([null, null]);
  });

  test("同分鐘同呼叫者先 missing_key 再 query_error 寫出兩筆，同 reason 第二筆節流，unknown_source 也不被吃掉", () => {
    const logger = loggerOf();
    const log = createRelationLogger({ logger, now: () => 1700000000000 });
    const meta = { kind: "enqueue", callerUid: CALLER, source: "template:event_changed" };
    const missing = { gate: "relation_missing_key", relationId: "R1", reason: "missing_key", flags: { hasEventId: false } };
    const queryError = {
      gate: "relation_missing_key",
      relationId: "R1",
      reason: "query_error",
      flags: { errCode: "unavailable", retried: true },
    };
    const unknown = { gate: "relation_missing_key", relationId: null, reason: "unknown_source", flags: {} };
    const unknownMeta = { ...meta, source: "brand_new_source" };

    expect(log(missing, meta)).toBe(true);
    expect(log(queryError, meta)).toBe(true);
    expect(log(unknown, unknownMeta)).toBe(true);
    expect(log(missing, meta)).toBe(false);
    expect(log(queryError, meta)).toBe(false);
    expect(log(unknown, unknownMeta)).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.warn.mock.calls.map((call) => call[1].reason)).toEqual([
      "missing_key",
      "query_error",
      "unknown_source",
    ]);
    expect(logger.warn.mock.calls[2][1].relation).toBeNull();
  });
});
