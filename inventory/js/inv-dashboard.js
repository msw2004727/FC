/**
 * inv-dashboard.js
 * 儀表板 — 即時統計、庫存健康、低庫存警示
 */
const InvDashboard = {
  _todayTxCache: null,

  /** 渲染儀表板到 #inv-dashboard-content */
  async render() {
    var container = document.getElementById('inv-dashboard-content');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">載入中...</div>';

    // 確保商品快取已載入
    if (!InvProducts._cache.length) {
      await InvProducts.loadAll();
    }

    // 清除今日快取（每次 render 重新查詢）
    this._todayTxCache = null;

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

    var stats = [
      { label: '今日銷售額', value: InvApp.formatCurrency(todaySales), color: '#0d9488' },
      { label: '今日筆數', value: todayCount + ' 筆', color: '#2563eb' },
      { label: '今日毛利', value: InvApp.formatCurrency(todayProfit), color: todayProfit >= 0 ? '#16a34a' : '#dc2626' },
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
    var html =
      '<div style="padding:16px;">' +
        '<h4 style="margin:0 0 10px;font-size:15px;color:#334155;">即時狀態</h4>' +
        this._renderStatCards(stats) +
        '<h4 style="margin:20px 0 10px;font-size:15px;color:#334155;">庫存健康</h4>' +
        this._renderQuickStats(quickStats) +
        '<h4 style="margin:20px 0 10px;font-size:15px;color:#334155;">低庫存警示</h4>' +
        this._renderLowStockAlerts(allAlertList) +
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
      var snap = await db.collection('inv_transactions')
        .where('createdAt', '>=', ts)
        .get();
      this._todayTxCache = snap.docs.map(function (doc) {
        return Object.assign({ id: doc.id }, doc.data());
      });
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
      return '<div style="text-align:center;padding:20px;color:#16a34a;font-size:14px;' +
        'background:#f0fdf4;border-radius:12px;">' +
        '目前沒有低庫存商品 \u2713</div>';
    }

    var html = '';
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var alert = p.lowStockAlert || 5;
      var stock = p.stock || 0;
      var bgColor = stock === 0 ? '#fef2f2' : '#fff7ed';
      var borderColor = stock === 0 ? '#fca5a5' : '#fdba74';

      html +=
        '<div data-low-barcode="' + InvApp.escapeHTML(p.barcode) + '" ' +
          'style="display:flex;align-items:center;justify-content:space-between;padding:12px;' +
          'background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:10px;' +
          'margin-bottom:8px;cursor:pointer;">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-weight:600;font-size:14px;">' + InvApp.escapeHTML(p.name) + '</div>' +
            '<div style="font-size:12px;color:#64748b;margin-top:2px;">警示門檻: ' + alert + '</div>' +
          '</div>' +
          '<div style="background:' + (stock === 0 ? '#dc2626' : '#f97316') + ';color:#fff;' +
            'padding:4px 10px;border-radius:12px;font-size:13px;font-weight:600;white-space:nowrap;">' +
            '庫存 ' + stock + '</div>' +
        '</div>';
    }
    return html;
  },

  /** 產生庫存健康區 HTML */
  _renderQuickStats(data) {
    var items = [
      { label: '總 SKU 數', value: data.totalSKU, color: '#334155' },
      { label: '總庫存件數', value: data.totalStock, color: '#0d9488' },
      { label: '庫存總成本', value: InvApp.formatCurrency(data.totalCost), color: '#2563eb' },
      { label: '低庫存商品', value: data.lowCount, color: data.lowCount > 0 ? '#f97316' : '#16a34a' },
      { label: '零庫存商品', value: data.zeroCount, color: data.zeroCount > 0 ? '#dc2626' : '#16a34a' }
    ];

    var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      html +=
        '<div style="background:#fff;border-radius:10px;padding:12px;' +
          'box-shadow:0 1px 3px rgba(0,0,0,.08);">' +
          '<div style="font-size:12px;color:#64748b;">' + InvApp.escapeHTML(it.label) + '</div>' +
          '<div style="font-size:18px;font-weight:700;color:' + it.color + ';margin-top:4px;">' +
            InvApp.escapeHTML(String(it.value)) + '</div>' +
        '</div>';
    }
    html += '</div>';
    return html;
  }
};
