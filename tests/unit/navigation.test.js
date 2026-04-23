/**
 * Navigation module unit tests — extracted pure functions.
 *
 * Source file: js/core/navigation.js
 */

// ---------------------------------------------------------------------------
// Extracted from js/core/navigation.js:71-73
// _getPageStrategy — returns strategy or default
// ---------------------------------------------------------------------------
function _getPageStrategy(pageId, PAGE_STRATEGY) {
  return (PAGE_STRATEGY && PAGE_STRATEGY[pageId]) || 'fresh-first';
}

// ---------------------------------------------------------------------------
// Extracted from js/core/navigation.js:89-96
// _canUseStaleNavigation — determines if stale navigation is allowed
// Adapted: accepts explicit dependencies instead of this.*
// ---------------------------------------------------------------------------
function _canUseStaleNavigation(pageId, options, deps) {
  const { authPending = false } = options;
  const { isDemo, currentPage, getPageStrategy, hasCachedDataForPage } = deps;
  if (isDemo || authPending) return false;
  if (pageId === currentPage) return false;
  const strategy = getPageStrategy(pageId);
  if (strategy !== 'stale-first' && strategy !== 'stale-confirm') return false;
  return hasCachedDataForPage(pageId);
}

// ---------------------------------------------------------------------------
// Extracted from js/core/navigation.js:168-186
// _normalizeAdminLogRoute — normalizes admin log page aliases
// ---------------------------------------------------------------------------
function _normalizeAdminLogRoute(pageId, options, activeTab) {
  let normalizedPageId = pageId;
  let adminLogTab = options.adminLogTab || '';

  if (pageId === 'page-admin-audit-logs') {
    normalizedPageId = 'page-admin-logs';
    adminLogTab = 'audit';
  } else if (pageId === 'page-admin-error-logs') {
    normalizedPageId = 'page-admin-logs';
    adminLogTab = 'error';
  }

  if (normalizedPageId === 'page-admin-logs') {
    adminLogTab = adminLogTab || (pageId === 'page-admin-logs' ? 'operation' : activeTab || 'operation');
  }

  return { pageId: normalizedPageId, adminLogTab };
}

// ---------------------------------------------------------------------------
// Extracted from js/core/navigation.js:23-31
// _getRouteFailureToast — returns toast message for route failure
// ---------------------------------------------------------------------------
function _getRouteFailureToast(pageId, step, err) {
  const isTimeout = err?.code === 'route-step-timeout';
  if (isTimeout) {
    if (pageId === 'page-activities') return '網路較慢，活動頁暫時無法開啟，請稍後再試';
    return '網路較慢，頁面暫時無法開啟，請稍後再試';
  }
  if (step === 'cloud') return '雲端連線失敗，請稍後再試';
  return '頁面載入失敗，請稍後再試';
}

// ---------------------------------------------------------------------------
// Extracted from js/core/navigation.js:704-710
// _pushPageHistory — manages page history stack
// ---------------------------------------------------------------------------
function _pushPageHistory(pageId, options, currentPage, pageHistory) {
  if (options.resetHistory) {
    pageHistory.length = 0;
  } else if (currentPage !== pageId) {
    pageHistory.push(currentPage);
  }
  return pageHistory;
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_getPageStrategy (navigation.js:71-73)', () => {
  test('returns configured strategy', () => {
    const config = { 'page-home': 'stale-first', 'page-teams': 'prepare-first' };
    expect(_getPageStrategy('page-home', config)).toBe('stale-first');
    expect(_getPageStrategy('page-teams', config)).toBe('prepare-first');
  });

  test('unknown page → fresh-first default', () => {
    expect(_getPageStrategy('page-unknown', {})).toBe('fresh-first');
  });

  test('null/undefined config → fresh-first default', () => {
    expect(_getPageStrategy('page-home', undefined)).toBe('fresh-first');
    expect(_getPageStrategy('page-home', null)).toBe('fresh-first');
  });
});

