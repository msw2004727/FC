const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('role application notice', () => {
  test('drawer role application opens a notice before continuing to roles page', () => {
    const roleSource = readProjectFile('js/modules/role.js');
    const layoutCss = readProjectFile('css/layout.css');

    expect(roleSource).toContain('_showRoleApplicationNotice');
    expect(roleSource).toContain('_continueApplyRoleRequest');
    expect(roleSource).toContain('目前網站已全面開放一般用戶自由開團');
    expect(roleSource).toContain('如果還需要創立賽事與俱樂部功能，請進一步聯繫我們。');
    expect(roleSource).toContain("window.open('https://toosterx.com/roles', '_blank')");
    expect(roleSource).toMatch(/_handleApplyRoleClick\(\)\s*{\s*this\._showRoleApplicationNotice\(\);/);

    expect(layoutCss).toContain('.role-application-notice-overlay');
    expect(layoutCss).toContain('backdrop-filter: blur(14px) saturate(145%)');
    expect(layoutCss).toContain('.role-application-notice-confirm');
  });
});
