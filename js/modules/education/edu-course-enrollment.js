/* ================================================
   SportHub — Education: Course Enrollment
   ================================================
   方案報名、審核、繳費記錄、備註
   名單頁渲染 → edu-course-enrollment-render.js
   ================================================ */

Object.assign(App, {

  _courseEnrollCache: {},  // { 'teamId:planId': [...] }
  _courseEnrollSummaryCache: {},

  _getCourseEnrollCacheKey(teamId, planId) {
    return teamId + ':' + planId;
  },

  _isEduAutoEnrollmentMaterializationAllowed() {
    return !(typeof isEduAutoMigrationCompleted === 'function' && isEduAutoMigrationCompleted());
  },

  _showEduAutoMigrationCompletedToast() {
    this.showToast?.('報名資料已完成遷移，請重新整理名單後再操作');
  },

  async _loadCourseEnrollments(teamId, planId) {
    const key = this._getCourseEnrollCacheKey(teamId, planId);
    try {
      const list = await FirebaseService.listCourseEnrollments(teamId, planId);
      this._courseEnrollCache[key] = list;
      this._courseEnrollSummaryCache[key] = list?._summary || null;
      return list;
    } catch (err) {
      console.error('[edu-enrollment] load failed:', err);
      return this._courseEnrollCache[key] || [];
    }
  },

  // ══════════════════════════════════
  //  學員報名方案
  // ══════════════════════════════════

  async _loadCourseEnrollmentSummaries(teamId, planIds) {
    const ids = Array.from(new Set(
      (Array.isArray(planIds) ? planIds : [planIds])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    ));
    if (!ids.length) return {};
    if (typeof FirebaseService.listCourseEnrollmentSummaries !== 'function') return null;
    try {
      const summaries = await FirebaseService.listCourseEnrollmentSummaries(teamId, ids);
      ids.forEach((planId) => {
        const key = this._getCourseEnrollCacheKey(teamId, planId);
        const summary = summaries?.[planId] || null;
        this._courseEnrollSummaryCache[key] = summary;
        const cachedEnrollments = this._courseEnrollCache[key];
        if (Array.isArray(cachedEnrollments)) {
          Object.defineProperty(cachedEnrollments, '_summary', {
            value: summary,
            enumerable: false,
            configurable: true,
          });
        }
      });
      return summaries || {};
    } catch (err) {
      console.warn('[edu-enrollment] summary batch load failed:', err);
      return null;
    }
  },

  _mergeCourseEnrollmentCacheAfterRegister(teamId, planId, createdEnrollments, selectedStudents = [], curUser = null) {
    const key = this._getCourseEnrollCacheKey(teamId, planId);
    this._courseEnrollCache = this._courseEnrollCache || {};
    this._courseEnrollSummaryCache = this._courseEnrollSummaryCache || {};
    const current = Array.isArray(this._courseEnrollCache[key]) ? [...this._courseEnrollCache[key]] : [];
    const studentsById = new Map((Array.isArray(selectedStudents) ? selectedStudents : []).map(student => [
      String(student?.id || student?._docId || '').trim(),
      student,
    ]));
    const nowIso = new Date().toISOString();
    const normalized = (Array.isArray(createdEnrollments) ? createdEnrollments : [])
      .map((enrollment) => {
        const studentId = String(enrollment?.studentId || '').trim();
        if (!studentId) return null;
        const student = studentsById.get(studentId) || {};
        return {
          id: enrollment.id || enrollment._docId || ('_optimistic_' + studentId),
          _docId: enrollment._docId || enrollment.id || ('_optimistic_' + studentId),
          studentId,
          studentName: enrollment.studentName || student.name || student.displayName || '',
          selfUid: enrollment.selfUid || student.selfUid || (student.parentUid ? null : curUser?.uid) || null,
          parentUid: enrollment.parentUid || student.parentUid || null,
          status: enrollment.status || 'pending',
          paidAt: enrollment.paidAt || null,
          coachNotes: enrollment.coachNotes || '',
          reviewerName: enrollment.reviewerName || null,
          reviewedAt: enrollment.reviewedAt || null,
          appliedAt: enrollment.appliedAt || enrollment.appliedAtIso || nowIso,
        };
      })
      .filter(Boolean);
    if (!normalized.length) return current;

    normalized.forEach((item) => {
      const index = current.findIndex(existing => String(existing?.studentId || '') === item.studentId);
      if (index >= 0) current[index] = { ...current[index], ...item };
      else current.push(item);
    });

    const previousSummary = this._courseEnrollSummaryCache[key] || this._courseEnrollCache[key]?._summary || {};
    const viewerStatuses = { ...(previousSummary.viewerStatuses || {}) };
    normalized.forEach((item) => {
      viewerStatuses[item.studentId] = item.status || 'pending';
    });
    const summary = {
      ...previousSummary,
      viewerStatuses,
      viewerStudentIds: Array.from(new Set([
        ...(Array.isArray(previousSummary.viewerStudentIds) ? previousSummary.viewerStudentIds : []),
        ...normalized.map(item => item.studentId),
      ])),
    };
    Object.defineProperty(current, '_summary', {
      value: summary,
      enumerable: false,
      configurable: true,
    });
    this._courseEnrollCache[key] = current;
    this._courseEnrollSummaryCache[key] = summary;
    const plan = (this.getEduCoursePlans?.(teamId) || []).find(item => String(item.id || item._docId || '') === String(planId || ''));
    if (plan) {
      plan._enrollments = current;
      plan._enrollmentSummary = summary;
    }
    return current;
  },

  _isCourseEnrollmentActiveStatus(status) {
    const normalized = String(status || 'approved').trim().toLowerCase();
    return normalized !== 'rejected' && normalized !== 'cancelled' && normalized !== 'canceled' && normalized !== 'removed';
  },

  _mergeCourseEnrollmentCacheAfterCancel(teamId, planId, cancelledStudentIds = []) {
    const ids = new Set((Array.isArray(cancelledStudentIds) ? cancelledStudentIds : [cancelledStudentIds])
      .map(value => String(value || '').trim())
      .filter(Boolean));
    if (!ids.size) return [];
    const key = this._getCourseEnrollCacheKey(teamId, planId);
    this._courseEnrollCache = this._courseEnrollCache || {};
    this._courseEnrollSummaryCache = this._courseEnrollSummaryCache || {};
    const current = Array.isArray(this._courseEnrollCache[key]) ? this._courseEnrollCache[key] : [];
    const next = current.filter((enrollment) => {
      const studentId = String(enrollment?.studentId || '').trim();
      const status = String(enrollment?.status || '').trim().toLowerCase();
      return !(ids.has(studentId) && status === 'pending');
    });
    const previousSummary = this._courseEnrollSummaryCache[key] || current?._summary || {};
    const viewerStatuses = { ...(previousSummary.viewerStatuses || {}) };
    ids.forEach((studentId) => { delete viewerStatuses[studentId]; });
    const summary = {
      ...previousSummary,
      viewerStatuses,
      viewerStudentIds: Array.isArray(previousSummary.viewerStudentIds)
        ? previousSummary.viewerStudentIds
        : [],
    };
    Object.defineProperty(next, '_summary', {
      value: summary,
      enumerable: false,
      configurable: true,
    });
    this._courseEnrollCache[key] = next;
    this._courseEnrollSummaryCache[key] = summary;
    const plan = (this.getEduCoursePlans?.(teamId) || []).find(item => String(item.id || item._docId || '') === String(planId || ''));
    if (plan) {
      plan._enrollments = next;
      plan._enrollmentSummary = summary;
    }
    return next;
  },

  async showCourseEnrollmentPendingCancelDialog(teamId, planId, actionButton) {
    const plan = this.getEduCoursePlans?.(teamId)?.find(p => String(p.id || p._docId || '') === String(planId || ''));
    if (!plan) { this.showToast?.('找不到課程方案'); return; }
    const curUser = ApiService.getCurrentUser();
    if (!curUser) { this.showToast?.('請先登入'); return; }
    const actionState = this._setEduCourseActionLoading(actionButton, '讀取中...');
    if (actionState.active === false) return;
    const sourceOverlay = actionButton?.closest?.('.edu-course-detail-overlay');
    try {
      const enrollments = await this._loadCourseEnrollments(teamId, planId);
      const myStudents = (this.getEduStudents?.(teamId) || []).filter(student =>
        student?.enrollStatus !== 'inactive' && (student?.selfUid === curUser.uid || student?.parentUid === curUser.uid)
      );
      const studentsById = new Map(myStudents.map(student => [
        String(student?.id || student?._docId || '').trim(),
        student,
      ]));
      const pendingItems = (Array.isArray(enrollments) ? enrollments : [])
        .filter(enrollment => String(enrollment?.status || '').trim().toLowerCase() === 'pending')
        .map((enrollment) => {
          const studentId = String(enrollment?.studentId || '').trim();
          const student = studentsById.get(studentId);
          return student ? { enrollment, student, studentId } : null;
        })
        .filter(Boolean);
      if (!pendingItems.length) {
        this.showToast?.('目前沒有審核中的報名');
        await this._refreshCourseViewsAfterEnrollmentChange?.(teamId, planId, { force: true });
        return;
      }

      document.querySelector?.('.edu-course-pending-cancel-overlay')?.remove?.();
      const overlay = document.createElement('div');
      overlay.className = 'edu-info-overlay edu-course-pending-cancel-overlay';
      overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
      const formatDate = (value) => {
        if (!value) return '';
        if (typeof value === 'string') return value.slice(0, 10);
        if (typeof value.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
        if (Number.isFinite(value.seconds)) return new Date(value.seconds * 1000).toISOString().slice(0, 10);
        return '';
      };
      const itemHtml = pendingItems.map(({ enrollment, student, studentId }) => {
        const appliedDate = formatDate(enrollment.appliedAt || enrollment.appliedAtIso || enrollment.createdAt);
        const age = student?.birthday ? this.calcAge?.(student.birthday) : null;
        const ageText = Number.isFinite(age) ? age + '歲' : '';
        const subText = [ageText, appliedDate ? '送出日 ' + appliedDate : '審核中'].filter(Boolean).join(' · ');
        return '<label class="edu-ce-pick-item edu-ce-pending-cancel-item">'
          + '<div class="edu-ce-pick-main"><span class="edu-ce-pick-name">' + escapeHTML(student?.name || enrollment.studentName || '未命名學員') + '</span>'
          + '<span class="edu-ce-pick-info">' + escapeHTML(subText) + '</span></div>'
          + '<input type="checkbox" value="' + escapeHTML(studentId) + '" checked></label>';
      }).join('');
      overlay.innerHTML = '<div class="edu-info-dialog edu-course-pending-cancel-dialog">'
        + '<div class="edu-info-dialog-title">取消審核中報名</div>'
        + '<div class="edu-course-pending-cancel-copy">以下是你名下仍在等待俱樂部審核的學員。勾選後可取消報名，取消後若還要參加需重新送出報名。</div>'
        + '<div class="edu-ce-pick-list">' + itemHtml + '</div>'
        + '<div class="edu-course-pending-cancel-actions">'
        + '<button type="button" class="outline-btn" onclick="this.closest(\'.edu-info-overlay\').remove()">返回</button>'
        + '<button type="button" class="primary-btn danger" id="_eduPendingCancelConfirmBtn">取消報名</button>'
        + '</div>'
        + '</div>';
      document.body.appendChild(overlay);
      const confirmBtn = document.getElementById('_eduPendingCancelConfirmBtn');
      if (!confirmBtn) return;
      confirmBtn.onclick = async () => {
        const checks = overlay.querySelectorAll('.edu-ce-pick-list input[type="checkbox"]:checked');
        const studentIds = Array.from(checks).map(cb => cb.value).filter(Boolean);
        if (!studentIds.length) { this.showToast?.('請先勾選要取消的學員'); return; }
        const ok = typeof this.appConfirm === 'function'
          ? await this.appConfirm('確定要取消 ' + studentIds.length + ' 位學員的審核中報名嗎？取消後如要參加需重新報名。')
          : window.confirm('確定要取消 ' + studentIds.length + ' 位學員的審核中報名嗎？取消後如要參加需重新報名。');
        if (!ok) return;
        const btnState = this._setEduCourseActionLoading(confirmBtn, '取消中...');
        if (btnState.active === false) return;
        try {
          const result = await FirebaseService.cancelCourseEnrollment(teamId, planId, studentIds);
          const cancelledIds = Array.isArray(result?.cancelledStudentIds) ? result.cancelledStudentIds : studentIds;
          this._mergeCourseEnrollmentCacheAfterCancel(teamId, planId, cancelledIds);
          overlay.remove();
          this.showToast?.('已取消審核中的報名');
          if (sourceOverlay?.isConnected) {
            sourceOverlay.remove();
            await this.showEduCoursePlanDetail?.(teamId, planId);
          }
          await this.renderEduCoursePlanList?.(teamId, undefined);
          this._refreshCourseViewsAfterEnrollmentChange?.(teamId, planId, { force: true });
        } catch (err) {
          console.error('[cancelCourseEnrollment]', err);
          this.showToast?.('取消失敗：' + (err.message || '請稍後再試'));
        } finally {
          btnState.restore();
        }
      };
    } finally {
      actionState.restore();
    }
  },

  async _refreshCourseViewsAfterEnrollmentChange(teamId, planId, options = {}) {
    const force = options.force === true;
    try {
      if (force || !options.skipEnrollmentReload) {
        await this._loadCourseEnrollments?.(teamId, planId);
      }
      if (this.currentPage === 'page-edu-course-enrollment'
        && String(this._ceTeamId || '') === String(teamId || '')
        && String(this._cePlanId || '') === String(planId || '')) {
        await this._renderCourseEnrollmentList?.(teamId, planId, { useCache: true });
      }
      await this.renderEduCoursePlanList?.(teamId, undefined, { forceRefresh: !!force });
    } catch (err) {
      console.warn('[edu-enrollment] refresh after change failed:', err);
    }
  },

  async _syncCourseSessionsAfterEnrollmentApproval(teamId, planId) {
    const plan = (this.getEduCoursePlans?.(teamId) || []).find(item => String(item.id || item._docId || '') === String(planId || ''));
    if (!plan || typeof this._ensureCoursePlanSessionsFromPlan !== 'function') return null;
    try {
      return await this._ensureCoursePlanSessionsFromPlan(teamId, plan);
    } catch (err) {
      console.warn('[edu-enrollment] session sync after approval failed:', err);
      return null;
    }
  },

  _setEduCourseActionLoading(actionButton, loadingText) {
    const btn = actionButton && typeof actionButton === 'object' && actionButton.dataset
      ? actionButton
      : null;
    if (!btn) return { active: true, restore() {} };
    if (btn.dataset.eduActionLoading === '1') return { active: false, restore() {} };
    const originalHtml = btn.innerHTML;
    const originalDisabled = btn.disabled;
    const originalAriaBusy = btn.getAttribute?.('aria-busy');
    btn.dataset.eduActionLoading = '1';
    btn.disabled = true;
    btn.setAttribute?.('aria-busy', 'true');
    btn.classList?.add('edu-action-loading');
    btn.innerHTML = '<span class="edu-inline-spinner" aria-hidden="true"></span><span>'
      + escapeHTML(loadingText || '\u8f09\u5165\u4e2d...')
      + '</span>';
    return {
      active: true,
      restore() {
        try {
          if (btn.isConnected === false) return;
          btn.innerHTML = originalHtml;
          btn.disabled = originalDisabled;
          if (originalAriaBusy == null) btn.removeAttribute?.('aria-busy');
          else btn.setAttribute?.('aria-busy', originalAriaBusy);
          btn.classList?.remove('edu-action-loading');
          delete btn.dataset.eduActionLoading;
        } catch (_) { /* noop */ }
      },
    };
  },

  async applyCourseEnrollment(teamId, planId, actionButton) {
    const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
    if (!plan) { this.showToast('找不到方案'); return; }
    const curUser = ApiService.getCurrentUser();
    if (!curUser) { this.showToast('請先登入'); return; }
    const isStaff = !!this.isEduClubStaff?.(teamId);
    if (plan.visibleOnTeamPage === false && !isStaff) {
      this.showToast('此課程尚未公開，暫不開放報名');
      return;
    }

    const actionState = this._setEduCourseActionLoading(actionButton, '\u8f09\u5165\u4e2d...');
    if (actionState.active === false) return;
    const sourceOverlay = actionButton?.closest?.('.edu-course-detail-overlay, .td-v2-course-modal');
    const isSourceOverlayClosed = () => !!(
      sourceOverlay
      && (sourceOverlay.isConnected === false || sourceOverlay.hidden === true || sourceOverlay.getAttribute?.('aria-hidden') === 'true')
    );
    try {
    // 載入該方案的報名紀錄（用於判斷已報名學員）
    const enrollments = await this._loadCourseEnrollments(teamId, planId);
    if (isSourceOverlayClosed()) return;

    // 取得用戶名下的學員
    let students = this.getEduStudents(teamId);
    let myStudents = students.filter(s =>
      s.enrollStatus !== 'inactive' && (s.selfUid === curUser.uid || s.parentUid === curUser.uid)
    );

    // 若無學員，自動建立本人
    if (!myStudents.length) {
      if (isSourceOverlayClosed()) return;
      const stuData = {
        id: this._generateEduId('stu'),
        name: curUser.displayName || curUser.name || '',
        birthday: curUser.birthday || null,
        gender: curUser.gender === '男' ? 'male' : curUser.gender === '女' ? 'female' : 'male',
        enrollStatus: 'pending', selfUid: curUser.uid, parentUid: null,
        groupIds: [], groupNames: [], enrolledAt: new Date().toISOString(),
      };
      const created = await FirebaseService.createEduStudent(teamId, stuData);
      if (isSourceOverlayClosed()) return;
      const cached = this._eduStudentsCache[teamId];
      if (cached) cached.push(created); else this._eduStudentsCache[teamId] = [created];
      myStudents = [created];
    }

    // 標記已報名的學員
    const enrolledMap = {};
    enrollments.forEach(e => {
      if (this._isCourseEnrollmentActiveStatus(e.status)) enrolledMap[e.studentId] = e;
    });
    const autoMigrationCompleted = typeof isEduAutoMigrationCompleted === 'function'
      && isEduAutoMigrationCompleted();
    if (!autoMigrationCompleted && plan.groupId) {
      students
        .filter(s => s.enrollStatus === 'active' && (s.groupIds || []).includes(plan.groupId))
        .forEach(s => {
          enrolledMap[s.id] = enrolledMap[s.id] || { studentId: s.id, status: 'approved', appliedAt: null };
        });
    }

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
    if (isSourceOverlayClosed()) return;
    if (sourceOverlay?.classList?.contains('edu-course-detail-overlay')) {
      sourceOverlay.remove();
    } else if (sourceOverlay?.classList?.contains('td-v2-course-modal')) {
      this.closeTeamDetailV2CourseModal?.();
    }
    document.body.appendChild(overlay);

    document.getElementById('_eduEnrollConfirmBtn').onclick = async () => {
      const checks = overlay.querySelectorAll('.edu-ce-pick-list input[type="checkbox"]:checked:not(:disabled)');
      if (!checks.length) { this.showToast('請選擇至少一位學員'); return; }
      const studentIds = Array.from(checks).map(cb => cb.value).filter(Boolean);
      const selectedStudents = myStudents.filter(student => studentIds.includes(String(student.id || student._docId || '')));
      overlay.remove();
      const _btnState = this._setEduBtnLoading('[onclick*="applyCourseEnrollment"]');
      try {
        const result = await FirebaseService.registerForEduCoursePlan(teamId, planId, studentIds, {
          requestId: 'edu_' + teamId + '_' + planId + '_' + curUser.uid + '_' + Date.now(),
        });
        this._mergeCourseEnrollmentCacheAfterRegister(teamId, planId, result?.enrollments || [], selectedStudents, curUser);
        this.showToast('報名已送出，請等待審核');
        if (this.currentPage === 'page-edu-course-enrollment'
          && String(this._ceTeamId || '') === String(teamId || '')
          && String(this._cePlanId || '') === String(planId || '')) {
          await this._renderCourseEnrollmentList(teamId, planId, { useCache: true });
        }
        await this.renderEduCoursePlanList(teamId, undefined);
        this._refreshCourseViewsAfterEnrollmentChange(teamId, planId, { force: true });
      } catch (err) {
        console.error('[applyCourseEnrollment]', err);
        this.showToast('報名失敗：' + (err.message || '請稍後再試'));
      } finally { _btnState.restore(); }
    };
    } finally {
      actionState.restore();
    }
  },

  _toggleEnrollNoteEditor(id, triggerId) {
    const el = document.getElementById(id);
    if (!el) return;
    const trigger = triggerId ? document.getElementById(triggerId) : null;
    const shouldOpen = el.style.display === 'none';
    el.style.display = shouldOpen ? '' : 'none';
    if (trigger) trigger.style.display = shouldOpen ? 'none' : '';
    if (shouldOpen) {
      const input = el.querySelector?.('input');
      input?.focus?.();
    }
  },

  // ══════════════════════════════════
  //  審核、繳費、備註操作
  // ══════════════════════════════════

  async _approveCourseEnrollment(teamId, planId, enrollId, btnEl) {
    const _b = this._setEduBtnLoading(btnEl);
    try {
      const key = this._getCourseEnrollCacheKey(teamId, planId);
      await FirebaseService.approveCourseEnrollment(teamId, planId, enrollId);
      delete this._courseEnrollCache[key];
      delete this._courseEnrollSummaryCache[key];
      // 更新方案 currentCount
      // 學員狀態也更新為 active
      this.showToast('已通過');
      await this._syncCourseSessionsAfterEnrollmentApproval(teamId, planId);
      await this._renderCourseEnrollmentList(teamId, planId);
      await this._refreshCourseViewsAfterEnrollmentChange(teamId, planId, { force: true });
    } catch (err) {
      console.error('[_approveCourseEnrollment]', err);
      this.showToast((err && err.message) || '審核失敗');
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
      const key = this._getCourseEnrollCacheKey(teamId, planId);
      delete this._courseEnrollCache[key];
      delete this._courseEnrollSummaryCache[key];
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
      if (!this._isEduAutoEnrollmentMaterializationAllowed()) {
        this._showEduAutoMigrationCompletedToast();
        await this._renderCourseEnrollmentList(teamId, planId);
        return;
      }
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
      const today = this._todayStr?.() || (() => {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      })();
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
      if (!this._isEduAutoEnrollmentMaterializationAllowed()) {
        this._showEduAutoMigrationCompletedToast();
        await this._renderCourseEnrollmentList(teamId, planId);
        return;
      }
      const realId = this._generateEduId('enr');
      const doc = { id: realId, studentId: enr.studentId, studentName: enr.studentName,
        selfUid: enr.selfUid || null, parentUid: enr.parentUid || null,
        status: 'approved', paidAt: null, coachNotes: '', reviewerName: null, reviewedAt: null };
      await FirebaseService.createCourseEnrollment(teamId, planId, doc);
      enr.id = realId; enrollId = realId;
    }
    const current = enr?.paidAt || this._todayStr?.() || (() => {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
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
      if (!this._isEduAutoEnrollmentMaterializationAllowed()) {
        this._showEduAutoMigrationCompletedToast();
        await this._renderCourseEnrollmentList(teamId, planId);
        return;
      }
      const realId = this._generateEduId('enr');
      const doc = { id: realId, studentId: enr.studentId, studentName: enr.studentName,
        selfUid: enr.selfUid || null, parentUid: enr.parentUid || null,
        status: 'approved', paidAt: null, coachNotes: '', reviewerName: null, reviewedAt: null };
      await FirebaseService.createCourseEnrollment(teamId, planId, doc);
      enr.id = realId; enrollId = realId;
    }
    const rawNotes = String(textarea.value || '').trim();
    const notes = rawNotes.slice(0, 15);
    if (textarea.value !== notes) textarea.value = notes;
    await FirebaseService.updateCourseEnrollment(teamId, planId, enrollId, { coachNotes: notes });
    if (enr) enr.coachNotes = notes;
    this.showToast('備註已儲存');
    await this._renderCourseEnrollmentList(teamId, planId);
  },
});
