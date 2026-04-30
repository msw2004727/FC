/* === SportHub — Badge refresh ===
   依賴：event-manage-attendance.js (rendering)
   ================================= */

Object.assign(App, {

  _badgeRefreshCache: {},
  _eventBadgeCache: {},

  async _refreshRegistrationBadges(eventId, containerId) {
    const REFRESH_INTERVAL = 30 * 60 * 1000;
    const lastRefresh = this._badgeRefreshCache[eventId] || 0;
    if (Date.now() - lastRefresh < REFRESH_INTERVAL) return;

    try {
      if (typeof db === 'undefined') return;

      // Step 1：直接查 Firestore 取得該活動所有報名（isAuth 可讀）
      const _eventDocId = await FirebaseService._getEventDocIdAsync(eventId);
      if (!_eventDocId) return;
      const snap = await db.collection('events').doc(_eventDocId)
        .collection('registrations')
        .get();
      const allDocs = snap.docs.map(d => FirebaseService._mapSubcollectionDoc(d, 'registrations'));
      const confirmedSelf = allDocs.filter(
        r => r.status === 'confirmed'
          && (r.participantType === 'self' || !r.participantType)
      );
      if (!confirmedSelf.length) {
        this._badgeRefreshCache[eventId] = Date.now();
        return;
      }

      // Step 2：從 docs 提取已有的 displayBadges → 建立 badge map
      // 同時用 userId 和 userName 做 key（fallback 路徑可能用名字查找）
      const badgeMap = {};
      confirmedSelf.forEach(r => {
        const uid = String(r.userId || '').trim();
        const name = String(r.userName || '').trim();
        if (!Array.isArray(r.displayBadges) || !r.displayBadges.length) return;
        if (uid) badgeMap[uid] = r.displayBadges;
        if (name && name !== uid) badgeMap[name] = r.displayBadges;
      });

      // Step 3：管理員額外做即時計算（有完整資料可評估其他用戶成就）
      if (this.hasPermission('event.edit_all')) {
        let ab = this._getAchievementBadges?.();
        if (!ab) {
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 500));
            ab = this._getAchievementBadges?.();
            if (ab) break;
          }
        }
        const evaluator = this._getAchievementEvaluator?.();
        const allBadges = ApiService.getBadges?.() || [];

        if (ab?.getEarnedBadgeViewModels && evaluator?.getEvaluatedAchievements && allBadges.length) {
          for (const reg of confirmedSelf) {
            const uid = String(reg.userId || '').trim();
            if (!uid) continue;
            let achievements;
            try {
              achievements = evaluator.getEvaluatedAchievements({ targetUid: uid });
            } catch (_) { continue; }
            if (!achievements || !achievements.length) continue;

            const earned = ab.getEarnedBadgeViewModels(achievements, allBadges);
            const newBadges = earned.map(item => ({
              id: item.badge?.id || '',
              name: item.badge?.name || '',
              image: item.badge?.image || '',
            })).filter(b => b.image);

            const oldBadges = reg.displayBadges || [];
            const oldIds = oldBadges.map(b => b.id).sort().join(',');
            const newIds = newBadges.map(b => b.id).sort().join(',');
            if (oldIds === newIds) {
              if (oldBadges.length) {
                badgeMap[uid] = oldBadges;
                const rn = String(reg.userName || '').trim();
                if (rn && rn !== uid) badgeMap[rn] = oldBadges;
              }
              continue;
            }
            if (!newBadges.length && oldBadges.length) {
              badgeMap[uid] = oldBadges;
              const rn = String(reg.userName || '').trim();
              if (rn && rn !== uid) badgeMap[rn] = oldBadges;
              continue;
            }

            try {
              if (reg._docId) {
                await db.collection('events').doc(_eventDocId).collection('registrations').doc(reg._docId).update({ displayBadges: newBadges });
              }
              badgeMap[uid] = newBadges;
              const rName = String(reg.userName || '').trim();
              if (rName && rName !== uid) badgeMap[rName] = newBadges;
            } catch (err) {
              console.warn('[Badges] update failed for', uid, err);
              if (oldBadges.length) badgeMap[uid] = oldBadges;
            }
          }
        }
      }

      // Step 4：存入 badge cache + 重新渲染表格
      this._eventBadgeCache[eventId] = badgeMap;
      this._badgeRefreshCache[eventId] = Date.now();
      this._renderAttendanceTable(eventId, containerId || 'detail-attendance-table');
    } catch (err) {
      console.warn('[Badges] refresh failed:', err);
    }
  },

});
