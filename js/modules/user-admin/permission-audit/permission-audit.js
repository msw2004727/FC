/* ================================================
   ToosterX User Admin: Permission Audit Report
   ================================================ */

Object.assign(App, {
  _buildPermissionAuditReport() {
    const roles = this._getPermissionAuditRoles();
    const catalog = this._getPermissionAuditCatalog();
    const allCodes = new Set(catalog.flatMap(group => group.items.map(item => item.code)));
    const majorChecks = this._getPermissionAuditMajorChecks(catalog);
    const roleRows = roles.map(role => this._buildPermissionAuditRoleRow(role, majorChecks, allCodes));
    const issues = [
      ...this._auditPermissionCatalog(catalog, allCodes),
      ...this._auditRolePermissionSources(roles, allCodes),
      ...this._auditUserActivityCapabilities(),
      ...this._auditRiskyPermissionCombinations(roles),
    ];
    const summary = {
      roles: roles.length,
      permissions: allCodes.size,
      capabilities: (typeof ROLE_ACTIVITY_CAPABILITY_ITEMS !== 'undefined') ? ROLE_ACTIVITY_CAPABILITY_ITEMS.length : 0,
      warnings: issues.filter(item => item.level === 'warn').length,
      errors: issues.filter(item => item.level === 'error').length,
    };
    return {
      generatedAt: new Date(),
      version: typeof CACHE_VERSION !== 'undefined' ? CACHE_VERSION : '',
      roles,
      catalog,
      majorChecks,
      roleRows,
      issues,
      summary,
    };
  },
  _getPermissionAuditRoles() {
    const keys = typeof getRuntimeRoleSequence === 'function'
      ? getRuntimeRoleSequence()
      : (typeof BUILTIN_ROLE_KEYS !== 'undefined' ? [...BUILTIN_ROLE_KEYS] : ['user', 'admin', 'super_admin']);
    return keys.map((key, index) => {
      const info = typeof getRuntimeRoleInfo === 'function'
        ? getRuntimeRoleInfo(key)
        : ((typeof ROLES !== 'undefined' && ROLES?.[key]) || { label: key, color: '#64748b' });
      return {
        key,
        index,
        label: info?.label || key,
        color: info?.color || '#64748b',
        builtin: typeof BUILTIN_ROLE_KEYS !== 'undefined' ? BUILTIN_ROLE_KEYS.includes(key) : true,
      };
    });
  },

  _getPermissionAuditCatalog() {
    const groups = (typeof ApiService !== 'undefined' && ApiService?.getPermissions) ? ApiService.getPermissions() : [];
    return (groups || []).map(group => ({
      cat: group.cat || '未分類',
      items: (group.items || [])
        .filter(item => item && typeof item.code === 'string')
        .filter(item => typeof isPermissionCodeEnabled !== 'function' || isPermissionCodeEnabled(item.code))
        .map(item => ({ code: item.code, name: item.name || item.code })),
    })).filter(group => group.items.length);
  },

  _getPermissionAuditMajorChecks(catalog) {
    const preferred = [
      ['activity.manage.entry', '活動管理入口'],
      ['event.create', '新增活動'],
      ['event.edit_self', '編輯自己活動'],
      ['event.edit_all', '編輯所有活動'],
      ['event.delete', '刪除所有活動'],
      ['admin.tournaments.entry', '賽事管理入口'],
      ['team.manage.entry', '俱樂部管理入口'],
      ['team.manage_all', '管理所有俱樂部'],
      ['admin.users.entry', '用戶管理'],
      ['admin.banners.entry', '首頁管理'],
      ['admin.messages.entry', '訊息管理'],
      ['admin.repair.data_sync', '資料同步'],
      ['admin.logs.entry', '日誌中心'],
      ['admin.notif.entry', '通知設定'],
    ];
    const all = new Set(catalog.flatMap(group => group.items.map(item => item.code)));
    return preferred.filter(([code]) => all.has(code)).map(([code, label]) => ({ code, label }));
  },

  _buildPermissionAuditRoleRow(role, checks, allCodes) {
    const current = new Set((typeof ApiService !== 'undefined' && ApiService?.getRolePermissions) ? ApiService.getRolePermissions(role.key) : []);
    const stored = this._getRawStoredRolePermissions(role.key);
    const defaults = (typeof ApiService !== 'undefined' && ApiService?.getRolePermissionDefaults) ? ApiService.getRolePermissionDefaults(role.key) : null;
    const inherent = new Set(typeof getInherentRolePermissions === 'function' ? getInherentRolePermissions(role.key) : []);
    const cells = checks.map(check => ({
      label: check.label,
      code: check.code,
      state: current.has(check.code),
      source: this._getPermissionSourceLabel(role.key, check.code, stored, defaults, inherent),
    }));
    const unknown = (stored.permissions || []).filter(code => !allCodes.has(code));
    return {
      role,
      effectiveCount: current.size,
      storedCount: stored.exists ? stored.permissions.length : 0,
      defaultCount: Array.isArray(defaults) ? defaults.length : 0,
      storedExists: stored.exists,
      unknown,
      cells,
    };
  },

  _getPermissionSourceLabel(roleKey, code, stored, defaults, inherent) {
    if (roleKey === 'super_admin') return inherent.has(code) ? '內建' : '全權';
    if (inherent.has(code)) return '內建';
    if (stored.exists && stored.permissions.includes(code)) return '開關';
    if (!stored.exists && Array.isArray(defaults) && defaults.includes(code)) return '預設';
    return '無';
  },

  _getRawStoredRolePermissions(roleKey) {
    const source = (typeof FirebaseService !== 'undefined' && FirebaseService?._cache?.rolePermissions) || {};
    if (Array.isArray(source)) {
      const doc = source.find(item => String(item?._docId || item?.roleKey || item?.role || item?.id || '') === roleKey);
      return { exists: !!doc, permissions: Array.isArray(doc?.permissions) ? [...doc.permissions] : [] };
    }
    const exists = Object.prototype.hasOwnProperty.call(source, roleKey);
    const raw = exists ? source[roleKey] : null;
    const permissions = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.permissions) ? raw.permissions : []);
    return { exists, permissions: [...permissions] };
  },

  _auditPermissionCatalog(catalog, allCodes) {
    const issues = [];
    const seen = new Map();
    catalog.forEach(group => group.items.forEach(item => {
      if (!seen.has(item.code)) seen.set(item.code, []);
      seen.get(item.code).push(group.cat);
    }));
    seen.forEach((cats, code) => {
      if (cats.length > 1) issues.push({
        level: 'error',
        title: '權限碼重複',
        detail: `${code} 同時出現在 ${cats.join('、')}，未來可能造成開關判斷錯亂。`,
      });
    });
    const drawerMenus = (typeof DRAWER_MENUS !== 'undefined' && Array.isArray(DRAWER_MENUS)) ? DRAWER_MENUS : [];
    const adminPageExtraItems = (typeof ADMIN_PAGE_EXTRA_PERMISSION_ITEMS !== 'undefined') ? ADMIN_PAGE_EXTRA_PERMISSION_ITEMS : {};
    drawerMenus.filter(item => item?.permissionCode).forEach(item => {
      if (!allCodes.has(item.permissionCode)) issues.push({
        level: 'error',
        title: '入口權限沒有進入 catalog',
        detail: `${item.page} 使用 ${item.permissionCode}，但權限清單沒有收錄。`,
      });
    });
    Object.keys(adminPageExtraItems).forEach(pageId => {
      const hasParent = drawerMenus.some(item => item?.page === pageId);
      if (!hasParent) issues.push({
        level: 'warn',
        title: '子權限找不到對應入口',
        detail: `${pageId} 有子權限設定，但抽屜入口沒有對應頁面，請確認是否已棄用。`,
      });
    });
    if (typeof DISABLED_PERMISSION_CODES !== 'undefined') {
      DISABLED_PERMISSION_CODES.forEach(code => {
        if (allCodes.has(code)) issues.push({
          level: 'error',
          title: '停用權限仍出現在 catalog',
          detail: `${code} 已被標記停用，但仍被報表掃到。`,
        });
      });
    }
    return issues;
  },

  _auditRolePermissionSources(roles, allCodes) {
    const issues = [];
    const rawSource = (typeof FirebaseService !== 'undefined' && FirebaseService?._cache?.rolePermissions) || {};
    if (Array.isArray(rawSource)) issues.push({
      level: 'warn',
      title: 'rolePermissions 快取仍是舊陣列形狀',
      detail: '正式快取應為 { roleKey: permissions[] }，舊形狀可能讓刷新後權限判斷不穩。',
    });
    roles.forEach(role => {
      const stored = this._getRawStoredRolePermissions(role.key);
      const unknown = stored.permissions.filter(code => !allCodes.has(code));
      if (unknown.length) issues.push({
        level: 'warn',
        title: `${role.label} 含未知權限碼`,
        detail: `${role.key}: ${unknown.join('、')}`,
      });
      if (role.key === 'user' && stored.exists && stored.permissions.length) issues.push({
        level: 'warn',
        title: '一般 user 有傳統 rolePermissions 文件',
        detail: 'ApiService 會忽略 user 的傳統權限；一般 user 前台活動能力應改用 roleActivityCapabilities/user。',
      });
    });
    return issues;
  },

  _auditUserActivityCapabilities() {
    const issues = [];
    const allowed = new Set(typeof getRoleActivityCapabilityCodes === 'function' ? getRoleActivityCapabilityCodes() : []);
    const source = (typeof FirebaseService !== 'undefined' && FirebaseService?._cache?.roleActivityCapabilities) || {};
    const raw = Array.isArray(source)
      ? source.find(item => String(item?._docId || item?.roleKey || item?.role || item?.id || '') === 'user')
      : source.user;
    const caps = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.capabilities) ? raw.capabilities : null);
    if (!caps) issues.push({
      level: 'warn',
      title: '一般 user 前台活動能力目前使用預設值',
      detail: 'roleActivityCapabilities/user 尚未載入或不存在。若後台有手動開關，請確認即時同步是否正常。',
    });
    (caps || []).filter(code => !allowed.has(code)).forEach(code => issues.push({
      level: 'warn',
      title: '一般 user 前台活動能力含未知代碼',
      detail: code,
    }));
    return issues;
  },

  _auditRiskyPermissionCombinations(roles) {
    const issues = [];
    const adminLevel = (typeof ROLE_LEVEL_MAP !== 'undefined' && ROLE_LEVEL_MAP?.admin) || 4;
    const belowAdmin = roles.filter(role => (typeof getRuntimeRoleLevel === 'function' ? getRuntimeRoleLevel(role.key) : 0) < adminLevel);
    belowAdmin.forEach(role => {
      const perms = new Set((typeof ApiService !== 'undefined' && ApiService?.getRolePermissions) ? ApiService.getRolePermissions(role.key) : []);
      ['event.edit_all', 'event.delete', 'team.manage_all', 'admin.users.change_role'].forEach(code => {
        if (perms.has(code)) issues.push({
          level: 'warn',
          title: '低於 admin 的層級持有高風險權限',
          detail: `${role.label} (${role.key}) 目前持有 ${code}，請確認這是刻意開放。`,
        });
      });
      const subOnly = [...perms].filter(code => !code.endsWith('.entry'));
      subOnly.forEach(code => {
        const parent = this._guessPermissionEntryCode(code);
        if (this._isAllowedContextualPermissionWithoutEntry(role, code, parent)) return;
        if (parent && !perms.has(parent)) issues.push({
          level: 'warn',
          title: '有操作權限但沒有入口權限',
          detail: `${role.label} 有 ${code}，但沒有 ${parent}。可能看不到頁面但仍有部分操作能力。`,
        });
      });
    });
    return issues;
  },

  _guessPermissionEntryCode(code) {
    const defs = typeof getAdminDrawerPermissionDefinitions === 'function' ? getAdminDrawerPermissionDefinitions() : [];
    const def = defs.find(group => group.items.some(item => item.code === code));
    return def?.entryCode || '';
  },

  _isAllowedContextualPermissionWithoutEntry(role, code, parent) {
    if (parent !== 'team.manage.entry') return false;
    const roleKey = role?.key || '';
    const contextualTeamCodes = new Set([
      'team.manage_self',
      'team.review_join',
      'team.create_event',
      'team.toggle_event_visibility',
    ]);
    if (!contextualTeamCodes.has(code)) return false;
    return roleKey === 'coach';
  },
});
