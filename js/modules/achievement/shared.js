/* ================================================
   SportHub — Achievement Shared Helpers
   先抽純 helper，供舊 achievement.js 作 facade
   ================================================ */

Object.assign(App, {

  _buildAchievementShared() {
    const categoryOrder = { gold: 0, silver: 1, bronze: 2 };

    return {
      sortByCat(items) {
        return [...items].sort((a, b) => (categoryOrder[a.category] ?? 9) - (categoryOrder[b.category] ?? 9));
      },

      getThreshold(achievement) {
        if (achievement?.condition?.threshold != null) return achievement.condition.threshold;
        if (achievement?.target != null) return achievement.target;
        return 1;
      },

      generateConditionDesc(condition, desc) {
        if (!condition) return desc || '（未設定條件）';

        const registry = App._getAchievementRegistry?.();
        const actionCfg = registry?.findActionConfig?.(condition.action);
        const timeRangeCfg = registry?.findTimeRangeConfig?.(condition.timeRange);
        const filterCfg = registry?.findFilterConfig?.(condition.filter);
        const actionLabel = actionCfg ? actionCfg.label : condition.action;
        const unit = actionCfg ? actionCfg.unit : '';
        const threshold = condition.threshold != null ? condition.threshold : 0;

        if (condition.timeRange === 'streak') {
          const days = condition.streakDays || threshold;
          const filterText = (filterCfg && condition.filter !== 'all' && actionCfg && actionCfg.needsFilter)
            ? ` ${filterCfg.label}`
            : '';
          return `連續 ${days} 天${actionLabel}${filterText}`;
        }

        if (!unit && threshold <= 1) return actionLabel;

        const timeText = (timeRangeCfg && condition.timeRange !== 'none') ? `${timeRangeCfg.label}` : '';
        const filterText = (filterCfg && condition.filter !== 'all' && actionCfg && actionCfg.needsFilter)
          ? ` ${filterCfg.label}`
          : '';

        if (timeText) {
          return `${timeText}${actionLabel}${filterText} ${threshold}${unit ? ' ' + unit : ''}`.trim();
        }
        return `${actionLabel}${filterText} ${threshold}${unit ? ' ' + unit : ''}`.trim();
      },
    };
  },

});

App._registerAchievementPart('shared', App._buildAchievementShared());
