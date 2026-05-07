const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('activity advanced add-on wording', () => {
  test('create activity and permission management use the new label', () => {
    const activityHtml = readProjectFile('pages/activity.html');
    const configSource = readProjectFile('js/config.js');
    const rolesSource = readProjectFile('js/modules/user-admin/user-admin-roles.js');

    expect(activityHtml).toContain('進階功能（加值服務）');
    expect(activityHtml).not.toContain('>加值功能</summary>');
    expect(configSource).toContain('使用進階功能（加值服務）');
    expect(configSource).toContain('進階功能（加值服務）');
    expect(rolesSource).toContain('使用進階功能（加值服務）');
    expect(rolesSource).toContain('進階功能（加值服務）');
  });
});
