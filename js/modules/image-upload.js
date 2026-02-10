/* ================================================
   SportHub — Image Upload Preview Binding
   ================================================ */

Object.assign(App, {

  bindImageUpload(inputId, previewId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const validTypes = ['image/jpeg', 'image/png'];
      if (!validTypes.includes(file.type)) {
        this.showToast('僅支援 JPG / PNG 格式');
        input.value = '';
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        this.showToast('檔案大小不可超過 2MB');
        input.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const preview = document.getElementById(previewId);
        if (preview) {
          preview.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
          preview.classList.add('has-image');
        }
      };
      reader.readAsDataURL(file);
    });
  },

});
