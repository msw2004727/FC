/* ================================================
   SportHub — Profile: Data Core & LINE Notify
   依賴：profile-core.js
   拆分模組：profile-data-render.js, profile-data-stats.js, profile-data-history.js
   ================================================ */
Object.assign(App, {

  // ── 個人頁欄位說明 ──
  _profileInfoData: {
    myProfile: {
      title: '我的資料',
      body: '設定個人基本資訊，包含性別、生日、地區與運動類別等。'
        + '<p style="margin:.4rem 0 .15rem;font-weight:600">用途</p>'
        + '• 讓主辦人在報名名單中快速了解參加者背景<br>'
        + '• 系統依據你的資料推薦合適的活動與俱樂部<br>'
        + '• 部分活動可能依性別或年齡設定報名限制'
        + '<p style="margin:.4rem 0 0;font-size:.78rem;color:var(--text-muted)">資料僅用於平台功能，不會對外公開。</p>',
    },
    lineNotify: {
      title: 'LINE 推播通知',
      body: '綁定 LINE 帳號並加入官方好友後，系統會透過 LINE 推送即時通知。'
        + '<p style="margin:.4rem 0 .15rem;font-weight:600">通知類型</p>'
        + '• <b>活動提醒</b> — 報名成功確認、活動開始前提醒<br>'
        + '• <b>系統通知</b> — 站內信、公告、候補遞補通知<br>'
        + '• <b>賽事通知</b> — 賽程更新、對戰結果'
        + '<p style="margin:.4rem 0 0;font-size:.78rem;color:var(--text-muted)">綁定後可個別開關各類通知，隨時可解除綁定。</p>',
    },
    favorites: {
      title: '我的收藏',
      body: '將感興趣的活動加入收藏，方便日後快速查看。'
        + '<p style="margin:.4rem 0 .15rem;font-weight:600">使用方式</p>'
        + '• 在活動詳情頁點擊愛心即可收藏<br>'
        + '• 收藏不代表報名，僅作為個人書籤<br>'
        + '• 活動結束後收藏會自動歸檔',
    },
    companions: {
      title: '我的同行者',
      body: '預先設定常一起參加活動的夥伴，報名時可一鍵帶入。'
        + '<p style="margin:.4rem 0 .15rem;font-weight:600">使用方式</p>'
        + '• 點擊「新增同行者」輸入名稱即可建立<br>'
        + '• 報名活動時勾選同行者，系統自動一起報名<br>'
        + '• 同行者佔用活動名額，取消報名時一併取消'
        + '<p style="margin:.4rem 0 0;font-size:.78rem;color:var(--text-muted)">適合家人、固定球友等經常同行的夥伴。</p>',
    },
    records: {
      title: '報名紀錄',
      body: '查看所有活動的參與紀錄，追蹤自己的運動歷程。'
        + '<p style="margin:.4rem 0 .15rem;font-weight:600">紀錄分類</p>'
        + '• <b>已報名</b> — 尚未開始的活動<br>'
        + '• <b>已完成</b> — 已簽到完成的活動<br>'
        + '• <b>已取消</b> — 自行取消或被移除的報名',
    },
  },

  _showProfileInfo(key) {
    const item = this._profileInfoData[key];
    if (!item) return;
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">' + item.title + '</div>'
      + '<div class="edu-info-dialog-body">' + item.body + '</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem;flex-shrink:0" onclick="this.closest(\'.edu-info-overlay\').remove()">了解</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

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
