/* ================================================
   SportHub — Education: Club Detail Realtime Listeners
   ================================================
   教育型俱樂部 Firestore 即時監聽
   - students subcollection 監聽
   - teams collection 監聽（俱樂部列表頁）
   ================================================ */

Object.assign(App, {

  _eduStudentsUnsub: null,
  _eduTeamsUnsub: null,
  _eduTeamsStudentUnsubs: [],

  // ══════════════════════════════════
  //  即時監聽：students subcollection
  // ══════════════════════════════════

  _startEduStudentsListener(teamId) {
    this._stopEduStudentsListener();
    if (!teamId) return;
    try {
      const ref = firebase.firestore()
        .collection('teams').doc(teamId).collection('students');
      this._eduStudentsUnsub = ref.onSnapshot(
        snapshot => {
          this._eduStudentsCache[teamId] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), _docId: doc.id }));
          const page = this.currentPage;
          // 俱樂部詳情頁：重繪學員區塊 + 分組人數
          if (page === 'page-team-detail' && this._eduDetailTeamId === teamId) {
            this._renderEduMemberSection(teamId);
            this._updateGroupMemberCounts(teamId);
            this.renderEduGroupList(teamId);
          }
          // 分組學員列表頁：即時重繪（快取已更新，直接渲染不需再 fetch）
          if (page === 'page-edu-students' && this._eduCurrentGroupId) {
            this._renderEduStudentListFromCache(teamId, this._eduCurrentGroupId);
          }
          // 俱樂部列表頁：更新卡片人數
          if (page === 'page-teams') {
            this.renderTeamList();
          }
        },
        err => { console.error('[edu-realtime] students listener error:', err); }
      );
    } catch (e) { console.error('[edu-realtime] start failed:', e); }
  },

  _stopEduStudentsListener() {
    if (this._eduStudentsUnsub) {
      this._eduStudentsUnsub();
      this._eduStudentsUnsub = null;
    }
  },

  /**
   * 頁面離開時清理教育監聽器（由 navigation.js 呼叫）
   */
  _cleanupEduListeners() {
    this._stopEduStudentsListener();
    this._stopEduTeamsListener();
    this._eduDetailTeamId = null;
  },

  // ══════════════════════════════════
  //  即時監聽：teams collection（俱樂部列表頁）
  // ══════════════════════════════════

  _startEduTeamsListener() {
    this._stopEduTeamsListener();
    try {
      this._eduTeamsUnsub = firebase.firestore()
        .collection('teams')
        .where('active', '==', true)
        .onSnapshot(
          snapshot => {
            const freshTeams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), _docId: doc.id }));
            const inactiveTeams = (FirebaseService._cache.teams || []).filter(t => !t.active);
            FirebaseService._cache.teams = [...freshTeams, ...inactiveTeams];
            FirebaseService._debouncedPersistCache();
            this._ensureEduTeamsStudentListeners(freshTeams);
            if (this.currentPage === 'page-teams') {
              this.renderTeamList();
            }
          },
          err => { console.error('[edu-realtime] teams listener error:', err); }
        );
    } catch (e) { console.error('[edu-realtime] teams listener start failed:', e); }
  },

  /**
   * 確保每個教育俱樂部有 students listener（不重複建立）
   */
  _ensureEduTeamsStudentListeners(teams) {
    const eduTeams = teams.filter(t => t.type === 'education');
    const existingIds = new Set(this._eduTeamsStudentUnsubs.map(u => u._teamId));

    for (const t of eduTeams) {
      if (existingIds.has(t.id)) continue; // 已有 listener，不重建
      try {
        const teamId = t.id;
        const unsub = firebase.firestore()
          .collection('teams').doc(teamId).collection('students')
          .onSnapshot(
            snap => {
              this._eduStudentsCache[teamId] = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), _docId: doc.id }));
              if (this.currentPage === 'page-teams') {
                this.renderTeamList();
              }
            },
            () => {}
          );
        unsub._teamId = teamId; // 標記用於去重
        this._eduTeamsStudentUnsubs.push(unsub);
      } catch (_) {}
    }
  },

  _stopEduTeamsListener() {
    if (this._eduTeamsUnsub) {
      this._eduTeamsUnsub();
      this._eduTeamsUnsub = null;
    }
    this._eduTeamsStudentUnsubs.forEach(fn => fn());
    this._eduTeamsStudentUnsubs = [];
  },

});
