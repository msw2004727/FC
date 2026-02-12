/* ================================================
   SportHub — Personal Data Dashboard
   依賴：config.js, data.js, api-service.js, dashboard.js (_drawBarChart, _drawDonutChart, _drawLineChart)
   ================================================ */

Object.assign(App, {

  renderPersonalDashboard() {
    const container = document.getElementById('personal-dashboard-content');
    if (!container) return;

    const user = ApiService.getCurrentUser?.();
    if (!user) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">請先登入</div>';
      return;
    }

    try { return this._renderPersonalDashboardInner(container, user); }
    catch (err) { console.error('[personalDashboard]', err); container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">資料載入失敗，請稍後再試</div>'; }
  },

  _renderPersonalDashboardInner(container, user) {
    const uid = user.uid || '';
    const records = (ApiService.getActivityRecords?.() || []).filter(r => r.uid === uid);
    const totalGames = user.totalGames || records.length;
    const completedGames = user.completedGames || records.filter(r => r.status === 'completed').length;
    const attendanceRate = user.attendanceRate || (totalGames > 0 ? Math.round(completedGames / totalGames * 100) : 0);
    const badges = ApiService.getBadges?.() || [];
    const achievements = (ApiService.getAchievements?.() || []).filter(a => a.status !== 'archived');
    const earnedBadges = badges.filter(b => {
      const ach = achievements.find(a => a.id === b.achId);
      const threshold = ach?.condition?.threshold ?? ach?.target ?? 1;
      return ach && ach.current >= threshold;
    });
    const totalExp = user.exp || 0;
    const calcLevel = App._calcLevelFromExp ? App._calcLevelFromExp(totalExp) : { level: 0 };
    const level = calcLevel.level || 0;

    // Summary cards
    const summaryHtml = `
      <div class="profile-stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:.5rem">
        <div class="stat-item"><span class="stat-num">${totalGames}</span><span class="stat-label">參加場次</span></div>
        <div class="stat-item"><span class="stat-num">${completedGames}</span><span class="stat-label">完成</span></div>
        <div class="stat-item"><span class="stat-num">${attendanceRate}%</span><span class="stat-label">出席率</span></div>
      </div>
      <div class="profile-stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:.5rem">
        <div class="stat-item"><span class="stat-num">${earnedBadges.length}</span><span class="stat-label">徽章</span></div>
        <div class="stat-item"><span class="stat-num">Lv.${level}</span><span class="stat-label">等級</span></div>
        <div class="stat-item"><span class="stat-num">${totalExp.toLocaleString()}</span><span class="stat-label">總 EXP</span></div>
      </div>`;

    // Monthly participation data (from activity records)
    const monthCounts = {};
    records.filter(r => r.status === 'completed' || r.status === 'registered').forEach(r => {
      const dateParts = (r.date || '').split('/');
      let monthKey;
      if (dateParts.length === 2) {
        monthKey = `2026/${dateParts[0].padStart(2, '0')}`;
      } else if (dateParts.length === 3) {
        monthKey = `${dateParts[0]}/${dateParts[1].padStart(2, '0')}`;
      }
      if (monthKey) monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
    });

    // Activity type data (from all events the user participated in)
    const typeCounts = { friendly: 0, camp: 0, play: 0, watch: 0 };
    const allEvents = ApiService.getEvents?.() || [];
    records.filter(r => r.status === 'completed' || r.status === 'registered').forEach(r => {
      const evt = allEvents.find(e => e.id === r.eventId);
      if (evt && typeCounts.hasOwnProperty(evt.type)) {
        typeCounts[evt.type]++;
      }
    });
    const totalTyped = Object.values(typeCounts).reduce((s, v) => s + v, 0);

    // Region distribution
    const regionCounts = {};
    records.filter(r => r.status === 'completed' || r.status === 'registered').forEach(r => {
      const evt = allEvents.find(e => e.id === r.eventId);
      if (evt && evt.location) {
        const region = evt.location.split('市')[0] + '市';
        regionCounts[region] = (regionCounts[region] || 0) + 1;
      }
    });
    const regionTotal = Object.values(regionCounts).reduce((s, v) => s + v, 0) || 1;
    const regionSorted = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const regionColors = ['#3b82f6', '#0d9488', '#f59e0b', '#ec4899', '#7c3aed'];
    const regionHtml = regionSorted.length > 0 ? regionSorted.map(([name, count], i) => {
      const pct = Math.round(count / regionTotal * 100);
      return `<div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.3rem">
        <span style="font-size:.78rem;min-width:4em;color:var(--text-secondary)">${escapeHTML(name)}</span>
        <div style="flex:1;height:16px;background:var(--bg-elevated);border-radius:8px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${regionColors[i % regionColors.length]};border-radius:8px;transition:width .4s"></div>
        </div>
        <span style="font-size:.72rem;color:var(--text-muted);min-width:2.5em;text-align:right">${count} 場</span>
      </div>`;
    }).join('') : '<div style="font-size:.82rem;color:var(--text-muted)">尚無資料</div>';

    // Weekly activity data (last 12 weeks)
    const weeklyData = this._calcWeeklyActivity(records);

    // Coach / Venue Owner role-specific panel
    const role = this.currentRole;
    let rolePanelHtml = '';
    if (role === 'coach' || role === 'captain') {
      const myEvents = allEvents.filter(e => e.creator === (user.displayName || ''));
      const hostedCount = myEvents.length;
      const endedMyEvents = myEvents.filter(e => e.status === 'ended');
      const reviewsAll = endedMyEvents.flatMap(e => e.reviews || []);
      const avgRating = reviewsAll.length > 0 ? (reviewsAll.reduce((s, r) => s + r.rating, 0) / reviewsAll.length).toFixed(1) : '—';
      const uniqueParticipants = new Set();
      const returnParticipants = new Set();
      myEvents.forEach(e => {
        (e.participants || []).forEach(p => {
          if (uniqueParticipants.has(p)) returnParticipants.add(p);
          uniqueParticipants.add(p);
        });
      });
      const returnRate = uniqueParticipants.size > 0 ? Math.round(returnParticipants.size / uniqueParticipants.size * 100) : 0;
      rolePanelHtml = `
        <div class="info-card">
          <div class="info-title">教練數據</div>
          <div class="profile-stats" style="grid-template-columns:repeat(3,1fr)">
            <div class="stat-item"><span class="stat-num">${hostedCount}</span><span class="stat-label">主辦活動</span></div>
            <div class="stat-item"><span class="stat-num">${avgRating}</span><span class="stat-label">平均評分</span></div>
            <div class="stat-item"><span class="stat-num">${returnRate}%</span><span class="stat-label">回頭率</span></div>
          </div>
        </div>`;
    } else if (role === 'venue_owner') {
      const myEvents = allEvents.filter(e => e.creator === (user.displayName || ''));
      const hostedCount = myEvents.length;
      const totalCapacity = myEvents.reduce((s, e) => s + (e.max || 0), 0);
      const totalFilled = myEvents.reduce((s, e) => s + (e.current || 0), 0);
      const utilization = totalCapacity > 0 ? Math.round(totalFilled / totalCapacity * 100) : 0;
      rolePanelHtml = `
        <div class="info-card">
          <div class="info-title">場主數據</div>
          <div class="profile-stats" style="grid-template-columns:repeat(2,1fr)">
            <div class="stat-item"><span class="stat-num">${hostedCount}</span><span class="stat-label">舉辦活動</span></div>
            <div class="stat-item"><span class="stat-num">${utilization}%</span><span class="stat-label">場地利用率</span></div>
          </div>
        </div>`;
    }

    container.innerHTML = `
      ${summaryHtml}
      ${rolePanelHtml}
      <div class="info-card">
        <div class="info-title">活躍度趨勢（近 12 週）</div>
        <canvas id="pd-chart-weekly" style="width:100%;display:block"></canvas>
      </div>
      <div class="info-card">
        <div class="info-title">月度參與趨勢</div>
        <canvas id="pd-chart-month" style="width:100%;display:block"></canvas>
      </div>
      <div class="info-card">
        <div class="info-title">活動類型偏好</div>
        <canvas id="pd-chart-type" style="width:100%;display:block"></canvas>
      </div>
      <div class="info-card">
        <div class="info-title">地區分布</div>
        ${regionHtml}
      </div>
    `;

    // Draw charts after DOM render
    requestAnimationFrame(() => {
      this._drawLineChart('pd-chart-weekly', weeklyData);
      this._drawBarChart('pd-chart-month', monthCounts);
      this._drawDonutChart('pd-chart-type', typeCounts, totalTyped || 1);
    });
  },

  /** 計算近 12 週每週活動參與數 */
  _calcWeeklyActivity(records) {
    const now = new Date();
    const weeks = [];
    for (let i = 11; i >= 0; i--) {
      const weekEnd = new Date(now);
      weekEnd.setDate(now.getDate() - i * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekEnd.getDate() - 6);
      weeks.push({ start: weekStart, end: weekEnd, label: `${weekStart.getMonth()+1}/${weekStart.getDate()}`, value: 0 });
    }
    const activeRecords = records.filter(r => r.status === 'completed' || r.status === 'registered');
    activeRecords.forEach(r => {
      // Try to parse record date
      const dp = (r.date || '').split('/');
      let recDate;
      if (dp.length === 2) {
        recDate = new Date(2026, parseInt(dp[0]) - 1, parseInt(dp[1]));
      } else if (dp.length === 3) {
        recDate = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]));
      }
      if (!recDate || isNaN(recDate)) return;
      for (const w of weeks) {
        if (recDate >= w.start && recDate <= w.end) { w.value++; break; }
      }
    });
    return weeks;
  },

});
