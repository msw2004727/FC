const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

describe('permission audit page wiring', () => {
  test('permission audit is isolated under its own user-admin folder', () => {
    expect(fs.existsSync(path.join(root, 'js/modules/user-admin/permission-audit/permission-audit.js'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'js/modules/user-admin/permission-audit/permission-audit-render.js'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'js/modules/user-admin/user-admin-permission-audit.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'js/modules/user-admin/user-admin-permission-audit-render.js'))).toBe(false);
  });

  test('admin roles page exposes the audit tab and report host', () => {
    const html = read('pages/admin-system.html');
    expect(html).toContain('id="role-admin-tab-audit"');
    expect(html).toContain('id="role-admin-audit-pane"');
    expect(html).toContain('id="permission-audit-report"');
    expect(html).toContain('App.runPermissionAuditReport()');
  });

  test('script loader loads permission audit modules from the isolated folder', () => {
    const loader = read('js/core/script-loader.js');
    expect(loader).toContain('js/modules/user-admin/permission-audit/permission-audit.js');
    expect(loader).toContain('js/modules/user-admin/permission-audit/permission-audit-render.js');
    expect(loader).not.toContain('js/modules/user-admin/user-admin-permission-audit.js');
  });

  test('permission audit CSS is independent and pre-cached', () => {
    const index = read('index.html');
    const sw = read('sw.js');
    const adminCss = read('css/admin.css');
    expect(index).toContain('css/permission-audit.css');
    expect(sw).toContain('./css/permission-audit.css');
    expect(adminCss).not.toContain('.permission-audit-card');
  });

  test('report builder reads the same catalogs used by permission management', () => {
    const audit = read('js/modules/user-admin/permission-audit/permission-audit.js');
    expect(audit).toContain('ApiService.getPermissions()');
    expect(audit).toContain('getAdminDrawerPermissionDefinitions()');
    expect(audit).toContain('ROLE_ACTIVITY_CAPABILITY_ITEMS');
    expect(audit).toContain('ADMIN_PAGE_EXTRA_PERMISSION_ITEMS');
    expect(audit).toContain('DRAWER_MENUS');
  });

  test('project rules require future permission changes to keep audit coverage updated', () => {
    const claude = read('CLAUDE.md');
    expect(claude).toContain('permission-audit');
    expect(claude).toContain('權限測試');
  });
});
