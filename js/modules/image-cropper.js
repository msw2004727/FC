/* ================================================
   SportHub Image Editor (shared drag / zoom / crop)
   ================================================ */

Object.assign(App, {

  _normalizeImageCropperOptions(opts = {}) {
    const raw = (typeof opts === 'object' && opts) ? opts : {};
    const ratio = Number(raw.aspectRatio);
    const outputWidth = Math.max(320, Math.min(2400, parseInt(raw.outputWidth, 10) || 1200));
    const outputHeight = parseInt(raw.outputHeight, 10) || null;
    const maxZoom = Math.max(2, Math.min(8, Number(raw.maxZoom) || 5));
    const quality = Number.isFinite(Number(raw.quality)) ? Math.max(0.5, Math.min(1, Number(raw.quality))) : 0.9;
    return {
      aspectRatio: ratio > 0 ? ratio : null,
      outputWidth,
      outputHeight: outputHeight && outputHeight > 0 ? Math.max(240, Math.min(2400, outputHeight)) : null,
      outputType: raw.outputType || 'image/webp',
      quality,
      maxZoom,
      title: raw.title || '\u5716\u7247\u7de8\u8f2f',
      subtitle: raw.subtitle || '\u62d6\u66f3\u8abf\u6574\u4f4d\u7f6e\uff0c\u4f7f\u7528\u6ed1\u687f\u6216\u6efe\u8f2a\u653e\u5927\u7e2e\u5c0f',
      confirmText: raw.confirmText || '\u78ba\u8a8d',
      cancelText: raw.cancelText || '\u53d6\u6d88',
      resetText: raw.resetText || '\u91cd\u8a2d',
      rotateLabel: raw.rotateLabel || '\u65cb\u8f49',
      onConfirm: typeof raw.onConfirm === 'function' ? raw.onConfirm : () => {},
      onCancel: typeof raw.onCancel === 'function' ? raw.onCancel : null,
    };
  },

  /**
   * Show a shared image editor for the given image data URL.
   * Backward compatible with the old cropper signature:
   * showImageCropper(dataURL, { aspectRatio, onConfirm, onCancel })
   */
  showImageCropper(dataURL, opts = {}) {
    const config = this._normalizeImageCropperOptions(opts);
    if (!dataURL) {
      if (config.onCancel) config.onCancel();
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'image-cropper-overlay';
    overlay.innerHTML = [
      '<div class="image-cropper-panel" role="dialog" aria-modal="true">',
        '<div class="image-cropper-header">',
          '<div class="image-cropper-heading">',
            '<div class="image-cropper-title"></div>',
            '<div class="image-cropper-subtitle"></div>',
          '</div>',
          '<button type="button" class="image-cropper-icon-btn image-cropper-btn--close" aria-label="Close">&times;</button>',
        '</div>',
        '<div class="image-cropper-workspace">',
          '<div class="image-cropper-loading"></div>',
        '</div>',
        '<div class="image-cropper-controls">',
          '<div class="image-cropper-tool-row">',
            '<button type="button" class="image-cropper-tool" data-action="zoom-out" aria-label="Zoom out">-</button>',
            '<input type="range" class="image-cropper-zoom-slider" min="100" max="' + Math.round(config.maxZoom * 100) + '" value="100">',
            '<button type="button" class="image-cropper-tool" data-action="zoom-in" aria-label="Zoom in">+</button>',
            '<span class="image-cropper-zoom-value">100%</span>',
          '</div>',
          '<div class="image-cropper-tool-row image-cropper-tool-row--secondary">',
            '<button type="button" class="image-cropper-tool image-cropper-tool--wide" data-action="rotate"></button>',
            '<button type="button" class="image-cropper-tool image-cropper-tool--wide" data-action="reset"></button>',
          '</div>',
        '</div>',
        '<div class="image-cropper-actions">',
          '<button type="button" class="image-cropper-btn image-cropper-btn--cancel"></button>',
          '<button type="button" class="image-cropper-btn image-cropper-btn--confirm"></button>',
        '</div>',
      '</div>',
    ].join('');

    document.body.appendChild(overlay);
    document.body.classList.add('image-cropper-open');

    const titleEl = overlay.querySelector('.image-cropper-title');
    const subtitleEl = overlay.querySelector('.image-cropper-subtitle');
    const loadingEl = overlay.querySelector('.image-cropper-loading');
    const workspace = overlay.querySelector('.image-cropper-workspace');
    const slider = overlay.querySelector('.image-cropper-zoom-slider');
    const zoomValue = overlay.querySelector('.image-cropper-zoom-value');
    const cancelBtn = overlay.querySelector('.image-cropper-btn--cancel');
    const confirmBtn = overlay.querySelector('.image-cropper-btn--confirm');
    const closeBtn = overlay.querySelector('.image-cropper-btn--close');
    const rotateBtn = overlay.querySelector('[data-action="rotate"]');
    const resetBtn = overlay.querySelector('[data-action="reset"]');
    const zoomInBtn = overlay.querySelector('[data-action="zoom-in"]');
    const zoomOutBtn = overlay.querySelector('[data-action="zoom-out"]');

    titleEl.textContent = config.title;
    subtitleEl.textContent = config.subtitle;
    loadingEl.textContent = '\u8f09\u5165\u5716\u7247\u4e2d...';
    cancelBtn.textContent = config.cancelText;
    confirmBtn.textContent = config.confirmText;
    rotateBtn.textContent = config.rotateLabel;
    resetBtn.textContent = config.resetText;

    const state = {
      sourceImage: null,
      imgEl: null,
      viewport: null,
      cleanup: [],
      vpW: 0,
      vpH: 0,
      imgW: 0,
      imgH: 0,
      scale: 1,
      tx: 0,
      ty: 0,
    };

    const destroy = (callCancel) => {
      this._cropperDestroy(overlay);
      if (callCancel && config.onCancel) config.onCancel();
    };

    const updateZoomUi = () => {
      slider.value = String(Math.round(state.scale * 100));
      zoomValue.textContent = Math.round(state.scale * 100) + '%';
    };

    const applyTransform = () => {
      if (!state.imgEl) return;
      state.imgEl.style.width = state.imgW + 'px';
      state.imgEl.style.height = state.imgH + 'px';
      state.imgEl.style.transform = 'translate3d(' + state.tx + 'px,' + state.ty + 'px,0) scale(' + state.scale + ')';
      updateZoomUi();
    };

    const clampPosition = () => {
      const scaledW = state.imgW * state.scale;
      const scaledH = state.imgH * state.scale;
      state.tx = scaledW <= state.vpW
        ? Math.round((state.vpW - scaledW) / 2)
        : Math.min(0, Math.max(state.vpW - scaledW, state.tx));
      state.ty = scaledH <= state.vpH
        ? Math.round((state.vpH - scaledH) / 2)
        : Math.min(0, Math.max(state.vpH - scaledH, state.ty));
    };

    const resetTransform = () => {
      if (!state.sourceImage) return;
      const naturalW = state.sourceImage.naturalWidth || state.sourceImage.width;
      const naturalH = state.sourceImage.naturalHeight || state.sourceImage.height;
      const fitScale = Math.max(state.vpW / naturalW, state.vpH / naturalH);
      state.imgW = Math.max(1, naturalW * fitScale);
      state.imgH = Math.max(1, naturalH * fitScale);
      state.scale = 1;
      state.tx = Math.round((state.vpW - state.imgW) / 2);
      state.ty = Math.round((state.vpH - state.imgH) / 2);
      clampPosition();
      applyTransform();
    };

    const setScale = (nextScale, originX = state.vpW / 2, originY = state.vpH / 2) => {
      const oldScale = state.scale || 1;
      const clamped = Math.max(1, Math.min(config.maxZoom, Number(nextScale) || 1));
      if (Math.abs(clamped - oldScale) < 0.001) return;
      const ratio = clamped / oldScale;
      state.tx = originX - (originX - state.tx) * ratio;
      state.ty = originY - (originY - state.ty) * ratio;
      state.scale = clamped;
      clampPosition();
      applyTransform();
    };

    const bindEditorEvents = () => {
      const viewport = state.viewport;
      const pointers = new Map();
      let dragStart = null;
      let pinchStart = null;

      const pointFromEvent = (event) => ({ x: event.clientX, y: event.clientY });
      const getLocalPoint = (event) => {
        const rect = viewport.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
      };
      const pointerDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const pointerCenter = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const startPinch = () => {
        const values = Array.from(pointers.values());
        if (values.length < 2) return;
        const rect = viewport.getBoundingClientRect();
        const p1 = values[0];
        const p2 = values[1];
        const center = pointerCenter(p1, p2);
        pinchStart = {
          dist: pointerDistance(p1, p2) || 1,
          scale: state.scale,
          tx: state.tx,
          ty: state.ty,
          cx: center.x - rect.left,
          cy: center.y - rect.top,
        };
      };

      const onPointerDown = (event) => {
        event.preventDefault();
        viewport.setPointerCapture?.(event.pointerId);
        pointers.set(event.pointerId, pointFromEvent(event));
        if (pointers.size === 1) {
          dragStart = {
            x: event.clientX,
            y: event.clientY,
            tx: state.tx,
            ty: state.ty,
          };
          pinchStart = null;
        } else if (pointers.size === 2) {
          dragStart = null;
          startPinch();
        }
      };

      const onPointerMove = (event) => {
        if (!pointers.has(event.pointerId)) return;
        event.preventDefault();
        pointers.set(event.pointerId, pointFromEvent(event));
        if (pointers.size === 1 && dragStart) {
          state.tx = dragStart.tx + (event.clientX - dragStart.x);
          state.ty = dragStart.ty + (event.clientY - dragStart.y);
          clampPosition();
          applyTransform();
          return;
        }
        if (pointers.size >= 2 && pinchStart) {
          const rect = viewport.getBoundingClientRect();
          const values = Array.from(pointers.values());
          const p1 = values[0];
          const p2 = values[1];
          const center = pointerCenter(p1, p2);
          const dist = pointerDistance(p1, p2) || 1;
          const nextScale = Math.max(1, Math.min(config.maxZoom, pinchStart.scale * (dist / pinchStart.dist)));
          const ratio = nextScale / pinchStart.scale;
          state.scale = nextScale;
          state.tx = (center.x - rect.left) - (pinchStart.cx - pinchStart.tx) * ratio;
          state.ty = (center.y - rect.top) - (pinchStart.cy - pinchStart.ty) * ratio;
          clampPosition();
          applyTransform();
        }
      };

      const onPointerEnd = (event) => {
        pointers.delete(event.pointerId);
        viewport.releasePointerCapture?.(event.pointerId);
        if (pointers.size === 1) {
          const remaining = Array.from(pointers.values())[0];
          dragStart = { x: remaining.x, y: remaining.y, tx: state.tx, ty: state.ty };
          pinchStart = null;
        } else if (pointers.size === 0) {
          dragStart = null;
          pinchStart = null;
        }
      };

      const onWheel = (event) => {
        event.preventDefault();
        const p = getLocalPoint(event);
        const factor = event.deltaY < 0 ? 1.08 : 0.92;
        setScale(state.scale * factor, p.x, p.y);
      };

      viewport.addEventListener('pointerdown', onPointerDown);
      viewport.addEventListener('pointermove', onPointerMove);
      viewport.addEventListener('pointerup', onPointerEnd);
      viewport.addEventListener('pointercancel', onPointerEnd);
      viewport.addEventListener('wheel', onWheel, { passive: false });

      state.cleanup.push(() => {
        viewport.removeEventListener('pointerdown', onPointerDown);
        viewport.removeEventListener('pointermove', onPointerMove);
        viewport.removeEventListener('pointerup', onPointerEnd);
        viewport.removeEventListener('pointercancel', onPointerEnd);
        viewport.removeEventListener('wheel', onWheel);
      });
    };

    const mountEditor = (sourceImage) => {
      state.cleanup.forEach(fn => { try { fn(); } catch (_) {} });
      state.cleanup = [];
      state.sourceImage = sourceImage;

      const viewportSize = this._cropperComputeViewport(sourceImage, config.aspectRatio);
      state.vpW = viewportSize.width;
      state.vpH = viewportSize.height;
      workspace.innerHTML = [
        '<div class="image-cropper-viewport" style="width:' + state.vpW + 'px;height:' + state.vpH + 'px">',
          '<img class="image-cropper-image" alt="">',
          '<div class="image-cropper-grid" aria-hidden="true"></div>',
        '</div>',
      ].join('');
      state.viewport = workspace.querySelector('.image-cropper-viewport');
      state.imgEl = workspace.querySelector('.image-cropper-image');
      state.imgEl.src = sourceImage.src;
      bindEditorEvents();
      resetTransform();
    };

    const loadSource = (src) => {
      workspace.innerHTML = '<div class="image-cropper-loading"></div>';
      workspace.querySelector('.image-cropper-loading').textContent = '\u8f09\u5165\u5716\u7247\u4e2d...';
      const sourceImage = new Image();
      sourceImage.onload = () => mountEditor(sourceImage);
      sourceImage.onerror = () => {
        this._cropperDestroy(overlay);
        this.showToast?.('\u5716\u7247\u8b80\u53d6\u5931\u6557\uff0c\u8acb\u63db\u4e00\u5f35\u5716\u7247');
        if (config.onCancel) config.onCancel();
      };
      sourceImage.src = src;
    };

    slider.addEventListener('input', () => setScale(parseInt(slider.value, 10) / 100));
    zoomInBtn.addEventListener('click', () => setScale(state.scale + 0.12));
    zoomOutBtn.addEventListener('click', () => setScale(state.scale - 0.12));
    resetBtn.addEventListener('click', resetTransform);
    rotateBtn.addEventListener('click', () => {
      if (!state.sourceImage) return;
      try {
        const rotated = this._cropperRotateSource(state.sourceImage, config);
        loadSource(rotated);
      } catch (err) {
        console.error('[ImageCropper] rotate failed:', err);
        this.showToast?.('\u5716\u7247\u65cb\u8f49\u5931\u6557');
      }
    });
    cancelBtn.addEventListener('click', () => destroy(true));
    closeBtn.addEventListener('click', () => destroy(true));
    confirmBtn.addEventListener('click', () => {
      if (!state.sourceImage) return;
      try {
        confirmBtn.disabled = true;
        const result = this._cropperRenderResult(state.sourceImage, state, state.vpW, state.vpH, config);
        this._cropperDestroy(overlay);
        config.onConfirm(result);
      } catch (err) {
        console.error('[ImageCropper] render failed:', err);
        confirmBtn.disabled = false;
        this.showToast?.('\u5716\u7247\u8655\u7406\u5931\u6557\uff0c\u8acb\u91cd\u8a66');
      }
    });

    overlay._cropperCleanup = () => {
      state.cleanup.forEach(fn => { try { fn(); } catch (_) {} });
      state.cleanup = [];
      document.body.classList.remove('image-cropper-open');
    };

    loadSource(dataURL);
  },

  _cropperComputeViewport(sourceImage, forcedRatio) {
    const naturalW = sourceImage.naturalWidth || sourceImage.width || 1;
    const naturalH = sourceImage.naturalHeight || sourceImage.height || 1;
    const ratio = forcedRatio || (naturalW / naturalH) || 1;
    const maxW = Math.max(260, Math.min(window.innerWidth - 32, 760));
    const maxH = Math.max(240, Math.min(window.innerHeight * 0.58, 560));
    let width;
    let height;
    if (maxW / ratio <= maxH) {
      width = maxW;
      height = maxW / ratio;
    } else {
      height = maxH;
      width = maxH * ratio;
    }
    return {
      width: Math.max(220, Math.round(width)),
      height: Math.max(180, Math.round(height)),
    };
  },

  _cropperRotateSource(img, config) {
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = naturalH;
    canvas.height = naturalW;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -naturalW / 2, -naturalH / 2, naturalW, naturalH);
    ctx.restore();
    let result = canvas.toDataURL(config.outputType, config.quality);
    if (config.outputType === 'image/webp' && !result.startsWith('data:image/webp')) {
      result = canvas.toDataURL('image/jpeg', config.quality);
    }
    return result;
  },

  _cropperRenderResult(sourceImage, state, vpW, vpH, config = {}) {
    const canvas = document.createElement('canvas');
    const outputW = Math.max(320, Math.min(2400, parseInt(config.outputWidth, 10) || 1200));
    const outputH = Math.max(240, Math.min(2400, parseInt(config.outputHeight, 10) || Math.round(outputW * vpH / vpW)));
    canvas.width = outputW;
    canvas.height = outputH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (config.outputType === 'image/jpeg') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, outputW, outputH);
    }

    const ratioX = outputW / vpW;
    const ratioY = outputH / vpH;
    ctx.drawImage(
      sourceImage,
      state.tx * ratioX,
      state.ty * ratioY,
      state.imgW * state.scale * ratioX,
      state.imgH * state.scale * ratioY
    );

    const outputType = config.outputType || 'image/webp';
    const quality = Number.isFinite(Number(config.quality)) ? Number(config.quality) : 0.9;
    let result = canvas.toDataURL(outputType, quality);
    if (outputType === 'image/webp' && !result.startsWith('data:image/webp')) {
      result = canvas.toDataURL('image/jpeg', quality);
    }
    return result;
  },

  _cropperDestroy(overlay) {
    if (!overlay) return;
    if (typeof overlay._cropperCleanup === 'function') {
      overlay._cropperCleanup();
    }
    const viewport = overlay.querySelector('.image-cropper-viewport');
    if (viewport && viewport._cropCleanup) viewport._cropCleanup();
    overlay.remove();
    document.body.classList.remove('image-cropper-open');
  },

});
