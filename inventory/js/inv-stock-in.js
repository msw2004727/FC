/**
 * inv-stock-in.js
 * 入庫模組 — 掃碼入庫、補貨、新品建檔
 */
const InvStockIn = {
  _batchCount: 0,
  _batchItems: 0,

  /** 渲染入庫頁面 */
  render() {
    var container = document.getElementById('inv-stockin-content');
    if (!container) return;

    container.innerHTML =
      '<div id="inv-stockin-scanner" style="margin-bottom:16px;"></div>' +
      '<div id="inv-stockin-form"></div>' +
      '<div id="inv-stockin-batch" style="text-align:center;padding:12px;font-size:14px;color:#666;">' +
        this._batchLabel() +
      '</div>';

    InvScanner.renderScannerUI('inv-stockin-scanner', this.onScan.bind(this));
  },

  /** 掃碼回呼 */
  async onScan(barcode) {
    InvScanner.stop();
    var product = InvProducts.getByBarcode(barcode);
    if (product) {
      this.showRestockForm(product);
    } else {
      this.showNewProductForm(barcode);
    }
  },

  /** 補貨表單 */
  showRestockForm(product) {
    var formArea = document.getElementById('inv-stockin-form');
    if (!formArea) return;

    var esc = InvApp.escapeHTML;
    formArea.innerHTML =
      '<div style="background:#fff;border-radius:12px;padding:16px;border:1px solid #eee;">' +
        '<h4 style="margin:0 0 8px;">' + esc(product.name) + '</h4>' +
        '<div style="font-size:14px;color:#666;margin-bottom:12px;">目前庫存：' +
          '<span style="font-weight:700;color:#333;">' + (product.stock || 0) + '</span> 件</div>' +
        '<label style="font-size:13px;color:#666;">入庫數量</label>' +
        '<input id="restock-qty" type="number" inputmode="numeric" value="1" min="1" ' +
          'style="width:100%;padding:12px;font-size:24px;font-weight:700;text-align:center;' +
          'border:1px solid #ccc;border-radius:8px;margin:8px 0;box-sizing:border-box;" />' +
        '<div class="inv-qty-btns" style="display:flex;gap:8px;margin-bottom:16px;">' +
          '<button data-add="1" style="flex:1;padding:10px;border:1px solid #4CAF50;border-radius:8px;' +
            'background:#fff;color:#4CAF50;font-size:16px;font-weight:600;cursor:pointer;">+1</button>' +
          '<button data-add="5" style="flex:1;padding:10px;border:1px solid #4CAF50;border-radius:8px;' +
            'background:#fff;color:#4CAF50;font-size:16px;font-weight:600;cursor:pointer;">+5</button>' +
          '<button data-add="10" style="flex:1;padding:10px;border:1px solid #4CAF50;border-radius:8px;' +
            'background:#fff;color:#4CAF50;font-size:16px;font-weight:600;cursor:pointer;">+10</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button id="restock-cancel" style="flex:1;padding:12px;border:1px solid #ccc;border-radius:8px;' +
            'background:#fff;font-size:15px;cursor:pointer;">取消</button>' +
          '<button id="restock-confirm" style="flex:1;padding:12px;border:none;border-radius:8px;' +
            'background:#4CAF50;color:#fff;font-size:15px;font-weight:600;cursor:pointer;">確認入庫</button>' +
        '</div>' +
      '</div>';

    var qtyInput = document.getElementById('restock-qty');

    // 快捷加量按鈕
    var btns = formArea.querySelectorAll('[data-add]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var add = Number(this.getAttribute('data-add'));
        qtyInput.value = Number(qtyInput.value || 0) + add;
      });
    }

    var self = this;
    document.getElementById('restock-cancel').addEventListener('click', function () {
      self._backToScan();
    });
    document.getElementById('restock-confirm').addEventListener('click', function () {
      var qty = parseInt(qtyInput.value, 10);
      if (!qty || qty < 1) { InvApp.showToast('請輸入有效數量'); return; }
      self.handleRestock(product.barcode, qty);
    });
  },

  /** 新增商品表單 */
  async showNewProductForm(barcode) {
    var formArea = document.getElementById('inv-stockin-form');
    if (!formArea) return;

    // 讀取分類選項
    var categories = [];
    try {
      var configDoc = await db.collection('inv_settings').doc('config').get();
      if (configDoc.exists && configDoc.data().categories) {
        categories = configDoc.data().categories;
      }
    } catch (e) {
      console.warn('[InvStockIn] load categories failed:', e);
    }

    var catOptions = '<option value="">-- 選擇分類 --</option>';
    for (var i = 0; i < categories.length; i++) {
      catOptions += '<option value="' + InvApp.escapeHTML(categories[i]) + '">' +
        InvApp.escapeHTML(categories[i]) + '</option>';
    }

    formArea.innerHTML =
      '<div style="background:#fff;border-radius:12px;padding:16px;border:1px solid #eee;">' +
        '<h4 style="margin:0 0 12px;">新增商品</h4>' +
        '<label style="font-size:13px;color:#666;">條碼</label>' +
        '<input value="' + InvApp.escapeHTML(barcode) + '" disabled ' +
          'style="width:100%;padding:8px;margin-bottom:10px;border:1px solid #eee;border-radius:6px;' +
          'background:#f5f5f5;box-sizing:border-box;" />' +
        '<label style="font-size:13px;color:#666;">品名 <span style="color:#f44336;">*</span></label>' +
        '<input id="new-name" style="width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;" />' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          '<div><label style="font-size:13px;color:#666;">進貨價 <span style="color:#f44336;">*</span></label>' +
          '<input id="new-cost" type="number" inputmode="numeric" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;" /></div>' +
          '<div><label style="font-size:13px;color:#666;">售價 <span style="color:#f44336;">*</span></label>' +
          '<input id="new-price" type="number" inputmode="numeric" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;" /></div>' +
        '</div>' +
        '<label style="font-size:13px;color:#666;margin-top:10px;display:block;">數量 <span style="color:#f44336;">*</span></label>' +
        '<input id="new-qty" type="number" inputmode="numeric" value="1" min="1" ' +
          'style="width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;" />' +
        '<label style="font-size:13px;color:#666;">品牌</label>' +
        '<input id="new-brand" style="width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;" />' +
        '<label style="font-size:13px;color:#666;">分類</label>' +
        '<select id="new-category" style="width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;">' +
          catOptions + '</select>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">' +
          '<div><label style="font-size:13px;color:#666;">顏色</label>' +
          '<input id="new-color" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;" /></div>' +
          '<div><label style="font-size:13px;color:#666;">尺寸</label>' +
          '<input id="new-size" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;" /></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button id="new-cancel" style="flex:1;padding:12px;border:1px solid #ccc;border-radius:8px;' +
            'background:#fff;font-size:15px;cursor:pointer;">取消</button>' +
          '<button id="new-save" style="flex:1;padding:12px;border:none;border-radius:8px;' +
            'background:#4CAF50;color:#fff;font-size:15px;font-weight:600;cursor:pointer;">建檔入庫</button>' +
        '</div>' +
      '</div>';

    var self = this;
    document.getElementById('new-cancel').addEventListener('click', function () {
      self._backToScan();
    });
    document.getElementById('new-save').addEventListener('click', function () {
      var name = document.getElementById('new-name').value.trim();
      var costPrice = Number(document.getElementById('new-cost').value);
      var price = Number(document.getElementById('new-price').value);
      var qty = parseInt(document.getElementById('new-qty').value, 10);

      if (!name) { InvApp.showToast('請輸入品名'); return; }
      if (!costPrice && costPrice !== 0) { InvApp.showToast('請輸入進貨價'); return; }
      if (!price) { InvApp.showToast('請輸入售價'); return; }
      if (!qty || qty < 1) { InvApp.showToast('請輸入有效數量'); return; }

      self.handleNewProduct({
        barcode: barcode,
        name: name,
        costPrice: costPrice,
        price: price,
        stock: qty,
        brand: document.getElementById('new-brand').value.trim(),
        category: document.getElementById('new-category').value,
        color: document.getElementById('new-color').value.trim(),
        size: document.getElementById('new-size').value.trim(),
        lowStockAlert: 5,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        uid: InvAuth.getUid() || ''
      });
    });
  },

  /** 處理補貨 */
  async handleRestock(barcode, quantity) {
    try {
      var result = await InvProducts.adjustStock(barcode, quantity, {
        type: 'in',
        note: '掃碼入庫',
        uid: InvAuth.getUid() || ''
      });
      var product = InvProducts.getByBarcode(barcode);
      var pName = product ? product.name : barcode;
      this._batchCount++;
      this._batchItems += quantity;
      this._showSuccessOverlay(pName, quantity, result.afterStock);
    } catch (e) {
      console.error('[InvStockIn] handleRestock failed:', e);
      InvApp.showToast('入庫失敗：' + (e.message || '未知錯誤'));
      this._backToScan();
    }
  },

  /** 處理新商品建檔 */
  async handleNewProduct(formData) {
    try {
      await InvProducts.create(formData);

      // 寫入入庫 transaction
      await db.collection('inv_transactions').add({
        barcode: formData.barcode,
        type: 'in',
        delta: formData.stock,
        beforeStock: 0,
        afterStock: formData.stock,
        note: '新品建檔入庫',
        uid: InvAuth.getUid() || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      this._batchCount++;
      this._batchItems += formData.stock;
      this._showSuccessOverlay(formData.name, formData.stock, formData.stock);
    } catch (e) {
      console.error('[InvStockIn] handleNewProduct failed:', e);
      InvApp.showToast('建檔失敗：' + (e.message || '未知錯誤'));
      this._backToScan();
    }
  },

  /**
   * 全螢幕成功 overlay
   */
  _showSuccessOverlay(productName, quantity, currentStock) {
    var existing = document.getElementById('inv-success-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'inv-success-overlay';
    overlay.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:6000;display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;' +
      'background:rgba(76,175,80,.92);color:#fff;text-align:center;';

    overlay.innerHTML =
      '<div style="font-size:56px;margin-bottom:12px;">\u2713</div>' +
      '<div style="font-size:22px;font-weight:700;margin-bottom:8px;">\u5165\u5eab\u6210\u529f</div>' +
      '<div style="font-size:18px;margin-bottom:6px;">' + InvApp.escapeHTML(productName) + '</div>' +
      '<div style="font-size:16px;">+' + quantity + ' \u4ef6 \u2192 \u76ee\u524d\u5eab\u5b58 ' + currentStock + '</div>';

    document.body.appendChild(overlay);

    var self = this;
    setTimeout(function () {
      overlay.remove();
      self._backToScan();
    }, 1500);
  },

  /** 回到掃碼等待 */
  _backToScan() {
    var formArea = document.getElementById('inv-stockin-form');
    if (formArea) formArea.innerHTML = '';
    this._updateBatchLabel();
    InvScanner.renderScannerUI('inv-stockin-scanner', this.onScan.bind(this));
  },

  /** 批次統計文字 */
  _batchLabel() {
    return '\u672c\u6b21\u5df2\u5165\u5eab ' + this._batchCount + ' \u54c1\u9805 / ' + this._batchItems + ' \u4ef6';
  },

  /** 更新批次統計顯示 */
  _updateBatchLabel() {
    var el = document.getElementById('inv-stockin-batch');
    if (el) el.textContent = this._batchLabel();
  },

  /** 重置批次統計 */
  resetBatch() {
    this._batchCount = 0;
    this._batchItems = 0;
    this._updateBatchLabel();
  }
};
