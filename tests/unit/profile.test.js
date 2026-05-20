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

describe('secondary identity profile controls', () => {
  test('profile page exposes simplified secondary toggle, edit, alias, and avatar controls', () => {
    const profileHtml = readProjectFile('pages/profile.html');

    expect(profileHtml).toContain('id="profile-identity-card"');
    expect(profileHtml).toContain('data-permission-code="profile.secondary_identity"');
    expect(profileHtml).toContain('\u7b2c\u4e8c\u8eab\u4efd');
    expect(profileHtml).toContain("_showProfileInfo('secondaryIdentity')");
    expect(profileHtml).toContain('id="profile-secondary-enabled"');
    expect(profileHtml).toMatch(/<span[^>]*>\u555f\u7528<\/span>/);
    expect(profileHtml).toContain('handleSecondaryIdentityToggleChange()');
    expect(profileHtml).toContain('id="profile-identity-edit-btn"');
    expect(profileHtml).toContain('toggleIdentitySettingsEdit()');
    expect(profileHtml).toContain('class="profile-identity-summary"');
    expect(profileHtml.indexOf('id="profile-identity-edit-btn"')).toBeGreaterThan(
      profileHtml.indexOf('class="profile-identity-summary"'),
    );
    expect(profileHtml).toContain('id="profile-secondary-display-name"');
    expect(profileHtml).toContain('id="profile-secondary-avatar-input"');
    expect(profileHtml).not.toContain('name="profile-active-identity"');
    expect(profileHtml).not.toContain('id="profile-identity-secondary"');
  });

  test('profile UI writes identityPrivate settings and commits avatar through callable', () => {
    const profileRenderSource = readProjectFile('js/modules/profile/profile-data-render.js');
    const profileCss = readProjectFile('css/profile.css');
    const apiSource = readProjectFile('js/api-service.js');
    const crudSource = readProjectFile('js/firebase-crud.js');
    const firebaseSource = readProjectFile('js/firebase-service.js');
    const roleSource = readProjectFile('js/modules/role.js');

    expect(profileRenderSource).toContain('renderIdentitySettings()');
    expect(profileRenderSource).toContain('_canUseSecondaryIdentityFeature()');
    expect(profileRenderSource).toContain('_syncSecondaryIdentityFeatureVisibility()');
    expect(profileRenderSource).toContain("card.style.display = allowed ? '' : 'none';");
    expect(profileRenderSource).toContain("this.showToast('\\u6c92\\u6709\\u7b2c\\u4e8c\\u8eab\\u4efd\\u6b0a\\u9650')");
    expect(profileRenderSource).toContain('saveIdentitySettings(options = {})');
    expect(profileRenderSource).toContain('async handleSecondaryIdentityToggleChange()');
    expect(profileRenderSource).toContain('toggleIdentitySettingsEdit()');
    expect(profileRenderSource).toContain('uploadSecondaryIdentityAvatar(input)');
    expect(profileRenderSource).toContain('_cropSecondaryIdentityAvatarFile(file)');
    expect(profileRenderSource).toContain('const canEditDetails = !enabled && editing;');
    expect(profileRenderSource).toContain('const saveMode = !enabled && editing;');
    expect(profileRenderSource).toContain('this._getResolvedSecondaryDisplayName(displayName)');
    expect(profileRenderSource).toContain('summaryStatusEl.innerHTML = enabled');
    expect(profileRenderSource).toContain('\\u76ee\\u524d\\u8eab\\u4efd\\u5df2\\u555f\\u7528');
    expect(profileRenderSource).toContain('profile-identity-capability-list');
    expect(profileRenderSource).toContain("toastMessage: enabled ?");
    expect(profileRenderSource).toContain('\\u8acb\\u5148\\u95dc\\u9589\\u7b2c\\u4e8c\\u8eab\\u4efd\\u624d\\u53ef\\u4ee5\\u7de8\\u8f2f');
    expect(profileRenderSource).toContain('return true;');
    expect(profileRenderSource).toContain('return false;');
    expect(profileRenderSource).toContain("card?.classList.toggle('is-secondary-enabled', enabled)");
    expect(profileRenderSource).toContain("card?.classList.toggle('is-identity-editing', editing)");
    expect(profileRenderSource).toContain("uploadBtn.classList.toggle('disabled', !canEditDetails)");
    expect(profileRenderSource).toContain('if (clearBtn) clearBtn.disabled = !canEditDetails');
    expect(profileCss).toContain('.profile-identity-control');
    expect(profileCss).toContain('.profile-identity-summary');
    expect(profileCss).toContain('#profile-identity-card.is-identity-editing .profile-identity-editor');
    expect(profileCss).toContain('#profile-identity-card:not(.is-secondary-enabled) .profile-identity-avatar');
    expect(profileCss).toContain('filter: grayscale(1) brightness(.62) saturate(.45);');
    expect(profileCss).toContain('#profile-identity-card.is-secondary-enabled .profile-identity-avatar');
    expect(profileRenderSource).toContain("const activeId = enabled ? 'secondary' : 'main';");
    expect(profileRenderSource).toContain("profileActiveIdentityId: activeId");
    expect(profileRenderSource).toContain('this.renderLoginUI?.();');
    expect(profileRenderSource).toContain('this.renderProfileData?.();');
    expect(profileRenderSource).toContain('this.showImageCropper(sourceDataURL, {');
    expect(profileRenderSource).toContain('aspectRatio: 1');
    expect(profileRenderSource).toContain('outputWidth: 512');
    expect(profileRenderSource).toContain('outputHeight: 512');
    expect(apiSource).toContain('updateCurrentIdentitySettings(payload)');
    expect(apiSource).toContain('canUseSecondaryIdentityFeature(role = null)');
    expect(apiSource).toContain("includes('profile.secondary_identity')");
    expect(apiSource).toContain('uploadSecondaryIdentityAvatar(base64DataUrl)');
    expect(firebaseSource).toContain('ensureCurrentIdentitySettingsLoaded(options = {})');
    expect(firebaseSource).toContain("ref.get({ source: options.source || 'server' })");
    expect(firebaseSource).toContain('_applyIdentityPrivateSettingsSnapshot(snapshot');
    expect(firebaseSource).toContain('this._setupIdentityPrivateListener(auth.currentUser.uid);');
    expect(firebaseSource).toContain("identityPrivate/settings resume load failed");
    expect(roleSource).toContain("document.querySelectorAll('[data-permission-code]')");
    expect(roleSource).toContain('this.hasPermission(code, role)');
    expect(crudSource).toContain("httpsCallable('commitIdentitySettings')");
    expect(crudSource).toContain("httpsCallable('commitSecondaryIdentityAvatar')");
    expect(crudSource).toContain('_normalizeStorageBucketName');
    expect(crudSource).toContain('users/${uid}/identities/secondary/avatar');
  });

  test('secondary identity profile card keeps only avatar and nickname visible', () => {
    const profileCardSource = readProjectFile('js/modules/profile/profile-card.js');
    const profileCoreSource = readProjectFile('js/modules/profile/profile-core.js');
    const profileCss = readProjectFile('css/profile.css');

    expect(profileCardSource).toContain("const isSecondaryIdentity = identity?.identityId === 'secondary';");
    expect(profileCoreSource).toContain("const isSecondaryIdentity = isSelf && currentIdentity?.identityId === 'secondary';");
    expect(profileCoreSource).toContain("this._getAvatarCandidateUrls(...identityCandidates)");
    expect(profileCoreSource).not.toContain('lineProfile && lineProfile.pictureUrl');
    expect(profileCardSource).toContain('uc-secondary-private-wrap');
    expect(profileCoreSource).toContain('uc-secondary-private-wrap');
    expect(profileCardSource).toContain('isSecondaryIdentity ?');
    expect(profileCoreSource).toContain('userCardContainer.classList.toggle');
    expect(profileCss).toContain('.uc-secondary-private-overlay');
    expect(profileCss).toContain('backdrop-filter: blur(16px) saturate(130%)');
    expect(profileCss).toContain('.uc-secondary-private-content');
    expect(profileCss).toContain('filter: blur(12px)');
  });

  test('profile page header uses the full my profile label without renaming the bottom tab', () => {
    const profileHtml = readProjectFile('pages/profile.html');
    const navigationSource = readProjectFile('js/core/navigation.js');

    expect(profileHtml).toContain('data-i18n="profile.myProfile"');
    expect(profileHtml).toContain('&#25105;&#30340;&#36039;&#26009;');
    expect(navigationSource).toContain("profilePageHeader.textContent = t('profile.myProfile')");
    expect(navigationSource).toContain("'nav.profile'");
  });

  test('topbar avatar shows a spinner while logged-in profile data is still syncing', () => {
    const profileFormSource = readProjectFile('js/modules/profile/profile-form.js');
    const profileAvatarSource = readProjectFile('js/modules/profile/profile-avatar.js');
    const layoutCss = readProjectFile('css/layout.css');

    expect(profileFormSource).toContain('const hasResolvedDisplayName = !!(identity?.displayName || currentUser?.displayName || currentUser?.name);');
    expect(profileFormSource).toContain('const isAvatarSyncing = !hasResolvedDisplayName && !avatarCandidates.length;');
    expect(profileFormSource).toContain('isSyncing: isAvatarSyncing');
    expect(profileAvatarSource).toContain('_buildTopbarAvatarFallback(initial, isSyncing = false)');
    expect(profileAvatarSource).toContain('line-avatar-spinner');
    expect(profileAvatarSource).toContain("const isSyncing = !!options.isSyncing && !candidateUrls.length;");
    expect(layoutCss).toContain('.line-avatar-loading');
    expect(layoutCss).toContain('@keyframes line-avatar-spin');
  });
});

