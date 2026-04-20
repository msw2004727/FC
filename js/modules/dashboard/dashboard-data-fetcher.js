/* ================================================
   SportHub — Admin Dashboard: Full Data Fetcher
   一次性從 Firestore 撈取完整資料（不使用快取）
   依賴：firebase-config.js (db), config.js
   ================================================ */

Object.assign(App, {

  _dashboardFetchInProgress: false,
  _dashboardFetchCancelled: false,

  /**
   * 撈取完整儀表板資料（7 個集合）
   * @param {number} monthsRange 1/3/6/12
   * @param {function} onProgress ({ step, total, stepName, status, count?, message? })
   * @returns {Promise<{ok:boolean, reason?:string, snapshot?:object}>}
   */
  async _fetchDashboardData(monthsRange, onProgress) {
    if (this._dashboardFetchInProgress) {
      return { ok: false, reason: 'in_progress' };
    }
    this._dashboardFetchInProgress = true;
    this._dashboardFetchCancelled = false;

    const snapshot = {
      fetchedAt: new Date(),
      monthsRange: monthsRange,
      users: [],
      teams: [],
      tournaments: [],
      events: [],
      registrations: [],
      attendanceRecords: [],
      activityRecords: [],
    };

    const steps = [
      { key: 'users',            label: '用戶資料',    fetch: () => this._fetchDashUsers() },
      { key: 'teams',            label: '俱樂部資料',  fetch: () => this._fetchDashTeams() },
      { key: 'tournaments',      label: '賽事資料',    fetch: () => this._fetchDashTournaments() },
      { key: 'events',           label: '活動資料',    fetch: () => this._fetchDashEvents() },
      { key: 'registrations',    label: '報名紀錄',    fetch: () => this._fetchDashRegistrations() },
      { key: 'attendanceRecords',label: '簽到紀錄',    fetch: () => this._fetchDashAttendance() },
      { key: 'activityRecords',  label: '活動紀錄',    fetch: () => this._fetchDashActivity() },
    ];

    try {
      for (let i = 0; i < steps.length; i++) {
        if (this._dashboardFetchCancelled) {
          return { ok: false, reason: 'cancelled' };
        }
        const step = steps[i];
        if (typeof onProgress === 'function') {
          onProgress({ step: i + 1, total: steps.length, stepName: step.label, status: 'loading' });
        }
        try {
          const data = await step.fetch();
          if (this._dashboardFetchCancelled) {
            return { ok: false, reason: 'cancelled' };
          }
          snapshot[step.key] = data;
          if (typeof onProgress === 'function') {
            onProgress({ step: i + 1, total: steps.length, stepName: step.label, status: 'done', count: data.length });
          }
        } catch (err) {
          console.error('[dashFetch] step failed:', step.key, err);
          if (typeof onProgress === 'function') {
            onProgress({ step: i + 1, total: steps.length, stepName: step.label, status: 'error', message: err?.message || 'error' });
          }
          // 本步驟失敗，繼續下一步（該集合留空陣列）
        }
      }

      if (this._dashboardFetchCancelled) {
        return { ok: false, reason: 'cancelled' };
      }

      this._dashboardSnapshot = snapshot;
      return { ok: true, snapshot };
    } finally {
      this._dashboardFetchInProgress = false;
    }
  },

  _cancelDashboardFetch() {
    this._dashboardFetchCancelled = true;
  },

  // ══════════════════════════════════
  //  個別集合撈取
  // ══════════════════════════════════

  async _fetchDashUsers() {
    const snap = await db.collection('users').get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },

  async _fetchDashTeams() {
    const snap = await db.collection('teams').get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },

  async _fetchDashTournaments() {
    const snap = await db.collection('tournaments').get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },

  async _fetchDashEvents() {
    const snap = await db.collection('events').get();
    return snap.docs.map(d => ({ ...d.data(), _docId: d.id }));
  },

  /**
   * 撈取 registrations collectionGroup（含子集合去重過濾）
   * 依 CLAUDE.md Phase 4c 規範：d.ref.path.split('/').length > 2 過濾舊根集合
   */
  async _fetchDashRegistrations() {
    const snap = await db.collectionGroup('registrations').get();
    return snap.docs
      .filter(d => d.ref.path.split('/').length > 2)
      .map(d => ({ ...d.data(), _docId: d.id }));
  },

  async _fetchDashAttendance() {
    const snap = await db.collectionGroup('attendanceRecords').get();
    return snap.docs
      .filter(d => d.ref.path.split('/').length > 2)
      .map(d => ({ ...d.data(), _docId: d.id }));
  },

  async _fetchDashActivity() {
    const snap = await db.collectionGroup('activityRecords').get();
    return snap.docs
      .filter(d => d.ref.path.split('/').length > 2)
      .map(d => ({ ...d.data(), _docId: d.id }));
  },

  // ══════════════════════════════════
  //  工具函式
  // ══════════════════════════════════

  /** 回傳 N 個月前的毫秒時間戳 */
  _dashCutoffMillis(monthsRange) {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsRange);
    return d.getTime();
  },

});
