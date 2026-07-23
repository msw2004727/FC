const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\r\n');
}

function loadCoursePermissionHelpers(functionsSource) {
  const source = between(
    functionsSource,
    'function isEventDelegateForUid',
    'async function roleExists'
  );
  const sandbox = {
    ROLE_LEVELS: {
      user: 0,
      coach: 1,
      captain: 2,
      venue_owner: 3,
      admin: 4,
      super_admin: 5,
    },
    sanitizeStr(value, maxLength = 1000) {
      return String(value || '').trim().slice(0, maxLength);
    },
  };
  vm.runInNewContext(`${source}
this.permissionHelpers = {
  canOperatePrivateEventForAccess,
  canOperateEventSiteForAccess,
  canRemoveConfirmedParticipantForAccess,
  canManageSingleEventRosterForAccess,
  canEditEventBasicForAccess,
};`, sandbox);
  return sandbox.permissionHelpers;
}

function makeAccess({ role = 'user', permissions = [], capabilities = [], isSuperAdmin = false } = {}) {
  return {
    role,
    isSuperAdmin,
    hasPermission: code => permissions.includes(code),
    hasActivityCapability: code => capabilities.includes(code),
  };
}

function between(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = endNeedle ? source.indexOf(endNeedle, start + startNeedle.length) : -1;
  return source.slice(start, end === -1 ? source.length : end);
}

function loadUnlimitedCapacityHelpers(functionsSource) {
  const demotionSource = between(
    functionsSource,
    'function getRegistrationRegisteredAtMillis',
    'function buildCourseLinkedRegistrationData'
  );
  const capacitySource = [
    between(functionsSource, 'function registrationUniqueKey', 'function countUniqueConfirmedRegistrations'),
    between(functionsSource, 'function normalizeTeamReservationSummaries', 'async function loadTeamReservationTeamsForTransaction'),
    between(functionsSource, 'function registrationTeamReservationTeamId', 'function findTeamReservationForUser'),
    between(functionsSource, 'function applyTeamReservationFields', 'function getUserReservationMembershipTeamIds'),
    between(functionsSource, 'function rebuildOccupancy', 'async function adjustExpInternal'),
  ].join('\n');
  const sandbox = {
    Set,
    Map,
    Array,
    Number,
    Math,
    String,
    Date,
    encodeURIComponent,
    getTimestampMillis(value) {
      if (value && typeof value.toMillis === 'function') return value.toMillis();
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : Number.NaN;
    },
    sanitizeStr(value, maxLength = 1000) {
      return String(value || '').trim().slice(0, maxLength);
    },
    getCourseLinkedRegistrationKey(reg = {}) {
      return reg.courseStudentId ? `course_student_${reg.courseStudentId}` : '';
    },
    isCourseLinkedRegistrationData(reg = {}) {
      return Boolean(reg.courseStudentId || reg.courseLinkId || reg.source === 'eduCourseLesson');
    },
    findTeamReservationForUser() {
      return null;
    },
  };
  vm.runInNewContext(`${demotionSource}
${capacitySource}
this.capacityHelpers = {
  demoteConfirmedRegistrationsToCapacity,
  decideRegistrationSeat,
  promoteWaitlistForAvailableSeats,
  rebuildOccupancy,
};`, sandbox);
  return sandbox.capacityHelpers;
}

