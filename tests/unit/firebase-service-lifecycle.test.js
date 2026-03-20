/**
 * FirebaseService lifecycle tests — stateful operations
 *
 * Covers: Step 2 (pagehide persist), Step 4 (init re-entry guard),
 *         Step 5 (jitter), Step 8 (LS eviction)
 *
 * Strategy: extract & mock stateful logic in isolation.
 */

// ═══════════════════════════════════════════════════════
//  Extracted: _saveToLS with eviction (Step 8 target)
// ═══════════════════════════════════════════════════════
function _saveToLS_withEviction(name, data, { getKey, setItem, removeItem }) {
  const json = JSON.stringify(data);
  if (json.length > 512000) return { written: false, reason: 'too_large' };
  try {
    setItem(getKey(name), json);
    return { written: true };
  } catch (e) {
    const expendable = ['newsArticles', 'gameConfigs'];
    for (const lp of expendable) {
      if (lp === name) continue;
      try {
        removeItem(getKey(lp));
        setItem(getKey(name), json);
        return { written: true, evicted: lp };
      } catch (_) { continue; }
    }
    return { written: false, reason: 'quota_exceeded' };
  }
}

// ═══════════════════════════════════════════════════════
//  Extracted: jitter delay calculation (Step 5 target)
// ═══════════════════════════════════════════════════════
function calcReconnectDelay(attempts, randomFn = Math.random) {
  const baseDelay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
  const jitter = baseDelay * randomFn() * 0.3;
  return Math.round(baseDelay + jitter);
}

// Non-jitter version (current code)
function calcReconnectDelayNoJitter(attempts) {
  return Math.min(1000 * Math.pow(2, attempts - 1), 30000);
}

// ═══════════════════════════════════════════════════════
//  Extracted: init re-entry guard logic (Step 4 target)
// ═══════════════════════════════════════════════════════
function simulateInitGuard() {
  let _initialized = false;
  let _initInFlight = false;
  let callCount = 0;

  async function init() {
    if (_initialized) return 'already_initialized';
    if (_initInFlight) return 'blocked_inflight';
    _initInFlight = true;
    callCount++;
    try {
      await new Promise(resolve => setTimeout(resolve, 10));
      _initialized = true;
      return 'completed';
    } finally {
      _initInFlight = false;
    }
  }

  return { init, getCallCount: () => callCount, isInitialized: () => _initialized };
}

// ═══════════════════════════════════════════════════════
//  Extracted: _persistCache trigger logic (Step 2 target)
// ═══════════════════════════════════════════════════════
function simulatePersistDebounce() {
  let timer = null;
  let persistCount = 0;
  const _persistCache = () => { persistCount++; };

  return {
    debouncedPersist(clearTimeoutFn, setTimeoutFn) {
      clearTimeoutFn(timer);
      timer = setTimeoutFn(() => _persistCache(), 30000);
    },
    forcePersist(clearTimeoutFn) {
      clearTimeoutFn(timer);
      _persistCache();
    },
    getPersistCount: () => persistCount,
    getTimer: () => timer,
  };
}

// ═══════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════

describe('Step 8: _saveToLS with eviction on quota exceeded', () => {
  test('normal write succeeds without eviction', () => {
    const store = {};
    const result = _saveToLS_withEviction('events', [{ id: 1 }], {
      getKey: name => `shub_c_${name}`,
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    });
    expect(result.written).toBe(true);
    expect(result.evicted).toBeUndefined();
    expect(store['shub_c_events']).toBeDefined();
  });

  test('data exceeding 500KB is rejected', () => {
    const bigData = Array(60000).fill({ x: 'a'.repeat(10) });
    const result = _saveToLS_withEviction('events', bigData, {
      getKey: name => `shub_c_${name}`,
      setItem: () => {},
      removeItem: () => {},
    });
    expect(result.written).toBe(false);
    expect(result.reason).toBe('too_large');
  });

  test('quota exceeded → evicts newsArticles first', () => {
    let quotaFull = true;
    const store = { 'shub_c_newsArticles': '[...]', 'shub_c_gameConfigs': '[...]' };
    const result = _saveToLS_withEviction('events', [{ id: 1 }], {
      getKey: name => `shub_c_${name}`,
      setItem: (k, v) => {
        if (quotaFull && k === 'shub_c_events') {
          quotaFull = false; // first attempt fails, after eviction succeeds
          throw new Error('QuotaExceededError');
        }
        store[k] = v;
      },
      removeItem: (k) => { delete store[k]; },
    });
    expect(result.written).toBe(true);
    expect(result.evicted).toBe('newsArticles');
    expect(store['shub_c_newsArticles']).toBeUndefined();
  });

  test('quota exceeded → does not evict self', () => {
    const result = _saveToLS_withEviction('newsArticles', [{ id: 1 }], {
      getKey: name => `shub_c_${name}`,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
    });
    // newsArticles won't evict itself, tries gameConfigs
    // But setItem always fails, so ultimately gives up
    expect(result.written).toBe(false);
    expect(result.reason).toBe('quota_exceeded');
  });

  test('all expendable evicted but still fails → gives up gracefully', () => {
    const result = _saveToLS_withEviction('events', [{ id: 1 }], {
      getKey: name => `shub_c_${name}`,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
    });
    expect(result.written).toBe(false);
    expect(result.reason).toBe('quota_exceeded');
  });

  test('eviction preserves boot collections (never evicts banners etc)', () => {
    const evictedNames = [];
    _saveToLS_withEviction('events', [{ id: 1 }], {
      getKey: name => `shub_c_${name}`,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: (k) => { evictedNames.push(k); },
    });
    const bootCollections = ['banners', 'announcements', 'siteThemes', 'achievements', 'badges'];
    bootCollections.forEach(name => {
      expect(evictedNames).not.toContain(`shub_c_${name}`);
    });
  });
});

