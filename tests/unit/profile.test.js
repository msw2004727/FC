/**
 * Profile module unit tests — extracted pure functions.
 *
 * Source files:
 *   js/modules/profile/profile-core.js
 *   js/modules/profile/profile-avatar.js
 *   js/modules/profile/profile-data.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/profile/profile-core.js:17-26
// _calcLevelFromExp — quadratic formula: level from cumulative EXP
// Formula: upgrade to L costs 50*L*(L+1), each level N→N+1 costs (N+1)*100
// ---------------------------------------------------------------------------
function _calcLevelFromExp(totalExp) {
  if (totalExp <= 0) return { level: 0, progress: 0, needed: 100 };
  let level = Math.floor((-1 + Math.sqrt(1 + 4 * totalExp / 50)) / 2);
  if (level < 0) level = 0;
  if (level > 999) level = 999;
  const baseExp = 50 * level * (level + 1);
  const progress = totalExp - baseExp;
  const needed = (level + 1) * 100;
  return { level, progress, needed };
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/profile/profile-avatar.js:63-73
// _getAvatarCandidateUrls — deduplicates & trims URL candidates
// ---------------------------------------------------------------------------
function _getAvatarCandidateUrls(...urls) {
  const seen = new Set();
  return urls
    .flat()
    .map(url => (typeof url === 'string' ? url.trim() : ''))
    .filter(url => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/profile/profile-avatar.js:80-83
// _getAvatarInitial — first character fallback for avatar
// (simplified: no escapeHTML in test context)
// ---------------------------------------------------------------------------
function _getAvatarInitial(name) {
  const text = String(name || '?').trim();
  return text ? text.charAt(0) : '?';
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/profile/profile-data.js:110-119
// _getFirstLoginRegionList — full region list
// ---------------------------------------------------------------------------
function _getFirstLoginRegionList() {
  return [
    '台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市',
    '基隆市', '新竹市', '嘉義市',
    '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣',
    '屏東縣', '宜蘭縣', '花蓮縣', '台東縣',
    '澎湖縣', '金門縣', '連江縣',
    '其他',
  ];
}

// ---------------------------------------------------------------------------
// Extracted from js/modules/profile/profile-data.js:121-127
// _normalizeRegionKeyword — normalize for search
// ---------------------------------------------------------------------------
function _normalizeRegionKeyword(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/臺/g, '台')
    .replace(/\s+/g, '');
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('_calcLevelFromExp (profile-core.js:17-26)', () => {
  test('0 EXP → level 0', () => {
    const result = _calcLevelFromExp(0);
    expect(result.level).toBe(0);
    expect(result.progress).toBe(0);
    expect(result.needed).toBe(100);
  });

  test('negative EXP → level 0', () => {
    const result = _calcLevelFromExp(-50);
    expect(result.level).toBe(0);
    expect(result.progress).toBe(0);
  });

  test('100 EXP → level 1 with 0 progress', () => {
    // baseExp for level 1 = 50 * 1 * 2 = 100
    const result = _calcLevelFromExp(100);
    expect(result.level).toBe(1);
    expect(result.progress).toBe(0);
    expect(result.needed).toBe(200);
  });

  test('50 EXP → level 0 with 50 progress', () => {
    // baseExp for level 0 = 0
    const result = _calcLevelFromExp(50);
    expect(result.level).toBe(0);
    expect(result.progress).toBe(50);
    expect(result.needed).toBe(100);
  });

  test('300 EXP → level 2', () => {
    // baseExp for level 2 = 50 * 2 * 3 = 300
    const result = _calcLevelFromExp(300);
    expect(result.level).toBe(2);
    expect(result.progress).toBe(0);
    expect(result.needed).toBe(300);
  });

  test('large EXP → capped at level 999', () => {
    const result = _calcLevelFromExp(999999999);
    expect(result.level).toBe(999);
  });

  test('level progression is correct for early levels', () => {
    // Level 0 → 1: need 100 EXP (baseExp L1 = 50*1*2 = 100)
    // Level 1 → 2: need 200 EXP (baseExp L2 = 50*2*3 = 300)
    // Level 2 → 3: need 300 EXP (baseExp L3 = 50*3*4 = 600)
    expect(_calcLevelFromExp(99).level).toBe(0);
    expect(_calcLevelFromExp(100).level).toBe(1);
    expect(_calcLevelFromExp(299).level).toBe(1);
    expect(_calcLevelFromExp(300).level).toBe(2);
    expect(_calcLevelFromExp(599).level).toBe(2);
    expect(_calcLevelFromExp(600).level).toBe(3);
  });
});

describe('profile EXP display refresh wiring', () => {
  test('points display refreshes top bar and profile exp fields', () => {
    const profileCoreSource = readProjectFile('js/modules/profile/profile-core.js');

    expect(profileCoreSource).toContain("const pointsEl = document.getElementById('points-value');");
    expect(profileCoreSource).toContain("const expTextEl = document.getElementById('profile-exp-text');");
    expect(profileCoreSource).toContain("const expFillEl = document.getElementById('profile-exp-fill');");
    expect(profileCoreSource).toContain("if (lvEl) lvEl.textContent = `Lv.${level}`;");
  });

  test('local and realtime EXP changes notify the shared points renderer', () => {
    const apiSource = readProjectFile('js/api-service.js');
    const crudSource = readProjectFile('js/firebase-crud.js');
    const profileFormSource = readProjectFile('js/modules/profile/profile-form.js');

    expect(apiSource).toContain('_syncCurrentUserExpFromUser(user)');
    expect(apiSource).toContain('App.updatePointsDisplay();');
    expect(apiSource).toContain('this._syncCurrentUserExpFromUser(user);');
    expect(crudSource).toContain('const expChanged = prev && (prev.exp || 0) !== (next.exp || 0);');
    expect(crudSource).toContain('App.updatePointsDisplay();');
    expect(profileFormSource).toContain('this.updatePointsDisplay?.();');
  });
});

describe('first login profile completion modal', () => {
  test('renders optional email benefits and uses the dedicated frosted scroll lock path', () => {
    const indexHtml = readProjectFile('index.html');
    const layoutCss = readProjectFile('css/layout.css');
    const navigationSource = readProjectFile('js/core/navigation.js');
    const profileFormSource = readProjectFile('js/modules/profile/profile-form.js');
    const e2eSource = readProjectFile('tests/e2e/example.spec.js');

    expect(indexHtml).toContain('id="fl-email"');
    expect(indexHtml).toContain('電子郵件 <span class="fl-optional">非必填</span>');
    expect(indexHtml).toContain('填寫 Email 後，未來可收到第一手運動活動通知、早鳥名額提醒、候補釋出與平台重要訊息');
    expect(indexHtml).toContain('id="fl-legal-consent"');
    expect(indexHtml).toContain('我已閱讀並同意');
    expect(indexHtml).toContain('href="/terms"');
    expect(indexHtml).toContain('href="/privacy"');
    expect(indexHtml).toContain('稍後填寫');
    expect(indexHtml).toContain('同意並送出');
    expect(layoutCss).toContain('#modal-overlay[data-profile-complete="1"]');
    expect(layoutCss).toContain('-webkit-backdrop-filter: blur(16px) saturate(135%)');
    expect(layoutCss).toContain('.fl-actions');
    expect(layoutCss).toContain('position: sticky;');
    expect(layoutCss).toContain('bottom: 0;');
    expect(layoutCss).toContain('.fl-legal-consent');
    expect(layoutCss).toContain('.fl-action-buttons');
    expect(navigationSource).toContain('_lockFirstLoginScroll()');
    expect(navigationSource).toContain('_unlockFirstLoginScroll()');
    expect(navigationSource).toContain("document.getElementById('fl-legal-consent')");
    expect(navigationSource).toContain('if (legalEl) legalEl.checked = false;');
    expect(profileFormSource).toContain("var emailEl = document.getElementById('fl-email');");
    expect(profileFormSource).toContain('updates.email = email;');
    expect(profileFormSource).toContain("_legalTermsVersion: '2026-05-19'");
    expect(profileFormSource).toContain("_legalPrivacyVersion: '2026-05-19'");
    expect(profileFormSource).toContain('_requireFirstLoginLegalConsent(showErr)');
    expect(profileFormSource).toContain("if (typeof this.showToast === 'function') this.showToast(msg);");
    expect(profileFormSource).toContain('if (consentEl && consentEl.checked)');
    expect(profileFormSource).toContain("this._buildFirstLoginLegalUpdates('profile_completion_submit')");
    expect(profileFormSource).toContain("this._buildFirstLoginLegalUpdates('profile_completion_later')");
    expect(e2eSource).toContain('return App.dismissFirstLoginModal();');
    expect(e2eSource).not.toContain('consent.checked = true');
  });
});

describe('_getAvatarCandidateUrls (profile-avatar.js:63-73)', () => {
  test('deduplicates URLs', () => {
    const result = _getAvatarCandidateUrls('http://a.com', 'http://a.com', 'http://b.com');
    expect(result).toEqual(['http://a.com', 'http://b.com']);
  });

  test('trims whitespace', () => {
    const result = _getAvatarCandidateUrls('  http://a.com  ');
    expect(result).toEqual(['http://a.com']);
  });

  test('filters out empty/null/undefined', () => {
    const result = _getAvatarCandidateUrls('', null, undefined, 'http://a.com');
    expect(result).toEqual(['http://a.com']);
  });

  test('flattens arrays', () => {
    const result = _getAvatarCandidateUrls(['http://a.com', 'http://b.com']);
    expect(result).toEqual(['http://a.com', 'http://b.com']);
  });

  test('no valid URLs → empty array', () => {
    expect(_getAvatarCandidateUrls(null, '', undefined)).toEqual([]);
  });

  test('non-string values → filtered', () => {
    const result = _getAvatarCandidateUrls(123, true, 'http://a.com');
    expect(result).toEqual(['http://a.com']);
  });
});

describe('_getAvatarInitial (profile-avatar.js:80-83)', () => {
  test('returns first character', () => {
    expect(_getAvatarInitial('Alice')).toBe('A');
  });

  test('Chinese name → first char', () => {
    expect(_getAvatarInitial('張三')).toBe('張');
  });

  test('null/undefined → ?', () => {
    expect(_getAvatarInitial(null)).toBe('?');
    expect(_getAvatarInitial(undefined)).toBe('?');
  });

  test('empty string → ?', () => {
    expect(_getAvatarInitial('')).toBe('?');
  });

  test('whitespace-only → ?', () => {
    expect(_getAvatarInitial('   ')).toBe('?');
  });
});

describe('_getFirstLoginRegionList (profile-data.js:110-119)', () => {
  test('returns 23 regions', () => {
    const regions = _getFirstLoginRegionList();
    expect(regions.length).toBe(23);
  });

  test('starts with 台北市', () => {
    expect(_getFirstLoginRegionList()[0]).toBe('台北市');
  });

  test('ends with 其他', () => {
    const regions = _getFirstLoginRegionList();
    expect(regions[regions.length - 1]).toBe('其他');
  });

  test('includes all six special municipalities', () => {
    const regions = _getFirstLoginRegionList();
    ['台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市'].forEach(city => {
      expect(regions).toContain(city);
    });
  });
});

describe('_normalizeRegionKeyword (profile-data.js:121-127)', () => {
  test('trims and lowercases', () => {
    expect(_normalizeRegionKeyword('  台北  ')).toBe('台北');
  });

  test('converts 臺 → 台', () => {
    expect(_normalizeRegionKeyword('臺北市')).toBe('台北市');
    expect(_normalizeRegionKeyword('臺中')).toBe('台中');
  });

  test('removes internal whitespace', () => {
    expect(_normalizeRegionKeyword('台 北 市')).toBe('台北市');
  });

  test('null/undefined → empty string', () => {
    expect(_normalizeRegionKeyword(null)).toBe('');
    expect(_normalizeRegionKeyword(undefined)).toBe('');
  });

  test('English lowercased', () => {
    expect(_normalizeRegionKeyword('Taipei')).toBe('taipei');
  });
});
