/* ================================================
   SportHub — Admin Dashboard: Snapshot Manager
   管理 _dashboardSnapshot 的時效、時間區間 filter、重新整理流程
   依賴：dashboard-data-fetcher.js, dashboard-progress-modal.js
   ================================================ */

Object.assign(App, {

  _dashboardSnapshot: null,
  _dashboardSnapshotScope: 'range',

  _hasDashboardSnapshot() {
    return !!this._dashboardSnapshot;
  },

  _clearDashboardSnapshot() {
    this._dashboardSnapshot = null;
    this._dashboardSnapshotScope = 'range';
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

  _getDashSelectedMonthsRange(fallback = 6) {
    const select = typeof document !== 'undefined' ? document.getElementById('dash-months-range') : null;
    const value = parseInt(select?.value, 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  },

  _dashValueToMillis(v) {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') {
      const ms = v.toMillis();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof v.toDate === 'function') {
      const d = v.toDate();
      const ms = d instanceof Date ? d.getTime() : 0;
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    if (v instanceof Date) {
      const ms = v.getTime();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return 0;
      return v > 100000000000 ? v : v * 1000;
    }
    if (typeof v === 'string') {
      const raw = v.trim();
      if (!raw) return 0;
      const firstPart = raw.split(/[~～]/)[0].trim();
      if (/^\d{1,2}[/-]\d{1,2}(?:\s|$)/.test(firstPart) && typeof this._parseMmDdToDate === 'function') {
        const d = this._parseMmDdToDate(firstPart);
        const ms = d instanceof Date ? d.getTime() : 0;
        if (Number.isFinite(ms) && ms > 0) return ms;
      }
      const normalized = firstPart.replace(/\//g, '-');
      const isoish = /^\d{4}-\d{1,2}-\d{1,2}\s+\d/.test(normalized)
        ? normalized.replace(/\s+/, 'T')
        : normalized;
      const direct = new Date(isoish).getTime();
      if (Number.isFinite(direct)) return direct;
      if (typeof this._parseMmDdToDate === 'function') {
        const d = this._parseMmDdToDate(firstPart);
        const ms = d instanceof Date ? d.getTime() : 0;
        return Number.isFinite(ms) ? ms : 0;
      }
    }
    const fallback = new Date(v).getTime();
    return Number.isFinite(fallback) ? fallback : 0;
  },

  _filterDashItemsByTime(arr, cutoff, ...fields) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(item => {
      if (!item) return false;
      for (const f of fields) {
        const ms = this._dashValueToMillis(item[f]);
        if (ms > 0 && ms >= cutoff) return true;
      }
      return false;
    });
  },

  _getAllDashSnapshot() {
    const snap = this._dashboardSnapshot;
    if (!snap) return null;
    return {
      fetchedAt: snap.fetchedAt,
      monthsRange: this._getDashSelectedMonthsRange(snap.monthsRange || 6),
      source: 'snapshot',
      scope: 'all',
      hasSnapshot: true,
      users: Array.isArray(snap.users) ? snap.users : [],
      teams: Array.isArray(snap.teams) ? snap.teams : [],
      tournaments: Array.isArray(snap.tournaments) ? snap.tournaments : [],
      events: Array.isArray(snap.events) ? snap.events : [],
      allUsers: Array.isArray(snap.users) ? snap.users : [],
      allTeams: Array.isArray(snap.teams) ? snap.teams : [],
      allTournaments: Array.isArray(snap.tournaments) ? snap.tournaments : [],
      allEvents: Array.isArray(snap.events) ? snap.events : [],
      registrations: Array.isArray(snap.registrations) ? snap.registrations : [],
      attendanceRecords: Array.isArray(snap.attendanceRecords) ? snap.attendanceRecords : [],
      activityRecords: Array.isArray(snap.activityRecords) ? snap.activityRecords : [],
    };
  },

  _getDashboardCacheViewData() {
    const users = ApiService.getAdminUsers();
    const teams = ApiService.getTeams();
    const tournaments = ApiService.getTournaments();
    const events = ApiService.getEvents();
    return {
      fetchedAt: null,
      monthsRange: this._getDashSelectedMonthsRange(6),
      source: 'cache',
      scope: 'all',
      hasSnapshot: false,
      users,
      teams,
      tournaments,
      events,
      allUsers: users,
      allTeams: teams,
      allTournaments: tournaments,
      allEvents: events,
      registrations: typeof ApiService.getRegistrations === 'function' ? ApiService.getRegistrations() : [],
      attendanceRecords: typeof ApiService.getAttendanceRecords === 'function' ? ApiService.getAttendanceRecords() : [],
      activityRecords: ApiService.getActivityRecords(),
    };
  },

  _getDashboardViewData() {
    if (!this._hasDashboardSnapshot()) {
      return this._getDashboardCacheViewData();
    }
    if (this._dashboardSnapshotScope === 'all') {
      return this._getAllDashSnapshot();
    }
    return this._getFilteredDashSnapshot(this._getDashSelectedMonthsRange(this._dashboardSnapshot.monthsRange || 6));
  },

  /**
   * 取得依 monthsRange filter 後的資料
   * @param {number} [monthsRange] 若未指定則使用 snapshot 原本的區間
   * @returns {object|null} filter 後的資料；若無 snapshot 回傳 null
   */
  _getFilteredDashSnapshot(monthsRange) {
    const snap = this._dashboardSnapshot;
    if (!snap) return null;
    if (!monthsRange && this._dashboardSnapshotScope === 'all') {
      return this._getAllDashSnapshot();
    }

    const targetRange = Number(monthsRange) || this._getDashSelectedMonthsRange(snap.monthsRange || 6);
    const cutoff = this._dashCutoffMillis(targetRange);

    return {
      fetchedAt: snap.fetchedAt,
      source: 'snapshot',
      scope: 'range',
      hasSnapshot: true,
      monthsRange: targetRange,
      users: this._filterDashItemsByTime(snap.users, cutoff, 'createdAt', 'joinDate'),
      teams: this._filterDashItemsByTime(snap.teams, cutoff, 'createdAt', 'updatedAt'),
      tournaments: this._filterDashItemsByTime(snap.tournaments, cutoff, 'createdAt', 'date', 'regStart', 'updatedAt'),
      events: this._filterDashItemsByTime(snap.events, cutoff, 'createdAt', 'date', 'updatedAt'),
      allUsers: Array.isArray(snap.users) ? snap.users : [],
      allTeams: Array.isArray(snap.teams) ? snap.teams : [],
      allTournaments: Array.isArray(snap.tournaments) ? snap.tournaments : [],
      allEvents: Array.isArray(snap.events) ? snap.events : [],
      registrations: this._filterDashItemsByTime(snap.registrations, cutoff, 'registeredAt', 'createdAt', 'updatedAt'),
      attendanceRecords: this._filterDashItemsByTime(snap.attendanceRecords, cutoff, 'createdAt', 'date', 'updatedAt'),
      activityRecords: this._filterDashItemsByTime(snap.activityRecords, cutoff, 'createdAt', 'date', 'updatedAt'),
    };
  },

  _restoreDashboardAllData() {
    if (!this._hasDashboardSnapshot()) {
      this.showToast?.('尚未撈取完整資料，請先重新整理完整資料。');
      return;
    }
    this._dashboardSnapshotScope = 'all';
    this.renderDashboard?.();
    this.showToast?.('已恢復顯示全部已撈取資料。');
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
      this._dashboardSnapshotScope = 'range';
      this.showToast?.('資料撈取完成，可點擊卡片查看詳情');
      this.renderDashboard?.();
    } else if (result.reason === 'cancelled') {
      this.showToast?.('已取消撈取');
      // Q4=B：取消後清空 snapshot 避免誤用不完整資料
      this._clearDashboardSnapshot();
      this.renderDashboard?.();
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
    const range = this._getDashSelectedMonthsRange(this._dashboardSnapshot.monthsRange || 6);
    const scopeText = this._dashboardSnapshotScope === 'all' ? '全部快照資料' : `近 ${range} 個月快照資料`;
    const ageStr = age < 1 ? '剛剛' : age < 60 ? (age + ' 分鐘前') : (Math.floor(age / 60) + ' 小時前');
    el.textContent = `目前顯示：${scopeText} · 已撈取：${ageStr}`;
    el.style.color = age > 10 ? 'var(--warning, #d97706)' : 'var(--text-muted)';
  },

  /** 時間區間切換：同一份快照即時切換顯示區間 */
  _onDashMonthsRangeChange() {
    if (!this._hasDashboardSnapshot()) return;
    this._dashboardSnapshotScope = 'range';
    this.renderDashboard?.();
  },

  /** 進入儀表板時的自動提示（Q3=B） */
  _maybePromptDashRefresh() {
    if (!this._hasDashboardSnapshot()) {
      return;
    }
    const age = this._dashboardSnapshotAgeMinutes();
    if (age != null && age > 10) {
      this.showToast?.(`📊 資料已是 ${age} 分鐘前，建議重新撈取最新數據`);
    }
  },

});
