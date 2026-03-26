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

    // ★ 先載入學員快取，確保後續判斷正確
    await this._loadEduStudents(teamId);

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

    // ── 學員狀態區塊（非幹部用）──
    const myStudents = this._getMyEduStudents(teamId, curUser);
    const hasActive = myStudents.some(s => s.enrollStatus === 'active');
    const hasPending = myStudents.some(s => s.enrollStatus === 'pending');

    let memberSection = '';
    if (!isStaff) {
      if (myStudents.length === 0) {
        // 尚未申請 → 顯示申請按鈕
        memberSection = '<div class="td-card" style="padding:.6rem .8rem">'
          + '<button class="primary-btn" style="width:100%" onclick="App.showEduStudentApply(\'' + teamId + '\')">申請加入（本人/代理）</button>'
          + '</div>';
      } else {
        // 有學員紀錄 → 顯示狀態卡片
        memberSection = '<div class="td-card">'
          + '<div class="td-card-title">我的學員</div>';

        memberSection += myStudents.map(s => {
          const age = this.calcAge(s.birthday);
          const ageLabel = age != null ? age + ' 歲' : '';
          const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
          const isPending = s.enrollStatus === 'pending';
          const statusHtml = isPending
            ? '<span class="edu-status-pending">待審核</span>'
            : '<span class="edu-status-active">已通過</span>';
          const groupHtml = (s.groupNames && s.groupNames.length)
            ? '<div class="edu-student-groups">' + s.groupNames.map(n => '<span class="edu-group-tag">' + escapeHTML(n) + '</span>').join('') + '</div>'
            : '';
          return '<div class="edu-student-card">'
            + '<div class="edu-student-header">'
            + '<span class="edu-student-name">' + escapeHTML(s.name) + '</span>'
            + (genderIcon ? '<span class="edu-student-gender">' + genderIcon + '</span>' : '')
            + (ageLabel ? '<span class="edu-student-age">' + ageLabel + '</span>' : '')
            + statusHtml
            + '</div>'
            + groupHtml
            + '</div>';
        }).join('');

        // 已通過 → 可追加學員 + 查看行事曆
        if (hasActive) {
          memberSection += '<div style="display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap">'
            + '<button class="primary-btn" onclick="App.showEduStudentApply(\'' + teamId + '\')">追加學員</button>'
            + '<button class="outline-btn" onclick="App.showEduCalendar(\'' + teamId + '\')">查看出席紀錄</button>'
            + '</div>';
        } else if (hasPending) {
          memberSection += '<div style="margin-top:.4rem;font-size:.78rem;color:var(--text-muted)">申請審核中，請等待教練審核</div>';
        }

        memberSection += '</div>';
      }
    }

    bodyEl.innerHTML = infoCard + bioCard + groupSection + courseSection + checkinSection + memberSection;

    // 載入分組列表
    await this.renderEduGroupList(teamId);
    // 載入課程方案（所有人皆可看）
    if (typeof this.renderEduCoursePlanList === 'function') {
      await this.renderEduCoursePlanList(teamId, isStaff);
    }
  },

  /**
   * 取得當前用戶在此俱樂部的所有學員紀錄（本人或代理）
   */
  _getMyEduStudents(teamId, curUser) {
    if (!curUser) return [];
    const students = this.getEduStudents(teamId);
    return students.filter(s =>
      s.enrollStatus !== 'inactive' &&
      ((s.parentUid && s.parentUid === curUser.uid) || (s.selfUid && s.selfUid === curUser.uid))
    );
  },

  /**
   * 檢查當前用戶是否為此俱樂部的學員或家長
   */
  _isEduStudentOrParent(teamId, curUser) {
    return this._getMyEduStudents(teamId, curUser).length > 0;
  },

});
