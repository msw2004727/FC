/* ================================================
   SportHub Education: Course Session Form
   ================================================ */

Object.assign(App, {
  async openCourseSessionForm(teamId, planId, sessionId) {
    const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
    const sessions = await this._loadCourseSessions(teamId, planId);
    const enrollments = await this._loadCourseEnrollments(teamId, planId);
    const roster = this._getCourseApprovedRoster(teamId, plan, enrollments);
    const session = sessionId ? sessions.find(s => s.id === sessionId) : null;
    const team = this._getEduTeamRecord(teamId);
    const curUser = ApiService.getCurrentUser?.();
    const today = new Date().toISOString().slice(0, 10);
    const defaultTitle = '第 ' + (sessions.length + 1) + ' 堂';
    const defaultManager = curUser?.displayName || curUser?.name || team?.leader || team?.captain || '';
    const defaultCoach = (team?.coaches && team.coaches[0]) || team?.leader || team?.captain || defaultManager;
    const selected = new Set(session ? (session.studentIds || []).map(String) : roster.map(item => String(item.student?.id || item.student?._docId || '')));

    this._eduCourseSessionEditContext = { teamId, planId, sessionId: sessionId || null };

    const studentHtml = roster.length
      ? roster.map(item => {
          const student = item.student || {};
          const id = String(student.id || student._docId || '');
          const checked = selected.has(id) ? ' checked' : '';
          return '<label class="edu-session-pick-item">'
            + '<input type="checkbox" value="' + escapeHTML(id) + '"' + checked + '>'
            + '<span><strong>' + escapeHTML(student.name || '未命名學員') + '</strong><em>' + this._renderCourseSessionStudentTags(student, item.enrollment, plan) + '</em></span>'
          + '</label>';
        }).join('')
      : '<div class="edu-session-empty-students">尚未有核准學員，仍可先建立課堂。</div>';

    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay edu-session-form-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog edu-session-form-dialog">'
      + '<div class="edu-info-dialog-title">' + (session ? '編輯課堂' : '新增課堂') + '</div>'
      + '<div class="edu-session-form-grid">'
        + '<div class="ce-row"><label>課堂名稱</label><input id="edu-session-title" type="text" maxlength="36" value="' + escapeHTML(session?.title || defaultTitle) + '"></div>'
        + '<div class="ce-row"><label>課堂狀態</label><select id="edu-session-status"><option value="scheduled">已排課</option><option value="done">已完成</option><option value="cancelled">已取消</option></select></div>'
        + '<div class="ce-row"><label>日期 <span class="required">*必填</span></label><input id="edu-session-date" type="date" value="' + escapeHTML(session?.date || today) + '"></div>'
        + '<div class="ce-row edu-session-time-row"><label>時間 <span class="required">*必填</span></label><div><input id="edu-session-start" type="time" value="' + escapeHTML(session?.startTime || '19:00') + '"><span>~</span><input id="edu-session-end" type="time" value="' + escapeHTML(session?.endTime || '20:30') + '"></div></div>'
        + '<div class="ce-row"><label>地點</label><input id="edu-session-location" type="text" maxlength="60" value="' + escapeHTML(session?.location || '') + '" placeholder="例：西屯足球場 A 場"></div>'
        + '<div class="ce-row"><label>人數上限</label><input id="edu-session-capacity" type="number" min="1" max="999" value="' + escapeHTML(session?.capacity || plan?.maxCapacity || '') + '" placeholder="不填則不限"></div>'
        + '<div class="ce-row"><label>負責人</label><input id="edu-session-manager" type="text" maxlength="30" value="' + escapeHTML(session?.managerName || defaultManager) + '"></div>'
        + '<div class="ce-row"><label>負責人聯繫</label><input id="edu-session-manager-contact" type="text" maxlength="60" value="' + escapeHTML(session?.managerContact || '') + '" placeholder="LINE / 電話 / Email"></div>'
        + '<div class="ce-row"><label>執課教練</label><input id="edu-session-coach" type="text" maxlength="30" value="' + escapeHTML(session?.coachName || defaultCoach) + '"></div>'
        + '<div class="ce-row"><label>教練聯繫</label><input id="edu-session-coach-contact" type="text" maxlength="60" value="' + escapeHTML(session?.coachContact || '') + '" placeholder="LINE / 電話 / Email"></div>'
        + '<div class="ce-row edu-session-form-wide"><label>課堂重點</label><input id="edu-session-focus" type="text" maxlength="80" value="' + escapeHTML(session?.focus || '') + '" placeholder="例：控球、傳接、3v3 小組對抗"></div>'
        + '<div class="ce-row edu-session-form-wide"><label>備註</label><textarea id="edu-session-notes" rows="2" maxlength="160" placeholder="給內部職員看的課務備註">' + escapeHTML(session?.notes || '') + '</textarea></div>'
      + '</div>'
      + '<div class="edu-session-pick-head"><strong>本堂學員</strong><span>' + roster.length + ' 位可選</span><button class="outline-btn small" onclick="App._setCourseSessionStudentChecks(true)">全選</button><button class="outline-btn small" onclick="App._setCourseSessionStudentChecks(false)">清空</button></div>'
      + '<div class="edu-session-pick-list" id="edu-session-student-pick">' + studentHtml + '</div>'
      + '<div class="modal-actions">'
        + '<button class="outline-btn" onclick="this.closest(\'.edu-info-overlay\').remove()">取消</button>'
        + '<button class="primary-btn" id="edu-session-save-btn" onclick="App.handleSaveCourseSession()">儲存課堂</button>'
      + '</div>'
    + '</div>';
    document.body.appendChild(overlay);
    const statusEl = document.getElementById('edu-session-status');
    if (statusEl) statusEl.value = session?.status || 'scheduled';
  },

  _setCourseSessionStudentChecks(checked) {
    document.querySelectorAll('#edu-session-student-pick input[type="checkbox"]').forEach(input => {
      input.checked = !!checked;
    });
  },

  async handleSaveCourseSession() {
    const ctx = this._eduCourseSessionEditContext;
    if (!ctx) return;
    const title = document.getElementById('edu-session-title')?.value.trim() || '';
    const date = document.getElementById('edu-session-date')?.value || '';
    const startTime = document.getElementById('edu-session-start')?.value || '';
    const endTime = document.getElementById('edu-session-end')?.value || '';
    if (!date || !startTime || !endTime) {
      this.showToast('請填寫課堂日期與時間');
      return;
    }
    const capacityRaw = document.getElementById('edu-session-capacity')?.value || '';
    const capacityValue = capacityRaw ? parseInt(capacityRaw, 10) : null;
    const studentIds = Array.from(document.querySelectorAll('#edu-session-student-pick input[type="checkbox"]:checked'))
      .map(input => input.value)
      .filter(Boolean);
    const payload = {
      title: title || '未命名課堂',
      status: document.getElementById('edu-session-status')?.value || 'scheduled',
      date,
      startTime,
      endTime,
      location: document.getElementById('edu-session-location')?.value.trim() || '',
      capacity: Number.isFinite(capacityValue) ? capacityValue : null,
      studentIds,
      managerName: document.getElementById('edu-session-manager')?.value.trim() || '',
      managerContact: document.getElementById('edu-session-manager-contact')?.value.trim() || '',
      coachName: document.getElementById('edu-session-coach')?.value.trim() || '',
      coachContact: document.getElementById('edu-session-coach-contact')?.value.trim() || '',
      focus: document.getElementById('edu-session-focus')?.value.trim() || '',
      notes: document.getElementById('edu-session-notes')?.value.trim() || '',
    };
    if (payload.capacity && studentIds.length > payload.capacity) {
      this.showToast('本堂學員數已超過人數上限');
      return;
    }

    const buttonState = this._setEduBtnLoading('#edu-session-save-btn');
    try {
      const key = this._getCourseSessionCacheKey(ctx.teamId, ctx.planId);
      if (ctx.sessionId) {
        await FirebaseService.updateCourseSession(ctx.teamId, ctx.planId, ctx.sessionId, payload);
        const cached = this._courseSessionCache[key] || [];
        const existing = cached.find(s => s.id === ctx.sessionId);
        if (existing) Object.assign(existing, payload);
        this.showToast('課堂已更新');
      } else {
        payload.id = this._generateEduId('cls');
        const created = await FirebaseService.createCourseSession(ctx.teamId, ctx.planId, payload);
        if (!this._courseSessionCache[key]) this._courseSessionCache[key] = [];
        this._courseSessionCache[key].push(created);
        this.showToast('課堂已建立');
      }
      document.querySelector('.edu-session-form-overlay')?.remove();
      await this._renderCourseSessionBoard(ctx.teamId, ctx.planId);
    } catch (err) {
      console.error('[handleSaveCourseSession]', err);
      this.showToast('儲存課堂失敗：' + (err.message || '請稍後再試'));
    } finally {
      buttonState.restore();
    }
  },

  async deleteCourseSession(teamId, planId, sessionId) {
    const ok = this.appConfirm ? await this.appConfirm('確定刪除此課堂卡片？') : window.confirm('確定刪除此課堂卡片？');
    if (!ok) return;
    try {
      await FirebaseService.deleteCourseSession(teamId, planId, sessionId);
      const key = this._getCourseSessionCacheKey(teamId, planId);
      this._courseSessionCache[key] = (this._courseSessionCache[key] || []).filter(s => s.id !== sessionId);
      this.showToast('課堂已刪除');
      await this._renderCourseSessionBoard(teamId, planId);
    } catch (err) {
      console.error('[deleteCourseSession]', err);
      this.showToast('刪除課堂失敗');
    }
  },
});
