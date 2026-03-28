/* ================================================
   SportHub — Education: Course Plan CRUD
   ================================================
   課程方案管理（週期制 + 堂數制）
   列表渲染 → edu-course-plan-render.js
   簽到彈窗 → edu-course-plan-attendance.js
   ================================================ */

Object.assign(App, {
  _eduCoursePlansCache: {},
  _eduCoursePlanEditTeamId: null,
  _eduCoursePlanEditId: null,

  async _loadEduCoursePlans(teamId) {
    if (!teamId) return [];
    try {
      const plans = await FirebaseService.listEduCoursePlans(teamId);
      this._eduCoursePlansCache[teamId] = plans;
      return plans;
    } catch (err) {
      console.error('[edu-course-plan] load failed:', err);
      return this._eduCoursePlansCache[teamId] || [];
    }
  },

  getEduCoursePlans(teamId) {
    return this._eduCoursePlansCache[teamId] || [];
  },

  // renderEduCoursePlanList → edu-course-plan-render.js

  async showEduCoursePlanForm(teamId, planId) {
    this._eduCoursePlanEditTeamId = teamId;
    this._eduCoursePlanEditId = planId || null;

    // 確保頁面已載入
    await this.showPage('page-edu-course-plan');

    const container = document.getElementById('edu-course-plan-page');
    if (!container) return;

    const groups = await this._loadEduGroups(teamId);
    const plan = planId ? (this.getEduCoursePlans(teamId).find(p => p.id === planId) || null) : null;

    const groupOptions = groups.filter(g => g.active !== false)
      .map(g => '<option value="' + g.id + '" data-name="' + escapeHTML(g.name) + '"' +
        (plan && plan.groupId === g.id ? ' selected' : '') + '>' + escapeHTML(g.name) + '</option>')
      .join('');

    const isWeekly = plan ? plan.planType === 'weekly' : true;

    container.innerHTML = '<div class="ce-form" style="padding:.5rem">' +
      // Fix 5: 開放報名開關最頂置左
      '<div class="ce-row" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.8rem">' +
        '<div><label style="margin:0;font-weight:700">開放學員報名</label><div style="font-size:.72rem;color:var(--text-muted);margin-top:.15rem">開啟後學員可在俱樂部頁面自助報名此方案</div></div>' +
        '<label class="toggle-switch"><input type="checkbox" id="edu-cp-signup"' + (plan && plan.allowSignup ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
      '</div>' +
      '<div class="ce-row"><label>方案名稱 <span class="required">*必填</span></label>' +
        '<input type="text" id="edu-cp-name" maxlength="30" placeholder="例：2026 春季班" value="' + escapeHTML(plan ? plan.name : '') + '"></div>' +
      // 封面圖片（點擊上傳，寬圖比例 4:3）
      '<div class="ce-row"><label>封面圖片</label>' +
        '<input type="file" id="edu-cp-cover-input" accept="image/*" hidden onchange="App._onEduCpCoverChange(this)">' +
        '<div id="edu-cp-cover-preview" class="edu-cp-cover-upload" onclick="document.getElementById(\'edu-cp-cover-input\').click()">' +
          (plan && plan.coverImage ? '<img src="' + escapeHTML(plan.coverImage) + '">' : '<span>點擊上傳封面圖片</span>') +
        '</div></div>' +
      '<div class="ce-row"><label>對應分組</label>' +
        '<select id="edu-cp-group"><option value="">不綁定分組</option>' + groupOptions + '</select></div>' +
      '<div class="ce-row"><label>方案類型</label>' +
        '<select id="edu-cp-type" onchange="App._toggleCoursePlanType(this.value)">' +
          '<option value="weekly"' + (isWeekly ? ' selected' : '') + '>固定週期</option>' +
          '<option value="session"' + (!isWeekly ? ' selected' : '') + '>堂數制</option>' +
        '</select></div>' +
      '<div id="edu-cp-weekly"' + (isWeekly ? '' : ' style="display:none"') + '>' +
        '<div class="ce-row"><label>上課日（點擊選擇）</label>' +
          '<div id="edu-cp-weekdays" class="edu-weekday-grid">' +
            ['一','二','三','四','五','六','日'].map((label, idx) => {
              const dayVal = idx < 6 ? idx + 1 : 0; // 一=1..六=6, 日=0
              const checked = plan && plan.weekdays && plan.weekdays.includes(dayVal);
              const bgClass = dayVal === 6 ? ' edu-wd-sat' : dayVal === 0 ? ' edu-wd-sun' : '';
              return '<div class="edu-wd-cell' + bgClass + (checked ? ' edu-wd-checked' : '') + '" data-day="' + dayVal + '" onclick="App._toggleWeekdayCell(this)">'
                + '<span class="edu-wd-label">' + label + '</span>'
                + '<span class="edu-wd-check">' + (checked ? '✓' : '') + '</span>'
                + '</div>';
            }).join('') +
          '</div></div>' +
        '<div class="ce-row"><label>時段</label><input type="text" id="edu-cp-timeslot" maxlength="20" placeholder="09:00-10:30" value="' + escapeHTML(plan && plan.timeSlot || '') + '"></div>' +
        '<div id="edu-cp-preview" class="edu-cp-preview"></div>' +
      '</div>' +
      '<div id="edu-cp-session"' + (!isWeekly ? '' : ' style="display:none"') + '>' +
        '<div class="ce-row"><label>總堂數</label><input type="number" id="edu-cp-total" min="1" max="999" value="' + (plan && plan.totalSessions || '') + '"></div>' +
      '</div>' +
      '<div class="ce-row" style="display:flex;gap:.5rem">' +
        '<div style="flex:1"><label>課程開始日期</label><input type="date" id="edu-cp-start" value="' + (plan && plan.startDate || '') + '"></div>' +
        '<div style="flex:1"><label>課程結束日期</label><input type="date" id="edu-cp-end" value="' + (plan && plan.endDate || '') + '"></div>' +
      '</div>' +
      '<hr style="border:none;border-top:1px solid var(--border);margin:.8rem 0">' +
      '<div class="ce-row"><label>容納上限</label><input type="number" id="edu-cp-capacity" min="1" max="999" placeholder="不填則不限人數" value="' + (plan && plan.maxCapacity || '') + '">' +
        '<div style="font-size:.72rem;color:var(--text-muted);margin-top:.15rem">不填則不限制報名人數</div></div>' +
      '<div class="ce-row"><label>費用（元）</label><input type="number" id="edu-cp-price" min="0" placeholder="選填，僅供顯示" value="' + (plan && plan.price || '') + '">' +
        '<div style="font-size:.72rem;color:var(--text-muted);margin-top:.15rem">僅供顯示與繳費記錄，不含線上付款功能</div></div>' +
      '<div style="display:flex;gap:.5rem;margin-top:1rem">' +
        '<button class="outline-btn" onclick="App.goBack()">取消</button>' +
        '<button class="primary-btn" id="edu-cp-save-btn" onclick="App.handleSaveEduCoursePlan()">' + (planId ? '儲存變更' : '建立方案') + '</button>' +
      '</div>' +
    '</div>';
  },

  _eduCpCoverDataUrl: null,
  _onEduCpCoverChange(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (typeof this.showImageCropper === 'function') {
      const reader = new FileReader();
      reader.onload = () => {
        this.showImageCropper(reader.result, {
          aspectRatio: 8/3,
          onConfirm: (croppedDataUrl) => {
            this._eduCpCoverDataUrl = croppedDataUrl;
            const preview = document.getElementById('edu-cp-cover-preview');
            if (preview) preview.innerHTML = '<img src="' + croppedDataUrl + '">';
          }
        });
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        this._eduCpCoverDataUrl = reader.result;
        const preview = document.getElementById('edu-cp-cover-preview');
        if (preview) preview.innerHTML = '<img src="' + reader.result + '">';
      };
      reader.readAsDataURL(file);
    }
  },

  _toggleWeekdayCell(cell) {
    const isChecked = cell.classList.toggle('edu-wd-checked');
    cell.querySelector('.edu-wd-check').textContent = isChecked ? '✓' : '';
    this._updateCoursePlanPreview();
  },

  _updateCoursePlanPreview() {
    const previewEl = document.getElementById('edu-cp-preview');
    if (!previewEl) return;
    const cells = document.querySelectorAll('#edu-cp-weekdays .edu-wd-checked');
    const weekdays = Array.from(cells).map(c => parseInt(c.dataset.day, 10));
    const startDate = document.getElementById('edu-cp-start').value;
    const endDate = document.getElementById('edu-cp-end').value;

    if (!weekdays.length || !startDate || !endDate) {
      previewEl.innerHTML = '';
      return;
    }

    const dayNames = weekdays.map(d => '週' + this._weekdayLabel(d)).join('、');
    const totalDates = this.generateWeeklyDates({ weekdays, startDate, endDate });

    previewEl.innerHTML = '每' + dayNames + '上課，總計 <strong>' + totalDates.length + '</strong> 堂課';
  },
  _toggleCoursePlanType(type) {
    const weeklyEl = document.getElementById('edu-cp-weekly');
    const sessionEl = document.getElementById('edu-cp-session');
    if (weeklyEl) weeklyEl.style.display = type === 'weekly' ? '' : 'none';
    if (sessionEl) sessionEl.style.display = type === 'session' ? '' : 'none';
  },

  async handleSaveEduCoursePlan() {
    const _btnState = this._setEduBtnLoading('#edu-cp-save-btn');
    const teamId = this._eduCoursePlanEditTeamId;
    const planId = this._eduCoursePlanEditId;
    const name = document.getElementById('edu-cp-name').value.trim();
    if (!name) { _btnState.restore(); this.showToast('請輸入方案名稱'); return; }

    const groupSelect = document.getElementById('edu-cp-group');
    const groupId = groupSelect ? groupSelect.value : '';
    const groupName = groupSelect ? (groupSelect.selectedOptions[0]?.dataset?.name || '') : '';
    const planType = document.getElementById('edu-cp-type').value;

    const allowSignup = document.getElementById('edu-cp-signup')?.checked || false;
    const capRaw = document.getElementById('edu-cp-capacity')?.value;
    const maxCapacity = capRaw ? parseInt(capRaw, 10) : null;
    const priceRaw = document.getElementById('edu-cp-price')?.value;
    const price = priceRaw ? parseInt(priceRaw, 10) : null;

    const data = {
      name,
      groupId,
      groupName,
      planType,
      active: true,
      allowSignup,
      maxCapacity,
      price,
    };

    // 共用日期欄位（兩種類型都有）
    data.startDate = document.getElementById('edu-cp-start').value || '';
    data.endDate = document.getElementById('edu-cp-end').value || '';

    if (planType === 'weekly') {
      const weekdayCells = document.querySelectorAll('#edu-cp-weekdays .edu-wd-checked');
      data.weekdays = Array.from(weekdayCells).map(c => parseInt(c.dataset.day, 10));
      data.timeSlot = document.getElementById('edu-cp-timeslot').value.trim();
      data.totalSessions = null;
      if (!data.weekdays.length) { _btnState.restore(); this.showToast('請選擇上課日'); return; }
      if (!data.startDate || !data.endDate) { _btnState.restore(); this.showToast('請設定開始和結束日期'); return; }
    } else {
      const total = parseInt(document.getElementById('edu-cp-total').value, 10);
      if (!total || total < 1) { _btnState.restore(); this.showToast('請輸入有效堂數'); return; }
      data.totalSessions = total;
      data.weekdays = null;
      data.timeSlot = null;
    }

    // 封面圖片上傳
    if (this._eduCpCoverDataUrl) {
      data.coverImage = this._eduCpCoverDataUrl;
      this._eduCpCoverDataUrl = null;
    }

    try {
      if (planId) {
        await FirebaseService.updateEduCoursePlan(teamId, planId, data);
        const cached = this._eduCoursePlansCache[teamId];
        if (cached) {
          const existing = cached.find(p => p.id === planId);
          if (existing) Object.assign(existing, data);
        }
        this.showToast('課程方案已更新');
      } else {
        data.id = this._generateEduId('cp');
        data.currentCount = 0;
        const result = await FirebaseService.createEduCoursePlan(teamId, data);
        const cached = this._eduCoursePlansCache[teamId];
        if (cached) cached.push(result);
        else this._eduCoursePlansCache[teamId] = [result];
        this.showToast('課程方案已建立');
      }
      this.goBack();
      // 返回後即時重繪課程方案列表
      if (this._eduDetailTeamId) {
        this.renderEduCoursePlanList?.(this._eduDetailTeamId);
      }
    } catch (err) {
      console.error('[handleSaveEduCoursePlan]', err);
      this.showToast('儲存失敗：' + (err.message || '請稍後再試'));
    } finally {
      _btnState.restore();
    }
  },
  async deleteEduCoursePlan(teamId, planId) {
    const confirmText = prompt('此操作無法復原。請輸入「我確定刪除」以確認刪除：');
    if (confirmText !== '我確定刪除') { if (confirmText !== null) this.showToast('輸入不正確，取消刪除'); return; }
    try {
      await FirebaseService.deleteEduCoursePlan(teamId, planId);
      const cached = this._eduCoursePlansCache[teamId];
      if (cached) {
        const idx = cached.findIndex(p => p.id === planId);
        if (idx !== -1) cached.splice(idx, 1);
      }
      this.showToast('課程方案已刪除');
      await this.renderEduCoursePlanList(teamId);
    } catch (err) {
      console.error('[deleteEduCoursePlan]', err);
      this.showToast('刪除失敗');
    }
  },

  // ── 排序功能 ──
  async _moveCoursePlan(teamId, planId, direction) {
    const cached = this._eduCoursePlansCache[teamId];
    if (!cached) return;
    const active = cached.filter(p => p.active !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    // 確保每個項目都有 sortOrder
    active.forEach((p, i) => { if (p.sortOrder == null) p.sortOrder = i * 10; });
    const idx = active.findIndex(p => p.id === planId);
    if (idx === -1) return;

    if (direction === 0) {
      // 置頂：目標設為最小值 - 10，其餘不動
      const minOrder = Math.min(...active.map(p => p.sortOrder || 0));
      active[idx].sortOrder = minOrder - 10;
    } else {
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= active.length) return;
      // 交換 sortOrder
      const tmpOrder = active[idx].sortOrder;
      active[idx].sortOrder = active[targetIdx].sortOrder;
      active[targetIdx].sortOrder = tmpOrder;
    }
    // 寫入 Firestore
    for (const p of active) {
      FirebaseService.updateEduCoursePlan(teamId, p.id, { sortOrder: p.sortOrder }).catch(() => {});
    }
    this.showToast(direction === 0 ? '已置頂' : '已排序');
    await this.renderEduCoursePlanList(teamId);
  },
  // ── 簽到資訊彈窗 → edu-course-plan-attendance.js ──
});
