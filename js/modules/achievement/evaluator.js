/* ================================================
   SportHub — Achievement Evaluator
   先抽舊版 evaluator，保持既有外部入口不變
   ================================================ */

Object.assign(App, {

  _buildAchievementEvaluator() {
    const typeToAction = {
      play: 'attend_play',
      friendly: 'attend_friendly',
      camp: 'attend_camp',
      watch: 'attend_watch',
    };

    const resolveTargetUser = ({ targetUid, targetUser }) => {
      if (targetUser) return targetUser;
      const currentUser = ApiService.getCurrentUser?.() || null;
      if (targetUid && currentUser?.uid === targetUid) return currentUser;
      const users = ApiService.getAdminUsers?.() || [];
      return users.find(user => user.uid === targetUid || user._docId === targetUid) || currentUser;
    };

    return {
      evaluateAchievements({ eventType, targetUid, targetUser } = {}) {
        let achievements = ApiService.getAchievements().filter(achievement => achievement.status !== 'archived' && achievement.condition);
        if (!achievements.length) return;

        if (eventType) {
          const directAction = typeToAction[eventType];
          achievements = achievements.filter(achievement => {
            const { action, filter } = achievement.condition;
            if (directAction && action === directAction) return true;
            if ((action === 'register_event' || action === 'complete_event')
                && (!filter || filter === 'all' || filter === eventType)) {
              return true;
            }
            return false;
          });
        }
        if (!achievements.length) return;

        const resolvedUser = resolveTargetUser({ targetUid, targetUser });
        const resolvedUid = targetUid || resolvedUser?.uid;
        if (!resolvedUid) return;

        const shared = App._getAchievementShared?.();
        const allRecords = ApiService.getActivityRecords();
        const events = ApiService.getEvents();
        const eventMap = {};
        events.forEach(event => { eventMap[event.id] = event; });
        const activeRecords = allRecords.filter(record => record.status === 'registered' && record.uid === resolvedUid);

        achievements.forEach(achievement => {
          const { action, threshold, filter } = achievement.condition;
          const target = threshold != null ? threshold : 1;
          let current = 0;

          if (action === 'attend_play' || action === 'attend_friendly'
              || action === 'attend_camp' || action === 'attend_watch') {
            const targetType = {
              attend_play: 'play',
              attend_friendly: 'friendly',
              attend_camp: 'camp',
              attend_watch: 'watch',
            }[action];
            current = activeRecords.filter(record => {
              const recordType = record.eventType || eventMap[record.eventId]?.type;
              return recordType === targetType;
            }).length;
          } else if (action === 'register_event') {
            current = activeRecords.filter(record => {
              if (filter && filter !== 'all') {
                const recordType = record.eventType || eventMap[record.eventId]?.type;
                return recordType === filter;
              }
              return true;
            }).length;
          } else if (action === 'complete_event') {
            current = activeRecords.filter(record => {
              const event = eventMap[record.eventId];
              if (!event || event.status !== 'ended') return false;
              if (filter && filter !== 'all') {
                const recordType = record.eventType || event.type;
                return recordType === filter;
              }
              return true;
            }).length;
          } else if (action === 'join_team') {
            const resolvedName = resolvedUser?.displayName || resolvedUser?.name || '';
            const teamSet = new Set();
            (ApiService.getTeams?.() || []).forEach(team => {
              const isCaptain = resolvedUid && team.captainUid === resolvedUid;
              const isLeader = resolvedUid && team.leaderUid === resolvedUid;
              const isCoach = resolvedName && (team.coaches || []).includes(resolvedName);
              if (isCaptain || isLeader || isCoach) teamSet.add(team.id);
            });
            if (resolvedUser?.teamId) teamSet.add(resolvedUser.teamId);
            current = teamSet.size;
          }

          if (current === achievement.current) return;

          const updates = { current };
          if (current >= target && !achievement.completedAt) {
            const now = new Date();
            updates.completedAt = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
          } else if (current < target) {
            updates.completedAt = null;
          }
          ApiService.updateAchievement(achievement.id, updates);
        });
      },
    };
  },

});

App._registerAchievementPart('evaluator', App._buildAchievementEvaluator());
