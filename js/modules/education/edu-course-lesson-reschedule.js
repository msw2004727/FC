/* ================================================
   SportHub — Education: Course Lesson Reschedule
   ================================================
   固定週期課程的單堂自由改期：
   原課堂留在原位標記「已調課」，另建「（補課）」卡片重新開放報名
   ================================================ */

Object.assign(App, {
  _COURSE_LESSON_RESCHEDULED_STATUS: 'rescheduled',
  _COURSE_LESSON_MAKEUP_TITLE_MAX: 120,

  _getCourseLessonMakeupTitle(session) {
    const base = String(session?.title || session?.topic || session?.focus || '').trim() || '未命名課堂';
    const matched = base.match(/^(.*?)（補課(?:\s*(\d+))?）$/);
    const head = (matched ? matched[1] : base).trim() || '未命名課堂';
    const suffix = matched
      ? '（補課 ' + (Math.max(1, Number(matched[2]) || 1) + 1) + '）'
      : '（補課）';
    const room = Math.max(1, Number(this._COURSE_LESSON_MAKEUP_TITLE_MAX || 120) - suffix.length);
    return (head.length > room ? head.slice(0, room) : head) + suffix;
  },

  _getCourseLessonRescheduleBlockReason(plan, session) {
    if (!plan || !session) return 'missing';
    if (String(plan.planType || '').trim() !== 'weekly') return 'only_weekly';
    if (this._isCourseLessonRescheduledSession(session)) return 'already_rescheduled';
    const status = String(session.status || '').trim().toLowerCase();
    if (status === 'cancelled' || status === 'canceled' || status === 'removed') return 'cancelled';
    const cls = String(this._getCourseLessonStatusMeta(session)?.cls || '').trim().toLowerCase();
    if (status === 'done' || cls === 'done') return 'done';
    if (this._isCourseLessonConvertedToEvent(session)) return 'converted';
    return null;
  },

  _getCourseLessonRescheduleBlockMessage(reason) {
    if (reason === 'only_weekly') return '只有固定週期課程可以調課';
    if (reason === 'already_rescheduled') return '這堂課已經調課過，請改用補課卡片調整';
    if (reason === 'cancelled') return '已停課的課堂不能調課，請先取消停課';
    if (reason === 'done') return '已完成的課堂不能調課';
    if (reason === 'converted') return '此課堂已轉化成活動，請先處理對應活動再調課';
    return '這堂課目前不能調課';
  },

  _getCourseLessonOrderableSessions(sessions, excludeSessionId) {
    const excludeId = String(excludeSessionId || '').trim();
    return (Array.isArray(sessions) ? sessions : [])
      .filter((session) => {
        if (!session) return false;
        if (this._getCourseLessonSessionId(session) === excludeId) return false;
        if (this._isCourseLessonRescheduledSession(session)) return false;
        return Number(this._getCourseSessionSortValue(session)) > 0;
      })
      .sort((a, b) => this._getCourseSessionSortValue(a) - this._getCourseSessionSortValue(b));
  },

  _getCourseLessonCrossedSessions(sessions, sessionId, targetMs) {
    const target = Number(targetMs);
    const current = (Array.isArray(sessions) ? sessions : [])
      .find(session => this._getCourseLessonSessionId(session) === String(sessionId || '').trim());
    const currentMs = Number(this._getCourseSessionSortValue(current));
    if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(currentMs) || currentMs <= 0) return [];
    const low = Math.min(currentMs, target);
    const high = Math.max(currentMs, target);
    return this._getCourseLessonOrderableSessions(sessions, sessionId)
      .filter((session) => {
        const ms = Number(this._getCourseSessionSortValue(session));
        return ms > low && ms < high;
      });
  },

  _getCourseLessonRescheduleNeighbours(sessions, sessionId, targetMs) {
    const target = Number(targetMs);
    let before = null;
    let after = null;
    this._getCourseLessonOrderableSessions(sessions, sessionId).forEach((session) => {
      const ms = Number(this._getCourseSessionSortValue(session));
      if (ms <= target) before = session;
      else if (!after) after = session;
    });
    return { before, after };
  },

  _getCourseLessonShortLabel(session) {
    return String(session?.title || session?.topic || session?.focus || '').trim()
      || this._formatCourseLessonDateTime(session);
  },

  _renderCourseLessonRescheduleHintHtml(sessions, session, targetMs, crossed) {
    const sessionId = this._getCourseLessonSessionId(session);
    const neighbours = this._getCourseLessonRescheduleNeighbours(sessions, sessionId, targetMs);
    const positionText = neighbours.before && neighbours.after
      ? '「' + this._getCourseLessonShortLabel(neighbours.before) + '」與「' + this._getCourseLessonShortLabel(neighbours.after) + '」之間'
      : (neighbours.before
        ? '「' + this._getCourseLessonShortLabel(neighbours.before) + '」之後'
        : '所有課堂之前');
    return '<div class="edu-course-lesson-reschedule-hint">'
      + '<strong>' + escapeHTML('這個時間會跨過 ' + crossed.length + ' 堂課，將以「調課」處理') + '</strong>'
      + '<ol>'
        + '<li>' + escapeHTML('原本「' + this._formatCourseLessonDateTime(session) + '」的課堂會標記為「已調課」，留在原位置，不可再報名。') + '</li>'
        + '<li>' + escapeHTML('系統會在 ' + positionText + ' 新增「' + this._getCourseLessonMakeupTitle(session) + '」。') + '</li>'
        + '<li>' + escapeHTML('補課卡片重新開放報名，原本已報名的學員需要重新報名。') + '</li>'
      + '</ol>'
    + '</div>';
  },

  refreshCourseLessonAdjustRescheduleHint() {
    const ctx = this._eduCourseLessonAdjustContext;
    const host = document.getElementById('edu-lesson-adjust-reschedule-hint');
    if (!ctx || !host) return false;
    const readValue = id => String(document.getElementById(id)?.value || '').trim();
    const targetMs = this._getCourseLessonDateTimeValue(
      readValue('edu-lesson-adjust-date'),
      readValue('edu-lesson-adjust-start'),
    );
    const crossed = ctx.supportsReschedule === true
      ? this._getCourseLessonCrossedSessions(ctx.sessions, ctx.sessionId, targetMs)
      : [];
    const blockReason = ctx.rescheduleBlockReason || null;
    if (!crossed.length) host.innerHTML = '';
    else if (blockReason) {
      host.innerHTML = '<div class="edu-course-lesson-reschedule-hint"><strong>'
        + escapeHTML(this._getCourseLessonRescheduleBlockMessage(blockReason))
        + '</strong></div>';
    } else {
      host.innerHTML = this._renderCourseLessonRescheduleHintHtml(ctx.sessions, ctx.session, targetMs, crossed);
    }
    const willReschedule = crossed.length > 0 && !blockReason;
    const saveBtn = document.getElementById('edu-lesson-adjust-save');
    if (saveBtn) saveBtn.textContent = willReschedule ? '確認調課' : '儲存調整';
    const cancelToggle = document.getElementById('edu-lesson-adjust-cancelled');
    if (cancelToggle) {
      cancelToggle.disabled = willReschedule;
      if (willReschedule) cancelToggle.checked = false;
    }
    const cancelNote = document.getElementById('edu-lesson-adjust-cancel-note');
    if (cancelNote) {
      cancelNote.textContent = willReschedule ? '調課時無法同時停課。' : '這堂課會顯示為停課，原名單保留。';
    }
    return true;
  },

  _buildCourseLessonMakeupPayload(session, form) {
    const studentIds = Array.isArray(session?.studentIds)
      ? Array.from(new Set(session.studentIds.map(value => String(value || '').trim()).filter(Boolean)))
      : [];
    const assistantCoaches = Array.isArray(session?.assistantCoaches) ? session.assistantCoaches : [];
    const lessonNumber = Number(session?.sessionNumber || session?.lessonNumber || 0);
    return {
      id: this._generateEduId('cls'),
      title: this._getCourseLessonMakeupTitle(session),
      status: 'scheduled',
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime,
      location: form.location,
      capacity: Number.isFinite(form.capacity) ? form.capacity : null,
      studentIds,
      managerName: String(session?.managerName || ''),
      managerContact: String(session?.managerContact || ''),
      coachName: String(session?.coachName || ''),
      coachContact: String(session?.coachContact || ''),
      assistantCoaches,
      assistantCoachNames: assistantCoaches.map(item => String(item?.name || '').trim()).filter(Boolean),
      focus: String(session?.focus || ''),
      notes: '',
      sessionNumber: Number.isFinite(lessonNumber) && lessonNumber > 0 ? lessonNumber : null,
      autoGenerated: false,
      makeupOfSessionId: this._getCourseLessonSessionId(session),
    };
  },

  _applyCourseLessonRescheduleCache(teamId, planId, sessionId, makeupSession) {
    const targetId = String(sessionId || '').trim();
    const makeupId = this._getCourseLessonSessionId(makeupSession);
    const applyToList = (list) => {
      if (!Array.isArray(list)) return;
      const original = list.find(item => this._getCourseLessonSessionId(item) === targetId);
      if (original) original.status = this._COURSE_LESSON_RESCHEDULED_STATUS;
      if (makeupId && !list.some(item => this._getCourseLessonSessionId(item) === makeupId)) {
        list.push(makeupSession);
      }
      list.sort((a, b) => this._getCourseSessionSortValue(a) - this._getCourseSessionSortValue(b));
    };
    this._markCourseSessionCacheMutated?.(teamId, planId);
    const cacheKey = this._getCourseSessionCacheKey?.(teamId, planId);
    if (cacheKey) applyToList(this._courseSessionCache?.[cacheKey]);
    const ctx = this._eduCourseLessonsContext;
    if (ctx?.mode === 'list'
      && String(ctx.teamId || '') === String(teamId || '')
      && String(ctx.planId || '') === String(planId || '')) {
      applyToList(ctx.sessions);
    }
    this._markCourseLessonRosterRefreshNeeded?.(teamId, planId, targetId);
    return true;
  },

  async _runCourseLessonReschedule(context, form) {
    const teamId = context?.teamId;
    const planId = context?.planId;
    const sessionId = String(context?.sessionId || '').trim();
    const session = context?.session;
    if (!teamId || !planId || !sessionId || !session) {
      this.showToast?.('缺少課堂資料，請重新開啟課堂列表');
      return { ok: false, reason: 'missing_context' };
    }
    const payload = this._buildCourseLessonMakeupPayload(session, form);
    let created = null;
    try {
      created = await FirebaseService.createCourseSession(teamId, planId, payload);
    } catch (err) {
      console.error('[courseLessonReschedule] create makeup failed:', err);
      this.showToast?.('補課卡片建立失敗，課堂沒有變更');
      return { ok: false, reason: 'create_failed' };
    }
    const makeupSession = created && (created.id || created._docId) ? created : payload;
    try {
      await FirebaseService.updateCourseSession(teamId, planId, sessionId, {
        status: this._COURSE_LESSON_RESCHEDULED_STATUS,
      });
    } catch (err) {
      console.error('[courseLessonReschedule] mark rescheduled failed:', err);
      const makeupId = this._getCourseLessonSessionId(makeupSession) || payload.id;
      try {
        await FirebaseService.deleteCourseSession(teamId, planId, makeupId);
        this.showToast?.('調課失敗，課堂已還原');
      } catch (rollbackErr) {
        console.error('[courseLessonReschedule] rollback failed:', rollbackErr);
        this.showToast?.('調課失敗，請手動刪除多出的補課卡片');
      }
      return { ok: false, reason: 'mark_failed' };
    }
    this._applyCourseLessonRescheduleCache(teamId, planId, sessionId, makeupSession);
    this.showToast?.('已完成調課，補課卡片已重新開放報名');
    return { ok: true, makeupSessionId: this._getCourseLessonSessionId(makeupSession) };
  },
});
