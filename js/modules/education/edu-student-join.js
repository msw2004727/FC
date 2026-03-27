/* ================================================
   SportHub — Education: Student/Parent Join Flow
   ================================================
   學員/家長申請加入流程、教練審核
   ================================================ */

Object.assign(App, {

  _eduApplySubmitting: false,

  /**
   * 顯示學員申請頁面（本人或代理）
   */
  async showEduStudentApply(teamId) {
    await this.showPage('page-edu-student-apply');

    const team = ApiService.getTeam(teamId);
    const titleEl = document.getElementById('edu-apply-title');
    if (titleEl) titleEl.textContent = team ? '申請加入「' + team.name + '」' : '申請加入';

    document.getElementById('edu-apply-team-id').value = teamId;

    // 檢查此俱樂部是否已有「本人」紀錄
    const curUser = ApiService.getCurrentUser();
    const students = await this._loadEduStudents(teamId);
    const hasSelf = curUser && students.some(s =>
      s.enrollStatus !== 'inactive' && s.selfUid === curUser.uid
    );

    const relationEl = document.getElementById('edu-apply-relation');
    if (hasSelf) {
      // 已有本人 → 鎖定代理
      relationEl.value = 'parent';
      relationEl.disabled = true;
    } else {
      relationEl.value = 'self';
      relationEl.disabled = false;
    }

    // 觸發身份聯動（帶入/清空欄位）
    this._onEduApplyRelationChange();
  },

  /**
   * 身份選單切換 → 自動帶入或清空欄位
   */
  _onEduApplyRelationChange() {
    const relation = document.getElementById('edu-apply-relation').value;
    const nameEl = document.getElementById('edu-apply-name');
    const birthdayEl = document.getElementById('edu-apply-birthday');
    const genderEl = document.getElementById('edu-apply-gender');

    if (relation === 'self') {
      const curUser = ApiService.getCurrentUser();
      nameEl.value = curUser ? (curUser.displayName || curUser.name || '') : '';
      nameEl.readOnly = true;
      // 生日格式統一為 YYYY-MM-DD（個人資料可能存 YYYY/MM/DD）
      const rawBday = (curUser && curUser.birthday) || '';
      birthdayEl.value = rawBday.replace(/\//g, '-');
      // 性別對照：中文 → value（個人資料可能存「男」「女」或 male/female）
      const rawGender = (curUser && curUser.gender) || '';
      const genderMap = { '男': 'male', '女': 'female', 'male': 'male', 'female': 'female' };
      genderEl.value = genderMap[rawGender] || 'male';
    } else {
      nameEl.value = '';
      nameEl.readOnly = false;
      birthdayEl.value = '';
      genderEl.value = 'male';
    }
  },

  /**
   * 提交學員申請
   */
  async handleEduStudentApply() {
    if (this._eduApplySubmitting) return;
    const _btnState = this._setEduBtnLoading('[onclick*="handleEduStudentApply"]');

    const teamId = document.getElementById('edu-apply-team-id').value;
    const name = document.getElementById('edu-apply-name').value.trim();
    const birthday = document.getElementById('edu-apply-birthday').value.trim();
    const gender = document.getElementById('edu-apply-gender').value;
    const relation = document.getElementById('edu-apply-relation').value;

    // ★ 必填驗證
    if (!name) { this.showToast('請輸入學員姓名'); return; }
    if (!birthday) { this.showToast('請選擇生日'); return; }
    if (!gender) { this.showToast('請選擇性別'); return; }
    if (!teamId) { this.showToast('俱樂部資料錯誤'); return; }

    const curUser = ApiService.getCurrentUser();
    if (!curUser) { this.showToast('請先登入'); return; }

    const team = ApiService.getTeam(teamId);
    if (!team || !this.isEducationClub(team)) {
      this.showToast('此俱樂部不接受學員申請');
      return;
    }

    if (team.eduSettings && team.eduSettings.acceptingStudents === false) {
      this.showToast('此俱樂部目前未開放報名');
      return;
    }

    // ★ 重複申請檢查
    const existingStudents = await this._loadEduStudents(teamId);
    if (relation === 'self') {
      // 本人：同一俱樂部只能有一筆 selfUid
      const selfDup = existingStudents.find(s =>
        s.enrollStatus !== 'inactive' && s.selfUid === curUser.uid
      );
      if (selfDup) {
        this.showToast('您已以本人身份加入此俱樂部');
        return;
      }
    } else {
      // 代理：同 parentUid + 同姓名不可重複
      const agentDup = existingStudents.find(s =>
        s.enrollStatus !== 'inactive' &&
        s.parentUid === curUser.uid &&
        (s.name || '').trim() === name
      );
      if (agentDup) {
        const statusText = agentDup.enrollStatus === 'pending' ? '審核中' : '已通過';
        this.showToast('「' + name + '」已申請過此俱樂部（' + statusText + '）');
        return;
      }
    }

    this._eduApplySubmitting = true;

    // ★ 本人模式：同步生日/性別到個人資料
    if (relation === 'self') {
      const profileUpdates = {};
      const curBday = (curUser.birthday || '').replace(/\//g, '-');
      if (birthday && birthday !== curBday) profileUpdates.birthday = birthday;
      const genderMap = { '男': 'male', '女': 'female' };
      const curGenderNorm = genderMap[curUser.gender] || curUser.gender || '';
      if (gender && gender !== curGenderNorm) profileUpdates.gender = gender;
      if (Object.keys(profileUpdates).length > 0) {
        ApiService.updateCurrentUser(profileUpdates);
      }
    }

    // 建立待審核學員
    const studentData = {
      id: this._generateEduId('stu'),
      name,
      birthday: birthday || null,
      gender,
      parentUid: relation === 'parent' ? curUser.uid : null,
      selfUid: relation === 'self' ? curUser.uid : null,
      groupIds: [],
      groupNames: [],
      coachNotes: '',
      positionTags: [],
      enrollStatus: 'pending',
      enrolledAt: null,
    };

    // 若有生日，自動匹配分組
    if (birthday) {
      const age = this.calcAge(birthday);
      const groups = await this._loadEduGroups(teamId);
      const autoGroupIds = this.autoMatchGroups(age, gender, groups);
      if (autoGroupIds.length > 0) {
        studentData.groupIds = autoGroupIds;
        studentData.groupNames = autoGroupIds.map(gid => {
          const g = groups.find(g => g.id === gid);
          return g ? g.name : gid;
        });
      }
    }

    try {
      await FirebaseService.createEduStudent(teamId, studentData);

      // ★ 同步更新本地快取，避免重複提交
      const cached = this._eduStudentsCache[teamId];
      if (cached) cached.push(studentData);
      else this._eduStudentsCache[teamId] = [studentData];

      // 教學俱樂部不發站內信（職員在分組內直接審核）
      this.showToast('申請已送出，請等待教練審核');
      this.goBack();
      // 立即重繪：根據返回目標頁面決定要刷新什麼
      // goBack 回到 team-detail → 重繪教育區塊（我的學員 + 分組列表）
      if (this._eduDetailTeamId) {
        this._renderEduMemberSection?.(this._eduDetailTeamId);
        if (document.getElementById('edu-group-list')) {
          this.renderEduGroupList?.(this._eduDetailTeamId);
        }
      }
      // goBack 回到 edu-students → 重繪分組學員列表
      if (this._eduCurrentTeamId && this._eduCurrentGroupId) {
        this.renderEduStudentList?.(this._eduCurrentTeamId, this._eduCurrentGroupId);
      }
    } catch (err) {
      console.error('[handleEduStudentApply]', err);
      this.showToast('申請失敗：' + (err.message || '請稍後再試'));
    } finally {
      this._eduApplySubmitting = false;
      _btnState.restore();
    }
  },

  /**
   * 教練審核學員（從站內信觸發）
   */
  async approveEduStudent(teamId, studentId) {
    try {
      await FirebaseService.updateEduStudent(teamId, studentId, {
        enrollStatus: 'active',
        enrolledAt: new Date().toISOString(),
      });
      const cached = this._eduStudentsCache[teamId];
      if (cached) {
        const s = cached.find(s => s.id === studentId);
        if (s) {
          s.enrollStatus = 'active';
          s.enrolledAt = new Date().toISOString();
        }
      }
      this._updateGroupMemberCounts(teamId);

      // 若當前用戶是家長，同步綁定到 eduChildren
      if (typeof this.syncEduChildBinding === 'function') {
        await this.syncEduChildBinding(teamId, studentId);
      }

      this.showToast('學員已通過審核');
    } catch (err) {
      console.error('[approveEduStudent]', err);
      this.showToast('審核失敗：' + (err.message || '請稍後再試'));
    }
  },

  async rejectEduStudent(teamId, studentId) {
    try {
      await FirebaseService.updateEduStudent(teamId, studentId, {
        enrollStatus: 'inactive',
      });
      const cached = this._eduStudentsCache[teamId];
      if (cached) {
        const s = cached.find(s => s.id === studentId);
        if (s) s.enrollStatus = 'inactive';
      }
      this.showToast('已拒絕此學員申請');
    } catch (err) {
      console.error('[rejectEduStudent]', err);
      this.showToast('操作失敗');
    }
  },

  /**
   * 取得俱樂部幹部 UID 列表（教練/領隊/經理）
   */
  _getTeamStaffUids(team) {
    if (!team) return [];
    const allUsers = ApiService.getAdminUsers();
    const uids = new Set();
    if (team.captainUid) uids.add(team.captainUid);
    if (!team.captainUid && team.captain) {
      const u = allUsers.find(u => u.name === team.captain || u.displayName === team.captain);
      if (u && u.uid) uids.add(u.uid);
    }
    (team.leaderUids || (team.leaderUid ? [team.leaderUid] : [])).forEach(uid => {
      if (uid) uids.add(uid);
    });
    (team.coaches || []).forEach(cName => {
      const u = allUsers.find(u => u.name === cName || u.displayName === cName);
      if (u && u.uid) uids.add(u.uid);
    });
    return Array.from(uids);
  },

});
