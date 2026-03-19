/* ================================================
   SportHub — PWA Install (Drawer Button)
   依賴：無（獨立模組）
   ================================================ */

Object.assign(App, {

  _deferredInstallPrompt: null,

  initPwaInstall() {
    var btn = document.getElementById('pwa-install-btn');
    if (!btn) return;

    // 已經以 PWA 模式運行 → 隱藏按鈕
    var isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true;
    if (isStandalone) { btn.style.display = 'none'; return; }

    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    var isLINE = /Line\//i.test(navigator.userAgent);

    // Android / Chrome：監聽 beforeinstallprompt
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      App._deferredInstallPrompt = e;
      btn.style.display = '';
    });

    // iOS：直接顯示按鈕（會開教學彈窗）
    // LINE 瀏覽器內也顯示（引導用戶到 Safari）
    if (isIOS || isLINE) {
      btn.style.display = '';
    }

    // 安裝成功後隱藏
    window.addEventListener('appinstalled', function () {
      btn.style.display = 'none';
      App._deferredInstallPrompt = null;
    });

    btn.addEventListener('click', function () {
      App._handlePwaInstallClick();
    });
  },

  _handlePwaInstallClick() {
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    var isLINE = /Line\//i.test(navigator.userAgent);

    // LINE 瀏覽器內：引導到 Safari
    if (isLINE) {
      this._showIosPwaGuideModal(true);
      return;
    }

    // iOS Safari：顯示安裝教學
    if (isIOS) {
      this._showIosPwaGuideModal(false);
      return;
    }

    // Android / Chrome：觸發原生安裝
    if (this._deferredInstallPrompt) {
      this._deferredInstallPrompt.prompt();
      this._deferredInstallPrompt.userChoice.then(function () {
        App._deferredInstallPrompt = null;
      });
      return;
    }

    // 其他瀏覽器 fallback
    this.showToast('請使用 Chrome 或 Safari 開啟本網站再安裝');
  },

  _showIosPwaGuideModal(isLINEBrowser) {
    var existing = document.getElementById('pwa-ios-modal');
    if (existing) existing.parentNode.removeChild(existing);

    var overlay = document.createElement('div');
    overlay.id = 'pwa-ios-modal';
    overlay.className = 'pwa-ios-modal-overlay';

    var lineHint = isLINEBrowser
      ? '<div class="pwa-ios-step">'
        + '<div class="pwa-ios-step-num">0</div>'
        + '<div class="pwa-ios-step-text">'
        + '<strong>先用 Safari 開啟</strong><br>'
        + '請點右上角選單「⋯」→「在預設瀏覽器中開啟」，再進行以下步驟'
        + '</div></div>'
        + '<div class="pwa-ios-divider"></div>'
      : '';

    overlay.innerHTML =
      '<div class="pwa-ios-modal">'
      + '<div class="pwa-ios-modal-header">'
      + '<span>安裝 ToosterX APP</span>'
      + '<button class="pwa-ios-modal-close" id="pwa-ios-close">&times;</button>'
      + '</div>'
      + '<div class="pwa-ios-modal-body">'
      + lineHint
      + '<div class="pwa-ios-step">'
      + '<div class="pwa-ios-step-num">1</div>'
      + '<div class="pwa-ios-step-text">'
      + '<strong>點擊底部「分享」按鈕</strong><br>'
      + '在 Safari 底部工具列找到分享圖示（方框 + 向上箭頭）'
      + '</div></div>'
      + '<img class="pwa-ios-img" src="PWA/PWA01.jpg" alt="步驟1">'
      + '<div class="pwa-ios-divider"></div>'
      + '<div class="pwa-ios-step">'
      + '<div class="pwa-ios-step-num">2</div>'
      + '<div class="pwa-ios-step-text">'
      + '<strong>往下滑，點「加入主畫面」</strong><br>'
      + '在分享選單中找到「加入主畫面」選項'
      + '</div></div>'
      + '<img class="pwa-ios-img" src="PWA/PWA02.jpg" alt="步驟2">'
      + '<div class="pwa-ios-divider"></div>'
      + '<div class="pwa-ios-step">'
      + '<div class="pwa-ios-step-num">3</div>'
      + '<div class="pwa-ios-step-text">'
      + '<strong>點右上角「加入」</strong><br>'
      + '確認名稱後按「加入」，APP 圖示即出現在主畫面'
      + '</div></div>'
      + '<img class="pwa-ios-img" src="PWA/PWA03.jpg" alt="步驟3">'
      + '</div></div>';

    document.body.appendChild(overlay);

    requestAnimationFrame(function () {
      overlay.classList.add('visible');
    });

    var closeBtn = document.getElementById('pwa-ios-close');
    closeBtn.addEventListener('click', function () {
      App._closeIosPwaModal();
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) App._closeIosPwaModal();
    });
  },

  _closeIosPwaModal() {
    var m = document.getElementById('pwa-ios-modal');
    if (!m) return;
    m.classList.remove('visible');
    m.addEventListener('transitionend', function handler() {
      m.removeEventListener('transitionend', handler);
      if (m.parentNode) m.parentNode.removeChild(m);
    });
    setTimeout(function () {
      if (m.parentNode) m.parentNode.removeChild(m);
    }, 400);
  },

});
