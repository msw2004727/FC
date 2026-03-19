/**
 * FirebaseService unit tests — extracted pure functions.
 *
 * Source: js/firebase-service.js
 * The project uses Object.assign(App, {...}) (not ES modules), so each
 * function body is copied here as a standalone testable function.
 */

// ===========================================================================
// Extracted from js/firebase-service.js:16-19
// Pure function: removes _docId field from object
// ===========================================================================
function _stripDocId(obj) {
  const { _docId, ...rest } = obj;
  return rest;
}

// ===========================================================================
// Extracted from js/firebase-service.js:102-110
// Pure function: maps a user doc to adminUsers format
// ===========================================================================
function _mapUserDoc(data, docId) {
  return {
    ...data,
    name: data.displayName || data.name || '\u672A\u77E5',
    uid: data.uid || data.lineUserId || docId,
    lastActive: data.lastLogin || data.lastActive || null,
    _docId: docId,
  };
}

// ===========================================================================
// Extracted from js/firebase-service.js:117-126
// Pure function: generates UID-prefixed localStorage keys
// Adapted: accepts uidPrefix + LS_PREFIX as explicit params
// ===========================================================================
function _getLSKey(name, uidPrefix, LS_PREFIX) {
  return uidPrefix ? `shub_c_${uidPrefix}_${name}` : `${LS_PREFIX}${name}`;
}

function _getLSTsKey(uidPrefix, LS_TS_KEY) {
  return uidPrefix ? `shub_ts_${uidPrefix}` : LS_TS_KEY;
}

// ===========================================================================
// Extracted from js/firebase-service.js:180-187
// Pure function: determines cache TTL by user role
// Adapted: accepts role directly instead of reading localStorage
// ===========================================================================
function _getEffectiveTTL(role, LS_TTL, LS_TTL_LONG) {
  if (role === 'admin' || role === 'super_admin') return LS_TTL;
  return LS_TTL_LONG;
}

// ===========================================================================
// Extracted from js/firebase-service.js:384-390
// Pure function: determines if a collection needs reload
// Adapted: accepts lazyLoaded, maxAgeMap, loadedAtMap, now as explicit params
// ===========================================================================
function _shouldReloadCollection(name, { lazyLoaded, maxAgeMap, loadedAtMap, now }) {
  if (!lazyLoaded[name]) return true;
  const ttl = maxAgeMap[name];
  if (!ttl) return false;
  const loadedAt = loadedAtMap[name] || 0;
  return !loadedAt || (now - loadedAt > ttl);
}

// ===========================================================================
// Extracted from js/firebase-service.js:400-408
// Pure function: deduplicates docs by id
// Adapted: returns the filtered array instead of mutating cache
// ===========================================================================
function _deduplicateDocs(docs) {
  const seen = new Set();
  return (docs || []).filter(doc => {
    if (!doc?.id) return true;
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });
}

// ===========================================================================
// Extracted from js/firebase-service.js:380-382
// Pure function: returns realtime collections for a page
// ===========================================================================
const _pageScopedRealtimeMap = {
  'page-home':            ['events'],
  'page-activities':      ['registrations', 'attendanceRecords'],
  'page-activity-detail': ['registrations', 'attendanceRecords'],
  'page-my-activities':   ['registrations', 'attendanceRecords'],
  'page-scan':            ['attendanceRecords'],
};

function _getPageScopedRealtimeCollections(pageId) {
  return _pageScopedRealtimeMap[pageId] || [];
}

// ===========================================================================
// Extracted from js/firebase-service.js:693-713
// Pure function: merges active + terminal event slices with dedup
// Adapted: accepts slices, returns merged array (no side effects)
// ===========================================================================
function _mergeEventSlices(activeSlice, terminalSlice) {
  const merged = [];
  const seen = new Set();
  const pushUnique = (docs) => {
    (docs || []).forEach(doc => {
      if (!doc || !doc._docId || seen.has(doc._docId)) return;
      seen.add(doc._docId);
      merged.push(doc);
    });
  };
  pushUnique(activeSlice);
  pushUnique(terminalSlice);
  return merged;
}

