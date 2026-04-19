/**
 * Event Blocklist — Visibility Helper Tests
 *
 * Covers the four-state logic of _isEventVisibleToUser:
 *   1. Guest (no uid) → visible
 *   2. Not in blockedUids → visible
 *   3. Blocked + has registration (any status) → visible (尊重歷史)
 *   4. Blocked + no registration → invisible
 */

'use strict';

// ---------------------------------------------------------------------------
// Extracted from js/modules/event/event-blocklist.js
// _isEventVisibleToUser — visibility guard with blocklist support
// ---------------------------------------------------------------------------
function _isEventVisibleToUser(e, uid, getRegistrations) {
  if (!e) return false;
  if (!uid) return true;
  const blocked = Array.isArray(e.blockedUids) ? e.blockedUids : [];
  if (!blocked.includes(uid)) return true;
  const regs = (typeof getRegistrations === 'function' ? getRegistrations() : []) || [];
  return regs.some(r => r && r.eventId === e.id && r.userId === uid);
}

function _filterVisibleEvents(events, uid, getRegistrations) {
  if (!Array.isArray(events)) return [];
  if (!uid) return events.slice();
  return events.filter(e => _isEventVisibleToUser(e, uid, getRegistrations));
}

// ===========================================================================
// TESTS
// ===========================================================================

const makeEvent = (overrides) => ({ id: 'e1', title: 'Test', ...overrides });
const noRegs = () => [];

describe('_isEventVisibleToUser — four-state visibility logic', () => {
  describe('guest (no uid)', () => {
    test('null uid → visible even when event has blockedUids', () => {
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), null, noRegs)).toBe(true);
    });

    test('undefined uid → visible', () => {
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), undefined, noRegs)).toBe(true);
    });

    test('empty string uid → visible', () => {
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), '', noRegs)).toBe(true);
    });
  });

  describe('not in blockedUids', () => {
    test('other uid blocked → visible', () => {
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), 'U2', noRegs)).toBe(true);
    });

    test('blockedUids undefined (legacy event) → visible', () => {
      expect(_isEventVisibleToUser(makeEvent(), 'U1', noRegs)).toBe(true);
    });

    test('blockedUids empty array → visible', () => {
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: [] }), 'U1', noRegs)).toBe(true);
    });

    test('blockedUids non-array (invalid data) → visible (defensive)', () => {
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: 'not-array' }), 'U1', noRegs)).toBe(true);
    });
  });

  describe('blocked but has registration (尊重歷史)', () => {
    test('blocked + confirmed registration → visible', () => {
      const regs = () => [{ eventId: 'e1', userId: 'U1', status: 'confirmed' }];
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), 'U1', regs)).toBe(true);
    });

    test('blocked + waitlisted registration → visible', () => {
      const regs = () => [{ eventId: 'e1', userId: 'U1', status: 'waitlisted' }];
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), 'U1', regs)).toBe(true);
    });

    test('blocked + cancelled registration → visible (key: respect history)', () => {
      const regs = () => [{ eventId: 'e1', userId: 'U1', status: 'cancelled' }];
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), 'U1', regs)).toBe(true);
    });

    test('blocked + removed registration → visible', () => {
      const regs = () => [{ eventId: 'e1', userId: 'U1', status: 'removed' }];
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), 'U1', regs)).toBe(true);
    });
  });

  describe('blocked + no registration → invisible', () => {
    test('empty registrations cache → invisible', () => {
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), 'U1', noRegs)).toBe(false);
    });

    test('registration exists but for different event → invisible', () => {
      const regs = () => [{ eventId: 'e2', userId: 'U1', status: 'confirmed' }];
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), 'U1', regs)).toBe(false);
    });

    test('registration exists but for different user → invisible', () => {
      const regs = () => [{ eventId: 'e1', userId: 'U2', status: 'confirmed' }];
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), 'U1', regs)).toBe(false);
    });

    test('registrations is null → invisible (defensive)', () => {
      expect(_isEventVisibleToUser(makeEvent({ blockedUids: ['U1'] }), 'U1', () => null)).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('null event → invisible', () => {
      expect(_isEventVisibleToUser(null, 'U1', noRegs)).toBe(false);
    });

    test('undefined event → invisible', () => {
      expect(_isEventVisibleToUser(undefined, 'U1', noRegs)).toBe(false);
    });

    test('multiple users in blockedUids, target is one of them + no reg → invisible', () => {
      const e = makeEvent({ blockedUids: ['U1', 'U2', 'U3'] });
      expect(_isEventVisibleToUser(e, 'U2', noRegs)).toBe(false);
    });
  });
});

describe('_filterVisibleEvents', () => {
  test('guest user → returns all events (slice copy)', () => {
    const events = [
      makeEvent({ id: 'e1', blockedUids: ['U1'] }),
      makeEvent({ id: 'e2' }),
    ];
    const result = _filterVisibleEvents(events, null, noRegs);
    expect(result).toHaveLength(2);
    expect(result).not.toBe(events);  // copy, not reference
  });

  test('logged-in user not blocked → returns all events', () => {
    const events = [
      makeEvent({ id: 'e1' }),
      makeEvent({ id: 'e2', blockedUids: ['U2'] }),
    ];
    expect(_filterVisibleEvents(events, 'U1', noRegs)).toHaveLength(2);
  });

  test('logged-in user blocked from e1 without history → e1 filtered out', () => {
    const events = [
      makeEvent({ id: 'e1', blockedUids: ['U1'] }),
      makeEvent({ id: 'e2' }),
    ];
    const result = _filterVisibleEvents(events, 'U1', noRegs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e2');
  });

  test('logged-in user blocked from e1 but has cancelled registration → e1 kept', () => {
    const events = [
      makeEvent({ id: 'e1', blockedUids: ['U1'] }),
      makeEvent({ id: 'e2' }),
    ];
    const regs = () => [{ eventId: 'e1', userId: 'U1', status: 'cancelled' }];
    const result = _filterVisibleEvents(events, 'U1', regs);
    expect(result).toHaveLength(2);
  });

  test('non-array input → empty array', () => {
    expect(_filterVisibleEvents(null, 'U1', noRegs)).toEqual([]);
    expect(_filterVisibleEvents(undefined, 'U1', noRegs)).toEqual([]);
    expect(_filterVisibleEvents('not-array', 'U1', noRegs)).toEqual([]);
  });
});
