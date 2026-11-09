"use strict";

/**
 * 活動留言通知（計畫書 event-comment-notify-plan-2026-11-09 v3）。
 * 批 0：純函式。批 1：createOnEventCommentCreatedHandler（index.js 只接線，Firestore 與 LINE helper 由 index.js 注入）。
 * - 收件人與 Rules isCommentManager 逐字一致（admin／super_admin、creatorUid、ownerUid、captainUid、delegateUids）。
 * - 管理者自己留言整則不通知（站長 Q6）；同一場活動 30 分鐘一則、首則立即、尾端不補發（Q1）；私密一律立即發。
 * - 每日上限（_daily_）、_config 讀取（fail-closed）、文案與淨化。
 */

const { stripControlChars, taipeiDayKey, formatTaipeiDateTime } = require("./notification-fields");
const { buildInboxMessageDoc } = require("./inbox-message-doc");

const COMMENT_NOTIFY_COLLECTION = "eventCommentNotify";
const COMMENT_NOTIFY_CONFIG_DOC_ID = "_config";
const COMMENT_NOTIFY_DAILY_PREFIX = "_daily_";
// 顧問 §3.29：批 1 把此前綴加進 index.js 的 LINE_NOTIFICATION_FORCED_SOURCES（唯一的共用常數改動）。
// forced 只跳過全站 notificationToggles（正式 9 個 key 現況全 false）；個人 settings.activity 與 §3.4 每日上限照常，
// 全站開關改由 _config.lineEnabled／adminLineEnabled 負責（fail-closed）。不借 target: 前綴、不改 category_activity。
const COMMENT_NOTIFY_FORCED_SOURCE_PREFIX = "event_comment:";
const COMMENT_NOTIFY_SOURCE = `${COMMENT_NOTIFY_FORCED_SOURCE_PREFIX}new`;
const COMMENT_NOTIFY_CATEGORY = "activity";
const COMMENT_NOTIFY_WINDOW_MS = 30 * 60 * 1000;
const RECENT_COMMENT_IDS_MAX = 20;
const MAX_RECIPIENTS = 50;
const CONFIG_CACHE_MS = 60 * 1000;
const DEFAULT_AUTHOR_INBOX_PER_DAY = 30;
const LINK_PLACEHOLDER = "〔連結〕";
const ELLIPSIS = "…";
const TEXT_LIMITS = Object.freeze({ eventTitle: 30, authorName: 20, body: 40 });
const FALLBACK_EVENT_TITLE = "活動";
const FALLBACK_AUTHOR_NAME = "用戶";

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

// 可當投遞路徑的 uid。Rules 比對不 trim、不轉型；含頭尾空白或 "/" 的值不可能是登入 uid，
// 也不能當 users/{uid}/inbox 的文件 id，只拿來做 Q6 判斷、不寄送（避免寫出孤兒路徑）。
function isDeliverableUid(value) {
  return isNonEmptyString(value) && value.length <= 128 && value === value.trim() && !value.includes("/");
}

// ─── 收件人（計畫 §3.2、§4.1） ───

/**
 * @param {object} args
 * @param {object} args.eventData events/{eventDocId} 文件資料
 * @param {string} args.authorUid 留言者 uid
 * @param {Array<{docId: string, uid: string}>} args.adminEntries `users where role in ['admin','super_admin']` 的結果；
 *   uid 由呼叫端以 getAuthUidFromUserDoc 取得
 * @returns {{skip: string|null, recipients: string[], managers: string[], admins: string[],
 *   adminDocIdMismatch: number, recipientsCapped: boolean, undeliverable: number}}
 */
function resolveCommentNotifyRecipients({ eventData, authorUid, adminEntries, maxRecipients = MAX_RECIPIENTS } = {}) {
  const data = eventData && typeof eventData === "object" ? eventData : {};
  // Rules：creatorUid／ownerUid／captainUid 完全相等；delegateUids 必須是 list 才用 `uid in`；不認 delegates[].uid。
  const rawManagers = [
    data.creatorUid,
    data.ownerUid,
    data.captainUid,
    ...(Array.isArray(data.delegateUids) ? data.delegateUids : []),
  ].filter(isNonEmptyString);

  // Q6 判斷集合：活動管理者原值＋所有管理員文件的 docId 與 uid。
  // docId≠uid 的管理員不收通知（Rules isAdmin 讀 users/{auth.uid}，收件路徑對不上），但本人留言仍整則跳過（Gemini 複審 P3）；
  // docId 也納入，因為 auth.uid 等於該 docId 時 Rules 會把他當管理員。
  const q6Set = new Set(rawManagers);
  const adminUids = [];
  let adminDocIdMismatch = 0;
  for (const entry of Array.isArray(adminEntries) ? adminEntries : []) {
    const docId = entry?.docId;
    const uid = entry?.uid;
    if (isNonEmptyString(docId)) q6Set.add(docId);
    if (isNonEmptyString(uid)) q6Set.add(uid);
    if (isNonEmptyString(docId) && docId === uid) adminUids.push(uid);
    else adminDocIdMismatch += 1;
  }

  const empty = { recipients: [], managers: [], admins: [], adminDocIdMismatch, recipientsCapped: false, undeliverable: 0 };
  if (!isNonEmptyString(authorUid)) return { skip: "invalid_author", ...empty };
  if (q6Set.has(authorUid)) return { skip: "author_is_manager", ...empty };

  const seen = new Set();
  let undeliverable = 0;
  const take = (list) => {
    const out = [];
    for (const uid of list) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      if (!isDeliverableUid(uid)) {
        undeliverable += 1;
        continue;
      }
      out.push(uid);
    }
    return out;
  };
  // 先活動管理者再管理員：截斷時保住真正的主辦（Opus P3-4）；管理員若同時是本場管理者，只列在 managers。
  const managers = take(rawManagers);
  const admins = take(adminUids);
  const limit = Number.isInteger(maxRecipients) && maxRecipients > 0 ? maxRecipients : MAX_RECIPIENTS;
  const all = [...managers, ...admins];
  const recipients = all.slice(0, limit);
  const kept = new Set(recipients);
  return {
    skip: null,
    recipients,
    managers: managers.filter((uid) => kept.has(uid)),
    admins: admins.filter((uid) => kept.has(uid)),
    adminDocIdMismatch,
    recipientsCapped: all.length > limit,
    undeliverable,
  };
}

