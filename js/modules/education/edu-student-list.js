/* ================================================
   SportHub — Education: Student List Rendering
   ================================================ */

Object.assign(App, {

  _eduStudentsCache: {},
  _eduCurrentGroupId: null,

  /**
   * 載入指定俱樂部的所有學員
   */
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

  /**
   * 顯示某分組的學員列表頁
   */
  async showEduStudentList(teamId, groupId) {
    this._eduCurrentGroupId = groupId;
    await this.showPage('page-edu-students');

    const titleEl = document.getElementById('edu-students-title');
    const groups = this.getEduGroups(teamId);
    const group = groups.find(g => g.id === groupId);
    if (titleEl) titleEl.textContent = group ? group.name + ' — 學員' : '學員列表';

    await this.renderEduStudentList(teamId, groupId);
  },

  /**
   * 渲染學員列表
   */
  async renderEduStudentList(teamId, groupId) {
    const container = document.getElementById('edu-student-list');
    if (!container) return;

    const isStaff = this.isEduClubStaff(teamId);
    const allStudents = await this._loadEduStudents(teamId);

    // 依分組篩選（若 groupId 為空則顯示全部）
    const students = groupId
      ? allStudents.filter(s => s.enrollStatus !== 'inactive' && (s.groupIds || []).includes(groupId))
      : allStudents.filter(s => s.enrollStatus !== 'inactive');

    if (!students.length) {
      container.innerHTML = '<div class="edu-empty-state">此分組尚無學員' +
        (isStaff ? '<br><button class="primary-btn small" style="margin-top:.5rem" onclick="App.showEduAssignStudentModal(\'' + teamId + '\',\'' + (groupId || '') + '\')">新增學員</button>' : '') +
        '</div>';
      return;
    }

    const addBtn = isStaff
      ? '<div style="margin-bottom:.5rem"><button class="primary-btn small" onclick="App.showEduAssignStudentModal(\'' + teamId + '\',\'' + (groupId || '') + '\')">＋ 新增學員</button></div>'
      : '';

    container.innerHTML = addBtn + students.map(s => {
      const age = this.calcAge(s.birthday);
      const ageLabel = age != null ? age + ' 歲' : '';
      const statusClass = s.enrollStatus === 'pending' ? 'edu-status-pending' : 'edu-status-active';
      const statusLabel = s.enrollStatus === 'pending' ? '待審核' : '';
      const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
      const tags = (s.positionTags || []).map(t => '<span class="edu-tag">' + escapeHTML(t) + '</span>').join('');

      return '<div class="edu-student-card">' +
        '<div class="edu-student-header">' +
          '<span class="edu-student-name">' + escapeHTML(s.name) + '</span>' +
          (genderIcon ? '<span class="edu-student-gender">' + genderIcon + '</span>' : '') +
          (ageLabel ? '<span class="edu-student-age">' + ageLabel + '</span>' : '') +
          (statusLabel ? '<span class="' + statusClass + '">' + statusLabel + '</span>' : '') +
        '</div>' +
        (s.groupNames && s.groupNames.length ? '<div class="edu-student-groups">' + s.groupNames.map(n => '<span class="edu-group-tag">' + escapeHTML(n) + '</span>').join('') + '</div>' : '') +
        (tags ? '<div class="edu-student-tags">' + tags + '</div>' : '') +
        (isStaff && s.coachNotes ? '<div class="edu-coach-note">' + escapeHTML(s.coachNotes) + '</div>' : '') +
        (isStaff ? '<div class="edu-student-actions">' +
          '<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="App.showEduStudentForm(\'' + teamId + '\',\'' + s.id + '\')">編輯</button>' +
        '</div>' : '') +
      '</div>';
    }).join('');
  },

});
