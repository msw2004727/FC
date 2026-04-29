/**
 * Tournament Core — unit tests
 *
 * Extracted from js/modules/tournament/tournament-core.js
 * Tests: status calculation, date logic, mode detection, team limits,
 *        organizer display, delegate normalization, leader/captain checks
 */

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:9-16
// ---------------------------------------------------------------------------
function getTournamentStatus(t) {
  if (!t || !t.regStart || !t.regEnd) return (t && t.status) || '即將開始';
  const now = new Date();
  const start = new Date(t.regStart);
  const end = new Date(t.regEnd);
  if (now < start) return '即將開始';
  if (now >= start && now <= end) return '報名中';
  return '已截止報名';
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:19-28
// ---------------------------------------------------------------------------
function isTournamentEnded(t) {
  if (!t) return false;
  if (t.ended === true) return true;
  const dates = Array.isArray(t.matchDates) ? t.matchDates : [];
  if (dates.length === 0) return false;
  const lastDate = new Date(dates[dates.length - 1]);
  if (Number.isNaN(lastDate.getTime())) return false;
  lastDate.setHours(lastDate.getHours() + 24);
  return new Date() > lastDate;
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:30-36
// ---------------------------------------------------------------------------
function _getTournamentMode(t) {
  const rawMode = String(t?.mode || t?.typeCode || t?.type || 'friendly').trim().toLowerCase();
  if (rawMode === 'cup' || rawMode.includes('盃') || rawMode.includes('杯')) return 'cup';
  if (rawMode === 'league' || rawMode.includes('聯賽') || rawMode.includes('联赛')) return 'league';
  if (rawMode === 'friendly' || rawMode.includes('友誼')) return 'friendly';
  return ['friendly', 'cup', 'league'].includes(rawMode) ? rawMode : 'friendly';
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:43-47
// ---------------------------------------------------------------------------
function _sanitizeFriendlyTournamentTeamLimit(value, fallback = 4) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(4, Math.max(2, Math.floor(limit)));
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:61-66
// ---------------------------------------------------------------------------
function _buildTournamentOrganizerDisplay(teamName, userName) {
  const safeTeamName = String(teamName || '').trim();
  const safeUserName = String(userName || '').trim();
  if (safeTeamName && safeUserName) return `${safeTeamName}（${safeUserName}）`;
  return safeTeamName || safeUserName || '主辦俱樂部';
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:78-85
// ---------------------------------------------------------------------------
function _getTournamentOrganizerDisplayText(tournament) {
  if (!tournament) return '主辦俱樂部';
  const direct = String(tournament.organizerDisplay || '').trim();
  if (direct) return direct;
  const teamName = String(tournament.hostTeamName || '').trim();
  const userName = String(tournament.organizer || tournament.creatorName || '').trim();
  return _buildTournamentOrganizerDisplay(teamName, userName);
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:158-170
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
// Extracted from tournament-helpers.js:72-84
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
// ---------------------------------------------------------------------------
function _isTournamentCaptainForTeam(team, user) {
  if (!team || !user) return false;
  const uid = String(user.uid || '').trim();
  const displayName = String(user.displayName || user.name || '').trim();
  return (team.captainUid && team.captainUid === uid) || (!!team.captain && team.captain === displayName);
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:258-264
// ---------------------------------------------------------------------------
function _buildFriendlyTournamentRosterMemberRecord(data = {}) {
  return {
    uid: String(data.uid || '').trim(),
    name: String(data.name || data.displayName || '').trim(),
    joinedAt: data.joinedAt || null,
  };
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:238-256
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

// ═══════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════

describe('getTournamentStatus', () => {
  test('returns 即將開始 for null/undefined', () => {
    expect(getTournamentStatus(null)).toBe('即將開始');
    expect(getTournamentStatus(undefined)).toBe('即將開始');
  });

  test('returns existing status when no dates', () => {
    expect(getTournamentStatus({ status: '準備中' })).toBe('準備中');
  });

  test('returns 即將開始 when missing regStart/regEnd', () => {
    expect(getTournamentStatus({ regStart: '2026-01-01' })).toBe('即將開始');
    expect(getTournamentStatus({ regEnd: '2026-01-01' })).toBe('即將開始');
  });

  test('returns 即將開始 when before regStart', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const farFuture = new Date(future);
    farFuture.setMonth(farFuture.getMonth() + 1);
    expect(getTournamentStatus({
      regStart: future.toISOString(),
      regEnd: farFuture.toISOString(),
    })).toBe('即將開始');
  });

  test('returns 報名中 when within registration period', () => {
    const past = new Date();
    past.setDate(past.getDate() - 1);
    const future = new Date();
    future.setDate(future.getDate() + 7);
    expect(getTournamentStatus({
      regStart: past.toISOString(),
      regEnd: future.toISOString(),
    })).toBe('報名中');
  });

  test('returns 已截止報名 when after regEnd', () => {
    const pastStart = new Date();
    pastStart.setDate(pastStart.getDate() - 14);
    const pastEnd = new Date();
    pastEnd.setDate(pastEnd.getDate() - 7);
    expect(getTournamentStatus({
      regStart: pastStart.toISOString(),
      regEnd: pastEnd.toISOString(),
    })).toBe('已截止報名');
  });
});

describe('isTournamentEnded', () => {
  test('returns false for null/undefined', () => {
    expect(isTournamentEnded(null)).toBe(false);
    expect(isTournamentEnded(undefined)).toBe(false);
  });

  test('returns true when ended flag is true', () => {
    expect(isTournamentEnded({ ended: true })).toBe(true);
  });

  test('returns false when ended flag is false with no matchDates', () => {
    expect(isTournamentEnded({ ended: false })).toBe(false);
  });

  test('returns false when matchDates is empty', () => {
    expect(isTournamentEnded({ matchDates: [] })).toBe(false);
  });

  test('returns false when matchDates has invalid date', () => {
    expect(isTournamentEnded({ matchDates: ['not-a-date'] })).toBe(false);
  });

  test('returns true when last matchDate + 24h is in the past', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 3);
    expect(isTournamentEnded({ matchDates: [oldDate.toISOString()] })).toBe(true);
  });

  test('returns false when last matchDate + 24h is in the future', () => {
    const recent = new Date();
    recent.setHours(recent.getHours() - 12); // within 24h window
    expect(isTournamentEnded({ matchDates: [recent.toISOString()] })).toBe(false);
  });

  test('uses the last element of matchDates', () => {
    const old = new Date();
    old.setDate(old.getDate() - 10);
    const future = new Date();
    future.setDate(future.getDate() + 5);
    expect(isTournamentEnded({ matchDates: [old.toISOString(), future.toISOString()] })).toBe(false);
  });
});

describe('_getTournamentMode', () => {
  test('defaults to friendly for null/undefined', () => {
    expect(_getTournamentMode(null)).toBe('friendly');
    expect(_getTournamentMode(undefined)).toBe('friendly');
    expect(_getTournamentMode({})).toBe('friendly');
  });

  test('detects cup mode', () => {
    expect(_getTournamentMode({ mode: 'cup' })).toBe('cup');
    expect(_getTournamentMode({ mode: 'Cup' })).toBe('cup');
    expect(_getTournamentMode({ type: '盃賽' })).toBe('cup');
    expect(_getTournamentMode({ typeCode: '杯賽' })).toBe('cup');
  });

  test('detects league mode', () => {
    expect(_getTournamentMode({ mode: 'league' })).toBe('league');
    expect(_getTournamentMode({ mode: 'League' })).toBe('league');
    expect(_getTournamentMode({ type: '聯賽' })).toBe('league');
    expect(_getTournamentMode({ typeCode: '联赛' })).toBe('league');
  });

  test('detects friendly mode', () => {
    expect(_getTournamentMode({ mode: 'friendly' })).toBe('friendly');
    expect(_getTournamentMode({ type: '友誼賽' })).toBe('friendly');
  });

  test('falls back to friendly for unknown modes', () => {
    expect(_getTournamentMode({ mode: 'unknown' })).toBe('friendly');
    expect(_getTournamentMode({ mode: '  ' })).toBe('friendly');
  });

  test('priority: mode > typeCode > type', () => {
    expect(_getTournamentMode({ mode: 'cup', typeCode: 'league', type: 'friendly' })).toBe('cup');
    expect(_getTournamentMode({ typeCode: 'league', type: 'friendly' })).toBe('league');
  });
});

describe('_sanitizeFriendlyTournamentTeamLimit', () => {
  test('clamps to [2, 4] range', () => {
    expect(_sanitizeFriendlyTournamentTeamLimit(1)).toBe(2);
    expect(_sanitizeFriendlyTournamentTeamLimit(2)).toBe(2);
    expect(_sanitizeFriendlyTournamentTeamLimit(3)).toBe(3);
    expect(_sanitizeFriendlyTournamentTeamLimit(4)).toBe(4);
    expect(_sanitizeFriendlyTournamentTeamLimit(5)).toBe(4);
    expect(_sanitizeFriendlyTournamentTeamLimit(100)).toBe(4);
  });

  test('floors decimal values', () => {
    expect(_sanitizeFriendlyTournamentTeamLimit(3.7)).toBe(3);
    expect(_sanitizeFriendlyTournamentTeamLimit(2.9)).toBe(2);
  });

  test('returns fallback for non-finite values', () => {
    expect(_sanitizeFriendlyTournamentTeamLimit(NaN)).toBe(4);
    expect(_sanitizeFriendlyTournamentTeamLimit(Infinity)).toBe(4);
    expect(_sanitizeFriendlyTournamentTeamLimit('abc')).toBe(4);
  });

  test('respects custom fallback', () => {
    expect(_sanitizeFriendlyTournamentTeamLimit(NaN, 3)).toBe(3);
    expect(_sanitizeFriendlyTournamentTeamLimit('abc', 2)).toBe(2);
  });

  test('handles string numbers', () => {
    expect(_sanitizeFriendlyTournamentTeamLimit('3')).toBe(3);
    expect(_sanitizeFriendlyTournamentTeamLimit('0')).toBe(2);
  });
});

describe('_buildTournamentOrganizerDisplay', () => {
  test('returns combined format when both provided', () => {
    expect(_buildTournamentOrganizerDisplay('Team A', 'User B')).toBe('Team A（User B）');
  });

  test('returns team name only when user empty', () => {
    expect(_buildTournamentOrganizerDisplay('Team A', '')).toBe('Team A');
    expect(_buildTournamentOrganizerDisplay('Team A', null)).toBe('Team A');
  });

  test('returns user name only when team empty', () => {
    expect(_buildTournamentOrganizerDisplay('', 'User B')).toBe('User B');
    expect(_buildTournamentOrganizerDisplay(null, 'User B')).toBe('User B');
  });

  test('returns fallback when both empty', () => {
    expect(_buildTournamentOrganizerDisplay('', '')).toBe('主辦俱樂部');
    expect(_buildTournamentOrganizerDisplay(null, null)).toBe('主辦俱樂部');
    expect(_buildTournamentOrganizerDisplay(undefined, undefined)).toBe('主辦俱樂部');
  });

  test('trims whitespace', () => {
    expect(_buildTournamentOrganizerDisplay('  Team  ', '  User  ')).toBe('Team（User）');
    expect(_buildTournamentOrganizerDisplay('  ', '  ')).toBe('主辦俱樂部');
  });
});

describe('_getTournamentOrganizerDisplayText', () => {
  test('returns fallback for null tournament', () => {
    expect(_getTournamentOrganizerDisplayText(null)).toBe('主辦俱樂部');
  });

  test('returns organizerDisplay when set', () => {
    expect(_getTournamentOrganizerDisplayText({ organizerDisplay: 'Custom Display' })).toBe('Custom Display');
  });

  test('builds from hostTeamName + organizer', () => {
    expect(_getTournamentOrganizerDisplayText({
      hostTeamName: 'FC Barcelona',
      organizer: 'Coach A',
    })).toBe('FC Barcelona（Coach A）');
  });

  test('falls back to creatorName', () => {
    expect(_getTournamentOrganizerDisplayText({
      creatorName: 'Admin',
    })).toBe('Admin');
  });
});

describe('_normalizeTournamentDelegates', () => {
  test('returns empty array for non-array input', () => {
    expect(_normalizeTournamentDelegates(null)).toEqual([]);
    expect(_normalizeTournamentDelegates(undefined)).toEqual([]);
    expect(_normalizeTournamentDelegates('string')).toEqual([]);
  });

  test('normalizes delegates', () => {
    const result = _normalizeTournamentDelegates([
      { uid: 'u1', name: 'Alice' },
      { uid: 'u2', name: 'Bob' },
    ]);
    expect(result).toEqual([
      { uid: 'u1', name: 'Alice' },
      { uid: 'u2', name: 'Bob' },
    ]);
  });

  test('deduplicates by uid', () => {
    const result = _normalizeTournamentDelegates([
      { uid: 'u1', name: 'Alice' },
      { uid: 'u1', name: 'Alice duplicate' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alice');
  });

  test('deduplicates by name when uid empty', () => {
    const result = _normalizeTournamentDelegates([
      { name: 'Alice' },
      { name: 'Alice' },
    ]);
    expect(result).toHaveLength(1);
  });

  test('skips entries with no uid or name', () => {
    const result = _normalizeTournamentDelegates([
      { uid: '', name: '' },
      { uid: 'u1', name: 'Valid' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe('u1');
  });
});

describe('_getTournamentDelegateUids', () => {
  test('merges delegateUids and delegates', () => {
    const result = _getTournamentDelegateUids({
      delegateUids: ['u1', 'u2'],
      delegates: [{ uid: 'u3', name: 'C' }],
    });
    expect(result).toEqual(['u1', 'u2', 'u3']);
  });

  test('deduplicates across both sources', () => {
    const result = _getTournamentDelegateUids({
      delegateUids: ['u1', 'u2'],
      delegates: [{ uid: 'u1', name: 'A' }, { uid: 'u3', name: 'C' }],
    });
    expect(result).toEqual(['u1', 'u2', 'u3']);
  });

  test('handles missing delegateUids', () => {
    const result = _getTournamentDelegateUids({
      delegates: [{ uid: 'u1', name: 'A' }],
    });
    expect(result).toEqual(['u1']);
  });

  test('skips empty uids', () => {
    const result = _getTournamentDelegateUids({
      delegateUids: ['', 'u1', '  '],
      delegates: [{ uid: '', name: 'nouid' }],
    });
    expect(result).toEqual(['u1']);
  });
});

describe('_isTournamentLeaderForTeam', () => {
  test('returns false for null inputs', () => {
    expect(_isTournamentLeaderForTeam(null, { uid: 'u1' })).toBe(false);
    expect(_isTournamentLeaderForTeam({ id: 't1' }, null)).toBe(false);
  });

  test('matches by leaderUids array', () => {
    expect(_isTournamentLeaderForTeam(
      { leaderUids: ['u1', 'u2'] },
      { uid: 'u1' }
    )).toBe(true);
  });

  test('matches by single leaderUid', () => {
    expect(_isTournamentLeaderForTeam(
      { leaderUid: 'u1' },
      { uid: 'u1' }
    )).toBe(true);
  });

  test('matches by leader displayName', () => {
    expect(_isTournamentLeaderForTeam(
      { leader: 'Alice' },
      { displayName: 'Alice' }
    )).toBe(true);
  });

  test('returns false when no match', () => {
    expect(_isTournamentLeaderForTeam(
      { leaderUids: ['u2'], leader: 'Bob' },
      { uid: 'u1', displayName: 'Alice' }
    )).toBe(false);
  });
});

describe('_isTournamentCaptainForTeam', () => {
  test('returns false for null inputs', () => {
    expect(_isTournamentCaptainForTeam(null, { uid: 'u1' })).toBe(false);
    expect(_isTournamentCaptainForTeam({ id: 't1' }, null)).toBe(false);
  });

  test('matches by captainUid', () => {
    expect(_isTournamentCaptainForTeam(
      { captainUid: 'u1' },
      { uid: 'u1' }
    )).toBe(true);
  });

  test('matches by captain displayName', () => {
    expect(_isTournamentCaptainForTeam(
      { captain: 'Alice' },
      { displayName: 'Alice' }
    )).toBe(true);
  });

  test('uses name fallback when displayName missing', () => {
    expect(_isTournamentCaptainForTeam(
      { captain: 'Alice' },
      { name: 'Alice' }
    )).toBe(true);
  });

  test('returns false when no match', () => {
    expect(_isTournamentCaptainForTeam(
      { captainUid: 'u2', captain: 'Bob' },
      { uid: 'u1', displayName: 'Alice' }
    )).toBe(false);
  });
});

describe('_buildFriendlyTournamentApplicationRecord', () => {
  test('returns default values for empty input', () => {
    const result = _buildFriendlyTournamentApplicationRecord({});
    expect(result.id).toBe('');
    expect(result.status).toBe('pending');
    expect(result.appliedAt).toBe(null);
    expect(result.reviewedAt).toBe(null);
  });

  test('normalizes all string fields', () => {
    const result = _buildFriendlyTournamentApplicationRecord({
      id: 'app1',
      teamId: 'team1',
      teamName: 'FC Test',
      status: ' Approved ',
      requestedByUid: 'u1',
    });
    expect(result.id).toBe('app1');
    expect(result.teamId).toBe('team1');
    expect(result.teamName).toBe('FC Test');
    expect(result.status).toBe('approved');
    expect(result.requestedByUid).toBe('u1');
  });

  test('falls back to _docId for id', () => {
    const result = _buildFriendlyTournamentApplicationRecord({ _docId: 'doc123' });
    expect(result.id).toBe('doc123');
  });

  test('falls back to creatorUid for requestedByUid', () => {
    const result = _buildFriendlyTournamentApplicationRecord({ creatorUid: 'cu1' });
    expect(result.requestedByUid).toBe('cu1');
  });
});

describe('_buildFriendlyTournamentRosterMemberRecord', () => {
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
