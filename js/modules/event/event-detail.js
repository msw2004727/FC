/* ================================================
   SportHub — Event: Detail View
   依賴：event-list.js, config.js, api-service.js
   報名/取消邏輯已搬至 event-detail-signup.js
   評價邏輯已搬至 event-detail-reviews.js
   ================================================ */

Object.assign(App, {

  _eventDetailRequestSeq: 0,

  _getEventDetailNodes() {
    const nodes = {
      title: document.getElementById('detail-title'),
      publicToggleWrap: document.getElementById('detail-public-toggle-wrap'),
      image: document.getElementById('detail-img-placeholder'),
      body: document.getElementById('detail-body'),
    };
    return Object.values(nodes).every(Boolean) ? nodes : null;
  },

  _renderEventPublicToggle(e) {
    const wrap = document.getElementById('detail-public-toggle-wrap');
    if (!wrap) return;
    if (!e || typeof this._canToggleEventPublic !== 'function' || !this._canToggleEventPublic(e)) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      return;
    }
    const checked = !!e.isPublic;
    wrap.style.display = '';
    wrap.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:.35rem;user-select:none">
        <span style="font-size:.72rem;color:var(--text-muted);font-weight:600">活動公開</span>
        <label class="toggle-switch ${checked ? 'active' : ''}" style="transform:scale(.9);transform-origin:right center">
          <input type="checkbox" id="detail-event-public-toggle" ${checked ? 'checked' : ''} onchange="App.toggleEventPublicFromDetail()">
          <span class="toggle-slider"></span>
        </label>
      </span>`;
  },

  _getEventDetailRibbonMeta(eventRecord) {
    const safeType = TYPE_CONFIG?.[eventRecord?.type] ? eventRecord.type : 'friendly';
    const typeConf = TYPE_CONFIG?.[safeType] || TYPE_CONFIG.friendly;
    return {
      typeKey: safeType,
      label: typeConf?.label || '活動',
    };
  },

  _renderEventDetailCover(eventRecord) {
    const ribbonMeta = this._getEventDetailRibbonMeta(eventRecord);
    const ribbonHtml = `<span class="detail-cover-ribbon detail-cover-ribbon-${ribbonMeta.typeKey}">${escapeHTML(ribbonMeta.label)}</span>`;

    if (eventRecord?.image) {
      return `
        <div class="detail-cover-media">
          <img class="detail-cover-image" src="${eventRecord.image}" alt="${escapeHTML(eventRecord.title)}" loading="lazy">
          ${ribbonHtml}
        </div>`;
    }

    return `
      <div class="detail-cover-media detail-cover-media-empty">
        <span class="detail-cover-placeholder-text">活動圖片 800 × 300</span>
        ${ribbonHtml}
      </div>`;
  },

  async toggleEventPublicFromDetail() {
    const eventId = this._currentDetailEventId;
    const e = eventId ? ApiService.getEvent(eventId) : null;
    if (!e) return;
    if (typeof this._canToggleEventPublic !== 'function' || !this._canToggleEventPublic(e)) {
      this.showToast('您沒有修改公開狀態的權限');
      return;
    }
    const input = document.getElementById('detail-event-public-toggle');
    if (!input) return;
    const nextVal = !!input.checked;
    const prevVal = !!e.isPublic;
    input.disabled = true;
    try {
      e.isPublic = nextVal;
      if (ModeManager.isDemo()) {
        // demo: local cache update only
      } else {
        await FirebaseService.updateEvent(e.id, { isPublic: nextVal });
      }
      this.showToast(nextVal ? '已開啟活動公開' : '已關閉活動公開');
      this.showEventDetail(e.id);
      this.renderActivityList?.();
      this.renderHotEvents?.();
      this.renderMyActivities?.();
    } catch (err) {
      console.error('[toggleEventPublicFromDetail]', err);
      e.isPublic = prevVal;
      input.checked = !nextVal;
      this.showToast(err?.message || '更新公開狀態失敗');
    } finally {
      if (document.getElementById('detail-event-public-toggle')) {
        document.getElementById('detail-event-public-toggle').disabled = false;
      }
    }
  },

  // ══════════════════════════════════
  //  Show Event Detail
  // ══════════════════════════════════

  _isGuestEventDetailView(options = {}) {
    return !!options.allowGuest && this._isLoginRequired();
  },

  requestProtectedEventAction(actionType, eventId) {
    const normalizedType = String(actionType || '').trim();
    const normalizedEventId = String(eventId || '').trim();
    if (!normalizedType || !normalizedEventId) return;

    const actionMap = {
      eventSignup: { type: 'eventSignup', eventId: normalizedEventId },
      eventCancelSignup: { type: 'eventCancelSignup', eventId: normalizedEventId },
      toggleFavoriteEvent: { type: 'toggleFavoriteEvent', eventId: normalizedEventId },
    };
    const action = actionMap[normalizedType];
    if (!action || typeof this._requestLoginForAction !== 'function') return;
    this._requestLoginForAction(action);
  },

  _buildGuestEventSignupButton(eventRecord, isUpcoming, isEnded, isMainFull) {
    if (!eventRecord) return '';
    if (isUpcoming) {
      return `<button style="background:#64748b;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed" disabled>\u5831\u540d\u5c1a\u672a\u958b\u653e</button>`;
    }
    if (isEnded) {
      return `<button style="background:#333;color:#999;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed" disabled>\u5831\u540d\u5df2\u7d50\u675f</button>`;
    }
    if (isMainFull) {
      return `<button style="background:#7c3aed;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer" onclick="App.requestProtectedEventAction('eventSignup','${eventRecord.id}')">\u5831\u540d\u5019\u88dc</button>`;
    }
    return `<button class="primary-btn" onclick="App.requestProtectedEventAction('eventSignup','${eventRecord.id}')">\u7acb\u5373\u5831\u540d</button>`;
  },

  _buildGuestEventPeople(eventRecord, fieldName) {
    const names = Array.isArray(eventRecord?.[fieldName]) ? eventRecord[fieldName] : [];
    return names
      .filter(name => typeof name === 'string' && name.trim())
      .map(name => ({
        name,
        uid: name,
        isCompanion: false,
        displayName: name,
        hasSelfReg: true,
        proxyOnly: false,
      }));
  },

  _renderGuestAttendanceTable(eventId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const eventRecord = ApiService.getEvent(eventId);
    if (!eventRecord) {
      container.innerHTML = '';
      return;
    }
    const people = this._buildGuestEventPeople(eventRecord, 'participants');
    if (!people.length) {
      container.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">\u5c1a\u7121\u5831\u540d</div>';
      return;
    }
    container.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:.4rem">
        ${people.map(person => `<span class="user-capsule uc-user" onclick="App.showUserProfile('${escapeHTML(person.displayName)}')">${escapeHTML(person.displayName)}</span>`).join('')}
      </div>`;
  },

  _renderGuestWaitlistSection(eventId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const eventRecord = ApiService.getEvent(eventId);
    if (!eventRecord) {
      container.innerHTML = '';
      return;
    }
    const people = this._buildGuestEventPeople(eventRecord, 'waitlistNames');
    if (!people.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `
      <div class="detail-section">
        <div class="detail-section-title">\u5019\u88dc\u540d\u55ae (${people.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:.4rem">
          ${people.map(person => `<span class="user-capsule uc-user" onclick="App.showUserProfile('${escapeHTML(person.displayName)}')">${escapeHTML(person.displayName)}</span>`).join('')}
        </div>
      </div>`;
  },

  async showEventDetail(id, options = {}) {
    // 翻牌動畫播放中 → 跳過 onSnapshot 觸發的重新渲染（避免 DOM 被中途替換）
    if (this._flipAnimating) return;
    try {
      const isGuestView = this._isGuestEventDetailView(options);
      let e = ApiService.getEvent(id);
      // stale-first：快取有活動資料時跳過登入擋板（報名按鈕已有「載入中」保護）
      if (!isGuestView && !e && this._requireLogin()) return { ok: false, reason: 'auth' };
      if (!e) return { ok: false, reason: 'missing' };
      // 外部活動直接跳轉，不進詳情頁
      if (e.type === 'external' && e.externalUrl) {
        location.href = e.externalUrl;
        return { ok: true };
      }
      if (!isGuestView && typeof this._canViewEventByTeamScope === 'function' && !this._canViewEventByTeamScope(e)) {
        this.showToast('\u60a8\u6c92\u6709\u67e5\u770b\u6b64\u6d3b\u52d5\u7684\u6b0a\u9650');
        return { ok: false, reason: 'forbidden' };
      }

      const requestSeq = ++this._eventDetailRequestSeq;
      // Pre-warm Firebase Auth（fire-and-forget），讓後續報名/取消寫入時免等 auth
      FirebaseService.ensureAuthReadyForWrite().catch(() => {});
      // ── 確保頁面 HTML + Script 已載入（不切換顯示），避免空白模板閃現 ──
      if (typeof PageLoader !== 'undefined' && PageLoader.ensurePage) {
        await PageLoader.ensurePage('page-activity-detail');
      }
      if (typeof ScriptLoader !== 'undefined' && ScriptLoader.ensureForPage) {
        await ScriptLoader.ensureForPage('page-activity-detail');
      }
      if (requestSeq !== this._eventDetailRequestSeq) {
        return { ok: false, reason: 'stale' };
      }
      // 重新取得活動資料（await 期間快取可能被刷新）
      e = ApiService.getEvent(id);
      if (!e) return { ok: false, reason: 'missing' };
      if (!isGuestView && typeof this._canViewEventByTeamScope === 'function' && !this._canViewEventByTeamScope(e)) {
        this.showToast('\u60a8\u6c92\u6709\u67e5\u770b\u6b64\u6d3b\u52d5\u7684\u6b0a\u9650');
        return { ok: false, reason: 'forbidden' };
      }
      e = this._syncEventEffectiveStatus?.(e) || e;

      // 驗證 DOM 節點存在（頁面已載入 DOM 但尚未切換顯示）
      const nodes = this._getEventDetailNodes();
      if (!nodes) {
        console.warn('[EventDetail] detail shell missing');
        return { ok: false, reason: 'page-not-ready' };
      }

      this._currentDetailEventId = id;
    this._renderEventPublicToggle(isGuestView ? null : e);
    this._renderEventLogButton(isGuestView ? null : e);
      const detailImg = nodes.image;
    if (detailImg) {
      detailImg.innerHTML = this._renderEventDetailCover(e);
      if (e.image) {
        detailImg.style.border = 'none';
      } else {
        detailImg.style.border = '';
      }
    }
      const eventFavorited = isGuestView ? false : this.isEventFavorited(id);
      nodes.title.innerHTML = escapeHTML(e.title) + ' ' + this._favHeartHtml(eventFavorited, 'Event', id);

    const countdown = this._calcCountdown(e);
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`;
    const locationHtml = `<a href="${mapUrl}" target="sporthub_map" rel="noopener" style="color:var(--primary);text-decoration:none">${escapeHTML(e.location)} 📍</a>`;

    const confirmedSummary = isGuestView
      ? {
          count: Number(e.current || (Array.isArray(e.participants) ? e.participants.length : 0)),
          people: this._buildGuestEventPeople(e, 'participants'),
        }
      : (typeof this._buildConfirmedParticipantSummary === 'function'
        ? this._buildConfirmedParticipantSummary(e.id)
        : { count: Number(e.current || 0), people: [] });
    const confirmedCount = confirmedSummary.count;
    const waitlistDisplayCount = isGuestView
      ? ((typeof this._getWaitlistFallbackNames === 'function' ? this._getWaitlistFallbackNames(e.id, e, []) : (e.waitlistNames || [])).length)
      : (typeof this._getEventWaitlistDisplayCount === 'function' ? this._getEventWaitlistDisplayCount(e.id, e) : Number(e.waitlist || 0));
    const isEnded = e.status === 'ended' || e.status === 'cancelled';
    const isUpcoming = e.status === 'upcoming';
    const isMainFull = confirmedCount >= e.max;
    // 防幽靈 UI 層：registrations 快取為空且即時監聽尚未啟動時，視為「載入中」
    const regsLoading = !isGuestView && !ModeManager.isDemo()
      && FirebaseService._cache.registrations.length === 0
      && !FirebaseService._realtimeListenerStarted?.registrations;
    const isSignedUp = isGuestView ? false : (regsLoading ? false : this._isUserSignedUp(e));
    const isOnWaitlist = isSignedUp && this._isUserOnWaitlist(e);
    const canTeamOnlySignup = isGuestView
      ? true
      : ((typeof this._canSignupTeamOnlyEvent === 'function') ? this._canSignupTeamOnlyEvent(e) : true);
    const genderSignupState = (typeof this._getEventGenderSignupState === 'function')
      ? this._getEventGenderSignupState(e, isGuestView ? null : (ApiService.getCurrentUser?.() || null))
      : { restricted: false, canSignup: true, requiresLogin: false, reason: '' };
    const genderBlockedMessage = (typeof this._getEventGenderRestrictionMessage === 'function')
      ? this._getEventGenderRestrictionMessage(e, genderSignupState.reason)
      : '';
    // 光跡效果包裝 helper（button 放在 flipper 裡，供翻牌 3D 旋轉使用）
    const _glowWrap = (btnHtml, glowC, glowCLight, hint) =>
      `<div class="signup-glow-wrap" style="--glow-c:${glowC};--glow-c-light:${glowCLight}"><div class="signup-glow-border"></div><div class="signup-glow-shadow"></div><div class="signup-flipper">${btnHtml}</div><div class="signup-loading-hint"><div class="mini-spinner"></div><span class="mini-text">${hint || '資料更新中'}</span></div></div>`;
    let signupBtn = '';
    if (isGuestView) {
      signupBtn = this._buildGuestEventSignupButton(e, isUpcoming, isEnded, isMainFull);
    } else if (regsLoading) {
      signupBtn = `<button style="background:#64748b;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed;opacity:.7" disabled>載入中…</button>`;
    } else if (isUpcoming) {
      signupBtn = `<button style="background:#64748b;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed" disabled>報名尚未開放</button>`;
    } else if (isEnded) {
      signupBtn = `<button style="background:#333;color:#999;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed" disabled>已結束</button>`;
    } else if (isOnWaitlist) {
      signupBtn = _glowWrap(`<button style="background:#7c3aed;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer" onclick="App.handleCancelSignup('${e.id}')">取消候補</button>`, '#7c3aed', '#a78bfa', '正在取消候補');
    } else if (isSignedUp) {
      signupBtn = _glowWrap(`<button style="background:#dc2626;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer" onclick="App.handleCancelSignup('${e.id}')">取消報名</button>`, '#dc2626', '#f87171', '正在取消報名');
    } else if (e.teamOnly && !canTeamOnlySignup) {
      signupBtn = `<button style="background:#dc2626;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer;opacity:.95" onclick="App.showToast('俱樂部限定')">俱樂部限定</button>`;
    } else if (genderSignupState.restricted && !genderSignupState.requiresLogin && !genderSignupState.canSignup) {
      signupBtn = `<button style="background:#dc2626;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer;opacity:.95" onclick='App.showToast(${JSON.stringify(genderBlockedMessage)})'>${escapeHTML(this._getEventGenderRibbonText?.(e) || '性別限定')}</button>`;
    } else if (isMainFull) {
      signupBtn = _glowWrap(`<button style="background:#7c3aed;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer" onclick="App.handleSignup('${e.id}')">報名候補</button>`, '#7c3aed', '#a78bfa', '報名候補中');
    } else {
      signupBtn = _glowWrap(`<button class="primary-btn" onclick="App.handleSignup('${e.id}')">立即報名</button>`, 'var(--accent)', 'var(--accent-hover)', '報名中');
    }

    const teamNameLink = e.creatorTeamId
      ? `<a href="javascript:void(0)" onclick="App.showTeamDetail('${e.creatorTeamId}')" style="color:inherit;text-decoration:underline;text-underline-offset:2px">${escapeHTML(e.creatorTeamName || '俱樂部')}</a>`
      : escapeHTML(e.creatorTeamName || '俱樂部');
    const teamTag = e.teamOnly ? `<div class="detail-row"><span class="detail-label">限定</span><span style="color:#e11d48;font-weight:600">${teamNameLink} 專屬活動</span></div>` : '';
    const genderTag = this._hasEventGenderRestriction?.(e)
      ? `<div class="detail-row"><span class="detail-label">性別</span><span style="color:#dc2626;font-weight:700">${escapeHTML(this._getEventGenderDetailText(e))}</span></div>`
      : '';
    const ageTag = e.minAge > 0
      ? `<div class="detail-row"><span class="detail-label">年齡</span>${e.minAge} 歲以上</div>`
      : '';

    const feeEnabled = this._isEventFeeEnabled?.(e) ?? Number(e?.fee || 0) > 0;
    const fee = this._getEventFeeAmount?.(e) ?? (feeEnabled ? (Number(e?.fee || 0) || 0) : 0);
    const feeRow = feeEnabled
      ? `<div class="detail-row"><span class="detail-label">費用</span>${fee > 0 ? 'NT$' + fee : '免費'}</div>`
      : '';

    const canScan = !isGuestView && this._canManageEvent(e);
    const scanBtn = canScan
      ? `<button class="outline-btn" onclick="App.goToScanForEvent('${e.id}')">現場簽到</button>`
      : '';

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

      nodes.body.innerHTML = `
      <div class="detail-row"><span class="detail-label">地點</span>${locationHtml}</div>
      <div class="detail-row"><span class="detail-label">時間</span>${escapeHTML(e.date)}</div>
      ${regOpenHtml}
      ${feeRow}
      <div class="detail-row"><span class="detail-label">人數</span>已報 ${confirmedCount}/${e.max}${waitlistDisplayCount > 0 ? '　候補 ' + waitlistDisplayCount : ''}</div>
      ${ageTag}
      ${genderTag}
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
      <div style="display:flex;gap:.5rem;margin:1rem 0 1.6rem;flex-wrap:wrap;align-items:center">
        ${signupBtn}
        <button class="outline-btn" onclick="App.contactEventOrganizer('${escapeHTML(e.creator)}')">聯繫主辦人</button>
        <button class="outline-btn" onclick="App.shareEvent('${e.id}')">分享活動</button>
        ${scanBtn}
      </div>
      <div class="detail-section">
        <div id="detail-attendance-table"></div>
      </div>
      <div class="detail-section" id="detail-unreg-section" style="display:none">
        <div id="detail-unreg-table"></div>
      </div>
      <div id="detail-waitlist-container"></div>
      ${this._renderReviews(e)}
    `;
    const feeLabelEl = Array.from(nodes.body.querySelectorAll('.detail-label'))
      .find(el => String(el.textContent || '').trim() === '費用');
    const feeRowEl = feeLabelEl?.closest('.detail-row');
    if (feeRowEl) {
      if (!feeEnabled) {
        feeRowEl.remove();
      } else {
        feeRowEl.outerHTML = feeRow;
      }
    }
    if (isGuestView) {
      const unregSection = document.getElementById('detail-unreg-section');
      if (unregSection) unregSection.style.display = 'none';
      this._renderGuestAttendanceTable(id, 'detail-attendance-table');
      this._renderGuestWaitlistSection(id, 'detail-waitlist-container');
    } else {
      this._renderAttendanceTable(id, 'detail-attendance-table');
      this._renderUnregTable(id, 'detail-unreg-table');
      this._renderGroupedWaitlistSection(id, 'detail-waitlist-container');
      // 背景更新報名者徽章（不阻塞頁面渲染）
      this._refreshRegistrationBadges?.(id, 'detail-attendance-table')?.catch?.(() => {});
    }
      // ── 內容已渲染就緒，切換顯示頁面（避免空白模板閃現）──
      await this.showPage('page-activity-detail');
      if (requestSeq !== this._eventDetailRequestSeq || this.currentPage !== 'page-activity-detail') {
        return { ok: false, reason: 'stale' };
      }
      // 頁面可見後偵測徽章溢出（hidden 時 scrollWidth=0 無法偵測）
      const attTable = document.getElementById('detail-attendance-table');
      this._markBadgeRowOverflow?.(attTable);
      this._markPageSnapshotReady?.('page-activity-detail');
      return { ok: true, reason: 'ok' };
    } catch (err) {
      console.error('[EventDetail] showEventDetail failed:', err);
      this.showToast('\u7121\u6cd5\u958b\u555f\u6d3b\u52d5\u8a73\u60c5');
      return { ok: false, reason: 'error' };
    }
  },

  // ── 候補名單：分組網格顯示 + 正取編輯模式 ──
  _renderGroupedWaitlistSection(eventId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const e = ApiService.getEvent(eventId);
    if (!e) { container.innerHTML = ''; return; }

    const canManage = this._canManageEvent(e);
    const tableEditing = this._waitlistEditingEventId === eventId;
    const allRegs = ApiService.getRegistrationsByEvent(eventId);
    const getRegTime = (r) => {
      const v = r && r.registeredAt;
      if (!v) return Number.POSITIVE_INFINITY;
      if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (err) {} }
      if (typeof v === 'object' && typeof v.seconds === 'number')
        return (v.seconds * 1000) + Math.floor((v.nanoseconds || 0) / 1000000);
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };
    const waitlistedRegs = allRegs
      .filter(r => r.status === 'waitlisted')
      .sort((a, b) => {
        const ta = getRegTime(a), tb = getRegTime(b);
        if (ta !== tb) return ta - tb;
        const pa = Number(a.promotionOrder || 0), pb = Number(b.promotionOrder || 0);
        if (pa !== pb) return pa - pb;
        const ida = String(a._docId || a.id || ''), idb = String(b._docId || b.id || '');
        if (ida !== idb) return ida.localeCompare(idb);
        return String(a.userName || '').localeCompare(String(b.userName || ''));
      });
    const addedNames = new Set();
    let items = [];

    if (waitlistedRegs.length > 0) {
      const groups = new Map();
      waitlistedRegs.forEach(r => {
        if (!groups.has(r.userId)) groups.set(r.userId, []);
        groups.get(r.userId).push(r);
      });
      groups.forEach((regs, userId) => {
        const selfReg = regs.find(r => r.participantType === 'self');
        const companions = regs.filter(r => r.participantType === 'companion');
        const mainName = selfReg ? selfReg.userName : regs[0].userName;
        const companionItems = companions.map(c => {
          const cName = c.companionName || c.userName;
          const selfConfirmed = allRegs.find(
            r => r.userId === userId && r.participantType === 'self' && r.status === 'confirmed'
          );
          return { name: cName, orphanInfo: selfConfirmed ? selfConfirmed.userName : null };
        });
        let selfOrphanInfo = null;
        if (!selfReg) {
          const selfConfirmed = allRegs.find(
            r => r.userId === userId && r.participantType === 'self' && r.status === 'confirmed'
          );
          if (selfConfirmed) selfOrphanInfo = selfConfirmed.userName;
        }
        items.push({ name: mainName, userId, companions: companionItems, selfOrphanInfo });
        addedNames.add(mainName);
        companionItems.forEach(c => addedNames.add(c.name));
      });
    }
    (typeof this._getWaitlistFallbackNames === 'function' ? this._getWaitlistFallbackNames(eventId, e, allRegs) : (e.waitlistNames || [])).forEach(p => {
      if (!addedNames.has(p)) {
        items.push({ name: p, userId: null, companions: [], selfOrphanInfo: null });
        addedNames.add(p);
      }
    });

    if (items.length === 0) { container.innerHTML = ''; return; }

    const totalCount = items.reduce((sum, it) => sum + 1 + it.companions.length, 0);
    const safeEId = escapeHTML(eventId);
    const safeCId = escapeHTML(containerId);
    const doneBtnStyle = 'font-size:.72rem;padding:.2rem .5rem;background:transparent;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;color:var(--text-primary)';
    const editBtnStyle = 'font-size:.72rem;padding:.2rem .5rem;background:#8b5cf6;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer';
    const editBtnHtml = canManage
      ? (tableEditing
          ? `<button style="${doneBtnStyle}" onclick="App._stopWaitlistDetailEdit('${safeEId}','${safeCId}')">完成</button>`
          : `<button style="${editBtnStyle}" onclick="App._startWaitlistDetailEdit('${safeEId}','${safeCId}')">編輯</button>`)
      : '';
    const titleHtml = `<div class="detail-section-title" style="display:flex;align-items:center;gap:.5rem"><span>候補名單 (${totalCount})</span>${editBtnHtml}</div>`;

    if (tableEditing) {
      // 編輯模式：簡易表格 + 正取按鈕
      const promoteStyle = 'font-size:.72rem;padding:.2rem .45rem;background:#8b5cf6;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer';
      let rows = '';
      items.forEach((item, idx) => {
        const safeUid = item.userId ? escapeHTML(item.userId) : '';
        const promoteBtn = item.userId
          ? `<button style="${promoteStyle}" onclick="App._forcePromoteWaitlist('${safeEId}','${safeUid}')">正取</button>`
          : '';
        rows += `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:.35rem .3rem;text-align:center;width:2rem"><span class="wl-pos">${idx + 1}</span></td>
          <td style="padding:.35rem .3rem;text-align:left">${this._userTag(item.name)}</td>
          <td style="padding:.35rem .3rem;text-align:center;width:3rem">${promoteBtn}</td>
        </tr>`;
        item.companions.forEach(c => {
          const cName = typeof c === 'string' ? c : c.name;
          rows += `<tr style="border-bottom:1px solid var(--border)">
            <td></td>
            <td style="padding:.3rem .3rem;text-align:left;padding-left:1.2rem"><span style="color:var(--text-secondary)">↳ ${escapeHTML(cName)}</span></td>
            <td></td>
          </tr>`;
        });
      });
      container.innerHTML = `<div class="detail-section">
        ${titleHtml}
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.8rem">
            <thead><tr style="border-bottom:2px solid var(--border)">
              <th style="text-align:center;padding:.4rem .3rem;font-weight:600;width:2rem">#</th>
              <th style="text-align:left;padding:.4rem .3rem;font-weight:600">姓名</th>
              <th style="text-align:center;padding:.4rem .3rem;font-weight:600;width:3rem">正取</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
      return;
    }

    // 一般模式：網格顯示
    const COLLAPSE_LIMIT = 10;
    const needCollapse = items.length > COLLAPSE_LIMIT;
    const gridId = 'wl-grid-' + eventId;
    const renderItem = (item, idx) => {
      let h = `<div style="padding:.35rem 0"><div style="display:flex;align-items:center;gap:.3rem">
        <span class="wl-pos">${idx + 1}</span>${this._userTag(item.name)}</div>`;
      if (item.selfOrphanInfo) {
        h += `<div style="padding:.1rem 0 0 1.8rem;font-size:.72rem;color:var(--text-muted)">↳ 報名人：${escapeHTML(item.selfOrphanInfo)}（<span style="color:var(--success)">已正取</span>）</div>`;
      }
      item.companions.forEach(c => {
        const cName = typeof c === 'string' ? c : c.name;
        const orphan = typeof c === 'object' ? c.orphanInfo : null;
        h += `<div style="padding:.15rem 0 0 1.8rem;font-size:.78rem;color:var(--text-secondary)">↳ ${escapeHTML(cName)}</div>`;
        if (orphan) {
          h += `<div style="padding:.1rem 0 0 2.4rem;font-size:.72rem;color:var(--text-muted)">↳ 報名人：${escapeHTML(orphan)}（<span style="color:var(--success)">已正取</span>）</div>`;
        }
      });
      h += '</div>';
      return h;
    };
    let gridItems = '';
    items.forEach((item, idx) => {
      const hidden = needCollapse && idx >= COLLAPSE_LIMIT ? ' style="display:none"' : '';
      gridItems += `<div class="wl-grid-item"${hidden}>${renderItem(item, idx)}</div>`;
    });
    const expandBtn = needCollapse
      ? `<div id="${gridId}-expand" style="text-align:center;margin-top:.4rem">
          <button class="outline-btn" style="font-size:.75rem;padding:.25rem .8rem" onclick="App._expandWaitlistGrid('${gridId}')">展開全部候補 (${items.length})</button>
        </div>`
      : '';
    container.innerHTML = `<div class="detail-section">
      ${titleHtml}
      <div id="${gridId}" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0 .8rem">
        ${gridItems}
      </div>
      ${expandBtn}
    </div>`;
  },

  _expandWaitlistGrid(gridId) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.querySelectorAll('.wl-grid-item').forEach(el => el.style.display = '');
    const btn = document.getElementById(gridId + '-expand');
    if (btn) btn.remove();
  },

  _startWaitlistDetailEdit(eventId, containerId) {
    this._waitlistEditingEventId = eventId;
    this._renderGroupedWaitlistSection(eventId, containerId);
  },

  _stopWaitlistDetailEdit(eventId, containerId) {
    this._waitlistEditingEventId = null;
    this._renderGroupedWaitlistSection(eventId, containerId);
  },

  // ══════════════════════════════════
  //  Event Registration Log
  // ══════════════════════════════════

  _renderEventLogButton(e) {
    const wrap = document.getElementById('detail-log-btn-wrap');
    if (!wrap) return;
    if (!e || !this._canManageEvent(e)) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      return;
    }
    wrap.style.display = '';
    wrap.innerHTML = '<button class="event-reg-log-btn" onclick="App.openEventRegLogModal(\'' + e.id + '\')">Log</button>';
  },

  _regLogToMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (_) {} }
    if (typeof v === 'object' && typeof v.seconds === 'number')
      return (v.seconds * 1000) + Math.floor((v.nanoseconds || 0) / 1000000);
    var t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  },

  async openEventRegLogModal(eventId) {
    var self = this;
    var modal = document.getElementById('event-reg-log-modal');
    var body = document.getElementById('event-reg-log-body');
    if (!modal || !body) return;

    modal.classList.add('open');
    body.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem;font-size:.82rem">\u8f09\u5165\u4e2d\u2026</div>';

    var allRegs;
    if (!ModeManager.isDemo() && typeof db !== 'undefined') {
      try {
        var snap = await db.collection('registrations').where('eventId', '==', eventId).get();
        allRegs = [];
        snap.forEach(function(doc) {
          allRegs.push(Object.assign({ _docId: doc.id, id: doc.id }, doc.data()));
        });
      } catch (err) {
        console.error('[openEventRegLogModal] Firestore query failed, fallback to cache:', err);
        allRegs = ApiService._src('registrations').filter(function(r) { return r.eventId === eventId; });
      }
    } else {
      allRegs = ApiService._src('registrations').filter(function(r) { return r.eventId === eventId; });
    }

    var entries = [];
    allRegs.forEach(function(r) {
      var name = r.companionName || r.userName || '\u672a\u77e5';
      if (r.registeredAt) {
        entries.push({ time: r.registeredAt, ms: self._regLogToMs(r.registeredAt), userName: name, action: 'register' });
      }
      if (r.status === 'cancelled' && r.cancelledAt) {
        entries.push({ time: r.cancelledAt, ms: self._regLogToMs(r.cancelledAt), userName: name, action: 'cancel' });
      }
    });

    entries.sort(function(a, b) { return b.ms - a.ms; });

    if (entries.length === 0) {
      body.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem;font-size:.82rem">\u5c1a\u7121\u5831\u540d\u7d00\u9304</div>';
    } else {
      body.innerHTML = entries.map(function(e) {
        var d = new Date(e.ms);
        var timeStr = String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        var actionCls = e.action === 'cancel' ? 'cancel' : 'reg';
        var actionLabel = e.action === 'cancel' ? '\u53d6\u6d88' : '\u5831\u540d';
        return '<div class="event-reg-log-item">' +
          '<span class="event-reg-log-time">' + timeStr + '</span>' +
          '<span class="event-reg-log-user">' + escapeHTML(e.userName) + '</span>' +
          '<span class="event-reg-log-action ' + actionCls + '">' + actionLabel + '</span>' +
          '</div>';
      }).join('');
    }
  },

  closeEventRegLogModal() {
    var modal = document.getElementById('event-reg-log-modal');
    if (modal) modal.classList.remove('open');
  },

});
