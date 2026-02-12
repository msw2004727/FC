/* ================================================
   SportHub — Ad Management: Popup Ad & Sponsor CRUD
   依賴：ad-manage-core.js
   ================================================ */

Object.assign(App, {

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
          <div style="display:flex;align-items:center;gap:.4rem">
            <div class="banner-manage-title">第 ${ad.layer} 層${ad.title ? ' — ' + escapeHTML(ad.title) : ''}</div>
            <span class="banner-manage-status status-${statusClass}">${statusLabel}</span>
          </div>
          <div class="banner-manage-meta">${timeInfo}${remainText ? ' ・ ' + remainText : ''}${!isEmpty ? ' ・ 點擊 ' + (ad.clicks || 0) + ' 次' : ''}</div>
          <div style="display:flex;gap:.3rem;margin-top:.3rem">
            ${this._adActionBtns('popup', ad.id, ad.status, ad.unpublishAt)}
          </div>
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
    if (title.length > 12) { this.showToast('標題不可超過 12 字'); return; }
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
    const previewImg = document.querySelector('#popupad-preview img');
    let image = previewImg ? previewImg.src : (ApiService.getPopupAds().find(a => a.id === this._popupAdEditId)?.image || null);
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

  // ══════════════════════════════════
  //  Sponsor CRUD（直式 6 列）
  // ══════════════════════════════════

  renderSponsorManage() {
    const container = document.getElementById('sponsor-manage-list');
    if (!container) return;
    const items = ApiService.getSponsors().sort((a, b) => (a.slot || 0) - (b.slot || 0));
    container.innerHTML = items.map((sp, idx) => {
      const hasImage = sp.image && sp.status !== 'empty';
      const thumb = hasImage
        ? `<img src="${sp.image}" style="width:100%;height:100%;object-fit:cover;border-radius:4px">`
        : `<span class="sp-row-upload-hint">+</span>`;
      return `
      <div class="sp-manage-row" data-id="${sp.id}">
        <span class="sp-row-num">${idx + 1}</span>
        <div class="sp-row-thumb${hasImage ? ' has-img' : ''}" onclick="App.triggerSponsorUpload('${sp.id}')">
          ${thumb}
          <input type="file" class="sp-row-file" data-sp="${sp.id}" accept=".jpg,.jpeg,.png" hidden>
        </div>
        <input type="text" class="sp-row-link" data-sp="${sp.id}" value="${escapeHTML(sp.linkUrl || '')}" placeholder="連結網址（選填）">
        <button class="sp-row-save" onclick="App.saveSponsorRow('${sp.id}')">儲存</button>
        ${hasImage ? `<button class="sp-row-del" onclick="App.clearSponsorRow('${sp.id}')" title="清除">✕</button>` : ''}
      </div>`;
    }).join('');

    // 綁定每一列的 file input change
    container.querySelectorAll('.sp-row-file').forEach(input => {
      input.addEventListener('change', (e) => this._handleSponsorFileChange(e));
    });
  },

  triggerSponsorUpload(id) {
    const input = document.querySelector(`.sp-row-file[data-sp="${id}"]`);
    if (input) input.click();
  },

  async _handleSponsorFileChange(e) {
    const input = e.target;
    const file = input.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      this.showToast('僅支援 JPG / PNG 格式');
      input.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.showToast('檔案大小不可超過 5MB');
      input.value = '';
      return;
    }
    const dataURL = await this._compressImage(file);
    const thumb = input.closest('.sp-manage-row').querySelector('.sp-row-thumb');
    if (thumb) {
      thumb.innerHTML = `<img src="${dataURL}" style="width:100%;height:100%;object-fit:cover;border-radius:4px">${input.outerHTML}`;
      thumb.classList.add('has-img');
      // 重新綁定新 input
      const newInput = thumb.querySelector('.sp-row-file');
      if (newInput) newInput.addEventListener('change', (e2) => this._handleSponsorFileChange(e2));
    }
  },

  async saveSponsorRow(id) {
    const row = document.querySelector(`.sp-manage-row[data-id="${id}"]`);
    if (!row) return;
    const thumbImg = row.querySelector('.sp-row-thumb img');
    const linkInput = row.querySelector('.sp-row-link');
    const linkUrl = linkInput ? linkInput.value.trim() : '';

    let image = thumbImg ? thumbImg.src : null;
    if (!image) {
      // 保留原有圖片
      const sp = ApiService.getSponsors().find(s => s.id === id);
      image = sp ? sp.image : null;
    }

    if (!image) {
      this.showToast('請先上傳圖片');
      return;
    }

    // Firebase 模式上傳 base64
    if (image.startsWith('data:') && !ModeManager.isDemo()) {
      this.showToast('圖片上傳中...');
      const url = await FirebaseService._uploadImage(image, `sponsors/${id}`);
      if (!url) { this.showToast('圖片上傳失敗，請重試'); return; }
      image = url;
    }

    const now = this._formatDT(new Date().toISOString());
    ApiService.updateSponsor(id, {
      image,
      linkUrl,
      status: 'active',
      publishAt: now,
      unpublishAt: null,
      title: ''
    });
    this.showToast('贊助商已儲存');
    this.renderSponsorManage();
    this.renderSponsors();
  },

  async clearSponsorRow(id) {
    if (!(await this.appConfirm('確定要清除此贊助商欄位？'))) return;
    ApiService.updateSponsor(id, {
      title: '', image: null, linkUrl: '', status: 'empty',
      publishAt: null, unpublishAt: null, clicks: 0
    });
    this.showToast('已清除');
    this.renderSponsorManage();
    this.renderSponsors();
  },

  editSponsorItem(id) {
    // 直式模式不需要單獨表單，直接滾動到該列
    const row = document.querySelector(`.sp-manage-row[data-id="${id}"]`);
    if (row) row.scrollIntoView({ behavior: 'smooth' });
  },

});
