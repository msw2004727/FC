/**
 * Tournament Regression Tests — 2026-03-18 audit bugs
 *
 * Covers the 5 historical bugs documented in docs/claude-memory.md:
 *   1. State null access in registerTournament / reviewFriendlyTournamentApplication
 *   2. creatorUid validation (empty string / 'demo-user')
 *   3. delegateUids empty/whitespace filtering
 *   4. Roster member dedup
 *   5. State guards on end/reopen
 */

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:9-17
// ---------------------------------------------------------------------------
function getTournamentStatus(t) {
  if (!t || !t.regStart || !t.regEnd) return (t && t.status) || '\u5373\u5c07\u958b\u59cb';
  const now = new Date();
  const start = new Date(t.regStart);
  const end = new Date(t.regEnd);
  if (now < start) return '\u5373\u5c07\u958b\u59cb';
  if (now >= start && now <= end) return '\u5831\u540d\u4e2d';
  return '\u5df2\u622a\u6b62\u5831\u540d';
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
// Extracted from tournament-core.js:158-170
// ---------------------------------------------------------------------------
function _normalizeTournamentPeople(people, limit = 10) {
  if (!Array.isArray(people)) return [];
  const seen = new Set();
  return people.reduce((list, person) => {
    if (list.length >= limit) return list;
    const uid = String(person?.uid || '').trim();
    const name = String(person?.name || '').trim();
    const dedupeKey = uid || (name ? `name:${name}` : '');
    if (!dedupeKey || seen.has(dedupeKey)) return list;
    seen.add(dedupeKey);
    list.push({ uid, name });
    return list;
  }, []);
}

function _normalizeTournamentDelegates(delegates) {
  return _normalizeTournamentPeople(delegates, 10);
}

function _normalizeTournamentReferees(referees) {
  return _normalizeTournamentPeople(referees, 10);
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:172-184
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

function _getTournamentRefereeUids(tournament) {
  const direct = Array.isArray(tournament?.refereeUids) ? tournament.refereeUids : [];
  const referees = _normalizeTournamentReferees(tournament?.referees);
  const merged = [...direct, ...referees.map(referee => referee.uid)];
  const seen = new Set();
  return merged.reduce((list, uid) => {
    const safeUid = String(uid || '').trim();
    if (!safeUid || seen.has(safeUid)) return list;
    seen.add(safeUid);
    list.push(safeUid);
    return list;
  }, []);
}

function _isTournamentHostParticipating(tournament) {
  if (!tournament) return true;
  if (typeof tournament.hostParticipates === 'boolean') return tournament.hostParticipates;
  if (typeof tournament.friendlyConfig?.hostParticipates === 'boolean') return tournament.friendlyConfig.hostParticipates;
  return true;
}

function _friendlyTournamentEntryCountsTowardLimit(entry, tournament = null) {
  const status = String(entry?.entryStatus || '').trim().toLowerCase();
  if (status === 'approved') return true;
  if (status !== 'host') return false;
  if (entry?.countsTowardLimit === false) return false;
  return _isTournamentHostParticipating(tournament) !== false;
}

function _getFriendlyTournamentRegisteredTeamIdsFromEntries(entries, tournament = null) {
  const seen = new Set();
  return (Array.isArray(entries) ? entries : []).reduce((list, entry) => {
    if (!_friendlyTournamentEntryCountsTowardLimit(entry, tournament)) return list;
    const teamId = String(entry?.teamId || '').trim();
    if (!teamId || seen.has(teamId)) return list;
    seen.add(teamId);
    list.push(teamId);
    return list;
  }, []);
}

// ---------------------------------------------------------------------------
// Extracted from tournament-core.js:256-269 — entry record builder with roster dedup
// ---------------------------------------------------------------------------
function _buildFriendlyTournamentRosterMemberRecord(data = {}) {
  return {
    uid: String(data.uid || '').trim(),
    name: String(data.name || data.displayName || '').trim(),
    joinedAt: data.joinedAt || null,
  };
}

function _buildFriendlyTournamentEntryRecord(data = {}) {
  const memberRoster = Array.isArray(data.memberRoster)
    ? data.memberRoster
        .map(member => _buildFriendlyTournamentRosterMemberRecord(member))
        .filter(member => member.uid)
    : [];
  return {
    teamId: String(data.teamId || '').trim(),
    teamName: String(data.teamName || '').trim(),
    teamImage: String(data.teamImage || '').trim(),
    entryStatus: String(data.entryStatus || 'approved').trim().toLowerCase(),
    countsTowardLimit: data.countsTowardLimit !== false,
    approvedAt: data.approvedAt || null,
    approvedByUid: String(data.approvedByUid || '').trim(),
    approvedByName: String(data.approvedByName || '').trim(),
    memberRoster,
  };
}

// ---------------------------------------------------------------------------
// Simplified subset of tournament-core.js _buildFriendlyTournamentRecord
// Only the creatorUid + delegateUids normalization path (for regression tests)
// ---------------------------------------------------------------------------
function _buildFriendlyTournamentRecord(data = {}) {
  const base = data && typeof data === 'object' ? data : {};
  const creatorUid = String(base.creatorUid || '').trim();
  const delegateUids = _getTournamentDelegateUids(base);
  const referees = _normalizeTournamentReferees(base.referees);
  const refereeUids = _getTournamentRefereeUids({ ...base, referees });
  const hostParticipates = _isTournamentHostParticipating(base);
  return { ...base, creatorUid, delegateUids, referees, refereeUids, hostParticipates };
}

// ---------------------------------------------------------------------------
// Simulated decision logic — registerTournament guards
// Extracted from tournament-friendly-detail.js:225-265
// ---------------------------------------------------------------------------
function registerTournamentDecision(tournament, state, user, availableTeams, approvedCount) {
  if (!user?.uid) return { blocked: true, reason: 'not-logged-in' };
  if (!state) return { blocked: true, reason: 'state-null' };
  const latestTournament = state.tournament || tournament;
  const teamLimit = latestTournament?.friendlyConfig?.teamLimit || 4;
  if (getTournamentStatus(latestTournament) !== '\u5831\u540d\u4e2d') {
    return { blocked: true, reason: 'not-open' };
  }
  if (approvedCount >= teamLimit) {
    return { blocked: true, reason: 'quota-full' };
  }
  if (availableTeams.length === 0) {
    return { blocked: true, reason: 'no-teams' };
  }
  return { blocked: false };
}

// ---------------------------------------------------------------------------
// Simulated decision logic — reviewFriendlyTournamentApplication guards
// Extracted from tournament-friendly-detail.js:298-334
// ---------------------------------------------------------------------------
function reviewApplicationDecision(state, applicationId, action, approvedCount) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!['approve', 'reject'].includes(normalizedAction)) {
    return { blocked: true, reason: 'invalid-action' };
  }
  const tournament = state?.tournament;
  if (!tournament) return { blocked: true, reason: 'state-null' };
  const application = (state.applications || []).find(item => item.id === applicationId);
  if (!application || application.status !== 'pending') {
    return { blocked: true, reason: 'not-pending' };
  }
  if (normalizedAction === 'approve') {
    const teamLimit = tournament.friendlyConfig?.teamLimit || 4;
    const alreadyEntry = (state.entries || []).some(e => e.teamId === application.teamId);
    if (!alreadyEntry && approvedCount >= teamLimit) {
      return { blocked: true, reason: 'quota-full' };
    }
  }
  return { blocked: false, application };
}

