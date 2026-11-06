"use strict";

// 放鴿子／出席率 v2 純函式（設計：docs/specs/lite-convergence/noshow-attendance-redesign.md §2.2、§2.3）。
// 個人重算（user-attendance-stats-core）、旗標觸發器與回填腳本都只呼叫這裡，規則只有這一份。
// 每小時 batch（calcNoShowCountsBatch）不算 v2、不使用本模組（設計 §2.4：B 名單改讀 userAttendanceStats）。
// 舊欄位（noShowCount／expectedCount 等）的算法不在這裡，維持原樣。

// 起算點（台北日期，補零 YYYY-MM-DD）。佔位值；部署前改成部署隔天。
const NOSHOW_V2_SINCE = "2026-11-08";
const ATTENDANCE_FLAG_COLLECTION = "eventAttendanceFlags";
const TAIPEI_OFFSET_HOURS = 8;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function isCompanionRecord(record) {
  return !!(record && (record.companionId || text(record.participantType) === "companion"));
}

function isActiveAttendanceRecord(record) {
  const status = text(record?.status);
  return status !== "removed" && status !== "cancelled";
}

function validCalendarParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function parseEventDateParts(raw) {
  const value = text(raw);
  const match = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?=$|\s)/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!validCalendarParts(year, month, day)) return null;
  let hours = 0;
  let minutes = 0;
  const timeMatch = value.slice(match[0].length).trim().match(/^(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const h = Number(timeMatch[1]);
    const m = Number(timeMatch[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      hours = h;
      minutes = m;
    }
  }
  return { year, month, day, hours, minutes };
}

// 「YYYY/M/D HH:mm~…」「YYYY-MM-DD」等 → 補零 YYYY-MM-DD；解析失敗回 null。
function normalizeEventDateKey(raw) {
  const parts = parseEventDateParts(raw);
  if (!parts) return null;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

// 活動開始時間（台北）毫秒；沒寫時間視為當天 00:00；日期解析失敗回 null。
function eventStartMillis(raw) {
  const parts = parseEventDateParts(raw);
  if (!parts) return null;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hours - TAIPEI_OFFSET_HOURS, parts.minutes);
}

function valueToMillis(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value.toMillis === "function") {
    try { return value.toMillis(); } catch (_) { return null; }
  }
  if (typeof value.toDate === "function") {
    try { return value.toDate().getTime(); } catch (_) { return null; }
  }
  const seconds = value.seconds ?? value._seconds;
  if (typeof seconds === "number") {
    const nanos = value.nanoseconds ?? value._nanoseconds ?? 0;
    return seconds * 1000 + Math.floor(nanos / 1e6);
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isOnOrAfterSince(dateKey, since = NOSHOW_V2_SINCE) {
  return !!dateKey && !!since && dateKey >= since;
}

function recordMatchesEvent(record, event) {
  const eventId = text(record?.eventId);
  if (!eventId || !event) return false;
  return eventId === text(event.id) || eventId === text(event._docId);
}

function eventHostUids(event) {
  const uids = new Set();
  const creatorUid = text(event?.creatorUid);
  if (creatorUid) uids.add(creatorUid);
  (Array.isArray(event?.delegateUids) ? event.delegateUids : []).forEach((uid) => {
    const value = text(uid);
    if (value) uids.add(value);
  });
  return uids;
}

// 旗標 hasCountedCheckout：該場是否有「有效簽退」。
// 有效簽退＝type checkout、status 非 removed／cancelled、非同行者、eventId 等於 data.id 或 docId、
// uid（不退 userId）是該場正取非同行者報名者，且不是主辦 creatorUid／委託人 delegateUids。
// registrations／attendanceRecords 傳該場子集合的資料；event 需含 id、_docId、creatorUid、delegateUids。
function computeEventCountedCheckoutFlag({ event, registrations, attendanceRecords } = {}) {
  if (!event) return false;
  const hosts = eventHostUids(event);
  const confirmedUids = new Set();
  (Array.isArray(registrations) ? registrations : []).forEach((reg) => {
    if (!reg || isCompanionRecord(reg)) return;
    if (text(reg.status) !== "confirmed") return;
    const uid = text(reg.userId);
    if (uid && !hosts.has(uid)) confirmedUids.add(uid);
  });
  if (!confirmedUids.size) return false;
  return (Array.isArray(attendanceRecords) ? attendanceRecords : []).some((record) => (
    record
    && text(record.type) === "checkout"
    && isActiveAttendanceRecord(record)
    && !isCompanionRecord(record)
    && recordMatchesEvent(record, event)
    && confirmedUids.has(text(record.uid))
  ));
}

// 計入場次＝status ended、開始日（正規化）≥ 起算點、旗標為 true。
function isCountedEvent(event, flag, since = NOSHOW_V2_SINCE) {
  if (!event || text(event.status) !== "ended") return false;
  if (flag !== true) return false;
  return isOnOrAfterSince(normalizeEventDateKey(event.date), since);
}

// 候補遞補：promotedAt 晚於活動開始時間 → 該場不計入本人。
function isLatePromotion(registration, event) {
  const promotedMs = valueToMillis(registration?.promotedAt);
  if (promotedMs == null) return false;
  const startMs = eventStartMillis(event?.date);
  if (startMs == null) return false;
  return promotedMs > startMs;
}

/**
 * 單一使用者的 v2 計入統計。兩條流程都呼叫這個函式。
 * @param {object} input
 * @param {string} input.uid
 * @param {Array<{event: object, registration: object|null}>} input.participations
 *   已結束、本人正取（非同行者）的場次；event 需含 id、_docId、status、date；registration 是本人的正取報名（legacy 無報名時為 null）。
 * @param {Map<string, boolean>} input.flagsByEventDocId 旗標（key＝eventDocId；沒有＝false）
 * @param {Array<object>} input.attendanceRecords 本人的簽到簽退（可含別人的，會依 uid 濾掉）
 * @param {string} [input.since]
 */
function computeUserCountedStats({
  uid,
  participations,
  flagsByEventDocId,
  attendanceRecords,
  since = NOSHOW_V2_SINCE,
} = {}) {
  const safeUid = text(uid);
  const flags = flagsByEventDocId instanceof Map ? flagsByEventDocId : new Map();
  const ownRecords = (Array.isArray(attendanceRecords) ? attendanceRecords : []).filter((record) => (
    record
    && text(record.uid) === safeUid
    && isActiveAttendanceRecord(record)
    && !isCompanionRecord(record)
  ));

  const result = {
    participatedCount: 0,
    countedCount: 0,
    countedCompletedCount: 0,
    countedIncompleteCount: 0,
    countedNoShowCount: 0,
    countedSince: since,
    lastWasNoShow: false,
  };
  if (!safeUid) return result;

  const seen = new Set();
  let latest = null;
  (Array.isArray(participations) ? participations : []).forEach(({ event, registration } = {}) => {
    const eventKey = text(event?._docId || event?.id);
    if (!eventKey || seen.has(eventKey)) return;
    seen.add(eventKey);
    result.participatedCount += 1;
    if (!isCountedEvent(event, flags.get(text(event._docId)) === true, since)) return;
    if (registration && isLatePromotion(registration, event)) return;

    let hasCheckin = false;
    let hasCheckout = false;
    ownRecords.forEach((record) => {
      if (!recordMatchesEvent(record, event)) return;
      const type = text(record.type);
      if (type === "checkin") hasCheckin = true;
      if (type === "checkout") hasCheckout = true;
    });

    result.countedCount += 1;
    const noShow = !hasCheckin && !hasCheckout;
    if (hasCheckout) result.countedCompletedCount += 1;
    else if (hasCheckin) result.countedIncompleteCount += 1;
    else result.countedNoShowCount += 1;

    const startMs = eventStartMillis(event.date);
    if (!latest || startMs > latest.startMs || (startMs === latest.startMs && eventKey > latest.eventKey)) {
      latest = { startMs, eventKey, noShow };
    }
  });
  result.lastWasNoShow = !!latest?.noShow;
  return result;
}

module.exports = {
  ATTENDANCE_FLAG_COLLECTION,
  NOSHOW_V2_SINCE,
  computeEventCountedCheckoutFlag,
  computeUserCountedStats,
  eventHostUids,
  eventStartMillis,
  isActiveAttendanceRecord,
  isCompanionRecord,
  isCountedEvent,
  isLatePromotion,
  isOnOrAfterSince,
  normalizeEventDateKey,
  recordMatchesEvent,
  valueToMillis,
};