// ─── 前置過濾（計畫 §3.1） ───

function precheckComment(comment) {
  if (!comment || typeof comment !== "object") return { ok: false, reason: "invalid_comment" };
  if (comment.deleted === true) return { ok: false, reason: "deleted" };
  if (typeof comment.body !== "string" || comment.body.trim() === "") return { ok: false, reason: "empty_body" };
  if (!isNonEmptyString(comment.authorUid)) return { ok: false, reason: "invalid_author" };
  // 與 Rules canReadCommentData 同方向：只有 'public' 是公開，其餘都當私密（立即發、標「私密」）。
  return { ok: true, isPrivate: comment.visibility !== "public" };
}

function timestampToMs(value) {
  if (!value || typeof value.toMillis !== "function") return null;
  try {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : null;
  } catch (_e) {
    return null;
  }
}

/**
 * 活動是否仍該通知。結束判斷以留言 createdAt 對活動結束時間，不用觸發當下時間（Gemini P3-2）。
 * endTimestamp 有效時優先，否則用 date 經注入的 parseEventEndDateInTaipei；兩者都無法判讀時不擋（Rules 也放行）。
 */
function precheckCommentEvent({ eventData, commentCreatedAtMs, parseEventEndDateInTaipei } = {}) {
  if (!eventData || typeof eventData !== "object") return { ok: false, reason: "event_missing" };
  if (eventData.status === "cancelled") return { ok: false, reason: "event_cancelled" };
  let endMs = timestampToMs(eventData.endTimestamp);
  if (endMs === null && typeof parseEventEndDateInTaipei === "function") {
    const parsed = parseEventEndDateInTaipei(eventData.date);
    const ms = parsed && typeof parsed.getTime === "function" ? parsed.getTime() : NaN;
    endMs = Number.isFinite(ms) ? ms : null;
  }
  if (endMs !== null && Number.isFinite(commentCreatedAtMs) && commentCreatedAtMs >= endMs) {
    return { ok: false, reason: "event_ended_skip", endMs };
  }
  return { ok: true, endMs };
}

// ─── 文件 id 與鍵 ───

/**
 * stateDocId 為 null 表示 eventDocId 以底線開頭，會和 _config／_daily_ 撞名，呼叫端必須跳過不寫。
 */
function buildCommentNotifyKeys({ eventDocId, commentId, nowMs }) {
  if (!isNonEmptyString(eventDocId) || !isNonEmptyString(commentId)) {
    throw new TypeError("eventDocId and commentId are required");
  }
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) throw new TypeError("nowMs must be a finite number");
  return {
    stateDocId: eventDocId.startsWith("_") ? null : eventDocId,
    dailyDocId: `${COMMENT_NOTIFY_DAILY_PREFIX}${taipeiDayKey(nowMs)}`,
    inboxMessageId: `ecn_${eventDocId}_${commentId}`,
    dedupeKey: `event_comment:${eventDocId}:${commentId}`,
  };
}

// ─── 合併視窗（計畫 §3.3） ───

function normalizeNotifyState(state) {
  const s = state && typeof state === "object" ? state : {};
  return {
    lastPublicNotifiedAtMs: typeof s.lastPublicNotifiedAtMs === "number" && Number.isFinite(s.lastPublicNotifiedAtMs)
      ? s.lastPublicNotifiedAtMs
      : null,
    pendingPublic: Number.isInteger(s.pendingPublic) && s.pendingPublic > 0 ? s.pendingPublic : 0,
    recentCommentIds: Array.isArray(s.recentCommentIds)
      ? s.recentCommentIds.filter(isNonEmptyString).slice(-RECENT_COMMENT_IDS_MAX)
      : [],
  };
}

/**
 * 在 eventCommentNotify/{eventDocId} 的 transaction 內呼叫。
 * @returns {{action: 'send_public'|'send_private'|'accumulate'|'skip_duplicate', nextState: object|null, batchCount: number}}
 *   nextState 為 null 表示不寫（重送）；updatedAt／expireAt 由呼叫端補。
 */
