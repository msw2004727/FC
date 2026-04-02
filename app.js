/* ================================================
   SportHub — App Controller (Core)
   依賴：config.js, api-service.js
   擴充：js/core/*.js, js/modules/*.js (Object.assign)
   ================================================ */

/* 管理工具：掃描並修復 activityRecords 狀態不一致 */
window._scanAR = async function(fix) {
  try {
    alert('scanning...');
    var arSnap = await db.collection('activityRecords').where('status', '==', 'registered').get();
    alert('found ' + arSnap.size + ' registered records, checking...');
    var regSnap = await db.collection('registrations').where('status', '==', 'cancelled').get();
    var cancelledMap = {};
    regSnap.forEach(function(rd) {
      var r = rd.data();
      var key = (r.userId || '') + '|' + (r.eventId || '');
      cancelledMap[key] = true;
    });
    var issues = [];
    arSnap.forEach(function(doc) {
      var ar = doc.data();
      if (!ar.uid || !ar.eventId) return;
      var key = ar.uid + '|' + ar.eventId;
      if (cancelledMap[key]) {
        issues.push(doc.id + '|' + (ar.name || '') + '|' + ar.uid.substring(0, 8));
      }
    });
    var msg = 'registered AR: ' + arSnap.size + ', cancelled reg match: ' + issues.length;
    if (issues.length > 0) {
      msg += '\n' + issues.join('\n');
    }
    alert(msg);
    if (fix && issues.length > 0) {
      for (var i = 0; i < issues.length; i++) {
        var docId = issues[i].split('|')[0];
        await db.collection('activityRecords').doc(docId).update({ status: 'cancelled' });
      }
      alert('fixed ' + issues.length);
    }
  } catch (e) {
    alert('error: ' + e.message);
  }
};

function _createSportHubTimeoutError(code, message) {
  const err = new Error(message || code || 'TIMEOUT');
  err.code = code || 'timeout';
  return err;
}

function _withSportHubTimeout(promise, ms, code, message) {
  const timeoutMs = Number(ms || 0);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.resolve(promise);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(_createSportHubTimeoutError(code, message));
    }, timeoutMs);

    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** 隱藏啟動 loading overlay（進度條跳 100% → 150ms 後淡出） */
function _dismissBootOverlay(reason) {
  try {
    var _ov = document.getElementById('loading-overlay');
    if (!_ov || _ov.style.display === 'none') return;
    if (window._bootLoadingAnim) window._bootLoadingAnim.stop();
    var _pct = _ov.querySelector('.boot-loading__pct');
    var _fill = _ov.querySelector('.boot-loading__fill');
    var _bar = _ov.querySelector('.boot-loading__bar');
    if (_pct) _pct.textContent = '100%';
    if (_fill) _fill.style.width = '100%';
    if (_bar) _bar.setAttribute('aria-valuenow', '100');
    setTimeout(function() {
      _ov.style.display = 'none';
      console.log('[Boot] 載入畫面已隱藏（' + (reason || '') + '）');
      _startContentStallCheck();
    }, 150);
    if (window._loadingSafety) { clearTimeout(window._loadingSafety); window._loadingSafety = null; }
  } catch (_) {}
}

/**
 * 白屏卡住偵測：boot-loading 消失後 6 秒，
 * 若頁面內容仍未渲染（_contentReady === false）則顯示重整提示。
 * 僅觸發一次，不自動重整，由用戶決定。
 */
function _startContentStallCheck() {
  if (window._contentStallTimer) return;
  window._contentStallTimer = setTimeout(function() {
    window._contentStallTimer = null;
    if (window._contentReady) return;
    console.warn('[Stall] 頁面內容未在 6 秒內渲染完成，顯示重整提示');
    var el = document.createElement('div');
    el.id = 'content-stall-hint';
    el.setAttribute('role', 'alert');
    el.setAttribute('style',
      'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
      'background:rgba(0,0,0,.85);color:#fff;padding:12px 20px;border-radius:12px;' +
      'font-size:14px;z-index:9999;text-align:center;max-width:420px;white-space:nowrap;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.3);'
    );
    el.innerHTML =
      '<div style="margin-bottom:8px">連線暫時不穩定</div>' +
      '<button id="stall-reload-btn" style="' +
        'background:#0d9488;color:#fff;border:none;padding:8px 24px;' +
        'border-radius:8px;font-size:14px;font-weight:600;cursor:pointer' +
      '">再試一次</button>' +
      '<div style="margin-top:6px;font-size:11px;opacity:.7">或稍後再開啟 APP</div>';
    document.body.appendChild(el);
    document.getElementById('stall-reload-btn').addEventListener('click', function() {
      if (typeof _markWsBlocked === 'function') _markWsBlocked();
      location.reload();
    });
  }, 6000);
}

