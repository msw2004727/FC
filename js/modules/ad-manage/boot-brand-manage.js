/* ================================================
   boot-brand-manage.js — 開機品牌圖管理
   管理 boot-loading 畫面的品牌圖片、位置與背景色
   ================================================ */

Object.assign(App, {

  _bootBrandLoaded: false,

  /** 渲染開機品牌圖管理區塊 */
  async renderBootBrandManage() {
    const container = document.getElementById('boot-brand-manage-list');
    if (!container) return;

    // 讀取目前設定
    const config = await this._loadBootBrandConfig();
    const imgUrl = config.imageUrl || 'LOGO/02.png';
    const bgMode = config.bgMode || 'auto';
    const bgColor = config.bgColor || '#1a1a2e';
    const marginTop = config.marginTop ?? 5;
    const imgHeight = config.imgHeight ?? 140;

    container.innerHTML = `
      <div class="form-card">
        <div class="role-editor-header">
          <span>開機品牌圖設定</span>
        </div>

        <!-- 預覽區（與實際 boot-loading 結構一致） -->
        <div class="form-row">
          <label>預覽（與實際開機畫面一致）</label>
          <div id="boot-brand-preview-box" class="boot-loading__image-slot" style="
            margin:0 auto;
            background:${bgMode === 'light' ? bgColor : bgMode === 'dark' ? '#1e1e2e' : 'var(--bg-card)'}
          ">
            <img id="boot-brand-preview-img" class="boot-loading__image" src="${escapeHTML(imgUrl)}" alt="" style="
              transform:scale(${imgHeight / 100}) translateY(${-marginTop}%)
            ">
          </div>
        </div>

        <!-- 圖片上傳 -->
        <div class="form-row">
          <label>品牌圖片</label>
          <div class="ce-upload">
            <input type="file" id="boot-brand-image" accept=".jpg,.jpeg,.png,.webp" hidden>
            <div class="ce-upload-placeholder" id="boot-brand-upload-area"
                 onclick="document.getElementById('boot-brand-image').click()">
              <span class="ce-upload-icon">+</span>
              <span class="ce-upload-text">點擊上傳圖片</span>
              <span class="ce-upload-hint">建議正方形或橫幅圖｜JPG / PNG｜最大 5MB</span>
            </div>
          </div>
        </div>

        <!-- 圖片縮放 -->
        <div class="form-row">
          <label>圖片縮放 <span id="boot-brand-height-val">${imgHeight}%</span></label>
          <input type="range" id="boot-brand-height" min="60" max="200" value="${imgHeight}"
                 oninput="App._updateBootBrandPreview()">
        </div>

        <!-- 垂直位置（正值=往上，負值=往下） -->
        <div class="form-row">
          <label>垂直位置 <span id="boot-brand-margin-val">${marginTop}%</span></label>
          <input type="range" id="boot-brand-margin" min="-30" max="30" value="${marginTop}"
                 oninput="App._updateBootBrandPreview()">
        </div>

        <!-- 背景色模式 -->
        <div class="form-row">
          <label>圖片背景色</label>
          <select id="boot-brand-bgmode" onchange="App._updateBootBrandPreview()">
            <option value="auto" ${bgMode === 'auto' ? 'selected' : ''}>自動（跟隨主題）</option>
            <option value="dark" ${bgMode === 'dark' ? 'selected' : ''}>深色</option>
            <option value="light" ${bgMode === 'light' ? 'selected' : ''}>淺色（自訂色）</option>
          </select>
        </div>

        <!-- 自訂背景色（僅淺色模式顯示） -->
        <div class="form-row" id="boot-brand-color-row" style="display:${bgMode === 'light' ? '' : 'none'}">
          <label>自訂背景色</label>
          <input type="color" id="boot-brand-bgcolor" value="${bgColor}"
                 onchange="App._updateBootBrandPreview()">
        </div>

        <button class="primary-btn full-width" onclick="App.saveBootBrand()">儲存設定</button>
      </div>
    `;

    // 綁定圖片上傳
    if (typeof this.bindImageUpload === 'function') {
      this.bindImageUpload('boot-brand-image', 'boot-brand-upload-area');
    }

    // 監聽圖片變更 → 更新預覽
    const input = document.getElementById('boot-brand-image');
    if (input) {
      input.addEventListener('change', () => {
        setTimeout(() => this._syncBootBrandUploadToPreview(), 300);
      });
    }

    this._bootBrandLoaded = true;
  },

  /** 從上傳區同步圖片到預覽框 */
  _syncBootBrandUploadToPreview() {
    const uploadArea = document.getElementById('boot-brand-upload-area');
    const previewImg = document.getElementById('boot-brand-preview-img');
    if (!uploadArea || !previewImg) return;
    const img = uploadArea.querySelector('img');
    if (img) previewImg.src = img.src;
  },

  /** 即時更新預覽 */
  _updateBootBrandPreview() {
    const heightEl = document.getElementById('boot-brand-height');
    const marginEl = document.getElementById('boot-brand-margin');
    const bgModeEl = document.getElementById('boot-brand-bgmode');
    const bgColorEl = document.getElementById('boot-brand-bgcolor');
    const previewBox = document.getElementById('boot-brand-preview-box');
    const previewImg = document.getElementById('boot-brand-preview-img');
    const colorRow = document.getElementById('boot-brand-color-row');

    if (!heightEl || !marginEl || !bgModeEl || !previewBox || !previewImg) return;

    const h = heightEl.value;
    const m = marginEl.value;
    const mode = bgModeEl.value;

    document.getElementById('boot-brand-height-val').textContent = h + '%';
    document.getElementById('boot-brand-margin-val').textContent = m + '%';

    previewImg.style.transform = 'scale(' + (h / 100) + ') translateY(' + (-m) + '%)';

    // 背景色
    if (mode === 'auto') {
      previewBox.style.background = 'var(--bg-card)';
    } else if (mode === 'dark') {
      previewBox.style.background = '#1e1e2e';
    } else {
      previewBox.style.background = bgColorEl ? bgColorEl.value : '#1a1a2e';
    }

    // 顯示/隱藏自訂色
    if (colorRow) colorRow.style.display = mode === 'light' ? '' : 'none';
  },

  /** 讀取 Firestore 設定 */
  async _loadBootBrandConfig() {
    try {
      const db = firebase.firestore();
      const doc = await db.collection('siteConfig').doc('bootBrand').get();
      return doc.exists ? doc.data() : {};
    } catch (e) {
      console.warn('[BootBrand] 讀取設定失敗:', e.message);
      return {};
    }
  },

  /** 儲存設定到 Firestore + localStorage */
  async saveBootBrand() {
    if (!this.hasPermission('admin.banners.entry')) {
      this.showToast('權限不足'); return;
    }

    const heightEl = document.getElementById('boot-brand-height');
    const marginEl = document.getElementById('boot-brand-margin');
    const bgModeEl = document.getElementById('boot-brand-bgmode');
    const bgColorEl = document.getElementById('boot-brand-bgcolor');
    const previewImg = document.getElementById('boot-brand-preview-img');
    const uploadArea = document.getElementById('boot-brand-upload-area');

    if (!heightEl || !marginEl || !bgModeEl) return;

    this.showToast('儲存中...');

    let imageUrl = previewImg ? previewImg.src : '';

    // 檢查是否有新上傳圖片（base64）
    const uploadImg = uploadArea ? uploadArea.querySelector('img') : null;
    if (uploadImg && uploadImg.src && uploadImg.src.startsWith('data:')) {
      const url = await FirebaseService._uploadImage(uploadImg.src, 'boot-brand/logo');
      if (!url) {
        this.showToast('圖片上傳失敗，請重試'); return;
      }
      imageUrl = url;
    }

    const config = {
      imageUrl: imageUrl,
      bgMode: bgModeEl.value,
      bgColor: bgColorEl ? bgColorEl.value : '#1a1a2e',
      marginTop: Number(marginEl.value),
      imgHeight: Number(heightEl.value),
      updatedAt: new Date().toISOString(),
    };

    try {
      const db = firebase.firestore();
      await db.collection('siteConfig').doc('bootBrand').set(config, { merge: true });

      // 寫入 localStorage（開機時讀取）
      localStorage.setItem('_bootBrand', JSON.stringify(config));

      this.showToast('開機品牌圖設定已儲存');
      this.renderBootBrandManage();
    } catch (e) {
      console.error('[BootBrand] 儲存失敗:', e);
      this.showToast('儲存失敗：' + e.message);
    }
  },

  /** 背景同步：App 啟動後從 Firestore 更新 localStorage 快取 */
  async _syncBootBrandToLocal() {
    try {
      const config = await this._loadBootBrandConfig();
      if (config && config.imageUrl) {
        localStorage.setItem('_bootBrand', JSON.stringify(config));
      }
    } catch (_) {}
  },
});
