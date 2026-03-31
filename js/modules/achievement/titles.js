/* ================================================
   SportHub Achievement Title Helpers
   Keeps title rendering and title-page logic in the
   achievement domain while old App methods stay stable.
   ================================================ */

Object.assign(App, {

  _buildAchievementTitles() {
    const getStats = () => App._getAchievementStats?.();
    const getEvaluator = () => App._getAchievementEvaluator?.();

    const getEvaluatedAchievementsForUser = (user) => {
      const safeUser = user || ApiService.getCurrentUser?.() || null;
      return getEvaluator()?.getEvaluatedAchievements?.({
        targetUser: safeUser,
        targetUid: safeUser?.uid || safeUser?._docId,
      }) || (ApiService.getAchievements?.() || []);
    };

    const getCurrentTitleOptions = (user) => {
      return getStats()?.getTitleOptions?.(getEvaluatedAchievementsForUser(user))
        || { earned: [], bigTitles: [], normalTitles: [] };
    };

    const getSanitizedEquippedTitles = (user) => {
      const safeUser = user || {};
      const options = getCurrentTitleOptions(safeUser);
      const bigSet = new Set(options.bigTitles || []);
      const normalSet = new Set(options.normalTitles || []);
      return {
        titleBig: bigSet.has(safeUser.titleBig) ? safeUser.titleBig : null,
        titleNormal: normalSet.has(safeUser.titleNormal) ? safeUser.titleNormal : null,
      };
    };

    const buildTitleDisplay = (user, overrideName) => {
      const safeUser = user || {};
      const equipped = getSanitizedEquippedTitles(safeUser);
      const parts = [];
      if (equipped.titleBig) parts.push(equipped.titleBig);
      if (equipped.titleNormal) parts.push(equipped.titleNormal);
      const name = overrideName || safeUser.displayName || '-';
      parts.push(name);
      return parts.join('.');
    };

    const buildTitleDisplayHtml = (user, overrideName) => {
      const safeUser = user || {};
      const equipped = getSanitizedEquippedTitles(safeUser);
      const parts = [];
      if (equipped.titleBig) {
        parts.push(`<span class="title-tag title-gold">${escapeHTML(equipped.titleBig)}</span>`);
      }
      if (equipped.titleNormal) {
        parts.push(`<span class="title-tag title-normal">${escapeHTML(equipped.titleNormal)}</span>`);
      }
      const name = overrideName || safeUser.displayName || '-';
      parts.push(escapeHTML(name));
      return parts.join('<span class="title-dot">.</span>');
    };

    const checkTitleSuggestion = async () => {
      const user = ApiService.getCurrentUser?.();
      if (!user) return;

      const titleOptions = getCurrentTitleOptions(user);
      const earned = titleOptions.earned || [];
      if (!earned.length) return;

      const promptKey = 'sporthub_title_prompted_' + ModeManager.getMode();
      const lastCount = parseInt(localStorage.getItem(promptKey) || '0', 10);
      if (earned.length <= lastCount) return;

      localStorage.setItem(promptKey, String(earned.length));

      const equipped = getSanitizedEquippedTitles(user);
      const hasGoldSlot = !equipped.titleBig && earned.some(achievement => achievement.category === 'gold');
      const hasNormalSlot = !equipped.titleNormal && earned.some(achievement => achievement.category !== 'gold');
      if (!hasGoldSlot && !hasNormalSlot) {
        App.showToast('你已有可用稱號，可前往稱號頁裝備。');
        return;
      }

      const shouldOpen = await App.appConfirm('你獲得新的稱號，現在要前往稱號頁裝備嗎？');
      if (shouldOpen) App.showPage('page-titles');
    };

    const updateTitlePreview = () => {
      const big = document.getElementById('title-big')?.value || '';
      const normal = document.getElementById('title-normal')?.value || '';
      const name = document.getElementById('title-line-name')?.value || '-';
      const preview = document.getElementById('title-preview');
      if (!preview) return;

      preview.innerHTML = buildTitleDisplayHtml({
        titleBig: big || null,
        titleNormal: normal || null,
        displayName: name,
      });
    };

    const renderTitlePage = () => {
      const user = ApiService.getCurrentUser?.();
      const lineProfile = (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn())
        ? LineAuth.getProfile()
        : null;
      const lineName = lineProfile ? lineProfile.displayName : (user ? user.displayName : '-');
      const titleOptions = getCurrentTitleOptions(user);
      const bigTitles = titleOptions.bigTitles || [];
      const normalTitles = titleOptions.normalTitles || [];
      const bigSelect = document.getElementById('title-big');
      const normalSelect = document.getElementById('title-normal');
      const nameInput = document.getElementById('title-line-name');

      if (nameInput) nameInput.value = lineName || '-';

      if (bigSelect) {
        const currentBig = getSanitizedEquippedTitles(user).titleBig || '';
        bigSelect.innerHTML = '<option value="">不裝備</option>' + bigTitles.map(title =>
          `<option value="${escapeHTML(title)}" ${title === currentBig ? 'selected' : ''}>${escapeHTML(title)}</option>`
        ).join('');
      }

      if (normalSelect) {
        const currentNormal = getSanitizedEquippedTitles(user).titleNormal || '';
        normalSelect.innerHTML = '<option value="">不裝備</option>' + normalTitles.map(title =>
          `<option value="${escapeHTML(title)}" ${title === currentNormal ? 'selected' : ''}>${escapeHTML(title)}</option>`
        ).join('');
      }

      updateTitlePreview();

      if (bigSelect && !bigSelect.dataset.bound) {
        bigSelect.dataset.bound = '1';
        bigSelect.addEventListener('change', updateTitlePreview);
      }
      if (normalSelect && !normalSelect.dataset.bound) {
        normalSelect.dataset.bound = '1';
        normalSelect.addEventListener('change', updateTitlePreview);
      }
    };

    const saveTitles = () => {
      const titleBig = document.getElementById('title-big')?.value || null;
      const titleNormal = document.getElementById('title-normal')?.value || null;
      ApiService.updateCurrentUser({ titleBig, titleNormal });
      App.renderProfileData();
      App.showToast('稱號已儲存');
    };

    return {
      buildTitleDisplay,
      buildTitleDisplayHtml,
      getCurrentTitleOptions,
      checkTitleSuggestion,
      renderTitlePage,
      updateTitlePreview,
      saveTitles,
    };
  },

});

App._registerAchievementPart('titles', App._buildAchievementTitles());
