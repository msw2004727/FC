/* ================================================
   SportHub — Ad Management: Banner CRUD
   依賴：ad-manage-core.js
   ================================================ */

Object.assign(App, {

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
    form.style.display = '';
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
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 1200 × 400 px｜JPG / PNG｜最大 5MB</span>';
    }
    document.getElementById('banner-image').value = '';
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
    if (title.length > 12) { this.showToast('標題不可超過 12 字'); return; }
    const slotName = document.getElementById('banner-slot-display').value.trim();
    if (!slotName) { this.showToast('請輸入廣告位名稱'); return; }
    if (slotName.length > 12) { this.showToast('廣告位名稱不可超過 12 字'); return; }
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
    const previewImg = document.querySelector('#banner-preview img');
    let image = previewImg ? previewImg.src : (ApiService.getBanners().find(b => b.id === this._bannerEditId)?.image || null);
    if (image && image.startsWith('data:') && !ModeManager.isDemo()) {
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

  editBannerItem(id) {
    const item = ApiService.getBanners().find(b => b.id === id);
    if (item) this.showBannerForm(item);
  },

});
