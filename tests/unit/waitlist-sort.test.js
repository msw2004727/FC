/**
 * Waitlist Sorting Logic — unit tests
 *
 * Tests the candidate selection comparator from event-create-waitlist.js
 * per CLAUDE.md rules #7 and #8:
 *   - Promotion: registeredAt ASC, promotionOrder ASC (earliest first)
 *   - Demotion:  registeredAt DESC, promotionOrder DESC (latest first)
 *
 * Extracted from js/modules/event/event-create-waitlist.js:10-17
 */

// ---------------------------------------------------------------------------
// Promotion comparator (registeredAt ASC, promotionOrder ASC)
// Extracted from event-create-waitlist.js _getNextWaitlistCandidate sort
// ---------------------------------------------------------------------------
function promotionSort(a, b) {
  const ta = new Date(a.registeredAt).getTime();
  const tb = new Date(b.registeredAt).getTime();
  if (ta !== tb) return ta - tb;
  return (a.promotionOrder || 0) - (b.promotionOrder || 0);
}

// ---------------------------------------------------------------------------
// Demotion comparator (registeredAt DESC, promotionOrder DESC)
// Per CLAUDE.md rule #8
// ---------------------------------------------------------------------------
function demotionSort(a, b) {
  const ta = new Date(a.registeredAt).getTime();
  const tb = new Date(b.registeredAt).getTime();
  if (ta !== tb) return tb - ta;
  return (b.promotionOrder || 0) - (a.promotionOrder || 0);
}

// ---------------------------------------------------------------------------
// getNextWaitlistCandidate — extracted pure logic
// ---------------------------------------------------------------------------
function getNextWaitlistCandidate(regs) {
  return regs
    .filter(r => r.status === 'waitlisted')
    .sort(promotionSort)[0] || null;
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('Promotion sort (registeredAt ASC, promotionOrder ASC)', () => {
  test('earlier registeredAt comes first', () => {
    const regs = [
      { registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 0 },
      { registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 0 },
    ];
    regs.sort(promotionSort);
    expect(regs[0].registeredAt).toBe('2026-03-10T09:00:00Z');
  });

  test('same registeredAt → lower promotionOrder first', () => {
    const regs = [
      { registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 3 },
      { registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 1 },
      { registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 2 },
    ];
    regs.sort(promotionSort);
    expect(regs.map(r => r.promotionOrder)).toEqual([1, 2, 3]);
  });

  test('missing promotionOrder defaults to 0', () => {
    const regs = [
      { registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 1 },
      { registeredAt: '2026-03-10T10:00:00Z' },
    ];
    regs.sort(promotionSort);
    expect(regs[0].promotionOrder).toBeUndefined(); // 0 < 1
  });

  test('handles Firestore Timestamp converted to ISO string', () => {
    const regs = [
      { registeredAt: '2026-03-10T12:00:00.000Z', promotionOrder: 0 },
      { registeredAt: '2026-03-10T08:30:00.000Z', promotionOrder: 0 },
    ];
    regs.sort(promotionSort);
    expect(regs[0].registeredAt).toBe('2026-03-10T08:30:00.000Z');
  });

  test('stable sort for identical entries', () => {
    const regs = [
      { registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 0, id: 'a' },
      { registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 0, id: 'b' },
    ];
    regs.sort(promotionSort);
    // Both have identical sort keys — order should be stable (not swapped)
    expect(regs[0].id).toBe('a');
  });

  test('mixed timestamps with different days', () => {
    const regs = [
      { registeredAt: '2026-03-12T08:00:00Z', promotionOrder: 0 },
      { registeredAt: '2026-03-10T23:59:59Z', promotionOrder: 0 },
      { registeredAt: '2026-03-11T12:00:00Z', promotionOrder: 0 },
    ];
    regs.sort(promotionSort);
    expect(regs.map(r => r.registeredAt)).toEqual([
      '2026-03-10T23:59:59Z',
      '2026-03-11T12:00:00Z',
      '2026-03-12T08:00:00Z',
    ]);
  });
});

describe('Demotion sort (registeredAt DESC, promotionOrder DESC)', () => {
  test('later registeredAt comes first', () => {
    const regs = [
      { registeredAt: '2026-03-10T09:00:00Z', promotionOrder: 0 },
      { registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 0 },
    ];
    regs.sort(demotionSort);
    expect(regs[0].registeredAt).toBe('2026-03-10T10:00:00Z');
  });

  test('same registeredAt → higher promotionOrder first', () => {
    const regs = [
      { registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 1 },
      { registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 3 },
      { registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 2 },
    ];
    regs.sort(demotionSort);
    expect(regs.map(r => r.promotionOrder)).toEqual([3, 2, 1]);
  });

  test('missing promotionOrder defaults to 0 (demoted last)', () => {
    const regs = [
      { registeredAt: '2026-03-10T10:00:00Z' },
      { registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 1 },
    ];
    regs.sort(demotionSort);
    expect(regs[0].promotionOrder).toBe(1);
  });
});

describe('getNextWaitlistCandidate', () => {
  test('returns earliest waitlisted registration', () => {
    const regs = [
      { id: 'r1', status: 'confirmed', registeredAt: '2026-03-10T08:00:00Z' },
      { id: 'r2', status: 'waitlisted', registeredAt: '2026-03-10T10:00:00Z' },
      { id: 'r3', status: 'waitlisted', registeredAt: '2026-03-10T09:00:00Z' },
    ];
    const result = getNextWaitlistCandidate(regs);
    expect(result.id).toBe('r3');
  });

  test('skips confirmed and cancelled registrations', () => {
    const regs = [
      { id: 'r1', status: 'confirmed', registeredAt: '2026-03-10T08:00:00Z' },
      { id: 'r2', status: 'cancelled', registeredAt: '2026-03-10T08:30:00Z' },
      { id: 'r3', status: 'waitlisted', registeredAt: '2026-03-10T09:00:00Z' },
    ];
    const result = getNextWaitlistCandidate(regs);
    expect(result.id).toBe('r3');
  });

  test('returns null when no waitlisted registrations', () => {
    const regs = [
      { id: 'r1', status: 'confirmed', registeredAt: '2026-03-10T08:00:00Z' },
    ];
    expect(getNextWaitlistCandidate(regs)).toBeNull();
  });

  test('returns null for empty array', () => {
    expect(getNextWaitlistCandidate([])).toBeNull();
  });

  test('uses promotionOrder as tiebreaker', () => {
    const regs = [
      { id: 'r1', status: 'waitlisted', registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 2 },
      { id: 'r2', status: 'waitlisted', registeredAt: '2026-03-10T10:00:00Z', promotionOrder: 1 },
    ];
    const result = getNextWaitlistCandidate(regs);
    expect(result.id).toBe('r2');
  });

  test('does not mutate original array', () => {
    const regs = [
      { id: 'r2', status: 'waitlisted', registeredAt: '2026-03-10T10:00:00Z' },
      { id: 'r1', status: 'waitlisted', registeredAt: '2026-03-10T09:00:00Z' },
    ];
    const original = [...regs];
    getNextWaitlistCandidate(regs);
    expect(regs[0].id).toBe(original[0].id);
  });

  test('handles invalid registeredAt gracefully (NaN date)', () => {
    const regs = [
      { id: 'r1', status: 'waitlisted', registeredAt: 'invalid-date' },
      { id: 'r2', status: 'waitlisted', registeredAt: '2026-03-10T09:00:00Z' },
    ];
    // NaN comparison: ta !== tb but NaN arithmetic → should not crash
    const result = getNextWaitlistCandidate(regs);
    expect(result).not.toBeNull();
  });
});
