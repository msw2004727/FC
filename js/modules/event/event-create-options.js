/* === SportHub — Event Create: Fee, Gender, Reg Open Time === */
/* innerHTML uses escapeHTML() for all user-supplied values                */

Object.assign(App, {

  // ── Event Fee ──

  _isActivityAddonAllowedForCurrentEdit() {
    const eventRecord = this._editEventId ? ApiService.getEvent(this._editEventId) : null;
    return !!this._canUseActivityAddons?.(eventRecord || null);
  },

  _guardActivityAddonToggle(toggle) {
    if (!toggle?.checked) return true;
    if (this._isActivityAddonAllowedForCurrentEdit()) return true;
    toggle.checked = false;
    this._showActivityAddonUpsellToast?.();
    return false;
  },

  _handleReservedActivityAddonClick(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const row = event?.currentTarget?.closest?.('.ce-value-reserved')
      || event?.target?.closest?.('.ce-value-reserved')
      || null;
    const toggle = row?.querySelector?.('input[type="checkbox"]') || null;
    if (toggle) toggle.checked = false;
    this._showActivityAddonUpsellToast?.();
    return false;
  },

  bindReservedActivityAddonToggles() {
    document.querySelectorAll('.ce-value-reserved').forEach(row => {
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-disabled', 'true');
      row.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.checked = false;
        input.setAttribute('aria-disabled', 'true');
      });
      if (row.dataset.reservedAddonBound === '1') return;
      row.dataset.reservedAddonBound = '1';
      row.addEventListener('click', (event) => this._handleReservedActivityAddonClick(event));
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
        this._handleReservedActivityAddonClick(event);
      });
    });
  },

  _getEventFeeFormNodes() {
    return {
      toggle: document.getElementById('ce-fee-enabled'),
      label: document.getElementById('ce-fee-enabled-label'),
      wrap: document.getElementById('ce-fee-input-wrap'),
      input: document.getElementById('ce-fee'),
    };
  },

  _updateEventFeeToggle() {
    const { toggle, label, wrap, input } = this._getEventFeeFormNodes();
    if (!toggle || !wrap || !input) return;

    const enabled = !!toggle.checked;
    if (label) label.textContent = enabled ? '開啟 — 收費活動' : '關閉 — 不收費';
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
      toggle.addEventListener('change', () => {
        this._guardActivityAddonToggle(toggle);
        this._updateEventFeeToggle();
      });
    }
    this._updateEventFeeToggle();
  },

  // ── Age Limit ──

  _getEventAgeLimitFormNodes() {
    return {
      toggle: document.getElementById('ce-age-limit-enabled'),
      label: document.getElementById('ce-age-limit-label'),
      wrap: document.getElementById('ce-min-age-wrap'),
      input: document.getElementById('ce-min-age'),
    };
  },

  _normalizeEventMinAge(value) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized <= 0) return 0;
    return Math.floor(normalized);
  },

  _updateEventAgeLimitUI() {
    const { toggle, label, wrap, input } = this._getEventAgeLimitFormNodes();
    if (!toggle || !input) return;

    const enabled = !!toggle.checked;
    if (!enabled) input.value = '0';
    if (wrap) wrap.style.display = enabled ? '' : 'none';
    input.disabled = !enabled;

    if (!label) return;
    if (!enabled) {
      label.textContent = '關閉 — 不限制年齡';
      label.style.color = 'var(--text-muted)';
      return;
    }

    const minAge = this._normalizeEventMinAge(input.value);
    label.textContent = minAge > 0 ? `已開啟 — ${minAge} 歲以上` : '已開啟 — 請填最低年齡';
    label.style.color = minAge > 0 ? 'var(--accent)' : 'var(--warning)';
  },

  _setEventAgeLimitState(enabled, minAgeValue = 0) {
    const { toggle, input } = this._getEventAgeLimitFormNodes();
    const minAge = this._normalizeEventMinAge(minAgeValue);
    const shouldEnable = !!enabled && minAge > 0;
    if (input) input.value = shouldEnable ? String(minAge) : '0';
    if (toggle) toggle.checked = shouldEnable;
    this._updateEventAgeLimitUI();
  },

  _getEventMinAgeFormValue() {
    const { toggle, input } = this._getEventAgeLimitFormNodes();
    if (toggle && !toggle.checked) return 0;
    return this._normalizeEventMinAge(input?.value);
  },

  bindEventAgeLimitToggle() {
    const { toggle, input } = this._getEventAgeLimitFormNodes();
    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = '1';
      toggle.addEventListener('change', () => this._updateEventAgeLimitUI());
    }
    if (input && !input.dataset.ageLimitBound) {
      input.dataset.ageLimitBound = '1';
      input.addEventListener('input', () => this._updateEventAgeLimitUI());
    }
    this._updateEventAgeLimitUI();
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
        if (!this._guardActivityAddonToggle(toggle)) {
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
        if (!this._isActivityAddonAllowedForCurrentEdit()) {
          this._showActivityAddonUpsellToast?.();
          return;
        }
        this._setGenderRestrictionValue(btn.dataset.value || '');
      });
    });

    this._updateGenderRestrictionUI();
  },

  // ── Private Event ──

  _updatePrivateEventUI() {
    const toggle = document.getElementById('ce-private-event');
    const label = document.getElementById('ce-private-event-label');
    if (!label) return;
    const enabled = !!toggle?.checked;
    label.textContent = enabled ? '已開啟 — 僅限連結可見' : '關閉 — 所有人可見';
    label.style.color = enabled ? '#dc2626' : 'var(--text-muted)';
  },

  _setPrivateEventState(enabled) {
    const toggle = document.getElementById('ce-private-event');
    if (toggle) toggle.checked = !!enabled;
    this._updatePrivateEventUI();
  },

  bindPrivateEventToggle() {
    const toggle = document.getElementById('ce-private-event');
    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = '1';
      toggle.addEventListener('change', () => {
        this._guardActivityAddonToggle(toggle);
        this._updatePrivateEventUI();
      });
    }
    this._updatePrivateEventUI();
  },

  // ── Registration Open Time ──

  _getEventRegOpenNodes() {
    return {
      toggle: document.getElementById('ce-reg-open-enabled'),
      label: document.getElementById('ce-reg-open-enabled-label'),
      fields: document.getElementById('ce-reg-open-fields'),
      absolute: document.getElementById('ce-reg-open-absolute'),
      relative: document.getElementById('ce-reg-open-relative'),
      hint: document.getElementById('ce-reg-open-hint'),
      date: document.getElementById('ce-reg-open-date'),
      time: document.getElementById('ce-reg-open-clock'),
    };
  },

  _isEventRegOpenEnabled() {
    const nodes = this._getEventRegOpenNodes();
    if (nodes.toggle) return !!nodes.toggle.checked;
    return !!(nodes.date?.value || nodes.time?.value);
  },

  _syncEventRegOpenTimeUI(options = {}) {
    const nodes = this._getEventRegOpenNodes();
    const enabled = this._isEventRegOpenEnabled();
    const isMultiDate = typeof this._isMultiDateMode === 'function' && this._isMultiDateMode();

    if (!enabled && options.clear !== false) {
      if (nodes.date) nodes.date.value = '';
      if (nodes.time) nodes.time.value = '';
    }

    if (nodes.label) {
      nodes.label.textContent = enabled ? '指定開放時間' : '立即開放報名';
      nodes.label.style.color = enabled ? 'var(--accent)' : 'var(--text-muted)';
    }
    if (nodes.fields) nodes.fields.hidden = !enabled;
    if (nodes.date) nodes.date.disabled = !enabled || isMultiDate;
    if (nodes.time) nodes.time.disabled = !enabled || isMultiDate;
    if (nodes.absolute) nodes.absolute.style.display = enabled && !isMultiDate ? '' : 'none';
    if (nodes.relative) nodes.relative.style.display = enabled && isMultiDate ? '' : 'none';
    if (nodes.hint) {
      if (!enabled) {
        nodes.hint.textContent = '關閉時建立後立即開放報名；開啟後可指定開放日期與時間。';
      } else if (isMultiDate) {
        nodes.hint.textContent = '每場活動的報名開放時間將依此設定個別計算。';
      } else {
        nodes.hint.textContent = '報名時間未到會顯示「即將開放」，到達時間後自動開放報名。';
      }
    }
    this._updateCreateTimeSummary?.();
  },

  _handleEventRegOpenToggle() {
    const nodes = this._getEventRegOpenNodes();
    if (!nodes.toggle?.checked) {
      if (nodes.date) nodes.date.value = '';
      if (nodes.time) nodes.time.value = '';
      const daysSel = document.getElementById('ce-reg-rel-days');
      const hoursSel = document.getElementById('ce-reg-rel-hours');
      if (daysSel) daysSel.value = '0';
      if (hoursSel) hoursSel.value = '0';
    }
    this._syncEventRegOpenTimeUI({ clear: false });
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
    const nodes = this._getEventRegOpenNodes();
    const { date, time } = nodes;
    const normalized = this._normalizeEventRegOpenTime(value);
    if (nodes.toggle) nodes.toggle.checked = !!(normalized.date && normalized.time);
    if (date) date.value = normalized.date;
    if (time) time.value = normalized.time;
    this._syncEventRegOpenTimeUI?.({ clear: false });
  },

  _getEventRegOpenTimeValue() {
    if (!this._isEventRegOpenEnabled?.()) return '';
    // 多日期模式：跳過絕對時間驗證，由 _buildMultiDateEvents 個別計算
    if (typeof this._isMultiDateMode === 'function' && this._isMultiDateMode()) return '';
    const { date, time } = this._getEventRegOpenNodes();
    const dateVal = date?.value || '';
    const timeVal = time?.value || '';
    if (!dateVal && !timeVal) return null;
    if (!dateVal || !timeVal) return null;
    return `${dateVal}T${timeVal}`;
  },

  // ── 活動地區（Region Selector）──

  _regionSelectedCities: [],

  bindRegionToggle() {
    const toggle = document.getElementById('ce-region-enabled');
    if (!toggle) return;
    // 管理員判定：非管理員隱藏 toggle，強制開啟（this === App，已掛載 hasPermission）
    const isAdmin = this.hasPermission && (this.hasPermission('admin.users.entry') || this.hasPermission('admin.entry'));
    const toggleRow = document.getElementById('ce-region-toggle-row');
    if (!isAdmin && toggleRow) toggleRow.style.display = 'none';
    if (!isAdmin) toggle.checked = true;
    if (!toggle.dataset.bound) {
      toggle.dataset.bound = '1';
      toggle.addEventListener('change', () => this._updateRegionUI());
    }
    this._updateRegionUI();
    // 綁定 radio change
    const radiosContainer = document.getElementById('ce-region-radios');
    if (radiosContainer && !radiosContainer.dataset.bound) {
      radiosContainer.dataset.bound = '1';
      radiosContainer.addEventListener('change', (e) => {
        if (e.target.name === 'ce-region') {
          var regionMap = typeof REGION_MAP !== 'undefined' ? REGION_MAP : {};
          this._regionSelectedCities = regionMap[e.target.value] ? [...regionMap[e.target.value]] : [];
          this._updateRegionCardStyles();
          this._updateCityCheckboxes();
        }
      });
    }
  },

  _updateRegionUI() {
    const toggle = document.getElementById('ce-region-enabled');
    const label = document.getElementById('ce-region-enabled-label');
    const options = document.getElementById('ce-region-options');
    if (!toggle || !options) return;
    const enabled = toggle.checked;
    options.style.display = enabled ? '' : 'none';
    if (label) label.textContent = enabled ? '開啟 — 指定活動地區' : '關閉 — 所有地區頁籤都顯示';
    if (enabled) this._renderRegionRadios();
  },

  _renderRegionRadios() {
    const container = document.getElementById('ce-region-radios');
    if (!container) return;
    const regionMap = typeof REGION_MAP !== 'undefined' ? REGION_MAP : {};
    const hints = {
      '中部': '苗中彰投雲',
      '北部': '北北基桃竹宜',
      '南部': '嘉南高屏',
      '東部&外島': '花東澎金馬',
    };
    const currentVal = container.querySelector('input[name="ce-region"]:checked')?.value || '';
    container.innerHTML = '';
    container.style.cssText = 'display:flex;flex-wrap:wrap;gap:.4rem';
    Object.keys(regionMap).forEach(key => {
      const label = document.createElement('label');
      const isChecked = key === currentVal;
      label.style.cssText = 'display:flex;align-items:center;gap:.3rem;font-size:.8rem;cursor:pointer;padding:.35rem .6rem;border-radius:8px;border:1px solid ' + (isChecked ? 'var(--accent)' : 'var(--border)') + ';background:' + (isChecked ? 'var(--accent-bg,rgba(13,148,136,.08))' : 'var(--bg-card)') + ';white-space:nowrap';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'ce-region';
      radio.value = key;
      radio.style.cssText = 'margin:0;flex-shrink:0;width:14px;height:14px';
      if (isChecked) radio.checked = true;
      const text = document.createElement('span');
      text.style.cssText = 'font-weight:500';
      text.textContent = key;
      label.appendChild(radio);
      label.appendChild(text);
      container.appendChild(label);
    });
    this._updateCityCheckboxes();
  },

  _updateRegionCardStyles() {
    var container = document.getElementById('ce-region-radios');
    if (!container) return;
    var labels = container.querySelectorAll('label');
    labels.forEach(function(label) {
      var radio = label.querySelector('input[type="radio"]');
      if (!radio) return;
      var checked = radio.checked;
      label.style.borderColor = checked ? 'var(--accent)' : 'var(--border)';
      label.style.background = checked ? 'var(--accent-bg,rgba(13,148,136,.08))' : 'var(--bg-card)';
    });
  },

  _updateCityCheckboxes() {
    const citiesContainer = document.getElementById('ce-region-cities');
    if (!citiesContainer) return;
    const radiosContainer = document.getElementById('ce-region-radios');
    const selectedRegion = radiosContainer?.querySelector('input[name="ce-region"]:checked')?.value || '';
    const regionMap = typeof REGION_MAP !== 'undefined' ? REGION_MAP : {};
    const cities = regionMap[selectedRegion] || [];
    citiesContainer.innerHTML = '';
    if (!cities.length) return;
    citiesContainer.style.cssText = 'margin-top:.5rem;border:1px solid var(--border);border-radius:8px;padding:.5rem .6rem;background:var(--bg-card)';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:.35rem';
    citiesContainer.appendChild(wrap);
    var self = this;
    var checkedStyle = 'display:inline-flex;flex-direction:row;align-items:center;gap:.25rem;font-size:.78rem;cursor:pointer;padding:.25rem .5rem;border-radius:6px;border:1px solid rgba(139,92,246,.4);background:rgba(139,92,246,.1);white-space:nowrap';
    var uncheckedStyle = 'display:inline-flex;flex-direction:row;align-items:center;gap:.25rem;font-size:.78rem;cursor:pointer;padding:.25rem .5rem;border-radius:6px;border:1px solid var(--border);background:transparent;white-space:nowrap';
    cities.forEach(city => {
      const label = document.createElement('label');
      var isChecked = this._regionSelectedCities.indexOf(city) !== -1;
      label.style.cssText = isChecked ? checkedStyle : uncheckedStyle;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.style.cssText = 'margin:0;flex-shrink:0;width:14px;height:14px';
      cb.value = city;
      cb.name = 'ce-region-city';
      if (isChecked) cb.checked = true;
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (self._regionSelectedCities.indexOf(city) === -1) self._regionSelectedCities.push(city);
          label.style.cssText = checkedStyle;
        } else {
          // 至少保留一個勾選
          if (self._regionSelectedCities.length <= 1) {
            cb.checked = true;
            var container = document.getElementById('ce-region-cities');
            if (container) {
              container.style.animation = 'none';
              void container.offsetWidth;
              container.style.animation = 'region-shake .4s ease';
            }
            return;
          }
          self._regionSelectedCities = self._regionSelectedCities.filter(c => c !== city);
          label.style.cssText = uncheckedStyle;
        }
      });
      const text = document.createElement('span');
      text.textContent = city;
      label.appendChild(cb);
      label.appendChild(text);
      wrap.appendChild(label);
    });
  },

  _regionGetFormData() {
    const enabled = !!document.getElementById('ce-region-enabled')?.checked;
    if (!enabled) return { regionEnabled: false, region: '', cities: [] };
    const radiosContainer = document.getElementById('ce-region-radios');
    const region = radiosContainer?.querySelector('input[name="ce-region"]:checked')?.value || '';
    return { regionEnabled: true, region, cities: [...this._regionSelectedCities] };
  },

  _regionSetFormData(regionEnabled, region, cities) {
    const toggle = document.getElementById('ce-region-enabled');
    if (toggle) toggle.checked = !!regionEnabled;
    var citiesArr = Array.isArray(cities) ? [...cities] : [];
    // 有指定地區但沒有縣市時，預設全選該地區所有縣市
    if (region && citiesArr.length === 0) {
      var regionMap = typeof REGION_MAP !== 'undefined' ? REGION_MAP : {};
      if (regionMap[region]) citiesArr = [...regionMap[region]];
    }
    this._regionSelectedCities = citiesArr;
    this._updateRegionUI();
    // 選中對應 radio
    if (region) {
      const radiosContainer = document.getElementById('ce-region-radios');
      if (radiosContainer) {
        const radios = radiosContainer.querySelectorAll('input[name="ce-region"]');
        radios.forEach(r => { r.checked = (r.value === region); });
        this._updateCityCheckboxes();
      }
    }
  },

  // ── Team Split ──

  _tsDefaultColors: [
    { hex: '#EF4444', stroke: '#DC2626', name: '紅隊' },
    { hex: '#3B82F6', stroke: '#2563EB', name: '藍隊' },
    { hex: '#10B981', stroke: '#059669', name: '綠隊' },
    { hex: '#FBBF24', stroke: '#D97706', name: '黃隊' },
    { hex: '#FFFFFF', stroke: '#D1D5DB', name: '白隊' },
    { hex: '#1F2937', stroke: '#9CA3AF', name: '黑隊' },
    { hex: '#F97316', stroke: '#EA580C', name: '橙隊' },
    { hex: '#8B5CF6', stroke: '#7C3AED', name: '紫隊' },
  ],

  _updateTeamSplitUI() {
    const toggle = document.getElementById('ce-team-split-enabled');
    const label = document.getElementById('ce-team-split-label');
    const options = document.getElementById('ce-team-split-options');
    if (!toggle || !options) return;
    const enabled = toggle.checked;
    options.style.display = enabled ? '' : 'none';
    if (label) label.textContent = enabled ? '開啟' : '關閉';
    if (enabled) {
      this._tsRenderColorChips();
      this._tsUpdateBalanceCard();
    }
  },

  // 每隊目前選的顏色索引（0-based，對應 _tsDefaultColors）
  _tsTeamColorIdx: [0, 1, 2, 3],

  _tsRenderColorChips() {
    const container = document.getElementById('ce-team-split-colors');
    if (!container) return;
    const count = parseInt(document.getElementById('ce-team-split-count')?.value, 10) || 2;
    const keys = ['A', 'B', 'C', 'D'].slice(0, count);
    container.innerHTML = keys.map((key, i) => {
      const cIdx = this._tsTeamColorIdx[i] ?? i;
      const c = this._tsDefaultColors[cIdx] || this._tsDefaultColors[0];
      const svg = this._tsJerseySvg?.(c.hex, c.stroke, key, { width: 26, inline: true }) || `<span style="font-size:.8rem;font-weight:700">${key}</span>`;
      return `<div onclick="App._tsCycleColor(${i})" style="cursor:pointer;padding:.1rem" title="點擊換色：${c.name}">${svg}</div>`;
    }).join('');
  },

  _tsCycleColor(teamIdx) {
    if (!this._isActivityAddonAllowedForCurrentEdit()) {
      this._showActivityAddonUpsellToast?.();
      return;
    }
    const presets = this._tsDefaultColors;
    const current = this._tsTeamColorIdx[teamIdx] ?? teamIdx;
    // 循環到下一個顏色，跳過已被其他隊使用的
    const count = parseInt(document.getElementById('ce-team-split-count')?.value, 10) || 2;
    const usedIdx = new Set();
    for (let i = 0; i < count; i++) {
      if (i !== teamIdx) usedIdx.add(this._tsTeamColorIdx[i] ?? i);
    }
    let next = (current + 1) % presets.length;
    let attempts = 0;
    while (usedIdx.has(next) && attempts < presets.length) {
      next = (next + 1) % presets.length;
      attempts++;
    }
    this._tsTeamColorIdx[teamIdx] = next;
    this._tsRenderColorChips();
  },

  _tsSetMode(mode, silent = false) {
    if (!silent && !this._isActivityAddonAllowedForCurrentEdit()) {
      this._showActivityAddonUpsellToast?.();
      return;
    }
    document.querySelectorAll('#ce-team-split-mode .ce-gender-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === mode);
    });
    const lockWrap = document.getElementById('ce-team-split-lock-wrap');
    if (lockWrap) lockWrap.style.display = mode === 'self-select' ? '' : 'none';
  },

  _tsGetMode() {
    const active = document.querySelector('#ce-team-split-mode .ce-gender-chip.active');
    return active?.dataset?.value || 'random';
  },

  bindTeamSplitToggle() {
    const toggle = document.getElementById('ce-team-split-enabled');
    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = '1';
      toggle.addEventListener('change', () => {
        if (!this._guardActivityAddonToggle(toggle)) this._tsSetFormData?.(null);
        this._updateTeamSplitUI();
      });
    }
    const countSel = document.getElementById('ce-team-split-count');
    if (countSel && !countSel.dataset.bound) {
      countSel.dataset.bound = '1';
      countSel.addEventListener('change', () => this._tsRenderColorChips());
    }
    const balanceCb = document.getElementById('ce-team-split-balance');
    if (balanceCb && !balanceCb.dataset.bound) {
      balanceCb.dataset.bound = '1';
      balanceCb.addEventListener('change', () => {
        if (!this._guardActivityAddonToggle(balanceCb)) return;
        this._tsUpdateBalanceCard();
      });
    }
    // 直接綁定卡片點擊，避免 display:none 的 checkbox 在 LINE WebView 無法觸發 label-for
    const balanceCard = document.getElementById('ce-team-split-balance-card');
    if (balanceCard && !balanceCard.dataset.bound) {
      balanceCard.dataset.bound = '1';
      balanceCard.addEventListener('click', (e) => {
        e.preventDefault();
        const cb = document.getElementById('ce-team-split-balance');
        if (cb) {
          cb.checked = !cb.checked;
          if (!this._guardActivityAddonToggle(cb)) return;
          this._tsUpdateBalanceCard();
        }
      });
    }
    this._updateTeamSplitUI();
  },

  _tsUpdateBalanceCard() {
    const cb = document.getElementById('ce-team-split-balance');
    const icon = document.getElementById('ce-team-split-balance-icon');
    const card = document.getElementById('ce-team-split-balance-card');
    if (!cb || !icon || !card) return;
    const on = cb.checked;
    icon.textContent = on ? '✅' : '⬜';
    card.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
    card.style.background = on ? 'rgba(13,148,136,.08)' : 'transparent';
  },

  _tsGetFormData() {
    const enabled = !!document.getElementById('ce-team-split-enabled')?.checked;
    if (!enabled) return null;
    const count = parseInt(document.getElementById('ce-team-split-count')?.value, 10) || 2;
    const mode = this._tsGetMode();
    const balanceCap = !!document.getElementById('ce-team-split-balance')?.checked;
    const lockHours = mode === 'self-select' ? parseInt(document.getElementById('ce-team-split-lock-hours')?.value, 10) || 2 : 0;
    const keys = ['A', 'B', 'C', 'D'].slice(0, count);
    const teams = keys.map((key, i) => {
      const cIdx = this._tsTeamColorIdx[i] ?? i;
      const c = this._tsDefaultColors[cIdx] || this._tsDefaultColors[0];
      return { key, color: c.hex, name: c.name };
    });
    return { enabled: true, mode, balanceCap, selfSelectLockHours: lockHours, lockAt: null, teams };
  },

  _tsSetFormData(teamSplit) {
    const toggle = document.getElementById('ce-team-split-enabled');
    if (toggle) toggle.checked = !!teamSplit?.enabled;
    if (teamSplit?.teams?.length) {
      const countSel = document.getElementById('ce-team-split-count');
      if (countSel) countSel.value = String(teamSplit.teams.length);
      // 還原色票索引
      teamSplit.teams.forEach((team, i) => {
        const idx = (this._tsDefaultColors || []).findIndex(c => c.hex === team.color);
        if (idx >= 0) this._tsTeamColorIdx[i] = idx;
      });
    }
    if (teamSplit?.mode) this._tsSetMode(teamSplit.mode, true);
    const balance = document.getElementById('ce-team-split-balance');
    if (balance) balance.checked = teamSplit?.balanceCap !== false;
    const lockHours = document.getElementById('ce-team-split-lock-hours');
    if (lockHours && teamSplit?.selfSelectLockHours) lockHours.value = String(teamSplit.selfSelectLockHours);
    this._updateTeamSplitUI();
    this._tsUpdateBalanceCard();
  },

  _eventSocialLinksMax: 5,
  _eventSocialLinksDraft: [],

  _getEventSocialLinksNodes() {
    return {
      toggle: document.getElementById('ce-social-links-enabled'),
      label: document.getElementById('ce-social-links-label'),
      options: document.getElementById('ce-social-links-options'),
      list: document.getElementById('ce-social-links-list'),
      add: document.getElementById('ce-social-links-add'),
    };
  },

  _normalizeEventSocialUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(withProtocol);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  },

  _detectEventSocialPlatform(value) {
    const normalized = this._normalizeEventSocialUrl?.(value) || '';
    let host = '';
    try {
      host = normalized ? new URL(normalized).hostname.toLowerCase().replace(/^www\./, '') : '';
    } catch (_) {}
    const matches = (...domains) => domains.some(domain => host === domain || host.endsWith(`.${domain}`));
    if (matches('line.me', 'lin.ee')) return { key: 'line', label: 'LINE', icon: 'LINE', host };
    if (matches('facebook.com', 'fb.com', 'messenger.com', 'm.me')) return { key: 'facebook', label: 'Facebook', icon: 'f', host };
    if (matches('instagram.com')) return { key: 'instagram', label: 'Instagram', icon: 'IG', host };
    if (matches('threads.net', 'threads.com')) return { key: 'threads', label: 'Threads', icon: '@', host };
    if (matches('x.com', 'twitter.com')) return { key: 'x', label: 'X', icon: 'X', host };
    if (matches('youtube.com', 'youtu.be')) return { key: 'youtube', label: 'YouTube', icon: '▶', host };
    if (matches('tiktok.com')) return { key: 'tiktok', label: 'TikTok', icon: '♪', host };
    if (matches('discord.gg', 'discord.com')) return { key: 'discord', label: 'Discord', icon: 'D', host };
    if (matches('telegram.org', 'telegram.me', 't.me')) return { key: 'telegram', label: 'Telegram', icon: '✈', host };
    if (matches('linktr.ee', 'linktree.com')) return { key: 'linktree', label: 'Linktree', icon: 'LT', host };
    return { key: 'link', label: host || '連結', icon: '↗', host };
  },

  _normalizeEventSocialLinks(value) {
    const list = Array.isArray(value) ? value : [];
    const seen = new Set();
    const normalized = [];
    list.forEach(item => {
      const rawUrl = typeof item === 'string'
        ? item
        : (item?.url || item?.href || item?.link || '');
      const url = this._normalizeEventSocialUrl?.(rawUrl) || '';
      if (!url || seen.has(url)) return;
      seen.add(url);
      const meta = this._detectEventSocialPlatform?.(url) || { key: 'link', label: '連結', host: '' };
      const rawLabel = typeof item === 'object' && item ? String(item.label || '').trim() : '';
      normalized.push({
        url,
        platform: meta.key,
        label: rawLabel || meta.label,
        host: meta.host || '',
      });
    });
    return normalized.slice(0, this._eventSocialLinksMax || 5);
  },

  _renderEventSocialIcon(link) {
    const meta = this._detectEventSocialPlatform?.(link?.url || '') || { key: 'link', label: '連結', icon: '↗' };
    const iconClass = `event-social-link-icon event-social-link-icon-${escapeHTML(meta.key)}`;
    const imageIcons = {
      instagram: 'img/Instagram-Logo--Streamline-Plump-Gradient.png',
      threads: 'img/Thread-Block-Logo--Streamline-Ultimate.png',
    };
    if (imageIcons[meta.key]) {
      return `<span class="${iconClass}" aria-hidden="true"><img src="${escapeHTML(imageIcons[meta.key])}" alt=""></span>`;
    }
    return `<span class="${iconClass}" aria-hidden="true">${escapeHTML(meta.icon)}</span>`;
  },

  _renderEventSocialLinksHtml(links) {
    const normalized = this._normalizeEventSocialLinks?.(links) || [];
    if (!normalized.length) return '';
    return normalized.map(link => {
      const meta = this._detectEventSocialPlatform?.(link.url) || { key: link.platform || 'link', label: link.label || '連結' };
      const label = link.label || meta.label || '連結';
      return `<a class="event-social-link-btn" data-platform="${escapeHTML(meta.key)}" href="${escapeHTML(link.url)}" target="sporthub_social" rel="noopener noreferrer" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}">${this._renderEventSocialIcon(link)}</a>`;
    }).join('');
  },

  _renderEventSocialLinksFormRows() {
    const nodes = this._getEventSocialLinksNodes();
    if (!nodes.list) return;
    const draft = Array.isArray(this._eventSocialLinksDraft) ? this._eventSocialLinksDraft : [];
    const rows = draft.length ? draft : [{ url: '' }];
    nodes.list.innerHTML = rows.map((item, index) => {
      const value = typeof item === 'string' ? item : (item?.url || '');
      const normalized = this._normalizeEventSocialUrl?.(value) || '';
      const normalizedLink = normalized ? (this._normalizeEventSocialLinks?.([{ url: normalized }]) || [])[0] : null;
      const preview = normalizedLink
        ? `${this._renderEventSocialIcon(normalizedLink)}<span>${escapeHTML(normalizedLink.label)}</span>`
        : '<span class="ce-social-link-empty">待判斷</span>';
      const removeDisabled = rows.length <= 1 ? 'disabled' : '';
      return `
        <div class="ce-social-link-row" data-index="${index}">
          <input type="url" class="ce-social-link-input" value="${escapeHTML(value)}" placeholder="貼上社群網址，例如 https://line.me/...">
          <span class="ce-social-link-preview">${preview}</span>
          <button type="button" class="ce-social-link-remove" ${removeDisabled} onclick="App._removeEventSocialLinkInput(${index})">移除</button>
        </div>`;
    }).join('');
    nodes.list.querySelectorAll('.ce-social-link-input').forEach((input, index) => {
      if (input.dataset.bound === '1') return;
      input.dataset.bound = '1';
      input.addEventListener('input', () => {
        this._eventSocialLinksDraft[index] = { url: input.value };
      });
      input.addEventListener('blur', () => {
        this._eventSocialLinksDraft[index] = { url: input.value };
        this._renderEventSocialLinksFormRows();
      });
    });
    if (nodes.add) nodes.add.disabled = rows.length >= (this._eventSocialLinksMax || 5);
  },

  _updateEventSocialLinksUI() {
    const nodes = this._getEventSocialLinksNodes();
    if (!nodes.toggle || !nodes.options) return;
    const enabled = !!nodes.toggle.checked;
    if (nodes.label) {
      nodes.label.textContent = enabled ? '開啟' : '關閉';
      nodes.label.style.color = enabled ? 'var(--accent)' : 'var(--text-muted)';
    }
    nodes.options.style.display = enabled ? '' : 'none';
    if (enabled) {
      if (!Array.isArray(this._eventSocialLinksDraft) || this._eventSocialLinksDraft.length === 0) {
        this._eventSocialLinksDraft = [{ url: '' }];
      }
      this._renderEventSocialLinksFormRows();
    }
  },

  _addEventSocialLinkInput() {
    const max = this._eventSocialLinksMax || 5;
    const draft = Array.isArray(this._eventSocialLinksDraft) ? this._eventSocialLinksDraft : [];
    if (draft.length >= max) {
      this.showToast?.(`社群連結最多 ${max} 個`);
      return;
    }
    this._eventSocialLinksDraft = [...draft, { url: '' }];
    this._updateEventSocialLinksUI();
  },

  _removeEventSocialLinkInput(index) {
    const draft = Array.isArray(this._eventSocialLinksDraft) ? this._eventSocialLinksDraft : [];
    if (draft.length <= 1) return;
    this._eventSocialLinksDraft = draft.filter((_, i) => i !== index);
    this._updateEventSocialLinksUI();
  },

  _getEventSocialLinksFormData(options = {}) {
    const validate = !!options.validate;
    const nodes = this._getEventSocialLinksNodes();
    const enabled = !!nodes.toggle?.checked;
    if (!enabled) return { enabled: false, links: [] };
    const draft = Array.isArray(this._eventSocialLinksDraft) ? this._eventSocialLinksDraft : [];
    const rawValues = draft
      .map(item => typeof item === 'string' ? item : (item?.url || ''))
      .map(value => String(value || '').trim());
    const nonEmpty = rawValues.filter(Boolean);
    const invalid = nonEmpty.find(value => !this._normalizeEventSocialUrl?.(value));
    if (validate && nonEmpty.length === 0) {
      return { enabled: true, links: [], error: '社群連結開啟後，請至少填入 1 個網址' };
    }
    if (validate && invalid) {
      return { enabled: true, links: [], error: '社群連結網址格式不正確，請確認後再送出' };
    }
    const links = this._normalizeEventSocialLinks?.(nonEmpty.map(url => ({ url }))) || [];
    return { enabled: links.length > 0, links };
  },

  _setEventSocialLinksFormData(enabled, links = []) {
    const nodes = this._getEventSocialLinksNodes();
    const normalized = this._normalizeEventSocialLinks?.(links) || [];
    this._eventSocialLinksDraft = normalized.length ? normalized.map(link => ({ url: link.url })) : [];
    if (nodes.toggle) nodes.toggle.checked = !!enabled && normalized.length > 0;
    if (!!enabled && normalized.length === 0) this._eventSocialLinksDraft = [{ url: '' }];
    this._updateEventSocialLinksUI();
  },

  bindEventSocialLinksToggle() {
    const nodes = this._getEventSocialLinksNodes();
    if (nodes.toggle && nodes.toggle.dataset.bound !== '1') {
      nodes.toggle.dataset.bound = '1';
      nodes.toggle.addEventListener('change', () => {
        if (!this._guardActivityAddonToggle(nodes.toggle)) {
          this._setEventSocialLinksFormData(false, []);
          return;
        }
        this._updateEventSocialLinksUI();
      });
    }
    if (nodes.add && nodes.add.dataset.bound !== '1') {
      nodes.add.dataset.bound = '1';
      nodes.add.addEventListener('click', () => this._addEventSocialLinkInput());
    }
    this._updateEventSocialLinksUI();
  },

  _earlyBirdMinCost: 10,
  _earlyBirdMaxCost: 500,

  _getEventEarlyBirdNodes() {
    return {
      toggle: document.getElementById('ce-early-bird-enabled'),
      label: document.getElementById('ce-early-bird-label'),
      options: document.getElementById('ce-early-bird-options'),
      cost: document.getElementById('ce-early-bird-cost'),
    };
  },

  _normalizeEarlyBirdCost(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return this._earlyBirdMinCost || 10;
    return Math.max(this._earlyBirdMinCost || 10, Math.min(this._earlyBirdMaxCost || 500, Math.floor(num)));
  },

  _updateEventEarlyBirdUI() {
    const nodes = this._getEventEarlyBirdNodes();
    if (!nodes.toggle || !nodes.options) return;
    const enabled = !!nodes.toggle.checked;
    if (nodes.label) {
      nodes.label.textContent = enabled ? '開啟' : '關閉';
      nodes.label.style.color = enabled ? 'var(--accent)' : 'var(--text-muted)';
    }
    nodes.options.style.display = enabled ? '' : 'none';
    if (nodes.cost) {
      nodes.cost.disabled = !enabled;
      if (enabled) nodes.cost.value = String(this._normalizeEarlyBirdCost(nodes.cost.value));
    }
  },

  _getEventEarlyBirdFormData(options = {}) {
    const validate = !!options.validate;
    const nodes = this._getEventEarlyBirdNodes();
    const enabled = !!nodes.toggle?.checked;
    if (!enabled) return { enabled: false, cost: 0 };
    const raw = Number(nodes.cost?.value);
    const cost = this._normalizeEarlyBirdCost(raw);
    if (validate && (!Number.isFinite(raw) || raw < (this._earlyBirdMinCost || 10) || raw > (this._earlyBirdMaxCost || 500))) {
      return { enabled: true, cost, error: `早鳥報名積分需介於 ${this._earlyBirdMinCost || 10}～${this._earlyBirdMaxCost || 500} 分` };
    }
    return { enabled: true, cost };
  },

  _setEventEarlyBirdFormData(enabled, cost = 10) {
    const nodes = this._getEventEarlyBirdNodes();
    if (nodes.toggle) nodes.toggle.checked = !!enabled;
    if (nodes.cost) nodes.cost.value = String(this._normalizeEarlyBirdCost(cost));
    this._updateEventEarlyBirdUI();
  },

  bindEventEarlyBirdToggle() {
    const nodes = this._getEventEarlyBirdNodes();
    if (nodes.toggle && nodes.toggle.dataset.bound !== '1') {
      nodes.toggle.dataset.bound = '1';
      nodes.toggle.addEventListener('change', () => {
        if (!this._guardActivityAddonToggle(nodes.toggle)) {
          this._setEventEarlyBirdFormData(false, 10);
          return;
        }
        this._updateEventEarlyBirdUI();
      });
    }
    if (nodes.cost && nodes.cost.dataset.bound !== '1') {
      nodes.cost.dataset.bound = '1';
      nodes.cost.addEventListener('blur', () => {
        nodes.cost.value = String(this._normalizeEarlyBirdCost(nodes.cost.value));
      });
    }
    this._updateEventEarlyBirdUI();
  },

  _getEventGpsNodes() {
    return {
      toggle: document.getElementById('ce-gps-enabled'),
      label: document.getElementById('ce-gps-label'),
    };
  },

  _isEventGpsEnabled(prefix = 'ce') {
    if (prefix !== 'ce') return true;
    const nodes = this._getEventGpsNodes?.() || {};
    return nodes.toggle ? !!nodes.toggle.checked : true;
  },

  _updateEventGpsUI() {
    const nodes = this._getEventGpsNodes();
    if (!nodes.toggle) return;
    const enabled = !!nodes.toggle.checked;
    if (nodes.label) {
      nodes.label.textContent = enabled ? '開啟' : '關閉';
      nodes.label.style.color = enabled ? 'var(--accent)' : 'var(--text-muted)';
    }
    this._syncEventLocationUi?.('ce');
  },

  _getEventGpsFormData() {
    return { enabled: this._isEventGpsEnabled?.('ce') === true };
  },

  _setEventGpsFormData(enabled) {
    const nodes = this._getEventGpsNodes();
    if (nodes.toggle) nodes.toggle.checked = !!enabled;
    this._updateEventGpsUI();
  },

  bindEventGpsToggle() {
    const nodes = this._getEventGpsNodes();
    if (nodes.toggle && nodes.toggle.dataset.bound !== '1') {
      nodes.toggle.dataset.bound = '1';
      nodes.toggle.addEventListener('change', () => {
        if (!this._guardActivityAddonToggle(nodes.toggle)) {
          this._setEventGpsFormData(false);
          return;
        }
        this._updateEventGpsUI();
      });
    }
    this._updateEventGpsUI();
  },

});