function decideCommentNotify({ state, nowMs, commentId, isPrivate, windowMs = COMMENT_NOTIFY_WINDOW_MS } = {}) {
  if (!isNonEmptyString(commentId)) throw new TypeError("commentId is required");
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) throw new TypeError("nowMs must be a finite number");
  const current = normalizeNotifyState(state);
  // 任何順序的重送都擋（只要仍在最近 20 筆內）。
  if (current.recentCommentIds.includes(commentId)) {
    return { action: "skip_duplicate", nextState: null, batchCount: 0 };
  }
  const recentCommentIds = [...current.recentCommentIds, commentId].slice(-RECENT_COMMENT_IDS_MAX);
  if (isPrivate) {
    // 私密：立即發、不合併、不佔公開視窗。
    return {
      action: "send_private",
      batchCount: 1,
      nextState: {
        lastPublicNotifiedAtMs: current.lastPublicNotifiedAtMs,
        pendingPublic: current.pendingPublic,
        recentCommentIds,
      },
    };
  }
  if (current.lastPublicNotifiedAtMs === null || nowMs - current.lastPublicNotifiedAtMs >= windowMs) {
    return {
      action: "send_public",
      batchCount: current.pendingPublic + 1,
      nextState: { lastPublicNotifiedAtMs: nowMs, pendingPublic: 0, recentCommentIds },
    };
  }
  // 視窗內只累計，尾端不補發（Q1）。
  return {
    action: "accumulate",
    batchCount: 0,
    nextState: {
      lastPublicNotifiedAtMs: current.lastPublicNotifiedAtMs,
      pendingPublic: current.pendingPublic + 1,
      recentCommentIds,
    },
  };
}

// ─── _config（計畫 §3.8；fail-closed） ───

function toCap(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

// LINE caps 缺值或不合法一律 0（LINE 不發）；authorInboxPerDay 缺值 30。
function normalizeCommentNotifyCaps(caps) {
  const c = caps && typeof caps === "object" ? caps : {};
  return {
    globalPerDay: toCap(c.globalPerDay, 0),
    authorPerDay: toCap(c.authorPerDay, 0),
    recipientPerDay: toCap(c.recipientPerDay, 0),
    authorInboxPerDay: toCap(c.authorInboxPerDay, DEFAULT_AUTHOR_INBOX_PER_DAY),
  };
}

function buildFallbackConfig(status) {
  return Object.freeze({
    status,
    enabled: true,
    lineEnabled: false,
    adminLineEnabled: false,
    caps: Object.freeze(normalizeCommentNotifyCaps(null)),
  });
}

/**
 * 只有明確讀到 lineEnabled === true 才發 LINE；adminLineEnabled 另須 lineEnabled 為 true。
 * enabled 只有明確 false 才整個關（站內信也停）。
 */
function normalizeCommentNotifyConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return buildFallbackConfig("invalid");
  const lineEnabled = raw.lineEnabled === true;
  return Object.freeze({
    status: "ok",
    enabled: raw.enabled !== false,
    lineEnabled,
    adminLineEnabled: lineEnabled && raw.adminLineEnabled === true,
    caps: Object.freeze(normalizeCommentNotifyCaps(raw.caps)),
  });
}

/**
 * @param {object} args
 * @param {() => Promise<object|null>} args.readConfigDoc 回傳 _config 資料，文件不存在回 null
 * @param {number} args.nowMs
 * @param {{value?: object, fetchedAtMs?: number}} [args.cache] 模組層快取物件（呼叫端持有）
 * @returns {Promise<object>} status: ok｜missing｜invalid｜error；missing／invalid／error 時 LINE 全關（呼叫端 log config_missing_line_disabled）
 */
async function readConfigWithFallback({ readConfigDoc, nowMs, cache } = {}) {
  if (
    cache && cache.value && typeof cache.fetchedAtMs === "number"
    && nowMs >= cache.fetchedAtMs && nowMs - cache.fetchedAtMs < CONFIG_CACHE_MS
  ) {
    return cache.value;
  }
  let value;
  try {
    if (typeof readConfigDoc !== "function") throw new TypeError("readConfigDoc is required");
    const raw = await readConfigDoc();
    value = raw === null || raw === undefined ? buildFallbackConfig("missing") : normalizeCommentNotifyConfig(raw);
  } catch (error) {
    // 讀取失敗不快取：下一則留言再試；本則 fail-closed。
    return Object.freeze({ ...buildFallbackConfig("error"), error });
  }
  if (cache) {
    cache.value = value;
    cache.fetchedAtMs = nowMs;
  }
  return value;
}

// ─── LINE 資格預篩（計畫 §3.4 第 3 步；不扣額度） ───

const RESOLVER_SKIP_REASONS = new Set(["target_not_found", "not_bound", "category_disabled", "notification_toggle_disabled"]);

/**
 * 對每位收件人呼叫注入的 resolveLineNotificationRecipient，再套 _config。
 * @returns {Promise<{lineCandidates: string[], shadowEligible: number, skipped: Object<string, number>,
 *   resolveErrors: Array<{uid: string, error: *}>}>}
 *   shadowEligible＝解析器判定可收的人數（綁定、個人 settings.activity；source 列 forced 後不查全站開關），
 *   不管 _config，供 shadow log。全站開關由本函式套 _config 承擔。
 */
