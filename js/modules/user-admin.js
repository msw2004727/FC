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

  // ─── EXP Management ───
  _expBatchSelected: [],
  _expTeamMembers: [],
  _expLogPage: 1,
  _expLogPerPage: 30,
  _expLogFilteredCache: null,

  // ── 頁簽切換 ──
  switchExpTab(tab) {
    const tabs = document.querySelectorAll('#exp-tab-bar .tab');
    const panels = ['individual', 'batch', 'team', 'teamExp'];
    tabs.forEach((btn, i) => {
      btn.classList.toggle('active', panels[i] === tab);
    });
    panels.forEach(p => {
      const el = document.getElementById('exp-panel-' + p);
      if (el) el.style.display = p === tab ? '' : 'none';
    });
    if (tab === 'team') this._populateExpTeamDropdown();
  },

  // ── 操作者名稱 ──
  _getExpOperatorLabel() {
    if (ApiService._demoMode) return ROLES[this.currentRole]?.label || '管理員';
    const cur = ApiService.getCurrentUser();
    return cur?.displayName || ROLES[this.currentRole]?.label || '管理員';
  },

  // ── 個別搜尋 ──
  expFuzzySearch() {
    const keyword = (document.getElementById('exp-search')?.value || '').trim().toLowerCase();
    const dd = document.getElementById('exp-search-dropdown');
    if (!dd) return;
    if (!keyword) { dd.classList.remove('open'); return; }
    const users = ApiService.getAdminUsers().filter(u =>
      u.name.toLowerCase().includes(keyword) || u.uid.toLowerCase().includes(keyword)
    ).slice(0, 8);
    if (users.length === 0) { dd.classList.remove('open'); return; }
    dd.innerHTML = users.map(u => {
      const safeName = escapeHTML(u.name).replace(/'/g, "\\'");
      return `<div class="ce-delegate-item" onclick="App._selectExpTarget('${safeName}')"><span class="ce-delegate-item-name">${escapeHTML(u.name)}</span><span style="color:var(--text-muted);font-size:.72rem">${escapeHTML(u.uid)}</span></div>`;
    }).join('');
    dd.classList.add('open');
  },

  _selectExpTarget(name) {
    const dd = document.getElementById('exp-search-dropdown');
    if (dd) dd.classList.remove('open');
    const input = document.getElementById('exp-search');
    if (input) input.value = name;
    const users = ApiService.getAdminUsers();
    const found = users.find(u => u.name === name);
    const card = document.getElementById('exp-target-card');
    if (!card || !found) return;
    card.style.display = '';
    const nameEl = card.querySelector('.exp-target-name');
    const detailEl = card.querySelector('.exp-target-detail');
    const avatarEl = card.querySelector('.profile-avatar');
    if (nameEl) nameEl.textContent = found.name;
    if (detailEl) detailEl.textContent = `UID: ${found.uid} ・ Lv.${App._calcLevelFromExp(found.exp || 0).level} ・ EXP: ${(found.exp || 0).toLocaleString()}`;
    if (avatarEl) avatarEl.textContent = (found.name || '?')[0];
    card.dataset.targetName = found.name;
  },

  // ── 個別送出 ──
  handleExpSubmit() {
    const card = document.getElementById('exp-target-card');
    const targetName = card?.dataset.targetName;
    if (!targetName) { this.showToast('請先搜尋並選擇用戶'); return; }
    const amount = parseInt(document.getElementById('exp-amount')?.value) || 0;
    const reason = (document.getElementById('exp-reason')?.value || '').trim();
    if (amount === 0) { this.showToast('請輸入 EXP 調整值'); return; }
    if (!reason) { this.showToast('請輸入備註原因'); return; }
    const operatorLabel = this._getExpOperatorLabel();
    const user = ApiService.adjustUserExp(targetName, amount, reason, operatorLabel);
    if (user) {
      const updatedDetail = card.querySelector('.exp-target-detail');
      if (updatedDetail) updatedDetail.textContent = `UID: ${user.uid} ・ Lv.${App._calcLevelFromExp(user.exp || 0).level} ・ EXP: ${(user.exp || 0).toLocaleString()}`;
      document.getElementById('exp-amount').value = '';
      document.getElementById('exp-reason').value = '';
      this.renderExpLogs();
      this.renderOperationLogs();
      this.updatePointsDisplay();
      this.showToast(`已調整「${targetName}」EXP ${amount > 0 ? '+' : ''}${amount}`);
    }
  },

  // ── 批次搜尋 ──
  expBatchSearch() {
    const keyword = (document.getElementById('exp-batch-search')?.value || '').trim().toLowerCase();
    const dd = document.getElementById('exp-batch-dropdown');
    if (!dd) return;
    if (!keyword) { dd.classList.remove('open'); return; }
    const selected = this._expBatchSelected;
    const users = ApiService.getAdminUsers().filter(u =>
      !selected.includes(u.name) &&
      (u.name.toLowerCase().includes(keyword) || u.uid.toLowerCase().includes(keyword))
    ).slice(0, 8);
    if (users.length === 0) { dd.classList.remove('open'); return; }
    dd.innerHTML = users.map(u => {
      const safeName = escapeHTML(u.name).replace(/'/g, "\\'");
      return `<div class="ce-delegate-item" onclick="App._addExpBatchUser('${safeName}')"><span class="ce-delegate-item-name">${escapeHTML(u.name)}</span><span style="color:var(--text-muted);font-size:.72rem">${escapeHTML(u.uid)}</span></div>`;
    }).join('');
    dd.classList.add('open');
  },

  _addExpBatchUser(name) {
    if (!this._expBatchSelected.includes(name)) this._expBatchSelected.push(name);
    const dd = document.getElementById('exp-batch-dropdown');
    if (dd) dd.classList.remove('open');
    const input = document.getElementById('exp-batch-search');
    if (input) input.value = '';
    this._renderExpBatchTags();
  },

  _removeExpBatchUser(name) {
    this._expBatchSelected = this._expBatchSelected.filter(n => n !== name);
    this._renderExpBatchTags();
  },

  _renderExpBatchTags() {
    const container = document.getElementById('exp-batch-tags');
    if (!container) return;
    if (this._expBatchSelected.length === 0) {
      container.innerHTML = '<span style="color:var(--text-muted);font-size:.78rem">尚未選擇用戶</span>';
      return;
    }
    container.innerHTML = this._expBatchSelected.map(name => {
      const safeName = escapeHTML(name).replace(/'/g, "\\'");
      return `<span class="reward-tag">${escapeHTML(name)}<button onclick="App._removeExpBatchUser('${safeName}')">✕</button></span>`;
    }).join('') + `<span style="font-size:.72rem;color:var(--text-muted);align-self:center">共 ${this._expBatchSelected.length} 人</span>`;
  },

  // ── 批次送出 ──
  handleBatchExpSubmit() {
    if (this._expBatchSelected.length === 0) { this.showToast('請先選擇用戶'); return; }
    const amount = parseInt(document.getElementById('exp-batch-amount')?.value) || 0;
    const reason = (document.getElementById('exp-batch-reason')?.value || '').trim();
    if (amount === 0) { this.showToast('請輸入 EXP 調整值'); return; }
    if (!reason) { this.showToast('請輸入備註原因'); return; }
    const operatorLabel = this._getExpOperatorLabel();
    let successCount = 0;
    this._expBatchSelected.forEach(name => {
      const user = ApiService.adjustUserExp(name, amount, reason, operatorLabel);
      if (user) successCount++;
    });
    document.getElementById('exp-batch-amount').value = '';
    document.getElementById('exp-batch-reason').value = '';
    this._expBatchSelected = [];
    this._renderExpBatchTags();
    this.renderExpLogs();
    this.renderOperationLogs();
    this.updatePointsDisplay();
    this.showToast(`批次調整完成：${successCount} 人 EXP ${amount > 0 ? '+' : ''}${amount}`);
  },

  // ── 球隊下拉 ──
  _populateExpTeamDropdown() {
    const sel = document.getElementById('exp-team-select');
    if (!sel) return;
    const teams = ApiService.getActiveTeams();
    sel.innerHTML = '<option value="">— 請選擇球隊 —</option>' +
      teams.map(t => `<option value="${t.id}">${escapeHTML(t.name)}（${t.members || 0} 人）</option>`).join('');
  },

  // ── 球隊選擇 ──
  expTeamSelect() {
    const teamId = document.getElementById('exp-team-select')?.value;
    const container = document.getElementById('exp-team-members');
    if (!container) return;
    if (!teamId) { container.innerHTML = ''; this._expTeamMembers = []; return; }
    const members = ApiService.getAdminUsers().filter(u => u.teamId === teamId);
    this._expTeamMembers = members;
    if (members.length === 0) {
      container.innerHTML = '<span style="color:var(--text-muted);font-size:.78rem">該球隊無成員資料</span>';
      return;
    }
    container.innerHTML = members.map(u =>
      `<span class="reward-tag">${escapeHTML(u.name)}</span>`
    ).join('') + `<span style="font-size:.72rem;color:var(--text-muted);align-self:center">共 ${members.length} 人</span>`;
  },

  // ── 球隊送出 ──
  handleTeamExpSubmit() {
    if (this._expTeamMembers.length === 0) { this.showToast('請先選擇球隊'); return; }
    const amount = parseInt(document.getElementById('exp-team-amount')?.value) || 0;
    const reason = (document.getElementById('exp-team-reason')?.value || '').trim();
    if (amount === 0) { this.showToast('請輸入 EXP 調整值'); return; }
    if (!reason) { this.showToast('請輸入備註原因'); return; }
    const operatorLabel = this._getExpOperatorLabel();
    let successCount = 0;
    this._expTeamMembers.forEach(u => {
      const result = ApiService.adjustUserExp(u.name, amount, reason, operatorLabel);
      if (result) successCount++;
    });
    document.getElementById('exp-team-amount').value = '';
    document.getElementById('exp-team-reason').value = '';
    this.renderExpLogs();
    this.renderOperationLogs();
    this.updatePointsDisplay();
    this.showToast(`全隊調整完成：${successCount} 人 EXP ${amount > 0 ? '+' : ''}${amount}`);
  },

  // ── 球隊積分搜尋 ──
  _expTeamExpSelectedId: null,

  expTeamExpSearch() {
    const keyword = (document.getElementById('exp-team-exp-search')?.value || '').trim().toLowerCase();
    const dd = document.getElementById('exp-team-exp-dropdown');
    if (!dd) return;
    if (!keyword) { dd.classList.remove('open'); return; }
    const teams = ApiService.getActiveTeams().filter(t =>
      t.name.toLowerCase().includes(keyword) || (t.nameEn || '').toLowerCase().includes(keyword)
    ).slice(0, 8);
    if (teams.length === 0) { dd.classList.remove('open'); return; }
    dd.innerHTML = teams.map(t => {
      const thumb = t.image
        ? `<img src="${t.image}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0">`
        : `<span style="width:24px;height:24px;border-radius:50%;border:1.5px dashed var(--border);display:inline-flex;flex-shrink:0"></span>`;
      return `<div class="ce-delegate-item" style="display:flex;align-items:center;gap:.4rem" onclick="App._selectExpTeamTarget('${escapeHTML(t.id)}')">${thumb}<span class="ce-delegate-item-name">${escapeHTML(t.name)}</span><span style="color:var(--text-muted);font-size:.68rem;margin-left:auto">${(t.teamExp || 0).toLocaleString()}</span></div>`;
    }).join('');
    dd.classList.add('open');
  },

  _selectExpTeamTarget(teamId) {
    const dd = document.getElementById('exp-team-exp-dropdown');
    if (dd) dd.classList.remove('open');
    const input = document.getElementById('exp-team-exp-search');
    const team = ApiService.getTeam(teamId);
    if (!team) return;
    if (input) input.value = team.name;
    this._expTeamExpSelectedId = teamId;
    const card = document.getElementById('exp-team-exp-card');
    if (!card) return;
    card.style.display = '';
    const rank = this._getTeamRank ? this._getTeamRank(team.teamExp) : (function() {
      const exp = team.teamExp || 0;
      for (let i = TEAM_RANK_CONFIG.length - 1; i >= 0; i--) {
        if (exp >= TEAM_RANK_CONFIG[i].min) return TEAM_RANK_CONFIG[i];
      }
      return TEAM_RANK_CONFIG[0];
    })();
    const avatarEl = document.getElementById('exp-team-exp-avatar');
    const nameEl = document.getElementById('exp-team-exp-name');
    const detailEl = document.getElementById('exp-team-exp-detail');
    if (avatarEl) {
      if (team.image) {
        avatarEl.innerHTML = `<img src="${team.image}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        avatarEl.style.border = 'none';
        avatarEl.style.background = 'none';
      } else {
        avatarEl.innerHTML = '';
        avatarEl.style.border = '2px dashed var(--border)';
        avatarEl.style.background = 'var(--bg-elevated)';
      }
    }
    if (nameEl) nameEl.innerHTML = `${escapeHTML(team.name)} <span style="color:${rank.color};font-weight:900;margin-left:.3rem">${(team.teamExp || 0).toLocaleString()} ${rank.rank}</span>`;
    if (detailEl) detailEl.textContent = `積分: ${(team.teamExp || 0).toLocaleString()} ・ ${team.members} 人 ・ ${team.region || '—'}`;
  },

  handleTeamExpSubmit2() {
    if (!this._expTeamExpSelectedId) { this.showToast('請先搜尋並選擇球隊'); return; }
    const amount = parseInt(document.getElementById('exp-team-exp-amount')?.value) || 0;
    const reason = (document.getElementById('exp-team-exp-reason')?.value || '').trim();
    if (amount === 0) { this.showToast('請輸入積分調整值'); return; }
    if (!reason) { this.showToast('請輸入備註原因'); return; }
    const operatorLabel = this._getExpOperatorLabel();
    const team = ApiService.adjustTeamExp(this._expTeamExpSelectedId, amount, reason, operatorLabel);
    if (team) {
      this._selectExpTeamTarget(this._expTeamExpSelectedId);
      document.getElementById('exp-team-exp-amount').value = '';
      document.getElementById('exp-team-exp-reason').value = '';
      this.renderExpLogs();
      this.renderOperationLogs();
      this.showToast(`已調整「${team.name}」球隊積分 ${amount > 0 ? '+' : ''}${amount}`);
    }
  },

  // ── 操作紀錄渲染（分頁） ──
  renderExpLogs(logs) {
    const container = document.getElementById('exp-log-list');
    if (!container) return;
    if (!logs) {
      const userLogs = (ApiService.getExpLogs() || []).map(l => ({ ...l, logType: 'user' }));
      const teamLogs = (ApiService.getTeamExpLogs() || []).map(l => ({ ...l, logType: 'team' }));
      logs = [...userLogs, ...teamLogs].sort((a, b) => {
        if (a.time > b.time) return -1;
        if (a.time < b.time) return 1;
        return 0;
      });
    }
    this._expLogFilteredCache = logs;

    if (logs.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted)">沒有操作紀錄</div>';
      const pgEl = document.getElementById('exp-log-pagination');
      if (pgEl) pgEl.innerHTML = '';
      return;
    }

    const perPage = this._expLogPerPage;
    const totalPages = Math.ceil(logs.length / perPage);
    if (this._expLogPage > totalPages) this._expLogPage = totalPages;
    if (this._expLogPage < 1) this._expLogPage = 1;
    const start = (this._expLogPage - 1) * perPage;
    const pageItems = logs.slice(start, start + perPage);

    container.innerHTML = pageItems.map(l => {
      const isPlus = String(l.amount).includes('+');
      let colorClass = '';
      if (l.logType === 'team') {
        colorClass = isPlus ? 'log-team-plus' : 'log-team-minus';
      } else {
        colorClass = isPlus ? 'log-user-plus' : 'log-user-minus';
      }
      const typeTag = l.logType === 'team' ? '<span class="log-type team_exp">球隊</span>' : '';
      return `
      <div class="log-item ${colorClass}">
        <span class="log-time">${escapeHTML(l.time)}</span>
        <span class="log-content">${typeTag}${l.logType === 'team' ? escapeHTML(l.target) : this._userTag(l.target)} <strong>${escapeHTML(String(l.amount))}</strong>「${escapeHTML(l.reason)}」${l.operator ? `<span class="exp-log-operator">— ${escapeHTML(l.operator)}</span>` : ''}</span>
      </div>`;
    }).join('');

    this._renderExpLogPagination(totalPages);
  },

  _renderExpLogPagination(totalPages) {
    const pgEl = document.getElementById('exp-log-pagination');
    if (!pgEl) return;
    if (totalPages <= 1) { pgEl.innerHTML = ''; return; }
    const cur = this._expLogPage;
    let html = '';
    if (cur > 1) html += `<button class="exp-pg-btn" onclick="App.goExpLogPage(${cur - 1})">‹</button>`;
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="exp-pg-btn${i === cur ? ' active' : ''}" onclick="App.goExpLogPage(${i})">${i}</button>`;
    }
    if (cur < totalPages) html += `<button class="exp-pg-btn" onclick="App.goExpLogPage(${cur + 1})">›</button>`;
    pgEl.innerHTML = html;
  },

  goExpLogPage(page) {
    this._expLogPage = page;
    this.renderExpLogs(this._expLogFilteredCache);
  },

  // ── 操作紀錄篩選 ──
  filterExpLogs() {
    const keyword = (document.getElementById('exp-log-search')?.value || '').trim().toLowerCase();
    const dateVal = document.getElementById('exp-log-date')?.value || '';
    const userLogs = (ApiService.getExpLogs() || []).map(l => ({ ...l, logType: 'user' }));
    const teamLogs = (ApiService.getTeamExpLogs() || []).map(l => ({ ...l, logType: 'team' }));
    let logs = [...userLogs, ...teamLogs].sort((a, b) => {
      if (a.time > b.time) return -1;
      if (a.time < b.time) return 1;
      return 0;
    });
    if (keyword) {
      logs = logs.filter(l => (l.target || '').toLowerCase().includes(keyword));
    }
    if (dateVal) {
      const parts = dateVal.split('-');
      const datePrefix = `${parts[1]}/${parts[2]}`;
      logs = logs.filter(l => l.time.startsWith(datePrefix));
    }
    this._expLogPage = 1;
    this.renderExpLogs(logs);
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
  _permSelectedRole: null,

  // ─── Role Hierarchy ───

  _getBuiltinRoles() {
    return ['user', 'coach', 'captain', 'venue_owner', 'admin', 'super_admin'];
  },

  _getCustomRoles() {
    return (ModeManager.isDemo() ? DemoData.customRoles : (FirebaseService._cache.customRoles || [])) || [];
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
    const defaults = DemoData.rolePermissions[role];
    if (!defaults) {
      this.showToast('此層級無預設權限可復原');
      return;
    }
    const source = ModeManager.isDemo() ? DemoData.rolePermissions : (FirebaseService._cache.rolePermissions || DemoData.rolePermissions);
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
    const source = ModeManager.isDemo() ? DemoData.rolePermissions : (FirebaseService._cache.rolePermissions || DemoData.rolePermissions);
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
    const source = ModeManager.isDemo() ? DemoData.rolePermissions : (FirebaseService._cache.rolePermissions || DemoData.rolePermissions);
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
    msg.innerHTML = `確定要刪除自訂層級「<strong>${escapeHTML(info.label)}</strong>」嗎？<br><br><span style="color:var(--danger);font-size:.78rem">該層級的所有用戶將自動降為下一級。此操作無法復原。</span>`;
    const btn = document.getElementById('role-delete-confirm-btn');
    btn.onclick = () => App.executeDeleteCustomRole();
    overlay.style.display = '';
  },

  executeDeleteCustomRole() {
    const key = this._pendingDeleteRoleKey;
    if (!key) return;
    const customRoles = this._getCustomRoles();
    const idx = customRoles.findIndex(c => c.key === key);
    if (idx < 0) return;
    const info = this._getRoleInfo(key);
    const demoteToRole = customRoles[idx].afterRole || 'user';

    // 降級該層級的用戶
    const users = ApiService.getAdminUsers ? ApiService.getAdminUsers() : [];
    users.forEach(u => {
      if (u.role === key) {
        u.role = demoteToRole;
        // 正式版：更新 Firestore 用戶角色
        if (!ModeManager.isDemo() && u._docId) {
          FirebaseService.updateUserRole(u._docId, demoteToRole).catch(err => console.error('[deleteCustomRole] demote user:', err));
        }
      }
    });

    // 移除自訂層級
    customRoles.splice(idx, 1);

    // 移除權限
    const source = ModeManager.isDemo() ? DemoData.rolePermissions : (FirebaseService._cache.rolePermissions || DemoData.rolePermissions);
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

    document.getElementById('role-delete-overlay').style.display = 'none';
    this._pendingDeleteRoleKey = null;
    this.renderRoleHierarchy();
    this.showToast(`層級「${info.label}」已刪除，相關用戶已降為「${ROLES[demoteToRole]?.label || demoteToRole}」`);
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
