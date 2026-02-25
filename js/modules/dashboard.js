/* ================================================
   SportHub — Admin Dashboard (Statistics + Canvas Charts)
   依賴：config.js, api-service.js, i18n.js
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
      const region = (e.location || '').split('市')[0] + '市';
      if (region.length > 1) regionCounts[region] = (regionCounts[region] || 0) + 1;
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

    // ── 球隊排名 Top 5 ──
    const topTeams = [...teams].sort((a, b) => (b.teamExp || 0) - (a.teamExp || 0)).slice(0, 5);

    // Build HTML
    container.innerHTML = `
      <div class="dash-summary">
        <div class="dash-card"><div class="dash-num">${totalUsers}</div><div class="dash-label">${t('dash.totalUsers')}</div></div>
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

    // ── 繪製 Canvas 圖表（需等 DOM 完成） ──
    requestAnimationFrame(() => {
      this._drawDonutChart('dash-chart-type', typeCounts, totalEvents);
      this._drawBarChart('dash-chart-month', monthCounts);
    });
  },

  /** 繪製甜甜圈圖（活動類型分布） */
  _drawDonutChart(canvasId, typeCounts, totalEvents) {
    const el = document.getElementById(canvasId);
    if (!el || !el.parentElement) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const dpr = window.devicePixelRatio || 1;
    const w = el.parentElement.offsetWidth - 32 || 280;
    const h = 200;
    el.width = w * dpr; el.height = h * dpr;
    el.style.height = h + 'px';
    const ctx = el.getContext('2d');
    ctx.scale(dpr, dpr);

    const colorMap = { friendly: '#0d9488', camp: '#ec4899', play: '#7c3aed', watch: '#f59e0b' };
    const data = Object.entries(typeCounts).map(([type, count]) => ({
      label: (TYPE_CONFIG[type] || {}).label || type,
      value: count,
      color: colorMap[type] || '#6b7280',
    }));

    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) {
      ctx.fillStyle = isDark ? '#6b7280' : '#9ca3af';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t('common.noData'), w / 2, h / 2);
      return;
    }

    const cx = w * 0.35, cy = h / 2;
    const r = Math.min(cx - 10, cy - 10);
    const innerR = r * 0.55;

    let startAngle = -Math.PI / 2;
    data.forEach(d => {
      const slice = (d.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, startAngle + slice);
      ctx.arc(cx, cy, innerR, startAngle + slice, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = d.color;
      ctx.fill();
      startAngle += slice;
    });

    // 中心文字
    ctx.fillStyle = isDark ? '#e5e7eb' : '#1f2937';
    ctx.font = 'bold 20px Outfit, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(totalEvents, cx, cy - 6);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280';
    ctx.fillText(t('dash.totalEvents'), cx, cy + 12);

    // 圖例
    const lx = w * 0.68;
    let ly = (h - data.length * 28) / 2;
    data.forEach(d => {
      ctx.beginPath();
      ctx.arc(lx + 5, ly + 6, 5, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.fillStyle = isDark ? '#d1d5db' : '#374151';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      const pct = Math.round((d.value / total) * 100);
      ctx.fillText(`${d.label}  ${d.value} (${pct}%)`, lx + 16, ly + 10);
      ly += 28;
    });
  },

  /** 繪製長條圖（月份趨勢） */
  _drawBarChart(canvasId, monthCounts) {
    const el = document.getElementById(canvasId);
    if (!el || !el.parentElement) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const dpr = window.devicePixelRatio || 1;
    const w = el.parentElement.offsetWidth - 32 || 280;
    const h = 180;
    el.width = w * dpr; el.height = h * dpr;
    el.style.height = h + 'px';
    const ctx = el.getContext('2d');
    ctx.scale(dpr, dpr);

    const sorted = Object.entries(monthCounts).sort((a, b) => a[0].localeCompare(b[0]));
    if (sorted.length === 0) {
      ctx.fillStyle = isDark ? '#6b7280' : '#9ca3af';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t('common.noData'), w / 2, h / 2);
      return;
    }

    const pad = { top: 18, right: 10, bottom: 28, left: 35 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;
    const maxVal = Math.max(...sorted.map(d => d[1]), 1);
    const barW = Math.min(36, (chartW / sorted.length) * 0.6);
    const totalBarArea = barW * sorted.length;
    const gap = (chartW - totalBarArea) / (sorted.length + 1);

    // 網格線
    ctx.strokeStyle = isDark ? '#374151' : '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + chartH * (1 - i / 4);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = isDark ? '#9ca3af' : '#9ca3af';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxVal * i / 4), pad.left - 5, y + 3);
    }

    // 長條
    sorted.forEach(([month, count], i) => {
      const x = pad.left + gap + i * (barW + gap);
      const barH = Math.max(2, (count / maxVal) * chartH);
      const y = pad.top + chartH - barH;

      const grad = ctx.createLinearGradient(x, y, x, y + barH);
      grad.addColorStop(0, '#7c3aed');
      grad.addColorStop(1, '#a78bfa');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barW, barH);

      // 數值
      if (count > 0) {
        ctx.fillStyle = isDark ? '#d1d5db' : '#374151';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(count, x + barW / 2, y - 4);
      }

      // 月份標籤
      ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      const displayM = month.includes('/') ? String(parseInt(month.split('/')[1])) : String(parseInt(month));
      ctx.fillText(displayM + '月', x + barW / 2, h - 8);
    });
  },

  /** 繪製折線圖（活躍度趨勢） */
  _drawLineChart(canvasId, weeklyData) {
    const el = document.getElementById(canvasId);
    if (!el || !el.parentElement) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const dpr = window.devicePixelRatio || 1;
    const w = el.parentElement.offsetWidth - 32 || 280;
    const h = 180;
    el.width = w * dpr; el.height = h * dpr;
    el.style.height = h + 'px';
    const ctx = el.getContext('2d');
    ctx.scale(dpr, dpr);

    const labels = weeklyData.map(d => d.label);
    const values = weeklyData.map(d => d.value);
    if (values.length === 0) {
      ctx.fillStyle = isDark ? '#6b7280' : '#9ca3af';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('尚無資料', w / 2, h / 2);
      return;
    }

    const pad = { top: 20, right: 15, bottom: 30, left: 35 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;
    const maxVal = Math.max(...values, 1);

    // Grid lines
    ctx.strokeStyle = isDark ? '#374151' : '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + chartH * (1 - i / 4);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = isDark ? '#9ca3af' : '#9ca3af';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxVal * i / 4), pad.left - 5, y + 3);
    }

    // Compute points
    const step = values.length > 1 ? chartW / (values.length - 1) : 0;
    const points = values.map((v, i) => ({
      x: pad.left + i * step,
      y: pad.top + chartH * (1 - v / maxVal),
    }));

    // Fill area
    ctx.beginPath();
    ctx.moveTo(points[0].x, pad.top + chartH);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, pad.top + chartH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    grad.addColorStop(0, isDark ? 'rgba(59,130,246,.3)' : 'rgba(59,130,246,.15)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dots + labels
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#3b82f6';
      ctx.fill();
      ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], p.x, h - 8);
    });
  },

  /** 將 MM/DD 或 YYYY/MM/DD 字串轉為 Date；MM/DD 格式以距今超過 180 天推算為去年 */
  _parseMmDdToDate(mmdd) {
    const parts = (mmdd || '').split('/');
    if (parts.length === 3) {
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
    if (parts.length === 2) {
      const mm = parseInt(parts[0]), dd = parseInt(parts[1]);
      if (!mm || !dd) return null;
      const now = new Date();
      const cy = now.getFullYear();
      const d = new Date(cy, mm - 1, dd);
      return (d - now > 180 * 86400000) ? new Date(cy - 1, mm - 1, dd) : d;
    }
    return null;
  },

  async clearAllData() {
    // Step 0: Permission guard
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
    // Step 1: Password prompt
    const pwd = prompt('請輸入清除全部資料密碼（4位數）');
    if (pwd !== '1121') {
      this.showToast('密碼錯誤');
      return;
    }

    // Step 2: Confirmation
    if (!(await this.appConfirm('確定要清除全部資料嗎？這會刪除所有集合、站內信及 Storage 圖片（保留 users），且無法復原。'))) return;

    // Step 3: Show loading
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = '';

    try {
      if (ModeManager.isDemo()) {
        // Demo mode: clear in-memory arrays and objects
        const keys = Object.keys(DemoData).filter(k => k !== 'users' && k !== 'currentUser');
        keys.forEach(k => {
          if (Array.isArray(DemoData[k])) { DemoData[k].length = 0; }
          else if (typeof DemoData[k] === 'object' && DemoData[k] !== null) {
            Object.keys(DemoData[k]).forEach(sub => delete DemoData[k][sub]);
          }
        });
      } else {
        // Production: clear Firestore collections (except users)
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
