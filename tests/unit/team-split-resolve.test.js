/**
 * Team-Split: _resolveTeamKey & _assignTeamKeyForPromotion — Unit Tests
 *
 * Tests the core team assignment algorithms defined in team-split-plan.md.
 * These pure functions will live in:
 *   - js/modules/event/event-team-split.js (_resolveTeamKey)
 *   - js/firebase-crud.js (_assignTeamKeyForPromotion)
 *
 * Plan reference: docs/team-split-plan.md L591-607 (_resolveTeamKey)
 *                 docs/team-split-plan.md L460-481 (_assignTeamKeyForPromotion)
 */

// ─── Extracted from plan L591-607 ───
function _resolveTeamKey(event, allEventRegs, options = {}) {
  if (!event.teamSplit?.enabled) return undefined;
  if (event.teamSplit.mode === 'self-select') return options.userSelectedTeamKey || null;
  if (event.teamSplit.mode === 'manual') return null;
  // random: balanced assignment
  const teams = event.teamSplit.teams;
  if (!teams.length) return null;
  const validKeys = new Set(teams.map(t => t.key));
  const counts = {};
  teams.forEach(t => { counts[t.key] = 0; });
  allEventRegs.filter(r => r.status === 'confirmed' && r.teamKey && validKeys.has(r.teamKey))
    .forEach(r => { counts[r.teamKey] = (counts[r.teamKey] || 0) + 1; });
  return teams.reduce((min, t) =>
    (counts[t.key] || 0) < (counts[min.key] || 0) ? t : min
  ).key;
}

// ─── Extracted from plan L460-470 ───
function _assignTeamKeyForPromotion(event, simRegs, candidate) {
  if (!event.teamSplit?.enabled) return undefined;
  const teams = event.teamSplit.teams;
  if (!teams || !teams.length) return null;
  const mode = event.teamSplit.mode;

  // self-select: try to preserve candidate's choice, fallback if over cap
  if (mode === 'self-select' && candidate.teamKey) {
    const cap = Math.ceil(event.max / teams.length);
    const load = simRegs.filter(r => r.status === 'confirmed' && r.teamKey === candidate.teamKey).length;
    if (load < cap) return candidate.teamKey;
    // fallback to balanced
  }

  // manual: leave null for organizer
  if (mode === 'manual') return null;

  // random (or self-select fallback): balanced assignment
  const validKeys = new Set(teams.map(t => t.key));
  const counts = {};
  teams.forEach(t => { counts[t.key] = 0; });
  simRegs.filter(r => r.status === 'confirmed' && r.teamKey && validKeys.has(r.teamKey))
    .forEach(r => { counts[r.teamKey] = (counts[r.teamKey] || 0) + 1; });
  return teams.reduce((min, t) =>
    (counts[t.key] || 0) < (counts[min.key] || 0) ? t : min
  ).key;
}

// ─── Helper: build event with teamSplit ───
function makeEvent(mode, teamCount = 2, max = 20) {
  const colors = [
    { key: 'A', color: '#EF4444', name: 'Red' },
    { key: 'B', color: '#3B82F6', name: 'Blue' },
    { key: 'C', color: '#10B981', name: 'Green' },
    { key: 'D', color: '#FBBF24', name: 'Yellow' },
  ];
  return {
    max,
    teamSplit: {
      enabled: true,
      mode,
      balanceCap: true,
      teams: colors.slice(0, teamCount),
    },
  };
}

function makeRegs(assignments) {
  // assignments: [{ teamKey, status? }, ...]
  return assignments.map((a, i) => ({
    id: `reg_${i}`,
    status: a.status || 'confirmed',
    teamKey: a.teamKey || null,
    registeredAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
  }));
}

// ═══════════════════════════════════════════════
// _resolveTeamKey
// ═══════════════════════════════════════════════

