/* ================================================
   SportHub — Education: Course Enrollment
   ================================================
   方案報名、審核、繳費記錄、備註
   名單頁渲染 → edu-course-enrollment-render.js
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
    // 虛擬記錄（分組自動導入）→ 先建立真實 enrollment 文件
    if (String(enrollId).startsWith('_auto_')) {
      const realId = this._generateEduId('enr');
      const doc = { id: realId, studentId: enr.studentId, studentName: enr.studentName,
        selfUid: enr.selfUid || null, parentUid: enr.parentUid || null,
        status: 'approved', paidAt: null, coachNotes: '', reviewerName: null, reviewedAt: null };
      await FirebaseService.createCourseEnrollment(teamId, planId, doc);
      enr.id = realId;
      enrollId = realId;
    }
    if (enr.paidAt) {
      enr.paidAt = null;
      await FirebaseService.updateCourseEnrollment(teamId, planId, enrollId, { paidAt: null });
      this.showToast('已取消繳費標記');
    } else {
      const today = new Date().toISOString().slice(0, 10);
      enr.paidAt = today;
      await FirebaseService.updateCourseEnrollment(teamId, planId, enrollId, { paidAt: today });
      this.showToast('已標記繳費');
    }
    await this._renderCourseEnrollmentList(teamId, planId);
  },

  _showPaidEditMenu(teamId, planId, enrollId) {
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog" style="max-width:260px"><div class="edu-info-dialog-title">繳費管理</div>'
      + '<div style="display:flex;flex-direction:column;gap:.5rem">'
      + '<button class="primary-btn" id="_paidMenuDate">修改繳費日期</button>'
      + '<button class="outline-btn" style="color:var(--danger);border-color:var(--danger)" id="_paidMenuCancel">取消繳費</button>'
      + '<button class="outline-btn" onclick="this.closest(\'.edu-info-overlay\').remove()">關閉</button></div></div>';
    document.body.appendChild(overlay);
    document.getElementById('_paidMenuDate').onclick = () => { overlay.remove(); this._editEnrollPaidDate(teamId, planId, enrollId); };
    document.getElementById('_paidMenuCancel').onclick = async () => { overlay.remove(); await this._toggleEnrollPaid(teamId, planId, enrollId); };
  },

  async _editEnrollPaidDate(teamId, planId, enrollId) {
    const key = this._getCourseEnrollCacheKey(teamId, planId);
    const enr = (this._courseEnrollCache[key] || []).find(e => e.id === enrollId);
    if (enr && String(enrollId).startsWith('_auto_')) {
      const realId = this._generateEduId('enr');
      const doc = { id: realId, studentId: enr.studentId, studentName: enr.studentName,
        selfUid: enr.selfUid || null, parentUid: enr.parentUid || null,
        status: 'approved', paidAt: null, coachNotes: '', reviewerName: null, reviewedAt: null };
      await FirebaseService.createCourseEnrollment(teamId, planId, doc);
      enr.id = realId; enrollId = realId;
    }
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
    const key = this._getCourseEnrollCacheKey(teamId, planId);
    const enr = (this._courseEnrollCache[key] || []).find(e => e.id === enrollId);
    if (enr && String(enrollId).startsWith('_auto_')) {
      const realId = this._generateEduId('enr');
      const doc = { id: realId, studentId: enr.studentId, studentName: enr.studentName,
        selfUid: enr.selfUid || null, parentUid: enr.parentUid || null,
        status: 'approved', paidAt: null, coachNotes: '', reviewerName: null, reviewedAt: null };
      await FirebaseService.createCourseEnrollment(teamId, planId, doc);
      enr.id = realId; enrollId = realId;
    }
    const notes = textarea.value.trim();
    await FirebaseService.updateCourseEnrollment(teamId, planId, enrollId, { coachNotes: notes });
    if (enr) enr.coachNotes = notes;
    this.showToast('備註已儲存');
  },
});