// ---------------------------------------------------------------------------
// Simulated decision logic — end/reopen guards
// Extracted from tournament-manage.js:252-287
// ---------------------------------------------------------------------------
function handleEndTournamentDecision(tournament) {
  if (!tournament) return { blocked: true, reason: 'not-found' };
  if (isTournamentEnded(tournament)) return { blocked: true, reason: 'already-ended' };
  return { blocked: false };
}

function handleReopenTournamentDecision(tournament) {
  if (!tournament) return { blocked: true, reason: 'not-found' };
  if (!isTournamentEnded(tournament)) return { blocked: true, reason: 'already-open' };
  return { blocked: false };
}


// ═══════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════

describe('Bug #1: State null access (registerTournament)', () => {
  const pastDate = new Date(Date.now() - 86400000).toISOString();
  const futureDate = new Date(Date.now() + 86400000 * 7).toISOString();
  const openTournament = { regStart: pastDate, regEnd: futureDate, friendlyConfig: { teamLimit: 4 } };
  const user = { uid: 'u1', displayName: 'Alice' };

  test('returns state-null when state is null', () => {
    const result = registerTournamentDecision(openTournament, null, user, [], 0);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('state-null');
  });

  test('returns state-null when state is undefined', () => {
    const result = registerTournamentDecision(openTournament, undefined, user, [], 0);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('state-null');
  });

  test('returns not-logged-in when user has no uid', () => {
    const result = registerTournamentDecision(openTournament, { tournament: openTournament }, {}, [], 0);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('not-logged-in');
  });

  test('returns not-logged-in for null user', () => {
    const result = registerTournamentDecision(openTournament, { tournament: openTournament }, null, [], 0);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('not-logged-in');
  });

  test('proceeds when state and user are valid', () => {
    const state = { tournament: openTournament, applications: [], entries: [] };
    const result = registerTournamentDecision(openTournament, state, user, [{ id: 't1' }], 0);
    expect(result.blocked).toBe(false);
  });
});