// ===========================================================================
// Extracted from js/firebase-service.js:915-918
// Pure function: maps role to numeric level
// ===========================================================================
function _roleLevel(role, roleLevelMap) {
  if (!roleLevelMap) return 0;
  return roleLevelMap[role] || 0;
}

// ===========================================================================
// Extracted from js/firebase-service.js:1096-1121
// Pure function: extracts timestamp from message in multiple formats
// ===========================================================================
function _getMessageTimeMs(msg) {
  const parseValue = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') {
      return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
    }
    if (typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const direct = parseValue(msg?.timestamp) || parseValue(msg?.createdAt);
  if (direct) return direct;

  const timeStr = String(msg?.time || '').trim();
  if (timeStr) {
    const [datePart, timePart = '0:0'] = timeStr.split(' ');
    const [y, mo, d] = datePart.split('/').map(Number);
    const [h, mi] = timePart.split(':').map(Number);
    const parsed = new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

// ===========================================================================
// Extracted from js/firebase-service.js:1068-1070
// Pure function: generates message visibility key
// ===========================================================================
function _getMessageVisibilityKey(ctx) {
  return `${ctx.uid || ''}__${ctx.role || 'user'}__${(ctx.teamIds || []).join(',')}`;
}

// ===========================================================================
// Extracted from js/firebase-service.js:1123-1141
// Pure function: determines if a message is visible for a user context
// ===========================================================================
function _isMessageVisibleForContext(msg, ctx) {
  if (!msg || !ctx?.uid) return false;
  if (Array.isArray(msg.hiddenBy) && msg.hiddenBy.includes(ctx.uid)) return false;

  const senderUid = String(msg.fromUid || msg.senderUid || '').trim();
  if (senderUid && senderUid === ctx.uid) return true;

  const targetUid = String(msg.targetUid || msg.toUid || '').trim();
  if (targetUid) return targetUid === ctx.uid;

  const targetTeamId = String(msg.targetTeamId || '').trim();
  if (targetTeamId) return (ctx.teamIds || []).includes(targetTeamId);

  if (Array.isArray(msg.targetRoles) && msg.targetRoles.length) {
    return msg.targetRoles.includes(ctx.role || 'user');
  }

  return true;
}

// ===========================================================================
// Extracted from js/firebase-service.js:1143-1162
// Pure function: merges visible messages from listener results
// Adapted: accepts listenerResults and helpers explicitly, returns array
// ===========================================================================
function _mergeVisibleMessages(listenerResults, ctx) {
  const merged = new Map();

  Object.values(listenerResults || {}).forEach(list => {
    (list || []).forEach(msg => {
      if (!_isMessageVisibleForContext(msg, ctx)) return;
      const key = msg._docId || msg.id;
      if (!key) return;
      const prev = merged.get(key);
      if (!prev || _getMessageTimeMs(msg) >= _getMessageTimeMs(prev)) {
        merged.set(key, msg);
      }
    });
  });

  return Array.from(merged.values())
    .sort((a, b) => _getMessageTimeMs(b) - _getMessageTimeMs(a))
    .slice(0, 200);
}

// ===========================================================================
// Extracted from js/firebase-service.js:1051-1066
// Pure function: extracts visibility context from user data
// Adapted: accepts user object directly
// ===========================================================================
function _getMessageVisibilityContext(user, authUid) {
  const uid = authUid || user?.uid || user?.lineUserId || null;
  const role = user?.role || 'user';
  const teamIds = [];
  const seen = new Set();
  const pushId = (id) => {
    const value = String(id || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    teamIds.push(value);
  };
  if (Array.isArray(user?.teamIds)) user.teamIds.forEach(pushId);
  pushId(user?.teamId);
  return { uid, role, teamIds };
}

// ===========================================================================
// Extracted from js/firebase-service.js:715-772
// Pure function: finds current user from adminUsers snapshot
// Adapted: accepts adminUsers, authUid, prevUser; returns { next, changed, roleChanged }
// ===========================================================================
function _syncCurrentUserFromSnapshot(adminUsers, authUid, prevUser) {
  if (!authUid) return { next: null, changed: false, roleChanged: false };

  const candidates = (adminUsers || []).filter(u =>
    u && (u._docId === authUid || u.uid === authUid || u.lineUserId === authUid)
  );
  if (!candidates.length) return { next: null, changed: false, roleChanged: false };

  const preferred =
    candidates.find(u => u._docId === authUid)
    || candidates.find(u => u.uid === authUid)
    || candidates.find(u => u.lineUserId === authUid)
    || candidates[0];

  const prev = prevUser || null;
  const next = {
    ...(prev || {}),
    ...preferred,
    uid: preferred.uid || authUid,
    lineUserId: preferred.lineUserId || authUid,
  };

  const changed = !prev
    || prev._docId !== next._docId
    || prev.role !== next.role
    || prev.isRestricted !== next.isRestricted
    || prev.displayName !== next.displayName
    || prev.pictureUrl !== next.pictureUrl
    || prev.teamId !== next.teamId
    || JSON.stringify(prev.teamIds || []) !== JSON.stringify(next.teamIds || []);

  const roleChanged = !!(prev && prev.role !== next.role);

  return { next, changed, roleChanged };
}

// ===========================================================================
// Extracted from js/firebase-service.js:1813-1821
// Pure function: converts achievement progress array to Map
// ===========================================================================
function getUserAchievementProgressMap(progressArray) {
  if (!progressArray || !progressArray.length) return null;
  const map = new Map();
  progressArray.forEach(record => {
    const achId = record.achId || record._docId;
    if (achId) map.set(achId, record);
  });
  return map.size > 0 ? map : null;
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_stripDocId (firebase-service.js:16-19)', () => {
  test('removes _docId field', () => {
    const result = _stripDocId({ _docId: 'abc', name: 'Test', value: 42 });
    expect(result).toEqual({ name: 'Test', value: 42 });
    expect(result._docId).toBeUndefined();
  });

  test('returns same fields if no _docId', () => {
    const input = { name: 'Test' };
    const result = _stripDocId(input);
    expect(result).toEqual({ name: 'Test' });
  });

  test('handles empty object', () => {
    expect(_stripDocId({})).toEqual({});
  });
});

describe('_mapUserDoc (firebase-service.js:102-110)', () => {
  test('maps displayName to name', () => {
    const result = _mapUserDoc({ displayName: 'Alice' }, 'doc1');
    expect(result.name).toBe('Alice');
    expect(result._docId).toBe('doc1');
  });

  test('falls back to data.name if no displayName', () => {
    const result = _mapUserDoc({ name: 'Bob' }, 'doc2');
    expect(result.name).toBe('Bob');
  });

  test('defaults name to \u672A\u77E5 if none provided', () => {
    const result = _mapUserDoc({}, 'doc3');
    expect(result.name).toBe('\u672A\u77E5');
  });

  test('uses uid from data', () => {
    const result = _mapUserDoc({ uid: 'U1' }, 'doc4');
    expect(result.uid).toBe('U1');
  });

  test('falls back to lineUserId if no uid', () => {
    const result = _mapUserDoc({ lineUserId: 'L1' }, 'doc5');
    expect(result.uid).toBe('L1');
  });

  test('falls back to docId if no uid or lineUserId', () => {
    const result = _mapUserDoc({}, 'doc6');
    expect(result.uid).toBe('doc6');
  });

  test('maps lastLogin to lastActive', () => {
    const result = _mapUserDoc({ lastLogin: '2026-01-01' }, 'doc7');
    expect(result.lastActive).toBe('2026-01-01');
  });

  test('falls back to lastActive from data', () => {
    const result = _mapUserDoc({ lastActive: '2025-12-01' }, 'doc8');
    expect(result.lastActive).toBe('2025-12-01');
  });

  test('lastActive is null if neither present', () => {
    const result = _mapUserDoc({}, 'doc9');
    expect(result.lastActive).toBeNull();
  });
});

describe('_getLSKey / _getLSTsKey (firebase-service.js:117-126)', () => {
  const LS_PREFIX = 'shub_c_';
  const LS_TS_KEY = 'shub_cache_ts';

  test('with UID prefix', () => {
    expect(_getLSKey('events', 'U123', LS_PREFIX)).toBe('shub_c_U123_events');
  });

  test('without UID prefix', () => {
    expect(_getLSKey('events', '', LS_PREFIX)).toBe('shub_c_events');
  });

  test('TS key with UID prefix', () => {
    expect(_getLSTsKey('U123', LS_TS_KEY)).toBe('shub_ts_U123');
  });

  test('TS key without UID prefix', () => {
    expect(_getLSTsKey('', LS_TS_KEY)).toBe('shub_cache_ts');
  });
});

describe('_getEffectiveTTL (firebase-service.js:180-187)', () => {
  const SHORT = 30 * 60 * 1000;
  const LONG = 120 * 60 * 1000;

  test('admin gets short TTL', () => {
    expect(_getEffectiveTTL('admin', SHORT, LONG)).toBe(SHORT);
  });

  test('super_admin gets short TTL', () => {
    expect(_getEffectiveTTL('super_admin', SHORT, LONG)).toBe(SHORT);
  });

  test('user gets long TTL', () => {
    expect(_getEffectiveTTL('user', SHORT, LONG)).toBe(LONG);
  });

  test('coach gets long TTL', () => {
    expect(_getEffectiveTTL('coach', SHORT, LONG)).toBe(LONG);
  });

  test('undefined role gets long TTL', () => {
    expect(_getEffectiveTTL(undefined, SHORT, LONG)).toBe(LONG);
  });
});

describe('_shouldReloadCollection (firebase-service.js:384-390)', () => {
  const maxAgeMap = { events: 60000, teams: 300000 };

  test('not yet loaded \u2192 true', () => {
    expect(_shouldReloadCollection('events', {
      lazyLoaded: {}, maxAgeMap, loadedAtMap: {}, now: 1000000,
    })).toBe(true);
  });

  test('loaded within TTL \u2192 false', () => {
    expect(_shouldReloadCollection('events', {
      lazyLoaded: { events: true }, maxAgeMap, loadedAtMap: { events: 950000 }, now: 1000000,
    })).toBe(false);
  });

  test('loaded beyond TTL \u2192 true', () => {
    expect(_shouldReloadCollection('events', {
      lazyLoaded: { events: true }, maxAgeMap, loadedAtMap: { events: 900000 }, now: 1000000,
    })).toBe(true);
  });

  test('no TTL configured \u2192 false (never stale)', () => {
    expect(_shouldReloadCollection('unknown', {
      lazyLoaded: { unknown: true }, maxAgeMap, loadedAtMap: { unknown: 0 }, now: 1000000,
    })).toBe(false);
  });

  test('loadedAt is 0 \u2192 true', () => {
    expect(_shouldReloadCollection('events', {
      lazyLoaded: { events: true }, maxAgeMap, loadedAtMap: { events: 0 }, now: 1000000,
    })).toBe(true);
  });
});

describe('_deduplicateDocs (firebase-service.js:400-408)', () => {
  test('removes duplicate ids', () => {
    const docs = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'a', v: 3 }];
    const result = _deduplicateDocs(docs);
    expect(result).toHaveLength(2);
    expect(result[0].v).toBe(1);
  });

  test('keeps docs without id field', () => {
    const docs = [{ name: 'x' }, { name: 'y' }];
    expect(_deduplicateDocs(docs)).toHaveLength(2);
  });

  test('handles null/undefined input', () => {
    expect(_deduplicateDocs(null)).toEqual([]);
    expect(_deduplicateDocs(undefined)).toEqual([]);
  });

  test('handles empty array', () => {
    expect(_deduplicateDocs([])).toEqual([]);
  });

  test('preserves first occurrence on duplicate', () => {
    const docs = [{ id: 'x', val: 'first' }, { id: 'x', val: 'second' }];
    const result = _deduplicateDocs(docs);
    expect(result).toHaveLength(1);
    expect(result[0].val).toBe('first');
  });
});

