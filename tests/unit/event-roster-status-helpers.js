"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  createFakeFirestore, FakeHttpsError, FieldValue, createLogger, ROLE_LEVELS,
} = require("./team-callable-fake-db");
const {
  createForceDemoteHandler, createForcePromoteHandler,
} = require("../../functions/event-roster-status");
const { maskId } = require("../../functions/team-membership-core");

// 共用假 HttpsError 不帶 details；本批錯誤要驗證 details.code。
class RosterHttpsError extends FakeHttpsError {
  constructor(code, message, details) {
    super(code, message);
    this.details = details;
  }
}

const indexSource = fs.readFileSync(path.resolve(__dirname, "../../functions/index.js"), "utf8");

// 只切出真實純函式與解析 helper，不載入整個 Functions 入口或 Firebase runtime。
function extractFunction(name) {
  const start = indexSource.search(new RegExp("^(?:async )?function " + name + "\\(", "m"));
  if (start < 0) throw new Error("Missing helper: " + name);
  const end = indexSource.indexOf("\n}", start);
  if (end < 0) throw new Error("Missing helper end: " + name);
  return indexSource.slice(start, end + 2);
}

function loadHelpers(db, log = createLogger()) {
  const names = [
    "sanitizeStr", "isSafeEventDirectDocId", "getEventDocByPublicIdInTransaction",
    "isEventDelegateForUid", "hasActivityManageEntryAccess", "isEventOwnerForUid",
    "canOperatePrivateEventForAccess", "canBroadManageEventForAccess", "canManageScopedEventForAccess",
    "canOperateEventSiteForAccess", "canRemoveConfirmedParticipantForAccess",
    "isCourseLinkedEventData", "isCourseLinkedRegistrationData", "hasCourseLinkedActivityRecordData",
    "getCourseLinkedRegistrationKey", "registrationUniqueKey", "dedupeRegistrations",
    "normalizeTeamReservationSummaries", "registrationTeamReservationTeamId", "rebuildOccupancy",
    "preserveUpcomingEventOccupancyStatus", "findActivityRecordForRegistration", "settleBestEffortPostCommitOps",
  ];
  const sandbox = {
    db, ROLE_LEVELS, console: log, HttpsError: FakeHttpsError,
    COURSE_LINK_SOURCE_EDU_LESSON: "eduCourseLesson",
    COURSE_LINK_STATE_CREATED_BY_COURSE: "created_by_course",
    COURSE_LINK_STATE_PRIORITY_OVERLAY: "priority_overlay",
  };
  vm.runInNewContext(names.map(extractFunction).join("\n"), sandbox, { filename: "event-roster-helpers.vm.js" });
  return Object.fromEntries(names.map((name) => [name, sandbox[name]]));
}

function access(role = "super_admin", permissions = [], capabilities = []) {
  return {
    role, isSuperAdmin: role === "super_admin",
    hasPermission: (code) => role === "super_admin" || permissions.includes(code),
    hasActivityCapability: (code) => role === "user" && capabilities.includes(code),
  };
}

function registration(id = "regA", status = "confirmed", extra = {}) {
  return {
    id, _docId: id, eventId: "evtA", userId: "uidA", userName: "測試甲",
    participantType: "self", status, registeredAt: "2026-10-01T00:00:00.000Z", ...extra,
  };
}

function createHarness({
  action = "demote", event = {}, regs, ars, actor = access(), eventDocId = "evtA", extraSeed = {},
} = {}) {
  const registrations = regs || [registration("regA", action === "demote" ? "confirmed" : "waitlisted")];
  const activityRecords = ars || [{
    _docId: "arA", uid: "uidA", eventId: "evtA", status: action === "demote" ? "registered" : "waitlisted",
  }];
  const seed = {
    [`events/${eventDocId}`]: {
      id: "evtA", title: "測試活動", date: "2026/11/01", location: "測試場地",
      max: 1, current: 999, waitlist: 999, status: "full", creatorUid: "uidB", ...event,
    },
    ...Object.fromEntries(registrations.map((reg) => [`events/${eventDocId}/registrations/${reg._docId}`, reg])),
    ...Object.fromEntries(activityRecords.map((ar) => [`events/${eventDocId}/activityRecords/${ar._docId}`, ar])),
    ...extraSeed,
  };
  const fake = createFakeFirestore(seed);
  const logger = createLogger();
  const helpers = loadHelpers(fake.db, logger);
  const claimed = new Set();
  // 依 §16.2 不擴充 fake：交易外 claim 以獨立 stub 模擬；真 create 另有契約案例。
  const claimRequestId = jest.fn(async ({ requestId }) => {
    if (!requestId) return true;
    if (claimed.has(requestId)) return false;
    claimed.add(requestId);
    return true;
  });
  const deps = {
    ...helpers, db: fake.db, HttpsError: RosterHttpsError, FieldValue, logger, maskId,
    getCallerAccessContext: jest.fn(async () => actor), claimRequestId,
    writeInboxNotification: jest.fn(async () => undefined),
    writeAuditEntryInternal: jest.fn(async () => undefined),
    settleBestEffortPostCommitOps: jest.fn(helpers.settleBestEffortPostCommitOps),
    promoteWaitlistForAvailableSeats: jest.fn(), adjustExpInternal: jest.fn(),
  };
  const make = action === "demote" ? createForceDemoteHandler : createForcePromoteHandler;
  return {
    fake, deps, helpers, seed, eventPath: `events/${eventDocId}`,
    invoke: (data = {}, auth = { uid: "uidB" }) => make(deps)({
      auth, data: { eventId: "evtA", userId: "uidA", ...data },
    }),
  };
}

async function expectRejected(harness, data, code, message) {
  const before = harness.fake.state.writes.length;
  await expect(harness.invoke(data)).rejects.toMatchObject({ code, message });
  expect(harness.fake.state.writes).toHaveLength(before);
  expect(harness.deps.writeInboxNotification).not.toHaveBeenCalled();
  expect(harness.deps.writeAuditEntryInternal).not.toHaveBeenCalled();
}

module.exports = { indexSource, extractFunction, loadHelpers, access, registration, createHarness, expectRejected };
