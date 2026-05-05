/* === SportHub — Event Create: Delegate Search & Management === */
/* innerHTML uses escapeHTML() for all user-supplied values        */

Object.assign(App, {

  _delegates: [],
  _delegateSearchBound: false,

  _canCurrentEditManageDelegates() {
    const eventRecord = this._editEventId ? ApiService.getEvent(this._editEventId) : null;
    return !!this._canManageEventDelegates?.(eventRecord || null);
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

    if (!this._delegateSearchBound) {
      this._delegateSearchBound = true;

      input.addEventListener('input', () => {
        const q = input.value.trim();
        if (q.length < 1) { dropdown.classList.remove('open'); dropdown.innerHTML = ''; return; }
        this._searchDelegates(q);
      });

      input.addEventListener('blur', () => {
        setTimeout(() => { dropdown.classList.remove('open'); }, 200);
      });

      input.addEventListener('focus', () => {
        const q = input.value.trim();
        if (q.length >= 1) this._searchDelegates(q);
      });
    }

    this._renderDelegateTags();
    this._updateDelegateInput();
  },

  _searchDelegates(query) {
    const dropdown = document.getElementById('ce-delegate-dropdown');
    if (!dropdown) return;
    if (!this._canCurrentEditManageDelegates()) {
      dropdown.classList.remove('open');
      dropdown.innerHTML = '';
      return;
    }
    const q = query.toLowerCase();
    const myUid = this._getEventCreatorUid();
    const selectedUids = this._delegates.map(d => d.uid);

    const allUsers = ApiService.getAdminUsers?.() || [];
    const results = allUsers.filter(u => {
      if (u.uid === myUid) return false;
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
          this._addDelegate(item.dataset.uid, item.dataset.name);
          document.getElementById('ce-delegate-search').value = '';
          dropdown.classList.remove('open');
        });
      });
    }
    dropdown.classList.add('open');
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
    input.placeholder = this._delegates.length >= 3 ? '已達上限 3 人' : '搜尋 UID 或暱稱...';
  },

});
