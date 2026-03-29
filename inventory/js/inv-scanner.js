/**
 * inv-scanner.js
 * 條碼掃描模組（Html5Qrcode + 手動輸入降級）
 */
const InvScanner = {
  _scanner: null,
  _active: false,

  /**
   * 啟動相機掃碼
   * @param {string} containerId - 掃碼區域容器 ID
   * @param {function} onSuccess - 掃碼成功回呼 (decodedText) => void
   */
  async start(containerId, onSuccess) {
    try {
      this._scanner = new Html5Qrcode(containerId);
      await this._scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 280, height: 150 },
          formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
        },
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

  /**
   * 停止掃碼
   */
  stop() {
    if (this._scanner) {
      this._scanner.stop().catch(function () {});
    }
    this._scanner = null;
    this._active = false;
  },

  /**
   * 渲染掃碼 UI（掃碼區域 + 手動輸入欄）
   * @param {string} containerId - 外層容器 ID
   * @param {function} onScan - 取得條碼後的回呼 (barcode) => void
   */
  renderScannerUI(containerId, onScan) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var scannerId = containerId + '-qr';

    container.innerHTML =
      '<div id="' + scannerId + '" style="width:100%;max-width:400px;margin:0 auto 16px;"></div>' +
      '<div style="display:flex;align-items:center;gap:8px;max-width:400px;margin:0 auto;">' +
        '<input id="' + containerId + '-manual" type="text" inputmode="numeric" ' +
          'placeholder="手動輸入條碼" ' +
          'style="flex:1;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:16px;" />' +
        '<button id="' + containerId + '-confirm" ' +
          'style="padding:10px 16px;border:none;border-radius:8px;background:#4CAF50;color:#fff;font-size:16px;cursor:pointer;">' +
          '確認</button>' +
      '</div>';

    var self = this;

    // 掃碼成功處理
    var handleBarcode = function (barcode) {
      if (!barcode) return;
      // 震動回饋
      if (navigator.vibrate) {
        navigator.vibrate(100);
      }
      onScan(barcode);
    };

    // 啟動相機掃碼
    this.start(scannerId, function (decodedText) {
      self.stop();
      handleBarcode(decodedText);
    });

    // 手動輸入確認
    var confirmBtn = document.getElementById(containerId + '-confirm');
    var manualInput = document.getElementById(containerId + '-manual');

    if (confirmBtn && manualInput) {
      confirmBtn.addEventListener('click', function () {
        var val = manualInput.value.replace(/\s/g, '');
        if (val) {
          handleBarcode(val);
          manualInput.value = '';
        }
      });

      manualInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var val = manualInput.value.replace(/\s/g, '');
          if (val) {
            handleBarcode(val);
            manualInput.value = '';
          }
        }
      });
    }
  },

  /**
   * 清理掃碼器資源
   */
  destroy() {
    this.stop();
  },
};
