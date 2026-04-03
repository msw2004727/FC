/**
 * inv-sale.js — 銷售模組（掃碼 + 折扣 + 收款 + 結帳）
 */
const InvSale = {
  _discountType: null,   // 'percent' | 'amount' | null
  _discountValue: 0,
  _paymentMethod: 'cash',
  _cashReceived: 0,
  _isGift: false,
  _isStaffPurchase: false,

  _saleMode: 'sale',

  /** 渲染銷售頁面到 #inv-sale-content */
  render() {
    var wrap = document.getElementById('inv-sale-content');
    if (!wrap) return;
    this._discountType = null;
    this._discountValue = 0;
    this._paymentMethod = 'cash';
    this._cashReceived = 0;
    this._isGift = false;
    this._isStaffPurchase = false;

    var modes = [
      { key: 'sale', label: '銷售' },
      { key: 'return', label: '退貨' },
      { key: 'waste', label: '報廢' },
    ];
    var tabsHtml = '<div style="display:flex;gap:6px;justify-content:center;margin-bottom:8px">';
    for (var i = 0; i < modes.length; i++) {
      var m = modes[i], active = this._saleMode === m.key;
      var bg = active ? (m.key === 'waste' ? 'var(--danger)' : 'var(--accent)') : 'var(--bg-card)';
      var color = active ? '#fff' : 'var(--text-muted)';
      var border = active ? 'transparent' : 'var(--border)';
      tabsHtml += '<button onclick="InvSale.switchSaleMode(\'' + m.key + '\')" ' +
        'style="flex:1;padding:8px 0;border:1px solid ' + border + ';border-radius:var(--radius-full);' +
        'background:' + bg + ';color:' + color + ';font-size:13px;font-weight:600;cursor:pointer">' +
        m.label + '</button>';
    }
    tabsHtml += '</div>';

    wrap.innerHTML = tabsHtml +
      '<div id="inv-sale-scanner" style="padding:0 0 8px"></div>' +
      '<div id="inv-cart-list" style="padding-bottom:80px"></div>';
    InvScanner._onManualAdd = null; // 銷售頁不需要手動添加
    InvScanner.renderScannerUI('inv-sale-scanner', function (b) { InvSale._onModeScan(b); });
    if (this._saleMode === 'sale') {
      InvCart.restore();
      InvCart.renderCartBar();
      InvCart.renderCartList('inv-cart-list');
    }
  },

  switchSaleMode(mode) {
    this._saleMode = mode;
    this.render();
  },

  /** 根據模式路由掃碼結果 */
  _onModeScan(barcode) {
    if (this._saleMode === 'return') {
      InvScanner.stop();
      this.showReturnForm(barcode);
    } else if (this._saleMode === 'waste') {
      InvScanner.stop();
      this.showWasteForm(barcode);
    } else {
      this.onScan(barcode);
    }
  },

  /** 掃碼後查商品、檢查庫存、加入購物車 */
  async onScan(barcode) {
    if (!barcode) return;
    try {
      var snap = await db.collection('inv_products').where('barcode', '==', barcode).limit(1).get();
      if (snap.empty) { InvApp.showToast('找不到此條碼的商品'); return; }
      var doc = snap.docs[0], data = doc.data(), stock = Number(data.stock) || 0;
      if (stock <= 0) { InvApp.showToast('庫存不足，無法加入'); return; }
      var existing = InvCart.items.find(function (it) { return it.barcode === barcode; });
      var qtyInCart = existing ? existing.quantity : 0;
      if (qtyInCart + 1 > stock) { InvApp.showToast('庫存僅剩 ' + stock + ' 件，購物車已達上限'); return; }
      if (stock <= 3) InvApp.showToast('提醒：此商品庫存僅剩 ' + stock + ' 件');
      InvCart.add({
        barcode: data.barcode, productId: doc.id,
        name: data.name || '未命名商品',
        unitPrice: Number(data.price) || 0, costPrice: Number(data.costPrice) || 0,
      });
    } catch (e) {
      console.error('[InvSale] onScan error:', e);
      InvApp.showToast('查詢商品失敗，請重試');
    }
  },

  /** 進入結帳確認畫面 */
  showCheckout() {
    if (InvCart.items.length === 0) { InvApp.showToast('購物車是空的'); return; }
    var wrap = document.getElementById('inv-cart-list');
    if (!wrap) return;
    var esc = InvApp.escapeHTML, html = '';
    for (var i = 0; i < InvCart.items.length; i++) {
      var it = InvCart.items[i];
      html +=
        '<div class="inv-cart-item">' +
          '<div class="name">' + esc(it.name) + '</div>' +
          '<div class="qty">x' + it.quantity + '</div>' +
          '<div class="subtotal">$' + esc((it.quantity * it.unitPrice).toLocaleString('zh-TW')) + '</div>' +
        '</div>';
    }
    html += '<div style="padding:12px 16px;border-top:1px solid var(--inv-border);">';
    html += this._renderDiscountSection();
    html += this._renderPaymentSection();
    html += this._renderSaleFlags();
    html +=
      '<div style="text-align:right;font-size:18px;font-weight:700;color:var(--inv-primary);margin:12px 0;">' +
        '應收：NT$' + esc(this._calcTotal().toLocaleString('zh-TW')) + '</div>' +
      '<button class="inv-btn primary full" id="inv-checkout-confirm" ' +
        'onclick="InvSale.checkout()" style="margin-top:8px;">確認結帳</button>' +
      '<button class="inv-btn outline full" onclick="InvSale.render()" ' +
        'style="margin-top:8px;">返回繼續掃碼</button>' +
      '</div>';
    wrap.innerHTML = html;
  },

  /** 折扣區段 HTML */
  _renderDiscountSection() {
    var esc = InvApp.escapeHTML;
    var presets = [
      { label: '9 折',  type: 'percent', value: 10 },
      { label: '85 折', type: 'percent', value: 15 },
      { label: '8 折',  type: 'percent', value: 20 },
    ];
    var html =
      '<div style="margin-bottom:12px;">' +
      '<div style="font-size:13px;color:var(--inv-text-light);margin-bottom:6px;">折扣</div>' +
      '<div class="inv-discount-btns">';
    for (var i = 0; i < presets.length; i++) {
      var p = presets[i];
      var cls = (this._discountType === p.type && this._discountValue === p.value) ? ' active' : '';
      html += '<button class="' + cls + '" onclick="InvSale.setDiscount(\'' +
        p.type + '\',' + p.value + ')">' + esc(p.label) + '</button>';
    }
    var _hp = typeof InvAuth !== 'undefined' && InvAuth.hasPerm ? InvAuth.hasPerm.bind(InvAuth) : function() { return true; };
    if (_hp('sale.custom_discount')) {
      var amtCls = this._discountType === 'amount' ? ' active' : '';
      html += '<button class="' + amtCls + '" onclick="InvSale.promptCustomDiscount()">自訂金額</button>';
    }
    html += '</div>';
    if (this._discountType) {
      var saved = InvCart.getSubtotal() - this._calcTotal();
      html += '<div style="font-size:13px;color:var(--inv-danger);margin-top:6px;">' +
        '折扣 -NT$' + esc(saved.toLocaleString('zh-TW')) + '</div>';
    }
    html += '</div>';
    return html;
  },

  /** 設定折扣（再點同一個取消） */
  setDiscount(type, value) {
    if (this._discountType === type && this._discountValue === value) {
      this._discountType = null; this._discountValue = 0;
    } else {
      this._discountType = type; this._discountValue = value;
    }
    this.showCheckout();
  },

  /** 自訂折扣金額 */
  promptCustomDiscount() {
    var input = prompt('請輸入折扣金額（元）');
    if (input === null) return;
    var val = parseInt(input, 10);
    if (isNaN(val) || val <= 0) { InvApp.showToast('請輸入有效的折扣金額'); return; }
    this._discountType = 'amount'; this._discountValue = val;
    this.showCheckout();
  },

  /** 收款方式區段 HTML */
  _renderPaymentSection() {
    var esc = InvApp.escapeHTML;
    var methods = [
      { key: 'cash', label: '現金' },
      { key: 'transfer', label: '轉帳' },
      { key: 'linepay', label: 'LINE Pay' },
    ];
    var html =
      '<div style="margin-bottom:12px;">' +
      '<div style="font-size:13px;color:var(--inv-text-light);margin-bottom:6px;">收款方式</div>' +
      '<div class="inv-discount-btns">';
    for (var i = 0; i < methods.length; i++) {
      var m = methods[i];
      var cls = this._paymentMethod === m.key ? ' active' : '';
      html += '<button class="' + cls + '" onclick="InvSale.setPayment(\'' +
        m.key + '\')">' + esc(m.label) + '</button>';
    }
    html += '</div>';
    if (this._paymentMethod === 'cash') {
      var total = this._calcTotal();
      html +=
        '<div style="margin-top:8px;display:flex;align-items:center;gap:8px;">' +
          '<input id="inv-cash-input" class="inv-input" type="number" inputmode="numeric" ' +
            'placeholder="客人付多少" value="' + (this._cashReceived || '') + '" ' +
            'oninput="InvSale.updateChange()" style="flex:1;height:40px;" />' +
          '<span id="inv-cash-change" style="font-size:14px;font-weight:600;min-width:80px;text-align:right;">' +
            this._calcChangeText(total) + '</span>' +
        '</div>';
    }
    html += '</div>';
    return html;
  },

  setPayment(method) { this._paymentMethod = method; this.showCheckout(); },

  /** 更新找零 */
  updateChange() {
    var input = document.getElementById('inv-cash-input');
    var span = document.getElementById('inv-cash-change');
    if (!input || !span) return;
    this._cashReceived = parseInt(input.value, 10) || 0;
    span.textContent = this._calcChangeText(this._calcTotal());
  },

  _calcChangeText(total) {
    if (!this._cashReceived || this._cashReceived < total) return '';
    return '找零 $' + (this._cashReceived - total).toLocaleString('zh-TW');
  },

  /** Firestore Transaction 結帳 */
  async checkout() {
    var _hp = typeof InvAuth !== 'undefined' && InvAuth.hasPerm ? InvAuth.hasPerm.bind(InvAuth) : function() { return true; };
    if (!_hp('sale.checkout')) { InvApp.showToast('權限不足'); return; }
    if (InvCart.items.length === 0) { InvApp.showToast('購物車是空的'); return; }
    if (!navigator.onLine) { InvApp.showToast('無網路連線，無法結帳'); return; }
    var btn = document.getElementById('inv-checkout-confirm');
    if (btn) btn.disabled = true;

    // 合併同 barcode
    var merged = {};
    InvCart.items.forEach(function (it) {
      if (merged[it.barcode]) { merged[it.barcode].quantity += it.quantity; }
      else { merged[it.barcode] = Object.assign({}, it); }
    });
    var itemList = Object.values(merged);
    var saleGroupId = InvUtils.generateId('sale_');
    var receiptNo = InvUtils.generateReceiptNo();
    var total = this._calcTotal();
    var isGift = this._isGift, isStaffPurchase = this._isStaffPurchase;
    var uid = InvAuth.getUid(), operatorName = InvAuth.getName() || '';

    try {
      await db.runTransaction(async function (tx) {
        var refs = [], snaps = [];
        for (var i = 0; i < itemList.length; i++) {
          var ref = db.collection('inv_products').doc(itemList[i].productId);
          refs.push(ref);
          snaps.push(await tx.get(ref));
        }
        // 驗證庫存
        for (var j = 0; j < itemList.length; j++) {
          if (!snaps[j].exists) throw new Error('商品不存在：' + itemList[j].name);
          var cur = Number(snaps[j].data().stock) || 0;
          if (cur < itemList[j].quantity)
            throw new Error(itemList[j].name + ' 庫存不足（剩 ' + cur + '）');
        }
        // 扣庫存 + 寫交易紀錄
        for (var k = 0; k < itemList.length; k++) {
          var item = itemList[k];
          var before = Number(snaps[k].data().stock) || 0;
          var after = before - item.quantity;
          tx.update(refs[k], { stock: after });
          tx.set(db.collection('inv_transactions').doc(), {
            type: 'out', barcode: item.barcode,
            productId: item.productId, productName: item.name,
            quantity: item.quantity, unitPrice: item.unitPrice, costPrice: item.costPrice,
            beforeStock: before, afterStock: after,
            saleGroupId: saleGroupId, receiptNo: receiptNo,
            paymentMethod: InvSale._paymentMethod,
            discountType: InvSale._discountType, discountValue: InvSale._discountValue,
            totalAmount: total, isGift: isGift, isStaffPurchase: isStaffPurchase,
            uid: uid, operatorName: operatorName,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        }
      });
      InvCart.clear();
      InvUtils.writeLog('sale', receiptNo + ' ' + itemList.length + '項 ' + InvApp.formatCurrency(totalAmount));
      InvApp.showToast('結帳完成 — ' + receiptNo);
      this.render();
    } catch (e) {
      console.error('[InvSale] checkout error:', e);
      InvApp.showToast(e.message || '結帳失敗，請重試');
      if (btn) btn.disabled = false;
    }
  },

  /** 贈品 / 員工內購 區段 HTML */
  _renderSaleFlags() {
    var _hp = typeof InvAuth !== 'undefined' && InvAuth.hasPerm ? InvAuth.hasPerm.bind(InvAuth) : function() { return true; };
    var giftCk = this._isGift ? ' checked' : '';
    var staffCk = this._isStaffPurchase ? ' checked' : '';
    var flagsHtml = '';
    if (_hp('sale.gift')) {
      flagsHtml += '<label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer;">' +
        '<input type="checkbox" onchange="InvSale.toggleGift(this.checked)"' + giftCk + ' /> 贈品出庫</label>';
    }
    if (_hp('sale.staff_purchase')) {
      flagsHtml += '<label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer;">' +
        '<input type="checkbox" onchange="InvSale.toggleStaff(this.checked)"' + staffCk + ' /> 員工內購</label>';
    }
    if (!flagsHtml) return '';
    return '<div style="margin-bottom:12px;display:flex;gap:16px;align-items:center;">' + flagsHtml + '</div>';
  },
  toggleGift(v) { this._isGift = !!v; this.showCheckout(); },
  toggleStaff(v) { this._isStaffPurchase = !!v; this.showCheckout(); },

  /** 折扣後應收金額（贈品出庫時為 0） */
  _calcTotal() {
    if (this._isGift) return 0;
    var sub = InvCart.getSubtotal();
    if (!this._discountType) return InvUtils.roundAmount(sub);
    var type = this._discountType === 'amount' ? 'fixed' : this._discountType;
    return InvUtils.roundAmount(InvUtils.calcDiscount(sub, type, this._discountValue));
  },
};
