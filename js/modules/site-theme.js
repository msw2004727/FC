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
      const statusLabel = isActive ? '上架中' : (hasImage ? '已下架' : '未設定');
      const statusColor = isActive ? '#10b981' : (hasImage ? '#f59e0b' : '#6b7280');

      const preview = hasImage
        ? `<img src="${t.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`
        : `<span style="color:var(--text-muted);font-size:.72rem">${escapeHTML(t.spec)}</span>`;

      let buttons = '';
      if (!hasImage) {
        buttons = `<button class="text-btn" style="font-size:.75rem" onclick="App.showThemeForm('${t.id}')">設定</button>`;
      } else if (isActive) {
        buttons = `
          <button class="text-btn" style="font-size:.75rem" onclick="App.showThemeForm('${t.id}')">更換</button>
          <button class="text-btn" style="font-size:.75rem;color:#f59e0b" onclick="App.toggleThemeStatus('${t.id}')">下架</button>
          <button class="text-btn" style="font-size:.75rem;color:#ef4444" onclick="App.clearThemeSlot('${t.id}')">清除</button>`;
      } else {
        buttons = `
          <button class="text-btn" style="font-size:.75rem" onclick="App.showThemeForm('${t.id}')">更換</button>
          <button class="text-btn" style="font-size:.75rem;color:#10b981" onclick="App.toggleThemeStatus('${t.id}')">上架</button>
          <button class="text-btn" style="font-size:.75rem;color:#ef4444" onclick="App.clearThemeSlot('${t.id}')">清除</button>`;
      }

      return `
        <div class="banner-manage-card" style="align-items:center">
          <div style="width:80px;height:50px;border-radius:var(--radius-sm);overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--bg-card);border:1px solid var(--border);flex-shrink:0">
            ${preview}
          </div>
          <div class="banner-manage-info" style="flex:1;min-width:0;margin-left:.5rem">
            <div class="banner-manage-title">${escapeHTML(t.label)}</div>
            <div class="banner-manage-meta" style="display:flex;align-items:center;gap:.4rem">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor}"></span>
              <span>${statusLabel}</span>
              <span style="color:var(--text-muted)">・${escapeHTML(t.spec)}</span>
            </div>
            <div style="display:flex;gap:.5rem;margin-top:.3rem">${buttons}</div>
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
    hint.textContent = `建議尺寸：${item.spec}`;

    if (item.image) {
      preview.innerHTML = `<img src="${item.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    } else {
      preview.innerHTML = '<span style="color:var(--text-muted);font-size:.8rem">點擊上傳圖片</span>';
      preview.classList.remove('has-image');
    }
    if (input) input.value = '';

    overlay.classList.add('open');
  },

  hideThemeForm() {
    const overlay = document.getElementById('theme-form-overlay');
    if (overlay) overlay.classList.remove('open');
    this._themeEditId = null;
  },

  saveThemeItem() {
    if (!this._themeEditId) return;
    const preview = document.getElementById('theme-preview');
    const img = preview ? preview.querySelector('img') : null;
    if (!img || !img.src) {
      this.showToast('請先上傳圖片');
      return;
    }

    ApiService.updateSiteTheme(this._themeEditId, { image: img.src, status: 'active' });
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
        el.style.backgroundImage = `url("${t.image}")`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundRepeat = 'no-repeat';
        if (t.slot === 'theme_bg') {
          el.style.backgroundAttachment = 'fixed';
          el.style.backgroundPosition = 'center top';
        } else {
          el.style.backgroundPosition = 'center center';
        }
      } else {
        el.style.backgroundImage = '';
        el.style.backgroundSize = '';
        el.style.backgroundRepeat = '';
        if (t.slot === 'theme_bg') {
          el.style.backgroundAttachment = '';
          el.style.backgroundPosition = '';
        } else {
          el.style.backgroundPosition = '';
        }
      }
    });
  },

});
