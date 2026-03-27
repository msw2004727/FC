/* ================================================
   SportHub — Education: Course Enrollment
   ================================================
   方案報名、審核、繳費記錄、備註、出勤顯示
   ================================================ */

Object.assign(App, {

  _courseEnrollCache: {},  // { 'teamId:planId': [...] }

  _getCourseEnrollCacheKey(teamId, planId) {
    return teamId + ':' + planId;
  },

  async _loadCourseEnrollments(teamId, planId) {
    const key = this._getCourseEnrollCacheKey(teamId, planId);
    try {
      const list = await FirebaseService.listCourseEnrollments(teamId, planId);
      this._courseEnrollCache[key] = list;
      return list;
    } catch (err) {
      console.error('[edu-enrollment] load failed:', err);
      return this._courseEnrollCache[key] || [];
    }
  },

  // ══════════════════════════════════
  //  學員報名方案
  // ══════════════════════════════════

  async applyCourseEnrollment(teamId, planId) {
    const plans = this.getEduCoursePlans(teamId);
    const plan = plans.find(p => p.id === planId);
    if (!plan) { this.showToast('找不到方案'); return; }

    const priceText = plan.price ? '費用：$' + plan.price.toLocaleString() : '免費';
    const typeText = plan.planType === 'session' ? plan.totalSessions + ' 堂' : '固定週期';
    if (!(await this.appConfirm(
      '確定報名「' + plan.name + '」？\n' + typeText + ' ｜ ' + priceText
    ))) return;

    const curUser = ApiService.getCurrentUser();
    if (!curUser) { this.showToast('請先登入'); return; }

    const _btnState = this._setEduBtnLoading('[onclick*="applyCourseEnrollment"]');
    try {
      // 若非俱樂部成員，自動建立學員資料
      let students = this.getEduStudents(teamId);
      let myStudent = students.find(s => s.selfUid === curUser.uid && s.enrollStatus !== 'inactive');
      if (!myStudent) {
        const stuData = {
          id: this._generateEduId('stu'),
          name: curUser.displayName || curUser.name || '',
          birthday: curUser.birthday || null,
          gender: curUser.gender === '男' ? 'male' : curUser.gender === '女' ? 'female' : 'male',
          enrollStatus: 'pending',
          selfUid: curUser.uid,
          parentUid: null,
          groupIds: [],
          groupNames: [],
          enrolledAt: new Date().toISOString(),
        };
        myStudent = await FirebaseService.createEduStudent(teamId, stuData);
        const cached = this._eduStudentsCache[teamId];
        if (cached) cached.push(myStudent);
        else this._eduStudentsCache[teamId] = [myStudent];
      }

      // 建立報名紀錄
      const enrollment = {
        id: this._generateEduId('enr'),
        studentId: myStudent.id,
        studentName: myStudent.name,
        selfUid: curUser.uid,
        parentUid: null,
        status: 'pending',
        paidAt: null,
        coachNotes: '',
        reviewerName: null,
        reviewedAt: null,
      };
      await FirebaseService.createCourseEnrollment(teamId, planId, enrollment);

      this.showToast('報名已送出，請等待審核');
      await this.renderEduCoursePlanList(teamId);
    } catch (err) {
      console.error('[applyCourseEnrollment]', err);
      this.showToast('報名失敗：' + (err.message || '請稍後再試'));
    } finally {
      _btnState.restore();
    }
  },

  // ══════════════════════════════════
  //  名單頁
  // ══════════════════════════════════

  async showCourseEnrollmentList(teamId, planId) {
    this._ceTeamId = teamId;
    this._cePlanId = planId;
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
    const students = this.getEduStudents(teamId);
    const isStaff = this.isEduClubStaff(teamId);

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

    // 繳費狀態
    const paidHtml = e.paidAt
      ? '<span class="edu-ce-paid edu-ce-paid-yes" onclick="event.stopPropagation();App._editEnrollPaidDate(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\')">✅已繳費 ' + escapeHTML(e.paidAt) + '</span>'
      : '<span class="edu-ce-paid edu-ce-paid-no" onclick="event.stopPropagation();App._markEnrollPaid(\'' + teamId + '\',\'' + planId + '\',\'' + e.id + '\')">⬜未繳費</span>';

    // 備註區
    const notesId = 'ce-notes-' + e.id;
    const expandId = 'ce-expand-' + e.id;

    return '<div class="edu-ce-card" onclick="App._toggleEnrollExpand(\'' + expandId + '\')">'
      + '<div class="edu-ce-card-top">'
      + '<span class="edu-ce-name">' + escapeHTML(e.studentName) + '</span>'
      + '<span class="edu-ce-meta">' + gender + (age != null ? ' ' + age + '歲' : '') + '  ' + escapeHTML(groupNames) + '</span>'
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

  _toggleEnrollExpand(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
  },

  // ══════════════════════════════════
  //  審核、繳費、備註操作
  // ══════════════════════════════════

  async _approveCourseEnrollment(teamId, planId, enrollId, btnEl) {
    const _b = this._setEduBtnLoading(btnEl);
    try {
      const curUser = ApiService.getCurrentUser();
      await FirebaseService.updateCourseEnrollment(teamId, planId, enrollId, {
        status: 'approved',
        reviewerName: curUser?.displayName || curUser?.name || '',
        reviewedAt: new Date().toISOString(),
      });
      // 更新方案 currentCount
      const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
      if (plan) {
        plan.currentCount = (plan.currentCount || 0) + 1;
        FirebaseService.updateEduCoursePlan(teamId, planId, { currentCount: plan.currentCount }).catch(() => {});
      }
      // 學員狀態也更新為 active
      const key = this._getCourseEnrollCacheKey(teamId, planId);
      const enrollments = this._courseEnrollCache[key] || [];
      const enr = enrollments.find(e => e.id === enrollId);
      if (enr) {
        const stu = this.getEduStudents(teamId).find(s => s.id === enr.studentId);
        if (stu && stu.enrollStatus === 'pending') {
          stu.enrollStatus = 'active';
          FirebaseService.updateEduStudent(teamId, enr.studentId, { enrollStatus: 'active' }).catch(() => {});
        }
      }
      this.showToast('已通過');
      await this._renderCourseEnrollmentList(teamId, planId);
    } finally { _b.restore(); }
  },

  async _rejectCourseEnrollment(teamId, planId, enrollId, btnEl) {
    if (!(await this.appConfirm('確定拒絕此學員的報名？'))) return;
    const _b = this._setEduBtnLoading(btnEl);
    try {
      const curUser = ApiService.getCurrentUser();
      await FirebaseService.updateCourseEnrollment(teamId, planId, enrollId, {
        status: 'rejected',
        reviewerName: curUser?.displayName || curUser?.name || '',
        reviewedAt: new Date().toISOString(),
      });
      this.showToast('已拒絕');
      await this._renderCourseEnrollmentList(teamId, planId);
    } finally { _b.restore(); }
  },

  async _markEnrollPaid(teamId, planId, enrollId) {
    const today = new Date().toISOString().slice(0, 10);
    await FirebaseService.updateCourseEnrollment(teamId, planId, enrollId, { paidAt: today });
    const key = this._getCourseEnrollCacheKey(teamId, planId);
    const enr = (this._courseEnrollCache[key] || []).find(e => e.id === enrollId);
    if (enr) enr.paidAt = today;
    await this._renderCourseEnrollmentList(teamId, planId);
    this.showToast('已標記繳費');
  },

  async _editEnrollPaidDate(teamId, planId, enrollId) {
    const newDate = prompt('修改繳費日期（YYYY-MM-DD）：');
    if (!newDate) return;
    await FirebaseService.updateCourseEnrollment(teamId, planId, enrollId, { paidAt: newDate });
    const key = this._getCourseEnrollCacheKey(teamId, planId);
    const enr = (this._courseEnrollCache[key] || []).find(e => e.id === enrollId);
    if (enr) enr.paidAt = newDate;
    await this._renderCourseEnrollmentList(teamId, planId);
    this.showToast('繳費日期已更新');
  },

  async _saveEnrollNotes(teamId, planId, enrollId, textareaId) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return;
    const notes = textarea.value.trim();
    await FirebaseService.updateCourseEnrollment(teamId, planId, enrollId, { coachNotes: notes });
    const key = this._getCourseEnrollCacheKey(teamId, planId);
    const enr = (this._courseEnrollCache[key] || []).find(e => e.id === enrollId);
    if (enr) enr.coachNotes = notes;
    this.showToast('備註已儲存');
  },
});
