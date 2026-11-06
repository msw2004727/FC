"use strict";

const { NOSHOW_V2_SINCE, computeUserCountedStats } = require("./noshow-v2-core");

// 2：新增 v2 計入欄位（participatedCount／counted*／countedSince），舊欄位算法不變。
const SOURCE_VERSION = 2;

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function isCompanion(record) {
  return !!(record && (record.companionId || normalizeText(record.participantType) === "companion"));
}

function recordUid(record, primaryField) {
  if (!record) return "";
  return normalizeText(record[primaryField] || record.uid || record.userId);
}

function collectRelevantEventIds({ uid, registrations, activityRecords } = {}) {
  const safeUid = normalizeText(uid);
  const ids = new Set();
  if (!safeUid) return ids;

  (Array.isArray(registrations) ? registrations : []).forEach((record) => {
    if (!record || isCompanion(record)) return;
    if (recordUid(record, "userId") !== safeUid) return;
    if (normalizeText(record.status) !== "confirmed") return;
    const eventId = normalizeText(record.eventId);
    if (eventId) ids.add(eventId);
  });

  (Array.isArray(activityRecords) ? activityRecords : []).forEach((record) => {
    if (!record || isCompanion(record)) return;
    if (recordUid(record, "uid") !== safeUid) return;
    const status = normalizeText(record.status);
    if (status !== "registered" && status !== "confirmed") return;
    const eventId = normalizeText(record.eventId);
    if (eventId) ids.add(eventId);
  });

  return ids;
}

function computeUserAttendanceStats({
  uid,
  events,
  registrations,
  activityRecords,
  attendanceRecords,
  attendanceFlags,
  since = NOSHOW_V2_SINCE,
} = {}) {
  const safeUid = normalizeText(uid);
  const eventMap = new Map();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const eventId = normalizeText(event?.id || event?._docId);
    if (eventId) eventMap.set(eventId, event);
  });

  const registrationState = new Map();
  (Array.isArray(registrations) ? registrations : []).forEach((record) => {
    if (!record || isCompanion(record)) return;
    if (recordUid(record, "userId") !== safeUid) return;
    const eventId = normalizeText(record.eventId);
    if (!eventId) return;
    const state = registrationState.get(eventId) || { hasAny: false, confirmed: false, confirmedRecord: null };
    state.hasAny = true;
    if (normalizeText(record.status) === "confirmed") {
      state.confirmed = true;
      if (!state.confirmedRecord) state.confirmedRecord = record;
    }
    registrationState.set(eventId, state);
  });

  const legacyActivityEvidence = new Set();
  (Array.isArray(activityRecords) ? activityRecords : []).forEach((record) => {
    if (!record || isCompanion(record)) return;
    if (recordUid(record, "uid") !== safeUid) return;
    const status = normalizeText(record.status);
    if (status !== "registered" && status !== "confirmed") return;
    const eventId = normalizeText(record.eventId);
    if (eventId) legacyActivityEvidence.add(eventId);
  });

  const expectedEventIds = new Set();
  const candidates = new Set([
    ...registrationState.keys(),
    ...legacyActivityEvidence,
  ]);
  candidates.forEach((eventId) => {
    const event = eventMap.get(eventId);
    if (normalizeText(event?.status) !== "ended") return;
    const regState = registrationState.get(eventId);
    const hasConfirmedRegistration = !!regState?.confirmed;
    const hasLegacyEvidenceWithoutRegistration = !regState?.hasAny && legacyActivityEvidence.has(eventId);
    if (hasConfirmedRegistration || hasLegacyEvidenceWithoutRegistration) {
      expectedEventIds.add(eventId);
    }
  });

  const attendanceState = new Map();
  (Array.isArray(attendanceRecords) ? attendanceRecords : []).forEach((record) => {
    if (!record || isCompanion(record)) return;
    if (recordUid(record, "uid") !== safeUid) return;
    const status = normalizeText(record.status);
    if (status === "removed" || status === "cancelled") return;
    const eventId = normalizeText(record.eventId);
    if (!expectedEventIds.has(eventId)) return;
    const type = normalizeText(record.type);
    if (type !== "checkin" && type !== "checkout") return;
    const state = attendanceState.get(eventId) || { checkin: false, checkout: false };
    state[type] = true;
    attendanceState.set(eventId, state);
  });

  const attendedEventIds = new Set();
  const completedEventIds = new Set();
  attendanceState.forEach((state, eventId) => {
    if (state.checkin) attendedEventIds.add(eventId);
    if (state.checkin && state.checkout) completedEventIds.add(eventId);
  });

  const expectedCount = expectedEventIds.size;
  const attendedCount = attendedEventIds.size;
  const completedCount = completedEventIds.size;
  // v2：參與＝expectedEventIds（同舊應到定義）；計入／完成／未完成／放鴿子交給 noshow-v2-core。
  const counted = computeUserCountedStats({
    uid: safeUid,
    participations: [...expectedEventIds].map((eventId) => ({
      event: eventMap.get(eventId),
      registration: registrationState.get(eventId)?.confirmedRecord || null,
    })),
    flagsByEventDocId: attendanceFlags,
    attendanceRecords,
    since,
  });
  return {
    sourceVersion: SOURCE_VERSION,
    expectedCount,
    attendedCount,
    completedCount,
    attendRate: expectedCount > 0 ? Math.round((attendedCount / expectedCount) * 100) : 0,
    expectedEventIds: [...expectedEventIds].sort(),
    attendedEventIds: [...attendedEventIds].sort(),
    completedEventIds: [...completedEventIds].sort(),
    participatedCount: counted.participatedCount,
    countedCount: counted.countedCount,
    countedCompletedCount: counted.countedCompletedCount,
    countedIncompleteCount: counted.countedIncompleteCount,
    countedNoShowCount: counted.countedNoShowCount,
    countedSince: counted.countedSince,
  };
}

module.exports = {
  SOURCE_VERSION,
  collectRelevantEventIds,
  computeUserAttendanceStats,
  isCompanion,
  normalizeText,
};