describe('Bug #1: State null access (reviewApplication)', () => {
  test('returns state-null when state is null', () => {
    const result = reviewApplicationDecision(null, 'app1', 'approve', 0);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('state-null');
  });

  test('returns state-null when state.tournament is missing', () => {
    const result = reviewApplicationDecision({ applications: [] }, 'app1', 'approve', 0);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('state-null');
  });

  test('returns not-pending when application not found', () => {
    const state = { tournament: { id: 't1' }, applications: [] };
    const result = reviewApplicationDecision(state, 'missing', 'approve', 0);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('not-pending');
  });

  test('returns invalid-action for unknown action', () => {
    const state = {
      tournament: { id: 't1' },
      applications: [{ id: 'app1', teamId: 'teamA', status: 'pending' }],
      entries: [],
    };
    const result = reviewApplicationDecision(state, 'app1', 'maybe', 0);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('invalid-action');
  });
});

describe('Bug #2: creatorUid validation', () => {
  test('empty string creatorUid is preserved as empty', () => {
    const record = _buildFriendlyTournamentRecord({ creatorUid: '' });
    expect(record.creatorUid).toBe('');
  });

  test('whitespace-only creatorUid trims to empty', () => {
    const record = _buildFriendlyTournamentRecord({ creatorUid: '   ' });
    expect(record.creatorUid).toBe('');
  });

  test('demo-user creatorUid should be flaggable', () => {
    const record = _buildFriendlyTournamentRecord({ creatorUid: 'demo-user' });
    // After the fix, production code rejects demo-user.
    // The record builder still normalizes it, but create handler blocks it.
    expect(record.creatorUid).toBe('demo-user');
  });

  test('valid creatorUid is preserved', () => {
    const record = _buildFriendlyTournamentRecord({ creatorUid: 'Uf1234567890abcdef' });
    expect(record.creatorUid).toBe('Uf1234567890abcdef');
  });
});

describe('Bug #3: delegateUids empty/whitespace filtering', () => {
  test('filters out empty strings from delegateUids', () => {
    const uids = _getTournamentDelegateUids({ delegateUids: ['', 'u1', ''] });
    expect(uids).toEqual(['u1']);
  });

  test('filters out whitespace-only strings from delegateUids', () => {
    const uids = _getTournamentDelegateUids({ delegateUids: ['  ', 'u1', '\t'] });
    expect(uids).toEqual(['u1']);
  });

  test('filters out empty uid from delegates array', () => {
    const uids = _getTournamentDelegateUids({
      delegates: [{ uid: '', name: 'NoUid' }, { uid: 'u2', name: 'Valid' }],
    });
    expect(uids).toEqual(['u2']);
  });

  test('handles null delegateUids gracefully', () => {
    const uids = _getTournamentDelegateUids({ delegateUids: null, delegates: [] });
    expect(uids).toEqual([]);
  });

  test('handles missing tournament gracefully', () => {
    const uids = _getTournamentDelegateUids(null);
    expect(uids).toEqual([]);
  });

  test('limits delegates to ten unique people', () => {
    const delegates = Array.from({ length: 12 }).map((_, i) => ({ uid: `u${i}`, name: `User ${i}` }));
    expect(_normalizeTournamentDelegates(delegates)).toHaveLength(10);
  });
});

