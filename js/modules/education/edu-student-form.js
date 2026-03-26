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
   * 顯示「指派學員到分組」彈窗
   * 列出符合條件（年齡）且尚未在該分組的學員，點「加入」即指派
   */
  async showEduAssignStudentModal(teamId, groupId) {
    const groups = this.getEduGroups(teamId);
    const group = groups.find(g => g.id === groupId);
    const titleEl = document.getElementById('edu-assign-modal-title');
    if (titleEl) titleEl.textContent = group ? '新增學員 — ' + group.name : '新增學員';

    const container = document.getElementById('edu-assign-student-list');
    if (!container) return;

    const allStudents = await this._loadEduStudents(teamId);
    // 篩選：active/pending 且尚未在此分組
    const candidates = allStudents.filter(s => {
      if (s.enrollStatus === 'inactive') return false;
      if ((s.groupIds || []).includes(groupId)) return false;
      // 年齡篩選（若分組有設定年齡範圍）
      if (group && (group.ageMin != null || group.ageMax != null)) {
        const age = this.calcAge(s.birthday);
        if (age == null) return true; // 無生日資料仍列出
        if (group.ageMin != null && age < group.ageMin) return false;
        if (group.ageMax != null && age > group.ageMax) return false;
      }
      return true;
    });

    if (!candidates.length) {
      container.innerHTML = '<div class="edu-empty-state">沒有符合條件的學員可加入此分組</div>';
      this.showModal('edu-assign-student-modal');
      return;
    }

    container.innerHTML = candidates.map(s => {
      const age = this.calcAge(s.birthday);
      const ageLabel = age != null ? age + ' 歲' : '';
      const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
      const statusLabel = s.enrollStatus === 'pending' ? '<span class="edu-status-pending">待審核</span>' : '';
      const existingGroups = (s.groupNames && s.groupNames.length)
        ? '<span style="font-size:.68rem;color:var(--text-muted);margin-left:.3rem">' + s.groupNames.join('、') + '</span>'
        : '';

      return '<div class="edu-assign-row" id="edu-assign-row-' + s.id + '">'
        + '<div style="flex:1;min-width:0">'
        + '<div class="edu-student-header">'
        + '<span class="edu-student-name">' + escapeHTML(s.name) + '</span>'
        + (genderIcon ? '<span class="edu-student-gender">' + genderIcon + '</span>' : '')
        + (ageLabel ? '<span class="edu-student-age">' + ageLabel + '</span>' : '')
        + statusLabel
        + '</div>'
        + existingGroups
        + '</div>'
        + '<button class="primary-btn small" onclick="App._assignStudentToGroup(\'' + teamId + '\',\'' + s.id + '\',\'' + groupId + '\')">加入</button>'
        + '</div>';
    }).join('');

    this.showModal('edu-assign-student-modal');
  },

  /**
   * 將學員指派到指定分組
   */
  async _assignStudentToGroup(teamId, studentId, groupId) {
    const students = this.getEduStudents(teamId);
    const student = students.find(s => s.id === studentId);
    if (!student) { this.showToast('找不到學員'); return; }

    const groups = this.getEduGroups(teamId);
    const group = groups.find(g => g.id === groupId);

    const newGroupIds = [...(student.groupIds || [])];
    const newGroupNames = [...(student.groupNames || [])];
    if (!newGroupIds.includes(groupId)) {
      newGroupIds.push(groupId);
      newGroupNames.push(group ? group.name : groupId);
    }

    try {
      await FirebaseService.updateEduStudent(teamId, studentId, {
        groupIds: newGroupIds,
        groupNames: newGroupNames,
      });
      student.groupIds = newGroupIds;
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
      this.showToast(escapeHTML(student.name) + ' 已加入分組');
    } catch (err) {
      console.error('[_assignStudentToGroup]', err);
      this.showToast('操作失敗：' + (err.message || '請稍後再試'));
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
