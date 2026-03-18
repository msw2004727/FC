/* ================================================
   SportHub Achievement Module Registry
   Centralizes supported template metadata while
   preserving legacy labels for migrated records.
   ================================================ */

Object.assign(App, {

  _buildAchievementRegistry() {
    const normalizeString = (value) => String(value || '').trim();
    const toFiniteNumber = (value, fallback = 0) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    const attendActionByEventType = Object.freeze({
      play: 'attend_play',
      friendly: 'attend_friendly',
      camp: 'attend_camp',
      watch: 'attend_watch',
    });

    const legacyActionConfigMap = Object.freeze({
      organize_event: { key: 'organize_event', label: '主辦活動', unit: '場', needsFilter: true },
      list_shop_item: { key: 'list_shop_item', label: '刊登二手商品', unit: '件', needsFilter: false },
      sell_shop_item: { key: 'sell_shop_item', label: '售出二手商品', unit: '件', needsFilter: false },
      earn_badges: { key: 'earn_badges', label: '獲得徽章', unit: '個', needsFilter: false },
    });

    const legacyTimeRangeConfigMap = Object.freeze({
      '7d': { key: '7d', label: '7 天內' },
      '30d': { key: '30d', label: '30 天內' },
      '90d': { key: '90d', label: '90 天內' },
      streak: { key: 'streak', label: '連續 N 天' },
    });

    const actionMetaMap = Object.freeze({
      register_event: {
        supported: true,
        handlerKey: 'register_event',
        needsFilter: true,
        eventTrigger: true,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      complete_event: {
        supported: true,
        handlerKey: 'complete_event',
        needsFilter: true,
        eventTrigger: true,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      attend_play: {
        supported: true,
        handlerKey: 'attend_event',
        fixedFilter: 'play',
        needsFilter: false,
        eventTrigger: true,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      attend_friendly: {
        supported: true,
        handlerKey: 'attend_event',
        fixedFilter: 'friendly',
        needsFilter: false,
        eventTrigger: true,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      attend_camp: {
        supported: true,
        handlerKey: 'attend_event',
        fixedFilter: 'camp',
        needsFilter: false,
        eventTrigger: true,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      attend_watch: {
        supported: true,
        handlerKey: 'attend_event',
        fixedFilter: 'watch',
        needsFilter: false,
        eventTrigger: true,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      attendance_rate: {
        supported: true,
        handlerKey: 'attendance_rate',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 80,
        fixedThreshold: null,
      },
      reach_level: {
        supported: true,
        handlerKey: 'reach_level',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      reach_exp: {
        supported: true,
        handlerKey: 'reach_exp',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 100,
        fixedThreshold: null,
      },
      join_team: {
        supported: true,
        handlerKey: 'join_team',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: 1,
      },
      complete_profile: {
        supported: true,
        handlerKey: 'complete_profile',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: 1,
      },
      bind_line_notify: {
        supported: true,
        handlerKey: 'bind_line_notify',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: 1,
      },
      days_registered: {
        supported: true,
        handlerKey: 'days_registered',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 30,
        fixedThreshold: null,
      },
      organize_event: {
        supported: true,
        handlerKey: 'organize_event',
        needsFilter: true,
        eventTrigger: true,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      diverse_sports: {
        supported: true,
        handlerKey: 'diverse_sports',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 3,
        fixedThreshold: null,
      },
      no_show_free: {
        supported: true,
        handlerKey: 'no_show_free',
        needsFilter: false,
        eventTrigger: false,
        reverseComparison: true,
        defaultThreshold: 0,
        fixedThreshold: null,
      },
      create_team: {
        supported: true,
        handlerKey: 'create_team',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      bring_companion: {
        supported: true,
        handlerKey: 'bring_companion',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 5,
        fixedThreshold: null,
      },
      team_member_count: {
        supported: true,
        handlerKey: 'team_member_count',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 10,
        fixedThreshold: null,
      },
      early_event: {
        supported: true,
        handlerKey: 'early_event',
        needsFilter: false,
        eventTrigger: true,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      night_event: {
        supported: true,
        handlerKey: 'night_event',
        needsFilter: false,
        eventTrigger: true,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      shop_trade: {
        supported: true,
        handlerKey: 'shop_trade',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      game_play: {
        supported: true,
        handlerKey: 'game_play',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      game_high_score: {
        supported: true,
        handlerKey: 'game_high_score',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 100,
        fixedThreshold: null,
      },
      list_shop_item: {
        supported: false,
        handlerKey: null,
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      sell_shop_item: {
        supported: false,
        handlerKey: null,
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      earn_badges: {
        supported: false,
        handlerKey: null,
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: null,
      },
      role_coach: {
        supported: true,
        handlerKey: 'role_check',
        targetRole: 'coach',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: 1,
      },
      role_captain: {
        supported: true,
        handlerKey: 'role_check',
        targetRole: 'captain',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: 1,
      },
      role_venue_owner: {
        supported: true,
        handlerKey: 'role_check',
        targetRole: 'venue_owner',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: 1,
      },
      role_admin: {
        supported: true,
        handlerKey: 'role_check',
        targetRole: 'admin',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: 1,
      },
      role_super_admin: {
        supported: true,
        handlerKey: 'role_check',
        targetRole: 'super_admin',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: 1,
      },
      manual_award: {
        supported: true,
        handlerKey: 'manual_award',
        needsFilter: false,
        eventTrigger: false,
        defaultThreshold: 1,
        fixedThreshold: 1,
      },
    });

    const timeRangeMetaMap = Object.freeze({
      none: { supported: true, days: null, fallbackTo: 'none' },
      '7d': { supported: false, days: 7, fallbackTo: 'none' },
      '30d': { supported: false, days: 30, fallbackTo: 'none' },
      '90d': { supported: false, days: 90, fallbackTo: 'none' },
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
        const safeKey = normalizeString(actionKey);
        return this.getActions().find(action => action.key === safeKey) || legacyActionConfigMap[safeKey] || null;
      },

      findTimeRangeConfig(timeRangeKey) {
        const safeKey = normalizeString(timeRangeKey);
        return this.getTimeRanges().find(range => range.key === safeKey) || legacyTimeRangeConfigMap[safeKey] || null;
      },

      findFilterConfig(filterKey) {
        return this.getFilters().find(filter => filter.key === normalizeString(filterKey)) || null;
      },

      findActionMeta(actionKey) {
        return actionMetaMap[normalizeString(actionKey)] || null;
      },

      findTimeRangeMeta(timeRangeKey) {
        return timeRangeMetaMap[normalizeString(timeRangeKey)] || null;
      },

      getActionMetaMap() {
        return actionMetaMap;
      },

      isSupportedAction(actionKey) {
        return !!this.findActionMeta(actionKey)?.supported;
      },

      isStrictlySupportedTimeRange(timeRangeKey) {
        return !!this.findTimeRangeMeta(timeRangeKey)?.supported;
      },

      isSupportedCondition(condition) {
        const safeCondition = condition || {};
        const timeRangeKey = normalizeString(safeCondition.timeRange || 'none') || 'none';
        return this.isSupportedAction(safeCondition.action) && this.isStrictlySupportedTimeRange(timeRangeKey);
      },

      getSupportedActions() {
        return this.getActions().filter(action => this.isSupportedAction(action.key));
      },

      getUnsupportedActions() {
        const unsupportedConfigured = this.getActions().filter(action => !this.isSupportedAction(action.key));
        return [
          ...unsupportedConfigured,
          ...Object.values(legacyActionConfigMap),
        ];
      },

      actionNeedsFilter(actionKey) {
        const actionMeta = this.findActionMeta(actionKey);
        if (actionMeta) return !!actionMeta.needsFilter;
        return !!this.findActionConfig(actionKey)?.needsFilter;
      },

      getActionFieldState(actionKey) {
        const actionMeta = this.findActionMeta(actionKey) || {};
        const fixedThreshold = Number.isFinite(actionMeta.fixedThreshold) ? actionMeta.fixedThreshold : null;
        // reverseComparison 類型（如 no_show_free）允許 defaultThreshold = 0
        const minThreshold = actionMeta.reverseComparison ? 0 : 1;
        const defaultThreshold = fixedThreshold != null
          ? fixedThreshold
          : Math.max(minThreshold, toFiniteNumber(actionMeta.defaultThreshold, 1));
        return {
          showFilter: !!actionMeta.needsFilter,
          showThreshold: fixedThreshold == null,
          fixedThreshold,
          defaultThreshold,
          thresholdMin: minThreshold,
        };
      },

      normalizeCondition(condition) {
        const safeCondition = condition || {};
        const actionKey = normalizeString(safeCondition.action) || 'complete_event';
        const fieldState = this.getActionFieldState(actionKey);
        const rawTimeRange = normalizeString(safeCondition.timeRange || 'none') || 'none';
        const rawFilter = normalizeString(safeCondition.filter || 'all') || 'all';
        const rawThreshold = toFiniteNumber(safeCondition.threshold, fieldState.defaultThreshold);
        const normalized = {
          timeRange: this.getEffectiveTimeRangeKey(rawTimeRange),
          action: actionKey,
          filter: fieldState.showFilter && this.findFilterConfig(rawFilter) ? rawFilter : 'all',
          // rawThreshold 可能為 0（reverseComparison 類型），不可用 || 判斷
          threshold: fieldState.fixedThreshold != null
            ? fieldState.fixedThreshold
            : Math.max(fieldState.thresholdMin, rawThreshold != null ? rawThreshold : fieldState.defaultThreshold),
        };
        return normalized;
      },

      findAttendActionForEventType(eventType) {
        return attendActionByEventType[normalizeString(eventType).toLowerCase()] || null;
      },

      getEffectiveTimeRangeKey(timeRangeKey) {
        const key = normalizeString(timeRangeKey || 'none') || 'none';
        return this.findTimeRangeMeta(key)?.fallbackTo || 'none';
      },

      getTimeRangeDays(timeRangeKey) {
        const meta = this.findTimeRangeMeta(this.getEffectiveTimeRangeKey(timeRangeKey));
        return Number.isFinite(meta?.days) ? meta.days : null;
      },

      shouldEvaluateForEventType(condition, eventType) {
        if (!eventType) return true;

        const actionKey = normalizeString(condition?.action);
        const actionMeta = this.findActionMeta(actionKey);
        if (!actionMeta?.eventTrigger) return false;

        const normalizedEventType = normalizeString(eventType).toLowerCase();
        if (!normalizedEventType) return true;

        if (actionMeta.fixedFilter) {
          return actionMeta.fixedFilter === normalizedEventType;
        }

        if (actionMeta.needsFilter) {
          const filterKey = normalizeString(condition?.filter || 'all').toLowerCase() || 'all';
          return filterKey === 'all' || filterKey === normalizedEventType;
        }

        return true;
      },
    };
  },

});

App._registerAchievementPart('registry', App._buildAchievementRegistry());
