/* ================================================
   SportHub — Admin Dashboard Drilldown: 進行中賽事詳情
   9 項指標（概覽 / 詳情 / 排行 三 Tab）
   依賴：dashboard-drilldown-core.js, dashboard-snapshot.js
   ================================================ */

Object.assign(App, {

  _renderDashDrillTournaments() {
    const filtered = this._getFilteredDashSnapshot();
    if (!filtered) return;
    const tournaments = filtered.tournaments || [];
    const teams = filtered.teams || [];
    const ongoing = tournaments.filter(t => !t.ended);

    const toMillis = (v) => {
      if (!v) return 0;
      if (typeof v.toMillis === 'function') return v.toMillis();
      if (v.seconds) return v.seconds * 1000;
      const t = new Date(v).getTime();
      return isNaN(t) ? 0 : t;
    };

    // teamId → teamName map
    const teamNameMap = {};
    teams.forEach(t => { teamNameMap[t.id || t._docId] = t.name || '(無名)'; });

    // ══════════ 概覽 Tab ══════════
    const renderOverview = () => {
      const now = Date.now();
      const cutoff30 = now - 30 * 24 * 3600 * 1000;
      const newIn30 = tournaments.filter(t => toMillis(t.createdAt) >= cutoff30).length;
      let teamCountSum = 0, teamCountItems = 0;
      ongoing.forEach(t => {
        const c = (Array.isArray(t.teams) ? t.teams.length : 0) || (t.teamCount || 0);
        if (c > 0) { teamCountSum += c; teamCountItems++; }
      });
      const avgTeams = teamCountItems > 0 ? Math.round(teamCountSum / teamCountItems * 10) / 10 : 0;

      const html = this._dashStatGrid([
        { num: ongoing.length, label: '進行中賽事' },
        { num: tournaments.length, label: '全部賽事' },
        { num: '+' + newIn30, label: '近 30 天新增' },
        { num: avgTeams, label: '平均隊伍數' },
      ]);
      return this._dashSection('總覽', html);
    };

    // ══════════ 詳情 Tab ══════════
    const renderDetail = () => {
      // 賽制
      const formatLabels = { 'league': '聯賽', 'cup': '盃賽', 'knockout': '淘汰賽', 'round_robin': '循環賽' };
      const formatCounts = {};
      ongoing.forEach(t => {
        const k = formatLabels[t.format] || t.format || '未分類';
        formatCounts[k] = (formatCounts[k] || 0) + 1;
      });

      // 運動
      const sportCounts = {};
      ongoing.forEach(t => { const k = t.sport || '未分類'; sportCounts[k] = (sportCounts[k] || 0) + 1; });

      // 隊伍數分布
      const teamSizeGroups = { '< 4': 0, '4-8': 0, '8+': 0 };
      ongoing.forEach(t => {
        const c = (Array.isArray(t.teams) ? t.teams.length : 0) || (t.teamCount || 0);
        if (c < 4) teamSizeGroups['< 4']++;
        else if (c <= 8) teamSizeGroups['4-8']++;
        else teamSizeGroups['8+']++;
      });

      // 剩餘天數
      const daysLeftGroups = { '今週（≤7 天）': 0, '本月（≤30 天）': 0, '30 天以上': 0, '未設定': 0 };
      const now = Date.now();
      ongoing.forEach(t => {
        const end = toMillis(t.endDate);
        if (!end) { daysLeftGroups['未設定']++; return; }
        const daysLeft = (end - now) / (24 * 3600 * 1000);
        if (daysLeft <= 7) daysLeftGroups['今週（≤7 天）']++;
        else if (daysLeft <= 30) daysLeftGroups['本月（≤30 天）']++;
        else daysLeftGroups['30 天以上']++;
      });

      // 委託人使用率
      const withDelegate = ongoing.filter(t => Array.isArray(t.delegateUids) && t.delegateUids.length > 0).length;
      const delegateRate = ongoing.length > 0 ? Math.round(withDelegate / ongoing.length * 100) : 0;

      return this._dashSection('賽制分布', this._dashBarList(Object.entries(formatCounts), ongoing.length))
           + this._dashSection('運動分布', this._dashBarList(Object.entries(sportCounts), ongoing.length))
           + this._dashSection('隊伍數分布', this._dashBarList(Object.entries(teamSizeGroups), ongoing.length))
           + this._dashSection('剩餘天數分布', this._dashBarList(Object.entries(daysLeftGroups), ongoing.length))
           + this._dashSection('委託人使用率', `<div class="dash-kv">有委託人：<strong>${withDelegate} / ${ongoing.length}</strong>（${delegateRate}%）</div>`);
    };

    // ══════════ 排行 Tab ══════════
    const renderRanking = () => {
      // 主辦俱樂部
      const hostMap = {};
      ongoing.forEach(t => {
        const tid = t.hostTeamId || '';
        if (!tid) return;
        if (!hostMap[tid]) hostMap[tid] = { tid, name: teamNameMap[tid] || '(未知)', count: 0 };
        hostMap[tid].count++;
      });
      const topHosts = Object.values(hostMap).sort((a, b) => b.count - a.count).slice(0, 10);

      // 熱門賽事 Top 5（依隊伍數）
      const hotTourns = [...ongoing]
        .map(t => ({ ...t, teamCount: (Array.isArray(t.teams) ? t.teams.length : 0) || (t.teamCount || 0) }))
        .sort((a, b) => b.teamCount - a.teamCount)
        .slice(0, 5);

      // 近 30 天結束賽事
      const now = Date.now();
      const cutoff30 = now - 30 * 24 * 3600 * 1000;
      const recentEnded = tournaments
        .filter(t => t.ended && toMillis(t.endDate) >= cutoff30)
        .slice(0, 10);

      const hostHtml = topHosts.length > 0
        ? topHosts.map((h, i) => `
          <div class="dash-rank-item" data-team-id="${escapeHTML(h.tid)}">
            <span class="dash-rank-name">#${i + 1} ${escapeHTML(h.name)}</span>
            <span class="dash-rank-val">${h.count} 場</span>
          </div>`).join('')
        : '<div class="dash-empty">無資料</div>';

      const hotHtml = hotTourns.length > 0
        ? hotTourns.map((t, i) => `
          <div class="dash-rank-item" style="cursor:default">
            <span class="dash-rank-name">#${i + 1} ${escapeHTML(t.name || '(無名)')}</span>
            <span class="dash-rank-val">${t.teamCount} 隊</span>
          </div>`).join('')
        : '<div class="dash-empty">無資料</div>';

      const recentHtml = recentEnded.length > 0
        ? recentEnded.map(t => `
          <div class="dash-rank-item" style="cursor:default">
            <span class="dash-rank-name">${escapeHTML(t.name || '(無名)')}</span>
            <span class="dash-rank-val">已結束</span>
          </div>`).join('')
        : '<div class="dash-empty">近 30 天無結束賽事</div>';

      return this._dashSection('主辦俱樂部 Top 10', hostHtml)
           + this._dashSection('熱門賽事 Top 5（依隊伍數）', hotHtml)
           + this._dashSection('近 30 天結束賽事', recentHtml);
    };

    this._renderDashDrillShell({
      title: '進行中賽事詳情',
      infoKey: 'tournaments',
      tabs: [
        { key: 'overview', label: '概覽', render: renderOverview },
        { key: 'detail',   label: '詳情', render: renderDetail },
        { key: 'ranking',  label: '排行', render: renderRanking },
      ],
    });
    this._bindDashTeamItemClicks?.();
  },

});