describe('_getPageScopedRealtimeCollections (firebase-service.js:380-382)', () => {
  test('page-home \u2192 events', () => {
    expect(_getPageScopedRealtimeCollections('page-home')).toEqual(['events']);
  });

  test('page-activities \u2192 registrations + attendanceRecords', () => {
    expect(_getPageScopedRealtimeCollections('page-activities'))
      .toEqual(['registrations', 'attendanceRecords']);
  });

  test('page-scan \u2192 attendanceRecords', () => {
    expect(_getPageScopedRealtimeCollections('page-scan')).toEqual(['attendanceRecords']);
  });

  test('unknown page \u2192 empty array', () => {
    expect(_getPageScopedRealtimeCollections('page-unknown')).toEqual([]);
  });
});

describe('_mergeEventSlices (firebase-service.js:693-713)', () => {
  test('merges active + terminal with active priority', () => {
    const active = [{ _docId: 'e1', status: 'open' }];
    const terminal = [{ _docId: 'e2', status: 'ended' }];
    const result = _mergeEventSlices(active, terminal);
    expect(result).toHaveLength(2);
    expect(result[0]._docId).toBe('e1');
    expect(result[1]._docId).toBe('e2');
  });

  test('active takes precedence over terminal with same _docId', () => {
    const active = [{ _docId: 'e1', status: 'open', title: 'Active' }];
    const terminal = [{ _docId: 'e1', status: 'ended', title: 'Old' }];
    const result = _mergeEventSlices(active, terminal);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Active');
  });

  test('handles null/undefined slices', () => {
    expect(_mergeEventSlices(null, null)).toEqual([]);
    expect(_mergeEventSlices(undefined, undefined)).toEqual([]);
  });

  test('handles empty slices', () => {
    expect(_mergeEventSlices([], [])).toEqual([]);
  });

  test('skips docs without _docId', () => {
    const active = [{ status: 'open' }, { _docId: 'e1', status: 'open' }];
    const result = _mergeEventSlices(active, []);
    expect(result).toHaveLength(1);
    expect(result[0]._docId).toBe('e1');
  });

  test('skips null docs', () => {
    const active = [null, { _docId: 'e1', status: 'open' }];
    const result = _mergeEventSlices(active, []);
    expect(result).toHaveLength(1);
  });
});

