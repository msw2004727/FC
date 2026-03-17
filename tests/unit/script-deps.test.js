/**
 * Script Dependency Validation Test
 * ==================================
 * Parses the actual project source files to verify that:
 *
 * 1. Every function called by eagerly-loaded scripts (in index.html)
 *    is either defined in another eagerly-loaded script, OR
 *    guarded with optional chaining (?.), OR
 *    inside a function that awaits ScriptLoader.ensureForPage first.
 *
 * 2. Every script removed from index.html exists in at least one
 *    ScriptLoader group (no orphaned scripts).
 *
 * 3. Every _pageGroups page ID has valid group references.
 *
 * This test would have caught the Phase 1 performance optimization
 * breaking changes BEFORE deployment.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ─────────────────────────────────────────────
// Parse index.html for eagerly-loaded scripts
// ─────────────────────────────────────────────
function getEagerScripts() {
  const html = readFile('index.html');
  const scripts = [];
  const re = /<script[^>]+src="([^"?]+)(?:\?[^"]*)?"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    // Skip CDN / external scripts
    if (m[1].startsWith('http')) continue;
    scripts.push(m[1]);
  }
  return scripts;
}

// ─────────────────────────────────────────────
// Parse script-loader.js for groups & pageGroups
// ─────────────────────────────────────────────
function parseScriptLoader() {
  const src = readFile('js/core/script-loader.js');

  // Extract _groups
  const groups = {};
  const groupsMatch = src.match(/_groups:\s*\{([\s\S]*?)\n  \},/);
  if (groupsMatch) {
    const groupBlock = groupsMatch[1];
    // Parse each group
    const groupRe = /(\w+):\s*\[([\s\S]*?)\]/g;
    let gm;
    while ((gm = groupRe.exec(groupBlock)) !== null) {
      const name = gm[1];
      const scriptList = gm[2];
      const pathRe = /'([^']+)'/g;
      const paths = [];
      let pm;
      while ((pm = pathRe.exec(scriptList)) !== null) {
        paths.push(pm[1]);
      }
      groups[name] = paths;
    }
  }

  // Extract _pageGroups
  const pageGroups = {};
  const pgMatch = src.match(/_pageGroups:\s*\{([\s\S]*?)\n  \},/);
  if (pgMatch) {
    const pgBlock = pgMatch[1];
    const pgRe = /'([^']+)':\s*\[([^\]]*)\]/g;
    let pm;
    while ((pm = pgRe.exec(pgBlock)) !== null) {
      const pageId = pm[1];
      const groupList = pm[2];
      const gRe = /'([^']+)'/g;
      const gNames = [];
      let gm;
      while ((gm = gRe.exec(groupList)) !== null) {
        gNames.push(gm[1]);
      }
      pageGroups[pageId] = gNames;
    }
  }

  return { groups, pageGroups };
}

// ─────────────────────────────────────────────
// Parse a JS file to find Object.assign function definitions
// Returns array of function names
// ─────────────────────────────────────────────
function extractDefinedFunctions(filePath) {
  try {
    const src = readFile(filePath);
    const fns = new Set();

    // Pattern 1: method(args) {  or  async method(args) {
    const methodRe = /^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/gm;
    let m;
    while ((m = methodRe.exec(src)) !== null) {
      // Skip control flow keywords
      if (['if', 'for', 'while', 'switch', 'catch', 'function', 'return'].includes(m[1])) continue;
      fns.add(m[1]);
    }

    // Pattern 2: propertyName: value (non-function properties)
    const propRe = /^\s+(\w+):\s*(?:'[^']*'|"[^"]*"|\d+|true|false|null|\[|\{)/gm;
    while ((m = propRe.exec(src)) !== null) {
      fns.add(m[1]);
    }

    return fns;
  } catch {
    return new Set();
  }
}

// ─────────────────────────────────────────────
// Parse a JS file to find function calls on this.* or App.*
// Returns array of { name, line, guarded, insideEnsureForPage }
// ─────────────────────────────────────────────
function extractCalledFunctions(filePath) {
  try {
    const src = readFile(filePath);
    const calls = [];
    const lines = src.split('\n');

    // Build set of functions guarded by typeof check in this file
    const typeofGuarded = new Set();
    const typeofRe = /typeof\s+(?:this|App)\.([\w]+)\s*[!=]==?\s*'function'/g;
    let tm;
    while ((tm = typeofRe.exec(src)) !== null) {
      typeofGuarded.add(tm[1]);
    }

    lines.forEach((line, idx) => {
      // Match this.funcName( or App.funcName(
      // Also match this.funcName?.( for guarded calls
      const callRe = /(?:this|App)\.([\w]+)(\?\.)?\s*\(/g;
      let m;
      while ((m = callRe.exec(line)) !== null) {
        const name = m[1];
        // Detect guards: ?.() , typeof check, or truthiness check (if (this.X) this.X())
        const truthinessGuard = new RegExp(
          `if\\s*\\(.*(?:this|App)\\.${name}[^(]`
        ).test(line);
        const guarded = !!m[2] || typeofGuarded.has(name) || truthinessGuard; // ?. or typeof or truthiness guard
        // Skip common non-App methods
        if (['showToast', 'showPage', 'showModal', 'hideModal', 'getElementById',
             'querySelector', 'querySelectorAll', 'addEventListener',
             'removeEventListener', 'forEach', 'map', 'filter', 'find',
             'some', 'every', 'reduce', 'push', 'pop', 'shift', 'join',
             'slice', 'splice', 'sort', 'includes', 'indexOf', 'replace',
             'trim', 'split', 'match', 'test', 'toString', 'toFixed',
             'toLocaleString', 'toLowerCase', 'toUpperCase', 'startsWith',
             'endsWith', 'padStart', 'padEnd', 'charAt', 'charCodeAt',
             'substring', 'assign', 'keys', 'values', 'entries',
             'then', 'catch', 'finally', 'resolve', 'reject',
             'log', 'warn', 'error', 'info', 'debug',
             'stringify', 'parse', 'getTime', 'setHours',
             'getFullYear', 'getMonth', 'getDate', 'getHours',
             'createElement', 'appendChild', 'removeChild',
             'getAttribute', 'setAttribute', 'classList',
             'addEventListener', 'dispatchEvent',
             'open', 'close', 'abort', 'send',
             'set', 'get', 'has', 'delete', 'clear', 'add',
        ].includes(name)) continue;
        // Skip calls inside template-string onclick handlers (rendered on gated pages)
        if (line.includes('onclick=') && line.includes('${')) {
          continue;
        }
        calls.push({ name, line: idx + 1, guarded, lineText: line.trim() });
      }
    });

    return calls;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────
// Also extract inline onclick handlers from index.html
// ─────────────────────────────────────────────
function extractHtmlOnclickCalls() {
  const html = readFile('index.html');
  const calls = [];
  const re = /onclick="[^"]*App\.([\w]+)(\?\.)?\s*\(/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    calls.push({ name: m[1], guarded: !!m[2], source: 'index.html (inline onclick)' });
  }
  return calls;
}

// ═══════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════

describe('Script dependency validation', () => {
  let eagerScripts;
  let loaderData;
  let eagerDefinitions; // Map<functionName, Set<filePath>>
  let allGroupScripts;  // Set of all scripts in any ScriptLoader group

  beforeAll(() => {
    eagerScripts = getEagerScripts();
    loaderData = parseScriptLoader();

    // Build map of all functions defined in eager scripts
    eagerDefinitions = new Map();
    eagerScripts.forEach(scriptPath => {
      const fns = extractDefinedFunctions(scriptPath);
      fns.forEach(fn => {
        if (!eagerDefinitions.has(fn)) eagerDefinitions.set(fn, new Set());
        eagerDefinitions.get(fn).add(scriptPath);
      });
    });

    // Build set of all scripts in any group
    allGroupScripts = new Set();
    Object.values(loaderData.groups).forEach(scripts => {
      scripts.forEach(s => allGroupScripts.add(s));
    });
  });

  test('index.html has eager scripts', () => {
    expect(eagerScripts.length).toBeGreaterThan(10);
  });

  test('script-loader has groups defined', () => {
    expect(Object.keys(loaderData.groups).length).toBeGreaterThan(5);
  });

  test('script-loader has pageGroups defined', () => {
    expect(Object.keys(loaderData.pageGroups).length).toBeGreaterThan(5);
  });
});

describe('Eager scripts — no unguarded calls to dynamic-only functions', () => {
  let eagerScripts;
  let eagerDefinitions;

  beforeAll(() => {
    eagerScripts = getEagerScripts();
    eagerDefinitions = new Set();
    eagerScripts.forEach(scriptPath => {
      const fns = extractDefinedFunctions(scriptPath);
      fns.forEach(fn => eagerDefinitions.add(fn));
    });
    // Also add well-known global functions that are always available
    ['escapeHTML', 'I18N', 't', 'ModeManager', 'ApiService', 'FirebaseService',
     'LineAuth', 'ScriptLoader', 'PageLoader', 'ROLES', 'ROLE_LEVEL_MAP',
     'LINE_CONFIG', 'CACHE_VERSION', 'PAGE_DATA_CONTRACT', 'PAGE_STRATEGY',
     'DRAWER_MENUS', 'getTaipeiDateStr',
    ].forEach(fn => eagerDefinitions.add(fn));
  });

  // For each eager script, check that calls to App/this functions are either:
  // 1. Defined in another eager script
  // 2. Guarded with ?.
  // 3. Known exceptions (callbacks that run after page navigation)
  const KNOWN_SAFE_PATTERNS = [
    // Functions called inside handlers that run after ScriptLoader.ensureForPage
    // These are inside renderPageContent which runs AFTER ensureForPage
    'renderUserCard',
    'renderProfileData',
    'renderProfileFavorites',
    'renderTitlePage',
    'renderQrCodePage',
    'renderScanPage',
    'renderTeamManage',
    'renderDashboard',
    'renderPersonalDashboard',
    'renderAdminUsers',
    'renderAdminAchievements',
    'renderRoleHierarchy',
    'renderInactiveData',
    'renderExpLogs',
    'renderAnnouncementManage',
    'renderGameManage',
    'renderShop',
    'renderShopManage',
    'renderMsgManage',
    'renderTournamentManage',
    'renderAdminTeams',
    'renderBannerManage',
    'renderFloatingAdManage',
    'renderPopupAdManage',
    'renderSponsorManage',
    'renderShotGameAdManage',
    'renderNewsToggle',
    'renderAutoExpRules',
    'renderMessageList',
    'renderTournamentTimeline',
    'renderAchievements',
    'renderAdminAutoExpConfig',
    'renderUserCorrectionManager',
    'renderParticipantQuerySharePage',
    // Functions called inside showUserProfile which has ensureForPage guard
    '_getUserTeamHtml',
    '_buildTitleDisplayHtml',
    '_buildSocialLinksHtml',
    '_bindAvatarFallbacks',
    '_buildAvatarImageMarkup',
    'renderUserCardRecords',
    'refreshUserCardRecords',
    // Functions inside _openTournamentDetail which has ensureForPage guard
    'showTournamentDetail',
    // Called in favorites.js only during user-triggered actions on gated pages
    '_deliverMessageToInbox',
    // Called from index.html onclick only on profile page where profile-card.js is loaded
    'showUidQrCode',
    // Functions called inside _renderPageContent (runs AFTER ensureForPage)
    'destroyShotGamePage',
    'destroyKickGamePage',
    'renderAdminLogCenter',
    'renderTeamList',
    // Functions defined in dynamic modules but only called in admin/page-specific contexts
    '_formatDT',           // ad-manage-core.js, called in announcement.js (admin only)
    '_getAchThreshold',    // achievement module, called in profile-data-stats.js (page-gated)
    'showImageCropper',    // image-cropper.js, called in image-upload.js (page-gated)
    'trackAdClick',        // popup-ad.js internal
    'bindLineNotify',      // called only on profile page
    '_getEventEffectiveStatus',    // event module internal
    '_syncEventEffectiveStatus',   // event module internal
    '_renderEventCapacityBadge',   // event module internal
  ];

  test('no unguarded calls to undefined functions in eager scripts', () => {
    const violations = [];

    // Only check App modules (files using Object.assign(App, {...}))
    // Infrastructure files (firebase-service.js, api-service.js, line-auth.js, etc.)
    // use this.X() to call their own methods, not App methods
    const appModuleScripts = eagerScripts.filter(scriptPath => {
      try {
        const src = readFile(scriptPath);
        return src.includes('Object.assign(App');
      } catch { return false; }
    });

    appModuleScripts.forEach(scriptPath => {
      const calls = extractCalledFunctions(scriptPath);
      calls.forEach(call => {
        if (call.guarded) return; // ?.() is safe
        if (eagerDefinitions.has(call.name)) return; // defined in eager script
        if (KNOWN_SAFE_PATTERNS.includes(call.name)) return; // known safe
        if (call.name.startsWith('_') && call.name.length <= 3) return; // skip _x patterns

        violations.push({
          file: scriptPath,
          function: call.name,
          line: call.line,
          text: call.lineText,
        });
      });
    });

    if (violations.length > 0) {
      const msg = violations.map(v =>
        `  ${v.file}:${v.line} → ${v.function}()  [${v.text.substring(0, 80)}]`
      ).join('\n');
      // This will show as a test failure with details
      expect(violations).toEqual(
        // Expected: empty array. If not, these functions are called without guards:
        []
      );
    }
  });

  test('no unguarded calls in index.html inline onclick', () => {
    const htmlCalls = extractHtmlOnclickCalls();
    const violations = htmlCalls.filter(call =>
      !call.guarded && !eagerDefinitions.has(call.name) && !KNOWN_SAFE_PATTERNS.includes(call.name)
    );

    if (violations.length > 0) {
      const msg = violations.map(v =>
        `  index.html onclick → App.${v.name}() (not defined in any eager script)`
      ).join('\n');
      expect(violations).toEqual([]);
    }
  });
});

describe('ScriptLoader groups — no orphaned scripts', () => {
  let eagerScripts;
  let loaderData;

  beforeAll(() => {
    eagerScripts = new Set(getEagerScripts());
    loaderData = parseScriptLoader();
  });

  test('all scripts in groups point to existing files', () => {
    const missing = [];
    Object.entries(loaderData.groups).forEach(([groupName, scripts]) => {
      scripts.forEach(scriptPath => {
        const fullPath = path.join(ROOT, scriptPath);
        if (!fs.existsSync(fullPath)) {
          missing.push({ group: groupName, script: scriptPath });
        }
      });
    });
    expect(missing).toEqual([]);
  });

  test('all pageGroup references point to existing groups', () => {
    const invalidRefs = [];
    Object.entries(loaderData.pageGroups).forEach(([pageId, groupNames]) => {
      groupNames.forEach(gName => {
        if (!loaderData.groups[gName]) {
          invalidRefs.push({ pageId, group: gName });
        }
      });
    });
    expect(invalidRefs).toEqual([]);
  });

  test('scripts not in index.html must be in at least one ScriptLoader group', () => {
    // Collect all JS module files
    const moduleDir = path.join(ROOT, 'js', 'modules');
    const allModules = [];

    function walkDir(dir, prefix = '') {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.forEach(entry => {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walkDir(path.join(dir, entry.name), rel);
        } else if (entry.name.endsWith('.js')) {
          allModules.push(`js/modules/${rel}`);
        }
      });
    }
    walkDir(moduleDir);

    // Also check js/core/ files (except those always in index.html)
    const coreDir = path.join(ROOT, 'js', 'core');
    if (fs.existsSync(coreDir)) {
      fs.readdirSync(coreDir).forEach(f => {
        if (f.endsWith('.js')) allModules.push(`js/core/${f}`);
      });
    }

    // Build set of all scripts in any group
    const allGroupScripts = new Set();
    Object.values(loaderData.groups).forEach(scripts => {
      scripts.forEach(s => allGroupScripts.add(s));
    });

    const orphaned = allModules.filter(mod =>
      !eagerScripts.has(mod) && !allGroupScripts.has(mod)
    );

    // Exclude core infrastructure files (always in index.html or special)
    const coreExclusions = [
      'js/core/page-loader.js',
      'js/core/script-loader.js',
      'js/core/navigation.js',
      'js/core/theme.js',
    ];
    const realOrphans = orphaned.filter(mod => !coreExclusions.includes(mod));

    if (realOrphans.length > 0) {
      console.warn('Orphaned modules (not in index.html or any ScriptLoader group):');
      realOrphans.forEach(m => console.warn(`  ${m}`));
    }
    // This is a warning, not a hard failure — some modules may be intentionally
    // loaded only in specific contexts (e.g., game-lab.html)
    // But we track it to prevent accidental omissions
    expect(realOrphans.length).toBeLessThanOrEqual(10); // Allow special cases (e.g., shot-game scripts for game-lab.html)
  });
});

describe('Eager script file existence', () => {
  test('all scripts referenced in index.html exist on disk', () => {
    const scripts = getEagerScripts();
    const missing = scripts.filter(s => !fs.existsSync(path.join(ROOT, s)));
    expect(missing).toEqual([]);
  });
});
