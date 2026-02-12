/* ================================================
   SportHub — Admin Dashboard (Statistics)
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
    const records = ApiService.getAllActivityRecords ? ApiService.getAllActivityRecords() : (typeof DemoData !== 'undefined' ? DemoData.activityRecords : []);

    // ── 統計摘要卡 ──
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
      const m = r.date ? r.date.substring(0, 2) : '??';
      monthCounts[m] = (monthCounts[m] || 0) + 1;
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
        <div class="dash-bar-list">
          ${Object.entries(typeCounts).map(([type, count]) => {
            const conf = TYPE_CONFIG[type] || { label: type, color: type };
            const pct = Math.round((count / totalEvents) * 100);
            return `<div class="dash-bar-row">
              <span class="dash-bar-label">${conf.label}</span>
              <div class="dash-bar-track"><div class="dash-bar-fill type-${conf.color}" style="width:${pct}%"></div></div>
              <span class="dash-bar-val">${count} (${pct}%)</span>
            </div>`;
          }).join('')}
        </div>
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
        <div class="dash-bar-list">
          ${Object.entries(monthCounts).sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => {
            const maxCount = Math.max(...Object.values(monthCounts));
            const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
            return `<div class="dash-bar-row">
              <span class="dash-bar-label">${month}月</span>
              <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%;background:#7c3aed"></div></div>
              <span class="dash-bar-val">${count}筆</span>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="info-card">
        <div class="info-title">${t('dash.teamRanking')}</div>
        ${topTeams.map((tm, i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem 0;border-bottom:1px solid var(--border)">
          <span style="font-size:.82rem"><span style="font-weight:700;color:var(--accent);margin-right:.3rem">#${i + 1}</span>${escapeHTML(tm.name)}</span>
          <span style="font-size:.78rem;font-weight:600;color:var(--text-secondary)">${(tm.teamExp || 0).toLocaleString()} pts</span>
        </div>`).join('')}
      </div>
    `;
  },

});
