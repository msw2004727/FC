/* ================================================
   SportHub — Ad Management: Shot Game Ad CRUD
   依賴：ad-manage-core.js
   ================================================ */

Object.assign(App, {

  _sgAdEditId: null,
  _sgAdEnsuringSlot: false,

  _getShotGameAdPlaceholder() {
    const existing = ApiService.getShotGameAd();
    if (existing) return existing;

    // Use ApiService source first so demo/production read paths stay consistent.
    let source = null;
    if (typeof ApiService !== 'undefined' && typeof ApiService._src === 'function') {
      source = ApiService._src('banners');
    } else if (typeof FirebaseService !== 'undefined' && FirebaseService._cache) {
      source = FirebaseService._cache.banners;
    }
    if (!Array.isArray(source)) return null;

    const placeholder = {
      id: 'sga1',
      _docId: 'sga1',
      slot: 'sga1',
      type: 'shotgame',
      slotName: '射門遊戲廣告位',
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

  async _ensureShotGameAdSlot() {
    if (ModeManager.isDemo()) return;
    if (this._sgAdEnsuringSlot) return;
    if (typeof FirebaseService === 'undefined' || typeof FirebaseService._ensureSga1Slot !== 'function') return;
    this._sgAdEnsuringSlot = true;
    try {
      if (typeof _firebaseAuthReadyPromise !== 'undefined' && !_firebaseAuthReady) {
        await Promise.race([_firebaseAuthReadyPromise, new Promise(r => setTimeout(r, 5000))]);
      }
      await FirebaseService._ensureSga1Slot();
    } catch (err) {
      console.warn('[ShotGameAd] ensure sga1 slot failed:', err);
    } finally {
      this._sgAdEnsuringSlot = false;
    }
  },

  renderShotGameAdManage() {
    const container = document.getElementById('shotgame-ad-manage-list');
    if (!container) return;
    // Render immediately with a local placeholder so the UI never gets stuck in loading state.
    let b = ApiService.getShotGameAd() || this._getShotGameAdPlaceholder();
    if (!b) {
      container.innerHTML = '<p style="color:var(--text-muted);padding:.5rem">廣告位資料載入中...</p>';
      this._ensureShotGameAdSlot().then(() => {
        const ensured = ApiService.getShotGameAd() || this._getShotGameAdPlaceholder();
        if (ensured) this.renderShotGameAdManage();
        else container.innerHTML = '<p style="color:var(--text-muted);padding:.5rem">廣告位初始化失敗，請重新整理後再試</p>';
      });
      return;
    }
    if (!ModeManager.isDemo()) this._ensureShotGameAdSlot();

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
      : `<div class="banner-thumb banner-thumb-empty"><span>1200<br>×<br>400</span></div>`;
    container.innerHTML = `
    <div class="banner-manage-card" style="margin-bottom:.5rem">
      ${thumb}
      <div class="banner-manage-info">
        <div style="display:flex;align-items:center;gap:.4rem">
          <div class="banner-manage-title">射門遊戲廣告位${b.title ? ' — ' + escapeHTML(b.title) : ''}</div>
          <span class="banner-manage-status status-${statusClass}">${statusLabel}</span>
        </div>
        <div class="banner-manage-meta">${timeInfo}${remainText ? ' ・ ' + remainText : ''}${!isEmpty ? ' ・ 點擊 ' + (b.clicks || 0) + ' 次' : ''}</div>
        <div style="display:flex;gap:.3rem;margin-top:.3rem">
          ${this._adActionBtns('shotgame', b.id, b.status, b.unpublishAt)}
        </div>
      </div>
    </div>`;
  },

  editShotGameAd(id) {
    if (!this.hasPermission('admin.banners.entry')) {
      this.showToast('權限不足'); return;
    }
    const item = ApiService.getShotGameAd();
    if (item) this.showShotGameAdForm(item);
  },

  showShotGameAdForm(editData) {
    const form = document.getElementById('sgad-form-card');
    if (!form) return;
    form.style.display = '';
    this._sgAdEditId = editData.id;
    const isEmpty = editData.status === 'empty';
    document.getElementById('sgad-form-title').textContent = isEmpty ? '設定射門遊戲廣告位' : '編輯射門遊戲廣告位';
    document.getElementById('sgad-input-title').value = editData.title || '';
    document.getElementById('sgad-input-link').value = editData.linkUrl || '';
    const preview = document.getElementById('sgad-preview');
    if (editData.image) {
      preview.innerHTML = `<img src="${editData.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    } else {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 1200 × 400 px｜JPG / PNG｜最大 2MB</span>';
    }
    document.getElementById('sgad-image').value = '';
    this.bindImageUpload('sgad-image', 'sgad-preview');
    const isScheduled = editData.status === 'scheduled';
    document.getElementById('sgad-input-mode').value = isScheduled ? 'scheduled' : 'now';
    this.toggleSgAdSchedule();
    if (isScheduled && editData.publishAt) {
      document.getElementById('sgad-input-publish').value = editData.publishAt.replace(/\//g, '-').replace(' ', 'T');
    }
    document.getElementById('sgad-input-unpublish').value = editData.unpublishAt ? editData.unpublishAt.replace(/\//g, '-').replace(' ', 'T') : '';
    form.scrollIntoView({ behavior: 'smooth' });
  },

  hideShotGameAdForm() {
    const form = document.getElementById('sgad-form-card');
    if (form) form.style.display = 'none';
    this._sgAdEditId = null;
  },

  toggleSgAdSchedule() {
    const mode = document.getElementById('sgad-input-mode').value;
    document.getElementById('sgad-publish-row').style.display = mode === 'scheduled' ? '' : 'none';
  },

  async saveShotGameAd() {
    if (!this.hasPermission('admin.banners.entry')) {
      this.showToast('權限不足'); return;
    }
    const title = document.getElementById('sgad-input-title').value.trim();
    if (title.length > 12) { this.showToast('標題不可超過 12 字'); return; }
    const linkUrl = document.getElementById('sgad-input-link').value.trim();
    const mode = document.getElementById('sgad-input-mode').value;
    const unpublishVal = document.getElementById('sgad-input-unpublish').value;
    const unpublishAt = unpublishVal ? this._formatDT(unpublishVal) : null;
    let publishAt, status;
    if (mode === 'scheduled') {
      const publishVal = document.getElementById('sgad-input-publish').value;
      if (!publishVal) { this.showToast('請選擇啟用時間'); return; }
      publishAt = this._formatDT(publishVal);
      status = 'scheduled';
    } else {
      publishAt = this._formatDT(new Date().toISOString());
      status = 'active';
    }
    const previewImg = document.querySelector('#sgad-preview img');
    let image = previewImg ? previewImg.src : (ApiService.getShotGameAd()?.image || null);
    if (image && image.startsWith('data:') && !ModeManager.isDemo()) {
      this.showToast('圖片上傳中...');
      const url = await FirebaseService._uploadImage(image, `banners/${this._sgAdEditId}`);
      if (!url) { this.showToast('圖片上傳失敗，請重試'); return; }
      image = url;
    }
    ApiService.updateShotGameAd(this._sgAdEditId, { title, linkUrl, image, publishAt, unpublishAt, status });
    this.showToast(status === 'scheduled' ? `廣告已排程，將於 ${publishAt} 啟用` : '射門遊戲廣告已更新並立即啟用');
    this.hideShotGameAdForm();
    this.renderShotGameAdManage();
  },

});
