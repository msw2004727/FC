/* ================================================
   SportHub — Education: Course Lessons
   ================================================ */

Object.assign(App, {
  _eduCourseLessonsRequestSeq: 0,
  _eduCourseLessonsContext: null,
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
    this._eduCourseLessonsContext = { teamId, planId, mode: 'list' };
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
    let paidByStudentId = null;
    if (isStaff) {
      try {
        const enrollments = await this._loadCourseEnrollments(teamId, planId);
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
        paidByStudentId = paidMap;
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
