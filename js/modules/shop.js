/* ================================================
   SportHub — Shop (Render + Create + Manage)
   ================================================ */

Object.assign(App, {

  renderShop() {
    const container = document.getElementById('shop-grid');
    container.innerHTML = ApiService.getShopItems().map(s => {
      const hasImg = s.images && s.images.length > 0;
      const imgHtml = hasImg
        ? `<img src="${s.images[0]}" style="width:100%;height:100%;object-fit:cover">`
        : `<div class="shop-img-placeholder">商品圖 150 × 150</div>`;
      return `
      <div class="shop-card" onclick="App.showShopDetail('${s.id}')">
        <div class="shop-img-wrap">${imgHtml}</div>
        <div class="shop-body">
          <div class="shop-name">${s.name}</div>
          <div class="shop-price">$${s.price.toLocaleString()}</div>
          <div class="shop-meta">${s.condition} ・ ${s.size}</div>
        </div>
      </div>`;
    }).join('');
  },

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
          <div class="td-card-item"><span class="td-card-label">價格</span><span class="td-card-value" style="color:var(--accent)">$${s.price.toLocaleString()}</span></div>
          <div class="td-card-item"><span class="td-card-label">尺寸</span><span class="td-card-value">${s.size}</span></div>
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title">商品描述</div>
        <p style="font-size:.85rem;color:var(--text-secondary);line-height:1.7">${s.desc || '賣家未提供描述。'}</p>
      </div>
      <div class="td-actions">
        <button class="primary-btn" onclick="App.showToast('已發送購買意願！')">我想購買</button>
        <button class="outline-btn" onclick="App.showToast('已透過站內信聯繫賣家')">聯繫賣家</button>
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
      this.showToast('Demo 模式：尚未上傳實際圖片');
    }
  },

  closeLightbox() {
    document.getElementById('lightbox')?.classList.remove('open');
  },

  // ══════════════════════════════════
  //  Shop Management (Admin)
  // ══════════════════════════════════

  renderShopManage() {
    const container = document.getElementById('shop-manage-list');
    if (!container) return;
    container.innerHTML = ApiService.getShopItems().map(s => {
      const hasImg = s.images && s.images.length > 0;
      const thumbHtml = hasImg
        ? `<div class="sm-thumb" style="overflow:hidden"><img src="${s.images[0]}" style="width:100%;height:100%;object-fit:cover"></div>`
        : `<div class="sm-thumb">商品縮圖<br>60 × 60</div>`;
      return `
      <div class="sm-card">
        ${thumbHtml}
        <div class="sm-info">
          <div class="sm-title">${s.name}</div>
          <div class="sm-meta">${s.condition} ・ ${s.size} ・ <strong style="color:var(--accent)">$${s.price}</strong></div>
          <div style="display:flex;gap:.3rem;margin-top:.3rem">
            <button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="App.showShopDetail('${s.id}')">查看</button>
            <button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem;color:var(--danger)">下架</button>
          </div>
        </div>
      </div>`;
    }).join('');
  },

  // ══════════════════════════════════
  //  Create Shop Item
  // ══════════════════════════════════

  _shopCounter: 100,
  async handleCreateShopItem() {
    const name = document.getElementById('cs-name').value.trim();
    const condition = document.getElementById('cs-condition').value;
    const price = parseInt(document.getElementById('cs-price').value) || 0;
    const size = document.getElementById('cs-size').value.trim() || '—';
    const desc = document.getElementById('cs-desc').value.trim();

    if (!name) { this.showToast('請輸入商品名稱'); return; }
    if (price <= 0) { this.showToast('請輸入價格'); return; }
    if (desc.length > 500) { this.showToast('描述不可超過 500 字'); return; }

    // 收集已上傳的圖片
    const images = [];
    ['cs-preview1','cs-preview2','cs-preview3'].forEach(id => {
      const img = document.getElementById(id)?.querySelector('img');
      if (img) images.push(img.src);
    });

    this._shopCounter++;
    const itemId = 'cs' + this._shopCounter;

    // 正式版：上傳 base64 圖片到 Storage
    if (!ModeManager.isDemo() && images.length > 0) {
      this.showToast('圖片上傳中...');
      for (let i = 0; i < images.length; i++) {
        if (images[i] && images[i].startsWith('data:')) {
          const url = await FirebaseService._uploadImage(images[i], `shopItems/${itemId}_${i}`);
          if (url) images[i] = url;
        }
      }
    }

    ApiService.createShopItem({
      id: itemId,
      name, price, condition, year: 2026, size,
      desc: desc || '賣家未提供描述。',
      images,
    });

    this.renderShop();
    this.renderShopManage();
    this.closeModal();
    this.showToast(`商品「${name}」已上架！`);

    document.getElementById('cs-name').value = '';
    document.getElementById('cs-price').value = '';
    document.getElementById('cs-size').value = '';
    document.getElementById('cs-desc').value = '';
    ['cs-img1','cs-img2','cs-img3'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
    ['cs-preview1','cs-preview2','cs-preview3'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('has-image'); el.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-hint">JPG/PNG 2MB</span>'; }
    });
  },

});
