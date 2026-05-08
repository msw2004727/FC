/* Activity female-only tab theme and petal canvas. */

Object.assign(App, {
  _femalePetalState: null,

  _syncActivityFemaleTheme(tab = this._activityActiveTab) {
    const page = document.getElementById('page-activities');
    if (!page) return;

    const active = tab === 'female';
    page.classList.toggle('activity-female-theme', active);

    if (active) this._startActivityFemalePetals();
    else this._stopActivityFemalePetals();
  },

  _startActivityFemalePetals() {
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const page = document.getElementById('page-activities');
    const canvas = document.getElementById('activity-female-petals');
    if (!page || !canvas) return;
    if (this._femalePetalState?.running) return;

    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;

    const state = {
      canvas,
      ctx,
      petals: [],
      raf: 0,
      running: true,
      last: 0,
      cssWidth: 0,
      cssHeight: 0,
      resizeHandler: null,
    };
    this._femalePetalState = state;

    state.resizeHandler = () => this._resizeActivityFemalePetals();
    window.addEventListener('resize', state.resizeHandler, { passive: true });
    this._resizeActivityFemalePetals();

    const count = Math.max(14, Math.min(34, Math.round(((state.cssWidth || 360) / 14) * 0.8)));
    state.petals = Array.from({ length: count }, () => this._createActivityFemalePetal(true));

    const animate = timestamp => {
      if (!state.running
        || !page.classList.contains('activity-female-theme')
        || (this.currentPage && this.currentPage !== 'page-activities')) {
        this._stopActivityFemalePetals();
        return;
      }

      const delta = Math.min(32, timestamp - (state.last || timestamp));
      state.last = timestamp;
      ctx.clearRect(0, 0, state.cssWidth, state.cssHeight);

      state.petals.forEach(petal => {
        petal.y += petal.speed * delta;
        petal.x += (petal.drift + Math.sin((petal.y + petal.seed) * 0.016) * 0.22) * delta;
        petal.angle += petal.spin * delta;

        if (petal.y > state.cssHeight + 24 || petal.x < -36 || petal.x > state.cssWidth + 36) {
          Object.assign(petal, this._createActivityFemalePetal(false));
        }

        this._drawActivityFemalePetal(petal);
      });

      state.raf = window.requestAnimationFrame(animate);
    };

    state.raf = window.requestAnimationFrame(animate);
  },

  _resizeActivityFemalePetals() {
    const state = this._femalePetalState;
    if (!state?.canvas || !state.ctx) return;

    const page = document.getElementById('page-activities');
    const rect = page?.getBoundingClientRect?.();
    const width = Math.max(1, Math.round(rect?.width || page?.clientWidth || 360));
    const height = Math.max(1, Math.round(rect?.height || page?.clientHeight || window.innerHeight || 640));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    state.cssWidth = width;
    state.cssHeight = height;
    state.canvas.width = Math.round(width * dpr);
    state.canvas.height = Math.round(height * dpr);
    state.canvas.style.width = `${width}px`;
    state.canvas.style.height = `${height}px`;
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  _createActivityFemalePetal(randomY = false) {
    const state = this._femalePetalState || {};
    const width = state.cssWidth || 360;
    const height = state.cssHeight || 640;
    return {
      x: Math.random() * width,
      y: randomY ? Math.random() * height : -18 - Math.random() * 120,
      size: 5 + Math.random() * 6,
      speed: 0.0365 + Math.random() * 0.07,
      drift: -0.12 + Math.random() * 0.24,
      angle: Math.random() * Math.PI * 2,
      spin: -0.012 + Math.random() * 0.024,
      alpha: 0.38 + Math.random() * 0.32,
      seed: Math.random() * 1000,
    };
  },

  _drawActivityFemalePetal(petal) {
    const state = this._femalePetalState;
    if (!state?.ctx) return;

    const ctx = state.ctx;
    ctx.save();
    ctx.translate(petal.x, petal.y);
    ctx.rotate(petal.angle);
    ctx.globalAlpha = petal.alpha;
    ctx.fillStyle = '#f9a8d4';
    ctx.strokeStyle = 'rgba(236,72,153,.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, petal.size * 0.55, petal.size, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  },

  _stopActivityFemalePetals() {
    const state = this._femalePetalState;
    if (!state) return;

    state.running = false;
    if (state.raf && typeof window !== 'undefined') window.cancelAnimationFrame(state.raf);
    if (state.resizeHandler && typeof window !== 'undefined') {
      window.removeEventListener('resize', state.resizeHandler);
    }
    try { state.ctx?.clearRect(0, 0, state.cssWidth || state.canvas.width, state.cssHeight || state.canvas.height); } catch (_) {}
    this._femalePetalState = null;
  },
});
