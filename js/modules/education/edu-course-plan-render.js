/* ================================================
   SportHub — Education: Course Plan Render
   ================================================
   課程方案列表渲染（方案卡片、報名按鈕、管理按鈕、排序按鈕）
   從 edu-course-plan.js 拆分
   ================================================ */

Object.assign(App, {
  _eduCoursePlanListRequestSeq: 0,

  async renderEduCoursePlanList(teamId, isStaff, options = {}) {
    const container = document.getElementById('edu-course-plan-list');
    if (!container) return;
    const requestSeq = ++this._eduCoursePlanListRequestSeq;
    const isStale = () => requestSeq !== this._eduCoursePlanListRequestSeq
      || document.getElementById('edu-course-plan-list') !== container
      || (this._eduDetailTeamId && this._eduDetailTeamId !== teamId)
      || (this.currentPage && this.currentPage !== 'page-team-detail');
    const forceRefresh = !!options.forceRefresh;

    // 若未傳入 isStaff，自動判斷
    if (isStaff === undefined) isStaff = this.isEduClubStaff(teamId);
    if (forceRefresh) {
      container.innerHTML = '<div class="edu-loading"><div class="edu-loading-bar"><div class="edu-loading-fill"></div></div><div class="edu-loading-text">正在更新課程狀態</div></div>';
      if (typeof this._loadEduStudents === 'function') {
        await this._loadEduStudents(teamId);
        if (isStale()) return false;
      }
    }

    const plans = await this._loadEduCoursePlans(teamId);
    if (isStale()) return false;
    const activePlans = plans.filter(p => p.active !== false)
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });

    if (!activePlans.length) {
      container.innerHTML = '<div class="edu-empty-state">尚未建立課程方案</div>';
      return;
    }

    // 取得當前用戶的報名狀態（用於學員視角按鈕）
    const today = this._todayStr?.() || (() => {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    const isPlanEnded = (plan) => !!(plan && plan.endDate && plan.endDate < today);
    this._eduCoursePlanTabByTeam = this._eduCoursePlanTabByTeam || {};
    const selectedTab = this._eduCoursePlanTabByTeam[teamId] === 'ended' ? 'ended' : 'active';

    const curUser = ApiService.getCurrentUser();
    const myUid = curUser?.uid;
    const students = this.getEduStudents(teamId);
    const autoMigrationCompleted = typeof isEduAutoMigrationCompleted === 'function'
      && isEduAutoMigrationCompleted();

    // 平行載入各方案的報名紀錄（Promise.all 取代串行 for-await）
    await Promise.all(activePlans.map(async (p) => {
      try {
        const key = this._getCourseEnrollCacheKey?.(teamId, p.id);
        if (key && (forceRefresh || !this._courseEnrollCache?.[key])) {
          p._enrollments = await this._loadCourseEnrollments?.(teamId, p.id) || [];
        } else {
          p._enrollments = (key && this._courseEnrollCache?.[key]) || [];
        }
        p._enrollmentSummary = p._enrollments?._summary
          || (key && this._courseEnrollSummaryCache?.[key])
          || null;
      } catch (_) { p._enrollments = []; p._enrollmentSummary = null; }
      const summaryCount = Number(p._enrollmentSummary?.effectiveApprovedCount);
      if (Number.isFinite(summaryCount) && summaryCount >= 0) {
        p._effectiveCount = summaryCount;
      } else {
        const enrolledIds = new Set(p._enrollments.filter(e => e.status === 'approved').map(e => e.studentId));
        if (!autoMigrationCompleted && p.groupId) {
          students.filter(s => s.enrollStatus === 'active' && (s.groupIds || []).includes(p.groupId))
            .forEach(s => enrolledIds.add(s.id));
        }
        p._effectiveCount = enrolledIds.size;
      }
    }));
    if (isStale()) return false;

    const listPlans = activePlans.filter(p => isStaff || p.visibleOnTeamPage !== false);
    const currentPlans = listPlans.filter(p => !isPlanEnded(p));
    const endedPlans = listPlans.filter(isPlanEnded);
    const displayPlans = selectedTab === 'ended' ? endedPlans : currentPlans;

    const formatMoney = (value) => {
      const amount = Number(value || 0);
      return Number.isFinite(amount) && amount > 0 ? 'NT$ ' + amount.toLocaleString() : '免費';
    };
    const renderCompactPill = (label, value, className = '') => '<span class="edu-cp-compact-pill ' + className + '"><span>' + escapeHTML(label) + '</span><strong>' + escapeHTML(value || '未設定') + '</strong></span>';
    const jsArg = (value) => escapeHTML(String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '));
    const renderPlanCard = (p) => {
      const coverImage = String(this._getCoursePlanCoverUrl?.(p) || p.coverImage || p.coverUrl || p.imageUrl || p.image || p.imageVariants?.cover || '').trim();
      const coverClass = coverImage ? ' has-cover' : '';
      const coverHtml = coverImage
        ? '<img class="edu-cp-compact-cover" src="' + escapeHTML(coverImage) + '" alt="" loading="lazy" decoding="async">'
        : '';
      const isHidden = p.visibleOnTeamPage === false;
      const hiddenClass = isHidden ? ' edu-cp-card-hidden' : '';
      const hiddenBadge = isStaff && isHidden ? '<span class="edu-cp-card-hidden-badge">未公開</span>' : '';
      const planEnded = isPlanEnded(p);
      const statusBadge = planEnded
        ? '<span class="edu-cp-status edu-cp-status-ended">已結束</span>'
        : p.allowSignup
          ? '<span class="edu-cp-status edu-cp-status-open">招生中</span>'
          : '<span class="edu-cp-status edu-cp-status-closed">暫停報名</span>';

      // 課程是否已結束
      const isEnded = planEnded;

      // Compact card info: keep only the fields needed for scan-and-decide.
      const dateText = p.startDate ? p.startDate + ' ~ ' + (p.endDate || '') : '未設定';
      const countText = (p._effectiveCount || 0) + (p.maxCapacity ? '/' + p.maxCapacity : '') + ' 人';
      const coachName = String(p.coachName || p.coach || '').trim() || '未指定教練';
      const infoHtml = '<div class="edu-cp-compact-pills">'
        + renderCompactPill('上課', dateText, 'edu-cp-date-pill')
        + renderCompactPill('費用', formatMoney(p.price), 'edu-cp-fee-pill')
        + renderCompactPill('人數', countText, 'edu-cp-count-pill')
        + renderCompactPill('教練', coachName, 'edu-cp-coach-pill')
        + '</div>';

      // 學員報名按鈕
      let signupBtn = '';
      if (p.allowSignup) {
        if (isEnded) {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn edu-cp-signup-disabled" disabled>課程已結束</button>';
        } else {
        const isFull = p.maxCapacity && (p._effectiveCount || 0) >= p.maxCapacity;
        // 檢查用戶名下所有學員是否都已報名（含分組自動導入的）
        const myStudents = students.filter(s =>
          s.enrollStatus !== 'inactive' && (s.selfUid === myUid || s.parentUid === myUid)
        );
        // 分組學員也視為已報名
        const enrolledStudentIds = new Set(
          (p._enrollments || []).filter(e => e.status !== 'rejected').map(e => e.studentId)
        );
        const viewerStatuses = p._enrollmentSummary?.viewerStatuses || {};
        Object.keys(viewerStatuses).forEach(studentId => {
          if (viewerStatuses[studentId] !== 'rejected') enrolledStudentIds.add(studentId);
        });
        if (!autoMigrationCompleted && p.groupId) {
          students.filter(s => s.enrollStatus === 'active' && (s.groupIds || []).includes(p.groupId))
            .forEach(s => enrolledStudentIds.add(s.id));
        }
        const allEnrolled = myStudents.length > 0 && myStudents.every(s => enrolledStudentIds.has(s.id));

        if (allEnrolled) {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn edu-cp-signup-disabled" disabled>學員皆已報名</button>';
        } else if (isFull) {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn edu-cp-signup-disabled" disabled>已額滿</button>';
        } else {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn" onclick="event.stopPropagation();App.applyCourseEnrollment(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\')">我要報名</button>';
        }
        } // end else (not ended)
      }

      // 管理按鈕（報名按鈕之下，左對齊 + 右側排序按鈕）
      const idx = displayPlans.indexOf(p);
      const manageHtml = isStaff
        ? '<div class="edu-cp-manage-left">'
          + '<button type="button" class="edu-cp-manage-btn edu-cp-manage-list" onclick="event.stopPropagation();App.showCourseEnrollmentList(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\')">名單</button>'
          + '<button type="button" class="edu-cp-manage-btn edu-cp-manage-edit" onclick="event.stopPropagation();App.showEduCoursePlanForm(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\')">編輯</button>'
          + '<button type="button" class="edu-cp-manage-btn edu-cp-manage-danger" onclick="event.stopPropagation();App.deleteEduCoursePlan(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\')">刪除</button>'
          + '<span class="edu-cp-manage-sort">'
          + (idx > 0 ? '<button type="button" class="edu-cp-manage-icon-btn" onclick="event.stopPropagation();App._moveCoursePlan(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\',-1)" title="向上">▲</button>' : '')
          + (idx < displayPlans.length - 1 ? '<button type="button" class="edu-cp-manage-icon-btn" onclick="event.stopPropagation();App._moveCoursePlan(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\',1)" title="向下">▼</button>' : '')
          + '<button type="button" class="edu-cp-manage-icon-btn edu-cp-pin-btn' + (p.pinned ? ' edu-cp-pin-active' : '') + '" onclick="event.stopPropagation();App._moveCoursePlan(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\',0)" title="' + (p.pinned ? '取消置頂' : '置頂') + '">★</button>'
          + '</span>'
          + '</div>'
        : '';

      const detailBtn = '<button class="outline-btn edu-cp-detail-btn" onclick="event.stopPropagation();App.showEduCoursePlanDetail(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\')">詳細資訊</button>';

      return '<div class="edu-course-card edu-cp-card-v3 edu-cp-card-compact edu-cp-card-' + (p.planType === 'weekly' ? 'weekly' : 'session') + hiddenClass + coverClass + '" data-course-plan-id="' + escapeHTML(p.id || '') + '">'
        + coverHtml
        + hiddenBadge
        + '<div class="edu-cp-compact-main">'
        + '<div class="edu-cp-compact-title">'
        + '<span class="edu-course-name">' + escapeHTML(p.name) + '</span>'
        + statusBadge
        + '</div>'
        + infoHtml
        + '</div>'
        + '<div class="edu-cp-card-actions">' + detailBtn + signupBtn + '</div>'
        + manageHtml
        + '</div>';
    };

    const groupedPlans = [
      {
        type: 'weekly',
        title: '固定週期課程',
        hint: '固定日期與時段，適合長期訓練。',
        plans: displayPlans.filter(p => p.planType === 'weekly'),
      },
      {
        type: 'session',
        title: '堂數制課程',
        hint: '依堂數安排，適合彈性訓練。',
        plans: displayPlans.filter(p => p.planType !== 'weekly'),
      },
    ].filter(group => group.plans.length);

    const tabHtml = '<div class="edu-cp-view-tabs">'
      + '<button type="button" class="' + (selectedTab === 'active' ? 'active' : '') + '" onclick="App.switchEduCoursePlanTab(\'' + teamId + '\',\'active\')">\u8ab2\u7a0b\u4e2d <span>' + currentPlans.length + '</span></button>'
      + '<button type="button" class="' + (selectedTab === 'ended' ? 'active' : '') + '" onclick="App.switchEduCoursePlanTab(\'' + teamId + '\',\'ended\')">\u5df2\u7d50\u675f <span>' + endedPlans.length + '</span></button>'
      + '</div>';
    const emptyText = selectedTab === 'ended' ? '\u76ee\u524d\u6c92\u6709\u5df2\u7d50\u675f\u8ab2\u7a0b' : '\u76ee\u524d\u6c92\u6709\u9032\u884c\u4e2d\u8ab2\u7a0b';
    const listHtml = groupedPlans.length
      ? groupedPlans.map(group => '<section class="edu-course-plan-section edu-course-plan-section-' + group.type + '">'
          + '<div class="edu-course-plan-section-head"><div><strong>' + group.title + '</strong><span>' + group.hint + '</span></div><em>' + group.plans.length + ' 個方案</em></div>'
          + '<div class="edu-course-plan-grid">' + group.plans.map(renderPlanCard).join('') + '</div>'
          + '</section>').join('')
      : '<div class="edu-empty-state">' + emptyText + '</div>';

    container.innerHTML = tabHtml + '<div class="edu-course-plan-sections">'
      + listHtml
      + '</div>';
  },

  switchEduCoursePlanTab(teamId, tab) {
    if (!teamId) return;
    this._eduCoursePlanTabByTeam = this._eduCoursePlanTabByTeam || {};
    this._eduCoursePlanTabByTeam[teamId] = tab === 'ended' ? 'ended' : 'active';
    return this.renderEduCoursePlanList(teamId, this.isEduClubStaff?.(teamId));
  },

  _renderCoursePlanHiddenNotice(plan) {
    const existing = document.querySelector?.('.edu-course-detail-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay edu-course-detail-overlay edu-course-detail-hidden-overlay';
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog edu-course-detail-hidden-dialog">'
      + '<div class="edu-info-dialog-title">課程尚未公開</div>'
      + '<div class="edu-info-dialog-body">「' + escapeHTML(plan?.name || '此課程') + '」目前只開放俱樂部職員管理，尚未顯示在公開課程清單。</div>'
      + '<button type="button" class="primary-btn" onclick="this.closest(\'.edu-info-overlay\').remove()">知道了</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

  async showEduCoursePlanDetail(teamId, planId) {
    const plan = (this.getEduCoursePlans?.(teamId) || []).find(item => String(item.id || item._docId || '') === String(planId || ''));
    if (!plan) {
      this.showToast?.('找不到課程資料');
      return;
    }
    const isStaff = !!this.isEduClubStaff?.(teamId);
    const curUser = typeof ApiService !== 'undefined' && typeof ApiService.getCurrentUser === 'function'
      ? ApiService.getCurrentUser()
      : null;
    const requestKey = teamId + ':' + planId + ':' + Date.now();
    this._eduCoursePlanDetailRequestKey = requestKey;
    if (plan.visibleOnTeamPage === false && !isStaff && !Array.isArray(plan._enrollments) && typeof this._loadCourseEnrollments === 'function') {
      try {
        plan._enrollments = await this._loadCourseEnrollments(teamId, plan.id);
      } catch (_) {
        plan._enrollments = [];
      }
      if (this._eduCoursePlanDetailRequestKey !== requestKey) return;
    }
    const canViewPlan = typeof this._isCoursePlanVisibleToUser === 'function'
      ? this._isCoursePlanVisibleToUser(plan, { uid: curUser?.uid, teamId, isStaff })
      : (isStaff || plan.visibleOnTeamPage !== false);
    if (!canViewPlan) {
      this._renderCoursePlanHiddenNotice?.(plan);
      return;
    }
    let sessions = [];
    if (plan.planType === 'session') {
      const cacheKey = this._getCourseSessionCacheKey?.(teamId, plan.id);
      sessions = (cacheKey && this._courseSessionCache?.[cacheKey]) || [];
      if (!sessions.length && typeof this._loadCourseSessions === 'function') {
        try {
          sessions = await this._loadCourseSessions(teamId, plan.id);
        } catch (_) {
          sessions = [];
        }
      }
      if (this._eduCoursePlanDetailRequestKey !== requestKey) return;
    }
    const jsArg = (value) => escapeHTML(String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '));
    const detailToday = this._todayStr?.() || (() => {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    const view = typeof this._normalizeCoursePlanViewModel === 'function'
      ? this._normalizeCoursePlanViewModel(plan)
      : {
          name: plan.name || '未命名課程',
          typeLabel: plan.planType === 'session' ? '堂數制' : '固定週期',
          groupName: plan.groupName || '未分班',
          coverUrl: String(plan.coverImage || plan.coverUrl || '').trim(),
          dateText: plan.startDate ? plan.startDate + ' ~ ' + (plan.endDate || '') : '未設定',
          scheduleText: plan.planType === 'weekly'
            ? ((plan.weekdays || []).map(day => '週' + this._weekdayLabel(day)).join('、') || '未設定') + (plan.timeSlot ? ' ' + plan.timeSlot : '')
            : '共 ' + (plan.totalSessions || 0) + ' 堂',
          priceText: Number(plan.price || 0) > 0 ? 'NT$ ' + Number(plan.price || 0).toLocaleString() : '免費',
          countText: (plan._effectiveCount || 0) + (plan.maxCapacity ? '/' + plan.maxCapacity : '') + ' 人',
          status: { label: plan.endDate && plan.endDate < detailToday ? '已結束' : (plan.allowSignup ? '招生中' : '暫停報名') },
          tags: [],
        };
    const existing = document.querySelector?.('.edu-course-detail-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay edu-course-detail-overlay';
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };

    const nextWeekly = this._getCoursePlanNextWeeklyOccurrence?.(plan);
    const formatCurrency = (value) => {
      const amount = Number(value || 0);
      return Number.isFinite(amount) && amount > 0 ? '$' + amount.toLocaleString() : '免費';
    };
    const parseDateOnly = (value) => {
      const parts = String(value || '').split('-').map(part => parseInt(part, 10));
      if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return null;
      return new Date(parts[0], parts[1] - 1, parts[2]);
    };
    const getStartTime = (value) => String(value || '').split(/[-~]/)[0].trim();
    const formatProgressDate = (dateValue, timeValue) => {
      const parsed = parseDateOnly(dateValue);
      const time = getStartTime(timeValue);
      if (!parsed) return [String(dateValue || '').trim(), time].filter(Boolean).join(' ');
      const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
      return (parsed.getMonth() + 1) + '/' + String(parsed.getDate()).padStart(2, '0')
        + '（' + weekdays[parsed.getDay()] + '）' + (time ? ' ' + time : '');
    };
    const getDateTimeMs = (dateValue, timeValue) => {
      const parsed = parseDateOnly(dateValue);
      if (!parsed) return 0;
      const match = getStartTime(timeValue).match(/^(\d{1,2}):(\d{2})/);
      if (match) parsed.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
      return parsed.getTime();
    };
    const getLessonStatusMeta = (lesson) => {
      const status = String(lesson?.status || '').trim();
      if (status === 'cancelled') return { label: '已取消', cls: 'is-cancelled' };
      if (status === 'done') return { label: '已上課', cls: 'is-done' };
      const timestamp = Number(lesson?.timestamp || 0);
      const now = Date.now();
      if (timestamp && timestamp < now - 6 * 60 * 60 * 1000) return { label: '已上課', cls: 'is-done' };
      if (timestamp && timestamp <= now + 7 * 24 * 60 * 60 * 1000) return { label: '即將上課', cls: 'is-soon' };
      return { label: '未上課', cls: 'is-upcoming' };
    };
    const weeklyDates = plan.planType === 'weekly' && typeof this.generateWeeklyDates === 'function'
      ? this.generateWeeklyDates(plan)
      : [];
    const weeklyStartTime = getStartTime(plan.timeSlot);
    const weeklyLessons = weeklyDates.length
      ? weeklyDates.map((date, index) => ({
          title: Array.isArray(plan.lessonTitles) && plan.lessonTitles[index] ? plan.lessonTitles[index] : '第 ' + (index + 1) + ' 堂課',
          dateLabel: formatProgressDate(date, weeklyStartTime),
          timestamp: getDateTimeMs(date, weeklyStartTime),
        }))
      : (nextWeekly ? [{
          title: '下一堂課',
          dateLabel: nextWeekly.label || '',
          timestamp: nextWeekly.timestamp || 0,
        }] : []);
    const sessionLessons = sessions.map((session, index) => {
      const fallbackDate = typeof this._formatCourseSessionDate === 'function'
        ? this._formatCourseSessionDate(session)
        : (session.date || '');
      const fallbackTime = typeof this._formatCourseSessionTime === 'function'
        ? this._formatCourseSessionTime(session)
        : [session.startTime, session.endTime].filter(Boolean).join(' - ');
      return {
        title: String(session.title || session.topic || session.focus || ('第 ' + (index + 1) + ' 堂課')).trim(),
        dateLabel: session.date
          ? formatProgressDate(session.date, session.startTime || fallbackTime)
          : [fallbackDate, getStartTime(fallbackTime)].filter(Boolean).join(' '),
        location: session.location || plan.location || '',
        status: session.status,
        timestamp: typeof this._getCourseSessionSortValue === 'function'
          ? this._getCourseSessionSortValue(session)
          : getDateTimeMs(session.date, session.startTime),
      };
    });
    const referenceSession = sessions.map(session => ({
      session,
      timestamp: typeof this._getCourseSessionSortValue === 'function'
        ? this._getCourseSessionSortValue(session)
        : getDateTimeMs(session.date, session.startTime),
    })).filter(item => item.timestamp)
      .sort((a, b) => Math.abs(a.timestamp - Date.now()) - Math.abs(b.timestamp - Date.now()))[0]?.session
      || sessions[0]
      || null;
    const teamRecord = (typeof this._getEduTeamRecord === 'function' ? this._getEduTeamRecord(teamId) : null)
      || (typeof ApiService !== 'undefined' && ApiService.getTeam ? ApiService.getTeam(teamId) : null)
      || {};
    const leaderNames = Array.isArray(teamRecord.leaders)
      ? teamRecord.leaders
      : (teamRecord.leader ? [teamRecord.leader] : []);
    const managerName = String(
      plan.managerName
      || plan.contactName
      || referenceSession?.managerName
      || teamRecord.captain
      || teamRecord.captainName
      || leaderNames[0]
      || plan.coachName
      || plan.coach
      || ''
    ).trim();
    const managerContact = String(
      plan.managerContact
      || plan.contact
      || referenceSession?.managerContact
      || teamRecord.contact
      || teamRecord.eduSettings?.contact
      || ''
    ).trim();
    const renderContactValue = (value) => {
      const raw = String(value || '').trim();
      if (!raw) return '<span class="edu-course-contact-value">未設定</span>';
      const isUrl = /^https?:\/\//i.test(raw) || /^line:\/\//i.test(raw) || /^mailto:/i.test(raw) || /^tel:/i.test(raw);
      if (!isUrl) return '<span class="edu-course-contact-value">' + escapeHTML(raw) + '</span>';
      return '<a class="edu-course-contact-value" href="' + escapeHTML(raw) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(raw) + '</a>';
    };
    const hasNumber = (value) => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value));
    const renderOptionalRow = (label, value) => {
      const raw = String(value == null ? '' : value).trim();
      if (!raw) return '';
      return '<div class="edu-course-detail-field-row"><span>' + escapeHTML(label) + '</span><strong>' + escapeHTML(raw) + '</strong></div>';
    };
    const renderOptionalSection = (className, title, rows) => {
      const body = rows.map(row => renderOptionalRow(row.label, row.value)).filter(Boolean).join('');
      return body
        ? '<section class="edu-course-detail-section ' + className + '"><h4>' + escapeHTML(title) + '</h4><div class="edu-course-detail-field-list">' + body + '</div></section>'
        : '';
    };
    const minAgeText = hasNumber(plan.minAge) ? String(Number(plan.minAge)) : '';
    const maxAgeText = hasNumber(plan.maxAge) ? String(Number(plan.maxAge)) : '';
    const ageRestrictionText = minAgeText && maxAgeText
      ? minAgeText + ' - ' + maxAgeText + ' 歲'
      : minAgeText
        ? minAgeText + ' 歲以上'
        : maxAgeText
          ? maxAgeText + ' 歲以下'
          : '';
    const genderRestrictionText = plan.genderRestriction === 'male'
      ? '限男性'
      : plan.genderRestriction === 'female'
        ? '限女性'
        : '';
    const minCapacityText = hasNumber(plan.minCapacity) ? String(Number(plan.minCapacity)) + ' 人開班' : '';
    const lessons = plan.planType === 'session' ? sessionLessons : weeklyLessons;
    const totalLessonCount = Number(plan.totalSessions || 0) || lessons.length;
    const visibleLessons = lessons;
    const priceAmount = Number(plan.price || 0);
    const priceSubText = priceAmount > 0 && totalLessonCount > 0
      ? totalLessonCount + ' 堂 · 約 $' + Math.round(priceAmount / totalLessonCount).toLocaleString() + '/堂'
      : (totalLessonCount > 0 ? totalLessonCount + ' 堂' : '課程價格');
    const tagHtml = (view.tags || []).length
      ? '<div class="edu-course-detail-tags">' + view.tags.map(tag => '<span>' + escapeHTML(tag) + '</span>').join('') + '</div>'
      : '';
    const metaHtml = [
      { label: '期間', value: view.dateText, cls: 'period' },
      { label: '上課安排', value: view.scheduleText, cls: 'schedule' },
      { label: '下一堂', value: nextWeekly?.label || '未排定', cls: 'next' },
      { label: '地點', value: plan.location || '未設定', cls: 'location' },
      { label: '負責人', value: managerName || '未設定', cls: 'manager' },
      { label: '教練', value: plan.coachName || plan.coach || '未設定', cls: 'coach' },
      { label: '人數', value: view.countText, cls: 'capacity' },
    ].map(item => '<span class="edu-course-meta-card edu-course-meta-' + item.cls + '"><em>' + escapeHTML(item.label) + '</em><strong>' + escapeHTML(item.value) + '</strong></span>').join('');
    const courseContent = String(plan.courseContent || plan.description || '').trim();
    const courseContentHtml = '<section class="edu-course-detail-section edu-course-detail-content">'
      + '<h4>課程內容</h4>'
      + '<p class="edu-course-detail-copy">' + escapeHTML(courseContent || '尚未填寫課程內容。') + '</p>'
      + '</section>';
    const primaryTagSet = new Set((view.tags || []).map(tag => String(tag || '').trim()).filter(Boolean));
    const extraTagSet = new Set();
    const extraTags = [
      ...(Array.isArray(plan.targetTags) ? plan.targetTags : []),
      ...(Array.isArray(plan.includedTags) ? plan.includedTags : []),
      ...(Array.isArray(plan.requirementTags) ? plan.requirementTags : []),
    ].map(tag => String(tag || '').trim())
      .filter(tag => tag && !primaryTagSet.has(tag) && !extraTagSet.has(tag) && extraTagSet.add(tag))
      .slice(0, 9);
    const extraTagsHtml = extraTags.length
      ? '<div class="edu-course-detail-tags edu-course-detail-tags-secondary">' + extraTags.map(tag => '<span>' + escapeHTML(tag) + '</span>').join('') + '</div>'
      : '';
    const progressRowsHtml = visibleLessons.length
      ? visibleLessons.map((lesson, index) => {
          const statusMeta = getLessonStatusMeta(lesson);
          const lessonMeta = [lesson.dateLabel, lesson.location].filter(Boolean).join(' · ');
          return '<div class="edu-course-progress-row">'
            + '<span class="edu-course-progress-index">' + (index + 1) + '</span>'
            + '<div class="edu-course-progress-main">'
              + '<strong>' + escapeHTML(lesson.title || ('第 ' + (index + 1) + ' 堂課')) + '</strong>'
              + '<em>' + escapeHTML(lessonMeta || '時間待排定') + '</em>'
            + '</div>'
            + '<span class="edu-course-progress-status ' + statusMeta.cls + '">' + escapeHTML(statusMeta.label) + '</span>'
          + '</div>';
        }).join('')
        + (lessons.length > visibleLessons.length ? '<div class="edu-course-progress-more">還有 ' + (lessons.length - visibleLessons.length) + ' 堂課</div>' : '')
      : '<div class="edu-course-progress-empty">尚未建立課堂，建立後會顯示課程日期、時間與狀態。</div>';
    const progressHtml = '<section class="edu-course-detail-section edu-course-detail-progress">'
      + '<h4>課程進度（共 ' + (totalLessonCount || 0) + ' 堂）</h4>'
      + '<div class="edu-course-progress-list">' + progressRowsHtml + '</div>'
      + '</section>';
    const signupInfoHtml = renderOptionalSection('edu-course-detail-signup-info', '報名提醒', [
      { label: '報名截止', value: plan.signupDeadline },
      { label: '最低開班', value: minCapacityText },
      { label: '年齡提醒', value: ageRestrictionText },
      { label: '性別提醒', value: genderRestrictionText },
      { label: '試上說明', value: plan.trialSessionInfo },
    ]);
    const contactHtml = '<section class="edu-course-detail-section edu-course-detail-contact">'
      + '<h4>課務聯繫</h4>'
      + '<div class="edu-course-contact-list">'
        + '<div class="edu-course-contact-person"><span>負責人</span><strong>' + escapeHTML(managerName || '未設定') + '</strong></div>'
        + '<div class="edu-course-contact-channel"><span>聯繫方式</span>' + renderContactValue(managerContact) + '</div>'
        + (isStaff && String(plan.notifyTargets || '').trim() ? '<div class="edu-course-contact-notify"><span>報名通知</span><strong>' + escapeHTML(String(plan.notifyTargets || '').trim()) + '</strong></div>' : '')
      + '</div>'
      + '</section>';
    const policyHtml = renderOptionalSection('edu-course-detail-policy', '規則與付款', [
      { label: '付款方式', value: plan.paymentMethod },
      { label: '付款期限', value: plan.paymentDeadline },
      { label: '補課規則', value: plan.makeupPolicy },
      { label: '取消政策', value: plan.cancellationPolicy },
    ]);
    const signupReminderText = [ageRestrictionText, genderRestrictionText].filter(Boolean).join(' · ');
    const signupReminderHtml = signupReminderText
      ? '<div class="edu-course-detail-signup-note">提醒：' + escapeHTML(signupReminderText) + '</div>'
      : '';
    const staffActions = isStaff
      ? '<div class="edu-course-detail-staff-actions">'
        + '<button type="button" class="outline-btn small" onclick="event.stopPropagation();this.closest(\'.edu-info-overlay\').remove();App.showEduCoursePlanForm(\'' + jsArg(teamId) + '\',\'' + jsArg(plan.id) + '\')">編輯課程</button>'
        + '<button type="button" class="outline-btn small" onclick="event.stopPropagation();this.closest(\'.edu-info-overlay\').remove();App.showCourseEnrollmentList(\'' + jsArg(teamId) + '\',\'' + jsArg(plan.id) + '\')">名單管理</button>'
        + '</div>'
      : '';
    const signupActionHtml = !isStaff && plan.visibleOnTeamPage !== false && plan.allowSignup && !this._isCoursePlanEnded?.(plan)
      ? '<button type="button" class="primary-btn edu-course-detail-signup-btn" onclick="event.stopPropagation();this.closest(\'.edu-info-overlay\').remove();App.applyCourseEnrollment(\'' + jsArg(teamId) + '\',\'' + jsArg(plan.id) + '\')">立即報名</button>'
      : '';
    overlay.innerHTML = '<div class="edu-info-dialog edu-course-detail-dialog">'
      + '<div class="edu-course-detail-head">'
        + '<div>'
          + '<span class="edu-course-detail-eyebrow">' + escapeHTML(view.typeLabel) + ' · ' + escapeHTML(view.status?.label || '') + '</span>'
          + '<h3>' + escapeHTML(view.name) + '</h3>'
          + '<p>' + escapeHTML(view.groupName) + '</p>'
        + '</div>'
        + '<button class="modal-close-btn" onclick="this.closest(\'.edu-info-overlay\').remove()">×</button>'
      + '</div>'
      + '<div class="edu-course-detail-scroll">'
        + tagHtml
        + extraTagsHtml
        + '<div class="edu-course-detail-meta">' + metaHtml + '</div>'
        + courseContentHtml
        + signupInfoHtml
        + contactHtml
        + progressHtml
        + policyHtml
      + '</div>'
      + '<div class="edu-course-detail-footer">'
        + '<div class="edu-course-price-block"><strong>' + escapeHTML(formatCurrency(priceAmount)) + '</strong><span>' + escapeHTML(priceSubText) + '</span></div>'
        + '<div class="edu-course-detail-footer-actions">' + signupReminderHtml + staffActions + signupActionHtml + '</div>'
      + '</div>'
      + '</div>';
    document.body.appendChild(overlay);
  },

});
