/**
 * ScriptLoader — unit tests
 *
 * Extracted from js/core/script-loader.js
 * Tests: URL normalization, group deduplication, page group resolution
 */

// ---------------------------------------------------------------------------
// Extracted from script-loader.js:15-23
// Adapted: accept a baseHref parameter instead of using window.location
// ---------------------------------------------------------------------------
function _normalizeLocalSrc(src, baseHref) {
  try {
    const url = new URL(src, baseHref);
    const origin = new URL(baseHref).origin;
    if (url.origin !== origin) return null;
    return decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Simulated loadGroup filter logic (script-loader.js:52-57)
// Only tests the filtering logic, not actual DOM script injection
// ---------------------------------------------------------------------------
function filterToLoad(scripts, loaded) {
  return scripts.filter(s => !loaded[s]);
}

function collectPreloadScripts(groups, manualOnlyGroups, loaded = {}) {
  return Object.entries(groups)
    .filter(([groupName]) => !manualOnlyGroups[groupName])
    .flatMap(([, scripts]) => scripts)
    .filter(src => !loaded[src]);
}

// ---------------------------------------------------------------------------
// Simulated ensureForPage deduplication logic (script-loader.js:250-267)
// ---------------------------------------------------------------------------
function resolvePageScripts(pageId, pageGroups, groups) {
  const groupNames = pageGroups[pageId] || [];
  if (groupNames.length === 0) return [];

  const orderedScripts = [];
  const seen = new Set();

  groupNames.forEach(groupName => {
    const scripts = groups[groupName] || [];
    scripts.forEach(src => {
      if (seen.has(src)) return;
      seen.add(src);
      orderedScripts.push(src);
    });
  });

  return orderedScripts;
}

// ═══════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════

const BASE = 'https://example.com/';

describe('_normalizeLocalSrc', () => {
  test('normalizes relative path', () => {
    expect(_normalizeLocalSrc('js/config.js', BASE)).toBe('js/config.js');
  });

  test('normalizes absolute path on same origin', () => {
    expect(_normalizeLocalSrc('/js/config.js', BASE)).toBe('js/config.js');
  });

  test('normalizes URL with query string', () => {
    expect(_normalizeLocalSrc('js/config.js?v=123', BASE)).toBe('js/config.js');
  });

  test('normalizes URL with hash', () => {
    expect(_normalizeLocalSrc('js/config.js#section', BASE)).toBe('js/config.js');
  });

  test('normalizes full same-origin URL', () => {
    expect(_normalizeLocalSrc('https://example.com/js/config.js', BASE)).toBe('js/config.js');
  });

  test('returns null for external URLs', () => {
    expect(_normalizeLocalSrc('https://cdn.example.com/lib.js', BASE)).toBeNull();
    expect(_normalizeLocalSrc('https://other.com/js/config.js', BASE)).toBeNull();
  });

  test('returns null for invalid URLs', () => {
    expect(_normalizeLocalSrc('', BASE)).toBe('');
    // Completely invalid protocol
    expect(_normalizeLocalSrc('://broken', 'not-a-url')).toBeNull();
  });

  test('decodes URL-encoded paths', () => {
    expect(_normalizeLocalSrc('js/modules/%E4%B8%AD%E6%96%87.js', BASE)).toBe('js/modules/中文.js');
  });

  test('handles nested paths', () => {
    expect(_normalizeLocalSrc('js/modules/tournament/tournament-core.js', BASE))
      .toBe('js/modules/tournament/tournament-core.js');
  });
});

describe('filterToLoad', () => {
  test('returns all scripts when none loaded', () => {
    const result = filterToLoad(['a.js', 'b.js', 'c.js'], {});
    expect(result).toEqual(['a.js', 'b.js', 'c.js']);
  });

  test('filters out already loaded scripts', () => {
    const loaded = { 'a.js': true, 'c.js': true };
    const result = filterToLoad(['a.js', 'b.js', 'c.js'], loaded);
    expect(result).toEqual(['b.js']);
  });

  test('returns empty array when all loaded', () => {
    const loaded = { 'a.js': true, 'b.js': true };
    const result = filterToLoad(['a.js', 'b.js'], loaded);
    expect(result).toEqual([]);
  });

  test('handles empty input', () => {
    expect(filterToLoad([], {})).toEqual([]);
  });
});

describe('manual-only preload filtering', () => {
  test('excludes public activity map and event location picker groups from idle preload', () => {
    const groups = {
      activity: ['js/modules/event/event-location-draft.js', 'js/modules/event/event-create.js'],
      activityMap: ['js/modules/event/event-map-geo.js', 'js/modules/event/event-map.js'],
      eventLocationPicker: [
        'js/modules/event/event-location-draft.js',
        'js/modules/event/event-map-geo.js',
        'js/modules/event/event-location-picker.js',
      ],
    };
    const preload = collectPreloadScripts(groups, {
      activityMap: true,
      eventLocationPicker: true,
    });

    expect(preload).toContain('js/modules/event/event-location-draft.js');
    expect(preload).not.toContain('js/modules/event/event-map.js');
    expect(preload).not.toContain('js/modules/event/event-map-geo.js');
    expect(preload).not.toContain('js/modules/event/event-location-picker.js');
  });
});

describe('resolvePageScripts', () => {
  const groups = {
    groupA: ['a1.js', 'a2.js', 'shared.js'],
    groupB: ['b1.js', 'shared.js', 'b2.js'],
    groupC: ['c1.js'],
  };
  const pageGroups = {
    'page-x': ['groupA'],
    'page-y': ['groupA', 'groupB'],
    'page-z': ['groupC'],
  };

  test('returns scripts for single group', () => {
    const result = resolvePageScripts('page-x', pageGroups, groups);
    expect(result).toEqual(['a1.js', 'a2.js', 'shared.js']);
  });

  test('deduplicates shared scripts across groups', () => {
    const result = resolvePageScripts('page-y', pageGroups, groups);
    expect(result).toEqual(['a1.js', 'a2.js', 'shared.js', 'b1.js', 'b2.js']);
    // shared.js appears once (from groupA)
    expect(result.filter(s => s === 'shared.js')).toHaveLength(1);
  });

  test('returns empty array for unknown page', () => {
    const result = resolvePageScripts('page-unknown', pageGroups, groups);
    expect(result).toEqual([]);
  });

  test('handles missing group gracefully', () => {
    const customPageGroups = { 'page-broken': ['nonExistentGroup'] };
    const result = resolvePageScripts('page-broken', customPageGroups, groups);
    expect(result).toEqual([]);
  });

  test('preserves order within groups', () => {
    const result = resolvePageScripts('page-z', pageGroups, groups);
    expect(result).toEqual(['c1.js']);
  });
});

describe('resolvePageScripts — real project groups', () => {
  // Subset of the actual _groups and _pageGroups from script-loader.js
  const realGroups = {
    tournamentList: [
      'js/modules/tournament/tournament-helpers.js',
      'js/modules/tournament/tournament-core.js',
      'js/modules/tournament/tournament-render.js',
    ],
    tournamentDetail: [
      'js/modules/team/team-list-helpers.js',
      'js/modules/tournament/tournament-helpers.js',
      'js/modules/tournament/tournament-core.js',
      'js/modules/tournament/tournament-render.js',
      'js/modules/event/event-share-builders.js',
      'js/modules/event/event-share.js',
      'js/modules/tournament/tournament-share-builders.js',
      'js/modules/tournament/tournament-detail.js',
      'js/modules/tournament/tournament-friendly-apply-state.js',
      'js/modules/tournament/tournament-friendly-state.js',
      'js/modules/tournament/tournament-friendly-detail.js',
      'js/modules/tournament/tournament-friendly-withdraw.js',
      'js/modules/tournament/tournament-friendly-detail-view.js',
      'js/modules/tournament/tournament-share.js',
      'js/modules/tournament/tournament-friendly-roster.js',
      'js/modules/tournament/tournament-friendly-notify.js',
    ],
    teamList: [
      'js/modules/team/team-list-helpers.js',
      'js/modules/team/team-list-stats.js',
      'js/modules/team/team-list.js',
      'js/modules/team/team-list-render.js',
    ],
    teamDetail: [
      'js/modules/auto-exp/index.js',
      'js/modules/event/event-share-builders.js',
      'js/modules/event/event-share.js',
      'js/modules/team/team-detail.js',
      'js/modules/team/team-contact-links.js',
      'js/modules/team/team-detail-render.js',
      'js/modules/team/team-detail-v2-render.js',
      'js/modules/team/team-detail-v2-panels.js',
      'js/modules/team/team-detail-v2-lists.js',
      'js/modules/team/team-detail-v2-actions.js',
      'js/modules/team/team-detail-invite.js',
      'js/modules/team/team-share-builders.js',
      'js/modules/team/team-share.js',
      'js/modules/team/team-form-join.js',
    ],
    teamForm: [
      'js/modules/team/team-form-search.js',
      'js/modules/team/team-contact-links.js',
      'js/modules/team/team-form-init.js',
      'js/modules/team/team-form-validate.js',
      'js/modules/team/team-form-roles.js',
      'js/modules/team/team-form.js',
    ],
    message: [
      'js/modules/message/message-actions.js',
      'js/modules/message/message-actions-team.js',
      'js/modules/message/message-inbox.js',
    ],
    activity: [
      'js/modules/event/event-detail.js',
    ],
    profile: [
      'js/modules/auto-exp/index.js',
      'js/modules/auto-exp/rules.js',
      'js/modules/profile/profile-avatar.js',
      'js/modules/profile/profile-core.js',
      'js/modules/profile/profile-form.js',
      'js/modules/profile/profile-data.js',
      'js/modules/profile/profile-data-render.js',
      'js/modules/profile/profile-data-stats.js',
      'js/modules/profile/profile-data-history.js',
      'js/modules/leaderboard.js',
    ],
    achievement: [
      'js/modules/image-cropper.js',
      'js/modules/image-upload.js',
      'js/modules/achievement/index.js',
    ],
    achievementProfile: [
      'js/modules/auto-exp/index.js',
      'js/modules/auto-exp/rules.js',
      'js/modules/achievement/index.js',
      'js/modules/achievement/registry.js',
      'js/modules/achievement/shared.js',
      'js/modules/achievement/stats.js',
      'js/modules/achievement/evaluator.js',
      'js/modules/achievement/badges.js',
      'js/modules/achievement/titles.js',
      'js/modules/achievement/profile.js',
      'js/modules/achievement.js',
    ],
    profileCard: [
      'js/modules/profile/profile-card.js',
    ],
    profileShare: [
      'js/modules/event/event-share-builders.js',
      'js/modules/event/event-share.js',
      'js/modules/profile/profile-share.js',
    ],
    profileScene: [
      'js/modules/color-cat/color-cat-config.js',
      'js/modules/color-cat/color-cat-scene.js',
    ],
  };
  const realPageGroups = {
    'page-tournaments': ['tournamentList'],
    'page-tournament-detail': ['tournamentDetail'],
    'page-activity-detail': ['activity', 'achievement', 'profileCard'],
    'page-teams': ['teamList'],
    'page-team-detail': ['teamList', 'teamDetail'],
    'page-team-manage': ['teamList', 'teamForm'],
    'page-messages': ['message'],
    'page-profile': ['profile'],
    'page-qrcode': ['profile', 'profileCard'],
    'page-user-card': ['profile', 'achievementProfile', 'profileCard', 'profileShare'],
  };

  test('page-tournaments loads list-only tournament group', () => {
    const result = resolvePageScripts('page-tournaments', realPageGroups, realGroups);
    expect(result).toContain('js/modules/tournament/tournament-render.js');
    expect(result).not.toContain('js/modules/tournament/tournament-detail.js');
    expect(result).toHaveLength(3);
  });

  test('page-tournament-detail loads detail tournament group', () => {
    const result = resolvePageScripts('page-tournament-detail', realPageGroups, realGroups);
    expect(result).toContain('js/modules/tournament/tournament-render.js');
    expect(result).toContain('js/modules/tournament/tournament-detail.js');
    expect(result).toContain('js/modules/event/event-share.js');
    expect(result.indexOf('js/modules/event/event-share.js')).toBeLessThan(
      result.indexOf('js/modules/tournament/tournament-share.js'),
    );
  });

  test('page-activity-detail loads profile card actions for host contact', () => {
    const result = resolvePageScripts('page-activity-detail', realPageGroups, realGroups);
    expect(result).toContain('js/modules/event/event-detail.js');
    expect(result).toContain('js/modules/profile/profile-card.js');
  });

  test('page-teams loads only lean team list scripts', () => {
    const result = resolvePageScripts('page-teams', realPageGroups, realGroups);
    expect(result).toEqual([
      'js/modules/team/team-list-helpers.js',
      'js/modules/team/team-list-stats.js',
      'js/modules/team/team-list.js',
      'js/modules/team/team-list-render.js',
    ]);
    expect(result).not.toContain('js/modules/team/team-detail.js');
    expect(result).not.toContain('js/modules/team/team-form.js');
    expect(result).not.toContain('js/modules/team/team-share.js');
  });

  test('team detail gets list helpers plus detail actions without loading edit form upfront', () => {
    const result = resolvePageScripts('page-team-detail', realPageGroups, realGroups);
    expect(result).toContain('js/modules/team/team-list-stats.js');
    expect(result).toContain('js/modules/team/team-detail.js');
    expect(result).toContain('js/modules/team/team-form-join.js');
    expect(result).not.toContain('js/modules/team/team-form.js');
  });

  test('team manage loads list renderer and form scripts', () => {
    const result = resolvePageScripts('page-team-manage', realPageGroups, realGroups);
    expect(result).toContain('js/modules/team/team-list-render.js');
    expect(result).toContain('js/modules/team/team-form-init.js');
    expect(result).toContain('js/modules/team/team-form.js');
  });

  test('page-profile keeps first navigation lean', () => {
    const result = resolvePageScripts('page-profile', realPageGroups, realGroups);
    expect(result).toContain('js/modules/profile/profile-data-render.js');
    expect(result).toContain('js/modules/leaderboard.js');
    expect(result).not.toContain('js/modules/achievement/index.js');
    expect(result).not.toContain('js/modules/profile/profile-card.js');
    expect(result).not.toContain('js/modules/profile/profile-share.js');
    expect(result).not.toContain('js/modules/color-cat/color-cat-scene.js');
  });

  test('page-qrcode keeps card renderer available after profile split', () => {
    const result = resolvePageScripts('page-qrcode', realPageGroups, realGroups);
    expect(result).toContain('js/modules/profile/profile-card.js');
  });

  test('page-user-card loads profile extras without duplicating shared auto-exp scripts', () => {
    const result = resolvePageScripts('page-user-card', realPageGroups, realGroups);
    expect(result).toContain('js/modules/achievement/index.js');
    expect(result).toContain('js/modules/profile/profile-card.js');
    expect(result).toContain('js/modules/profile/profile-share.js');
    expect(result.filter(s => s === 'js/modules/auto-exp/index.js')).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════
//  detailCoreSplit（Wave 2 拆包）— 載入「真實 script-loader.js」驗證
//  分拆一致性 / 映射 / fallback / 平行預載 flag
// ═══════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadRealScriptLoader({
  splitEnabled = false,
  auxOnDemand = true,
  performanceFlags = {},
  immediateTimers = false,
  documentOverrides = {},
} = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../js/core/script-loader.js'), 'utf8');
  let SL = null;
  const context = {
    console,
    setTimeout: immediateTimers ? ((fn) => { fn(); return 0; }) : setTimeout,
    clearTimeout,
    CACHE_VERSION: 'test',
    PERFORMANCE_FLAGS: performanceFlags,
    shouldUseActivityDetailOptimization: (k) => {
      if (k === 'detailCoreSplit') return splitEnabled;
      if (k === 'detailAuxModulesOnDemand') return auxOnDemand;
      return false;
    },
    window: { location: { origin: 'https://example.com', href: 'https://example.com/' } },
    document: {
      querySelectorAll: () => [],
      createElement: () => ({}),
      head: { appendChild: () => {} },
      ...documentOverrides,
      head: {
        appendChild: () => {},
        ...(documentOverrides.head || {}),
      },
    },
    __EXPORT__: (x) => { SL = x; },
  };
  vm.createContext(context);
  vm.runInContext(source + '\n;__EXPORT__(ScriptLoader);', context);
  SL._domPrimed = true; // 跳過 DOM priming
  return SL;
}

describe('dynamic script timeout recovery', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('a hung script rejects, clears pending state, and can be retried', async () => {
    jest.useFakeTimers();
    const appended = [];
    const SL = loadRealScriptLoader({
      documentOverrides: {
        createElement: () => ({ remove: jest.fn() }),
        head: { appendChild: script => appended.push(script) },
      },
    });
    SL._getLoadTimeoutMs = () => 50;

    const first = SL._load('js/hung.js');
    const rejection = expect(first).rejects.toMatchObject({
      code: 'script-load-timeout',
      src: 'js/hung.js',
    });
    expect(SL.hasPendingLoads()).toBe(true);

    await jest.advanceTimersByTimeAsync(50);
    await rejection;
    expect(appended[0].remove).toHaveBeenCalledTimes(1);
    expect(SL.hasPendingLoads()).toBe(false);

    const retry = SL._load('js/hung.js');
    expect(appended).toHaveLength(2);
    appended[1].onload();
    await expect(retry).resolves.toBeUndefined();
    expect(SL._loaded['js/hung.js']).toBe(true);
    expect(SL.hasPendingLoads()).toBe(false);
  });
});

describe('detailCoreSplit — 延後群組一致性（真實群組定義）', () => {
  const SL = loadRealScriptLoader();
  const a = SL._groups.activity;
  const core = SL._groups.activityDetailCore;
  const attendance = SL._groups.activityDetailAttendance;
  const create = SL._groups.activityCreate;
  const manage = SL._groups.activityManage;

  test('聯集 = activity，僅 create-options 為明確共享依賴', () => {
    const union = [...core, ...attendance, ...create, ...manage];
    const unique = new Set(union);
    const duplicates = [...unique].filter(file => union.filter(item => item === file).length > 1);
    expect(unique.size).toBe(a.length);
    expect([...unique].sort()).toEqual([...a].sort());
    expect(duplicates).toEqual(['js/modules/event/event-create-options.js']);
  });

  test('保持原 activity group 內的相對順序', () => {
    const idx = (s) => a.indexOf(s);
    [core, attendance, create, manage].forEach(arr => {
      arr.forEach((s, i) => {
        if (i > 0) expect(idx(arr[i - 1])).toBeLessThan(idx(s));
      });
    });
  });

  test('首屏必留核心檔在 activityDetailCore（7A 矩陣 §1/§2）', () => {
    [
      'js/modules/event/event-manage.js',
      'js/modules/event/event-create-options.js',
      'js/modules/event/event-detail.js',
      'js/modules/event/event-detail-signup.js',
      'js/modules/event/event-detail-companion.js',
    ].forEach(f => expect(core).toContain(f));
    [
      'js/modules/event/event-manage-attendance.js',
      'js/modules/event/event-manage-badges.js',
      'js/modules/event/event-manage-noshow.js',
    ].forEach(f => {
      expect(core).not.toContain(f);
      expect(attendance).toContain(f);
    });
  });

  test('延後群組內容正確（create 12 檔，含共享 options / manage 5 檔）', () => {
    expect(create).toHaveLength(12);
    expect(attendance).toHaveLength(3);
    expect(manage).toHaveLength(5);
    expect(create).toContain('js/modules/event/event-create.js');
    expect(create).toContain('js/modules/event/event-location-draft.js');
    expect(create).toContain('js/modules/event/event-create-options.js');
    expect(manage).toEqual([
      'js/modules/event/event-manage-instant-save.js',
      'js/modules/event/event-manage-confirm.js',
      'js/modules/event/event-manage-lifecycle.js',
      'js/modules/event/event-manage-waitlist.js',
      'js/modules/event/event-manage-visibility.js',
    ]);
  });

  test('新群組登記 manual-only，避免 preloadAll 重複列舉', () => {
    expect(SL._manualOnlyGroups.activityDetailCore).toBe(true);
    expect(SL._manualOnlyGroups.activityDetailAttendance).toBe(true);
    expect(SL._manualOnlyGroups.activityCreate).toBe(true);
    expect(SL._manualOnlyGroups.activityManage).toBe(true);
  });
});

describe('detailCoreSplit — 頁面映射（_resolvePageGroups）', () => {
  test('flag 關閉：所有頁面映射與現行完全相同', () => {
    const SL = loadRealScriptLoader({ splitEnabled: false });
    expect(SL._resolvePageGroups('page-activity-detail')).toEqual(['activity', 'achievement', 'profileCard']);
    expect(SL._resolvePageGroups('page-activities')).toEqual(['activityList']);
    expect(SL._resolvePageGroups('page-my-activities')).toEqual(['activity']);
  });

  test('flag 開啟：僅 page-activity-detail 換用 activityDetailCore，其餘頁不受影響', () => {
    const SL = loadRealScriptLoader({ splitEnabled: true });
    expect(SL._resolvePageGroups('page-activity-detail')).toEqual(['activityDetailCore']);
    expect(SL._resolvePageGroups('page-activities')).toEqual(['activityList']);
    expect(SL._resolvePageGroups('page-my-activities')).toEqual(['activity']);
    expect(SL._resolvePageGroups('page-team-detail')).toEqual(['teamList', 'teamDetail']);
  });

  test('education loads lesson share before lesson renderer and controller', () => {
    const SL = loadRealScriptLoader({ splitEnabled: true });
    const group = SL._groups.education;
    const shareIndex = group.indexOf('js/modules/education/edu-course-lesson-share.js');
    expect(shareIndex).toBeGreaterThan(group.indexOf('js/modules/education/edu-course-plan-render.js'));
    expect(shareIndex).toBeLessThan(group.indexOf('js/modules/education/edu-course-lessons-render.js'));
    expect(shareIndex).toBeLessThan(group.indexOf('js/modules/education/edu-course-lessons.js'));
  });

  test('aux on-demand flag off keeps detail attendance/profile/achievement in the detail page load', () => {
    const SL = loadRealScriptLoader({ splitEnabled: true, auxOnDemand: false });
    expect(SL._resolvePageGroups('page-activity-detail')).toEqual([
      'activityDetailCore',
      'activityDetailAttendance',
      'achievement',
      'profileCard',
    ]);
  });

  test('flag 讀取失敗（helper 不存在）→ 安全退回完整 activity', () => {
    const SL = loadRealScriptLoader({ splitEnabled: true });
    // 模擬 shouldUseActivityDetailOptimization 缺席（如測試環境 / 載入順序異常）
    SL._detailCoreSplitEnabled = function () { return false; };
    expect(SL._resolvePageGroups('page-activity-detail')).toEqual(['activity', 'achievement', 'profileCard']);
  });
});

describe('activity list and detail preload boundaries', () => {
  const deferredAttendanceScripts = [
    'js/modules/event/event-manage-attendance.js',
    'js/modules/event/event-manage-badges.js',
    'js/modules/event/event-manage-noshow.js',
  ];

  test('page-activities remains list-only regardless of detail aux flag', () => {
    [true, false].forEach(auxOnDemand => {
      const SL = loadRealScriptLoader({ splitEnabled: true, auxOnDemand });
      const scripts = SL._resolvePagePreloadScripts('page-activities');

      expect(scripts).toContain('js/modules/event/event-list-timeline.js');
      deferredAttendanceScripts.forEach(src => expect(scripts).not.toContain(src));
      expect(scripts).not.toContain('js/modules/event/event-detail.js');
      expect(scripts).not.toContain('js/modules/event/event-create.js');
      expect(scripts).not.toContain('js/modules/event/event-manage.js');
    });
  });

  test('preloadAll does not execute deferred attendance scripts', () => {
    const SL = loadRealScriptLoader({
      splitEnabled: true,
      auxOnDemand: true,
      immediateTimers: true,
    });
    const loadedScripts = [];
    SL.loadGroup = async (scripts) => {
      loadedScripts.push(...scripts);
      scripts.forEach(src => { SL._loaded[src] = true; });
    };

    SL.preloadAll();

    deferredAttendanceScripts.forEach(src => expect(loadedScripts).not.toContain(src));
    expect(loadedScripts).toContain('js/modules/event/event-detail.js');
  });

  test('executable idle preload is fail-closed unless explicitly enabled', async () => {
    const SL = loadRealScriptLoader({ immediateTimers: true });
    const loadedScripts = [];
    SL.loadGroup = async scripts => { loadedScripts.push(...scripts); };

    SL.preloadCorePagesExecutable();
    await Promise.resolve();

    expect(loadedScripts).toEqual([]);
  });

  test('explicit executable preload still respects deferred detail modules', async () => {
    const SL = loadRealScriptLoader({
      splitEnabled: true,
      auxOnDemand: true,
      performanceFlags: { idleModuleExecutionPreload: true },
      immediateTimers: true,
    });
    const loadedScripts = [];
    SL.loadGroup = async (scripts) => {
      loadedScripts.push(...scripts);
      scripts.forEach(src => { SL._loaded[src] = true; });
    };

    SL.preloadCorePagesExecutable();
    await Promise.resolve();

    deferredAttendanceScripts.forEach(src => expect(loadedScripts).not.toContain(src));
    expect(loadedScripts).toContain('js/modules/event/event-list-timeline.js');
  });
});

describe('detailCoreSplit — isPageReady 與 ensureForPage fallback', () => {
  function markLoaded(SL, groups) {
    groups.forEach(g => (SL._groups[g] || []).forEach(s => { SL._loaded[s] = true; }));
  }

  test('flag 開啟：核心三群組載完即 ready（不等 create/manage）', () => {
    const SL = loadRealScriptLoader({ splitEnabled: true });
    markLoaded(SL, ['activityDetailCore']);
    expect(SL.isPageReady('page-activity-detail')).toBe(true);
  });

  test('flag 關閉：同樣載入狀態下必須等完整 activity 才 ready（現行行為）', () => {
    const SL = loadRealScriptLoader({ splitEnabled: false });
    markLoaded(SL, ['activityDetailCore', 'achievement', 'profileCard']);
    expect(SL.isPageReady('page-activity-detail')).toBe(false);
    markLoaded(SL, ['activity']);
    expect(SL.isPageReady('page-activity-detail')).toBe(true);
  });

  test('ensureForPage 成功路徑：split 開啟時不載入 create/manage 檔', async () => {
    const SL = loadRealScriptLoader({ splitEnabled: true });
    const loadedSrcs = [];
    SL._load = (src) => { loadedSrcs.push(src); SL._loaded[src] = true; return Promise.resolve(); };
    await SL.ensureForPage('page-activity-detail');
    expect(loadedSrcs).toContain('js/modules/event/event-detail.js');
    expect(loadedSrcs).not.toContain('js/modules/event/event-manage-attendance.js');
    expect(loadedSrcs).not.toContain('js/modules/achievement/index.js');
    expect(loadedSrcs).not.toContain('js/modules/profile/profile-card.js');
    expect(loadedSrcs).not.toContain('js/modules/event/event-create.js');
    expect(loadedSrcs).not.toContain('js/modules/event/event-manage-lifecycle.js');
  });

  test('ensureForPage aux off loads the detail attendance/profile/achievement groups', async () => {
    const SL = loadRealScriptLoader({ splitEnabled: true, auxOnDemand: false });
    const loadedSrcs = [];
    SL._load = (src) => { loadedSrcs.push(src); SL._loaded[src] = true; return Promise.resolve(); };
    await SL.ensureForPage('page-activity-detail');
    expect(loadedSrcs).toContain('js/modules/event/event-manage-attendance.js');
    expect(loadedSrcs).toContain('js/modules/achievement/index.js');
    expect(loadedSrcs).toContain('js/modules/profile/profile-card.js');
  });

  test('ensureForPage fallback：核心載入失敗 → 自動退回完整 activity group，不拋錯', async () => {
    const SL = loadRealScriptLoader({ splitEnabled: true });
    let failedOnce = false;
    SL._load = (src) => {
      if (!failedOnce) { failedOnce = true; return Promise.reject(new Error('boom')); }
      SL._loaded[src] = true; return Promise.resolve();
    };
    const ensured = [];
    const origEnsureGroup = SL.ensureGroup.bind(SL);
    SL.ensureGroup = (g) => { ensured.push(g); return origEnsureGroup(g); };
    await expect(SL.ensureForPage('page-activity-detail')).resolves.toBeUndefined();
    expect(ensured).toContain('activity');
    expect(ensured).not.toContain('achievement');
    expect(ensured).not.toContain('profileCard');
  });

  test('非詳情頁載入失敗：維持現行行為（直接拋錯，不誤觸 fallback）', async () => {
    const SL = loadRealScriptLoader({ splitEnabled: true });
    SL._load = () => Promise.reject(new Error('boom'));
    await expect(SL.ensureForPage('page-teams')).rejects.toThrow('boom');
  });
});

describe('parallelGroupPreload — loadGroup 平行預載 flag', () => {
  test('預設（flag 未設或 true）：先 _preloadFiles 整組再依序執行', async () => {
    const SL = loadRealScriptLoader({ performanceFlags: {} });
    const preloaded = [];
    SL._preloadFiles = (srcs) => preloaded.push(...srcs);
    SL._load = (src) => { SL._loaded[src] = true; return Promise.resolve(); };
    await SL.loadGroup(['x.js', 'y.js']);
    expect(preloaded).toEqual(['x.js', 'y.js']);
  });

  test('flag=false：不做平行預載（秒回退路徑）', async () => {
    const SL = loadRealScriptLoader({ performanceFlags: { parallelGroupPreload: false } });
    const preloaded = [];
    SL._preloadFiles = (srcs) => preloaded.push(...srcs);
    SL._load = (src) => { SL._loaded[src] = true; return Promise.resolve(); };
    await SL.loadGroup(['x.js']);
    expect(preloaded).toEqual([]);
  });

  test('已載入檔案不重複預載（toLoad 為空直接返回）', async () => {
    const SL = loadRealScriptLoader({ performanceFlags: {} });
    SL._loaded['x.js'] = true;
    const preloaded = [];
    SL._preloadFiles = (srcs) => preloaded.push(...srcs);
    await SL.loadGroup(['x.js']);
    expect(preloaded).toEqual([]);
  });
});

describe('ensureGroup — single-flight and retry recovery', () => {
  test('concurrent callers share one group flight and pending state clears on success', async () => {
    const SL = loadRealScriptLoader();
    let resolveLoad;
    SL.loadGroup = jest.fn(() => new Promise(resolve => {
      resolveLoad = resolve;
    }));

    const first = SL.ensureGroup('activityCreate');
    const second = SL.ensureGroup('activityCreate');

    expect(SL.loadGroup).toHaveBeenCalledTimes(1);
    expect(SL.loadGroup).toHaveBeenCalledWith(SL._groups.activityCreate);
    expect(SL.hasPendingLoads()).toBe(true);

    resolveLoad();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(SL.hasPendingLoads()).toBe(false);
    expect(SL._groupLoading.activityCreate).toBeUndefined();
  });

  test('a rejected group flight clears its lock so the same group can retry immediately', async () => {
    const SL = loadRealScriptLoader();
    const loadError = new Error('activity create group failed');
    SL.loadGroup = jest.fn()
      .mockRejectedValueOnce(loadError)
      .mockResolvedValueOnce(undefined);

    await expect(SL.ensureGroup('activityCreate')).rejects.toBe(loadError);
    expect(SL.hasPendingLoads()).toBe(false);
    expect(SL._groupLoading.activityCreate).toBeUndefined();

    await expect(SL.ensureGroup('activityCreate')).resolves.toBeUndefined();
    expect(SL.loadGroup).toHaveBeenCalledTimes(2);
    expect(SL.hasPendingLoads()).toBe(false);
  });
});
