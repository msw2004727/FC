/* ================================================
   SportHub — Banner Carousel, Floating Ads, Announcement (Frontend)
   ================================================ */

Object.assign(App, {

  renderBannerCarousel() {
    const track = document.getElementById('banner-track');
    if (!track) return;
    const banners = ApiService.getBanners().filter(b => b.status === 'active');
    if (banners.length === 0) {
      track.innerHTML = `<div class="banner-slide banner-placeholder">
        <div class="banner-img-placeholder">1200 × 400</div>
        <div class="banner-content"><div class="banner-tag">廣告</div><h2>暫無廣告</h2><p>敬請期待</p></div>
      </div>`;
    } else {
      track.innerHTML = banners.map(b => {
        const safeUrl = (b.linkUrl && /^https?:\/\//.test(b.linkUrl)) ? escapeHTML(b.linkUrl) : '';
        const clickHandler = safeUrl
          ? `onclick="App.trackAdClick('banner','${escapeHTML(b.id)}');window.open('${safeUrl}','_blank')" style="cursor:pointer"`
          : '';
        if (b.image) {
          return `<div class="banner-slide" style="background-image:url('${b.image}');background-size:cover;background-position:center" ${clickHandler}>
            <div class="banner-content"><div class="banner-tag">${escapeHTML(b.slotName || '廣告位 ' + b.slot)}</div><h2>${escapeHTML(b.title || '')}</h2></div>
          </div>`;
        }
        return `<div class="banner-slide banner-placeholder" style="background:${b.gradient || 'var(--bg-elevated)'}" ${clickHandler}>
          <div class="banner-img-placeholder">1200 × 400</div>
          <div class="banner-content"><div class="banner-tag">${escapeHTML(b.slotName || '廣告位 ' + b.slot)}</div><h2>${escapeHTML(b.title || '')}</h2></div>
        </div>`;
      }).join('');
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
  },

  startBannerCarousel() {
    document.getElementById('banner-prev')?.addEventListener('click', () => {
      const cnt = this.bannerCount || 1;
      this.goToBanner((this.bannerIndex - 1 + cnt) % cnt);
    });
    document.getElementById('banner-next')?.addEventListener('click', () => {
      const cnt = this.bannerCount || 1;
      this.goToBanner((this.bannerIndex + 1) % cnt);
    });
    this.bannerTimer = setInterval(() => {
      const cnt = this.bannerCount || 1;
      this.bannerIndex = (this.bannerIndex + 1) % cnt;
      this.goToBanner(this.bannerIndex);
    }, 8000);
  },

  goToBanner(idx) {
    this.bannerIndex = idx;
    const track = document.getElementById('banner-track');
    if (!track) return;
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
        ? `onclick="App.trackAdClick('float','${escapeHTML(ad.id)}');window.open('${safeUrl}','_blank')"`
        : '';
      return `
      <div class="float-ad" title="${escapeHTML(ad.title || '贊助廣告')}" ${clickHandler}>
        <div class="float-ad-img">${ad.image ? `<img src="${ad.image}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : '廣告'}</div>
      </div>`;
    }).join('');
    // 重設位置與狀態，避免渲染後偏移
    this._floatAdOffset = 0;
    this._floatAdTarget = 0;
    this._floatAdDragged = false;
    const el = document.getElementById('floating-ads');
    if (el) el.classList.remove('dragging');
    this._positionFloatingAds();
  },

  renderSponsors() {
    const grid = document.getElementById('sponsor-grid');
    if (!grid) return;
    const sponsors = ApiService.getSponsors().sort((a, b) => (a.slot || 0) - (b.slot || 0));
    grid.innerHTML = sponsors.map(sp => {
      const isActive = sp.status === 'active' && sp.image;
      const hasLink = isActive && sp.linkUrl;
      const safeUrl = (hasLink && /^https?:\/\//.test(sp.linkUrl)) ? escapeHTML(sp.linkUrl) : '';
      const clickHandler = safeUrl
        ? `onclick="App.trackAdClick('sponsor','${escapeHTML(sp.id)}');window.open('${safeUrl}','_blank')"`
        : '';
      if (isActive) {
        return `<div class="sponsor-slot${hasLink ? ' has-link' : ''}" title="${escapeHTML(sp.title || '贊助商')}" ${clickHandler}>
          <img src="${sp.image}" alt="${escapeHTML(sp.title || '')}">
        </div>`;
      }
      return `<div class="sponsor-slot">贊助商</div>`;
    }).join('');
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
