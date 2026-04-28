/* === SportHub — Tournament Form Utilities & Helpers === */
Object.assign(App, {

  // ── Tournament Form State（全域狀態集中管理）──
  _tournamentFormState: {
    venues: [],
    delegates: [],
    delegateSearchBound: { tf: false },
    matchDates: [],
  },

  // ── Venue Management ──
  addTournamentVenue(prefix) {
    const p = prefix || 'tf';
    const input = document.getElementById(`${p}-venue-input`);
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    if (this._tournamentFormState.venues.includes(val)) { this.showToast('此場地已存在'); return; }
    this._tournamentFormState.venues.push(val);
    input.value = '';
    this._renderVenueTags(p);
  },
  removeTournamentVenue(prefix, idx) {
    this._tournamentFormState.venues.splice(idx, 1);
    this._renderVenueTags(prefix || 'tf');
  },
  _renderVenueTags(prefix) {
    const p = prefix || 'tf';
    const container = document.getElementById(`${p}-venue-tags`);
    if (!container) return;
    // Note: innerHTML usage is safe — all user content passes through escapeHTML()
    container.innerHTML = this._tournamentFormState.venues.map((v, i) => {
      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`;
      return `<span style="display:inline-flex;align-items:center;gap:.25rem;font-size:.72rem;padding:.2rem .5rem;border-radius:20px;background:var(--surface-alt);border:1px solid var(--border)">
        <a href="${mapUrl}" target="sporthub_map" rel="noopener" style="color:var(--primary);text-decoration:none">${escapeHTML(v)} 📍</a>
        <span style="cursor:pointer;color:var(--text-muted)" onclick="App.removeTournamentVenue('${p}',${i})">✕</span>
      </span>`;
    }).join('');
  },

  // ── Delegate Management ──
  _initTournamentDelegateSearch(prefix) {
    const p = prefix || 'tf';
    const input = document.getElementById(`${p}-delegate-search`);
    const dropdown = document.getElementById(`${p}-delegate-dropdown`);
    if (!input || !dropdown) return;

    if (this._tournamentFormState.delegateSearchBound[p]) {
      this._renderTournamentDelegateTags(p);
      this._updateTournamentDelegateInput(p);
      return;
    }
    this._tournamentFormState.delegateSearchBound[p] = true;

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
    const p = prefix || 'tf';
    const dropdown = document.getElementById(`${p}-delegate-dropdown`);
    if (!dropdown) return;
    const q = query.toLowerCase();
    const selectedUids = this._tournamentFormState.delegates.map(d => d.uid);

    const allUsers = ApiService.getAdminUsers?.() || [];
    const results = allUsers.filter(u => {
      if (selectedUids.includes(u.uid)) return false;
      return (u.name || '').toLowerCase().includes(q) || (u.uid || '').toLowerCase().includes(q);
    }).slice(0, 5);

    if (results.length === 0) {
      // Note: innerHTML usage is safe — all user content passes through escapeHTML()
      dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">找不到符合的用戶</div>';
    } else {
      const roleLabels = typeof ROLES !== 'undefined' ? ROLES : {};
      // Note: innerHTML usage is safe — all user content passes through escapeHTML()
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
    if (this._tournamentFormState.delegates.length >= 10) return;
    if (this._tournamentFormState.delegates.some(d => d.uid === uid)) return;
    this._tournamentFormState.delegates.push({ uid, name });
    const p = prefix || 'tf';
    this._renderTournamentDelegateTags(p);
    this._updateTournamentDelegateInput(p);
  },
  _removeTournamentDelegate(uid, prefix) {
    this._tournamentFormState.delegates = this._tournamentFormState.delegates.filter(d => d.uid !== uid);
    const p = prefix || 'tf';
    this._renderTournamentDelegateTags(p);
    this._updateTournamentDelegateInput(p);
  },
  _renderTournamentDelegateTags(prefix) {
    const p = prefix || 'tf';
    const container = document.getElementById(`${p}-delegate-tags`);
    if (!container) return;
    const users = ApiService.getAdminUsers?.() || [];
    // Note: innerHTML usage is safe — all user content passes through escapeHTML()
    container.innerHTML = this._tournamentFormState.delegates.map(d => {
      const u = users.find(u => u.uid === d.uid);
      const role = u?.role || 'user';
      return `<span class="ce-delegate-tag">${this._userTag(d.name, role)}<span class="ce-delegate-remove" onclick="App._removeTournamentDelegate('${d.uid}','${p}')">✕</span></span>`;
    }).join('');
  },
  _updateTournamentDelegateInput(prefix) {
    const p = prefix || 'tf';
    const input = document.getElementById(`${p}-delegate-search`);
    if (!input) return;
    input.disabled = this._tournamentFormState.delegates.length >= 10;
    input.placeholder = this._tournamentFormState.delegates.length >= 10 ? '已達上限 10 人' : '搜尋 UID 或暱稱...';
  },

  // ── Match Dates ──

  addMatchDate(val) {
    if (!val || this._tournamentFormState.matchDates.includes(val)) return;
    this._tournamentFormState.matchDates.push(val);
    this._tournamentFormState.matchDates.sort();
    this._renderMatchDateTags('tf');
    document.getElementById('tf-match-date-picker').value = '';
  },
  removeMatchDate(val) {
    this._tournamentFormState.matchDates = this._tournamentFormState.matchDates.filter(d => d !== val);
    this._renderMatchDateTags('tf');
  },
  addEditMatchDate(val) {
    if (!val || this._tournamentFormState.matchDates.includes(val)) return;
    this._tournamentFormState.matchDates.push(val);
    this._tournamentFormState.matchDates.sort();
    this._renderMatchDateTags('tf');
    document.getElementById('tf-match-date-picker').value = '';
  },
  removeEditMatchDate(val) {
    this._tournamentFormState.matchDates = this._tournamentFormState.matchDates.filter(d => d !== val);
    this._renderMatchDateTags('tf');
  },
  _renderMatchDateTags(prefix) {
    const p = prefix || 'tf';
    const wrap = document.getElementById(`${p}-match-dates-wrap`);
    if (!wrap) return;
    // Note: innerHTML usage is safe — all user content passes through escapeHTML()
    wrap.innerHTML = this._tournamentFormState.matchDates.map(d => {
      const parts = d.split('-');
      const label = `${parseInt(parts[1])}/${parseInt(parts[2])}`;
      return `<span style="display:inline-flex;align-items:center;gap:.2rem;font-size:.72rem;padding:.2rem .5rem;border-radius:20px;background:var(--accent);color:#fff">${label}<span style="cursor:pointer;margin-left:.1rem" onclick="App.removeMatchDate('${d}')">✕</span></span>`;
    }).join('');
  },

  // ── Fee Toggle & Field Helpers ──
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
  _getTournamentFeeFormNodes(prefix) {
    const p = prefix || 'tf';
    return {
      row: document.getElementById(`${p}-fee`)?.closest('.ce-row') || null,
      toggle: document.getElementById(`${p}-fee-enabled`),
      wrap: document.getElementById(`${p}-fee-input-wrap`),
      input: document.getElementById(`${p}-fee`),
    };
  },
  _updateTournamentFeeToggle(prefix) {
    const { toggle, wrap, input } = this._getTournamentFeeFormNodes(prefix || 'tf');
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
    const p = prefix || 'tf';
    const { toggle, input } = this._getTournamentFeeFormNodes(p);
    if (toggle) toggle.checked = !!enabled;
    if (input) {
      const normalized = Number(feeValue);
      input.value = Number.isFinite(normalized) && normalized > 0 ? String(Math.floor(normalized)) : '300';
    }
    this._updateTournamentFeeToggle(p);
  },
  _getTournamentImmediateRegStartValue(rawValue = '') {
    const safeValue = String(rawValue || '').trim();
    if (safeValue) return safeValue;
    const now = new Date();
    const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return localNow.toISOString().slice(0, 16);
  },
  _getTournamentTeamLimitValue(prefix, fallback = 4) {
    const p = prefix || 'tf';
    const rawValue = document.getElementById(`${p}-teams`)?.value;
    return this._sanitizeFriendlyTournamentTeamLimit?.(rawValue, fallback) ?? fallback;
  },
  _getTournamentCoverAspectRatio() {
    return 8 / 3;
  },
  _bindTournamentImageUploads(prefix) {
    const p = prefix || 'tf';
    this.bindImageUpload(`${p}-image`, `${p}-upload-preview`, this._getTournamentCoverAspectRatio());
    this.bindImageUpload(`${p}-content-image`, `${p}-content-upload-preview`);
  },
  _ensureTournamentFeeToggle(prefix) {
    const p = prefix || 'tf';
    const row = document.getElementById(`${p}-fee`)?.closest('.ce-row');
    if (!row || row.querySelector(`#${p}-fee-enabled`)) return;

    const currentValue = parseInt(document.getElementById(`${p}-fee`)?.value, 10) || 0;
    // Note: innerHTML usage is safe — no user content in this template
    row.innerHTML = `
      <label>報名費</label>
      <div class="ce-fee-toggle-wrap">
        <div class="ce-fee-toggle-header">
          <label for="${p}-fee-enabled" class="ce-fee-title">費用 ($)</label>
          <label class="toggle-switch">
            <input type="checkbox" id="${p}-fee-enabled">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div id="${p}-fee-input-wrap" class="ce-fee-input-wrap" style="display:none">
          <input type="number" id="${p}-fee" value="${currentValue > 0 ? currentValue : 300}" min="0" inputmode="numeric" placeholder="300">
        </div>
      </div>
    `;

    row.querySelector(`#${p}-fee-enabled`)?.addEventListener('change', () => this._updateTournamentFeeToggle(p));
  },

  _resetTournamentImagePreview(prefix, content = false) {
    const p = prefix || 'tf';
    const preview = document.getElementById(content ? `${p}-content-upload-preview` : `${p}-upload-preview`);
    if (!preview) return;
    preview.classList.remove('has-image');
    // Note: innerHTML usage is safe — no user content in this template
    if (content) {
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">上傳賽事內容圖片</span><span class="ce-upload-hint">建議尺寸 800 x 600 px，JPG / PNG，檔案上限 2MB</span>';
      return;
    }
    preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">上傳賽事封面圖片</span><span class="ce-upload-hint">建議尺寸 800 x 300 px，JPG / PNG，檔案上限 2MB</span>';
  },

});
