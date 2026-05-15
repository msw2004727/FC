/**
 * @jest-environment jsdom
 */

const path = require('path');

describe('home banner carousel image loading', () => {
  let createdImages;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    document.body.innerHTML = `
      <div class="banner-carousel">
        <div class="banner-track" id="banner-track"></div>
        <button id="banner-prev"></button>
        <button id="banner-next"></button>
        <div id="banner-dots"></div>
      </div>
    `;

    createdImages = [];
    class MockImage {
      constructor() {
        this.fetchPriority = '';
        this.decoding = '';
        createdImages.push(this);
      }

      set src(value) {
        this._src = value;
      }

      get src() {
        return this._src;
      }

      decode() {
        return new Promise(() => {});
      }
    }

    global.Image = MockImage;
    window.requestIdleCallback = (cb) => {
      cb();
      return 1;
    };
    global.escapeHTML = (value) => String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    global.ApiService = {
      getBanners: () => [
        { id: 'ban1', status: 'active', image: 'https://cdn.test/one.jpg', slot: 1, title: 'First banner', subtitle: 'First subtitle' },
        { id: 'ban2', status: 'active', image: 'https://cdn.test/two.jpg', slot: 2, title: 'Second banner', subtitle: 'Second subtitle' },
        { id: 'ban3', status: 'active', image: 'https://cdn.test/three.jpg', slot: 3, title: 'Third banner', subtitle: 'Third subtitle' },
      ],
    };
    global.App = {
      bannerIndex: 0,
      bannerCount: 0,
      bannerTimer: null,
      stopBannerCarousel() {
        if (!this.bannerTimer) return;
        clearInterval(this.bannerTimer);
        this.bannerTimer = null;
      },
      startBannerCarousel() {},
    };

    require(path.resolve(__dirname, '../../js/modules/banner.js'));
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.App;
    delete global.ApiService;
    delete global.escapeHTML;
    delete global.Image;
    delete window.requestIdleCallback;
  });

  test('non-first slides are forced out of loading state instead of staying blank', () => {
    App.renderBannerCarousel({ autoplay: false });

    const slides = Array.from(document.querySelectorAll('.banner-slide'));
    expect(slides).toHaveLength(3);
    expect(document.querySelector('.banner-fixed-content')).not.toBeNull();
    expect(document.querySelectorAll('.banner-slide .banner-content')).toHaveLength(0);
    expect(createdImages).toHaveLength(3);
    expect(createdImages.map(img => img.fetchPriority)).toEqual(['high', 'low', 'low']);
    expect(createdImages.some(img => img.loading === 'lazy')).toBe(false);

    App.goToBanner(1);
    jest.advanceTimersByTime(3500);

    expect(slides[1].classList.contains('banner-slide--loading')).toBe(false);
    expect(slides[1].style.backgroundImage).toContain('two.jpg');
  });

  test('fixed overlay is rendered once before dots and does not follow slide content', () => {
    App.renderBannerCarousel({ autoplay: false });

    const carousel = document.querySelector('.banner-carousel');
    const fixed = document.querySelector('.banner-fixed-content');
    const dots = document.getElementById('banner-dots');

    expect(document.querySelectorAll('.banner-fixed-content')).toHaveLength(1);
    expect(Array.from(carousel.children).indexOf(fixed)).toBeLessThan(Array.from(carousel.children).indexOf(dots));
    expect(fixed.textContent).toContain('First banner');
    expect(fixed.textContent).toContain('First subtitle');
    expect(document.querySelectorAll('.banner-slide .banner-content')).toHaveLength(0);

    App.goToBanner(2);

    expect(document.querySelectorAll('.banner-fixed-content')).toHaveLength(1);
    expect(fixed.textContent).toContain('First banner');
    expect(fixed.textContent).not.toContain('Third banner');
    expect(document.querySelectorAll('.banner-dot')[2].classList.contains('active')).toBe(true);
  });

  test('rerendering with the same data refreshes fixed overlay without duplicating it', () => {
    App.renderBannerCarousel({ autoplay: false });
    App.renderBannerCarousel({ autoplay: false });

    expect(document.querySelectorAll('.banner-fixed-content')).toHaveLength(1);
    expect(document.querySelectorAll('.banner-dot')).toHaveLength(3);
  });
});
