/**
 * inv-products.js
 * 商品 CRUD 模組 — 快取、搜尋、庫存異動、渲染
 */
const InvProducts = {
  _cache: [],
  _loaded: false,

  /** 從 Firestore 載入所有商品到 _cache */
  async loadAll() {
    try {
      const snap = await db.collection('inv_products').get();
      this._cache = snap.docs.map(function (doc) {
        return Object.assign({ id: doc.id }, doc.data());
      });
      this._loaded = true;
      return this._cache;
    } catch (e) {
      console.error('[InvProducts] loadAll failed:', e);
      InvApp.showToast('商品載入失敗');
      return [];
    }
  },

  /** 從快取中以 barcode 查詢 */
  getByBarcode(barcode) {
    return this._cache.find(function (p) { return p.barcode === barcode; }) || null;
  },

  /** 從快取中以 id 查詢 */
  getById(id) {
    return this._cache.find(function (p) { return p.id === id; }) || null;
  },

  /** 新增商品（以 barcode 作為 doc ID） */
  async create(data) {
    try {
      await db.collection('inv_products').doc(data.barcode).set(data);
      this._cache.push(Object.assign({ id: data.barcode }, data));
      return data;
    } catch (e) {
      console.error('[InvProducts] create failed:', e);
      InvApp.showToast('商品建立失敗');
      throw e;
    }
  },

  /** 更新商品欄位 */
  async update(barcode, updates) {
    try {
      updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('inv_products').doc(barcode).update(updates);
      var idx = this._cache.findIndex(function (p) { return p.barcode === barcode; });
      if (idx !== -1) {
        Object.assign(this._cache[idx], updates);
      }
    } catch (e) {
      console.error('[InvProducts] update failed:', e);
      InvApp.showToast('商品更新失敗');
      throw e;
    }
  },

  /** 庫存異動（Transaction），delta 正數入庫、負數出庫 */
  async adjustStock(barcode, delta, txData) {
    var ref = db.collection('inv_products').doc(barcode);
    var txRef = db.collection('inv_transactions');
    var result = await db.runTransaction(async function (transaction) {
      var doc = await transaction.get(ref);
      if (!doc.exists) throw new Error('\u5546\u54c1\u4e0d\u5b58\u5728: ' + barcode);
      var currentStock = doc.data().stock || 0;
      if (delta < 0 && currentStock + delta < 0) {
        throw new Error('\u5eab\u5b58\u4e0d\u8db3\uff0c\u76ee\u524d ' + currentStock + ' \u4ef6');
      }
      var beforeStock = currentStock, afterStock = currentStock + delta;
      transaction.update(ref, { stock: afterStock, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      transaction.set(txRef.doc(), Object.assign({
        barcode: barcode, delta: delta, beforeStock: beforeStock, afterStock: afterStock,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, txData || {}));
      return { beforeStock: beforeStock, afterStock: afterStock };
    });
    var idx = this._cache.findIndex(function (p) { return p.barcode === barcode; });
    if (idx !== -1) this._cache[idx].stock = result.afterStock;
    return result;
  },

  /** 渲染商品列表 */
  renderProductList(containerId, options) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var opts = options || {};
    var list = this._cache.slice();

    // 搜尋篩選
    if (opts.keyword) {
      var kw = opts.keyword.toLowerCase();
      list = list.filter(function (p) {
        return (p.name || '').toLowerCase().indexOf(kw) !== -1 ||
               (p.brand || '').toLowerCase().indexOf(kw) !== -1 ||
               (p.barcode || '').toLowerCase().indexOf(kw) !== -1;
      });
    }
    if (opts.category) {
      list = list.filter(function (p) { return p.category === opts.category; });
    }

    // 排序
    if (opts.sort === 'name') {
      list.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    } else if (opts.sort === 'stock') {
      list.sort(function (a, b) { return (a.stock || 0) - (b.stock || 0); });
    } else {
      list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    }

    if (list.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:#999;padding:40px 0;">目前沒有商品</div>';
      return;
    }

    var esc = InvApp.escapeHTML;
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var alert = p.lowStockAlert || 5;
      var bc = p.stock > alert ? '#4CAF50' : (p.stock > 0 ? '#f44336' : '#9e9e9e');
      var bt = p.stock > 0 ? p.stock : '\u7f3a\u8ca8';
      var meta = [p.color, p.size].filter(Boolean).map(esc).join(' / ');
      html +=
        '<div class="inv-product-card" data-barcode="' + esc(p.barcode) + '" ' +
          'style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #eee;border-radius:10px;margin-bottom:8px;cursor:pointer;background:#fff;">' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-weight:600;font-size:15px;">' + esc(p.name) + '</div>' +
            (p.brand ? '<div style="font-size:13px;color:#666;">' + esc(p.brand) + '</div>' : '') +
            (meta ? '<div style="font-size:12px;color:#999;">' + meta + '</div>' : '') +
            '<div style="font-size:14px;color:#333;margin-top:2px;">' + InvApp.formatCurrency(p.price) + '</div>' +
          '</div>' +
          '<div style="background:' + bc + ';color:#fff;padding:4px 10px;border-radius:12px;font-size:13px;font-weight:600;">' + bt + '</div>' +
        '</div>';
    }
    container.innerHTML = html;

    // 卡片點擊事件
    var self = this;
    var cards = container.querySelectorAll('.inv-product-card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', function () {
        var bc = this.getAttribute('data-barcode');
        InvApp.showPage('page-product-detail');
        self.renderDetail(bc);
      });
    }
  },

  /** 渲染商品詳情頁 */
  async renderDetail(barcode) {
    var container = document.getElementById('inv-product-detail-content');
    if (!container) return;

    var p = this.getByBarcode(barcode);
    if (!p) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">找不到商品</div>';
      return;
    }

    var al = p.lowStockAlert || 5;
    var sc = p.stock > al ? '#4CAF50' : (p.stock > 0 ? '#f44336' : '#9e9e9e');
    var esc = InvApp.escapeHTML;
    var row = function (label, val) { return '<div><span style="color:#999;">' + label + '</span><br>' + val + '</div>'; };
    var html =
      '<div style="padding:16px;">' +
        '<h3 style="margin:0 0 12px;">' + esc(p.name) + '</h3>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px;">' +
          row('\u689d\u78bc', esc(p.barcode)) + row('\u54c1\u724c', esc(p.brand || '-')) +
          row('\u5206\u985e', esc(p.category || '-')) + row('\u984f\u8272/\u5c3a\u5bf8', esc(p.color || '-') + ' / ' + esc(p.size || '-')) +
          row('\u9032\u8ca8\u50f9', InvApp.formatCurrency(p.costPrice)) + row('\u552e\u50f9', InvApp.formatCurrency(p.price)) +
          '<div><span style="color:#999;">\u5eab\u5b58</span><br><span style="color:' + sc + ';font-weight:700;font-size:18px;">' +
            (p.stock || 0) + '</span> <span style="font-size:12px;color:#999;">/ \u4f4e\u5eab\u5b58: ' + al + '</span></div>' +
        '</div>' +
        '<button id="btn-edit-product" style="margin-top:16px;padding:10px 20px;border:none;border-radius:8px;background:#2196F3;color:#fff;font-size:15px;cursor:pointer;width:100%;">\u7de8\u8f2f\u5546\u54c1</button>' +
        '<h4 style="margin:20px 0 8px;">\u7570\u52d5\u6b77\u53f2</h4>' +
        '<div id="inv-product-tx-list" style="color:#999;font-size:14px;">\u8f09\u5165\u4e2d...</div>' +
      '</div>';
    container.innerHTML = html;

    // 編輯按鈕
    var editBtn = document.getElementById('btn-edit-product');
    if (editBtn) {
      var self = this;
      editBtn.addEventListener('click', function () { self._showEditForm(barcode); });
    }

    // 載入異動歷史
    this._loadTransactions(barcode);
  },

  /** 載入最近 20 筆異動 */
  async _loadTransactions(barcode) {
    var txContainer = document.getElementById('inv-product-tx-list');
    if (!txContainer) return;

    try {
      var snap = await db.collection('inv_transactions')
        .where('barcode', '==', barcode)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();

      if (snap.empty) {
        txContainer.innerHTML = '<div style="color:#999;">尚無異動紀錄</div>';
        return;
      }

      var html = '';
      snap.docs.forEach(function (doc) {
        var tx = doc.data();
        var sign = tx.delta > 0 ? '+' : '', color = tx.delta > 0 ? '#4CAF50' : '#f44336';
        var tl = tx.type === 'in' ? '\u5165\u5eab' : (tx.type === 'sale' ? '\u92b7\u552e' : (tx.type || '-'));
        var tm = tx.createdAt ? InvApp.formatDate(tx.createdAt.toDate()) : '-';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px;">' +
          '<div><span style="color:#666;">' + InvApp.escapeHTML(tl) + '</span><span style="color:#999;margin-left:8px;">' + tm + '</span></div>' +
          '<div><span style="color:' + color + ';font-weight:600;">' + sign + tx.delta + '</span>' +
          '<span style="color:#999;margin-left:6px;">' + tx.beforeStock + ' \u2192 ' + tx.afterStock + '</span></div></div>';
      });
      txContainer.innerHTML = html;
    } catch (e) {
      console.error('[InvProducts] _loadTransactions failed:', e);
      txContainer.innerHTML = '<div style="color:#f44336;">異動紀錄載入失敗</div>';
    }
  },

  /** 彈出編輯表單 */
  _showEditForm(barcode) {
    var p = this.getByBarcode(barcode);
    if (!p) return;
    var esc = InvApp.escapeHTML;
    var iStyle = 'width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;';
    var overlay = document.createElement('div');
    overlay.id = 'inv-edit-overlay';
    overlay.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:5000;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(0,0,0,.35);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);';
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.15);' +
        'width:90%;max-width:400px;padding:20px;max-height:80vh;overflow-y:auto;">' +
        '<h3 style="margin:0 0 16px;">\u7de8\u8f2f\u5546\u54c1</h3>' +
        '<label style="font-size:13px;color:#666;">\u54c1\u540d</label>' +
        '<input id="edit-name" value="' + esc(p.name) + '" style="' + iStyle + '" />' +
        '<label style="font-size:13px;color:#666;">\u552e\u50f9</label>' +
        '<input id="edit-price" type="number" value="' + (p.price || 0) + '" style="' + iStyle + '" />' +
        '<label style="font-size:13px;color:#666;">\u9032\u8ca8\u50f9</label>' +
        '<input id="edit-cost" type="number" value="' + (p.costPrice || 0) + '" style="' + iStyle + '" />' +
        '<label style="font-size:13px;color:#666;">\u4f4e\u5eab\u5b58\u8b66\u793a</label>' +
        '<input id="edit-alert" type="number" value="' + (p.lowStockAlert || 5) + '" style="' + iStyle.replace('10px','16px') + '" />' +
        '<div style="display:flex;gap:8px;">' +
          '<button id="edit-cancel" style="flex:1;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;">\u53d6\u6d88</button>' +
          '<button id="edit-save" style="flex:1;padding:10px;border:none;border-radius:8px;background:#4CAF50;color:#fff;cursor:pointer;">\u5132\u5b58</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('touchmove', function (e) {
      if (!e.target.closest('[style*="overflow-y"]')) { e.preventDefault(); e.stopPropagation(); }
    }, { passive: false });
    var self = this;
    document.getElementById('edit-cancel').addEventListener('click', function () { overlay.remove(); });
    document.getElementById('edit-save').addEventListener('click', async function () {
      var updates = {
        name: document.getElementById('edit-name').value.trim(),
        price: Number(document.getElementById('edit-price').value) || 0,
        costPrice: Number(document.getElementById('edit-cost').value) || 0,
        lowStockAlert: Number(document.getElementById('edit-alert').value) || 5
      };
      if (!updates.name) { InvApp.showToast('\u54c1\u540d\u4e0d\u53ef\u70ba\u7a7a'); return; }
      try {
        await self.update(barcode, updates);
        InvApp.showToast('\u5546\u54c1\u5df2\u66f4\u65b0');
        overlay.remove();
        self.renderDetail(barcode);
      } catch (err) { /* update \u5167\u5df2 toast */ }
    });
  },

  /** 取得低庫存商品 */
  getLowStockProducts() {
    return this._cache.filter(function (p) {
      var alert = p.lowStockAlert || 5;
      return (p.stock || 0) <= alert;
    });
  }
};
