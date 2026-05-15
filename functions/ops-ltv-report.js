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
    const ms = Date.parse(value.replace(/\//g, "-"));
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

function normalizeUid(doc = {}) {
  const data = doc.data || doc;
  return String(doc.id || data.uid || data.lineUserId || data.userId || "").trim();
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function addUidToDay(map, dayKey, uid) {
  const safeUid = String(uid || "").trim();
  if (!isDateKey(dayKey) || !safeUid) return false;
  if (!map.has(dayKey)) map.set(dayKey, new Set());
  map.get(dayKey).add(safeUid);
  return true;
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
    nextDay: { denominator: 0, retained: 0, rate: 0, label: "次日留存" },
    day7: { denominator: 0, retained: 0, rate: 0, label: "7日內回訪" },
    day30: { denominator: 0, retained: 0, rate: 0, label: "30日內回訪" },
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

function buildOpsLtvReport({
  users = [],
  activeEntriesByDay = {},
  startDate,
  endDate,
  nowMs = Date.now(),
  includeLastLoginFallback = true,
  source = {},
} = {}) {
  const range = clampDateRange({ startDate, endDate, nowMs });
  const todayKey = msToTaipeiDateKey(nowMs);
  const activeQueryStart = addDaysKey(range.startDate, -29);
  const activeQueryEnd = [addDaysKey(range.endDate, 30), todayKey].sort()[0];
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
    const data = doc.data || doc;
    const uid = normalizeUid(doc);
    if (!uid) return;
    const createdMs = coerceMs(data.createdAt || data.joinDate);
    const lastLoginMs = coerceMs(data.lastLogin || data.lastActive || data.updatedAt);
    const createdKey = msToTaipeiDateKey(createdMs);
    const lastLoginKey = msToTaipeiDateKey(lastLoginMs);
    const user = { uid, createdKey, lastLoginKey };
    normalizedUsers.push(user);

    if (compareDateKey(createdKey, range.startDate) >= 0 && compareDateKey(createdKey, range.endDate) <= 0) {
      dnuByDay.set(createdKey, (dnuByDay.get(createdKey) || 0) + 1);
    }

    if (includeLastLoginFallback
      && compareDateKey(lastLoginKey, activeQueryStart) >= 0
      && compareDateKey(lastLoginKey, activeQueryEnd) <= 0) {
      if (addUidToDay(activeByDay, lastLoginKey, uid)) {
        lastLoginFallbackCount += 1;
        if (!activeDaysByUid.has(uid)) activeDaysByUid.set(uid, new Set());
        activeDaysByUid.get(uid).add(lastLoginKey);
      }
    }
  });

  const series = rangeKeys.map(dayKey => ({
    date: dayKey,
    dnu: dnuByDay.get(dayKey) || 0,
    dau: activeByDay.get(dayKey)?.size || 0,
    wau: buildRollingCount(activeByDay, dayKey, 7),
    mau: buildRollingCount(activeByDay, dayKey, 30),
  }));

  const activeUsersRange = new Set();
  rangeKeys.forEach(key => {
    const set = activeByDay.get(key);
    if (set) set.forEach(uid => activeUsersRange.add(uid));
  });

  const cohortUsers = normalizedUsers.filter(user =>
    compareDateKey(user.createdKey, range.startDate) >= 0
    && compareDateKey(user.createdKey, range.endDate) <= 0
  );
  const returnedAfterSignup = cohortUsers.filter(user => {
    const from = addDaysKey(user.createdKey, 1);
    const to = [range.endDate, todayKey].sort()[0];
    return compareDateKey(from, to) <= 0 && hasActiveInWindow(activeDaysByUid, user.uid, from, to);
  }).length;

  const sumDau = series.reduce((sum, row) => sum + row.dau, 0);
  const peak = series.reduce((best, row) => (row.dau > best.dau ? row : best), { date: "", dau: 0 });
  const last = series[series.length - 1] || { wau: 0, mau: 0 };

  return {
    generatedAt: new Date(nowMs).toISOString(),
    range,
    source: {
      primaryActiveSource: "auditLogsByDay login_success",
      fallbackActiveSource: includeLastLoginFallback ? "users.lastLogin" : "",
      lastLoginFallbackCount,
      ...source,
    },
    summary: {
      totalUsers: normalizedUsers.length,
      dnu: cohortUsers.length,
      avgDnu: Math.round((cohortUsers.length / range.rangeDays) * 10) / 10,
      activeUsers: activeUsersRange.size,
      avgDau: Math.round((sumDau / range.rangeDays) * 10) / 10,
      peakDau: peak.dau,
      peakDauDate: peak.date,
      wau: last.wau,
      mau: last.mau,
      rangeReturnRate: percent(returnedAfterSignup, cohortUsers.length),
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
};
