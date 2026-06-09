/* ================================================
   SportHub — Education: Course Lessons
   ================================================ */

Object.assign(App, {
  _eduCourseLessonsRequestSeq: 0,
  _eduCourseLessonsContext: null,

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

  async _loadEduCourseLessonsState(teamId, planId) {
    await this._loadEduCoursePlans?.(teamId);
    const plan = this._findEduCoursePlan(teamId, planId);
    if (!plan) return { plan: null, sessions: [] };
    const sessions = plan.planType === 'weekly'
      ? []
      : await this._loadCourseSessions(teamId, planId);
    return { plan, sessions };
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

    const { plan, sessions } = await this._loadEduCourseLessonsState(teamId, planId);
    if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
    if (!plan) {
      container.innerHTML = '<div class="edu-empty-state">找不到課程方案</div>';
      return { ok: false, reason: 'plan_not_found' };
    }
    if (plan.planType === 'weekly') {
      container.innerHTML = '<div class="edu-empty-state">固定週期課程維持方案層級顯示。</div>';
      return { ok: false, reason: 'weekly_not_supported' };
    }

    const isStaff = this.isEduClubStaff?.(teamId) === true;
    container.innerHTML = this._renderCourseLessonList(plan, sessions, { teamId, planId, isStaff });
    this._eduCourseLessonsContext = { teamId, planId, mode: 'list' };
    return { ok: true };
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
    if (isStaff) {
      try {
        const enrollments = await this._loadCourseEnrollments(teamId, planId);
        if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
        (enrollments || []).forEach((enrollment) => {
          const studentId = String(enrollment.studentId || '').trim();
          if (!studentId || enrollment.status === 'rejected') return;
          if (enrollment.coachNotes) notesByStudentId[studentId] = String(enrollment.coachNotes || '');
          enrollIdsByStudentId[studentId] = enrollment.id || enrollment._docId || '';
        });
      } catch (err) {
        console.warn('[edu-course-lessons] staff notes load failed:', err);
      }
    }

    if (rosterPayload && rosterPayload.rosterPublic === false && !isStaff) {
      container.innerHTML = '<div class="edu-course-lessons-empty"><strong>名單未公開</strong><span>此課堂名單目前僅職員可查看。</span></div>';
      return { ok: true, closed: true };
    }
    container.innerHTML = this._renderCourseLessonRosterView(rosterPayload, {
      teamId,
      planId,
      sessionId,
      isStaff,
      notesByStudentId,
      enrollIdsByStudentId,
    });
    this._bindCourseSessionStudentAvatarFallbacks?.(container);
    return { ok: true };
  },
});
