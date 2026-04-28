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
 *   - Admin (has admin.tournaments.manage_all)
 */

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:186-201
// ---------------------------------------------------------------------------
function _isTournamentLeaderForTeam(team, user) {
  if (!team || !user) return false;
  const uid = String(user.uid || '').trim();
  const displayName = String(user.displayName || user.name || '').trim();
  const leaderUids = Array.isArray(team.leaderUids)
    ? team.leaderUids
    : (team.leaderUid ? [team.leaderUid] : []);
  return leaderUids.includes(uid) || (!!team.leader && team.leader === displayName);
}

function _isTournamentCaptainForTeam(team, user) {
  if (!team || !user) return false;
  const uid = String(user.uid || '').trim();
  const displayName = String(user.displayName || user.name || '').trim();
  return (team.captainUid && team.captainUid === uid) || (!!team.captain && team.captain === displayName);
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:203-210
// ---------------------------------------------------------------------------
function _getFriendlyResponsibleTeams(user, allTeams) {
  if (!user) return [];
  return (allTeams || []).filter(team =>
    _isTournamentCaptainForTeam(team, user) || _isTournamentLeaderForTeam(team, user)
  );
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:212-217
// ---------------------------------------------------------------------------
function _canCreateFriendlyTournament(user, allTeams, permissions) {
  if (!user) return false;
  if ((permissions || []).includes('admin.tournaments.manage_all')) return true;
  return _getFriendlyResponsibleTeams(user, allTeams).length > 0;
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:219-224
// ---------------------------------------------------------------------------
function _isTournamentDelegate(tournament, user) {
  if (!tournament || !user) return false;
  const delegates = Array.isArray(tournament.delegates) ? tournament.delegates : [];
  return delegates.some(delegate => delegate && delegate.uid === user.uid);
}

// ---------------------------------------------------------------------------
// Extracted from tournament-helpers.js:117-128 (post 2026-04-28 creator fix)
// ---------------------------------------------------------------------------
function _canManageTournamentRecord(tournament, user, allTeams, permissions) {
  if (!tournament || !user) return false;
  if ((permissions || []).includes('admin.tournaments.manage_all')) return true;
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
//  post 2026-04-28: manage_all OR _canManageTournamentRecord)
// admin.tournaments.entry must NOT independently authorize record-scope action.
// ---------------------------------------------------------------------------
function _canReviewFriendlyApplication(tournament, user, allTeams, permissions) {
  if (!tournament || !user) return false;
  if ((permissions || []).includes('admin.tournaments.manage_all')) return true;
  return _canManageTournamentRecord(tournament, user, allTeams, permissions);
}


// ═══════════════════════════════════════════════════════
//  Test Personas
// ═══════════════════════════════════════════════════════

const regularUser = { uid: 'user1', displayName: 'Regular' };

const coach = { uid: 'coach1', displayName: 'Coach Wang' };
const coachPermissions = ['admin.tournaments.entry'];

const captainUser = { uid: 'cap1', displayName: 'Captain Li' };

const delegateUser = { uid: 'del1', displayName: 'Delegate Chen' };

const adminUser = { uid: 'admin1', displayName: 'Admin' };
const adminPermissions = ['admin.tournaments.manage_all'];

const teamA = { id: 'teamA', name: 'FC Alpha', captainUid: 'cap1', leaderUids: [] };
const teamB = { id: 'teamB', name: 'FC Beta', captainUid: 'other', leaderUids: ['leader1'] };
const allTeams = [teamA, teamB];

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

  test('captain with team can create', () => {
    expect(_canCreateFriendlyTournament(captainUser, allTeams, [])).toBe(true);
  });

  test('admin with manage_all can create even without teams', () => {
    expect(_canCreateFriendlyTournament(adminUser, [], adminPermissions)).toBe(true);
  });

  test('coach without teams cannot create (entry perm is not enough)', () => {
    expect(_canCreateFriendlyTournament(coach, [], coachPermissions)).toBe(false);
  });

  test('null user cannot create', () => {
    expect(_canCreateFriendlyTournament(null, allTeams, adminPermissions)).toBe(false);
  });
});

describe('_isTournamentDelegate', () => {
  test('delegate user is recognized', () => {
    expect(_isTournamentDelegate(tournamentHostedByA, delegateUser)).toBe(true);
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
//  (review = manage_all OR _canManageTournamentRecord;
//   admin.tournaments.entry must NOT bypass record scope)
// ═══════════════════════════════════════════════════════
describe('_canReviewFriendlyApplication', () => {
  test('creator-only user CAN review applications for tournament they created', () => {
    expect(_canReviewFriendlyApplication(tournamentCreatedByCreatorOnly, creatorOnlyUser, allTeams, [])).toBe(true);
  });

  test('admin (manage_all) can review any application', () => {
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
