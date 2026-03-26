/* ================================================
   SportHub — Message: Inbox Rendering & Display
   Split from message-inbox.js — pure move, no logic changes
   ================================================ */

Object.assign(App, {

  renderMessageList(filter) {
    const f = filter || this._msgInboxFilter || 'all';
    this._msgInboxFilter = f;
    const allMessages = this._filterMyMessages(ApiService.getMessages());
    let messages = (f === 'all' ? allMessages : allMessages.filter(m => m.type === f))
      .sort((a, b) => (b.time || '').localeCompare(a.time || ''));

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

  _renderMessageActionStatus(actionStatus, reviewerName = '') {
    const statusLabels = {
      approved: ['background:var(--success);color:#fff', '同意'],
      rejected: ['background:var(--danger);color:#fff', '拒絕'],
      ignored: ['background:var(--border);color:var(--text-secondary)', '忽略'],
      opened: ['background:var(--accent-soft);color:var(--accent)', '已通知'],
    };
    const safeStatus = String(actionStatus || '').trim().toLowerCase();
    const [style, label] = statusLabels[safeStatus] || ['', safeStatus];
    const reviewerSuffix = reviewerName ? `（${escapeHTML(reviewerName)}）` : '';
    return `<div class="msg-action-status" style="${style}">${escapeHTML(label)}${reviewerSuffix}</div>`;
  },

  showMessageDetail(id) {
    const messages = ApiService.getMessages();
    const msg = messages.find(m => m.id === id);
    if (!msg) return;
    const modal = document.getElementById('msg-inbox-detail-modal');
    const content = document.getElementById('msg-inbox-detail-content');
    if (!modal || !content) return;

    let actionHtml = '';
    const relatedTournament = msg.meta?.tournamentId ? ApiService.getTournament(msg.meta.tournamentId) : null;
    const isFriendlyTournamentMessage = (
      msg.actionType === 'tournament_friendly_application'
      || (!!msg.meta?.applicationId && this._isFriendlyTournamentRecord?.(relatedTournament))
      || (msg.actionType === 'tournament_register_request' && this._isFriendlyTournamentRecord?.(relatedTournament))
    );
    if (isFriendlyTournamentMessage) {
      if (msg.actionStatus === 'pending') {
        actionHtml = `
          <div class="msg-action-btns">
            <button class="msg-action-approve" onclick="App.openFriendlyTournamentMessageReview('${msg.id}')">查看賽事</button>
          </div>`;
      } else {
        actionHtml = this._renderMessageActionStatus(msg.actionStatus, msg.reviewerName);
      }
    } else if (msg.actionType === 'tournament_register_request') {
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
    } else if (msg.actionType === 'edu_student_apply') {
      const teamId = msg.meta?.teamId || '';
      const studentId = msg.meta?.studentId || '';
      if (msg.actionStatus === 'pending' && teamId && studentId) {
        actionHtml = `
          <div class="msg-action-btns">
            <button class="msg-action-approve" onclick="App._handleEduApplyAction('${msg.id}','approve')">同意</button>
            <button class="msg-action-reject" onclick="App._handleEduApplyAction('${msg.id}','reject')">拒絕</button>
            <button class="msg-action-ignore" onclick="App._handleEduApplyAction('${msg.id}','ignore')">略過</button>
          </div>`;
      } else {
        const statusLabels = {
          approved: ['background:var(--success);color:#fff', '已同意'],
          rejected: ['background:var(--danger);color:#fff', '已拒絕'],
          ignored: ['background:var(--border);color:var(--text-secondary)', '已略過'],
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

});
