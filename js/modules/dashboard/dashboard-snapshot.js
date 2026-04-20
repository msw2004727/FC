/* ================================================
   SportHub — Admin Dashboard: Snapshot Manager
   管理 _dashboardSnapshot 的時效、時間區間 filter、重新整理流程
   依賴：dashboard-data-fetcher.js, dashboard-progress-modal.js
   ================================================ */

Object.assign(App, {

  _dashboardSnapshot: null,

  _hasDashboardSnapshot() {
    return !!this._dashboardSnapshot;
  },

  _clearDashboardSnapshot() {
    this._dashboardSnapshot = null;
    this._updateDashRefreshInfo?.();
  },

  _dashboardSnapshotAgeMs() {
    const s = this._dashboardSnapshot;
    if (!s || !s.fetchedAt) return null;
    return Date.now() - s.fetchedAt.getTime();
  },

  _dashboardSnapshotAgeMinutes() {
    const ms = this._dashboardSnapshotAgeMs();
    return ms == null ? null : Math.floor(ms / 60000);
  },

  /**
   * 取得依 monthsRange filter 後的資料
   * @param {number} [monthsRange] 若未指定則使用 snapshot 原本的區間
   * @returns {object|null} filter 後的資料；若無 snapshot 回傳 null
   */
  _getFilteredDashSnapshot(monthsRange) {
    const snap = this._dashboardSnapshot;
    if (!snap) return null;

    const targetRange = Number(monthsRange) || snap.monthsRange;
    const cutoff = this._dashCutoffMillis(targetRange);

    const toMillis = (v) => {
      if (!v) return 0;
      if (typeof v.toMillis === 'function') return v.toMillis();
      if (v.seconds) return v.seconds * 1000;
      if (typeof v === 'string') {
        const t = new Date(v.replace(/\//g, '-')).getTime();
        return isNaN(t) ? 0 : t;
      }
      const t = new Date(v).getTime();
      return isNaN(t) ? 0 : t;
    };

    const filterByTime = (arr, ...fields) => arr.filter(item => {
      for (const f of fields) {
        const ms = toMillis(item[f]);
        if (ms > 0 && ms >= cutoff) return true;
      }
      // 若所有欄位都無效 → 保留（admin 寧可多不可少）
      return fields.every(f => !item[f]);
    });

    return {
      fetchedAt: snap.fetchedAt,
      monthsRange: targetRange,
      users: snap.users,              // 全量（不依時間篩）
      teams: snap.teams,              // 全量
      tournaments: snap.tournaments,  // 全量
      events: filterByTime(snap.events, 'createdAt', 'date'),
      registrations: filterByTime(snap.registrations, 'registeredAt', 'createdAt'),
      attendanceRecords: filterByTime(snap.attendanceRecords, 'createdAt'),
      activityRecords: filterByTime(snap.activityRecords, 'createdAt', 'date'),
    };
  },

  // ══════════════════════════════════
  //  重新整理流程（UI 按鈕觸發）
  // ══════════════════════════════════

  async _startDashboardRefresh() {
    if (this._dashboardFetchInProgress) {
      this.showToast?.('正在撈取中，請稍候');
      return;
    }

    const select = document.getElementById('dash-months-range');
    const monthsRange = parseInt(select?.value) || 6;

    // 開進度 modal
    this._openDashboardProgressModal?.();

    const result = await this._fetchDashboardData(monthsRange, (p) => {
      this._updateDashboardProgress?.(p);
    });

    // 完成 / 取消 / 失敗 → 關 modal
    this._closeDashboardProgressModal?.();

    if (result.ok) {
      this.showToast?.('資料撈取完成，可點擊卡片查看詳情');
      this._updateDashRefreshInfo();
    } else if (result.reason === 'cancelled') {
      this.showToast?.('已取消撈取');
      // Q4=B：取消後清空 snapshot 避免誤用不完整資料
      this._clearDashboardSnapshot();
    } else if (result.reason === 'in_progress') {
      this.showToast?.('已有撈取任務進行中');
    }
  },

  /** 更新儀表板最上方的「最後更新」資訊條 */
  _updateDashRefreshInfo() {
    const el = document.getElementById('dash-refresh-info');
    if (!el) return;
    if (!this._hasDashboardSnapshot()) {
      el.textContent = '尚未撈取完整資料（點擊下方卡片前請先撈取）';
      el.style.color = 'var(--warning, #d97706)';
      return;
    }
    const age = this._dashboardSnapshotAgeMinutes();
    const range = this._dashboardSnapshot.monthsRange;
    const ageStr = age < 1 ? '剛剛' : age < 60 ? (age + ' 分鐘前') : (Math.floor(age / 60) + ' 小時前');
    el.textContent = `資料範圍：近 ${range} 個月 · 已撈取：${ageStr}`;
    el.style.color = age > 10 ? 'var(--warning, #d97706)' : 'var(--text-muted)';
  },

  /** 時間區間切換：若擴大區間需重撈 */
  _onDashMonthsRangeChange() {
    if (!this._hasDashboardSnapshot()) return;
    const select = document.getElementById('dash-months-range');
    const newRange = parseInt(select?.value) || 6;
    const oldRange = this._dashboardSnapshot.monthsRange;
    if (newRange > oldRange) {
      const ok = confirm(`您選擇的區間（${newRange} 個月）大於目前資料範圍（${oldRange} 個月），需要重新撈取才能顯示該區間資料。要重新撈取嗎？`);
      if (ok) {
        this._startDashboardRefresh();
      } else {
        select.value = String(oldRange);
      }
    }
    // 新區間 <= 舊區間：不必重撈，下次開彈窗時 _getFilteredDashSnapshot() 會自動以新區間 filter
  },

  /** 進入儀表板時的自動提示（Q3=B） */
  _maybePromptDashRefresh() {
    if (!this._hasDashboardSnapshot()) {
      this.showToast?.('📊 儀表板詳情功能需先撈取完整資料');
      return;
    }
    const age = this._dashboardSnapshotAgeMinutes();
    if (age != null && age > 10) {
      this.showToast?.(`📊 資料已是 ${age} 分鐘前，建議重新撈取最新數據`);
    }
  },

});
