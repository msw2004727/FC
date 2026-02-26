/* ================================================
   SportHub — Event: Helpers, Hot Events, Activity List
   依賴：config.js, api-service.js
   ================================================ */

Object.assign(App, {

  _activityActiveTab: 'normal',

  switchActivityTab(tab) {
    this._activityActiveTab = tab;
    document.querySelectorAll('#activity-tabs .tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.atab === tab);
    });
    this.renderActivityList();
  },

  // ══════════════════════════════════
  //  Helpers
  // ══════════════════════════════════

  _getEventCreatorName() {
    if (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) {
      const profile = LineAuth.getProfile();
      if (profile && profile.displayName) return profile.displayName;
    }
    const user = ApiService.getCurrentUser?.() || null;
    if (user && user.displayName) return user.displayName;
    return ROLES[this.currentRole]?.label || '一般用戶';
  },

  _getEventCreatorUid() {
    const user = ApiService.getCurrentUser?.() || null;
    return user?.uid || 'unknown';
  },

  _getEventCreatorTeam() {
    const user = ApiService.getCurrentUser?.() || null;
    if (!user) return { teamId: null, teamName: null };
    // 優先從 currentUser 取
    if (user.teamId) return { teamId: user.teamId, teamName: user.teamName || null };
    // 從 adminUsers 查找（正式版 currentUser 可能沒有 teamId）
    const uid = user.uid || '';
    const name = user.displayName || user.name || '';
    const adminUsers = ApiService.getAdminUsers?.() || [];
    const match = adminUsers.find(u => (uid && u.uid === uid) || (name && u.name === name));
    if (match && match.teamId) return { teamId: match.teamId, teamName: match.teamName || null };
    return { teamId: null, teamName: null };
  },

  _getVisibleTeamIdsForLimitedEvents() {
    const ids = new Set();
    const user = ApiService.getCurrentUser?.() || null;
    if (!user) return ids;

    if (user.teamId) ids.add(user.teamId);
    // currentUser 可能尚未同步 teamId，補用 adminUsers 對照（與建立活動相同策略）
    const uid = user.uid || '';
    const name = user.displayName || user.name || '';
    const adminUsers = ApiService.getAdminUsers?.() || [];
    const match = adminUsers.find(u => (uid && u.uid === uid) || (name && u.name === name));
    if (match && match.teamId) ids.add(match.teamId);

    const myUid = user.uid || '';
    const myDocId = user._docId || '';
    const myNames = new Set([user.name, user.displayName].filter(Boolean));
    const teams = ApiService.getTeams?.() || [];

    teams.forEach(t => {
      if (!t || !t.id) return;
      const isManager =
        !!(t.captainUid && [myUid, myDocId].filter(Boolean).includes(t.captainUid)) ||
        !!(t.captain && myNames.has(t.captain));
      const isLeader =
        !!(t.leaderUid && [myUid, myDocId].filter(Boolean).includes(t.leaderUid)) ||
        !!(t.leader && myNames.has(t.leader));
      if (isManager || isLeader) ids.add(t.id);
    });

    return ids;
  },

  _isCurrentUserTeamStaff(teamId) {
    if (!teamId) return false;
    const user = ApiService.getCurrentUser?.() || null;
    if (!user) return false;
    const team = ApiService.getTeam?.(teamId);
    if (!team) return false;

    const myUid = user.uid || '';
    const myDocId = user._docId || '';
    const myNames = new Set([user.name, user.displayName].filter(Boolean));

    const isLeader =
      !!(team.leaderUid && [myUid, myDocId].filter(Boolean).includes(team.leaderUid)) ||
      !!(team.leader && myNames.has(team.leader));
    const isManager =
      !!(team.captainUid && [myUid, myDocId].filter(Boolean).includes(team.captainUid)) ||
      !!(team.captain && myNames.has(team.captain));
    const isCoach = (team.coaches || []).some(name => myNames.has(name));

    return isLeader || isManager || isCoach;
  },

  _canSignupTeamOnlyEvent(e) {
    if (!e || !e.teamOnly) return true;
    if (!e.creatorTeamId) return false;
    const teamIds = this._getVisibleTeamIdsForLimitedEvents();
    return teamIds.has(e.creatorTeamId);
  },

  _canViewEventByTeamScope(e) {
    if (!e) return false;
    if (!e.teamOnly) return true;
    if (this._isEventOwner(e)) return true;
    const myLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    if (myLevel >= ROLE_LEVEL_MAP.admin) return true;
    const teamIds = this._getVisibleTeamIdsForLimitedEvents();
    if (e.creatorTeamId && teamIds.has(e.creatorTeamId)) return true;
    return !!e.isPublic;
  },

  _canToggleEventPublic(e) {
    if (!e || !e.teamOnly) return false;
    const myLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    if (myLevel >= ROLE_LEVEL_MAP.admin) return true;
    return this._isEventOwner(e) || this._isCurrentUserTeamStaff(e.creatorTeamId);
  },

  /** 判斷當前用戶是否為該活動建立者 */
  _isEventOwner(e) {
    if (!e.creatorUid) {
      // 舊資料無 creatorUid，用 creator 名稱比對
      const name = this._getEventCreatorName();
      return e.creator === name;
    }
    return e.creatorUid === this._getEventCreatorUid();
  },

  /** 判斷活動是否額滿（正取滿即為額滿，候補無限） */
  _isEventTrulyFull(e) {
    return e.current >= e.max;
  },

  /** 判斷當前用戶是否為該活動委託人 */
  _isEventDelegate(e) {
    if (!e.delegates || !e.delegates.length) return false;
    const myUid = this._getEventCreatorUid();
    return e.delegates.some(d => d.uid === myUid);
  },

  /** 場主(含)以下只能管理自己的活動或受委託的活動，admin+ 可管理全部 */
  _canManageEvent(e) {
    const myLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    if (myLevel >= ROLE_LEVEL_MAP.admin) return true; // admin, super_admin
    return this._isEventOwner(e) || this._isEventDelegate(e);
  },

  /** 取得當前用戶可見的活動列表（過濾球隊限定） */
  _getVisibleEvents() {
    const all = ApiService.getEvents();
    return all.filter(e => this._canViewEventByTeamScope(e));
  },

  /** 解析活動日期字串，回傳開始時間的 Date 物件 */
  _parseEventStartDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split(' ');
    const dateParts = parts[0].split('/');
    if (dateParts.length < 3) return null;
    const y = parseInt(dateParts[0]);
    const m = parseInt(dateParts[1]) - 1;
    const d = parseInt(dateParts[2]);
    if (parts[1]) {
      const timePart = parts[1].split('~')[0];
      const [hh, mm] = timePart.split(':').map(Number);
      return new Date(y, m, d, hh || 0, mm || 0);
    }
    return new Date(y, m, d);
  },

  /** 計算倒數文字 */
  _calcCountdown(e) {
    if (e.status === 'ended') return '已結束';
    if (e.status === 'cancelled') return '已取消';
    if (e.status === 'upcoming' && e.regOpenTime) return '即將開放';
    const start = this._parseEventStartDate(e.date);
    if (!start) return '';
    const now = new Date();
    const diff = start - now;
    if (diff <= 0) return '已結束';
    const totalMin = Math.floor(diff / 60000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    if (days > 0) return `剩餘 ${days}日${hours}時`;
    if (hours > 0) return `剩餘 ${hours}時${mins}分`;
    return `剩餘 ${mins}分`;
  },

  /** 自動將過期的 open/full 活動改為 ended；報名時間到達的 upcoming 改為 open；人數達上限的 open 改為 full */
  _autoEndLastCheck: 0,
  _autoEndExpiredEvents() {
    const now = Date.now();
    if (now - this._autoEndLastCheck < 30000) return; // 30 秒內不重複檢查
    this._autoEndLastCheck = now;
    const nowDate = new Date();
    ApiService.getEvents().forEach(e => {
      // 已結束/已取消 → 跳過
      if (e.status === 'ended' || e.status === 'cancelled') return;
      // upcoming → open（報名時間已到）
      if (e.status === 'upcoming' && e.regOpenTime) {
        const regOpen = new Date(e.regOpenTime);
        if (regOpen <= nowDate) {
          ApiService.updateEvent(e.id, { status: 'open' });
        }
        return;
      }
      // open → full（人數已達上限）
      if (e.status === 'open' && e.current >= e.max) {
        ApiService.updateEvent(e.id, { status: 'full' });
      }
      if (e.status !== 'open' && e.status !== 'full') return;
      const start = this._parseEventStartDate(e.date);
      if (start && start <= nowDate) {
        ApiService.updateEvent(e.id, { status: 'ended' });
      }
    });
  },

  /** 判斷當前用戶是否已報名 */
  _isUserSignedUp(e) {
    const user = ApiService.getCurrentUser?.();
    if (!user) return false;
    const uid = user.uid || '';
    const name = user.displayName || user.name || '';

    // 優先查 registrations（demo + production 通用）
    const regs = ApiService.getRegistrationsByEvent?.(e.id) || [];
    if (regs.some(r => r.userId === uid && r.status !== 'cancelled' && r.status !== 'removed')) return true;

    // Fallback: 舊資料用 participants/waitlistNames
    const inParticipants = (e.participants || []).some(p => p === name || p === uid);
    const inWaitlist = (e.waitlistNames || []).some(p => p === name || p === uid);
    return inParticipants || inWaitlist;
  },

  /** 判斷當前用戶是否在候補名單中 */
  _isUserOnWaitlist(e) {
    const user = ApiService.getCurrentUser?.();
    if (!user) return false;
    const uid = user.uid || '';
    const name = user.displayName || user.name || '';

    // 優先查 registrations（demo + production 通用）
    const regs = ApiService.getRegistrationsByEvent?.(e.id) || [];
    if (regs.some(r => r.userId === uid && r.status === 'waitlisted')) return true;

    // Fallback: 舊資料
    return (e.waitlistNames || []).some(p => p === name || p === uid);
  },

  // ══════════════════════════════════
  //  Render: Hot Events
  // ══════════════════════════════════

  renderHotEvents() {
    this._autoEndExpiredEvents();
    const container = document.getElementById('hot-events');
    if (!container) return;
    // 顯示最近 10 場未結束活動（依日期排序）
    const visible = this._getVisibleEvents()
      .filter(e => e.status !== 'ended' && e.status !== 'cancelled')
      .sort((a, b) => {
        const ap = a?.pinned ? 1 : 0;
        const bp = b?.pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;
        if (ap && bp) {
          const ao = Number(a?.pinOrder) || 0;
          const bo = Number(b?.pinOrder) || 0;
          if (ao !== bo) return ao - bo;
        }
        const da = this._parseEventStartDate(a.date);
        const db = this._parseEventStartDate(b.date);
        return (da || 0) - (db || 0);
      })
      .slice(0, 10);

    container.innerHTML = visible.length > 0
      ? visible.map(e => `
        <div class="h-card" style="${e.pinned ? 'border:1px solid var(--warning);box-shadow:0 0 0 1px rgba(245,158,11,.15)' : ''}" onclick="App.showEventDetail('${e.id}')">
          ${e.image
            ? `<div class="h-card-img"><img src="${e.image}" alt="${escapeHTML(e.title)}" loading="lazy"></div>`
            : `<div class="h-card-img h-card-placeholder">220 × 90</div>`}
          <div class="h-card-body">
            <div class="h-card-title">${e.pinned ? '<span style="font-size:.62rem;padding:.08rem .35rem;border-radius:999px;border:1px solid var(--warning);color:var(--warning);font-weight:700;margin-right:.3rem">置頂</span>' : ''}${escapeHTML(e.title)}${e.teamOnly ? '<span class="tl-teamonly-badge">限定</span>' : ''}${(e.max > 0 && e.current >= e.max && e.status !== 'ended' && e.status !== 'cancelled') ? '<span class="tl-almost-full-badge">已額滿</span>' : ((e.status === 'open' && e.max > 0 && (e.max - e.current) / e.max < 0.2 && e.current < e.max) ? '<span class="tl-almost-full-badge">即將額滿</span>' : '')} ${this._favHeartHtml(this.isEventFavorited(e.id), 'Event', e.id)}</div>
            <div class="h-card-meta">
              <span>${escapeHTML(e.location)}</span>
              <span>${e.current}/${e.max}${t('activity.participants')}${(Number(e.waitlist) || 0) > 0 ? ' 候補' + (Number(e.waitlist) || 0) : ''}</span>
            </div>
          </div>
        </div>
      `).join('')
      : `<div style="padding:1rem;font-size:.82rem;color:var(--text-muted)">${t('activity.noActive')}</div>`;
  },

  // ══════════════════════════════════
  //  Render: Activity Timeline
  // ══════════════════════════════════

  renderActivityList() {
    this._autoEndExpiredEvents();
    const container = document.getElementById('activity-list');
    if (!container) return;

    // 篩選：類別 + 關鍵字
    const filterType = document.getElementById('activity-filter-type')?.value || '';
    const filterKw = (document.getElementById('activity-filter-keyword')?.value || '').trim().toLowerCase();

    let events = this._getVisibleEvents();

    // 頁簽篩選：一般 = 非已結束/已取消，已結束 = ended/cancelled
    const activeTab = this._activityActiveTab || 'normal';
    if (activeTab === 'ended') {
      events = events.filter(e => e.status === 'ended' || e.status === 'cancelled');
    } else {
      events = events.filter(e => e.status !== 'ended' && e.status !== 'cancelled');
    }

    if (filterType) events = events.filter(e => e.type === filterType);
    if (filterKw) events = events.filter(e =>
      (e.title || '').toLowerCase().includes(filterKw) ||
      (e.location || '').toLowerCase().includes(filterKw)
    );

    const monthGroups = {};
    events.forEach(e => {
      const parts = e.date.split(' ')[0].split('/');
      const monthKey = `${parts[0]}/${parts[1]}`;
      const day = parseInt(parts[2], 10);
      const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, day);
      const dayName = DAY_NAMES[dateObj.getDay()];

      if (!monthGroups[monthKey]) monthGroups[monthKey] = {};
      if (!monthGroups[monthKey][day]) {
        monthGroups[monthKey][day] = { day, dayName, dateObj, events: [] };
      }
      monthGroups[monthKey][day].events.push(e);
    });

    const today = new Date();
    const todayStr = `${today.getFullYear()}/${today.getMonth()+1}/${today.getDate()}`;

    const isEndedTab = activeTab === 'ended';
    let html = '';
    Object.keys(monthGroups).sort((a, b) => isEndedTab ? b.localeCompare(a) : a.localeCompare(b)).forEach(monthKey => {
      const [y, m] = monthKey.split('/');
      const monthLabel = `${y} 年 ${parseInt(m)} 月`;
      html += `<div class="tl-month-group">`;
      html += `<div class="tl-month-header">${monthLabel}</div>`;

      const days = Object.values(monthGroups[monthKey]).sort((a, b) => isEndedTab ? b.day - a.day : a.day - b.day);
      days.forEach(dayInfo => {
        const isToday = todayStr === `${y}/${parseInt(m)}/${dayInfo.day}`;
        html += `<div class="tl-day-group">`;
        html += `<div class="tl-date-col${isToday ? ' today' : ''}">
          <div class="tl-day-num">${dayInfo.day}</div>
          <div class="tl-day-name">週${dayInfo.dayName}</div>
        </div>`;
        html += `<div class="tl-events-col">`;

        // 同一天內依開始時間排序（越早越上面）
        dayInfo.events.sort((a, b) => {
          const ap = a?.pinned ? 1 : 0;
          const bp = b?.pinned ? 1 : 0;
          if (ap !== bp) return bp - ap;
          if (ap && bp) {
            const ao = Number(a?.pinOrder) || 0;
            const bo = Number(b?.pinOrder) || 0;
            if (ao !== bo) return ao - bo;
          }
          const ta = (a.date || '').split(' ')[1] || '';
          const tb = (b.date || '').split(' ')[1] || '';
          return isEndedTab ? tb.localeCompare(ta) : ta.localeCompare(tb);
        });

        dayInfo.events.forEach(e => {
          const typeConf = TYPE_CONFIG[e.type] || TYPE_CONFIG.friendly;
          const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
          const time = e.date.split(' ')[1] || '';
          const isEnded = e.status === 'ended' || e.status === 'cancelled';
          const waitlistTag = (e.waitlist || 0) > 0 ? ` · 候補(${e.waitlist})` : '';
          // 球隊限定用特殊色
          const rowClass = e.teamOnly ? 'tl-type-teamonly' : `tl-type-${e.type}`;
          const teamBadge = e.teamOnly ? `<span class="tl-teamonly-badge">${escapeHTML(e.creatorTeamName || '限定')}</span>` : '';

          html += `
            <div class="tl-event-row ${rowClass}${isEnded ? ' tl-past' : ''}" style="${e.pinned ? 'border:1px solid var(--warning);box-shadow:0 0 0 1px rgba(245,158,11,.12)' : ''}" onclick="App.showEventDetail('${e.id}')">
              ${e.image ? `<div class="tl-event-thumb"><img src="${e.image}" loading="lazy"></div>` : ''}
              <div class="tl-event-info">
                <div class="tl-event-title">${e.pinned ? '<span style="font-size:.62rem;padding:.08rem .35rem;border-radius:999px;border:1px solid var(--warning);color:var(--warning);font-weight:700;margin-right:.3rem">置頂</span>' : ''}${escapeHTML(e.title)}${teamBadge}${(e.max > 0 && e.current >= e.max && e.status !== 'ended' && e.status !== 'cancelled') ? '<span class="tl-almost-full-badge">已額滿</span>' : ((e.status === 'open' && e.max > 0 && (e.max - e.current) / e.max < 0.2 && e.current < e.max) ? '<span class="tl-almost-full-badge">即將額滿</span>' : '')}</div>
                <div class="tl-event-meta">${typeConf.label} · ${time} · ${escapeHTML(e.location.split('市')[1] || e.location)} · ${e.current}/${e.max}人${waitlistTag}</div>
              </div>
              <span class="tl-event-status ${statusConf.css}">${statusConf.label}</span>
              ${this._favHeartHtml(this.isEventFavorited(e.id), 'Event', e.id)}
              <span class="tl-event-arrow">›</span>
            </div>`;
        });

        html += `</div></div>`;
      });

      html += `</div>`;
    });

    container.innerHTML = html || `<div style="padding:1.5rem;font-size:.82rem;color:var(--text-muted);text-align:center">${t('activity.noMatch')}</div>`;
  },

  // ══════════════════════════════════
  //  Heat Prediction & Share
  // ══════════════════════════════════

  _renderHeatPrediction(e) {
    if (e.status === 'ended' || e.status === 'cancelled') return '';
    const pred = this._calcHeatPrediction(e);
    if (!pred) return '';
    const colors = { hot: '#dc2626', warm: '#f59e0b', normal: '#3b82f6', cold: '#6b7280' };
    const labels = { hot: '極熱門 — 預計快速額滿', warm: '熱門 — 報名踴躍', normal: '一般 — 正常報名中', cold: '冷門 — 名額充裕' };
    return `<div class="detail-row"><span class="detail-label">熱度</span><span style="color:${colors[pred]};font-weight:600">${labels[pred]}</span></div>`;
  },

  _calcHeatPrediction(e) {
    if (!e.max || e.max === 0) return null;
    const fillRate = e.current / e.max;
    const start = this._parseEventStartDate(e.date);
    if (!start) return fillRate >= 0.8 ? 'hot' : fillRate >= 0.5 ? 'warm' : 'normal';
    const now = new Date();
    const daysLeft = Math.max(0, (start - now) / 86400000);
    // High fill rate + lots of time left = very hot
    if (fillRate >= 0.9) return 'hot';
    if (fillRate >= 0.7 && daysLeft > 3) return 'hot';
    if (fillRate >= 0.5) return 'warm';
    if (fillRate >= 0.3 && daysLeft > 7) return 'warm';
    if (fillRate < 0.15 && daysLeft < 3) return 'cold';
    return 'normal';
  },

  shareEvent(eventId) {
    const e = ApiService.getEvent(eventId);
    if (!e) return;
    const url = `${location.origin}${location.pathname}?event=${eventId}`;
    const ageText = e.minAge > 0 ? `${e.minAge} 歲以上` : '無限制';
    const shareText = [
      `＜${e.title}＞`,
      `日期：${e.date || ''}`,
      `地點：${e.location || ''}`,
      `年齡：${ageText}`,
      url
    ].join('\n');
    if (navigator.share) {
      navigator.share({ text: shareText }).catch(() => {});
    } else {
      navigator.clipboard.writeText(shareText).then(() => {
        this.showToast('分享內容已複製到剪貼簿');
      }).catch(() => {
        this.showToast('複製失敗');
      });
    }
  },

});
