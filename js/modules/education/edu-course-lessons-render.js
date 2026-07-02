/* ================================================
   SportHub — Education: Course Lessons Render
   ================================================ */

Object.assign(App, {
  _eduCourseLessonsJsArg(value) {
    return escapeHTML(String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '));
  },

  _renderCourseLessonsLoading(text) {
    return '<div class="edu-loading edu-course-lessons-loading" role="status" aria-live="polite" aria-busy="true">'
      + '<div class="edu-loading-bar"><div class="edu-loading-fill"></div></div>'
      + '<div class="edu-loading-text">' + escapeHTML(text || '課堂資料載入中') + '</div>'
      + '<div class="edu-loading-skeleton" aria-hidden="true">'
        + '<div class="edu-loading-skeleton-row"></div>'
        + '<div class="edu-loading-skeleton-row"></div>'
      + '</div>'
      + '</div>';
  },

  _renderCourseLessonRosterLoadingShell(plan, session, text) {
    const status = this._getCourseLessonStatusMeta(session || {});
    const title = session?.title || session?.topic || session?.focus || plan?.name || '\u8ab2\u5802\u540d\u55ae';
    const dateText = session
      ? this._formatCourseLessonDateTime(session)
      : (plan?.startDate || '\u8cc7\u6599\u540c\u6b65\u4e2d');
    const rows = Array.from({ length: 5 }).map((_, index) => (
      '<article class="edu-course-roster-card edu-course-roster-card-skeleton" aria-hidden="true">'
        + '<div class="edu-course-roster-main">'
          + '<div class="edu-course-roster-skeleton-pill"></div>'
          + '<div class="edu-course-roster-skeleton-line edu-course-roster-skeleton-line-' + (index % 3) + '"></div>'
        + '</div>'
        + '<div class="edu-course-roster-side"><span class="edu-course-roster-skeleton-status"></span></div>'
      + '</article>'
    )).join('');
    return '<div class="edu-course-roster-shell edu-course-roster-shell-loading" role="status" aria-live="polite" aria-busy="true">'
      + '<section class="edu-course-roster-head">'
        + '<button type="button" class="outline-btn small" disabled aria-disabled="true">' + escapeHTML('\u8fd4\u56de\u8ab2\u5802') + '</button>'
        + '<div class="edu-course-roster-title-block">'
          + '<div class="edu-course-roster-title-line">'
            + '<span class="edu-course-lesson-status edu-course-lesson-status-' + escapeHTML(status.cls) + '">' + escapeHTML(status.label) + '</span>'
            + '<h3>' + escapeHTML(title) + '</h3>'
            + '<p>' + escapeHTML(dateText) + '</p>'
          + '</div>'
        + '</div>'
      + '</section>'
      + '<section class="edu-course-roster-list-panel">'
        + '<div class="edu-course-lessons-section-title"><strong>&#26412;&#22530;&#21517;&#21934;</strong><span>' + escapeHTML(text || '\u6b63\u5728\u540c\u6b65') + '</span></div>'
        + '<div class="edu-course-roster-list">' + rows + '</div>'
      + '</section>'
      + '</div>';
  },

  _formatCourseLessonDateTime(session) {
    const dateText = this._formatCourseSessionDate?.(session) || session?.date || '未排定日期';
    const timeText = this._formatCourseSessionTime?.(session) || session?.startTime || '未設定時段';
    return dateText + ' ' + timeText;
  },

  _getCourseLessonStatusMeta(session) {
    return this._getCourseSessionStatusMeta?.(session) || { label: '已排課', cls: 'scheduled' };
  },

  _getCourseLessonStudentCount(session, context = {}, statusMeta) {
    if (context.planType === 'weekly' && context.confirmedCountBySessionId) {
      const sessionId = String(session?.id || session?._docId || '').trim();
      if (sessionId && Object.prototype.hasOwnProperty.call(context.confirmedCountBySessionId, sessionId)) {
        const confirmedCount = Number(context.confirmedCountBySessionId[sessionId]);
        return Number.isFinite(confirmedCount) && confirmedCount >= 0 ? confirmedCount : 0;
      }
      return 0;
    }
    if (typeof this._getCourseSessionDisplayStudentCount === 'function') {
      return this._getCourseSessionDisplayStudentCount(session, {
        currentStudentCount: context.currentStudentCount,
        statusMeta,
      });
    }
    const frozenCount = Array.isArray(session?.studentIds) ? session.studentIds.length : 0;
    const done = String(session?.status || '').trim() === 'done' || statusMeta?.cls === 'done';
    const rawDynamicCount = context.currentStudentCount;
    const dynamicCount = rawDynamicCount === null || rawDynamicCount === undefined || rawDynamicCount === ''
      ? NaN
      : Number(rawDynamicCount);
    return !done && Number.isFinite(dynamicCount) && dynamicCount >= 0 ? dynamicCount : frozenCount;
  },

  _getCourseLessonAttendanceMeta(kind) {
    if (kind === 'pending') return { label: '更新中', cls: 'pending' };
    if (kind === 'leave') return { label: '請假', cls: 'leave' };
    if (kind === 'registered') return { label: '\u5df2\u5831\u540d', cls: 'registered' };
    if (kind === 'signin') return { label: '已簽到', cls: 'signin' };
    return { label: '未簽到', cls: 'none' };
  },
  _getCourseLessonRosterDisplayKind(student, context = {}) {
    const kind = String(student?.attendanceKind || '').trim();
    if (kind === 'leave' || kind === 'registered' || kind === 'signin' || kind === 'pending') return kind;
    return context.planType === 'weekly' ? 'leave' : null;
  },

  _renderCourseLessonList(plan, sessions, context = {}) {
    const teamId = context.teamId || '';
    const planId = plan?.id || context.planId || '';
    const jsTeamId = this._eduCourseLessonsJsArg(teamId);
    const jsPlanId = this._eduCourseLessonsJsArg(planId);
    const lessonRows = (sessions || []).map((session, index) => {
      const status = this._getCourseLessonStatusMeta(session);
      const location = String(session.location || plan?.location || '').trim() || '地點未設定';
      const capacity = session.capacity ? '/' + session.capacity : '';
      const count = this._getCourseLessonStudentCount(session, context, status) + capacity + ' 人';
      const jsSessionId = this._eduCourseLessonsJsArg(session.id || session._docId || '');
      const statusKey = String(session.status || status.cls || '').trim().toLowerCase();
      const canConvertToEvent = context.isStaff === true
        && context.planType === 'weekly'
        && !['cancelled', 'canceled', 'removed'].includes(statusKey)
        && !['cancelled', 'canceled', 'removed'].includes(String(status.cls || '').trim().toLowerCase());
      const convertEventBtn = canConvertToEvent
        ? '<button type="button" class="outline-btn small edu-course-lesson-convert-event-btn" onkeydown="event.stopPropagation()" onclick="event.stopPropagation();return App.convertCourseLessonToEvent(\'' + jsTeamId + '\',\'' + jsPlanId + '\',\'' + jsSessionId + '\',this)">\u8f49\u5316\u6210\u6d3b\u52d5</button>'
        : '';
      const quickAdjustBtn = context.isStaff
        ? '<button type="button" class="edu-course-lesson-adjust-btn" aria-label="調整課堂" title="調整課堂" onclick="event.stopPropagation();return App.openCourseLessonQuickAdjust(\'' + jsTeamId + '\',\'' + jsPlanId + '\',\'' + jsSessionId + '\',this)">'
          + '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>'
        + '</button>'
        : '';
      return '<article class="edu-course-lesson-card edu-course-lesson-card-' + escapeHTML(status.cls) + '" role="button" tabindex="0" onclick="App.showCourseLessonRoster(\'' + jsTeamId + '\',\'' + jsPlanId + '\',\'' + jsSessionId + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();App.showCourseLessonRoster(\'' + jsTeamId + '\',\'' + jsPlanId + '\',\'' + jsSessionId + '\')}">'
        + '<div class="edu-course-lesson-index"><strong>' + (index + 1) + '</strong></div>'
        + '<div class="edu-course-lesson-main">'
          + '<div class="edu-course-lesson-head">'
            + '<h3>' + escapeHTML(session.title || session.topic || session.focus || '未命名課堂') + '</h3>'
            + '<div class="edu-course-lesson-head-actions">'
              + convertEventBtn
              + '<span class="edu-course-lesson-status edu-course-lesson-status-' + escapeHTML(status.cls) + '">' + escapeHTML(status.label) + '</span>'
            + '</div>'
          + '</div>'
          + '<div class="edu-course-lesson-meta">'
            + '<span class="edu-course-lesson-meta-time' + (quickAdjustBtn ? ' has-adjust' : '') + '"><b>時間</b><em>' + escapeHTML(this._formatCourseLessonDateTime(session)) + '</em>' + quickAdjustBtn + '</span>'
            + '<span class="edu-course-lesson-meta-location"><b>地點</b><em>' + escapeHTML(location) + '</em></span>'
            + '<span class="edu-course-lesson-meta-count"><b>人數</b><em>' + escapeHTML(count) + '</em></span>'
          + '</div>'
        + '</div>'
      + '</article>';
    }).join('');
    const emptyHtml = '<div class="edu-course-lessons-empty">'
      + '<strong>尚未建立課堂</strong>'
      + '<span>建立課堂後，這裡會顯示每一堂的日期、地點與本堂名單。</span>'
      + (context.isStaff ? '<button class="primary-btn small" onclick="App.openCourseSessionForm(\'' + jsTeamId + '\',\'' + jsPlanId + '\')">＋ 新增課堂</button>' : '')
      + '</div>';
    const typeLabel = plan?.planType === 'weekly' ? '固定週期課程' : '堂數制課程';
    const coverImage = String(plan?.coverImage || plan?.coverUrl || plan?.imageUrl || plan?.image || '').trim();
    const heroClass = 'edu-course-lessons-hero' + (coverImage ? ' has-cover' : '');
    const heroStyle = coverImage ? ' style="--edu-course-lessons-cover:url(\'' + escapeHTML(coverImage) + '\')"' : '';
    return '<div class="edu-course-lessons-shell">'
      + '<section class="' + heroClass + '"' + heroStyle + '>'
        + '<div class="edu-course-lessons-hero-copy">'
          + '<span class="edu-course-lessons-eyebrow">' + escapeHTML(typeLabel) + '</span>'
          + '<h3>' + escapeHTML(plan?.name || '課程方案') + '</h3>'
          + '<p>' + escapeHTML((plan?.startDate || '未設定期間') + (plan?.endDate ? ' - ' + plan.endDate : '')) + '</p>'
        + '</div>'
      + '</section>'
      + '<section class="edu-course-lessons-list-panel">'
        + '<div class="edu-course-lessons-section-title"><strong>課堂列表</strong><span>' + (sessions || []).length + ' 堂</span></div>'
        + '<div class="edu-course-lessons-list">' + (lessonRows || emptyHtml) + '</div>'
      + '</section>'
      + '</div>';
  },

  _renderCourseLessonRosterView(payload, context = {}) {
    const session = payload?.session || {};
    const students = Array.isArray(payload?.students) ? payload.students : [];
    const notesByStudentId = context.notesByStudentId || {};
    const jsTeamId = this._eduCourseLessonsJsArg(context.teamId);
    const jsPlanId = this._eduCourseLessonsJsArg(context.planId);
    const status = this._getCourseLessonStatusMeta(session);
    const manageMode = context.isStaff === true && context.manageMode === true;
    const paidByStudentId = context.paidByStudentId && typeof context.paidByStudentId === 'object'
      ? context.paidByStudentId
      : null;
    const isRosterPreview = payload?.cacheMeta?.preview === true || context.preview === true;
    const staleCached = context.staleCached === true;
    const backDisabled = staleCached || isRosterPreview || context.refreshPending === true;
    const shouldSplitUnpaid = context.isStaff === true && paidByStudentId !== null;
    const getRosterStudentId = (student) => (
      typeof this._getCourseLessonRosterStudentId === 'function'
        ? this._getCourseLessonRosterStudentId(student)
        : String(student?.studentId || student?.id || student?._docId || '').trim()
    );
    const paidStudents = [];
    const unpaidStudents = [];
    students.forEach((student) => {
      const studentId = getRosterStudentId(student);
      if (shouldSplitUnpaid && (!studentId || paidByStudentId[studentId] !== true)) unpaidStudents.push(student);
      else paidStudents.push(student);
    });
    let rosterRowIndex = 0;
    const renderRosterCard = (student, unpaid = false) => {
      const index = rosterRowIndex++;
      const name = student.displayName || '學員';
      const studentId = getRosterStudentId(student);
      const rawDraftKind = isRosterPreview
        ? 'pending'
        : (manageMode
          ? (context.draftByStudentId?.[studentId] || null)
          : this._getCourseLessonRosterDisplayKind(student, context));
      const draftKind = context.planType === 'weekly' && !rawDraftKind ? 'leave' : rawDraftKind;
      const attendance = this._getCourseLessonAttendanceMeta(draftKind);
      const note = notesByStudentId[studentId] || '';
      const safeStudentId = this._eduCourseLessonsJsArg(studentId);
      const signinId = 'edu-roster-signin-' + index;
      const leaveId = 'edu-roster-leave-' + index;
      const statusHtml = '<span class="edu-course-roster-status edu-course-roster-status-' + escapeHTML(attendance.cls) + '">' + escapeHTML(attendance.label) + '</span>';
      const selfRegisterActionHtml = (!isRosterPreview && !staleCached && !context.isStaff && context.planType === 'weekly' && student.canSelfLeave === true)
        ? '<div class="edu-course-roster-self-actions">'
          + statusHtml
          + (draftKind === 'signin'
            ? ''
            : '<button type="button" class="outline-btn small edu-roster-self-register-btn" onclick="return App.showCourseLessonSelfRegisterDialog(\'' + safeStudentId + '\',\'' + (draftKind === 'registered' ? 'leave' : 'registered') + '\',this)">'
              + (draftKind === 'registered' ? '\u53d6\u6d88\u5831\u540d' : '\u5831\u540d')
              + '</button>')
        + '</div>'
        : '';
      const selfLeaveActionHtml = (!isRosterPreview && !staleCached && !context.isStaff && student.canSelfLeave === true)
        ? '<div class="edu-course-roster-self-actions">'
          + statusHtml
          + '<button type="button" class="outline-btn small edu-roster-self-leave-btn" onclick="return App.showCourseLessonSelfLeaveDialog(\'' + safeStudentId + '\',\'' + (draftKind === 'leave' ? '' : 'leave') + '\',this)">'
          + (draftKind === 'leave' ? '取消請假' : '我要請假')
          + '</button>'
        + '</div>'
        : '';
      const manageHtml = manageMode
        ? '<div class="edu-course-roster-manage" role="group" aria-label="出席狀態">'
          + '<span class="edu-roster-choice">'
            + '<input class="edu-roster-cb edu-roster-cb-signin" type="checkbox" id="' + signinId + '" ' + (draftKind === 'signin' ? 'checked ' : '') + 'onchange="App.setCourseLessonRosterDraft(\'' + safeStudentId + '\',this.checked?\'signin\':null)">'
            + '<label class="edu-roster-choice-label" for="' + signinId + '"><span class="edu-roster-choice-box"></span><span>出席</span></label>'
          + '</span>'
          + '<span class="edu-roster-choice">'
            + '<input class="edu-roster-cb edu-roster-cb-leave" type="checkbox" id="' + leaveId + '" ' + (draftKind === 'leave' ? 'checked ' : '') + 'onchange="App.setCourseLessonRosterDraft(\'' + safeStudentId + '\',this.checked?\'leave\':null)">'
            + '<label class="edu-roster-choice-label" for="' + leaveId + '"><span class="edu-roster-choice-box"></span><span>請假</span></label>'
          + '</span>'
        + '</div>'
        : (selfRegisterActionHtml || selfLeaveActionHtml || statusHtml);
      const studentPill = typeof this._renderCourseSessionMemberPill === 'function'
        ? this._renderCourseSessionMemberPill({
            id: studentId,
            name,
            displayName: name,
            selfUid: student.selfUid,
            parentUid: student.parentUid,
            uid: student.uid,
            lineUserId: student.lineUserId,
          }, name, { link: true })
        : '<span class="td-member-name-pill uc-user edu-course-member-pill" onclick="event.stopPropagation();App.showUserProfile(\'' + this._eduCourseLessonsJsArg(name) + '\')">' + escapeHTML(name) + '</span>';
      const noteHtml = context.isStaff
        ? '<div class="edu-course-roster-note"><span>' + escapeHTML(note || '尚未填寫備註') + '</span>'
          + (staleCached ? '' : '<button type="button" class="edu-session-note-edit" title="編輯備註" aria-label="編輯備註" onclick="event.stopPropagation();App.editCourseSessionRosterNote(\'' + jsTeamId + '\',\'' + jsPlanId + '\',\'' + this._eduCourseLessonsJsArg(studentId) + '\',\'' + this._eduCourseLessonsJsArg(context.enrollIdsByStudentId?.[studentId] || '') + '\')"></button>')
          + '</div>'
        : '';
      const paymentBadgeHtml = unpaid
        ? '<span class="edu-course-roster-payment edu-course-roster-payment-unpaid">未繳費</span>'
        : '';
      return '<article class="edu-course-roster-card edu-course-roster-card-' + escapeHTML(attendance.cls) + (unpaid ? ' edu-course-roster-card-unpaid' : '') + '">'
        + '<div class="edu-course-roster-main">'
          + '<div class="edu-course-roster-name-line">'
            + studentPill
            + paymentBadgeHtml
            + noteHtml
          + '</div>'
        + '</div>'
        + '<div class="edu-course-roster-side">' + manageHtml + '</div>'
      + '</article>';
    };
    const paidRows = paidStudents.map(student => renderRosterCard(student, false)).join('');
    const unpaidRows = unpaidStudents.map(student => renderRosterCard(student, true)).join('');
    const emptyRosterHtml = '<div class="edu-course-lessons-empty"><strong>尚未安排學員</strong><span>職員可在課堂編輯中指定本堂學員。</span></div>';
    const renderRosterSection = (title, list, rows, key, emptyHtml = '') => {
      if (!rows && !emptyHtml) return '';
      return '<div class="edu-course-roster-section edu-course-roster-section-' + escapeHTML(key) + '">'
        + '<div class="edu-course-roster-section-head"><strong>' + escapeHTML(title) + '</strong><span>' + list.length + ' 位</span></div>'
        + '<div class="edu-course-roster-list">' + (rows || emptyHtml) + '</div>'
        + '</div>';
    };
    const rosterListHtml = shouldSplitUnpaid
      ? renderRosterSection('本堂名單', paidStudents, paidRows, 'main', students.length ? '' : emptyRosterHtml)
        + renderRosterSection('未繳費區', unpaidStudents, unpaidRows, 'unpaid')
      : '<div class="edu-course-roster-list">' + (paidRows || emptyRosterHtml) + '</div>';
    const refreshPendingHtml = context.refreshPending === true && context.refreshError !== true
      ? '<div class="edu-course-roster-refresh-status" role="status" aria-live="polite"><span class="edu-inline-spinner" aria-hidden="true"></span><span>&#27491;&#22312;&#26356;&#26032;&#31805;&#21040;&#33287;&#20633;&#35387;...</span></div>'
      : '';
    const refreshErrorHtml = context.refreshError === true
      ? '<div class="edu-course-roster-refresh-alert"><span>&#36039;&#26009;&#26283;&#26178;&#28961;&#27861;&#26356;&#26032;&#65292;&#24050;&#20445;&#30041;&#19978;&#27425;&#21517;&#21934;</span><button type="button" class="outline-btn small" onclick="App.showCourseLessonRoster(\'' + jsTeamId + '\',\'' + jsPlanId + '\',\'' + this._eduCourseLessonsJsArg(context.sessionId) + '\',{forceRefresh:true})">&#37325;&#35430;</button></div>'
      : '';
    const staffActions = context.isStaff && !staleCached
      ? (manageMode
        ? '<div class="edu-course-roster-head-actions"><button type="button" class="outline-btn small" onclick="App.cancelCourseLessonRosterManage()">取消</button><button type="button" class="primary-btn small" onclick="return App.saveCourseLessonRosterManage(this)">完成</button></div>'
        : '<button type="button" class="primary-btn small" onclick="App.startCourseLessonRosterManage()">管理名單</button>')
      : '';
    const notesEditMode = context.isStaff === true && context.notesEditMode === true;
    const notesValue = notesEditMode ? String(context.draftSessionNotes || session.notes || '') : String(session.notes || '');
    const courseNotesHtml = notesEditMode
      ? '<section class="edu-course-roster-notes edu-course-roster-notes-editing">'
          + '<div class="edu-course-roster-notes-head"><strong>課堂備註</strong><div class="edu-course-roster-head-actions"><button type="button" class="outline-btn small" onclick="App.cancelCourseLessonNotesEdit()">取消</button><button type="button" class="primary-btn small" onclick="return App.saveCourseLessonNotes(this)">完成</button></div></div>'
          + '<textarea id="edu-course-roster-notes-input" maxlength="500" rows="4">' + escapeHTML(notesValue) + '</textarea>'
        + '</section>'
      : '<section class="edu-course-roster-notes">'
          + '<div class="edu-course-roster-notes-head"><strong>課堂備註</strong>' + (context.isStaff && !staleCached ? '<button type="button" class="outline-btn small" onclick="App.startCourseLessonNotesEdit()">編輯</button>' : '') + '</div>'
          + '<p>' + escapeHTML(notesValue || '尚未填寫課堂備註。') + '</p>'
        + '</section>';
    return '<div class="edu-course-roster-shell">'
      + '<section class="edu-course-roster-head">'
        + (backDisabled
          ? '<button type="button" class="outline-btn small" disabled>返回課堂</button>'
          : '<button type="button" class="outline-btn small" onclick="App.showCourseLessons(\'' + jsTeamId + '\',\'' + jsPlanId + '\')">返回課堂</button>')
        + '<div class="edu-course-roster-title-block">'
          + '<div class="edu-course-roster-title-line">'
            + '<span class="edu-course-lesson-status edu-course-lesson-status-' + escapeHTML(status.cls) + '">' + escapeHTML(status.label) + '</span>'
            + '<h3>' + escapeHTML(session.title || '課堂名單') + '</h3>'
            + '<p>' + escapeHTML(this._formatCourseLessonDateTime(session)) + '</p>'
          + '</div>'
        + '</div>'
        + staffActions
      + '</section>'
      + '<section class="edu-course-roster-list-panel">'
        + refreshPendingHtml
        + refreshErrorHtml
        + '<div class="edu-course-lessons-section-title"><strong>本堂名單</strong><span>' + students.length + ' 位</span></div>'
        + rosterListHtml
      + '</section>'
      + courseNotesHtml
      + '</div>';
  },
});
