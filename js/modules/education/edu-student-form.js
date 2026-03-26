/* ================================================
   SportHub — Education: Student CRUD Form
   ================================================ */

Object.assign(App, {

  _eduStudentEditTeamId: null,
  _eduStudentEditId: null,
  _eduStudentDefaultGroupId: null,

  /**
   * 顯示學員編輯表單
   */
  async showEduStudentForm(teamId, studentId, defaultGroupId) {
    this._eduStudentEditTeamId = teamId;
    this._eduStudentEditId = studentId || null;
    this._eduStudentDefaultGroupId = defaultGroupId || null;

    const titleEl = document.getElementById('edu-student-modal-title');
    const saveBtn = document.getElementById('edu-student-save-btn');

    // 載入分組以供選擇
    const groups = await this._loadEduGroups(teamId);
    const groupSelect = document.getElementById('edu-stu-groups');
    if (groupSelect) {
      groupSelect.innerHTML = groups
        .filter(g => g.active !== false)
        .map(g => '<label class="edu-checkbox-label"><input type="checkbox" value="' + g.id + '" data-name="' + escapeHTML(g.name) + '"> ' + escapeHTML(g.name) + '</label>')
        .join('');
    }

    if (studentId) {
      titleEl.textContent = '編輯學員';
      saveBtn.textContent = '儲存變更';
      const students = this.getEduStudents(teamId);
      const s = students.find(s => s.id === studentId);
      if (s) {
        document.getElementById('edu-stu-name').value = s.name || '';
        document.getElementById('edu-stu-birthday').value = s.birthday || '';
        document.getElementById('edu-stu-gender').value = s.gender || 'male';
        if (groupSelect && s.groupIds) {
          groupSelect.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = s.groupIds.includes(cb.value);
          });
        }
      }
    } else {
      titleEl.textContent = '新增學員';
      saveBtn.textContent = '新增學員';
      document.getElementById('edu-stu-name').value = '';
      document.getElementById('edu-stu-birthday').value = '';
      document.getElementById('edu-stu-gender').value = 'male';
      if (groupSelect) {
        groupSelect.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          cb.checked = defaultGroupId ? cb.value === defaultGroupId : false;
        });
      }
    }

    this.showModal('edu-student-modal');
  },

  /**
   * 儲存學員（編輯 or 手動新增）
   */
  async handleSaveEduStudent() {
    const teamId = this._eduStudentEditTeamId;
    const studentId = this._eduStudentEditId;
    const name = document.getElementById('edu-stu-name').value.trim();
    if (!name) { this.showToast('請輸入學員姓名'); return; }

    const groupSelect = document.getElementById('edu-stu-groups');
    const groupIds = [];
    const groupNames = [];
    if (groupSelect) {
      groupSelect.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        groupIds.push(cb.value);
        groupNames.push(cb.dataset.name || cb.value);
      });
    }

    const data = {
      name,
      birthday: document.getElementById('edu-stu-birthday').value.trim() || null,
      gender: document.getElementById('edu-stu-gender').value || 'male',
      groupIds,
      groupNames,
    };

    // 若有生日且未勾分組，嘗試自動歸組
    if (data.birthday && groupIds.length === 0) {
      const age = this.calcAge(data.birthday);
      const groups = this.getEduGroups(teamId);
      const autoGroupIds = this.autoMatchGroups(age, groups);
      if (autoGroupIds.length > 0) {
        data.groupIds = autoGroupIds;
        data.groupNames = autoGroupIds.map(gid => {
          const g = groups.find(g => g.id === gid);
          return g ? g.name : gid;
        });
      }
    }

    try {
      if (studentId) {
        await FirebaseService.updateEduStudent(teamId, studentId, data);
        const cached = this._eduStudentsCache[teamId];
        if (cached) {
          const existing = cached.find(s => s.id === studentId);
          if (existing) Object.assign(existing, data);
        }
        this.showToast('學員資料已更新');
      } else {
        data.id = this._generateEduId('stu');
        data.parentUid = null;
        data.selfUid = null;
        data.enrollStatus = 'active';
        data.enrolledAt = new Date().toISOString();
        data.coachNotes = '';
        data.positionTags = [];
        const result = await FirebaseService.createEduStudent(teamId, data);
        const cached = this._eduStudentsCache[teamId];
        if (cached) cached.push(result);
        else this._eduStudentsCache[teamId] = [result];
        this._updateGroupMemberCounts(teamId);
        this.showToast('學員已新增');
      }
      this.closeModal();
      if (this._eduCurrentGroupId) {
        await this.renderEduStudentList(teamId, this._eduCurrentGroupId);
      }
      await this.renderEduGroupList(teamId);
    } catch (err) {
      console.error('[handleSaveEduStudent]', err);
      this.showToast('儲存失敗：' + (err.message || '請稍後再試'));
    }
  },

  /**
   * 顯示「新增學員到分組」彈窗
   * 搜尋俱樂部內所有 active 學員（不限年齡），手動指派到分組
   */
  async showEduAssignStudentModal(teamId, groupId) {
    const groups = this.getEduGroups(teamId);
    const group = groups.find(g => g.id === groupId);
    const titleEl = document.getElementById('edu-assign-modal-title');
    if (titleEl) titleEl.textContent = group ? '新增學員 — ' + group.name : '新增學員';

    const container = document.getElementById('edu-assign-student-list');
    if (!container) return;

    this._eduAssignTeamId = teamId;
    this._eduAssignGroupId = groupId;

    const allStudents = await this._loadEduStudents(teamId);
    // 只列 active 且尚未在此分組的學員（不限年齡，職員特例）
    const candidates = allStudents.filter(s =>
      s.enrollStatus === 'active' && !(s.groupIds || []).includes(groupId)
    );

    // 搜尋框 + 列表
    container.innerHTML = '<div style="margin-bottom:.4rem">'
      + '<input type="text" id="edu-assign-search" class="ce-input" placeholder="搜尋學員姓名..." style="width:100%;font-size:.82rem" oninput="App._filterAssignStudentList()">'
      + '</div>'
      + '<div id="edu-assign-results">' + this._buildAssignStudentRows(candidates, teamId, groupId) + '</div>';

    this.showModal('edu-assign-student-modal');
  },

  _filterAssignStudentList() {
    const query = (document.getElementById('edu-assign-search')?.value || '').trim().toLowerCase();
    const teamId = this._eduAssignTeamId;
    const groupId = this._eduAssignGroupId;
    const allStudents = this.getEduStudents(teamId);
    let candidates = allStudents.filter(s =>
      s.enrollStatus === 'active' && !(s.groupIds || []).includes(groupId)
    );
    if (query) {
      candidates = candidates.filter(s => (s.name || '').toLowerCase().includes(query));
    }
    const resultsEl = document.getElementById('edu-assign-results');
    if (resultsEl) resultsEl.innerHTML = this._buildAssignStudentRows(candidates, teamId, groupId);
  },

  _buildAssignStudentRows(candidates, teamId, groupId) {
    if (!candidates.length) {
      return '<div class="edu-empty-state">沒有可加入的學員</div>';
    }
    return candidates.map(s => {
      const age = this.calcAge(s.birthday);
      const ageLabel = age != null ? age + ' 歲' : '';
      const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
      const genderClass = s.gender === 'male' ? ' edu-gender-male' : s.gender === 'female' ? ' edu-gender-female' : '';
      const existingGroups = (s.groupNames && s.groupNames.length)
        ? '<span style="font-size:.68rem;color:var(--text-muted);margin-left:.3rem">' + s.groupNames.join('、') + '</span>'
        : '';

      return '<div class="edu-assign-row" id="edu-assign-row-' + s.id + '">'
        + '<div style="flex:1;min-width:0">'
        + '<div class="edu-student-header">'
        + '<span class="edu-student-name">' + escapeHTML(s.name) + '</span>'
        + (genderIcon ? '<span class="edu-student-gender' + genderClass + '">' + genderIcon + '</span>' : '')
        + (ageLabel ? '<span class="edu-student-age">' + ageLabel + '</span>' : '')
        + '</div>'
        + existingGroups
        + '</div>'
        + '<button class="primary-btn small" onclick="App._assignStudentToGroup(\'' + teamId + '\',\'' + s.id + '\',\'' + groupId + '\')">加入</button>'
        + '</div>';
    }).join('');
  },

  /**
   * 將學員指派到指定分組
   */
  async _assignStudentToGroup(teamId, studentId, groupId) {
    // 防連點：先停用該按鈕
    const row = document.getElementById('edu-assign-row-' + studentId);
    const btn = row && row.querySelector('button');
    if (btn) { btn.disabled = true; btn.textContent = '處理中…'; }

    const students = this.getEduStudents(teamId);
    const student = students.find(s => s.id === studentId);
    if (!student) { this.showToast('找不到學員'); if (btn) { btn.disabled = false; btn.textContent = '加入'; } return; }

    const groups = this.getEduGroups(teamId);
    const group = groups.find(g => g.id === groupId);

    const newGroupIds = [...(student.groupIds || [])];
    const newGroupNames = [...(student.groupNames || [])];
    if (!newGroupIds.includes(groupId)) {
      newGroupIds.push(groupId);
      newGroupNames.push(group ? group.name : groupId);
    }

    try {
      // 指派到分組 = 視同審核通過
      const updates = {
        groupIds: newGroupIds,
        groupNames: newGroupNames,
      };
      if (student.enrollStatus === 'pending') {
        updates.enrollStatus = 'active';
        updates.enrolledAt = new Date().toISOString();
      }

      await FirebaseService.updateEduStudent(teamId, studentId, updates);
      student.groupIds = newGroupIds;
      if (updates.enrollStatus) {
        student.enrollStatus = 'active';
        student.enrolledAt = updates.enrolledAt;
      }
      student.groupNames = newGroupNames;

      // 移除該行（視覺回饋）
      const row = document.getElementById('edu-assign-row-' + studentId);
      if (row) row.remove();

      // 檢查是否還有候選
      const listEl = document.getElementById('edu-assign-student-list');
      if (listEl && !listEl.querySelector('.edu-assign-row')) {
        listEl.innerHTML = '<div class="edu-empty-state">已全部加入</div>';
      }

      this._updateGroupMemberCounts(teamId);
      this.showToast(student.name + ' 已加入分組');
    } catch (err) {
      console.error('[_assignStudentToGroup]', err);
      this.showToast('操作失敗：' + (err.message || '請稍後再試'));
      if (btn) { btn.disabled = false; btn.textContent = '加入'; }
    }
  },

  /**
   * 重新計算各分組的 memberCount
   */
  _updateGroupMemberCounts(teamId) {
    const students = this.getEduStudents(teamId);
    const groups = this.getEduGroups(teamId);
    groups.forEach(g => {
      g.memberCount = students.filter(s =>
        s.enrollStatus !== 'inactive' && (s.groupIds || []).includes(g.id)
      ).length;
    });
  },

});
