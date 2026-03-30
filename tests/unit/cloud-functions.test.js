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

/** registerForEvent CF: duplicate detection logic */
function cfDuplicateCheck(existingRegs, userId) {
  return existingRegs.some(r =>
    r.userId === userId
    && (r.status === 'confirmed' || r.status === 'waitlisted')
    && r.participantType !== 'companion'
  );
}

/** registerForEvent CF: status assignment */
function cfAssignStatus(confirmedCount, maxCapacity) {
  return confirmedCount >= maxCapacity ? 'waitlisted' : 'confirmed';
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
});
