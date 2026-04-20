/* ================================================
   SportHub — Admin Dashboard Drilldown: 開放中活動詳情
   12 項指標（概覽 / 詳情 / 排行 三 Tab）
   依賴：dashboard-drilldown-core.js, dashboard-snapshot.js
   ================================================ */

Object.assign(App, {

  _renderDashDrillOpenEvents() {
    const filtered = this._getFilteredDashSnapshot();
    if (!filtered) return;
    const all = filtered.events || [];
    const events = all.filter(e => e.status === 'open' || e.status === 'full');
    const total = events.length;

    // 解析活動開始時間（字串 "2026/04/20 18:00"）
    const parseStart = (e) => {
      if (!e || !e.date) return 0;
      const d = new Date(String(e.date).replace(/\//g, '-'));
      return isNaN(d.getTime()) ? 0 : d.getTime();
    };

    // ══════════ 概覽 Tab ══════════
    const renderOverview = () => {
      let fillSum = 0, fillCount = 0;
      events.forEach(e => {
        if (e.max > 0) { fillSum += (e.current || 0) / e.max; fillCount++; }
      });
      const avgFill = fillCount > 0 ? Math.round(fillSum / fillCount * 100) : 0;

      const now = Date.now();
      const timeGroups = { '今日': 0, '3 天內': 0, '7 天內': 0, '14 天以上': 0, '未設定': 0 };
      events.forEach(e => {
        const start = parseStart(e);
        if (!start) { timeGroups['未設定']++; return; }
        const days = (start - now) / (24 * 3600 * 1000);
        if (days < 1) timeGroups['今日']++;
        else if (days <= 3) timeGroups['3 天內']++;
        else if (days <= 7) timeGroups['7 天內']++;
        else timeGroups['14 天以上']++;
      });

      const html = this._dashStatGrid([
        { num: total, label: '開放中活動' },
        { num: avgFill + '%', label: '平均填滿率' },
        { num: timeGroups['今日'] + timeGroups['3 天內'], label: '3 天內' },
      ]);
      return this._dashSection('總覽', html)
           + this._dashSection('距開始時間分布', this._dashBarList(Object.entries(timeGroups), total));
    };

    // ══════════ 詳情 Tab ══════════
    const renderDetail = () => {
      // 填滿率分布
      const fillGroups = { '0-30%': 0, '30-70%': 0, '70-99%': 0, '100%（候補中）': 0 };
      events.forEach(e => {
        if (!e.max || e.max <= 0) return;
        const rate = (e.current || 0) / e.max;
        if (rate >= 1) fillGroups['100%（候補中）']++;
        else if (rate >= 0.7) fillGroups['70-99%']++;
        else if (rate >= 0.3) fillGroups['30-70%']++;
        else fillGroups['0-30%']++;
      });

      // 類型分布
      const typeLabels = { 'PLAY': 'PLAY', 'friendly': '友誼賽', 'class': '教學', 'spectate': '觀賽', 'external': '外部' };
      const typeCounts = {};
      events.forEach(e => { const k = typeLabels[e.type] || e.type || '未分類'; typeCounts[k] = (typeCounts[k] || 0) + 1; });

      // 運動分布
      const sportCounts = {};
      events.forEach(e => { const k = e.sport || '未分類'; sportCounts[k] = (sportCounts[k] || 0) + 1; });

      // 主辦類型
      const byTeam = events.filter(e => Array.isArray(e.creatorTeamIds) && e.creatorTeamIds.length > 0).length;
      const byPerson = total - byTeam;
      const hostTypeHtml = `
        <div class="dash-kv">個人主辦：<strong>${byPerson}</strong>（${total > 0 ? Math.round(byPerson / total * 100) : 0}%）</div>
        <div class="dash-kv">俱樂部主辦：<strong>${byTeam}</strong>（${total > 0 ? Math.round(byTeam / total * 100) : 0}%）</div>
      `;

      // 區域熱度
      const regionCounts = {};
      events.forEach(e => { const k = e.location || '未填'; regionCounts[k] = (regionCounts[k] || 0) + 1; });
      const topRegions = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

      // 時段分布（早/午/晚）
      const timeSlotGroups = { '早上（6-12）': 0, '下午（12-18）': 0, '晚上（18-24）': 0, '未設定': 0 };
      events.forEach(e => {
        const d = e.date ? new Date(String(e.date).replace(/\//g, '-')) : null;
        if (!d || isNaN(d.getTime())) { timeSlotGroups['未設定']++; return; }
        const h = d.getHours();
        if (h >= 6 && h < 12) timeSlotGroups['早上（6-12）']++;
        else if (h >= 12 && h < 18) timeSlotGroups['下午（12-18）']++;
        else if (h >= 18) timeSlotGroups['晚上（18-24）']++;
        else timeSlotGroups['未設定']++;
      });

      // 星期幾
      const WEEK = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
      const weekCounts = {};
      events.forEach(e => {
        const d = e.date ? new Date(String(e.date).replace(/\//g, '-')) : null;
        if (!d || isNaN(d.getTime())) return;
        const w = WEEK[d.getDay()];
        weekCounts[w] = (weekCounts[w] || 0) + 1;
      });
      const weekEntries = WEEK.map(w => [w, weekCounts[w] || 0]);

      // 候補壓力（waitlist > 0）
      const withWait = events.filter(e => (e.waitlist || 0) > 0).length;

      return this._dashSection('填滿率分布', this._dashBarList(Object.entries(fillGroups), total))
           + this._dashSection('類型分布', this._dashBarList(Object.entries(typeCounts), total))
           + this._dashSection('運動分布', this._dashBarList(Object.entries(sportCounts), total))
           + this._dashSection('主辦類型', hostTypeHtml)
           + this._dashSection('區域熱度（前 10）', this._dashBarList(topRegions, total))
           + this._dashSection('時段分布', this._dashBarList(Object.entries(timeSlotGroups), total))
           + this._dashSection('星期幾分布', this._dashBarList(weekEntries, total))
           + this._dashSection('候補壓力', `<div class="dash-kv">有候補名單：<strong>${withWait} / ${total}</strong>（${total > 0 ? Math.round(withWait / total * 100) : 0}%）</div>`);
    };

    // ══════════ 排行 Tab ══════════
    const renderRanking = () => {
      // 熱度 Top 10（current/max）
      const hotList = [...events]
        .filter(e => e.max > 0)
        .map(e => ({ ...e, rate: (e.current || 0) / e.max }))
        .sort((a, b) => b.rate - a.rate)
        .slice(0, 10);

      // 瀏覽數 Top 10
      const viewList = [...events]
        .filter(e => typeof e.viewCount === 'number' && e.viewCount > 0)
        .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
        .slice(0, 10);

      // 冷門搶救（3 天內開始 & 填滿率 < 30%）
      const now = Date.now();
      const cold = events.filter(e => {
        if (!e.max || e.max <= 0) return false;
        const start = parseStart(e);
        if (!start) return false;
        const days = (start - now) / (24 * 3600 * 1000);
        const rate = (e.current || 0) / e.max;
        return days <= 3 && days >= 0 && rate < 0.3;
      });

      const hotHtml = hotList.length > 0
        ? hotList.map((e, i) => `
          <div class="dash-rank-item" data-event-id="${escapeHTML(e.id || '')}">
            <span class="dash-rank-name">#${i + 1} ${escapeHTML(e.title || '(無標題)')}</span>
            <span class="dash-rank-val">${Math.round(e.rate * 100)}% (${e.current}/${e.max})</span>
          </div>`).join('')
        : '<div class="dash-empty">無資料</div>';

      const viewHtml = viewList.length > 0
        ? viewList.map((e, i) => `
          <div class="dash-rank-item" data-event-id="${escapeHTML(e.id || '')}">
            <span class="dash-rank-name">#${i + 1} ${escapeHTML(e.title || '(無標題)')}</span>
            <span class="dash-rank-val">👁 ${e.viewCount}</span>
          </div>`).join('')
        : '<div class="dash-empty">尚無瀏覽數資料（新指標）</div>';

      const coldHtml = cold.length > 0
        ? cold.map(e => `
          <div class="dash-rank-item" data-event-id="${escapeHTML(e.id || '')}">
            <span class="dash-rank-name">${escapeHTML(e.title || '(無標題)')}</span>
            <span class="dash-rank-val">${e.current}/${e.max}</span>
          </div>`).join('')
        : '<div class="dash-empty">無冷門活動</div>';

      let html = this._dashSection('熱度 Top 10', hotHtml);
      html += this._dashSection('瀏覽數 Top 10', viewHtml, '資料累積中');
      html += this._dashSection('冷門搶救名單（3 天內開始 &amp; 填滿率 &lt; 30%）', coldHtml);
      return html;
    };

    this._renderDashDrillShell({
      title: '開放中活動詳情',
      tabs: [
        { key: 'overview', label: '概覽', render: renderOverview },
        { key: 'detail',   label: '詳情', render: renderDetail },
        { key: 'ranking',  label: '排行', render: renderRanking },
      ],
    });
    this._bindDashEventItemClicks?.();
  },

});
