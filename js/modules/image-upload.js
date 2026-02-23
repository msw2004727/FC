/* ================================================
   SportHub — Image Upload Preview Binding + Compression
   ================================================ */

Object.assign(App, {

  /**
   * Compress image via canvas
   * @param {File} file
   * @param {number} maxWidth
   * @param {number} quality - JPEG quality 0-1
   * @param {string} [outputType] - 'image/jpeg'(預設) 或 'image/png'（保留透明度）
   * @returns {Promise<string>} base64 data URL
   */
  _compressImage(file, maxWidth = 1200, quality = 0.78, outputType = 'image/jpeg') {
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
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL(outputType, quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  },

  /** 根據檔名副檔名判斷是否為允許的圖片格式 */
  _isAllowedImageFile(file) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];
    if (file.type && allowedTypes.includes(file.type.toLowerCase())) return true;
    // file.type 在部分行動瀏覽器/WebView 可能為空，以副檔名作為備援判斷
    const ext = (file.name || '').split('.').pop().toLowerCase();
    return ['jpg', 'jpeg', 'png', 'heic', 'heif'].includes(ext);
  },

  bindImageUpload(inputId, previewId) {
    const input = document.getElementById(inputId);
    if (!input || input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      if (!this._isAllowedImageFile(file)) {
        this.showToast('僅支援 JPG / PNG 格式');
        input.value = '';
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        this.showToast('檔案大小不可超過 5MB');
        input.value = '';
        return;
      }
      try {
        const dataURL = await this._compressImage(file);
        const preview = document.getElementById(previewId);
        if (preview) {
          preview.innerHTML = `<img src="${dataURL}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
          preview.classList.add('has-image');
        }
      } catch (err) {
        console.error('[ImageUpload] 圖片壓縮失敗:', err);
        this.showToast('圖片處理失敗，請換一張圖片');
        input.value = '';
      }
    });
  },

});
