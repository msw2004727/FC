/* ================================================
   SportHub — User Admin: Roles, Permissions, Inactive Data
   ================================================ */

Object.assign(App, {

  // ─── 權限系統（依角色對照表） ───
  _permSelectedRole: null,

  // ─── Role Hierarchy ───

  _getBuiltinRoles() {
    return ['user', 'coach', 'captain', 'venue_owner', 'admin', 'super_admin'];
  },

  _getCustomRoles() {
    if (ModeManager.isDemo()) return (typeof DemoData !== 'undefined' && DemoData.customRoles) ? DemoData.customRoles : [];
    return FirebaseService._cache.customRoles || [];
  },

  _getAllRoleKeys() {
    const builtins = this._getBuiltinRoles();
    const customs = this._getCustomRoles();
    // 自訂層級插在 builtins 之間（依 afterRole 排序）
    const result = [];
    for (const key of builtins) {
      result.push(key);
      customs.filter(c => c.afterRole === key).forEach(c => result.push(c.key));
    }
    return result;
  },

  _getRoleInfo(key) {
    if (ROLES[key]) return ROLES[key];
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
    container.innerHTML = allKeys.map((key, i) => {
      const r = this._getRoleInfo(key);
      const isCustom = this._isCustomRole(key);
      const isSelected = this._permSelectedRole === key;
      return `<div class="role-level-row ${isSelected ? 'role-level-selected' : ''}" onclick="App.selectRoleForPerms('${key}')" style="cursor:pointer">
        <span class="role-level-num">Lv.${i}</span>
        <span class="role-level-badge" style="background:${r.color}">${escapeHTML(r.label)}</span>
        <span class="role-level-key">${escapeHTML(key)}${isCustom ? ' <span style="font-size:.6rem;color:var(--accent)">(自訂)</span>' : ''}</span>
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

  resetRolePermissions() {
    if (!this._permSelectedRole) return;
    const role = this._permSelectedRole;
    const _rp = (typeof DemoData !== 'undefined' && DemoData.rolePermissions) ? DemoData.rolePermissions : {};
    const defaults = _rp[role];
    if (!defaults) {
      this.showToast('此層級無預設權限可復原');
      return;
    }
    const source = ModeManager.isDemo() ? _rp : (FirebaseService._cache.rolePermissions || {});
    source[role] = [...defaults];
    if (!ModeManager.isDemo()) {
      FirebaseService.saveRolePermissions(role, source[role]);
    }
    this.renderPermissions(role);
    const info = this._getRoleInfo(role);
    this.showToast(`「${info.label}」權限已復原為預設值`);
  },

  renderPermissions(role) {
    const container = document.getElementById('permissions-list');
    if (!container) return;

    if (role) this._permSelectedRole = role;
    if (!this._permSelectedRole) return;
    const currentPerms = ApiService.getRolePermissions(this._permSelectedRole);

    container.innerHTML = ApiService.getPermissions().map(cat => `
      <div class="perm-category">
        <div class="perm-category-title" onclick="this.parentElement.classList.toggle('collapsed')">
          ${cat.cat}
        </div>
        <div class="perm-items">
          ${cat.items.map(p => {
            const checked = currentPerms.includes(p.code);
            return `
            <div class="perm-item">
              <span>${p.name}</span>
              <label class="toggle-switch ${checked ? 'active' : ''}">
                <input type="checkbox" ${checked ? 'checked' : ''} onchange="App.togglePermission('${p.code}')">
                <span class="toggle-slider"></span>
              </label>
            </div>`;
          }).join('')}
        </div>
      </div>
    `).join('');
  },

  togglePermission(code) {
    const source = ModeManager.isDemo() ? ((typeof DemoData !== 'undefined' && DemoData.rolePermissions) || {}) : (FirebaseService._cache.rolePermissions || {});
    if (!source[this._permSelectedRole]) source[this._permSelectedRole] = [];
    const idx = source[this._permSelectedRole].indexOf(code);
    if (idx >= 0) {
      source[this._permSelectedRole] = source[this._permSelectedRole].filter(c => c !== code);
    } else {
      source[this._permSelectedRole].push(code);
    }
    // 正式版：寫入 Firestore
    if (!ModeManager.isDemo()) {
      FirebaseService.saveRolePermissions(this._permSelectedRole, source[this._permSelectedRole]);
    }
    this.renderPermissions(this._permSelectedRole);
  },

  // ─── Role Editor (新增自訂層級) ───

  openRoleEditor() {
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

  saveCustomRole() {
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
    const source = ModeManager.isDemo() ? ((typeof DemoData !== 'undefined' && DemoData.rolePermissions) || {}) : (FirebaseService._cache.rolePermissions || {});
    source[key] = [...(source[afterRole] || [])];

    // 正式版：寫入 Firestore
    if (!ModeManager.isDemo()) {
      FirebaseService.addCustomRole(newRole);
      FirebaseService.saveRolePermissions(key, source[key]);
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

  executeDeleteCustomRole() {
    const key = this._pendingDeleteRoleKey;
    if (!key) return;
    const customRoles = this._getCustomRoles();
    const idx = customRoles.findIndex(c => c.key === key);
    if (idx < 0) return;
    const info = this._getRoleInfo(key);

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
    const source = ModeManager.isDemo() ? ((typeof DemoData !== 'undefined' && DemoData.rolePermissions) || {}) : (FirebaseService._cache.rolePermissions || {});
    delete source[key];

    // 正式版：刪除 Firestore 資料
    if (!ModeManager.isDemo()) {
      FirebaseService.deleteCustomRole(key);
      FirebaseService.deleteRolePermissions(key);
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

  // ─── 不活躍用戶/球隊（從資料讀取） ───
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

    // 也找沒有球隊或長期未活動的用戶
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
      html += '<div style="font-weight:700;margin-bottom:.5rem;color:var(--text-secondary)">已解散球隊</div>';
      html += teams.map(t => `
        <div class="inactive-card">
          <div style="font-weight:700">${escapeHTML(t.name)}</div>
          <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">原領隊：${escapeHTML(t.captain || '—')} ・ 原成員：${t.members || 0} 人</div>
          <div style="font-size:.78rem;color:var(--text-muted)">${escapeHTML(t.region || '—')}</div>
        </div>
      `).join('');
    } else {
      html += '<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">目前沒有已解散球隊</div>';
    }

    if (inactiveUsers.length > 0) {
      html += '<div style="font-weight:700;margin:.8rem 0 .5rem;color:var(--text-secondary)">長期未活動用戶（60天以上）</div>';
      html += inactiveUsers.map(u => `
        <div class="inactive-card">
          <div style="font-weight:700">${escapeHTML(u.name)} <span style="font-weight:400;font-size:.78rem;color:var(--text-muted)">${ROLES[u.role]?.label || u.role}</span></div>
          <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">UID: ${escapeHTML(u.uid)} ・ Lv.${App._calcLevelFromExp(u.exp || 0).level} ・ ${escapeHTML(u.region)}</div>
          <div style="font-size:.78rem;color:var(--text-muted)">最後活動：${escapeHTML(u.lastActive || '未知')} ・ 球隊：${escapeHTML(u.teamName || '無')}</div>
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
