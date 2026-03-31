/**
 * Notification toggle unit tests
 *
 * Source files:
 *   js/modules/message/message-line-push.js
 *   js/modules/message/notif-settings.js
 *   js/firebase-service.js
 */

// ---------------------------------------------------------------------------
// Extracted from js/modules/message/message-line-push.js:7-31, 88-103
// Determines whether notification toggles should block a LINE push
// ---------------------------------------------------------------------------
const FORCED_ON_SOURCES = [
  'template:waitlist_promoted',
  'template:event_cancelled',
  'template:event_changed',
];

function isForcedLinePushSource(source) {
  const safeSource = String(source || '').trim();
  return FORCED_ON_SOURCES.some(prefix => safeSource.startsWith(prefix))
    || safeSource.startsWith('target:');
}

function _linePushCategoryKey(category) {
  if (category === 'private') return 'system';
  return category;
}

function shouldSkipLinePushByToggles(category, options, toggles) {
  const source = String(options?.source || '').trim();
  const isForced = isForcedLinePushSource(source);

  if (isForced) return false;

  const safeToggles = toggles || {};
  const categoryKey = 'category_' + _linePushCategoryKey(category);
  if (safeToggles[categoryKey] === false) return true;

  if (source.startsWith('template:')) {
    const typeKey = 'type_' + source.slice('template:'.length);
    if (safeToggles[typeKey] === false) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Extracted from js/firebase-service.js:1006-1014
// Returns notificationToggles map from cached featureFlags doc
// ---------------------------------------------------------------------------
function getNotificationTogglesFromDoc(doc) {
  return (doc?.notificationToggles && typeof doc.notificationToggles === 'object' && !Array.isArray(doc.notificationToggles))
    ? doc.notificationToggles
    : {};
}

function setNotificationTogglesCache(singleDocCache, toggles) {
  const cacheKey = 'siteConfig/featureFlags';
  const current = singleDocCache[cacheKey] || {};
  singleDocCache[cacheKey] = {
    ...current,
    notificationToggles: { ...(toggles || {}) },
  };
  return singleDocCache[cacheKey];
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/message/notif-settings.js:28-66, 128-156
// Validates and saves notification toggle settings
// ---------------------------------------------------------------------------
const ALLOWED_TOGGLE_KEYS = [
  'category_activity',
  'category_system',
  'category_tournament',
  'type_signup_success',
  'type_cancel_signup',
  'type_waitlist_demoted',
  'type_event_relisted',
  'type_role_upgrade',
  'type_welcome',
];

function validateNotifToggles(toggles) {
  if (!toggles || typeof toggles !== 'object' || Array.isArray(toggles)) {
    return { ok: false, message: '推播開關格式錯誤' };
  }

  const allowed = new Set(ALLOWED_TOGGLE_KEYS);
  const keys = Object.keys(toggles);
  if (!keys.every(key => allowed.has(key))) {
    return { ok: false, message: '推播開關包含未允許的設定鍵' };
  }

  if (!keys.every(key => typeof toggles[key] === 'boolean')) {
    return { ok: false, message: '推播開關的值必須是布林' };
  }

  return { ok: true };
}

async function saveNotifSettingsPure(toggles, deps) {
  if (!deps.hasPermission('admin.notif.toggle')) {
    deps.showToast('權限不足');
    return false;
  }

  try {
    await deps.ensureFeatureFlagsLoaded();
  } catch (err) {
    deps.showToast('通知設定載入失敗，請稍後再試');
    return false;
  }

  const validation = validateNotifToggles(toggles);
  if (!validation.ok) {
    deps.showToast(validation.message);
    return false;
  }

  try {
    await deps.setFeatureFlags({
      notificationToggles: toggles,
    }, { merge: true });
  } catch (err) {
    deps.showToast('儲存失敗，請稍後再試');
    return false;
  }

  deps.setNotificationTogglesCache(deps.singleDocCache, toggles);
  deps.showToast('推播通知設定已儲存');
  return true;
}

async function queueLinePushPure(input, deps) {
  const source = String(input?.source || '').trim();
  const shouldPreloadToggles = !input?.isDemo
    && !isForcedLinePushSource(source)
    && !input?.hasCachedFeatureFlags
    && typeof deps.ensureFeatureFlagsLoaded === 'function';

  if (shouldPreloadToggles) {
    try {
      await deps.ensureFeatureFlagsLoaded();
    } catch (err) {
      // Falls back to current cache/default behavior when preload fails.
    }
  }

  if (shouldSkipLinePushByToggles(input.category, { source }, deps.getNotificationToggles())) {
    return 'skipped';
  }

  deps.dispatch();
  return 'queued';
}

// ===========================================================================
// Tests
// ===========================================================================

describe('notification toggle guard', () => {
  test('category toggle blocks matching category notifications', () => {
    expect(shouldSkipLinePushByToggles('activity', {}, {
      category_activity: false,
    })).toBe(true);
  });

  test('category toggle does not block other categories', () => {
    expect(shouldSkipLinePushByToggles('system', {}, {
      category_activity: false,
    })).toBe(false);
  });

  test('template type toggle blocks matching template source', () => {
    expect(shouldSkipLinePushByToggles('activity', {
      source: 'template:signup_success',
    }, {
      type_signup_success: false,
    })).toBe(true);
  });

  test('forced template sources always bypass toggles', () => {
    expect(shouldSkipLinePushByToggles('activity', {
      source: 'template:waitlist_promoted',
    }, {
      category_activity: false,
      type_waitlist_promoted: false,
    })).toBe(false);
  });

  test('target broadcasts always bypass toggles', () => {
    expect(shouldSkipLinePushByToggles('system', {
      source: 'target:all',
    }, {
      category_system: false,
    })).toBe(false);
  });

  test('detects forced sources consistently', () => {
    expect(isForcedLinePushSource('template:event_changed')).toBe(true);
    expect(isForcedLinePushSource('target:admin')).toBe(true);
    expect(isForcedLinePushSource('template:signup_success')).toBe(false);
  });

  test('empty toggles safely default to allow', () => {
    expect(shouldSkipLinePushByToggles('activity', {}, {})).toBe(false);
    expect(shouldSkipLinePushByToggles('activity', {}, null)).toBe(false);
  });
});

describe('getNotificationTogglesFromDoc', () => {
  test('returns notificationToggles when present', () => {
    expect(getNotificationTogglesFromDoc({
      notificationToggles: { category_activity: false },
    })).toEqual({ category_activity: false });
  });

  test('returns empty object when field missing or invalid', () => {
    expect(getNotificationTogglesFromDoc({})).toEqual({});
    expect(getNotificationTogglesFromDoc({ notificationToggles: null })).toEqual({});
    expect(getNotificationTogglesFromDoc({ notificationToggles: [] })).toEqual({});
  });
});

describe('setNotificationTogglesCache', () => {
  test('merges notification toggles into featureFlags cache', () => {
    const cache = {
      'siteConfig/featureFlags': { useServerRegistration: true },
    };

    const updated = setNotificationTogglesCache(cache, { category_activity: false });

    expect(updated).toEqual({
      useServerRegistration: true,
      notificationToggles: { category_activity: false },
    });
    expect(cache['siteConfig/featureFlags']).toEqual(updated);
  });
});

describe('saveNotifSettingsPure', () => {
  function createDeps(overrides = {}) {
    return {
      hasPermission: () => true,
      ensureFeatureFlagsLoaded: jest.fn().mockResolvedValue(undefined),
      setFeatureFlags: jest.fn().mockResolvedValue(undefined),
      setNotificationTogglesCache: jest.fn(setNotificationTogglesCache),
      showToast: jest.fn(),
      singleDocCache: {},
      ...overrides,
    };
  }

  test('writes featureFlags with merge and updates local cache', async () => {
    const deps = createDeps();
    const toggles = { category_activity: false, type_signup_success: true };

    const result = await saveNotifSettingsPure(toggles, deps);

    expect(result).toBe(true);
    expect(deps.ensureFeatureFlagsLoaded).toHaveBeenCalledTimes(1);
    expect(deps.setFeatureFlags).toHaveBeenCalledWith({
      notificationToggles: toggles,
    }, { merge: true });
    expect(deps.setNotificationTogglesCache).toHaveBeenCalledWith(deps.singleDocCache, toggles);
    expect(deps.singleDocCache['siteConfig/featureFlags']).toEqual({
      notificationToggles: toggles,
    });
    expect(deps.showToast).toHaveBeenCalledWith('推播通知設定已儲存');
  });

  test('initializes cache object when featureFlags cache is absent', async () => {
    const deps = createDeps({ singleDocCache: {} });
    const toggles = { category_system: false };

    await saveNotifSettingsPure(toggles, deps);

    expect(deps.singleDocCache['siteConfig/featureFlags'].notificationToggles).toEqual(toggles);
  });

  test('rejects save without admin.notif.toggle permission', async () => {
    const deps = createDeps({ hasPermission: () => false });

    const result = await saveNotifSettingsPure({ category_activity: false }, deps);

    expect(result).toBe(false);
    expect(deps.ensureFeatureFlagsLoaded).not.toHaveBeenCalled();
    expect(deps.setFeatureFlags).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('權限不足');
  });

  test('rejects unknown toggle keys', async () => {
    const deps = createDeps();

    const result = await saveNotifSettingsPure({ debug_mode: true }, deps);

    expect(result).toBe(false);
    expect(deps.ensureFeatureFlagsLoaded).toHaveBeenCalledTimes(1);
    expect(deps.setFeatureFlags).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('推播開關包含未允許的設定鍵');
  });

  test('rejects non-boolean toggle values', async () => {
    const deps = createDeps();

    const result = await saveNotifSettingsPure({ category_activity: 'false' }, deps);

    expect(result).toBe(false);
    expect(deps.ensureFeatureFlagsLoaded).toHaveBeenCalledTimes(1);
    expect(deps.setFeatureFlags).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('推播開關的值必須是布林');
  });

  test('aborts save when featureFlags cannot be preloaded', async () => {
    const deps = createDeps({
      ensureFeatureFlagsLoaded: jest.fn().mockRejectedValue(new Error('preload_failed')),
    });

    const result = await saveNotifSettingsPure({ category_activity: false }, deps);

    expect(result).toBe(false);
    expect(deps.setFeatureFlags).not.toHaveBeenCalled();
    expect(deps.singleDocCache['siteConfig/featureFlags']).toBeUndefined();
    expect(deps.showToast).toHaveBeenCalledWith('通知設定載入失敗，請稍後再試');
  });

  test('surfaces Firestore save failure without mutating cache', async () => {
    const deps = createDeps({
      setFeatureFlags: jest.fn().mockRejectedValue(new Error('write_failed')),
    });

    const result = await saveNotifSettingsPure({ category_activity: false }, deps);

    expect(result).toBe(false);
    expect(deps.singleDocCache['siteConfig/featureFlags']).toBeUndefined();
    expect(deps.showToast).toHaveBeenCalledWith('儲存失敗，請稍後再試');
  });
});

describe('queueLinePushPure', () => {
  function createQueueDeps(overrides = {}) {
    return {
      ensureFeatureFlagsLoaded: jest.fn().mockResolvedValue(undefined),
      getNotificationToggles: jest.fn(() => ({})),
      dispatch: jest.fn(),
      ...overrides,
    };
  }

  test('preloads featureFlags before evaluating non-forced toggles when cache is cold', async () => {
    const deps = createQueueDeps({
      getNotificationToggles: jest.fn(() => ({ category_activity: false })),
    });

    const result = await queueLinePushPure({
      category: 'activity',
      source: 'template:signup_success',
      hasCachedFeatureFlags: false,
      isDemo: false,
    }, deps);

    expect(deps.ensureFeatureFlagsLoaded).toHaveBeenCalledTimes(1);
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(result).toBe('skipped');
  });

  test('forced sources bypass preload and still queue immediately', async () => {
    const deps = createQueueDeps({
      getNotificationToggles: jest.fn(() => ({ category_activity: false })),
    });

    const result = await queueLinePushPure({
      category: 'activity',
      source: 'template:event_changed',
      hasCachedFeatureFlags: false,
      isDemo: false,
    }, deps);

    expect(deps.ensureFeatureFlagsLoaded).not.toHaveBeenCalled();
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(result).toBe('queued');
  });
});
