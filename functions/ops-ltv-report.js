"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 180;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateKeyToTaipeiUtcMs(dateKey) {
  if (!isDateKey(dateKey)) return NaN;
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - TAIPEI_OFFSET_MS;
}

function msToTaipeiDateKey(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + TAIPEI_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDaysKey(dateKey, days) {
  const base = dateKeyToTaipeiUtcMs(dateKey);
  if (!Number.isFinite(base)) return "";
  return msToTaipeiDateKey(base + Number(days || 0) * DAY_MS);
}

function compareDateKey(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function minDateKey(a, b) {
  if (!isDateKey(a)) return b || "";
  if (!isDateKey(b)) return a || "";
  return compareDateKey(a, b) <= 0 ? a : b;
}

function isWithinRange(dateKey, startDate, endDate) {
  return isDateKey(dateKey)
    && compareDateKey(dateKey, startDate) >= 0
    && compareDateKey(dateKey, endDate) <= 0;
}

function listDateKeys(startDate, endDate) {
  if (!isDateKey(startDate) || !isDateKey(endDate) || compareDateKey(startDate, endDate) > 0) return [];
  const keys = [];
  let current = startDate;
  while (compareDateKey(current, endDate) <= 0 && keys.length <= 400) {
    keys.push(current);
    current = addDaysKey(current, 1);
  }
  return keys;
}

function clampDateRange({ startDate, endDate, nowMs = Date.now() } = {}) {
  const todayKey = msToTaipeiDateKey(nowMs);
  const rawEnd = isDateKey(endDate) ? endDate : todayKey;
  const safeEnd = compareDateKey(rawEnd, todayKey) > 0 ? todayKey : rawEnd;
  const safeStart = isDateKey(startDate) ? startDate : addDaysKey(safeEnd, -29);
  if (compareDateKey(safeStart, safeEnd) > 0) {
    throw new Error("INVALID_DATE_RANGE");
  }
  const rangeDays = listDateKeys(safeStart, safeEnd).length;
  if (rangeDays < 1) throw new Error("INVALID_DATE_RANGE");
  if (rangeDays > MAX_RANGE_DAYS) throw new Error("DATE_RANGE_TOO_LARGE");
  return { startDate: safeStart, endDate: safeEnd, rangeDays };
}

function coerceMs(value) {
  if (!value) return NaN;
  if (typeof value === "number") return value > 10000000000 ? value : value * 1000;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/\//g, "-");
    const ms = Date.parse(cleaned);
    return Number.isFinite(ms) ? ms : NaN;
  }
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date ? d.getTime() : NaN;
  }
  if (Number.isFinite(value.seconds)) return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
  if (Number.isFinite(value._seconds)) return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000);
  return NaN;
}

