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

      const targetUser = options.targetUser || null;
      const achievements = Array.isArray(options.achievements)
        ? options.achievements
        : badgeHelper.getEvaluatedAchievementsForUser?.(targetUser || ApiService.getCurrentUser?.() || null)
          || (ApiService.getAchievements?.() || []);

      return badgeHelper.buildEarnedBadgeListHtml(
        achievements,
        options.badges ?? (ApiService.getBadges?.() || []),
        options
      );
    };

    /**
     * 異步版：支援讀取其他用戶的徽章（從 Firestore 子集合）
     */
    const buildEarnedBadgeListHtmlAsync = async (options = {}) => {
      const badgeHelper = getBadges();
      if (!badgeHelper) {
        return `<div style="font-size:.82rem;color:var(--text-muted)">${escapeHTML(options.emptyText || '尚未獲得徽章')}</div>`;
      }

      if (Array.isArray(options.earnedBadges)) {
        return badgeHelper.buildBadgeListHtml(options.earnedBadges, options);
      }

      const targetUser = options.targetUser || null;
      let achievements;
      if (Array.isArray(options.achievements)) {
        achievements = options.achievements;
      } else if (targetUser && badgeHelper.getEvaluatedAchievementsForUserAsync) {
        achievements = await badgeHelper.getEvaluatedAchievementsForUserAsync(targetUser);
      } else {
        achievements = badgeHelper.getEvaluatedAchievementsForUser?.(targetUser || ApiService.getCurrentUser?.() || null)
          || (ApiService.getAchievements?.() || []);
      }

      return badgeHelper.buildEarnedBadgeListHtml(
        achievements,
        options.badges ?? (ApiService.getBadges?.() || []),
        options
      );
    };

    return {
      buildTitleDisplayHtml,
      getCurrentBadgeCount,
      buildEarnedBadgeListHtml,
      buildEarnedBadgeListHtmlAsync,
    };
  },

});

App._registerAchievementPart('profile', App._buildAchievementProfile());
