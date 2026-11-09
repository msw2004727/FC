"use strict";

// 營運儀表板每日彙總的純函式。不讀寫 Firestore。
// 出席計入規則只呼叫 noshow-v2-core；不使用 ops-ltv-report 的放鴿子計算。
// 外部活動（type=external）不計舉辦、填滿率、報名人次、出席與參與索引；A2 卡住清單仍可列。
// QA 主辦（creatorUid 符合 QA_UID_RE）整場排除，含卡住清單。

const {
  NOSHOW_V2_SINCE,
  eventStartMillis,
  isActiveAttendanceRecord,
  isCompanionRecord,
  isCountedEvent,
  isLatePromotion,
  normalizeEventDateKey,
  recordMatchesEvent,
  valueToMillis,
} = require("./noshow-v2-core");
const { QA_UID_RE } = require("./qa-test-mode-core");
const { addDaysKey, msToTaipeiDateKey } = require("./ops-ltv-report");

const SCHEMA_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const LOW_FILL_CAP = 40;
const LOW_FILL_HORIZON_MS = 96 * 60 * 60 * 1000;
const LOW_FILL_MAX_RATIO = 0.5;
const STUCK_GRACE_MS = 60 * 60 * 1000;
const HOST_NOSHOW_MIN_COUNTED = 20;
const HOST_NOSHOW_MIN_RATE = 0.15;
const HOST_NOSHOW_SITE_MULTIPLE = 2;
const COST_HIGH_RATIO = 1.2;
const TOP_LIMIT = 10;
const TREND_DAILY_DAYS = 90;
const TREND_MONTHS = 13;
const SUMMARY_LOOKBACK_DAYS = 730;
const PERIODS = [
  { key: "d7", days: 7, snapshot: "d7" },
  { key: "d30", days: 30, snapshot: "d30" },
  { key: "d90", days: 90, snapshot: "d90" },
  { key: "m12", days: 365, snapshot: "d365" },
];

function text(value) {
  return String(value == null ? "" : value).trim();
}

function isQaUid(uid) {
  return QA_UID_RE.test(text(uid));
}

function isDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateKeyToDocId(dateKey) {
  return isDateKey(dateKey) ? dateKey.replace(/-/g, "") : "";
}

function docIdToDateKey(docId) {
  const match = String(docId || "").match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return "";
  const key = `${match[1]}-${match[2]}-${match[3]}`;
  return isDateKey(key) ? key : "";
}

