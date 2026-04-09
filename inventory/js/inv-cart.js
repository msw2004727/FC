/**
 * inv-cart.js
 * 購物車狀態管理模組
 */
const InvCart = {
  /** @type {{ barcode:string, productId:string, name:string, quantity:number, unitPrice:number, costPrice:number }[]} */
  items: [],

  /* ──── 操作 ──── */

  /**
   * 新增商品到購物車（已存在則 quantity++）
   * @param {{ barcode:string, productId:string, name:string, unitPrice:number, costPrice:number }} product
   */
  add(product) {
    var pid = product.productId || product.barcode;
    var existing = this.items.find(function (it) { return (it.productId || it.barcode) === pid; });
    if (existing) {
      existing.quantity++;
    } else {
      this.items.push({
        barcode:   product.barcode,
        productId: product.productId,
        name:      product.name,
        quantity:  1,
        unitPrice: Number(product.unitPrice) || 0,
        costPrice: Number(product.costPrice) || 0,
      });
    }
    this._onUpdate();
  },

  /**
   * 移除指定 barcode 的項目
   * @param {string} barcode
   */
  remove(pid) {
    this.items = this.items.filter(function (it) { return (it.productId || it.barcode) !== pid; });
    this._onUpdate();
  },

  /**
   * 更新數量（<= 0 時移除）
   * @param {string} pid - productId 或 barcode
   * @param {number} qty
   */
  updateQuantity(pid, qty) {
    if (qty <= 0) {
      this.remove(pid);
      return;
    }
    var item = this.items.find(function (it) { return (it.productId || it.barcode) === pid; });
    if (item) {
      item.quantity = qty;
      this._onUpdate();
    }
  },

  /** 清空購物車 */
  clear() {
    this.items = [];
    this._onUpdate();
  },

  /* ──── 計算 ──── */

  /** @returns {number} 小計金額 */
  getSubtotal() {
    return this.items.reduce(function (sum, it) {
      return sum + it.quantity * it.unitPrice;
    }, 0);
  },

  /** @returns {number} 總件數 */
  getItemCount() {
    return this.items.reduce(function (sum, it) { return sum + it.quantity; }, 0);
  },

  /* ──── 暫存 ──── */

  /** 存入 localStorage */
  save() {
    try {
      localStorage.setItem('inv_cart_draft', JSON.stringify(this.items));
    } catch (e) {
      console.warn('[InvCart] save failed:', e);
    }
  },

  /** 從 localStorage 恢復 */
  restore() {
    try {
      var raw = localStorage.getItem('inv_cart_draft');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed;
          this._onUpdate();
        }
      }
    } catch (e) {
      console.warn('[InvCart] restore failed:', e);
    }
  },

  /* ──── 內部更新 ──── */

  /** 變更後統一觸發 UI 更新 + 自動暫存 */
  _onUpdate() {
    this.save();
    this.renderCartBar();
    this.renderCartList('inv-cart-list');
  },

  /* ──── UI 渲染 ──── */

  /** 底部摘要列（#inv-cart-bar） */
  renderCartBar() {
    var bar = document.getElementById('inv-cart-bar');
    if (!bar) return;

    if (this.items.length === 0) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }

    var count = this.getItemCount();
    var total = this.getSubtotal();
    var esc = InvApp.escapeHTML;

    bar.style.display = 'flex';
    bar.innerHTML =
      '<div>' +
        '<span class="summary">' + esc(count + ' 件商品') + '</span>' +
        '<span class="total" style="margin-left:8px;">NT$' + esc(total.toLocaleString('zh-TW')) + '</span>' +
      '</div>' +
      '<button class="inv-btn primary" onclick="InvSale.showCheckout()" style="min-height:38px;padding:6px 18px;">' +
        '結帳' +
      '</button>';
  },

  /**
   * 渲染購物車清單到指定容器
   * @param {string} containerId
   */
  renderCartList(containerId) {
    var wrap = document.getElementById(containerId);
    if (!wrap) return;

    if (this.items.length === 0) {
      wrap.innerHTML =
        '<div class="inv-empty-state">' +
          '<div class="icon">🛒</div>' +
          '<div class="msg">購物車是空的，掃碼加入商品</div>' +
        '</div>';
      return;
    }

    var esc = InvApp.escapeHTML;
    var html = '';

    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      var sub = it.quantity * it.unitPrice;
      var pid = esc(it.productId || it.barcode);

      html +=
        '<div class="inv-cart-item">' +
          '<div class="name">' + esc(it.name) + '</div>' +
          '<div class="inv-qty-btns">' +
            '<button onclick="InvCart.updateQuantity(\'' + pid + '\',' + (it.quantity - 1) + ')">-</button>' +
            '<span class="qty">' + it.quantity + '</span>' +
            '<button onclick="InvCart.updateQuantity(\'' + pid + '\',' + (it.quantity + 1) + ')">+</button>' +
          '</div>' +
          '<div class="subtotal">$' + esc(sub.toLocaleString('zh-TW')) + '</div>' +
          '<button style="border:none;background:none;color:var(--inv-danger);font-size:18px;cursor:pointer;padding:4px 8px;" ' +
            'onclick="InvCart.remove(\'' + pid + '\')">✕</button>' +
        '</div>';
    }

    html +=
      '<div style="padding:12px 16px;text-align:right;font-size:15px;font-weight:600;">' +
        '小計：NT$' + esc(this.getSubtotal().toLocaleString('zh-TW')) +
      '</div>';

    wrap.innerHTML = html;
  },
};
