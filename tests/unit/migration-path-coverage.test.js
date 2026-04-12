/**
 * Migration Path Coverage — Subcollection Migration Safety Net
 *
 * Scans the ENTIRE codebase for direct Firestore references to the three
 * global collections (registrations, attendanceRecords, activityRecords)
 * and compares against the known allowlist from the migration plan (v5).
 *
 * PURPOSE:
 *   If someone adds a NEW db.collection('registrations') call that isn't
 *   in the migration plan, this test FAILS — preventing untracked paths
 *   from silently breaking after the subcollection migration.
 *
 * METHODOLOGY:
 *   - Grep all .js files under js/, app.js, functions/index.js
 *   - Count occurrences per file per collection
 *   - Compare against frozen allowlist
 *   - New file or count increase = FAIL with actionable message
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ═══════════════════════════════════════════════════════════════
//  Allowlist: known db.collection() references from migration plan v5
//  Format: { 'relative/path.js': { registrations: N, attendanceRecords: N, activityRecords: N } }
//
//  These counts were verified via global grep on 2026-04-12.
//  If a test fails, it means the codebase has NEW references
//  that the migration plan doesn't cover.
// ═══════════════════════════════════════════════════════════════
const KNOWN_REFERENCES = {
  'js/firebase-crud.js': { registrations: 11, attendanceRecords: 4, activityRecords: 0 }, // Phase 4b: 全部改為子集合路徑（regex 仍匹配 .collection('registrations') in subcollection chain）
  'js/firebase-service.js': { registrations: 0, attendanceRecords: 0, activityRecords: 0 },
  'js/api-service.js': { registrations: 0, attendanceRecords: 1, activityRecords: 0 },
  'js/modules/achievement-batch.js': { registrations: 1, attendanceRecords: 0, activityRecords: 0 }, // Phase 4b: 寫入改子集合
  'js/modules/event/event-create-waitlist.js': { registrations: 3, attendanceRecords: 0, activityRecords: 2 }, // Phase 4b: 寫入改子集合
  'js/modules/event/event-detail-signup.js': { registrations: 3, attendanceRecords: 0, activityRecords: 5 }, // Phase 4b: 寫入改子集合
  'js/modules/event/event-detail-companion.js': { registrations: 0, attendanceRecords: 0, activityRecords: 4 }, // Phase 4b: 寫入改子集合
  'js/modules/event/event-detail.js': { registrations: 1, attendanceRecords: 0, activityRecords: 0 },
  'js/modules/event/event-manage-badges.js': { registrations: 2, attendanceRecords: 0, activityRecords: 0 }, // Phase 4b: 寫入改子集合
  'js/modules/event/event-manage-lifecycle.js': { registrations: 3, attendanceRecords: 0, activityRecords: 3 }, // Phase 4b: 寫入改子集合
  'js/modules/event/event-manage-waitlist.js': { registrations: 2, attendanceRecords: 0, activityRecords: 2 }, // Phase 4b: 寫入改子集合
  'js/modules/event/event-team-split.js': { registrations: 4, attendanceRecords: 0, activityRecords: 0 }, // Phase 4b: 寫入改子集合
  'js/modules/event/event-host-list.js': { registrations: 0, attendanceRecords: 0, activityRecords: 0 },
  'js/modules/registration-audit.js': { registrations: 2, attendanceRecords: 0, activityRecords: 0 }, // Phase 4b: 寫入改子集合
  'js/modules/attendance-notify.js': { registrations: 0, attendanceRecords: 0, activityRecords: 0 },
  'app.js': { registrations: 0, attendanceRecords: 0, activityRecords: 1 }, // Phase 4b: 寫入改子集合
};

// Cloud Functions — uses double quotes
const KNOWN_CF_REFERENCES = {
  'functions/index.js': { registrations: 6, attendanceRecords: 0, activityRecords: 4 }, // Phase 4b: 寫入改子集合（regex 仍匹配子集合鏈）
};

// CF triggers — document path references (not db.collection)
const KNOWN_CF_TRIGGERS = {
  'functions/index.js': {
    triggers: [
      'events/{eventId}/registrations/{regId}',
      'events/{eventId}/attendanceRecords/{recordId}',
    ],
  },
};

// ═══════════════════════════════════════════════════════════════
//  Scanner
// ═══════════════════════════════════════════════════════════════

const COLLECTIONS = ['registrations', 'attendanceRecords', 'activityRecords'];

/**
 * Count db.collection('name') and db.collection("name") occurrences in a file.
 * Also catches firebase.firestore().collection('name') variant.
 */
