"use strict";

/**
 * 通知發送授權強化（第 2 批）：入列池與發送池（純函式，無 I/O）。
 * 不讀 request。發送池不看 requestedByRole。
 * selectEnqueuePool 的 mode 由呼叫端傳入（relationMode("R1")），本檔不讀強制常數。
 */

function eventLimitIsFinite(limits) {
  return Number.isFinite(limits?.globalPerDay?.event);
}

function selectEnqueuePool({ staff, relationId, limits, mode }) {
  if (relationId === "R1" && mode === "enforce" && eventLimitIsFinite(limits)) return "event";
  if (staff) return "staff";
  return "user";
}

function resolveSendPool({ pool, requestedByUid, limits }) {
  if (pool === "user" || pool === "staff") return pool;
  if (pool === "event") return eventLimitIsFinite(limits) ? "event" : "user";
  if (requestedByUid === "system") return "staff";
  return "user";
}

module.exports = {
  selectEnqueuePool,
  resolveSendPool,
};
