/* ================================================
   SportHub — Message: Inbox Actions (mark read, clear, tournament approve)
   Split from message-inbox.js — pure move, no logic changes
   Team join action in message-actions-team.js
   ================================================ */

Object.assign(App, {

  markAllRead() {
    const myMessages = this._filterMyMessages(ApiService.getMessages());
    const myUid = ApiService.getCurrentUser()?.uid;
    const unread = myMessages.filter(m => this._isMessageUnread(m));
    if (unread.length === 0) { this.showToast('沒有未讀訊息'); return; }
    unread.forEach(m => {
      if (!Array.isArray(m.readBy)) m.readBy = [];
      if (myUid && !m.readBy.includes(myUid)) m.readBy.push(myUid);
      m.unread = false;
    });
    if (!ModeManager.isDemo() && myUid) {
      const docsToUpdate = unread.filter(m => m._docId);
      if (docsToUpdate.length > 0) {
        const batch = db.batch();
        docsToUpdate.forEach(m => {
          batch.update(db.collection('messages').doc(m._docId), {
            readBy: firebase.firestore.FieldValue.arrayUnion(myUid),
            unread: false
          });
        });
        batch.commit().catch(err => console.error('[markAllRead]', err));
      }
    }
    this.renderMessageList();
    this.updateNotifBadge();
    this.showToast(`已將 ${unread.length} 則訊息標為已讀`);
  },

  async clearAllMessages() {
    const myMessages = this._filterMyMessages(ApiService.getMessages());
    const myUid = ApiService.getCurrentUser()?.uid || null;
    if (!myMessages.length) { this.showToast('沒有訊息可清空'); return; }
    if (!(await this.appConfirm(`確定要清空全部 ${myMessages.length} 則訊息？此操作無法恢復。`))) return;
    if (ModeManager.isDemo()) {
      myMessages.forEach(m => {
        const idx = DemoData.messages.indexOf(m);
        if (idx >= 0) DemoData.messages.splice(idx, 1);
      });
    } else {
      if (!myUid) {
        this.showToast('Please login first');
        return;
      }
      try {
        const toHide = myMessages.filter(m => m._docId);
        const fv = firebase.firestore.FieldValue;
        for (let i = 0; i < toHide.length; i += 450) {
          const chunk = toHide.slice(i, i + 450);
          const batch = db.batch();
          chunk.forEach(m => {
            batch.update(db.collection('messages').doc(m._docId), {
              hiddenBy: fv.arrayUnion(myUid),
              readBy: fv.arrayUnion(myUid),
              unread: false,
            });
          });
          await batch.commit();
        }
        myMessages.forEach(m => {
          if (!Array.isArray(m.hiddenBy)) m.hiddenBy = [];
          if (!m.hiddenBy.includes(myUid)) m.hiddenBy.push(myUid);
          if (!Array.isArray(m.readBy)) m.readBy = [];
          if (!m.readBy.includes(myUid)) m.readBy.push(myUid);
          m.unread = false;
        });
      } catch (err) {
        console.error('[clearAllMessages]', err);
        this.showToast('清空失敗，請重試');
        return;
      }
    }
    this.renderMessageList();
    this.updateNotifBadge();
    this.showToast('已清空所有訊息');
  },

  _getTournamentMessageGroupId(msg) {
    return String(msg?.meta?.messageGroupId || msg?.meta?.groupId || '').trim();
  },

  _syncTournamentMessageActionStatus(msgId, groupId, updates = {}, options = {}) {
    const { syncGroup = true } = options;
    const messages = ApiService.getMessages();
    const safeGroupId = String(groupId || '').trim();
    const safeUpdates = { ...updates };
    const applyUpdates = message => {
      if (!message) return;
      Object.assign(message, safeUpdates);
      ApiService.updateMessage(message.id, safeUpdates);
    };

    applyUpdates(messages.find(message => message.id === msgId));
    if (!syncGroup || !safeGroupId) return;

    messages.forEach(message => {
      if (message.id === msgId) return;
      if (this._getTournamentMessageGroupId(message) !== safeGroupId) return;
      if (String(message.actionStatus || '').trim().toLowerCase() !== 'pending') return;
      applyUpdates(message);
    });
  },

  async openFriendlyTournamentMessageReview(msgId) {
    const messages = ApiService.getMessages();
    const msg = messages.find(message => message.id === msgId);
    const tournamentId = String(msg?.meta?.tournamentId || '').trim();
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

});
