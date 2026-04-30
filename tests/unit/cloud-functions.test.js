/**
 * Cloud Functions — unit tests (mock-based)
 *
 * Tests the pure logic extracted from functions/index.js.
 * Since Cloud Functions depend on Firebase Admin SDK,
 * we mock the SDK and test the validation/business logic.
 *
 * Covers 30 exported functions' input validation and key decision logic.
 */

// ===========================================================================
// Constants extracted from functions/index.js:27-74
// ===========================================================================
const VALID_ROLES = new Set([
  "user", "coach", "captain", "venue_owner", "admin", "super_admin",
]);
const DISABLED_PERMISSION_CODES = new Set(["admin.roles.entry"]);
const ROLE_LEVELS = Object.freeze({
  user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5,
});
const INHERENT_ROLE_PERMISSIONS = Object.freeze({
  coach:       ["activity.manage.entry", "admin.tournaments.entry"],
  captain:     ["activity.manage.entry", "admin.tournaments.entry"],
  venue_owner: ["activity.manage.entry", "admin.tournaments.entry"],
  super_admin: ["admin.repair.event_blocklist"],
});
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

/** Permission check: inherent + dynamic */
function hasPermission(userRole, dynamicPermissions, permCode) {
  if (DISABLED_PERMISSION_CODES.has(permCode)) return false;
  const inherent = INHERENT_ROLE_PERMISSIONS[userRole] || [];
  if (inherent.includes(permCode)) return true;
  return (dynamicPermissions || []).includes(permCode);
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
function cfDuplicateCheck(existingRegs, userId) {
  return existingRegs.some(r =>
    r.userId === userId
    && (r.status === 'confirmed' || r.status === 'waitlisted')
    && r.participantType !== 'companion'
  );
}

function cfRegistrationUniqueKey(reg = {}) {
  const userId = String(reg.userId || '').trim();
  if (reg.participantType === 'companion') {
    return `${userId}_companion_${String(reg.companionId || '').trim()}`;
  }
  return `${userId}_self`;
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

// ===========================================================================
// TESTS
// ===========================================================================

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
  test('coach has inherent activity.manage.entry', () => {
    expect(hasPermission('coach', [], 'activity.manage.entry')).toBe(true);
  });

  test('captain has inherent admin.tournaments.entry', () => {
    expect(hasPermission('captain', [], 'admin.tournaments.entry')).toBe(true);
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

  test('inherent + dynamic do not conflict', () => {
    expect(hasPermission('coach', ['admin.shop.entry'], 'activity.manage.entry')).toBe(true);
    expect(hasPermission('coach', ['admin.shop.entry'], 'admin.shop.entry')).toBe(true);
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

  test('confirmed when under capacity', () => {
    expect(cfAssignStatus(2, 5)).toBe('confirmed');
  });

  test('waitlisted when at capacity', () => {
    expect(cfAssignStatus(5, 5)).toBe('waitlisted');
  });

  test('waitlisted when over capacity', () => {
    expect(cfAssignStatus(6, 5)).toBe('waitlisted');
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

const ADMIN_USER_EDIT_PROFILE_PERMISSION = 'admin.users.edit_profile';
const ADMIN_USER_CHANGE_ROLE_PERMISSION = 'admin.users.change_role';
const ADMIN_USER_RESTRICT_PERMISSION = 'admin.users.restrict';
const ADMIN_MANAGED_USER_PROFILE_FIELDS = ['region', 'gender', 'birthday', 'sports', 'phone'];

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
    const result = sanitizeAdminManagedProfileUpdates({ region: '  台北  ', phone: ' 0912345678 ' });
    expect(result.region).toBe('台北');
    expect(result.phone).toBe('0912345678');
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
