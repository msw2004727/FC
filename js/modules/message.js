/* ================================================
   SportHub — Message (Render + Admin Management)
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  User Inbox (前台)
  // ══════════════════════════════════

  renderMessageList() {
    const messages = ApiService.getMessages();
    const container = document.getElementById('message-list');
    if (!container) return;
    container.innerHTML = messages.length ? messages.map(m => `
      <div class="msg-card${m.unread ? ' msg-unread' : ''}" onclick="App.readMessage(this, '${m.id}')">
        <div class="msg-card-header">
          <span class="msg-dot ${m.unread ? 'unread' : 'read'}"></span>
          <span class="msg-type">${m.typeName}</span>
          <span class="msg-title">${m.title}</span>
        </div>
        <div class="msg-preview">${m.preview}</div>
        <div class="msg-time">${m.time}</div>
      </div>
    `).join('') : '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">沒有訊息</div>';
    this.updateNotifBadge();
    this.updateStorageBar();
  },

  updateNotifBadge() {
    const messages = ApiService.getMessages();
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
    const used = ApiService.getMessages().length;
    const remaining = Math.max(0, total - used);
    bar.innerHTML = `剩餘容量：<strong>${remaining}</strong>/${total}`;
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

  readMessage(el, id) {
    const messages = ApiService.getMessages();
    const msg = messages.find(m => m.id === id);
    if (msg && msg.unread) {
      ApiService.markMessageRead(id);
      el.classList.remove('msg-unread');
      el.querySelector('.msg-dot').classList.remove('unread');
      el.querySelector('.msg-dot').classList.add('read');
      this.updateNotifBadge();
    }
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
    const items = allItems.filter(m => m.status === f);

    // 已發送數量
    const countEl = document.getElementById('msg-sent-count');
    if (countEl) {
      const sentCount = allItems.filter(m => m.status === 'sent').length;
      const scheduledCount = allItems.filter(m => m.status === 'scheduled').length;
      const recalledCount = allItems.filter(m => m.status === 'recalled').length;
      countEl.textContent = `已發送 ${sentCount} 封 ・ 排程 ${scheduledCount} 封 ・ 已回收 ${recalledCount} 封`;
    }

    container.innerHTML = items.length ? items.map(m => {
      const targetLabel = m.targetUid
        ? `${m.targetName || m.targetUid}（${m.targetUid}）`
        : m.target;
      const senderLabel = m.senderUid ? `發送人：${m.senderUid}` : '';
      const s = 'font-size:.72rem;padding:.2rem .5rem';
      let btns = '';
      if (m.status === 'sent') {
        btns = `<button class="primary-btn small" style="${s}" onclick="App.viewMsgDetail('${m.id}')">查看</button>`
             + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.recallMsg('${m.id}')">回收</button>`
             + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMsg('${m.id}')">刪除</button>`;
      } else if (m.status === 'scheduled') {
        btns = `<button class="primary-btn small" style="${s}" onclick="App.viewMsgDetail('${m.id}')">查看</button>`
             + `<button class="outline-btn" style="${s};color:var(--warning)" onclick="App.cancelScheduleMsg('${m.id}')">取消排程</button>`
             + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMsg('${m.id}')">刪除</button>`;
      } else {
        btns = `<button class="primary-btn small" style="${s}" onclick="App.viewMsgDetail('${m.id}')">查看</button>`
             + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMsg('${m.id}')">刪除</button>`;
      }
      return `
      <div class="msg-manage-card" style="margin-bottom:.5rem">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
          <span class="msg-manage-title" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.title}</span>
          <span class="banner-manage-status status-${m.status === 'sent' ? 'active' : m.status === 'scheduled' ? 'scheduled' : 'expired'}">${m.status === 'sent' ? '已發送' : m.status === 'scheduled' ? '排程中' : '已回收'}</span>
        </div>
        <div style="font-size:.75rem;color:var(--text-muted)">對象：${targetLabel} ・ ${m.time}${senderLabel ? ' ・ ' + senderLabel : ''}</div>
        <div style="font-size:.75rem;color:var(--text-secondary);margin-top:.2rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.body}</div>
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
    content.innerHTML = `
      <h3 style="margin:0 0 .6rem;font-size:1rem">${m.title}</h3>
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.5rem">
        <div>對象：${targetLabel}</div>
        <div>時間：${m.time}</div>
        ${m.senderUid ? `<div>發送人 UID：${m.senderUid}</div>` : ''}
        <div>狀態：${m.status === 'sent' ? '已發送' : m.status === 'scheduled' ? '排程中' : '已回收'}</div>
      </div>
      <div style="font-size:.85rem;line-height:1.6;padding:.6rem;background:var(--bg-elevated);border-radius:var(--radius-sm);white-space:pre-wrap">${m.body}</div>
    `;
    modal.style.display = 'flex';
  },

  // ── 回收信件 ──
  recallMsg(id) {
    if (!confirm('確定要回收此信件？')) return;
    ApiService.updateAdminMessage(id, { status: 'recalled' });
    this.renderMsgManage('sent');
    this.showToast('已回收信件');
  },

  // ── 刪除信件 ──
  deleteMsg(id) {
    if (!confirm('確定要刪除此信件？刪除後無法恢復。')) return;
    ApiService.deleteAdminMessage(id);
    this.renderMsgManage();
    this.showToast('信件已刪除');
  },

  // ── 取消排程 ──
  cancelScheduleMsg(id) {
    if (!confirm('確定要取消此排程信件？')) return;
    ApiService.deleteAdminMessage(id);
    this.renderMsgManage('scheduled');
    this.showToast('已取消排程');
  },

  // ── 撰寫信件 ──
  showMsgCompose() {
    const el = document.getElementById('msg-compose');
    if (!el) return;
    document.getElementById('msg-title').value = '';
    document.getElementById('msg-body').value = '';
    document.getElementById('msg-schedule').value = '';
    document.getElementById('msg-target').value = 'all';
    document.getElementById('msg-individual-row').style.display = 'none';
    document.getElementById('msg-individual-target').value = '';
    document.getElementById('msg-target-result').textContent = '';
    el.style.display = '';
    el.scrollIntoView({ behavior: 'smooth' });
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
      result.innerHTML = `<span style="color:var(--success)">✓ 找到：${match.name}（${match.uid}）・ ${match.role}</span>`;
      this._msgMatchedUser = match;
    } else {
      result.innerHTML = `<span style="color:var(--danger)">✗ 找不到此用戶</span>`;
      this._msgMatchedUser = null;
    }
  },

  // ── 發送信件（實裝） ──
  sendMessage() {
    const title = document.getElementById('msg-title')?.value.trim();
    if (!title) { this.showToast('請輸入信件標題'); return; }
    const body = document.getElementById('msg-body')?.value.trim();
    if (!body) { this.showToast('請輸入信件內容'); return; }
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

    // 發送人 UID（取當前登入用戶或 demo 角色）
    const currentUser = ApiService.getCurrentUser?.() || null;
    const senderUid = currentUser?.uid || 'SYSTEM';

    const now = new Date();
    const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const isScheduled = !!schedule;

    // 建立 admin 記錄
    const adminMsg = {
      id: 'mg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title,
      target: targetLabel,
      targetUid: targetUid || null,
      targetName: targetName || null,
      senderUid,
      readRate: '-',
      time: timeStr,
      status: isScheduled ? 'scheduled' : 'sent',
      body,
      scheduledAt: isScheduled ? schedule : null,
    };
    ApiService.createAdminMessage(adminMsg);

    // 立即發送 → 同時投遞到用戶收件箱
    if (!isScheduled) {
      this._deliverMessageToInbox(title, body, targetLabel, targetUid, senderUid);
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

  // ── 投遞到用戶收件箱 ──
  _deliverMessageToInbox(title, body, targetLabel, targetUid, senderUid) {
    const preview = body.length > 40 ? body.slice(0, 40) + '...' : body;
    const now = new Date();
    const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const newMsg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: targetUid ? 'private' : 'system',
      typeName: targetUid ? '私訊' : '系統',
      title,
      preview,
      time: timeStr,
      unread: true,
      senderUid,
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
