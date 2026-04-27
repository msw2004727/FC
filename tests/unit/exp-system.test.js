/**
 * EXP System unit tests
 * Covers: auto-exp rules, amount lookup, uid null guard,
 *         requestId generation, rollback logic, fallback chain
 *
 * Source files:
 *   js/modules/auto-exp/index.js
 *   js/api-service.js (adjustUserExp / adjustUserExpAsync)
 */

// =========================================================================
// Constants (from js/modules/auto-exp/index.js lines 16-21)
// =========================================================================

const _AUTO_EXP_DEFAULTS = [
  { key: 'complete_activity',   label: '完成活動',   desc: '簽到＋簽退完成一場活動' },
  { key: 'register_activity',   label: '報名活動',   desc: '成功報名一場活動' },
  { key: 'cancel_registration', label: '取消報名',   desc: '取消活動報名（可設負數扣分）' },
  { key: 'host_activity',       label: '主辦活動',   desc: '建立一場新活動' },
];

// =========================================================================
// Extracted functions — _getAutoExpRules (auto-exp.js lines 25-38)
// =========================================================================

/**
 * @param {object|null} firestoreCache - in-memory Firestore cache
 * @param {object|null} localStorageData - parsed localStorage data
 * @returns {Array<{key,label,desc,amount}>}
 */
function _getAutoExpRules(firestoreCache, localStorageData) {
  var saved = firestoreCache;
  if (!saved) {
    saved = localStorageData;
  }
  if (saved && typeof saved === 'object') {
    return _AUTO_EXP_DEFAULTS.map(function (d) {
      return { key: d.key, label: d.label, desc: d.desc, amount: saved[d.key] !== undefined ? Number(saved[d.key]) : 0 };
    });
  }
  return _AUTO_EXP_DEFAULTS.map(function (d) { return { key: d.key, label: d.label, desc: d.desc, amount: 0 }; });
}

// =========================================================================
// Extracted function — _getAutoExpAmount (auto-exp.js lines 41-44)
// =========================================================================

function _getAutoExpAmount(rules, key) {
  var rule = rules.find(function (r) { return r.key === key; });
  return rule ? rule.amount : 0;
}

// =========================================================================
// Extracted function — uid null guard logic (api-service.js lines 1369-1370)
// =========================================================================

function adjustUserExpUidGuard(user) {
  if (!user || !(user.uid || user.lineUserId)) return null;
  return user;
}

// =========================================================================
// Extracted function — optimistic update + rollback (api-service.js lines 1372, 1386)
// =========================================================================

function applyOptimisticExp(user, amount) {
  user.exp = Math.max(0, (user.exp || 0) + amount);
  return user.exp;
}

function rollbackExp(user, amount) {
  user.exp = Math.max(0, (user.exp || 0) - amount);
  return user.exp;
}

// =========================================================================
// Extracted function — requestId generation (auto-exp.js line 71)
// =========================================================================

function generateRequestId(uid, key, timestamp) {
  return 'autoexp_' + uid + '_' + key + '_' + timestamp;
}

// =========================================================================
// Extracted function — _grantAutoExp guard logic (auto-exp.js lines 66-68)
// =========================================================================

function shouldGrantAutoExp(uid, amount) {
  if (!uid) return false;
  if (amount === 0) return false;
  return true;
}

// =========================================================================
// Extracted function — exp log entry (api-service.js line 1375)
// =========================================================================

function buildExpLog(user, amount, reason, operatorLabel) {
  const now = new Date(2026, 2, 18, 14, 30); // fixed date for test
  const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  return {
    time: timeStr,
    uid: user.uid || user.lineUserId,
    target: user.name,
    amount: (amount > 0 ? '+' : '') + amount,
    reason,
    operator: operatorLabel || '管理員',
  };
}

// =========================================================================
// Tests
// =========================================================================