describe('_roleLevel (firebase-service.js:915-918)', () => {
  const map = { user: 0, coach: 1, captain: 2, admin: 4, super_admin: 5 };

  test('returns correct level for known role', () => {
    expect(_roleLevel('admin', map)).toBe(4);
    expect(_roleLevel('user', map)).toBe(0);
    expect(_roleLevel('super_admin', map)).toBe(5);
  });

  test('returns 0 for unknown role', () => {
    expect(_roleLevel('unknown', map)).toBe(0);
  });

  test('returns 0 if no map provided', () => {
    expect(_roleLevel('admin', null)).toBe(0);
    expect(_roleLevel('admin', undefined)).toBe(0);
  });
});

describe('_getMessageTimeMs (firebase-service.js:1096-1121)', () => {
  test('Firestore FieldValue with toMillis()', () => {
    const msg = { timestamp: { toMillis: () => 1700000000000 } };
    expect(_getMessageTimeMs(msg)).toBe(1700000000000);
  });

  test('Firestore-like object with seconds + nanoseconds', () => {
    const msg = { timestamp: { seconds: 1700000000, nanoseconds: 500000000 } };
    expect(_getMessageTimeMs(msg)).toBe(1700000000500);
  });

  test('numeric timestamp', () => {
    const msg = { timestamp: 1700000000000 };
    expect(_getMessageTimeMs(msg)).toBe(1700000000000);
  });

  test('ISO string timestamp', () => {
    const msg = { createdAt: '2025-01-01T00:00:00Z' };
    expect(_getMessageTimeMs(msg)).toBe(Date.parse('2025-01-01T00:00:00Z'));
  });

  test('custom time format YYYY/MM/DD HH:mm', () => {
    const msg = { time: '2025/06/15 14:30' };
    const expected = new Date(2025, 5, 15, 14, 30).getTime();
    expect(_getMessageTimeMs(msg)).toBe(expected);
  });

  test('custom time format YYYY/MM/DD without time part', () => {
    const msg = { time: '2025/06/15' };
    const expected = new Date(2025, 5, 15, 0, 0).getTime();
    expect(_getMessageTimeMs(msg)).toBe(expected);
  });

  test('null/undefined msg \u2192 0', () => {
    expect(_getMessageTimeMs(null)).toBe(0);
    expect(_getMessageTimeMs(undefined)).toBe(0);
  });

  test('empty msg \u2192 0', () => {
    expect(_getMessageTimeMs({})).toBe(0);
  });

  test('invalid time string \u2192 0', () => {
    expect(_getMessageTimeMs({ time: 'not-a-date' })).toBe(0);
  });

  test('prefers timestamp over createdAt', () => {
    const msg = { timestamp: 999, createdAt: 888 };
    expect(_getMessageTimeMs(msg)).toBe(999);
  });

  test('falls back to createdAt when timestamp is falsy', () => {
    const msg = { timestamp: null, createdAt: 888 };
    expect(_getMessageTimeMs(msg)).toBe(888);
  });
});

