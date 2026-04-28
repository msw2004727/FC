/**
 * Tournament CRUD Decision Logic — unit tests
 *
 * Extracted decision logic from:
 *   - tournament-friendly-detail.js (registerTournament, reviewFriendlyTournamentApplication)
 *   - tournament-manage.js (handleEndTournament, handleReopenTournament)
 *
 * Tests pure decision functions without Firestore calls.
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
// Extracted from tournament-core.js:238-253
// ---------------------------------------------------------------------------
function _buildFriendlyTournamentApplicationRecord(data = {}) {
  return {
    id: String(data.id || data._docId || data.teamId || '').trim(),
    teamId: String(data.teamId || '').trim(),
    teamName: String(data.teamName || '').trim(),
    teamImage: String(data.teamImage || '').trim(),
    status: String(data.status || 'pending').trim().toLowerCase(),
    requestedByUid: String(data.requestedByUid || data.creatorUid || '').trim(),
    requestedByName: String(data.requestedByName || data.creatorName || '').trim(),
    appliedAt: data.appliedAt || null,
    reviewedAt: data.reviewedAt || null,
    reviewedByUid: String(data.reviewedByUid || '').trim(),
    reviewedByName: String(data.reviewedByName || '').trim(),
    messageGroupId: String(data.messageGroupId || '').trim(),
  };
}

// ---------------------------------------------------------------------------
// Registration decision — extracted from tournament-friendly-detail.js:225-265
// ---------------------------------------------------------------------------
function registerDecision({ tournament, state, user, availableTeams }) {
  if (!user?.uid) return { ok: false, reason: 'not-logged-in' };
  if (!state) return { ok: false, reason: 'state-null' };

  const latest = state.tournament || tournament;
  const teamLimit = latest?.friendlyConfig?.teamLimit || 4;
  const approvedCount = (state.entries || [])
    .filter(e => e.entryStatus === 'host' || e.entryStatus === 'approved').length;

  if (getTournamentStatus(latest) !== '\u5831\u540d\u4e2d') {
    return { ok: false, reason: 'not-open' };
  }
  if (approvedCount >= teamLimit) {
    return { ok: false, reason: 'quota-full' };
  }
  if ((availableTeams || []).length === 0) {
    return { ok: false, reason: 'no-teams' };
  }
  return { ok: true, approvedCount, teamLimit };
}

// ---------------------------------------------------------------------------
// Duplicate team detection — extracted from tournament-friendly-detail.js:162-176
// ---------------------------------------------------------------------------
function getApplyContext(tournament, state, userTeamIds) {
  const applicationsByTeam = new Map((state?.applications || []).map(a => [a.teamId, a]));
  const entriesByTeam = new Map((state?.entries || []).map(e => [e.teamId, e]));
  const availableTeams = (userTeamIds || []).filter(id =>
    id !== tournament.hostTeamId && !applicationsByTeam.has(id) && !entriesByTeam.has(id)
  );
  const pendingTeams = (state?.applications || [])
    .filter(a => userTeamIds.includes(a.teamId) && a.status === 'pending');
  return { availableTeams, pendingTeams, applicationsByTeam };
}

// ---------------------------------------------------------------------------
// Review decision — extracted from tournament-friendly-detail.js:298-344
// ---------------------------------------------------------------------------
function reviewDecision({ state, applicationId, action }) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!['approve', 'reject'].includes(normalizedAction)) {
    return { ok: false, reason: 'invalid-action' };
  }
  const tournament = state?.tournament;
  if (!tournament) return { ok: false, reason: 'state-null' };

  const application = (state.applications || []).find(a => a.id === applicationId);
  if (!application || application.status !== 'pending') {
    return { ok: false, reason: 'not-pending' };
  }

  if (normalizedAction === 'approve') {
    const approvedCount = (state.entries || [])
      .filter(e => e.entryStatus === 'host' || e.entryStatus === 'approved').length;
    const teamLimit = tournament.friendlyConfig?.teamLimit || 4;
    const alreadyEntry = (state.entries || []).some(e => e.teamId === application.teamId);
    if (!alreadyEntry && approvedCount >= teamLimit) {
      return { ok: false, reason: 'quota-full' };
    }
    return {
      ok: true,
      action: 'approve',
      entry: {
        teamId: application.teamId,
        teamName: application.teamName,
        entryStatus: 'approved',
      },
      reviewMeta: { status: 'approved' },
    };
  }

  return {
    ok: true,
    action: 'reject',
    reviewMeta: { status: 'rejected' },
  };
}

// ---------------------------------------------------------------------------
// End/Reopen decision — extracted from tournament-manage.js:252-287
// ---------------------------------------------------------------------------
function endDecision(tournament) {
  if (!tournament) return { ok: false, reason: 'not-found' };
  if (isTournamentEnded(tournament)) return { ok: false, reason: 'already-ended' };
  return { ok: true, update: { ended: true } };
}

function reopenDecision(tournament) {
  if (!tournament) return { ok: false, reason: 'not-found' };
  if (!isTournamentEnded(tournament)) return { ok: false, reason: 'already-open' };
  return { ok: true, update: { ended: false } };
}


// ═══════════════════════════════════════════════════════
//  Test Helpers
// ═══════════════════════════════════════════════════════

const pastDate = new Date(Date.now() - 86400000).toISOString();
const futureDate = new Date(Date.now() + 86400000 * 7).toISOString();

function makeOpenTournament(overrides = {}) {
  return {
    id: 't1',
    regStart: pastDate,
    regEnd: futureDate,
    hostTeamId: 'host1',
    friendlyConfig: { teamLimit: 4 },
    ...overrides,
  };
}

function makeState(overrides = {}) {
  const tournament = overrides.tournament || makeOpenTournament();
  return {
    tournament,
    applications: overrides.applications || [],
    entries: overrides.entries || [],
  };
}

const user = { uid: 'u1', displayName: 'Alice' };


// ═══════════════════════════════════════════════════════
//  Tests — Registration
// ═══════════════════════════════════════════════════════

describe('registerDecision — status checks', () => {
  test('cannot register when status is not open', () => {
    const farFuture = new Date(Date.now() + 86400000 * 30).toISOString();
    const tournament = makeOpenTournament({ regStart: farFuture });
    const state = makeState({ tournament });
    const result = registerDecision({ tournament, state, user, availableTeams: ['t1'] });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-open');
  });

  test('cannot register when quota is full', () => {
    const tournament = makeOpenTournament({ friendlyConfig: { teamLimit: 2 } });
    const entries = [
      { teamId: 'host1', entryStatus: 'host' },
      { teamId: 'team2', entryStatus: 'approved' },
    ];
    const state = makeState({ tournament, entries });
    const result = registerDecision({ tournament, state, user, availableTeams: ['t3'] });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('quota-full');
  });

  test('cannot register when no available teams', () => {
    const state = makeState();
    const result = registerDecision({ tournament: state.tournament, state, user, availableTeams: [] });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-teams');
  });

  test('can register when open, below limit, has teams', () => {
    const state = makeState();
    const result = registerDecision({ tournament: state.tournament, state, user, availableTeams: ['myTeam'] });
    expect(result.ok).toBe(true);
  });
});

describe('getApplyContext — duplicate team detection', () => {
  test('team already applied is excluded from available', () => {
    const tournament = makeOpenTournament();
    const state = makeState({
      applications: [{ teamId: 'myTeam', status: 'pending' }],
    });
    const ctx = getApplyContext(tournament, state, ['myTeam']);
    expect(ctx.availableTeams).toEqual([]);
    expect(ctx.pendingTeams).toHaveLength(1);
  });

  test('team already entry is excluded from available', () => {
    const tournament = makeOpenTournament();
    const state = makeState({
      entries: [{ teamId: 'myTeam', entryStatus: 'approved' }],
    });
    const ctx = getApplyContext(tournament, state, ['myTeam']);
    expect(ctx.availableTeams).toEqual([]);
  });

  test('host team is excluded from available', () => {
    const tournament = makeOpenTournament({ hostTeamId: 'myTeam' });
    const state = makeState({ tournament });
    const ctx = getApplyContext(tournament, state, ['myTeam']);
    expect(ctx.availableTeams).toEqual([]);
  });

  test('unrelated team remains available', () => {
    const tournament = makeOpenTournament();
    const state = makeState();
    const ctx = getApplyContext(tournament, state, ['newTeam']);
    expect(ctx.availableTeams).toEqual(['newTeam']);
  });
});


// ═══════════════════════════════════════════════════════
//  Tests — Review
// ═══════════════════════════════════════════════════════

describe('reviewDecision — approval', () => {
  test('cannot approve when quota is full', () => {
    const tournament = makeOpenTournament({ friendlyConfig: { teamLimit: 2 } });
    const state = makeState({
      tournament,
      applications: [{ id: 'app1', teamId: 'team3', status: 'pending' }],
      entries: [
        { teamId: 'host1', entryStatus: 'host' },
        { teamId: 'team2', entryStatus: 'approved' },
      ],
    });
    const result = reviewDecision({ state, applicationId: 'app1', action: 'approve' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('quota-full');
  });

  test('cannot review non-pending application', () => {
    const state = makeState({
      applications: [{ id: 'app1', teamId: 'team3', status: 'approved' }],
    });
    const result = reviewDecision({ state, applicationId: 'app1', action: 'approve' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-pending');
  });

  test('cannot review missing application', () => {
    const state = makeState({ applications: [] });
    const result = reviewDecision({ state, applicationId: 'missing', action: 'approve' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-pending');
  });

  test('approve creates entry record data', () => {
    const state = makeState({
      applications: [{ id: 'app1', teamId: 'team3', teamName: 'FC Gamma', status: 'pending' }],
    });
    const result = reviewDecision({ state, applicationId: 'app1', action: 'approve' });
    expect(result.ok).toBe(true);
    expect(result.action).toBe('approve');
    expect(result.entry.teamId).toBe('team3');
    expect(result.entry.entryStatus).toBe('approved');
    expect(result.reviewMeta.status).toBe('approved');
  });

  test('approve allowed when team already has entry (idempotent)', () => {
    const state = makeState({
      applications: [{ id: 'app1', teamId: 'team3', status: 'pending' }],
      entries: [
        { teamId: 'host1', entryStatus: 'host' },
        { teamId: 'team3', entryStatus: 'approved' },
      ],
    });
    // teamLimit = 4, approvedCount = 2, but team3 already has entry so quota check skipped
    const result = reviewDecision({ state, applicationId: 'app1', action: 'approve' });
    expect(result.ok).toBe(true);
  });
});

describe('reviewDecision — rejection', () => {
  test('reject updates application status', () => {
    const state = makeState({
      applications: [{ id: 'app1', teamId: 'team3', status: 'pending' }],
    });
    const result = reviewDecision({ state, applicationId: 'app1', action: 'reject' });
    expect(result.ok).toBe(true);
    expect(result.action).toBe('reject');
    expect(result.reviewMeta.status).toBe('rejected');
  });

  test('cannot reject non-pending application', () => {
    const state = makeState({
      applications: [{ id: 'app1', teamId: 'team3', status: 'rejected' }],
    });
    const result = reviewDecision({ state, applicationId: 'app1', action: 'reject' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-pending');
  });

  test('rejects unknown action', () => {
    const state = makeState({
      applications: [{ id: 'app1', teamId: 'team3', status: 'pending' }],
    });
    const result = reviewDecision({ state, applicationId: 'app1', action: 'maybe' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-action');
  });
});


// ═══════════════════════════════════════════════════════
//  Tests — End / Reopen
// ═══════════════════════════════════════════════════════

describe('endDecision', () => {
  test('cannot end already-ended tournament', () => {
    const result = endDecision({ ended: true, name: 'T1' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already-ended');
  });

  test('end sets ended=true', () => {
    const result = endDecision({ ended: false, name: 'T1' });
    expect(result.ok).toBe(true);
    expect(result.update).toEqual({ ended: true });
  });

  test('cannot end null tournament', () => {
    const result = endDecision(null);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-found');
  });

  test('cannot end tournament ended by old matchDates', () => {
    const old = new Date();
    old.setDate(old.getDate() - 5);
    const result = endDecision({ matchDates: [old.toISOString()] });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already-ended');
  });
});

describe('reopenDecision', () => {
  test('cannot reopen already-open tournament', () => {
    const result = reopenDecision({ ended: false, name: 'T1' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already-open');
  });

  test('reopen sets ended=false', () => {
    const result = reopenDecision({ ended: true, name: 'T1' });
    expect(result.ok).toBe(true);
    expect(result.update).toEqual({ ended: false });
  });

  test('cannot reopen null tournament', () => {
    const result = reopenDecision(null);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-found');
  });
});
