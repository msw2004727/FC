/* ================================================
   SportHub — Achievement Module Registry
   過渡期沿用 config.js 的 ACHIEVEMENT_CONDITIONS
   ================================================ */

Object.assign(App, {

  _buildAchievementRegistry() {
    return {
      getConditionConfig() {
        return ACHIEVEMENT_CONDITIONS;
      },

      getActions() {
        return this.getConditionConfig().actions || [];
      },

      getTimeRanges() {
        return this.getConditionConfig().timeRanges || [];
      },

      getFilters() {
        return this.getConditionConfig().filters || [];
      },

      findActionConfig(actionKey) {
        return this.getActions().find(action => action.key === actionKey) || null;
      },

      findTimeRangeConfig(timeRangeKey) {
        return this.getTimeRanges().find(range => range.key === timeRangeKey) || null;
      },

      findFilterConfig(filterKey) {
        return this.getFilters().find(filter => filter.key === filterKey) || null;
      },

      actionNeedsFilter(actionKey) {
        return !!this.findActionConfig(actionKey)?.needsFilter;
      },
    };
  },

});

App._registerAchievementPart('registry', App._buildAchievementRegistry());
