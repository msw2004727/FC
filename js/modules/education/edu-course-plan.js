/* ================================================
   SportHub — Education: Course Plan CRUD
   ================================================
   課程方案管理（週期制 + 堂數制）
   列表渲染 → edu-course-plan-render.js
   簽到彈窗 → edu-course-plan-attendance.js
   ================================================ */

Object.assign(App, {
  _eduCoursePlansCache: {},
  _eduCoursePlanEditTeamId: null,
  _eduCoursePlanEditId: null,
  _eduCoursePlanRequestSeq: 0,

  async _loadEduCoursePlans(teamId) {
    if (!teamId) return [];
    try {
      const plans = await FirebaseService.listEduCoursePlans(teamId);
      this._eduCoursePlansCache[teamId] = plans;
      return plans;
    } catch (err) {
      console.error('[edu-course-plan] load failed:', err);
      return this._eduCoursePlansCache[teamId] || [];
    }
  },

  getEduCoursePlans(teamId) {
    return this._eduCoursePlansCache[teamId] || [];
  },

  // renderEduCoursePlanList → edu-course-plan-render.js

  async showEduCoursePlanForm(teamId, planId) {
    const requestSeq = ++this._eduCoursePlanRequestSeq;
    this._eduCoursePlanEditTeamId = teamId;
    this._eduCoursePlanEditId = planId || null;

    // 確保頁面已載入
    await this.showPage('page-edu-course-plan');
    if (requestSeq !== this._eduCoursePlanRequestSeq || this.currentPage !== 'page-edu-course-plan') {
      if (window._raceDebug || (typeof localStorage !== 'undefined' && localStorage.getItem('_raceLog'))) {
        console.log('[race-skip]', { fn: 'showEduCoursePlanForm', seq: requestSeq, latest: this._eduCoursePlanRequestSeq, currentPage: this.currentPage });
      }
      return { ok: false, reason: 'stale' };
    }

    const container = document.getElementById('edu-course-plan-page');
    if (!container) return;

    const groups = await this._loadEduGroups(teamId);
    if (requestSeq !== this._eduCoursePlanRequestSeq) {
      if (window._raceDebug || (typeof localStorage !== 'undefined' && localStorage.getItem('_raceLog'))) {
        console.log('[race-skip]', { fn: 'showEduCoursePlanForm', seq: requestSeq, latest: this._eduCoursePlanRequestSeq, stage: 'after-loadEduGroups' });
      }
      return { ok: false, reason: 'stale' };
    }
    const plan = planId ? (this.getEduCoursePlans(teamId).find(p => p.id === planId) || null) : null;

    const groupOptions = groups.filter(g => g.active !== false)
      .map(g => '<option value="' + g.id + '" data-name="' + escapeHTML(g.name) + '"' +
        (plan && plan.groupId === g.id ? ' selected' : '') + '>' + escapeHTML(g.name) + '</option>')
      .join('');

    const isWeekly = plan ? plan.planType === 'weekly' : true;
    const tagsValue = (key) => Array.isArray(plan?.[key]) ? plan[key].join(', ') : '';
    const fieldValue = (key) => escapeHTML(plan?.[key] || '');
    const courseContentValue = escapeHTML(plan?.courseContent || plan?.description || '');
    const cancellationPolicyValue = escapeHTML(plan?.cancellationPolicy || '');

    const useV2 = typeof isCoursePlanFormV2Enabled === 'function' && isCoursePlanFormV2Enabled();
    if (useV2) {
      let fallbackError = null;
      try {
        if (typeof ScriptLoader !== 'undefined' && typeof ScriptLoader.ensureGroup === 'function') {
          await ScriptLoader.ensureGroup('coursePlanForm');
        }
        if (requestSeq !== this._eduCoursePlanRequestSeq) {
          if (window._raceDebug || (typeof localStorage !== 'undefined' && localStorage.getItem('_raceLog'))) {
            console.log('[race-skip]', { fn: 'showEduCoursePlanForm', seq: requestSeq, latest: this._eduCoursePlanRequestSeq, stage: 'after-coursePlanForm' });
          }
          return { ok: false, reason: 'stale' };
        }
        if (typeof this._renderEduCoursePlanFormV2 === 'function') {
          this._renderEduCoursePlanFormV2({
            container,
            plan,
            planId,
            groupOptions,
            isWeekly,
            tagsValue,
            fieldValue,
            courseContentValue,
            cancellationPolicyValue,
          });
          this._verifyEduCoursePlanRenderedFields?.(container, 'v2');
          this._syncEduCoursePlanFormFillBadges?.();
          return { ok: true };
        }
        fallbackError = new Error('course plan form v2 builder missing');
      } catch (err) {
        fallbackError = err;
      }
      console.warn('[coursePlanFormV2] fallback to v1:', fallbackError?.message || fallbackError);
      if (typeof ApiService !== 'undefined' && typeof ApiService._writeErrorLog === 'function') ApiService._writeErrorLog({
        fn: 'showEduCoursePlanForm',
        reason: 'course_plan_form_v2_fallback',
        flagResolved: true,
        errorCategory: 'ui_fallback',
        noise: true,
      }, fallbackError || new Error('course plan form v2 fallback'));
    }

    container.innerHTML = '<div class="ce-form" style="padding:.5rem">' +
      // Fix 5: 開放報名開關最頂置左
      '<div class="ce-row" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.8rem">' +
        '<div><label style="margin:0;font-weight:700">開放學員報名</label><div style="font-size:.72rem;color:var(--text-muted);margin-top:.15rem">開啟後學員可在俱樂部頁面自助報名此方案</div></div>' +
        '<label class="toggle-switch"><input type="checkbox" id="edu-cp-signup"' + (plan && plan.allowSignup ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
      '</div>' +
      '<div class="ce-row"><label>方案名稱 <span class="required">*必填</span></label>' +
        '<input type="text" id="edu-cp-name" maxlength="30" placeholder="例：2026 春季班" value="' + escapeHTML(plan ? plan.name : '') + '"></div>' +
      // 封面圖片（點擊上傳，寬圖比例 4:3）
      '<div class="ce-row"><label>封面圖片</label>' +
        '<input type="file" id="edu-cp-cover-input" accept="image/*" hidden onchange="App._onEduCpCoverChange(this)">' +
        '<div id="edu-cp-cover-preview" class="edu-cp-cover-upload" onclick="document.getElementById(\'edu-cp-cover-input\').click()">' +
          (plan && plan.coverImage ? '<img src="' + escapeHTML(plan.coverImage) + '">' : '<span>點擊上傳封面圖片</span>') +
        '</div></div>' +
      '<div class="ce-row"><label>對應分組</label>' +
        '<select id="edu-cp-group"><option value="">不綁定分組</option>' + groupOptions + '</select></div>' +
      '<details class="edu-cp-extra-section" open>' +
        '<summary>課程補充資訊</summary>' +
        '<div class="edu-cp-extra-grid">' +
          '<div class="ce-row"><label>課程分類</label><input type="text" id="edu-cp-category-tags" maxlength="80" placeholder="例：固定課, 入門" value="' + escapeHTML(tagsValue('categoryTags')) + '"></div>' +
          '<div class="ce-row"><label>程度標籤</label><input type="text" id="edu-cp-level-label" maxlength="20" placeholder="例：純新手or會傳接球" value="' + fieldValue('levelLabel') + '"></div>' +
          '<div class="ce-row"><label>課程亮點</label><input type="text" id="edu-cp-feature-tags" maxlength="120" placeholder="例：小班制, 專項訓練" value="' + escapeHTML(tagsValue('featureTags')) + '"></div>' +
          '<div class="ce-row"><label>報名要求</label><input type="text" id="edu-cp-requirement-tags" maxlength="120" placeholder="例：需自備球鞋" value="' + escapeHTML(tagsValue('requirementTags')) + '"></div>' +
          '<div class="ce-row"><label>費用包含</label><input type="text" id="edu-cp-included-tags" maxlength="120" placeholder="例：場地, 教練費" value="' + escapeHTML(tagsValue('includedTags')) + '"></div>' +
          '<div class="ce-row"><label>適合對象</label><input type="text" id="edu-cp-target-tags" maxlength="120" placeholder="例：新手, 親子" value="' + escapeHTML(tagsValue('targetTags')) + '"></div>' +
          '<div class="ce-row"><label>報名截止日</label><input type="date" id="edu-cp-signup-deadline" value="' + fieldValue('signupDeadline') + '"></div>' +
          '<div class="ce-row"><label>負責人</label><input type="text" id="edu-cp-manager-name" maxlength="30" placeholder="例：課務窗口" value="' + fieldValue('managerName') + '"></div>' +
          '<div class="ce-row"><label>負責人聯繫</label><input type="text" id="edu-cp-manager-contact" maxlength="160" placeholder="例：LINE ID / 電話 / 聯繫連結" value="' + fieldValue('managerContact') + '"></div>' +
          '<div class="ce-row"><label>授課教練</label><input type="text" id="edu-cp-coach-name" maxlength="30" placeholder="例：王教練" value="' + fieldValue('coachName') + '"></div>' +
          '<div class="ce-row"><label>上課地點</label><input type="text" id="edu-cp-location" maxlength="80" placeholder="例：台中市南屯運動中心" value="' + fieldValue('location') + '"></div>' +
          '<div class="ce-row edu-cp-extra-featured"><label>精選顯示</label><label class="toggle-switch"><input type="checkbox" id="edu-cp-featured"' + (plan?.featured ? ' checked' : '') + '><span class="toggle-slider"></span></label></div>' +
        '</div>' +
        '<div class="ce-row"><label>課程內容</label><textarea id="edu-cp-course-content" maxlength="900" rows="4" placeholder="介紹課程主軸、訓練內容、適合程度與學習目標">' + courseContentValue + '</textarea></div>' +
        '<div class="ce-row"><label>取消政策</label><textarea id="edu-cp-cancellation-policy" maxlength="500" rows="3" placeholder="例：開課前 7 日可全額退費；開課前 3 日內取消，將收取 30% 行政費；開課後恕不退費。">' + cancellationPolicyValue + '</textarea></div>' +
        '<div class="ce-row"><label>課程說明（卡片摘要）</label><textarea id="edu-cp-description" maxlength="500" rows="2" placeholder="補充課程目標、注意事項或適合對象">' + fieldValue('description') + '</textarea></div>' +
        '<div class="edu-cp-extra-hint">標籤請用逗號分隔；這些欄位會先用於卡片與詳情顯示，不會改變報名流程。</div>' +
      '</details>' +
      '<div class="ce-row"><label>方案類型</label>' +
        '<select id="edu-cp-type" onchange="App._toggleCoursePlanType(this.value)">' +
          '<option value="weekly"' + (isWeekly ? ' selected' : '') + '>固定週期</option>' +
          '<option value="session"' + (!isWeekly ? ' selected' : '') + '>堂數制</option>' +
        '</select></div>' +
      '<div id="edu-cp-weekly"' + (isWeekly ? '' : ' style="display:none"') + '>' +
        '<div class="ce-row"><label>上課日（點擊選擇）</label>' +
          '<div id="edu-cp-weekdays" class="edu-weekday-grid">' +
            ['一','二','三','四','五','六','日'].map((label, idx) => {
              const dayVal = idx < 6 ? idx + 1 : 0; // 一=1..六=6, 日=0
              const checked = plan && plan.weekdays && plan.weekdays.includes(dayVal);
              const bgClass = dayVal === 6 ? ' edu-wd-sat' : dayVal === 0 ? ' edu-wd-sun' : '';
              return '<div class="edu-wd-cell' + bgClass + (checked ? ' edu-wd-checked' : '') + '" data-day="' + dayVal + '" onclick="App._toggleWeekdayCell(this)">'
                + '<span class="edu-wd-label">' + label + '</span>'
                + '<span class="edu-wd-check">' + (checked ? '✓' : '') + '</span>'
                + '</div>';
            }).join('') +
          '</div></div>' +
        '<div class="ce-row"><label>時段</label><input type="text" id="edu-cp-timeslot" maxlength="20" placeholder="09:00-10:30" value="' + escapeHTML(plan && plan.timeSlot || '') + '"></div>' +
        '<div id="edu-cp-preview" class="edu-cp-preview"></div>' +
      '</div>' +
      '<div id="edu-cp-session"' + (!isWeekly ? '' : ' style="display:none"') + '>' +
        '<div class="ce-row"><label>總堂數</label><input type="number" id="edu-cp-total" min="1" max="999" value="' + (plan && plan.totalSessions || '') + '"></div>' +
      '</div>' +
      '<div class="ce-row" style="display:flex;gap:.5rem">' +
        '<div style="flex:1"><label>課程開始日期</label><input type="date" id="edu-cp-start" value="' + (plan && plan.startDate || '') + '"></div>' +
        '<div style="flex:1"><label>課程結束日期</label><input type="date" id="edu-cp-end" value="' + (plan && plan.endDate || '') + '"></div>' +
      '</div>' +
      '<hr style="border:none;border-top:1px solid var(--border);margin:.8rem 0">' +
      '<div class="ce-row"><label>容納上限</label><input type="number" id="edu-cp-capacity" min="1" max="999" placeholder="不填則不限人數" value="' + (plan && plan.maxCapacity || '') + '">' +
        '<div style="font-size:.72rem;color:var(--text-muted);margin-top:.15rem">不填則不限制報名人數</div></div>' +
      '<div class="ce-row"><label>課程價格（元）</label><input type="number" id="edu-cp-price" min="0" placeholder="選填，僅供顯示" value="' + (plan && plan.price || '') + '">' +
        '<div style="font-size:.72rem;color:var(--text-muted);margin-top:.15rem">僅供顯示與繳費記錄，不含線上付款功能</div></div>' +
      '<div style="display:flex;gap:.5rem;margin-top:1rem">' +
        '<button class="outline-btn" onclick="App.goBack()">取消</button>' +
        '<button class="primary-btn" id="edu-cp-save-btn" onclick="App.handleSaveEduCoursePlan()">' + (planId ? '儲存變更' : '建立方案') + '</button>' +
      '</div>' +
    '</div>';
    this._verifyEduCoursePlanRenderedFields?.(container, 'v1');
    return { ok: true };
  },

  _getEduCoursePlanSaveFieldIds(planType) {
    const ids = [
      'edu-cp-name',
      'edu-cp-group',
      'edu-cp-type',
      'edu-cp-signup',
      'edu-cp-capacity',
      'edu-cp-price',
      'edu-cp-category-tags',
      'edu-cp-level-label',
      'edu-cp-feature-tags',
      'edu-cp-requirement-tags',
      'edu-cp-included-tags',
      'edu-cp-target-tags',
      'edu-cp-signup-deadline',
      'edu-cp-manager-name',
      'edu-cp-manager-contact',
      'edu-cp-coach-name',
      'edu-cp-location',
      'edu-cp-course-content',
      'edu-cp-cancellation-policy',
      'edu-cp-description',
      'edu-cp-featured',
      'edu-cp-start',
      'edu-cp-end',
    ];
    ids.push(planType === 'session' ? 'edu-cp-total' : 'edu-cp-timeslot');
    return ids;
  },

  _getEduCoursePlanOptionalFieldIds() {
    return [
      'edu-cp-visible-on-team',
      'edu-cp-makeup-policy',
      'edu-cp-payment-method',
      'edu-cp-payment-deadline',
      'edu-cp-notify-targets',
      'edu-cp-trial-info',
      'edu-cp-min-capacity',
      'edu-cp-min-age',
      'edu-cp-max-age',
      'edu-cp-gender',
    ];
  },

  _verifyEduCoursePlanRenderedFields(container, variant) {
    if (!container || typeof container.querySelector !== 'function') return true;
    const ids = [
      ...this._getEduCoursePlanSaveFieldIds('weekly'),
      ...(variant === 'v2' ? this._getEduCoursePlanOptionalFieldIds() : []),
      'edu-cp-total',
      'edu-cp-weekly',
      'edu-cp-session',
      'edu-cp-weekdays',
    ];
    const missing = Array.from(new Set(ids)).filter(id => !container.querySelector('#' + id));
    if (!missing.length) return true;
    const saveBtn = container.querySelector('#edu-cp-save-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.title = '表單欄位載入不完整，請重新開啟';
    }
    console.error('[edu-course-plan] form field check failed:', { variant, missing });
    if (typeof ApiService !== 'undefined' && typeof ApiService._writeErrorLog === 'function') ApiService._writeErrorLog({
      fn: 'showEduCoursePlanForm',
      reason: 'course_plan_form_missing_fields',
      variant,
      missing,
      errorCategory: 'ui_fallback',
      noise: true,
    }, new Error('course plan form missing fields'));
    return false;
  },

  _validateEduCoursePlanSaveFields() {
    const planType = document.getElementById('edu-cp-type')?.value || 'weekly';
    const missing = this._getEduCoursePlanSaveFieldIds(planType)
      .filter(id => !document.getElementById(id));
    if (!missing.length) return true;
    const saveBtn = document.getElementById('edu-cp-save-btn');
    if (saveBtn) saveBtn.disabled = true;
    console.error('[edu-course-plan] save blocked: missing fields', missing);
    this.showToast('表單欄位載入不完整，請重新開啟');
    if (typeof ApiService !== 'undefined' && typeof ApiService._writeErrorLog === 'function') ApiService._writeErrorLog({
      fn: 'handleSaveEduCoursePlan',
      reason: 'course_plan_save_missing_fields',
      missing,
      errorCategory: 'ui_fallback',
      noise: true,
    }, new Error('course plan save missing fields'));
    return false;
  },

  collapseEduCoursePlanSections() {
    document.querySelectorAll('.edu-cp-form-v2 details[open]').forEach(section => {
      section.removeAttribute('open');
    });
    this._syncEduCoursePlanFormFillBadges?.();
  },

  _eduCpCoverDataUrl: null,
  _onEduCpCoverChange(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (typeof this.showImageCropper === 'function') {
      const reader = new FileReader();
      reader.onload = () => {
        this.showImageCropper(reader.result, {
          aspectRatio: 8/3,
          outputWidth: 1200,
          onConfirm: (croppedDataUrl) => {
            this._eduCpCoverDataUrl = croppedDataUrl;
            const preview = document.getElementById('edu-cp-cover-preview');
            if (preview) preview.innerHTML = '<img src="' + croppedDataUrl + '">';
          },
          onCancel: () => { input.value = ''; },
        });
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        this._eduCpCoverDataUrl = reader.result;
        const preview = document.getElementById('edu-cp-cover-preview');
        if (preview) preview.innerHTML = '<img src="' + reader.result + '">';
      };
      reader.readAsDataURL(file);
    }
  },

  _toggleWeekdayCell(cell) {
    const isChecked = cell.classList.toggle('edu-wd-checked');
    cell.querySelector('.edu-wd-check').textContent = isChecked ? '✓' : '';
    this._updateCoursePlanPreview();
  },

  _updateCoursePlanPreview() {
    const previewEl = document.getElementById('edu-cp-preview');
    if (!previewEl) return;
    const cells = document.querySelectorAll('#edu-cp-weekdays .edu-wd-checked');
    const weekdays = Array.from(cells).map(c => parseInt(c.dataset.day, 10));
    const startDate = document.getElementById('edu-cp-start').value;
    const endDate = document.getElementById('edu-cp-end').value;

    if (!weekdays.length || !startDate || !endDate) {
      previewEl.innerHTML = '';
      return;
    }

    const dayNames = weekdays.map(d => '週' + this._weekdayLabel(d)).join('、');
    const totalDates = this.generateWeeklyDates({ weekdays, startDate, endDate });

    previewEl.innerHTML = '每' + dayNames + '上課，總計 <strong>' + totalDates.length + '</strong> 堂課';
  },
  _toggleCoursePlanType(type) {
    const weeklyEl = document.getElementById('edu-cp-weekly');
    const sessionEl = document.getElementById('edu-cp-session');
    if (weeklyEl) weeklyEl.style.display = type === 'weekly' ? '' : 'none';
    if (sessionEl) sessionEl.style.display = type === 'session' ? '' : 'none';
  },

  _getEduCpTagList(inputId) {
    const raw = document.getElementById(inputId)?.value || '';
    return raw.split(/[,\u3001]/)
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  },

  async handleSaveEduCoursePlan() {
    const _btnState = this._setEduBtnLoading('#edu-cp-save-btn');
    if (!this._validateEduCoursePlanSaveFields?.()) { _btnState.restore(); return; }
    const teamId = this._eduCoursePlanEditTeamId;
    const planId = this._eduCoursePlanEditId;
    const name = document.getElementById('edu-cp-name').value.trim();
    if (!name) { _btnState.restore(); this.showToast('請輸入方案名稱'); return; }

    const groupSelect = document.getElementById('edu-cp-group');
    const groupId = groupSelect ? groupSelect.value : '';
    const groupName = groupSelect ? (groupSelect.selectedOptions[0]?.dataset?.name || '') : '';
    const planType = document.getElementById('edu-cp-type').value;

    const allowSignup = document.getElementById('edu-cp-signup')?.checked || false;
    const capRaw = document.getElementById('edu-cp-capacity')?.value;
    const maxCapacity = capRaw ? parseInt(capRaw, 10) : null;
    const priceRaw = document.getElementById('edu-cp-price')?.value;
    const price = priceRaw ? parseInt(priceRaw, 10) : null;
    const optionalText = (id, max = 120) => (document.getElementById(id)?.value || '').trim().slice(0, max);
    const optionalNumber = (id) => {
      const el = document.getElementById(id);
      if (!el) return undefined;
      const raw = String(el.value || '').trim();
      if (!raw) return null;
      const value = parseInt(raw, 10);
      return Number.isFinite(value) ? value : null;
    };
    const assignOptionalText = (key, id, max) => {
      if (document.getElementById(id)) data[key] = optionalText(id, max);
    };
    const assignOptionalNumber = (key, id) => {
      const value = optionalNumber(id);
      if (value !== undefined) data[key] = value;
    };
    const courseContent = optionalText('edu-cp-course-content', 900);
    const descriptionText = optionalText('edu-cp-description', 500);

    const data = {
      name,
      groupId,
      groupName,
      planType,
      allowSignup,
      maxCapacity,
      price,
      categoryTags: this._getEduCpTagList('edu-cp-category-tags'),
      levelLabel: optionalText('edu-cp-level-label', 20),
      featureTags: this._getEduCpTagList('edu-cp-feature-tags'),
      requirementTags: this._getEduCpTagList('edu-cp-requirement-tags'),
      includedTags: this._getEduCpTagList('edu-cp-included-tags'),
      targetTags: this._getEduCpTagList('edu-cp-target-tags'),
      signupDeadline: optionalText('edu-cp-signup-deadline', 10),
      managerName: optionalText('edu-cp-manager-name', 30),
      managerContact: optionalText('edu-cp-manager-contact', 160),
      coachName: optionalText('edu-cp-coach-name', 30),
      location: optionalText('edu-cp-location', 80),
      courseContent,
      cancellationPolicy: optionalText('edu-cp-cancellation-policy', 500),
      description: descriptionText || courseContent.slice(0, 500),
      featured: !!document.getElementById('edu-cp-featured')?.checked,
    };

    const visibleToggle = document.getElementById('edu-cp-visible-on-team');
    if (visibleToggle) data.visibleOnTeamPage = !!visibleToggle.checked;
    assignOptionalText('makeupPolicy', 'edu-cp-makeup-policy', 500);
    assignOptionalText('paymentMethod', 'edu-cp-payment-method', 300);
    assignOptionalText('paymentDeadline', 'edu-cp-payment-deadline', 60);
    assignOptionalText('notifyTargets', 'edu-cp-notify-targets', 200);
    assignOptionalText('trialSessionInfo', 'edu-cp-trial-info', 300);
    assignOptionalNumber('minCapacity', 'edu-cp-min-capacity');
    assignOptionalNumber('minAge', 'edu-cp-min-age');
    assignOptionalNumber('maxAge', 'edu-cp-max-age');
    const genderEl = document.getElementById('edu-cp-gender');
    if (genderEl) {
      const rawGender = String(genderEl.value || 'none');
      data.genderRestriction = ['male', 'female'].includes(rawGender) ? rawGender : 'none';
    }
    if (data.minAge != null && data.maxAge != null && data.minAge > data.maxAge) {
      _btnState.restore();
      this.showToast('年齡限制的最小年齡不能大於最大年齡');
      return;
    }

    // 共用日期欄位（兩種類型都有）
    data.startDate = document.getElementById('edu-cp-start').value || '';
    data.endDate = document.getElementById('edu-cp-end').value || '';

    if (planType === 'weekly') {
      const weekdayCells = document.querySelectorAll('#edu-cp-weekdays .edu-wd-checked');
      data.weekdays = Array.from(weekdayCells).map(c => parseInt(c.dataset.day, 10));
      data.timeSlot = document.getElementById('edu-cp-timeslot').value.trim();
      data.totalSessions = null;
      if (!data.weekdays.length) { _btnState.restore(); this.showToast('請選擇上課日'); return; }
      if (!data.startDate || !data.endDate) { _btnState.restore(); this.showToast('請設定開始和結束日期'); return; }
    } else {
      const total = parseInt(document.getElementById('edu-cp-total').value, 10);
      if (!total || total < 1) { _btnState.restore(); this.showToast('請輸入有效堂數'); return; }
      data.totalSessions = total;
      data.weekdays = null;
      data.timeSlot = null;
    }

    // 封面圖片上傳
    if (this._eduCpCoverDataUrl) {
      data.coverImage = this._eduCpCoverDataUrl;
      this._eduCpCoverDataUrl = null;
    }

    try {
      if (planId) {
        await FirebaseService.updateEduCoursePlan(teamId, planId, data);
        const cached = this._eduCoursePlansCache[teamId];
        if (cached) {
          const existing = cached.find(p => p.id === planId);
          if (existing) Object.assign(existing, data);
        }
        this.showToast('課程方案已更新');
      } else {
        data.id = this._generateEduId('cp');
        data.active = true;
        data.currentCount = 0;
        const result = await FirebaseService.createEduCoursePlan(teamId, data);
        const cached = this._eduCoursePlansCache[teamId];
        if (cached) cached.push(result);
        else this._eduCoursePlansCache[teamId] = [result];
        this.showToast('課程方案已建立');
      }
      this.goBack();
      // 返回後即時重繪課程方案列表
      if (this._eduDetailTeamId) {
        this.renderEduCoursePlanList?.(this._eduDetailTeamId);
      }
    } catch (err) {
      console.error('[handleSaveEduCoursePlan]', err);
      this.showToast('儲存失敗：' + (err.message || '請稍後再試'));
    } finally {
      _btnState.restore();
    }
  },
  async deleteEduCoursePlan(teamId, planId) {
    const confirmText = prompt('此操作無法復原。請輸入「我確定刪除」以確認刪除：');
    if (confirmText !== '我確定刪除') { if (confirmText !== null) this.showToast('輸入不正確，取消刪除'); return; }
    try {
      await FirebaseService.deleteEduCoursePlan(teamId, planId);
      const cached = this._eduCoursePlansCache[teamId];
      if (cached) {
        const idx = cached.findIndex(p => p.id === planId);
        if (idx !== -1) cached.splice(idx, 1);
      }
      this.showToast('課程方案已刪除');
      await this.renderEduCoursePlanList(teamId);
    } catch (err) {
      console.error('[deleteEduCoursePlan]', err);
      this.showToast('刪除失敗');
    }
  },

  // ── 排序功能 ──
  async _moveCoursePlan(teamId, planId, direction) {
    const cached = this._eduCoursePlansCache[teamId];
    if (!cached) return;
    const today = new Date().toISOString().slice(0, 10);
    const isPlanEnded = (plan) => !!(plan && plan.endDate && plan.endDate < today);
    const selectedTab = this._eduCoursePlanTabByTeam?.[teamId] === 'ended' ? 'ended' : 'active';
    const comparePlans = (a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    };
    const active = cached.filter(p => p.active !== false)
      .filter(p => selectedTab === 'ended' ? isPlanEnded(p) : !isPlanEnded(p))
      .sort(comparePlans);
    // 確保每個項目都有 sortOrder
    active.forEach((p, i) => { if (p.sortOrder == null) p.sortOrder = i * 10; });
    const idx = active.findIndex(p => p.id === planId);
    if (idx === -1) return;

    if (direction === 0) {
      if (active[idx].pinned) {
        active[idx].pinned = false;
        active[idx].sortOrder = Math.max(...active.map(p => p.sortOrder || 0)) + 10;
        FirebaseService.updateEduCoursePlan(teamId, planId, { pinned: false, sortOrder: active[idx].sortOrder }).catch(() => {});
        this.showToast('已取消置頂'); await this.renderEduCoursePlanList(teamId); return;
      }
      active[idx].pinned = true;
      active[idx].sortOrder = Math.min(...active.map(p => p.sortOrder || 0)) - 10;
    } else {
      const ti = idx + direction;
      if (ti < 0 || ti >= active.length) return;
      const tmp = active[idx].sortOrder; active[idx].sortOrder = active[ti].sortOrder; active[ti].sortOrder = tmp;
    }
    for (const p of active) { var u = { sortOrder: p.sortOrder }; if (direction === 0) u.pinned = !!p.pinned; FirebaseService.updateEduCoursePlan(teamId, p.id, u).catch(() => {}); }
    this.showToast(direction === 0 ? '已置頂' : '已排序');
    await this.renderEduCoursePlanList(teamId);
  },
});
