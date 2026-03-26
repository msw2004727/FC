/* ================================================
   SportHub — Education: Student List Rendering
   ================================================ */

Object.assign(App, {

  _eduStudentsCache: {},
  _eduCurrentGroupId: null,

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

    // 分組篩選
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
      html += pendingStudents.map(s => this._renderPendingStudentCard(teamId, s)).join('');
      html += '<hr style="border:none;border-top:1px solid var(--border);margin:.6rem 0">';
    }

    // ── 新增學員按鈕（職員）──
    if (isStaff) {
      html += '<div style="margin-bottom:.5rem"><button class="primary-btn small" onclick="App.showEduAssignStudentModal(\'' + teamId + '\',\'' + (groupId || '') + '\')">＋ 新增學員</button></div>';
    }

    // ── 正式學員 ──
    if (activeStudents.length) {
      html += activeStudents.map(s => {
        const age = this.calcAge(s.birthday);
        const ageLabel = age != null ? age + ' 歲' : '';
        const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
        const genderClass = s.gender === 'male' ? ' edu-gender-male' : s.gender === 'female' ? ' edu-gender-female' : '';

        return '<div class="edu-student-card">'
          + '<div class="edu-student-header">'
          + '<span class="edu-student-name">' + escapeHTML(s.name) + '</span>'
          + (genderIcon ? '<span class="edu-student-gender' + genderClass + '">' + genderIcon + '</span>' : '')
          + (ageLabel ? '<span class="edu-student-age">' + ageLabel + '</span>' : '')
          + (s.groupNames && s.groupNames.length ? s.groupNames.map(n => '<span class="edu-group-tag">' + escapeHTML(n) + '</span>').join('') : '')
          + '</div>'
          + (isStaff ? '<div class="edu-student-actions">'
            + '<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="App.showEduStudentForm(\'' + teamId + '\',\'' + s.id + '\')">編輯</button>'
            + '</div>' : '')
          + '</div>';
      }).join('');
    } else if (!pendingStudents.length) {
      html += '<div class="edu-empty-state">此分組尚無正式學員</div>';
    }

    container.innerHTML = html;
  },

  /**
   * 渲染待審核學員卡片（含通過/拒絕按鈕）
   */
  _renderPendingStudentCard(teamId, s) {
    const age = this.calcAge(s.birthday);
    const ageLabel = age != null ? age + ' 歲' : '';
    const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
    const genderClass = s.gender === 'male' ? ' edu-gender-male' : s.gender === 'female' ? ' edu-gender-female' : '';

    return '<div class="edu-student-card edu-pending-card" id="edu-pending-' + s.id + '">'
      + '<div class="edu-student-header">'
      + '<span class="edu-student-name">' + escapeHTML(s.name) + '</span>'
      + (genderIcon ? '<span class="edu-student-gender' + genderClass + '">' + genderIcon + '</span>' : '')
      + (ageLabel ? '<span class="edu-student-age">' + ageLabel + '</span>' : '')
      + '<span class="edu-status-pending">待審核</span>'
      + '</div>'
      + '<div class="edu-pending-actions">'
      + '<button class="primary-btn small" onclick="App._approveFromList(\'' + teamId + '\',\'' + s.id + '\')">通過</button>'
      + '<button class="outline-btn small" style="color:var(--danger);border-color:var(--danger)" onclick="App._rejectFromList(\'' + teamId + '\',\'' + s.id + '\',this)" data-name="' + escapeHTML(s.name) + '">拒絕</button>'
      + '</div>'
      + '</div>';
  },

  /**
   * 從學員列表通過審核
   */
  async _approveFromList(teamId, studentId) {
    await this.approveEduStudent(teamId, studentId);
    const groupId = this._eduCurrentGroupId;
    if (groupId) await this.renderEduStudentList(teamId, groupId);
  },

  /**
   * 從學員列表拒絕（刪除紀錄）
   */
  async _rejectFromList(teamId, studentId, btnEl) {
    const name = btnEl && btnEl.dataset ? btnEl.dataset.name : '';
    if (!(await this.appConfirm('確定要拒絕「' + name + '」的申請嗎？'))) return;
    await this.rejectEduStudent(teamId, studentId);
    const groupId = this._eduCurrentGroupId;
    if (groupId) await this.renderEduStudentList(teamId, groupId);
  },

});
