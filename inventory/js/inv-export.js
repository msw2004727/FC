/**
 * inv-export.js
 * CSV 匯出（銷售紀錄 + 庫存清單）+ 銷售統計（日/週/月報）
 */
const InvExport = {

  // ══════ CSV 匯出 ══════

  _typeMap: { out: '銷售', sale: '銷售', in: '入庫', return: '退貨',
    scrap: '報廢', adjust: '調整', void: '作廢', gift: '贈品' },

  _pad: function (n) { return String(n).padStart(2, '0'); },
  _fmtD: function (dt) { var p = InvExport._pad; return dt.getFullYear() + p(dt.getMonth() + 1) + p(dt.getDate()); },
  _toDate: function (v) {
    if (!v) return null;
    return v.toDate ? v.toDate() : new Date(v);
  },

  /** 匯出銷售紀錄 CSV */
  exportTransactions(transactions) {
    var cc = typeof InvAuth !== 'undefined' && InvAuth.canSeeCost();
    var rows = [cc ? '交易日期,類型,收據號,商品名稱,條碼,數量,單價,成本價,優惠金額,實收金額,毛利,收款方式,操作人' : '交易日期,類型,收據號,商品名稱,條碼,數量,單價,優惠金額,實收金額,收款方式,操作人'];
    var dMin = null, dMax = null;
    for (var i = 0; i < transactions.length; i++) {
      var tx = transactions[i];
      var d = this._toDate(tx.createdAt);
      if (d && !isNaN(d.getTime())) {
        if (!dMin || d < dMin) dMin = d;
        if (!dMax || d > dMax) dMax = d;
      }
      var qty = Math.abs(Number(tx.quantity) || Number(tx.delta) || 0);
      var up = Number(tx.unitPrice) || 0, cp = Number(tx.costPrice) || 0;
      var total = Number(tx.totalAmount) || 0;
      var disc = Math.max(qty * up - total, 0);
      var row = [d ? InvApp.formatDate(d) : '', this._typeMap[tx.type] || tx.type || '',
        tx.receiptNo || '', tx.productName || tx.name || '', tx.barcode || '', qty, up];
      if (cc) row.push(cp, disc, total, total - cp * qty);
      else row.push(disc, total);
      row.push(tx.paymentMethod || '', tx.operatorName || '');
      rows.push(row.map(this._escapeCSV).join(','));
    }
    var now = new Date();
    var from = dMin ? this._fmtD(dMin) : this._fmtD(now);
    var to = dMax ? this._fmtD(dMax) : this._fmtD(now);
    this._downloadCSV(rows.join('\n'), '銷售紀錄_' + from + '-' + to + '.csv');
  },

  /** 匯出庫存清單 CSV */
  exportProducts() {
    var products = InvProducts._cache || [];
    var cc2 = typeof InvAuth !== 'undefined' && InvAuth.canSeeCost();
    var rows = [cc2 ? '條碼,商品名稱,品牌,分類,顏色,尺寸,進貨成本,售價,目前庫存,庫存成本小計,低庫存門檻,建檔日期' : '條碼,商品名稱,品牌,分類,顏色,尺寸,售價,目前庫存,低庫存門檻,建檔日期'];
    for (var i = 0; i < products.length; i++) {
      var p = products[i], stk = Number(p.stock) || 0, cp = Number(p.costPrice) || 0;
      var ca = this._toDate(p.createdAt);
      var row2 = [p.barcode || '', p.name || '', p.brand || '', p.category || '', p.color || '', p.size || ''];
      if (cc2) row2.push(cp, Number(p.price) || 0, stk, cp * stk, p.lowStockAlert || 5);
      else row2.push(Number(p.price) || 0, stk, p.lowStockAlert || 5);
      row2.push(ca ? InvApp.formatDate(ca) : '');
      rows.push(row2.map(this._escapeCSV).join(','));
    }
    this._downloadCSV(rows.join('\n'), '庫存清單_' + this._fmtD(new Date()) + '.csv');
  },

  /** 建立 Blob（UTF-8 BOM）→ 觸發下載 → revoke */
  _downloadCSV(content, filename) {
    var blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /** CSV 特殊字元處理 */
  _escapeCSV(value) {
    var s = String(value == null ? '' : value);
    return (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1)
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  },

  // ══════ 銷售統計 ══════

  /** 渲染統計到指定容器 */
  async renderStats(containerId) {
    var c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">統計載入中...</div>';
    try {
      var h = '<div style="padding:16px;">' +
        '<h4 style="margin:0 0 10px;font-size:15px;color:var(--text-primary);">今日報表</h4>' + await this._renderDailyReport() +
        '<h4 style="margin:20px 0 10px;font-size:15px;color:var(--text-primary);">本週銷售趨勢</h4>' + await this._renderWeeklyChart() +
        '<h4 style="margin:20px 0 10px;font-size:15px;color:var(--text-primary);">本月摘要</h4>' + await this._renderMonthlySummary() +
        '</div>';
      c.innerHTML = h;
    } catch (e) {
      console.error('[InvExport] renderStats failed:', e);
      c.innerHTML = '<div style="text-align:center;padding:24px;color:var(--danger);">統計載入失敗</div>';
    }
  },

  /** 日報：今日各類型交易筆數 + 金額 */
  async _renderDailyReport() {
    var now = new Date();
    var ts = firebase.firestore.Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    var snap = await InvStore.col('transactions').where('createdAt', '>=', ts).get();
    var groups = {};
    snap.docs.forEach(function (doc) {
      var t = doc.data(), label = InvExport._typeMap[t.type] || t.type || '其他';
      if (!groups[label]) groups[label] = { count: 0, amount: 0 };
      groups[label].count++;
      groups[label].amount += Number(t.totalAmount) || 0;
    });
    var keys = Object.keys(groups);
    if (!keys.length) return '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:14px;">今日尚無交易</div>';
    var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j], g = groups[k];
      html += '<div style="background:var(--bg-card);border-radius:10px;padding:12px;box-shadow:var(--shadow);">' +
        '<div style="font-size:12px;color:var(--text-secondary);">' + InvApp.escapeHTML(k) + '</div>' +
        '<div style="font-size:16px;font-weight:700;color:var(--text-primary);">' + g.count + ' 筆</div>' +
        '<div style="font-size:13px;color:var(--accent);">' + InvApp.formatCurrency(g.amount) + '</div></div>';
    }
    return html + '</div>';
  },

  /** 本週趨勢：最近 7 天每日銷售額條形圖 */
  async _renderWeeklyChart() {
    var data = await this._getWeeklyData(), max = 1;
    for (var i = 0; i < data.length; i++) if (data[i].amount > max) max = data[i].amount;
    var html = '<div style="background:var(--bg-card);border-radius:12px;padding:14px;box-shadow:var(--shadow);">';
    for (var j = 0; j < data.length; j++) {
      var d = data[j], pct = Math.round((d.amount / max) * 100);
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:13px;">' +
        '<div style="width:42px;color:var(--text-secondary);text-align:right;">' + d.label + '</div>' +
        '<div style="flex:1;background:var(--bg-elevated);border-radius:4px;height:20px;overflow:hidden;">' +
        '<div style="width:' + pct + '%;height:100%;background:var(--accent);border-radius:4px;' +
        'min-width:' + (d.amount > 0 ? '2px' : '0') + ';"></div></div>' +
        '<div style="width:80px;text-align:right;color:var(--text-primary);font-weight:600;">' +
        InvApp.formatCurrency(d.amount) + '</div></div>';
    }
    return html + '</div>';
  },

  /** 本月摘要：總銷售 / 成本 / 毛利率 / TOP5 / 滯銷 */
  async _renderMonthlySummary() {
    var now = new Date();
    var ts = firebase.firestore.Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), 1));
    var snap = await InvStore.col('transactions')
      .where('type', '==', 'out').where('createdAt', '>=', ts).get();
    var txList = snap.docs.map(function (doc) { return doc.data(); });

    var totalSales = 0, totalCost = 0, barcodeMap = {};
    for (var i = 0; i < txList.length; i++) {
      var t = txList[i];
      totalSales += Number(t.totalAmount) || 0;
      var qty = Math.abs(Number(t.quantity) || Number(t.delta) || 0);
      totalCost += (Number(t.costPrice) || 0) * qty;
      var bc = t.barcode || '';
      if (bc) {
        if (!barcodeMap[bc]) barcodeMap[bc] = { name: t.productName || t.name || bc, qty: 0 };
        barcodeMap[bc].qty += qty;
      }
    }
    var gm = totalSales > 0 ? ((totalSales - totalCost) / totalSales * 100).toFixed(1) : '0.0';
    var cc3 = typeof InvAuth !== 'undefined' && InvAuth.canSeeCost();
    var html = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">' +
      this._statBox('總銷售額', InvApp.formatCurrency(totalSales), '#0d9488') +
      this._statBox('總成本', cc3 ? InvApp.formatCurrency(totalCost) : '***', '#2563eb') +
      this._statBox('毛利率', cc3 ? gm + '%' : '***', Number(gm) >= 0 ? '#16a34a' : '#dc2626') + '</div>';

    // 熱銷 TOP 5
    var top5 = Object.values(barcodeMap).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 5);
    html += '<div style="font-size:13px;color:var(--text-secondary);margin:12px 0 6px;">熱銷 TOP 5</div>';
    if (!top5.length) {
      html += '<div style="padding:8px;color:var(--text-muted);font-size:13px;">本月尚無銷售紀錄</div>';
    } else {
      for (var j = 0; j < top5.length; j++) {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;' +
          'background:var(--bg-card);border-radius:8px;margin-bottom:4px;font-size:14px;box-shadow:var(--shadow-sm);">' +
          '<span style="color:var(--text-primary);"><b>' + (j + 1) + '.</b> ' + InvApp.escapeHTML(top5[j].name) + '</span>' +
          '<span style="color:var(--accent);font-weight:600;">' + top5[j].qty + ' 件</span></div>';
      }
    }
    // 滯銷提醒
    var stale = this._getStaleProducts();
    html += '<div style="font-size:13px;color:var(--text-secondary);margin:16px 0 6px;">滯銷提醒（30 天未異動）</div>';
    if (!stale.length) {
      html += '<div style="padding:8px;color:var(--success);font-size:13px;">目前無滯銷商品</div>';
    } else {
      for (var k = 0; k < stale.length; k++) {
        html += '<div style="display:flex;justify-content:space-between;padding:8px 12px;' +
          'background:var(--warning-light);border:1px solid var(--warning);border-radius:8px;margin-bottom:4px;font-size:13px;">' +
          '<span>' + InvApp.escapeHTML(stale[k].name) + '</span>' +
          '<span style="color:var(--warning);">庫存 ' + (stale[k].stock || 0) + '</span></div>';
      }
    }
    return html;
  },

  _statBox(label, value, color) {
    return '<div style="background:var(--bg-card);border-radius:10px;padding:12px;text-align:center;' +
      'box-shadow:var(--shadow);">' +
      '<div style="font-size:11px;color:var(--text-secondary);">' + InvApp.escapeHTML(label) + '</div>' +
      '<div style="font-size:16px;font-weight:700;color:' + color + ';margin-top:4px;">' +
      InvApp.escapeHTML(String(value)) + '</div></div>';
  },

  /** 查最近 7 天 inv_transactions(type='out')，按日期分組統計 */
  async _getWeeklyData() {
    var now = new Date(), p = this._pad;
    var weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    var snap = await InvStore.col('transactions')
      .where('type', '==', 'out')
      .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(weekAgo)).get();
    var dayMap = {}, result = [];
    for (var d = 0; d < 7; d++) {
      var dt = new Date(weekAgo.getTime() + d * 86400000);
      var key = p(dt.getMonth() + 1) + '/' + p(dt.getDate());
      dayMap[key] = 0; result.push({ label: key, amount: 0 });
    }
    snap.docs.forEach(function (doc) {
      var data = doc.data(), cr = InvExport._toDate(data.createdAt);
      if (!cr) return;
      var key = p(cr.getMonth() + 1) + '/' + p(cr.getDate());
      if (key in dayMap) dayMap[key] += Number(data.totalAmount) || 0;
    });
    for (var i = 0; i < result.length; i++) result[i].amount = dayMap[result[i].label] || 0;
    return result;
  },

  /** 查本月 inv_transactions(type='out')，按 barcode 分組取 TOP 5 */
  async _getMonthlyTopSellers() {
    var now = new Date();
    var snap = await InvStore.col('transactions').where('type', '==', 'out')
      .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(
        new Date(now.getFullYear(), now.getMonth(), 1))).get();
    var map = {};
    snap.docs.forEach(function (doc) {
      var data = doc.data(), bc = data.barcode || '';
      if (!bc) return;
      if (!map[bc]) map[bc] = { name: data.productName || data.name || bc, qty: 0 };
      map[bc].qty += Math.abs(Number(data.quantity) || Number(data.delta) || 0);
    });
    return Object.values(map).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 5);
  },

  /** 從 InvProducts._cache 找出 updatedAt 超過 30 天的商品 */
  _getStaleProducts() {
    var threshold = Date.now() - 30 * 86400000;
    return (InvProducts._cache || []).filter(function (p) {
      if ((Number(p.stock) || 0) <= 0) return false;
      var dt = InvExport._toDate(p.updatedAt) || InvExport._toDate(p.createdAt);
      return dt ? dt.getTime() < threshold : false;
    });
  },
};
