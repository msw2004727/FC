/**
 * removeTeam（js/modules/team/team-list.js）— 俱樂部刪除流程統一後的前端行為
 *   - 刪除鈕兩處（管理頁、後台列表）都由 _canDeleteTeam 判斷包住，與 removeTeam 守衛同一判斷（R-IAM-011）
 *   - 操作紀錄、角色重算與通知改由 Callable deleteTeam 在伺服器做，前端不再重複
 *   - 伺服器錯誤碼對應提示；partial 提示再按一次
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function loadRemoveTeam(deleteTeamImpl) {
  const team = { id: 'tm_a', name: '甲隊', captainUid: 'me' };
  const app = {
    _canDeleteTeam: jest.fn(() => true),
    appConfirm: jest.fn(async () => true),
    _withButtonLoading: async (_btn, _label, run) => run(),
    showToast: jest.fn(),
    showPage: jest.fn(),
    renderTeamManage: jest.fn(),
    renderTeamList: jest.fn(),
    renderAdminTeams: jest.fn(),
    renderProfileData: jest.fn(),
    renderHotEvents: jest.fn(),
    renderActivityList: jest.fn(),
    _applyRoleChange: jest.fn(),
  };
  const ApiService = {
    getTeam: jest.fn(() => team),
    deleteTeam: jest.fn(deleteTeamImpl),
    _writeErrorLog: jest.fn(),
    _writeOpLog: jest.fn(),
    _recalcUserRole: jest.fn(),
  };
  const context = { App: app, ApiService, console: { ...console, error: () => {} }, Object, String };
  vm.runInNewContext(read('js/modules/team/team-list.js'), context);
  return { app, ApiService };
}

const callableError = message => Object.assign(new Error(message), { code: 'functions/x' });

describe('removeTeam 原始碼守衛', () => {
  test('render 的兩個刪除鈕都由 _canDeleteTeam 包住', () => {
    const render = read('js/modules/team/team-list-render.js');
    const buttons = render.match(/\$\{[^{}]*\?\s*`<button[^`]*App\.removeTeam\(/g) || [];
    expect((render.match(/App\.removeTeam\(/g) || []).length).toBe(2);
    expect(buttons).toHaveLength(2);
    buttons.forEach(snippet => expect(snippet).toContain('this._canDeleteTeam?.(t)'));
  });

  test('removeTeam 不再寫 team_delete 操作紀錄、不再前端重算角色', () => {
    const source = read('js/modules/team/team-list.js');
    const body = source.slice(source.indexOf('async removeTeam(btn, id)'));
    expect(body).not.toContain("_writeOpLog('team_delete'");
    expect(body).not.toContain('_applyRoleChange');
    expect(body).not.toContain('_recalcUserRole');
  });
});

describe('removeTeam 行為', () => {
  test.each([
    ['COACH_PLUS_REQUIRED', '權限不足'],
    ['TEAM_DELETE_DENIED', '權限不足'],
    ['TEAM_ID_MISMATCH', '此俱樂部資料格式較舊，請聯繫管理員處理'],
    ['internal', '刪除俱樂部失敗，請稍後再試'],
  ])('伺服器錯誤 %s → 提示「%s」，寫錯誤紀錄、不重繪成功狀態', async (code, toast) => {
    const { app, ApiService } = loadRemoveTeam(async () => { throw callableError(code); });
    await app.removeTeam(null, 'tm_a');
    expect(app.showToast).toHaveBeenCalledWith(toast);
    expect(ApiService._writeErrorLog).toHaveBeenCalledTimes(1);
    expect(app.showPage).not.toHaveBeenCalled();
    expect(ApiService._writeOpLog).not.toHaveBeenCalled();
  });

  test('partial → 提示再按一次，不跳頁', async () => {
    const { app, ApiService } = loadRemoveTeam(async () => ({ status: 'partial' }));
    await app.removeTeam(null, 'tm_a');
    expect(app.showToast).toHaveBeenCalledWith('部分成員資料尚未清除，請再按一次刪除');
    expect(app.showPage).not.toHaveBeenCalled();
    expect(ApiService._writeErrorLog).not.toHaveBeenCalled();
  });

  test('成功 → 提示已刪除並重繪；前端不寫操作紀錄、不重算角色', async () => {
    const { app, ApiService } = loadRemoveTeam(async () => ({ status: 'deleted' }));
    await app.removeTeam(null, 'tm_a');
    expect(app.showToast).toHaveBeenCalledWith('已刪除「甲隊」');
    expect(app.showPage).toHaveBeenCalledWith('page-teams');
    expect(ApiService._writeOpLog).not.toHaveBeenCalled();
    expect(ApiService._recalcUserRole).not.toHaveBeenCalled();
    expect(app._applyRoleChange).not.toHaveBeenCalled();
  });

  test('_canDeleteTeam 不通過 → 權限不足，不呼叫 deleteTeam', async () => {
    const { app, ApiService } = loadRemoveTeam(async () => ({ status: 'deleted' }));
    app._canDeleteTeam.mockReturnValue(false);
    await app.removeTeam(null, 'tm_a');
    expect(app.showToast).toHaveBeenCalledWith('權限不足');
    expect(ApiService.deleteTeam).not.toHaveBeenCalled();
  });
});
