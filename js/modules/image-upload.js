/* ================================================
   SportHub — Image Upload Preview Binding + Compression
   ================================================ */

Object.assign(App, {

  /**
   * Compress image via canvas
   * @param {File} file
   * @param {number} maxWidth
   * @param {number} quality - JPEG quality 0-1
   * @returns {Promise<string>} base64 data URL
   */
  _compressImage(file, maxWidth = 1200, quality = 0.78) {
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
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  },

  bindImageUpload(inputId, previewId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const validTypes = ['image/jpeg', 'image/png'];
      if (!validTypes.includes(file.type)) {
        this.showToast('僅支援 JPG / PNG 格式');
        input.value = '';
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        this.showToast('檔案大小不可超過 5MB');
        input.value = '';
        return;
      }
      const dataURL = await this._compressImage(file);
      const preview = document.getElementById(previewId);
      if (preview) {
        preview.innerHTML = `<img src="${dataURL}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
        preview.classList.add('has-image');
      }
    });
  },

});
