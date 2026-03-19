/**
 * Message module unit tests — extracted pure functions.
 *
 * Source files:
 *   js/modules/message/message-notify.js
 *   js/modules/message/message-line-push.js
 */

// ---------------------------------------------------------------------------
// Extracted from js/modules/message/message-notify.js:16-31
// _buildInboxDeliveryDedupeKey — builds dedup key from message params
// ---------------------------------------------------------------------------
function _buildInboxDeliveryDedupeKey(category, title, body, targetUid, senderName, extra) {
  const explicitKey = typeof extra?.dedupeKey === 'string' ? extra.dedupeKey.trim() : '';
  if (explicitKey) return explicitKey;
  const normalizedRoles = Array.isArray(extra?.targetRoles)
    ? [...extra.targetRoles].map(v => String(v || '').trim()).filter(Boolean).sort().join(',')
    : '';
  return [
    String(category || '').trim(),
    String(title || '').trim(),
    String(body || '').trim(),
    String(targetUid || '').trim(),
    String(extra?.targetTeamId || '').trim(),
    normalizedRoles,
    String(extra?.targetType || '').trim(),
    String(senderName || '').trim(),
  ].join('||');
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/message/message-notify.js:114-117
// _renderTemplate — replaces {key} placeholders
// ---------------------------------------------------------------------------
function _renderTemplate(str, vars) {
  if (!str) return '';
  return str.replace(/\{(\w+)\}/g, (_, key) => (vars && vars[key] != null) ? vars[key] : `{${key}}`);
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/message/message-line-push.js:36-39
// _linePushCategoryKey — maps 'private' → 'system'
// ---------------------------------------------------------------------------
function _linePushCategoryKey(category) {
  if (category === 'private') return 'system';
  return category;
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/message/message-line-push.js:45-52
// _getLineNotifySettings — merges defaults with user settings
// ---------------------------------------------------------------------------
function _getLineNotifySettings(lineNotify) {
  return {
    activity: true,
    system: true,
    tournament: false,
    ...(lineNotify?.settings || {}),
  };
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/message/message-notify.js:34-47
// _claimRecentInboxDeliveryKey — dedup window check
// ---------------------------------------------------------------------------
function _claimRecentInboxDeliveryKey(dedupeKey, nowMs, cache) {
  if (!dedupeKey) return true;
  const windowMs = 5000;
  Object.keys(cache).forEach(key => {
    if (nowMs - cache[key] > windowMs) delete cache[key];
  });
  const lastSentAt = Number(cache[dedupeKey] || 0);
  if (lastSentAt && (nowMs - lastSentAt) < windowMs) {
    return false;
  }
  cache[dedupeKey] = nowMs;
  return true;
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_buildInboxDeliveryDedupeKey (message-notify.js:16-31)', () => {
  test('builds key from all parts joined by ||', () => {
    const key = _buildInboxDeliveryDedupeKey('system', 'Title', 'Body', 'uid1', 'Sender', {});
    // 8 parts: category, title, body, targetUid, targetTeamId, roles, targetType, senderName
    const parts = key.split('||');
    expect(parts.length).toBe(8);
    expect(parts[0]).toBe('system');
    expect(parts[1]).toBe('Title');
    expect(parts[2]).toBe('Body');
    expect(parts[3]).toBe('uid1');
    expect(parts[7]).toBe('Sender');
  });

  test('explicit dedupeKey in extra takes priority', () => {
    const key = _buildInboxDeliveryDedupeKey('system', 'Title', 'Body', 'uid1', 'Sender', {
      dedupeKey: 'my-custom-key',
    });
    expect(key).toBe('my-custom-key');
  });

  test('explicit dedupeKey trimmed', () => {
    const key = _buildInboxDeliveryDedupeKey('system', 'Title', 'Body', 'uid1', 'Sender', {
      dedupeKey: '  trimmed  ',
    });
    expect(key).toBe('trimmed');
  });

  test('targetRoles are sorted in the key', () => {
    const key1 = _buildInboxDeliveryDedupeKey('sys', 'T', 'B', '', '', {
      targetRoles: ['admin', 'coach'],
    });
    const key2 = _buildInboxDeliveryDedupeKey('sys', 'T', 'B', '', '', {
      targetRoles: ['coach', 'admin'],
    });
    expect(key1).toBe(key2);
  });

  test('null/undefined parts → empty strings in key', () => {
    const key = _buildInboxDeliveryDedupeKey(null, null, null, null, null, null);
    // All parts should be empty strings joined by ||
    const parts = key.split('||');
    expect(parts.length).toBe(8);
    parts.forEach(p => expect(p).toBe(''));
  });
});

describe('_renderTemplate (message-notify.js:114-117)', () => {
  test('replaces {key} placeholders', () => {
    expect(_renderTemplate('Hello {name}!', { name: 'Alice' })).toBe('Hello Alice!');
  });

  test('multiple placeholders', () => {
    const result = _renderTemplate('{a} and {b}', { a: 'X', b: 'Y' });
    expect(result).toBe('X and Y');
  });

  test('missing placeholder → keeps original {key}', () => {
    expect(_renderTemplate('Hello {name}!', {})).toBe('Hello {name}!');
  });

  test('null string → empty string', () => {
    expect(_renderTemplate(null, { x: 1 })).toBe('');
  });

  test('empty vars → placeholders preserved', () => {
    expect(_renderTemplate('{a} {b}', null)).toBe('{a} {b}');
  });

  test('value can be 0 (falsy but not null)', () => {
    expect(_renderTemplate('Count: {n}', { n: 0 })).toBe('Count: 0');
  });

  test('value can be empty string', () => {
    expect(_renderTemplate('Hi {name}', { name: '' })).toBe('Hi ');
  });
});

describe('_linePushCategoryKey (message-line-push.js:36-39)', () => {
  test('private → system', () => {
    expect(_linePushCategoryKey('private')).toBe('system');
  });

  test('system → system (pass-through)', () => {
    expect(_linePushCategoryKey('system')).toBe('system');
  });

  test('activity → activity (pass-through)', () => {
    expect(_linePushCategoryKey('activity')).toBe('activity');
  });

  test('tournament → tournament (pass-through)', () => {
    expect(_linePushCategoryKey('tournament')).toBe('tournament');
  });
});

describe('_getLineNotifySettings (message-line-push.js:45-52)', () => {
  test('defaults when no lineNotify', () => {
    const settings = _getLineNotifySettings(null);
    expect(settings).toEqual({ activity: true, system: true, tournament: false });
  });

  test('defaults when lineNotify has no settings', () => {
    const settings = _getLineNotifySettings({ bound: true });
    expect(settings).toEqual({ activity: true, system: true, tournament: false });
  });

  test('user settings override defaults', () => {
    const settings = _getLineNotifySettings({
      settings: { activity: false, tournament: true },
    });
    expect(settings.activity).toBe(false);
    expect(settings.system).toBe(true);
    expect(settings.tournament).toBe(true);
  });
});

describe('_claimRecentInboxDeliveryKey (message-notify.js:34-47)', () => {
  test('first claim returns true', () => {
    const cache = {};
    expect(_claimRecentInboxDeliveryKey('key1', 1000, cache)).toBe(true);
    expect(cache['key1']).toBe(1000);
  });

  test('duplicate within window returns false', () => {
    const cache = {};
    _claimRecentInboxDeliveryKey('key1', 1000, cache);
    expect(_claimRecentInboxDeliveryKey('key1', 3000, cache)).toBe(false);
  });

  test('duplicate after window expires returns true', () => {
    const cache = {};
    _claimRecentInboxDeliveryKey('key1', 1000, cache);
    expect(_claimRecentInboxDeliveryKey('key1', 7000, cache)).toBe(true);
  });

  test('null/empty dedupeKey always returns true', () => {
    const cache = {};
    expect(_claimRecentInboxDeliveryKey('', 1000, cache)).toBe(true);
    expect(_claimRecentInboxDeliveryKey(null, 1000, cache)).toBe(true);
  });

  test('expired entries are cleaned up', () => {
    const cache = { old_key: 100 };
    _claimRecentInboxDeliveryKey('new_key', 10000, cache);
    expect(cache['old_key']).toBeUndefined();
    expect(cache['new_key']).toBe(10000);
  });
});