describe('_getMessageVisibilityKey (firebase-service.js:1068-1070)', () => {
  test('generates key with all fields', () => {
    const ctx = { uid: 'U1', role: 'admin', teamIds: ['T1', 'T2'] };
    expect(_getMessageVisibilityKey(ctx)).toBe('U1__admin__T1,T2');
  });

  test('handles empty teamIds', () => {
    const ctx = { uid: 'U1', role: 'user', teamIds: [] };
    expect(_getMessageVisibilityKey(ctx)).toBe('U1__user__');
  });

  test('handles missing fields', () => {
    expect(_getMessageVisibilityKey({})).toBe('__user__');
  });
});

describe('_isMessageVisibleForContext (firebase-service.js:1123-1141)', () => {
  const ctx = { uid: 'U1', role: 'coach', teamIds: ['T1'] };

  test('null msg \u2192 false', () => {
    expect(_isMessageVisibleForContext(null, ctx)).toBe(false);
  });

  test('no uid in ctx \u2192 false', () => {
    expect(_isMessageVisibleForContext({ id: 'm1' }, { role: 'user' })).toBe(false);
  });

  test('hidden by current user \u2192 false', () => {
    expect(_isMessageVisibleForContext({ hiddenBy: ['U1'] }, ctx)).toBe(false);
  });

  test('sender is current user \u2192 true', () => {
    expect(_isMessageVisibleForContext({ fromUid: 'U1' }, ctx)).toBe(true);
  });

  test('senderUid matches \u2192 true', () => {
    expect(_isMessageVisibleForContext({ senderUid: 'U1' }, ctx)).toBe(true);
  });

  test('targetUid matches \u2192 true', () => {
    expect(_isMessageVisibleForContext({ targetUid: 'U1' }, ctx)).toBe(true);
  });

  test('targetUid does not match \u2192 false', () => {
    expect(_isMessageVisibleForContext({ targetUid: 'U2' }, ctx)).toBe(false);
  });

  test('toUid matches \u2192 true', () => {
    expect(_isMessageVisibleForContext({ toUid: 'U1' }, ctx)).toBe(true);
  });

  test('targetTeamId matches \u2192 true', () => {
    expect(_isMessageVisibleForContext({ targetTeamId: 'T1' }, ctx)).toBe(true);
  });

  test('targetTeamId does not match \u2192 false', () => {
    expect(_isMessageVisibleForContext({ targetTeamId: 'T99' }, ctx)).toBe(false);
  });

  test('targetRoles includes user role \u2192 true', () => {
    expect(_isMessageVisibleForContext({ targetRoles: ['coach', 'admin'] }, ctx)).toBe(true);
  });

  test('targetRoles does not include user role \u2192 false', () => {
    expect(_isMessageVisibleForContext({ targetRoles: ['admin'] }, ctx)).toBe(false);
  });

  test('broadcast message (no target fields) \u2192 true', () => {
    expect(_isMessageVisibleForContext({ id: 'bcast' }, ctx)).toBe(true);
  });
});

