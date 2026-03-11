/* ================================================
   SportHub — Tournament: Management, Create & Edit
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Tournament Management (Admin)
  // ══════════════════════════════════

  _tmActiveTab: 'active',

  switchTournamentManageTab(tab) {
    this._tmActiveTab = tab;
    document.querySelectorAll('#tm-tabs .tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tmtab === tab);
    });
    this.renderTournamentManage();
  },

  renderTournamentManage() {
    const container = document.getElementById('tournament-manage-list');
    if (!container) return;
    const tab = this._tmActiveTab || 'active';
    this._refreshTournamentCenterCreateButton();
    const currentUser = ApiService.getCurrentUser?.();
    const roleLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    const isAdmin = roleLevel >= ROLE_LEVEL_MAP.admin;
    const all = (ApiService.getTournaments() || [])
      .map(t => this.getFriendlyTournamentRecord?.(t) || t)
      .filter(t => isAdmin || this._canManageTournamentRecord(t, currentUser));

    const filtered = all.filter(t => {
      const ended = this.isTournamentEnded(t);
      return tab === 'ended' ? ended : !ended;
    });
    if (filtered.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">${tab === 'ended' ? '目前沒有已結束的賽事。' : '目前沒有可管理的賽事。'}</div>`;
      return;
    }

    container.innerHTML = filtered.map(t => {
      const status = this.getTournamentStatus(t);
      const isEnded = this.isTournamentEnded(t);
      const statusLabel = isEnded ? '已結束' : status;
      const statusColorMap = {
        '即將開始': '#6b7280',
        '報名中': '#10b981',
        '已截止報名': '#f59e0b',
        '已結束': '#6b7280',
      };
      const statusColor = statusColorMap[statusLabel] || '#6b7280';
      const registered = Array.isArray(t.registeredTeams) ? t.registeredTeams : [];
      const feeEnabled = typeof t.feeEnabled === 'boolean' ? t.feeEnabled : Number(t.fee || 0) > 0;
      const fee = feeEnabled ? (Number(t.fee || 0) || 0) : 0;
      const revenue = registered.length * fee;
      const canManage = isAdmin || this._canManageTournamentRecord(t, currentUser);
      const organizerDisplay = this._getTournamentOrganizerDisplayText?.(t) || t.organizer || '主辦球隊';
      const typeLabel = this._getTournamentModeLabel?.(t) || t.type || '友誼賽';
      const teamLimit = this._getFriendlyTournamentTeamLimit?.(t) || t.maxTeams || 4;
      const scheduleCount = Array.isArray(t.matchDates) ? t.matchDates.length : 0;
      const feeText = feeEnabled
        ? `應收費用：<strong>NT$${revenue.toLocaleString()}</strong>（${registered.length} 隊 × NT$${fee.toLocaleString()}）`
        : '報名費未開啟';

      return `
      <div class="event-card" style="${isEnded ? 'opacity:.55;filter:grayscale(.4)' : ''}">
        ${t.image ? `<div class="event-card-img"><img src="${t.image}" style="width:100%;height:120px;object-fit:cover;display:block;border-radius:var(--radius) var(--radius) 0 0"></div>` : ''}
        <div class="event-card-body">
          <div style="display:flex;align-items:center;gap:.4rem">
            <div class="event-card-title" style="flex:1">${escapeHTML(t.name)}</div>
            <span style="font-size:.68rem;padding:.15rem .45rem;border-radius:20px;background:${statusColor}18;color:${statusColor};font-weight:600;white-space:nowrap">${statusLabel}</span>
          </div>
          <div class="event-meta">
            <span class="event-meta-item">${escapeHTML(typeLabel)}</span>
            ${t.region ? `<span class="event-meta-item">${escapeHTML(t.region)}</span>` : ''}
            <span class="event-meta-item">${teamLimit} 隊</span>
            ${scheduleCount ? `<span class="event-meta-item">比賽日 ${scheduleCount} 天</span>` : ''}
            <span class="event-meta-item">主辦 ${escapeHTML(organizerDisplay)}</span>
          </div>
          <div style="font-size:.78rem;color:var(--text-secondary);margin-top:.3rem">${feeText}</div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            ${isEnded ? `
              <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.showTournamentDetail('${t.id}')">查看詳情</button>
              ${isAdmin ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;background:#10b981;color:#fff;border-color:#10b981" onclick="App.handleReopenTournament('${t.id}')">重新開啟</button>` : ''}
              ${isAdmin ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.handleDeleteTournament('${t.id}')">刪除賽事</button>` : ''}
            ` : `
              ${canManage ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;background:#10b981;color:#fff;border-color:#10b981" onclick="App.showEditTournament('${t.id}')">編輯賽事</button>` : ''}
              <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.showTournamentDetail('${t.id}')">查看詳情</button>
              ${isAdmin ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.handleEndTournament('${t.id}')">結束賽事</button>` : ''}
            `}
          </div>
        </div>
      </div>`;
    }).join('');
  },

  // ══════════════════════════════════
  //  Venue Management (Create & Edit)
  // ══════════════════════════════════

  _ctVenues: [],
  _etVenues: [],

  addTournamentVenue(prefix) {
    const p = prefix || 'ct';
    const input = document.getElementById(`${p}-venue-input`);
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    const arr = p === 'et' ? this._etVenues : this._ctVenues;
    if (arr.includes(val)) { this.showToast('此場地已存在'); return; }
    arr.push(val);
    input.value = '';
    this._renderVenueTags(p);
  },

  removeTournamentVenue(prefix, idx) {
    const arr = prefix === 'et' ? this._etVenues : this._ctVenues;
    arr.splice(idx, 1);
    this._renderVenueTags(prefix);
  },

  _renderVenueTags(prefix) {
    const container = document.getElementById(`${prefix}-venue-tags`);
    if (!container) return;
    const arr = prefix === 'et' ? this._etVenues : this._ctVenues;
    container.innerHTML = arr.map((v, i) => {
      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`;
      return `<span style="display:inline-flex;align-items:center;gap:.25rem;font-size:.72rem;padding:.2rem .5rem;border-radius:20px;background:var(--surface-alt);border:1px solid var(--border)">
        <a href="${mapUrl}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none">${escapeHTML(v)} 📍</a>
        <span style="cursor:pointer;color:var(--text-muted)" onclick="App.removeTournamentVenue('${prefix}',${i})">✕</span>
      </span>`;
    }).join('');
  },

  // ══════════════════════════════════
  //  Delegate Management (Create & Edit)
  // ══════════════════════════════════

  _ctDelegates: [],
  _etDelegates: [],
  _tournamentDelegateSearchBound: { ct: false, et: false },

  _initTournamentDelegateSearch(prefix) {
    const p = prefix || 'ct';
    const input = document.getElementById(`${p}-delegate-search`);
    const dropdown = document.getElementById(`${p}-delegate-dropdown`);
    if (!input || !dropdown) return;

    if (this._tournamentDelegateSearchBound[p]) {
      this._renderTournamentDelegateTags(p);
      this._updateTournamentDelegateInput(p);
      return;
    }
    this._tournamentDelegateSearchBound[p] = true;

    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (q.length < 1) { dropdown.classList.remove('open'); dropdown.innerHTML = ''; return; }
      this._searchTournamentDelegates(q, p);
    });
    input.addEventListener('blur', () => {
      setTimeout(() => { dropdown.classList.remove('open'); }, 200);
    });
    input.addEventListener('focus', () => {
      const q = input.value.trim();
      if (q.length >= 1) this._searchTournamentDelegates(q, p);
    });

    this._renderTournamentDelegateTags(p);
    this._updateTournamentDelegateInput(p);
  },

  _searchTournamentDelegates(query, prefix) {
    const p = prefix || 'ct';
    const dropdown = document.getElementById(`${p}-delegate-dropdown`);
    if (!dropdown) return;
    const q = query.toLowerCase();
    const delegates = p === 'et' ? this._etDelegates : this._ctDelegates;
    const selectedUids = delegates.map(d => d.uid);

    const allUsers = ApiService.getAdminUsers?.() || [];
    const results = allUsers.filter(u => {
      if (selectedUids.includes(u.uid)) return false;
      return (u.name || '').toLowerCase().includes(q) || (u.uid || '').toLowerCase().includes(q);
    }).slice(0, 5);

    if (results.length === 0) {
      dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">找不到符合的用戶</div>';
    } else {
      const roleLabels = typeof ROLES !== 'undefined' ? ROLES : {};
      dropdown.innerHTML = results.map(u => {
        const roleLabel = roleLabels[u.role]?.label || u.role || '';
        return `<div class="ce-delegate-item" data-uid="${u.uid}" data-name="${escapeHTML(u.name)}">
          <span class="ce-delegate-item-name">${escapeHTML(u.name)}</span>
          <span class="ce-delegate-item-meta">${u.uid} · ${roleLabel}</span>
        </div>`;
      }).join('');

      dropdown.querySelectorAll('.ce-delegate-item').forEach(item => {
        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          this._addTournamentDelegate(item.dataset.uid, item.dataset.name, p);
          document.getElementById(`${p}-delegate-search`).value = '';
          dropdown.classList.remove('open');
        });
      });
    }
    dropdown.classList.add('open');
  },

  _addTournamentDelegate(uid, name, prefix) {
    const p = prefix || 'ct';
    const delegates = p === 'et' ? this._etDelegates : this._ctDelegates;
    if (delegates.length >= 10) return;
    if (delegates.some(d => d.uid === uid)) return;
    delegates.push({ uid, name });
    this._renderTournamentDelegateTags(p);
    this._updateTournamentDelegateInput(p);
  },

  _removeTournamentDelegate(uid, prefix) {
    const p = prefix || 'ct';
    if (p === 'et') {
      this._etDelegates = this._etDelegates.filter(d => d.uid !== uid);
    } else {
      this._ctDelegates = this._ctDelegates.filter(d => d.uid !== uid);
    }
    this._renderTournamentDelegateTags(p);
    this._updateTournamentDelegateInput(p);
  },

  _renderTournamentDelegateTags(prefix) {
    const p = prefix || 'ct';
    const container = document.getElementById(`${p}-delegate-tags`);
    if (!container) return;
    const delegates = p === 'et' ? this._etDelegates : this._ctDelegates;
    const users = ApiService.getAdminUsers?.() || [];
    container.innerHTML = delegates.map(d => {
      const u = users.find(u => u.uid === d.uid);
      const role = u?.role || 'user';
      return `<span class="ce-delegate-tag">${this._userTag(d.name, role)}<span class="ce-delegate-remove" onclick="App._removeTournamentDelegate('${d.uid}','${p}')">✕</span></span>`;
    }).join('');
  },

  _updateTournamentDelegateInput(prefix) {
    const p = prefix || 'ct';
    const input = document.getElementById(`${p}-delegate-search`);
    if (!input) return;
    const delegates = p === 'et' ? this._etDelegates : this._ctDelegates;
    input.disabled = delegates.length >= 10;
    input.placeholder = delegates.length >= 10 ? '已達上限 10 人' : '搜尋 UID 或暱稱...';
  },

  // ══════════════════════════════════
  //  Match Dates
  // ══════════════════════════════════

  _ctMatchDates: [],
  _etMatchDates: [],

  addMatchDate(val) {
    if (!val || this._ctMatchDates.includes(val)) return;
    this._ctMatchDates.push(val);
    this._ctMatchDates.sort();
    this._renderMatchDateTags('ct');
    document.getElementById('ct-match-date-picker').value = '';
  },

  removeMatchDate(val) {
    this._ctMatchDates = this._ctMatchDates.filter(d => d !== val);
    this._renderMatchDateTags('ct');
  },

  addEditMatchDate(val) {
    if (!val || this._etMatchDates.includes(val)) return;
    this._etMatchDates.push(val);
    this._etMatchDates.sort();
    this._renderMatchDateTags('et');
    document.getElementById('et-match-date-picker').value = '';
  },

  removeEditMatchDate(val) {
    this._etMatchDates = this._etMatchDates.filter(d => d !== val);
    this._renderMatchDateTags('et');
  },

  _renderMatchDateTags(prefix) {
    const p = prefix || 'ct';
    const wrap = document.getElementById(`${p}-match-dates-wrap`);
    if (!wrap) return;
    const dates = p === 'et' ? this._etMatchDates : this._ctMatchDates;
    const removeFn = p === 'et' ? 'removeEditMatchDate' : 'removeMatchDate';
    wrap.innerHTML = dates.map(d => {
      const parts = d.split('-');
      const label = `${parseInt(parts[1])}/${parseInt(parts[2])}`;
      return `<span style="display:inline-flex;align-items:center;gap:.2rem;font-size:.72rem;padding:.2rem .5rem;border-radius:20px;background:var(--accent);color:#fff">${label}<span style="cursor:pointer;margin-left:.1rem" onclick="App.${removeFn}('${d}')">✕</span></span>`;
    }).join('');
  },

  // ══════════════════════════════════
  //  Create Tournament
  // ══════════════════════════════════

  _refreshTournamentCenterCreateButton() {
    const header = document.querySelector('#page-tournaments .page-header');
    if (!header) return;

    let button = document.getElementById('tournament-open-create-btn');
    if (!button) {
      button = document.createElement('button');
      button.id = 'tournament-open-create-btn';
      button.className = 'primary-btn small';
      button.textContent = '＋ 新增賽事';
      button.onclick = () => this.openCreateTournamentModal();
      button.textContent = '建立賽事';
      header.appendChild(button);
    }

    button.style.display = this._canCreateFriendlyTournament() ? '' : 'none';
  },

  _getTournamentSelectableHostTeams(selectedId = '') {
    const currentUser = ApiService.getCurrentUser?.();
    const roleLevel = ROLE_LEVEL_MAP[currentUser?.role] || 0;
    const allTeams = ApiService.getTeams?.() || [];
    const source = roleLevel >= ROLE_LEVEL_MAP.admin
      ? allTeams
      : this._getFriendlyResponsibleTeams(currentUser);
    const teams = [];
    const seen = new Set();

    source.forEach(team => {
      const safeId = String(team?.id || '').trim();
      if (!safeId || seen.has(safeId)) return;
      seen.add(safeId);
      teams.push(team);
    });

    const safeSelectedId = String(selectedId || '').trim();
    if (safeSelectedId && !seen.has(safeSelectedId)) {
      const selectedTeam = allTeams.find(team => team.id === safeSelectedId);
      if (selectedTeam) teams.push(selectedTeam);
    }
    return teams;
  },

  _ensureTournamentFieldNote(row, noteClass, text) {
    if (!row) return null;
    let note = row.querySelector(`.${noteClass}`);
    if (!note) {
      note = document.createElement('div');
      note.className = `ce-field-note ${noteClass}`;
      row.appendChild(note);
    }
    note.textContent = text;
    return note;
  },

  _ensureTournamentHostRow(prefix) {
    const p = prefix || 'ct';
    let select = document.getElementById(`${p}-host-team`);
    if (select) return select;

    const typeSelect = document.getElementById(`${p}-type`);
    const typeRow = typeSelect?.closest('.ce-row');
    if (!typeRow || !typeRow.parentElement) return null;

    const hostRow = document.createElement('div');
    hostRow.className = 'ce-row';
    hostRow.innerHTML = `
      <label>主辦球隊 <span class="required">*</span></label>
      <select id="${p}-host-team"></select>
      <div id="${p}-host-team-summary" class="ce-field-note"></div>
    `;
    typeRow.insertAdjacentElement('afterend', hostRow);
    select = hostRow.querySelector('select');
    select.addEventListener('change', () => this._updateTournamentHostTeamSummary(p));
    return select;
  },

  _renderTournamentHostTeamOptions(prefix, selectedId = '', options = {}) {
    const p = prefix || 'ct';
    const { locked = false } = options;
    const select = this._ensureTournamentHostRow(p);
    if (!select) return;

    const teams = this._getTournamentSelectableHostTeams(selectedId);
    const safeSelectedId = String(selectedId || '').trim();
    select.innerHTML = teams.length
      ? teams.map(team => `<option value="${escapeHTML(team.id)}">${escapeHTML(team.name)}</option>`).join('')
      : '<option value="">目前沒有可選擇的主辦球隊</option>';

    if (safeSelectedId && teams.some(team => team.id === safeSelectedId)) {
      select.value = safeSelectedId;
    } else if (teams.length > 0) {
      select.value = teams[0].id;
    } else {
      select.value = '';
    }

    select.disabled = locked || teams.length === 0;
    this._updateTournamentHostTeamSummary(p, { locked });
  },

  _updateTournamentHostTeamSummary(prefix, options = {}) {
    const p = prefix || 'ct';
    const { locked = false } = options;
    const select = document.getElementById(`${p}-host-team`);
    const summary = document.getElementById(`${p}-host-team-summary`);
    if (!select || !summary) return;

    const team = ApiService.getTeam?.(select.value);
    const actor = ApiService.getCurrentUser?.();
    const actorName = actor?.displayName || actor?.name || '';
    if (!team) {
      summary.textContent = '請先選擇主辦球隊。';
      return;
    }

    const organizerText = this._buildTournamentOrganizerDisplay(team.name, actorName);
    summary.textContent = locked
      ? `主辦顯示：${organizerText}｜主辦球隊建立後暫不開放更換。`
      : `主辦顯示：${organizerText}`;
  },

  _getTournamentFeeFormNodes(prefix) {
    const p = prefix || 'ct';
    return {
      row: document.getElementById(`${p}-fee`)?.closest('.ce-row') || null,
      toggle: document.getElementById(`${p}-fee-enabled`),
      wrap: document.getElementById(`${p}-fee-input-wrap`),
      input: document.getElementById(`${p}-fee`),
    };
  },

  _updateTournamentFeeToggle(prefix) {
    const { toggle, wrap, input } = this._getTournamentFeeFormNodes(prefix);
    if (!toggle || !wrap || !input) return;

    const enabled = !!toggle.checked;
    if (enabled) {
      if ((parseInt(input.value, 10) || 0) <= 0) input.value = '300';
      wrap.style.display = '';
      input.disabled = false;
      return;
    }

    wrap.style.display = 'none';
    input.disabled = true;
  },

  _setTournamentFeeFormState(prefix, enabled, feeValue = '300') {
    const { toggle, input } = this._getTournamentFeeFormNodes(prefix);
    if (toggle) toggle.checked = !!enabled;
    if (input) {
      const normalized = Number(feeValue);
      input.value = Number.isFinite(normalized) && normalized > 0 ? String(Math.floor(normalized)) : '300';
    }
    this._updateTournamentFeeToggle(prefix);
  },

  _ensureTournamentFeeToggle(prefix) {
    const p = prefix || 'ct';
    const row = document.getElementById(`${p}-fee`)?.closest('.ce-row');
    if (!row || row.querySelector(`#${p}-fee-enabled`)) return;

    const currentValue = parseInt(document.getElementById(`${p}-fee`)?.value, 10) || 0;
    row.innerHTML = `
      <label>報名費</label>
      <div class="ce-fee-toggle-wrap">
        <div class="ce-fee-toggle-header">
          <label for="${p}-fee-enabled" class="ce-fee-title">費用 ($)</label>
          <label class="toggle-switch">
            <input type="checkbox" id="${p}-fee-enabled">
            <span class="slider"></span>
          </label>
        </div>
        <div id="${p}-fee-input-wrap" class="ce-fee-input-wrap" style="display:none">
          <input type="number" id="${p}-fee" value="${currentValue > 0 ? currentValue : 300}" min="0" inputmode="numeric" placeholder="300">
        </div>
      </div>
    `;

    row.querySelector(`#${p}-fee-enabled`)?.addEventListener('change', () => this._updateTournamentFeeToggle(p));
  },

  _ensureTournamentFormLayout(prefix) {
    const p = prefix || 'ct';
    const modalId = p === 'ct' ? 'create-tournament-modal' : 'edit-tournament-modal';
    const form = document.querySelector(`#${modalId} .ce-form`);
    if (!form) return;

    this._refreshTournamentCenterCreateButton();

    const uploadRow = document.getElementById(`${p}-upload-area`)?.closest('.ce-row');
    if (uploadRow && form.firstElementChild !== uploadRow) {
      form.insertBefore(uploadRow, form.firstElementChild);
    }

    const typeSelect = document.getElementById(`${p}-type`);
    if (typeSelect) {
      typeSelect.innerHTML = `
        <option value="friendly">友誼賽</option>
        <option value="cup">盃賽（預留）</option>
        <option value="league">聯賽（預留）</option>
      `;
      typeSelect.value = 'friendly';
      typeSelect.disabled = true;
      typeSelect.classList.add('ce-static-select');
      this._ensureTournamentFieldNote(typeSelect.closest('.ce-row'), `tournament-mode-note-${p}`, '第一階段先開放友誼賽，盃賽與聯賽欄位位置先保留。');
    }

    this._ensureTournamentHostRow(p);
    this._ensureTournamentFeeToggle(p);

    const teamsInput = document.getElementById(`${p}-teams`);
    if (teamsInput) {
      teamsInput.value = '4';
      teamsInput.readOnly = true;
      teamsInput.classList.add('ce-readonly-input');
      this._ensureTournamentFieldNote(teamsInput.closest('.ce-row'), `tournament-team-limit-note-${p}`, '第一階段固定 4 隊，資料結構已保留後續擴充空間。');
    }
  },

  _resetTournamentImagePreview(prefix, content = false) {
    const preview = document.getElementById(content ? `${prefix}-content-upload-preview` : `${prefix}-upload-preview`);
    if (!preview) return;
    preview.classList.remove('has-image');
    if (content) {
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">上傳賽事內容圖片</span><span class="ce-upload-hint">建議尺寸 800 x 600 px，JPG / PNG，檔案上限 2MB</span>';
      return;
    }
    preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">上傳賽事封面圖片</span><span class="ce-upload-hint">建議尺寸 800 x 300 px，JPG / PNG，檔案上限 2MB</span>';
  },

  _buildTournamentHostEntry(team, actor) {
    if (!team) return null;
    return {
      teamId: team.id,
      teamName: team.name || '',
      teamImage: team.image || '',
      entryStatus: 'host',
      approvedAt: new Date().toISOString(),
      approvedByUid: actor?.uid || '',
      approvedByName: actor?.displayName || actor?.name || '',
      memberRoster: [],
    };
  },

  openCreateTournamentModal() {
    if (!this._canCreateFriendlyTournament()) {
      this.showToast('目前只有擁有球隊的領隊或經理可以建立友誼賽。');
      return;
    }

    this._ensureTournamentFormLayout('ct');
    const hostTeams = this._getTournamentSelectableHostTeams();
    if (hostTeams.length === 0) {
      this.showToast('目前沒有可代表建立賽事的主辦球隊。');
      return;
    }

    this._ctDelegates = [];
    this._ctVenues = [];
    this._ctMatchDates = [];
    document.getElementById('ct-name').value = '';
    document.getElementById('ct-region').value = '';
    document.getElementById('ct-reg-start').value = '';
    document.getElementById('ct-reg-end').value = '';
    document.getElementById('ct-desc').value = '';
    document.getElementById('ct-desc-count').textContent = '0/500';
    document.getElementById('ct-teams').value = '4';
    document.getElementById('ct-match-date-picker').value = '';
    document.getElementById('ct-venue-input').value = '';
    document.getElementById('ct-delegate-search').value = '';
    this._renderTournamentHostTeamOptions('ct', hostTeams[0]?.id || '');
    this._setTournamentFeeFormState('ct', false, 300);
    this._renderVenueTags('ct');
    this._renderMatchDateTags('ct');
    this._renderTournamentDelegateTags('ct');
    this._updateTournamentDelegateInput('ct');
    this._resetTournamentImagePreview('ct');
    this._resetTournamentImagePreview('ct', true);
    this._initTournamentDelegateSearch('ct');
    this.showModal('create-tournament-modal');
  },

  async handleCreateTournament() {
    const createUser = ApiService.getCurrentUser?.();
    if (!this._canCreateFriendlyTournament(createUser)) {
      this.showToast('目前只有擁有球隊的領隊或經理可以建立友誼賽。');
      return;
    }

    const createName = document.getElementById('ct-name').value.trim();
    const createRegStart = document.getElementById('ct-reg-start').value || null;
    const createRegEnd = document.getElementById('ct-reg-end').value || null;
    const createDesc = document.getElementById('ct-desc').value.trim();
    const createRegion = document.getElementById('ct-region').value.trim();
    const createFeeEnabled = !!document.getElementById('ct-fee-enabled')?.checked;
    const createFeeInput = parseInt(document.getElementById('ct-fee').value, 10) || 0;
    const createFee = createFeeEnabled ? Math.max(0, createFeeInput) : 0;
    const hostTeamId = document.getElementById('ct-host-team')?.value || '';
    const hostTeam = ApiService.getTeam?.(hostTeamId);
    const createMatchDates = [...this._ctMatchDates];
    const createVenues = [...this._ctVenues];
    const createDelegates = [...this._ctDelegates];

    if (!createName) {
      this.showToast('請輸入賽事名稱。');
      return;
    }
    if (!hostTeam) {
      this.showToast('請先選擇主辦球隊。');
      return;
    }
    if (!createRegStart || !createRegEnd) {
      this.showToast('請填寫完整的報名開始與截止時間。');
      return;
    }

    const createCoverPreview = document.getElementById('ct-upload-preview');
    const createCoverImage = createCoverPreview?.querySelector('img')?.src || null;
    const createContentPreview = document.getElementById('ct-content-upload-preview');
    const createContentImage = createContentPreview?.querySelector('img')?.src || null;
    const createCreatorName = createUser?.displayName || createUser?.name || '使用者';
    const createCreatorUid = createUser?.uid || 'demo-user';
    const hostEntry = this._buildTournamentHostEntry(hostTeam, createUser);
    const createData = {
      id: 'ct_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name: createName,
      type: this._getTournamentModeLabel('friendly'),
      typeCode: 'friendly',
      mode: 'friendly',
      teams: 4,
      maxTeams: 4,
      teamLimit: 4,
      matches: 3,
      region: createRegion,
      regStart: createRegStart,
      regEnd: createRegEnd,
      matchDates: createMatchDates,
      description: createDesc,
      image: createCoverImage,
      contentImage: createContentImage,
      venues: createVenues,
      feeEnabled: createFeeEnabled,
      fee: createFee,
      delegates: createDelegates,
      delegateUids: createDelegates.map(delegate => delegate.uid).filter(Boolean),
      organizer: createCreatorName,
      creatorName: createCreatorName,
      creatorUid: createCreatorUid,
      hostTeamId: hostTeam.id,
      hostTeamName: hostTeam.name || '',
      hostTeamImage: hostTeam.image || '',
      organizerDisplay: this._buildTournamentOrganizerDisplay(hostTeam.name, createCreatorName),
      registeredTeams: hostEntry ? [hostTeam.id] : [],
      teamEntries: hostEntry ? [hostEntry] : [],
      teamApplications: [],
      friendlyConfig: {
        teamLimit: 4,
        allowMemberSelfJoin: true,
        pendingVisibleToThirdParty: false,
      },
      ended: false,
      gradient: GRADIENT_MAP?.friendly || 'linear-gradient(135deg,#0d9488,#065f46)',
    };
    createData.status = this.getTournamentStatus(createData);

    try {
      await ApiService.createTournamentAwait(createData);
    } catch (err) {
      this._showTournamentActionError?.('建立賽事', err);
      return;
    }
    ApiService._writeOpLog('tourn_create', '建立賽事', `建立「${createName}」`);
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.closeModal();
    this.showToast(`賽事「${createName}」已建立。`);

    document.getElementById('ct-name').value = '';
    document.getElementById('ct-region').value = '';
    document.getElementById('ct-reg-start').value = '';
    document.getElementById('ct-reg-end').value = '';
    document.getElementById('ct-desc').value = '';
    document.getElementById('ct-desc-count').textContent = '0/500';
    document.getElementById('ct-teams').value = '4';
    document.getElementById('ct-match-date-picker').value = '';
    document.getElementById('ct-venue-input').value = '';
    document.getElementById('ct-delegate-search').value = '';
    this._ctMatchDates = [];
    this._ctVenues = [];
    this._ctDelegates = [];
    this._renderMatchDateTags('ct');
    this._renderVenueTags('ct');
    this._renderTournamentDelegateTags('ct');
    this._updateTournamentDelegateInput('ct');
    this._renderTournamentHostTeamOptions('ct');
    this._setTournamentFeeFormState('ct', false, 300);
    this._resetTournamentImagePreview('ct');
    this._resetTournamentImagePreview('ct', true);
  },

  // ══════════════════════════════════
  //  Edit Tournament
  // ══════════════════════════════════

  _editTournamentId: null,

  showEditTournament(id) {
    const editRecord = this.getFriendlyTournamentRecord?.(ApiService.getTournament(id));
    if (!editRecord) return;
    if (!this._canManageTournamentRecord(editRecord)) {
      this.showToast('你目前只能編輯主辦或受委託的賽事。');
      return;
    }

    this._editTournamentId = id;
    this._ensureTournamentFormLayout('et');
    document.getElementById('et-name').value = editRecord.name || '';
    document.getElementById('et-type').value = 'friendly';
    document.getElementById('et-teams').value = this._getFriendlyTournamentTeamLimit?.(editRecord) || 4;
    document.getElementById('et-region').value = editRecord.region || '';
    document.getElementById('et-reg-start').value = editRecord.regStart || '';
    document.getElementById('et-reg-end').value = editRecord.regEnd || '';
    document.getElementById('et-desc').value = editRecord.description || '';
    document.getElementById('et-desc-count').textContent = `${(editRecord.description || '').length}/500`;
    document.getElementById('et-match-date-picker').value = '';
    document.getElementById('et-venue-input').value = '';
    document.getElementById('et-delegate-search').value = '';
    this._etVenues = [...(editRecord.venues || [])];
    this._etDelegates = [...(editRecord.delegates || [])];
    this._etMatchDates = [...(editRecord.matchDates || [])];
    this._renderVenueTags('et');
    this._renderTournamentDelegateTags('et');
    this._updateTournamentDelegateInput('et');
    this._initTournamentDelegateSearch('et');
    this._renderMatchDateTags('et');
    this._renderTournamentHostTeamOptions('et', editRecord.hostTeamId || '', { locked: !!editRecord.hostTeamId });
    this._setTournamentFeeFormState('et', editRecord.feeEnabled, editRecord.fee || 300);

    const coverPreviewEl = document.getElementById('et-upload-preview');
    if (editRecord.image && coverPreviewEl) {
      coverPreviewEl.innerHTML = `<img src="${editRecord.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      coverPreviewEl.classList.add('has-image');
    } else {
      this._resetTournamentImagePreview('et');
    }

    const contentPreviewEl = document.getElementById('et-content-upload-preview');
    if (editRecord.contentImage && contentPreviewEl) {
      contentPreviewEl.innerHTML = `<img src="${editRecord.contentImage}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      contentPreviewEl.classList.add('has-image');
    } else {
      this._resetTournamentImagePreview('et', true);
    }

    this.showModal('edit-tournament-modal');
  },

  async handleSaveEditTournament() {
    const editId = this._editTournamentId;
    const editTournament = this.getFriendlyTournamentRecord?.(ApiService.getTournament(editId));
    if (!editTournament) return;
    if (!this._canManageTournamentRecord(editTournament)) {
      this.showToast('你目前只能編輯主辦或受委託的賽事。');
      return;
    }

    const editName = document.getElementById('et-name').value.trim();
    const editRegion = document.getElementById('et-region').value.trim();
    const editRegStart = document.getElementById('et-reg-start').value || null;
    const editRegEnd = document.getElementById('et-reg-end').value || null;
    const editDescription = document.getElementById('et-desc').value.trim();
    const editFeeEnabled = !!document.getElementById('et-fee-enabled')?.checked;
    const editFeeInput = parseInt(document.getElementById('et-fee').value, 10) || 0;
    const editFee = editFeeEnabled ? Math.max(0, editFeeInput) : 0;
    const hostTeamId = document.getElementById('et-host-team')?.value || '';
    const hostTeam = ApiService.getTeam?.(hostTeamId);
    if (!editName) {
      this.showToast('請輸入賽事名稱。');
      return;
    }
    if (!hostTeam) {
      this.showToast('請先選擇主辦球隊。');
      return;
    }
    if (editTournament.hostTeamId && hostTeam.id !== editTournament.hostTeamId) {
      this.showToast('主辦球隊建立後暫不開放更換。');
      return;
    }
    if (!editRegStart || !editRegEnd) {
      this.showToast('請填寫完整的報名開始與截止時間。');
      return;
    }

    const editVenues = [...this._etVenues];
    const editDelegates = [...this._etDelegates];
    const editMatchDates = [...this._etMatchDates];
    const editCoverPreview = document.getElementById('et-upload-preview');
    const editImage = editCoverPreview?.querySelector('img')?.src || editTournament.image || null;
    const editContentPreview = document.getElementById('et-content-upload-preview');
    const editContentImage = editContentPreview?.querySelector('img')?.src || editTournament.contentImage || null;
    const editUser = ApiService.getCurrentUser?.();
    const editCreatorName = editTournament.creatorName || editTournament.organizer || editUser?.displayName || editUser?.name || '使用者';
    const editUpdates = {
      name: editName,
      type: this._getTournamentModeLabel('friendly'),
      typeCode: 'friendly',
      mode: 'friendly',
      teams: 4,
      maxTeams: 4,
      teamLimit: 4,
      region: editRegion,
      regStart: editRegStart,
      regEnd: editRegEnd,
      description: editDescription,
      matches: 3,
      venues: editVenues,
      delegates: editDelegates,
      delegateUids: editDelegates.map(delegate => delegate.uid).filter(Boolean),
      matchDates: editMatchDates,
      image: editImage,
      contentImage: editContentImage,
      feeEnabled: editFeeEnabled,
      fee: editFee,
      organizer: editTournament.organizer || editCreatorName,
      creatorName: editCreatorName,
      hostTeamId: editTournament.hostTeamId || hostTeam.id,
      hostTeamName: editTournament.hostTeamName || hostTeam.name || '',
      hostTeamImage: editTournament.hostTeamImage || hostTeam.image || '',
      organizerDisplay: this._buildTournamentOrganizerDisplay(editTournament.hostTeamName || hostTeam.name, editCreatorName),
      friendlyConfig: {
        teamLimit: 4,
        allowMemberSelfJoin: true,
        pendingVisibleToThirdParty: false,
      },
    };

    if (!editTournament.hostTeamId && (!Array.isArray(editTournament.teamEntries) || editTournament.teamEntries.length === 0) && (!Array.isArray(editTournament.registeredTeams) || editTournament.registeredTeams.length === 0)) {
      const hostEntry = this._buildTournamentHostEntry(hostTeam, editUser);
      if (hostEntry) {
        editUpdates.teamEntries = [hostEntry];
        editUpdates.registeredTeams = [hostTeam.id];
      }
    }

    editUpdates.status = this.getTournamentStatus({ ...editTournament, ...editUpdates });
    try {
      await ApiService.updateTournamentAwait(editId, editUpdates);
    } catch (err) {
      this._showTournamentActionError?.('更新賽事', err);
      return;
    }
    ApiService._writeOpLog('tourn_edit', '編輯賽事', `更新「${editName}」`);
    this._editTournamentId = null;
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.closeModal();
    this.showToast(`賽事「${editName}」已更新。`);
  },

  // ══════════════════════════════════
  //  End / Reopen Tournament
  // ══════════════════════════════════

  async handleEndTournament(id) {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.admin) {
      this.showToast('權限不足'); return;
    }
    const t = ApiService.getTournament(id);
    if (!t) return;
    if (!(await this.appConfirm(`確定要結束賽事「${t.name}」？`))) return;
    try {
      await ApiService.updateTournamentAwait(id, { ended: true });
    } catch (err) {
      this._showTournamentActionError?.('結束賽事', err);
      return;
    }
    ApiService._writeOpLog('tourn_end', '結束賽事', `結束「${t.name}」`);
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.showToast(`賽事「${t.name}」已結束`);
  },

  async handleReopenTournament(id) {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.admin) {
      this.showToast('權限不足'); return;
    }
    const t = ApiService.getTournament(id);
    if (!t) return;
    if (!(await this.appConfirm(`確定要重新開放賽事「${t.name}」？`))) return;
    try {
      await ApiService.updateTournamentAwait(id, { ended: false });
    } catch (err) {
      this._showTournamentActionError?.('重新開放賽事', err);
      return;
    }
    ApiService._writeOpLog('tourn_reopen', '重開賽事', `重開「${t.name}」`);
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.showToast(`賽事「${t.name}」已重新開放`);
  },

  async handleDeleteTournament(id) {
    const t = ApiService.getTournament(id);
    if (!t) return;
    if (ROLE_LEVEL_MAP[this.currentRole] < ROLE_LEVEL_MAP['admin']) {
      this.showToast('僅管理員可刪除賽事');
      return;
    }
    if (!(await this.appConfirm(`確定要永久刪除賽事「${t.name}」？此操作無法復原。`))) return;
    const tName = t.name;
    ApiService.deleteTournament(id);
    ApiService._writeOpLog('tourn_delete', '刪除賽事', `刪除「${tName}」`);
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.showToast(`已刪除賽事「${tName}」`);
  },

});