const App = {
  currentRole: 'user',
  currentPage: 'page-home',
  currentTournament: 't1',
  _userTeam: 'tm1',
  pageHistory: [],
  bannerIndex: 0,
  bannerTimer: null,
  _bootDeepLink: null,
  _bootDeepLinkTimer: null,
  _bootDeepLinkPoller: null,
  _deepLinkBootTimeoutMs: 12000,
  _deepLinkAuthRedirecting: false,
  _pendingDeepLinkOpenKey: '',
  _pendingDeepLinkOpenPromise: null,
  _deepLinkRestFetch: null,
  _deepLinkRendered: false,
  _instantDeepLinkMode: false,
  _instantDeepLinkEventId: null,
  _cloudReady: false,
  _cloudBootScheduled: false,
  _cloudReadyPromise: null,
  _cloudReadyError: null,
  _homeDeferredIdleId: null,
  _homeDeferredTimerId: null,
  _homeDeferredSeq: 0,
  _routeLoadingSeq: 0,
  _routeLoadingShowTimer: null,
  _routeLoadingSlowTimer: null,
  _routeLoadingHideTimer: null,
  _routeLoadingShownAt: 0,
  _routeStepTimeoutMs: 15000,
  _routeCloudTimeoutMs: 15000,
  _scriptLoadTimeoutMs: 18000,
  _pendingProtectedBootRoute: null,
  _pendingProtectedBootRoutePromise: null,
  _pendingAuthAction: null,
  _pendingAuthActionPromise: null,
  _pendingAuthActionStorageKey: '_pendingAuthAction',
  _pageSnapshotReady: {},

  _qrPopupLoading: false,

  /** 首頁 QR 按鈕入口：確保 profile script 已載入後再顯示 */
  async _openQrPopup() {
    if (this._qrPopupLoading) return;
    // 快取秒開：script 尚未載入也能即時顯示 QR 彈窗
    try {
      const cachedUid = localStorage.getItem('shub_qr_uid');
      const cachedData = localStorage.getItem('shub_qr_data');
      if (cachedUid && cachedUid !== 'unknown' && cachedData && cachedData.indexOf('data:image/') === 0) {
        const modal = document.getElementById('uid-qr-modal');
        const content = document.getElementById('uid-qr-content');
        if (modal && content) {
          const safeUid = escapeHTML(cachedUid);
          content.innerHTML = '<div style="font-size:.85rem;font-weight:700;margin-bottom:.8rem">\u6211\u7684 UID QR Code</div>'
            + '<div style="background:#fff;display:inline-block;padding:4px;border-radius:var(--radius)">'
            + '<img src="' + cachedData + '" width="270" height="270" alt="QR Code" style="display:block">'
            + '</div>'
            + '<div style="margin-top:.7rem;font-size:.75rem;color:var(--text-muted);word-break:break-all">' + safeUid + '</div>'
            + '<button onclick="App._copyUidSafe(\'' + safeUid + '\')" style="margin-top:.6rem;padding:.45rem 1.2rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-elevated);color:var(--text-primary);font-size:.8rem;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:.3rem">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>'
            + '\u8907\u88FD UID</button>';
          modal.style.display = 'flex';
          return;
        }
      }
    } catch (e) { /* localStorage 不可用 */ }
    // 無快取：載入 profile scripts 後走正常流程
    this._qrPopupLoading = true;
    const needLoad = !this.showUidQrCode;
    const seq = needLoad
      ? this._beginRouteLoading({ pageId: 'page-qrcode', immediate: true })
      : 0;
    try {
      if (needLoad) {
        if (typeof ScriptLoader !== 'undefined' && ScriptLoader.ensureForPage) {
          await ScriptLoader.ensureForPage('page-qrcode');
        }
      }
      if (this.showUidQrCode) {
        this.showUidQrCode();
      }
    } finally {
      this._qrPopupLoading = false;
      if (seq) this._endRouteLoading(seq);
    }
  },

  /** 複製 UID — profile-card.js 未載入時的安全 fallback */
  _copyUidSafe(uid) {
    if (this._copyUidToClipboard) { this._copyUidToClipboard(uid); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(uid).then(() => this.showToast?.('UID 已複製到剪貼簿')).catch(() => {});
    }
  },

  init() {
    // ── 版本同步偵測 ──
    try {
      const storedV = localStorage.getItem('sporthub_cache_ver');
      if (storedV && storedV !== CACHE_VERSION) {
        console.error(`[VERSION MISMATCH] index.html V="${storedV}" !== config.js CACHE_VERSION="${CACHE_VERSION}". 請同步更新 index.html 的 var V 及所有 ?v= 參數。`);
      }
      if ('caches' in window) {
        caches.keys().then(keys => {
          const swCache = keys.find(k => k.startsWith('sporthub-') && k !== 'sporthub-images-v2');
          if (swCache) {
            const swVer = swCache.replace('sporthub-', '');
            if (swVer !== CACHE_VERSION) {
              console.error(`[VERSION MISMATCH] sw.js CACHE_NAME="sporthub-${swVer}" !== config.js CACHE_VERSION="${CACHE_VERSION}". 請同步更新 sw.js。`);
            }
          }
        }).catch(() => {});
      }
    } catch (_) {}
    // ── 核心 UI（硬呼叫，失敗代表致命問題）──
    this.bindSportPicker();
    this.bindNavigation();
    this.bindDrawer();
    this.bindTheme();
    this.initFontSize();
    // ── 非核心模組（?.() + try-catch，失敗不影響核心渲染）──
    try {
      this.initPwaInstall?.();
      this.bindFilterToggle();
      this.bindTabBars();
      this.bindTournamentTabs();
      this.bindScanModes();
      this.bindFloatingAds?.();
      this.bindNotifBtn();
      this.bindLineLogin();
      this.bindImageUpload?.('ce-image', 'ce-upload-preview', 8/3);
      this.bindImageUpload?.('ct-image', 'ct-upload-preview', 8/3);
      this.bindImageUpload?.('ct-content-image', 'ct-content-upload-preview', 8/3);
      this.bindImageUpload?.('et-image', 'et-upload-preview', 8/3);
      this.bindImageUpload?.('et-content-image', 'et-content-upload-preview', 8/3);
      this.bindImageUpload?.('cs-img1', 'cs-preview1', 4/3);
      this.bindImageUpload?.('cs-img2', 'cs-preview2', 4/3);
      this.bindImageUpload?.('cs-img3', 'cs-preview3', 4/3);
      this.bindImageUpload?.('banner-image', 'banner-preview', 2.2);
      this.bindImageUpload?.('floatad-image', 'floatad-preview', 1);
      this.bindImageUpload?.('popupad-image', 'popupad-preview', 16/9);
      this.bindImageUpload?.('ct-team-image', 'ct-team-preview', 8/3);
      this.bindImageUpload?.('theme-image', 'theme-preview', 0);
      this._bindAchBadgeUpload?.();
      this._populateAchConditionSelects?.();
      this.bindShopSearch?.();
      this.bindTeamOnlyToggle?.();
      this.applySiteThemes?.();
      this.initLangSwitcher?.();
    } catch (e) {
      console.error('[App] 非核心模組初始化失敗:', e.message);
    }
    // ── 核心渲染（不受上方錯誤影響）──
    this._applyI18nToUI();
    this.renderAll();
    this.applyRole('user', true);
    // 清除開機看門狗（清快取後的自動重載保護）
    try { clearTimeout(window._bootWatchdogTimer); sessionStorage.removeItem('_bootWatchdog'); } catch(_){}
  },

  /** 啟動時只更新全域 shell，首頁內容改為 critical / deferred 分段渲染 */
  _isEventFeeEnabled(event) {
    if (!event || typeof event !== 'object') return false;
    if (typeof event.feeEnabled === 'boolean') return event.feeEnabled;
    return Number(event.fee || 0) > 0;
  },

  _getEventRecordedFeeAmount(event) {
    const fee = Number(event?.fee || 0);
    if (!Number.isFinite(fee) || fee <= 0) return 0;
    return Math.floor(fee);
  },

  _getEventFeeAmount(event) {
    if (!this._isEventFeeEnabled(event)) return 0;
    return this._getEventRecordedFeeAmount(event);
  },

  renderAll() {
    this.renderGlobalShell();
    if (!this._isHomePageActive()) return;
    this.renderHomeCritical();
    this._scheduleHomeDeferredRender();
    /* 白屏卡住偵測：有實際活動卡片 或 確認系統真的沒活動 才算完成 */
    var _hotEl = document.getElementById('hot-events');
    var _hasCards = _hotEl && _hotEl.querySelector('.h-card');
    var _confirmedEmpty = this._cloudReady && typeof FirebaseService !== 'undefined'
        && FirebaseService._initialized && FirebaseService._cache
        && FirebaseService._cache.events && FirebaseService._cache.events.length === 0;
    if (_hasCards || _confirmedEmpty) {
      window._contentReady = true;
      if (document.getElementById('content-stall-hint')) {
        document.getElementById('content-stall-hint').remove();
      }
    }
  },

  renderGlobalShell() {
    this.updateNotifBadge();
    this.updatePointsDisplay();
    this.updateStorageBar();
  },

  _isHomePageActive() {
    const homePage = document.getElementById('page-home');
    if (!homePage) return false;
    return this.currentPage === 'page-home' || homePage.classList.contains('active');
  },

  renderHomeCritical() {
    if (!this._isHomePageActive()) return;
    this.renderBannerCarousel({ autoplay: false });
    this.renderAnnouncement();
    this.renderHotEvents();
    this._renderHomeVersionTag();
    this._showSlowNetHint();
    this._markPageSnapshotReady('page-home');
    // 首頁渲染完成 → 背景預載入核心頁面 scripts（活動→俱樂部→賽事）
    if (typeof ScriptLoader !== 'undefined' && ScriptLoader.preloadCorePages) {
      ScriptLoader.preloadCorePages();
    }
  },

  _renderHomeVersionTag(visible) {
    const el = document.getElementById('home-version-tag');
    if (!el) return;
    if (visible === false) { el.style.display = 'none'; return; }
    const ver = typeof CACHE_VERSION === 'string' ? CACHE_VERSION : '';
    el.textContent = ver ? 'v0.' + ver : '';
    el.style.display = '';
  },

  renderHomeDeferred() {
    if (!this._isHomePageActive()) return false;
    if (typeof this.renderOngoingTournaments === 'function') this.renderOngoingTournaments();
    this.renderSponsors();
    if (this.renderNews) this.renderNews();
    this.renderFloatingAds();
    if (typeof this.showPopupAdsOnLoad === 'function') this.showPopupAdsOnLoad();
    this.startBannerCarousel();
    // 移除慢速提示
    this._removeSlowNetHint();
    return true;
  },

  /** 慢速網路提示：首頁底部顯示「載入中…」，deferred 完成後移除 */
  _showSlowNetHint() {
    if (document.getElementById('slow-net-hint')) return;
    const degrade = typeof NetDevice !== 'undefined' && NetDevice.shouldDegrade();
    if (!degrade) return;
    const home = document.getElementById('page-home');
    if (!home) return;
    const hint = document.createElement('div');
    hint.id = 'slow-net-hint';
    hint.className = 'slow-net-hint';
    hint.textContent = '內容載入中…';
    home.appendChild(hint);
  },
  _removeSlowNetHint() {
    const el = document.getElementById('slow-net-hint');
    if (el) el.remove();
  },

  _cancelHomeDeferredRender() {
    this._homeDeferredSeq++;
    if (this._homeDeferredIdleId !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(this._homeDeferredIdleId);
    }
    if (this._homeDeferredTimerId !== null) {
      clearTimeout(this._homeDeferredTimerId);
    }
    this._homeDeferredIdleId = null;
    this._homeDeferredTimerId = null;
  },

  _scheduleHomeDeferredRender(delayMs = 250) {
    this._cancelHomeDeferredRender();
    if (!this._isHomePageActive()) return;

    // 慢網路 / 低端設備：延長 idle timeout，讓主要內容先渲染完畢
    const degrade = typeof NetDevice !== 'undefined' && NetDevice.shouldDegrade();
    const idleTimeout = degrade ? 2500 : 1200;
    const fallbackDelay = degrade ? Math.max(delayMs, 600) : delayMs;

    const seq = this._homeDeferredSeq;
    const run = () => {
      this._homeDeferredIdleId = null;
      this._homeDeferredTimerId = null;
      if (seq !== this._homeDeferredSeq) return;
      this.renderHomeDeferred();
    };

    if (typeof requestIdleCallback === 'function') {
      this._homeDeferredIdleId = requestIdleCallback(run, { timeout: idleTimeout });
      return;
    }

    this._homeDeferredTimerId = setTimeout(run, fallbackDelay);
  },

  _markPageSnapshotReady(pageId) {
    if (!pageId) return;
    this._pageSnapshotReady[pageId] = true;
  },

  _hasPageSnapshotReady(pageId) {
    return !!this._pageSnapshotReady[pageId];
  },

  /** Phase 1 完成後才執行：綁定 pages/*.html 內的動態元素事件 */
  _bindPageElements() {
    this.bindFilterToggle();
    this.bindTabBars();
    this.bindShopSearch?.();
    this.bindTeamOnlyToggle?.();
    this._bindAchBadgeUpload?.();
    this._populateAchConditionSelects?.();
    this.bindImageUpload('ce-image',         'ce-upload-preview',         8/3);
    this.bindImageUpload('ct-image',         'ct-upload-preview',         8/3);
    this.bindImageUpload('ct-content-image', 'ct-content-upload-preview', 8/3);
    this.bindImageUpload('et-image',         'et-upload-preview',         8/3);
    this.bindImageUpload('et-content-image', 'et-content-upload-preview', 8/3);
    this.bindImageUpload('cs-img1',          'cs-preview1',              4/3);
    this.bindImageUpload('cs-img2',          'cs-preview2',              4/3);
    this.bindImageUpload('cs-img3',          'cs-preview3',              4/3);
    this.bindImageUpload('banner-image',     'banner-preview',           2.2);
    this.bindImageUpload('floatad-image',    'floatad-preview',          1);
    this.bindImageUpload('popupad-image',    'popupad-preview',          16/9);
    this.bindImageUpload('ct-team-image',    'ct-team-preview',          8/3);
    this.bindImageUpload('theme-image',      'theme-preview',            0);
  },

  /** 將 Date 格式化為 YYYY/MM/DD HH:MM 字串（省略時間時傳 false） */
  _formatDateTime(d, includeTime = true) {
    d = d || new Date();
    const base = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    return includeTime
      ? `${base} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
      : base;
  },

  /**
   * 為內容區綁定左右滑動切換頁籤
   * @param {string} contentId  內容容器 ID
   * @param {string} tabsId     頁籤容器 ID
   * @param {Function} onSwitch 切換回呼，傳入新 tab 的 key
   * @param {Function} getKey   從 tab button 取 key 的函式
   */
  _bindSwipeTabs(contentId, tabsId, onSwitch, getKey) {
    var content = document.getElementById(contentId);
    if (!content || content.dataset.swipeBound) return;
    content.dataset.swipeBound = '1';

    var startX = 0, startY = 0, startTime = 0;
    var swiping = false, locked = false, animating = false;
    var contentW = 0;

    function _reset() {
      content.style.transition = '';
      content.style.transform = '';
      content.style.opacity = '';
      content.style.willChange = '';
    }

    function _onTransitionEnd(cb) {
      var called = false;
      function handler() {
        if (called) return;
        called = true;
        content.removeEventListener('transitionend', handler);
        clearTimeout(fallback);
        cb();
      }
      content.addEventListener('transitionend', handler);
      var fallback = setTimeout(handler, 350);
    }

    content.addEventListener('touchstart', function (e) {
      if (animating) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
      swiping = false;
      locked = false;
      contentW = content.offsetWidth;
      content.style.transition = 'none';
      content.style.willChange = 'transform, opacity';
    }, { passive: true });

    content.addEventListener('touchmove', function (e) {
      if (locked || animating) return;
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;

      if (!swiping) {
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) { locked = true; return; }
        if (Math.abs(dx) > 10) { swiping = true; } else { return; }
      }

      if (e.cancelable) e.preventDefault();

      var tabs = document.getElementById(tabsId);
      if (!tabs) return;
      var buttons = Array.from(tabs.querySelectorAll('button'));
      var activeIdx = buttons.findIndex(function (b) { return b.classList.contains('active'); });

      var ratio = dx / (contentW || 1);

      // 邊界阻尼：第一頁往右拖 或 最後一頁往左拖
      if ((activeIdx <= 0 && dx > 0) || (activeIdx >= buttons.length - 1 && dx < 0)) {
        ratio *= 0.3;
      }

      content.style.transform = 'translateX(' + (ratio * 100) + '%)';
      content.style.opacity = String(Math.max(1 - Math.abs(ratio) * 0.4, 0.5));
    }, { passive: false });

    content.addEventListener('touchend', function (e) {
      content.style.willChange = '';

      if (!swiping || locked || animating) {
        content.style.transition = '';
        content.style.transform = '';
        content.style.opacity = '';
        return;
      }

      var dx = e.changedTouches[0].clientX - startX;
      var elapsed = Date.now() - startTime;
      var velocity = Math.abs(dx) / (elapsed || 1);

      var tabs = document.getElementById(tabsId);
      if (!tabs) { _reset(); return; }
      var buttons = Array.from(tabs.querySelectorAll('button'));
      if (buttons.length < 2) { _reset(); return; }

      var activeIdx = buttons.findIndex(function (b) { return b.classList.contains('active'); });
      if (activeIdx < 0) { _reset(); return; }

      // 閾值：40px 距離 或 速度 > 0.3 px/ms 且至少 20px
      var shouldSwitch = Math.abs(dx) >= 40 || (Math.abs(dx) >= 20 && velocity > 0.3);
      var nextIdx = dx < 0
        ? Math.min(activeIdx + 1, buttons.length - 1)
        : Math.max(activeIdx - 1, 0);

      if (!shouldSwitch || nextIdx === activeIdx) {
        // 彈回原位
        content.style.transition = 'transform .25s cubic-bezier(.2,.9,.3,1), opacity .25s ease';
        content.style.transform = 'translateX(0)';
        content.style.opacity = '1';
        _onTransitionEnd(function () { _reset(); });
        return;
      }

      // 滑出動畫
      animating = true;
      var exitDir = dx < 0 ? '-100%' : '100%';
      var enterFrom = dx < 0 ? '40%' : '-40%';

      content.style.transition = 'transform .2s cubic-bezier(.4,0,1,1), opacity .18s ease';
      content.style.transform = 'translateX(' + exitDir + ')';
      content.style.opacity = '0';

      _onTransitionEnd(function () {
        // 切換頁籤（觸發重新渲染）
        var key = getKey(buttons[nextIdx]);
        if (key != null) {
          content.style.transition = 'none';
          content.style.transform = 'translateX(' + enterFrom + ')';
          content.style.opacity = '0';

          onSwitch.call(App, key);

          // 強制 reflow 後啟動滑入動畫
          void content.offsetWidth;

          content.style.transition = 'transform .25s cubic-bezier(.0,0,.2,1), opacity .2s ease';
          content.style.transform = 'translateX(0)';
          content.style.opacity = '1';

          _onTransitionEnd(function () {
            _reset();
            animating = false;
          });

          buttons[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } else {
          _reset();
          animating = false;
        }
      });
    }, { passive: true });
  },

  showToast(msg, duration) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    const ms = duration || (msg && msg.includes('\n') ? 4000 : 2500);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
  },

  _getRouteLoadingCopy(pageId, phase = 'page') {
    if (phase === 'auth') return '正在同步 LINE 登入與資料...';
    if (phase === 'cloud') return '正在同步資料，請稍候...';
    const pageLabels = {
      'page-activities': '活動',
      'page-activity-detail': '活動詳情',
      'page-teams': '俱樂部',
      'page-team-detail': '俱樂部詳情',
      'page-profile': '個人資料',
      'page-messages': '訊息',
      'page-game': '小遊戲',
      'page-scan': '掃碼頁面',
      'page-shop': '商城',
      'page-achievements': '成就頁面',
      'page-personal-dashboard': '個人儀表板',
      'page-temp-participant-report': '臨時查詢報表',
      'page-qrcode': 'QR Code',
    };
    const label = pageLabels[pageId];
    if (!label) return '資料載入中...';
    return `正在載入${label}...`;
  },

  _beginRouteLoading(options = {}) {
    const {
      pageId = '',
      phase = 'page',
      immediate = false,
      delayMs = 220,
      minVisibleMs = 280,
      slowMs = 3200,
    } = options;
    const overlay = document.getElementById('status-hint');
    const deepLinkOverlay = document.getElementById('deep-link-overlay');
    const bootOverlay = document.getElementById('loading-overlay');
    if (!overlay) return 0;
    if (deepLinkOverlay && deepLinkOverlay.style.display !== 'none') return 0;
    if (bootOverlay && bootOverlay.style.display !== 'none') return 0;

    const seq = ++this._routeLoadingSeq;
    clearTimeout(this._routeLoadingShowTimer);
    clearTimeout(this._routeLoadingSlowTimer);
    clearTimeout(this._routeLoadingHideTimer);
    this._routeLoadingShowTimer = null;
    this._routeLoadingSlowTimer = null;
    this._routeLoadingHideTimer = null;

    const textEl = overlay.querySelector('[data-status-hint-text]');
    const copy = this._getRouteLoadingCopy(pageId, phase);

    const show = () => {
      if (seq !== this._routeLoadingSeq) return;
      if (textEl) textEl.textContent = copy;
      overlay.style.display = 'inline-flex';
      overlay.classList.add('show');
      this._routeLoadingShownAt = Date.now();
      this._routeLoadingSlowTimer = setTimeout(() => {
        if (seq !== this._routeLoadingSeq) return;
        if (textEl) textEl.textContent = '網路較慢，資料仍在載入中...';
      }, slowMs);
    };

    const shouldShowImmediately = immediate || overlay.style.display !== 'none';
    if (shouldShowImmediately) {
      show();
    } else {
      this._routeLoadingShowTimer = setTimeout(show, delayMs);
    }

    overlay.dataset.minVisibleMs = String(minVisibleMs);
    return seq;
  },

  _endRouteLoading(seq) {
    if (!seq || seq !== this._routeLoadingSeq) return;
    const overlay = document.getElementById('status-hint');
    clearTimeout(this._routeLoadingShowTimer);
    clearTimeout(this._routeLoadingSlowTimer);
    clearTimeout(this._routeLoadingHideTimer);
    this._routeLoadingShowTimer = null;
    this._routeLoadingSlowTimer = null;
    this._routeLoadingHideTimer = null;

    if (!overlay || overlay.style.display === 'none') return;

    const minVisibleMs = Number(overlay.dataset.minVisibleMs || 280);
    const elapsed = Date.now() - (this._routeLoadingShownAt || 0);
    const waitMs = Math.max(0, minVisibleMs - elapsed);
    const hide = () => {
      if (seq !== this._routeLoadingSeq) return;
      overlay.classList.remove('show');
      this._routeLoadingHideTimer = setTimeout(() => {
        if (seq !== this._routeLoadingSeq) return;
        overlay.style.display = 'none';
      }, 180);
    };

    if (waitMs > 0) {
      this._routeLoadingHideTimer = setTimeout(hide, waitMs);
      return;
    }
    hide();
  },

  /** 自訂確認 Modal（取代原生 confirm，不會被瀏覽器封鎖） */
  appConfirm(msg) {
    return new Promise(resolve => {
      const modal = document.getElementById('app-confirm-modal');
      document.getElementById('app-confirm-msg').textContent = msg;
      modal.classList.add('open');
      document.body.classList.add('modal-open');
      const ok = document.getElementById('app-confirm-ok');
      const cancel = document.getElementById('app-confirm-cancel');
      const cleanup = (result) => {
        modal.classList.remove('open');
        document.body.classList.remove('modal-open');
        ok.replaceWith(ok.cloneNode(true));
        cancel.replaceWith(cancel.cloneNode(true));
        resolve(result);
      };
      ok.addEventListener('click', () => cleanup(true), { once: true });
      cancel.addEventListener('click', () => cleanup(false), { once: true });
    });
  },

  async confirmClearCache() {
    // 清除快取用特殊 HTML 彈窗（含 Warning 紅字）
    const msgEl = document.getElementById('app-confirm-msg');
    msgEl.innerHTML = '<div class="app-confirm-warning">⚠ Warning</div>'
      + '確定要清除所有快取並重新登入嗎？<br>'
      + '這會回到最乾淨的狀態，或許可解決白屏或異常問題，'
      + '但若您的網路狀態與手機性能不佳時可能會讓問題更嚴重。<br>'
      + '建議您先使用關閉分頁並重新登入的方式試試看。';
    const modal = document.getElementById('app-confirm-modal');
    modal.classList.add('open');
    document.body.classList.add('modal-open');
    const ok = document.getElementById('app-confirm-ok');
    const cancel = document.getElementById('app-confirm-cancel');
    const yes = await new Promise(resolve => {
      const cleanup = (result) => {
        modal.classList.remove('open');
        document.body.classList.remove('modal-open');
        msgEl.innerHTML = '';
        ok.replaceWith(ok.cloneNode(true));
        cancel.replaceWith(cancel.cloneNode(true));
        resolve(result);
      };
      ok.addEventListener('click', () => cleanup(true), { once: true });
      cancel.addEventListener('click', () => cleanup(false), { once: true });
    });
    if (!yes) return;
    try {
      // 先正式登出 Firebase Auth + LIFF，避免清除儲存後產生半死半活狀態
      // （LIFF WebView session 存活但 access token 已清 → _ensureAuth 永遠失敗）
      try { if (typeof auth !== 'undefined' && auth && auth.currentUser) await auth.signOut(); } catch(_){}
      try { if (typeof liff !== 'undefined' && liff.isLoggedIn && liff.isLoggedIn()) liff.logout(); } catch(_){}
      if (typeof LineAuth !== 'undefined') {
        LineAuth._profile = null;
        LineAuth._profileError = null;
        LineAuth._profileLoading = false;
        LineAuth._profilePromise = null;
        try { LineAuth._clearProfileCache(); } catch(_){}
      }
      if ('caches' in window) { var ks = await caches.keys(); await Promise.all(ks.map(function(n){ return caches.delete(n); })); }
      if ('serviceWorker' in navigator) { var regs = await navigator.serviceWorker.getRegistrations(); regs.forEach(function(r){ r.unregister(); }); }
      var lsKeys = Object.keys(localStorage);
      for (var i = 0; i < lsKeys.length; i++) {
        var k = lsKeys[i];
        if (k.indexOf('shub_c_') === 0 || k.indexOf('shub_ts_') === 0 || k.indexOf('shub_cache_') === 0 || k.indexOf('LIFF') === 0) {
          localStorage.removeItem(k);
        }
      }
      localStorage.removeItem('sporthub_auto_exp_rules');
      localStorage.removeItem('sporthub_auto_exp_logs');
      try { var dbs = await indexedDB.databases(); dbs.forEach(function(db){ indexedDB.deleteDatabase(db.name); }); } catch(_){}
      // 清除登入重試計數，讓重載後能正常觸發自動登入
      try { sessionStorage.removeItem('_lineLoginRetryCount'); } catch(_){}
    } catch(_){}
    location.href = location.pathname + '?clear=1';
  },

  /** 跨瀏覽器剪貼簿複製（clipboard API → execCommand fallback） */
  async _copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* fall through */ }
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (_) { return false; }
  },

  _getPendingDeepLink() {
    try {
      const pendingEvent = String(sessionStorage.getItem('_pendingDeepEvent') || '').trim();
      if (pendingEvent) return { type: 'event', id: pendingEvent };
      const pendingTeam = String(sessionStorage.getItem('_pendingDeepTeam') || '').trim();
      if (pendingTeam) return { type: 'team', id: pendingTeam };
      const pendingTournament = String(sessionStorage.getItem('_pendingDeepTournament') || '').trim();
      if (pendingTournament) return { type: 'tournament', id: pendingTournament };
      const pendingProfile = String(sessionStorage.getItem('_pendingDeepProfile') || '').trim();
      if (pendingProfile) return { type: 'profile', id: pendingProfile };
    } catch (_) {}
    return null;
  },

  _clearPendingDeepLink() {
    try {
      sessionStorage.removeItem('_pendingDeepEvent');
      sessionStorage.removeItem('_pendingDeepTeam');
      sessionStorage.removeItem('_pendingDeepTournament');
      sessionStorage.removeItem('_pendingDeepProfile');
    } catch (_) {}
  },

  _clearDeepLinkQueryParams() {
    try {
      const url = new URL(window.location.href);
      let changed = false;
      ['event', 'team', 'tournament', 'profile'].forEach((key) => {
        if (!url.searchParams.has(key)) return;
        url.searchParams.delete(key);
        changed = true;
      });
      if (changed) {
        history.replaceState(null, '', url.pathname + (url.search || '') + (url.hash || ''));
      }
    } catch (_) {}
  },

  _showDeepLinkOverlay(type) {
    const overlay = document.getElementById('deep-link-overlay');
    if (!overlay) return;
    const title = overlay.querySelector('[data-deep-link-title]');
    const sub = overlay.querySelector('[data-deep-link-sub]');
    const titleMap = { team: '正在前往俱樂部頁面', tournament: '正在前往賽事頁面', profile: '正在前往個人名片' };
    if (title) title.textContent = titleMap[type] || '正在前往活動頁面';
    if (sub) sub.textContent = '正在確認登入與資料，請稍候...';
    overlay.classList.remove('is-hiding');
    overlay.style.display = 'flex';
  },

  _hideDeepLinkOverlay() {
    const overlay = document.getElementById('deep-link-overlay');
    if (!overlay || overlay.style.display === 'none') return;
    overlay.classList.add('is-hiding');
    setTimeout(() => {
      overlay.style.display = 'none';
      overlay.classList.remove('is-hiding');
    }, 220);
  },

  _stopDeepLinkGuard() {
    if (this._bootDeepLinkTimer) {
      clearTimeout(this._bootDeepLinkTimer);
      this._bootDeepLinkTimer = null;
    }
    if (this._bootDeepLinkPoller) {
      clearInterval(this._bootDeepLinkPoller);
      this._bootDeepLinkPoller = null;
    }
  },

  _completeDeepLinkSuccess() {
    this._stopDeepLinkGuard();
    this._clearPendingDeepLink();
    this._clearDeepLinkQueryParams();
    // 延後隱藏覆蓋層：等目標頁面實際可見，避免閃現首頁
    const _findTargetPage = () => document.getElementById('page-activity-detail') || document.getElementById('page-team-detail') || document.getElementById('page-tournament-detail') || document.getElementById('page-user-card');
    const targetPage = _findTargetPage();
    if (targetPage && targetPage.style.display !== 'none' && targetPage.offsetHeight > 0) {
      this._hideDeepLinkOverlay();
    } else {
      // 頁面尚未切換完成，輪詢等待（最多 2 秒後強制隱藏）
      let _tries = 0;
      const _waitHide = setInterval(() => {
        _tries++;
        const tp = _findTargetPage();
        if ((tp && tp.style.display !== 'none' && tp.offsetHeight > 0) || _tries >= 20) {
          clearInterval(_waitHide);
          this._hideDeepLinkOverlay();
        }
      }, 100);
    }
    this._bootDeepLink = null;
    this._deepLinkAuthRedirecting = false;
    this._pendingDeepLinkOpenKey = '';
    this._pendingDeepLinkOpenPromise = null;
  },

  _completeDeepLinkFallback(message, targetPage = 'page-activities') {
    this._stopDeepLinkGuard();
    this._clearPendingDeepLink();
    this._clearDeepLinkQueryParams();
    this._hideDeepLinkOverlay();
    this._bootDeepLink = null;
    this._deepLinkAuthRedirecting = false;
    this._pendingDeepLinkOpenKey = '';
    this._pendingDeepLinkOpenPromise = null;
    const canOpenProtected = (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
    const fallbackPage = (!canOpenProtected && targetPage !== 'page-home') ? 'page-home' : targetPage;
    if (fallbackPage && this.currentPage !== fallbackPage) this.showPage(fallbackPage);
    if (message) this.showToast(message);
  },

  _sanitizePendingAuthAction(action) {
    if (!action || typeof action !== 'object') return null;
    const type = String(action.type || '').trim();
    if (!type) return null;

    const normalizeId = (value) => String(value || '').trim();
    const normalizeName = (value) => String(value || '').trim().slice(0, 120);

    switch (type) {
      case 'showPage': {
        const pageId = normalizeId(action.pageId);
        return pageId ? { type, pageId } : null;
      }
      case 'showEventDetail':
      case 'eventSignup':
      case 'eventCancelSignup':
      case 'toggleFavoriteEvent':
      case 'goToScanForEvent': {
        const eventId = normalizeId(action.eventId || action.id);
        return eventId ? { type, eventId } : null;
      }
      case 'showTeamDetail': {
        const teamId = normalizeId(action.teamId || action.id);
        return teamId ? { type, teamId } : null;
      }
      case 'toggleFavoriteTournament': {
        const tournId = normalizeId(action.tournId || action.id);
        return tournId ? { type, tournId } : null;
      }
      case 'showUserProfile': {
        const name = normalizeName(action.name);
        return name ? { type, name } : null;
      }
      default:
        return null;
    }
  },

  _getPendingAuthAction() {
    if (this._pendingAuthAction) return this._pendingAuthAction;
    try {
      const raw = sessionStorage.getItem(this._pendingAuthActionStorageKey);
      if (!raw) return null;
      const sanitized = this._sanitizePendingAuthAction(JSON.parse(raw));
      if (!sanitized) {
        sessionStorage.removeItem(this._pendingAuthActionStorageKey);
        return null;
      }
      this._pendingAuthAction = sanitized;
      return sanitized;
    } catch (_) {
      try { sessionStorage.removeItem(this._pendingAuthActionStorageKey); } catch (_) {}
      return null;
    }
  },

  _setPendingAuthAction(action) {
    const sanitized = this._sanitizePendingAuthAction(action);
    if (!sanitized) return null;
    this._pendingAuthAction = sanitized;
    try {
      sessionStorage.setItem(this._pendingAuthActionStorageKey, JSON.stringify(sanitized));
    } catch (_) {}
    return sanitized;
  },

  /**
   * 等待 events 集合載入完成（最多 5 秒）。
   * 用於 _resumePendingAuthAction，確保 ApiService.getEvent 能找到活動。
   */
  async _waitForEventsLoaded() {
    // 已有資料直接返回
    if (typeof FirebaseService !== 'undefined' && FirebaseService._cache.events.length > 0) return;
    // 等待 events 集合首次填充
    await new Promise(resolve => {
      const check = () => typeof FirebaseService !== 'undefined' && FirebaseService._cache.events.length > 0;
      if (check()) { resolve(); return; }
      const interval = setInterval(() => { if (check()) { clearInterval(interval); resolve(); } }, 150);
      setTimeout(() => { clearInterval(interval); resolve(); }, 5000);
    });
  },

  _clearPendingAuthAction() {
    this._pendingAuthAction = null;
    try {
      sessionStorage.removeItem(this._pendingAuthActionStorageKey);
    } catch (_) {}
  },

  _isAuthenticatedForProtectedAction() {
    return typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn();
  },

  _requestLoginForAction(action, options = {}) {
    const pending = this._setPendingAuthAction(action);
    if (!pending) return false;

    // 同步保存 deep link，讓登入回來後 deep link 系統能快速顯示頁面
    try {
      if (action.eventId) sessionStorage.setItem('_pendingDeepEvent', action.eventId);
      if (action.teamId) sessionStorage.setItem('_pendingDeepTeam', action.teamId);
    } catch (_) {}

    const loginCopy = String(options.toastMessage || '\u8acb\u5148\u767b\u5165 LINE \u5e33\u865f');
    const pendingCopy = String(options.pendingToastMessage || 'LINE \u767b\u5165\u8655\u7406\u4e2d...');
    const startLogin = () => {
      if (typeof LineAuth === 'undefined' || typeof LineAuth.login !== 'function') {
        this.showToast('LINE \u767b\u5165\u5c1a\u672a\u6e96\u5099\u5b8c\u6210');
        return false;
      }
      if (typeof LineAuth.isPendingLogin === 'function' && LineAuth.isPendingLogin()) {
        this.showToast(pendingCopy);
        return true;
      }
      this.showToast(loginCopy);
      LineAuth.login();
      return true;
    };

    if (typeof LineAuth !== 'undefined' && LineAuth._ready) {
      try {
        return startLogin();
      } catch (err) {
        console.warn('[AuthAction] login redirect failed:', err);
        this.showToast('LINE \u767b\u5165\u555f\u52d5\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
        return true;
      }
    }

    if (typeof this.ensureCloudReady === 'function') {
      this.showToast('\u6b63\u5728\u6e96\u5099 LINE \u767b\u5165...');
      void this.ensureCloudReady({ reason: 'pending-auth-action' })
        .then(() => {
          if (this._isAuthenticatedForProtectedAction()) return;
          try {
            startLogin();
          } catch (err) {
            console.warn('[AuthAction] deferred login redirect failed:', err);
          }
        })
        .catch(err => {
          console.warn('[AuthAction] ensureCloudReady before login failed:', err);
          this.showToast('LINE \u767b\u5165\u5c1a\u672a\u6e96\u5099\u5b8c\u6210');
        });
      return true;
    }

    this.showToast('LINE \u767b\u5165\u5c1a\u672a\u6e96\u5099\u5b8c\u6210');
    return true;
  },

  async _resumePendingAuthAction() {
    if (this._pendingAuthActionPromise) {
      return await this._pendingAuthActionPromise;
    }
    if (!this._isAuthenticatedForProtectedAction()) return false;

    const action = this._getPendingAuthAction();
    if (!action) return false;

    // 若有 deep link poller 正在運作，先停止以避免兩者同時呼叫 showEventDetail 造成 requestSeq 衝突
    if (action.eventId && this._bootDeepLinkPoller) {
      this._deepLinkRendered = true;
      this._stopDeepLinkGuard();
      this._clearPendingDeepLink();
      this._hideDeepLinkOverlay();
    }

    const actionPromise = (async () => {
      try {
        // 若涉及活動頁面，先確保 events 集合已載入
        const needsEvents = ['showEventDetail', 'eventSignup', 'eventCancelSignup', 'toggleFavoriteEvent'].includes(action.type);
        if (needsEvents && action.eventId) {
          await this._waitForEventsLoaded();
        }

        switch (action.type) {
          case 'showPage':
            await this.showPage(action.pageId, { resetHistory: true });
            return true;
          case 'showEventDetail':
            await this.showEventDetail(action.eventId);
            return true;
          case 'eventSignup':
            await this.showEventDetail(action.eventId);
            await this.handleSignup?.(action.eventId);
            return true;
          case 'eventCancelSignup':
            await this.showEventDetail(action.eventId);
            await this.handleCancelSignup?.(action.eventId);
            return true;
          case 'toggleFavoriteEvent':
            await this.showEventDetail(action.eventId);
            this.toggleFavoriteEvent?.(action.eventId);
            return true;
          case 'goToScanForEvent':
            this.goToScanForEvent?.(action.eventId);
            return true;
          case 'showTeamDetail':
            await this.showTeamDetail(action.teamId);
            return true;
          case 'toggleFavoriteTournament':
            this.toggleFavoriteTournament?.(action.tournId);
            return true;
          case 'showUserProfile':
            this.showUserProfile?.(action.name);
            return true;
          default:
            return false;
        }
      } catch (err) {
        console.warn('[AuthAction] resume failed:', err);
        return false;
      } finally {
        this._clearPendingAuthAction();
      }
    })();

    this._pendingAuthActionPromise = actionPromise.finally(() => {
      if (this._pendingAuthActionPromise === actionPromise) {
        this._pendingAuthActionPromise = null;
      }
    });

    return await this._pendingAuthActionPromise;
  },

  _tryStartDeepLinkLogin() {
    if (this._deepLinkAuthRedirecting) return true;
    if (typeof LineAuth === 'undefined') return false;
    if (typeof LineAuth.isLoggedIn === 'function' && LineAuth.isLoggedIn()) return false;

    // LIFF session exists but profile is still loading.
    if (typeof LineAuth.isPendingLogin === 'function' && LineAuth.isPendingLogin()) {
      this._deepLinkAuthRedirecting = true;
      return true;
    }

    // LIFF session exists but getProfile() failed — re-login won't help, avoid infinite redirect loop.
    if (LineAuth.hasLiffSession && LineAuth.hasLiffSession() && LineAuth._profileError) {
      console.warn('[DeepLink] LIFF session exists but getProfile failed, skipping login redirect');
      return false;
    }

    // Wait until SDK is ready (Phase 4) before triggering login.
    if (typeof liff === 'undefined' || !LineAuth._ready) {
      if (typeof this.ensureCloudReady === 'function') {
        void this.ensureCloudReady({ reason: 'deep-link-login' }).catch(() => {});
      }
      return false;
    }

    try {
      this._deepLinkAuthRedirecting = true;
      console.log('[DeepLink] unauthenticated, redirecting to LINE login');
      LineAuth.login();
      return true;
    } catch (err) {
      this._deepLinkAuthRedirecting = false;
      console.warn('[DeepLink] login redirect failed:', err);
      return false;
    }
  },

  // ── Firestore REST API 直取（不需 SDK）──

  _convertFirestoreRestValue(val) {
    if (val === undefined || val === null) return null;
    if ('stringValue' in val) return val.stringValue;
    if ('integerValue' in val) return Number(val.integerValue);
    if ('doubleValue' in val) return Number(val.doubleValue);
    if ('booleanValue' in val) return val.booleanValue;
    if ('nullValue' in val) return null;
    if ('timestampValue' in val) return val.timestampValue;
    if ('arrayValue' in val) {
      return (val.arrayValue.values || []).map(v => this._convertFirestoreRestValue(v));
    }
    if ('mapValue' in val) {
      const obj = {};
      const fields = val.mapValue.fields || {};
      for (const k of Object.keys(fields)) {
        obj[k] = this._convertFirestoreRestValue(fields[k]);
      }
      return obj;
    }
    return null;
  },

  _convertFirestoreRestDoc(doc, eventId) {
    if (!doc || !doc.fields) return null;
    const result = {};
    const fields = doc.fields;
    for (const k of Object.keys(fields)) {
      result[k] = this._convertFirestoreRestValue(fields[k]);
    }
    // 從 doc.name 取得真實 Firestore 文件 ID
    const docId = doc.name ? doc.name.split('/').pop() : eventId;
    if (!result.id) result.id = eventId;
    result._docId = docId;
    return result;
  },

  async _fetchEventViaRest(eventId) {
    try {
      const pid = typeof firebaseConfig !== 'undefined' && firebaseConfig.projectId;
      const key = typeof firebaseConfig !== 'undefined' && firebaseConfig.apiKey;
      if (!pid || !key) return null;

      // 先嘗試直接以 eventId 當作 doc path 取得（可能 docId === dataId）
      const directUrl = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/events/${encodeURIComponent(eventId)}?key=${encodeURIComponent(key)}`;
      const directResp = await fetch(directUrl);
      if (directResp.ok) {
        const doc = await directResp.json();
        if (doc && doc.fields) return this._convertFirestoreRestDoc(doc, eventId);
      }

      // 直接取得失敗（docId !== dataId），改用 structuredQuery 以 id 欄位查詢
      const queryUrl = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents:runQuery?key=${encodeURIComponent(key)}`;
      const queryResp = await fetch(queryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'events' }],
            where: { fieldFilter: { field: { fieldPath: 'id' }, op: 'EQUAL', value: { stringValue: eventId } } },
            limit: 1
          }
        })
      });
      if (!queryResp.ok) return null;
      const results = await queryResp.json();
      if (Array.isArray(results) && results.length > 0 && results[0].document) {
        return this._convertFirestoreRestDoc(results[0].document, eventId);
      }
      return null;
    } catch (err) {
      console.warn('[DeepLink] REST fetch failed:', err);
      return null;
    }
  },

  async _tryInstantEventDeepLink() {
    try {
      const event = await this._deepLinkRestFetch;
      if (!event || this._deepLinkRendered) return false;

      // 確保 activity-detail HTML 已載入
      if (typeof PageLoader !== 'undefined' && PageLoader.ensurePage) {
        await PageLoader.ensurePage('page-activity-detail');
      }

      // 注入 cache（讓 ApiService.getEvent 找到）
      if (typeof FirebaseService !== 'undefined' && FirebaseService._cache && FirebaseService._cache.events) {
        if (!FirebaseService._cache.events.find(e => e.id === event.id)) {
          FirebaseService._cache.events.push(event);
        }
      }

      // 設置 instant mode（讓 showPage 跳過 ensureCloudReady）
      this._instantDeepLinkMode = true;
      try {
        const result = await this.showEventDetail(event.id, { allowGuest: true });
        if (result?.ok) {
          this._deepLinkRendered = true;
          this._instantDeepLinkEventId = event.id;
          this._completeDeepLinkSuccess();
          console.log('[DeepLink] instant preview rendered via REST API');
          return true;
        }
      } finally {
        this._instantDeepLinkMode = false;
      }
      return false;
    } catch (err) {
      console.warn('[DeepLink] instant preview failed:', err);
      this._instantDeepLinkMode = false;
      return false;
    }
  },

  _startDeepLinkGuard() {
    const pending = this._getPendingDeepLink();
    if (!pending) return;
    this._bootDeepLink = pending;
    this._deepLinkAuthRedirecting = false;
    this._showDeepLinkOverlay(pending.type);
    this._stopDeepLinkGuard();

    this._bootDeepLinkTimer = setTimeout(() => {
      if (!this._getPendingDeepLink()) return;
      const isAuthedNow = (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
      if (!isAuthedNow && pending.type !== 'event') {
        // For unauthenticated deep links, prioritize LINE login redirect.
        this._tryStartDeepLinkLogin();
        this._bootDeepLinkTimer = setTimeout(() => {
          if (!this._getPendingDeepLink()) return;
          const isAuthedRetry = (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
          if (!isAuthedRetry) {
            this._completeDeepLinkFallback('\u8acb\u5148\u5b8c\u6210 LINE \u767b\u5165\u5f8c\u518d\u958b\u555f\u9023\u7d50\u3002', 'page-home');
            return;
          }
          const retryTargetMap = { team: 'page-teams', tournament: 'page-tournaments', profile: 'page-profile' };
          const retryTarget = retryTargetMap[pending.type] || 'page-activities';
          this._completeDeepLinkFallback('\u9801\u9762\u8f09\u5165\u5df2\u903e\u6642\uff0c\u5df2\u5207\u63db\u5230\u5217\u8868\u3002', retryTarget);
        }, this._deepLinkBootTimeoutMs);
        return;
      }
      const fallbackPageMap = { team: 'page-teams', tournament: 'page-tournaments', profile: 'page-profile' };
      const targetPage = fallbackPageMap[pending.type]
        || (isAuthedNow ? 'page-activities' : 'page-home');
      const fallbackMessage = pending.type === 'event' && !isAuthedNow
        ? '\u6d3b\u52d5\u8a73\u60c5\u8f09\u5165\u5df2\u903e\u6642\uff0c\u5df2\u5207\u56de\u9996\u9801\u3002'
        : '\u9801\u9762\u8f09\u5165\u5df2\u903e\u6642\uff0c\u5df2\u5207\u63db\u5230\u5217\u8868\u3002';
      this._completeDeepLinkFallback(fallbackMessage, targetPage);
    }, this._deepLinkBootTimeoutMs);

    this._bootDeepLinkPoller = setInterval(() => {
      void this._tryOpenPendingDeepLink();
    }, 280);
  },

  async _tryOpenPendingDeepLink() {
    try {
      if (this._deepLinkRendered) return true;  // instant path 已完成
      if (this._instantDeepLinkMode) return false;  // instant path 正在處理，poller 不介入

      const pending = this._getPendingDeepLink();
      if (!pending) return true;

      const key = `${pending.type}:${pending.id}`;
      if (this._pendingDeepLinkOpenPromise && this._pendingDeepLinkOpenKey === key) {
        return await this._pendingDeepLinkOpenPromise;
      }

      const isAuthed = (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
      if (!isAuthed && pending.type !== 'event') {
        this._tryStartDeepLinkLogin();
        return false;
      }

      const openPromise = (async () => {
        if (pending.type === 'event') {
          let event = ApiService.getEvent?.(pending.id);
          // 快取未命中時，嘗試直接從 Firestore 取單筆活動（guest deep link 快速路徑）
          if (!event && typeof db !== 'undefined') {
            try {
              // 先嘗試以 pending.id 作為 doc path
              let doc = await db.collection('events').doc(pending.id).get();
              // 若 doc path 找不到，改用 id 欄位查詢（因為 docId 與 dataId 可能不同）
              if (!doc.exists) {
                const snap = await db.collection('events').where('id', '==', pending.id).limit(1).get();
                if (!snap.empty) doc = snap.docs[0];
              }
              if (doc.exists) {
                event = { ...doc.data(), _docId: doc.id };
                if (!event.id) event.id = doc.id;
                const cache = FirebaseService._cache.events;
                if (!cache.find(e => e.id === event.id || e._docId === doc.id)) {
                  cache.push(event);
                }
              }
            } catch (err) {
              console.warn('[DeepLink] direct event fetch failed:', err);
            }
          }
          if (!event) return false;

          // 未認證時啟用 instant mode，跳過 ensureCollectionsForPage 避免權限錯誤
          if (!isAuthed) this._instantDeepLinkMode = true;
          try {
            const result = await this.showEventDetail(pending.id, { allowGuest: !isAuthed });
            if (result?.ok && this.currentPage === 'page-activity-detail' && this._currentDetailEventId === pending.id) {
              this._completeDeepLinkSuccess();
              return true;
            }
            if (result?.reason === 'forbidden') {
              this._completeDeepLinkFallback('\u7121\u6cd5\u958b\u555f\u6d3b\u52d5\u8a73\u60c5\uff0c\u5df2\u5207\u56de\u5217\u8868\u3002', 'page-activities');
              return true;
            }
          } finally {
            if (!isAuthed) this._instantDeepLinkMode = false;
          }
          return false;
        }

        if (pending.type === 'team') {
          const team = ApiService.getTeam?.(pending.id);
          if (!team) return false;

          const result = await this.showTeamDetail(pending.id);
          if (result?.ok && this.currentPage === 'page-team-detail' && this._teamDetailId === pending.id) {
            this._completeDeepLinkSuccess();
            return true;
          }
          return false;
        }

        if (pending.type === 'tournament') {
          const tournament = ApiService.getTournament?.(pending.id);
          if (!tournament) return false;

          await ScriptLoader.ensureForPage('page-tournament-detail');
          await this.showTournamentDetail(pending.id);
          if (this.currentPage === 'page-tournament-detail' && this.currentTournament === pending.id) {
            this._completeDeepLinkSuccess();
            return true;
          }
          return false;
        }

        if (pending.type === 'profile') {
          const users = ApiService.getAdminUsers?.() || [];
          const user = users.find(u => u.uid === pending.id || u.lineUserId === pending.id);
          if (!user) return false;

          const name = user.displayName || user.name;
          if (!name) return false;
          await this.showUserProfile(name);
          this._completeDeepLinkSuccess();
          return true;
        }

        return false;
      })();

      this._pendingDeepLinkOpenKey = key;
      this._pendingDeepLinkOpenPromise = openPromise.finally(() => {
        if (this._pendingDeepLinkOpenKey === key) {
          this._pendingDeepLinkOpenKey = '';
          this._pendingDeepLinkOpenPromise = null;
        }
      });

      return await this._pendingDeepLinkOpenPromise;
    } catch (err) {
      console.warn('[DeepLink] pending open failed:', err);
      return false;
    }
  },

  _scheduleCloudBoot(reason = 'post-boot') {
    if (this._cloudReady || this._cloudReadyPromise || this._cloudBootScheduled) return;

    this._cloudBootScheduled = true;
    const kickoff = () => {
      this._cloudBootScheduled = false;
      void this.ensureCloudReady({ reason }).catch(() => {});
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(kickoff, 0));
      return;
    }
    setTimeout(kickoff, 0);
  },

  // detail 頁面需要 ID 才能渲染，hash 還原無法提供 ID → 退回父頁面
  _DETAIL_PAGE_FALLBACK: {
    'page-team-detail': 'page-teams',
    'page-activity-detail': 'page-activities',
    'page-edu-groups': 'page-teams',
    'page-edu-students': 'page-teams',
    'page-edu-course-plan': 'page-teams',
    'page-edu-checkin': 'page-teams',
    'page-edu-calendar': 'page-teams',
    'page-edu-student-apply': 'page-teams',
  },

  _resolveBootPageId(pageId) {
    return this._DETAIL_PAGE_FALLBACK[pageId] || pageId;
  },

  _isProtectedBootRestoreRoute(pageId) {
    if (!pageId || pageId === 'page-home' || pageId === 'page-temp-participant-report') return false;
    if (typeof this._findDrawerMenuItem === 'function') {
      const drawerItem = this._findDrawerMenuItem(pageId);
      if (drawerItem && (drawerItem.permissionCode || drawerItem.minRole)) return true;
    }
    const pageEl = document.getElementById(pageId);
    const minRole = String(pageEl?.dataset?.minRole || '').trim();
    return !!minRole && minRole !== 'user';
  },

  _deferProtectedBootRoute(pageId) {
    if (!pageId) return;
    this._pendingProtectedBootRoute = {
      pageId,
      queuedAt: Date.now(),
    };
  },

  _clearPendingProtectedBootRoute() {
    this._pendingProtectedBootRoute = null;
    this._pendingProtectedBootRoutePromise = null;
  },

  _replaceRouteHash(pageId) {
    try {
      const url = new URL(window.location.href);
      url.hash = pageId ? `#${pageId}` : '';
      history.replaceState(null, '', url.pathname + (url.search || '') + (url.hash || ''));
    } catch (_) {
      if (pageId) location.hash = pageId;
    }
  },

  async _flushPendingProtectedBootRoute(options = {}) {
    const pending = this._pendingProtectedBootRoute;
    if (!pending?.pageId) return false;
    if (this._pendingProtectedBootRoutePromise) {
      return await this._pendingProtectedBootRoutePromise;
    }

    const pageId = pending.pageId;
    const skipEnsureCloudReady = options.skipEnsureCloudReady === true;
    let restorePromise = null;
    restorePromise = (async () => {
      try {
        if (!skipEnsureCloudReady && this._pageNeedsCloud(pageId) && typeof this.ensureCloudReady === 'function') {
          try {
            await _withSportHubTimeout(
              this.ensureCloudReady({ reason: `restore:${pageId}` }),
              this._routeCloudTimeoutMs,
              'route-step-timeout',
              `Route step timeout (restore-cloud:${pageId})`
            );
          } catch (err) {
            console.warn(`[Boot] protected route cloud restore failed for ${pageId}:`, err);
          }
        }

        if (typeof FirebaseService !== 'undefined'
          && typeof FirebaseService._startAuthDependentWork === 'function') {
          try {
            await Promise.race([
              Promise.resolve(FirebaseService._startAuthDependentWork()),
              new Promise(resolve => setTimeout(resolve, 5000)),
            ]);
          } catch (err) {
            console.warn(`[Boot] protected route access sync failed for ${pageId}:`, err);
          }
        }

        const result = await this.showPage(pageId, {
          resetHistory: true,
          suppressAccessDeniedToast: true,
          suppressLoginToast: true,
        });

        if (result?.ok) {
          this._clearPendingProtectedBootRoute();
          return true;
        }

        this._replaceRouteHash('page-home');
        if (this.currentPage !== 'page-home') {
          await this.showPage('page-home', {
            bypassRestrictionGuard: true,
            resetHistory: true,
          });
        }
        this._clearPendingProtectedBootRoute();
        return false;
      } finally {
        if (this._pendingProtectedBootRoutePromise === restorePromise) {
          this._pendingProtectedBootRoutePromise = null;
        }
      }
    })();

    this._pendingProtectedBootRoutePromise = restorePromise;
    return await restorePromise;
  },

  async ensureCloudReady(options = {}) {
    const { reason = 'unknown' } = options;
    if (this._cloudReady) return true;
    if (this._cloudReadyPromise) return await this._cloudReadyPromise;

    console.log(`[Cloud] ensureCloudReady start: ${reason}`);
    this._cloudReadyError = null;

    const bootPromise = (async () => {
      await _loadCDNScripts();
      if (!initFirebaseApp()) {
        throw new Error('FIREBASE_APP_INIT_FAILED');
      }

      if (typeof liff !== 'undefined') {
        LineAuth._ready = false;
        LineAuth._initError = null;
      }

      // LIFF init 與 Firebase init 並行，避免 LIFF 阻塞資料載入（guest deep link 需要快速載入事件）
      const liffReadyPromise = (typeof liff !== 'undefined')
        ? LineAuth.initSDK().then(() => {
            console.log('[Cloud] LIFF SDK ready');
            if (LineAuth.hasLiffSession()) {
              // Tier 1：正常 LIFF session
              LineAuth.restoreCachedProfile();
              if (LineAuth._profile) {
                try { this.renderLoginUI(); } catch (_) {}
              }
            } else {
              // Tier 2 預載：嘗試從快取恢復 profile（Firebase Auth 稍後驗證）
              LineAuth.restoreCachedProfile();
              if (LineAuth._profile) {
                console.log('[Cloud] Tier 2: 從快取恢復 profile（等待 Firebase Auth 驗證）');
                try { this.renderLoginUI(); } catch (_) {}
              }
            }
          }).catch(err => {
            console.warn('[Cloud] LIFF init failed (non-blocking):', err);
          })
        : Promise.resolve();

      await Promise.all([liffReadyPromise, FirebaseService.init()]);

      // LIFF profile（需要 LIFF 已 ready）
      if (LineAuth.hasLiffSession()) {
        // Tier 1：完整 LIFF 刷新
        await LineAuth.ensureProfile({ force: true }).catch(err => {
          console.warn('[Cloud] ensureProfile failed:', err);
        });
      } else if (LineAuth._profile && LineAuth._firebaseSessionAlive()) {
        // Tier 2：LIFF 過期但 Firebase Auth 存活
        if (LineAuth._matchesFirebaseUid(LineAuth._profile)) {
          console.log('[Cloud] Tier 2 login: cached profile + Firebase Auth');
          LineAuth._scheduleProfileRefresh();
        } else {
          // UID 不一致，清除快取
          console.warn('[Cloud] Tier 2: UID mismatch, clearing cache');
          LineAuth._profile = null;
          LineAuth._clearProfileCache();
        }
      }

      this._firebaseConnected = true;
      this._cloudReady = true;
      this._cloudReadyError = null;
      ApiService._errorLogReady = true;
      console.log('[Cloud] Firebase + LIFF ready');

      // 背景載入 Auto-EXP 規則（Firestore → 記憶體快取 + localStorage fallback）
      if (typeof this._loadAutoExpRulesFromFirestore === 'function') {
        this._loadAutoExpRulesFromFirestore().catch(() => {});
      }

      try { this.renderAll(); } catch (_) {}
      _dismissBootOverlay('Cloud ready');
      try {
        if (typeof this.bindLineLogin === 'function') {
          await this.bindLineLogin();
        }
      } catch (err) {
        console.error('[Cloud] bindLineLogin failed:', err?.message || err, err?.stack || '');
        try { this.showToast('LINE login init failed.'); } catch (_) {}
      }
      void this._flushPendingProtectedBootRoute({ skipEnsureCloudReady: true });
      void this._tryOpenPendingDeepLink();

      // instant deep link 已渲染 → SDK ready 後背景載入完整集合 + 重新渲染
      if (this._instantDeepLinkEventId && this.currentPage === 'page-activity-detail') {
        const sdkEventId = this._instantDeepLinkEventId;
        this._instantDeepLinkEventId = null;
        void (async () => {
          try {
            const pageId = 'page-activity-detail';

            // 1. 載入靜態集合（activityRecords、userCorrections 等）
            if (typeof FirebaseService !== 'undefined' && FirebaseService.ensureCollectionsForPage) {
              await FirebaseService.ensureCollectionsForPage(pageId, { skipRealtimeStart: true });
            }

            // 2. 立即啟動 realtime listener（registrations + attendanceRecords）
            //    不走 schedulePageScopedRealtimeForPage 的 350ms 延遲
            if (typeof FirebaseService !== 'undefined' && FirebaseService._startPageScopedRealtimeForPage) {
              FirebaseService._startPageScopedRealtimeForPage(pageId);
            }

            // 3. 用 SDK 重新取得完整事件資料（覆蓋 REST 簡略版）
            if (typeof db !== 'undefined') {
              try {
                // 先嘗試 doc path，再嘗試 id 欄位查詢
                let doc = await db.collection('events').doc(sdkEventId).get();
                if (!doc.exists) {
                  const snap = await db.collection('events').where('id', '==', sdkEventId).limit(1).get();
                  if (!snap.empty) doc = snap.docs[0];
                }
                if (doc.exists) {
                  const fullEvent = { ...doc.data(), _docId: doc.id };
                  if (!fullEvent.id) fullEvent.id = doc.id;
                  const cache = FirebaseService._cache.events;
                  const idx = cache.findIndex(e => e.id === sdkEventId || e._docId === doc.id);
                  if (idx >= 0) cache[idx] = fullEvent; else cache.push(fullEvent);
                }
              } catch (_) {}
            }

            // 4. 等待 registrations 首次 onSnapshot（最多 3 秒）
            //    已登入才等（guest 的 listener 不會啟動）
            const isGuest = !(typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
            if (!isGuest && FirebaseService._cache.registrations.length === 0) {
              await new Promise(resolve => {
                const check = () => FirebaseService._cache.registrations.length > 0;
                if (check()) { resolve(); return; }
                const interval = setInterval(() => { if (check()) { clearInterval(interval); resolve(); } }, 100);
                setTimeout(() => { clearInterval(interval); resolve(); }, 3000);
              });
            }

            if (this.currentPage !== pageId) return;

            // 5. 重新渲染（此時 cache 已有完整資料）
            await this.showEventDetail(sdkEventId, { allowGuest: isGuest });
            console.log('[DeepLink] SDK background refresh complete for', sdkEventId);
          } catch (err) {
            console.warn('[DeepLink] SDK background refresh failed:', err);
          }
        })();
      }

      return true;
    })();

    this._cloudReadyPromise = bootPromise;

    try {
      return await bootPromise;
    } catch (err) {
      this._cloudReadyError = err;
      console.error(`[Cloud] ensureCloudReady failed (${reason}):`, err?.message || err);
      _dismissBootOverlay('Cloud init failed');
      try { this.showToast('Cloud init failed. Please retry.'); } catch (_) {}
      try {
        if (typeof this.bindLineLogin === 'function') {
          await this.bindLineLogin();
        }
      } catch (_) {}
      void this._flushPendingProtectedBootRoute({ skipEnsureCloudReady: true });
      void this._tryOpenPendingDeepLink();
      throw err;
    } finally {
      if (!this._cloudReady) {
        this._cloudReadyPromise = null;
      }
    }
  },
};

