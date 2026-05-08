/* ================================================
   SportHub — Ad Management: Popup Ad & Sponsor CRUD
   依賴：ad-manage-core.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Popup Ad CRUD
  // ══════════════════════════════════

  _popupAdEditId: null,
  _sponsorEditId: null,

  renderPopupAdManage() {
    const container = document.getElementById('popup-ad-manage-list');
    if (!container) return;
    const ads = ApiService.getPopupAds();
    container.innerHTML = ads.map(ad => {
      const isEmpty = ad.status === 'empty';
      const isActive = ad.status === 'active';
      const isScheduled = ad.status === 'scheduled';
      const remain = ad.unpublishAt ? this._remainDays(ad.unpublishAt) : 0;
      const isPermanent = !isEmpty && !ad.unpublishAt;
      const statusLabel = isEmpty ? '空白' : isActive ? '啟用中' : isScheduled ? '已排程' : '已下架';
      const statusClass = isEmpty ? 'empty' : isActive ? 'active' : isScheduled ? 'scheduled' : 'expired';
      const timeInfo = isEmpty ? '尚未設定廣告' : (ad.publishAt && ad.unpublishAt ? `${ad.publishAt} ~ ${ad.unpublishAt}` : (ad.publishAt ? `${ad.publishAt} ~ 永久` : '尚未設定時間'));
      const remainText = isActive ? (isPermanent ? '永久' : `剩餘 ${remain} 天`) : '';
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
    this._openAdEditModal('popupad-form-card', 'hidePopupAdForm');
  },

  hidePopupAdForm() {
    this._closeAdEditModal('popupad-form-card');
    this._popupAdEditId = null;
  },

  togglePopupAdSchedule() {
    const mode = document.getElementById('popupad-input-mode').value;
    document.getElementById('popupad-publish-row').style.display = mode === 'scheduled' ? '' : 'none';
  },

  async savePopupAd() {
    const unpublishVal = document.getElementById('popupad-input-unpublish').value;
    const title = document.getElementById('popupad-input-title').value.trim();
    if (title.length > 12) { this.showToast('標題不可超過 12 字'); return; }
    const linkUrl = document.getElementById('popupad-input-link').value.trim();
    const mode = document.getElementById('popupad-input-mode').value;
    const unpublishAt = unpublishVal ? this._formatDT(unpublishVal) : null;
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
    if (image && image.startsWith('data:')) {
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
    if (!this.hasPermission('admin.banners.entry')) {
      this.showToast('權限不足'); return;
    }
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
      const isActive = sp.status === 'active';
      const statusClass = sp.status === 'empty' ? 'empty' : isActive ? 'active' : 'expired';
      const statusLabel = sp.status === 'empty' ? '未設定' : isActive ? '顯示中' : '已停用';
      return `
      <div class="sp-manage-row" data-id="${sp.id}">
        <span class="sp-row-num">${idx + 1}</span>
        <div class="sp-row-thumb${hasImage ? ' has-img' : ''}">
          ${thumb}
        </div>
        <div class="banner-manage-info" style="min-width:0">
          <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
            <div class="banner-manage-title">贊助商 ${sp.slot || idx + 1}</div>
            <span class="banner-manage-status status-${statusClass}">${statusLabel}</span>
          </div>
          <div class="banner-manage-meta">${sp.linkUrl ? escapeHTML(sp.linkUrl) : '未設定連結'}${hasImage ? ' · 點擊 ' + (sp.clicks || 0) + ' 次' : ''}</div>
        </div>
        <button class="sp-row-save" onclick="App.editSponsorItem('${sp.id}')">編輯</button>
        ${hasImage ? `<button class="sp-row-del" onclick="App.clearSponsorRow('${sp.id}')" title="清除">✕</button>` : ''}
      </div>`;
    }).join('');
  },

  showSponsorForm(editData) {
    const form = document.getElementById('sponsor-form-card');
    if (!form || !editData) return;
    this._sponsorEditId = editData.id;
    const title = document.getElementById('sponsor-form-title');
    if (title) title.textContent = `編輯贊助商 ${editData.slot || ''}`.trim();
    const linkInput = document.getElementById('sponsor-input-link');
    if (linkInput) linkInput.value = editData.linkUrl || '';
    const preview = document.getElementById('sponsor-preview');
    if (preview) {
      if (editData.image) {
        preview.innerHTML = `<img src="${editData.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
        preview.classList.add('has-image');
      } else {
        preview.classList.remove('has-image');
        preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">上傳贊助商圖片</span><span class="ce-upload-hint">建議使用清楚橫式圖片，JPG / PNG / WebP，5MB 內</span>';
      }
    }
    const input = document.getElementById('sponsor-image');
    if (input) input.value = '';
    this.bindImageUpload('sponsor-image', 'sponsor-preview', {
      outputWidth: 800,
      title: '贊助商圖片',
      subtitle: '拖曳調整圖片位置，裁切後會顯示在贊助商欄位。',
      targetLabel: '贊助商圖片',
      recommendedSize: '800 px 寬以上',
    });
    this._openAdEditModal('sponsor-form-card', 'hideSponsorForm');
  },

  hideSponsorForm() {
    this._closeAdEditModal('sponsor-form-card');
    this._sponsorEditId = null;
  },

  async saveSponsorForm() {
    if (!this.hasPermission('admin.banners.entry')) {
      this.showToast('權限不足'); return;
    }
    const id = this._sponsorEditId;
    if (!id) return;
    const previewImg = document.querySelector('#sponsor-preview img');
    const linkInput = document.getElementById('sponsor-input-link');
    const linkUrl = linkInput ? linkInput.value.trim() : '';
    let image = previewImg ? previewImg.src : null;
    if (!image) {
      const sp = ApiService.getSponsors().find(s => s.id === id);
      image = sp ? sp.image : null;
    }
    if (!image) {
      this.showToast('請先上傳圖片');
      return;
    }
    if (image.startsWith('data:')) {
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
    this.hideSponsorForm();
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
    if (!this.hasPermission('admin.banners.entry')) {
      this.showToast('權限不足'); return;
    }
    const item = ApiService.getSponsors().find(s => s.id === id);
    if (item) this.showSponsorForm(item);
  },

});
