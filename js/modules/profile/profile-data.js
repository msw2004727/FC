/* ================================================
   SportHub — Profile: Data Core & LINE Notify
   依賴：profile-core.js
   拆分模組：profile-data-render.js, profile-data-stats.js, profile-data-history.js
   ================================================ */
Object.assign(App, {

  // ── LINE 推播通知 ──
  renderLineNotifyCard() {
    const user = ApiService.getCurrentUser();
    if (!user) return;
    const ln = user.lineNotify || { bound: false, settings: {} };
    const badge = document.getElementById('line-notify-badge');
    const boundEl = document.getElementById('line-notify-bound');
    const unboundEl = document.getElementById('line-notify-unbound');
    if (!badge || !boundEl || !unboundEl) return;

    if (ln.bound) {
      badge.textContent = '已綁定';
      badge.className = 'line-notify-status bound';
      boundEl.style.display = '';
      unboundEl.style.display = 'none';
      const nameEl = document.getElementById('line-notify-name');
      const timeEl = document.getElementById('line-notify-time');
      if (nameEl) nameEl.textContent = user.displayName || '-';
      if (timeEl) timeEl.textContent = ln.boundAt || '-';
      const keys = ['activity', 'system', 'tournament'];
      keys.forEach(k => {
        const cb = document.getElementById('line-toggle-' + k);
        if (cb) cb.checked = !!ln.settings[k];
      });
    } else {
      badge.textContent = '未綁定';
      badge.className = 'line-notify-status unbound';
      boundEl.style.display = 'none';
      unboundEl.style.display = '';
    }
  },

  async bindLineNotify() {
    const user = ApiService.getCurrentUser();
    if (!user) {
      if (!ModeManager.isDemo() && typeof LineAuth !== 'undefined' && !LineAuth.isLoggedIn()) {
        this.showToast('請先使用 LINE 登入');
        LineAuth.login();
        return;
      }
      this.showToast('登入資訊尚未同步完成，請稍後再試');
      return;
    }
    const btn = document.querySelector('.line-login-btn');

    // Demo 模式 → 直接綁定
    if (ModeManager.isDemo()) {
      this._completeLineBinding(btn);
      return;
    }

    // 開啟加好友頁面（確保用戶已加官方帳號好友）
    // LINE 內建瀏覽器用 line.me/R/ti/p 可直接開啟；外部/PC 瀏覽器則開網頁版
    window.open(`https://line.me/R/ti/p/${LINE_CONFIG.BOT_BASIC_ID}`, 'sporthub_line');
    this._completeLineBinding(btn);
  },

  _completeLineBinding(btn) {
    if (btn) btn.classList.add('loading');
    const today = new Date();
    const dateStr = today.getFullYear() + '/' + String(today.getMonth() + 1).padStart(2, '0') + '/' + String(today.getDate()).padStart(2, '0');
    const notify = {
      bound: true,
      boundAt: dateStr,
      settings: { activity: true, system: true, tournament: false }
    };
    ApiService.updateCurrentUser({ lineNotify: notify });
    setTimeout(() => {
      if (btn) btn.classList.remove('loading');
      const boundEl = document.getElementById('line-notify-bound');
      const unboundEl = document.getElementById('line-notify-unbound');
      if (boundEl) boundEl.classList.add('fadeIn');
      this.renderLineNotifyCard();
      this.showToast('已啟用 LINE 通知，請確認已加入官方帳號好友');
    }, 600);
  },

  async unbindLineNotify() {
    const yes = await this.appConfirm('確定要解除 LINE 綁定嗎？解除後將無法收到推播通知。');
    if (!yes) return;
    const user = ApiService.getCurrentUser();
    if (!user) return;
    ApiService.updateCurrentUser({ lineNotify: { bound: false, settings: { activity: true, system: true, tournament: false } } });
    const unboundEl = document.getElementById('line-notify-unbound');
    if (unboundEl) unboundEl.classList.add('fadeIn');
    this.renderLineNotifyCard();
    this.showToast('已解除 LINE 綁定');
  },

  toggleLineNotify(key) {
    const user = ApiService.getCurrentUser();
    if (!user || !user.lineNotify || !user.lineNotify.bound) return;
    const settings = user.lineNotify.settings;
    const newSettings = { ...settings, [key]: !settings[key] };
    ApiService.updateCurrentUser({ lineNotify: { ...user.lineNotify, settings: newSettings } });
    const labels = { activity: '活動提醒', system: '系統通知', tournament: '賽事通知' };
    const label = labels[key] || key;
    this.showToast(newSettings[key] ? '已開啟' + label : '已關閉' + label);
  },

  // ── 首次登入地區選擇 ──

  _getFirstLoginRegionList() {
    return [
      '台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市',
      '基隆市', '新竹市', '嘉義市',
      '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣',
      '屏東縣', '宜蘭縣', '花蓮縣', '台東縣',
      '澎湖縣', '金門縣', '連江縣',
      '其他',
    ];
  },

  _normalizeRegionKeyword(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/臺/g, '台')
      .replace(/\s+/g, '');
  },

  _fuzzyMatch(text, query) {
    var ti = 0;
    for (var qi = 0; qi < query.length; qi++) {
      var found = false;
      while (ti < text.length) {
        if (text[ti] === query[qi]) { ti++; found = true; break; }
        ti++;
      }
      if (!found) return false;
    }
    return true;
  },

  // ── 地區自動完成 ──

  _getFilteredRegions(keyword) {
    const allRegions = this._getFirstLoginRegionList();
    const q = this._normalizeRegionKeyword(keyword);
    if (!q) return allRegions;
    return allRegions.filter(name => this._fuzzyMatch(this._normalizeRegionKeyword(name), q));
  },

  _renderRegionDropdown(matched) {
    const dropdown = document.getElementById('fl-region-dropdown');
    if (!dropdown) return;
    if (matched.length === 0) {
      dropdown.innerHTML = '<div style="padding:8px 12px;color:#999;font-size:14px">無匹配結果</div>';
    } else {
      dropdown.innerHTML = '';
      matched.forEach(name => {
        const item = document.createElement('div');
        item.textContent = name;
        item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:14px';
        item.onmouseenter = function() { this.style.background = 'var(--bg-hover,#f3f4f6)'; };
        item.onmouseleave = function() { this.style.background = ''; };
        item.onmousedown = function(e) { e.preventDefault(); };
        item.ontouchstart = function(e) { e.preventDefault(); };
        item.onclick = () => { this._selectRegion(name); };
        dropdown.appendChild(item);
      });
    }
    dropdown.style.display = '';
  },

  _selectRegion(name) {
    const input = document.getElementById('fl-region-input');
    const dropdown = document.getElementById('fl-region-dropdown');
    if (input) input.value = name;
    if (dropdown) dropdown.style.display = 'none';
  },

  onRegionInput(value) {
    const matched = this._getFilteredRegions(value);
    this._renderRegionDropdown(matched);
  },

  onRegionFocus() {
    const input = document.getElementById('fl-region-input');
    const keyword = input ? input.value : '';
    const matched = this._getFilteredRegions(keyword);
    this._renderRegionDropdown(matched);
  },

  onRegionBlur() {
    const dropdown = document.getElementById('fl-region-dropdown');
    if (dropdown) dropdown.style.display = 'none';
  },

  initFirstLoginRegionPicker() {
    // 新版 autocomplete 不需額外初始化，事件已綁定在 HTML
  },

  resetFirstLoginRegionFilter() {
    const input = document.getElementById('fl-region-input');
    if (input) input.value = '';
  },

  saveFirstLoginProfile() {
    const regionInput = document.getElementById('fl-region-input');
    const gender = document.getElementById('fl-gender').value;
    const birthday = document.getElementById('fl-birthday').value;
    const region = regionInput ? regionInput.value.trim() : '';
    const errEl = document.getElementById('fl-error-msg');
    const showFlError = (msg) => {
      if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
      else this.showToast(msg);
    };
    if (errEl) errEl.style.display = 'none';
    if (!gender || !birthday || !region) {
      showFlError('請填寫所有必填欄位（性別、生日、地區）');
      return;
    }
    try {
      ApiService.updateCurrentUser({ gender, birthday, region });
    } catch (err) {
      console.error('[saveFirstLoginProfile]', err);
      showFlError('儲存失敗：' + (err.message || '請稍後再試'));
      return;
    }
    this._pendingFirstLogin = false;
    this.resetFirstLoginRegionFilter();
    this.closeModal();
    this.renderProfileData();
    this.showToast('個人資料已儲存');
  },

});
