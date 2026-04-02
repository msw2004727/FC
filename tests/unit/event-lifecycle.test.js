/**
 * Event Lifecycle — unit tests
 *
 * Tests the event status transition logic extracted from
 * event-manage-lifecycle.js. The actual functions are tightly coupled
 * to ApiService/DOM, so we extract the pure decision logic and test
 * state machine rules: which transitions are valid, which are not,
 * and what side-effects (e.g. registration preservation) occur.
 *
 * Source files:
 *   js/modules/event/event-manage-lifecycle.js
 */

// ===========================================================================
// Valid event statuses (derived from usage across event modules)
// ===========================================================================
const VALID_STATUSES = ['open', 'full', 'ended', 'cancelled'];

// ===========================================================================
// Extracted from js/modules/event/event-manage-lifecycle.js:97-138
// closeMyActivity — transition logic for ending an event
// ===========================================================================
function transitionToEnded(event) {
  if (!event) return { error: 'Event not found' };
  if (!VALID_STATUSES.includes(event.status)) {
    return { error: 'Invalid current status: ' + event.status };
  }
  if (event.status === 'ended') {
    return { error: 'Event already ended' };
  }
  if (event.status === 'cancelled') {
    return { error: 'Cannot end a cancelled event' };
  }
  return {
    previousStatus: event.status,
    newStatus: 'ended',
    event: { ...event, status: 'ended' },
  };
}

// ===========================================================================
// Extracted from js/modules/event/event-manage-lifecycle.js:141-170
// cancelMyActivity — transition logic for cancelling an event
// ===========================================================================
function transitionToCancelled(event) {
  if (!event) return { error: 'Event not found' };
  if (!VALID_STATUSES.includes(event.status)) {
    return { error: 'Invalid current status: ' + event.status };
  }
  if (event.status === 'cancelled') {
    return { error: 'Event already cancelled' };
  }
  if (event.status === 'ended') {
    return { error: 'Cannot cancel an ended event' };
  }
  return {
    previousStatus: event.status,
    newStatus: 'cancelled',
    event: { ...event, status: 'cancelled' },
  };
}

// ===========================================================================
// Extracted from js/modules/event/event-manage-lifecycle.js:173-195
// reopenMyActivity — transition logic for reopening a cancelled event
// ===========================================================================
function transitionToReopen(event) {
  if (!event) return { error: 'Event not found' };
  if (event.status !== 'cancelled') {
    return { error: 'Only cancelled events can be reopened' };
  }
  const newStatus = (event.current || 0) >= (event.max || 0) ? 'full' : 'open';
  return {
    previousStatus: event.status,
    newStatus,
    event: { ...event, status: newStatus },
  };
}

// ===========================================================================
// Extracted from js/modules/event/event-manage-lifecycle.js:198-229
// relistMyActivity — transition logic for relisting an ended event
// ===========================================================================
function transitionToRelist(event) {
  if (!event) return { error: 'Event not found' };
  if (event.status !== 'ended') {
    return { error: 'Only ended events can be relisted' };
  }
  const newStatus = (event.current || 0) >= (event.max || 0) ? 'full' : 'open';
  return {
    previousStatus: event.status,
    newStatus,
    event: { ...event, status: newStatus },
  };
}

// ===========================================================================
// Pure helper: validate a status value
// ===========================================================================
function isValidStatus(status) {
  return VALID_STATUSES.includes(status);
}

// ===========================================================================
// TESTS
// ===========================================================================

const ev = (status, extra) => ({ id: 'e1', title: 'Test', status, max: 10, current: 5, ...extra });

