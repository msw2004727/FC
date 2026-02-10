/* ================================================
   SportHub — Ad Management (Banner / Floating / Popup CRUD)
   ================================================ */

Object.assign(App, {

  // ── Shared Utils ──

  _formatDT(isoStr) {
    const d = new Date(isoStr);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },

  _remainDays(unpublishAt) {
    const diff = new Date(unpublishAt.replace(/\//g, '-')) - new Date();
    return Math.max(0, Math.ceil(diff / 86400000));
  },

  // ══════════════════════════════════
  //  Banner CRUD
  // ══════════════════════════════════

  _bannerEditId: null,

  renderBannerManage() {
    const container = document.getElementById('banner-manage-list');
    if (!container) return;
    const items = ApiService.getBanners();
    container.innerHTML = items.map(b => {
      const isEmpty = b.status === 'empty';
      const isActive = b.status === 'active';
      const isScheduled = b.status === 'scheduled';
      const remain = b.unpublishAt ? this._remainDays(b.unpublishAt) : 0;
      const statusLabel = isEmpty ? '空白' : isActive ? '啟用中' : isScheduled ? '已排程' : '已下架';
      const statusClass = isEmpty ? 'empty' : isActive ? 'active' : isScheduled ? 'scheduled' : 'expired';
      const timeInfo = isEmpty ? '尚未設定廣告' : (b.publishAt && b.unpublishAt ? `${b.publishAt} ~ ${b.unpublishAt}` : '尚未設定時間');
      const remainText = isActive ? `剩餘 ${remain} 天` : '';
      const thumb = b.image
        ? `<div class="banner-thumb" style="overflow:hidden"><img src="${b.image}" style="width:100%;height:100%;object-fit:cover"></div>`
        : `<div class="banner-thumb banner-thumb-empty"><span>1200<br>×<br>400</span></div>`;
      return `
      <div class="banner-manage-card" style="margin-bottom:.5rem">
        ${thumb}
        <div class="banner-manage-info">
          <div class="banner-manage-title">廣告位 ${b.slot}${b.title ? ' — ' + b.title : ''}</div>
          <div class="banner-manage-meta">${timeInfo}${remainText ? ' ・ ' + remainText : ''}</div>
          ${!isEmpty ? `<div class="banner-manage-meta">點擊 ${b.clicks}</div>` : ''}
          <span class="banner-manage-status status-${statusClass}">${statusLabel}</span>
        </div>
        <div style="flex-shrink:0">
          <button class="text-btn" style="font-size:.72rem" onclick="App.editBannerItem('${b.id}')">${isEmpty ? '設定' : '編輯'}</button>
        </div>
      </div>`;
    }).join('');
  },

  showBannerForm(editData) {
    const form = document.getElementById('banner-form-card');
    if (!form) return;
    form.style.display = '';
    this._bannerEditId = editData.id;
    const isEmpty = editData.status === 'empty';
    document.getElementById('banner-form-title').textContent = isEmpty ? `設定廣告位 ${editData.slot}` : `編輯廣告位 ${editData.slot}`;
    document.getElementById('banner-input-title').value = editData.title || '';
    document.getElementById('banner-input-link').value = editData.linkUrl || '';
    document.getElementById('banner-slot-display').textContent = `廣告位 ${editData.slot}`;
    const preview = document.getElementById('banner-preview');
    if (editData.image) {
      preview.innerHTML = `<img src="${editData.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    } else {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 1200 × 400 px｜JPG / PNG｜最大 2MB</span>';
    }
    document.getElementById('banner-image').value = '';
    // Mode
    const isScheduled = editData.status === 'scheduled';
    document.getElementById('banner-input-mode').value = isScheduled ? 'scheduled' : 'now';
    this.toggleBannerSchedule();
    if (isScheduled && editData.publishAt) {
      document.getElementById('banner-input-publish').value = editData.publishAt.replace(/\//g, '-').replace(' ', 'T');
    }
    document.getElementById('banner-input-unpublish').value = editData.unpublishAt ? editData.unpublishAt.replace(/\//g, '-').replace(' ', 'T') : '';
    form.scrollIntoView({ behavior: 'smooth' });
  },

  hideBannerForm() {
    const form = document.getElementById('banner-form-card');
    if (form) form.style.display = 'none';
    this._bannerEditId = null;
  },

  toggleBannerSchedule() {
    const mode = document.getElementById('banner-input-mode').value;
    document.getElementById('banner-publish-row').style.display = mode === 'scheduled' ? '' : 'none';
  },

  async saveBanner() {
    const unpublishVal = document.getElementById('banner-input-unpublish').value;
    if (!unpublishVal) { this.showToast('請選擇結束時間'); return; }
    const title = document.getElementById('banner-input-title').value.trim();
    const linkUrl = document.getElementById('banner-input-link').value.trim();
    const mode = document.getElementById('banner-input-mode').value;
    const unpublishAt = this._formatDT(unpublishVal);
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
    // Get image from preview
    const previewImg = document.querySelector('#banner-preview img');
    let image = previewImg ? previewImg.src : (ApiService.getBanners().find(b => b.id === this._bannerEditId)?.image || null);
    // 正式版：上傳 base64 圖片到 Storage
    if (image && image.startsWith('data:') && !ModeManager.isDemo()) {
      this.showToast('圖片上傳中...');
      const url = await FirebaseService._uploadImage(image, `banners/${this._bannerEditId}`);
      if (!url) { this.showToast('圖片上傳失敗，請重試'); return; }
      image = url;
    }
    ApiService.updateBanner(this._bannerEditId, { title, linkUrl, image, publishAt, unpublishAt, status });
    this.showToast(status === 'scheduled' ? `Banner 已排程，將於 ${publishAt} 啟用` : 'Banner 已更新並立即啟用');
    this.hideBannerForm();
    this.renderBannerManage();
    this.renderBannerCarousel();
  },

  editBannerItem(id) {
    const item = ApiService.getBanners().find(b => b.id === id);
    if (item) this.showBannerForm(item);
  },

  // ══════════════════════════════════
  //  Floating Ad CRUD
  // ══════════════════════════════════

  _floatAdEditId: null,

  renderFloatingAdManage() {
    const container = document.getElementById('floating-ad-manage-list');
    if (!container) return;
    const ads = ApiService.getFloatingAds();
    container.innerHTML = ads.map(ad => {
      const isEmpty = ad.status === 'empty';
      const isActive = ad.status === 'active';
      const isScheduled = ad.status === 'scheduled';
      const remain = ad.unpublishAt ? this._remainDays(ad.unpublishAt) : 0;
      const statusLabel = isEmpty ? '空白' : isActive ? '啟用中' : isScheduled ? '已排程' : '已下架';
      const statusClass = isEmpty ? 'empty' : isActive ? 'active' : isScheduled ? 'scheduled' : 'expired';
      const timeInfo = isEmpty ? '尚未設定廣告' : (ad.publishAt && ad.unpublishAt ? `${ad.publishAt} ~ ${ad.unpublishAt}` : '尚未設定時間');
      const remainText = isActive ? `剩餘 ${remain} 天` : '';
      const thumb = ad.image
        ? `<div class="banner-thumb banner-thumb-circle" style="overflow:hidden"><img src="${ad.image}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`
        : `<div class="banner-thumb banner-thumb-circle banner-thumb-empty"><span>200<br>×<br>200</span></div>`;
      return `
      <div class="banner-manage-card" style="margin-bottom:.5rem">
        ${thumb}
        <div class="banner-manage-info">
          <div class="banner-manage-title">${ad.slot}${ad.title ? ' — ' + ad.title : ''}</div>
          <div class="banner-manage-meta">${timeInfo}${remainText ? ' ・ ' + remainText : ''}</div>
          <span class="banner-manage-status status-${statusClass}">${statusLabel}</span>
        </div>
        <div style="flex-shrink:0">
          <button class="text-btn" style="font-size:.72rem" onclick="App.editFloatingAd('${ad.id}')">${isEmpty ? '設定' : '編輯'}</button>
        </div>
      </div>`;
    }).join('');
  },

  showFloatingAdForm(editData) {
    const form = document.getElementById('floatad-form-card');
    if (!form) return;
    form.style.display = '';
    this._floatAdEditId = editData.id;
    const isEmpty = editData.status === 'empty';
    document.getElementById('floatad-form-title').textContent = isEmpty ? `設定 ${editData.slot}` : `編輯 ${editData.slot}`;
    document.getElementById('floatad-input-title').value = editData.title || '';
    document.getElementById('floatad-input-link').value = editData.linkUrl || '';
    const preview = document.getElementById('floatad-preview');
    if (editData.image) {
      preview.innerHTML = `<img src="${editData.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    } else {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 200 × 200 px｜JPG / PNG｜最大 2MB</span>';
    }
    document.getElementById('floatad-image').value = '';
    // Mode
    const isScheduled = editData.status === 'scheduled';
    document.getElementById('floatad-input-mode').value = isScheduled ? 'scheduled' : 'now';
    this.toggleFloatAdSchedule();
    if (isScheduled && editData.publishAt) {
      document.getElementById('floatad-input-publish').value = editData.publishAt.replace(/\//g, '-').replace(' ', 'T');
    }
    document.getElementById('floatad-input-unpublish').value = editData.unpublishAt ? editData.unpublishAt.replace(/\//g, '-').replace(' ', 'T') : '';
    form.scrollIntoView({ behavior: 'smooth' });
  },

  hideFloatingAdForm() {
    const form = document.getElementById('floatad-form-card');
    if (form) form.style.display = 'none';
    this._floatAdEditId = null;
  },

  toggleFloatAdSchedule() {
    const mode = document.getElementById('floatad-input-mode').value;
    document.getElementById('floatad-publish-row').style.display = mode === 'scheduled' ? '' : 'none';
  },

  async saveFloatingAd() {
    const unpublishVal = document.getElementById('floatad-input-unpublish').value;
    if (!unpublishVal) { this.showToast('請選擇結束時間'); return; }
    const title = document.getElementById('floatad-input-title').value.trim();
    const linkUrl = document.getElementById('floatad-input-link').value.trim();
    const mode = document.getElementById('floatad-input-mode').value;
    const unpublishAt = this._formatDT(unpublishVal);
    let publishAt, status;
    if (mode === 'scheduled') {
      const publishVal = document.getElementById('floatad-input-publish').value;
      if (!publishVal) { this.showToast('請選擇啟用時間'); return; }
      publishAt = this._formatDT(publishVal);
      status = 'scheduled';
    } else {
      publishAt = this._formatDT(new Date().toISOString());
      status = 'active';
    }
    // Get image from preview
    const previewImg = document.querySelector('#floatad-preview img');
    let image = previewImg ? previewImg.src : (ApiService.getFloatingAds().find(a => a.id === this._floatAdEditId)?.image || null);
    // 正式版：上傳 base64 圖片到 Storage
    if (image && image.startsWith('data:') && !ModeManager.isDemo()) {
      this.showToast('圖片上傳中...');
      const url = await FirebaseService._uploadImage(image, `floatingAds/${this._floatAdEditId}`);
      if (!url) { this.showToast('圖片上傳失敗，請重試'); return; }
      image = url;
    }
    ApiService.updateFloatingAd(this._floatAdEditId, { title, linkUrl, image, publishAt, unpublishAt, status });
    this.showToast(status === 'scheduled' ? `浮動廣告已排程，將於 ${publishAt} 啟用` : '浮動廣告已更新並立即啟用');
    this.hideFloatingAdForm();
    this.renderFloatingAdManage();
    this.renderFloatingAds();
  },

  editFloatingAd(id) {
    const item = ApiService.getFloatingAds().find(a => a.id === id);
    if (item) this.showFloatingAdForm(item);
  },

  // ══════════════════════════════════
  //  Popup Ad CRUD
  // ══════════════════════════════════

  _popupAdEditId: null,

  renderPopupAdManage() {
    const container = document.getElementById('popup-ad-manage-list');
    if (!container) return;
    const ads = ApiService.getPopupAds();
    container.innerHTML = ads.map(ad => {
      const isEmpty = ad.status === 'empty';
      const isActive = ad.status === 'active';
      const isScheduled = ad.status === 'scheduled';
      const remain = ad.unpublishAt ? this._remainDays(ad.unpublishAt) : 0;
      const statusLabel = isEmpty ? '空白' : isActive ? '啟用中' : isScheduled ? '已排程' : '已下架';
      const statusClass = isEmpty ? 'empty' : isActive ? 'active' : isScheduled ? 'scheduled' : 'expired';
      const timeInfo = isEmpty ? '尚未設定廣告' : (ad.publishAt && ad.unpublishAt ? `${ad.publishAt} ~ ${ad.unpublishAt}` : '尚未設定時間');
      const remainText = isActive ? `剩餘 ${remain} 天` : '';
      const thumb = ad.image
        ? `<div class="banner-thumb" style="overflow:hidden"><img src="${ad.image}" style="width:100%;height:100%;object-fit:cover"></div>`
        : `<div class="banner-thumb banner-thumb-empty"><span>600<br>×<br>800</span></div>`;
      return `
      <div class="banner-manage-card" style="margin-bottom:.5rem">
        ${thumb}
        <div class="banner-manage-info">
          <div class="banner-manage-title">第 ${ad.layer} 層${ad.title ? ' — ' + ad.title : ''}</div>
          <div class="banner-manage-meta">${timeInfo}${remainText ? ' ・ ' + remainText : ''}</div>
          ${!isEmpty ? `<div class="banner-manage-meta">點擊 ${ad.clicks || 0}</div>` : ''}
          <span class="banner-manage-status status-${statusClass}">${statusLabel}</span>
        </div>
        <div style="flex-shrink:0">
          <button class="text-btn" style="font-size:.72rem" onclick="App.editPopupAd('${ad.id}')">${isEmpty ? '設定' : '編輯'}</button>
        </div>
      </div>`;
    }).join('');
  },

  showPopupAdForm(editData) {
    const form = document.getElementById('popupad-form-card');
    if (!form || !editData) return;
    form.style.display = '';
    this._popupAdEditId = editData.id;
    const isEmpty = editData.status === 'empty';
    document.getElementById('popupad-form-title').textContent = isEmpty ? `設定廣告位 第 ${editData.layer} 層` : `編輯廣告位 第 ${editData.layer} 層`;
    document.getElementById('popupad-layer-display').textContent = `第 ${editData.layer} 層`;
    document.getElementById('popupad-input-title').value = editData.title || '';
    document.getElementById('popupad-input-link').value = editData.linkUrl || '';
    const preview = document.getElementById('popupad-preview');
    if (editData.image) {
      preview.innerHTML = `<img src="${editData.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    } else {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 600 × 800 px｜JPG / PNG｜最大 2MB</span>';
    }
    document.getElementById('popupad-image').value = '';
    const isScheduled = editData.status === 'scheduled';
    document.getElementById('popupad-input-mode').value = isScheduled ? 'scheduled' : 'now';
    this.togglePopupAdSchedule();
    if (isScheduled && editData.publishAt) {
      document.getElementById('popupad-input-publish').value = editData.publishAt.replace(/\//g, '-').replace(' ', 'T');
    }
    document.getElementById('popupad-input-unpublish').value = editData.unpublishAt ? editData.unpublishAt.replace(/\//g, '-').replace(' ', 'T') : '';
    form.scrollIntoView({ behavior: 'smooth' });
  },

  hidePopupAdForm() {
    const form = document.getElementById('popupad-form-card');
    if (form) form.style.display = 'none';
    this._popupAdEditId = null;
  },

  togglePopupAdSchedule() {
    const mode = document.getElementById('popupad-input-mode').value;
    document.getElementById('popupad-publish-row').style.display = mode === 'scheduled' ? '' : 'none';
  },

  async savePopupAd() {
    const unpublishVal = document.getElementById('popupad-input-unpublish').value;
    if (!unpublishVal) { this.showToast('請選擇結束時間'); return; }
    const title = document.getElementById('popupad-input-title').value.trim();
    const linkUrl = document.getElementById('popupad-input-link').value.trim();
    const mode = document.getElementById('popupad-input-mode').value;
    const unpublishAt = this._formatDT(unpublishVal);
    let publishAt, status;
    if (mode === 'scheduled') {
      const publishVal = document.getElementById('popupad-input-publish').value;
      if (!publishVal) { this.showToast('請選擇啟用時間'); return; }
      publishAt = this._formatDT(publishVal);
      status = 'scheduled';
    } else {
      publishAt = this._formatDT(new Date().toISOString());
      status = 'active';
    }
    // Get image from preview
    const previewImg = document.querySelector('#popupad-preview img');
    let image = previewImg ? previewImg.src : (ApiService.getPopupAds().find(a => a.id === this._popupAdEditId)?.image || null);
    // 正式版：上傳 base64 圖片到 Storage
    if (image && image.startsWith('data:') && !ModeManager.isDemo()) {
      this.showToast('圖片上傳中...');
      const url = await FirebaseService._uploadImage(image, `popupAds/${this._popupAdEditId}`);
      if (!url) { this.showToast('圖片上傳失敗，請重試'); return; }
      image = url;
    }
    ApiService.updatePopupAd(this._popupAdEditId, { title, linkUrl, image, publishAt, unpublishAt, status });
    this.showToast(status === 'scheduled' ? `彈跳廣告已排程，將於 ${publishAt} 啟用` : '彈跳廣告已更新並立即啟用');
    this.hidePopupAdForm();
    this.renderPopupAdManage();
  },

  editPopupAd(id) {
    const item = ApiService.getPopupAds().find(a => a.id === id);
    if (item) this.showPopupAdForm(item);
  },

});
