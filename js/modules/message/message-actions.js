/* ================================================
   SportHub — Message: Inbox Actions (mark read, clear, tournament approve)
   Split from message-inbox.js — pure move, no logic changes
   Team join action in message-actions-team.js
   ================================================ */

Object.assign(App, {

  // Phase 3: per-user inbox — 標記全部已讀
  markAllRead() {
    const myMessages = ApiService.getMessages() || [];
    const myUid = ApiService.getCurrentUser()?.uid;
    const unread = myMessages.filter(m => this._isMessageUnread(m));
    if (unread.length === 0) { this.showToast('沒有未讀訊息'); return; }
    unread.forEach(m => { m.read = true; m.unread = false; });
    if (myUid) {
      const docsToUpdate = unread.filter(m => m._docId);
      if (docsToUpdate.length > 0) {
        const fv = firebase.firestore.FieldValue;
        const batch = db.batch();
        docsToUpdate.forEach(m => {
          batch.update(db.collection('users').doc(myUid).collection('inbox').doc(m._docId), {
            read: true, readAt: fv.serverTimestamp(),
          });
        });
        batch.commit().catch(err => console.error('[markAllRead]', err));
      }
    }
    this.renderMessageList();
    this.updateNotifBadge();
    this.showToast(`已將 ${unread.length} 則訊息標為已讀`);
  },

  // Phase 3: per-user inbox — 清空訊息（真刪除，審核訊息除外）
  async clearAllMessages() {
    const myMessages = ApiService.getMessages() || [];
    const myUid = ApiService.getCurrentUser()?.uid || null;
    if (!myMessages.length) { this.showToast('沒有訊息可清空'); return; }
    // 過濾掉 pending 審核訊息（Rules 也會阻擋）
    const deletable = myMessages.filter(m => !(m.actionType && m.actionStatus === 'pending'));
    if (!(await this.appConfirm(`確定要清空 ${deletable.length} 則訊息？此操作無法恢復。`))) return;
    if (!myUid) { this.showToast('Please login first'); return; }
    try {
      const toDel = deletable.filter(m => m._docId);
      for (let i = 0; i < toDel.length; i += 450) {
        const chunk = toDel.slice(i, i + 450);
        const batch = db.batch();
        chunk.forEach(m => {
          batch.delete(db.collection('users').doc(myUid).collection('inbox').doc(m._docId));
        });
        await batch.commit();
      }
      // 從本地快取移除已刪除的
      deletable.forEach(m => {
        const idx = (FirebaseService._cache.messages || []).indexOf(m);
        if (idx >= 0) FirebaseService._cache.messages.splice(idx, 1);
      });
    } catch (err) {
      console.error('[clearAllMessages]', err);
      this.showToast('清空失敗，請重試');
      return;
    }
    this.renderMessageList();
    this.updateNotifBadge();
    this.showToast('已清空所有訊息');
  },

  _getTournamentMessageGroupId(msg) {
    return String(
      msg?.meta?.messageGroupId
      || msg?.meta?.groupId
      || msg?.messageGroupId
      || msg?.groupId
      || ''
    ).trim();
  },

  _extractTournamentNameFromMessage(msg) {
    const directName = String(msg?.meta?.tournamentName || msg?.tournamentName || '').trim();
    if (directName) return directName;
    const body = String(msg?.body || msg?.preview || '').trim();
    const match = body.match(/參加「([^」]+)」/) || body.match(/賽事[：:]\s*([^\n]+)/);
    return String(match?.[1] || '').trim();
  },

  _resolveTournamentMessageTournamentId(msg) {
    const directId = String(
      msg?.meta?.tournamentId
      || msg?.tournamentId
      || ((msg?.meta?.linkType || msg?.linkType) === 'tournament' ? (msg?.meta?.linkId || msg?.linkId || msg?.targetId) : '')
      || ''
    ).trim();
    if (directId) return directId;

    const tournamentName = this._extractTournamentNameFromMessage?.(msg);
    if (!tournamentName) return '';
    const tournaments = ApiService.getTournaments?.() || [];
    const match = tournaments.find(tournament =>
      String(tournament?.name || '').trim() === tournamentName
    );
    return String(match?.id || match?._docId || '').trim();
  },

  // Phase 3 修正：所有 actionStatus 更新都透過 CF（Rules 只允許前端改 read/readAt）
  _syncTournamentMessageActionStatus(msgId, groupId, updates = {}, options = {}) {
    const { syncGroup = true } = options;
    const messages = ApiService.getMessages() || [];
    const safeGroupId = String(groupId || '').trim();
    const safeUpdates = { ...updates };

    // 本地快取樂觀更新（自己這則 + 同 groupId 的）
    const myMsg = messages.find(message => message.id === msgId);
    if (myMsg) Object.assign(myMsg, safeUpdates);
    if (syncGroup && safeGroupId) {
      messages.forEach(message => {
        if (message.id === msgId) return;
        if (this._getTournamentMessageGroupId(message) !== safeGroupId) return;
        if (String(message.actionStatus || '').trim().toLowerCase() !== 'pending') return;
        Object.assign(message, safeUpdates);
      });
    }

    // 透過 CF 統一更新所有 inbox（含自己的）— Rules 只允許前端改 read/readAt
    if (syncGroup && safeGroupId) {
      FirebaseService._syncGroupActionStatusCF?.(
        safeGroupId, safeUpdates.actionStatus, safeUpdates.reviewerName
      );
    }
  },

  async openFriendlyTournamentMessageReview(msgId) {
    const messages = ApiService.getMessages();
    const msg = messages.find(message => message.id === msgId);
    let tournamentId = this._resolveTournamentMessageTournamentId?.(msg) || '';
    if (!tournamentId) {
      try {
        if (typeof FirebaseService !== 'undefined' && typeof FirebaseService.ensureStaticCollectionsLoaded === 'function') {
          await FirebaseService.ensureStaticCollectionsLoaded(['tournaments']);
          tournamentId = this._resolveTournamentMessageTournamentId?.(msg) || '';
        }
      } catch (err) {
        console.warn('[openFriendlyTournamentMessageReview] tournament lookup fallback failed:', err);
      }
    }
    if (!tournamentId) {
      this.showToast('找不到對應的賽事');
      return;
    }

    const modal = document.getElementById('msg-inbox-detail-modal');
    if (modal) modal.style.display = 'none';

    await ScriptLoader.ensureForPage('page-tournament-detail');
    await this.showTournamentDetail(tournamentId);
    const teamsTab = document.querySelector('#td-tabs .tab[data-ttab="teams"]');
    if (!teamsTab) return;
    document.querySelectorAll('#td-tabs .tab').forEach(tab => tab.classList.remove('active'));
    teamsTab.classList.add('active');
    this.renderTournamentTab('teams');
  },

  async handleTournamentRegAction(msgId, action) {
    const messages = ApiService.getMessages();
    const msg = messages.find(m => m.id === msgId);
    if (!msg || !msg.meta) return;

    const { tournamentId, tournamentName, teamId, teamName, applicantUid, applicantName } = msg.meta;
    const groupId = this._getTournamentMessageGroupId(msg);
    const t = ApiService.getTournament(tournamentId);
    const curUser = ApiService.getCurrentUser();
    const reviewerName = curUser?.displayName || '審核人';
    const actionLabels = { approve: '同意', reject: '拒絕', ignore: '忽略' };

    if (this._isFriendlyTournamentRecord?.(t) || msg.actionType === 'tournament_friendly_application' || msg.meta?.applicationId) {
      this.showToast('友誼賽請到賽事詳情頁的隊伍分頁進行審核');
      await this.openFriendlyTournamentMessageReview(msgId);
      return;
    }

    if (action === 'approve') {
      if (!t) { this.showToast('找不到此賽事'); return; }
      if (!t.registeredTeams) t.registeredTeams = [];
      if (t.registeredTeams.length >= (t.maxTeams || 999)) {
        this.showToast('報名已滿，無法同意');
        return;
      }
      if (!t.registeredTeams.includes(teamId)) {
        t.registeredTeams.push(teamId);
        ApiService.updateTournament(tournamentId, { registeredTeams: [...t.registeredTeams] });
      }

      // 通知申請人
      this._deliverMessageWithLinePush(
        '賽事報名通過',
        `恭喜！「${teamName}」已成功報名賽事「${tournamentName}」！`,
        'tournament', '賽事', applicantUid, '系統', null,
        { lineOptions: { source: 'tournament_review:approve' } }
      );
      this.showToast('已同意報名申請');

    } else if (action === 'reject') {
      this._deliverMessageWithLinePush(
        '賽事報名結果',
        `很抱歉，「${teamName}」申請報名賽事「${tournamentName}」未獲通過。如有疑問，請聯繫主辦方。`,
        'tournament', '賽事', applicantUid, '系統', null,
        { lineOptions: { source: 'tournament_review:reject' } }
      );
      this.showToast('已拒絕報名申請');

    } else if (action === 'ignore') {
      this.showToast('已忽略此申請');
    }

    ApiService._writeOpLog('tourn_approve', '賽事審批', `${actionLabels[action]}「${teamName}」報名「${tournamentName}」`);

    const statusMap = { approve: 'approved', reject: 'rejected', ignore: 'ignored' };
    const newStatus = statusMap[action];

    // 更新本則及同 groupId 的所有相關訊息狀態（讓其他人的按鈕反灰）
    this._syncTournamentMessageActionStatus(msgId, groupId, { actionStatus: newStatus, reviewerName });

    // 通知同組的主辦人與委託人（不包含自己）審核結果
    if (groupId && t) {
      const myUid = curUser?.uid;
      const notifyUids = new Set();
      if (t.creatorUid && t.creatorUid !== myUid) notifyUids.add(t.creatorUid);
      (t.delegates || []).forEach(d => { if (d.uid && d.uid !== myUid) notifyUids.add(d.uid); });
      // 也通知主辦人（用名字查 UID）
      if (t.organizer && !t.creatorUid) {
        const orgUser = (ApiService.getAdminUsers() || []).find(u => u.name === t.organizer);
        if (orgUser && orgUser.uid !== myUid) notifyUids.add(orgUser.uid);
      }
      notifyUids.forEach(uid => {
        this._deliverMessageWithLinePush(
          '報名審核結果通知',
          `${reviewerName} 已「${actionLabels[action]}」俱樂部「${teamName}」報名賽事「${tournamentName}」的申請。`,
          'tournament', '賽事', uid, '系統', null,
          { lineOptions: { source: `tournament_review:broadcast:${action}` } }
        );
      });
    }

    document.getElementById('msg-inbox-detail-modal').style.display = 'none';
    this.renderMessageList();
    if (this.renderTournamentManage) this.renderTournamentManage();
    // 刷新賽事詳情頁（若正在查看）
    if (this.currentTournament === tournamentId && t) {
      this.renderRegisterButton(t);
    }
  },

  // ══════════════════════════════════
  //  教學俱樂部學員申請審核
  // ══════════════════════════════════

  async _handleEduApplyAction(msgId, action) {
    const messages = ApiService.getMessages();
    const msg = messages.find(m => m.id === msgId);
    if (!msg || !msg.meta) return;

    const { teamId, studentId, studentName, teamName } = msg.meta;
    if (!teamId || !studentId) {
      this.showToast('訊息資料不完整，無法審核');
      return;
    }

    // 確保教育模組已載入（approveEduStudent / rejectEduStudent 定義在 edu-student-join.js）
    await ScriptLoader.ensureForPage('page-edu-student-apply');

    const curUser = ApiService.getCurrentUser();
    const reviewerName = curUser?.displayName || '審核人';

    if (action === 'approve') {
      await this.approveEduStudent(teamId, studentId);
      // 通知申請者
      const applicantUid = msg.meta.applicantUid;
      if (applicantUid) {
        this._deliverMessageWithLinePush(
          '學員審核結果',
          '恭喜！「' + (studentName || '') + '」已通過「' + (teamName || '') + '」的學員審核，審核人：' + reviewerName + '。',
          'system', '系統', applicantUid, reviewerName, null,
          { lineOptions: { source: 'edu_student_review:approve' } }
        );
      }
    } else if (action === 'reject') {
      await this.rejectEduStudent(teamId, studentId);
      const applicantUid = msg.meta.applicantUid;
      if (applicantUid) {
        this._deliverMessageWithLinePush(
          '學員審核結果',
          '很抱歉，「' + (studentName || '') + '」未通過「' + (teamName || '') + '」的學員審核，審核人：' + reviewerName + '。如有疑問請聯繫教練。',
          'system', '系統', applicantUid, reviewerName, null,
          { lineOptions: { source: 'edu_student_review:reject' } }
        );
      }
    }

    const statusMap = { approve: 'approved', reject: 'rejected', ignore: 'ignored' };
    msg.actionStatus = statusMap[action] || action;
    msg.reviewerName = reviewerName;
    const updatePayload = { actionStatus: msg.actionStatus, reviewerName };
    ApiService.updateMessage(msgId, updatePayload);

    document.getElementById('msg-inbox-detail-modal').style.display = 'none';
    this.renderMessageList();
  },

});
