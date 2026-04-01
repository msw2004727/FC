/**
 * Permission Guard Safety — Prevent Blocking Regression
 *
 * History: 2026-03-30 commit 6bf9bde added 11 permission guards, one of which
 * (`event.view_registrations` in _renderAttendanceTable) silently blocked ALL
 * regular users from seeing the registration list. Went undetected for 2 days.
 *
 * This test scans source code for dangerous permission guard patterns:
 *   1. View/render functions must NOT have blocking hasPermission guards
 *   2. Management guards must have _canManageEvent fallback (not bare return)
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function readFile(relPath) {
  const fullPath = path.join(PROJECT_ROOT, relPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8');
}

function getLines(relPath) {
  const content = readFile(relPath);
  if (!content) return [];
  return content.split(/\r?\n/);
}

// ─── Functions that regular users must be able to reach ───
// These render/view functions must NEVER have a blocking hasPermission guard.
const MUST_NOT_BLOCK = [
  {
    file: 'js/modules/event/event-manage-attendance.js',
    fn: '_renderAttendanceTable',
    reason: 'All logged-in users must see the registration list',
  },
  {
    file: 'js/modules/event/event-detail.js',
    fn: 'showEventDetail',
    reason: 'All logged-in users must see event detail page',
  },
  {
    file: 'js/modules/event/event-detail.js',
    fn: '_renderGuestAttendanceTable',
    reason: 'Guest rendering must not have permission checks',
  },
];

// ─── Regex: bare blocking guard (return without fallback) ───
// Matches: if (!this.hasPermission('x') && ...) return;
// Does NOT match: if (!this.hasPermission('x')) { ... if (!_canManageEvent) return; }
const BARE_BLOCK_REGEX = /hasPermission\([^)]+\)[^{}]*\)\s*return\s*;/;

describe('Permission guard safety — view functions not blocked', () => {
  MUST_NOT_BLOCK.forEach(({ file, fn, reason }) => {
    test(`${fn} in ${file} has no blocking hasPermission guard`, () => {
      const lines = getLines(file);
      expect(lines.length).toBeGreaterThan(0);

      // Find the function
      const fnStart = lines.findIndex(l => l.includes(fn + '('));
      expect(fnStart).toBeGreaterThanOrEqual(0);

      // Scan the first 10 lines of the function for hasPermission guards
      const fnSlice = lines.slice(fnStart, fnStart + 10).join('\n');
      const hasBlockingGuard = fnSlice.includes('hasPermission') &&
        (BARE_BLOCK_REGEX.test(fnSlice) || /hasPermission[^}]*\)\s*\{[^}]*return\s*;?\s*\}/.test(fnSlice));

      if (hasBlockingGuard) {
        const guardLines = lines.slice(fnStart, fnStart + 10)
          .map((l, i) => `  L${fnStart + i + 1}: ${l}`)
          .filter(l => l.includes('hasPermission') || l.includes('return'))
          .join('\n');
        fail(
          `${fn} has a blocking hasPermission guard!\n` +
          `Reason it must not: ${reason}\n` +
          `Found at:\n${guardLines}\n` +
          `Fix: remove the guard, or add _canManageEvent fallback.`
        );
      }
    });
  });
});

describe('Permission guard safety — management guards have fallback', () => {
  // Management functions where guards exist — verify they have _canManageEvent fallback
  const MANAGEMENT_GUARDS = [
    { file: 'js/modules/event/event-manage-confirm.js', fn: '_startTableEdit' },
    { file: 'js/modules/scan/scan.js', fn: 'renderScanPage' },
  ];

  MANAGEMENT_GUARDS.forEach(({ file, fn }) => {
    test(`${fn} in ${file} — hasPermission guard has fallback`, () => {
      const lines = getLines(file);
      const fnStart = lines.findIndex(l => l.includes(fn + '(') || l.includes(fn + ' ('));
      expect(fnStart).toBeGreaterThanOrEqual(0);

      const fnSlice = lines.slice(fnStart, fnStart + 10).join('\n');

      if (fnSlice.includes('hasPermission')) {
        // Must NOT be a bare return — must have _canManageEvent or _isAnyActiveEventDelegate fallback
        const hasFallback = fnSlice.includes('_canManageEvent') || fnSlice.includes('_isAnyActiveEventDelegate');
        const hasBareReturn = BARE_BLOCK_REGEX.test(fnSlice);

        if (hasBareReturn && !hasFallback) {
          fail(
            `${fn} has a bare hasPermission guard without _canManageEvent fallback!\n` +
            `Delegates (regular user role) will be blocked.\n` +
            `Fix: add _canManageEvent(event) fallback inside the guard.`
          );
        }
      }
    });
  });
});
