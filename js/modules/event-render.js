/* ================================================
   SportHub — Event: Helpers & Rendering
   依賴：config.js, data.js, api-service.js
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

    container.innerHTML = visible.length > 0
      ? visible.map(e => `
        <div class="h-card" onclick="App.showEventDetail('${e.id}')">
          ${e.image
            ? `<div class="h-card-img"><img src="${e.image}" alt="${escapeHTML(e.title)}"></div>`
            : `<div class="h-card-img h-card-placeholder">220 × 90</div>`}
          <div class="h-card-body">
            <div class="h-card-title">${escapeHTML(e.title)}${e.teamOnly ? '<span class="tl-teamonly-badge">限定</span>' : ''}</div>
            <div class="h-card-meta">
              <span>${escapeHTML(e.location.split('市')[0])}市</span>
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
              ${e.image ? `<div class="tl-event-thumb"><img src="${e.image}"></div>` : ''}
              <div class="tl-event-info">
                <div class="tl-event-title">${escapeHTML(e.title)}${teamBadge}</div>
                <div class="tl-event-meta">${typeConf.label} · ${time} · ${escapeHTML(e.location.split('市')[1] || e.location)} · ${e.current}/${e.max}人${waitlistTag}</div>
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
    if (this._requireLogin()) return;
    const e = ApiService.getEvent(id);
    if (!e) return;
    const detailImg = document.getElementById('detail-img-placeholder');
    if (detailImg) {
      if (e.image) {
        detailImg.innerHTML = `<img src="${e.image}" alt="${escapeHTML(e.title)}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)">`;
        detailImg.style.border = 'none';
      } else {
        detailImg.textContent = '活動圖片 800 × 300';
        detailImg.style.border = '';
      }
    }
    document.getElementById('detail-title').textContent = e.title;

    const countdown = this._calcCountdown(e);
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`;
    const locationHtml = `<a href="${mapUrl}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none">${escapeHTML(e.location)} 📍</a>`;

    const isEnded = e.status === 'ended' || e.status === 'cancelled';
    const isMainFull = e.current >= e.max;
    const isSignedUp = this._isUserSignedUp(e);
    const isOnWaitlist = isSignedUp && this._isUserOnWaitlist(e);
    let signupBtn = '';
    if (isEnded) {
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

    document.getElementById('detail-body').innerHTML = `
      <div class="detail-row"><span class="detail-label">地點</span>${locationHtml}</div>
      <div class="detail-row"><span class="detail-label">時間</span>${escapeHTML(e.date)}</div>
      <div class="detail-row"><span class="detail-label">費用</span>${e.fee > 0 ? '$'+e.fee : '免費'}</div>
      <div class="detail-row"><span class="detail-label">人數</span>已報 ${e.current}/${e.max}${(e.waitlist || 0) > 0 ? '　候補 ' + e.waitlist : ''}</div>
      <div class="detail-row"><span class="detail-label">年齡</span>${e.minAge > 0 ? e.minAge + ' 歲以上' : '無限制'}</div>
      <div class="detail-row"><span class="detail-label">主辦</span><span class="participant-list" style="display:inline-flex;gap:.3rem;flex-wrap:wrap">${this._userTag(e.creator)}</span></div>
      ${(e.delegates && e.delegates.length) ? `<div class="detail-row"><span class="detail-label">委託</span><span class="participant-list" style="display:inline-flex;gap:.3rem;flex-wrap:wrap">${e.delegates.map(d => this._userTag(d.name)).join('')}</span></div>` : ''}
      ${e.contact ? `<div class="detail-row"><span class="detail-label">聯繫</span>${escapeHTML(e.contact)}</div>` : ''}
      ${teamTag}
      <div class="detail-row"><span class="detail-label">倒數</span><span style="color:${isEnded ? 'var(--text-muted)' : 'var(--primary)' };font-weight:600">${countdown}</span></div>
      ${e.notes ? `
      <div class="detail-section">
        <div class="detail-section-title">注意事項</div>
        <p style="font-size:.85rem;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap">${escapeHTML(e.notes)}</p>
      </div>` : ''}
      <div style="display:flex;gap:.5rem;margin:1rem 0">
        ${signupBtn}
        <button class="outline-btn" onclick="App.showUserProfile('${escapeHTML(e.creator)}')">聯繫主辦人</button>
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
    `;
    this.showPage('page-activity-detail');
  },

  handleSignup(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    const user = ApiService.getCurrentUser();
    const userName = user?.displayName || user?.name || '用戶';
    const userId = user?.uid || 'unknown';

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
        this.showToast(result.status === 'waitlisted' ? '已加入候補名單' : '報名成功！');
        this.showEventDetail(id);
      })
      .catch(err => {
        console.error('[handleSignup]', err);
        this.showToast(err.message || '報名失敗，請稍後再試');
      });
  },

  async handleCancelSignup(id) {
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
          }
          e.status = e.current >= e.max ? 'full' : 'open';
        } else {
          const wi = (e.waitlistNames || []).indexOf(userName);
          if (wi !== -1) {
            e.waitlistNames.splice(wi, 1);
            e.waitlist = Math.max(0, e.waitlist - 1);
          }
        }
        // 更新報名紀錄狀態為取消
        const records = ApiService.getActivityRecords();
        const rec = records.find(r => r.eventId === id && r.uid === userId);
        if (rec) {
          rec.status = 'cancelled';
        }
      }
      this.showToast(isWaitlist ? '已取消候補' : '已取消報名');
      this.showEventDetail(id);
      return;
    }

    // 正式版：從 registrations 快取找到該筆報名紀錄，呼叫 cancelRegistration
    const reg = FirebaseService._cache.registrations.find(
      r => r.eventId === id && r.userId === userId && r.status !== 'cancelled'
    );
    if (reg) {
      FirebaseService.cancelRegistration(reg.id)
        .then(() => {
          // 更新 activityRecords 狀態
          const records = ApiService.getActivityRecords();
          const rec = records.find(r => r.eventId === id && r.uid === userId && r.status !== 'cancelled');
          if (rec) {
            rec.status = 'cancelled';
            if (rec._docId) {
              db.collection('activityRecords').doc(rec._docId).update({ status: 'cancelled' })
                .catch(err => console.error('[activityRecord cancel]', err));
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
});
