/* ================================================
   SportHub — Message: Admin List & Management
   Split from message-admin.js — pure move, no logic changes
   Security: all user content passes through escapeHTML() before DOM insertion
   ================================================ */

Object.assign(App, {

  renderMsgManage(filter) {
    const container = document.getElementById('msg-manage-list');
    if (!container) return;
    const f = filter || this._msgCurrentFilter || 'sent';
    this._msgCurrentFilter = f;
    const allItems = ApiService.getAdminMessages();
    // 排程 tab 同時顯示 scheduled + processing + cancelled
    const items = f === 'scheduled'
      ? allItems.filter(m => m.status === 'scheduled' || m.status === 'processing' || m.status === 'cancelled')
      : allItems.filter(m => m.status === f);

    // 統計數量
    const countEl = document.getElementById('msg-sent-count');
    if (countEl) {
      const sentCount = allItems.filter(m => m.status === 'sent').length;
      const scheduledCount = allItems.filter(m => m.status === 'scheduled' || m.status === 'processing').length;
      const recalledCount = allItems.filter(m => m.status === 'recalled').length;
      const deletedCount = allItems.filter(m => m.status === 'deleted').length;
      countEl.textContent = `已發送 ${sentCount} 封 ・ 排程 ${scheduledCount} 封 ・ 已回收 ${recalledCount} 封 ・ 已刪除 ${deletedCount} 封`;
    }

    container.innerHTML = items.length ? items.map(m => {
      const targetLabel = m.targetUid
        ? `${m.targetName || m.targetUid}（${m.targetUid}）`
        : m.target;
      const senderLabel = m.senderName ? `<span data-no-translate>發送人：${escapeHTML(m.senderName)}</span>` : '';
      const s = 'font-size:.72rem;padding:.2rem .5rem';
      let btns = '';
      let scheduleInfo = '';

      if (m.status === 'sent') {
        btns = `<button class="primary-btn small" style="${s}" onclick="App.viewMsgDetail('${m.id}')">查看</button>`
             + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.recallMsg('${m.id}')">回收</button>`
             + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMsg('${m.id}')">刪除</button>`;
      } else if (m.status === 'scheduled') {
        if (m.scheduledAt) {
          const schedDate = new Date(m.scheduledAt);
          const schedStr = `${schedDate.getFullYear()}/${String(schedDate.getMonth()+1).padStart(2,'0')}/${String(schedDate.getDate()).padStart(2,'0')} ${String(schedDate.getHours()).padStart(2,'0')}:${String(schedDate.getMinutes()).padStart(2,'0')}`;
          scheduleInfo = `<div style="font-size:.72rem;margin-top:.2rem;padding:.2rem .5rem;background:rgba(59,130,246,.1);color:#3b82f6;border-radius:4px;display:inline-block">&#128339; 預約發送：${schedStr}</div>`;
        }
        btns = `<button class="primary-btn small" style="${s}" onclick="App.viewMsgDetail('${m.id}')">查看</button>`
             + `<button class="outline-btn" style="${s};color:var(--warning)" onclick="App.cancelScheduleMsg('${m.id}')">取消排程</button>`
             + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMsg('${m.id}')">刪除</button>`;
      } else if (m.status === 'processing') {
        if (m.scheduledAt) {
          const schedDate = new Date(m.scheduledAt);
          const schedStr = `${schedDate.getFullYear()}/${String(schedDate.getMonth()+1).padStart(2,'0')}/${String(schedDate.getDate()).padStart(2,'0')} ${String(schedDate.getHours()).padStart(2,'0')}:${String(schedDate.getMinutes()).padStart(2,'0')}`;
          scheduleInfo = `<div style="font-size:.72rem;margin-top:.2rem;padding:.2rem .5rem;background:rgba(245,158,11,.12);color:#b45309;border-radius:4px;display:inline-block">&#128337; 處理中：${schedStr}</div>`;
        }
        btns = `<button class="primary-btn small" style="${s}" onclick="App.viewMsgDetail('${m.id}')">查看</button>`;
      } else if (m.status === 'recalled') {
        btns = `<button class="primary-btn small" style="${s}" onclick="App.viewMsgDetail('${m.id}')">查看</button>`
             + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMsg('${m.id}')">刪除</button>`;
      } else if (m.status === 'cancelled') {
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
      const statusMap = { sent: ['active', '已發送'], scheduled: ['scheduled', '排程中'], processing: ['scheduled', '處理中'], recalled: ['expired', '已回收'], cancelled: ['empty', '已取消'], deleted: ['expired', '已刪除'] };
      const [statusClass, statusText] = statusMap[m.status] || ['empty', m.status];

      return `
      <div class="msg-manage-card" style="margin-bottom:.5rem">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
          <span class="msg-manage-title" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(m.title)}</span>
          <span class="banner-manage-status status-${statusClass}">${statusText}</span>
        </div>
        <div style="font-size:.75rem;color:var(--text-muted)">${m.categoryName ? '[' + escapeHTML(m.categoryName) + '] ' : ''}對象：${escapeHTML(targetLabel)} ・ ${m.time}${senderLabel ? ' ・ ' + senderLabel : ''}</div>
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
    const statusMap = { sent: '已發送', scheduled: '排程中', processing: '處理中', recalled: '已回收', cancelled: '已取消排程', deleted: '已刪除' };
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
        ${m.senderName ? `<div data-no-translate>發送人：${escapeHTML(m.senderName)}</div>` : ''}
        ${schedHtml}
        <div>狀態：${statusMap[m.status] || m.status}</div>
      </div>
      <div style="font-size:.85rem;line-height:1.6;padding:.6rem;background:var(--bg-elevated);border-radius:var(--radius-sm);white-space:pre-wrap">${escapeHTML(m.body)}</div>
    `;
    document.body.appendChild(modal);
    modal.style.webkitBackdropFilter = 'blur(10px)';
    modal.style.display = 'flex';
  },

  // ── 回收信件（同時從用戶收件箱移除） ──
  // Phase 3: 回收信件 — 從自己 inbox 移除 + 舊 messages/ 也嘗試刪除
  async recallMsg(id) {
    if (!(await this.appConfirm('確定要回收此信件？收件人信箱中的信件將被移除。'))) return;
    const adminMsg = ApiService.getAdminMessages().find(m => m.id === id);
    ApiService.updateAdminMessage(id, { status: 'recalled' });
    const source = FirebaseService._cache.messages;
    const toRemove = [];
    for (let i = source.length - 1; i >= 0; i--) {
      const m = source[i];
      const matched = m.adminMsgId === id
        || (!m.adminMsgId && adminMsg && m.title === adminMsg.title && m.body === adminMsg.body);
      if (matched) {
        toRemove.push(m);
        source.splice(i, 1);
      }
    }
    const myUid = ApiService.getCurrentUser()?.uid;
    toRemove.forEach(m => {
      if (m._docId) {
        // Phase 3: 刪除自己 inbox 裡的副本
        if (myUid) {
          db.collection('users').doc(myUid).collection('inbox').doc(m._docId).delete()
            .catch(err => console.warn('[recallMsg] inbox delete:', err.message));
        }
        // 向後相容：也嘗試從舊 messages/ 刪除
        db.collection('messages').doc(m._docId).delete()
          .catch(() => {}); // 靜默失敗（可能已不存在）
      }
    });
    this.renderMessageList();
    this.updateNotifBadge();
    this.renderMsgManage('sent');
    this.showToast('已回收信件' + (toRemove.length ? `（移除 ${toRemove.length} 封收件箱訊息）` : ''));
  },

  // ── 刪除信件（軟刪除，保留紀錄） ──
  async deleteMsg(id) {
    if (!this.hasPermission('admin.messages.delete') && !this.hasPermission('admin.messages.entry')) { this.showToast('權限不足'); return; }
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

});
