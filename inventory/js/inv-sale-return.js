/**
 * inv-sale-return.js — 退貨 + 報廢模組（掛載到 InvSale）
 */
Object.assign(InvSale, {

  // ══════ 退貨 ══════

  _closeFormOverlay() {
    var ov = document.getElementById('inv-return-overlay');
    if (ov) ov.remove();
  },

  /** 顯示退貨表單（overlay，可從任何頁面呼叫） */
  async showReturnForm(barcode) {
    var p = InvProducts.getByBarcode(barcode);
    if (!p) { InvApp.showToast('找不到此商品'); return; }
    var txSnap = await db.collection('inv_transactions')
      .where('barcode', '==', barcode).where('type', '==', 'out')
      .orderBy('createdAt', 'desc').limit(10).get();
    var txList = [];
    txSnap.forEach(function (d) {
      var t = d.data(); t._id = d.id; txList.push(t);
    });
    var esc = InvApp.escapeHTML;
    var opts = '<option value="">— 不關聯 —</option>';
    txList.forEach(function (t) {
      var dt = t.createdAt && t.createdAt.toDate ? t.createdAt.toDate().toLocaleDateString('zh-TW') : '';
      opts += '<option value="' + esc(t._id) + '">' +
        esc((t.receiptNo || '無單號') + ' / ' + dt + ' / 數量 ' + (t.quantity || t.delta || 0)) + '</option>';
    });
    this._closeFormOverlay();
    var overlay = document.createElement('div');
    overlay.id = 'inv-return-overlay';
    overlay.className = 'inv-overlay show';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.addEventListener('touchmove', function(e) { if (!e.target.closest('.inv-modal')) { e.preventDefault(); e.stopPropagation(); } }, { passive: false });
    overlay.innerHTML =
      '<div class="inv-modal" style="max-width:400px;width:92%;max-height:80vh;overflow-y:auto">' +
        '<h3 style="margin:0 0 12px;font-size:17px;font-weight:700">退貨 — ' + esc(p.name) + '</h3>' +
        '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">目前庫存：' + (p.stock || 0) + '</div>' +
        '<label style="font-size:13px;">關聯原始交易</label>' +
        '<select id="inv-ret-tx" class="inv-input" style="margin-bottom:8px;">' + opts + '</select>' +
        '<label style="font-size:13px;">退貨數量</label>' +
        '<input id="inv-ret-qty" class="inv-input" type="number" min="1" value="1" style="margin-bottom:8px;" />' +
        '<label style="font-size:13px;">退貨原因</label>' +
        '<select id="inv-ret-reason" class="inv-input" style="margin-bottom:8px;">' +
          '<option value="defect">瑕疵品</option><option value="size">尺寸不合</option>' +
          '<option value="changed_mind">改變心意</option><option value="other">其他</option></select>' +
        '<label style="font-size:13px;">退款金額</label>' +
        '<input id="inv-ret-refund" class="inv-input" type="number" min="0" value="' +
          (Number(p.price) || 0) + '" style="margin-bottom:8px;" />' +
        '<label style="font-size:13px;">處理方式</label>' +
        '<select id="inv-ret-dest" class="inv-input" style="margin-bottom:12px;">' +
          '<option value="stock">退回庫存</option><option value="waste">報廢</option></select>' +
        '<button class="inv-btn primary full" onclick="InvSale.handleReturn(\'' +
          esc(barcode) + '\')">確認退貨</button>' +
        '<button class="inv-btn outline full" onclick="InvSale._closeFormOverlay()" style="margin-top:8px;">取消</button>' +
      '</div>';
    document.body.appendChild(overlay);
  },

  /** 執行退貨 */
  async handleReturn(barcode) {
    var qty = parseInt(document.getElementById('inv-ret-qty').value, 10) || 0;
    if (qty < 1) { InvApp.showToast('請輸入有效數量'); return; }
    var reason = document.getElementById('inv-ret-reason').value;
    var refund = parseFloat(document.getElementById('inv-ret-refund').value) || 0;
    var origTx = document.getElementById('inv-ret-tx').value || null;
    var returnToStock = document.getElementById('inv-ret-dest').value === 'stock';
    var p = InvProducts.getByBarcode(barcode);
    if (!p) { InvApp.showToast('商品不存在'); return; }
    var uid = InvAuth.getUid(), opName = InvAuth.getName() || '';
    try {
      var ref = db.collection('inv_products').doc(p.id || barcode);
      await db.runTransaction(async function (tx) {
        var snap = await tx.get(ref);
        if (!snap.exists) throw new Error('商品不存在');
        var cur = Number(snap.data().stock) || 0;
        var after = returnToStock ? cur + qty : cur;
        tx.update(ref, { stock: after });
        tx.set(db.collection('inv_transactions').doc(), {
          type: 'return', barcode: barcode,
          productId: p.id || barcode, productName: p.name,
          quantity: qty, refundAmount: refund,
          reason: reason, returnToStock: returnToStock,
          originalTransactionId: origTx,
          beforeStock: cur, afterStock: after,
          uid: uid, operatorName: opName,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      InvApp.showToast('退貨完成');
      InvUtils.writeLog('sale_return', (p.name || barcode) + ' x' + qty + ' 退款' + refund);
      this._closeFormOverlay();
      await InvProducts.loadAll();
      if (typeof InvProducts.renderDetail === 'function') InvProducts.renderDetail(barcode);
    } catch (e) {
      console.error('[InvSale] handleReturn error:', e);
      InvApp.showToast(e.message || '退貨失敗');
    }
  },

  // ══════ 報廢 ══════

  /** 顯示報廢表單（overlay，可從任何頁面呼叫） */
  async showWasteForm(barcode) {
    var p = InvProducts.getByBarcode(barcode);
    if (!p) { InvApp.showToast('找不到此商品'); return; }
    var esc = InvApp.escapeHTML;
    this._closeFormOverlay();
    var overlay = document.createElement('div');
    overlay.id = 'inv-return-overlay';
    overlay.className = 'inv-overlay show';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.addEventListener('touchmove', function(e) { if (!e.target.closest('.inv-modal')) { e.preventDefault(); e.stopPropagation(); } }, { passive: false });
    overlay.innerHTML =
      '<div class="inv-modal" style="max-width:400px;width:92%;max-height:80vh;overflow-y:auto">' +
        '<h3 style="margin:0 0 12px;font-size:17px;font-weight:700">報廢 — ' + esc(p.name) + '</h3>' +
        '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">目前庫存：' + (p.stock || 0) + '</div>' +
        '<label style="font-size:13px;">報廢數量</label>' +
        '<input id="inv-waste-qty" class="inv-input" type="number" min="1" value="1" style="margin-bottom:8px;" />' +
        '<label style="font-size:13px;">報廢原因</label>' +
        '<select id="inv-waste-reason" class="inv-input" style="margin-bottom:12px;">' +
          '<option value="damaged">損壞</option><option value="expired">過期</option>' +
          '<option value="lost">遺失</option><option value="display">展示品</option>' +
          '<option value="other">其他</option></select>' +
        '<button class="inv-btn primary full" onclick="InvSale.handleWaste(\'' +
          esc(barcode) + '\')">確認報廢</button>' +
        '<button class="inv-btn outline full" onclick="InvSale._closeFormOverlay()" style="margin-top:8px;">取消</button>' +
      '</div>';
    document.body.appendChild(overlay);
  },

  /** 執行報廢 */
  async handleWaste(barcode) {
    var qty = parseInt(document.getElementById('inv-waste-qty').value, 10) || 0;
    if (qty < 1) { InvApp.showToast('請輸入有效數量'); return; }
    var reason = document.getElementById('inv-waste-reason').value;
    var p = InvProducts.getByBarcode(barcode);
    if (!p) { InvApp.showToast('商品不存在'); return; }
    var stock = Number(p.stock) || 0;
    if (qty > stock) { InvApp.showToast('報廢數量不可超過庫存（' + stock + '）'); return; }
    var uid = InvAuth.getUid(), opName = InvAuth.getName() || '';
    try {
      var ref = db.collection('inv_products').doc(p.id || barcode);
      await db.runTransaction(async function (tx) {
        var snap = await tx.get(ref);
        if (!snap.exists) throw new Error('商品不存在');
        var cur = Number(snap.data().stock) || 0;
        if (qty > cur) throw new Error('庫存不足（剩 ' + cur + '）');
        var after = cur - qty;
        tx.update(ref, { stock: after });
        tx.set(db.collection('inv_transactions').doc(), {
          type: 'waste', barcode: barcode,
          productId: p.id || barcode, productName: p.name,
          quantity: qty, reason: reason,
          beforeStock: cur, afterStock: after,
          uid: uid, operatorName: opName,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      InvApp.showToast('報廢完成');
      InvUtils.writeLog('sale_waste', (p.name || barcode) + ' x' + qty + ' ' + reason);
      this._closeFormOverlay();
      await InvProducts.loadAll();
      if (typeof InvProducts.renderDetail === 'function') InvProducts.renderDetail(barcode);
    } catch (e) {
      console.error('[InvSale] handleWaste error:', e);
      InvApp.showToast(e.message || '報廢失敗');
    }
  },
});