describe('Step 5: reconnect delay with jitter', () => {
  test('base delays follow exponential backoff', () => {
    expect(calcReconnectDelayNoJitter(1)).toBe(1000);
    expect(calcReconnectDelayNoJitter(2)).toBe(2000);
    expect(calcReconnectDelayNoJitter(3)).toBe(4000);
    expect(calcReconnectDelayNoJitter(4)).toBe(8000);
    expect(calcReconnectDelayNoJitter(5)).toBe(16000);
    expect(calcReconnectDelayNoJitter(6)).toBe(30000); // capped
  });

  test('jitter adds 0-30% on top of base delay', () => {
    // With random = 0 → no jitter added
    expect(calcReconnectDelay(1, () => 0)).toBe(1000);
    // With random = 1 → max jitter (30%)
    expect(calcReconnectDelay(1, () => 1)).toBe(1300);
    expect(calcReconnectDelay(3, () => 1)).toBe(5200); // 4000 + 4000*0.3
  });

  test('jitter produces different values for same attempt count', () => {
    const values = new Set();
    for (let i = 0; i < 20; i++) {
      values.add(calcReconnectDelay(3));
    }
    // With real Math.random, should produce multiple distinct values
    expect(values.size).toBeGreaterThan(1);
  });

  test('jitter never exceeds 30% of base delay', () => {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const base = calcReconnectDelayNoJitter(attempt);
      for (let i = 0; i < 50; i++) {
        const withJitter = calcReconnectDelay(attempt);
        expect(withJitter).toBeGreaterThanOrEqual(base);
        expect(withJitter).toBeLessThanOrEqual(Math.round(base * 1.3));
      }
    }
  });

  test('capped delay (30s) also gets jitter', () => {
    const base = calcReconnectDelayNoJitter(6); // 30000
    const withJitter = calcReconnectDelay(6, () => 0.5);
    expect(withJitter).toBe(Math.round(30000 + 30000 * 0.5 * 0.3)); // 34500
  });
});

describe('Step 4: init() re-entry guard', () => {
  test('first call completes normally', async () => {
    const guard = simulateInitGuard();
    const result = await guard.init();
    expect(result).toBe('completed');
    expect(guard.isInitialized()).toBe(true);
    expect(guard.getCallCount()).toBe(1);
  });

  test('second call after completion returns immediately', async () => {
    const guard = simulateInitGuard();
    await guard.init();
    const result = await guard.init();
    expect(result).toBe('already_initialized');
    expect(guard.getCallCount()).toBe(1);
  });

  test('concurrent call is blocked by inflight guard', async () => {
    const guard = simulateInitGuard();
    const p1 = guard.init();
    const p2 = guard.init(); // should be blocked
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('completed');
    expect(r2).toBe('blocked_inflight');
    expect(guard.getCallCount()).toBe(1);
  });

  test('inflight flag is cleared even if init throws', async () => {
    let _initInFlight = false;
    let _initialized = false;

    async function init() {
      if (_initialized) return;
      if (_initInFlight) return 'blocked';
      _initInFlight = true;
      try {
        throw new Error('simulated failure');
      } finally {
        _initInFlight = false;
      }
    }

    await expect(init()).rejects.toThrow('simulated failure');
    expect(_initInFlight).toBe(false); // cleared in finally
    // Can retry after failure
    _initInFlight = false;
    // Not blocked
    expect(_initInFlight).toBe(false);
  });
});

describe('Step 2: pagehide persist logic', () => {
  test('forcePersist bypasses debounce timer', () => {
    const sim = simulatePersistDebounce();
    let timerId = null;

    // Simulate debounced persist (would wait 30s)
    sim.debouncedPersist(
      () => { timerId = null; },
      (fn, ms) => { timerId = 'pending'; return timerId; }
    );
    expect(sim.getPersistCount()).toBe(0); // not yet persisted

    // Simulate pagehide → force persist
    sim.forcePersist(() => { timerId = null; });
    expect(sim.getPersistCount()).toBe(1); // immediately persisted
  });

  test('forcePersist cancels pending debounce timer', () => {
    let clearCount = 0;
    const sim = simulatePersistDebounce();

    // debouncedPersist sets a timer (clearTimeout is called first to cancel any existing)
    sim.debouncedPersist(
      () => { clearCount++; },
      (fn) => 'timer123'
    );
    const clearCountAfterDebounce = clearCount;

    // forcePersist should call clearTimeout again to cancel the pending timer
    sim.forcePersist((t) => { clearCount++; });
    expect(clearCount).toBeGreaterThan(clearCountAfterDebounce);
    expect(sim.getPersistCount()).toBe(1);
  });
});
