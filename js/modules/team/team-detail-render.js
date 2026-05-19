/* ================================================
   SportHub — Team Detail: Rendering
   Split from team-detail.js — team events and detail cards.
   All dynamic HTML uses escapeHTML() for XSS
   safety per CLAUDE.md project convention.
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Team Events
  // ══════════════════════════════════

  _renderTeamEventsLegacy(teamId) {
    const allEvents = ApiService.getEvents() || [];
    // 2026-04-20：活動黑名單過濾（俱樂部活動列表也要擋被擋用戶）
    const _uid = ApiService.getCurrentUser?.()?.uid || null;
    const teamIdStr = String(teamId || '');
    const teamEvents = allEvents.filter(e => {
      if (typeof this._isEventVisibleToUser === 'function'
        && !this._isEventVisibleToUser(e, _uid)) return false;
      if (typeof this._canListPrivateEvent === 'function'
        && !this._canListPrivateEvent(e)) return false;
      return e.teamOnly && ((Array.isArray(e.creatorTeamIds) && e.creatorTeamIds.map(v => String(v)).includes(teamIdStr)) || String(e.creatorTeamId || '') === teamIdStr) &&
        e.status !== 'ended' && e.status !== 'cancelled';
    }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (!teamEvents.length) return '';

    const TYPE_COLOR = { play: '#3b82f6', friendly: '#10b981', coaching: '#f59e0b', watch: '#8b5cf6' };
    const STATUS_LABEL = { open: '\u5831\u540d\u4e2d', full: '\u5df2\u984d\u6eff', upcoming: '\u5373\u5c07\u958b\u59cb' };

    const rows = teamEvents.map(e => {
      const datePart = (e.date || '').split(' ')[0];
      const timePart = (e.date || '').split(' ')[1] || '';
      const color = TYPE_COLOR[e.type] || '#6b7280';
      const statusLabel = STATUS_LABEL[e.status] || e.status;
      const spotsHtml = e.max > 0
        ? `<span style="font-size:.62rem;color:${e.current >= e.max ? 'var(--danger)' : 'var(--text-muted)'}">${e.current}/${e.max}</span>`
        : '';
      return `<div style="display:flex;align-items:center;gap:.4rem;padding:.35rem 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="App.showEventDetail('${e.id}')">
        <div style="width:3px;align-self:stretch;border-radius:2px;background:${color};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.82rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(e.title)}</div>
          <div style="font-size:.68rem;color:var(--text-muted)">${escapeHTML(datePart)}${timePart ? ' ' + escapeHTML(timePart) : ''}${e.location ? ' \u00b7 ' + escapeHTML(e.location) : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.25rem;flex-shrink:0">
          ${spotsHtml}
          <span style="font-size:.6rem;padding:.08rem .3rem;border-radius:999px;background:${color}22;color:${color};font-weight:600">${escapeHTML(statusLabel)}</span>
        </div>
      </div>`;
    }).join('');

    return `<div class="td-card">
      <div class="td-card-title">\u7403\u968a\u6d3b\u52d5 <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">(${teamEvents.length})</span></div>
      ${rows}
    </div>`;
  },

  // ══════════════════════════════════
  //  Team Event Cards
  // ══════════════════════════════════

  _teamEventsExpandedByTeam: {},

  _isTeamEventForTeam(e, teamId) {
    if (!e || !e.teamOnly) return false;
    const targetId = String(teamId || '').trim();
    if (!targetId) return false;
    const ids = (typeof this._getEventLimitedTeamIds === 'function')
      ? this._getEventLimitedTeamIds(e)
      : (() => {
        const out = [];
        const seen = new Set();
        const push = (id) => {
          const value = String(id || '').trim();
          if (!value || seen.has(value)) return;
          seen.add(value);
          out.push(value);
        };
        if (Array.isArray(e.creatorTeamIds)) e.creatorTeamIds.forEach(push);
        push(e.creatorTeamId);
        return out;
      })();
    return ids.includes(targetId);
  },

  _isTeamEventInFuture(e, nowDate = new Date()) {
    if (!e || e.status === 'ended' || e.status === 'cancelled') return false;
    const endDate = typeof this._parseEventEndDate === 'function' ? this._parseEventEndDate(e.date) : null;
    const startDate = typeof this._parseEventStartDate === 'function' ? this._parseEventStartDate(e.date) : null;
    const anchorDate = startDate || endDate;
    return !anchorDate || anchorDate >= nowDate;
  },

  _getTeamFutureEvents(teamId) {
    const source = typeof this._getVisibleEvents === 'function'
      ? this._getVisibleEvents()
      : (ApiService.getEvents?.() || []);
    const uid = ApiService.getCurrentUser?.()?.uid || null;
    const nowDate = new Date();
    return (Array.isArray(source) ? source : [])
      .filter(e => {
        if (!this._isTeamEventForTeam(e, teamId)) return false;
        if (!this._isTeamEventInFuture(e, nowDate)) return false;
        if (typeof this._canListPrivateEvent === 'function' && !this._canListPrivateEvent(e)) return false;
        if (typeof this._isEventVisibleToUser === 'function' && !this._isEventVisibleToUser(e, uid)) return false;
        return true;
      })
      .sort((a, b) => {
        const da = typeof this._parseEventStartDate === 'function' ? this._parseEventStartDate(a.date) : null;
        const db = typeof this._parseEventStartDate === 'function' ? this._parseEventStartDate(b.date) : null;
        if (da && db && da.getTime() !== db.getTime()) return da - db;
        if (da && !db) return -1;
        if (!da && db) return 1;
        return String(a.date || '').localeCompare(String(b.date || ''));
      });
  },

  _renderTeamEventCard(e) {
    const typeConf = (typeof TYPE_CONFIG !== 'undefined' && TYPE_CONFIG[e.type])
      ? TYPE_CONFIG[e.type]
      : ((typeof TYPE_CONFIG !== 'undefined' && TYPE_CONFIG.friendly) || { label: '\u6d3b\u52d5' });
    const isExternal = e.type === 'external';
    const statusKey = !isExternal && typeof this._getEventEffectiveStatus === 'function'
      ? this._getEventEffectiveStatus(e)
      : (e.status || 'open');
    const fallbackStatus = {
      open: { label: '\u5831\u540d\u4e2d', css: 'open' },
      full: { label: '\u5df2\u984d\u6eff', css: 'full' },
      upcoming: { label: '\u5373\u5c07\u958b\u653e', css: 'upcoming' },
      ended: { label: '\u5df2\u7d50\u675f', css: 'ended' },
      cancelled: { label: '\u5df2\u53d6\u6d88', css: 'cancelled' },
      external: { label: '\u5916\u90e8\u6d3b\u52d5', css: 'external' },
    };
    const statusConf = isExternal
      ? fallbackStatus.external
      : ((typeof STATUS_CONFIG !== 'undefined' && STATUS_CONFIG[statusKey]) || fallbackStatus[statusKey] || fallbackStatus.open);
    const datePart = (e.date || '').split(' ')[0] || '';
    const timePart = (e.date || '').split(' ')[1] || '';
    const location = (e.location || '').split('\u00b7')[1] || e.location || '';
    const stats = !isExternal && typeof this._getEventParticipantStats === 'function'
      ? this._getEventParticipantStats(e)
      : { confirmedCount: Number(e.current || 0), waitlistCount: Number(e.waitlist || 0), maxCount: Number(e.max || 0) };
    const waitlistTag = stats.waitlistCount > 0 ? ` \u00b7 \u5019\u88dc ${stats.waitlistCount}` : '';
    const capacityText = !isExternal && stats.maxCount > 0
      ? ` \u00b7 ${stats.confirmedCount}/${stats.maxCount}\u4eba${waitlistTag}`
      : '';
    const metaParts = [
      typeConf.label,
      [datePart, timePart].filter(Boolean).join(' '),
      location,
    ].filter(Boolean);
    const metaText = metaParts.map(v => escapeHTML(v)).join(' \u00b7 ') + capacityText;
    const progressHtml = !isExternal && stats.maxCount > 0
      ? (() => {
        const pct = Math.min(100, Math.round(stats.confirmedCount / stats.maxCount * 100));
        const color = pct >= 100 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--success)';
        return `<div class="td-team-event-progress"><div class="td-team-event-progress-track"><div style="width:${pct}%;background:${color}"></div></div><span>${stats.confirmedCount}/${stats.maxCount}${waitlistTag}</span></div>`;
      })()
      : '';
    const sportIcon = typeof this._renderEventSportIcon === 'function' ? this._renderEventSportIcon(e, 'tl-event-sport-corner') : '';
    const favHeart = (typeof this._favHeartHtml === 'function' && typeof this.isEventFavorited === 'function')
      ? this._favHeartHtml(this.isEventFavorited(e.id), 'Event', e.id)
      : '';
    const iconStack = `<div class="tl-event-icons">${favHeart}${sportIcon}</div>`;
    const rowClass = e.teamOnly ? 'tl-type-teamonly' : `tl-type-${e.type || 'friendly'}`;
    const teamBadge = e.teamOnly ? '<span class="tl-teamonly-badge">\u9650\u5b9a</span>' : '';
    const genderRibbon = !isExternal && typeof this._hasEventGenderRestriction === 'function' && this._hasEventGenderRestriction(e)
      ? `<span class="tl-event-gender-ribbon">${escapeHTML(this._getEventGenderTimelineRibbonText?.(e) || '')}</span>`
      : '';
    const privateStamp = e.privateEvent ? '<span class="tl-stamp-private">\u4e0d\u516c\u958b</span>' : '';
    const signedUp = !isExternal && typeof this._isUserSignedUp === 'function' && this._isUserSignedUp(e);
    const waitlisted = signedUp && typeof this._isUserOnWaitlist === 'function' && this._isUserOnWaitlist(e);
    const regStamp = waitlisted
      ? '<span class="tl-stamp-waitlisted">\u5019\u88dc</span>'
      : (signedUp ? '<span class="tl-stamp-confirmed">\u5df2\u5831</span>' : '');

    return `
      <div class="tl-event-row ${rowClass}" onclick="App.openTeamEventDetailFromCard('${e.id}', this)">
        ${genderRibbon}
        ${e.image ? `<div class="tl-event-thumb"><img src="${e.image}" loading="lazy" alt="${escapeHTML(e.title || '')}"></div>` : ''}
        <div class="tl-event-info">
          <div class="tl-event-title-row"><div class="tl-event-title">${escapeHTML(e.title || '')}${teamBadge}</div></div>
          ${progressHtml}
          <div class="tl-event-meta">${metaText}</div>
        </div>
        <span class="tl-event-status ${statusConf.css || 'open'}">${escapeHTML(statusConf.label || '')}</span>
        ${iconStack}
        <span class="tl-event-arrow">\u203a</span>
        ${privateStamp}${regStamp}
      </div>`;
  },

  _renderTeamEvents(teamId) {
    const teamEvents = this._getTeamFutureEvents(teamId);
    const createButton = this._canCreateTeamDetailActivity(teamId)
      ? '<button type="button" class="td-section-create-btn" onclick="event.stopPropagation();App.openTeamDetailCreateEvent(\'' + teamId + '\')">\u65b0\u589e\u6d3b\u52d5</button>'
      : '';
    const titleHtml = '<div class="td-card-title td-card-title-row"><span>\u4ff1\u6a02\u90e8\u6d3b\u52d5 <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">(' + teamEvents.length + ')</span></span>' + createButton + '</div>';
    if (!teamEvents.length) {
      return '<div class="td-card td-section-card" id="team-events-section">' +
        titleHtml +
        '<div class="td-empty-state">\u76ee\u524d\u6c92\u6709\u5373\u5c07\u958b\u59cb\u7684\u4ff1\u6a02\u90e8\u6d3b\u52d5</div>' +
        '</div>';
    }

    const expanded = !!this._teamEventsExpandedByTeam[teamId];
    const visibleEvents = expanded ? teamEvents : teamEvents.slice(0, 10);
    const hiddenCount = Math.max(0, teamEvents.length - visibleEvents.length);
    const cards = visibleEvents.map(e => this._renderTeamEventCard(e)).join('');
    const moreButton = teamEvents.length > 10
      ? `<button class="td-team-events-more" onclick="event.stopPropagation();App.toggleTeamEventsExpanded('${teamId}')">${expanded ? '\u6536\u5408' : `\u67e5\u770b\u66f4\u591a${hiddenCount > 0 ? `\uff08\u9084\u6709 ${hiddenCount} \u7b46\uff09` : ''}`}</button>`
      : '';

    return `<div class="td-card td-section-card" id="team-events-section">
      ${titleHtml}
      <div class="td-team-events-list">${cards}</div>
      ${moreButton}
    </div>`;
  },

  toggleTeamEventsExpanded(teamId) {
    if (!this._teamEventsExpandedByTeam) this._teamEventsExpandedByTeam = {};
    this._teamEventsExpandedByTeam[teamId] = !this._teamEventsExpandedByTeam[teamId];
    const section = document.getElementById('team-events-section');
    if (section) section.outerHTML = this._renderTeamEvents(teamId);
  },

  _markTeamEventCardPending(cardEl) {
    if (!cardEl || !cardEl.classList) return;
    cardEl.classList.add('tl-pending');
    cardEl.setAttribute('aria-busy', 'true');
    if (!cardEl.querySelector('.tl-loading-bar')) {
      const bar = document.createElement('div');
      bar.className = 'tl-loading-bar';
      const fill = document.createElement('div');
      fill.className = 'tl-loading-fill';
      bar.appendChild(fill);
      cardEl.appendChild(bar);
      requestAnimationFrame(() => { fill.style.width = '85%'; });
    }
  },

  _clearTeamEventCardPending(cardEl, minVisibleMs = 0) {
    if (!cardEl) return;
    setTimeout(() => {
      const fill = cardEl.querySelector?.('.tl-loading-fill');
      if (fill) fill.style.width = '100%';
      setTimeout(() => {
        if (cardEl.classList) cardEl.classList.add('tl-loaded');
        setTimeout(() => {
          if (cardEl.classList) {
            cardEl.classList.remove('tl-pending', 'tl-loaded');
            cardEl.removeAttribute('aria-busy');
          }
          const bar = cardEl.querySelector?.('.tl-loading-bar');
          if (bar) bar.remove();
        }, 400);
      }, 350);
    }, Math.max(0, minVisibleMs));
  },

  async openTeamEventDetailFromCard(eventId, cardEl) {
    const safeEventId = String(eventId || '').trim();
    const targetCard = cardEl?.closest ? cardEl.closest('.tl-event-row') : cardEl;
    if (!safeEventId) return { ok: false, reason: 'missing-id' };

    const extEvent = ApiService.getEvent?.(safeEventId);
    if (extEvent?.type === 'external' && extEvent.externalUrl && typeof this.showExternalTransitCard === 'function') {
      this.showExternalTransitCard(extEvent);
      return { ok: true };
    }

    if (targetCard?.dataset?.teamEventOpening === '1') return { ok: false, reason: 'pending' };
    if (targetCard?.dataset) targetCard.dataset.teamEventOpening = '1';
    const shouldHint = typeof this._shouldShowHomeEventLoadingHint === 'function'
      ? this._shouldShowHomeEventLoadingHint()
      : false;
    if (shouldHint) this._markTeamEventCardPending(targetCard);

    try {
      const result = await this.showEventDetail(safeEventId);
      if (!result?.ok && result?.reason === 'missing') {
        this.showToast?.('\u6d3b\u52d5\u8cc7\u6599\u5df2\u66f4\u65b0\uff0c\u8acb\u91cd\u65b0\u6574\u7406');
      }
      return result;
    } catch (err) {
      console.error('[TeamEventClick] open detail failed:', err);
      this.showToast?.('\u7121\u6cd5\u958b\u555f\u6d3b\u52d5\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      return { ok: false, reason: 'error' };
    } finally {
      this._clearTeamEventCardPending(targetCard, shouldHint ? 650 : 0);
      if (targetCard?.dataset) {
        setTimeout(() => { delete targetCard.dataset.teamEventOpening; }, shouldHint ? 900 : 320);
      }
    }
  },

  // ══════════════════════════════════
  //  Team Detail Body HTML — Helpers
  // ══════════════════════════════════

  _getTeamDetailMemberCount(t) {
    if (!t) return 0;
    return this._getTeamDetailRoster(t).filter(row => row.isMember || row.isStudent).length;
  },

  _getTeamDetailCoachCount(t) {
    if (!t) return 0;
    const users = ApiService.getAdminUsers?.() || [];
    const seen = new Set();
    const addCoachIdentity = (uidLike, nameLike) => {
      const uid = String(uidLike || '').trim();
      const name = String(nameLike || '').trim();
      if (!uid && !name) return;
      const user = typeof this._findTeamDetailUserByUidOrName === 'function'
        ? this._findTeamDetailUserByUidOrName(uid, name, users)
        : null;
      const key = user && typeof this._getTeamDetailIdentityKeyFromUser === 'function'
        ? this._getTeamDetailIdentityKeyFromUser(user)
        : (uid ? `uid:${uid}` : `coach:${name.toLowerCase()}`);
      if (key) seen.add(key);
    };
    const coachUids = Array.isArray(t.coachUids) ? t.coachUids : [];
    const coachNames = Array.isArray(t.coaches) ? t.coaches : [];
    coachUids.forEach((uid, idx) => addCoachIdentity(uid, coachNames[idx]));
    coachNames.forEach((name, idx) => {
      if (String(coachUids[idx] || '').trim()) return;
      addCoachIdentity(null, name);
    });
    return seen.size;
  },

  _getTeamDetailEventCount(t) {
    if (!t) return 0;
    try {
      return typeof this._getTeamFutureEvents === 'function' ? this._getTeamFutureEvents(t.id).length : 0;
    } catch (_) {
      return 0;
    }
  },

  _getTeamDetailVisibility(t) {
    const source = t && typeof t.detailVisibility === 'object' && t.detailVisibility
      ? t.detailVisibility
      : {};
    return {
      events: source.events !== false,
      courses: source.courses !== false,
      matches: source.matches !== false,
      info: source.info !== false,
      bio: source.bio !== false,
      record: source.record !== false,
      members: source.members !== false,
    };
  },

  _isTeamDetailSectionVisible(t, key) {
    const visibility = this._getTeamDetailVisibility(t);
    if (key === 'courses' && !this._isTeamDetailTeachingEnabled(t)) return false;
    return visibility[key] !== false;
  },

  _scrollTeamDetailToTop() {
    const page = document.getElementById('page-team-detail');
    const scrollEl = document.scrollingElement || document.documentElement || document.body;
    try {
      scrollEl?.scrollTo?.({ top: 0, behavior: 'smooth' });
    } catch (_) {
      if (scrollEl) scrollEl.scrollTop = 0;
    }
    try {
      window?.scrollTo?.({ top: 0, behavior: 'smooth' });
    } catch (_) {}
    if (page?.scrollIntoView) {
      try { page.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) {}
    }
  },

  _isTeamDetailTeachingEnabled(t) {
    if (!t) return false;
    if (typeof this._isTeamTeachingTagged === 'function') return !!this._isTeamTeachingTagged(t);
    if (t.teachingEnabled === true) return true;
    if (t.teachingEnabled === false) return false;
    if (t.isTeaching === true || t.educationTag === true) return true;
    if (t.eduSettings?.teachingEnabled === true) return true;
    if (t.eduSettings?.teachingEnabled === false) return false;
    return t.type === 'education';
  },

  _isTeamDetailPendingStudent(student) {
    if (!student || typeof student !== 'object') return false;
    const status = String(student.enrollStatus || student.status || student.approvalStatus || '').trim().toLowerCase();
    if (!status) return false;
    return [
      'pending',
      'review',
      'reviewing',
      'waiting',
      'wait',
      'unapproved',
      'submitted',
      'applied',
      '\u5f85\u5be9\u6838',
      '\u5be9\u6838\u4e2d',
      '\u5f85\u78ba\u8a8d',
    ].includes(status);
  },

  _getTeamDetailActiveStudents(teamId) {
    if (!teamId) return [];
    const seen = new Set();
    const students = [];
    const addStudent = (student) => {
      if (!student || typeof student !== 'object') return;
      if (student.enrollStatus === 'inactive' || student.status === 'inactive' || student.status === 'removed') return;
      const id = String(student.id || student._docId || student.studentId || student.selfUid || student.uid || student.name || '').trim();
      if (!id) return;
      const key = student.selfUid || student.uid ? `uid:${student.selfUid || student.uid}` : `student:${id}`;
      if (seen.has(key)) return;
      seen.add(key);
      students.push({ ...student, id: student.id || student._docId || student.studentId || id, teamId });
    };
    if (typeof this.getEduStudents === 'function') (this.getEduStudents(teamId) || []).forEach(addStudent);
    if (this._eduStudentsCache && Array.isArray(this._eduStudentsCache[teamId])) this._eduStudentsCache[teamId].forEach(addStudent);
    const team = ApiService.getTeam?.(teamId);
    [team?.students, team?.eduStudents, team?.educationStudents, team?.studentList, team?.eduSettings?.students].forEach(list => {
      if (Array.isArray(list)) list.forEach(addStudent);
    });
    return students;
  },

  _isTeamDetailUidLike(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    return /^U[0-9a-f]{20,}$/i.test(text);
  },

  _getTeamDetailPersonName(source, fallback = '未設定暱稱') {
    if (!source || typeof source !== 'object') return fallback;
    const fields = [
      'displayName', 'name', 'nickname', 'nickName', 'lineName', 'profileName',
      'userName', 'realName', 'studentName', 'selfName', 'childName',
    ];
    for (const field of fields) {
      const value = String(source[field] || '').trim();
      if (value && !this._isTeamDetailUidLike(value)) return value;
    }
    return fallback;
  },

  _getTeamDetailIdentityKeyFromUser(user) {
    if (!user) return null;
    if (typeof this._getUserIdentityKey === 'function') return this._getUserIdentityKey(user);
    const uid = String(user.uid || user._docId || '').trim();
    if (uid) return `uid:${uid}`;
    const name = this._getTeamDetailPersonName(user, '').trim().toLowerCase();
    return name ? `name:${name}` : null;
  },

  _getTeamDetailIdentityKeyFromStudent(student) {
    if (!student) return null;
    const uid = String(student.selfUid || student.uid || '').trim();
    if (uid) return `uid:${uid}`;
    const studentId = String(student.id || student._docId || student.studentId || '').trim();
    if (studentId) return `student:${studentId}`;
    const name = String(student.name || student.studentName || '').trim().toLowerCase();
    return name ? `student-name:${name}` : null;
  },

  _findTeamDetailUserByUidOrName(uidLike, nameLike, users) {
    const uid = String(uidLike || '').trim();
    const name = String(nameLike || '').trim();
    return (users || []).find(u => {
      const userUid = String(u.uid || '').trim();
      const docId = String(u._docId || '').trim();
      const userName = this._getTeamDetailPersonName(u, '');
      return (!!uid && (userUid === uid || docId === uid))
        || (!!name && userName === name);
    }) || null;
  },

  _getTeamDetailStaffRoleMap(t, users) {
    const roles = new Map();
    const addRole = (key, role) => {
      if (!key || !role) return;
      const set = roles.get(key) || new Set();
      set.add(role);
      roles.set(key, set);
    };
    const addByUidOrName = (uidLike, nameLike, role) => {
      const user = this._findTeamDetailUserByUidOrName(uidLike, nameLike, users);
      const key = user
        ? this._getTeamDetailIdentityKeyFromUser(user)
        : (uidLike ? `uid:${String(uidLike).trim()}` : (nameLike ? `staff:${role}:${String(nameLike).trim().toLowerCase()}` : null));
      addRole(key, role);
    };
    addByUidOrName(t.captainUid, t.captain || t.captainName, '球經');
    const leaderUids = Array.isArray(t.leaderUids) ? t.leaderUids : (t.leaderUid ? [t.leaderUid] : []);
    const leaderNames = Array.isArray(t.leaders) ? t.leaders : (t.leader ? [t.leader] : []);
    leaderUids.forEach((uid, idx) => addByUidOrName(uid, leaderNames[idx], '領隊'));
    leaderNames.forEach(name => addByUidOrName(null, name, '領隊'));
    const coachUids = Array.isArray(t.coachUids) ? t.coachUids : [];
    const coachNames = Array.isArray(t.coaches) ? t.coaches : [];
    coachUids.forEach((uid, idx) => addByUidOrName(uid, coachNames[idx], '教練'));
    coachNames.forEach(name => addByUidOrName(null, name, '教練'));
    return roles;
  },

  _readTeamDetailCountValue(source, fieldNames) {
    if (!source || typeof source !== 'object') return 0;
    for (const field of fieldNames) {
      const value = Number(source[field]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return 0;
  },

  _getTeamDetailActivityAttendanceCount(t, row) {
    const direct = this._readTeamDetailCountValue(row.user || row.student || row, [
      'clubActivityAttendanceCount', 'activityAttendanceCount', 'attendanceCount', 'checkinCount',
    ]);
    if (direct) return direct;
    try {
      const events = typeof this._getTeamFutureEvents === 'function'
        ? this._getTeamFutureEvents(t.id)
        : (ApiService.getEvents?.() || []).filter(e => {
          const ids = typeof this._getEventLimitedTeamIds === 'function'
            ? this._getEventLimitedTeamIds(e)
            : [e.creatorTeamId].concat(e.creatorTeamIds || []);
          return ids.map(String).includes(String(t.id));
        });
      const eventIds = new Set((events || []).map(e => String(e.id || e._docId || '')).filter(Boolean));
      if (!eventIds.size) return 0;
      const seen = new Set();
      (ApiService.getAttendanceRecords?.() || []).forEach(r => {
        if (r.status === 'removed' || r.status === 'cancelled') return;
        if (String(r.type || '').trim() && String(r.type || '').trim() !== 'checkin') return;
        const eventId = String(r.eventId || '').trim();
        if (!eventIds.has(eventId)) return;
        const uid = String(r.uid || '').trim();
        const name = String(r.userName || r.name || '').trim();
        if ((row.uid && uid === row.uid) || (!row.uid && row.name && name === row.name)) seen.add(eventId);
      });
      return seen.size;
    } catch (_) {
      return 0;
    }
  },

  _getTeamDetailCourseParticipationCount(t, row) {
    const direct = this._readTeamDetailCountValue(row.student || row.user || row, [
      'courseParticipationCount', 'courseAttendanceCount', 'attendedLessonCount', 'lessonCount',
    ]);
    if (direct) return direct;
    const records = [];
    if (this._eduAttendanceCache && typeof this._eduAttendanceCache === 'object') {
      Object.values(this._eduAttendanceCache).forEach(list => { if (Array.isArray(list)) records.push(...list); });
    }
    if (typeof FirebaseService !== 'undefined' && Array.isArray(FirebaseService._cache?.eduAttendance)) {
      records.push(...FirebaseService._cache.eduAttendance);
    }
    if (!records.length) return 0;
    const seen = new Set();
    records.forEach(r => {
      if (String(r.teamId || '') !== String(t.id)) return;
      if (r.status === 'removed' || r.status === 'cancelled') return;
      const matched = (row.studentId && String(r.studentId || '') === String(row.studentId))
        || (row.uid && (String(r.selfUid || '') === row.uid || String(r.uid || '') === row.uid));
      if (matched) seen.add([r.coursePlanId || r.groupId || 'course', r.date || '', r.sessionNumber || ''].join(':'));
    });
    return seen.size;
  },

  _getTeamDetailMatchParticipationCount(t, row) {
    const direct = this._readTeamDetailCountValue(row.user || row.student || row, [
      'clubMatchParticipationCount', 'matchParticipationCount', 'matchCount',
    ]);
    if (direct) return direct;
    const seen = new Set();
    (t.history || []).forEach((match, idx) => {
      const people = []
        .concat(match.participants || [])
        .concat(match.players || [])
        .concat(match.members || [])
        .concat(match.roster || []);
      const matched = people.some(p => {
        if (typeof p === 'string') return p === row.uid || p === row.name;
        if (!p || typeof p !== 'object') return false;
        return (row.uid && (p.uid === row.uid || p.userId === row.uid || p.selfUid === row.uid))
          || (row.name && (p.name === row.name || p.userName === row.name || p.displayName === row.name));
      });
      if (matched) seen.add(match.id || idx);
    });
    return seen.size;
  },

  _formatTeamDetailDateValue(value) {
    if (!value) return '-';
    let date = null;
    if (value instanceof Date) date = value;
    else if (typeof value.toDate === 'function') date = value.toDate();
    else if (typeof value.seconds === 'number') date = new Date(value.seconds * 1000);
    else {
      const raw = String(value).trim();
      if (!raw) return '-';
      const normalized = raw.replace(/\./g, '/').replace(/-/g, '/');
      const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (match) return match[1] + '/' + match[2].padStart(2, '0') + '/' + match[3].padStart(2, '0');
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) date = new Date(parsed);
      else return raw.slice(0, 10);
    }
    if (!date || Number.isNaN(date.getTime())) return '-';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return y + '/' + m + '/' + d;
  },

  _readTeamDetailDateValue(source, keys) {
    if (!source || typeof source !== 'object') return '';
    for (const key of keys) {
      const value = source[key];
      if (!value) continue;
      if (typeof value === 'object'
        && !(value instanceof Date)
        && typeof value.toDate !== 'function'
        && typeof value.seconds !== 'number') {
        continue;
      }
      const formatted = this._formatTeamDetailDateValue(value);
      if (formatted && formatted !== '-') return formatted;
    }
    return '';
  },

  _readTeamDetailMappedJoinDate(source, teamId) {
    if (!source || !teamId || typeof source !== 'object') return '';
    const mapKeys = ['teamJoinedAtByTeam', 'teamJoinDates', 'teamJoinedAtMap', 'teamMemberSince'];
    for (const key of mapKeys) {
      const map = source[key];
      if (!map || typeof map !== 'object') continue;
      const value = map[teamId] || map[String(teamId)];
      const formatted = this._formatTeamDetailDateValue(value);
      if (formatted && formatted !== '-') return formatted;
    }
    return '';
  },

  _getTeamDetailMemberJoinTime(t, row) {
    const teamId = String(t?.id || '');
    const user = row.user || {};
    const student = row.student || {};
    return this._readTeamDetailMappedJoinDate(user, teamId)
      || this._readTeamDetailDateValue(user, ['teamJoinedAt', 'memberJoinedAt', 'joinedAt', 'joinAt', 'memberSince'])
      || this._readTeamDetailMappedJoinDate(student, teamId)
      || this._readTeamDetailDateValue(student, ['approvedAt', 'joinedAt', 'enrolledAt', 'createdAt'])
      || '-';
  },

  _getTeamDetailRoster(t) {
    if (!t) return [];
    const users = ApiService.getAdminUsers?.() || [];
    const staffRoles = this._getTeamDetailStaffRoleMap(t, users);
    const rows = new Map();
    const ensureRow = (key, base) => {
      if (!key) return null;
      if (!rows.has(key)) {
        rows.set(key, {
          key,
          name: '',
          uid: '',
          studentId: '',
          isMember: false,
          isStudent: false,
          isPendingStudent: false,
          isExternalStudent: false,
          roles: new Set(),
          user: null,
          student: null,
        });
      }
      const row = rows.get(key);
      Object.assign(row, base || {});
      return row;
    };
    users.forEach(user => {
      const inTeam = typeof this._isUserInTeam === 'function'
        ? this._isUserInTeam(user, t.id)
        : user.teamId === t.id || (Array.isArray(user.teamIds) && user.teamIds.map(String).includes(String(t.id)));
      const key = this._getTeamDetailIdentityKeyFromUser(user);
      if (!key) return;
      const displayName = this._getTeamDetailPersonName(user);
      const row = ensureRow(key, {
        name: displayName,
        isMissingName: displayName === '未設定暱稱',
        uid: user.uid || user._docId || '',
        user,
      });
      if (inTeam) row.isMember = true;
      (staffRoles.get(key) || new Set()).forEach(role => {
        row.roles.add(role);
        row.isMember = true;
      });
    });
    staffRoles.forEach((roleSet, key) => {
      const fallbackName = key.startsWith('staff:')
        ? key.replace(/^staff:[^:]+:/, '')
        : '未設定暱稱';
      const row = ensureRow(key, {});
      if (!row.name || row.isMissingName || this._isTeamDetailUidLike(row.name)) {
        row.name = fallbackName || '未設定暱稱';
        row.isMissingName = !fallbackName || fallbackName === '未設定暱稱';
      }
      roleSet.forEach(role => row.roles.add(role));
      row.isMember = true;
    });
    this._getTeamDetailActiveStudents(t.id).forEach(student => {
      const key = this._getTeamDetailIdentityKeyFromStudent(student);
      const displayName = this._getTeamDetailPersonName(student, '未命名學員');
      const isPendingStudent = this._isTeamDetailPendingStudent(student);
      const row = ensureRow(key, {
        uid: student.selfUid || student.uid || '',
        studentId: student.id || student._docId || student.studentId || '',
        student,
        isExternalStudent: !(student.selfUid || student.uid),
      });
      if (!row.name || row.isMissingName || this._isTeamDetailUidLike(row.name)) {
        row.name = displayName;
        row.isMissingName = displayName === '未命名學員';
      }
      row.isPendingStudent = row.isPendingStudent || isPendingStudent;
      if (!isPendingStudent) row.isStudent = true;
    });
    const result = Array.from(rows.values()).filter(row => row.isMember || row.isStudent || row.isPendingStudent);
    result.forEach(row => {
      row.label = row.isMember && row.isStudent ? 'ALL' : (row.isStudent ? '學員' : (row.isPendingStudent ? '待審核' : '隊員'));
      row.identity = Array.from(row.roles).join(' | ');
      row.isMissingName = !!row.isMissingName || !row.name || this._isTeamDetailUidLike(row.name);
      if (row.isMissingName) row.name = (row.isStudent || row.isPendingStudent) && !row.isMember ? '未命名學員' : '未設定暱稱';
      row.activityCount = this._getTeamDetailActivityAttendanceCount(t, row);
      row.courseCount = this._getTeamDetailCourseParticipationCount(t, row);
      row.matchCount = this._getTeamDetailMatchParticipationCount(t, row);
      row.joinTime = this._getTeamDetailMemberJoinTime(t, row);
    });
    return result.sort((a, b) => {
      const rankA = a.roles.size ? 0 : (a.isMember ? 1 : 2);
      const rankB = b.roles.size ? 0 : (b.isMember ? 1 : 2);
      if (rankA !== rankB) return rankA - rankB;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
    });
  },

  _isCurrentUserTeamStaffForCreate(teamOrId) {
    const team = typeof teamOrId === 'string' ? ApiService.getTeam?.(teamOrId) : teamOrId;
    const currentUser = ApiService.getCurrentUser?.();
    if (!team || !currentUser?.uid) return false;
    if (typeof this._canManageTeamMembers === 'function' && this._canManageTeamMembers(team)) return true;

    const userIds = [currentUser.uid, currentUser._docId]
      .map(v => String(v || '').trim())
      .filter(Boolean);
    const staffIds = [
      team.captainUid,
      team.leaderUid,
      ...(Array.isArray(team.leaderUids) ? team.leaderUids : []),
      ...(Array.isArray(team.coachUids) ? team.coachUids : []),
    ].map(v => String(v || '').trim()).filter(Boolean);
    if (userIds.some(uid => staffIds.includes(uid))) return true;

    const normalizeName = (value) => String(value || '').trim().toLowerCase();
    const userNames = [currentUser.name, currentUser.displayName].map(normalizeName).filter(Boolean);
    const staffNames = [
      team.captain,
      team.captainName,
      team.leader,
      ...(Array.isArray(team.leaders) ? team.leaders : []),
      ...(Array.isArray(team.leaderNames) ? team.leaderNames : []),
      ...(Array.isArray(team.coaches) ? team.coaches : []),
      ...(Array.isArray(team.coachNames) ? team.coachNames : []),
    ].map(normalizeName).filter(Boolean);
    return userNames.some(name => staffNames.includes(name));
  },

  _canCreateTeamDetailActivity(teamOrId) {
    const currentUser = ApiService.getCurrentUser?.();
    if (!currentUser?.uid) return false;
    if (!this._isCurrentUserTeamStaffForCreate(teamOrId)) return false;
    if (typeof this._canCreateActivityByPermission === 'function') return !!this._canCreateActivityByPermission();
    if (typeof this._canCreateBasicActivity === 'function' && this._canCreateBasicActivity()) return true;
    if (typeof this._canCreateExternalActivity === 'function' && this._canCreateExternalActivity()) return true;
    if (typeof this.hasPermission === 'function') {
      return !!(this.hasPermission('activity.manage.entry')
        || this.hasPermission('team.create_event')
        || this.hasPermission('user.activity.basic_create')
        || this.hasPermission('user.activity.external_create'));
    }
    return false;
  },

  _buildTeamDetailPrimaryAction(t) {
    const isMember = this._isTeamMember(t.id);
    const joinState = !isMember && typeof this._getTeamJoinRequestState === 'function'
      ? this._getTeamJoinRequestState(t.id)
      : null;
    if (joinState?.status === 'pending') {
      return '<button class="td-action-main td-action-pending" onclick="App.showTeamJoinPendingToast(\'' + t.id + '\')">\u5be9\u6838\u4e2d</button>';
    }
    return isMember
      ? '<button class="td-action-main td-action-danger" onclick="App.handleLeaveTeam(\'' + t.id + '\')">\u9000\u51fa</button>'
      : '<button class="td-action-main" onclick="App.handleJoinTeam(\'' + t.id + '\')">\u52a0\u5165</button>';
  },

  _buildTeamDetailActionBar(t) {
    const u = ApiService.getCurrentUser?.();
    const n = u?.displayName || '';
    const isCaptainCoach = (t.captain === n || (t.coaches || []).includes(n));
    const memberCanInvite = t.allowMemberInvite !== false;
    const isMember = this._isTeamMember(t.id);
    const canInvite = isCaptainCoach || (isMember && memberCanInvite);
    const share = '<button class="td-action-secondary" onclick="App.shareTeam(\'' + t.id + '\')">\u5206\u4eab</button>';
    const contact = t.captain
      ? '<button class="td-action-secondary" onclick="App.showUserProfile(\'' + escapeHTML(t.captain) + '\')">' + I18N.t('teamDetail.contactCaptain') + '</button>'
      : '<button class="td-action-secondary td-action-disabled" type="button" disabled>' + I18N.t('teamDetail.contactCaptain') + '</button>';
    const invite = canInvite
      ? '<button class="td-action-secondary" onclick="App.showTeamInviteQR(\'' + t.id + '\')">' + I18N.t('teamDetail.inviteQR') + '</button>'
      : '<button class="td-action-secondary td-action-disabled" type="button" disabled>' + I18N.t('teamDetail.inviteQR') + '</button>';
    return '<div class="td-action-panel">' +
      '<div class="td-action-grid">' + share + contact + invite + '</div>' +
      '</div>';
  },

  _buildTeamDetailSectionNav(t) {
    const items = [];
    if (this._isTeamDetailSectionVisible(t, 'courses')) {
      items.push('<button type="button" onclick="document.getElementById(\'edu-detail-section\')?.scrollIntoView({block:\'start\',behavior:\'smooth\'})">\u8ab2\u7a0b</button>');
    }
    if (this._isTeamDetailSectionVisible(t, 'events')) {
      items.push('<button type="button" onclick="document.getElementById(\'team-events-section\')?.scrollIntoView({block:\'start\',behavior:\'smooth\'})">\u6d3b\u52d5</button>');
    }
    if (this._isTeamDetailSectionVisible(t, 'matches')) {
      items.push('<button type="button" onclick="document.getElementById(\'team-tournaments-section\')?.scrollIntoView({block:\'start\',behavior:\'smooth\'})">\u8cfd\u4e8b</button>');
    }
    if (this._isTeamDetailSectionVisible(t, 'record')) {
      items.push('<button type="button" onclick="document.getElementById(\'team-record-history-section\')?.scrollIntoView({block:\'start\',behavior:\'smooth\'})">\u6230\u7e3e</button>');
    }
    if (this._isTeamDetailSectionVisible(t, 'members')) {
      items.push('<button type="button" onclick="document.getElementById(\'team-members-section\')?.scrollIntoView({block:\'start\',behavior:\'smooth\'})">\u6210\u54e1</button>');
    }
    return items.length
      ? '<div class="td-section-nav-panel"><div class="td-section-nav" aria-label="club detail sections">' + items.join('') + '</div></div>'
      : '';
  },

  _buildTeamDetailOverview(t, totalGames, winRate) {
    const memberCount = this._getTeamDetailMemberCount(t);
    const coachCount = this._getTeamDetailCoachCount(t);
    const eventCount = this._getTeamDetailEventCount(t);
    return '<div class="td-overview-grid">' +
      '<div class="td-overview-stat td-overview-member"><span class="td-overview-label">\u6210\u54e1</span><strong>' + memberCount + '</strong></div>' +
      '<div class="td-overview-stat td-overview-coach"><span class="td-overview-label">\u6559\u7df4</span><strong>' + coachCount + '</strong></div>' +
      '<div class="td-overview-stat td-overview-event"><span class="td-overview-label">\u672c\u9031\u6d3b\u52d5</span><strong>' + eventCount + '</strong></div>' +
      '</div>';
  },

  _buildTeamEducationSection(t) {
    if (!t) return '';
    return '<div class="td-card td-section-card td-edu-unified" id="edu-detail-section">' +
      '<div class="td-card-title td-card-title-row"><span>\u4ff1\u6a02\u90e8\u8ab2\u7a0b</span></div>' +
      '<div class="edu-tab-row td-edu-tab-row">' +
      '<div class="tab-bar" id="edu-detail-tabs" style="flex:0 0 auto">' +
      '<button class="tab active" data-edutab="course" onclick="App.switchEduTab(\'course\')">\u8ab2\u7a0b</button>' +
      '<button class="tab" data-edutab="group" onclick="App.switchEduTab(\'group\')">\u5206\u7d44</button>' +
      '<span class="edu-tab-mine-wrap"><button class="tab" data-edutab="student" onclick="App.switchEduTab(\'student\')">\u5b78\u54e1</button><span id="edu-mine-badge" class="edu-tab-badge"></span></span>' +
      '<button class="tab" data-edutab="pending" onclick="App.switchEduTab(\'pending\')">\u5f85\u5be9\u6838</button>' +
      '</div>' +
      '<span id="edu-mine-status" class="edu-mine-status"></span>' +
      '</div>' +
      '<div id="edu-detail-tab-content" class="edu-tab-content td-edu-tab-content"></div>' +
      '</div>';
  },

  _buildTeamInfoCard(t) {
    const sportKey = typeof getSportKeySafe === 'function'
      ? getSportKeySafe(t.sportTag)
      : String(t.sportTag || '').trim();
    const sportLabel = sportKey && typeof EVENT_SPORT_MAP !== 'undefined' && EVENT_SPORT_MAP[sportKey]
      ? EVENT_SPORT_MAP[sportKey].label
      : sportKey;
    const sportIcon = sportKey && typeof getSportIconSvg === 'function'
      ? getSportIconSvg(sportKey)
      : (sportKey && typeof SPORT_ICON_EMOJI !== 'undefined' ? (SPORT_ICON_EMOJI[sportKey] || '') : '');
    const emptyValue = I18N.t('teamDetail.notSet');
    const sportValue = sportKey ? (sportIcon ? sportIcon + ' ' : '') + escapeHTML(sportLabel) : emptyValue;
    const inlineItems = [
      ['\u904b\u52d5\u985e\u578b', sportValue],
      [I18N.t('teamDetail.region'), t.region ? escapeHTML(t.region) : emptyValue],
      [I18N.t('teamDetail.nationality'), t.nationality ? escapeHTML(t.nationality) : emptyValue],
      [I18N.t('teamDetail.founded'), t.founded ? escapeHTML(t.founded) : emptyValue],
    ].map(item => '<div class="td-info-inline-item"><span>' + item[0] + '</span><strong>' + item[1] + '</strong></div>').join('');
    const leaders = t.leaders || (t.leader ? [t.leader] : []);
    const contactLinksHtml = t.contactLinksEnabled ? (this._renderTeamContactLinksHtml?.(t.contactLinks) || '') : '';
    const contactParts = [];
    if (contactLinksHtml) {
      contactParts.push('<span class="event-social-link-list td-contact-link-list">' + contactLinksHtml + '</span>');
    }
    if (t.contact) {
      contactParts.push('<span class="td-contact-manual-text">' + escapeHTML(t.contact) + '</span>');
    }
    const contactCard = contactParts.length
      ? '<div class="td-card-item td-card-item-compact td-info-contact-card"><span class="td-card-label">' + I18N.t('teamDetail.contact') + '</span><span class="td-card-value td-contact-value">' + contactParts.join('') + '</span></div>'
      : '';
    return '<div class="td-card td-section-card" id="team-info-section">'
      + '<div class="td-card-title">' + I18N.t('teamDetail.info') + '</div>'
      + '<div class="td-info-inline-row">' + inlineItems + '</div>'
      + '<div class="td-card-grid td-card-grid-compact td-info-staff-grid">'
      + '<div class="td-card-item td-card-item-compact"><span class="td-card-label">\u7403\u968a\u7d93\u7406</span><span class="td-card-value">' + (t.captain ? this._userTag(t.captain, 'captain') : I18N.t('teamDetail.notSet')) + '</span></div>'
      + '<div class="td-card-item td-card-item-compact"><span class="td-card-label">\u9818\u968a</span><span class="td-card-value">' + (leaders.length ? leaders.map(n => this._teamLeaderTag(n)).join(' ') : I18N.t('teamDetail.notSet')) + '</span></div>'
      + '<div class="td-card-item td-card-item-compact td-info-coach-card"><span class="td-card-label">' + I18N.t('teamDetail.coach') + '</span><span class="td-card-value">' + ((t.coaches || []).length > 0 ? t.coaches.map(c => this._userTag(c, 'coach')).join(' ') : I18N.t('teamDetail.none')) + '</span></div>'
      + contactCard
      + '</div></div>';
  },

  _buildTeamBioCard(t) {
    return t.bio ? '<div class="td-card td-section-card" id="team-bio-section"><div class="td-card-title" style="text-align:center">' + I18N.t('teamDetail.bio') + '</div><div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word">' + escapeHTML(t.bio) + '</div></div>' : '';
  },

  _isTeamTournamentForTeam(tournament, teamId) {
    if (!tournament || !teamId) return false;
    const target = String(teamId || '').trim();
    const hasId = (value) => String(value || '').trim() === target;
    if (hasId(tournament.hostTeamId)) return true;
    const lists = [
      tournament.registeredTeams,
      tournament.teamIds,
      tournament.approvedTeamIds,
      tournament.pendingTeamIds,
    ];
    if (lists.some(list => Array.isArray(list) && list.some(hasId))) return true;
    const recordLists = [
      tournament.teamEntries,
      tournament.entries,
      tournament.teamApplications,
      tournament.applications,
    ];
    return recordLists.some(list => Array.isArray(list) && list.some(item => hasId(item?.teamId || item?.id)));
  },

  _getTeamTournamentDateText(tournament) {
    const raw = Array.isArray(tournament?.matchDates) && tournament.matchDates.length
      ? tournament.matchDates[0]
      : (tournament?.date || tournament?.regStart || tournament?.createdAt || '');
    if (!raw) return '';
    if (typeof raw === 'string') return raw.replace('T', ' ').slice(0, 16);
    if (raw.toDate) return raw.toDate().toISOString().slice(0, 10);
    if (raw.seconds) return new Date(raw.seconds * 1000).toISOString().slice(0, 10);
    return String(raw).slice(0, 16);
  },

  _getTeamTournamentSortTime(tournament) {
    const values = []
      .concat(Array.isArray(tournament?.matchDates) ? tournament.matchDates : [])
      .concat([tournament?.date, tournament?.regStart, tournament?.createdAt, tournament?.updatedAt]);
    return values.reduce((best, value) => {
      let time = 0;
      if (value && typeof value.toMillis === 'function') time = value.toMillis();
      else if (value && typeof value.seconds === 'number') time = value.seconds * 1000;
      else if (value) {
        const parsed = Date.parse(String(value));
        time = Number.isFinite(parsed) ? parsed : 0;
      }
      return best || time || 0;
    }, 0);
  },

  _getTeamTournaments(teamId) {
    const tournaments = ApiService.getTournaments?.() || [];
    return tournaments
      .map(item => (typeof this.getFriendlyTournamentRecord === 'function' ? (this.getFriendlyTournamentRecord(item) || item) : item))
      .filter(item => this._isTeamTournamentForTeam(item, teamId))
      .sort((a, b) => {
        const at = this._getTeamTournamentSortTime(a);
        const bt = this._getTeamTournamentSortTime(b);
        if (at !== bt) return bt - at;
        return String(a?.name || '').localeCompare(String(b?.name || ''));
      });
  },

  _getTeamTournamentStatusLabel(tournament) {
    if (!tournament) return '';
    if (typeof this.isTournamentEnded === 'function' && this.isTournamentEnded(tournament)) return I18N.t('tournament.status.ended');
    if (tournament.ended) return I18N.t('tournament.status.ended');
    if (typeof this.getTournamentStatus === 'function') return this.getTournamentStatus(tournament);
    return tournament.status || I18N.t('tournament.status.regOpen');
  },

  _isTeamTournamentEnded(tournament) {
    if (!tournament) return false;
    if (typeof this.isTournamentEnded === 'function') return !!this.isTournamentEnded(tournament);
    if (tournament.ended === true) return true;
    const statusText = String(tournament.status || tournament.state || tournament.stage || '').toLowerCase();
    if (/(ended|finished|completed|closed|cancelled|\u5df2\u7d50\u675f|\u7d50\u675f|\u53d6\u6d88)/.test(statusText)) return true;
    const endValues = [tournament.endDate, tournament.matchEnd, tournament.finishedAt, tournament.completedAt];
    return endValues.some(value => {
      if (!value) return false;
      let time = 0;
      if (typeof value.toMillis === 'function') time = value.toMillis();
      else if (typeof value.seconds === 'number') time = value.seconds * 1000;
      else {
        const parsed = Date.parse(String(value));
        time = Number.isFinite(parsed) ? parsed : 0;
      }
      return time > 0 && time < Date.now();
    });
  },

  _renderTeamTournamentCard(tournament) {
    const id = escapeHTML(tournament.id || tournament._docId || '');
    const name = escapeHTML(tournament.name || I18N.t('tournament.detail'));
    const date = this._getTeamTournamentDateText(tournament);
    const registered = Array.isArray(tournament.registeredTeams) ? tournament.registeredTeams.length : 0;
    const maxTeams = tournament.maxTeams || tournament.teams || '?';
    const region = tournament.region ? '<span>' + escapeHTML(tournament.region) + '</span>' : '';
    const status = escapeHTML(this._getTeamTournamentStatusLabel(tournament));
    const typeLabel = escapeHTML((typeof this._getTournamentModeLabel === 'function' ? this._getTournamentModeLabel(tournament) : '') || tournament.type || I18N.t('tournament.detail'));
    const imageUrl = String(tournament.image || tournament.coverImage || tournament.coverUrl || tournament.imageUrl || tournament.hostTeamImage || '').trim();
    const sportIcon = typeof this._renderTournamentSportIcon === 'function'
      ? this._renderTournamentSportIcon(tournament, 'td-team-tournament-thumb-icon')
      : '';
    const thumbHtml = imageUrl
      ? '<div class="td-team-tournament-thumb"><img src="' + escapeHTML(imageUrl) + '" loading="lazy" alt="' + name + '"></div>'
      : '<div class="td-team-tournament-thumb td-team-tournament-thumb-placeholder" aria-hidden="true">' + (sportIcon || '<span>T</span>') + '</div>';
    return '<button type="button" class="td-team-tournament-card" onclick="App.openTeamDetailTournament(\'' + id + '\')">' +
      '<span class="td-team-tournament-main">' +
      '<span class="td-team-tournament-title-row"><strong>' + name + '</strong><span class="td-team-tournament-status">' + status + '</span></span>' +
      '<span class="td-team-tournament-meta">' +
      '<span>' + typeLabel + '</span>' +
      region +
      (date ? '<span>' + escapeHTML(date) + '</span>' : '') +
      '<span>' + registered + '/' + maxTeams + ' ' + I18N.t('tournament.teamUnit') + '</span>' +
      '</span>' +
      '</span>' +
      thumbHtml +
      '</button>';
  },

  _renderTeamTournaments(teamId) {
    const tournaments = this._getTeamTournaments(teamId);
    const titleHtml = '<div class="td-card-title td-card-title-row"><span>\u4ff1\u6a02\u90e8\u8cfd\u4e8b <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">(' + tournaments.length + ')</span></span></div>';
    if (!tournaments.length) {
      return '<div class="td-card td-section-card" id="team-tournaments-section">' +
        titleHtml +
        '<div class="td-empty-state">\u76ee\u524d\u6c92\u6709\u95dc\u806f\u7684\u4ff1\u6a02\u90e8\u8cfd\u4e8b</div>' +
        '</div>';
    }
    this._teamTournamentTabByTeam = this._teamTournamentTabByTeam || {};
    const activeTab = this._teamTournamentTabByTeam[teamId] || 'active';
    const activeTournaments = tournaments.filter(t => !this._isTeamTournamentEnded(t));
    const endedTournaments = tournaments.filter(t => this._isTeamTournamentEnded(t));
    const visibleTournaments = activeTab === 'ended' ? endedTournaments : activeTournaments;
    const tabBtn = (key, label, count) => '<button type="button" class="td-team-tournament-tab' + (activeTab === key ? ' active' : '') + '" onclick="App.switchTeamTournamentTab(\'' + teamId + '\',\'' + key + '\')">' + label + '<span>' + count + '</span></button>';
    const emptyText = activeTab === 'ended'
      ? '\u76ee\u524d\u6c92\u6709\u5df2\u7d50\u675f\u7684\u4ff1\u6a02\u90e8\u8cfd\u4e8b'
      : '\u76ee\u524d\u6c92\u6709\u53c3\u8cfd\u4e2d\u7684\u4ff1\u6a02\u90e8\u8cfd\u4e8b';
    return '<div class="td-card td-section-card" id="team-tournaments-section">' +
      titleHtml +
      '<div class="td-team-tournament-tabs">' + tabBtn('active', '\u53c3\u8cfd\u4e2d', activeTournaments.length) + tabBtn('ended', '\u5df2\u7d50\u675f', endedTournaments.length) + '</div>' +
      (visibleTournaments.length
        ? '<div class="td-team-tournament-list">' + visibleTournaments.slice(0, 6).map(t => this._renderTeamTournamentCard(t)).join('') + '</div>'
        : '<div class="td-empty-state">' + emptyText + '</div>') +
      '</div>';
  },

  switchTeamTournamentTab(teamId, tab) {
    const allowed = new Set(['active', 'ended']);
    if (!teamId || !allowed.has(tab)) return;
    this._teamTournamentTabByTeam = this._teamTournamentTabByTeam || {};
    this._teamTournamentTabByTeam[teamId] = tab;
    const target = document.getElementById('team-tournaments-section');
    if (target) target.outerHTML = this._renderTeamTournaments(teamId);
  },

  async openTeamDetailTournament(tournamentId) {
    const safeId = String(tournamentId || '').trim();
    if (!safeId) return;
    if (typeof this._openTournamentDetail === 'function') return this._openTournamentDetail(safeId);
    if (typeof ScriptLoader !== 'undefined' && typeof ScriptLoader.ensureForPage === 'function') {
      try { await ScriptLoader.ensureForPage('page-tournament-detail'); } catch (err) { console.warn('[TeamDetail] tournament scripts failed:', err); }
    }
    if (typeof this.showTournamentDetail === 'function') return this.showTournamentDetail(safeId);
    this.showToast?.('\u8cfd\u4e8b\u529f\u80fd\u5c1a\u672a\u8f09\u5165\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
  },

  _buildTeamRecordCard(t, totalGames, winRate) {
    const wins = Number(t?.wins || 0);
    const draws = Number(t?.draws || 0);
    const losses = Number(t?.losses || 0);
    const safeTotal = Number.isFinite(Number(totalGames)) ? Number(totalGames) : wins + draws + losses;
    const safeRate = Number.isFinite(Number(winRate)) ? Number(winRate) : 0;
    const cells = [
      ['total', I18N.t('teamDetail.totalGames'), safeTotal],
      ['win', I18N.t('teamDetail.wins'), wins],
      ['draw', I18N.t('teamDetail.draws'), draws],
      ['loss', I18N.t('teamDetail.losses'), losses],
      ['rate', I18N.t('teamDetail.winRate'), safeRate + '%'],
    ].map(item => '<div class="td-stat td-record-stat td-record-' + item[0] + '"><span class="td-stat-label">' + item[1] + '</span><span class="td-stat-num">' + item[2] + '</span></div>').join('');
    return '<div class="td-card td-section-card" id="team-record-section">'
      + '<div class="td-card-title">' + I18N.t('teamDetail.record') + '</div>'
      + '<div class="td-stats-row td-record-grid">'
      + cells
      + '</div></div>';
  },

  _buildTeamRecordHistorySection(t, totalGames, winRate) {
    const parts = [];
    if (this._isTeamDetailSectionVisible(t, 'record')) {
      parts.push(this._buildTeamRecordCard(t, totalGames, winRate));
    }
    return parts.length
      ? '<div class="td-record-history-grid" id="team-record-history-section">' + parts.join('') + '</div>'
      : '';
  },

  _getTeamDetailMemberLabelClass(label) {
    const value = String(label || '').trim();
    if (value === 'ALL') return 'label-all';
    if (value === '\u5b78\u54e1') return 'label-student';
    if (value === '\u5f85\u5be9\u6838') return 'label-pending';
    return 'label-member';
  },

  _getTeamDetailMemberPrimaryTag(row) {
    const rolePriority = ['\u7403\u7d93', '\u9818\u968a', '\u6559\u7df4'];
    const roles = row?.roles instanceof Set ? row.roles : new Set();
    const role = rolePriority.find(item => roles.has(item));
    if (role) {
      return {
        label: role,
        className: 'tag-role ' + this._getTeamDetailMemberRoleClass(role),
      };
    }
    if (row?.isMember) {
      return {
        label: '\u968a\u54e1',
        className: this._getTeamDetailMemberLabelClass('\u968a\u54e1'),
      };
    }
    if (row?.isStudent) {
      return {
        label: '\u5b78\u54e1',
        className: this._getTeamDetailMemberLabelClass('\u5b78\u54e1'),
      };
    }
    if (row?.isPendingStudent) {
      return {
        label: '\u5f85\u5be9\u6838',
        className: this._getTeamDetailMemberLabelClass('\u5f85\u5be9\u6838'),
      };
    }
    return {
      label: row?.label || '\u968a\u54e1',
      className: this._getTeamDetailMemberLabelClass(row?.label),
    };
  },

  _buildTeamDetailMemberTagPill(row) {
    const tag = this._getTeamDetailMemberPrimaryTag(row);
    return '<span class="td-member-label-pill ' + tag.className + '">' + escapeHTML(tag.label) + '</span>';
  },

  _getTeamDetailMemberUserRoleClass(row) {
    if (row?.isExternalStudent && !row?.user) return 'external-student';
    const rawRole = String(row?.user?.role || 'user').trim() || 'user';
    const displayName = row?.name || row?.user?.displayName || row?.user?.name || '';
    let effectiveRole = rawRole;
    if (typeof this._stealthRole === 'function') {
      effectiveRole = this._stealthRole(displayName, rawRole, row?.user);
    } else if ((rawRole === 'admin' || rawRole === 'super_admin') && row?.user?.stealth === true) {
      effectiveRole = 'user';
    }
    const safeRole = String(effectiveRole || 'user').replace(/[^a-zA-Z0-9_-]/g, '_');
    return 'uc-' + safeRole;
  },

  _getTeamDetailMemberNameClass(row) {
    const classes = ['td-member-name-pill', this._getTeamDetailMemberUserRoleClass(row)];
    if (row?.isMissingName) classes.push('missing-name');
    return classes.join(' ');
  },

  _isTeamDetailRemovableMemberRow(t, row, staffIdentity) {
    if (!t || !row?.uid || !row?.user || !row.isMember) return false;
    const teamId = String(t.id || '');
    const user = row.user;
    const isInTeam = typeof this._isUserInTeam === 'function'
      ? this._isUserInTeam(user, teamId)
      : user.teamId === teamId || (Array.isArray(user.teamIds) && user.teamIds.map(String).includes(teamId));
    if (!isInTeam) return false;
    if (typeof this._isRegularTeamMember === 'function') return this._isRegularTeamMember(user, staffIdentity);
    return !(row.roles && row.roles.size);
  },

  _isTeamDetailRemovableStaffRow(t, row) {
    if (!t || !row?.uid || !row?.user || !row.isMember) return false;
    const roles = row.roles instanceof Set ? row.roles : new Set();
    if (roles.has('\u7403\u7d93')) return false;
    return roles.has('\u6559\u7df4') || roles.has('\u9818\u968a');
  },

  _isTeamDetailProtectedStaffRow(t, row) {
    if (!t || !row?.uid || !row?.user || !row.isMember) return false;
    const roles = row.roles instanceof Set ? row.roles : new Set();
    return roles.has('\u7403\u7d93');
  },

  _getTeamDetailRemovalKind(t, row, staffIdentity) {
    if (this._isTeamDetailRemovableMemberRow(t, row, staffIdentity)) return 'member';
    if (this._isTeamDetailRemovableStaffRow(t, row, staffIdentity)) return 'staff';
    if (this._isTeamDetailProtectedStaffRow(t, row, staffIdentity)) return 'protected';
    if (row?.studentId && row.student && (row.isStudent || row.isPendingStudent)) return 'student';
    return '';
  },

  _getTeamDetailMemberRoleClass(role) {
    const value = String(role || '').trim();
    if (value === '\u6559\u7df4') return 'role-coach';
    if (value === '\u9818\u968a') return 'role-leader';
    if (value === '\u7403\u7d93') return 'role-manager';
    return 'role-default';
  },

  _buildTeamDetailMemberRolePills(row) {
    const roles = Array.from(row.roles || []);
    if (!roles.length) return '<span class="td-member-role-empty">-</span>';
    return roles.map(role => '<span class="td-member-role-pill ' + this._getTeamDetailMemberRoleClass(role) + '">' + escapeHTML(role) + '</span>').join('');
  },

  _readTeamDetailTextValue(source, keys) {
    if (!source || typeof source !== 'object') return '';
    for (const key of keys) {
      const value = source[key];
      if (value == null) continue;
      if (Array.isArray(value)) {
        const joined = value.map(v => String(v || '').trim()).filter(Boolean).join(' / ');
        if (joined) return joined;
        continue;
      }
      const text = String(value).trim();
      if (text) return text;
    }
    return '';
  },

  _readTeamDetailScopedObject(source, teamId, mapKeys) {
    if (!source || !teamId || typeof source !== 'object') return null;
    const id = String(teamId || '');
    for (const key of mapKeys) {
      const map = source[key];
      if (!map || typeof map !== 'object') continue;
      const value = map[id] || map[teamId];
      if (value && typeof value === 'object') return value;
    }
    return null;
  },

  _readTeamDetailScopedText(source, teamId, mapKeys, valueKeys) {
    const scoped = this._readTeamDetailScopedObject(source, teamId, mapKeys);
    return this._readTeamDetailTextValue(scoped, valueKeys);
  },

  _formatTeamDetailPaymentStatus(value) {
    if (value == null || value === '') return '-';
    if (value === true) return '\u5df2\u7e73';
    if (value === false) return '\u672a\u7e73';
    const text = String(value).trim();
    if (!text) return '-';
    const lower = text.toLowerCase();
    if (['paid', 'complete', 'completed', 'yes', 'true'].includes(lower)) return '\u5df2\u7e73';
    if (['unpaid', 'pending', 'no', 'false'].includes(lower)) return '\u672a\u7e73';
    return text;
  },

  _readTeamDetailMemberData(t, row, fieldNames) {
    if (!t || !row || !Array.isArray(fieldNames)) return {};
    const memberKeys = [
      row.uid,
      row.user?.uid,
      row.user?._docId,
      row.key,
    ].map(value => String(value || '').trim())
      .filter(Boolean)
      .map(value => value.replace(/^uid:/, '').replace(/^doc:/, ''));
    for (const fieldName of fieldNames) {
      const map = t[fieldName];
      if (!map || typeof map !== 'object') continue;
      for (const key of memberKeys) {
        const value = map[key];
        if (value && typeof value === 'object') return value;
      }
    }
    return {};
  },

  _getTeamDetailMemberActivityData(t, row) {
    const teamId = String(t?.id || '');
    const teamScoped = this._readTeamDetailMemberData(t, row, ['memberActivityData']);
    const note = this._readTeamDetailTextValue(teamScoped, ['notes', 'note', 'remark', 'activityNotes'])
      || this._readTeamDetailScopedText(row.user, teamId, ['teamActivityData', 'clubActivityData'], ['notes', 'note', 'remark', 'activityNotes'])
      || this._readTeamDetailScopedText(row.student, teamId, ['teamActivityData', 'clubActivityData'], ['notes', 'note', 'remark', 'activityNotes'])
      || this._readTeamDetailTextValue(row.user, ['activityNotes', 'activityNote', 'teamActivityNotes'])
      || this._readTeamDetailTextValue(row.student, ['activityNotes', 'activityNote', 'teamActivityNotes']);
    return {
      count: row.activityCount || 0,
      notes: note || '-',
    };
  },

  _getTeamDetailMemberCourseData(t, row) {
    const teamId = String(t?.id || '');
    const source = row.student || row.user || {};
    const teamScoped = this._readTeamDetailMemberData(t, row, ['memberCourseData']);
    const group = this._readTeamDetailTextValue(source, ['groupNames', 'groupName', 'group', 'className', 'courseGroup'])
      || this._readTeamDetailTextValue(teamScoped, ['groupName', 'group', 'className'])
      || this._readTeamDetailScopedText(row.user, teamId, ['teamCourseData', 'clubCourseData'], ['groupName', 'group', 'className'])
      || '-';
    const payment = source.paidAt
      ? '\u5df2\u7e73'
      : this._formatTeamDetailPaymentStatus(
          source.paymentStatus ?? source.feeStatus ?? source.tuitionStatus ?? source.paid ?? source.feePaid
        );
    const note = this._readTeamDetailTextValue(teamScoped, ['notes', 'note', 'remark', 'courseNotes'])
      || this._readTeamDetailScopedText(row.user, teamId, ['teamCourseData', 'clubCourseData'], ['notes', 'note', 'remark', 'courseNotes'])
      || this._readTeamDetailScopedText(row.student, teamId, ['teamCourseData', 'clubCourseData'], ['notes', 'note', 'remark', 'courseNotes'])
      || this._readTeamDetailTextValue(source, ['coachNotes', 'courseNotes', 'courseNote', 'notes'])
      || '-';
    return {
      group,
      payment,
      count: row.courseCount || 0,
      notes: note,
    };
  },

  _getTeamDetailMemberMatchData(t, row) {
    const teamId = String(t?.id || '');
    const teamScoped = this._readTeamDetailMemberData(t, row, ['memberMatchData']);
    const userScoped = this._readTeamDetailScopedObject(row.user, teamId, ['teamMatchData', 'clubMatchData', 'matchDataByTeam', 'teamMemberMatchData']) || {};
    const studentScoped = this._readTeamDetailScopedObject(row.student, teamId, ['teamMatchData', 'clubMatchData', 'matchDataByTeam', 'teamMemberMatchData']) || {};
    const source = Object.assign({}, row.student || {}, row.user || {}, studentScoped, userScoped, teamScoped);
    return {
      count: row.matchCount || 0,
      jerseyNumber: this._readTeamDetailTextValue(source, ['jerseyNumber', 'jerseyNo', 'shirtNumber', 'number']) || '-',
      position: this._readTeamDetailTextValue(source, ['matchPosition', 'teamPosition', 'position', 'positionTag']) || '-',
      notes: this._readTeamDetailTextValue(source, ['matchNotes', 'matchNote', 'matchRemark', 'notes']) || '-',
    };
  },

  _getTeamMemberClubRoleLevel(row) {
    const roles = row?.roles instanceof Set ? row.roles : new Set();
    if (roles.has('\u7403\u7d93')) return 3;
    if (roles.has('\u9818\u968a')) return 2;
    if (roles.has('\u6559\u7df4')) return 1;
    return 0;
  },

  _getTeamMemberRoleActionTarget(t, row, direction) {
    if (!t || !row?.uid || !row?.user || !row.isMember) return null;
    const canChangeRole = typeof this._canQuickPromoteTeamMember === 'function'
      ? this._canQuickPromoteTeamMember(t)
      : !!this._canEditTeamByRoleOrCaptain?.(t);
    if (!canChangeRole) return null;
    const isInTeam = typeof this._isUserInTeam === 'function'
      ? this._isUserInTeam(row.user, t.id)
      : row.user.teamId === t.id || (Array.isArray(row.user.teamIds) && row.user.teamIds.map(String).includes(String(t.id)));
    if (!isInTeam) return null;

    const currentLevel = typeof this._getTeamMemberClubRoleLevel === 'function'
      ? this._getTeamMemberClubRoleLevel(row)
      : 0;
    if (currentLevel >= 3) return null;

    const actorLevel = typeof this._getCurrentTeamRoleLevel === 'function'
      ? this._getCurrentTeamRoleLevel(t)
      : (canChangeRole ? 3 : 0);
    const configs = {
      promote: {
        actionText: '\u6649\u5347',
        targetByLevel: {
          0: { key: 'coach', label: '\u6559\u7df4', roleName: '\u6559\u7df4', level: 1 },
          1: { key: 'leader', label: '\u9818\u968a', roleName: '\u9818\u968a', level: 2 },
        },
      },
      demote: {
        actionText: '\u964d\u7d1a',
        targetByLevel: {
          2: { key: 'coach', label: '\u6559\u7df4', roleName: '\u6559\u7df4', level: 1 },
          1: { key: 'member', label: '\u968a\u54e1', roleName: '\u968a\u54e1', level: 0 },
        },
      },
    };
    const config = configs[String(direction || '')];
    const target = config?.targetByLevel?.[currentLevel] || null;
    if (!target || target.level >= actorLevel) return null;
    return Object.assign({ direction, actionText: config.actionText }, target);
  },

  _getTeamMemberQuickPromoteTargets(t, row) {
    const target = this._getTeamMemberRoleActionTarget(t, row, 'promote');
    return target ? [target] : [];
  },

  _buildTeamMemberRoleActionButton(t, row, direction) {
    const target = this._getTeamMemberRoleActionTarget(t, row, direction);
    if (!target) return '<span class="td-member-role-empty">-</span>';
    const isDemote = target.direction === 'demote';
    const icon = isDemote
      ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14"></path><path d="M19 12l-7 7-7-7"></path></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg>';
    const label = target.actionText + '\u70ba' + target.label;
    return '<button class="td-member-role-action-btn ' + escapeHTML(target.direction) + '" type="button" title="' + escapeHTML(label) + '" aria-label="' + escapeHTML(label) + '" onclick="event.stopPropagation();App.changeTeamMemberRoleLevel(this,' + escapeHTML(JSON.stringify(t.id)) + ',' + escapeHTML(JSON.stringify(row.key)) + ',' + escapeHTML(JSON.stringify(target.direction)) + ')">'
      + icon
      + '</button>';
  },

  _buildTeamMemberRoleActionCell(t, row, direction) {
    const cellClass = direction === 'demote' ? 'td-member-demote-cell' : 'td-member-promote-cell';
    return '<td class="td-member-role-action-cell ' + cellClass + '">' + this._buildTeamMemberRoleActionButton(t, row, direction) + '</td>';
  },

  _buildTeamMemberRemoveActionCell(removeBtn) {
    return '<td class="td-member-remove-cell">' + (removeBtn || '<span class="td-member-role-empty">-</span>') + '</td>';
  },

  _buildTeamMemberQuickPromoteControls(t, row) {
    return this._buildTeamMemberRoleActionButton(t, row, 'promote');
  },

  _isTeamDetailMatchDataEditableRow(row) {
    return !!(row?.user?._docId || (row?.studentId && row?.student));
  },

  _isTeamDetailMemberNoteEditableRow(row) {
    return !!(row?.user?._docId || (row?.studentId && row?.student));
  },

  _buildTeamMemberCell(value, className) {
    return '<td' + (className ? ' class="' + className + '"' : '') + '>' + escapeHTML(value == null || value === '' ? '-' : value) + '</td>';
  },

  _buildTeamMembersCard(t, canManageMembers, memberEditMode, staffIdentity) {
    this._teamMemberTabByTeam = this._teamMemberTabByTeam || {};
    const showCourseTab = typeof this._isTeamDetailSectionVisible === 'function'
      ? this._isTeamDetailSectionVisible(t, 'courses')
      : this._isTeamDetailTeachingEnabled?.(t) !== false;
    const allowedTabs = new Set(['activity', 'course', 'match']);
    const rawActiveTab = this._teamMemberTabByTeam[t.id] || 'activity';
    let activeTab = allowedTabs.has(rawActiveTab) ? rawActiveTab : 'activity';
    if (activeTab === 'course' && !showCourseTab) activeTab = 'activity';
    const roster = this._getTeamDetailRoster(t);
    const showEditColumn = !!canManageMembers;
    const tabBtn = (key, label) => '<button type="button" class="td-member-tab' + (activeTab === key ? ' active' : '') + '" onclick="App.switchTeamMemberTab(\'' + t.id + '\',\'' + key + '\')">' + label + '</button>';
    const tabsHtml = tabBtn('activity', '\u6d3b\u52d5')
      + (showCourseTab ? tabBtn('course', '\u8ab2\u7a0b') : '')
      + tabBtn('match', '\u8cfd\u4e8b');
    const showRoleActionColumns = !!(canManageMembers && memberEditMode);
    const columns = activeTab === 'course'
      ? [
        { label: '\u66b1\u7a31', className: 'td-member-name-head' },
        { label: '\u6a19\u7c64', className: 'td-member-tag-head' },
        { label: '\u5206\u7d44', className: 'td-member-compact-head' },
        { label: '\u7e73\u8cbb', className: 'td-member-compact-head' },
        { label: '\u6b21\u6578', className: 'td-member-num-head' },
        { label: '\u5099\u8a3b', className: 'td-member-note-head' },
      ]
      : (activeTab === 'match'
        ? [
          { label: '\u66b1\u7a31', className: 'td-member-name-head' },
          { label: '\u6a19\u7c64', className: 'td-member-tag-head' },
          { label: '\u6b21\u6578', className: 'td-member-num-head' },
          { label: '\u80cc\u865f', className: 'td-member-compact-head' },
          { label: '\u4f4d\u7f6e', className: 'td-member-compact-head' },
          { label: '\u5099\u8a3b', className: 'td-member-note-head' },
        ]
        : [
          { label: '\u66b1\u7a31', className: 'td-member-name-head' },
          { label: '\u6a19\u7c64', className: 'td-member-tag-head' },
          { label: '\u6b21\u6578', className: 'td-member-num-head' },
          { label: '\u5099\u8a3b', className: 'td-member-note-head' },
        ]);
    if (showRoleActionColumns) {
      columns.unshift(
        { label: '\u5254\u9664', className: 'td-member-remove-head' },
        { label: '\u6649\u5347', className: 'td-member-role-action-head' },
        { label: '\u964d\u7d1a', className: 'td-member-role-action-head' }
      );
    }
    if (showEditColumn) columns.push({ label: '\u7de8\u8f2f', className: 'td-member-action-head' });
    const header = columns.map(col => '<th' + (col.className ? ' class="' + col.className + '"' : '') + '>' + col.label + '</th>').join('');
    const rows = roster.length ? roster.map(row => {
      const safeName = escapeHTML(row.name || '未命名');
      const profileNameArg = escapeHTML(JSON.stringify(row.name || '未命名'));
      const profileUidArg = row.uid ? ',{uid:' + escapeHTML(JSON.stringify(row.uid)) + '}' : '';
      const profileClick = row.uid || (!row.isExternalStudent && !row.isMissingName)
        ? " onclick='App.showUserProfile(" + profileNameArg + profileUidArg + ")'"
        : '';
      const nameClass = this._getTeamDetailMemberNameClass(row);
      let dataCells = '';
      if (activeTab === 'course') {
        const course = this._getTeamDetailMemberCourseData(t, row);
        dataCells = this._buildTeamMemberCell(course.group, 'td-member-compact')
          + this._buildTeamMemberCell(course.payment, 'td-member-compact')
          + this._buildTeamMemberCell(course.count, 'td-member-num')
          + this._buildTeamMemberCell(course.notes, 'td-member-note');
      } else if (activeTab === 'match') {
        const match = this._getTeamDetailMemberMatchData(t, row);
        dataCells = this._buildTeamMemberCell(match.count, 'td-member-num')
          + this._buildTeamMemberCell(match.jerseyNumber, 'td-member-compact')
          + this._buildTeamMemberCell(match.position, 'td-member-compact')
          + this._buildTeamMemberCell(match.notes, 'td-member-note');
      } else {
        const activity = this._getTeamDetailMemberActivityData(t, row);
        dataCells = this._buildTeamMemberCell(activity.count, 'td-member-num')
          + this._buildTeamMemberCell(activity.notes, 'td-member-note');
      }
      let editActionBtn = '';
      if (showEditColumn && activeTab === 'match' && this._isTeamDetailMatchDataEditableRow(row)) {
        editActionBtn = '<button class="td-member-row-edit-btn td-member-match-edit-btn" type="button" onclick="event.stopPropagation();App.editTeamMemberMatchData(this,' + escapeHTML(JSON.stringify(t.id)) + ',' + escapeHTML(JSON.stringify(row.key)) + ')">\u7de8\u8f2f</button>';
      } else if (showEditColumn && this._isTeamDetailMemberNoteEditableRow(row)) {
        editActionBtn = '<button class="td-member-row-edit-btn td-member-note-edit-btn" type="button" onclick="event.stopPropagation();App.editTeamMemberNote(this,' + escapeHTML(JSON.stringify(t.id)) + ',' + escapeHTML(JSON.stringify(row.key)) + ',' + escapeHTML(JSON.stringify(activeTab)) + ')">\u7de8\u8f2f</button>';
      }
      const removalKind = this._getTeamDetailRemovalKind(t, row, staffIdentity);
      const removeBtn = (canManageMembers && memberEditMode && removalKind)
        ? '<button class="td-member-remove-btn" title="\u5254\u9664\u6210\u54e1" onclick="event.stopPropagation();App.removeTeamRosterRow(this, ' + escapeHTML(JSON.stringify(t.id)) + ', ' + escapeHTML(JSON.stringify(row.key)) + ')">\u5254\u9664</button>'
        : '';
      const managementActionCells = showRoleActionColumns
        ? this._buildTeamMemberRemoveActionCell(removeBtn) + this._buildTeamMemberRoleActionCell(t, row, 'promote') + this._buildTeamMemberRoleActionCell(t, row, 'demote')
        : '';
      const actions = showEditColumn
        ? '<td class="td-member-action-cell">' + (editActionBtn || '<span class="td-member-role-empty">-</span>') + '</td>'
        : '';
      return '<tr>'
        + managementActionCells
        + '<td class="td-member-name-cell"><span class="' + nameClass + '"' + profileClick + '>' + safeName + '</span></td>'
        + '<td class="td-member-tag-cell">' + this._buildTeamDetailMemberTagPill(row) + '</td>'
        + dataCells
        + actions
        + '</tr>';
    }).join('') : '<tr><td colspan="' + columns.length + '" class="td-member-empty">' + I18N.t('teamDetail.none') + '</td></tr>';
    const editBtnIcon = memberEditMode
      ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6L9 17l-5-5"></path></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"></path><circle cx="9.5" cy="7" r="4"></circle><path d="M19 8v6"></path><path d="M22 11h-6"></path></svg>';
    const editBtnLabel = memberEditMode ? '\u5b8c\u6210' : '\u6210\u54e1\u7ba1\u7406';
    const editBtn = canManageMembers ? '<button class="td-member-edit-btn' + (memberEditMode ? ' is-active' : '') + '" type="button" aria-pressed="' + (memberEditMode ? 'true' : 'false') + '" onclick="event.stopPropagation();App.toggleTeamMemberEditMode(' + escapeHTML(JSON.stringify(t.id)) + ')"><span class="td-member-edit-icon">' + editBtnIcon + '</span><span class="td-member-edit-text">' + editBtnLabel + '</span></button>' : '';
    return '<div class="td-card td-section-card" id="team-members-section">'
      + '<div id="team-members-toggle" class="td-card-title td-card-title-row"><span>' + I18N.t('teamDetail.memberList') + '</span><span class="td-card-title-right">' + editBtn + '</span></div>'
      + '<div class="td-member-tabs">' + tabsHtml + '</div>'
      + '<div class="td-member-table-scroll"><table class="td-member-table td-member-table-' + activeTab + (memberEditMode ? ' is-editing' : '') + '"><thead><tr>' + header + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '</div>';
  },

  switchTeamMemberTab(teamId, tab) {
    const allowed = new Set(['activity', 'course', 'match']);
    if (!teamId || !allowed.has(tab)) return;
    let nextTab = tab;
    if (nextTab === 'course') {
      const team = typeof ApiService !== 'undefined' && ApiService.getTeam ? ApiService.getTeam(teamId) : null;
      const canShowCourseTab = team && typeof this._isTeamDetailSectionVisible === 'function'
        ? this._isTeamDetailSectionVisible(team, 'courses')
        : true;
      if (!canShowCourseTab) nextTab = 'activity';
    }
    this._teamMemberTabByTeam = this._teamMemberTabByTeam || {};
    this._teamMemberTabByTeam[teamId] = nextTab;
    this._refreshTeamMembersCardFromCache(teamId);
  },

  _refreshTeamMembersCardFromCache(teamId) {
    const team = ApiService.getTeam?.(teamId);
    const target = document.getElementById('team-members-section');
    if (!team || !target) return false;
    const canManageMembers = typeof this._canManageTeamMembers === 'function' ? this._canManageTeamMembers(team) : false;
    const memberEditMode = !!this._teamMemberEditModeByTeam?.[teamId];
    const staffIdentity = typeof this._getTeamStaffIdentity === 'function'
      ? this._getTeamStaffIdentity(team)
      : { keys: new Set(), names: new Set() };
    target.outerHTML = this._buildTeamMembersCard(team, canManageMembers, memberEditMode, staffIdentity);
    return true;
  },

  _getTeamDetailViewCount(t) {
    const count = Number(t?.viewCount || t?.views || 0);
    return Number.isFinite(count) && count > 0 ? count : 0;
  },

  _getTeamDetailAvatarUrl(t) {
    if (!t) return '';
    const explicit = this._readTeamDetailTextValue(t, ['avatarUrl', 'logoUrl', 'logo', 'avatar']);
    if (explicit) return explicit;
    return this._getTeamCoverImageUrl?.(t, 'cover') || this._getTeamImageUrl?.(t, 'cover') || t.image || this._getTeamImageUrl?.(t, 'card') || '';
  },

  _buildTeamDetailLogoHtml(t) {
    const logoUrl = this._getTeamDetailAvatarUrl(t);
    const fallbackInitial = escapeHTML(String(t?.name || 'T').trim().charAt(0) || 'T');
    const canEditAvatar = !!this._canEditTeamByRoleOrCaptain?.(t);
    const editButton = canEditAvatar
      ? '<button type="button" class="td-club-logo-edit-btn" title="\u7de8\u8f2f\u4ff1\u6a02\u90e8\u982d\u50cf" aria-label="\u7de8\u8f2f\u4ff1\u6a02\u90e8\u982d\u50cf" onclick="event.stopPropagation();App.openTeamAvatarUpload(this)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.2 4.8 19.2 8.8 8.6 19.4 4.5 20.1 5.2 16z"></path><path d="M13.8 6.2 17.8 10.2"></path></svg></button>'
      : '';
    return logoUrl
      ? '<div class="td-club-logo"><img src="' + escapeHTML(logoUrl) + '" alt="' + escapeHTML(t?.name || '') + '">' + editButton + '</div>'
      : '<div class="td-club-logo td-club-logo-fallback"><span>' + fallbackInitial + '</span>' + editButton + '</div>';
  },

  _buildTeamDetailIdentityPanel(t, totalGames, winRate) {
    const sportKey = typeof getSportKeySafe === 'function'
      ? getSportKeySafe(t.sportTag)
      : String(t.sportTag || '').trim();
    const sportLabel = sportKey && typeof EVENT_SPORT_MAP !== 'undefined' && EVENT_SPORT_MAP[sportKey]
      ? EVENT_SPORT_MAP[sportKey].label
      : sportKey;
    const metaParts = [t.region, sportLabel, t.nameEn].filter(Boolean);
    const logoHtml = this._buildTeamDetailLogoHtml(t);
    const teachingBadge = (typeof this._isTeamTeachingTagged === 'function' && this._isTeamTeachingTagged(t))
      ? '<span class="td-teaching-pill">\u6559\u5b78</span>'
      : '';
    const viewHtml = '<div class="td-club-view-count" title="\u700f\u89bd\u6578"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.8"></circle></svg><span>' + this._getTeamDetailViewCount(t).toLocaleString() + '</span></div>';
    const primaryAction = this._buildTeamDetailPrimaryAction(t);
    return '<div class="td-identity-panel">' +
      '<div class="td-club-head-action">' + primaryAction + '</div>' +
      '<div class="td-club-head">' +
      logoHtml +
      '<div class="td-club-title-block">' +
      viewHtml +
      '<div class="td-club-title-row"><h1>' + escapeHTML(t.name || '') + '</h1>' + teachingBadge + '</div>' +
      '<div class="td-club-meta">' + escapeHTML(metaParts.join('｜')) + '</div>' +
      '</div>' +
      '</div>' +
      this._buildTeamDetailActionBar(t) +
      '</div>';
  },

  // ══════════════════════════════════
  //  Team Detail Body HTML Builder
  // ══════════════════════════════════

  _buildTeamDetailBodyHtml(t, canManageMembers, memberEditMode, staffIdentity, totalGames, winRate) {
    const themeColor = this._getTeamThemeColor?.(t) || '';
    const themeOverlayEnabled = !themeColor || this._isTeamThemeOverlayEnabled?.(t) !== false;
    const themeClass = themeColor ? ' has-team-theme' + (themeOverlayEnabled ? '' : ' no-team-theme-overlay') : '';
    const themeStyle = themeColor ? ' style="--team-theme-color:' + escapeHTML(themeColor) + '"' : '';
    return '<div class="td-detail-shell' + themeClass + '"' + themeStyle + '>'
      + this._buildTeamDetailIdentityPanel(t, totalGames, winRate)
      + this._buildTeamDetailSectionNav(t)
      + this._buildTeamDetailOverview(t, totalGames, winRate)
      + (this._isTeamDetailSectionVisible(t, 'courses') ? this._buildTeamEducationSection(t) : '')
      + (this._isTeamDetailSectionVisible(t, 'events') ? this._renderTeamEvents(t.id) : '')
      + (this._isTeamDetailSectionVisible(t, 'matches') ? this._renderTeamTournaments(t.id) : '')
      + (this._isTeamDetailSectionVisible(t, 'info') ? this._buildTeamInfoCard(t) : '')
      + (this._isTeamDetailSectionVisible(t, 'bio') ? this._buildTeamBioCard(t) : '')
      + this._buildTeamRecordHistorySection(t, totalGames, winRate)
      + (this._isTeamDetailSectionVisible(t, 'members') ? this._buildTeamMembersCard(t, canManageMembers, memberEditMode, staffIdentity) : '')
      + '</div>'
      + '<button type="button" class="td-floating-top-btn" aria-label="\u56de\u5230\u9802\u90e8" onclick="App._scrollTeamDetailToTop?.()">\u2191 \u56de\u5230\u9802\u90e8</button>';
  },

  // ══════════════════════════════════
  //  Feed Reactions & Comments (render only)
  // ══════════════════════════════════

  _renderFeedReactions(teamId, post, myUid) {
    if (!post.reactions) post.reactions = { like: [], heart: [], cheer: [] };
    const r = post.reactions;
    const keys = [
      { key: 'like', emoji: '\u{1F44D}' },
      { key: 'heart', emoji: '\u2764\uFE0F' },
      { key: 'cheer', emoji: '\u{1F4AA}' },
    ];
    return `<div style="display:flex;gap:.4rem;margin-top:.3rem">${keys.map(k => {
      const arr = r[k.key] || [];
      const active = arr.includes(myUid);
      const bg = active ? 'var(--accent-bg, #ede9fe)' : 'var(--bg-elevated)';
      const border = active ? 'var(--primary)' : 'var(--border)';
      return `<button style="display:flex;align-items:center;gap:.2rem;padding:.15rem .4rem;border:1px solid ${border};border-radius:var(--radius-full);background:${bg};font-size:.72rem;cursor:pointer;line-height:1" onclick="event.stopPropagation();App.toggleFeedReaction('${teamId}','${post.id}','${k.key}')">${k.emoji}<span style="font-size:.68rem;color:var(--text-secondary)">${arr.length || ''}</span></button>`;
    }).join('')}</div>`;
  },

  _renderFeedComments(teamId, post, myUid, isMember) {
    const comments = post.comments || [];
    let html = '';
    if (comments.length > 0) {
      html += `<div style="margin-top:.3rem;padding-left:.5rem;border-left:2px solid var(--border)">`;
      comments.forEach(c => {
        const canDel = c.uid === myUid;
        html += `<div style="font-size:.75rem;margin-bottom:.25rem;display:flex;align-items:baseline;gap:.3rem;flex-wrap:wrap">
          <span style="font-weight:600;color:var(--text-primary)" data-no-translate>${escapeHTML(c.name)}</span>
          <span style="color:var(--text-secondary);word-break:break-word">${escapeHTML(c.text)}</span>
          <span style="font-size:.62rem;color:var(--text-muted);margin-left:auto;flex-shrink:0">${escapeHTML(c.time)}${canDel ? ` <span style="color:var(--danger);cursor:pointer" onclick="event.stopPropagation();App.deleteFeedComment('${teamId}','${post.id}','${c.id}')">\u2715</span>` : ''}</span>
        </div>`;
      });
      html += `</div>`;
    }
    if (isMember) {
      html += `<div style="display:flex;gap:.3rem;margin-top:.25rem">
        <input type="text" id="fc-${post.id}" maxlength="100" placeholder="${I18N.t('teamDetail.commentPlaceholder')}" style="flex:1;font-size:.75rem;padding:.2rem .4rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);min-width:0">
        <button style="font-size:.68rem;padding:.2rem .45rem;border:1px solid var(--primary);border-radius:var(--radius-sm);background:var(--primary);color:#fff;cursor:pointer;flex-shrink:0" onclick="event.stopPropagation();App.submitFeedComment('${teamId}','${post.id}')">${I18N.t('teamDetail.commentSubmit')}</button>
      </div>`;
    }
    return html;
  },

});