function taipeiStartMs(dateKey) {
  if (!isDateKey(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day) - TAIPEI_OFFSET_MS;
}

function resolveTodayKey(nowMs) {
  return msToTaipeiDateKey(nowMs);
}

function resolveAsOf(nowMs) {
  return addDaysKey(resolveTodayKey(nowMs), -1);
}

function enumerateDateKeys(startKey, endKey) {
  if (!isDateKey(startKey) || !isDateKey(endKey) || startKey > endKey) return [];
  const keys = [];
  let current = startKey;
  while (current && current <= endKey && keys.length <= 800) {
    keys.push(current);
    current = addDaysKey(current, 1);
  }
  return keys;
}

function periodWindow(asOf, days) {
  const end = asOf;
  const start = addDaysKey(asOf, -(days - 1));
  const prevEnd = addDaysKey(asOf, -days);
  const prevStart = addDaysKey(prevEnd, -(days - 1));
  return { start, end, prevStart, prevEnd };
}

function lookupList(map, id) {
  if (!map) return [];
  const value = map instanceof Map ? map.get(id) : map[id];
  return Array.isArray(value) ? value : [];
}

function lookupFlag(map, id) {
  if (!map) return false;
  const value = map instanceof Map ? map.get(id) : map[id];
  if (value === true) return true;
  return !!(value && value.hasCountedCheckout === true);
}

function getDaily(dailyByDate, dateKey) {
  if (!dailyByDate) return null;
  const value = dailyByDate instanceof Map ? dailyByDate.get(dateKey) : dailyByDate[dateKey];
  return value || null;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function daysInMonth(dateKey) {
  const [year, month] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function lastDayKeyOfMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return `${monthKey}-${pad2(daysInMonth(`${year}-${pad2(month)}-01`))}`;
}

function monthKeysEndingAt(asOf, count) {
  let [year, month] = asOf.split("-").map(Number);
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    keys.push(`${year}-${pad2(month)}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return keys.reverse();
}

function snapshotDayForMonth(monthKey, asOf) {
  const last = lastDayKeyOfMonth(monthKey);
  return last < asOf ? last : asOf;
}

// 沒有時區的日期字串一律當台北時間。Timestamp／epoch ms 走 valueToMillis。
function userInstantMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const raw = value.trim();
    const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
    const match = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match && !hasZone) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const hours = match[4] == null ? 0 : Number(match[4]);
      const minutes = match[5] == null ? 0 : Number(match[5]);
      const seconds = match[6] == null ? 0 : Number(match[6]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && hours <= 23 && minutes <= 59 && seconds <= 59) {
        return Date.UTC(year, month - 1, day, hours - 8, minutes, seconds);
      }
    }
  }
  const ms = valueToMillis(value);
  return ms == null ? null : ms;
}

// createdAt 無法解析時才退回 joinDate。兩者都沒有回空字串。
function userCreatedDateKey(user) {
  if (!user) return "";
  if (user.createdAt != null && user.createdAt !== "") {
    const createdMs = userInstantMs(user.createdAt);
    if (createdMs != null) return msToTaipeiDateKey(createdMs);
  }
  if (user.joinDate != null && user.joinDate !== "") {
    const joinMs = userInstantMs(user.joinDate);
    if (joinMs != null) return msToTaipeiDateKey(joinMs);
  }
  return "";
}

function maxCountOf(event) {
  const max = Number(event?.max);
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}

// 不重算報名名單。有 realCurrent 時加未用完的保留席；只有 current 時沿用（current 已含保留席）。
function reservedRemainingSlots(event) {
  const list = Array.isArray(event?.teamReservationSummaries) ? event.teamReservationSummaries : [];
  return list.reduce((sum, item) => {
    if (!item || typeof item !== "object") return sum;
    if (item.remainingSlots != null && item.remainingSlots !== "") {
      const remaining = Number(item.remainingSlots);
      return sum + (Number.isFinite(remaining) ? Math.max(0, remaining) : 0);
    }
    const reserved = Math.max(0, Number(item.reservedSlots) || 0);
    const used = Math.max(0, Number(item.usedSlots) || 0);
    return sum + Math.max(0, reserved - used);
  }, 0);
}

function occupiedCountFromEvent(event) {
  const real = Number(event?.realCurrent);
  if (Number.isFinite(real)) return Math.max(0, real) + reservedRemainingSlots(event);
  const current = Number(event?.current);
  if (Number.isFinite(current)) return Math.max(0, current);
  return 0;
}

function recordBelongsToEvent(record, event) {
  const eventId = text(record?.eventId);
  if (!eventId) return false;
  return recordMatchesEvent(record, event);
}

function classifyEvent(event) {
  if (!event || isQaUid(event.creatorUid)) return { bucket: "qaHost" };
  const dateKey = normalizeEventDateKey(event.date);
  if (!dateKey) return { bucket: "unparsable" };
  const status = text(event.status);
  if (status === "cancelled") return { bucket: "cancelled", dateKey };
  if (text(event.type) === "external") return { bucket: "external", dateKey };
  if (status === "ended") return { bucket: "held", dateKey };
  return { bucket: "other", dateKey };
}

function countUnparsableEvents(events) {
  const ids = new Set();
  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!event || isQaUid(event.creatorUid)) return;
    if (normalizeEventDateKey(event.date)) return;
    ids.add(text(event._docId || event.id) || `anon-${ids.size}`);
  });
  return ids.size;
}

// 與 functions/index.js parseEventEndDateInTaipei 同一判斷（斜線日期、結束時間、跨日 +24h）。
function parseEventStartDateInTaipei(dateStr) {
  if (typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  const [rawDatePart = "", rawTimePart = ""] = trimmed.split(/\s+/, 2);
  const dateParts = rawDatePart.split("/").map((part) => Number(part));
  if (dateParts.length < 3 || dateParts.some((part) => !Number.isFinite(part))) return null;
  const [year, month, day] = dateParts;
  let hours = 0;
  let minutes = 0;
  if (rawTimePart) {
    const startTimePart = rawTimePart.split("~")[0];
    const timeParts = startTimePart.split(":").map((part) => Number(part));
    if (timeParts.length >= 2 && Number.isFinite(timeParts[0]) && Number.isFinite(timeParts[1])) {
      hours = timeParts[0];
      minutes = timeParts[1];
    }
  }
  if (![year, month, day, hours, minutes].every(Number.isInteger)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day, hours - 8, minutes, 0, 0));
}

function parseEventEndDateInTaipei(dateStr) {
  if (typeof dateStr !== "string") return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  const [rawDatePart = "", rawTimePart = ""] = trimmed.split(/\s+/, 2);
  const dateParts = rawDatePart.split("/").map((part) => Number(part));
  if (dateParts.length < 3 || dateParts.some((part) => !Number.isFinite(part))) return null;
  const [year, month, day] = dateParts;
  let hours = 23;
  let minutes = 59;
  if (rawTimePart) {
    const endTimePart = rawTimePart.includes("~") ? rawTimePart.split("~")[1] : rawTimePart.split("~")[0];
    const timeParts = String(endTimePart || "").split(":").map((part) => Number(part));
    if (timeParts.length >= 2 && Number.isFinite(timeParts[0]) && Number.isFinite(timeParts[1])) {
      hours = timeParts[0];
      minutes = timeParts[1];
    } else {
      return parseEventStartDateInTaipei(dateStr);
    }
  }
  if (![year, month, day, hours, minutes].every(Number.isInteger)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  const startDate = parseEventStartDateInTaipei(dateStr);
  let endDate = new Date(Date.UTC(year, month - 1, day, hours - 8, minutes, 0, 0));
  if (startDate && endDate.getTime() < startDate.getTime()) {
    endDate = new Date(endDate.getTime() + DAY_MS);
  }
  return endDate;
}

function isStuckEvent(event, nowMs) {
  const status = text(event?.status);
  if (!["open", "full", "upcoming"].includes(status)) return false;
  if (isQaUid(event?.creatorUid)) return false;
  const end = parseEventEndDateInTaipei(event?.date);
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) return true;
  return end.getTime() <= Number(nowMs) - STUCK_GRACE_MS;
}

function attendanceStateForEvent(event, records) {
  const byUid = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    if (!record || !isActiveAttendanceRecord(record) || isCompanionRecord(record)) return;
    if (!recordBelongsToEvent(record, event)) return;
    const uid = text(record.uid);
    if (!uid || isQaUid(uid)) return;
    const type = text(record.type);
    if (type !== "checkin" && type !== "checkout") return;
    const state = byUid.get(uid) || { checkin: false, checkout: false };
    state[type] = true;
    byUid.set(uid, state);
  });
  return byUid;
}

function summarizeHeldEvent(event, registrations, attendanceRecords, flag, since) {
  const attendanceByUid = attendanceStateForEvent(event, attendanceRecords);
  const seen = new Set();
  let companions = 0;
  let confirmed = 0;
  let counted = 0;
  let completed = 0;
  let incomplete = 0;
  let noShow = 0;
  let legacyAttended = 0;
  const countedEvent = isCountedEvent(event, flag === true, since);
  (Array.isArray(registrations) ? registrations : []).forEach((reg) => {
    if (!reg || !recordBelongsToEvent(reg, event)) return;
    if (isCompanionRecord(reg)) {
      companions += 1;
      return;
    }
    if (text(reg.status) !== "confirmed") return;
    const uid = text(reg.userId);
    if (!uid || isQaUid(uid) || seen.has(uid)) return;
    seen.add(uid);
    confirmed += 1;
    const state = attendanceByUid.get(uid);
    if (state && state.checkin) legacyAttended += 1;
    if (!countedEvent || isLatePromotion(reg, event)) return;
    counted += 1;
    if (state && state.checkout) completed += 1;
    else if (state && state.checkin) incomplete += 1;
    else noShow += 1;
  });
  const checkedInUids = [...attendanceByUid.entries()]
    .filter(([, state]) => state.checkin)
    .map(([uid]) => uid)
    .sort();
  return {
    companions,
    confirmed,
    counted,
    completed,
    incomplete,
    noShow,
    legacyAttended,
    countedEvent: countedEvent ? 1 : 0,
    checkedInUids,
    brief: {
      docId: text(event._docId || event.id),
      id: text(event.id || event._docId),
      title: text(event.title),
      creatorUid: text(event.creatorUid),
      creator: text(event.creator),
      sportTag: text(event.sportTag || event.sport),
      type: text(event.type),
      max: maxCountOf(event),
      occupied: occupiedCountFromEvent(event),
      confirmed,
      counted,
      completed,
      noShow,
    },
  };
}

function emptyUsers() {
  return {
    newUsers: 0,
    activeSnapshot: null,
    totalUsers: null,
    qaUsers: null,
    unknownCreated: 0,
  };
}

function buildDayDocs({
  dateKey,
  events,
  registrationsByDocId,
  attendanceByDocId,
  flagsByDocId,
  userFacts,
  asOf,
  writeSnapshot = false,
  countUnknown = false,
  runId = "",
  nowMs = 0,
  since = NOSHOW_V2_SINCE,
  unparsableCount = 0,
} = {}) {
  const totals = {
    held: 0,
    cancelled: 0,
    external: 0,
    companions: 0,
    confirmed: 0,
    countedEvents: 0,
    counted: 0,
    completed: 0,
    incomplete: 0,
    noShow: 0,
    legacyExpected: 0,
    legacyAttended: 0,
  };
  const eventsBrief = [];
  const participantEvents = [];
  (Array.isArray(events) ? events : []).forEach((event) => {
    const info = classifyEvent(event);
    if (info.dateKey !== dateKey) return;
    if (info.bucket === "cancelled") {
      totals.cancelled += 1;
      return;
    }
    if (info.bucket === "external") {
      totals.external += 1;
      return;
    }
    if (info.bucket !== "held") return;
    const docId = text(event._docId || event.id);
    const summary = summarizeHeldEvent(
      event,
      lookupList(registrationsByDocId, docId),
      lookupList(attendanceByDocId, docId),
      lookupFlag(flagsByDocId, docId),
      since,
    );
    totals.held += 1;
    totals.companions += summary.companions;
    totals.confirmed += summary.confirmed;
    totals.countedEvents += summary.countedEvent;
    totals.counted += summary.counted;
    totals.completed += summary.completed;
    totals.incomplete += summary.incomplete;
    totals.noShow += summary.noShow;
    totals.legacyExpected += summary.confirmed;
    totals.legacyAttended += summary.legacyAttended;
    eventsBrief.push(summary.brief);
    participantEvents.push({
      docId: summary.brief.docId,
      id: summary.brief.id,
      title: summary.brief.title,
      checkedInUids: summary.checkedInUids,
    });
  });
  eventsBrief.sort((a, b) => text(a.docId).localeCompare(text(b.docId)));
  participantEvents.sort((a, b) => text(a.docId).localeCompare(text(b.docId)));

  const users = emptyUsers();
  if (userFacts) {
    users.newUsers = userFacts.newUsersByDate?.[dateKey] || 0;
    users.unknownCreated = countUnknown ? (userFacts.unknownCreated || 0) : 0;
    if (writeSnapshot && dateKey === asOf) {
      users.activeSnapshot = userFacts.snapshot || null;
      users.totalUsers = userFacts.totalUsers;
      users.qaUsers = userFacts.qaUsers;
    }
  }

  return {
    daily: {
      schemaVersion: SCHEMA_VERSION,
      dateKey,
      computedAtMs: nowMs,
      runId: text(runId),
      noshowSince: since,
      users,
      events: {
        held: totals.held,
        cancelled: totals.cancelled,
        external: totals.external,
        unparsable: unparsableCount || 0,
      },
      regs: { confirmed: totals.confirmed, companions: totals.companions },
      attend: {
        countedEvents: totals.countedEvents,
        counted: totals.counted,
        completed: totals.completed,
        incomplete: totals.incomplete,
        noShow: totals.noShow,
      },
      legacy: { expected: totals.legacyExpected, attended: totals.legacyAttended },
      eventsBrief,
    },
    participant: {
      schemaVersion: SCHEMA_VERSION,
      dateKey,
      computedAtMs: nowMs,
      events: participantEvents,
    },
  };
}

function applyPreservedUserSnapshot(next, existing, { dateKey, asOf } = {}) {
  const users = { ...(next?.users || emptyUsers()) };
  const out = { ...next, users };
  const previous = existing && existing.users ? existing.users : null;
  const keepExisting = dateKey !== asOf || !!(previous && previous.activeSnapshot != null);
  if (keepExisting) {
    users.activeSnapshot = previous ? (previous.activeSnapshot ?? null) : null;
    users.totalUsers = previous && previous.totalUsers != null ? previous.totalUsers : null;
    users.qaUsers = previous && previous.qaUsers != null ? previous.qaUsers : null;
  }
  return out;
}

function loginWindows(asOf) {
  return {
    asOfEnd: taipeiStartMs(addDaysKey(asOf, 1)),
    starts: {
      d7: taipeiStartMs(addDaysKey(asOf, -6)),
      d30: taipeiStartMs(addDaysKey(asOf, -29)),
      d90: taipeiStartMs(addDaysKey(asOf, -89)),
      d365: taipeiStartMs(addDaysKey(asOf, -364)),
    },
  };
}

function countLoginsInWindows(users, asOf) {
  const { asOfEnd, starts } = loginWindows(asOf);
  const snapshot = { d7: 0, d30: 0, d90: 0, d365: 0 };
  (Array.isArray(users) ? users : []).forEach((user) => {
    const loginMs = userInstantMs(user?.lastLogin);
    if (loginMs == null || asOfEnd == null || loginMs >= asOfEnd) return;
    Object.keys(starts).forEach((key) => {
      if (loginMs >= starts[key]) snapshot[key] += 1;
    });
  });
  return snapshot;
}

function summarizeUserDirectory(users, asOf) {
  const snapshot = { d7: 0, d30: 0, d90: 0, d365: 0 };
  const newUsersByDate = {};
  const counted = [];
  let totalUsers = 0;
  let qaUsers = 0;
  let unknownCreated = 0;
  (Array.isArray(users) ? users : []).forEach((user) => {
    const uid = text(user?.uid || user?.id);
    const docId = text(user?.id);
    if (isQaUid(uid) || isQaUid(docId)) {
      qaUsers += 1;
      return;
    }
    totalUsers += 1;
    counted.push(user);
    const createdKey = userCreatedDateKey(user);
    if (!createdKey) unknownCreated += 1;
    else newUsersByDate[createdKey] = (newUsersByDate[createdKey] || 0) + 1;
  });
  const logins = countLoginsInWindows(counted, asOf);
  Object.assign(snapshot, logins);
  return { snapshot, totalUsers, qaUsers, unknownCreated, newUsersByDate };
}

// rawCounts 來自含 QA 的 count()。QA 清單另讀，從各視窗減掉。lastLogin === asOfEnd 不計。
function activeSnapshotSubtractingQa(rawCounts, qaUsers, asOf) {
  const qaSnapshot = countLoginsInWindows(qaUsers, asOf);
  const raw = rawCounts || {};
  const qaCount = Array.isArray(qaUsers) ? qaUsers.length : 0;
  return {
    snapshot: {
      d7: Math.max(0, Number(raw.d7 || 0) - qaSnapshot.d7),
      d30: Math.max(0, Number(raw.d30 || 0) - qaSnapshot.d30),
      d90: Math.max(0, Number(raw.d90 || 0) - qaSnapshot.d90),
      d365: Math.max(0, Number(raw.d365 || 0) - qaSnapshot.d365),
    },
    totalUsers: Math.max(0, Number(raw.total || 0) - qaCount),
    qaUsers: qaCount,
    unknownCreated: 0,
    newUsersByDate: {},
  };
}

function recomputeDateKeys({ asOf, previousAttention, stuckRefIds } = {}) {
  const keys = new Set(enumerateDateKeys(addDaysKey(asOf, -13), asOf));
  const stuck = stuckRefIds instanceof Set ? stuckRefIds : new Set(stuckRefIds || []);
  (Array.isArray(previousAttention) ? previousAttention : []).forEach((item) => {
    if (!item || item.kind !== "stuck_event") return;
    if (stuck.has(text(item.refId))) return;
    if (isDateKey(item.dateKey)) keys.add(item.dateKey);
  });
  return [...keys].sort();
}

function reconcileDateKeys(asOf) {
  return enumerateDateKeys(addDaysKey(asOf, -35), addDaysKey(asOf, -14));
}

function selectUpcomingLowFill(events, nowMs) {
  const horizon = Number(nowMs) + LOW_FILL_HORIZON_MS;
  const candidates = [];
  (Array.isArray(events) ? events : []).forEach((event) => {
    const status = text(event?.status);
    if (status !== "open" && status !== "upcoming") return;
    if (text(event?.type) === "external") return;
    if (isQaUid(event?.creatorUid)) return;
    const max = maxCountOf(event);
    if (max <= 0) return;
    const startMs = eventStartMillis(event?.date);
    if (startMs == null || startMs < Number(nowMs) || startMs > horizon) return;
    const occupied = occupiedCountFromEvent(event);
    if (occupied / max >= LOW_FILL_MAX_RATIO) return;
    candidates.push({
      docId: text(event._docId || event.id),
      title: text(event.title),
      startMs,
      max,
      occupiedAtRun: occupied,
    });
  });
  candidates.sort((a, b) => a.startMs - b.startMs || text(a.docId).localeCompare(text(b.docId)));
  return {
    upcomingLowFill: candidates.slice(0, LOW_FILL_CAP),
    upcomingLowFillOverflow: Math.max(0, candidates.length - LOW_FILL_CAP),
  };
}

function buildStuckAttention(events, nowMs) {
  const items = [];
  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!isStuckEvent(event, nowMs)) return;
    const item = {
      kind: "stuck_event",
      refId: text(event._docId || event.id),
      title: text(event.title),
    };
    const dateKey = normalizeEventDateKey(event?.date);
    if (dateKey) item.dateKey = dateKey;
    items.push(item);
  });
  items.sort((a, b) => text(a.dateKey).localeCompare(text(b.dateKey)) || text(a.refId).localeCompare(text(b.refId)));
  return items;
}

function participantSignature(participantDay) {
  return (participantDay?.events || [])
    .map((event) => `${text(event.docId)}:${[...(event.checkedInUids || [])].map(text).sort().join(",")}`)
    .sort()
    .join("|");
}

function reconcileMismatch(storedDaily, nextDaily, storedParticipant, nextParticipant) {
  if (!storedDaily || !nextDaily) return true;
  if ((storedDaily.events?.held || 0) !== nextDaily.events.held) return true;
  if ((storedDaily.regs?.confirmed || 0) !== nextDaily.regs.confirmed) return true;
  if ((storedDaily.attend?.counted || 0) !== nextDaily.attend.counted) return true;
  if ((storedDaily.attend?.completed || 0) !== nextDaily.attend.completed) return true;
  if ((storedDaily.attend?.noShow || 0) !== nextDaily.attend.noShow) return true;
  return participantSignature(storedParticipant) !== participantSignature(nextParticipant);
}

// 相鄰日（含跨月）合併成一段；中間有空日就拆開。
// 活動日期與新用戶都要按段查，不能拿整包重算日的最小日～最大日當一個連續範圍。
function contiguousDateSegments(dateKeys) {
  const sorted = [...new Set((Array.isArray(dateKeys) ? dateKeys : []).filter(isDateKey))].sort();
  if (!sorted.length) return [];
  const segments = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let index = 1; index < sorted.length; index += 1) {
    const key = sorted[index];
    if (key === addDaysKey(end, 1)) {
      end = key;
    } else {
      segments.push({ start, end });
      start = key;
      end = key;
    }
  }
  segments.push({ start, end });
  return segments;
}

// 只涵蓋 fromKey～toKey 這一段連續日期所碰到的月份前綴。跨缺口要先切段再各查一次。
function eventDateQueryBounds(fromKey, toKey) {
  if (!isDateKey(fromKey) || !isDateKey(toKey) || fromKey > toKey) return [];
  const bounds = [];
  const seen = new Set();
  let monthCursor = `${fromKey.slice(0, 7)}-01`;
  const endMonth = toKey.slice(0, 7);
  while (monthCursor.slice(0, 7) <= endMonth && bounds.length < 400) {
    const [year, month] = monthCursor.split("-").map(Number);
    const prefixes = new Set([
      `${year}/${month}/`,
      `${year}/${pad2(month)}/`,
      `${year}-${month}-`,
      `${year}-${pad2(month)}-`,
    ]);
    prefixes.forEach((prefix) => {
      if (seen.has(prefix)) return;
      seen.add(prefix);
      bounds.push({ start: prefix, endExclusive: `${prefix}${String.fromCharCode(0xf8ff)}` });
    });
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    monthCursor = `${nextYear}-${pad2(nextMonth)}-01`;
  }
  return bounds;
}

function buildCost({
  todayKey,
  monthToDate = null,
  currency = "USD",
  month = "",
  sourceDateKey = "",
  prevMonthTotal = null,
} = {}) {
  if (!isDateKey(todayKey)) return null;
  if (monthToDate == null && !sourceDateKey) return null;
  const day = Number(todayKey.slice(8, 10));
  const elapsed = day - 1;
  let projected = null;
  if (day > 3 && elapsed > 0 && monthToDate != null) {
    projected = Math.round((Number(monthToDate) / elapsed) * daysInMonth(todayKey) * 100) / 100;
  }
  return {
    month: month || todayKey.slice(0, 7),
    currency: currency || "USD",
    monthToDate: monthToDate == null ? null : Number(monthToDate),
    projected,
    prevMonthTotal: prevMonthTotal == null ? null : Number(prevMonthTotal),
    sourceDateKey: sourceDateKey || "",
  };
}

function sumWindow(dailyByDate, start, end) {
  const keys = enumerateDateKeys(start, end);
  const sum = {
    newUsers: 0,
    eventsHeld: 0,
    registrations: 0,
    completed: 0,
    counted: 0,
    countedEvents: 0,
    noShow: 0,
  };
  const briefs = [];
  let present = 0;
  keys.forEach((key) => {
    const daily = getDaily(dailyByDate, key);
    if (!daily) return;
    present += 1;
    sum.newUsers += Number(daily.users?.newUsers || 0);
    sum.eventsHeld += Number(daily.events?.held || 0);
    sum.registrations += Number(daily.regs?.confirmed || 0);
    sum.completed += Number(daily.attend?.completed || 0);
    sum.counted += Number(daily.attend?.counted || 0);
    sum.countedEvents += Number(daily.attend?.countedEvents || 0);
    sum.noShow += Number(daily.attend?.noShow || 0);
    (daily.eventsBrief || []).forEach((brief) => briefs.push({ ...brief, dateKey: key }));
  });
  return {
    start,
    end,
    present,
    complete: keys.length > 0 && present === keys.length,
    sum,
    briefs,
  };
}

function nullableSum(window, field) {
  if (!window || !window.present) return null;
  return window.sum[field];
}

function snapshotOn(dailyByDate, dateKey, field) {
  const snap = getDaily(dailyByDate, dateKey)?.users?.activeSnapshot;
  if (!snap || snap[field] == null) return null;
  return snap[field];
}

function rankEvents(briefs) {
  const rows = briefs.filter((brief) => Number(brief.max) > 0).map((brief) => ({
    docId: text(brief.docId),
    title: text(brief.title),
    dateKey: brief.dateKey,
    occupied: Number(brief.occupied || 0),
    max: Number(brief.max || 0),
  }));
  rows.sort((a, b) => {
    const ratio = (b.occupied / b.max) - (a.occupied / a.max);
    if (ratio) return ratio;
    if (b.occupied !== a.occupied) return b.occupied - a.occupied;
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? 1 : -1;
    return text(a.docId).localeCompare(text(b.docId));
  });
  return rows.slice(0, TOP_LIMIT);
}

function rankHosts(briefs) {
  const hosts = new Map();
  briefs.forEach((brief) => {
    const uid = text(brief.creatorUid);
    if (!uid) return;
    const current = hosts.get(uid) || {
      uid,
      name: "",
      events: 0,
      registrations: 0,
      dateKey: "",
      docId: "",
    };
    current.events += 1;
    current.registrations += Number(brief.confirmed || 0);
    const dateKey = brief.dateKey || "";
    const docId = text(brief.docId);
    if (!current.dateKey || dateKey > current.dateKey || (dateKey === current.dateKey && docId > current.docId)) {
      current.name = text(brief.creator);
      current.dateKey = dateKey;
      current.docId = docId;
    }
    hosts.set(uid, current);
  });
  return [...hosts.values()]
    .map(({ uid, name, events, registrations }) => ({ uid, name, events, registrations }))
    .sort((a, b) => b.events - a.events || b.registrations - a.registrations || text(a.uid).localeCompare(text(b.uid)))
    .slice(0, TOP_LIMIT);
}

function hostNoShowAttention(briefs) {
  const site = briefs.reduce((sum, brief) => {
    sum.noShow += Number(brief.noShow || 0);
    sum.counted += Number(brief.counted || 0);
    return sum;
  }, { noShow: 0, counted: 0 });
  if (site.counted <= 0) return [];
  const siteRate = site.noShow / site.counted;
  const hosts = new Map();
  briefs.forEach((brief) => {
    const uid = text(brief.creatorUid);
    if (!uid) return;
    const current = hosts.get(uid) || { uid, name: "", noShow: 0, counted: 0, dateKey: "", docId: "" };
    current.noShow += Number(brief.noShow || 0);
    current.counted += Number(brief.counted || 0);
    const dateKey = brief.dateKey || "";
    const docId = text(brief.docId);
    if (!current.dateKey || dateKey > current.dateKey || (dateKey === current.dateKey && docId > current.docId)) {
      current.name = text(brief.creator);
      current.dateKey = dateKey;
      current.docId = docId;
    }
    hosts.set(uid, current);
  });
  return [...hosts.values()]
    .filter((host) => {
      if (host.counted < HOST_NOSHOW_MIN_COUNTED) return false;
      const rate = host.noShow / host.counted;
      return rate + 1e-9 >= HOST_NOSHOW_MIN_RATE && rate + 1e-9 >= siteRate * HOST_NOSHOW_SITE_MULTIPLE;
    })
    .map(({ uid, name, noShow, counted }) => ({ kind: "host_noshow_high", uid, name, noShow, counted }))
    .sort((a, b) => (b.noShow / b.counted) - (a.noShow / a.counted) || b.counted - a.counted || text(a.uid).localeCompare(text(b.uid)));
}

function trendPoint(daily, dateKey) {
  return {
    d: dateKey,
    active7: daily?.users?.activeSnapshot?.d7 ?? null,
    active30: daily?.users?.activeSnapshot?.d30 ?? null,
    newUsers: Number(daily?.users?.newUsers || 0),
    eventsHeld: Number(daily?.events?.held || 0),
    registrations: Number(daily?.regs?.confirmed || 0),
    completed: Number(daily?.attend?.completed || 0),
    counted: Number(daily?.attend?.counted || 0),
    countedEvents: Number(daily?.attend?.countedEvents || 0),
  };
}

function buildOpsSummaries({
  asOf,
  nowMs = 0,
  dailyByDate,
  noshowSince = NOSHOW_V2_SINCE,
  stuckAttention = [],
  lowFill = { upcomingLowFill: [], upcomingLowFillOverflow: 0 },
  cost = null,
  integrity = { lastReconcileAt: null, lastMismatchDays: [] },
} = {}) {
  const periods = {};
  const noshowPeriods = {};
  PERIODS.forEach((period) => {
    const window = periodWindow(asOf, period.days);
    const current = sumWindow(dailyByDate, window.start, window.end);
    const previous = sumWindow(dailyByDate, window.prevStart, window.prevEnd);
    periods[period.key] = {
      start: window.start,
      end: window.end,
      prevStart: window.prevStart,
      prevEnd: window.prevEnd,
      complete: current.complete,
      prevComplete: previous.complete,
      kpi: {
        activeUsers: {
          cur: snapshotOn(dailyByDate, asOf, period.snapshot),
          prev: snapshotOn(dailyByDate, window.prevEnd, period.snapshot),
        },
        newUsers: { cur: current.sum.newUsers, prev: nullableSum(previous, "newUsers") },
        eventsHeld: { cur: current.sum.eventsHeld, prev: nullableSum(previous, "eventsHeld") },
        registrations: { cur: current.sum.registrations, prev: nullableSum(previous, "registrations") },
        attend: {
          completed: current.sum.completed,
          counted: current.sum.counted,
          countedEvents: current.sum.countedEvents,
          prevCompleted: previous.sum.completed,
          prevCounted: previous.sum.counted,
          prevCountedEvents: previous.sum.countedEvents,
        },
      },
      topEvents: rankEvents(current.briefs),
      topHosts: rankHosts(current.briefs),
    };
    noshowPeriods[period.key] = {
      noShow: current.sum.noShow,
      counted: current.sum.counted,
      countedEvents: current.sum.countedEvents,
      prevNoShow: previous.sum.noShow,
      prevCounted: previous.sum.counted,
      prevCountedEvents: previous.sum.countedEvents,
    };
  });

  const dailyKeys = enumerateDateKeys(addDaysKey(asOf, -(TREND_DAILY_DAYS - 1)), asOf);
  const dailyTrend = dailyKeys.map((key) => trendPoint(getDaily(dailyByDate, key), key));
  const noshowDaily = dailyKeys.map((key) => {
    const daily = getDaily(dailyByDate, key);
    return {
      d: key,
      noShow: Number(daily?.attend?.noShow || 0),
      counted: Number(daily?.attend?.counted || 0),
      countedEvents: Number(daily?.attend?.countedEvents || 0),
    };
  });
  const months = monthKeysEndingAt(asOf, TREND_MONTHS);
  const monthly = months.map((monthKey) => {
    const monthStart = `${monthKey}-01`;
    const monthEnd = lastDayKeyOfMonth(monthKey);
    const end = monthEnd < asOf ? monthEnd : asOf;
    const summed = sumWindow(dailyByDate, monthStart, end);
    const snapDay = snapshotDayForMonth(monthKey, asOf);
    return {
      m: monthKey,
      active30: snapshotOn(dailyByDate, snapDay, "d30"),
      newUsers: summed.sum.newUsers,
      eventsHeld: summed.sum.eventsHeld,
      registrations: summed.sum.registrations,
      completed: summed.sum.completed,
      counted: summed.sum.counted,
      countedEvents: summed.sum.countedEvents,
    };
  });
  const noshowMonthly = months.map((monthKey) => {
    const monthEnd = lastDayKeyOfMonth(monthKey);
    const end = monthEnd < asOf ? monthEnd : asOf;
    const summed = sumWindow(dailyByDate, `${monthKey}-01`, end);
    return {
      m: monthKey,
      noShow: summed.sum.noShow,
      counted: summed.sum.counted,
      countedEvents: summed.sum.countedEvents,
    };
  });

  const attention = [...(Array.isArray(stuckAttention) ? stuckAttention : [])];
  if (cost && cost.projected != null && cost.prevMonthTotal != null && cost.projected > cost.prevMonthTotal * COST_HIGH_RATIO) {
    attention.push({
      kind: "cost_high",
      value: cost.projected,
      limit: Math.round(cost.prevMonthTotal * COST_HIGH_RATIO * 100) / 100,
    });
  }
  const mismatchDays = Array.isArray(integrity?.lastMismatchDays) ? integrity.lastMismatchDays : [];
  if (mismatchDays.length) {
    attention.push({ kind: "reconcile_mismatch", value: mismatchDays.length });
  }

  const d30 = periodWindow(asOf, 30);
  const hostBriefs = sumWindow(dailyByDate, d30.start, d30.end).briefs;
  const asOfDaily = getDaily(dailyByDate, asOf);
  return {
    latest: {
      schemaVersion: SCHEMA_VERSION,
      generatedAtMs: nowMs,
      asOf,
      noshowSince,
      users: {
        totalUsers: typeof asOfDaily?.users?.totalUsers === "number" ? asOfDaily.users.totalUsers : 0,
        qaUsers: typeof asOfDaily?.users?.qaUsers === "number" ? asOfDaily.users.qaUsers : 0,
      },
      periods,
      trend: { daily: dailyTrend, monthly },
      upcomingLowFill: lowFill?.upcomingLowFill || [],
      upcomingLowFillOverflow: lowFill?.upcomingLowFillOverflow || 0,
      attention,
      cost: cost || null,
      lineQuota: null,
      integrity: {
        lastReconcileAt: integrity?.lastReconcileAt ?? null,
        lastMismatchDays: mismatchDays,
      },
    },
    noshow: {
      schemaVersion: SCHEMA_VERSION,
      generatedAtMs: nowMs,
      asOf,
      periods: noshowPeriods,
      trend: { daily: noshowDaily, monthly: noshowMonthly },
      attention: hostNoShowAttention(hostBriefs),
    },
  };
}

module.exports = {
  COST_HIGH_RATIO,
  HOST_NOSHOW_MIN_COUNTED,
  HOST_NOSHOW_MIN_RATE,
  LOW_FILL_CAP,
  NOSHOW_V2_SINCE,
  PERIODS,
  SCHEMA_VERSION,
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
  enumerateDateKeys,
  eventDateQueryBounds,
  isQaUid,
  isStuckEvent,
  maxCountOf,
  occupiedCountFromEvent,
  parseEventEndDateInTaipei,
  periodWindow,
  reconcileDateKeys,
  reconcileMismatch,
  recomputeDateKeys,
  reservedRemainingSlots,
  resolveAsOf,
  resolveTodayKey,
  selectUpcomingLowFill,
  summarizeUserDirectory,
  taipeiStartMs,
  userCreatedDateKey,
};
