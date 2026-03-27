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
    const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
    if (!plan) { this.showToast('找不到方案'); return; }
    const curUser = ApiService.getCurrentUser();
    if (!curUser) { this.showToast('請先登入'); return; }

    // 載入該方案的報名紀錄（用於判斷已報名學員）
    const enrollments = await this._loadCourseEnrollments(teamId, planId);

    // 取得用戶名下的學員
    let students = this.getEduStudents(teamId);
    let myStudents = students.filter(s =>
      s.enrollStatus !== 'inactive' && (s.selfUid === curUser.uid || s.parentUid === curUser.uid)
    );

    // 若無學員，自動建立本人
    if (!myStudents.length) {
      const stuData = {
        id: this._generateEduId('stu'),
        name: curUser.displayName || curUser.name || '',
        birthday: curUser.birthday || null,
        gender: curUser.gender === '男' ? 'male' : curUser.gender === '女' ? 'female' : 'male',
        enrollStatus: 'pending', selfUid: curUser.uid, parentUid: null,
        groupIds: [], groupNames: [], enrolledAt: new Date().toISOString(),
      };
      const created = await FirebaseService.createEduStudent(teamId, stuData);
      const cached = this._eduStudentsCache[teamId];
      if (cached) cached.push(created); else this._eduStudentsCache[teamId] = [created];
      myStudents = [created];
    }

    // 標記已報名的學員
    const enrolledMap = {};
    enrollments.forEach(e => {
      if (e.status !== 'rejected') enrolledMap[e.studentId] = e;
    });

    // 顯示學員選擇彈窗
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    // 分成可報名 + 已報名，可報名排前面
    const available = myStudents.filter(s => !enrolledMap[s.id]);
    const enrolled = myStudents.filter(s => enrolledMap[s.id]);
    const renderPickItem = (s) => {
      const age = s.birthday ? this.calcAge(s.birthday) : null;
      const gender = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
      const genderClass = s.gender === 'male' ? ' edu-gender-male' : s.gender === 'female' ? ' edu-gender-female' : '';
      const groupLabel = (s.groupNames || []).join('、') || '未分組';
      const infoLine = '<span class="edu-ce-pick-info">'
        + (gender ? '<span class="edu-student-gender' + genderClass + '">' + gender + '</span> ' : '')
        + (age != null ? age + '歲 ' : '')
        + '<span style="color:var(--text-muted)">' + escapeHTML(groupLabel) + '</span>'
        + '</span>';
      const existing = enrolledMap[s.id];
      if (existing) {
        const rawDate = existing.appliedAt || '';
        let dateStr = '';
        if (rawDate) {
          if (typeof rawDate === 'string') dateStr = rawDate.slice(0, 10);
          else if (rawDate.toDate) dateStr = rawDate.toDate().toISOString().slice(0, 10);
          else if (rawDate.seconds) dateStr = new Date(rawDate.seconds * 1000).toISOString().slice(0, 10);
        }
        return '<label class="edu-ce-pick-item edu-ce-pick-disabled">'
          + '<div class="edu-ce-pick-main"><span class="edu-ce-pick-name">' + escapeHTML(s.name) + '</span>' + infoLine + '</div>'
          + '<span class="edu-ce-pick-hint">已於 ' + dateStr + ' 報名</span>'
          + '<input type="checkbox" disabled></label>';
      }
      return '<label class="edu-ce-pick-item">'
        + '<div class="edu-ce-pick-main"><span class="edu-ce-pick-name">' + escapeHTML(s.name) + '</span>' + infoLine + '</div>'
        + '<input type="checkbox" value="' + s.id + '" data-name="' + escapeHTML(s.name) + '"></label>';
    };
    let listHtml = available.map(renderPickItem).join('') + enrolled.map(renderPickItem).join('');

    const count = myStudents.filter(s => !enrolledMap[s.id]).length;
    const unitPrice = plan.price || 0;
    const totalPrice = unitPrice * count;
    const typeText = plan.planType === 'session' ? '共計 ' + (plan.totalSessions || 0) + ' 堂' : '固定週期';
    const priceLine = unitPrice
      ? '\n費用：$' + unitPrice.toLocaleString() + ' × ' + count + '人 = $' + totalPrice.toLocaleString()
      : '\n費用：免費';

    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">報名「' + escapeHTML(plan.name) + '」</div>'
      + '<div style="font-size:.85rem;color:var(--text-secondary);margin-bottom:.6rem;white-space:pre-wrap">' + typeText + priceLine + '</div>'
      + '<div style="font-size:.82rem;font-weight:600;margin-bottom:.3rem">選擇報名學員：</div>'
      + '<div class="edu-ce-pick-list">' + listHtml + '</div>'
      + '<div style="display:flex;gap:.5rem;margin-top:.8rem">'
      + '<button class="outline-btn" style="flex:1" onclick="this.closest(\'.edu-info-overlay\').remove()">取消</button>'
      + '<button class="primary-btn" style="flex:1" id="_eduEnrollConfirmBtn"' + (count === 0 ? ' disabled style="flex:1;opacity:.5"' : '') + '>確認報名</button>'
      + '</div></div>';
    document.body.appendChild(overlay);

    document.getElementById('_eduEnrollConfirmBtn').onclick = async () => {
      const checks = overlay.querySelectorAll('.edu-ce-pick-list input[type="checkbox"]:checked:not(:disabled)');
      if (!checks.length) { this.showToast('請選擇至少一位學員'); return; }
      overlay.remove();
      const _btnState = this._setEduBtnLoading('[onclick*="applyCourseEnrollment"]');
      try {
        for (const cb of checks) {
          const sid = cb.value;
          const sname = cb.dataset.name || '';
          const enrollment = {
            id: this._generateEduId('enr'), studentId: sid, studentName: sname,
            selfUid: curUser.uid, parentUid: null, status: 'pending',
            paidAt: null, coachNotes: '', reviewerName: null, reviewedAt: null,
          };
          await FirebaseService.createCourseEnrollment(teamId, planId, enrollment);
        }
        this.showToast('報名已送出，請等待審核');
        await this.renderEduCoursePlanList(teamId);
      } catch (err) {
        console.error('[applyCourseEnrollment]', err);
        this.showToast('報名失敗：' + (err.message || '請稍後再試'));
      } finally { _btnState.restore(); }
    };
  },

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

  async _toggleEnrollPaid(teamId, planId, enrollId) {
    const key = this._getCourseEnrollCacheKey(teamId, planId);
    const enr = (this._courseEnrollCache[key] || []).find(e => e.id === enrollId);
    if (!enr) return;
    if (enr.paidAt) {
      // 取消繳費
      enr.paidAt = null;
      await FirebaseService.updateCourseEnrollment(teamId, planId, enrollId, { paidAt: null });
      this.showToast('已取消繳費標記');
    } else {
      // 標記繳費（帶入今天日期）
      const today = new Date().toISOString().slice(0, 10);
      enr.paidAt = today;
      await FirebaseService.updateCourseEnrollment(teamId, planId, enrollId, { paidAt: today });
      this.showToast('已標記繳費');
    }
    await this._renderCourseEnrollmentList(teamId, planId);
  },

  async _editEnrollPaidDate(teamId, planId, enrollId) {
    const key = this._getCourseEnrollCacheKey(teamId, planId);
    const enr = (this._courseEnrollCache[key] || []).find(e => e.id === enrollId);
    const current = enr?.paidAt || new Date().toISOString().slice(0, 10);
    // 用 date input 彈窗取代 prompt
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog" style="max-width:300px">'
      + '<div class="edu-info-dialog-title">編輯繳費日期</div>'
      + '<input type="date" id="_eduPaidDateInput" value="' + current + '" style="width:100%;padding:.5rem;font-size:.9rem;border:1px solid var(--border);border-radius:var(--radius)">'
      + '<div style="display:flex;gap:.5rem;margin-top:.8rem">'
      + '<button class="outline-btn" style="flex:1" onclick="this.closest(\'.edu-info-overlay\').remove()">取消</button>'
      + '<button class="primary-btn" style="flex:1" id="_eduPaidDateSave">儲存</button>'
      + '</div></div>';
    document.body.appendChild(overlay);
    document.getElementById('_eduPaidDateSave').onclick = async () => {
      const newDate = document.getElementById('_eduPaidDateInput').value;
      if (!newDate) return;
      overlay.remove();
      if (enr) enr.paidAt = newDate;
      await FirebaseService.updateCourseEnrollment(teamId, planId, enrollId, { paidAt: newDate });
      await this._renderCourseEnrollmentList(teamId, planId);
      this.showToast('繳費日期已更新');
    };
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
