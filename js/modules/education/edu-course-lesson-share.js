/* ================================================
   SportHub — Education: Course Lesson Share
   ================================================ */

Object.assign(App, {
  _buildEduCourseLessonShareQuery(teamId, planId, sessionId, options = {}) {
    const params = new URLSearchParams();
    params.set('teamTab', 'courses');
    params.set('course', String(planId || '').trim());
    params.set('courseTab', options.courseTab === 'ended' ? 'ended' : 'active');
    params.set('courseView', 'roster');
    params.set('lesson', String(sessionId || '').trim());
    if (options.includeTeam !== false) params.set('team', String(teamId || '').trim());
    return params.toString();
  },

  _buildEduCourseLessonMiniAppShareUrl(teamId, planId, sessionId, options = {}) {
    const base = typeof MINI_APP_BASE_URL !== 'undefined' ? MINI_APP_BASE_URL : 'https://toosterx.com';
    const query = this._buildEduCourseLessonShareQuery(teamId, planId, sessionId, {
      ...options,
      includeTeam: true,
    });
    return base + '?' + query;
  },

  _buildEduCourseLessonWebShareUrl(teamId, planId, sessionId, options = {}) {
    const safeTeamId = encodeURIComponent(String(teamId || '').trim());
    const query = this._buildEduCourseLessonShareQuery(teamId, planId, sessionId, {
      ...options,
      includeTeam: false,
    });
    return 'https://toosterx.com/teams/' + safeTeamId + '?' + query;
  },

  _findEduCourseLessonShareData(teamId, planId, sessionId) {
    const safeTeamId = String(teamId || '').trim();
    const safePlanId = String(planId || '').trim();
    const safeSessionId = String(sessionId || '').trim();
    const context = this._eduCourseLessonsContext;
    const contextMatches = String(context?.teamId || '') === safeTeamId
      && String(context?.planId || '') === safePlanId;
    const plan = (contextMatches ? context?.plan : null)
      || (this.getEduCoursePlans?.(safeTeamId) || [])
        .find(item => String(item?.id || item?._docId || '') === safePlanId)
      || null;
    const contextSessions = contextMatches && Array.isArray(context?.sessions) ? context.sessions : [];
    const cachedSessions = typeof this._getCourseLessonsCachedSessions === 'function'
      ? (this._getCourseLessonsCachedSessions(safeTeamId, safePlanId) || [])
      : [];
    const session = [...contextSessions, ...cachedSessions]
      .find(item => String(item?.id || item?._docId || '') === safeSessionId)
      || null;
    return { plan, session };
  },

  _formatEduCourseLessonShareDateTime(session) {
    if (typeof this._formatCourseLessonDateTime === 'function') {
      return this._formatCourseLessonDateTime(session);
    }
    const date = String(session?.date || '').trim();
    const time = [session?.startTime, session?.endTime].filter(Boolean).join(' - ');
    return [date, time].filter(Boolean).join(' ');
  },

  _buildEduCourseLessonShareAltText(team, plan, session, shareUrl) {
    const title = session?.title || session?.topic || session?.focus || '課堂名單';
    const lines = [
      '「' + (plan?.name || '課程') + '」' + title,
      team?.name ? '俱樂部：' + team.name : '',
      this._formatEduCourseLessonShareDateTime(session) ? '時間：' + this._formatEduCourseLessonShareDateTime(session) : '',
      (session?.location || plan?.location) ? '地點：' + (session.location || plan.location) : '',
      '',
      shareUrl,
    ].filter((line, index) => index === 4 || String(line || '').trim());
    let text = lines.join('\n');
    if (text.length > 400) text = Array.from(text).slice(0, 397).join('') + '...';
    return text;
  },

  _buildEduCourseLessonFlexMessage(team, plan, session, liffUrl) {
    const brandColor = plan?.planType === 'session' ? '#7c3aed' : '#0d9488';
    const rows = [];
    const addRow = (label, value) => {
      const text = String(value || '').trim();
      if (!text) return;
      if (typeof this._buildFlexInfoRow === 'function') {
        rows.push(this._buildFlexInfoRow(label, text));
        return;
      }
      rows.push({
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: label, size: 'sm', color: '#888888', flex: 2 },
          { type: 'text', text, size: 'sm', color: '#333333', flex: 5, wrap: true },
        ],
      });
    };
    addRow('俱樂部', team?.name || '');
    addRow('時間', this._formatEduCourseLessonShareDateTime(session));
    addRow('地點', session?.location || plan?.location || '');
    const lessonTitle = session?.title || session?.topic || session?.focus || '課堂名單';
    const bubble = {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            width: '92px',
            paddingAll: '4px',
            paddingStart: '10px',
            paddingEnd: '10px',
            cornerRadius: '12px',
            backgroundColor: brandColor,
            contents: [{
              type: 'text',
              text: '課堂名單',
              size: 'xs',
              color: '#ffffff',
              weight: 'bold',
              align: 'center',
              gravity: 'center',
            }],
          },
          { type: 'text', text: plan?.name || '課程', weight: 'bold', size: 'lg', wrap: true, maxLines: 2, margin: 'md' },
          { type: 'text', text: lessonTitle, size: 'sm', color: '#64748b', wrap: true, maxLines: 2, margin: 'sm' },
          ...(rows.length ? [{ type: 'box', layout: 'vertical', contents: rows, margin: 'lg', spacing: 'sm' }] : []),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        contents: [{
          type: 'button',
          style: 'primary',
          color: brandColor,
          height: 'sm',
          action: { type: 'uri', label: '查看課堂名單', uri: liffUrl },
        }],
      },
    };
    const heroImage = String(
      this._getCoursePlanCoverUrl?.(plan)
      || plan?.coverImage
      || plan?.coverUrl
      || plan?.imageUrl
      || plan?.image
      || ''
    ).trim();
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

  async shareEduCourseLesson(teamId, planId, sessionId, options = {}) {
    if (this._shareInProgress) return false;
    this._shareInProgress = true;
    try {
      return await this._doShareEduCourseLesson(teamId, planId, sessionId, options);
    } finally {
      this._shareInProgress = false;
    }
  },

  async _doShareEduCourseLesson(teamId, planId, sessionId, options = {}) {
    const team = ApiService.getTeam?.(teamId) || {};
    const { plan, session } = this._findEduCourseLessonShareData(teamId, planId, sessionId);
    if (!plan || !session) {
      this.showToast?.('課堂資料尚未載入，請稍後再試');
      return false;
    }
    if (plan.visibleOnTeamPage === false && !this.isEduClubStaff?.(teamId)) {
      this.showToast?.('此課程尚未公開');
      return false;
    }
    const courseTab = options.courseTab === 'ended'
      ? 'ended'
      : (this._eduCoursePlanTabByTeam?.[teamId] === 'ended' ? 'ended' : 'active');
    const liffUrl = this._buildEduCourseLessonMiniAppShareUrl(teamId, planId, sessionId, { courseTab });
    const webUrl = this._buildEduCourseLessonWebShareUrl(teamId, planId, sessionId, { courseTab });
    const altText = this._buildEduCourseLessonShareAltText(team, plan, session, liffUrl);
    const canPicker = typeof this._canUseShareTargetPicker === 'function'
      ? await this._canUseShareTargetPicker()
      : false;
    const lineLoggedIn = typeof LineAuth !== 'undefined'
      && typeof LineAuth.isLoggedIn === 'function'
      && LineAuth.isLoggedIn();

    if ((canPicker || lineLoggedIn) && typeof this._showShareActionSheet === 'function') {
      const choice = await this._showShareActionSheet(canPicker, '分享課堂名單');
      if (choice === 'line') {
        if (!canPicker) {
          this.showToast?.('請在 LINE 中開啟以使用此功能');
          return false;
        }
        try {
          const result = await liff.shareTargetPicker([{
            type: 'flex',
            altText,
            contents: this._buildEduCourseLessonFlexMessage(team, plan, session, liffUrl),
          }]);
          this.showToast?.(result ? '課堂名單已分享到 LINE' : '分享已完成');
          return true;
        } catch (err) {
          console.warn('[EduCourseLessonShare] shareTargetPicker failed:', err);
          this.showToast?.('分享失敗，請稍後再試');
          return false;
        }
      }
      if (choice === 'line-share') {
        if (typeof this._openLineRShare === 'function') this._openLineRShare(altText);
        else window.open('https://line.me/R/share?text=' + encodeURIComponent(altText), '_blank');
        return true;
      }
      if (choice === 'copy') {
        const copied = typeof this._copyToClipboard === 'function'
          ? await this._copyToClipboard(this._buildEduCourseLessonShareAltText(team, plan, session, webUrl))
          : false;
        this.showToast?.(copied ? '連結已複製' : '複製失敗');
        return copied;
      }
      return false;
    }

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ text: altText });
        return true;
      } catch (err) {
        if (err?.name === 'AbortError') return false;
      }
    }
    const copied = typeof this._copyToClipboard === 'function'
      ? await this._copyToClipboard(this._buildEduCourseLessonShareAltText(team, plan, session, webUrl))
      : false;
    this.showToast?.(copied ? '課堂名單連結已複製到剪貼簿' : '複製失敗，請手動複製');
    return copied;
  },
});
