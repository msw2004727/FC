/* ================================================
   SportHub — Message: User Inbox & Notification Utilities
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  User Inbox (前台)
  // ══════════════════════════════════

  _msgInboxFilter: 'all',

  // 判斷訊息對當前用戶是否未讀（per-user readBy 追蹤，向下相容舊 unread 欄位）
  _isMessageUnread(msg) {
    const myUid = ApiService.getCurrentUser()?.uid;
    if (!myUid) return false; // 未登入 → 不顯示未讀
    if (Array.isArray(msg.readBy)) return !msg.readBy.includes(myUid);
    return !!msg.unread;
  },

  _filterMyMessages(messages) {
    const curUser = ApiService.getCurrentUser();
    const myUid = curUser?.uid || null;
    const myRole = curUser?.role || 'user';
    const myTeamIds = (typeof this._getUserTeamIds === 'function')
      ? this._getUserTeamIds(curUser)
      : (() => {
        const ids = [];
        if (curUser?.teamId) ids.push(curUser.teamId);
        return ids;
      })();
    return messages.filter(m => {
      if (m.targetUid) return myUid && m.targetUid === myUid;
      if (m.targetTeamId) return myTeamIds.includes(String(m.targetTeamId));
      if (m.targetRoles && m.targetRoles.length) return m.targetRoles.includes(myRole);
      return true; // broadcast to all
    });
  },

  _msgSearchKeyword: '',
  _msgFilterDate: '',

  filterInboxMessages() {
    this._msgSearchKeyword = (document.getElementById('msg-search-keyword')?.value || '').trim().toLowerCase();
    this._msgFilterDate = document.getElementById('msg-filter-date')?.value || '';
    this.renderMessageList();
  },

  renderMessageList(filter) {
    const f = filter || this._msgInboxFilter || 'all';
    this._msgInboxFilter = f;
    const allMessages = this._filterMyMessages(ApiService.getMessages());
    let messages = f === 'all' ? allMessages : allMessages.filter(m => m.type === f);

    // 關鍵字搜尋
    const keyword = this._msgSearchKeyword || '';
    if (keyword) {
      messages = messages.filter(m =>
        (m.title || '').toLowerCase().includes(keyword) ||
        (m.preview || '').toLowerCase().includes(keyword) ||
        (m.body || '').toLowerCase().includes(keyword) ||
        (m.senderName || '').toLowerCase().includes(keyword)
      );
    }

    // 日期篩選（支援年/月/日，比對 time 欄位格式 YYYY/MM/DD HH:MM）
    const dateFilter = this._msgFilterDate || '';
    if (dateFilter) {
      const parts = dateFilter.split('-');
      const filterStr = `${parts[0]}/${parts[1]}/${parts[2]}`;
      messages = messages.filter(m => (m.time || '').startsWith(filterStr));
    }

    const container = document.getElementById('message-list');
    if (!container) return;
    container.innerHTML = messages.length ? messages.map(m => {
      const isUnread = this._isMessageUnread(m);
      return `
      <div class="msg-card${isUnread ? ' msg-unread' : ''}" onclick="App.readMessage(this, '${m.id}')">
        <div class="msg-card-header">
          <span class="msg-dot ${isUnread ? 'unread' : 'read'}"></span>
          <span class="msg-type msg-type-${m.type}">${escapeHTML(m.typeName)}</span>
          <span class="msg-title">${escapeHTML(m.title)}</span>
        </div>
        <div class="msg-preview">${escapeHTML(m.preview)}</div>
        <div class="msg-time">${escapeHTML(m.time)}</div>
      </div>`;
    }).join('') : '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">此分類沒有訊息</div>';
    this.updateNotifBadge();
    this.updateStorageBar();

    // 綁定分類 tabs（使用 msgBound 避免被通用 bindTabBars 搶先佔位）
    const tabs = document.getElementById('msg-inbox-tabs');
    if (tabs && !tabs.dataset.msgBound) {
      tabs.dataset.msgBound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderMessageList(tab.dataset.msgtype);
        });
      });
    }
  },

  updateNotifBadge() {
    const messages = this._filterMyMessages(ApiService.getMessages());
    const unreadCount = messages.filter(m => this._isMessageUnread(m)).length;
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.textContent = unreadCount;
    badge.style.display = unreadCount > 0 ? '' : 'none';
  },

  updateStorageBar() {
    const bar = document.getElementById('storage-bar');
    if (!bar) return;
    const total = 50;
    const used = this._filterMyMessages(ApiService.getMessages()).length;
    const remaining = Math.max(0, total - used);
    bar.innerHTML = `剩餘容量：<strong style="color:#111">${remaining}</strong>/${total}`;
  },

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
    if (!myMessages.length) { this.showToast('沒有訊息可清空'); return; }
    if (!(await this.appConfirm(`確定要清空全部 ${myMessages.length} 則訊息？此操作無法恢復。`))) return;
    if (ModeManager.isDemo()) {
      myMessages.forEach(m => {
        const idx = DemoData.messages.indexOf(m);
        if (idx >= 0) DemoData.messages.splice(idx, 1);
      });
    } else {
      try {
        const toDelete = myMessages.filter(m => m._docId);
        for (let i = 0; i < toDelete.length; i += 450) {
          const chunk = toDelete.slice(i, i + 450);
          const batch = db.batch();
          chunk.forEach(m => batch.delete(db.collection('messages').doc(m._docId)));
          await batch.commit();
        }
        toDelete.forEach(m => {
          const idx = FirebaseService._cache.messages.indexOf(m);
          if (idx >= 0) FirebaseService._cache.messages.splice(idx, 1);
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

  readMessage(el, id) {
    const messages = ApiService.getMessages();
    const msg = messages.find(m => m.id === id);
    if (msg && this._isMessageUnread(msg)) {
      const myUid = ApiService.getCurrentUser()?.uid;
      if (!Array.isArray(msg.readBy)) msg.readBy = [];
      if (myUid && !msg.readBy.includes(myUid)) msg.readBy.push(myUid);
      msg.unread = false;
      if (!ModeManager.isDemo() && msg._docId && myUid) {
        db.collection('messages').doc(msg._docId).update({
          readBy: firebase.firestore.FieldValue.arrayUnion(myUid),
          unread: false
        }).catch(err => console.error('[readMessage]', err));
      }
      el.classList.remove('msg-unread');
      const dot = el.querySelector('.msg-dot');
      if (dot) { dot.classList.remove('unread'); dot.classList.add('read'); }
      this.updateNotifBadge();
    }
    if (msg && msg.body) {
      this.showMessageDetail(id);
    }
  },

  showMessageDetail(id) {
    const messages = ApiService.getMessages();
    const msg = messages.find(m => m.id === id);
    if (!msg) return;
    const modal = document.getElementById('msg-inbox-detail-modal');
    const content = document.getElementById('msg-inbox-detail-content');
    if (!modal || !content) return;

    let actionHtml = '';
    if (msg.actionType === 'tournament_register_request') {
      if (msg.actionStatus === 'pending') {
        actionHtml = `
          <div class="msg-action-btns">
            <button class="msg-action-approve" onclick="App.handleTournamentRegAction('${msg.id}','approve')">同意</button>
            <button class="msg-action-reject" onclick="App.handleTournamentRegAction('${msg.id}','reject')">拒絕</button>
            <button class="msg-action-ignore" onclick="App.handleTournamentRegAction('${msg.id}','ignore')">忽略</button>
          </div>`;
      } else {
        const statusLabels = {
          approved: ['background:var(--success);color:#fff', '已同意'],
          rejected: ['background:var(--danger);color:#fff', '已拒絕'],
          ignored: ['background:var(--border);color:var(--text-secondary)', '已忽略'],
        };
        const [style, label] = statusLabels[msg.actionStatus] || ['', msg.actionStatus];
        actionHtml = `<div class="msg-action-status" style="${style}">${label}</div>`;
      }
    } else if (msg.actionType === 'team_join_request') {
      if (msg.actionStatus === 'pending') {
        actionHtml = `
          <div class="msg-action-btns">
            <button class="msg-action-approve" onclick="App.handleTeamJoinAction('${msg.id}','approve')">同意</button>
            <button class="msg-action-reject" onclick="App.handleTeamJoinAction('${msg.id}','reject')">拒絕</button>
            <button class="msg-action-ignore" onclick="App.handleTeamJoinAction('${msg.id}','ignore')">忽略</button>
          </div>`;
      } else {
        const statusLabels = {
          approved: ['background:var(--success);color:#fff', '已同意'],
          rejected: ['background:var(--danger);color:#fff', '已拒絕'],
          ignored: ['background:var(--border);color:var(--text-secondary)', '已忽略'],
        };
        const [style, label] = statusLabels[msg.actionStatus] || ['', msg.actionStatus];
        const reviewerSuffix = msg.reviewerName ? `（${escapeHTML(msg.reviewerName)}）` : '';
        actionHtml = `<div class="msg-action-status" style="${style}">${label}${reviewerSuffix}</div>`;
      }
    }

    content.innerHTML = `
      <h3 style="margin:0 0 .6rem;font-size:1rem">${escapeHTML(msg.title)}</h3>
      <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.5rem">
        <span class="msg-type msg-type-${msg.type}">${escapeHTML(msg.typeName)}</span>
        <span style="margin-left:.4rem">${escapeHTML(msg.time)}</span>
        ${msg.senderName ? `<span style="margin-left:.4rem">來自 ${escapeHTML(msg.senderName)}</span>` : ''}
      </div>
      <div style="font-size:.85rem;line-height:1.7;padding:.6rem;background:var(--bg-elevated);border-radius:var(--radius-sm);white-space:pre-wrap">${escapeHTML(msg.body)}</div>
      ${actionHtml}
    `;
    modal.style.display = 'flex';
  },

  async handleTeamJoinAction(msgId, action) {
    const messages = ApiService.getMessages();
    const msg = messages.find(m => m.id === msgId);
    if (!msg || !msg.meta) return;

    const { teamId, teamName, applicantUid, applicantName, groupId } = msg.meta;

    // 1. Permission check: current user must be team staff (captain/leader/coach) or admin
    const team = ApiService.getTeam(teamId);
    if (!team) { this.showToast('找不到此球隊'); return; }
    const curUser = ApiService.getCurrentUser();
    const curUid = curUser?.uid || (ModeManager.isDemo() ? DemoData.currentUser?.uid : null);
    const myNames = new Set([curUser?.name, curUser?.displayName].filter(Boolean));
    const teamLeaderUids = team.leaderUids || (team.leaderUid ? [team.leaderUid] : []);
    const isTeamStaff =
      (team.captainUid && team.captainUid === curUid) ||
      (!team.captainUid && team.captain && myNames.has(team.captain)) ||
      teamLeaderUids.includes(curUid) ||
      (!team.leaderUids && !team.leaderUid && team.leader && myNames.has(team.leader)) ||
      (team.coaches || []).some(c => myNames.has(c)) ||
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
        // Sync this message's display status
        msg.actionStatus = alreadyActed.actionStatus;
        msg.reviewerName = alreadyActed.reviewerName;
        ApiService.updateMessage(msgId, { actionStatus: alreadyActed.actionStatus, reviewerName: alreadyActed.reviewerName || '' });
        document.getElementById('msg-inbox-detail-modal').style.display = 'none';
        this.renderMessageList();
        return;
      }
    }

    const reviewerName = curUser?.displayName || (ModeManager.isDemo() ? DemoData.currentUser?.displayName : '審核人');

    if (action === 'approve') {
      // Update applicant's teamId + teamName
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
      if (!ModeManager.isDemo() && applicant._docId) {
        try {
          // Ensure auth token is fresh before cross-user checks/writes
          const authed = await FirebaseService._ensureAuth();
          if (!authed) {
            this.showToast('登入已過期，請重新整理頁面後再試');
            ApiService._writeErrorLog({ fn: 'handleTeamJoinAction', teamId, applicantUid, reason: 'auth_expired' }, new Error('_ensureAuth returned false'));
            return;
          }

          // Re-check latest membership from server to reduce stale cache race
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
        // Update team members only when first successful join.
        const memberCount = (typeof this._calcTeamMemberCount === 'function')
          ? this._calcTeamMemberCount(teamId)
          : (ApiService.getAdminUsers() || []).filter(u => u.teamId === teamId).length;
        ApiService.updateTeam(teamId, { members: memberCount });

        // Notify applicant
        this._deliverMessageToInbox(
          '球隊申請通過',
          `恭喜！您已成功加入「${finalTeamName}」球隊，審核人：${reviewerName}。`,
          'system', '系統', applicantUid, '系統'
        );
        ApiService._writeOpLog('team_approve', '球隊審批', `${reviewerName} 同意「${applicantName}」加入「${finalTeamName}」`);
        this._evaluateAchievements();
        this.showToast('已同意加入申請');
      } else {
        this.showToast('申請者已在此球隊，僅更新審核狀態');
      }

    } else if (action === 'reject') {
      this._deliverMessageToInbox(
        '球隊申請結果',
        `很抱歉，您申請加入「${teamName}」球隊未獲通過。如有疑問，請聯繫球隊職員。`,
        'system', '系統', applicantUid, '系統'
      );
      ApiService._writeOpLog('team_approve', '球隊審批', `${reviewerName} 拒絕「${applicantName}」加入「${teamName}」`);
      this.showToast('已拒絕加入申請');

    } else if (action === 'ignore') {
      ApiService._writeOpLog('team_approve', '球隊審批', `${reviewerName} 忽略「${applicantName}」加入「${teamName}」的申請`);
      this.showToast('已忽略此申請');
    }

    // 3. Build update payload (top-level fields for Object.assign compatibility)
    const statusMap = { approve: 'approved', reject: 'rejected', ignore: 'ignored' };
    const newStatus = statusMap[action];
    const updatePayload = { actionStatus: newStatus, reviewerName };
    if (action === 'reject') updatePayload.rejectedAt = Date.now();

    // Update acted message
    ApiService.updateMessage(msgId, updatePayload);
    Object.assign(msg, updatePayload);

    // 4. Sync all messages in this group (first-action-wins propagation)
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
      // Notify other staff of the result (approve/reject only, not ignore)
      if (action !== 'ignore') {
        const actionLabel = action === 'approve' ? '同意' : '拒絕';
        otherStaffUids.forEach(uid => {
          this._deliverMessageToInbox(
            '入隊申請審核通知',
            `「${reviewerName}」已${actionLabel}「${applicantName}」加入「${teamName}」的申請。`,
            'system', '系統', uid, '系統'
          );
        });
      }
    }

    document.getElementById('msg-inbox-detail-modal').style.display = 'none';
    this.renderMessageList();
  },

  async handleTournamentRegAction(msgId, action) {
    const messages = ApiService.getMessages();
    const msg = messages.find(m => m.id === msgId);
    if (!msg || !msg.meta) return;

    const { tournamentId, tournamentName, teamId, teamName, applicantUid, applicantName, groupId } = msg.meta;
    const t = ApiService.getTournament(tournamentId);
    const curUser = ApiService.getCurrentUser();
    const reviewerName = curUser?.displayName || '審核人';
    const actionLabels = { approve: '同意', reject: '拒絕', ignore: '忽略' };

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
      this._deliverMessageToInbox(
        '賽事報名通過',
        `恭喜！「${teamName}」已成功報名賽事「${tournamentName}」！`,
        'tournament', '賽事', applicantUid, '系統'
      );
      this.showToast('已同意報名申請');

    } else if (action === 'reject') {
      this._deliverMessageToInbox(
        '賽事報名結果',
        `很抱歉，「${teamName}」申請報名賽事「${tournamentName}」未獲通過。如有疑問，請聯繫主辦方。`,
        'tournament', '賽事', applicantUid, '系統'
      );
      this.showToast('已拒絕報名申請');

    } else if (action === 'ignore') {
      this.showToast('已忽略此申請');
    }

    ApiService._writeOpLog('tourn_approve', '賽事審批', `${actionLabels[action]}「${teamName}」報名「${tournamentName}」`);

    const statusMap = { approve: 'approved', reject: 'rejected', ignore: 'ignored' };
    const newStatus = statusMap[action];

    // 更新本則及同 groupId 的所有相關訊息狀態（讓其他人的按鈕反灰）
    ApiService.updateMessage(msgId, { actionStatus: newStatus });
    msg.actionStatus = newStatus;
    if (groupId) {
      messages.forEach(m => {
        if (m.id !== msgId && m.meta && m.meta.groupId === groupId && m.actionStatus === 'pending') {
          m.actionStatus = newStatus;
          ApiService.updateMessage(m.id, { actionStatus: newStatus });
        }
      });
    }

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
        this._deliverMessageToInbox(
          '報名審核結果通知',
          `${reviewerName} 已「${actionLabels[action]}」球隊「${teamName}」報名賽事「${tournamentName}」的申請。`,
          'tournament', '賽事', uid, '系統'
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
  //  Notification Template Utilities
  // ══════════════════════════════════

  _renderTemplate(str, vars) {
    if (!str) return '';
    return str.replace(/\{(\w+)\}/g, (_, key) => (vars && vars[key] != null) ? vars[key] : `{${key}}`);
  },

  _sendNotifFromTemplate(key, vars, targetUid, category, categoryName) {
    const fallbackTemplates = {
      waitlist_demoted: {
        title: '候補調整通知',
        body: '很抱歉通知您，因活動名額調整，您的報名狀態已改為候補。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n若有名額釋出，系統將依候補順序自動遞補。',
      },
    };
    const tpl = ApiService.getNotifTemplate(key) || fallbackTemplates[key];
    if (!tpl) { console.warn('[Notif] 找不到模板:', key); return; }
    const title = this._renderTemplate(tpl.title, vars);
    const body = this._renderTemplate(tpl.body, vars);
    this._deliverMessageToInbox(title, body, category || 'system', categoryName || '系統', targetUid, '系統');
    // LINE 推播排隊（供 Cloud Functions 消費）
    this._queueLinePush(targetUid, category || 'system', title, body);
  },

  _queueLinePushByTarget(targetType, targetUid, category, title, body, teamId) {
    if (targetType === 'individual') {
      if (targetUid) this._queueLinePush(targetUid, category, title, body);
      return;
    }
    // 與 sendMessage() 的 roleTargetMap 保持一致
    const roleFilter = {
      coach_up: ['coach', 'captain', 'venue_owner', 'admin', 'super_admin'],
      admin: ['admin', 'super_admin'],
      coach: ['coach', 'admin', 'super_admin'],
      captain: ['captain', 'admin', 'super_admin'],
      venue_owner: ['venue_owner', 'admin', 'super_admin'],
    };
    const users = ApiService.getAdminUsers() || [];
    users.forEach(u => {
      if (roleFilter[targetType] && !roleFilter[targetType].includes(u.role)) return;
      if (targetType === 'team') {
        const inTeam = (typeof this._isUserInTeam === 'function')
          ? this._isUserInTeam(u, teamId)
          : (u.teamId === teamId);
        if (!inTeam) return;
      }
      this._queueLinePush(u.uid, category, title, body);
    });
  },

  // category → lineNotify settings key 映射（private 歸入 system）
  _linePushCategoryKey(category) {
    if (category === 'private') return 'system';
    return category; // system, activity, tournament 直接對應
  },

  _queueLinePush(uid, category, title, body) {
    if (!uid) return;
    // 查找目標用戶的 lineNotify 設定
    const users = ApiService.getAdminUsers();
    const target = users.find(u => u.uid === uid);
    if (!target || !target.lineNotify || !target.lineNotify.bound) return;
    const settingsKey = this._linePushCategoryKey(category);
    if (!target.lineNotify.settings[settingsKey]) return;

    if (ModeManager.isDemo()) {
      console.log('[LINE Push]', { uid, category, title, body });
      this.showToast('LINE 推播已排入佇列（Demo）');
    } else {
      db.collection('linePushQueue').add({
        uid,
        title,
        body,
        category,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.error('[LINE Push] 寫入失敗:', err));
    }
  },

  // ══════════════════════════════════
  //  Notification Template Editor
  // ══════════════════════════════════

  async showTemplateEditor() {
    const modal = document.getElementById('notif-template-editor');
    if (!modal) return;
    const list = document.getElementById('notif-template-list');
    if (!list) return;

    // 確保模板編輯器能顯示完整模板（舊資料會自動補齊缺漏 key）
    if (!ModeManager.isDemo() && FirebaseService._seedNotifTemplates) {
      try {
        await FirebaseService._seedNotifTemplates();
      } catch (err) {
        console.warn('[TemplateEditor] 補齊模板失敗:', err);
      }
    }

    const placeholderHints = {
      welcome: '{userName}',
      signup_success: '{eventName} {date} {location} {status}',
      waitlist_promoted: '{eventName} {date} {location}',
      waitlist_demoted: '{eventName} {date} {location}',
      event_cancelled: '{eventName} {date} {location}',
      role_upgrade: '{userName} {roleName}',
      event_changed: '{eventName} {date} {location}',
      event_relisted: '{eventName} {date} {location}',
    };
    const order = Object.keys(placeholderHints);
    const templates = [...ApiService.getNotifTemplates()].sort((a, b) => {
      const ia = order.indexOf(a.key);
      const ib = order.indexOf(b.key);
      if (ia === -1 && ib === -1) return String(a.key || '').localeCompare(String(b.key || ''));
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    list.innerHTML = templates.map(t => `
      <div class="form-card" style="margin-bottom:.6rem">
        <div style="font-size:.82rem;font-weight:700;margin-bottom:.3rem">${escapeHTML(t.key)}</div>
        <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.4rem">佔位符：${escapeHTML(placeholderHints[t.key] || '無')}</div>
        <div class="form-row"><label>標題</label><input type="text" data-tpl-key="${t.key}" data-tpl-field="title" value="${escapeHTML(t.title)}" maxlength="12"></div>
        <div class="form-row"><label>內容</label><textarea data-tpl-key="${t.key}" data-tpl-field="body" rows="4" maxlength="300">${escapeHTML(t.body)}</textarea></div>
      </div>
    `).join('');
    modal.style.display = 'flex';
  },

  hideTemplateEditor() {
    const modal = document.getElementById('notif-template-editor');
    if (modal) modal.style.display = 'none';
  },

  saveAllTemplates() {
    const inputs = document.querySelectorAll('[data-tpl-key][data-tpl-field]');
    const updates = {};
    inputs.forEach(el => {
      const key = el.dataset.tplKey;
      const field = el.dataset.tplField;
      if (!updates[key]) updates[key] = {};
      updates[key][field] = el.value;
    });
    Object.keys(updates).forEach(key => {
      ApiService.updateNotifTemplate(key, updates[key]);
    });
    this.hideTemplateEditor();
    this.showToast('通知模板已儲存');
  },

  // ══════════════════════════════════
  //  Helper：取得發送人暱稱
  // ══════════════════════════════════

  _getMsgSenderName() {
    // 優先用 LINE 暱稱
    if (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) {
      const profile = LineAuth.getProfile();
      if (profile && profile.displayName) return profile.displayName;
    }
    // 其次用 currentUser
    const user = ApiService.getCurrentUser?.() || null;
    if (user && user.displayName) return user.displayName;
    return '系統';
  },

});
