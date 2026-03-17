/* ================================================
   SportHub — Education: Club Detail Page Rendering
   ================================================
   教育型俱樂部詳情頁渲染（分組、課程、簽到入口）
   ================================================ */

Object.assign(App, {

  /**
   * 為教育型俱樂部建構詳情頁 body HTML
   * 在 team-detail.js showTeamDetail 中 type=education 時委派
   */
  async renderEduClubDetail(teamId) {
    const bodyEl = document.getElementById('team-detail-body');
    if (!bodyEl) return;

    const team = ApiService.getTeam(teamId);
    if (!team) return;

    const isStaff = this.isEduClubStaff(teamId);
    const curUser = ApiService.getCurrentUser();

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

    // ── 課程方案（幹部專用）──
    const courseSection = isStaff ? '<div class="td-card">'
      + '<div class="td-card-title td-card-title-row">'
      + '<span>課程方案</span>'
      + '<button class="primary-btn small" onclick="App.showEduCoursePlanForm(\'' + teamId + '\')">＋ 新增</button>'
      + '</div>'
      + '<div id="edu-course-plan-list"></div>'
      + '</div>' : '';

    // ── 申請加入（非幹部、非學員用）──
    const isStudentOrParent = this._isEduStudentOrParent(teamId, curUser);
    const applySection = (!isStaff && !isStudentOrParent)
      ? '<div class="td-card" style="padding:.6rem .8rem">'
        + '<button class="primary-btn" onclick="App.showEduStudentApply(\'' + teamId + '\')">申請加入（學員/家長）</button>'
        + '</div>'
      : '';

    // ── 行事曆入口（學員/家長用）──
    const calendarSection = isStudentOrParent
      ? '<div class="td-card">'
        + '<div class="td-card-title">出席紀錄</div>'
        + '<button class="primary-btn" onclick="App.showEduCalendar(\'' + teamId + '\')">查看行事曆</button>'
        + '</div>'
      : '';

    bodyEl.innerHTML = infoCard + bioCard + groupSection + courseSection + checkinSection + calendarSection + applySection;

    // 載入分組列表
    await this.renderEduGroupList(teamId);
    // 載入課程方案
    if (isStaff && typeof this.renderEduCoursePlanList === 'function') {
      await this.renderEduCoursePlanList(teamId);
    }
  },

  /**
   * 檢查當前用戶是否為此俱樂部的學員或家長
   */
  _isEduStudentOrParent(teamId, curUser) {
    if (!curUser) return false;
    const students = this.getEduStudents(teamId);
    return students.some(s =>
      s.enrollStatus !== 'inactive' &&
      ((s.parentUid && s.parentUid === curUser.uid) || (s.selfUid && s.selfUid === curUser.uid))
    );
  },

});
