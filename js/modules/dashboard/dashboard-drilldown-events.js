/* ================================================
   SportHub — Admin Dashboard Drilldown: 活動總數詳情
   15 項指標（概覽 / 詳情 / 排行 三 Tab）
   依賴：dashboard-drilldown-core.js, dashboard-snapshot.js
   ================================================ */

Object.assign(App, {

  _renderDashDrillEvents() {
    const filtered = this._getFilteredDashSnapshot();
    if (!filtered) return;
    const events = filtered.events || [];
    const total = events.length;

    const toMillis = (v) => {
      if (!v) return 0;
      if (typeof v.toMillis === 'function') return v.toMillis();
      if (v.seconds) return v.seconds * 1000;
      const t = new Date(v).getTime();
      return isNaN(t) ? 0 : t;
    };

    // ══════════ 概覽 Tab ══════════
    const renderOverview = () => {
      const now = Date.now();
      const cutoff30 = now - 30 * 24 * 3600 * 1000;
      const newIn30 = events.filter(e => toMillis(e.createdAt) >= cutoff30).length;
      let fillRateSum = 0, fillCount = 0;
      events.forEach(e => {
        if (e.max > 0) { fillRateSum += (e.current || 0) / e.max; fillCount++; }
      });
      const avgFillRate = fillCount > 0 ? Math.round(fillRateSum / fillCount * 100) : 0;
      const statusCounts = { open: 0, full: 0, ended: 0, cancelled: 0 };
      events.forEach(e => { const s = e.status || 'open'; if (statusCounts[s] != null) statusCounts[s]++; });

      const statGridHtml = this._dashStatGrid([
        { num: total, label: '活動總數' },
        { num: avgFillRate + '%', label: '平均填滿率' },
        { num: '+' + newIn30, label: '近 30 天新增' },
      ]);
      const statusHtml = this._dashStatGrid([
        { num: statusCounts.open, label: '開放中' },
        { num: statusCounts.full, label: '已滿' },
        { num: statusCounts.ended, label: '已結束' },
        { num: statusCounts.cancelled, label: '已取消' },
      ]);
      return this._dashSection('總覽', statGridHtml)
           + this._dashSection('狀態分布', statusHtml);
    };

    // ══════════ 詳情 Tab ══════════
    const renderDetail = () => {
      const typeLabels = { 'PLAY': 'PLAY', 'friendly': '友誼賽', 'class': '教學', 'spectate': '觀賽', 'external': '外部' };
      const typeCounts = {};
      events.forEach(e => { const k = typeLabels[e.type] || e.type || '未分類'; typeCounts[k] = (typeCounts[k] || 0) + 1; });

      const sportCounts = {};
      events.forEach(e => { const k = e.sport || '未分類'; sportCounts[k] = (sportCounts[k] || 0) + 1; });
      const topSports = Object.entries(sportCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

      const regionCounts = {};
      events.forEach(e => { const k = e.location || '未填'; regionCounts[k] = (regionCounts[k] || 0) + 1; });
      const topRegions = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

      // 個人辦 vs 俱樂部辦
      const byTeam = events.filter(e => Array.isArray(e.creatorTeamIds) && e.creatorTeamIds.length > 0).length;
      const byPerson = total - byTeam;

      // 旗標比例
      const pinned = events.filter(e => e.pinned === true).length;
      const privateCount = events.filter(e => e.privateEvent === true).length;
      const teamOnly = events.filter(e => e.teamOnly === true).length;
      const genderRestricted = events.filter(e => e.gender && e.gender !== 'all' && e.gender !== '').length;
      const blocklisted = events.filter(e => Array.isArray(e.blockedUids) && e.blockedUids.length > 0).length;

      // 平均瀏覽數（新欄位）
      let viewSum = 0, viewCount = 0;
      events.forEach(e => {
        if (typeof e.viewCount === 'number' && e.viewCount > 0) { viewSum += e.viewCount; viewCount++; }
      });
      const avgViews = viewCount > 0 ? Math.round(viewSum / viewCount) : 0;

      const flagHtml = `
        <div class="dash-kv">個人辦 vs 俱樂部辦：<strong>${byPerson}</strong> / <strong>${byTeam}</strong></div>
        <div class="dash-kv">置頂活動：<strong>${pinned}</strong></div>
        <div class="dash-kv">私密活動：<strong>${privateCount}</strong>（${total > 0 ? Math.round(privateCount / total * 100) : 0}%）</div>
        <div class="dash-kv">俱樂部限定：<strong>${teamOnly}</strong>（${total > 0 ? Math.round(teamOnly / total * 100) : 0}%）</div>
        <div class="dash-kv">性別限定：<strong>${genderRestricted}</strong></div>
        <div class="dash-kv">有黑名單的活動：<strong>${blocklisted}</strong></div>
      `;

      let html = this._dashSection('類型分布', this._dashBarList(Object.entries(typeCounts), total))
               + this._dashSection('運動分布（前 10）', this._dashBarList(topSports, total))
               + this._dashSection('地點分布（前 10）', this._dashBarList(topRegions, total))
               + this._dashSection('其他旗標', flagHtml);
      if (viewCount > 0) {
        html += this._dashSection('平均瀏覽數', `<div class="dash-kv">平均：<strong>${avgViews}</strong> 次（${viewCount}/${total} 活動有資料）</div>`, '資料累積中');
      }
      return html;
    };

    // ══════════ 排行 Tab ══════════
    const renderRanking = () => {
      // 主辦人排行 Top 10（以 creatorUid + creator 名）
      const creatorMap = {};
      events.forEach(e => {
        const uid = e.creatorUid || '';
        const name = e.creator || '(未知)';
        const key = uid || ('name:' + name);
        if (!creatorMap[key]) creatorMap[key] = { uid, name, count: 0 };
        creatorMap[key].count++;
      });
      const topCreators = Object.values(creatorMap).sort((a, b) => b.count - a.count).slice(0, 10);

      // 熱門地點 Top 10
      const locMap = {};
      events.forEach(e => { const l = e.location || '未填'; locMap[l] = (locMap[l] || 0) + 1; });
      const topLocs = Object.entries(locMap).sort((a, b) => b[1] - a[1]).slice(0, 10);

      // 置頂活動清單
      const pinnedList = events.filter(e => e.pinned === true).slice(0, 20);

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

      const pinnedHtml = pinnedList.length > 0
        ? pinnedList.map(e => `
          <div class="dash-rank-item" data-event-id="${escapeHTML(e.id || '')}">
            <span class="dash-rank-name">${escapeHTML(e.title || '(無標題)')}</span>
            <span class="dash-rank-val">${escapeHTML((e.date || '').split(' ')[0])}</span>
          </div>`).join('')
        : '<div class="dash-empty">無置頂活動</div>';

      return this._dashSection('主辦人排行 Top 10', creatorHtml)
           + this._dashSection('熱門地點 Top 10', locHtml)
           + this._dashSection('置頂活動清單', pinnedHtml);
    };

    this._renderDashDrillShell({
      title: '活動總數詳情',
      infoKey: 'events',
      tabs: [
        { key: 'overview', label: '概覽', render: renderOverview },
        { key: 'detail',   label: '詳情', render: renderDetail },
        { key: 'ranking',  label: '排行', render: renderRanking },
      ],
    });
    this._bindDashRankItemClicks();
    this._bindDashEventItemClicks();
  },

  /** 綁定 rank item 點擊 event → 開活動詳情 */
  _bindDashEventItemClicks() {
    const body = document.getElementById('dash-drill-body');
    if (!body || body.dataset.eventBound === '1') return;
    body.dataset.eventBound = '1';
    body.addEventListener('click', (e) => {
      const item = e.target.closest('.dash-rank-item[data-event-id]');
      if (!item) return;
      const eid = item.dataset.eventId;
      if (!eid) return;
      if (typeof this.showEventDetail === 'function') {
        this._closeDashDrilldown?.();
        this.showEventDetail(eid);
      }
    });
  },

});
