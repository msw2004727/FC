/**
 * Tournament Permissions — unit tests
 *
 * Extracted from js/modules/tournament/tournament-core.js:203-234
 * Tests: _getFriendlyResponsibleTeams, _canCreateFriendlyTournament,
 *        _canManageTournamentRecord, _isTournamentDelegate
 *
 * Personas:
 *   - Regular user (no teams, no permissions)
 *   - Coach (has admin.tournaments.entry)
 *   - Captain of a team
 *   - Delegate of a tournament
 *   - Admin (role-based, aligned with Firestore rules isAdmin())
 */

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:186-201
// ---------------------------------------------------------------------------
function _isTournamentGlobalAdmin(user) {
  const role = String(user?.role || '').trim().toLowerCase();
  return role === 'admin' || role === 'super_admin';
}

function _isTournamentTeamOfficerForTeam(team, user) {
  if (!team || !user) return false;
  const uid = String(user.uid || user.lineUserId || '').trim();
  if (!uid) return false;
  return String(team.captainUid || '').trim() === uid
    || String(team.creatorUid || '').trim() === uid
    || String(team.ownerUid || '').trim() === uid
    || String(team.leaderUid || '').trim() === uid
    || (Array.isArray(team.leaderUids) && team.leaderUids.map(item => String(item || '').trim()).includes(uid));
}

function _isTournamentLeaderForTeam(team, user) {
  if (!team || !user) return false;
  const uid = String(user.uid || user.lineUserId || '').trim();
  if (!uid) return false;
  return String(team.leaderUid || '').trim() === uid
    || (Array.isArray(team.leaderUids) && team.leaderUids.map(item => String(item || '').trim()).includes(uid));
}

