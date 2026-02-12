/* ================================================
   SportHub — User Admin: List, Search, Edit
   ================================================ */

Object.assign(App, {

  // ─── 用戶列表: 當前篩選狀態 ───
  _userEditTarget: null,

  // ─── Step 1: 搜尋與篩選 ───
  filterAdminUsers() {
    const keyword = (document.getElementById('admin-user-search')?.value || '').trim().toLowerCase();
    const roleFilter = document.getElementById('admin-user-role-filter')?.value || '';

    let users = ApiService.getAdminUsers();

    if (keyword) {
      users = users.filter(u =>
        u.name.toLowerCase().includes(keyword) ||
        u.uid.toLowerCase().includes(keyword)
      );
    }
    if (roleFilter) {
      users = users.filter(u => u.role === roleFilter);
    }

    this.renderAdminUsers(users);
  },

  // ─── Step 2: 用戶列表渲染（可接收篩選後的 users） ───
  renderAdminUsers(users) {
    const container = document.getElementById('admin-user-list');
    if (!container) return;
    const myLevel = ROLE_LEVEL_MAP[this.currentRole];

    if (!users) users = ApiService.getAdminUsers();

    if (users.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">沒有符合條件的用戶</div>';
      return;
    }

    container.innerHTML = users.map(u => {
      const avatar = u.pictureUrl
        ? `<img src="${u.pictureUrl}" class="au-avatar" style="object-fit:cover">`
        : `<div class="au-avatar au-avatar-fallback">${(u.name || '?')[0]}</div>`;

      const teamInfo = u.teamName ? ` ・ ${escapeHTML(u.teamName)}` : '';
      const genderIcon = u.gender === '男' ? '♂' : u.gender === '女' ? '♀' : '';
      const safeName = escapeHTML(u.name || '').replace(/'/g, "\\'");

      return `
        <div class="admin-user-card">
          ${avatar}
          <div class="admin-user-body">
            <div class="admin-user-info">
              <div class="admin-user-name">${this._userTag(u.name, u.role)}</div>
              <div class="admin-user-meta">${escapeHTML(u.uid)} ・ ${ROLES[u.role]?.label || u.role} ・ Lv.${App._calcLevelFromExp(u.exp || 0).level} ・ ${escapeHTML(u.region || '—')}${genderIcon ? ' ' + genderIcon : ''}${teamInfo}</div>
              <div class="admin-user-meta">${escapeHTML(u.sports || '—')} ・ EXP ${(u.exp || 0).toLocaleString()}</div>
            </div>
            <div class="admin-user-actions">
              ${u.role !== 'super_admin' ? `<button class="au-btn au-btn-edit" onclick="App.showUserEditModal('${safeName}')">編輯</button>` : ''}
              <button class="au-btn au-btn-view" onclick="App.showUserProfile('${safeName}')">查看</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  handlePromote(select, name) {
    if (!select.value) return;
    const roleMap = { '管理員': 'admin', '教練': 'coach', '領隊': 'captain', '場主': 'venue_owner' };
    const roleKey = roleMap[select.value];
    if (!roleKey) return;
    const user = ApiService.getAdminUsers().find(u => u.name === name);
    ApiService.promoteUser(name, roleKey);
    // Trigger 5：身份變更通知
    if (user) {
      this._sendNotifFromTemplate('role_upgrade', {
        userName: name, roleName: select.value,
      }, user.uid, 'private', '私訊');
    }
    this.filterAdminUsers();
    this.showToast(`已將「${name}」晉升為「${select.value}」`);
    select.value = '';
  },

  // ─── Step 3: 用戶編輯 Modal ───
  showUserEditModal(name) {
    const users = ApiService.getAdminUsers();
    const user = users.find(u => u.name === name);
    if (!user) { this.showToast('找不到該用戶'); return; }

    this._userEditTarget = name;
    document.getElementById('user-edit-modal-title').textContent = `編輯用戶 — ${name}`;

    document.getElementById('ue-role').value = user.role || 'user';
    document.getElementById('ue-region').value = user.region || '台北';
    document.getElementById('ue-gender').value = user.gender || '男';
    document.getElementById('ue-sports').value = user.sports || '';
    document.getElementById('ue-phone').value = user.phone || '';

    const bdInput = document.getElementById('ue-birthday');
    if (user.birthday) {
      bdInput.value = user.birthday.replace(/\//g, '-');
    } else {
      bdInput.value = '';
    }

    this.showModal('user-edit-modal');
  },

  saveUserEdit() {
    const name = this._userEditTarget;
    if (!name) return;

    // 記錄舊角色以偵測變更
    const oldUser = ApiService.getAdminUsers().find(u => u.name === name);
    const oldRole = oldUser ? oldUser.role : null;

    const updates = {
      role: document.getElementById('ue-role').value,
      region: document.getElementById('ue-region').value,
      gender: document.getElementById('ue-gender').value,
      sports: document.getElementById('ue-sports').value.trim(),
      phone: document.getElementById('ue-phone').value.trim(),
    };

    const bdVal = document.getElementById('ue-birthday').value;
    if (bdVal) {
      updates.birthday = bdVal.replace(/-/g, '/');
    }

    const result = ApiService.updateAdminUser(name, updates);

    // Trigger 5：身份變更通知
    if (result && oldRole && oldRole !== updates.role) {
      const roleName = ROLES[updates.role]?.label || updates.role;
      this._sendNotifFromTemplate('role_upgrade', {
        userName: name, roleName,
      }, result.uid, 'private', '私訊');
    }
    if (result) {
      this.closeUserEditModal();
      this.filterAdminUsers();
      this.showToast(`已更新「${name}」的資料`);

      // 寫入操作紀錄
      const now = new Date();
      const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const opLog = {
        time: timeStr,
        operator: ROLES[this.currentRole]?.label || '管理員',
        type: 'role',
        typeName: '用戶編輯',
        content: `編輯「${name}」資料（角色：${ROLES[updates.role]?.label || updates.role}、地區：${updates.region}）`
      };
      const opSource = ApiService._demoMode ? DemoData.operationLogs : FirebaseService._cache.operationLogs;
      opSource.unshift(opLog);
    }
  },

  closeUserEditModal() {
    this._userEditTarget = null;
    this.closeModal();
  },

});