describe('_resolveTeamKey', () => {

  describe('disabled / missing teamSplit', () => {
    test('returns undefined when teamSplit not enabled', () => {
      expect(_resolveTeamKey({ teamSplit: { enabled: false } }, [])).toBeUndefined();
    });

    test('returns undefined when teamSplit missing', () => {
      expect(_resolveTeamKey({}, [])).toBeUndefined();
    });

    test('returns undefined when event is null-ish teamSplit', () => {
      expect(_resolveTeamKey({ teamSplit: null }, [])).toBeUndefined();
    });
  });

  describe('self-select mode', () => {
    test('returns user selected key', () => {
      const ev = makeEvent('self-select');
      expect(_resolveTeamKey(ev, [], { userSelectedTeamKey: 'B' })).toBe('B');
    });

    test('returns null when user has not selected', () => {
      const ev = makeEvent('self-select');
      expect(_resolveTeamKey(ev, [], {})).toBeNull();
    });

    test('returns null when options empty', () => {
      const ev = makeEvent('self-select');
      expect(_resolveTeamKey(ev, [])).toBeNull();
    });
  });

  describe('manual mode', () => {
    test('always returns null', () => {
      const ev = makeEvent('manual');
      expect(_resolveTeamKey(ev, [])).toBeNull();
    });

    test('returns null even with existing regs', () => {
      const ev = makeEvent('manual');
      const regs = makeRegs([{ teamKey: 'A' }, { teamKey: 'B' }]);
      expect(_resolveTeamKey(ev, regs)).toBeNull();
    });
  });

  describe('random mode — balanced assignment', () => {
    test('assigns to A when all teams empty', () => {
      const ev = makeEvent('random');
      expect(_resolveTeamKey(ev, [])).toBe('A');
    });

    test('assigns to B when A has 1, B has 0', () => {
      const ev = makeEvent('random');
      const regs = makeRegs([{ teamKey: 'A' }]);
      expect(_resolveTeamKey(ev, regs)).toBe('B');
    });

    test('assigns to A when tied (deterministic)', () => {
      const ev = makeEvent('random');
      const regs = makeRegs([{ teamKey: 'A' }, { teamKey: 'B' }]);
      expect(_resolveTeamKey(ev, regs)).toBe('A');
    });

    test('alternates A,B,A,B for sequential assignments', () => {
      const ev = makeEvent('random');
      const regs = [];
      const sequence = [];
      for (let i = 0; i < 6; i++) {
        const key = _resolveTeamKey(ev, regs);
        sequence.push(key);
        regs.push({ status: 'confirmed', teamKey: key });
      }
      expect(sequence).toEqual(['A', 'B', 'A', 'B', 'A', 'B']);
    });

    test('3-team round robin: A,B,C,A,B,C', () => {
      const ev = makeEvent('random', 3);
      const regs = [];
      const sequence = [];
      for (let i = 0; i < 6; i++) {
        const key = _resolveTeamKey(ev, regs);
        sequence.push(key);
        regs.push({ status: 'confirmed', teamKey: key });
      }
      expect(sequence).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
    });

    test('rebalances after cancellation gap', () => {
      const ev = makeEvent('random');
      // A=3, B=2 (someone from B cancelled)
      const regs = makeRegs([
        { teamKey: 'A' }, { teamKey: 'A' }, { teamKey: 'A' },
        { teamKey: 'B' }, { teamKey: 'B' },
      ]);
      expect(_resolveTeamKey(ev, regs)).toBe('B');
    });

    test('ignores waitlisted registrations in count', () => {
      const ev = makeEvent('random');
      const regs = makeRegs([
        { teamKey: 'A', status: 'confirmed' },
        { teamKey: 'A', status: 'waitlisted' },
        { teamKey: 'B', status: 'confirmed' },
      ]);
      // confirmed: A=1, B=1 → assigns A (tie → first)
      expect(_resolveTeamKey(ev, regs)).toBe('A');
    });

    test('ignores cancelled registrations', () => {
      const ev = makeEvent('random');
      const regs = makeRegs([
        { teamKey: 'A', status: 'confirmed' },
        { teamKey: 'A', status: 'cancelled' },
        { teamKey: 'B', status: 'confirmed' },
      ]);
      expect(_resolveTeamKey(ev, regs)).toBe('A');
    });
  });

  describe('defensive filtering — invalid teamKey', () => {
    test('ignores registrations with invalid teamKey', () => {
      const ev = makeEvent('random');
      const regs = makeRegs([
        { teamKey: 'A' },
        { teamKey: 'HACKED' },
        { teamKey: 'B' },
      ]);
      // valid: A=1, B=1 → assigns A; 'HACKED' ignored
      expect(_resolveTeamKey(ev, regs)).toBe('A');
    });

    test('ignores teamKey not in event teams', () => {
      const ev = makeEvent('random', 2); // only A, B
      const regs = makeRegs([
        { teamKey: 'A' },
        { teamKey: 'C' }, // C not in event teams
        { teamKey: 'D' }, // D not in event teams
      ]);
      // valid: A=1, B=0 → assigns B
      expect(_resolveTeamKey(ev, regs)).toBe('B');
    });

    test('returns null for empty teams array', () => {
      const ev = { teamSplit: { enabled: true, mode: 'random', teams: [] } };
      expect(_resolveTeamKey(ev, [])).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════
// _assignTeamKeyForPromotion
// ═══════════════════════════════════════════════

describe('_assignTeamKeyForPromotion', () => {

  describe('disabled teamSplit', () => {
    test('returns undefined when not enabled', () => {
      expect(_assignTeamKeyForPromotion({}, [], {})).toBeUndefined();
    });
  });

  describe('manual mode', () => {
    test('returns null — organizer assigns later', () => {
      const ev = makeEvent('manual');
      const result = _assignTeamKeyForPromotion(ev, [], { teamKey: null });
      expect(result).toBeNull();
    });
  });

  describe('random mode', () => {
    test('assigns to team with fewest members', () => {
      const ev = makeEvent('random');
      const regs = makeRegs([
        { teamKey: 'A' }, { teamKey: 'A' },
        { teamKey: 'B' },
      ]);
      const candidate = { teamKey: null };
      expect(_assignTeamKeyForPromotion(ev, regs, candidate)).toBe('B');
    });
  });

  describe('self-select mode — preserve choice', () => {
    test('preserves candidate choice when team has capacity', () => {
      const ev = makeEvent('self-select', 2, 20); // cap = 10 per team
      const regs = makeRegs([
        { teamKey: 'A' }, { teamKey: 'A' }, // A=2
        { teamKey: 'B' }, // B=1
      ]);
      const candidate = { teamKey: 'A' }; // chose A while waitlisted
      expect(_assignTeamKeyForPromotion(ev, regs, candidate)).toBe('A');
    });

    test('falls back to balanced when chosen team is at cap', () => {
      const ev = makeEvent('self-select', 2, 4); // cap = ceil(4/2) = 2
      const regs = makeRegs([
        { teamKey: 'A' }, { teamKey: 'A' }, // A=2 (full)
        { teamKey: 'B' }, // B=1
      ]);
      const candidate = { teamKey: 'A' }; // chose A but it's full
      expect(_assignTeamKeyForPromotion(ev, regs, candidate)).toBe('B');
    });

    test('preserves choice at exact cap boundary', () => {
      const ev = makeEvent('self-select', 2, 4); // cap = 2
      const regs = makeRegs([
        { teamKey: 'A' }, // A=1 (room for 1 more)
        { teamKey: 'B' }, // B=1
      ]);
      const candidate = { teamKey: 'A' };
      expect(_assignTeamKeyForPromotion(ev, regs, candidate)).toBe('A');
    });

    test('falls back to balanced when candidate has no prior choice', () => {
      const ev = makeEvent('self-select', 2, 20);
      const regs = makeRegs([
        { teamKey: 'A' }, { teamKey: 'A' },
        { teamKey: 'B' },
      ]);
      const candidate = { teamKey: null }; // never chose
      // balanced: A=2, B=1 → B
      expect(_assignTeamKeyForPromotion(ev, regs, candidate)).toBe('B');
    });
  });

  describe('defensive filtering — invalid teamKey in simRegs', () => {
    test('ignores polluted teamKey in balance calculation', () => {
      const ev = makeEvent('random');
      const regs = makeRegs([
        { teamKey: 'A' },
        { teamKey: 'INVALID' },
      ]);
      // valid: A=1, B=0 → B
      expect(_assignTeamKeyForPromotion(ev, regs, { teamKey: null })).toBe('B');
    });
  });
});