async function filterLineEligibleRecipients({ recipients, admins, config, resolveRecipient } = {}) {
  if (typeof resolveRecipient !== "function") throw new TypeError("resolveRecipient is required");
  const list = Array.isArray(recipients) ? recipients : [];
  const adminSet = new Set(Array.isArray(admins) ? admins : []);
  const lineEnabled = config?.lineEnabled === true;
  const adminLineEnabled = lineEnabled && config?.adminLineEnabled === true;
  const settled = await Promise.allSettled(list.map((uid) => resolveRecipient({
    uid,
    category: COMMENT_NOTIFY_CATEGORY,
    source: COMMENT_NOTIFY_SOURCE,
  })));
  const lineCandidates = [];
  const skipped = {};
  const resolveErrors = [];
  let shadowEligible = 0;
  const bump = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };
  settled.forEach((outcome, index) => {
    const uid = list[index];
    if (outcome.status === "rejected") {
      resolveErrors.push({ uid, error: outcome.reason });
      bump("resolve_error");
      return;
    }
    const result = outcome.value;
    if (!result || typeof result !== "object") {
      bump("resolve_error");
      return;
    }
    if (result.skipped) {
      bump(RESOLVER_SKIP_REASONS.has(result.skipped) ? result.skipped : "resolver_other");
      return;
    }
    shadowEligible += 1;
    if (!lineEnabled) {
      bump("line_disabled");
      return;
    }
    if (adminSet.has(uid) && !adminLineEnabled) {
      bump("admin_line_off");
      return;
    }
    lineCandidates.push(uid);
  });
  return { lineCandidates, shadowEligible, skipped, resolveErrors };
}

// ─── 每日上限（計畫 §3.4；_daily_ transaction 內呼叫） ───

function readCount(map, key) {
  if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return 0;
  const value = map[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

// 用 defineProperty 寫入，uid 為 "__proto__" 之類的鍵也會是自有屬性，不會改到原型。
function writeCount(map, key, value) {
  Object.defineProperty(map, key, { value, enumerable: true, writable: true, configurable: true });
}

function cloneCountMap(map) {
  const out = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const key of Object.keys(map)) {
    const count = readCount(map, key);
    if (count > 0) writeCount(out, key, count);
  }
  return out;
}

/**
 * 站內信上限與 LINE 額度在同一個 transaction 判斷。
 * - 作者當日站內信次數已達 authorInboxPerDay：整則連站內信都不寫，shouldWrite=false（零寫入）。
 * - 否則 inboxByAuthor +1（每則觸發通知的留言一次），LINE 依候選順序逐人判 global／recipient；
 *   byAuthor 整則只判一次，有人通過才 +1。LINE 全數 capped 時 LINE 計數不動，只寫 inboxByAuthor。
 * @returns {{inboxAllowed: boolean, lineRecipients: string[], lineCapped: Array<{uid: string, reason: string}>,
 *   reason: string|null, shouldWrite: boolean, nextDaily: object|null}}
 *   nextDaily 是完整文件內容（不含 expireAt）；呼叫端用 tx.set 整份寫入，不要用 update 的點號欄位路徑（uid 當 map 鍵）。
 */
function decideCommentLineCaps({ daily, authorUid, lineCandidates, caps } = {}) {
  if (!isNonEmptyString(authorUid)) throw new TypeError("authorUid is required");
  const limits = normalizeCommentNotifyCaps(caps);
  const d = daily && typeof daily === "object" ? daily : {};
  const next = {
    global: readCount(d, "global"),
    byAuthor: cloneCountMap(d.byAuthor),
    byRecipient: cloneCountMap(d.byRecipient),
    inboxByAuthor: cloneCountMap(d.inboxByAuthor),
  };
  const candidates = [...new Set((Array.isArray(lineCandidates) ? lineCandidates : []).filter(isNonEmptyString))];

  if (readCount(next.inboxByAuthor, authorUid) >= limits.authorInboxPerDay) {
    return {
      inboxAllowed: false,
      lineRecipients: [],
      lineCapped: candidates.map((uid) => ({ uid, reason: "inbox_author_capped" })),
      reason: "inbox_author_capped",
      shouldWrite: false,
      nextDaily: null,
    };
  }
  writeCount(next.inboxByAuthor, authorUid, readCount(next.inboxByAuthor, authorUid) + 1);

  const lineRecipients = [];
  const lineCapped = [];
  if (candidates.length > 0 && readCount(next.byAuthor, authorUid) >= limits.authorPerDay) {
    candidates.forEach((uid) => lineCapped.push({ uid, reason: "author_cap" }));
  } else {
    for (const uid of candidates) {
      if (next.global >= limits.globalPerDay) {
        lineCapped.push({ uid, reason: "global_cap" });
        continue;
      }
      if (readCount(next.byRecipient, uid) >= limits.recipientPerDay) {
        lineCapped.push({ uid, reason: "recipient_cap" });
        continue;
      }
      next.global += 1;
      writeCount(next.byRecipient, uid, readCount(next.byRecipient, uid) + 1);
      lineRecipients.push(uid);
    }
    if (lineRecipients.length > 0) {
      writeCount(next.byAuthor, authorUid, readCount(next.byAuthor, authorUid) + 1);
    }
  }
  return {
    inboxAllowed: true,
    lineRecipients,
    lineCapped,
    reason: candidates.length > 0 && lineRecipients.length === 0 ? "comment_cap" : null,
    shouldWrite: true,
    nextDaily: next,
  };
}

// ─── 文字淨化與文案（計畫 §3.6、§6） ───

function charClass(codes) {
  return codes.map((code) => String.fromCharCode(code)).join("");
}

function rangeCodes(from, to) {
  const out = [];
  for (let code = from; code <= to; code += 1) out.push(code);
  return out;
}

// 不可見格式字元（零寬、雙向控制、BOM、軟連字號）直接移除，避免 bit<ZWSP>.ly 這類拆字繞過與 RTL 偽裝。
// ZWJ（U+200D）保留給 emoji 組字。
const FORMAT_CHARS_RE = new RegExp(`[${charClass([
  0x00AD, 0x061C, 0x180E, 0x200B, 0x200C, 0x200E, 0x200F,
  ...rangeCodes(0x202A, 0x202E), ...rangeCodes(0x2060, 0x2064), ...rangeCodes(0x2066, 0x206F), 0xFEFF,
])}]`, "g");
// DEL 與 C1 控制字元（含 NEL）當空白處理；C0 由 stripControlChars 去掉。
const C1_CONTROL_RE = new RegExp(`[${charClass(rangeCodes(0x7F, 0x9F))}]`, "g");

const FULLWIDTH_FULL_STOP = 0xFF0E; // ．
const ALWAYS_DOT_CODES = new Set([FULLWIDTH_FULL_STOP, 0xFE52, 0x2024]); // ． ﹒ ․（NFKC 皆為 .）
const IDEOGRAPHIC_STOP_CODES = new Set([0x3002, 0xFF61]); // 。 ｡：前後緊鄰英數時才視為點號

function isFullwidthAlnum(code) {
  return (code >= 0xFF10 && code <= 0xFF19) || (code >= 0xFF21 && code <= 0xFF3A) || (code >= 0xFF41 && code <= 0xFF5A);
}

function isAsciiAlnum(code) {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A);
}

