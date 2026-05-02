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
    // 保留批量清除 pending 審核訊息的保護，避免誤刪需要處理的通知。
    const deletable = myMessages.filter(m => !this._isPendingActionMessage(m));
    if (!deletable.length) {
      this.showToast('\u6c92\u6709\u53ef\u6e05\u7a7a\u7684\u8a0a\u606f\uff1b\u5f85\u5be9\u6838\u901a\u77e5\u8acb\u958b\u555f\u5167\u5bb9\u5f8c\u55ae\u5c01\u79fb\u9664\u3002');
      return;
    }
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

  _isPendingActionMessage(msg) {
    return !!(
      msg
      && msg.actionType
      && String(msg.actionStatus || '').trim().toLowerCase() === 'pending'
    );
  },

  _getInboxRemoveConfirmText(msg) {
    if (this._isPendingActionMessage(msg)) {
      return '\u9019\u53ea\u6703\u5c07\u9019\u5c01\u901a\u77e5\u5f9e\u4f60\u7684\u6536\u4ef6\u5323\u79fb\u9664\uff0c\u4e0d\u6703\u53d6\u6d88\u5831\u540d\u3001\u4e0d\u6703\u901a\u904e\u6216\u62d2\u7d55\u5be9\u6838\uff0c\u4e5f\u4e0d\u6703\u522a\u9664\u8cfd\u4e8b\u6216\u4ff1\u6a02\u90e8\u7533\u8acb\u3002\u78ba\u5b9a\u8981\u79fb\u9664\u55ce\uff1f';
    }
    return '\u78ba\u5b9a\u8981\u5c07\u9019\u5c01\u8a0a\u606f\u5f9e\u4f60\u7684\u6536\u4ef6\u5323\u79fb\u9664\u55ce\uff1f';
  },

  async removeInboxMessage(msgId) {
    const messages = ApiService.getMessages() || [];
    const msg = messages.find(m => m.id === msgId);
    if (!msg) {
      this.showToast('\u627e\u4e0d\u5230\u9019\u5c01\u8a0a\u606f');
      return;
    }

    const authUid = (typeof auth !== 'undefined' && auth?.currentUser?.uid) ? auth.currentUser.uid : null;
    const myUid = ApiService.getCurrentUser()?.uid || authUid;
    if (!myUid) {
      this.showToast('Please login first');
      return;
    }

    if (!(await this.appConfirm(this._getInboxRemoveConfirmText(msg)))) return;

    try {
      const docId = String(msg._docId || msg.id || '').trim();
      if (docId) {
        await db.collection('users').doc(myUid).collection('inbox').doc(docId).delete();
      }

      const cache = (typeof FirebaseService !== 'undefined' && FirebaseService._cache?.messages)
        ? FirebaseService._cache.messages
        : messages;
      const idx = cache.findIndex(m => m === msg || m.id === msgId);
      if (idx >= 0) cache.splice(idx, 1);

      void ApiService.writeAuditLog?.({
        action: 'inbox_message_remove',
        targetType: 'message',
        targetId: String(msg._docId || msg.id || ''),
        targetLabel: String(msg.title || '').slice(0, 80),
        result: 'success',
        source: 'web',
        meta: {
          actionType: msg.actionType || '',
          actionStatus: msg.actionStatus || '',
          inboxOnly: true,
        },
      });

      const modal = document.getElementById('msg-inbox-detail-modal');
      if (modal) modal.style.display = 'none';
      this.renderMessageList();
      this.updateNotifBadge();
      this.updateStorageBar();
      this.showToast('\u5df2\u5f9e\u6536\u4ef6\u5323\u79fb\u9664');
    } catch (err) {
      console.error('[removeInboxMessage]', err);
      ApiService._writeErrorLog?.({
        fn: 'removeInboxMessage',
        msgId,
        docId: msg._docId || '',
        actionStatus: msg.actionStatus || '',
      }, err);
      this.showToast('\u79fb\u9664\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
    }
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
