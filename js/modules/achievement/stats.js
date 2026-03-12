/* ================================================
   SportHub Achievement Stats Helpers
   Shared derived-state helpers for badge counts,
   earned badge view models, and title options.
   ================================================ */

Object.assign(App, {

  _buildAchievementStats() {
    const getShared = () => App._getAchievementShared?.();

    const getThreshold = (achievement) => {
      const shared = getShared();
      if (shared?.getThreshold) return shared.getThreshold(achievement);
      if (achievement?.condition?.threshold != null) return achievement.condition.threshold;
      if (achievement?.target != null) return achievement.target;
      return 1;
    };

    const getActiveAchievements = (achievements) => {
      return (Array.isArray(achievements) ? achievements : [])
        .filter(achievement => achievement && achievement.status !== 'archived');
    };

    const isCompleted = (achievement) => {
      return Number(achievement?.current || 0) >= Number(getThreshold(achievement));
    };

    const getCompletedAchievements = (achievements) => {
      return getActiveAchievements(achievements).filter(isCompleted);
    };

    const getPendingAchievements = (achievements) => {
      return getActiveAchievements(achievements).filter(achievement => !isCompleted(achievement));
    };

    const splitAchievements = (achievements) => {
      const active = getActiveAchievements(achievements);
      const completed = active.filter(isCompleted);
      const pending = active.filter(achievement => !isCompleted(achievement));
      return { active, completed, pending };
    };

    const getBadgeCount = (achievements) => {
      return getCompletedAchievements(achievements).length;
    };

    const getEarnedBadgeViewModels = (achievements, badges) => {
      const completedAchievements = getCompletedAchievements(achievements);
      const badgeList = Array.isArray(badges) ? badges : (ApiService.getBadges?.() || []);
      const completedMap = new Map(completedAchievements.map(achievement => [achievement.id, achievement]));
      const shared = getShared();

      return badgeList.map(badge => {
        const achievement = completedMap.get(badge?.achId);
        if (!achievement) return null;
        const category = achievement.category || badge.category || 'bronze';
        return {
          badge,
          achievement,
          achName: achievement.name,
          category,
          color: shared?.getCategoryColor?.(category) || '#b87333',
          background: shared?.getCategoryBg?.(category) || 'rgba(184,115,51,.12)',
          label: shared?.getCategoryLabel?.(category) || '銅',
        };
      }).filter(Boolean);
    };

    const getTitleOptions = (achievements) => {
      const earned = getCompletedAchievements(achievements);
      return {
        earned,
        bigTitles: earned.filter(achievement => achievement.category === 'gold').map(achievement => achievement.name),
        normalTitles: earned.filter(achievement => achievement.category !== 'gold').map(achievement => achievement.name),
      };
    };

    return {
      getThreshold,
      getActiveAchievements,
      isCompleted,
      getCompletedAchievements,
      getPendingAchievements,
      splitAchievements,
      getBadgeCount,
      getEarnedBadgeViewModels,
      getTitleOptions,
    };
  },

});

App._registerAchievementPart('stats', App._buildAchievementStats());
