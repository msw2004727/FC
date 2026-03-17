/* === SportHub — Team: Join/Leave team + role changes === */

Object.assign(App, {

  /**
   * 接收 _recalcUserRole 結果，發送站內信 + 寫操作日誌
   */
  _applyRoleChange(result) {
    if (!result) return;
    const { uid, oldRole, newRole, userName } = result;
    const isUpgrade = (ROLE_LEVEL_MAP[newRole] || 0) > (ROLE_LEVEL_MAP[oldRole] || 0);
    const roleName = ROLES[newRole]?.label || newRole;
    const action = isUpgrade ? '晉升' : '調整';
    this._sendNotifFromTemplate('role_upgrade', {
      userName, roleName,
    }, uid, 'private', '私訊');
    ApiService._writeOpLog('role', '角色變更', `${userName} 自動${action}為「${roleName}」（原：${ROLES[oldRole]?.label || oldRole}）`);
  },

  handleJoinTeam(teamId) {
    // 1. Already in this team -> no need to re-apply.
    if (ModeManager.isDemo()) {
      if (this._userTeam === teamId) {
        const sameTeam = ApiService.getTeam(teamId);
        this.showToast(`您已是「${sameTeam ? sameTeam.name : '球隊'}」隊員，無需重複申請`);
        return;
      }
    } else {
      const user = ApiService.getCurrentUser();
      const alreadyInTeam = user && (
        (typeof this._isUserInTeam === 'function' ? this._isUserInTeam(user, teamId) : false) ||
        user.teamId === teamId
      );
      if (alreadyInTeam) {
        const sameTeam = ApiService.getTeam(teamId);
        this.showToast(`您已是「${sameTeam ? sameTeam.name : '球隊'}」隊員，無需重複申請`);
        return;
      }
    }

    // 2. Get target team
    const t = ApiService.getTeam(teamId);
    if (!t) { this.showToast('找不到此球隊'); return; }

    // 3. Get current user info
    const curUser = ApiService.getCurrentUser();
    const applicantUid = curUser?.uid || (ModeManager.isDemo() ? DemoData.currentUser.uid : null);
    const applicantName = curUser?.displayName || (ModeManager.isDemo() ? DemoData.currentUser.displayName : '未知');
    if (!applicantUid) { this.showToast('請先登入'); return; }

    // Extra safety: avoid duplicate requests from members already in this team.
    const allUsersCache = ApiService.getAdminUsers() || [];
    const applicantUser = allUsersCache.find(u => u.uid === applicantUid);
    const alreadyInTarget = applicantUser && (
      (typeof this._isUserInTeam === 'function' ? this._isUserInTeam(applicantUser, teamId) : false) ||
      applicantUser.teamId === teamId
    );
    if (alreadyInTarget) {
      this.showToast(`您已是「${t.name}」隊員，無需重複申請`);
      return;
    }

    const allMessages = ApiService.getMessages();
    const COOLDOWN_MS = 24 * 60 * 60 * 1000;

    // helper: parse message time string "YYYY/MM/DD HH:MM" -> ms timestamp
    const _parseTimeStr = (str) => {
      if (!str) return 0;
      const [dp, tp] = str.split(' ');
      const [y, mo, d] = (dp || '').split('/').map(Number);
      const [h, mi] = (tp || '0:0').split(':').map(Number);
      return isNaN(y) ? 0 : new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
    };

    // Same-team pending request cooldown
    const pendingMsgs = allMessages.filter(m =>
      m.actionType === 'team_join_request' &&
      m.actionStatus === 'pending' &&
      m.meta && m.meta.teamId === teamId &&
      m.meta.applicantUid === applicantUid
    );
    if (pendingMsgs.length > 0) {
      const mostRecentSentAt = Math.max(...pendingMsgs.map(m => _parseTimeStr(m.time)));
      const elapsed = Date.now() - mostRecentSentAt;
      if (elapsed < COOLDOWN_MS) {
        const hoursLeft = Math.ceil((COOLDOWN_MS - elapsed) / 3600000);
        this.showToast(`您已申請此球隊，請等候審核（可於 ${hoursLeft} 小時後再次申請）`);
        return;
      }
      // Pending > 24h: mark as ignored (superseded) so staff won't see stale requests
      pendingMsgs.forEach(m => {
        ApiService.updateMessage(m.id, { actionStatus: 'ignored' });
        m.actionStatus = 'ignored';
      });
    }

    // Rejected request cooldown (24h)
    const recentRejected = allMessages.find(m =>
      m.actionType === 'team_join_request' &&
      m.actionStatus === 'rejected' &&
      m.meta && m.meta.teamId === teamId &&
      m.meta.applicantUid === applicantUid &&
      m.rejectedAt && (Date.now() - m.rejectedAt) < COOLDOWN_MS
    );
    if (recentRejected) {
      const hoursLeft = Math.ceil((COOLDOWN_MS - (Date.now() - recentRejected.rejectedAt)) / 3600000);
      this.showToast(`您的申請已被拒絕，請於 ${hoursLeft} 小時後再次申請`);
      return;
    }

    // 4. Collect all staff UIDs (captainUid + leaderUids + coaches)
    const allUsers = ApiService.getAdminUsers();
    const staffUids = new Set();
    if (t.captainUid) staffUids.add(t.captainUid);
    if (!t.captainUid && t.captain) {
      const u = allUsers.find(u => u.name === t.captain || u.displayName === t.captain);
      if (u && u.uid) staffUids.add(u.uid);
    }
    // 複數領隊
    (t.leaderUids || (t.leaderUid ? [t.leaderUid] : [])).forEach(lUid => {
      if (lUid) staffUids.add(lUid);
    });
    if (!t.leaderUids && !t.leaderUid && t.leader) {
      const u = allUsers.find(u => u.name === t.leader || u.displayName === t.leader);
      if (u && u.uid) staffUids.add(u.uid);
    }
    (t.coaches || []).forEach(cName => {
      const u = allUsers.find(u => u.name === cName || u.displayName === cName);
      if (u && u.uid) staffUids.add(u.uid);
    });
    if (staffUids.size === 0) {
      this.showToast('此球隊暫無可審核的職員，請聯繫管理員');
      return;
    }

    // 5. Generate groupId linking all staff messages for this request
    const groupId = 'tjr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    // 6. Broadcast join request to ALL staff
    staffUids.forEach(staffUid => {
      this._deliverMessageWithLinePush(
        '球隊加入申請',
        `${applicantName} 申請加入「${t.name}」球隊，請審核此申請。`,
        'system', '系統', staffUid, applicantName,
        {
          actionType: 'team_join_request',
          actionStatus: 'pending',
          meta: { teamId, teamName: t.name, applicantUid, applicantName, groupId },
        },
        { lineOptions: { source: 'team_join_request' } }
      );
    });

    void ApiService.writeAuditLog({
      action: 'team_join_request',
      targetType: 'team',
      targetId: teamId,
      targetLabel: t.name,
      result: 'success',
      source: 'web',
      meta: {
        teamId,
      },
    });
    this._grantAutoExp(applicantUid, 'join_team', t.name);
    this.showToast('已送出加入申請！');
  },

  async handleLeaveTeam(teamId) {
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    if (!(await this.appConfirm(`確定要退出「${t.name}」球隊？此操作無法自行撤回。`))) return;

    const curUser = ApiService.getCurrentUser();
    const userName = curUser?.displayName || (ModeManager.isDemo() ? DemoData.currentUser.displayName : '');
    const uid = curUser?.uid || (ModeManager.isDemo() ? DemoData.currentUser.uid : null);

    // 領隊不能退出
    if (t.captain === userName) {
      this.showToast('領隊無法退出球隊，請先轉移領隊職務');
      return;
    }

    // 如果用戶是教練，從球隊 coaches 移除
    const wasCoach = (t.coaches || []).includes(userName);
    if (wasCoach) {
      const newCoaches = t.coaches.filter(c => c !== userName);
      ApiService.updateTeam(teamId, { coaches: newCoaches });
    }

    // 清除用戶球隊資料
    const baseUser = ModeManager.isDemo()
      ? (DemoData.currentUser || null)
      : (ApiService.getCurrentUser() || null);
    const teamIds = (typeof this._getUserTeamIds === 'function')
      ? this._getUserTeamIds(baseUser)
      : (() => {
        const ids = [];
        const seen = new Set();
        const pushId = (id) => {
          const v = String(id || '').trim();
          if (!v || seen.has(v)) return;
          seen.add(v);
          ids.push(v);
        };
        if (Array.isArray(baseUser?.teamIds)) baseUser.teamIds.forEach(pushId);
        pushId(baseUser?.teamId);
        return ids;
      })();
    const nextTeamIds = teamIds.filter(id => id !== String(teamId));
    const nextTeamNames = nextTeamIds.map(id => {
      const teamObj = ApiService.getTeam(id);
      return teamObj ? teamObj.name : id;
    });
    const userTeamUpdates = nextTeamIds.length > 0
      ? { teamId: nextTeamIds[0], teamName: nextTeamNames[0] || '', teamIds: nextTeamIds, teamNames: nextTeamNames }
      : { teamId: null, teamName: null, teamIds: [], teamNames: [] };

    if (ModeManager.isDemo()) {
      Object.assign(DemoData.currentUser, userTeamUpdates);
      this._userTeam = userTeamUpdates.teamId || null;
    } else {
      ApiService.updateCurrentUser(userTeamUpdates);
    }
    // 同步 adminUsers
    const users = ApiService.getAdminUsers();
    const adminUser = users.find(u => u.uid === uid);
    if (adminUser) {
      Object.assign(adminUser, userTeamUpdates);
      if (!ModeManager.isDemo() && adminUser._docId) {
        FirebaseService.updateUser(adminUser._docId, userTeamUpdates).catch(err => { console.error('[leaveTeam]', err); ApiService._writeErrorLog({ fn: 'handleLeaveTeam', teamId }, err); });
      }
    }

    // 球隊人數 -1
    const memberCount = (typeof this._calcTeamMemberCount === 'function')
      ? this._calcTeamMemberCount(teamId)
      : Math.max(0, (t.members || 1) - 1);
    ApiService.updateTeam(teamId, { members: memberCount });

    // 退隊後重新計算角色（教練退隊可能需降級）
    if (wasCoach && uid) {
      this._applyRoleChange(ApiService._recalcUserRole(uid));
    }

    ApiService._writeOpLog('team_leave', '退出球隊', `${userName} 退出「${t.name}」`);
    this.showToast(`已退出「${t.name}」`);
    this.showTeamDetail(teamId);
    this.renderTeamList();
    this.renderProfileData();
    this.renderHotEvents();
    this.renderActivityList();
  },

  goMyTeam() {
    let teamId = this._userTeam;
    if (!ModeManager.isDemo()) {
      const user = ApiService.getCurrentUser();
      if (user) {
        const teamIds = (typeof this._getUserTeamIds === 'function') ? this._getUserTeamIds(user) : (user.teamId ? [user.teamId] : []);
        teamId = teamIds[0] || null;
      } else {
        teamId = null;
      }
    }
    if (teamId) {
      this.showTeamDetail(teamId);
    } else {
      this.showToast('您目前沒有加入任何球隊');
    }
  },

});
