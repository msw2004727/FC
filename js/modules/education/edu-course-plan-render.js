/* ================================================
   SportHub — Education: Course Plan Render
   ================================================
   課程方案列表渲染（方案卡片、報名按鈕、管理按鈕、排序按鈕）
   從 edu-course-plan.js 拆分
   ================================================ */

Object.assign(App, {
  _eduCoursePlanListRequestSeq: 0,
  _eduCoursePlanShareFocusByTeam: {},

  _buildEduCoursePlanShareSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"></path>'
      + '<path d="M16 6l-4-4-4 4"></path>'
      + '<path d="M12 2v14"></path>'
      + '</svg>';
  },

  _buildEduCoursePlanShareQuery(teamId, planId, options = {}) {
    const params = new URLSearchParams();
    params.set('teamTab', 'courses');
    params.set('course', String(planId || '').trim());
    params.set('courseTab', options.courseTab === 'ended' ? 'ended' : 'active');
    if (options.courseView !== 'card') params.set('courseView', 'detail');
    if (options.includeTeam !== false) params.set('team', String(teamId || '').trim());
    return params.toString();
  },

  _buildEduCoursePlanMiniAppShareUrl(teamId, planId, options = {}) {
    const base = typeof MINI_APP_BASE_URL !== 'undefined' ? MINI_APP_BASE_URL : 'https://toosterx.com';
    const params = this._buildEduCoursePlanShareQuery(teamId, planId, {
      ...options,
      includeTeam: true,
    });
    return base + '?' + params;
  },

  _buildEduCoursePlanWebShareUrl(teamId, planId, options = {}) {
    const safeTeamId = encodeURIComponent(String(teamId || '').trim());
    const params = this._buildEduCoursePlanShareQuery(teamId, planId, {
      ...options,
      includeTeam: false,
    });
    return 'https://toosterx.com/teams/' + safeTeamId + '?' + params;
  },

  _buildEduCoursePlanShareAltText(team, plan, shareUrl) {
    const lines = [
      '「' + (plan?.name || '') + '」課程',
      team?.name ? '俱樂部：' + team.name : '',
      plan?.startDate ? '期間：' + plan.startDate + (plan.endDate ? ' ~ ' + plan.endDate : '') : '',
      plan?.location ? '地點：' + plan.location : '',
      '',
      shareUrl,
    ].filter((line, index) => index === 4 || String(line || '').trim());
    let text = lines.join('\n');
    if (text.length > 400) text = Array.from(text).slice(0, 397).join('') + '...';
    return text;
  },

  _buildEduCoursePlanFlexMessage(team, plan, liffUrl) {
    const brandColor = plan?.planType === 'session' ? '#7c3aed' : '#0d9488';
    const typeLabel = plan?.planType === 'session' ? '堂數課程' : '週期課程';
    const rows = [];
    const addRow = (label, value) => {
      const text = String(value || '').trim();
      if (!text) return;
      if (typeof this._buildFlexInfoRow === 'function') rows.push(this._buildFlexInfoRow(label, text));
      else rows.push({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: label, size: 'sm', color: '#888888', flex: 2 },
          { type: 'text', text, size: 'sm', color: '#333333', flex: 5, wrap: true },
        ],
      });
    };
    addRow('俱樂部', team?.name || '');
    addRow('日期', [plan?.startDate, plan?.endDate].filter(Boolean).join(' ~ '));
    addRow('地點', plan?.location || '');
    if (plan?.price !== undefined && plan?.price !== null && String(plan.price).trim() !== '') {
      const price = Number(plan.price);
      addRow('費用', Number.isFinite(price) && price > 0 ? 'NT$ ' + price.toLocaleString() : '免費');
    }
    const bodyContents = [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [{
          type: 'text',
          text: '課程分享',
          size: 'xs',
          color: '#ffffff',
          weight: 'bold',
          align: 'center',
          gravity: 'center',
        }],
        backgroundColor: brandColor,
        cornerRadius: '12px',
        paddingAll: '4px',
        paddingStart: '10px',
        paddingEnd: '10px',
        width: '92px',
      },
      {
        type: 'text',
        text: plan?.name || '課程',
        weight: 'bold',
        size: 'lg',
        wrap: true,
        maxLines: 2,
        margin: 'md',
      },
      {
        type: 'text',
        text: typeLabel,
        size: 'sm',
        color: '#64748b',
        margin: 'sm',
      },
    ];
    if (rows.length) {
      bodyContents.push({
        type: 'box',
        layout: 'vertical',
        contents: rows,
        margin: 'lg',
        spacing: 'sm',
      });
    }
    const bubble = {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: bodyContents,
        paddingAll: '16px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button',
          style: 'primary',
          color: brandColor,
          action: { type: 'uri', label: '查看課程', uri: liffUrl },
          height: 'sm',
        }],
        paddingAll: '12px',
      },
    };
    const heroImage = String(this._getCoursePlanCoverUrl?.(plan) || plan?.coverImage || plan?.coverUrl || plan?.imageUrl || plan?.image || plan?.imageVariants?.cover || '').trim();
    if (/^https?:\/\//i.test(heroImage)) {
      bubble.hero = {
        type: 'image',
        url: heroImage,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
      };
    }
    return bubble;
  },

  async shareEduCoursePlan(teamId, planId, options = {}) {
    if (this._shareInProgress) return;
    this._shareInProgress = true;
    try {
      await this._doShareEduCoursePlan(teamId, planId, options);
    } finally {
      this._shareInProgress = false;
    }
  },

  async _doShareEduCoursePlan(teamId, planId, options = {}) {
    const team = ApiService.getTeam?.(teamId) || {};
    const plan = (this.getEduCoursePlans?.(teamId) || [])
      .find(item => String(item?.id || item?._docId || '') === String(planId || ''));
    if (!plan) {
      this.showToast?.('課程資料尚未載入，請稍後再試');
      return;
    }
    if (plan.visibleOnTeamPage === false && !this.isEduClubStaff?.(teamId)) {
      this.showToast?.('此課程尚未公開');
      return;
    }
    const courseTab = options.courseTab === 'ended'
      ? 'ended'
      : (this._eduCoursePlanTabByTeam?.[teamId] === 'ended' ? 'ended' : 'active');
    const liffUrl = this._buildEduCoursePlanMiniAppShareUrl(teamId, planId, { courseTab });
    const webShareUrl = this._buildEduCoursePlanWebShareUrl(teamId, planId, { courseTab });
    const altText = this._buildEduCoursePlanShareAltText(team, plan, liffUrl);
    const canPicker = typeof this._canUseShareTargetPicker === 'function'
      ? await this._canUseShareTargetPicker()
      : false;
    const lineLoggedIn = typeof LineAuth !== 'undefined'
      && typeof LineAuth.isLoggedIn === 'function'
      && LineAuth.isLoggedIn();

    if ((canPicker || lineLoggedIn) && typeof this._showShareActionSheet === 'function') {
      const choice = await this._showShareActionSheet(canPicker, '分享課程');
      if (choice === 'line') {
        if (!canPicker) {
          this.showToast?.('請在 LINE 中開啟以使用此功能');
          return;
        }
        try {
          const flexMsg = this._buildEduCoursePlanFlexMessage(team, plan, liffUrl);
          const res = await liff.shareTargetPicker([
            { type: 'flex', altText, contents: flexMsg },
          ]);
          this.showToast?.(res ? '課程已分享到 LINE' : '分享已完成');
        } catch (err) {
          console.warn('[EduCourseShare] shareTargetPicker failed:', err);
          this.showToast?.('分享失敗，請稍後再試');
        }
        return;
      }
      if (choice === 'line-share') {
        if (typeof this._openLineRShare === 'function') this._openLineRShare(altText);
        else window.open('https://line.me/R/share?text=' + encodeURIComponent(altText), '_blank');
        return;
      }
      if (choice === 'copy') {
        const copyText = this._buildEduCoursePlanShareAltText(team, plan, webShareUrl);
        const ok = typeof this._copyToClipboard === 'function'
          ? await this._copyToClipboard(copyText)
          : false;
        this.showToast?.(ok ? '連結已複製' : '複製失敗');
      }
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ text: altText });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    const copyOk = typeof this._copyToClipboard === 'function'
      ? await this._copyToClipboard(this._buildEduCoursePlanShareAltText(team, plan, webShareUrl))
      : false;
    this.showToast?.(copyOk ? '課程連結已複製到剪貼簿' : '複製失敗，請手動複製');
  },

  _parseEduCourseLessonRoute(pathname, options = {}) {
    try {
      const rawSegments = String(pathname || '/').split('/').filter(Boolean);
      const suffixOffset = rawSegments.length - 6;
      if (suffixOffset < 0 || suffixOffset > 1) return null;
      if (suffixOffset === 1 && options.allowPrefix !== true) return null;
      const segments = rawSegments.slice(suffixOffset);
      if (segments[0] !== 'teams' || segments[2] !== 'courses' || segments[4] !== 'lessons') {
        return null;
      }
      const decodeSafe = (raw) => {
        const encoded = String(raw || '');
        if (!encoded || /%2f|%5c/i.test(encoded)) return '';
        try {
          const decoded = decodeURIComponent(encoded);
          const safe = typeof this._isSafeHistoryRouteSegment === 'function'
            ? this._isSafeHistoryRouteSegment(decoded)
            : /^[A-Za-z0-9_-]{3,80}$/.test(decoded);
          return safe ? decoded : '';
        } catch (_) {
          return '';
        }
      };
      if (suffixOffset === 1 && !decodeSafe(rawSegments[0])) return null;
      const teamId = decodeSafe(segments[1]);
      const planId = decodeSafe(segments[3]);
      const lessonId = decodeSafe(segments[5]);
      if (!teamId || !planId || !lessonId) return null;
      return { teamId, planId, lessonId };
    } catch (_) {
      return null;
    }
  },

  _getEduCoursePlanShareIntent(teamId) {
    try {
      const url = new URL(window.location.href);
      const params = url.searchParams;
      const safeTeamId = String(teamId || '').trim();
      const allowPrefix = /^(?:miniapp|liff)\.line\.me$/i.test(String(url.hostname || ''));
      const canonicalRoute = this._parseEduCourseLessonRoute?.(url.pathname, { allowPrefix });
      const isSafeSegment = (value) => {
        if (typeof this._isSafeHistoryRouteSegment === 'function') return this._isSafeHistoryRouteSegment(value);
        return /^[A-Za-z0-9_-]{3,80}$/.test(String(value || ''));
      };
      let routeTeamId = String(canonicalRoute?.teamId || params.get('team') || '').trim();
      if (!routeTeamId) {
        const teamPathMatch = url.pathname.match(/^\/teams\/([^/?#]+)\/?$/);
        if (teamPathMatch && !/%2f|%5c/i.test(teamPathMatch[1])) {
          try { routeTeamId = decodeURIComponent(teamPathMatch[1]); } catch (_) { routeTeamId = ''; }
        }
      }
      if (routeTeamId && (!isSafeSegment(routeTeamId) || routeTeamId !== safeTeamId)) return null;
      const teamTab = String(params.get('teamTab') || '').trim().toLowerCase();
      const planId = String(
        canonicalRoute?.planId
        || params.get('course')
        || params.get('coursePlan')
        || params.get('plan')
        || ''
      ).trim();
      const lessonId = String(
        canonicalRoute?.lessonId
        || params.get('lesson')
        || params.get('session')
        || ''
      ).trim();
      if (!canonicalRoute && teamTab !== 'courses' && !planId) return null;
      const courseTab = String(params.get('courseTab') || '').trim().toLowerCase() === 'ended' ? 'ended' : 'active';
      const courseView = String(params.get('courseView') || params.get('view') || '').trim().toLowerCase();
      const openRoster = !!canonicalRoute || !!lessonId;
      if (openRoster && (!planId || !isSafeSegment(planId) || !isSafeSegment(lessonId))) return null;
      const intent = {
        teamTab: 'courses',
        planId,
        courseTab,
        openDetail: !openRoster && (courseView === 'detail' || courseView === 'info'),
      };
      if (openRoster) {
        intent.openRoster = true;
        intent.lessonId = lessonId;
      }
      return intent;
    } catch (_) {
      return null;
    }
  },

  _primeEduCoursePlanShareIntent(teamId, routeOptions = {}) {
    const intent = this._getEduCoursePlanShareIntent?.(teamId);
    if (!intent) return null;
    this._teamDetailTabByTeam = this._teamDetailTabByTeam || {};
    this._eduCoursePlanTabByTeam = this._eduCoursePlanTabByTeam || {};
    this._eduCoursePlanShareFocusByTeam = this._eduCoursePlanShareFocusByTeam || {};
    this._teamDetailTabByTeam[teamId] = 'courses';
    this._eduCoursePlanTabByTeam[teamId] = intent.courseTab;
    this._eduActiveTab = 'course';
    if (intent.planId) {
      this._eduCoursePlanShareFocusByTeam[teamId] = {
        planId: intent.planId,
        openDetail: intent.openDetail === true,
        openRoster: intent.openRoster === true,
        lessonId: String(intent.lessonId || '').trim(),
        skipPageHistory: routeOptions.skipPageHistory === true,
        suppressHashSync: routeOptions.suppressHashSync === true,
        _navigationTransitionSeq: Number(routeOptions._navigationTransitionSeq) || 0,
        createdAt: Date.now(),
      };
    }
    return intent;
  },

  _buildEduCourseLessonCanonicalPath(teamId, planId, lessonId, urlLike) {
    const values = [teamId, planId, lessonId].map(value => String(value || '').trim());
    const isSafe = (value) => {
      if (typeof this._isSafeHistoryRouteSegment === 'function') {
        return this._isSafeHistoryRouteSegment(value);
      }
      return /^[A-Za-z0-9_-]{3,80}$/.test(value);
    };
    if (!values.every(isSafe)) return '';

    const routePath = typeof this._buildEduCourseLessonRoutePath === 'function'
      ? this._buildEduCourseLessonRoutePath(values[0], values[1], values[2])
      : '/teams/' + encodeURIComponent(values[0])
        + '/courses/' + encodeURIComponent(values[1])
        + '/lessons/' + encodeURIComponent(values[2]);
    if (!routePath) return '';

    try {
      const url = urlLike && urlLike.searchParams
        ? urlLike
        : new URL(String(urlLike || window.location.href));
      const isLineMiniAppHost = /^(?:miniapp|liff)\.line\.me$/i.test(String(url.hostname || ''));
      const currentRoute = this._parseEduCourseLessonRoute?.(url.pathname, {
        allowPrefix: isLineMiniAppHost,
      });
      if (currentRoute
        && currentRoute.teamId === values[0]
        && currentRoute.planId === values[1]
        && currentRoute.lessonId === values[2]) {
        return String(url.pathname || '/').replace(/\/+$/, '') || '/';
      }
      if (!isLineMiniAppHost) return routePath;

      let prefix = String(url.pathname || '/').replace(/\/+$/, '');
      const teamDetailSuffix = '/teams/' + encodeURIComponent(values[0]);
      if (prefix.endsWith(teamDetailSuffix)) {
        prefix = prefix.slice(0, -teamDetailSuffix.length);
      }
      if (!prefix || prefix === '/') return routePath;
      const prefixSegments = prefix.split('/').filter(Boolean);
      if (prefixSegments.length !== 1 || /%2f|%5c/i.test(prefixSegments[0])) return routePath;
      try {
        const prefixId = decodeURIComponent(prefixSegments[0]);
        return isSafe(prefixId) ? '/' + encodeURIComponent(prefixId) + routePath : routePath;
      } catch (_) {
        return routePath;
      }
    } catch (_) {
      return routePath;
    }
  },

  _consumeEduCourseLessonShareQuery(teamId, planId, lessonId) {
    try {
      const url = new URL(window.location.href);
      const expectedTeamId = String(teamId || '').trim();
      const expectedPlanId = String(planId || '').trim();
      const expectedLessonId = String(lessonId || '').trim();
      const isSafe = (value) => {
        if (typeof this._isSafeHistoryRouteSegment === 'function') {
          return this._isSafeHistoryRouteSegment(value);
        }
        return /^[A-Za-z0-9_-]{3,80}$/.test(String(value || ''));
      };
      if (![expectedTeamId, expectedPlanId, expectedLessonId].every(isSafe)) return false;

      const allowPrefix = /^(?:miniapp|liff)\.line\.me$/i.test(String(url.hostname || ''));
      const canonicalRoute = this._parseEduCourseLessonRoute?.(url.pathname, { allowPrefix });
      const routePlanId = String(
        canonicalRoute?.planId
        || url.searchParams.get('course')
        || url.searchParams.get('coursePlan')
        || url.searchParams.get('plan')
        || ''
      ).trim();
      const routeLessonId = String(
        canonicalRoute?.lessonId
        || url.searchParams.get('lesson')
        || url.searchParams.get('session')
        || ''
      ).trim();
      if (!routePlanId || !routeLessonId) return false;
      if (routePlanId !== expectedPlanId || routeLessonId !== expectedLessonId) return false;

      let routeTeamId = String(canonicalRoute?.teamId || url.searchParams.get('team') || '').trim();
      if (!routeTeamId) {
        const teamPathMatch = url.pathname.match(/^\/teams\/([^/?#]+)\/?$/);
        if (teamPathMatch && !/%2f|%5c/i.test(teamPathMatch[1])) {
          try { routeTeamId = decodeURIComponent(teamPathMatch[1]); } catch (_) { routeTeamId = ''; }
        }
      }
      if (!isSafe(routeTeamId) || routeTeamId !== expectedTeamId) return false;

      const previousUrl = url.pathname + (url.search || '') + (url.hash || '');
      const historyApi = window.history;
      const previousState = historyApi?.state;
      const canonicalPath = this._buildEduCourseLessonCanonicalPath?.(
        expectedTeamId,
        expectedPlanId,
        expectedLessonId,
        url,
      );
      if (!canonicalPath) return false;
      url.pathname = canonicalPath;

      const courseTab = String(url.searchParams.get('courseTab') || '').trim().toLowerCase() === 'ended'
        ? 'ended'
        : 'active';
      ['teamTab', 'team', 'course', 'coursePlan', 'plan', 'courseView', 'view', 'lesson', 'session'].forEach((key) => {
        url.searchParams.delete(key);
      });
      url.searchParams.set('courseTab', courseTab);
      if (/^#page-/.test(url.hash || '')) url.hash = '';

      const builtState = this._buildRouteStateForCurrentPage?.('page-team-detail');
      const routeState = {
        ...(builtState && typeof builtState === 'object' ? builtState : {}),
        source: 'sportshub',
        pageId: 'page-team-detail',
        id: expectedTeamId,
      };
      const canonicalUrl = url.pathname + (url.search || '') + (url.hash || '');
      const changed = canonicalUrl !== previousUrl;
      if (changed) {
        if (!historyApi || typeof historyApi.replaceState !== 'function') return false;
        historyApi.replaceState(routeState, '', canonicalUrl);
      }
      return {
        previousUrl,
        previousState,
        routeState,
        canonicalUrl,
        changed,
      };
    } catch (_) {
      return false;
    }
  },

  _restoreEduCourseLessonShareQuery(consumption) {
    try {
      if (!consumption || consumption.changed === false) return !!consumption;
      const previousUrl = String(consumption?.previousUrl || '').trim();
      const historyApi = window.history;
      if (!previousUrl || !historyApi || typeof historyApi.replaceState !== 'function') return false;
      const candidateState = Object.prototype.hasOwnProperty.call(consumption, 'previousState')
        ? consumption.previousState
        : null;
      const candidatePageId = String(candidateState?.pageId || '').trim();
      const candidateNeedsId = ['page-activity-detail', 'page-team-detail', 'page-tournament-detail', 'page-user-card']
        .includes(candidatePageId);
      const candidateIsComplete = candidateState
        && typeof candidateState === 'object'
        && candidateState.source === 'sportshub'
        && candidatePageId
        && (!candidateNeedsId || String(candidateState.id || '').trim());
      const previousState = candidateIsComplete ? candidateState
        : (consumption?.routeState && typeof consumption.routeState === 'object'
          ? consumption.routeState
          : { source: 'sportshub', pageId: 'page-team-detail' });
      historyApi.replaceState(previousState, '', previousUrl);
      return true;
    } catch (_) {
      return false;
    }
  },

  _applyEduCoursePlanShareFocus(teamId) {
    const pending = this._eduCoursePlanShareFocusByTeam?.[teamId];
    const planId = String(pending?.planId || '').trim();
    if (!planId) return false;
    const schedule = (fn, delay) => {
      if (typeof setTimeout === 'function') return setTimeout(fn, delay);
      try { fn(); } catch (_) {}
      return null;
    };
    const lessonId = String(pending?.lessonId || '').trim();
    if (pending.openRoster === true && lessonId) {
      if (pending.handoffInFlight === true || pending.handoffAttempted === true) return true;
      pending.handoffAttempted = true;
      pending.handoffInFlight = true;
      const inheritedTransitionSeq = Number(pending._navigationTransitionSeq);
      const activeTransitionSeq = Number(this._activePageTransitionSeq);
      const transitionSeq = Number.isSafeInteger(inheritedTransitionSeq) && inheritedTransitionSeq > 0
        ? inheritedTransitionSeq : activeTransitionSeq;
      const hasTransition = Number.isSafeInteger(transitionSeq) && transitionSeq > 0;
      const isSamePending = () => this._eduCoursePlanShareFocusByTeam?.[teamId] === pending;
      const clearPending = () => {
        if (isSamePending()) delete this._eduCoursePlanShareFocusByTeam[teamId];
      };
      const releaseForRetry = () => {
        if (isSamePending()) {
          pending.handoffInFlight = false;
          pending.handoffAttempted = false;
        }
      };
      const canContinueFromTeam = () => {
        if (this.currentPage !== 'page-team-detail') return false;
        if (this._teamDetailId && String(this._teamDetailId) !== String(teamId)) return false;
        return !hasTransition || typeof this._isPageTransitionCurrent !== 'function'
          || this._isPageTransitionCurrent(transitionSeq);
      };
      schedule(async () => {
        if (!canContinueFromTeam()) {
          clearPending();
          return;
        }
        const consumption = this._consumeEduCourseLessonShareQuery?.(teamId, planId, lessonId);
        try {
          const rosterOptions = {
            bypassPageLock: true,
            preserveRouteUrl: true,
            skipPageHistory: pending.skipPageHistory === true,
            suppressHashSync: true,
          };
          if (hasTransition) rosterOptions._navigationTransitionSeq = transitionSeq;
          const result = this.showCourseLessonRoster?.(teamId, planId, lessonId, rosterOptions);
          const outcome = result && typeof result.then === 'function' ? await result : result;
          const rosterContext = this._eduCourseLessonsContext;
          const rosterOpened = outcome?.ok === true || (this.currentPage === 'page-edu-course-lessons'
            && rosterContext?.mode === 'roster'
            && String(rosterContext?.teamId || '') === String(teamId)
            && String(rosterContext?.planId || '') === String(planId)
            && String(rosterContext?.sessionId || '') === String(lessonId));
          if (rosterOpened) {
            clearPending();
            return;
          }
          if (canContinueFromTeam()) {
            this._restoreEduCourseLessonShareQuery?.(consumption);
            releaseForRetry();
            return;
          }
          clearPending();
        } catch (err) {
          console.warn('[EduCourseShare] open roster intent failed:', err);
          if (canContinueFromTeam()) {
            this._restoreEduCourseLessonShareQuery?.(consumption);
            releaseForRetry();
            return;
          }
          clearPending();
        }
      }, 120);
      return true;
    }
    if (typeof document === 'undefined') return false;
    const cards = Array.from(document.querySelectorAll?.('[data-course-plan-id]') || []);
    const card = cards.find(node => String(node.getAttribute?.('data-course-plan-id') || '') === planId);
    if (!card) return false;
    cards.forEach(node => node.classList?.remove('edu-cp-card-share-target'));
    card.classList?.add('edu-cp-card-share-target');
    delete this._eduCoursePlanShareFocusByTeam[teamId];
    schedule(() => {
      try { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    }, 80);
    if (pending.openDetail === true && typeof this.showEduCoursePlanDetail === 'function') {
      schedule(() => {
        try {
          const result = this.showEduCoursePlanDetail(teamId, planId);
          if (result && typeof result.catch === 'function') {
            result.catch(err => console.warn('[EduCourseShare] open detail intent failed:', err));
          }
        } catch (err) {
          console.warn('[EduCourseShare] open detail intent failed:', err);
        }
      }, 120);
    }
    schedule(() => {
      try { card.classList?.remove('edu-cp-card-share-target'); } catch (_) {}
    }, 4200);
    return true;
  },

  _renderEduCoursePlanLoading(text) {
    const label = escapeHTML(text || '\u8ab2\u7a0b\u8cc7\u6599\u8f09\u5165\u4e2d');
    return '<div class="edu-loading edu-course-plan-list-loading" role="status" aria-live="polite" aria-busy="true">'
      + '<div class="edu-loading-bar"><div class="edu-loading-fill"></div></div>'
      + '<div class="edu-loading-text">' + label + '</div>'
      + '<div class="edu-loading-skeleton" aria-hidden="true">'
      + '<div class="edu-loading-skeleton-row"></div>'
      + '<div class="edu-loading-skeleton-row"></div>'
      + '</div>'
      + '</div>';
  },

  async _getCoursePlanFrozenSessionCount(teamId, plan) {
    const planId = String(plan?.id || plan?._docId || '').trim();
    if (!teamId || !planId || typeof this._loadCourseSessions !== 'function') return null;
    try {
      const sessions = await this._loadCourseSessions(teamId, planId);
      const sorted = [...(Array.isArray(sessions) ? sessions : [])]
        .filter(session => this._isCourseSessionFrozenForRoster?.(session) || String(session?.status || '').trim() === 'done')
        .sort((a, b) => {
          if (typeof this._getCourseSessionSortValue === 'function') {
            return this._getCourseSessionSortValue(a) - this._getCourseSessionSortValue(b);
          }
          return String(a?.date || '').localeCompare(String(b?.date || ''));
        });
      const latest = sorted[sorted.length - 1];
      const count = Array.isArray(latest?.studentIds) ? latest.studentIds.length : NaN;
      return Number.isFinite(count) && count >= 0 ? count : null;
    } catch (err) {
      console.warn('[edu-course-plan] frozen session count failed:', err);
      return null;
    }
  },

  _formatCoursePlanCardNextDate(value) {
    if (value === null || value === undefined || value === '') return '';
    let parsed = null;
    if (value instanceof Date) {
      parsed = value;
    } else if (typeof value === 'number') {
      parsed = new Date(value);
    } else {
      const raw = String(value || '').trim();
      const isoMatch = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (isoMatch) {
        parsed = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
      } else {
        const shortMatch = raw.match(/(\d{1,2})\/(\d{1,2})/);
        if (shortMatch) {
          const month = Number(shortMatch[1]);
          const day = Number(shortMatch[2]);
          if (Number.isFinite(month) && Number.isFinite(day) && month >= 1 && day >= 1) {
            return month + '/' + String(day).padStart(2, '0');
          }
        }
        const fallback = new Date(raw);
        if (Number.isFinite(fallback.getTime())) parsed = fallback;
      }
    }
    if (!parsed || !Number.isFinite(parsed.getTime())) return '';
    return (parsed.getMonth() + 1) + '/' + String(parsed.getDate()).padStart(2, '0');
  },

  _getCoursePlanNextSessionItem(sessions = [], options = {}) {
    const today = String(options.today || this._todayStr?.() || '').trim();
    const parseDateOnly = (value) => {
      const match = String(value || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!match) return null;
      const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    };
    const now = options.now instanceof Date ? options.now : new Date();
    const todayStart = parseDateOnly(today) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStartMs = todayStart.getTime();
    const getSessionMs = (session) => {
      const date = String(session?.date || '').trim();
      const timeMatch = String(session?.startTime || '00:00').trim().match(/^(\d{1,2}):(\d{2})/);
      const time = timeMatch ? timeMatch[0] : '00:00';
      if (date) {
        const ms = new Date(date + 'T' + time).getTime();
        if (Number.isFinite(ms)) return ms;
      }
      if (typeof this._getCourseSessionSortValue === 'function') {
        const sortValue = Number(this._getCourseSessionSortValue(session));
        if (Number.isFinite(sortValue)) return sortValue;
      }
      return 0;
    };
    const inactiveStatuses = new Set(['cancelled', 'canceled', 'done', 'removed', 'completed', 'ended', 'closed']);
    return [...(Array.isArray(sessions) ? sessions : [])]
      .map(session => ({ session, timestamp: getSessionMs(session) }))
      .filter(item => item.timestamp >= todayStartMs)
      .filter(item => !inactiveStatuses.has(String(item.session?.status || '').trim().toLowerCase()))
      .sort((a, b) => a.timestamp - b.timestamp)[0] || null;
  },
  _getCoursePlanCardNextLessonLabel(plan, sessions = [], options = {}) {
    if (!plan) return '';
    const today = String(options.today || this._todayStr?.() || '').trim();
    const parseDateOnly = (value) => {
      const match = String(value || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!match) return null;
      const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    };
    const now = options.now instanceof Date ? options.now : new Date();
    const todayStart = parseDateOnly(today) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStartMs = todayStart.getTime();
    const nextSession = this._getCoursePlanNextSessionItem(sessions, options);
    const sessionDateLabel = nextSession
      ? this._formatCoursePlanCardNextDate(nextSession.session?.date || nextSession.timestamp)
      : '';
    if (sessionDateLabel) return '\u4e0b\u5802\u8ab2' + sessionDateLabel;

    const nextWeekly = this._getCoursePlanNextWeeklyOccurrence?.(plan, now);
    const weeklyDateLabel = nextWeekly
      ? this._formatCoursePlanCardNextDate(nextWeekly.date || nextWeekly.label || nextWeekly.timestamp)
      : '';
    if (weeklyDateLabel) return '\u4e0b\u5802\u8ab2' + weeklyDateLabel;

    const weeklyDates = plan.planType === 'weekly' && typeof this.generateWeeklyDates === 'function'
      ? this.generateWeeklyDates(plan)
      : [];
    const nextWeeklyDate = weeklyDates.find(date => {
      const parsed = parseDateOnly(date);
      return parsed && parsed.getTime() >= todayStartMs;
    });
    const generatedDateLabel = this._formatCoursePlanCardNextDate(nextWeeklyDate);
    return generatedDateLabel ? '\u4e0b\u5802\u8ab2' + generatedDateLabel : '';
  },

  _getCoursePlanNextLessonRegisterKey(teamId, planId, sessionId) {
    const uid = typeof ApiService !== 'undefined' && typeof ApiService.getCurrentUser === 'function'
      ? String(ApiService.getCurrentUser()?.uid || '').trim()
      : '';
    return [uid, teamId, planId, sessionId].map(value => String(value || '').trim()).join('|');
  },

  _isCoursePlanNextLessonRegistered(teamId, planId, sessionId) {
    const key = this._getCoursePlanNextLessonRegisterKey(teamId, planId, sessionId);
    return !!(key && this._eduCoursePlanNextLessonRegisteredByKey?.[key] === true);
  },

  _markCoursePlanNextLessonRegistered(teamId, planId, sessionId) {
    const key = this._getCoursePlanNextLessonRegisterKey(teamId, planId, sessionId);
    if (!key) return false;
    this._eduCoursePlanNextLessonRegisteredByKey = this._eduCoursePlanNextLessonRegisteredByKey || {};
    this._eduCoursePlanNextLessonRegisteredByKey[key] = true;
    return true;
  },

  _setCoursePlanNextLessonRegisterButtonRegistered(button) {
    if (!button) return;
    button.textContent = '已報名';
    button.disabled = true;
    button.setAttribute?.('aria-disabled', 'true');
    button.classList?.add('is-registered');
  },

  _getCoursePlanLessonStudentId(student) {
    if (typeof this._getCourseLessonRosterStudentId === 'function') {
      return this._getCourseLessonRosterStudentId(student);
    }
    return String(student?.studentId || student?.id || student?._docId || '').trim();
  },

  _getCoursePlanLessonDisplayKind(student) {
    if (typeof this._getCourseLessonRosterDisplayKind === 'function') {
      return this._getCourseLessonRosterDisplayKind(student, { planType: 'weekly' });
    }
    const kind = String(student?.attendanceKind || '').trim();
    if (kind === 'leave' || kind === 'registered' || kind === 'signin' || kind === 'pending') return kind;
    return 'leave';
  },

  _formatCoursePlanLessonConfirmDateTime(session) {
    if (typeof this._formatCourseLessonDateTime === 'function') {
      return this._formatCourseLessonDateTime(session);
    }
    const dateText = this._formatCourseSessionDate?.(session) || session?.date || '未排定日期';
    const timeText = this._formatCourseSessionTime?.(session)
      || [session?.startTime, session?.endTime].filter(Boolean).join(' - ')
      || '未設定時段';
    return dateText + ' ' + timeText;
  },

  _isCoursePlanNextLessonSessionRegisterable(session, options = {}) {
    if (!session) return false;
    const status = String(session.status || '').trim().toLowerCase();
    const inactiveStatuses = new Set(['cancelled', 'canceled', 'done', 'removed', 'completed', 'ended', 'closed']);
    if (inactiveStatuses.has(status)) return false;
    const parseDateOnly = (value) => {
      const match = String(value || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!match) return NaN;
      const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return Number.isFinite(parsed.getTime()) ? parsed.getTime() : NaN;
    };
    const sessionMs = parseDateOnly(session.date);
    const todayMs = parseDateOnly(options.today || this._todayStr?.());
    if (Number.isFinite(sessionMs) && Number.isFinite(todayMs) && sessionMs < todayMs) return false;
    return true;
  },

  showCoursePlanNextLessonRegisterDialog(teamId, planId, sessionId, button) {
    if (this._requireLogin?.()) return false;
    const safeTeamId = String(teamId || '').trim();
    const safePlanId = String(planId || '').trim();
    const safeSessionId = String(sessionId || '').trim();
    const hasRosterLoader = typeof FirebaseService !== 'undefined'
      && typeof FirebaseService.listEduCoursePublicRoster === 'function';
    if (!safeTeamId || !safePlanId || !safeSessionId || !hasRosterLoader) {
      this.showToast?.('找不到下一堂課資料');
      return false;
    }
    const run = async () => {
      let rosterPayload = null;
      try {
        rosterPayload = await FirebaseService.listEduCoursePublicRoster(safeTeamId, safePlanId, safeSessionId, { forceRefresh: true });
      } catch (err) {
        console.error('[course plan next lesson register] roster load failed:', err);
        this.showToast?.('課堂名單載入失敗，請稍後再試');
        return false;
      }
      this._rememberCourseLessonRosterPayload?.(safeTeamId, safePlanId, safeSessionId, rosterPayload);
      return this._openCoursePlanNextLessonRegisterDialog({
        teamId: safeTeamId,
        planId: safePlanId,
        sessionId: safeSessionId,
        rosterPayload,
        sourceButton: button || null,
      });
    };
    const promise = typeof this._withButtonLoading === 'function'
      ? this._withButtonLoading(button, '確認中...', run)
      : run();
    promise?.catch?.((err) => {
      console.error('[course plan next lesson register] dialog failed:', err);
      this.showToast?.('課堂報名暫時無法使用');
    });
    return false;
  },

  _openCoursePlanNextLessonRegisterDialog({ teamId, planId, sessionId, rosterPayload, sourceButton }) {
    const session = rosterPayload?.session || {};
    if (!this._isCoursePlanNextLessonSessionRegisterable(session)) {
      this.showToast?.('\u9019\u5802\u8ab2\u76ee\u524d\u7121\u6cd5\u5831\u540d');
      return false;
    }
    const students = Array.isArray(rosterPayload?.students) ? rosterPayload.students : [];
    const ownedStudents = students.filter(student => student?.canSelfLeave === true);
    const selectable = ownedStudents.filter((student) => {
      const kind = this._getCoursePlanLessonDisplayKind(student);
      return kind !== 'registered' && kind !== 'signin';
    });
    if (!ownedStudents.length) {
      this.showToast?.('這堂課目前沒有可報名的學員');
      return false;
    }
    if (!selectable.length) {
      this._markCoursePlanNextLessonRegistered(teamId, planId, sessionId);
      this._setCoursePlanNextLessonRegisterButtonRegistered(sourceButton);
      this.showToast?.('下一堂課已報名');
      return false;
    }
    document.querySelector?.('.edu-course-card-register-overlay')?.remove?.();
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay edu-course-card-register-overlay';
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
    const dateTimeText = this._formatCoursePlanLessonConfirmDateTime(session);
    const locationText = String(session.location || rosterPayload?.location || '地點未設定').trim() || '地點未設定';
    const titleText = String(session.title || session.topic || session.focus || '下一堂課').trim();
    const renderItem = (student) => {
      const id = this._getCoursePlanLessonStudentId(student);
      const kind = this._getCoursePlanLessonDisplayKind(student);
      const statusText = kind === 'registered' ? '已報名' : kind === 'signin' ? '已簽到' : '可報名';
      return '<label class="edu-ce-pick-item edu-course-card-register-pick">'
        + '<div class="edu-ce-pick-main"><span class="edu-ce-pick-name">' + escapeHTML(student.displayName || student.name || '學員') + '</span>'
        + '<span class="edu-ce-pick-info">' + escapeHTML(statusText) + '</span></div>'
        + '<input type="checkbox" value="' + escapeHTML(id) + '" checked></label>';
    };
    overlay.innerHTML = '<div class="edu-info-dialog edu-course-card-register-dialog" role="dialog" aria-modal="true">'
      + '<div class="edu-info-dialog-title">報名上課</div>'
      + '<div class="edu-course-card-register-summary">'
        + '<strong>' + escapeHTML(titleText) + '</strong>'
        + '<span>時間：' + escapeHTML(dateTimeText) + '</span>'
        + '<span>地點：' + escapeHTML(locationText) + '</span>'
      + '</div>'
      + '<div class="edu-info-dialog-body">請確認本堂課的時間與地點，按下確認後視同報名此場次課堂。</div>'
      + '<div class="edu-ce-pick-list">' + selectable.map(renderItem).join('') + '</div>'
      + '<div class="edu-course-card-register-actions">'
        + '<button type="button" class="outline-btn" onclick="this.closest(\'.edu-info-overlay\').remove()">取消</button>'
        + '<button type="button" class="primary-btn" data-edu-course-card-register-confirm="true">確認報名</button>'
      + '</div></div>';
    document.body.appendChild(overlay);
    const confirmButton = overlay.querySelector?.('[data-edu-course-card-register-confirm="true"]');
    if (confirmButton) {
      confirmButton.onclick = () => {
        const selectedIds = Array.from(overlay.querySelectorAll('.edu-ce-pick-list input[type="checkbox"]:checked'))
          .map(input => String(input.value || '').trim())
          .filter(Boolean);
        if (!selectedIds.length) {
          this.showToast?.('請選擇至少一位學員');
          return false;
        }
        const selected = selectedIds
          .map(id => selectable.find(student => this._getCoursePlanLessonStudentId(student) === id))
          .filter(Boolean);
        const save = async () => {
          let signedInPreservedCount = 0;
          try {
            for (const student of selected) {
              const studentId = this._getCoursePlanLessonStudentId(student);
              const result = await FirebaseService.saveEduCourseSelfAttendance({
                teamId,
                planId,
                sessionId,
                date: session.date,
                studentId,
                studentName: student.displayName || student.name || '',
                selfUid: student.selfUid || null,
                parentUid: student.parentUid || null,
                kind: 'registered',
              });
              if (result?.signedIn === true || result?.kind === 'signin') signedInPreservedCount += 1;
            }
          } catch (err) {
            console.error('[course plan next lesson register] save failed:', err);
            this.showToast?.('報名上課失敗，請稍後再試');
            return false;
          }
          overlay.remove();
          this._clearCourseLessonRosterPayloadCache?.(teamId, planId, sessionId);
          if (selected.length === selectable.length) {
            this._markCoursePlanNextLessonRegistered(teamId, planId, sessionId);
            this._setCoursePlanNextLessonRegisterButtonRegistered(sourceButton);
          }
          if (signedInPreservedCount === selected.length) this.showToast?.('已簽到，保留簽到狀態');
          else if (selected.length > 1) this.showToast?.('已完成 ' + selected.length + ' 位學員報名上課');
          else this.showToast?.('已完成報名上課');
          return true;
        };
        const savePromise = typeof this._withButtonLoading === 'function'
          ? this._withButtonLoading(confirmButton, '報名中...', save)
          : save();
        savePromise?.catch?.((err) => {
          console.error('[course plan next lesson register] save promise failed:', err);
          this.showToast?.('報名上課失敗，請稍後再試');
        });
        return false;
      };
    }
    return true;
  },
  _hasCoursePlanPriceValue(value) {
    if (value === null || value === undefined) return false;
    return String(value).trim() !== '';
  },

  _formatCoursePlanPriceLabel(value, options = {}) {
    if (!this._hasCoursePlanPriceValue(value)) return options.emptyText || '';
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return options.emptyText || '';
    if (amount === 0) return '\u514d\u8cbb';
    const prefix = options.prefix === undefined ? 'NT$ ' : String(options.prefix || '');
    return prefix + amount.toLocaleString();
  },

  _formatCoursePlanBillingLabel(plan, options = {}) {
    const isPerSession = typeof this._isCoursePlanPerSessionBilling === 'function'
      ? this._isCoursePlanPerSessionBilling(plan)
      : plan?.perSessionBilling === true;
    const priceText = this._formatCoursePlanPriceLabel(plan?.price, options);
    if (!isPerSession) return priceText;
    return priceText ? priceText + '/堂' : '隨堂收費';
  },

  _getCoursePlanViewerEnrollmentState(teamId, plan, options = {}) {
    const curUser = options.curUser || (typeof ApiService !== 'undefined' && typeof ApiService.getCurrentUser === 'function'
      ? ApiService.getCurrentUser()
      : null);
    const myUid = options.myUid || curUser?.uid || '';
    const students = Array.isArray(options.students)
      ? options.students
      : (this.getEduStudents?.(teamId) || []);
    const autoMigrationCompleted = typeof options.autoMigrationCompleted === 'boolean'
      ? options.autoMigrationCompleted
      : (typeof isEduAutoMigrationCompleted === 'function' && isEduAutoMigrationCompleted());
    const myStudents = myUid ? students.filter(s =>
      s?.enrollStatus !== 'inactive' && (s?.selfUid === myUid || s?.parentUid === myUid)
    ) : [];
    const enrollments = Array.isArray(options.enrollments)
      ? options.enrollments
      : (Array.isArray(plan?._enrollments) ? plan._enrollments : []);
    const summary = options.summary || plan?._enrollmentSummary || null;
    const enrolledStudentIds = new Set();
    const approvedStudentIds = new Set();
    const pendingStudentIds = new Set();
    const inactiveStatuses = new Set(['rejected', 'cancelled', 'canceled', 'removed']);
    const addViewerEnrollmentStatus = (studentId, rawStatus) => {
      const safeStudentId = String(studentId || '').trim();
      if (!safeStudentId) return;
      const status = String(rawStatus || 'approved').trim().toLowerCase();
      if (inactiveStatuses.has(status)) return;
      enrolledStudentIds.add(safeStudentId);
      if (status === 'pending') pendingStudentIds.add(safeStudentId);
      if (status === 'approved' || !status) approvedStudentIds.add(safeStudentId);
    };
    enrollments.forEach((enrollment) => {
      const studentId = String(enrollment?.studentId || '').trim();
      addViewerEnrollmentStatus(studentId, enrollment?.status);
    });
    const viewerStatuses = summary?.viewerStatuses || {};
    Object.keys(viewerStatuses).forEach((studentId) => {
      addViewerEnrollmentStatus(studentId, viewerStatuses[studentId]);
    });
    const groupId = String(plan?.groupId || '').trim();
    if (!autoMigrationCompleted && groupId) {
      students.filter(s => s?.enrollStatus === 'active' && (s?.groupIds || []).includes(groupId))
        .forEach(s => {
          const studentId = String(s?.id || s?._docId || '').trim();
          addViewerEnrollmentStatus(studentId, 'approved');
        });
    }
    const pendingStudents = myStudents.filter((student) => {
      const studentId = String(student?.id || student?._docId || '').trim();
      return !!studentId && pendingStudentIds.has(studentId);
    });
    const approvedStudents = myStudents.filter((student) => {
      const studentId = String(student?.id || student?._docId || '').trim();
      return !!studentId && approvedStudentIds.has(studentId);
    });
    const summaryCount = Number(summary?.effectiveApprovedCount);
    const effectiveCount = Number.isFinite(summaryCount)
      ? summaryCount
      : Number(plan?._effectiveCount || 0);
    const maxCapacity = Number(plan?.maxCapacity || 0);
    return {
      myStudents,
      enrolledStudentIds,
      approvedStudentIds,
      pendingStudentIds,
      pendingStudents,
      pendingCount: pendingStudents.length,
      approvedStudents,
      approvedCount: approvedStudents.length,
      hasApprovedEnrollment: approvedStudents.length > 0,
      allEnrolled: myStudents.length > 0 && myStudents.every((student) => {
        const studentId = String(student?.id || student?._docId || '').trim();
        return !!studentId && enrolledStudentIds.has(studentId);
      }) && pendingStudents.length === 0,
      isFull: Number.isFinite(maxCapacity) && maxCapacity > 0 && effectiveCount >= maxCapacity,
      effectiveCount,
      maxCapacity,
    };
  },

  _renderEduCoursePlanRefreshStatus(text) {
    if (typeof this._renderEduRefreshStatus === 'function') return this._renderEduRefreshStatus(text);
    return '<div class="edu-refresh-status" role="status" aria-live="polite"><span class="edu-inline-spinner" aria-hidden="true"></span><span>' + escapeHTML(text || '\u8cc7\u6599\u66f4\u65b0\u4e2d...') + '</span></div>';
  },

  _renderEduCoursePlanCachedList(teamId, isStaff, plans, options = {}) {
    const container = options.container || document.getElementById('edu-course-plan-list');
    if (!container || !Array.isArray(plans)) return false;
    const readOnly = options.readOnly === true || options.refreshing === true || options.refreshError === true;
    const today = this._todayStr?.() || (() => {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    const isPlanEnded = (plan) => !!(plan && plan.endDate && plan.endDate < today);
    this._eduCoursePlanTabByTeam = this._eduCoursePlanTabByTeam || {};
    const selectedTab = this._eduCoursePlanTabByTeam[teamId] === 'ended' ? 'ended' : 'active';
    const curUser = ApiService.getCurrentUser();
    const myUid = curUser?.uid;
    const students = this.getEduStudents?.(teamId) || [];
    const autoMigrationCompleted = typeof isEduAutoMigrationCompleted === 'function'
      && isEduAutoMigrationCompleted();
    const listPlans = plans
      .filter(p => p && p.active !== false)
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      })
      .filter(p => isStaff || p.visibleOnTeamPage !== false);
    const currentPlans = listPlans.filter(p => !isPlanEnded(p));
    const endedPlans = listPlans.filter(isPlanEnded);
    const displayPlans = selectedTab === 'ended' ? endedPlans : currentPlans;
    const jsArg = (value) => escapeHTML(String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '));
    const renderCompactPill = (label, value, className = '') => '<span class="edu-cp-compact-pill ' + className + '"><span>' + escapeHTML(label) + '</span><strong>' + escapeHTML(value || '\u672a\u8a2d\u5b9a') + '</strong></span>';
    const getPlanKey = (plan) => String(plan?.id || plan?._docId || '').trim();
    const applyCachedCounts = (plan) => {
      const planId = getPlanKey(plan);
      const key = this._getCourseEnrollCacheKey?.(teamId, planId);
      const enrollments = key && Array.isArray(this._courseEnrollCache?.[key])
        ? this._courseEnrollCache[key]
        : (Array.isArray(plan?._enrollments) ? plan._enrollments : []);
      const summary = enrollments?._summary || (key && this._courseEnrollSummaryCache?.[key]) || plan?._enrollmentSummary || null;
      plan._enrollments = enrollments;
      plan._enrollmentSummary = summary;
      const summaryCount = Number(summary?.effectiveApprovedCount);
      if (Number.isFinite(summaryCount) && summaryCount >= 0) {
        plan._effectiveCount = summaryCount;
        return;
      }
      const approved = new Set(enrollments.filter(e => String(e?.status || 'approved') === 'approved').map(e => e.studentId));
      if (!autoMigrationCompleted && plan.groupId) {
        students.filter(s => s.enrollStatus === 'active' && (s.groupIds || []).includes(plan.groupId))
          .forEach(s => approved.add(s.id));
      }
      plan._effectiveCount = Number.isFinite(Number(plan._effectiveCount)) ? Number(plan._effectiveCount) : approved.size;
    };
    displayPlans.forEach(applyCachedCounts);
    const renderPlanCard = (p) => {
      const planId = getPlanKey(p);
      const planEnded = isPlanEnded(p);
      const hiddenClass = p.visibleOnTeamPage === false ? ' edu-cp-card-hidden' : '';
      const statusBadge = planEnded
        ? '<span class="edu-cp-status edu-cp-status-ended">\u5df2\u7d50\u675f</span>'
        : p.allowSignup
          ? '<span class="edu-cp-status edu-cp-status-open">\u958b\u653e\u5831\u540d</span>'
          : '<span class="edu-cp-status edu-cp-status-closed">\u672a\u958b\u653e</span>';
      const dateText = p.startDate ? p.startDate + ' ~ ' + (p.endDate || '') : '\u672a\u8a2d\u5b9a';
      const countText = (p._effectiveCount || 0) + (p.maxCapacity ? '/' + p.maxCapacity : '') + ' \u4eba';
      const coachName = String(p.coachName || p.coach || '').trim() || '\u672a\u8a2d\u5b9a';
      const priceText = typeof this._formatCoursePlanBillingLabel === 'function'
        ? this._formatCoursePlanBillingLabel(p, { prefix: 'NT$ ' })
        : this._formatCoursePlanPriceLabel?.(p.price, { prefix: 'NT$ ', emptyText: '' }) || '';
      const viewerEnrollmentState = this._getCoursePlanViewerEnrollmentState(teamId, p, {
        curUser,
        myUid,
        students,
        autoMigrationCompleted,
      });
      let signupBtn = '';
      if (p.allowSignup) {
        if (readOnly) {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn edu-cp-signup-disabled" disabled>\u66f4\u65b0\u4e2d</button>';
        } else if (planEnded) {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn edu-cp-signup-disabled" disabled>\u8ab2\u7a0b\u5df2\u7d50\u675f</button>';
        } else if (viewerEnrollmentState.pendingCount > 0) {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn edu-cp-signup-pending" onclick="event.stopPropagation();App.showCourseEnrollmentPendingCancelDialog(\'' + jsArg(teamId) + '\',\'' + jsArg(planId) + '\',this)">' + viewerEnrollmentState.pendingCount + '\u4f4d\u5b78\u54e1\u5be9\u6838\u4e2d</button>';
        } else if (viewerEnrollmentState.allEnrolled) {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn edu-cp-signup-disabled edu-cp-signup-enrolled" disabled>\u5b78\u54e1\u5df2\u5831\u540d</button>';
        } else if (viewerEnrollmentState.isFull) {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn edu-cp-signup-disabled" disabled>\u5df2\u6eff\u54e1</button>';
        } else {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn" onclick="event.stopPropagation();App.applyCourseEnrollment(\'' + jsArg(teamId) + '\',\'' + jsArg(planId) + '\',this)">\u5831\u540d</button>';
        }
      }
      const pendingReviewCount = isStaff ? Number(p._enrollmentSummary?.pendingReviewCount || 0) : 0;
      const pendingReviewBadge = pendingReviewCount > 0
        ? '<span class="notif-badge edu-cp-pending-badge" aria-hidden="true">' + escapeHTML(pendingReviewCount > 99 ? '99+' : String(pendingReviewCount)) + '</span>'
        : '';
      const manageHtml = isStaff
        ? (readOnly
          ? '<div class="edu-cp-manage-left">'
          + '<button type="button" class="edu-cp-manage-btn edu-cp-manage-list" disabled>\u540d\u55ae</button>'
          + '<button type="button" class="edu-cp-manage-btn edu-cp-manage-edit" disabled>\u7de8\u8f2f</button>'
          + '<button type="button" class="edu-cp-manage-btn edu-cp-manage-danger" disabled>\u522a\u9664</button>'
          + '</div>'
          : '<div class="edu-cp-manage-left">'
          + '<button type="button" class="edu-cp-manage-btn edu-cp-manage-list' + (pendingReviewCount > 0 ? ' has-pending-review' : '') + '" onclick="event.stopPropagation();App.showCourseEnrollmentList(\'' + jsArg(teamId) + '\',\'' + jsArg(planId) + '\')">\u540d\u55ae' + pendingReviewBadge + '</button>'
          + '<button type="button" class="edu-cp-manage-btn edu-cp-manage-edit" onclick="event.stopPropagation();App.showEduCoursePlanForm(\'' + jsArg(teamId) + '\',\'' + jsArg(planId) + '\')">\u7de8\u8f2f</button>'
          + '<button type="button" class="edu-cp-manage-btn edu-cp-manage-danger" onclick="event.stopPropagation();App.deleteEduCoursePlan(\'' + jsArg(teamId) + '\',\'' + jsArg(planId) + '\')">\u522a\u9664</button>'
          + '</div>')
        : '';
      const detailBtn = readOnly
        ? '<button class="outline-btn edu-cp-detail-btn" disabled>\u8a73\u7d30\u8cc7\u6599</button>'
        : '<button class="outline-btn edu-cp-detail-btn" onclick="event.stopPropagation();App.showEduCoursePlanDetail(\'' + jsArg(teamId) + '\',\'' + jsArg(planId) + '\')">\u8a73\u7d30\u8cc7\u6599</button>';
      const lessonsBtn = readOnly
        ? '<button class="outline-btn edu-cp-lessons-btn" disabled>\u8ab2\u5802\u5217\u8868</button>'
        : '<button class="outline-btn edu-cp-lessons-btn" onclick="event.stopPropagation();App.showCourseLessons(\'' + jsArg(teamId) + '\',\'' + jsArg(planId) + '\')">\u8ab2\u5802\u5217\u8868</button>';
      return '<div class="edu-course-card edu-cp-card-v3 edu-cp-card-compact edu-cp-card-' + (p.planType === 'weekly' ? 'weekly' : 'session') + hiddenClass + '" data-course-plan-id="' + escapeHTML(planId) + '">'
        + '<div class="edu-cp-compact-main">'
        + '<div class="edu-cp-compact-title">'
        + '<span class="edu-course-name">' + escapeHTML(p.name || '\u672a\u547d\u540d\u8ab2\u7a0b') + '</span>'
        + statusBadge
        + '</div>'
        + '<div class="edu-cp-compact-pills">'
        + renderCompactPill('\u671f\u9593', dateText, 'edu-cp-date-pill')
        + (priceText ? renderCompactPill('\u8cbb\u7528', priceText, 'edu-cp-fee-pill') : '')
        + renderCompactPill('\u4eba\u6578', countText, 'edu-cp-count-pill')
        + renderCompactPill('\u6559\u7df4', coachName, 'edu-cp-coach-pill')
        + '</div>'
        + '</div>'
        + '<div class="edu-cp-card-actions">' + detailBtn + lessonsBtn + signupBtn + '</div>'
        + manageHtml
        + '</div>';
    };
    const groupedPlans = [
      { type: 'weekly', title: '\u9031\u671f\u8ab2\u7a0b', hint: '\u56fa\u5b9a\u9031\u671f\u8207\u6642\u6bb5', plans: displayPlans.filter(p => p.planType === 'weekly') },
      { type: 'session', title: '\u55ae\u6b21\u8ab2\u7a0b', hint: '\u6309\u5834\u6b21\u5b89\u6392', plans: displayPlans.filter(p => p.planType !== 'weekly') },
    ].filter(group => group.plans.length);
    const tabHtml = '<div class="edu-cp-view-tabs">'
      + '<button type="button" class="' + (selectedTab === 'active' ? 'active' : '') + '" onclick="App.switchEduCoursePlanTab(\'' + teamId + '\',\'active\')">\u8ab2\u7a0b\u4e2d <span>' + currentPlans.length + '</span></button>'
      + '<button type="button" class="' + (selectedTab === 'ended' ? 'active' : '') + '" onclick="App.switchEduCoursePlanTab(\'' + teamId + '\',\'ended\')">\u5df2\u7d50\u675f <span>' + endedPlans.length + '</span></button>'
      + '</div>';
    const emptyText = selectedTab === 'ended' ? '\u76ee\u524d\u6c92\u6709\u5df2\u7d50\u675f\u8ab2\u7a0b' : '\u76ee\u524d\u6c92\u6709\u9032\u884c\u4e2d\u8ab2\u7a0b';
    const listHtml = groupedPlans.length
      ? groupedPlans.map(group => '<section class="edu-course-plan-section edu-course-plan-section-' + group.type + '">'
        + '<div class="edu-course-plan-section-head"><div><strong>' + group.title + '</strong><span>' + group.hint + '</span></div><em>' + group.plans.length + ' \u500b\u8ab2\u7a0b</em></div>'
        + '<div class="edu-course-plan-grid">' + group.plans.map(renderPlanCard).join('') + '</div>'
        + '</section>').join('')
      : '<div class="edu-empty-state">' + emptyText + '</div>';
    const refreshHtml = options.refreshError === true
      ? this._renderEduCoursePlanRefreshStatus('\u8ab2\u7a0b\u8cc7\u6599\u66ab\u6642\u7121\u6cd5\u66f4\u65b0\uff0c\u5148\u986f\u793a\u4e0a\u6b21\u8cc7\u6599')
      : (options.refreshing === true ? this._renderEduCoursePlanRefreshStatus('\u8ab2\u7a0b\u8cc7\u6599\u66f4\u65b0\u4e2d...') : '');
    container.innerHTML = tabHtml + '<div class="edu-course-plan-sections">'
      + refreshHtml
      + listHtml
      + '</div>';
    this._applyEduCoursePlanShareFocus?.(teamId);
    return true;
  },

  async renderEduCoursePlanList(teamId, isStaff, options = {}) {
    const container = document.getElementById('edu-course-plan-list');
    if (!container) return;
    const requestSeq = ++this._eduCoursePlanListRequestSeq;
    const isStale = () => requestSeq !== this._eduCoursePlanListRequestSeq
      || document.getElementById('edu-course-plan-list') !== container
      || (this._eduDetailTeamId && this._eduDetailTeamId !== teamId)
      || (this.currentPage && this.currentPage !== 'page-team-detail');
    const forceRefresh = !!options.forceRefresh;

    // 若未傳入 isStaff，自動判斷
    if (isStaff === undefined) isStaff = this.isEduClubStaff(teamId);
    const hasCachedPlans = Array.isArray(this._eduCoursePlansCache?.[teamId]);
    if (hasCachedPlans) {
      this._renderEduCoursePlanCachedList(teamId, isStaff, this._eduCoursePlansCache[teamId], {
        container,
        refreshing: true,
        readOnly: true,
      });
    }
    if (forceRefresh) {
      if (!hasCachedPlans) container.innerHTML = this._renderEduCoursePlanLoading('\u6b63\u5728\u66f4\u65b0\u8ab2\u7a0b\u72c0\u614b');
      if (typeof this._loadEduStudents === 'function') {
        await this._loadEduStudents(teamId);
        if (isStale()) return false;
      }
    } else {
      const currentHtml = String(container.innerHTML || '').trim();
      if (!hasCachedPlans && (!currentHtml || currentHtml.indexOf('edu-loading') !== -1)) {
        container.innerHTML = this._renderEduCoursePlanLoading('\u8ab2\u7a0b\u8cc7\u6599\u8f09\u5165\u4e2d');
      }
    }

    const plans = await this._loadEduCoursePlans(teamId);
    if (isStale()) return false;
    const loadFailed = this._eduCoursePlanLoadFailedByTeam?.[teamId] === true;
    if (loadFailed && Array.isArray(this._eduCoursePlansCache?.[teamId])) {
      this._renderEduCoursePlanCachedList(teamId, isStaff, this._eduCoursePlansCache[teamId], {
        container,
        readOnly: true,
        refreshError: true,
      });
      return true;
    }
    const activePlans = plans.filter(p => p.active !== false)
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });

    if (!activePlans.length) {
      container.innerHTML = '<div class="edu-empty-state">尚未建立課程方案</div>';
      return;
    }

    // 取得當前用戶的報名狀態（用於學員視角按鈕）
    const today = this._todayStr?.() || (() => {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    const isPlanEnded = (plan) => !!(plan && plan.endDate && plan.endDate < today);
    this._eduCoursePlanTabByTeam = this._eduCoursePlanTabByTeam || {};
    const selectedTab = this._eduCoursePlanTabByTeam[teamId] === 'ended' ? 'ended' : 'active';

    const curUser = ApiService.getCurrentUser();
    const myUid = curUser?.uid;
    const students = this.getEduStudents(teamId);
    const autoMigrationCompleted = typeof isEduAutoMigrationCompleted === 'function'
      && isEduAutoMigrationCompleted();

    // Counts start from cache; background refresh updates only visible plans.
    const applyEnrollmentState = (p, enrollments, summary) => {
      try {
        const key = this._getCourseEnrollCacheKey?.(teamId, p.id);
        p._enrollments = Array.isArray(enrollments) ? enrollments : [];
        p._enrollmentSummary = summary
          || p._enrollments?._summary
          || (key && this._courseEnrollSummaryCache?.[key])
          || null;
      } catch (_) { p._enrollments = []; p._enrollmentSummary = null; }
      const summaryCount = Number(p._enrollmentSummary?.effectiveApprovedCount);
      if (Number.isFinite(summaryCount) && summaryCount >= 0) {
        p._effectiveCount = summaryCount;
      } else {
        const enrolledIds = new Set(p._enrollments.filter(e => e.status === 'approved').map(e => e.studentId));
        if (!autoMigrationCompleted && p.groupId) {
          students.filter(s => s.enrollStatus === 'active' && (s.groupIds || []).includes(p.groupId))
            .forEach(s => enrolledIds.add(s.id));
        }
        p._effectiveCount = enrolledIds.size;
      }
    };

    const applyCachedEnrollmentState = (p) => {
      const key = this._getCourseEnrollCacheKey?.(teamId, p.id);
      const hasCachedEnrollments = !!(key && Array.isArray(this._courseEnrollCache?.[key]));
      const cachedEnrollments = hasCachedEnrollments
        ? this._courseEnrollCache[key]
        : (Array.isArray(p._enrollments) ? p._enrollments : []);
      const cachedSummary = cachedEnrollments?._summary
        || (key && this._courseEnrollSummaryCache?.[key])
        || p._enrollmentSummary
        || null;
      applyEnrollmentState(p, cachedEnrollments, cachedSummary);
    };

    const listPlans = activePlans.filter(p => isStaff || p.visibleOnTeamPage !== false);
    const currentPlans = listPlans.filter(p => !isPlanEnded(p));
    const endedPlans = listPlans.filter(isPlanEnded);
    const displayPlans = selectedTab === 'ended' ? endedPlans : currentPlans;
    displayPlans.forEach(applyCachedEnrollmentState);
    const frozenCounts = {};
    await Promise.all(displayPlans.filter(isPlanEnded).map(async (p) => {
      const frozenCount = await this._getCoursePlanFrozenSessionCount?.(teamId, p);
      const frozenKey = String(p.id || p._docId || '').trim();
      if (frozenKey && Number.isFinite(frozenCount) && frozenCount >= 0) frozenCounts[frozenKey] = frozenCount;
    }));
    const applyFrozenCount = (p) => {
      const frozenCount = frozenCounts[String(p.id || p._docId || '').trim()];
      if (Number.isFinite(frozenCount) && frozenCount >= 0) p._effectiveCount = frozenCount;
    };
    displayPlans.forEach(applyFrozenCount);
    const nextLessonLabels = {};
    const nextLessonEntries = {};
    const getPlanKey = (plan) => String(plan?.id || plan?._docId || '').trim();
    await Promise.all(displayPlans.filter(p => !isPlanEnded(p)).map(async (p) => {
      const planKey = getPlanKey(p);
      if (!planKey) return;
      const cacheKey = this._getCourseSessionCacheKey?.(teamId, planKey);
      let sessions = cacheKey && Array.isArray(this._courseSessionCache?.[cacheKey])
        ? this._courseSessionCache[cacheKey]
        : [];
      if (!sessions.length && typeof this._loadCourseSessions === 'function') {
        try {
          sessions = await this._loadCourseSessions(teamId, planKey);
        } catch (err) {
          console.warn('[edu-course-plan] next lesson badge sessions failed:', err);
          sessions = [];
        }
      }
      const nextSessionItem = this._getCoursePlanNextSessionItem?.(sessions, { today }) || null;
      if (nextSessionItem?.session) nextLessonEntries[planKey] = nextSessionItem;
      const label = this._getCoursePlanCardNextLessonLabel?.(p, sessions, { today }) || '';
      if (label) nextLessonLabels[planKey] = label;
    }));
    if (isStale()) return false;

    const formatMoney = (value) => {
      return this._formatCoursePlanPriceLabel?.(value, { prefix: 'NT$ ', emptyText: '' }) || '';
    };
    const renderCompactPill = (label, value, className = '') => '<span class="edu-cp-compact-pill ' + className + '"><span>' + escapeHTML(label) + '</span><strong>' + escapeHTML(value || '未設定') + '</strong></span>';
    const jsArg = (value) => escapeHTML(String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '));
    const getPendingReviewCount = (p) => {
      const summaryCount = Number(p?._enrollmentSummary?.pendingReviewCount);
      if (Number.isFinite(summaryCount) && summaryCount >= 0) return Math.trunc(summaryCount);
      const enrollments = Array.isArray(p?._enrollments) ? p._enrollments : [];
      return enrollments.filter(e => String(e?.status || '').trim().toLowerCase() === 'pending').length;
    };
    const renderPlanCard = (p) => {
      const coverImage = String(this._getCoursePlanCoverUrl?.(p) || p.coverImage || p.coverUrl || p.imageUrl || p.image || p.imageVariants?.cover || '').trim();
      const coverClass = coverImage ? ' has-cover' : '';
      const coverHtml = coverImage
        ? '<img class="edu-cp-compact-cover" src="' + escapeHTML(coverImage) + '" alt="" loading="lazy" decoding="async">'
        : '';
      const isHidden = p.visibleOnTeamPage === false;
      const hiddenClass = isHidden ? ' edu-cp-card-hidden' : '';
      const hiddenBadge = isStaff && isHidden ? '<span class="edu-cp-card-hidden-badge">未公開</span>' : '';
      const planEnded = isPlanEnded(p);
      const viewerEnrollmentStateForBadge = this._getCoursePlanViewerEnrollmentState(teamId, p, {
        curUser,
        myUid,
        students,
        autoMigrationCompleted,
      });
      const hasApprovedEnrollment = viewerEnrollmentStateForBadge.hasApprovedEnrollment === true;
      const planKey = getPlanKey(p);
      const nextLessonLabel = nextLessonLabels[planKey] || '';
      const nextLessonEntry = nextLessonEntries[planKey] || null;
      const nextLessonSession = nextLessonEntry?.session || null;
      const nextLessonSessionId = String(nextLessonSession?.id || nextLessonSession?._docId || '').trim();
      const nextLessonDateLabel = String(nextLessonLabel || '').replace(/^下堂課\s*/, '').trim();
      const nextLessonRegistered = nextLessonSessionId && this._isCoursePlanNextLessonRegistered?.(teamId, planKey, nextLessonSessionId);
      const canRegisterNextLesson = !isStaff && p.planType === 'weekly' && !planEnded && p.rosterPublic !== false && hasApprovedEnrollment && !!nextLessonSessionId && this._isCoursePlanNextLessonSessionRegisterable(nextLessonSession, { today });
      const nextLessonBadgeLabel = canRegisterNextLesson && !nextLessonRegistered ? '下堂課' : nextLessonLabel;
      const nextLessonBadge = nextLessonBadgeLabel ? '<span class="edu-cp-next-lesson-badge">' + escapeHTML(nextLessonBadgeLabel) + '</span>' : '';
      const lessonRegisterBtn = canRegisterNextLesson
        ? (nextLessonRegistered
          ? '<button type="button" class="edu-cp-next-lesson-register-btn is-registered" disabled aria-disabled="true">已報名</button>'
          : '<button type="button" class="edu-cp-next-lesson-register-btn" onclick="event.stopPropagation();return App.showCoursePlanNextLessonRegisterDialog(\'' + jsArg(teamId) + '\',\'' + jsArg(planKey) + '\',\'' + jsArg(nextLessonSessionId) + '\',this)">立即報名' + escapeHTML(nextLessonDateLabel || '這堂課') + '的課程</button>')
        : '';
      const nextLessonActionHtml = nextLessonBadge || lessonRegisterBtn
        ? '<div class="edu-cp-next-lesson-action">' + nextLessonBadge + lessonRegisterBtn + '</div>'
        : '';
      const topBadgeHtml = nextLessonActionHtml || hiddenBadge
        ? '<div class="edu-cp-top-badges">' + nextLessonActionHtml + hiddenBadge + '</div>'
        : '';
      const statusBadge = planEnded
        ? '<span class="edu-cp-status edu-cp-status-ended">已結束</span>'
        : p.allowSignup
          ? '<span class="edu-cp-status edu-cp-status-open">招生中</span>'
          : '<span class="edu-cp-status edu-cp-status-closed">暫停報名</span>';

      // 課程是否已結束
      const isEnded = planEnded;

      // Compact card info: keep only the fields needed for scan-and-decide.
      const dateText = p.startDate ? p.startDate + ' ~ ' + (p.endDate || '') : '未設定';
      const countText = (p._effectiveCount || 0) + (p.maxCapacity ? '/' + p.maxCapacity : '') + ' 人';
      const coachName = String(p.coachName || p.coach || '').trim() || '未指定教練';
      const priceText = typeof this._formatCoursePlanBillingLabel === 'function'
        ? this._formatCoursePlanBillingLabel(p, { prefix: 'NT$ ' })
        : formatMoney(p.price);
      const infoHtml = '<div class="edu-cp-compact-pills">'
        + renderCompactPill('上課', dateText, 'edu-cp-date-pill')
        + (priceText ? renderCompactPill('費用', priceText, 'edu-cp-fee-pill') : '')
        + renderCompactPill('人數', countText, 'edu-cp-count-pill')
        + renderCompactPill('教練', coachName, 'edu-cp-coach-pill')
        + '</div>';

      // 學員報名按鈕
      const viewerEnrollmentState = viewerEnrollmentStateForBadge;
      let signupBtn = '';
      if (p.allowSignup) {
        if (isEnded) {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn edu-cp-signup-disabled" disabled>課程已結束</button>';
        } else {
        if (viewerEnrollmentState.pendingCount > 0) {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn edu-cp-signup-pending" onclick="event.stopPropagation();App.showCourseEnrollmentPendingCancelDialog(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\',this)">' + viewerEnrollmentState.pendingCount + '位學員審核中</button>';
        } else if (viewerEnrollmentState.allEnrolled) {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn edu-cp-signup-disabled edu-cp-signup-enrolled" disabled>學員皆已報名</button>';
        } else if (viewerEnrollmentState.isFull) {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn edu-cp-signup-disabled" disabled>已額滿</button>';
        } else {
          signupBtn = '<button class="primary-btn edu-cp-signup-btn" onclick="event.stopPropagation();App.applyCourseEnrollment(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\',this)">我要報名</button>';
        }
        } // end else (not ended)
      }

      // 管理按鈕（報名按鈕之下，左對齊 + 右側排序按鈕）
      const idx = displayPlans.indexOf(p);
      const pendingReviewCount = isStaff ? getPendingReviewCount(p) : 0;
      const pendingReviewText = pendingReviewCount > 99 ? '99+' : String(pendingReviewCount);
      const pendingReviewBadge = pendingReviewCount > 0
        ? '<span class="notif-badge edu-cp-pending-badge" aria-hidden="true">' + escapeHTML(pendingReviewText) + '</span>'
        : '';
      const manageListLabel = pendingReviewCount > 0 ? '名單，' + pendingReviewCount + ' 筆待審核' : '名單';
      const manageHtml = isStaff
        ? '<div class="edu-cp-manage-left">'
          + '<button type="button" class="edu-cp-manage-btn edu-cp-manage-list' + (pendingReviewCount > 0 ? ' has-pending-review' : '') + '" aria-label="' + escapeHTML(manageListLabel) + '" onclick="event.stopPropagation();App.showCourseEnrollmentList(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\')">名單' + pendingReviewBadge + '</button>'
          + '<button type="button" class="edu-cp-manage-btn edu-cp-manage-edit" onclick="event.stopPropagation();App.showEduCoursePlanForm(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\')">編輯</button>'
          + '<button type="button" class="edu-cp-manage-btn edu-cp-manage-danger" onclick="event.stopPropagation();App.deleteEduCoursePlan(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\')">刪除</button>'
          + '<span class="edu-cp-manage-sort">'
          + (idx > 0 ? '<button type="button" class="edu-cp-manage-icon-btn" onclick="event.stopPropagation();App._moveCoursePlan(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\',-1)" title="向上">▲</button>' : '')
          + (idx < displayPlans.length - 1 ? '<button type="button" class="edu-cp-manage-icon-btn" onclick="event.stopPropagation();App._moveCoursePlan(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\',1)" title="向下">▼</button>' : '')
          + '<button type="button" class="edu-cp-manage-icon-btn edu-cp-pin-btn' + (p.pinned ? ' edu-cp-pin-active' : '') + '" onclick="event.stopPropagation();App._moveCoursePlan(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\',0)" title="' + (p.pinned ? '取消置頂' : '置頂') + '">★</button>'
          + '</span>'
          + '</div>'
        : '';

      const shareHtml = !isHidden
        ? '<button type="button" class="edu-cp-share-btn" aria-label="分享課程 ' + escapeHTML(p.name || '') + '" title="分享課程" onclick="event.stopPropagation();App.shareEduCoursePlan(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\',{courseTab:\'' + selectedTab + '\'})">' + this._buildEduCoursePlanShareSvg() + '</button>'
        : '';
      const detailBtn = '<button class="outline-btn edu-cp-detail-btn" onclick="event.stopPropagation();App.showEduCoursePlanDetail(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\')">詳細資訊</button>';
      const lessonsBtnClass = 'outline-btn edu-cp-lessons-btn' + (hasApprovedEnrollment ? ' edu-cp-lessons-btn-enrolled' : '');
      const lessonsBtnLabel = hasApprovedEnrollment ? '課堂列表（已報名）' : '課堂列表';
      const lessonsBtnCheck = hasApprovedEnrollment ? '<span class="edu-cp-lessons-check" aria-hidden="true">✓</span>' : '';
      const lessonsBtn = '<button class="' + lessonsBtnClass + '" aria-label="' + lessonsBtnLabel + '" onclick="event.stopPropagation();App.showCourseLessons(\'' + jsArg(teamId) + '\',\'' + jsArg(p.id) + '\')">課堂列表' + lessonsBtnCheck + '</button>';

      return '<div class="edu-course-card edu-cp-card-v3 edu-cp-card-compact edu-cp-card-' + (p.planType === 'weekly' ? 'weekly' : 'session') + hiddenClass + coverClass + (hasApprovedEnrollment ? ' edu-cp-card-enrolled' : '') + '" data-course-plan-id="' + escapeHTML(p.id || '') + '">'
        + coverHtml
        + topBadgeHtml
        + '<div class="edu-cp-compact-main">'
        + '<div class="edu-cp-compact-title">'
        + shareHtml
        + '<span class="edu-course-name">' + escapeHTML(p.name) + '</span>'
        + statusBadge
        + '</div>'
        + infoHtml
        + '</div>'
        + '<div class="edu-cp-card-actions">' + detailBtn + lessonsBtn + signupBtn + '</div>'
        + manageHtml
        + '</div>';
    };

    const renderCoursePlanSections = () => {
      const groupedPlans = [
      {
        type: 'weekly',
        title: '固定週期課程',
        hint: '固定日期與時段，適合長期訓練。',
        plans: displayPlans.filter(p => p.planType === 'weekly'),
      },
      {
        type: 'session',
        title: '堂數制課程',
        hint: '依堂數安排，適合彈性訓練。',
        plans: displayPlans.filter(p => p.planType !== 'weekly'),
      },
      ].filter(group => group.plans.length);

    const tabHtml = '<div class="edu-cp-view-tabs">'
      + '<button type="button" class="' + (selectedTab === 'active' ? 'active' : '') + '" onclick="App.switchEduCoursePlanTab(\'' + teamId + '\',\'active\')">\u8ab2\u7a0b\u4e2d <span>' + currentPlans.length + '</span></button>'
      + '<button type="button" class="' + (selectedTab === 'ended' ? 'active' : '') + '" onclick="App.switchEduCoursePlanTab(\'' + teamId + '\',\'ended\')">\u5df2\u7d50\u675f <span>' + endedPlans.length + '</span></button>'
      + '</div>';
    const emptyText = selectedTab === 'ended' ? '\u76ee\u524d\u6c92\u6709\u5df2\u7d50\u675f\u8ab2\u7a0b' : '\u76ee\u524d\u6c92\u6709\u9032\u884c\u4e2d\u8ab2\u7a0b';
    const listHtml = groupedPlans.length
      ? groupedPlans.map(group => '<section class="edu-course-plan-section edu-course-plan-section-' + group.type + '">'
          + '<div class="edu-course-plan-section-head"><div><strong>' + group.title + '</strong><span>' + group.hint + '</span></div><em>' + group.plans.length + ' 個方案</em></div>'
          + '<div class="edu-course-plan-grid">' + group.plans.map(renderPlanCard).join('') + '</div>'
          + '</section>').join('')
      : '<div class="edu-empty-state">' + emptyText + '</div>';

    container.innerHTML = tabHtml + '<div class="edu-course-plan-sections">'
      + listHtml
      + '</div>';
    this._applyEduCoursePlanShareFocus?.(teamId);
    };

    renderCoursePlanSections();
    this._preloadCourseLessonsForPlans?.(teamId, currentPlans);

    const refreshPlans = displayPlans.filter((p) => {
      const key = this._getCourseEnrollCacheKey?.(teamId, p.id);
      if (!key || typeof this._loadCourseEnrollments !== 'function') return false;
      const cachedEnrollments = this._courseEnrollCache?.[key];
      const cachedSummary = cachedEnrollments?._summary || this._courseEnrollSummaryCache?.[key];
      return forceRefresh || !cachedSummary;
    });
    const refreshFromEnrollments = () => Promise.all(refreshPlans.map(async (p) => {
      try {
        const enrollments = await this._loadCourseEnrollments(teamId, p.id);
        applyEnrollmentState(p, enrollments, enrollments?._summary || null);
      } catch (_) {
        applyCachedEnrollmentState(p);
      }
    }));
    const renderAfterRefresh = () => {
      if (!isStale()) {
        renderCoursePlanSections();
        this._preloadCourseLessonsForPlans?.(teamId, currentPlans);
      }
      return true;
    };
    this._eduCoursePlanListRefreshPromise = refreshPlans.length
      ? (async () => {
          if (typeof this._loadCourseEnrollmentSummaries === 'function') {
            const summaries = await this._loadCourseEnrollmentSummaries(teamId, refreshPlans.map(p => p.id));
            if (summaries) {
              refreshPlans.forEach((p) => {
                const key = this._getCourseEnrollCacheKey?.(teamId, p.id);
                const cachedEnrollments = (key && this._courseEnrollCache?.[key]) || [];
                const summary = summaries[p.id]
                  || (key && this._courseEnrollSummaryCache?.[key])
                  || null;
                applyEnrollmentState(p, cachedEnrollments, summary);
                applyFrozenCount(p);
              });
              return renderAfterRefresh();
            }
          }
          await refreshFromEnrollments();
          displayPlans.forEach(applyFrozenCount);
          return renderAfterRefresh();
        })()
      : Promise.resolve(false);
  },

  switchEduCoursePlanTab(teamId, tab) {
    if (!teamId) return;
    this._eduCoursePlanTabByTeam = this._eduCoursePlanTabByTeam || {};
    this._eduCoursePlanTabByTeam[teamId] = tab === 'ended' ? 'ended' : 'active';
    return this.renderEduCoursePlanList(teamId, this.isEduClubStaff?.(teamId));
  },

  _renderCoursePlanHiddenNotice(plan) {
    const existing = document.querySelector?.('.edu-course-detail-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay edu-course-detail-overlay edu-course-detail-hidden-overlay';
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog edu-course-detail-hidden-dialog">'
      + '<div class="edu-info-dialog-title">課程尚未公開</div>'
      + '<div class="edu-info-dialog-body">「' + escapeHTML(plan?.name || '此課程') + '」目前只開放俱樂部職員管理，尚未顯示在公開課程清單。</div>'
      + '<button type="button" class="primary-btn" onclick="this.closest(\'.edu-info-overlay\').remove()">知道了</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

  async showEduCoursePlanDetail(teamId, planId) {
    const plan = (this.getEduCoursePlans?.(teamId) || []).find(item => String(item.id || item._docId || '') === String(planId || ''));
    if (!plan) {
      this.showToast?.('找不到課程資料');
      return;
    }
    const isStaff = !!this.isEduClubStaff?.(teamId);
    const curUser = typeof ApiService !== 'undefined' && typeof ApiService.getCurrentUser === 'function'
      ? ApiService.getCurrentUser()
      : null;
    const requestKey = teamId + ':' + planId + ':' + Date.now();
    this._eduCoursePlanDetailRequestKey = requestKey;
    if (plan.visibleOnTeamPage === false && !isStaff && !Array.isArray(plan._enrollments) && typeof this._loadCourseEnrollments === 'function') {
      try {
        plan._enrollments = await this._loadCourseEnrollments(teamId, plan.id);
      } catch (_) {
        plan._enrollments = [];
      }
      if (this._eduCoursePlanDetailRequestKey !== requestKey) return;
    }
    const canViewPlan = typeof this._isCoursePlanVisibleToUser === 'function'
      ? this._isCoursePlanVisibleToUser(plan, { uid: curUser?.uid, teamId, isStaff })
      : (isStaff || plan.visibleOnTeamPage !== false);
    if (!canViewPlan) {
      this._renderCoursePlanHiddenNotice?.(plan);
      return;
    }
    const detailPlanId = String(plan.id || plan._docId || planId || '').trim();
    const canShowSignupForViewer = !!plan.allowSignup && (isStaff || plan.visibleOnTeamPage !== false);
    const detailEnrollKey = this._getCourseEnrollCacheKey?.(teamId, detailPlanId);
    if (detailEnrollKey && this._courseEnrollSummaryCache?.[detailEnrollKey]) {
      plan._enrollmentSummary = this._courseEnrollSummaryCache[detailEnrollKey];
    }
    if (canShowSignupForViewer && !this._isCoursePlanEnded?.(plan) && !plan._enrollmentSummary) {
      try {
        if (typeof this._loadCourseEnrollmentSummaries === 'function') {
          const summaries = await this._loadCourseEnrollmentSummaries(teamId, [detailPlanId]);
          plan._enrollmentSummary = summaries?.[detailPlanId]
            || (detailEnrollKey && this._courseEnrollSummaryCache?.[detailEnrollKey])
            || plan._enrollmentSummary
            || null;
        }
        if (!plan._enrollmentSummary && typeof this._loadCourseEnrollments === 'function') {
          plan._enrollments = await this._loadCourseEnrollments(teamId, detailPlanId);
          plan._enrollmentSummary = plan._enrollments?._summary || null;
        }
      } catch (_) {
        plan._enrollmentSummary = plan._enrollmentSummary || null;
      }
      if (this._eduCoursePlanDetailRequestKey !== requestKey) return;
    }
    let sessions = [];
    if (plan.planType === 'session') {
      const cacheKey = this._getCourseSessionCacheKey?.(teamId, plan.id);
      sessions = (cacheKey && this._courseSessionCache?.[cacheKey]) || [];
      if (!sessions.length && typeof this._loadCourseSessions === 'function') {
        try {
          sessions = await this._loadCourseSessions(teamId, plan.id);
        } catch (_) {
          sessions = [];
        }
      }
      if (this._eduCoursePlanDetailRequestKey !== requestKey) return;
    }
    const jsArg = (value) => escapeHTML(String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '));
    const detailToday = this._todayStr?.() || (() => {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    const view = typeof this._normalizeCoursePlanViewModel === 'function'
      ? this._normalizeCoursePlanViewModel(plan)
      : {
          name: plan.name || '未命名課程',
          typeLabel: plan.planType === 'session' ? '堂數制' : '固定週期',
          groupName: plan.groupName || '未分班',
          coverUrl: String(plan.coverImage || plan.coverUrl || '').trim(),
          dateText: plan.startDate ? plan.startDate + ' ~ ' + (plan.endDate || '') : '未設定',
          scheduleText: plan.planType === 'weekly'
            ? ((plan.weekdays || []).map(day => '週' + this._weekdayLabel(day)).join('、') || '未設定') + (plan.timeSlot ? ' ' + plan.timeSlot : '')
            : '共 ' + (plan.totalSessions || 0) + ' 堂',
          priceText: this._formatCoursePlanPriceLabel?.(plan.price, { prefix: 'NT$ ', emptyText: '未填寫' }) || '未填寫',
          countText: (plan._effectiveCount || 0) + (plan.maxCapacity ? '/' + plan.maxCapacity : '') + ' 人',
          status: { label: plan.endDate && plan.endDate < detailToday ? '已結束' : (plan.allowSignup ? '招生中' : '暫停報名') },
          tags: [],
        };
    const existing = document.querySelector?.('.edu-course-detail-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay edu-course-detail-overlay';
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };

    const nextWeekly = this._getCoursePlanNextWeeklyOccurrence?.(plan);
    const formatCurrency = (value) => {
      return this._formatCoursePlanPriceLabel?.(value, { prefix: '$', emptyText: '未填寫' }) || '未填寫';
    };
    const parseDateOnly = (value) => {
      const parts = String(value || '').split('-').map(part => parseInt(part, 10));
      if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return null;
      return new Date(parts[0], parts[1] - 1, parts[2]);
    };
    const getStartTime = (value) => String(value || '').split(/[-~]/)[0].trim();
    const formatProgressDate = (dateValue, timeValue) => {
      const parsed = parseDateOnly(dateValue);
      const time = getStartTime(timeValue);
      if (!parsed) return [String(dateValue || '').trim(), time].filter(Boolean).join(' ');
      const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
      return (parsed.getMonth() + 1) + '/' + String(parsed.getDate()).padStart(2, '0')
        + '（' + weekdays[parsed.getDay()] + '）' + (time ? ' ' + time : '');
    };
    const getDateTimeMs = (dateValue, timeValue) => {
      const parsed = parseDateOnly(dateValue);
      if (!parsed) return 0;
      const match = getStartTime(timeValue).match(/^(\d{1,2}):(\d{2})/);
      if (match) parsed.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
      return parsed.getTime();
    };
    const getLessonStatusMeta = (lesson) => {
      const status = String(lesson?.status || '').trim();
      if (status === 'cancelled') return { label: '已取消', cls: 'is-cancelled' };
      if (status === 'done') return { label: '已上課', cls: 'is-done' };
      const timestamp = Number(lesson?.timestamp || 0);
      const now = Date.now();
      if (timestamp && timestamp < now - 6 * 60 * 60 * 1000) return { label: '已上課', cls: 'is-done' };
      if (timestamp && timestamp <= now + 7 * 24 * 60 * 60 * 1000) return { label: '即將上課', cls: 'is-soon' };
      return { label: '未上課', cls: 'is-upcoming' };
    };
    const weeklyDates = plan.planType === 'weekly' && typeof this.generateWeeklyDates === 'function'
      ? this.generateWeeklyDates(plan)
      : [];
    const weeklyStartTime = getStartTime(plan.timeSlot);
    const weeklyLessons = weeklyDates.length
      ? weeklyDates.map((date, index) => ({
          title: Array.isArray(plan.lessonTitles) && plan.lessonTitles[index] ? plan.lessonTitles[index] : '第 ' + (index + 1) + ' 堂課',
          dateLabel: formatProgressDate(date, weeklyStartTime),
          timestamp: getDateTimeMs(date, weeklyStartTime),
        }))
      : (nextWeekly ? [{
          title: '下一堂課',
          dateLabel: nextWeekly.label || '',
          timestamp: nextWeekly.timestamp || 0,
        }] : []);
    const sessionLessons = sessions.map((session, index) => {
      const fallbackDate = typeof this._formatCourseSessionDate === 'function'
        ? this._formatCourseSessionDate(session)
        : (session.date || '');
      const fallbackTime = typeof this._formatCourseSessionTime === 'function'
        ? this._formatCourseSessionTime(session)
        : [session.startTime, session.endTime].filter(Boolean).join(' - ');
      return {
        title: String(session.title || session.topic || session.focus || ('第 ' + (index + 1) + ' 堂課')).trim(),
        dateLabel: session.date
          ? formatProgressDate(session.date, session.startTime || fallbackTime)
          : [fallbackDate, getStartTime(fallbackTime)].filter(Boolean).join(' '),
        location: session.location || plan.location || '',
        status: session.status,
        timestamp: typeof this._getCourseSessionSortValue === 'function'
          ? this._getCourseSessionSortValue(session)
          : getDateTimeMs(session.date, session.startTime),
      };
    });
    const referenceSession = sessions.map(session => ({
      session,
      timestamp: typeof this._getCourseSessionSortValue === 'function'
        ? this._getCourseSessionSortValue(session)
        : getDateTimeMs(session.date, session.startTime),
    })).filter(item => item.timestamp)
      .sort((a, b) => Math.abs(a.timestamp - Date.now()) - Math.abs(b.timestamp - Date.now()))[0]?.session
      || sessions[0]
      || null;
    const teamRecord = (typeof this._getEduTeamRecord === 'function' ? this._getEduTeamRecord(teamId) : null)
      || (typeof ApiService !== 'undefined' && ApiService.getTeam ? ApiService.getTeam(teamId) : null)
      || {};
    const leaderNames = Array.isArray(teamRecord.leaders)
      ? teamRecord.leaders
      : (teamRecord.leader ? [teamRecord.leader] : []);
    const managerName = String(
      plan.managerName
      || plan.contactName
      || referenceSession?.managerName
      || teamRecord.captain
      || teamRecord.captainName
      || leaderNames[0]
      || plan.coachName
      || plan.coach
      || ''
    ).trim();
    const managerContact = String(
      plan.managerContact
      || plan.contact
      || referenceSession?.managerContact
      || teamRecord.contact
      || teamRecord.eduSettings?.contact
      || ''
    ).trim();
    const renderContactValue = (value) => {
      const raw = String(value || '').trim();
      if (!raw) return '<span class="edu-course-contact-value">未設定</span>';
      const isUrl = /^https?:\/\//i.test(raw) || /^line:\/\//i.test(raw) || /^mailto:/i.test(raw) || /^tel:/i.test(raw);
      if (!isUrl) return '<span class="edu-course-contact-value">' + escapeHTML(raw) + '</span>';
      return '<a class="edu-course-contact-value" href="' + escapeHTML(raw) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(raw) + '</a>';
    };
    const hasNumber = (value) => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value));
    const renderOptionalRow = (label, value) => {
      const raw = String(value == null ? '' : value).trim();
      if (!raw) return '';
      return '<div class="edu-course-detail-field-row"><span>' + escapeHTML(label) + '</span><strong>' + escapeHTML(raw) + '</strong></div>';
    };
    const renderOptionalSection = (className, title, rows) => {
      const body = rows.map(row => renderOptionalRow(row.label, row.value)).filter(Boolean).join('');
      return body
        ? '<section class="edu-course-detail-section ' + className + '"><h4>' + escapeHTML(title) + '</h4><div class="edu-course-detail-field-list">' + body + '</div></section>'
        : '';
    };
    const minAgeText = hasNumber(plan.minAge) ? String(Number(plan.minAge)) : '';
    const maxAgeText = hasNumber(plan.maxAge) ? String(Number(plan.maxAge)) : '';
    const ageRestrictionText = minAgeText && maxAgeText
      ? minAgeText + ' - ' + maxAgeText + ' 歲'
      : minAgeText
        ? minAgeText + ' 歲以上'
        : maxAgeText
          ? maxAgeText + ' 歲以下'
          : '';
    const genderRestrictionText = plan.genderRestriction === 'male'
      ? '限男性'
      : plan.genderRestriction === 'female'
        ? '限女性'
        : '';
    const minCapacityText = hasNumber(plan.minCapacity) ? String(Number(plan.minCapacity)) + ' 人開班' : '';
    const lessons = plan.planType === 'session' ? sessionLessons : weeklyLessons;
    const totalLessonCount = Number(plan.totalSessions || 0) || lessons.length;
    const visibleLessons = lessons;
    const hasPriceValue = this._hasCoursePlanPriceValue?.(plan.price) === true;
    const priceAmount = hasPriceValue ? Number(plan.price) : NaN;
    const priceSubText = hasPriceValue && priceAmount > 0 && totalLessonCount > 0
      ? totalLessonCount + ' 堂 · 約 $' + Math.round(priceAmount / totalLessonCount).toLocaleString() + '/堂'
      : (!hasPriceValue ? '課程價格未填寫' : (totalLessonCount > 0 ? totalLessonCount + ' 堂' : '課程價格'));
    const tagHtml = (view.tags || []).length
      ? '<div class="edu-course-detail-tags">' + view.tags.map(tag => '<span>' + escapeHTML(tag) + '</span>').join('') + '</div>'
      : '';
    const metaHtml = [
      { label: '期間', value: view.dateText, cls: 'period' },
      { label: '上課安排', value: view.scheduleText, cls: 'schedule' },
      { label: '下一堂', value: nextWeekly?.label || '未排定', cls: 'next' },
      { label: '地點', value: plan.location || '未設定', cls: 'location' },
      { label: '負責人', value: managerName || '未設定', cls: 'manager' },
      { label: '教練', value: plan.coachName || plan.coach || '未設定', cls: 'coach' },
      { label: '人數', value: view.countText, cls: 'capacity' },
    ].map(item => '<span class="edu-course-meta-card edu-course-meta-' + item.cls + '"><em>' + escapeHTML(item.label) + '</em><strong>' + escapeHTML(item.value) + '</strong></span>').join('');
    const courseContent = String(plan.courseContent || plan.description || '').trim();
    const courseContentHtml = '<section class="edu-course-detail-section edu-course-detail-content">'
      + '<h4>課程內容</h4>'
      + '<p class="edu-course-detail-copy">' + escapeHTML(courseContent || '尚未填寫課程內容。') + '</p>'
      + '</section>';
    const primaryTagSet = new Set((view.tags || []).map(tag => String(tag || '').trim()).filter(Boolean));
    const extraTagSet = new Set();
    const extraTags = [
      ...(Array.isArray(plan.targetTags) ? plan.targetTags : []),
      ...(Array.isArray(plan.includedTags) ? plan.includedTags : []),
      ...(Array.isArray(plan.requirementTags) ? plan.requirementTags : []),
    ].map(tag => String(tag || '').trim())
      .filter(tag => tag && !primaryTagSet.has(tag) && !extraTagSet.has(tag) && extraTagSet.add(tag))
      .slice(0, 9);
    const extraTagsHtml = extraTags.length
      ? '<div class="edu-course-detail-tags edu-course-detail-tags-secondary">' + extraTags.map(tag => '<span>' + escapeHTML(tag) + '</span>').join('') + '</div>'
      : '';
    const progressRowsHtml = visibleLessons.length
      ? visibleLessons.map((lesson, index) => {
          const statusMeta = getLessonStatusMeta(lesson);
          const lessonMeta = [lesson.dateLabel, lesson.location].filter(Boolean).join(' · ');
          return '<div class="edu-course-progress-row">'
            + '<span class="edu-course-progress-index">' + (index + 1) + '</span>'
            + '<div class="edu-course-progress-main">'
              + '<strong>' + escapeHTML(lesson.title || ('第 ' + (index + 1) + ' 堂課')) + '</strong>'
              + '<em>' + escapeHTML(lessonMeta || '時間待排定') + '</em>'
            + '</div>'
            + '<span class="edu-course-progress-status ' + statusMeta.cls + '">' + escapeHTML(statusMeta.label) + '</span>'
          + '</div>';
        }).join('')
        + (lessons.length > visibleLessons.length ? '<div class="edu-course-progress-more">還有 ' + (lessons.length - visibleLessons.length) + ' 堂課</div>' : '')
      : '<div class="edu-course-progress-empty">尚未建立課堂，建立後會顯示課程日期、時間與狀態。</div>';
    const progressHtml = '<section class="edu-course-detail-section edu-course-detail-progress">'
      + '<h4>課程進度（共 ' + (totalLessonCount || 0) + ' 堂）</h4>'
      + '<div class="edu-course-progress-list">' + progressRowsHtml + '</div>'
      + '</section>';
    const signupInfoHtml = renderOptionalSection('edu-course-detail-signup-info', '報名提醒', [
      { label: '報名截止', value: plan.signupDeadline },
      { label: '最低開班', value: minCapacityText },
      { label: '年齡提醒', value: ageRestrictionText },
      { label: '性別提醒', value: genderRestrictionText },
      { label: '試上說明', value: plan.trialSessionInfo },
    ]);
    const contactHtml = '<section class="edu-course-detail-section edu-course-detail-contact">'
      + '<h4>課務聯繫</h4>'
      + '<div class="edu-course-contact-list">'
        + '<div class="edu-course-contact-person"><span>負責人</span><strong>' + escapeHTML(managerName || '未設定') + '</strong></div>'
        + '<div class="edu-course-contact-channel"><span>聯繫方式</span>' + renderContactValue(managerContact) + '</div>'
        + (isStaff && String(plan.notifyTargets || '').trim() ? '<div class="edu-course-contact-notify"><span>報名通知</span><strong>' + escapeHTML(String(plan.notifyTargets || '').trim()) + '</strong></div>' : '')
      + '</div>'
      + '</section>';
    const policyHtml = renderOptionalSection('edu-course-detail-policy', '規則與付款', [
      { label: '付款方式', value: plan.paymentMethod },
      { label: '付款期限', value: plan.paymentDeadline },
      { label: '補課規則', value: plan.makeupPolicy },
      { label: '取消政策', value: plan.cancellationPolicy },
    ]);
    const signupReminderText = [ageRestrictionText, genderRestrictionText].filter(Boolean).join(' · ');
    const signupReminderHtml = signupReminderText
      ? '<div class="edu-course-detail-signup-note">提醒：' + escapeHTML(signupReminderText) + '</div>'
      : '';
    const viewerEnrollmentState = this._getCoursePlanViewerEnrollmentState?.(teamId, plan) || {};
    let signupActionHtml = '';
    if (canShowSignupForViewer) {
      if (this._isCoursePlanEnded?.(plan)) {
        signupActionHtml = '<button type="button" class="primary-btn edu-course-detail-signup-btn edu-cp-signup-disabled" disabled>課程已結束</button>';
      } else if (viewerEnrollmentState.pendingCount > 0) {
        signupActionHtml = '<button type="button" class="primary-btn edu-course-detail-signup-btn edu-cp-signup-pending" onclick="event.stopPropagation();App.showCourseEnrollmentPendingCancelDialog(\'' + jsArg(teamId) + '\',\'' + jsArg(plan.id) + '\',this)">' + viewerEnrollmentState.pendingCount + '位學員審核中</button>';
      } else if (viewerEnrollmentState.allEnrolled) {
        signupActionHtml = '<button type="button" class="primary-btn edu-course-detail-signup-btn edu-cp-signup-disabled edu-cp-signup-enrolled" disabled>學員皆已報名</button>';
      } else if (viewerEnrollmentState.isFull) {
        signupActionHtml = '<button type="button" class="primary-btn edu-course-detail-signup-btn edu-cp-signup-disabled" disabled>已額滿</button>';
      } else {
        signupActionHtml = '<button type="button" class="primary-btn edu-course-detail-signup-btn" onclick="event.stopPropagation();App.applyCourseEnrollment(\'' + jsArg(teamId) + '\',\'' + jsArg(plan.id) + '\',this)">我要報名</button>';
      }
    }
    const footerActionsBlock = signupActionHtml
      ? '<div class="edu-course-detail-footer-actions"><div class="edu-course-detail-signup-stack">'
        + signupReminderHtml
        + '<div class="edu-course-detail-signup-button-wrap">' + signupActionHtml + '</div>'
        + '</div></div>'
      : '';
    overlay.innerHTML = '<div class="edu-info-dialog edu-course-detail-dialog">'
      + '<div class="edu-course-detail-head">'
        + '<div>'
          + '<span class="edu-course-detail-eyebrow">' + escapeHTML(view.typeLabel) + ' · ' + escapeHTML(view.status?.label || '') + '</span>'
          + '<h3>' + escapeHTML(view.name) + '</h3>'
          + '<p>' + escapeHTML(view.groupName) + '</p>'
        + '</div>'
        + '<button class="modal-close-btn" onclick="this.closest(\'.edu-info-overlay\').remove()">×</button>'
      + '</div>'
      + '<div class="edu-course-detail-scroll">'
        + tagHtml
        + extraTagsHtml
        + '<div class="edu-course-detail-meta">' + metaHtml + '</div>'
        + courseContentHtml
        + signupInfoHtml
        + contactHtml
        + progressHtml
        + policyHtml
      + '</div>'
      + '<div class="edu-course-detail-footer">'
        + '<div class="edu-course-price-block"><strong>' + escapeHTML(formatCurrency(plan.price)) + '</strong><span>' + escapeHTML(priceSubText) + '</span></div>'
        + footerActionsBlock
      + '</div>'
      + '</div>';
    document.body.appendChild(overlay);
  },

});
