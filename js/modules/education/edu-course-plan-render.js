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
    const today = new Date().toISOString().slice(0, 10);
    const isPlanEnded = (plan) => !!(plan && plan.endDate && plan.endDate < today);
    const currentPlans = activePlans.filter(p => !isPlanEnded(p));
    const endedPlans = activePlans.filter(isPlanEnded);
    this._eduCoursePlanTabByTeam = this._eduCoursePlanTabByTeam || {};
    const selectedTab = this._eduCoursePlanTabByTeam[teamId] === 'ended' ? 'ended' : 'active';
    const displayPlans = selectedTab === 'ended' ? endedPlans : currentPlans;

    const curUser = ApiService.getCurrentUser();
    const myUid = curUser?.uid;
    const students = this.getEduStudents(teamId);

    // 平行載入各方案的報名紀錄（Promise.all 取代串行 for-await）
    await Promise.all(activePlans.map(async (p) => {
      try {
        const key = this._getCourseEnrollCacheKey?.(teamId, p.id);
        if (key && (forceRefresh || !this._courseEnrollCache?.[key])) {
          p._enrollments = await this._loadCourseEnrollments?.(teamId, p.id) || [];
        } else {
          p._enrollments = (key && this._courseEnrollCache?.[key]) || [];
        }
      } catch (_) { p._enrollments = []; }
      const enrolledIds = new Set(p._enrollments.filter(e => e.status === 'approved').map(e => e.studentId));
      if (p.groupId) {
        students.filter(s => s.enrollStatus === 'active' && (s.groupIds || []).includes(p.groupId))
          .forEach(s => enrolledIds.add(s.id));
      }
      p._effectiveCount = enrolledIds.size;
    }));
    if (isStale()) return false;

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
        if (p.groupId) {
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
          + '<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="event.stopPropagation();App.showCourseEnrollmentList(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\')">名單</button>'
          + '<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="event.stopPropagation();App.showEduCoursePlanForm(\'' + teamId + '\',\'' + p.id + '\')">編輯</button>'
          + '<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem;color:var(--danger)" onclick="event.stopPropagation();App.deleteEduCoursePlan(\'' + teamId + '\',\'' + p.id + '\')">刪除</button>'
          + '<span style="margin-left:auto;display:flex;gap:.2rem">'
          + (idx > 0 ? '<button class="outline-btn" style="font-size:.68rem;padding:.15rem .35rem" onclick="event.stopPropagation();App._moveCoursePlan(\'' + teamId + '\',\'' + p.id + '\',-1)" title="向上">▲</button>' : '')
          + (idx < displayPlans.length - 1 ? '<button class="outline-btn" style="font-size:.68rem;padding:.15rem .35rem" onclick="event.stopPropagation();App._moveCoursePlan(\'' + teamId + '\',\'' + p.id + '\',1)" title="向下">▼</button>' : '')
          + '<button class="' + (p.pinned ? 'edu-cp-pin-active' : 'outline-btn') + '" style="font-size:.68rem;padding:.15rem .35rem" onclick="event.stopPropagation();App._moveCoursePlan(\'' + teamId + '\',\'' + p.id + '\',0)" title="' + (p.pinned ? '取消置頂' : '置頂') + '">★</button>'
          + '</span>'
          + '</div>'
        : '';

      const clickAction = ' onclick="App.showEduCoursePlanDetail(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\')"';
      const detailBtn = '<button class="outline-btn edu-cp-detail-btn" onclick="event.stopPropagation();App.showEduCoursePlanDetail(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\')">詳細資訊</button>';

      return '<div class="edu-course-card edu-cp-card-v3 edu-cp-card-compact edu-cp-card-' + (p.planType === 'weekly' ? 'weekly' : 'session') + coverClass + '" data-course-plan-id="' + escapeHTML(p.id || '') + '"' + clickAction + '>'
        + coverHtml
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

  async showEduCoursePlanDetail(teamId, planId) {
    const plan = (this.getEduCoursePlans?.(teamId) || []).find(item => String(item.id || item._docId || '') === String(planId || ''));
    if (!plan) {
      this.showToast?.('找不到課程資料');
      return;
    }
    const requestKey = teamId + ':' + planId + ':' + Date.now();
    this._eduCoursePlanDetailRequestKey = requestKey;
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
          status: { label: plan.endDate && plan.endDate < new Date().toISOString().slice(0, 10) ? '已結束' : (plan.allowSignup ? '招生中' : '暫停報名') },
          tags: [],
        };
    const isStaff = !!this.isEduClubStaff?.(teamId);
    const existing = document.querySelector?.('.edu-course-detail-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay edu-course-detail-overlay';
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };

    const coverHtml = view.coverUrl
      ? '<div class="edu-course-detail-cover"><img src="' + escapeHTML(view.coverUrl) + '" alt="" loading="lazy" decoding="async"></div>'
      : '<div class="edu-course-detail-cover edu-course-detail-cover-empty"><span>Course</span></div>';
    const tagHtml = (view.tags || []).length
      ? '<div class="edu-course-detail-tags">' + view.tags.map(tag => '<span>' + escapeHTML(tag) + '</span>').join('') + '</div>'
      : '';
    const nextWeekly = this._getCoursePlanNextWeeklyOccurrence?.(plan);
    const fieldHtml = [
      ['期間', view.dateText],
      ['上課安排', view.scheduleText],
      ['下一堂', nextWeekly?.label || '未排定'],
      ['地點', plan.location || '未設定'],
      ['教練', plan.coachName || plan.coach || '未設定'],
      ['費用', view.priceText],
      ['人數', view.countText],
      ['報名截止', plan.signupDeadline || '未設定'],
    ].map(item => '<div><span>' + escapeHTML(item[0]) + '</span><strong>' + escapeHTML(item[1]) + '</strong></div>').join('');
    const description = String(plan.description || '').trim();
    const descriptionHtml = description
      ? '<div class="edu-course-detail-description"><span>課程說明</span><p>' + escapeHTML(description) + '</p></div>'
      : '';
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
    const sessionPreviewHtml = plan.planType === 'session'
      ? '<div class="edu-course-detail-sessions">'
        + '<strong>堂課摘要</strong>'
        + (sessions.length
          ? sessions.slice(0, 5).map((session, index) => {
              const dateLabel = typeof this._formatCourseSessionDate === 'function'
                ? this._formatCourseSessionDate(session)
                : (session.date || '未設定日期');
              const timeLabel = typeof this._formatCourseSessionTime === 'function'
                ? this._formatCourseSessionTime(session)
                : [session.startTime, session.endTime].filter(Boolean).join(' - ');
              return '<div><span>第 ' + (index + 1) + ' 堂</span><em>' + escapeHTML([dateLabel, timeLabel, session.location].filter(Boolean).join(' · ')) + '</em></div>';
            }).join('')
          : '<div><span>尚未建立堂課</span><em>建立堂課後會顯示時間、地點與聯繫資訊</em></div>')
        + '</div>'
      : '';
    const staffActions = isStaff
      ? '<button type="button" class="outline-btn small" onclick="event.stopPropagation();this.closest(\'.edu-info-overlay\').remove();App.showCourseEnrollmentList(\'' + jsArg(teamId) + '\',\'' + jsArg(plan.id) + '\')">管理名單</button>'
        + '<button type="button" class="outline-btn small" onclick="event.stopPropagation();this.closest(\'.edu-info-overlay\').remove();App.showEduCoursePlanForm(\'' + jsArg(teamId) + '\',\'' + jsArg(plan.id) + '\')">編輯課程</button>'
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
      + coverHtml
      + tagHtml
      + extraTagsHtml
      + descriptionHtml
      + '<div class="edu-course-detail-grid">'
        + fieldHtml
      + '</div>'
      + sessionPreviewHtml
      + '<div class="modal-actions">'
        + staffActions
        + (!isStaff && plan.allowSignup && !this._isCoursePlanEnded?.(plan) ? '<button type="button" class="primary-btn" onclick="event.stopPropagation();this.closest(\'.edu-info-overlay\').remove();App.applyCourseEnrollment(\'' + jsArg(teamId) + '\',\'' + jsArg(plan.id) + '\')">我要報名</button>' : '')
      + '</div>'
      + '</div>';
    document.body.appendChild(overlay);
  },

});
