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
    expect(roleSource).toContain('一般用戶都可以自由開團');
    expect(roleSource).toContain('不用申請身分');
    expect(roleSource).toContain('現在就能建立活動、自由開團、自由使用。');
    expect(roleSource).toContain('直接使用即可，不需要先申請俱樂部、場主或教練身分。');
    expect(roleSource).toContain('了解，前往聯繫');
    expect(roleSource).toContain("overlay.addEventListener('touchmove'");
    expect(roleSource).toContain('passive: false');
    expect(roleSource).toContain("window.open('https://toosterx.com/roles', '_blank')");
    expect(roleSource).toMatch(/_handleApplyRoleClick\(\)\s*{\s*this\._showRoleApplicationNotice\(\);/);

    expect(layoutCss).toContain('.role-application-notice-overlay');
    expect(layoutCss).toContain('background: rgba(0, 0, 0, .35)');
    expect(layoutCss).toContain('backdrop-filter: blur(10px) saturate(145%)');
    expect(layoutCss).toContain('box-shadow: 0 8px 32px rgba(0, 0, 0, .15)');
    expect(layoutCss).toContain('.role-application-notice-kicker');
    expect(layoutCss).toContain('.role-application-notice-hero');
    expect(layoutCss).toContain('[data-theme="dark"] .role-application-notice-hero');
    expect(layoutCss).toContain('.role-application-notice-confirm');
  });
});
