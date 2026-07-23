/**
 * Cloud Functions — unit tests (mock-based)
 *
 * Tests the pure logic extracted from functions/index.js.
 * Since Cloud Functions depend on Firebase Admin SDK,
 * we mock the SDK and test the validation/business logic.
 *
 * Covers 30 exported functions' input validation and key decision logic.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  createSportsApiProScoreboardExports,
  __test: sportsApiProTest,
} = require('../../functions/scoreboard-sportsapipro');

// ===========================================================================
// Constants extracted from functions/index.js:27-74
// ===========================================================================
const VALID_ROLES = new Set([
  "user", "coach", "captain", "venue_owner", "admin", "super_admin",
]);
const DISABLED_PERMISSION_CODES = new Set(["admin.roles.entry"]);
const LEGACY_PERMISSION_CODE_REPLACEMENTS = Object.freeze({
  "event.edit_own": "event.edit_self",
  "event.delete_own": "event.delete_self",
  "event.scan_qr": "event.scan",
  "event.view_participants": "event.view_registrations",
  "team.manage_own": "team.manage_self",
  "team.approve_join": "team.review_join",
  "team.create_team_event": "team.create_event",
  "team.toggle_event_public": "team.toggle_event_visibility",
  "admin.teams.entry": "team.manage.entry",
  "admin.scoreboard.entry": "",
});
const ROLE_LEVELS = Object.freeze({
  user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5,
});
const INHERENT_ROLE_PERMISSIONS = Object.freeze({
  coach:       [],
  captain:     [],
  venue_owner: [],
  super_admin: ["admin.repair.event_blocklist", "admin.seo.entry"],
});
const DEFAULT_ROLE_ENTRY_PERMISSION_RULES = Object.freeze([
  { code: "activity.manage.entry", minRole: "coach" },
  { code: "admin.tournaments.entry", minRole: "coach" },
  { code: "team.manage.entry", minRole: "captain" },
  { code: "admin.games.entry", minRole: "admin" },
  { code: "admin.users.entry", minRole: "admin" },
  { code: "admin.banners.entry", minRole: "admin" },
  { code: "admin.shop.entry", minRole: "admin" },
  { code: "admin.messages.entry", minRole: "admin" },
  { code: "admin.seo.entry", minRole: "admin" },
  { code: "admin.repair.entry", minRole: "admin" },
  { code: "admin.dashboard.entry", minRole: "super_admin" },
  { code: "admin.themes.entry", minRole: "super_admin" },
  { code: "admin.exp.entry", minRole: "super_admin" },
  { code: "admin.auto_exp.entry", minRole: "super_admin" },
  { code: "admin.notif.entry", minRole: "super_admin" },
  { code: "admin.announcements.entry", minRole: "super_admin" },
  { code: "admin.achievements.entry", minRole: "super_admin" },
  { code: "admin.logs.entry", minRole: "super_admin" },
  { code: "admin.inactive.entry", minRole: "super_admin" },
]);
const DEFAULT_ADMIN_PERMISSION_CODES = Object.freeze([
  "team.create",
  "team.manage_all",
  "event.edit_all",
  "admin.tournaments.manage_all",
  "admin.tournaments.end",
  "admin.tournaments.reopen",
  "admin.tournaments.delete",
]);
const USER_PERMISSION_GRANT_ALLOWED_CODES = new Set([
  ...DEFAULT_ROLE_ENTRY_PERMISSION_RULES.map(rule => rule.code),
  "event.create",
  "event.edit_self",
  "event.edit_all",
  "event.delete_self",
  "event.delete",
  "event.publish",
  "event.scan",
  "event.manual_checkin",
  "event.view_registrations",
  "admin.tournaments.create",
  "admin.tournaments.manage_all",
  "admin.tournaments.review",
  "admin.tournaments.end",
  "admin.tournaments.reopen",
  "admin.tournaments.delete",
  "team.create",
  "team.manage_all",
  "team.manage_self",
  "team.review_join",
  "team.assign_coach",
  "team.create_event",
  "team.toggle_event_visibility",
  "admin.users.edit_profile",
  "admin.users.change_role",
  "admin.users.restrict",
  "admin.messages.compose",
  "admin.messages.delete",
  "admin.repair.team_join_repair",
  "admin.repair.no_show_adjust",
  "admin.repair.data_sync",
  "admin.repair.event_blocklist",
  "activity.view_noshow",
  "admin.logs.error_read",
  "admin.logs.error_delete",
  "admin.logs.audit_read",
  "admin.notif.toggle",
  "profile.secondary_identity",
]);
const ALLOWED_AUDIT_ACTIONS = new Set([
  "login_success", "login_failure", "logout",
  "event_signup", "event_cancel_signup",
  "team_join_request", "team_join_approve", "team_join_reject",
  "role_change", "admin_user_edit",
]);
const ALLOWED_AUDIT_TARGET_TYPES = new Set([
  "system", "user", "event", "team", "message",
]);
const ALLOWED_AUDIT_RESULTS = new Set(["success", "failure"]);
const ALLOWED_AUDIT_SOURCES = new Set(["web", "liff", "system", "cloud_function"]);
const LINE_NOTIFICATION_FORCED_SOURCES = [
  "template:waitlist_promoted",
  "template:event_cancelled",
  "template:event_changed",
];
const LINE_NOTIFICATION_TOGGLE_ALLOWED_KEYS = new Set([
  "category_activity",
  "category_system",
  "category_tournament",
  "type_signup_success",
  "type_cancel_signup",
  "type_waitlist_demoted",
  "type_event_relisted",
  "type_role_upgrade",
  "type_welcome",
]);
const SECONDARY_IDENTITY_PERMISSION = "profile.secondary_identity";

// ===========================================================================
// Extracted validation logic
// ===========================================================================

/** createCustomToken input validation (index.js ~line 90-110) */
function validateCreateCustomTokenInput(data, auth) {
  if (!auth) return { error: 'unauthenticated', msg: 'Unauthenticated' };
  if (!data.accessToken || typeof data.accessToken !== 'string')
    return { error: 'invalid-argument', msg: 'Missing LINE access token' };
  return null;
}

/** writeAuditLog input validation (index.js ~line 150-190) */
function validateAuditLogInput(data) {
  if (!data.action || !ALLOWED_AUDIT_ACTIONS.has(data.action))
    return { error: 'invalid-argument', msg: 'Invalid audit action' };
  if (data.targetType && !ALLOWED_AUDIT_TARGET_TYPES.has(data.targetType))
    return { error: 'invalid-argument', msg: 'Invalid target type' };
  if (data.result && !ALLOWED_AUDIT_RESULTS.has(data.result))
    return { error: 'invalid-argument', msg: 'Invalid result' };
  if (data.source && !ALLOWED_AUDIT_SOURCES.has(data.source))
    return { error: 'invalid-argument', msg: 'Invalid source' };
  return null;
}

/** syncUserRole validation (index.js ~line 400-420) */
function validateSyncUserRole(data, callerRole) {
  if (!data.targetUid || typeof data.targetUid !== 'string')
    return { error: 'invalid-argument', msg: 'Missing targetUid' };
  if (!data.newRole || !VALID_ROLES.has(data.newRole))
    return { error: 'invalid-argument', msg: 'Invalid role' };
  // Cannot assign a role higher than or equal to your own
  const callerLevel = ROLE_LEVELS[callerRole] || 0;
  const targetLevel = ROLE_LEVELS[data.newRole] || 0;
  if (targetLevel >= callerLevel)
    return { error: 'permission-denied', msg: 'Cannot assign role >= own level' };
  return null;
}

/** adjustExp validation */
function validateAdjustExp(data) {
  if (!data.uid || typeof data.uid !== 'string')
    return { error: 'invalid-argument', msg: 'Missing uid' };
  if (typeof data.amount !== 'number' || !Number.isFinite(data.amount))
    return { error: 'invalid-argument', msg: 'Invalid amount' };
  return null;
}

function normalizePermissionCode(code) {
  if (typeof code !== 'string') return '';
  const trimmed = code.trim();
  if (!trimmed || DISABLED_PERMISSION_CODES.has(trimmed)) return '';
  if (Object.prototype.hasOwnProperty.call(LEGACY_PERMISSION_CODE_REPLACEMENTS, trimmed)) {
    return LEGACY_PERMISSION_CODE_REPLACEMENTS[trimmed] || '';
  }
  return trimmed;
}

function sanitizePermissionCodeList(codes) {
  return Array.from(new Set(
    (Array.isArray(codes) ? codes : [])
      .map(code => normalizePermissionCode(code))
      .filter(Boolean)
  ));
}

function sanitizeUserPermissionGrantCodeList(codes) {
  return Array.from(new Set(
    (Array.isArray(codes) ? codes : [])
      .filter(code => typeof code === 'string')
      .map(code => code.trim())
      .filter(code => code
        && normalizePermissionCode(code) === code
        && USER_PERMISSION_GRANT_ALLOWED_CODES.has(code))
  ));
}

function getDefaultRolePermissions(roleKey) {
  const safeRole = normalizeRole(roleKey);
  if (safeRole === 'user') return [];
  const roleLevel = ROLE_LEVELS[safeRole] || 0;
  const defaults = [];

  DEFAULT_ROLE_ENTRY_PERMISSION_RULES.forEach(rule => {
    if (roleLevel >= (ROLE_LEVELS[rule.minRole] || 0)) {
      defaults.push(rule.code);
    }
  });

  if (roleLevel >= ROLE_LEVELS.coach) defaults.push('activity.view_noshow');
  if (roleLevel >= ROLE_LEVELS.admin) defaults.push(...DEFAULT_ADMIN_PERMISSION_CODES);
  if (roleLevel >= ROLE_LEVELS.super_admin) defaults.push('admin.notif.toggle');

  return sanitizePermissionCodeList(defaults);
}

function resolveStoredRolePermissions(roleKey, snapshot) {
  const safeRole = normalizeRole(roleKey);
  if (safeRole === 'user' || safeRole === 'super_admin') return [];
  if (!snapshot?.exists) return getDefaultRolePermissions(safeRole);
  const data = snapshot.data || {};
  if (!Object.prototype.hasOwnProperty.call(data, 'permissions')) {
    return getDefaultRolePermissions(safeRole);
  }
  return sanitizePermissionCodeList(data.permissions);
}

function resolveUserPermissionGrants(snapshot) {
  if (!snapshot?.exists) return [];
  const data = snapshot.data || {};
  if (data.enabled === false) return [];
  return sanitizeUserPermissionGrantCodeList(data.permissions);
}

function resolveEffectivePermissions(userRole, rolePermissions, userPermissionGrants) {
  const inherent = INHERENT_ROLE_PERMISSIONS[userRole] || [];
  return Array.from(new Set([
    ...sanitizePermissionCodeList(rolePermissions),
    ...sanitizePermissionCodeList(userPermissionGrants),
    ...inherent,
  ]));
}

/** Permission check: inherent + dynamic */
function hasPermission(userRole, dynamicPermissions, permCode) {
  if (DISABLED_PERMISSION_CODES.has(permCode)) return false;
  const inherent = INHERENT_ROLE_PERMISSIONS[userRole] || [];
  if (inherent.includes(permCode)) return true;
  return (dynamicPermissions || []).includes(permCode);
}

function canUseSecondaryIdentityAccess(access) {
  return !!access
    && access.hasPermission(SECONDARY_IDENTITY_PERMISSION);
}

function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return VALID_ROLES.has(normalized) ? normalized : 'user';
}

function isRoleAdminOrAbove(role) {
  const safeRole = normalizeRole(role);
  return safeRole === 'admin' || safeRole === 'super_admin';
}

function isTournamentTeamOfficerForData(team, uid) {
  if (!team || !uid) return false;
  const safeUid = String(uid || '').trim();
  if (!safeUid) return false;
  const leaderUids = Array.isArray(team.leaderUids)
    ? team.leaderUids.map(item => String(item || '').trim())
    : [];
  return String(team.captainUid || '').trim() === safeUid
    || String(team.creatorUid || '').trim() === safeUid
    || String(team.ownerUid || '').trim() === safeUid
    || String(team.leaderUid || '').trim() === safeUid
    || leaderUids.includes(safeUid);
}

function addTeamStaffUidsToSet(targetSet, teamData = {}) {
  if (!targetSet || typeof targetSet.add !== 'function') return;
  const addUid = value => {
    const safeValue = String(value || '').trim();
    if (safeValue) targetSet.add(safeValue);
  };
  addUid(teamData?.captainUid);
  addUid(teamData?.creatorUid);
  addUid(teamData?.ownerUid);
  addUid(teamData?.leaderUid);
  if (Array.isArray(teamData?.leaderUids)) teamData.leaderUids.forEach(addUid);
  if (Array.isArray(teamData?.coachUids)) teamData.coachUids.forEach(addUid);
}

function getUserTeamIdSetFromData(userData) {
  const ids = new Set();
  const add = value => {
    const safeValue = String(value || '').trim();
    if (safeValue) ids.add(safeValue);
  };
  if (Array.isArray(userData?.teamIds)) userData.teamIds.forEach(add);
  add(userData?.teamId);
  return ids;
}

function isUserDataInTeam(userData, teamId) {
  const safeTeamId = String(teamId || '').trim();
  return !!safeTeamId && getUserTeamIdSetFromData(userData).has(safeTeamId);
}

function canApplyFriendlyTournamentForTeam(callerRole, team, callerUid, userData, teamId = team?.id) {
  return isTournamentTeamOfficerForData(team, callerUid)
    || (isRoleAdminOrAbove(callerRole) && isUserDataInTeam(userData, teamId));
}

function cfBuildTeamReservationMemberUidSet(teamData, userDocs = []) {
  const memberUidSet = new Set();
  const addUid = value => {
    const safeValue = String(value || '').trim();
    if (safeValue) memberUidSet.add(safeValue);
  };
  userDocs.forEach(doc => {
    const data = doc.data || {};
    addUid(doc.id);
    addUid(data.uid);
    addUid(data.lineUserId);
  });
  addTeamStaffUidsToSet(memberUidSet, teamData);
  return memberUidSet;
}

function getTournamentSportTagFromData(data) {
  return String(data?.sportTag || data?.sport || '').trim();
}

function assertTournamentSportCompatibleData(tournament, teamData, hostTeamData = null) {
  const tournamentSport = getTournamentSportTagFromData(tournament) || getTournamentSportTagFromData(hostTeamData);
  const teamSport = getTournamentSportTagFromData(teamData);
  if (!tournamentSport) return 'TOURNAMENT_SPORT_REQUIRED';
  if (!teamSport) return 'TEAM_SPORT_REQUIRED';
  if (tournamentSport !== teamSport) return 'TOURNAMENT_TEAM_SPORT_MISMATCH';
  return 'ok';
}

function validateCreateFriendlyTournamentHost(callerRole, team, callerUid, hostTeamId = team?.id) {
  const safeHostTeamId = String(hostTeamId || '').trim();
  const isAdmin = isRoleAdminOrAbove(callerRole);
  if (!safeHostTeamId) {
    return isAdmin
      ? { ok: true, hostParticipatesAllowed: false }
      : { ok: false, error: 'HOST_TEAM_REQUIRED' };
  }
  if (!team) return { ok: false, error: 'not-found' };
  const isOfficer = isTournamentTeamOfficerForData(team, callerUid);
  if (!isAdmin && !isOfficer) return { ok: false, error: 'permission-denied' };
  return { ok: true, hostParticipatesAllowed: isOfficer };
}

function isTournamentApplicationTerminalStatus(status) {
  const safeStatus = String(status || '').trim().toLowerCase();
  return ['cancelled', 'withdrawn', 'removed', 'rejected'].includes(safeStatus);
}

function shouldBlockFriendlyTournamentApply(existingApplicationStatus, entryExists) {
  if (entryExists) return true;
  if (!existingApplicationStatus) return false;
  return !isTournamentApplicationTerminalStatus(existingApplicationStatus);
}

function cfBuildRegisteredTeamIdsFromEntries(entries, options = {}) {
  const removedTeamId = String(options.removedTeamId || '').trim();
  const additionalTeamId = String(options.additionalTeamId || '').trim();
  const ids = new Set();
  entries.forEach(data => {
    const status = String(data.entryStatus || '').trim().toLowerCase();
    const teamId = String(data.teamId || '').trim();
    if (!teamId || teamId === removedTeamId) return;
    if (status === 'approved') ids.add(teamId);
    if (status === 'host' && data.countsTowardLimit !== false) ids.add(teamId);
  });
  if (additionalTeamId && additionalTeamId !== removedTeamId) ids.add(additionalTeamId);
  return Array.from(ids);
}

function cfIsCompanionPseudoUid(value) {
  return String(value || '').trim().startsWith('comp_');
}

function cfIsLineUid(value) {
  return /^U[a-f0-9]{32}$/i.test(String(value || '').trim());
}

function cfIsCompanionAttendanceSelfCandidate(data = {}) {
  const uid = String(data.uid || '').trim();
  const participantType = String(data.participantType || 'self').trim();
  const companionId = String(data.companionId || '').trim();
  return cfIsCompanionPseudoUid(uid) && participantType === 'self' && !companionId;
}

function cfBuildCompanionAttendanceRepairPatch(attData = {}, regData = {}) {
  if (!cfIsCompanionAttendanceSelfCandidate(attData)) return null;
  if (!cfIsLineUid(regData.userId)) return null;
  if (String(regData.status || 'confirmed').toLowerCase() === 'cancelled') return null;
  if (String(regData.status || 'confirmed').toLowerCase() === 'removed') return null;
  return {
    uid: regData.userId,
    userName: regData.userName || '',
    participantType: 'companion',
    companionId: regData.companionId || attData.uid,
    companionName: regData.companionName || attData.userName || '',
    companionAttendancePreviousUid: attData.uid,
  };
}

/** registerForEvent CF: duplicate detection logic */
function cfIsCourseLinkedRegistration(reg = {}) {
  return String(reg.source || '') === 'eduCourseLesson'
    || String(reg.courseLinkSource || '') === 'eduCourseLesson'
    || !!String(reg.courseLinkId || '').trim()
    || !!String(reg.courseStudentId || '').trim();
}

function cfRegistrationUniqueKey(reg = {}) {
  const courseStudentId = String(reg.courseStudentId || '').trim();
  if (courseStudentId && cfIsCourseLinkedRegistration(reg)) return `course_student_${courseStudentId}`;
  const userId = String(reg.userId || '').trim();
  if (reg.participantType === 'companion') {
    return `${userId}_companion_${String(reg.companionId || '').trim()}`;
  }
  return `${userId}_self`;
}

function cfDuplicateCheck(existingRegs, participantOrUserId) {
  const participant = typeof participantOrUserId === 'string'
    ? { userId: participantOrUserId, participantType: 'self' }
    : { ...(participantOrUserId || {}), participantType: participantOrUserId?.participantType || 'self' };
  const participantKey = cfRegistrationUniqueKey(participant);
  return existingRegs.some(r =>
    (r.status === 'confirmed' || r.status === 'waitlisted')
    && (r.participantType || 'self') !== 'companion'
    && !r.companionId
    && cfRegistrationUniqueKey(r) === participantKey
  );
}

function cfCountUniqueConfirmed(regs = []) {
  const seen = new Set();
  let count = 0;
  regs.forEach(reg => {
    if (reg.status !== 'confirmed') return;
    const key = cfRegistrationUniqueKey(reg);
    if (seen.has(key)) return;
    seen.add(key);
    count++;
  });
  return count;
}

/** registerForEvent CF: status assignment */
function cfAssignStatus(confirmedInput, maxCapacity) {
  const confirmedCount = Array.isArray(confirmedInput)
    ? cfCountUniqueConfirmed(confirmedInput)
    : confirmedInput;
  return confirmedCount >= maxCapacity ? 'waitlisted' : 'confirmed';
}

function cfNormalizeBinaryGenderForRegistration(value) {
  const raw = String(value || '').trim().slice(0, 20);
  const lower = raw.toLowerCase();
  if (raw === '\u7537' || lower === 'male' || lower === 'm') return 'male';
  if (raw === '\u5973' || lower === 'female' || lower === 'f') return 'female';
  return '';
}

function cfIsGenderRestricted(eventAllowedGender, userGender) {
  const allowedGender = cfNormalizeBinaryGenderForRegistration(eventAllowedGender);
  if (!allowedGender) return false;
  const normalizedGender = cfNormalizeBinaryGenderForRegistration(userGender);
  return !normalizedGender || normalizedGender !== allowedGender;
}

function getLineNotificationSettingsKey(category) {
  return category === "private" ? "system" : category;
}

function isForcedLineNotificationSource(source) {
  const safeSource = String(source || "").trim();
  return LINE_NOTIFICATION_FORCED_SOURCES.some((prefix) => safeSource.startsWith(prefix))
    || safeSource.startsWith("target:");
}

function normalizeNotificationToggles(rawToggles) {
  if (!rawToggles || typeof rawToggles !== "object" || Array.isArray(rawToggles)) {
    return {};
  }

  const next = {};
  Object.entries(rawToggles).forEach(([key, value]) => {
    if (!LINE_NOTIFICATION_TOGGLE_ALLOWED_KEYS.has(key)) return;
    if (typeof value !== "boolean") return;
    next[key] = value;
  });
  return next;
}

