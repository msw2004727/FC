/* ================================================
   SportHub — Shop (Render + Create + Manage + Edit)
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Render: Shop Grid (Front-end)
  // ══════════════════════════════════

  renderShop() {
    const container = document.getElementById('shop-grid');
    const items = ApiService.getShopItems().filter(s => s.status !== 'delisted');
    container.innerHTML = items.length > 0
      ? items.map(s => {
        const hasImg = s.images && s.images.length > 0;
        const imgHtml = hasImg
          ? `<img src="${s.images[0]}" style="width:100%;height:100%;object-fit:cover">`
          : `<div class="shop-img-placeholder">商品圖 150 × 150</div>`;
        return `
        <div class="shop-card" onclick="App.showShopDetail('${s.id}')">
          <div class="shop-img-wrap">${imgHtml}</div>
          <div class="shop-body">
            <div class="shop-name">${s.name}</div>
            <div class="shop-price">NT$${s.price.toLocaleString()}</div>
            <div class="shop-meta">${s.condition} ・ ${s.size}</div>
          </div>
        </div>`;
      }).join('')
      : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted)">尚無上架商品</div>';
  },

  // ══════════════════════════════════
  //  Show Shop Detail
  // ══════════════════════════════════

  showShopDetail(id) {
    const s = ApiService.getShopItem(id);
    if (!s) return;
    document.getElementById('shop-detail-title').textContent = s.name;
    const imgs = s.images && s.images.length > 0 ? s.images : [];
    const imgSlots = [0, 1, 2].map(i => {
      if (imgs[i]) {
        return `<div class="sd-img-item" onclick="App.openLightbox(this)"><img src="${imgs[i]}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)"></div>`;
      }
      return `<div class="sd-img-item"><div class="td-img-placeholder">商品圖 ${i + 1}<br>400 × 300</div></div>`;
    }).join('');
    document.getElementById('shop-detail-body').innerHTML = `
      <div class="sd-images">${imgSlots}</div>
      <div class="td-card">
        <div class="td-card-title">商品資訊</div>
        <div class="td-card-grid">
          <div class="td-card-item"><span class="td-card-label">品名</span><span class="td-card-value">${s.name}</span></div>
          <div class="td-card-item"><span class="td-card-label">新舊程度</span><span class="td-card-value">${s.condition}</span></div>
          <div class="td-card-item"><span class="td-card-label">價格</span><span class="td-card-value" style="color:var(--accent)">NT$${s.price.toLocaleString()}</span></div>
          <div class="td-card-item"><span class="td-card-label">尺寸</span><span class="td-card-value">${s.size}</span></div>
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title">商品描述</div>
        <p style="font-size:.85rem;color:var(--text-secondary);line-height:1.7">${s.desc || '賣家未提供描述。'}</p>
      </div>
      <div class="td-actions">
        <button class="primary-btn" disabled style="opacity:.45;cursor:not-allowed">聯繫賣家</button>
      </div>
    `;
    this.showPage('page-shop-detail');
  },

  openLightbox(el) {
    const img = el.querySelector('img');
    const lb = document.getElementById('lightbox');
    if (img && lb) {
      document.getElementById('lightbox-img').src = img.src;
      lb.classList.add('open');
    } else {
      this.showToast('尚未上傳實際圖片');
    }
  },

  closeLightbox() {
    document.getElementById('lightbox')?.classList.remove('open');
  },

  // ══════════════════════════════════
  //  Shop Management (Admin)
  // ══════════════════════════════════

  _shopSearchKey: '',

  renderShopManage() {
    const container = document.getElementById('shop-manage-list');
    if (!container) return;

    let items = ApiService.getShopItems();
    // 搜尋過濾
    if (this._shopSearchKey) {
      const kw = this._shopSearchKey.toLowerCase();
      items = items.filter(s =>
        s.name.toLowerCase().includes(kw) ||
        (s.condition || '').toLowerCase().includes(kw) ||
        (s.size || '').toLowerCase().includes(kw)
      );
    }

    container.innerHTML = items.length > 0
      ? items.map(s => {
        const hasImg = s.images && s.images.length > 0;
        const thumbHtml = hasImg
          ? `<div class="sm-thumb" style="overflow:hidden;border:none"><img src="${s.images[0]}" style="width:100%;height:100%;object-fit:cover"></div>`
          : `<div class="sm-thumb">商品縮圖<br>60 × 60</div>`;
        const isDelisted = s.status === 'delisted';
        const statusHtml = isDelisted
          ? '<span style="font-size:.68rem;color:var(--danger);font-weight:600">已下架</span>'
          : '<span style="font-size:.68rem;color:var(--success);font-weight:600">上架中</span>';
        return `
        <div class="sm-card${isDelisted ? ' sm-delisted' : ''}">
          ${thumbHtml}
          <div class="sm-info">
            <div style="display:flex;align-items:center;gap:.4rem">
              <div class="sm-title">${s.name}</div>
              ${statusHtml}
            </div>
            <div class="sm-meta">${s.condition} ・ ${s.size} ・ <strong style="color:var(--accent)">NT$${s.price.toLocaleString()}</strong></div>
            <div style="display:flex;gap:.3rem;margin-top:.3rem">
              <button class="primary-btn small" style="font-size:.72rem;padding:.2rem .5rem" onclick="App.editShopItem('${s.id}')">編輯</button>
              <button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="App.showShopDetail('${s.id}')">查看</button>
              ${isDelisted
                ? `<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem;color:var(--success)" onclick="App.relistShopItem('${s.id}')">重新上架</button>`
                : `<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem;color:var(--danger)" onclick="App.delistShopItem('${s.id}')">下架</button>`
              }
              <button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem;color:var(--danger)" onclick="App.removeShopItem('${s.id}')">刪除</button>
            </div>
          </div>
        </div>`;
      }).join('')
      : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted)">尚無商品</div>';
  },

  bindShopSearch() {
    const page = document.getElementById('page-admin-shop');
    if (!page) return;
    const input = page.querySelector('.admin-search input');
    if (!input || input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('input', () => {
      this._shopSearchKey = input.value.trim();
      this.renderShopManage();
    });
  },

  // ══════════════════════════════════
  //  Create / Edit Shop Item
  // ══════════════════════════════════

  _shopEditId: null,   // null = 新增模式，有值 = 編輯模式

  showShopForm(id) {
    const modal = document.getElementById('create-shop-modal');
    if (!modal) return;
    const titleEl = modal.querySelector('.modal-header h3');
    const submitBtn = modal.querySelector('.modal-actions .primary-btn');

    if (id) {
      // 編輯模式
      this._shopEditId = id;
      const s = ApiService.getShopItem(id);
      if (!s) return;

      titleEl.textContent = '編輯商品';
      submitBtn.textContent = '儲存變更';

      document.getElementById('cs-name').value = s.name || '';
      document.getElementById('cs-condition').value = s.condition || '9成新';
      document.getElementById('cs-price').value = s.price || '';
      document.getElementById('cs-size').value = s.size || '';
      document.getElementById('cs-desc').value = s.desc || '';

      // 載入已有圖片到預覽
      const previewIds = ['cs-preview1', 'cs-preview2', 'cs-preview3'];
      const imgs = s.images || [];
      previewIds.forEach((pid, i) => {
        const el = document.getElementById(pid);
        if (!el) return;
        if (imgs[i]) {
          el.classList.add('has-image');
          el.innerHTML = `<img src="${imgs[i]}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
        } else {
          el.classList.remove('has-image');
          el.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-hint">JPG/PNG 2MB</span>';
        }
      });
    } else {
      // 新增模式
      this._shopEditId = null;
      titleEl.textContent = '新增二手商品';
      submitBtn.textContent = '上架商品';
      this._resetShopForm();
    }

    this.showModal('create-shop-modal');
  },

  editShopItem(id) {
    this.showShopForm(id);
  },

  async handleSaveShopItem() {
    const name = document.getElementById('cs-name').value.trim();
    const condition = document.getElementById('cs-condition').value;
    const price = parseInt(document.getElementById('cs-price').value) || 0;
    const size = document.getElementById('cs-size').value.trim() || '—';
    const desc = document.getElementById('cs-desc').value.trim();

    if (!name) { this.showToast('請輸入商品名稱'); return; }
    if (name.length > 20) { this.showToast('商品名稱不可超過 20 字'); return; }
    if (price <= 0) { this.showToast('請輸入價格'); return; }
    if (price > 999999) { this.showToast('金額上限為 NT$999,999'); return; }
    if (desc.length > 500) { this.showToast('描述不可超過 500 字'); return; }

    // 收集圖片（可能是 base64 或已有 URL）
    const images = [];
    ['cs-preview1', 'cs-preview2', 'cs-preview3'].forEach(id => {
      const img = document.getElementById(id)?.querySelector('img');
      if (img) images.push(img.src);
    });

    const isEdit = !!this._shopEditId;
    const itemId = isEdit ? this._shopEditId : 'cs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    // 正式版：上傳新的 base64 圖片到 Storage
    if (!ModeManager.isDemo()) {
      let hasNewUpload = false;
      for (let i = 0; i < images.length; i++) {
        if (images[i] && images[i].startsWith('data:')) {
          if (!hasNewUpload) { this.showToast('圖片上傳中...'); hasNewUpload = true; }
          const url = await FirebaseService._uploadImage(images[i], `shopItems/${itemId}_${i}`);
          if (url) {
            images[i] = url;
          } else {
            this.showToast('圖片上傳失敗，請重試');
            return;
          }
        }
      }
    }

    if (isEdit) {
      // 更新既有商品
      const updates = { name, price, condition, size, desc: desc || '賣家未提供描述。', images };
      if (!ModeManager.isDemo()) {
        try {
          await FirebaseService.updateShopItem(this._shopEditId, updates);
        } catch (err) {
          console.error('[updateShopItem]', err);
          this.showToast('商品更新失敗，請重試');
          return;
        }
      } else {
        const item = DemoData.shopItems.find(s => s.id === this._shopEditId);
        if (item) Object.assign(item, updates);
      }
      this.showToast(`商品「${name}」已更新！`);
    } else {
      // 新增商品
      const newItem = {
        id: itemId,
        name, price, condition, year: new Date().getFullYear(), size,
        desc: desc || '賣家未提供描述。',
        images,
        status: 'on_sale',
      };
      if (!ModeManager.isDemo()) {
        try {
          await FirebaseService.addShopItem(newItem);
        } catch (err) {
          console.error('[addShopItem]', err);
          this.showToast('商品建立失敗，請重試');
          return;
        }
      } else {
        DemoData.shopItems.unshift(newItem);
      }
      this.showToast(`商品「${name}」已上架！`);
    }

    this.renderShop();
    this.renderShopManage();
    this.closeModal();
    this._shopEditId = null;
  },

  // ══════════════════════════════════
  //  Delist / Relist / Remove
  // ══════════════════════════════════

  async delistShopItem(id) {
    const s = ApiService.getShopItem(id);
    if (!s) return;
    if (!ModeManager.isDemo()) {
      try { await FirebaseService.updateShopItem(id, { status: 'delisted' }); }
      catch (err) { console.error('[delistShopItem]', err); this.showToast('下架失敗'); return; }
    } else {
      s.status = 'delisted';
    }
    this.renderShop();
    this.renderShopManage();
    this.showToast(`「${s.name}」已下架`);
  },

  async relistShopItem(id) {
    const s = ApiService.getShopItem(id);
    if (!s) return;
    if (!ModeManager.isDemo()) {
      try { await FirebaseService.updateShopItem(id, { status: 'on_sale' }); }
      catch (err) { console.error('[relistShopItem]', err); this.showToast('上架失敗'); return; }
    } else {
      s.status = 'on_sale';
    }
    this.renderShop();
    this.renderShopManage();
    this.showToast(`「${s.name}」已重新上架`);
  },

  async removeShopItem(id) {
    const s = ApiService.getShopItem(id);
    if (!s) return;
    if (!confirm(`確定要刪除「${s.name}」？此操作無法復原。`)) return;
    if (!ModeManager.isDemo()) {
      try { await FirebaseService.deleteShopItem(id); }
      catch (err) { console.error('[removeShopItem]', err); this.showToast('刪除失敗'); return; }
    } else {
      const idx = DemoData.shopItems.findIndex(si => si.id === id);
      if (idx >= 0) DemoData.shopItems.splice(idx, 1);
    }
    this.renderShop();
    this.renderShopManage();
    this.showToast(`「${s.name}」已刪除`);
  },

  // ══════════════════════════════════
  //  Form Reset Helper
  // ══════════════════════════════════

  _resetShopForm() {
    document.getElementById('cs-name').value = '';
    document.getElementById('cs-price').value = '';
    document.getElementById('cs-size').value = '';
    document.getElementById('cs-desc').value = '';
    const condSel = document.getElementById('cs-condition');
    if (condSel) condSel.value = '9成新';
    ['cs-img1', 'cs-img2', 'cs-img3'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
    ['cs-preview1', 'cs-preview2', 'cs-preview3'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('has-image'); el.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-hint">JPG/PNG 2MB</span>'; }
    });
  },

});
