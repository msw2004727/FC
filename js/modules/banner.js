/* ================================================
   SportHub — Banner Carousel, Floating Ads, Announcement (Frontend)
   ================================================ */

Object.assign(App, {
  _bannerRenderFingerprint: '',
  _bannerImageReady: {},

  _getBannerRenderFingerprint(banners) {
    const fieldSep = String.fromCharCode(31);
    const rowSep = String.fromCharCode(30);
    return (banners || []).map(b => [
      b && (b._docId || b.id || ''),
      b && (b.status || ''),
      b && (b.title || ''),
      b && (b.image || ''),
      b && (b.linkUrl || ''),
      b && (b.slotName || ''),
      b && (b.slot || ''),
      b && (b.gradient || ''),
    ].map(v => String(v == null ? '' : v)).join(fieldSep)).join(rowSep) || 'empty';
  },

  _applyBannerSlideBackground(slide, url) {
    if (!slide || !url) return;
    slide.style.backgroundImage = 'url("' + String(url).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")';
    slide.style.backgroundSize = 'cover';
    slide.style.backgroundPosition = 'center';
    slide.classList.remove('banner-slide--loading');
    slide.dataset.bannerLoadState = 'done';
  },

  _ensureBannerSlideImage(slide, options = {}) {
    if (!slide || !slide.classList || !slide.classList.contains('banner-slide--loading')) return;
    const url = slide.getAttribute('data-bg-src');
    if (!url) return;
    const priority = options.priority || slide.getAttribute('data-banner-priority') || 'normal';

    if (this._bannerImageReady && this._bannerImageReady[url]) {
      this._applyBannerSlideBackground(slide, url);
      return;
    }
    if (slide.dataset.bannerLoadState === 'loading') return;
    slide.dataset.bannerLoadState = 'loading';

    let settled = false;
    const markAndShow = () => {
      if (settled) return;
      settled = true;
      if (this._bannerImageReady) this._bannerImageReady[url] = true;
      this._applyBannerSlideBackground(slide, url);
    };

    const timeoutMs = priority === 'high' ? 1800 : 3500;
    const fallbackTimer = setTimeout(markAndShow, timeoutMs);
    const img = new Image();
    if ('fetchPriority' in img) img.fetchPriority = priority === 'high' ? 'high' : 'low';
    if ('decoding' in img) img.decoding = 'async';
    img.onload = () => {
      clearTimeout(fallbackTimer);
      markAndShow();
    };
    img.onerror = () => {
      clearTimeout(fallbackTimer);
      markAndShow();
    };
    img.src = url;
    if (typeof img.decode === 'function') {
      img.decode().then(() => {
        clearTimeout(fallbackTimer);
        markAndShow();
      }).catch(() => {
        clearTimeout(fallbackTimer);
        markAndShow();
      });
    }
  },

  _ensureBannerSlideImages(track) {
    if (!track) return;
    const scheduleIdle = window.requestIdleCallback || function(cb) { return setTimeout(cb, 120); };
    track.querySelectorAll('.banner-slide--loading').forEach((slide, idx) => {
      const priority = slide.getAttribute('data-banner-priority') || (idx === 0 ? 'high' : 'normal');
      if (priority === 'high') {
        this._ensureBannerSlideImage(slide, { priority });
      } else {
        scheduleIdle(() => this._ensureBannerSlideImage(slide, { priority }), { timeout: 1500 });
      }
    });
  },

  renderBannerCarousel(options = {}) {
    const track = document.getElementById('banner-track');
    if (!track) return;
    const { autoplay = true } = options;
    const banners = ApiService.getBanners().filter(b => b.status === 'active');
    const fingerprint = this._getBannerRenderFingerprint(banners);
    if (this._bannerRenderFingerprint === fingerprint && track.querySelector('.banner-slide')) {
      this.bannerCount = track.querySelectorAll('.banner-slide').length;
      this._ensureBannerSlideImages(track);
      this._bindBannerCarouselControls();
      if (autoplay) {
        this.startBannerCarousel();
      } else {
        this.stopBannerCarousel();
      }
      return;
    }
    this._bannerRenderFingerprint = fingerprint;

    if (banners.length === 0) {
      track.innerHTML = `<div class="banner-slide skeleton-slide">
        <div class="banner-skeleton skeleton"></div>
      </div>`;
    } else {
      track.innerHTML = banners.map((b, idx) => {
        const safeUrl = (b.linkUrl && /^https?:\/\//.test(b.linkUrl)) ? escapeHTML(b.linkUrl) : '';
        const clickHandler = safeUrl
          ? `onclick="App.trackAdClick('banner','${escapeHTML(b.id)}');window.open('${safeUrl}','sporthub_ad')" style="cursor:pointer"`
          : '';
        if (b.image) {
          // 先不設 background-image，等預載+解碼完成後再淡入
          return `<div class="banner-slide banner-slide--loading" data-bg-src="${escapeHTML(b.image)}" data-banner-priority="${idx === 0 ? 'high' : 'normal'}" ${clickHandler}>
            <div class="banner-content"><div class="banner-tag">${escapeHTML(b.slotName || '廣告位 ' + b.slot)}</div><h2>${escapeHTML(b.title || '')}</h2></div>
          </div>`;
        }
        return `<div class="banner-slide banner-placeholder" style="background:${b.gradient || 'var(--bg-elevated)'}" ${clickHandler}>
          <div class="banner-img-placeholder">1200 × 545</div>
          <div class="banner-content"><div class="banner-tag">${escapeHTML(b.slotName || '廣告位 ' + b.slot)}</div><h2>${escapeHTML(b.title || '')}</h2></div>
        </div>`;
      }).join('');
      // 預載 banner 圖片：背景載入+解碼完成後才設 background-image 並淡入
      this._ensureBannerSlideImages(track);
    }
    this.bannerIndex = 0;
    this.bannerCount = track.querySelectorAll('.banner-slide').length;
    const dots = document.getElementById('banner-dots');
    if (dots) {
      dots.innerHTML = '';
      for (let i = 0; i < this.bannerCount; i++) {
        const dot = document.createElement('div');
        dot.className = 'banner-dot' + (i === 0 ? ' active' : '');
        dot.addEventListener('click', () => this.goToBanner(i));
        dots.appendChild(dot);
      }
    }
    track.style.transform = 'translateX(0)';
    this._bindBannerCarouselControls();
    if (autoplay) {
      this.startBannerCarousel();
    } else {
      this.stopBannerCarousel();
    }
  },

  _bindBannerCarouselControls() {
    const prev = document.getElementById('banner-prev');
    const next = document.getElementById('banner-next');
    if (!prev || !next) return;           // DOM 尚未就緒，跳過
    if (prev.dataset.bound) return;       // 防止重複綁定
    prev.dataset.bound = '1';
    next.dataset.bound = '1';
    prev.addEventListener('click', () => {
      const cnt = this.bannerCount || 1;
      this.goToBanner((this.bannerIndex - 1 + cnt) % cnt);
    });
    next.addEventListener('click', () => {
      const cnt = this.bannerCount || 1;
      this.goToBanner((this.bannerIndex + 1) % cnt);
    });

    // ── Touch Drag (跟手滑動) ──
    const track = document.getElementById('banner-track');
    if (track) {
      let startX = 0, startY = 0, startTime = 0;
      let dragging = false, locked = false;
      let trackW = 0;

      track.addEventListener('touchstart', (e) => {
        if ((this.bannerCount || 0) <= 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
        dragging = false;
        locked = false;
        trackW = track.parentElement ? track.parentElement.offsetWidth : track.offsetWidth;
        // 關閉 transition 讓拖曳跟手
        track.style.transition = 'none';
        this.stopBannerCarousel();
      }, { passive: true });

      track.addEventListener('touchmove', (e) => {
        if (locked || (this.bannerCount || 0) <= 1) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;

        // 首次移動判斷方向：垂直滑動則放棄
        if (!dragging) {
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
            locked = true;
            return;
          }
          if (Math.abs(dx) > 8) {
            dragging = true;
          } else {
            return;
          }
        }

        e.preventDefault();
        const cnt = this.bannerCount || 1;
        const idx = this.bannerIndex;
        let ratio = dx / (trackW || 1);

        // 邊界阻尼：第一張往右拖 或 最後一張往左拖
        if ((idx === 0 && ratio > 0) || (idx === cnt - 1 && ratio < 0)) {
          ratio *= 0.3;
        }

        const offset = -(idx * 100) + (ratio * 100);
        track.style.transform = 'translateX(' + offset + '%)';
      }, { passive: false });

      track.addEventListener('touchend', (e) => {
        if ((this.bannerCount || 0) <= 1) return;
        // 恢復 transition
        track.style.transition = '';

        if (!dragging) {
          this.startBannerCarousel();
          return;
        }

        const dx = e.changedTouches[0].clientX - startX;
        const elapsed = Date.now() - startTime;
        const velocity = Math.abs(dx) / (elapsed || 1); // px/ms
        const cnt = this.bannerCount || 1;
        const threshold = (trackW || 300) * 0.25;

        let newIdx = this.bannerIndex;
        // 快速滑動（速度 > 0.4 px/ms）或拖動距離超過 25%
        if (dx < -threshold || (dx < -30 && velocity > 0.4)) {
          newIdx = Math.min(this.bannerIndex + 1, cnt - 1);
        } else if (dx > threshold || (dx > 30 && velocity > 0.4)) {
          newIdx = Math.max(this.bannerIndex - 1, 0);
        }

        this.goToBanner(newIdx);
        // 延遲恢復自動輪播
        setTimeout(() => this.startBannerCarousel(), 4000);
      }, { passive: true });
    }
  },

  startBannerCarousel() {
    this._bindBannerCarouselControls();
    const prev = document.getElementById('banner-prev');
    const next = document.getElementById('banner-next');
    if (!prev || !next) return;
    if (typeof this._isHomePageActive === 'function' && !this._isHomePageActive()) return;
    this.stopBannerCarousel();
    if ((this.bannerCount || 0) <= 1) return;
    this.bannerTimer = setInterval(() => {
      const cnt = this.bannerCount || 1;
      this.bannerIndex = (this.bannerIndex + 1) % cnt;
      this.goToBanner(this.bannerIndex);
    }, 8000);
  },

  stopBannerCarousel() {
    if (!this.bannerTimer) return;
    clearInterval(this.bannerTimer);
    this.bannerTimer = null;
  },

  goToBanner(idx) {
    this.bannerIndex = idx;
    const track = document.getElementById('banner-track');
    if (!track) return;
    const slide = track.querySelectorAll('.banner-slide')[idx];
    this._ensureBannerSlideImage(slide, { priority: 'high' });
    track.style.transform = `translateX(-${idx * 100}%)`;
    document.querySelectorAll('.banner-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  },

  renderAnnouncement() {
    // Marquee version — delegated to announcement.js
    // This is kept as a fallback; announcement.js overrides it via Object.assign
    const wrap = document.getElementById('announce-marquee-wrap');
    const track = document.getElementById('announce-marquee-track');
    if (!wrap || !track) return;

    const items = ApiService.getActiveAnnouncements();
    if (!items.length) {
      wrap.style.display = 'none';
      track.innerHTML = '';
      return;
    }

    const html = items.map(a =>
      `<span class="announce-marquee-item" onclick="App.showAnnDetail('${a.id}')">${escapeHTML(a.title)}：${escapeHTML(a.content)}</span>`
    ).join('');
    track.innerHTML = `<div class="announce-marquee-inner">${html}${html}</div>`;
    wrap.style.display = '';

    const totalChars = items.reduce((sum, a) => sum + (a.title + a.content).length, 0);
    const duration = Math.max(10, totalChars * 0.35);
    track.querySelector('.announce-marquee-inner').style.setProperty('--marquee-duration', duration + 's');
  },

  renderFloatingAds() {
    const container = document.getElementById('floating-ads');
    if (!container) return;
    const ads = ApiService.getFloatingAds().filter(ad => ad.status === 'active');
    container.innerHTML = ads.map(ad => {
      const safeUrl = (ad.linkUrl && /^https?:\/\//.test(ad.linkUrl)) ? escapeHTML(ad.linkUrl) : '';
      const clickHandler = safeUrl
        ? `onclick="App.trackAdClick('float','${escapeHTML(ad.id)}');window.open('${safeUrl}','sporthub_ad')"`
        : '';
      return `
      <div class="float-ad" title="${escapeHTML(ad.title || '贊助廣告')}" ${clickHandler}>
        <div class="float-ad-img">${ad.image ? `<img src="${ad.image}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : '廣告'}</div>
      </div>`;
    }).join('');
    // 重設位置與狀態，避免渲染後偏移
    this._floatAdOffset = 0;
    this._floatAdTarget = 0;
    this._floatAdDragged = false;
    const el = document.getElementById('floating-ads');
    if (el) el.classList.remove('dragging');
    this._positionFloatingAds();
    this.bindFloatingAds(); // DOM 就緒後才綁定拖曳（有 dataset.bound 防重複）
  },

  renderSponsors() {
    const grid = document.getElementById('sponsor-grid');
    if (!grid) return;
    const divider = document.getElementById('sponsor-divider');
    // 2026-04-27：只渲染 active + 有圖片的贊助商，沒有則整區（含上方分隔線）隱藏；不再保留空格
    const activeSponsors = ApiService.getSponsors()
      .filter(sp => sp && sp.status === 'active' && sp.image)
      .sort((a, b) => Number(a.slot || 0) - Number(b.slot || 0));

    if (activeSponsors.length === 0) {
      grid.innerHTML = '';
      grid.style.display = 'none';
      if (divider) divider.style.display = 'none';
      return;
    }

    const html = activeSponsors.map(sp => {
      const hasLink = !!sp.linkUrl && /^https?:\/\//.test(sp.linkUrl);
      const safeUrl = hasLink ? escapeHTML(sp.linkUrl) : '';
      const clickHandler = hasLink
        ? `onclick="App.trackAdClick('sponsor','${escapeHTML(sp.id)}');window.open('${safeUrl}','sporthub_ad')"`
        : '';
      return `<div class="sponsor-slot${hasLink ? ' has-link' : ''}" title="${escapeHTML(sp.title || '贊助商')}" ${clickHandler}>
        <img src="${sp.image}" alt="${escapeHTML(sp.title || '')}" loading="lazy" decoding="async">
      </div>`;
    });

    grid.innerHTML = html.join('');
    grid.style.display = '';
    if (divider) divider.style.display = '';
  },

  _floatAdOffset: 0,
  _floatAdTarget: 0,
  _floatAdRaf: null,

  /** 計算浮動廣告最佳 top：預設螢幕正中央，若與贊助商重疊則上移 */
  _positionFloatingAds() {
    const floatingAds = document.getElementById('floating-ads');
    if (!floatingAds) return;
    const vh = window.innerHeight;
    let topPx = vh / 2; // 螢幕正中央

    // 偵測贊助商區塊位置，避免遮擋
    const sponsorGrid = document.getElementById('sponsor-grid');
    if (sponsorGrid) {
      const rect = sponsorGrid.getBoundingClientRect();
      const adH = floatingAds.offsetHeight || 170; // 兩顆廣告 + gap ≈170
      const adBottom = topPx + adH / 2;
      if (adBottom > rect.top - 12) {
        topPx = rect.top - 12 - adH / 2;
      }
    }

    // 不超出上方邊界
    const minTop = (floatingAds.offsetHeight || 170) / 2 + 60;
    if (topPx < minTop) topPx = minTop;

    floatingAds.style.top = topPx + 'px';
    floatingAds.style.left = '';
    floatingAds.style.right = '.75rem';
    floatingAds.style.transform = 'translateY(-50%)';
  },

  _floatAdDragged: false,

  bindFloatingAds() {
    const floatingAds = document.getElementById('floating-ads');
    if (!floatingAds) return;
    if (floatingAds.dataset.bound) return; // 防止重複綁定
    floatingAds.dataset.bound = '1';

    this._floatAdOffset = 0;
    this._floatAdTarget = 0;
    this._floatAdDragged = false;

    const lerp = (start, end, factor) => start + (end - start) * factor;

    const animate = () => {
      if (this._floatAdDragged) { this._floatAdRaf = null; return; }
      this._floatAdOffset = lerp(this._floatAdOffset, this._floatAdTarget, 0.06);
      if (Math.abs(this._floatAdOffset - this._floatAdTarget) < 0.5) {
        this._floatAdOffset = this._floatAdTarget;
      }
      floatingAds.style.transform = `translateY(calc(-50% + ${this._floatAdOffset}px))`;
      if (Math.abs(this._floatAdOffset - this._floatAdTarget) > 0.5) {
        this._floatAdRaf = requestAnimationFrame(animate);
      } else {
        this._floatAdRaf = null;
      }
    };

    const startAnimation = () => {
      if (this._floatAdDragged) return;
      if (!this._floatAdRaf) {
        this._floatAdRaf = requestAnimationFrame(animate);
      }
    };

    window.addEventListener('scroll', () => {
      if (this._floatAdDragged) return;
      const scrollY = window.scrollY || 0;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollY / docHeight) : 0;
      this._floatAdTarget = (progress - 0.5) * 120;
      startAnimation();
    }, { passive: true });

    // 視窗大小改變時重新計算位置（未拖曳時才生效）
    window.addEventListener('resize', () => {
      if (!this._floatAdDragged) this._positionFloatingAds();
    }, { passive: true });

    this._positionFloatingAds();

    // ── 拖曳功能 ──
    let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0, moved = false;

    const getPos = (e) => {
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX, y: t.clientY };
    };

    const onStart = (e) => {
      const pos = getPos(e);
      startX = pos.x; startY = pos.y;
      const rect = floatingAds.getBoundingClientRect();
      origX = rect.left; origY = rect.top;
      dragging = true; moved = false;
    };

    const onMove = (e) => {
      if (!dragging) return;
      const pos = getPos(e);
      const dx = pos.x - startX, dy = pos.y - startY;
      if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      moved = true;
      if (!this._floatAdDragged) {
        this._floatAdDragged = true;
        floatingAds.classList.add('dragging');
      }
      // 用 fixed 定位直接設座標
      const newX = origX + dx, newY = origY + dy;
      floatingAds.style.top = newY + 'px';
      floatingAds.style.right = 'auto';
      floatingAds.style.left = newX + 'px';
      floatingAds.style.transform = 'none';
      e.preventDefault();
    };

    const onEnd = (e) => {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        // 阻止拖曳結束時觸發 onclick
        floatingAds.querySelectorAll('.float-ad').forEach(ad => {
          ad.style.pointerEvents = 'none';
          setTimeout(() => { ad.style.pointerEvents = ''; }, 300);
        });
        // 吸附到最近的邊緣
        const rect = floatingAds.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const centerX = rect.left + rect.width / 2;
        const edgeGap = 8;
        const snapLeft = edgeGap;
        const snapRight = vw - rect.width - edgeGap;
        const targetX = centerX < vw / 2 ? snapLeft : snapRight;
        // Y 方向限制不超出螢幕
        let targetY = rect.top;
        if (targetY < edgeGap) targetY = edgeGap;
        if (targetY + rect.height > vh - edgeGap) targetY = vh - rect.height - edgeGap;
        floatingAds.style.transition = 'left .3s ease, top .3s ease';
        floatingAds.style.left = targetX + 'px';
        floatingAds.style.top = targetY + 'px';
        setTimeout(() => { floatingAds.style.transition = 'none'; }, 350);
      }
    };

    floatingAds.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    floatingAds.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  },

});
