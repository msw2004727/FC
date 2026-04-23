/* ================================================
   SportHub — Event: Detail View
   依賴：event-list.js, config.js, api-service.js
   報名/取消邏輯已搬至 event-detail-signup.js
   評價功能已移除
   ================================================ */

Object.assign(App, {

  _eventDetailRequestSeq: 0,
  _regsLoadingRetryTimer: null,
  _regsLoadingRetryCount: 0,

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
      await FirebaseService.updateEvent(e.id, { isPublic: nextVal });
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
    if (eventRecord.teamOnly) {
      return `<button style="background:#64748b;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed;opacity:.7" disabled>球隊限定</button>`;
    }
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
    // Phase 3 (2026-04-19): 優先從 participantsWithUid / waitlistWithUid 物件陣列取真 UID
    // fieldName='participants' → 對應 participantsWithUid
    // fieldName='waitlistNames' → 對應 waitlistWithUid
    const wuField = fieldName === 'participants' ? 'participantsWithUid' : 'waitlistWithUid';
    const wu = Array.isArray(eventRecord?.[wuField]) ? eventRecord[wuField] : [];
    if (wu.length > 0) {
      return wu
        .filter(x => x && x.uid && x.name)
        .map(({ uid, name, teamKey }) => ({
          name,
          uid,  // 真實 UID，訪客點名字不再跳錯人
          isCompanion: false,
          displayName: name,
          hasSelfReg: true,
          proxyOnly: false,
          teamKey: teamKey || null,
        }));
    }
    // Fallback：舊字串陣列（uid=name 的歷史 bug 行為，participantsWithUid 未遷移前）
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
        ${people.map(person => `<span class="user-capsule uc-user" onclick="App.showUserProfile('${escapeHTML(person.displayName)}',{uid:'${escapeHTML(person.userId || person.uid || '')}'})"> ${escapeHTML(person.displayName)}</span>`).join('')}
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
          ${people.map(person => `<span class="user-capsule uc-user" onclick="App.showUserProfile('${escapeHTML(person.displayName)}',{uid:'${escapeHTML(person.userId || person.uid || '')}'})"> ${escapeHTML(person.displayName)}</span>`).join('')}
        </div>
      </div>`;
  },

  async showEventDetail(id, options = {}) {
    // 翻牌動畫播放中 → 跳過 onSnapshot 觸發的重新渲染（避免 DOM 被中途替換）
    // F1：安全重置 — 超過 5 秒強制解鎖，防止旗標卡死導致所有導航失效
    if (this._flipAnimating) {
      if (this._flipAnimatingAt && Date.now() - this._flipAnimatingAt > 5000) {
        console.warn('[EventDetail] _flipAnimating 超時 5s，強制重置');
        this._flipAnimating = false;
      } else {
        return;
      }
    }
    try {
      // 2026-04-19 UX: 記錄是否為「同活動 re-render」
      // 必須在 _currentDetailEventId 被改寫前捕獲，作為後續保留 attendance DOM 的判斷依據
      const _isSameEventRerender = this.currentPage === 'page-activity-detail'
        && this._currentDetailEventId === id;
      // Fix 1：切換活動時重設重試計數，避免跨活動洩漏
      if (this._currentDetailEventId !== id) {
        this._regsLoadingRetryCount = 0;
        clearTimeout(this._regsLoadingRetryTimer);
      }
      const isGuestView = this._isGuestEventDetailView(options);
      let e = ApiService.getEvent(id);
      // stale-first：快取有活動資料時跳過登入擋板（報名按鈕已有「載入中」保護）
      if (!isGuestView && !e && this._requireLogin()) return { ok: false, reason: 'auth' };
      if (!e) return { ok: false, reason: 'missing' };
      // 外部活動：中繼卡片（YouTube 嵌入 / 跳轉按鈕）
      if (e.type === 'external' && e.externalUrl) {
        this.showExternalTransitCard(e);
        return { ok: true };
      }
      if (!isGuestView && typeof this._canViewEventByTeamScope === 'function' && !this._canViewEventByTeamScope(e)) {
        // v8 M5：訪客情境改為友善提示 + 觸發登入（而非「沒有權限」）
        if (typeof LineAuth !== 'undefined' && !LineAuth.isLoggedIn?.()) {
          this.showToast('此活動限俱樂部成員、請先登入');
          this._requestLoginForAction?.({ type: 'showEventDetail', eventId: id });
        } else {
          this.showToast('\u60a8\u6c92\u6709\u67e5\u770b\u6b64\u6d3b\u52d5\u7684\u6b0a\u9650');
        }
        return { ok: false, reason: 'forbidden' };
      }
      // 2026-04-20：活動黑名單守衛（偽裝「找不到此活動」，不透露被擋事實）
      if (!isGuestView && typeof this._isEventVisibleToUser === 'function') {
        const _uid = ApiService.getCurrentUser?.()?.uid || null;
        if (!this._isEventVisibleToUser(e, _uid)) {
          this.showToast('\u627e\u4e0d\u5230\u6b64\u6d3b\u52d5');  // 找不到此活動
          return { ok: false, reason: 'missing' };
        }
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
      // 2026-04-20：await 期間 blockedUids 可能被更新，重新檢查黑名單
      if (!isGuestView && typeof this._isEventVisibleToUser === 'function') {
        const _uid2 = ApiService.getCurrentUser?.()?.uid || null;
        if (!this._isEventVisibleToUser(e, _uid2)) {
          this.showToast('\u627e\u4e0d\u5230\u6b64\u6d3b\u52d5');  // 找不到此活動
          return { ok: false, reason: 'missing' };
        }
      }
      e = this._syncEventEffectiveStatus?.(e) || e;

      // 驗證 DOM 節點存在（頁面已載入 DOM 但尚未切換顯示）
      const nodes = this._getEventDetailNodes();
      if (!nodes) {
        console.warn('[EventDetail] detail shell missing');
        return { ok: false, reason: 'page-not-ready' };
      }

      this._currentDetailEventId = id;
    // ── 瀏覽數：顯示當前值 + 觸發 +1（登入用戶同日去重，僅正式詳情頁，不含 guest）──
    if (!isGuestView) {
      const _vcSpan = document.getElementById('detail-view-count-num');
      if (_vcSpan) _vcSpan.textContent = (e.viewCount || 0).toLocaleString();
      this._incrementEventViewCount?.(id);
    }
    this._renderEventPublicToggle(isGuestView ? null : e);
    this._renderEventRefreshButton(isGuestView ? null : e);
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
          // Phase 3：count 優先取 e.current，次序 participantsWithUid.length，最後 participants[].length
          count: Number(e.current
            || (Array.isArray(e.participantsWithUid) ? e.participantsWithUid.length : 0)
            || (Array.isArray(e.participants) ? e.participants.length : 0)),
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
    // Fix A+1：首次 snapshot 到達前視為「載入中」；9 秒（3 次重試）後強制解除
    const regsLoading = !isGuestView
      && !FirebaseService._registrationsFirstSnapshotReceived
      && this._regsLoadingRetryCount < 3;
    // 載入中按鈕保護：3 秒後自動重繪，最多重試 3 次（9 秒兜底）
    if (regsLoading) {
      clearTimeout(this._regsLoadingRetryTimer);
      const retryEventId = e.id;
      this._regsLoadingRetryTimer = setTimeout(() => {
        if (this.currentPage === 'page-activity-detail'
          && this._currentDetailEventId === retryEventId
          && !this._flipAnimating) {
          this._regsLoadingRetryCount++;
          // 2026-04-20：snapshot 已到才用局部 patch（避免整頁重繪造成畫面跳動）；
          //             還沒到則維持原 showEventDetail 路徑（保證「載入中」按鈕邏輯正確）
          if (typeof FirebaseService !== 'undefined'
            && FirebaseService._registrationsFirstSnapshotReceived) {
            this._refreshSignupButton?.(retryEventId);
            this._patchDetailTables?.(retryEventId);
          } else {
            this.showEventDetail(retryEventId);
          }
        }
      }, 3000);
    } else {
      clearTimeout(this._regsLoadingRetryTimer);
      this._regsLoadingRetryCount = 0;
    }
    var isSignedUp = isGuestView ? false : (regsLoading ? false : this._isUserSignedUp(e));
    var isOnWaitlist = isSignedUp && this._isUserOnWaitlist(e);

    // Phase 3 安全網：快取說「未報名」但可能是監聽器尚未同步。
    // 對子集合做一次即時查詢確認，若實際已報名則立刻重新渲染。
    if (!isGuestView && !regsLoading && !isSignedUp && !isEnded && e._docId) {
      var _safetyUid = ApiService.getCurrentUser?.()?.uid;
      if (_safetyUid && typeof db !== 'undefined') {
        var _self = this;
        var _safetyEventId = e.id;
        db.collection('events').doc(e._docId).collection('registrations')
          .where('userId', '==', _safetyUid)
          .limit(1)
          .get({ source: 'server' })
          .then(function(snap) {
            var active = snap.docs.filter(function(d) {
              var s = d.data().status;
              return s !== 'cancelled' && s !== 'removed';
            });
            if (active.length > 0
              && _self.currentPage === 'page-activity-detail'
              && _self._currentDetailEventId === _safetyEventId
              && !_self._flipAnimating) {
              // 快取確實落後 — 補入快取
              active.forEach(function(d) {
                var reg = Object.assign({}, d.data(), { _docId: d.id });
                if (reg.userId && !reg.uid) reg.uid = reg.userId;
                var cache = FirebaseService._cache.registrations || [];
                if (!cache.some(function(r) { return r._docId === d.id; })) {
                  cache.push(reg);
                }
              });
              // 2026-04-20：改用局部 patch 避免整頁重繪造成畫面跳動。
              // 快取已補齊，_refreshSignupButton 會正確顯示「取消報名」按鈕
              _self._refreshSignupButton?.(_safetyEventId);
              _self._patchDetailTables?.(_safetyEventId);
            }
          })
          .catch(function() { /* 查詢失敗不影響主流程 */ });
      }
    }
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
      signupBtn = `<button style="background:#64748b;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:not-allowed;opacity:.7" disabled>球隊限定</button>`;
    } else if (genderSignupState.restricted && !genderSignupState.requiresLogin && !genderSignupState.canSignup) {
      signupBtn = `<button style="background:#dc2626;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer;opacity:.95" onclick='App._handleGenderRestrictedClick(${JSON.stringify(genderBlockedMessage)})'>${escapeHTML(this._getEventGenderRibbonText?.(e) || '性別限定')}</button>`;
    } else if (isMainFull) {
      signupBtn = _glowWrap(`<button style="background:#7c3aed;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer" onclick="App.handleSignup('${e.id}')">報名候補</button>`, '#7c3aed', '#a78bfa', '報名候補中');
    } else {
      signupBtn = _glowWrap(`<button class="primary-btn" onclick="App.handleSignup('${e.id}')">立即報名</button>`, 'var(--accent)', 'var(--accent-hover)', '報名中');
    }

    const teamNameLink = e.creatorTeamId
      ? `<a href="javascript:void(0)" onclick="App.showTeamDetail('${e.creatorTeamId}')" style="color:inherit;text-decoration:underline;text-underline-offset:2px">${escapeHTML(e.creatorTeamName || '俱樂部')}</a>`
      : escapeHTML(e.creatorTeamName || '俱樂部');
    const teamTag = e.teamOnly ? `<div class="detail-row"><span class="detail-label">限定</span><span style="color:#e11d48;font-weight:600">${teamNameLink} 專屬活動</span></div>` : '';
    const privateTag = e.privateEvent ? `<div class="detail-row"><span class="detail-label">可見</span><span style="color:#7c3aed;font-weight:600">🔒 私密活動 — 僅限連結分享</span></div>` : '';
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

      // 短文字組（雙欄 grid 流排）
      const _shortCells = [];
      if (feeRow) _shortCells.push(feeRow);
      _shortCells.push(`<div class="detail-row"><span class="detail-label">\u4EBA\u6578</span>\u5DF2\u5831 ${confirmedCount}/${e.max}${waitlistDisplayCount > 0 ? '\u3000\u5019\u88DC ' + waitlistDisplayCount : ''}</div>`);
      _shortCells.push(`<div class="detail-row"><span class="detail-label">\u5012\u6578</span><span style="color:${isEnded ? 'var(--text-muted)' : 'var(--primary)'};font-weight:600">${countdown}</span></div>`);
      const _heatHtml = this._renderHeatPrediction(e);
      if (_heatHtml) _shortCells.push(_heatHtml);
      if (ageTag) _shortCells.push(ageTag);
      if (genderTag) _shortCells.push(genderTag);
      // team-split: 隊伍資訊卡 + 批次操作按鈕
      const _teamInfoHtml = this._tsRenderTeamInfoCards?.(e) || '';
      const _teamBatchHtml = this._tsRenderBatchButtons?.(e) || '';
      if (_teamInfoHtml) _shortCells.push(_teamInfoHtml);
      if (_teamBatchHtml) _shortCells.push(_teamBatchHtml);

      // ── 防跳頂：鎖定容器高度 + 保存 scroll ──
      var _savedScroll = window.scrollY || window.pageYOffset || (document.scrollingElement || document.documentElement).scrollTop || 0;
      // 2026-04-19 UX：同活動 re-render 時捕獲舊名單 DOM，避免外框 innerHTML 改寫
      // + _renderAttendanceTable 100ms debounce + fetch 造成「名單 → 空白 → 名單」的生硬閃爍。
      // 稍後由 _renderAttendanceTable 做原子替換，舊 DOM 持續顯示直到新 DOM 組好。
      // （僅 attendance-table 需要：waitlist/unreg 改寫後立即同步重渲染，無 debounce 空窗）
      // 重要：只在「同活動」re-render 時保留，避免跨活動時看到前一活動的名單
      var _preservedAttHtml = (_isSameEventRerender && !isGuestView)
        ? (document.getElementById('detail-attendance-table')?.innerHTML || '')
        : '';
      // 鎖住容器高度，防止 innerHTML 清空時頁面高度塌縮導致 scroll 被 clamp
      var _lockH = nodes.body.offsetHeight;
      if (_lockH > 0) nodes.body.style.minHeight = _lockH + 'px';
      nodes.body.innerHTML = `
      <div class="detail-row detail-row-wide"><span class="detail-label">\u5730\u9EDE</span>${locationHtml}</div>
      <div class="detail-row detail-row-wide"><span class="detail-label">\u6642\u9593</span>${escapeHTML(e.date)}</div>
      ${regOpenHtml ? regOpenHtml.replace('detail-row"', 'detail-row detail-row-wide"') : ''}
      <div class="detail-grid">${_shortCells.join('')}</div>
      <div class="detail-row detail-row-wide"><span class="detail-label">\u4E3B\u8FA6</span><span class="participant-list" style="display:inline-flex;gap:.3rem;flex-wrap:wrap">${this._userTag(e.creator, null, { uid: e.creatorUid || '' })}</span></div>
      ${(e.delegates && e.delegates.length) ? `<div class="detail-row detail-row-wide"><span class="detail-label">\u59D4\u8A17</span><span class="participant-list" style="display:inline-flex;gap:.3rem;flex-wrap:wrap">${e.delegates.map(d => this._userTag(d.name, null, { uid: d.uid || '' })).join('')}</span></div>` : ''}
      ${e.contact ? `<div class="detail-row detail-row-wide"><span class="detail-label">\u806F\u7E6B</span>${escapeHTML(e.contact)}</div>` : ''}
      ${teamTag ? teamTag.replace('detail-row"', 'detail-row detail-row-wide"') : ''}
      ${privateTag ? privateTag.replace('detail-row"', 'detail-row detail-row-wide"') : ''}
      ${e.notes ? `
      <div class="detail-section">
        <div class="detail-section-title">注意事項</div>
        <p style="font-size:.85rem;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap">${escapeHTML(e.notes)}</p>
      </div>` : ''}
      <div class="detail-action-zone">
        <div class="detail-action-toolbar">
          <button class="detail-toolbar-btn" onclick="App.contactEventOrganizer('${escapeHTML(e.creator)}')">\u806F\u7E6B\u4E3B\u8FA6</button>
          <button class="detail-toolbar-btn" onclick="App.shareEvent('${e.id}')">\u5206\u4EAB\u6D3B\u52D5</button>
          <button class="detail-toolbar-btn" onclick="App.addEventToCalendar('${e.id}')">\u52A0\u5165\u884C\u4E8B\u66C6</button>
          ${canScan ? `<button class="detail-toolbar-btn" onclick="App.goToScanForEvent('${e.id}')">\u73FE\u5834\u7C3D\u5230</button>` : ''}
        </div>
        ${(this._tsRenderTeamSelectUI?.(e, this._tsSelectedTeamKey) || '')}
        <div class="detail-action-primary">${signupBtn}</div>
      </div>
      <div class="detail-section">
        <div id="detail-attendance-table"></div>
      </div>
      <div class="detail-section" id="detail-unreg-section" style="display:none">
        <div id="detail-unreg-table"></div>
      </div>
      <div id="detail-waitlist-container"></div>
    `;
    // ── 防跳頂：解鎖高度 + 多重 scroll 恢復 ──
    // 內容已填入，解鎖 minHeight
    requestAnimationFrame(function() { nodes.body.style.minHeight = ''; });
    // 多重恢復（覆蓋各瀏覽器/WebView 的不同 reflow 時機）
    if (_savedScroll > 0) {
      window.scrollTo(0, _savedScroll);
      requestAnimationFrame(function() { window.scrollTo(0, _savedScroll); });
      var _self = this;
      setTimeout(function() { if (_self.currentPage === 'page-activity-detail') window.scrollTo(0, _savedScroll); }, 50);
      setTimeout(function() { if (_self.currentPage === 'page-activity-detail') window.scrollTo(0, _savedScroll); }, 150);
    }
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
      this._renderUnregTable(id, 'detail-unreg-table');
      this._renderGroupedWaitlistSection(id, 'detail-waitlist-container');
    }
      // ── 先切換頁面，讓用戶立即看到活動資訊 ──
      const _isReRender = this.currentPage === 'page-activity-detail' && this._currentDetailEventId === id;
      // re-render 同一活動時跳過 showPage（避免跳頂）
      if (!_isReRender) {
        // stale 檢查：用戶可能在 await 期間已導航到其他頁面，不可再拉回
        if (requestSeq !== this._eventDetailRequestSeq) return { ok: false, reason: 'stale' };
        await this.showPage('page-activity-detail');
      }
      if (requestSeq !== this._eventDetailRequestSeq || this.currentPage !== 'page-activity-detail') {
        return { ok: false, reason: 'stale' };
      }
      // 2026-04-19 UX：attendance-table 初始狀態處理
      //  - 同活動 re-render：還原舊名單 DOM（避免 100ms debounce + fetch 期間閃空白）
      //  - 切到新活動：顯示 loading skeleton（避免殘留前活動名單）
      if (!isGuestView) {
        const _attSkel = document.getElementById('detail-attendance-table');
        if (_attSkel) {
          if (_preservedAttHtml) {
            // Re-render：還原舊內容（稍後由 _renderAttendanceTable 原子替換為新資料）
            _attSkel.innerHTML = _preservedAttHtml;
          } else if (!_isReRender) {
            // 首次進入（不同活動或來自其他頁面）：skeleton 載入中
            const _expected = Number(e.current || 0)
              || (Array.isArray(e.participantsWithUid) ? e.participantsWithUid.length : 0)
              || (Array.isArray(e.participants) ? e.participants.length : 0);
            if (_expected > 0) {
              const _rowCount = Math.min(3, _expected);
              const _rows = Array(_rowCount).fill('<div class="reg-loading-skeleton-row"></div>').join('');
              _attSkel.innerHTML = '<div class="reg-loading">報名名單載入中...</div>'
                + '<div class="reg-loading-skeleton">' + _rows + '</div>';
            } else {
              _attSkel.innerHTML = '';
            }
          }
        }
      }
      // ── 頁面可見後，背景載入簽到表格（不阻塞頁面顯示）──
      if (!isGuestView) {
        await this._renderAttendanceTable(id, 'detail-attendance-table');
        // 2026-04-19：await 期間用戶可能切到別的活動，需再次 stale check 避免覆蓋新內容
        if (requestSeq !== this._eventDetailRequestSeq
          || this.currentPage !== 'page-activity-detail'
          || this._currentDetailEventId !== id) {
          return { ok: false, reason: 'stale' };
        }
        this._refreshRegistrationBadges?.(id, 'detail-attendance-table')?.catch?.(() => {});
      }
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
    // 2026-04-20：鎖容器高度，防 innerHTML 替換期間頁面縮短導致 scrollTop 被 clamp
    App._lockContainerHeight?.(container);
    var _wlScrollEl = document.scrollingElement || document.documentElement;
    var _wlSavedScroll = _wlScrollEl.scrollTop;
    const e = ApiService.getEvent(eventId);
    if (!e) { container.innerHTML = ''; _wlScrollEl.scrollTop = _wlSavedScroll; return; }

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

    // 依 event.waitlistNames 順序重排，確保所有角色看到一致排序
    const wlOrder = e.waitlistNames || [];
    if (wlOrder.length > 0) {
      const orderMap = new Map();
      wlOrder.forEach((name, i) => orderMap.set(name, i));
      items.sort((a, b) => {
        const ia = orderMap.has(a.name) ? orderMap.get(a.name) : 99999;
        const ib = orderMap.has(b.name) ? orderMap.get(b.name) : 99999;
        return ia - ib;
      });
    }

    if (items.length === 0) { container.innerHTML = ''; _wlScrollEl.scrollTop = _wlSavedScroll; return; }

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
          <td style="padding:.35rem .3rem;text-align:left">${this._userTag(item.name, null, { uid: item.userId || '' })}</td>
          <td style="padding:.35rem .3rem;text-align:center;width:3rem">${promoteBtn}</td>
        </tr>`;
        item.companions.forEach(c => {
          const cName = typeof c === 'string' ? c : c.name;
          rows += `<tr style="border-bottom:1px solid var(--border)">
            <td></td>
            <td style="padding:.3rem .3rem;text-align:left;padding-left:1.2rem" data-no-translate><span style="color:var(--text-secondary)">↳ ${escapeHTML(cName)}</span></td>
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
      _wlScrollEl.scrollTop = _wlSavedScroll;
      return;
    }

    // 一般模式：網格顯示
    const COLLAPSE_LIMIT = 10;
    const needCollapse = items.length > COLLAPSE_LIMIT;
    const gridId = 'wl-grid-' + eventId;
    const renderItem = (item, idx) => {
      let h = `<div style="padding:.35rem 0"><div style="display:flex;align-items:center;gap:.3rem">
        <span class="wl-pos">${idx + 1}</span>${this._userTag(item.name, null, { uid: item.userId || '' })}</div>`;
      if (item.selfOrphanInfo) {
        h += `<div style="padding:.1rem 0 0 1.8rem;font-size:.72rem;color:var(--text-muted)" data-no-translate>↳ 報名人：${escapeHTML(item.selfOrphanInfo)}（<span style="color:var(--success)">已正取</span>）</div>`;
      }
      item.companions.forEach(c => {
        const cName = typeof c === 'string' ? c : c.name;
        const orphan = typeof c === 'object' ? c.orphanInfo : null;
        h += `<div style="padding:.15rem 0 0 1.8rem;font-size:.78rem;color:var(--text-secondary)" data-no-translate>↳ ${escapeHTML(cName)}</div>`;
        if (orphan) {
          h += `<div style="padding:.1rem 0 0 2.4rem;font-size:.72rem;color:var(--text-muted)" data-no-translate>↳ 報名人：${escapeHTML(orphan)}（<span style="color:var(--success)">已正取</span>）</div>`;
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
    _wlScrollEl.scrollTop = _wlSavedScroll;
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

  _renderEventRefreshButton(e) {
    const wrap = document.getElementById('detail-refresh-btn-wrap');
    if (!wrap) return;
    if (!e) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
    wrap.style.display = '';
    wrap.innerHTML = '<button class="event-detail-refresh-btn" onclick="App._refreshEventDetail()" title="重新整理"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg></button>';
  },

  async _refreshEventDetail() {
    const id = this._currentDetailEventId;
    if (!id) return;
    const btn = document.querySelector('.event-detail-refresh-btn');
    if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
    try {
      // 從 Firestore 直接讀取最新 event 資料
      if (typeof db !== 'undefined') {
        const docId = (ApiService.getEvent(id) || {})?._docId;
        if (docId) {
          const doc = await db.collection('events').doc(docId).get();
          if (doc.exists) {
            const fresh = { ...doc.data(), _docId: doc.id };
            const cached = (FirebaseService._cache.events || []);
            const idx = cached.findIndex(e => e.id === fresh.id || e._docId === fresh._docId);
            if (idx >= 0) Object.assign(cached[idx], fresh);
            else cached.push(fresh);
          }
        }
      }
      this.showEventDetail(id);
    } catch (err) {
      console.warn('[refreshEventDetail]', err);
      this.showToast?.('刷新失敗，請稍後再試');
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
    }
  },

  // ── 瀏覽數 +1（登入用戶同日去重，localStorage 擋住重複）──
  async _incrementEventViewCount(eventId) {
    try {
      if (!eventId) return;
      if (typeof firebase === 'undefined' || !firebase.firestore || !firebase.auth) return;
      if (!firebase.auth().currentUser) return;
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const lsKey = `view_${eventId}_${today}`;
      if (localStorage.getItem(lsKey)) return;
      localStorage.setItem(lsKey, '1');

      const ev = (typeof ApiService !== 'undefined' && ApiService.getEvent) ? ApiService.getEvent(eventId) : null;
      const docId = ev?._docId;
      if (!docId) return;

      await firebase.firestore().collection('events').doc(docId).update({
        viewCount: firebase.firestore.FieldValue.increment(1)
      });
      if (ev) ev.viewCount = (ev.viewCount || 0) + 1;
      const span = document.getElementById('detail-view-count-num');
      if (span && ev) span.textContent = (ev.viewCount || 0).toLocaleString();
    } catch (err) {
      console.warn('[viewCount] increment failed:', err);
    }
  },

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
    if (typeof db !== 'undefined') {
      try {
        var _eventDocId = await FirebaseService._getEventDocIdAsync(eventId);
        if (!_eventDocId) throw new Error('eventDocId not found');
        var snap = await db.collection('events').doc(_eventDocId).collection('registrations').get();
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

    // 內聯時間解析（避免 this/self 綁定問題）
    var _toMs = function(v) {
      if (!v) return 0;
      if (typeof v === 'number') return v;
      if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch(_) {} }
      if (typeof v.toDate === 'function') { try { return v.toDate().getTime(); } catch(_) {} }
      if (typeof v === 'object' && typeof (v.seconds || v._seconds) === 'number') {
        return ((v.seconds || v._seconds) * 1000) + Math.floor(((v.nanoseconds || v._nanoseconds || 0) / 1000000));
      }
      var t = new Date(v).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    var entries = [];
    allRegs.forEach(function(r) {
      var name = r.companionName || r.userName || '\u672a\u77e5';
      if (r.registeredAt) {
        entries.push({ time: r.registeredAt, ms: _toMs(r.registeredAt), userName: name, action: 'register' });
      }
      if (r.status === 'cancelled' && r.cancelledAt) {
        entries.push({ time: r.cancelledAt, ms: _toMs(r.cancelledAt), userName: name, action: 'cancel' });
      }
    });

    // 從 Firestore 查詢操作日誌：只用 eventId 精確查（不再 fallback 到 title 模糊比對，避免撈到其他場次）
    var _opLogActions = { 'force_promote': 'promote', 'auto_promote': 'promote', 'force_demote': 'demote', 'capacity_demote': 'demote' };
    var _opLogLabels = { 'force_promote': '\u624b\u52d5\u6b63\u53d6', 'auto_promote': '\u81ea\u52d5\u905e\u88dc', 'force_demote': '\u4e0b\u653e\u5019\u88dc', 'capacity_demote': '\u5bb9\u91cf\u964d\u7d1a' };
    var _addOpLogEntries = function(snap) {
      snap.forEach(function(doc) {
        var log = doc.data();
        if (!_opLogActions[log.type]) return;
        var logMs = _toMs(log.createdAt);
        if (!logMs) {
          var _m = String(doc.id).match(/op_(\d{13,})/);
          if (_m) logMs = Number(_m[1]);
        }
        if (!logMs) return;
        var _detail = String(log.content || '');
        var _nameStart = _detail.indexOf('\u5019\u88dc ');
        var _nameStart2 = _detail.indexOf('\u5c07 ');
        var _extractedName = '';
        if (_nameStart >= 0) _extractedName = _detail.slice(_nameStart + 3).replace(/\s*\u81ea\u52d5\u905e\u88dc.*/, '').replace(/\s*\u964d\u70ba.*/, '').trim();
        else if (_nameStart2 >= 0) _extractedName = _detail.slice(_nameStart2 + 2).replace(/\s*\u5f9e\u5019\u88dc.*/, '').replace(/\s*\u4e0b\u653e.*/, '').trim();
        else _extractedName = _detail;
        entries.push({ time: log.time || log.createdAt, ms: logMs, userName: _extractedName || _detail, action: _opLogActions[log.type], label: _opLogLabels[log.type] });
      });
    };
    if (typeof db !== 'undefined') {
      var opTypes = Object.keys(_opLogActions);
      try {
        // 只用 eventId 精確查詢（舊日誌沒有 eventId 的就不顯示，避免撈到其他同名場次的資料）
        var opSnap = await db.collection('operationLogs').where('type', 'in', opTypes).where('eventId', '==', eventId).get();
        _addOpLogEntries(opSnap);
      } catch (err) {
        console.warn('[openEventRegLogModal] opLog query failed:', err);
      }
    }

    entries.sort(function(a, b) { return b.ms - a.ms; });

    if (entries.length === 0) {
      body.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem;font-size:.82rem">\u5c1a\u7121\u5831\u540d\u7d00\u9304</div>';
    } else {
      body.innerHTML = entries.map(function(e) {
        var d = new Date(e.ms);
        var timeStr = String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        var actionCls = e.action === 'cancel' ? 'cancel' : e.action === 'promote' ? 'promote' : e.action === 'demote' ? 'demote' : 'reg';
        var actionLabel = e.label || (e.action === 'cancel' ? '\u53d6\u6d88' : '\u5831\u540d');
        return '<div class="event-reg-log-item">' +
          '<span class="event-reg-log-time">' + timeStr + '</span>' +
          '<span class="event-reg-log-user" data-no-translate>' + escapeHTML(e.userName) + '</span>' +
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
