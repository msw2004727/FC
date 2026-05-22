const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('activity create button', () => {
  test('activity page uses the same plus icon treatment as the home create button', () => {
    const activityHtml = readProjectFile('pages/activity.html');
    const homeHtml = readProjectFile('pages/home.html');
    const activityCss = readProjectFile('css/activity.css');

    expect(activityHtml).toContain('id="activity-create-btn"');
    expect(activityHtml).toContain('aria-label="＋我要開團"');
    expect(activityHtml).toContain('<path d="M12 5v14"></path>');
    expect(activityHtml).toContain('<path d="M5 12h14"></path>');
    expect(homeHtml).toContain('<path d="M12 5v14"></path>');
    expect(homeHtml).toContain('<path d="M5 12h14"></path>');
    expect(activityCss).toContain('#activity-create-btn svg');
    expect(activityCss).toContain('display: inline-flex');
    expect(activityCss).toContain('gap: .35rem');
  });

  test('dark mode lowers brightness for primary create buttons', () => {
    const baseCss = readProjectFile('css/base.css');
    const activityCss = readProjectFile('css/activity.css');

    expect(baseCss).toContain('--primary-btn-bg: #10b981;');
    expect(baseCss).toContain('--primary-btn-hover: #059669;');
    expect(baseCss).toContain('--primary-btn-active: #047857;');
    expect(baseCss).toContain('background: var(--primary-btn-bg, var(--accent))');
    expect(activityCss).toContain('[data-theme="dark"] #activity-create-btn::after');
    expect(activityCss).toContain('activity-create-glow-dark');
  });

  test('activity create form renders browser-independent 24-hour time summaries', () => {
    const activityHtml = readProjectFile('pages/activity.html');
    const baseCss = readProjectFile('css/base.css');
    const createSource = readProjectFile('js/modules/event/event-create.js');
    const optionsSource = readProjectFile('js/modules/event/event-create-options.js');
    const lifecycleSource = readProjectFile('js/modules/event/event-manage-lifecycle.js');

    expect(activityHtml).toContain('id="ce-time-summary"');
    expect(activityHtml).toContain('id="ce-reg-open-enabled"');
    expect(activityHtml).toContain('id="ce-reg-open-fields"');
    expect(activityHtml).toContain('id="ce-reg-open-early-bird-hint"');
    expect(activityHtml).toContain('id="ce-reg-open-summary"');
    expect(activityHtml).toContain('請到「進階功能」開啟早鳥報名');
    expect(baseCss).toContain('.ce-time-summary');
    expect(baseCss).toContain('.ce-reg-open-fields[hidden]');
    expect(createSource).toContain('_formatCreateTimeValue');
    expect(createSource).toContain('_bindCreateTimeSummary');
    expect(createSource).toContain('ce-reg-open-enabled');
    expect(createSource).toContain('this._bindCreateTimeSummary();');
    expect(optionsSource).toContain('_isEventRegOpenEnabled');
    expect(optionsSource).toContain('_syncEventRegOpenTimeUI');
    expect(optionsSource).toContain('this._updateCreateTimeSummary?.();');
    expect(lifecycleSource).toContain('this._bindCreateTimeSummary?.();');
  });

  test('activity create flow refreshes user activity capability settings before permission checks', () => {
    const createSource = readProjectFile('js/modules/event/event-create.js');
    const helpersSource = readProjectFile('js/modules/event/event-list-helpers.js');
    const configSource = readProjectFile('js/config.js');

    expect(createSource).toContain('async openCreateEventModal()');
    expect(createSource).toContain('await this._ensureActivityRoleCapabilitiesReady?.({ force: true });');
    expect(helpersSource).toContain('ensureRoleActivityCapabilitiesReady');
    expect(configSource).toMatch(/'page-activities':\s*\{[^}]*roleActivityCapabilities/);
  });

  test('home and activity create buttons require completed profile before opening create flow', () => {
    const listSource = readProjectFile('js/modules/event/event-list.js');
    const createSource = readProjectFile('js/modules/event/event-create.js');
    const homeSource = readProjectFile('js/modules/home-dashboard.js');
    const bannerSource = readProjectFile('js/modules/banner.js');
    const profileFormSource = readProjectFile('js/modules/profile/profile-form.js');
    const profileDataSource = readProjectFile('js/modules/profile/profile-data-render.js');
    const activityCss = readProjectFile('css/activity.css');

    expect(listSource).toContain('_isActivityCreateProfileComplete');
    expect(listSource).toContain('_requireActivityCreateProfileComplete');
    expect(listSource).toContain("this.showToast?.('請先完成個人資料，再建立活動。');");
    expect(listSource).toContain("...document.querySelectorAll('.home-create-event-btn')");
    expect(listSource).toContain("button.dataset.profileIncomplete = '1';");
    expect(listSource).toContain("button.setAttribute('aria-disabled', profileLocked ? 'true' : 'false');");
    expect(createSource).toContain('if (this._requireActivityCreateProfileComplete?.()) return;');
    expect(homeSource).toContain('if (this._requireActivityCreateProfileComplete?.()) return;');
    expect(homeSource).toContain("const showOptions = { disableShellFirst: true };");
    expect(bannerSource).toContain('this._refreshActivityCreateButton?.();');
    expect(profileFormSource).toContain('this._pendingFirstLogin = !user.gender || !user.birthday || !user.region;');
    expect(profileFormSource).toContain('this._refreshActivityCreateButton?.();');
    expect(profileDataSource).toContain("this._pendingFirstLogin = !['gender', 'birthday', 'region'].every");
    expect(activityCss).toContain('.activity-create-profile-locked');
    expect(activityCss).toContain('cursor: not-allowed');
  });

  test('activity edit save button enters busy state immediately and blocks double submit', () => {
    const createSource = readProjectFile('js/modules/event/event-create.js');

    expect(createSource).toContain('const isEditSubmit = !!this._editEventId;');
    expect(createSource).toContain('startEarlyEditSubmitBusy();');
    expect(createSource).toContain("submitBtn.textContent = this._editEventId ? '儲存中' : '建立中...';");
    expect(createSource).toContain("this.showToast('系統已在處理中');");
    expect(createSource).toContain('stopEarlyEditSubmitBusy();');
  });

  test('activity age limit is controlled by a toggle and submits zero when disabled', () => {
    const activityHtml = readProjectFile('pages/activity.html');
    const createSource = readProjectFile('js/modules/event/event-create.js');
    const optionsSource = readProjectFile('js/modules/event/event-create-options.js');
    const lifecycleSource = readProjectFile('js/modules/event/event-manage-lifecycle.js');
    const templateSource = readProjectFile('js/modules/event/event-create-template.js');

    expect(activityHtml).toContain('id="ce-age-limit-enabled"');
    expect(activityHtml).toContain('id="ce-age-limit-label"');
    expect(activityHtml).toContain('id="ce-min-age-wrap"');
    expect(optionsSource).toContain('_getEventAgeLimitFormNodes');
    expect(optionsSource).toContain('_getEventMinAgeFormValue');
    expect(optionsSource).toContain('if (toggle && !toggle.checked) return 0;');
    expect(createSource).toContain('this.bindEventAgeLimitToggle?.();');
    expect(createSource).toContain('this._getEventMinAgeFormValue()');
    expect(lifecycleSource).toContain('this._setEventAgeLimitState(minAge > 0, minAge);');
    expect(templateSource).toContain('this._getEventMinAgeFormValue()');
    expect(templateSource).toContain('this._setEventAgeLimitState(minAge > 0, minAge);');
  });
});
