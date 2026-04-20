/* ================================================
   SportHub — Admin Dashboard (Page Init & Data Loading)
   依賴：config.js, api-service.js, i18n.js, dashboard-widgets.js
   ================================================ */
Object.assign(App, {

  renderDashboard() {
    const container = document.getElementById('dashboard-content');
    if (!container) return;
    const users = ApiService.getAdminUsers();
    const events = ApiService.getEvents();
    const teams = ApiService.getTeams();
    const tournaments = ApiService.getTournaments();
    const records = ApiService.getActivityRecords();

    // ── 統計摘要 ──
    const totalUsers = users.length;
    const totalEvents = events.length;
    const openEvents = events.filter(e => e.status === 'open').length;
    const endedEvents = events.filter(e => e.status === 'ended').length;
    const activeTeams = teams.filter(tm => tm.active !== false).length;
    const ongoingTourn = tournaments.filter(tm => !tm.ended).length;
    const totalRecords = records.length;
    const cancelledRecords = records.filter(r => r.status === 'cancelled').length;
    const attendRate = totalRecords > 0 ? Math.round(((totalRecords - cancelledRecords) / totalRecords) * 100) : 0;

    // ── 活動類型分布 ──
    const typeCounts = {};
    events.forEach(e => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });

    // ── 地區分布 ──
    const regionCounts = {};
    events.forEach(e => {
      const region = e.location || '';
      if (region) regionCounts[region] = (regionCounts[region] || 0) + 1;
    });

    // ── 近期活動趨勢（按月） ──
    const monthCounts = {};
    records.forEach(r => {
      if (!r.date) return;
      const d = this._parseMmDdToDate(r.date);
      if (!d) return;
      const key = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthCounts[key] = (monthCounts[key] || 0) + 1;
    });

    // ── 俱樂部排名 Top 5 ──
    const topTeams = [...teams].sort((a, b) => (b.teamExp || 0) - (a.teamExp || 0)).slice(0, 5);

    // Build HTML
    container.innerHTML = `
      <div class="dash-refresh-bar">
        <span class="dash-refresh-info" id="dash-refresh-info">尚未撈取完整資料（點擊卡片前請先撈取）</span>
        <select id="dash-months-range" onchange="App._onDashMonthsRangeChange?.()">
          <option value="1">近 1 個月</option>
          <option value="3">近 3 個月</option>
          <option value="6" selected>近 6 個月</option>
          <option value="12">近 12 個月</option>
        </select>
        <button class="primary-btn" type="button" onclick="App._startDashboardRefresh?.()">🔄 重新整理完整資料</button>
      </div>
      <div class="dash-summary">
        <div class="dash-card" data-drill-key="users" onclick="App._openDashDrilldown?.('users')"><div class="dash-num">${totalUsers}</div><div class="dash-label">${t('dash.totalUsers')}</div></div>
        <div class="dash-card"><div class="dash-num">${totalEvents}</div><div class="dash-label">${t('dash.totalEvents')}</div></div>
        <div class="dash-card"><div class="dash-num">${activeTeams}</div><div class="dash-label">${t('dash.activeTeams')}</div></div>
        <div class="dash-card"><div class="dash-num">${ongoingTourn}</div><div class="dash-label">${t('dash.ongoingTourn')}</div></div>
      </div>
      <div class="dash-summary">
        <div class="dash-card"><div class="dash-num">${openEvents}</div><div class="dash-label">${t('dash.openEvents')}</div></div>
        <div class="dash-card"><div class="dash-num">${endedEvents}</div><div class="dash-label">${t('dash.endedEvents')}</div></div>
        <div class="dash-card"><div class="dash-num">${totalRecords}</div><div class="dash-label">${t('dash.totalRecords')}</div></div>
        <div class="dash-card"><div class="dash-num">${attendRate}%</div><div class="dash-label">${t('dash.attendRate')}</div></div>
      </div>

      <div class="info-card">
        <div class="info-title">用戶成長趨勢（近 12 個月）</div>
        <canvas id="dash-chart-user-growth" style="width:100%;display:block"></canvas>
      </div>

      ${this._renderDashboardParticipantSearchCard ? this._renderDashboardParticipantSearchCard() : ''}

      <div class="info-card">
        <div class="info-title">${t('dash.typeDistribution')}</div>
        <canvas id="dash-chart-type" style="width:100%;display:block"></canvas>
      </div>

      <div class="info-card">
        <div class="info-title">${t('dash.regionDistribution')}</div>
        <div class="dash-bar-list">
          ${Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).map(([region, count]) => {
            const pct = Math.round((count / totalEvents) * 100);
            return `<div class="dash-bar-row">
              <span class="dash-bar-label">${escapeHTML(region)}</span>
              <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%;background:var(--accent)"></div></div>
              <span class="dash-bar-val">${count}</span>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="info-card">
        <div class="info-title">${t('dash.monthlyTrend')}</div>
        <canvas id="dash-chart-month" style="width:100%;display:block"></canvas>
      </div>

      <div class="info-card">
        <div class="info-title">${t('dash.teamRanking')}</div>
        ${topTeams.map((tm, i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem 0;border-bottom:1px solid var(--border)">
          <span style="font-size:.82rem"><span style="font-weight:700;color:var(--accent);margin-right:.3rem">#${i + 1}</span>${escapeHTML(tm.name)}</span>
          <span style="font-size:.78rem;font-weight:600;color:var(--text-secondary)">${(tm.teamExp || 0).toLocaleString()} pts</span>
        </div>`).join('')}
      </div>
    `;

    // ── 用戶成長趨勢（近 12 個月註冊數） ──
    const userGrowthData = (() => {
      const now = new Date();
      const months = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ y: d.getFullYear(), m: d.getMonth(), label: (d.getMonth() + 1) + '月', count: 0 });
      }
      users.forEach(u => {
        const raw = u.createdAt || u.joinDate || '';
        if (!raw) return;
        const d = new Date(typeof raw === 'object' && raw.toDate ? raw.toDate() : raw);
        if (isNaN(d.getTime())) return;
        const slot = months.find(s => s.y === d.getFullYear() && s.m === d.getMonth());
        if (slot) slot.count++;
      });
      return months.map(s => ({ label: s.label, value: s.count }));
    })();

    // ── 繪製 Canvas 圖表（需等 DOM 完成） ──
    requestAnimationFrame(() => {
      this._drawLineChart('dash-chart-user-growth', userGrowthData);
      this._drawDonutChart('dash-chart-type', typeCounts, totalEvents);
      this._drawBarChart('dash-chart-month', monthCounts);
    });

    // ── 雲端用量指標（非同步載入，不阻塞主儀表板） ──
    if (typeof this.renderUsageMetrics === 'function') {
      this.renderUsageMetrics(container).catch(err => {
        console.warn('[dashboard] renderUsageMetrics 失敗:', err);
      });
    }

    // ── 翻譯 API 用量（非同步） ──
    if (typeof this.renderTranslateUsage === 'function') {
      this.renderTranslateUsage(container).catch(err => {
        console.warn('[dashboard] renderTranslateUsage 失敗:', err);
      });
    }

    // ── 即時監聽範圍設定（admin 以上） ──
    if (typeof this._renderRealtimeLimitCard === 'function'
        && (ROLE_LEVEL_MAP[this.currentRole] || 0) >= ROLE_LEVEL_MAP.admin) {
      this._renderRealtimeLimitCard(container).catch(err => {
        console.warn('[dashboard] renderRealtimeLimitCard 失敗:', err);
      });
    }

    this._markPageSnapshotReady?.('page-admin-dashboard');

    // 更新「最後撈取」資訊列 + 進入時自動提示（Q3=B）
    this._updateDashRefreshInfo?.();
    this._maybePromptDashRefresh?.();
  },

  async clearAllData() {
    // Step 0: Permission guard
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
    // Step 1: Password prompt (SHA-256 hash comparison)
    const pwd = prompt('請輸入清除全部資料密碼');
    if (!pwd) { this.showToast('已取消'); return; }
    const _cdMsgBuf = new TextEncoder().encode(pwd);
    const _cdHashBuf = await crypto.subtle.digest('SHA-256', _cdMsgBuf);
    const _cdHashHex = [...new Uint8Array(_cdHashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (_cdHashHex !== '3958de59a1ae60b4330e99d6a5b791897717cdd2347260d0f71df22d60b01062') {
      this.showToast('密碼錯誤');
      return;
    }

    // Step 2: Confirmation
    if (!(await this.appConfirm('確定要清除全部資料嗎？這會刪除所有集合、站內信及 Storage 圖片（保留 users），且無法復原。'))) return;

    // Step 3: Show loading
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = '';

    try {
      {
        // Clear Firestore collections (except users)
        const collections = [
          'events', 'tournaments', 'teams', 'registrations',
          'attendanceRecords', 'activityRecords', 'matches', 'standings',
          'operationLogs', 'expLogs', 'teamExpLogs',
          'announcements', 'banners', 'floatingAds', 'popupAds', 'sponsors',
          'siteThemes', 'shopItems', 'achievements', 'badges', 'leaderboard',
          'messages', 'adminMessages', 'notifTemplates',
          'permissions', 'customRoles', 'rolePermissions', 'trades',
        ];
        for (const name of collections) {
          await FirebaseService.clearCollection(name);
        }
        // Clear corresponding cache arrays + objects
        collections.forEach(name => {
          const cacheKey = name === 'users' ? 'adminUsers' : name;
          if (Array.isArray(FirebaseService._cache[cacheKey])) {
            FirebaseService._cache[cacheKey].length = 0;
            FirebaseService._saveToLS(cacheKey, []);
          } else if (typeof FirebaseService._cache[cacheKey] === 'object' && FirebaseService._cache[cacheKey] !== null) {
            Object.keys(FirebaseService._cache[cacheKey]).forEach(k => delete FirebaseService._cache[cacheKey][k]);
            FirebaseService._saveToLS(cacheKey, {});
          }
        });
        // Clear localStorage timestamp so stale cache won't be restored
        localStorage.removeItem(FirebaseService._LS_TS_KEY);

        // Clear all images in Firebase Storage
        try {
          const imgCount = await FirebaseService.clearAllStorageImages();
          console.log(`[clearAllData] Storage 已刪除 ${imgCount} 張圖片`);
        } catch (storageErr) {
          console.warn('[clearAllData] Storage 清除部分失敗:', storageErr);
        }
      }

      // Step 4: Log the action (write to opLog AFTER clearing, so this is the first entry)
      ApiService._writeOpLog('system_clear', '系統清除', '一鍵清除全部資料與圖片（保留 users）');

      // Step 5: Re-render
      this.renderAll?.();
      this.showToast('已清除全部資料，請重新整理頁面');
    } catch (err) {
      console.error('[clearAllData]', err);
      this.showToast('清除失敗：' + err.message);
    } finally {
      if (overlay) overlay.style.display = 'none';
    }
  },

});
