/* ================================================
   SportHub — Profile Data: Applications & Companions
   依賴：profile-core.js, profile-data-render.js
   ================================================ */
Object.assign(App, {

  _getTeamApplicationTimeMs(msg) {
    const parseValue = (value) => {
      if (!value) return 0;
      if (typeof value.toMillis === 'function') return value.toMillis();
      if (typeof value.seconds === 'number') {
        return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
      }
      if (typeof value === 'number') return value;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const direct = parseValue(msg?.timestamp) || parseValue(msg?.createdAt);
    if (direct) return direct;

    const timeStr = String(msg?.time || '').trim();
    if (timeStr) {
      const [datePart, timePart = '0:0'] = timeStr.split(' ');
      const [y, mo, d] = datePart.split('/').map(Number);
      const [h, mi] = timePart.split(':').map(Number);
      const parsed = new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0).getTime();
      if (Number.isFinite(parsed)) return parsed;
    }

    return parseValue(msg?.rejectedAt);
  },

  _getMyLatestTeamApplications() {
    const user = ApiService.getCurrentUser();
    const uid = user?.uid || user?.lineUserId || (ModeManager.isDemo() ? 'demo-user' : null);
    if (!uid) return [];
    const currentTeamIds = (typeof this._getUserTeamIds === 'function')
      ? this._getUserTeamIds(user)
      : (() => {
        const ids = [];
        const seen = new Set();
        const pushId = (id) => {
          const value = String(id || '').trim();
          if (!value || seen.has(value)) return;
          seen.add(value);
          ids.push(value);
        };
        if (Array.isArray(user?.teamIds)) user.teamIds.forEach(pushId);
        pushId(user?.teamId);
        return ids;
      })();
    const liveTeams = ApiService.getTeams() || [];
    const liveTeamIds = new Set(liveTeams.map(team => String(team?.id || '').trim()).filter(Boolean));
    const liveTeamNames = new Set(liveTeams.map(team => String(team?.name || '').trim()).filter(Boolean));

    const allMsgs = ApiService.getMessages() || [];
    const statusWeight = {
      approved: 3,
      rejected: 3,
      ignored: 3,
      pending: 2,
    };

    const groupMap = new Map();
    allMsgs.forEach(msg => {
      if (msg.actionType !== 'team_join_request' || !msg.meta || msg.meta.applicantUid !== uid) return;

      const groupKey = String(msg.meta.groupId || msg.id || '').trim();
      const prev = groupMap.get(groupKey);
      if (!prev) {
        groupMap.set(groupKey, msg);
        return;
      }

      const prevWeight = statusWeight[prev.actionStatus] || 0;
      const nextWeight = statusWeight[msg.actionStatus] || 0;
      const prevTime = this._getTeamApplicationTimeMs(prev);
      const nextTime = this._getTeamApplicationTimeMs(msg);
      if (nextWeight > prevWeight || (nextWeight === prevWeight && nextTime > prevTime)) {
        groupMap.set(groupKey, msg);
      }
    });

    const teamMap = new Map();
    Array.from(groupMap.values()).forEach(msg => {
      const teamKey = String(msg.meta?.teamId || msg.meta?.teamName || msg.id || '').trim();
      const prev = teamMap.get(teamKey);
      if (!prev) {
        teamMap.set(teamKey, msg);
        return;
      }

      const prevTime = this._getTeamApplicationTimeMs(prev);
      const nextTime = this._getTeamApplicationTimeMs(msg);
      const prevWeight = statusWeight[prev.actionStatus] || 0;
      const nextWeight = statusWeight[msg.actionStatus] || 0;
      if (nextTime > prevTime || (nextTime === prevTime && nextWeight > prevWeight)) {
        teamMap.set(teamKey, msg);
      }
    });

    return Array.from(teamMap.values()).filter(msg => {
      const teamId = String(msg.meta?.teamId || '').trim();
      const teamName = String(msg.meta?.teamName || '').trim();
      const teamExists = teamId ? liveTeamIds.has(teamId) : !!teamName && liveTeamNames.has(teamName);
      if (!teamExists) return false;
      // 已入隊 → 不再顯示該俱樂部的申請紀錄（無論 message 狀態為何）
      if (teamId && currentTeamIds.includes(teamId)) return false;
      // name-only 舊 message（無 teamId）：透過俱樂部名稱反查 ID 比對 membership
      if (!teamId && teamName) {
        const matchedTeam = liveTeams.find(t => String(t.name || '').trim() === teamName);
        if (matchedTeam && currentTeamIds.includes(String(matchedTeam.id || '').trim())) return false;
      }
      return true;
    }).sort((a, b) => {
      const diff = this._getTeamApplicationTimeMs(b) - this._getTeamApplicationTimeMs(a);
      if (diff !== 0) return diff;
      return String(a.meta?.teamName || '').localeCompare(String(b.meta?.teamName || ''));
    });
  },

  _renderMyApplications() {
    const card = document.getElementById('profile-applications-card');
    const list = document.getElementById('profile-applications-list');
    if (!card || !list) return;
    const latestByTeam = this._getMyLatestTeamApplications();
    if (!latestByTeam.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    const badge = document.getElementById('app-count-badge');
    if (badge) badge.textContent = latestByTeam.length;
    const statusMap = {
      pending:  { label: '審核中', color: 'var(--warning)' },
      approved: { label: '已通過', color: 'var(--success)' },
      rejected: { label: '已拒絕', color: 'var(--danger)' },
      ignored:  { label: '已逾期', color: 'var(--text-muted)' },
    };
    list.innerHTML = latestByTeam.map(m => {
      const s = statusMap[m.actionStatus] || statusMap.pending;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.82rem">${escapeHTML(m.meta.teamName || '-')}</span>
        <span style="font-size:.72rem;font-weight:600;color:${s.color}">${s.label}</span>
      </div>`;
    }).join('');
  },

  // ── 同行者管理 ──

  renderCompanions() {
    const companions = ApiService.getCompanions();
    const countEl = document.getElementById('companions-count');
    if (countEl) countEl.textContent = companions.length;
    const list = document.getElementById('companions-inner-list');
    if (!list) return;
    if (!companions.length) {
      list.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">尚無同行者</div>';
      return;
    }
    const genderIcon = { '男': '♂', '女': '♀' };
    const circledNums = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
    list.innerHTML = companions.map((c, idx) => `
      <div style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border)">
        <div style="flex:1">
          <span style="font-size:.85rem;font-weight:600"><span style="color:var(--text-muted);margin-right:.2rem">${circledNums[idx] || (idx + 1)}</span>${escapeHTML(c.name)}</span>
          ${c.gender ? `<span style="font-size:.72rem;color:var(--text-muted);margin-left:.3rem">${genderIcon[c.gender] || ''}${escapeHTML(c.gender)}</span>` : ''}
          ${c.notes ? `<div style="font-size:.72rem;color:var(--text-muted)">${escapeHTML(c.notes)}</div>` : ''}
        </div>
        <button class="outline-btn" style="font-size:.7rem;padding:.15rem .45rem" onclick="App.openCompanionModal('${escapeHTML(c.id)}')">編輯</button>
        <button class="outline-btn" style="font-size:.7rem;padding:.15rem .45rem;color:var(--danger);border-color:var(--danger)" onclick="App.deleteCompanion('${escapeHTML(c.id)}')">刪除</button>
      </div>
    `).join('') +
    (companions.length > 0 ? '<div style="font-size:.7rem;color:var(--text-muted);margin-top:.3rem">※ 序號為同行報名時的候補遞補順序</div>' : '');
  },

  toggleCompanionsSection(labelEl) {
    this.toggleProfileSection(labelEl, 'companions');
  },

  openCompanionModal(companionId) {
    const overlay = document.getElementById('companion-modal-overlay');
    const titleEl = document.getElementById('companion-modal-title');
    const idInput = document.getElementById('companion-modal-id');
    const nameInput = document.getElementById('companion-modal-name');
    const genderSelect = document.getElementById('companion-modal-gender');
    const notesInput = document.getElementById('companion-modal-notes');
    if (!overlay) return;
    if (companionId) {
      const comp = ApiService.getCompanions().find(c => c.id === companionId);
      if (!comp) return;
      if (titleEl) titleEl.textContent = '編輯同行者';
      if (idInput) idInput.value = comp.id;
      if (nameInput) nameInput.value = comp.name || '';
      if (genderSelect) genderSelect.value = comp.gender || '';
      if (notesInput) notesInput.value = comp.notes || '';
    } else {
      if (titleEl) titleEl.textContent = '新增同行者';
      if (idInput) idInput.value = '';
      if (nameInput) nameInput.value = '';
      if (genderSelect) genderSelect.value = '';
      if (notesInput) notesInput.value = '';
    }
    overlay.style.display = 'flex';
    overlay.classList.add('open');
  },

  closeCompanionModal() {
    const overlay = document.getElementById('companion-modal-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.classList.remove('open');
  },

  saveCompanion() {
    const id = document.getElementById('companion-modal-id')?.value || '';
    const name = (document.getElementById('companion-modal-name')?.value || '').trim();
    const gender = document.getElementById('companion-modal-gender')?.value || '';
    const notes = (document.getElementById('companion-modal-notes')?.value || '').trim();
    if (!name) { this.showToast('請填寫姓名'); return; }
    if (id) {
      ApiService.updateCompanion(id, { name, gender, notes });
      this.showToast('同行者已更新');
    } else {
      const newId = 'comp_' + Date.now();
      ApiService.addCompanion({ id: newId, name, gender, notes });
      this.showToast('同行者已新增');
    }
    this.closeCompanionModal();
    this.renderCompanions();
  },

  async deleteCompanion(companionId) {
    if (!await this.appConfirm('確定要刪除此同行者？')) return;
    ApiService.deleteCompanion(companionId);
    this.renderCompanions();
    this.showToast('同行者已刪除');
  },

});
