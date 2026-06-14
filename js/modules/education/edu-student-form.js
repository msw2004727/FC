/* ================================================
   SportHub — Education: Student CRUD Form
   ================================================ */

Object.assign(App, {

  _eduStudentEditTeamId: null,
  _eduStudentEditId: null,
  _eduStudentDefaultGroupId: null,
  _eduAssignCandidates: [],
  _eduAssignCandidateMap: null,

  /**
   * 顯示學員編輯表單
   */
  async showEduStudentForm(teamId, studentId, defaultGroupId) {
    this._eduStudentEditTeamId = teamId;
    this._eduStudentEditId = studentId || null;
    this._eduStudentDefaultGroupId = defaultGroupId || null;

    const titleEl = document.getElementById('edu-student-modal-title');
    const saveBtn = document.getElementById('edu-student-save-btn');

    // 載入分組以供選擇（格子式，不斷行）
    const groups = await this._loadEduGroups(teamId);
    const groupSelect = document.getElementById('edu-stu-groups');
    if (groupSelect) {
      groupSelect.innerHTML = '<div class="edu-group-chip-grid">'
        + groups.filter(g => g.active !== false).map(g =>
          '<div class="edu-group-chip" data-gid="' + g.id + '" data-name="' + escapeHTML(g.name) + '" onclick="this.classList.toggle(\'edu-group-chip-on\')">'
          + escapeHTML(g.name) + '</div>'
        ).join('')
        + '</div>';
    }

    const nameEl = document.getElementById('edu-stu-name');
    const birthdayEl = document.getElementById('edu-stu-birthday');
    const genderEl = document.getElementById('edu-stu-gender');

    if (studentId) {
      titleEl.textContent = '編輯學員';
      saveBtn.textContent = '儲存變更';
      const students = this.getEduStudents(teamId);
      const s = students.find(s => s.id === studentId);
      if (s) {
        const isSelf = !!s.selfUid;
        nameEl.value = s.name || '';
        nameEl.readOnly = isSelf;
        nameEl.style.opacity = isSelf ? '.5' : '1';
        birthdayEl.value = s.birthday || '';
        birthdayEl.disabled = isSelf;
        birthdayEl.style.opacity = isSelf ? '.5' : '1';
        genderEl.value = s.gender || 'male';
        genderEl.disabled = isSelf;
        genderEl.style.opacity = isSelf ? '.5' : '1';
        if (groupSelect && s.groupIds) {
          groupSelect.querySelectorAll('.edu-group-chip').forEach(chip => {
            if (s.groupIds.includes(chip.dataset.gid)) chip.classList.add('edu-group-chip-on');
          });
        }
      }
    } else {
      titleEl.textContent = '新增學員';
      saveBtn.textContent = '新增學員';
      nameEl.value = '';
      nameEl.readOnly = false;
      nameEl.style.opacity = '1';
      birthdayEl.value = '';
      birthdayEl.disabled = false;
      birthdayEl.style.opacity = '1';
      genderEl.value = 'male';
      genderEl.disabled = false;
      genderEl.style.opacity = '1';
      if (groupSelect) {
        groupSelect.querySelectorAll('.edu-group-chip').forEach(chip => {
          if (defaultGroupId && chip.dataset.gid === defaultGroupId) chip.classList.add('edu-group-chip-on');
          else chip.classList.remove('edu-group-chip-on');
        });
      }
    }

    this.showModal('edu-student-modal');
  },

  /**
   * 儲存學員（編輯 or 手動新增）
   */
  async handleSaveEduStudent() {
    const _btnState = this._setEduBtnLoading('#edu-student-save-btn');
    const teamId = this._eduStudentEditTeamId;
    const studentId = this._eduStudentEditId;
    const name = document.getElementById('edu-stu-name').value.trim();
    if (!name) { _btnState.restore(); this.showToast('請輸入學員姓名'); return; }

    const groupSelect = document.getElementById('edu-stu-groups');
    const groupIds = [];
    const groupNames = [];
    if (groupSelect) {
      groupSelect.querySelectorAll('.edu-group-chip-on').forEach(chip => {
        groupIds.push(chip.dataset.gid);
        groupNames.push(chip.dataset.name || chip.dataset.gid);
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
      const autoGroupIds = this.autoMatchGroups(age, data.gender, groups);
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
    } finally {
      _btnState.restore();
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
    const candidates = this._buildEduAssignStudentCandidates(teamId, groupId, allStudents);
    this._setEduAssignStudentCandidates(candidates);

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
    let candidates = this._buildEduAssignStudentCandidates(teamId, groupId, allStudents);
    if (query) {
      candidates = candidates.filter(s => (s.name || '').toLowerCase().includes(query));
    }
    this._setEduAssignStudentCandidates(candidates);
    const resultsEl = document.getElementById('edu-assign-results');
    if (resultsEl) resultsEl.innerHTML = this._buildAssignStudentRows(candidates, teamId, groupId);
  },

  _setEduAssignStudentCandidates(candidates) {
    this._eduAssignCandidates = Array.isArray(candidates) ? candidates : [];
    this._eduAssignCandidateMap = new Map();
    this._eduAssignCandidates.forEach(candidate => {
      const id = String(candidate?.id || '').trim();
      if (id) this._eduAssignCandidateMap.set(id, candidate);
    });
  },

  _getEduAssignPersonName(source, fallback) {
    if (!source || typeof source !== 'object') return fallback || '未命名學員';
    if (typeof this._getTeamDetailPersonName === 'function') {
      const name = this._getTeamDetailPersonName(source, fallback || '未命名學員');
      if (String(name || '').trim()) return name;
    }
    const fields = [
      'name', 'displayName', 'nickname', 'nickName', 'lineName', 'profileName',
      'userName', 'realName', 'studentName', 'selfName', 'childName',
    ];
    for (const field of fields) {
      const value = String(source[field] || '').trim();
      if (value) return value;
    }
    return fallback || '未命名學員';
  },

  _getEduAssignStudentIdentityKeys(student) {
    const keys = [];
    const push = (prefix, value) => {
      const text = String(value || '').trim();
      if (text) keys.push(prefix + ':' + text);
    };
    push('uid', student?.selfUid || student?.uid);
    push('student', student?.id || student?._docId || student?.studentId);
    const name = String(student?.name || student?.studentName || '').trim().toLowerCase();
    if (name) keys.push('student-name:' + name);
    return keys;
  },

  _getEduAssignUserIdentityKeys(user) {
    const keys = [];
    const push = (prefix, value) => {
      const text = String(value || '').trim();
      if (text) keys.push(prefix + ':' + text);
    };
    push('uid', user?.uid || user?._docId);
    push('doc', user?._docId);
    const name = this._getEduAssignPersonName(user, '').trim().toLowerCase();
    if (name) {
      keys.push('name:' + name);
      keys.push('student-name:' + name);
    }
    return keys;
  },

  _isEduAssignUserInTeamScope(user, teamId) {
    if (!user || !teamId) return false;
    if (typeof this._isUserInTeam === 'function' && this._isUserInTeam(user, teamId)) return true;
    if (String(user?.teamId || '') === String(teamId)) return true;
    if (Array.isArray(user?.teamIds) && user.teamIds.map(String).includes(String(teamId))) return true;
    const team = (typeof ApiService !== 'undefined' && typeof ApiService.getTeam === 'function')
      ? ApiService.getTeam(teamId)
      : null;
    if (!team) return false;
    const userIds = [user.uid, user._docId].map(value => String(value || '').trim()).filter(Boolean);
    if (!userIds.length) return false;
    const staffIds = [
      team.captainUid,
      team.leaderUid,
      ...(Array.isArray(team.leaderUids) ? team.leaderUids : []),
      ...(Array.isArray(team.coachUids) ? team.coachUids : []),
    ].map(value => String(value || '').trim()).filter(Boolean);
    return userIds.some(uid => staffIds.includes(uid));
  },

  _isEduAssignStudentInGroup(student, groupId) {
    if (!student || !groupId) return false;
    return (student.groupIds || []).map(String).includes(String(groupId));
  },

  _isEduAssignStudentVisible(student, groupId) {
    if (!student || typeof student !== 'object') return false;
    const status = String(student.enrollStatus || student.status || '').trim().toLowerCase();
    if (['inactive', 'removed', 'cancelled', 'canceled', 'deleted', 'rejected'].includes(status)) return false;
    return !this._isEduAssignStudentInGroup(student, groupId);
  },

  _buildEduAssignMemberCandidateId(user, index) {
    const raw = String(user?.uid || user?._docId || this._getEduAssignPersonName(user, '') || index || '').trim();
    const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_') || 'user';
    return 'member-' + index + '-' + safe;
  },

  _buildEduAssignStudentCandidates(teamId, groupId, students) {
    const studentList = Array.isArray(students) ? students : [];
    const users = (typeof ApiService !== 'undefined' && typeof ApiService.getAdminUsers === 'function')
      ? (ApiService.getAdminUsers() || [])
      : [];
    const blockedKeys = new Set();
    const candidatesByKey = new Map();

    studentList.forEach(student => {
      if (this._isEduAssignStudentInGroup(student, groupId)) {
        this._getEduAssignStudentIdentityKeys(student).forEach(key => blockedKeys.add(key));
        return;
      }
      if (!this._isEduAssignStudentVisible(student, groupId)) return;
      const keys = this._getEduAssignStudentIdentityKeys(student);
      const key = keys[0];
      if (!key || blockedKeys.has(key)) return;
      const id = String(student.id || student._docId || student.studentId || '').trim();
      if (!id) return;
      const candidate = {
        ...student,
        id,
        name: this._getEduAssignPersonName(student, '未命名學員'),
        sourceType: 'student',
        isStudent: true,
        isMember: false,
        student,
        user: null,
      };
      candidatesByKey.set(key, candidate);
      keys.forEach(alias => {
        if (alias && alias !== key && !candidatesByKey.has(alias)) candidatesByKey.set(alias, candidate);
      });
    });

    users.forEach((user, index) => {
      if (!this._isEduAssignUserInTeamScope(user, teamId)) return;
      const keys = this._getEduAssignUserIdentityKeys(user);
      if (!keys.length || keys.some(key => blockedKeys.has(key))) return;
      const existingKey = keys.find(key => candidatesByKey.has(key));
      if (existingKey) {
        const existing = candidatesByKey.get(existingKey);
        existing.isMember = true;
        existing.user = user;
        existing.sourceType = existing.isStudent ? 'both' : 'member';
        keys.forEach(alias => {
          if (alias && !candidatesByKey.has(alias)) candidatesByKey.set(alias, existing);
        });
        return;
      }
      const id = this._buildEduAssignMemberCandidateId(user, index);
      const candidate = {
        id,
        name: this._getEduAssignPersonName(user, '未命名隊員'),
        birthday: user.birthday || user.birthdate || user.birthDate || null,
        gender: user.gender || null,
        groupIds: [],
        groupNames: [],
        enrollStatus: 'active',
        sourceType: 'member',
        isStudent: false,
        isMember: true,
        student: null,
        user,
      };
      candidatesByKey.set(keys[0], candidate);
      keys.slice(1).forEach(alias => {
        if (alias && !candidatesByKey.has(alias)) candidatesByKey.set(alias, candidate);
      });
    });

    const seenIds = new Set();
    return Array.from(candidatesByKey.values())
      .filter(candidate => {
        const id = String(candidate?.id || '').trim();
        if (!id || seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      })
      .sort((a, b) => {
        const rankA = a.isStudent && a.isMember ? 0 : (a.isStudent ? 1 : 2);
        const rankB = b.isStudent && b.isMember ? 0 : (b.isStudent ? 1 : 2);
        if (rankA !== rankB) return rankA - rankB;
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
      });
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
        ? '<span style="font-size:.68rem;color:var(--text-muted);margin-left:.3rem">' + s.groupNames.map(name => escapeHTML(name)).join('、') + '</span>'
        : '';
      const sourceLabels = [];
      if (s.isMember) sourceLabels.push('隊員');
      if (s.isStudent) sourceLabels.push('學員');
      const sourceLabel = sourceLabels.length
        ? '<span style="font-size:.66rem;color:var(--text-muted);font-weight:800;margin-left:.3rem">' + sourceLabels.join(' / ') + '</span>'
        : '';

      return '<div class="edu-assign-row" id="edu-assign-row-' + s.id + '">'
        + '<div style="flex:1;min-width:0">'
        + '<div class="edu-student-header">'
        + '<span class="edu-student-name">' + escapeHTML(s.name) + '</span>'
        + sourceLabel
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
    const assignRowId = studentId;
    const row = document.getElementById('edu-assign-row-' + assignRowId);
    const btn = row && row.querySelector('button');
    if (btn) { btn.disabled = true; btn.textContent = '處理中…'; }

    const students = this.getEduStudents(teamId);
    let student = students.find(s => String(s.id || s._docId || s.studentId || '') === String(studentId));
    const candidate = student ? null : this._eduAssignCandidateMap?.get(String(studentId));
    const groups = this.getEduGroups(teamId);
    const group = groups.find(g => g.id === groupId);
    let createdFromMember = false;
    try {
      if (!student && candidate?.sourceType === 'member' && candidate.user) {
        student = await this._createEduStudentFromAssignMember(teamId, candidate, groupId, group);
        studentId = student.id || student._docId || student.studentId || studentId;
        createdFromMember = true;
      }
    } catch (err) {
      console.error('[_assignStudentToGroup:createMemberStudent]', err);
      this.showToast('加入失敗：' + (err.message || '請稍後再試'));
      if (btn) { btn.disabled = false; btn.textContent = '加入'; }
      return;
    }
    if (!student) { this.showToast('找不到學員'); if (btn) { btn.disabled = false; btn.textContent = '加入'; } return; }

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

      if (!createdFromMember) {
        await FirebaseService.updateEduStudent(teamId, studentId, updates);
        student.groupIds = newGroupIds;
        if (updates.enrollStatus) {
          student.enrollStatus = 'active';
          student.enrolledAt = updates.enrolledAt;
        }
        student.groupNames = newGroupNames;
      }

      // 移除該行（視覺回饋）
      const row = document.getElementById('edu-assign-row-' + assignRowId);
      if (row) row.remove();

      // 檢查是否還有候選
      const listEl = document.getElementById('edu-assign-student-list');
      if (listEl && !listEl.querySelector('.edu-assign-row')) {
        listEl.innerHTML = '<div class="edu-empty-state">已全部加入</div>';
      }

      this._updateGroupMemberCounts(teamId);
      this.showToast(student.name + ' 已加入分組');
      // 同步更新背後的學員列表
      if (this._eduCurrentGroupId) {
        this.renderEduStudentList(teamId, this._eduCurrentGroupId);
      }
    } catch (err) {
      console.error('[_assignStudentToGroup]', err);
      this.showToast('操作失敗：' + (err.message || '請稍後再試'));
      if (btn) { btn.disabled = false; btn.textContent = '加入'; }
    }
  },

  /**
   * 將俱樂部隊員建立為學員後加入指定分組
   */
  async _createEduStudentFromAssignMember(teamId, candidate, groupId, group) {
    const user = candidate?.user || {};
    const groupIds = groupId ? [groupId] : [];
    const groupNames = groupId ? [group?.name || groupId] : [];
    const data = {
      id: this._generateEduId('stu'),
      name: candidate?.name || this._getEduAssignPersonName(user, '未命名學員'),
      birthday: candidate?.birthday || user.birthday || user.birthdate || user.birthDate || null,
      gender: candidate?.gender || user.gender || null,
      groupIds,
      groupNames,
      parentUid: null,
      selfUid: String(user.uid || user._docId || '').trim() || null,
      enrollStatus: 'active',
      enrolledAt: new Date().toISOString(),
      coachNotes: '',
      positionTags: [],
    };
    const result = await FirebaseService.createEduStudent(teamId, data);
    const student = result || data;
    const cached = this._eduStudentsCache[teamId];
    if (cached) cached.push(student);
    else this._eduStudentsCache[teamId] = [student];
    return student;
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
