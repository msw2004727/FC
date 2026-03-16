/* ================================================
   SportHub Achievement Evaluator
   Uses registry-driven handlers while keeping the
   legacy App._evaluateAchievements() facade stable.
   ================================================ */

Object.assign(App, {

  _buildAchievementEvaluator() {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const PROFILE_REQUIRED_FIELDS = ['gender', 'birthday', 'region', 'phone'];

    const normalizeString = (value) => String(value || '').trim();
    const normalizeLower = (value) => normalizeString(value).toLowerCase();
    const toFiniteNumber = (value, fallback = 0) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    const parseDateValue = (value) => {
      if (!value) return null;

      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
      }

      if (typeof value?.toDate === 'function') {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
      }

      if (typeof value?.seconds === 'number') {
        const ms = (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date;
      }

      if (typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
      }

      if (typeof value !== 'string') return null;

      const raw = value.trim();
      if (!raw) return null;

      let match = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
      if (match) {
        const date = new Date(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4] || 0),
          Number(match[5] || 0),
          Number(match[6] || 0)
        );
        return Number.isNaN(date.getTime()) ? null : date;
      }

      match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
      if (match) {
        const date = new Date(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4] || 0),
          Number(match[5] || 0),
          Number(match[6] || 0)
        );
        return Number.isNaN(date.getTime()) ? null : date;
      }

      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const parseEventStartDate = (event) => {
      const raw = typeof event === 'string' ? event : event?.date;
      if (!raw) return null;

      if (typeof App._parseEventStartDate === 'function') {
        try {
          const parsed = App._parseEventStartDate(raw);
          if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) return parsed;
        } catch (_) {}
      }

      return parseDateValue(raw);
    };

    const parseEventEndDate = (event) => {
      if (!event?.date) return parseEventStartDate(event);

      if (typeof App._parseEventEndDate === 'function') {
        try {
          const parsed = App._parseEventEndDate(event.date);
          if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) return parsed;
        } catch (_) {}
      }

      return parseEventStartDate(event);
    };

    const getEventStatus = (event, now) => {
      if (!event) return '';

      if (typeof App._getEventEffectiveStatus === 'function') {
        try {
          const effective = App._getEventEffectiveStatus(event, now);
          if (effective) return effective;
        } catch (_) {}
      }

      const rawStatus = normalizeString(event.status);
      if (rawStatus) return rawStatus;

      const start = parseEventStartDate(event);
      if (start && start <= now) return 'ended';
      return '';
    };

    const isEventEnded = (event, now) => getEventStatus(event, now) === 'ended';

    const maxDate = (a, b) => {
      if (!a) return b || null;
      if (!b) return a || null;
      return a.getTime() >= b.getTime() ? a : b;
    };

    const formatCompletedDate = (date) => {
      const d = date instanceof Date ? date : new Date();
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    };

    const normalizeCurrentValue = (value) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return 0;
      if (num <= 0) return 0;
      return Math.round(num);
    };

    const isSelfParticipantRecord = (record, uid) => {
      if (!record) return false;
      const recordUid = normalizeString(record.userId || record.uid);
      if (!recordUid || recordUid !== normalizeString(uid)) return false;
      if (record.companionId || record.participantType === 'companion') return false;
      return true;
    };

    const buildEventMap = (events) => {
      const map = new Map();
      (events || []).forEach(event => {
        const eventId = normalizeString(event?.id || event?._docId);
        if (!eventId) return;
        map.set(eventId, event);
      });
      return map;
    };

    const buildSelfRegistrationsFromRegistrations = (registrations, uid, eventMap) => {
      const byEvent = new Map();

      (registrations || []).forEach(record => {
        if (!isSelfParticipantRecord(record, uid)) return;

        const status = normalizeString(record.status);
        if (!status || status === 'cancelled' || status === 'removed') return;

        const eventId = normalizeString(record.eventId);
        if (!eventId) return;

        const event = eventMap.get(eventId) || null;
        const nextRecord = {
          eventId,
          status,
          eventType: normalizeLower(record.eventType || event?.type),
          createdAt: parseDateValue(record.createdAt),
        };

        const current = byEvent.get(eventId);
        const currentScore = current?.status === 'registered' ? 2 : current?.status === 'waitlisted' ? 1 : 0;
        const nextScore = nextRecord.status === 'registered' ? 2 : nextRecord.status === 'waitlisted' ? 1 : 0;
        if (!current || nextScore > currentScore) {
          byEvent.set(eventId, nextRecord);
          return;
        }
        if (nextScore === currentScore && nextRecord.createdAt && (!current.createdAt || nextRecord.createdAt > current.createdAt)) {
          byEvent.set(eventId, nextRecord);
        }
      });

      return [...byEvent.values()];
    };

    const buildSelfRegistrationsFromActivityRecords = (activityRecords, uid, eventMap) => {
      const byEvent = new Map();

      (activityRecords || []).forEach((record, index) => {
        if (!record) return;
        if (normalizeString(record.uid) !== normalizeString(uid)) return;
        if (record.companionId || record.participantType === 'companion') return;

        const status = normalizeString(record.status);
        if (!['registered', 'waitlisted', 'cancelled', 'removed'].includes(status)) return;

        const eventId = normalizeString(record.eventId);
        if (!eventId) return;

        const event = eventMap.get(eventId) || null;
        const nextRecord = {
          eventId,
          status,
          eventType: normalizeLower(record.eventType || event?.type),
          createdAt: parseDateValue(record.createdAt),
          _order: index,
        };

        const current = byEvent.get(eventId);
        const currentTime = current?.createdAt?.getTime?.() ?? Number.NEGATIVE_INFINITY;
        const nextTime = nextRecord.createdAt?.getTime?.() ?? Number.NEGATIVE_INFINITY;
        const hasNewerTimestamp = nextTime > currentTime;
        const sameTimestamp = nextTime === currentTime;

        if (!current || hasNewerTimestamp || (sameTimestamp && nextRecord._order >= current._order)) {
          byEvent.set(eventId, nextRecord);
        }
      });

      return [...byEvent.values()]
        .filter(record => record.status === 'registered' || record.status === 'waitlisted')
        .map(({ _order, ...record }) => record);
    };

    const buildAttendanceStateByEvent = (attendanceRecords, uid) => {
      const stateMap = new Map();

      (attendanceRecords || []).forEach(record => {
        if (!record) return;
        if (normalizeString(record.uid) !== normalizeString(uid)) return;
        if (record.companionId || record.participantType === 'companion') return;

        const eventId = normalizeString(record.eventId);
        if (!eventId) return;

        const type = normalizeString(record.type);
        if (type !== 'checkin' && type !== 'checkout') return;

        const state = stateMap.get(eventId) || {
          checkin: false,
          checkout: false,
          checkinAt: null,
          checkoutAt: null,
        };
        const recordDate = parseDateValue(record.time) || parseDateValue(record.createdAt);

        if (type === 'checkin') {
          state.checkin = true;
          state.checkinAt = maxDate(state.checkinAt, recordDate);
        }
        if (type === 'checkout') {
          state.checkout = true;
          state.checkoutAt = maxDate(state.checkoutAt, recordDate);
        }

        stateMap.set(eventId, state);
      });

      return stateMap;
    };

    const resolveTargetUser = ({ targetUid, targetUser }) => {
      if (targetUser) return targetUser;

      const safeTargetUid = normalizeString(targetUid);
      const currentUser = ApiService.getCurrentUser?.() || null;
      if (safeTargetUid && currentUser && normalizeString(currentUser.uid || currentUser._docId) === safeTargetUid) {
        return currentUser;
      }

      const users = ApiService.getAdminUsers?.() || [];
      const matchedUser = users.find(user => {
        const uid = normalizeString(user?.uid);
        const docId = normalizeString(user?._docId);
        return (safeTargetUid && uid === safeTargetUid) || (safeTargetUid && docId === safeTargetUid);
      });

      if (matchedUser) return matchedUser;
      if (safeTargetUid) return { uid: safeTargetUid };
      return currentUser;
    };

    const getResolvedUserTeamIds = (user) => {
      if (!user) return [];

      if (typeof App._getUserTeamIds === 'function') {
        try {
          const teamIds = App._getUserTeamIds(user);
          if (Array.isArray(teamIds)) {
            return teamIds.map(id => normalizeString(id)).filter(Boolean);
          }
        } catch (_) {}
      }

      const ids = [];
      const seen = new Set();
      const pushId = (id) => {
        const value = normalizeString(id);
        if (!value || seen.has(value)) return;
        seen.add(value);
        ids.push(value);
      };

      if (Array.isArray(user.teamIds)) user.teamIds.forEach(pushId);
      pushId(user.teamId);
      return ids;
    };

    const getUserNameSet = (user) => {
      const set = new Set();
      [user?.displayName, user?.name].forEach(name => {
        const value = normalizeLower(name);
        if (value) set.add(value);
      });
      return set;
    };

    const getUserIdentitySet = (user) => {
      const set = new Set();
      [user?.uid, user?._docId].forEach(value => {
        const normalized = normalizeString(value);
        if (normalized) set.add(normalized);
      });
      return set;
    };

    const matchesEventFilter = (condition, eventType, actionMeta) => {
      const normalizedEventType = normalizeLower(eventType);
      if (!normalizedEventType) return !actionMeta?.fixedFilter && (!condition?.filter || condition.filter === 'all');
      if (actionMeta?.fixedFilter) return actionMeta.fixedFilter === normalizedEventType;
      const filterKey = normalizeLower(condition?.filter || 'all');
      return !filterKey || filterKey === 'all' || filterKey === normalizedEventType;
    };

    const isWithinConditionWindow = (condition, date, registry, now) => {
      const effectiveKey = registry?.getEffectiveTimeRangeKey?.(condition?.timeRange) || 'none';
      if (effectiveKey === 'none') return true;

      const days = registry?.getTimeRangeDays?.(effectiveKey);
      if (!Number.isFinite(days) || days <= 0) return true;

      const parsedDate = date instanceof Date ? date : parseDateValue(date);
      if (!parsedDate) return false;

      const threshold = new Date(now.getTime() - (days * DAY_MS));
      return parsedDate >= threshold && parsedDate <= now;
    };

    const buildEvaluationContext = ({ targetUid, targetUser, registry }) => {
      const resolvedUser = resolveTargetUser({ targetUid, targetUser });
      const resolvedUid = normalizeString(targetUid || resolvedUser?.uid || resolvedUser?._docId);
      if (!resolvedUid) return null;

      const now = new Date();
      const events = ApiService.getEvents?.() || [];
      const eventMap = buildEventMap(events);
      const registrations = ApiService.getRegistrationsByUser?.(resolvedUid) || [];
      const activityRecords = ApiService.getActivityRecords?.(resolvedUid) || [];
      const selfRegistrations = buildSelfRegistrationsFromRegistrations(registrations, resolvedUid, eventMap);
      const fallbackRegistrations = selfRegistrations.length
        ? selfRegistrations
        : buildSelfRegistrationsFromActivityRecords(activityRecords, resolvedUid, eventMap);
      const validRegistrations = fallbackRegistrations.filter(record => record.status === 'registered');
      const attendanceRecords = ApiService.getAttendanceRecords?.() || [];
      const attendanceStateByEvent = buildAttendanceStateByEvent(attendanceRecords, resolvedUid);

      return {
        now,
        registry,
        resolvedUid,
        resolvedUser,
        events,
        eventMap,
        teams: ApiService.getTeams?.() || [],
        registrations: fallbackRegistrations,
        validRegistrations,
        attendanceRecords,
        attendanceStateByEvent,
      };
    };

    const getRegistrationWindowDate = ({ record, event }) => {
      return record?.createdAt || parseDateValue(event?.createdAt) || parseEventStartDate(event);
    };

    const getAttendanceWindowDate = ({ attendanceState, event }) => {
      return attendanceState?.checkoutAt || attendanceState?.checkinAt || parseEventEndDate(event) || parseEventStartDate(event);
    };

    const getOrganizeWindowDate = (event) => {
      return parseDateValue(event?.createdAt) || parseEventStartDate(event);
    };

    const countFilteredRegistrations = ({ condition, actionMeta, validRegistrations, eventMap, registry, now }) => {
      return validRegistrations.filter(record => {
        const event = eventMap.get(record.eventId) || null;
        const eventType = record.eventType || normalizeLower(event?.type);
        if (!matchesEventFilter(condition, eventType, actionMeta)) return false;
        return isWithinConditionWindow(condition, getRegistrationWindowDate({ record, event }), registry, now);
      }).length;
    };

    const countCompletedEvents = ({ condition, actionMeta, validRegistrations, eventMap, attendanceStateByEvent, registry, now }) => {
      return validRegistrations.filter(record => {
        const event = eventMap.get(record.eventId) || null;
        if (!event || !isEventEnded(event, now)) return false;
        const eventType = record.eventType || normalizeLower(event?.type);
        if (!matchesEventFilter(condition, eventType, actionMeta)) return false;

        const attendanceState = attendanceStateByEvent.get(record.eventId);
        if (!attendanceState?.checkin || !attendanceState?.checkout) return false;
        return isWithinConditionWindow(condition, getAttendanceWindowDate({ attendanceState, event }), registry, now);
      }).length;
    };

    const countAttendedEvents = ({ condition, actionMeta, validRegistrations, eventMap, attendanceStateByEvent, registry, now }) => {
      return validRegistrations.filter(record => {
        const event = eventMap.get(record.eventId) || null;
        const eventType = record.eventType || normalizeLower(event?.type);
        if (!matchesEventFilter(condition, eventType, actionMeta)) return false;

        const attendanceState = attendanceStateByEvent.get(record.eventId);
        if (!attendanceState?.checkin) return false;
        return isWithinConditionWindow(condition, getAttendanceWindowDate({ attendanceState, event }), registry, now);
      }).length;
    };

    const computeAttendanceRate = ({ condition, validRegistrations, eventMap, attendanceRecords, attendanceStateByEvent, registry, now, resolvedUid }) => {
      const stats = App._getAchievementStats?.();
      const result = stats?.getParticipantAttendanceStats?.({
        uid: resolvedUid,
        registrations: validRegistrations.map(record => ({ ...record, uid: resolvedUid })),
        attendanceRecords,
        eventMap,
        now,
        isEventEnded,
      });

      if (!result || !result.expectedCount) return 0;

      const filteredExpected = [...result.expectedEventIds].filter(eventId => {
        const event = eventMap.get(eventId) || null;
        return isWithinConditionWindow(condition, parseEventEndDate(event) || parseEventStartDate(event), registry, now);
      });
      if (!filteredExpected.length) return 0;

      const attendedCount = filteredExpected.filter(eventId => attendanceStateByEvent.get(eventId)?.checkin).length;
      return Math.round((attendedCount / filteredExpected.length) * 100);
    };

    const countOrganizedEvents = ({ condition, actionMeta, events, resolvedUser, registry, now }) => {
      const identitySet = getUserIdentitySet(resolvedUser);
      const nameSet = getUserNameSet(resolvedUser);

      return (events || []).filter(event => {
        if (!event) return false;

        const eventType = normalizeLower(event.type);
        if (!matchesEventFilter(condition, eventType, actionMeta)) return false;
        if (!isWithinConditionWindow(condition, getOrganizeWindowDate(event), registry, now)) return false;

        const delegateUids = Array.isArray(event.delegateUids) ? event.delegateUids.map(normalizeString).filter(Boolean) : [];
        const delegates = Array.isArray(event.delegates) ? event.delegates : [];
        const delegateNames = delegates
          .map(delegate => normalizeLower(delegate?.displayName || delegate?.name))
          .filter(Boolean);
        const delegateUidSet = new Set([
          ...delegateUids,
          ...delegates.map(delegate => normalizeString(delegate?.uid)).filter(Boolean),
        ]);

        const ownerUid = normalizeString(event.ownerUid || event.creatorUid);
        const organizerNames = new Set([
          normalizeLower(event.creator),
          normalizeLower(event.creatorName),
          normalizeLower(event.ownerName),
          normalizeLower(event.organizer),
          normalizeLower(event.organizerDisplay),
        ].filter(Boolean));

        if (ownerUid && identitySet.has(ownerUid)) return true;
        if ([...delegateUidSet].some(uid => identitySet.has(uid))) return true;
        if (delegateNames.some(name => nameSet.has(name))) return true;
        if ([...organizerNames].some(name => nameSet.has(name))) return true;

        return false;
      }).length;
    };

    const countJoinedTeams = ({ resolvedUser, resolvedUid, teams }) => {
      const nameSet = getUserNameSet(resolvedUser);
      const teamSet = new Set(getResolvedUserTeamIds(resolvedUser));

      (teams || []).forEach(team => {
        if (!team) return;

        const teamId = normalizeString(team.id || team._docId);
        const captainUid = normalizeString(team.captainUid);
        const leaderUid = normalizeString(team.leaderUid);
        const captainName = normalizeLower(team.captain);
        const leaderName = normalizeLower(team.leader);
        const coachNames = Array.isArray(team.coaches) ? team.coaches.map(normalizeLower).filter(Boolean) : [];

        if (captainUid === resolvedUid || leaderUid === resolvedUid) {
          if (teamId) teamSet.add(teamId);
          return;
        }
        if ((captainName && nameSet.has(captainName)) || (leaderName && nameSet.has(leaderName))) {
          if (teamId) teamSet.add(teamId);
          return;
        }
        if (coachNames.some(name => nameSet.has(name))) {
          if (teamId) teamSet.add(teamId);
        }
      });

      return teamSet.size;
    };

    const resolveUserLevel = (user) => {
      const directLevel = Number(user?.level);
      if (Number.isFinite(directLevel)) return directLevel;

      if (typeof App._calcLevelFromExp === 'function') {
        try {
          const result = App._calcLevelFromExp(toFiniteNumber(user?.exp, 0));
          const fallbackLevel = Number(result?.level);
          return Number.isFinite(fallbackLevel) ? fallbackLevel : 0;
        } catch (_) {}
      }

      return 0;
    };

    const hasCompletedProfile = (user) => PROFILE_REQUIRED_FIELDS.every(field => normalizeString(user?.[field]));

    const getDaysRegistered = (user, now) => {
      const createdAt = parseDateValue(user?.createdAt);
      if (!createdAt) return 0;
      return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS));
    };

    const actionHandlers = {
      register_event(context) {
        return countFilteredRegistrations(context);
      },

      complete_event(context) {
        return countCompletedEvents(context);
      },

      organize_event(context) {
        return countOrganizedEvents(context);
      },

      attend_event(context) {
        return countAttendedEvents(context);
      },

      attendance_rate(context) {
        return computeAttendanceRate(context);
      },

      reach_level({ resolvedUser }) {
        return resolveUserLevel(resolvedUser);
      },

      reach_exp({ resolvedUser }) {
        return toFiniteNumber(resolvedUser?.exp, 0);
      },

      join_team({ achievement, resolvedUser, resolvedUid, teams }) {
        const joinedTeams = countJoinedTeams({ resolvedUser, resolvedUid, teams });
        if (joinedTeams > 0) return joinedTeams;
        return normalizeCurrentValue(achievement?.current || 0);
      },

      complete_profile({ resolvedUser }) {
        return hasCompletedProfile(resolvedUser) ? 1 : 0;
      },

      bind_line_notify({ resolvedUser }) {
        return resolvedUser?.lineNotify?.bound === true ? 1 : 0;
      },

      days_registered({ resolvedUser, now }) {
        return getDaysRegistered(resolvedUser, now);
      },
    };

    const evaluateAchievementRecord = ({ achievement, registry, context, eventType }) => {
      const cloned = achievement ? { ...achievement } : achievement;
      if (!achievement?.condition || !registry || !context) return cloned;
      if (achievement.status === 'archived') return cloned;
      if (eventType && registry?.shouldEvaluateForEventType && !registry.shouldEvaluateForEventType(achievement.condition, eventType)) {
        return cloned;
      }

      const condition = achievement.condition || {};
      const actionKey = normalizeString(condition.action);
      const actionMeta = registry?.findActionMeta?.(actionKey);
      const handler = actionMeta?.handlerKey ? actionHandlers[actionMeta.handlerKey] : null;

      if (!registry?.isSupportedCondition?.(condition)) return cloned;
      if (!actionMeta?.supported || typeof handler !== 'function') return cloned;

      let current = 0;
      try {
        current = normalizeCurrentValue(handler({
          ...context,
          achievement,
          condition,
          actionMeta,
        }));
      } catch (err) {
        console.warn('[AchievementEvaluator] evaluate failed:', actionKey, achievement?.id, err);
        return cloned;
      }

      const target = condition.threshold != null ? toFiniteNumber(condition.threshold, 1) : 1;
      const shouldComplete = current >= target;
      const nextCompletedAt = shouldComplete
        ? (achievement.completedAt || formatCompletedDate(context.now))
        : null;

      return {
        ...achievement,
        current,
        completedAt: nextCompletedAt,
      };
    };

    const getEvaluatedAchievements = ({ eventType, targetUid, targetUser, achievements } = {}) => {
      const registry = App._getAchievementRegistry?.();
      const source = Array.isArray(achievements)
        ? achievements.filter(Boolean)
        : (ApiService.getAchievements?.() || []).filter(Boolean);
      if (!source.length) return [];

      const context = buildEvaluationContext({ targetUid, targetUser, registry });
      if (!context) return source.map(achievement => ({ ...achievement }));

      // Phase 2：嘗試讀取 per-user 進度（僅當前用戶）
      const currentUser = ApiService.getCurrentUser?.() || null;
      const currentUid = normalizeString(currentUser?.uid || currentUser?._docId);
      const resolvedUid = normalizeString(targetUid || currentUid);
      const isCurrentUser = resolvedUid && resolvedUid === currentUid;
      const perUserMap = isCurrentUser
        && typeof FirebaseService !== 'undefined'
        && typeof FirebaseService.getUserAchievementProgressMap === 'function'
        ? FirebaseService.getUserAchievementProgressMap()
        : null;

      return source.map(achievement => {
        // 如果 per-user 有已完成記錄，直接採用（跳過重算）
        if (perUserMap) {
          const achId = normalizeString(achievement?.id);
          const perUser = achId ? perUserMap.get(achId) : null;
          if (perUser && perUser.completedAt) {
            return {
              ...achievement,
              current: perUser.current || 0,
              completedAt: perUser.completedAt,
            };
          }
        }
        // Fallback：即時計算（與改版前行為一致）
        return evaluateAchievementRecord({
          achievement,
          registry,
          context,
          eventType,
        });
      });
    };

    return {
      getEvaluatedAchievements,

      evaluateAchievements({ eventType, targetUid, targetUser } = {}) {
        const originalAchievements = (ApiService.getAchievements?.() || [])
          .filter(achievement => achievement && achievement.status !== 'archived' && achievement.condition);
        if (!originalAchievements.length) return;

        const evaluatedAchievements = getEvaluatedAchievements({
          eventType,
          targetUid,
          targetUser,
          achievements: originalAchievements,
        });
        const evaluatedById = new Map(
          evaluatedAchievements
            .map(achievement => [normalizeString(achievement?.id), achievement])
            .filter(([id]) => id)
        );

        // 解析當前用戶 UID（僅寫入自己的子集合）
        const currentUser = ApiService.getCurrentUser?.() || null;
        const currentUid = normalizeString(currentUser?.uid || currentUser?._docId);
        const safeTargetUid = normalizeString(targetUid || currentUid);
        // 安全防線：只允許寫入自己的子集合
        const canWritePerUser = safeTargetUid && safeTargetUid === currentUid
          && typeof FirebaseService !== 'undefined'
          && typeof FirebaseService.saveUserAchievementProgress === 'function';

        originalAchievements.forEach(achievement => {
          const evaluated = evaluatedById.get(normalizeString(achievement.id));
          if (!evaluated) return;
          if ((evaluated.current || 0) === (achievement.current || 0)
            && (evaluated.completedAt || null) === (achievement.completedAt || null)) {
            return;
          }

          const progressData = {
            current: evaluated.current || 0,
            completedAt: evaluated.completedAt || null,
          };

          // 寫入 per-user 子集合 + 更新記憶體快取
          if (canWritePerUser) {
            FirebaseService.saveUserAchievementProgress(safeTargetUid, achievement.id, progressData);
            // 即時更新記憶體快取，讓同 session 的 getEvaluatedAchievements 可讀
            const progressArr = FirebaseService._userAchievementProgress || [];
            const idx = progressArr.findIndex(r => (r.achId || r._docId) === achievement.id);
            const entry = { achId: achievement.id, current: progressData.current, completedAt: progressData.completedAt, _docId: achievement.id };
            if (idx >= 0) { progressArr[idx] = entry; } else { progressArr.push(entry); }
          }
        });
      },
    };
  },

});

App._registerAchievementPart('evaluator', App._buildAchievementEvaluator());
