"use strict";

const COURSE_TIME_ZONE = "Asia/Taipei";

function asString(value, maxLength = 120) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function asId(value, maxLength = 100) {
  return asString(value, maxLength);
}

function isActiveEnrollment(enrollment) {
  const status = asString(enrollment && enrollment.status, 32);
  return !!enrollment && status !== "rejected" && status !== "cancelled" && status !== "removed";
}

function isApprovedEnrollment(enrollment) {
  return asString(enrollment && enrollment.status, 32) === "approved";
}

function isStudentOwnedByUid(student, uid) {
  const safeUid = asId(uid, 128);
  if (!student || !safeUid) return false;
  return asId(student.selfUid, 128) === safeUid || asId(student.parentUid, 128) === safeUid;
}

function dateStringInTimeZone(now = new Date(), timeZone = COURSE_TIME_ZONE) {
  const date = now instanceof Date ? now : new Date(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = {};
  parts.forEach((part) => {
    if (part.type !== "literal") values[part.type] = part.value;
  });
  return `${values.year}-${values.month}-${values.day}`;
}

function isCoursePlanEnded(plan, now = new Date()) {
  const endDate = asString(plan && plan.endDate, 20);
  if (!endDate) return false;
  const today = dateStringInTimeZone(now);
  return endDate < today;
}

function getApprovedStudentIdSet({ plan = {}, enrollments = [], students = [], migrationCompleted = false }) {
  const ids = new Set();
  enrollments.filter(isApprovedEnrollment).forEach((item) => {
    const studentId = asId(item.studentId);
    if (studentId) ids.add(studentId);
  });

  const groupId = asId(plan.groupId);
  if (!migrationCompleted && groupId) {
    students.forEach((student) => {
      const studentId = asId(student && (student.id || student._docId));
      const groupIds = Array.isArray(student && student.groupIds) ? student.groupIds.map((gid) => asId(gid)) : [];
      if (studentId && asString(student && student.enrollStatus, 32) === "active" && groupIds.includes(groupId)) {
        ids.add(studentId);
      }
    });
  }

  return ids;
}

function normalizeRequestedStudentIds(studentIds, limit = 10) {
  const raw = Array.isArray(studentIds) ? studentIds : [];
  const ids = [];
  const seen = new Set();
  raw.forEach((value) => {
    const id = asId(value);
    if (id && !seen.has(id) && ids.length < limit) {
      seen.add(id);
      ids.push(id);
    }
  });
  return ids;
}

function decideCoursePlanRegistration({
  plan = {},
  enrollments = [],
  studentsById = new Map(),
  requestedStudentIds = [],
  callerUid = "",
  isStaff = false,
  bypassCapacity = false,
  migrationCompleted = false,
  now = new Date(),
}) {
  if (!plan || !asId(plan.id)) return { ok: false, code: "PLAN_NOT_FOUND" };
  if (plan.active === false) return { ok: false, code: "PLAN_INACTIVE" };
  if (plan.allowSignup !== true) return { ok: false, code: "SIGNUP_CLOSED" };
  if (isCoursePlanEnded(plan, now)) return { ok: false, code: "PLAN_ENDED" };
  if (plan.visibleOnTeamPage === false && !isStaff) return { ok: false, code: "PLAN_HIDDEN" };

  const ids = normalizeRequestedStudentIds(requestedStudentIds);
  if (!ids.length) return { ok: false, code: "NO_STUDENTS" };

  const students = Array.from(studentsById.values());
  const virtualApprovedStudentIds = getApprovedStudentIdSet({
    plan,
    enrollments,
    students,
    migrationCompleted,
  });
  const existingActiveStudentIds = new Set(
    enrollments.filter(isActiveEnrollment).map((item) => asId(item.studentId)).filter(Boolean)
  );
  virtualApprovedStudentIds.forEach((studentId) => existingActiveStudentIds.add(studentId));
  const acceptedStudentIds = [];
  const rejectedStudentIds = [];

  ids.forEach((studentId) => {
    const student = studentsById.get(studentId);
    if (!student) {
      rejectedStudentIds.push({ studentId, code: "STUDENT_NOT_FOUND" });
      return;
    }
    if (!isStaff && !isStudentOwnedByUid(student, callerUid)) {
      rejectedStudentIds.push({ studentId, code: "STUDENT_FORBIDDEN" });
      return;
    }
    if (asString(student.enrollStatus, 32) === "inactive") {
      rejectedStudentIds.push({ studentId, code: "STUDENT_INACTIVE" });
      return;
    }
    if (existingActiveStudentIds.has(studentId)) {
      rejectedStudentIds.push({ studentId, code: "ALREADY_ENROLLED" });
      return;
    }
    acceptedStudentIds.push(studentId);
  });

  if (!acceptedStudentIds.length) {
    return { ok: false, code: rejectedStudentIds[0] && rejectedStudentIds[0].code || "NO_ELIGIBLE_STUDENTS", rejectedStudentIds };
  }

  const approvedIds = getApprovedStudentIdSet({
    plan,
    enrollments,
    students,
    migrationCompleted,
  });
  const maxCapacity = Number(plan.maxCapacity || 0);
  const shouldBypassCapacity = isStaff === true && bypassCapacity === true;
  const capacityWouldOverflow = Number.isFinite(maxCapacity)
    && maxCapacity > 0
    && approvedIds.size + acceptedStudentIds.length > maxCapacity;
  if (!shouldBypassCapacity && capacityWouldOverflow) {
    return { ok: false, code: "COURSE_FULL", approvedCount: approvedIds.size, maxCapacity, rejectedStudentIds };
  }

  return {
    ok: true,
    acceptedStudentIds,
    rejectedStudentIds,
    approvedCount: approvedIds.size,
    maxCapacity: Number.isFinite(maxCapacity) ? maxCapacity : 0,
    capacityBypassed: shouldBypassCapacity && capacityWouldOverflow,
  };
}

function decideCoursePlanApproval({
  plan = {},
  enrollments = [],
  students = [],
  enrollmentId = "",
  migrationCompleted = false,
}) {
  const targetId = asId(enrollmentId);
  const target = enrollments.find((item) => asId(item.id || item._docId) === targetId);
  if (!target) return { ok: false, code: "ENROLLMENT_NOT_FOUND" };
  const status = asString(target.status, 32);
  if (status === "approved") return { ok: true, alreadyApproved: true };
  if (status !== "pending") return { ok: false, code: "ENROLLMENT_NOT_PENDING" };

  const approvedIds = getApprovedStudentIdSet({ plan, enrollments, students, migrationCompleted });
  const targetStudentId = asId(target.studentId);
  if (targetStudentId) approvedIds.delete(targetStudentId);

  const maxCapacity = Number(plan.maxCapacity || 0);
  if (Number.isFinite(maxCapacity) && maxCapacity > 0 && approvedIds.size >= maxCapacity) {
    return { ok: false, code: "COURSE_FULL", approvedCount: approvedIds.size, maxCapacity };
  }

  return { ok: true, target, approvedCount: approvedIds.size, maxCapacity: Number.isFinite(maxCapacity) ? maxCapacity : 0 };
}

function buildCourseEnrollmentPayload({ id, student, callerUid, nowIso }) {
  const safeId = asId(id);
  const studentId = asId(student && (student.id || student._docId));
  return {
    id: safeId,
    studentId,
    studentName: asString(student && student.name, 80),
    selfUid: asId(student && student.selfUid, 128) || null,
    parentUid: asId(student && student.parentUid, 128) || null,
    status: "pending",
    paidAt: null,
    coachNotes: "",
    reviewerName: null,
    reviewedAt: null,
    createdByUid: asId(callerUid, 128),
    appliedAtIso: asString(nowIso, 40),
  };
}

module.exports = {
  asId,
  asString,
  buildCourseEnrollmentPayload,
  dateStringInTimeZone,
  decideCoursePlanApproval,
  decideCoursePlanRegistration,
  getApprovedStudentIdSet,
  isActiveEnrollment,
  isApprovedEnrollment,
  isCoursePlanEnded,
  isStudentOwnedByUid,
  normalizeRequestedStudentIds,
};
