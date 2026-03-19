/**
 * Ad Management module unit tests — extracted pure functions.
 *
 * Source file: js/modules/ad-manage/ad-manage-core.js
 */

// ---------------------------------------------------------------------------
// Extracted from ad-manage-core.js:10-13
// _formatDT — formats ISO date string to YYYY/MM/DD HH:MM
// ---------------------------------------------------------------------------
function _formatDT(isoStr) {
  const d = new Date(isoStr);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ---------------------------------------------------------------------------
// Extracted from ad-manage-core.js:15-18
// _remainDays — calculates days remaining until unpublish date
// Adapted: accepts explicit `now` for testability
// ---------------------------------------------------------------------------
function _remainDays(unpublishAt, now) {
  const diff = new Date(unpublishAt.replace(/\//g, '-')) - (now || new Date());
  return Math.max(0, Math.ceil(diff / 86400000));
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_formatDT (ad-manage-core.js:10-13)', () => {
  test('formats ISO date correctly', () => {
    // Use a date with explicit local timezone to avoid timezone issues
    const d = new Date(2026, 2, 17, 14, 30); // March 17, 2026 14:30 local
    const result = _formatDT(d.toISOString());
    expect(result).toBe('2026/03/17 14:30');
  });

  test('pads single-digit month and day', () => {
    const d = new Date(2026, 0, 5, 9, 5); // Jan 5, 2026 09:05 local
    const result = _formatDT(d.toISOString());
    expect(result).toBe('2026/01/05 09:05');
  });

  test('midnight', () => {
    const d = new Date(2026, 5, 15, 0, 0); // June 15, 2026 00:00
    const result = _formatDT(d.toISOString());
    expect(result).toBe('2026/06/15 00:00');
  });
});

describe('_remainDays (ad-manage-core.js:15-18)', () => {
  test('future date → positive days', () => {
    const now = new Date(2026, 2, 17, 12, 0); // March 17 noon
    const result = _remainDays('2026/03/20', now);
    expect(result).toBe(3);
  });

  test('past date → 0', () => {
    const now = new Date(2026, 2, 17, 12, 0);
    const result = _remainDays('2026/03/15', now);
    expect(result).toBe(0);
  });

  test('same date → 0 or 1 depending on time', () => {
    const now = new Date(2026, 2, 17, 12, 0);
    const result = _remainDays('2026/03/17', now);
    // 2026/03/17 parses as midnight, now is noon → diff is negative → 0
    expect(result).toBe(0);
  });

  test('handles slash-format dates converted to dash', () => {
    // _remainDays replaces / with - before parsing, so '2026/03/20' → '2026-03-20'
    // new Date('2026-03-20') parses as UTC midnight → local offset matters
    const now = new Date(2026, 2, 17, 12, 0); // noon local
    const result = _remainDays('2026/03/20', now);
    expect(result).toBeGreaterThanOrEqual(2);
    expect(result).toBeLessThanOrEqual(3);
  });

  test('one day ahead from noon → 1', () => {
    const now = new Date(2026, 2, 17, 12, 0); // noon
    const result = _remainDays('2026/03/18', now);
    // '2026-03-18' UTC midnight is ~12h ahead of local noon → ceil(0.5) = 1
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});