describe('_mergeVisibleMessages (firebase-service.js:1143-1162)', () => {
  const ctx = { uid: 'U1', role: 'user', teamIds: [] };

  test('merges from multiple listener results', () => {
    const results = {
      q1: [{ _docId: 'm1', targetUid: 'U1', timestamp: 100 }],
      q2: [{ _docId: 'm2', targetUid: 'U1', timestamp: 200 }],
    };
    const merged = _mergeVisibleMessages(results, ctx);
    expect(merged).toHaveLength(2);
    expect(merged[0]._docId).toBe('m2'); // newer first
  });

  test('deduplicates by _docId, keeps latest', () => {
    const results = {
      q1: [{ _docId: 'm1', targetUid: 'U1', timestamp: 100 }],
      q2: [{ _docId: 'm1', targetUid: 'U1', timestamp: 200 }],
    };
    const merged = _mergeVisibleMessages(results, ctx);
    expect(merged).toHaveLength(1);
    expect(merged[0].timestamp).toBe(200);
  });

  test('filters out invisible messages', () => {
    const results = {
      q1: [{ _docId: 'm1', targetUid: 'U2', timestamp: 100 }], // not for U1
    };
    const merged = _mergeVisibleMessages(results, ctx);
    expect(merged).toHaveLength(0);
  });

  test('handles empty results', () => {
    expect(_mergeVisibleMessages({}, ctx)).toEqual([]);
    expect(_mergeVisibleMessages(null, ctx)).toEqual([]);
  });

  test('limits to 200 messages', () => {
    const list = Array.from({ length: 250 }, (_, i) => ({
      _docId: `m${i}`, targetUid: 'U1', timestamp: i,
    }));
    const merged = _mergeVisibleMessages({ q1: list }, ctx);
    expect(merged).toHaveLength(200);
  });
});

