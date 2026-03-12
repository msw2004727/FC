/* ================================================
   SportHub Achievement Module Registry
   Centralizes supported action and time-range
   metadata while preserving the legacy facade.
   ================================================ */

Object.assign(App, {

  _buildAchievementRegistry() {
    const attendActionByEventType = Object.freeze({
      play: 'attend_play',
      friendly: 'attend_friendly',
      camp: 'attend_camp',
      watch: 'attend_watch',
    });

    const actionMetaMap = Object.freeze({
      register_event: {
        supported: true,
        handlerKey: 'register_event',
        needsFilter: true,
        supportsTimeRange: true,
        eventTrigger: true,
      },
      complete_event: {
        supported: true,
        handlerKey: 'complete_event',
        needsFilter: true,
        supportsTimeRange: true,
        eventTrigger: true,
      },
      organize_event: {
        supported: true,
        handlerKey: 'organize_event',
        needsFilter: true,
        supportsTimeRange: true,
        eventTrigger: true,
      },
      attend_play: {
        supported: true,
        handlerKey: 'attend_event',
        fixedFilter: 'play',
        needsFilter: false,
        supportsTimeRange: true,
        eventTrigger: true,
      },
      attend_friendly: {
        supported: true,
        handlerKey: 'attend_event',
        fixedFilter: 'friendly',
        needsFilter: false,
        supportsTimeRange: true,
        eventTrigger: true,
      },
      attend_camp: {
        supported: true,
        handlerKey: 'attend_event',
        fixedFilter: 'camp',
        needsFilter: false,
        supportsTimeRange: true,
        eventTrigger: true,
      },
      attend_watch: {
        supported: true,
        handlerKey: 'attend_event',
        fixedFilter: 'watch',
        needsFilter: false,
        supportsTimeRange: true,
        eventTrigger: true,
      },
      attendance_rate: {
        supported: true,
        handlerKey: 'attendance_rate',
        needsFilter: false,
        supportsTimeRange: true,
        eventTrigger: false,
      },
      reach_level: {
        supported: true,
        handlerKey: 'reach_level',
        needsFilter: false,
        supportsTimeRange: false,
        eventTrigger: false,
      },
      reach_exp: {
        supported: true,
        handlerKey: 'reach_exp',
        needsFilter: false,
        supportsTimeRange: false,
        eventTrigger: false,
      },
      join_team: {
        supported: true,
        handlerKey: 'join_team',
        needsFilter: false,
        supportsTimeRange: false,
        eventTrigger: false,
      },
      complete_profile: {
        supported: true,
        handlerKey: 'complete_profile',
        needsFilter: false,
        supportsTimeRange: false,
        eventTrigger: false,
      },
      bind_line_notify: {
        supported: true,
        handlerKey: 'bind_line_notify',
        needsFilter: false,
        supportsTimeRange: false,
        eventTrigger: false,
      },
      days_registered: {
        supported: true,
        handlerKey: 'days_registered',
        needsFilter: false,
        supportsTimeRange: false,
        eventTrigger: false,
      },
      list_shop_item: {
        supported: false,
        handlerKey: null,
        needsFilter: false,
        supportsTimeRange: false,
        eventTrigger: false,
      },
      sell_shop_item: {
        supported: false,
        handlerKey: null,
        needsFilter: false,
        supportsTimeRange: false,
        eventTrigger: false,
      },
      earn_badges: {
        supported: false,
        handlerKey: null,
        needsFilter: false,
        supportsTimeRange: false,
        eventTrigger: false,
      },
    });

    const timeRangeMetaMap = Object.freeze({
      none: { supported: true, days: null, fallbackTo: 'none' },
      '7d': { supported: true, days: 7, fallbackTo: '7d' },
      '30d': { supported: true, days: 30, fallbackTo: '30d' },
      '90d': { supported: true, days: 90, fallbackTo: '90d' },
      streak: { supported: false, days: null, fallbackTo: 'none' },
    });

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

      findActionMeta(actionKey) {
        return actionMetaMap[actionKey] || null;
      },

      getActionMetaMap() {
        return actionMetaMap;
      },

      isSupportedAction(actionKey) {
        return !!this.findActionMeta(actionKey)?.supported;
      },

      getSupportedActions() {
        return this.getActions().filter(action => this.isSupportedAction(action.key));
      },

      getUnsupportedActions() {
        return this.getActions().filter(action => !this.isSupportedAction(action.key));
      },

      actionNeedsFilter(actionKey) {
        const actionMeta = this.findActionMeta(actionKey);
        if (actionMeta) return !!actionMeta.needsFilter;
        return !!this.findActionConfig(actionKey)?.needsFilter;
      },

      findAttendActionForEventType(eventType) {
        return attendActionByEventType[String(eventType || '').trim()] || null;
      },

      findTimeRangeMeta(timeRangeKey) {
        return timeRangeMetaMap[timeRangeKey] || null;
      },

      getEffectiveTimeRangeKey(timeRangeKey) {
        const key = String(timeRangeKey || 'none').trim() || 'none';
        return this.findTimeRangeMeta(key)?.fallbackTo || 'none';
      },

      isStrictlySupportedTimeRange(timeRangeKey) {
        return !!this.findTimeRangeMeta(timeRangeKey)?.supported;
      },

      getTimeRangeDays(timeRangeKey) {
        const meta = this.findTimeRangeMeta(this.getEffectiveTimeRangeKey(timeRangeKey));
        return Number.isFinite(meta?.days) ? meta.days : null;
      },

      shouldEvaluateForEventType(condition, eventType) {
        if (!eventType) return true;

        const actionKey = String(condition?.action || '').trim();
        const actionMeta = this.findActionMeta(actionKey);
        if (!actionMeta?.eventTrigger) return false;

        const normalizedEventType = String(eventType || '').trim();
        if (!normalizedEventType) return true;

        if (actionMeta.fixedFilter) {
          return actionMeta.fixedFilter === normalizedEventType;
        }

        if (actionMeta.needsFilter) {
          const filterKey = String(condition?.filter || 'all').trim() || 'all';
          return filterKey === 'all' || filterKey === normalizedEventType;
        }

        return true;
      },
    };
  },

});

App._registerAchievementPart('registry', App._buildAchievementRegistry());
