/* ================================================
   SportHub — Education: Club Detail Page Rendering
   ================================================
   教育型俱樂部詳情頁渲染（分組、課程、簽到入口）
   + 學員 subcollection 即時監聽
   ================================================ */

Object.assign(App, {

  _eduDetailTeamId: null,
  _eduStudentsUnsub: null,

  /**
   * 為教育型俱樂部建構詳情頁 body HTML
   */
  async renderEduClubDetail(teamId) {
    const bodyEl = document.getElementById('team-detail-body');
    if (!bodyEl) return;

    const team = ApiService.getTeam(teamId);
    if (!team) return;

    this._eduDetailTeamId = teamId;
    const isStaff = this.isEduClubStaff(teamId);
    const curUser = ApiService.getCurrentUser();

    // ★ 先載入學員快取，確保後續判斷正確
    await this._loadEduStudents(teamId);

    // ★ 啟動即時監聽
    this._startEduStudentsListener(teamId);

    // ── 基本資訊卡 ──
    const infoCard = '<div class="td-card">'
      + '<div class="td-card-title">俱樂部資訊</div>'
      + '<div class="td-card-grid">'
      + '<div class="td-card-item"><span class="td-card-label">類型</span><span class="td-card-value"><span class="edu-type-badge">教學</span></span></div>'
      + '<div class="td-card-item"><span class="td-card-label">俱樂部經理</span><span class="td-card-value">' + (team.captain ? this._userTag(team.captain, 'captain') : '未設定') + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">教練</span><span class="td-card-value">' + ((team.coaches || []).length > 0 ? team.coaches.map(c => this._userTag(c, 'coach')).join(' ') : '無') + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">地區</span><span class="td-card-value">' + escapeHTML(team.region || '') + '</span></div>'
      + (team.contact ? '<div class="td-card-item"><span class="td-card-label">聯繫方式</span><span class="td-card-value">' + escapeHTML(team.contact) + '</span></div>' : '')
      + (team.eduSettings && team.eduSettings.acceptingStudents !== false ? '<div class="td-card-item"><span class="td-card-label">招生狀態</span><span class="td-card-value" style="color:var(--success)">招生中</span></div>' : '<div class="td-card-item"><span class="td-card-label">招生狀態</span><span class="td-card-value" style="color:var(--text-muted)">暫停招生</span></div>')
      + '</div></div>';

    const bioCard = team.bio ? '<div class="td-card"><div class="td-card-title" style="text-align:center">簡介</div><div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word">' + escapeHTML(team.bio) + '</div></div>' : '';

    // ── 分組卡 ──
    const groupSection = '<div class="td-card">'
      + '<div class="td-card-title td-card-title-row">'
      + '<span>分組</span>'
      + (isStaff ? '<button class="primary-btn small" onclick="App.showEduGroupForm(\'' + teamId + '\')">＋ 新增</button>' : '')
      + '</div>'
      + '<div id="edu-group-list"></div>'
      + '</div>';

    // ── 簽到入口（幹部專用）──
    const checkinSection = isStaff ? '<div class="td-card">'
      + '<div class="td-card-title">簽到</div>'
      + '<div style="display:flex;gap:.5rem;flex-wrap:wrap">'
      + '<button class="primary-btn" onclick="App.showEduCheckin(\'' + teamId + '\')">批次簽到</button>'
      + '<button class="outline-btn" onclick="App.showEduCheckinScan(\'' + teamId + '\')">掃碼簽到</button>'
      + '</div></div>' : '';

    // ── 課程方案（所有人可見，幹部可編輯）──
    const courseSection = '<div class="td-card">'
      + '<div class="td-card-title td-card-title-row">'
      + '<span>課程方案</span>'
      + (isStaff ? '<button class="primary-btn small" onclick="App.showEduCoursePlanForm(\'' + teamId + '\')">＋ 新增</button>' : '')
      + '</div>'
      + '<div id="edu-course-plan-list"></div>'
      + '</div>';

    // ── 學員狀態區塊（非幹部用，即時渲染目標）──
    const memberSection = '<div id="edu-member-section"></div>';

    bodyEl.innerHTML = infoCard + bioCard + groupSection + courseSection + checkinSection + memberSection;

    // 渲染學員區塊
    this._renderEduMemberSection(teamId);

    // 載入分組列表
    await this.renderEduGroupList(teamId);
    // 載入課程方案
    if (typeof this.renderEduCoursePlanList === 'function') {
      await this.renderEduCoursePlanList(teamId, isStaff);
    }
  },

  /**
   * 渲染「我的學員」區塊（可獨立重繪，供即時監聽呼叫）
   */
  _renderEduMemberSection(teamId) {
    const container = document.getElementById('edu-member-section');
    if (!container) return;

    const isStaff = this.isEduClubStaff(teamId);
    if (isStaff) { container.innerHTML = ''; return; }

    const curUser = ApiService.getCurrentUser();
    const myStudents = this._getMyEduStudents(teamId, curUser);
    const hasActive = myStudents.some(s => s.enrollStatus === 'active');
    const hasPending = myStudents.some(s => s.enrollStatus === 'pending');

    if (myStudents.length === 0) {
      container.innerHTML = '<div class="td-card" style="padding:.6rem .8rem">'
        + '<button class="primary-btn" style="width:100%" onclick="App.showEduStudentApply(\'' + teamId + '\')">申請加入（本人/代理）</button>'
        + '</div>';
      return;
    }

    let html = '<div class="td-card">'
      + '<div class="td-card-title">我的學員</div>';

    html += myStudents.map(s => {
      const age = this.calcAge(s.birthday);
      const ageLabel = age != null ? age + ' 歲' : '';
      const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
      const genderClass = s.gender === 'male' ? ' edu-gender-male' : s.gender === 'female' ? ' edu-gender-female' : '';
      const isPending = s.enrollStatus === 'pending';
      const statusHtml = isPending
        ? '<span class="edu-status-pending">待審核</span>'
        : '<span class="edu-status-active">已通過</span>';
      const groupHtml = (s.groupNames && s.groupNames.length)
        ? '<div class="edu-student-groups">' + s.groupNames.map(n => '<span class="edu-group-tag">' + escapeHTML(n) + '</span>').join('') + '</div>'
        : '';
      // 已通過的學員：卡片內顯示「出席紀錄」按鈕
      const calendarBtn = (!isPending)
        ? '<div style="margin-top:.3rem"><button class="outline-btn small" onclick="App.showEduCalendar(\'' + teamId + '\',\'' + s.id + '\')">出席紀錄</button></div>'
        : '';

      return '<div class="edu-student-card">'
        + '<div class="edu-student-header">'
        + '<span class="edu-student-name">' + escapeHTML(s.name) + '</span>'
        + (genderIcon ? '<span class="edu-student-gender' + genderClass + '">' + genderIcon + '</span>' : '')
        + (ageLabel ? '<span class="edu-student-age">' + ageLabel + '</span>' : '')
        + statusHtml
        + '</div>'
        + groupHtml
        + calendarBtn
        + '</div>';
    }).join('');

    // 追加學員按鈕（有任一 active 時顯示）
    if (hasActive) {
      html += '<div style="margin-top:.5rem">'
        + '<button class="primary-btn" onclick="App.showEduStudentApply(\'' + teamId + '\')">追加學員</button>'
        + '</div>';
    } else if (hasPending) {
      html += '<div style="margin-top:.4rem;font-size:.78rem;color:var(--text-muted)">申請審核中，請等待教練審核</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  },

  // ══════════════════════════════════
  //  即時監聽：students subcollection
  // ══════════════════════════════════

  _startEduStudentsListener(teamId) {
    this._stopEduStudentsListener();
    if (!teamId || ModeManager.isDemo()) return;
    try {
      const ref = firebase.firestore()
        .collection('teams').doc(teamId).collection('students');
      this._eduStudentsUnsub = ref.onSnapshot(
        snapshot => {
          this._eduStudentsCache[teamId] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), _docId: doc.id }));
          if (this.currentPage === 'page-team-detail' && this._eduDetailTeamId === teamId) {
            this._renderEduMemberSection(teamId);
            this._updateGroupMemberCounts(teamId);
            this.renderEduGroupList(teamId);
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

  _eduTeamsUnsub: null,

  _startEduTeamsListener() {
    this._stopEduTeamsListener();
    if (ModeManager.isDemo()) return;
    try {
      this._eduTeamsUnsub = firebase.firestore()
        .collection('teams')
        .where('active', '==', true)
        .onSnapshot(
          snapshot => {
            const freshTeams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), _docId: doc.id }));
            // 合併：替換 active teams，保留 inactive（若有）
            const inactiveTeams = (FirebaseService._cache.teams || []).filter(t => !t.active);
            FirebaseService._cache.teams = [...freshTeams, ...inactiveTeams];
            FirebaseService._debouncedPersistCache();
            if (this.currentPage === 'page-teams') {
              this.renderTeamList();
            }
          },
          err => { console.error('[edu-realtime] teams listener error:', err); }
        );
    } catch (e) { console.error('[edu-realtime] teams listener start failed:', e); }
  },

  _stopEduTeamsListener() {
    if (this._eduTeamsUnsub) {
      this._eduTeamsUnsub();
      this._eduTeamsUnsub = null;
    }
  },

  // ══════════════════════════════════
  //  Helpers
  // ══════════════════════════════════

  _getMyEduStudents(teamId, curUser) {
    if (!curUser) return [];
    const students = this.getEduStudents(teamId);
    return students.filter(s =>
      s.enrollStatus !== 'inactive' &&
      ((s.parentUid && s.parentUid === curUser.uid) || (s.selfUid && s.selfUid === curUser.uid))
    );
  },

  _isEduStudentOrParent(teamId, curUser) {
    return this._getMyEduStudents(teamId, curUser).length > 0;
  },

});
