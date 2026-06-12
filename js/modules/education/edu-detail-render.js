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
  _eduUnpaidSummaryByTeam: {},

  _initEduClubDetailSection(teamId, options = {}) {
    this._eduDetailTeamId = teamId;
    this._eduActiveTab = 'course';

    this._refreshEduPendingTabState(teamId);
    this._setEduDetailTabActiveState('course');

    const renderResult = this._renderEduTabContent(teamId, options);
    if (renderResult && typeof renderResult.then === 'function') {
      renderResult
        .then(() => {
          if (this._eduDetailTeamId === teamId) this._refreshTeamDetailV2CourseSummaryFromCache?.(teamId);
        })
        .catch(err => console.warn('[edu-detail] initial course render failed:', err));
    } else {
      this._refreshTeamDetailV2CourseSummaryFromCache?.(teamId);
    }

    if (typeof this._bindSwipeTabs === 'function') {
      this._bindSwipeTabs('edu-detail-tab-content', 'edu-detail-tabs',
        this.switchEduTab,
        (btn) => btn.dataset.edutab
      );
    }

    this._loadEduStudents(teamId).then(() => {
      if (this._eduDetailTeamId === teamId) {
        this._refreshEduPendingTabState(teamId);
        const refreshResult = this._refreshEduActiveTabContent(teamId);
        if (refreshResult && typeof refreshResult.then === 'function') {
          refreshResult
            .then(() => {
              if (this._eduDetailTeamId === teamId) this._refreshTeamDetailV2CourseSummaryFromCache?.(teamId);
            })
            .catch(err => console.warn('[edu-detail] active tab refresh failed:', err));
        } else {
          this._refreshTeamDetailV2CourseSummaryFromCache?.(teamId);
        }
        this._updateEduMineBadge(teamId);
        this._refreshTeamMembersCardFromCache?.(teamId);
      }
    });
    this._startEduStudentsListener(teamId);
  },

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

    if (typeof this._buildTeamDetailBodyHtml === 'function') {
      const canManageMembers = typeof this._canManageTeamMembers === 'function' ? this._canManageTeamMembers(team) : false;
      const memberEditMode = !!this._teamMemberEditModeByTeam?.[team.id];
      const staffIdentity = typeof this._getTeamStaffIdentity === 'function'
        ? this._getTeamStaffIdentity(team)
        : { keys: new Set(), names: new Set() };
      const totalGames = (team.wins || 0) + (team.draws || 0) + (team.losses || 0);
      const winRate = totalGames > 0 ? Math.round((team.wins || 0) / totalGames * 100) : 0;
      bodyEl.innerHTML = this._buildTeamDetailBodyHtml(team, canManageMembers, memberEditMode, staffIdentity, totalGames, winRate);
      this._initEduClubDetailSection(teamId);
      this._syncTeamDetailV2RuntimeAfterBodyRender?.(teamId, this._teamDetailRequestSeq);
      return;
    }

    // ── 基本資訊卡 ──
    const acceptingStudents = team.eduSettings && team.eduSettings.acceptingStudents !== false;
    const leaderNames = (Array.isArray(team.leaders) ? team.leaders : (team.leader ? [team.leader] : [])).filter(Boolean);
    const leaderValue = leaderNames.length
      ? leaderNames.map(n => this._teamLeaderTag(n)).join(' ')
      : '未設定';
    const infoCard = '<div class="td-card">'
      + '<div class="td-card-title">俱樂部資訊</div>'
      + '<div class="td-card-grid">'
      + '<div class="td-card-item"><span class="td-card-label">招生狀態</span><span class="td-card-value" style="color:' + (acceptingStudents ? 'var(--success)' : 'var(--text-muted)') + '">' + (acceptingStudents ? '招生中' : '暫停招生') + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">俱樂部經理</span><span class="td-card-value">' + (team.captain ? this._userTag(team.captain, 'captain') : '未設定') + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">領隊</span><span class="td-card-value">' + leaderValue + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">教練</span><span class="td-card-value">' + ((team.coaches || []).length > 0 ? team.coaches.map(c => this._userTag(c, 'coach')).join(' ') : '無') + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">地區</span><span class="td-card-value">' + escapeHTML(team.region || '') + '</span></div>'
      + (team.contact ? '<div class="td-card-item"><span class="td-card-label">聯繫方式</span><span class="td-card-value">' + escapeHTML(team.contact) + '</span></div>' : '')
      + '</div></div>';

    const bioCard = team.bio ? '<div class="td-card"><div class="td-card-title" style="text-align:center">簡介</div><div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word">' + escapeHTML(team.bio) + '</div></div>' : '';

    // ── 頁籤列（課程 | 分組 | 我的 + badge + 未繳費提示）──
    const tabBar = '<div class="edu-tab-row">'
      + this._buildEduDetailTabControlsHtml(teamId)
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
        this._refreshEduPendingTabState(teamId);
        this._refreshEduActiveTabContent(teamId);
        this._updateEduMineBadge(teamId);
        this._refreshTeamMembersCardFromCache?.(teamId);
      }
    });
    this._startEduStudentsListener(teamId);
  },

  /**
   * 切換教學俱樂部頁籤
   */
  switchEduTab(tab, options = {}) {
    let nextTab = this._normalizeEduDetailTab(tab);
    this._refreshEduPendingTabState(this._eduDetailTeamId);
    if (nextTab === 'pending' && !this._shouldShowEduPendingTab(this._eduDetailTeamId)) nextTab = 'course';
    this._eduActiveTab = nextTab;
    this._setEduDetailTabActiveState(nextTab);
    return this._renderEduTabContent(this._eduDetailTeamId, options);
  },

  _normalizeEduDetailTab(tab) {
    return tab === 'mine' ? 'student' : (tab || 'course');
  },

  _refreshEduActiveTabContent(teamId, options = {}) {
    this._refreshEduPendingTabState(teamId);
    let tab = this._normalizeEduDetailTab(this._eduActiveTab);
    if (tab === 'pending' && !this._shouldShowEduPendingTab(teamId)) {
      tab = 'course';
      this._eduActiveTab = tab;
      this._setEduDetailTabActiveState(tab);
    }
    if (tab === 'student') this._renderEduMemberSection(teamId);
    else if (tab === 'group') this.renderEduGroupList(teamId);
    else if (tab === 'pending') this._renderEduPendingSection(teamId);
    else if (typeof this.renderEduCoursePlanList === 'function') {
      return options && Object.keys(options).length
        ? this.renderEduCoursePlanList(teamId, this.isEduClubStaff(teamId), options)
        : this.renderEduCoursePlanList(teamId, this.isEduClubStaff(teamId));
    }
    return undefined;
  },

  _isEduPendingTabStaff(teamId) {
    if (typeof this.isEduClubStaff !== 'function') return true;
    return !!this.isEduClubStaff(teamId);
  },

  _getEduPendingStudentsForViewer(teamId, curUser) {
    const students = typeof this.getEduStudents === 'function' ? (this.getEduStudents(teamId) || []) : [];
    const pending = students.filter(s => s && s.enrollStatus === 'pending');
    if (this._isEduPendingTabStaff(teamId)) return pending;
    const viewer = curUser || ApiService.getCurrentUser?.();
    if (!viewer?.uid) return [];
    if (typeof this._getMyEduStudents === 'function') {
      return this._getMyEduStudents(teamId, viewer).filter(s => s.enrollStatus === 'pending');
    }
    return pending.filter(s =>
      (s.parentUid && s.parentUid === viewer.uid) || (s.selfUid && s.selfUid === viewer.uid)
    );
  },

  _shouldShowEduPendingTab(teamId, curUser) {
    if (this._isEduPendingTabStaff(teamId)) return true;
    return this._getEduPendingStudentsForViewer(teamId, curUser).length > 0;
  },

  _buildEduDetailTabControlsHtml(teamId) {
    const isStaff = this._isEduPendingTabStaff(teamId);
    const pendingCount = this._getEduPendingStudentsForViewer(teamId).length;
    const pendingVisible = isStaff || pendingCount > 0;
    const pendingBadge = '<span id="edu-pending-badge" class="edu-tab-badge"'
      + (pendingCount > 0 ? ' style="display:inline-block"' : '')
      + '>' + (pendingCount > 0 ? pendingCount : '') + '</span>';
    return '<div class="tab-bar" id="edu-detail-tabs" style="flex:0 0 auto">'
      + '<button class="tab active" data-edutab="course" onclick="App.switchEduTab(\'course\')">課程</button>'
      + '<button class="tab" data-edutab="group" onclick="App.switchEduTab(\'group\')">分組</button>'
      + '<span class="edu-tab-mine-wrap"><button class="tab" data-edutab="student" onclick="App.switchEduTab(\'student\')">學員</button><span id="edu-mine-badge" class="edu-tab-badge"></span></span>'
      + '<span id="edu-pending-tab-wrap" class="edu-tab-mine-wrap"'
      + (pendingVisible ? '' : ' style="display:none"')
      + '><button class="tab" data-edutab="pending" onclick="App.switchEduTab(\'pending\')">待審核</button>' + pendingBadge + '</span>'
      + '</div>';
  },

  _setEduDetailTabActiveState(activeTab) {
    const nextTab = this._normalizeEduDetailTab(activeTab);
    document.querySelectorAll('#edu-detail-tabs .tab').forEach(btn => {
      btn.classList.toggle('active', this._normalizeEduDetailTab(btn.dataset.edutab) === nextTab);
    });
  },

  _refreshEduPendingTabState(teamId) {
    const isStaff = this._isEduPendingTabStaff(teamId);
    const count = this._getEduPendingStudentsForViewer(teamId).length;
    const shouldShow = isStaff || count > 0;
    const wrap = document.getElementById?.('edu-pending-tab-wrap');
    if (wrap) wrap.style.display = shouldShow ? '' : 'none';
    const badge = document.getElementById?.('edu-pending-badge');
    if (badge) {
      badge.textContent = count || '';
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
    if (!shouldShow && this._normalizeEduDetailTab(this._eduActiveTab) === 'pending') {
      this._eduActiveTab = 'course';
      this._setEduDetailTabActiveState('course');
    }
    return { shouldShow, count };
  },

  _formatEduPendingSubmitDate(student) {
    const raw = student?.createdAt || student?.submittedAt || student?.appliedAt || student?.enrolledAt || '';
    if (!raw) return '';
    if (typeof raw === 'string') {
      const m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (m) return m[1] + '/' + String(m[2]).padStart(2, '0') + '/' + String(m[3]).padStart(2, '0');
    }
    let d = null;
    try {
      if (raw instanceof Date) d = raw;
      else if (typeof raw.toDate === 'function') d = raw.toDate();
      else if (typeof raw.seconds === 'number') d = new Date(raw.seconds * 1000);
      else d = new Date(raw);
    } catch (_) {
      return '';
    }
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  },

  _renderPendingStudentStatusRow(s) {
    const age = this.calcAge(s.birthday);
    const ageLabel = age != null ? age + ' 歲' : '';
    const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
    const genderClass = s.gender === 'male' ? ' edu-gender-male' : s.gender === 'female' ? ' edu-gender-female' : '';
    const dateLabel = this._formatEduPendingSubmitDate(s);
    const statusText = (dateLabel ? dateLabel : '') + '提交中';
    return '<div class="edu-student-card edu-pending-card">'
      + '<div class="edu-student-header">'
      + '<span class="edu-student-name">' + escapeHTML(s.name || '未命名學員') + '</span>'
      + (genderIcon ? '<span class="edu-student-gender' + genderClass + '">' + genderIcon + '</span>' : '')
      + (ageLabel ? '<span class="edu-student-age">' + ageLabel + '</span>' : '')
      + '<span class="edu-header-actions"><span class="edu-status-pending">' + escapeHTML(statusText) + '</span></span>'
      + '</div>'
      + '</div>';
  },

  /**
   * 渲染當前頁籤內容
   */
  _renderEduTabContent(teamId, options = {}) {
    const container = document.getElementById('edu-detail-tab-content');
    if (!container || !teamId) return;

    const isStaff = this.isEduClubStaff(teamId);
    const tab = this._normalizeEduDetailTab(this._eduActiveTab);
    const inlineUnified = !!container.closest?.('#edu-detail-section');
    const inlineTeamDetailV2 = !!container.closest?.('.td-v2-edu-card');
    const panelClass = inlineUnified ? 'td-edu-panel' : 'td-card';

    if (tab === 'course') {
      if (inlineTeamDetailV2) {
        container.innerHTML = '<div id="edu-course-plan-list" class="edu-course-plan-list-inline"><div class="edu-loading"><div class="edu-loading-bar"><div class="edu-loading-fill"></div></div><div class="edu-loading-text">載入課程方案中...</div></div></div>';
        if (typeof this.renderEduCoursePlanList === 'function') {
          return options && Object.keys(options).length
            ? this.renderEduCoursePlanList(teamId, isStaff, options)
            : this.renderEduCoursePlanList(teamId, isStaff);
        }
        return undefined;
      }
      container.innerHTML = '<div class="' + panelClass + '">'
        + '<div class="td-card-title td-card-title-row">'
        + '<span>課程方案<button class="edu-info-btn" onclick="App._showEduInfoPopup(\'course\')" title="說明">?</button></span>'
        + (isStaff ? '<button class="primary-btn small" onclick="App.showEduCoursePlanForm(\'' + teamId + '\')">＋ 新增</button>' : '')
        + '</div>'
        + '<div id="edu-course-plan-list"><div class="edu-loading"><div class="edu-loading-bar"><div class="edu-loading-fill"></div></div><div class="edu-loading-text">正在努力加載中請稍後</div></div></div>'
        + '</div>';
      if (typeof this.renderEduCoursePlanList === 'function') {
        return options && Object.keys(options).length
          ? this.renderEduCoursePlanList(teamId, isStaff, options)
          : this.renderEduCoursePlanList(teamId, isStaff);
      }
    } else if (tab === 'group') {
      container.innerHTML = '<div class="' + panelClass + '">'
        + '<div class="td-card-title td-card-title-row">'
        + '<span>學員分組<button class="edu-info-btn" onclick="App._showEduInfoPopup(\'group\')" title="說明">?</button></span>'
        + (isStaff ? '<button class="primary-btn small" onclick="App.showEduGroupForm(\'' + teamId + '\')">＋ 新增</button>' : '')
        + '</div>'
        + '<div id="edu-group-list"><div class="edu-loading"><div class="edu-loading-bar"><div class="edu-loading-fill"></div></div><div class="edu-loading-text">正在努力加載中請稍後</div></div></div>'
        + '</div>';
      this.renderEduGroupList(teamId);
    } else if (tab === 'student') {
      container.innerHTML = '<div id="edu-member-section"></div>';
      this._renderEduMemberSection(teamId);
    } else if (tab === 'pending') {
      container.innerHTML = '<div id="edu-pending-section"></div>';
      this._renderEduPendingSection(teamId);
    }
    return undefined;
  },

  _renderEduPendingSection(teamId) {
    const container = document.getElementById('edu-pending-section');
    if (!container) return;
    const inlineUnified = !!container.closest?.('#edu-detail-section');
    const panelClass = inlineUnified ? 'td-edu-panel' : 'td-card';
    const isStaff = this._isEduPendingTabStaff(teamId);
    const pending = this._getEduPendingStudentsForViewer(teamId);
    const rows = pending.length
      ? pending.map(s => {
        if (isStaff && typeof this._renderPendingStudentRow === 'function') return this._renderPendingStudentRow(teamId, '', s);
        if (!isStaff) return this._renderPendingStudentStatusRow(s);
        return '<div class="edu-student-card edu-pending-card"><div class="edu-student-header"><span class="edu-student-name">' + escapeHTML(s.name || '未命名學員') + '</span></div></div>';
      }).join('')
      : '<div class="edu-empty-state">目前沒有待審核學員</div>';
    container.innerHTML = '<div class="' + panelClass + '">'
      + '<div class="td-card-title td-card-title-row"><span>待審核名單</span></div>'
      + rows
      + '</div>';
  },

  /**
   * 渲染「我的學員」區塊（可獨立重繪，供即時監聽呼叫）
   */
  _renderEduMemberSection(teamId) {
    const container = document.getElementById('edu-member-section');
    if (!container) return;

    const inlineUnified = !!container.closest?.('#edu-detail-section');
    const panelClass = inlineUnified ? 'td-edu-panel' : 'td-card';
    const isStaff = this.isEduClubStaff(teamId);

    const curUser = ApiService.getCurrentUser();
    const myStudents = this._getMyEduStudents(teamId, curUser);
    const hasActive = myStudents.some(s => s.enrollStatus === 'active');
    const hasPending = myStudents.some(s => s.enrollStatus === 'pending');

    if (myStudents.length === 0) {
      container.innerHTML = '<div class="' + panelClass + '" style="padding:.6rem .8rem">'
        + '<button class="primary-btn" style="width:100%" onclick="App.showEduStudentApply(\'' + teamId + '\')">申請加入（本人/代理）</button>'
        + '</div>';
      return;
    }

    // 取得進行中的課程方案（用於標籤顯示）
    const activePlans = this.getEduCoursePlans(teamId).filter(p => {
      if (p.active === false) return false;
      if (p.planType === 'weekly' && p.endDate && p.endDate < (this._todayStr?.() || (() => {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      })())) return false;
      return true;
    });
    // 課程標籤顏色
    const courseColors = ['#7c3aed', '#0d9488', '#ec4899', '#f59e0b', '#3b82f6', '#ef4444'];

    let html = '<div class="' + panelClass + '">'
      + '<div class="td-card-title td-card-title-row">'
      + '<span>學員名冊<button class="edu-info-btn" onclick="App._showEduInfoPopup(\'member\')" title="說明">?</button></span>'
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
      let nextClassHtml = '';
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
        const nextClass = this._getEduNextClassForStudent?.(teamId, s, activePlans);
        if (nextClass) nextClassHtml = this._renderEduNextClassCard?.(nextClass) || '';
      }
      // 右側按鈕列
      let actionBtns = '';
      if (!isPending) {
        actionBtns = '<button class="outline-btn small edu-attendance-btn" onclick="App.showEduCalendar(\'' + teamId + '\',\'' + s.id + '\')">出席紀錄</button>'
          + '<button class="outline-btn small edu-withdraw-btn" onclick="App._confirmEduWithdraw(\'' + teamId + '\',\'' + s.id + '\',this)" data-name="' + escapeHTML(s.name) + '">退學</button>';
      } else {
        actionBtns = '<button class="outline-btn small edu-withdraw-btn" onclick="App._confirmEduCancelApply(\'' + teamId + '\',\'' + s.id + '\',this)" data-name="' + escapeHTML(s.name) + '">取消申請</button>';
      }
      const actionWrapClass = isPending ? 'edu-header-actions' : 'edu-header-actions edu-member-inline-actions';

      return '<div class="edu-student-card">'
        + '<div class="edu-student-header">'
        + '<span class="edu-student-name">' + escapeHTML(s.name) + '</span>'
        + (genderIcon ? '<span class="edu-student-gender' + genderClass + '">' + genderIcon + '</span>' : '')
        + (ageLabel ? '<span class="edu-student-age">' + ageLabel + '</span>' : '')
        + statusHtml
        + '<span class="' + actionWrapClass + '">' + actionBtns + '</span>'
        + '</div>'
        + groupHtml
        + courseTagsHtml
        + nextClassHtml
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

  _getEduNextClassForStudent(teamId, student, plans = []) {
    if (!student || student.enrollStatus !== 'active') return null;
    const now = new Date();
    const studentId = String(student.id || student._docId || '');
    const candidates = [];
    (plans || []).forEach(plan => {
      if (!plan || plan.active === false) return;
      const key = this._getCourseEnrollCacheKey?.(teamId, plan.id);
      const enrollments = plan._enrollments || (key && this._courseEnrollCache?.[key]) || [];
      const byEnrollment = enrollments.some(e => String(e.studentId || '') === studentId && e.status === 'approved');
      const byGroup = !!(plan.groupId && (student.groupIds || []).includes(plan.groupId));
      if (!byEnrollment && !byGroup) return;

      if (plan.planType === 'weekly') {
        const next = this._getCoursePlanNextWeeklyOccurrence?.(plan, now);
        if (!next) return;
        candidates.push({
          timestamp: next.timestamp,
          planId: plan.id,
          planName: plan.name || '課程',
          dateLabel: next.label,
          location: plan.location || '',
          coachName: plan.coachName || plan.coach || '',
          source: 'weekly',
        });
        return;
      }

      const sessionKey = this._getCourseSessionCacheKey?.(teamId, plan.id);
      const sessions = (sessionKey && this._courseSessionCache?.[sessionKey]) || [];
      const nextSession = sessions
        .filter(session => {
          const ids = Array.isArray(session.studentIds) ? session.studentIds.map(String) : [];
          return !ids.length || ids.includes(studentId);
        })
        .map(session => ({ session, timestamp: this._getCourseSessionSortValue?.(session) || 0 }))
        .filter(item => item.timestamp >= now.getTime())
        .sort((a, b) => a.timestamp - b.timestamp)[0];
      if (nextSession) {
        const session = nextSession.session;
        const dateLabel = [
          typeof this._formatCourseSessionDate === 'function' ? this._formatCourseSessionDate(session) : session.date,
          typeof this._formatCourseSessionTime === 'function' ? this._formatCourseSessionTime(session) : [session.startTime, session.endTime].filter(Boolean).join('-'),
        ].filter(Boolean).join(' ');
        candidates.push({
          timestamp: nextSession.timestamp,
          planId: plan.id,
          planName: plan.name || '課程',
          dateLabel,
          location: session.location || plan.location || '',
          coachName: session.coachName || plan.coachName || '',
          source: 'session',
        });
      }
    });
    return candidates.sort((a, b) => a.timestamp - b.timestamp)[0] || null;
  },

  _renderEduNextClassCard(nextClass) {
    if (!nextClass) return '';
    const meta = [nextClass.location, nextClass.coachName].filter(Boolean).join(' · ');
    return '<div class="edu-next-class-card">'
      + '<span>下一堂</span>'
      + '<strong>' + escapeHTML(nextClass.planName) + '</strong>'
      + '<em>' + escapeHTML(nextClass.dateLabel || '未排定') + '</em>'
      + (meta ? '<small>' + escapeHTML(meta) + '</small>' : '')
      + '</div>';
  },

  _escapeEduInlineArg(value) {
    return escapeHTML(String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '));
  },

  _getEduStudentDisplayName(student) {
    return student?.name || student?.studentName || '未命名學員';
  },

  async _collectEduUnpaidSummary(teamId, students) {
    const curUser = ApiService.getCurrentUser();
    const myStudents = (students || this._getMyEduStudents(teamId, curUser))
      .filter(s => s && s.enrollStatus === 'active');
    const summary = { teamId, total: 0, plans: [] };
    if (!myStudents.length) return summary;

    const plans = await this._loadEduCoursePlans(teamId);
    const today = typeof this._todayStr === 'function' ? this._todayStr() : (() => {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    const planMap = new Map();

    for (const s of myStudents) {
      const studentId = String(s.id || s._docId || '');
      if (!studentId) continue;
      for (const p of plans || []) {
        if (!p || p.active === false) continue;
        let inPlan = false;
        let enrollment = null;
        const key = this._getCourseEnrollCacheKey?.(teamId, p.id);
        const enrollments = p._enrollments || (key && this._courseEnrollCache?.[key]) || [];
        enrollment = enrollments.find(e => String(e.studentId || '') === studentId && e.status === 'approved');
        if (enrollment) inPlan = true;
        if (!inPlan && p.groupId && (s.groupIds || []).includes(p.groupId)) inPlan = true;
        if (!inPlan) continue;
        if (enrollment && enrollment.paidAt) continue;

        const ended = p.endDate && p.endDate < today;
        if (ended) {
          try {
            const records = await FirebaseService.queryEduAttendance({ teamId, coursePlanId: p.id, studentId });
            if (!records || !records.some(r => (r.kind || 'signin') === 'signin')) continue;
          } catch (_) {
            continue;
          }
        }

        const planId = String(p.id || '');
        if (!planId) continue;
        if (!planMap.has(planId)) {
          const row = {
            planId,
            planName: p.name || '未命名課堂',
            students: [],
          };
          planMap.set(planId, row);
          summary.plans.push(row);
        }
        planMap.get(planId).students.push({
          studentId,
          studentName: this._getEduStudentDisplayName(s),
          groupNames: Array.isArray(s.groupNames) ? s.groupNames.filter(Boolean) : [],
        });
        summary.total++;
      }
    }

    return summary;
  },

  async _updateEduMineBadge(teamId) {
    this._refreshEduPendingTabState(teamId);
    const curUser = ApiService.getCurrentUser();
    const myStudents = this._getMyEduStudents(teamId, curUser).filter(s => s.enrollStatus === 'active');
    // 綠圈：學員數
    const badge = document.getElementById('edu-mine-badge');
    if (badge) { badge.textContent = myStudents.length || ''; badge.style.display = myStudents.length ? 'inline-block' : 'none'; }
    // 未繳費統計
    const statusEl = document.getElementById('edu-mine-status');
    if (!statusEl || !myStudents.length) {
      if (this._eduUnpaidSummaryByTeam) delete this._eduUnpaidSummaryByTeam[teamId];
      if (statusEl) statusEl.style.display = 'none';
      return;
    }
    const summary = await this._collectEduUnpaidSummary(teamId, myStudents);
    this._eduUnpaidSummaryByTeam[teamId] = summary;
    if (summary.total > 0) {
      statusEl.innerHTML = '<button type="button" class="edu-unpaid-tag" onclick="App.showEduUnpaidSummaryModal(\'' + this._escapeEduInlineArg(teamId) + '\')" aria-label="您尚有 ' + summary.total + ' 筆未繳費，點擊查看明細"><span>您尚有 <strong>' + summary.total + '</strong> 筆未繳費</span></button>';
      statusEl.style.display = 'flex';
    } else {
      statusEl.style.display = 'none';
    }
  },

  async showEduUnpaidSummaryModal(teamId) {
    let summary = this._eduUnpaidSummaryByTeam?.[teamId];
    if (!summary) {
      summary = await this._collectEduUnpaidSummary(teamId);
      this._eduUnpaidSummaryByTeam[teamId] = summary;
    }
    this._renderEduUnpaidSummaryModal(summary);
  },

  _renderEduUnpaidSummaryModal(summary = {}) {
    document.getElementById('edu-unpaid-summary-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'edu-unpaid-summary-overlay';
    overlay.className = 'edu-info-overlay edu-unpaid-overlay';
    const planHtml = (summary.plans || []).length
      ? summary.plans.map(plan => {
        const students = Array.isArray(plan.students) ? plan.students : [];
        const studentHtml = students.map(s => {
          const groups = s.groupNames?.length
            ? '<span>' + s.groupNames.map(n => escapeHTML(n)).join('、') + '</span>'
            : '';
          return '<li><strong>' + escapeHTML(s.studentName || '未命名學員') + '</strong>' + groups + '</li>';
        }).join('');
        return '<section class="edu-unpaid-course-card">'
          + '<div class="edu-unpaid-course-head">'
          + '<strong>' + escapeHTML(plan.planName || '未命名課堂') + '</strong>'
          + '<span>' + students.length + ' 位學員未繳費</span>'
          + '</div>'
          + '<ul class="edu-unpaid-student-list">' + studentHtml + '</ul>'
          + '</section>';
      }).join('')
      : '<div class="edu-empty-state">目前沒有未繳費資料</div>';
    overlay.innerHTML = '<div class="edu-info-dialog edu-unpaid-dialog" role="dialog" aria-modal="true" aria-labelledby="edu-unpaid-dialog-title">'
      + '<div class="edu-unpaid-dialog-head">'
      + '<div>'
      + '<span>未繳費提醒</span>'
      + '<h3 id="edu-unpaid-dialog-title">您尚有 ' + Number(summary.total || 0) + ' 筆未繳費</h3>'
      + '</div>'
      + '<button type="button" class="modal-close-btn" aria-label="關閉" onclick="this.closest(\'.edu-info-overlay\').remove()">×</button>'
      + '</div>'
      + '<div class="edu-info-dialog-body edu-unpaid-dialog-body">'
      + '<p class="edu-unpaid-summary-copy">以下是尚未登記繳費的課堂與學員名單。</p>'
      + planHtml
      + '<p class="edu-unpaid-reflect-note">如果已經繳費，請俱樂部職員協助在課堂名單內勾選已繳費。</p>'
      + '</div>'
      + '<button type="button" class="primary-btn" onclick="this.closest(\'.edu-info-overlay\').remove()">知道了</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

});
