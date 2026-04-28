/* ================================================
   SportHub — Admin Dashboard Drilldown: 活躍俱樂部詳情
   12 項指標（概覽 / 詳情 / 排行 三 Tab）
   依賴：dashboard-drilldown-core.js, dashboard-snapshot.js
   ================================================ */

Object.assign(App, {

  _renderDashDrillTeams() {
    const filtered = this._getFilteredDashSnapshot();
    if (!filtered) return;
    const teams = filtered.teams || [];
    const events = filtered.events || [];
    const users = filtered.allUsers || filtered.users || [];

    const toMillis = (v) => {
      if (!v) return 0;
      if (typeof v.toMillis === 'function') return v.toMillis();
      if (v.seconds) return v.seconds * 1000;
      const t = new Date(v).getTime();
      return isNaN(t) ? 0 : t;
    };

    // 預建 uid→lastLogin Map（避免 O(n*m)）
    const uidLastLogin = {};
    users.forEach(u => { if (u.uid) uidLastLogin[u.uid] = toMillis(u.lastLogin); });

    // 預建 teamId→latestEventMs Map
    const teamLatestEvent = {};
    events.forEach(e => {
      const t = toMillis(e.createdAt);
      (e.creatorTeamIds || []).forEach(tid => {
        if (!tid) return;
        if (!teamLatestEvent[tid] || teamLatestEvent[tid] < t) teamLatestEvent[tid] = t;
      });
    });

    // 預建 teamId→activity event count Map
    const teamEventCount = {};
    events.forEach(e => {
      (e.creatorTeamIds || []).forEach(tid => {
        if (!tid) return;
        teamEventCount[tid] = (teamEventCount[tid] || 0) + 1;
      });
    });

    const now = Date.now();
    const cutoff30 = now - 30 * 24 * 3600 * 1000;
    const cutoff90 = now - 90 * 24 * 3600 * 1000;

    // ══════════ 概覽 Tab ══════════
    const renderOverview = () => {
      const totalTeams = teams.length;
      const activeTeams = teams.filter(t => t.active !== false).length;
      const newIn30 = teams.filter(t => toMillis(t.createdAt) >= cutoff30).length;
      const dormant = teams.filter(t => {
        const latest = teamLatestEvent[t.id || t._docId] || 0;
        return latest < cutoff90;
      }).length;

      const html = this._dashStatGrid([
        { num: totalTeams, label: '總俱樂部數' },
        { num: activeTeams, label: '活躍俱樂部' },
        { num: '+' + newIn30, label: '近 30 天新增' },
        { num: dormant, label: '沉寂俱樂部' },
      ]);
      return this._dashSection('總覽', html)
           + this._dashSection('說明', '<div class="dash-kv" style="font-size:.75rem;color:var(--text-muted)">沉寂俱樂部：近 90 天無新活動的俱樂部</div>');
    };

    // ══════════ 詳情 Tab ══════════
    const renderDetail = () => {
      // 規模分布
      const sizeGroups = { '< 5': 0, '5-10': 0, '11-20': 0, '21+': 0 };
      teams.forEach(t => {
        const size = (Array.isArray(t.memberUids) ? t.memberUids.length : 0) || (t.memberCount || 0);
        if (size < 5) sizeGroups['< 5']++;
        else if (size <= 10) sizeGroups['5-10']++;
        else if (size <= 20) sizeGroups['11-20']++;
        else sizeGroups['21+']++;
      });

      const sportCounts = {};
      teams.forEach(t => { const k = t.sport || '未分類'; sportCounts[k] = (sportCounts[k] || 0) + 1; });
      const topSports = Object.entries(sportCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

      const regionCounts = {};
      teams.forEach(t => { const k = t.region || '未填'; regionCounts[k] = (regionCounts[k] || 0) + 1; });
      const topRegions = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

      // 配置率
      const withCoach = teams.filter(t => Array.isArray(t.coachUids) && t.coachUids.length > 0).length;
      const withLeader = teams.filter(t => Array.isArray(t.leaderUids) && t.leaderUids.length > 0).length;
      const coachRate = teams.length > 0 ? Math.round(withCoach / teams.length * 100) : 0;
      const leaderRate = teams.length > 0 ? Math.round(withLeader / teams.length * 100) : 0;

      // 會員 30 天活躍度（O(n) with prebuilt map）
      let activeMemberSum = 0, totalMemberSum = 0;
      teams.forEach(t => {
        const members = Array.isArray(t.memberUids) ? t.memberUids : [];
        members.forEach(uid => {
          totalMemberSum++;
          if ((uidLastLogin[uid] || 0) >= cutoff30) activeMemberSum++;
        });
      });
      const memberActiveRate = totalMemberSum > 0 ? Math.round(activeMemberSum / totalMemberSum * 100) : 0;

      const metricsHtml = `
        <div class="dash-kv">教練配置率：<strong>${withCoach} / ${teams.length}</strong>（${coachRate}%）</div>
        <div class="dash-kv">幹部配置率：<strong>${withLeader} / ${teams.length}</strong>（${leaderRate}%）</div>
        <div class="dash-kv">會員 30 天活躍率：<strong>${activeMemberSum} / ${totalMemberSum}</strong>（${memberActiveRate}%）</div>
      `;

      return this._dashSection('規模分布', this._dashBarList(Object.entries(sizeGroups), teams.length))
           + this._dashSection('運動分布（前 10）', this._dashBarList(topSports, teams.length))
           + this._dashSection('地區分布（前 10）', this._dashBarList(topRegions, teams.length))
           + this._dashSection('配置率 / 活躍度', metricsHtml);
    };

    // ══════════ 排行 Tab ══════════
    const renderRanking = () => {
      const topExp = [...teams].sort((a, b) => (b.teamExp || 0) - (a.teamExp || 0)).slice(0, 10);
      const topByEvents = [...teams]
        .map(t => ({ ...t, eventCount: teamEventCount[t.id || t._docId] || 0 }))
        .filter(t => t.eventCount > 0)
        .sort((a, b) => b.eventCount - a.eventCount)
        .slice(0, 10);

      const dormantList = teams.filter(t => {
        const latest = teamLatestEvent[t.id || t._docId] || 0;
        return latest < cutoff90;
      }).slice(0, 20);

      const expHtml = topExp.length > 0
        ? topExp.map((t, i) => `
          <div class="dash-rank-item" data-team-id="${escapeHTML(t.id || t._docId || '')}">
            <span class="dash-rank-name">#${i + 1} ${escapeHTML(t.name || '(無名)')}</span>
            <span class="dash-rank-val">${(t.teamExp || 0).toLocaleString()} pts</span>
          </div>`).join('')
        : '<div class="dash-empty">無資料</div>';

      const eventsHtml = topByEvents.length > 0
        ? topByEvents.map((t, i) => `
          <div class="dash-rank-item" data-team-id="${escapeHTML(t.id || t._docId || '')}">
            <span class="dash-rank-name">#${i + 1} ${escapeHTML(t.name || '(無名)')}</span>
            <span class="dash-rank-val">${t.eventCount} 場</span>
          </div>`).join('')
        : '<div class="dash-empty">無資料</div>';

      const dormantHtml = dormantList.length > 0
        ? dormantList.map(t => `
          <div class="dash-rank-item" data-team-id="${escapeHTML(t.id || t._docId || '')}">
            <span class="dash-rank-name">${escapeHTML(t.name || '(無名)')}</span>
            <span class="dash-rank-val">沉寂中</span>
          </div>`).join('')
        : '<div class="dash-empty">目前無沉寂俱樂部</div>';

      return this._dashSection('積分排行 Top 10', expHtml)
           + this._dashSection('活動主辦排行 Top 10', eventsHtml)
           + this._dashSection('沉寂俱樂部清單（近 90 天無活動）', dormantHtml);
    };

    this._renderDashDrillShell({
      title: '活躍俱樂部詳情',
      infoKey: 'teams',
      tabs: [
        { key: 'overview', label: '概覽', render: renderOverview },
        { key: 'detail',   label: '詳情', render: renderDetail },
        { key: 'ranking',  label: '排行', render: renderRanking },
      ],
    });
    this._bindDashTeamItemClicks();
  },

  /** 綁定 team 項目點擊 → 開俱樂部詳情 */
  _bindDashTeamItemClicks() {
    const body = document.getElementById('dash-drill-body');
    if (!body || body.dataset.teamBound === '1') return;
    body.dataset.teamBound = '1';
    body.addEventListener('click', (e) => {
      const item = e.target.closest('.dash-rank-item[data-team-id]');
      if (!item) return;
      const tid = item.dataset.teamId;
      if (!tid) return;
      if (typeof this.showTeamDetail === 'function') {
        this._closeDashDrilldown?.();
        this.showTeamDetail(tid);
      }
    });
  },

});
