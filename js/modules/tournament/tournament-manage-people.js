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
    refereeHead: {
      stateKey: 'refereeHeads',
      suffix: 'referee-head',
      limit: 1,
      removeMethod: '_removeTournamentRefereeHead',
    },
  },
  _tournamentPersonSearchSeq: Object.create(null),

  _getTournamentPersonPickerConfig(kind) {
    return this._tournamentPersonPickerConfig[kind] || this._tournamentPersonPickerConfig.delegate;
  },

  _captureTournamentPersonPickerContext(kind, prefix) {
    return {
      kind: String(kind || ''),
      prefix: String(prefix || 'tf'),
      generation: Number(this._tournamentFormGeneration || 0),
      mode: String(this._tournamentFormMode || ''),
      editId: String(this._tournamentFormEditId || ''),
      authUid: String(ApiService.getCurrentUser?.()?.uid || ''),
      modal: document.getElementById('tournament-form-modal') || null,
    };
  },

  _isTournamentPersonPickerContextCurrent(context) {
    if (!context) return false;
    if (Number(this._tournamentFormGeneration || 0) !== context.generation) return false;
    if (String(this._tournamentFormMode || '') !== context.mode) return false;
    if (String(this._tournamentFormEditId || '') !== context.editId) return false;
    if (String(ApiService.getCurrentUser?.()?.uid || '') !== context.authUid) return false;
    const modal = document.getElementById('tournament-form-modal');
    return modal === context.modal && !!modal?.classList?.contains('open');
  },

  _initTournamentPersonSearch(kind, prefix) {
    const p = prefix || 'tf';
    const cfg = this._getTournamentPersonPickerConfig(kind);
    const input = document.getElementById(`${p}-${cfg.suffix}-search`);
    const dropdown = document.getElementById(`${p}-${cfg.suffix}-dropdown`);
    if (!input || !dropdown) return;
    void ApiService.ensureUserDirectoryReady?.();

    const boundKey = `${p}:${cfg.suffix}`;
    if (this._tournamentFormState.personSearchBound[boundKey]) {
      this._renderTournamentPersonTags(kind, p);
      this._updateTournamentPersonInput(kind, p);
      return;
    }
    this._tournamentFormState.personSearchBound[boundKey] = true;

    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (q.length < 1) {
        this._tournamentPersonSearchSeq[boundKey] = (this._tournamentPersonSearchSeq[boundKey] || 0) + 1;
        dropdown.classList.remove('open');
        dropdown.innerHTML = '';
        return;
      }
      void this._searchTournamentPeople(q, kind, p);
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        this._tournamentPersonSearchSeq[boundKey] = (this._tournamentPersonSearchSeq[boundKey] || 0) + 1;
        dropdown.classList.remove('open');
      }, 200);
    });
    input.addEventListener('focus', () => {
      const q = input.value.trim();
      if (q.length >= 1) void this._searchTournamentPeople(q, kind, p);
    });

    this._renderTournamentPersonTags(kind, p);
    this._updateTournamentPersonInput(kind, p);
  },

  async _searchTournamentPeople(query, kind, prefix, options = {}) {
    const p = prefix || 'tf';
    const cfg = this._getTournamentPersonPickerConfig(kind);
    const boundKey = `${p}:${cfg.suffix}`;
    const pickerContext = options.pickerContext || this._captureTournamentPersonPickerContext(kind, p);
    if (!this._isTournamentPersonPickerContextCurrent(pickerContext)) return;
    const requestSeq = Number(options.requestSeq) || ((this._tournamentPersonSearchSeq[boundKey] || 0) + 1);
    this._tournamentPersonSearchSeq[boundKey] = requestSeq;
    const dropdown = document.getElementById(`${p}-${cfg.suffix}-dropdown`);
    if (!dropdown) return;
    const q = query.toLowerCase();
    const selected = this._tournamentFormState[cfg.stateKey] || [];
    const selectedUids = selected.map(item => item.uid);

    const allUsers = ApiService.getUserDirectory?.() || [];
    const hasCachedUsers = allUsers.length > 0;
    const results = allUsers.filter(u => {
      if (selectedUids.includes(u.uid)) return false;
      return (u.name || '').toLowerCase().includes(q) || (u.uid || '').toLowerCase().includes(q);
    }).slice(0, 5);

    if (results.length === 0 && options.skipRefresh !== true) {
      dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">\u8f09\u5165\u7528\u6236\u8cc7\u6599\u2026</div>';
      if (hasCachedUsers) dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">\u6b63\u5728\u66f4\u65b0\u7528\u6236\u8cc7\u6599\u2026</div>';
    } else if (results.length === 0) {
      dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">找不到符合的用戶</div>';
    } else {
      const roleLabels = typeof ROLES !== 'undefined' ? ROLES : {};
      dropdown.innerHTML = results.map(u => {
        const roleLabel = roleLabels[u.role]?.label || u.role || '';
        const uidLabel = this._formatUidForDisplay ? this._formatUidForDisplay(u.uid) : u.uid;
        const metaParts = [uidLabel, roleLabel].filter(Boolean).map(part => escapeHTML(part));
        return `<div class="ce-delegate-item" data-uid="${escapeHTML(u.uid)}" data-name="${escapeHTML(u.name)}">
          <span class="ce-delegate-item-name">${escapeHTML(u.name)}</span>
          <span class="ce-delegate-item-meta">${metaParts.join(' · ')}</span>
        </div>`;
      }).join('');

      dropdown.querySelectorAll('.ce-delegate-item').forEach(item => {
        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          void this._addTournamentPerson(kind, item.dataset.uid, item.dataset.name, p, { requestSeq, query: q, pickerContext })
            .then(added => {
              if (!added) return;
              const input = document.getElementById(p + '-' + cfg.suffix + '-search');
              if (input) input.value = '';
              this._tournamentPersonSearchSeq[boundKey] = requestSeq + 1;
              dropdown.classList.remove('open');
            });
        });
      });
    }
    dropdown.classList.add('open');
    if (options.skipRefresh === true) return;

    let directoryReady = allUsers.length > 0;
    try {
      if (typeof ApiService.ensureUserDirectoryReady === 'function') {
        directoryReady = await ApiService.ensureUserDirectoryReady();
      }
    } catch (err) {
      console.warn('[Tournament] people directory load failed:', err);
      directoryReady = false;
    }

    const input = document.getElementById(`${p}-${cfg.suffix}-search`);
    const modal = document.getElementById('tournament-form-modal');
    if (requestSeq !== this._tournamentPersonSearchSeq[boundKey]
      || !this._isTournamentPersonPickerContextCurrent(pickerContext)
      || String(input?.value || '').trim().toLowerCase() !== q
      || !modal?.classList.contains('open')) return;

    const refreshedUsers = ApiService.getUserDirectory?.() || [];
    const hasRefreshedMatch = refreshedUsers.some(u => {
      if (selectedUids.includes(u.uid)) return false;
      return (u.name || '').toLowerCase().includes(q) || (u.uid || '').toLowerCase().includes(q);
    });
    if (!directoryReady && !hasRefreshedMatch) {
      dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">\u7528\u6236\u8cc7\u6599\u8f09\u5165\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u91cd\u8a66</div>';
      dropdown.classList.add('open');
      return;
    }
    return this._searchTournamentPeople(query, kind, p, { skipRefresh: true, requestSeq, pickerContext });
  },

  async _addTournamentPerson(kind, uid, name, prefix, options = {}) {
    const cfg = this._getTournamentPersonPickerConfig(kind);
    const safeUid = String(uid || '').trim();
    const p = prefix || 'tf';
    const boundKey = p + ':' + cfg.suffix;
    const pickerContext = options.pickerContext || this._captureTournamentPersonPickerContext(kind, p);
    if (!this._isTournamentPersonPickerContextCurrent(pickerContext)) return false;
    const list = this._tournamentFormState[cfg.stateKey] || [];
    if (!safeUid || list.length >= cfg.limit || list.some(item => item.uid === safeUid)) return false;

    const input = document.getElementById(p + '-' + cfg.suffix + '-search');
    const requestSeq = Number.isFinite(Number(options.requestSeq))
      ? Number(options.requestSeq)
      : (this._tournamentPersonSearchSeq[boundKey] || 0);
    const query = String(options.query ?? input?.value ?? '').trim().toLowerCase();
    const verification = await ApiService.verifyUserDirectorySelection?.([safeUid]);
    const modal = document.getElementById('tournament-form-modal');
    if (requestSeq !== (this._tournamentPersonSearchSeq[boundKey] || 0)
      || !this._isTournamentPersonPickerContextCurrent(pickerContext)
      || String(input?.value || '').trim().toLowerCase() !== query
      || !modal?.classList.contains('open')) return false;

    const match = verification?.users?.find(user => user.uid === safeUid);
    if (!verification?.ok || !match) {
      this.showToast(verification?.reason === 'missing-users'
        ? '\u6b64\u7528\u6236\u76ee\u524d\u7121\u6cd5\u9078\u53d6\uff0c\u8acb\u91cd\u65b0\u641c\u5c0b'
        : '\u7528\u6236\u9a57\u8b49\u5931\u6557\uff0c\u8acb\u6aa2\u67e5\u7db2\u8def\u5f8c\u518d\u8a66');
      return false;
    }
    const currentList = this._tournamentFormState[cfg.stateKey] || [];
    if (currentList.length >= cfg.limit || currentList.some(item => item.uid === safeUid)) return false;
    currentList.push({ uid: match.uid, name: match.name });
    this._tournamentFormState[cfg.stateKey] = currentList;
    this._renderTournamentPersonTags(kind, p);
    this._updateTournamentPersonInput(kind, p);
    return true;
  },

  async _verifyTournamentPeopleForSubmit(submitContext = null) {
    const isCurrent = () => !submitContext || this._isTournamentSubmitCurrent?.(submitContext) === true;
    if (!isCurrent()) return false;
    const stateKeys = ['delegates', 'referees', 'refereeHeads'];
    const requestedPeopleSignature = JSON.stringify(stateKeys.map(key =>
      (this._tournamentFormState[key] || [])
        .map(person => String(person?.uid || '').trim())
        .filter(Boolean)));
    const requestedUids = [...new Set(JSON.parse(requestedPeopleSignature).flat())];
    if (requestedUids.length === 0) return true;

    const verification = await ApiService.verifyUserDirectorySelection?.(requestedUids);
    if (!isCurrent()) return false;
    const currentPeopleSignature = JSON.stringify(stateKeys.map(key =>
      (this._tournamentFormState[key] || [])
        .map(person => String(person?.uid || '').trim())
        .filter(Boolean)));
    if (currentPeopleSignature !== requestedPeopleSignature) {
      this.showToast('\u8cfd\u4e8b\u4eba\u54e1\u540d\u55ae\u5df2\u8b8a\u66f4\uff0c\u8acb\u91cd\u65b0\u9001\u51fa');
      return false;
    }
    if (!verification?.ok || verification.users?.length !== requestedUids.length) {
      this.showToast(verification?.reason === 'missing-users'
        ? '\u8cfd\u4e8b\u4eba\u54e1\u8cc7\u6599\u5df2\u5931\u6548\uff0c\u8acb\u91cd\u65b0\u9078\u64c7\u5f8c\u518d\u9001\u51fa'
        : '\u7121\u6cd5\u9a57\u8b49\u8cfd\u4e8b\u4eba\u54e1\uff0c\u8acb\u6aa2\u67e5\u7db2\u8def\u5f8c\u518d\u8a66');
      return false;
    }
    const freshByUid = new Map(verification.users.map(user => [user.uid, user]));
    stateKeys.forEach(key => {
      (this._tournamentFormState[key] || []).forEach(person => {
        const fresh = freshByUid.get(String(person?.uid || '').trim());
        if (fresh) person.name = fresh.name;
      });
    });
    return true;
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
    const users = ApiService.getUserDirectory?.() || [];
    container.innerHTML = (this._tournamentFormState[cfg.stateKey] || []).map(item => {
      const u = users.find(user => user.uid === item.uid);
      const role = u?.role || 'user';
      return `<span class="ce-delegate-tag">${this._userTag(item.name, role)}<span class="ce-delegate-remove" role="button" tabindex="0" data-tournament-person-uid="${escapeHTML(String(item.uid || ''))}">✕</span></span>`;
    }).join('');
    container.querySelectorAll('[data-tournament-person-uid]').forEach(button => {
      const remove = () => this._removeTournamentPerson(kind, button.dataset.tournamentPersonUid, p);
      button.addEventListener('click', remove);
      button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          remove();
        }
      });
    });
  },

  _updateTournamentPersonInput(kind, prefix) {
    const p = prefix || 'tf';
    const cfg = this._getTournamentPersonPickerConfig(kind);
    const input = document.getElementById(`${p}-${cfg.suffix}-search`);
    if (!input) return;
    const count = (this._tournamentFormState[cfg.stateKey] || []).length;
    input.disabled = count >= cfg.limit;
    input.placeholder = count >= cfg.limit ? `已達上限 ${cfg.limit} 人` : '搜尋用戶...';
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

  _initTournamentRefereeHeadSearch(prefix) { this._initTournamentPersonSearch('refereeHead', prefix); },
  _removeTournamentRefereeHead(uid, prefix) { this._removeTournamentPerson('refereeHead', uid, prefix); },
  _renderTournamentRefereeHeadTags(prefix) { this._renderTournamentPersonTags('refereeHead', prefix); },
  _updateTournamentRefereeHeadInput(prefix) { this._updateTournamentPersonInput('refereeHead', prefix); },

});
