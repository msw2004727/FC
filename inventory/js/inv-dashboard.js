/**
 * inv-dashboard.js
 * 儀表板 — 即時統計、庫存健康、低庫存警示
 */
const InvDashboard = {
  _todayTxCache: null,
  _todayTxCacheTime: 0,
  _CACHE_TTL: 30000,

  /** 渲染儀表板到 #inv-dashboard-content */
  async render() {
    var container = document.getElementById('inv-dashboard-content');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">載入中...</div>';

    // 確保商品快取已載入
    if (!InvProducts._cache.length) {
      await InvProducts.loadAll();
    }

    // 30 秒內重複 render 使用快取，避免每次切頁都重查 Firestore
    var now = Date.now();
    if (!this._todayTxCache || (now - this._todayTxCacheTime) > this._CACHE_TTL) {
      this._todayTxCache = null;
    }

    var txList = await this._getTodayTransactions();
    var products = InvProducts._cache;

    // --- 1. 即時狀態 ---
    var saleTx = txList.filter(function (t) { return t.type === 'out' || t.type === 'sale'; });
    var returnTx = txList.filter(function (t) { return t.type === 'return'; });

    var todaySales = saleTx.reduce(function (s, t) { return s + (Number(t.totalAmount) || 0); }, 0);
    var todayCount = saleTx.length;
    var todayCost = saleTx.reduce(function (s, t) {
      return s + (Number(t.costPrice) || 0) * Math.abs(Number(t.quantity) || Number(t.delta) || 0);
    }, 0);
    var todayProfit = todaySales - todayCost;
    var todayReturn = returnTx.reduce(function (s, t) { return s + (Number(t.totalAmount) || 0); }, 0);

    var canCost = typeof InvAuth !== 'undefined' && InvAuth.canSeeCost();
    var stats = [
      { label: '今日銷售額', value: InvApp.formatCurrency(todaySales), color: '#0d9488' },
      { label: '今日筆數', value: todayCount + ' 筆', color: '#2563eb' },
      { label: '今日毛利', value: canCost ? InvApp.formatCurrency(todayProfit) : '***', color: todayProfit >= 0 ? '#16a34a' : '#dc2626' },
      { label: '今日退貨額', value: InvApp.formatCurrency(todayReturn), color: '#f59e0b' }
    ];

    // --- 2. 庫存健康 ---
    var totalSKU = products.length;
    var totalStock = products.reduce(function (s, p) { return s + (Number(p.stock) || 0); }, 0);
    var totalCost = products.reduce(function (s, p) {
      return s + (Number(p.costPrice) || 0) * (Number(p.stock) || 0);
    }, 0);
    var lowStockList = products.filter(function (p) {
      var alert = p.lowStockAlert || 5;
      return (p.stock || 0) <= alert && (p.stock || 0) > 0;
    });
    var zeroStockList = products.filter(function (p) { return (p.stock || 0) === 0; });
    var allAlertList = products.filter(function (p) {
      var alert = p.lowStockAlert || 5;
      return (p.stock || 0) <= alert;
    });

    var quickStats = {
      totalSKU: totalSKU,
      totalStock: totalStock,
      totalCost: totalCost,
      lowCount: lowStockList.length,
      zeroCount: zeroStockList.length
    };

    // --- 組裝 HTML ---
    var ib = function(key) { return '<button class="inv-info-btn" onclick="InvDashboard._showInfo(\'' + key + '\')">?</button>'; };
    var _hp = typeof InvAuth !== 'undefined' && InvAuth.hasPerm ? InvAuth.hasPerm.bind(InvAuth) : function() { return true; };
    var lowStockHtml = '';
    if (_hp('dashboard.low_stock')) {
      lowStockHtml = '<h4 class="inv-section-head">低庫存警示' + ib('lowstock') + '</h4>' +
        this._renderLowStockAlerts(allAlertList);
    }
    var html =
      '<div style="padding:16px;">' +
        '<h4 class="inv-section-head">即時狀態' + ib('realtime') + '</h4>' +
        this._renderStatCards(stats) +
        '<h4 class="inv-section-head">庫存健康' + ib('health') + '</h4>' +
        this._renderQuickStats(quickStats) +
        lowStockHtml +
      '</div>';

    container.innerHTML = html;

    // 綁定低庫存卡片點擊
    var cards = container.querySelectorAll('[data-low-barcode]');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function () {
        var bc = this.getAttribute('data-low-barcode');
        InvApp.showPage('page-product-detail');
        InvProducts.renderDetail(bc);
      });
    }
  },

  /** 查詢今日的 inv_transactions（快取結果） */
  async _getTodayTransactions() {
    if (this._todayTxCache) return this._todayTxCache;

    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    var ts = firebase.firestore.Timestamp.fromDate(todayStart);

    try {
      var snap = await InvStore.col('transactions')
        .where('createdAt', '>=', ts)
        .get();
      this._todayTxCache = snap.docs.map(function (doc) {
        return Object.assign({ id: doc.id }, doc.data());
      });
      this._todayTxCacheTime = Date.now();
    } catch (e) {
      console.error('[InvDashboard] _getTodayTransactions failed:', e);
      this._todayTxCache = [];
    }
    return this._todayTxCache;
  },

  /** 產生 2x2 grid 統計卡片 HTML */
  _renderStatCards(stats) {
    var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
    for (var i = 0; i < stats.length; i++) {
      var s = stats[i];
      html +=
        '<div class="inv-stat-card">' +
          '<div class="inv-stat-label">' + InvApp.escapeHTML(s.label) + '</div>' +
          '<div class="inv-stat-value" style="color:' + s.color + '">' +
            InvApp.escapeHTML(s.value) + '</div>' +
        '</div>';
    }
    html += '</div>';
    return html;
  },

  /** 產生低庫存警示列表 HTML */
  _renderLowStockAlerts(products) {
    if (!products.length) {
      return '<div style="text-align:center;padding:12px;color:var(--success);font-size:13px;' +
        'background:var(--success-light);border-radius:var(--radius-sm);">' +
        '目前沒有低庫存商品 ✓</div>';
    }
    var esc = InvApp.escapeHTML;
    var html = '<div style="display:flex;flex-direction:column;gap:4px">';
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var al = p.lowStockAlert || 5;
      var stock = p.stock || 0;
      var isZero = stock === 0;
      var stockBg = isZero ? 'var(--danger)' : 'var(--warning)';
      var rowBg = isZero ? 'var(--danger-light)' : 'var(--warning-light)';
      var thumb = p.image || p.imageUrl || '';
      var thumbHtml = thumb
        ? '<img src="' + esc(thumb) + '" style="width:32px;height:32px;object-fit:cover;border-radius:6px;flex-shrink:0">'
        : '<div style="width:32px;height:32px;border-radius:6px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;color:var(--text-muted)">📦</div>';
      html +=
        '<div data-low-barcode="' + esc(p.barcode) + '" ' +
          'style="display:flex;align-items:center;gap:8px;padding:6px 8px;' +
          'background:' + rowBg + ';border-radius:var(--radius-sm);cursor:pointer">' +
          thumbHtml +
          '<span style="flex:1;min-width:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.name) + '</span>' +
          '<span style="font-size:11px;color:var(--text-muted);flex-shrink:0">/' + al + '</span>' +
          '<span style="background:' + stockBg + ';color:#fff;padding:1px 7px;border-radius:var(--radius-full);font-size:11px;font-weight:700;flex-shrink:0">' + stock + '</span>' +
        '</div>';
    }
    html += '</div>';
    return html;
  },

  /** 產生庫存健康區 HTML */
  _renderQuickStats(data) {
    var items = [
      { label: '總 SKU 數', value: data.totalSKU, color: '#334155' },
      { label: '總庫存件數', value: data.totalStock, color: '#0d9488' },
      { label: '庫存總成本', value: (typeof InvAuth !== 'undefined' && InvAuth.canSeeCost()) ? InvApp.formatCurrency(data.totalCost) : '***', color: '#2563eb' },
      { label: '低庫存商品', value: data.lowCount, color: data.lowCount > 0 ? '#f97316' : '#16a34a' },
      { label: '零庫存商品', value: data.zeroCount, color: data.zeroCount > 0 ? '#dc2626' : '#16a34a' }
    ];

    var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      html +=
        '<div style="background:var(--bg-card);border-radius:10px;padding:12px;' +
          'box-shadow:var(--shadow);">' +
          '<div style="font-size:12px;color:var(--text-secondary);">' + InvApp.escapeHTML(it.label) + '</div>' +
          '<div style="font-size:18px;font-weight:700;color:' + it.color + ';margin-top:4px;">' +
            InvApp.escapeHTML(String(it.value)) + '</div>' +
        '</div>';
    }
    html += '</div>';
    return html;
  },

  _showInfo(key) {
    var info = {
      realtime: {
        title: '即時狀態說明',
        body: '<p>顯示今日（00:00 起）的營運數據：</p>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>今日銷售額</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">所有銷售交易的實收金額加總（不含退貨）</p></div>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>今日筆數</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">今日完成的銷售交易數量</p></div>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>今日毛利</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">銷售額 - 成本（進貨價 × 數量）</p></div>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>今日退貨</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">今日退貨交易的退款金額加總</p></div>',
      },
      health: {
        title: '庫存健康說明',
        body: '<p>顯示目前所有商品的庫存狀態：</p>'
          + '<ul style="padding-left:20px;font-size:14px;line-height:1.8">'
          + '<li><b>總 SKU</b> — 系統內的商品種類數</li>'
          + '<li><b>總庫存</b> — 所有商品的庫存數量加總</li>'
          + '<li><b>庫存成本</b> — 進貨價 × 庫存量的加總</li>'
          + '<li><b>低庫存</b> — 庫存量 ≤ 警示門檻但 > 0 的商品數</li>'
          + '<li><b>零庫存</b> — 庫存量 = 0 的商品數</li></ul>',
      },
      lowstock: {
        title: '低庫存警示說明',
        body: '<p>列出庫存量低於警示門檻的商品。</p>'
          + '<p style="margin-top:8px">每個商品可在<b>商品詳情</b>中設定「低庫存門檻」（預設 5 件）。'
          + '當庫存量 ≤ 門檻時會出現在此列表，提醒您及時補貨。</p>'
          + '<p style="margin-top:8px;font-size:13px;color:var(--text-muted)">點擊警示卡片可直接跳到商品詳情頁。</p>',
      },
    };
    var item = info[key];
    if (!item) return;
    var overlay = document.createElement('div');
    overlay.className = 'inv-overlay show';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="inv-modal">'
      + '<div style="font-size:17px;font-weight:700;text-align:center;margin-bottom:12px">' + item.title + '</div>'
      + '<div style="font-size:14px;color:var(--text-secondary);line-height:1.7">' + item.body + '</div>'
      + '<button class="inv-btn primary full" style="margin-top:16px" onclick="this.closest(\'.inv-overlay\').remove()">了解</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },
};
