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
    expect(activityHtml).toContain('id="ce-reg-open-summary"');
    expect(baseCss).toContain('.ce-time-summary');
    expect(createSource).toContain('_formatCreateTimeValue');
    expect(createSource).toContain('_bindCreateTimeSummary');
    expect(createSource).toContain('this._bindCreateTimeSummary();');
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

  test('activity edit save button enters busy state immediately and blocks double submit', () => {
    const createSource = readProjectFile('js/modules/event/event-create.js');

    expect(createSource).toContain('const isEditSubmit = !!this._editEventId;');
    expect(createSource).toContain('startEarlyEditSubmitBusy();');
    expect(createSource).toContain("submitBtn.textContent = this._editEventId ? '儲存中' : '建立中...';");
    expect(createSource).toContain("this.showToast('系統已在處理中');");
    expect(createSource).toContain('stopEarlyEditSubmitBusy();');
  });
});
