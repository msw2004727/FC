/**
 * inv-stocktake.js
 * 盤點模組 — 盤點單管理、掃碼盤點、差異報告、批次調整
 */
const InvStocktake = {
  _current: null,

  // ══════ 盤點單管理 ══════

  async render() {
    var container = document.getElementById('inv-stocktake-content');
    if (!container) return;
    try {
      var snap = await db.collection('inv_stocktakes').where('status', '==', 'in_progress').limit(1).get();
      if (!snap.empty) {
        this._current = Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
        this.renderStocktakeUI(container); return;
      }
    } catch (e) { console.error('[InvStocktake] check in_progress:', e); }
    container.innerHTML =
      '<div style="padding:16px;"><button id="btn-start-stocktake" style="width:100%;padding:14px;border:none;' +
      'border-radius:10px;background:#FF9800;color:#fff;font-size:16px;font-weight:600;cursor:pointer;' +
      'margin-bottom:16px;">開始盤點</button><h4 style="margin:0 0 8px;">歷史盤點單</h4>' +
      '<div id="stocktake-history" style="color:#999;font-size:14px;">載入中...</div></div>';
    document.getElementById('btn-start-stocktake').addEventListener('click', this._showScopeDialog.bind(this));
    this._loadHistory();
  },

  _showScopeDialog() {
    var esc = InvApp.escapeHTML, overlay = document.createElement('div');
    overlay.id = 'inv-stocktake-scope-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:5000;display:flex;' +
      'align-items:center;justify-content:center;background:rgba(0,0,0,.35);' +
      'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);';
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.15);' +
      'width:85%;max-width:360px;padding:20px;"><h3 style="margin:0 0 16px;">盤點範圍</h3>' +
      '<button class="st-scope" data-scope="all" style="width:100%;padding:12px;border:1px solid #FF9800;' +
      'border-radius:8px;background:#fff;color:#FF9800;font-size:15px;font-weight:600;cursor:pointer;' +
      'margin-bottom:8px;">全部商品</button><div id="st-cat-list" style="max-height:40vh;overflow-y:auto;"></div>' +
      '<button id="st-scope-cancel" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;' +
      'background:#fff;margin-top:12px;cursor:pointer;">取消</button></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('touchmove', function (e) {
      if (!e.target.closest('[style*="overflow-y"]')) { e.preventDefault(); e.stopPropagation(); }
    }, { passive: false });
    var cats = [], catHtml = '';
    InvProducts._cache.forEach(function (p) { if (p.category && cats.indexOf(p.category) === -1) cats.push(p.category); });
    for (var i = 0; i < cats.length; i++) {
      catHtml += '<button class="st-scope" data-scope="category" data-cat="' + esc(cats[i]) + '" style="width:100%;' +
        'padding:10px;border:1px solid #eee;border-radius:8px;background:#fff;font-size:14px;cursor:pointer;' +
        'margin-bottom:6px;text-align:left;">' + esc(cats[i]) + '</button>';
    }
    document.getElementById('st-cat-list').innerHTML = catHtml;
    var self = this, btns = overlay.querySelectorAll('.st-scope');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function () {
        overlay.remove();
        self.startStocktake(this.getAttribute('data-scope'), this.getAttribute('data-cat') || '');
      });
    }
    document.getElementById('st-scope-cancel').addEventListener('click', function () { overlay.remove(); });
  },

  async startStocktake(scope, scopeCategory) {
    var products = InvProducts._cache.slice();
    if (scope === 'category' && scopeCategory)
      products = products.filter(function (p) { return p.category === scopeCategory; });
    if (!products.length) { InvApp.showToast('該範圍無商品'); return; }
    var items = products.map(function (p) {
      return { barcode: p.barcode, productId: p.id, productName: p.name,
        systemStock: p.stock || 0, actualStock: null, confirmed: false };
    });
    var doc = { status: 'in_progress', scope: scope, scopeCategory: scopeCategory || '',
      items: items, createdAt: firebase.firestore.FieldValue.serverTimestamp(), uid: InvAuth.getUid() || '' };
    try {
      var ref = await db.collection('inv_stocktakes').add(doc);
      this._current = Object.assign({ id: ref.id }, doc);
      var c = document.getElementById('inv-stocktake-content');
      if (c) this.renderStocktakeUI(c);
    } catch (e) { console.error('[InvStocktake] startStocktake:', e); InvApp.showToast('建立盤點單失敗'); }
  },

  // ══════ 盤點操作介面 ══════

  renderStocktakeUI(container) {
    var st = this._current; if (!st) return;
    var items = st.items || [], esc = InvApp.escapeHTML;
    var confirmed = items.filter(function (it) { return it.confirmed; });
    var unconfirmed = items.filter(function (it) { return !it.confirmed; });
    var pct = items.length ? Math.round(confirmed.length / items.length * 100) : 0;
    var html = '<div style="padding:16px;">' +
      '<div style="text-align:center;margin-bottom:12px;font-size:15px;font-weight:600;color:#FF9800;">' +
      '盤點進度：' + confirmed.length + ' / ' + items.length + ' 品項</div>' +
      '<div style="background:#eee;border-radius:6px;height:8px;margin-bottom:16px;">' +
      '<div style="background:#FF9800;border-radius:6px;height:8px;width:' + pct + '%;"></div></div>' +
      '<div id="st-scanner" style="margin-bottom:16px;"></div>';
    if (confirmed.length) {
      html += '<h4 style="margin:0 0 6px;">已盤 (' + confirmed.length + ')</h4>';
      for (var i = 0; i < confirmed.length; i++) {
        var c = confirmed[i], diff = c.actualStock - c.systemStock, dc = diff !== 0 ? '#f44336' : '#4CAF50';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;' +
          'border-bottom:1px solid #f0f0f0;font-size:13px;"><span>' + esc(c.productName) + '</span>' +
          '<span style="color:' + dc + ';font-weight:600;">實 ' + c.actualStock + ' / 系 ' + c.systemStock +
          (diff !== 0 ? ' (' + (diff > 0 ? '+' : '') + diff + ')' : '') + '</span></div>';
      }
    }
    if (unconfirmed.length) {
      html += '<h4 style="margin:12px 0 6px;color:#999;">未盤 (' + unconfirmed.length + ')</h4>';
      for (var j = 0; j < unconfirmed.length; j++) {
        html += '<div style="padding:6px 0;border-bottom:1px solid #f5f5f5;font-size:13px;color:#bbb;">' +
          esc(unconfirmed[j].productName) + ' (系統 ' + unconfirmed[j].systemStock + ')</div>';
      }
    }
    html += '<div style="display:flex;gap:8px;margin-top:16px;">' +
      '<button id="st-pause" style="flex:1;padding:12px;border:1px solid #ccc;border-radius:8px;' +
      'background:#fff;font-size:15px;cursor:pointer;">暫停盤點</button>' +
      '<button id="st-finish" style="flex:1;padding:12px;border:none;border-radius:8px;background:#FF9800;' +
      'color:#fff;font-size:15px;font-weight:600;cursor:pointer;">完成盤點</button></div></div>';
    container.innerHTML = html;
    InvScanner.renderScannerUI('st-scanner', this.onScanItem.bind(this));
    var self = this;
    document.getElementById('st-pause').addEventListener('click', function () { self.pauseStocktake(); });
    document.getElementById('st-finish').addEventListener('click', function () { self.finishStocktake(); });
  },

  async onScanItem(barcode) {
    InvScanner.stop();
    var st = this._current; if (!st) return;
    var items = st.items || [], idx = -1;
    for (var i = 0; i < items.length; i++) { if (items[i].barcode === barcode) { idx = i; break; } }
    if (idx === -1) { InvApp.showToast('此商品不在盤點範圍'); this._resumeScan(); return; }
    var item = items[idx];
    var label = item.confirmed ? '修改實際數量（目前 ' + item.actualStock + '）' : '輸入實際數量';
    var val = prompt(InvApp.escapeHTML(item.productName) + '\n' + label,
      item.confirmed ? String(item.actualStock) : String(item.systemStock));
    if (val === null) { this._resumeScan(); return; }
    var qty = parseInt(val, 10);
    if (isNaN(qty) || qty < 0) { InvApp.showToast('請輸入有效數量'); this._resumeScan(); return; }
    item.actualStock = qty; item.confirmed = true;
    if (navigator.vibrate) navigator.vibrate(100);
    try { await db.collection('inv_stocktakes').doc(st.id).update({ items: items }); }
    catch (e) { console.error('[InvStocktake] update item:', e); }
    var container = document.getElementById('inv-stocktake-content');
    if (container) this.renderStocktakeUI(container);
  },

  _resumeScan() { InvScanner.renderScannerUI('st-scanner', this.onScanItem.bind(this)); },

  // ══════ 差異報告 ══════

  async finishStocktake() {
    var st = this._current; if (!st) return;
    var container = document.getElementById('inv-stocktake-content');
    if (!container) return;
    container.innerHTML = '<div style="padding:16px;">' + this.renderDiffReport() +
      '<div style="display:flex;gap:8px;margin-top:16px;">' +
      '<button id="st-back" style="flex:1;padding:12px;border:1px solid #ccc;border-radius:8px;' +
      'background:#fff;font-size:15px;cursor:pointer;">返回盤點</button>' +
      '<button id="st-apply" style="flex:1;padding:12px;border:none;border-radius:8px;background:#f44336;' +
      'color:#fff;font-size:15px;font-weight:600;cursor:pointer;">確認調整</button></div></div>';
    var self = this;
    document.getElementById('st-back').addEventListener('click', function () {
      var c = document.getElementById('inv-stocktake-content');
      if (c) self.renderStocktakeUI(c);
    });
    document.getElementById('st-apply').addEventListener('click', function () { self.applyAdjustments(); });
  },

  renderDiffReport() {
    var st = this._current; if (!st) return '';
    var items = st.items || [], esc = InvApp.escapeHTML;
    var html = '<h3 style="margin:0 0 12px;">差異報告</h3>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
      '<tr style="background:#f5f5f5;"><th style="padding:8px 4px;text-align:left;">品名</th>' +
      '<th style="padding:8px 4px;">系統</th><th style="padding:8px 4px;">實際</th>' +
      '<th style="padding:8px 4px;">差異</th><th style="padding:8px 4px;">狀態</th></tr>';
    for (var i = 0; i < items.length; i++) {
      var it = items[i], diffCell, statusCell, dash = '<span style="color:#999;">\u2014</span>';
      if (!it.confirmed) { diffCell = dash; statusCell = '<span style="color:#999;">未盤</span>'; }
      else {
        var diff = it.actualStock - it.systemStock;
        if (diff > 0) { diffCell = '<span style="color:#2196F3;">+' + diff + '</span>'; statusCell = '<span style="color:#2196F3;">盈餘</span>'; }
        else if (diff < 0) { diffCell = '<span style="color:#f44336;">' + diff + '</span>'; statusCell = '<span style="color:#f44336;">短缺</span>'; }
        else { diffCell = statusCell = '<span style="color:#4CAF50;">\u2713</span>'; }
      }
      html += '<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:6px 4px;">' + esc(it.productName) + '</td>' +
        '<td style="padding:6px 4px;text-align:center;">' + it.systemStock + '</td>' +
        '<td style="padding:6px 4px;text-align:center;">' + (it.confirmed ? it.actualStock : dash) + '</td>' +
        '<td style="padding:6px 4px;text-align:center;">' + diffCell + '</td>' +
        '<td style="padding:6px 4px;text-align:center;">' + statusCell + '</td></tr>';
    }
    return html + '</table>';
  },

  // ══════ 批次調整 ══════

  async applyAdjustments() {
    var st = this._current; if (!st) return;
    var toAdjust = (st.items || []).filter(function (it) {
      return it.confirmed && it.actualStock !== it.systemStock;
    });
    if (!toAdjust.length) { InvApp.showToast('無需調整'); return; }
    if (!confirm('確定調整 ' + toAdjust.length + ' 件商品庫存？')) return;
    try {
      for (var start = 0; start < toAdjust.length; start += 50) {
        var chunk = toAdjust.slice(start, start + 50), batch = db.batch();
        for (var i = 0; i < chunk.length; i++) {
          var it = chunk[i];
          batch.update(db.collection('inv_products').doc(it.barcode),
            { stock: it.actualStock, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
          batch.set(db.collection('inv_transactions').doc(), {
            barcode: it.barcode, type: 'adjust', delta: it.actualStock - it.systemStock,
            beforeStock: it.systemStock, afterStock: it.actualStock,
            note: '盤點調整', uid: InvAuth.getUid() || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
        await batch.commit();
      }
      await db.collection('inv_stocktakes').doc(st.id).update({
        status: 'completed', completedAt: firebase.firestore.FieldValue.serverTimestamp() });
      for (var k = 0; k < toAdjust.length; k++) {
        var p = InvProducts.getByBarcode(toAdjust[k].barcode);
        if (p) p.stock = toAdjust[k].actualStock;
      }
      this._current = null;
      InvApp.showToast('盤點完成，已調整 ' + toAdjust.length + ' 件');
      this.render();
    } catch (e) {
      console.error('[InvStocktake] applyAdjustments:', e);
      InvApp.showToast('調整失敗：' + (e.message || '未知錯誤'));
    }
  },

  async pauseStocktake() {
    var st = this._current; if (!st) return;
    try { await db.collection('inv_stocktakes').doc(st.id).update({ items: st.items }); }
    catch (e) { console.error('[InvStocktake] pause save:', e); }
    this._current = null;
    InvApp.showToast('盤點已暫停，可稍後繼續');
    InvApp.showPage('page-products');
  },

  async resumeStocktake(stocktakeId) {
    try {
      var doc = await db.collection('inv_stocktakes').doc(stocktakeId).get();
      if (!doc.exists) { InvApp.showToast('盤點單不存在'); return; }
      this._current = Object.assign({ id: doc.id }, doc.data());
      if (this._current.status !== 'in_progress') { InvApp.showToast('此盤點已完成'); return; }
      var c = document.getElementById('inv-stocktake-content');
      if (c) this.renderStocktakeUI(c);
    } catch (e) { console.error('[InvStocktake] resume:', e); InvApp.showToast('載入盤點單失敗'); }
  },

  async _loadHistory() {
    var el = document.getElementById('stocktake-history');
    if (!el) return;
    try {
      var snap = await db.collection('inv_stocktakes').orderBy('createdAt', 'desc').limit(10).get();
      if (snap.empty) { el.innerHTML = '<div style="color:#999;">尚無盤點紀錄</div>'; return; }
      var html = '', self = this, esc = InvApp.escapeHTML;
      snap.docs.forEach(function (doc) {
        var d = doc.data(), items = d.items || [];
        var cnt = items.filter(function (it) { return it.confirmed; }).length;
        var tm = d.createdAt ? InvApp.formatDate(d.createdAt.toDate()) : '-';
        var sc = d.status === 'completed' ? '#4CAF50' : '#FF9800';
        var sl = d.status === 'completed' ? '已完成' : '進行中';
        html += '<div class="st-hist" data-id="' + esc(doc.id) + '" data-status="' + d.status + '" ' +
          'style="display:flex;justify-content:space-between;align-items:center;padding:10px;border:1px solid #eee;' +
          'border-radius:8px;margin-bottom:6px;cursor:pointer;background:#fff;">' +
          '<div><div style="font-size:14px;font-weight:600;">' + tm + '</div>' +
          '<div style="font-size:12px;color:#999;">已盤 ' + cnt + '/' + items.length + '</div></div>' +
          '<span style="color:' + sc + ';font-size:13px;font-weight:600;">' + sl + '</span></div>';
      });
      el.innerHTML = html;
      var cards = el.querySelectorAll('.st-hist');
      for (var i = 0; i < cards.length; i++) {
        cards[i].addEventListener('click', function () {
          if (this.getAttribute('data-status') === 'in_progress')
            self.resumeStocktake(this.getAttribute('data-id'));
        });
      }
    } catch (e) { console.error('[InvStocktake] _loadHistory:', e); el.innerHTML = '<div style="color:#f44336;">載入失敗</div>'; }
  }
};
