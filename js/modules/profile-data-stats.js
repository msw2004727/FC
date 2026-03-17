/* ================================================
   SportHub — Profile Data: Titles & Suggestions
   依賴：profile-core.js, profile-data-render.js
   ================================================ */
Object.assign(App, {

  // 組合稱號顯示：大成就.普通.暱稱（純文字）
  _buildTitleDisplay(user, overrideName) {
    const achievements = ApiService.getAchievements?.() || [];
    const registry = this._getAchievementRegistry?.();
    const earnedAchievements = achievements.filter(achievement => {
      if (!achievement || achievement.status === 'archived') return false;
      if (registry?.isSupportedCondition?.(achievement.condition) === false) return false;
      const threshold = this._getAchThreshold ? this._getAchThreshold(achievement) : (achievement.condition?.threshold ?? achievement.target ?? 1);
      return (achievement.current || 0) >= threshold;
    });
    const availableBigTitles = new Set(earnedAchievements.filter(achievement => achievement.category === 'gold').map(achievement => achievement.name));
    const availableNormalTitles = new Set(earnedAchievements.filter(achievement => achievement.category !== 'gold').map(achievement => achievement.name));
    const safeBig = availableBigTitles.has(user?.titleBig) ? user.titleBig : null;
    const safeNormal = availableNormalTitles.has(user?.titleNormal) ? user.titleNormal : null;
    return this._getAchievementTitles?.()?.buildTitleDisplay?.(user, overrideName)
      || [safeBig, safeNormal, overrideName || user?.displayName || '-']
        .filter(Boolean)
        .join('.');
  },

  // 組合稱號顯示 HTML 版（金色/銀色標籤）
  _buildTitleDisplayHtml(user, overrideName) {
    return this._getAchievementTitles?.()?.buildTitleDisplayHtml?.(user, overrideName)
      || (() => {
        const safeUser = user || {};
        const achievements = ApiService.getAchievements?.() || [];
        const registry = this._getAchievementRegistry?.();
        const earnedAchievements = achievements.filter(achievement => {
          if (!achievement || achievement.status === 'archived') return false;
          if (registry?.isSupportedCondition?.(achievement.condition) === false) return false;
          const threshold = this._getAchThreshold ? this._getAchThreshold(achievement) : (achievement.condition?.threshold ?? achievement.target ?? 1);
          return (achievement.current || 0) >= threshold;
        });
        const availableBigTitles = new Set(earnedAchievements.filter(achievement => achievement.category === 'gold').map(achievement => achievement.name));
        const availableNormalTitles = new Set(earnedAchievements.filter(achievement => achievement.category !== 'gold').map(achievement => achievement.name));
        const safeBig = availableBigTitles.has(safeUser.titleBig) ? safeUser.titleBig : null;
        const safeNormal = availableNormalTitles.has(safeUser.titleNormal) ? safeUser.titleNormal : null;
        const parts = [];
        if (safeBig) {
          parts.push(`<span class="title-tag title-gold">${escapeHTML(safeBig)}</span>`);
        }
        if (safeNormal) {
          parts.push(`<span class="title-tag title-normal">${escapeHTML(safeNormal)}</span>`);
        }
        parts.push(escapeHTML(overrideName || safeUser.displayName || '-'));
        return parts.join('<span class="title-dot">.</span>');
      })();
  },

  // 新徽章稱號自動推薦
  _titleSuggestionChecked: false,
  async _checkTitleSuggestion() {
    const titles = this._getAchievementTitles?.();
    if (titles?.checkTitleSuggestion) return titles.checkTitleSuggestion();

    const user = ApiService.getCurrentUser();
    if (!user) return;

    const achievements = ApiService.getAchievements?.() || [];
    const registry = this._getAchievementRegistry?.();
    const earned = achievements.filter(achievement => {
      if (achievement.status === 'archived') return false;
      if (registry?.isSupportedCondition?.(achievement.condition) === false) return false;
      const threshold = this._getAchThreshold ? this._getAchThreshold(achievement) : (achievement.condition?.threshold ?? achievement.target ?? 1);
      return (achievement.current || 0) >= threshold;
    });
    if (!earned.length) return;

    const promptKey = 'sporthub_title_prompted_' + ModeManager.getMode();
    const lastCount = parseInt(localStorage.getItem(promptKey) || '0', 10);
    if (earned.length <= lastCount) return;

    localStorage.setItem(promptKey, String(earned.length));

    const availableBigTitles = new Set(earned.filter(achievement => achievement.category === 'gold').map(achievement => achievement.name));
    const availableNormalTitles = new Set(earned.filter(achievement => achievement.category !== 'gold').map(achievement => achievement.name));
    const hasGoldSlot = !availableBigTitles.has(user.titleBig) && earned.some(achievement => achievement.category === 'gold');
    const hasNormalSlot = !availableNormalTitles.has(user.titleNormal) && earned.some(achievement => achievement.category !== 'gold');
    if (!hasGoldSlot && !hasNormalSlot) {
      this.showToast('你已有可裝備的稱號，前往稱號頁可手動更換');
      return;
    }

    const shouldOpen = await this.appConfirm('你獲得了新的稱號，現在前往稱號頁設定嗎？');
    if (shouldOpen) this.showPage('page-titles');
  },

  renderTitlePage() {
    const titles = this._getAchievementTitles?.();
    if (titles?.renderTitlePage) return titles.renderTitlePage();

    const user = ApiService.getCurrentUser();
    const lineProfile = (!ModeManager.isDemo() && typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn())
      ? LineAuth.getProfile()
      : null;
    const lineName = lineProfile ? lineProfile.displayName : (user ? user.displayName : '-');
    const achievements = ApiService.getAchievements?.() || [];
    const registry = this._getAchievementRegistry?.();
    const earned = achievements.filter(achievement => {
      if (achievement.status === 'archived') return false;
      if (registry?.isSupportedCondition?.(achievement.condition) === false) return false;
      const threshold = this._getAchThreshold ? this._getAchThreshold(achievement) : (achievement.condition?.threshold ?? achievement.target ?? 1);
      return (achievement.current || 0) >= threshold;
    });
    const bigTitles = earned.filter(achievement => achievement.category === 'gold').map(achievement => achievement.name);
    const normalTitles = earned.filter(achievement => achievement.category !== 'gold').map(achievement => achievement.name);
    const bigTitleSet = new Set(bigTitles);
    const normalTitleSet = new Set(normalTitles);
    const bigSelect = document.getElementById('title-big');
    const normalSelect = document.getElementById('title-normal');
    const nameInput = document.getElementById('title-line-name');

    if (nameInput) nameInput.value = lineName || '-';

    if (bigSelect) {
      const currentBig = bigTitleSet.has(user?.titleBig) ? user.titleBig : '';
      bigSelect.innerHTML = '<option value="">不設定</option>' + bigTitles.map(title =>
        `<option value="${escapeHTML(title)}" ${title === currentBig ? 'selected' : ''}>${escapeHTML(title)}</option>`
      ).join('');
    }

    if (normalSelect) {
      const currentNormal = normalTitleSet.has(user?.titleNormal) ? user.titleNormal : '';
      normalSelect.innerHTML = '<option value="">不設定</option>' + normalTitles.map(title =>
        `<option value="${escapeHTML(title)}" ${title === currentNormal ? 'selected' : ''}>${escapeHTML(title)}</option>`
      ).join('');
    }

    this._updateTitlePreview();

    if (bigSelect && !bigSelect.dataset.bound) {
      bigSelect.dataset.bound = '1';
      bigSelect.addEventListener('change', () => this._updateTitlePreview());
    }
    if (normalSelect && !normalSelect.dataset.bound) {
      normalSelect.dataset.bound = '1';
      normalSelect.addEventListener('change', () => this._updateTitlePreview());
    }
  },

  _updateTitlePreview() {
    const titles = this._getAchievementTitles?.();
    if (titles?.updateTitlePreview) return titles.updateTitlePreview();

    const big = document.getElementById('title-big')?.value || '';
    const normal = document.getElementById('title-normal')?.value || '';
    const name = document.getElementById('title-line-name')?.value || '-';
    const preview = document.getElementById('title-preview');
    if (!preview) return;

    preview.innerHTML = this._buildTitleDisplayHtml({
      titleBig: big || null,
      titleNormal: normal || null,
      displayName: name,
    });
  },

  saveTitles() {
    const titles = this._getAchievementTitles?.();
    if (titles?.saveTitles) return titles.saveTitles();

    const titleBig = document.getElementById('title-big')?.value || null;
    const titleNormal = document.getElementById('title-normal')?.value || null;
    ApiService.updateCurrentUser({ titleBig, titleNormal });
    this.renderProfileData();
    this.showToast('稱號已儲存');
  },

  toggleUserMenu() {
    const menu = document.getElementById('user-menu-dropdown');
    if (!menu) return;
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : '';
    if (!isOpen) {
      // 填入用戶名稱
      const nameEl = document.getElementById('user-menu-name');
      const profile = (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) ? LineAuth.getProfile() : null;
      if (nameEl && profile) nameEl.textContent = profile.displayName;
      // 點擊外部關閉
      setTimeout(() => {
        const close = (e) => {
          if (!menu.contains(e.target) && e.target.id !== 'line-avatar-topbar') {
            menu.style.display = 'none';
            document.removeEventListener('click', close);
          }
        };
        document.addEventListener('click', close);
      }, 0);
    }
  },

  async logoutLine() {
    const logoutUid =
      ApiService.getCurrentUser()?.uid
      || (typeof auth !== 'undefined' && auth?.currentUser?.uid)
      || '';
    if (logoutUid && typeof FirebaseService !== 'undefined' && FirebaseService._lastLoginAuditAtByUid) {
      delete FirebaseService._lastLoginAuditAtByUid[logoutUid];
    }
    if (typeof LineAuth !== 'undefined') {
      await LineAuth.logout();
    }
  },

});