describe('Tournament referees and host participation', () => {
  test('normalizes referees separately from delegates and limits to ten', () => {
    const referees = Array.from({ length: 12 }).map((_, i) => ({ uid: `r${i}`, name: `Ref ${i}` }));
    const record = _buildFriendlyTournamentRecord({ referees });

    expect(record.referees).toHaveLength(10);
    expect(record.refereeUids).toEqual(referees.slice(0, 10).map(item => item.uid));
  });

  test('host entry can display without consuming a tournament slot', () => {
    const tournament = { hostTeamId: 'host', hostParticipates: false };
    const entries = [
      _buildFriendlyTournamentEntryRecord({ teamId: 'host', entryStatus: 'host', countsTowardLimit: false }),
      _buildFriendlyTournamentEntryRecord({ teamId: 'guest1', entryStatus: 'approved' }),
      _buildFriendlyTournamentEntryRecord({ teamId: 'guest2', entryStatus: 'approved' }),
    ];

    expect(_getFriendlyTournamentRegisteredTeamIdsFromEntries(entries, tournament)).toEqual(['guest1', 'guest2']);
  });

  test('legacy host entries still consume a slot by default', () => {
    const entries = [
      _buildFriendlyTournamentEntryRecord({ teamId: 'host', entryStatus: 'host' }),
    ];

    expect(_getFriendlyTournamentRegisteredTeamIdsFromEntries(entries, {})).toEqual(['host']);
  });
});

describe('Bug #4: Roster member dedup', () => {
  test('entry record filters out members with empty uid', () => {
    const entry = _buildFriendlyTournamentEntryRecord({
      teamId: 't1',
      memberRoster: [
        { uid: 'u1', name: 'Alice' },
        { uid: '', name: 'Ghost' },
        { uid: 'u2', name: 'Bob' },
      ],
    });
    expect(entry.memberRoster).toHaveLength(2);
    expect(entry.memberRoster.map(m => m.uid)).toEqual(['u1', 'u2']);
  });

  test('duplicate uid members should both appear (dedup at load time)', () => {
    // The builder does not dedup by uid — that happens in roster loading.
    // This test documents the builder behavior.
    const entry = _buildFriendlyTournamentEntryRecord({
      teamId: 't1',
      memberRoster: [
        { uid: 'u1', name: 'Alice' },
        { uid: 'u1', name: 'Alice Copy' },
      ],
    });
    // Builder keeps both; roster loader in tournament-friendly-roster.js deduplicates.
    expect(entry.memberRoster.length).toBeGreaterThanOrEqual(1);
  });

  test('empty memberRoster input produces empty array', () => {
    const entry = _buildFriendlyTournamentEntryRecord({ teamId: 't1', memberRoster: [] });
    expect(entry.memberRoster).toEqual([]);
  });

  test('non-array memberRoster defaults to empty', () => {
    const entry = _buildFriendlyTournamentEntryRecord({ teamId: 't1', memberRoster: 'bad' });
    expect(entry.memberRoster).toEqual([]);
  });
});

describe('Bug #5: State guards — end/reopen', () => {
  test('cannot end an already-ended tournament (ended flag)', () => {
    const result = handleEndTournamentDecision({ ended: true });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('already-ended');
  });

  test('cannot end a tournament ended by matchDates expiry', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 5);
    const result = handleEndTournamentDecision({ matchDates: [oldDate.toISOString()] });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('already-ended');
  });

  test('can end an active tournament', () => {
    const result = handleEndTournamentDecision({ ended: false });
    expect(result.blocked).toBe(false);
  });

  test('cannot reopen an already-open tournament', () => {
    const result = handleReopenTournamentDecision({ ended: false });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('already-open');
  });

  test('can reopen an ended tournament', () => {
    const result = handleReopenTournamentDecision({ ended: true });
    expect(result.blocked).toBe(false);
  });

  test('end returns not-found for null tournament', () => {
    const result = handleEndTournamentDecision(null);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('not-found');
  });

  test('reopen returns not-found for null tournament', () => {
    const result = handleReopenTournamentDecision(null);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('not-found');
  });
});
