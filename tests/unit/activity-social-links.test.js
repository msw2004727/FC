const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('activity social links add-on', () => {
  test('create activity places social links below team split and before reserved toggles', () => {
    const activityHtml = readProjectFile('pages/activity.html');
    const teamSplitIndex = activityHtml.indexOf('id="ce-team-split-enabled"');
    const socialIndex = activityHtml.indexOf('id="ce-social-links-enabled"');
    const reservedIndex = activityHtml.indexOf('id="ce-reserved-noshow-detection"');

    expect(teamSplitIndex).toBeGreaterThan(-1);
    expect(socialIndex).toBeGreaterThan(teamSplitIndex);
    expect(reservedIndex).toBeGreaterThan(socialIndex);
    expect(activityHtml).toContain('id="ce-social-links-list"');
    expect(activityHtml).toContain('id="ce-social-links-add"');
  });

  test('form code normalizes, limits, stores, and restores social links', () => {
    const optionsSource = readProjectFile('js/modules/event/event-create-options.js');
    const createSource = readProjectFile('js/modules/event/event-create.js');
    const lifecycleSource = readProjectFile('js/modules/event/event-manage-lifecycle.js');
    const templateSource = readProjectFile('js/modules/event/event-create-template.js');
    const swSource = readProjectFile('sw.js');

    expect(optionsSource).toContain('_eventSocialLinksMax: 5');
    expect(optionsSource).toContain('_normalizeEventSocialUrl');
    expect(optionsSource).toContain('_detectEventSocialPlatform');
    expect(optionsSource).toContain('_getEventSocialLinksFormData');
    expect(optionsSource).toContain("matches('line.me', 'lin.ee')");
    expect(optionsSource).toContain("matches('instagram.com')");
    expect(optionsSource).toContain("matches('threads.net')");
    expect(optionsSource).toContain("matches('youtube.com', 'youtu.be')");
    expect(optionsSource).toContain('Instagram-Logo--Streamline-Plump-Gradient.png');
    expect(optionsSource).toContain('Threads-Logo-Fill--Streamline-Phosphor-Fill.png');
    expect(swSource).toContain('./img/Instagram-Logo--Streamline-Plump-Gradient.png');
    expect(swSource).toContain('./img/Threads-Logo-Fill--Streamline-Phosphor-Fill.png');
    expect(fs.existsSync(path.join(ROOT, 'img/Instagram-Logo--Streamline-Plump-Gradient.png'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'img/Threads-Logo-Fill--Streamline-Phosphor-Fill.png'))).toBe(true);

    expect(createSource).toContain('this._getEventSocialLinksFormData?.({ validate: true })');
    expect(createSource).toContain('socialLinksEnabled');
    expect(createSource).toContain('socialLinks,');
    expect(createSource).toContain('this.bindEventSocialLinksToggle?.()');
    expect(lifecycleSource).toContain('this._setEventSocialLinksFormData?.(!!e.socialLinksEnabled, e.socialLinks || [])');
    expect(templateSource).toContain('socialLinksEnabled');
    expect(templateSource).toContain('socialLinks: Array.isArray(socialLinksData.links)');
  });

  test('detail page renders round social link buttons after delegates', () => {
    const detailSource = readProjectFile('js/modules/event/event-detail.js');
    const activityCss = readProjectFile('css/activity.css');
    const baseCss = readProjectFile('css/base.css');

    expect(detailSource).toContain('const socialLinksHtml = e.socialLinksEnabled');
    expect(detailSource).toContain('detail-social-links-row');
    expect(detailSource.indexOf('e.delegates && e.delegates.length')).toBeLessThan(detailSource.indexOf('${socialLinksRow}'));
    expect(detailSource.indexOf('${socialLinksRow}')).toBeLessThan(detailSource.indexOf('${e.contact ?'));

    expect(activityCss).toContain('.event-social-link-btn');
    expect(activityCss).toContain('width: 1.72rem');
    expect(activityCss).toContain('.event-social-link-icon-line');
    expect(activityCss).toContain('.event-social-link-icon-instagram img');
    expect(activityCss).toContain('.event-social-link-icon-threads img');
    expect(activityCss).toContain('[data-theme="dark"] .event-social-link-btn');
    expect(baseCss).toContain('.ce-social-link-row');
  });

  test('basic user rules treat social links as an add-on field', () => {
    const rulesSource = readProjectFile('firestore.rules');

    expect(rulesSource).toContain("['socialLinksEnabled']");
    expect(rulesSource).toContain("['socialLinks']");
    expect(rulesSource).toContain('request.resource.data.socialLinks.size() == 0');
  });
});
