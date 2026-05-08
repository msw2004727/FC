/* ================================================
   SportHub — Ad Management: Banner CRUD
   依賴：ad-manage-core.js
   ================================================ */

Object.assign(App, {

  _bannerEditId: null,
  _watchPartyBgEditId: null,
  _watchPartyBgEnsuringSlot: false,

  renderBannerManage() {
    const container = document.getElementById('banner-manage-list');
    if (!container) return;
    const items = ApiService.getBanners();
    container.innerHTML = items.map(b => {
      const isEmpty = b.status === 'empty';
      const isActive = b.status === 'active';
      const isScheduled = b.status === 'scheduled';
      const remain = b.unpublishAt ? this._remainDays(b.unpublishAt) : 0;
      const isPermanent = !isEmpty && !b.unpublishAt;
      const statusLabel = isEmpty ? '空白' : isActive ? '啟用中' : isScheduled ? '已排程' : '已下架';
      const statusClass = isEmpty ? 'empty' : isActive ? 'active' : isScheduled ? 'scheduled' : 'expired';
      const timeInfo = isEmpty ? '尚未設定廣告' : (b.publishAt && b.unpublishAt ? `${b.publishAt} ~ ${b.unpublishAt}` : (b.publishAt ? `${b.publishAt} ~ 永久` : '尚未設定時間'));
      const remainText = isActive ? (isPermanent ? '永久' : `剩餘 ${remain} 天`) : '';
      const thumb = b.image
        ? `<div class="banner-thumb" style="overflow:hidden"><img src="${b.image}" style="width:100%;height:100%;object-fit:cover"></div>`
        : `<div class="banner-thumb banner-thumb-empty"><span>1200<br>×<br>545</span></div>`;
      return `
      <div class="banner-manage-card" style="margin-bottom:.5rem">
        ${thumb}
        <div class="banner-manage-info">
          <div style="display:flex;align-items:center;gap:.4rem">
            <div class="banner-manage-title">${escapeHTML(b.slotName || '廣告位 ' + b.slot)}${b.title ? ' — ' + escapeHTML(b.title) : ''}</div>
            <span class="banner-manage-status status-${statusClass}">${statusLabel}</span>
          </div>
          <div class="banner-manage-meta">${timeInfo}${remainText ? ' ・ ' + remainText : ''}${!isEmpty ? ' ・ 點擊 ' + (b.clicks || 0) + ' 次' : ''}</div>
          <div style="display:flex;gap:.3rem;margin-top:.3rem">
            ${this._adActionBtns('banner', b.id, b.status, b.unpublishAt)}
          </div>
        </div>
      </div>`;
    }).join('');
  },

  showBannerForm(editData) {
    const form = document.getElementById('banner-form-card');
    if (!form) return;
    this._bannerEditId = editData.id;
    const isEmpty = editData.status === 'empty';
    const slotLabel = editData.slotName || `廣告位 ${editData.slot}`;
    document.getElementById('banner-form-title').textContent = isEmpty ? `設定 ${slotLabel}` : `編輯 ${slotLabel}`;
    document.getElementById('banner-input-title').value = editData.title || '';
    document.getElementById('banner-input-link').value = editData.linkUrl || '';
    document.getElementById('banner-slot-display').value = slotLabel;
    const preview = document.getElementById('banner-preview');
    if (editData.image) {
      preview.innerHTML = `<img src="${editData.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    } else {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 1200 × 545 px｜JPG / PNG｜最大 5MB</span>';
    }
    document.getElementById('banner-image').value = '';
    const isScheduled = editData.status === 'scheduled';
    document.getElementById('banner-input-mode').value = isScheduled ? 'scheduled' : 'now';
    this.toggleBannerSchedule();
    if (isScheduled && editData.publishAt) {
      document.getElementById('banner-input-publish').value = editData.publishAt.replace(/\//g, '-').replace(' ', 'T');
    }
    document.getElementById('banner-input-unpublish').value = editData.unpublishAt ? editData.unpublishAt.replace(/\//g, '-').replace(' ', 'T') : '';
    this._openAdEditModal('banner-form-card', 'hideBannerForm');
  },

  hideBannerForm() {
    this._closeAdEditModal('banner-form-card');
    this._bannerEditId = null;
  },

  toggleBannerSchedule() {
    const mode = document.getElementById('banner-input-mode').value;
    document.getElementById('banner-publish-row').style.display = mode === 'scheduled' ? '' : 'none';
  },

  async saveBanner() {
    if (!this.hasPermission('admin.banners.entry')) {
      this.showToast('權限不足'); return;
    }
    const unpublishVal = document.getElementById('banner-input-unpublish').value;
    const title = document.getElementById('banner-input-title').value.trim();
    if (title.length > 12) { this.showToast('標題不可超過 12 字'); return; }
    const slotName = document.getElementById('banner-slot-display').value.trim();
    if (!slotName) { this.showToast('請輸入廣告位名稱'); return; }
    if (slotName.length > 12) { this.showToast('廣告位名稱不可超過 12 字'); return; }
    const linkUrl = document.getElementById('banner-input-link').value.trim();
    const mode = document.getElementById('banner-input-mode').value;
    const unpublishAt = unpublishVal ? this._formatDT(unpublishVal) : null;
    let publishAt, status;
    if (mode === 'scheduled') {
      const publishVal = document.getElementById('banner-input-publish').value;
      if (!publishVal) { this.showToast('請選擇啟用時間'); return; }
      publishAt = this._formatDT(publishVal);
      status = 'scheduled';
    } else {
      publishAt = this._formatDT(new Date().toISOString());
      status = 'active';
    }
    const previewImg = document.querySelector('#banner-preview img');
    let image = previewImg ? previewImg.src : (ApiService.getBanners().find(b => b.id === this._bannerEditId)?.image || null);
    if (image && image.startsWith('data:')) {
      this.showToast('圖片上傳中...');
      const url = await FirebaseService._uploadImage(image, `banners/${this._bannerEditId}`);
      if (!url) { this.showToast('圖片上傳失敗，請重試'); return; }
      image = url;
    }
    ApiService.updateBanner(this._bannerEditId, { title, slotName, linkUrl, image, publishAt, unpublishAt, status });
    this.showToast(status === 'scheduled' ? `Banner 已排程，將於 ${publishAt} 啟用` : 'Banner 已更新並立即啟用');
    this.hideBannerForm();
    this.renderBannerManage();
    this.renderBannerCarousel();
  },

  _getWatchPartyBgPlaceholder() {
    const existing = ApiService.getWatchPartyBg?.();
    if (existing) return existing;
    let source = null;
    if (typeof ApiService !== 'undefined' && typeof ApiService._src === 'function') {
      source = ApiService._src('banners');
    } else if (typeof FirebaseService !== 'undefined' && FirebaseService._cache) {
      source = FirebaseService._cache.banners;
    }
    if (!Array.isArray(source)) return null;
    const placeholder = {
      id: 'watch-party-bg',
      _docId: 'watch-party-bg',
      slot: 'watch-party-bg',
      type: 'watchParty',
      slotName: '觀賽聚會底圖',
      title: '',
      image: null,
      status: 'empty',
      publishAt: null,
      unpublishAt: null,
      clicks: 0,
      linkUrl: '',
    };
    source.push(placeholder);
    return placeholder;
  },

  async _ensureWatchPartyBgSlot() {
    if (this._watchPartyBgEnsuringSlot) return;
    if (typeof FirebaseService === 'undefined' || typeof FirebaseService._ensureWatchPartyBgSlot !== 'function') return;
    this._watchPartyBgEnsuringSlot = true;
    try {
      if (typeof _firebaseAuthReadyPromise !== 'undefined' && !_firebaseAuthReady) {
        await Promise.race([_firebaseAuthReadyPromise, new Promise(r => setTimeout(r, 5000))]);
      }
      await FirebaseService._ensureWatchPartyBgSlot();
    } catch (err) {
      console.warn('[WatchPartyBg] ensure slot failed:', err);
    } finally {
      this._watchPartyBgEnsuringSlot = false;
    }
  },

  renderWatchPartyBgManage() {
    const container = document.getElementById('watch-party-bg-manage-list');
    if (!container) return;
    let b = ApiService.getWatchPartyBg?.() || this._getWatchPartyBgPlaceholder();
    if (!b) {
      container.innerHTML = '<p style="color:var(--text-muted);padding:.5rem">觀賽聚會底圖載入中...</p>';
      this._ensureWatchPartyBgSlot().then(() => {
        const ensured = ApiService.getWatchPartyBg?.() || this._getWatchPartyBgPlaceholder();
        if (ensured) this.renderWatchPartyBgManage();
      });
      return;
    }
    this._ensureWatchPartyBgSlot();

    const isEmpty = b.status === 'empty';
    const isActive = b.status === 'active';
    const isScheduled = b.status === 'scheduled';
    const remain = b.unpublishAt ? this._remainDays(b.unpublishAt) : 0;
    const isPermanent = !isEmpty && !b.unpublishAt;
    const statusLabel = isEmpty ? '未設定' : isActive ? '顯示中' : isScheduled ? '排程中' : '已停用';
    const statusClass = isEmpty ? 'empty' : isActive ? 'active' : isScheduled ? 'scheduled' : 'expired';
    const timeInfo = isEmpty ? '首頁會使用預設樣式' : (b.publishAt && b.unpublishAt ? `${b.publishAt} ~ ${b.unpublishAt}` : (b.publishAt ? `${b.publishAt} ~ 長期` : '已設定底圖'));
    const remainText = isActive ? (isPermanent ? '長期' : `剩餘 ${remain} 天`) : '';
    const thumb = b.image
      ? `<div class="banner-thumb" style="overflow:hidden;aspect-ratio:5/1;width:128px;height:auto"><img src="${b.image}" style="width:100%;height:100%;object-fit:cover"></div>`
      : `<div class="banner-thumb banner-thumb-empty" style="aspect-ratio:5/1;width:128px;height:auto"><span>1000<br>×<br>200</span></div>`;
    container.innerHTML = `
    <div class="banner-manage-card" style="margin-bottom:.5rem">
      ${thumb}
      <div class="banner-manage-info">
        <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
          <div class="banner-manage-title">觀賽聚會底圖</div>
          <span class="banner-manage-status status-${statusClass}">${statusLabel}</span>
        </div>
        <div class="banner-manage-meta">${timeInfo}${remainText ? ' ・ ' + remainText : ''}${!isEmpty ? ' ・ 點擊 ' + (b.clicks || 0) + ' 次' : ''}</div>
        <div style="display:flex;gap:.3rem;margin-top:.3rem;flex-wrap:wrap">
          ${this._adActionBtns('watchparty', b.id || 'watch-party-bg', b.status, b.unpublishAt)}
        </div>
      </div>
    </div>`;
  },

  editWatchPartyBg(id) {
    if (!this.hasPermission('admin.banners.entry')) {
      this.showToast('權限不足'); return;
    }
    const item = ApiService.getWatchPartyBg?.() || this._getWatchPartyBgPlaceholder();
    if (item) this.showWatchPartyBgForm(item);
  },

  showWatchPartyBgForm(editData) {
    const form = document.getElementById('watch-party-bg-form-card');
    if (!form) return;
    this._watchPartyBgEditId = editData.id || editData._docId || 'watch-party-bg';
    const preview = document.getElementById('watch-party-bg-preview');
    if (editData.image) {
      preview.innerHTML = `<img src="${editData.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    } else {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">上傳觀賽聚會底圖</span><span class="ce-upload-hint">建議 1000 x 200 px，裁切後會套用到首頁觀賽聚會卡片</span>';
    }
    document.getElementById('watch-party-bg-visible').checked = editData.status === 'active';
    document.getElementById('watch-party-bg-image').value = '';
    this.bindImageUpload('watch-party-bg-image', 'watch-party-bg-preview', {
      aspectRatio: 5,
      outputWidth: 1000,
      outputHeight: 200,
      title: '觀賽聚會底圖',
      subtitle: '拖曳調整圖片位置，裁切後會套用到首頁那條觀賽聚會卡片。',
      targetLabel: '首頁觀賽聚會卡片',
      recommendedSize: '1000 x 200',
      aspectLabel: '5:1',
    });
    this._openAdEditModal('watch-party-bg-form-card', 'hideWatchPartyBgForm');
  },

  hideWatchPartyBgForm() {
    this._closeAdEditModal('watch-party-bg-form-card');
    this._watchPartyBgEditId = null;
  },

  async saveWatchPartyBg() {
    if (!this.hasPermission('admin.banners.entry')) {
      this.showToast('權限不足'); return;
    }
    await this._ensureWatchPartyBgSlot();
    const item = ApiService.getWatchPartyBg?.() || this._getWatchPartyBgPlaceholder();
    const id = this._watchPartyBgEditId || item?.id || item?._docId || 'watch-party-bg';
    const visible = document.getElementById('watch-party-bg-visible')?.checked === true;
    const previewImg = document.querySelector('#watch-party-bg-preview img');
    let image = previewImg ? previewImg.src : (item?.image || null);
    if (visible && !image) {
      this.showToast('請先上傳底圖');
      return;
    }
    if (image && image.startsWith('data:')) {
      this.showToast('圖片上傳中...');
      const url = await FirebaseService._uploadImage(image, 'banners/watch-party-bg');
      if (!url) { this.showToast('圖片上傳失敗，請重試'); return; }
      image = url;
    }
    const status = image ? (visible ? 'active' : 'expired') : 'empty';
    const publishAt = status === 'active' ? this._formatDT(new Date().toISOString()) : null;
    ApiService.updateWatchPartyBg(id, {
      slotName: '觀賽聚會底圖',
      slot: 'watch-party-bg',
      type: 'watchParty',
      title: '',
      linkUrl: '',
      image,
      publishAt,
      unpublishAt: null,
      status,
    });
    this.showToast(visible ? '觀賽聚會底圖已套用到首頁' : '觀賽聚會底圖已儲存但未顯示');
    this.hideWatchPartyBgForm();
    this.renderWatchPartyBgManage();
    this.renderHomeWatchPartyCard?.();
  },

  editBannerItem(id) {
    if (!this.hasPermission('admin.banners.entry')) {
      this.showToast('權限不足'); return;
    }
    const item = ApiService.getBanners().find(b => b.id === id);
    if (item) this.showBannerForm(item);
  },

});