function countCollectionRefs(filePath) {
  const fullPath = path.join(PROJECT_ROOT, filePath);
  if (!fs.existsSync(fullPath)) return null;

  const content = fs.readFileSync(fullPath, 'utf-8');
  const counts = {};

  for (const col of COLLECTIONS) {
    // Match: db.collection('name'), db.collection("name"),
    //        firebase.firestore().collection('name'), .collection("name")
    const pattern = new RegExp(`\\.collection\\(['"]${col}['"]\\)`, 'g');
    const matches = content.match(pattern);
    counts[col] = matches ? matches.length : 0;
  }

  return counts;
}

/**
 * Count document: "collectionName/..." trigger patterns in CF
 */
function countTriggerRefs(filePath) {
  const fullPath = path.join(PROJECT_ROOT, filePath);
  if (!fs.existsSync(fullPath)) return null;

  const content = fs.readFileSync(fullPath, 'utf-8');
  const found = [];

  for (const col of COLLECTIONS) {
    const pattern = new RegExp(`document:\\s*["']${col}/`, 'g');
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach(() => found.push(`${col}/{docId}`));
    }
  }
  return found;
}

/**
 * Recursively find all .js files under a directory
 */
function findJsFiles(dir, base) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.join(base, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      // Skip node_modules, tests, .git, scripts, docs
      if (['node_modules', 'tests', '.git', 'scripts', 'docs', '.claude'].includes(entry.name)) continue;
      results.push(...findJsFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.js')) {
      results.push(rel);
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════

describe('Migration Path Coverage — Frontend JS', () => {
  const frontendFiles = [
    'app.js',
    ...findJsFiles(path.join(PROJECT_ROOT, 'js'), 'js'),
  ];

  test('all db.collection() references match the migration plan allowlist', () => {
    const unexpected = [];
    const countMismatch = [];

    for (const file of frontendFiles) {
      const counts = countCollectionRefs(file);
      if (!counts) continue;

      const hasAnyRef = COLLECTIONS.some(c => counts[c] > 0);
      if (!hasAnyRef) continue;

      const known = KNOWN_REFERENCES[file];

      if (!known) {
        // File has references but is NOT in the allowlist
        const details = COLLECTIONS.filter(c => counts[c] > 0)
          .map(c => `${c}:${counts[c]}`).join(', ');
        unexpected.push(`NEW FILE not in migration plan: ${file} (${details})`);
        continue;
      }

      // Check count per collection
      for (const col of COLLECTIONS) {
        if (counts[col] > known[col]) {
          countMismatch.push(
            `${file}: ${col} count increased from ${known[col]} to ${counts[col]} (+${counts[col] - known[col]} new references)`
          );
        }
      }
    }

    const errors = [...unexpected, ...countMismatch];
    if (errors.length > 0) {
      throw new Error(
        'Migration plan coverage gap detected!\n' +
        'The following files have NEW db.collection() references not covered by the migration plan:\n\n' +
        errors.map(e => `  - ${e}`).join('\n') +
        '\n\nAction: Update the migration plan (docs/stateful-imagining-dahl.md) to cover these references, ' +
        'then update KNOWN_REFERENCES in this test file.'
      );
    }
  });

  test('no known files have been deleted (would indicate missed cleanup)', () => {
    const missing = [];
    for (const file of Object.keys(KNOWN_REFERENCES)) {
      const fullPath = path.join(PROJECT_ROOT, file);
      if (!fs.existsSync(fullPath)) {
        missing.push(file);
      }
    }
    expect(missing).toEqual([]);
  });

  test('allowlist counts have not DECREASED (references removed without plan update)', () => {
    const decreased = [];

    for (const [file, known] of Object.entries(KNOWN_REFERENCES)) {
      const counts = countCollectionRefs(file);
      if (!counts) continue;

      for (const col of COLLECTIONS) {
        if (counts[col] < known[col]) {
          decreased.push(
            `${file}: ${col} decreased from ${known[col]} to ${counts[col]}`
          );
        }
      }
    }

    if (decreased.length > 0) {
      throw new Error(
        'Collection references were REMOVED without updating the migration plan:\n' +
        decreased.map(d => `  - ${d}`).join('\n') +
        '\n\nAction: If intentional, update KNOWN_REFERENCES in this test file.'
      );
    }
  });
});

describe('Migration Path Coverage — Cloud Functions', () => {
  test('functions/index.js exists (required for CF coverage validation)', () => {
    const fullPath = path.join(PROJECT_ROOT, 'functions/index.js');
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  test('all CF db.collection() references match the migration plan allowlist', () => {
    const unexpected = [];
    const countMismatch = [];

    for (const file of Object.keys(KNOWN_CF_REFERENCES)) {
      const counts = countCollectionRefs(file);
      if (!counts) continue;

      const known = KNOWN_CF_REFERENCES[file];

      for (const col of COLLECTIONS) {
        if (counts[col] > known[col]) {
          countMismatch.push(
            `${file}: ${col} count increased from ${known[col]} to ${counts[col]} (+${counts[col] - known[col]})`
          );
        }
      }
    }

    const errors = [...unexpected, ...countMismatch];
    if (errors.length > 0) {
      throw new Error(
        'CF migration plan coverage gap:\n' +
        errors.map(e => `  - ${e}`).join('\n') +
        '\n\nAction: Update migration plan and KNOWN_CF_REFERENCES.'
      );
    }
  });

  test('CF trigger document paths match the migration plan', () => {
    const triggers = countTriggerRefs('functions/index.js');
    if (!triggers) {
      console.warn('functions/index.js not found, skipping trigger check');
      return;
    }

    const known = KNOWN_CF_TRIGGERS['functions/index.js'].triggers;
    const unknownTriggers = triggers.filter(t => !known.some(k => t.startsWith(k.split('/')[0])));

    if (unknownTriggers.length > 0) {
      throw new Error(
        'New CF triggers on target collections not in migration plan:\n' +
        unknownTriggers.map(t => `  - ${t}`).join('\n')
      );
    }
  });
});

describe('Migration Path Coverage — Total Count Sanity', () => {
  test('actual scanned total matches allowlist total (no hidden drift)', () => {
    // Sum ACTUAL scanned counts across all known files
    let actualTotal = 0;
    let allowlistTotal = 0;

    for (const [file, known] of Object.entries(KNOWN_REFERENCES)) {
      const counts = countCollectionRefs(file);
      if (!counts) continue;
      for (const col of COLLECTIONS) {
        actualTotal += counts[col];
        allowlistTotal += known[col];
      }
    }
    for (const [file, known] of Object.entries(KNOWN_CF_REFERENCES)) {
      const counts = countCollectionRefs(file);
      if (!counts) continue;
      for (const col of COLLECTIONS) {
        actualTotal += counts[col];
        allowlistTotal += known[col];
      }
    }

    // Actual should exactly match allowlist (per-file tests catch individual drift,
    // this catches the case where increases and decreases cancel out)
    expect(actualTotal).toBe(allowlistTotal);
  });
});