function normalizeEventDateKey(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const datePart = value.trim().split(/\s+/)[0].replace(/\//g, "-");
    const parts = datePart.split("-").map(Number);
    if (parts.length >= 3 && parts.every(Number.isFinite)) {
      return `${parts[0]}-${pad2(parts[1])}-${pad2(parts[2])}`;
    }
  }
  return msToTaipeiDateKey(coerceMs(value));
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function average(value, denominator) {
  if (!denominator) return 0;
  return Math.round((value / denominator) * 10) / 10;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(raw * 10) / 10;
}

function daysBetween(startKey, endKey) {
  const startMs = dateKeyToTaipeiUtcMs(startKey);
  const endMs = dateKeyToTaipeiUtcMs(endKey);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return NaN;
  return Math.max(0, Math.round((endMs - startMs) / DAY_MS));
}

function getDocData(doc = {}) {
  return doc.data && typeof doc.data === "object" ? doc.data : doc;
}

function normalizeUid(doc = {}) {
  const data = getDocData(doc);
  return String(doc.id || data.uid || data.lineUserId || data.userId || "").trim();
}

function addUidToDay(map, dayKey, uid) {
  const safeUid = String(uid || "").trim();
  if (!isDateKey(dayKey) || !safeUid) return false;
  if (!map.has(dayKey)) map.set(dayKey, new Set());
  map.get(dayKey).add(safeUid);
  return true;
}

function incrementDay(map, dayKey, amount = 1) {
  if (!isDateKey(dayKey)) return;
  map.set(dayKey, (map.get(dayKey) || 0) + amount);
}

function pairKey(uid, eventId) {
  return `${uid}::${eventId}`;
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function isCompanionRecord(data = {}) {
  return normalizeStatus(data.participantType) === "companion" || !!data.companionId;
}

function isParticipationStatus(status) {
  return status === "confirmed" || status === "registered" || status === "completed";
}

function isRemovedAttendanceStatus(status) {
  return status === "removed" || status === "cancelled";
}

function buildRollingCount(activeByDay, dayKey, days) {
  const set = new Set();
  for (let offset = 0; offset > -days; offset -= 1) {
    const key = addDaysKey(dayKey, offset);
    const daySet = activeByDay.get(key);
    if (daySet) daySet.forEach(uid => set.add(uid));
  }
  return set.size;
}

function hasActiveInWindow(activeDaysByUid, uid, startKey, endKey) {
  const days = activeDaysByUid.get(uid);
  if (!days) return false;
  for (const key of days) {
    if (compareDateKey(key, startKey) >= 0 && compareDateKey(key, endKey) <= 0) return true;
  }
  return false;
}

function calcRetention(cohortUsers, activeDaysByUid, nowKey) {
  const metrics = {
    nextDay: { denominator: 0, retained: 0, rate: 0, label: "次日回訪" },
    day7: { denominator: 0, retained: 0, rate: 0, label: "7 日內回訪" },
    day30: { denominator: 0, retained: 0, rate: 0, label: "30 日內回訪" },
  };

  cohortUsers.forEach(user => {
    if (!user.uid || !isDateKey(user.createdKey)) return;
    const d1 = addDaysKey(user.createdKey, 1);
    if (compareDateKey(d1, nowKey) <= 0) {
      metrics.nextDay.denominator += 1;
      if (hasActiveInWindow(activeDaysByUid, user.uid, d1, d1)) metrics.nextDay.retained += 1;
    }

    const d7 = addDaysKey(user.createdKey, 7);
    if (compareDateKey(d7, nowKey) <= 0) {
      metrics.day7.denominator += 1;
      if (hasActiveInWindow(activeDaysByUid, user.uid, d1, d7)) metrics.day7.retained += 1;
    }

    const d30 = addDaysKey(user.createdKey, 30);
    if (compareDateKey(d30, nowKey) <= 0) {
      metrics.day30.denominator += 1;
      if (hasActiveInWindow(activeDaysByUid, user.uid, d1, d30)) metrics.day30.retained += 1;
    }
  });

  Object.values(metrics).forEach(item => {
    item.rate = percent(item.retained, item.denominator);
  });
  return metrics;
}

function normalizeEventDocs(events = []) {
  const eventMap = new Map();
  events.forEach(doc => {
    const data = getDocData(doc);
    const id = String(data.id || doc.id || data.eventId || "").trim();
    if (!id) return;
    eventMap.set(id, {
      id,
      docId: String(doc.id || data._docId || "").trim(),
      dateKey: normalizeEventDateKey(data.date || data.eventDate || data.startDate),
      status: normalizeStatus(data.status),
      type: String(data.type || data.eventType || "").trim(),
      sportTag: String(data.sportTag || "").trim(),
      title: String(data.title || data.name || "").trim(),
    });
  });
  return eventMap;
}

function normalizeRegistrations(registrations = [], eventMap = new Map()) {
  return registrations.map(doc => {
    const data = getDocData(doc);
    if (isCompanionRecord(data)) return null;
    const uid = String(data.userId || data.uid || "").trim();
    const eventId = String(data.eventId || "").trim();
    if (!uid || !eventId) return null;
    const event = eventMap.get(eventId) || {};
    const registeredMs = coerceMs(data.registeredAt || data.createdAt || data.updatedAt);
    const registeredKey = msToTaipeiDateKey(registeredMs);
    const eventDateKey = event.dateKey || normalizeEventDateKey(data.eventDate || data.date);
    return {
      uid,
      eventId,
      status: normalizeStatus(data.status || "confirmed"),
      registeredMs,
      registeredKey,
      eventDateKey,
      participationKey: eventDateKey || registeredKey,
      eventType: event.type || String(data.eventType || "").trim(),
      sportTag: event.sportTag || String(data.sportTag || "").trim(),
    };
  }).filter(Boolean);
}

function normalizeAttendanceRecords(attendanceRecords = [], eventMap = new Map()) {
  return attendanceRecords.map(doc => {
    const data = getDocData(doc);
    if (isCompanionRecord(data)) return null;
    const status = normalizeStatus(data.status);
    if (isRemovedAttendanceStatus(status)) return null;
    const uid = String(data.uid || data.userId || "").trim();
    const eventId = String(data.eventId || "").trim();
    const type = normalizeStatus(data.type);
    if (!uid || !eventId || (type !== "checkin" && type !== "checkout")) return null;
    const event = eventMap.get(eventId) || {};
    const timeMs = coerceMs(data.time || data.checkInTime || data.checkOutTime || data.createdAt || data.updatedAt);
    const timeKey = msToTaipeiDateKey(timeMs);
    const eventDateKey = event.dateKey || normalizeEventDateKey(data.eventDate || data.date);
    return {
      uid,
      eventId,
      type,
      timeMs,
      timeKey,
      eventDateKey,
      activityKey: eventDateKey || timeKey,
    };
  }).filter(Boolean);
}

function buildParticipationMaps(registrations = [], attendanceRecords = []) {
  const participationByPair = new Map();
  const waitlistedByPair = new Map();
  registrations.forEach(reg => {
    const key = pairKey(reg.uid, reg.eventId);
    if (isParticipationStatus(reg.status)) {
      const current = participationByPair.get(key);
      const currentMs = Number.isFinite(current?.registeredMs) ? current.registeredMs : Number.POSITIVE_INFINITY;
      const nextMs = Number.isFinite(reg.registeredMs) ? reg.registeredMs : Number.POSITIVE_INFINITY;
      if (!current || nextMs < currentMs) {
        participationByPair.set(key, reg);
      }
    } else if (reg.status === "waitlisted") {
      waitlistedByPair.set(key, reg);
    }
  });

  const attendanceByPair = new Map();
  attendanceRecords.forEach(record => {
    const key = pairKey(record.uid, record.eventId);
    if (!attendanceByPair.has(key)) {
      attendanceByPair.set(key, {
        uid: record.uid,
        eventId: record.eventId,
        hasCheckin: false,
        hasCheckout: false,
        checkinKey: "",
        checkoutKey: "",
        activityKey: record.activityKey,
      });
    }
    const entry = attendanceByPair.get(key);
    entry.activityKey = entry.activityKey || record.activityKey;
    if (record.type === "checkin") {
      entry.hasCheckin = true;
      entry.checkinKey = entry.checkinKey || record.activityKey;
    }
    if (record.type === "checkout") {
      entry.hasCheckout = true;
      entry.checkoutKey = entry.checkoutKey || record.activityKey;
    }
  });

  return { participationByPair, waitlistedByPair, attendanceByPair };
}

function findFirstOnOrAfter(items, startKey, endKey = "") {
  const filtered = items
    .filter(item => isDateKey(item.key) && compareDateKey(item.key, startKey) >= 0)
    .filter(item => !endKey || compareDateKey(item.key, endKey) <= 0)
    .sort((a, b) => compareDateKey(a.key, b.key));
  return filtered[0] || null;
}

function buildEngagementReport({
  normalizedUsers,
  events,
  registrations,
  attendanceRecords,
  range,
  todayKey,
} = {}) {
  const eventMap = normalizeEventDocs(events);
  const normalizedRegs = normalizeRegistrations(registrations, eventMap);
  const normalizedAttendance = normalizeAttendanceRecords(attendanceRecords, eventMap);
  const { participationByPair, waitlistedByPair, attendanceByPair } = buildParticipationMaps(normalizedRegs, normalizedAttendance);

  const participationUsersByDay = new Map();
  const participationEventsByDay = new Map();
  const completedUsersByDay = new Map();
  const completedEventsByDay = new Map();
  const checkinUsersByDay = new Map();
  const checkinEventsByDay = new Map();
  const noShowUsersByDay = new Map();
  const noShowEventsByDay = new Map();

  const participationUsers = new Set();
  const completedUsers = new Set();
  const checkinUsers = new Set();
  const noShowUsers = new Set();
  const waitlistedUsers = new Set();
  let participationEvents = 0;
  let completedEvents = 0;
  let checkinEvents = 0;
  let noShowEvents = 0;
  let endedParticipationEvents = 0;
  let orphanCompletedEvents = 0;
  let participationWithoutEventDate = 0;

  participationByPair.forEach(reg => {
    const dayKey = reg.participationKey;
    if (!isDateKey(dayKey)) participationWithoutEventDate += 1;
    if (!isWithinRange(dayKey, range.startDate, range.endDate)) return;
    participationEvents += 1;
    participationUsers.add(reg.uid);
    addUidToDay(participationUsersByDay, dayKey, reg.uid);
    incrementDay(participationEventsByDay, dayKey);
  });

  waitlistedByPair.forEach(reg => {
    if (isWithinRange(reg.participationKey, range.startDate, range.endDate)) {
      waitlistedUsers.add(reg.uid);
    }
  });

  attendanceByPair.forEach(entry => {
    const checkinKey = entry.checkinKey || entry.activityKey;
    if (entry.hasCheckin && isWithinRange(checkinKey, range.startDate, range.endDate)) {
      checkinEvents += 1;
      checkinUsers.add(entry.uid);
      addUidToDay(checkinUsersByDay, checkinKey, entry.uid);
      incrementDay(checkinEventsByDay, checkinKey);
    }

    const completionKey = entry.checkoutKey || entry.activityKey || entry.checkinKey;
    if (entry.hasCheckin && entry.hasCheckout && isWithinRange(completionKey, range.startDate, range.endDate)) {
      completedEvents += 1;
      completedUsers.add(entry.uid);
      addUidToDay(completedUsersByDay, completionKey, entry.uid);
      incrementDay(completedEventsByDay, completionKey);
      if (!participationByPair.has(pairKey(entry.uid, entry.eventId))) orphanCompletedEvents += 1;
    }
  });

  participationByPair.forEach(reg => {
    const eventDateKey = reg.eventDateKey;
    if (!isWithinRange(eventDateKey, range.startDate, range.endDate)) return;
    if (compareDateKey(eventDateKey, todayKey) >= 0) return;
    endedParticipationEvents += 1;
    const attendance = attendanceByPair.get(pairKey(reg.uid, reg.eventId));
    if (!attendance || !attendance.hasCheckin) {
      noShowEvents += 1;
      noShowUsers.add(reg.uid);
      addUidToDay(noShowUsersByDay, eventDateKey, reg.uid);
      incrementDay(noShowEventsByDay, eventDateKey);
    }
  });

  const regsByUid = new Map();
  participationByPair.forEach(reg => {
    const key = reg.registeredKey || reg.participationKey;
    if (!isDateKey(key)) return;
    if (!regsByUid.has(reg.uid)) regsByUid.set(reg.uid, []);
    regsByUid.get(reg.uid).push({ key, eventId: reg.eventId });
  });

  const completionsByUid = new Map();
  attendanceByPair.forEach(entry => {
    if (!entry.hasCheckin || !entry.hasCheckout) return;
    const key = entry.checkoutKey || entry.activityKey || entry.checkinKey;
    if (!isDateKey(key)) return;
    if (!completionsByUid.has(entry.uid)) completionsByUid.set(entry.uid, []);
    completionsByUid.get(entry.uid).push({ key, eventId: entry.eventId });
  });

  const reportEnd = minDateKey(range.endDate, todayKey);
  let cohortRegisteredByRange = 0;
  let signup7dDenominator = 0;
  let signup7dConverted = 0;
  let complete30dDenominator = 0;
  let complete30dConverted = 0;
  const daysToFirstRegistration = [];

  normalizedUsers.forEach(user => {
    if (!isWithinRange(user.createdKey, range.startDate, range.endDate)) return;
    const firstRegByRange = findFirstOnOrAfter(regsByUid.get(user.uid) || [], user.createdKey, reportEnd);
    if (firstRegByRange) {
      cohortRegisteredByRange += 1;
      daysToFirstRegistration.push(daysBetween(user.createdKey, firstRegByRange.key));
    }

    const signup7dEnd = addDaysKey(user.createdKey, 7);
    if (compareDateKey(signup7dEnd, todayKey) <= 0) {
      signup7dDenominator += 1;
      if (findFirstOnOrAfter(regsByUid.get(user.uid) || [], user.createdKey, signup7dEnd)) {
        signup7dConverted += 1;
      }
    }

    const complete30dEnd = addDaysKey(user.createdKey, 30);
    if (compareDateKey(complete30dEnd, todayKey) <= 0) {
      complete30dDenominator += 1;
      if (findFirstOnOrAfter(completionsByUid.get(user.uid) || [], user.createdKey, complete30dEnd)) {
        complete30dConverted += 1;
      }
    }
  });

  return {
    maps: {
      participationUsersByDay,
      participationEventsByDay,
      completedUsersByDay,
      completedEventsByDay,
      checkinUsersByDay,
      checkinEventsByDay,
      noShowUsersByDay,
      noShowEventsByDay,
    },
    summary: {
      participationUsers: participationUsers.size,
      participationEvents,
      avgParticipationEventsPerDay: average(participationEvents, range.rangeDays),
      avgEventsPerParticipant: average(participationEvents, participationUsers.size),
      waitlistedUsers: waitlistedUsers.size,
      completedUsers: completedUsers.size,
      completedEvents,
      completionRate: percent(completedEvents - orphanCompletedEvents, participationEvents),
      checkinUsers: checkinUsers.size,
      checkinEvents,
      checkinRate: percent(checkinEvents, participationEvents),
      endedParticipationEvents,
      noShowUsers: noShowUsers.size,
      noShowEvents,
      noShowRate: percent(noShowEvents, endedParticipationEvents),
      orphanCompletedEvents,
      participationWithoutEventDate,
      newUserParticipation: {
        cohortSize: normalizedUsers.filter(user => isWithinRange(user.createdKey, range.startDate, range.endDate)).length,
        registeredByRange: cohortRegisteredByRange,
        registeredByRangeRate: percent(cohortRegisteredByRange, normalizedUsers.filter(user => isWithinRange(user.createdKey, range.startDate, range.endDate)).length),
        signup7d: {
          denominator: signup7dDenominator,
          converted: signup7dConverted,
          rate: percent(signup7dConverted, signup7dDenominator),
        },
        complete30d: {
          denominator: complete30dDenominator,
          converted: complete30dConverted,
          rate: percent(complete30dConverted, complete30dDenominator),
        },
        medianDaysToFirstRegistration: median(daysToFirstRegistration),
      },
    },
    sourceCounts: {
      eventDocs: eventMap.size,
      registrationDocs: normalizedRegs.length,
      attendanceDocs: normalizedAttendance.length,
    },
  };
}

function buildOpsLtvReport({
  users = [],
  activeEntriesByDay = {},
  registrations = [],
  attendanceRecords = [],
  events = [],
  startDate,
  endDate,
  nowMs = Date.now(),
  includeLastLoginFallback = true,
  source = {},
} = {}) {
  const range = clampDateRange({ startDate, endDate, nowMs });
  const todayKey = msToTaipeiDateKey(nowMs);
  const activeQueryStart = addDaysKey(range.startDate, -29);
  const activeQueryEnd = minDateKey(addDaysKey(range.endDate, 30), todayKey);
  const rangeKeys = listDateKeys(range.startDate, range.endDate);
  const activeByDay = new Map();
  const activeDaysByUid = new Map();
  const dnuByDay = new Map(rangeKeys.map(key => [key, 0]));
  const normalizedUsers = [];
  let lastLoginFallbackCount = 0;

  Object.entries(activeEntriesByDay || {}).forEach(([dayKey, uidList]) => {
    (Array.isArray(uidList) ? uidList : []).forEach(uid => {
      if (addUidToDay(activeByDay, dayKey, uid)) {
        const safeUid = String(uid || "").trim();
        if (!activeDaysByUid.has(safeUid)) activeDaysByUid.set(safeUid, new Set());
        activeDaysByUid.get(safeUid).add(dayKey);
      }
    });
  });

  users.forEach(doc => {
    const data = getDocData(doc);
    const uid = normalizeUid(doc);
    if (!uid) return;
    const createdMs = coerceMs(data.createdAt || data.joinDate);
    const lastLoginMs = coerceMs(data.lastLogin || data.lastActive || data.updatedAt);
    const createdKey = msToTaipeiDateKey(createdMs);
    const lastLoginKey = msToTaipeiDateKey(lastLoginMs);
    const user = { uid, createdKey, lastLoginKey };
    normalizedUsers.push(user);

    if (isWithinRange(createdKey, range.startDate, range.endDate)) {
      dnuByDay.set(createdKey, (dnuByDay.get(createdKey) || 0) + 1);
    }

    if (includeLastLoginFallback
      && isWithinRange(lastLoginKey, activeQueryStart, activeQueryEnd)) {
      if (addUidToDay(activeByDay, lastLoginKey, uid)) {
        lastLoginFallbackCount += 1;
        if (!activeDaysByUid.has(uid)) activeDaysByUid.set(uid, new Set());
        activeDaysByUid.get(uid).add(lastLoginKey);
      }
    }
  });

  const engagement = buildEngagementReport({
    normalizedUsers,
    events,
    registrations,
    attendanceRecords,
    range,
    todayKey,
  });

  const series = rangeKeys.map(dayKey => {
    const participationEvents = engagement.maps.participationEventsByDay.get(dayKey) || 0;
    const completedEvents = engagement.maps.completedEventsByDay.get(dayKey) || 0;
    return {
      date: dayKey,
      dnu: dnuByDay.get(dayKey) || 0,
      dau: activeByDay.get(dayKey)?.size || 0,
      wau: buildRollingCount(activeByDay, dayKey, 7),
      mau: buildRollingCount(activeByDay, dayKey, 30),
      participationUsers: engagement.maps.participationUsersByDay.get(dayKey)?.size || 0,
      participationEvents,
      completedUsers: engagement.maps.completedUsersByDay.get(dayKey)?.size || 0,
      completedEvents,
      completionRate: percent(completedEvents, participationEvents),
      noShowEvents: engagement.maps.noShowEventsByDay.get(dayKey) || 0,
    };
  });

  const activeUsersRange = new Set();
  rangeKeys.forEach(key => {
    const set = activeByDay.get(key);
    if (set) set.forEach(uid => activeUsersRange.add(uid));
  });

  const cohortUsers = normalizedUsers.filter(user =>
    isWithinRange(user.createdKey, range.startDate, range.endDate)
  );
  const returnedAfterSignup = cohortUsers.filter(user => {
    const from = addDaysKey(user.createdKey, 1);
    const to = minDateKey(range.endDate, todayKey);
    return compareDateKey(from, to) <= 0 && hasActiveInWindow(activeDaysByUid, user.uid, from, to);
  }).length;

  const sumDau = series.reduce((sum, row) => sum + row.dau, 0);
  const peak = series.reduce((best, row) => (row.dau > best.dau ? row : best), { date: "", dau: 0 });
  const last = series[series.length - 1] || { wau: 0, mau: 0 };

  const estimatedReads = Number(source.estimatedReads || 0)
    || Number(source.usersRead || 0)
    + Number(source.auditEntryReads || 0)
    + Number(source.eventsRead || 0)
    + Number(source.registrationReads || 0)
    + Number(source.attendanceReads || 0);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    range,
    source: {
      primaryActiveSource: "auditLogsByDay login_success",
      fallbackActiveSource: includeLastLoginFallback ? "users.lastLogin" : "",
      primaryEngagementSource: "events/{eventDoc}/registrations + attendanceRecords",
      lastLoginFallbackCount,
      estimatedReads,
      ...engagement.sourceCounts,
      ...source,
    },
    summary: {
      totalUsers: normalizedUsers.length,
      dnu: cohortUsers.length,
      avgDnu: average(cohortUsers.length, range.rangeDays),
      activeUsers: activeUsersRange.size,
      avgDau: average(sumDau, range.rangeDays),
      peakDau: peak.dau,
      peakDauDate: peak.date,
      wau: last.wau,
      mau: last.mau,
      rangeReturnRate: percent(returnedAfterSignup, cohortUsers.length),
      participantToActiveRate: percent(engagement.summary.participationUsers, activeUsersRange.size),
      ...engagement.summary,
    },
    retention: calcRetention(cohortUsers, activeDaysByUid, todayKey),
    series,
  };
}

module.exports = {
  DAY_MS,
  MAX_RANGE_DAYS,
  addDaysKey,
  buildOpsLtvReport,
  clampDateRange,
  compareDateKey,
  coerceMs,
  dateKeyToTaipeiUtcMs,
  listDateKeys,
  msToTaipeiDateKey,
  normalizeEventDateKey,
};
