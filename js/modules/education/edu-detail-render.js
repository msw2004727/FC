/* ================================================
   SportHub — Education: Club Detail Page Rendering
   ================================================
   教育型俱樂部詳情頁渲染（分組、課程、簽到入口）
   - 即時監聽 → edu-detail-realtime.js
   - 退學流程 → edu-detail-withdraw.js
   ================================================ */

Object.assign(App, {

  _eduDetailTeamId: null,
  _eduActiveTab: 'course',

  /**
   * 為教育型俱樂部建構詳情頁 body HTML
   */
  renderEduClubDetail(teamId) {
    const bodyEl = document.getElementById('team-detail-body');
    if (!bodyEl) return;

    const team = ApiService.getTeam(teamId);
    if (!team) return;

    this._eduDetailTeamId = teamId;
    this._eduActiveTab = 'course';

    // ── 基本資訊卡 ──
    const acceptingStudents = team.eduSettings && team.eduSettings.acceptingStudents !== false;
    const infoCard = '<div class="td-card">'
      + '<div class="td-card-title">俱樂部資訊</div>'
      + '<div class="td-card-grid">'
      + '<div class="td-card-item"><span class="td-card-label">招生狀態</span><span class="td-card-value" style="color:' + (acceptingStudents ? 'var(--success)' : 'var(--text-muted)') + '">' + (acceptingStudents ? '招生中' : '暫停招生') + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">俱樂部經理</span><span class="td-card-value">' + (team.captain ? this._userTag(team.captain, 'captain') : '未設定') + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">教練</span><span class="td-card-value">' + ((team.coaches || []).length > 0 ? team.coaches.map(c => this._userTag(c, 'coach')).join(' ') : '無') + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">地區</span><span class="td-card-value">' + escapeHTML(team.region || '') + '</span></div>'
      + (team.contact ? '<div class="td-card-item"><span class="td-card-label">聯繫方式</span><span class="td-card-value">' + escapeHTML(team.contact) + '</span></div>' : '')
      + '</div></div>';

    const bioCard = team.bio ? '<div class="td-card"><div class="td-card-title" style="text-align:center">簡介</div><div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word">' + escapeHTML(team.bio) + '</div></div>' : '';

    // ── 頁籤列（課程 | 分組 | 我的 + badge + 未繳費提示）──
    const tabBar = '<div class="edu-tab-row">'
      + '<div class="tab-bar" id="edu-detail-tabs" style="flex:0 0 auto">'
      + '<button class="tab active" data-edutab="course" onclick="App.switchEduTab(\'course\')">課程</button>'
      + '<button class="tab" data-edutab="group" onclick="App.switchEduTab(\'group\')">分組</button>'
      + '<button class="tab" data-edutab="mine" onclick="App.switchEduTab(\'mine\')">我的<span id="edu-mine-badge" class="edu-tab-badge"></span></button>'
      + '</div>'
      + '<span id="edu-mine-status" class="edu-mine-status"></span>'
      + '</div>';

    bodyEl.innerHTML = infoCard + bioCard + tabBar
      + '<div id="edu-detail-tab-content" class="edu-tab-content"></div>';

    // ★ Phase 1：渲染預設頁籤（課程）
    this._renderEduTabContent(teamId);

    // ★ 綁定左右滑動切換
    this._bindSwipeTabs('edu-detail-tab-content', 'edu-detail-tabs',
      this.switchEduTab,
      (btn) => btn.dataset.edutab
    );

    // ★ Phase 2：背景 fetch + 即時監聽
    this._loadEduStudents(teamId).then(() => {
      if (this._eduDetailTeamId === teamId) {
        this._renderEduMemberSection(teamId);
        this.renderEduGroupList(teamId);
        this._updateEduMineBadge(teamId);
      }
    });
    this._startEduStudentsListener(teamId);
  },

  /**
   * 切換教學俱樂部頁籤
   */
  switchEduTab(tab) {
    this._eduActiveTab = tab;
    document.querySelectorAll('#edu-detail-tabs .tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.edutab === tab);
    });
    this._renderEduTabContent(this._eduDetailTeamId);
  },

  /**
   * 渲染當前頁籤內容
   */
  _renderEduTabContent(teamId) {
    const container = document.getElementById('edu-detail-tab-content');
    if (!container || !teamId) return;

    const isStaff = this.isEduClubStaff(teamId);
    const tab = this._eduActiveTab || 'course';

    if (tab === 'course') {
      container.innerHTML = '<div class="td-card">'
        + '<div class="td-card-title td-card-title-row">'
        + '<span>課程方案<button class="edu-info-btn" onclick="App._showEduInfoPopup(\'course\')" title="說明">?</button></span>'
        + (isStaff ? '<button class="primary-btn small" onclick="App.showEduCoursePlanForm(\'' + teamId + '\')">＋ 新增</button>' : '')
        + '</div>'
        + '<div id="edu-course-plan-list"><div class="edu-loading"><div class="edu-loading-bar"><div class="edu-loading-fill"></div></div><div class="edu-loading-text">正在努力加載中請稍後</div></div></div>'
        + '</div>';
      if (typeof this.renderEduCoursePlanList === 'function') {
        this.renderEduCoursePlanList(teamId, isStaff);
      }
    } else if (tab === 'group') {
      container.innerHTML = '<div class="td-card">'
        + '<div class="td-card-title td-card-title-row">'
        + '<span>學員分組<button class="edu-info-btn" onclick="App._showEduInfoPopup(\'group\')" title="說明">?</button></span>'
        + (isStaff ? '<button class="primary-btn small" onclick="App.showEduGroupForm(\'' + teamId + '\')">＋ 新增</button>' : '')
        + '</div>'
        + '<div id="edu-group-list"><div class="edu-loading"><div class="edu-loading-bar"><div class="edu-loading-fill"></div></div><div class="edu-loading-text">正在努力加載中請稍後</div></div></div>'
        + '</div>';
      this.renderEduGroupList(teamId);
    } else if (tab === 'mine') {
      container.innerHTML = '<div id="edu-member-section"></div>';
      this._renderEduMemberSection(teamId);
    }
  },

  /**
   * 渲染「我的學員」區塊（可獨立重繪，供即時監聽呼叫）
   */
  _renderEduMemberSection(teamId) {
    const container = document.getElementById('edu-member-section');
    if (!container) return;

    const isStaff = this.isEduClubStaff(teamId);

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

    // 取得進行中的課程方案（用於標籤顯示）
    const activePlans = this.getEduCoursePlans(teamId).filter(p => {
      if (p.active === false) return false;
      if (p.planType === 'weekly' && p.endDate && p.endDate < new Date().toISOString().slice(0, 10)) return false;
      return true;
    });
    // 課程標籤顏色
    const courseColors = ['#7c3aed', '#0d9488', '#ec4899', '#f59e0b', '#3b82f6', '#ef4444'];

    let html = '<div class="td-card">'
      + '<div class="td-card-title td-card-title-row">'
      + '<span>我們這一家<button class="edu-info-btn" onclick="App._showEduInfoPopup(\'member\')" title="說明">?</button></span>'
      + '</div>';

    html += myStudents.map(s => {
      const age = this.calcAge(s.birthday);
      const ageLabel = age != null ? age + ' 歲' : '';
      const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
      const genderClass = s.gender === 'male' ? ' edu-gender-male' : s.gender === 'female' ? ' edu-gender-female' : '';
      const isPending = s.enrollStatus === 'pending';
      const statusHtml = isPending
        ? '<span class="edu-status-pending">待審核</span>'
        : '<span class="edu-status-active">已通過</span>';
      // 加入時間（支援 Firestore Timestamp）
      let timeRaw = s.enrolledAt || s.createdAt || '';
      let timeStr = '';
      if (timeRaw) {
        if (typeof timeRaw === 'string') timeStr = timeRaw.slice(0, 10);
        else if (timeRaw.toDate) timeStr = timeRaw.toDate().toISOString().slice(0, 10);
        else if (timeRaw.seconds) timeStr = new Date(timeRaw.seconds * 1000).toISOString().slice(0, 10);
      }
      const timeLabel = isPending ? '提交申請' : '加入俱樂部';
      const timeHtml = timeStr ? '<div style="font-size:.72rem;color:var(--text-muted)">' + timeLabel + '：' + escapeHTML(timeStr) + '</div>' : '';
      const groupHtml = (s.groupNames && s.groupNames.length)
        ? '<div class="edu-student-groups">' + s.groupNames.map(n => '<span class="edu-group-tag">' + escapeHTML(n) + '</span>').join('') + '</div>'
        : '';
      // 當前所屬課程標籤（條件：在課程名單內 + 課程尚未結束）
      let courseTagsHtml = '';
      if (!isPending) {
        const myCourseTags = activePlans.filter(p => {
          // 分組匹配
          if (p.groupId && (s.groupIds || []).includes(p.groupId)) return true;
          // enrollment 匹配（透過 _enrollments）
          if (p._enrollments && p._enrollments.some(e => e.studentId === s.id && e.status === 'approved')) return true;
          return false;
        });
        if (myCourseTags.length) {
          courseTagsHtml = '<div style="display:flex;flex-wrap:wrap;gap:.25rem;margin-top:.2rem">'
            + myCourseTags.map((cp, ci) => {
              const color = courseColors[ci % courseColors.length];
              return '<span style="font-size:.68rem;padding:.1rem .4rem;border-radius:var(--radius-full);background:' + color + '22;color:' + color + ';font-weight:600">' + escapeHTML(cp.name) + '</span>';
            }).join('') + '</div>';
        }
      }
      // 右側按鈕列
      let actionBtns = '';
      if (!isPending) {
        actionBtns = '<button class="outline-btn small edu-attendance-btn" onclick="App.showEduCalendar(\'' + teamId + '\',\'' + s.id + '\')">出席紀錄</button>'
          + '<button class="outline-btn small edu-withdraw-btn" onclick="App._confirmEduWithdraw(\'' + teamId + '\',\'' + s.id + '\',this)" data-name="' + escapeHTML(s.name) + '">退學</button>';
      } else {
        actionBtns = '<button class="outline-btn small edu-withdraw-btn" onclick="App._confirmEduCancelApply(\'' + teamId + '\',\'' + s.id + '\',this)" data-name="' + escapeHTML(s.name) + '">取消申請</button>';
      }

      return '<div class="edu-student-card">'
        + '<div class="edu-student-header">'
        + '<span class="edu-student-name">' + escapeHTML(s.name) + '</span>'
        + (genderIcon ? '<span class="edu-student-gender' + genderClass + '">' + genderIcon + '</span>' : '')
        + (ageLabel ? '<span class="edu-student-age">' + ageLabel + '</span>' : '')
        + statusHtml
        + '<span class="edu-header-actions">' + actionBtns + '</span>'
        + '</div>'
        + groupHtml
        + courseTagsHtml
        + timeHtml
        + '</div>';
    }).join('');

    // 追加學員按鈕（有任一 active 或 pending 時顯示）
    if (hasActive || hasPending) {
      html += '<div style="margin-top:.5rem">'
        + '<button class="primary-btn" onclick="App.showEduStudentApply(\'' + teamId + '\')">追加學員</button>'
        + '</div>';
      if (!hasActive && hasPending) {
        html += '<div style="margin-top:.4rem;font-size:.78rem;color:var(--text-muted)">申請審核中，請等待教練審核</div>';
      }
    }

    html += '</div>';
    container.innerHTML = html;
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

  async _updateEduMineBadge(teamId) {
    const curUser = ApiService.getCurrentUser();
    const myStudents = this._getMyEduStudents(teamId, curUser).filter(s => s.enrollStatus === 'active');
    // 綠圈：學員數
    const badge = document.getElementById('edu-mine-badge');
    if (badge) { badge.textContent = myStudents.length || ''; badge.style.display = myStudents.length ? 'inline-block' : 'none'; }
    // 未繳費統計
    const statusEl = document.getElementById('edu-mine-status');
    if (!statusEl || !myStudents.length) { if (statusEl) statusEl.style.display = 'none'; return; }
    const plans = await this._loadEduCoursePlans(teamId);
    const today = this._todayStr();
    let unpaid = 0;
    for (const s of myStudents) {
      for (const p of plans) {
        if (p.active === false) continue;
        // 判斷學員是否在此方案內（enrollment 或分組）
        var inPlan = false;
        var enrollment = null;
        var key = this._getCourseEnrollCacheKey?.(teamId, p.id);
        var enrollments = (key && this._courseEnrollCache?.[key]) || [];
        enrollment = enrollments.find(e => e.studentId === s.id && e.status === 'approved');
        if (enrollment) inPlan = true;
        if (!inPlan && p.groupId && (s.groupIds || []).includes(p.groupId)) { inPlan = true; }
        if (!inPlan) continue;
        // 已繳費則跳過
        if (enrollment && enrollment.paidAt) continue;
        // 判斷是否需繳費：課程未結束 OR 已結束但有簽到紀錄
        var ended = p.endDate && p.endDate < today;
        if (!ended) { unpaid++; continue; }
        // 已結束：查簽到紀錄
        try {
          var records = await FirebaseService.queryEduAttendance({ teamId, coursePlanId: p.id, studentId: s.id });
          if (records && records.length > 0) unpaid++;
        } catch (_) {}
      }
    }
    if (unpaid > 0) {
      statusEl.innerHTML = '<span class="edu-unpaid-hint">' + unpaid + ' 筆未繳費</span>';
      statusEl.style.display = 'inline';
    } else {
      statusEl.style.display = 'none';
    }
  },

});
