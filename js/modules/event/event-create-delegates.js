/* === SportHub — Event Create: Delegate Search & Management === */
/* innerHTML uses escapeHTML() for all user-supplied values        */

Object.assign(App, {

  _delegates: [],
  _delegateSearchBound: false,
  _delegateSearchSeq: 0,

  _canCurrentEditManageDelegates() {
    const eventRecord = this._editEventId ? ApiService.getEvent(this._editEventId) : null;
    return !!(this._canManageEventDelegates?.(eventRecord || null)
      || this._canManageCourseLinkedEventDelegates?.(eventRecord || null));
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
    if (canManageDelegates) void ApiService.ensureAdminUsersReady?.();

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
    if (!this._canCurrentEditManageDelegates()) {
      dropdown.classList.remove('open');
      dropdown.innerHTML = '';
      return;
    }
    const q = query.toLowerCase();
    const myUid = this._getEventCreatorUid();
    const selectedUids = this._delegates.map(d => d.uid);

    const allUsers = ApiService.getAdminUsers?.() || [];
    const hasCachedUsers = allUsers.length > 0;
    const results = allUsers.filter(u => {
      if (u.uid === myUid) return false;
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
          this._addDelegate(item.dataset.uid, item.dataset.name);
          document.getElementById('ce-delegate-search').value = '';
          this._delegateSearchSeq += 1;
          dropdown.classList.remove('open');
        });
      });
    }
    dropdown.classList.add('open');
    if (options.skipRefresh === true) return;

    let directoryReady = allUsers.length > 0;
    try {
      if (typeof ApiService.ensureAdminUsersReady === 'function') {
        directoryReady = await ApiService.ensureAdminUsersReady();
      }
    } catch (err) {
      console.warn('[EventCreate] delegate directory load failed:', err);
      directoryReady = false;
    }

    const input = document.getElementById('ce-delegate-search');
    const modal = document.getElementById('create-event-modal');
    if (requestSeq !== this._delegateSearchSeq
      || String(input?.value || '').trim().toLowerCase() !== q
      || !modal?.classList.contains('open')) return;

    const refreshedUsers = ApiService.getAdminUsers?.() || [];
    const hasRefreshedMatch = refreshedUsers.some(u => {
      if (u.uid === myUid || selectedUids.includes(u.uid)) return false;
      return (u.name || '').toLowerCase().includes(q) || (u.uid || '').toLowerCase().includes(q);
    });
    if (!directoryReady && !hasRefreshedMatch) {
      dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">\u7528\u6236\u8cc7\u6599\u8f09\u5165\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u91cd\u8a66</div>';
      dropdown.classList.add('open');
      return;
    }
    return this._searchDelegates(query, { skipRefresh: true, requestSeq });
  },

  _addDelegate(uid, name) {
    if (!this._canCurrentEditManageDelegates()) {
      this.showToast('\u6b0a\u9650\u4e0d\u8db3');
      return;
    }
    if (this._delegates.length >= 3) return;
    if (this._delegates.some(d => d.uid === uid)) return;
    this._delegates.push({ uid, name });
    this._renderDelegateTags();
    this._updateDelegateInput();
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
    const users = ApiService.getAdminUsers?.() || [];
    const canManageDelegates = this._canCurrentEditManageDelegates();
    container.innerHTML = this._delegates.map(d => {
      const u = users.find(u => u.uid === d.uid);
      const role = u?.role || 'user';
      const removeHtml = canManageDelegates ? `<span class="ce-delegate-remove" onclick="App._removeDelegate('${d.uid}')">✕</span>` : '';
      return `<span class="ce-delegate-tag">${this._userTag(d.name, role)}${removeHtml}</span>`;
    }).join('');
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
