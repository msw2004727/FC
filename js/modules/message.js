/* ================================================
   SportHub — Message (Render + Admin Management)
   ================================================ */

Object.assign(App, {

  renderMessageList() {
    const messages = ApiService.getMessages();
    const container = document.getElementById('message-list');
    container.innerHTML = messages.map(m => `
      <div class="msg-card${m.unread ? ' msg-unread' : ''}" onclick="App.readMessage(this, '${m.id}')">
        <div class="msg-card-header">
          <span class="msg-dot ${m.unread ? 'unread' : 'read'}"></span>
          <span class="msg-type">${m.typeName}</span>
          <span class="msg-title">${m.title}</span>
        </div>
        <div class="msg-preview">${m.preview}</div>
        <div class="msg-time">${m.time}</div>
      </div>
    `).join('');
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
    if (changed === 0) {
      this.showToast('沒有未讀訊息');
      return;
    }
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
  //  Message Management (Admin)
  // ══════════════════════════════════

  renderMsgManage(filter) {
    const container = document.getElementById('msg-manage-list');
    if (!container) return;
    const f = filter || 'sent';
    const items = ApiService.getAdminMessages().filter(m => m.status === f);
    container.innerHTML = items.length ? items.map(m => `
      <div class="msg-manage-card">
        <div class="msg-manage-header">
          <span class="msg-manage-title">${m.title}</span>
          <span class="msg-read-rate">${m.status === 'sent' ? '已讀率 ' + m.readRate : m.status === 'scheduled' ? '排程中' : '已回收'}</span>
        </div>
        <div style="font-size:.75rem;color:var(--text-muted)">對象：${m.target} ・ ${m.time}</div>
        <div style="font-size:.75rem;color:var(--text-secondary);margin-top:.2rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.body}</div>
        <div style="margin-top:.4rem;display:flex;gap:.3rem">
          ${m.status === 'sent' ? `<button class="text-btn" style="font-size:.75rem" onclick="App.showToast('信件內容：${m.body.slice(0,20)}...')">查看</button><button class="text-btn" style="font-size:.75rem;color:var(--danger)" onclick="App.recallMsg('${m.id}')">回收</button>` : ''}
          ${m.status === 'scheduled' ? `<button class="text-btn" style="font-size:.75rem" onclick="App.showToast('已取消排程')">取消排程</button>` : ''}
          ${m.status === 'recalled' ? `<button class="text-btn" style="font-size:.75rem;color:var(--text-muted)">已回收</button>` : ''}
        </div>
      </div>
    `).join('') : '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:.82rem">無信件</div>';

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

  recallMsg(id) {
    ApiService.updateAdminMessage(id, { status: 'recalled' });
    this.renderMsgManage('sent');
    this.showToast('已回收信件');
  },

  showMsgCompose() {
    const el = document.getElementById('msg-compose');
    if (el) { el.style.display = ''; el.scrollIntoView({ behavior: 'smooth' }); }
  },

  sendDemoMsg() {
    const title = document.getElementById('msg-title')?.value || '未命名信件';
    const target = document.getElementById('msg-target')?.value || '全體用戶';
    const body = document.getElementById('msg-body')?.value || '';
    const schedule = document.getElementById('msg-schedule')?.value;
    ApiService.createAdminMessage({
      id: 'mg' + Date.now(), title, target, readRate: '-', time: new Date().toLocaleDateString('zh-TW').replace(/\//g, '/'),
      status: schedule ? 'scheduled' : 'sent', body: body || title
    });
    document.getElementById('msg-compose').style.display = 'none';
    document.getElementById('msg-title').value = '';
    document.getElementById('msg-body').value = '';
    this.renderMsgManage(schedule ? 'scheduled' : 'sent');
    const tabs = document.getElementById('msg-manage-tabs');
    if (tabs) {
      tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tabs.querySelector(`[data-mfilter="${schedule ? 'scheduled' : 'sent'}"]`)?.classList.add('active');
    }
    this.showToast(schedule ? '信件已排程' : '信件已發送');
  },

});
