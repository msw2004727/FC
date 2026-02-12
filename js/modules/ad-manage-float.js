/* ================================================
   SportHub — Ad Management: Floating Ad CRUD
   依賴：ad-manage-core.js
   ================================================ */

Object.assign(App, {

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
          <div style="display:flex;align-items:center;gap:.4rem">
            <div class="banner-manage-title">${escapeHTML(ad.slot)}${ad.title ? ' — ' + escapeHTML(ad.title) : ''}</div>
            <span class="banner-manage-status status-${statusClass}">${statusLabel}</span>
          </div>
          <div class="banner-manage-meta">${timeInfo}${remainText ? ' ・ ' + remainText : ''}${!isEmpty ? ' ・ 點擊 ' + (ad.clicks || 0) + ' 次' : ''}</div>
          <div style="display:flex;gap:.3rem;margin-top:.3rem">
            ${this._adActionBtns('float', ad.id, ad.status, ad.unpublishAt)}
          </div>
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
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 200 × 200 px｜JPG / PNG｜最大 5MB</span>';
    }
    document.getElementById('floatad-image').value = '';
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
    if (title.length > 12) { this.showToast('標題不可超過 12 字'); return; }
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
    const previewImg = document.querySelector('#floatad-preview img');
    let image = previewImg ? previewImg.src : (ApiService.getFloatingAds().find(a => a.id === this._floatAdEditId)?.image || null);
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

});
