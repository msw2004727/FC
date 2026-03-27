/* ================================================
   SportHub — Education: Course Plan CRUD
   ================================================
   課程方案管理（週期制 + 堂數制）
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

  async renderEduCoursePlanList(teamId, isStaff) {
    const container = document.getElementById('edu-course-plan-list');
    if (!container) return;

    // 若未傳入 isStaff，自動判斷
    if (isStaff === undefined) isStaff = this.isEduClubStaff(teamId);

    const plans = await this._loadEduCoursePlans(teamId);
    const activePlans = plans.filter(p => p.active !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    if (!activePlans.length) {
      container.innerHTML = '<div class="edu-empty-state">尚未建立課程方案</div>';
      return;
    }

    // 取得當前用戶的報名狀態（用於學員視角按鈕）
    const curUser = ApiService.getCurrentUser();
    const myUid = curUser?.uid;
    const students = this.getEduStudents(teamId);

    // 載入各方案的報名紀錄 + 計算含分組學員的實際人數
    for (const p of activePlans) {
      try {
        const key = this._getCourseEnrollCacheKey?.(teamId, p.id);
        if (key && !this._courseEnrollCache?.[key]) {
          p._enrollments = await this._loadCourseEnrollments?.(teamId, p.id) || [];
        } else {
          p._enrollments = (key && this._courseEnrollCache?.[key]) || [];
        }
      } catch (_) { p._enrollments = []; }
      // 計算實際人數：approved enrollments + 分組內 active 學員（不重複）
      const enrolledIds = new Set(p._enrollments.filter(e => e.status === 'approved').map(e => e.studentId));
      if (p.groupId) {
        students.filter(s => s.enrollStatus === 'active' && (s.groupIds || []).includes(p.groupId))
          .forEach(s => enrolledIds.add(s.id));
      }
      p._effectiveCount = enrolledIds.size;
    }

    container.innerHTML = activePlans.map(p => {
      const typeLabel = p.planType === 'weekly' ? '固定週期' : '堂數制';
      // 卡片底色依方案類型
      const cardBg = p.planType === 'weekly'
        ? 'background:linear-gradient(135deg,rgba(13,148,136,.08),rgba(13,148,136,.03))'
        : 'background:linear-gradient(135deg,rgba(124,58,237,.08),rgba(124,58,237,.03))';
      const todayCheck = new Date().toISOString().slice(0, 10);
      const planEnded = p.endDate && p.endDate < todayCheck;
      const statusBadge = planEnded
        ? '<span class="edu-cp-status" style="background:rgba(148,163,184,.15);color:#94a3b8">已結束</span>'
        : p.allowSignup
          ? '<span class="edu-cp-status edu-cp-status-open">招生中</span>'
          : '';

      // 封面圖（右側 1/3，寬圖比例 4:3）
      const coverHtml = '<div class="edu-cp-cover">'
        + (p.coverImage ? '<img src="' + escapeHTML(p.coverImage) + '" alt="">' : '<span style="font-size:.72rem;color:var(--text-muted)">無封面</span>')
        + '</div>';

      // 課程是否已結束
      const today = new Date().toISOString().slice(0, 10);
      const isEnded = p.endDate && p.endDate < today;

      // 資訊小卡片（由上至下：日期 > 週幾/堂數 > 費用 > 人數）
      const chips = [];
      if (p.startDate) chips.push(escapeHTML(p.startDate) + ' ~ ' + escapeHTML(p.endDate || ''));
      if (p.planType === 'weekly') {
        const wdNames = (p.weekdays || []).map(d => '週' + this._weekdayLabel(d)).join('、');
        chips.push(wdNames + (p.timeSlot ? ' ' + escapeHTML(p.timeSlot) : ''));
      } else {
        chips.push('共 ' + (p.totalSessions || 0) + ' 堂');
      }
      if (p.price) chips.push('$' + p.price.toLocaleString());
      chips.push((p._effectiveCount || 0) + (p.maxCapacity ? '/' + p.maxCapacity : '') + ' 人');
      const infoHtml = '<div class="edu-cp-chips">' + chips.map(c => '<span class="edu-cp-chip">' + c + '</span>').join('') + '</div>';

      // 學員報名按鈕
      let signupBtn = '';
      if (p.allowSignup) {
        if (isEnded) {
          signupBtn = '<button class="primary-btn" style="width:100%;margin-top:.4rem;opacity:.45" disabled>課程已結束</button>';
        } else {
        const isFull = p.maxCapacity && (p._effectiveCount || 0) >= p.maxCapacity;
        // 檢查用戶名下所有學員是否都已報名（含分組自動導入的）
        const myStudents = students.filter(s =>
          s.enrollStatus !== 'inactive' && (s.selfUid === myUid || s.parentUid === myUid)
        );
        // 分組學員也視為已報名
        const enrolledStudentIds = new Set(
          (p._enrollments || []).filter(e => e.status !== 'rejected').map(e => e.studentId)
        );
        if (p.groupId) {
          students.filter(s => s.enrollStatus === 'active' && (s.groupIds || []).includes(p.groupId))
            .forEach(s => enrolledStudentIds.add(s.id));
        }
        const allEnrolled = myStudents.length > 0 && myStudents.every(s => enrolledStudentIds.has(s.id));

        if (allEnrolled) {
          signupBtn = '<button class="primary-btn" style="width:100%;margin-top:.4rem;opacity:.45" disabled>學員皆已報名</button>';
        } else if (isFull) {
          signupBtn = '<button class="primary-btn" style="width:100%;margin-top:.4rem;opacity:.45" disabled>已額滿</button>';
        } else {
          signupBtn = '<button class="primary-btn" style="width:100%;margin-top:.4rem" onclick="event.stopPropagation();App.applyCourseEnrollment(\'' + teamId + '\',\'' + p.id + '\')">我要報名</button>';
        }
        } // end else (not ended)
      }

      // 管理按鈕（報名按鈕之下，左對齊 + 右側排序按鈕）
      const idx = activePlans.indexOf(p);
      const manageHtml = isStaff
        ? '<div class="edu-cp-manage-left">'
          + '<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="event.stopPropagation();App.showEduCoursePlanForm(\'' + teamId + '\',\'' + p.id + '\')">編輯</button>'
          + '<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem;color:var(--danger)" onclick="event.stopPropagation();App.deleteEduCoursePlan(\'' + teamId + '\',\'' + p.id + '\')">刪除</button>'
          + '<span style="margin-left:auto;display:flex;gap:.2rem">'
          + (idx > 0 ? '<button class="outline-btn" style="font-size:.68rem;padding:.15rem .35rem" onclick="event.stopPropagation();App._moveCoursePlan(\'' + teamId + '\',\'' + p.id + '\',-1)" title="向上">▲</button>' : '')
          + (idx < activePlans.length - 1 ? '<button class="outline-btn" style="font-size:.68rem;padding:.15rem .35rem" onclick="event.stopPropagation();App._moveCoursePlan(\'' + teamId + '\',\'' + p.id + '\',1)" title="向下">▼</button>' : '')
          + '<button class="outline-btn" style="font-size:.68rem;padding:.15rem .35rem" onclick="event.stopPropagation();App._moveCoursePlan(\'' + teamId + '\',\'' + p.id + '\',0)" title="置頂">★</button>'
          + '</span>'
          + '</div>'
        : '';

      const clickAction = isStaff
        ? ' onclick="App.showCourseEnrollmentList(\'' + teamId + '\',\'' + p.id + '\')"'
        : '';

      return '<div class="edu-course-card edu-cp-card-v2" style="' + cardBg + '"' + clickAction + '>'
        + '<div class="edu-cp-body">'
        + '<div class="edu-cp-left">'
        + '<div class="edu-cp-top">'
        + '<span class="edu-course-name">' + escapeHTML(p.name) + '</span>'
        + '<span class="edu-cp-type-text ' + (p.planType === 'weekly' ? 'edu-cp-type-weekly' : 'edu-cp-type-session') + '">' + typeLabel + '</span>'
        + statusBadge
        + '</div>'
        + infoHtml
        + '</div>'
        + coverHtml
        + '</div>'
        + signupBtn
        + manageHtml
        + '</div>';
    }).join('');
  },

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

  // ── 簽到資訊彈窗（月曆式）──
  _attendInfoMonth: null,
  _attendInfoYear: null,

  async _showCourseAttendanceInfo(teamId, planId) {
    const now = new Date();
    this._attendInfoMonth = now.getMonth();
    this._attendInfoYear = now.getFullYear();
    this._attendInfoTeamId = teamId;
    this._attendInfoPlanId = planId;

    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.id = '_eduAttendInfoOverlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
    overlay.innerHTML = '<div class="edu-info-dialog" style="max-width:420px">'
      + '<div class="edu-info-dialog-title">' + escapeHTML(plan?.name || '簽到資訊') + '</div>'
      + '<div id="_eduAttendCalBody">載入中...</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem" onclick="this.closest(\'.edu-info-overlay\').remove()">關閉</button>'
      + '</div>';
    document.body.appendChild(overlay);
    await this._renderAttendInfoCalendar();
  },

  async _renderAttendInfoCalendar() {
    const body = document.getElementById('_eduAttendCalBody');
    if (!body) return;
    const teamId = this._attendInfoTeamId;
    const planId = this._attendInfoPlanId;
    const year = this._attendInfoYear;
    const month = this._attendInfoMonth;
    const students = this.getEduStudents(teamId);

    // 月份所有天的簽到紀錄
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let allRecords = [];
    try {
      allRecords = await FirebaseService.queryEduAttendance({ teamId, coursePlanId: planId });
    } catch (_) {}

    // 按日期分組
    const byDate = {};
    allRecords.forEach(r => {
      if (!r.date) return;
      if (r.date < firstDay.toISOString().slice(0, 10) || r.date > lastDay.toISOString().slice(0, 10)) return;
      if (!byDate[r.date]) byDate[r.date] = [];
      byDate[r.date].push(r);
    });

    const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    let html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">'
      + '<button class="outline-btn" style="font-size:.75rem;padding:.2rem .5rem" onclick="App._attendInfoNav(-1)">◀</button>'
      + '<span style="font-weight:700;font-size:.92rem">' + year + '年 ' + monthNames[month] + '</span>'
      + '<button class="outline-btn" style="font-size:.75rem;padding:.2rem .5rem" onclick="App._attendInfoNav(1)">▶</button>'
      + '</div>';

    // 月曆
    html += '<div class="edu-cal-grid" style="grid-template-columns:repeat(7,1fr);display:grid;gap:2px;text-align:center">';
    ['日','一','二','三','四','五','六'].forEach(d => {
      html += '<div style="font-size:.68rem;color:var(--text-muted);font-weight:600;padding:.2rem 0">' + d + '</div>';
    });
    const startPad = firstDay.getDay();
    for (let i = 0; i < startPad; i++) html += '<div></div>';
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const dayRecords = byDate[dateStr] || [];
      const count = dayRecords.length;
      if (count > 0) {
        html += '<div class="edu-attend-cal-cell edu-attend-cal-has" onclick="App._showAttendDayDetail(\'' + dateStr + '\')" title="' + count + '人簽到">'
          + '<div class="edu-attend-cal-day">' + d + '</div>'
          + '<div class="edu-attend-cal-count">' + count + '</div></div>';
      } else {
        html += '<div class="edu-attend-cal-cell"><div class="edu-attend-cal-day" style="color:var(--text-muted)">' + d + '</div></div>';
      }
    }
    html += '</div>';
    body.innerHTML = html;
  },

  _attendInfoNav(dir) {
    this._attendInfoMonth += dir;
    if (this._attendInfoMonth > 11) { this._attendInfoMonth = 0; this._attendInfoYear++; }
    if (this._attendInfoMonth < 0) { this._attendInfoMonth = 11; this._attendInfoYear--; }
    this._renderAttendInfoCalendar();
  },

  async _showAttendDayDetail(dateStr) {
    const teamId = this._attendInfoTeamId;
    const planId = this._attendInfoPlanId;
    const students = this.getEduStudents(teamId);
    let records = [];
    try {
      records = await FirebaseService.queryEduAttendance({ teamId, coursePlanId: planId, date: dateStr });
    } catch (_) {}

    let listHtml = records.length
      ? records.map(r => {
          const stu = students.find(s => s.id === r.studentId);
          const age = stu && stu.birthday ? this.calcAge(stu.birthday) : null;
          const gender = stu?.gender === 'male' ? '♂' : stu?.gender === 'female' ? '♀' : '';
          const groupLabel = (stu?.groupNames || []).join('、') || '';
          return '<div style="padding:.4rem .5rem;border-bottom:1px solid var(--border);font-size:.85rem;display:flex;align-items:center;gap:.4rem">'
            + '<span style="font-weight:600">' + escapeHTML(r.studentName || '') + '</span>'
            + '<span style="font-size:.78rem;color:var(--text-muted)">' + gender + (age != null ? ' ' + age + '歲' : '') + '</span>'
            + '<span style="font-size:.72rem;color:var(--text-muted);margin-left:auto">' + escapeHTML(groupLabel) + '</span>'
            + '<span style="font-size:.72rem;color:var(--text-muted)">' + escapeHTML(r.time || '') + '</span></div>';
        }).join('')
      : '<div style="text-align:center;color:var(--text-muted);padding:.8rem">無簽到紀錄</div>';

    const overlay2 = document.createElement('div');
    overlay2.className = 'edu-info-overlay';
    overlay2.style.zIndex = '1210';
    overlay2.onclick = (e) => { if (e.target === overlay2) overlay2.remove(); };
    overlay2.innerHTML = '<div class="edu-info-dialog" style="max-width:380px">'
      + '<div class="edu-info-dialog-title">' + dateStr + ' 簽到名單（' + records.length + '人）</div>'
      + '<div style="max-height:300px;overflow-y:auto">' + listHtml + '</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.6rem" onclick="this.closest(\'.edu-info-overlay\').remove()">關閉</button>'
      + '</div>';
    document.body.appendChild(overlay2);
  },

});
