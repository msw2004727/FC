/* ================================================
   SportHub — Education: Batch Check-in
   ================================================
   群組批次簽到（選群組→勾選學員→確認）
   ================================================ */

Object.assign(App, {

  _eduCheckinTeamId: null,
  _eduCheckinGroupId: null,
  _eduCheckinCoursePlanId: null,

  /**
   * 顯示批次簽到頁面
   */
  async showEduCheckin(teamId) {
    this._eduCheckinTeamId = teamId;
    this._eduCheckinGroupId = null;
    this._eduCheckinCoursePlanId = null;
    await this.showPage('page-edu-checkin');
    this._renderEduCheckinGroupSelector(teamId);
  },

  /**
   * 渲染群組選擇器
   */
  async _renderEduCheckinGroupSelector(teamId) {
    const container = document.getElementById('edu-checkin-container');
    if (!container) return;

    const groups = await this._loadEduGroups(teamId);
    const plans = await this._loadEduCoursePlans(teamId);

    if (!groups.length) {
      container.innerHTML = '<div class="edu-empty-state">請先建立分組</div>';
      return;
    }

    const groupOptions = groups.filter(g => g.active !== false)
      .map(g => '<option value="' + g.id + '">' + escapeHTML(g.name) + '</option>')
      .join('');

    const planOptions = plans.filter(p => p.active !== false)
      .map(p => '<option value="' + p.id + '">' + escapeHTML(p.name) + ' (' + escapeHTML(p.groupName || '') + ')</option>')
      .join('');

    container.innerHTML = '<div class="edu-checkin-form">' +
      '<div class="ce-row"><label>選擇分組</label>' +
        '<select id="edu-ci-group" onchange="App._onEduCheckinGroupChange()">' +
          '<option value="">請選擇分組</option>' + groupOptions +
        '</select></div>' +
      '<div class="ce-row"><label>課程方案（選填）</label>' +
        '<select id="edu-ci-plan">' +
          '<option value="">不指定</option>' + planOptions +
        '</select></div>' +
      '<div class="ce-row"><label>簽到日期</label>' +
        '<input type="date" id="edu-ci-date" value="' + this._todayStr() + '"></div>' +
      '<div id="edu-ci-student-list"></div>' +
      '<div id="edu-ci-actions" style="display:none;margin-top:.5rem">' +
        '<button class="primary-btn" style="width:100%" onclick="App.confirmEduCheckin()">確認簽到</button>' +
      '</div>' +
    '</div>';
  },

  /**
   * 選擇分組後載入該分組的學員
   */
  async _onEduCheckinGroupChange() {
    const groupId = document.getElementById('edu-ci-group').value;
    this._eduCheckinGroupId = groupId;
    const listEl = document.getElementById('edu-ci-student-list');
    const actionsEl = document.getElementById('edu-ci-actions');
    if (!groupId || !listEl) {
      if (listEl) listEl.innerHTML = '';
      if (actionsEl) actionsEl.style.display = 'none';
      return;
    }

    const teamId = this._eduCheckinTeamId;
    const students = await this._loadEduStudents(teamId);
    const groupStudents = students.filter(s =>
      s.enrollStatus === 'active' && (s.groupIds || []).includes(groupId)
    );

    if (!groupStudents.length) {
      listEl.innerHTML = '<div class="edu-empty-state">此分組沒有學員</div>';
      actionsEl.style.display = 'none';
      return;
    }

    // 查詢今天已簽到的學員
    const date = document.getElementById('edu-ci-date').value || this._todayStr();
    let checkedIds = new Set();
    try {
      const existing = await FirebaseService.queryEduAttendance({
        teamId, groupId, date,
      });
      existing.forEach(r => checkedIds.add(r.studentId));
    } catch (_) {}

    listEl.innerHTML = '<div class="edu-checkin-list">' +
      '<label class="edu-checkbox-label" style="font-weight:600;border-bottom:1px solid var(--border);padding-bottom:.3rem;margin-bottom:.3rem">' +
        '<input type="checkbox" id="edu-ci-select-all" onchange="App._toggleEduCheckinAll(this.checked)"> 全選</label>' +
      groupStudents.map(s => {
        const alreadyChecked = checkedIds.has(s.id);
        const age = this.calcAge(s.birthday);
        const ageLabel = age != null ? ' (' + age + '歲)' : '';
        return '<label class="edu-checkbox-label' + (alreadyChecked ? ' edu-already-checked' : '') + '">' +
          '<input type="checkbox" value="' + s.id + '" data-name="' + escapeHTML(s.name) + '"' +
          ' data-parent-uid="' + (s.parentUid || '') + '"' +
          ' data-self-uid="' + (s.selfUid || '') + '"' +
          (alreadyChecked ? ' checked disabled' : '') + '> ' +
          escapeHTML(s.name) + ageLabel +
          (alreadyChecked ? ' <span style="font-size:.68rem;color:var(--success)">✓ 已簽到</span>' : '') +
        '</label>';
      }).join('') +
    '</div>';

    actionsEl.style.display = '';
  },

  _toggleEduCheckinAll(checked) {
    const checkboxes = document.querySelectorAll('#edu-ci-student-list input[type="checkbox"]:not(:disabled):not(#edu-ci-select-all)');
    checkboxes.forEach(cb => { cb.checked = checked; });
  },

  /**
   * 確認簽到
   */
  async confirmEduCheckin() {
    const teamId = this._eduCheckinTeamId;
    const groupId = this._eduCheckinGroupId;
    const coursePlanId = document.getElementById('edu-ci-plan')?.value || '';
    const date = document.getElementById('edu-ci-date')?.value || this._todayStr();
    const time = this._nowTimeStr();

    const checkboxes = document.querySelectorAll('#edu-ci-student-list input[type="checkbox"]:checked:not(:disabled):not(#edu-ci-select-all)');
    if (!checkboxes.length) {
      this.showToast('請至少勾選一位學員');
      return;
    }

    const curUser = ApiService.getCurrentUser();
    const checkedInByUid = curUser?.uid || '';

    const students = Array.from(checkboxes).map(cb => ({
      studentId: cb.value,
      studentName: cb.dataset.name || '',
      parentUid: cb.dataset.parentUid || null,
      selfUid: cb.dataset.selfUid || null,
    }));

    try {
      const results = [];
      for (const s of students) {
        const record = {
          id: this._generateEduId('ea'),
          teamId,
          groupId,
          coursePlanId: coursePlanId || null,
          studentId: s.studentId,
          studentName: s.studentName,
          parentUid: s.parentUid || null,
          selfUid: s.selfUid || null,
          checkedInByUid,
          date,
          time,
          sessionNumber: null,
          status: 'active',
        };
        const result = await FirebaseService.addEduAttendance(record);
        results.push(result);
      }

      this.showToast('已簽到 ' + results.length + ' 位學員');

      // 觸發通知
      if (typeof this._notifyEduCheckin === 'function') {
        this._notifyEduCheckin(teamId, groupId, results);
      }

      // 重新渲染
      await this._onEduCheckinGroupChange();
    } catch (err) {
      console.error('[confirmEduCheckin]', err);
      this.showToast('簽到失敗：' + (err.message || '請稍後再試'));
    }
  },

});