// ── CDN SDK 動態載入器（不阻塞 DOMContentLoaded）──
const _dynamicScriptPromises = {};
let _cdnScriptsPromise = null;

function _loadScript(src) {
  if (_dynamicScriptPromises[src]) return _dynamicScriptPromises[src];

  const timeoutMs = Number(App?._scriptLoadTimeoutMs || 12000);
  const bindLoadPromise = (scriptEl, options = {}) => {
    const { removeOnTimeout = false } = options;
    return _withSportHubTimeout(
      new Promise((resolve, reject) => {
        const cleanup = () => {
          scriptEl.removeEventListener('load', onLoad);
          scriptEl.removeEventListener('error', onError);
        };
        const onLoad = () => {
          cleanup();
          scriptEl.dataset.loaded = 'true';
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('Script load failed: ' + src));
        };

        scriptEl.addEventListener('load', onLoad, { once: true });
        scriptEl.addEventListener('error', onError, { once: true });
      }),
      timeoutMs,
      'script-load-timeout',
      'Script load timeout: ' + src
    ).catch(err => {
      if (err?.code === 'script-load-timeout' && removeOnTimeout) {
        try { scriptEl.remove(); } catch (_) {}
      }
      throw err;
    });
  };

  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) {
    if (existing.dataset.loaded === 'true') {
      return Promise.resolve();
    }
    _dynamicScriptPromises[src] = bindLoadPromise(existing).catch(err => {
      delete _dynamicScriptPromises[src];
      throw err;
    });
    return _dynamicScriptPromises[src];
  }

  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  // 跨域 script 設定 CORS anonymous，匹配 <link rel="preload" crossorigin> 避免重複下載
  try { if (new URL(src).origin !== location.origin) s.crossOrigin = 'anonymous'; } catch (_) {}
  document.head.appendChild(s);

  _dynamicScriptPromises[src] = bindLoadPromise(s, { removeOnTimeout: true }).catch(err => {
    delete _dynamicScriptPromises[src];
    throw err;
  });
  return _dynamicScriptPromises[src];
}