function shouldSkipLineNotificationByToggles(category, source, toggles) {
  if (isForcedLineNotificationSource(source)) return false;

  const safeToggles = toggles || {};
  const categoryKey = `category_${getLineNotificationSettingsKey(category)}`;
  if (safeToggles[categoryKey] === false) return true;

  const safeSource = String(source || "").trim();
  if (safeSource.startsWith("template:")) {
    const typeKey = `type_${safeSource.slice("template:".length)}`;
    if (safeToggles[typeKey] === false) return true;
  }

  return false;
}

async function getNotificationTogglesWithFallback(source, deps = {}) {
  if (isForcedLineNotificationSource(source)) return {};

  try {
    return await deps.load();
  } catch (err) {
    deps.onWarn?.(err);
    return {};
  }
}

function readCloudFunctionSource(functionName) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'functions', 'index.js'),
    'utf8'
  ).replace(/\r\n/g, '\n');
  const start = source.indexOf(`exports.${functionName}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextExport = source.indexOf('\nexports.', start + 1);
  return source.slice(start, nextExport === -1 ? source.length : nextExport);
}

function readSourceBetween(startNeedle, endNeedle) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'functions', 'index.js'),
    'utf8'
  ).replace(/\r\n/g, '\n');
  const start = source.indexOf(startNeedle);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = endNeedle ? source.indexOf(endNeedle, start + startNeedle.length) : -1;
  return source.slice(start, end === -1 ? source.length : end);
}

function readCancelRegistrationTransactionSource() {
  const fnSource = readCloudFunctionSource('cancelRegistration');
  const txStart = fnSource.indexOf('const result = await db.runTransaction');
  expect(txStart).toBeGreaterThanOrEqual(0);
  const txEnd = fnSource.indexOf('\n    });', txStart);
  expect(txEnd).toBeGreaterThan(txStart);
  return fnSource.slice(txStart, txEnd);
}

function findAllIndexes(source, needle) {
  const indexes = [];
  let index = source.indexOf(needle);
  while (index !== -1) {
    indexes.push(index);
    index = source.indexOf(needle, index + needle.length);
  }
  return indexes;
}

class TestHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const PM_TEST_UID_A = `U${'a'.repeat(32)}`;
const PM_TEST_UID_B = `U${'b'.repeat(32)}`;
const PM_TEST_CONVERSATION_ID = `pm_${[PM_TEST_UID_A, PM_TEST_UID_B].sort().join('_')}`;

function loadPrivateMessageCallables(db, consoleImpl = console) {
  const helperSource = readSourceBetween('const PM_UID_RE', 'async function pmGetUserByUid');
  const markReadSource = readSourceBetween(
    'exports.markPrivateConversationRead',
    'async function pmUpdateOwnMessage'
  );
  const updateSource = readSourceBetween(
    'async function pmUpdateOwnMessage',
    'exports.getPrivateMessageSettings'
  );
  const sandbox = {
    db,
    crypto: require('crypto'),
    HttpsError: TestHttpsError,
    onCall: (options, handler) => ({ options, handler }),
    Timestamp: {
      fromDate: date => ({
        millis: date.getTime(),
        toDate: () => new Date(date.getTime()),
        toMillis: () => date.getTime(),
      }),
      fromMillis: millis => ({
        millis,
        toDate: () => new Date(millis),
        toMillis: () => millis,
      }),
    },
    exports: {},
    console: consoleImpl,
  };
  vm.runInNewContext(`
    const PM_DEFAULT_SETTINGS = Object.freeze({ allowUserToUserPm: false });
    const PM_MAX_BODY_LENGTH = 300;
    const PM_MESSAGE_LIMIT = 50;
    const PM_AUDIT_RETENTION_DAYS = 180;
    ${helperSource}
    ${markReadSource}
    ${updateSource}
    globalThis.__pmCallables = {
      markPrivateConversationRead: exports.markPrivateConversationRead,
      editPrivateMessage: exports.editPrivateMessage,
      recallPrivateMessage: exports.recallPrivateMessage,
    };
  `, sandbox, { filename: 'private-message-callables.vm.js' });
  return sandbox.__pmCallables;
}

function pmTestClone(value) {
  if (Array.isArray(value)) return value.map(pmTestClone);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  return Object.entries(value).reduce((copy, [key, item]) => {
    copy[key] = pmTestClone(item);
    return copy;
  }, {});
}

function pmTestReadField(data, fieldPath) {
  return String(fieldPath || '').split('.').reduce(
    (value, key) => (value == null ? undefined : value[key]),
    data
  );
}

function pmTestSetField(target, fieldPath, value) {
  const parts = String(fieldPath || '').split('.');
  let cursor = target;
  parts.slice(0, -1).forEach(part => {
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  });
  cursor[parts[parts.length - 1]] = pmTestClone(value);
}

function pmTestMergeData(existing, patch, merge) {
  const next = merge ? pmTestClone(existing || {}) : {};
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (key.includes('.')) pmTestSetField(next, key, value);
    else next[key] = pmTestClone(value);
  });
  return next;
}

class PmMemoryDocumentReference {
  constructor(db, pathValue) {
    this._db = db;
    this.path = pathValue;
    this.id = pathValue.split('/').pop();
  }

  collection(name) {
    return new PmMemoryCollectionReference(this._db, `${this.path}/${name}`);
  }
}

class PmMemoryCollectionReference {
  constructor(db, pathValue) {
    this._db = db;
    this.path = pathValue;
  }

  doc(id) {
    return new PmMemoryDocumentReference(this._db, `${this.path}/${id}`);
  }

  where(field, operator, value) {
    return new PmMemoryQuery(this._db, this.path, [{ field, operator, value }], null);
  }
}

class PmMemoryQuery {
  constructor(db, pathValue, filters = [], queryLimit = null) {
    this._db = db;
    this.path = pathValue;
    this.filters = filters;
    this.queryLimit = queryLimit;
  }

  where(field, operator, value) {
    return new PmMemoryQuery(
      this._db,
      this.path,
      [...this.filters, { field, operator, value }],
      this.queryLimit
    );
  }

  limit(value) {
    return new PmMemoryQuery(this._db, this.path, this.filters, Number(value));
  }
}

function pmMemoryDocumentSnapshot(ref, data) {
  const exists = data !== undefined;
  return {
    id: ref.id,
    ref,
    exists,
    data: () => (exists ? pmTestClone(data) : undefined),
  };
}

class PmMemoryTransaction {
  constructor(db, attempt) {
    this.db = db;
    this.attempt = attempt;
    this.operations = [];
    this.readVersions = new Map();
    this.queryVersions = new Map();
    this.writes = [];
    this.hasWrites = false;
  }

  async get(target) {
    if (this.hasWrites) throw new Error('transaction read attempted after write');
    if (target instanceof PmMemoryQuery) {
      this.queryVersions.set(target.path, this.db._collectionVersion(target.path));
      const docs = this.db._query(target);
      docs.forEach(doc => this.readVersions.set(doc.ref.path, this.db._version(doc.ref.path)));
      this.operations.push({
        type: 'read-query',
        path: target.path,
        limit: target.queryLimit,
        size: docs.length,
      });
      return { docs, size: docs.length, empty: docs.length === 0 };
    }
    this.readVersions.set(target.path, this.db._version(target.path));
    this.operations.push({ type: 'read-doc', path: target.path });
    return pmMemoryDocumentSnapshot(target, this.db._raw(target.path));
  }

  set(ref, data, options = {}) {
    this.hasWrites = true;
    this.operations.push({ type: 'write', path: ref.path });
    this.writes.push({ type: 'set', ref, data: pmTestClone(data), merge: options.merge === true });
    return this;
  }

  update(ref, data) {
    this.hasWrites = true;
    this.operations.push({ type: 'write', path: ref.path });
    this.writes.push({ type: 'set', ref, data: pmTestClone(data), merge: true });
    return this;
  }

  hasConflict() {
    for (const [pathValue, version] of this.readVersions) {
      if (this.db._version(pathValue) !== version) return true;
    }
    for (const [pathValue, version] of this.queryVersions) {
      if (this.db._collectionVersion(pathValue) !== version) return true;
    }
    return false;
  }

  apply() {
    this.writes.forEach(write => {
      this.db._writeDirect(
        write.ref.path,
        pmTestMergeData(this.db._raw(write.ref.path), write.data, write.merge)
      );
    });
  }
}

function createPmMemoryFirestore() {
  const db = {
    _docs: new Map(),
    _versions: new Map(),
    _collectionVersions: new Map(),
    _beforeCommit: null,
    _commitFailure: null,
    _barrier: null,
    _transactionSequence: 0,
    attempts: [],
    commits: [],

    collection(name) {
      return new PmMemoryCollectionReference(this, name);
    },

    _raw(pathValue) {
      return this._docs.get(pathValue);
    },

    _version(pathValue) {
      return this._versions.get(pathValue) || 0;
    },

    _collectionVersion(pathValue) {
      return this._collectionVersions.get(pathValue) || 0;
    },

    _writeDirect(pathValue, data) {
      this._docs.set(pathValue, pmTestClone(data));
      this._versions.set(pathValue, this._version(pathValue) + 1);
      const collectionPath = pathValue.split('/').slice(0, -1).join('/');
      this._collectionVersions.set(
        collectionPath,
        this._collectionVersion(collectionPath) + 1
      );
    },

    _query(query) {
      const prefix = `${query.path}/`;
      const docs = [];
      for (const [pathValue, data] of this._docs) {
        if (!pathValue.startsWith(prefix)) continue;
        const relativePath = pathValue.slice(prefix.length);
        if (!relativePath || relativePath.includes('/')) continue;
        const matches = query.filters.every(filter => {
          if (filter.operator !== '==') throw new Error(`unsupported operator ${filter.operator}`);
          return pmTestReadField(data, filter.field) === filter.value;
        });
        if (!matches) continue;
        docs.push(pmMemoryDocumentSnapshot(
          new PmMemoryDocumentReference(this, pathValue),
          data
        ));
      }
      docs.sort((left, right) => left.id.localeCompare(right.id));
      return Number.isFinite(query.queryLimit)
        ? docs.slice(0, query.queryLimit)
        : docs;
    },

    seed(pathValue, data) {
      this._writeDirect(pathValue, data);
      return this;
    },

    get(pathValue) {
      return pmTestClone(this._raw(pathValue));
    },

    has(pathValue) {
      return this._docs.has(pathValue);
    },

    directCollection(pathValue) {
      const prefix = `${pathValue}/`;
      return Array.from(this._docs.entries())
        .filter(([itemPath]) => {
          if (!itemPath.startsWith(prefix)) return false;
          const relativePath = itemPath.slice(prefix.length);
          return !!relativePath && !relativePath.includes('/');
        })
        .map(([itemPath, data]) => ({ path: itemPath, data: pmTestClone(data) }));
    },

    interleaveBeforeCommitOnce(callback) {
      this._beforeCommit = callback;
    },

    failNextCommit(err) {
      this._commitFailure = err;
    },

    holdNextTransactions(count) {
      let release;
      this._barrier = {
        count,
        waiting: 0,
        promise: new Promise(resolve => { release = resolve; }),
        release,
      };
    },

    async _waitAtBarrier(attempt) {
      const barrier = this._barrier;
      if (!barrier || attempt !== 1) return;
      barrier.waiting += 1;
      if (barrier.waiting >= barrier.count) barrier.release();
      await barrier.promise;
      if (this._barrier === barrier) this._barrier = null;
    },

    async runTransaction(callback) {
      const transactionId = ++this._transactionSequence;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const tx = new PmMemoryTransaction(this, attempt);
        const result = await callback(tx);
        this.attempts.push({ transactionId, attempt, operations: tx.operations.slice() });
        if (this._beforeCommit) {
          const beforeCommit = this._beforeCommit;
          this._beforeCommit = null;
          await beforeCommit(this);
        }
        await this._waitAtBarrier(attempt);
        if (tx.hasConflict()) continue;
        if (this._commitFailure) {
          const commitFailure = this._commitFailure;
          this._commitFailure = null;
          throw commitFailure;
        }
        tx.apply();
        this.commits.push({ transactionId, attempt, writeCount: tx.writes.length });
        return result;
      }
      const retryError = new Error('transaction retry limit exceeded');
      retryError.code = 'aborted';
      throw retryError;
    },
  };
  return db;
}

function pmTestThreadPath(uid) {
  return `users/${uid}/pmThreads/${PM_TEST_CONVERSATION_ID}`;
}

function pmTestStatePath(uid) {
  return `users/${uid}/pmMeta/state`;
}

function pmTestMessagePath(uid, messageId) {
  return `${pmTestThreadPath(uid)}/messages/${messageId}`;
}

function pmTestAuditMessagePath(messageId) {
  return `pmAuditConversations/${PM_TEST_CONVERSATION_ID}/messages/${messageId}`;
}

function pmTestMessageId(index) {
  return `pmmsg_${String(index).padStart(4, '0')}`;
}

function pmSeedIncomingMessage(db, index) {
  const messageId = pmTestMessageId(index);
  const baseMessage = {
    id: messageId,
    messageId,
    conversationId: PM_TEST_CONVERSATION_ID,
    fromUid: PM_TEST_UID_B,
    toUid: PM_TEST_UID_A,
    body: `message ${index}`,
    preview: `message ${index}`,
    status: 'active',
    peerRead: false,
    createdAt: { millis: index },
    updatedAt: { millis: index },
  };
  db.seed(pmTestMessagePath(PM_TEST_UID_A, messageId), {
    ...baseMessage,
    direction: 'in',
    read: false,
  });
  db.seed(pmTestMessagePath(PM_TEST_UID_B, messageId), {
    ...baseMessage,
    direction: 'out',
    read: true,
  });
  db.seed(pmTestAuditMessagePath(messageId), {
    ...baseMessage,
    readBy: { [PM_TEST_UID_B]: { millis: index } },
    editHistory: [],
  });
  return messageId;
}

function pmSeedUnreadScenario(db, count, options = {}) {
  const includeThread = options.includeThread !== false;
  const includeMeta = options.includeMeta !== false;
  const threadUnread = options.threadUnread == null ? count : options.threadUnread;
  const metaUnread = options.metaUnread == null ? count : options.metaUnread;
  let lastMessageId = '';
  for (let index = 1; index <= count; index += 1) {
    lastMessageId = pmSeedIncomingMessage(db, index);
  }
  if (includeThread) {
    db.seed(pmTestThreadPath(PM_TEST_UID_A), {
      conversationId: PM_TEST_CONVERSATION_ID,
      peerUid: PM_TEST_UID_B,
      lastMessageId,
      unreadCount: threadUnread,
    });
  }
  if (includeMeta) {
    db.seed(pmTestStatePath(PM_TEST_UID_A), { unreadTotal: metaUnread, threadCount: 1 });
  }
  return db;
}

function pmApplyConcurrentIncomingSend(db, index) {
  const messageId = pmSeedIncomingMessage(db, index);
  const thread = db.get(pmTestThreadPath(PM_TEST_UID_A)) || {};
  const state = db.get(pmTestStatePath(PM_TEST_UID_A)) || {};
  db.seed(pmTestThreadPath(PM_TEST_UID_A), {
    ...thread,
    lastMessageId: messageId,
    unreadCount: Number(thread.unreadCount || 0) + 1,
  });
  db.seed(pmTestStatePath(PM_TEST_UID_A), {
    ...state,
    unreadTotal: Number(state.unreadTotal || 0) + 1,
  });
}

function pmSeedEditableScenario(db, options = {}) {
  const messageId = options.messageId || 'pmmsg_edit_target';
  const ownLastMessageId = options.ownLastMessageId || messageId;
  const peerLastMessageId = options.peerLastMessageId || messageId;
  const baseMessage = {
    id: messageId,
    messageId,
    conversationId: PM_TEST_CONVERSATION_ID,
    fromUid: PM_TEST_UID_A,
    toUid: PM_TEST_UID_B,
    body: 'original body',
    preview: 'original body',
    status: 'active',
    peerRead: false,
    editVersion: 0,
  };
  db.seed(pmTestMessagePath(PM_TEST_UID_A, messageId), {
    ...baseMessage,
    direction: 'out',
    read: true,
  });
  db.seed(pmTestMessagePath(PM_TEST_UID_B, messageId), {
    ...baseMessage,
    direction: 'in',
    read: options.peerRead === true,
  });
  db.seed(pmTestAuditMessagePath(messageId), {
    ...baseMessage,
    readBy: { [PM_TEST_UID_A]: { millis: 1 } },
    editHistory: [],
  });
  db.seed(`pmAuditConversations/${PM_TEST_CONVERSATION_ID}`, {
    conversationId: PM_TEST_CONVERSATION_ID,
    lastMessageId: peerLastMessageId,
  });
  if (options.includeOwnThread !== false) {
    db.seed(pmTestThreadPath(PM_TEST_UID_A), {
      lastMessageId: ownLastMessageId,
      lastMessageBody: options.ownPreview || 'own latest preview',
      lastMessageStatus: 'active',
    });
  }
  if (options.includePeerThread !== false) {
    db.seed(pmTestThreadPath(PM_TEST_UID_B), {
      lastMessageId: peerLastMessageId,
      lastMessageBody: options.peerPreview || 'peer latest preview',
      lastMessageStatus: 'active',
    });
  }
  return messageId;
}

function expectPmReadsBeforeWrites(db) {
  db.attempts.forEach(attempt => {
    const firstWrite = attempt.operations.findIndex(operation => operation.type === 'write');
    if (firstWrite < 0) return;
    const lastRead = attempt.operations.reduce(
      (index, operation, currentIndex) => operation.type.startsWith('read-') ? currentIndex : index,
      -1
    );
    expect(lastRead).toBeLessThan(firstWrite);
  });
}

describe('education course enrollment callable source contracts', () => {
  test('batch summary callable returns summaries without serializing full enrollments', () => {
    const source = readCloudFunctionSource('listEduCourseEnrollmentSummaries');
    expect(source).toContain('if (!request.auth?.uid)');
    expect(source).toContain('normalizeEduCourseSummaryRequestIds(request.data || {})');
    expect(source).toContain('teamRef.collection("students").get()');
    expect(source).toContain('planRef.collection("enrollments").get()');
    expect(source).toContain('getCallerAccessContext(request)');
    expect(source).toContain('isTeamStaffForData(teamDoc.data, callerUid)');
    expect(source).toContain('buildCourseEnrollmentSummary');
    expect(source).toContain('includeReviewCounts: isStaff');
    expect(source).toContain('summaries[planId]');
    expect(source).not.toContain('serializeCourseEnrollment');
    expect(source).not.toContain('visibleEnrollments');
  });

  test('course enrollment summary exposes pending review count only through the summary contract', () => {
    const source = readSourceBetween(
      'function buildCourseEnrollmentSummary',
      'function normalizeEduCourseMigrationLimit'
    );
    expect(source).toContain('includeReviewCounts = false');
    expect(source).toContain('const pendingReviewCount = includeReviewCounts');
    expect(source).toContain('sanitizeStr(enrollment.status, 32).toLowerCase() === "pending"');
    expect(source).toContain('pendingReviewCount,');
  });

  test('course enrollment cancellation only cancels owned pending enrollments', () => {
    const source = readCloudFunctionSource('cancelCourseEnrollment');
    expect(source).toContain('if (!request.auth?.uid)');
    expect(source).toContain('normalizeEduCourseRequestIds(request.data || {})');
    expect(source).toContain('isStudentOwnedByUid(student, callerUid)');
    expect(source).toContain('sanitizeStr(enrollment.status, 32).toLowerCase() === "pending"');
    expect(source).toContain('sanitizeStr(enrollment._docId || enrollment.id, 100)');
    expect(source).toContain('status: "cancelled"');
    expect(source).toContain('cancelledByUid: callerUid');
    expect(source).toContain('NO_PENDING_ENROLLMENTS');
  });

  test('public course roster callable projects sessions and students without requiring auth', () => {
    const source = readCloudFunctionSource('listEduCoursePublicRoster');
    expect(source).toContain('region: "asia-east1"');
    expect(source).toContain('normalizeEduCourseSessionRequestIds(request.data || {})');
    expect(source).not.toContain('if (!request.auth?.uid)');
    expect(source).toContain('planRef.collection("sessions").doc(sessionId)');
    expect(source).not.toContain('teamRef.collection("students").get()');
    expect(source).toContain('fetchEduRosterStudentsByIds(teamRef, studentIds)');
    expect(source).toContain('fetchEduRosterAttendanceByStudentId({ teamId, planId, sessionId, date: baseSession.date })');
    expect(source).toContain('canManageRoster ? fetchEduRosterStaffEnrollmentByStudentId(planRef, studentIds) : Promise.resolve(null)');
    expect(source).toContain('const attendanceRevision = eduRosterHash(attendanceByStudentId || {})');
    expect(source).toContain('const staffEnrollmentRevision = canManageRoster ? eduRosterHash(staffEnrollmentByStudentId || {}) : ""');
    expect(source).toContain('const forceRefresh = request.data?.forceRefresh === true && canManageRoster');
    expect(source).not.toContain('const forceRefresh = request.data?.forceRefresh === true;');
    expect(source).toContain('if (!forceRefresh) {');
    expect(source).toContain('readEduRosterSnapshot({');
    expect(source).toContain('attendanceRevision,');
    expect(source).toContain('staffEnrollmentRevision,');
    expect(source).toContain('buildEduRosterSnapshotPayload({');
    expect(source).toContain('writeEduRosterSnapshot({');
    expect(source).toContain('return finalizeEduRosterResponse({');
    expect(source).toContain('rosterPublic');
    expect(source).toContain('const canManageRoster = isStaff || isEduCourseRosterAgentForData(plan, callerUid)');
    expect(source).toContain('!canManageRoster && plan.visibleOnTeamPage === false');
    expect(source).toContain('!rosterPublic && !canManageRoster');
    expect(source).toContain('canManageRoster,');
    expect(source).toContain('cacheSource: forceRefresh ? "refresh" : "live"');
    expect(source).not.toContain('serializeCourseEnrollment');
    expect(source).not.toContain('planRef.collection("enrollments").get()');

    const overlaySource = readSourceBetween(
      'async function applyEduRosterCallerOverlay',
      'async function finalizeEduRosterResponse'
    );
    expect(overlaySource).toContain('canSelfLeave: false');
    expect(overlaySource).toContain('canSelfLeave: true');
    expect(overlaySource).toContain('delete clean.selfUid');
    expect(overlaySource).toContain('delete clean.parentUid');

    const finalizeSource = readSourceBetween(
      'async function finalizeEduRosterResponse',
      'exports.listEduCoursePublicRoster'
    );
    expect(finalizeSource).toContain('staffEnrollmentByStudentId: canManageRoster ? payload.staffEnrollmentByStudentId || {} : null');
  });

  test('course roster snapshot freshness rejects stale source revisions', () => {
    const helperSource = readSourceBetween(
      'function isEduRosterSnapshotFresh',
      'async function readEduRosterSnapshot'
    );
    const isEduRosterSnapshotFresh = new Function(
      'EDU_ROSTER_SNAPSHOT_SCHEMA_VERSION',
      `${helperSource}; return isEduRosterSnapshotFresh;`
    )(1);
    const expected = {
      scope: 'staffBase',
      studentIdsDigest: 'students-v1',
      planRevision: 'plan-v1',
      sessionRevision: 'session-v1',
      attendanceRevision: 'attendance-v1',
      staffEnrollmentRevision: 'staff-v1',
      nowMs: 1000,
    };
    const makeSnapshot = (metaOverrides = {}) => ({
      exists: true,
      data: () => ({
        schemaVersion: 1,
        scope: 'staffBase',
        payload: { students: [] },
        meta: {
          schemaVersion: 1,
          scope: 'staffBase',
          studentIdsDigest: 'students-v1',
          planRevision: 'plan-v1',
          sessionRevision: 'session-v1',
          attendanceRevision: 'attendance-v1',
          staffEnrollmentRevision: 'staff-v1',
          expiresAtMs: 2000,
          ...metaOverrides,
        },
      }),
    });

    expect(isEduRosterSnapshotFresh(makeSnapshot(), expected)).toBe(true);
    expect(isEduRosterSnapshotFresh(makeSnapshot({ attendanceRevision: 'attendance-v2' }), expected)).toBe(false);
    expect(isEduRosterSnapshotFresh(makeSnapshot({ staffEnrollmentRevision: 'staff-v2' }), expected)).toBe(false);
    expect(isEduRosterSnapshotFresh(makeSnapshot({ expiresAtMs: 999 }), expected)).toBe(false);
  });

  test('public course roster helpers avoid full scans and keep legacy fallbacks', () => {
    const studentHelper = readSourceBetween(
      'async function fetchEduRosterStudentsByIds',
      'function assignEduRosterAttendanceRecord'
    );
    expect(studentHelper).toContain('teamRef.collection("students").doc(studentId).get()');
    expect(studentHelper).toContain('teamRef.collection("students").where("id", "in", chunk).get()');
    expect(studentHelper).toContain('student id fallback failed');
    expect(studentHelper).not.toContain('teamRef.collection("students").get()');

    const attendanceHelper = readSourceBetween(
      'async function fetchEduRosterAttendanceByStudentId',
      'async function fetchEduRosterStaffEnrollmentByStudentId'
    );
    expect(attendanceHelper).toContain('legacyAttendanceByStudentId');
    expect(attendanceHelper).toContain('sessionAttendanceByStudentId');
    expect(attendanceHelper).toContain('.where("date", "==", date)');
    expect(attendanceHelper).toContain('.where("sessionId", "==", sessionId)');
    expect(attendanceHelper).toContain('catch (sessionErr)');
    expect(attendanceHelper).toContain('return mergeEduRosterAttendanceByStudentId(legacyAttendanceByStudentId, sessionAttendanceByStudentId);');

    const enrollmentHelper = readSourceBetween(
      'async function fetchEduRosterStaffEnrollmentByStudentId',
      'exports.listEduCoursePublicRoster'
    );
    expect(enrollmentHelper).toContain('planRef.collection("enrollments").where("studentId", "in", chunk).get()');
    expect(enrollmentHelper).toContain('staff enrollment query failed');
    expect(enrollmentHelper).toContain('coachNotes: sanitizeStr(enrollment.coachNotes, 2000)');
    expect(enrollmentHelper).toContain('paidAt: sanitizeStr(enrollment.paidAt, 40) || null');
    expect(enrollmentHelper).not.toContain('serializeCourseEnrollment');
    expect(enrollmentHelper).not.toContain('planRef.collection("enrollments").get()');
  });


  test('course attendance helpers preserve registered below signin and leave', () => {
    const source = readSourceBetween(
      'function getEduAttendanceRecordKind',
      'function getEduStudentIdAliases'
    );
    expect(source).toContain('if (kind === "registered") return "registered";');
    expect(source).toContain('function getEduAttendanceKindPriority');
    expect(source).toContain('if (kind === "signin") return 3;');
    expect(source).toContain('if (kind === "leave") return 2;');
    expect(source).toContain('if (kind === "registered") return 1;');
  });

  test('course roster agent helper accepts singular and list fields', () => {
    const source = readSourceBetween(
      'function getEduCourseRosterAgentUids',
      'function addTeamStaffUidsToSet'
    );
    expect(source).toContain('plan.rosterAgentUid');
    expect(source).toContain('plan.responsibleAgentUid');
    expect(source).toContain('Array.isArray(plan.rosterAgentUids)');
    expect(source).toContain('Array.isArray(plan.responsibleAgentUids)');
    expect(source).toContain('function isEduCourseRosterAgentForData');
  });

  test('self leave callable validates owner and roster membership before writing attendance', () => {
    const source = readCloudFunctionSource('saveEduCourseSelfLeave');
    expect(source).toContain('if (!request.auth?.uid)');
    expect(source).toContain('normalizeEduCourseSessionRequestIds(request.data || {})');
    expect(source).toContain('planRef.collection("sessions").doc(sessionId)');
    expect(source).toContain('teamRef.collection("students").get()');
    expect(source).toContain('rosterIds.includes(targetStudentId)');
    expect(source).toContain('isStudentOwnedByUid(student, callerUid)');
    expect(source).toContain('db.collection("eduAttendance")');
    expect(source).toContain('kind: "leave"');
    expect(source).toContain('status: "active"');
    expect(source).toContain('validateCourseLessonLinkedEventReady({ teamDoc, teamId, planId, sessionId, planSnap })');
    expect(source).toContain('const linkedSync = await syncCourseAttendanceToLinkedEvent({');
    expect(source).toContain('kind: leave ? "leave" : "registered"');
    expect(source).toContain('source: "saveEduCourseSelfLeave"');
    expect(source).toContain('COURSE_EVENT_ATTENDANCE_SYNC_FAILED');
    expect(source).not.toContain('.catch((err) => console.error("[syncCourseAttendanceToLinkedEvent:saveEduCourseSelfLeave]"');
  });


  test('self weekly course attendance callable validates owner and writes registered without touching signin', () => {
    const source = readCloudFunctionSource('saveEduCourseSelfAttendance');
    expect(source).toContain('if (!request.auth?.uid)');
    expect(source).toContain('normalizeEduCourseSessionRequestIds(request.data || {})');
    expect(source).toContain('const targetKind = sanitizeStr(request.data?.kind, 20) === "registered" ? "registered" : "leave"');
    expect(source).toContain('planRef.collection("sessions").doc(sessionId)');
    expect(source).toContain('sanitizeStr(plan.planType, 32) !== "weekly"');
    expect(source).toContain('SELF_ATTENDANCE_SESSION_CLOSED');
    expect(source).toContain('inactiveSelfAttendanceStatuses.has(sessionStatus)');
    expect(source).toContain('rosterIds.includes(targetStudentId)');
    expect(source).toContain('isStudentOwnedByUid(student, callerUid)');
    expect(source).toContain('db.collection("eduAttendance")');
    expect(source).toContain('const [dateAttendanceSnap, sessionAttendanceSnap] = await Promise.all');
    expect(source).toContain('existingDocsById');
    expect(source).toContain('if (recordSessionId && recordSessionId !== sessionId) return;');
    expect(source).toContain('if (recordDate && recordDate !== date) return;');
    expect(source).toContain('if (recordKind === "signin")');
    expect(source).toContain('hasActiveSignin');
    expect(source).toContain('signedIn: true');
    expect(source).toContain('kind: targetKind');
    expect(source).toContain('status: "active"');
    expect(source).toContain('validateCourseLessonLinkedEventReady({ teamDoc, teamId, planId, sessionId, planSnap })');
    expect(source).toContain('const linkedSync = await syncCourseAttendanceToLinkedEvent({');
    expect(source).toContain('source: "saveEduCourseSelfAttendance"');
    expect(source).toContain('COURSE_EVENT_ATTENDANCE_SYNC_FAILED');
    expect(source).not.toContain('.catch((err) => console.error("[syncCourseAttendanceToLinkedEvent]"');
  });

  test('course roster attendance merges legacy and session records by priority', () => {
    const source = readSourceBetween(
      'function mergeEduRosterAttendanceByStudentId',
      'async function fetchEduRosterStaffEnrollmentByStudentId'
    );
    expect(source).toContain('function mergeEduRosterAttendanceByStudentId');
    expect(source).toContain('getEduAttendanceKindPriority(kind) >= getEduAttendanceKindPriority(merged[studentId])');
    expect(source).toContain('const legacyAttendanceByStudentId = {};');
    expect(source).toContain('const sessionAttendanceByStudentId = {};');
    expect(source).toContain('return mergeEduRosterAttendanceByStudentId(legacyAttendanceByStudentId, sessionAttendanceByStudentId);');
  });

  test('student attendance overview callable merges roster, leave, signin, and missing states behind ownership guard', () => {
    const source = readCloudFunctionSource('getEduStudentAttendanceOverview');
    expect(source).toContain('if (!request.auth?.uid)');
    expect(source).toContain('getCallerAccessContext(request)');
    expect(source).toContain('isTeamStaffForData(teamDoc.data, callerUid)');
    expect(source).toContain('isStudentOwnedByUid(student, callerUid)');
    expect(source).toContain('teamRef.collection("coursePlans").get()');
    expect(source).toContain('entry.ref.collection("enrollments").get()');
    expect(source).toContain('entry.ref.collection("sessions").get()');
    expect(source).toContain('db.collection("eduAttendance")');
    expect(source).toContain('bySession');
    expect(source).toContain('byPlanDate');
    expect(source).toContain('buildEduAttendanceLessonStatus');
    expect(source).toContain('getEduStudentIdAliases(student, targetStudentId)');
    expect(source).toContain('getEduStudentPlanStartDate(student, enrollments)');
    expect(source).toContain('buildEduWeeklyAttendanceDates(plan, todayKey, studentPlanStartKey)');
    expect(source).toContain('studentIdAliases.some((id) => rosterIds.includes(id))');
    expect(source).toContain('date < studentPlanStartKey');
    expect(source).toContain('finalizeEduAttendanceSummary(summary)');
    expect(source).toContain('lessons.sort');
    const startDateHelper = readSourceBetween(
      'function getEduStudentPlanStartDate',
      'function createEduAttendanceSummary'
    );
    expect(startDateHelper).toContain('student?.enrolledAt');
    expect(startDateHelper).toContain('enrollment.reviewedAt');
    expect(startDateHelper).toContain('enrollment.appliedAt');
    const summaryHelper = readSourceBetween(
      'function createEduAttendanceSummary',
      'function buildEduAttendanceLessonStatus'
    );
    expect(summaryHelper).toContain('missing: 0');
    expect(summaryHelper).toContain('attendanceRate: 0');
    expect(summaryHelper).toContain('summary.missing += 1');
    expect(summaryHelper).toContain('summary.attendanceRate');
    const statusHelper = readSourceBetween(
      'function buildEduAttendanceLessonStatus',
      'function buildEduWeeklyAttendanceDates'
    );
    expect(statusHelper).toContain('return "upcoming"');
    expect(statusHelper).toContain('return "leave"');
    expect(statusHelper).toContain('return "attended"');
    expect(statusHelper).toContain('return "missing"');
    const weeklyHelper = readSourceBetween(
      'function buildEduWeeklyAttendanceDates',
      'exports.getEduStudentAttendanceOverview'
    );
    expect(weeklyHelper).toContain('attendanceStartKey');
    expect(weeklyHelper).toContain('[lowerBound, planStart, attendanceStart]');
  });
});

function makeScoreboardDb({ usageData } = {}) {
  const calls = [];
  const makeRef = (collectionName, docId) => ({
    get: jest.fn(async () => ({
      exists: usageData != null,
      data: () => usageData || {},
    })),
    set: jest.fn(async (payload, options) => {
      calls.push({ collectionName, docId, payload, options });
    }),
  });
  const db = {
    collection: jest.fn((collectionName) => ({
      doc: jest.fn((docId) => makeRef(collectionName, docId)),
    })),
  };
  db.__calls = calls;
  return db;
}

function makeScoreboardExports({ access, usageData } = {}) {
  const db = makeScoreboardDb({ usageData });
  const exported = createSportsApiProScoreboardExports({
    db,
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    },
    Timestamp: {
      fromMillis: (ms) => ({ ms, toMillis: () => ms }),
      fromDate: (date) => ({ ms: date.getTime(), toMillis: () => date.getTime() }),
    },
    onCall: (options, handler) => ({ options, handler }),
    onSchedule: (options, handler) => ({ options, handler }),
    HttpsError: TestHttpsError,
    defineSecret: (name) => ({ name, value: () => 'TEST_SECRET_VALUE' }),
    getCallerAccessContext: jest.fn(async () => access || {
      isSuperAdmin: false,
      hasPermission: () => false,
    }),
  });
  return { db, exported };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('event id lookup source', () => {
  test('event lookup prefers events/{eventId} and keeps legacy id query fallback', () => {
    const helperSource = readSourceBetween(
      'async function getEventDocByPublicId',
      'function getAuthUidFromUserDoc'
    );
    expect(helperSource).toContain('db.collection("events").doc(eventId).get()');
    expect(helperSource).toContain('db.collection("events").where("id", "==", eventId).limit(1).get()');
    expect(helperSource).toContain('async function getEventDocByPublicIdInTransaction');
    expect(helperSource).toContain('db.collection("events").doc(eventId)');
  });

  test('registration callables use the shared event id bridge', () => {
    expect(readCloudFunctionSource('registerForEvent')).toContain('getEventDocByPublicIdInTransaction(transaction, eventId)');
    expect(readCloudFunctionSource('cancelRegistration')).toContain('getEventDocByPublicIdInTransaction(transaction, eventId)');
    expect(readCloudFunctionSource('adjustTeamReservation')).toContain('getEventDocByPublicIdInTransaction(transaction, safeEventId)');
  });
});

describe('registration callable source contracts', () => {
  test('registerForEvent keeps auth, caller identity, transaction, lock, and activity record guards', () => {
    const source = readCloudFunctionSource('registerForEvent');
    expect(source).toContain('if (!request.auth)');
    expect(source).toContain('firstParticipant.userId !== callerUid');
    expect(source).toContain('db.collection("_regDedupe").doc(safeRequestId)');
    expect(source).toContain('const result = await db.runTransaction');
    expect(source).toContain('getEventDocByPublicIdInTransaction(transaction, eventId)');
    expect(source).toContain('const selfParticipantKeys = new Set(');
    expect(source).toContain('return selfParticipantKeys.has(registrationUniqueKey(r));');
    expect(source).not.toContain('r.userId === callerUid &&');
    expect(source).toContain('eventDoc.ref.collection("registrationLocks").doc(lockId)');
    expect(source).toContain('transaction.set(regLockRefs[idx]');
    expect(source).toContain('eventDoc.ref.collection("activityRecords").doc()');
    expect(source).toContain('transaction.set(arRef, arData)');
    expect(source).toContain('reg.identitySnapshot = buildMainPublicIdentitySnapshot(callerUserDoc?.data || {}, callerUid)');
    expect(source).not.toContain('callerMainIdentitySnapshot');
  });

  test('registerForEvent normalizes both event and user gender before enforcing gender restriction', () => {
    const source = readCloudFunctionSource('registerForEvent');
    expect(source).toContain('const allowedGender = normalizeBinaryGenderForRegistration(ed.allowedGender)');
    expect(source).toContain('const normalizedGender = normalizeBinaryGenderForRegistration(callerUserDoc?.data?.gender)');
    expect(source).toContain('if (!normalizedGender || normalizedGender !== allowedGender)');
    expect(source).not.toContain('normalizedGender !== ed.allowedGender');
  });

  test('cancelRegistration updates registrations, activityRecords, locks, and waitlist promotion in one transaction', () => {
    const source = readCloudFunctionSource('cancelRegistration');
    expect(source).toContain('const result = await db.runTransaction');
    expect(source).toContain('eventDoc.ref.collection("registrations")');
    expect(source).toContain('eventDoc.ref.collection("activityRecords")');
    expect(source).toContain('findActivityRecordForRegistration(allArs, reg)');
    expect(source).toContain('findActivityRecordForRegistration(allArs, candidate, "waitlisted")');
    expect(source).not.toContain('allArs.find((a) => a.uid === reg.userId');
    expect(source).not.toContain('allArs.find((a) => a.uid === candidate.userId');
    const wholeSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'functions', 'index.js'),
      'utf8'
    );
    expect(wholeSource).not.toContain('allArs.find((item) => item.uid === candidate.userId');
    expect(source).toContain('eventDoc.ref.collection("registrationLocks").doc(registrationLockId(reg))');
    expect(source).toContain('promotedCandidates.push(...promoteWaitlistForAvailableSeats(');
    expect(source).toContain('excludeCourseLinkedCandidates: isCourseLinkedEventData(ed)');
    expect(source).toContain('{ status: newStatus }');
    expect(source).toContain('{ status: "registered" }');
  });

  test('non-course promotion paths do not promote course-owned waitlist candidates', () => {
    const cancelSource = readCloudFunctionSource('cancelRegistration');
    expect(cancelSource).toContain('excludeCourseLinkedCandidates: isCourseLinkedEventData(ed)');

    const helperSource = readSourceBetween(
      'function promoteWaitlistForAvailableSeats',
      'exports.registerForEvent'
    );
    expect(helperSource).toContain('excludeCourseLinkedCandidates = options.excludeCourseLinkedCandidates === true');
    expect(helperSource).toContain('!excludeCourseLinkedCandidates || !isCourseLinkedRegistrationData(r)');

    const reservationSyncSource = readSourceBetween(
      'function shouldSyncTeamReservationEvent',
      'function chooseReservationSummaryForUser'
    );
    expect(reservationSyncSource).toContain('if (isCourseLinkedEventData(eventData)) return false;');
  });
  test('course-linked attendance sync uses course-owned registrations and priority displacement', () => {
    const source = readSourceBetween(
      'async function syncCourseAttendanceToLinkedEvent',
      'function courseEnrollmentDocId'
    );
    expect(source).toContain('courseLinkedRegistrationDocId');
    expect(source).not.toContain('findManualRegistrationToAdoptForCourse');
    expect(source).toContain('const targetExistingReg = existingCourseReg || null');
    expect(source).toContain('findLatestDisplaceableConfirmedRegistration');
    expect(source).toContain('const targetAlreadyConfirmed = sanitizeStr(targetExistingReg?.status, 32) === "confirmed"');
    expect(source).toContain('while (simRegs.filter((reg) => reg.status === "confirmed").length > maxCount)');
    expect(source).toContain('if (maxCount > 0)');
    expect(source).toContain('courseRegistrationStatus = "waitlisted"');
    expect(source).toContain('transaction.set(targetRegRef, regData, { merge: true })');
    expect(source).toContain('status: "waitlisted"');
    expect(source).toContain('buildCourseLinkedActivityRecordData');
    expect(source).toContain('rebuildCourseLinkedEventOccupancyUpdate');
    expect(source).toContain('syncCourseLessonRosterToEventInternal');
    expect(source).toContain('const rosterStudentIds = Array.isArray(session.studentIds)');
    expect(source).toContain('attendanceByStudentId[studentId] || "leave"');
    expect(source).toContain('const syncKind = normalizeCourseLinkAttendanceKind(kind)');
    expect(source).toContain('reason: "default_leave"');
    expect(source).toContain('return { success: false, synced: false, reason: "invalid_course_event_link"');
    expect(source).toContain('return { success: false, synced: false, reason: "event_not_found" }');
    expect(source).toContain('getCourseLinkedEventValidationFailure(eventData, courseLinkId)');
    expect(source).toContain('reason: linkValidationFailure');
  });

  test('course plan auto roster sync updates only future auto sessions from effective course roster', () => {
    const helperSource = readSourceBetween(
      'async function syncEduCoursePlanAutoSessionRostersInternal',
      'async function syncEduCoursePlanAutoSessionRostersForStudentChange'
    );
    expect(helperSource).toContain('const syncResult = await db.runTransaction(async (tx) => {');
    expect(helperSource).toContain('loadEduAutoMigrationCompletedInTransaction(tx)');
    expect(helperSource).toContain('buildEduCourseEffectiveRosterStudentIds({ plan, enrollments, students, migrationCompleted })');
    expect(helperSource).toContain('tx.get(planRef.collection("sessions"))');
    expect(helperSource).toContain('getEduCourseSessionRosterSyncSkipReason(item.data, nowMs)');
    expect(helperSource).toContain('studentIds: rosterStudentIds');
    expect(helperSource).toContain('rosterSyncedAt: FieldValue.serverTimestamp()');
    expect(helperSource).toContain('rosterSyncRevision: FieldValue.increment(1)');
    expect(helperSource).toContain('if (linkedEvent) linkedSyncSessions.push({');
    expect(helperSource).toContain('if (syncResult?.skipped === true || syncResult?.success === false) return syncResult;');
    expect(helperSource).not.toContain('if (syncResult?.skipped || syncResult?.success === false)');
    expect(helperSource).toContain('for (const session of syncResult.linkedSyncSessions || [])');
    expect(helperSource).toContain('syncCourseLessonRosterToEventInternal({');
    expect(helperSource).not.toContain('createEventFromCourseLesson');

    const skipReasonSource = readSourceBetween(
      'function getEduCourseSessionRosterSyncSkipReason',
      'async function syncEduCoursePlanAutoSessionRostersInternal'
    );
    expect(skipReasonSource).toContain('started_or_past_session');
    expect(skipReasonSource).toContain('terminal_session');

    const callableSource = readCloudFunctionSource('syncEduCoursePlanAutoSessionRosters');
    expect(callableSource).toContain('hasEduCourseStaffAccess(teamDoc.data, callerUid, access)');
    expect(callableSource).toContain('syncEduCoursePlanAutoSessionRostersInternal({');
    expect(callableSource).toContain('COURSE_SESSION_ROSTER_SYNC_FAILED');
    expect(callableSource).toContain('EDU_COURSE_ROSTER_SYNC_FUNCTION_OPTIONS');
    expect(callableSource).not.toContain('EDU_COURSE_ROSTER_SYNC_TRIGGER_OPTIONS');

    const triggerOptionsSource = readSourceBetween(
      'const EDU_COURSE_ROSTER_SYNC_TRIGGER_OPTIONS',
      'const EDU_COURSE_ROSTER_SYNC_MAX_SESSIONS'
    );
    expect(triggerOptionsSource).toContain('const EDU_COURSE_ROSTER_SYNC_TRIGGER_OPTIONS = Object.freeze({');
    expect(triggerOptionsSource).toContain('...EDU_COURSE_ROSTER_SYNC_FUNCTION_OPTIONS,\n  retry: true,');

    const enrollmentTrigger = readCloudFunctionSource('onEduCourseEnrollmentRosterSourceWrite');
    expect(enrollmentTrigger).toContain('EDU_COURSE_ROSTER_SYNC_TRIGGER_OPTIONS');
    expect(enrollmentTrigger).toContain('document: "teams/{teamId}/coursePlans/{planId}/enrollments/{enrollmentId}"');
    expect(enrollmentTrigger).toContain('hasEduCourseEnrollmentRosterRelevantChange(beforeData, afterData)');
    expect(enrollmentTrigger).toContain('source: "course_enrollment_write"');

    const studentTrigger = readCloudFunctionSource('onEduCourseStudentRosterSourceWrite');
    expect(studentTrigger).toContain('EDU_COURSE_ROSTER_SYNC_TRIGGER_OPTIONS');
    expect(studentTrigger).toContain('document: "teams/{teamId}/students/{studentId}"');
    expect(studentTrigger).toContain('hasEduCourseStudentRosterRelevantChange(beforeData, afterData)');
    expect(studentTrigger).toContain('syncEduCoursePlanAutoSessionRostersForStudentChange({');

    const planTrigger = readCloudFunctionSource('onEduCoursePlanRosterSourceWrite');
    expect(planTrigger).toContain('EDU_COURSE_ROSTER_SYNC_TRIGGER_OPTIONS');
    expect(planTrigger).toContain('document: "teams/{teamId}/coursePlans/{planId}"');
    expect(planTrigger).toContain('hasEduCoursePlanRosterRelevantChange(beforeData, afterData)');
    expect(planTrigger).toContain('source: "course_plan_write"');
  });
  test('course session update callable syncs linked event details and roster cleanup', () => {
    const updateSource = readCloudFunctionSource('updateEduCourseSession');
    expect(updateSource).toContain('sanitizeEduCourseSessionUpdates');
    expect(updateSource).toContain('hasEduCourseStaffAccess(teamDoc.data, callerUid, access)');
    expect(updateSource).toContain('sessionRef.update({');
    expect(updateSource).toContain('validateCourseLessonLinkedEventReady({ teamDoc, teamId, planId, sessionId, planSnap, linkSnap })');
    expect(updateSource).toContain('syncCourseLessonEventDetailsFromSessionInternal');
    expect(updateSource).toContain('syncCourseLessonRosterToEventInternal');
    expect(updateSource).toContain('Object.prototype.hasOwnProperty.call(updates, "studentIds")');
    expect(updateSource).toContain('throw new HttpsError("failed-precondition", "COURSE_EVENT_DETAILS_SYNC_FAILED"');
    expect(updateSource).toContain('throw new HttpsError("failed-precondition", "COURSE_EVENT_ROSTER_SYNC_FAILED"');
    expect(updateSource).not.toContain('event_details_sync_failed');
    expect(updateSource).not.toContain('roster_sync_failed');

    const eventDetailsSource = readSourceBetween(
      'async function syncCourseLessonEventDetailsFromSessionInternal',
      'function courseEnrollmentDocId'
    );
    const preflightSource = readSourceBetween(
      'async function validateCourseLessonLinkedEventReady',
      'async function syncCourseLessonRosterToEventInternal'
    );
    expect(preflightSource).toContain('return { success: false, checked: true, reason: "invalid_course_event_link"');
    expect(eventDetailsSource).toContain('return { success: false, synced: false, reason: "invalid_course_event_link" };');
    expect(eventDetailsSource).toContain('const courseLinkId = sanitizeStr(link.courseLinkId, 128)');
    expect(eventDetailsSource).toContain('return { success: false, synced: false, reason: "event_not_found" }');
    expect(eventDetailsSource).toContain('getCourseLinkedEventValidationFailure(eventData, courseLinkId)');
    expect(eventDetailsSource).toContain('reason: linkValidationFailure');

    const convertSource = readCloudFunctionSource('createEventFromCourseLesson');
    expect(convertSource).toContain('findUserDocByUidOrLineUserId(callerUid)');
    expect(convertSource).toContain('resolveCourseConvertedEventCreatorName(callerUserData, request.auth.token || {}, callerUid, request.data || {})');
    expect(convertSource).toContain('buildCourseConvertedEventRepairPatch({');
    expect(convertSource).toContain('const buildNewCourseLessonConversion = (nextEventId, nextCourseLinkId) => {');
    expect(convertSource).toContain('const rebuiltCourseLinkId = crypto.randomBytes(16).toString("hex");');
    expect(convertSource).toContain('tx.set(linkRef, rebuiltMapping)');
    expect(convertSource).toContain('rebuilt: true');
    expect(convertSource).toContain('previousEventId: existingEventId || null');
    expect(convertSource).toContain('repaired: !!existingEventDoc');
    expect(convertSource).toContain('creatorSnapshot,');
    expect(convertSource).toContain('throw new HttpsError("failed-precondition", "COURSE_EVENT_ROSTER_SYNC_FAILED"');
    expect(convertSource).toContain('console.error("[createEventFromCourseLesson rosterSync]"');
    expect(convertSource).toContain('message: err?.message || "Course event roster sync failed"');
    expect(convertSource).toContain('buildCourseLessonSessionEventLinkPatch({');
    expect(convertSource).toContain('tx.update(sessionRef, buildCourseLessonSessionEventLinkPatch');

    const sessionLinkPatchSource = readSourceBetween(
      'function buildCourseLessonSessionEventLinkPatch',
      'function hasEduCourseStaffAccess'
    );
    expect(sessionLinkPatchSource).toContain('convertedEventId: safeEventId');
    expect(sessionLinkPatchSource).toContain('linkedEventId: safeEventId');
    expect(sessionLinkPatchSource).toContain('courseLinkKey: sanitizeStr');

    const convertedEventSource = readSourceBetween(
      'function buildCourseLessonConvertedEventData',
      'function buildCourseLessonLinkMapping'
    );
    expect(convertedEventSource).toContain('type: "course"');
    expect(convertedEventSource).toContain('buildCourseConvertedEventImageFields(courseImage');
    expect(convertedEventSource).toContain('...imageFields');
    expect(convertedEventSource).toContain('creator: safeCallerName');
    expect(convertedEventSource).toContain('creatorName: safeCallerName');
    expect(convertedEventSource).toContain('organizer: safeCallerName');
    expect(convertedEventSource).toContain('creatorSnapshot: creatorSnapshot || null');

    const imageFieldsSource = readSourceBetween(
      'function buildCourseConvertedEventImageFields',
      'function isLikelyUidDisplayValue'
    );
    expect(imageFieldsSource).toContain('COURSE_CONVERTED_EVENT_IMAGE_VARIANT_DUPLICATE_MAX_LENGTH');
    expect(imageFieldsSource).toContain('!/^data:image\\//i.test(safeImage)');
    expect(imageFieldsSource).toContain('safeImage.length <= COURSE_CONVERTED_EVENT_IMAGE_VARIANT_DUPLICATE_MAX_LENGTH');
    expect(imageFieldsSource).toContain('coverImage: ""');
    expect(imageFieldsSource).toContain('coverImage: safeImage');
    expect(imageFieldsSource).toContain('imageVariants.cover = safeImage');
    expect(imageFieldsSource).toContain('imageVariants.homeNext = safeImage');

    const courseImageSource = readSourceBetween(
      'function getCourseConvertedEventImage',
      'function resolveCourseConvertedEventCreatorName'
    );
    expect(courseImageSource).toContain('session.coverImage');
    expect(courseImageSource).toContain('plan.coverImage');
    expect(courseImageSource).toContain('plan.imageVariants?.card');
    expect(courseImageSource).toContain('plan.imageVariants?.cover');
    expect(courseImageSource).toContain('plan.imageVariants?.homeNext');
    expect(courseImageSource).toContain('requestData.courseCoverImage');
    expect(courseImageSource).toContain('requestData.imageVariants?.cover');

    const rosterSource = readSourceBetween(
      'async function syncCourseLessonRosterToEventInternal',
      'function courseEnrollmentDocId'
    );
    expect(rosterSource).toContain('cancelCourseLinkedRegistrationsOutsideRoster');
    expect(rosterSource).toContain('orphanCancelledCount');
    expect(rosterSource).toContain('!rosterSet.has(studentId)');
    expect(rosterSource).toContain('status: "cancelled"');
    expect(rosterSource).toContain('rebuildCourseLinkedEventOccupancyUpdate(eventData, simRegs)');
    expect(rosterSource).toContain('demoteConfirmedRegistrationsToCapacity');
    expect(rosterSource).toContain('promoteWaitlistForAvailableSeats(');
    expect(rosterSource).toContain('excludeManualCourseRosterOverrides: true');
    expect(rosterSource).toContain('promotedCount: promoted.length');
    expect(rosterSource).toContain('if (result?.success === false)');
    expect(rosterSource).toContain('COURSE_EVENT_ATTENDANCE_SYNC_FAILED');
    expect(rosterSource).toContain('const orphanCleanupFailed = orphanCleanup?.success === false');
    expect(rosterSource).toContain('success: !orphanCleanupFailed');
    expect(rosterSource).toContain('reason: orphanCleanupFailed ? (orphanCleanup.reason || "orphan_cleanup_failed") : null');
    expect(rosterSource).toContain('return { success: false, cancelledCount: 0, promotedCount: 0, reason: "missing_link" }');
    expect(rosterSource).toContain('return { success: false, cancelledCount: 0, promotedCount: 0, reason: "event_not_found" }');
    expect(rosterSource).toContain('getCourseLinkedEventValidationFailure(eventData, safeCourseLinkId)');
    expect(rosterSource).toContain('reason: linkValidationFailure');

    const helperSource = readSourceBetween(
      'function promoteWaitlistForAvailableSeats',
      'exports.registerForEvent'
    );
    expect(helperSource).toContain('prioritizeCourseLinkedCandidates = options.prioritizeCourseLinkedCandidates === true');
    expect(helperSource).toContain('Number(isCourseLinkedRegistrationData(b)) - Number(isCourseLinkedRegistrationData(a))');
  });
  test('staff roster attendance callable writes attendance and syncs linked activity', () => {
    const source = readCloudFunctionSource('saveEduSessionAttendanceChanges');
    expect(source).toContain('hasEduCourseStaffAccess(teamDoc.data, callerUid, access)');
    expect(source).toContain('if (!rosterIds.includes(change.studentId))');
    expect(source).toContain('const syncKind = change.kind ? normalizeCourseLinkAttendanceKind(change.kind) : "leave"');
    expect(source).toContain('validateCourseLessonLinkedEventReady({ teamDoc, teamId, planId, sessionId, planSnap })');
    expect(source).toContain('source: "saveEduSessionAttendanceChanges"');
    expect(source).toContain('kind: syncKind');
    expect(source).toContain('COURSE_EVENT_ATTENDANCE_SYNC_FAILED');
    expect(source).not.toContain('return { success: false, synced: false, reason: "sync_failed" };');
  });

  test('course-linked registration keys are student-scoped for parent-owned students', () => {
    const source = readSourceBetween(
      'function registrationUniqueKey',
      'function dedupeRegistrations'
    );
    expect(source).toContain('getCourseLinkedRegistrationKey(reg)');
    expect(source).toContain('courseStudentId');
    expect(source).toContain('return `${userId}_self`;');

    const activityRecordSource = readSourceBetween(
      'function findActivityRecordForRegistration',
      'async function syncCourseAttendanceToLinkedEvent'
    );
    expect(activityRecordSource).toContain('const isCourseLinkedReg = isCourseLinkedRegistrationData(reg)');
    expect(activityRecordSource).toContain('const courseStudentId = sanitizeStr(reg.courseStudentId, 100)');
    expect(activityRecordSource).toContain('if (!hasCourseLinkedActivityRecordData(record)) return false');
    expect(activityRecordSource).toContain('sanitizeStr(record.courseStudentId, 100) !== courseStudentId');
    expect(activityRecordSource).toContain('if (hasCourseLinkedActivityRecordData(record)) return false');
  });
  test('refreshMyActivityRecords resolves UID bridge, applies cooldown, and repairs activity records by auth UID', () => {
    const source = readCloudFunctionSource('refreshMyActivityRecords');
    expect(source).toContain('if (!request.auth?.uid)');
    expect(source).toContain('findUserDocByUidOrLineUserId(request.auth.uid)');
    expect(source).toContain('getAuthUidFromUserDoc(found, request.auth.uid)');
    expect(source).toContain('activityRecordsManualRefreshAt');
    expect(source).toContain('throw new HttpsError("resource-exhausted", "too soon"');
    expect(source).toContain('repairActivityRecordsForUserId(targetUid');
    expect(source).toContain('source: "self_refresh"');
    expect(source).toContain('activityRecordsManualRefreshCompletedAt');
  });
});

describe('game leaderboard display name source contracts', () => {
  test('game score submissions resolve the canonical users profile before fallback names', () => {
    const helperSource = readSourceBetween(
      'function isGamePlaceholderDisplayName',
      'async function resolveAuditActorName'
    );
    expect(helperSource).toContain('findUserDocByUidOrLineUserId(uid)');
    expect(helperSource).toContain('userData?.displayName');
    expect(helperSource).toContain('userData?.name');
    expect(helperSource).toContain('isGamePlaceholderDisplayName');

    const shotSource = readCloudFunctionSource('submitShotGameScore');
    expect(shotSource).toContain('const safeDisplayName = await resolveGameDisplayName({');
    expect(shotSource).toContain('inputDisplayName: displayName');

    const kickSource = readCloudFunctionSource('submitKickGameScore');
    expect(kickSource).toContain('const safeDisplayName = await resolveGameDisplayName({');
    expect(kickSource).toContain('inputDisplayName: displayName');
  });
});

describe('cancelRegistration CF transaction ordering', () => {
  test('performs transaction reads before writes', () => {
    const txSource = readCancelRegistrationTransactionSource();
    const writeIndexes = [
      ...findAllIndexes(txSource, 'transaction.update('),
      ...findAllIndexes(txSource, 'transaction.delete('),
      ...findAllIndexes(txSource, 'transaction.set('),
      ...findAllIndexes(txSource, 'transaction.create('),
    ];
    const readIndexes = findAllIndexes(txSource, 'transaction.get(');
    expect(writeIndexes.length).toBeGreaterThan(0);
    expect(readIndexes.length).toBeGreaterThan(0);

    const firstWriteIndex = Math.min(...writeIndexes);
    const lateReadIndexes = readIndexes.filter((index) => index > firstWriteIndex);
    const activityRecordsReadIndex = txSource.indexOf('eventDoc.ref.collection("activityRecords")');

    expect(activityRecordsReadIndex).toBeGreaterThanOrEqual(0);
    expect(activityRecordsReadIndex).toBeLessThan(firstWriteIndex);
    expect(lateReadIndexes).toEqual([]);
  });

  test('allows assigned single-event roster managers to touch confirmed registrations', () => {
    const source = readCloudFunctionSource('cancelRegistration');
    expect(source).toContain('canManageSingleEventRosterForAccess(');
    expect(source).toContain('permissionCheckRegs');
    expect(source).not.toContain('CONFIRMED_MANAGER_RESTRICTED');
    expect(source).toContain('callerAccess');
    expect(source).toContain('callerUid');
  });

  test('treats already-cancelled targets as idempotent no-ops', () => {
    const source = readCloudFunctionSource('cancelRegistration');
    expect(source).toContain('const alreadyCancelledRegs = []');
    expect(source).toContain('alreadyCancelled: alreadyCancelledRegs.map');
    expect(source).toContain('alreadyCancelled: result.alreadyCancelled || []');
    expect(source).not.toContain('throw new HttpsError("failed-precondition", "ALREADY_CANCELLED")');
  });
});

describe('team reservation membership sync CF source', () => {
  test('user membership watcher invokes reservation seat sync', () => {
    const source = readCloudFunctionSource('watchUsersChanges');
    expect(source).toContain('timeoutSeconds: 60');
    expect(source).toContain('memory: "256MiB"');
    expect(source).toContain('syncTeamReservationSeatsForUserChange');
    expect(source).toContain('beforeData');
    expect(source).toContain('afterData');
  });

  test('sync transaction reads before writes', () => {
    const source = readSourceBetween(
      'async function syncTeamReservationSeatsForUserEvent',
      'async function syncTeamReservationSeatsForUserChange'
    );
    const writeIndexes = [
      ...findAllIndexes(source, 'transaction.update('),
      ...findAllIndexes(source, 'transaction.delete('),
      ...findAllIndexes(source, 'transaction.set('),
      ...findAllIndexes(source, 'transaction.create('),
    ];
    const readIndexes = findAllIndexes(source, 'transaction.get(');
    expect(writeIndexes.length).toBeGreaterThan(0);
    expect(readIndexes.length).toBeGreaterThan(0);
    const firstWriteIndex = Math.min(...writeIndexes);
    expect(readIndexes.filter((index) => index > firstWriteIndex)).toEqual([]);
  });
});

describe('createCustomToken validation', () => {
  test('rejects unauthenticated request', () => {
    const result = validateCreateCustomTokenInput({ accessToken: 'tok' }, null);
    expect(result.error).toBe('unauthenticated');
  });

  test('rejects missing access token', () => {
    const result = validateCreateCustomTokenInput({}, { uid: 'u1' });
    expect(result.error).toBe('invalid-argument');
  });

  test('rejects non-string access token', () => {
    const result = validateCreateCustomTokenInput({ accessToken: 123 }, { uid: 'u1' });
    expect(result.error).toBe('invalid-argument');
  });

  test('accepts valid input', () => {
    const result = validateCreateCustomTokenInput({ accessToken: 'valid_tok' }, { uid: 'u1' });
    expect(result).toBeNull();
  });
});

describe('writeAuditLog validation', () => {
  test('rejects invalid action', () => {
    const result = validateAuditLogInput({ action: 'hack_system' });
    expect(result.error).toBe('invalid-argument');
  });

  test('rejects invalid target type', () => {
    const result = validateAuditLogInput({ action: 'login_success', targetType: 'alien' });
    expect(result.error).toBe('invalid-argument');
  });

  test('rejects invalid result', () => {
    const result = validateAuditLogInput({ action: 'login_success', result: 'maybe' });
    expect(result.error).toBe('invalid-argument');
  });

  test('rejects invalid source', () => {
    const result = validateAuditLogInput({ action: 'login_success', source: 'hack' });
    expect(result.error).toBe('invalid-argument');
  });

  test('accepts all valid audit actions', () => {
    for (const action of ALLOWED_AUDIT_ACTIONS) {
      expect(validateAuditLogInput({ action })).toBeNull();
    }
  });

  test('accepts valid complete input', () => {
    const result = validateAuditLogInput({
      action: 'event_signup',
      targetType: 'event',
      result: 'success',
      source: 'liff',
    });
    expect(result).toBeNull();
  });
});

describe('syncUserRole validation', () => {
  test('rejects missing targetUid', () => {
    const result = validateSyncUserRole({}, 'admin');
    expect(result.error).toBe('invalid-argument');
  });

  test('rejects invalid role', () => {
    const result = validateSyncUserRole({ targetUid: 'u1', newRole: 'hacker' }, 'admin');
    expect(result.error).toBe('invalid-argument');
  });

  test('admin cannot assign admin (same level)', () => {
    const result = validateSyncUserRole({ targetUid: 'u1', newRole: 'admin' }, 'admin');
    expect(result.error).toBe('permission-denied');
  });

  test('admin cannot assign super_admin (higher level)', () => {
    const result = validateSyncUserRole({ targetUid: 'u1', newRole: 'super_admin' }, 'admin');
    expect(result.error).toBe('permission-denied');
  });

  test('admin can assign captain (lower level)', () => {
    const result = validateSyncUserRole({ targetUid: 'u1', newRole: 'captain' }, 'admin');
    expect(result).toBeNull();
  });

  test('super_admin can assign admin', () => {
    const result = validateSyncUserRole({ targetUid: 'u1', newRole: 'admin' }, 'super_admin');
    expect(result).toBeNull();
  });

  test('coach cannot assign user (lower but coach level=1, user=0)', () => {
    const result = validateSyncUserRole({ targetUid: 'u1', newRole: 'user' }, 'coach');
    expect(result).toBeNull();
  });
});

describe('adjustExp validation', () => {
  test('rejects missing uid', () => {
    expect(validateAdjustExp({ amount: 10 }).error).toBe('invalid-argument');
  });

  test('rejects non-number amount', () => {
    expect(validateAdjustExp({ uid: 'u1', amount: 'ten' }).error).toBe('invalid-argument');
  });

  test('rejects NaN amount', () => {
    expect(validateAdjustExp({ uid: 'u1', amount: NaN }).error).toBe('invalid-argument');
  });

  test('accepts positive amount', () => {
    expect(validateAdjustExp({ uid: 'u1', amount: 50 })).toBeNull();
  });

  test('accepts negative amount (EXP deduction)', () => {
    expect(validateAdjustExp({ uid: 'u1', amount: -10 })).toBeNull();
  });

  test('accepts zero amount', () => {
    expect(validateAdjustExp({ uid: 'u1', amount: 0 })).toBeNull();
  });
});

describe('privileged LINE notification toggles', () => {
  test('blocks disabled category on server queue path', () => {
    const toggles = normalizeNotificationToggles({ category_activity: false });
    expect(shouldSkipLineNotificationByToggles("activity", "template:signup_success", toggles)).toBe(true);
  });

  test('blocks disabled template type on server queue path', () => {
    const toggles = normalizeNotificationToggles({ type_signup_success: false });
    expect(shouldSkipLineNotificationByToggles("activity", "template:signup_success", toggles)).toBe(true);
  });

  test('forced sources bypass server-side toggles', () => {
    const toggles = normalizeNotificationToggles({
      category_activity: false,
      type_waitlist_promoted: false,
    });
    expect(shouldSkipLineNotificationByToggles("activity", "template:waitlist_promoted", toggles)).toBe(false);
    expect(shouldSkipLineNotificationByToggles("system", "target:all", toggles)).toBe(false);
  });

  test('normalization drops unknown keys and non-boolean values', () => {
    expect(normalizeNotificationToggles({
      category_activity: false,
      debug_mode: true,
      type_signup_success: "false",
    })).toEqual({
      category_activity: false,
    });
  });

  test('forced sources bypass featureFlags loading entirely', async () => {
    const load = jest.fn().mockRejectedValue(new Error('should_not_load'));

    const toggles = await getNotificationTogglesWithFallback("template:event_changed", { load });

    expect(load).not.toHaveBeenCalled();
    expect(toggles).toEqual({});
    expect(shouldSkipLineNotificationByToggles("activity", "template:event_changed", toggles)).toBe(false);
  });

  test('featureFlags load failure falls back to allow instead of dropping queue', async () => {
    const load = jest.fn().mockRejectedValue(new Error('load_failed'));
    const onWarn = jest.fn();

    const toggles = await getNotificationTogglesWithFallback("template:signup_success", { load, onWarn });

    expect(load).toHaveBeenCalledTimes(1);
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(toggles).toEqual({});
    expect(shouldSkipLineNotificationByToggles("activity", "template:signup_success", toggles)).toBe(false);
  });
});

describe('Permission check (inherent + dynamic)', () => {
  test('coach has no inherent activity.manage.entry', () => {
    expect(hasPermission('coach', [], 'activity.manage.entry')).toBe(false);
  });

  test('captain has no inherent admin.tournaments.entry', () => {
    expect(hasPermission('captain', [], 'admin.tournaments.entry')).toBe(false);
  });

  test('user has no inherent permissions', () => {
    expect(hasPermission('user', [], 'activity.manage.entry')).toBe(false);
  });

  test('dynamic permission grants access', () => {
    expect(hasPermission('user', ['admin.shop.entry'], 'admin.shop.entry')).toBe(true);
  });

  test('disabled permission code always denied', () => {
    expect(hasPermission('admin', ['admin.roles.entry'], 'admin.roles.entry')).toBe(false);
  });

  test('dynamic staff permissions grant access', () => {
    expect(hasPermission('coach', ['activity.manage.entry', 'admin.shop.entry'], 'activity.manage.entry')).toBe(true);
    expect(hasPermission('coach', ['admin.shop.entry'], 'admin.shop.entry')).toBe(true);
  });

  test('missing rolePermissions document falls back to defaults', () => {
    const defaults = resolveStoredRolePermissions('captain', { exists: false });
    expect(defaults).toContain('activity.manage.entry');
    expect(defaults).toContain('admin.tournaments.entry');
    expect(defaults).toContain('team.manage.entry');
  });

  test('explicitly empty rolePermissions document revokes staff defaults', () => {
    expect(resolveStoredRolePermissions('coach', { exists: true, data: { permissions: [] } })).toEqual([]);
    expect(hasPermission('coach', [], 'activity.manage.entry')).toBe(false);
  });

  test('user permission grants keep only enabled catalog codes', () => {
    const grants = resolveUserPermissionGrants({
      exists: true,
      data: { permissions: [
        'profile.secondary_identity',
        'admin.roles.entry',
        'event.edit_own',
        'unknown.permission',
        { code: 'admin.messages.entry' },
        '',
        'profile.secondary_identity',
      ] },
    });
    expect(grants).toEqual(['profile.secondary_identity']);

    const effective = resolveEffectivePermissions('user', [], grants);
    expect(hasPermission('user', effective, 'profile.secondary_identity')).toBe(true);
    expect(hasPermission('user', effective, 'admin.roles.entry')).toBe(false);
    expect(hasPermission('user', effective, 'event.edit_self')).toBe(false);
    expect(hasPermission('user', effective, 'unknown.permission')).toBe(false);
  });

  test('disabled or missing user permission grants fail closed', () => {
    expect(resolveUserPermissionGrants({ exists: false })).toEqual([]);
    expect(resolveUserPermissionGrants({ exists: true, data: { enabled: false, permissions: ['profile.secondary_identity'] } })).toEqual([]);
  });

  test('caller access context source merges user-specific grants', () => {
    const helperSource = readSourceBetween('async function getUserPermissionGrantsFromFirestore', 'function sanitizeRoleActivityCapabilityList');
    expect(helperSource).toContain('collection("userPermissionGrants")');
    expect(helperSource).toContain('data.enabled === false');
    expect(helperSource).toContain('sanitizeUserPermissionGrantCodeList(data.permissions)');

    const accessSource = readSourceBetween('async function getCallerAccessContext', 'function canUseSecondaryIdentityAccess');
    expect(accessSource).toContain('getUserPermissionGrantsFromFirestore(request.auth?.uid)');
    expect(accessSource).toContain('[...stored, ...userGrants, ...inherent]');
  });
});

describe('VALID_ROLES', () => {
  test('contains all expected roles', () => {
    expect(VALID_ROLES.has('user')).toBe(true);
    expect(VALID_ROLES.has('coach')).toBe(true);
    expect(VALID_ROLES.has('captain')).toBe(true);
    expect(VALID_ROLES.has('venue_owner')).toBe(true);
    expect(VALID_ROLES.has('admin')).toBe(true);
    expect(VALID_ROLES.has('super_admin')).toBe(true);
  });

  test('does not contain invalid roles', () => {
    expect(VALID_ROLES.has('moderator')).toBe(false);
    expect(VALID_ROLES.has('root')).toBe(false);
  });
});

describe('ROLE_LEVELS hierarchy', () => {
  test('levels are strictly ascending', () => {
    expect(ROLE_LEVELS.user).toBeLessThan(ROLE_LEVELS.coach);
    expect(ROLE_LEVELS.coach).toBeLessThan(ROLE_LEVELS.captain);
    expect(ROLE_LEVELS.captain).toBeLessThan(ROLE_LEVELS.venue_owner);
    expect(ROLE_LEVELS.venue_owner).toBeLessThan(ROLE_LEVELS.admin);
    expect(ROLE_LEVELS.admin).toBeLessThan(ROLE_LEVELS.super_admin);
  });
});

describe('applyFriendlyTournament CF permissions', () => {
  const team = {
    id: 'tm_alpha',
    captainUid: 'captain_uid',
    creatorUid: 'creator_uid',
    ownerUid: 'owner_uid',
    leaderUid: 'leader_uid',
    leaderUids: ['leader2_uid'],
  };

  test('admin and super_admin can apply only for their joined clubs', () => {
    expect(canApplyFriendlyTournamentForTeam('admin', team, 'other_uid', { teamIds: ['tm_alpha'] })).toBe(true);
    expect(canApplyFriendlyTournamentForTeam('super_admin', team, 'other_uid', { teamId: 'tm_alpha' })).toBe(true);
    expect(canApplyFriendlyTournamentForTeam('admin', team, 'other_uid', { teamIds: ['tm_other'] })).toBe(false);
    expect(canApplyFriendlyTournamentForTeam('super_admin', team, 'other_uid', {})).toBe(false);
  });

  test('team officers can apply for their own club', () => {
    expect(canApplyFriendlyTournamentForTeam('user', team, 'captain_uid', {})).toBe(true);
    expect(canApplyFriendlyTournamentForTeam('user', team, 'creator_uid', {})).toBe(true);
    expect(canApplyFriendlyTournamentForTeam('user', team, 'owner_uid', {})).toBe(true);
    expect(canApplyFriendlyTournamentForTeam('user', team, 'leader_uid', {})).toBe(true);
    expect(canApplyFriendlyTournamentForTeam('user', team, 'leader2_uid', {})).toBe(true);
  });

  test('non-admin non-officer cannot apply for another club', () => {
    expect(canApplyFriendlyTournamentForTeam('coach', team, 'other_uid', { teamIds: ['tm_alpha'] })).toBe(false);
    expect(canApplyFriendlyTournamentForTeam('captain', team, 'other_uid', { teamIds: ['tm_alpha'] })).toBe(false);
  });

  test('terminal application docs can be reused for a new apply request', () => {
    expect(shouldBlockFriendlyTournamentApply('pending', false)).toBe(true);
    expect(shouldBlockFriendlyTournamentApply('approved', false)).toBe(true);
    expect(shouldBlockFriendlyTournamentApply('cancelled', false)).toBe(false);
    expect(shouldBlockFriendlyTournamentApply('withdrawn', false)).toBe(false);
    expect(shouldBlockFriendlyTournamentApply('removed', false)).toBe(false);
    expect(shouldBlockFriendlyTournamentApply('rejected', false)).toBe(false);
    expect(shouldBlockFriendlyTournamentApply('removed', true)).toBe(true);
  });

  test('host can be displayed without consuming tournament capacity', () => {
    const entries = [
      { teamId: 'tm_host', entryStatus: 'host', countsTowardLimit: false },
      { teamId: 'tm_guest_1', entryStatus: 'approved' },
      { teamId: 'tm_guest_2', entryStatus: 'approved' },
    ];

    expect(cfBuildRegisteredTeamIdsFromEntries(entries)).toEqual(['tm_guest_1', 'tm_guest_2']);
    expect(cfBuildRegisteredTeamIdsFromEntries(entries, { additionalTeamId: 'tm_guest_3' }))
      .toEqual(['tm_guest_1', 'tm_guest_2', 'tm_guest_3']);
  });
});

describe('createFriendlyTournament CF host selection permissions', () => {
  const team = {
    id: 'tm_alpha',
    captainUid: 'captain_uid',
    ownerUid: 'owner_uid',
  };

  test('admin can create without a host team and host participation is forced off', () => {
    expect(validateCreateFriendlyTournamentHost('admin', null, 'admin_uid', '')).toEqual({
      ok: true,
      hostParticipatesAllowed: false,
    });
  });

  test('non-admin cannot create without a host team', () => {
    expect(validateCreateFriendlyTournamentHost('user', null, 'captain_uid', '')).toEqual({
      ok: false,
      error: 'HOST_TEAM_REQUIRED',
    });
  });

  test('admin can choose a non-officer host display but cannot auto-enroll it', () => {
    expect(validateCreateFriendlyTournamentHost('super_admin', team, 'admin_uid', 'tm_alpha')).toEqual({
      ok: true,
      hostParticipatesAllowed: false,
    });
  });

  test('team officers can create with host participation available', () => {
    expect(validateCreateFriendlyTournamentHost('user', team, 'captain_uid', 'tm_alpha')).toEqual({
      ok: true,
      hostParticipatesAllowed: true,
    });
  });
});

describe('friendly tournament sport compatibility CF guard', () => {
  test('allows same-sport tournament applications', () => {
    expect(assertTournamentSportCompatibleData(
      { sportTag: 'football' },
      { sportTag: 'football' }
    )).toBe('ok');
  });

  test('rejects different-sport tournament applications', () => {
    expect(assertTournamentSportCompatibleData(
      { sportTag: 'football' },
      { sportTag: 'basketball' }
    )).toBe('TOURNAMENT_TEAM_SPORT_MISMATCH');
  });

  test('rejects teams without a sport tag', () => {
    expect(assertTournamentSportCompatibleData(
      { sportTag: 'football' },
      {}
    )).toBe('TEAM_SPORT_REQUIRED');
  });

  test('can fall back to host team sport for legacy tournaments', () => {
    expect(assertTournamentSportCompatibleData(
      {},
      { sportTag: 'football' },
      { sportTag: 'football' }
    )).toBe('ok');
  });
});

describe('companion attendance repair guard', () => {
  test('detects comp_ uid written as self attendance', () => {
    expect(cfIsCompanionAttendanceSelfCandidate({
      uid: 'comp_1776681312140',
      participantType: 'self',
      companionId: '',
    })).toBe(true);
  });

  test('does not treat valid companion attendance as repair candidate', () => {
    expect(cfIsCompanionAttendanceSelfCandidate({
      uid: 'U1234567890abcdef1234567890abcdef',
      participantType: 'companion',
      companionId: 'comp_1776681312140',
    })).toBe(false);
  });

  test('builds strict repair patch only from active companion registration', () => {
    const patch = cfBuildCompanionAttendanceRepairPatch(
      { uid: 'comp_1776681312140', participantType: 'self', userName: 'Guest' },
      { userId: 'U1234567890abcdef1234567890abcdef', userName: 'Owner', companionId: 'comp_1776681312140', companionName: 'Guest', status: 'confirmed' }
    );
    expect(patch).toMatchObject({
      uid: 'U1234567890abcdef1234567890abcdef',
      userName: 'Owner',
      participantType: 'companion',
      companionId: 'comp_1776681312140',
      companionName: 'Guest',
      companionAttendancePreviousUid: 'comp_1776681312140',
    });
  });

  test('refuses repair when owner uid is not a LINE UID', () => {
    const patch = cfBuildCompanionAttendanceRepairPatch(
      { uid: 'comp_1776681312140', participantType: 'self', userName: 'Guest' },
      { userId: 'legacy_name', userName: 'Owner', companionId: 'comp_1776681312140', companionName: 'Guest', status: 'confirmed' }
    );
    expect(patch).toBeNull();
  });
});

describe('registerForEvent CF logic', () => {
  test('detects active duplicate', () => {
    const regs = [{ userId: 'u1', status: 'confirmed', participantType: 'self' }];
    expect(cfDuplicateCheck(regs, 'u1')).toBe(true);
  });

  test('ignores cancelled registrations', () => {
    const regs = [{ userId: 'u1', status: 'cancelled', participantType: 'self' }];
    expect(cfDuplicateCheck(regs, 'u1')).toBe(false);
  });

  test('ignores companion registrations', () => {
    const regs = [{ userId: 'u1', status: 'confirmed', participantType: 'companion' }];
    expect(cfDuplicateCheck(regs, 'u1')).toBe(false);
  });

  test('ordinary signup ignores same-uid course-linked student seats', () => {
    const regs = [{
      userId: 'parent1',
      status: 'confirmed',
      participantType: 'self',
      source: 'eduCourseLesson',
      courseLinkId: 'course-link-1',
      courseStudentId: 'student-a',
    }];
    expect(cfDuplicateCheck(regs, 'parent1')).toBe(false);
    expect(cfDuplicateCheck(regs, { userId: 'parent1', participantType: 'self' })).toBe(false);
  });

  test('confirmed when under capacity', () => {
    expect(cfAssignStatus(2, 5)).toBe('confirmed');
  });

  test('waitlisted when at capacity', () => {
    expect(cfAssignStatus(5, 5)).toBe('waitlisted');
  });

  test('waitlisted when over capacity', () => {
    expect(cfAssignStatus(6, 5)).toBe('waitlisted');
  });

  test('gender restriction accepts Chinese and English values after normalization', () => {
    expect(cfNormalizeBinaryGenderForRegistration('\u7537')).toBe('male');
    expect(cfNormalizeBinaryGenderForRegistration('\u5973')).toBe('female');
    expect(cfNormalizeBinaryGenderForRegistration('male')).toBe('male');
    expect(cfNormalizeBinaryGenderForRegistration('female')).toBe('female');
    expect(cfIsGenderRestricted('\u5973', '\u5973')).toBe(false);
    expect(cfIsGenderRestricted('\u5973', 'female')).toBe(false);
    expect(cfIsGenderRestricted('female', '\u5973')).toBe(false);
    expect(cfIsGenderRestricted('\u5973', '\u7537')).toBe(true);
    expect(cfIsGenderRestricted('\u5973', '\u5176\u4ed6')).toBe(true);
    expect(cfIsGenderRestricted('', '\u7537')).toBe(false);
  });

  test('duplicate confirmed docs do not consume a unique capacity slot', () => {
    const regs = [
      { userId: 'u1', status: 'confirmed', participantType: 'self' },
      { userId: 'u2', status: 'confirmed', participantType: 'self' },
      { userId: 'u1', status: 'confirmed', participantType: 'self' },
    ];
    expect(cfAssignStatus(regs, 3)).toBe('confirmed');
    expect(cfCountUniqueConfirmed(regs)).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
//  adminManageUser — extracted helpers (index.js:1103-1222)
//  2026-04-27 補強：之前完全沒有此函式的測試
// ═══════════════════════════════════════════════════════════════

describe('private message callable source contracts', () => {
  test('PM policy treats the enabled global switch as role-agnostic', () => {
    const source = readSourceBetween('function pmCanSendTo(', 'function pmBuildConversationId');
    expect(source).toContain('if (settings?.allowUserToUserPm === true) return true;');
    expect(source).not.toContain('normalizedFromRole === "user"');
    expect(source).not.toContain('normalizedToRole === "user"');
  });

  test('sendPrivateMessage authenticates LINE UIDs, enforces PM policy, rate limits, and writes audit copy', () => {
    const source = readCloudFunctionSource('sendPrivateMessage');
    expect(source).toContain('if (!request.auth?.uid)');
    expect(source).toContain('pmAssertLineUid(request.auth.uid, "fromUid")');
    expect(source).toContain('pmAssertLineUid(request.data?.toUid, "toUid")');
    expect(source).toContain('if (fromUid === toUid)');
    expect(source).toContain('const cId = pmBuildConversationId(fromUid, toUid)');
    expect(source).toContain('const result = await db.runTransaction');
    expect(source).toContain('pmCanSendTo(senderInfo.role, recipientInfo.role, hasExistingConversation, pmSettings)');
    expect(source).toContain('PM_DAILY_LIMIT_PER_UID');
    expect(source).toContain('PM_DAILY_LIMIT_PER_PEER');
    expect(source).toContain('db.collection("pmAuditConversations").doc(cId)');
    expect(source).toContain('db.collection("pmAuditLogs").doc');
  });

  test('markPrivateConversationRead only accepts participant conversation ids and mirrors read state to peer/audit docs', () => {
    const source = readCloudFunctionSource('markPrivateConversationRead');
    expect(source).toContain('if (!request.auth?.uid)');
    expect(source).toContain('pmAssertConversationParticipant(request.data?.conversationId, uid)');
    expect(source).toContain('pmOtherParticipant(parsed, uid)');
    expect(source).toContain('const markReadInTransaction = async (tx) => {');
    expect(source).toContain('return pmRunPrivateMessageTransaction(');
    expect(source).toContain('"markPrivateConversationRead"');
    expect(source).toContain('const threadDoc = await tx.get(threadRef)');
    expect(source).toContain('const stateDoc = await tx.get(stateRef)');
    expect(source).toContain('.where("direction", "==", "in")');
    expect(source).toContain('.where("read", "==", false)');
    expect(source).toContain('.limit(PM_MESSAGE_LIMIT + 1)');
    expect(source).toContain('{ peerRead: true, peerReadAt: nowTs, updatedAt: nowTs }');
    expect(source).toContain('{ [`readBy.${uid}`]: nowTs, updatedAt: nowTs }');
    expect(source).toContain('unreadCount: remainingUnread');
    expect(source).toContain('unreadTotal: Math.max(0, currentMetaUnread - readCount)');
    expect(source).toContain('return { ok: true, readCount, hasMore, remainingUnread }');
    expect(source).not.toContain('FieldValue.increment(-unreadSnap.size)');
    const runnerSource = readSourceBetween(
      'async function pmRunPrivateMessageTransaction',
      'function pmMessageSortMs'
    );
    expect(runnerSource).toContain('return await db.runTransaction(callback)');
    expect(runnerSource).toContain('pmThrowSanitizedCallableError(functionName, conversationId, err)');
  });

  test('edit and recall share sender-only guard, read guard, and audit trail', () => {
    const helperSource = readSourceBetween(
      'async function pmUpdateOwnMessage',
      'exports.editPrivateMessage'
    );
    expect(helperSource).toContain('pmAssertConversationParticipant(request.data?.conversationId, uid)');
    expect(helperSource).toContain('if (oldData.fromUid !== uid)');
    expect(helperSource).toContain('if (oldData.status === "recalled")');
    expect(helperSource).toContain('if (peerHasRead)');
    expect(helperSource).toContain('editHistory');
    expect(helperSource).toContain('const ownThreadSnap = await tx.get(ownThreadRef)');
    expect(helperSource).toContain('const peerThreadSnap = await tx.get(peerThreadRef)');
    expect(helperSource).toContain('ownThreadSnap.data()?.lastMessageId === messageId');
    expect(helperSource).toContain('peerThreadSnap.data()?.lastMessageId === messageId');
    expect(helperSource).toContain('return pmRunPrivateMessageTransaction(');
    expect(helperSource).toContain('action: mode');
    expect(readCloudFunctionSource('editPrivateMessage')).toContain('pmUpdateOwnMessage(request, "edit")');
    expect(readCloudFunctionSource('recallPrivateMessage')).toContain('pmUpdateOwnMessage(request, "recall")');
  });

  test('updatePrivateMessageSettings is super-admin gated and audited', () => {
    const source = readCloudFunctionSource('updatePrivateMessageSettings');
    expect(source).toContain('const caller = await pmAssertSuperAdmin(request)');
    expect(source).toContain('db.collection("siteConfig").doc(PM_SETTINGS_DOC_ID).set');
    expect(source).toContain('allowUserToUserPm');
    expect(source).toContain('pmWriteAuditLog("settings_update"');
  });
});

describe('private message callable transaction behavior', () => {
  const markReadRequest = () => ({
    auth: { uid: PM_TEST_UID_A },
    data: { conversationId: PM_TEST_CONVERSATION_ID },
  });

  test.each([
    { count: 0, readCount: 0, hasMore: false, remainingUnread: 0, writes: 0 },
    { count: 1, readCount: 1, hasMore: false, remainingUnread: 0, writes: 6 },
    { count: 49, readCount: 49, hasMore: false, remainingUnread: 0, writes: 150 },
    { count: 50, readCount: 50, hasMore: false, remainingUnread: 0, writes: 153 },
    { count: 51, readCount: 50, hasMore: true, remainingUnread: 1, writes: 153 },
    { count: 120, readCount: 50, hasMore: true, remainingUnread: 70, writes: 153 },
  ])(
    'marks the first 50 of $count unread messages atomically',
    async ({ count, readCount, hasMore, remainingUnread, writes }) => {
      const db = pmSeedUnreadScenario(createPmMemoryFirestore(), count);
      const callable = loadPrivateMessageCallables(db).markPrivateConversationRead;

      expect(callable.options).toMatchObject({
        region: 'asia-east1',
        timeoutSeconds: 20,
        memory: '256MiB',
      });
      const result = await callable.handler(markReadRequest());

      expect({ ...result }).toEqual({ ok: true, readCount, hasMore, remainingUnread });
      expect(db.get(pmTestThreadPath(PM_TEST_UID_A)).unreadCount).toBe(remainingUnread);
      expect(db.get(pmTestStatePath(PM_TEST_UID_A)).unreadTotal).toBe(remainingUnread);
      expect(db.commits[db.commits.length - 1].writeCount).toBe(writes);
      expect(Math.max(...db.commits.map(commit => commit.writeCount))).toBeLessThanOrEqual(153);
      const queryRead = db.attempts[0].operations.find(operation => operation.type === 'read-query');
      expect(queryRead).toMatchObject({ limit: 51, size: Math.min(count, 51) });
      expectPmReadsBeforeWrites(db);

      if (readCount > 0) {
        for (let index = 1; index <= readCount; index += 1) {
          const messageId = pmTestMessageId(index);
          expect(db.get(pmTestMessagePath(PM_TEST_UID_A, messageId)).read).toBe(true);
          expect(db.get(pmTestMessagePath(PM_TEST_UID_B, messageId)).peerRead).toBe(true);
          expect(db.get(pmTestAuditMessagePath(messageId)).readBy[PM_TEST_UID_A]).toBeTruthy();
        }
        expect(db.directCollection('pmAuditLogs')).toHaveLength(1);
      } else {
        expect(db.directCollection('pmAuditLogs')).toHaveLength(0);
      }

      if (count > readCount) {
        expect(db.get(pmTestMessagePath(PM_TEST_UID_A, pmTestMessageId(readCount + 1))).read).toBe(false);
      }
    }
  );

  test('drains 120 unread messages in 50/50/20 transactions without exceeding 153 writes', async () => {
    const db = pmSeedUnreadScenario(createPmMemoryFirestore(), 120);
    const handler = loadPrivateMessageCallables(db).markPrivateConversationRead.handler;

    const results = [];
    results.push(await handler(markReadRequest()));
    results.push(await handler(markReadRequest()));
    results.push(await handler(markReadRequest()));

    expect(results.map(result => ({
      readCount: result.readCount,
      hasMore: result.hasMore,
      remainingUnread: result.remainingUnread,
    }))).toEqual([
      { readCount: 50, hasMore: true, remainingUnread: 70 },
      { readCount: 50, hasMore: true, remainingUnread: 20 },
      { readCount: 20, hasMore: false, remainingUnread: 0 },
    ]);
    expect(db.get(pmTestThreadPath(PM_TEST_UID_A)).unreadCount).toBe(0);
    expect(db.get(pmTestStatePath(PM_TEST_UID_A)).unreadTotal).toBe(0);
    expect(Math.max(...db.commits.map(commit => commit.writeCount))).toBe(153);
    expect(db.directCollection('pmAuditLogs')).toHaveLength(3);
  });

  test('missing own thread performs all reads but does not mutate orphan messages or meta', async () => {
    const db = pmSeedUnreadScenario(createPmMemoryFirestore(), 3, { includeThread: false });
    const handler = loadPrivateMessageCallables(db).markPrivateConversationRead.handler;

    const result = await handler(markReadRequest());

    expect({ ...result }).toEqual({ ok: true, readCount: 0, hasMore: false, remainingUnread: 0 });
    expect(db.commits[0].writeCount).toBe(0);
    expect(db.get(pmTestStatePath(PM_TEST_UID_A)).unreadTotal).toBe(3);
    expect(db.get(pmTestMessagePath(PM_TEST_UID_A, pmTestMessageId(1))).read).toBe(false);
    expect(db.attempts[0].operations.map(operation => operation.type)).toEqual([
      'read-doc',
      'read-doc',
      'read-query',
    ]);
  });

  test('skips a malformed participant copy and never trusts its messageId for mirror paths', async () => {
    const db = pmSeedUnreadScenario(createPmMemoryFirestore(), 2);
    const malformedPath = pmTestMessagePath(PM_TEST_UID_A, pmTestMessageId(1));
    db.seed(malformedPath, {
      ...db.get(malformedPath),
      messageId: '../unsafe',
      toUid: PM_TEST_UID_B,
    });
    const handler = loadPrivateMessageCallables(db).markPrivateConversationRead.handler;

    const result = await handler(markReadRequest());

    expect(result.readCount).toBe(1);
    expect(result.remainingUnread).toBe(1);
    expect(db.get(malformedPath).read).toBe(false);
    expect(db.get(pmTestMessagePath(PM_TEST_UID_B, pmTestMessageId(1))).peerRead).toBe(false);
    expect(db.get(pmTestMessagePath(PM_TEST_UID_A, pmTestMessageId(2))).read).toBe(true);
  });

  test('retries against a concurrent incoming send and preserves the newly incremented counters', async () => {
    const db = pmSeedUnreadScenario(createPmMemoryFirestore(), 1);
    db.interleaveBeforeCommitOnce(memoryDb => pmApplyConcurrentIncomingSend(memoryDb, 2));
    const handler = loadPrivateMessageCallables(db).markPrivateConversationRead.handler;

    const result = await handler(markReadRequest());

    expect({ ...result }).toEqual({ ok: true, readCount: 2, hasMore: false, remainingUnread: 0 });
    expect(db.attempts).toHaveLength(2);
    expect(db.commits).toHaveLength(1);
    expect(db.commits[0].attempt).toBe(2);
    expect(db.get(pmTestThreadPath(PM_TEST_UID_A)).unreadCount).toBe(0);
    expect(db.get(pmTestStatePath(PM_TEST_UID_A)).unreadTotal).toBe(0);
    expect(db.get(pmTestMessagePath(PM_TEST_UID_A, pmTestMessageId(2))).read).toBe(true);
    expectPmReadsBeforeWrites(db);
  });

  test('serializes concurrent double-mark transactions without double-decrementing counters', async () => {
    const db = pmSeedUnreadScenario(createPmMemoryFirestore(), 3);
    db.holdNextTransactions(2);
    const handler = loadPrivateMessageCallables(db).markPrivateConversationRead.handler;

    const results = await Promise.all([
      handler(markReadRequest()),
      handler(markReadRequest()),
    ]);

    expect(results.map(result => result.readCount).sort((left, right) => left - right)).toEqual([0, 3]);
    expect(db.attempts).toHaveLength(3);
    expect(db.commits).toHaveLength(2);
    expect(db.get(pmTestThreadPath(PM_TEST_UID_A)).unreadCount).toBe(0);
    expect(db.get(pmTestStatePath(PM_TEST_UID_A)).unreadTotal).toBe(0);
    expect(db.directCollection('pmAuditLogs')).toHaveLength(1);
    expectPmReadsBeforeWrites(db);
  });

  test('commit failure leaves every mirror unchanged and emits only de-identified structured context', async () => {
    const db = pmSeedUnreadScenario(createPmMemoryFirestore(), 1);
    const failure = new Error(`backend failure ${PM_TEST_UID_A} secret body`);
    failure.code = 'internal';
    db.failNextCommit(failure);
    const consoleImpl = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
    const handler = loadPrivateMessageCallables(db, consoleImpl).markPrivateConversationRead.handler;

    await expect(handler(markReadRequest())).rejects.toMatchObject({ code: 'unavailable' });

    expect(db.commits).toHaveLength(0);
    expect(db.get(pmTestThreadPath(PM_TEST_UID_A)).unreadCount).toBe(1);
    expect(db.get(pmTestStatePath(PM_TEST_UID_A)).unreadTotal).toBe(1);
    expect(db.get(pmTestMessagePath(PM_TEST_UID_A, pmTestMessageId(1))).read).toBe(false);
    expect(db.get(pmTestMessagePath(PM_TEST_UID_B, pmTestMessageId(1))).peerRead).toBe(false);
    expect(db.get(pmTestAuditMessagePath(pmTestMessageId(1))).readBy[PM_TEST_UID_A]).toBeUndefined();
    expect(db.directCollection('pmAuditLogs')).toHaveLength(0);
    expect(consoleImpl.error).toHaveBeenCalledTimes(1);
    const logged = consoleImpl.error.mock.calls[0][0];
    expect(logged).toMatchObject({
      event: 'private_message_callable_error',
      functionName: 'markPrivateConversationRead',
      errorCode: 'internal',
    });
    expect(logged.conversationKey).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(logged)).not.toContain(PM_TEST_UID_A);
    expect(JSON.stringify(logged)).not.toContain(PM_TEST_CONVERSATION_ID);
    expect(JSON.stringify(logged)).not.toContain('secret body');
  });
});

describe('private message edit and recall transaction behavior', () => {
  function updateRequest(messageId, body = 'updated body') {
    return {
      auth: { uid: PM_TEST_UID_A },
      data: {
        conversationId: PM_TEST_CONVERSATION_ID,
        messageId,
        body,
      },
    };
  }

  test('edits all message mirrors and both previews when the target is latest on each side', async () => {
    const db = createPmMemoryFirestore();
    const messageId = pmSeedEditableScenario(db);
    const callable = loadPrivateMessageCallables(db).editPrivateMessage;

    expect(callable.options).toMatchObject({
      region: 'asia-east1',
      timeoutSeconds: 20,
      memory: '256MiB',
    });
    const result = await callable.handler(updateRequest(messageId));

    expect(result.status).toBe('edited');
    expect(db.get(pmTestMessagePath(PM_TEST_UID_A, messageId))).toMatchObject({
      body: 'updated body',
      preview: 'updated body',
      status: 'edited',
      editVersion: 1,
    });
    expect(db.get(pmTestMessagePath(PM_TEST_UID_B, messageId)).body).toBe('updated body');
    expect(db.get(pmTestAuditMessagePath(messageId)).editHistory).toHaveLength(1);
    expect(db.get(pmTestThreadPath(PM_TEST_UID_A))).toMatchObject({
      lastMessageBody: 'updated body',
      lastMessageStatus: 'edited',
    });
    expect(db.get(pmTestThreadPath(PM_TEST_UID_B))).toMatchObject({
      lastMessageBody: 'updated body',
      lastMessageStatus: 'edited',
    });
    expect(db.commits[0].writeCount).toBe(7);
    expect(db.attempts[0].operations.slice(0, 5).map(operation => operation.type)).toEqual([
      'read-doc',
      'read-doc',
      'read-doc',
      'read-doc',
      'read-doc',
    ]);
    expectPmReadsBeforeWrites(db);
  });

  test('editing an older message leaves both newer thread previews unchanged', async () => {
    const db = createPmMemoryFirestore();
    const messageId = pmSeedEditableScenario(db, {
      ownLastMessageId: 'pmmsg_newer_own',
      peerLastMessageId: 'pmmsg_newer_peer',
      ownPreview: 'newer own preview',
      peerPreview: 'newer peer preview',
    });
    const handler = loadPrivateMessageCallables(db).editPrivateMessage.handler;

    await handler(updateRequest(messageId));

    expect(db.get(pmTestMessagePath(PM_TEST_UID_A, messageId)).body).toBe('updated body');
    expect(db.get(pmTestThreadPath(PM_TEST_UID_A)).lastMessageBody).toBe('newer own preview');
    expect(db.get(pmTestThreadPath(PM_TEST_UID_B)).lastMessageBody).toBe('newer peer preview');
    expect(db.commits[0].writeCount).toBe(5);
  });

  test('preview updates are independent when thread state has drifted or one side is missing', async () => {
    const driftDb = createPmMemoryFirestore();
    const driftMessageId = pmSeedEditableScenario(driftDb, {
      peerLastMessageId: 'pmmsg_newer_peer',
      peerPreview: 'peer still newer',
    });
    const driftHandler = loadPrivateMessageCallables(driftDb).editPrivateMessage.handler;

    await driftHandler(updateRequest(driftMessageId, 'drift edit'));

    expect(driftDb.get(pmTestThreadPath(PM_TEST_UID_A)).lastMessageBody).toBe('drift edit');
    expect(driftDb.get(pmTestThreadPath(PM_TEST_UID_B)).lastMessageBody).toBe('peer still newer');
    expect(driftDb.commits[0].writeCount).toBe(6);

    const missingDb = createPmMemoryFirestore();
    const missingMessageId = pmSeedEditableScenario(missingDb, { includeOwnThread: false });
    const missingHandler = loadPrivateMessageCallables(missingDb).editPrivateMessage.handler;

    await missingHandler(updateRequest(missingMessageId, 'missing edit'));

    expect(missingDb.has(pmTestThreadPath(PM_TEST_UID_A))).toBe(false);
    expect(missingDb.get(pmTestThreadPath(PM_TEST_UID_B)).lastMessageBody).toBe('missing edit');
  });

  test('recall uses the same latest-only transaction and updates message/audit status', async () => {
    const db = createPmMemoryFirestore();
    const messageId = pmSeedEditableScenario(db);
    const handler = loadPrivateMessageCallables(db).recallPrivateMessage.handler;

    const result = await handler(updateRequest(messageId, 'ignored'));

    expect(result.status).toBe('recalled');
    expect(db.get(pmTestMessagePath(PM_TEST_UID_A, messageId))).toMatchObject({
      body: '',
      status: 'recalled',
      recalledByUid: PM_TEST_UID_A,
    });
    expect(db.get(pmTestMessagePath(PM_TEST_UID_B, messageId)).status).toBe('recalled');
    expect(db.get(pmTestAuditMessagePath(messageId)).editHistory[0].action).toBe('recall');
    expect(db.get(pmTestThreadPath(PM_TEST_UID_A)).lastMessageStatus).toBe('recalled');
    expectPmReadsBeforeWrites(db);
  });

  test('recalling an older message keeps both newer previews while updating every message mirror', async () => {
    const db = createPmMemoryFirestore();
    const messageId = pmSeedEditableScenario(db, {
      ownLastMessageId: 'pmmsg_newer_own',
      peerLastMessageId: 'pmmsg_newer_peer',
      ownPreview: 'newer own preview',
      peerPreview: 'newer peer preview',
    });
    const handler = loadPrivateMessageCallables(db).recallPrivateMessage.handler;

    await handler(updateRequest(messageId));

    expect(db.get(pmTestMessagePath(PM_TEST_UID_A, messageId)).status).toBe('recalled');
    expect(db.get(pmTestMessagePath(PM_TEST_UID_B, messageId)).status).toBe('recalled');
    expect(db.get(pmTestAuditMessagePath(messageId)).editHistory[0].action).toBe('recall');
    expect(db.get(pmTestThreadPath(PM_TEST_UID_A))).toMatchObject({
      lastMessageBody: 'newer own preview',
      lastMessageStatus: 'active',
    });
    expect(db.get(pmTestThreadPath(PM_TEST_UID_B))).toMatchObject({
      lastMessageBody: 'newer peer preview',
      lastMessageStatus: 'active',
    });
    expect(db.commits[0].writeCount).toBe(5);
    expectPmReadsBeforeWrites(db);
  });

  test('recall updates only the matching thread preview when lastMessageId has drifted', async () => {
    const db = createPmMemoryFirestore();
    const messageId = pmSeedEditableScenario(db, {
      peerLastMessageId: 'pmmsg_newer_peer',
      peerPreview: 'peer newer preview',
    });
    const handler = loadPrivateMessageCallables(db).recallPrivateMessage.handler;

    await handler(updateRequest(messageId));

    expect(db.get(pmTestMessagePath(PM_TEST_UID_A, messageId)).status).toBe('recalled');
    expect(db.get(pmTestMessagePath(PM_TEST_UID_B, messageId)).status).toBe('recalled');
    expect(db.get(pmTestAuditMessagePath(messageId)).editHistory[0].action).toBe('recall');
    expect(db.get(pmTestThreadPath(PM_TEST_UID_A)).lastMessageStatus).toBe('recalled');
    expect(db.get(pmTestThreadPath(PM_TEST_UID_B))).toMatchObject({
      lastMessageBody: 'peer newer preview',
      lastMessageStatus: 'active',
    });
    expect(db.commits[0].writeCount).toBe(6);
    expectPmReadsBeforeWrites(db);
  });

  test('preserves domain HttpsError objects without logging or mutating when the peer already read', async () => {
    const db = createPmMemoryFirestore();
    const messageId = pmSeedEditableScenario(db, { peerRead: true });
    const consoleImpl = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
    const handler = loadPrivateMessageCallables(db, consoleImpl).editPrivateMessage.handler;

    await expect(handler(updateRequest(messageId))).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'message already read',
    });

    expect(db.get(pmTestMessagePath(PM_TEST_UID_A, messageId)).body).toBe('original body');
    expect(db.commits).toHaveLength(0);
    expect(consoleImpl.error).not.toHaveBeenCalled();
  });

  test('edit commit failure is atomic and logs only the hashed conversation context', async () => {
    const db = createPmMemoryFirestore();
    const messageId = pmSeedEditableScenario(db);
    const failure = new Error(`edit failure ${PM_TEST_CONVERSATION_ID}`);
    failure.code = 'deadline-exceeded';
    db.failNextCommit(failure);
    const consoleImpl = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
    const handler = loadPrivateMessageCallables(db, consoleImpl).editPrivateMessage.handler;

    await expect(handler(updateRequest(messageId))).rejects.toMatchObject({ code: 'unavailable' });

    expect(db.get(pmTestMessagePath(PM_TEST_UID_A, messageId)).body).toBe('original body');
    expect(db.get(pmTestThreadPath(PM_TEST_UID_A)).lastMessageBody).toBe('own latest preview');
    expect(db.commits).toHaveLength(0);
    const logged = consoleImpl.error.mock.calls[0][0];
    expect(logged).toMatchObject({
      event: 'private_message_callable_error',
      functionName: 'editPrivateMessage',
      errorCode: 'deadline-exceeded',
    });
    expect(JSON.stringify(logged)).not.toContain(PM_TEST_CONVERSATION_ID);
  });
});

describe('SportsAPI Pro callable fast layer', () => {
  test('exports callables with asia-east1, 256MiB memory, and secret binding', () => {
    const { exported } = makeScoreboardExports({
      access: { isSuperAdmin: true, hasPermission: () => true },
    });
    expect(exported.refreshSportsApiProScoreboard.options).toMatchObject({
      region: 'asia-east1',
      timeoutSeconds: 180,
      memory: '256MiB',
    });
    expect(exported.fetchSportsApiProMatchDetail.options).toMatchObject({
      region: 'asia-east1',
      timeoutSeconds: 90,
      memory: '256MiB',
    });
    expect(exported.refreshSportsApiProScoreboard.options.secrets[0].name).toBe('SPORTSAPI_PRO_API_KEY');
    expect(exported.fetchSportsApiProMatchDetail.options.secrets[0].name).toBe('SPORTSAPI_PRO_API_KEY');
    expect(exported.upsertScoreboardTranslations.options).toMatchObject({
      region: 'asia-east1',
      timeoutSeconds: 90,
      memory: '256MiB',
    });
  });

  test('manual refresh rejects unauthenticated callers before Firestore or provider access', async () => {
    const { db, exported } = makeScoreboardExports();
    await expect(exported.refreshSportsApiProScoreboard.handler({ auth: null, data: {} }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
    expect(db.collection).not.toHaveBeenCalled();
  });

  test('manual refresh rejects callers without scoreboard permission before provider access', async () => {
    const { db, exported } = makeScoreboardExports({
      access: { isSuperAdmin: false, hasPermission: () => false },
    });
    await expect(exported.refreshSportsApiProScoreboard.handler({ auth: { uid: 'U123' }, data: {} }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(db.collection).not.toHaveBeenCalled();
  });

  test('manual refresh cooldown stops before collecting scoreboard data', async () => {
    const { db, exported } = makeScoreboardExports({
      access: { isSuperAdmin: true, hasPermission: () => true },
      usageData: { manualRefreshAt: { toMillis: () => Date.now() } },
    });
    await expect(exported.refreshSportsApiProScoreboard.handler({ auth: { uid: 'U123' }, data: {} }))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(db.collection).toHaveBeenCalledWith('sportsApiProUsage');
  });

  test('match detail rejects invalid sport before Firestore or provider access', async () => {
    const { db, exported } = makeScoreboardExports();
    await expect(exported.fetchSportsApiProMatchDetail.handler({
      auth: { uid: 'U123' },
      data: { sport: 'unknown', matchId: 'm1' },
    })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(db.collection).not.toHaveBeenCalled();
  });

  test('translation upsert requires scoreboard translation or configure permission', async () => {
    const { db, exported } = makeScoreboardExports({
      access: { isSuperAdmin: false, hasPermission: () => false },
    });
    await expect(exported.upsertScoreboardTranslations.handler({
      auth: { uid: 'U123' },
      data: { items: [] },
    })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(db.collection).not.toHaveBeenCalled();
  });

  test('fetchJson uses injected fetch implementation and x-api-key header', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      headers: { forEach: (cb) => cb('89', 'x-ratelimit-remaining') },
      json: async () => ({ data: [{ id: 1 }] }),
    }));

    const result = await sportsApiProTest.fetchJson({
      apiKey: 'KEY_FOR_TEST',
      baseUrl: 'https://v2.football.sportsapipro.com',
      path: '/api/live',
      sport: 'football',
      kind: 'live',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://v2.football.sportsapipro.com/api/live');
    expect(fetchImpl.mock.calls[0][1].headers['x-api-key']).toBe('KEY_FOR_TEST');
    expect(result.payload).toEqual({ data: [{ id: 1 }] });
    expect(result.headers['x-ratelimit-remaining']).toBe('89');
  });
});

describe('adjustTeamReservation CF member stamping', () => {
  test('includes club staff UIDs even when users.teamIds is empty', () => {
    const memberSet = cfBuildTeamReservationMemberUidSet(
      {
        captainUid: 'captain_uid',
        leaderUid: 'leader_uid',
        leaderUids: ['leader2_uid'],
        coachUids: ['coach_uid'],
      },
      [
        {
          id: 'member_doc',
          data: {
            uid: 'member_uid',
            lineUserId: 'member_line_uid',
          },
        },
      ],
    );

    expect(memberSet.has('member_uid')).toBe(true);
    expect(memberSet.has('coach_uid')).toBe(true);
    expect(memberSet.has('leader2_uid')).toBe(true);
  });

  test('stamps existing staff registration into the team reservation group', () => {
    const teamName = 'Team A';
    const teamId = 'teamA';
    const memberSet = cfBuildTeamReservationMemberUidSet(
      { id: teamId, name: teamName, coachUids: ['staff_uid'] },
      [],
    );
    const regs = [
      { _docId: 'r1', userId: 'staff_uid', userName: 'Staff', participantType: 'self', status: 'confirmed' },
      { _docId: 'r2', userId: 'other_uid', userName: 'Other', participantType: 'self', status: 'confirmed' },
    ];
    const stamped = regs
      .filter(reg => reg.participantType !== 'companion')
      .filter(reg => memberSet.has(String(reg.userId || '').trim()))
      .map(reg => ({
        ...reg,
        teamReservationTeamId: teamId,
        teamReservationTeamName: teamName,
        teamSeatSource: reg.status === 'waitlisted' ? 'waitlist' : (reg.teamSeatSource || 'reserved'),
      }));

    expect(stamped).toHaveLength(1);
    expect(stamped[0]).toMatchObject({
      userId: 'staff_uid',
      teamReservationTeamId: 'teamA',
      teamReservationTeamName: 'Team A',
      teamSeatSource: 'reserved',
    });
  });

  test('blocks reservation changes for course-linked events after publication', () => {
    const source = readCloudFunctionSource('adjustTeamReservation');

    expect(source).toContain('if (isCourseLinkedEventData(ed))');
    expect(source).not.toContain('if (isPrivateCourseLinkedEventData(ed))');
    expect(source).toContain('throw courseLinkedEventManagedByCourseError();');
  });

  test('uses shared waitlist promotion after reservation changes', () => {
    const source = readCloudFunctionSource('adjustTeamReservation');

    expect(source).toContain('promoteWaitlistForAvailableSeats(eventForRebuild, activeRegs)');
    expect(source).not.toContain('const candidate = sortWaitlistCandidates(activeRegs).find');
  });

  test('notifies and grants signup exp for reservation-driven promotions', () => {
    const source = readCloudFunctionSource('adjustTeamReservation');

    expect(source).toContain('writeInboxNotification({');
    expect(source).toContain('title: "候補遞補通知"');
    expect(source).toContain('adjustExpInternal({');
    expect(source).toContain('ruleKey: "register_activity"');
  });
});

const ADMIN_USER_EDIT_PROFILE_PERMISSION = 'admin.users.edit_profile';
const ADMIN_USER_CHANGE_ROLE_PERMISSION = 'admin.users.change_role';
const ADMIN_USER_RESTRICT_PERMISSION = 'admin.users.restrict';
const ADMIN_MANAGED_USER_PROFILE_FIELDS = ['region', 'gender', 'birthday', 'sports', 'phone', 'email'];
const SECONDARY_IDENTITY_AVATAR_MAX_URL_LENGTH = 2000;
const IDENTITY_SETTINGS_TOP_LEVEL_FIELDS = new Set(['profileActiveIdentityId', 'identities']);
const IDENTITY_SETTINGS_IDENTITIES_FIELDS = new Set(['secondary']);
const IDENTITY_SETTINGS_SECONDARY_FIELDS = new Set([
  'identityId',
  'enabled',
  'displayName',
  'displayRoleLabel',
  'isPrimary',
  'editable',
]);
const IDENTITY_ACTIVE_IDS = new Set(['main', 'secondary']);

/** Mirror of sanitizeAdminManagedProfileUpdates (index.js:318-341) */
function sanitizeAdminManagedProfileUpdates(rawUpdates) {
  if (!rawUpdates || typeof rawUpdates !== 'object' || Array.isArray(rawUpdates)) {
    return {};
  }
  const next = {};
  ADMIN_MANAGED_USER_PROFILE_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(rawUpdates, field)) return;
    const value = rawUpdates[field];
    if (value == null) {
      next[field] = null;
      return;
    }
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (field === 'birthday') {
      next[field] = trimmed ? trimmed.replace(/-/g, '/') : null;
      return;
    }
    if (field === 'email') {
      if (!trimmed) {
        next[field] = null;
        return;
      }
      if (trimmed.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        next[field] = trimmed;
      }
      return;
    }
    next[field] = trimmed;
  });
  return next;
}

/**
 * Mirror of adminManageUser auth + permission flow (index.js:1106-1204).
 * Returns null on success, or { error, msg } on rejection.
 */
function validateAdminManageUser({ auth, data, access, callerUid, targetUserExists, targetRole }) {
  if (!auth) return { error: 'unauthenticated', msg: 'Authentication required' };
  const targetUid = data?.targetUid;
  if (!targetUid || typeof targetUid !== 'string') {
    return { error: 'invalid-argument', msg: 'targetUid is required' };
  }
  if (!targetUserExists) return { error: 'not-found', msg: 'Target user not found' };

  const isTargetSuperAdmin = targetRole === 'super_admin';
  if (!access.isSuperAdmin && isTargetSuperAdmin) {
    return { error: 'permission-denied', msg: 'Cannot manage super admin' };
  }

  const sanitized = sanitizeAdminManagedProfileUpdates(data?.profileUpdates);
  const hasProfile = Object.keys(sanitized).length > 0;
  if (hasProfile && !access.permissions.includes(ADMIN_USER_EDIT_PROFILE_PERMISSION)) {
    return { error: 'permission-denied', msg: 'Missing profile edit permission' };
  }

  if (data?.restrictionUpdate != null) {
    if (!access.permissions.includes(ADMIN_USER_RESTRICT_PERMISSION)) {
      return { error: 'permission-denied', msg: 'Missing restriction permission' };
    }
    if (targetUid === callerUid) {
      return { error: 'failed-precondition', msg: 'Cannot restrict yourself' };
    }
  }

  if (data?.roleChange && typeof data.roleChange === 'object') {
    if (!access.permissions.includes(ADMIN_USER_CHANGE_ROLE_PERMISSION)) {
      return { error: 'permission-denied', msg: 'Missing role-change permission' };
    }
    const callerLevel = ROLE_LEVELS[access.role] ?? 0;
    if (callerLevel < ROLE_LEVELS.admin) {
      return { error: 'permission-denied', msg: 'Only admin or above can change roles' };
    }
    const nextRole = data.roleChange.role;
    if (!VALID_ROLES.has(nextRole)) {
      return { error: 'invalid-argument', msg: 'Target role does not exist' };
    }
    if (!access.isSuperAdmin && (ROLE_LEVELS[nextRole] ?? 0) >= ROLE_LEVELS.admin) {
      return { error: 'permission-denied', msg: 'Only super_admin can assign admin-level roles' };
    }
    const targetLevel = ROLE_LEVELS[targetRole] ?? 0;
    if (!access.isSuperAdmin && targetLevel >= callerLevel) {
      return { error: 'permission-denied', msg: 'Cannot modify user with equal or higher role' };
    }
  }

  const hasRestriction = data?.restrictionUpdate != null;
  const hasRoleChange = !!(data?.roleChange && typeof data.roleChange === 'object');
  if (!hasProfile && !hasRestriction && !hasRoleChange) {
    return { error: 'invalid-argument', msg: 'No supported updates requested' };
  }
  return null;
}

/** Mirror of restriction value normalization (index.js:1160-1162) */
function normalizeRestrictionValue(restrictionUpdate) {
  return restrictionUpdate === true
    || restrictionUpdate?.restricted === true
    || restrictionUpdate?.isRestricted === true;
}

function normalizeCallableString(value, maxLength) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return '';
  return trimmed;
}

function isPlainRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyAllowedKeys(value, allowedKeys) {
  if (!isPlainRecord(value)) return true;
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function normalizeStorageBucketName(value) {
  const bucket = normalizeCallableString(value, 180)
    .replace(/^gs:\/\//i, '')
    .replace(/\/+$/g, '');
  if (!bucket || bucket.includes('/')) return '';
  return bucket;
}

function validateIdentitySettingsCommit(data) {
  const payload = isPlainRecord(data) ? data : {};
  if (!hasOnlyAllowedKeys(payload, IDENTITY_SETTINGS_TOP_LEVEL_FIELDS)) {
    return { error: 'invalid-argument', field: 'payload' };
  }
  const activeId = normalizeCallableString(payload.profileActiveIdentityId, 24);
  if (!IDENTITY_ACTIVE_IDS.has(activeId)) {
    return { error: 'invalid-argument', field: 'profileActiveIdentityId' };
  }
  const identities = isPlainRecord(payload.identities) ? payload.identities : {};
  if (!hasOnlyAllowedKeys(identities, IDENTITY_SETTINGS_IDENTITIES_FIELDS)) {
    return { error: 'invalid-argument', field: 'identities' };
  }
  const secondary = isPlainRecord(identities.secondary) ? identities.secondary : {};
  if (!hasOnlyAllowedKeys(secondary, IDENTITY_SETTINGS_SECONDARY_FIELDS)) {
    return { error: 'invalid-argument', field: 'secondary' };
  }
  const enabled = secondary.enabled === true;
  const displayName = normalizeCallableString(secondary.displayName, 40);
  if (enabled && !displayName) {
    return { error: 'invalid-argument', field: 'displayName' };
  }
  if (activeId === 'secondary' && !enabled) {
    return { error: 'failed-precondition', field: 'enabled' };
  }
  return null;
}

function isSecondaryIdentityAvatarStoragePathForUid(pathValue, uid) {
  const safePath = normalizeCallableString(pathValue, 512);
  const safeUid = normalizeCallableString(uid, 128);
  if (!safePath || !safeUid) return false;
  const expectedPrefix = `images/users/${safeUid}/identities/secondary/`;
  const fileName = safePath.startsWith(expectedPrefix)
    ? safePath.slice(expectedPrefix.length)
    : '';
  return !!fileName && !fileName.includes('/');
}

function isFirebaseStorageDownloadUrl(urlValue) {
  const url = normalizeCallableString(urlValue, SECONDARY_IDENTITY_AVATAR_MAX_URL_LENGTH);
  return /^https:\/\/firebasestorage\.googleapis\.com\//i.test(url)
    || /^https:\/\/storage\.googleapis\.com\//i.test(url);
}

function firebaseStorageUrlMatchesObject(urlValue, bucketValue, pathValue) {
  const url = normalizeCallableString(urlValue, SECONDARY_IDENTITY_AVATAR_MAX_URL_LENGTH);
  const expectedBucket = normalizeStorageBucketName(bucketValue);
  const expectedPath = normalizeCallableString(pathValue, 512);
  if (!url || !expectedBucket || !expectedPath) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'firebasestorage.googleapis.com') {
      const parts = parsed.pathname.split('/');
      const bucketIndex = parts.indexOf('b');
      const objectIndex = parts.indexOf('o');
      if (bucketIndex < 0 || objectIndex < 0 || objectIndex <= bucketIndex) return false;
      const bucket = decodeURIComponent(parts[bucketIndex + 1] || '');
      const objectPath = decodeURIComponent(parts.slice(objectIndex + 1).join('/'));
      return bucket === expectedBucket && objectPath === expectedPath;
    }
    if (parsed.hostname === 'storage.googleapis.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const bucket = decodeURIComponent(parts[0] || '');
      const objectPath = decodeURIComponent(parts.slice(1).join('/'));
      return bucket === expectedBucket && objectPath === expectedPath;
    }
  } catch (_) {}
  return false;
}

function validateSecondaryIdentityAvatarCommit(data, uid, projectId = 'demo-project') {
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  if (payload.clear === true) return null;
  const avatarUrl = normalizeCallableString(payload.avatarUrl, SECONDARY_IDENTITY_AVATAR_MAX_URL_LENGTH);
  const avatarStoragePath = normalizeCallableString(payload.avatarStoragePath, 512);
  const avatarStorageBucket = normalizeStorageBucketName(payload.avatarStorageBucket);
  if (!avatarUrl || !isFirebaseStorageDownloadUrl(avatarUrl)) return { error: 'invalid-argument', field: 'avatarUrl' };
  if (!isSecondaryIdentityAvatarStoragePathForUid(avatarStoragePath, uid)) return { error: 'permission-denied', field: 'avatarStoragePath' };
  if (!avatarStorageBucket) return { error: 'invalid-argument', field: 'avatarStorageBucket' };
  if (
    projectId
    && avatarStorageBucket !== `${projectId}.appspot.com`
    && avatarStorageBucket !== `${projectId}.firebasestorage.app`
    && avatarStorageBucket !== `${projectId}-asia-east1`
  ) {
    return { error: 'invalid-argument', field: 'avatarStorageBucket' };
  }
  if (!firebaseStorageUrlMatchesObject(avatarUrl, avatarStorageBucket, avatarStoragePath)) {
    return { error: 'invalid-argument', field: 'avatarUrlObjectMismatch' };
  }
  return null;
}

describe('commitIdentitySettings validation', () => {
  test('second identity callable access follows effective permission including user grants', () => {
    expect(canUseSecondaryIdentityAccess({
      role: 'user',
      hasPermission: (code) => code === SECONDARY_IDENTITY_PERMISSION,
    })).toBe(true);
    expect(canUseSecondaryIdentityAccess({
      role: 'user',
      hasPermission: () => false,
    })).toBe(false);
    expect(canUseSecondaryIdentityAccess({
      role: 'admin',
      hasPermission: (code) => code === SECONDARY_IDENTITY_PERMISSION,
    })).toBe(true);
    expect(canUseSecondaryIdentityAccess({
      role: 'admin',
      hasPermission: () => false,
    })).toBe(false);
    expect(canUseSecondaryIdentityAccess({
      role: 'super_admin',
      hasPermission: () => true,
    })).toBe(true);
  });

  test('accepts main and enabled secondary identity settings payloads', () => {
    expect(validateIdentitySettingsCommit({
      profileActiveIdentityId: 'main',
      identities: {
        secondary: {
          identityId: 'secondary',
          enabled: false,
          displayName: 'Alias',
          displayRoleLabel: 'User',
          isPrimary: false,
          editable: true,
        },
      },
    })).toBeNull();

    expect(validateIdentitySettingsCommit({
      profileActiveIdentityId: 'secondary',
      identities: {
        secondary: {
          identityId: 'secondary',
          enabled: true,
          displayName: 'Alias',
          displayRoleLabel: 'User',
          isPrimary: false,
          editable: true,
        },
      },
    })).toBeNull();
  });

  test('rejects activating disabled secondary identity and unexpected fields', () => {
    expect(validateIdentitySettingsCommit({
      profileActiveIdentityId: 'secondary',
      identities: {
        secondary: {
          enabled: false,
          displayName: 'Alias',
        },
      },
    })).toMatchObject({ error: 'failed-precondition', field: 'enabled' });

    expect(validateIdentitySettingsCommit({
      profileActiveIdentityId: 'main',
      identities: {
        secondary: {
          enabled: false,
          avatarUrl: 'https://example.com/avatar.png',
        },
      },
    })).toMatchObject({ error: 'invalid-argument', field: 'secondary' });
  });
});

describe('commitSecondaryIdentityAvatar validation', () => {
  test('accepts own secondary identity avatar object in project bucket', () => {
    const result = validateSecondaryIdentityAvatarCommit({
      avatarUrl: 'https://firebasestorage.googleapis.com/v0/b/demo-project.firebasestorage.app/o/images%2Fusers%2FuidUser%2Fidentities%2Fsecondary%2Fa.png?alt=media',
      avatarStoragePath: 'images/users/uidUser/identities/secondary/a.png',
      avatarStorageBucket: 'demo-project.firebasestorage.app',
    }, 'uidUser', 'demo-project');
    expect(result).toBeNull();
  });

  test('accepts asia-east1 upload bucket and gs:// bucket input after normalization', () => {
    expect(validateSecondaryIdentityAvatarCommit({
      avatarUrl: 'https://firebasestorage.googleapis.com/v0/b/demo-project-asia-east1/o/images%2Fusers%2FuidUser%2Fidentities%2Fsecondary%2Fa.png?alt=media',
      avatarStoragePath: 'images/users/uidUser/identities/secondary/a.png',
      avatarStorageBucket: 'gs://demo-project-asia-east1',
    }, 'uidUser', 'demo-project')).toBeNull();

    expect(validateSecondaryIdentityAvatarCommit({
      avatarUrl: 'https://storage.googleapis.com/demo-project-asia-east1/images/users/uidUser/identities/secondary/a.png',
      avatarStoragePath: 'images/users/uidUser/identities/secondary/a.png',
      avatarStorageBucket: 'demo-project-asia-east1',
    }, 'uidUser', 'demo-project')).toBeNull();
  });

  test('rejects cross-user, nested, external-url, and cross-project commits', () => {
    expect(validateSecondaryIdentityAvatarCommit({
      avatarUrl: 'https://firebasestorage.googleapis.com/v0/b/demo-project.firebasestorage.app/o/a.png?alt=media',
      avatarStoragePath: 'images/users/uidOther/identities/secondary/a.png',
      avatarStorageBucket: 'demo-project.firebasestorage.app',
    }, 'uidUser', 'demo-project')).toMatchObject({ error: 'permission-denied' });

    expect(validateSecondaryIdentityAvatarCommit({
      avatarUrl: 'https://firebasestorage.googleapis.com/v0/b/demo-project.firebasestorage.app/o/a.png?alt=media',
      avatarStoragePath: 'images/users/uidUser/identities/secondary/nested/a.png',
      avatarStorageBucket: 'demo-project.firebasestorage.app',
    }, 'uidUser', 'demo-project')).toMatchObject({ error: 'permission-denied' });

    expect(validateSecondaryIdentityAvatarCommit({
      avatarUrl: 'https://evil.example/avatar.png',
      avatarStoragePath: 'images/users/uidUser/identities/secondary/a.png',
      avatarStorageBucket: 'demo-project.firebasestorage.app',
    }, 'uidUser', 'demo-project')).toMatchObject({ error: 'invalid-argument', field: 'avatarUrl' });

    expect(validateSecondaryIdentityAvatarCommit({
      avatarUrl: 'https://firebasestorage.googleapis.com/v0/b/other-project.firebasestorage.app/o/a.png?alt=media',
      avatarStoragePath: 'images/users/uidUser/identities/secondary/a.png',
      avatarStorageBucket: 'other-project.firebasestorage.app',
    }, 'uidUser', 'demo-project')).toMatchObject({ error: 'invalid-argument', field: 'avatarStorageBucket' });
  });

  test('rejects Firebase Storage URL that does not point to the submitted bucket/path', () => {
    expect(validateSecondaryIdentityAvatarCommit({
      avatarUrl: 'https://firebasestorage.googleapis.com/v0/b/demo-project.firebasestorage.app/o/images%2Fusers%2FuidOther%2Fidentities%2Fsecondary%2Fa.png?alt=media',
      avatarStoragePath: 'images/users/uidUser/identities/secondary/a.png',
      avatarStorageBucket: 'demo-project.firebasestorage.app',
    }, 'uidUser', 'demo-project')).toMatchObject({ error: 'invalid-argument', field: 'avatarUrlObjectMismatch' });

    expect(validateSecondaryIdentityAvatarCommit({
      avatarUrl: 'https://storage.googleapis.com/demo-project.firebasestorage.app/images/users/uidUser/identities/secondary/a.png',
      avatarStoragePath: 'images/users/uidUser/identities/secondary/a.png',
      avatarStorageBucket: 'demo-project.firebasestorage.app',
    }, 'uidUser', 'demo-project')).toBeNull();
  });

  test('clear request is accepted without URL or Storage metadata', () => {
    expect(validateSecondaryIdentityAvatarCommit({ clear: true }, 'uidUser')).toBeNull();
  });
});

describe('sanitizeAdminManagedProfileUpdates', () => {
  test('returns empty object for non-object input', () => {
    expect(sanitizeAdminManagedProfileUpdates(null)).toEqual({});
    expect(sanitizeAdminManagedProfileUpdates(undefined)).toEqual({});
    expect(sanitizeAdminManagedProfileUpdates('str')).toEqual({});
    expect(sanitizeAdminManagedProfileUpdates([])).toEqual({});
  });

  test('drops unknown fields', () => {
    const result = sanitizeAdminManagedProfileUpdates({
      region: '台北', name: 'malicious', isAdmin: true, role: 'super_admin',
    });
    expect(result).toEqual({ region: '台北' });
  });

  test('trims string values', () => {
    const result = sanitizeAdminManagedProfileUpdates({ region: '  台北  ', phone: ' 0912345678 ', email: ' admin@example.com ' });
    expect(result.region).toBe('台北');
    expect(result.phone).toBe('0912345678');
    expect(result.email).toBe('admin@example.com');
  });

  test('normalizes birthday format (- → /)', () => {
    expect(sanitizeAdminManagedProfileUpdates({ birthday: '1990-01-15' }).birthday).toBe('1990/01/15');
    expect(sanitizeAdminManagedProfileUpdates({ birthday: '1990/01/15' }).birthday).toBe('1990/01/15');
  });

  test('null value sets field to null (allows clearing)', () => {
    expect(sanitizeAdminManagedProfileUpdates({ region: null }).region).toBeNull();
  });

  test('non-string non-null value silently dropped', () => {
    const result = sanitizeAdminManagedProfileUpdates({ region: 123, gender: true, phone: {} });
    expect(result).toEqual({});
  });

  test('empty birthday string sets null', () => {
    expect(sanitizeAdminManagedProfileUpdates({ birthday: '   ' }).birthday).toBeNull();
  });

  test('empty email string clears email and invalid email is dropped', () => {
    expect(sanitizeAdminManagedProfileUpdates({ email: '   ' }).email).toBeNull();
    expect(sanitizeAdminManagedProfileUpdates({ email: 'not-an-email' })).toEqual({});
  });
});

describe('adminManageUser auth + permission flow', () => {
  const baseAccess = {
    role: 'admin',
    isSuperAdmin: false,
    permissions: [
      ADMIN_USER_EDIT_PROFILE_PERMISSION,
      ADMIN_USER_RESTRICT_PERMISSION,
      ADMIN_USER_CHANGE_ROLE_PERMISSION,
    ],
  };

  test('rejects unauthenticated request', () => {
    const result = validateAdminManageUser({
      auth: null, data: { targetUid: 'u1', profileUpdates: { region: 'X' } },
      access: baseAccess, callerUid: 'caller', targetUserExists: true, targetRole: 'user',
    });
    expect(result.error).toBe('unauthenticated');
  });

  test('rejects missing targetUid', () => {
    const result = validateAdminManageUser({
      auth: { uid: 'caller' }, data: { profileUpdates: { region: 'X' } },
      access: baseAccess, callerUid: 'caller', targetUserExists: true, targetRole: 'user',
    });
    expect(result.error).toBe('invalid-argument');
  });

  test('rejects when target user not found', () => {
    const result = validateAdminManageUser({
      auth: { uid: 'caller' }, data: { targetUid: 'ghost', profileUpdates: { region: 'X' } },
      access: baseAccess, callerUid: 'caller', targetUserExists: false, targetRole: null,
    });
    expect(result.error).toBe('not-found');
  });

  test('non-super_admin cannot manage super_admin target', () => {
    const result = validateAdminManageUser({
      auth: { uid: 'caller' }, data: { targetUid: 'sa1', profileUpdates: { region: 'X' } },
      access: baseAccess, callerUid: 'caller', targetUserExists: true, targetRole: 'super_admin',
    });
    expect(result.error).toBe('permission-denied');
    expect(result.msg).toMatch(/super admin/i);
  });

  test('super_admin can manage super_admin target', () => {
    const access = { ...baseAccess, role: 'super_admin', isSuperAdmin: true };
    const result = validateAdminManageUser({
      auth: { uid: 'sa-caller' }, data: { targetUid: 'sa1', profileUpdates: { region: 'X' } },
      access, callerUid: 'sa-caller', targetUserExists: true, targetRole: 'super_admin',
    });
    expect(result).toBeNull();
  });

  test('profile update without permission rejected', () => {
    const access = { ...baseAccess, permissions: [] };
    const result = validateAdminManageUser({
      auth: { uid: 'caller' }, data: { targetUid: 'u1', profileUpdates: { region: 'X' } },
      access, callerUid: 'caller', targetUserExists: true, targetRole: 'user',
    });
    expect(result.error).toBe('permission-denied');
    expect(result.msg).toMatch(/profile/i);
  });

  test('restriction update without permission rejected', () => {
    const access = { ...baseAccess, permissions: [] };
    const result = validateAdminManageUser({
      auth: { uid: 'caller' }, data: { targetUid: 'u1', restrictionUpdate: true },
      access, callerUid: 'caller', targetUserExists: true, targetRole: 'user',
    });
    expect(result.error).toBe('permission-denied');
    expect(result.msg).toMatch(/restriction/i);
  });

  test('cannot restrict yourself', () => {
    const result = validateAdminManageUser({
      auth: { uid: 'caller' }, data: { targetUid: 'caller', restrictionUpdate: true },
      access: baseAccess, callerUid: 'caller', targetUserExists: true, targetRole: 'user',
    });
    expect(result.error).toBe('failed-precondition');
  });

  test('role change without permission rejected', () => {
    const access = { ...baseAccess, permissions: [] };
    const result = validateAdminManageUser({
      auth: { uid: 'caller' }, data: { targetUid: 'u1', roleChange: { role: 'coach' } },
      access, callerUid: 'caller', targetUserExists: true, targetRole: 'user',
    });
    expect(result.error).toBe('permission-denied');
  });

  test('coach cannot change roles (callerLevel < admin)', () => {
    const access = { ...baseAccess, role: 'coach', permissions: [ADMIN_USER_CHANGE_ROLE_PERMISSION] };
    const result = validateAdminManageUser({
      auth: { uid: 'caller' }, data: { targetUid: 'u1', roleChange: { role: 'user' } },
      access, callerUid: 'caller', targetUserExists: true, targetRole: 'user',
    });
    expect(result.error).toBe('permission-denied');
    expect(result.msg).toMatch(/admin or above/i);
  });

  test('admin cannot assign admin-level role (only super_admin can)', () => {
    const result = validateAdminManageUser({
      auth: { uid: 'caller' }, data: { targetUid: 'u1', roleChange: { role: 'admin' } },
      access: baseAccess, callerUid: 'caller', targetUserExists: true, targetRole: 'user',
    });
    expect(result.error).toBe('permission-denied');
    expect(result.msg).toMatch(/super_admin/i);
  });

  test('admin cannot modify user with equal level (another admin)', () => {
    const result = validateAdminManageUser({
      auth: { uid: 'caller' }, data: { targetUid: 'u1', roleChange: { role: 'coach' } },
      access: baseAccess, callerUid: 'caller', targetUserExists: true, targetRole: 'admin',
    });
    expect(result.error).toBe('permission-denied');
    expect(result.msg).toMatch(/equal or higher/i);
  });

  test('super_admin can assign admin role', () => {
    const access = { ...baseAccess, role: 'super_admin', isSuperAdmin: true };
    const result = validateAdminManageUser({
      auth: { uid: 'sa' }, data: { targetUid: 'u1', roleChange: { role: 'admin' } },
      access, callerUid: 'sa', targetUserExists: true, targetRole: 'user',
    });
    expect(result).toBeNull();
  });

  test('admin can assign captain to user (lower level)', () => {
    const result = validateAdminManageUser({
      auth: { uid: 'caller' }, data: { targetUid: 'u1', roleChange: { role: 'captain' } },
      access: baseAccess, callerUid: 'caller', targetUserExists: true, targetRole: 'user',
    });
    expect(result).toBeNull();
  });

  test('rejects empty updates (no profile, no restriction, no role)', () => {
    const result = validateAdminManageUser({
      auth: { uid: 'caller' }, data: { targetUid: 'u1' },
      access: baseAccess, callerUid: 'caller', targetUserExists: true, targetRole: 'user',
    });
    expect(result.error).toBe('invalid-argument');
    expect(result.msg).toMatch(/no supported updates/i);
  });

  test('accepts profile update only', () => {
    const result = validateAdminManageUser({
      auth: { uid: 'caller' }, data: { targetUid: 'u1', profileUpdates: { region: '台北' } },
      access: baseAccess, callerUid: 'caller', targetUserExists: true, targetRole: 'user',
    });
    expect(result).toBeNull();
  });
});

describe('adminManageUser restriction value normalization', () => {
  test('boolean true → restricted', () => {
    expect(normalizeRestrictionValue(true)).toBe(true);
  });

  test('boolean false → not restricted', () => {
    expect(normalizeRestrictionValue(false)).toBe(false);
  });

  test('object { restricted: true } → restricted', () => {
    expect(normalizeRestrictionValue({ restricted: true })).toBe(true);
  });

  test('object { isRestricted: true } → restricted (legacy field name)', () => {
    expect(normalizeRestrictionValue({ isRestricted: true })).toBe(true);
  });

  test('object with neither key → not restricted', () => {
    expect(normalizeRestrictionValue({})).toBe(false);
    expect(normalizeRestrictionValue({ other: true })).toBe(false);
  });

  test('object with explicit false → not restricted', () => {
    expect(normalizeRestrictionValue({ restricted: false })).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
//  adjustExp — edge cases (index.js:1230-1390)
//  2026-04-27 補強：原本只測 4 個基本驗證，補上 mode/clamp/limit
// ═══════════════════════════════════════════════════════════════

const VALID_EXP_MODES = ['auto', 'manual', 'batch', 'team', 'teamExp'];

/** Mirror of adjustExp mode validation (index.js:1261-1264) */
function validateExpMode(mode) {
  if (!VALID_EXP_MODES.includes(mode)) return { error: 'invalid-argument', msg: `Invalid mode: ${mode}` };
  return null;
}

/** Mirror of adjustExp auto-mode amount limit (index.js:1267-1271) */
function validateAutoModeAmount(amount) {
  if (amount < -100 || amount > 100) {
    return { error: 'invalid-argument', msg: 'Auto mode amount must be between -100 and +100' };
  }
  return null;
}

/** Mirror of teamExp clamp (index.js:1299) */
function clampTeamExp(oldExp, amount) {
  return Math.min(10000, Math.max(0, oldExp + amount));
}

/** Mirror of batch/team target count limit (index.js:1333) */
function validateBatchTargets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return { error: 'invalid-argument', msg: 'targets array is required' };
  }
  if (targets.length > 50) return { error: 'invalid-argument', msg: 'Maximum 50 targets per batch' };
  return null;
}

/** Mirror of operator label sanitization (index.js:1281-1283) */
function safeOperatorLabel(operatorLabel) {
  return (typeof operatorLabel === 'string' && operatorLabel.trim())
    ? operatorLabel.trim().slice(0, 50)
    : '管理員';
}

/** Mirror of reason sanitization (index.js:1280) */
function safeReason(reason) {
  return reason.trim().slice(0, 200);
}

describe('adjustExp mode validation', () => {
  test('accepts all 5 valid modes', () => {
    VALID_EXP_MODES.forEach(mode => {
      expect(validateExpMode(mode)).toBeNull();
    });
  });

  test('rejects unknown mode', () => {
    expect(validateExpMode('hack').error).toBe('invalid-argument');
    expect(validateExpMode('').error).toBe('invalid-argument');
    expect(validateExpMode(null).error).toBe('invalid-argument');
    expect(validateExpMode(undefined).error).toBe('invalid-argument');
  });
});

describe('adjustExp auto-mode amount limit (±100)', () => {
  test('accepts boundary +100', () => {
    expect(validateAutoModeAmount(100)).toBeNull();
  });

  test('accepts boundary -100', () => {
    expect(validateAutoModeAmount(-100)).toBeNull();
  });

  test('rejects +101', () => {
    expect(validateAutoModeAmount(101).error).toBe('invalid-argument');
  });

  test('rejects -101', () => {
    expect(validateAutoModeAmount(-101).error).toBe('invalid-argument');
  });

  test('accepts middle values', () => {
    expect(validateAutoModeAmount(50)).toBeNull();
    expect(validateAutoModeAmount(-50)).toBeNull();
  });
});

describe('adjustExp teamExp clamp [0, 10000]', () => {
  test('clamp negative result to 0 (over-deduct)', () => {
    expect(clampTeamExp(50, -100)).toBe(0);
  });

  test('clamp over-cap result to 10000', () => {
    expect(clampTeamExp(9000, 5000)).toBe(10000);
  });

  test('normal addition', () => {
    expect(clampTeamExp(500, 200)).toBe(700);
  });

  test('normal deduction', () => {
    expect(clampTeamExp(500, -200)).toBe(300);
  });

  test('exactly 0 stays 0', () => {
    expect(clampTeamExp(0, 0)).toBe(0);
  });

  test('exactly 10000 stays 10000', () => {
    expect(clampTeamExp(10000, 0)).toBe(10000);
  });
});

describe('adjustExp batch/team target count limit', () => {
  test('rejects empty targets', () => {
    expect(validateBatchTargets([]).error).toBe('invalid-argument');
    expect(validateBatchTargets(null).error).toBe('invalid-argument');
    expect(validateBatchTargets(undefined).error).toBe('invalid-argument');
  });

  test('accepts boundary 50 targets', () => {
    const arr = Array(50).fill('uid');
    expect(validateBatchTargets(arr)).toBeNull();
  });

  test('rejects 51 targets', () => {
    const arr = Array(51).fill('uid');
    expect(validateBatchTargets(arr).error).toBe('invalid-argument');
  });

  test('accepts 1 target', () => {
    expect(validateBatchTargets(['uid'])).toBeNull();
  });
});

describe('adjustExp operator label + reason sanitization', () => {
  test('operator label trims whitespace', () => {
    expect(safeOperatorLabel('  Alice  ')).toBe('Alice');
  });

  test('operator label caps at 50 chars', () => {
    const longLabel = 'A'.repeat(100);
    expect(safeOperatorLabel(longLabel).length).toBe(50);
  });

  test('operator label defaults to 管理員 when empty/non-string', () => {
    expect(safeOperatorLabel('')).toBe('管理員');
    expect(safeOperatorLabel('   ')).toBe('管理員');
    expect(safeOperatorLabel(null)).toBe('管理員');
    expect(safeOperatorLabel(undefined)).toBe('管理員');
    expect(safeOperatorLabel(123)).toBe('管理員');
  });

  test('reason trims and caps at 200 chars', () => {
    expect(safeReason('  test  ')).toBe('test');
    const longReason = 'X'.repeat(500);
    expect(safeReason(longReason).length).toBe(200);
  });
});

describe('deleteTournament callable source', () => {
  test('uses v2 callable, permission guard, and root-last helper flow', () => {
    const source = readCloudFunctionSource('deleteTournament');
    expect(source).toContain('onCall(');
    expect(source).toContain('region: "asia-east1"');
    expect(source).toContain('timeoutSeconds: 60');
    expect(source).toContain('memory: "512MiB"');
    expect(source).toContain('getCallerAccessContext(request)');
    expect(source).toContain('assertCanDeleteTournament(callerAccess)');
    const guardSource = readSourceBetween('function assertCanDeleteTournament', 'async function listTournamentDeleteRefs');
    expect(guardSource).toContain('admin.tournaments.delete');
    expect(source).toContain('listTournamentDeleteRefs(tournamentRef)');
    expect(source).toContain('commitDeleteRefsInChunks(childRefs)');
    expect(source).toContain('rootBatch.delete(tournamentRef)');
    expect(source).toContain('alreadyDeleted: true');
  });

  test('scans applications, entries, and members before deleting root', () => {
    const source = readSourceBetween(
      'async function listTournamentDeleteRefs',
      'async function commitDeleteRefsInChunks'
    );
    expect(source).toContain('collection("applications")');
    expect(source).toContain('collection("entries")');
    expect(source).toContain('collection("members")');
    expect(source.indexOf('membersSnap.docs.forEach')).toBeLessThan(source.indexOf('childRefs.push(entryDoc.ref)'));
  });
});

describe('ApiService tournament delete source', () => {
  test('uses callable delete and no longer directly deletes tournament subcollections', () => {
    const apiSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'js', 'api-service.js'),
      'utf8'
    );
    const start = apiSource.indexOf('async deleteTournamentAwait');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = apiSource.indexOf('\n  },', start);
    const source = apiSource.slice(start, end);
    expect(source).toContain('FirebaseService.deleteTournamentAtomic');
    expect(source).not.toContain("collection('applications')");
    expect(source).not.toContain("collection('entries')");
    expect(source).not.toContain('docRef.delete');
  });

  test('FirebaseService updateCourseSession uses linked-session callable', () => {
    const crudSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'js', 'firebase-crud.js'),
      'utf8'
    );
    const start = crudSource.indexOf('async updateCourseSession');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = crudSource.indexOf('\n  },', start);
    const source = crudSource.slice(start, end);
    expect(source).toContain("ensureFirebaseFunctionsSdk('asia-east1')");
    expect(source).toContain("httpsCallable('updateEduCourseSession')");
    expect(source).not.toContain("collection('sessions').doc(sessionId).update");
  });
  test('FirebaseService exposes deleteTournamentAtomic wrapper in asia-east1', () => {
    const crudSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'js', 'firebase-crud.js'),
      'utf8'
    );
    const start = crudSource.indexOf('async deleteTournamentAtomic');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = crudSource.indexOf('\n  },', start);
    const source = crudSource.slice(start, end);
    expect(source).toContain("ensureFirebaseFunctionsSdk('asia-east1')");
    expect(source).toContain("httpsCallable('deleteTournament')");
  });
});
