/* ================================================
   SportHub — Multi-Tab Guard
   偵測同站多分頁開啟，顯示警告避免權限/資料同步衝突
   依賴：無（獨立模組，自動 init）
   ================================================ */

Object.assign(App, {

  _multiTabId: null,
  _multiTabChannel: null,
  _multiTabOthers: null,
  _multiTabWarningShown: false,

  initMultiTabGuard() {
    if (typeof BroadcastChannel === 'undefined') return;
    if (this._multiTabChannel) return;  // 已初始化過
    try {
      this._multiTabId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      this._multiTabChannel = new BroadcastChannel('toosterx-tab-guard');
      this._multiTabOthers = new Set();
      var self = this;

      this._multiTabChannel.onmessage = function (e) {
        if (!e.data || e.data.tabId === self._multiTabId) return;
        if (e.data.type === 'ping') {
          // 收到別人 ping → 回 pong 告知我方存在
          try { self._multiTabChannel.postMessage({ type: 'pong', tabId: self._multiTabId }); } catch (_) {}
          self._multiTabOthers.add(e.data.tabId);
          self._showMultiTabWarning();
        } else if (e.data.type === 'pong') {
          // 別人回應我方的 ping → 確認有其他 tab
          self._multiTabOthers.add(e.data.tabId);
          self._showMultiTabWarning();
        } else if (e.data.type === 'bye') {
          self._multiTabOthers.delete(e.data.tabId);
        } else if (e.data.type === 'close-others') {
          // 2026-04-27：別的 tab 要求我關閉（用戶在新 tab 按「關閉其他分頁」）
          self._handleCloseRequest();
        }
      };

      // 廣播自己的存在（若有其他 tab 會回 pong）
      try { this._multiTabChannel.postMessage({ type: 'ping', tabId: this._multiTabId }); } catch (_) {}

      // 離開時通知其他 tab
      window.addEventListener('beforeunload', function () {
        try {
          self._multiTabChannel.postMessage({ type: 'bye', tabId: self._multiTabId });
          self._multiTabChannel.close();
        } catch (_) {}
      });
    } catch (err) {
      console.warn('[MultiTabGuard] init failed:', err);
    }
  },

  _showMultiTabWarning() {
    if (this._multiTabWarningShown) return;
    if (document.getElementById('multi-tab-warning')) return;
    this._multiTabWarningShown = true;

    var overlay = document.createElement('div');
    overlay.id = 'multi-tab-warning';
    overlay.className = 'multi-tab-overlay';
    overlay.innerHTML =
      '<div class="multi-tab-modal">' +
        '<div class="multi-tab-title">偵測到多個分頁開啟</div>' +
        '<div class="multi-tab-body">' +
          '為了穩定的登入與資料同步體驗，<br>' +
          '建議只保留一個分頁。' +
          '<div class="multi-tab-divider"></div>' +
          '點下方按鈕可請其他舊分頁自動關閉<br>' +
          '<span style="font-size:.78rem;color:var(--text-muted)">（手動開的分頁可能要自行關閉）</span>' +
        '</div>' +
        '<div class="multi-tab-actions">' +
          '<button class="outline-btn" id="multi-tab-dismiss">我知道了</button>' +
          '<button class="primary-btn" id="multi-tab-close">關閉其他分頁</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var self = this;
    var dismissBtn = document.getElementById('multi-tab-dismiss');
    var closeBtn = document.getElementById('multi-tab-close');
    if (dismissBtn) dismissBtn.addEventListener('click', function () { self._dismissMultiTabWarning(false); });
    if (closeBtn) closeBtn.addEventListener('click', function () { self._requestCloseOthers(); });
  },

  /** 2026-04-27：要求其他分頁關閉（保留當前分頁） */
  _requestCloseOthers() {
    try {
      this._multiTabChannel.postMessage({ type: 'close-others', tabId: this._multiTabId });
    } catch (_) {}
    // 關閉當前 modal、不關自己
    this._dismissMultiTabWarning(false);
    if (typeof this.showToast === 'function') {
      this.showToast('已通知其他分頁關閉');
    }
    // 清空 _multiTabOthers、避免後續 ping/pong 又彈 modal
    this._multiTabOthers = new Set();
  },

  /** 2026-04-27：被其他分頁要求關閉時的處理 */
  _handleCloseRequest() {
    // 移除自己的 modal（如果有）
    var el = document.getElementById('multi-tab-warning');
    if (el && el.parentNode) el.parentNode.removeChild(el);
    this._multiTabWarningShown = false;
    // 顯示提示、嘗試關閉
    if (typeof this.showToast === 'function') {
      this.showToast('已被其他分頁取代、請手動關閉');
    }
    var self = this;
    setTimeout(function () {
      try {
        // 通知對方自己即將關閉（清乾淨）
        self._multiTabChannel.postMessage({ type: 'bye', tabId: self._multiTabId });
        self._multiTabChannel.close();
      } catch (_) {}
      try { window.close(); } catch (_) {}
    }, 800);
  },

  _dismissMultiTabWarning(tryClose) {
    var el = document.getElementById('multi-tab-warning');
    if (el && el.parentNode) el.parentNode.removeChild(el);
    // 2026-04-27：tryClose 已棄用、改由 _requestCloseOthers 處理（保留參數簽名相容）
  },

});

// 自動初始化（DOM ready 後，確保 document.body 可用）
(function () {
  if (typeof App === 'undefined') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { App.initMultiTabGuard(); });
  } else {
    App.initMultiTabGuard();
  }
})();
