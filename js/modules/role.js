/* ================================================
   SportHub — Role System & Drawer Menu
   ================================================ */

Object.assign(App, {

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
    const roleInfo = ROLES[role];
    const level = ROLE_LEVEL_MAP[role];

    // Demo 模式同步 currentUser.role，讓個人資料頁膠囊正確顯示
    if (ModeManager.isDemo() && typeof DemoData !== 'undefined' && DemoData.currentUser) {
      DemoData.currentUser.role = role;
    }

    document.getElementById('drawer-role-tag').textContent = roleInfo.label;
    document.getElementById('drawer-role-tag').style.background = roleInfo.color + '22';
    document.getElementById('drawer-role-tag').style.color = roleInfo.color;

    // 更新個人資料頁角色膠囊
    const roleTagWrap = document.getElementById('profile-role-tag-wrap');
    if (roleTagWrap) {
      roleTagWrap.innerHTML = `<span class="uc-role-tag" style="background:${roleInfo.color}22;color:${roleInfo.color}">${roleInfo.label}</span>`;
    }

    document.querySelectorAll('[data-min-role]').forEach(el => {
      const minLevel = ROLE_LEVEL_MAP[el.dataset.minRole] || 0;
      el.style.display = level >= minLevel ? '' : 'none';
    });

    document.querySelectorAll('.contact-row').forEach(el => {
      el.style.display = level >= 1 ? 'flex' : 'none';
    });

    this.renderDrawerMenu();
    this.renderAdminUsers();

    const currentPageEl = document.getElementById(this.currentPage);
    if (currentPageEl && currentPageEl.dataset.minRole) {
      const minLevel = ROLE_LEVEL_MAP[currentPageEl.dataset.minRole] || 0;
      if (level < minLevel) this.showPage('page-home');
    }

    if (!silent) this.showToast(`已切換為「${roleInfo.label}」身份`);
  },

  renderDrawerMenu() {
    const container = document.getElementById('drawer-menu');
    const level = ROLE_LEVEL_MAP[this.currentRole];
    let html = '';
    let lastMinRole = null;

    DRAWER_MENUS.forEach(item => {
      const minLevel = ROLE_LEVEL_MAP[item.minRole] || 0;
      if (level < minLevel) return;
      if (item.divider) {
        html += '<div class="drawer-divider"></div>';
      } else if (item.sectionLabel) {
        html += `<div class="drawer-section-label">${item.i18nKey ? t(item.i18nKey) : item.sectionLabel}</div>`;
      } else {
        const onClick = item.action === 'share'
          ? `App.showToast('已複製分享連結！')`
          : item.action === 'coming-soon'
          ? `App.showToast('功能尚未開放'); App.closeDrawer()`
          : `App.showPage('${item.page}'); App.closeDrawer()`;
        const role = item.minRole || 'user';
        const roleInfo = ROLES[role];
        const bgClass = item.highlight === 'yellow' ? 'drawer-role-yellow'
          : minLevel >= 5 ? 'drawer-role-super' : minLevel >= 4 ? 'drawer-role-admin' : '';
        if (lastMinRole !== role && minLevel >= 4) {
          if (lastMinRole && ROLE_LEVEL_MAP[lastMinRole] >= 4) html += '<div class="drawer-divider"></div>';
          lastMinRole = role;
        }
        const displayLabel = item.i18nKey ? t(item.i18nKey) : item.label;
        html += `<div class="drawer-item ${bgClass}" onclick="${onClick}">
          ${displayLabel}
        </div>`;
      }
    });

    container.innerHTML = html;
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

});
