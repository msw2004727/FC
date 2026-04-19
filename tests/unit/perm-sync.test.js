/**
 * Permission Sync — CRITICAL cross-system consistency test
 *
 * INHERENT_ROLE_PERMISSIONS is defined in TWO places (no build process
 * means they cannot share a module):
 *   1. js/config.js          — used by the frontend
 *   2. functions/index.js    — used by Cloud Functions (backend)
 *
 * Per CLAUDE.md mandatory rule:
 *   "修改任一邊時必須同步更新另一邊，否則前端 UI 顯示與
 *    後端驗證行為將出現無錯誤訊息的靜默分歧。"
 *
 * This test reads BOTH files from disk, extracts the constant via regex,
 * and HARD FAILs if they differ in any way.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ===========================================================================
// Helper: read file contents
// ===========================================================================
function readFileContent(relPath) {
  const fullPath = path.join(PROJECT_ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error('File not found: ' + relPath);
  }
  return fs.readFileSync(fullPath, 'utf-8');
}

// ===========================================================================
// Helper: extract INHERENT_ROLE_PERMISSIONS object from source text
//
// Matches the pattern:
//   const INHERENT_ROLE_PERMISSIONS = Object.freeze({
//     role: [...],
//     ...
//   });
//
// Returns the raw block text and a parsed representation.
// ===========================================================================
function extractInherentRolePermissions(sourceText, fileName) {
  // Match the Object.freeze({...}) block
  const pattern = /INHERENT_ROLE_PERMISSIONS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/;
  const match = sourceText.match(pattern);
  if (!match) {
    throw new Error(
      'Could not find INHERENT_ROLE_PERMISSIONS in ' + fileName +
      '. The constant may have been renamed or restructured.'
    );
  }

  const rawBlock = match[1].trim();

  // Parse each role line:  role: ['perm1', 'perm2'],
  // or role: ["perm1", "perm2"],
  const rolePattern = /(\w+)\s*:\s*\[([^\]]*)\]/g;
  const parsed = {};
  let roleMatch;
  while ((roleMatch = rolePattern.exec(rawBlock)) !== null) {
    const roleName = roleMatch[1];
    const permsRaw = roleMatch[2];
    // Extract quoted strings (both single and double quotes)
    const permStrings = [];
    const strPattern = /['"]([^'"]+)['"]/g;
    let strMatch;
    while ((strMatch = strPattern.exec(permsRaw)) !== null) {
      permStrings.push(strMatch[1]);
    }
    parsed[roleName] = permStrings.sort();
  }

  return { rawBlock, parsed };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('INHERENT_ROLE_PERMISSIONS cross-system sync (CRITICAL)', () => {
  let configContent, functionsContent;
  let configPerms, functionsPerms;

  beforeAll(() => {
    configContent = readFileContent('js/config.js');
    functionsContent = readFileContent('functions/index.js');

    configPerms = extractInherentRolePermissions(configContent, 'js/config.js');
    functionsPerms = extractInherentRolePermissions(functionsContent, 'functions/index.js');
  });

  test('INHERENT_ROLE_PERMISSIONS exists in js/config.js', () => {
    expect(configPerms.parsed).toBeDefined();
    expect(Object.keys(configPerms.parsed).length).toBeGreaterThan(0);
  });

  test('INHERENT_ROLE_PERMISSIONS exists in functions/index.js', () => {
    expect(functionsPerms.parsed).toBeDefined();
    expect(Object.keys(functionsPerms.parsed).length).toBeGreaterThan(0);
  });

  test('both files have the SAME role keys', () => {
    const configRoles = Object.keys(configPerms.parsed).sort();
    const functionsRoles = Object.keys(functionsPerms.parsed).sort();

    // Check for extra roles in config.js
    const extraInConfig = configRoles.filter(r => !functionsRoles.includes(r));
    if (extraInConfig.length > 0) {
      throw new Error(
        'SYNC VIOLATION: js/config.js has roles not in functions/index.js: ' +
        extraInConfig.join(', ')
      );
    }

    // Check for extra roles in functions/index.js
    const extraInFunctions = functionsRoles.filter(r => !configRoles.includes(r));
    if (extraInFunctions.length > 0) {
      throw new Error(
        'SYNC VIOLATION: functions/index.js has roles not in js/config.js: ' +
        extraInFunctions.join(', ')
      );
    }

    expect(configRoles).toEqual(functionsRoles);
  });

  test('all permission codes are IDENTICAL for each role', () => {
    const configRoles = Object.keys(configPerms.parsed).sort();

    for (const role of configRoles) {
      const configPermissions = configPerms.parsed[role];
      const functionsPermissions = functionsPerms.parsed[role];

      if (!functionsPermissions) {
        throw new Error(
          'SYNC VIOLATION: role "' + role + '" missing from functions/index.js'
        );
      }

      // Check for extra permissions in config
      const extraInConfig = configPermissions.filter(p => !functionsPermissions.includes(p));
      if (extraInConfig.length > 0) {
        throw new Error(
          'SYNC VIOLATION for role "' + role + '": js/config.js has extra permissions: ' +
          extraInConfig.join(', ')
        );
      }

      // Check for extra permissions in functions
      const extraInFunctions = functionsPermissions.filter(p => !configPermissions.includes(p));
      if (extraInFunctions.length > 0) {
        throw new Error(
          'SYNC VIOLATION for role "' + role + '": functions/index.js has extra permissions: ' +
          extraInFunctions.join(', ')
        );
      }

      expect(configPermissions).toEqual(functionsPermissions);
    }
  });

  test('no extra or missing entries — exact match', () => {
    // Deep equality of the entire parsed structure
    expect(configPerms.parsed).toEqual(functionsPerms.parsed);
  });

  test('specific known roles are present in both', () => {
    // Based on current source: coach, captain, venue_owner
    const expectedRoles = ['coach', 'captain', 'venue_owner'];
    for (const role of expectedRoles) {
      expect(configPerms.parsed).toHaveProperty(role);
      expect(functionsPerms.parsed).toHaveProperty(role);
    }
  });

  test('specific known permissions are present for each role', () => {
    // Activity-core roles must have activity.manage.entry + admin.tournaments.entry
    // super_admin is INHERENT for admin.repair.event_blocklist only
    // (added 2026-04-20 for event blocklist feature)
    const ACTIVITY_CORE_ROLES = ['coach', 'captain', 'venue_owner'];
    const ACTIVITY_CORE_PERMS = ['activity.manage.entry', 'admin.tournaments.entry'];

    for (const role of ACTIVITY_CORE_ROLES) {
      for (const perm of ACTIVITY_CORE_PERMS) {
        expect(configPerms.parsed[role]).toContain(perm);
        expect(functionsPerms.parsed[role]).toContain(perm);
      }
    }

    // super_admin INHERENT scoped to admin.repair.event_blocklist
    if (configPerms.parsed.super_admin) {
      expect(configPerms.parsed.super_admin).toContain('admin.repair.event_blocklist');
      expect(functionsPerms.parsed.super_admin).toContain('admin.repair.event_blocklist');
    }
  });

  test('both files have the sync warning comment', () => {
    // Verify both files have the mandatory sync comment
    expect(configContent).toContain('functions/index.js');
    expect(configContent).toContain('INHERENT_ROLE_PERMISSIONS');
    expect(functionsContent).toContain('js/config.js');
    expect(functionsContent).toContain('INHERENT_ROLE_PERMISSIONS');
  });
});
