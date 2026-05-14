/* === SportHub — Team: Join/Leave team + role changes === */

Object.assign(App, {

  // _applyRoleChange → 已搬至 team-list-helpers.js

  _TEAM_JOIN_REQUEST_COOLDOWN_MS: 24 * 60 * 60 * 1000,
  _teamJoinRequestOptimisticByTeam: {},

  _parseTeamJoinRequestTime(value) {
    if (!value) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value instanceof Date) return value.getTime();
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') {
      return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
    }
    const text = String(value || '').trim();
    if (!text) return 0;
    const [dp, tp] = text.split(' ');
    const [y, mo, d] = (dp || '').split('/').map(Number);
    const [h, mi] = (tp || '0:0').split(':').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return 0;
    return new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
  },

  _getTeamJoinMessageTime(message) {
    if (!message || typeof message !== 'object') return 0;
    const candidates = [
      message.sentAt,
      message.createdAt,
      message.createdAtMs,
      message.timestamp,
      message.time,
    ];
    for (const value of candidates) {
      const parsed = this._parseTeamJoinRequestTime(value);
      if (parsed > 0) return parsed;
    }
    return 0;
  },

  _getTeamJoinRequestKey(teamId, applicantUid) {
    const safeTeamId = String(teamId || '').trim();
    const safeUid = String(applicantUid || '').trim();
    return safeTeamId && safeUid ? `${safeTeamId}::${safeUid}` : '';
  },

  _getTeamJoinRequestState(teamId, user = null) {
    const safeTeamId = String(teamId || '').trim();
    const applicant = user || ApiService.getCurrentUser?.() || null;
    const applicantUid = String(applicant?.uid || '').trim();
    const cooldownMs = this._TEAM_JOIN_REQUEST_COOLDOWN_MS || (24 * 60 * 60 * 1000);
    const now = Date.now();
    const result = {
      status: 'clear',
      applicantUid,
      hoursLeft: 0,
      pendingMessages: [],
      expiredPendingMessages: [],
      rejectedMessage: null,
    };
    if (!safeTeamId || !applicantUid) return result;

    const matchesRequest = (message) => (
      message?.actionType === 'team_join_request'
      && String(message?.meta?.teamId || '').trim() === safeTeamId
      && String(message?.meta?.applicantUid || '').trim() === applicantUid
    );
    const messages = Array.isArray(ApiService.getMessages?.()) ? ApiService.getMessages() : [];
    const related = messages.filter(matchesRequest);
    const key = this._getTeamJoinRequestKey(safeTeamId, applicantUid);
    const optimistic = key ? this._teamJoinRequestOptimisticByTeam?.[key] : null;
    const reviewedOptimisticGroup = optimistic?.groupId && related.some(message =>
      String(message?.meta?.groupId || '') === String(optimistic.groupId)
      && String(message?.actionStatus || '').trim() !== 'pending'
    );
    if (reviewedOptimisticGroup && key) {
      delete this._teamJoinRequestOptimisticByTeam[key];
    }

    const pendingItems = related
      .filter(message => String(message?.actionStatus || '').trim() === 'pending')
      .map(message => ({ message, sentAt: this._getTeamJoinMessageTime(message) }))
      .filter(item => item.sentAt > 0);

    if (optimistic && !reviewedOptimisticGroup) {
      pendingItems.push({ message: null, sentAt: Number(optimistic.sentAt || 0) });
    }

    const activePending = pendingItems.filter(item => now - item.sentAt < cooldownMs);
    if (activePending.length > 0) {
      const mostRecent = Math.max(...activePending.map(item => item.sentAt));
      result.status = 'pending';
      result.hoursLeft = Math.max(1, Math.ceil((cooldownMs - (now - mostRecent)) / 3600000));
      result.pendingMessages = activePending.map(item => item.message).filter(Boolean);
      return result;
    }

    result.expiredPendingMessages = pendingItems
      .filter(item => item.message && now - item.sentAt >= cooldownMs)
      .map(item => item.message);

    const rejectedItems = related
      .filter(message => String(message?.actionStatus || '').trim() === 'rejected')
      .map(message => ({
        message,
        rejectedAt: this._parseTeamJoinRequestTime(message.rejectedAt),
      }))
      .filter(item => item.rejectedAt > 0)
      .sort((a, b) => b.rejectedAt - a.rejectedAt);
    const recentRejected = rejectedItems.find(item => now - item.rejectedAt < cooldownMs);
    if (recentRejected) {
      result.status = 'rejectedCooldown';
      result.hoursLeft = Math.max(1, Math.ceil((cooldownMs - (now - recentRejected.rejectedAt)) / 3600000));
      result.rejectedMessage = recentRejected.message;
    }
    return result;
  },

  _showTeamJoinRequestStateToast(state) {
    if (state?.status === 'pending') {
      this.showToast(`\u60a8\u5df2\u7533\u8acb\u6b64\u4ff1\u6a02\u90e8\uff0c\u8acb\u7b49\u5019\u5be9\u6838\uff08\u53ef\u65bc ${state.hoursLeft || 24} \u5c0f\u6642\u5f8c\u518d\u6b21\u7533\u8acb\uff09`);
      return true;
    }
    if (state?.status === 'rejectedCooldown') {
      this.showToast(`\u60a8\u7684\u7533\u8acb\u5df2\u88ab\u62d2\u7d55\uff0c\u8acb\u65bc ${state.hoursLeft || 24} \u5c0f\u6642\u5f8c\u518d\u6b21\u7533\u8acb`);
      return true;
    }
    return false;
  },

  showTeamJoinPendingToast(teamId) {
    const state = this._getTeamJoinRequestState(teamId);
    if (this._showTeamJoinRequestStateToast(state)) return false;
    return this.handleJoinTeam(teamId);
  },

  _markTeamJoinRequestPending(teamId, applicantUid, groupId) {
    const key = this._getTeamJoinRequestKey(teamId, applicantUid);
    if (!key) return;
    this._teamJoinRequestOptimisticByTeam = this._teamJoinRequestOptimisticByTeam || {};
    this._teamJoinRequestOptimisticByTeam[key] = {
      sentAt: Date.now(),
      groupId: groupId || '',
    };
  },

  _refreshTeamDetailPrimaryAction(teamId) {
    if (String(this._teamDetailId || '') !== String(teamId || '')) return false;
    const team = ApiService.getTeam?.(teamId);
    const target = typeof document !== 'undefined'
      ? document.querySelector?.('#page-team-detail .td-club-head-action')
      : null;
    if (!team || !target || typeof this._buildTeamDetailPrimaryAction !== 'function') return false;
    target.innerHTML = this._buildTeamDetailPrimaryAction(team);
    return true;
  },

  async handleJoinTeam(teamId) {
    // v8 M1：加入俱樂部前先擋未登入（寫入動作）
    if (this._requireProtectedActionLogin?.({ type: 'joinTeam', teamId }, { suppressToast: true })) return;
    // 2026-04-19 UX：寫入類動作必須先補齊個人資料（地區等會影響俱樂部判定）
    if (this._requireProfileComplete()) return;
    // 1. Already in this team -> no need to re-apply.
    const user = ApiService.getCurrentUser();
    const alreadyInTeam = user && (
      (typeof this._isUserInTeam === 'function' ? this._isUserInTeam(user, teamId) : false) ||
      user.teamId === teamId
    );
    if (alreadyInTeam) {
      const sameTeam = ApiService.getTeam(teamId);
      this.showToast(`您已是「${sameTeam ? sameTeam.name : '俱樂部'}」隊員，無需重複申請`);
      return;
    }

    // 2. Get target team
    const t = ApiService.getTeam(teamId);
    if (!t) { this.showToast('找不到此俱樂部'); return; }
    // 特殊類型俱樂部導向專屬申請流程（Phase 4 §10.2 type handler）
    const typeHandler = this._getTeamTypeHandler(t.type);
    if (typeHandler.joinHandler) {
      typeHandler.joinHandler(teamId);
      return;
    }

    // 3. Get current user info
    const curUser = ApiService.getCurrentUser();
    const applicantUid = curUser?.uid || null;
    const applicantName = curUser?.displayName || '未知';
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

    const joinState = this._getTeamJoinRequestState(teamId, curUser);
    if (this._showTeamJoinRequestStateToast(joinState)) return;
    (joinState.expiredPendingMessages || []).forEach(m => {
      ApiService.updateMessage(m.id, { actionStatus: 'ignored' });
      m.actionStatus = 'ignored';
    });

    if (!(await this.appConfirm(`確定要加入「${t.name}」俱樂部？`))) return;

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
      this.showToast('此俱樂部暫無可審核的職員，請聯繫管理員');
      return;
    }

    // 5. Generate groupId linking all staff messages for this request
    const groupId = 'tjr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    // 6. Broadcast join request to ALL staff
    staffUids.forEach(staffUid => {
      this._deliverMessageWithLinePush(
        '俱樂部加入申請',
        `${applicantName} 申請加入「${t.name}」俱樂部，請審核此申請。`,
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
    this._markTeamJoinRequestPending(teamId, applicantUid, groupId);
    this._refreshTeamDetailPrimaryAction(teamId);
    this._grantAutoExp?.(applicantUid, 'join_team', t.name);
    this.showToast('已送出加入申請！');
  },

  async handleLeaveTeam(teamId) {
    const t = ApiService.getTeam(teamId);
    if (!t) return;
    if (!(await this.appConfirm(`確定要退出「${t.name}」俱樂部？退出後如需重新加入，可能需要再次送出申請。`))) return;

    const curUser = ApiService.getCurrentUser();
    const userName = curUser?.displayName || '';
    const uid = curUser?.uid || null;

    // 經理不能退出（優先用 UID 比對，fallback 用 name）
    if ((t.captainUid && t.captainUid === uid) || (!t.captainUid && t.captain && (t.captain === userName || t.captain === curUser?.name))) {
      this.showToast('經理無法退出俱樂部，請先轉移經理職務');
      return;
    }

    // 領隊不能退出
    const leaderUids = t.leaderUids || (t.leaderUid ? [t.leaderUid] : []);
    if (uid && leaderUids.includes(uid)) {
      this.showToast('領隊無法退出俱樂部，請先轉移領隊職務');
      return;
    }

    // 判斷是否教練（退隊後需更新 coachUids 陣列）
    const wasCoach = !!(uid && Array.isArray(t.coachUids) && t.coachUids.includes(uid));

    // 清除用戶俱樂部資料
    const baseUser = ApiService.getCurrentUser() || null;
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

    // 關鍵寫入：用戶退出俱樂部（await 確保成功才繼續）
    try {
      await ApiService.updateCurrentUserAwait(userTeamUpdates);
    } catch (err) {
      if (!err?._toasted) this.showToast('退出俱樂部失敗，請重試');
      ApiService._writeErrorLog({ fn: 'handleLeaveTeam.updateCurrentUserAwait', teamId, uid }, err);
      return;
    }

    // 俱樂部人數 -1（非關鍵，fire-and-forget 可接受）
    if (wasCoach) {
      const newCoachUids = (t.coachUids || []).filter(u => u !== uid);
      ApiService.updateTeam(teamId, { coachUids: newCoachUids });
    }
    const memberCount = this._calcTeamMemberCount(teamId);
    ApiService.updateTeam(teamId, { members: memberCount });

    // 退隊後重新計算角色（教練退隊可能需降級）
    if (wasCoach && uid) {
      this._applyRoleChange(ApiService._recalcUserRole(uid));
    }

    ApiService._writeOpLog('team_leave', '退出俱樂部', `${userName} 退出「${t.name}」`);
    this.showToast(`已退出「${t.name}」`);
    this.showTeamDetail(teamId);
    this.renderTeamList();
    this.renderProfileData();
    this.renderHotEvents();
    this.renderActivityList();
  },

  goMyTeam() {
    let teamId = null;
    const user = ApiService.getCurrentUser();
    if (user) {
      const teamIds = (typeof this._getUserTeamIds === 'function') ? this._getUserTeamIds(user) : (user.teamId ? [user.teamId] : []);
      teamId = teamIds[0] || null;
    }
    if (teamId) {
      this.showTeamDetail(teamId);
    } else {
      this.showToast('您目前沒有加入任何俱樂部');
    }
  },

});