function _isTournamentCaptainForTeam(team, user) {
  if (!team || !user) return false;
  const uid = String(user.uid || user.lineUserId || '').trim();
  if (!uid) return false;
  return String(team.captainUid || '').trim() === uid;
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:203-210
// ---------------------------------------------------------------------------
function _getFriendlyResponsibleTeams(user, allTeams) {
  if (!user) return [];
  return (allTeams || []).filter(team => _isTournamentTeamOfficerForTeam(team, user));
}

// ---------------------------------------------------------------------------
// Extracted from tournament-helpers.js:168-180
// ---------------------------------------------------------------------------
function _hasTournamentCreatePermission(user, permissions) {
  if (!user) return false;
  if (String(user.role || '').trim().toLowerCase() === 'super_admin') return true;
  return (permissions || []).includes('admin.tournaments.create');
}

function _canCreateFriendlyTournament(user, allTeams, permissions) {
  if (!user) return false;
  if (!_hasTournamentCreatePermission(user, permissions)) return false;
  if (_isTournamentGlobalAdmin(user)) return true;
  return _getFriendlyResponsibleTeams(user, allTeams).length > 0;
}

// ---------------------------------------------------------------------------
// Extracted from tournament-manage-host.js:11-33
// ---------------------------------------------------------------------------
function _getTournamentSelectableHostTeams(user, allTeams, selectedId = '') {
  const joinedIds = new Set([
    ...(Array.isArray(user?.teamIds) ? user.teamIds : []),
    user?.teamId,
  ].map(item => String(item || '').trim()).filter(Boolean));
  const isJoinedTeam = team => [team?.id, team?._docId, team?.docId, team?.teamId]
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .some(id => joinedIds.has(id));
  const source = _isTournamentGlobalAdmin(user)
    ? (allTeams || []).filter(team => isJoinedTeam(team) || _isTournamentTeamOfficerForTeam(team, user))
    : _getFriendlyResponsibleTeams(user, allTeams);
  const teams = [];
  const seen = new Set();

  source.forEach(team => {
    const safeId = String(team?.id || '').trim();
    if (!safeId || seen.has(safeId)) return;
    seen.add(safeId);
    teams.push(team);
  });

  const safeSelectedId = String(selectedId || '').trim();
  if (safeSelectedId && !seen.has(safeSelectedId)) {
    const selectedTeam = (allTeams || []).find(team => team.id === safeSelectedId);
    if (selectedTeam) teams.push(selectedTeam);
  }
  return teams;
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:219-224
// ---------------------------------------------------------------------------
function _isTournamentDelegate(tournament, user) {
  if (!tournament || !user) return false;
  const uid = String(user.uid || user.lineUserId || '').trim();
  if (!uid) return false;
  const delegateUids = [
    ...(Array.isArray(tournament.delegateUids) ? tournament.delegateUids : []),
    ...(Array.isArray(tournament.delegates) ? tournament.delegates.map(delegate => delegate?.uid) : []),
  ].map(item => String(item || '').trim()).filter(Boolean);
  return delegateUids.includes(uid);
}

// ---------------------------------------------------------------------------
// Extracted from tournament-helpers.js:117-128 (post 2026-04-28 creator fix)
// ---------------------------------------------------------------------------
function _canManageTournamentRecord(tournament, user, allTeams, permissions) {
  if (!tournament || !user) return false;
  if (_isTournamentGlobalAdmin(user)) return true;
  const currentUid = String(user.uid || user.lineUserId || '').trim();
  const creatorUid = String(tournament.creatorUid || '').trim();
  if (currentUid && creatorUid && currentUid === creatorUid) return true;
  if (_isTournamentDelegate(tournament, user)) return true;
  const hostTeamId = String(tournament.hostTeamId || '').trim();
  if (!hostTeamId) return false;
  return _getFriendlyResponsibleTeams(user, allTeams).some(team => team.id === hostTeamId);
}

// ---------------------------------------------------------------------------
// Review-application guard logic
// (mirror of tournament-friendly-detail.js reviewFriendlyTournamentApplication
//  post 2026-04-28: role-based global admin OR _canManageTournamentRecord)
// admin.tournaments.entry/manage_all permissions must NOT independently authorize record-scope action.
// ---------------------------------------------------------------------------
function _canReviewFriendlyApplication(tournament, user, allTeams, permissions) {
  if (!tournament || !user) return false;
  return _canManageTournamentRecord(tournament, user, allTeams, permissions);
}


// ═══════════════════════════════════════════════════════
//  Test Personas
// ═══════════════════════════════════════════════════════

const regularUser = { uid: 'user1', displayName: 'Regular' };

const coach = { uid: 'coach1', displayName: 'Coach Wang' };
const coachPermissions = ['admin.tournaments.entry'];

const captainUser = { uid: 'cap1', displayName: 'Captain Li' };
const captainCreatePermissions = ['admin.tournaments.entry', 'admin.tournaments.create'];

const delegateUser = { uid: 'del1', displayName: 'Delegate Chen' };

const adminUser = { uid: 'admin1', displayName: 'Admin', role: 'admin' };
const adminPermissions = ['admin.tournaments.manage_all'];
const adminCreatePermissions = ['admin.tournaments.manage_all', 'admin.tournaments.create'];
const superAdminUser = { uid: 'super1', displayName: 'Super Admin', role: 'super_admin' };

const teamA = { id: 'teamA', name: 'FC Alpha', captainUid: 'cap1', leaderUids: [] };
const teamB = { id: 'teamB', name: 'FC Beta', captainUid: 'other', leaderUids: ['leader1'] };
const teamCreator = { id: 'teamCreator', name: 'FC Creator', creatorUid: 'cre1' };
const teamOwner = { id: 'teamOwner', name: 'FC Owner', ownerUid: 'own1' };
const teamSingleLeader = { id: 'teamSingleLeader', name: 'FC Lead', leaderUid: 'leadSingle' };
const allTeams = [teamA, teamB, teamCreator, teamOwner, teamSingleLeader];

const tournamentHostedByA = {
  id: 't1',
  hostTeamId: 'teamA',
  creatorUid: 'cap1',
  delegates: [{ uid: 'del1', name: 'Delegate Chen' }],
};

const tournamentHostedByB = {
  id: 't2',
  hostTeamId: 'teamB',
  creatorUid: 'other',
  delegates: [],
};

const tournamentDelegateUidsOnly = {
  id: 't2b',
  hostTeamId: 'teamB',
  creatorUid: 'other',
  delegateUids: ['del1'],
  delegates: [],
};

const tournamentNoHost = {
  id: 't3',
  hostTeamId: '',
  creatorUid: 'someoneElse',  // 非 captainUser、非 regularUser 等任一測試 user
  delegates: [],
};

// 「creator-only」 — creator 是一般用戶,不是 host team 幹部/委託人/admin
const creatorOnlyUser = { uid: 'creatorOnly', displayName: 'Creator Only' };
const tournamentCreatedByCreatorOnly = {
  id: 't4',
  hostTeamId: 'teamA',          // creatorOnly 不是 teamA captain/leader
  creatorUid: 'creatorOnly',
  delegates: [],
};


// ═══════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════

describe('_getFriendlyResponsibleTeams', () => {
  test('regular user with no team roles returns empty', () => {
    expect(_getFriendlyResponsibleTeams(regularUser, allTeams)).toEqual([]);
  });

  test('captain gets their team', () => {
    const result = _getFriendlyResponsibleTeams(captainUser, allTeams);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('teamA');
  });

  test('leader gets their team', () => {
    const leader = { uid: 'leader1', displayName: 'Leader' };
    const result = _getFriendlyResponsibleTeams(leader, allTeams);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('teamB');
  });

  test('creatorUid / ownerUid / leaderUid are responsible team officers', () => {
    expect(_getFriendlyResponsibleTeams({ uid: 'cre1' }, allTeams).map(t => t.id)).toContain('teamCreator');
    expect(_getFriendlyResponsibleTeams({ uid: 'own1' }, allTeams).map(t => t.id)).toContain('teamOwner');
    expect(_getFriendlyResponsibleTeams({ uid: 'leadSingle' }, allTeams).map(t => t.id)).toContain('teamSingleLeader');
  });

  test('null user returns empty', () => {
    expect(_getFriendlyResponsibleTeams(null, allTeams)).toEqual([]);
  });

  test('empty teams list returns empty', () => {
    expect(_getFriendlyResponsibleTeams(captainUser, [])).toEqual([]);
  });
});

describe('_canCreateFriendlyTournament', () => {
  test('regular user with no teams cannot create', () => {
    expect(_canCreateFriendlyTournament(regularUser, allTeams, [])).toBe(false);
  });

  test('captain with team and create permission can create', () => {
    expect(_canCreateFriendlyTournament(captainUser, allTeams, captainCreatePermissions)).toBe(true);
  });

  test('captain with team but without create permission cannot create', () => {
    expect(_canCreateFriendlyTournament(captainUser, allTeams, ['admin.tournaments.entry'])).toBe(false);
  });

  test('admin role with create permission can create even without teams', () => {
    expect(_canCreateFriendlyTournament(adminUser, [], adminCreatePermissions)).toBe(true);
  });

  test('admin role without create permission cannot create', () => {
    expect(_canCreateFriendlyTournament(adminUser, [], adminPermissions)).toBe(false);
  });

  test('super_admin can create through all-permission bypass', () => {
    expect(_canCreateFriendlyTournament(superAdminUser, [], [])).toBe(true);
  });

  test('manage_all permission alone is not treated as global admin', () => {
    expect(_canCreateFriendlyTournament({ uid: 'permOnly', role: 'user' }, [], ['admin.tournaments.manage_all'])).toBe(false);
  });

  test('create permission alone still needs admin role or responsible team', () => {
    expect(_canCreateFriendlyTournament({ uid: 'permOnly', role: 'user' }, [], ['admin.tournaments.create'])).toBe(false);
  });

  test('coach without teams cannot create (entry perm is not enough)', () => {
    expect(_canCreateFriendlyTournament(coach, [], coachPermissions)).toBe(false);
  });

  test('null user cannot create', () => {
    expect(_canCreateFriendlyTournament(null, allTeams, adminPermissions)).toBe(false);
  });
});

describe('_getTournamentSelectableHostTeams', () => {
  test('admin role can select joined and officer teams only', () => {
    const admin = { uid: 'admin2', role: 'admin', teamIds: ['teamB'] };
    const result = _getTournamentSelectableHostTeams(admin, [
      ...allTeams,
      { id: 'teamAdminOfficer', name: 'Admin Officer', ownerUid: 'admin2' },
      { id: 'teamStranger', name: 'Stranger', ownerUid: 'someoneElse' },
    ]);
    expect(result.map(team => team.id)).toEqual(['teamB', 'teamAdminOfficer']);
  });

  test('captain can only select teams they are responsible for', () => {
    const result = _getTournamentSelectableHostTeams(captainUser, allTeams);
    expect(result.map(team => team.id)).toEqual(['teamA']);
  });

  test('manage_all permission alone is not a host-team selector bypass', () => {
    const permOnly = { uid: 'permOnly', role: 'user' };
    const result = _getTournamentSelectableHostTeams(permOnly, allTeams);
    expect(result).toEqual([]);
  });

  test('selected existing team is preserved for edit fallback', () => {
    const result = _getTournamentSelectableHostTeams(captainUser, allTeams, 'teamB');
    expect(result.map(team => team.id)).toEqual(['teamA', 'teamB']);
  });
});

describe('_isTournamentDelegate', () => {
  test('delegate user is recognized', () => {
    expect(_isTournamentDelegate(tournamentHostedByA, delegateUser)).toBe(true);
  });

  test('delegateUids-only tournament recognizes delegate user', () => {
    expect(_isTournamentDelegate(tournamentDelegateUidsOnly, delegateUser)).toBe(true);
  });

  test('non-delegate user is not recognized', () => {
    expect(_isTournamentDelegate(tournamentHostedByA, regularUser)).toBe(false);
  });

  test('returns false for tournament with no delegates', () => {
    expect(_isTournamentDelegate(tournamentHostedByB, delegateUser)).toBe(false);
  });

  test('returns false for null tournament', () => {
    expect(_isTournamentDelegate(null, delegateUser)).toBe(false);
  });

  test('returns false for null user', () => {
    expect(_isTournamentDelegate(tournamentHostedByA, null)).toBe(false);
  });

  test('returns false when delegates is not an array', () => {
    expect(_isTournamentDelegate({ delegates: 'bad' }, delegateUser)).toBe(false);
  });
});

describe('_canManageTournamentRecord', () => {
  test('admin can manage any tournament', () => {
    expect(_canManageTournamentRecord(tournamentHostedByA, adminUser, allTeams, adminPermissions)).toBe(true);
    expect(_canManageTournamentRecord(tournamentHostedByB, adminUser, allTeams, adminPermissions)).toBe(true);
    expect(_canManageTournamentRecord(tournamentNoHost, adminUser, [], adminPermissions)).toBe(true);
  });

  test('delegate can manage their assigned tournament', () => {
    expect(_canManageTournamentRecord(tournamentHostedByA, delegateUser, allTeams, [])).toBe(true);
  });

  test('delegateUids-only delegate can manage their assigned tournament', () => {
    expect(_canManageTournamentRecord(tournamentDelegateUidsOnly, delegateUser, allTeams, [])).toBe(true);
  });

  test('delegate cannot manage a different tournament', () => {
    expect(_canManageTournamentRecord(tournamentHostedByB, delegateUser, allTeams, [])).toBe(false);
  });

  test('host team captain can manage their tournament', () => {
    expect(_canManageTournamentRecord(tournamentHostedByA, captainUser, allTeams, [])).toBe(true);
  });

  test('host team captain cannot manage a different team tournament', () => {
    expect(_canManageTournamentRecord(tournamentHostedByB, captainUser, allTeams, [])).toBe(false);
  });

  test('regular user cannot manage any tournament', () => {
    expect(_canManageTournamentRecord(tournamentHostedByA, regularUser, allTeams, [])).toBe(false);
    expect(_canManageTournamentRecord(tournamentHostedByB, regularUser, allTeams, [])).toBe(false);
  });

  test('null user returns false', () => {
    expect(_canManageTournamentRecord(tournamentHostedByA, null, allTeams, adminPermissions)).toBe(false);
  });

  test('null tournament returns false', () => {
    expect(_canManageTournamentRecord(null, adminUser, allTeams, adminPermissions)).toBe(false);
  });

  test('tournament with empty hostTeamId — non-admin/non-delegate cannot manage', () => {
    expect(_canManageTournamentRecord(tournamentNoHost, captainUser, allTeams, [])).toBe(false);
  });

  test('coach without manage_all cannot manage', () => {
    expect(_canManageTournamentRecord(tournamentHostedByA, coach, allTeams, coachPermissions)).toBe(false);
  });

  test('manage_all permission alone cannot manage arbitrary tournament without admin role', () => {
    const permOnly = { uid: 'permOnly', role: 'user' };
    expect(_canManageTournamentRecord(tournamentHostedByA, permOnly, allTeams, ['admin.tournaments.manage_all'])).toBe(false);
  });

  // Creator branch (added 2026-04-28)
  test('creator-only user (not in any team, no admin perm) can manage their own tournament', () => {
    expect(_canManageTournamentRecord(tournamentCreatedByCreatorOnly, creatorOnlyUser, allTeams, [])).toBe(true);
  });

  test('creator-only user cannot manage someone else\'s tournament', () => {
    expect(_canManageTournamentRecord(tournamentHostedByB, creatorOnlyUser, allTeams, [])).toBe(false);
  });

  test('creator branch falls back to false when creatorUid is empty string', () => {
    const t = { id: 'tx', hostTeamId: 'teamA', creatorUid: '', delegates: [] };
    expect(_canManageTournamentRecord(t, creatorOnlyUser, allTeams, [])).toBe(false);
  });

  test('creator branch falls back to false when user uid is empty', () => {
    const userNoUid = { displayName: 'No UID' };
    expect(_canManageTournamentRecord(tournamentCreatedByCreatorOnly, userNoUid, allTeams, [])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════
//  Review-application guard
//  (review = role-based global admin OR _canManageTournamentRecord;
//   admin.tournaments.entry/manage_all must NOT bypass record scope)
// ═══════════════════════════════════════════════════════
describe('_canReviewFriendlyApplication', () => {
  test('creator-only user CAN review applications for tournament they created', () => {
    expect(_canReviewFriendlyApplication(tournamentCreatedByCreatorOnly, creatorOnlyUser, allTeams, [])).toBe(true);
  });

  test('admin role can review any application', () => {
    expect(_canReviewFriendlyApplication(tournamentHostedByA, adminUser, allTeams, adminPermissions)).toBe(true);
    expect(_canReviewFriendlyApplication(tournamentHostedByB, adminUser, allTeams, adminPermissions)).toBe(true);
  });

  test('host team captain can review their tournament applications', () => {
    expect(_canReviewFriendlyApplication(tournamentHostedByA, captainUser, allTeams, [])).toBe(true);
  });

  test('delegate can review applications for assigned tournament', () => {
    expect(_canReviewFriendlyApplication(tournamentHostedByA, delegateUser, allTeams, [])).toBe(true);
  });

  test('entry-only user (coach/captain/venue_owner with admin.tournaments.entry) CANNOT review arbitrary tournaments', () => {
    // coach has admin.tournaments.entry but is NOT host/delegate/creator/admin of tournamentHostedByA
    expect(_canReviewFriendlyApplication(tournamentHostedByA, coach, allTeams, coachPermissions)).toBe(false);
    // captain of teamA has admin.tournaments.entry too — but on tournament hosted by teamB he's not record-scope manager
    const captainEntryPerm = ['admin.tournaments.entry'];
    expect(_canReviewFriendlyApplication(tournamentHostedByB, captainUser, allTeams, captainEntryPerm)).toBe(false);
  });

  test('regular user without any role cannot review', () => {
    expect(_canReviewFriendlyApplication(tournamentHostedByA, regularUser, allTeams, [])).toBe(false);
  });

  test('null tournament returns false', () => {
    expect(_canReviewFriendlyApplication(null, adminUser, allTeams, adminPermissions)).toBe(false);
  });

  test('null user returns false', () => {
    expect(_canReviewFriendlyApplication(tournamentHostedByA, null, allTeams, adminPermissions)).toBe(false);
  });
});