async function _loadCDNScriptsOnce() {
  await _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
  await Promise.all([
    _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js'),
    _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-storage-compat.js'),
    _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js'),
    _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-functions-compat.js'),
    _loadScript('https://static.line-scdn.net/liff/edge/2/sdk.js'),
  ]);
}

async function _loadCDNScripts() {
  if (_cdnScriptsPromise) return await _cdnScriptsPromise;

  _cdnScriptsPromise = (async () => {
    try {
      await _loadCDNScriptsOnce();
    } catch (firstErr) {
      // 首次超時 → 自動重試一次（瀏覽器已部分快取，第二次通常更快）
      console.warn('[CDN] 首次載入失敗，自動重試:', firstErr?.message || firstErr);
      const origTimeout = App._scriptLoadTimeoutMs;
      App._scriptLoadTimeoutMs = 10000; // 重試用較短超時（瀏覽器有快取）
      try {
        await _loadCDNScriptsOnce();
      } finally {
        App._scriptLoadTimeoutMs = origTimeout;
      }
    }
    console.log('[CDN] Firebase + LIFF SDK loaded');
    return true;
  })();

  try {
    return await _cdnScriptsPromise;
  } catch (err) {
    _cdnScriptsPromise = null;
    throw err;
  }
}

// Init on DOM Ready ──
document.addEventListener('DOMContentLoaded', async () => {
  window._appInitializing = true;
  console.log('[Boot] DOMContentLoaded fired');

  // 先解析 deep link，避免先看到首頁再跳轉
  try {
    const urlParams = new URLSearchParams(location.search);
    const deepEvent = String(urlParams.get('event') || '').trim();
    const deepTeam = String(urlParams.get('team') || '').trim();
    const deepTournament = String(urlParams.get('tournament') || '').trim();
    const deepProfile = String(urlParams.get('profile') || '').trim();
    const deepNews = String(urlParams.get('news') || '').trim();
    if (deepEvent) sessionStorage.setItem('_pendingDeepEvent', deepEvent);
    if (deepTeam) sessionStorage.setItem('_pendingDeepTeam', deepTeam);
    if (deepTournament) sessionStorage.setItem('_pendingDeepTournament', deepTournament);
    if (deepProfile) sessionStorage.setItem('_pendingDeepProfile', deepProfile);
    // news deep link: redirect immediately to article URL
    if (deepNews && App._openNewsArticle) {
      App._openNewsArticle(deepNews);
    }
    // 立即啟動 REST fetch（不等 SDK）— URL 有 ?event= 或 sessionStorage 有殘留（LINE 登入回來）
    const restEventId = deepEvent || String(sessionStorage.getItem('_pendingDeepEvent') || '').trim();
    if (restEventId) {
      App._deepLinkRestFetch = App._fetchEventViaRest(restEventId);
    }
  } catch (_) {}
  App._startDeepLinkGuard();

  // ── Phase 1: 載入頁面 HTML 片段（10 秒超時保護）──
  console.log('[Boot] Phase 1: PageLoader.loadAll() 開始（背景執行）');
  const htmlReady = Promise.race([
    PageLoader.loadAll().catch(function(e) {
      console.warn('[Boot] PageLoader.loadAll() 失敗:', e && e.message || e);
    }),
    new Promise(resolve => setTimeout(resolve, 10000)),
  ]).then(() => {
    console.log('[Boot] Phase 1: 完成');
  }).catch((e) => {
    console.error('[Boot] Phase 1 異常:', e && e.message || e);
  });

  // ── Phase 2: 從 localStorage 恢復快取資料 ──
  try {
    console.log('[Boot] Phase 2: 恢復快取');
    FirebaseService._restoreCache();
    console.log('[Boot] Phase 2: 完成');
  } catch (e) {
    console.warn('[Boot] Phase 2 快取恢復失敗:', e && e.message || e);
  }

  // ── Phase 3: 立即顯示頁面（不等 HTML / CDN / Firebase）──
  try {
    console.log('[Boot] Phase 3: App.init() 開始');
    App.init();
    console.log('[Boot] Phase 3: App.init() 完成');
  } catch (initErr) {
    console.error('[Boot] Phase 3 App.init() 失敗:', initErr && initErr.message || initErr, initErr && initErr.stack || '');
    try {
      var rb = document.getElementById('_recovery_btn');
      if (!rb) {
        rb = document.createElement('button');
        rb.id = '_recovery_btn';
        rb.textContent = '載入失敗，點此重新整理';
        rb.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;padding:1rem 2rem;font-size:1rem;background:#dc2626;color:#fff;border:none;border-radius:8px;cursor:pointer';
        rb.onclick = function() { location.reload(); };
        document.body.appendChild(rb);
      }
    } catch (e2) {}
  }

  // Phase 3 完成：移除 prod-early class，根據快取狀態決定是否隱藏載入畫面
  try {
    document.documentElement.classList.remove('prod-early');
    // 檢查首頁是否有實際內容（localStorage 快取命中）
    var _homeHasContent = false;
    try {
      if (typeof FirebaseService !== 'undefined' && FirebaseService._cache) {
        _homeHasContent = FirebaseService._cache.events.length > 0;
      }
    } catch (_) {}

    if (_homeHasContent) {
      _dismissBootOverlay('Phase 3 快取命中');
    } else {
      // 快取未命中：保留 overlay，等 Phase 4 cloud boot 完成再隱藏
      var _sub = document.querySelector('#loading-overlay .boot-loading__sub');
      if (_sub) _sub.textContent = '載入資料中..';
      console.log('[Boot] 快取未命中，保留載入畫面等待 Cloud ready');
      // 20 秒 safety timeout 繼續生效（index.html 已設置）
    }
    console.log('[Boot] Phase 3 完成');
  } catch (e) {
    console.warn('[Boot] Phase 3 完成處理失敗:', e && e.message || e);
  }

  // ── Phase 1 完成後補跑一次 renderAll + 動態頁面事件綁定（非阻塞）──
  htmlReady.then(async function() {
    try {
      App.renderAll();
      console.log('[Boot] Phase 1 後補跑 renderAll 完成');
    } catch (e) {
      console.warn('[Boot] Phase 1 完成後 renderAll 失敗:', e && e.message || e);
    }
    try {
      App._bindPageElements();
      console.log('[Boot] Phase 1 後補跑 _bindPageElements 完成');
    } catch (e) {
      console.warn('[Boot] _bindPageElements 失敗:', e && e.message || e);
    }
    // HTML ready + REST fetch → 嘗試即時渲染活動頁
    if (App._deepLinkRestFetch && !App._deepLinkRendered) {
      try {
        await App._tryInstantEventDeepLink();
      } catch (e) {
        console.warn('[Boot] instant deep link failed:', e && e.message || e);
      }
    }
  });

  // Phase 4: deep link boots cloud immediately; normal home boot defers until first paint.
  {
    const pendingDeepLink = App._getPendingDeepLink();
    if (pendingDeepLink) {
      console.log('[Boot] Phase 4: immediate cloud init for deep link');
      void App.ensureCloudReady({ reason: 'boot-deep-link' }).catch(() => {});
    } else {
      console.log('[Boot] Phase 4: schedule deferred cloud init');
      App._scheduleCloudBoot('boot-idle');
    }
  }

  // Global unhandled rejection → errorLog（過濾第三方 SDK 雜訊，但記錄嚴重錯誤）
  window.addEventListener('unhandledrejection', (event) => {
    const msg = (event.reason?.message || '').toLowerCase();
    // Firebase SDK INTERNAL ASSERTION FAILED：記錄但不報錯（已知 IndexedDB 問題）
    if (msg.includes('assertion') && (msg.includes('firebase') || msg.includes('firestore'))) {
      console.error('[SDK] Firebase assertion error (IndexedDB issue):', event.reason?.message);
      return;
    }
    if (!ApiService._errorLogReady) return;
    // permission-denied 不靜默：記錄並提示用戶
    const code = (event.reason?.code || '').toLowerCase();
    if (code === 'permission-denied') {
      console.error('[unhandledrejection] Firestore permission-denied:', event.reason?.message);
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('操作失敗：權限不足\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
      }
      ApiService._writeErrorLog('permission-denied', event.reason);
      return;
    }
    if (msg.includes('liff') || msg.includes('firebase') || msg.includes('firestore') || msg.includes('chunkloaderror')) return;
    ApiService._writeErrorLog('unhandledrejection', event.reason);
  });

  // 嘗試立即開啟 deep link（其餘會由 guard 持續輪詢）
  void App._tryOpenPendingDeepLink();
  try {
    if (!App._getPendingDeepLink()) {
      const bootUrl = new URL(window.location.href);
      const rawPageId = bootUrl.searchParams.get('rid')
        ? 'page-temp-participant-report'
        : location.hash.replace(/^#/, '');
      const bootPageId = App._resolveBootPageId(rawPageId);
      if (bootPageId && bootPageId !== App.currentPage) {
        if (App._isProtectedBootRestoreRoute(bootPageId)) {
          App._deferProtectedBootRoute(bootPageId);
          void App._flushPendingProtectedBootRoute();
        } else {
          void App.showPage(bootPageId);
        }
      }
    }
  } catch (_) {}

  // 定時任務（全部 try-catch 保護）
  // Hash 路由：瀏覽器返回/前進鍵同步頁面
  // pageId !== App.currentPage 條件防止 showPage() 設 hash 後再次觸發無窮迴圈
  try {
    window.addEventListener('hashchange', () => {
      const pageId = location.hash.replace(/^#/, '');
      // hashchange 不套用 _resolveBootPageId，因為正常導航（showTeamDetail 等）
      // 會在渲染完成後設定 hash，此時不應被重導回列表頁
      const canResolvePage = pageId
        && (document.getElementById(pageId)
          || (typeof PageLoader !== 'undefined' && PageLoader._pageFileMap && PageLoader._pageFileMap[pageId]));
      if (canResolvePage && pageId !== App.currentPage) {
        // 首次登入守衛：缺少必填資料時攔截 hash 導航
        if (App._pendingFirstLogin) {
          App._tryShowFirstLoginModal?.();
          return;
        }
        App.showPage(pageId);
      }
    });
  } catch (e) {}
  try { App._syncBootBrandToLocal?.(); } catch (e) {}
  try { App._autoExpireAds(); } catch (e) {}
  setInterval(() => { try { App._autoExpireAds(); } catch (e) {} }, 60000);
  try { Promise.resolve(App._processScheduledMessages()).catch(() => {}); } catch (e) {}
  setInterval(() => { try { Promise.resolve(App._processScheduledMessages()).catch(() => {}); } catch (e) {} }, 60000);
  try { App._processEventReminders(); } catch (e) {}
  setInterval(() => { try { App._processEventReminders(); } catch (e) {} }, 300000);
  window._appInitializing = false;
  console.log('[Boot] 初始化流程結束');
});
