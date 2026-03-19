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
    const drawerItem = this._findDrawerMenuItem(pageId);
    if (drawerItem) return this._canAccessDrawerItem(drawerItem, role);
    const pageEl = document.getElementById(pageId);
    if (!pageEl?.dataset?.minRole) return true;
    if (this._getEffectiveRoleLevel(role) >= (ROLE_LEVEL_MAP[pageEl.dataset.minRole] || 0)) return true;
    // delegate 例外：被委託管理活動的 user 可存取掃碼頁
    if (pageId === 'page-scan' && typeof this._isAnyActiveEventDelegate === 'function' && this._isAnyActiveEventDelegate()) return true;
    return false;
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
    const roleInfo = this._getEffectiveRoleInfo(role);

    // Demo 模式同步 currentUser.role，讓個人資料頁膠囊正確顯示
    if (ModeManager.isDemo() && typeof DemoData !== 'undefined' && DemoData.currentUser) {
      DemoData.currentUser.role = role;
    }

    const drawerRoleTag = document.getElementById('drawer-role-tag');
    if (drawerRoleTag) {
      drawerRoleTag.textContent = roleInfo.label;
      drawerRoleTag.style.background = roleInfo.color + '22';
      drawerRoleTag.style.color = roleInfo.color;
    }

    // 更新個人資料頁角色膠囊
    const roleTagWrap = document.getElementById('profile-role-tag-wrap');
    if (roleTagWrap) {
      roleTagWrap.innerHTML = `<span class="uc-role-tag" style="background:${roleInfo.color}22;color:${roleInfo.color}">${roleInfo.label}</span>`;
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

  toggleDemoRoleMenu() {
    const menu = document.getElementById('demo-role-dropdown');
    if (!menu) return;
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : '';
    if (!isOpen) {
      setTimeout(() => {
        const close = (e) => {
          if (!menu.contains(e.target) && e.target.id !== 'demo-avatar-btn') {
            menu.style.display = 'none';
            document.removeEventListener('click', close);
          }
        };
        document.addEventListener('click', close);
      }, 0);
    }
  },

  selectDemoRole(role) {
    const menu = document.getElementById('demo-role-dropdown');
    if (menu) {
      menu.querySelectorAll('.demo-role-item').forEach(i => i.classList.remove('active'));
      const selected = menu.querySelector(`[data-role="${role}"]`);
      if (selected) selected.classList.add('active');
      menu.style.display = 'none';
    }
    this.applyRole(role);
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

});
