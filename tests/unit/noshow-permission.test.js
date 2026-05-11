/**
 * 放鴿子權限（activity.view_noshow）— unit tests
 *
 * Extracted from: js/modules/event/event-manage-attendance.js L321-331
 *
 * 重點驗證：
 *   - canManage（主辦人 / admin）可見
 *   - activity.view_noshow 權限持有者可見
 *   - admin.repair.no_show_adjust（後台放鴿子修改員）可見
 *   - 一般 user + 非主辦人 + 無權限 → 不可見
 *   - 容器 ID 必須是 'detail-attendance-table' 才啟用（其他容器不顯示）
 *   - tableEditing 必須為 true（即「管理名單」模式）才顯示，平時瀏覽名單不顯示
 */

// ─── 從 event-manage-attendance.js 抽取 ───
function shouldShowNoShowColumn({ containerId, canManage, hasPermission, featureEnabled = true, tableEditing = true }) {
  const canViewNoShow = canManage
    || (typeof hasPermission === 'function' && hasPermission('activity.view_noshow'))
    || (typeof hasPermission === 'function' && hasPermission('admin.repair.no_show_adjust'));
  return featureEnabled && containerId === 'detail-attendance-table' && canViewNoShow && tableEditing;
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe('放鴿子欄位 — 可見性規則', () => {
  describe('容器 ID 守衛', () => {
    test('容器是 detail-attendance-table → 符合', () => {
      expect(shouldShowNoShowColumn({
        containerId: 'detail-attendance-table',
        canManage: true,
        hasPermission: () => false,
      })).toBe(true);
    });

    test('容器是其他（例如「我的活動管理」的 attendance-table-container）→ 不顯示', () => {
      expect(shouldShowNoShowColumn({
        containerId: 'attendance-table-container',
        canManage: true,
        hasPermission: () => true,
      })).toBe(false);
    });

    test('容器是空字串 → 不顯示', () => {
      expect(shouldShowNoShowColumn({
        containerId: '',
        canManage: true,
        hasPermission: () => true,
      })).toBe(false);
    });
  });

  describe('canManage 路徑（admin / 主辦人 / 委託人）', () => {
    test('canManage=true → 可見（不需其他權限）', () => {
      expect(shouldShowNoShowColumn({
        containerId: 'detail-attendance-table',
        canManage: true,
        hasPermission: () => false,
      })).toBe(true);
    });
  });

  describe('activity.view_noshow 權限路徑', () => {
    test('有 view_noshow 但無 canManage → 可見（coach / captain 情境）', () => {
      expect(shouldShowNoShowColumn({
        containerId: 'detail-attendance-table',
        canManage: false,
        hasPermission: (code) => code === 'activity.view_noshow',
      })).toBe(true);
    });
  });

  describe('admin.repair.no_show_adjust 權限路徑', () => {
    test('有放鴿子修改權但無其他 → 可見（後台員工情境）', () => {
      expect(shouldShowNoShowColumn({
        containerId: 'detail-attendance-table',
        canManage: false,
        hasPermission: (code) => code === 'admin.repair.no_show_adjust',
      })).toBe(true);
    });
  });

  describe('不可見的情境', () => {
    test('一般 user：無 canManage + 無 view_noshow + 無 adjust → 不可見', () => {
      expect(shouldShowNoShowColumn({
        containerId: 'detail-attendance-table',
        canManage: false,
        hasPermission: () => false,
      })).toBe(false);
    });

    test('hasPermission 不是函式 → 不可見', () => {
      expect(shouldShowNoShowColumn({
        containerId: 'detail-attendance-table',
        canManage: false,
        hasPermission: null,
      })).toBe(false);
    });
  });

  describe('場景對照（用戶角色 → 是否可見 🕊 欄位）', () => {
    // 模擬各種用戶情境
    const scenarios = [
      {
        name: '一般 user 看他人辦的活動',
        canManage: false,
        perms: [],
        expected: false,
      },
      {
        name: '一般 user 看自己辦的活動',
        canManage: true,
        perms: [],
        expected: true,
      },
      {
        name: 'coach 看他人辦的活動（有 view_noshow 預設權限）',
        canManage: false,
        perms: ['activity.view_noshow'],
        expected: true,
      },
      {
        name: 'captain 看他人辦的活動',
        canManage: false,
        perms: ['activity.view_noshow'],
        expected: true,
      },
      {
        name: 'admin 看任何活動（event.edit_all → canManage=true）',
        canManage: true,
        perms: [],
        expected: true,
      },
      {
        name: '一般 user + 被授權放鴿子修改權',
        canManage: false,
        perms: ['admin.repair.no_show_adjust'],
        expected: true,
      },
      {
        name: '委託人（canManage=true）',
        canManage: true,
        perms: [],
        expected: true,
      },
    ];

    scenarios.forEach(sc => {
      test(sc.name, () => {
        const hasPermission = (code) => sc.perms.includes(code);
        expect(shouldShowNoShowColumn({
          containerId: 'detail-attendance-table',
          canManage: sc.canManage,
          hasPermission,
        })).toBe(sc.expected);
      });
    });
  });
});

describe('no-show feature flag', () => {
  test('disabled flag hides the no-show column for every role', () => {
    expect(shouldShowNoShowColumn({
      containerId: 'detail-attendance-table',
      canManage: true,
      hasPermission: () => true,
      featureEnabled: false,
    })).toBe(false);
  });
});

describe('🕊 次數欄位的管理名單模式守衛（tableEditing）', () => {
  test('tableEditing=false（平時瀏覽名單）→ 不顯示欄位，即使有所有權限', () => {
    expect(shouldShowNoShowColumn({
      containerId: 'detail-attendance-table',
      canManage: true,
      hasPermission: () => true,
      tableEditing: false,
    })).toBe(false);
  });

  test('tableEditing=true（管理名單模式）+ canManage → 顯示欄位', () => {
    expect(shouldShowNoShowColumn({
      containerId: 'detail-attendance-table',
      canManage: true,
      hasPermission: () => false,
      tableEditing: true,
    })).toBe(true);
  });

  test('tableEditing=true 但無權限 → 仍不顯示', () => {
    expect(shouldShowNoShowColumn({
      containerId: 'detail-attendance-table',
      canManage: false,
      hasPermission: () => false,
      tableEditing: true,
    })).toBe(false);
  });

  test('tableEditing=false + 有 view_noshow 權限 → 不顯示欄位（平時模式優先）', () => {
    expect(shouldShowNoShowColumn({
      containerId: 'detail-attendance-table',
      canManage: false,
      hasPermission: (code) => code === 'activity.view_noshow',
      tableEditing: false,
    })).toBe(false);
  });
});

// ─── 膠囊染色（showAttendanceFill）— 不受 tableEditing 限制，但需 canViewNoShow ───
// Extracted from: js/modules/event/event-manage-attendance.js (showAttendanceFill)
function shouldShowAttendanceFill({ canManage, hasPermission, featureEnabled = true }) {
  const canViewNoShow = canManage
    || (typeof hasPermission === 'function' && hasPermission('activity.view_noshow'))
    || (typeof hasPermission === 'function' && hasPermission('admin.repair.no_show_adjust'));
  return featureEnabled && canViewNoShow;
}

describe('膠囊染色（showAttendanceFill）— 平時即顯示，獨立於 tableEditing', () => {
  test('canManage + 平時模式 → 仍染色', () => {
    expect(shouldShowAttendanceFill({
      canManage: true,
      hasPermission: () => false,
    })).toBe(true);
  });

  test('view_noshow 權限 + 平時模式 → 仍染色', () => {
    expect(shouldShowAttendanceFill({
      canManage: false,
      hasPermission: (code) => code === 'activity.view_noshow',
    })).toBe(true);
  });

  test('admin.repair.no_show_adjust 權限 + 平時模式 → 仍染色', () => {
    expect(shouldShowAttendanceFill({
      canManage: false,
      hasPermission: (code) => code === 'admin.repair.no_show_adjust',
    })).toBe(true);
  });

  test('一般 user（無權限）→ 不染色', () => {
    expect(shouldShowAttendanceFill({
      canManage: false,
      hasPermission: () => false,
    })).toBe(false);
  });

  test('flag 關閉 → 即使有權限也不染色', () => {
    expect(shouldShowAttendanceFill({
      canManage: true,
      hasPermission: () => true,
      featureEnabled: false,
    })).toBe(false);
  });

  test('🕊 欄位與膠囊染色解耦：平時模式下染色顯示、欄位隱藏', () => {
    const ctx = { containerId: 'detail-attendance-table', canManage: true, hasPermission: () => false };
    expect(shouldShowNoShowColumn({ ...ctx, tableEditing: false })).toBe(false);
    expect(shouldShowAttendanceFill(ctx)).toBe(true);
  });
});
