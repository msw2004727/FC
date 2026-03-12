/* ================================================
   SportHub Achievement Shared Helpers
   Pure helpers shared by the facade and domain
   submodules during the folder refactor.
   ================================================ */

Object.assign(App, {

  _buildAchievementShared() {
    const categoryOrder = { gold: 0, silver: 1, bronze: 2 };
    const categoryColor = {
      gold: '#d4a017',
      silver: '#9ca3af',
      bronze: '#b87333',
    };
    const categoryBg = {
      gold: 'rgba(212,160,23,.12)',
      silver: 'rgba(156,163,175,.12)',
      bronze: 'rgba(184,115,51,.12)',
    };
    const categoryLabel = {
      gold: '金',
      silver: '銀',
      bronze: '銅',
    };

    return {
      sortByCat(items) {
        return [...items].sort((a, b) => (categoryOrder[a.category] ?? 9) - (categoryOrder[b.category] ?? 9));
      },

      getCategoryOrder() {
        return { ...categoryOrder };
      },

      getCategoryColor(category) {
        return categoryColor[category] || categoryColor.bronze;
      },

      getCategoryBg(category) {
        return categoryBg[category] || categoryBg.bronze;
      },

      getCategoryLabel(category) {
        return categoryLabel[category] || categoryLabel.bronze;
      },

      getThreshold(achievement) {
        if (achievement?.condition?.threshold != null) return achievement.condition.threshold;
        if (achievement?.target != null) return achievement.target;
        return 1;
      },

      generateConditionDesc(condition, desc) {
        if (!condition) return desc || '未設定成就條件';

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
          return `${timeText}${actionLabel}${filterText} ${threshold}${unit ? ` ${unit}` : ''}`.trim();
        }
        return `${actionLabel}${filterText} ${threshold}${unit ? ` ${unit}` : ''}`.trim();
      },
    };
  },

});

App._registerAchievementPart('shared', App._buildAchievementShared());
