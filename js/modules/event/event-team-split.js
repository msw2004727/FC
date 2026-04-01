/* ================================================
   SportHub — Team Split (分隊色衣) Module
   ================================================
   Plan: docs/team-split-plan.md
   Dependencies: App, ApiService, FirebaseService, I18N
   ================================================ */

Object.assign(App, {

  // ── 預設色票 ──
  _TEAM_SPLIT_PRESET_COLORS: [
    { hex: '#EF4444', stroke: '#DC2626', name: '紅', letterLight: false },
    { hex: '#3B82F6', stroke: '#2563EB', name: '藍', letterLight: false },
    { hex: '#10B981', stroke: '#059669', name: '綠', letterLight: false },
    { hex: '#FBBF24', stroke: '#D97706', name: '黃', letterLight: true },
    { hex: '#FFFFFF', stroke: '#D1D5DB', name: '白', letterLight: true },
    { hex: '#1F2937', stroke: '#9CA3AF', name: '黑', letterLight: false },
    { hex: '#F97316', stroke: '#EA580C', name: '橙', letterLight: false },
    { hex: '#8B5CF6', stroke: '#7C3AED', name: '紫', letterLight: false },
  ],

  _TEAM_SPLIT_JERSEY_PATH: 'M10 1L1 6.5L4.5 9L5 25C5 26.1 5.9 27 7 27H25C26.1 27 27 26.1 27 25V9L30.5 6.5L22 1C22 1 20 5 16 5C12 5 10 1 10 1Z',

  // ── 色彩工具 ──

  _tsParseHex(hex) {
    const c = (hex || '').replace(/[^0-9a-fA-F]/g, '');
    if (c.length !== 6) return null;
    return { r: parseInt(c.slice(0, 2), 16), g: parseInt(c.slice(2, 4), 16), b: parseInt(c.slice(4, 6), 16) };
  },

  _tsDarkenHex(hex, factor) {
    // 特殊色硬編碼
    if (hex === '#FFFFFF' || hex === '#ffffff') return '#D1D5DB';
    if (hex === '#1F2937' || hex === '#000000') return '#9CA3AF';
    const rgb = this._tsParseHex(hex);
    if (!rgb) return '#999999';
    const d = (v) => Math.round(Math.min(255, Math.max(0, v * (factor || 0.85))));
    return '#' + [d(rgb.r), d(rgb.g), d(rgb.b)].map(v => v.toString(16).padStart(2, '0')).join('');
  },

  _tsIsLightColor(hex) {
    const rgb = this._tsParseHex(hex);
    if (!rgb) return false;
    const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return lum > 0.5;
  },

  _tsSanitizeHex(hex) {
    return (hex || '').replace(/[^#0-9a-fA-F]/g, '');
  },

  // ── SVG 渲染 ──

  _tsJerseySvg(color, stroke, letter, options = {}) {
    const w = options.width || 20;
    const h = Math.round(w * 0.875);
    const cls = options.className || '';
    const clickable = options.clickable ? ' clickable' : '';
    const onclick = options.onclick || '';
    const onclickAttr = onclick ? ` onclick="${onclick}"` : '';
    const empty = !color || color === 'transparent';
    const safeColor = empty ? 'transparent' : this._tsSanitizeHex(color);
    const safeStroke = empty ? '#9CA3AF' : this._tsSanitizeHex(stroke || this._tsDarkenHex(color, 0.85));
    const sw = empty ? 1.5 : 1;
    const dash = empty ? ' stroke-dasharray="2 1.5"' : '';
    const letterKey = letter || '?';
    const isLight = empty ? true : this._tsIsLightColor(safeColor);
    const letterFill = isLight ? '#1F2937' : '#fff';
    const circleEl = (!empty && !isLight) ? `<circle cx="16" cy="17" r="7" fill="rgba(0,0,0,0.35)"/>` : '';
    const ariaLabel = options.ariaLabel || (letter ? `${letter} 隊` : '未分配');

    const inlinePos = options.inline ? 'position:relative;top:0;right:0;' : '';
    return `<svg class="uc-team-jersey${clickable}${cls ? ' ' + cls : ''}" `
      + `style="${inlinePos}width:${w}px;height:${h}px" viewBox="0 0 32 28" fill="none" `
      + `role="${clickable ? 'button' : 'img'}" `
      + `${clickable ? 'tabindex="0" ' : ''}`
      + `aria-label="${ariaLabel}"${onclickAttr}>`
      + `<title>${ariaLabel}</title>`
      + `<path d="${this._TEAM_SPLIT_JERSEY_PATH}" fill="${safeColor}" stroke="${safeStroke}" stroke-width="${sw}"${dash}/>`
      + circleEl
      + `<text x="16" y="21" text-anchor="middle" font-size="12" font-weight="700" fill="${empty ? '#9CA3AF' : letterFill}">${letterKey}</text>`
      + `</svg>`;
  },

  // ── 隊伍資訊卡（detail-grid 內） ──

  _tsRenderTeamInfoCards(event) {
    if (!event.teamSplit?.enabled) return '';
    const teams = event.teamSplit.teams || [];
    if (!teams.length) return '';
    const validKeys = new Set(teams.map(t => t.key));
    const regs = (ApiService.getRegistrationsByEvent?.(event.id) || [])
      .filter(r => r.status === 'confirmed');
    const counts = {};
    teams.forEach(t => { counts[t.key] = 0; });
    regs.forEach(r => { if (r.teamKey && validKeys.has(r.teamKey)) counts[r.teamKey]++; });
    const cap = event.teamSplit.balanceCap ? Math.ceil((event.max || 0) / teams.length) : null;

    return teams.map(t => {
      const c = counts[t.key] || 0;
      const overCap = cap && c > cap;
      const svg = this._tsJerseySvg(t.color, null, t.key, { width: 20, inline: true });
      const capStr = cap ? `/${cap}` : '';
      const warn = overCap ? ` style="color:var(--warning);font-weight:700"` : '';
      return `<div class="team-stat-card">${svg} <span class="team-stat-text"${warn}>${c}${capStr} <span>${I18N?.t?.('common.person') || '人'}</span></span></div>`;
    }).join('');
  },

  // ── 批次操作按鈕（主辦/委託才可見） ──

  _tsRenderBatchButtons(event) {
    if (!event.teamSplit?.enabled) return '';
    const canManage = this._canManageEvent?.(event);
    if (!canManage) return '';
    const eid = event.id;
    return `<div class="team-batch-actions">`
      + `<button class="batch-btn" onclick="App._tsBatchRandom('${eid}')">${I18N?.t?.('teamSplit.batch.random') || '隨機'}</button>`
      + `<button class="batch-btn" onclick="App._tsBatchFill('${eid}')">${I18N?.t?.('teamSplit.batch.fill') || '補齊'}</button>`
      + `<button class="batch-btn" onclick="App._tsBatchReset('${eid}')">${I18N?.t?.('teamSplit.batch.reset') || '重置'}</button>`
      + `</div>`;
  },

  // ── 批次操作實作 ──

  async _tsBatchRandom(eventId) {
    if (!await this.appConfirm(I18N?.t?.('teamSplit.batch.confirmRandom') || '重新分隊不會通知參加者，確認繼續？')) return;
    const event = ApiService.getEvent(eventId);
    if (!event?.teamSplit?.enabled) return;
    const regs = (ApiService.getRegistrationsByEvent?.(eventId) || [])
      .filter(r => r.status === 'confirmed' || r.status === 'waitlisted');
    if (!regs.length) return;
    const teams = event.teamSplit.teams;
    // 洗牌後依序分配
    const shuffled = [...regs].sort(() => Math.random() - 0.5);
    const batch = db.batch();
    shuffled.forEach((r, i) => {
      if (!r._docId) return;
      const key = teams[i % teams.length].key;
      batch.update(db.collection('registrations').doc(r._docId), { teamKey: key });
      r.teamKey = key;
    });
    await batch.commit();
    this._saveToLS?.('registrations', FirebaseService?._cache?.registrations);
    this.showEventDetail?.(eventId);
  },

  async _tsBatchFill(eventId) {
    const event = ApiService.getEvent(eventId);
    if (!event?.teamSplit?.enabled) return;
    const teams = event.teamSplit.teams;
    const validKeys = new Set(teams.map(t => t.key));
    const regs = (ApiService.getRegistrationsByEvent?.(eventId) || [])
      .filter(r => r.status === 'confirmed' || r.status === 'waitlisted');
    const unassigned = regs.filter(r => !r.teamKey || !validKeys.has(r.teamKey));
    if (!unassigned.length) { this.showToast?.('沒有未分配的人'); return; }
    const counts = {};
    teams.forEach(t => { counts[t.key] = 0; });
    regs.filter(r => r.teamKey && validKeys.has(r.teamKey))
      .forEach(r => { counts[r.teamKey]++; });
    const batch = db.batch();
    unassigned.forEach(r => {
      if (!r._docId) return;
      const minKey = teams.reduce((min, t) => (counts[t.key] || 0) < (counts[min.key] || 0) ? t : min).key;
      batch.update(db.collection('registrations').doc(r._docId), { teamKey: minKey });
      r.teamKey = minKey;
      counts[minKey]++;
    });
    await batch.commit();
    this._saveToLS?.('registrations', FirebaseService?._cache?.registrations);
    this.showEventDetail?.(eventId);
  },

  async _tsBatchReset(eventId) {
    if (!await this.appConfirm(I18N?.t?.('teamSplit.batch.confirmReset') || '確定清除所有隊伍分配？')) return;
    const regs = (ApiService.getRegistrationsByEvent?.(eventId) || [])
      .filter(r => r.status === 'confirmed' || r.status === 'waitlisted');
    if (!regs.length) return;
    const batch = db.batch();
    regs.forEach(r => {
      if (!r._docId) return;
      batch.update(db.collection('registrations').doc(r._docId), { teamKey: null });
      r.teamKey = null;
    });
    await batch.commit();
    this._saveToLS?.('registrations', FirebaseService?._cache?.registrations);
    this.showEventDetail?.(eventId);
  },

  // ── 核心分配演算法 ──

  _resolveTeamKey(event, allEventRegs, options = {}) {
    if (!event.teamSplit?.enabled) return undefined;
    if (event.teamSplit.mode === 'self-select') return options.userSelectedTeamKey || null;
    if (event.teamSplit.mode === 'manual') return null;
    const teams = event.teamSplit.teams;
    if (!teams.length) return null;
    const validKeys = new Set(teams.map(t => t.key));
    const counts = {};
    teams.forEach(t => { counts[t.key] = 0; });
    allEventRegs.filter(r => r.status === 'confirmed' && r.teamKey && validKeys.has(r.teamKey))
      .forEach(r => { counts[r.teamKey] = (counts[r.teamKey] || 0) + 1; });
    return teams.reduce((min, t) =>
      (counts[t.key] || 0) < (counts[min.key] || 0) ? t : min
    ).key;
  },

  _assignTeamKeyForPromotion(event, simRegs, candidate) {
    if (!event.teamSplit?.enabled) return undefined;
    const teams = event.teamSplit.teams;
    if (!teams || !teams.length) return null;
    const mode = event.teamSplit.mode;
    if (mode === 'self-select' && candidate.teamKey) {
      const cap = Math.ceil(event.max / teams.length);
      const validKeys = new Set(teams.map(t => t.key));
      const load = simRegs.filter(r => r.status === 'confirmed' && r.teamKey === candidate.teamKey && validKeys.has(r.teamKey)).length;
      if (load < cap) return candidate.teamKey;
    }
    if (mode === 'manual') return null;
    return this._resolveTeamKey(event, simRegs);
  },

  // ── 時間戳計算 ──

  _recalcTeamSplitTimestamps(event) {
    if (!event.date) return;
    // 解析 "YYYY/MM/DD HH:mm~HH:mm" 或 "YYYY/MM/DD HH:mm" 格式
    const match = String(event.date).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (!match) return;
    const eventStart = new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
    if (isNaN(eventStart.getTime())) return;
    event.startTimestamp = eventStart;
    if (event.teamSplit?.enabled && event.teamSplit.mode === 'self-select') {
      const lockHours = event.teamSplit.selfSelectLockHours || 2;
      event.teamSplit.lockAt = new Date(eventStart.getTime() - lockHours * 3600000);
    } else if (event.teamSplit) {
      event.teamSplit.lockAt = null;
    }
  },

  // ── 自選隊伍 UI（報名按鈕上方） ──

  _tsRenderTeamSelectUI(event, selectedKey) {
    if (!event.teamSplit?.enabled || event.teamSplit.mode !== 'self-select') return '';
    const teams = event.teamSplit.teams || [];
    if (!teams.length) return '';
    const validKeys = new Set(teams.map(t => t.key));
    const regs = (ApiService.getRegistrationsByEvent?.(event.id) || [])
      .filter(r => r.status === 'confirmed');
    const counts = {};
    teams.forEach(t => { counts[t.key] = 0; });
    regs.forEach(r => { if (r.teamKey && validKeys.has(r.teamKey)) counts[r.teamKey]++; });
    const cap = event.teamSplit.balanceCap ? Math.ceil((event.max || 0) / teams.length) : null;

    const cards = teams.map(t => {
      const c = counts[t.key] || 0;
      const isFull = cap && c >= cap;
      const isSelected = selectedKey === t.key;
      const svg = this._tsJerseySvg(t.color, null, t.key, { width: 32, inline: true });
      const capStr = cap ? `/${cap}` : '';
      const cls = `team-select-card${isSelected ? ' selected' : ''}${isFull ? ' full' : ''}`;
      const onclick = isFull
        ? `this.classList.add('shake');setTimeout(()=>this.classList.remove('shake'),300)`
        : `App._tsSelectTeam('${t.key}')`;
      return `<div class="${cls}" onclick="${onclick}">`
        + svg
        + `<div class="team-select-name">${escapeHTML(t.name || t.key + ' 隊')}</div>`
        + `<div class="team-select-count">${c}${capStr}${I18N?.t?.('common.person') || '人'}</div>`
        + `</div>`;
    }).join('');

    const title = I18N?.t?.('teamSplit.select.title') || '選擇你的隊伍';
    return `<div class="team-select-zone"><div class="team-select-title">${title}</div><div class="team-select-cards">${cards}</div></div>`;
  },

  _tsSelectedTeamKey: null,

  _tsSelectTeam(key) {
    this._tsSelectedTeamKey = key;
    // 重新渲染選擇區
    const zone = document.querySelector('.team-select-zone');
    if (zone && this._currentDetailEventId) {
      const event = ApiService.getEvent(this._currentDetailEventId);
      if (event) {
        zone.outerHTML = this._tsRenderTeamSelectUI(event, key);
      }
    }
    // 啟用報名按鈕
    const btn = document.querySelector('.signup-glow-wrap button, .detail-action-primary button');
    if (btn && btn.disabled && btn.textContent.includes('選擇隊伍')) {
      btn.disabled = false;
      btn.textContent = '立即報名';
    }
  },

  // ── 色票選擇器（膠囊右側滑出） ──

  _jerseyPickerEl: null,
  _jerseyPickerCloseHandler: null,

  _tsToggleJerseyPicker(evt, regDocId, eventId) {
    this._tsCloseJerseyPicker();
    if (!regDocId || !eventId) return;
    const event = ApiService.getEvent(eventId);
    if (!event?.teamSplit?.enabled) return;
    const teams = event.teamSplit.teams || [];
    if (!teams.length) return;
    const jerseyEl = evt.currentTarget || evt.target.closest('.uc-jersey-tap') || evt.target.closest('.uc-team-jersey');
    if (!jerseyEl) return;
    const capsule = jerseyEl.closest('.user-capsule');
    if (!capsule) return;

    const rdId = escapeHTML(regDocId);
    const evId = escapeHTML(eventId);
    const items = teams.map(t => {
      const svg = this._tsJerseySvg(t.color, null, t.key, { width: 20, inline: true });
      return `<div class="jersey-pick-item" onclick="event.stopPropagation();App._tsPickTeam('${rdId}','${evId}','${t.key}')" title="${escapeHTML(t.name || t.key)}">${svg}</div>`;
    }).join('');
    const cancelSvg = this._tsJerseySvg(null, null, '✕', { width: 20, inline: true });
    const cancelHtml = `<div class="jersey-pick-item" onclick="event.stopPropagation();App._tsPickTeam('${rdId}','${evId}','')" title="取消分配">${cancelSvg}</div>`;

    const anchor = document.createElement('div');
    anchor.className = 'jersey-picker-anchor';
    const picker = document.createElement('div');
    picker.className = 'jersey-picker';
    picker.innerHTML = items + cancelHtml;
    anchor.appendChild(picker);
    capsule.style.position = 'relative';
    capsule.appendChild(anchor);

    requestAnimationFrame(() => {
      const rect = picker.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) picker.classList.add('flip');
      picker.classList.add('open');
    });

    this._jerseyPickerEl = anchor;
    const closeHandler = (e) => {
      if (!anchor.contains(e.target) && !jerseyEl.contains(e.target)) this._tsCloseJerseyPicker();
    };
    this._jerseyPickerCloseHandler = closeHandler;
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  },

  _tsCloseJerseyPicker() {
    if (this._jerseyPickerEl) { this._jerseyPickerEl.remove(); this._jerseyPickerEl = null; }
    if (this._jerseyPickerCloseHandler) { document.removeEventListener('click', this._jerseyPickerCloseHandler); this._jerseyPickerCloseHandler = null; }
  },

  async _tsPickTeam(regDocId, eventId, teamKey) {
    this._tsCloseJerseyPicker();
    if (!regDocId) return;
    const newKey = teamKey || null;
    try {
      await db.collection('registrations').doc(regDocId).update({ teamKey: newKey });
      const regs = ApiService.getRegistrationsByEvent?.(eventId) || [];
      const reg = regs.find(r => (r._docId || r.id) === regDocId);
      if (reg) reg.teamKey = newKey;
      this._saveToLS?.('registrations', FirebaseService?._cache?.registrations);
      this._renderAttendanceTable?.(eventId, 'detail-attendance-table');
    } catch (err) {
      this.showToast?.('分隊失敗，請稍後再試');
    }
  },

  // ── 防禦性 teamKey 清洗 ──

  _tsSafeTeamKey(teamKey, event) {
    if (!teamKey || !event?.teamSplit?.teams) return null;
    const validKeys = new Set(event.teamSplit.teams.map(t => t.key));
    return validKeys.has(teamKey) ? teamKey : null;
  },
});
