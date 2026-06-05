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
        '<button type="button" class="outline-btn small" onclick="App.collapseEduCoursePlanSections()">全部收起</button>' +
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
          row('總堂數 <span class="required">*必填</span>', '<input type="number" id="edu-cp-total" min="1" max="999" value="' + numericValue('totalSessions') + '">') +
        '</div>' +
        '<div class="edu-cp-two-col">' +
          row('課程開始日期', '<input type="date" id="edu-cp-start" value="' + valueOf('startDate') + '">') +
          row('課程結束日期', '<input type="date" id="edu-cp-end" value="' + valueOf('endDate') + '">') +
        '</div>' +
        '<div class="edu-cp-two-col">' +
          row('容納上限', '<input type="number" id="edu-cp-capacity" min="1" max="999" placeholder="不填則不限人數" value="' + numericValue('maxCapacity') + '">' + hint('不填則不限制報名人數')) +
          row('課程價格（元）', '<input type="number" id="edu-cp-price" min="0" placeholder="選填，僅供顯示" value="' + numericValue('price') + '">' + hint('僅供顯示與繳費記錄，不含線上付款功能')) +
        '</div>' +
        '<div class="edu-cp-toggle-row">' +
          '<div><label>開放學員報名</label><small>開啟後學員可在俱樂部頁面自助報名此方案</small></div>' +
          '<label class="toggle-switch"><input type="checkbox" id="edu-cp-signup"' + (plan?.allowSignup ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
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
          '<div class="ce-row edu-cp-extra-featured"><label>精選顯示</label><label class="toggle-switch"><input type="checkbox" id="edu-cp-featured"' + (plan?.featured ? ' checked' : '') + '><span class="toggle-slider"></span></label></div>' +
        '</div>' +
      '</details>' +

      '<details class="edu-cp-section edu-cp-advanced-section">' +
        '<summary><span>報名資訊</span>' + sectionBadge(['edu-cp-signup-deadline','edu-cp-requirement-tags','edu-cp-included-tags','edu-cp-target-tags']) + '</summary>' +
        '<div class="edu-cp-extra-grid">' +
          row('報名截止日', '<input type="date" id="edu-cp-signup-deadline" value="' + (fieldValue ? fieldValue('signupDeadline') : '') + '">') +
          row('報名要求', '<input type="text" id="edu-cp-requirement-tags" maxlength="120" placeholder="例：需自備球鞋" value="' + escapeHTML(tagsValue ? tagsValue('requirementTags') : '') + '">') +
          row('費用包含', '<input type="text" id="edu-cp-included-tags" maxlength="120" placeholder="例：場地, 教練費" value="' + escapeHTML(tagsValue ? tagsValue('includedTags') : '') + '">') +
          row('適合對象', '<input type="text" id="edu-cp-target-tags" maxlength="120" placeholder="例：新手, 親子" value="' + escapeHTML(tagsValue ? tagsValue('targetTags') : '') + '">') +
        '</div>' +
      '</details>' +

      '<details class="edu-cp-section edu-cp-advanced-section">' +
        '<summary><span>聯絡與場地</span>' + sectionBadge(['edu-cp-manager-name','edu-cp-manager-contact','edu-cp-coach-name','edu-cp-location']) + '</summary>' +
        '<div class="edu-cp-extra-grid">' +
          row('負責人', '<input type="text" id="edu-cp-manager-name" maxlength="30" placeholder="例：課務窗口" value="' + (fieldValue ? fieldValue('managerName') : '') + '">') +
          row('負責人聯繫', '<input type="text" id="edu-cp-manager-contact" maxlength="160" placeholder="例：LINE ID / 電話 / 聯繫連結" value="' + (fieldValue ? fieldValue('managerContact') : '') + '">') +
          row('授課教練', '<input type="text" id="edu-cp-coach-name" maxlength="30" placeholder="例：王教練" value="' + (fieldValue ? fieldValue('coachName') : '') + '">') +
          row('上課地點', '<input type="text" id="edu-cp-location" maxlength="80" placeholder="例：台中市南屯運動中心" value="' + (fieldValue ? fieldValue('location') : '') + '">') +
        '</div>' +
      '</details>' +

      '<details class="edu-cp-section edu-cp-advanced-section">' +
        '<summary><span>詳細說明</span>' + sectionBadge(['edu-cp-course-content','edu-cp-cancellation-policy']) + '</summary>' +
        row('課程內容', '<textarea id="edu-cp-course-content" maxlength="900" rows="4" placeholder="介紹課程主軸、訓練內容、適合程度與學習目標">' + (courseContentValue || '') + '</textarea>') +
        row('取消政策', '<textarea id="edu-cp-cancellation-policy" maxlength="500" rows="3" placeholder="例：開課前 7 日可全額退費；開課前 3 日內取消，將收取 30% 行政費；開課後恕不退費。">' + (cancellationPolicyValue || '') + '</textarea>') +
        '<div class="edu-cp-extra-hint">標籤請用逗號分隔；這些欄位會先用於卡片與詳情顯示，不會改變報名流程。</div>' +
      '</details>' +

      '<div class="edu-cp-form-actions">' +
        '<button class="outline-btn" onclick="App.goBack()">取消</button>' +
        '<button class="primary-btn" id="edu-cp-save-btn" onclick="App.handleSaveEduCoursePlan()">' + (planId ? '儲存變更' : '建立方案') + '</button>' +
      '</div>' +
    '</div>';

    this._updateCoursePlanPreview?.();
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
    return !!String(el.value || '').trim();
  },
});
