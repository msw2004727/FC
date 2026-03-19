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

    // 所有環境都顯示按鈕
    btn.style.display = '';

    // Android Chrome：監聽 beforeinstallprompt
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      App._deferredInstallPrompt = e;
    });

    btn.addEventListener('click', function () {
      App._handlePwaInstallClick();
    });
  },

  _handlePwaInstallClick() {
    // 有原生安裝提示（Android Chrome）→ 直接觸發
    if (this._deferredInstallPrompt) {
      this._deferredInstallPrompt.prompt();
      this._deferredInstallPrompt.userChoice.then(function () {
        // 不隱藏按鈕，不清除 prompt（無法可靠偵測安裝/移除）
      });
      return;
    }

    // 無法判定系統 → 彈窗詢問用戶
    this._showPwaSystemPicker();
  },

  // ══════════════════════════════════
  //  系統選擇彈窗（Android / iOS）
  // ══════════════════════════════════

  _showPwaSystemPicker() {
    var existing = document.getElementById('pwa-system-picker');
    if (existing) existing.parentNode.removeChild(existing);

    var overlay = document.createElement('div');
    overlay.id = 'pwa-system-picker';
    overlay.className = 'pwa-modal-overlay';

    overlay.innerHTML =
      '<div class="pwa-picker-panel">'
      + '<div class="pwa-picker-header">'
      + '<span>安裝 ToosterX APP</span>'
      + '<button class="pwa-modal-close" id="pwa-picker-close">&times;</button>'
      + '</div>'
      + '<div class="pwa-picker-body">'
      + '<p class="pwa-picker-desc">請選擇你的手機系統，我們將引導你完成安裝：</p>'
      + '<div class="pwa-picker-btns">'
      + '<button class="pwa-picker-btn pwa-picker-android" id="pwa-pick-android">'
      + '<span class="pwa-picker-icon">&#x1F4F1;</span>'
      + '<span class="pwa-picker-label">Android</span>'
      + '<span class="pwa-picker-sub">使用 Chrome 安裝</span>'
      + '</button>'
      + '<button class="pwa-picker-btn pwa-picker-ios" id="pwa-pick-ios">'
      + '<span class="pwa-picker-icon">&#x1F34F;</span>'
      + '<span class="pwa-picker-label">iPhone / iPad</span>'
      + '<span class="pwa-picker-sub">使用 Safari 安裝</span>'
      + '</button>'
      + '</div></div></div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('visible'); });

    document.getElementById('pwa-picker-close').addEventListener('click', function () {
      App._closePwaModal('pwa-system-picker');
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) App._closePwaModal('pwa-system-picker');
    });
    document.getElementById('pwa-pick-android').addEventListener('click', function () {
      App._closePwaModal('pwa-system-picker');
      App._showAndroidPwaGuide();
    });
    document.getElementById('pwa-pick-ios').addEventListener('click', function () {
      App._closePwaModal('pwa-system-picker');
      App._showIosPwaGuide();
    });
  },

  // ══════════════════════════════════
  //  Android 安裝引導
  // ══════════════════════════════════

  _showAndroidPwaGuide() {
    var existing = document.getElementById('pwa-android-modal');
    if (existing) existing.parentNode.removeChild(existing);

    var overlay = document.createElement('div');
    overlay.id = 'pwa-android-modal';
    overlay.className = 'pwa-modal-overlay';

    overlay.innerHTML =
      '<div class="pwa-guide-panel">'
      + '<div class="pwa-guide-header">'
      + '<span>Android 安裝教學</span>'
      + '<button class="pwa-modal-close" id="pwa-android-close">&times;</button>'
      + '</div>'
      + '<div class="pwa-guide-body">'
      + '<div class="pwa-guide-step">'
      + '<div class="pwa-guide-num">1</div>'
      + '<div class="pwa-guide-text">'
      + '<strong>複製網址</strong><br>'
      + '點擊下方按鈕複製本站網址'
      + '</div></div>'
      + '<button class="pwa-guide-copy-btn" id="pwa-android-copy">複製網址</button>'
      + '<div class="pwa-guide-divider"></div>'
      + '<div class="pwa-guide-step">'
      + '<div class="pwa-guide-num">2</div>'
      + '<div class="pwa-guide-text">'
      + '<strong>用 Chrome 瀏覽器開啟</strong><br>'
      + '打開 Chrome，在網址列貼上剛才複製的網址'
      + '</div></div>'
      + '<div class="pwa-guide-divider"></div>'
      + '<div class="pwa-guide-step">'
      + '<div class="pwa-guide-num">3</div>'
      + '<div class="pwa-guide-text">'
      + '<strong>點擊右上角選單 ⋮</strong><br>'
      + '找到「安裝應用程式」或「加到主畫面」，點擊即完成安裝'
      + '</div></div>'
      + '</div></div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('visible'); });

    document.getElementById('pwa-android-close').addEventListener('click', function () {
      App._closePwaModal('pwa-android-modal');
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) App._closePwaModal('pwa-android-modal');
    });
    document.getElementById('pwa-android-copy').addEventListener('click', function () {
      App._copyToClipboard('https://toosterx.com').then(function (ok) {
        App.showToast(ok ? '網址已複製' : '複製失敗，請手動複製');
      });
    });
  },

  // ══════════════════════════════════
  //  iOS 安裝引導（圖文直瀑）
  // ══════════════════════════════════

  _showIosPwaGuide() {
    var existing = document.getElementById('pwa-ios-modal');
    if (existing) existing.parentNode.removeChild(existing);

    var overlay = document.createElement('div');
    overlay.id = 'pwa-ios-modal';
    overlay.className = 'pwa-modal-overlay';

    var isLINE = /Line\//i.test(navigator.userAgent);
    var stepZero = isLINE
      ? '<div class="pwa-guide-step pwa-guide-step-highlight">'
        + '<div class="pwa-guide-num pwa-guide-num-warn">!</div>'
        + '<div class="pwa-guide-text">'
        + '<strong>先用 Safari 開啟本頁</strong><br>'
        + '點右上角「⋯」→「在預設瀏覽器中開啟」'
        + '</div></div>'
        + '<div class="pwa-guide-divider"></div>'
      : '';

    overlay.innerHTML =
      '<div class="pwa-guide-panel">'
      + '<div class="pwa-guide-header">'
      + '<span>iPhone / iPad 安裝教學</span>'
      + '<button class="pwa-modal-close" id="pwa-ios-close">&times;</button>'
      + '</div>'
      + '<div class="pwa-guide-body">'
      + stepZero
      + '<div class="pwa-guide-step">'
      + '<div class="pwa-guide-num">1</div>'
      + '<div class="pwa-guide-text">'
      + '<strong>點擊 Safari 底部的「分享」按鈕</strong><br>'
      + '方框加向上箭頭的圖示'
      + '</div></div>'
      + '<div class="pwa-guide-img-wrap">'
      + '<img class="pwa-guide-img" src="PWA/PWA01.jpg" alt="步驟1">'
      + '</div>'
      + '<div class="pwa-guide-divider"></div>'
      + '<div class="pwa-guide-step">'
      + '<div class="pwa-guide-num">2</div>'
      + '<div class="pwa-guide-text">'
      + '<strong>往下滑，點選「加入主畫面」</strong><br>'
      + '在分享選單列表中找到此選項'
      + '</div></div>'
      + '<div class="pwa-guide-img-wrap">'
      + '<img class="pwa-guide-img" src="PWA/PWA02.jpg" alt="步驟2">'
      + '</div>'
      + '<div class="pwa-guide-divider"></div>'
      + '<div class="pwa-guide-step">'
      + '<div class="pwa-guide-num">3</div>'
      + '<div class="pwa-guide-text">'
      + '<strong>點右上角「加入」完成安裝</strong><br>'
      + 'APP 圖示將出現在你的主畫面'
      + '</div></div>'
      + '<div class="pwa-guide-img-wrap">'
      + '<img class="pwa-guide-img" src="PWA/PWA03.jpg" alt="步驟3">'
      + '</div>'
      + '</div></div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('visible'); });

    document.getElementById('pwa-ios-close').addEventListener('click', function () {
      App._closePwaModal('pwa-ios-modal');
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) App._closePwaModal('pwa-ios-modal');
    });
  },

  // ══════════════════════════════════
  //  共用關閉
  // ══════════════════════════════════

  _closePwaModal(id) {
    var m = document.getElementById(id);
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
