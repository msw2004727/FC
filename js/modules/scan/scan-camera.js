/* ================================================
   SportHub — Scan: Camera & QR scanning
   Split from scan.js — camera init, QR scanning,
   device selection, manual UID input
   innerHTML usage with escapeHTML() is safe and
   expected in this project.
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Camera scanning
  // ══════════════════════════════════

  async _toggleCamera() {
    if (!this._scanSelectedEventId) {
      this.showToast('請先選擇活動');
      return;
    }

    // If scanner is running, stop it
    if (this._scannerInstance) {
      this._stopCamera();
      return;
    }

    // Check if mobile
    const isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);
    if (!isMobile) {
      this.showToast('相機掃碼僅支援行動裝置');
      return;
    }

    // 啟動前診斷：先確認執行環境，避免所有錯誤都落入通用提示。
    const scanDiag = {
      protocol: location.protocol,
      host: location.host,
      isSecureContext: !!window.isSecureContext,
      hasMediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      hasPermissionsApi: !!(navigator.permissions && navigator.permissions.query),
      permissionState: 'unknown',
      isLineInApp: /Line\//i.test(navigator.userAgent),
      isAndroid: /Android/i.test(navigator.userAgent),
      isIOS: /iPhone|iPad|iPod/i.test(navigator.userAgent),
      videoInputCount: null,
      videoInputLabels: [],
      inIframe: false,
    };
    try { scanDiag.inIframe = window.self !== window.top; } catch (_) { scanDiag.inIframe = true; }

    if (!scanDiag.isSecureContext) {
      console.warn('[Scan] Preflight failed: insecure context', scanDiag);
      this.showToast('相機需在 HTTPS 安全連線下使用');
      const readerEl = document.getElementById('scan-qr-reader');
      if (readerEl) {
        readerEl.innerHTML = '<span style="color:var(--danger);font-size:.82rem;">相機需在 HTTPS 安全連線下使用</span>';
      }
      const manualSection = document.getElementById('scan-manual-section');
      if (manualSection) manualSection.style.display = '';
      return;
    }

    if (!scanDiag.hasMediaDevices) {
      console.warn('[Scan] Preflight failed: mediaDevices unavailable', scanDiag);
      this.showToast('此瀏覽器環境不支援相機存取');
      const readerEl = document.getElementById('scan-qr-reader');
      if (readerEl) {
        readerEl.innerHTML = '<span style="color:var(--danger);font-size:.82rem;">此瀏覽器環境不支援相機存取</span>';
      }
      const manualSection = document.getElementById('scan-manual-section');
      if (manualSection) manualSection.style.display = '';
      return;
    }

    if (scanDiag.hasPermissionsApi) {
      try {
        const p = await navigator.permissions.query({ name: 'camera' });
        if (p && p.state) scanDiag.permissionState = p.state;
      } catch (e) {
        scanDiag.permissionState = 'unsupported';
        console.warn('[Scan] permissions.query(camera) unavailable:', e);
      }
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(d => d.kind === 'videoinput');
      scanDiag.videoInputCount = videoInputs.length;
      scanDiag.videoInputLabels = videoInputs.map(d => d.label || '(hidden until permission granted)');
    } catch (e) {
      scanDiag.videoInputCount = -1;
      console.warn('[Scan] enumerateDevices failed:', e);
    }
    console.log('[Scan] Preflight diagnostics:', scanDiag);

    // 動態載入 QR 掃碼庫（延遲載入，不阻塞啟動）
    if (typeof Html5Qrcode === 'undefined') {
      try {
        this.showToast('載入掃碼元件...');
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      } catch (e) {
        this.showToast('QR 掃碼元件載入失敗');
        return;
      }
    }

    const readerId = 'scan-qr-reader';
    const readerEl = document.getElementById(readerId);
    readerEl.innerHTML = '';

    const scanner = new Html5Qrcode(readerId);
    this._scannerInstance = scanner;
    document.getElementById('scan-camera-btn').textContent = '關閉相機';

    const scanConfig = {
      fps: 15,
      qrbox: { width: 200, height: 200 },
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    };

    const successCb = (decodedText) => {
      // 3-second dedup
      const now = Date.now();
      if (decodedText === this._lastScannedUid && now - this._lastScanTime < 3000) return;
      this._lastScannedUid = decodedText;
      this._lastScanTime = now;
      this._processAttendance(decodedText.trim(), this._scanMode);
    };

    scanner.start(
      { facingMode: { exact: 'environment' } },
      scanConfig,
      successCb,
      () => {} // ignore scan error frames
    ).then(() => {
      // 成功啟動後輸出實際 track 設定，協助判斷是否誤開前鏡頭。
      try {
        const settings = (typeof scanner.getRunningTrackSettings === 'function')
          ? scanner.getRunningTrackSettings()
          : null;
        console.log('[Scan] Camera started. Track settings:', settings);
      } catch (e) {
        console.warn('[Scan] Unable to read track settings:', e);
      }
    }).catch(async (err) => {
      // html5-qrcode 庫 reject 的是純字串（非 Error 物件），用 String() 統一處理
      const errName = (err && err.name) ? String(err.name) : '';
      const errMsgRaw = (err && err.message) ? String(err.message) : '';
      const errStr = `${errName} ${errMsgRaw} ${String(err)}`.toLowerCase();

      // exact facingMode 失敗 → 降級為軟約束重試（單鏡頭/前鏡頭裝置）
      if (errStr.includes('overconstrained') || errStr.includes('constraint')) {
        console.warn('[Scan] exact:environment failed, retrying with soft facingMode:', err);
        try {
          try { await scanner.stop(); } catch (_) {}
          scanner.clear();
          const scanner2 = new Html5Qrcode(readerId);
          this._scannerInstance = scanner2;
          await scanner2.start(
            { facingMode: 'environment' },
            scanConfig,
            successCb,
            () => {}
          );
          console.log('[Scan] Soft facingMode retry succeeded.');
          return; // 重試成功，不進入錯誤顯示
        } catch (retryErr) {
          console.warn('[Scan] Soft facingMode retry also failed:', retryErr);
          this._scannerInstance = null;
        }
      } else {
        this._scannerInstance = null;
      }

      console.warn('[Scan] Camera error:', err);
      console.warn('[Scan] Camera error diagnostics:', {
        errName,
        errMsgRaw,
        errString: String(err),
        preflight: scanDiag,
      });
      let errMsg;
      if (!scanDiag.isSecureContext || errStr.includes('secure context') || errStr.includes('secure origin') || errStr.includes('https')) {
        errMsg = '相機需在 HTTPS 安全連線下使用';
      } else if (errStr.includes('notallowed') || errStr.includes('permission') || errStr.includes('denied') || scanDiag.permissionState === 'denied') {
        errMsg = '相機權限被拒絕，請在瀏覽器設定中允許相機存取';
      } else if (errStr.includes('notfound') || errStr.includes('device') || errStr.includes('nosource')) {
        errMsg = '找不到相機裝置，請確認此設備有相機';
      } else if (errStr.includes('overconstrained') || errStr.includes('constraint')) {
        errMsg = '相機不支援所需規格，請嘗試其他裝置';
      } else if (errStr.includes('notreadable') || errStr.includes('could not start')) {
        errMsg = '相機被其他應用程式佔用，請關閉後再試';
      } else if (errStr.includes('not supported') || errStr.includes('streaming')) {
        errMsg = '此瀏覽器不支援相機掃碼，請改用 Chrome 或 Safari';
      } else if (scanDiag.isLineInApp && scanDiag.isAndroid) {
        errMsg = 'LINE 內建瀏覽器相機受限，請改用手機 Chrome 開啟';
      } else {
        errMsg = '無法開啟相機，請確認權限或改用手動輸入';
      }
      this.showToast(errMsg);
      document.getElementById('scan-camera-btn').textContent = '開啟相機掃碼';
      const diagText = [
        `perm=${scanDiag.permissionState}`,
        `secure=${scanDiag.isSecureContext ? 'yes' : 'no'}`,
        `cams=${scanDiag.videoInputCount == null ? '?' : scanDiag.videoInputCount}`,
        scanDiag.isLineInApp ? 'line-inapp' : 'browser',
      ].join(' | ');
      readerEl.innerHTML = `<span style="color:var(--danger);font-size:.82rem;">${errMsg}</span><div style="margin-top:.35rem;color:var(--text-muted);font-size:.72rem;">診斷：${escapeHTML(diagText)}</div>`;
      // 顯示手動輸入備援
      const manualSection = document.getElementById('scan-manual-section');
      if (manualSection) manualSection.style.display = '';
    });
  },

  /** 手動輸入 UID 後觸發簽到/簽退（相機失敗備援） */
  _processManualUid() {
    const input = document.getElementById('scan-manual-uid');
    if (!input) return;
    const uid = (input.value || '').trim();
    if (!uid) { this.showToast('請輸入 UID'); return; }
    if (!this._scanSelectedEventId) { this.showToast('請先選擇活動'); return; }
    input.value = '';
    this._processAttendance(uid, this._scanMode);
  },

  _stopCamera() {
    if (this._scannerInstance) {
      this._scannerInstance.stop().then(() => {
        this._scannerInstance.clear();
        this._scannerInstance = null;
      }).catch(() => {
        this._scannerInstance = null;
      });
    }
    const btn = document.getElementById('scan-camera-btn');
    if (btn) btn.textContent = '開啟相機掃碼';
    const readerEl = document.getElementById('scan-qr-reader');
    if (readerEl) readerEl.innerHTML = '<span style="color:var(--text-muted);font-size:.85rem;">點擊下方按鈕開啟相機</span>';
  },

});
