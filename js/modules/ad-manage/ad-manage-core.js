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

  _ensureAdEditModalRoot() {
    let root = document.getElementById('ad-edit-modal-root');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'ad-edit-modal-root';
    root.className = 'ad-edit-modal-root';
    root.setAttribute('aria-hidden', 'true');
    root.addEventListener('mousedown', (event) => {
      if (event.target === root) this._closeActiveAdEditModal?.();
    });
    document.body.appendChild(root);
    return root;
  },

  _openAdEditModal(formId, closeMethodName) {
    const form = document.getElementById(formId);
    if (!form) return null;
    if (this._activeAdEditModal?.formId && this._activeAdEditModal.formId !== formId) {
      this._closeActiveAdEditModal();
    }
    const root = this._ensureAdEditModalRoot();
    if (!form._adModalReturnParent) {
      form._adModalReturnParent = form.parentNode;
      form._adModalReturnNext = form.nextSibling;
    }
    root.appendChild(form);
    form.classList.add('ad-edit-modal-card');
    form.style.display = '';
    root.classList.add('is-open');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ad-edit-modal-open');
    this._activeAdEditModal = { formId, closeMethodName };
    if (!this._adEditModalKeyHandler) {
      this._adEditModalKeyHandler = (event) => {
        if (event.key === 'Escape') this._closeActiveAdEditModal?.();
      };
    }
    document.addEventListener('keydown', this._adEditModalKeyHandler);
    setTimeout(() => {
      const target = form.querySelector('input:not([type="hidden"]), select, textarea, button');
      try { target?.focus?.({ preventScroll: true }); } catch (_) {}
    }, 0);
    return form;
  },

  _closeAdEditModal(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.style.display = 'none';
    form.classList.remove('ad-edit-modal-card');
    const parent = form._adModalReturnParent;
    const next = form._adModalReturnNext;
    if (parent && parent.isConnected) {
      if (next && next.parentNode === parent) parent.insertBefore(form, next);
      else parent.appendChild(form);
    }
    const root = document.getElementById('ad-edit-modal-root');
    if (root) {
      root.classList.remove('is-open');
      root.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('ad-edit-modal-open');
    if (this._adEditModalKeyHandler) {
      document.removeEventListener('keydown', this._adEditModalKeyHandler);
    }
    if (this._activeAdEditModal?.formId === formId) this._activeAdEditModal = null;
  },

  _closeActiveAdEditModal() {
    const active = this._activeAdEditModal;
    if (active?.closeMethodName && typeof this[active.closeMethodName] === 'function') {
      this[active.closeMethodName]();
      return;
    }
    if (active?.formId) this._closeAdEditModal(active.formId);
  },

  // 自動下架已過期廣告
  _autoExpireAds() {
    if (!this.hasPermission('admin.banners.entry')) return;
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
    const sgAd = ApiService.getShotGameAd();
    if (sgAd) check([sgAd], (id, u) => ApiService.updateShotGameAd(id, u));
    const watchPartyBg = ApiService.getWatchPartyBg?.();
    if (watchPartyBg) check([watchPartyBg], (id, u) => ApiService.updateWatchPartyBg(id, u));
    const homeInfo = ApiService.getHomeInfoSettings?.();
    if (homeInfo) check([homeInfo], (id, u) => ApiService.updateHomeInfoSettings(id, u));
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
    const html = btns.join('');
    if (type === 'homeinfo') {
      if (status === 'active') {
        return [
          `<button class="primary-btn small" style="${s}" onclick="App.editAd('homeinfo','${id}')">\u7de8\u8f2f</button>`,
          `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.delistAd('homeinfo','${id}')">\u4e0b\u67b6</button>`,
        ].join('');
      }
      if (status === 'empty') {
        return `<button class="primary-btn small" style="${s}" onclick="App.editAd('homeinfo','${id}')">\u8a2d\u5b9a</button>`;
      }
      return [
        `<button class="primary-btn small" style="${s}" onclick="App.editAd('homeinfo','${id}')">\u7de8\u8f2f</button>`,
        `<button class="outline-btn" style="${s};color:var(--success)" onclick="App.relistAd('homeinfo','${id}')">\u91cd\u65b0\u4e0a\u67b6</button>`,
      ].join('');
    }
    if (type === 'watchparty') {
      return html.replace(/(onclick="App\.clearAdSlot\('watchparty','[^']*'\)">)[^<]*(<\/button>)/g, (_, open, close) => `${open}\u6e05\u7a7a\u5716\u7247${close}`);
    }
    return html;
  },

  // ── 首頁新聞開關 ──
  renderNewsToggle() {
    var toggle = document.getElementById('news-visible-toggle');
    if (!toggle) return;
    toggle.checked = ApiService.isNewsVisible();
  },

  toggleNewsVisible(visible) {
    if (!this.hasPermission('admin.banners.entry')) {
      this.showToast('權限不足'); return;
    }
    ApiService.upsertGameConfig('news-section', {
      gameKey: 'news-section',
      homeVisible: !!visible,
      updatedAt: new Date().toISOString(),
    });
    this.showToast(visible ? '已開啟首頁新聞' : '已關閉首頁新聞');
  },

  // ── 通用：編輯 ──
  editAd(type, id) {
    if (type === 'banner') this.editBannerItem(id);
    else if (type === 'float') this.editFloatingAd(id);
    else if (type === 'popup') this.editPopupAd(id);
    else if (type === 'sponsor') this.editSponsorItem(id);
    else if (type === 'shotgame') this.editShotGameAd(id);
    else if (type === 'watchparty') this.editWatchPartyBg(id);
    else if (type === 'homeinfo') this.editHomeInfo(id);
  },

  // ── 通用：下架 ──
  delistAd(type, id) {
    if (!this.hasPermission('admin.banners.entry')) {
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
    } else if (type === 'shotgame') {
      ApiService.updateShotGameAd(id, { status: 'expired' });
      this.renderShotGameAdManage();
    } else if (type === 'watchparty') {
      ApiService.updateWatchPartyBg(id, { status: 'expired' });
      this.renderWatchPartyBgManage();
      this.renderHomeWatchPartyCard?.();
    } else if (type === 'homeinfo') {
      ApiService.updateHomeInfoSettings(id, { status: 'expired' });
      this.renderHomeInfoManage?.();
      this.renderHomeDashboard?.();
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
    } else if (type === 'shotgame') {
      ApiService.updateShotGameAd(id, { status: 'active' });
      this.renderShotGameAdManage();
    } else if (type === 'watchparty') {
      ApiService.updateWatchPartyBg(id, { status: 'active' });
      this.renderWatchPartyBgManage();
      this.renderHomeWatchPartyCard?.();
    } else if (type === 'homeinfo') {
      ApiService.updateHomeInfoSettings(id, { status: 'active' });
      this.renderHomeInfoManage?.();
      this.renderHomeDashboard?.();
    }
    this.showToast('廣告已重新上架');
  },

  // ── 通用：刪除（清空欄位，恢復空白） ──
  async clearAdSlot(type, id) {
    if (type === 'watchparty') {
      if (!this.hasPermission('admin.banners.entry')) {
        this.showToast('\u6b0a\u9650\u4e0d\u8db3'); return;
      }
      if (!(await this.appConfirm('\u78ba\u5b9a\u8981\u6e05\u7a7a\u89c0\u8cfd\u805a\u6703\u5e95\u5716\uff1f\u6309\u9215\u6587\u5b57\u3001\u9023\u7d50\u8207\u986f\u793a\u72c0\u614b\u6703\u4fdd\u7559\u3002'))) return;
      ApiService.updateWatchPartyBg(id, { image: null });
      this.renderWatchPartyBgManage();
      this.renderHomeWatchPartyCard?.();
      this.showToast('\u5df2\u6e05\u7a7a\u89c0\u8cfd\u805a\u6703\u5716\u7247');
      return;
    }
    if (!this.hasPermission('admin.banners.entry')) {
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
    } else if (type === 'shotgame') {
      ApiService.updateShotGameAd(id, emptyData);
      this.renderShotGameAdManage();
    } else if (type === 'watchparty') {
      ApiService.updateWatchPartyBg(id, { ...emptyData, slotName: '觀賽聚會底圖', slot: 'watch-party-bg', type: 'watchParty' });
      this.renderWatchPartyBgManage();
      this.renderHomeWatchPartyCard?.();
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
    } else if (type === 'watchparty') {
      item = ApiService.getWatchPartyBg?.();
      if (item) { item.clicks = (item.clicks || 0) + 1; ApiService.updateWatchPartyBg(id, { clicks: item.clicks }); }
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
