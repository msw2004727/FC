/* ================================================
   SportHub — Leaderboard & Activity Records
   ================================================ */

Object.assign(App, {

  renderLeaderboard() {
    const container = document.getElementById('leaderboard-list');
    if (!container) return;
    container.innerHTML = ApiService.getLeaderboard().map((p, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'normal';
      return `
        <div class="lb-item">
          <div class="lb-rank ${rankClass}">${i + 1}</div>
          <div class="lb-avatar">${escapeHTML(p.avatar)}</div>
          <div class="lb-info">
            <div class="lb-name">${this._userTag(p.name)}</div>
            <div class="lb-sub">Lv.${App._calcLevelFromExp(p.exp || 0).level}</div>
          </div>
          <div class="lb-exp">${p.exp.toLocaleString()}</div>
        </div>
      `;
    }).join('');
  },

  _recordPage: 1,

  /**
   * 分類用戶的活動紀錄
   * @param {string} uid
   * @param {boolean} isPublic - 公開卡片只回傳 completed + cancelled
   * @returns {{ registered:Array, completed:Array, cancelled:Array }}
   */
  _categorizeRecords(uid, isPublic) {
    const all = ApiService.getActivityRecords(uid);
    const attRecords = ApiService.getAttendanceRecords();
    const registered = [];
    const completed = [];
    const cancelled = [];
    const seenCancel = new Set();
    const seenComplete = new Set();

    all.forEach(r => {
      // 取消紀錄（同一場活動只保留一筆）
      if (r.status === 'cancelled') {
        if (!seenCancel.has(r.eventId)) {
          seenCancel.add(r.eventId);
          cancelled.push(r);
        }
        return;
      }
      // 完成判定：status=completed 或有 checkin+checkout
      const hasCheckin = attRecords.some(a => a.eventId === r.eventId && a.uid === uid && a.type === 'checkin');
      const hasCheckout = attRecords.some(a => a.eventId === r.eventId && a.uid === uid && a.type === 'checkout');
      if (r.status === 'completed' || (hasCheckin && hasCheckout)) {
        if (!seenComplete.has(r.eventId)) {
          seenComplete.add(r.eventId);
          completed.push({ ...r, _displayStatus: 'completed' });
        }
        return;
      }
      // 報名中：status=registered/waitlisted + 活動尚未結束
      if (r.status === 'registered' || r.status === 'waitlisted') {
        if (isPublic) return; // 公開卡片不顯示報名中
        const event = ApiService.getEvent(r.eventId);
        if (event && event.status !== 'ended' && event.status !== 'cancelled') {
          registered.push(r);
        }
      }
    });
    return { registered, completed, cancelled };
  },

  /**
   * 取得篩選後的紀錄（依活動日期由新到舊排序）
   */
  _getFilteredRecords(uid, filter, isPublic) {
    const { registered, completed, cancelled } = this._categorizeRecords(uid, isPublic);
    let result;
    if (filter === 'registered') result = registered;
    else if (filter === 'completed') result = completed;
    else if (filter === 'cancelled') result = cancelled;
    else if (isPublic) result = [...completed, ...cancelled];
    else result = [...registered, ...completed, ...cancelled];
    // 依活動日期由新到舊排序
    return result.sort((a, b) => {
      const evA = ApiService.getEvent(a.eventId);
      const evB = ApiService.getEvent(b.eventId);
      const dA = evA ? this._parseEventStartDate(evA.date) : null;
      const dB = evB ? this._parseEventStartDate(evB.date) : null;
      if (dA && dB) return dB - dA;
      if (dA) return -1;
      if (dB) return 1;
      return 0;
    });
  },

  /**
   * 渲染紀錄列表（含分頁）
   * @param {Array} items - 紀錄陣列
   * @param {number} page - 頁碼
   * @param {string} callbackFn - 分頁按鈕呼叫的函數名稱
   * @param {string} filter - 目前篩選值
   * @returns {string} HTML
   */
  _renderRecordListHtml(items, page, callbackFn, filter) {
    const PAGE_SIZE = 10;
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const p = Math.max(1, Math.min(page, totalPages));
    const pageItems = items.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
    const statusLabel = { completed: '完成', cancelled: '取消', registered: '已報名', waitlisted: '候補中' };

    let html = pageItems.length ? pageItems.map(r => {
      const ds = r._displayStatus || r.status;
      return `<div class="mini-activity">
        <span class="mini-activity-status ${ds}"></span>
        <span class="mini-activity-name">${escapeHTML(r.name)}</span>
        <span class="mini-activity-tag ${ds}">${escapeHTML(statusLabel[ds] || ds)}</span>
        <span class="mini-activity-date">${r.date}</span>
      </div>`;
    }).join('') : '<div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">點擊頁籤查看紀錄</div>';

    if (totalPages > 1) {
      html += `<div style="display:flex;justify-content:center;align-items:center;gap:.5rem;padding:.5rem 0;font-size:.75rem">
        <button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="App.${callbackFn}('${filter}',${p - 1})" ${p <= 1 ? 'disabled' : ''}>‹</button>
        <span style="color:var(--text-muted)">${p} / ${totalPages}</span>
        <button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="App.${callbackFn}('${filter}',${p + 1})" ${p >= totalPages ? 'disabled' : ''}>›</button>
      </div>`;
    }
    return html;
  },

  renderActivityRecords(filter, page) {
    const container = document.getElementById('my-activity-records');
    if (!container) return;
    const f = filter || 'all';
    const p = page || 1;
    this._recordPage = p;

    const user = ApiService.getCurrentUser();
    const uid = user?.uid || 'demo-user';
    const filtered = this._getFilteredRecords(uid, f, false);
    container.innerHTML = this._renderRecordListHtml(filtered, p, 'renderActivityRecords', f);

    // 更新統計
    const { completed, cancelled } = this._categorizeRecords(uid, false);
    const allRecords = ApiService.getActivityRecords(uid);
    const totalCount = allRecords.length;
    const completedCount = completed.length;
    const cancelledCount = cancelled.length;
    const attendRate = totalCount > 0 ? Math.round(((totalCount - cancelledCount) / totalCount) * 100) : 0;

    const el = (id) => document.getElementById(id);
    if (el('profile-stat-total')) el('profile-stat-total').textContent = totalCount;
    if (el('profile-stat-done')) el('profile-stat-done').textContent = completedCount;
    if (el('profile-stat-rate')) el('profile-stat-rate').textContent = `${attendRate}%`;

    // 綁定頁籤
    const tabs = document.getElementById('record-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderActivityRecords(tab.dataset.filter, 1);
        });
      });
    }
  },

  // ── 用戶資料卡片的活動紀錄（公開） ──
  _ucRecordUid: null,

  renderUserCardRecords(filter, page) {
    const container = document.getElementById('uc-activity-records');
    if (!container) return;
    const uid = this._ucRecordUid;
    if (!uid) return;
    const f = filter || 'all';
    const filtered = this._getFilteredRecords(uid, f, true);
    container.innerHTML = this._renderRecordListHtml(filtered, page || 1, 'renderUserCardRecords', f);

    // 更新統計
    const { completed, cancelled } = this._categorizeRecords(uid, true);
    const allRecords = ApiService.getActivityRecords(uid);
    const totalCount = allRecords.length;
    const completedCount = completed.length;
    const cancelledCount = cancelled.length;
    const attendRate = totalCount > 0 ? Math.round(((totalCount - cancelledCount) / totalCount) * 100) : 0;
    const _achs = ApiService.getAchievements().filter(a => a.status !== 'archived');
    const badgeCount = _achs.filter(a => {
      const t = a.condition && a.condition.threshold != null ? a.condition.threshold : (a.target != null ? a.target : 1);
      return a.current >= t;
    }).length;
    const el = (id) => document.getElementById(id);
    if (el('uc-stat-total')) el('uc-stat-total').textContent = totalCount;
    if (el('uc-stat-done')) el('uc-stat-done').textContent = completedCount;
    if (el('uc-stat-rate')) el('uc-stat-rate').textContent = `${attendRate}%`;
    if (el('uc-stat-badges')) el('uc-stat-badges').textContent = badgeCount;

    // 綁定頁籤
    const tabs = document.getElementById('uc-record-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderUserCardRecords(tab.dataset.filter, 1);
        });
      });
    }
  },

});