describe('_getMessageVisibilityContext (firebase-service.js:1051-1066)', () => {
  test('extracts uid, role, teamIds from user', () => {
    const user = { uid: 'U1', role: 'coach', teamIds: ['T1', 'T2'], teamId: 'T3' };
    const ctx = _getMessageVisibilityContext(user, null);
    expect(ctx.uid).toBe('U1');
    expect(ctx.role).toBe('coach');
    expect(ctx.teamIds).toEqual(['T1', 'T2', 'T3']);
  });

  test('authUid takes priority over user.uid', () => {
    const user = { uid: 'U1' };
    const ctx = _getMessageVisibilityContext(user, 'AUTH_U');
    expect(ctx.uid).toBe('AUTH_U');
  });

  test('deduplicates teamIds', () => {
    const user = { uid: 'U1', teamIds: ['T1', 'T1'], teamId: 'T1' };
    const ctx = _getMessageVisibilityContext(user, null);
    expect(ctx.teamIds).toEqual(['T1']);
  });

  test('handles null user', () => {
    const ctx = _getMessageVisibilityContext(null, null);
    expect(ctx.uid).toBeNull();
    expect(ctx.role).toBe('user');
    expect(ctx.teamIds).toEqual([]);
  });

  test('trims empty teamId strings', () => {
    const user = { uid: 'U1', teamIds: ['', ' '], teamId: '  ' };
    const ctx = _getMessageVisibilityContext(user, null);
    expect(ctx.teamIds).toEqual([]);
  });
});

