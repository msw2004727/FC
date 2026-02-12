/* ================================================
   SportHub — Demo / Production Mode Switch
   ================================================ */

Object.assign(App, {

  bindModeSwitch() {
    // 方式 1：連續點擊 Logo 5 次（3 秒內）
    let clickCount = 0;
    let clickTimer = null;
    const logo = document.querySelector('.logo');
    if (logo) {
      logo.style.userSelect = 'none';
      logo.addEventListener('click', () => {
        clickCount++;
        if (clickCount === 1) {
          clickTimer = setTimeout(() => { clickCount = 0; }, 3000);
        }
        if (clickCount >= 5) {
          clickCount = 0;
          clearTimeout(clickTimer);
          this._switchMode();
        }
      });
    }

    // 方式 2：Shift + Alt + D
    document.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.altKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        this._switchMode();
      }
    });

    // 方式 3：Console 指令（密碼保護）
    window.switchMode = (pwd) => {
      if (pwd !== 'fc2026') {
        console.warn('[SportHub] 密碼錯誤');
        return;
      }
      this._switchMode();
    };

    // 初始化 badge
    this._updateModeBadge();
  },

  async _switchMode() {
    ModeManager.toggle();
    await this._onModeChanged();
  },

  async _onModeChanged() {
    const isDemo = ModeManager.isDemo();

    // 切換到 Demo 模式：清理 Firebase 監聽器和快取，重設為一般用戶
    if (isDemo) {
      if (typeof FirebaseService !== 'undefined') {
        FirebaseService.destroy();
      }
      this.applyRole('user', true);
    }

    // 切換到正式版：嘗試初始化 Firebase，並套用正確角色
    if (!isDemo) {
      if (typeof FirebaseService === 'undefined' || typeof firebase === 'undefined') {
        console.warn('[App] Firebase SDK 尚未載入，無法切換至正式版');
        this.showToast('Firebase 尚未載入，請稍後再試');
        ModeManager.setMode('demo');
        this._updateModeBadge();
        return;
      }
      const overlay = document.getElementById('loading-overlay');
      if (overlay) overlay.style.display = '';
      try {
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Firebase init timeout')), 20000)
        );
        await Promise.race([FirebaseService.init(), timeout]);
        console.log('[App] Firebase 已初始化');
      } catch (err) {
        console.error('[App] Firebase 初始化失敗:', err);
        this.showToast('Firebase 連線失敗，使用快取資料');
      } finally {
        if (overlay) overlay.style.display = 'none';
      }
      // 根據正式版用戶角色設定 currentRole
      const prodUser = ApiService.getCurrentUser();
      if (prodUser && prodUser.role) {
        this.applyRole(prodUser.role, true);
      }
    }

    this._updateModeBadge();
    this.renderLoginUI();
    this.renderAll();
    if (typeof this.renderProfileData === 'function') {
      this.renderProfileData();
    }
    const modeLabel = ModeManager.isDemo() ? '演示版' : '正式版';
    this.showToast(`已切換至「${modeLabel}」模式`);
  },

  _updateModeBadge() {
    const badge = document.getElementById('mode-badge');
    if (badge) {
      badge.style.display = ModeManager.isDemo() ? '' : 'none';
    }
  },

});
