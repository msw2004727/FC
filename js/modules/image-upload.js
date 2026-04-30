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
      targetLabel: raw.targetLabel,
      recommendedSize: raw.recommendedSize,
      aspectLabel: raw.aspectLabel,
      frameHint: raw.frameHint,
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

  _setImageUploadPreview(previewId, finalURL) {
    const preview = document.getElementById(previewId);
    if (!preview) return null;
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
    return preview;
  },

  _getImageVariantUrl(record, variantKey, fallbackKey = 'image') {
    if (!record || typeof record !== 'object') return '';
    const variants = record.imageVariants && typeof record.imageVariants === 'object'
      ? record.imageVariants
      : {};
    const key = String(variantKey || '').trim();
    if (key && variants[key]) return variants[key];
    if (key !== 'cover' && variants.cover) return variants.cover;
    if (fallbackKey && record[fallbackKey]) return record[fallbackKey];
    return '';
  },

  _getTeamImageUrl(team, variantKey) {
    return this._getImageVariantUrl(team, variantKey, 'image');
  },

  _getTeamImageVariantTargets() {
    return [
      {
        key: 'cover',
        aspectRatio: 8 / 3,
        outputWidth: 1200,
        outputHeight: 450,
        title: '\u4ff1\u6a02\u90e8\u5167\u9801\u5c01\u9762',
        subtitle: '\u6703\u7528\u5728\u4ff1\u6a02\u90e8\u8a73\u7d30\u9801\u4e0a\u65b9\u7684\u5bec\u7248\u5c01\u9762\u3002',
        targetLabel: '\u5167\u9801\u5c01\u9762',
        recommendedSize: '800 x 300',
        aspectLabel: '8:3',
      },
      {
        key: 'card',
        aspectRatio: 1,
        outputWidth: 1000,
        outputHeight: 1000,
        title: '\u4ff1\u6a02\u90e8\u5361\u7247',
        subtitle: '\u6703\u7528\u5728\u4ff1\u6a02\u90e8\u5217\u8868\u8207\u5361\u7247\u578b\u7e2e\u5716\u3002',
        targetLabel: '\u4ff1\u6a02\u90e8\u5361\u7247',
        recommendedSize: '800 x 800',
        aspectLabel: '1:1',
      },
    ];
  },

  _openImageVariantCropSequence(sourceDataURL, targets, callbacks = {}) {
    const list = Array.isArray(targets) ? targets.filter(t => t && t.key) : [];
    if (!sourceDataURL || !list.length || typeof this.showImageCropper !== 'function') {
      callbacks.onCancel?.();
      return;
    }
    const results = {};
    const openAt = (index) => {
      const target = list[index];
      const isLast = index >= list.length - 1;
      this.showImageCropper(sourceDataURL, {
        aspectRatio: target.aspectRatio,
        outputWidth: target.outputWidth,
        outputHeight: target.outputHeight,
        outputType: target.outputType || 'image/webp',
        quality: target.quality || 0.9,
        maxZoom: target.maxZoom || 5,
        title: (target.title || target.targetLabel || '\u5716\u7247\u7de8\u8f2f') + ' ' + (index + 1) + '/' + list.length,
        subtitle: target.subtitle || '\u62d6\u66f3\u8abf\u6574\u4f4d\u7f6e\uff0c\u4f7f\u7528\u6ed1\u687f\u6216\u6efe\u8f2a\u653e\u5927\u7e2e\u5c0f',
        targetLabel: target.targetLabel,
        recommendedSize: target.recommendedSize,
        aspectLabel: target.aspectLabel,
        frameHint: target.frameHint,
        confirmText: isLast ? '\u5b8c\u6210' : '\u4e0b\u4e00\u6b65',
        cancelText: '\u53d6\u6d88',
        onConfirm: (dataURL) => {
          results[target.key] = dataURL;
          if (isLast) {
            callbacks.onConfirm?.(results);
            return;
          }
          setTimeout(() => openAt(index + 1), 0);
        },
        onCancel: () => callbacks.onCancel?.(),
      });
    };
    openAt(0);
  },

  bindTeamImageVariantUpload(inputId = 'ct-team-image', previewId = 'ct-team-preview') {
    const input = document.getElementById(inputId);
    if (!input || input.dataset.teamVariantBound) return;
    input.dataset.teamVariantBound = '1';
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
      try {
        const sourceDataURL = await this._readImageFileAsDataURL(file);
        this._openImageVariantCropSequence(sourceDataURL, this._getTeamImageVariantTargets(), {
          onConfirm: (variants) => {
            this._teamImageVariantsData = variants;
            const previewSrc = variants.cover || variants.card;
            if (previewSrc) this._setImageUploadPreview(previewId, previewSrc);
            try {
              input.dispatchEvent(new CustomEvent('imageupload:preview', {
                detail: { src: previewSrc, previewId, file, variants },
              }));
            } catch (_) {}
          },
          onCancel: () => {
            input.value = '';
            this._teamImageVariantsData = null;
          },
        });
      } catch (err) {
        console.error('[TeamImageUpload] image processing failed:', err);
        this.showToast('\u5716\u7247\u8655\u7406\u5931\u6557\uff0c\u8acb\u91cd\u8a66');
        input.value = '';
      }
    });
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
        const preview = this._setImageUploadPreview(previewId, finalURL);
        if (!preview) return;
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
            targetLabel: config.targetLabel,
            recommendedSize: config.recommendedSize,
            aspectLabel: config.aspectLabel,
            frameHint: config.frameHint,
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
