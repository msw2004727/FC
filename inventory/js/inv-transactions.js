/**
 * inv-transactions.js
 * 交易紀錄列表 — 日期篩選 + 類型篩選 + 統計摘要
 */
const InvTransactions = {
  _list: [],
  _startDate: '',
  _endDate: '',
  _type: 'all',

  /** 渲染到 #inv-transactions-content */
  async render() {
    var container = document.getElementById('inv-transactions-content');
    if (!container) return;

    // 預設本月起迄
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    if (!this._startDate) {
      this._startDate = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-01';
    }
    if (!this._endDate) {
      this._endDate = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    }

    var esc = InvApp.escapeHTML;
    var types = [
      { key: 'all', label: '全部' }, { key: 'out', label: '銷售' },
      { key: 'in', label: '入庫' }, { key: 'return', label: '退貨' },
      { key: 'waste', label: '報廢' }, { key: 'adjust', label: '調整' },
    ];

    var html =
      '<div style="padding:12px 16px;">' +
        /* --- 1. 日期篩選 --- */
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;max-width:100%;overflow:hidden">' +
          '<input type="date" class="inv-input" value="' + esc(this._startDate) + '" ' +
            'onchange="InvTransactions._startDate=this.value;InvTransactions._reload()" ' +
            'style="flex:1;min-width:0;height:34px;font-size:12px;padding:4px 6px" />' +
          '<span style="color:var(--text-muted);flex-shrink:0;font-size:12px">~</span>' +
          '<input type="date" class="inv-input" value="' + esc(this._endDate) + '" ' +
            'onchange="InvTransactions._endDate=this.value;InvTransactions._reload()" ' +
            'style="flex:1;min-width:0;height:34px;font-size:12px;padding:4px 6px" />' +
        '</div>' +
        /* --- 2. 類型 tabs --- */
        '<div style="display:flex;gap:5px;flex-wrap:wrap;padding-bottom:8px;">';
    for (var i = 0; i < types.length; i++) {
      var t = types[i];
      var active = this._type === t.key;
      html += '<button onclick="InvTransactions._setType(\'' + t.key + '\')" ' +
        'style="padding:4px 10px;border-radius:var(--radius-full);border:1px solid ' +
        (active ? 'var(--accent)' : 'var(--border)') + ';background:' +
        (active ? 'var(--accent)' : 'var(--bg-card)') + ';color:' +
        (active ? '#fff' : 'var(--text-muted)') + ';font-size:12px;cursor:pointer;">' +
        esc(t.label) + '</button>';
    }
    html += '</div>' +
        /* --- 3. 列表 + 4. 摘要 + 5. 匯出 --- */
        '<div id="inv-tx-list" style="margin-top:4px;">載入中...</div>' +
      '</div>';

    container.innerHTML = html;
    await this._reload();
  },

  /** 重新載入交易紀錄並渲染 */
  async _reload() {
    this._list = await this.loadTransactions(this._startDate, this._endDate, this._type);
    var wrap = document.getElementById('inv-tx-list');
    if (!wrap) return;
    wrap.innerHTML = this.renderList(this._list) + this.renderSummary(this._list) +
      '<button class="inv-btn outline full" onclick="InvTransactions._exportCSV()" ' +
        'style="margin:12px 0 24px;">匯出 CSV</button>';
    // 綁定展開詳情
    var cards = wrap.querySelectorAll('[data-tx-id]');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function () {
        var detail = this.querySelector('.inv-tx-detail');
        if (detail) detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
      });
    }
  },

  _setType: function (type) { this._type = type; this._reload(); },

  /**
   * 查詢 inv_transactions
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate   - YYYY-MM-DD
   * @param {string} type      - 'all' 或具體 type
   * @returns {Promise<Array>}
   */
  async loadTransactions(startDate, endDate, type) {
    try {
      var sd = new Date(startDate + 'T00:00:00');
      var ed = new Date(endDate + 'T00:00:00');
      ed.setDate(ed.getDate() + 1); // endDate + 1 day（含當天整天）

      var tsStart = firebase.firestore.Timestamp.fromDate(sd);
      var tsEnd = firebase.firestore.Timestamp.fromDate(ed);

      var q = db.collection('inv_transactions')
        .where('createdAt', '>=', tsStart)
        .where('createdAt', '<=', tsEnd)
        .orderBy('createdAt', 'desc')
        .limit(200);

      if (type && type !== 'all') {
        q = db.collection('inv_transactions')
          .where('type', '==', type)
          .where('createdAt', '>=', tsStart)
          .where('createdAt', '<=', tsEnd)
          .orderBy('createdAt', 'desc')
          .limit(200);
      }

      var snap = await q.get();
      return snap.docs.map(function (doc) {
        return Object.assign({ id: doc.id }, doc.data());
      });
    } catch (e) {
      console.error('[InvTransactions] loadTransactions failed:', e);
      InvApp.showToast('載入交易紀錄失敗');
      return [];
    }
  },

  /**
   * 渲染交易卡片列表
   * @param {Array} transactions
   * @returns {string} HTML
   */
  renderList: function (transactions) {
    if (!transactions.length) {
      return '<div style="text-align:center;padding:40px 0;color:var(--text-muted);font-size:14px;">' +
        '此期間無交易紀錄</div>';
    }
    var esc = InvApp.escapeHTML, html = '';
    for (var i = 0; i < transactions.length; i++) {
      var tx = transactions[i];
      var type = tx.type || 'out';
      var cls = this._getTypeClass(type);
      var icon = this._getTypeIcon(type);
      var label = this._getTypeLabel(type);
      var time = tx.createdAt ? InvApp.formatDate(tx.createdAt.toDate ? tx.createdAt.toDate() : tx.createdAt) : '';
      var qty = Math.abs(Number(tx.quantity) || Number(tx.delta) || 0);
      var amt = Number(tx.totalAmount) || Number(tx.unitPrice) * qty || 0;

      // 時間只取 MM/DD HH:MM 縮短
      var shortTime = time.length > 6 ? time.slice(5) : time;
      html +=
        '<div data-tx-id="' + esc(tx.id) + '" class="inv-tx-card ' + cls + '" style="cursor:pointer;padding:10px 12px;margin-bottom:6px">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<div style="font-size:18px;width:28px;text-align:center;flex-shrink:0">' + icon + '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(tx.productName || '未知商品') + '</div>' +
              '<div style="font-size:11px;color:var(--text-muted);margin-top:1px">' +
                esc(label) + ' x' + qty + ' · ' + esc(shortTime) + '</div>' +
            '</div>' +
            '<div style="font-weight:700;font-size:13px;white-space:nowrap;color:' +
              (type === 'return' || type === 'waste' ? 'var(--danger)' : 'var(--text-primary)') + '">' +
              (type === 'return' || type === 'waste' ? '-' : '') + InvApp.formatCurrency(amt) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="inv-tx-detail" style="display:none;background:var(--bg-elevated);border-radius:0 0 10px 10px;' +
          'padding:8px 12px;margin-top:-6px;margin-bottom:6px;font-size:11px;color:var(--text-muted)">' +
          (tx.receiptNo ? '<div>單號：' + esc(tx.receiptNo) + '</div>' : '') +
          (tx.paymentMethod ? '<div>付款：' + esc(tx.paymentMethod) + '</div>' : '') +
          (tx.operatorName ? '<div>操作人：' + esc(tx.operatorName) + '</div>' : '') +
          (tx.beforeStock != null ? '<div>庫存變化：' + tx.beforeStock + ' → ' + tx.afterStock + '</div>' : '') +
          (type === 'return' && tx.relatedReceiptNo ? '<div>原始單號：' + esc(tx.relatedReceiptNo) + '</div>' : '') +
        '</div>';
    }
    return html;
  },

  /**
   * 底部統計摘要
   * @param {Array} transactions
   * @returns {string} HTML
   */
  renderSummary: function (transactions) {
    var saleTotal = 0, saleCount = 0, returnTotal = 0, returnCount = 0;
    for (var i = 0; i < transactions.length; i++) {
      var tx = transactions[i];
      var amt = Number(tx.totalAmount) || 0;
      if (tx.type === 'out' || tx.type === 'sale') { saleTotal += amt; saleCount++; }
      if (tx.type === 'return') { returnTotal += amt; returnCount++; }
    }
    var net = saleTotal - returnTotal;
    return (
      '<div class="inv-card" style="margin-top:12px">' +
        '<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:8px">期間統計</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px">' +
          '<div>銷售 <b>' + saleCount + '</b> 筆</div>' +
          '<div style="text-align:right;color:var(--accent);font-weight:600;">' +
            InvApp.formatCurrency(saleTotal) + '</div>' +
          '<div>退貨 <b>' + returnCount + '</b> 筆</div>' +
          '<div style="text-align:right;color:var(--warning);font-weight:600;">-' +
            InvApp.formatCurrency(returnTotal) + '</div>' +
          '<div style="border-top:1px solid var(--border);padding-top:6px;">淨收入</div>' +
          '<div style="border-top:1px solid var(--border);padding-top:6px;text-align:right;' +
            'font-weight:700;color:' + (net >= 0 ? '#16a34a' : '#dc2626') + ';">' +
            InvApp.formatCurrency(net) + '</div>' +
        '</div>' +
      '</div>'
    );
  },

  // ── helpers ──────────────────────────────

  _getTypeIcon: function (type) {
    var map = { out: '\uD83D\uDCB0', in: '\uD83D\uDCE6', return: '\u21A9\uFE0F', waste: '\uD83D\uDDD1\uFE0F', adjust: '\uD83D\uDD27', void: '\u274C', gift: '\uD83C\uDF81' };
    return map[type] || '\uD83D\uDCB0';
  },

  _getTypeLabel: function (type) {
    var map = { out: '銷售', in: '入庫', return: '退貨', waste: '報廢', adjust: '調整', void: '作廢', gift: '贈品' };
    return map[type] || '銷售';
  },

  _getTypeClass: function (type) {
    var map = { out: 'inv-tx-sale', in: 'inv-tx-in', return: 'inv-tx-return', waste: 'inv-tx-waste', adjust: 'inv-tx-adjust', void: 'inv-tx-adjust', gift: 'inv-tx-gift' };
    return map[type] || 'inv-tx-sale';
  },

  /** 匯出 CSV */
  _exportCSV: function () {
    if (!this._list.length) { InvApp.showToast('沒有資料可匯出'); return; }
    var rows = [['時間', '類型', '商品', '數量', '金額', '單號', '付款方式', '操作人']];
    for (var i = 0; i < this._list.length; i++) {
      var tx = this._list[i];
      var time = tx.createdAt ? InvApp.formatDate(tx.createdAt.toDate ? tx.createdAt.toDate() : tx.createdAt) : '';
      var qty = Math.abs(Number(tx.quantity) || Number(tx.delta) || 0);
      var amt = Number(tx.totalAmount) || 0;
      rows.push([
        time, this._getTypeLabel(tx.type || 'out'),
        (tx.productName || '').replace(/,/g, '，'), qty, amt,
        tx.receiptNo || '', tx.paymentMethod || '', tx.operatorName || '',
      ]);
    }
    var csv = rows.map(function (r) { return r.join(','); }).join('\n');
    var bom = '\uFEFF';
    var blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'transactions_' + this._startDate + '_' + this._endDate + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    InvApp.showToast('CSV 已下載');
  },
};
