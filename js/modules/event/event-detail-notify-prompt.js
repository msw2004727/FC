/* ================================================
   SportHub — Event: LINE 推播綁定引導彈窗
   報名成功後引導用戶綁定 LINE 推播通知
   依賴：profile-data.js (bindLineNotify)
   ================================================ */
Object.assign(App, {

  /**
   * 報名成功後判斷是否顯示 LINE 推播綁定引導
   * 條件：未綁定 + 未永久關閉 + 非 Demo
   */
  _maybeShowLineNotifyPrompt() {
    if (ModeManager.isDemo()) return;
    const user = ApiService.getCurrentUser?.();
    if (!user) return;
    if (user.lineNotify?.bound === true) return;
    if (localStorage.getItem('_dismissLineNotifyPrompt') === '1') return;
    this._showLineNotifyPrompt();
  },

  _showLineNotifyPrompt() {
    // 移除舊的（防重複）
    const old = document.getElementById('line-notify-prompt-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'line-notify-prompt-overlay';
    overlay.className = 'ln-prompt-overlay';
    overlay.innerHTML = `
      <div class="ln-prompt-card">
        <div class="ln-prompt-icon">🔔</div>
        <h3 class="ln-prompt-title">開啟活動提醒，不再錯過！</h3>
        <p class="ln-prompt-desc">
          綁定 LINE 推播通知，<br>
          活動開場前自動提醒、關注活動秒通知。<br>
          完成綁定還能獲得<br>
          「LINE推播」專屬成就徽章！
        </p>
        <div class="ln-prompt-actions">
          <button class="ln-prompt-btn ln-prompt-dismiss" id="ln-prompt-dismiss">請別煩我</button>
          <button class="ln-prompt-btn ln-prompt-bind" id="ln-prompt-bind">
            <span class="ln-prompt-bind-glow"></span>
            <span class="ln-prompt-bind-text">立即綁定</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 觸發進場動畫
    requestAnimationFrame(() => overlay.classList.add('open'));

    // 立即綁定
    document.getElementById('ln-prompt-bind').addEventListener('click', () => {
      this._closeLineNotifyPrompt();
      this.bindLineNotify?.();
    });

    // 請別煩我
    document.getElementById('ln-prompt-dismiss').addEventListener('click', () => {
      localStorage.setItem('_dismissLineNotifyPrompt', '1');
      this._closeLineNotifyPrompt();
    });

    // 點遮罩關閉（等同dismiss但不永久記住）
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._closeLineNotifyPrompt();
    });
  },

  _closeLineNotifyPrompt() {
    const overlay = document.getElementById('line-notify-prompt-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    // fallback：若 transition 未觸發，300ms 後移除
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 400);
  },
});
