/* ================================================
   SportHub — Event List: Home Section, Game Shortcuts, Hot Events Render
   依賴：config.js, api-service.js, event-list-helpers.js, event-list-stats.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Home Section Visibility
  // ══════════════════════════════════

  _setHomeSectionVisibility(sectionContent, isVisible, skipContent) {
    const contentEl = typeof sectionContent === 'string'
      ? document.getElementById(sectionContent)
      : sectionContent;
    if (!contentEl) return;

    const display = isVisible ? '' : 'none';
    if (!skipContent) contentEl.style.display = display;

    // Find heading (.home-heading) + preceding divider
    let el = contentEl.previousElementSibling;
    while (el) {
      if (el.classList.contains('home-heading') || el.classList.contains('section-title')) {
        el.style.display = display;
        // Check for divider right before heading
        const prev = el.previousElementSibling;
        if (prev && prev.classList.contains('home-divider')) {
          prev.style.display = display;
        }
        break;
      }
      el = el.previousElementSibling;
    }
  },

  // ══════════════════════════════════
  //  Home Game Shortcuts
  // ══════════════════════════════════

  _isHomeGameVisible(gameKey) {
    const gameConfig = Array.isArray(HOME_GAME_PRESETS)
      ? HOME_GAME_PRESETS.find(item => item && item.gameKey === gameKey)
      : null;
    if (!gameConfig) return false;
    if (gameConfig.enabled === false) return false;

    if (!this.hasPermission('activity.manage.entry')) return false;

    // Firestore gameConfigs 可覆蓋 preset 的 homeVisible 設定
    if (typeof ApiService !== 'undefined' && typeof ApiService.isHomeGameVisible === 'function') {
      return ApiService.isHomeGameVisible(gameKey);
    }
    // 無 Firestore 覆蓋時使用 preset 預設值
    return gameConfig.homeVisible !== false;
  },

  _isHomeGameShortcutAvailable() {
    return this._isHomeGameVisible('shot-game');
  },

  renderHomeGameShortcut() {
    const shotCard = document.getElementById('home-game-card-shot');
    const kickCard = document.getElementById('home-game-card-kick');
    const shotAvailable = this._isHomeGameVisible('shot-game');
    const kickAvailable = this._isHomeGameVisible('kick-game');
    const anyVisible = shotAvailable || kickAvailable;

    if (shotCard) shotCard.style.display = shotAvailable ? '' : 'none';
    if (kickCard) kickCard.style.display = kickAvailable ? '' : 'none';

    // Toggle heading + divider (skip content — cards handled above)
    const firstCard = shotCard || kickCard;
    if (firstCard) {
      this._setHomeSectionVisibility(firstCard, anyVisible, true);
    }
  },

  // ══════════════════════════════════
  //  Loading Hint / Toast
  // ══════════════════════════════════

  _shouldShowHomeEventLoadingHint() {
    const lineAuth = typeof LineAuth !== 'undefined' ? LineAuth : null;
    const isLoggedIn = !!lineAuth?.isLoggedIn?.();
    const hasSession = !!lineAuth?.hasLiffSession?.();
    const authPending = !!lineAuth?.isPendingLogin?.() || (hasSession && !isLoggedIn);
    const definitelyLoggedOut = !isLoggedIn && !authPending && !hasSession;
    if (definitelyLoggedOut) return false;

    const publicDataPending = typeof FirebaseService !== 'undefined' && FirebaseService && !FirebaseService._initialized;
    const cloudPending = !this._cloudReady || !!this._cloudReadyPromise;
    return authPending || publicDataPending || cloudPending;
  },

  _showHomeEventLoadingToast(isSlow = false) {
    const now = Date.now();
    const cooldownMs = isSlow ? 1400 : 900;
    if (now - (this._homeEventLoadingToastAt || 0) < cooldownMs) return;
    this._homeEventLoadingToastAt = now;

    // Show persistent toast (no auto-dismiss)
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = isSlow ? '網路較慢，活動資料仍在載入中...' : '活動資料載入中，請稍候 1-2 秒';
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    // Keep toast visible — do NOT set auto-dismiss timer

    // 5s escalation: change message to reload hint
    clearTimeout(this._homeEventLoadingEscalateTimer);
    this._homeEventLoadingEscalateTimer = setTimeout(() => {
      if (!toast.classList.contains('show')) return;
      toast.textContent = '若加載過久請關閉所有分頁並重整瀏覽器';
    }, 5000);
  },

  _dismissHomeEventLoadingToast() {
    clearTimeout(this._homeEventLoadingEscalateTimer);
    this._homeEventLoadingEscalateTimer = null;
    const toast = document.getElementById('toast');
    if (toast) toast.classList.remove('show');
  },

  // ══════════════════════════════════
  //  Home Card Loading Bar
  // ══════════════════════════════════

  _homeCardLoadingState: null, // { eventId, progress, startedAt, interval }

  _markHomeEventCardPending(cardEl) {
    if (!cardEl || !cardEl.classList) return;
    const eventId = this._getCardEventId(cardEl);
    cardEl.classList.add('is-pending');
    cardEl.setAttribute('aria-busy', 'true');
    this._injectCardLoadingBar(cardEl);

    // Start or continue simulated progress tracked by eventId
    if (!this._homeCardLoadingState || this._homeCardLoadingState.eventId !== eventId) {
      clearInterval(this._homeCardLoadingState?.interval);
      const state = { eventId, progress: 0, startedAt: Date.now(), interval: null };
      state.interval = setInterval(() => {
        const p = state.progress;
        const inc = p < 30 ? 4 : p < 60 ? 2 : p < 80 ? 0.5 : 0.15;
        state.progress = Math.min(p + inc, 85);
        // Update fill on the current DOM element (may have been rebuilt)
        const card = this._findCardByEventId(state.eventId);
        const fill = card && card.querySelector('.h-card-loading-fill');
        if (fill) fill.style.width = state.progress + '%';
      }, 100);
      this._homeCardLoadingState = state;
    }
  },

  _clearHomeEventCardPending(cardEl, minVisibleMs = 0) {
    const state = this._homeCardLoadingState;
    if (!state) return;

    clearInterval(state.interval);
    state.interval = null;

    const elapsed = Date.now() - state.startedAt;
    const waitMs = Math.max(0, minVisibleMs - elapsed);
    const eventId = state.eventId;

    setTimeout(() => {
      const card = this._findCardByEventId(eventId) || cardEl;
      if (!card) { this._homeCardLoadingState = null; return; }

      // Snap to 100%
      const fill = card.querySelector('.h-card-loading-fill');
      if (fill) fill.style.width = '100%';

      // After fill reaches 100%, fade out overlay + remove bar
      setTimeout(() => {
        const card2 = this._findCardByEventId(eventId) || card;
        if (card2) card2.classList.add('is-loaded');
        setTimeout(() => {
          const card3 = this._findCardByEventId(eventId) || card2;
          if (card3) {
            card3.classList.remove('is-pending', 'is-loaded');
            card3.removeAttribute('aria-busy');
            const bar = card3.querySelector('.h-card-loading-bar');
            if (bar) bar.remove();
          }
          this._homeCardLoadingState = null;
        }, 400);
      }, 350);
    }, waitMs);
  },

  _injectCardLoadingBar(cardEl) {
    const imgEl = cardEl && cardEl.querySelector('.h-card-img');
    if (!imgEl || imgEl.querySelector('.h-card-loading-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'h-card-loading-bar';
    const fill = document.createElement('div');
    fill.className = 'h-card-loading-fill';
    bar.appendChild(fill);
    imgEl.appendChild(bar);
    // Restore current progress if available
    const state = this._homeCardLoadingState;
    if (state) {
      fill.style.width = state.progress + '%';
    }
  },

  _getCardEventId(cardEl) {
    if (!cardEl) return null;
    const onclick = cardEl.getAttribute('onclick') || '';
    const m = onclick.match(/openHomeEventDetailFromCard\(['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  },

  _findCardByEventId(eventId) {
    if (!eventId) return null;
    const container = document.getElementById('hot-events');
    if (!container) return null;
    const cards = container.querySelectorAll('.h-card');
    for (const c of cards) {
      if (this._getCardEventId(c) === eventId) return c;
    }
    return null;
  },

  async openHomeEventDetailFromCard(eventId, cardEl) {
    const safeEventId = String(eventId || '').trim();
    const targetCard = cardEl?.closest ? cardEl.closest('.h-card') : cardEl;
    if (!safeEventId) return { ok: false, reason: 'missing-id' };

    // 外部活動：中繼卡片
    const extEvent = ApiService.getEvent(safeEventId);
    if (extEvent?.type === 'external' && extEvent.externalUrl) {
      this.showExternalTransitCard(extEvent);
      return { ok: true };
    }

    if (targetCard?.dataset?.homeEventOpening === '1') {
      this._markHomeEventCardPending(targetCard);
      if (Date.now() - Number(targetCard?._homeEventOpenStartedAt || 0) >= 1000) {
        this._showHomeEventLoadingToast(true);
      }
      return { ok: false, reason: 'pending' };
    }

    const shouldHintLoading = this._shouldShowHomeEventLoadingHint();
    if (targetCard?.dataset) {
      targetCard.dataset.homeEventOpening = '1';
    }
    if (targetCard) {
      targetCard._homeEventOpenStartedAt = Date.now();
    }
    if (shouldHintLoading) {
      this._markHomeEventCardPending(targetCard);
      if (targetCard) {
        clearTimeout(targetCard._homeEventLoadingToastTimer);
        targetCard._homeEventLoadingToastTimer = setTimeout(() => {
          if (targetCard?.dataset?.homeEventOpening === '1') {
            this._showHomeEventLoadingToast(false);
          }
        }, 1000);
      }
    }

    try {
      const result = await this.showEventDetail(safeEventId);
      if (!result?.ok && result?.reason === 'missing') {
        this.showToast('活動資料暫時無法開啟，請稍後再試');
      }
      return result;
    } catch (err) {
      console.error('[HomeEventClick] open detail failed:', err);
      this.showToast('活動資料暫時無法開啟，請稍後再試');
      return { ok: false, reason: 'error' };
    } finally {
      if (targetCard) {
        clearTimeout(targetCard._homeEventLoadingToastTimer);
        targetCard._homeEventLoadingToastTimer = null;
      }
      this._dismissHomeEventLoadingToast();
      this._clearHomeEventCardPending(targetCard, shouldHintLoading ? 650 : 0);
      if (targetCard?.dataset) {
        clearTimeout(targetCard._homeEventOpenLockTimer);
        targetCard._homeEventOpenLockTimer = setTimeout(() => {
          delete targetCard.dataset.homeEventOpening;
          targetCard._homeEventOpenStartedAt = 0;
          targetCard._homeEventOpenLockTimer = null;
        }, shouldHintLoading ? 900 : 320);
      }
    }
  },

});
