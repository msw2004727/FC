/* ================================================
   SportHub — Event (Render + Create + My Activities)
   ================================================ */

Object.assign(App, {

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
    return { teamId: user.teamId || null, teamName: user.teamName || null };
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

  /** 場主(含)以下只能管理自己的活動，admin+ 可管理全部 */
  _canManageEvent(e) {
    const myLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    if (myLevel >= ROLE_LEVEL_MAP.admin) return true; // admin, super_admin
    return this._isEventOwner(e);
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

  /** 自動將過期的 open/full 活動改為 ended */
  _autoEndExpiredEvents() {
    const now = new Date();
    ApiService.getEvents().forEach(e => {
      if (e.status !== 'open' && e.status !== 'full') return;
      const start = this._parseEventStartDate(e.date);
      if (start && start <= now) {
        ApiService.updateEvent(e.id, { status: 'ended' });
      }
    });
  },

  /** 判斷當前用戶是否已報名 */
  _isUserSignedUp(e) {
    const user = ApiService.getCurrentUser?.();
    if (!user) return false;
    const name = user.displayName || user.name || '';
    const uid = user.uid || '';
    const inParticipants = (e.participants || []).some(p => p === name || p === uid);
    const inWaitlist = (e.waitlistNames || []).some(p => p === name || p === uid);
    return inParticipants || inWaitlist;
  },

  // ══════════════════════════════════
  //  Render: Hot Events
  // ══════════════════════════════════

  renderHotEvents() {
    this._autoEndExpiredEvents();
    const container = document.getElementById('hot-events');
    // 顯示最近 10 場未結束活動（依日期排序）
    const visible = this._getVisibleEvents()
      .filter(e => e.status !== 'ended' && e.status !== 'cancelled')
      .sort((a, b) => {
        const da = this._parseEventStartDate(a.date);
        const db = this._parseEventStartDate(b.date);
        return (da || 0) - (db || 0);
      })
      .slice(0, 10);

    container.innerHTML = visible.length > 0
      ? visible.map(e => `
        <div class="h-card" onclick="App.showEventDetail('${e.id}')">
          ${e.image
            ? `<div class="h-card-img"><img src="${e.image}" alt="${e.title}"></div>`
            : `<div class="h-card-img h-card-placeholder">220 × 90</div>`}
          <div class="h-card-body">
            <div class="h-card-title">${e.title}${e.teamOnly ? '<span class="tl-teamonly-badge">限定</span>' : ''}</div>
            <div class="h-card-meta">
              <span>${e.location.split('市')[0]}市</span>
              <span>${e.current}/${e.max} 人</span>
            </div>
          </div>
        </div>
      `).join('')
      : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted)">目前沒有進行中的活動</div>';
  },

  // ══════════════════════════════════
  //  Render: Activity Timeline
  // ══════════════════════════════════

  renderActivityList() {
    const container = document.getElementById('activity-list');
    if (!container) return;

    // 篩選：類別 + 關鍵字
    const filterType = document.getElementById('activity-filter-type')?.value || '';
    const filterKw = (document.getElementById('activity-filter-keyword')?.value || '').trim().toLowerCase();

    let events = this._getVisibleEvents();
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

        dayInfo.events.forEach(e => {
          const typeConf = TYPE_CONFIG[e.type] || TYPE_CONFIG.friendly;
          const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
          const time = e.date.split(' ')[1] || '';
          const isEnded = e.status === 'ended' || e.status === 'cancelled';
          const waitlistTag = (e.waitlist || 0) > 0 ? ` · 候補(${e.waitlist})` : '';
          // 球隊限定用特殊色
          const rowClass = e.teamOnly ? 'tl-type-teamonly' : `tl-type-${e.type}`;
          const teamBadge = e.teamOnly ? `<span class="tl-teamonly-badge">${e.creatorTeamName || '限定'}</span>` : '';

          html += `
            <div class="tl-event-row ${rowClass}${isEnded ? ' tl-past' : ''}" onclick="App.showEventDetail('${e.id}')">
              ${e.image ? `<div class="tl-event-thumb"><img src="${e.image}"></div>` : ''}
              <div class="tl-event-info">
                <div class="tl-event-title">${e.title}${teamBadge}</div>
                <div class="tl-event-meta">${typeConf.label} · ${time} · ${e.location.split('市')[1] || e.location} · ${e.current}/${e.max}人${waitlistTag}</div>
              </div>
              <span class="tl-event-status ${statusConf.css}">${statusConf.label}</span>
              <span class="tl-event-arrow">›</span>
            </div>`;
        });

        html += `</div></div>`;
      });

      html += `</div>`;
    });

    container.innerHTML = html || '<div style="padding:1.5rem;font-size:.82rem;color:var(--text-muted);text-align:center">沒有符合條件的活動</div>';
  },

  // ══════════════════════════════════
  //  Show Event Detail
  // ══════════════════════════════════

  showEventDetail(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    const detailImg = document.getElementById('detail-img-placeholder');
    if (detailImg) {
      if (e.image) {
        detailImg.innerHTML = `<img src="${e.image}" alt="${e.title}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)">`;
        detailImg.style.border = 'none';
      } else {
        detailImg.textContent = '活動圖片 800 × 300';
        detailImg.style.border = '';
      }
    }
    document.getElementById('detail-title').textContent = e.title;

    const countdown = this._calcCountdown(e);
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`;
    const locationHtml = `<a href="${mapUrl}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none">${e.location} 📍</a>`;

    const isEnded = e.status === 'ended' || e.status === 'cancelled';
    const isFull = e.current >= e.max;
    const isSignedUp = this._isUserSignedUp(e);
    let signupBtn = '';
    if (isEnded) {
      signupBtn = `<button style="background:#333;color:#999;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed" disabled>已結束</button>`;
    } else if (isSignedUp) {
      signupBtn = `<button style="background:#dc2626;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer" onclick="App.handleCancelSignup('${e.id}')">取消報名</button>`;
    } else if (isFull) {
      signupBtn = `<button style="background:#7c3aed;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer" onclick="App.handleSignup('${e.id}')">報名候補</button>`;
    } else {
      signupBtn = `<button class="primary-btn" onclick="App.handleSignup('${e.id}')">立即報名</button>`;
    }

    const teamTag = e.teamOnly ? `<div class="detail-row"><span class="detail-label">限定</span><span style="color:#e11d48;font-weight:600">${e.creatorTeamName || '球隊'} 專屬活動</span></div>` : '';

    document.getElementById('detail-body').innerHTML = `
      <div class="detail-row"><span class="detail-label">地點</span>${locationHtml}</div>
      <div class="detail-row"><span class="detail-label">時間</span>${e.date}</div>
      <div class="detail-row"><span class="detail-label">費用</span>${e.fee > 0 ? '$'+e.fee : '免費'}</div>
      <div class="detail-row"><span class="detail-label">人數</span>已報 ${e.current}/${e.max}　候補 ${e.waitlist}/${e.waitlistMax}</div>
      <div class="detail-row"><span class="detail-label">年齡</span>${e.minAge > 0 ? e.minAge + ' 歲以上' : '無限制'}</div>
      <div class="detail-row"><span class="detail-label">主辦</span>${e.creator}</div>
      ${e.contact ? `<div class="detail-row"><span class="detail-label">聯繫</span>${e.contact}</div>` : ''}
      ${teamTag}
      <div class="detail-row"><span class="detail-label">倒數</span><span style="color:${isEnded ? 'var(--text-muted)' : 'var(--primary)' };font-weight:600">${countdown}</span></div>
      ${e.notes ? `
      <div class="detail-section">
        <div class="detail-section-title">注意事項</div>
        <p style="font-size:.85rem;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap">${e.notes}</p>
      </div>` : ''}
      <div style="display:flex;gap:.5rem;margin:1rem 0">
        ${signupBtn}
        <button class="outline-btn disabled" disabled>聯繫主辦人</button>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">報名名單 (${e.current})</div>
        <div class="participant-list">${(e.participants || []).map(p => this._userTag(p)).join('')}</div>
      </div>
      ${(e.waitlistNames || []).length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">候補名單 (${e.waitlist})</div>
        <div class="participant-list">${e.waitlistNames.map(p => this._userTag(p)).join('')}</div>
      </div>` : ''}
    `;
    this.showPage('page-activity-detail');
  },

  handleSignup(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;

    if (ApiService._demoMode) {
      this.showToast(e.current >= e.max ? '已加入候補名單' : '報名成功！');
      return;
    }

    const user = ApiService.getCurrentUser();
    const userId = user?.uid || 'unknown';
    const userName = user?.displayName || user?.name || '用戶';
    FirebaseService.registerForEvent(id, userId, userName)
      .then(result => {
        this.showToast(result.status === 'waitlisted' ? '已加入候補名單' : '報名成功！');
        this.showEventDetail(id);
      })
      .catch(err => {
        console.error('[handleSignup]', err);
        this.showToast(err.message || '報名失敗，請稍後再試');
      });
  },

  handleCancelSignup(id) {
    if (!confirm('確定要取消報名？')) return;
    const user = ApiService.getCurrentUser();
    const userName = user?.displayName || user?.name || '用戶';
    const userId = user?.uid || 'unknown';

    if (ApiService._demoMode) {
      // Demo 模式：從 participants / waitlistNames 移除
      const e = ApiService.getEvent(id);
      if (e) {
        const pi = (e.participants || []).indexOf(userName);
        if (pi !== -1) {
          e.participants.splice(pi, 1);
          e.current = Math.max(0, e.current - 1);
          // 若候補有人，遞補
          if (e.waitlistNames && e.waitlistNames.length > 0) {
            const promoted = e.waitlistNames.shift();
            e.participants.push(promoted);
            e.current++;
            e.waitlist = Math.max(0, e.waitlist - 1);
          }
          if (e.current < e.max && e.status === 'full') e.status = 'open';
        } else {
          const wi = (e.waitlistNames || []).indexOf(userName);
          if (wi !== -1) {
            e.waitlistNames.splice(wi, 1);
            e.waitlist = Math.max(0, e.waitlist - 1);
          }
        }
      }
      this.showToast('已取消報名');
      this.showEventDetail(id);
      return;
    }

    if (typeof FirebaseService.unregisterFromEvent === 'function') {
      FirebaseService.unregisterFromEvent(id, userId)
        .then(() => { this.showToast('已取消報名'); this.showEventDetail(id); })
        .catch(err => { console.error('[cancelSignup]', err); this.showToast('取消失敗'); });
    } else {
      this.showToast('已取消報名');
    }
  },

  // ══════════════════════════════════
  //  My Activities (Coach+)
  // ══════════════════════════════════

  _myActivityFilter: 'all',

  renderMyActivities(filter) {
    const container = document.getElementById('my-activity-list');
    if (!container) return;
    const f = filter || this._myActivityFilter || 'all';
    this._myActivityFilter = f;

    const myLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    const isAdmin = myLevel >= ROLE_LEVEL_MAP.admin;

    // 場主(含)以下只看自己的活動
    let allEvents = ApiService.getEvents();
    if (!isAdmin) {
      allEvents = allEvents.filter(e => this._isEventOwner(e));
    }
    const filtered = f === 'all' ? allEvents : allEvents.filter(e => e.status === f);

    // 統計
    const statsEl = document.getElementById('my-activity-stats');
    if (statsEl) {
      const openCount = allEvents.filter(e => e.status === 'open').length;
      const fullCount = allEvents.filter(e => e.status === 'full').length;
      const endedCount = allEvents.filter(e => e.status === 'ended').length;
      const cancelledCount = allEvents.filter(e => e.status === 'cancelled').length;
      statsEl.textContent = `共 ${allEvents.length} 場 ・ 報名中 ${openCount} ・ 已額滿 ${fullCount} ・ 已結束 ${endedCount} ・ 已取消 ${cancelledCount}`;
    }

    const s = 'font-size:.72rem;padding:.2rem .5rem';
    container.innerHTML = filtered.length > 0
      ? filtered.map(e => {
        const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
        const canManage = this._canManageEvent(e);
        let btns = '';
        if (canManage) {
          if (e.status === 'open' || e.status === 'full') {
            btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`
                 + `<button class="outline-btn" style="${s}" onclick="App.editMyActivity('${e.id}')">編輯</button>`
                 + `<button class="outline-btn" style="${s};color:var(--warning)" onclick="App.closeMyActivity('${e.id}')">結束</button>`
                 + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.cancelMyActivity('${e.id}')">取消</button>`;
          } else if (e.status === 'ended') {
            btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`
                 + `<button class="outline-btn" style="${s};color:var(--success)" onclick="App.reopenMyActivity('${e.id}')">重新開放</button>`
                 + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMyActivity('${e.id}')">刪除</button>`;
          } else if (e.status === 'cancelled') {
            btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`
                 + `<button class="outline-btn" style="${s};color:var(--success)" onclick="App.reopenMyActivity('${e.id}')">重新開放</button>`
                 + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMyActivity('${e.id}')">刪除</button>`;
          }
        } else {
          btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`;
        }
        const progressPct = e.max > 0 ? Math.min(100, Math.round(e.current / e.max * 100)) : 0;
        const progressColor = progressPct >= 100 ? 'var(--danger)' : progressPct >= 70 ? 'var(--warning)' : 'var(--success)';
        const teamBadge = e.teamOnly ? '<span class="tl-teamonly-badge" style="margin-left:.3rem">限定</span>' : '';
        return `
      <div class="msg-manage-card" style="margin-bottom:.5rem">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
          <span class="msg-manage-title" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.title}${teamBadge}</span>
          <span class="banner-manage-status status-${statusConf.css}">${statusConf.label}</span>
        </div>
        <div style="font-size:.75rem;color:var(--text-muted)">${e.location} ・ ${e.date}</div>
        <div style="display:flex;align-items:center;gap:.5rem;margin-top:.3rem">
          <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="width:${progressPct}%;height:100%;background:${progressColor};border-radius:3px;transition:width .3s"></div>
          </div>
          <span style="font-size:.72rem;color:var(--text-muted);white-space:nowrap">${e.current}/${e.max} 人${e.waitlist > 0 ? ' ・ 候補 ' + e.waitlist : ''}</span>
        </div>
        <div style="display:flex;gap:.3rem;margin-top:.4rem;flex-wrap:wrap">${btns}</div>
      </div>`;
      }).join('')
      : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center">此分類沒有活動</div>';

    // 綁定 tabs
    const tabs = document.getElementById('my-activity-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderMyActivities(tab.dataset.afilter);
        });
      });
    }
  },

  // ── 查看活動名單 ──
  showMyActivityDetail(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    const modal = document.getElementById('my-activity-detail-modal');
    const content = document.getElementById('my-activity-detail-content');
    if (!modal || !content) return;
    const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
    const participants = (e.participants || []).map((p, i) =>
      `<div style="display:flex;align-items:center;gap:.4rem;padding:.3rem 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.72rem;color:var(--text-muted);min-width:1.5rem">${i + 1}.</span>
        <span style="font-size:.82rem">${p}</span>
      </div>`
    ).join('');
    const waitlist = (e.waitlistNames || []).map((p, i) =>
      `<div style="display:flex;align-items:center;gap:.4rem;padding:.3rem 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.72rem;color:var(--text-muted);min-width:1.5rem">${i + 1}.</span>
        <span style="font-size:.82rem">${p}</span>
      </div>`
    ).join('');
    content.innerHTML = `
      <h3 style="margin:0 0 .4rem;font-size:1rem">${e.title}</h3>
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.6rem">
        <div>${e.location} ・ ${e.date}</div>
        <div>費用：${e.fee > 0 ? 'NT$' + e.fee : '免費'} ・ 狀態：${statusConf.label} ・ 主辦：${e.creator}</div>
      </div>
      <div style="font-size:.85rem;font-weight:700;margin-bottom:.3rem">報名名單（${e.current}/${e.max}）</div>
      ${participants || '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">尚無報名</div>'}
      ${e.waitlist > 0 ? `
        <div style="font-size:.85rem;font-weight:700;margin:.6rem 0 .3rem">候補名單（${e.waitlist}/${e.waitlistMax}）</div>
        ${waitlist}
      ` : ''}
    `;
    modal.style.display = 'flex';
  },

  // ── 編輯活動 ──
  editMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this._canManageEvent(e)) { this.showToast('您只能編輯自己的活動'); return; }
    this._editEventId = id;
    this.showModal('create-event-modal');
    document.getElementById('ce-title').value = e.title || '';
    document.getElementById('ce-type').value = e.type || 'friendly';
    document.getElementById('ce-location').value = e.location || '';
    const dateTime = (e.date || '').split(' ');
    const dateParts = (dateTime[0] || '').split('/');
    if (dateParts.length === 3) {
      document.getElementById('ce-date').value = `${dateParts[0]}-${dateParts[1].padStart(2,'0')}-${dateParts[2].padStart(2,'0')}`;
    }
    const timeStr = dateTime[1] || '';
    const timeParts = timeStr.split('~');
    const ceTimeStart = document.getElementById('ce-time-start');
    const ceTimeEnd = document.getElementById('ce-time-end');
    if (ceTimeStart && ceTimeEnd) {
      ceTimeStart.value = timeParts[0] || '14:00';
      ceTimeEnd.value = timeParts[1] || '16:00';
    }
    document.getElementById('ce-fee').value = e.fee || 0;
    document.getElementById('ce-max').value = e.max || 20;
    document.getElementById('ce-waitlist').value = e.waitlistMax || 0;
    document.getElementById('ce-min-age').value = e.minAge || 0;
    document.getElementById('ce-notes').value = e.notes || '';
    // 球隊限定
    const ceTeamOnly = document.getElementById('ce-team-only');
    if (ceTeamOnly) {
      ceTeamOnly.checked = !!e.teamOnly;
      this._updateTeamOnlyLabel();
    }
    const preview = document.getElementById('ce-upload-preview');
    if (e.image && preview) {
      preview.innerHTML = `<img src="${e.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    }
  },

  // ── 結束活動 ──
  closeMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    if (!confirm('確定要結束此活動？')) return;
    ApiService.updateEvent(id, { status: 'ended' });
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已結束');
  },

  // ── 取消活動 ──
  cancelMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    if (!confirm('確定要取消此活動？')) return;
    ApiService.updateEvent(id, { status: 'cancelled' });
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已取消');
  },

  // ── 重新開放 ──
  reopenMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    const newStatus = e.current >= e.max ? 'full' : 'open';
    ApiService.updateEvent(id, { status: newStatus });
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已重新開放');
  },

  // ── 刪除活動 ──
  deleteMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    if (!confirm('確定要刪除此活動？刪除後無法恢復。')) return;
    ApiService.deleteEvent(id);
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已刪除');
  },

  // ══════════════════════════════════
  //  Create Event
  // ══════════════════════════════════

  _editEventId: null,

  /** 球隊限定開關 label 更新 */
  _updateTeamOnlyLabel() {
    const cb = document.getElementById('ce-team-only');
    const label = document.getElementById('ce-team-only-label');
    if (!cb || !label) return;
    if (cb.checked) {
      const team = this._getEventCreatorTeam();
      label.textContent = `開啟 — 僅 ${team.teamName || '您的球隊'} 可見`;
      label.style.color = '#e11d48';
    } else {
      label.textContent = '關閉 — 所有人可見';
      label.style.color = 'var(--text-muted)';
    }
  },

  /** 綁定球隊限定開關事件 */
  bindTeamOnlyToggle() {
    const cb = document.getElementById('ce-team-only');
    if (cb) cb.addEventListener('change', () => this._updateTeamOnlyLabel());
  },

  handleCreateEvent() {
    const title = document.getElementById('ce-title').value.trim();
    const type = document.getElementById('ce-type').value;
    const location = document.getElementById('ce-location').value.trim();
    const dateVal = document.getElementById('ce-date').value;
    const ceTimeStart = document.getElementById('ce-time-start');
    const ceTimeEnd = document.getElementById('ce-time-end');
    const timeVal = (ceTimeStart && ceTimeEnd) ? `${ceTimeStart.value}~${ceTimeEnd.value}` : '';
    const fee = parseInt(document.getElementById('ce-fee').value) || 0;
    const max = parseInt(document.getElementById('ce-max').value) || 20;
    const waitlistMax = parseInt(document.getElementById('ce-waitlist').value) || 0;
    const minAge = parseInt(document.getElementById('ce-min-age').value) || 0;
    const notes = document.getElementById('ce-notes').value.trim();
    const teamOnly = !!document.getElementById('ce-team-only')?.checked;

    if (!title) { this.showToast('請輸入活動名稱'); return; }
    if (title.length > 12) { this.showToast('活動名稱不可超過 12 字'); return; }
    if (!location) { this.showToast('請輸入地點'); return; }
    if (!dateVal) { this.showToast('請選擇日期'); return; }
    if (notes.length > 500) { this.showToast('注意事項不可超過 500 字'); return; }
    if (teamOnly) {
      const team = this._getEventCreatorTeam();
      if (!team.teamId) { this.showToast('您尚未加入球隊，無法開啟球隊限定'); return; }
    }

    const cePreviewEl = document.getElementById('ce-upload-preview');
    const ceImg = cePreviewEl?.querySelector('img');
    const image = ceImg ? ceImg.src : null;

    const dateParts = dateVal.split('-');
    const fullDate = timeVal ? `${dateParts[0]}/${parseInt(dateParts[1]).toString().padStart(2,'0')}/${parseInt(dateParts[2]).toString().padStart(2,'0')} ${timeVal}` : `${dateParts[0]}/${parseInt(dateParts[1])}/${parseInt(dateParts[2])}`;

    const team = this._getEventCreatorTeam();

    if (this._editEventId) {
      const updates = {
        title, type, location, date: fullDate, fee, max, waitlistMax, minAge, notes, image,
        gradient: GRADIENT_MAP[type] || GRADIENT_MAP.friendly,
        teamOnly,
        creatorTeamId: teamOnly ? team.teamId : null,
        creatorTeamName: teamOnly ? team.teamName : null,
      };
      ApiService.updateEvent(this._editEventId, updates);
      this.closeModal();
      this._editEventId = null;
      this.renderActivityList();
      this.renderHotEvents();
      this.renderMyActivities();
      this.showToast(`活動「${title}」已更新！`);
    } else {
      const creatorName = this._getEventCreatorName();
      const creatorUid = this._getEventCreatorUid();
      const newEvent = {
        id: 'ce_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        title, type, status: 'open', location, date: fullDate,
        fee, max, current: 0, waitlist: 0, waitlistMax, minAge, notes, image,
        creator: creatorName,
        creatorUid,
        contact: '',
        gradient: GRADIENT_MAP[type] || GRADIENT_MAP.friendly,
        icon: '',
        countdown: '即將開始',
        participants: [],
        waitlistNames: [],
        teamOnly,
        creatorTeamId: teamOnly ? team.teamId : null,
        creatorTeamName: teamOnly ? team.teamName : null,
      };
      ApiService.createEvent(newEvent);
      this.closeModal();
      this.renderActivityList();
      this.renderHotEvents();
      this.renderMyActivities();
      this.showToast(`活動「${title}」已建立！`);
    }

    // 重置表單
    this._editEventId = null;
    document.getElementById('ce-title').value = '';
    document.getElementById('ce-location').value = '';
    document.getElementById('ce-fee').value = '300';
    document.getElementById('ce-max').value = '20';
    document.getElementById('ce-waitlist').value = '5';
    document.getElementById('ce-min-age').value = '0';
    document.getElementById('ce-notes').value = '';
    document.getElementById('ce-image').value = '';
    if (ceTimeStart) ceTimeStart.value = '14:00';
    if (ceTimeEnd) ceTimeEnd.value = '16:00';
    const ceTeamOnly = document.getElementById('ce-team-only');
    if (ceTeamOnly) { ceTeamOnly.checked = false; this._updateTeamOnlyLabel(); }
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
  },

});
