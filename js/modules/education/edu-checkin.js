/* ================================================
   SportHub — Education: Batch Check-in
   ================================================
   群組批次簽到（選群組→表格勾選→確認）
   ================================================ */

Object.assign(App, {

  _eduCheckinTeamId: null,
  _eduCheckinGroupId: null,
  _ciDebounce: null, _ciCache: {},
  _debouncedCheckinLoad() { clearTimeout(this._ciDebounce); this._ciDebounce = setTimeout(() => this._loadPlanCheckinStudents(), 300); },
  _debouncedCheckinGroup() { clearTimeout(this._ciDebounce); this._ciDebounce = setTimeout(() => this._onEduCheckinGroupChange(), 300); },
  _getCheckinCache(k) { const c = this._ciCache[k]; if (!c || Date.now() - c.t > 30000) { if (c) delete this._ciCache[k]; return null; } return c.d; },
  _setCheckinCache(k, d) { const ks = Object.keys(this._ciCache); if (ks.length >= 20) delete this._ciCache[ks[0]]; this._ciCache[k] = { d, t: Date.now() }; },
  _invalidateCheckinCache(teamId, idPart, date) { delete this._ciCache['ci:' + teamId + ':' + (idPart || '') + ':' + date]; },

  async showEduCheckin(teamId, planId) {
    this._eduCheckinTeamId = teamId;
    this._eduCheckinGroupId = null;
    this._eduCheckinPlanId = planId || null;
    await this.showPage('page-edu-checkin');
    this._renderEduCheckinForm(teamId, planId);
  },

  async _renderEduCheckinForm(teamId, planId) {
    const container = document.getElementById('edu-checkin-container');
    if (!container) return;

    const plan = planId ? this.getEduCoursePlans(teamId).find(p => p.id === planId) : null;

    if (plan) {
      // 從課程方案進入 — 不需選分組，直接顯示方案名 + 日期 + 學員名單
      container.innerHTML = '<div class="edu-checkin-form">'
        + '<div class="ce-row"><label>課程方案</label>'
        + '<input type="text" value="' + escapeHTML(plan.name) + '" disabled style="opacity:.7"></div>'
        + '<div class="ce-row"><label>簽到日期</label>'
        + '<input type="date" id="edu-ci-date" value="' + this._todayStr() + '" onchange="App._debouncedCheckinLoad()"></div>'
        + '<div id="edu-ci-student-list">載入中...</div>'
        + '<div id="edu-ci-actions" style="display:none;margin-top:.5rem">'
        + '<button class="primary-btn" style="width:100%" id="edu-ci-confirm-btn" onclick="App.confirmEduCheckin()">確認簽到</button>'
        + '</div></div>';
      // 自動載入學員
      await this._loadPlanCheckinStudents();
    } else {
      // 舊流程：選分組
      const groups = await this._loadEduGroups(teamId);
      if (!groups.length) {
        container.innerHTML = '<div class="edu-empty-state">請先建立分組</div>';
        return;
      }
      const groupOptions = groups.filter(g => g.active !== false)
        .map(g => '<option value="' + g.id + '">' + escapeHTML(g.name) + '</option>').join('');
      container.innerHTML = '<div class="edu-checkin-form">'
        + '<div class="ce-row"><label>選擇分組</label>'
        + '<select id="edu-ci-group" onchange="App._debouncedCheckinGroup()">'
        + '<option value="">請選擇分組</option>' + groupOptions + '</select></div>'
        + '<div id="edu-ci-plan-row" class="ce-row" style="display:none"><label>課程方案</label>'
        + '<select id="edu-ci-plan"></select></div>'
        + '<div class="ce-row"><label>簽到日期</label>'
        + '<input type="date" id="edu-ci-date" value="' + this._todayStr() + '" onchange="App._debouncedCheckinGroup()"></div>'
        + '<div id="edu-ci-student-list"></div>'
        + '<div id="edu-ci-actions" style="display:none;margin-top:.5rem">'
        + '<button class="primary-btn" style="width:100%" id="edu-ci-confirm-btn" onclick="App.confirmEduCheckin()">確認簽到</button>'
        + '</div></div>';
    }
  },

  async _loadPlanCheckinStudents() {
    const teamId = this._eduCheckinTeamId;
    const planId = this._eduCheckinPlanId;
    const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
    const listEl = document.getElementById('edu-ci-student-list');
    const actionsEl = document.getElementById('edu-ci-actions');
    if (!listEl) return;

    const allStudents = await this._loadEduStudents(teamId);
    // 方案學員 = 分組內 active 學員 + enrollment approved 學員
    const studentIds = new Set();
    if (plan?.groupId) {
      allStudents.filter(s => s.enrollStatus === 'active' && (s.groupIds || []).includes(plan.groupId))
        .forEach(s => studentIds.add(s.id));
    }
    try {
      const enrollments = await this._loadCourseEnrollments(teamId, planId);
      enrollments.filter(e => e.status === 'approved').forEach(e => studentIds.add(e.studentId));
    } catch (_) {}

    const planStudents = allStudents.filter(s => studentIds.has(s.id));
    if (!planStudents.length) {
      listEl.innerHTML = '<div class="edu-empty-state">此方案沒有學員</div>';
      if (actionsEl) actionsEl.style.display = 'none';
      return;
    }

    // 查詢已簽到
    const date = document.getElementById('edu-ci-date')?.value || this._todayStr();
    let checkedIds = new Set();
    const cacheKey = 'ci:' + teamId + ':' + (planId || '') + ':' + date;
    try {
      const cached = this._getCheckinCache(cacheKey);
      const existing = cached || await FirebaseService.queryEduAttendance({ teamId, coursePlanId: planId, date });
      if (!cached) this._setCheckinCache(cacheKey, existing);
      existing.forEach(r => checkedIds.add(r.studentId));
    } catch (_) {}

    // 設定 groupId（取第一個學員的分組）
    this._eduCheckinGroupId = plan?.groupId || (planStudents[0]?.groupIds?.[0]) || '';

    let tableHtml = '<table class="edu-ci-table">'
      + '<thead><tr>'
      + '<th class="edu-ci-th-check"><input type="checkbox" id="edu-ci-select-all" onchange="App._toggleEduCheckinAll(this.checked)"></th>'
      + '<th class="edu-ci-th-name">姓名</th>'
      + '<th class="edu-ci-th-group">組別</th>'
      + '<th class="edu-ci-th-status">出席</th>'
      + '</tr></thead><tbody>';

    planStudents.forEach(s => {
      const alreadyChecked = checkedIds.has(s.id);
      const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
      const genderClass = s.gender === 'male' ? ' edu-gender-male' : s.gender === 'female' ? ' edu-gender-female' : '';
      const groupName = (s.groupNames && s.groupNames[0]) || '';
      const rowClass = alreadyChecked ? ' class="edu-ci-row-done"' : '';
      tableHtml += '<tr' + rowClass + '>'
        + '<td class="edu-ci-td-check"><input type="checkbox" value="' + s.id + '" data-name="' + escapeHTML(s.name) + '"'
        + ' data-parent-uid="' + (s.parentUid || '') + '" data-self-uid="' + (s.selfUid || '') + '"'
        + (alreadyChecked ? ' checked disabled' : '') + '></td>'
        + '<td class="edu-ci-td-name">' + escapeHTML(s.name)
        + (genderIcon ? ' <span class="edu-student-gender' + genderClass + '">' + genderIcon + '</span>' : '') + '</td>'
        + '<td class="edu-ci-td-group">' + escapeHTML(groupName) + '</td>'
        + '<td class="edu-ci-td-status">' + (alreadyChecked ? '<span class="edu-ci-done-badge">✓ 已簽到</span>' : '') + '</td></tr>';
    });
    tableHtml += '</tbody></table>';
    listEl.innerHTML = tableHtml;
    if (actionsEl) actionsEl.style.display = '';
  },

  async _onEduCheckinGroupChange() {
    const groupId = document.getElementById('edu-ci-group').value;
    this._eduCheckinGroupId = groupId;
    const listEl = document.getElementById('edu-ci-student-list');
    const actionsEl = document.getElementById('edu-ci-actions');
    const planRowEl = document.getElementById('edu-ci-plan-row');
    if (!groupId || !listEl) {
      if (listEl) listEl.innerHTML = '';
      if (actionsEl) actionsEl.style.display = 'none';
      if (planRowEl) planRowEl.style.display = 'none';
      return;
    }

    const teamId = this._eduCheckinTeamId;

    // 課程方案：只顯示綁定此分組的
    const plans = this.getEduCoursePlans(teamId);
    const groupPlans = plans.filter(p => p.active !== false && p.groupId === groupId);
    if (groupPlans.length && planRowEl) {
      const planSelect = document.getElementById('edu-ci-plan');
      planSelect.innerHTML = '<option value="">不指定</option>'
        + groupPlans.map(p => '<option value="' + p.id + '">' + escapeHTML(p.name) + '</option>').join('');
      planRowEl.style.display = '';
    } else if (planRowEl) {
      planRowEl.style.display = 'none';
    }

    // 載入學員
    const students = await this._loadEduStudents(teamId);
    const groupStudents = students.filter(s =>
      s.enrollStatus === 'active' && (s.groupIds || []).includes(groupId)
    );
    const groups = this.getEduGroups(teamId);
    const group = groups.find(g => g.id === groupId);

    if (!groupStudents.length) {
      listEl.innerHTML = '<div class="edu-empty-state">此分組沒有學員</div>';
      actionsEl.style.display = 'none';
      return;
    }

    // 查詢已簽到
    const date = document.getElementById('edu-ci-date').value || this._todayStr();
    let checkedIds = new Set();
    const cacheKey = 'ci:' + teamId + ':' + (groupId || '') + ':' + date;
    try {
      const cached = this._getCheckinCache(cacheKey);
      const existing = cached || await FirebaseService.queryEduAttendance({ teamId, groupId, date });
      if (!cached) this._setCheckinCache(cacheKey, existing);
      existing.forEach(r => checkedIds.add(r.studentId));
    } catch (_) {}

    // 表格式簽到列表
    let tableHtml = '<table class="edu-ci-table">'
      + '<thead><tr>'
      + '<th class="edu-ci-th-check"><input type="checkbox" id="edu-ci-select-all" onchange="App._toggleEduCheckinAll(this.checked)"></th>'
      + '<th class="edu-ci-th-name">姓名</th>'
      + '<th class="edu-ci-th-group">組別</th>'
      + '<th class="edu-ci-th-status">出席</th>'
      + '</tr></thead><tbody>';

    groupStudents.forEach(s => {
      const alreadyChecked = checkedIds.has(s.id);
      const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
      const genderClass = s.gender === 'male' ? ' edu-gender-male' : s.gender === 'female' ? ' edu-gender-female' : '';
      const groupName = group ? group.name : (s.groupNames && s.groupNames[0]) || '';
      const rowClass = alreadyChecked ? ' class="edu-ci-row-done"' : '';

      tableHtml += '<tr' + rowClass + '>'
        + '<td class="edu-ci-td-check">'
        + '<input type="checkbox" value="' + s.id + '" data-name="' + escapeHTML(s.name) + '"'
        + ' data-parent-uid="' + (s.parentUid || '') + '"'
        + ' data-self-uid="' + (s.selfUid || '') + '"'
        + (alreadyChecked ? ' checked disabled' : '') + '>'
        + '</td>'
        + '<td class="edu-ci-td-name">' + escapeHTML(s.name)
        + (genderIcon ? ' <span class="edu-student-gender' + genderClass + '">' + genderIcon + '</span>' : '')
        + '</td>'
        + '<td class="edu-ci-td-group">' + escapeHTML(groupName) + '</td>'
        + '<td class="edu-ci-td-status">'
        + (alreadyChecked ? '<span class="edu-ci-done-badge">✓ 已簽到</span>' : '')
        + '</td>'
        + '</tr>';
    });

    tableHtml += '</tbody></table>';
    listEl.innerHTML = tableHtml;
    actionsEl.style.display = '';
  },

  _toggleEduCheckinAll(checked) {
    const checkboxes = document.querySelectorAll('.edu-ci-table tbody input[type="checkbox"]:not(:disabled)');
    checkboxes.forEach(cb => { cb.checked = checked; });
  },

  async confirmEduCheckin() {
    const _btnState = this._setEduBtnLoading('#edu-ci-confirm-btn');
    const teamId = this._eduCheckinTeamId;
    const groupId = this._eduCheckinGroupId;
    const coursePlanId = this._eduCheckinPlanId || document.getElementById('edu-ci-plan')?.value || '';
    const date = document.getElementById('edu-ci-date')?.value || this._todayStr();
    const time = this._nowTimeStr();

    const checkboxes = document.querySelectorAll('.edu-ci-table tbody input[type="checkbox"]:checked:not(:disabled)');
    if (!checkboxes.length) {
      this.showToast('請至少勾選一位學員');
      _btnState.restore();
      return;
    }

    const records = Array.from(checkboxes).map(cb => ({
      studentId: cb.value,
      studentName: cb.dataset.name || '',
      parentUid: cb.dataset.parentUid || null,
      selfUid: cb.dataset.selfUid || null,
    }));

    try {
      // 前端直接 Firestore Batch Write（比照活動簽到，原子操作）
      const batch = firebase.firestore().batch();
      for (const r of records) {
        const docRef = firebase.firestore().collection('eduAttendance').doc();
        batch.set(docRef, {
          id: docRef.id, teamId, groupId: groupId || '', coursePlanId: coursePlanId || null,
          studentId: r.studentId, studentName: r.studentName,
          parentUid: r.parentUid, selfUid: r.selfUid,
          date, time, sessionNumber: null, status: 'active',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();

      this.showToast('已簽到 ' + records.length + ' 位學員');
      this._invalidateCheckinCache(teamId, coursePlanId || groupId, date);

      if (typeof this._notifyEduCheckin === 'function') {
        this._notifyEduCheckin(teamId, groupId, records.map(r => Object.assign({}, r, { groupId, date, time })));
      }

      // 成功：重新載入學員列表（顯示已簽到狀態）
      if (this._eduCheckinPlanId) {
        await this._loadPlanCheckinStudents();
      } else {
        await this._onEduCheckinGroupChange();
      }
    } catch (err) {
      console.error('[confirmEduCheckin] batch failed:', err);
      // 失敗：保留勾選狀態，讓用戶直接重試
      this.showToast('簽到失敗，勾選已保留\n請再按一次「確認簽到」重試');
    } finally {
      _btnState.restore();
    }
  },

});
