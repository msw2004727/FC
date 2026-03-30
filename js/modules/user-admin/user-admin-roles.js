/* ================================================
   SportHub — User Admin: Roles, Permissions, Inactive Data
   ================================================ */

Object.assign(App, {

  // ─── 權限系統（依角色對照表） ───
  _permSelectedRole: null,
  _permShowCheckedOnly: false,

  _getRolePermissionSource() {
    if (ModeManager.isDemo()) {
      if (typeof DemoData === 'undefined') return {};
      if (!DemoData.rolePermissions) DemoData.rolePermissions = {};
      return DemoData.rolePermissions;
    }
    return FirebaseService._cache.rolePermissions || {};
  },

  _getRolePermissionMetaSource() {
    if (ModeManager.isDemo()) {
      if (typeof DemoData === 'undefined') return {};
      if (!DemoData.rolePermissionMeta) DemoData.rolePermissionMeta = {};
      return DemoData.rolePermissionMeta;
    }
    return FirebaseService._cache.rolePermissionMeta || {};
  },

  _persistRolePermissionMetaCache() {
    if (ModeManager.isDemo()) return;
    FirebaseService._saveToLS('rolePermissionMeta', FirebaseService._cache.rolePermissionMeta || {});
  },

  _getSavedRoleDefaultPermissions(roleKey) {
    const meta = this._getRolePermissionMetaSource();
    const saved = meta?.[roleKey]?.defaultPermissions;
    return Array.isArray(saved) ? [...saved] : null;
  },

  _getRoleResetPermissions(roleKey) {
    if (this._isLockedPermissionRole(roleKey)) {
      return [...ApiService.getRolePermissions(roleKey)];
    }
    if (typeof ApiService.getRolePermissionDefaults === 'function') {
      const defaults = ApiService.getRolePermissionDefaults(roleKey);
      if (Array.isArray(defaults)) return [...defaults];
    }
    return null;
  },

  _getRoleBasePermissions(roleKey) {
    const defaults = this._getRoleResetPermissions(roleKey);
    if (Array.isArray(defaults)) return defaults;
    const currentPerms = ApiService.getRolePermissions(roleKey) || [];
    return [...currentPerms];
  },

  _isLockedPermissionRole(roleKey) {
    return roleKey === 'super_admin' || roleKey === 'user';
  },

  _getLockedPermissionRoleHint(roleKey) {
    if (roleKey === 'super_admin') {
      return '總管層級固定擁有全部權限，所有開關已鎖定，避免誤關閉。';
    }
    if (roleKey === 'user') {
      return '一般用戶固定沒有任何後台功能權限，所有開關已鎖定，避免誤開啟。';
    }
    return '';
  },

  _syncPermissionPanelControls(roleKey) {
    const filterBtn = document.getElementById('role-perm-filter-btn');
    if (filterBtn) {
      filterBtn.textContent = this._permShowCheckedOnly ? '顯示全部權限' : '只顯示已有權限';
      filterBtn.classList.toggle('active', this._permShowCheckedOnly);
    }

    const resetBtn = document.getElementById('role-perm-reset-btn');
    if (resetBtn) {
      const locked = this._isLockedPermissionRole(roleKey);
      const hasDefaults = Array.isArray(this._getRoleResetPermissions(roleKey));
      const enabled = hasDefaults && !locked;
      resetBtn.disabled = !enabled;
      resetBtn.style.opacity = enabled ? '' : '.45';
      resetBtn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    const saveDefaultBtn = document.getElementById('role-perm-save-default-btn');
    if (saveDefaultBtn) {
      const locked = this._isLockedPermissionRole(roleKey);
      saveDefaultBtn.disabled = locked;
      saveDefaultBtn.style.opacity = locked ? '.45' : '';
      saveDefaultBtn.style.cursor = locked ? 'not-allowed' : 'pointer';
    }

    const lockHint = document.getElementById('role-perm-lock-hint');
    if (lockHint) {
      const locked = this._isLockedPermissionRole(roleKey);
      lockHint.style.display = locked ? '' : 'none';
      lockHint.textContent = locked ? this._getLockedPermissionRoleHint(roleKey) : '';
    }
  },

  // ─── Role Hierarchy ───

  _getBuiltinRoles() {
    return [...BUILTIN_ROLE_KEYS];
  },

  _getCustomRoles() {
    if (ModeManager.isDemo()) return (typeof DemoData !== 'undefined' && DemoData.customRoles) ? DemoData.customRoles : [];
    return FirebaseService._cache.customRoles || [];
  },

  _getAllRoleKeys() {
    return getRuntimeRoleSequence();
  },

  _getRoleInfo(key) {
    if (ROLES[key]) {
      if (key === 'captain') {
        return { ...ROLES[key], label: '領隊 / 經理' };
      }
      return ROLES[key];
    }
    const custom = this._getCustomRoles().find(c => c.key === key);
    if (custom) return { level: -1, label: custom.label, color: custom.color, custom: true };
    return { level: -1, label: key, color: '#6b7280', custom: false };
  },

  _isCustomRole(key) {
    return !ROLES[key];
  },

  renderRoleHierarchy() {
    const container = document.getElementById('role-hierarchy-list');
    if (!container) return;
    const allKeys = this._getAllRoleKeys();
    // 統計各角色用戶數量
    const users = (ApiService.getAdminUsers ? ApiService.getAdminUsers() : []) || [];
    const roleUserCount = {};
    users.forEach(u => { const rk = u.role || 'user'; roleUserCount[rk] = (roleUserCount[rk] || 0) + 1; });
    container.innerHTML = allKeys.map((key, i) => {
      const r = this._getRoleInfo(key);
      const isCustom = this._isCustomRole(key);
      const isSelected = this._permSelectedRole === key;
      const permCount = (ApiService.getRolePermissions(key) || []).length;
      const userCount = roleUserCount[key] || 0;
      return `<div class="role-level-row ${isSelected ? 'role-level-selected' : ''}" onclick="App.selectRoleForPerms('${key}')" style="cursor:pointer">
        <span class="role-level-num">Lv.${i}</span>
        <span class="role-level-badge" style="background:${r.color}">${escapeHTML(r.label)}</span>
        <span class="role-perm-count">${permCount}</span>
        <span class="role-level-key">${escapeHTML(key)} <span class="role-user-count">${userCount}</span>${isCustom ? ' <span style="font-size:.6rem;color:var(--accent)">(自訂)</span>' : ''}</span>
        ${isCustom ? `<button class="role-delete-btn" onclick="event.stopPropagation();App.confirmDeleteCustomRole('${key}')" title="刪除此層級">✕</button>` : ''}
      </div>`;
    }).join('');
  },

  selectRoleForPerms(roleKey) {
    this._permSelectedRole = roleKey;
    this.renderRoleHierarchy();
    this.renderPermissions(roleKey);
    const panel = document.getElementById('role-perm-panel');
    if (panel) {
      panel.style.display = '';
      const info = this._getRoleInfo(roleKey);
      document.getElementById('role-perm-panel-title').innerHTML =
        `<span class="role-level-badge" style="background:${info.color};font-size:.7rem;padding:.1rem .4rem">${escapeHTML(info.label)}</span> 後台權限`;
      // 展開權限列表
      const list = document.getElementById('permissions-list');
      const arrow = document.getElementById('role-perm-arrow');
      if (list) list.style.display = '';
      if (arrow) arrow.textContent = '▲';
      panel.scrollIntoView({ behavior: 'smooth' });
    }
  },

  togglePermPanel() {
    const list = document.getElementById('permissions-list');
    const arrow = document.getElementById('role-perm-arrow');
    if (!list) return;
    const collapsed = list.style.display === 'none';
    list.style.display = collapsed ? '' : 'none';
    if (arrow) arrow.textContent = collapsed ? '▲' : '▼';
  },

  async resetRolePermissions() {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
    if (!this._permSelectedRole) return;
    const role = this._permSelectedRole;
    if (this._isLockedPermissionRole(role)) {
      this.showToast(this._getLockedPermissionRoleHint(role));
      return;
    }
    const defaults = this._getRoleResetPermissions(role);
    if (!defaults) {
      this.showToast('此層級無預設權限可復原');
      return;
    }
    const source = this._getRolePermissionSource();
    const prevPerms = Array.isArray(source[role]) ? [...source[role]] : null;
    source[role] = [...defaults];
    if (!ModeManager.isDemo()) {
      try {
        await FirebaseService.saveRolePermissions(role, source[role]);
      } catch (err) {
        if (prevPerms) source[role] = prevPerms;
        else delete source[role];
        console.error('[resetRolePermissions]', err);
        this.renderPermissions(role);
        this.showToast('權限更新失敗');
        return;
      }
    }
    this.renderPermissions(role);
    this.renderRoleHierarchy();
    const info = this._getRoleInfo(role);
    this.showToast(`「${info.label}」權限已復原為預設值`);
  },

  async saveRolePermissionDefaults() {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
    if (!this._permSelectedRole) return;

    const role = this._permSelectedRole;
    if (this._isLockedPermissionRole(role)) {
      this.showToast(this._getLockedPermissionRoleHint(role));
      return;
    }
    const currentPerms = [...ApiService.getRolePermissions(role)];
    const metaSource = this._getRolePermissionMetaSource();
    const prevMeta = metaSource[role]
      ? {
          ...metaSource[role],
          defaultPermissions: Array.isArray(metaSource[role].defaultPermissions)
            ? [...metaSource[role].defaultPermissions]
            : null,
        }
      : null;

    metaSource[role] = {
      ...(metaSource[role] || {}),
      defaultPermissions: currentPerms,
    };
    this._persistRolePermissionMetaCache();

    if (!ModeManager.isDemo()) {
      try {
        await FirebaseService.saveRolePermissionDefaults(role, currentPerms);
      } catch (err) {
        if (prevMeta) metaSource[role] = prevMeta;
        else delete metaSource[role];
        this._persistRolePermissionMetaCache();
        console.error('[saveRolePermissionDefaults]', err);
        this.showToast('預設權限儲存失敗');
        return;
      }
    }

    this.renderPermissions(role);
    const info = this._getRoleInfo(role);
    this.showToast(`「${info.label}」目前權限已儲存成預設值`);
  },

  togglePermShowCheckedOnly() {
    this._permShowCheckedOnly = !this._permShowCheckedOnly;
    this.renderPermissions(this._permSelectedRole);
  },

  renderPermissions(role) {
    const container = document.getElementById('permissions-list');
    if (!container) return;

    if (role) this._permSelectedRole = role;
    if (!this._permSelectedRole) return;
    const roleKey = this._permSelectedRole;
    const lockedRole = this._isLockedPermissionRole(roleKey);
    const currentPerms = Array.from(new Set(ApiService.getRolePermissions(roleKey)));
    // 區分固有權限（inherent）與儲存的權限（stored），固有權限不可關閉
    const inherentPerms = typeof getInherentRolePermissions === 'function'
      ? new Set(getInherentRolePermissions(roleKey)) : new Set();
    this._syncPermissionPanelControls(roleKey);

    var categories = ApiService.getPermissions()
      .map(function(category) {
        var items = (category.items || [])
          .filter(function(item) { return item && typeof item.code === 'string'; })
          .filter(function(item) {
            return typeof isPermissionCodeEnabled === 'function'
              ? isPermissionCodeEnabled(item.code)
              : item.code !== 'admin.roles.entry';
          });
        return { cat: category.cat, items: items };
      })
      .filter(function(category) { return category.items.length > 0; });

    // 分離入口權限（header toggle）與子權限
    var mapped = categories.map(function(cat) {
      var entryItem = null;
      var subItems = [];
      cat.items.forEach(function(item) {
        if (!entryItem && item.code.endsWith('.entry')) {
          entryItem = item;
        } else {
          subItems.push(item);
        }
      });
      return { cat: cat.cat, entryItem: entryItem, subItems: subItems };
    });

    // 篩選：只顯示已勾選
    if (this._permShowCheckedOnly) {
      mapped = mapped.filter(function(cat) {
        var entryChecked = cat.entryItem && currentPerms.indexOf(cat.entryItem.code) >= 0;
        var anySubChecked = cat.subItems.some(function(p) { return currentPerms.indexOf(p.code) >= 0; });
        return entryChecked || anySubChecked;
      });
      mapped = mapped.map(function(cat) {
        return {
          cat: cat.cat,
          entryItem: cat.entryItem,
          subItems: cat.subItems.filter(function(p) { return currentPerms.indexOf(p.code) >= 0; }),
        };
      });
    }

    if (!mapped.length) {
      container.innerHTML = '<div style="padding:.75rem .3rem;color:var(--text-muted);font-size:.78rem">目前沒有符合篩選條件的權限。</div>';
      return;
    }

    container.innerHTML = mapped.map(function(cat) {
      var hasSubItems = cat.subItems.length > 0;

      // 入口開關（放在 header 右側）
      var entryToggleHtml = '';
      if (cat.entryItem) {
        var entryChecked = currentPerms.indexOf(cat.entryItem.code) >= 0;
        var entryInherent = inherentPerms.has(cat.entryItem.code);
        var entryDisabled = lockedRole || entryInherent;
        entryToggleHtml = '<label class="toggle-switch ' + (entryChecked ? 'active' : '') + '" onclick="event.stopPropagation()"' + (entryInherent ? ' title="此角色固有權限，無法關閉"' : '') + '>'
          + '<input type="checkbox" ' + (entryChecked ? 'checked' : '') + ' ' + (entryDisabled ? 'disabled' : '') + ' onchange="App.togglePermission(\'' + cat.entryItem.code + '\')">'
          + '<span class="toggle-slider"></span>'
          + (entryInherent ? '<span style="font-size:.6rem;color:var(--text-muted);margin-left:.3rem">固有</span>' : '')
          + '</label>';
      }

      // 子權限列表
      var subHtml = cat.subItems.map(function(p) {
        var checked = currentPerms.indexOf(p.code) >= 0;
        var isInherent = inherentPerms.has(p.code);
        var isDisabled = lockedRole || isInherent;
        return '<div class="perm-item ' + (lockedRole ? 'perm-item-locked' : '') + '">'
          + '<span class="perm-item-label">' + escapeHTML(p.name) + (isInherent ? ' <span style="font-size:.6rem;color:var(--text-muted)">(固有)</span>' : '') + '</span>'
          + '<button class="perm-info-btn" onclick="event.stopPropagation();App._showPermInfoPopup(\'' + p.code + '\')" title="說明">?</button>'
          + '<label class="toggle-switch ' + (checked ? 'active' : '') + '"' + (isInherent ? ' title="此角色固有權限，無法關閉"' : '') + '>'
          + '<input type="checkbox" ' + (checked ? 'checked' : '') + ' ' + (isDisabled ? 'disabled' : '') + ' onchange="App.togglePermission(\'' + p.code + '\')">'
          + '<span class="toggle-slider"></span>'
          + '</label>'
          + '</div>';
      }).join('');

      // 入口權限說明按鈕
      var entryInfoHtml = cat.entryItem
        ? '<button class="perm-info-btn" onclick="event.stopPropagation();App._showPermInfoPopup(\'' + cat.entryItem.code + '\')" title="說明">?</button>'
        : '';

      return '<div class="perm-category ' + (hasSubItems ? '' : 'no-sub') + '">'
        + '<div class="perm-category-title" onclick="' + (hasSubItems ? "this.parentElement.classList.toggle(\'collapsed\')" : '') + '">'
        + '<span class="perm-cat-name">' + escapeHTML(cat.cat) + '</span>'
        + entryInfoHtml
        + entryToggleHtml
        + '</div>'
        + (hasSubItems ? '<div class="perm-items">' + subHtml + '</div>' : '')
        + '</div>';
    }).join('');
  },

  async togglePermission(code) {
    if (!this._permSelectedRole) return;
    if (typeof isPermissionCodeEnabled === 'function' && !isPermissionCodeEnabled(code)) {
      this.renderPermissions(this._permSelectedRole);
      return;
    }
    if (this._permSelectedRole === 'user') {
      this.showToast(this._getLockedPermissionRoleHint(this._permSelectedRole));
      return;
    }
    if (this._isLockedPermissionRole(this._permSelectedRole)) {
      this.showToast('總管權限固定開啟');
      return;
    }
    // 固有權限不可關閉
    const inherent = typeof getInherentRolePermissions === 'function'
      ? getInherentRolePermissions(this._permSelectedRole) : [];
    if (inherent.includes(code)) {
      this.showToast('此為該角色的固有權限，無法關閉');
      this.renderPermissions(this._permSelectedRole);
      return;
    }
    const source = this._getRolePermissionSource();
    const currentPerms = Array.from(new Set(ApiService.getRolePermissions(this._permSelectedRole) || []));
    if (!Object.prototype.hasOwnProperty.call(source, this._permSelectedRole)) {
      source[this._permSelectedRole] = [...currentPerms];
    }
    const prevPerms = [...source[this._permSelectedRole]];
    const idx = source[this._permSelectedRole].indexOf(code);
    if (idx >= 0) {
      source[this._permSelectedRole] = source[this._permSelectedRole].filter(c => c !== code);
    } else {
      source[this._permSelectedRole].push(code);
    }
    // 正式版：寫入 Firestore
    if (!ModeManager.isDemo()) {
      try {
        await FirebaseService.saveRolePermissions(this._permSelectedRole, source[this._permSelectedRole]);
      } catch (err) {
        source[this._permSelectedRole] = prevPerms;
        console.error('[togglePermission]', err);
        this.renderPermissions(this._permSelectedRole);
        this.showToast('權限更新失敗');
        return;
      }
    }
    this.renderPermissions(this._permSelectedRole);
    this.renderRoleHierarchy();
  },

  // ─── Role Editor (新增自訂層級) ───

  openRoleEditor() {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
    const editor = document.getElementById('role-editor-card');
    editor.style.display = '';
    document.getElementById('role-editor-title').textContent = '新增自訂層級';
    document.getElementById('role-name-input').value = '';
    document.getElementById('role-color-input').value = '#6366f1';

    // 填充插入位置下拉選單
    const allKeys = this._getAllRoleKeys();
    const posSelect = document.getElementById('role-position-select');
    if (posSelect) {
      posSelect.innerHTML = allKeys.slice(0, -1).map((key, i) => {
        const cur = this._getRoleInfo(key);
        const next = this._getRoleInfo(allKeys[i + 1]);
        return `<option value="${key}">${escapeHTML(cur.label)} 與 ${escapeHTML(next.label)} 之間</option>`;
      }).join('');
      // 預設選「領隊與場主之間」
      const captainIdx = allKeys.indexOf('captain');
      if (captainIdx >= 0) posSelect.value = allKeys[captainIdx];
    }

    editor.scrollIntoView({ behavior: 'smooth' });
  },

  hideRoleEditor() {
    const editor = document.getElementById('role-editor-card');
    if (editor) editor.style.display = 'none';
  },

  async saveCustomRole() {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
    const label = document.getElementById('role-name-input').value.trim();
    if (!label) { this.showToast('請輸入層級名稱'); return; }
    const color = document.getElementById('role-color-input').value || '#6366f1';
    const key = 'custom_' + Date.now();
    const posSelect = document.getElementById('role-position-select');
    const afterRole = posSelect ? posSelect.value : 'captain';
    const afterInfo = this._getRoleInfo(afterRole);
    const customRoles = this._getCustomRoles();
    const newRole = { key, label, color, afterRole };
    customRoles.push(newRole);

    // 初始化權限（複製 afterRole 的權限作為基底）
    const source = this._getRolePermissionSource();
    const metaSource = this._getRolePermissionMetaSource();
    const inheritedPerms = this._getRoleBasePermissions(afterRole);
    source[key] = [...inheritedPerms];
    metaSource[key] = {
      ...(metaSource[key] || {}),
      defaultPermissions: [...inheritedPerms],
    };
    this._persistRolePermissionMetaCache();

    // 正式版：寫入 Firestore
    if (!ModeManager.isDemo()) {
      try {
        await FirebaseService.addCustomRoleWithPermissions(newRole, source[key], inheritedPerms);
      } catch (err) {
        console.error('[saveCustomRole]', err);
        const rollbackIdx = customRoles.findIndex(c => c.key === key);
        if (rollbackIdx >= 0) customRoles.splice(rollbackIdx, 1);
        delete source[key];
        delete metaSource[key];
        this._persistRolePermissionMetaCache();
        this.renderRoleHierarchy();
        this.showToast('新增角色失敗');
        return;
      }
    }

    this.hideRoleEditor();
    this.renderRoleHierarchy();
    this.showToast(`自訂層級「${label}」已建立，插入於「${afterInfo.label}」之後`);
  },

  // ─── 刪除自訂層級 ───

  _pendingDeleteRoleKey: null,

  confirmDeleteCustomRole(key) {
    const info = this._getRoleInfo(key);
    const overlay = document.getElementById('role-delete-overlay');
    const msg = document.getElementById('role-delete-msg');
    if (!overlay || !msg) return;
    this._pendingDeleteRoleKey = key;
    msg.innerHTML = `確定要刪除自訂層級「<strong>${escapeHTML(info.label)}</strong>」嗎？<br><br><span style="color:var(--danger);font-size:.78rem">該層級所屬用戶皆會變成一般用戶。此操作無法復原。</span>`;
    const btn = document.getElementById('role-delete-confirm-btn');
    btn.onclick = () => App.executeDeleteCustomRole();
    overlay.style.display = 'flex';
    overlay.classList.add('open');
  },

  async executeDeleteCustomRole() {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
    const key = this._pendingDeleteRoleKey;
    if (!key) return;
    const customRoles = this._getCustomRoles();
    const idx = customRoles.findIndex(c => c.key === key);
    if (idx < 0) return;
    const info = this._getRoleInfo(key);
    const removedRole = customRoles[idx];

    // 降級該層級的用戶（一律降為一般用戶）
    const users = ApiService.getAdminUsers ? ApiService.getAdminUsers() : [];
    users.forEach(u => {
      if (u.role === key) {
        u.role = 'user';
        if (!ModeManager.isDemo() && u._docId) {
          FirebaseService.updateUserRole(u._docId, 'user').catch(err => console.error('[deleteCustomRole] demote user:', err));
        }
      }
    });

    // 移除自訂層級
    customRoles.splice(idx, 1);

    // 移除權限
    const source = this._getRolePermissionSource();
    const metaSource = this._getRolePermissionMetaSource();
    const prevPerms = Array.isArray(source[key]) ? [...source[key]] : null;
    const prevMeta = metaSource[key]
      ? {
          ...metaSource[key],
          defaultPermissions: Array.isArray(metaSource[key].defaultPermissions)
            ? [...metaSource[key].defaultPermissions]
            : null,
        }
      : null;
    delete source[key];
    delete metaSource[key];
    this._persistRolePermissionMetaCache();

    // 正式版：刪除 Firestore 資料
    if (!ModeManager.isDemo()) {
      try {
        await FirebaseService.deleteCustomRoleWithPermissions(key);
      } catch (err) {
        console.error('[executeDeleteCustomRole]', err);
        customRoles.splice(idx, 0, removedRole);
        if (prevPerms) source[key] = prevPerms;
        if (prevMeta) metaSource[key] = prevMeta;
        this._persistRolePermissionMetaCache();
        this.renderRoleHierarchy();
        this.showToast('刪除角色失敗');
        return;
      }
    }

    // 清除選中狀態
    if (this._permSelectedRole === key) {
      this._permSelectedRole = null;
      const panel = document.getElementById('role-perm-panel');
      if (panel) panel.style.display = 'none';
    }

    const delOverlay = document.getElementById('role-delete-overlay');
    delOverlay.style.display = 'none';
    delOverlay.classList.remove('open');
    this._pendingDeleteRoleKey = null;
    this.renderRoleHierarchy();
    this.showToast(`層級「${info.label}」已刪除，相關用戶已降為一般用戶`);
  },

  // ─── 不活躍用戶/俱樂部（從資料讀取） ───
  renderInactiveData() {
    const container = document.getElementById('inactive-list');
    if (!container) return;

    const section = document.getElementById('page-admin-inactive');
    const tabs = section?.querySelector('.tab-bar');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      const tabBtns = tabs.querySelectorAll('.tab');
      tabBtns.forEach((btn, i) => {
        btn.addEventListener('click', () => {
          tabBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (i === 0) this._renderInactiveTeams(container);
          else this._renderInactiveEvents(container);
        });
      });
    }

    this._renderInactiveTeams(container);
  },

  _renderInactiveTeams(container) {
    const teams = ApiService.getTeams().filter(t => t.active === false);

    // 也找沒有俱樂部或長期未活動的用戶
    const users = ApiService.getAdminUsers();
    const inactiveUsers = users.filter(u => {
      if (!u.lastActive) return true;
      // lastActive 可能是字串（"2026/02/10"）或 Firestore Timestamp 物件
      let last;
      if (typeof u.lastActive === 'string') {
        last = new Date(u.lastActive.replace(/\//g, '-'));
      } else if (u.lastActive?.toDate) {
        last = u.lastActive.toDate();
      } else if (u.lastActive?.seconds) {
        last = new Date(u.lastActive.seconds * 1000);
      } else {
        return true;
      }
      const daysSince = (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince > 60;
    });

    let html = '';

    if (teams.length > 0) {
      html += '<div style="font-weight:700;margin-bottom:.5rem;color:var(--text-secondary)">已解散俱樂部</div>';
      html += teams.map(t => `
        <div class="inactive-card">
          <div style="font-weight:700">${escapeHTML(t.name)}</div>
          <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">原領隊：${escapeHTML(t.captain || '—')} ・ 原成員：${t.members || 0} 人</div>
          <div style="font-size:.78rem;color:var(--text-muted)">${escapeHTML(t.region || '—')}</div>
        </div>
      `).join('');
    } else {
      html += '<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">目前沒有已解散俱樂部</div>';
    }

    if (inactiveUsers.length > 0) {
      html += '<div style="font-weight:700;margin:.8rem 0 .5rem;color:var(--text-secondary)">長期未活動用戶（60天以上）</div>';
      html += inactiveUsers.map(u => `
        <div class="inactive-card">
          <div style="font-weight:700">${escapeHTML(u.name)} <span style="font-weight:400;font-size:.78rem;color:var(--text-muted)">${ROLES[u.role]?.label || u.role}</span></div>
          <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">UID: ${escapeHTML(u.uid)} ・ Lv.${App._calcLevelFromExp(u.exp || 0).level} ・ ${escapeHTML(u.region)}</div>
          <div style="font-size:.78rem;color:var(--text-muted)">最後活動：${escapeHTML(u.lastActive || '未知')} ・ 俱樂部：${escapeHTML(u.teamName || '無')}</div>
        </div>
      `).join('');
    } else {
      html += '<div style="text-align:center;padding:1rem;color:var(--text-muted)">沒有長期未活動的用戶</div>';
    }

    container.innerHTML = html;
  },

  _renderInactiveEvents(container) {
    const events = ApiService.getEvents().filter(e => e.status === 'ended' || e.status === 'cancelled');

    if (events.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">沒有已結束/取消的賽事</div>';
      return;
    }

    container.innerHTML = events.map(e => {
      const statusLabel = e.status === 'ended' ? '已結束' : '已取消';
      return `
        <div class="inactive-card">
          <div style="font-weight:700">${escapeHTML(e.title)} <span style="font-weight:400;font-size:.78rem;color:var(--text-muted)">${statusLabel}</span></div>
          <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">${escapeHTML(e.date)} ・ ${escapeHTML(e.location)}</div>
          <div style="font-size:.78rem;color:var(--text-muted)">建立者：${escapeHTML(e.creator)} ・ 參加：${e.current}/${e.max}</div>
        </div>
      `;
    }).join('');
  },

});