// 網址樣式（在偵測字串上比對，不分大小寫、不要求尾斜線）。
const LINK_PATTERNS = Object.freeze([
  /(?:https?|line|tel|mailto):\/\/\S+/gi,
  /\b(?:line|tel|mailto):\S+/gi,
  /\bwww\.\S+/gi,
  /\b(?:[\w.+-]+@)?(?:[\w-]+\.)+[a-z]{2,24}\b\S*/gi,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b\S*/g,
]);

/**
 * 回傳「顯示字串」與「偵測字串」（長度逐碼元相同）：
 * - 顯示：全形英數轉半形、全形點轉 .、英數之間的 。 轉 .；其餘全形標點保留（中文排版不變）。
 * - 偵測：再把所有全形 ASCII（含 ：／）轉半形，供網址比對。
 * 只動 BMP 單碼元字元，emoji 等代理對原樣保留，兩字串索引對齊。
 */
function foldForLinkDetection(text) {
  const display = [];
  const detect = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (ALWAYS_DOT_CODES.has(code)) {
      display.push(".");
      detect.push(".");
    } else if (code >= 0xFF01 && code <= 0xFF5E) {
      const ascii = String.fromCharCode(code - 0xFEE0);
      display.push(isFullwidthAlnum(code) ? ascii : text[i]);
      detect.push(ascii);
    } else {
      display.push(text[i]);
      detect.push(text[i]);
    }
  }
  for (let i = 1; i < text.length - 1; i += 1) {
    if (
      IDEOGRAPHIC_STOP_CODES.has(text.charCodeAt(i))
      && isAsciiAlnum(detect[i - 1].charCodeAt(0))
      && isAsciiAlnum(detect[i + 1].charCodeAt(0))
    ) {
      display[i] = ".";
      detect[i] = ".";
    }
  }
  return { display: display.join(""), detect: detect.join("") };
}

