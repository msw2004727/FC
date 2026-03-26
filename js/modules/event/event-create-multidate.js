/* ================================================
   SportHub — Event: Multi-Date Batch Creation
   ================================================
   允許建立活動時選擇多個日期，一次產生多場獨立活動。
   依賴：event-create.js, event-create-options.js, config.js
   ================================================ */

Object.assign(App, {

  _multiDates: [],
  _MULTI_DATE_MAX: 30,
  _multiDateBound: false,

  // ═══════════════════════════════
  //  初始化
  // ═══════════════════════════════

  _initMultiDatePicker() {
    if (this._multiDateBound) return;
    const dateInput = document.getElementById('ce-date');
    if (!dateInput) return;
    this._multiDateBound = true;

    // 填入相對報名時間下拉選項
    const daysSel = document.getElementById('ce-reg-rel-days');
    const hoursSel = document.getElementById('ce-reg-rel-hours');
    if (daysSel && !daysSel.children.length) {
      for (let d = 0; d <= 30; d++) {
        daysSel.innerHTML += '<option value="' + d + '">' + d + '</option>';
      }
    }
    if (hoursSel && !hoursSel.children.length) {
      for (let h = 0; h <= 23; h++) {
        hoursSel.innerHTML += '<option value="' + h + '">' + h + '</option>';
      }
    }

    dateInput.addEventListener('change', () => {
      const val = dateInput.value;
      if (!val) return;
      if (this._editEventId) return;
      this._addMultiDate(val);
    });
  },

  // ═══════════════════════════════
  //  日期管理
  // ═══════════════════════════════

  _addMultiDate(dateStr) {
    if (!dateStr) return;
    if (this._multiDates.includes(dateStr)) {
      this.showToast('此日期已加入');
      return;
    }
    if (this._multiDates.length >= this._MULTI_DATE_MAX) {
      this.showToast('最多選擇 ' + this._MULTI_DATE_MAX + ' 個日期');
      return;
    }
    this._multiDates.push(dateStr);
    this._multiDates.sort();
    // 讓 date input 保持為最早日期
    const dateInput = document.getElementById('ce-date');
    if (dateInput) dateInput.value = this._multiDates[0];
    this._renderMultiDateCapsules();
    if (this._multiDates.length >= 2) this._switchToRelativeRegOpen();
  },

  _removeMultiDate(dateStr) {
    this._multiDates = this._multiDates.filter(d => d !== dateStr);
    // 更新 date input 為最早日期
    const dateInput = document.getElementById('ce-date');
    if (dateInput && this._multiDates.length > 0) {
      dateInput.value = this._multiDates[0];
    }
    this._renderMultiDateCapsules();
    if (this._multiDates.length < 2) this._switchToAbsoluteRegOpen();
  },

  _renderMultiDateCapsules() {
    const area = document.getElementById('ce-multi-date-area');
    const tagsEl = document.getElementById('ce-multi-date-tags');
    const countEl = document.getElementById('ce-multi-date-count');
    if (!area || !tagsEl) return;

    if (this._multiDates.length < 2) {
      area.style.display = 'none';
      tagsEl.innerHTML = '';
      if (countEl) countEl.textContent = '';
      return;
    }

    area.style.display = '';
    tagsEl.innerHTML = this._multiDates.map(d => {
      const label = this._formatMultiDateLabel(d);
      return '<span class="ce-date-tag">'
        + escapeHTML(label)
        + '<span class="ce-date-tag-x" data-date="' + d + '">✕</span>'
        + '</span>';
    }).join('');
    // 事件委派：避免 inline onclick
    tagsEl.querySelectorAll('.ce-date-tag-x').forEach(el => {
      el.addEventListener('click', () => this._removeMultiDate(el.dataset.date));
    });
    if (countEl) {
      countEl.textContent = '已選 ' + this._multiDates.length + ' 個日期（上限 ' + this._MULTI_DATE_MAX + '）';
    }
  },

  _formatMultiDateLabel(dateStr) {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return parseInt(parts[1], 10) + '/' + parseInt(parts[2], 10);
  },

  // ═══════════════════════════════
  //  報名時間模式切換
  // ═══════════════════════════════

  _switchToRelativeRegOpen() {
    const abs = document.getElementById('ce-reg-open-absolute');
    const rel = document.getElementById('ce-reg-open-relative');
    const hint = document.getElementById('ce-reg-open-hint');
    if (abs) abs.style.display = 'none';
    if (rel) rel.style.display = '';
    if (hint) hint.textContent = '每場活動的報名開放時間將依此設定個別計算';
  },

  _switchToAbsoluteRegOpen() {
    const abs = document.getElementById('ce-reg-open-absolute');
    const rel = document.getElementById('ce-reg-open-relative');
    const hint = document.getElementById('ce-reg-open-hint');
    if (abs) abs.style.display = '';
    if (rel) rel.style.display = 'none';
    if (hint) hint.textContent = '報名時間未到將顯示「即將開放」，到達時間後自動變為「報名中」';
  },

  _isMultiDateMode() {
    return !this._editEventId && this._multiDates.length >= 2;
  },

  // ═══════════════════════════════
  //  相對時間計算
  // ═══════════════════════════════

  _getRelativeRegOpen() {
    const days = parseInt(document.getElementById('ce-reg-rel-days')?.value, 10) || 0;
    const hours = parseInt(document.getElementById('ce-reg-rel-hours')?.value, 10) || 0;
    return { days, hours };
  },

  _calcRegOpenForDate(eventDateStr, eventStartTime, relDays, relHours) {
    if (relDays === 0 && relHours === 0) return '';
    const dt = new Date(eventDateStr + 'T' + eventStartTime);
    if (isNaN(dt.getTime())) return '';
    dt.setDate(dt.getDate() - relDays);
    dt.setHours(dt.getHours() - relHours);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return y + '-' + m + '-' + d + 'T' + hh + ':' + mm;
  },

  // ═══════════════════════════════
  //  批次事件產生
  // ═══════════════════════════════

  _buildMultiDateEvents(baseEvent, tStart, tEnd) {
    const timeVal = tStart + '~' + tEnd;
    const rel = this._getRelativeRegOpen();
    const batchGroupId = 'batch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const events = [];

    for (let i = 0; i < this._multiDates.length; i++) {
      const dateStr = this._multiDates[i];
      const fullDate = dateStr.replace(/-/g, '/') + ' ' + timeVal;
      const regOpen = this._calcRegOpenForDate(dateStr, tStart, rel.days, rel.hours);
      const status = (regOpen && new Date(regOpen) > new Date()) ? 'upcoming' : 'open';

      events.push(Object.assign({}, baseEvent, {
        id: 'ce_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + i,
        date: fullDate,
        regOpenTime: regOpen || null,
        status: status,
        batchGroupId: batchGroupId,
        current: 0,
        waitlist: 0,
        participants: [],
        waitlistNames: [],
      }));
    }
    return events;
  },

  // ═══════════════════════════════
  //  重置
  // ═══════════════════════════════

  _resetMultiDates() {
    this._multiDates = [];
    this._multiDateBound = false;
    this._renderMultiDateCapsules();
    this._switchToAbsoluteRegOpen();
    const daysSel = document.getElementById('ce-reg-rel-days');
    const hoursSel = document.getElementById('ce-reg-rel-hours');
    if (daysSel) daysSel.value = '0';
    if (hoursSel) hoursSel.value = '0';
  },

});
