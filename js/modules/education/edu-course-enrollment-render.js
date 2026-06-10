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

    let html = '';

    // 待審核區塊
    if (isStaff && pending.length) {
      html += '<div class="edu-ce-section-label">⏳ 待審核（' + pending.length + '人）</div>';
      html += pending.map(e => {
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
    }

    // 已通過區塊
    if (approved.length) {
      html += '<div class="edu-ce-section-label">✅ 已通過（' + approved.length + '人）</div>';
      html += approved.map(e => this._renderApprovedEnrollmentCard(e, plan, students, teamId, planId, isStaff)).join('');
    }

    if (!pending.length && !approved.length) {
      html = '<div class="edu-empty-state">尚無報名學員</div>';
    }

    container.innerHTML = html;

    // 即時更新 subtitle 人數
    var stEl = document.getElementById('edu-ce-subtitle');
    if (stEl && plan) this._updateEnrollSubtitle(stEl, plan, teamId, planId);
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

  _renderApprovedEnrollmentCard(e, plan, students, teamId, planId, isStaff) {
    const stu = students.find(s => s.id === e.studentId);
    const age = stu && stu.birthday ? this.calcAge(stu.birthday) : null;
    const gender = stu?.gender === 'male' ? '♂' : stu?.gender === 'female' ? '♀' : '';
    const groupNames = (stu?.groupNames || []).join('、') || '未分組';
    // 報名日期（右上角）— 處理 Firestore Timestamp / ISO string / Date
    const enrollDateRaw = e.appliedAt || e.reviewedAt || '';
    let enrollDate = '';
    if (enrollDateRaw) {
      if (typeof enrollDateRaw === 'string') enrollDate = enrollDateRaw.slice(0, 10);
      else if (enrollDateRaw.toDate) enrollDate = enrollDateRaw.toDate().toISOString().slice(0, 10);
      else if (enrollDateRaw.seconds) enrollDate = new Date(enrollDateRaw.seconds * 1000).toISOString().slice(0, 10);
    }

    // 繳費狀態（待繳費顯示勾選框；已繳費只顯示文字 + ✏️ 可改日期或取消）
    var paidHtml = '';
    if (e.paidAt) {
      paidHtml = '<span class="edu-ce-paid-label" onclick="event.stopPropagation()">'
        + '<span class="edu-ce-paid-yes">已繳費 ' + escapeHTML(e.paidAt) + '</span>'
        + (isStaff ? ' <span class="edu-ce-paid-edit" onclick="event.stopPropagation();App._showPaidEditMenu(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\')">✏️</span>' : '')
        + '</span>';
    } else if (isStaff) {
      paidHtml = '<label class="edu-ce-paid-label" onclick="event.stopPropagation()">'
        + '<input type="checkbox" onchange="App._toggleEnrollPaid(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\')">'
        + '<span class="edu-ce-paid-no">※繳費打勾</span>'
        + '</label>';
    } else {
      paidHtml = '<span class="edu-ce-paid-label"><span class="edu-ce-paid-no">※繳費打勾</span></span>';
    }

    const notesId = 'ce-notes-' + e.id;
    const notePanelId = 'ce-note-panel-' + e.id;
    const noteTriggerId = 'ce-note-trigger-' + e.id;
    const notesValue = String(e.coachNotes || '').trim().slice(0, 15);
    const noteHtml = isStaff ? '<div class="edu-ce-note-side" onclick="event.stopPropagation()">'
      + '<button type="button" id="' + noteTriggerId + '" class="edu-ce-note-trigger' + (notesValue ? ' has-note' : '') + '" onclick="App._toggleEnrollNoteEditor(\'' + notePanelId + '\',\'' + noteTriggerId + '\')">'
      + '<span class="edu-ce-note-title">備註</span>'
      + '<span class="edu-ce-note-preview">' + escapeHTML(notesValue || '點選填寫') + '</span>'
      + '</button>'
      + '<div class="edu-ce-note-editor" id="' + notePanelId + '" style="display:none">'
      + '<input class="edu-ce-note-input" id="' + notesId + '" maxlength="15" value="' + escapeHTML(notesValue) + '" placeholder="15字內">'
      + '<button type="button" class="primary-btn small" onclick="App._saveEnrollNotes(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\',\'' + notesId + '\')">儲存</button>'
      + '</div>'
      + '</div>' : '';

    return '<div class="edu-ce-card edu-ce-card-approved">'
      + '<div class="edu-ce-card-top">'
      + '<span class="edu-ce-name">' + escapeHTML(e.studentName) + '</span>'
      + '<span class="edu-ce-meta">' + gender + (age != null ? ' ' + age + '歲' : '') + '  ' + escapeHTML(groupNames) + '</span>'
      + (enrollDate ? '<span class="edu-ce-date">' + enrollDate + '</span>' : '')
      + '</div>'
      + '<div class="edu-ce-card-mid">'
      + paidHtml
      + noteHtml
      + '</div>'
      + '</div>';
  },

});
