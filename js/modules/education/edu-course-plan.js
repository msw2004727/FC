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

  async renderEduCoursePlanList(teamId) {
    const container = document.getElementById('edu-course-plan-list');
    if (!container) return;

    const plans = await this._loadEduCoursePlans(teamId);
    const activePlans = plans.filter(p => p.active !== false);

    if (!activePlans.length) {
      container.innerHTML = '<div class="edu-empty-state">尚未建立課程方案</div>';
      return;
    }

    container.innerHTML = activePlans.map(p => {
      const typeLabel = p.planType === 'weekly' ? '固定週期' : '堂數制';
      let scheduleInfo = '';
      if (p.planType === 'weekly') {
        const weekdayNames = (p.weekdays || []).map(d => '週' + this._weekdayLabel(d)).join('、');
        scheduleInfo = weekdayNames + (p.timeSlot ? ' ' + escapeHTML(p.timeSlot) : '') +
          '<br><span style="font-size:.68rem;color:var(--text-muted)">' +
          escapeHTML(p.startDate || '') + ' ~ ' + escapeHTML(p.endDate || '') + '</span>';
      } else {
        scheduleInfo = '共 ' + (p.totalSessions || 0) + ' 堂';
      }

      return '<div class="edu-course-card">' +
        '<div class="edu-course-header">' +
          '<span class="edu-course-name">' + escapeHTML(p.name) + '</span>' +
          '<span class="edu-course-type">' + typeLabel + '</span>' +
        '</div>' +
        '<div class="edu-course-group">分組：' + escapeHTML(p.groupName || '未指定') + '</div>' +
        '<div class="edu-course-schedule">' + scheduleInfo + '</div>' +
        '<div class="edu-course-actions">' +
          '<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="App.showEduCoursePlanForm(\'' + teamId + '\',\'' + p.id + '\')">編輯</button>' +
          '<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem;color:var(--danger)" onclick="App.deleteEduCoursePlan(\'' + teamId + '\',\'' + p.id + '\')">刪除</button>' +
        '</div>' +
      '</div>';
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
      '<div class="ce-row"><label>方案名稱 <span class="required">*必填</span></label>' +
        '<input type="text" id="edu-cp-name" maxlength="30" placeholder="例：2026 春季班" value="' + escapeHTML(plan ? plan.name : '') + '"></div>' +
      '<div class="ce-row"><label>對應分組</label>' +
        '<select id="edu-cp-group">' + groupOptions + '</select></div>' +
      '<div class="ce-row"><label>方案類型</label>' +
        '<select id="edu-cp-type" onchange="App._toggleCoursePlanType(this.value)">' +
          '<option value="weekly"' + (isWeekly ? ' selected' : '') + '>固定週期</option>' +
          '<option value="session"' + (!isWeekly ? ' selected' : '') + '>堂數制</option>' +
        '</select></div>' +
      '<div id="edu-cp-weekly"' + (isWeekly ? '' : ' style="display:none"') + '>' +
        '<div class="ce-row"><label>上課日（可多選）</label>' +
          '<div id="edu-cp-weekdays" class="edu-checkbox-group">' +
            [0,1,2,3,4,5,6].map(d => {
              const checked = plan && plan.weekdays && plan.weekdays.includes(d) ? ' checked' : '';
              return '<label class="edu-checkbox-label"><input type="checkbox" value="' + d + '"' + checked + '> 週' + this._weekdayLabel(d) + '</label>';
            }).join('') +
          '</div></div>' +
        '<div class="ce-row" style="display:flex;gap:.5rem">' +
          '<div style="flex:1"><label>開始日期</label><input type="date" id="edu-cp-start" value="' + (plan && plan.startDate || '') + '"></div>' +
          '<div style="flex:1"><label>結束日期</label><input type="date" id="edu-cp-end" value="' + (plan && plan.endDate || '') + '"></div>' +
        '</div>' +
        '<div class="ce-row"><label>時段</label><input type="text" id="edu-cp-timeslot" maxlength="20" placeholder="09:00-10:30" value="' + escapeHTML(plan && plan.timeSlot || '') + '"></div>' +
      '</div>' +
      '<div id="edu-cp-session"' + (!isWeekly ? '' : ' style="display:none"') + '>' +
        '<div class="ce-row"><label>總堂數</label><input type="number" id="edu-cp-total" min="1" max="999" value="' + (plan && plan.totalSessions || '') + '"></div>' +
      '</div>' +
      '<div style="display:flex;gap:.5rem;margin-top:1rem">' +
        '<button class="outline-btn" onclick="App.goBack()">取消</button>' +
        '<button class="primary-btn" onclick="App.handleSaveEduCoursePlan()">' + (planId ? '儲存變更' : '建立方案') + '</button>' +
      '</div>' +
    '</div>';
  },

  _toggleCoursePlanType(type) {
    const weeklyEl = document.getElementById('edu-cp-weekly');
    const sessionEl = document.getElementById('edu-cp-session');
    if (weeklyEl) weeklyEl.style.display = type === 'weekly' ? '' : 'none';
    if (sessionEl) sessionEl.style.display = type === 'session' ? '' : 'none';
  },

  async handleSaveEduCoursePlan() {
    const teamId = this._eduCoursePlanEditTeamId;
    const planId = this._eduCoursePlanEditId;
    const name = document.getElementById('edu-cp-name').value.trim();
    if (!name) { this.showToast('請輸入方案名稱'); return; }

    const groupSelect = document.getElementById('edu-cp-group');
    const groupId = groupSelect ? groupSelect.value : '';
    const groupName = groupSelect ? (groupSelect.selectedOptions[0]?.dataset?.name || '') : '';
    const planType = document.getElementById('edu-cp-type').value;

    const data = {
      name,
      groupId,
      groupName,
      planType,
      active: true,
    };

    if (planType === 'weekly') {
      const weekdayEls = document.querySelectorAll('#edu-cp-weekdays input:checked');
      data.weekdays = Array.from(weekdayEls).map(el => parseInt(el.value, 10));
      data.startDate = document.getElementById('edu-cp-start').value || '';
      data.endDate = document.getElementById('edu-cp-end').value || '';
      data.timeSlot = document.getElementById('edu-cp-timeslot').value.trim();
      data.totalSessions = null;
      if (!data.weekdays.length) { this.showToast('請選擇上課日'); return; }
      if (!data.startDate || !data.endDate) { this.showToast('請設定開始和結束日期'); return; }
    } else {
      const total = parseInt(document.getElementById('edu-cp-total').value, 10);
      if (!total || total < 1) { this.showToast('請輸入有效堂數'); return; }
      data.totalSessions = total;
      data.weekdays = null;
      data.startDate = null;
      data.endDate = null;
      data.timeSlot = null;
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
        const result = await FirebaseService.createEduCoursePlan(teamId, data);
        const cached = this._eduCoursePlansCache[teamId];
        if (cached) cached.push(result);
        else this._eduCoursePlansCache[teamId] = [result];
        this.showToast('課程方案已建立');
      }
      this.goBack();
    } catch (err) {
      console.error('[handleSaveEduCoursePlan]', err);
      this.showToast('儲存失敗：' + (err.message || '請稍後再試'));
    }
  },

  async deleteEduCoursePlan(teamId, planId) {
    if (!(await this.appConfirm('確定要刪除此課程方案？'))) return;
    try {
      await FirebaseService.deleteEduCoursePlan(teamId, planId);
      const cached = this._eduCoursePlansCache[teamId];
      if (cached) {
        const idx = cached.findIndex(p => p.id === planId);
        if (idx !== -1) cached.splice(idx, 1);
      }
      this.showToast('課程方案已刪除');
      this.renderEduCoursePlanList(teamId);
    } catch (err) {
      console.error('[deleteEduCoursePlan]', err);
      this.showToast('刪除失敗');
    }
  },

});
