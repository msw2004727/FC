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
// Extracted from js/modules/team/team-form-join.js:73-79
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
  const teamLabel = cleanName ? `\u300c${cleanName}\u300d\u7403\u968a` : '\u7403\u968a';
  return `\u9019\u662f\u5728ToosterX Hub\u4e0a\u5275\u7acb\u7684${teamLabel}\uff0c\u8aa0\u647d\u9080\u8acb\u60a8\u52a0\u5165\u7403\u968a\uff0c\u8ddf\u6211\u5011\u4e00\u8d77\u4eab\u53d7\u6d3b\u52d5~\n${shareUrl}`;
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
    expect(text).toContain('FC Warriors');
    expect(text).toContain('https://example.com/invite');
  });

  test('empty team name → generic label', () => {
    const text = _buildTeamInviteShareText('', 'https://example.com');
    expect(text).not.toContain('\u300c\u300d');
    expect(text).toContain('\u7403\u968a');
  });

  test('null team name → generic label', () => {
    const text = _buildTeamInviteShareText(null, 'https://example.com');
    expect(text).toContain('\u7403\u968a');
  });
});
