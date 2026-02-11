/* ================================================
   SportHub — Message (Render + Admin Management)
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  User Inbox (前台)
  // ══════════════════════════════════

  _msgInboxFilter: 'all',

  renderMessageList(filter) {
    const f = filter || this._msgInboxFilter || 'all';
    this._msgInboxFilter = f;
    const myUid = ApiService.getCurrentUser()?.uid || null;
    const allMessages = ApiService.getMessages().filter(m =>
      !m.targetUid || !myUid || m.targetUid === myUid
    );
    const messages = f === 'all' ? allMessages : allMessages.filter(m => m.type === f);
    const container = document.getElementById('message-list');
    if (!container) return;
    container.innerHTML = messages.length ? messages.map(m => `
      <div class="msg-card${m.unread ? ' msg-unread' : ''}" onclick="App.readMessage(this, '${m.id}')">
        <div class="msg-card-header">
          <span class="msg-dot ${m.unread ? 'unread' : 'read'}"></span>
          <span class="msg-type msg-type-${m.type}">${escapeHTML(m.typeName)}</span>
          <span class="msg-title">${escapeHTML(m.title)}</span>
        </div>
        <div class="msg-preview">${escapeHTML(m.preview)}</div>
        <div class="msg-time">${escapeHTML(m.time)}</div>
      </div>
    `).join('') : '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">此分類沒有訊息</div>';
    this.updateNotifBadge();
    this.updateStorageBar();

    // 綁定分類 tabs
    const tabs = document.getElementById('msg-inbox-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
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
    const myUid = ApiService.getCurrentUser()?.uid || null;
    const messages = ApiService.getMessages().filter(m =>
      !m.targetUid || !myUid || m.targetUid === myUid
    );
    const unreadCount = messages.filter(m => m.unread).length;
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.textContent = unreadCount;
    badge.style.display = unreadCount > 0 ? '' : 'none';
  },

  updateStorageBar() {
    const bar = document.getElementById('storage-bar');
    if (!bar) return;
    const total = 50;
    const myUid = ApiService.getCurrentUser()?.uid || null;
    const used = ApiService.getMessages().filter(m =>
      !m.targetUid || !myUid || m.targetUid === myUid
    ).length;
    const remaining = Math.max(0, total - used);
    bar.innerHTML = `剩餘容量：<strong style="color:#111">${remaining}</strong>/${total}`;
  },

  markAllRead() {
    const messages = ApiService.getMessages();
    let changed = messages.filter(m => m.unread).length;
    if (changed === 0) { this.showToast('沒有未讀訊息'); return; }
    ApiService.markAllMessagesRead();
    this.renderMessageList();
    this.updateNotifBadge();
    this.showToast(`已將 ${changed} 則訊息標為已讀`);
  },

  async clearAllMessages() {
    const messages = ApiService.getMessages();
    if (!messages.length) { this.showToast('沒有訊息可清空'); return; }
    if (!(await this.appConfirm(`確定要清空全部 ${messages.length} 則訊息？此操作無法恢復。`))) return;
    if (ModeManager.isDemo()) {
      DemoData.messages.length = 0;
    } else {
      try {
        await FirebaseService.clearAllMessages();
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
    if (msg && msg.unread) {
      ApiService.markMessageRead(id);
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
    if (msg.actionType === 'team_join_request') {
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
        actionHtml = `<div class="msg-action-status" style="${style}">${label}</div>`;
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

    const { teamId, teamName, applicantUid, applicantName } = msg.meta;

    if (action === 'approve') {
      // 1. Update applicant's teamId + teamName
      const users = ApiService.getAdminUsers();
      const applicant = users.find(u => u.uid === applicantUid);
      if (applicant) {
        Object.assign(applicant, { teamId, teamName });
        if (!ModeManager.isDemo() && applicant._docId) {
          FirebaseService.updateUser(applicant._docId, { teamId, teamName }).catch(err => console.error('[approve] updateUser:', err));
        }
      }
      // Also update currentUser if it's the applicant
      const curUser = ApiService.getCurrentUser();
      if (curUser && curUser.uid === applicantUid) {
        ApiService.updateCurrentUser({ teamId, teamName });
      }

      // 2. Update team members +1
      const team = ApiService.getTeam(teamId);
      if (team) {
        ApiService.updateTeam(teamId, { members: (team.members || 0) + 1 });
      }

      // 3. Send approval notification to applicant
      this._deliverMessageToInbox(
        '球隊申請通過',
        `恭喜！您已成功加入「${teamName}」球隊，歡迎成為團隊的一員！`,
        'system', '系統', applicantUid, '系統'
      );

      // 4. Update message status
      ApiService.updateMessage(msgId, { actionStatus: 'approved' });
      msg.actionStatus = 'approved';
      this.showToast('已同意加入申請');

    } else if (action === 'reject') {
      // Send rejection notification to applicant
      this._deliverMessageToInbox(
        '球隊申請結果',
        `很抱歉，您申請加入「${teamName}」球隊未獲通過。如有疑問，請聯繫球隊領隊。`,
        'system', '系統', applicantUid, '系統'
      );

      ApiService.updateMessage(msgId, { actionStatus: 'rejected' });
      msg.actionStatus = 'rejected';
      this.showToast('已拒絕加入申請');

    } else if (action === 'ignore') {
      ApiService.updateMessage(msgId, { actionStatus: 'ignored' });
      msg.actionStatus = 'ignored';
      this.showToast('已忽略此申請');
    }

    // Close modal and refresh
    document.getElementById('msg-inbox-detail-modal').style.display = 'none';
    this.renderMessageList();
  },

  // ══════════════════════════════════
  //  Notification Template Utilities
  // ══════════════════════════════════

  _renderTemplate(str, vars) {
    if (!str) return '';
    return str.replace(/\{(\w+)\}/g, (_, key) => (vars && vars[key] != null) ? vars[key] : `{${key}}`);
  },

  _sendNotifFromTemplate(key, vars, targetUid, category, categoryName) {
    const tpl = ApiService.getNotifTemplate(key);
    if (!tpl) { console.warn('[Notif] 找不到模板:', key); return; }
    const title = this._renderTemplate(tpl.title, vars);
    const body = this._renderTemplate(tpl.body, vars);
    this._deliverMessageToInbox(title, body, category || 'system', categoryName || '系統', targetUid, '系統');
  },

  // ══════════════════════════════════
  //  Notification Template Editor
  // ══════════════════════════════════

  showTemplateEditor() {
    const modal = document.getElementById('notif-template-editor');
    if (!modal) return;
    const list = document.getElementById('notif-template-list');
    if (!list) return;
    const templates = ApiService.getNotifTemplates();
    const placeholderHints = {
      welcome: '{userName}',
      signup_success: '{eventName} {date} {location} {status}',
      waitlist_promoted: '{eventName} {date} {location}',
      event_cancelled: '{eventName} {date} {location}',
      role_upgrade: '{userName} {roleName}',
      event_changed: '{eventName} {date} {location}',
    };
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

  // ══════════════════════════════════
  //  Admin Message Management (後台)
  // ══════════════════════════════════

  _msgCurrentFilter: 'sent',

  renderMsgManage(filter) {
    const container = document.getElementById('msg-manage-list');
    if (!container) return;
    const f = filter || this._msgCurrentFilter || 'sent';
    this._msgCurrentFilter = f;
    const allItems = ApiService.getAdminMessages();
    // 排程 tab 同時顯示 scheduled + cancelled
    const items = f === 'scheduled'
      ? allItems.filter(m => m.status === 'scheduled' || m.status === 'cancelled')
      : allItems.filter(m => m.status === f);

    // 統計數量
    const countEl = document.getElementById('msg-sent-count');
    if (countEl) {
      const sentCount = allItems.filter(m => m.status === 'sent').length;
      const scheduledCount = allItems.filter(m => m.status === 'scheduled').length;
      const recalledCount = allItems.filter(m => m.status === 'recalled').length;
      const deletedCount = allItems.filter(m => m.status === 'deleted').length;
      countEl.textContent = `已發送 ${sentCount} 封 ・ 排程 ${scheduledCount} 封 ・ 已回收 ${recalledCount} 封 ・ 已刪除 ${deletedCount} 封`;
    }

    container.innerHTML = items.length ? items.map(m => {
      const targetLabel = m.targetUid
        ? `${m.targetName || m.targetUid}（${m.targetUid}）`
        : m.target;
      const senderLabel = m.senderName ? `發送人：${m.senderName}` : '';
      const s = 'font-size:.72rem;padding:.2rem .5rem';
      let btns = '';
      let scheduleInfo = '';

      if (m.status === 'sent') {
        btns = `<button class="primary-btn small" style="${s}" onclick="App.viewMsgDetail('${m.id}')">查看</button>`
             + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.recallMsg('${m.id}')">回收</button>`
             + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMsg('${m.id}')">刪除</button>`;
      } else if (m.status === 'scheduled') {
        // 排程時間提示
        if (m.scheduledAt) {
          const schedDate = new Date(m.scheduledAt);
          const schedStr = `${schedDate.getFullYear()}/${String(schedDate.getMonth()+1).padStart(2,'0')}/${String(schedDate.getDate()).padStart(2,'0')} ${String(schedDate.getHours()).padStart(2,'0')}:${String(schedDate.getMinutes()).padStart(2,'0')}`;
          scheduleInfo = `<div style="font-size:.72rem;margin-top:.2rem;padding:.2rem .5rem;background:rgba(59,130,246,.1);color:#3b82f6;border-radius:4px;display:inline-block">&#128339; 預約發送：${schedStr}</div>`;
        }
        btns = `<button class="primary-btn small" style="${s}" onclick="App.viewMsgDetail('${m.id}')">查看</button>`
             + `<button class="outline-btn" style="${s};color:var(--warning)" onclick="App.cancelScheduleMsg('${m.id}')">取消排程</button>`
             + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMsg('${m.id}')">刪除</button>`;
      } else if (m.status === 'recalled') {
        btns = `<button class="primary-btn small" style="${s}" onclick="App.viewMsgDetail('${m.id}')">查看</button>`
             + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMsg('${m.id}')">刪除</button>`;
      } else if (m.status === 'cancelled') {
        // 已取消排程 → 可恢復排程
        if (m.scheduledAt) {
          const schedDate = new Date(m.scheduledAt);
          const schedStr = `${schedDate.getFullYear()}/${String(schedDate.getMonth()+1).padStart(2,'0')}/${String(schedDate.getDate()).padStart(2,'0')} ${String(schedDate.getHours()).padStart(2,'0')}:${String(schedDate.getMinutes()).padStart(2,'0')}`;
          scheduleInfo = `<div style="font-size:.72rem;margin-top:.2rem;padding:.2rem .5rem;background:rgba(156,163,175,.15);color:var(--text-muted);border-radius:4px;display:inline-block;text-decoration:line-through">&#128339; 原排程：${schedStr}</div>`;
        }
        btns = `<button class="primary-btn small" style="${s}" onclick="App.viewMsgDetail('${m.id}')">查看</button>`
             + `<button class="outline-btn" style="${s};color:var(--success)" onclick="App.restoreScheduleMsg('${m.id}')">恢復排程</button>`
             + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMsg('${m.id}')">刪除</button>`;
      } else if (m.status === 'deleted') {
        btns = `<button class="primary-btn small" style="${s}" onclick="App.viewMsgDetail('${m.id}')">查看</button>`;
      }

      // 狀態標籤
      const statusMap = { sent: ['active', '已發送'], scheduled: ['scheduled', '排程中'], recalled: ['expired', '已回收'], cancelled: ['empty', '已取消'], deleted: ['expired', '已刪除'] };
      const [statusClass, statusText] = statusMap[m.status] || ['empty', m.status];

      return `
      <div class="msg-manage-card" style="margin-bottom:.5rem">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
          <span class="msg-manage-title" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(m.title)}</span>
          <span class="banner-manage-status status-${statusClass}">${statusText}</span>
        </div>
        <div style="font-size:.75rem;color:var(--text-muted)">${m.categoryName ? '[' + escapeHTML(m.categoryName) + '] ' : ''}對象：${escapeHTML(targetLabel)} ・ ${m.time}${senderLabel ? ' ・ ' + escapeHTML(senderLabel) : ''}</div>
        <div style="font-size:.75rem;color:var(--text-secondary);margin-top:.2rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(m.body)}</div>
        ${scheduleInfo}
        <div style="display:flex;gap:.3rem;margin-top:.3rem">${btns}</div>
      </div>`;
    }).join('') : '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">無信件</div>';

    const tabs = document.getElementById('msg-manage-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderMsgManage(tab.dataset.mfilter);
        });
      });
    }
  },

  // ── 查看信件詳情 ──
  viewMsgDetail(id) {
    const m = ApiService.getAdminMessages().find(msg => msg.id === id);
    if (!m) return;
    const modal = document.getElementById('msg-detail-modal');
    const content = document.getElementById('msg-detail-content');
    if (!modal || !content) return;
    const targetLabel = m.targetUid
      ? `${m.targetName || m.targetUid}（${m.targetUid}）`
      : m.target;
    const statusMap = { sent: '已發送', scheduled: '排程中', recalled: '已回收', cancelled: '已取消排程', deleted: '已刪除' };
    let schedHtml = '';
    if (m.scheduledAt) {
      const d = new Date(m.scheduledAt);
      schedHtml = `<div>排程時間：${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}</div>`;
    }
    content.innerHTML = `
      <h3 style="margin:0 0 .6rem;font-size:1rem">${escapeHTML(m.title)}</h3>
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.5rem">
        ${m.categoryName ? `<div>類別：${escapeHTML(m.categoryName)}</div>` : ''}
        <div>對象：${escapeHTML(targetLabel)}</div>
        <div>時間：${escapeHTML(m.time)}</div>
        ${m.senderName ? `<div>發送人：${escapeHTML(m.senderName)}</div>` : ''}
        ${schedHtml}
        <div>狀態：${statusMap[m.status] || m.status}</div>
      </div>
      <div style="font-size:.85rem;line-height:1.6;padding:.6rem;background:var(--bg-elevated);border-radius:var(--radius-sm);white-space:pre-wrap">${escapeHTML(m.body)}</div>
    `;
    modal.style.display = 'flex';
  },

  // ── 回收信件 ──
  async recallMsg(id) {
    if (!(await this.appConfirm('確定要回收此信件？'))) return;
    ApiService.updateAdminMessage(id, { status: 'recalled' });
    this.renderMsgManage('sent');
    this.showToast('已回收信件');
  },

  // ── 刪除信件（軟刪除，保留紀錄） ──
  async deleteMsg(id) {
    if (!(await this.appConfirm('確定要刪除此信件？'))) return;
    ApiService.updateAdminMessage(id, { status: 'deleted' });
    this.renderMsgManage();
    this.showToast('信件已移至已刪除');
  },

  // ── 取消排程（改為 cancelled，可恢復） ──
  async cancelScheduleMsg(id) {
    if (!(await this.appConfirm('確定要取消此排程信件？'))) return;
    ApiService.updateAdminMessage(id, { status: 'cancelled' });
    this.renderMsgManage('scheduled');
    this.showToast('已取消排程');
  },

  // ── 恢復排程 ──
  restoreScheduleMsg(id) {
    ApiService.updateAdminMessage(id, { status: 'scheduled' });
    this.renderMsgManage('cancelled');
    this.showToast('已恢復排程');
  },

  // ── 撰寫信件 ──
  showMsgCompose() {
    const el = document.getElementById('msg-compose');
    if (!el) return;
    document.getElementById('msg-category').value = 'system';
    document.getElementById('msg-title').value = '';
    document.getElementById('msg-body').value = '';
    document.getElementById('msg-schedule').value = '';
    document.getElementById('msg-target').value = 'all';
    document.getElementById('msg-individual-row').style.display = 'none';
    document.getElementById('msg-individual-target').value = '';
    document.getElementById('msg-target-result').textContent = '';
    el.style.display = 'flex';
  },

  hideMsgCompose() {
    const el = document.getElementById('msg-compose');
    if (el) el.style.display = 'none';
  },

  // ── 發送對象切換 ──
  onMsgTargetChange() {
    const val = document.getElementById('msg-target').value;
    const row = document.getElementById('msg-individual-row');
    if (row) row.style.display = val === 'individual' ? '' : 'none';
  },

  // ── 搜尋用戶 (UID/暱稱) ──
  _msgMatchedUser: null,

  searchMsgTarget() {
    const input = document.getElementById('msg-individual-target').value.trim();
    const result = document.getElementById('msg-target-result');
    if (!result) return;
    if (!input) { result.textContent = ''; this._msgMatchedUser = null; return; }
    const users = ApiService.getAdminUsers();
    const match = users.find(u => u.uid === input || u.name === input);
    if (match) {
      result.innerHTML = `<span style="color:var(--success)">&#10003; 找到：${escapeHTML(match.name)}（${escapeHTML(match.uid)}）・ ${escapeHTML(match.role)}</span>`;
      this._msgMatchedUser = match;
    } else {
      result.innerHTML = `<span style="color:var(--danger)">&#10007; 找不到此用戶</span>`;
      this._msgMatchedUser = null;
    }
  },

  // ── 發送信件（實裝） ──
  sendMessage() {
    const title = document.getElementById('msg-title')?.value.trim();
    if (!title) { this.showToast('請輸入信件標題'); return; }
    if (title.length > 12) { this.showToast('標題不可超過 12 字'); return; }
    const body = document.getElementById('msg-body')?.value.trim();
    if (!body) { this.showToast('請輸入信件內容'); return; }
    if (body.length > 300) { this.showToast('內容不可超過 300 字'); return; }
    const category = document.getElementById('msg-category')?.value || 'system';
    const catNames = { system: '系統', activity: '活動', trade: '交易', private: '私訊' };
    const targetType = document.getElementById('msg-target')?.value || 'all';
    const schedule = document.getElementById('msg-schedule')?.value;

    // 解析對象
    let targetLabel = '全體用戶';
    let targetUid = null;
    let targetName = null;
    if (targetType === 'coach_up') targetLabel = '教練以上';
    else if (targetType === 'admin') targetLabel = '管理員';
    else if (targetType === 'team') targetLabel = '指定球隊';
    else if (targetType === 'individual') {
      if (!this._msgMatchedUser) {
        this.showToast('請先搜尋並確認目標用戶');
        return;
      }
      targetLabel = this._msgMatchedUser.name;
      targetUid = this._msgMatchedUser.uid;
      targetName = this._msgMatchedUser.name;
    }

    // 發送人：LINE 暱稱優先
    const senderName = this._getMsgSenderName();

    const now = new Date();
    const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const isScheduled = !!schedule;

    // 建立 admin 記錄
    const adminMsg = {
      id: 'mg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title,
      category,
      categoryName: catNames[category] || '系統',
      target: targetLabel,
      targetUid: targetUid || null,
      targetName: targetName || null,
      senderName,
      readRate: '-',
      time: timeStr,
      status: isScheduled ? 'scheduled' : 'sent',
      body,
      scheduledAt: isScheduled ? schedule : null,
    };
    ApiService.createAdminMessage(adminMsg);

    // 立即發送 → 同時投遞到用戶收件箱（只投一封）
    if (!isScheduled) {
      this._deliverMessageToInbox(title, body, category, catNames[category], targetUid, senderName);
    }

    // 重置表單
    this.hideMsgCompose();
    this._msgMatchedUser = null;
    this.renderMsgManage(isScheduled ? 'scheduled' : 'sent');
    // 切換 tab
    const tabs = document.getElementById('msg-manage-tabs');
    if (tabs) {
      tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tabs.querySelector(`[data-mfilter="${isScheduled ? 'scheduled' : 'sent'}"]`)?.classList.add('active');
    }
    this.showToast(isScheduled ? '信件已排程' : '信件已發送');
  },

  // ── 投遞到用戶收件箱（只建立一封） ──
  _deliverMessageToInbox(title, body, category, categoryName, targetUid, senderName, extra) {
    const preview = body.length > 40 ? body.slice(0, 40) + '...' : body;
    const now = new Date();
    const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const newMsg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: category,
      typeName: categoryName,
      title,
      preview,
      body,
      time: timeStr,
      unread: true,
      senderName,
      targetUid: targetUid || null,
      ...(extra || {}),
    };
    // 加入用戶收件箱
    const source = ModeManager.isDemo() ? DemoData.messages : FirebaseService._cache.messages;
    source.unshift(newMsg);
    if (!ModeManager.isDemo()) {
      FirebaseService.addMessage(newMsg).catch(err => console.error('[deliverMsg]', err));
    }
    this.renderMessageList();
    this.updateNotifBadge();
  },

});