describe('first login profile completion modal', () => {
  test('renders optional email benefits and uses the dedicated frosted scroll lock path', () => {
    const indexHtml = readProjectFile('index.html');
    const baseCss = readProjectFile('css/base.css');
    const layoutCss = readProjectFile('css/layout.css');
    const navigationSource = readProjectFile('js/core/navigation.js');
    const profileFormSource = readProjectFile('js/modules/profile/profile-form.js');
    const e2eSource = readProjectFile('tests/e2e/example.spec.js');

    expect(indexHtml).toContain('id="fl-email"');
    expect(indexHtml).toMatch(/電子郵件\s*<span class="fl-optional"[^>]*>非必填<\/span>/);
    expect(indexHtml).toContain('填寫 Email 後，未來可收到第一手運動活動通知、早鳥名額提醒、候補釋出與平台重要訊息');
    expect(indexHtml).toContain('id="fl-legal-consent"');
    expect(indexHtml).toContain('我已閱讀並同意');
    expect(indexHtml).toContain('href="/terms"');
    expect(indexHtml).toContain('href="/privacy"');
    expect(indexHtml).toContain('稍後填寫');
    expect(indexHtml).toContain('同意並送出');
    expect(indexHtml).toContain('const textLen = msg ? Array.from(String(msg).replace(/\\s/g, \'\')).length : 0;');
    expect(baseCss).toContain('width: max-content;');
    expect(baseCss).toContain('max-width: min(360px, calc(100vw - 32px));');
    expect(baseCss).toContain('overflow-wrap: anywhere;');
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
    expect(profileFormSource).toContain("var requiredMsg = '請填寫所有必填欄位（性別、生日、地區）';");
    expect(profileFormSource).toContain("if (typeof this.showToast === 'function') this.showToast(requiredMsg);");
    expect(profileFormSource).toContain('var firstMissingEl = !gender ? genderEl');
    expect(profileFormSource).toContain("if (typeof this.showToast === 'function') this.showToast(msg);");
    expect(profileFormSource).toContain("this._buildFirstLoginLegalUpdates('profile_completion_submit')");
    expect(profileFormSource).not.toContain("this._buildFirstLoginLegalUpdates('profile_completion_later')");
    expect(profileFormSource).toContain('此動作代表暫不同意，不寫入任何個資或條款同意紀錄。');
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
