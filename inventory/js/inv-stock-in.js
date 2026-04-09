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

    var _hp = typeof InvAuth !== 'undefined' && InvAuth.hasPerm ? InvAuth.hasPerm.bind(InvAuth) : function() { return true; };
    var csvSectionHtml = '';
    if (_hp('stockin.csv')) {
      csvSectionHtml =
        '<div style="padding:0 16px 16px;border-top:1px solid var(--border);margin-top:8px">' +
          '<div style="font-size:14px;font-weight:600;margin:12px 0 8px">CSV 批次入庫</div>' +
          '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">格式：每行一筆，條碼,數量（如 <code>4710088</code>,<code>10</code>）<br>第一行若為標題行會自動跳過</div>' +
          '<input type="file" id="inv-csv-upload" accept=".csv,.txt" hidden />' +
          '<div style="display:flex;gap:8px">' +
            '<button id="inv-csv-btn" class="inv-btn outline full" style="font-size:14px">選擇 CSV 檔案</button>' +
            '<button id="inv-csv-tpl" class="inv-btn outline" style="font-size:12px;white-space:nowrap;color:var(--text-muted)">下載範本</button>' +
          '</div>' +
          '<div id="inv-csv-result" style="margin-top:8px"></div>' +
        '</div>';
    }
    container.innerHTML =
      '<div id="inv-stockin-scanner" style="margin-bottom:16px;"></div>' +
      '<div id="inv-stockin-form"></div>' +
      '<div id="inv-stockin-batch" style="text-align:center;padding:12px;font-size:14px;color:var(--text-muted);">' +
        this._batchLabel() +
      '</div>' +
      csvSectionHtml;

    var self = this;
    InvScanner._onManualAdd = function () { self.showManualAddForm(); };
    InvScanner.renderScannerUI('inv-stockin-scanner', this.onScan.bind(this));
    var csvBtn = document.getElementById('inv-csv-btn');
    var csvUpload = document.getElementById('inv-csv-upload');
    var csvTpl = document.getElementById('inv-csv-tpl');
    if (csvBtn) csvBtn.addEventListener('click', function() { csvUpload.click(); });
    if (csvUpload) csvUpload.addEventListener('change', function() {
      var file = this.files && this.files[0];
      if (file) self._handleCSVImport(file);
      this.value = '';
    });
    if (csvTpl) csvTpl.addEventListener('click', function() { self._downloadCSVTemplate(); });
  },

  /** 掃碼回呼 */
  async onScan(barcode) {
    InvScanner.stop();
    var _hp = typeof InvAuth !== 'undefined' && InvAuth.hasPerm ? InvAuth.hasPerm.bind(InvAuth) : function() { return true; };
    var matches = InvProducts.getAllByBarcode(barcode);
    if (matches.length > 1) {
      // 共用條碼 → 彈窗選擇補貨對象
      if (!_hp('stockin.restock')) { InvApp.showToast('權限不足'); this._backToScan(); return; }
      var self = this;
      InvProducts.showBarcodeGroupPicker(barcode, matches, function(selected) {
        self.showRestockForm(selected);
      });
    } else if (matches.length === 1) {
      if (!_hp('stockin.restock')) { InvApp.showToast('權限不足'); this._backToScan(); return; }
      this.showRestockForm(matches[0]);
    } else {
      if (!_hp('stockin.create')) { InvApp.showToast('權限不足'); this._backToScan(); return; }
      this.showNewProductForm(barcode);
    }
  },

  /** 手動添加表單（不掃碼，直接填寫條碼 + 商品資訊） */
  showManualAddForm() {
    InvScanner.stop();
    var formArea = document.getElementById('inv-stockin-form');
    if (!formArea) return;
    var esc = InvApp.escapeHTML;
    formArea.innerHTML =
      '<div style="background:var(--bg-card);border-radius:12px;padding:14px;border:1px solid var(--border);box-sizing:border-box">' +
        '<h4 style="margin:0 0 10px;font-size:15px">手動添加商品</h4>' +
        '<label style="font-size:12px;color:var(--text-muted)">產品編號（條碼）<span style="color:var(--danger)">*</span></label>' +
        '<div style="display:flex;gap:6px;margin-bottom:8px">' +
          '<input id="manual-barcode" class="inv-input" placeholder="輸入或自訂編號" style="flex:1;height:40px;font-size:14px" />' +
          '<button id="manual-auto" class="inv-btn outline" style="font-size:12px;white-space:nowrap;height:40px;padding:0 12px;flex-shrink:0">自動產生</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="manual-cancel" class="inv-btn outline full" style="font-size:14px">取消</button>' +
          '<button id="manual-next" class="inv-btn primary full" style="font-size:14px">下一步</button>' +
        '</div>' +
      '</div>';
    var self = this;
    document.getElementById('manual-cancel').addEventListener('click', function () {
      self._backToScan();
    });
    document.getElementById('manual-next').addEventListener('click', function () {
      var barcode = (document.getElementById('manual-barcode').value || '').trim();
      if (!barcode) { InvApp.showToast('請輸入產品編號'); return; }
      var _hp2 = typeof InvAuth !== 'undefined' && InvAuth.hasPerm ? InvAuth.hasPerm.bind(InvAuth) : function() { return true; };
      var existing = InvProducts.getByBarcode(barcode);
      if (existing) {
        if (!_hp2('stockin.restock')) { InvApp.showToast('權限不足'); return; }
        self.showRestockForm(existing);
      } else {
        if (!_hp2('stockin.create')) { InvApp.showToast('權限不足'); return; }
        self.showNewProductForm(barcode);
      }
    });
    document.getElementById('manual-barcode').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('manual-next').click();
    });
    document.getElementById('manual-auto').addEventListener('click', async function () {
      this.disabled = true; this.textContent = '產生中...';
      try {
        var code = await InvUtils.generateBarcode();
        document.getElementById('manual-barcode').value = code;
      } catch (e) {
        InvApp.showToast('產生失敗：' + (e.message || ''));
      }
      this.disabled = false; this.textContent = '自動產生';
    });
    document.getElementById('manual-barcode').focus();
  },

  /** 補貨表單 */
  showRestockForm(product) {
    var formArea = document.getElementById('inv-stockin-form');
    if (!formArea) return;

    var esc = InvApp.escapeHTML;
    formArea.innerHTML =
      '<div style="background:var(--bg-card);border-radius:12px;padding:14px;border:1px solid var(--border);box-sizing:border-box;max-width:100%;overflow:hidden">' +
        '<h4 style="margin:0 0 6px;font-size:15px">' + esc(product.name) + '</h4>' +
        '<div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">目前庫存：' +
          '<span style="font-weight:700;color:var(--text-primary)">' + (product.stock || 0) + '</span> 件</div>' +
        '<label style="font-size:12px;color:var(--text-muted)">入庫數量</label>' +
        '<div style="display:flex;align-items:center;gap:0;margin:6px 0 10px">' +
          '<button data-add="-1" style="width:44px;height:40px;border:1px solid var(--border);border-radius:8px 0 0 8px;background:var(--bg-elevated);font-size:20px;font-weight:700;cursor:pointer;color:var(--text-primary);flex-shrink:0">−</button>' +
          '<input id="restock-qty" type="number" inputmode="numeric" value="1" min="1" ' +
            'class="inv-hide-spin" style="width:60px;height:40px;text-align:center;font-size:18px;font-weight:700;' +
            'border-top:1px solid var(--border);border-bottom:1px solid var(--border);border-left:none;border-right:none;' +
            'padding:0;box-sizing:border-box;background:var(--bg-card);color:var(--text-primary);-moz-appearance:textfield" />' +
          '<button data-add="1" style="width:44px;height:40px;border:1px solid var(--border);border-radius:0 8px 8px 0;background:var(--bg-elevated);font-size:20px;font-weight:700;cursor:pointer;color:var(--text-primary);flex-shrink:0">+</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:12px">' +
          '<button data-add="5" style="flex:1;padding:5px 0;border:1px solid var(--accent);border-radius:var(--radius-full);background:var(--bg-card);color:var(--accent);font-size:12px;font-weight:600;cursor:pointer">+5</button>' +
          '<button data-add="10" style="flex:1;padding:5px 0;border:1px solid var(--accent);border-radius:var(--radius-full);background:var(--bg-card);color:var(--accent);font-size:12px;font-weight:600;cursor:pointer">+10</button>' +
          '<button data-add="20" style="flex:1;padding:5px 0;border:1px solid var(--accent);border-radius:var(--radius-full);background:var(--bg-card);color:var(--accent);font-size:12px;font-weight:600;cursor:pointer">+20</button>' +
          '<button data-add="50" style="flex:1;padding:5px 0;border:1px solid var(--accent);border-radius:var(--radius-full);background:var(--bg-card);color:var(--accent);font-size:12px;font-weight:600;cursor:pointer">+50</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="restock-cancel" style="flex:1;padding:10px;border:1px solid var(--border);border-radius:8px;' +
            'background:var(--bg-card);font-size:14px;cursor:pointer">取消</button>' +
          '<button id="restock-confirm" style="flex:1;padding:10px;border:none;border-radius:8px;' +
            'background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer">確認入庫</button>' +
        '</div>' +
      '</div>';

    var qtyInput = document.getElementById('restock-qty');

    // 快捷加減量按鈕
    var btns = formArea.querySelectorAll('[data-add]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var add = Number(this.getAttribute('data-add'));
        var val = Math.max(1, Number(qtyInput.value || 0) + add);
        qtyInput.value = val;
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
      var configDoc = await InvStore.storeRef().get();
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

    // 讀取歷史輸入值
    var hist = this._getFieldHistory();
    var dlBrand = this._buildDatalist('dl-brand', hist.brand);
    var dlColor = this._buildDatalist('dl-color', hist.color);
    var dlSize = this._buildDatalist('dl-size', hist.size);
    var iS = 'width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box;';

    formArea.innerHTML =
      '<div style="background:var(--bg-card);border-radius:12px;padding:16px;border:1px solid var(--border);">' +
        dlBrand + dlColor + dlSize +
        '<h4 style="margin:0 0 12px;">新增商品</h4>' +
        '<label style="font-size:13px;color:var(--text-muted);">條碼</label>' +
        '<input value="' + InvApp.escapeHTML(barcode) + '" disabled ' +
          'style="' + iS + 'margin-bottom:10px;background:var(--bg-elevated);" />' +
        '<label style="font-size:13px;color:var(--text-muted);">品名 <span style="color:var(--danger);">*</span></label>' +
        '<input id="new-name" style="' + iS + 'margin-bottom:10px;" />' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          '<div><label style="font-size:13px;color:var(--text-muted);">進貨價' + (InvAuth.canSeeCost() ? ' <span style="color:var(--danger);">*</span>' : '') + '</label>' +
          '<input id="new-cost" type="' + (InvAuth.canSeeCost() ? 'number' : 'text') + '"' + (InvAuth.canSeeCost() ? ' inputmode="numeric"' : ' value="***" disabled') + ' style="' + iS + '" /></div>' +
          '<div><label style="font-size:13px;color:var(--text-muted);">售價 <span style="color:var(--danger);">*</span></label>' +
          '<input id="new-price" type="number" inputmode="numeric" style="' + iS + '" /></div>' +
        '</div>' +
        '<label style="font-size:13px;color:var(--text-muted);margin-top:10px;display:block;">數量 <span style="color:var(--danger);">*</span></label>' +
        '<input id="new-qty" type="number" inputmode="numeric" value="1" min="1" style="' + iS + 'margin-bottom:10px;" />' +
        '<label style="font-size:13px;color:var(--text-muted);">品牌</label>' +
        '<input id="new-brand" list="dl-brand" style="' + iS + 'margin-bottom:10px;" />' +
        '<label style="font-size:13px;color:var(--text-muted);">分類</label>' +
        '<select id="new-category" style="' + iS + 'margin-bottom:10px;">' +
          catOptions + '</select>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">' +
          '<div><label style="font-size:13px;color:var(--text-muted);">顏色</label>' +
          '<input id="new-color" list="dl-color" style="' + iS + '" /></div>' +
          '<div><label style="font-size:13px;color:var(--text-muted);">尺寸</label>' +
          '<input id="new-size" list="dl-size" style="' + iS + '" /></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button id="new-cancel" style="flex:1;padding:12px;border:1px solid var(--border);border-radius:8px;' +
            'background:var(--bg-card);font-size:15px;cursor:pointer;">取消</button>' +
          '<button id="new-save" style="flex:1;padding:12px;border:none;border-radius:8px;' +
            'background:var(--accent);color:#fff;font-size:15px;font-weight:600;cursor:pointer;">建檔入庫</button>' +
        '</div>' +
      '</div>';

    var self = this;
    document.getElementById('new-cancel').addEventListener('click', function () {
      self._backToScan();
    });
    document.getElementById('new-save').addEventListener('click', function () {
      var name = document.getElementById('new-name').value.trim();
      var costPrice = InvAuth.canSeeCost() ? Number(document.getElementById('new-cost').value) : 0;
      var price = Number(document.getElementById('new-price').value);
      var qty = parseInt(document.getElementById('new-qty').value, 10);

      if (!name) { InvApp.showToast('請輸入品名'); return; }
      if (InvAuth.canSeeCost() && !costPrice && costPrice !== 0) { InvApp.showToast('請輸入進貨價'); return; }
      if (!price) { InvApp.showToast('請輸入售價'); return; }
      if (!qty || qty < 1) { InvApp.showToast('請輸入有效數量'); return; }

      var brand = document.getElementById('new-brand').value.trim();
      var color = document.getElementById('new-color').value.trim();
      var size = document.getElementById('new-size').value.trim();
      // 記憶輸入值
      self._saveFieldHistory({ brand: brand, color: color, size: size });
      self.handleNewProduct({
        barcode: barcode,
        name: name,
        costPrice: costPrice,
        price: price,
        stock: qty,
        brand: brand,
        category: document.getElementById('new-category').value,
        color: color,
        size: size,
        lowStockAlert: 5,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        uid: InvAuth.getUid() || ''
      });
    });
  },

  /** 處理補貨 */
  async handleRestock(barcode, quantity) {
    try {
      var product = InvProducts.getByBarcode(barcode);
      var pName = product ? product.name : barcode;
      var result = await InvProducts.adjustStock(barcode, quantity, {
        type: 'in',
        productName: pName,
        note: '掃碼入庫',
        uid: InvAuth.getUid() || ''
      });
      InvUtils.writeLog('stock_in', pName + ' +' + quantity + ' 庫存' + result.afterStock);
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
      var batch = db.batch();
      var productRef = InvStore.col('products').doc(formData.barcode);
      var txRef = InvStore.col('transactions').doc();
      batch.set(productRef, formData);
      batch.set(txRef, {
        barcode: formData.barcode,
        productName: formData.name || '',
        type: 'in',
        delta: formData.stock,
        beforeStock: 0,
        afterStock: formData.stock,
        note: '新品建檔入庫',
        uid: InvAuth.getUid() || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await batch.commit();
      InvProducts._cache.push(Object.assign({ id: formData.barcode }, formData));
      InvUtils.writeLog('product_create', formData.name + ' (' + formData.barcode + ') x' + formData.stock);

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
  },

  // ══════ 欄位歷史記憶 ══════

  _HISTORY_KEY: 'inv_field_history',
  _HISTORY_MAX: 30,

  /** 讀取所有欄位的歷史值 */
  _getFieldHistory() {
    try {
      var raw = localStorage.getItem(this._HISTORY_KEY);
      return raw ? JSON.parse(raw) : { brand: [], color: [], size: [] };
    } catch (_) { return { brand: [], color: [], size: [] }; }
  },

  /** 儲存新的欄位值到歷史（去重、限制數量） */
  _saveFieldHistory(values) {
    var hist = this._getFieldHistory();
    var fields = ['brand', 'color', 'size'];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i], v = (values[f] || '').trim();
      if (!v) continue;
      var arr = hist[f] || [];
      var idx = arr.indexOf(v);
      if (idx !== -1) arr.splice(idx, 1); // 移到最前
      arr.unshift(v);
      if (arr.length > this._HISTORY_MAX) arr.length = this._HISTORY_MAX;
      hist[f] = arr;
    }
    try { localStorage.setItem(this._HISTORY_KEY, JSON.stringify(hist)); } catch (_) {}
  },

  /** 產生 datalist HTML */
  _buildDatalist(id, values) {
    if (!values || !values.length) return '<datalist id="' + id + '"></datalist>';
    var html = '<datalist id="' + id + '">';
    for (var i = 0; i < values.length; i++) {
      html += '<option value="' + InvApp.escapeHTML(values[i]) + '">';
    }
    return html + '</datalist>';
  },

  // ══════ CSV 批次入庫 ══════

  /** 下載 CSV 範本 */
  _downloadCSVTemplate() {
    var csv = '\uFEFF' + '條碼,數量\n4710088001234,10\nABC-001,5\n';
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = '入庫範本.csv'; a.click();
    URL.revokeObjectURL(url);
  },

  /** 解析 CSV 並執行批次入庫 */
  async _handleCSVImport(file) {
    var resultEl = document.getElementById('inv-csv-result');
    if (!resultEl) return;
    resultEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px">解析中...</div>';

    var text;
    try { text = await file.text(); } catch (e) {
      resultEl.innerHTML = '<div style="color:var(--danger)">無法讀取檔案</div>';
      return;
    }

    var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(function(l) { return l.trim(); });
    if (!lines.length) { resultEl.innerHTML = '<div style="color:var(--danger)">檔案內容為空</div>'; return; }

    // 跳過標題行
    var first = lines[0].toLowerCase();
    if (first.indexOf('條碼') !== -1 || first.indexOf('barcode') !== -1 || first.indexOf('數量') !== -1) {
      lines.shift();
    }

    var items = [], errors = [];
    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split(',');
      var barcode = (parts[0] || '').trim();
      var qty = parseInt((parts[1] || '').trim(), 10);
      if (!barcode) { errors.push('第 ' + (i + 1) + ' 行：缺少條碼'); continue; }
      if (!qty || qty < 1) { errors.push('第 ' + (i + 1) + ' 行：數量無效 (' + InvApp.escapeHTML(parts[1] || '') + ')'); continue; }
      items.push({ barcode: barcode, quantity: qty });
    }

    if (!items.length) {
      resultEl.innerHTML = '<div style="color:var(--danger)">無有效資料</div>' +
        (errors.length ? '<div style="font-size:12px;color:var(--danger);margin-top:4px">' + errors.join('<br>') + '</div>' : '');
      return;
    }

    // 預覽確認
    var esc = InvApp.escapeHTML;
    var previewHtml = '<div style="font-size:13px;margin-bottom:8px">即將匯入 <b>' + items.length + '</b> 筆：</div>' +
      '<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px">';
    for (var j = 0; j < items.length; j++) {
      var it = items[j], prod = InvProducts.getByBarcode(it.barcode);
      var statusHtml = prod
        ? '<span style="color:var(--accent)">' + esc(prod.name) + ' (庫存 ' + (prod.stock || 0) + ' → ' + ((prod.stock || 0) + it.quantity) + ')</span>'
        : '<span style="color:var(--warning)">新條碼（需先建檔）</span>';
      previewHtml += '<div style="padding:3px 0;border-bottom:1px solid var(--border)">' + esc(it.barcode) + ' × ' + it.quantity + ' — ' + statusHtml + '</div>';
    }
    previewHtml += '</div>';
    if (errors.length) {
      previewHtml += '<div style="font-size:12px;color:var(--danger);margin-bottom:8px">跳過 ' + errors.length + ' 筆錯誤行</div>';
    }
    previewHtml += '<div style="display:flex;gap:8px">' +
      '<button id="inv-csv-cancel" class="inv-btn outline full">取消</button>' +
      '<button id="inv-csv-confirm" class="inv-btn primary full">確認入庫</button></div>';
    resultEl.innerHTML = previewHtml;

    var self = this;
    document.getElementById('inv-csv-cancel').addEventListener('click', function() { resultEl.innerHTML = ''; });
    document.getElementById('inv-csv-confirm').addEventListener('click', async function() {
      this.disabled = true; this.textContent = '處理中...';
      await self._executeCSVImport(items, resultEl);
    });
  },

  /** 執行 CSV 批次入庫 */
  async _executeCSVImport(items, resultEl) {
    var success = 0, failed = 0, skipped = 0, logs = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var prod = InvProducts.getByBarcode(it.barcode);
      if (!prod) { skipped++; logs.push(it.barcode + ': 跳過（商品不存在）'); continue; }
      try {
        var result = await InvProducts.adjustStock(it.barcode, it.quantity, {
          type: 'in', note: 'CSV 批次入庫', uid: InvAuth.getUid() || '',
          operatorName: InvAuth.getName() || '',
        });
        success++;
        this._batchCount++;
        this._batchItems += it.quantity;
        logs.push(InvApp.escapeHTML(prod.name) + ': +' + it.quantity + ' (庫存 ' + result.afterStock + ')');
      } catch (e) {
        failed++;
        logs.push(InvApp.escapeHTML(it.barcode) + ': 失敗 — ' + InvApp.escapeHTML(e.message || ''));
      }
    }
    this._updateBatchLabel();
    var color = failed ? 'var(--warning)' : 'var(--success)';
    resultEl.innerHTML =
      '<div style="padding:10px;border-radius:8px;border:1px solid ' + color + ';background:var(--bg-elevated);font-size:13px">' +
        '<div style="font-weight:600;margin-bottom:6px;color:' + color + '">匯入完成：成功 ' + success + ' / 失敗 ' + failed + ' / 跳過 ' + skipped + '</div>' +
        '<div style="max-height:150px;overflow-y:auto;font-size:12px;color:var(--text-secondary)">' + logs.join('<br>') + '</div>' +
      '</div>';
  },
};
