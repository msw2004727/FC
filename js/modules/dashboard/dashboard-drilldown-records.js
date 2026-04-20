/* ================================================
   SportHub — Admin Dashboard Drilldown: 報名紀錄詳情
   11 項指標（概覽 / 詳情 / 排行 三 Tab）
   依賴：dashboard-drilldown-core.js, dashboard-snapshot.js
   ================================================ */

Object.assign(App, {

  _renderDashDrillRecords() {
    const filtered = this._getFilteredDashSnapshot();
    if (!filtered) return;
    const regs = filtered.registrations || [];
    const users = filtered.users || [];
    const events = filtered.events || [];
    const teams = filtered.teams || [];
    const total = regs.length;

    const toMillis = (v) => {
      if (!v) return 0;
      if (typeof v.toMillis === 'function') return v.toMillis();
      if (v.seconds) return v.seconds * 1000;
      const t = new Date(v).getTime();
      return isNaN(t) ? 0 : t;
    };

    // 預建 uid → user, eventId → event
    const uidToUser = {};
    users.forEach(u => { if (u.uid) uidToUser[u.uid] = u; });
    const eidToEvent = {};
    events.forEach(e => { if (e.id) eidToEvent[e.id] = e; });
    const teamIdToName = {};
    teams.forEach(t => { teamIdToName[t.id || t._docId] = t.name || ''; });

    // ══════════ 概覽 Tab ══════════
    const renderOverview = () => {
      const statusCounts = { confirmed: 0, waitlisted: 0, cancelled: 0, completed: 0, removed: 0 };
      regs.forEach(r => { const s = r.status || 'confirmed'; if (statusCounts[s] != null) statusCounts[s]++; });
      const cancelRate = total > 0 ? Math.round(statusCounts.cancelled / total * 100) : 0;
      const completeRate = (statusCounts.confirmed + statusCounts.completed) > 0
        ? Math.round(statusCounts.completed / (statusCounts.confirmed + statusCounts.completed) * 100)
        : 0;

      const now = Date.now();
      const cutoff30 = now - 30 * 24 * 3600 * 1000;
      const recent30 = regs.filter(r => toMillis(r.registeredAt) >= cutoff30).length;

      const html = this._dashStatGrid([
        { num: total, label: '總報名數' },
        { num: cancelRate + '%', label: '取消率' },
        { num: completeRate + '%', label: '完成率' },
        { num: recent30, label: '近 30 天' },
      ]);
      const statusHtml = this._dashStatGrid([
        { num: statusCounts.confirmed, label: '已確認' },
        { num: statusCounts.waitlisted, label: '候補' },
        { num: statusCounts.completed, label: '已完成' },
        { num: statusCounts.cancelled, label: '已取消' },
      ]);
      return this._dashSection('總覽', html)
           + this._dashSection('狀態分布', statusHtml);
    };

    // ══════════ 詳情 Tab ══════════
    const renderDetail = () => {
      // 狀態分布（條列版，含 removed）
      const statusLabels = { 'confirmed': '已確認', 'waitlisted': '候補', 'completed': '已完成', 'cancelled': '已取消', 'removed': '已移除' };
      const statusCounts = {};
      regs.forEach(r => {
        const k = statusLabels[r.status] || r.status || '未知';
        statusCounts[k] = (statusCounts[k] || 0) + 1;
      });

      // 報名者角色
      const roleLabels = { super_admin: '超管', admin: '管理員', captain: '幹部', coach: '教練', venue_owner: '場地主', user: '一般用戶' };
      const roleCounts = {};
      regs.forEach(r => {
        const u = uidToUser[r.userId];
        const k = roleLabels[u?.role || 'user'] || '一般用戶';
        roleCounts[k] = (roleCounts[k] || 0) + 1;
      });

      // 報名時段（registeredAt 的小時）
      const slotGroups = { '早上（6-12）': 0, '下午（12-18）': 0, '晚上（18-24）': 0, '深夜（0-6）': 0, '未知': 0 };
      regs.forEach(r => {
        const ms = toMillis(r.registeredAt);
        if (!ms) { slotGroups['未知']++; return; }
        const h = new Date(ms).getHours();
        if (h >= 6 && h < 12) slotGroups['早上（6-12）']++;
        else if (h >= 12 && h < 18) slotGroups['下午（12-18）']++;
        else if (h >= 18) slotGroups['晚上（18-24）']++;
        else slotGroups['深夜（0-6）']++;
      });

      // 提前報名天數（registeredAt → event.date）
      const leadGroups = { '同日': 0, '1-3 天': 0, '4-7 天': 0, '8-14 天': 0, '14 天以上': 0, '未知': 0 };
      regs.forEach(r => {
        const ev = eidToEvent[r.eventId];
        if (!ev || !ev.date) { leadGroups['未知']++; return; }
        const eventMs = new Date(String(ev.date).replace(/\//g, '-')).getTime();
        const regMs = toMillis(r.registeredAt);
        if (!eventMs || !regMs) { leadGroups['未知']++; return; }
        const days = (eventMs - regMs) / (24 * 3600 * 1000);
        if (days < 1) leadGroups['同日']++;
        else if (days <= 3) leadGroups['1-3 天']++;
        else if (days <= 7) leadGroups['4-7 天']++;
        else if (days <= 14) leadGroups['8-14 天']++;
        else leadGroups['14 天以上']++;
      });

      // 同行者使用率
      const companion = regs.filter(r => r.participantType === 'companion').length;
      const companionRate = total > 0 ? Math.round(companion / total * 100) : 0;

      // 依活動類型偏好
      const typeLabels = { 'PLAY': 'PLAY', 'friendly': '友誼賽', 'class': '教學', 'spectate': '觀賽', 'external': '外部' };
      const typePref = {};
      regs.forEach(r => {
        const ev = eidToEvent[r.eventId];
        const k = typeLabels[ev?.type] || ev?.type || '未知';
        typePref[k] = (typePref[k] || 0) + 1;
      });

      // 依俱樂部分布（透過活動 creatorTeamIds）
      const teamPref = {};
      regs.forEach(r => {
        const ev = eidToEvent[r.eventId];
        const tids = Array.isArray(ev?.creatorTeamIds) ? ev.creatorTeamIds : [];
        if (tids.length === 0) {
          teamPref['（個人辦活動）'] = (teamPref['（個人辦活動）'] || 0) + 1;
        } else {
          tids.forEach(tid => {
            const name = teamIdToName[tid] || '（未知俱樂部）';
            teamPref[name] = (teamPref[name] || 0) + 1;
          });
        }
      });
      const topTeamPref = Object.entries(teamPref).sort((a, b) => b[1] - a[1]).slice(0, 10);

      return this._dashSection('狀態分布', this._dashBarList(Object.entries(statusCounts), total))
           + this._dashSection('報名者角色分布', this._dashBarList(Object.entries(roleCounts), total))
           + this._dashSection('報名時段分布', this._dashBarList(Object.entries(slotGroups), total))
           + this._dashSection('提前報名天數', this._dashBarList(Object.entries(leadGroups), total))
           + this._dashSection('同行者使用率', `<div class="dash-kv">同行者報名：<strong>${companion} / ${total}</strong>（${companionRate}%）</div>`)
           + this._dashSection('活動類型偏好', this._dashBarList(Object.entries(typePref), total))
           + this._dashSection('依俱樂部分布（前 10）', this._dashBarList(topTeamPref, total));
    };

    // ══════════ 排行 Tab ══════════
    const renderRanking = () => {
      // 活躍用戶 Top 10（報名最多次的）
      const uidCount = {};
      regs.forEach(r => {
        const uid = r.userId;
        if (!uid) return;
        if (!uidCount[uid]) uidCount[uid] = { uid, count: 0, name: uidToUser[uid]?.displayName || uidToUser[uid]?.name || '(未知)' };
        uidCount[uid].count++;
      });
      const topActive = Object.values(uidCount).sort((a, b) => b.count - a.count).slice(0, 10);

      // 重複報名用戶 Top 10（相同 userId + eventId 重複）
      const dedupKey = {};
      regs.forEach(r => {
        const key = `${r.userId}|${r.eventId}`;
        dedupKey[key] = (dedupKey[key] || 0) + 1;
      });
      const dupByUid = {};
      Object.entries(dedupKey).forEach(([key, c]) => {
        if (c < 2) return;
        const uid = key.split('|')[0];
        if (!dupByUid[uid]) dupByUid[uid] = { uid, count: 0, name: uidToUser[uid]?.displayName || uidToUser[uid]?.name || '(未知)' };
        dupByUid[uid].count += (c - 1);
      });
      const topDup = Object.values(dupByUid).sort((a, b) => b.count - a.count).slice(0, 10);

      const activeHtml = topActive.length > 0
        ? topActive.map((x, i) => `
          <div class="dash-rank-item" data-uid="${escapeHTML(x.uid)}" data-name="${escapeHTML(x.name)}">
            <span class="dash-rank-name">#${i + 1} ${escapeHTML(x.name)}</span>
            <span class="dash-rank-val">${x.count} 次報名</span>
          </div>`).join('')
        : '<div class="dash-empty">無資料</div>';

      const dupHtml = topDup.length > 0
        ? topDup.map((x, i) => `
          <div class="dash-rank-item" data-uid="${escapeHTML(x.uid)}" data-name="${escapeHTML(x.name)}">
            <span class="dash-rank-name">#${i + 1} ${escapeHTML(x.name)}</span>
            <span class="dash-rank-val">重複 ${x.count} 次</span>
          </div>`).join('')
        : '<div class="dash-empty">無重複報名紀錄</div>';

      return this._dashSection('活躍用戶 Top 10', activeHtml)
           + this._dashSection('重複報名用戶 Top 10', dupHtml);
    };

    this._renderDashDrillShell({
      title: '報名紀錄詳情',
      infoKey: 'records',
      tabs: [
        { key: 'overview', label: '概覽', render: renderOverview },
        { key: 'detail',   label: '詳情', render: renderDetail },
        { key: 'ranking',  label: '排行', render: renderRanking },
      ],
    });
    this._bindDashRankItemClicks?.();
  },

});
