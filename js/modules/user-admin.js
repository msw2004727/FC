/* ================================================
   SportHub — User Admin (Users, EXP, Permissions, Roles, Inactive)
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
              <div class="admin-user-meta">${escapeHTML(u.uid)} ・ ${ROLES[u.role]?.label || u.role} ・ Lv.${u.level} ・ ${escapeHTML(u.region || '—')}${genderIcon ? ' ' + genderIcon : ''}${teamInfo}</div>
              <div class="admin-user-meta">${escapeHTML(u.sports || '—')} ・ EXP ${u.exp}</div>
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

  // ─── EXP Management ───
  renderExpLogs() {
    const container = document.getElementById('exp-log-list');
    if (!container) return;
    container.innerHTML = ApiService.getExpLogs().map(l => `
      <div class="log-item">
        <span class="log-time">${escapeHTML(l.time)}</span>
        <span class="log-content">${this._userTag(l.target)} <strong>${escapeHTML(String(l.amount))}</strong>「${escapeHTML(l.reason)}」</span>
      </div>
    `).join('');
  },

  demoExpSearch() {
    const keyword = (document.getElementById('exp-search')?.value || '').trim();
    if (!keyword) { this.showToast('請輸入 UID 或暱稱'); return; }
    const users = ApiService.getAdminUsers();
    const found = users.find(u => u.name === keyword || u.uid === keyword);
    const card = document.getElementById('exp-target-card');
    if (!card) return;
    if (found) {
      card.style.display = '';
      const nameEl = card.querySelector('.exp-target-name');
      const detailEl = card.querySelector('.exp-target-detail');
      const avatarEl = card.querySelector('.profile-avatar');
      if (nameEl) nameEl.textContent = found.name;
      if (detailEl) detailEl.textContent = `UID: ${found.uid} ・ Lv.${found.level} ・ EXP: ${found.exp}`;
      if (avatarEl) avatarEl.textContent = found.name[0];
      card.dataset.targetName = found.name;
      this.showToast(`已搜尋到用戶「${found.name}」`);
    } else {
      card.style.display = 'none';
      this.showToast('找不到該用戶');
    }
  },

  handleExpSubmit() {
    const card = document.getElementById('exp-target-card');
    const targetName = card?.dataset.targetName;
    if (!targetName) { this.showToast('請先搜尋用戶'); return; }
    const amountInput = card.querySelector('input[type="number"]');
    const reasonInput = card.querySelectorAll('input[type="text"]')[0];
    const amount = parseInt(amountInput?.value) || 0;
    const reason = (reasonInput?.value || '').trim();
    if (amount === 0) { this.showToast('請輸入 EXP 調整值'); return; }
    if (!reason) { this.showToast('請輸入備註原因'); return; }
    const operatorLabel = ROLES[this.currentRole]?.label || '管理員';
    const user = ApiService.adjustUserExp(targetName, amount, reason, operatorLabel);
    if (user) {
      const updatedDetail = card.querySelector('.exp-target-detail');
      if (updatedDetail) updatedDetail.textContent = `UID: ${user.uid} ・ Lv.${user.level} ・ EXP: ${user.exp}`;
      this.renderExpLogs();
      this.renderOperationLogs();
      this.showToast(`已調整「${targetName}」EXP ${amount > 0 ? '+' : ''}${amount}`);
    }
  },

  // ─── Step 5: 操作紀錄渲染 + 篩選 ───
  filterOperationLogs() {
    const keyword = (document.getElementById('oplog-search')?.value || '').trim().toLowerCase();
    const typeFilter = document.getElementById('oplog-type-filter')?.value || '';

    let logs = ApiService.getOperationLogs();

    if (keyword) {
      logs = logs.filter(l =>
        l.operator.toLowerCase().includes(keyword) ||
        l.content.toLowerCase().includes(keyword)
      );
    }
    if (typeFilter) {
      logs = logs.filter(l => l.type === typeFilter);
    }

    this.renderOperationLogs(logs);
  },

  renderOperationLogs(logs) {
    const container = document.getElementById('operation-log-list');
    if (!container) return;

    if (!logs) logs = ApiService.getOperationLogs();

    if (logs.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">沒有符合條件的紀錄</div>';
      return;
    }

    container.innerHTML = logs.map(l => `
      <div class="log-item">
        <span class="log-time">${escapeHTML(l.time)}</span>
        <span class="log-content">
          <span class="log-type ${l.type}">${escapeHTML(l.typeName)}</span>
          ${escapeHTML(l.operator)}：${escapeHTML(l.content)}
        </span>
      </div>
    `).join('');
  },

  // ─── Step 4: 權限系統（依角色對照表） ───
  _permSelectedRole: 'user',

  renderPermissions(role) {
    const container = document.getElementById('permissions-list');
    if (!container) return;

    if (role) this._permSelectedRole = role;
    const currentPerms = ApiService.getRolePermissions(this._permSelectedRole);

    container.innerHTML = ApiService.getPermissions().map(cat => `
      <div class="perm-category">
        <div class="perm-category-title" onclick="this.parentElement.classList.toggle('collapsed')">
          ${cat.cat}
        </div>
        <div class="perm-items">
          ${cat.items.map(p => `
            <label class="perm-item">
              <input type="checkbox" data-code="${p.code}" ${currentPerms.includes(p.code) ? 'checked' : ''} onchange="App.togglePermission('${p.code}')">
              <span>${p.name}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');
  },

  togglePermission(code) {
    const perms = ApiService.getRolePermissions(this._permSelectedRole);
    const idx = perms.indexOf(code);
    const source = ApiService._demoMode ? DemoData.rolePermissions : (FirebaseService._cache.rolePermissions || DemoData.rolePermissions);
    if (!source[this._permSelectedRole]) source[this._permSelectedRole] = [];
    if (idx >= 0) {
      source[this._permSelectedRole] = source[this._permSelectedRole].filter(c => c !== code);
    } else {
      source[this._permSelectedRole].push(code);
    }
  },

  savePermissions() {
    this.showToast(`已儲存「${ROLES[this._permSelectedRole]?.label || this._permSelectedRole}」的權限設定`);
  },

  // ─── Role Hierarchy ───
  renderRoleHierarchy() {
    const container = document.getElementById('role-hierarchy-list');
    if (!container) return;
    const roles = ['user', 'coach', 'captain', 'venue_owner', 'admin', 'super_admin'];
    container.innerHTML = roles.map((key, i) => {
      const r = ROLES[key];
      return `<div class="role-level-row">
        <span class="role-level-num">Lv.${i}</span>
        <span class="role-level-badge" style="background:${r.color}">${r.label}</span>
        <span class="role-level-key">${key}</span>
        ${i >= 4 ? '' : '<button class="role-insert-btn" onclick="App.openRoleEditorAt(' + i + ')">＋ 插入</button>'}
      </div>`;
    }).join('');
  },

  openRoleEditor() {
    const editor = document.getElementById('role-editor-card');
    editor.style.display = '';
    document.getElementById('role-editor-title').textContent = '新增自訂層級';
    document.getElementById('role-name-input').value = '';
    const select = document.getElementById('role-position-select');
    const roles = ['user', 'coach', 'captain', 'venue_owner', 'admin'];
    select.innerHTML = roles.map((key, i) => {
      const next = ['coach', 'captain', 'venue_owner', 'admin', 'super_admin'][i];
      return `<option value="${i}">${ROLES[key].label} 與 ${ROLES[next].label} 之間</option>`;
    }).join('');
    this.renderPermissions();
    editor.scrollIntoView({ behavior: 'smooth' });
  },

  openRoleEditorAt(levelIndex) {
    this.openRoleEditor();
    document.getElementById('role-position-select').value = levelIndex;
  },

  // ─── Step 6: 不活躍用戶/球隊（從資料讀取） ───
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
          <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">UID: ${escapeHTML(u.uid)} ・ Lv.${u.level} ・ ${escapeHTML(u.region)}</div>
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
