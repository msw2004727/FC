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
  const teamListSource = fs.readFileSync(path.join(__dirname, '../../js/modules/team/team-list.js'), 'utf8');
  const teamListRenderSource = fs.readFileSync(path.join(__dirname, '../../js/modules/team/team-list-render.js'), 'utf8');

  test('toggleTeamPin refreshes the club manage page immediately', () => {
    expect(teamListSource).toMatch(/toggleTeamPin\(id\)[\s\S]*this\.renderTeamManage\(\);/);
  });

  test('club manage page sorts pinned active and inactive teams before rendering', () => {
    expect(teamListRenderSource).toContain('const activeTeams = this._sortTeams(teams.filter(t => t.active));');
    expect(teamListRenderSource).toContain('const inactiveTeams = this._sortTeams(teams.filter(t => !t.active));');
  });

  test('admin team list also keeps pinned teams first', () => {
    expect(teamListRenderSource).toContain('const activeT = this._sortTeams(teams.filter(t => t.active));');
    expect(teamListRenderSource).toContain('const inactiveT = this._sortTeams(teams.filter(t => !t.active));');
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
