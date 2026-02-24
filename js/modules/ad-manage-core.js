/* ================================================
   SportHub — Ad Management: Core Utilities & Generic Ops
   依賴：config.js, data.js, api-service.js
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

  // 自動下架已過期廣告
  _autoExpireAds() {
    const now = new Date();
    const check = (items, updateFn) => {
      items.forEach(ad => {
        if ((ad.status === 'active' || ad.status === 'scheduled') && ad.unpublishAt) {
          const end = new Date(ad.unpublishAt.replace(/\//g, '-'));
          if (end <= now) {
            ad.status = 'expired';
            updateFn(ad.id, { status: 'expired' });
          }
        }
      });
    };
    check(ApiService.getBanners(), (id, u) => ApiService.updateBanner(id, u));
    check(ApiService.getFloatingAds(), (id, u) => ApiService.updateFloatingAd(id, u));
    check(ApiService.getPopupAds(), (id, u) => ApiService.updatePopupAd(id, u));
    check(ApiService.getSponsors(), (id, u) => ApiService.updateSponsor(id, u));
  },

  // 廣告動作按鈕 HTML（水平排列，比照商品管理）
  _adActionBtns(type, id, status, unpublishAt) {
    const s = 'font-size:.72rem;padding:.2rem .5rem';
    const btns = [];
    if (status === 'empty') {
      btns.push(`<button class="primary-btn small" style="${s}" onclick="App.editAd('${type}','${id}')">設定</button>`);
    } else if (status === 'active') {
      btns.push(`<button class="primary-btn small" style="${s}" onclick="App.editAd('${type}','${id}')">編輯</button>`);
      btns.push(`<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.delistAd('${type}','${id}')">下架</button>`);
      btns.push(`<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.clearAdSlot('${type}','${id}')">刪除</button>`);
    } else if (status === 'scheduled') {
      btns.push(`<button class="primary-btn small" style="${s}" onclick="App.editAd('${type}','${id}')">編輯</button>`);
      btns.push(`<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.clearAdSlot('${type}','${id}')">刪除</button>`);
    } else {
      // expired / delisted
      const canRelist = !unpublishAt || this._remainDays(unpublishAt) > 0;
      btns.push(`<button class="primary-btn small" style="${s}" onclick="App.editAd('${type}','${id}')">編輯</button>`);
      if (canRelist) {
        btns.push(`<button class="outline-btn" style="${s};color:var(--success)" onclick="App.relistAd('${type}','${id}')">重新上架</button>`);
      }
      btns.push(`<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.clearAdSlot('${type}','${id}')">刪除</button>`);
    }
    return btns.join('');
  },

  // ── 通用：編輯 ──
  editAd(type, id) {
    if (type === 'banner') this.editBannerItem(id);
    else if (type === 'float') this.editFloatingAd(id);
    else if (type === 'popup') this.editPopupAd(id);
    else if (type === 'sponsor') this.editSponsorItem(id);
  },

  // ── 通用：下架 ──
  delistAd(type, id) {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.admin) {
      this.showToast('權限不足'); return;
    }
    if (type === 'banner') {
      ApiService.updateBanner(id, { status: 'expired' });
      this.renderBannerManage();
      this.renderBannerCarousel();
    } else if (type === 'float') {
      ApiService.updateFloatingAd(id, { status: 'expired' });
      this.renderFloatingAdManage();
      this.renderFloatingAds();
    } else if (type === 'popup') {
      ApiService.updatePopupAd(id, { status: 'expired' });
      this.renderPopupAdManage();
    } else if (type === 'sponsor') {
      ApiService.updateSponsor(id, { status: 'expired' });
      this.renderSponsorManage();
      this.renderSponsors();
    }
    this.showToast('廣告已下架');
  },

  // ── 通用：重新上架 ──
  relistAd(type, id) {
    if (type === 'banner') {
      ApiService.updateBanner(id, { status: 'active' });
      this.renderBannerManage();
      this.renderBannerCarousel();
    } else if (type === 'float') {
      ApiService.updateFloatingAd(id, { status: 'active' });
      this.renderFloatingAdManage();
      this.renderFloatingAds();
    } else if (type === 'popup') {
      ApiService.updatePopupAd(id, { status: 'active' });
      this.renderPopupAdManage();
    } else if (type === 'sponsor') {
      ApiService.updateSponsor(id, { status: 'active' });
      this.renderSponsorManage();
      this.renderSponsors();
    }
    this.showToast('廣告已重新上架');
  },

  // ── 通用：刪除（清空欄位，恢復空白） ──
  async clearAdSlot(type, id) {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.admin) {
      this.showToast('權限不足'); return;
    }
    if (!(await this.appConfirm('確定要刪除此廣告？將清空所有設定。'))) return;
    const emptyData = { title: '', slotName: '', linkUrl: '', image: null, publishAt: null, unpublishAt: null, status: 'empty', clicks: 0 };
    if (type === 'banner') {
      ApiService.updateBanner(id, emptyData);
      this.renderBannerManage();
      this.renderBannerCarousel();
    } else if (type === 'float') {
      ApiService.updateFloatingAd(id, emptyData);
      this.renderFloatingAdManage();
      this.renderFloatingAds();
    } else if (type === 'popup') {
      ApiService.updatePopupAd(id, emptyData);
      this.renderPopupAdManage();
    } else if (type === 'sponsor') {
      ApiService.updateSponsor(id, emptyData);
      this.renderSponsorManage();
      this.renderSponsors();
    }
    this.showToast('廣告已刪除');
  },

  // ── 通用：點擊計數 ──
  trackAdClick(type, id) {
    let item;
    if (type === 'banner') {
      item = ApiService.getBanners().find(b => b.id === id);
      if (item) { item.clicks = (item.clicks || 0) + 1; ApiService.updateBanner(id, { clicks: item.clicks }); }
    } else if (type === 'float') {
      item = ApiService.getFloatingAds().find(a => a.id === id);
      if (item) { item.clicks = (item.clicks || 0) + 1; ApiService.updateFloatingAd(id, { clicks: item.clicks }); }
    } else if (type === 'popup') {
      item = ApiService.getPopupAds().find(a => a.id === id);
      if (item) { item.clicks = (item.clicks || 0) + 1; ApiService.updatePopupAd(id, { clicks: item.clicks }); }
    } else if (type === 'sponsor') {
      item = ApiService.getSponsors().find(s => s.id === id);
      if (item) { item.clicks = (item.clicks || 0) + 1; ApiService.updateSponsor(id, { clicks: item.clicks }); }
    }
  },

  // ── 折疊切換 ──
  toggleAdSection(labelEl) {
    labelEl.classList.toggle('open');
    const content = labelEl.nextElementSibling;
    if (content) {
      content.style.display = content.style.display === 'none' ? '' : 'none';
    }
  },

});