describe('_canUseStaleNavigation (navigation.js:89-96)', () => {
  const baseDeps = {
    isDemo: false,
    currentPage: 'page-home',
    getPageStrategy: () => 'stale-first',
    hasCachedDataForPage: () => true,
  };

  test('stale-first with cache → true', () => {
    expect(_canUseStaleNavigation('page-teams', {}, baseDeps)).toBe(true);
  });

  test('demo mode → false', () => {
    expect(_canUseStaleNavigation('page-teams', {}, { ...baseDeps, isDemo: true })).toBe(false);
  });

  test('auth pending → false', () => {
    expect(_canUseStaleNavigation('page-teams', { authPending: true }, baseDeps)).toBe(false);
  });

  test('same page as current → false', () => {
    expect(_canUseStaleNavigation('page-home', {}, baseDeps)).toBe(false);
  });

  test('fresh-first strategy → false', () => {
    expect(_canUseStaleNavigation('page-teams', {}, {
      ...baseDeps,
      getPageStrategy: () => 'fresh-first',
    })).toBe(false);
  });

  test('no cached data → false', () => {
    expect(_canUseStaleNavigation('page-teams', {}, {
      ...baseDeps,
      hasCachedDataForPage: () => false,
    })).toBe(false);
  });

  test('stale-confirm with cache → true', () => {
    expect(_canUseStaleNavigation('page-teams', {}, {
      ...baseDeps,
      getPageStrategy: () => 'stale-confirm',
    })).toBe(true);
  });
});

describe('_normalizeAdminLogRoute (navigation.js:168-186)', () => {
  test('audit-logs → page-admin-logs with audit tab', () => {
    const result = _normalizeAdminLogRoute('page-admin-audit-logs', {}, 'operation');
    expect(result.pageId).toBe('page-admin-logs');
    expect(result.adminLogTab).toBe('audit');
  });

  test('error-logs → page-admin-logs with error tab', () => {
    const result = _normalizeAdminLogRoute('page-admin-error-logs', {}, 'operation');
    expect(result.pageId).toBe('page-admin-logs');
    expect(result.adminLogTab).toBe('error');
  });

  test('page-admin-logs without explicit tab → operation default', () => {
    const result = _normalizeAdminLogRoute('page-admin-logs', {}, null);
    expect(result.pageId).toBe('page-admin-logs');
    expect(result.adminLogTab).toBe('operation');
  });

  test('page-admin-logs with options.adminLogTab → uses provided tab', () => {
    const result = _normalizeAdminLogRoute('page-admin-logs', { adminLogTab: 'audit' }, null);
    expect(result.pageId).toBe('page-admin-logs');
    expect(result.adminLogTab).toBe('audit');
  });

  test('non-admin page → unchanged', () => {
    const result = _normalizeAdminLogRoute('page-home', {}, null);
    expect(result.pageId).toBe('page-home');
    expect(result.adminLogTab).toBe('');
  });
});

describe('_getRouteFailureToast (navigation.js:23-31)', () => {
  test('timeout on activities page → specific message', () => {
    const msg = _getRouteFailureToast('page-activities', 'page', { code: 'route-step-timeout' });
    expect(msg).toContain('活動頁');
  });

  test('timeout on other page → generic timeout message', () => {
    const msg = _getRouteFailureToast('page-teams', 'page', { code: 'route-step-timeout' });
    expect(msg).toContain('網路較慢');
  });

  test('cloud step failure → cloud message', () => {
    const msg = _getRouteFailureToast('page-teams', 'cloud', null);
    expect(msg).toContain('雲端');
  });

  test('generic failure → page load failed', () => {
    const msg = _getRouteFailureToast('page-teams', 'page', null);
    expect(msg).toContain('載入失敗');
  });
});

describe('_pushPageHistory (navigation.js:568-574)', () => {
  test('navigating to new page → pushes current to history', () => {
    const history = ['page-home'];
    _pushPageHistory('page-teams', {}, 'page-activities', history);
    expect(history).toEqual(['page-home', 'page-activities']);
  });

  test('navigating to same page → no push', () => {
    const history = ['page-home'];
    _pushPageHistory('page-teams', {}, 'page-teams', history);
    expect(history).toEqual(['page-home']);
  });

  test('resetHistory option → clears history', () => {
    const history = ['page-home', 'page-teams'];
    _pushPageHistory('page-profile', { resetHistory: true }, 'page-activities', history);
    expect(history).toEqual([]);
  });
});
