/**
 * inv-scanner.js
 * 條碼掃描模組 — 二維碼/橫式條碼雙模式切換
 */
const InvScanner = {
  _scanner: null,
  _active: false,
  _mode: 'barcode', // 'barcode' | 'qrcode'
  _containerId: null,
  _onScanCb: null,

  _MODES: {
    barcode: {
      label: '橫式條碼',
      qrbox: { width: 280, height: 100 },
      formats: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF,
      ],
      hint: '請靠近條碼，填滿掃描框，避免反光',
    },
    qrcode: {
      label: '二維碼',
      qrbox: { width: 220, height: 220 },
      formats: [Html5QrcodeSupportedFormats.QR_CODE],
      hint: '將 QR Code 對準掃描框',
    },
  },

  async start(containerId, onSuccess, mode) {
    var cfg = this._MODES[mode || this._mode];
    try {
      this._scanner = new Html5Qrcode(containerId);
      await this._scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: cfg.qrbox, formatsToSupport: cfg.formats },
        onSuccess,
        function () {}
      );
      this._active = true;
    } catch (e) {
      console.error('[InvScanner] start failed:', e);
      this._active = false;
      InvApp.showToast('無法啟動相機，請手動輸入條碼');
    }
  },

  stop() {
    if (this._scanner) this._scanner.stop().catch(function () {});
    this._scanner = null;
    this._active = false;
  },

  renderScannerUI(containerId, onScan) {
    var container = document.getElementById(containerId);
    if (!container) return;
    this._containerId = containerId;
    this._onScanCb = onScan;

    var scannerId = containerId + '-qr';
    var cfg = this._MODES[this._mode];
    var isBarcode = this._mode === 'barcode';

    container.innerHTML =
      // 模式切換按鈕
      '<div style="display:flex;justify-content:center;gap:6px;margin-bottom:8px">' +
        '<button class="inv-btn sm ' + (isBarcode ? 'primary' : 'outline') + '" ' +
          'onclick="InvScanner.switchMode(\'barcode\')" style="font-size:12px;min-height:32px;padding:4px 14px">' +
          (typeof InvIcons !== 'undefined' ? InvIcons.barcode(16) + ' ' : '') + '條碼</button>' +
        '<button class="inv-btn sm ' + (!isBarcode ? 'primary' : 'outline') + '" ' +
          'onclick="InvScanner.switchMode(\'qrcode\')" style="font-size:12px;min-height:32px;padding:4px 14px">' +
          (typeof InvIcons !== 'undefined' ? InvIcons.scan(16) + ' ' : '') + 'QR Code</button>' +
      '</div>' +
      // 提示文字
      '<div style="text-align:center;font-size:11px;color:var(--text-muted);margin-bottom:6px">' +
        InvApp.escapeHTML(cfg.hint) + '</div>' +
      // 掃碼區
      '<div id="' + scannerId + '" style="width:100%;max-width:400px;margin:0 auto 12px"></div>' +
      // 手動輸入
      '<div style="display:flex;align-items:center;gap:8px;max-width:400px;margin:0 auto">' +
        '<input id="' + containerId + '-manual" type="text" inputmode="numeric" ' +
          'class="inv-input" placeholder="手動輸入條碼" style="flex:1;height:40px;font-size:14px" />' +
        '<button id="' + containerId + '-confirm" class="inv-btn primary sm" ' +
          'style="flex-shrink:0;min-height:40px">確認</button>' +
      '</div>';

    var self = this;
    var handleBarcode = function (barcode) {
      if (!barcode) return;
      if (navigator.vibrate) navigator.vibrate(100);
      onScan(barcode);
    };

    this.start(scannerId, function (decodedText) {
      self.stop();
      handleBarcode(decodedText);
    }, this._mode);

    var confirmBtn = document.getElementById(containerId + '-confirm');
    var manualInput = document.getElementById(containerId + '-manual');
    if (confirmBtn && manualInput) {
      confirmBtn.addEventListener('click', function () {
        var val = manualInput.value.replace(/\s/g, '');
        if (val) { handleBarcode(val); manualInput.value = ''; }
      });
      manualInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var val = manualInput.value.replace(/\s/g, '');
          if (val) { handleBarcode(val); manualInput.value = ''; }
        }
      });
    }
  },

  switchMode(mode) {
    if (mode === this._mode) return;
    this.stop();
    this._mode = mode;
    if (this._containerId && this._onScanCb) {
      this.renderScannerUI(this._containerId, this._onScanCb);
    }
  },

  destroy() { this.stop(); },
};
