/** @jest-environment jsdom */
const vm = require('vm');
const { VALUES, load, mount, activate } = require('./event-binding-render-support');
afterEach(() => { document.body.innerHTML = ''; delete window.__x; jest.restoreAllMocks(); });
describe.each(VALUES)('事件繫結強化：其餘模組原值 %p', value => {
  test.each(['achievement/achievement.js', 'achievement/admin.js'])('成就管理列 %s', async file => {
    const seed = { _registerAchievementPart: jest.fn(), _getAchievementRegistry: () => ({ isSupportedCondition: () => true }) };
    const { app } = load(file, { getAchievements: () => [{ id: value, name: value, category: 'bronze', current: 0 }], getBadges: () => [] }, seed);
    Object.assign(app, { _sortByCat: rows => rows, _getAchThreshold: () => 1, _generateConditionDesc: () => '', _catColors: { bronze: 'gray' }, _catLabels: { bronze: '銅' } });
    mount('<div id="admin-ach-list"></div>');
    if (file.endsWith('/admin.js')) await app._buildAchievementAdmin().renderAdminAchievements();
    else app.renderAdminAchievements();
    expect(document.querySelector('.admin-ach-name').textContent).toBe(value);
    activate(app, '[onclick*="editAchievement"]', [['editAchievement', [value]]]);
  });
  test('廣告管理列：全部狀態', () => {
    const { app } = load('ad-manage/ad-manage-core.js');
    for (const status of ['empty', 'active', 'scheduled', 'expired']) {
      mount(app._adActionBtns(value, value, status));
      activate(app, '[onclick*="editAd"]', [['editAd', [value, value]]]);
    }
  });
  test('贊助商管理列', () => {
    const { app } = load('ad-manage/ad-manage-popup-sponsor.js', { getSponsors: () => [{ id: value, status: 'empty' }] });
    mount('<div id="sponsor-manage-list"></div>'); app.renderSponsorManage();
    activate(app, '.sp-row-save', [['editSponsorItem', [value]]]);
  });
  test('Banner 公告列', () => {
    const { app } = load('ad-manage/banner.js', { getActiveAnnouncements: () => [{ id: value, title: value, content: value }] });
    mount('<div id="announce-marquee-wrap"><div id="announce-marquee-track"></div></div>'); app.renderAnnouncement();
    activate(app, '.announce-marquee-item', [['showAnnDetail', [value]]]);
  });
  test('彈出廣告', () => {
    const { app } = load('ad-manage/popup-ad.js');
    Object.assign(app, { _popupAdQueue: [{ id: value, title: value, linkUrl: 'https://example.test' }], _popupAdIndex: 0 });
    mount('<div id="popup-ad-overlay"><div id="popup-ad-body"></div></div>'); app._showNextPopupAd();
    activate(app, '.popup-ad-placeholder', [['handlePopupAdClick', [value]]]);
  });
  test('SEO 說明按鈕', () => {
    const { app } = load('admin-seo/seo-dashboard.js');
    for (const key of Object.keys(app)) if (/^_seo.*HTML$/.test(key) && key !== '_seoDashboardHTML') app[key] = () => '';
    app._seoBuildFirstTwoPageQueries = () => []; app._esc = text => text;
    app._seoActionItemsHTML = (s, h, d, info) => info(value);
    mount(app._seoDashboardHTML({}, []));
    activate(app, '.seo-info-btn:nth-of-type(1)', [['_showSeoInfoPopup', ['meta']]]);
    const extra = document.querySelectorAll('.seo-info-btn')[1]; extra.id = 'seo-value';
    activate(app, '#seo-value', [['_showSeoInfoPopup', [value]]]);
  });
  test('新聞卡片', () => {
    const { app } = load('news.js'); mount('<div id="news-card-list"></div>');
    app._renderNewsCards([{ title: value, url: value }], document.getElementById('news-card-list'));
    expect(document.querySelector('.news-card-title').textContent).toBe(value);
    activate(app, '.news-card', [['_openNewsUrl', [value]]]);
  });
  test('商品卡片', () => {
    const { app } = load('shop.js', { getShopItems: () => [{ id: value, name: value, price: 1 }] });
    mount('<div id="shop-grid"></div>'); app.renderShop();
    activate(app, '.shop-card', [['showShopDetail', [value]]]);
  });
  test('主題管理列', () => {
    const { app } = load('site-theme.js', { getSiteThemes: () => [{ id: value, label: value }] });
    mount('<div id="theme-manage-list"></div>'); app.renderThemeManage();
    activate(app, '.primary-btn', [['showThemeForm', [value]]]);
  });
  test('俱樂部地區選項', () => {
    const { app, context } = load('team/team-form-init.js'); context.testValue = value;
    vm.runInContext('filterTwRegions = () => [testValue]', context);
    mount('<div id="ct-team-region-suggest"></div>'); app._renderTeamRegionSuggest(value);
    activate(app, '.team-user-suggest-item', [['_selectTeamRegion', [value]]], 'mousedown');
  });
  test('活動黑名單列', () => {
    const { app } = load('user-admin/user-admin-event-blocklist.js', { getEvents: () => [{ id: value, title: value, blockedUids: [value] }], getAdminUsers: () => [] });
    mount('<div id="eb-existing-list"></div>'); app._renderExistingEventBlocklist();
    activate(app, '.outline-btn', [['removeEventBlocklistEntry', [value, value]]]);
  });
  test('經驗值用戶搜尋與標籤', () => {
    const { app } = load('user-admin/user-admin-exp.js', { getAdminUsers: () => [{ name: value, uid: 'sample' }] });
    mount('<input id="exp-search"><div id="exp-search-dropdown"></div><div id="exp-batch-tags"></div>');
    document.getElementById('exp-search').value = value.slice(0, 2); app.expFuzzySearch();
    activate(app, '.ce-delegate-item', [['_selectExpTarget', [value]]]);
    app._expBatchSelected = [value]; app._renderExpBatchTags();
    activate(app, '.reward-tag button', [['_removeExpBatchUser', [value]]]);
  });
  test('用戶管理列：查看、編輯、限制', () => {
    const { app } = load('user-admin/user-admin-list.js');
    Object.assign(app, { _bindAdminUserFilterPanel: () => {}, _buildAvatarImageMarkup: () => '', _userTag: () => '',
      _calcLevelFromExp: () => ({ level: 1 }), _formatLastLoginMeta: () => '', _bindAvatarFallbacks: () => {},
      _canOpenUserEditor: () => true, _canToggleUserRestrictionFor: () => true });
    mount('<div id="admin-user-list"></div>'); app.renderAdminUsers([{ name: value, uid: value, role: 'user' }]);
    activate(app, '[onclick*="showUserProfile"]', [['showUserProfile', [value, { uid: value }]]]);
    activate(app, '[onclick*="showUserEditModal"]', [['showUserEditModal', [value]]]);
    activate(app, '[onclick*="toggleUserRestriction"]', [['toggleUserRestriction', [value]]]);
  });
  test('角色管理列', () => {
    const { app } = load('user-admin/user-admin-roles.js', { getRolePermissions: () => [] });
    Object.assign(app, { _getAllRoleKeys: () => [value], _getRoleInfo: () => ({ color: 'gray', label: value }), _isCustomRole: () => true });
    mount('<div id="role-hierarchy-list"></div>'); app.renderRoleHierarchy();
    activate(app, '.role-level-row', [['selectRoleForPerms', [value]]]);
    activate(app, '.role-delete-btn', [['confirmDeleteCustomRole', [value]]]);
  });
  test('個別授權：用戶與權限列', () => {
    const { app } = load('user-admin/user-admin-user-grants.js');
    app._filterUserPermissionGrantUsers = () => [{ uid: value, name: value }];
    mount('<div id="user-permission-grant-results"></div>'); app.renderUserPermissionGrantSearchResults();
    activate(app, '.permission-audit-issue', [['selectUserPermissionGrantUser', [value]]]);
    mount(app._renderUserPermissionGrantToggle({ code: value }, new Set(), ''));
    activate(app, 'input', [['toggleUserPermissionGrantCode', [value]]], 'change');
  });
});
test('事件繫結強化：Banner 保留合法連結原文與既有篩選', () => {
  const url = 'https://example.test/?a=&amp;&b=2';
  const { app } = load('ad-manage/banner.js', { getBanners: () => [{ id: 'sample', status: 'active', linkUrl: url }] });
  for (const name of ['_ensureBannerFixedOverlay', '_ensureBannerSlideImages', '_bindBannerCarouselControls', 'stopBannerCarousel']) app[name] = () => {};
  mount('<div id="banner-track"></div>'); app.renderBannerCarousel({ autoplay: false });
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);
  activate(app, '.banner-slide', [['trackAdClick', ['banner', 'sample']]]);
  expect(open).toHaveBeenCalledTimes(2); expect(open).toHaveBeenLastCalledWith(url, 'sporthub_ad');
  expect(app._adUrl("https://example.test/O'Brien")).toBe('');
});
