const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const readProjectFile = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

describe('club contact links and fallback cover', () => {
  test('loads contact link helpers before club detail render and form init', () => {
    const loader = readProjectFile('js/core/script-loader.js');
    const detailContactIndex = loader.indexOf("'js/modules/team/team-contact-links.js'");
    const detailRenderIndex = loader.indexOf("'js/modules/team/team-detail-render.js'");
    const formSearchIndex = loader.indexOf("'js/modules/team/team-form-search.js'");
    const formContactIndex = loader.indexOf("'js/modules/team/team-contact-links.js'", formSearchIndex);
    const formInitIndex = loader.indexOf("'js/modules/team/team-form-init.js'", formSearchIndex);

    expect(detailContactIndex).toBeGreaterThan(-1);
    expect(detailRenderIndex).toBeGreaterThan(detailContactIndex);
    expect(formContactIndex).toBeGreaterThan(formSearchIndex);
    expect(formInitIndex).toBeGreaterThan(formContactIndex);
  });

  test('club form exposes automatic social contact button controls', () => {
    const teamPage = readProjectFile('pages/team.html');

    expect(teamPage).toContain('id="ct-contact-links-enabled"');
    expect(teamPage).toContain('id="ct-contact-links-list"');
    expect(teamPage).toContain('id="ct-contact-links-add"');
    expect(teamPage).toContain('社群聯繫按鈕');
  });

  test('contact link helper detects common social platforms and renders buttons', () => {
    const helper = readProjectFile('js/modules/team/team-contact-links.js');

    expect(helper).toContain('_normalizeTeamContactUrl');
    expect(helper).toContain('_detectTeamContactPlatform');
    expect(helper).toContain('_getTeamContactLinksFormData');
    expect(helper).toContain('_renderTeamContactLinksHtml');
    expect(helper).toContain("matches('line.me', 'lin.ee')");
    expect(helper).toContain("matches('instagram.com')");
    expect(helper).toContain("matches('youtube.com', 'youtu.be')");
    expect(helper).toContain('Instagram-Logo--Streamline-Plump-Gradient.png');
    expect(helper).toContain('Thread-Block-Logo--Streamline-Ultimate.png');
  });

  test('club save flow persists manual contact and automatic contact links', () => {
    const initSource = readProjectFile('js/modules/team/team-form-init.js');
    const validateSource = readProjectFile('js/modules/team/team-form-validate.js');
    const formSource = readProjectFile('js/modules/team/team-form.js');
    const detailSource = readProjectFile('js/modules/team/team-detail-render.js');

    expect(initSource).toContain('_setTeamContactLinksFormData?.(!!t.contactLinksEnabled, t.contactLinks || [])');
    expect(initSource).toContain('bindTeamContactLinksToggle?.()');
    expect(validateSource).toContain('_getTeamContactLinksFormData?.({ validate: true })');
    expect(validateSource).toContain('contactLinksEnabled: !!contactLinksData.enabled');
    expect(formSource).toContain('contactLinksEnabled, contactLinks');
    expect(detailSource).toContain('_renderTeamContactLinksHtml?.(t.contactLinks)');
    expect(detailSource).toContain('td-contact-manual-text');
  });

  test('club detail edit save refreshes the current detail page after a successful write', () => {
    const formSource = readProjectFile('js/modules/team/team-form.js');

    expect(formSource).toContain('shouldRefreshCurrentDetail');
    expect(formSource).toContain("this.currentPage === 'page-team-detail'");
    expect(formSource).toContain('await this.showTeamDetail(savedTeamId, { skipPageHistory: true, bypassPageLock: true })');
  });

  test('club manager transfer is warned in the form and confirmed before saving', () => {
    const teamPage = readProjectFile('pages/team.html');
    const teamCss = readProjectFile('css/team.css');
    const formSource = readProjectFile('js/modules/team/team-form.js');
    const roleSource = readProjectFile('js/modules/team/team-form-roles.js');

    expect(teamPage).toContain('ct-captain-transfer-warning');
    expect(teamPage).toContain('俱樂部經理只能有一位');
    expect(teamPage).toContain('不是可複選的領隊欄位');
    expect(teamCss).toContain('.ct-captain-transfer-warning');
    expect(formSource).toContain('_confirmTeamManagerTransfer(vals)');
    expect(roleSource).toContain('_confirmTeamManagerTransfer');
    expect(roleSource).toContain('確定要轉移俱樂部經理嗎？');
    expect(roleSource).toContain('原經理可能失去此俱樂部管理權限');
  });

  test('clubs reuse the event no-cover asset when no cover is uploaded', () => {
    const helpers = readProjectFile('js/modules/team/team-list-helpers.js');
    const formSource = readProjectFile('js/modules/team/team-form.js');
    const listSource = readProjectFile('js/modules/team/team-list-render.js');
    const detailSource = readProjectFile('js/modules/team/team-detail.js');
    const shareSource = readProjectFile('js/modules/team/team-share-builders.js');

    expect(helpers).toContain("_defaultTeamCoverAssetPath: 'LOGO/Nocoverimage set.png'");
    expect(helpers).toContain('_getDefaultTeamCoverUrl');
    expect(helpers).toContain('_resolveTeamCoverImage');
    expect(helpers).toContain('_getTeamCoverImageUrl');
    expect(formSource).toContain('_resolveTeamCoverImage(image)');
    expect(listSource).toContain("_getTeamCoverImageUrl?.(t, 'card')");
    expect(detailSource).toContain("_getTeamCoverImageUrl?.(t, 'cover')");
    expect(shareSource).toContain("_getTeamCoverImageUrl?.(team, 'cover')");
  });
});
