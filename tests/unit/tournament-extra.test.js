/**
 * Tournament module unit tests — extracted pure functions.
 *
 * Source file: js/modules/tournament/tournament-core.js
 */

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:30-36
// _getTournamentMode — determines mode from various field formats
// ---------------------------------------------------------------------------
function _getTournamentMode(t) {
  const rawMode = String(t?.mode || t?.typeCode || t?.type || 'friendly').trim().toLowerCase();
  if (rawMode === 'cup' || rawMode.includes('\u676f') || rawMode.includes('\u76c3')) return 'cup';
  if (rawMode === 'league' || rawMode.includes('\u806f\u8cfd') || rawMode.includes('\u8054\u8d5b')) return 'league';
  if (rawMode === 'friendly' || rawMode.includes('\u53cb\u8abc')) return 'friendly';
  return ['friendly', 'cup', 'league'].includes(rawMode) ? rawMode : 'friendly';
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:43-47
// _sanitizeFriendlyTournamentTeamLimit — clamp to 2-4 range
// ---------------------------------------------------------------------------
function _sanitizeFriendlyTournamentTeamLimit(value, fallback = 4) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(4, Math.max(2, Math.floor(limit)));
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:61-66
// _buildTournamentOrganizerDisplay — formats organizer display text
// ---------------------------------------------------------------------------
function _buildTournamentOrganizerDisplay(teamName, userName) {
  const safeTeamName = String(teamName || '').trim();
  const safeUserName = String(userName || '').trim();
  if (safeTeamName && safeUserName) return `${safeTeamName}\uFF08${safeUserName}\uFF09`;
  return safeTeamName || safeUserName || '\u4e3b\u8fa6\u7403\u968a';
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:158-170
// _normalizeTournamentDelegates — deduplicates delegate list
// ---------------------------------------------------------------------------
function _normalizeTournamentDelegates(delegates) {
  if (!Array.isArray(delegates)) return [];
  const seen = new Set();
  return delegates.reduce((list, delegate) => {
    const uid = String(delegate?.uid || '').trim();
    const name = String(delegate?.name || '').trim();
    const dedupeKey = uid || (name ? `name:${name}` : '');
    if (!dedupeKey || seen.has(dedupeKey)) return list;
    seen.add(dedupeKey);
    list.push({ uid, name });
    return list;
  }, []);
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:172-184
// _getTournamentDelegateUids — merges direct UIDs + delegate UIDs
// ---------------------------------------------------------------------------
function _getTournamentDelegateUids(tournament) {
  const direct = Array.isArray(tournament?.delegateUids) ? tournament.delegateUids : [];
  const delegates = _normalizeTournamentDelegates(tournament?.delegates);
  const merged = [...direct, ...delegates.map(delegate => delegate.uid)];
  const seen = new Set();
  return merged.reduce((list, uid) => {
    const safeUid = String(uid || '').trim();
    if (!safeUid || seen.has(safeUid)) return list;
    seen.add(safeUid);
    list.push(safeUid);
    return list;
  }, []);
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:186-194
// _isTournamentLeaderForTeam — checks if user is team leader
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

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:196-201
// _isTournamentCaptainForTeam — checks if user is team captain
// ---------------------------------------------------------------------------
function _isTournamentCaptainForTeam(team, user) {
  if (!team || !user) return false;
  const uid = String(user.uid || '').trim();
  const displayName = String(user.displayName || user.name || '').trim();
  return (team.captainUid && team.captainUid === uid) || (!!team.captain && team.captain === displayName);
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:238-256
// _buildFriendlyTournamentApplicationRecord — normalizes application data
// ---------------------------------------------------------------------------
function _buildFriendlyTournamentApplicationRecord(data = {}) {
  const id = String(data.id || data._docId || data.teamId || '').trim();
  const requestedByUid = String(data.requestedByUid || data.creatorUid || '').trim();
  const requestedByName = String(data.requestedByName || data.creatorName || '').trim();
  return {
    id,
    teamId: String(data.teamId || '').trim(),
    teamName: String(data.teamName || '').trim(),
    teamImage: String(data.teamImage || '').trim(),
    status: String(data.status || 'pending').trim().toLowerCase(),
    requestedByUid,
    requestedByName,
    appliedAt: data.appliedAt || null,
    reviewedAt: data.reviewedAt || null,
    reviewedByUid: String(data.reviewedByUid || '').trim(),
    reviewedByName: String(data.reviewedByName || '').trim(),
    messageGroupId: String(data.messageGroupId || '').trim(),
  };
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:258-264
// _buildFriendlyTournamentRosterMemberRecord
// ---------------------------------------------------------------------------
function _buildFriendlyTournamentRosterMemberRecord(data = {}) {
  return {
    uid: String(data.uid || '').trim(),
    name: String(data.name || data.displayName || '').trim(),
    joinedAt: data.joinedAt || null,
  };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_getTournamentMode (tournament-core.js:30-36)', () => {
  test('explicit "friendly" → friendly', () => {
    expect(_getTournamentMode({ mode: 'friendly' })).toBe('friendly');
  });

  test('explicit "cup" → cup', () => {
    expect(_getTournamentMode({ mode: 'cup' })).toBe('cup');
  });

  test('explicit "league" → league', () => {
    expect(_getTournamentMode({ mode: 'league' })).toBe('league');
  });

  test('Chinese 友誼 → friendly', () => {
    expect(_getTournamentMode({ mode: '友誼賽' })).toBe('friendly');
  });

  test('Chinese 盃/杯 → cup', () => {
    expect(_getTournamentMode({ mode: '盃賽' })).toBe('cup');
    expect(_getTournamentMode({ mode: '杯赛' })).toBe('cup');
  });

  test('Chinese 聯賽/联赛 → league', () => {
    expect(_getTournamentMode({ mode: '聯賽' })).toBe('league');
    expect(_getTournamentMode({ mode: '联赛' })).toBe('league');
  });

  test('null/undefined → friendly (default)', () => {
    expect(_getTournamentMode(null)).toBe('friendly');
    expect(_getTournamentMode({})).toBe('friendly');
  });

  test('unknown mode → friendly', () => {
    expect(_getTournamentMode({ mode: 'exhibition' })).toBe('friendly');
  });

  test('reads typeCode as fallback', () => {
    expect(_getTournamentMode({ typeCode: 'cup' })).toBe('cup');
  });

  test('case insensitive', () => {
    expect(_getTournamentMode({ mode: 'CUP' })).toBe('cup');
    expect(_getTournamentMode({ mode: 'LEAGUE' })).toBe('league');
  });
});

describe('_sanitizeFriendlyTournamentTeamLimit (tournament-core.js:43-47)', () => {
  test('value within range → kept', () => {
    expect(_sanitizeFriendlyTournamentTeamLimit(3)).toBe(3);
  });

  test('value below 2 → clamped to 2', () => {
    expect(_sanitizeFriendlyTournamentTeamLimit(1)).toBe(2);
    expect(_sanitizeFriendlyTournamentTeamLimit(0)).toBe(2);
  });

  test('value above 4 → clamped to 4', () => {
    expect(_sanitizeFriendlyTournamentTeamLimit(10)).toBe(4);
  });

  test('fractional → floored', () => {
    expect(_sanitizeFriendlyTournamentTeamLimit(3.7)).toBe(3);
  });

  test('NaN → returns fallback', () => {
    expect(_sanitizeFriendlyTournamentTeamLimit('abc')).toBe(4);
    expect(_sanitizeFriendlyTournamentTeamLimit('abc', 3)).toBe(3);
  });

  test('Infinity → returns fallback', () => {
    expect(_sanitizeFriendlyTournamentTeamLimit(Infinity)).toBe(4);
  });
});

describe('_buildTournamentOrganizerDisplay (tournament-core.js:61-66)', () => {
  test('team + user → formatted with brackets', () => {
    expect(_buildTournamentOrganizerDisplay('FC Warriors', 'Alice'))
      .toBe('FC Warriors\uFF08Alice\uFF09');
  });

  test('team only → team name', () => {
    expect(_buildTournamentOrganizerDisplay('FC Warriors', '')).toBe('FC Warriors');
  });

  test('user only → user name', () => {
    expect(_buildTournamentOrganizerDisplay('', 'Alice')).toBe('Alice');
  });

  test('neither → default label', () => {
    expect(_buildTournamentOrganizerDisplay('', '')).toBe('\u4e3b\u8fa6\u7403\u968a');
  });

  test('null values → default label', () => {
    expect(_buildTournamentOrganizerDisplay(null, null)).toBe('\u4e3b\u8fa6\u7403\u968a');
  });
});

describe('_normalizeTournamentDelegates (tournament-core.js:158-170)', () => {
  test('deduplicates by uid', () => {
    const delegates = [
      { uid: 'u1', name: 'A' },
      { uid: 'u1', name: 'B' },
    ];
    const result = _normalizeTournamentDelegates(delegates);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('A');
  });

  test('deduplicates by name when no uid', () => {
    const delegates = [
      { name: 'Alice' },
      { name: 'Alice' },
    ];
    const result = _normalizeTournamentDelegates(delegates);
    expect(result.length).toBe(1);
  });

  test('filters out delegates with no uid or name', () => {
    const delegates = [{ uid: '', name: '' }, { uid: 'u1', name: 'A' }];
    const result = _normalizeTournamentDelegates(delegates);
    expect(result.length).toBe(1);
  });

  test('non-array → empty', () => {
    expect(_normalizeTournamentDelegates(null)).toEqual([]);
    expect(_normalizeTournamentDelegates(undefined)).toEqual([]);
  });

  test('trims uid and name', () => {
    const result = _normalizeTournamentDelegates([{ uid: ' u1 ', name: ' Alice ' }]);
    expect(result[0].uid).toBe('u1');
    expect(result[0].name).toBe('Alice');
  });
});

describe('_getTournamentDelegateUids (tournament-core.js:172-184)', () => {
  test('merges delegateUids and delegate objects', () => {
    const tournament = {
      delegateUids: ['u1'],
      delegates: [{ uid: 'u2', name: 'B' }],
    };
    expect(_getTournamentDelegateUids(tournament)).toEqual(['u1', 'u2']);
  });

  test('deduplicates across both sources', () => {
    const tournament = {
      delegateUids: ['u1', 'u2'],
      delegates: [{ uid: 'u2', name: 'B' }],
    };
    expect(_getTournamentDelegateUids(tournament)).toEqual(['u1', 'u2']);
  });

  test('filters empty UIDs', () => {
    const tournament = {
      delegateUids: ['', 'u1'],
      delegates: [{ uid: '', name: 'B' }],
    };
    expect(_getTournamentDelegateUids(tournament)).toEqual(['u1']);
  });

  test('no delegates → empty', () => {
    expect(_getTournamentDelegateUids({})).toEqual([]);
  });
});

describe('_isTournamentLeaderForTeam (tournament-core.js:186-194)', () => {
  test('user uid in leaderUids → true', () => {
    expect(_isTournamentLeaderForTeam(
      { leaderUids: ['u1', 'u2'] },
      { uid: 'u2' }
    )).toBe(true);
  });

  test('user name matches leader → true', () => {
    expect(_isTournamentLeaderForTeam(
      { leader: 'Alice' },
      { displayName: 'Alice' }
    )).toBe(true);
  });

  test('single leaderUid field → works', () => {
    expect(_isTournamentLeaderForTeam(
      { leaderUid: 'u1' },
      { uid: 'u1' }
    )).toBe(true);
  });

  test('no match → false', () => {
    expect(_isTournamentLeaderForTeam(
      { leaderUids: ['u1'] },
      { uid: 'u99' }
    )).toBe(false);
  });

  test('null team/user → false', () => {
    expect(_isTournamentLeaderForTeam(null, { uid: 'u1' })).toBe(false);
    expect(_isTournamentLeaderForTeam({ leaderUids: ['u1'] }, null)).toBe(false);
  });
});

describe('_isTournamentCaptainForTeam (tournament-core.js:196-201)', () => {
  test('captainUid matches → true', () => {
    expect(_isTournamentCaptainForTeam(
      { captainUid: 'u1' },
      { uid: 'u1' }
    )).toBe(true);
  });

  test('captain name matches → true', () => {
    expect(_isTournamentCaptainForTeam(
      { captain: 'Alice' },
      { displayName: 'Alice' }
    )).toBe(true);
  });

  test('no match → false', () => {
    expect(_isTournamentCaptainForTeam(
      { captainUid: 'u1', captain: 'Alice' },
      { uid: 'u99', displayName: 'Bob' }
    )).toBe(false);
  });

  test('null → false', () => {
    expect(_isTournamentCaptainForTeam(null, null)).toBe(false);
  });
});

describe('_buildFriendlyTournamentApplicationRecord (tournament-core.js:238-256)', () => {
  test('normalizes all fields', () => {
    const result = _buildFriendlyTournamentApplicationRecord({
      teamId: 't1',
      teamName: 'Warriors',
      status: ' APPROVED ',
      requestedByUid: 'u1',
    });
    expect(result.teamId).toBe('t1');
    expect(result.teamName).toBe('Warriors');
    expect(result.status).toBe('approved');
    expect(result.requestedByUid).toBe('u1');
  });

  test('defaults status to pending', () => {
    const result = _buildFriendlyTournamentApplicationRecord({});
    expect(result.status).toBe('pending');
  });

  test('falls back to creatorUid/creatorName', () => {
    const result = _buildFriendlyTournamentApplicationRecord({
      creatorUid: 'c1',
      creatorName: 'Creator',
    });
    expect(result.requestedByUid).toBe('c1');
    expect(result.requestedByName).toBe('Creator');
  });

  test('empty data → all empty strings/null', () => {
    const result = _buildFriendlyTournamentApplicationRecord({});
    expect(result.teamId).toBe('');
    expect(result.appliedAt).toBeNull();
    expect(result.reviewedAt).toBeNull();
  });
});

describe('_buildFriendlyTournamentRosterMemberRecord (tournament-core.js:258-264)', () => {
  test('extracts uid and name', () => {
    const result = _buildFriendlyTournamentRosterMemberRecord({ uid: 'u1', name: 'Alice' });
    expect(result.uid).toBe('u1');
    expect(result.name).toBe('Alice');
  });

  test('falls back to displayName', () => {
    const result = _buildFriendlyTournamentRosterMemberRecord({ uid: 'u1', displayName: 'Bob' });
    expect(result.name).toBe('Bob');
  });

  test('empty → empty strings with null joinedAt', () => {
    const result = _buildFriendlyTournamentRosterMemberRecord({});
    expect(result.uid).toBe('');
    expect(result.name).toBe('');
    expect(result.joinedAt).toBeNull();
  });
});
