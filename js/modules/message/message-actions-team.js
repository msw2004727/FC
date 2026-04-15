/* ================================================
   SportHub — Message: Team Join Action Handler
   handleTeamJoinAction — the main team join approve/reject flow
   Split from message-actions.js — pure move, no logic changes
   ================================================ */

Object.assign(App, {

  async handleTeamJoinAction(msgId, action) {
    if (this.hasPermission && !this.hasPermission('team.review_join') && !this.hasPermission('admin.teams.entry')) { this.showToast('權限不足'); return; }
    const messages = ApiService.getMessages();
    const msg = messages.find(m => m.id === msgId);
    if (!msg || !msg.meta) return;

    const { teamId, teamName, applicantUid, applicantName, groupId } = msg.meta;

    // 1. Permission check: current user must be team staff (captain/leader/coach) or admin
    let team = await ApiService.getTeamAsync(teamId);
    if (!team) { this.showToast('找不到此俱樂部'); return; }
    const curUser = ApiService.getCurrentUser();
    const curUid = curUser?.uid || null;
    const teamLeaderUids = team.leaderUids || (team.leaderUid ? [team.leaderUid] : []);
    const isTeamStaff =
      (team.captainUid && team.captainUid === curUid) ||
      (curUid && teamLeaderUids.includes(curUid)) ||
      (curUid && Array.isArray(team.coachUids) && team.coachUids.includes(curUid)) ||
      ['admin', 'super_admin'].includes(curUser?.role);
    if (!isTeamStaff) { this.showToast('您沒有審核此申請的權限'); return; }

    // 2. First-action-wins: check if another staff already acted on this group
    if (groupId) {
      const alreadyActed = messages.find(m =>
        m.id !== msgId &&
        m.actionType === 'team_join_request' &&
        m.meta?.groupId === groupId &&
        m.actionStatus !== 'pending'
      );
      if (alreadyActed) {
        const statusLabel = { approved: '同意', rejected: '拒絕', ignored: '忽略' }[alreadyActed.actionStatus] || alreadyActed.actionStatus;
        const actorName = alreadyActed.reviewerName || '其他職員';
        this.showToast(`此申請已由「${actorName}」${statusLabel}`);
        msg.actionStatus = alreadyActed.actionStatus;
        msg.reviewerName = alreadyActed.reviewerName;
        ApiService.updateMessage(msgId, { actionStatus: alreadyActed.actionStatus, reviewerName: alreadyActed.reviewerName || '' });
        document.getElementById('msg-inbox-detail-modal').style.display = 'none';
        this.renderMessageList();
        return;
      }
    }

    const reviewerName = curUser?.displayName || '審核人';

    if (action === 'approve') {
      const users = ApiService.getAdminUsers();
      const applicant = users.find(u => u.uid === applicantUid);
      if (!applicant) {
        this.showToast('找不到申請人資料，無法完成審批');
        return;
      }

      const normalizeMembership = (data) => {
        const ids = [];
        const names = [];
        const seen = new Set();
        const pushMember = (id, name) => {
          const tid = String(id || '').trim();
          if (!tid || seen.has(tid)) return;
          seen.add(tid);
          ids.push(tid);
          names.push(String(name || '').trim());
        };
        if (Array.isArray(data?.teamIds)) {
          data.teamIds.forEach((id, idx) => {
            const name = Array.isArray(data?.teamNames) ? data.teamNames[idx] : '';
            pushMember(id, name);
          });
        }
        pushMember(data?.teamId, data?.teamName);
        return { ids, names };
      };

      const targetTeamId = String(teamId);
      const targetTeamName = String(teamName || ApiService.getTeam(teamId)?.name || '').trim();
      let membership = normalizeMembership(applicant);
      let shouldWriteMembership = !membership.ids.includes(targetTeamId);
      if (shouldWriteMembership) {
        membership.ids.push(targetTeamId);
        membership.names.push(targetTeamName || targetTeamId);
      }
      if (applicant._docId) {
        try {
          const authed = await FirebaseService._ensureAuth();
          if (!authed) {
            this.showToast('登入已過期，請重新整理頁面後再試');
            ApiService._writeErrorLog({ fn: 'handleTeamJoinAction', teamId, applicantUid, reason: 'auth_expired' }, new Error('_ensureAuth returned false'));
            return;
          }

          let liveData = null;
          try {
            const liveSnap = await db.collection('users').doc(applicant._docId).get({ source: 'server' });
            if (liveSnap.exists) {
              liveData = liveSnap.data() || {};
            }
          } catch (readErr) {
            console.warn('[approve] live user read failed, fallback to cache:', readErr?.code || readErr?.message || readErr);
          }

          if (liveData) {
            membership = normalizeMembership(liveData);
            shouldWriteMembership = !membership.ids.includes(targetTeamId);
            if (shouldWriteMembership) {
              membership.ids.push(targetTeamId);
              membership.names.push(targetTeamName || targetTeamId);
            }
          }

          if (shouldWriteMembership) {
            const membershipUpdate = {
              teamId: membership.ids[0] || null,
              teamName: membership.names[0] || '',
              teamIds: membership.ids,
              teamNames: membership.names,
            };
            console.log('[approve] writing updateUser membership:', applicant._docId, membershipUpdate, 'auth.uid:', auth?.currentUser?.uid);
            await FirebaseService.updateUser(applicant._docId, membershipUpdate);
          } else {
            console.log('[approve] skip updateUser: applicant already in target team', { applicantUid, teamId });
          }
        } catch (err) {
          console.error('[approve] updateUser failed - code:', err?.code, 'msg:', err?.message, 'docId:', applicant._docId, 'auth.uid:', auth?.currentUser?.uid, err);
          this.showToast(`寫入失敗（${err?.code || err?.message || '權限錯誤'}），請重試`);
          ApiService._writeErrorLog({ fn: 'handleTeamJoinAction', teamId, applicantUid, docId: applicant._docId, authUid: auth?.currentUser?.uid || 'null' }, err);
          return;
        }
      }

      const finalTeamName = targetTeamName || (membership.names[membership.ids.indexOf(targetTeamId)] || teamName || '');
      Object.assign(applicant, {
        teamId: membership.ids[0] || null,
        teamName: membership.names[0] || '',
        teamIds: membership.ids,
        teamNames: membership.names,
      });
      const curUserObj = ApiService.getCurrentUser();
      if (curUserObj && curUserObj.uid === applicantUid) {
        ApiService.updateCurrentUser({
          teamId: membership.ids[0] || null,
          teamName: membership.names[0] || '',
          teamIds: membership.ids,
          teamNames: membership.names,
        });
      }

      if (shouldWriteMembership) {
        const memberCount = (typeof this._calcTeamMemberCount === 'function')
          ? this._calcTeamMemberCount(teamId)
          : (ApiService.getAdminUsers() || []).filter(u => u.teamId === teamId || (Array.isArray(u.teamIds) && u.teamIds.includes(teamId))).length;
        ApiService.updateTeam(teamId, { members: memberCount });

        this._deliverMessageWithLinePush(
          '俱樂部申請通過',
          `恭喜！您已成功加入「${finalTeamName}」俱樂部，審核人：${reviewerName}。`,
          'system', '系統', applicantUid, '系統', null,
          { lineOptions: { source: 'team_join_review:approve' } }
        );
        void ApiService.writeAuditLog({
          action: 'team_join_approve',
          targetType: 'team',
          targetId: teamId,
          targetLabel: finalTeamName,
          result: 'success',
          source: 'web',
          meta: { teamId, statusTo: 'approved' },
        });
        this._evaluateAchievements(null, { targetUid: applicantUid });
        this.showToast('已同意加入申請');
      } else {
        this.showToast('申請者已在此俱樂部，僅更新審核狀態');
      }

    } else if (action === 'reject') {
      this._deliverMessageWithLinePush(
        '俱樂部申請結果',
        `很抱歉，您申請加入「${teamName}」俱樂部未獲通過。如有疑問，請聯繫俱樂部職員。`,
        'system', '系統', applicantUid, '系統', null,
        { lineOptions: { source: 'team_join_review:reject' } }
      );
      void ApiService.writeAuditLog({
        action: 'team_join_reject',
        targetType: 'team',
        targetId: teamId,
        targetLabel: teamName,
        result: 'success',
        source: 'web',
        meta: { teamId, statusTo: 'rejected' },
      });
      this.showToast('已拒絕加入申請');

    } else if (action === 'ignore') {
      ApiService._writeOpLog('team_approve', '俱樂部審批', `${reviewerName} 忽略「${applicantName}」加入「${teamName}」的申請`);
      this.showToast('已忽略此申請');
    }

    // 3. Build update payload
    const statusMap = { approve: 'approved', reject: 'rejected', ignore: 'ignored' };
    const newStatus = statusMap[action];
    const updatePayload = { actionStatus: newStatus, reviewerName };
    if (action === 'reject') updatePayload.rejectedAt = Date.now();

    ApiService.updateMessage(msgId, updatePayload);
    Object.assign(msg, updatePayload);

    // 4. Sync all messages in this group
    if (groupId) {
      const otherStaffUids = new Set();
      messages.forEach(m => {
        if (m.id !== msgId && m.meta?.groupId === groupId) {
          if (m.actionStatus === 'pending') {
            ApiService.updateMessage(m.id, updatePayload);
            Object.assign(m, updatePayload);
          }
          if (m.targetUid && m.targetUid !== curUid) otherStaffUids.add(m.targetUid);
        }
      });
      if (action !== 'ignore') {
        const actionLabel = action === 'approve' ? '同意' : '拒絕';
        otherStaffUids.forEach(uid => {
          this._deliverMessageWithLinePush(
            '入隊申請審核通知',
            `「${reviewerName}」已${actionLabel}「${applicantName}」加入「${teamName}」的申請。`,
            'system', '系統', uid, '系統', null,
            { lineOptions: { source: `team_join_review:broadcast:${action}` } }
          );
        });
      }
    }

    document.getElementById('msg-inbox-detail-modal').style.display = 'none';
    this.renderMessageList();
  },

});
