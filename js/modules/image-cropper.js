/* ================================================
   SportHub — Image Cropper (drag + zoom + canvas crop)
   ================================================ */

Object.assign(App, {

  /**
   * Show a full-screen crop modal for the given image.
   * @param {string} dataURL - base64 image
   * @param {Object} opts
   * @param {number} opts.aspectRatio - width/height (e.g. 16/9, 1, 3)
   * @param {function} opts.onConfirm - callback(croppedDataURL)
   * @param {function} [opts.onCancel]
   */
  showImageCropper(dataURL, opts) {
    const { aspectRatio, onConfirm, onCancel } = opts;
    if (!aspectRatio) { onConfirm(dataURL); return; }

    const overlay = document.createElement('div');
    overlay.className = 'image-cropper-overlay';

    // Viewport dimensions: fit within 90vw x 65vh keeping aspect ratio
    const maxW = window.innerWidth * 0.9;
    const maxH = window.innerHeight * 0.65;
    let vpW, vpH;
    if (maxW / aspectRatio <= maxH) {
      vpW = Math.round(maxW);
      vpH = Math.round(maxW / aspectRatio);
    } else {
      vpH = Math.round(maxH);
      vpW = Math.round(maxH * aspectRatio);
    }

    overlay.innerHTML =
      '<div class="image-cropper-viewport" style="width:' + vpW + 'px;height:' + vpH + 'px">' +
        '<img src="' + dataURL + '" alt="">' +
      '</div>' +
      '<div class="image-cropper-toolbar">' +
        '<span style="color:#fff;font-size:13px">-</span>' +
        '<input type="range" class="image-cropper-zoom-slider" min="100" max="300" value="100">' +
        '<span style="color:#fff;font-size:13px">+</span>' +
      '</div>' +
      '<div class="image-cropper-actions">' +
        '<button class="image-cropper-btn image-cropper-btn--cancel">取消</button>' +
        '<button class="image-cropper-btn image-cropper-btn--confirm">確認裁切</button>' +
      '</div>';

    document.body.appendChild(overlay);

    const img = overlay.querySelector('.image-cropper-viewport img');
    const viewport = overlay.querySelector('.image-cropper-viewport');
    const slider = overlay.querySelector('.image-cropper-zoom-slider');
    const cancelBtn = overlay.querySelector('.image-cropper-btn--cancel');
    const confirmBtn = overlay.querySelector('.image-cropper-btn--confirm');

    // State
    const state = { scale: 1, tx: 0, ty: 0, imgW: 0, imgH: 0 };

    const applyTransform = () => {
      img.style.transform = 'translate(' + state.tx + 'px,' + state.ty + 'px) scale(' + state.scale + ')';
    };

    const clampPosition = () => {
      const sW = state.imgW * state.scale;
      const sH = state.imgH * state.scale;
      // Image must cover viewport: tx <= 0, tx >= vpW - sW
      state.tx = Math.min(0, Math.max(vpW - sW, state.tx));
      state.ty = Math.min(0, Math.max(vpH - sH, state.ty));
    };

    // Wait for image to load to compute fit scale
    const imgEl = new Image();
    imgEl.onload = () => {
      state.imgW = imgEl.width;
      state.imgH = imgEl.height;
      // Fit: ensure image covers viewport at scale=1
      const fitScale = Math.max(vpW / imgEl.width, vpH / imgEl.height);
      state.imgW = Math.round(imgEl.width * fitScale);
      state.imgH = Math.round(imgEl.height * fitScale);
      img.style.width = state.imgW + 'px';
      img.style.height = state.imgH + 'px';
      // Center
      state.tx = Math.round((vpW - state.imgW) / 2);
      state.ty = Math.round((vpH - state.imgH) / 2);
      state.scale = 1;
      applyTransform();
    };
    imgEl.src = dataURL;

    // Drag
    this._cropperInitDrag(viewport, state, vpW, vpH, applyTransform, clampPosition);

    // Zoom slider
    slider.addEventListener('input', () => {
      const oldScale = state.scale;
      state.scale = parseInt(slider.value, 10) / 100;
      // Zoom toward viewport center
      const cx = vpW / 2;
      const cy = vpH / 2;
      state.tx = cx - (cx - state.tx) * (state.scale / oldScale);
      state.ty = cy - (cy - state.ty) * (state.scale / oldScale);
      clampPosition();
      applyTransform();
    });

    // Pinch-to-zoom
    this._cropperInitPinch(viewport, state, vpW, vpH, slider, applyTransform, clampPosition);

    // Buttons
    cancelBtn.addEventListener('click', () => {
      this._cropperDestroy(overlay);
      if (onCancel) onCancel();
    });

    confirmBtn.addEventListener('click', () => {
      const result = this._cropperRenderResult(img, state, vpW, vpH);
      this._cropperDestroy(overlay);
      onConfirm(result);
    });
  },

  _cropperInitDrag(viewport, state, vpW, vpH, applyTransform, clampPosition) {
    let dragging = false;
    let startX = 0, startY = 0, startTx = 0, startTy = 0;

    const onStart = (x, y) => {
      dragging = true;
      startX = x; startY = y;
      startTx = state.tx; startTy = state.ty;
    };
    const onMove = (x, y) => {
      if (!dragging) return;
      state.tx = startTx + (x - startX);
      state.ty = startTy + (y - startY);
      clampPosition();
      applyTransform();
    };
    const onEnd = () => { dragging = false; };

    const onMouseDown = (e) => {
      e.preventDefault();
      onStart(e.clientX, e.clientY);
    };
    const onMouseMove = (e) => {
      if (!dragging) return;
      e.preventDefault();
      onMove(e.clientX, e.clientY);
    };
    const onTouchStart = (e) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        onStart(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length === 1 && dragging) {
        e.preventDefault();
        onMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    viewport.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onEnd);

    viewport.addEventListener('touchstart', onTouchStart, { passive: false });
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onEnd);
    viewport.addEventListener('touchcancel', onEnd);

    // Store cleanup refs
    viewport._cropCleanup = () => {
      viewport.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onEnd);
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onEnd);
      viewport.removeEventListener('touchcancel', onEnd);
    };
  },

  _cropperInitPinch(viewport, state, vpW, vpH, slider, applyTransform, clampPosition) {
    let initDist = 0;
    let initScale = 1;

    viewport.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initDist = Math.sqrt(dx * dx + dy * dy);
        initScale = state.scale;
      }
    }, { passive: false });

    viewport.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const oldScale = state.scale;
        state.scale = Math.min(3, Math.max(1, initScale * (dist / initDist)));
        slider.value = Math.round(state.scale * 100);
        // Zoom toward viewport center
        const cx = vpW / 2;
        const cy = vpH / 2;
        state.tx = cx - (cx - state.tx) * (state.scale / oldScale);
        state.ty = cy - (cy - state.ty) * (state.scale / oldScale);
        clampPosition();
        applyTransform();
      }
    }, { passive: false });
  },

  _cropperRenderResult(img, state, vpW, vpH) {
    const canvas = document.createElement('canvas');
    // Output resolution: fixed 1200px width, height by aspect ratio (not tied to screen size)
    const outputW = 1200;
    const outputH = Math.round(1200 * vpH / vpW);
    canvas.width = outputW;
    canvas.height = outputH;
    const ctx = canvas.getContext('2d');

    // Map viewport coords to canvas coords
    const ratioX = outputW / vpW;
    const ratioY = outputH / vpH;

    ctx.drawImage(
      img,
      state.tx * ratioX,
      state.ty * ratioY,
      state.imgW * state.scale * ratioX,
      state.imgH * state.scale * ratioY
    );

    let result = canvas.toDataURL('image/webp', 0.90);
    if (!result.startsWith('data:image/webp')) {
      result = canvas.toDataURL('image/jpeg', 0.90);
    }
    return result;
  },

  _cropperDestroy(overlay) {
    const viewport = overlay.querySelector('.image-cropper-viewport');
    if (viewport && viewport._cropCleanup) viewport._cropCleanup();
    overlay.remove();
  },

});
