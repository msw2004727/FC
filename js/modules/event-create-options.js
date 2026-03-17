/* === SportHub — Event Create: Fee, Gender, Reg Open Time === */
/* innerHTML uses escapeHTML() for all user-supplied values                */

Object.assign(App, {

  // ── Event Fee ──

  _getEventFeeFormNodes() {
    return {
      toggle: document.getElementById('ce-fee-enabled'),
      wrap: document.getElementById('ce-fee-input-wrap'),
      input: document.getElementById('ce-fee'),
    };
  },

  _updateEventFeeToggle() {
    const { toggle, wrap, input } = this._getEventFeeFormNodes();
    if (!toggle || !wrap || !input) return;

    const enabled = !!toggle.checked;
    if (enabled) {
      if ((parseInt(input.value, 10) || 0) <= 0) input.value = '0';
      wrap.style.display = '';
      input.disabled = false;
      return;
    }

    wrap.style.display = 'none';
    input.disabled = true;
  },

  _setEventFeeFormState(enabled, feeValue = '0') {
    const { toggle, input } = this._getEventFeeFormNodes();
    if (input) {
      const normalized = Number(feeValue);
      input.value = Number.isFinite(normalized) && normalized > 0 ? String(Math.floor(normalized)) : '0';
    }
    if (toggle) toggle.checked = !!enabled;
    this._updateEventFeeToggle();
  },

  bindEventFeeToggle() {
    const { toggle } = this._getEventFeeFormNodes();
    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = '1';
      toggle.addEventListener('change', () => this._updateEventFeeToggle());
    }
    this._updateEventFeeToggle();
  },

  // ── Gender Restriction ──

  _normalizeAllowedGender(value) {
    return value === '男' || value === '女' ? value : '';
  },

  _getAllowedGenderValue() {
    const hidden = document.getElementById('ce-allowed-gender');
    return this._normalizeAllowedGender(hidden?.value || '');
  },

  _setGenderRestrictionValue(value) {
    const hidden = document.getElementById('ce-allowed-gender');
    const normalized = this._normalizeAllowedGender(value);
    if (hidden) hidden.value = normalized;
    document.querySelectorAll('#ce-gender-restriction-options .ce-gender-chip').forEach(btn => {
      const isActive = btn.dataset.value === normalized;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    this._updateGenderRestrictionUI();
  },

  _setGenderRestrictionState(enabled, value = '') {
    const toggle = document.getElementById('ce-gender-restriction-enabled');
    if (toggle) toggle.checked = !!enabled;
    this._setGenderRestrictionValue(enabled ? value : '');
  },

  _updateGenderRestrictionUI() {
    const toggle = document.getElementById('ce-gender-restriction-enabled');
    const label = document.getElementById('ce-gender-restriction-label');
    const options = document.getElementById('ce-gender-restriction-options');
    const enabled = !!toggle?.checked;
    const allowedGender = this._getAllowedGenderValue();

    if (options) options.style.display = enabled ? 'flex' : 'none';
    if (!label) return;

    if (!enabled) {
      label.textContent = '關閉 — 不限制性別';
      label.style.color = 'var(--text-muted)';
      return;
    }

    if (!allowedGender) {
      label.textContent = '已開啟 — 請選擇限定性別';
      label.style.color = 'var(--warning)';
      return;
    }

    label.textContent = allowedGender === '男' ? '已開啟 — 僅限男性報名' : '已開啟 — 僅限女性報名';
    label.style.color = '#dc2626';
  },

  bindGenderRestrictionToggle() {
    const toggle = document.getElementById('ce-gender-restriction-enabled');
    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = '1';
      toggle.addEventListener('change', () => {
        if (!toggle.checked) {
          this._setGenderRestrictionValue('');
          return;
        }
        this._updateGenderRestrictionUI();
      });
    }

    document.querySelectorAll('#ce-gender-restriction-options .ce-gender-chip').forEach(btn => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        if (!document.getElementById('ce-gender-restriction-enabled')?.checked) return;
        this._setGenderRestrictionValue(btn.dataset.value || '');
      });
    });

    this._updateGenderRestrictionUI();
  },

  // ── Registration Open Time ──

  _getEventRegOpenNodes() {
    return {
      date: document.getElementById('ce-reg-open-date'),
      time: document.getElementById('ce-reg-open-clock'),
    };
  },

  _normalizeEventRegOpenTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return { date: '', time: '' };

    const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
    if (match) return { date: match[1], time: match[2] };

    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) return { date: '', time: '' };

    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const min = String(parsed.getMinutes()).padStart(2, '0');
    return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
  },

  _setEventRegOpenTimeValue(value = '') {
    const { date, time } = this._getEventRegOpenNodes();
    const normalized = this._normalizeEventRegOpenTime(value);
    if (date) date.value = normalized.date;
    if (time) time.value = normalized.time;
  },

  _getEventRegOpenTimeValue() {
    const { date, time } = this._getEventRegOpenNodes();
    const dateVal = date?.value || '';
    const timeVal = time?.value || '';
    if (!dateVal && !timeVal) return '';
    if (!dateVal || !timeVal) return null;
    return `${dateVal}T${timeVal}`;
  },

});
