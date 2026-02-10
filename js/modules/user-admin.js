/* ================================================
   SportHub — User Admin (Users, EXP, Permissions, Roles, Inactive)
   ================================================ */

Object.assign(App, {

  renderAdminUsers() {
    const container = document.getElementById('admin-user-list');
    if (!container) return;
    const myLevel = ROLE_LEVEL_MAP[this.currentRole];

    container.innerHTML = ApiService.getAdminUsers().map(u => {
      let promoteOptions = '';
      if (myLevel >= 5) {
        promoteOptions = '<option value="">晉升▼</option><option>管理員</option><option>教練</option><option>領隊</option><option>場主</option>';
      } else if (myLevel >= 4) {
        promoteOptions = '<option value="">晉升▼</option><option>教練</option><option>領隊</option><option>場主</option>';
      }

      return `
        <div class="admin-user-card">
          <div class="profile-avatar small">${u.name[0]}</div>
          <div class="admin-user-info">
            <div class="admin-user-name">${this._userTag(u.name, u.role)}</div>
            <div class="admin-user-meta">${u.uid} ・ ${ROLES[u.role]?.label || u.role} ・ Lv.${u.level} ・ ${u.region}</div>
          </div>
          <div class="admin-user-actions">
            ${promoteOptions ? `<select class="promote-select" onchange="App.handlePromote(this, '${u.name}')">${promoteOptions}</select>` : ''}
            <button class="text-btn" onclick="App.showUserProfile('${u.name}')">查看</button>
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
    ApiService.promoteUser(name, roleKey);
    this.renderAdminUsers();
    this.showToast(`已將「${name}」晉升為「${select.value}」`);
    select.value = '';
  },

  renderExpLogs() {
    const container = document.getElementById('exp-log-list');
    if (!container) return;
    container.innerHTML = ApiService.getExpLogs().map(l => `
      <div class="log-item">
        <span class="log-time">${l.time}</span>
        <span class="log-content">${this._userTag(l.target)} <strong>${l.amount}</strong>「${l.reason}」</span>
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
      card.querySelector('.exp-target-name').textContent = found.name;
      card.querySelector('.exp-target-detail').textContent = `UID: ${found.uid} ・ Lv.${found.level} ・ EXP: ${found.exp}`;
      card.querySelector('.profile-avatar').textContent = found.name[0];
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
      card.querySelector('.exp-target-detail').textContent = `UID: ${user.uid} ・ Lv.${user.level} ・ EXP: ${user.exp}`;
      this.renderExpLogs();
      this.renderOperationLogs();
      this.showToast(`已調整「${targetName}」EXP ${amount > 0 ? '+' : ''}${amount}`);
    }
  },

  renderOperationLogs() {
    const container = document.getElementById('operation-log-list');
    if (!container) return;
    container.innerHTML = ApiService.getOperationLogs().map(l => `
      <div class="log-item">
        <span class="log-time">${l.time}</span>
        <span class="log-content">
          <span class="log-type ${l.type}">${l.typeName}</span>
          ${l.operator}：${l.content}
        </span>
      </div>
    `).join('');
  },

  renderPermissions() {
    const container = document.getElementById('permissions-list');
    if (!container) return;
    container.innerHTML = ApiService.getPermissions().map((cat, ci) => `
      <div class="perm-category">
        <div class="perm-category-title" onclick="this.parentElement.classList.toggle('collapsed')">
          ${cat.cat}
        </div>
        <div class="perm-items">
          ${cat.items.map((p, pi) => `
            <label class="perm-item">
              <input type="checkbox" ${Math.random() > 0.5 ? 'checked' : ''}>
              <span>${p.name}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');
  },

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

  renderInactiveData() {
    const container = document.getElementById('inactive-list');
    if (!container) return;
    container.innerHTML = `
      <div class="inactive-card">
        <div style="font-weight:700">鳳凰隊</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">解散日期：2025/12/15</div>
        <div style="font-size:.78rem;color:var(--text-muted)">原領隊：暱稱Z ・ 原成員：14 人</div>
        <button class="text-btn" style="margin-top:.4rem">查看完整歷史資料</button>
      </div>
      <div class="inactive-card">
        <div style="font-weight:700">颱風隊</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:.3rem">解散日期：2025/08/20</div>
        <div style="font-size:.78rem;color:var(--text-muted)">原領隊：暱稱W ・ 原成員：10 人</div>
        <button class="text-btn" style="margin-top:.4rem">查看完整歷史資料</button>
      </div>
    `;
  },

});
