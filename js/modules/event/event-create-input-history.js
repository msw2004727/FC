/* === SportHub — Event Create: Input History (localStorage) === */
/* innerHTML uses escapeHTML() for all user-supplied values        */

Object.assign(App, {

  _inputHistoryKey() { return 'sporthub_input_history_' + ModeManager.getMode(); },

  _getInputHistory(key) {
    try {
      const all = JSON.parse(localStorage.getItem(this._inputHistoryKey()) || '{}');
      return Array.isArray(all[key]) ? all[key] : [];
    } catch { return []; }
  },

  _saveInputHistory(key, value) {
    if (value === undefined || value === null || value === '') return;
    const strVal = String(value).trim();
    if (!strVal) return;
    try {
      const all = JSON.parse(localStorage.getItem(this._inputHistoryKey()) || '{}');
      let arr = Array.isArray(all[key]) ? all[key] : [];
      arr = arr.filter(v => v !== strVal);
      arr.unshift(strVal);
      if (arr.length > 5) arr = arr.slice(0, 5);
      all[key] = arr;
      localStorage.setItem(this._inputHistoryKey(), JSON.stringify(all));
    } catch {}
  },

  _renderHistoryChips(key, inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    let container = input.nextElementSibling;
    if (!container || !container.classList.contains('input-history-chips')) {
      container = document.createElement('div');
      container.className = 'input-history-chips';
      input.parentNode.insertBefore(container, input.nextSibling);
    }
    const history = this._getInputHistory(key);
    if (history.length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';
    container.innerHTML = history.map(v =>
      `<span class="input-history-chip" data-value="${escapeHTML(v)}">${escapeHTML(v)}</span>`
    ).join('');
    container.querySelectorAll('.input-history-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        input.value = chip.dataset.value;
        if (input.type === 'number') input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  },

  _saveRecentDelegates(delegates) {
    if (!Array.isArray(delegates) || delegates.length === 0) return;
    try {
      const all = JSON.parse(localStorage.getItem(this._inputHistoryKey()) || '{}');
      let arr = Array.isArray(all['recent-delegates']) ? all['recent-delegates'] : [];
      delegates.forEach(d => {
        arr = arr.filter(e => e.uid !== d.uid);
        arr.unshift({ uid: d.uid, name: d.name });
      });
      if (arr.length > 10) arr = arr.slice(0, 10);
      all['recent-delegates'] = arr;
      localStorage.setItem(this._inputHistoryKey(), JSON.stringify(all));
    } catch {}
  },

  _getRecentDelegates() {
    try {
      const all = JSON.parse(localStorage.getItem(this._inputHistoryKey()) || '{}');
      return Array.isArray(all['recent-delegates']) ? all['recent-delegates'] : [];
    } catch { return []; }
  },

  _renderRecentDelegateChips(containerId, prefix) {
    const tagsContainer = document.getElementById(containerId);
    if (!tagsContainer) return;
    const wrapperId = containerId + '-recent-wrap';
    let wrapper = document.getElementById(wrapperId);
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.id = wrapperId;
      wrapper.className = 'input-history-chips';
      wrapper.style.marginBottom = '.3rem';
      tagsContainer.parentNode.insertBefore(wrapper, tagsContainer);
    }
    const recent = this._getRecentDelegates();
    const currentDelegates = prefix === 'ct' || prefix === 'et'
      ? (prefix === 'et' ? this._etDelegates : this._ctDelegates)
      : this._delegates;
    const selectedUids = currentDelegates.map(d => d.uid);
    const available = recent.filter(d => !selectedUids.includes(d.uid));
    if (available.length === 0) { wrapper.style.display = 'none'; return; }
    wrapper.style.display = '';
    wrapper.innerHTML = '<span style="font-size:.65rem;color:var(--text-muted);margin-right:.15rem">最近使用：</span>' +
      available.map(d =>
        `<span class="input-history-chip" data-uid="${escapeHTML(d.uid)}" data-name="${escapeHTML(d.name)}">${escapeHTML(d.name)}</span>`
      ).join('');
    wrapper.querySelectorAll('.input-history-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const uid = chip.dataset.uid;
        const name = chip.dataset.name;
        if (prefix === 'ct' || prefix === 'et') {
          this._addTournamentDelegate(uid, name, prefix);
        } else {
          this._addDelegate(uid, name);
        }
        this._renderRecentDelegateChips(containerId, prefix);
      });
    });
  },

});
