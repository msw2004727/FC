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
    const today = this._todayStr?.() || (() => {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    const defaultTitle = '第 ' + (sessions.length + 1) + ' 堂';
    const defaultManager = curUser?.displayName || curUser?.name || team?.leader || team?.captain || '';
    const defaultCoach = (team?.coaches && team.coaches[0]) || team?.leader || team?.captain || defaultManager;
    const selected = new Set(session ? (session.studentIds || []).map(String) : roster.map(item => String(item.student?.id || item.student?._docId || '')));

    this._eduCourseSessionEditContext = { teamId, planId, sessionId: sessionId || null };
    this._eduCourseSessionAssistantCoaches = this._normalizeCourseSessionAssistantCoaches(session?.assistantCoaches || session?.assistantCoachNames || []);

    const studentHtml = roster.length
      ? roster.map(item => {
          const student = item.student || {};
          const id = String(student.id || student._docId || '');
          const checked = selected.has(id) ? ' checked' : '';
          const name = student.name || '未命名學員';
          return '<label class="edu-session-pick-item">'
            + '<input type="checkbox" value="' + escapeHTML(id) + '"' + checked + '>'
            + this._renderCourseSessionMemberPill(student, name, { link: false })
            + '<span class="edu-session-pick-main">'
              + '<em class="edu-session-student-tags">' + this._renderCourseSessionStudentTags(student, item.enrollment, plan) + '</em>'
            + '</span>'
          + '</label>';
        }).join('')
      : '<div class="edu-session-empty-students">尚未有核准學員，仍可先建立課堂。</div>';

    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay edu-session-form-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog edu-session-form-dialog">'
      + '<div class="edu-info-dialog-title">' + (session ? '編輯課堂' : '新增課堂') + '</div>'
      + '<div class="ce-row edu-session-template-panel">'
        + '<div class="ce-label-row"><label>從範本建立</label></div>'
        + '<div class="edu-session-template-list" id="edu-session-template-selector"><span>載入範本中...</span></div>'
      + '</div>'
      + '<div class="edu-session-form-grid">'
        + '<div class="ce-row"><label>課堂名稱 <span class="required">*必填</span></label><input id="edu-session-title" type="text" maxlength="36" value="' + escapeHTML(session?.title || defaultTitle) + '"></div>'
        + '<div class="ce-row"><label>課堂狀態</label><select id="edu-session-status"><option value="scheduled">已排課</option><option value="done">已完成</option><option value="cancelled">已取消</option></select></div>'
        + '<div class="ce-row"><label>日期 <span class="required">*必填</span></label><input id="edu-session-date" type="date" value="' + escapeHTML(session?.date || today) + '"></div>'
        + '<div class="ce-row edu-session-time-row"><label>時間 <span class="required">*必填</span></label><div><input id="edu-session-start" type="time" value="' + escapeHTML(session?.startTime || '19:00') + '"><span>~</span><input id="edu-session-end" type="time" value="' + escapeHTML(session?.endTime || '20:30') + '"></div></div>'
        + '<div class="ce-row"><label>地點 <span class="required">*必填</span></label><input id="edu-session-location" type="text" maxlength="60" value="' + escapeHTML(session?.location || '') + '" placeholder="例：西屯足球場 A 場"></div>'
        + '<div class="ce-row"><label>人數上限</label><input id="edu-session-capacity" type="number" min="1" max="999" value="' + escapeHTML(session?.capacity || plan?.maxCapacity || '') + '" placeholder="不填則不限"></div>'
        + '<div class="ce-row edu-session-staff-row"><label>負責人 <span class="required">*必填</span></label><div class="edu-session-staff-field"><input id="edu-session-manager" type="text" maxlength="30" value="' + escapeHTML(session?.managerName || defaultManager) + '" placeholder="輸入姓名或搜尋同俱樂部職員" oninput="App.searchCourseSessionStaff(\'manager\')" onfocus="App.searchCourseSessionStaff(\'manager\')"><div id="edu-session-manager-suggest" class="team-user-suggest edu-session-staff-suggest"></div></div></div>'
        + '<div class="ce-row"><label>負責人聯繫 <span class="required">*必填</span></label><input id="edu-session-manager-contact" type="text" maxlength="160" value="' + escapeHTML(session?.managerContact || '') + '" placeholder="https://line.me/... 或手動輸入" oninput="App.previewCourseSessionContact(\'manager\')" onblur="App.previewCourseSessionContact(\'manager\')"><div id="edu-session-manager-contact-preview" class="edu-session-contact-preview"></div></div>'
        + '<div class="ce-row edu-session-staff-row"><label>執課教練 <span class="required">*必填</span></label><div class="edu-session-staff-field"><input id="edu-session-coach" type="text" maxlength="30" value="' + escapeHTML(session?.coachName || defaultCoach) + '" placeholder="輸入姓名或搜尋同俱樂部教練" oninput="App.searchCourseSessionStaff(\'coach\')" onfocus="App.searchCourseSessionStaff(\'coach\')"><div id="edu-session-coach-suggest" class="team-user-suggest edu-session-staff-suggest"></div></div></div>'
        + '<div class="ce-row"><label>教練聯繫 <span class="required">*必填</span></label><input id="edu-session-coach-contact" type="text" maxlength="160" value="' + escapeHTML(session?.coachContact || '') + '" placeholder="https://instagram.com/... 或手動輸入" oninput="App.previewCourseSessionContact(\'coach\')" onblur="App.previewCourseSessionContact(\'coach\')"><div id="edu-session-coach-contact-preview" class="edu-session-contact-preview"></div></div>'
        + '<div class="ce-row edu-session-form-wide edu-session-assistant-row"><label>助理教練 <span>最多 5 位，可搜尋或手動填寫</span></label><div class="edu-session-assistant-control"><div class="edu-session-staff-field"><input id="edu-session-assistant-search" type="text" maxlength="30" placeholder="搜尋同俱樂部教練以上職位或輸入姓名" oninput="App.searchCourseSessionStaff(\'assistant\')" onfocus="App.searchCourseSessionStaff(\'assistant\')"><div id="edu-session-assistant-suggest" class="team-user-suggest edu-session-staff-suggest"></div></div><button class="outline-btn small" type="button" onclick="App.addCourseSessionAssistantCoachFromInput()">加入</button></div><div id="edu-session-assistant-tags" class="edu-session-assistant-tags"></div></div>'
        + '<div class="ce-row edu-session-form-wide"><label>課堂重點</label><input id="edu-session-focus" type="text" maxlength="80" value="' + escapeHTML(session?.focus || '') + '" placeholder="例：控球、傳接、3v3 小組對抗"></div>'
        + '<div class="ce-row edu-session-form-wide"><label>備註</label><textarea id="edu-session-notes" rows="2" maxlength="160" placeholder="給內部職員看的課務備註">' + escapeHTML(session?.notes || '') + '</textarea></div>'
        + '<div class="ce-row edu-session-form-wide edu-session-template-save-row"><label>儲存為範本</label><div class="edu-session-template-save"><input id="edu-session-template-name" type="text" maxlength="24" placeholder="範本名稱"><button class="outline-btn small" type="button" onclick="App._saveCourseSessionTemplate()">儲存</button></div></div>'
      + '</div>'
      + '<div class="edu-session-pick-section">'
        + '<div class="edu-session-pick-head"><div class="edu-session-pick-head-copy"><strong>本堂學員</strong><span>從方案學員名單勾選這堂課的人員，' + roster.length + ' 位可選</span></div><div class="edu-session-pick-actions"><button class="outline-btn small" type="button" onclick="App._setCourseSessionStudentChecks(true)">全選</button><button class="outline-btn small" type="button" onclick="App._setCourseSessionStudentChecks(false)">清空</button></div></div>'
        + '<div class="edu-session-pick-list" id="edu-session-student-pick">' + studentHtml + '</div>'
      + '</div>'
      + '<div class="modal-actions">'
        + '<button class="outline-btn" onclick="this.closest(\'.edu-info-overlay\').remove()">取消</button>'
        + '<button class="primary-btn" id="edu-session-save-btn" onclick="App.handleSaveCourseSession()">儲存課堂</button>'
      + '</div>'
    + '</div>';
    document.body.appendChild(overlay);
    this._bindCourseSessionStudentAvatarFallbacks(overlay);
    this._renderCourseSessionAssistantCoachTags();
    this.previewCourseSessionContact?.('manager');
    this.previewCourseSessionContact?.('coach');
    this._renderCourseSessionTemplateSelector?.();
    this._ensureCourseSessionTemplatesReady?.();
    const statusEl = document.getElementById('edu-session-status');
    if (statusEl) statusEl.value = session?.status || 'scheduled';
  },

  _setCourseSessionStudentChecks(checked) {
    document.querySelectorAll('#edu-session-student-pick input[type="checkbox"]').forEach(input => {
      input.checked = !!checked;
    });
  },

  _courseSessionTemplateKey() {
    return 'sporthub_course_session_templates_' + ModeManager.getMode();
  },

  _getCourseSessionTemplateOwnerUid() {
    const user = ApiService.getCurrentUser?.();
    return String(user?.uid || user?.lineUserId || user?._docId || '').trim();
  },

  _getCourseSessionTemplateOwnerName() {
    const user = ApiService.getCurrentUser?.();
    return String(user?.displayName || user?.name || user?.nickname || '').trim();
  },

  _isCourseSessionCloudTemplateEnabled() {
    return !!this._getCourseSessionTemplateOwnerUid();
  },

  _getCourseSessionTemplatesFromLocal() {
    try {
      const data = JSON.parse(localStorage.getItem(this._courseSessionTemplateKey()) || '[]');
      return Array.isArray(data) ? data.filter(t => t.templateType === 'courseSession') : [];
    } catch {
      return [];
    }
  },

  _setCourseSessionTemplatesToLocal(templates) {
    localStorage.setItem(this._courseSessionTemplateKey(), JSON.stringify(templates));
  },

  _saveCourseSessionTemplateToLocal(template) {
    let templates = this._getCourseSessionTemplatesFromLocal().filter(t => t.id !== template.id);
    if (templates.length >= (this._MAX_TEMPLATES || 30)) return { ok: false, reason: 'limit' };
    templates.unshift({ ...template });
    templates = templates.slice(0, this._MAX_TEMPLATES || 30);
    try {
      this._setCourseSessionTemplatesToLocal(templates);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'quota' };
    }
  },

  _removeCourseSessionTemplateFromLocal(id) {
    try {
      this._setCourseSessionTemplatesToLocal(this._getCourseSessionTemplatesFromLocal().filter(t => t.id !== id));
    } catch {}
  },

  _getCourseSessionTemplates() {
    const isCourseSession = template => template?.templateType === 'courseSession';
    if (this._isCourseSessionCloudTemplateEnabled()) {
      const cloud = (ApiService.getEventTemplates?.() || []).filter(isCourseSession);
      if (cloud.length > 0 || this._templatesLoadedUid === this._getCourseSessionTemplateOwnerUid()) return cloud;
    }
    return this._getCourseSessionTemplatesFromLocal();
  },

  async _ensureCourseSessionTemplatesReady(force = false) {
    if (!this._isCourseSessionCloudTemplateEnabled()) {
      this._renderCourseSessionTemplateSelector();
      return;
    }
    const uid = this._getCourseSessionTemplateOwnerUid();
    if (!uid) return;
    if (!force && this._templatesLoadedUid === uid) {
      this._renderCourseSessionTemplateSelector();
      return;
    }
    try {
      await ApiService.loadMyEventTemplates(uid);
      this._templatesLoadedUid = uid;
    } catch (err) {
      console.warn('[course session template] load failed, fallback to local:', err);
    }
    this._renderCourseSessionTemplateSelector();
  },

  _buildCurrentCourseSessionTemplate(name) {
    const capacityRaw = document.getElementById('edu-session-capacity')?.value || '';
    const capacityValue = capacityRaw ? parseInt(capacityRaw, 10) : null;
    return {
      id: 'tpl_cls_' + Date.now(),
      name,
      templateType: 'courseSession',
      title: document.getElementById('edu-session-title')?.value.trim() || '',
      location: document.getElementById('edu-session-location')?.value.trim() || '',
      capacity: Number.isFinite(capacityValue) ? capacityValue : null,
      managerName: document.getElementById('edu-session-manager')?.value.trim() || '',
      managerContact: document.getElementById('edu-session-manager-contact')?.value.trim() || '',
      coachName: document.getElementById('edu-session-coach')?.value.trim() || '',
      coachContact: document.getElementById('edu-session-coach-contact')?.value.trim() || '',
      assistantCoaches: this._getCourseSessionAssistantCoachPayload?.() || [],
      focus: document.getElementById('edu-session-focus')?.value.trim() || '',
      notes: document.getElementById('edu-session-notes')?.value.trim() || '',
      updatedAt: new Date().toISOString(),
    };
  },

  async _saveCourseSessionTemplate() {
    const nameInput = document.getElementById('edu-session-template-name');
    const name = (nameInput?.value || '').trim();
    if (!name) {
      this.showToast('請輸入範本名稱');
      return;
    }
    const tpl = this._buildCurrentCourseSessionTemplate(name);
    const max = this._MAX_TEMPLATES || 30;
    if (this._isCourseSessionCloudTemplateEnabled()) {
      const uid = this._getCourseSessionTemplateOwnerUid();
      try {
        await this._ensureCourseSessionTemplatesReady();
        if (this._getCourseSessionTemplates().length >= max) {
          this.showToast(`範本數量已達上限 ${max} 組`);
          return;
        }
        await ApiService.createEventTemplate({
          ...tpl,
          ownerUid: uid,
          ownerName: this._getCourseSessionTemplateOwnerName(),
        });
        await ApiService.loadMyEventTemplates(uid);
        this._templatesLoadedUid = uid;
        this._saveCourseSessionTemplateToLocal(tpl);
        if (nameInput) nameInput.value = '';
        this._renderCourseSessionTemplateSelector();
        this.showToast(`範本「${name}」已儲存到雲端`);
        return;
      } catch (err) {
        console.warn('[course session template] cloud save failed:', err);
      }
    }
    const result = this._saveCourseSessionTemplateToLocal(tpl);
    if (!result.ok) {
      this.showToast(result.reason === 'limit' ? `範本數量已達上限 ${max} 組` : '範本儲存失敗');
      return;
    }
    if (nameInput) nameInput.value = '';
    this._renderCourseSessionTemplateSelector();
    this.showToast(`範本「${name}」已儲存`);
  },

  _loadCourseSessionTemplate(id) {
    const tpl = this._getCourseSessionTemplates().find(t => String(t.id) === String(id))
      || this._getCourseSessionTemplatesFromLocal().find(t => String(t.id) === String(id));
    if (!tpl) return;
    const setVal = (elId, value) => {
      const el = document.getElementById(elId);
      if (el && value !== undefined && value !== null) el.value = value;
    };
    setVal('edu-session-title', tpl.title);
    setVal('edu-session-location', tpl.location);
    setVal('edu-session-capacity', tpl.capacity);
    setVal('edu-session-manager', tpl.managerName);
    setVal('edu-session-manager-contact', tpl.managerContact);
    setVal('edu-session-coach', tpl.coachName);
    setVal('edu-session-coach-contact', tpl.coachContact);
    setVal('edu-session-focus', tpl.focus);
    setVal('edu-session-notes', tpl.notes);
    this._eduCourseSessionAssistantCoaches = this._normalizeCourseSessionAssistantCoaches(tpl.assistantCoaches || []);
    this._renderCourseSessionAssistantCoachTags();
    this.previewCourseSessionContact?.('manager');
    this.previewCourseSessionContact?.('coach');
    this.showToast(`已載入範本「${tpl.name}」`);
  },

  async _deleteCourseSessionTemplate(id) {
    const cloudEnabled = this._isCourseSessionCloudTemplateEnabled();
    if (cloudEnabled) {
      const uid = this._getCourseSessionTemplateOwnerUid();
      try {
        await ApiService.deleteEventTemplate(id);
        await ApiService.loadMyEventTemplates(uid);
        this._templatesLoadedUid = uid;
      } catch (err) {
        console.warn('[course session template] cloud delete failed:', err);
      }
    }
    this._removeCourseSessionTemplateFromLocal(id);
    this._renderCourseSessionTemplateSelector();
    this.showToast('範本已刪除');
  },

  _renderCourseSessionTemplateSelector() {
    const container = document.getElementById('edu-session-template-selector');
    if (!container) return;
    const cloud = this._getCourseSessionTemplates();
    const local = this._getCourseSessionTemplatesFromLocal();
    const seen = new Set(cloud.map(t => t.id));
    const templates = [...cloud, ...local.filter(t => !seen.has(t.id))];
    if (!templates.length) {
      container.innerHTML = '<span class="edu-session-template-empty">尚無範本</span>';
      return;
    }
    container.innerHTML = templates.map(t => '<span class="edu-session-template-chip" onclick="App._loadCourseSessionTemplate(\'' + escapeHTML(t.id) + '\')">'
      + escapeHTML(t.name)
      + '<button type="button" onclick="event.stopPropagation();App._deleteCourseSessionTemplate(\'' + escapeHTML(t.id) + '\')" title="刪除範本">×</button>'
      + '</span>').join('');
  },

  async handleSaveCourseSession() {
    const ctx = this._eduCourseSessionEditContext;
    if (!ctx) return;
    const title = document.getElementById('edu-session-title')?.value.trim() || '';
    const date = document.getElementById('edu-session-date')?.value || '';
    const startTime = document.getElementById('edu-session-start')?.value || '';
    const endTime = document.getElementById('edu-session-end')?.value || '';
    const location = document.getElementById('edu-session-location')?.value.trim() || '';
    const managerName = document.getElementById('edu-session-manager')?.value.trim() || '';
    const managerContact = document.getElementById('edu-session-manager-contact')?.value.trim() || '';
    const coachName = document.getElementById('edu-session-coach')?.value.trim() || '';
    const coachContact = document.getElementById('edu-session-coach-contact')?.value.trim() || '';
    const capacityRaw = document.getElementById('edu-session-capacity')?.value || '';
    const capacityValue = capacityRaw ? parseInt(capacityRaw, 10) : null;
    const studentIds = Array.from(document.querySelectorAll('#edu-session-student-pick input[type="checkbox"]:checked'))
      .map(input => input.value)
      .filter(Boolean);
    const missing = [
      ['課堂名稱', title],
      ['日期', date],
      ['開始時間', startTime],
      ['結束時間', endTime],
      ['地點', location],
      ['負責人', managerName],
      ['負責人聯繫', managerContact],
      ['執課教練', coachName],
      ['教練聯繫', coachContact],
    ].filter(item => !item[1]).map(item => item[0]);
    if (missing.length) {
      this.showToast('請完整填寫：' + missing.join('、'));
      return;
    }
    const payload = {
      title,
      status: document.getElementById('edu-session-status')?.value || 'scheduled',
      date,
      startTime,
      endTime,
      location,
      capacity: Number.isFinite(capacityValue) ? capacityValue : null,
      studentIds,
      managerName,
      managerContact,
      coachName,
      coachContact,
      assistantCoaches: this._getCourseSessionAssistantCoachPayload?.() || [],
      focus: document.getElementById('edu-session-focus')?.value.trim() || '',
      notes: document.getElementById('edu-session-notes')?.value.trim() || '',
    };
    payload.assistantCoachNames = payload.assistantCoaches.map(item => item.name).filter(Boolean);
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
      const code = String(err?.code || '');
      const permissionDenied = code.includes('permission-denied') || /permission|insufficient/i.test(err?.message || '');
      this.showToast(permissionDenied
        ? '儲存課堂失敗：權限不足，請確認 Firestore 規則已部署且你是負責職員'
        : '儲存課堂失敗：' + (err.message || '請稍後再試'));
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
