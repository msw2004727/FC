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
      if (typeof LineAuth !== 'undefined' && !LineAuth.isLoggedIn()) {
        this.showToast('請先使用 LINE 登入');
        LineAuth.login();
        return;
      }
      this.showToast('登入資訊尚未同步完成，請稍後再試');
      return;
    }
    const btn = document.querySelector('.line-login-btn');

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
    // LINE 綁定 EXP 獎勵（一次性）
    var curUser = ApiService.getCurrentUser();
    if (curUser && typeof this._reconcileLineBindingExp === 'function') {
      this._reconcileLineBindingExp(curUser.uid || curUser.lineUserId);
    }
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

  // 首次登入地區選擇 & saveFirstLoginProfile 已搬移至 profile-form.js（eagerly loaded）

});
