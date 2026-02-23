/* ================================================
   SportHub — Site Theme: Festival-style Background Images
   ================================================ */

Object.assign(App, {

  _themeEditId: null,

  // ════════════════════════════════
  //  Backend — Theme Management
  // ════════════════════════════════

  renderThemeManage() {
    const container = document.getElementById('theme-manage-list');
    if (!container) return;
    const items = ApiService.getSiteThemes();

    container.innerHTML = items.map(t => {
      const hasImage = !!t.image;
      const isActive = t.status === 'active';

      // ── Status badge ──
      const statusLabel = isActive ? '上架中' : (hasImage ? '已下架' : '未設定');
      const statusClass = isActive ? 'active' : (hasImage ? 'scheduled' : 'empty');

      // ── Slot visual indicator ──
      const slotIcons = {
        theme_topbar: '↑ 頂部',
        theme_bottombar: '↓ 底部',
        theme_bg: '▣ 全頁',
      };
      const slotIcon = slotIcons[t.slot] || '';

      // ── Preview area ──
      const preview = hasImage
        ? `<img src="${t.image}" style="width:100%;height:100%;object-fit:cover">`
        : `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
             <span style="font-size:.65rem;color:var(--text-muted)">尚未上傳</span>
             <span style="font-size:.6rem;color:var(--text-muted)">${escapeHTML(t.spec)}</span>
           </div>`;

      // ── Action buttons ──
      let actions = '';
      if (!hasImage) {
        actions = `<button class="primary-btn" style="font-size:.72rem;padding:.3rem .8rem" onclick="App.showThemeForm('${t.id}')">上傳圖片</button>`;
      } else {
        const toggleBtn = isActive
          ? `<button class="text-btn" style="font-size:.72rem;color:#f59e0b;border:1px solid #f59e0b;padding:.25rem .6rem;border-radius:var(--radius-sm)" onclick="App.toggleThemeStatus('${t.id}')">下架</button>`
          : `<button class="text-btn" style="font-size:.72rem;color:#10b981;border:1px solid #10b981;padding:.25rem .6rem;border-radius:var(--radius-sm)" onclick="App.toggleThemeStatus('${t.id}')">上架</button>`;
        actions = `
          <button class="text-btn" style="font-size:.72rem;border:1px solid var(--border);padding:.25rem .6rem;border-radius:var(--radius-sm)" onclick="App.showThemeForm('${t.id}')">更換圖片</button>
          ${toggleBtn}
          <button class="text-btn" style="font-size:.72rem;color:#ef4444;padding:.25rem .4rem" onclick="App.clearThemeSlot('${t.id}')">清除</button>`;
      }

      return `
        <div class="banner-manage-card" style="flex-direction:column;align-items:stretch;gap:.5rem">
          <div style="display:flex;align-items:center;gap:.5rem">
            <span style="font-size:.7rem;background:var(--bg-main);padding:.15rem .45rem;border-radius:var(--radius-sm);color:var(--text-secondary);font-weight:600;white-space:nowrap">${slotIcon}</span>
            <span class="banner-manage-title" style="flex:1">${escapeHTML(t.label)}</span>
            <span class="banner-manage-status status-${statusClass}">${statusLabel}</span>
          </div>
          <div style="width:100%;height:72px;border-radius:var(--radius-sm);overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--bg-main);border:${hasImage ? 'none' : '2px dashed var(--border)'};cursor:${hasImage ? 'default' : 'pointer'}" ${!hasImage ? `onclick="App.showThemeForm('${t.id}')"` : ''}>
            ${preview}
          </div>
          <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap">
            <span style="font-size:.68rem;color:var(--text-muted);margin-right:auto">建議：${escapeHTML(t.spec)}</span>
            ${actions}
          </div>
        </div>`;
    }).join('');
  },

  showThemeForm(id) {
    const item = ApiService.getSiteThemes().find(t => t.id === id);
    if (!item) return;
    this._themeEditId = id;

    const overlay = document.getElementById('theme-form-overlay');
    const preview = document.getElementById('theme-preview');
    const hint = document.getElementById('theme-spec-hint');
    const input = document.getElementById('theme-image');

    document.getElementById('theme-form-title').textContent = item.label;
    hint.textContent = `建議尺寸：${item.spec}（JPG / PNG，2MB 以內）`;

    if (item.image) {
      preview.innerHTML = `<img src="${item.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    } else {
      preview.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:4px">
        <span style="font-size:1.5rem">📁</span>
        <span style="color:var(--text-muted);font-size:.78rem">點擊選擇圖片</span>
        <span style="color:var(--text-muted);font-size:.68rem">${escapeHTML(item.spec)}</span>
      </div>`;
      preview.classList.remove('has-image');
    }
    if (input) input.value = '';

    overlay.classList.add('open');
    overlay.querySelector('.modal').classList.add('open');
  },

  hideThemeForm() {
    const overlay = document.getElementById('theme-form-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.querySelector('.modal').classList.remove('open');
    }
    this._themeEditId = null;
  },

  async saveThemeItem() {
    if (!this._themeEditId) return;
    const preview = document.getElementById('theme-preview');
    const img = preview ? preview.querySelector('img') : null;
    if (!img || !img.src) {
      this.showToast('請先上傳圖片');
      return;
    }

    let image = img.src;

    // 正式版：上傳至 Firebase Storage 取得公開 URL
    if (image.startsWith('data:') && !ModeManager.isDemo()) {
      this.showToast('圖片上傳中...');
      const url = await FirebaseService._uploadImage(image, `siteThemes/${this._themeEditId}`);
      if (!url) { this.showToast('圖片上傳失敗，請重試'); return; }
      image = url;
    }

    ApiService.updateSiteTheme(this._themeEditId, { image, status: 'active' });
    this.hideThemeForm();
    this.renderThemeManage();
    this.applySiteThemes();
    this.showToast('佈景主題已上架');
  },

  toggleThemeStatus(id) {
    const item = ApiService.getSiteThemes().find(t => t.id === id);
    if (!item) return;

    if (item.status === 'active') {
      ApiService.updateSiteTheme(id, { status: 'empty' });
      this.showToast('已下架，恢復預設風格');
    } else if (item.image) {
      ApiService.updateSiteTheme(id, { status: 'active' });
      this.showToast('已上架');
    }

    this.renderThemeManage();
    this.applySiteThemes();
  },

  async clearThemeSlot(id) {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
    const ok = await this.appConfirm('確定清除此佈景圖片？將恢復預設風格。');
    if (!ok) return;

    ApiService.updateSiteTheme(id, { image: null, status: 'empty' });
    this.renderThemeManage();
    this.applySiteThemes();
    this.showToast('已清除佈景圖片');
  },

  // ════════════════════════════════
  //  Frontend — Apply Themes
  // ════════════════════════════════

  applySiteThemes() {
    const themes = ApiService.getSiteThemes();
    if (!themes) return;

    const slotMap = {
      theme_topbar: '#top-bar',
      theme_bottombar: '#bottom-tabs',
      theme_bg: 'body',
    };

    themes.forEach(t => {
      const selector = slotMap[t.slot];
      if (!selector) return;
      const el = selector === 'body' ? document.body : document.querySelector(selector);
      if (!el) return;

      if (t.status === 'active' && t.image) {
        // 用 background 簡寫覆蓋 stylesheet 的 background 簡寫
        const pos = t.slot === 'theme_bg' ? 'center top' : 'center center';
        const attach = t.slot === 'theme_bg' ? 'fixed' : 'scroll';
        el.style.background = `url("${t.image}") ${pos} / cover no-repeat ${attach}`;
      } else {
        // 移除 inline background，還原 stylesheet 預設
        el.style.background = '';
      }
    });
  },

});
