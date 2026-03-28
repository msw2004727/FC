/* ================================================
   SportHub — Education: Course Enrollment Render
   ================================================
   名單頁渲染：待審核 / 已通過名單卡片、出勤、繳費
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  名單頁
  // ══════════════════════════════════

  async showCourseEnrollmentList(teamId, planId) {
    this._ceTeamId = teamId;
    this._cePlanId = planId;
    // Fix 3: 立即清空舊名單，避免一瞬間看到其他課程的學員
    const listEl = document.getElementById('edu-ce-list');
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted)">載入中...</div>';
    await this.showPage('page-edu-course-enrollment');

    const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
    const titleEl = document.getElementById('edu-ce-title');
    if (titleEl) titleEl.textContent = plan ? plan.name : '方案名單';

    const subtitleEl = document.getElementById('edu-ce-subtitle');
    if (subtitleEl && plan) {
      const parts = [];
      parts.push(plan.planType === 'session' ? '堂數制 ' + (plan.totalSessions || 0) + '堂' : '固定週期');
      if (plan.price) parts.push('$' + plan.price.toLocaleString());
      parts.push((plan.currentCount || 0) + (plan.maxCapacity ? '/' + plan.maxCapacity : '') + ' 人');
      subtitleEl.textContent = parts.join(' ｜ ');
    }

    await this._renderCourseEnrollmentList(teamId, planId);
  },

  async _renderCourseEnrollmentList(teamId, planId) {
    const container = document.getElementById('edu-ce-list');
    if (!container) return;

    const enrollments = await this._loadCourseEnrollments(teamId, planId);
    const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
    const allStudents = this.getEduStudents(teamId);
    const students = allStudents;
    const isStaff = this.isEduClubStaff(teamId);

    // 將對應分組的 active 學員自動視為已通過（即使沒有 enrollment 記錄）
    const enrolledIds = new Set(enrollments.map(e => e.studentId));
    if (plan?.groupId) {
      const groupStudents = allStudents.filter(s =>
        s.enrollStatus === 'active' && (s.groupIds || []).includes(plan.groupId) && !enrolledIds.has(s.id)
      );
      groupStudents.forEach(s => {
        enrollments.push({
          id: '_auto_' + s.id, studentId: s.id, studentName: s.name,
          selfUid: s.selfUid, parentUid: s.parentUid, status: 'approved',
          paidAt: null, coachNotes: '', reviewerName: null, reviewedAt: null,
        });
      });
    }

    // 載入出勤次數（per student）
    this._courseAttendanceCount = {};
    try {
      const attendRecords = await FirebaseService.queryEduAttendance({ teamId, coursePlanId: planId });
      attendRecords.forEach(r => {
        this._courseAttendanceCount[r.studentId] = (this._courseAttendanceCount[r.studentId] || 0) + 1;
      });
    } catch (_) {}

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
      html += approved.map(e => this._renderApprovedEnrollmentCard(e, plan, students, teamId, planId)).join('');
    }

    if (!pending.length && !approved.length) {
      html = '<div class="edu-empty-state">尚無報名學員</div>';
    }

    container.innerHTML = html;
  },

  _renderApprovedEnrollmentCard(e, plan, students, teamId, planId) {
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

    // 出勤計算
    const totalSessions = plan?.totalSessions || 0;
    const attendCount = (this._courseAttendanceCount || {})[e.studentId] || 0;
    let attendHtml = '';
    if (plan?.planType === 'session' && totalSessions) {
      const remaining = Math.max(0, totalSessions - attendCount);
      attendHtml = '<span class="edu-ce-attend">出勤 ' + attendCount + '/' + totalSessions + ' 剩' + remaining + '堂</span>';
    } else {
      attendHtml = '<span class="edu-ce-attend">出勤 ' + attendCount + '次</span>';
    }

    // 繳費狀態（勾選框 + 可編輯日期）
    const paidChecked = e.paidAt ? ' checked' : '';
    const paidDateText = e.paidAt ? ' ' + escapeHTML(e.paidAt) : '';
    const editDateBtn = e.paidAt
      ? ' <span class="edu-ce-paid-edit" onclick="event.stopPropagation();App._editEnrollPaidDate(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\')">✏️</span>'
      : '';
    const paidHtml = '<label class="edu-ce-paid-label" onclick="event.stopPropagation()">'
      + '<input type="checkbox"' + paidChecked + ' onchange="App._toggleEnrollPaid(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\')">'
      + '<span class="' + (e.paidAt ? 'edu-ce-paid-yes' : 'edu-ce-paid-no') + '">已繳費' + paidDateText + '</span>'
      + editDateBtn + '</label>';

    // 備註區
    const notesId = 'ce-notes-' + e.id;
    const expandId = 'ce-expand-' + e.id;

    return '<div class="edu-ce-card" onclick="App._toggleEnrollExpand(\'' + expandId + '\')">'
      + '<div class="edu-ce-card-top">'
      + '<span class="edu-ce-name">' + escapeHTML(e.studentName) + '</span>'
      + '<span class="edu-ce-meta">' + gender + (age != null ? ' ' + age + '歲' : '') + '  ' + escapeHTML(groupNames) + '</span>'
      + (enrollDate ? '<span class="edu-ce-date">' + enrollDate + '</span>' : '')
      + '</div>'
      + '<div class="edu-ce-card-mid">'
      + attendHtml + paidHtml
      + '</div>'
      + '<div class="edu-ce-expand" id="' + expandId + '" style="display:none" onclick="event.stopPropagation()">'
      + '<div class="edu-ce-notes-label">教練備註：</div>'
      + '<textarea class="edu-ce-notes" id="' + notesId + '" rows="2" placeholder="輸入備註...">' + escapeHTML(e.coachNotes || '') + '</textarea>'
      + '<button class="primary-btn small" style="margin-top:.3rem;float:right" onclick="App._saveEnrollNotes(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\',\'' + notesId + '\')">儲存備註</button>'
      + '<div style="clear:both"></div>'
      + '</div></div>';
  },

});