function findLinkSpans(detect) {
  const spans = [];
  for (const pattern of LINK_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(detect)) !== null) {
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      spans.push([match.index, match.index + match[0].length]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  return merged;
}

function splitGraphemes(text) {
  if (typeof Intl === "object" && typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter("zh-Hant", { granularity: "grapheme" }).segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

/**
 * 壓平換行與空白、網址換成〔連結〕、依字元截斷（不切半 emoji，也不切開〔連結〕）。
 * 超過 maxChars 時保留前 maxChars 字並加「…」。
 */
function sanitizeCommentText(value, maxChars) {
  if (typeof value !== "string") return "";
  const flattened = stripControlChars(value)
    .replace(FORMAT_CHARS_RE, "")
    .replace(C1_CONTROL_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flattened) return "";
  const { display, detect } = foldForLinkDetection(flattened);
  // 片段：一般文字逐字、〔連結〕整塊（計 4 字、不可切開）。
  const units = [];
  let cursor = 0;
  for (const [start, end] of findLinkSpans(detect)) {
    splitGraphemes(display.slice(cursor, start)).forEach((ch) => units.push({ text: ch, size: 1 }));
    units.push({ text: LINK_PLACEHOLDER, size: LINK_PLACEHOLDER.length });
    cursor = end;
  }
  splitGraphemes(display.slice(cursor)).forEach((ch) => units.push({ text: ch, size: 1 }));

  const limit = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : Infinity;
  let used = 0;
  let out = "";
  for (let i = 0; i < units.length; i += 1) {
    if (used + units[i].size > limit) return `${out.trimEnd()}${ELLIPSIS}`;
    out += units[i].text;
    used += units[i].size;
  }
  return out;
}

/**
 * LINE（`${title}\n${body}`）與站內信 title／body 共用。私密留言一律單則（不合併，故沒有公開／私密混合的批次）。
 */
function buildCommentNotifyMessages({ eventTitle, authorName, body, isPrivate, batchCount } = {}) {
  const title = `【活動留言】${sanitizeCommentText(eventTitle, TEXT_LIMITS.eventTitle) || FALLBACK_EVENT_TITLE}`;
  const name = sanitizeCommentText(authorName, TEXT_LIMITS.authorName) || FALLBACK_AUTHOR_NAME;
  const snippet = sanitizeCommentText(body, TEXT_LIMITS.body);
  const count = Number.isInteger(batchCount) && batchCount > 1 ? batchCount : 1;
  let text;
  if (isPrivate) text = `${name}（私密）：${snippet}`;
  else if (count > 1) text = `新增 ${count} 則留言，最新 ${name}：${snippet}`;
  else text = `${name}：${snippet}`;
  return { title, body: text };
}

// ─── 觸發器 handler（批 1；index.js 只接線） ───

const DAY_MS = 24 * 60 * 60 * 1000;
const STATE_EXPIRE_AFTER_END_MS = 7 * DAY_MS;
const DAILY_EXPIRE_MS = 3 * DAY_MS;
const LOG_LABEL = "[onEventCommentCreated]";

function requireDependencies(deps, names) {
  for (const name of names) {
    if (!deps || deps[name] === undefined || deps[name] === null) throw new TypeError(`${name} is required`);
  }
}

function isAlreadyExists(error) {
  return error?.code === 6 || error?.code === "already-exists" || /ALREADY_EXISTS/.test(String(error?.message));
}

// log 用：只留錯誤碼與截短訊息，不帶 uid 原值或留言內文。
function describeError(error) {
  return {
    code: String(error?.code ?? "unknown").slice(0, 80),
    message: String(error?.message ?? error ?? "unknown").slice(0, 200),
  };
}

function countBy(list, keyOf) {
  const out = {};
  for (const item of list) {
    const key = keyOf(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

/**
 * onEventCommentCreated（events/{eventId}/comments/{commentId}）的 handler。
 * 順序（計畫 v3 §3.1～§3.5）：_config → 留言前置過濾 → 活動前置過濾 → 收件人（含 Q6）→ 狀態 transaction（視窗）
 * → LINE 資格預篩 → _daily_ transaction（站內信上限＋LINE 額度）→ 投遞（allSettled）。
 * 每次觸發只寫一行結構化 log（uid 一律遮罩、不印內文）；投遞失敗只記錄不拋（R-CF-003），
 * 主流程意外錯誤記錄後重拋（R-CF-002；觸發器不設 retry，不會重送）。
 */
function createOnEventCommentCreatedHandler(deps) {
  requireDependencies(deps, [
    "db", "FieldValue", "logger", "enqueueLineFromServer", "resolveLineNotificationRecipient",
    "parseEventEndDateInTaipei", "getAuthUidFromUserDoc", "maskUid",
  ]);
  const {
    db, FieldValue, logger, enqueueLineFromServer, resolveLineNotificationRecipient,
    parseEventEndDateInTaipei, getAuthUidFromUserDoc, maskUid,
  } = deps;
  const now = typeof deps.now === "function" ? deps.now : Date.now;
  const configCache = {};
  const collection = () => db.collection(COMMENT_NOTIFY_COLLECTION);

  return async function onEventCommentCreated(event) {
    const eventDocId = event?.params?.eventId;
    const commentId = event?.params?.commentId;
    const log = { eventDocId: maskUid(eventDocId), commentId: maskUid(commentId) };
    const finish = (outcome, extra = {}) => {
      Object.assign(log, { outcome }, extra);
      const degraded = Boolean(
        log.inbox?.failed
        || (log.line && Object.keys(log.line.failed).length)
        || log.capsTxFailed
        || log.resolveErrors
        || log.configError,
      );
      (degraded ? logger.warn : logger.info)(LOG_LABEL, log);
    };

    try {
      const snap = event?.data;
      if (!snap || typeof snap.data !== "function") return finish("skip", { skipReason: "no_snapshot" });

      const config = await readConfigWithFallback({
        readConfigDoc: async () => {
          const configSnap = await collection().doc(COMMENT_NOTIFY_CONFIG_DOC_ID).get();
          return configSnap.exists ? configSnap.data() : null;
        },
        nowMs: now(),
        cache: configCache,
      });
      log.configStatus = config.status;
      if (config.status !== "ok") log.configNote = "config_missing_line_disabled";
      if (config.error) log.configError = describeError(config.error);
      if (!config.enabled) return finish("skip", { skipReason: "disabled" });

      const comment = snap.data();
      const commentCheck = precheckComment(comment);
      if (!commentCheck.ok) return finish("skip", { skipReason: commentCheck.reason });
      const isPrivate = commentCheck.isPrivate;
      log.kind = isPrivate ? "private" : "public";

      // 視窗與每日鍵用留言 createdAt（Rules 強制等於 request.time，重送時基準不變）；缺值才用觸發當下時間。
      const createdAtFromDoc = timestampToMs(comment.createdAt);
      const createdAtMs = createdAtFromDoc ?? now();
      if (createdAtFromDoc === null) log.nowSource = "trigger_time";

      const keys = buildCommentNotifyKeys({ eventDocId, commentId, nowMs: createdAtMs });
      if (!keys.stateDocId) return finish("skip", { skipReason: "reserved_event_doc_id" });

      const eventSnap = await db.collection("events").doc(eventDocId).get();
      const eventData = eventSnap.exists ? eventSnap.data() : null;
      const eventCheck = precheckCommentEvent({ eventData, commentCreatedAtMs: createdAtMs, parseEventEndDateInTaipei });
      if (!eventCheck.ok) return finish("skip", { skipReason: eventCheck.reason });

      // 管理員不快取（降級者不殘留；管理員 2 人，每次 2 讀）。
      const adminSnap = await db.collection("users").where("role", "in", ["admin", "super_admin"]).get();
      const adminEntries = adminSnap.docs.map((doc) => ({
        docId: doc.id,
        uid: getAuthUidFromUserDoc({ docId: doc.id, data: doc.data() || {} }, doc.id),
      }));
      const resolved = resolveCommentNotifyRecipients({ eventData, authorUid: comment.authorUid, adminEntries });
      Object.assign(log, {
        recipients: resolved.recipients.length,
        managers: resolved.managers.length,
        admins: resolved.admins.length,
        adminDocIdMismatch: resolved.adminDocIdMismatch,
        recipientsCapped: resolved.recipientsCapped,
        undeliverable: resolved.undeliverable,
      });
      // Q6：管理者自己留言整則不通知、不寫狀態（不佔視窗）。
      if (resolved.skip) return finish("skip", { skipReason: resolved.skip });
      if (resolved.recipients.length === 0) return finish("skip", { skipReason: "no_recipients" });

      // 狀態文件 expireAt：活動結束＋7 天；活動沒有可判讀的結束時間時用留言時間＋7 天（TTL policy 不在本案，只預留欄位）。
      const stateExpireAtMs = (eventCheck.endMs ?? createdAtMs) + STATE_EXPIRE_AFTER_END_MS;
      const stateRef = collection().doc(keys.stateDocId);
      const decision = await db.runTransaction(async (tx) => {
        const stateSnap = await tx.get(stateRef);
        const result = decideCommentNotify({
          state: stateSnap.exists ? stateSnap.data() : null,
          nowMs: createdAtMs,
          commentId,
          isPrivate,
        });
        if (result.nextState) {
          tx.set(stateRef, {
            ...result.nextState,
            updatedAt: FieldValue.serverTimestamp(),
            expireAt: new Date(stateExpireAtMs),
          });
        }
        return result;
      });
      log.action = decision.action;
      if (decision.action === "skip_duplicate") return finish("skip", { skipReason: "duplicate" });
      if (decision.action === "accumulate") return finish("accumulate");
      log.batchCount = decision.batchCount;

      // LINE 資格預篩（不扣額度）；shadowEligible 不管 _config，供升級前 shadow 回報。
      const eligibility = await filterLineEligibleRecipients({
        recipients: resolved.recipients,
        admins: resolved.admins,
        config,
        resolveRecipient: resolveLineNotificationRecipient,
      });
      log.shadowEligible = eligibility.shadowEligible;
      log.lineSkipped = eligibility.skipped;
      if (eligibility.resolveErrors.length) {
        log.resolveErrors = eligibility.resolveErrors.slice(0, 5).map(({ uid, error }) => ({
          uid: maskUid(uid), ...describeError(error),
        }));
      }

      const dailyRef = collection().doc(keys.dailyDocId);
      let caps;
      try {
        caps = await db.runTransaction(async (tx) => {
          const dailySnap = await tx.get(dailyRef);
          const result = decideCommentLineCaps({
            daily: dailySnap.exists ? dailySnap.data() : null,
            authorUid: comment.authorUid,
            lineCandidates: eligibility.lineCandidates,
            caps: config.caps,
          });
          // 整份 set（uid 是 map 鍵，不用 update 的點號路徑）；shouldWrite=false 時完全不寫。
          if (result.shouldWrite) {
            tx.set(dailyRef, {
              ...result.nextDaily,
              updatedAt: FieldValue.serverTimestamp(),
              expireAt: new Date(createdAtMs + DAILY_EXPIRE_MS),
            });
          }
          return result;
        });
      } catch (error) {
        // fail-closed：本次不發 LINE；站內信照寫（§3.4 第 5 步），但這則不會計入 inboxByAuthor（log capsTxFailed 可查）。
        log.capsTxFailed = describeError(error);
        caps = {
          inboxAllowed: true,
          lineRecipients: [],
          lineCapped: eligibility.lineCandidates.map((uid) => ({ uid, reason: "comment_cap_tx_failed" })),
          reason: "comment_cap_tx_failed",
        };
      }
      if (caps.lineCapped.length) log.lineCapped = countBy(caps.lineCapped, (item) => item.reason);
      if (caps.reason) log.capReason = caps.reason;
      if (!caps.inboxAllowed) return finish("skip", { skipReason: "inbox_author_capped" });

      const messages = buildCommentNotifyMessages({
        eventTitle: eventData.title,
        authorName: comment.authorName,
        body: comment.body,
        isPrivate,
        batchCount: decision.batchCount,
      });
      const inboxDoc = buildInboxMessageDoc({
        id: keys.inboxMessageId,
        title: messages.title,
        body: messages.body,
        type: "activity",
        typeName: "活動",
        time: formatTaipeiDateTime(now()),
        senderName: "系統",
        fromUid: "system",
        actionType: "event_comment",
        // 必須是 null：'pending' 會讓 B 當成待審核（Opus P2-2）。
        actionStatus: null,
        meta: {
          eventDocId,
          eventId: typeof eventData.id === "string" && eventData.id ? eventData.id : eventDocId,
          commentId,
          eventTitle: typeof eventData.title === "string" ? eventData.title.slice(0, 100) : "",
        },
      }, { createdAt: FieldValue.serverTimestamp() });

      // 只寫 users/{uid}/inbox：舊路徑 messages/{auto} 的 recipientUid 查無 A 前端與 Rules 讀取者（同 team-join-review）。
      const inboxOps = resolved.recipients.map(async (uid) => {
        try {
          await db.collection("users").doc(uid).collection("inbox").doc(keys.inboxMessageId).create(inboxDoc);
          return "written";
        } catch (error) {
          if (isAlreadyExists(error)) return "duplicate";
          throw error;
        }
      });
      // requestedByRole 'admin' 是刻意的：改 'system' 會落到 user 池、所有留言共用 system 呼叫者 100/日上限（Opus P3-5）。
      // 走 staff 池不受 targetPerDay 12；濫用由 _daily_ 上限承擔；source 足以追查。
      const lineOps = caps.lineRecipients.map((uid) => enqueueLineFromServer({
        uid,
        title: messages.title,
        body: messages.body,
        category: COMMENT_NOTIFY_CATEGORY,
        source: COMMENT_NOTIFY_SOURCE,
        dedupeKey: keys.dedupeKey,
        requestedByUid: "system",
        requestedByRole: "admin",
      }));
      const [inboxResults, lineResults] = await Promise.all([
        Promise.allSettled(inboxOps),
        Promise.allSettled(lineOps),
      ]);

      log.inbox = { written: 0, duplicate: 0, failed: 0 };
      inboxResults.forEach((outcome) => {
        if (outcome.status === "fulfilled") {
          log.inbox[outcome.value] += 1;
        } else {
          log.inbox.failed += 1;
          if (!log.inboxError) log.inboxError = describeError(outcome.reason);
        }
      });
      log.line = { queued: 0, skipped: {}, failed: {} };
      lineResults.forEach((outcome) => {
        if (outcome.status === "rejected") {
          const detail = describeError(outcome.reason);
          const key = /RATE_LIMITED/.test(detail.message) ? "rate_limited" : detail.code;
          log.line.failed[key] = (log.line.failed[key] || 0) + 1;
        } else if (outcome.value?.queued) {
          log.line.queued += 1;
        } else {
          const reason = String(outcome.value?.reason || "unknown");
          log.line.skipped[reason] = (log.line.skipped[reason] || 0) + 1;
        }
      });
      return finish("sent");
    } catch (error) {
      Object.assign(log, { outcome: "error", error: describeError(error) });
      logger.error(LOG_LABEL, log);
      throw error;
    }
  };
}

module.exports = {
  createOnEventCommentCreatedHandler,
  COMMENT_NOTIFY_COLLECTION,
  COMMENT_NOTIFY_CONFIG_DOC_ID,
  COMMENT_NOTIFY_DAILY_PREFIX,
  COMMENT_NOTIFY_FORCED_SOURCE_PREFIX,
  COMMENT_NOTIFY_SOURCE,
  COMMENT_NOTIFY_CATEGORY,
  COMMENT_NOTIFY_WINDOW_MS,
  RECENT_COMMENT_IDS_MAX,
  MAX_RECIPIENTS,
  CONFIG_CACHE_MS,
  DEFAULT_AUTHOR_INBOX_PER_DAY,
  LINK_PLACEHOLDER,
  TEXT_LIMITS,
  resolveCommentNotifyRecipients,
  precheckComment,
  precheckCommentEvent,
  buildCommentNotifyKeys,
  decideCommentNotify,
  normalizeCommentNotifyConfig,
  readConfigWithFallback,
  filterLineEligibleRecipients,
  decideCommentLineCaps,
  sanitizeCommentText,
  buildCommentNotifyMessages,
};
