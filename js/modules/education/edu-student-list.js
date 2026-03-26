/* ================================================
   SportHub — Education: Student List Rendering
   ================================================ */

Object.assign(App, {

  _eduStudentsCache: {},
  _eduCurrentGroupId: null,
  _eduCurrentTeamId: null,

  async _loadEduStudents(teamId) {
    if (!teamId) return [];
    try {
      const students = await FirebaseService.listEduStudents(teamId);
      this._eduStudentsCache[teamId] = students;
      return students;
    } catch (err) {
      console.error('[edu-student-list] load failed:', err);
      return this._eduStudentsCache[teamId] || [];
    }
  },

  getEduStudents(teamId) {
    return this._eduStudentsCache[teamId] || [];
  },

  async showEduStudentList(teamId, groupId) {
    this._eduCurrentGroupId = groupId;
    this._eduCurrentTeamId = teamId;
    await this.showPage('page-edu-students');

    const titleEl = document.getElementById('edu-students-title');
    const groups = this.getEduGroups(teamId);
    const group = groups.find(g => g.id === groupId);
    if (titleEl) titleEl.textContent = group ? group.name + ' — 學員' : '學員列表';

    await this.renderEduStudentList(teamId, groupId);
  },

  async renderEduStudentList(teamId, groupId) {
    const container = document.getElementById('edu-student-list');
    if (!container) return;

    const isStaff = this.isEduClubStaff(teamId);
    const allStudents = await this._loadEduStudents(teamId);

    const inGroup = groupId
      ? allStudents.filter(s => s.enrollStatus !== 'inactive' && (s.groupIds || []).includes(groupId))
      : allStudents.filter(s => s.enrollStatus !== 'inactive');

    const pendingStudents = inGroup.filter(s => s.enrollStatus === 'pending');
    const activeStudents = inGroup.filter(s => s.enrollStatus === 'active');

    if (!inGroup.length) {
      container.innerHTML = '<div class="edu-empty-state">此分組尚無學員'
        + (isStaff ? '<br><button class="primary-btn small" style="margin-top:.5rem" onclick="App.showEduAssignStudentModal(\'' + teamId + '\',\'' + (groupId || '') + '\')">新增學員</button>' : '')
        + '</div>';
      return;
    }

    let html = '';

    // ── 待審核區（職員可見，置頂）──
    if (isStaff && pendingStudents.length) {
      html += '<div class="edu-section-label">待審核（' + pendingStudents.length + '）</div>';
      html += pendingStudents.map(s => this._renderPendingStudentRow(teamId, groupId, s)).join('');
      html += '<hr style="border:none;border-top:1px solid var(--border);margin:.6rem 0">';
    }

    // ── 新增學員按鈕（職員）──
    if (isStaff) {
      html += '<div style="margin-bottom:.5rem"><button class="primary-btn small" onclick="App.showEduAssignStudentModal(\'' + teamId + '\',\'' + (groupId || '') + '\')">＋ 新增學員</button></div>';
    }

    // ── 正式學員 ──
    if (activeStudents.length) {
      html += activeStudents.map(s => this._renderActiveStudentRow(teamId, groupId, s, isStaff)).join('');
    } else if (!pendingStudents.length) {
      html += '<div class="edu-empty-state">此分組尚無正式學員</div>';
    }

    container.innerHTML = html;
  },

  /**
   * 待審核學員行（通過/拒絕 置右與姓名並行）
   */
  _renderPendingStudentRow(teamId, groupId, s) {
    const age = this.calcAge(s.birthday);
    const ageLabel = age != null ? age + ' 歲' : '';
    const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
    const genderClass = s.gender === 'male' ? ' edu-gender-male' : s.gender === 'female' ? ' edu-gender-female' : '';

    return '<div class="edu-student-card edu-pending-card">'
      + '<div class="edu-student-header">'
      + '<span class="edu-student-name">' + escapeHTML(s.name) + '</span>'
      + (genderIcon ? '<span class="edu-student-gender' + genderClass + '">' + genderIcon + '</span>' : '')
      + (ageLabel ? '<span class="edu-student-age">' + ageLabel + '</span>' : '')
      + '<span class="edu-header-actions">'
      + '<button class="edu-approve-btn" onclick="App._approveFromList(\'' + teamId + '\',\'' + s.id + '\')">通過</button>'
      + '<button class="edu-reject-btn" onclick="App._rejectFromList(\'' + teamId + '\',\'' + s.id + '\',this)" data-name="' + escapeHTML(s.name) + '">拒絕</button>'
      + '</span>'
      + '</div>'
      + '</div>';
  },

  /**
   * 正式學員行（編輯/移除 置右）
   */
  _renderActiveStudentRow(teamId, groupId, s, isStaff) {
    const age = this.calcAge(s.birthday);
    const ageLabel = age != null ? age + ' 歲' : '';
    const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
    const genderClass = s.gender === 'male' ? ' edu-gender-male' : s.gender === 'female' ? ' edu-gender-female' : '';
    const isSelf = !!s.selfUid;

    let actionBtns = '';
    if (isStaff) {
      const editBtn = isSelf
        ? '<button class="outline-btn small" disabled style="opacity:.4;font-size:.68rem;padding:.15rem .8rem;min-width:3.2rem">編輯</button>'
        : '<button class="outline-btn small" style="font-size:.68rem;padding:.15rem .8rem;min-width:3.2rem" onclick="App.showEduStudentForm(\'' + teamId + '\',\'' + s.id + '\')">編輯</button>';
      const removeBtn = '<button class="outline-btn small" style="font-size:.68rem;padding:.15rem .4rem;min-width:1.6rem;color:var(--danger);border-color:var(--danger)" onclick="App._removeStudentFromGroup(\'' + teamId + '\',\'' + s.id + '\',\'' + (groupId || '') + '\',this)" data-name="' + escapeHTML(s.name) + '">移除</button>';
      actionBtns = '<span class="edu-header-actions">' + editBtn + removeBtn + '</span>';
    }

    return '<div class="edu-student-card">'
      + '<div class="edu-student-header">'
      + '<span class="edu-student-name">' + escapeHTML(s.name) + '</span>'
      + (genderIcon ? '<span class="edu-student-gender' + genderClass + '">' + genderIcon + '</span>' : '')
      + (ageLabel ? '<span class="edu-student-age">' + ageLabel + '</span>' : '')
      + actionBtns
      + '</div>'
      + '</div>';
  },

  /**
   * 從快取渲染（不重新 fetch，供 onSnapshot 呼叫）
   */
  _renderEduStudentListFromCache(teamId, groupId) {
    const container = document.getElementById('edu-student-list');
    if (!container) return;

    const isStaff = this.isEduClubStaff(teamId);
    const allStudents = this.getEduStudents(teamId);

    const inGroup = groupId
      ? allStudents.filter(s => s.enrollStatus !== 'inactive' && (s.groupIds || []).includes(groupId))
      : allStudents.filter(s => s.enrollStatus !== 'inactive');

    const pendingStudents = inGroup.filter(s => s.enrollStatus === 'pending');
    const activeStudents = inGroup.filter(s => s.enrollStatus === 'active');

    if (!inGroup.length) {
      container.innerHTML = '<div class="edu-empty-state">此分組尚無學員'
        + (isStaff ? '<br><button class="primary-btn small" style="margin-top:.5rem" onclick="App.showEduAssignStudentModal(\'' + teamId + '\',\'' + (groupId || '') + '\')">新增學員</button>' : '')
        + '</div>';
      return;
    }

    let html = '';
    if (isStaff && pendingStudents.length) {
      html += '<div class="edu-section-label">待審核（' + pendingStudents.length + '）</div>';
      html += pendingStudents.map(s => this._renderPendingStudentRow(teamId, groupId, s)).join('');
      html += '<hr style="border:none;border-top:1px solid var(--border);margin:.6rem 0">';
    }
    if (isStaff) {
      html += '<div style="margin-bottom:.5rem"><button class="primary-btn small" onclick="App.showEduAssignStudentModal(\'' + teamId + '\',\'' + (groupId || '') + '\')">＋ 新增學員</button></div>';
    }
    if (activeStudents.length) {
      html += activeStudents.map(s => this._renderActiveStudentRow(teamId, groupId, s, isStaff)).join('');
    } else if (!pendingStudents.length) {
      html += '<div class="edu-empty-state">此分組尚無正式學員</div>';
    }
    container.innerHTML = html;
  },

  async _approveFromList(teamId, studentId) {
    await this.approveEduStudent(teamId, studentId);
    const groupId = this._eduCurrentGroupId;
    if (groupId) await this.renderEduStudentList(teamId, groupId);
  },

  async _rejectFromList(teamId, studentId, btnEl) {
    const name = btnEl && btnEl.dataset ? btnEl.dataset.name : '';
    if (!(await this.appConfirm('確定要拒絕「' + name + '」的申請嗎？'))) return;
    await this.rejectEduStudent(teamId, studentId);
    const groupId = this._eduCurrentGroupId;
    if (groupId) await this.renderEduStudentList(teamId, groupId);
  },

  /**
   * 從分組中移除學員
   */
  async _removeStudentFromGroup(teamId, studentId, groupId, btnEl) {
    const name = btnEl && btnEl.dataset ? btnEl.dataset.name : '';
    if (!(await this.appConfirm('是否將「' + name + '」學員移除此分組？'))) return;

    const students = this.getEduStudents(teamId);
    const student = students.find(s => s.id === studentId);
    if (!student) return;

    const newGroupIds = (student.groupIds || []).filter(id => id !== groupId);

    // 若移除後無任何分組 → 二次確認除名
    if (newGroupIds.length === 0) {
      if (!(await this.appConfirm('「' + name + '」學員目前已沒有任何分組，若同意移除則會踢出俱樂部。'))) return;
    }
    const groups = this.getEduGroups(teamId);
    const newGroupNames = newGroupIds.map(id => {
      const g = groups.find(g => g.id === id);
      return g ? g.name : id;
    });

    try {
      const updates = {
        groupIds: newGroupIds,
        groupNames: newGroupNames,
      };
      // 若無任何分組 → 自動除名
      if (newGroupIds.length === 0) {
        updates.enrollStatus = 'inactive';
      }
      await FirebaseService.updateEduStudent(teamId, studentId, updates);
      student.groupIds = newGroupIds;
      student.groupNames = newGroupNames;
      if (updates.enrollStatus) student.enrollStatus = 'inactive';
      this._updateGroupMemberCounts(teamId);
      this.showToast(name + (newGroupIds.length === 0 ? ' 已從俱樂部除名' : ' 已移除此分組'));
      await this.renderEduStudentList(teamId, groupId);
    } catch (err) {
      console.error('[_removeStudentFromGroup]', err);
      this.showToast('操作失敗');
    }
  },

});
