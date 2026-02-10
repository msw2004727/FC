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
        const clickHandler = b.linkUrl
          ? `onclick="App.trackAdClick('banner','${b.id}');window.open('${b.linkUrl}','_blank')" style="cursor:pointer"`
          : '';
        if (b.image) {
          return `<div class="banner-slide" style="background-image:url('${b.image}');background-size:cover;background-position:center" ${clickHandler}>
            <div class="banner-content"><div class="banner-tag">${b.slotName || '廣告位 ' + b.slot}</div><h2>${b.title || ''}</h2></div>
          </div>`;
        }
        return `<div class="banner-slide banner-placeholder" style="background:${b.gradient || 'var(--bg-elevated)'}" ${clickHandler}>
          <div class="banner-img-placeholder">1200 × 400</div>
          <div class="banner-content"><div class="banner-tag">${b.slotName || '廣告位 ' + b.slot}</div><h2>${b.title || ''}</h2></div>
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
    track.style.transform = `translateX(-${idx * 100}%)`;
    document.querySelectorAll('.banner-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  },

  renderAnnouncement() {
    const container = document.getElementById('announce-body');
    const card = document.getElementById('announce-card');
    if (!container || !card) return;
    const ann = ApiService.getActiveAnnouncement();
    if (ann) {
      container.innerHTML = `<p>${ann.content}</p>`;
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  },

  renderFloatingAds() {
    const container = document.getElementById('floating-ads');
    if (!container) return;
    const ads = ApiService.getFloatingAds().filter(ad => ad.status === 'active');
    container.innerHTML = ads.map(ad => {
      const clickHandler = ad.linkUrl
        ? `onclick="App.trackAdClick('float','${ad.id}');window.open('${ad.linkUrl}','_blank')"`
        : '';
      return `
      <div class="float-ad" title="${ad.title || '贊助廣告'}" ${clickHandler}>
        <div class="float-ad-img">${ad.image ? `<img src="${ad.image}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : '廣告'}</div>
      </div>`;
    }).join('');
  },

  bindFloatingAds() {
    const floatingAds = document.getElementById('floating-ads');
    if (!floatingAds) return;

    let targetOffset = 0;
    let currentOffset = 0;
    let rafId = null;

    const lerp = (start, end, factor) => start + (end - start) * factor;

    const animate = () => {
      currentOffset = lerp(currentOffset, targetOffset, 0.06);
      if (Math.abs(currentOffset - targetOffset) < 0.5) {
        currentOffset = targetOffset;
      }
      floatingAds.style.transform = `translateY(calc(-50% + ${currentOffset}px))`;
      if (Math.abs(currentOffset - targetOffset) > 0.5) {
        rafId = requestAnimationFrame(animate);
      } else {
        rafId = null;
      }
    };

    const startAnimation = () => {
      if (!rafId) {
        rafId = requestAnimationFrame(animate);
      }
    };

    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY || 0;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollY / docHeight) : 0;
      targetOffset = (progress - 0.5) * 120;
      startAnimation();
    }, { passive: true });

    floatingAds.style.top = '60vh';
    floatingAds.style.transform = 'translateY(-50%)';
  },

});