describe('Event status transitions: end event', () => {
  test('open -> ended (happy path)', () => {
    const r = transitionToEnded(ev('open'));
    expect(r.error).toBeUndefined();
    expect(r.previousStatus).toBe('open');
    expect(r.newStatus).toBe('ended');
    expect(r.event.status).toBe('ended');
  });

  test('full -> ended', () => {
    expect(transitionToEnded(ev('full', { current: 10 })).newStatus).toBe('ended');
  });

  test('cannot end an already-ended event', () => {
    expect(transitionToEnded(ev('ended')).error).toBe('Event already ended');
  });

  test('cannot end a cancelled event', () => {
    expect(transitionToEnded(ev('cancelled')).error).toBe('Cannot end a cancelled event');
  });

  test('null event returns error', () => {
    expect(transitionToEnded(null).error).toBe('Event not found');
  });

  test('invalid status rejected', () => {
    expect(transitionToEnded(ev('bogus')).error).toContain('Invalid current status');
  });

  test('ended event preserves registration data (no mutation)', () => {
    const event = ev('open', { participants: ['A', 'B', 'C'], waitlistNames: ['D'] });
    const r = transitionToEnded(event);
    expect(r.event.participants).toEqual(['A', 'B', 'C']);
    expect(r.event.waitlistNames).toEqual(['D']);
    expect(event.status).toBe('open'); // original not mutated
  });
});

describe('Event status transitions: cancel event', () => {
  test('open -> cancelled (happy path)', () => {
    const r = transitionToCancelled(ev('open', { current: 3 }));
    expect(r.error).toBeUndefined();
    expect(r.newStatus).toBe('cancelled');
    expect(r.event.status).toBe('cancelled');
  });

  test('full -> cancelled', () => {
    expect(transitionToCancelled(ev('full', { current: 10 })).newStatus).toBe('cancelled');
  });

  test('cannot cancel an already-cancelled event', () => {
    expect(transitionToCancelled(ev('cancelled')).error).toBe('Event already cancelled');
  });

  test('cannot cancel an ended event', () => {
    expect(transitionToCancelled(ev('ended')).error).toBe('Cannot cancel an ended event');
  });

  test('null event returns error', () => {
    expect(transitionToCancelled(null).error).toBe('Event not found');
  });

  test('invalid status rejected', () => {
    expect(transitionToCancelled(ev('draft')).error).toContain('Invalid current status');
  });

  test('cancelled event preserves registration data (no mutation)', () => {
    const event = ev('open', { current: 3, participants: ['A', 'B', 'C'] });
    const r = transitionToCancelled(event);
    expect(r.event.participants).toEqual(['A', 'B', 'C']);
    expect(event.status).toBe('open');
  });
});

describe('Event status transitions: reopen / relist', () => {
  test('cancelled -> open when under capacity', () => {
    expect(transitionToReopen(ev('cancelled', { current: 3 })).newStatus).toBe('open');
  });

  test('cancelled -> full when at capacity', () => {
    expect(transitionToReopen(ev('cancelled', { max: 5, current: 5 })).newStatus).toBe('full');
  });

  test('cannot reopen an open or ended event', () => {
    expect(transitionToReopen(ev('open')).error).toBe('Only cancelled events can be reopened');
    expect(transitionToReopen(ev('ended')).error).toBe('Only cancelled events can be reopened');
  });

  test('ended -> open when under capacity', () => {
    expect(transitionToRelist(ev('ended', { current: 3 })).newStatus).toBe('open');
  });

  test('ended -> full when at capacity', () => {
    expect(transitionToRelist(ev('ended', { max: 5, current: 5 })).newStatus).toBe('full');
  });

  test('cannot relist an open or cancelled event', () => {
    expect(transitionToRelist(ev('open')).error).toBe('Only ended events can be relisted');
    expect(transitionToRelist(ev('cancelled')).error).toBe('Only ended events can be relisted');
  });
});

describe('Status validation', () => {
  test.each(['open', 'full', 'ended', 'cancelled'])('%s is valid', (s) => {
    expect(isValidStatus(s)).toBe(true);
  });

  test.each(['draft', 'pending', '', null, undefined])('%s is invalid', (s) => {
    expect(isValidStatus(s)).toBe(false);
  });
});
