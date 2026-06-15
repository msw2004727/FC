/* ================================================
   SportHub — Education: Course Enrollment Render
   ================================================
   名單頁渲染：待審核 / 已通過名單卡片、繳費、備註
   ================================================ */

Object.assign(App, {

  _eduCourseEnrollmentRequestSeq: 0,

  // ══════════════════════════════════
  //  名單頁
  // ══════════════════════════════════

  async showCourseEnrollmentList(teamId, planId) {
    const requestSeq = ++this._eduCourseEnrollmentRequestSeq;
    this._ceTeamId = teamId;
    this._cePlanId = planId;
    // Fix 3: 立即清空舊名單，避免一瞬間看到其他課程的學員
    const listEl = document.getElementById('edu-ce-list');
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted)">載入中...</div>';
    await this.showPage('page-edu-course-enrollment');
    if (requestSeq !== this._eduCourseEnrollmentRequestSeq || this.currentPage !== 'page-edu-course-enrollment') {
      // v4: 不清空 DOM、保留「載入中」避免空白永停
      if (window._raceDebug || (typeof localStorage !== 'undefined' && localStorage.getItem('_raceLog'))) {
        console.log('[race-skip]', { fn: 'showCourseEnrollmentList', seq: requestSeq, latest: this._eduCourseEnrollmentRequestSeq, currentPage: this.currentPage });
      }
      return { ok: false, reason: 'stale' };
    }

    const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
    const titleEl = document.getElementById('edu-ce-title');
    if (titleEl) titleEl.textContent = plan ? plan.name : '方案名單';

    const subtitleEl = document.getElementById('edu-ce-subtitle');
    if (subtitleEl && plan) {
      this._updateEnrollSubtitle(subtitleEl, plan, teamId, planId);
    }

    const actionEl = document.getElementById('edu-ce-staff-actions');
    const isStaff = this.isEduClubStaff(teamId);
    if (actionEl) actionEl.style.display = isStaff ? '' : 'none';

    await this._renderCourseEnrollmentList(teamId, planId, requestSeq);
    return { ok: true };
  },

  async _renderCourseEnrollmentList(teamId, planId, requestSeq) {
    const container = document.getElementById('edu-ce-list');
    if (!container) return;

    const options = requestSeq && typeof requestSeq === 'object' ? requestSeq : {};
    const seq = typeof requestSeq === 'number' ? requestSeq : options.requestSeq;
    const cacheKey = this._getCourseEnrollCacheKey?.(teamId, planId);
    const cachedEnrollments = cacheKey ? this._courseEnrollCache?.[cacheKey] : null;
    const enrollments = options.useCache && Array.isArray(cachedEnrollments)
      ? cachedEnrollments
      : await this._loadCourseEnrollments(teamId, planId);
    if (seq != null && seq !== this._eduCourseEnrollmentRequestSeq) return;
    const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
    const allStudents = this.getEduStudents(teamId);
    const students = allStudents;
    const isStaff = this.isEduClubStaff(teamId);
    const curUser = ApiService.getCurrentUser();
    const myUid = curUser?.uid || '';

    // 將對應分組的 active 學員自動視為已通過（遷移完成前的相容顯示）
    const enrolledIds = new Set(enrollments.map(e => e.studentId));
    const autoMigrationCompleted = typeof isEduAutoMigrationCompleted === 'function'
      && isEduAutoMigrationCompleted();
    if (!autoMigrationCompleted && plan?.groupId) {
      const groupStudents = allStudents.filter(s =>
        s.enrollStatus === 'active'
        && (s.groupIds || []).includes(plan.groupId)
        && !enrolledIds.has(s.id)
        && (isStaff || s.selfUid === myUid || s.parentUid === myUid)
      );
      groupStudents.forEach(s => {
        enrollments.push({
          id: '_auto_' + s.id, studentId: s.id, studentName: s.name,
          selfUid: s.selfUid, parentUid: s.parentUid, status: 'approved',
          paidAt: null, coachNotes: '', reviewerName: null, reviewedAt: null,
        });
      });
    }

    const pending = enrollments.filter(e => e.status === 'pending');
    const approved = enrollments.filter(e => e.status === 'approved');
    const tracksPayment = typeof this._shouldTrackCoursePlanPayment === 'function'
      ? this._shouldTrackCoursePlanPayment(plan)
      : plan?.perSessionBilling !== true;
    const shouldShowAttendanceStats = isStaff && (typeof this._shouldShowCoursePlanAttendanceStats === 'function'
      ? this._shouldShowCoursePlanAttendanceStats(plan)
      : (plan?.perSessionBilling === true || String(plan?.planType || '').trim() === 'weekly'));
    const approvedUnpaid = tracksPayment ? approved.filter(e => !e.paidAt) : [];
    const approvedPaid = tracksPayment ? approved.filter(e => !!e.paidAt) : [];
    let attendanceStatsByStudentId = null;
    if (shouldShowAttendanceStats && typeof this._buildCourseLessonAttendanceStatsByStudent === 'function') {
      try {
        const [sessions, attendanceRecords] = await Promise.all([
          typeof this._loadCourseSessions === 'function' ? this._loadCourseSessions(teamId, planId) : [],
          (typeof FirebaseService !== 'undefined' && typeof FirebaseService.queryEduAttendance === 'function')
            ? FirebaseService.queryEduAttendance({ teamId, coursePlanId: planId })
            : [],
        ]);
        if (seq != null && seq !== this._eduCourseEnrollmentRequestSeq) return;
        const rosterStudents = approved.map((e) => {
          const studentId = String(e.studentId || '').trim();
          return students.find(s => String(s.id || s._docId || '') === studentId) || {
            id: studentId,
            studentId,
            displayName: e.studentName || '',
            name: e.studentName || '',
          };
        });
        attendanceStatsByStudentId = this._buildCourseLessonAttendanceStatsByStudent(
          sessions,
          enrollments,
          Array.isArray(attendanceRecords) ? attendanceRecords : [],
          rosterStudents
        );
      } catch (err) {
        console.warn('[edu-course-enrollment] attendance stats load failed:', err);
      }
    }
    const approvedCardContext = { attendanceStatsByStudentId };

    let html = '';
    const sectionBaseId = 'edu-ce-section-' + String(teamId || '').replace(/[^A-Za-z0-9_-]/g, '_')
      + '-' + String(planId || '').replace(/[^A-Za-z0-9_-]/g, '_');
    const sectionId = key => sectionBaseId + '-' + key;
    const jsArg = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const renderJumpButton = (key, label, count) => {
      const targetId = sectionId(key);
      return '<button type="button" class="edu-ce-jump-btn edu-ce-jump-btn-' + key + '" data-ce-jump-target="' + escapeHTML(targetId) + '" onclick="event.stopPropagation();App._scrollCourseEnrollmentSection(\'' + jsArg(targetId) + '\')">'
        + '<span>' + escapeHTML(label) + '</span>'
        + '<strong>' + count + '</strong>'
        + '</button>';
    };
    const renderSection = (key, label, count, rowsHtml, emptyText) => {
      return '<section class="edu-ce-section edu-ce-section-' + key + '" id="' + escapeHTML(sectionId(key)) + '">'
        + '<div class="edu-ce-section-label"><span>' + escapeHTML(label) + '</span><strong>' + count + '人</strong></div>'
        + (rowsHtml || '<div class="edu-ce-section-empty">' + escapeHTML(emptyText) + '</div>')
        + '</section>';
    };
    const jumpButtons = [];
    if (isStaff && pending.length) jumpButtons.push(renderJumpButton('pending', '待審核', pending.length));
    if (approved.length) {
      if (!tracksPayment) jumpButtons.push(renderJumpButton('approved', '已通過', approved.length));
      else {
        jumpButtons.push(renderJumpButton('unpaid', '未繳費', approvedUnpaid.length));
        jumpButtons.push(renderJumpButton('paid', '已繳費', approvedPaid.length));
      }
    }
    if (jumpButtons.length > 1) {
      html += '<div class="edu-ce-jump-nav" aria-label="名單快速定位">' + jumpButtons.join('') + '</div>';
    }

    // 待審核區塊
    if (isStaff && pending.length) {
      const pendingRows = pending.map(e => {
        const stu = students.find(s => s.id === e.studentId);
        const age = stu && stu.birthday ? this.calcAge(stu.birthday) : null;
        const gender = stu?.gender === 'male' ? '♂' : stu?.gender === 'female' ? '♀' : '';
        return '<div class="edu-ce-card edu-ce-card-pending">'
          + '<div class="edu-ce-card-top">'
          + '<span class="edu-ce-name">' + escapeHTML(e.studentName) + '</span>'
          + '<span class="edu-ce-meta">' + gender + (age != null ? ' ' + age + '歲' : '') + '</span>'
          + '</div>'
          + '<div class="edu-ce-card-actions">'
          + '<button class="edu-approve-btn" onclick="App._approveCourseEnrollment(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\',this)">同意</button>'
          + '<button class="edu-reject-btn" onclick="App._rejectCourseEnrollment(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\',this)">拒絕</button>'
          + '</div></div>';
      }).join('');
      html += renderSection('pending', '待審核', pending.length, pendingRows, '目前沒有待審核學員');
    }

    // 已通過區塊：整期收費依繳費狀態分區；隨堂收費只保留名單與備註。
    if (approved.length) {
      if (!tracksPayment) {
        const approvedRows = approved
          .map(e => this._renderApprovedEnrollmentCard(e, plan, students, teamId, planId, isStaff, approvedCardContext))
          .join('');
        html += renderSection('approved', '已通過', approved.length, approvedRows, '目前沒有已通過學員');
      } else {
        const unpaidRows = approvedUnpaid
          .map(e => this._renderApprovedEnrollmentCard(e, plan, students, teamId, planId, isStaff, approvedCardContext))
          .join('');
        const paidRows = approvedPaid
          .map(e => this._renderApprovedEnrollmentCard(e, plan, students, teamId, planId, isStaff, approvedCardContext))
          .join('');
        html += renderSection('unpaid', '已通過・未繳費', approvedUnpaid.length, unpaidRows, '目前沒有未繳費學員');
        html += renderSection('paid', '已通過・已繳費', approvedPaid.length, paidRows, '目前沒有已繳費學員');
      }
    }

    if (!pending.length && !approved.length) {
      html = '<div class="edu-empty-state">尚無報名學員</div>';
    }

    container.innerHTML = html;

    // 即時更新 subtitle 人數
    var stEl = document.getElementById('edu-ce-subtitle');
    if (stEl && plan) this._updateEnrollSubtitle(stEl, plan, teamId, planId);
  },

  _scrollCourseEnrollmentSection(sectionId) {
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    target.classList?.add?.('edu-ce-section-focus');
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      window.setTimeout(() => target.classList?.remove?.('edu-ce-section-focus'), 1000);
    }
  },

  _updateEnrollSubtitle(el, plan, teamId, planId) {
    // 計算實際人數：approved enrollments + 分組內 active 學員（不重複）
    var key = this._getCourseEnrollCacheKey(teamId, planId);
    var enrollments = this._courseEnrollCache[key] || [];
    var students = this.getEduStudents(teamId);
    var summaryCount = Number(this._courseEnrollSummaryCache?.[key]?.effectiveApprovedCount);
    var ids = new Set(enrollments.filter(function (e) { return e.status === 'approved'; }).map(function (e) { return e.studentId; }));
    if (!Number.isFinite(summaryCount) && plan.groupId) {
      students.filter(function (s) { return s.enrollStatus === 'active' && (s.groupIds || []).includes(plan.groupId); })
        .forEach(function (s) { ids.add(s.id); });
    }
    var parts = [];
    parts.push(plan.planType === 'session' ? '堂數制 ' + (plan.totalSessions || 0) + '堂' : '固定週期');
    if (plan.price) parts.push('$' + plan.price.toLocaleString());
    parts.push((Number.isFinite(summaryCount) ? summaryCount : ids.size) + (plan.maxCapacity ? '/' + plan.maxCapacity : '') + ' 人');
    el.textContent = parts.join(' ｜ ');
  },

  _renderApprovedEnrollmentCard(e, plan, students, teamId, planId, isStaff, options = {}) {
    const stu = students.find(s => s.id === e.studentId);
    const age = stu && stu.birthday ? this.calcAge(stu.birthday) : null;
    const gender = stu?.gender === 'male' ? '♂' : stu?.gender === 'female' ? '♀' : '';
    const groupNames = (stu?.groupNames || []).join('、') || '未分組';
    const ageText = age != null ? age + '歲' : '';
    const metaText = [gender, ageText, groupNames].filter(Boolean).join(' ');
    // 繳費狀態（隨堂收費方案不追蹤整期繳費）
    var paidHtml = '';
    const tracksPayment = typeof this._shouldTrackCoursePlanPayment === 'function'
      ? this._shouldTrackCoursePlanPayment(plan)
      : plan?.perSessionBilling !== true;
    if (!tracksPayment) {
      paidHtml = '';
    } else if (e.paidAt) {
      paidHtml = '<span class="edu-ce-paid-label" onclick="event.stopPropagation()">'
        + '<span class="edu-ce-paid-yes">已繳費 ' + escapeHTML(e.paidAt) + '</span>'
        + (isStaff ? ' <button type="button" class="edu-ce-paid-edit" onclick="event.stopPropagation();App._showPaidEditMenu(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\')">設定</button>' : '')
        + '</span>';
    } else if (isStaff) {
      paidHtml = '<label class="edu-ce-paid-label" onclick="event.stopPropagation()">'
        + '<input type="checkbox" onchange="App._toggleEnrollPaid(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\')">'
        + '<span class="edu-ce-paid-no">※繳費打勾</span>'
        + '</label>';
    } else {
      paidHtml = '<span class="edu-ce-paid-label"><span class="edu-ce-paid-no">※繳費打勾</span></span>';
    }

    const safeEnrollId = String(e.id || '').replace(/[^A-Za-z0-9_-]/g, '_');
    const notesId = 'ce-notes-' + safeEnrollId;
    const notePanelId = 'ce-note-panel-' + safeEnrollId;
    const noteTriggerId = 'ce-note-trigger-' + safeEnrollId;
    const notesValue = String(e.coachNotes || '').trim().slice(0, 30);
    const noteActionLabel = notesValue ? '編輯備註' : '新增備註';
    const noteIconSvg = '<svg class="edu-ce-note-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
      + '<path d="M7 3.75h9.25A2.75 2.75 0 0 1 19 6.5v12.25a1.5 1.5 0 0 1-1.5 1.5H7A2.75 2.75 0 0 1 4.25 17.5v-11A2.75 2.75 0 0 1 7 3.75Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'
      + '<path d="M7.25 3.9v16.2M10 8h5.5M10 11.5h5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
      + '</svg>';
    const removeHtml = isStaff
      ? '<button type="button" class="edu-ce-remove-approved-btn" title="刪除學員" aria-label="刪除學員" onclick="event.stopPropagation();App._removeApprovedCourseEnrollment(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\',this)">×</button>'
      : '';
    const stats = options.attendanceStatsByStudentId?.[String(e.studentId || '').trim()] || null;
    const statsHtml = stats
      ? '<span class="edu-ce-attendance-stat">簽到 ' + escapeHTML(stats.signed || 0) + '/' + escapeHTML(stats.total || 0) + ' · 出席率 ' + escapeHTML(stats.rate == null ? '--' : stats.rate + '%') + '</span>'
      : '';
    const noteActionsHtml = isStaff ? '<div class="edu-ce-note-actions" onclick="event.stopPropagation()">'
      + '<button type="button" id="' + noteTriggerId + '" class="edu-ce-note-trigger' + (notesValue ? ' has-note' : '') + '" title="' + noteActionLabel + '" aria-label="' + noteActionLabel + '" aria-expanded="false" onclick="App._toggleEnrollNoteEditor(\'' + notePanelId + '\',\'' + noteTriggerId + '\')">'
      + noteIconSvg
      + '</button>'
      + removeHtml
      + '</div>' : '';
    const noteEditorHtml = isStaff ? '<div class="edu-ce-note-editor" id="' + notePanelId + '" style="display:none" onclick="event.stopPropagation()">'
      + '<input class="edu-ce-note-input" id="' + notesId + '" maxlength="30" value="' + escapeHTML(notesValue) + '" data-original="' + escapeHTML(notesValue) + '" placeholder="備註30字內">'
      + '<div class="edu-ce-note-editor-actions">'
      + '<button type="button" class="primary-btn small" onclick="App._saveEnrollNotes(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\',\'' + notesId + '\')">儲存</button>'
      + '<button type="button" class="outline-btn small" onclick="App._cancelEnrollNotes(\'' + notePanelId + '\',\'' + noteTriggerId + '\')">取消</button>'
      + '</div>'
      + '</div>' : '';
    const noteRowHtml = notesValue
      ? '<div class="edu-ce-note-row"><span>備註</span><p>' + escapeHTML(notesValue) + '</p></div>'
      : '';

    return '<div class="edu-ce-card edu-ce-card-approved">'
      + '<div class="edu-ce-card-top">'
      + '<span class="edu-ce-name">' + escapeHTML(e.studentName) + '</span>'
      + '<span class="edu-ce-meta">' + escapeHTML(metaText) + '</span>'
      + '</div>'
      + '<div class="edu-ce-card-mid">'
      + paidHtml
      + statsHtml
      + noteActionsHtml
      + '</div>'
      + noteEditorHtml
      + noteRowHtml
      + '</div>';
  },

});
