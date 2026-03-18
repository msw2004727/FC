/* ================================================
   SportHub Achievement Stats Helpers
   Shared derived-state helpers for badge counts,
   earned badge view models, and title options.
   ================================================ */

Object.assign(App, {

  _buildAchievementStats() {
    const getShared = () => App._getAchievementShared?.();
    const normalizeString = (value) => String(value || '').trim();

    const getThreshold = (achievement) => {
      const shared = getShared();
      if (shared?.getThreshold) return shared.getThreshold(achievement);
      if (achievement?.condition?.threshold != null) return achievement.condition.threshold;
      if (achievement?.target != null) return achievement.target;
      return 1;
    };

    const getActiveAchievements = (achievements) => {
      const registry = App._getAchievementRegistry?.();
      return (Array.isArray(achievements) ? achievements : [])
        .filter(achievement => achievement && achievement.status !== 'archived')
        .filter(achievement => registry?.isSupportedCondition?.(achievement.condition) !== false);
    };

    const isCompleted = (achievement) => {
      const registry = App._getAchievementRegistry?.();
      const actionMeta = registry?.findActionMeta?.(achievement?.condition?.action);
      const threshold = Number(getThreshold(achievement));
      // 非 reverseComparison 類型 threshold 至少為 1，防止 threshold=0 導致所有人通過
      const safeThreshold = actionMeta?.reverseComparison ? threshold : Math.max(1, threshold);
      const current = Number(achievement?.current || 0);
      return actionMeta?.reverseComparison
        ? current <= safeThreshold
        : current >= safeThreshold;
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

    const getBadgeCount = (achievements, badges) => {
      return getEarnedBadgeViewModels(achievements, badges).length;
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

    const getParticipantAttendanceStats = ({
      uid,
      registrations,
      attendanceRecords,
      eventMap,
      now = new Date(),
      isEventEnded,
    } = {}) => {
      const safeUid = normalizeString(uid);
      const expectedEventIds = new Set();
      const attendanceStateByEvent = new Map();

      (Array.isArray(registrations) ? registrations : []).forEach(record => {
        if (!record) return;
        const recordUid = normalizeString(record.uid || record.userId || safeUid);
        if (recordUid && safeUid && recordUid !== safeUid) return;
        // registrations 集合用 'confirmed'，activityRecords 集合用 'registered'，兩者都視為有效報名
        const st = normalizeString(record.status);
        if (st !== 'confirmed' && st !== 'registered') return;

        const eventId = normalizeString(record.eventId);
        if (!eventId) return;
        const event = eventMap?.get?.(eventId) || null;
        if (!event) return;

        const ended = typeof isEventEnded === 'function'
          ? isEventEnded(event, now)
          : normalizeString(event.status) === 'ended';
        if (!ended) return;

        expectedEventIds.add(eventId);
      });

      (Array.isArray(attendanceRecords) ? attendanceRecords : []).forEach(record => {
        if (!record) return;
        const recordUid = normalizeString(record.uid);
        if (recordUid !== safeUid) return;
        if (record.companionId || record.participantType === 'companion') return;

        const eventId = normalizeString(record.eventId);
        if (!expectedEventIds.has(eventId)) return;

        const type = normalizeString(record.type);
        if (type !== 'checkin' && type !== 'checkout') return;

        const state = attendanceStateByEvent.get(eventId) || { checkin: false, checkout: false };
        if (type === 'checkin') state.checkin = true;
        if (type === 'checkout') state.checkout = true;
        attendanceStateByEvent.set(eventId, state);
      });

      const attendedEventIds = new Set();
      const completedEventIds = new Set();
      attendanceStateByEvent.forEach((state, eventId) => {
        if (state.checkin) attendedEventIds.add(eventId);
        if (state.checkin && state.checkout) completedEventIds.add(eventId);
      });

      const expectedCount = expectedEventIds.size;
      const attendedCount = attendedEventIds.size;
      const completedCount = completedEventIds.size;
      const attendRate = expectedCount > 0
        ? Math.round((attendedCount / expectedCount) * 100)
        : 0;

      return {
        expectedEventIds,
        attendedEventIds,
        completedEventIds,
        expectedCount,
        attendedCount,
        completedCount,
        attendRate,
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
      getParticipantAttendanceStats,
    };
  },

});

App._registerAchievementPart('stats', App._buildAchievementStats());