describe('Auto-EXP Rules', () => {

  describe('_getAutoExpRules', () => {
    test('returns defaults with amount 0 when no saved data', () => {
      const rules = _getAutoExpRules(null, null);
      expect(rules).toHaveLength(4);
      rules.forEach(r => {
        expect(r.amount).toBe(0);
        expect(r).toHaveProperty('key');
        expect(r).toHaveProperty('label');
        expect(r).toHaveProperty('desc');
      });
    });

    test('returns correct keys in order', () => {
      const rules = _getAutoExpRules(null, null);
      expect(rules.map(r => r.key)).toEqual([
        'complete_activity',
        'register_activity',
        'cancel_registration',
        'host_activity',
      ]);
    });

    test('uses Firestore cache over localStorage when both available', () => {
      const firestoreData = { complete_activity: 10, register_activity: 5 };
      const localData = { complete_activity: 99, register_activity: 99 };
      const rules = _getAutoExpRules(firestoreData, localData);
      expect(rules.find(r => r.key === 'complete_activity').amount).toBe(10);
      expect(rules.find(r => r.key === 'register_activity').amount).toBe(5);
    });

    test('falls back to localStorage when Firestore cache is null', () => {
      const localData = { complete_activity: 20, cancel_registration: -5 };
      const rules = _getAutoExpRules(null, localData);
      expect(rules.find(r => r.key === 'complete_activity').amount).toBe(20);
      expect(rules.find(r => r.key === 'cancel_registration').amount).toBe(-5);
    });

    test('defaults to 0 for keys missing from saved data', () => {
      const saved = { complete_activity: 15 }; // only one key
      const rules = _getAutoExpRules(saved, null);
      expect(rules.find(r => r.key === 'complete_activity').amount).toBe(15);
      expect(rules.find(r => r.key === 'register_activity').amount).toBe(0);
      expect(rules.find(r => r.key === 'host_activity').amount).toBe(0);
    });

    test('converts string amounts to numbers', () => {
      const saved = { complete_activity: '10', register_activity: '3' };
      const rules = _getAutoExpRules(saved, null);
      expect(rules.find(r => r.key === 'complete_activity').amount).toBe(10);
      expect(rules.find(r => r.key === 'register_activity').amount).toBe(3);
    });

    test('handles negative amounts (cancel penalty)', () => {
      const saved = { cancel_registration: -10 };
      const rules = _getAutoExpRules(saved, null);
      expect(rules.find(r => r.key === 'cancel_registration').amount).toBe(-10);
    });

    test('ignores unknown keys in saved data', () => {
      const saved = { complete_activity: 5, unknown_key: 999 };
      const rules = _getAutoExpRules(saved, null);
      expect(rules).toHaveLength(4);
      expect(rules.find(r => r.key === 'unknown_key')).toBeUndefined();
    });

    test('treats empty object as valid (all amounts 0)', () => {
      const rules = _getAutoExpRules({}, null);
      expect(rules).toHaveLength(4);
      rules.forEach(r => expect(r.amount).toBe(0));
    });
  });

  describe('_getAutoExpAmount', () => {
    const rules = _getAutoExpRules({ complete_activity: 10, register_activity: 5, cancel_registration: -3 }, null);

    test('returns amount for known key', () => {
      expect(_getAutoExpAmount(rules, 'complete_activity')).toBe(10);
      expect(_getAutoExpAmount(rules, 'register_activity')).toBe(5);
    });

    test('returns negative amount for penalty key', () => {
      expect(_getAutoExpAmount(rules, 'cancel_registration')).toBe(-3);
    });

    test('returns 0 for key with no saved amount', () => {
      expect(_getAutoExpAmount(rules, 'host_activity')).toBe(0);
    });

    test('returns 0 for unknown key', () => {
      expect(_getAutoExpAmount(rules, 'nonexistent_key')).toBe(0);
    });
  });
});

describe('adjustUserExp — UID null guard', () => {
  test('returns null when user is null', () => {
    expect(adjustUserExpUidGuard(null)).toBeNull();
  });

  test('returns null when user is undefined', () => {
    expect(adjustUserExpUidGuard(undefined)).toBeNull();
  });

  test('returns null when user has neither uid nor lineUserId', () => {
    expect(adjustUserExpUidGuard({ name: 'test' })).toBeNull();
  });

  test('returns null when uid and lineUserId are empty strings', () => {
    expect(adjustUserExpUidGuard({ uid: '', lineUserId: '' })).toBeNull();
  });

  test('returns user when uid exists', () => {
    const user = { uid: 'U123', name: 'Alice' };
    expect(adjustUserExpUidGuard(user)).toBe(user);
  });

  test('returns user when lineUserId exists (uid missing)', () => {
    const user = { lineUserId: 'U456', name: 'Bob' };
    expect(adjustUserExpUidGuard(user)).toBe(user);
  });
});

