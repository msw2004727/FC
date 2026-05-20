const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('activity advanced add-on wording', () => {
  test('create activity uses the concise advanced feature label', () => {
    const activityHtml = readProjectFile('pages/activity.html');
    const configSource = readProjectFile('js/config.js');
    const rolesSource = readProjectFile('js/modules/user-admin/user-admin-roles.js');

    expect(activityHtml).toMatch(/<summary class="ce-value-section-title" id="ce-value-section-title"[^>]*>進階功能<\/summary>/);
    expect(activityHtml).not.toContain('進階功能（加值服務）</summary>');
    expect(activityHtml).not.toContain('>加值功能</summary>');
    expect(configSource).toContain('使用進階功能（加值服務）');
    expect(configSource).toContain('進階功能（加值服務）');
    expect(configSource).toContain('社群連結、早鳥報名與 GPS 地圖座標等進階功能（加值服務）');
    expect(rolesSource).toContain('使用進階功能（加值服務）');
    expect(rolesSource).toContain('進階功能（加值服務）');
    expect(rolesSource).toContain('社群連結、早鳥報名與 GPS 地圖座標功能');
  });

  test('places advanced features between registration opening and capacity', () => {
    const activityHtml = readProjectFile('pages/activity.html');

    const regOpenIndex = activityHtml.indexOf("App._showCeInfo('regOpen')");
    const advancedIndex = activityHtml.indexOf('id="ce-value-section"');
    const maxIndex = activityHtml.indexOf("App._showCeInfo('max')");

    expect(regOpenIndex).toBeGreaterThanOrEqual(0);
    expect(advancedIndex).toBeGreaterThan(regOpenIndex);
    expect(maxIndex).toBeGreaterThan(advancedIndex);
  });
});
