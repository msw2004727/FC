/* ================================================
   SportHub — Education: Course Plan Form V2
   ================================================ */

Object.assign(App, {
  _renderEduCoursePlanFormV2(ctx) {
    const {
      container,
      plan,
      planId,
      groupOptions,
      isWeekly,
      tagsValue,
      fieldValue,
      courseContentValue,
      cancellationPolicyValue,
    } = ctx || {};
    if (!container) return;

    const valueOf = (key) => escapeHTML(plan?.[key] ?? '');
    const numericValue = (key) => plan?.[key] == null ? '' : escapeHTML(String(plan[key]));
    const sectionBadge = (ids) => '<span class="edu-cp-fill-badge" data-fill-ids="' + ids.join(',') + '">已填 0 / ' + ids.length + '</span>';
    const row = (label, html, className = '') => '<div class="ce-row ' + className + '"><label>' + label + '</label>' + html + '</div>';
    const hint = (text) => '<div class="edu-cp-field-hint">' + text + '</div>';
    const genderValue = ['male', 'female'].includes(String(plan?.genderRestriction || '')) ? String(plan.genderRestriction) : 'none';
    const genderSelected = (value) => genderValue === value ? ' selected' : '';
    const visibleChecked = !plan || plan.visibleOnTeamPage !== false ? ' checked' : '';
    const paymentMethodHtml = typeof this._buildCoursePlanPaymentMethodField === 'function'
      ? this._buildCoursePlanPaymentMethodField(plan?.paymentMethod || '')
      : '<textarea id="edu-cp-payment-method" maxlength="300" rows="2" placeholder="例如 轉帳、現金、LINE Pay，請填寫付款資訊與備註">' + valueOf('paymentMethod') + '</textarea>';
    const normalizeSchedules = typeof this._normalizeCoursePlanSessionSchedules === 'function'
      ? (value) => this._normalizeCoursePlanSessionSchedules(value)
      : (value) => (Array.isArray(value) ? value : []).map(item => ({
          date: String(item?.date || '').trim(),
          startTime: String(item?.startTime || '').trim(),
          endTime: String(item?.endTime || '').trim(),
        }));
    this._eduCoursePlanSessionScheduleDraft = normalizeSchedules(plan?.sessionSchedules);

    const weekdayHtml = ['一','二','三','四','五','六','日'].map((label, idx) => {
      const dayVal = idx < 6 ? idx + 1 : 0;
      const checked = Array.isArray(plan?.weekdays) && plan.weekdays.includes(dayVal);
      const bgClass = dayVal === 6 ? ' edu-wd-sat' : dayVal === 0 ? ' edu-wd-sun' : '';
      return '<div class="edu-wd-cell' + bgClass + (checked ? ' edu-wd-checked' : '') + '" data-day="' + dayVal + '" onclick="App._toggleWeekdayCell(this)">'
        + '<span class="edu-wd-label">' + label + '</span>'
        + '<span class="edu-wd-check">' + (checked ? '✓' : '') + '</span>'
        + '</div>';
    }).join('');

    container.innerHTML = '<div class="ce-form edu-cp-form-v2">' +
      '<div class="edu-cp-form-head">' +
        '<div><div class="edu-cp-form-kicker">課程方案</div><h3>' + (planId ? '編輯課程' : '建立課程') + '</h3></div>' +
        '<div class="edu-cp-form-head-actions">' +
          '<button type="button" class="outline-btn small" onclick="App.expandEduCoursePlanSections()">全部展開</button>' +
          '<button type="button" class="outline-btn small" onclick="App.collapseEduCoursePlanSections()">全部收起</button>' +
        '</div>' +
      '</div>' +

      '<section class="edu-cp-section edu-cp-core">' +
        '<div class="edu-cp-section-title"><span>核心設定</span><small>儲存前必看的主要資訊</small></div>' +
        row('方案名稱 <span class="required">*必填</span>', '<input type="text" id="edu-cp-name" maxlength="30" placeholder="例：2026 春季班" value="' + valueOf('name') + '">') +
        '<div class="edu-cp-two-col">' +
          row('對應分組', '<select id="edu-cp-group"><option value="">不綁定分組</option>' + (groupOptions || '') + '</select>') +
          row('方案類型', '<select id="edu-cp-type" onchange="App._toggleCoursePlanType(this.value)"><option value="weekly"' + (isWeekly ? ' selected' : '') + '>固定週期</option><option value="session"' + (!isWeekly ? ' selected' : '') + '>堂數制</option></select>') +
        '</div>' +
        '<div id="edu-cp-weekly"' + (isWeekly ? '' : ' style="display:none"') + '>' +
          row('上課日 <span class="required">*必填</span>', '<div id="edu-cp-weekdays" class="edu-weekday-grid">' + weekdayHtml + '</div>') +
          row('時段', '<input type="text" id="edu-cp-timeslot" maxlength="20" placeholder="09:00-10:30" value="' + valueOf('timeSlot') + '"><div id="edu-cp-preview" class="edu-cp-preview"></div>') +
        '</div>' +
        '<div id="edu-cp-session"' + (!isWeekly ? '' : ' style="display:none"') + '>' +
          row('總堂數 <span class="required">*必填</span>', '<input type="number" id="edu-cp-total" min="1" max="999" value="' + numericValue('totalSessions') + '" oninput="App._renderCoursePlanSessionScheduleFields()" onchange="App._renderCoursePlanSessionScheduleFields()">') +
          '<div class="edu-cp-session-schedule-list" id="edu-cp-session-schedule-list"></div>' +
        '</div>' +
        '<div class="edu-cp-two-col">' +
          row('課程開始日期', '<input type="date" id="edu-cp-start" value="' + valueOf('startDate') + '" onchange="App._renderCoursePlanSessionScheduleFields()">') +
          row('課程結束日期', '<input type="date" id="edu-cp-end" value="' + valueOf('endDate') + '" onchange="App._renderCoursePlanSessionScheduleFields()">') +
        '</div>' +
        '<div class="edu-cp-two-col">' +
          row('容納上限', '<input type="number" id="edu-cp-capacity" min="1" max="999" placeholder="不填則不限人數" value="' + numericValue('maxCapacity') + '">' + hint('不填則不限制報名人數')) +
          row('課程價格（元）', '<input type="number" id="edu-cp-price" min="0" placeholder="選填，僅供顯示" value="' + numericValue('price') + '">' + hint('僅供顯示與繳費記錄，不含線上付款功能')) +
        '</div>' +
        '<div class="edu-cp-toggle-row">' +
          '<div><label>開放學員報名</label><small>開啟後學員可在俱樂部頁面自助報名此方案</small></div>' +
          '<label class="toggle-switch"><input type="checkbox" id="edu-cp-signup"' + (plan?.allowSignup ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
        '</div>' +
        '<div class="edu-cp-toggle-row">' +
          '<div><label>在俱樂部頁公開顯示</label><small>關閉後一般使用者不會在課程清單看到，職員仍可管理。</small></div>' +
          '<label class="toggle-switch"><input type="checkbox" id="edu-cp-visible-on-team"' + visibleChecked + '><span class="toggle-slider"></span></label>' +
        '</div>' +
      '</section>' +

      '<details class="edu-cp-section edu-cp-advanced-section">' +
        '<summary><span>公開呈現</span>' + sectionBadge(['edu-cp-cover-preview','edu-cp-description','edu-cp-category-tags','edu-cp-level-label','edu-cp-feature-tags','edu-cp-featured']) + '</summary>' +
        row('封面圖片', '<input type="file" id="edu-cp-cover-input" accept="image/*" hidden onchange="App._onEduCpCoverChange(this)"><div id="edu-cp-cover-preview" class="edu-cp-cover-upload" onclick="document.getElementById(\'edu-cp-cover-input\').click()">' + (plan?.coverImage ? '<img src="' + escapeHTML(plan.coverImage) + '">' : '<span>點擊上傳封面圖片</span>') + '</div>') +
        row('課程說明（卡片摘要）', '<textarea id="edu-cp-description" maxlength="500" rows="2" placeholder="補充課程目標、注意事項或適合對象">' + (fieldValue ? fieldValue('description') : '') + '</textarea>') +
        '<div class="edu-cp-extra-grid">' +
          row('課程分類', '<input type="text" id="edu-cp-category-tags" maxlength="80" placeholder="例：固定課, 入門" value="' + escapeHTML(tagsValue ? tagsValue('categoryTags') : '') + '">') +
          row('程度標籤', '<input type="text" id="edu-cp-level-label" maxlength="20" placeholder="例：純新手or會傳接球" value="' + (fieldValue ? fieldValue('levelLabel') : '') + '">') +
          row('課程亮點', '<input type="text" id="edu-cp-feature-tags" maxlength="120" placeholder="例：小班制, 專項訓練" value="' + escapeHTML(tagsValue ? tagsValue('featureTags') : '') + '">') +
          '<div class="ce-row edu-cp-extra-featured"><label><span class="edu-cp-featured-icon">★</span>精選顯示</label><label class="toggle-switch"><input type="checkbox" id="edu-cp-featured"' + (plan?.featured ? ' checked' : '') + '><span class="toggle-slider"></span></label></div>' +
        '</div>' +
      '</details>' +

      '<details class="edu-cp-section edu-cp-advanced-section">' +
        '<summary><span>報名資訊</span>' + sectionBadge(['edu-cp-signup-deadline','edu-cp-min-capacity','edu-cp-min-age','edu-cp-max-age','edu-cp-gender','edu-cp-trial-info','edu-cp-requirement-tags','edu-cp-included-tags','edu-cp-target-tags']) + '</summary>' +
        '<div class="edu-cp-extra-grid">' +
          row('報名截止日', '<input type="date" id="edu-cp-signup-deadline" value="' + (fieldValue ? fieldValue('signupDeadline') : '') + '">') +
          row('最低開班人數', '<input type="number" id="edu-cp-min-capacity" min="1" max="999" placeholder="例如 6" value="' + numericValue('minCapacity') + '">' + hint('只作為資訊提醒，不會自動阻擋報名。')) +
          row('年齡限制', '<div class="edu-cp-range-row"><input type="number" id="edu-cp-min-age" min="0" max="99" placeholder="最小" value="' + numericValue('minAge') + '"><span>到</span><input type="number" id="edu-cp-max-age" min="0" max="99" placeholder="最大" value="' + numericValue('maxAge') + '"></div>' + hint('目前只顯示提醒，不自動判斷資格。')) +
          row('性別限制', '<select id="edu-cp-gender"><option value="none"' + genderSelected('none') + '>不限</option><option value="male"' + genderSelected('male') + '>限男性</option><option value="female"' + genderSelected('female') + '>限女性</option></select>' + hint('目前只顯示提醒，不自動阻擋報名。')) +
          row('試上說明', '<input type="text" id="edu-cp-trial-info" maxlength="300" placeholder="例如可預約一次試上，需先私訊確認" value="' + valueOf('trialSessionInfo') + '">') +
          row('報名要求', '<input type="text" id="edu-cp-requirement-tags" maxlength="120" placeholder="例：需自備球鞋" value="' + escapeHTML(tagsValue ? tagsValue('requirementTags') : '') + '">') +
          row('費用包含', '<input type="text" id="edu-cp-included-tags" maxlength="120" placeholder="例：場地, 教練費" value="' + escapeHTML(tagsValue ? tagsValue('includedTags') : '') + '">') +
          row('適合對象', '<input type="text" id="edu-cp-target-tags" maxlength="120" placeholder="例：新手, 親子" value="' + escapeHTML(tagsValue ? tagsValue('targetTags') : '') + '">') +
        '</div>' +
      '</details>' +

      '<details class="edu-cp-section edu-cp-advanced-section">' +
        '<summary><span>聯絡與場地</span>' + sectionBadge(['edu-cp-manager-name','edu-cp-manager-contact','edu-cp-notify-targets','edu-cp-coach-name','edu-cp-location']) + '</summary>' +
        '<div class="edu-cp-extra-grid">' +
          row('負責人', '<div class="edu-session-staff-field edu-cp-staff-field"><input type="text" id="edu-cp-manager-name" maxlength="30" placeholder="輸入姓名或暱稱搜尋" value="' + (fieldValue ? fieldValue('managerName') : '') + '" oninput="App.searchCoursePlanStaff(\'manager\')" onfocus="App.searchCoursePlanStaff(\'manager\')"><div id="edu-cp-manager-suggest" class="team-user-suggest edu-session-staff-suggest"></div></div>') +
          row('負責人聯繫', '<input type="text" id="edu-cp-manager-contact" maxlength="160" placeholder="例：LINE ID / 電話 / 聯繫連結" value="' + (fieldValue ? fieldValue('managerContact') : '') + '">') +
          row('報名通知對象', '<input type="text" id="edu-cp-notify-targets" maxlength="200" placeholder="例如 課務群組、王教練、櫃台" value="' + valueOf('notifyTargets') + '">') +
          row('授課教練', '<div class="edu-session-staff-field edu-cp-staff-field"><input type="text" id="edu-cp-coach-name" maxlength="30" placeholder="輸入姓名或暱稱搜尋" value="' + (fieldValue ? fieldValue('coachName') : '') + '" oninput="App.searchCoursePlanStaff(\'coach\')" onfocus="App.searchCoursePlanStaff(\'coach\')"><div id="edu-cp-coach-suggest" class="team-user-suggest edu-session-staff-suggest"></div></div>') +
          row('上課地點', '<input type="text" id="edu-cp-location" maxlength="80" placeholder="例：台中市南屯運動中心" value="' + (fieldValue ? fieldValue('location') : '') + '">') +
        '</div>' +
      '</details>' +

      '<details class="edu-cp-section edu-cp-advanced-section">' +
        '<summary><span>詳細說明</span>' + sectionBadge(['edu-cp-course-content','edu-cp-payment-method','edu-cp-payment-deadline','edu-cp-makeup-policy','edu-cp-cancellation-policy']) + '</summary>' +
        row('課程內容', '<textarea id="edu-cp-course-content" maxlength="900" rows="4" placeholder="介紹課程主軸、訓練內容、適合程度與學習目標">' + (courseContentValue || '') + '</textarea>') +
        row('付款方式', paymentMethodHtml, 'edu-cp-payment-method-row') +
        row('付款期限', '<input type="text" id="edu-cp-payment-deadline" maxlength="60" placeholder="例如 報名後 3 日內 / 開課前完成" value="' + valueOf('paymentDeadline') + '">') +
        row('補課規則', '<textarea id="edu-cp-makeup-policy" maxlength="500" rows="3" placeholder="例如 請假需提前告知，可於同級班補課一次">' + valueOf('makeupPolicy') + '</textarea>') +
        row('取消政策', '<textarea id="edu-cp-cancellation-policy" maxlength="500" rows="3" placeholder="例：開課前 7 日可全額退費；開課前 3 日內取消，將收取 30% 行政費；開課後恕不退費。">' + (cancellationPolicyValue || '') + '</textarea>') +
        '<div class="edu-cp-extra-hint">標籤請用逗號分隔；這些欄位會先用於卡片與詳情顯示，不會改變報名流程。</div>' +
      '</details>' +

      '<section class="edu-cp-section edu-cp-template-section">' +
        '<div class="ce-row edu-session-template-panel">' +
          '<div class="ce-label-row"><label>從範本建立</label></div>' +
          '<div class="edu-session-template-list" id="edu-cp-template-selector"><span>載入範本中...</span></div>' +
        '</div>' +
        '<div class="ce-row edu-session-template-save-row"><label>儲存為範本</label><div class="edu-session-template-save"><input id="edu-cp-template-name" type="text" maxlength="24" placeholder="範本名稱"><button class="outline-btn small" type="button" onclick="App._saveCoursePlanTemplate()">儲存</button></div></div>' +
      '</section>' +

      '<div class="edu-cp-form-actions">' +
        '<button class="outline-btn" onclick="App.goBack()">取消</button>' +
        '<button class="primary-btn" id="edu-cp-save-btn" onclick="App.handleSaveEduCoursePlan()">' + (planId ? '儲存變更' : '建立方案') + '</button>' +
      '</div>' +
    '</div>';

    this._updateCoursePlanPreview?.();
    this._renderCoursePlanSessionScheduleFields?.();
    this._syncEduCoursePlanPaymentMethodField?.();
    this._renderCoursePlanTemplateSelector?.();
    this._ensureCoursePlanTemplatesReady?.();
  },

  _syncEduCoursePlanFormFillBadges() {
    const form = document.querySelector?.('.edu-cp-form-v2');
    if (!form) return;
    if (!form.dataset.badgesBound) {
      form.dataset.badgesBound = '1';
      form.addEventListener('input', () => this._syncEduCoursePlanFormFillBadges());
      form.addEventListener('change', () => this._syncEduCoursePlanFormFillBadges());
      form.addEventListener('toggle', () => this._syncEduCoursePlanFormFillBadges(), true);
    }
    form.querySelectorAll('[data-fill-ids]').forEach(badge => {
      const ids = (badge.dataset.fillIds || '').split(',').filter(Boolean);
      const filled = ids.filter(id => this._isEduCoursePlanFieldFilled(id)).length;
      badge.textContent = '已填 ' + filled + ' / ' + ids.length;
      badge.classList.toggle('has-content', filled > 0);
    });
  },

  _isEduCoursePlanFieldFilled(id) {
    if (id === 'edu-cp-cover-preview') {
      return !!document.getElementById(id)?.querySelector?.('img');
    }
    const el = document.getElementById(id);
    if (!el) return false;
    if (el.type === 'checkbox') return !!el.checked;
    if (id === 'edu-cp-gender') return el.value !== 'none';
    return !!String(el.value || '').trim();
  },
});
