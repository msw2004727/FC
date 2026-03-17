/* === SportHub — Event Create: Sport Tag Picker === */
/* innerHTML uses escapeHTML() for all user-supplied values */

Object.assign(App, {

  _selectedSportTag: '',
  _sportPickerGlobalBound: false,

  _getSportPickerElements() {
    return {
      picker: document.getElementById('ce-sport-picker'),
      selected: document.getElementById('ce-sport-selected'),
      selectedInner: document.getElementById('ce-sport-selected-inner'),
      dropdown: document.getElementById('ce-sport-dropdown'),
      search: document.getElementById('ce-sport-search'),
      list: document.getElementById('ce-sport-list'),
      hidden: document.getElementById('ce-sport-tag'),
    };
  },

  _setSportTagValue(sportTag) {
    const els = this._getSportPickerElements();
    if (!els.selectedInner || !els.hidden) return;

    const safeKey = getSportKeySafe(sportTag);
    this._selectedSportTag = safeKey || '';
    els.hidden.value = this._selectedSportTag;

    if (!this._selectedSportTag) {
      els.selectedInner.innerHTML = '<span class="ce-sport-placeholder">請選擇運動 / 場景標籤</span>';
      return;
    }

    const label = getSportLabelByKey(this._selectedSportTag);
    els.selectedInner.innerHTML = `<span class="ce-sport-value">${getSportIconSvg(this._selectedSportTag)}<span>${escapeHTML(label)}</span></span>`;
  },

  _toggleSportPicker(open) {
    const els = this._getSportPickerElements();
    if (!els.selected || !els.dropdown) return;
    const shouldOpen = !!open;
    els.selected.classList.toggle('open', shouldOpen);
    els.selected.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    els.dropdown.classList.toggle('open', shouldOpen);
    if (shouldOpen) els.search?.focus();
  },

  _renderSportPickerOptions(keyword = '') {
    const els = this._getSportPickerElements();
    if (!els.list) return;

    const q = String(keyword || '').trim().toLowerCase();
    const options = (Array.isArray(EVENT_SPORT_OPTIONS) ? EVENT_SPORT_OPTIONS : [])
      .filter(item => !q || String(item.label || '').toLowerCase().includes(q));

    if (!options.length) {
      els.list.innerHTML = '<div class="ce-sport-empty">找不到符合的運動</div>';
      return;
    }

    els.list.innerHTML = options.map(item => {
      const active = item.key === this._selectedSportTag;
      return `<button type="button" class="ce-sport-option${active ? ' active' : ''}" data-sport="${escapeHTML(item.key)}" role="option" aria-selected="${active ? 'true' : 'false'}">
        ${getSportIconSvg(item.key)}
        <span>${escapeHTML(item.label)}</span>
      </button>`;
    }).join('');
  },

  _initSportTagPicker(initialSportTag = '') {
    const els = this._getSportPickerElements();
    if (!els.picker || !els.selected || !els.dropdown || !els.search || !els.list || !els.hidden) return;

    this._setSportTagValue(initialSportTag);
    this._renderSportPickerOptions('');
    els.search.value = '';
    this._toggleSportPicker(false);

    if (!els.selected.dataset.bound) {
      els.selected.dataset.bound = '1';
      els.selected.addEventListener('click', () => {
        const isOpen = els.dropdown.classList.contains('open');
        this._toggleSportPicker(!isOpen);
      });
    }

    if (!els.search.dataset.bound) {
      els.search.dataset.bound = '1';
      els.search.addEventListener('input', () => {
        this._renderSportPickerOptions(els.search.value);
      });
      els.search.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') this._toggleSportPicker(false);
      });
    }

    if (!els.list.dataset.bound) {
      els.list.dataset.bound = '1';
      els.list.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.ce-sport-option[data-sport]');
        if (!btn) return;
        this._setSportTagValue(btn.dataset.sport || '');
        this._renderSportPickerOptions(els.search.value);
        this._toggleSportPicker(false);
      });
    }

    if (!this._sportPickerGlobalBound) {
      this._sportPickerGlobalBound = true;
      document.addEventListener('click', (ev) => {
        const currentEls = this._getSportPickerElements();
        if (!currentEls.picker?.contains(ev.target)) {
          this._toggleSportPicker(false);
        }
      });
    }
  },

  _initSportTagPickerForContainer(prefix, initialValue) {
    const picker = document.getElementById(prefix + '-sport-picker');
    const selectedBtn = document.getElementById(prefix + '-sport-selected');
    const selectedInner = document.getElementById(prefix + '-sport-selected-inner');
    const dropdown = document.getElementById(prefix + '-sport-dropdown');
    const searchInput = document.getElementById(prefix + '-sport-search');
    const listEl = document.getElementById(prefix + '-sport-list');
    const hiddenInput = document.getElementById(prefix + '-sport-tag');
    if (!picker || !selectedBtn || !dropdown || !listEl || !hiddenInput) return;

    const renderList = (filter) => {
      const q = (filter || '').toLowerCase();
      listEl.innerHTML = EVENT_SPORT_OPTIONS
        .filter(o => !q || o.label.toLowerCase().includes(q) || o.key.toLowerCase().includes(q))
        .map(o => {
          const icon = typeof SPORT_ICON_MAP !== 'undefined' ? (SPORT_ICON_MAP[o.key] || '') : '';
          const selected = hiddenInput.value === o.key;
          return `<div class="ce-sport-option${selected ? ' selected' : ''}" data-key="${o.key}" role="option">${icon ? icon + ' ' : ''}${escapeHTML(o.label)}</div>`;
        }).join('');

      listEl.querySelectorAll('.ce-sport-option').forEach(opt => {
        opt.addEventListener('click', () => {
          const key = opt.dataset.key;
          hiddenInput.value = key;
          const icon = typeof SPORT_ICON_MAP !== 'undefined' ? (SPORT_ICON_MAP[key] || '') : '';
          const label = EVENT_SPORT_OPTIONS.find(o => o.key === key)?.label || key;
          selectedInner.innerHTML = `${icon ? icon + ' ' : ''}${escapeHTML(label)}`;
          dropdown.classList.remove('open');
          selectedBtn.setAttribute('aria-expanded', 'false');
        });
      });
    };

    selectedBtn.onclick = (ev) => {
      ev.preventDefault();
      const isOpen = dropdown.classList.contains('open');
      dropdown.classList.toggle('open', !isOpen);
      selectedBtn.setAttribute('aria-expanded', String(!isOpen));
      if (!isOpen) {
        renderList('');
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
      }
    };

    if (searchInput) {
      searchInput.oninput = () => renderList(searchInput.value);
    }

    // 點擊外部關閉
    document.addEventListener('click', (ev) => {
      if (!picker.contains(ev.target)) {
        dropdown.classList.remove('open');
        selectedBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // 設定初始值
    if (initialValue) {
      hiddenInput.value = initialValue;
      const icon = typeof SPORT_ICON_MAP !== 'undefined' ? (SPORT_ICON_MAP[initialValue] || '') : '';
      const label = EVENT_SPORT_OPTIONS.find(o => o.key === initialValue)?.label || initialValue;
      selectedInner.innerHTML = `${icon ? icon + ' ' : ''}${escapeHTML(label)}`;
    } else {
      hiddenInput.value = '';
      selectedInner.innerHTML = '<span class="ce-sport-placeholder">請選擇運動 / 場景標籤</span>';
    }

    renderList('');
  },

});
