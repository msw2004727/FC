/* ================================================
   SportHub — Ad Management: Core Utilities & Generic Ops
   依賴：config.js, data.js, api-service.js
   ================================================ */

Object.assign(App, {
  _homeLayoutEditOrder: null,
  _homeLayoutEnsuringSlot: false,

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

  _homeLayoutSections() {
    const utils = (typeof window !== 'undefined' && window.HomeDashboardUtils) || {};
    const fallback = [
      { key: 'banner', label: '\u9996\u9801 Banner' },
      { key: 'heroActions', label: '\u5feb\u6377\u64cd\u4f5c' },
      { key: 'announcement', label: '\u516c\u544a\u8dd1\u99ac\u71c8' },
      { key: 'nextActivity', label: '\u6211\u7684\u4e0b\u4e00\u5834\u6d3b\u52d5' },
      { key: 'sportEntry', label: '\u6d3b\u52d5\u985e\u5225\u5165\u53e3' },
      { key: 'infoMeter', label: '\u5373\u6642\u8cc7\u8a0a' },
      { key: 'gameShortcut', label: '\u5c0f\u904a\u6232\u5165\u53e3' },
      { key: 'sponsors', label: '\u8d0a\u52a9\u5546' },
      { key: 'news', label: '\u9996\u9801\u65b0\u805e' },
      { key: 'floatingAds', label: '\u6d6e\u52d5\u5ee3\u544a' },
    ];
    return Array.isArray(utils.homeLayoutSections) && utils.homeLayoutSections.length
      ? utils.homeLayoutSections
      : fallback;
  },

  _homeLayoutDefaultOrder() {
    const utils = (typeof window !== 'undefined' && window.HomeDashboardUtils) || {};
    return Array.isArray(utils.homeLayoutDefaultOrder) && utils.homeLayoutDefaultOrder.length
      ? Array.from(utils.homeLayoutDefaultOrder)
      : this._homeLayoutSections().map(item => item.key);
  },

  _normalizeHomeLayoutOrder(order) {
    const utils = (typeof window !== 'undefined' && window.HomeDashboardUtils) || {};
    if (typeof utils.normalizeHomeLayoutOrder === 'function') {
      return utils.normalizeHomeLayoutOrder(order);
    }
    const defaults = this._homeLayoutDefaultOrder();
    const known = new Set(defaults);
    const seen = new Set();
    const result = [];
    (Array.isArray(order) ? order : []).forEach(key => {
      const safeKey = String(key || '').trim();
      if (!known.has(safeKey) || seen.has(safeKey)) return;
      seen.add(safeKey);
      result.push(safeKey);
    });
    defaults.forEach(key => { if (!seen.has(key)) result.push(key); });
    return result;
  },

  _getHomeLayoutPlaceholder() {
    const existing = ApiService.getHomeLayoutSettings?.();
    if (existing) return existing;
    let source = null;
    if (typeof ApiService !== 'undefined' && typeof ApiService._src === 'function') {
      source = ApiService._src('banners');
    } else if (typeof FirebaseService !== 'undefined' && FirebaseService._cache) {
      source = FirebaseService._cache.banners;
    }
    if (!Array.isArray(source)) return null;
    const placeholder = {
      id: 'home-layout',
      _docId: 'home-layout',
      slot: 'home-layout',
      type: 'homeLayout',
      slotName: '\u9996\u9801\u6392\u7248\u9806\u5e8f',
      status: 'active',
      order: this._homeLayoutDefaultOrder(),
    };
    source.push(placeholder);
    return placeholder;
  },

  async _ensureHomeLayoutSlot() {
    if (this._homeLayoutEnsuringSlot) return;
    if (typeof FirebaseService === 'undefined' || typeof FirebaseService._ensureHomeLayoutSlot !== 'function') return;
    this._homeLayoutEnsuringSlot = true;
    try {
      if (typeof _firebaseAuthReadyPromise !== 'undefined' && !_firebaseAuthReady) {
        await Promise.race([_firebaseAuthReadyPromise, new Promise(r => setTimeout(r, 5000))]);
      }
      await FirebaseService._ensureHomeLayoutSlot();
    } catch (err) {
      console.warn('[HomeLayout] ensure slot failed:', err);
    } finally {
      this._homeLayoutEnsuringSlot = false;
    }
  },

  renderHomeLayoutManage(options = {}) {
    const container = document.getElementById('home-layout-manage-list');
    if (!container) return;
    const item = ApiService.getHomeLayoutSettings?.() || this._getHomeLayoutPlaceholder();
    if (!item) {
      container.innerHTML = '<p style="color:var(--text-muted);padding:.5rem">\u9996\u9801\u6392\u7248\u8a2d\u5b9a\u8f09\u5165\u4e2d...</p>';
      this._ensureHomeLayoutSlot().then(() => this.renderHomeLayoutManage({ resetFromData: true }));
      return;
    }
    this._ensureHomeLayoutSlot();

    if (!Array.isArray(this._homeLayoutEditOrder) || options.resetFromData) {
      this._homeLayoutEditOrder = this._normalizeHomeLayoutOrder(item.order);
    }
    const order = this._normalizeHomeLayoutOrder(this._homeLayoutEditOrder);
    this._homeLayoutEditOrder = order.slice();
    const labels = new Map(this._homeLayoutSections().map(section => [section.key, section.label]));
    const itemHtml = order.map((key, index) => {
      const label = labels.get(key) || key;
      const hint = key === 'floatingAds'
        ? '<div class="banner-manage-meta">\u6d6e\u52d5\u5ee3\u544a\u70ba\u6d6e\u5c64\uff0c\u4f4d\u7f6e\u4e3b\u8981\u7531\u6a23\u5f0f\u63a7\u5236\u3002</div>'
        : '';
      return `
        <div class="home-layout-row" data-home-layout-key="${escapeHTML(key)}">
          <div class="home-layout-rank">${index + 1}</div>
          <div class="banner-manage-info">
            <div class="banner-manage-title">${escapeHTML(label)}</div>
            ${hint}
          </div>
          <div class="home-layout-row-actions">
            <button class="outline-btn home-layout-move-btn" type="button" onclick="App.moveHomeLayoutItem('${escapeHTML(key)}', -1)"${index === 0 ? ' disabled' : ''}>\u4e0a\u79fb</button>
            <button class="outline-btn home-layout-move-btn" type="button" onclick="App.moveHomeLayoutItem('${escapeHTML(key)}', 1)"${index === order.length - 1 ? ' disabled' : ''}>\u4e0b\u79fb</button>
          </div>
        </div>`;
    }).join('');
    container.innerHTML = `
      <div class="home-layout-card">
        <div class="banner-manage-meta">\u7531\u4e0a\u5230\u4e0b\u8abf\u6574\u9996\u9801\u5bb9\u5668\u9806\u5e8f\uff0c\u5132\u5b58\u5f8c\u6703\u7acb\u5373\u5957\u7528\u5230\u9996\u9801\u3002</div>
        <div class="home-layout-list">${itemHtml}</div>
        <div class="home-layout-actions">
          <button class="outline-btn" type="button" onclick="App.resetHomeLayoutOrder()">\u9084\u539f\u9810\u8a2d</button>
          <button class="primary-btn" type="button" onclick="App.saveHomeLayoutOrder()">\u5132\u5b58\u9806\u5e8f</button>
        </div>
      </div>`;
  },

  moveHomeLayoutItem(key, direction) {
    const order = this._normalizeHomeLayoutOrder(this._homeLayoutEditOrder);
    const idx = order.indexOf(key);
    const nextIdx = idx + Number(direction || 0);
    if (idx < 0 || nextIdx < 0 || nextIdx >= order.length) return;
    const [item] = order.splice(idx, 1);
    order.splice(nextIdx, 0, item);
    this._homeLayoutEditOrder = order;
    this.renderHomeLayoutManage();
  },

  resetHomeLayoutOrder() {
    this._homeLayoutEditOrder = this._homeLayoutDefaultOrder();
    this.renderHomeLayoutManage();
  },

  async saveHomeLayoutOrder() {
    if (!this.hasPermission('admin.banners.entry')) {
      this.showToast('\u6b0a\u9650\u4e0d\u8db3'); return;
    }
    await this._ensureHomeLayoutSlot();
    const item = ApiService.getHomeLayoutSettings?.() || this._getHomeLayoutPlaceholder();
    const id = item?.id || item?._docId || 'home-layout';
    const order = this._normalizeHomeLayoutOrder(this._homeLayoutEditOrder);
    ApiService.updateHomeLayoutSettings(id, {
      slotName: '\u9996\u9801\u6392\u7248\u9806\u5e8f',
      slot: 'home-layout',
      type: 'homeLayout',
      status: 'active',
      order,
    });
    this._homeLayoutEditOrder = order;
    if (typeof window !== 'undefined') window.HomeDashboardUtils?.applyHomeLayoutOrder?.();
    this.renderHomeLayoutManage();
    this.showToast('\u9996\u9801\u6392\u7248\u9806\u5e8f\u5df2\u5132\u5b58');
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
