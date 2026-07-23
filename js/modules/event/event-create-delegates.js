/* === SportHub — Event Create: Delegate Search & Management === */
/* innerHTML uses escapeHTML() for all user-supplied values        */

Object.assign(App, {

  _delegates: [],
  _delegateSearchBound: false,
  _delegateSearchSeq: 0,

  _canCurrentEditManageDelegates() {
    const eventRecord = this._editEventId ? ApiService.getEvent(this._editEventId) : null;
    return !!this._canManageEventDelegates?.(eventRecord || null);
  },

  _getEventDelegateDirectoryName(user) {
    return String(user?.displayName || '').trim()
      || String(user?.name || '').trim()
      || String(user?.uid || '').trim();
  },

  _eventDelegateMatchesDirectoryQuery(user, query) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    return [user?.displayName, user?.name, user?.uid]
      .some(value => String(value || '').toLowerCase().includes(normalizedQuery));
  },

  _initDelegateSearch() {
    const input = document.getElementById('ce-delegate-search');
    const dropdown = document.getElementById('ce-delegate-dropdown');
    if (!input || !dropdown) return;
    const canManageDelegates = this._canCurrentEditManageDelegates();
    input.disabled = !canManageDelegates || this._delegates.length >= 3;
    if (!canManageDelegates) {
      dropdown.classList.remove('open');
      dropdown.innerHTML = '';
    }
    if (canManageDelegates) void ApiService.ensureUserDirectoryReady?.({ force: true });

    if (!this._delegateSearchBound) {
      this._delegateSearchBound = true;

      input.addEventListener('input', () => {
        const q = input.value.trim();
        if (q.length < 1) {
          this._delegateSearchSeq += 1;
          dropdown.classList.remove('open');
          dropdown.innerHTML = '';
          return;
        }
        void this._searchDelegates(q);
      });

      input.addEventListener('blur', () => {
        setTimeout(() => {
          this._delegateSearchSeq += 1;
          dropdown.classList.remove('open');
        }, 200);
      });

      input.addEventListener('focus', () => {
        const q = input.value.trim();
        if (q.length >= 1) void this._searchDelegates(q);
      });
    }

    this._renderDelegateTags();
    this._updateDelegateInput();
  },

  async _searchDelegates(query, options = {}) {
    const dropdown = document.getElementById('ce-delegate-dropdown');
    if (!dropdown) return;
    const requestSeq = Number(options.requestSeq) || ++this._delegateSearchSeq;
    const formSession = options.formSession || this._eventFormSession || null;
    if (!this._canCurrentEditManageDelegates()) {
      dropdown.classList.remove('open');
      dropdown.innerHTML = '';
      return;
    }
    const q = query.toLowerCase();
    const myUid = this._getEventCreatorUid();
    const selectedUids = this._delegates.map(d => d.uid);

    const allUsers = ApiService.getUserDirectory?.() || [];
    const hasCachedUsers = allUsers.length > 0;
    const results = allUsers.filter(u => {
      if (u.uid === myUid) return false;
      if (selectedUids.includes(u.uid)) return false;
      return this._eventDelegateMatchesDirectoryQuery(u, q);
    }).slice(0, 5);

    if (results.length === 0 && options.skipRefresh !== true) {
      dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">\u8f09\u5165\u7528\u6236\u8cc7\u6599\u2026</div>';
      if (hasCachedUsers) dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">\u6b63\u5728\u66f4\u65b0\u7528\u6236\u8cc7\u6599\u2026</div>';
    } else if (results.length === 0) {
      dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">找不到符合的用戶</div>';
    } else {
      const roleLabels = typeof ROLES !== 'undefined' ? ROLES : {};
      dropdown.innerHTML = results.map(u => {
        const displayName = this._getEventDelegateDirectoryName(u);
        const roleLabel = roleLabels[u.role]?.label || u.role || '';
        const uidLabel = this._formatUidForDisplay ? this._formatUidForDisplay(u.uid) : u.uid;
        const metaParts = [uidLabel, roleLabel].filter(Boolean).map(part => escapeHTML(part));
        return `<div class="ce-delegate-item" data-uid="${escapeHTML(u.uid)}" data-name="${escapeHTML(displayName)}">
          <span class="ce-delegate-item-name">${escapeHTML(displayName)}</span>
          <span class="ce-delegate-item-meta">${metaParts.join(' · ')}</span>
        </div>`;
      }).join('');

      dropdown.querySelectorAll('.ce-delegate-item').forEach(item => {
        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          void this._addDelegate(item.dataset.uid, item.dataset.name, { requestSeq, query: q, formSession })
            .then(added => {
              if (!added) return;
              const input = document.getElementById('ce-delegate-search');
              if (input) input.value = '';
              this._delegateSearchSeq = requestSeq + 1;
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
      console.warn('[EventCreate] delegate directory load failed:', err);
      directoryReady = false;
    }

    const input = document.getElementById('ce-delegate-search');
    const modal = document.getElementById('create-event-modal');
    if (requestSeq !== this._delegateSearchSeq
      || (formSession && !this._isEventFormSubmitSessionCurrent?.(formSession))
      || String(input?.value || '').trim().toLowerCase() !== q
      || !modal?.classList.contains('open')) return;

    const refreshedUsers = ApiService.getUserDirectory?.() || [];
    const hasRefreshedMatch = refreshedUsers.some(u => {
      if (u.uid === myUid || selectedUids.includes(u.uid)) return false;
      return this._eventDelegateMatchesDirectoryQuery(u, q);
    });
    if (!directoryReady && !hasRefreshedMatch) {
      dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">\u7528\u6236\u8cc7\u6599\u8f09\u5165\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u91cd\u8a66</div>';
      dropdown.classList.add('open');
      return;
    }
    return this._searchDelegates(query, { skipRefresh: true, requestSeq, formSession });
  },

  async _addDelegate(uid, name, options = {}) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) return false;
    if (!this._canCurrentEditManageDelegates()) {
      this.showToast('\u6b0a\u9650\u4e0d\u8db3');
      return false;
    }
    if (this._delegates.length >= 3) return false;
    if (this._delegates.some(d => d.uid === safeUid)) return false;

    const input = document.getElementById('ce-delegate-search');
    const requestSeq = Number.isFinite(Number(options.requestSeq))
      ? Number(options.requestSeq)
      : this._delegateSearchSeq;
    const query = String(options.query ?? input?.value ?? '').trim().toLowerCase();
    const formSession = options.formSession || this._eventFormSession || null;
    const verification = await ApiService.verifyUserDirectorySelection?.([safeUid]);
    const modal = document.getElementById('create-event-modal');
    if (requestSeq !== this._delegateSearchSeq
      || (formSession && !this._isEventFormSubmitSessionCurrent?.(formSession))
      || String(input?.value || '').trim().toLowerCase() !== query
      || !modal?.classList.contains('open')) return false;

    const match = verification?.users?.find(user => user.uid === safeUid);
    if (!verification?.ok || !match) {
      this.showToast(verification?.reason === 'missing-users'
        ? '\u6b64\u7528\u6236\u76ee\u524d\u7121\u6cd5\u9078\u53d6\uff0c\u8acb\u91cd\u65b0\u641c\u5c0b'
        : '\u7528\u6236\u9a57\u8b49\u5931\u6557\uff0c\u8acb\u6aa2\u67e5\u7db2\u8def\u5f8c\u518d\u8a66');
      return false;
    }
    if (!this._canCurrentEditManageDelegates()) return false;
    if (this._delegates.length >= 3 || this._delegates.some(d => d.uid === safeUid)) return false;
    this._delegates.push({ uid: match.uid, name: this._getEventDelegateDirectoryName(match) });
    this._renderDelegateTags();
    this._updateDelegateInput();
    return true;
  },

  async _verifySelectedEventDelegatesForSubmit(eventRecord = null, options = {}) {
    const submitSession = options.submitSession || null;
    const isCurrent = () => !submitSession || this._isEventFormSubmitSessionCurrent?.(submitSession) === true;
    if (!isCurrent()) return false;
    const canManage = !!this._canManageEventDelegates?.(eventRecord);
    if (!canManage) return true;
    const requestedUids = [...new Set((this._delegates || [])
      .map(delegate => String(delegate?.uid || '').trim())
      .filter(Boolean))];
    if (requestedUids.length === 0) return true;

    const verification = await ApiService.verifyUserDirectorySelection?.(requestedUids);
    if (!isCurrent()) return false;
    const currentUids = [...new Set((this._delegates || [])
      .map(delegate => String(delegate?.uid || '').trim())
      .filter(Boolean))];
    if (currentUids.join('|') !== requestedUids.join('|')) {
      this.showToast('\u59d4\u8a17\u4eba\u540d\u55ae\u5df2\u8b8a\u66f4\uff0c\u8acb\u91cd\u65b0\u9001\u51fa');
      return false;
    }
    if (!verification?.ok || verification.users?.length !== requestedUids.length) {
      this.showToast(verification?.reason === 'missing-users'
        ? '\u59d4\u8a17\u4eba\u8cc7\u6599\u5df2\u5931\u6548\uff0c\u8acb\u91cd\u65b0\u9078\u64c7\u5f8c\u518d\u9001\u51fa'
        : '\u7121\u6cd5\u9a57\u8b49\u59d4\u8a17\u4eba\uff0c\u8acb\u6aa2\u67e5\u7db2\u8def\u5f8c\u518d\u8a66');
      return false;
    }
    const freshByUid = new Map(verification.users.map(user => [user.uid, user]));
    this._delegates = requestedUids.map(uid => ({
      uid,
      name: this._getEventDelegateDirectoryName(freshByUid.get(uid)),
    }));
    this._renderDelegateTags();
    this._updateDelegateInput();
    return true;
  },

  _removeDelegate(uid) {
    if (!this._canCurrentEditManageDelegates()) {
      this.showToast('\u6b0a\u9650\u4e0d\u8db3');
      return;
    }
    this._delegates = this._delegates.filter(d => d.uid !== uid);
    this._renderDelegateTags();
    this._updateDelegateInput();
  },

  _renderDelegateTags() {
    const container = document.getElementById('ce-delegate-tags');
    if (!container) return;
    const users = ApiService.getUserDirectory?.() || [];
    const canManageDelegates = this._canCurrentEditManageDelegates();
    container.innerHTML = this._delegates.map(d => {
      const u = users.find(u => u.uid === d.uid);
      const role = u?.role || 'user';
      const removeHtml = canManageDelegates
        ? `<span class="ce-delegate-remove" role="button" tabindex="0" data-delegate-uid="${escapeHTML(String(d.uid || ''))}" aria-label="移除委託人">✕</span>`
        : '';
      return `<span class="ce-delegate-tag">${this._userTag(d.name, role)}${removeHtml}</span>`;
    }).join('');
    container.querySelectorAll('[data-delegate-uid]').forEach(button => {
      const remove = () => this._removeDelegate(button.dataset.delegateUid);
      button.addEventListener('click', remove);
      button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          remove();
        }
      });
    });
  },

  _updateDelegateInput() {
    const input = document.getElementById('ce-delegate-search');
    if (!input) return;
    const canManageDelegates = this._canCurrentEditManageDelegates();
    input.disabled = !canManageDelegates || this._delegates.length >= 3;
    if (!canManageDelegates) {
      input.placeholder = '\u7121\u6b0a\u8a2d\u5b9a\u59d4\u8a17\u4eba';
      return;
    }
    input.placeholder = this._delegates.length >= 3 ? '已達上限 3 人' : '搜尋用戶...';
  },

});
