/* ================================================
   SportHub — Admin Dashboard Drilldown: 出席率詳情
   13 項指標（概覽 / 詳情 / 排行 三 Tab）
   依賴：dashboard-drilldown-core.js, dashboard-snapshot.js
   ================================================ */

Object.assign(App, {

  _renderDashDrillAttendance() {
    const filtered = this._getFilteredDashSnapshot();
    if (!filtered) return;
    const regs = filtered.registrations || [];
    const attRecs = filtered.attendanceRecords || [];
    const users = filtered.allUsers || filtered.users || [];
    const events = filtered.allEvents || filtered.events || [];

    const toMillis = (v) => {
      if (!v) return 0;
      if (typeof v.toMillis === 'function') return v.toMillis();
      if (v.seconds) return v.seconds * 1000;
      const t = new Date(v).getTime();
      return isNaN(t) ? 0 : t;
    };

    // 預建 map
    const uidToUser = {};
    users.forEach(u => { if (u.uid) uidToUser[u.uid] = u; });
    const eidToEvent = {};
    events.forEach(e => { if (e.id) eidToEvent[e.id] = e; });

    // 計算「簽到集合」：uid::eventId 有 checkin 且 status 正常
    const checkinSet = new Set();
    attRecs.forEach(r => {
      if (r.status === 'removed' || r.status === 'cancelled') return;
      if (r.type !== 'checkin') return;
      const uid = r.uid;
      const eid = r.eventId;
      if (uid && eid) checkinSet.add(`${uid}::${eid}`);
    });

    // 只看 confirmed 且活動已結束
    const completedRegs = regs.filter(r => {
      if (r.status !== 'confirmed' && r.status !== 'completed') return false;
      const ev = eidToEvent[r.eventId];
      return ev && (ev.status === 'ended' || ev.status === 'cancelled');
    });

    const calcAttendRate = (subRegs) => {
      if (subRegs.length === 0) return { rate: 0, attend: 0, total: 0 };
      let attend = 0;
      subRegs.forEach(r => {
        if (checkinSet.has(`${r.userId}::${r.eventId}`)) attend++;
      });
      return { rate: Math.round(attend / subRegs.length * 100), attend, total: subRegs.length };
    };

    // ══════════ 概覽 Tab ══════════
    const renderOverview = () => {
      const all = calcAttendRate(completedRegs);

      // 時段出席率（以 event.date 切分）
      const now = Date.now();
      const periodRate = (days) => {
        const cutoff = now - days * 24 * 3600 * 1000;
        const sub = completedRegs.filter(r => {
          const ev = eidToEvent[r.eventId];
          if (!ev || !ev.date) return false;
          return new Date(String(ev.date).replace(/\//g, '-')).getTime() >= cutoff;
        });
        return calcAttendRate(sub);
      };
      const r7 = periodRate(7);
      const r30 = periodRate(30);
      const r90 = periodRate(90);

      const html = this._dashStatGrid([
        { num: all.rate + '%', label: '全站出席率' },
        { num: r7.rate + '%', label: '近 7 天' },
        { num: r30.rate + '%', label: '近 30 天' },
        { num: r90.rate + '%', label: '近 90 天' },
      ]);
      return this._dashSection('總覽', html)
           + this._dashSection('說明', `<div class="dash-kv" style="font-size:.75rem;color:var(--text-muted)">出席率 = 已簽到 / 已確認報名（僅限已結束活動）<br>總樣本：${all.total} 筆</div>`);
    };

    // ══════════ 詳情 Tab ══════════
    const renderDetail = () => {
      // 依活動類型
      const typeLabels = { 'PLAY': 'PLAY', 'friendly': '友誼賽', 'class': '教學', 'spectate': '觀賽' };
      const byType = {};
      completedRegs.forEach(r => {
        const ev = eidToEvent[r.eventId];
        const k = typeLabels[ev?.type] || ev?.type || '未分類';
        if (!byType[k]) byType[k] = { attend: 0, total: 0 };
        byType[k].total++;
        if (checkinSet.has(`${r.userId}::${r.eventId}`)) byType[k].attend++;
      });
      const typeEntries = Object.entries(byType).map(([k, v]) => [k, v.total > 0 ? Math.round(v.attend / v.total * 100) : 0]);

      // 依運動
      const bySport = {};
      completedRegs.forEach(r => {
        const ev = eidToEvent[r.eventId];
        const k = ev?.sport || '未分類';
        if (!bySport[k]) bySport[k] = { attend: 0, total: 0 };
        bySport[k].total++;
        if (checkinSet.has(`${r.userId}::${r.eventId}`)) bySport[k].attend++;
      });
      const sportEntries = Object.entries(bySport)
        .map(([k, v]) => [k, v.total > 0 ? Math.round(v.attend / v.total * 100) : 0])
        .sort((a, b) => b[1] - a[1]).slice(0, 10);

      // 依地區
      const byRegion = {};
      completedRegs.forEach(r => {
        const ev = eidToEvent[r.eventId];
        const k = ev?.location || '未填';
        if (!byRegion[k]) byRegion[k] = { attend: 0, total: 0 };
        byRegion[k].total++;
        if (checkinSet.has(`${r.userId}::${r.eventId}`)) byRegion[k].attend++;
      });
      const regionEntries = Object.entries(byRegion)
        .filter(([, v]) => v.total >= 3)
        .map(([k, v]) => [k, Math.round(v.attend / v.total * 100)])
        .sort((a, b) => b[1] - a[1]).slice(0, 10);

      // 依用戶角色
      const roleLabels = { super_admin: '超管', admin: '管理員', captain: '幹部', coach: '教練', venue_owner: '場地主', user: '一般用戶' };
      const byRole = {};
      completedRegs.forEach(r => {
        const u = uidToUser[r.userId];
        const k = roleLabels[u?.role || 'user'] || '一般用戶';
        if (!byRole[k]) byRole[k] = { attend: 0, total: 0 };
        byRole[k].total++;
        if (checkinSet.has(`${r.userId}::${r.eventId}`)) byRole[k].attend++;
      });
      const roleEntries = Object.entries(byRole).map(([k, v]) => [k, v.total > 0 ? Math.round(v.attend / v.total * 100) : 0]);

      // 依星期幾
      const WEEK = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
      const byDay = {};
      WEEK.forEach(d => byDay[d] = { attend: 0, total: 0 });
      completedRegs.forEach(r => {
        const ev = eidToEvent[r.eventId];
        if (!ev || !ev.date) return;
        const d = new Date(String(ev.date).replace(/\//g, '-'));
        if (isNaN(d.getTime())) return;
        const k = WEEK[d.getDay()];
        byDay[k].total++;
        if (checkinSet.has(`${r.userId}::${r.eventId}`)) byDay[k].attend++;
      });
      const dayEntries = WEEK.map(d => [d, byDay[d].total > 0 ? Math.round(byDay[d].attend / byDay[d].total * 100) : 0]);

      // 依時段
      const bySlot = { '早上': { attend: 0, total: 0 }, '下午': { attend: 0, total: 0 }, '晚上': { attend: 0, total: 0 }, '深夜': { attend: 0, total: 0 } };
      completedRegs.forEach(r => {
        const ev = eidToEvent[r.eventId];
        if (!ev || !ev.date) return;
        const d = new Date(String(ev.date).replace(/\//g, '-'));
        if (isNaN(d.getTime())) return;
        const h = d.getHours();
        const k = (h >= 6 && h < 12) ? '早上' : (h >= 12 && h < 18) ? '下午' : (h >= 18) ? '晚上' : '深夜';
        bySlot[k].total++;
        if (checkinSet.has(`${r.userId}::${r.eventId}`)) bySlot[k].attend++;
      });
      const slotEntries = Object.entries(bySlot).map(([k, v]) => [k, v.total > 0 ? Math.round(v.attend / v.total * 100) : 0]);

      // 新手 vs 老手（註冊 < 30 天 vs > 30 天）
      const now = Date.now();
      const cutoff30days = 30 * 24 * 3600 * 1000;
      const byNewness = { '新手（註冊 < 30 天）': { attend: 0, total: 0 }, '老手（註冊 ≥ 30 天）': { attend: 0, total: 0 } };
      completedRegs.forEach(r => {
        const u = uidToUser[r.userId];
        if (!u) return;
        const createdMs = toMillis(u.createdAt);
        const age = now - createdMs;
        const k = (age > 0 && age < cutoff30days) ? '新手（註冊 < 30 天）' : '老手（註冊 ≥ 30 天）';
        byNewness[k].total++;
        if (checkinSet.has(`${r.userId}::${r.eventId}`)) byNewness[k].attend++;
      });
      const newnessEntries = Object.entries(byNewness).map(([k, v]) => [k, v.total > 0 ? Math.round(v.attend / v.total * 100) : 0]);

      // 出席率以「分數」顯示：用 bar list 的 v 當百分比（total=100 表「整體 vs 本分類」已在各列裡處理）
      // 為簡化：直接用 bar 顯示 0-100% 為 fill 百分比
      const renderRateBars = (entries) => entries.map(([k, pct]) => `
        <div class="dash-bar-row">
          <span class="dash-bar-label">${escapeHTML(String(k))}</span>
          <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%"></div></div>
          <span class="dash-bar-val">${pct}%</span>
        </div>
      `).join('');

      return this._dashSection('依類型出席率', renderRateBars(typeEntries))
           + this._dashSection('依運動出席率（前 10）', renderRateBars(sportEntries))
           + this._dashSection('依地區出席率（≥3 次樣本，前 10）', renderRateBars(regionEntries))
           + this._dashSection('依角色出席率', renderRateBars(roleEntries))
           + this._dashSection('依星期幾出席率', renderRateBars(dayEntries))
           + this._dashSection('依時段出席率', renderRateBars(slotEntries))
           + this._dashSection('新手 vs 老手', renderRateBars(newnessEntries));
    };

    // ══════════ 排行 Tab ══════════
    const renderRanking = () => {
      // 放鴿子前 10（noShowCount）
      const topNoShow = [...users]
        .filter(u => (u.noShowCount || 0) > 0)
        .sort((a, b) => (b.noShowCount || 0) - (a.noShowCount || 0))
        .slice(0, 10);

      // 全勤用戶（在 completedRegs 內 100% 出席且至少 3 次）
      const userAttend = {};
      completedRegs.forEach(r => {
        const uid = r.userId;
        if (!uid) return;
        if (!userAttend[uid]) userAttend[uid] = { attend: 0, total: 0 };
        userAttend[uid].total++;
        if (checkinSet.has(`${uid}::${r.eventId}`)) userAttend[uid].attend++;
      });
      const perfectUsers = Object.entries(userAttend)
        .filter(([, v]) => v.total >= 3 && v.attend === v.total)
        .map(([uid, v]) => ({ uid, count: v.total, user: uidToUser[uid] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // 放鴿子活動 Top 10（缺席率最高，且至少 3 人報名）
      const eventAttend = {};
      completedRegs.forEach(r => {
        const eid = r.eventId;
        if (!eid) return;
        if (!eventAttend[eid]) eventAttend[eid] = { attend: 0, total: 0, event: eidToEvent[eid] };
        eventAttend[eid].total++;
        if (checkinSet.has(`${r.userId}::${eid}`)) eventAttend[eid].attend++;
      });
      const worstEvents = Object.entries(eventAttend)
        .filter(([, v]) => v.total >= 3)
        .map(([eid, v]) => ({ eid, event: v.event, attendRate: v.total > 0 ? (v.attend / v.total) : 1, total: v.total }))
        .sort((a, b) => a.attendRate - b.attendRate)
        .slice(0, 10);

      const noShowHtml = topNoShow.length > 0
        ? topNoShow.map((u, i) => `
          <div class="dash-rank-item" data-uid="${escapeHTML(u.uid || '')}" data-name="${escapeHTML(u.displayName || u.name || '')}">
            <span class="dash-rank-name">#${i + 1} ${escapeHTML(u.displayName || u.name || '(無名)')}</span>
            <span class="dash-rank-val">${u.noShowCount} 次</span>
          </div>`).join('')
        : '<div class="dash-empty">無放鴿子紀錄</div>';

      const perfectHtml = perfectUsers.length > 0
        ? perfectUsers.map((x, i) => {
            const name = x.user?.displayName || x.user?.name || '(無名)';
            return `<div class="dash-rank-item" data-uid="${escapeHTML(x.uid)}" data-name="${escapeHTML(name)}">
              <span class="dash-rank-name">#${i + 1} ${escapeHTML(name)}</span>
              <span class="dash-rank-val">全勤 ${x.count} 場</span>
            </div>`;
          }).join('')
        : '<div class="dash-empty">尚無全勤用戶（需至少 3 場）</div>';

      const worstHtml = worstEvents.length > 0
        ? worstEvents.map((x, i) => {
            const title = x.event?.title || '(無標題)';
            return `<div class="dash-rank-item" data-event-id="${escapeHTML(x.eid)}">
              <span class="dash-rank-name">#${i + 1} ${escapeHTML(title)}</span>
              <span class="dash-rank-val">出席 ${Math.round(x.attendRate * 100)}% (${x.total} 人)</span>
            </div>`;
          }).join('')
        : '<div class="dash-empty">無資料</div>';

      return this._dashSection('放鴿子排行 Top 10', noShowHtml)
           + this._dashSection('全勤用戶榮譽榜 Top 10', perfectHtml)
           + this._dashSection('放鴿子活動 Top 10（缺席率高）', worstHtml);
    };

    this._renderDashDrillShell({
      title: '出席率詳情',
      infoKey: 'attendance',
      tabs: [
        { key: 'overview', label: '概覽', render: renderOverview },
        { key: 'detail',   label: '詳情', render: renderDetail },
        { key: 'ranking',  label: '排行', render: renderRanking },
      ],
    });
    this._bindDashRankItemClicks?.();
    this._bindDashEventItemClicks?.();
  },

});
