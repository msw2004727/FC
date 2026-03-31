/* ================================================
   SportHub — Role System & Drawer Menu
   ================================================ */

Object.assign(App, {

  _getEffectiveRoleKey(role) {
    if (role) return role;
    if (this.currentRole) return this.currentRole;
    if (typeof ApiService !== 'undefined' && typeof ApiService.getCurrentUser === 'function') {
      return ApiService.getCurrentUser()?.role || 'user';
    }
    return 'user';
  },

  _getEffectiveRoleLevel(role) {
    return ROLE_LEVEL_MAP[this._getEffectiveRoleKey(role)] || 0;
  },

  _getEffectiveRoleInfo(role) {
    return ROLES[this._getEffectiveRoleKey(role)] || ROLES.user;
  },

  _getRolePermissionList(role) {
    const roleKey = this._getEffectiveRoleKey(role);
    if (typeof ApiService === 'undefined' || typeof ApiService.getRolePermissions !== 'function') {
      return [];
    }
    return ApiService.getRolePermissions(roleKey) || [];
  },

  hasPermission(code, role) {
    if (!code) return false;
    return this._getRolePermissionList(role).includes(code);
  },

  _usesAdminDrawerPermissionMode(role) {
    const knownCodes = getAdminDrawerPermissionCodes();
    if (!knownCodes.length) return false;
    return this._getRolePermissionList(role).some(code => knownCodes.includes(code));
  },

  _canAccessDrawerItem(item, role) {
    if (!item || item.divider || item.sectionLabel) return true;
    const roleKey = this._getEffectiveRoleKey(role);
    if (item.permissionCode) {
      return this.hasPermission(item.permissionCode, roleKey);
    }
    const roleLevel = this._getEffectiveRoleLevel(roleKey);
    const minLevel = ROLE_LEVEL_MAP[item.minRole || 'user'] || 0;
    return roleLevel >= minLevel;
  },

  _findDrawerMenuItem(pageId) {
    if (!pageId) return null;
    return DRAWER_MENUS.find(item => item && item.page === pageId) || null;
  },

  _canAccessPage(pageId, role) {
    // 1. 在 DRAWER_MENUS 中的頁面：由 permissionCode 控制
    const drawerItem = this._findDrawerMenuItem(pageId);
    if (drawerItem) return this._canAccessDrawerItem(drawerItem, role);

    // 2. 不在 DRAWER_MENUS 中的特殊頁面：硬編碼存取規則
    // page-admin-roles: admin.roles.entry 已停用，僅 super_admin 可進入
    if (pageId === 'page-admin-roles') return this._getEffectiveRoleKey(role) === 'super_admin';
    // page-scan: delegate 例外 + 教練以上
    if (pageId === 'page-scan') {
      if (this._getEffectiveRoleLevel(role) >= (ROLE_LEVEL_MAP.coach || 0)) return true;
      if (typeof this._isAnyActiveEventDelegate === 'function' && this._isAnyActiveEventDelegate()) return true;
      return false;
    }
    // page-team-manage: 領隊以上
    if (pageId === 'page-team-manage') return this._getEffectiveRoleLevel(role) >= (ROLE_LEVEL_MAP.captain || 0);
    // 日誌子頁面：由入口權限控制
    if (pageId === 'page-admin-audit-logs') return this.hasPermission('admin.logs.audit_read', role);
    if (pageId === 'page-admin-error-logs') return this.hasPermission('admin.logs.error_read', role);

    // 3. 保留 data-min-role 回退（供尚未遷移的元素使用）
    const pageEl = document.getElementById(pageId);
    if (pageEl?.dataset?.minRole) {
      return this._getEffectiveRoleLevel(role) >= (ROLE_LEVEL_MAP[pageEl.dataset.minRole] || 0);
    }
    return true;
  },

  /** 檢查當前用戶是否為任何可簽到活動的委託人 */
  _isAnyActiveEventDelegate() {
    if (typeof ApiService === 'undefined') return false;
    const isDelegateFn = typeof this._isEventDelegate === 'function';
    if (!isDelegateFn) return false;
    // goToScanForEvent 帶入的特定活動優先檢查（解決 events 列表尚未載入的時序問題）
    if (this._scanPresetEventId) {
      const presetEvent = ApiService.getEvent(this._scanPresetEventId);
      if (presetEvent && this._isEventDelegate(presetEvent)) return true;
    }
    const events = ApiService.getEvents();
    if (!events || !events.length) return false;
    return events.some(e =>
      (e.status === 'open' || e.status === 'full' || e.status === 'ended') &&
      this._isEventDelegate(e)
    );
  },

  _applyRoleBoundVisibility(role) {
    const level = this._getEffectiveRoleLevel(role);

    document.querySelectorAll('[data-min-role]').forEach(el => {
      if (el.classList.contains('page') && el.id) {
        el.style.display = this._canAccessPage(el.id, role) ? '' : 'none';
        return;
      }
      const minLevel = ROLE_LEVEL_MAP[el.dataset.minRole] || 0;
      el.style.display = level >= minLevel ? '' : 'none';
    });

    document.querySelectorAll('.contact-row').forEach(el => {
      el.style.display = level >= ROLE_LEVEL_MAP.coach ? 'flex' : 'none';
    });
  },

  bindRoleSwitcher() {
    const wrapper = document.getElementById('role-switcher-wrapper');
    if (!wrapper) return;
    const avatarBtn = wrapper.querySelector('.role-avatar-btn');
    const dropdown = wrapper.querySelector('.role-dropdown');
    const dropdownItems = wrapper.querySelectorAll('.role-dropdown-item');
    if (!avatarBtn || !dropdown) return;

    avatarBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('open');
      avatarBtn.classList.toggle('open', !isOpen);
      dropdown.classList.toggle('open', !isOpen);
    });

    dropdownItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const role = item.dataset.role;
        const roleLabel = item.querySelector('span:last-child')?.textContent || '';
        dropdownItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const labelEl = wrapper.querySelector('.role-current-label');
        if (labelEl) labelEl.textContent = roleLabel;
        this.applyRole(role);
        avatarBtn.classList.remove('open');
        dropdown.classList.remove('open');
      });
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        avatarBtn.classList.remove('open');
        dropdown.classList.remove('open');
      }
    });
  },

  applyRole(role, silent) {
    this.currentRole = role;
    // Firestore user doc 已載入 → 同步隱身狀態到 localStorage
    if (typeof this._syncStealthFromUser === 'function') this._syncStealthFromUser();
    const roleInfo = this._getEffectiveRoleInfo(role);

    const drawerRoleTag = document.getElementById('drawer-role-tag');
    if (drawerRoleTag) {
      drawerRoleTag.textContent = roleInfo.label;
      drawerRoleTag.style.background = roleInfo.color + '22';
      drawerRoleTag.style.color = roleInfo.color;
      // Admin stealth toggle（僅 admin / super_admin 可用）
      if (role === 'admin' || role === 'super_admin') {
        drawerRoleTag.style.cursor = 'pointer';
        drawerRoleTag.onclick = function() {
          const on = App._toggleAdminStealth();
          drawerRoleTag.style.opacity = on ? '.45' : '1';
          drawerRoleTag.title = on ? '隱身模式（點擊恢復）' : '';
          if (typeof App.showToast === 'function') {
            App.showToast(on ? '已開啟隱身模式' : '已關閉隱身模式');
          }
        };
        // 初始狀態同步
        if (App._isAdminStealth()) {
          drawerRoleTag.style.opacity = '.45';
          drawerRoleTag.title = '隱身模式（點擊恢復）';
        }
      }
    }

    // 更新個人資料頁角色膠囊（受隱身模式影響）
    const roleTagWrap = document.getElementById('profile-role-tag-wrap');
    if (roleTagWrap) {
      const cu = ApiService.getCurrentUser();
      const myName = (cu && (cu.displayName || cu.name)) || '';
      const visRole = this._stealthRole(myName, role);
      const visInfo = ROLES[visRole] || ROLES.user;
      roleTagWrap.innerHTML = `<span class="uc-role-tag" style="background:${visInfo.color}22;color:${visInfo.color}">${visInfo.label}</span>`;
    }

    this._applyRoleBoundVisibility(role);
    this.renderDrawerMenu();
    void this._flushPendingProtectedBootRoute?.({ skipEnsureCloudReady: true });
    if (typeof this.renderAdminUsers === 'function') {
      this.renderAdminUsers();
    }

    if (this.currentPage && !this._canAccessPage(this.currentPage, role)) {
      void this.showPage('page-home', { bypassRestrictionGuard: true, resetHistory: true });
    }

    if (!silent) this.showToast(`已切換為「${roleInfo.label}」身份`);
  },

  renderDrawerMenu() {
    const container = document.getElementById('drawer-menu');
    if (!container) return;
    let html = '';
    let lastMinRole = null;
    let lastBgClass = '';
    let hasRenderedActionItem = false;
    const visibleMenus = DRAWER_MENUS.filter(item =>
      item.divider || item.sectionLabel || this._canAccessDrawerItem(item)
    );

    visibleMenus.forEach((item, index) => {
      if (item.divider) {
        const hasNextActionItem = visibleMenus.slice(index + 1).some(entry => !entry.divider && !entry.sectionLabel);
        if (!hasRenderedActionItem || !hasNextActionItem) return;
        html += '<div class="drawer-divider"></div>';
      } else if (item.sectionLabel) {
        const hasNextActionItem = visibleMenus.slice(index + 1).some(entry => !entry.divider && !entry.sectionLabel);
        if (!hasNextActionItem) return;
        html += `<div class="drawer-section-label">${item.i18nKey ? t(item.i18nKey) : item.sectionLabel}</div>`;
      } else {
        const minLevel = ROLE_LEVEL_MAP[item.minRole] || 0;
        const isLocked = !!item.locked;
        const onClick = isLocked
          ? `App.showToast('功能尚未開放'); App.closeDrawer()`
          : item.action === 'share'
          ? `App._copyShareUrl()`
          : item.action === 'apply-role'
          ? `window.open('https://toosterx.com/roles/','_blank');App.closeDrawer()`
          : item.action === 'coming-soon'
          ? `App.showToast('功能尚未開放'); App.closeDrawer()`
          : `App.openDrawerPage('${item.page}')`;
        const role = item.minRole || 'user';
        const roleInfo = ROLES[role];
        const bgClass = item.highlight === 'yellow' ? 'drawer-role-yellow'
          : item.highlight === 'red' ? 'drawer-role-super'
          : minLevel >= 5 ? 'drawer-role-super' : minLevel >= 4 ? 'drawer-role-admin' : '';
        if (lastMinRole !== role && minLevel >= 4) {
          var bothRed = bgClass === 'drawer-role-super' && lastBgClass === 'drawer-role-super';
          if (lastMinRole && ROLE_LEVEL_MAP[lastMinRole] >= 4 && !bothRed) html += '<div class="drawer-divider"></div>';
          lastMinRole = role;
        }
        lastBgClass = bgClass;
        const displayLabel = item.i18nKey ? t(item.i18nKey) : item.label;
        const lockIcon = isLocked ? '<span style="margin-left:auto;font-size:.7rem;opacity:.5">🔒</span>' : '';
        const lockedStyle = isLocked ? ' style="opacity:.55;display:flex;align-items:center"' : '';
        html += `<div class="drawer-item ${bgClass}"${lockedStyle} onclick="${onClick}">
          ${displayLabel}${lockIcon}
        </div>`;
        hasRenderedActionItem = true;
      }
    });

    container.innerHTML = html;
  },

  openDrawerPage(pageId) {
    const safePageId = String(pageId || '').trim();
    if (!safePageId) return;
    const guardedPages = ['page-profile', 'page-teams', 'page-tournaments', 'page-messages', 'page-activities'];
    if (guardedPages.includes(safePageId) && this._requireProtectedActionLogin({ type: 'showPage', pageId: safePageId }, {
      suppressToast: true,
    })) {
      this.closeDrawer();
      return;
    }
    void this.showPage(safePageId);
    this.closeDrawer();
  },

  async _copyShareUrl() {
    var url = MINI_APP_BASE_URL;
    // [備用] 舊 LIFF URL：'https://liff.line.me/' + LINE_CONFIG.LIFF_ID
    var ok = typeof this._copyToClipboard === 'function'
      ? await this._copyToClipboard(url)
      : false;
    this.showToast(ok ? '已複製分享連結！' : '複製失敗，請手動複製');
    this.closeDrawer();
  },

  // ═══════════════════════════════
  //  申請角色彈窗
  // ═══════════════════════════════

  _showApplyRoleModal() {
    this.closeDrawer();
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog" style="max-width:280px;text-align:center">'
      + '<div class="edu-info-dialog-title">我要申請</div>'
      + '<div style="display:flex;flex-direction:column;gap:.6rem;margin-top:.8rem">'
      + '<button class="apply-role-btn" style="background:rgba(124,58,237,.1);border-color:rgba(124,58,237,.3);color:#7c3aed" onclick="App._handleApplyRole(\'captain\');this.closest(\'.edu-info-overlay\').remove()">'
      + '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>'
      + '<span>俱樂部</span></button>'
      + '<button class="apply-role-btn" style="background:rgba(217,119,6,.1);border-color:rgba(217,119,6,.3);color:#d97706" onclick="App._handleApplyRole(\'venue_owner\');this.closest(\'.edu-info-overlay\').remove()">'
      + '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
      + '<span>場主</span></button>'
      + '<button class="apply-role-btn" style="background:rgba(13,148,136,.1);border-color:rgba(13,148,136,.3);color:#0d9488" onclick="App._handleApplyRole(\'coach\');this.closest(\'.edu-info-overlay\').remove()">'
      + '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 00-16 0"/><path d="M12 3v2"/><path d="M12 13v2"/></svg>'
      + '<span>教練</span></button>'
      + '</div>'
      + '<button class="outline-btn" style="width:100%;margin-top:.8rem" onclick="this.closest(\'.edu-info-overlay\').remove()">取消</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

  _handleApplyRole(role) {
    // TODO: 接入實際申請流程（送出申請到管理員審核）
    const labels = { captain: '俱樂部', venue_owner: '場主', coach: '教練' };
    this.showToast('「' + (labels[role] || role) + '」申請功能即將開放');
  },

});
