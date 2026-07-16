/* ================================================
   SportHub — Education: Course Lessons
   ================================================ */

Object.assign(App, {
  _eduCourseLessonsRequestSeq: 0,
  _eduCourseLessonsContext: null,
  _eduCourseLessonAttendanceCountListener: null,
  _eduCourseLessonAttendanceCountListenerSeq: 0,
  _eduCourseLessonAdjustContext: null,
  _eduCourseLessonsPreloadPromises: {},
  _eduCourseLessonsPreloadLimit: 3,
  _eduCourseRosterPayloadCache: {},
  _eduCourseRosterInvalidatedAt: {},
  _eduCourseRosterRefreshSatisfiedAt: {},
  _eduCourseRosterPublicTtlMs: 30000,
  _eduCourseRosterStaffTtlMs: 15000,
  _eduCourseRosterPersistentSchemaVersion: 1,
  _eduCourseRosterPersistentPublicTtlMs: 10 * 60 * 1000,
  _eduCourseRosterPersistentMaxEntries: 16,
  _eduCourseRosterStateTimeoutMs: 15000,
  _eduCourseRosterRequestTimeoutMs: 35000,
  _eduCourseRosterViewerRetryLimit: 1,
  _eduCourseRosterPerfTimeline: [],
  _eduCourseRosterLastPerf: null,
  _eduCourseRosterRestoredTransitionSeq: 0,

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

  _stopCourseLessonAttendanceCountListener() {
    const listener = this._eduCourseLessonAttendanceCountListener;
    this._eduCourseLessonAttendanceCountListener = null;
    this._eduCourseLessonAttendanceCountListenerSeq = (Number(this._eduCourseLessonAttendanceCountListenerSeq) || 0) + 1;
    if (typeof listener?.resolveInitial === 'function') {
      const resolveInitial = listener.resolveInitial;
      listener.resolveInitial = null;
      resolveInitial(null);
    }
    if (typeof listener?.unsubscribe === 'function') {
      try {
        listener.unsubscribe();
      } catch (err) {
        console.warn('[edu-course-lessons] weekly attendance count unsubscribe failed:', err);
      }
    }
  },

  _startCourseLessonAttendanceCountListener(teamId, planId, sessions) {
    this._stopCourseLessonAttendanceCountListener();
    const normalizedTeamId = String(teamId || '').trim();
    const normalizedPlanId = String(planId || '').trim();
    if (!normalizedTeamId || !normalizedPlanId
      || typeof firebase === 'undefined'
      || typeof firebase.firestore !== 'function') {
      return Promise.resolve(null);
    }

    let db;
    try {
      db = firebase.firestore();
    } catch (err) {
      console.warn('[edu-course-lessons] weekly attendance count listener unavailable:', err);
      return Promise.resolve(null);
    }
    if (!db || typeof db.collection !== 'function') return Promise.resolve(null);

    const listenerSeq = Number(this._eduCourseLessonAttendanceCountListenerSeq);
    let resolveInitial;
    const initialSnapshotPromise = new Promise((resolve) => {
      resolveInitial = resolve;
    });
    const listener = {
      seq: listenerSeq,
      resolveInitial,
      unsubscribe: null,
      receivedInitialSnapshot: false,
    };
    this._eduCourseLessonAttendanceCountListener = listener;

    const isActive = () => this._eduCourseLessonAttendanceCountListener === listener
      && Number(this._eduCourseLessonAttendanceCountListenerSeq) === listenerSeq;
    const settleInitial = (value) => {
      if (typeof listener.resolveInitial !== 'function') return;
      const resolve = listener.resolveInitial;
      listener.resolveInitial = null;
      resolve(value);
    };
    const fail = (err) => {
      if (!isActive()) return;
      this._eduCourseLessonAttendanceCountListener = null;
      console.warn('[edu-course-lessons] weekly attendance count listener failed:', err);
      settleInitial(null);
      if (typeof listener.unsubscribe === 'function') {
        try {
          listener.unsubscribe();
        } catch (_) {}
      }
    };
    const handleSnapshot = (snapshot) => {
      if (!isActive()) return;
      try {
        const records = Array.from(snapshot?.docs || []).map((doc) => ({
          id: doc?.id,
          _docId: doc?.id,
          ...(typeof doc?.data === 'function' ? doc.data() : {}),
        }));
        const ctx = this._eduCourseLessonsContext;
        const contextMatches = ctx?.mode === 'list'
          && String(ctx?.teamId || '') === normalizedTeamId
          && String(ctx?.planId || '') === normalizedPlanId;
        const countSessions = contextMatches && Array.isArray(ctx?.sessions) ? ctx.sessions : sessions;
        const counts = this._buildCourseLessonConfirmedCountBySessionId(countSessions, records);
        if (!listener.receivedInitialSnapshot) {
          listener.receivedInitialSnapshot = true;
          settleInitial(counts);
          return;
        }
        if (!contextMatches || this.currentPage !== 'page-edu-course-lessons') return;
        ctx.confirmedCountBySessionId = counts;
        const container = this._getEduCourseLessonsContainer();
        if (!container || !ctx.plan || !Array.isArray(ctx.sessions)) return;
        container.innerHTML = this._renderCourseLessonList(ctx.plan, ctx.sessions, {
          teamId: normalizedTeamId,
          planId: normalizedPlanId,
          isStaff: this.isEduClubStaff?.(normalizedTeamId) === true,
          currentStudentCount: ctx.currentStudentCount,
          planType: ctx.plan.planType,
          confirmedCountBySessionId: counts,
        });
      } catch (err) {
        fail(err);
      }
    };

    try {
      const query = db.collection('eduAttendance')
        .where('teamId', '==', normalizedTeamId)
        .where('coursePlanId', '==', normalizedPlanId);
      const unsubscribe = query.onSnapshot(handleSnapshot, fail);
      if (isActive()) {
        listener.unsubscribe = typeof unsubscribe === 'function' ? unsubscribe : null;
      } else if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    } catch (err) {
      fail(err);
    }
    return initialSnapshotPromise;
  },

  _prepareEduCourseLessonsTransition(options = {}, isSameRoute = false) {
    const inherited = Number(options?._navigationTransitionSeq);
    const hasInherited = Number.isSafeInteger(inherited) && inherited > 0;
    const active = Number(this._activePageTransitionSeq);
    const routeOptions = isSameRoute && !hasInherited && Number.isSafeInteger(active) && active > 0
      ? { ...options, _navigationTransitionSeq: active }
      : options;
    const transitionSeq = typeof this._claimPageTransition === 'function'
      ? Number(this._claimPageTransition('page-edu-course-lessons', routeOptions))
      : Number(routeOptions?._navigationTransitionSeq || 0);
    return Number.isSafeInteger(transitionSeq) && transitionSeq > 0 ? transitionSeq : 0;
  },

  _isEduCourseLessonsTransitionCurrent(transitionSeq) {
    return !(Number.isSafeInteger(Number(transitionSeq)) && Number(transitionSeq) > 0)
      || typeof this._isPageTransitionCurrent !== 'function'
      || this._isPageTransitionCurrent(Number(transitionSeq));
  },

  _abortEduCourseLessonsTransition(source, transitionSeq) {
    if (typeof this._abortStalePageTransition === 'function') {
      return this._abortStalePageTransition(source, 'page-edu-course-lessons', transitionSeq);
    }
    return { ok: false, reason: 'stale_transition', source, pageId: 'page-edu-course-lessons', transitionSeq };
  },

  _getCourseLessonRosterRestoreCandidate(transitionSeq, options = {}) {
    const normalizedTransitionSeq = Number(transitionSeq);
    if (!Number.isSafeInteger(normalizedTransitionSeq) || normalizedTransitionSeq <= 0) return null;
    const activeTransitionSeq = Number(this._activePageTransitionSeq);
    const latestTransitionSeq = Number(this._pageTransitionSeq);
    const isActiveTransition = activeTransitionSeq === normalizedTransitionSeq;
    const isPendingSamePageTransition = options.allowPendingActivation === true
      && latestTransitionSeq === normalizedTransitionSeq
      && latestTransitionSeq > activeTransitionSeq;
    if (this.currentPage !== 'page-edu-course-lessons'
      || this._userIntendedPage !== 'page-edu-course-lessons'
      || (!isActiveTransition && !isPendingSamePageTransition)
      || !this._isEduCourseLessonsTransitionCurrent(normalizedTransitionSeq)) {
      return null;
    }

    const context = this._eduCourseLessonsContext;
    const teamId = String(context?.teamId || '').trim();
    const planId = String(context?.planId || '').trim();
    const sessionId = String(context?.sessionId || '').trim();
    if (context?.mode !== 'roster' || !teamId || !planId || !sessionId) return null;

    const container = this._getEduCourseLessonsContainer();
    const html = String(container?.innerHTML || '');
    const blockingLoading = html.includes('edu-course-lessons-loading')
      || html.includes('edu-course-roster-shell-loading');
    const pendingPreview = context.refreshPending === true
      && context.refreshError !== true
      && (context.rosterPayload?.cacheMeta?.preview === true || context.staleCached === true)
      && html.includes('edu-course-roster-refresh-status');
    if (!container || (!blockingLoading && !pendingPreview)) return null;

    return {
      transitionSeq: normalizedTransitionSeq,
      teamId,
      planId,
      sessionId,
      pendingActivation: isPendingSamePageTransition,
    };
  },

  _resumeCourseLessonRosterAfterBFCache(transitionSeq, options = {}) {
    const candidate = this._getCourseLessonRosterRestoreCandidate(transitionSeq, options);
    if (!candidate) return { ok: false, reason: 'not_applicable' };
    if (Number(this._eduCourseRosterRestoredTransitionSeq) === candidate.transitionSeq) {
      return { ok: false, reason: 'deduped' };
    }
    this._eduCourseRosterRestoredTransitionSeq = candidate.transitionSeq;
    return this.showCourseLessonRoster(candidate.teamId, candidate.planId, candidate.sessionId, {
      _navigationTransitionSeq: candidate.transitionSeq,
      bypassPageLock: true,
      preserveRouteUrl: true,
      skipPageHistory: true,
      suppressHashSync: true,
      _restoredPageReady: true,
      _allowPendingPageActivation: candidate.pendingActivation === true,
    });
  },

  _tryResumeCourseLessonRosterForCurrentTransition(requestSeq, staleTransitionSeq, source = '') {
    const normalizedRequestSeq = Number(requestSeq);
    if (!Number.isSafeInteger(normalizedRequestSeq)
      || normalizedRequestSeq !== Number(this._eduCourseLessonsRequestSeq)
      || this._isEduCourseLessonsTransitionCurrent(staleTransitionSeq)) {
      return false;
    }
    const activeTransitionSeq = Number(this._activePageTransitionSeq);
    let candidate = this._getCourseLessonRosterRestoreCandidate(activeTransitionSeq);
    if (!candidate) {
      candidate = this._getCourseLessonRosterRestoreCandidate(
        Number(this._pageTransitionSeq),
        { allowPendingActivation: true },
      );
    }
    if (!candidate) return false;

    this._recordNavigationDiagnostic?.('course-roster-transition-recovery', {
      source: String(source || 'course-roster'),
      pageId: 'page-edu-course-lessons',
      expectedSeq: Number(staleTransitionSeq) || 0,
    });
    try {
      void Promise.resolve(
        this._resumeCourseLessonRosterAfterBFCache(candidate.transitionSeq, {
          allowPendingActivation: candidate.pendingActivation === true,
        })
      ).catch((err) => {
        console.warn('[edu-course-lessons] transition recovery failed:', err);
      });
      return true;
    } catch (err) {
      console.warn('[edu-course-lessons] transition recovery failed:', err);
      return false;
    }
  },

  _findEduCoursePlan(teamId, planId) {
    return (this.getEduCoursePlans?.(teamId) || [])
      .find(plan => String(plan.id || plan._docId || '') === String(planId || '')) || null;
  },

  _getCourseLessonsPreloadKey(teamId, planId) {
    return String(teamId || '') + ':' + String(planId || '');
  },

  _getCourseLessonRosterViewerUid() {
    try {
      const uid = firebase?.auth?.()?.currentUser?.uid;
      return uid ? String(uid) : 'guest';
    } catch (_) {
      return 'guest';
    }
  },

  _withCourseLessonRosterTimeout(promise, timeoutMs, code, message) {
    if (typeof _withSportHubTimeout === 'function') {
      return _withSportHubTimeout(promise, timeoutMs, code, message);
    }
    const normalizedTimeoutMs = Number(timeoutMs || 0);
    if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs <= 0) {
      return Promise.resolve(promise);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(message || 'Course lesson roster request timed out');
        error.code = code || 'COURSE_LESSON_ROSTER_TIMEOUT';
        reject(error);
      }, normalizedTimeoutMs);
      Promise.resolve(promise).then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        err => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  },

  _renderCourseLessonRosterLoadFailure(teamId, planId, sessionId, message = '') {
    const jsTeamId = this._eduCourseLessonsJsArg?.(teamId) || String(teamId || '');
    const jsPlanId = this._eduCourseLessonsJsArg?.(planId) || String(planId || '');
    const jsSessionId = this._eduCourseLessonsJsArg?.(sessionId) || String(sessionId || '');
    const detail = message || '&#35531;&#30906;&#35469;&#32178;&#36335;&#29376;&#24907;&#24460;&#20877;&#35430;';
    return '<div class="edu-course-lessons-empty"><strong>&#21517;&#21934;&#36617;&#20837;&#22833;&#25943;</strong><span>' + detail + '</span><button type="button" class="primary-btn small" onclick="App.showCourseLessonRoster(\'' + jsTeamId + '\',\'' + jsPlanId + '\',\'' + jsSessionId + '\',{forceRefresh:true})">&#37325;&#35430;</button></div>';
  },

  async _handleCourseLessonRosterViewerChange(teamId, planId, sessionId, routeTransitionSeq, options = {}) {
    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return this._abortEduCourseLessonsTransition('courseLessonRoster-viewer-change', routeTransitionSeq);
    }
    const ctx = this._eduCourseLessonsContext;
    const stillOnRoster = this.currentPage === 'page-edu-course-lessons'
      && ctx?.mode === 'roster'
      && String(ctx.teamId || '') === String(teamId || '')
      && String(ctx.planId || '') === String(planId || '')
      && String(ctx.sessionId || '') === String(sessionId || '');
    if (!stillOnRoster) return { ok: false, reason: 'stale' };

    const retryCount = Math.max(0, Number(options?._viewerChangeRetryCount) || 0);
    const retryLimit = Math.max(0, Number(this._eduCourseRosterViewerRetryLimit) || 0);
    if (retryCount < retryLimit) {
      this._recordCourseLessonRosterPerf('viewer_retry', {
        teamId,
        planId,
        sessionId,
        retryCount: retryCount + 1,
      }, options?.perfStartedAtMs);
      return this.showCourseLessonRoster(teamId, planId, sessionId, {
        ...options,
        forceRefresh: true,
        bypassPageLock: true,
        preserveRouteUrl: true,
        skipPageHistory: true,
        suppressHashSync: true,
        _navigationTransitionSeq: routeTransitionSeq,
        _viewerChangeRetryCount: retryCount + 1,
      });
    }

    const container = this._getEduCourseLessonsContainer();
    if (container) {
      container.innerHTML = this._renderCourseLessonRosterLoadFailure(
        teamId,
        planId,
        sessionId,
        '&#30331;&#20837;&#29376;&#24907;&#24050;&#26356;&#26032;&#65292;&#35531;&#37325;&#26032;&#36617;&#20837;&#21517;&#21934;',
      );
    }
    return { ok: false, reason: 'viewer_changed', retryExhausted: true };
  },

  _getCourseLessonRosterPerfNow() {
    try {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
      }
    } catch (_) {}
    return Date.now();
  },

  _shouldLogCourseLessonRosterPerf() {
    try {
      if (typeof window !== 'undefined' && window._perfEduRosterLog) return true;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('_perfEduRosterLog')) return true;
    } catch (_) {}
    return false;
  },

  _recordCourseLessonRosterPerf(stage, meta = {}, startedAtMs = null) {
    const now = this._getCourseLessonRosterPerfNow();
    const start = Number(startedAtMs);
    const elapsedMs = Number.isFinite(start) ? Math.max(0, Math.round(now - start)) : 0;
    const entry = {
      stage,
      elapsedMs,
      atMs: Math.round(now),
      ...meta,
    };
    const timeline = Array.isArray(this._eduCourseRosterPerfTimeline)
      ? this._eduCourseRosterPerfTimeline
      : [];
    this._eduCourseRosterPerfTimeline = [...timeline, entry].slice(-20);
    this._eduCourseRosterLastPerf = entry;
    if (this._shouldLogCourseLessonRosterPerf() && typeof console !== 'undefined' && typeof console.info === 'function') {
      console.info('[perfEduRoster] ' + stage + ' +' + elapsedMs + 'ms', entry);
    }
    return entry;
  },

  _getCourseLessonRosterPayloadVersion(payload) {
    return String(payload?.cacheMeta?.payloadVersion || payload?.payloadVersion || '');
  },

  _getCourseLessonRosterCacheScope(teamId, payload) {
    if (payload?.canManageRoster === true) return 'staff';
    return this.isEduClubStaff?.(teamId) === true ? 'staff' : 'public';
  },

  _getCourseLessonRosterCacheKey(teamId, planId, sessionId, scope, viewerUid = this._getCourseLessonRosterViewerUid()) {
    return [
      String(teamId || '').trim(),
      String(planId || '').trim(),
      String(sessionId || '').trim(),
      String(scope || 'public'),
      String(viewerUid || 'guest'),
    ].join('|');
  },

  _getCourseLessonRosterPersistentStorageKey(viewerUid = this._getCourseLessonRosterViewerUid()) {
    const uid = String(viewerUid || 'guest').trim() || 'guest';
    let safeUid = uid;
    try { safeUid = encodeURIComponent(uid); } catch (_) {}
    return 'toosterx.eduCourseRosterPreview.v' + this._eduCourseRosterPersistentSchemaVersion + '.' + safeUid;
  },

  _getCourseLessonRosterPersistentCacheKey(teamId, planId, sessionId, scope, viewerUid = this._getCourseLessonRosterViewerUid()) {
    return [
      'v' + this._eduCourseRosterPersistentSchemaVersion,
      this._getCourseLessonRosterCacheKey(teamId, planId, sessionId, scope, viewerUid),
    ].join('|');
  },

  _loadCourseLessonRosterPersistentStore(viewerUid = this._getCourseLessonRosterViewerUid()) {
    try {
      if (typeof localStorage === 'undefined' || !localStorage.getItem) return null;
      const raw = localStorage.getItem(this._getCourseLessonRosterPersistentStorageKey(viewerUid));
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || parsed.schemaVersion !== this._eduCourseRosterPersistentSchemaVersion || typeof parsed.entries !== 'object') {
        return { schemaVersion: this._eduCourseRosterPersistentSchemaVersion, entries: {} };
      }
      return parsed;
    } catch (_) {
      return { schemaVersion: this._eduCourseRosterPersistentSchemaVersion, entries: {} };
    }
  },

  _saveCourseLessonRosterPersistentStore(store, viewerUid = this._getCourseLessonRosterViewerUid()) {
    try {
      if (typeof localStorage === 'undefined' || !localStorage.setItem || !store) return false;
      const now = Date.now();
      const entries = store.entries && typeof store.entries === 'object' ? store.entries : {};
      const nextEntries = {};
      Object.entries(entries)
        .filter(([, entry]) => entry && Number(entry.expiresAtMs || 0) > now)
        .sort((a, b) => Number(b[1]?.storedAtMs || 0) - Number(a[1]?.storedAtMs || 0))
        .slice(0, Math.max(1, this._eduCourseRosterPersistentMaxEntries || 16))
        .forEach(([key, entry]) => { nextEntries[key] = entry; });
      const payload = {
        schemaVersion: this._eduCourseRosterPersistentSchemaVersion,
        savedAtMs: now,
        entries: nextEntries,
      };
      localStorage.setItem(this._getCourseLessonRosterPersistentStorageKey(viewerUid), JSON.stringify(payload));
      return true;
    } catch (_) {
      return false;
    }
  },

  _getCourseLessonRosterInvalidationKey(teamId, planId, sessionId = '') {
    return [
      String(teamId || '').trim(),
      String(planId || '').trim(),
      String(sessionId || '').trim(),
    ].join('|');
  },

  _getCourseLessonRosterInvalidatedAt(teamId, planId, sessionId) {
    const planKey = this._getCourseLessonRosterInvalidationKey(teamId, planId);
    const sessionKey = this._getCourseLessonRosterInvalidationKey(teamId, planId, sessionId);
    return Math.max(
      Number(this._eduCourseRosterInvalidatedAt?.[planKey] || 0),
      Number(this._eduCourseRosterInvalidatedAt?.[sessionKey] || 0),
    );
  },

  _shouldForceCourseLessonRosterRefresh(teamId, planId, sessionId) {
    const invalidatedAt = this._getCourseLessonRosterInvalidatedAt(teamId, planId, sessionId);
    if (!invalidatedAt) return false;
    const sessionKey = this._getCourseLessonRosterInvalidationKey(teamId, planId, sessionId);
    return Number(this._eduCourseRosterRefreshSatisfiedAt?.[sessionKey] || 0) < invalidatedAt;
  },

  _markCourseLessonRosterRefreshNeeded(teamId, planId, sessionId = '') {
    const key = this._getCourseLessonRosterInvalidationKey(teamId, planId, sessionId);
    this._eduCourseRosterInvalidatedAt = this._eduCourseRosterInvalidatedAt || {};
    this._eduCourseRosterInvalidatedAt[key] = Date.now();
    this._clearCourseLessonRosterPayloadCache(teamId, planId, sessionId);
    return this._eduCourseRosterInvalidatedAt[key];
  },

  _markCourseLessonRosterRefreshSatisfied(teamId, planId, sessionId) {
    if (!sessionId) return false;
    const key = this._getCourseLessonRosterInvalidationKey(teamId, planId, sessionId);
    this._eduCourseRosterRefreshSatisfiedAt = this._eduCourseRosterRefreshSatisfiedAt || {};
    this._eduCourseRosterRefreshSatisfiedAt[key] = Date.now();
    return true;
  },

  _getCourseLessonRosterCachedPayload(teamId, planId, sessionId, scope, viewerUid = this._getCourseLessonRosterViewerUid()) {
    const key = this._getCourseLessonRosterCacheKey(teamId, planId, sessionId, scope, viewerUid);
    const entry = this._eduCourseRosterPayloadCache?.[key];
    if (!entry || !entry.payload || Number(entry.expiresAtMs || 0) <= Date.now()) return null;
    if (Number(entry.storedAtMs || 0) <= this._getCourseLessonRosterInvalidatedAt(teamId, planId, sessionId)) {
      return null;
    }
    if (entry.payload?.canManageRoster === true && scope !== 'staff') return null;
    return entry.payload;
  },

  _buildCourseLessonRosterBasePreviewPayload(payload) {
    if (!payload || typeof payload !== 'object' || payload.rosterPublic === false) return null;
    const students = Array.isArray(payload.students)
      ? payload.students.map((student) => {
        const clean = { ...student };
        delete clean.attendanceKind;
        delete clean.canSelfLeave;
        delete clean.selfUid;
        delete clean.parentUid;
        delete clean.uid;
        delete clean.lineUserId;
        return clean;
      })
      : [];
    return {
      ...payload,
      canManageRoster: false,
      isStaff: false,
      staffEnrollmentByStudentId: null,
      students,
      cacheMeta: {
        ...(payload.cacheMeta || {}),
        preview: true,
        attendancePending: true,
        staffPending: payload.canManageRoster === true,
      },
    };
  },

  _buildCourseLessonRosterPersistentPreviewPayload(payload) {
    const base = this._buildCourseLessonRosterBasePreviewPayload(payload);
    if (!base) return null;
    const session = base.session && typeof base.session === 'object'
      ? {
        id: base.session.id,
        _docId: base.session._docId,
        title: base.session.title,
        topic: base.session.topic,
        focus: base.session.focus,
        date: base.session.date,
        startTime: base.session.startTime,
        endTime: base.session.endTime,
        location: base.session.location,
        status: base.session.status,
        capacity: base.session.capacity,
      }
      : {};
    const allowedStudentKeys = [
      'studentId',
      'id',
      '_docId',
      'displayName',
      'name',
      'nickname',
      'level',
      'groupName',
      'group',
      'jerseyNumber',
      'number',
      'position',
    ];
    const students = Array.isArray(base.students)
      ? base.students.map((student) => allowedStudentKeys.reduce((clean, key) => {
        if (student && Object.prototype.hasOwnProperty.call(student, key)) clean[key] = student[key];
        return clean;
      }, {}))
      : [];
    return {
      rosterPublic: true,
      canManageRoster: false,
      isStaff: false,
      staffEnrollmentByStudentId: null,
      session,
      students,
      cacheMeta: {
        payloadVersion: this._getCourseLessonRosterPayloadVersion(payload),
        preview: true,
        persistentPreview: true,
        attendancePending: true,
        staffPending: false,
      },
    };
  },

  _isCourseLessonNamesFirstPreviewAllowed(plan) {
    if (!plan || typeof plan !== 'object') return false;
    return plan.active !== false
      && plan.visibleOnTeamPage !== false
      && plan.rosterPublic !== false;
  },

  _getCourseLessonCachedEnrollments(teamId, planId, plan) {
    const key = typeof this._getCourseEnrollCacheKey === 'function'
      ? this._getCourseEnrollCacheKey(teamId, planId)
      : String(teamId || '') + ':' + String(planId || '');
    const cached = this._courseEnrollCache?.[key];
    if (Array.isArray(cached)) return cached;
    if (Array.isArray(plan?._enrollments)) return plan._enrollments;
    return [];
  },

  _getCourseLessonCachedStudents(teamId) {
    const direct = typeof this.getEduStudents === 'function' ? this.getEduStudents(teamId) : null;
    if (Array.isArray(direct)) return direct;
    const cached = this._eduStudentsCache?.[teamId];
    return Array.isArray(cached) ? cached : [];
  },

  _normalizeCourseLessonRosterPreviewStudent(source, fallbackId = '') {
    if (!source || typeof source !== 'object') return null;
    const studentId = String(source.studentId || source.id || source._docId || fallbackId || '').trim();
    if (!studentId) return null;
    const displayName = String(
      source.displayName
      || source.name
      || source.nickname
      || source.nickName
      || source.studentName
      || ''
    ).trim();
    if (!displayName) return null;
    const clean = {
      studentId,
      id: studentId,
      displayName,
      name: displayName,
    };
    const assignIfPresent = (targetKey, ...sourceKeys) => {
      const value = sourceKeys
        .map(key => source[key])
        .find(item => item !== undefined && item !== null && String(item).trim() !== '');
      if (value !== undefined) clean[targetKey] = value;
    };
    assignIfPresent('level', 'level', 'levelName');
    assignIfPresent('groupName', 'groupName', 'group', 'groupLabel');
    assignIfPresent('group', 'group');
    assignIfPresent('jerseyNumber', 'jerseyNumber', 'number', 'jersey');
    assignIfPresent('number', 'number', 'jerseyNumber', 'jersey');
    assignIfPresent('position', 'position');
    return clean;
  },

  _buildCourseLessonRosterNamesFirstPreviewPayload(teamId, planId, sessionId, plan, sessions) {
    if (!this._isCourseLessonNamesFirstPreviewAllowed(plan)) return null;
    const targetSessionId = String(sessionId || '').trim();
    const session = (Array.isArray(sessions) ? sessions : [])
      .find(item => this._getCourseLessonSessionId(item) === targetSessionId);
    if (!session || session.rosterPublic === false) return null;
    const studentIds = Array.isArray(session.studentIds)
      ? session.studentIds.map(value => String(value || '').trim()).filter(Boolean)
      : [];
    if (!studentIds.length) return null;

    const byStudentId = new Map();
    const addSource = (source, fallbackId = '') => {
      const clean = this._normalizeCourseLessonRosterPreviewStudent(source, fallbackId);
      if (!clean || byStudentId.has(clean.studentId)) return;
      byStudentId.set(clean.studentId, clean);
    };

    const sessionStudentSources = [
      session.students,
      session.rosterStudents,
      session.studentSnapshots,
    ];
    sessionStudentSources.forEach((list) => {
      if (Array.isArray(list)) list.forEach(item => addSource(item));
    });
    if (session.studentMap && typeof session.studentMap === 'object') {
      Object.entries(session.studentMap).forEach(([id, item]) => addSource(item, id));
    }
    if (session.studentNames && typeof session.studentNames === 'object') {
      Object.entries(session.studentNames).forEach(([id, name]) => addSource({ studentId: id, displayName: name }, id));
    }

    this._getCourseLessonCachedEnrollments(teamId, planId, plan)
      .filter(enrollment => this._isCourseEnrollmentActiveStatus?.(enrollment?.status) !== false)
      .forEach(enrollment => addSource(enrollment, enrollment?.studentId));
    this._getCourseLessonCachedStudents(teamId).forEach(student => addSource(student));

    const students = studentIds
      .map(id => byStudentId.get(id))
      .filter(Boolean);
    if (!students.length) return null;

    return {
      rosterPublic: true,
      canManageRoster: false,
      isStaff: false,
      staffEnrollmentByStudentId: null,
      session: {
        id: session.id,
        _docId: session._docId,
        title: session.title,
        topic: session.topic,
        focus: session.focus,
        date: session.date,
        startTime: session.startTime,
        endTime: session.endTime,
        location: session.location,
        status: session.status,
        capacity: session.capacity,
      },
      students,
      cacheMeta: {
        payloadVersion: 'names-first:' + targetSessionId + ':' + studentIds.join(','),
        preview: true,
        namesFirstPreview: true,
        attendancePending: true,
        staffPending: false,
      },
    };
  },

  _getCourseLessonRosterCachedRenderPayload(cachedPayload, options = {}) {
    if (!cachedPayload || typeof cachedPayload !== 'object') return null;
    if (options.includeStaleDetails === true
      && cachedPayload.cacheMeta?.persistentPreview !== true
      && cachedPayload.rosterPublic !== false) {
      const includeStaffFields = options.includeStaffFields === true && cachedPayload.canManageRoster === true;
      const students = Array.isArray(cachedPayload.students)
        ? cachedPayload.students.map((student) => {
          const clean = { ...student };
          delete clean.canSelfLeave;
          delete clean.selfUid;
          delete clean.parentUid;
          delete clean.uid;
          delete clean.lineUserId;
          return clean;
        })
        : [];
      return {
        ...cachedPayload,
        canManageRoster: includeStaffFields,
        isStaff: includeStaffFields,
        staffEnrollmentByStudentId: includeStaffFields
          ? (cachedPayload.staffEnrollmentByStudentId || null)
          : null,
        students,
        cacheMeta: {
          ...(cachedPayload.cacheMeta || {}),
          preview: false,
          staleCached: true,
          attendancePending: false,
          staffPending: includeStaffFields ? false : cachedPayload.canManageRoster === true,
        },
      };
    }
    return this._buildCourseLessonRosterBasePreviewPayload(cachedPayload);
  },

  _getCourseLessonRosterPersistentCachedPayload(teamId, planId, sessionId, scope, viewerUid = this._getCourseLessonRosterViewerUid()) {
    if (scope !== 'public') return null;
    const store = this._loadCourseLessonRosterPersistentStore(viewerUid);
    const key = this._getCourseLessonRosterPersistentCacheKey(teamId, planId, sessionId, 'public', viewerUid);
    const entry = store?.entries?.[key];
    if (!entry || !entry.payload || Number(entry.expiresAtMs || 0) <= Date.now()) {
      if (entry && store?.entries) {
        delete store.entries[key];
        this._saveCourseLessonRosterPersistentStore(store, viewerUid);
      }
      return null;
    }
    if (Number(entry.storedAtMs || 0) <= this._getCourseLessonRosterInvalidatedAt(teamId, planId, sessionId)) {
      delete store.entries[key];
      this._saveCourseLessonRosterPersistentStore(store, viewerUid);
      return null;
    }
    return entry.payload?.cacheMeta?.persistentPreview === true ? entry.payload : null;
  },

  _rememberCourseLessonRosterPersistentPreviewPayload(teamId, planId, sessionId, payload, viewerUid = this._getCourseLessonRosterViewerUid()) {
    const previewPayload = this._buildCourseLessonRosterPersistentPreviewPayload(payload);
    if (!previewPayload) return false;
    const store = this._loadCourseLessonRosterPersistentStore(viewerUid)
      || { schemaVersion: this._eduCourseRosterPersistentSchemaVersion, entries: {} };
    const now = Date.now();
    const ttl = Math.max(60 * 1000, Number(this._eduCourseRosterPersistentPublicTtlMs) || (10 * 60 * 1000));
    const key = this._getCourseLessonRosterPersistentCacheKey(teamId, planId, sessionId, 'public', viewerUid);
    store.entries = store.entries && typeof store.entries === 'object' ? store.entries : {};
    store.entries[key] = {
      payload: previewPayload,
      scope: 'public',
      storedAtMs: now,
      expiresAtMs: now + ttl,
      version: this._getCourseLessonRosterPayloadVersion(payload),
    };
    return this._saveCourseLessonRosterPersistentStore(store, viewerUid);
  },

  _rememberCourseLessonRosterPayload(teamId, planId, sessionId, payload, viewerUid = this._getCourseLessonRosterViewerUid()) {
    if (!payload || typeof payload !== 'object') return false;
    const scope = this._getCourseLessonRosterCacheScope(teamId, payload);
    if (scope === 'staff' && payload.canManageRoster === true && this.isEduClubStaff?.(teamId) !== true) {
      return false;
    }
    const ttl = Number(payload?.cacheMeta?.cacheTtlMs)
      || (scope === 'staff' ? this._eduCourseRosterStaffTtlMs : this._eduCourseRosterPublicTtlMs);
    const key = this._getCourseLessonRosterCacheKey(teamId, planId, sessionId, scope, viewerUid);
    this._eduCourseRosterPayloadCache = this._eduCourseRosterPayloadCache || {};
    this._eduCourseRosterPayloadCache[key] = {
      payload,
      storedAtMs: Date.now(),
      expiresAtMs: Date.now() + Math.max(1000, ttl),
      version: this._getCourseLessonRosterPayloadVersion(payload),
    };
    this._rememberCourseLessonRosterPersistentPreviewPayload(teamId, planId, sessionId, payload, viewerUid);
    return true;
  },

  _clearCourseLessonRosterPayloadCache(teamId, planId, sessionId) {
    const parts = [
      String(teamId || '').trim(),
      String(planId || '').trim(),
    ];
    if (sessionId) parts.push(String(sessionId || '').trim());
    const prefix = parts.join('|') + '|';
    Object.keys(this._eduCourseRosterPayloadCache || {}).forEach((key) => {
      if (key.startsWith(prefix)) delete this._eduCourseRosterPayloadCache[key];
    });
    this._clearCourseLessonRosterPersistentPayloadCache(teamId, planId, sessionId);
  },

  _clearCourseLessonRosterPersistentPayloadCache(teamId, planId, sessionId, viewerUid = this._getCourseLessonRosterViewerUid()) {
    const store = this._loadCourseLessonRosterPersistentStore(viewerUid);
    if (!store?.entries) return false;
    const parts = [
      'v' + this._eduCourseRosterPersistentSchemaVersion,
      String(teamId || '').trim(),
      String(planId || '').trim(),
    ];
    if (sessionId) parts.push(String(sessionId || '').trim());
    const prefix = parts.join('|') + '|';
    let removed = false;
    Object.keys(store.entries).forEach((key) => {
      if (key.startsWith(prefix)) {
        delete store.entries[key];
        removed = true;
      }
    });
    if (removed) this._saveCourseLessonRosterPersistentStore(store, viewerUid);
    return removed;
  },

  _hasCourseLessonRosterBlockingOverlay() {
    return !!document.querySelector?.('.edu-course-self-leave-overlay');
  },

  _getCourseLessonsCachedSessions(teamId, planId) {
    const key = this._getCourseSessionCacheKey?.(teamId, planId) || this._getCourseLessonsPreloadKey(teamId, planId);
    const cached = this._courseSessionCache?.[key];
    return Array.isArray(cached) ? cached : null;
  },

  _preloadCourseLessonsForPlans(teamId, plans) {
    if (!teamId || typeof this._loadCourseSessions !== 'function') return false;
    const limit = Math.max(1, Number(this._eduCourseLessonsPreloadLimit || 3));
    const candidates = (Array.isArray(plans) ? plans : [])
      .map((plan) => String(plan?.id || plan?._docId || '').trim())
      .filter(Boolean)
      .filter((planId, index, ids) => ids.indexOf(planId) === index)
      .filter((planId) => {
        const key = this._getCourseLessonsPreloadKey(teamId, planId);
        if (this._eduCourseLessonsPreloadPromises?.[key]) return false;
        return !this._getCourseLessonsCachedSessions(teamId, planId);
      })
      .slice(0, limit);
    candidates.forEach((planId) => {
      const key = this._getCourseLessonsPreloadKey(teamId, planId);
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
      await this.showCourseLessonRoster(teamId, planId, sessionId, { forceRefresh: true });
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

  _getCourseLessonConvertEventConfirmText(plan) {
    const planName = String(plan?.name || plan?.title || '此課程').trim();
    return [
      `確定要將「${planName}」的這堂課轉化成活動嗎？`,
      '',
      '轉化後系統會套用以下規則：',
      '1. 活動預設為不公開，需要職員到活動管理內手動開啟公開。',
      '2. 點擊轉化的職員會綁定為活動主辦人。',
      '3. 已確認參與此課堂的學員會直接列入活動報名列表。',
      '4. 課程學員保有優先報名權；若名額已滿，系統會把較晚報名的一般活動參與者下放候補。',
      '5. 活動會與課程保持關聯，後續學員在課程點報名或請假時會同步更新活動名單。',
      '',
      '確認後會立即建立或修復對應活動。',
    ].join('\n');
  },

  _getCourseLessonConvertEventErrorMessage(err) {
    const code = String(err?.details?.code || err?.code || err?.message || '').toUpperCase();
    if (code.includes('COURSE_LESSON_TIME_REQUIRED')) return '轉化失敗：課堂時間不完整，請先補上日期與開始時間。';
    if (code.includes('ONLY_WEEKLY_COURSE_CAN_CONVERT')) return '轉化失敗：目前只有固定週期課程可以轉化成活動。';
    if (code.includes('SESSION_NOT_CONVERTIBLE')) return '轉化失敗：已取消或已移除的課堂不能轉化。';
    if (code.includes('PERMISSION_DENIED') || code.includes('PERMISSION-DENIED')) return '轉化失敗：僅俱樂部職員可以轉化活動。';
    if (code.includes('COURSE_EVENT_ROSTER_SYNC_FAILED') || code.includes('COURSE_EVENT_ATTENDANCE_SYNC_FAILED')) return '活動已建立但名單同步失敗，請重新整理後再按一次「轉化成活動」修復。';
    if (code.includes('INTERNAL')) return '轉化活動失敗：後端資料同步發生錯誤，請稍後再試。';
    return '轉化活動失敗，請稍後再試';
  },
  _isCourseLessonConvertEventButtonConverted(button) {
    return !!(button && (
      String(button.dataset?.convertedEventId || '').trim()
      || button.classList?.contains?.('is-converted')
      || button.getAttribute?.('aria-disabled') === 'true'
    ));
  },

  _showCourseLessonAlreadyConvertedToast() {
    this.showToast?.('\u8a72\u8ab2\u7a0b\u5df2\u8f49\u5316\u6210\u6d3b\u52d5');
    return false;
  },

  _getCourseLessonConvertEventSuccessMessage(data, options = {}) {
    if (data?.rebuilt === true || options.repairAction === true) return '\u8ab2\u7a0b\u6d3b\u52d5\u5df2\u4fee\u5fa9\u5b8c\u6210';
    return '\u8ab2\u7a0b\u5df2\u8f49\u5316\u6210\u6d3b\u52d5\u5b8c\u6210';
  },

  _markCourseLessonConvertEventButtonConverted(button, data = {}) {
    if (!button) return false;
    try {
      if (button.dataset) button.dataset.convertedEventId = data.eventId || '';
      button.disabled = false;
      button.setAttribute?.('aria-disabled', 'true');
      button.setAttribute?.('title', '\u8a72\u8ab2\u7a0b\u5df2\u8f49\u5316\u6210\u6d3b\u52d5');
      if (button.classList?.add) button.classList.add('is-converted');
      button.textContent = '\u5df2\u8f49\u5316';
      return true;
    } catch (_) {
      return false;
    }
  },

  _patchCourseLessonConvertedEventState(teamId, planId, sessionId, data = {}) {
    if (!data?.success) return false;
    const safeTeamId = String(teamId || '').trim();
    const safePlanId = String(planId || '').trim();
    const safeSessionId = String(sessionId || '').trim();
    if (!safeTeamId || !safePlanId || !safeSessionId) return false;

    const eventId = String(data.eventId || data.convertedEventId || data.linkedEventId || '').trim();
    const courseLinkId = String(data.courseLinkId || '').trim();
    const patch = {
      courseLinked: true,
      courseLinkSource: 'eduCourseLesson',
      _courseLessonLinkedEventConfirmedAt: Date.now(),
    };
    if (eventId) {
      patch.convertedEventId = eventId;
      patch.linkedEventId = eventId;
    }
    if (courseLinkId) patch.courseLinkId = courseLinkId;

    const patchSession = (session) => {
      const id = String(session?.id || session?._docId || '').trim();
      if (!session || id !== safeSessionId) return false;
      Object.assign(session, patch);
      return true;
    };

    let patched = false;
    const ctx = this._eduCourseLessonsContext;
    if (ctx?.mode === 'list'
      && String(ctx.teamId || '').trim() === safeTeamId
      && String(ctx.planId || '').trim() === safePlanId
      && Array.isArray(ctx.sessions)) {
      patched = ctx.sessions.some(patchSession) || patched;
    }

    const cacheKey = this._getCourseSessionCacheKey?.(safeTeamId, safePlanId) || this._getCourseLessonsPreloadKey?.(safeTeamId, safePlanId);
    const cachedSessions = cacheKey && Array.isArray(this._courseSessionCache?.[cacheKey])
      ? this._courseSessionCache[cacheKey]
      : null;
    const patchedCache = cachedSessions ? cachedSessions.some(patchSession) : false;
    if (patchedCache && typeof this._markCourseSessionCacheMutated === 'function') {
      this._markCourseSessionCacheMutated(safeTeamId, safePlanId);
    }
    return patched || patchedCache;
  },

  _refreshCourseLessonListAfterConvert(teamId, planId) {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || ctx.mode !== 'list') return false;
    if (String(ctx.teamId || '') !== String(teamId || '') || String(ctx.planId || '') !== String(planId || '')) return false;
    if (!ctx.plan || !Array.isArray(ctx.sessions)) return false;
    const container = this._getEduCourseLessonsContainer?.();
    if (!container || typeof this._renderCourseLessonList !== 'function') return false;
    container.innerHTML = this._renderCourseLessonList(ctx.plan, ctx.sessions, {
      teamId: ctx.teamId,
      planId: ctx.planId,
      isStaff: this.isEduClubStaff?.(ctx.teamId) === true,
      currentStudentCount: ctx.currentStudentCount,
      planType: ctx.plan?.planType,
      confirmedCountBySessionId: ctx.confirmedCountBySessionId,
    });
    return true;
  },

  async convertCourseLessonToEvent(teamId, planId, sessionId, button) {
    const safeTeamId = String(teamId || '').trim();
    const safePlanId = String(planId || '').trim();
    const safeSessionId = String(sessionId || '').trim();
    if (!safeTeamId || !safePlanId || !safeSessionId) {
      this.showToast?.('\u7f3a\u5c11\u8ab2\u5802\u8cc7\u6599\uff0c\u8acb\u91cd\u65b0\u958b\u555f\u8ab2\u5802\u5217\u8868');
      return null;
    }
    if (this.isEduClubStaff?.(safeTeamId) !== true) {
      this.showToast?.('\u50c5\u4ff1\u6a02\u90e8\u8077\u54e1\u53ef\u4ee5\u8f49\u5316\u6d3b\u52d5');
      return null;
    }
    if (this._isCourseLessonConvertEventButtonConverted?.(button)) {
      return this._showCourseLessonAlreadyConvertedToast?.() ?? false;
    }
    const plan = this._findEduCoursePlan?.(safeTeamId, safePlanId) || null;
    const confirmMessage = typeof this._getCourseLessonConvertEventConfirmText === 'function'
      ? this._getCourseLessonConvertEventConfirmText(plan)
      : '轉化後活動預設為不公開，點擊者會成為活動主辦人，且課堂名單會同步到活動報名列表。確認轉化成活動？';
    let confirmed = true;
    if (typeof this.appConfirm === 'function') confirmed = await this.appConfirm(confirmMessage);
    else if (typeof window !== 'undefined' && typeof window.confirm === 'function') confirmed = window.confirm(confirmMessage);
    if (!confirmed) return null;

    const repairAction = String(button?.textContent || '').includes('\u4fee\u5fa9');
    const markConverted = (data) => {
      if (!data?.success) return data;
      this._patchCourseLessonConvertedEventState?.(safeTeamId, safePlanId, safeSessionId, data);
      this._markCourseLessonConvertEventButtonConverted?.(button, data);
      this._refreshCourseLessonListAfterConvert?.(safeTeamId, safePlanId);
      const successMessage = typeof this._getCourseLessonConvertEventSuccessMessage === 'function'
        ? this._getCourseLessonConvertEventSuccessMessage(data, { repairAction })
        : '\u8ab2\u7a0b\u5df2\u8f49\u5316\u6210\u6d3b\u52d5\u5b8c\u6210';
      this.showToast?.(successMessage);
      return data;
    };
    const run = async () => {
      try {
        if (typeof ensureFirebaseFunctionsSdk !== 'function') throw new Error('FUNCTIONS_SDK_MISSING');
        const callable = (await ensureFirebaseFunctionsSdk('asia-east1')).httpsCallable('createEventFromCourseLesson');
        const currentUser = typeof ApiService !== 'undefined' && typeof ApiService.getCurrentUser === 'function'
          ? ApiService.getCurrentUser()
          : null;
        const creatorName = String(currentUser?.displayName || currentUser?.name || '').trim();
        const courseCoverImage = String(
          this._getCoursePlanCoverUrl?.(plan)
          || plan?.coverImage
          || plan?.coverUrl
          || plan?.imageUrl
          || plan?.image
          || plan?.imageVariants?.cover
          || plan?.imageVariants?.card
          || ''
        ).trim();
        const result = await callable({
          teamId: safeTeamId,
          planId: safePlanId,
          sessionId: safeSessionId,
          courseCoverImage,
          creatorName,
          displayName: creatorName,
          name: creatorName,
        });
        const data = result?.data || {};
        return data;
      } catch (err) {
        console.error('[convertCourseLessonToEvent]', err);
        const message = typeof this._getCourseLessonConvertEventErrorMessage === 'function'
          ? this._getCourseLessonConvertEventErrorMessage(err)
          : '\u8f49\u5316\u6d3b\u52d5\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66';
        this.showToast?.(message);
        return null;
      }
    };
    if (typeof this._withButtonLoading === 'function') {
      const result = this._withButtonLoading(button, '\u8f49\u5316\u4e2d...', run);
      return result && typeof result.then === 'function' ? result.then(markConverted) : result;
    }
    return run().then(markConverted);
  },

  async showCourseLessons(teamId, planId, options = {}) {
    const previousContext = this._eduCourseLessonsContext;
    const isSameRoute = this.currentPage === 'page-edu-course-lessons'
      && previousContext?.mode === 'list'
      && String(previousContext?.teamId || '') === String(teamId || '')
      && String(previousContext?.planId || '') === String(planId || '');
    const routeTransitionSeq = this._prepareEduCourseLessonsTransition(options, isSameRoute);
    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return this._abortEduCourseLessonsTransition('showCourseLessons-entry', routeTransitionSeq);
    }
    this._stopCourseLessonAttendanceCountListener();
    const requestSeq = ++this._eduCourseLessonsRequestSeq;
    this._eduCurrentTeamId = teamId;
    this._eduCourseLessonsContext = { teamId, planId, mode: 'list' };
    await this.showPage('page-edu-course-lessons', { _navigationTransitionSeq: routeTransitionSeq });
    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return this._abortEduCourseLessonsTransition('showCourseLessons-showPage', routeTransitionSeq);
    }
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
      const sortedCachedSessions = this._sortCourseLessonListSessions(cachedSessions);
      const cachedCount = Number(cachedPlan._effectiveCount);
      container.innerHTML = this._renderCourseLessonList(cachedPlan, sortedCachedSessions, {
        teamId,
        planId,
        isStaff: this.isEduClubStaff?.(teamId) === true,
        planType: cachedPlan.planType,
        currentStudentCount: Number.isFinite(cachedCount) && cachedCount >= 0 ? cachedCount : null,
        confirmedCountBySessionId: cachedPlan.planType === 'weekly' ? this._buildCourseLessonConfirmedCountBySessionId(sortedCachedSessions, []) : null,
      });
    }

    const state = await this._loadEduCourseLessonsState(teamId, planId);
    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return this._abortEduCourseLessonsTransition('showCourseLessons-state', routeTransitionSeq);
    }
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
      if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
        return this._abortEduCourseLessonsTransition('showCourseLessons-session-sync', routeTransitionSeq);
      }
      if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
    }
    sessions = this._sortCourseLessonListSessions(sessions);
    const currentStudentCount = await this._getCourseLessonsCurrentStudentCount(teamId, plan);
    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return this._abortEduCourseLessonsTransition('showCourseLessons-count', routeTransitionSeq);
    }
    if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
    let confirmedCountBySessionId = null;
    if (plan.planType === 'weekly') {
      confirmedCountBySessionId = this._buildCourseLessonConfirmedCountBySessionId(sessions, []);
      const liveCounts = await this._startCourseLessonAttendanceCountListener(teamId, planId, sessions);
      if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
        return this._abortEduCourseLessonsTransition('showCourseLessons-attendance-listener', routeTransitionSeq);
      }
      if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
      if (liveCounts !== null) {
        confirmedCountBySessionId = liveCounts;
      } else if (typeof FirebaseService?.queryEduAttendance === 'function') {
        try {
          const attendanceRecords = await FirebaseService.queryEduAttendance({ teamId, coursePlanId: planId });
          confirmedCountBySessionId = this._buildCourseLessonConfirmedCountBySessionId(sessions, attendanceRecords);
        } catch (err) {
          console.warn('[edu-course-lessons] weekly attendance count load failed:', err);
        }
        if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
          return this._abortEduCourseLessonsTransition('showCourseLessons-attendance', routeTransitionSeq);
        }
        if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
      }
    }
    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return this._abortEduCourseLessonsTransition('showCourseLessons-render', routeTransitionSeq);
    }
    container.innerHTML = this._renderCourseLessonList(plan, sessions, { teamId, planId, isStaff, currentStudentCount, planType: plan.planType, confirmedCountBySessionId });
    this._eduCourseLessonsContext = { teamId, planId, mode: 'list', plan, sessions, currentStudentCount, confirmedCountBySessionId };
    return { ok: true };
  },

  _getCourseLessonRosterStudentId(student) {
    return String(student?.studentId || student?.id || student?._docId || '').trim();
  },

  _sortCourseLessonListSessions(sessions) {
    const nowMs = Date.now();
    return [...(Array.isArray(sessions) ? sessions : [])].sort((a, b) => {
      const getMeta = (session) => this._getCourseLessonStatusMeta?.(session)
        || this._getCourseSessionStatusMeta?.(session)
        || {};
      const getRank = (session) => {
        const status = String(session?.status || '').trim().toLowerCase();
        const cls = String(getMeta(session)?.cls || '').trim().toLowerCase();
        return (status === 'done' || status === 'cancelled' || status === 'canceled' || cls === 'done' || cls === 'cancelled')
          ? 1
          : 0;
      };
      const getMs = (session) => {
        const value = Number(this._getCourseSessionSortValue?.(session));
        return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
      };
      const rankA = getRank(a);
      const rankB = getRank(b);
      if (rankA !== rankB) return rankA - rankB;
      const msA = getMs(a);
      const msB = getMs(b);
      if (rankA === 1) {
        const distanceA = Number.isFinite(msA) ? Math.abs(msA - nowMs) : Number.POSITIVE_INFINITY;
        const distanceB = Number.isFinite(msB) ? Math.abs(msB - nowMs) : Number.POSITIVE_INFINITY;
        if (distanceA !== distanceB) return distanceA - distanceB;
      } else if (msA !== msB) {
        return msA - msB;
      }
      const lessonA = Number(a?.sessionNumber || a?.lessonNumber || 0);
      const lessonB = Number(b?.sessionNumber || b?.lessonNumber || 0);
      if (Number.isFinite(lessonA) && Number.isFinite(lessonB) && lessonA !== lessonB) return lessonA - lessonB;
      return String(a?.id || a?._docId || '').localeCompare(String(b?.id || b?._docId || ''), 'zh-Hant');
    });
  },

  _getCourseLessonAttendanceMap(students, options = {}) {
    const map = {};
    (students || []).forEach((student) => {
      const studentId = this._getCourseLessonRosterStudentId(student);
      if (!studentId) return;
      const kind = String(student?.attendanceKind || '').trim();
      map[studentId] = kind === 'leave'
        ? 'leave'
        : kind === 'registered'
          ? 'registered'
          : kind === 'signin'
            ? 'signin'
            : options.planType === 'weekly' ? 'leave' : null;
    });
    return map;
  },

  _buildCourseLessonConfirmedCountBySessionId(sessions, attendanceRecords) {
    const sessionIds = new Set();
    const sessionsByDate = {};
    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
      const sessionId = this._getCourseLessonSessionId(session);
      if (!sessionId) return;
      sessionIds.add(sessionId);
      const date = String(session?.date || '').trim();
      if (date) {
        sessionsByDate[date] = sessionsByDate[date] || [];
        sessionsByDate[date].push(sessionId);
      }
    });
    const setsBySessionId = {};
    const addStudent = (sessionId, studentId) => {
      if (!sessionId || !studentId) return;
      setsBySessionId[sessionId] = setsBySessionId[sessionId] || new Set();
      setsBySessionId[sessionId].add(studentId);
    };
    (Array.isArray(attendanceRecords) ? attendanceRecords : []).forEach((record) => {
      const status = String(record?.status || '').trim().toLowerCase();
      if (status === 'removed' || status === 'cancelled' || status === 'canceled') return;
      const kind = String(record?.kind || 'signin').trim().toLowerCase();
      if (kind !== 'registered' && kind !== 'signin') return;
      const studentId = String(record?.studentId || '').trim();
      if (!studentId) return;
      const recordSessionId = String(record?.sessionId || '').trim();
      if (recordSessionId && sessionIds.has(recordSessionId)) {
        addStudent(recordSessionId, studentId);
        return;
      }
      const date = String(record?.date || '').trim();
      (sessionsByDate[date] || []).forEach(sessionId => addStudent(sessionId, studentId));
    });
    const counts = {};
    sessionIds.forEach((sessionId) => {
      counts[sessionId] = setsBySessionId[sessionId]?.size || 0;
    });
    return counts;
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
    if (ctx.staleCached === true) return;
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
      await this.showCourseLessonRoster(ctx.teamId, ctx.planId, ctx.sessionId, { forceRefresh: true });
    };

    if (typeof this._withButtonLoading === 'function') {
      return this._withButtonLoading(button, '儲存中...', run);
    }
    return run();
  },

  startCourseLessonNotesEdit() {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || ctx.mode !== 'roster' || !ctx.isStaff) return;
    if (ctx.staleCached === true) return;
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
      await this.showCourseLessonRoster(ctx.teamId, ctx.planId, ctx.sessionId, { forceRefresh: true });
    };
    if (typeof this._withButtonLoading === 'function') {
      return this._withButtonLoading(button, '儲存中...', run);
    }
    return run();
  },

  showCourseLessonSelfRegisterDialog(studentId, kind, button) {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || ctx.mode !== 'roster' || ctx.isStaff || ctx.planType !== 'weekly') return false;
    const key = String(studentId || '').trim();
    const targetKind = kind === 'registered' ? 'registered' : 'leave';
    const registering = targetKind === 'registered';
    const students = Array.isArray(ctx.rosterPayload?.students) ? ctx.rosterPayload.students : [];
    const getDisplayKind = (student) => (
      typeof this._getCourseLessonRosterDisplayKind === 'function'
        ? this._getCourseLessonRosterDisplayKind(student, ctx)
        : (String(student?.attendanceKind || '').trim() || 'leave')
    );
    const candidates = students.filter(item => item?.canSelfLeave === true);
    const selectable = candidates.filter((item) => {
      const displayKind = getDisplayKind(item);
      return registering
        ? displayKind !== 'registered' && displayKind !== 'signin'
        : displayKind === 'registered';
    });
    if (!selectable.length) {
      this.showToast?.(registering ? '目前沒有可報名的學員' : '目前沒有可取消報名的學員');
      return false;
    }
    const existing = document.querySelector?.('.edu-course-self-register-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay edu-course-self-register-overlay';
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
    const renderItem = (student) => {
      const id = this._getCourseLessonRosterStudentId(student);
      const checked = id === key ? ' checked' : '';
      const displayKind = getDisplayKind(student);
      const statusText = displayKind === 'registered'
        ? '已報名'
        : displayKind === 'signin' ? '已簽到' : '請假';
      return '<label class="edu-ce-pick-item edu-course-self-register-pick">'
        + '<div class="edu-ce-pick-main"><span class="edu-ce-pick-name">' + escapeHTML(student.displayName || '學員') + '</span>'
        + '<span class="edu-ce-pick-info">' + escapeHTML(statusText) + '</span></div>'
        + '<input type="checkbox" value="' + escapeHTML(id) + '"' + checked + '></label>';
    };
    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">' + (registering ? '課堂報名' : '取消報名') + '</div>'
      + '<div style="font-size:.85rem;color:var(--text-secondary);margin-bottom:.6rem">'
      + (registering ? '選擇這堂課要報名上課的學員。' : '選擇要取消本堂報名的學員。')
      + '</div>'
      + '<div class="edu-ce-pick-list">' + selectable.map(renderItem).join('') + '</div>'
      + '<div style="display:flex;gap:.5rem;margin-top:.8rem">'
      + '<button class="outline-btn" style="flex:1" onclick="this.closest(&quot;.edu-info-overlay&quot;).remove()">\u53d6\u6d88</button>'
      + '<button class="primary-btn" style="flex:1" id="_eduSelfRegisterConfirmBtn">' + (registering ? '確認報名' : '確認取消') + '</button>'
      + '</div></div>';
    document.body.appendChild(overlay);
    document.getElementById('_eduSelfRegisterConfirmBtn').onclick = async () => {
      const ids = Array.from(overlay.querySelectorAll('.edu-ce-pick-list input[type="checkbox"]:checked'))
        .map(input => input.value)
        .filter(Boolean);
      if (!ids.length) {
        this.showToast?.('請選擇至少一位學員');
        return;
      }
      overlay.remove();
      return this._saveCourseLessonSelfRegistrationSelection(ids, targetKind, button);
    };
    return false;
  },

  async _saveCourseLessonSelfRegistrationSelection(studentIds, kind, button) {
    const ctx = this._eduCourseLessonsContext;
    if (!ctx || ctx.mode !== 'roster' || ctx.isStaff || ctx.planType !== 'weekly') return;
    const targetKind = kind === 'registered' ? 'registered' : 'leave';
    const ids = Array.from(new Set((Array.isArray(studentIds) ? studentIds : [studentIds])
      .map(value => String(value || '').trim())
      .filter(Boolean)));
    const students = Array.isArray(ctx.rosterPayload?.students) ? ctx.rosterPayload.students : [];
    const selected = ids
      .map(id => students.find(item => this._getCourseLessonRosterStudentId(item) === id))
      .filter(student => student && student.canSelfLeave === true);
    if (!selected.length) {
      this.showToast?.('目前沒有可處理的報名學員');
      return;
    }
    const run = async () => {
      const resultByStudentId = new Map();
      try {
        for (const student of selected) {
          const studentId = this._getCourseLessonRosterStudentId(student);
          const result = await FirebaseService.saveEduCourseSelfAttendance({
            teamId: ctx.teamId,
            planId: ctx.planId,
            sessionId: ctx.sessionId,
            date: ctx.rosterPayload?.session?.date,
            studentId,
            studentName: student.displayName || '',
            selfUid: student.selfUid || null,
            parentUid: student.parentUid || null,
            kind: targetKind,
          });
          resultByStudentId.set(studentId, result || {});
        }
      } catch (err) {
        console.error('[saveCourseLessonSelfRegistration]', err);
        this.showToast?.('報名處理失敗，請重新開啟課堂名單後再試');
        return;
      }
      let signedInPreservedCount = 0;
      selected.forEach((student) => {
        const studentId = this._getCourseLessonRosterStudentId(student);
        const result = resultByStudentId.get(studentId) || {};
        if (result.signedIn === true || result.kind === 'signin') {
          student.attendanceKind = 'signin';
          signedInPreservedCount += 1;
          return;
        }
        student.attendanceKind = targetKind;
      });
      if (signedInPreservedCount === selected.length) {
        this.showToast?.('已簽到，保留簽到狀態');
      } else if (signedInPreservedCount > 0) {
        this.showToast?.('已完成處理，已簽到學員保留簽到狀態');
      } else {
        this.showToast?.(targetKind === 'registered' ? '已完成報名' : '已取消報名');
      }
      await this.showCourseLessonRoster(ctx.teamId, ctx.planId, ctx.sessionId, { forceRefresh: true });
    };

    if (typeof this._withButtonLoading === 'function') {
      return this._withButtonLoading(button, targetKind === 'registered' ? '報名中...' : '取消中...', run);
    }
    return run();
  },

  async saveCourseLessonSelfRegistration(studentId, kind, button) {
    return this._saveCourseLessonSelfRegistrationSelection([studentId], kind === 'registered' ? 'registered' : 'leave', button);
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
      await this.showCourseLessonRoster(ctx.teamId, ctx.planId, ctx.sessionId, { forceRefresh: true });
    };

    if (typeof this._withButtonLoading === 'function') {
      return this._withButtonLoading(button, leave ? '請假中...' : '取消中...', run);
    }
    return run();
  },

  async saveCourseLessonSelfLeave(studentId, kind, button) {
    return this._saveCourseLessonSelfLeaveSelection([studentId], kind === 'leave', button);
  },

  async _applyCourseLessonRosterPayload(teamId, planId, sessionId, plan, rosterPayload, localStaff, requestSeq, options = {}) {
    const container = this._getEduCourseLessonsContainer();
    if (!container || !plan) return { ok: false, reason: !container ? 'missing_container' : 'plan_not_found' };
    const routeTransitionSeq = Number(options?.routeTransitionSeq || 0);
    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return this._abortEduCourseLessonsTransition('applyCourseLessonRoster-entry', routeTransitionSeq);
    }

    const hasServerManageFlag = rosterPayload && Object.prototype.hasOwnProperty.call(rosterPayload, 'canManageRoster');
    const canManageRoster = hasServerManageFlag ? rosterPayload.canManageRoster === true : localStaff;
    const notesByStudentId = {};
    const enrollIdsByStudentId = {};
    const tracksPayment = typeof this._shouldTrackCoursePlanPayment === 'function'
      ? this._shouldTrackCoursePlanPayment(plan)
      : (plan?.perSessionBilling !== true && Number(plan?.price) > 0);
    let paidByStudentId = null;
    if (canManageRoster) {
      try {
        const paidMap = {};
        const staffEnrollmentMap = rosterPayload?.staffEnrollmentByStudentId
          && typeof rosterPayload.staffEnrollmentByStudentId === 'object'
          ? rosterPayload.staffEnrollmentByStudentId
          : null;
        if (staffEnrollmentMap) {
          Object.entries(staffEnrollmentMap).forEach(([studentIdRaw, enrollment]) => {
            const studentId = String(studentIdRaw || '').trim();
            if (!studentId || !enrollment) return;
            if (enrollment.paidAt || String(enrollment.paymentStatus || '').toLowerCase() === 'paid') {
              paidMap[studentId] = true;
            }
            if (enrollment.coachNotes) notesByStudentId[studentId] = String(enrollment.coachNotes || '');
            enrollIdsByStudentId[studentId] = enrollment.enrollmentId || enrollment.id || enrollment._docId || '';
          });
        } else if (localStaff && typeof this._loadCourseEnrollments === 'function') {
          const enrollments = await this._loadCourseEnrollments(teamId, planId);
          if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
            return this._abortEduCourseLessonsTransition('applyCourseLessonRoster-enrollments', routeTransitionSeq);
          }
          if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
          (enrollments || []).forEach((enrollment) => {
            const studentId = String(enrollment.studentId || '').trim();
            if (!studentId || enrollment.status === 'rejected') return;
            if (String(enrollment.status || 'approved').trim().toLowerCase() === 'approved' && enrollment.paidAt) {
              paidMap[studentId] = true;
            }
            if (enrollment.coachNotes) notesByStudentId[studentId] = String(enrollment.coachNotes || '');
            enrollIdsByStudentId[studentId] = enrollment.id || enrollment._docId || '';
          });
        }
        paidByStudentId = tracksPayment ? paidMap : null;
      } catch (err) {
        console.warn('[edu-course-lessons] staff notes load failed:', err);
      }
    }

    if (rosterPayload && rosterPayload.rosterPublic === false && !canManageRoster) {
      if (options.render !== false) {
        container.innerHTML = '<div class="edu-course-lessons-empty"><strong>名單未公開</strong><span>此課堂名單目前未公開，請聯繫俱樂部職員。</span></div>';
      }
      return { ok: true, closed: true };
    }

    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return this._abortEduCourseLessonsTransition('applyCourseLessonRoster-render', routeTransitionSeq);
    }
    const planType = plan?.planType === 'weekly' ? 'weekly' : 'session';
    const attendanceByStudentId = this._getCourseLessonAttendanceMap(rosterPayload?.students || [], { planType });
    this._eduCourseLessonsContext = {
      teamId,
      planId,
      sessionId,
      mode: 'roster',
      isStaff: canManageRoster,
      canManageRoster,
      planType,
      rosterPayload,
      notesByStudentId,
      enrollIdsByStudentId,
      paidByStudentId,
      attendanceByStudentId,
      draftByStudentId: { ...attendanceByStudentId },
      manageMode: false,
      notesEditMode: false,
      draftSessionNotes: '',
      refreshPending: options.refreshPending === true,
      refreshError: options.refreshError === true,
      staleCached: options.staleCached === true,
    };
    if (options.render !== false) this._renderCourseLessonRosterFromContext();
    return { ok: true };
  },

  async _refreshCourseLessonRosterInBackground(
    requestSeq,
    teamId,
    planId,
    sessionId,
    planOrState,
    localStaff,
    previousVersion,
    viewerUidAtStart = this._getCourseLessonRosterViewerUid(),
    options = {},
  ) {
    const routeTransitionSeq = Number(options?.routeTransitionSeq || 0);
    const abortStaleRefresh = (source) => {
      this._tryResumeCourseLessonRosterForCurrentTransition(
        requestSeq,
        routeTransitionSeq,
        source,
      );
      return this._abortEduCourseLessonsTransition(source, routeTransitionSeq);
    };
    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return abortStaleRefresh('refreshCourseLessonRoster-entry');
    }
    const finishRefreshIndicator = (state = {}) => {
      if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) return;
      const ctx = this._eduCourseLessonsContext;
      if (ctx?.mode !== 'roster'
        || String(ctx.teamId || '') !== String(teamId || '')
        || String(ctx.planId || '') !== String(planId || '')
        || String(ctx.sessionId || '') !== String(sessionId || '')
        || this._isEduCourseLessonsStale(requestSeq, teamId)) {
        return;
      }
      const preserveStaleCached = state.preserveStaleCached === true
        || (state.refreshError === true && ctx.staleCached === true)
        || (state.render === false && ctx.staleCached === true);
      ctx.refreshPending = false;
      if (!preserveStaleCached) ctx.staleCached = false;
      if (state.refreshError === true) ctx.refreshError = true;
      if (state.render === false) {
        const status = this._getEduCourseLessonsContainer?.()
          ?.querySelector?.('.edu-course-roster-refresh-status');
        status?.remove?.();
        return;
      }
      const editing = ctx.manageMode === true || ctx.notesEditMode === true;
      if (!editing && !this._hasCourseLessonRosterBlockingOverlay()) {
        this._renderCourseLessonRosterFromContext?.();
      }
    };
    try {
      const rosterRequest = options.rosterPromise || FirebaseService.listEduCoursePublicRoster(teamId, planId, sessionId);
      const rosterPromise = this._withCourseLessonRosterTimeout(
        rosterRequest,
        this._eduCourseRosterRequestTimeoutMs,
        'COURSE_LESSON_ROSTER_TIMEOUT',
        'Course lesson roster request timed out',
      );
      const statePromise = planOrState && typeof planOrState.then === 'function'
        ? planOrState
        : Promise.resolve(planOrState);
      const [stateOrPlan, rosterPayload] = await Promise.all([statePromise, rosterPromise]);
      if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
        return abortStaleRefresh('refreshCourseLessonRoster-data');
      }
      if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
      if (this._getCourseLessonRosterViewerUid() !== viewerUidAtStart) {
        return this._handleCourseLessonRosterViewerChange(
          teamId,
          planId,
          sessionId,
          routeTransitionSeq,
          options,
        );
      }
      this._rememberCourseLessonRosterPayload(teamId, planId, sessionId, rosterPayload, viewerUidAtStart);
      if (options.forceRefresh === true) this._markCourseLessonRosterRefreshSatisfied(teamId, planId, sessionId);
      if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
      const plan = stateOrPlan?.plan || stateOrPlan;
      if (!plan) {
        finishRefreshIndicator({ refreshError: true });
        return { ok: false, reason: 'plan_not_found' };
      }
      const ctx = this._eduCourseLessonsContext;
      const editing = ctx?.mode === 'roster' && (ctx.manageMode === true || ctx.notesEditMode === true);
      if (editing || this._hasCourseLessonRosterBlockingOverlay()) {
        finishRefreshIndicator({ render: false });
        this._recordCourseLessonRosterPerf('fresh_deferred', {
          teamId,
          planId,
          sessionId,
          reason: editing ? 'editing' : 'blocking_overlay',
          studentCount: Array.isArray(rosterPayload?.students) ? rosterPayload.students.length : 0,
        }, options.perfStartedAtMs);
        return { ok: true, deferred: true };
      }
      const nextVersion = this._getCourseLessonRosterPayloadVersion(rosterPayload);
      const currentPreview = ctx?.rosterPayload?.cacheMeta?.preview === true;
      if (!currentPreview && ctx?.staleCached !== true && previousVersion && nextVersion && previousVersion === nextVersion) {
        finishRefreshIndicator();
        this._recordCourseLessonRosterPerf('fresh_unchanged', {
          teamId,
          planId,
          sessionId,
          cachedVersion: previousVersion || '',
          freshVersion: nextVersion || '',
          studentCount: Array.isArray(rosterPayload?.students) ? rosterPayload.students.length : 0,
        }, options.perfStartedAtMs);
        return { ok: true, unchanged: true };
      }
      const result = await this._applyCourseLessonRosterPayload(
        teamId,
        planId,
        sessionId,
        plan,
        rosterPayload,
        localStaff,
        requestSeq,
        { routeTransitionSeq },
      );
      if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
        return abortStaleRefresh('refreshCourseLessonRoster-render');
      }
      this._recordCourseLessonRosterPerf('fresh_overlay', {
        teamId,
        planId,
        sessionId,
        cachedVersion: previousVersion || '',
        freshVersion: nextVersion || '',
        studentCount: Array.isArray(rosterPayload?.students) ? rosterPayload.students.length : 0,
      }, options.perfStartedAtMs);
      return result;
    } catch (err) {
      if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
        return abortStaleRefresh('refreshCourseLessonRoster-error');
      }
      console.warn('[edu-course-lessons] roster background refresh failed:', err);
      const ctx = this._eduCourseLessonsContext;
      if (ctx?.mode === 'roster'
        && (ctx.rosterPayload?.cacheMeta?.preview === true || ctx.staleCached === true)
        && String(ctx.teamId || '') === String(teamId || '')
        && String(ctx.planId || '') === String(planId || '')
        && String(ctx.sessionId || '') === String(sessionId || '')
        && !this._isEduCourseLessonsStale(requestSeq, teamId)) {
        finishRefreshIndicator({ refreshError: true, preserveStaleCached: true });
      }
      return { ok: false, reason: 'refresh_failed' };
    }
  },

  _isCurrentEduCourseLessonCanonicalRoute(teamId, planId, sessionId) {
    if (typeof window === 'undefined' || !window.location) return false;
    try {
      const href = String(window.location.href || '');
      const parsedUrl = href ? new URL(href) : null;
      const pathname = String(window.location.pathname || parsedUrl?.pathname || '/');
      const hostname = String(window.location.hostname || parsedUrl?.hostname || '');
      const allowPrefix = /^(?:miniapp|liff)\.line\.me$/i.test(hostname);
      const expected = [teamId, planId, sessionId].map(value => String(value || '').trim());
      let route = typeof this._parseEduCourseLessonRoute === 'function'
        ? this._parseEduCourseLessonRoute(pathname, { allowPrefix })
        : null;
      if (!route) {
        const rawSegments = pathname.split('/').filter(Boolean);
        const suffixOffset = rawSegments.length - 6;
        if (suffixOffset < 0 || suffixOffset > 1) return false;
        if (suffixOffset === 1 && !allowPrefix) return false;
        const segments = rawSegments.slice(suffixOffset);
        if (segments[0] !== 'teams' || segments[2] !== 'courses' || segments[4] !== 'lessons') {
          return false;
        }
        const decodeSafe = (raw) => {
          const encoded = String(raw || '');
          if (!encoded || /%2f|%5c/i.test(encoded)) return '';
          try {
            const decoded = decodeURIComponent(encoded);
            return /^[A-Za-z0-9_-]{3,80}$/.test(decoded) ? decoded : '';
          } catch (_) {
            return '';
          }
        };
        if (suffixOffset === 1 && !decodeSafe(rawSegments[0])) return false;
        route = {
          teamId: decodeSafe(segments[1]),
          planId: decodeSafe(segments[3]),
          lessonId: decodeSafe(segments[5]),
        };
      }
      return route.teamId === expected[0]
        && route.planId === expected[1]
        && route.lessonId === expected[2];
    } catch (_) {
      return false;
    }
  },

  async showCourseLessonRoster(teamId, planId, sessionId, options = {}) {
    const previousContext = this._eduCourseLessonsContext;
    const isSameRoute = this.currentPage === 'page-edu-course-lessons'
      && previousContext?.mode === 'roster'
      && String(previousContext?.teamId || '') === String(teamId || '')
      && String(previousContext?.planId || '') === String(planId || '')
      && String(previousContext?.sessionId || '') === String(sessionId || '');
    const restoreRequested = options?._restoredPageReady === true;
    const inheritedRestoreTransitionSeq = Number(options?._navigationTransitionSeq);
    const hasInheritedRestoreTransition = Number.isSafeInteger(inheritedRestoreTransitionSeq)
      && inheritedRestoreTransitionSeq > 0;
    if (restoreRequested && !hasInheritedRestoreTransition) {
      return { ok: false, reason: 'restore_not_current' };
    }
    const routeTransitionSeq = restoreRequested
      ? inheritedRestoreTransitionSeq
      : this._prepareEduCourseLessonsTransition(options, isSameRoute);
    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return this._abortEduCourseLessonsTransition('showCourseLessonRoster-entry', routeTransitionSeq);
    }
    const restoreCandidate = restoreRequested
      ? this._getCourseLessonRosterRestoreCandidate(routeTransitionSeq, {
        allowPendingActivation: options?._allowPendingPageActivation === true,
      })
      : null;
    const restoredPageReady = isSameRoute
      && restoreCandidate?.teamId === String(teamId || '').trim()
      && restoreCandidate?.planId === String(planId || '').trim()
      && restoreCandidate?.sessionId === String(sessionId || '').trim();
    if (restoreRequested && !restoredPageReady) {
      return { ok: false, reason: 'restore_not_current' };
    }
    this._stopCourseLessonAttendanceCountListener();
    const perfStartedAtMs = this._getCourseLessonRosterPerfNow();
    this._eduCourseRosterPerfTimeline = [];
    this._recordCourseLessonRosterPerf('start', {
      teamId,
      planId,
      sessionId,
      forceRefresh: options?.forceRefresh === true,
    }, perfStartedAtMs);
    const requestSeq = ++this._eduCourseLessonsRequestSeq;
    this._eduCurrentTeamId = teamId;
    this._eduCourseLessonsContext = { teamId, planId, sessionId, mode: 'roster' };
    let rosterContainer = null;
    const ownsRosterLoad = (candidate, allowAdopt = false) => {
      const ctx = this._eduCourseLessonsContext;
      const ownsContext = requestSeq === this._eduCourseLessonsRequestSeq
        && this.currentPage === 'page-edu-course-lessons'
        && ctx?.mode === 'roster'
        && String(ctx?.teamId || '') === String(teamId || '')
        && String(ctx?.planId || '') === String(planId || '')
        && String(ctx?.sessionId || '') === String(sessionId || '');
      if (!ownsContext || !candidate) return false;
      if (!rosterContainer && allowAdopt) rosterContainer = candidate;
      return candidate === rosterContainer;
    };
    const hasBlockingRosterLoading = candidate => {
      const html = String(candidate?.innerHTML || '');
      return html.includes('edu-course-lessons-loading')
        || html.includes('edu-course-roster-shell-loading');
    };
    try {
    if (this.currentPage === 'page-edu-course-lessons') rosterContainer = this._getEduCourseLessonsContainer();
    const preserveRouteUrl = options?.preserveRouteUrl === true
      || this._isCurrentEduCourseLessonCanonicalRoute?.(teamId, planId, sessionId) === true;
    if (!restoredPageReady) {
      await this.showPage('page-edu-course-lessons', {
        _navigationTransitionSeq: routeTransitionSeq,
        bypassPageLock: options?.bypassPageLock === true,
        ...(options?.skipPageHistory === true ? { skipPageHistory: true } : {}),
        ...((preserveRouteUrl || options?.suppressHashSync === true)
          ? { suppressHashSync: true }
          : {}),
      });
    }
    if (this.currentPage === 'page-edu-course-lessons') {
      const visibleContainer = this._getEduCourseLessonsContainer();
      if (visibleContainer) rosterContainer = visibleContainer;
    }
    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return this._abortEduCourseLessonsTransition('showCourseLessonRoster-showPage', routeTransitionSeq);
    }
    if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };

    const container = this._getEduCourseLessonsContainer();
    if (!container) return { ok: false, reason: 'missing_container' };
    rosterContainer = container;
    this._setEduCourseLessonsTitle('課堂名單');
    container.innerHTML = this._renderCourseLessonsLoading('課堂名單載入中');
    this._recordCourseLessonRosterPerf('skeleton', { teamId, planId, sessionId }, perfStartedAtMs);
    const cachedPlanForShell = this._findEduCoursePlan(teamId, planId);
    const cachedSessionsForShell = this._getCourseLessonsCachedSessions(teamId, planId);
    const cachedSessionForShell = Array.isArray(cachedSessionsForShell)
      ? cachedSessionsForShell.find(session => this._getCourseLessonSessionId(session) === String(sessionId || '').trim())
      : null;
    if (typeof this._renderCourseLessonRosterLoadingShell === 'function' && (cachedPlanForShell || cachedSessionForShell)) {
      container.innerHTML = this._renderCourseLessonRosterLoadingShell(cachedPlanForShell, cachedSessionForShell, '\u540d\u55ae\u540c\u6b65\u4e2d');
      this._recordCourseLessonRosterPerf('staged_skeleton', { teamId, planId, sessionId }, perfStartedAtMs);
    }

    const localStaff = this.isEduClubStaff?.(teamId) === true;
    const viewerUidAtStart = this._getCourseLessonRosterViewerUid();
    const explicitForceRefresh = options?.forceRefresh === true;
    const markedForceRefresh = this._shouldForceCourseLessonRosterRefresh(teamId, planId, sessionId);
    const forceRefresh = explicitForceRefresh || markedForceRefresh;
    const cacheScope = localStaff ? 'staff' : 'public';
    let cachedSource = 'memory';
    let cachedPayload = forceRefresh
      ? null
      : this._getCourseLessonRosterCachedPayload(teamId, planId, sessionId, cacheScope, viewerUidAtStart);
    if (!cachedPayload && !forceRefresh) {
      cachedPayload = this._getCourseLessonRosterPersistentCachedPayload(teamId, planId, sessionId, 'public', viewerUidAtStart);
      if (cachedPayload) cachedSource = 'persistent';
    }
    const cachedRenderPayload = this._getCourseLessonRosterCachedRenderPayload(cachedPayload, {
      includeStaleDetails: cachedSource === 'memory',
      includeStaffFields: cachedSource === 'memory' && localStaff && cacheScope === 'staff',
    });
    const cachedPlan = cachedRenderPayload ? (cachedPlanForShell || this._findEduCoursePlan(teamId, planId)) : null;
    const lessonStatePromise = this._withCourseLessonRosterTimeout(
      this._loadEduCourseLessonsState(teamId, planId),
      this._eduCourseRosterStateTimeoutMs,
      'COURSE_LESSON_STATE_TIMEOUT',
      'Course lesson state request timed out',
    );
    void lessonStatePromise.catch(() => {});
    const freshRosterRequest = forceRefresh
      ? FirebaseService.listEduCoursePublicRoster(teamId, planId, sessionId, { forceRefresh: true })
      : FirebaseService.listEduCoursePublicRoster(teamId, planId, sessionId);
    const freshRosterPromise = this._withCourseLessonRosterTimeout(
      freshRosterRequest,
      this._eduCourseRosterRequestTimeoutMs,
      'COURSE_LESSON_ROSTER_TIMEOUT',
      'Course lesson roster request timed out',
    );
    let namesFirstPreviewRendered = false;
    let freshRosterApplied = false;
    const applyNamesFirstPreview = async (state, source) => {
      if (cachedRenderPayload || namesFirstPreviewRendered || freshRosterApplied) return null;
      if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) return null;
      if (this._isEduCourseLessonsStale(requestSeq, teamId)) return null;
      if (this._getCourseLessonRosterViewerUid() !== viewerUidAtStart) return null;
      const statePlan = state?.plan || cachedPlanForShell;
      const stateSessions = Array.isArray(state?.sessions) ? state.sessions : (cachedSessionsForShell || []);
      const previewPayload = this._buildCourseLessonRosterNamesFirstPreviewPayload(
        teamId,
        planId,
        sessionId,
        statePlan,
        stateSessions,
      );
      if (!previewPayload) return null;
      const result = await this._applyCourseLessonRosterPayload(
        teamId,
        planId,
        sessionId,
        statePlan,
        previewPayload,
        false,
        requestSeq,
        { refreshPending: true, routeTransitionSeq },
      );
      if (result?.ok !== true || result.closed === true) return result;
      namesFirstPreviewRendered = true;
      this._recordCourseLessonRosterPerf('names_first_preview', {
        teamId,
        planId,
        sessionId,
        source,
        studentCount: Array.isArray(previewPayload.students) ? previewPayload.students.length : 0,
      }, perfStartedAtMs);
      return result;
    };

    if (cachedRenderPayload && cachedPlan) {
      const result = await this._applyCourseLessonRosterPayload(
        teamId,
        planId,
        sessionId,
        cachedPlan,
        cachedRenderPayload,
        localStaff,
        requestSeq,
        { refreshPending: true, staleCached: cachedRenderPayload?.cacheMeta?.staleCached === true, routeTransitionSeq },
      );
      this._recordCourseLessonRosterPerf('cache_preview', {
        teamId,
        planId,
        sessionId,
        cacheScope,
        cacheSource: cachedSource,
        cachedVersion: this._getCourseLessonRosterPayloadVersion(cachedPayload),
        studentCount: Array.isArray(cachedRenderPayload?.students) ? cachedRenderPayload.students.length : 0,
      }, perfStartedAtMs);
      this._refreshCourseLessonRosterInBackground(
        requestSeq,
        teamId,
        planId,
        sessionId,
        cachedPlan || lessonStatePromise,
        localStaff,
        this._getCourseLessonRosterPayloadVersion(cachedPayload),
        viewerUidAtStart,
        {
          forceRefresh,
          rosterPromise: freshRosterPromise,
          perfStartedAtMs,
          routeTransitionSeq,
          _viewerChangeRetryCount: options?._viewerChangeRetryCount,
        },
      );
      return { ...result, cached: true };
    }

    await applyNamesFirstPreview({ plan: cachedPlanForShell, sessions: cachedSessionsForShell || [] }, 'cached_shell');
    const namesFirstPreviewPromise = namesFirstPreviewRendered
      ? null
      : lessonStatePromise
        .then(state => applyNamesFirstPreview(state, 'lesson_state'))
        .catch((err) => {
          console.warn('[edu-course-lessons] names-first preview skipped:', err);
          return null;
        });

    let lessonStateResult;
    let freshRosterResult;
    if (cachedPlanForShell) {
      [freshRosterResult] = await Promise.allSettled([freshRosterPromise]);
      lessonStateResult = {
        status: 'fulfilled',
        value: { plan: cachedPlanForShell, sessions: cachedSessionsForShell || [] },
      };
    } else {
      [lessonStateResult, freshRosterResult] = await Promise.allSettled([lessonStatePromise, freshRosterPromise]);
    }
    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return this._abortEduCourseLessonsTransition('showCourseLessonRoster-data', routeTransitionSeq);
    }
    const lessonState = lessonStateResult.status === 'fulfilled'
      ? lessonStateResult.value
      : { plan: cachedPlanForShell, sessions: cachedSessionsForShell || [] };
    if (lessonStateResult.status === 'rejected') {
      console.warn('[edu-course-lessons] lesson state load failed:', lessonStateResult.reason);
    }
    const freshRosterPayload = freshRosterResult.status === 'fulfilled' ? freshRosterResult.value : null;
    if (this._isEduCourseLessonsStale(requestSeq, teamId)) return { ok: false, reason: 'stale' };
    if (this._getCourseLessonRosterViewerUid() !== viewerUidAtStart) {
      return await this._handleCourseLessonRosterViewerChange(
        teamId,
        planId,
        sessionId,
        routeTransitionSeq,
        { ...options, perfStartedAtMs },
      );
    }
    const lessonPlan = lessonState.plan;
    if (!lessonPlan) {
      if (lessonStateResult.status === 'rejected') {
        container.innerHTML = this._renderCourseLessonRosterLoadFailure(
          teamId,
          planId,
          sessionId,
          '&#35506;&#22530;&#36039;&#26009;&#36617;&#20837;&#22833;&#25943;&#65292;&#35531;&#37325;&#35430;',
        );
        return { ok: false, reason: 'state_failed' };
      }
      container.innerHTML = '<div class="edu-empty-state">找不到課程方案</div>';
      return { ok: false, reason: 'plan_not_found' };
    }
    if (freshRosterResult.status !== 'fulfilled' || !freshRosterPayload) {
      console.warn('[edu-course-lessons] roster load failed:', freshRosterResult.reason);
      await applyNamesFirstPreview(lessonState, 'lesson_state_final');
      const ctx = this._eduCourseLessonsContext;
      if (ctx?.mode === 'roster'
        && ctx.rosterPayload?.cacheMeta?.namesFirstPreview === true
        && String(ctx.teamId || '') === String(teamId || '')
        && String(ctx.planId || '') === String(planId || '')
        && String(ctx.sessionId || '') === String(sessionId || '')) {
        ctx.refreshPending = false;
        ctx.refreshError = true;
        this._renderCourseLessonRosterFromContext?.();
        return { ok: false, reason: 'roster_failed', preview: true };
      }
      container.innerHTML = this._renderCourseLessonRosterLoadFailure(teamId, planId, sessionId);
      return { ok: false, reason: 'roster_failed' };
    }
    if (namesFirstPreviewPromise && !cachedPlanForShell) await namesFirstPreviewPromise;
    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return this._abortEduCourseLessonsTransition('showCourseLessonRoster-preview', routeTransitionSeq);
    }
    if (this._getCourseLessonRosterViewerUid() !== viewerUidAtStart) {
      return await this._handleCourseLessonRosterViewerChange(
        teamId,
        planId,
        sessionId,
        routeTransitionSeq,
        { ...options, perfStartedAtMs },
      );
    }
    freshRosterApplied = true;
    this._rememberCourseLessonRosterPayload(teamId, planId, sessionId, freshRosterPayload, viewerUidAtStart);
    if (forceRefresh) this._markCourseLessonRosterRefreshSatisfied(teamId, planId, sessionId);
    const result = await this._applyCourseLessonRosterPayload(
      teamId,
      planId,
      sessionId,
      lessonPlan,
      freshRosterPayload,
      localStaff,
      requestSeq,
      { routeTransitionSeq },
    );
    if (!this._isEduCourseLessonsTransitionCurrent(routeTransitionSeq)) {
      return this._abortEduCourseLessonsTransition('showCourseLessonRoster-render', routeTransitionSeq);
    }
    this._recordCourseLessonRosterPerf('fresh_roster', {
      teamId,
      planId,
      sessionId,
      forceRefresh,
      freshVersion: this._getCourseLessonRosterPayloadVersion(freshRosterPayload),
      studentCount: Array.isArray(freshRosterPayload?.students) ? freshRosterPayload.students.length : 0,
    }, perfStartedAtMs);
    return result;
    } catch (err) {
      console.error('[edu-course-lessons] roster flow failed:', {
        stage: 'showCourseLessonRoster',
        reason: err?.code || err?.message || 'unknown',
        requestSeq,
        routeTransitionSeq,
      });
      return { ok: false, reason: 'roster_flow_failed' };
    } finally {
      const currentContainer = this._getEduCourseLessonsContainer();
      const ownsCurrentRosterLoad = ownsRosterLoad(currentContainer, true);
      const ownsBlockingRosterLoading = ownsCurrentRosterLoad
        && hasBlockingRosterLoading(currentContainer);
      const resumed = ownsCurrentRosterLoad
        ? this._tryResumeCourseLessonRosterForCurrentTransition(
          requestSeq,
          routeTransitionSeq,
          'showCourseLessonRoster-finally',
        )
        : false;
      if (ownsBlockingRosterLoading && !resumed) {
        currentContainer.innerHTML = this._renderCourseLessonRosterLoadFailure(
          teamId,
          planId,
          sessionId,
        );
      }
    }
  },
});