describe('course-linked event registration sync contracts', () => {
  const functionsSource = read('functions/index.js');

  test('zero capacity consistently means unlimited rather than sold out', () => {
    const helpers = loadUnlimitedCapacityHelpers(functionsSource);
    const confirmed = [{ _docId: 'confirmed-a', userId: 'a', userName: 'A', status: 'confirmed', registeredAt: 1 }];
    expect(Array.from(helpers.demoteConfirmedRegistrationsToCapacity({ max: 0 }, confirmed))).toEqual([]);
    expect(confirmed[0].status).toBe('confirmed');

    const newRegistration = { _docId: 'new-b', userId: 'b', userName: 'B', participantType: 'self' };
    expect(helpers.decideRegistrationSeat({ max: 0, status: 'open' }, confirmed, newRegistration).status).toBe('confirmed');

    const waitlisted = [
      {
        _docId: 'course-c',
        userId: 'parent-c',
        userName: 'Course C',
        courseStudentId: 'student-c',
        courseRosterOverride: 'waitlisted',
        courseRosterOverrideSource: 'manual',
        status: 'waitlisted',
        registeredAt: 2,
      },
      { _docId: 'ordinary-d', userId: 'd', userName: 'D', status: 'waitlisted', registeredAt: 3 },
    ];
    expect(Array.from(helpers.promoteWaitlistForAvailableSeats(
      { max: 0, status: 'open' },
      waitlisted,
      { excludeManualCourseRosterOverrides: true }
    )).map(reg => reg._docId)).toEqual(['course-c', 'ordinary-d']);
    expect(waitlisted.every(reg => reg.status === 'confirmed')).toBe(true);
    expect(helpers.rebuildOccupancy({ max: 0, status: 'full' }, waitlisted)).toEqual(
      expect.objectContaining({ current: 2, realCurrent: 2, status: 'open' })
    );

    const editSource = between(
      functionsSource,
      'exports.updateCourseLinkedEvent = onCall(',
      'exports.manageCourseLinkedRegistrationStatus = onCall('
    );
    expect(editSource).toContain('const shouldDemoteForCapacity = nextMax > 0 && (oldMax <= 0 || nextMax < oldMax)');
    expect(editSource).toContain('(nextMax <= 0 && oldMax > 0)');
    expect(editSource).toContain('(nextMax > 0 && (oldMax <= 0 || nextMax > oldMax))');
  });

  test('activity cancellation writes course leave and registration state in the same transaction', () => {
    const helperSource = between(
      functionsSource,
      'async function loadCourseCancellationAttendanceContextsInTransaction',
      'async function syncCourseAttendanceToLinkedEvent'
    );
    const cancelSource = between(
      functionsSource,
      'exports.cancelRegistration = onCall(',
      'exports.watchRegistrationCallableHealth'
    );

    expect(helperSource).toContain('getCourseLinkedStudentInTransaction(transaction, teamDoc.ref, reg)');
    expect(helperSource).toContain('if (cancelReason === "user_cancel" && !isStudentOwnedByUid(student, callerUid))');
    expect(helperSource).toContain('COURSE_ATTENDANCE_ALREADY_SIGNED_IN');
    expect(helperSource).toContain('transaction.update(item.ref, { status: "removed", updatedAt: now })');
    expect(helperSource).toContain('transaction.set(context.leaveRef, {');
    expect(helperSource).toContain('kind: "leave"');
    expect(helperSource).toContain('source: "eventRegistrationCancellation"');
    expect(cancelSource).toContain('loadCourseCancellationAttendanceContextsInTransaction(');
    expect(cancelSource).toContain('writeCourseCancellationAttendanceInTransaction(transaction, courseAttendanceContexts, callerUid)');
    expect(cancelSource).toContain('regUpdate.courseAttendanceKind = "leave"');
    expect(cancelSource).toContain('regUpdate.courseRosterOverride = null');
    expect(cancelSource).not.toContain('COURSE_LINKED_REGISTRATION_MANAGED_BY_COURSE');
    expect(cancelSource).toContain('const shouldNormalizeUnlimitedWaitlist = normalizeNonNegativeInteger(ed.max, 0) <= 0');
    expect(cancelSource).toContain('if (hadConfirmed || shouldNormalizeUnlimitedWaitlist)');
    expect(cancelSource).toContain('shouldNormalizeUnlimitedWaitlist');
    expect(cancelSource).toContain('? { prioritizeCourseLinkedCandidates: true }');
    expect(cancelSource).toContain('!isCourseLinkedRegistrationData(r) && sanitizeStr(r.userId, 128) !== callerUid');
  });

  test('permission helpers enforce exact event scope and private owner compatibility', () => {
    const helpers = loadCoursePermissionHelpers(functionsSource);
    const unrelated = { creatorUid: 'owner-a', privateEvent: false };
    const ownerUidOnly = { creatorUid: 'creator-a', ownerUid: 'owner-b', privateEvent: true };
    const captainUidOnly = { creatorUid: 'creator-a', captainUid: 'captain-b', privateEvent: true };
    const delegated = { creatorUid: 'creator-a', delegateUids: ['delegate-b'], privateEvent: true };

    expect(helpers.canOperateEventSiteForAccess(
      makeAccess({ role: 'coach', permissions: ['activity.manage.entry'] }),
      unrelated,
      'coach-b'
    )).toBe(false);
    expect(helpers.canOperateEventSiteForAccess(
      makeAccess({ role: 'coach', permissions: ['activity.manage.entry'] }),
      ownerUidOnly,
      'owner-b'
    )).toBe(true);
    expect(helpers.canRemoveConfirmedParticipantForAccess(
      makeAccess({ role: 'coach', permissions: ['activity.manage.entry'] }),
      captainUidOnly,
      'captain-b'
    )).toBe(true);
    expect(helpers.canOperateEventSiteForAccess(
      makeAccess({ permissions: ['event.scan'] }),
      ownerUidOnly,
      'owner-b'
    )).toBe(true);
    expect(helpers.canOperateEventSiteForAccess(
      makeAccess({ capabilities: ['user.activity.site_operate'] }),
      delegated,
      'delegate-b'
    )).toBe(true);
    expect(helpers.canOperatePrivateEventForAccess(
      makeAccess({ permissions: ['event.edit_all'] }),
      ownerUidOnly,
      'global-but-unrelated'
    )).toBe(false);
    expect(helpers.canOperatePrivateEventForAccess(
      makeAccess({ role: 'super_admin', isSuperAdmin: true }),
      ownerUidOnly,
      'super'
    )).toBe(true);
    expect(helpers.canOperateEventSiteForAccess(
      makeAccess(),
      { creatorUid: 'creator-a', delegates: [{ uid: 'metadata-only' }], delegateUids: [] },
      'metadata-only'
    )).toBe(false);
  });

  test('terminal manager retries keep the least privilege of the original waitlist action', () => {
    const helpers = loadCoursePermissionHelpers(functionsSource);
    const event = { creatorUid: 'creator-a', delegateUids: ['delegate-a'], privateEvent: false };
    const delegate = makeAccess();
    expect(helpers.canOperateEventSiteForAccess(delegate, event, 'delegate-a')).toBe(true);
    expect(helpers.canRemoveConfirmedParticipantForAccess(delegate, event, 'delegate-a')).toBe(false);
    expect(helpers.canManageSingleEventRosterForAccess(
      delegate,
      event,
      'delegate-a',
      [{ status: 'removed' }]
    )).toBe(true);
  });

  test('course cancellation attendance writer atomically replaces registered attendance with one leave', () => {
    const helperSource = between(
      functionsSource,
      'function writeCourseCancellationAttendanceInTransaction',
      'async function syncCourseAttendanceToLinkedEvent'
    );
    const now = { marker: 'serverTimestamp' };
    const sandbox = {
      FieldValue: { serverTimestamp: () => now },
      sanitizeStr: value => String(value || '').trim(),
      getCourseLinkedStudentName: student => student.name || '',
      Date,
    };
    vm.runInNewContext(`${helperSource}
this.writeCourseCancellationAttendanceInTransaction = writeCourseCancellationAttendanceInTransaction;`, sandbox);

    const transaction = { update: jest.fn(), set: jest.fn() };
    const leaveRef = { id: 'leave-1' };
    sandbox.writeCourseCancellationAttendanceInTransaction(transaction, [{
      courseLinkId: 'link-1',
      teamId: 'team-1',
      planId: 'plan-1',
      sessionId: 'session-1',
      session: { date: '2026-07-23', sessionNumber: 8 },
      student: { name: 'Student A', parentUid: 'parent-a', selfUid: '' },
      studentId: 'student-a',
      activeLeave: null,
      activeRegistered: [{ ref: { id: 'registered-1' } }, { ref: { id: 'registered-2' } }],
      leaveRef,
    }], 'parent-a');

    expect(transaction.update).toHaveBeenCalledTimes(2);
    expect(transaction.update).toHaveBeenNthCalledWith(
      1,
      { id: 'registered-1' },
      { status: 'removed', updatedAt: now }
    );
    expect(transaction.set).toHaveBeenCalledTimes(1);
    expect(transaction.set).toHaveBeenCalledWith(
      leaveRef,
      expect.objectContaining({
        kind: 'leave',
        status: 'active',
        source: 'eventRegistrationCancellation',
        studentId: 'student-a',
        parentUid: 'parent-a',
        createdByUid: 'parent-a',
        createdAt: now,
        updatedAt: now,
      }),
      { merge: true }
    );

    transaction.update.mockClear();
    transaction.set.mockClear();
    sandbox.writeCourseCancellationAttendanceInTransaction(transaction, [{
      activeLeave: { id: 'existing-leave' },
      activeRegistered: [],
    }], 'parent-a');
    expect(transaction.update).not.toHaveBeenCalled();
    expect(transaction.set).not.toHaveBeenCalled();
  });

  test('course synchronization never adopts an ordinary user registration by shared UID', () => {
    const syncSource = between(functionsSource, 'async function syncCourseAttendanceToLinkedEvent', 'function courseEnrollmentDocId');
    expect(syncSource).toContain('const targetExistingReg = existingCourseReg || null');
    expect(syncSource).not.toContain('findManualRegistrationToAdoptForCourse');
  });

  test('course delegate authorization fields must be written together with identical UIDs', () => {
    const helperSource = between(
      functionsSource,
      'function validateCourseLinkedEventDelegateProjection',
      'function courseLinkedEventUpdateTouchesAny'
    );
    class FakeHttpsError extends Error {
      constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
      }
    }
    const sandbox = {
      HttpsError: FakeHttpsError,
      Object,
      Array,
      Set,
      sanitizeStr(value, maxLength = 1000) {
        return String(value || '').trim().slice(0, maxLength);
      },
    };
    vm.runInNewContext(`${helperSource}
this.validateCourseLinkedEventDelegateProjection = validateCourseLinkedEventDelegateProjection;`, sandbox);
    expect(() => sandbox.validateCourseLinkedEventDelegateProjection({
      delegates: [{ uid: 'delegate-a', name: 'A' }],
    })).toThrow('DELEGATE_FIELDS_MUST_BE_UPDATED_TOGETHER');
    expect(() => sandbox.validateCourseLinkedEventDelegateProjection({
      delegates: [{ uid: 'delegate-a', name: 'A' }],
      delegateUids: ['delegate-b'],
    })).toThrow('DELEGATE_FIELDS_MISMATCH');
    expect(() => sandbox.validateCourseLinkedEventDelegateProjection({
      delegates: [{ uid: 'delegate-a', name: 'A' }],
      delegateUids: ['delegate-a'],
    })).not.toThrow();
  });

  test('course occupancy keeps upcoming until the scheduled registration opening', () => {
    const helperSource = between(
      functionsSource,
      'function preserveUpcomingEventOccupancyStatus',
      'function findActivityRecordForRegistration'
    );
    const sandbox = {
      sanitizeStr(value, maxLength = 1000) {
        return String(value || '').trim().slice(0, maxLength);
      },
    };
    vm.runInNewContext(`${helperSource}
this.preserveUpcomingEventOccupancyStatus = preserveUpcomingEventOccupancyStatus;`, sandbox);
    expect(sandbox.preserveUpcomingEventOccupancyStatus(
      { status: 'upcoming' },
      { status: 'full', current: 10 }
    )).toEqual({ status: 'upcoming', current: 10 });
    expect(sandbox.preserveUpcomingEventOccupancyStatus(
      { status: 'upcoming' },
      { status: 'cancelled', current: 10 }
    )).toEqual({ status: 'cancelled', current: 10 });
    expect(sandbox.preserveUpcomingEventOccupancyStatus(
      { status: 'open' },
      { status: 'full', current: 10 }
    )).toEqual({ status: 'full', current: 10 });
  });

  test('course team split sanitizer accepts Date and ISO lock values and rejects unknown fields', () => {
    const helperSource = between(
      functionsSource,
      'function normalizeCallableEventTimestamp',
      'function sanitizeCourseLinkedEventUpdates'
    );
    class FakeTimestamp {
      constructor(seconds, nanoseconds = 0) {
        this.seconds = seconds;
        this.nanoseconds = nanoseconds;
      }
      static fromDate(value) {
        return new FakeTimestamp(Math.floor(value.getTime() / 1000), 0);
      }
      toDate() {
        return new Date(this.seconds * 1000);
      }
    }
    class FakeHttpsError extends Error {
      constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
      }
    }
    const sandbox = {
      Timestamp: FakeTimestamp,
      HttpsError: FakeHttpsError,
      Date,
      Number,
      JSON,
      Object,
      Array,
      Set,
      sanitizeStr(value, maxLength = 1000) {
        return String(value || '').trim().slice(0, maxLength);
      },
    };
    vm.runInNewContext(`${helperSource}
this.sanitizeCourseLinkedEventTeamSplit = sanitizeCourseLinkedEventTeamSplit;`, sandbox);
    const base = {
      enabled: true,
      mode: 'self-select',
      balanceCap: true,
      selfSelectLockHours: 6,
      teams: [
        { key: 'A', color: '#ef4444', name: 'Red' },
        { key: 'B', color: '#3b82f6', name: 'Blue' },
      ],
    };
    const fromDate = sandbox.sanitizeCourseLinkedEventTeamSplit({
      ...base,
      lockAt: new Date('2026-07-23T10:00:00.000Z'),
    });
    const fromIso = sandbox.sanitizeCourseLinkedEventTeamSplit({
      ...base,
      lockAt: '2026-07-23T10:00:00.000Z',
    });
    expect(fromDate.lockAt).toBeInstanceOf(FakeTimestamp);
    expect(fromIso.lockAt).toBeInstanceOf(FakeTimestamp);
    expect(() => sandbox.sanitizeCourseLinkedEventTeamSplit({
      ...base,
      lockAt: null,
      injected: true,
    })).toThrow('teamSplit is invalid');
  });

  test('best-effort post-commit failures are observed without rejecting the business result', async () => {
    const helperSource = between(
      functionsSource,
      'async function settleBestEffortPostCommitOps',
      'function sanitizeJsonValue'
    );
    const errorSpy = jest.fn();
    const sandbox = {
      Promise,
      Array,
      console: { error: errorSpy },
      sanitizeStr(value, maxLength = 1000) {
        return String(value || '').trim().slice(0, maxLength);
      },
    };
    vm.runInNewContext(`${helperSource}
this.settleBestEffortPostCommitOps = settleBestEffortPostCommitOps;`, sandbox);
    const outcome = await sandbox.settleBestEffortPostCommitOps('test-op', [
      Promise.resolve('ok'),
      Promise.reject(Object.assign(new Error('side effect failed'), { code: 'SIDE_EFFECT_FAILED' })),
    ]);
    expect(outcome.failureCount).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[bestEffortPostCommitOps]',
      expect.objectContaining({
        label: 'test-op',
        failureCount: 1,
        failures: [expect.objectContaining({
          code: 'SIDE_EFFECT_FAILED',
          message: 'side effect failed',
        })],
      })
    );
    expect(functionsSource).not.toContain('Promise.allSettled(postOps).catch');
  });

  test('course registrations preserve every legitimate self and parent owner identity', () => {
    const helperSource = between(
      functionsSource,
      'function getCourseLinkedRegistrationOwnerUids',
      'function getCourseLinkedStudentIds'
    );
    const sandbox = {
      Set,
      Array,
      sanitizeStr(value, maxLength = 1000) {
        return String(value || '').trim().slice(0, maxLength);
      },
    };
    vm.runInNewContext(`${helperSource}
this.getCourseLinkedRegistrationOwnerUids = getCourseLinkedRegistrationOwnerUids;`, sandbox);
    expect(Array.from(sandbox.getCourseLinkedRegistrationOwnerUids({
      selfUid: 'self-a',
      parentUid: 'parent-a',
      uid: 'self-a',
      lineUserId: '',
    }))).toEqual(['self-a', 'parent-a']);
    expect(Array.from(sandbox.getCourseLinkedRegistrationOwnerUids({
      parentUid: 'parent-a',
    }))).toEqual(['parent-a']);
    expect(functionsSource).toContain('courseOwnerUids: getCourseLinkedRegistrationOwnerUids(student)');
  });

  test('course student identity is exact and never inferred from parent UID alone', () => {
    const helperSource = between(
      functionsSource,
      'async function loadCourseCancellationAttendanceContextsInTransaction',
      'async function syncCourseAttendanceToLinkedEvent'
    );
    const rosterSource = between(
      functionsSource,
      'exports.manageCourseLinkedRegistrationStatus = onCall(',
      'exports.cancelRegistration = onCall('
    );
    const lifecycleSource = read('js/modules/event/event-manage-lifecycle.js');
    const waitlistSource = read('js/modules/event/event-manage-waitlist.js');

    expect(helperSource).toContain('sanitizeStr(reg.courseStudentId, 100)');
    expect(helperSource).toContain('sanitizeStr(reg.courseLinkId, 128) !== courseLinkId');
    expect(helperSource).toContain('sanitizeStr(reg.courseSessionId, 100) !== sessionId');
    expect(rosterSource).toContain('const registrationId = sanitizeStr(request.data?.registrationId, 120)');
    expect(rosterSource).toContain('allRegs.find((reg) => reg._docId === registrationId)');
    expect(rosterSource).toContain('getCourseLinkedEventValidationFailure(eventData, target.courseLinkId)');
    expect(lifecycleSource).toContain('registrationIds: [reg._docId || reg.id]');
    expect(waitlistSource).toContain("registrationId: userWaitlistedRecords[0]._docId || userWaitlistedRecords[0].id");
    expect(waitlistSource).toContain("registrationId: userConfirmedRecords[0]._docId || userConfirmedRecords[0].id");
  });

  test('owner/delegate scope is required unless caller has true global edit permission', () => {
    const broadSource = between(
      functionsSource,
      'function canBroadManageEventForAccess',
      'function canManageScopedEventForAccess'
    );
    const rosterPermissionSource = between(
      functionsSource,
      'function canOperateEventSiteForAccess',
      'async function roleExists'
    );

    expect(broadSource).toContain('access.isSuperAdmin || access.hasPermission("event.edit_all")');
    expect(broadSource).not.toContain('ROLE_LEVELS.coach');
    expect(rosterPermissionSource).toContain('const scoped = canManageScopedEventForAccess(eventData, uid)');
    expect(rosterPermissionSource).toContain('if (!scoped) return false');
    expect(rosterPermissionSource).toContain('canRemoveConfirmedParticipantForAccess');
    expect(rosterPermissionSource).toContain('canManageSingleEventRosterForAccess');
  });

  test('manual promote and demote persist an override without changing course provenance', () => {
    const rosterSource = between(
      functionsSource,
      'exports.manageCourseLinkedRegistrationStatus = onCall(',
      'exports.cancelRegistration = onCall('
    );

    expect(rosterSource).toContain('courseRosterOverride: nextStatus');
    expect(rosterSource).toContain('courseRosterOverrideSource: "manual"');
    expect(rosterSource).toContain('status: action === "promote" ? "registered" : "waitlisted"');
    expect(rosterSource).not.toContain('courseLinkId:');
    expect(rosterSource).not.toContain('courseStudentId:');
  });

  test('automatic promotion persists capacity override for course registrations', () => {
    const syncSource = between(functionsSource, 'async function syncCourseAttendanceToLinkedEvent', 'function courseEnrollmentDocId');
    const occurrences = syncSource.match(/update\.courseRosterOverride = "confirmed"/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    expect(syncSource).toContain('update.courseRosterOverrideSource = "capacity"');
    expect(syncSource).toContain('excludeManualCourseRosterOverrides: true');
    expect(syncSource).toContain('courseRosterOverride: null');
    expect(syncSource).toContain('courseRosterOverrideSource: null');
  });

  test('event-managed edits survive later course sync while lifecycle still follows the course', () => {
    const detailSyncSource = between(
      functionsSource,
      'async function syncCourseLessonEventDetailsFromSessionInternal',
      'function courseEnrollmentDocId'
    );
    const repairSource = between(
      functionsSource,
      'function buildCourseConvertedEventRepairPatch',
      'function courseConvertedEventCapacity'
    );
    const editSource = between(
      functionsSource,
      'exports.updateCourseLinkedEvent = onCall(',
      'exports.manageCourseLinkedRegistrationStatus = onCall('
    );

    expect(editSource).toContain('courseEventDetailsManagedByEvent: true');
    expect(detailSyncSource).toContain('const detailsManagedByEvent = eventData.courseEventDetailsManagedByEvent === true');
    expect(detailSyncSource).toContain('if (!detailsManagedByEvent)');
    expect(detailSyncSource).toContain('const demoted = detailsManagedByEvent');
    expect(detailSyncSource).toContain('const promoted = detailsManagedByEvent || statusUpdate');
    expect(detailSyncSource).toContain('if (statusUpdate) update.status = statusUpdate');
    expect(detailSyncSource).toContain('statusUpdate || sanitizeStr(eventData.status, 32) || "open"');
    expect(repairSource).toContain('const detailsManagedByEvent = existing.courseEventDetailsManagedByEvent === true');
    expect(repairSource).toContain('...(detailsManagedByEvent ? {} : {');
  });

  test('course event edit validates projected privacy, map, early-bird, and typed team lock fields', () => {
    const editHelpers = between(
      functionsSource,
      'function normalizeCallableEventTimestamp',
      'function courseRosterMutationResult'
    );
    const editSource = between(
      functionsSource,
      'exports.updateCourseLinkedEvent = onCall(',
      'exports.manageCourseLinkedRegistrationStatus = onCall('
    );

    expect(editHelpers).toContain('sanitizeCourseLinkedEventTeamSplit');
    expect(editHelpers).toContain('normalizeCallableEventTimestamp(rawTeamSplit.lockAt');
    expect(editHelpers).toContain('normalizeCallableEventIsoString(rawUpdates.mapLocationUpdatedAt');
    expect(editHelpers).toContain('numberValue < min || numberValue > max');
    expect(editHelpers).toContain('!Number.isInteger(numberValue) || numberValue < 0 || numberValue > 500');
    expect(editHelpers).toContain('projected.mapLocationConfirmed === true');
    expect(editHelpers).toContain('projected.gpsEnabled !== true || !validLat || !validLng');
    expect(editSource).toContain('canOperatePrivateEventForAccess(access, projectedEventData, callerUid)');
    expect(editSource).toContain('validateCourseLinkedEventDelegateProjection(updates)');
  });

  test('new course edit and roster actions remain visible in the audit allowlists', () => {
    expect(functionsSource).toContain('"course_linked_event_edit"');
    expect(functionsSource).toContain('"event_waitlist_promote"');
    expect(functionsSource).toContain('"event_waitlist_demote"');
    expect(functionsSource).toContain('"appliedFields"');
    expect(functionsSource).toContain('if (Array.isArray(value))');
  });

  test('single-student and multi-student cancellation always use the callable', () => {
    const signupSource = read('js/modules/event/event-detail-signup.js');
    const companionSource = read('js/modules/event/event-detail-companion.js');

    expect(signupSource).toContain('const distinctSelfTargetKeys = new Set(selfRegs.map(reg => {');
    expect(signupSource).toContain('if (companionRegs.length > 0 || distinctSelfTargetKeys.size > 1)');
    expect(signupSource).toContain('if (myRegs.some(courseReg => (');
    expect(signupSource).toContain('useCF = true');
    expect(companionSource).toContain('const selectedRegs = (this._companionCancelRegs || [])');
    expect(companionSource).toContain('if (selectedRegs.some(reg => (');
    expect(companionSource).toContain('registrationIds: checked');
  });
});
