/* ================================================
   SportHub — Education: Batch Check-in
   ================================================
   群組批次簽到（選群組→表格勾選→確認）
   ================================================ */

Object.assign(App, {

  _eduCheckinTeamId: null,
  _eduCheckinGroupId: null,

  async showEduCheckin(teamId) {
    this._eduCheckinTeamId = teamId;
    this._eduCheckinGroupId = null;
    await this.showPage('page-edu-checkin');
    this._renderEduCheckinForm(teamId);
  },

  async _renderEduCheckinForm(teamId) {
    const container = document.getElementById('edu-checkin-container');
    if (!container) return;

    const groups = await this._loadEduGroups(teamId);
    if (!groups.length) {
      container.innerHTML = '<div class="edu-empty-state">請先建立分組</div>';
      return;
    }

    const groupOptions = groups.filter(g => g.active !== false)
      .map(g => '<option value="' + g.id + '">' + escapeHTML(g.name) + '</option>')
      .join('');

    container.innerHTML = '<div class="edu-checkin-form">'
      + '<div class="ce-row"><label>選擇分組</label>'
      + '<select id="edu-ci-group" onchange="App._onEduCheckinGroupChange()">'
      + '<option value="">請選擇分組</option>' + groupOptions
      + '</select></div>'
      + '<div id="edu-ci-plan-row" class="ce-row" style="display:none"><label>課程方案</label>'
      + '<select id="edu-ci-plan"></select></div>'
      + '<div class="ce-row"><label>簽到日期</label>'
      + '<input type="date" id="edu-ci-date" value="' + this._todayStr() + '" onchange="App._onEduCheckinGroupChange()"></div>'
      + '<div id="edu-ci-student-list"></div>'
      + '<div id="edu-ci-actions" style="display:none;margin-top:.5rem">'
      + '<button class="primary-btn" style="width:100%" onclick="App.confirmEduCheckin()">確認簽到</button>'
      + '</div></div>';
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
    try {
      const existing = await FirebaseService.queryEduAttendance({ teamId, groupId, date });
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
    const teamId = this._eduCheckinTeamId;
    const groupId = this._eduCheckinGroupId;
    const coursePlanId = document.getElementById('edu-ci-plan')?.value || '';
    const date = document.getElementById('edu-ci-date')?.value || this._todayStr();
    const time = this._nowTimeStr();

    const checkboxes = document.querySelectorAll('.edu-ci-table tbody input[type="checkbox"]:checked:not(:disabled)');
    if (!checkboxes.length) {
      this.showToast('請至少勾選一位學員');
      return;
    }

    const records = Array.from(checkboxes).map(cb => ({
      id: this._generateEduId('ea'),
      studentId: cb.value,
      studentName: cb.dataset.name || '',
      parentUid: cb.dataset.parentUid || null,
      selfUid: cb.dataset.selfUid || null,
      groupId,
      coursePlanId: coursePlanId || null,
      date,
      time,
      sessionNumber: null,
    }));

    try {
      const fn = firebase.app().functions('asia-east1').httpsCallable('eduCheckin');
      const res = await fn({ teamId, records });
      const count = res.data.count || records.length;

      this.showToast('已簽到 ' + count + ' 位學員');

      if (typeof this._notifyEduCheckin === 'function') {
        this._notifyEduCheckin(teamId, groupId, records);
      }

      await this._onEduCheckinGroupChange();
    } catch (err) {
      console.error('[confirmEduCheckin]', err);
      this.showToast('簽到失敗：' + (err.message || '請稍後再試'));
    }
  },

});
