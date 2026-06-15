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
      // _writeErrorLog 內部硬編 errorCategory/severityHint/noise，外部傳入無效；
      // 改用 err.code 讓 errorLogs.errorCode === 'cp_form_v1_fallback' 可被退場監測 query 篩
      const cpFallbackErr = fallbackError || new Error('course plan form v2 fallback');
      if (!cpFallbackErr.code) cpFallbackErr.code = 'cp_form_v1_fallback';
      if (typeof ApiService !== 'undefined' && typeof ApiService._writeErrorLog === 'function') ApiService._writeErrorLog({
        fn: 'showEduCoursePlanForm',
        reason: 'course_plan_form_v2_fallback',
        flagResolved: true,
      }, cpFallbackErr);
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
          '<div class="ce-row edu-cp-roster-agent-row"><label>負責代理人</label><div class="edu-session-staff-field edu-cp-staff-field edu-cp-agent-field"><input type="text" id="edu-cp-roster-agent-name" maxlength="30" placeholder="搜尋任一用戶，授權管理課堂名單" value="' + fieldValue('rosterAgentName') + '" oninput="App.clearCoursePlanRosterAgentSelection();App.searchCoursePlanStaff(\'agent\')" onfocus="App.searchCoursePlanStaff(\'agent\')"><input type="hidden" id="edu-cp-roster-agent-uid" value="' + fieldValue('rosterAgentUid') + '"><div id="edu-cp-agent-suggest" class="team-user-suggest edu-session-staff-suggest"></div></div><div class="edu-cp-field-hint">指定後該用戶可使用本課程每堂課的「管理名單」，不會取得課程編輯或刪除權限。</div></div>' +
          '<div class="ce-row"><label>授課教練</label><input type="text" id="edu-cp-coach-name" maxlength="30" placeholder="例：王教練" value="' + fieldValue('coachName') + '"></div>' +
          '<div class="ce-row"><label>上課地點</label><input type="text" id="edu-cp-location" maxlength="80" placeholder="例：台中市南屯運動中心" value="' + fieldValue('location') + '"></div>' +
          '<div class="ce-row edu-cp-extra-featured edu-cp-featured-card"><div class="edu-cp-featured-copy"><span class="edu-cp-featured-icon">★</span><div><label for="edu-cp-featured">精選顯示</label><small>開啟後可出現在俱樂部總覽的精選/熱門課程位置，仍會受公開顯示設定影響。</small></div></div><label class="edu-cp-featured-switch" aria-label="精選顯示"><input type="checkbox" id="edu-cp-featured"' + (plan?.featured ? ' checked' : '') + '><span></span></label></div>' +
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
        '<div class="ce-row"><label>總堂數</label><input type="number" id="edu-cp-total" min="1" max="999" value="' + (plan && plan.totalSessions || '') + '" oninput="App._renderCoursePlanSessionScheduleFields()" onchange="App._renderCoursePlanSessionScheduleFields()"></div>' +
        '<div class="edu-cp-session-schedule-list" id="edu-cp-session-schedule-list"></div>' +
      '</div>' +
      '<div class="ce-row" style="display:flex;gap:.5rem">' +
        '<div style="flex:1"><label>課程開始日期</label><input type="date" id="edu-cp-start" value="' + (plan && plan.startDate || '') + '" onchange="App._renderCoursePlanSessionScheduleFields()"></div>' +
        '<div style="flex:1"><label>課程結束日期</label><input type="date" id="edu-cp-end" value="' + (plan && plan.endDate || '') + '" onchange="App._renderCoursePlanSessionScheduleFields()"></div>' +
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
    this._eduCoursePlanSessionScheduleDraft = this._normalizeCoursePlanSessionSchedules?.(plan?.sessionSchedules) || [];
    this._renderCoursePlanSessionScheduleFields?.();
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
      'edu-cp-roster-agent-name',
      'edu-cp-roster-agent-uid',
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
      'edu-cp-roster-agent-name',
      'edu-cp-roster-agent-uid',
      'edu-cp-trial-info',
      'edu-cp-min-capacity',
      'edu-cp-min-age',
      'edu-cp-max-age',
      'edu-cp-gender',
    ];
  },

  _getCoursePlanPaymentOptions() {
    return ['轉帳', '現金', 'LINE Pay', '線上支付', '信用卡', '皆可', ''];
  },

  _splitCoursePlanPaymentMethod(value) {
    const raw = String(value || '').trim();
    if (!raw) return { type: '', note: '' };
    const normalizedRaw = raw.toLowerCase();
    const options = this._getCoursePlanPaymentOptions()
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    for (const option of options) {
      const normalizedOption = option.toLowerCase();
      if (normalizedRaw === normalizedOption) return { type: option, note: '' };
      if (!normalizedRaw.startsWith(normalizedOption)) continue;
      const nextChar = raw.charAt(option.length);
      if (nextChar && !/[\s:：,，/／-]/.test(nextChar)) continue;
      const note = raw.slice(option.length).replace(/^[\s:：,，/／-]+/, '').trim();
      return { type: option, note };
    }
    return { type: '', note: raw };
  },

  _buildCoursePlanPaymentMethodField(value) {
    const parsed = this._splitCoursePlanPaymentMethod(value);
    const optionHtml = this._getCoursePlanPaymentOptions().map(option => {
      const label = option || '空白';
      const selected = parsed.type === option ? ' selected' : '';
      return '<option value="' + escapeHTML(option) + '"' + selected + '>' + escapeHTML(label) + '</option>';
    }).join('');
    const combined = this._composeCoursePlanPaymentMethodValue(parsed.type, parsed.note);
    return '<div class="edu-cp-payment-method-control">'
      + '<select id="edu-cp-payment-method-type" class="edu-cp-payment-type-select" onchange="App._syncEduCoursePlanPaymentMethodField()">'
      + optionHtml
      + '</select>'
      + '<input type="text" id="edu-cp-payment-method-note" maxlength="260" placeholder="補充帳號、連結或備註" value="' + escapeHTML(parsed.note) + '" oninput="App._syncEduCoursePlanPaymentMethodField()">'
      + '<input type="hidden" id="edu-cp-payment-method" value="' + escapeHTML(combined) + '">'
      + '</div>';
  },

  _composeCoursePlanPaymentMethodValue(type, note) {
    const paymentType = String(type || '').trim();
    const paymentNote = String(note || '').trim();
    if (paymentType && paymentNote) return (paymentType + ' ' + paymentNote).slice(0, 300);
    return (paymentType || paymentNote).slice(0, 300);
  },

  _syncEduCoursePlanPaymentMethodField() {
    const hidden = document.getElementById('edu-cp-payment-method');
    if (!hidden) return '';
    hidden.value = this._getEduCoursePlanPaymentMethodValue();
    return hidden.value;
  },

  _getEduCoursePlanPaymentMethodValue() {
    const typeEl = document.getElementById('edu-cp-payment-method-type');
    const noteEl = document.getElementById('edu-cp-payment-method-note');
    if (typeEl || noteEl) {
      return this._composeCoursePlanPaymentMethodValue(typeEl?.value || '', noteEl?.value || '');
    }
    return String(document.getElementById('edu-cp-payment-method')?.value || '').trim().slice(0, 300);
  },

  _getCoursePlanTeamRecord(teamId) {
    if (typeof this._getEduTeamRecord === 'function') return this._getEduTeamRecord(teamId);
    const teams = typeof ApiService !== 'undefined' && ApiService.getTeams ? (ApiService.getTeams() || []) : [];
    return teams.find(t => String(t.id || t._docId || '') === String(teamId)) || null;
  },

  _getCoursePlanStaffUserByUidOrName(uidLike, nameLike, users) {
    const normalize = value => String(value || '').trim();
    const uid = normalize(uidLike);
    const name = normalize(nameLike).toLowerCase();
    const userList = Array.isArray(users) ? users : [];
    if (uid) {
      const found = userList.find(user => [user.uid, user.lineUserId, user._docId, user.id]
        .map(normalize)
        .filter(Boolean)
        .includes(uid));
      if (found) return found;
    }
    if (name) {
      return userList.find(user => this._getCourseStaffSearchAliases(user)
        .map(value => normalize(value).toLowerCase())
        .some(value => value && value === name)) || null;
    }
    return null;
  },

  _getCourseStaffSearchAliases(user) {
    if (!user || typeof user !== 'object') return [];
    return [
      user.displayName,
      user.name,
      user.nickname,
      user.nickName,
      user.alias,
      user.lineDisplayName,
      user.lineName,
      user.lineUserName,
      user.uid,
      user.lineUserId,
      user._docId,
      user.id,
    ].map(value => String(value || '').trim()).filter(Boolean);
  },

  _getCourseStaffContact(user) {
    if (typeof this._getCourseSessionStaffContact === 'function') return this._getCourseSessionStaffContact(user);
    if (!user || typeof user !== 'object') return '';
    const direct = [
      user.contactUrl, user.lineUrl, user.lineLink, user.lineLinkUrl, user.socialUrl, user.website,
      user.phone, user.mobile, user.email,
    ].map(value => String(value || '').trim()).find(Boolean);
    if (direct) return direct;
    const socialLinks = user.socialLinks || {};
    const platformMap = this._socialPlatforms || {
      fb: { prefix: 'https://www.facebook.com/' },
      ig: { prefix: 'https://www.instagram.com/' },
      threads: { prefix: 'https://www.threads.net/@' },
      yt: { prefix: 'https://www.youtube.com/@' },
      twitter: { prefix: 'https://x.com/' },
      line: { prefix: 'https://line.me/ti/p/' },
    };
    for (const key of ['line', 'ig', 'fb', 'threads', 'twitter', 'yt']) {
      const value = String(socialLinks[key] || '').trim();
      if (!value) continue;
      if (/^https?:\/\//i.test(value)) return value;
      const prefix = platformMap[key]?.prefix || '';
      if (prefix) return prefix + encodeURIComponent(value.replace(/^@/, ''));
    }
    return '';
  },

  _buildCourseStaffSearchText(candidate, user) {
    return [
      candidate?.name,
      candidate?.uid,
      candidate?.roleLabel,
      ...(this._getCourseStaffSearchAliases(user) || []),
    ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean).join(' ');
  },

  _matchesCourseStaffCandidate(candidate, query) {
    const rawQuery = String(query || '').trim().toLowerCase();
    if (!rawQuery) return true;
    const compactQuery = rawQuery.replace(/\s+/g, '');
    if (!compactQuery) return true;
    const searchText = String(candidate?.searchText || '').toLowerCase();
    const compactText = searchText.replace(/\s+/g, '');
    if (searchText.includes(rawQuery) || compactText.includes(compactQuery)) return true;
    let textIndex = 0;
    for (const ch of compactQuery) {
      textIndex = compactText.indexOf(ch, textIndex);
      if (textIndex === -1) return false;
      textIndex += 1;
    }
    return true;
  },

  _getCoursePlanStaffCandidates(teamId, kind = 'staff') {
    if (kind === 'agent') {
      const users = typeof ApiService !== 'undefined' && ApiService.getAdminUsers ? [...(ApiService.getAdminUsers() || [])] : [];
      const currentUser = typeof ApiService !== 'undefined' && ApiService.getCurrentUser ? ApiService.getCurrentUser() : null;
      if (currentUser) users.push(currentUser);
      const seen = new Set();
      const normalize = value => String(value || '').trim();
      return users.map(user => {
        const uid = normalize(user?.uid || user?.lineUserId || user?._docId || user?.id);
        const name = normalize(user?.displayName || user?.name || user?.nickname || user?.lineDisplayName || uid);
        if (!uid || !name) return null;
        const key = 'uid:' + uid;
        if (seen.has(key)) return null;
        seen.add(key);
        const roleLabel = normalize(user?.roleLabel || user?.roleName || user?.role || '用戶');
        const candidate = {
          key,
          uid,
          name,
          roleLabel,
          roleRank: 0,
          contact: this._getCourseStaffContact(user),
          searchText: '',
        };
        candidate.searchText = this._buildCourseStaffSearchText(candidate, user);
        return candidate;
      }).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    }
    if (typeof this._getCourseSessionStaffCandidates === 'function') {
      return this._getCourseSessionStaffCandidates(teamId);
    }
    const team = this._getCoursePlanTeamRecord(teamId);
    if (!team) return [];
    const users = typeof ApiService !== 'undefined' && ApiService.getAdminUsers ? (ApiService.getAdminUsers() || []) : [];
    const map = new Map();
    const normalize = value => String(value || '').trim();
    const add = (uidLike, nameLike, roleLabel, roleRank) => {
      const user = this._getCoursePlanStaffUserByUidOrName(uidLike, nameLike, users);
      const uid = normalize(user?.uid || user?.lineUserId || uidLike);
      const name = normalize(user?.displayName || user?.name || user?.nickname || nameLike || uid);
      if (!name && !uid) return;
      const key = uid ? 'uid:' + uid : 'name:' + name.toLowerCase();
      const existing = map.get(key);
      const candidate = existing || {
        key,
        uid,
        name,
        roleLabel,
        roleRank,
        contact: this._getCourseStaffContact(user),
        searchText: '',
      };
      if (!existing || roleRank > candidate.roleRank) {
        candidate.roleLabel = roleLabel;
        candidate.roleRank = roleRank;
      }
      candidate.searchText = this._buildCourseStaffSearchText(candidate, user);
      map.set(key, candidate);
    };

    add(team.captainUid, team.captain || team.captainName, '負責人', 3);
    const leaderUids = Array.isArray(team.leaderUids) ? team.leaderUids : (team.leaderUid ? [team.leaderUid] : []);
    const leaderNames = Array.isArray(team.leaderNames) ? team.leaderNames : (Array.isArray(team.leaders) ? team.leaders : (team.leader ? [team.leader] : []));
    leaderUids.forEach((uid, index) => add(uid, leaderNames[index], '領隊', 2));
    leaderNames.forEach(name => add(null, name, '領隊', 2));
    const coachUids = Array.isArray(team.coachUids) ? team.coachUids : [];
    const coachNames = Array.isArray(team.coachNames) ? team.coachNames : (Array.isArray(team.coaches) ? team.coaches : []);
    coachUids.forEach((uid, index) => add(uid, coachNames[index], '教練', 1));
    coachNames.forEach(name => add(null, name, '教練', 1));

    return Array.from(map.values())
      .filter(item => item.roleRank >= 1)
      .sort((a, b) => b.roleRank - a.roleRank || a.name.localeCompare(b.name, 'zh-Hant'));
  },

  _renderCoursePlanStaffSuggestList(kind, results) {
    const container = document.getElementById('edu-cp-' + kind + '-suggest');
    if (!container) return;
    if (!results.length) {
      container.innerHTML = '';
      container.classList.remove('show');
      return;
    }
    container.innerHTML = results.map(item => {
      const role = item.roleLabel ? '<span class="tus-uid">' + escapeHTML(item.roleLabel) + '</span>' : '';
      return '<div class="team-user-suggest-item" onmousedown="event.preventDefault();App.selectCoursePlanStaff(\'' + kind + '\',\'' + encodeURIComponent(item.key) + '\')">'
        + '<span class="tus-name">' + escapeHTML(item.name) + '</span>'
        + role
        + '</div>';
    }).join('');
    container.classList.add('show');
  },

  clearCoursePlanRosterAgentSelection() {
    const hidden = document.getElementById('edu-cp-roster-agent-uid');
    if (hidden) hidden.value = '';
  },

  searchCoursePlanStaff(kind) {
    const teamId = this._eduCoursePlanEditTeamId;
    if (!teamId) return;
    const inputId = kind === 'agent' ? 'edu-cp-roster-agent-name' : (kind === 'coach' ? 'edu-cp-coach-name' : 'edu-cp-manager-name');
    const query = document.getElementById(inputId)?.value || '';
    const container = document.getElementById('edu-cp-' + kind + '-suggest');
    if (!String(query || '').trim()) {
      if (container) {
        container.innerHTML = '';
        container.classList.remove('show');
      }
      return;
    }
    const results = this._getCoursePlanStaffCandidates(teamId, kind)
      .filter(item => this._matchesCourseStaffCandidate(item, query))
      .slice(0, 6);
    this._renderCoursePlanStaffSuggestList(kind, results);
  },

  selectCoursePlanStaff(kind, encodedKey) {
    const teamId = this._eduCoursePlanEditTeamId;
    const key = decodeURIComponent(encodedKey || '');
    const candidate = this._getCoursePlanStaffCandidates(teamId, kind).find(item => item.key === key);
    if (!candidate) return;
    const inputId = kind === 'agent' ? 'edu-cp-roster-agent-name' : (kind === 'coach' ? 'edu-cp-coach-name' : 'edu-cp-manager-name');
    const input = document.getElementById(inputId);
    if (input) input.value = candidate.name || '';
    if (kind === 'agent') {
      const hidden = document.getElementById('edu-cp-roster-agent-uid');
      if (hidden) hidden.value = candidate.uid || '';
    }
    if (kind === 'manager') {
      const contact = document.getElementById('edu-cp-manager-contact');
      if (contact && candidate.contact && !contact.value.trim()) contact.value = candidate.contact;
    }
    const container = document.getElementById('edu-cp-' + kind + '-suggest');
    if (container) {
      container.innerHTML = '';
      container.classList.remove('show');
    }
    this._syncEduCoursePlanFormFillBadges?.();
  },

  _coursePlanTemplateKey() {
    return 'sporthub_course_plan_templates_' + ModeManager.getMode();
  },

  _getCoursePlanTemplateOwnerUid() {
    const user = ApiService.getCurrentUser?.();
    return String(user?.uid || user?.lineUserId || user?._docId || '').trim();
  },

  _getCoursePlanTemplateOwnerName() {
    const user = ApiService.getCurrentUser?.();
    return String(user?.displayName || user?.name || user?.nickname || '').trim();
  },

  _isCoursePlanCloudTemplateEnabled() {
    return !!this._getCoursePlanTemplateOwnerUid();
  },

  _getCoursePlanTemplatesFromLocal() {
    try {
      const data = JSON.parse(localStorage.getItem(this._coursePlanTemplateKey()) || '[]');
      return Array.isArray(data) ? data.filter(t => t.templateType === 'coursePlan') : [];
    } catch {
      return [];
    }
  },

  _setCoursePlanTemplatesToLocal(templates) {
    localStorage.setItem(this._coursePlanTemplateKey(), JSON.stringify(templates));
  },

  _saveCoursePlanTemplateToLocal(template) {
    let templates = this._getCoursePlanTemplatesFromLocal().filter(t => t.id !== template.id);
    const max = this._MAX_TEMPLATES || 30;
    if (templates.length >= max) return { ok: false, reason: 'limit' };
    templates.unshift({ ...template });
    templates = templates.slice(0, max);
    try {
      this._setCoursePlanTemplatesToLocal(templates);
      return { ok: true, imageDropped: false };
    } catch {
      try {
        const compact = templates.map(t => ({ ...t, coverImage: null }));
        this._setCoursePlanTemplatesToLocal(compact);
        return { ok: true, imageDropped: true };
      } catch {
        return { ok: false, reason: 'quota' };
      }
    }
  },

  _removeCoursePlanTemplateFromLocal(id) {
    try {
      this._setCoursePlanTemplatesToLocal(this._getCoursePlanTemplatesFromLocal().filter(t => String(t.id) !== String(id)));
    } catch {}
  },

  _getCoursePlanTemplates() {
    const isCoursePlan = template => template?.templateType === 'coursePlan';
    if (this._isCoursePlanCloudTemplateEnabled()) {
      const cloud = (ApiService.getEventTemplates?.() || []).filter(isCoursePlan);
      if (cloud.length > 0 || this._templatesLoadedUid === this._getCoursePlanTemplateOwnerUid()) return cloud;
    }
    return this._getCoursePlanTemplatesFromLocal();
  },

  async _ensureCoursePlanTemplatesReady(force = false) {
    if (!this._isCoursePlanCloudTemplateEnabled()) {
      this._renderCoursePlanTemplateSelector();
      return;
    }
    const uid = this._getCoursePlanTemplateOwnerUid();
    if (!uid) return;
    if (!force && this._templatesLoadedUid === uid) {
      this._renderCoursePlanTemplateSelector();
      return;
    }
    try {
      await ApiService.loadMyEventTemplates(uid);
      this._templatesLoadedUid = uid;
    } catch (err) {
      console.warn('[course plan template] load failed, fallback to local:', err);
    }
    this._renderCoursePlanTemplateSelector();
  },

  _getCoursePlanTemplateCoverImage() {
    if (this._eduCpCoverDataUrl) return this._eduCpCoverDataUrl;
    const img = document.getElementById('edu-cp-cover-preview')?.querySelector?.('img');
    return img?.src || null;
  },

  _buildCurrentCoursePlanTemplate(name) {
    const planType = document.getElementById('edu-cp-type')?.value || 'weekly';
    const groupSelect = document.getElementById('edu-cp-group');
    const totalRaw = document.getElementById('edu-cp-total')?.value || '';
    const total = totalRaw ? parseInt(totalRaw, 10) : null;
    const sessionSchedules = planType === 'session' && Number.isFinite(total)
      ? this._readCoursePlanSessionScheduleDraftFromDom(total).map(item => ({
          date: '',
          startTime: item.startTime,
          endTime: item.endTime,
        }))
      : [];
    return {
      id: 'tpl_cp_' + Date.now(),
      name,
      templateType: 'coursePlan',
      planName: document.getElementById('edu-cp-name')?.value.trim() || '',
      groupId: groupSelect?.value || '',
      groupName: groupSelect?.selectedOptions?.[0]?.dataset?.name || '',
      planType,
      allowSignup: !!document.getElementById('edu-cp-signup')?.checked,
      visibleOnTeamPage: !!document.getElementById('edu-cp-visible-on-team')?.checked,
      maxCapacity: (() => {
        const raw = document.getElementById('edu-cp-capacity')?.value || '';
        const value = raw ? parseInt(raw, 10) : null;
        return Number.isFinite(value) ? value : null;
      })(),
      price: (() => {
        const raw = document.getElementById('edu-cp-price')?.value || '';
        const value = raw ? parseInt(raw, 10) : null;
        return Number.isFinite(value) ? value : null;
      })(),
      categoryTags: this._getEduCpTagList('edu-cp-category-tags'),
      levelLabel: document.getElementById('edu-cp-level-label')?.value.trim() || '',
      featureTags: this._getEduCpTagList('edu-cp-feature-tags'),
      requirementTags: this._getEduCpTagList('edu-cp-requirement-tags'),
      includedTags: this._getEduCpTagList('edu-cp-included-tags'),
      targetTags: this._getEduCpTagList('edu-cp-target-tags'),
      managerName: document.getElementById('edu-cp-manager-name')?.value.trim() || '',
      managerContact: document.getElementById('edu-cp-manager-contact')?.value.trim() || '',
      rosterAgentUid: document.getElementById('edu-cp-roster-agent-uid')?.value.trim() || '',
      rosterAgentName: document.getElementById('edu-cp-roster-agent-name')?.value.trim() || '',
      notifyTargets: document.getElementById('edu-cp-notify-targets')?.value.trim() || '',
      coachName: document.getElementById('edu-cp-coach-name')?.value.trim() || '',
      location: document.getElementById('edu-cp-location')?.value.trim() || '',
      courseContent: document.getElementById('edu-cp-course-content')?.value.trim() || '',
      description: document.getElementById('edu-cp-description')?.value.trim() || '',
      paymentMethod: this._getEduCoursePlanPaymentMethodValue(),
      paymentDeadline: document.getElementById('edu-cp-payment-deadline')?.value.trim() || '',
      makeupPolicy: document.getElementById('edu-cp-makeup-policy')?.value.trim() || '',
      cancellationPolicy: document.getElementById('edu-cp-cancellation-policy')?.value.trim() || '',
      trialSessionInfo: document.getElementById('edu-cp-trial-info')?.value.trim() || '',
      minCapacity: (() => {
        const raw = document.getElementById('edu-cp-min-capacity')?.value || '';
        const value = raw ? parseInt(raw, 10) : null;
        return Number.isFinite(value) ? value : null;
      })(),
      minAge: (() => {
        const raw = document.getElementById('edu-cp-min-age')?.value || '';
        const value = raw ? parseInt(raw, 10) : null;
        return Number.isFinite(value) ? value : null;
      })(),
      maxAge: (() => {
        const raw = document.getElementById('edu-cp-max-age')?.value || '';
        const value = raw ? parseInt(raw, 10) : null;
        return Number.isFinite(value) ? value : null;
      })(),
      genderRestriction: document.getElementById('edu-cp-gender')?.value || 'none',
      featured: !!document.getElementById('edu-cp-featured')?.checked,
      coverImage: this._getCoursePlanTemplateCoverImage(),
      weekdays: Array.from(document.querySelectorAll('#edu-cp-weekdays .edu-wd-checked')).map(c => parseInt(c.dataset.day, 10)),
      timeSlot: document.getElementById('edu-cp-timeslot')?.value.trim() || '',
      totalSessions: Number.isFinite(total) ? total : null,
      sessionSchedules,
      updatedAt: new Date().toISOString(),
    };
  },

  async _saveCoursePlanTemplate() {
    const nameInput = document.getElementById('edu-cp-template-name');
    const name = (nameInput?.value || '').trim();
    if (!name) {
      this.showToast('請輸入範本名稱');
      return;
    }
    this._syncEduCoursePlanPaymentMethodField?.();
    const tpl = this._buildCurrentCoursePlanTemplate(name);
    const max = this._MAX_TEMPLATES || 30;
    if (this._isCoursePlanCloudTemplateEnabled()) {
      const uid = this._getCoursePlanTemplateOwnerUid();
      try {
        await this._ensureCoursePlanTemplatesReady();
        if (this._getCoursePlanTemplates().length >= max) {
          this.showToast(`範本數量已達上限 ${max} 組`);
          return;
        }
        await ApiService.createEventTemplate({
          ...tpl,
          ownerUid: uid,
          ownerName: this._getCoursePlanTemplateOwnerName(),
        });
        await ApiService.loadMyEventTemplates(uid);
        this._templatesLoadedUid = uid;
        this._saveCoursePlanTemplateToLocal(tpl);
        if (nameInput) nameInput.value = '';
        this._renderCoursePlanTemplateSelector();
        this.showToast(`範本「${name}」已儲存到雲端`);
        return;
      } catch (err) {
        console.warn('[course plan template] cloud save failed:', err);
      }
    }
    const result = this._saveCoursePlanTemplateToLocal(tpl);
    if (!result.ok) {
      this.showToast(result.reason === 'limit' ? `範本數量已達上限 ${max} 組` : '範本儲存失敗');
      return;
    }
    if (nameInput) nameInput.value = '';
    this._renderCoursePlanTemplateSelector();
    this.showToast(result.imageDropped ? `圖片太大，已省略圖片後儲存範本「${name}」` : `範本「${name}」已儲存`);
  },

  _loadCoursePlanTemplate(id) {
    const tpl = this._getCoursePlanTemplates().find(t => String(t.id) === String(id))
      || this._getCoursePlanTemplatesFromLocal().find(t => String(t.id) === String(id));
    if (!tpl) return;
    const setVal = (elId, value) => {
      const el = document.getElementById(elId);
      if (el && value !== undefined && value !== null) el.value = value;
    };
    const setChecked = (elId, value) => {
      const el = document.getElementById(elId);
      if (el) el.checked = !!value;
    };
    setVal('edu-cp-group', tpl.groupId);
    setVal('edu-cp-name', tpl.planName);
    setVal('edu-cp-type', tpl.planType || 'weekly');
    this._toggleCoursePlanType?.(tpl.planType || 'weekly');
    setChecked('edu-cp-signup', tpl.allowSignup);
    setChecked('edu-cp-visible-on-team', tpl.visibleOnTeamPage !== false);
    setVal('edu-cp-capacity', tpl.maxCapacity);
    setVal('edu-cp-price', tpl.price);
    setVal('edu-cp-category-tags', Array.isArray(tpl.categoryTags) ? tpl.categoryTags.join(', ') : tpl.categoryTags);
    setVal('edu-cp-level-label', tpl.levelLabel);
    setVal('edu-cp-feature-tags', Array.isArray(tpl.featureTags) ? tpl.featureTags.join(', ') : tpl.featureTags);
    setVal('edu-cp-requirement-tags', Array.isArray(tpl.requirementTags) ? tpl.requirementTags.join(', ') : tpl.requirementTags);
    setVal('edu-cp-included-tags', Array.isArray(tpl.includedTags) ? tpl.includedTags.join(', ') : tpl.includedTags);
    setVal('edu-cp-target-tags', Array.isArray(tpl.targetTags) ? tpl.targetTags.join(', ') : tpl.targetTags);
    setVal('edu-cp-manager-name', tpl.managerName);
    setVal('edu-cp-manager-contact', tpl.managerContact);
    setVal('edu-cp-roster-agent-uid', tpl.rosterAgentUid);
    setVal('edu-cp-roster-agent-name', tpl.rosterAgentName);
    setVal('edu-cp-notify-targets', tpl.notifyTargets);
    setVal('edu-cp-coach-name', tpl.coachName);
    setVal('edu-cp-location', tpl.location);
    setVal('edu-cp-course-content', tpl.courseContent);
    setVal('edu-cp-description', tpl.description);
    setVal('edu-cp-payment-deadline', tpl.paymentDeadline);
    setVal('edu-cp-makeup-policy', tpl.makeupPolicy);
    setVal('edu-cp-cancellation-policy', tpl.cancellationPolicy);
    setVal('edu-cp-trial-info', tpl.trialSessionInfo);
    setVal('edu-cp-min-capacity', tpl.minCapacity);
    setVal('edu-cp-min-age', tpl.minAge);
    setVal('edu-cp-max-age', tpl.maxAge);
    setVal('edu-cp-gender', tpl.genderRestriction || 'none');
    setChecked('edu-cp-featured', tpl.featured);
    const parsedPayment = this._splitCoursePlanPaymentMethod(tpl.paymentMethod || '');
    setVal('edu-cp-payment-method-type', parsedPayment.type);
    setVal('edu-cp-payment-method-note', parsedPayment.note);
    this._syncEduCoursePlanPaymentMethodField?.();
    document.querySelectorAll('#edu-cp-weekdays .edu-wd-cell').forEach(cell => {
      const day = parseInt(cell.dataset.day, 10);
      const checked = Array.isArray(tpl.weekdays) && tpl.weekdays.includes(day);
      cell.classList.toggle('edu-wd-checked', checked);
      const mark = cell.querySelector('.edu-wd-check');
      if (mark) mark.textContent = checked ? '✓' : '';
    });
    setVal('edu-cp-timeslot', tpl.timeSlot);
    setVal('edu-cp-total', tpl.totalSessions);
    this._eduCoursePlanSessionScheduleDraft = this._normalizeCoursePlanSessionSchedules((tpl.sessionSchedules || []).map(item => ({
      date: '',
      startTime: item?.startTime || '',
      endTime: item?.endTime || '',
    })));
    this._renderCoursePlanSessionScheduleFields?.();
    if (tpl.coverImage) {
      const preview = document.getElementById('edu-cp-cover-preview');
      if (preview) preview.innerHTML = '<img src="' + escapeHTML(tpl.coverImage) + '">';
      this._eduCpCoverDataUrl = null;
    }
    this._updateCoursePlanPreview?.();
    this._syncEduCoursePlanFormFillBadges?.();
    this.showToast(`已載入範本「${tpl.name}」`);
  },

  async _deleteCoursePlanTemplate(id) {
    const cloudEnabled = this._isCoursePlanCloudTemplateEnabled();
    if (cloudEnabled) {
      const uid = this._getCoursePlanTemplateOwnerUid();
      try {
        await ApiService.deleteEventTemplate(id);
        await ApiService.loadMyEventTemplates(uid);
        this._templatesLoadedUid = uid;
      } catch (err) {
        console.warn('[course plan template] cloud delete failed:', err);
      }
    }
    this._removeCoursePlanTemplateFromLocal(id);
    this._renderCoursePlanTemplateSelector();
    this.showToast('範本已刪除');
  },

  _renderCoursePlanTemplateSelector() {
    const container = document.getElementById('edu-cp-template-selector');
    if (!container) return;
    const cloud = this._getCoursePlanTemplates();
    const local = this._getCoursePlanTemplatesFromLocal();
    const seen = new Set(cloud.map(t => t.id));
    const templates = [...cloud, ...local.filter(t => !seen.has(t.id))];
    if (!templates.length) {
      container.innerHTML = '<span class="edu-session-template-empty">尚無範本</span>';
      return;
    }
    container.innerHTML = templates.map(t => '<span class="edu-session-template-chip" onclick="App._loadCoursePlanTemplate(\'' + escapeHTML(t.id) + '\')">'
      + escapeHTML(t.name)
      + '<button type="button" onclick="event.stopPropagation();App._deleteCoursePlanTemplate(\'' + escapeHTML(t.id) + '\')" title="刪除範本">×</button>'
      + '</span>').join('');
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

  expandEduCoursePlanSections() {
    document.querySelectorAll('.edu-cp-form-v2 details').forEach(section => {
      section.setAttribute('open', '');
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
    if (type === 'session') this._renderCoursePlanSessionScheduleFields?.();
  },

  _normalizeCoursePlanSessionSchedules(value) {
    return (Array.isArray(value) ? value : [])
      .map(item => ({
        date: String(item?.date || '').trim(),
        startTime: String(item?.startTime || '').trim(),
        endTime: String(item?.endTime || '').trim(),
      }))
      .filter(item => item.date || item.startTime || item.endTime)
      .slice(0, 999);
  },

  _readCoursePlanSessionScheduleDraftFromDom(total) {
    const limit = Math.max(0, Math.min(999, Number(total || 0)));
    const rows = [];
    for (let index = 0; index < limit; index += 1) {
      const slot = index + 1;
      rows.push({
        date: String(document.getElementById('edu-cp-session-date-' + slot)?.value || '').trim(),
        startTime: String(document.getElementById('edu-cp-session-start-' + slot)?.value || '').trim(),
        endTime: String(document.getElementById('edu-cp-session-end-' + slot)?.value || '').trim(),
      });
    }
    return rows;
  },

  _getCoursePlanSessionScheduleFallback(index, total) {
    const startDate = document.getElementById('edu-cp-start')?.value || '';
    const endDate = document.getElementById('edu-cp-end')?.value || '';
    const date = typeof this._getSessionPlanAutoDate === 'function'
      ? this._getSessionPlanAutoDate({ startDate, endDate }, index, total)
      : '';
    return { date, startTime: '19:00', endTime: '20:30' };
  },

  _formatCoursePlanSessionSelectedTimePreview(startTime, endTime) {
    const start = String(startTime || '').trim();
    const end = String(endTime || '').trim();
    return start && end
      ? '已選時間：' + start + '~' + end
      : '已選時間：請選擇開始與結束時間';
  },

  _updateCoursePlanSessionTimePreview(slot) {
    const index = Number(slot || 0);
    if (!Number.isFinite(index) || index < 1) return;
    const preview = document.getElementById('edu-cp-session-time-preview-' + index);
    if (!preview) return;
    const start = document.getElementById('edu-cp-session-start-' + index)?.value || '';
    const end = document.getElementById('edu-cp-session-end-' + index)?.value || '';
    preview.textContent = this._formatCoursePlanSessionSelectedTimePreview(start, end);
  },

  _renderCoursePlanSessionScheduleFields() {
    const list = document.getElementById('edu-cp-session-schedule-list');
    if (!list) return;
    const total = parseInt(document.getElementById('edu-cp-total')?.value || '0', 10);
    if (!Number.isInteger(total) || total < 1) {
      list.innerHTML = '<div class="edu-cp-session-schedule-empty">輸入總堂數後，這裡會產生每堂日期與時段欄位。</div>';
      this._eduCoursePlanSessionScheduleDraft = [];
      return;
    }
    const normalizedTotal = Math.min(999, total);
    const currentRows = list.querySelector?.('.edu-cp-session-schedule-row')
      ? this._readCoursePlanSessionScheduleDraftFromDom(normalizedTotal)
      : [];
    const draft = currentRows.length
      ? currentRows
      : this._normalizeCoursePlanSessionSchedules(this._eduCoursePlanSessionScheduleDraft || []);
    const rows = [];
    for (let index = 0; index < normalizedTotal; index += 1) {
      const slot = index + 1;
      const fallback = this._getCoursePlanSessionScheduleFallback(index, normalizedTotal);
      const item = draft[index] || {};
      const selectedStartTime = item.startTime || fallback.startTime;
      const selectedEndTime = item.endTime || fallback.endTime;
      rows.push('<div class="edu-cp-session-schedule-row">'
        + '<span class="edu-cp-session-schedule-index">' + slot + '</span>'
        + '<label>日期<input type="date" id="edu-cp-session-date-' + slot + '" value="' + escapeHTML(item.date || fallback.date || '') + '"></label>'
        + '<label>開始<input type="time" id="edu-cp-session-start-' + slot + '" value="' + escapeHTML(selectedStartTime) + '" oninput="App._updateCoursePlanSessionTimePreview(' + slot + ')" onchange="App._updateCoursePlanSessionTimePreview(' + slot + ')"></label>'
        + '<label>結束<input type="time" id="edu-cp-session-end-' + slot + '" value="' + escapeHTML(selectedEndTime) + '" oninput="App._updateCoursePlanSessionTimePreview(' + slot + ')" onchange="App._updateCoursePlanSessionTimePreview(' + slot + ')"></label>'
        + '<div class="edu-cp-session-time-preview" id="edu-cp-session-time-preview-' + slot + '" aria-live="polite">' + escapeHTML(this._formatCoursePlanSessionSelectedTimePreview(selectedStartTime, selectedEndTime)) + '</div>'
      + '</div>');
    }
    list.innerHTML = '<div class="edu-cp-session-schedule-head"><strong>逐堂上課時間</strong><span>依總堂數逐一填寫，儲存後會自動建立對應課堂。</span></div>' + rows.join('');
    this._eduCoursePlanSessionScheduleDraft = this._readCoursePlanSessionScheduleDraftFromDom(normalizedTotal);
  },

  _collectCoursePlanSessionSchedules(total) {
    const normalizedTotal = Math.max(0, Math.min(999, Number(total || 0)));
    const rows = this._readCoursePlanSessionScheduleDraftFromDom(normalizedTotal);
    return rows.map(item => ({
      date: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
    }));
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
    const rosterAgentUid = optionalText('edu-cp-roster-agent-uid', 128);
    const rosterAgentName = rosterAgentUid ? optionalText('edu-cp-roster-agent-name', 30) : '';
    if (optionalText('edu-cp-roster-agent-name', 30) && !rosterAgentUid) {
      _btnState.restore();
      this.showToast('請從搜尋結果選擇負責代理人');
      return;
    }

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
      rosterAgentUid,
      rosterAgentName,
      rosterAgentUids: rosterAgentUid ? [rosterAgentUid] : [],
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
    if (document.getElementById('edu-cp-payment-method')) {
      this._syncEduCoursePlanPaymentMethodField?.();
      data.paymentMethod = this._getEduCoursePlanPaymentMethodValue?.() || optionalText('edu-cp-payment-method', 300);
    }
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
      data.sessionSchedules = null;
      if (!data.weekdays.length) { _btnState.restore(); this.showToast('請選擇上課日'); return; }
      if (!data.startDate || !data.endDate) { _btnState.restore(); this.showToast('請設定開始和結束日期'); return; }
    } else {
      const total = parseInt(document.getElementById('edu-cp-total').value, 10);
      if (!total || total < 1) { _btnState.restore(); this.showToast('請輸入有效堂數'); return; }
      const sessionSchedules = this._collectCoursePlanSessionSchedules(total);
      const missingSlots = sessionSchedules
        .map((item, index) => (!item.date || !item.startTime || !item.endTime) ? index + 1 : null)
        .filter(Boolean);
      if (missingSlots.length) {
        _btnState.restore();
        this.showToast('請填寫第 ' + missingSlots.join('、') + ' 堂的日期與時段');
        return;
      }
      const invalidSlots = sessionSchedules
        .map((item, index) => item.startTime >= item.endTime ? index + 1 : null)
        .filter(Boolean);
      if (invalidSlots.length) {
        _btnState.restore();
        this.showToast('第 ' + invalidSlots.join('、') + ' 堂的結束時間必須晚於開始時間');
        return;
      }
      data.totalSessions = total;
      data.sessionSchedules = sessionSchedules;
      if (!data.startDate && sessionSchedules[0]) data.startDate = sessionSchedules[0].date;
      if (!data.endDate && sessionSchedules[sessionSchedules.length - 1]) data.endDate = sessionSchedules[sessionSchedules.length - 1].date;
      data.weekdays = null;
      data.timeSlot = null;
    }

    // 封面圖片上傳
    if (this._eduCpCoverDataUrl) {
      data.coverImage = this._eduCpCoverDataUrl;
      this._eduCpCoverDataUrl = null;
    }

    try {
      let savedPlan = null;
      if (planId) {
        await FirebaseService.updateEduCoursePlan(teamId, planId, data);
        const cached = this._eduCoursePlansCache[teamId];
        if (cached) {
          const existing = cached.find(p => p.id === planId);
          if (existing) Object.assign(existing, data);
          savedPlan = existing || null;
        }
        savedPlan = savedPlan || { ...data, id: planId };
      } else {
        data.id = this._generateEduId('cp');
        data.active = true;
        data.currentCount = 0;
        const result = await FirebaseService.createEduCoursePlan(teamId, data);
        const cached = this._eduCoursePlansCache[teamId];
        if (cached) cached.push(result);
        else this._eduCoursePlansCache[teamId] = [result];
        savedPlan = result;
      }
      let syncCreated = 0;
      let syncFailed = false;
      if (typeof this._ensureCoursePlanSessionsFromPlan === 'function' && savedPlan) {
        try {
          const syncResult = await this._ensureCoursePlanSessionsFromPlan(teamId, savedPlan);
          syncCreated = Number(syncResult?.created || 0);
        } catch (syncErr) {
          console.error('[handleSaveEduCoursePlan] session sync failed:', syncErr);
          syncFailed = true;
          this.showToast('課程方案已儲存，但課堂同步失敗：' + (syncErr.message || '請稍後再試'));
        }
      }
      if (!syncFailed) {
        if (!syncCreated) this.showToast(planId ? '課程方案已更新' : '課程方案已建立');
        else this.showToast((planId ? '課程方案已更新' : '課程方案已建立') + '，已補齊 ' + syncCreated + ' 堂課堂');
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
    const today = this._todayStr?.() || (() => {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
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
