/* ================================================
   SportHub — Education: Student/Parent Join Flow
   ================================================
   學員/家長申請加入流程、教練審核
   ================================================ */

Object.assign(App, {

  /**
   * 顯示學員申請頁面（家長或獨立帳號）
   */
  async showEduStudentApply(teamId) {
    await this.showPage('page-edu-student-apply');

    const team = ApiService.getTeam(teamId);
    const titleEl = document.getElementById('edu-apply-title');
    if (titleEl) titleEl.textContent = team ? '申請加入「' + team.name + '」' : '申請加入';

    document.getElementById('edu-apply-team-id').value = teamId;
    document.getElementById('edu-apply-name').value = '';
    document.getElementById('edu-apply-birthday').value = '';
    document.getElementById('edu-apply-gender').value = 'male';
    document.getElementById('edu-apply-relation').value = 'parent';
  },

  /**
   * 提交學員申請
   */
  async handleEduStudentApply() {
    const teamId = document.getElementById('edu-apply-team-id').value;
    const name = document.getElementById('edu-apply-name').value.trim();
    const birthday = document.getElementById('edu-apply-birthday').value.trim();
    const gender = document.getElementById('edu-apply-gender').value;
    const relation = document.getElementById('edu-apply-relation').value;

    if (!name) { this.showToast('請輸入學員姓名'); return; }
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
      const autoGroupIds = this.autoMatchGroups(age, groups);
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

      // 通知俱樂部幹部
      const staffUids = this._getTeamStaffUids(team);
      staffUids.forEach(staffUid => {
        this._deliverMessageWithLinePush(
          '學員加入申請',
          curUser.displayName + ' 為「' + name + '」申請加入「' + team.name + '」教學班，請審核。',
          'system', '系統', staffUid, curUser.displayName,
          {
            actionType: 'edu_student_apply',
            actionStatus: 'pending',
            meta: { teamId, teamName: team.name, studentName: name, studentId: studentData.id, applicantUid: curUser.uid },
          },
          { lineOptions: { source: 'edu_student_apply' } }
        );
      });

      this.showToast('申請已送出，請等待教練審核');
      this.goBack();
    } catch (err) {
      console.error('[handleEduStudentApply]', err);
      this.showToast('申請失敗：' + (err.message || '請稍後再試'));
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
