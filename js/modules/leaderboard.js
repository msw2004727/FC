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
            <div class="lb-name">${this._userTag(p.name, null, { uid: p.uid || '' })}</div>
            <div class="lb-sub">Lv.${App._calcLevelFromExp(p.exp || 0).level}</div>
          </div>
          <div class="lb-exp">${p.exp.toLocaleString()}</div>
        </div>
      `;
    }).join('');
    this._markPageSnapshotReady?.('page-leaderboard');
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
    const attRecords = ApiService.getUserAttendanceRecords?.(uid) || ApiService.getAttendanceRecords();
    const registered = [];
    const completed = [];
    const cancelled = [];

    // 第一遍：建立取消、活躍報名、完成的 eventId 集合
    const seenCancel = new Set();
    const seenActive = new Set();
    const seenComplete = new Set();
    all.forEach(r => {
      if (r.status === 'cancelled') seenCancel.add(r.eventId);
      if (r.status === 'registered' || r.status === 'waitlisted') seenActive.add(r.eventId);
    });
    // 取消後又重新報名 → 視為活躍，從 seenCancel 移除
    seenActive.forEach(eid => seenCancel.delete(eid));
    all.forEach(r => {
      if (r.status === 'cancelled' || r.status === 'removed') return;
      const hasCheckin  = attRecords.some(a => a.eventId === r.eventId && a.uid === uid && a.type === 'checkin');
      const hasCheckout = attRecords.some(a => a.eventId === r.eventId && a.uid === uid && a.type === 'checkout');
      if (hasCheckin && hasCheckout) seenComplete.add(r.eventId);
    });

    // 第二遍：正式分類
    all.forEach(r => {
      // 移除記錄不出現在任何 tab
      if (r.status === 'removed') return;
      // 取消紀錄：僅當該活動最終狀態為取消時才顯示（同一場只保留一筆）
      if (r.status === 'cancelled') {
        if (seenActive.has(r.eventId)) return; // 已重新報名，跳過舊取消紀錄
        if (!cancelled.some(c => c.eventId === r.eventId)) {
          cancelled.push(r);
        }
        return;
      }
      // 完成判定（方向 B）：唯一依據為有 checkin + checkout 掃碼紀錄
      if (seenComplete.has(r.eventId) && !seenCancel.has(r.eventId)) {
        if (!completed.some(c => c.eventId === r.eventId)) {
          completed.push({ ...r, _displayStatus: 'completed' });
        }
        return;
      }
      // 報名中 / 未出席：status=registered/waitlisted
      if (r.status === 'registered' || r.status === 'waitlisted') {
        // 跨類別去重：若該活動已有取消或完成紀錄，跳過殭屍 registered
        if (seenCancel.has(r.eventId) || seenComplete.has(r.eventId)) return;
        if (isPublic) return; // 公開卡片不顯示報名中
        const event = ApiService.getEvent(r.eventId);
        if (event && event.status !== 'ended' && event.status !== 'cancelled') {
          registered.push(r);
        } else if (event && event.status === 'ended' && r.status === 'registered') {
          // 只有正式報名且活動已結束、未完成簽到者才顯示 missed；waitlisted 不算應到
          registered.push({ ...r, _displayStatus: 'missed' });
        }
      }
    });
    return { registered, completed, cancelled };
  },

  _formatUserAttendanceSummaryTime(value) {
    let date = null;
    if (value && typeof value.toDate === 'function') date = value.toDate();
    else if (value && Number.isFinite(Number(value.seconds))) date = new Date(Number(value.seconds) * 1000);
    else if (value) date = new Date(value);
    if (!date || Number.isNaN(date.getTime())) return '--';
    const pad = number => String(number).padStart(2, '0');
    return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate())
      + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  },

  _renderUserAttendanceSummary(uid, ids = {}) {
    const summary = typeof FirebaseService !== 'undefined'
      ? FirebaseService.getUserAttendanceSummary?.(uid)
      : null;
    const setText = (id, value) => {
      const node = id ? document.getElementById(id) : null;
      if (node) node.textContent = value;
    };
    if (!summary) {
      setText(ids.totalId, '--');
      setText(ids.doneId, '--');
      setText(ids.rateId, '--');
      setText(ids.updatedId, '資料更新 --');
      return false;
    }
    setText(ids.totalId, summary.expectedCount);
    setText(ids.doneId, summary.completedCount);
    setText(ids.rateId, summary.attendRate + '%');
    setText(ids.updatedId, '資料更新 ' + this._formatUserAttendanceSummaryTime(summary.updatedAt));
    return true;
  },

  /**
   * 方向 B 統計：以掃碼紀錄為唯一依據
   * 參加場次 = 有 checkin 的不重複場次
   * 完成     = 有 checkout 的不重複場次
   * 出席率   = checkin場次 ÷ 已結束有效報名場次 × 100%
   */
  _calcScanStats(uid) {
    const summary = typeof FirebaseService !== 'undefined'
      ? FirebaseService.getUserAttendanceSummary?.(uid)
      : null;
    if (summary) {
      return {
        expectedCount: summary.expectedCount,
        completedCount: summary.completedCount,
        attendRate: summary.attendRate,
      };
    }
    const stats = this._getAchievementStats?.();
    const events = ApiService.getEvents?.() || [];
    const eventMap = new Map(events.map(event => [event.id, event]));

    // 用 registrations（權威資料）排除已取消的活動，修正 activityRecords 狀態未同步問題
    const allRegs = typeof ApiService.getRegistrations === 'function'
      ? ApiService.getRegistrations({ userId: uid, includeTerminal: true })
      : [];
    const activeRegEventIds = new Set();
    const cancelledRegEventIds = new Set();
    allRegs.forEach(r => {
      if (r.status === 'confirmed' || r.status === 'waitlisted') {
        activeRegEventIds.add(r.eventId);
      } else if (r.status === 'cancelled') {
        cancelledRegEventIds.add(r.eventId);
      }
    });
    // 取消後又重新報名 → 不排除
    activeRegEventIds.forEach(eid => cancelledRegEventIds.delete(eid));

    const activityRecords = ApiService.getActivityRecords(uid)
      .filter(r => !cancelledRegEventIds.has(r.eventId));

    const result = stats?.getParticipantAttendanceStats?.({
      uid,
      registrations: activityRecords,
      attendanceRecords: ApiService.getUserAttendanceRecords?.(uid) || ApiService.getAttendanceRecords(),
      eventMap,
      now: new Date(),
      isEventEnded: (event) => event?.status === 'ended',
    });

    if (result) {
      const { expectedCount, completedCount, attendRate } = result;
      return { expectedCount, completedCount, attendRate };
    }

    return { expectedCount: 0, completedCount: 0, attendRate: 0 };
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
    const statusLabel = { completed: '完成', cancelled: '取消', registered: '已報名', waitlisted: '候補中', missed: '未出席' };

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
    const uid = user?.uid || user?.lineUserId || '';
    const cache = typeof FirebaseService !== 'undefined' && FirebaseService.getUserStatsCache?.();
    const recordsReady = cache && cache.uid === uid && cache.activityRecords !== null;

    if (uid && !recordsReady) {
      container.innerHTML = '<div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">載入紀錄中...</div>';
      FirebaseService.ensureUserStatsLoaded?.(uid).then(() => {
        if (this.currentPage === 'page-profile') this.renderActivityRecords(f, p);
      }).catch(err => {
        console.warn('[renderActivityRecords]', err);
        if (this.currentPage === 'page-profile') {
          container.innerHTML = '<div style="font-size:.82rem;color:var(--danger);padding:.5rem 0">紀錄載入失敗，請按重新整理</div>';
        }
      });
    } else {
      const filtered = this._getFilteredRecords(uid, f, false);
      container.innerHTML = this._renderRecordListHtml(filtered, p, 'renderActivityRecords', f);
    }

    this._renderUserAttendanceSummary(uid, {
      totalId: 'profile-stat-total', doneId: 'profile-stat-done', rateId: 'profile-stat-rate',
      updatedId: 'my-records-updated-at',
    });

    const tabs = document.getElementById('record-tabs');
    if (tabs) {
      tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.filter === f));
      if (!tabs.dataset.recordBound) {
        tabs.dataset.recordBound = '1';
        tabs.querySelectorAll('.tab').forEach(tab => {
          tab.addEventListener('click', () => {
            tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            this.renderActivityRecords(tab.dataset.filter, 1);
          });
        });
      }
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
    const cache = typeof FirebaseService !== 'undefined' && FirebaseService.getUserStatsCache?.();
    const recordsReady = cache && cache.uid === uid && cache.activityRecords !== null;
    if (recordsReady) {
      const filtered = this._getFilteredRecords(uid, f, true);
      container.innerHTML = this._renderRecordListHtml(filtered, page || 1, 'renderUserCardRecords', f);
    } else {
      container.innerHTML = '<div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">點擊重新整理載入活動紀錄</div>';
    }

    this._renderUserAttendanceSummary(uid, {
      totalId: 'uc-stat-total', doneId: 'uc-stat-done', rateId: 'uc-stat-rate',
      updatedId: 'uc-records-updated-at',
    });
    this._updateUserCardBadgeCount(uid);

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

  _updateUserCardBadgeCount(uid) {
    var badgeEl = document.getElementById('uc-stat-badges');
    if (!badgeEl) return;

    var currentUser = ApiService.getCurrentUser?.() || null;
    var currentUid = currentUser?.uid || currentUser?._docId;

    // 當前用戶：同步計算
    if (uid === currentUid) {
      badgeEl.textContent = this._getAchievementProfile?.()?.getCurrentBadgeCount?.() || 0;
      return;
    }

    // 其他用戶：異步從 per-user 子集合計算
    badgeEl.textContent = '--';
    var badgeHelper = this._getAchievementBadges?.();
    if (!badgeHelper?.getEvaluatedAchievementsForUserAsync) return;

    var users = ApiService.getAdminUsers?.() || [];
    var targetUser = users.find(function(u) { return u.uid === uid || u.lineUserId === uid; });
    if (!targetUser) return;

    badgeHelper.getEvaluatedAchievementsForUserAsync(targetUser).then(function(achievements) {
      var badges = ApiService.getBadges?.() || [];
      var count = badgeHelper.getBadgeCount(achievements, badges);
      var el = document.getElementById('uc-stat-badges');
      if (el) el.textContent = count;
    }).catch(function() {});
  },

});
