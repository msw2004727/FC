/* ================================================
   SportHub - User Admin: Event Blocklist (2026-04-20)
   位於「用戶補正管理 > 活動黑名單」分頁

   功能：
   - 模糊搜尋活動（標題/日期/主辦人/地點）
   - 模糊搜尋用戶（名字/UID/LINE ID/地區）
   - 加入黑名單（含理由、寫審計軌跡）
   - 列出所有現有黑名單（依活動分組）
   - 移除黑名單項目（二段式確認）

   寫入路徑：events/{eventDocId} 僅改 blockedUids + blockedUidsLog
   對應 Firestore Rules: isBlocklistFieldsOnly() + canManageEventBlocklist()
   ================================================ */

Object.assign(App, {

  _ebSelectedEventId: '',
  _ebSelectedUid: '',

  // ── 搜尋：活動 ──
  searchEventForBlocklist() {
    if (!this.hasPermission?.('admin.repair.event_blocklist')) return;
    const input = document.getElementById('eb-event-search');
    const dropdown = document.getElementById('eb-event-dropdown');
    if (!input || !dropdown) return;
    const query = String(input.value || '').trim().toLowerCase();
    if (!query) { dropdown.classList.remove('open'); dropdown.innerHTML = ''; return; }
    const all = ApiService.getEvents?.() || [];
    const matches = all.filter(e => {
      const hay = [e.title, e.date, e.creator, e.location, e.id].map(v => String(v || '').toLowerCase()).join(' ');
      return hay.includes(query);
    }).slice(0, 20);
    if (!matches.length) {
      dropdown.innerHTML = '<div style="padding:.45rem .6rem;font-size:.78rem;color:var(--text-muted)">找不到符合的活動</div>';
      dropdown.classList.add('open');
      return;
    }
    dropdown.innerHTML = matches.map(e => {
      const statusLabel = e.status === 'ended' ? '已結束' : (e.status === 'cancelled' ? '已取消' : (e.status === 'upcoming' ? '即將開放' : '報名中'));
      return `<div class="ce-delegate-item" data-eid="${escapeHTML(e.id)}">
        <span class="ce-delegate-item-name">${escapeHTML(e.title || '未命名')}</span>
        <span class="ce-delegate-item-meta">${escapeHTML(e.date || '')} · ${escapeHTML(e.creator || '')} · ${statusLabel}</span>
      </div>`;
    }).join('');
    dropdown.querySelectorAll('.ce-delegate-item').forEach(item => {
      item.addEventListener('mousedown', ev => {
        ev.preventDefault();
        this._selectEventForBlocklist(item.dataset.eid);
      });
    });
    dropdown.classList.add('open');
  },

  _selectEventForBlocklist(eventId) {
    this._ebSelectedEventId = String(eventId || '').trim();
    const e = ApiService.getEvent?.(this._ebSelectedEventId);
    const input = document.getElementById('eb-event-search');
    const dropdown = document.getElementById('eb-event-dropdown');
    const selected = document.getElementById('eb-event-selected');
    if (dropdown) { dropdown.classList.remove('open'); dropdown.innerHTML = ''; }
    if (input) input.value = '';
    if (selected) {
      if (e) {
        selected.innerHTML = `已選：<strong>${escapeHTML(e.title || '')}</strong> · ${escapeHTML(e.date || '')} · ${escapeHTML(e.creator || '')}`;
        selected.style.color = 'var(--text-primary)';
      } else {
        selected.textContent = '找不到該活動';
      }
    }
  },

  // ── 搜尋：用戶 ──
  searchUserForBlocklist() {
    if (!this.hasPermission?.('admin.repair.event_blocklist')) return;
    const input = document.getElementById('eb-user-search');
    const dropdown = document.getElementById('eb-user-dropdown');
    if (!input || !dropdown) return;
    const query = String(input.value || '').trim().toLowerCase();
    if (!query) { dropdown.classList.remove('open'); dropdown.innerHTML = ''; return; }
    const all = ApiService.getAdminUsers?.() || [];
    const matches = all.filter(u => {
      const hay = [u.displayName, u.name, u.uid, u.lineUserId, u.region].map(v => String(v || '').toLowerCase()).join(' ');
      return hay.includes(query);
    }).slice(0, 20);
    if (!matches.length) {
      dropdown.innerHTML = '<div style="padding:.45rem .6rem;font-size:.78rem;color:var(--text-muted)">找不到符合的用戶</div>';
      dropdown.classList.add('open');
      return;
    }
    dropdown.innerHTML = matches.map(u => {
      const label = u.displayName || u.name || u.uid || '未命名';
      const metaParts = [];
      if (u.uid) metaParts.push(escapeHTML(u.uid));
      if (u.region) metaParts.push(escapeHTML(u.region));
      return `<div class="ce-delegate-item" data-uid="${escapeHTML(u.uid)}">
        <span class="ce-delegate-item-name">${escapeHTML(label)}</span>
        <span class="ce-delegate-item-meta">${metaParts.join(' · ')}</span>
      </div>`;
    }).join('');
    dropdown.querySelectorAll('.ce-delegate-item').forEach(item => {
      item.addEventListener('mousedown', ev => {
        ev.preventDefault();
        this._selectUserForBlocklist(item.dataset.uid);
      });
    });
    dropdown.classList.add('open');
  },

  _selectUserForBlocklist(uid) {
    this._ebSelectedUid = String(uid || '').trim();
    const u = (ApiService.getAdminUsers?.() || []).find(x => String(x.uid || '').trim() === this._ebSelectedUid);
    const input = document.getElementById('eb-user-search');
    const dropdown = document.getElementById('eb-user-dropdown');
    const selected = document.getElementById('eb-user-selected');
    if (dropdown) { dropdown.classList.remove('open'); dropdown.innerHTML = ''; }
    if (input) input.value = '';
    if (selected) {
      if (u) {
        const label = u.displayName || u.name || u.uid;
        selected.innerHTML = `已選：<strong>${escapeHTML(label)}</strong> · ${escapeHTML(u.uid || '')} · ${escapeHTML(u.region || '—')}`;
        selected.style.color = 'var(--text-primary)';
      } else {
        selected.textContent = '找不到該用戶';
      }
    }
  },

  // ── 加入黑名單 ──
  async addEventBlocklistEntry() {
    if (!this.hasPermission?.('admin.repair.event_blocklist')) { this.showToast('權限不足'); return; }
    const eid = this._ebSelectedEventId;
    const uid = this._ebSelectedUid;
    if (!eid) { this.showToast('請先選擇活動'); return; }
    if (!uid) { this.showToast('請先選擇用戶'); return; }
    const e = ApiService.getEvent?.(eid);
    if (!e || !e._docId) { this.showToast('找不到活動或資料異常'); return; }
    const u = (ApiService.getAdminUsers?.() || []).find(x => String(x.uid || '').trim() === uid);
    if (!u) { this.showToast('找不到用戶'); return; }
    if (Array.isArray(e.blockedUids) && e.blockedUids.includes(uid)) {
      this.showToast('該用戶已在此活動的黑名單中');
      return;
    }
    const reasonInput = document.getElementById('eb-reason');
    const reason = String(reasonInput?.value || '').trim().slice(0, 80);
    const currentUid = ApiService.getCurrentUser?.()?.uid || '';
    const logEntry = {
      uid,
      by: currentUid,
      action: 'add',
      at: new Date().toISOString(),
      reason,
    };
    try {
      await db.collection('events').doc(e._docId).update({
        blockedUids: firebase.firestore.FieldValue.arrayUnion(uid),
        blockedUidsLog: firebase.firestore.FieldValue.arrayUnion(logEntry),
      });
      // 更新本地快取
      if (!Array.isArray(e.blockedUids)) e.blockedUids = [];
      e.blockedUids.push(uid);
      if (!Array.isArray(e.blockedUidsLog)) e.blockedUidsLog = [];
      e.blockedUidsLog.push(logEntry);
      this.showToast(`已將 ${u.displayName || u.name || uid} 加入活動黑名單`);
      // 清表
      if (reasonInput) reasonInput.value = '';
      this._ebSelectedEventId = '';
      this._ebSelectedUid = '';
      const sEv = document.getElementById('eb-event-selected');
      const sU = document.getElementById('eb-user-selected');
      if (sEv) { sEv.textContent = '尚未選擇活動'; sEv.style.color = 'var(--text-muted)'; }
      if (sU) { sU.textContent = '尚未選擇用戶'; sU.style.color = 'var(--text-muted)'; }
      this._renderExistingEventBlocklist();
    } catch (err) {
      console.error('[addEventBlocklistEntry] failed:', err);
      this.showToast('寫入失敗：' + (err?.message || '未知錯誤'));
    }
  },

  // ── 移除黑名單 ──
  async removeEventBlocklistEntry(eventId, uid) {
    if (!this.hasPermission?.('admin.repair.event_blocklist')) { this.showToast('權限不足'); return; }
    const e = ApiService.getEvent?.(eventId);
    if (!e || !e._docId) { this.showToast('找不到活動'); return; }
    const u = (ApiService.getAdminUsers?.() || []).find(x => String(x.uid || '').trim() === uid);
    const label = u ? (u.displayName || u.name || uid) : uid;
    // 二段式確認
    const ok = window.confirm(`確定要將「${label}」從活動「${e.title || eventId}」的黑名單中移除嗎？`);
    if (!ok) return;
    const currentUid = ApiService.getCurrentUser?.()?.uid || '';
    const logEntry = {
      uid,
      by: currentUid,
      action: 'remove',
      at: new Date().toISOString(),
      reason: '',
    };
    try {
      await db.collection('events').doc(e._docId).update({
        blockedUids: firebase.firestore.FieldValue.arrayRemove(uid),
        blockedUidsLog: firebase.firestore.FieldValue.arrayUnion(logEntry),
      });
      // 更新本地快取
      if (Array.isArray(e.blockedUids)) e.blockedUids = e.blockedUids.filter(x => x !== uid);
      if (!Array.isArray(e.blockedUidsLog)) e.blockedUidsLog = [];
      e.blockedUidsLog.push(logEntry);
      this.showToast(`已將 ${label} 從黑名單中移除`);
      this._renderExistingEventBlocklist();
    } catch (err) {
      console.error('[removeEventBlocklistEntry] failed:', err);
      this.showToast('移除失敗：' + (err?.message || '未知錯誤'));
    }
  },

  // ── 列出所有現有黑名單（依活動分組）──
  _renderExistingEventBlocklist() {
    const container = document.getElementById('eb-existing-list');
    if (!container) return;
    const events = (ApiService.getEvents?.() || []).filter(e => Array.isArray(e.blockedUids) && e.blockedUids.length > 0);
    if (!events.length) {
      container.innerHTML = '<div style="padding:.5rem 0;color:var(--text-muted)">目前沒有任何活動黑名單項目</div>';
      return;
    }
    const users = ApiService.getAdminUsers?.() || [];
    const userByUid = new Map();
    users.forEach(u => { if (u.uid) userByUid.set(String(u.uid).trim(), u); });
    // 按建立日期倒序排列活動
    events.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    container.innerHTML = events.map(e => {
      const rows = (e.blockedUids || []).map(uid => {
        const u = userByUid.get(String(uid).trim());
        const label = u ? (u.displayName || u.name || uid) : uid;
        // 從 log 找到最後一筆 action=add 的紀錄
        const logs = Array.isArray(e.blockedUidsLog) ? e.blockedUidsLog : [];
        const addLog = logs.filter(l => l && l.uid === uid && l.action === 'add').pop();
        const byLabel = addLog?.by ? (userByUid.get(String(addLog.by).trim())?.displayName || addLog.by) : '—';
        const atLabel = addLog?.at ? new Date(addLog.at).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
        const reasonLabel = addLog?.reason ? `・理由：${escapeHTML(addLog.reason)}` : '';
        return `<div style="padding:.4rem .5rem;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:.5rem">
          <div style="flex:1;min-width:0">
            <div style="font-size:.82rem;font-weight:500">${escapeHTML(label)}</div>
            <div style="font-size:.7rem;color:var(--text-muted);margin-top:.1rem">由 ${escapeHTML(byLabel)} 於 ${atLabel} 加入${reasonLabel}</div>
          </div>
          <button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem;color:var(--danger);border-color:var(--danger);flex-shrink:0" onclick="App.removeEventBlocklistEntry('${escapeHTML(e.id)}','${escapeHTML(uid)}')">移除</button>
        </div>`;
      }).join('');
      return `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:.5rem;overflow:hidden">
        <div style="padding:.4rem .5rem;background:var(--bg-elevated);font-size:.82rem;font-weight:600">
          ${escapeHTML(e.title || '')} <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">${escapeHTML(e.date || '')}</span>
        </div>
        ${rows}
      </div>`;
    }).join('');
  },

});