describe('Optimistic EXP update & rollback', () => {
  test('adds positive amount to existing exp', () => {
    const user = { exp: 100 };
    expect(applyOptimisticExp(user, 10)).toBe(110);
    expect(user.exp).toBe(110);
  });

  test('adds amount when exp is 0', () => {
    const user = { exp: 0 };
    expect(applyOptimisticExp(user, 5)).toBe(5);
  });

  test('adds amount when exp is undefined (treated as 0)', () => {
    const user = {};
    expect(applyOptimisticExp(user, 15)).toBe(15);
  });

  test('subtracts but floors at 0', () => {
    const user = { exp: 3 };
    expect(applyOptimisticExp(user, -10)).toBe(0);
    expect(user.exp).toBe(0);
  });

  test('rollback undoes optimistic add', () => {
    const user = { exp: 0 };
    applyOptimisticExp(user, 10); // exp = 10
    rollbackExp(user, 10); // exp = 0
    expect(user.exp).toBe(0);
  });

  test('rollback floors at 0 even if math goes negative', () => {
    const user = { exp: 5 };
    expect(rollbackExp(user, 20)).toBe(0);
    expect(user.exp).toBe(0);
  });

  test('rollback of negative amount (penalty cancel) adds back', () => {
    const user = { exp: 90 };
    // original amount was -10, so rollback subtracts -10 → adds 10
    rollbackExp(user, -10);
    expect(user.exp).toBe(100);
  });
});

describe('requestId generation', () => {
  test('produces correct format', () => {
    const id = generateRequestId('U123', 'complete_activity', 1710700000000);
    expect(id).toBe('autoexp_U123_complete_activity_1710700000000');
  });

  test('includes all three parts', () => {
    const id = generateRequestId('Uabc', 'register_activity', 999);
    expect(id).toContain('Uabc');
    expect(id).toContain('register_activity');
    expect(id).toContain('999');
    expect(id.startsWith('autoexp_')).toBe(true);
  });

  test('different timestamps produce different ids', () => {
    const id1 = generateRequestId('U1', 'k', 1000);
    const id2 = generateRequestId('U1', 'k', 2000);
    expect(id1).not.toBe(id2);
  });
});

describe('_grantAutoExp guard', () => {
  test('returns false when uid is falsy', () => {
    expect(shouldGrantAutoExp(null, 10)).toBe(false);
    expect(shouldGrantAutoExp('', 10)).toBe(false);
    expect(shouldGrantAutoExp(undefined, 10)).toBe(false);
  });

  test('returns false when amount is 0', () => {
    expect(shouldGrantAutoExp('U123', 0)).toBe(false);
  });

  test('returns true for positive amount', () => {
    expect(shouldGrantAutoExp('U123', 10)).toBe(true);
  });

  test('returns true for negative amount (penalty)', () => {
    expect(shouldGrantAutoExp('U123', -5)).toBe(true);
  });
});

describe('EXP log entry', () => {
  test('builds correct log with positive amount', () => {
    const user = { uid: 'U123', name: 'Alice' };
    const log = buildExpLog(user, 10, '完成活動', '系統');
    expect(log.uid).toBe('U123');
    expect(log.target).toBe('Alice');
    expect(log.amount).toBe('+10');
    expect(log.reason).toBe('完成活動');
    expect(log.operator).toBe('系統');
    expect(log.time).toBe('03/18 14:30');
  });

  test('builds correct log with negative amount', () => {
    const user = { uid: 'U456', name: 'Bob' };
    const log = buildExpLog(user, -5, '取消報名', '系統');
    expect(log.amount).toBe('-5');
  });

  test('defaults operator to 管理員 when not provided', () => {
    const user = { uid: 'U1', name: 'X' };
    const log = buildExpLog(user, 1, 'test', null);
    expect(log.operator).toBe('管理員');
  });

  test('uses lineUserId when uid is missing', () => {
    const user = { lineUserId: 'Uline', name: 'C' };
    const log = buildExpLog(user, 1, 'r', 'op');
    expect(log.uid).toBe('Uline');
  });

  test('amount zero shows as 0 (no plus sign)', () => {
    const user = { uid: 'U1', name: 'D' };
    const log = buildExpLog(user, 0, 'r', 'op');
    expect(log.amount).toBe('0');
  });
});

describe('_AUTO_EXP_DEFAULTS integrity', () => {
  test('has exactly 4 rules', () => {
    expect(_AUTO_EXP_DEFAULTS).toHaveLength(4);
  });

  test('all rules have required fields', () => {
    _AUTO_EXP_DEFAULTS.forEach(d => {
      expect(d.key).toBeDefined();
      expect(typeof d.key).toBe('string');
      expect(d.label).toBeDefined();
      expect(d.desc).toBeDefined();
    });
  });

  test('keys are unique', () => {
    const keys = _AUTO_EXP_DEFAULTS.map(d => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('removed rules are not present', () => {
    const keys = _AUTO_EXP_DEFAULTS.map(d => d.key);
    // These were removed in the cleanup
    expect(keys).not.toContain('submit_review');
    expect(keys).not.toContain('join_team');
    expect(keys).not.toContain('post_team_feed');
  });
});
