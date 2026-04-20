/* ================================================
   SportHub — Admin Dashboard Drilldown: 已結束活動詳情
   11 項指標（概覽 / 詳情 / 排行 三 Tab）
   依賴：dashboard-drilldown-core.js, dashboard-snapshot.js
   ================================================ */

Object.assign(App, {

  _renderDashDrillEndedEvents() {
    const filtered = this._getFilteredDashSnapshot();
    if (!filtered) return;
    const all = filtered.events || [];
    const events = all.filter(e => e.status === 'ended');
    const cancelled = all.filter(e => e.status === 'cancelled');
    const total = events.length;
    const attRecs = filtered.attendanceRecords || [];

    // 預建 eventId → attended count
    const attendByEvent = {};
    attRecs.forEach(r => {
      if (r.status === 'removed' || r.status === 'cancelled') return;
      if (r.type !== 'checkin') return;
      const eid = r.eventId;
      if (!eid) return;
      attendByEvent[eid] = (attendByEvent[eid] || 0) + 1;
    });

    // ══════════ 概覽 Tab ══════════
    const renderOverview = () => {
      let totalConfirmed = 0, totalAttended = 0;
      events.forEach(e => {
        totalConfirmed += (e.current || 0);
        totalAttended += (attendByEvent[e.id] || 0);
      });
      const avgAttendRate = totalConfirmed > 0 ? Math.round(totalAttended / totalConfirmed * 100) : 0;

      // 月份分布（近 6 個月）
      const monthCounts = {};
      events.forEach(e => {
        const d = e.date ? new Date(String(e.date).replace(/\//g, '-')) : null;
        if (!d || isNaN(d.getTime())) return;
        const key = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthCounts[key] = (monthCounts[key] || 0) + 1;
      });
      const sortedMonths = Object.entries(monthCounts).sort((a, b) => a[0].localeCompare(b[0])).slice(-6);

      const statsHtml = this._dashStatGrid([
        { num: total, label: '已結束活動' },
        { num: avgAttendRate + '%', label: '平均出席率' },
        { num: cancelled.length, label: '已取消活動' },
      ]);
      return this._dashSection('總覽', statsHtml)
           + this._dashSection('月份分布（近 6 個月）', this._dashBarList(sortedMonths, total));
    };

    // ══════════ 詳情 Tab ══════════
    const renderDetail = () => {
      // 出席率分布
      const attendGroups = { '0-50%': 0, '50-80%': 0, '80-100%': 0, '無簽到資料': 0 };
      events.forEach(e => {
        const confirmed = e.current || 0;
        if (confirmed <= 0) { attendGroups['無簽到資料']++; return; }
        const attended = attendByEvent[e.id] || 0;
        const rate = attended / confirmed;
        if (rate < 0.5) attendGroups['0-50%']++;
        else if (rate < 0.8) attendGroups['50-80%']++;
        else attendGroups['80-100%']++;
      });

      // 類型分布
      const typeLabels = { 'PLAY': 'PLAY', 'friendly': '友誼賽', 'class': '教學', 'spectate': '觀賽', 'external': '外部' };
      const typeCounts = {};
      events.forEach(e => { const k = typeLabels[e.type] || e.type || '未分類'; typeCounts[k] = (typeCounts[k] || 0) + 1; });

      // 運動分布
      const sportCounts = {};
      events.forEach(e => { const k = e.sport || '未分類'; sportCounts[k] = (sportCounts[k] || 0) + 1; });

      // 地區分布
      const regionCounts = {};
      events.forEach(e => { const k = e.location || '未填'; regionCounts[k] = (regionCounts[k] || 0) + 1; });
      const topRegions = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

      // 平均填滿率（已結束）
      let fillSum = 0, fillCount = 0;
      events.forEach(e => {
        if (e.max > 0) { fillSum += (e.current || 0) / e.max; fillCount++; }
      });
      const avgFill = fillCount > 0 ? Math.round(fillSum / fillCount * 100) : 0;

      // 放鴿子事件 & 超收事件
      const noShowEvents = events.filter(e => {
        const confirmed = e.current || 0;
        const attended = attendByEvent[e.id] || 0;
        return confirmed > 0 && attended < confirmed;
      }).length;
      const overfillEvents = events.filter(e => e.max > 0 && (e.current || 0) > e.max).length;

      return this._dashSection('出席率分布', this._dashBarList(Object.entries(attendGroups), total))
           + this._dashSection('類型分布', this._dashBarList(Object.entries(typeCounts), total))
           + this._dashSection('運動分布', this._dashBarList(Object.entries(sportCounts), total))
           + this._dashSection('地區分布（前 10）', this._dashBarList(topRegions, total))
           + this._dashSection('其他指標', `
               <div class="dash-kv">平均填滿率：<strong>${avgFill}%</strong></div>
               <div class="dash-kv">放鴿子事件（簽到 &lt; 確認）：<strong>${noShowEvents}</strong></div>
               <div class="dash-kv">超收事件（current &gt; max）：<strong>${overfillEvents}</strong></div>
               <div class="dash-kv">已取消活動：<strong>${cancelled.length}</strong></div>
             `);
    };

    // ══════════ 排行 Tab ══════════
    const renderRanking = () => {
      // 主辦人排行
      const creatorMap = {};
      events.forEach(e => {
        const uid = e.creatorUid || '';
        const name = e.creator || '(未知)';
        const key = uid || ('name:' + name);
        if (!creatorMap[key]) creatorMap[key] = { uid, name, count: 0 };
        creatorMap[key].count++;
      });
      const topCreators = Object.values(creatorMap).sort((a, b) => b.count - a.count).slice(0, 10);

      // 最熱門場地
      const locMap = {};
      events.forEach(e => { const l = e.location || '未填'; locMap[l] = (locMap[l] || 0) + 1; });
      const topLocs = Object.entries(locMap).sort((a, b) => b[1] - a[1]).slice(0, 10);

      // 重複舉辦（同 title 計數）
      const titleMap = {};
      events.forEach(e => { const t = e.title || '(無標題)'; titleMap[t] = (titleMap[t] || 0) + 1; });
      const repeatTitles = Object.entries(titleMap).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 10);

      const creatorHtml = topCreators.length > 0
        ? topCreators.map((c, i) => `
          <div class="dash-rank-item" data-uid="${escapeHTML(c.uid)}" data-name="${escapeHTML(c.name)}">
            <span class="dash-rank-name">#${i + 1} ${escapeHTML(c.name)}</span>
            <span class="dash-rank-val">${c.count} 場</span>
          </div>`).join('')
        : '<div class="dash-empty">無資料</div>';

      const locHtml = topLocs.length > 0
        ? topLocs.map(([l, c], i) => `
          <div class="dash-rank-item" style="cursor:default">
            <span class="dash-rank-name">#${i + 1} ${escapeHTML(l)}</span>
            <span class="dash-rank-val">${c} 場</span>
          </div>`).join('')
        : '<div class="dash-empty">無資料</div>';

      const repeatHtml = repeatTitles.length > 0
        ? repeatTitles.map(([t, c], i) => `
          <div class="dash-rank-item" style="cursor:default">
            <span class="dash-rank-name">#${i + 1} ${escapeHTML(t)}</span>
            <span class="dash-rank-val">${c} 次</span>
          </div>`).join('')
        : '<div class="dash-empty">無重複舉辦活動</div>';

      return this._dashSection('主辦人排行 Top 10', creatorHtml)
           + this._dashSection('最熱門場地 Top 10', locHtml)
           + this._dashSection('重複舉辦活動 Top 10', repeatHtml);
    };

    this._renderDashDrillShell({
      title: '已結束活動詳情',
      infoKey: 'endedEvents',
      tabs: [
        { key: 'overview', label: '概覽', render: renderOverview },
        { key: 'detail',   label: '詳情', render: renderDetail },
        { key: 'ranking',  label: '排行', render: renderRanking },
      ],
    });
    this._bindDashRankItemClicks?.();
  },

});
