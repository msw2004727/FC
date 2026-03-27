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
    const activePlans = plans.filter(p => p.active !== false);

    if (!activePlans.length) {
      container.innerHTML = '<div class="edu-empty-state">尚未建立課程方案</div>';
      return;
    }

    // 取得當前用戶的報名狀態（用於學員視角按鈕）
    const curUser = ApiService.getCurrentUser();
    const myUid = curUser?.uid;
    const students = this.getEduStudents(teamId);

    // 載入各方案的報名紀錄（用於判斷已報名 + 人數）
    for (const p of activePlans) {
      try {
        const key = this._getCourseEnrollCacheKey?.(teamId, p.id);
        if (key && !this._courseEnrollCache?.[key]) {
          p._enrollments = await this._loadCourseEnrollments?.(teamId, p.id) || [];
        } else {
          p._enrollments = (key && this._courseEnrollCache?.[key]) || [];
        }
      } catch (_) { p._enrollments = []; }
    }

    container.innerHTML = activePlans.map(p => {
      const typeLabel = p.planType === 'weekly' ? '固定週期' : '堂數制';
      // 卡片底色依方案類型
      const cardBg = p.planType === 'weekly'
        ? 'background:linear-gradient(135deg,rgba(13,148,136,.08),rgba(13,148,136,.03))'
        : 'background:linear-gradient(135deg,rgba(124,58,237,.08),rgba(124,58,237,.03))';
      const statusBadge = p.allowSignup
        ? '<span class="edu-cp-status edu-cp-status-open">招生中</span>'
        : '';

      // 封面圖（右側 1/3，寬圖比例 4:3）
      const coverHtml = '<div class="edu-cp-cover">'
        + (p.coverImage ? '<img src="' + escapeHTML(p.coverImage) + '" alt="">' : '<span style="font-size:.72rem;color:var(--text-muted)">無封面</span>')
        + '</div>';

      // 資訊小卡片（由上至下：時間 > 週幾 > 費用 > 人數）
      const chips = [];
      if (p.planType === 'weekly') {
        if (p.startDate) chips.push(escapeHTML(p.startDate) + ' ~ ' + escapeHTML(p.endDate || ''));
        const wdNames = (p.weekdays || []).map(d => '週' + this._weekdayLabel(d)).join('、');
        chips.push(wdNames + (p.timeSlot ? ' ' + escapeHTML(p.timeSlot) : ''));
      } else {
        chips.push('共 ' + (p.totalSessions || 0) + ' 堂');
      }
      if (p.price) chips.push('$' + p.price.toLocaleString());
      chips.push((p.currentCount || 0) + (p.maxCapacity ? '/' + p.maxCapacity : '') + ' 人');
      const infoHtml = '<div class="edu-cp-chips">' + chips.map(c => '<span class="edu-cp-chip">' + c + '</span>').join('') + '</div>';

      // 學員報名按鈕（Fix 7: 全部已報名則灰色）
      let signupBtn = '';
      if (p.allowSignup) {
        const isFull = p.maxCapacity && (p.currentCount || 0) >= p.maxCapacity;
        // 檢查用戶名下所有學員是否都已報名
        const myStudents = students.filter(s =>
          s.enrollStatus !== 'inactive' && (s.selfUid === myUid || s.parentUid === myUid)
        );
        const myEnrollments = (p._enrollments || []).filter(e => e.selfUid === myUid || e.parentUid === myUid);
        const allEnrolled = myStudents.length > 0 && myStudents.every(s =>
          myEnrollments.some(e => e.studentId === s.id && e.status !== 'rejected')
        );

        if (allEnrolled) {
          signupBtn = '<div class="edu-cp-signup-status" style="color:var(--text-muted)">學員皆已報名</div>';
        } else if (isFull) {
          signupBtn = '<div class="edu-cp-signup-status" style="color:var(--text-muted)">已額滿</div>';
        } else {
          signupBtn = '<button class="primary-btn" style="width:100%;margin-top:.4rem" onclick="event.stopPropagation();App.applyCourseEnrollment(\'' + teamId + '\',\'' + p.id + '\')">我要報名</button>';
        }
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
        '<div class="ce-row" style="display:flex;gap:.5rem">' +
          '<div style="flex:1"><label>開始日期</label><input type="date" id="edu-cp-start" value="' + (plan && plan.startDate || '') + '" onchange="App._updateCoursePlanPreview()"></div>' +
          '<div style="flex:1"><label>結束日期</label><input type="date" id="edu-cp-end" value="' + (plan && plan.endDate || '') + '" onchange="App._updateCoursePlanPreview()"></div>' +
        '</div>' +
        '<div class="ce-row"><label>時段</label><input type="text" id="edu-cp-timeslot" maxlength="20" placeholder="09:00-10:30" value="' + escapeHTML(plan && plan.timeSlot || '') + '"></div>' +
        '<div id="edu-cp-preview" class="edu-cp-preview"></div>' +
      '</div>' +
      '<div id="edu-cp-session"' + (!isWeekly ? '' : ' style="display:none"') + '>' +
        '<div class="ce-row"><label>總堂數</label><input type="number" id="edu-cp-total" min="1" max="999" value="' + (plan && plan.totalSessions || '') + '"></div>' +
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

    if (planType === 'weekly') {
      const weekdayCells = document.querySelectorAll('#edu-cp-weekdays .edu-wd-checked');
      data.weekdays = Array.from(weekdayCells).map(c => parseInt(c.dataset.day, 10));
      data.startDate = document.getElementById('edu-cp-start').value || '';
      data.endDate = document.getElementById('edu-cp-end').value || '';
      data.timeSlot = document.getElementById('edu-cp-timeslot').value.trim();
      data.totalSessions = null;
      if (!data.weekdays.length) { _btnState.restore(); this.showToast('請選擇上課日'); return; }
      if (!data.startDate || !data.endDate) { _btnState.restore(); this.showToast('請設定開始和結束日期'); return; }
    } else {
      const total = parseInt(document.getElementById('edu-cp-total').value, 10);
      if (!total || total < 1) { _btnState.restore(); this.showToast('請輸入有效堂數'); return; }
      data.totalSessions = total;
      data.weekdays = null;
      data.startDate = null;
      data.endDate = null;
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
    const active = cached.filter(p => p.active !== false);
    const idx = active.findIndex(p => p.id === planId);
    if (idx === -1) return;
    if (direction === 0) {
      // 置頂
      active.forEach((p, i) => { p.sortOrder = (i === idx) ? -1 : i; });
    } else {
      // 上移(-1) 或下移(+1)
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= active.length) return;
      const tmp = active[idx].sortOrder;
      active[idx].sortOrder = active[targetIdx].sortOrder;
      active[targetIdx].sortOrder = tmp;
    }
    // 寫入 Firestore
    for (const p of active) {
      FirebaseService.updateEduCoursePlan(teamId, p.id, { sortOrder: p.sortOrder || 0 }).catch(() => {});
    }
    await this.renderEduCoursePlanList(teamId);
  },

  // ── 簽到資訊彈窗 ──
  async _showCourseAttendanceInfo(teamId, planId) {
    const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
    const today = new Date().toISOString().slice(0, 10);
    let records = [];
    try {
      records = await FirebaseService.queryEduAttendance({ teamId, coursePlanId: planId, date: today });
    } catch (_) {}
    const students = this.getEduStudents(teamId);

    let bodyHtml = '<div style="text-align:center;margin-bottom:.6rem">'
      + '<div style="font-size:2rem;font-weight:700;color:var(--accent)">' + records.length + '</div>'
      + '<div style="font-size:.82rem;color:var(--text-muted)">今日簽到人數</div></div>';

    if (records.length > 0) {
      bodyHtml += '<div style="max-height:250px;overflow-y:auto">';
      bodyHtml += records.map(r => {
        const stu = students.find(s => s.id === r.studentId);
        const age = stu && stu.birthday ? this.calcAge(stu.birthday) : null;
        const gender = stu?.gender === 'male' ? '♂' : stu?.gender === 'female' ? '♀' : '';
        const groupLabel = (stu?.groupNames || []).join('、') || '未分組';
        return '<div style="padding:.4rem .5rem;border-bottom:1px solid var(--border);font-size:.85rem;display:flex;align-items:center;gap:.4rem">'
          + '<span style="font-weight:600">' + escapeHTML(r.studentName || '') + '</span>'
          + '<span style="color:var(--text-muted);font-size:.78rem">' + gender + (age != null ? ' ' + age + '歲' : '') + '</span>'
          + '<span style="color:var(--text-muted);font-size:.72rem;margin-left:auto">' + escapeHTML(groupLabel) + '</span>'
          + '<span style="font-size:.72rem;color:var(--text-muted)">' + escapeHTML(r.time || '') + '</span>'
          + '</div>';
      }).join('');
      bodyHtml += '</div>';
    } else {
      bodyHtml += '<div style="text-align:center;color:var(--text-muted);font-size:.82rem">今日尚無簽到紀錄</div>';
    }

    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">' + escapeHTML(plan?.name || '簽到資訊') + '</div>'
      + bodyHtml
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem" onclick="this.closest(\'.edu-info-overlay\').remove()">關閉</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

});
