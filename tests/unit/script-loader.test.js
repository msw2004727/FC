/**
 * ScriptLoader — unit tests
 *
 * Extracted from js/core/script-loader.js
 * Tests: URL normalization, group deduplication, page group resolution
 */

// ---------------------------------------------------------------------------
// Extracted from script-loader.js:14-22
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
      'js/modules/team/team-feed.js',
      'js/modules/team/team-detail-render.js',
      'js/modules/team/team-detail-invite.js',
      'js/modules/team/team-share-builders.js',
      'js/modules/team/team-share.js',
      'js/modules/team/team-form-join.js',
    ],
    teamForm: [
      'js/modules/team/team-form-search.js',
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
