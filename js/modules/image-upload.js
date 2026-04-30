/* ================================================
   SportHub Image Upload Preview Binding + Compression
   ================================================ */

Object.assign(App, {

  _readImageFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = (event) => resolve(event.target.result);
      reader.readAsDataURL(file);
    });
  },

  /**
   * Compress image via canvas.
   * @param {File} file
   * @param {number} maxWidth
   * @param {number} quality
   * @param {string} [outputType]
   * @returns {Promise<string>} base64 data URL
   */
  _compressImage(file, maxWidth = 1600, quality = 0.92, outputType = 'image/webp') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let w = img.width;
          let h = img.height;
          if (w > maxWidth) {
            h = Math.round(h * maxWidth / w);
            w = maxWidth;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
          let result = canvas.toDataURL(outputType, quality);
          if (outputType === 'image/webp' && !result.startsWith('data:image/webp')) {
            result = canvas.toDataURL('image/jpeg', quality);
          }
          resolve(result);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  },

  _normalizeImageUploadOptions(uploadOptions) {
    const raw = (typeof uploadOptions === 'object' && uploadOptions !== null)
      ? uploadOptions
      : { aspectRatio: uploadOptions };
    const ratio = Number(raw.aspectRatio);
    const outputWidth = parseInt(raw.outputWidth, 10);
    const outputHeight = parseInt(raw.outputHeight, 10);
    const quality = Number.isFinite(Number(raw.quality)) ? Math.max(0.5, Math.min(1, Number(raw.quality))) : 0.9;
    return {
      aspectRatio: ratio > 0 ? ratio : null,
      enableEditor: raw.enableEditor !== false,
      outputWidth: outputWidth > 0 ? outputWidth : (ratio > 0 ? 1200 : 1600),
      outputHeight: outputHeight > 0 ? outputHeight : null,
      outputType: raw.outputType || 'image/webp',
      quality,
      title: raw.title || '\u5716\u7247\u7de8\u8f2f',
      subtitle: raw.subtitle,
      onConfirm: typeof raw.onConfirm === 'function' ? raw.onConfirm : null,
      onCancel: typeof raw.onCancel === 'function' ? raw.onCancel : null,
    };
  },

  /** Check supported image file by MIME type or extension. */
  _isAllowedImageFile(file) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (file.type && allowedTypes.includes(file.type.toLowerCase())) return true;
    const ext = (file.name || '').split('.').pop().toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext);
  },

  bindImageUpload(inputId, previewId, uploadOptions) {
    const input = document.getElementById(inputId);
    if (!input) return;

    if (!input._imageUploadOptions || uploadOptions !== undefined) {
      input._imageUploadOptions = this._normalizeImageUploadOptions(uploadOptions);
    }

    if (input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (!this._isAllowedImageFile(file)) {
        this.showToast('\u8acb\u4e0a\u50b3 JPG / PNG / WebP \u5716\u7247');
        input.value = '';
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        this.showToast('\u5716\u7247\u592a\u5927\uff0c\u4e0d\u80fd\u8d85\u904e 5MB');
        input.value = '';
        return;
      }

      const config = input._imageUploadOptions || this._normalizeImageUploadOptions(uploadOptions);
      const setPreview = (finalURL) => {
        const preview = document.getElementById(previewId);
        if (!preview) return;
        preview.innerHTML = '';
        preview.style.backgroundImage = '';
        const img = document.createElement('img');
        img.src = finalURL;
        img.alt = '';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = 'var(--radius-sm)';
        preview.appendChild(img);
        preview.classList.add('has-image');
        if (config.onConfirm) config.onConfirm(finalURL, { input, preview, file });
        try {
          input.dispatchEvent(new CustomEvent('imageupload:preview', {
            detail: { src: finalURL, previewId, file },
          }));
        } catch (_) {}
      };

      try {
        if (config.enableEditor && typeof this.showImageCropper === 'function') {
          const sourceDataURL = await this._readImageFileAsDataURL(file);
          this.showImageCropper(sourceDataURL, {
            aspectRatio: config.aspectRatio,
            outputWidth: config.outputWidth,
            outputHeight: config.outputHeight,
            outputType: config.outputType,
            quality: config.quality,
            title: config.title,
            subtitle: config.subtitle,
            onConfirm: setPreview,
            onCancel: () => {
              input.value = '';
              if (config.onCancel) config.onCancel({ input, file });
            },
          });
          return;
        }

        const dataURL = await this._compressImage(file, config.outputWidth || 1600, config.quality || 0.9, config.outputType || 'image/webp');
        setPreview(dataURL);
      } catch (err) {
        console.error('[ImageUpload] image processing failed:', err);
        this.showToast('\u5716\u7247\u8655\u7406\u5931\u6557\uff0c\u8acb\u91cd\u8a66');
        input.value = '';
      }
    });
  },

});