describe('_syncCurrentUserFromSnapshot (firebase-service.js:715-772)', () => {
  test('finds user by _docId', () => {
    const users = [{ _docId: 'U1', uid: 'U1', displayName: 'Alice', role: 'user' }];
    const { next, changed } = _syncCurrentUserFromSnapshot(users, 'U1', null);
    expect(next.displayName).toBe('Alice');
    expect(changed).toBe(true);
  });

  test('prefers _docId match over uid match', () => {
    const users = [
      { _docId: 'U1', uid: 'U1', displayName: 'ByDocId' },
      { _docId: 'other', uid: 'U1', displayName: 'ByUid' },
    ];
    const { next } = _syncCurrentUserFromSnapshot(users, 'U1', null);
    expect(next.displayName).toBe('ByDocId');
  });

  test('detects role change', () => {
    const users = [{ _docId: 'U1', uid: 'U1', role: 'admin' }];
    const prev = { _docId: 'U1', uid: 'U1', role: 'user' };
    const { roleChanged } = _syncCurrentUserFromSnapshot(users, 'U1', prev);
    expect(roleChanged).toBe(true);
  });

  test('no change when same data', () => {
    const users = [{ _docId: 'U1', uid: 'U1', role: 'user', displayName: 'A' }];
    const prev = { _docId: 'U1', uid: 'U1', role: 'user', displayName: 'A' };
    const { changed, roleChanged } = _syncCurrentUserFromSnapshot(users, 'U1', prev);
    expect(changed).toBe(false);
    expect(roleChanged).toBe(false);
  });

  test('returns null if no authUid', () => {
    const { next, changed } = _syncCurrentUserFromSnapshot([], null, null);
    expect(next).toBeNull();
    expect(changed).toBe(false);
  });

  test('returns null if no matching user', () => {
    const users = [{ _docId: 'U2', uid: 'U2' }];
    const { next, changed } = _syncCurrentUserFromSnapshot(users, 'U1', null);
    expect(next).toBeNull();
    expect(changed).toBe(false);
  });

  test('detects teamIds change', () => {
    const users = [{ _docId: 'U1', uid: 'U1', role: 'user', displayName: 'A', teamIds: ['T1', 'T2'] }];
    const prev = { _docId: 'U1', uid: 'U1', role: 'user', displayName: 'A', teamIds: ['T1'] };
    const { changed } = _syncCurrentUserFromSnapshot(users, 'U1', prev);
    expect(changed).toBe(true);
  });
});

describe('getUserAchievementProgressMap (firebase-service.js:1813-1821)', () => {
  test('converts array to map by achId', () => {
    const arr = [
      { achId: 'a1', current: 3 },
      { achId: 'a2', current: 5 },
    ];
    const map = getUserAchievementProgressMap(arr);
    expect(map.size).toBe(2);
    expect(map.get('a1').current).toBe(3);
  });

  test('falls back to _docId if no achId', () => {
    const arr = [{ _docId: 'a1', current: 1 }];
    const map = getUserAchievementProgressMap(arr);
    expect(map.get('a1').current).toBe(1);
  });

  test('returns null for empty array', () => {
    expect(getUserAchievementProgressMap([])).toBeNull();
  });

  test('returns null for null/undefined', () => {
    expect(getUserAchievementProgressMap(null)).toBeNull();
    expect(getUserAchievementProgressMap(undefined)).toBeNull();
  });

  test('skips entries without achId or _docId', () => {
    const arr = [{ current: 5 }, { achId: 'a1', current: 1 }];
    const map = getUserAchievementProgressMap(arr);
    expect(map.size).toBe(1);
  });
});
