/* ================================================
   SportHub — Event: Helpers & Rendering
   依賴：config.js, data.js, api-service.js
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
    const user = ApiService.getCurrentUser?.() || null;
    const myTeamId = user?.teamId || null;
    const myLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    return all.filter(e => {
      if (!e.teamOnly) return true;
      // admin+ 可看全部
      if (myLevel >= ROLE_LEVEL_MAP.admin) return true;
      // 球隊限定：只有同隊可見
      return e.creatorTeamId && e.creatorTeamId === myTeamId;
    });
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

    // Production 模式：用 registrations 的 userId 比對（最可靠）
    if (!ModeManager.isDemo() && uid) {
      const regs = FirebaseService._cache.registrations || [];
      return regs.some(r => r.eventId === e.id && r.userId === uid && r.status !== 'cancelled');
    }

    // Demo 模式：名單比對
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

    // Production 模式
    if (!ModeManager.isDemo() && uid) {
      const regs = FirebaseService._cache.registrations || [];
      return regs.some(r => r.eventId === e.id && r.userId === uid && r.status === 'waitlisted');
    }

    // Demo 模式
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
        const da = this._parseEventStartDate(a.date);
        const db = this._parseEventStartDate(b.date);
        return (da || 0) - (db || 0);
      })
      .slice(0, 10);

    // ── 已渲染且數量相同 → 跳過，避免封面圖重載 ──
    const existingCards = container.querySelectorAll('.h-card:not(.skeleton)');
    if (existingCards.length > 0 && existingCards.length === visible.length) return;

    container.innerHTML = visible.length > 0
      ? visible.map(e => `
        <div class="h-card" onclick="App.showEventDetail('${e.id}')">
          ${e.image
            ? `<div class="h-card-img"><img src="${e.image}" alt="${escapeHTML(e.title)}" loading="lazy"></div>`
            : `<div class="h-card-img h-card-placeholder">220 × 90</div>`}
          <div class="h-card-body">
            <div class="h-card-title">${escapeHTML(e.title)}${e.teamOnly ? '<span class="tl-teamonly-badge">限定</span>' : ''}${(e.status === 'open' && e.max > 0 && (e.max - e.current) / e.max < 0.1 && e.current < e.max) ? '<span class="tl-almost-full-badge">即將額滿</span>' : ''} ${this._favHeartHtml(this.isEventFavorited(e.id), 'Event', e.id)}</div>
            <div class="h-card-meta">
              <span>${escapeHTML(e.location.split('市')[0])}市</span>
              <span>${e.current}/${e.max} ${t('activity.participants')}</span>
            </div>
          </div>
        </div>
      `).join('')
      : (!App._firebaseConnected && !ModeManager.isDemo())
        ? [1, 2, 3].map(() => `
          <div class="h-card">
            <div class="h-card-img skeleton"></div>
            <div class="h-card-body">
              <div class="skeleton skeleton-line" style="width:70%"></div>
              <div class="skeleton skeleton-line" style="width:90%"></div>
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

    let html = '';
    Object.keys(monthGroups).sort().forEach(monthKey => {
      const [y, m] = monthKey.split('/');
      const monthLabel = `${y} 年 ${parseInt(m)} 月`;
      html += `<div class="tl-month-group">`;
      html += `<div class="tl-month-header">${monthLabel}</div>`;

      const days = Object.values(monthGroups[monthKey]).sort((a, b) => a.day - b.day);
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
          const ta = (a.date || '').split(' ')[1] || '';
          const tb = (b.date || '').split(' ')[1] || '';
          return ta.localeCompare(tb);
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
            <div class="tl-event-row ${rowClass}${isEnded ? ' tl-past' : ''}" onclick="App.showEventDetail('${e.id}')">
              ${e.image ? `<div class="tl-event-thumb"><img src="${e.image}" loading="lazy"></div>` : ''}
              <div class="tl-event-info">
                <div class="tl-event-title">${escapeHTML(e.title)}${teamBadge}${(e.status === 'open' && e.max > 0 && (e.max - e.current) / e.max < 0.1 && e.current < e.max) ? '<span class="tl-almost-full-badge">即將額滿</span>' : ''}</div>
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
  //  Show Event Detail
  // ══════════════════════════════════

  showEventDetail(id) {
    if (this._requireLogin()) return;
    const e = ApiService.getEvent(id);
    if (!e) return;
    const detailImg = document.getElementById('detail-img-placeholder');
    if (detailImg) {
      if (e.image) {
        detailImg.innerHTML = `<img src="${e.image}" alt="${escapeHTML(e.title)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)">`;
        detailImg.style.border = 'none';
      } else {
        detailImg.textContent = '活動圖片 800 × 300';
        detailImg.style.border = '';
      }
    }
    document.getElementById('detail-title').innerHTML = escapeHTML(e.title) + ' ' + this._favHeartHtml(this.isEventFavorited(id), 'Event', id);

    const countdown = this._calcCountdown(e);
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`;
    const locationHtml = `<a href="${mapUrl}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none">${escapeHTML(e.location)} 📍</a>`;

    const isEnded = e.status === 'ended' || e.status === 'cancelled';
    const isUpcoming = e.status === 'upcoming';
    const isMainFull = e.current >= e.max;
    const isSignedUp = this._isUserSignedUp(e);
    const isOnWaitlist = isSignedUp && this._isUserOnWaitlist(e);
    let signupBtn = '';
    if (isUpcoming) {
      signupBtn = `<button style="background:#64748b;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed" disabled>報名尚未開放</button>`;
    } else if (isEnded) {
      signupBtn = `<button style="background:#333;color:#999;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed" disabled>已結束</button>`;
    } else if (isOnWaitlist) {
      signupBtn = `<button style="background:#7c3aed;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer" onclick="App.handleCancelSignup('${e.id}')">取消候補</button>`;
    } else if (isSignedUp) {
      signupBtn = `<button style="background:#dc2626;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer" onclick="App.handleCancelSignup('${e.id}')">取消報名</button>`;
    } else if (isMainFull) {
      signupBtn = `<button style="background:#7c3aed;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer" onclick="App.handleSignup('${e.id}')">報名候補</button>`;
    } else {
      signupBtn = `<button class="primary-btn" onclick="App.handleSignup('${e.id}')">立即報名</button>`;
    }

    const teamTag = e.teamOnly ? `<div class="detail-row"><span class="detail-label">限定</span><span style="color:#e11d48;font-weight:600">${escapeHTML(e.creatorTeamName || '球隊')} 專屬活動</span></div>` : '';

    // 開放報名時間顯示
    let regOpenHtml = '';
    if (e.regOpenTime) {
      const regDate = new Date(e.regOpenTime);
      const regStr = `${regDate.getFullYear()}/${String(regDate.getMonth()+1).padStart(2,'0')}/${String(regDate.getDate()).padStart(2,'0')} ${String(regDate.getHours()).padStart(2,'0')}:${String(regDate.getMinutes()).padStart(2,'0')}`;
      if (isUpcoming) {
        const diff = regDate - new Date();
        const totalMin = Math.max(0, Math.floor(diff / 60000));
        const days = Math.floor(totalMin / 1440);
        const hours = Math.floor((totalMin % 1440) / 60);
        const countdownTxt = days > 0 ? `${days}日${hours}時後開放` : hours > 0 ? `${hours}時${totalMin % 60}分後開放` : `${totalMin}分後開放`;
        regOpenHtml = `<div class="detail-row"><span class="detail-label">開放報名</span><span style="color:var(--info);font-weight:600">${regStr}（${countdownTxt}）</span></div>`;
      } else {
        regOpenHtml = `<div class="detail-row"><span class="detail-label">開放報名</span>${regStr}（已開放）</div>`;
      }
    }

    document.getElementById('detail-body').innerHTML = `
      <div class="detail-row"><span class="detail-label">地點</span>${locationHtml}</div>
      <div class="detail-row"><span class="detail-label">時間</span>${escapeHTML(e.date)}</div>
      ${regOpenHtml}
      <div class="detail-row"><span class="detail-label">費用</span>${e.fee > 0 ? '$'+e.fee : '免費'}</div>
      <div class="detail-row"><span class="detail-label">人數</span>已報 ${e.current}/${e.max}${(e.waitlist || 0) > 0 ? '　候補 ' + e.waitlist : ''}</div>
      <div class="detail-row"><span class="detail-label">年齡</span>${e.minAge > 0 ? e.minAge + ' 歲以上' : '無限制'}</div>
      <div class="detail-row"><span class="detail-label">主辦</span><span class="participant-list" style="display:inline-flex;gap:.3rem;flex-wrap:wrap">${this._userTag(e.creator)}</span></div>
      ${(e.delegates && e.delegates.length) ? `<div class="detail-row"><span class="detail-label">委託</span><span class="participant-list" style="display:inline-flex;gap:.3rem;flex-wrap:wrap">${e.delegates.map(d => this._userTag(d.name)).join('')}</span></div>` : ''}
      ${e.contact ? `<div class="detail-row"><span class="detail-label">聯繫</span>${escapeHTML(e.contact)}</div>` : ''}
      ${teamTag}
      <div class="detail-row"><span class="detail-label">倒數</span><span style="color:${isEnded ? 'var(--text-muted)' : 'var(--primary)' };font-weight:600">${countdown}</span></div>
      ${this._renderHeatPrediction(e)}
      ${e.notes ? `
      <div class="detail-section">
        <div class="detail-section-title">注意事項</div>
        <p style="font-size:.85rem;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap">${escapeHTML(e.notes)}</p>
      </div>` : ''}
      <div style="display:flex;gap:.5rem;margin:1rem 0;flex-wrap:wrap">
        ${signupBtn}
        <button class="outline-btn" onclick="App.showUserProfile('${escapeHTML(e.creator)}')">聯繫主辦人</button>
        <button class="outline-btn" onclick="App.shareEvent('${e.id}')">分享活動</button>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">報名名單 (${e.current})</div>
        <div class="participant-list">${(e.participants || []).map(p => this._userTag(p)).join('')}</div>
      </div>
      ${(e.waitlistNames || []).length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">候補名單 (${e.waitlist})</div>
        <div class="participant-list">${e.waitlistNames.map((p, i) => `<span class="wl-pos">${i + 1}</span>${this._userTag(p)}`).join('')}</div>
      </div>` : ''}
      ${this._renderReviews(e)}
    `;
    this.showPage('page-activity-detail');
  },

  // ══════════════════════════════════
  //  Event Reviews
  // ══════════════════════════════════

  _reviewRating: 0,

  _renderStars(rating, interactive) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      const filled = i <= rating;
      if (interactive) {
        html += `<span class="review-star${filled ? ' active' : ''}" onclick="App._setReviewRating(${i})" style="cursor:pointer;font-size:1.3rem;color:${filled ? '#f59e0b' : 'var(--border)'};transition:color .15s">★</span>`;
      } else {
        html += `<span style="color:${filled ? '#f59e0b' : 'var(--border)'};font-size:.85rem">★</span>`;
      }
    }
    return html;
  },

  _setReviewRating(n) {
    this._reviewRating = n;
    const container = document.getElementById('review-stars-input');
    if (container) container.innerHTML = this._renderStars(n, true);
  },

  _renderReviews(e) {
    const reviews = e.reviews || [];
    const isEnded = e.status === 'ended';
    const user = ApiService.getCurrentUser?.();
    const uid = user?.uid || '';
    const name = user?.displayName || user?.name || '';
    const isParticipant = (e.participants || []).some(p => p === name || p === uid);
    const hasReviewed = reviews.some(r => r.uid === uid);

    // Calculate average
    let avgHtml = '';
    if (reviews.length > 0) {
      const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
      avgHtml = `<div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem">
        <span style="font-size:1.3rem;font-weight:800;color:#f59e0b">${avg.toFixed(1)}</span>
        ${this._renderStars(Math.round(avg), false)}
        <span style="font-size:.75rem;color:var(--text-muted)">(${reviews.length} 則評價)</span>
      </div>`;
    }

    // Review list
    const listHtml = reviews.map(r => `
      <div style="padding:.5rem 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
          ${this._userTag(r.name)}
          <span style="margin-left:auto">${this._renderStars(r.rating, false)}</span>
        </div>
        ${r.text ? `<div style="font-size:.82rem;color:var(--text-secondary);line-height:1.5;margin-top:.2rem">${escapeHTML(r.text)}</div>` : ''}
        <div style="font-size:.68rem;color:var(--text-muted);margin-top:.15rem">${escapeHTML(r.time)}</div>
      </div>
    `).join('');

    // Review form (only for ended events, participants who haven't reviewed)
    let formHtml = '';
    if (isEnded && isParticipant && !hasReviewed) {
      this._reviewRating = 0;
      formHtml = `
        <div style="border:1px solid var(--border);border-radius:var(--radius);padding:.6rem;margin-top:.5rem;background:var(--bg-elevated)">
          <div style="font-size:.82rem;font-weight:600;margin-bottom:.3rem">撰寫評價</div>
          <div id="review-stars-input" style="margin-bottom:.3rem">${this._renderStars(0, true)}</div>
          <textarea id="review-text" rows="2" maxlength="50" placeholder="分享您的心得（最多 50 字）" style="width:100%;font-size:.82rem;padding:.3rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);resize:none;box-sizing:border-box"></textarea>
          <button class="primary-btn small" style="margin-top:.3rem" onclick="App.submitReview('${e.id}')">送出評價</button>
        </div>`;
    }

    return `
      <div class="detail-section">
        <div class="detail-section-title">活動評價</div>
        ${avgHtml}
        ${listHtml || '<div style="font-size:.82rem;color:var(--text-muted)">尚無評價</div>'}
        ${formHtml}
      </div>`;
  },

  submitReview(eventId) {
    const e = ApiService.getEvent(eventId);
    if (!e) return;
    if (this._reviewRating < 1) { this.showToast('請選擇星數'); return; }
    const text = (document.getElementById('review-text')?.value || '').trim();
    if (text.length > 50) { this.showToast('評語不可超過 50 字'); return; }
    const user = ApiService.getCurrentUser?.();
    const uid = user?.uid || '';
    const name = user?.displayName || user?.name || '';
    if (!e.reviews) e.reviews = [];
    if (e.reviews.some(r => r.uid === uid)) { this.showToast('您已評價過此活動'); return; }
    const now = new Date();
    const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    e.reviews.push({ uid, name, rating: this._reviewRating, text, time: timeStr });
    this._reviewRating = 0;
    this._grantAutoExp(uid, 'submit_review', e.title);
    this.showToast('評價已送出！');
    this.showEventDetail(eventId);
  },

  /** 恢復報名時移除該活動的取消紀錄（恢復報名則不列為取消） */
  _removeCancelRecordOnResignup(eventId, uid) {
    const source = ApiService._src('activityRecords');
    for (let i = source.length - 1; i >= 0; i--) {
      if (source[i].eventId === eventId && source[i].uid === uid && source[i].status === 'cancelled') {
        if (!ModeManager.isDemo() && source[i]._docId) {
          db.collection('activityRecords').doc(source[i]._docId).delete()
            .catch(err => console.error('[removeCancelRecord]', err));
        }
        source.splice(i, 1);
      }
    }
  },

  handleSignup(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (e.status === 'upcoming') { this.showToast('報名尚未開放，請稍後再試'); return; }

    // 有同行者 → 顯示選人 Modal
    const companions = ApiService.getCompanions();
    if (companions.length > 0) {
      this._openCompanionSelectModal(id);
      return;
    }

    const user = ApiService.getCurrentUser();
    const userName = user?.displayName || user?.name || '用戶';
    const userId = user?.uid || 'unknown';

    // 恢復報名 → 移除之前的取消紀錄
    this._removeCancelRecordOnResignup(id, userId);

    if (ApiService._demoMode) {
      // 檢查是否已報名
      if (this._isUserSignedUp(e)) {
        this.showToast('您已報名此活動');
        return;
      }
      const isWaitlist = e.current >= e.max;
      if (isWaitlist) {
        if (!e.waitlistNames) e.waitlistNames = [];
        if (!e.waitlistNames.includes(userName)) e.waitlistNames.push(userName);
        e.waitlist = (e.waitlist || 0) + 1;
        // 安全移除：確保不在正取名單
        const pi = (e.participants || []).indexOf(userName);
        if (pi >= 0) { e.participants.splice(pi, 1); e.current = Math.max(0, e.current - 1); }
      } else {
        if (!e.participants) e.participants = [];
        if (!e.participants.includes(userName)) e.participants.push(userName);
        e.current++;
        // 安全移除：確保不在候補名單
        const wi = (e.waitlistNames || []).indexOf(userName);
        if (wi >= 0) { e.waitlistNames.splice(wi, 1); e.waitlist = Math.max(0, (e.waitlist || 0) - 1); }
      }
      // 正取滿即標記為 full
      if (e.current >= e.max) e.status = 'full';
      // 寫入報名紀錄
      const dateParts = e.date.split(' ')[0].split('/');
      const dateStr = `${dateParts[1]}/${dateParts[2]}`;
      ApiService.addActivityRecord({
        eventId: e.id,
        name: e.title,
        date: dateStr,
        status: isWaitlist ? 'waitlisted' : 'registered',
        uid: userId,
      });
      this.showToast(isWaitlist ? '已加入候補名單' : '報名成功！');
      if (!isWaitlist) this._grantAutoExp(userId, 'register_activity', e.title);
      // Trigger 2：報名成功通知
      this._sendNotifFromTemplate('signup_success', {
        eventName: e.title, date: e.date, location: e.location,
        status: isWaitlist ? '候補' : '正取',
      }, userId, 'activity', '活動');
      this.showEventDetail(id);
      return;
    }

    FirebaseService.registerForEvent(id, userId, userName)
      .then(result => {
        const dateParts = e.date.split(' ')[0].split('/');
        const dateStr = `${dateParts[1]}/${dateParts[2]}`;
        ApiService.addActivityRecord({
          eventId: e.id,
          name: e.title,
          date: dateStr,
          status: result.status === 'waitlisted' ? 'waitlisted' : 'registered',
          uid: userId,
        });
        // 同步寫入 Firestore activityRecords
        db.collection('activityRecords').add({
          eventId: e.id, name: e.title, date: dateStr,
          status: result.status === 'waitlisted' ? 'waitlisted' : 'registered',
          uid: userId,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(err => console.error('[activityRecord]', err));
        // Trigger 2：報名成功通知
        this._sendNotifFromTemplate('signup_success', {
          eventName: e.title, date: e.date, location: e.location,
          status: result.status === 'waitlisted' ? '候補' : '正取',
        }, userId, 'activity', '活動');
        this.showToast(result.status === 'waitlisted' ? '已加入候補名單' : '報名成功！');
        this.showEventDetail(id);
      })
      .catch(err => {
        console.error('[handleSignup]', err);
        this.showToast(err.message || '報名失敗，請稍後再試');
      });
  },

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
    const shareData = { title: e.title, text: `${e.title} — ${e.date} @ ${e.location}`, url };
    if (navigator.share) {
      navigator.share(shareData).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        this.showToast('分享連結已複製到剪貼簿');
      }).catch(() => {
        this.showToast('無法複製連結');
      });
    }
  },

  async handleCancelSignup(id) {
    // 有多筆報名（含同行者）→ 顯示取消選擇 Modal
    const myRegs = ApiService.getMyRegistrationsByEvent(id);
    if (myRegs.length > 1) {
      this._openCompanionCancelModal(id, myRegs);
      return;
    }

    const e0 = ApiService.getEvent(id);
    const isWaitlist = e0 && this._isUserOnWaitlist(e0);
    const confirmMsg = isWaitlist ? '確定要取消候補？' : '確定要取消報名？';
    if (!await this.appConfirm(confirmMsg)) return;
    const user = ApiService.getCurrentUser();
    const userName = user?.displayName || user?.name || '用戶';
    const userId = user?.uid || 'unknown';

    if (ApiService._demoMode) {
      const e = ApiService.getEvent(id);
      if (e) {
        const pi = (e.participants || []).indexOf(userName);
        if (pi !== -1) {
          e.participants.splice(pi, 1);
          e.current = Math.max(0, e.current - 1);
          if (e.waitlistNames && e.waitlistNames.length > 0) {
            const promoted = e.waitlistNames.shift();
            e.waitlist = Math.max(0, e.waitlist - 1);
            // 確保遞補者不會重複出現在正取名單
            if (!e.participants.includes(promoted)) {
              e.participants.push(promoted);
              e.current++;
            }
            // Trigger 3：候補遞補通知
            const adminUsers = ApiService.getAdminUsers();
            const promotedUser = adminUsers.find(u => u.name === promoted);
            if (promotedUser) {
              this._sendNotifFromTemplate('waitlist_promoted', {
                eventName: e.title, date: e.date, location: e.location,
              }, promotedUser.uid, 'activity', '活動');
            }
          }
          e.status = e.current >= e.max ? 'full' : 'open';
        } else {
          const wi = (e.waitlistNames || []).indexOf(userName);
          if (wi !== -1) {
            e.waitlistNames.splice(wi, 1);
            e.waitlist = Math.max(0, e.waitlist - 1);
          }
        }
        // 更新報名紀錄：移除 registered/waitlisted 紀錄，確保只留一筆取消紀錄
        const records = ApiService.getActivityRecords();
        const hasCancelRecord = records.some(r => r.eventId === id && r.uid === userId && r.status === 'cancelled');
        // 移除現有的非取消紀錄
        for (let i = records.length - 1; i >= 0; i--) {
          if (records[i].eventId === id && records[i].uid === userId && records[i].status !== 'cancelled') {
            records.splice(i, 1);
          }
        }
        // 若尚無取消紀錄，新增一筆
        if (!hasCancelRecord) {
          const dateParts = e.date.split(' ')[0].split('/');
          const dateStr = `${dateParts[1]}/${dateParts[2]}`;
          ApiService.addActivityRecord({ eventId: id, name: e.title, date: dateStr, status: 'cancelled', uid: userId });
        }
      }
      this.showToast(isWaitlist ? '已取消候補' : '已取消報名');
      if (!isWaitlist) this._grantAutoExp(userId, 'cancel_registration', e.title);
      this.showEventDetail(id);
      return;
    }

    // 正式版：從 registrations 快取找到該筆報名紀錄，呼叫 cancelRegistration
    const reg = FirebaseService._cache.registrations.find(
      r => r.eventId === id && r.userId === userId && r.status !== 'cancelled'
    );
    if (reg) {
      FirebaseService.cancelRegistration(reg.id)
        .then((cancelledReg) => {
          // Trigger 3：候補遞補通知（Firebase 模式）
          if (cancelledReg && cancelledReg._promotedUserId) {
            const ev = ApiService.getEvent(id);
            if (ev) {
              this._sendNotifFromTemplate('waitlist_promoted', {
                eventName: ev.title, date: ev.date, location: ev.location,
              }, cancelledReg._promotedUserId, 'activity', '活動');
            }
          }
          // 更新 activityRecords：移除 registered/waitlisted，確保只留一筆取消紀錄
          const records = ApiService.getActivityRecords();
          const hasCancelRec = records.some(r => r.eventId === id && r.uid === userId && r.status === 'cancelled');
          for (let i = records.length - 1; i >= 0; i--) {
            if (records[i].eventId === id && records[i].uid === userId && records[i].status !== 'cancelled') {
              if (records[i]._docId) {
                db.collection('activityRecords').doc(records[i]._docId).update({ status: 'cancelled' })
                  .catch(err => console.error('[activityRecord cancel]', err));
              }
              if (hasCancelRec) {
                // 已有取消紀錄，直接移除此筆
                if (records[i]._docId) {
                  db.collection('activityRecords').doc(records[i]._docId).delete().catch(err => console.error('[activityRecord dedup]', err));
                }
                records.splice(i, 1);
              } else {
                records[i].status = 'cancelled';
              }
            }
          }
          if (!hasCancelRec && !records.some(r => r.eventId === id && r.uid === userId && r.status === 'cancelled')) {
            const ev = ApiService.getEvent(id);
            if (ev) {
              const dp = ev.date.split(' ')[0].split('/');
              ApiService.addActivityRecord({ eventId: id, name: ev.title, date: `${dp[1]}/${dp[2]}`, status: 'cancelled', uid: userId });
            }
          }
          this.showToast(isWaitlist ? '已取消候補' : '已取消報名');
          this.showEventDetail(id);
        })
        .catch(err => { console.error('[cancelSignup]', err); this.showToast('取消失敗：' + (err.message || '')); });
    } else {
      // 如果 registrations 沒找到，嘗試直接從 event participants 移除
      const e = ApiService.getEvent(id);
      if (e) {
        const pi = (e.participants || []).indexOf(userName);
        if (pi !== -1) {
          e.participants.splice(pi, 1);
          e.current = Math.max(0, e.current - 1);
          if (e._docId) {
            db.collection('events').doc(e._docId).update({
              current: e.current, participants: e.participants,
            }).catch(err => console.error('[cancelSignup fallback]', err));
          }
        }
      }
      this.showToast(isWaitlist ? '已取消候補' : '已取消報名');
      this.showEventDetail(id);
    }
  },

  // ── 同行者選擇報名 Modal ──

  _companionSelectEventId: null,

  _openCompanionSelectModal(eventId) {
    const e = ApiService.getEvent(eventId);
    if (!e) return;
    this._companionSelectEventId = eventId;
    const overlay = document.getElementById('companion-select-overlay');
    if (!overlay) return;

    const user = ApiService.getCurrentUser();
    const userName = user?.displayName || user?.name || '用戶';
    const companions = ApiService.getCompanions();
    const remaining = Math.max(0, e.max - e.current);
    const feeLabel = e.fee > 0 ? `費用：NT$${e.fee}/人` : '免費';

    const infoEl = document.getElementById('companion-select-event-info');
    if (infoEl) infoEl.innerHTML = `<b>${escapeHTML(e.title)}</b><br>${feeLabel}　剩餘名額：${remaining}/${e.max}`;

    // 已報名者（不可再勾選）
    const myRegs = ApiService.getMyRegistrationsByEvent(eventId);
    const registeredCompanionIds = new Set(myRegs.map(r => r.companionId).filter(Boolean));
    const isSelfRegistered = myRegs.some(r => !r.companionId);

    const listEl = document.getElementById('companion-select-list');
    if (!listEl) return;
    const selfDisabled = isSelfRegistered ? 'disabled checked' : '';
    const selfLabel = isSelfRegistered ? '（已報名）' : '';
    listEl.innerHTML = `
      <label style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" name="cs-participant" value="self" data-name="${escapeHTML(userName)}" ${selfDisabled} style="width:16px;height:16px" onchange="App._updateCompanionSelectSummary('${eventId}')">
        <span style="font-size:.85rem;font-weight:600">👤 ${escapeHTML(userName)}（本人）${selfLabel}</span>
      </label>
      ${companions.map(c => {
        const alreadyReg = registeredCompanionIds.has(c.id);
        const dis = alreadyReg ? 'disabled checked' : '';
        const lbl = alreadyReg ? '（已報名）' : '';
        return `<label style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border);cursor:pointer">
          <input type="checkbox" name="cs-participant" value="companion" data-companion-id="${escapeHTML(c.id)}" data-name="${escapeHTML(c.name)}" ${dis} style="width:16px;height:16px" onchange="App._updateCompanionSelectSummary('${eventId}')">
          <span style="font-size:.85rem">${escapeHTML(c.name)}${c.gender ? `（${escapeHTML(c.gender)}）` : ''}${c.notes ? ` — <span style="color:var(--text-muted)">${escapeHTML(c.notes)}</span>` : ''}${lbl}</span>
        </label>`;
      }).join('')}
    `;

    this._updateCompanionSelectSummary(eventId);
    overlay.style.display = 'flex';
    overlay.classList.add('open');
  },

  _updateCompanionSelectSummary(eventId) {
    const e = ApiService.getEvent(eventId);
    const checkboxes = document.querySelectorAll('#companion-select-list input[name="cs-participant"]:not([disabled])');
    let selected = 0;
    checkboxes.forEach(cb => { if (cb.checked) selected++; });
    const fee = e?.fee || 0;
    const remaining = Math.max(0, (e?.max || 0) - (e?.current || 0));
    const summaryEl = document.getElementById('companion-select-summary');
    if (summaryEl) {
      summaryEl.innerHTML = `<span>已選 <b>${selected}</b> 人</span>${fee > 0 ? `<span>預計費用 <b>NT$${fee * selected}</b></span>` : ''}<span>剩餘名額 <b>${remaining}</b></span>`;
    }
    const confirmBtn = document.getElementById('companion-select-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = selected === 0;
  },

  _closeCompanionSelectModal() {
    const overlay = document.getElementById('companion-select-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.classList.remove('open');
    this._companionSelectEventId = null;
  },

  async _confirmCompanionRegister() {
    const eventId = this._companionSelectEventId;
    if (!eventId) return;
    const e = ApiService.getEvent(eventId);
    if (!e) return;

    const checkboxes = document.querySelectorAll('#companion-select-list input[name="cs-participant"]:not([disabled]):checked');
    if (checkboxes.length === 0) { this.showToast('請至少選擇一位參與者'); return; }

    const user = ApiService.getCurrentUser();
    const userId = user?.uid || 'unknown';
    const participantList = [];
    checkboxes.forEach(cb => {
      if (cb.value === 'self') {
        participantList.push({ type: 'self' });
      } else {
        participantList.push({ type: 'companion', companionId: cb.dataset.companionId, companionName: cb.dataset.name });
      }
    });

    this._closeCompanionSelectModal();

    try {
      const result = await ApiService.registerEventWithCompanions(eventId, participantList);
      const regCount = (result.registered || []).length + (result.confirmed || 0);
      const wlCount = (result.waitlisted || []).length + (result.waitlisted || 0);
      const total = participantList.length;

      // 寫入 activityRecords（只紀錄本人）
      const selfSelected = participantList.find(p => p.type === 'self');
      if (selfSelected) {
        const dateParts = e.date.split(' ')[0].split('/');
        const dateStr = `${dateParts[1]}/${dateParts[2]}`;
        const isWl = e.current > e.max;
        ApiService.addActivityRecord({
          eventId: e.id, name: e.title, date: dateStr,
          status: isWl ? 'waitlisted' : 'registered', uid: userId,
        });
        if (!isWl) this._grantAutoExp(userId, 'register_activity', e.title);
      }

      const wlMsg = wlCount > 0 ? `（${wlCount} 人候補）` : '';
      this.showToast(`共 ${total} 人報名成功${wlMsg}`);
      this.showEventDetail(eventId);
    } catch (err) {
      console.error('[_confirmCompanionRegister]', err);
      this.showToast(err.message || '報名失敗，請稍後再試');
    }
  },

  // ── 同行者取消報名 Modal ──

  _companionCancelEventId: null,
  _companionCancelRegs: [],

  _openCompanionCancelModal(eventId, myRegs) {
    this._companionCancelEventId = eventId;
    this._companionCancelRegs = myRegs;
    const overlay = document.getElementById('companion-cancel-overlay');
    if (!overlay) return;
    const e = ApiService.getEvent(eventId);
    const titleEl = document.getElementById('companion-cancel-title');
    if (titleEl && e) titleEl.textContent = `取消報名 — ${e.title}`;
    const listEl = document.getElementById('companion-cancel-list');
    if (!listEl) return;
    const statusLabel = { confirmed: '正取', waitlisted: '候補' };
    listEl.innerHTML = myRegs.map(r => {
      const displayName = r.companionName || r.userName;
      const tag = statusLabel[r.status] || r.status;
      const tagColor = r.status === 'confirmed' ? 'var(--success)' : 'var(--warning)';
      return `<label style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" name="cc-reg" value="${escapeHTML(r.id)}" checked style="width:16px;height:16px">
        <span style="flex:1;font-size:.85rem">${escapeHTML(displayName)}${r.companionId ? '' : '（本人）'}</span>
        <span style="font-size:.72rem;padding:.1rem .3rem;border-radius:3px;background:${tagColor}22;color:${tagColor}">${tag}</span>
      </label>`;
    }).join('');
    overlay.style.display = 'flex';
    overlay.classList.add('open');
  },

  _selectAllCancelRegs() {
    document.querySelectorAll('#companion-cancel-list input[name="cc-reg"]').forEach(cb => { cb.checked = true; });
  },

  _closeCompanionCancelModal() {
    const overlay = document.getElementById('companion-cancel-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.classList.remove('open');
    this._companionCancelEventId = null;
    this._companionCancelRegs = [];
  },

  async _confirmCompanionCancel() {
    const eventId = this._companionCancelEventId;
    const checked = [...document.querySelectorAll('#companion-cancel-list input[name="cc-reg"]:checked')].map(cb => cb.value);
    if (checked.length === 0) { this.showToast('請選擇要取消的報名'); return; }

    this._closeCompanionCancelModal();

    const user = ApiService.getCurrentUser();
    const userId = user?.uid || 'unknown';

    if (ApiService._demoMode) {
      const e = ApiService.getEvent(eventId);
      if (e) {
        const regsToCancel = this._companionCancelRegs.filter(r => checked.includes(r.id));
        regsToCancel.forEach(r => {
          const displayName = r.companionName || r.userName;
          const pi = (e.participants || []).indexOf(displayName);
          if (pi >= 0) { e.participants.splice(pi, 1); e.current = Math.max(0, e.current - 1); }
          const wi = (e.waitlistNames || []).indexOf(displayName);
          if (wi >= 0) { e.waitlistNames.splice(wi, 1); e.waitlist = Math.max(0, e.waitlist - 1); }
          // 更新 demo registrations 狀態
          const reg = ApiService._src('registrations').find(reg => reg.id === r.id);
          if (reg) { reg.status = 'cancelled'; reg.cancelledAt = new Date().toISOString(); }
        });
        e.status = e.current >= e.max ? 'full' : 'open';
        const hasSelfCancel = regsToCancel.some(r => !r.companionId);
        if (hasSelfCancel) {
          const dateParts = e.date.split(' ')[0].split('/');
          const dateStr = `${dateParts[1]}/${dateParts[2]}`;
          const records = ApiService.getActivityRecords();
          for (let i = records.length - 1; i >= 0; i--) {
            if (records[i].eventId === eventId && records[i].uid === userId && records[i].status !== 'cancelled') {
              records.splice(i, 1);
            }
          }
          ApiService.addActivityRecord({ eventId, name: e.title, date: dateStr, status: 'cancelled', uid: userId });
          this._grantAutoExp(userId, 'cancel_registration', e.title);
        }
      }
      this.showToast(`已取消 ${checked.length} 筆報名`);
      this.showEventDetail(eventId);
      return;
    }

    FirebaseService.cancelCompanionRegistrations(checked)
      .then(() => {
        this.showToast(`已取消 ${checked.length} 筆報名`);
        this.showEventDetail(eventId);
      })
      .catch(err => { console.error('[_confirmCompanionCancel]', err); this.showToast('取消失敗：' + (err.message || '')); });
  },

});
