/* ================================================
   SportHub — Education: Course Lessons
   ================================================ */

Object.assign(App, {
  _eduCourseLessonsRequestSeq: 0,
  _eduCourseLessonsContext: null,
  _eduCourseLessonAdjustContext: null,
  _eduCourseLessonsPreloadPromises: {},

  _getEduCourseLessonsContainer() {
    return document.getElementById('edu-course-lessons-page');
  },

  _setEduCourseLessonsTitle(text) {
    const title = document.getElementById('edu-course-lessons-title');
    if (title) title.textContent = text || '課堂列表';
  },

  _isEduCourseLessonsStale(requestSeq, teamId) {
    return requestSeq !== this._eduCourseLessonsRequestSeq
      || this.currentPage !== 'page-edu-course-lessons'
      || (teamId && this._eduCurrentTeamId && String(this._eduCurrentTeamId) !== String(teamId));
  },

  _findEduCoursePlan(teamId, planId) {
    return (this.getEduCoursePlans?.(teamId) || [])
      .find(plan => String(plan.id || plan._docId || '') === String(planId || '')) || null;
  },

  _getCourseLessonsPreloadKey(teamId, planId) {
    return String(teamId || '') + ':' + String(planId || '');
  },

  _getCourseLessonsCachedSessions(teamId, planId) {
    const key = this._getCourseSessionCacheKey?.(teamId, planId) || this._getCourseLessonsPreloadKey(teamId, planId);
    const cached = this._courseSessionCache?.[key];
    return Array.isArray(cached) ? cached : null;
  },

  _preloadCourseLessonsForPlans(teamId, plans) {
    if (!teamId || typeof this._loadCourseSessions !== 'function') return false;
    (Array.isArray(plans) ? plans : []).forEach((plan) => {
      const planId = String(plan?.id || plan?._docId || '').trim();
      if (!planId) return;
      const key = this._getCourseLessonsPreloadKey(teamId, planId);
      if (this._eduCourseLessonsPreloadPromises?.[key]) return;
      this._eduCourseLessonsPreloadPromises[key] = this._loadCourseSessions(teamId, planId)
        .catch((err) => {
          console.warn('[edu-course-lessons] preload failed:', err);
          return [];
        })
        .finally(() => {
          if (this._eduCourseLessonsPreloadPromises?.[key]) delete this._eduCourseLessonsPreloadPromises[key];
        });
    });
    return true;
  },

  _loadCourseLessonsSessions(teamId, planId) {
    const key = this._getCourseLessonsPreloadKey(teamId, planId);
    return this._eduCourseLessonsPreloadPromises?.[key] || this._loadCourseSessions(teamId, planId);
  },

  async _refreshCourseLessonsAfterSessionSave(teamId, planId, sessionId) {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || this.currentPage !== 'page-edu-course-lessons') return false;
    if (String(ctx.teamId || '') !== String(teamId || '') || String(ctx.planId || '') !== String(planId || '')) {
      return false;
    }

    if (ctx.mode === 'roster') {
      if (String(ctx.sessionId || '') !== String(sessionId || '')) return false;
      if (typeof this.showCourseLessonRoster !== 'function') return false;
      await this.showCourseLessonRoster(teamId, planId, sessionId);
      return true;
    }

    if (ctx.mode === 'list') {
      if (typeof this.showCourseLessons !== 'function') return false;
      await this.showCourseLessons(teamId, planId);
      return true;
    }

    return false;
  },

  async _loadEduCourseLessonsState(teamId, planId) {
    await this._loadEduCoursePlans?.(teamId);
    const plan = this._findEduCoursePlan(teamId, planId);
    if (!plan) return { plan: null, sessions: [] };
    const sessions = await this._loadCourseLessonsSessions(teamId, planId);
    return { plan, sessions };
  },

  async _getCourseLessonsCurrentStudentCount(teamId, plan) {
    const planId = String(plan?.id || plan?._docId || '').trim();
    if (!teamId || !planId) return null;
    if (typeof this._loadCourseEnrollmentSummaries === 'function') {
      const summaries = await this._loadCourseEnrollmentSummaries(teamId, [planId]);
      const summaryCount = Number(summaries?.[planId]?.effectiveApprovedCount);
      if (Number.isFinite(summaryCount) && summaryCount >= 0) {
        plan._effectiveCount = summaryCount;
        return summaryCount;
      }
    }
    const cachedCount = Number(plan?._effectiveCount);
    return Number.isFinite(cachedCount) && cachedCount >= 0 ? cachedCount : null;
  },

  _getCourseLessonSessionId(session) {
    return String(session?.id || session?._docId || '').trim();
  },

  _getCourseLessonDateTimeValue(dateValue, timeValue) {
    const date = String(dateValue || '').trim();
    const time = String(timeValue || '00:00').trim();
    const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) return NaN;
    const timeMatch = time.match(/^(\d{1,2}):(\d{2})/);
    const hour = timeMatch ? Math.max(0, Math.min(23, parseInt(timeMatch[1], 10))) : 0;
    const minute = timeMatch ? Math.max(0, Math.min(59, parseInt(timeMatch[2], 10))) : 0;
    return new Date(
      parseInt(dateMatch[1], 10),
      parseInt(dateMatch[2], 10) - 1,
      parseInt(dateMatch[3], 10),
      hour,
      minute
    ).getTime();
  },

  _getCourseLessonNextSession(sessions, sessionId) {
    const currentId = String(sessionId || '').trim();
    if (!currentId) return null;
    const sorted = [...(Array.isArray(sessions) ? sessions : [])]
      .filter(Boolean)
      .sort((a, b) => {
        const aSort = typeof this._getCourseSessionSortValue === 'function'
          ? this._getCourseSessionSortValue(a)
          : this._getCourseLessonDateTimeValue(a?.date, a?.startTime);
        const bSort = typeof this._getCourseSessionSortValue === 'function'
          ? this._getCourseSessionSortValue(b)
          : this._getCourseLessonDateTimeValue(b?.date, b?.startTime);
        return (Number.isFinite(aSort) ? aSort : 0) - (Number.isFinite(bSort) ? bSort : 0);
      });
    const index = sorted.findIndex(session => this._getCourseLessonSessionId(session) === currentId);
    return index >= 0 ? (sorted[index + 1] || null) : null;
  },

  _formatCourseLessonAdjustLimit(session) {
    if (!session) return '';
    const dateText = this._formatCourseSessionDate?.(session) || session.date || '';
    const timeText = this._formatCourseSessionTime?.(session) || [session.startTime, session.endTime].filter(Boolean).join(' - ');
    return [dateText, timeText].filter(Boolean).join(' ');
  },

  _renderCourseLessonAdjustLoading() {
    const existing = document.querySelector?.('.edu-course-lesson-adjust-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay edu-course-lesson-adjust-overlay';
    overlay._eduDismissed = false;
    overlay.setAttribute?.('aria-busy', 'true');
    overlay.onclick = (event) => {
      if (event.target === overlay) {
        overlay._eduDismissed = true;
        overlay.remove();
      }
    };
    const loadingHtml = typeof this._renderCourseLessonsLoading === 'function'
      ? this._renderCourseLessonsLoading('課堂資料讀取中')
      : '<div class="edu-loading" role="status" aria-live="polite" aria-busy="true">'
        + '<div class="edu-loading-bar"><div class="edu-loading-fill"></div></div>'
        + '<div class="edu-loading-text">課堂資料讀取中</div>'
      + '</div>';
    overlay.innerHTML = '<div class="edu-info-dialog edu-course-lesson-adjust-dialog edu-course-lesson-adjust-loading-dialog">'
      + loadingHtml
    + '</div>';
    document.body.appendChild(overlay);
    return overlay;
  },

  async openCourseLessonQuickAdjust(teamId, planId, sessionId) {
    if (this.isEduClubStaff?.(teamId) !== true) {
      this.showToast?.('僅俱樂部職員可以調整課堂');
      return false;
    }
    let overlay = this._renderCourseLessonAdjustLoading();
    let state;
    try {
      state = await this._loadEduCourseLessonsState(teamId, planId);
    } catch (err) {
      overlay?.remove?.();
      console.error('[openCourseLessonQuickAdjust]', err);
      this.showToast?.('課堂資料讀取失敗，請稍後再試');
      return false;
    }
    if (overlay?._eduDismissed) return false;
    const plan = state.plan;
    const sessions = Array.isArray(state.sessions) ? state.sessions : [];
    const session = sessions.find(item => this._getCourseLessonSessionId(item) === String(sessionId || '').trim());
    if (!plan || !session) {
      overlay?.remove?.();
      this.showToast?.('找不到這堂課，請重新開啟課堂列表');
      return false;
    }
    const status = this._getCourseLessonStatusMeta(session);
    let currentStudentCount;
    try {
      currentStudentCount = await this._getCourseLessonsCurrentStudentCount(teamId, plan);
    } catch (err) {
      overlay?.remove?.();
      console.error('[openCourseLessonQuickAdjust]', err);
      this.showToast?.('課堂資料讀取失敗，請稍後再試');
      return false;
    }
    if (overlay?._eduDismissed) return false;
    const studentCount = this._getCourseLessonStudentCount(session, { currentStudentCount }, status);
    const nextSession = this._getCourseLessonNextSession(sessions, sessionId);
    const nextStartMs = nextSession ? this._getCourseLessonDateTimeValue(nextSession.date, nextSession.startTime) : NaN;
    const nextLabel = this._formatCourseLessonAdjustLimit(nextSession);
    const capacityValue = session.capacity || plan.maxCapacity || '';
    const isCancelled = String(session.status || '').trim() === 'cancelled';
    overlay = overlay || document.createElement('div');
    overlay.className = 'edu-info-overlay edu-course-lesson-adjust-overlay';
    overlay._eduDismissed = false;
    overlay.removeAttribute?.('aria-busy');
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog edu-course-lesson-adjust-dialog">'
      + '<div class="edu-course-lesson-adjust-head">'
        + '<div><span>單堂調整</span><strong>' + escapeHTML(session.title || session.topic || session.focus || '課堂') + '</strong></div>'
        + '<button class="modal-close-btn" type="button" aria-label="關閉" onclick="this.closest(\'.edu-info-overlay\').remove()">×</button>'
      + '</div>'
      + '<div class="edu-course-lesson-adjust-grid">'
        + '<label><span>日期</span><input id="edu-lesson-adjust-date" type="date" value="' + escapeHTML(session.date || '') + '"' + (nextSession?.date ? ' max="' + escapeHTML(nextSession.date) + '"' : '') + '></label>'
        + '<label><span>開始</span><input id="edu-lesson-adjust-start" type="time" value="' + escapeHTML(session.startTime || '') + '"></label>'
        + '<label><span>結束</span><input id="edu-lesson-adjust-end" type="time" value="' + escapeHTML(session.endTime || '') + '"></label>'
        + '<label><span>人數</span><input id="edu-lesson-adjust-capacity" type="number" min="1" max="999" inputmode="numeric" value="' + escapeHTML(capacityValue) + '"></label>'
        + '<label class="edu-course-lesson-adjust-wide"><span>地點</span><input id="edu-lesson-adjust-location" type="text" maxlength="60" value="' + escapeHTML(session.location || plan.location || '') + '"></label>'
      + '</div>'
      + '<label class="edu-course-lesson-cancel-toggle">'
        + '<input id="edu-lesson-adjust-cancelled" type="checkbox"' + (isCancelled ? ' checked' : '') + '>'
        + '<span><strong>停課</strong><em>這堂課會顯示為停課，原名單保留。</em></span>'
      + '</label>'
      + (nextSession && Number.isFinite(nextStartMs) ? '<div class="edu-course-lesson-adjust-limit">下一堂課：' + escapeHTML(nextLabel) + '</div>' : '')
      + '<div class="modal-actions">'
        + '<button class="outline-btn" type="button" onclick="this.closest(\'.edu-info-overlay\').remove()">取消</button>'
        + '<button class="primary-btn" type="button" id="edu-lesson-adjust-save" onclick="return App.saveCourseLessonQuickAdjust(this)">儲存調整</button>'
      + '</div>'
    + '</div>';
    if (!overlay.isConnected) document.body.appendChild(overlay);
    this._eduCourseLessonAdjustContext = {
      teamId,
      planId,
      sessionId: this._getCourseLessonSessionId(session),
      session,
      sessions,
      studentCount,
      nextStartMs: Number.isFinite(nextStartMs) ? nextStartMs : null,
      nextLabel,
    };
    document.getElementById('edu-lesson-adjust-date')?.focus?.();
    return false;
  },

  async saveCourseLessonQuickAdjust(button) {
    const ctx = this._eduCourseLessonAdjustContext;
    if (!ctx || this.isEduClubStaff?.(ctx.teamId) !== true) return false;
    const getValue = id => String(document.getElementById(id)?.value || '').trim();
    const date = getValue('edu-lesson-adjust-date');
    const startTime = getValue('edu-lesson-adjust-start');
    const endTime = getValue('edu-lesson-adjust-end');
    const location = getValue('edu-lesson-adjust-location');
    const capacityRaw = getValue('edu-lesson-adjust-capacity');
    const cancelled = document.getElementById('edu-lesson-adjust-cancelled')?.checked === true;
    const missing = [
      ['日期', date],
      ['開始時間', startTime],
      ['結束時間', endTime],
      ['地點', location],
    ].filter(item => !item[1]).map(item => item[0]);
    if (missing.length) {
      this.showToast?.('請填寫' + missing.join('、'));
      return false;
    }
    const startMs = this._getCourseLessonDateTimeValue(date, startTime);
    const endMs = this._getCourseLessonDateTimeValue(date, endTime);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      this.showToast?.('課堂結束時間需晚於開始時間');
      return false;
    }
    if (ctx.nextStartMs && endMs > ctx.nextStartMs) {
      this.showToast?.('本堂課不可超過下一堂課：' + (ctx.nextLabel || ''));
      return false;
    }
    const capacity = capacityRaw ? parseInt(capacityRaw, 10) : null;
    if (capacityRaw && (!Number.isFinite(capacity) || capacity < 1 || capacity > 999)) {
      this.showToast?.('人數需為 1 到 999');
      return false;
    }
    if (capacity && Number(ctx.studentCount || 0) > capacity) {
      this.showToast?.('人數不可少於目前本堂名單人數');
      return false;
    }
    const previousStatus = String(ctx.session?.status || 'scheduled').trim();
    const payload = {
      date,
      startTime,
      endTime,
      location,
      capacity: Number.isFinite(capacity) ? capacity : null,
      status: cancelled ? 'cancelled' : (previousStatus === 'cancelled' ? 'scheduled' : (previousStatus || 'scheduled')),
    };
    const run = async () => {
      try {
        const updated = await FirebaseService.updateCourseSession(ctx.teamId, ctx.planId, ctx.sessionId, payload);
        const key = this._getCourseSessionCacheKey?.(ctx.teamId, ctx.planId);
        const cached = key && Array.isArray(this._courseSessionCache?.[key]) ? this._courseSessionCache[key] : null;
        const applyUpdate = (list) => {
          const item = Array.isArray(list) ? list.find(session => this._getCourseLessonSessionId(session) === ctx.sessionId) : null;
          if (item) Object.assign(item, payload, updated || {});
        };
        applyUpdate(cached);
        applyUpdate(ctx.sessions);
        if (cached) cached.sort((a, b) => this._getCourseSessionSortValue(a) - this._getCourseSessionSortValue(b));
        document.querySelector?.('.edu-course-lesson-adjust-overlay')?.remove();
        this.showToast?.('課堂調整已儲存');
        await this._refreshCourseLessonsAfterSessionSave?.(ctx.teamId, ctx.planId, ctx.sessionId);
      } catch (err) {
        console.error('[saveCourseLessonQuickAdjust]', err);
        this.showToast?.('課堂調整失敗，請稍後再試');
      }
      return false;
    };
    if (typeof this._withButtonLoading === 'function') {
      return this._withButtonLoading(button, '儲存中...', run);
    }
    return run();
  },

  async showCourseLessons(teamId, planId) {
    const requestSeq = ++this._eduCourseLessonsRequestSeq;
    this._eduCurrentTeamId = teamId;
    this._eduCourseLessonsContext = { teamId, planId, mode: 'list' };
    await this.showPage('page-edu-course-lessons');
    if (this._isEduCourseLessonsStale(requestSeq, teamId)) {
      if (window._raceDebug || (typeof localStorage !== 'undefined' && localStorage.getItem('_raceLog'))) {
        console.log('[race-skip]', { fn: 'showCourseLessons', seq: requestSeq, latest: this._eduCourseLessonsRequestSeq, currentPage: this.currentPage });
      }
      return { ok: false, reason: 'stale' };
    }

    const container = this._getEduCourseLessonsContainer();
    if (!container) return { ok: false, reason: 'missing_container' };
    this._setEduCourseLessonsTitle('課堂列表');
    container.innerHTML = this._renderCourseLessonsLoading('課堂列表載入中');

    const cachedPlan = this._findEduCoursePlan(teamId, planId);
    const cachedSessions = this._getCourseLessonsCachedSessions(teamId, planId);
    if (cachedPlan && cachedSessions) {
      const cachedCount = Number(cachedPlan._effectiveCount);
      container.innerHTML = this._renderCourseLessonList(cachedPlan, cachedSessions, {
        teamId,
        planId,
        isStaff: this.isEduClubStaff?.(teamId) === true,
        currentStudentCount: Number.isFinite(cachedCount) && cachedCount >= 0 ? cachedCount : null,
      });
    }

    const state = await this._loadEduCourseLessonsState(teamId, planId);
    if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
    const plan = state.plan;
    let sessions = state.sessions;
    if (!plan) {
      container.innerHTML = '<div class="edu-empty-state">找不到課程方案</div>';
      return { ok: false, reason: 'plan_not_found' };
    }

    const isStaff = this.isEduClubStaff?.(teamId) === true;
    if (isStaff && typeof this._ensureCoursePlanSessionsFromPlan === 'function') {
      try {
        const syncResult = await this._ensureCoursePlanSessionsFromPlan(teamId, plan);
        if (Array.isArray(syncResult?.sessions)) sessions = syncResult.sessions;
      } catch (err) {
        console.warn('[edu-course-lessons] auto session sync failed:', err);
      }
      if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
    }
    const currentStudentCount = await this._getCourseLessonsCurrentStudentCount(teamId, plan);
    if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
    container.innerHTML = this._renderCourseLessonList(plan, sessions, { teamId, planId, isStaff, currentStudentCount });
    this._eduCourseLessonsContext = { teamId, planId, mode: 'list', plan, sessions, currentStudentCount };
    return { ok: true };
  },

  _getCourseLessonRosterStudentId(student) {
    return String(student?.studentId || student?.id || student?._docId || '').trim();
  },

  _getCourseLessonAttendanceMap(students) {
    const map = {};
    (students || []).forEach((student) => {
      const studentId = this._getCourseLessonRosterStudentId(student);
      if (!studentId) return;
      map[studentId] = student.attendanceKind === 'leave'
        ? 'leave'
        : student.attendanceKind === 'signin' ? 'signin' : null;
    });
    return map;
  },

  _getCourseLessonDateStartValue(value) {
    if (!value) return null;
    const source = typeof value.toDate === 'function' ? value.toDate() : value;
    if (source instanceof Date) {
      const ms = new Date(source.getFullYear(), source.getMonth(), source.getDate()).getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    const raw = String(source || '').trim();
    const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) {
      const ms = new Date(
        parseInt(match[1], 10),
        parseInt(match[2], 10) - 1,
        parseInt(match[3], 10)
      ).getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
  },

  _getCourseLessonEnrollmentJoinValue(enrollment) {
    const candidates = [
      enrollment?.reviewedAt,
      enrollment?.approvedAt,
      enrollment?.appliedAt,
      enrollment?.appliedAtIso,
      enrollment?.createdAt,
      enrollment?.createdAtIso,
    ];
    for (const value of candidates) {
      const ms = this._getCourseLessonDateStartValue(value);
      if (ms !== null) return ms;
    }
    return null;
  },

  _isCourseLessonStatsEligibleSession(session, joinStartMs, nowMs) {
    if (!session) return false;
    const status = String(session.status || '').trim().toLowerCase();
    if (status === 'cancelled') return false;
    const dateStartMs = this._getCourseLessonDateStartValue(session.date);
    if (joinStartMs !== null && dateStartMs !== null && dateStartMs < joinStartMs) return false;
    const sessionMs = typeof this._getCourseSessionSortValue === 'function'
      ? this._getCourseSessionSortValue(session)
      : this._getCourseLessonDateTimeValue(session.date, session.startTime);
    const done = status === 'done' || (Number.isFinite(sessionMs) && sessionMs < nowMs - 6 * 60 * 60 * 1000);
    return done === true;
  },

  _buildCourseLessonAttendanceStatsByStudent(sessions, enrollments, attendanceRecords, rosterStudents) {
    const rosterIds = (Array.isArray(rosterStudents) ? rosterStudents : [])
      .map(student => this._getCourseLessonRosterStudentId(student))
      .filter(Boolean);
    if (!rosterIds.length) return {};

    const enrollmentByStudentId = new Map();
    (Array.isArray(enrollments) ? enrollments : []).forEach((enrollment) => {
      const studentId = String(enrollment?.studentId || '').trim();
      if (!studentId || String(enrollment?.status || 'approved').trim().toLowerCase() !== 'approved') return;
      if (!enrollmentByStudentId.has(studentId)) enrollmentByStudentId.set(studentId, enrollment);
    });

    const recordsByStudentId = new Map();
    (Array.isArray(attendanceRecords) ? attendanceRecords : []).forEach((record) => {
      const recordStatus = String(record?.status || '').trim();
      if (!record || recordStatus === 'removed' || recordStatus === 'cancelled') return;
      const studentId = String(record.studentId || '').trim();
      if (!studentId) return;
      const kind = String(record.kind || 'signin').trim();
      if (kind !== 'signin') return;
      if (!recordsByStudentId.has(studentId)) recordsByStudentId.set(studentId, []);
      recordsByStudentId.get(studentId).push(record);
    });

    const nowMs = Date.now();
    const sortedSessions = [...(Array.isArray(sessions) ? sessions : [])]
      .filter(Boolean)
      .sort((a, b) => {
        const aMs = typeof this._getCourseSessionSortValue === 'function'
          ? this._getCourseSessionSortValue(a)
          : this._getCourseLessonDateTimeValue(a?.date, a?.startTime);
        const bMs = typeof this._getCourseSessionSortValue === 'function'
          ? this._getCourseSessionSortValue(b)
          : this._getCourseLessonDateTimeValue(b?.date, b?.startTime);
        return (Number.isFinite(aMs) ? aMs : 0) - (Number.isFinite(bMs) ? bMs : 0);
      });

    return rosterIds.reduce((map, studentId) => {
      const joinStartMs = this._getCourseLessonEnrollmentJoinValue(enrollmentByStudentId.get(studentId));
      const eligible = sortedSessions.filter((session) => {
        if (!this._isCourseLessonStatsEligibleSession(session, joinStartMs, nowMs)) return false;
        const ids = Array.isArray(session.studentIds) ? session.studentIds.map(value => String(value || '').trim()) : [];
        return !ids.length || ids.includes(studentId);
      });
      const eligibleSessionIds = new Set();
      const eligibleDates = new Set();
      eligible.forEach((session) => {
        const sessionId = this._getCourseLessonSessionId(session);
        if (sessionId) eligibleSessionIds.add(sessionId);
        const date = String(session.date || '').trim();
        if (date) eligibleDates.add(date);
      });
      const signedKeys = new Set();
      (recordsByStudentId.get(studentId) || []).forEach((record) => {
        const recordSessionId = String(record.sessionId || '').trim();
        const recordDate = String(record.date || '').trim();
        if (recordSessionId && eligibleSessionIds.has(recordSessionId)) {
          signedKeys.add('session:' + recordSessionId);
          return;
        }
        if (!recordSessionId && recordDate && eligibleDates.has(recordDate)) {
          signedKeys.add('date:' + recordDate);
        }
      });
      const total = eligible.length;
      const signed = signedKeys.size;
      map[studentId] = {
        signed,
        total,
        rate: total > 0 ? Math.round((signed / total) * 100) : null,
      };
      return map;
    }, {});
  },

  _renderCourseLessonRosterFromContext() {
    const ctx = this._eduCourseLessonsContext;
    const container = this._getEduCourseLessonsContainer();
    if (!container || !ctx || ctx.mode !== 'roster' || !ctx.rosterPayload) return;
    container.innerHTML = this._renderCourseLessonRosterView(ctx.rosterPayload, ctx);
    this._bindCourseSessionStudentAvatarFallbacks?.(container);
  },

  startCourseLessonRosterManage() {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || ctx.mode !== 'roster' || !ctx.isStaff) return;
    ctx.manageMode = true;
    ctx.draftByStudentId = { ...(ctx.attendanceByStudentId || {}) };
    this._renderCourseLessonRosterFromContext();
  },

  cancelCourseLessonRosterManage() {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || ctx.mode !== 'roster') return;
    ctx.manageMode = false;
    ctx.draftByStudentId = { ...(ctx.attendanceByStudentId || {}) };
    this._renderCourseLessonRosterFromContext();
  },

  setCourseLessonRosterDraft(studentId, kind) {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || ctx.mode !== 'roster' || !ctx.isStaff || !ctx.manageMode) return;
    const key = String(studentId || '').trim();
    if (!key) return;
    const normalized = kind === 'leave' ? 'leave' : kind === 'signin' ? 'signin' : null;
    ctx.draftByStudentId = { ...(ctx.draftByStudentId || {}), [key]: normalized };
    this._renderCourseLessonRosterFromContext();
  },

  async saveCourseLessonRosterManage(button) {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || ctx.mode !== 'roster' || !ctx.isStaff || !ctx.manageMode) return;
    const students = Array.isArray(ctx.rosterPayload?.students) ? ctx.rosterPayload.students : [];
    const original = ctx.attendanceByStudentId || {};
    const draft = ctx.draftByStudentId || {};
    const changes = students
      .map(student => {
        const studentId = this._getCourseLessonRosterStudentId(student);
        if (!studentId) return null;
        const nextKind = draft[studentId] || null;
        if ((original[studentId] || null) === nextKind) return null;
        return {
          studentId,
          studentName: student.displayName || '',
          parentUid: student.parentUid || null,
          selfUid: student.selfUid || null,
          kind: nextKind,
        };
      })
      .filter(Boolean);

    const run = async () => {
      if (changes.length) {
        await FirebaseService.saveEduSessionAttendanceChanges({
          teamId: ctx.teamId,
          planId: ctx.planId,
          sessionId: ctx.sessionId,
          date: ctx.rosterPayload?.session?.date,
          changes,
        });
      }
      this.showToast?.(changes.length ? '名單已更新' : '沒有變更');
      await this.showCourseLessonRoster(ctx.teamId, ctx.planId, ctx.sessionId);
    };

    if (typeof this._withButtonLoading === 'function') {
      return this._withButtonLoading(button, '儲存中...', run);
    }
    return run();
  },

  startCourseLessonNotesEdit() {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || ctx.mode !== 'roster' || !ctx.isStaff) return;
    ctx.notesEditMode = true;
    ctx.draftSessionNotes = String(ctx.rosterPayload?.session?.notes || '');
    this._renderCourseLessonRosterFromContext();
  },

  cancelCourseLessonNotesEdit() {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || ctx.mode !== 'roster') return;
    ctx.notesEditMode = false;
    ctx.draftSessionNotes = '';
    this._renderCourseLessonRosterFromContext();
  },

  async saveCourseLessonNotes(button) {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || ctx.mode !== 'roster' || !ctx.isStaff) return;
    const input = document.getElementById('edu-course-roster-notes-input');
    const notes = String(input?.value || '').trim().slice(0, 500);
    const run = async () => {
      await FirebaseService.updateCourseSession(ctx.teamId, ctx.planId, ctx.sessionId, { notes });
      if (ctx.rosterPayload?.session) ctx.rosterPayload.session.notes = notes;
      ctx.notesEditMode = false;
      ctx.draftSessionNotes = '';
      this.showToast?.('課堂備註已更新');
      await this.showCourseLessonRoster(ctx.teamId, ctx.planId, ctx.sessionId);
    };
    if (typeof this._withButtonLoading === 'function') {
      return this._withButtonLoading(button, '儲存中...', run);
    }
    return run();
  },

  showCourseLessonSelfLeaveDialog(studentId, kind, button) {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || ctx.mode !== 'roster' || ctx.isStaff) return false;
    const key = String(studentId || '').trim();
    const students = Array.isArray(ctx.rosterPayload?.students) ? ctx.rosterPayload.students : [];
    const leave = kind === 'leave';
    const candidates = students.filter(item => item?.canSelfLeave === true);
    const selectable = candidates.filter(item => leave
      ? item.attendanceKind !== 'leave'
      : item.attendanceKind === 'leave');
    if (!selectable.length) {
      this.showToast?.(leave ? '目前沒有可請假的學員' : '目前沒有可取消請假的學員');
      return false;
    }
    const existing = document.querySelector?.('.edu-course-self-leave-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay edu-course-self-leave-overlay';
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
    const renderItem = (student) => {
      const id = this._getCourseLessonRosterStudentId(student);
      const checked = id === key ? ' checked' : '';
      const statusText = student.attendanceKind === 'leave' ? '已請假' : '未請假';
      return '<label class="edu-ce-pick-item edu-course-self-leave-pick">'
        + '<div class="edu-ce-pick-main"><span class="edu-ce-pick-name">' + escapeHTML(student.displayName || '學員') + '</span>'
        + '<span class="edu-ce-pick-info">' + escapeHTML(statusText) + '</span></div>'
        + '<input type="checkbox" value="' + escapeHTML(id) + '"' + checked + '></label>';
    };
    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">' + (leave ? '請假登記' : '取消請假') + '</div>'
      + '<div style="font-size:.85rem;color:var(--text-secondary);margin-bottom:.6rem">'
      + (leave ? '選擇這堂課要請假的學員。' : '選擇這堂課要取消請假的學員。')
      + '</div>'
      + '<div class="edu-ce-pick-list">' + selectable.map(renderItem).join('') + '</div>'
      + '<div style="display:flex;gap:.5rem;margin-top:.8rem">'
      + '<button class="outline-btn" style="flex:1" onclick="this.closest(\'.edu-info-overlay\').remove()">取消</button>'
      + '<button class="primary-btn" style="flex:1" id="_eduSelfLeaveConfirmBtn">' + (leave ? '確認請假' : '確認取消') + '</button>'
      + '</div></div>';
    document.body.appendChild(overlay);
    document.getElementById('_eduSelfLeaveConfirmBtn').onclick = async () => {
      const ids = Array.from(overlay.querySelectorAll('.edu-ce-pick-list input[type="checkbox"]:checked'))
        .map(input => input.value)
        .filter(Boolean);
      if (!ids.length) {
        this.showToast?.('請選擇至少一位學員');
        return;
      }
      overlay.remove();
      return this._saveCourseLessonSelfLeaveSelection(ids, leave, button);
    };
    return false;
  },

  async _saveCourseLessonSelfLeaveSelection(studentIds, leave, button) {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || ctx.mode !== 'roster' || ctx.isStaff) return;
    const ids = Array.from(new Set((Array.isArray(studentIds) ? studentIds : [studentIds])
      .map(value => String(value || '').trim())
      .filter(Boolean)));
    const students = Array.isArray(ctx.rosterPayload?.students) ? ctx.rosterPayload.students : [];
    const selected = ids
      .map(id => students.find(item => this._getCourseLessonRosterStudentId(item) === id))
      .filter(student => student && student.canSelfLeave === true);
    if (!selected.length) {
      this.showToast?.('目前沒有可處理的請假學員');
      return;
    }
    const run = async () => {
      try {
        for (const student of selected) {
          const studentId = this._getCourseLessonRosterStudentId(student);
          await FirebaseService.saveEduCourseSelfLeave({
            teamId: ctx.teamId,
            planId: ctx.planId,
            sessionId: ctx.sessionId,
            date: ctx.rosterPayload?.session?.date,
            studentId,
            studentName: student.displayName || '',
            selfUid: student.selfUid || null,
            parentUid: student.parentUid || null,
            leave,
          });
        }
      } catch (err) {
        console.error('[saveCourseLessonSelfLeave]', err);
        this.showToast?.('請假登記失敗，請重新開啟課堂名單後再試');
        return;
      }
      selected.forEach((student) => {
        student.attendanceKind = leave ? 'leave' : null;
      });
      this.showToast?.(leave ? '已登記請假' : '已取消請假');
      await this.showCourseLessonRoster(ctx.teamId, ctx.planId, ctx.sessionId);
    };

    if (typeof this._withButtonLoading === 'function') {
      return this._withButtonLoading(button, leave ? '請假中...' : '取消中...', run);
    }
    return run();
  },

  async saveCourseLessonSelfLeave(studentId, kind, button) {
    return this._saveCourseLessonSelfLeaveSelection([studentId], kind === 'leave', button);
  },

  async showCourseLessonRoster(teamId, planId, sessionId) {
    const requestSeq = ++this._eduCourseLessonsRequestSeq;
    this._eduCurrentTeamId = teamId;
    this._eduCourseLessonsContext = { teamId, planId, sessionId, mode: 'roster' };
    await this.showPage('page-edu-course-lessons');
    if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };

    const container = this._getEduCourseLessonsContainer();
    if (!container) return { ok: false, reason: 'missing_container' };
    this._setEduCourseLessonsTitle('課堂名單');
    container.innerHTML = this._renderCourseLessonsLoading('課堂名單載入中');

    const [state, rosterPayload] = await Promise.all([
      this._loadEduCourseLessonsState(teamId, planId),
      FirebaseService.listEduCoursePublicRoster(teamId, planId, sessionId),
    ]);
    if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
    const plan = state.plan;
    if (!plan) {
      container.innerHTML = '<div class="edu-empty-state">找不到課程方案</div>';
      return { ok: false, reason: 'plan_not_found' };
    }

    const isStaff = this.isEduClubStaff?.(teamId) === true;
    const notesByStudentId = {};
    const enrollIdsByStudentId = {};
    const tracksPayment = typeof this._shouldTrackCoursePlanPayment === 'function'
      ? this._shouldTrackCoursePlanPayment(plan)
      : plan?.perSessionBilling !== true;
    let enrollments = [];
    let paidByStudentId = null;
    if (isStaff) {
      try {
        enrollments = await this._loadCourseEnrollments(teamId, planId);
        if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
        const paidMap = {};
        (enrollments || []).forEach((enrollment) => {
          const studentId = String(enrollment.studentId || '').trim();
          if (!studentId || enrollment.status === 'rejected') return;
          if (String(enrollment.status || 'approved').trim().toLowerCase() === 'approved' && enrollment.paidAt) {
            paidMap[studentId] = true;
          }
          if (enrollment.coachNotes) notesByStudentId[studentId] = String(enrollment.coachNotes || '');
          enrollIdsByStudentId[studentId] = enrollment.id || enrollment._docId || '';
        });
        paidByStudentId = tracksPayment ? paidMap : null;
      } catch (err) {
        console.warn('[edu-course-lessons] staff notes load failed:', err);
      }
    }

    if (rosterPayload && rosterPayload.rosterPublic === false && !isStaff) {
      container.innerHTML = '<div class="edu-course-lessons-empty"><strong>名單未公開</strong><span>此課堂名單目前僅職員可查看。</span></div>';
      return { ok: true, closed: true };
    }
    const attendanceByStudentId = this._getCourseLessonAttendanceMap(rosterPayload?.students || []);
    this._eduCourseLessonsContext = {
      teamId,
      planId,
      sessionId,
      mode: 'roster',
      isStaff,
      rosterPayload,
      notesByStudentId,
      enrollIdsByStudentId,
      paidByStudentId,
      attendanceByStudentId,
      draftByStudentId: { ...attendanceByStudentId },
      manageMode: false,
      notesEditMode: false,
      draftSessionNotes: '',
    };
    this._renderCourseLessonRosterFromContext();
    return { ok: true };
  },
});
