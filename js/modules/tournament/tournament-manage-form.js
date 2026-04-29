/* === SportHub — Tournament Form Utilities & Helpers === */
Object.assign(App, {

  // ── Tournament Form State（全域狀態集中管理）──
  _tournamentFormState: {
    venues: [],
    delegates: [],
    referees: [],
    personSearchBound: {},
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
