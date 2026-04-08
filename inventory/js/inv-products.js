/**
 * inv-products.js
 * 商品 CRUD 模組 — 快取、搜尋、庫存異動、渲染
 */
const InvProducts = {
  _cache: [],
  _loaded: false,
  _filterKeyword: '',
  _filterCategory: '',
  _filterSort: '',
  _filterStock: '',
  _filterGroup: '',
  GROUP_TABS: ['商品', '活動', '器材', '其他'],

  /** 從 Firestore 載入所有商品到 _cache */
  async loadAll() {
    try {
      const snap = await InvStore.col('products').get();
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
      await InvStore.col('products').doc(data.barcode).set(data);
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
      await InvStore.col('products').doc(barcode).update(updates);
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
    var ref = InvStore.col('products').doc(barcode);
    var txRef = InvStore.col('transactions');
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

  /** 庫存修正（Transaction），直接將庫存設為指定數量 */
  async correctStock(barcode, newStock, txData) {
    if (newStock < 0) throw new Error('庫存不可為負數');
    var ref = InvStore.col('products').doc(barcode);
    var txRef = InvStore.col('transactions');
    var result = await db.runTransaction(async function (transaction) {
      var doc = await transaction.get(ref);
      if (!doc.exists) throw new Error('商品不存在: ' + barcode);
      var currentStock = doc.data().stock || 0;
      var delta = newStock - currentStock;
      transaction.update(ref, { stock: newStock, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      transaction.set(txRef.doc(), Object.assign({
        barcode: barcode, delta: delta, beforeStock: currentStock, afterStock: newStock,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, txData || {}));
      return { beforeStock: currentStock, afterStock: newStock };
    });
    var idx = this._cache.findIndex(function (p) { return p.barcode === barcode; });
    if (idx !== -1) this._cache[idx].stock = result.afterStock;
    return result;
  },

  /** 渲染庫存頁面（頁籤 + 篩選列 + 列表） */
  async renderProductPage(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (!this._cache.length && !this._loaded) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">載入中...</div>';
      await this.loadAll();
    }

    // 收集分類（只取有商品的）
    var cats = [];
    this._cache.forEach(function(p) { if (p.category && cats.indexOf(p.category) === -1) cats.push(p.category); });

    var esc = InvApp.escapeHTML;
    var fg = this._filterGroup, fc = this._filterCategory;
    var combinedVal = this._filterStock ? 'stock_' + this._filterStock : 'sort_' + (this._filterSort || '');
    var tabs = this.GROUP_TABS;

    // ── 頁籤列 ──
    var tabHtml = '<div style="display:flex;border-bottom:2px solid var(--border);margin-bottom:6px">';
    var allActive = !fg;
    tabHtml += '<button class="inv-group-tab" data-group="" style="flex:1;padding:8px 0;border:none;background:none;font-size:13px;font-weight:' + (allActive ? '700' : '400') + ';color:' + (allActive ? 'var(--accent)' : 'var(--text-muted)') + ';cursor:pointer;border-bottom:2px solid ' + (allActive ? 'var(--accent)' : 'transparent') + ';margin-bottom:-2px">全部</button>';
    for (var ti = 0; ti < tabs.length; ti++) {
      var ta = fg === tabs[ti];
      // 計算該 group 的商品數
      var gc = this._cache.filter(function(p) { return (p.group || '商品') === tabs[ti]; }).length;
      tabHtml += '<button class="inv-group-tab" data-group="' + esc(tabs[ti]) + '" style="flex:1;padding:8px 0;border:none;background:none;font-size:13px;font-weight:' + (ta ? '700' : '400') + ';color:' + (ta ? 'var(--accent)' : 'var(--text-muted)') + ';cursor:pointer;border-bottom:2px solid ' + (ta ? 'var(--accent)' : 'transparent') + ';margin-bottom:-2px">' + esc(tabs[ti]) + '<span style="font-size:10px;color:var(--text-muted);margin-left:2px">' + gc + '</span></button>';
    }
    tabHtml += '</div>';

    // ── 篩選列 ──
    var catOpts = '<option value="">全部分類</option>';
    for (var i = 0; i < cats.length; i++) {
      catOpts += '<option value="' + esc(cats[i]) + '"' + (fc === cats[i] ? ' selected' : '') + '>' + esc(cats[i]) + '</option>';
    }
    var sortItems = [
      { val: 'sort_',           label: '最新' },
      { val: 'sort_name',       label: '名稱' },
      { val: 'sort_stock',      label: '庫存少→多' },
      { val: 'sort_stock_desc', label: '庫存多→少' },
      { val: 'stock_low',       label: '低庫存' },
      { val: 'stock_zero',      label: '缺貨' },
      { val: 'stock_ok',        label: '充足' },
    ];
    var sortOpts = '';
    for (var si = 0; si < sortItems.length; si++) {
      var s = sortItems[si];
      sortOpts += '<option value="' + s.val + '"' + (combinedVal === s.val ? ' selected' : '') + '>' + esc(s.label) + '</option>';
    }
    var ss = 'height:34px;font-size:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:var(--text-primary);padding:0 6px;min-width:0';

    var html =
      '<div style="padding:0 10px">' + tabHtml +
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">' +
          '<input id="inv-prod-search" class="inv-input" type="search" placeholder="搜尋品名/品牌/條碼" value="' + esc(this._filterKeyword) + '" style="flex:1;min-width:0;height:34px;font-size:12px" />' +
          '<select id="inv-prod-cat" style="' + ss + ';flex-shrink:0;max-width:30%">' + catOpts + '</select>' +
          '<select id="inv-prod-sort" style="' + ss + ';flex-shrink:0;max-width:30%">' + sortOpts + '</select>' +
        '</div>' +
        '<div id="inv-prod-count" style="font-size:11px;color:var(--text-muted);margin-bottom:2px"></div>' +
      '</div>' +
      '<div id="inv-prod-list" style="padding:0 10px 80px"></div>';
    container.innerHTML = html;

    // ── 綁定事件 ──
    var self = this;
    // 頁籤
    container.querySelectorAll('.inv-group-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        self._filterGroup = this.getAttribute('data-group');
        self.renderProductPage(containerId);
      });
    });
    // 搜尋
    var searchInput = document.getElementById('inv-prod-search');
    var _searchTimer = null;
    searchInput.addEventListener('input', function() {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(function() {
        self._filterKeyword = searchInput.value.trim();
        self._refreshProductList();
      }, 250);
    });
    document.getElementById('inv-prod-cat').addEventListener('change', function() {
      self._filterCategory = this.value;
      self._refreshProductList();
    });
    document.getElementById('inv-prod-sort').addEventListener('change', function() {
      var v = this.value;
      if (v.indexOf('stock_') === 0) {
        self._filterStock = v.replace('stock_', '');
        self._filterSort = '';
      } else {
        self._filterSort = v.replace('sort_', '');
        self._filterStock = '';
      }
      self._refreshProductList();
    });

    this._refreshProductList();
  },

  /** 根據當前篩選條件刷新商品列表 */
  _refreshProductList() {
    this.renderProductList('inv-prod-list', {
      keyword: this._filterKeyword,
      category: this._filterCategory,
      sort: this._filterSort,
      stockFilter: this._filterStock,
      group: this._filterGroup,
    });
  },

  /** 渲染商品列表 */
  async renderProductList(containerId, options) {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (!this._cache.length && !this._loaded) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">載入中...</div>';
      await this.loadAll();
    }

    var opts = options || {};
    var list = this._cache.slice();

    // 群組篩選（頁籤）
    if (opts.group) {
      var g = opts.group;
      list = list.filter(function (p) { return (p.group || '商品') === g; });
    }

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
    if (opts.stockFilter === 'low') {
      list = list.filter(function (p) { var a = p.lowStockAlert || 5; return (p.stock || 0) > 0 && (p.stock || 0) <= a; });
    } else if (opts.stockFilter === 'zero') {
      list = list.filter(function (p) { return (p.stock || 0) === 0; });
    } else if (opts.stockFilter === 'ok') {
      list = list.filter(function (p) { var a = p.lowStockAlert || 5; return (p.stock || 0) > a; });
    }

    // 更新計數
    var countEl = document.getElementById('inv-prod-count');
    if (countEl) countEl.textContent = '共 ' + list.length + ' 件商品' + (list.length !== this._cache.length ? '（篩選自 ' + this._cache.length + ' 件）' : '');

    // 排序
    if (opts.sort === 'name') {
      list.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    } else if (opts.sort === 'stock') {
      list.sort(function (a, b) { return (a.stock || 0) - (b.stock || 0); });
    } else if (opts.sort === 'stock_desc') {
      list.sort(function (a, b) { return (b.stock || 0) - (a.stock || 0); });
    } else {
      list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    }

    if (list.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px 0;">目前沒有商品</div>';
      return;
    }

    var esc = InvApp.escapeHTML;
    var _hp = typeof InvAuth !== 'undefined' && InvAuth.hasPerm ? InvAuth.hasPerm.bind(InvAuth) : function() { return true; };
    var canRestock = _hp('inventory.quick_restock');
    var canChangeGroup = _hp('inventory.change_group');
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var al = p.lowStockAlert || 5;
      var stockBg = p.stock > al ? 'var(--success)' : (p.stock > 0 ? 'var(--danger)' : 'var(--text-muted)');
      var stockTxt = p.stock > 0 ? p.stock : '缺貨';
      var thumb = p.image || p.imageUrl || '';
      var thumbHtml = thumb
        ? '<img src="' + esc(thumb) + '" style="width:48px;height:48px;object-fit:cover;border-radius:var(--radius-sm);flex-shrink:0">'
        : '<div style="width:48px;height:48px;border-radius:var(--radius-sm);background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px;color:var(--text-muted)">📦</div>';
      // 膠囊標籤
      var pills = [];
      if (p.brand) pills.push(esc(p.brand));
      if (p.category) pills.push(esc(p.category));
      if (p.color) pills.push(esc(p.color));
      if (p.size) pills.push(esc(p.size));
      var pillsHtml = pills.length
        ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px">' +
          pills.map(function(t) { return '<span style="font-size:11px;padding:1px 7px;border-radius:var(--radius-full);background:var(--bg-elevated);color:var(--text-secondary);white-space:nowrap">' + t + '</span>'; }).join('') +
          '</div>'
        : '';
      var actionBtns = '<div style="background:' + stockBg + ';color:#fff;padding:2px 8px;border-radius:var(--radius-full);font-size:12px;font-weight:600;white-space:nowrap">' + stockTxt + '</div>';
      if (canRestock) {
        actionBtns += '<button class="inv-list-restock-btn" data-bc="' + esc(p.barcode) + '" style="width:26px;height:26px;border:1px solid var(--accent);border-radius:6px;background:var(--bg-card);color:var(--accent);font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0" title="快速入庫">+</button>';
      }
      if (canChangeGroup) {
        actionBtns += '<select class="inv-list-group-sel" data-bc="' + esc(p.barcode) + '" style="height:26px;font-size:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-secondary);padding:0 2px;min-width:0;max-width:48px;flex-shrink:0" title="分類標籤">' +
              this._buildGroupOptions(p.group || '商品') +
            '</select>';
      }
      html +=
        '<div class="inv-product-card" data-barcode="' + esc(p.barcode) + '" ' +
          'style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;cursor:pointer;background:var(--bg-card)">' +
          thumbHtml +
          '<div style="flex:1;min-width:0;overflow:hidden">' +
            '<div style="display:flex;align-items:center;gap:6px">' +
              '<span style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.name) + '</span>' +
              '<span style="font-size:13px;font-weight:600;color:var(--accent);white-space:nowrap">' + InvApp.formatCurrency(p.price) + '</span>' +
            '</div>' +
            pillsHtml +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0">' +
            actionBtns +
          '</div>' +
        '</div>';
    }
    container.innerHTML = html;

    // 卡片點擊事件
    var self = this;
    var cards = container.querySelectorAll('.inv-product-card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', function (e) {
        if (e.target.closest('.inv-list-restock-btn')) return; // 讓 restock 按鈕自己處理
        var bc = this.getAttribute('data-barcode');
        InvApp.showPage('page-product-detail');
        self.renderDetail(bc);
      });
    }
    // 列表快速入庫按鈕
    container.querySelectorAll('.inv-list-restock-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var bc = this.getAttribute('data-bc');
        self._showQuickRestockPopup(bc);
      });
    });
    // 群組下拉選單
    container.querySelectorAll('.inv-list-group-sel').forEach(function(sel) {
      sel.addEventListener('click', function(e) { e.stopPropagation(); });
      sel.addEventListener('change', function(e) {
        e.stopPropagation();
        var bc = this.getAttribute('data-bc');
        self._changeProductGroup(bc, this.value);
      });
    });
  },

  /** 渲染商品詳情頁 */
  async renderDetail(barcode) {
    var container = document.getElementById('inv-product-detail-content');
    if (!container) return;

    var p = this.getByBarcode(barcode);
    if (!p) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">找不到商品</div>';
      return;
    }

    var al = p.lowStockAlert || 5;
    var sc = p.stock > al ? 'var(--success)' : (p.stock > 0 ? 'var(--danger)' : 'var(--text-muted)');
    var esc = InvApp.escapeHTML;
    var ib = '<button class="inv-info-btn" onclick="InvProducts._showProductInfo()" title="說明">?</button>';
    var hasImg = p.image || p.imageUrl;
    var imgHtml = hasImg
      ? '<div style="text-align:center;margin-bottom:12px"><img src="' + esc(hasImg) + '" style="width:120px;height:120px;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--border)"></div>'
      : '';
    var pill = function(label, val) {
      if (!val || val === '-') return '';
      return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 10px;border-radius:var(--radius-full);background:var(--bg-elevated);color:var(--text-secondary);margin:2px">'
        + '<span style="color:var(--text-muted);font-size:11px">' + label + '</span>' + esc(val) + '</span>';
    };
    var pills = pill('條碼', p.barcode) + pill('品牌', p.brand) + pill('分類', p.category)
      + pill('顏色', p.color) + pill('尺寸', p.size);
    var html =
      '<div style="padding:16px;">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">' +
          '<h3 style="margin:0;flex:1">' + esc(p.name) + '</h3>' + ib +
        '</div>' +
        imgHtml +
        '<div style="display:flex;flex-wrap:wrap;gap:0;margin-bottom:10px">' + pills + '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:12px">' +
          '<div style="flex:1;padding:10px;border-radius:var(--radius-sm);background:var(--bg-elevated);text-align:center">' +
            '<div style="font-size:11px;color:var(--text-muted)">售價</div>' +
            '<div style="font-size:16px;font-weight:700;color:var(--accent)">' + InvApp.formatCurrency(p.price) + '</div>' +
          '</div>' +
          '<div style="flex:1;padding:10px;border-radius:var(--radius-sm);background:var(--bg-elevated);text-align:center">' +
            '<div style="font-size:11px;color:var(--text-muted)">進貨價</div>' +
            '<div style="font-size:16px;font-weight:700">' + (InvAuth.canSeeCost() ? InvApp.formatCurrency(p.costPrice) : '***') + '</div>' +
          '</div>' +
          '<div style="flex:1;padding:10px;border-radius:var(--radius-sm);background:var(--bg-elevated);text-align:center">' +
            '<div style="font-size:11px;color:var(--text-muted)">庫存</div>' +
            '<div style="font-size:16px;font-weight:700;color:' + sc + '">' + (p.stock || 0) +
              '<span style="font-size:11px;font-weight:400;color:var(--text-muted);margin-left:2px">/ ' + al + '</span></div>' +
          '</div>' +
        '</div>';
    var _hp = typeof InvAuth !== 'undefined' && InvAuth.hasPerm ? InvAuth.hasPerm.bind(InvAuth) : function() { return true; };
    var quickRestockHtml = '';
    if (_hp('inventory.quick_restock')) {
      quickRestockHtml =
        '<div id="inv-quick-restock" style="margin-bottom:12px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card)">' +
          '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">快速補貨</div>' +
          '<div style="display:flex;align-items:center;gap:0">' +
            '<button class="inv-qr-btn" data-delta="-1" style="width:44px;height:40px;border:1px solid var(--border);border-radius:8px 0 0 8px;background:var(--bg-elevated);font-size:20px;font-weight:700;cursor:pointer;color:var(--text-primary);flex-shrink:0">−</button>' +
            '<input id="inv-quick-qty" type="number" inputmode="numeric" value="1" min="1" class="inv-hide-spin" style="width:56px;height:40px;text-align:center;font-size:18px;font-weight:700;border-top:1px solid var(--border);border-bottom:1px solid var(--border);border-left:none;border-right:none;padding:0;box-sizing:border-box;background:var(--bg-card);color:var(--text-primary);-moz-appearance:textfield" />' +
            '<button class="inv-qr-btn" data-delta="1" style="width:44px;height:40px;border:1px solid var(--border);border-radius:0 8px 8px 0;background:var(--bg-elevated);font-size:20px;font-weight:700;cursor:pointer;color:var(--text-primary);flex-shrink:0">+</button>' +
            '<button id="inv-quick-restock-btn" style="margin-left:8px;padding:0 14px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;height:40px;white-space:nowrap;flex-shrink:0">入庫</button>' +
          '</div>' +
          '<div style="display:flex;gap:6px;margin-top:6px">' +
            '<button class="inv-qr-preset" data-set="5" style="flex:1;padding:5px 0;border:1px solid var(--accent);border-radius:var(--radius-full);background:var(--bg-card);color:var(--accent);font-size:12px;font-weight:600;cursor:pointer">+5</button>' +
            '<button class="inv-qr-preset" data-set="10" style="flex:1;padding:5px 0;border:1px solid var(--accent);border-radius:var(--radius-full);background:var(--bg-card);color:var(--accent);font-size:12px;font-weight:600;cursor:pointer">+10</button>' +
            '<button class="inv-qr-preset" data-set="20" style="flex:1;padding:5px 0;border:1px solid var(--accent);border-radius:var(--radius-full);background:var(--bg-card);color:var(--accent);font-size:12px;font-weight:600;cursor:pointer">+20</button>' +
            '<button class="inv-qr-preset" data-set="50" style="flex:1;padding:5px 0;border:1px solid var(--accent);border-radius:var(--radius-full);background:var(--bg-card);color:var(--accent);font-size:12px;font-weight:600;cursor:pointer">+50</button>' +
          '</div>' +
        '</div>';
    }
    html += quickRestockHtml;
    var quickCorrectionHtml = '';
    if (_hp('inventory.quick_correction')) {
      quickCorrectionHtml =
        '<div id="inv-quick-correction" style="margin-bottom:12px;padding:10px 12px;border:1px solid var(--warning);border-radius:var(--radius-sm);background:var(--bg-card)">' +
          '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
            '<div style="font-size:12px;color:var(--warning);font-weight:600">快速修正</div>' +
            '<div style="font-size:11px;color:var(--text-muted)">直接設定庫存數量</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:0">' +
            '<button class="inv-qc-btn" data-delta="-1" style="width:44px;height:40px;border:1px solid var(--border);border-radius:8px 0 0 8px;background:var(--bg-elevated);font-size:20px;font-weight:700;cursor:pointer;color:var(--text-primary);flex-shrink:0">\u2212</button>' +
            '<input id="inv-quick-correction-qty" type="number" inputmode="numeric" value="' + (p.stock || 0) + '" min="0" class="inv-hide-spin" style="width:56px;height:40px;text-align:center;font-size:18px;font-weight:700;border-top:1px solid var(--border);border-bottom:1px solid var(--border);border-left:none;border-right:none;padding:0;box-sizing:border-box;background:var(--bg-card);color:var(--text-primary);-moz-appearance:textfield" />' +
            '<button class="inv-qc-btn" data-delta="1" style="width:44px;height:40px;border:1px solid var(--border);border-radius:0 8px 8px 0;background:var(--bg-elevated);font-size:20px;font-weight:700;cursor:pointer;color:var(--text-primary);flex-shrink:0">+</button>' +
            '<button id="inv-quick-correction-btn" style="margin-left:8px;padding:0 14px;border:none;border-radius:8px;background:var(--warning);color:#fff;font-size:14px;font-weight:600;cursor:pointer;height:40px;white-space:nowrap;flex-shrink:0">修正</button>' +
          '</div>' +
          '<div style="display:flex;gap:6px;margin-top:6px">' +
            '<button class="inv-qc-preset" data-set="0" style="flex:1;padding:5px 0;border:1px solid var(--warning);border-radius:var(--radius-full);background:var(--bg-card);color:var(--warning);font-size:12px;font-weight:600;cursor:pointer">0</button>' +
            '<button class="inv-qc-preset" data-set="5" style="flex:1;padding:5px 0;border:1px solid var(--warning);border-radius:var(--radius-full);background:var(--bg-card);color:var(--warning);font-size:12px;font-weight:600;cursor:pointer">5</button>' +
            '<button class="inv-qc-preset" data-set="10" style="flex:1;padding:5px 0;border:1px solid var(--warning);border-radius:var(--radius-full);background:var(--bg-card);color:var(--warning);font-size:12px;font-weight:600;cursor:pointer">10</button>' +
            '<button class="inv-qc-preset" data-set="20" style="flex:1;padding:5px 0;border:1px solid var(--warning);border-radius:var(--radius-full);background:var(--bg-card);color:var(--warning);font-size:12px;font-weight:600;cursor:pointer">20</button>' +
          '</div>' +
        '</div>';
    }
    html += quickCorrectionHtml;
    var editBtnHtml = _hp('inventory.edit')
      ? '<button id="btn-edit-product" style="padding:10px 20px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:15px;cursor:pointer;width:100%">編輯商品</button>'
      : '';
    var actionRow = '';
    if (_hp('inventory.return')) actionRow += '<button id="btn-return-product" style="flex:1;padding:10px;border:1px solid var(--accent);border-radius:8px;background:var(--bg-card);color:var(--accent);font-size:14px;cursor:pointer">退貨</button>';
    if (_hp('inventory.waste')) actionRow += '<button id="btn-waste-product" style="flex:1;padding:10px;border:1px solid var(--danger);border-radius:8px;background:var(--bg-card);color:var(--danger);font-size:14px;cursor:pointer">報廢</button>';
    actionRow += '<button id="btn-print-barcode" style="flex:1;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:var(--text-secondary);font-size:14px;cursor:pointer">列印條碼</button>';
    html += editBtnHtml +
        '<div style="display:flex;gap:8px;margin-top:8px">' + actionRow + '</div>' +
        '<h4 style="margin:20px 0 8px">異動歷史</h4>' +
        '<div id="inv-product-tx-list" style="color:var(--text-muted);font-size:14px;">載入中...</div>' +
      '</div>';
    container.innerHTML = html;

    var self = this;

    // 快速補貨
    var qtyInput = document.getElementById('inv-quick-qty');
    var restockArea = document.getElementById('inv-quick-restock');
    if (restockArea && qtyInput) {
      restockArea.querySelectorAll('.inv-qr-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var d = Number(this.getAttribute('data-delta'));
          qtyInput.value = Math.max(1, (Number(qtyInput.value) || 1) + d);
        });
      });
      restockArea.querySelectorAll('.inv-qr-preset').forEach(function(btn) {
        btn.addEventListener('click', function() {
          qtyInput.value = Number(this.getAttribute('data-set'));
        });
      });
      document.getElementById('inv-quick-restock-btn').addEventListener('click', async function() {
        var qty = parseInt(qtyInput.value, 10);
        if (!qty || qty < 1) { InvApp.showToast('請輸入有效數量'); return; }
        this.disabled = true;
        this.textContent = '處理中...';
        try {
          var result = await InvProducts.adjustStock(barcode, qty, {
            type: 'in', note: '快速補貨', uid: InvAuth.getUid() || '',
            operatorName: InvAuth.getName() || '',
          });
          InvUtils.writeLog('quick_restock', (p.name || barcode) + ' +' + qty + ' 庫存' + result.afterStock);
          InvApp.showToast('入庫成功 +' + qty + '，目前庫存 ' + result.afterStock);
          self.renderDetail(barcode);
        } catch (e) {
          InvApp.showToast('入庫失敗：' + (e.message || ''));
          this.disabled = false;
          this.textContent = '入庫';
        }
      });
    }

    // 快速修正
    var corrQtyInput = document.getElementById('inv-quick-correction-qty');
    var corrArea = document.getElementById('inv-quick-correction');
    if (corrArea && corrQtyInput) {
      corrArea.querySelectorAll('.inv-qc-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var d = Number(this.getAttribute('data-delta'));
          corrQtyInput.value = Math.max(0, (Number(corrQtyInput.value) || 0) + d);
        });
      });
      corrArea.querySelectorAll('.inv-qc-preset').forEach(function(btn) {
        btn.addEventListener('click', function() {
          corrQtyInput.value = Number(this.getAttribute('data-set'));
        });
      });
      document.getElementById('inv-quick-correction-btn').addEventListener('click', async function() {
        var newStock = parseInt(corrQtyInput.value, 10);
        if (isNaN(newStock) || newStock < 0) { InvApp.showToast('請輸入有效數量'); return; }
        var currentStock = p.stock || 0;
        if (newStock === currentStock) { InvApp.showToast('數量未變更'); return; }
        var confirmMsg = '確定要將「' + (p.name || barcode) + '」庫存從 ' + currentStock + ' 修正為 ' + newStock + '？';
        if (!confirm(confirmMsg)) return;
        this.disabled = true;
        this.textContent = '處理中...';
        try {
          var result = await InvProducts.correctStock(barcode, newStock, {
            type: 'correction', note: '快速修正（' + (InvAuth.getName() || '') + '）',
            uid: InvAuth.getUid() || '',
            operatorName: InvAuth.getName() || '',
            productName: p.name || barcode,
          });
          InvUtils.writeLog('quick_correction', (p.name || barcode) + ' ' + result.beforeStock + '→' + result.afterStock + '（' + (InvAuth.getName() || '') + '）');
          InvApp.showToast('庫存已修正 ' + result.beforeStock + ' → ' + result.afterStock);
          self.renderDetail(barcode);
        } catch (e) {
          InvApp.showToast('修正失敗：' + (e.message || ''));
          this.disabled = false;
          this.textContent = '修正';
        }
      });
    }

    // 編輯按鈕
    var editBtn = document.getElementById('btn-edit-product');
    if (editBtn) {
      editBtn.addEventListener('click', function () { self._showEditForm(barcode); });
    }
    // 退貨 / 報廢按鈕
    var returnBtn = document.getElementById('btn-return-product');
    if (returnBtn) returnBtn.addEventListener('click', function () {
      if (typeof InvSale !== 'undefined' && InvSale.showReturnForm) InvSale.showReturnForm(barcode);
      else InvApp.showToast('退貨模組未載入');
    });
    var wasteBtn = document.getElementById('btn-waste-product');
    if (wasteBtn) wasteBtn.addEventListener('click', function () {
      if (typeof InvSale !== 'undefined' && InvSale.showWasteForm) InvSale.showWasteForm(barcode);
      else InvApp.showToast('報廢模組未載入');
    });
    // 列印條碼按鈕
    var printBtn = document.getElementById('btn-print-barcode');
    if (printBtn) printBtn.addEventListener('click', function () {
      if (typeof InvSettings !== 'undefined' && InvSettings.showBarcodePrint) {
        InvSettings.showBarcodePrint(barcode, p.name, p.sellPrice || p.price || 0);
      } else {
        InvApp.showToast('列印模組未載入');
      }
    });

    // 載入異動歷史
    this._loadTransactions(barcode);
  },

  /** 載入最近 20 筆異動 */
  async _loadTransactions(barcode) {
    var txContainer = document.getElementById('inv-product-tx-list');
    if (!txContainer) return;

    try {
      var snap = await InvStore.col('transactions')
        .where('barcode', '==', barcode)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();

      if (snap.empty) {
        txContainer.innerHTML = '<div style="color:var(--text-muted);">尚無異動紀錄</div>';
        return;
      }

      var html = '';
      snap.docs.forEach(function (doc) {
        var tx = doc.data();
        var qty = Number(tx.delta) || Number(tx.quantity) || 0;
        if (tx.type === 'out' || tx.type === 'sale' || tx.type === 'waste') qty = -Math.abs(qty);
        var sign = qty > 0 ? '+' : '', color = qty > 0 ? '#4CAF50' : '#f44336';
        var tl = tx.type === 'in' ? '\u5165\u5eab' : (tx.type === 'out' || tx.type === 'sale' ? '\u92b7\u552e' : (tx.type === 'return' ? '\u9000\u8ca8' : (tx.type === 'waste' ? '\u5831\u5ee2' : (tx.type === 'adjust' ? '\u8abf\u6574' : (tx.type === 'correction' ? '\u4fee\u6b63' : (tx.type || '-'))))));
        var tm = tx.createdAt ? InvApp.formatDate(tx.createdAt.toDate()) : '-';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">' +
          '<div><span style="color:var(--text-muted);">' + InvApp.escapeHTML(tl) + '</span><span style="color:var(--text-muted);margin-left:8px;">' + tm + '</span></div>' +
          '<div><span style="color:' + color + ';font-weight:600;">' + sign + qty + '</span>' +
          '<span style="color:var(--text-muted);margin-left:6px;">' + tx.beforeStock + ' \u2192 ' + tx.afterStock + '</span></div></div>';
      });
      txContainer.innerHTML = html;
    } catch (e) {
      console.error('[InvProducts] _loadTransactions failed:', e);
      txContainer.innerHTML = '<div style="color:var(--danger);">異動紀錄載入失敗</div>';
    }
  },

  /** 商品詳情說明彈窗（圓形 ? 按鈕） */
  _showProductInfo() {
    var existing = document.getElementById('inv-product-info-overlay');
    if (existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = 'inv-product-info-overlay';
    ov.className = 'inv-overlay show';
    ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
    ov.addEventListener('touchmove', function(e) { if (!e.target.closest('.inv-modal')) { e.preventDefault(); e.stopPropagation(); } }, { passive: false });
    var s = 'background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0';
    ov.innerHTML =
      '<div class="inv-modal" style="max-width:380px;width:90%;max-height:80vh;overflow-y:auto">' +
        '<h3 style="margin:0 0 12px;font-size:17px;font-weight:700">商品詳情說明</h3>' +
        '<div style="' + s + '"><b>條碼</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">商品的唯一識別編號，用於掃碼入庫、銷售、退貨等操作。</p></div>' +
        '<div style="' + s + '"><b>售價 / 進貨價</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">售價為對外銷售價格，進貨價為成本價。兩者差額為毛利。</p></div>' +
        '<div style="' + s + '"><b>庫存 / 低庫存門檻</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">當前庫存量。右側數字為低庫存警示門檻，低於此值時儀表板會顯示警示。</p></div>' +
        '<div style="' + s + '"><b>編輯商品</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">修改品名、售價、進貨價、分類、圖片等資訊，也可更改產品編號。</p></div>' +
        '<div style="' + s + '"><b>退貨</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">處理顧客退貨，可選擇退回庫存或直接報廢。會產生退貨交易紀錄。</p></div>' +
        '<div style="' + s + '"><b>報廢</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">標記損壞、過期或遺失的商品，庫存會相應減少。</p></div>' +
        '<div style="' + s + '"><b>異動歷史</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">顯示此商品最近 20 筆入庫、銷售、退貨、調整等紀錄，綠色為入庫、紅色為出庫。</p></div>' +
        '<button class="inv-btn primary full" style="margin-top:12px" onclick="this.closest(\'.inv-overlay\').remove()">我知道了</button>' +
      '</div>';
    document.body.appendChild(ov);
  },

  /** 彈出編輯表單（含分類） */
  async _showEditForm(barcode) {
    var _hp = typeof InvAuth !== 'undefined' && InvAuth.hasPerm ? InvAuth.hasPerm.bind(InvAuth) : function() { return true; };
    if (!_hp('inventory.edit')) { InvApp.showToast('權限不足'); return; }
    var p = this.getByBarcode(barcode);
    if (!p) return;
    var esc = InvApp.escapeHTML;
    // 讀取分類選項
    var categories = [];
    try {
      var cfgDoc = await InvStore.storeRef().get();
      if (cfgDoc.exists && cfgDoc.data().categories) categories = cfgDoc.data().categories;
    } catch (_) {}
    var catOptions = '<option value="">-- 未分類 --</option>';
    for (var ci = 0; ci < categories.length; ci++) {
      var sel = (p.category === categories[ci]) ? ' selected' : '';
      catOptions += '<option value="' + esc(categories[ci]) + '"' + sel + '>' + esc(categories[ci]) + '</option>';
    }
    var ls = 'class="inv-label" style="margin-top:6px"';
    var overlay = document.createElement('div');
    overlay.id = 'inv-edit-overlay';
    overlay.className = 'inv-overlay show';
    var hasImg = p.image || p.imageUrl;
    overlay.innerHTML =
      '<div class="inv-modal" style="max-width:400px;width:92%;max-height:80vh;overflow-y:auto">' +
        '<h3 style="margin:0 0 16px;font-size:17px;font-weight:700">編輯商品</h3>' +
        '<label ' + ls + '>產品編號（條碼）</label>' +
        '<input id="edit-barcode" class="inv-input" value="' + esc(barcode) + '"' + (_hp('inventory.edit_barcode') ? '' : ' readonly style="height:40px;font-size:14px;margin-bottom:4px;opacity:0.6;cursor:not-allowed"') + (_hp('inventory.edit_barcode') ? ' style="height:40px;font-size:14px;margin-bottom:4px"' : '') + ' />' +
        '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">修改編號會建立新文件並刪除舊文件，歷史交易紀錄仍保留原編號。</div>' +
        '<label ' + ls + '>商品圖片</label>' +
        '<input type="file" id="edit-image-input" accept="image/*" hidden />' +
        '<div id="edit-image-preview" style="width:120px;height:120px;margin:0 auto 10px;border:2px dashed var(--border);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;background:var(--bg-elevated);position:relative;transition:border-color var(--ease)" onclick="document.getElementById(\'edit-image-input\').click()">' +
          (hasImg ? '<img src="' + esc(hasImg) + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">' : '<span style="font-size:13px;color:var(--text-muted)">點擊上傳商品圖片</span>') +
        '</div>' +
        '<label ' + ls + '>品名</label>' +
        '<input id="edit-name" class="inv-input" value="' + esc(p.name) + '" style="height:40px;font-size:14px" />' +
        '<label ' + ls + '>分類</label>' +
        '<select id="edit-category" class="inv-select" style="height:40px;font-size:14px">' + catOptions + '</select>' +
        '<label ' + ls + '>品牌</label>' +
        '<input id="edit-brand" class="inv-input" value="' + esc(p.brand || '') + '" style="height:40px;font-size:14px" />' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div><label ' + ls + '>顏色</label><input id="edit-color" class="inv-input" value="' + esc(p.color || '') + '" style="height:40px;font-size:14px" /></div>' +
          '<div><label ' + ls + '>尺寸</label><input id="edit-size" class="inv-input" value="' + esc(p.size || '') + '" style="height:40px;font-size:14px" /></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div><label ' + ls + '>售價</label><input id="edit-price" class="inv-input" type="number" value="' + (p.sellPrice || p.price || 0) + '" style="height:40px;font-size:14px" /></div>' +
          '<div><label ' + ls + '>進貨價</label><input id="edit-cost" class="inv-input" type="' + (InvAuth.canSeeCost() ? 'number' : 'text') + '" value="' + (InvAuth.canSeeCost() ? (p.costPrice || 0) : '***') + '"' + (InvAuth.canSeeCost() ? '' : ' disabled') + ' style="height:40px;font-size:14px" /></div>' +
        '</div>' +
        '<label ' + ls + '>低庫存警示門檻</label>' +
        '<input id="edit-alert" class="inv-input" type="number" value="' + (p.lowStockAlert || 5) + '" style="height:40px;font-size:14px;margin-bottom:16px" />' +
        '<div style="display:flex;gap:8px">' +
          '<button id="edit-cancel" class="inv-btn outline full">取消</button>' +
          '<button id="edit-save" class="inv-btn primary full">儲存</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.addEventListener('touchmove', function (e) {
      if (!e.target.closest('.inv-modal')) { e.preventDefault(); e.stopPropagation(); }
    }, { passive: false });
    var self = this;
    var _editImageDataUrl = null;
    // 圖片上傳處理
    document.getElementById('edit-image-input').addEventListener('change', async function () {
      var file = this.files && this.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { InvApp.showToast('原始圖片不可超過 5MB'); return; }
      try {
        var dataUrl = await InvUtils.cropImageSquare(file, { maxSize: 400, quality: 0.75 });
        _editImageDataUrl = dataUrl;
        var preview = document.getElementById('edit-image-preview');
        if (preview) preview.innerHTML = '<img src="' + dataUrl + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">';
      } catch (e) {
        if (e && e.message !== 'cancelled') InvApp.showToast('圖片處理失敗：' + (e.message || ''));
      }
    });
    document.getElementById('edit-cancel').addEventListener('click', function () { overlay.remove(); });
    document.getElementById('edit-save').addEventListener('click', async function () {
      var newBarcode = (document.getElementById('edit-barcode').value || '').trim();
      if (!newBarcode) { InvApp.showToast('產品編號不可為空'); return; }
      var updates = {
        name: document.getElementById('edit-name').value.trim(),
        category: document.getElementById('edit-category').value,
        brand: document.getElementById('edit-brand').value.trim(),
        color: document.getElementById('edit-color').value.trim(),
        size: document.getElementById('edit-size').value.trim(),
        sellPrice: Number(document.getElementById('edit-price').value) || 0,
        price: Number(document.getElementById('edit-price').value) || 0,
        lowStockAlert: Number(document.getElementById('edit-alert').value) || 5,
      };
      // 只有可看進貨價的角色才能修改
      if (InvAuth.canSeeCost()) {
        updates.costPrice = Number(document.getElementById('edit-cost').value) || 0;
      }
      if (_editImageDataUrl) updates.image = _editImageDataUrl;
      if (!updates.name) { InvApp.showToast('品名不可為空'); return; }
      try {
        if (newBarcode !== barcode) {
          // 編號變更：用 transaction 確保原子性（create + delete 不可分割）
          var newRef = InvStore.col('products').doc(newBarcode);
          var oldRef = InvStore.col('products').doc(barcode);
          await db.runTransaction(async function(transaction) {
            var existingNew = await transaction.get(newRef);
            if (existingNew.exists) throw new Error('此編號已被其他商品使用');
            var oldDoc = await transaction.get(oldRef);
            if (!oldDoc.exists) throw new Error('原商品不存在');
            var fullData = Object.assign({}, oldDoc.data(), updates, { barcode: newBarcode });
            delete fullData.updatedAt;
            fullData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
            transaction.set(newRef, fullData);
            transaction.delete(oldRef);
          });
          // 更新本地快取
          var idx = self._cache.findIndex(function(p) { return p.barcode === barcode; });
          if (idx !== -1) {
            Object.assign(self._cache[idx], updates, { barcode: newBarcode, id: newBarcode });
          }
          InvUtils.writeLog('product_barcode_rename', updates.name + ' ' + barcode + ' → ' + newBarcode);
          InvApp.showToast('商品已更新（編號已變更）');
          overlay.remove();
          self.renderDetail(newBarcode);
        } else {
          await self.update(barcode, updates);
          InvUtils.writeLog('product_edit', updates.name + ' (' + barcode + ')');
          overlay.remove();
          self.renderDetail(barcode);
        }
      } catch (err) {
        console.error('[InvProducts] edit save failed:', err);
        InvApp.showToast('儲存失敗：' + (err.message || '未知錯誤'));
      }
    });
  },

  /** 產生群組下拉選項 HTML */
  _buildGroupOptions(current) {
    var tabs = this.GROUP_TABS;
    var html = '';
    for (var i = 0; i < tabs.length; i++) {
      html += '<option value="' + InvApp.escapeHTML(tabs[i]) + '"' + (current === tabs[i] ? ' selected' : '') + '>' + InvApp.escapeHTML(tabs[i]) + '</option>';
    }
    return html;
  },

  /** 變更商品群組（寫 Firestore + 更新快取） */
  async _changeProductGroup(barcode, newGroup) {
    try {
      await this.update(barcode, { group: newGroup });
      InvApp.showToast('已移至「' + InvApp.escapeHTML(newGroup) + '」');
      this._refreshProductList();
    } catch (e) {
      InvApp.showToast('分類變更失敗');
    }
  },

  /** 列表快速入庫彈窗 */
  _showQuickRestockPopup(barcode) {
    var p = this.getByBarcode(barcode);
    if (!p) { InvApp.showToast('找不到商品'); return; }
    var esc = InvApp.escapeHTML;
    var overlay = document.createElement('div');
    overlay.className = 'inv-overlay show';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.addEventListener('touchmove', function(e) { if (!e.target.closest('.inv-modal')) { e.preventDefault(); e.stopPropagation(); } }, { passive: false });
    overlay.innerHTML =
      '<div class="inv-modal" style="max-width:320px;width:85%">' +
        '<h3 style="margin:0 0 4px;font-size:16px">' + esc(p.name) + '</h3>' +
        '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">目前庫存：<b>' + (p.stock || 0) + '</b></div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
          '<button id="qr-pop-minus" style="width:36px;height:36px;border:1px solid var(--border);border-radius:8px;background:var(--bg-elevated);font-size:18px;cursor:pointer">−</button>' +
          '<input id="qr-pop-qty" type="number" inputmode="numeric" value="1" min="1" style="flex:1;text-align:center;font-size:22px;font-weight:700;border:1px solid var(--border);border-radius:8px;padding:6px;height:40px;box-sizing:border-box" />' +
          '<button id="qr-pop-plus" style="width:36px;height:36px;border:1px solid var(--border);border-radius:8px;background:var(--bg-elevated);font-size:18px;cursor:pointer">+</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:12px">' +
          '<button class="qr-pop-pre" data-v="5" style="flex:1;padding:5px;border:1px solid var(--accent);border-radius:6px;background:var(--bg-card);color:var(--accent);font-size:13px;cursor:pointer">+5</button>' +
          '<button class="qr-pop-pre" data-v="10" style="flex:1;padding:5px;border:1px solid var(--accent);border-radius:6px;background:var(--bg-card);color:var(--accent);font-size:13px;cursor:pointer">+10</button>' +
          '<button class="qr-pop-pre" data-v="20" style="flex:1;padding:5px;border:1px solid var(--accent);border-radius:6px;background:var(--bg-card);color:var(--accent);font-size:13px;cursor:pointer">+20</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="qr-pop-cancel" class="inv-btn outline full">取消</button>' +
          '<button id="qr-pop-ok" class="inv-btn primary full">確認入庫</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    var qi = document.getElementById('qr-pop-qty');
    document.getElementById('qr-pop-minus').addEventListener('click', function() { qi.value = Math.max(1, (Number(qi.value) || 1) - 1); });
    document.getElementById('qr-pop-plus').addEventListener('click', function() { qi.value = (Number(qi.value) || 0) + 1; });
    overlay.querySelectorAll('.qr-pop-pre').forEach(function(b) {
      b.addEventListener('click', function() { qi.value = Number(this.getAttribute('data-v')); });
    });
    document.getElementById('qr-pop-cancel').addEventListener('click', function() { overlay.remove(); });
    var self = this;
    document.getElementById('qr-pop-ok').addEventListener('click', async function() {
      var qty = parseInt(qi.value, 10);
      if (!qty || qty < 1) { InvApp.showToast('請輸入有效數量'); return; }
      this.disabled = true; this.textContent = '處理中...';
      try {
        var result = await InvProducts.adjustStock(barcode, qty, {
          type: 'in', note: '快速補貨', uid: InvAuth.getUid() || '',
          operatorName: InvAuth.getName() || '',
        });
        overlay.remove();
        InvApp.showToast(esc(p.name) + ' 入庫 +' + qty + '，庫存 ' + result.afterStock);
        self._refreshProductList();
      } catch (e) {
        InvApp.showToast('入庫失敗：' + (e.message || ''));
        this.disabled = false; this.textContent = '確認入庫';
      }
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
