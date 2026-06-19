/* ================================================
   SportHub — Profile: Avatar Helpers
   依賴：config.js, api-service.js
   ================================================ */
Object.assign(App, {

  _brokenAvatarTtlMs: 12 * 60 * 60 * 1000,
  _brokenAvatarUrlsLoaded: false,
  _brokenAvatarUrls: new Set(),
  _brokenAvatarStorageKey: 'sporthub_broken_avatar_urls_v2',

  _ensureBrokenAvatarUrlsLoaded() {
    if (this._brokenAvatarUrlsLoaded) return;
    this._brokenAvatarUrlsLoaded = true;
    try {
      const raw = localStorage.getItem(this._brokenAvatarStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const updatedAt = Number(parsed?.updatedAt || 0);
      if (updatedAt && Date.now() - updatedAt > this._brokenAvatarTtlMs) {
        localStorage.removeItem(this._brokenAvatarStorageKey);
        return;
      }
      const urls = Array.isArray(parsed?.urls) ? parsed.urls : [];
      urls
        .filter(url => typeof url === 'string' && url)
        .slice(0, 200)
        .forEach(url => this._brokenAvatarUrls.add(url));
    } catch (_) {}
  },

  _persistBrokenAvatarUrls() {
    try {
      const urls = Array.from(this._brokenAvatarUrls).slice(-200);
      localStorage.setItem(this._brokenAvatarStorageKey, JSON.stringify({
        updatedAt: Date.now(),
        urls,
      }));
    } catch (_) {}
  },

  _rememberBrokenAvatarUrl(url) {
    if (!url || typeof url !== 'string') return;
    this._ensureBrokenAvatarUrlsLoaded();
    this._brokenAvatarUrls.add(url);
    this._persistBrokenAvatarUrls();
  },

  _forgetBrokenAvatarUrl(url) {
    if (!url || typeof url !== 'string') return;
    this._ensureBrokenAvatarUrlsLoaded();
    if (this._brokenAvatarUrls.delete(url)) {
      this._persistBrokenAvatarUrls();
    }
  },

  _isKnownBrokenAvatarUrl(url) {
    if (!url || typeof url !== 'string') return false;
    this._ensureBrokenAvatarUrlsLoaded();
    return this._brokenAvatarUrls.has(url);
  },

  _getAvatarCandidateUrls(...urls) {
    const seen = new Set();
    return urls
      .flat()
      .map(url => (typeof url === 'string' ? url.trim() : ''))
      .filter(url => {
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
      });
  },

  _getRenderableAvatarCandidateUrls(...urls) {
    return this._getAvatarCandidateUrls(...urls)
      .filter(url => !this._isKnownBrokenAvatarUrl(url));
  },

  _getAvatarInitial(name) {
    const text = String(name || '?').trim();
    return escapeHTML(text ? text.charAt(0) : '?');
  },

  // 第二身份金色反光皇冠徽章（與留言區共用 .identity-crown 樣式，定義於 css/base.css）
  _identityCrownBadgeHtml() {
    return '<svg class="identity-crown" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
      + '<defs>'
      + '<linearGradient id="identityCrownGold" x1="3" y1="5" x2="20" y2="19" gradientUnits="userSpaceOnUse">'
      + '<stop offset="0" stop-color="#fff4c2"/><stop offset=".42" stop-color="#ffd24a"/>'
      + '<stop offset=".72" stop-color="#f2a517"/><stop offset="1" stop-color="#b5710b"/>'
      + '</linearGradient>'
      + '<clipPath id="identityCrownClip"><path d="M2.7 9.1 6.8 13 12 5.6 17.2 13 21.3 9.1V16.4q0 1.7-1.7 1.7H4.4Q2.7 18.1 2.7 16.4Z"/></clipPath>'
      + '</defs>'
      + '<path class="identity-crown-body" d="M2.7 9.1 6.8 13 12 5.6 17.2 13 21.3 9.1V16.4q0 1.7-1.7 1.7H4.4Q2.7 18.1 2.7 16.4Z"/>'
      + '<path class="identity-crown-band" d="M4 15.3h16"/>'
      + '<circle class="identity-crown-gem" cx="12" cy="5.9" r="1.6"/>'
      + '<circle class="identity-crown-gem" cx="2.9" cy="9.1" r="1.3"/>'
      + '<circle class="identity-crown-gem" cx="21.1" cy="9.1" r="1.3"/>'
      + '<g clip-path="url(#identityCrownClip)"><rect class="identity-crown-shine" x="-9" y="-5" width="7" height="34"/></g>'
      + '</svg>';
  },

  _buildTopbarAvatarFallback(initial, isSyncing = false) {
    const loadingClass = isSyncing ? ' line-avatar-loading' : '';
    const label = isSyncing ? '同步中' : '使用者選單';
    const content = isSyncing
      ? '<span class="line-avatar-spinner" aria-hidden="true"></span>'
      : initial;
    return `<div id="line-avatar-topbar" class="line-avatar-topbar line-avatar-fallback${loadingClass}" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}" onclick="App.toggleUserMenu()">${content}</div>`;
  },

  _buildAvatarFallbackMarkup(name, fallbackClass = 'profile-avatar') {
    return `<div class="${escapeHTML(fallbackClass)}">${this._getAvatarInitial(name)}</div>`;
  },

  _buildAvatarImageMarkup(url, name, imageClass = '', fallbackClass = 'profile-avatar', extraAttrs = '') {
    const candidateUrl = this._getRenderableAvatarCandidateUrls(url)[0] || null;
    if (!candidateUrl) {
      return this._buildAvatarFallbackMarkup(name, fallbackClass);
    }
    const attrs = extraAttrs ? ` ${extraAttrs}` : '';
    return `<img src="${escapeHTML(candidateUrl)}" class="${escapeHTML(imageClass)}" alt="${escapeHTML(name || 'avatar')}" referrerpolicy="no-referrer" data-avatar-fallback="1" data-avatar-name="${escapeHTML(name || '')}" data-avatar-fallback-class="${escapeHTML(fallbackClass)}"${attrs}>`;
  },

  _isImgBroken(img) {
    if (!img || !img.complete) return false;
    return img.naturalWidth < 2 || img.naturalHeight < 2;
  },

  _bindAvatarFallbacks(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('img[data-avatar-fallback="1"]').forEach(img => {
      if (img.dataset.avatarFallbackBound === '1') return;
      img.dataset.avatarFallbackBound = '1';
      var self = this;
      var handleBroken = function() {
        if (img.dataset.avatarFallbackDone === '1') return;
        img.dataset.avatarFallbackDone = '1';
        if (img.currentSrc || img.src) {
          self._rememberBrokenAvatarUrl(img.currentSrc || img.src);
        }
        var fallback = document.createElement('div');
        fallback.className = img.dataset.avatarFallbackClass || 'profile-avatar';
        fallback.textContent = (img.dataset.avatarName || '?').trim().charAt(0) || '?';
        if (img.parentNode) img.replaceWith(fallback);
      };
      img.addEventListener('error', handleBroken, { once: true });
      if (this._isImgBroken(img)) {
        handleBroken();
      } else if (img.complete && img.naturalWidth === 0) {
        handleBroken();
      } else {
        // 延遲複檢：瀏覽器從 HTTP 快取載入壞圖時，onerror 可能不觸發
        setTimeout(function() {
          if (img.dataset.avatarFallbackDone === '1') return;
          if (self._isImgBroken(img)) handleBroken();
        }, 1500);
      }
    });
  },

  _loadAvatarIntoImage(img, candidateUrls, name, onFallback) {
    if (!img) {
      if (typeof onFallback === 'function') onFallback();
      return;
    }

    const candidates = this._getRenderableAvatarCandidateUrls(candidateUrls);
    if (!candidates.length) {
      if (typeof onFallback === 'function') onFallback();
      return;
    }

    let index = 0;
    const tryNext = () => {
      if (index >= candidates.length) {
        if (typeof onFallback === 'function') onFallback();
        return;
      }

      const nextUrl = candidates[index++];
      const handleBroken = () => {
        if (img.dataset.avatarCurrentUrl !== nextUrl) return;
        this._rememberBrokenAvatarUrl(nextUrl);
        img.removeAttribute('src');
        tryNext();
      };

      img.dataset.avatarCurrentUrl = nextUrl;
      img.alt = name || 'avatar';
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onerror = handleBroken;
      img.onload = () => {
        if (img.dataset.avatarCurrentUrl !== nextUrl) return;
        if (img.naturalWidth < 2) { handleBroken(); return; }
        img.dataset.avatarLoaded = '1';
      };
      img.removeAttribute('src');
      img.src = nextUrl;

      setTimeout(() => {
        if (img.dataset.avatarCurrentUrl === nextUrl && img.complete && img.naturalWidth < 2) {
          handleBroken();
        }
      }, 0);
    };

    tryNext();
  },

  _setAvatarContent(container, url, name, options = {}) {
    if (!container) return;
    const fallbackClass = options.fallbackClass || container.className || 'profile-avatar';
    const imageClass = options.imageClass || '';
    // 第二身份頭像：以金色皇冠徽章覆蓋於頭像上（className 重設會洗掉 class，故每次都重貼）
    const wantCrown = options.identityCrown === true;
    const applyCrown = () => {
      if (!wantCrown) return;
      container.classList.add('has-identity-crown');
      if (!container.querySelector('.identity-crown')) {
        container.insertAdjacentHTML('beforeend', this._identityCrownBadgeHtml());
      }
    };
    const candidateUrls = this._getAvatarCandidateUrls(options.candidateUrls || url);
    if (!candidateUrls.length) {
      container.className = fallbackClass;
      container.innerHTML = this._getAvatarInitial(name);
      applyCrown();
      return;
    }
    container.className = options.containerImageClass || fallbackClass;
    container.innerHTML = '';
    const img = document.createElement('img');
    if (imageClass) img.className = imageClass;
    container.appendChild(img);
    applyCrown();
    this._loadAvatarIntoImage(img, candidateUrls, name, () => {
      container.className = fallbackClass;
      container.innerHTML = this._getAvatarInitial(name);
      applyCrown();
    });
  },

  _setTopbarAvatar(userTopbar, avatarImg, profile, options = {}) {
    if (!userTopbar) return;
    const displayName = profile?.displayName || '?';
    const candidateUrls = this._getAvatarCandidateUrls(options.candidateUrls || profile?.pictureUrl);
    const initial = this._getAvatarInitial(displayName);
    const isSyncing = !!options.isSyncing && !candidateUrls.length;

    // 第二身份：右上角頭像加金色皇冠（皇冠相對 .line-user-topbar 定位，換圖時只替換頭像本體故皇冠保留）
    const wantCrown = options.crown === true;
    userTopbar.classList.toggle('has-identity-crown', wantCrown);
    const crownHtml = wantCrown ? this._identityCrownBadgeHtml() : '';

    // 永遠先顯示 fallback（文字頭像），避免出現破圖
    const dropdown = document.getElementById('user-menu-dropdown');
    const dropdownHtml = dropdown ? dropdown.outerHTML : '';
    userTopbar.innerHTML = `${this._buildTopbarAvatarFallback(initial, isSyncing)}${crownHtml}${dropdownHtml}`;

    const candidates = this._getRenderableAvatarCandidateUrls(candidateUrls);
    if (!candidates.length) return;

    // 用 new Image() 在背景預載，載入成功才替換 fallback
    let done = false;
    let idx = 0;
    const tryNext = () => {
      if (done || idx >= candidates.length) return;
      const url = candidates[idx++];
      const probe = new Image();
      probe.referrerPolicy = 'no-referrer';
      probe.onload = () => {
        if (done) return;
        if (probe.naturalWidth < 2) { this._rememberBrokenAvatarUrl(url); tryNext(); return; }
        done = true;
        const fallbackEl = document.getElementById('line-avatar-topbar');
        if (!fallbackEl) return;
        const img = document.createElement('img');
        img.src = url;
        img.className = 'line-avatar-topbar';
        img.alt = escapeHTML(displayName);
        img.referrerPolicy = 'no-referrer';
        img.onclick = () => App.toggleUserMenu();
        img.id = 'line-avatar-topbar';
        // DOM img 也掛 onerror，防止瀏覽器快取的壞圖繞過 probe
        img.onerror = () => {
          this._rememberBrokenAvatarUrl(url);
          const fb = document.createElement('div');
          fb.id = 'line-avatar-topbar';
          fb.className = `line-avatar-topbar line-avatar-fallback${isSyncing ? ' line-avatar-loading' : ''}`;
          fb.setAttribute('aria-label', isSyncing ? '同步中' : '使用者選單');
          fb.setAttribute('title', isSyncing ? '同步中' : '使用者選單');
          if (isSyncing) {
            fb.innerHTML = '<span class="line-avatar-spinner" aria-hidden="true"></span>';
          } else {
            fb.textContent = initial;
          }
          fb.onclick = () => App.toggleUserMenu();
          if (img.parentNode) img.replaceWith(fb);
        };
        fallbackEl.replaceWith(img);
      };
      probe.onerror = () => { this._rememberBrokenAvatarUrl(url); tryNext(); };
      probe.src = url;
      // 超時保護：3 秒內未載入視為失敗
      setTimeout(() => {
        if (!done && probe.complete && probe.naturalWidth < 2) {
          this._rememberBrokenAvatarUrl(url);
          tryNext();
        }
      }, 3000);
    };
    tryNext();
  },

});
