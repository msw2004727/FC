"use strict";

/**
 * 通知發送授權強化：所有閾值集中於此（暫定值，待 T-061 linepush 30 日用量調整）。
 * 執行時閾值以這個物件為唯一來源；調整數值時須同步更新「閾值對照」測試與 docs/tunables.md，只改物件會讓對照測試失敗、文件過期。
 */
const NOTIFICATION_GUARD_LIMITS = Object.freeze({
  // LINE 推播入列（enqueuePrivilegedLineNotification）
  enqueue: Object.freeze({
    userPerMinute: 150, // 一般層：每呼叫者每分鐘
    staffPerMinute: 2000, // 教練以上：批次通知（活動異動／取消、全體廣播）
    userPerDay: 100, // 一般層：每呼叫者每日（只計實際入列）；每日類閾值依用量盤點設定，暫定
  }),
  // 站內信投遞（deliverToInbox）
  inbox: Object.freeze({
    userPerMinute: 300,
    staffPerMinute: 2000,
    userPerDay: 600,
  }),
  targetPerDay: 12, // 每目標每日（只計一般層呼叫者）
  callerTargetPerDay: 10, // 每（呼叫者, 目標）每日（一般層）
  // 全域每日實際推播量，兩池互不影響；教練以上與系統共用 staff 池
  globalPerDay: Object.freeze({ user: 400, staff: 2000 }),
  dedupeWindowMs: 10 * 60 * 1000, // dedupeKey 去重視窗（防重送／連點）
  // 實作參數（非業務閾值）
  staffCallerShards: 8, // 教練以上呼叫者計數分片數（批次通知時分散寫入）
  globalShards: 10, // 全域計數分片數
  counterTtlMs: 3 * 24 * 60 * 60 * 1000, // 計數文件 expireAt 保留時間（TTL policy 尚未啟用）
});

const COUNTER_COLLECTION = "notificationGuardCounters";
const DEDUPE_COLLECTION = "linePushDedupe";

module.exports = { NOTIFICATION_GUARD_LIMITS, COUNTER_COLLECTION, DEDUPE_COLLECTION };
