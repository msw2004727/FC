/* ================================================
   SportHub — User Admin: EXP Management & Logs
   ================================================ */

Object.assign(App, {

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
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
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
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
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
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
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
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
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

  // ─── 操作紀錄渲染 + 篩選 + 分頁 ───
  _opLogPage: 1,
  _opLogFiltered: null,

  filterOperationLogs(page) {
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

    this._opLogFiltered = logs;
    this._opLogPage = page || 1;
    this.renderOperationLogs(logs, this._opLogPage);
  },

  _opLogGoPage(page) {
    this._opLogPage = page;
    this.renderOperationLogs(this._opLogFiltered || ApiService.getOperationLogs(), page);
  },

  renderOperationLogs(logs, page) {
    const container = document.getElementById('operation-log-list');
    if (!container) return;

    if (!logs) logs = ApiService.getOperationLogs();
    const PAGE_SIZE = 20;
    const p = Math.max(1, page || 1);
    const totalPages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
    const safePage = Math.min(p, totalPages);
    const pageItems = logs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    if (logs.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">沒有符合條件的紀錄</div>';
      return;
    }

    let html = pageItems.map(l => `
      <div class="log-item">
        <span class="log-time">${escapeHTML(l.time)}</span>
        <span class="log-content">
          <span class="log-type ${l.type}">${escapeHTML(l.typeName)}</span>
          ${escapeHTML(l.operator)}：${escapeHTML(l.content)}
        </span>
      </div>
    `).join('');

    if (totalPages > 1) {
      html += `<div style="display:flex;justify-content:center;align-items:center;gap:.5rem;padding:.8rem 0;font-size:.78rem">
        <button class="outline-btn" style="font-size:.72rem;padding:.25rem .6rem" onclick="App._opLogGoPage(${safePage - 1})" ${safePage <= 1 ? 'disabled' : ''}>‹ 上一頁</button>
        <span style="color:var(--text-muted)">${safePage} / ${totalPages}（共 ${logs.length} 筆）</span>
        <button class="outline-btn" style="font-size:.72rem;padding:.25rem .6rem" onclick="App._opLogGoPage(${safePage + 1})" ${safePage >= totalPages ? 'disabled' : ''}>下一頁 ›</button>
      </div>`;
    }

    container.innerHTML = html;
  },

});
