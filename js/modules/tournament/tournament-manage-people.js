/* === SportHub — Tournament People Pickers (delegates / referees) === */

Object.assign(App, {

  _tournamentPersonPickerConfig: {
    delegate: {
      stateKey: 'delegates',
      suffix: 'delegate',
      limit: 10,
      removeMethod: '_removeTournamentDelegate',
    },
    referee: {
      stateKey: 'referees',
      suffix: 'referee',
      limit: 10,
      removeMethod: '_removeTournamentReferee',
    },
  },

  _getTournamentPersonPickerConfig(kind) {
    return this._tournamentPersonPickerConfig[kind] || this._tournamentPersonPickerConfig.delegate;
  },

  _initTournamentPersonSearch(kind, prefix) {
    const p = prefix || 'tf';
    const cfg = this._getTournamentPersonPickerConfig(kind);
    const input = document.getElementById(`${p}-${cfg.suffix}-search`);
    const dropdown = document.getElementById(`${p}-${cfg.suffix}-dropdown`);
    if (!input || !dropdown) return;

    const boundKey = `${p}:${cfg.suffix}`;
    if (this._tournamentFormState.personSearchBound[boundKey]) {
      this._renderTournamentPersonTags(kind, p);
      this._updateTournamentPersonInput(kind, p);
      return;
    }
    this._tournamentFormState.personSearchBound[boundKey] = true;

    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (q.length < 1) { dropdown.classList.remove('open'); dropdown.innerHTML = ''; return; }
      this._searchTournamentPeople(q, kind, p);
    });
    input.addEventListener('blur', () => {
      setTimeout(() => { dropdown.classList.remove('open'); }, 200);
    });
    input.addEventListener('focus', () => {
      const q = input.value.trim();
      if (q.length >= 1) this._searchTournamentPeople(q, kind, p);
    });

    this._renderTournamentPersonTags(kind, p);
    this._updateTournamentPersonInput(kind, p);
  },

  _searchTournamentPeople(query, kind, prefix) {
    const p = prefix || 'tf';
    const cfg = this._getTournamentPersonPickerConfig(kind);
    const dropdown = document.getElementById(`${p}-${cfg.suffix}-dropdown`);
    if (!dropdown) return;
    const q = query.toLowerCase();
    const selected = this._tournamentFormState[cfg.stateKey] || [];
    const selectedUids = selected.map(item => item.uid);

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
        return `<div class="ce-delegate-item" data-uid="${escapeHTML(u.uid)}" data-name="${escapeHTML(u.name)}">
          <span class="ce-delegate-item-name">${escapeHTML(u.name)}</span>
          <span class="ce-delegate-item-meta">${escapeHTML(u.uid)} · ${escapeHTML(roleLabel)}</span>
        </div>`;
      }).join('');

      dropdown.querySelectorAll('.ce-delegate-item').forEach(item => {
        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          this._addTournamentPerson(kind, item.dataset.uid, item.dataset.name, p);
          document.getElementById(`${p}-${cfg.suffix}-search`).value = '';
          dropdown.classList.remove('open');
        });
      });
    }
    dropdown.classList.add('open');
  },

  _addTournamentPerson(kind, uid, name, prefix) {
    const cfg = this._getTournamentPersonPickerConfig(kind);
    const list = this._tournamentFormState[cfg.stateKey] || [];
    if (list.length >= cfg.limit) return;
    if (list.some(item => item.uid === uid)) return;
    list.push({ uid, name });
    this._tournamentFormState[cfg.stateKey] = list;
    const p = prefix || 'tf';
    this._renderTournamentPersonTags(kind, p);
    this._updateTournamentPersonInput(kind, p);
  },

  _removeTournamentPerson(kind, uid, prefix) {
    const cfg = this._getTournamentPersonPickerConfig(kind);
    this._tournamentFormState[cfg.stateKey] = (this._tournamentFormState[cfg.stateKey] || []).filter(item => item.uid !== uid);
    const p = prefix || 'tf';
    this._renderTournamentPersonTags(kind, p);
    this._updateTournamentPersonInput(kind, p);
  },

  _renderTournamentPersonTags(kind, prefix) {
    const p = prefix || 'tf';
    const cfg = this._getTournamentPersonPickerConfig(kind);
    const container = document.getElementById(`${p}-${cfg.suffix}-tags`);
    if (!container) return;
    const users = ApiService.getAdminUsers?.() || [];
    container.innerHTML = (this._tournamentFormState[cfg.stateKey] || []).map(item => {
      const u = users.find(user => user.uid === item.uid);
      const role = u?.role || 'user';
      return `<span class="ce-delegate-tag">${this._userTag(item.name, role)}<span class="ce-delegate-remove" data-uid="${escapeHTML(item.uid)}" onclick="App.${cfg.removeMethod}(this.dataset.uid,'${p}')">✕</span></span>`;
    }).join('');
  },

  _updateTournamentPersonInput(kind, prefix) {
    const p = prefix || 'tf';
    const cfg = this._getTournamentPersonPickerConfig(kind);
    const input = document.getElementById(`${p}-${cfg.suffix}-search`);
    if (!input) return;
    const count = (this._tournamentFormState[cfg.stateKey] || []).length;
    input.disabled = count >= cfg.limit;
    input.placeholder = count >= cfg.limit ? `已達上限 ${cfg.limit} 人` : '搜尋 UID 或暱稱...';
  },

  _initTournamentDelegateSearch(prefix) { this._initTournamentPersonSearch('delegate', prefix); },
  _addTournamentDelegate(uid, name, prefix) { this._addTournamentPerson('delegate', uid, name, prefix); },
  _removeTournamentDelegate(uid, prefix) { this._removeTournamentPerson('delegate', uid, prefix); },
  _renderTournamentDelegateTags(prefix) { this._renderTournamentPersonTags('delegate', prefix); },
  _updateTournamentDelegateInput(prefix) { this._updateTournamentPersonInput('delegate', prefix); },

  _initTournamentRefereeSearch(prefix) { this._initTournamentPersonSearch('referee', prefix); },
  _addTournamentReferee(uid, name, prefix) { this._addTournamentPerson('referee', uid, name, prefix); },
  _removeTournamentReferee(uid, prefix) { this._removeTournamentPerson('referee', uid, prefix); },
  _renderTournamentRefereeTags(prefix) { this._renderTournamentPersonTags('referee', prefix); },
  _updateTournamentRefereeInput(prefix) { this._updateTournamentPersonInput('referee', prefix); },

});
