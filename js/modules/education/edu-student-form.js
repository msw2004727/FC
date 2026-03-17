/* ================================================
   SportHub — Education: Student CRUD Form
   ================================================ */

Object.assign(App, {

  _eduStudentEditTeamId: null,
  _eduStudentEditId: null,
  _eduStudentDefaultGroupId: null,

  /**
   * 顯示學員建立/編輯表單
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
        document.getElementById('edu-stu-notes').value = s.coachNotes || '';
        document.getElementById('edu-stu-tags').value = (s.positionTags || []).join(', ');
        // 勾選已有分組
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
      document.getElementById('edu-stu-notes').value = '';
      document.getElementById('edu-stu-tags').value = '';
      // 預設勾選當前分組
      if (groupSelect) {
        groupSelect.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          cb.checked = defaultGroupId ? cb.value === defaultGroupId : false;
        });
      }
    }

    this.showModal('edu-student-modal');
  },

  /**
   * 儲存學員
   */
  async handleSaveEduStudent() {
    const teamId = this._eduStudentEditTeamId;
    const studentId = this._eduStudentEditId;
    const name = document.getElementById('edu-stu-name').value.trim();
    if (!name) { this.showToast('請輸入學員姓名'); return; }

    // 收集勾選的分組
    const groupSelect = document.getElementById('edu-stu-groups');
    const groupIds = [];
    const groupNames = [];
    if (groupSelect) {
      groupSelect.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        groupIds.push(cb.value);
        groupNames.push(cb.dataset.name || cb.value);
      });
    }

    const tagsRaw = document.getElementById('edu-stu-tags').value.trim();
    const positionTags = tagsRaw ? tagsRaw.split(/[,，、]/).map(t => t.trim()).filter(Boolean) : [];

    const data = {
      name,
      birthday: document.getElementById('edu-stu-birthday').value.trim() || null,
      gender: document.getElementById('edu-stu-gender').value || 'male',
      groupIds,
      groupNames,
      coachNotes: document.getElementById('edu-stu-notes').value.trim(),
      positionTags,
    };

    // 若有生日，嘗試自動歸組
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
        const result = await FirebaseService.createEduStudent(teamId, data);
        const cached = this._eduStudentsCache[teamId];
        if (cached) cached.push(result);
        else this._eduStudentsCache[teamId] = [result];
        // 更新分組計數
        this._updateGroupMemberCounts(teamId);
        this.showToast('學員已新增');
      }
      this.closeModal();
      if (this._eduCurrentGroupId) {
        this.renderEduStudentList(teamId, this._eduCurrentGroupId);
      }
      this.renderEduGroupList(teamId);
    } catch (err) {
      console.error('[handleSaveEduStudent]', err);
      this.showToast('儲存失敗：' + (err.message || '請稍後再試'));
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
