/* ================================================
   SportHub Achievement Profile Helpers
   Bridges badge/title helpers into profile-facing
   pages while keeping page modules lightweight.
   ================================================ */

Object.assign(App, {

  _buildAchievementProfile() {
    const getBadges = () => App._getAchievementBadges?.();
    const getTitles = () => App._getAchievementTitles?.();

    const buildTitleDisplayHtml = (user, overrideName) => {
      return getTitles()?.buildTitleDisplayHtml?.(user, overrideName)
        || escapeHTML(overrideName || user?.displayName || '-');
    };

    const getCurrentBadgeCount = () => {
      return getBadges()?.getCurrentUserBadgeCount?.() || 0;
    };

    const buildEarnedBadgeListHtml = (options = {}) => {
      const badgeHelper = getBadges();
      if (!badgeHelper) {
        return `<div style="font-size:.82rem;color:var(--text-muted)">${escapeHTML(options.emptyText || '尚未獲得徽章')}</div>`;
      }

      if (Array.isArray(options.earnedBadges)) {
        return badgeHelper.buildBadgeListHtml(options.earnedBadges, options);
      }

      return badgeHelper.buildEarnedBadgeListHtml(
        options.achievements ?? (ApiService.getAchievements?.() || []),
        options.badges ?? (ApiService.getBadges?.() || []),
        options
      );
    };

    return {
      buildTitleDisplayHtml,
      getCurrentBadgeCount,
      buildEarnedBadgeListHtml,
    };
  },

});

App._registerAchievementPart('profile', App._buildAchievementProfile());
