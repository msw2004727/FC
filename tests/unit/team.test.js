const fs = require('fs');
const path = require('path');

/**
 * Team module unit tests — extracted pure functions.
 *
 * Source files:
 *   js/modules/team/team-list.js
 *   js/modules/team/team-form-join.js
 *   js/modules/team/team-detail-invite.js
 */

// ---------------------------------------------------------------------------
// Extracted from js/modules/team/team-list.js:8-21
// _getUserTeamIds — deduplicates & trims team IDs from user object
// ---------------------------------------------------------------------------
function _getUserTeamIds(user) {
  if (!user) return [];
  const ids = [];
  const seen = new Set();
  const pushId = (id) => {
    const v = String(id || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    ids.push(v);
  };
  if (Array.isArray(user.teamIds)) user.teamIds.forEach(pushId);
  pushId(user.teamId);
  return ids;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/team/team-list.js:8-20
// _resolveTeamSportFilterSync keeps the page-level sport filter aligned with
// the global sport picker unless the user intentionally chose a local override.
// ---------------------------------------------------------------------------
function _resolveTeamSportFilterSync(currentValue, lastSyncedGlobalSport, globalSport, forceSync) {
  const current = String(currentValue || '');
  const lastSynced = String(lastSyncedGlobalSport || '');
  const globalValue = String(globalSport || '');
  const shouldSync = !!forceSync || current === '' || current === lastSynced;
  const value = shouldSync ? globalValue : current;
  return {
    value,
    syncedGlobalSport: shouldSync ? globalValue : lastSynced,
    effectiveSport: value || globalValue,
  };
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/team/team-list-helpers.js:11-13
// _normalizeIdentityValue
// ---------------------------------------------------------------------------
function _normalizeIdentityValue(value) {
  return String(value || '').trim();
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/team/team-list-stats.js:33-40
// _getTeamRank — maps EXP to rank tier
// ---------------------------------------------------------------------------
const TEAM_RANK_CONFIG = [
  { min: 0,    rank: 'E',   color: '#6b7280' },
  { min: 1000, rank: 'D',   color: '#22c55e' },
  { min: 2000, rank: 'C',   color: '#3b82f6' },
  { min: 3000, rank: 'B',   color: '#8b5cf6' },
  { min: 4000, rank: 'A',   color: '#f59e0b' },
  { min: 5000, rank: 'A+',  color: '#f97316' },
  { min: 6000, rank: 'A++', color: '#ef4444' },
  { min: 7000, rank: 'S',   color: '#ec4899' },
  { min: 8000, rank: 'SS',  color: '#14b8a6' },
  { min: 9000, rank: 'SSS', color: '#dc2626' },
];

function _getTeamRank(teamExp) {
  const exp = teamExp || 0;
  for (let i = TEAM_RANK_CONFIG.length - 1; i >= 0; i--) {
    const cfg = TEAM_RANK_CONFIG[i];
    if (exp >= cfg.min) return { rank: cfg.rank, color: cfg.color };
  }
  return { rank: 'E', color: '#6b7280' };
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/team/team-list-stats.js:42-49
// _sortTeams — pinned first, then by pinOrder
// ---------------------------------------------------------------------------
function _sortTeams(teams) {
  return [...teams].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (a.pinned && b.pinned) return (a.pinOrder || 0) - (b.pinOrder || 0);
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/team/team-form-join.js:57-65
// _parseTimeStr — parse "YYYY/MM/DD HH:MM" → ms timestamp
// ---------------------------------------------------------------------------
function _parseTimeStr(str) {
  if (!str) return 0;
  const [dp, tp] = str.split(' ');
  const [y, mo, d] = (dp || '').split('/').map(Number);
  const [h, mi] = (tp || '0:0').split(':').map(Number);
  return isNaN(y) ? 0 : new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/team/team-detail-invite.js:19-23
// _buildTeamInviteShareText — builds invite text
// ---------------------------------------------------------------------------
function _buildTeamInviteShareText(teamName, shareUrl) {
  const cleanName = String(teamName || '').trim();
  const clubLabel = cleanName ? `\u300c${cleanName}\u300d` : '\u9019\u500b\u4ff1\u6a02\u90e8';
  return `${clubLabel}\u6b63\u5728 ToosterX \u62db\u52df\u5925\u4f34\uff0c\u6b61\u8fce\u52a0\u5165\u4ff1\u6a02\u90e8\uff0c\u4e00\u8d77\u904b\u52d5\u3001\u63ea\u5718\u3001\u53c3\u52a0\u6d3b\u52d5\u3002\n${shareUrl}`;
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_getUserTeamIds (team-list.js:8-21)', () => {
  test('null/undefined user → empty array', () => {
    expect(_getUserTeamIds(null)).toEqual([]);
    expect(_getUserTeamIds(undefined)).toEqual([]);
  });

  test('user with teamIds array only', () => {
    const user = { teamIds: ['t1', 't2'] };
    expect(_getUserTeamIds(user)).toEqual(['t1', 't2']);
  });

  test('user with teamId only (no teamIds)', () => {
    const user = { teamId: 't1' };
    expect(_getUserTeamIds(user)).toEqual(['t1']);
  });

  test('user with both teamIds and teamId — deduplicates', () => {
    const user = { teamIds: ['t1', 't2'], teamId: 't2' };
    expect(_getUserTeamIds(user)).toEqual(['t1', 't2']);
  });

  test('user with both teamIds and teamId — adds unique teamId', () => {
    const user = { teamIds: ['t1'], teamId: 't3' };
    expect(_getUserTeamIds(user)).toEqual(['t1', 't3']);
  });

  test('empty/blank values are filtered out', () => {
    const user = { teamIds: ['', '  ', null, 't1'], teamId: '' };
    expect(_getUserTeamIds(user)).toEqual(['t1']);
  });

  test('duplicate values in teamIds are deduplicated', () => {
    const user = { teamIds: ['t1', 't1', 't2'] };
    expect(_getUserTeamIds(user)).toEqual(['t1', 't2']);
  });
});

describe('_resolveTeamSportFilterSync (team-list.js:8-20)', () => {
  test('syncs an empty page filter to the active global sport', () => {
    expect(_resolveTeamSportFilterSync('', '', 'basketball', false)).toEqual({
      value: 'basketball',
      syncedGlobalSport: 'basketball',
      effectiveSport: 'basketball',
    });
  });

  test('force sync replaces a stale football filter after global sport changes', () => {
    expect(_resolveTeamSportFilterSync('football', 'football', 'basketball', true)).toEqual({
      value: 'basketball',
      syncedGlobalSport: 'basketball',
      effectiveSport: 'basketball',
    });
  });

  test('force sync clears the page filter when global sport is all', () => {
    expect(_resolveTeamSportFilterSync('football', 'football', '', true)).toEqual({
      value: '',
      syncedGlobalSport: '',
      effectiveSport: '',
    });
  });

  test('preserves a deliberate local override while global sport is unchanged', () => {
    expect(_resolveTeamSportFilterSync('basketball', 'football', 'football', false)).toEqual({
      value: 'basketball',
      syncedGlobalSport: 'football',
      effectiveSport: 'basketball',
    });
  });
});

describe('_normalizeIdentityValue (team-list-helpers.js:11-13)', () => {
  test('trims whitespace', () => {
    expect(_normalizeIdentityValue('  hello  ')).toBe('hello');
  });

  test('null/undefined → empty string', () => {
    expect(_normalizeIdentityValue(null)).toBe('');
    expect(_normalizeIdentityValue(undefined)).toBe('');
  });

  test('number coerced to string', () => {
    expect(_normalizeIdentityValue(123)).toBe('123');
  });
});

describe('_getTeamRank (team-list-stats.js:33-40)', () => {
  test('0 EXP → rank E', () => {
    expect(_getTeamRank(0)).toEqual({ rank: 'E', color: '#6b7280' });
  });

  test('null/undefined → rank E (treated as 0)', () => {
    expect(_getTeamRank(null)).toEqual({ rank: 'E', color: '#6b7280' });
    expect(_getTeamRank(undefined)).toEqual({ rank: 'E', color: '#6b7280' });
  });

  test('999 → still E', () => {
    expect(_getTeamRank(999).rank).toBe('E');
  });

  test('1000 → D', () => {
    expect(_getTeamRank(1000).rank).toBe('D');
  });

  test('5000 → A+', () => {
    expect(_getTeamRank(5000).rank).toBe('A+');
  });

  test('9000+ → SSS', () => {
    expect(_getTeamRank(9000).rank).toBe('SSS');
    expect(_getTeamRank(99999).rank).toBe('SSS');
  });
});

describe('_sortTeams (team-list-stats.js:42-49)', () => {
  test('pinned teams come first', () => {
    const teams = [
      { id: 'a', pinned: false },
      { id: 'b', pinned: true, pinOrder: 1 },
    ];
    const sorted = _sortTeams(teams);
    expect(sorted[0].id).toBe('b');
    expect(sorted[1].id).toBe('a');
  });

  test('pinned teams sorted by pinOrder', () => {
    const teams = [
      { id: 'a', pinned: true, pinOrder: 3 },
      { id: 'b', pinned: true, pinOrder: 1 },
      { id: 'c', pinned: true, pinOrder: 2 },
    ];
    const sorted = _sortTeams(teams);
    expect(sorted.map(t => t.id)).toEqual(['b', 'c', 'a']);
  });

  test('no pinned teams → original order preserved (stable)', () => {
    const teams = [
      { id: 'a', pinned: false },
      { id: 'b', pinned: false },
    ];
    const sorted = _sortTeams(teams);
    expect(sorted.map(t => t.id)).toEqual(['a', 'b']);
  });

  test('does not mutate original array', () => {
    const teams = [{ id: 'a' }, { id: 'b', pinned: true }];
    const sorted = _sortTeams(teams);
    expect(sorted).not.toBe(teams);
    expect(teams[0].id).toBe('a');
  });
});

describe('team pin management wiring', () => {
  const teamPageSource = fs.readFileSync(path.join(__dirname, '../../pages/team.html'), 'utf8');
  const teamListSource = fs.readFileSync(path.join(__dirname, '../../js/modules/team/team-list.js'), 'utf8');
  const teamListRenderSource = fs.readFileSync(path.join(__dirname, '../../js/modules/team/team-list-render.js'), 'utf8');
  const teamListHelperSource = fs.readFileSync(path.join(__dirname, '../../js/modules/team/team-list-helpers.js'), 'utf8');
  const teamFormJoinSource = fs.readFileSync(path.join(__dirname, '../../js/modules/team/team-form-join.js'), 'utf8');
  const teamFormInitSource = fs.readFileSync(path.join(__dirname, '../../js/modules/team/team-form-init.js'), 'utf8');
  const teamFormSource = fs.readFileSync(path.join(__dirname, '../../js/modules/team/team-form.js'), 'utf8');
  const teamCss = fs.readFileSync(path.join(__dirname, '../../css/team.css'), 'utf8');

  test('club pin controls are enabled for admins and write pinned order', () => {
    expect(teamListRenderSource).toContain('team-pin-btn');
    expect(teamListRenderSource).toContain('onclick="App.toggleTeamPin');
    expect(teamListRenderSource).toContain("${t.pinned ? '已置頂' : '置頂'}");
    expect(teamListSource).toContain('_getNextTeamPinOrder');
    expect(teamListSource).toMatch(/toggleTeamPin\(id\)[\s\S]*hasPermission\('team\.manage_all'\)[\s\S]*ApiService\.updateTeamAwait\(id, updates\)/);
    expect(teamListSource).toContain("'team_pin'");
    expect(teamCss).toContain('.team-pin-btn.is-pinned');
  });

  test('club list pinned state overlays media without changing card height', () => {
    const pinRailRule = teamCss.match(/\.tc-card > \.tc-pin-rail\s*\{[\s\S]*?\n\}/)?.[0] || '';
    const sportBadgeRule = teamCss.match(/\.tc-sport-badge\s*\{[\s\S]*?\n\}/)?.[0] || '';
    const ribbonRule = teamCss.match(/\.tc-type-ribbon,[\s\S]*?\.tc-edu-ribbon\s*\{[\s\S]*?\n\}/)?.[0] || '';

    expect(teamListRenderSource).toContain('tc-pin-rail');
    expect(teamListRenderSource).toContain('tc-card-media');
    expect(teamListRenderSource).not.toContain('tc-pin-badge');
    expect(teamCss).toContain('.tc-card > .tc-pin-rail');
    expect(pinRailRule).toContain('position: absolute');
    expect(pinRailRule).toContain('left: 38px');
    expect(pinRailRule).toContain('width: max-content');
    expect(pinRailRule).toContain('max-width: none');
    expect(pinRailRule).toContain('flex-shrink: 0');
    expect(pinRailRule).toContain('white-space: nowrap');
    expect(teamCss).toMatch(/\.tc-card > \.tc-pin-rail span:last-child\s*\{[\s\S]*flex: 0 0 auto[\s\S]*white-space: nowrap/);
    expect(pinRailRule).toContain('z-index: 2');
    expect(sportBadgeRule).toContain('top: 6px; left: 6px');
    expect(teamCss).not.toContain('.tc-card.tc-pinned .tc-sport-badge');
    expect(ribbonRule).toContain('z-index: 3');
    expect(teamCss).toContain('.tc-card.is-pending .tc-card-media::after');
    expect(teamCss).not.toContain('.tc-card.is-pending > div:first-child::after');
    expect(teamCss).not.toContain('border-bottom: 1px solid rgba(217, 119, 6, .18)');
  });

  test('club manage page sorts pinned active and inactive teams before rendering', () => {
    expect(teamListRenderSource).toContain('const activeTeams = this._sortTeams(teams.filter(t => t.active));');
    expect(teamListRenderSource).toContain('const inactiveTeams = this._sortTeams(teams.filter(t => !t.active));');
  });

  test('admin team list also keeps pinned teams first', () => {
    expect(teamListRenderSource).toContain('const activeT = this._sortTeams(teams.filter(t => t.active));');
    expect(teamListRenderSource).toContain('const inactiveT = this._sortTeams(teams.filter(t => !t.active));');
  });

  test('club manage page renders Chinese and English names on separate lines', () => {
    expect(teamListRenderSource).toContain('_buildTeamManageTitleHtml');
    expect(teamListRenderSource).toContain('team-manage-title-main');
    expect(teamListRenderSource).toContain('team-manage-title-en');
    expect(teamCss).toContain('.team-manage-title');
    expect(teamCss).toContain('flex-direction: column');
  });

  test('admin can toggle and color the club card light trail effect', () => {
    expect(teamListHelperSource).toContain('_normalizeTeamAttentionColor');
    expect(teamListRenderSource).toContain('_renderTeamAttentionEffectControls');
    expect(teamListRenderSource).toContain('attentionEffectEnabled');
    expect(teamListRenderSource).toContain('attentionEffectColor');
    expect(teamListSource).toContain('toggleTeamAttentionEffect');
    expect(teamListSource).toContain('changeTeamAttentionEffectColor');
    expect(teamListSource).toContain("hasPermission('team.manage_all')");
    expect(teamCss).toContain('.tc-card.tc-attention-effect::before');
    expect(teamCss).toContain('animation: tc-attention-spin');
  });

  test('club theme color uses scoped card styling and strict edit ownership', () => {
    expect(teamListHelperSource).toContain('_normalizeTeamThemeColor');
    expect(teamListHelperSource).toContain('_isTeamThemeOverlayEnabled');
    expect(teamListHelperSource).toContain('themeOverlayEnabled !== false');
    expect(teamListHelperSource).toContain("['captainUid', 'creatorUid', 'ownerUid']");
    expect(teamListHelperSource).toMatch(/_canEditTeamByRoleOrCaptain\(team\)[\s\S]*_isTeamOwnerUser\(team\)[\s\S]*team\.manage_all/);
    expect(teamListRenderSource).toContain('tc-themed');
    expect(teamListRenderSource).toContain('tc-theme-no-overlay');
    expect(teamListRenderSource).toContain('themeOverlayEnabled === false ? 0 : 1');
    expect(teamListRenderSource).toContain('--team-theme-color');
    expect(teamCss).toContain('.tc-card.tc-themed .tc-body::before');
    expect(teamCss).toContain('.tc-card.tc-themed.tc-theme-no-overlay .tc-body::before');
    expect(teamCss).toContain('.td-detail-shell.has-team-theme.no-team-theme-overlay .td-identity-panel::before');
    expect(teamCss).toContain('[data-theme="dark"] .tc-card.tc-themed .tc-body::before');
    expect(teamCss).toContain('.td-detail-shell.has-team-theme .td-identity-panel > .td-club-head-action');
    expect(teamCss).toMatch(/\.td-detail-shell\.has-team-theme \.td-identity-panel > \.td-club-head-action\s*\{[\s\S]*position:\s*absolute/);
  });

  test('club manage records and direct actions use edit/staff permission guards', () => {
    expect(teamListHelperSource).toContain('_canAccessTeamManageRecord');
    expect(teamListRenderSource).toContain('this._canAccessTeamManageRecord?.(t)');
    expect(teamListRenderSource).toContain('this._canEditTeamByRoleOrCaptain?.(t)');
    expect(teamListSource).toMatch(/toggleTeamPin\(id\)[\s\S]*hasPermission\('team\.manage_all'\)/);
    expect(teamListSource).toMatch(/toggleTeamActive\(id\)[\s\S]*hasPermission\('team\.manage_all'\)/);
    expect(teamListSource).toMatch(/removeTeam\(btn, id\)[\s\S]*_canEditTeamByRoleOrCaptain\?\.\(t\)/);
  });

  test('club join pending state reuses the 24h request cooldown', () => {
    expect(teamFormJoinSource).toContain('_TEAM_JOIN_REQUEST_COOLDOWN_MS: 24 * 60 * 60 * 1000');
    expect(teamFormJoinSource).toContain('_getTeamJoinRequestState');
    expect(teamFormJoinSource).toContain("result.status = 'pending'");
    expect(teamFormJoinSource).toContain("result.status = 'rejectedCooldown'");
    expect(teamFormJoinSource).toContain("ApiService.updateMessage(m.id, { actionStatus: 'ignored' })");
    expect(teamFormJoinSource).toContain('_markTeamJoinRequestPending(teamId, applicantUid, groupId)');
    expect(teamFormJoinSource).toContain('_refreshTeamDetailPrimaryAction(teamId)');
    expect(teamCss).toContain('.td-club-head-action .td-action-pending');
  });

  test('club page search filters are collapsed behind the title magnifier', () => {
    expect(teamPageSource).toContain('id="team-filter-toggle-btn"');
    expect(teamPageSource).toContain('onclick="App.toggleTeamFilterPanel()"');
    expect(teamPageSource).toContain('id="team-filter-panel" hidden');
    expect(teamPageSource).toContain('id="team-search"');
    expect(teamPageSource).toContain('id="team-sport-filter"');
    expect(teamPageSource).toContain('id="team-region-filter"');
    expect(teamListSource).toContain('toggleTeamFilterPanel(force)');
    expect(teamListSource).toContain('_syncTeamFilterPanelState');
    expect(teamListRenderSource).toContain('this._syncTeamFilterPanelState?.();');
    expect(teamCss).toContain('.team-filter-toggle-btn');
    expect(teamCss).toContain('.team-search-bar[hidden]');
  });

  test('club category tags support none competitive teaching and leisure as one active label', () => {
    expect(teamPageSource).toContain('data-type="none"');
    expect(teamPageSource).toContain('data-type="competitive"');
    expect(teamPageSource).toContain('data-type="education"');
    expect(teamPageSource).toContain('data-type="leisure"');
    expect(teamPageSource).toContain('data-team-type-option="none"');
    expect(teamPageSource).toContain('data-team-type-option="competitive"');
    expect(teamPageSource).toContain('data-team-type-option="education"');
    expect(teamPageSource).toContain('data-team-type-option="leisure"');
    expect(teamListHelperSource).toContain('_getTeamCategoryOptions');
    expect(teamListHelperSource).toContain("key: 'none'");
    expect(teamListHelperSource).toContain("key: 'competitive'");
    expect(teamListHelperSource).toContain("key: 'leisure'");
    expect(teamListHelperSource).toContain("ribbonClass: ''");
    expect(teamListHelperSource).toContain("pillClass: ''");
    expect(teamListHelperSource).toContain('tournamentSettingsReserved: true');
    expect(teamListRenderSource).toContain('_getTeamCategoryMeta(t)');
    expect(teamListRenderSource).toContain('tc-type-ribbon');
    expect(teamFormInitSource).toContain('_selectTeamTypeTag(type)');
    expect(teamFormSource).toContain('teachingEnabled: isTeachingType');
    expect(teamCss).toContain('.td-category-settings-row');
    expect(teamCss).toMatch(/\.td-category-settings-row\s*\{[\s\S]*flex-direction:\s*column/);
    expect(teamCss).toMatch(/\.td-category-settings-row \.td-category-tag-group\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(teamCss).toMatch(/@media \(max-width: 520px\)\s*\{[\s\S]*\.td-category-settings-row \.td-category-tag-group\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  });
});

describe('_parseTimeStr (team-form-join.js:73-79)', () => {
  test('valid time string → correct timestamp', () => {
    const ts = _parseTimeStr('2026/03/17 14:30');
    const d = new Date(2026, 2, 17, 14, 30);
    expect(ts).toBe(d.getTime());
  });

  test('null/empty → 0', () => {
    expect(_parseTimeStr(null)).toBe(0);
    expect(_parseTimeStr('')).toBe(0);
  });

  test('date only (no time) → midnight', () => {
    const ts = _parseTimeStr('2026/01/01');
    const d = new Date(2026, 0, 1, 0, 0);
    expect(ts).toBe(d.getTime());
  });

  test('invalid date → 0', () => {
    expect(_parseTimeStr('not-a-date')).toBe(0);
  });
});

describe('_buildTeamInviteShareText (team-detail-invite.js:19-23)', () => {
  test('includes team name and URL', () => {
    const text = _buildTeamInviteShareText('FC Warriors', 'https://example.com/invite');
    expect(text).toContain('\u300cFC Warriors\u300d\u6b63\u5728 ToosterX \u62db\u52df\u5925\u4f34');
    expect(text).toContain('https://example.com/invite');
    expect(text).not.toContain('ToosterX Hub');
    expect(text).not.toContain('\u8aa0\u647d');
    expect(text).not.toContain('\u7403\u968a');
  });

  test('empty team name → generic label', () => {
    const text = _buildTeamInviteShareText('', 'https://example.com');
    expect(text).not.toContain('\u300c\u300d');
    expect(text).toContain('\u9019\u500b\u4ff1\u6a02\u90e8\u6b63\u5728 ToosterX');
  });

  test('null team name → generic label', () => {
    const text = _buildTeamInviteShareText(null, 'https://example.com');
    expect(text).toContain('\u9019\u500b\u4ff1\u6a02\u90e8');
  });
});
