/* ================================================
   SportHub — Team Detail: Rendering
   Split from team-detail.js — team events, feed,
   reactions, comments rendering & CRUD.
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
    const createButton = this._canCreateTeamDetailActivity()
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
  //  Team Feed
  // ══════════════════════════════════

  _renderTeamFeed(teamId) {
    const t = ApiService.getTeam(teamId);
    if (!t) return '';
    const feed = (typeof this.getTeamFeed === 'function') ? this.getTeamFeed(teamId) : (t.feed || []);
    const isMember = this._isTeamMember(teamId);
    const user = ApiService.getCurrentUser?.();
    const myUid = user?.uid || '';
    const myName = user?.displayName || '';
    const isCaptainOrCoach = (t.captain === myName) || (t.coaches || []).includes(myName);

    // Sort: pinned first, then by time descending
    const sorted = [...feed].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.time || '').localeCompare(a.time || '');
    });

    // Pagination
    const currentPage = this._teamFeedPage[teamId] || 1;
    const totalPages = Math.max(1, Math.ceil(sorted.length / this._FEED_PAGE_SIZE));
    const startIdx = (currentPage - 1) * this._FEED_PAGE_SIZE;
    const pageItems = sorted.slice(startIdx, startIdx + this._FEED_PAGE_SIZE);

    // Post form
    const postFormHtml = isMember ? `
      <div style="margin-bottom:.5rem">
        <textarea id="team-feed-input" rows="2" maxlength="200" placeholder="${I18N.t('teamDetail.postPlaceholder')}" style="width:100%;font-size:.82rem;padding:.4rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);resize:none;box-sizing:border-box"></textarea>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.3rem">
          <button class="primary-btn small" onclick="App.submitTeamPost('${teamId}', this)">${I18N.t('teamDetail.publish')}</button>
          <div style="display:flex;align-items:center;gap:.3rem">
            <span id="team-feed-public-label" style="font-size:.72rem;color:var(--text-muted)">${I18N.t('teamDetail.public')}</span>
            <label class="toggle-switch" style="margin:0;transform:scale(.8)">
              <input type="checkbox" id="team-feed-public" checked>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>` : '';

    const postsHtml = pageItems.length > 0 ? pageItems.map(post => {
      const isAuthor = post.uid === myUid;
      const canDelete = isAuthor || isCaptainOrCoach;
      const canPin = isCaptainOrCoach;
      const publicTag = post.isPublic === false
        ? `<span style="font-size:.58rem;padding:.08rem .25rem;border-radius:3px;background:var(--bg-elevated);color:var(--text-muted);font-weight:600">${I18N.t('teamDetail.privateOnly')}</span>`
        : '';
      return `
        <div style="padding:.5rem 0;border-bottom:1px solid var(--border)${post.pinned ? ';background:var(--accent-bg);margin:0 -.5rem;padding-left:.5rem;padding-right:.5rem;border-radius:var(--radius-sm)' : ''}">
          <div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.2rem">
            ${this._userTag(post.name)}
            ${post.pinned ? '<span style="font-size:.6rem;padding:.1rem .3rem;border-radius:3px;background:#f59e0b;color:#fff;font-weight:700">' + I18N.t('teamDetail.pinned') + '</span>' : ''}
            ${publicTag}
            <span style="margin-left:auto;font-size:.68rem;color:var(--text-muted)">${escapeHTML(post.time)}</span>
          </div>
          <div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word">${escapeHTML(post.content)}</div>
          ${this._renderFeedReactions(teamId, post, myUid)}
          ${this._renderFeedComments(teamId, post, myUid, isMember)}
          <div style="display:flex;gap:.3rem;margin-top:.25rem">
            ${canPin ? `<button style="font-size:.65rem;padding:.15rem .35rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-muted);cursor:pointer" onclick="App.pinTeamPost('${teamId}','${post.id}')">${post.pinned ? I18N.t('teamDetail.unpinPost') : I18N.t('teamDetail.pinPost')}</button>` : ''}
            ${canDelete ? `<button style="font-size:.65rem;padding:.15rem .35rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--danger);cursor:pointer" onclick="App.deleteTeamPost('${teamId}','${post.id}')">${I18N.t('teamDetail.delete')}</button>` : ''}
          </div>
        </div>`;
    }).join('') : '<div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">' + I18N.t('teamDetail.noFeed') + '</div>';

    // Pagination controls
    let paginationHtml = '';
    if (totalPages > 1) {
      const prevDisabled = currentPage <= 1 ? 'opacity:.4;pointer-events:none' : 'cursor:pointer';
      const nextDisabled = currentPage >= totalPages ? 'opacity:.4;pointer-events:none' : 'cursor:pointer';
      paginationHtml = `
        <div style="display:flex;justify-content:center;align-items:center;gap:.5rem;padding:.5rem 0;font-size:.75rem">
          <button style="padding:.2rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-secondary);${prevDisabled}" onclick="App.goTeamFeedPage('${teamId}',${currentPage - 1})">${I18N.t('teamDetail.prevPage')}</button>
          <span style="color:var(--text-muted)">${currentPage} / ${totalPages}</span>
          <button style="padding:.2rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-secondary);${nextDisabled}" onclick="App.goTeamFeedPage('${teamId}',${currentPage + 1})">${I18N.t('teamDetail.nextPage')}</button>
        </div>`;
    }

    return `
      <div class="td-card td-section-card">
        <div class="td-card-title">${I18N.t('teamDetail.feed')} <span style="font-size:.72rem;color:var(--text-muted);font-weight:400">(${feed.length})</span></div>
        ${postFormHtml}
        ${postsHtml}
        ${paginationHtml}
      </div>`;
  },

  // ══════════════════════════════════
  //  Team Detail Body HTML — Helpers
  // ══════════════════════════════════

  _getTeamDetailMemberCount(t) {
    if (!t) return 0;
    return this._getTeamDetailRoster(t).length;
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
      feed: source.feed !== false,
      info: source.info !== false,
      bio: source.bio !== false,
      record: source.record !== false,
      history: source.history !== false,
      members: source.members !== false,
    };
  },

  _isTeamDetailSectionVisible(t, key) {
    const visibility = this._getTeamDetailVisibility(t);
    if (key === 'courses' && !this._isTeamDetailTeachingEnabled(t)) return false;
    return visibility[key] !== false;
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
      const inTeam = typeof this._isUserInTeam === 'function' ? this._isUserInTeam(user, t.id) : user.teamId === t.id;
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
      row.isStudent = true;
    });
    const result = Array.from(rows.values()).filter(row => row.isMember || row.isStudent);
    result.forEach(row => {
      row.label = row.isMember && row.isStudent ? 'ALL' : (row.isStudent ? '學員' : '隊員');
      row.identity = Array.from(row.roles).join(' | ');
      row.isMissingName = !!row.isMissingName || !row.name || this._isTeamDetailUidLike(row.name);
      if (row.isMissingName) row.name = row.isStudent && !row.isMember ? '未命名學員' : '未設定暱稱';
      row.activityCount = this._getTeamDetailActivityAttendanceCount(t, row);
      row.courseCount = this._getTeamDetailCourseParticipationCount(t, row);
      row.matchCount = this._getTeamDetailMatchParticipationCount(t, row);
    });
    return result.sort((a, b) => {
      const rankA = a.roles.size ? 0 : (a.isMember ? 1 : 2);
      const rankB = b.roles.size ? 0 : (b.isMember ? 1 : 2);
      if (rankA !== rankB) return rankA - rankB;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
    });
  },

  _canCreateTeamDetailActivity() {
    const currentUser = ApiService.getCurrentUser?.();
    if (!currentUser?.uid) return false;
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

  _buildTeamDetailActionBar(t) {
    const u = ApiService.getCurrentUser?.();
    const n = u?.displayName || '';
    const isCaptainCoach = (t.captain === n || (t.coaches || []).includes(n));
    const memberCanInvite = t.allowMemberInvite !== false;
    const isMember = this._isTeamMember(t.id);
    const canInvite = isCaptainCoach || (isMember && memberCanInvite);
    const primary = isMember
      ? '<button class="td-action-main td-action-danger" onclick="App.handleLeaveTeam(\'' + t.id + '\')">' + I18N.t('teamDetail.leaveTeam') + '</button>'
      : '<button class="td-action-main" onclick="App.handleJoinTeam(\'' + t.id + '\')">' + I18N.t('teamDetail.applyJoin') + '</button>';
    const share = '<button class="td-action-secondary" onclick="App.shareTeam(\'' + t.id + '\')">\u5206\u4eab</button>';
    const contact = t.captain
      ? '<button class="td-action-secondary" onclick="App.showUserProfile(\'' + escapeHTML(t.captain) + '\')">' + I18N.t('teamDetail.contactCaptain') + '</button>'
      : '<button class="td-action-secondary td-action-disabled" type="button" disabled>' + I18N.t('teamDetail.contactCaptain') + '</button>';
    const invite = canInvite
      ? '<button class="td-action-secondary" onclick="App.showTeamInviteQR(\'' + t.id + '\')">' + I18N.t('teamDetail.inviteQR') + '</button>'
      : '<button class="td-action-secondary td-action-disabled" type="button" disabled>' + I18N.t('teamDetail.inviteQR') + '</button>';
    return '<div class="td-action-panel">' +
      '<div class="td-action-grid">' + primary + share + contact + invite + '</div>' +
      '</div>';
  },

  _buildTeamDetailSectionNav(t) {
    const items = [];
    if (this._isTeamDetailSectionVisible(t, 'events')) {
      items.push('<button type="button" onclick="document.getElementById(\'team-events-section\')?.scrollIntoView({block:\'start\',behavior:\'smooth\'})">\u6d3b\u52d5</button>');
    }
    if (this._isTeamDetailSectionVisible(t, 'courses')) {
      items.push('<button type="button" onclick="document.getElementById(\'edu-detail-section\')?.scrollIntoView({block:\'start\',behavior:\'smooth\'})">\u8ab2\u7a0b</button>');
    }
    if (this._isTeamDetailSectionVisible(t, 'members')) {
      items.push('<button type="button" onclick="document.getElementById(\'team-members-section\')?.scrollIntoView({block:\'start\',behavior:\'smooth\'})">\u968a\u4f0d</button>');
    }
    if (this._isTeamDetailSectionVisible(t, 'record')) {
      items.push('<button type="button" onclick="document.getElementById(\'team-record-section\')?.scrollIntoView({block:\'start\',behavior:\'smooth\'})">\u6230\u7e3e</button>');
    }
    return items.length
      ? '<div class="td-section-nav-panel"><div class="td-section-nav" aria-label="club detail sections">' + items.join('') + '</div></div>'
      : '';
  },

  _buildTeamDetailOverview(t, totalGames, winRate) {
    const memberCount = this._getTeamDetailMemberCount(t);
    const coachCount = Array.isArray(t.coaches) ? t.coaches.length : 0;
    const eventCount = this._getTeamDetailEventCount(t);
    return '<div class="td-overview-grid">' +
      '<div class="td-overview-stat"><span class="td-overview-label">\u6210\u54e1</span><strong>' + memberCount + '</strong></div>' +
      '<div class="td-overview-stat"><span class="td-overview-label">\u6559\u7df4</span><strong>' + coachCount + '</strong></div>' +
      '<div class="td-overview-stat"><span class="td-overview-label">\u672c\u9031\u6d3b\u52d5</span><strong>' + eventCount + '</strong></div>' +
      '</div>';
  },

  _buildTeamEducationSection(t) {
    if (!t) return '';
    return '<div class="td-card td-section-card td-edu-unified" id="edu-detail-section">' +
      '<div class="td-card-title td-card-title-row"><span>\u8ab2\u7a0b\u8207\u5b78\u54e1</span></div>' +
      '<div class="edu-tab-row td-edu-tab-row">' +
      '<div class="tab-bar" id="edu-detail-tabs" style="flex:0 0 auto">' +
      '<button class="tab active" data-edutab="course" onclick="App.switchEduTab(\'course\')">\u8ab2\u7a0b</button>' +
      '<button class="tab" data-edutab="group" onclick="App.switchEduTab(\'group\')">\u73ed\u7d1a</button>' +
      '<span class="edu-tab-mine-wrap"><button class="tab" data-edutab="mine" onclick="App.switchEduTab(\'mine\')">\u6211\u7684</button><span id="edu-mine-badge" class="edu-tab-badge"></span></span>' +
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
    const sportInfoHtml = sportKey
      ? '<div class="td-card-item td-card-item-compact"><span class="td-card-label">\u904b\u52d5\u985e\u578b</span><span class="td-card-value">' + (sportIcon ? sportIcon + ' ' : '') + escapeHTML(sportLabel) + '</span></div>'
      : '';
    return '<div class="td-card td-section-card" id="team-info-section">'
      + '<div class="td-card-title">' + I18N.t('teamDetail.info') + '</div>'
      + '<div class="td-card-grid td-card-grid-compact">'
      + '<div class="td-card-item td-card-item-compact"><span class="td-card-label">\u7403\u968a\u7d93\u7406</span><span class="td-card-value">' + (t.captain ? this._userTag(t.captain, 'captain') : I18N.t('teamDetail.notSet')) + '</span></div>'
      + '<div class="td-card-item td-card-item-compact"><span class="td-card-label">\u9818\u968a</span><span class="td-card-value">' + (() => { const lNames = t.leaders || (t.leader ? [t.leader] : []); return lNames.length ? lNames.map(n => this._teamLeaderTag(n)).join(' ') : I18N.t('teamDetail.notSet'); })() + '</span></div>'
      + '<div class="td-card-item td-card-item-compact"><span class="td-card-label">' + I18N.t('teamDetail.coach') + '</span><span class="td-card-value">' + ((t.coaches || []).length > 0 ? t.coaches.map(c => this._userTag(c, 'coach')).join(' ') : I18N.t('teamDetail.none')) + '</span></div>'
      + '<div class="td-card-item td-card-item-compact"><span class="td-card-label">' + I18N.t('teamDetail.memberCount') + '</span><span class="td-card-value">' + this._getTeamDetailMemberCount(t) + ' ' + I18N.t('teamDetail.personUnit') + '</span></div>'
      + sportInfoHtml
      + '<div class="td-card-item td-card-item-compact"><span class="td-card-label">' + I18N.t('teamDetail.region') + '</span><span class="td-card-value">' + escapeHTML(t.region) + '</span></div>'
      + (t.nationality ? '<div class="td-card-item td-card-item-compact"><span class="td-card-label">' + I18N.t('teamDetail.nationality') + '</span><span class="td-card-value">' + escapeHTML(t.nationality) + '</span></div>' : '')
      + (t.founded ? '<div class="td-card-item td-card-item-compact"><span class="td-card-label">' + I18N.t('teamDetail.founded') + '</span><span class="td-card-value">' + escapeHTML(t.founded) + '</span></div>' : '')
      + (t.contact ? '<div class="td-card-item td-card-item-compact"><span class="td-card-label">' + I18N.t('teamDetail.contact') + '</span><span class="td-card-value">' + escapeHTML(t.contact) + '</span></div>' : '')
      + '</div></div>';
  },

  _buildTeamBioCard(t) {
    return t.bio ? '<div class="td-card td-section-card" id="team-bio-section"><div class="td-card-title" style="text-align:center">' + I18N.t('teamDetail.bio') + '</div><div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word">' + escapeHTML(t.bio) + '</div></div>' : '';
  },

  _buildTeamRecordCard(t, totalGames, winRate) {
    return '<div class="td-card td-section-card" id="team-record-section">'
      + '<div class="td-card-title">' + I18N.t('teamDetail.record') + '</div>'
      + '<div class="td-minimal-record">'
      + '<span>' + I18N.t('teamDetail.totalGames') + ' ' + totalGames + '</span>'
      + '<span>' + I18N.t('teamDetail.winRate') + ' ' + winRate + '%</span>'
      + '<span>\u8cc7\u6599\u4f4d\u7f6e\u5df2\u9810\u7559</span>'
      + '</div></div>';
  },

  _buildTeamHistoryCard(t) {
    const count = Array.isArray(t.history) ? t.history.length : 0;
    return '<div class="td-card td-section-card" id="team-history-section">'
      + '<div class="td-card-title">' + I18N.t('teamDetail.matchHistory') + '</div>'
      + '<div class="td-minimal-placeholder">\u8cfd\u4e8b\u7d00\u9304\u4f4d\u7f6e\u5df2\u9810\u7559' + (count ? '\uff0c\u76ee\u524d\u7d2f\u8a08 ' + count + ' \u7b46' : '') + '</div>'
      + '</div>';
  },

  _buildTeamMembersCard(t, canManageMembers, memberEditMode, staffIdentity) {
    this._teamMemberTabByTeam = this._teamMemberTabByTeam || {};
    const activeTab = this._teamMemberTabByTeam[t.id] || 'all';
    const roster = this._getTeamDetailRoster(t);
    const counts = {
      all: roster.length,
      member: roster.filter(r => r.isMember).length,
      student: roster.filter(r => r.isStudent).length,
    };
    const filtered = roster.filter(r => activeTab === 'all' || (activeTab === 'member' ? r.isMember : r.isStudent));
    const tabBtn = (key, label, count) => '<button type="button" class="td-member-tab' + (activeTab === key ? ' active' : '') + '" onclick="App.switchTeamMemberTab(\'' + t.id + '\',\'' + key + '\')">' + label + '<span>' + count + '</span></button>';
    const rows = filtered.length ? filtered.map(row => {
      const safeName = escapeHTML(row.name || '未命名');
      const profileNameArg = escapeHTML(JSON.stringify(row.name || '未命名'));
      const profileUidArg = row.uid ? ',{uid:' + escapeHTML(JSON.stringify(row.uid)) + '}' : '';
      const profileClick = row.uid || (!row.isExternalStudent && !row.isMissingName)
        ? " onclick='App.showUserProfile(" + profileNameArg + profileUidArg + ")'"
        : '';
      const nameClass = 'td-member-name-main'
        + (row.isExternalStudent ? ' external-student' : '')
        + (row.isMissingName ? ' missing-name' : '');
      const removeBtn = (canManageMembers && memberEditMode && row.uid && row.isMember && !row.roles.size)
        ? '<button class="td-member-remove-btn" title="\u79fb\u9664\u968a\u54e1" onclick="event.stopPropagation();App.removeTeamMember(this, \'' + t.id + '\',\'' + row.uid + '\')">\u00d7</button>'
        : '';
      return '<tr>'
        + '<td class="td-member-name-cell"><span class="' + nameClass + '"' + profileClick + '>' + safeName + '</span>' + removeBtn + '</td>'
        + '<td><span class="td-member-label-pill">' + escapeHTML(row.label) + '</span></td>'
        + '<td>' + row.activityCount + '</td>'
        + '<td>' + row.courseCount + '</td>'
        + '<td>' + row.matchCount + '</td>'
        + '<td class="td-member-identity">' + (row.identity ? escapeHTML(row.identity) : '-') + '</td>'
        + '</tr>';
    }).join('') : '<tr><td colspan="6" class="td-member-empty">' + I18N.t('teamDetail.none') + '</td></tr>';
    const editBtn = canManageMembers ? '<button class="outline-btn td-member-edit-btn" onclick="event.stopPropagation();App.toggleTeamMemberEditMode(\'' + t.id + '\')">' + (memberEditMode ? '\u5b8c\u6210' : '\u7de8\u8f2f') + '</button>' : '';
    return '<div class="td-card td-section-card" id="team-members-section">'
      + '<div id="team-members-toggle" class="td-card-title td-card-title-row"><span>' + I18N.t('teamDetail.memberList') + '</span><span class="td-card-title-right">' + editBtn + '</span></div>'
      + '<div class="td-member-tabs">' + tabBtn('all', '\u5168\u90e8', counts.all) + tabBtn('member', '\u968a\u54e1', counts.member) + tabBtn('student', '\u5b78\u54e1', counts.student) + '</div>'
      + '<div class="td-member-table-scroll"><table class="td-member-table"><thead><tr><th>\u66b1\u7a31</th><th>\u6a19\u7c64</th><th>\u6d3b\u52d5</th><th>\u8ab2\u7a0b</th><th>\u8cfd\u4e8b</th><th>\u8eab\u4efd</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '</div>';
  },

  switchTeamMemberTab(teamId, tab) {
    const allowed = new Set(['all', 'member', 'student']);
    if (!teamId || !allowed.has(tab)) return;
    this._teamMemberTabByTeam = this._teamMemberTabByTeam || {};
    this._teamMemberTabByTeam[teamId] = tab;
    const team = ApiService.getTeam?.(teamId);
    const target = document.getElementById('team-members-section');
    if (!team || !target) return;
    const canManageMembers = typeof this._canManageTeamMembers === 'function' ? this._canManageTeamMembers(team) : false;
    const memberEditMode = !!this._teamMemberEditModeByTeam?.[teamId];
    const staffIdentity = typeof this._getTeamStaffIdentity === 'function'
      ? this._getTeamStaffIdentity(team)
      : { keys: new Set(), names: new Set() };
    target.outerHTML = this._buildTeamMembersCard(team, canManageMembers, memberEditMode, staffIdentity);
  },

  _getTeamDetailViewCount(t) {
    const count = Number(t?.viewCount || t?.views || 0);
    return Number.isFinite(count) && count > 0 ? count : 0;
  },

  _buildTeamDetailIdentityPanel(t, totalGames, winRate) {
    const sportKey = typeof getSportKeySafe === 'function'
      ? getSportKeySafe(t.sportTag)
      : String(t.sportTag || '').trim();
    const sportLabel = sportKey && typeof EVENT_SPORT_MAP !== 'undefined' && EVENT_SPORT_MAP[sportKey]
      ? EVENT_SPORT_MAP[sportKey].label
      : sportKey;
    const metaParts = [t.region, sportLabel, t.nameEn].filter(Boolean);
    const logoUrl = this._getTeamImageUrl?.(t, 'card') || t.logoUrl || t.logo || t.avatar || t.image || '';
    const fallbackInitial = escapeHTML(String(t.name || 'T').trim().charAt(0) || 'T');
    const logoHtml = logoUrl
      ? '<div class="td-club-logo"><img src="' + escapeHTML(logoUrl) + '" alt="' + escapeHTML(t.name || '') + '"></div>'
      : '<div class="td-club-logo td-club-logo-fallback"><span>' + fallbackInitial + '</span></div>';
    const teachingBadge = (typeof this._isTeamTeachingTagged === 'function' && this._isTeamTeachingTagged(t))
      ? '<span class="td-teaching-pill">\u6559\u5b78</span>'
      : '';
    const viewHtml = '<div class="td-club-view-count" title="\u700f\u89bd\u6578"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.8"></circle></svg><span>' + this._getTeamDetailViewCount(t).toLocaleString() + '</span></div>';
    return '<div class="td-identity-panel">' +
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
    return '<div class="td-detail-shell">'
      + this._buildTeamDetailIdentityPanel(t, totalGames, winRate)
      + this._buildTeamDetailSectionNav(t)
      + this._buildTeamDetailOverview(t, totalGames, winRate)
      + (this._isTeamDetailSectionVisible(t, 'events') ? this._renderTeamEvents(t.id) : '')
      + (this._isTeamDetailSectionVisible(t, 'courses') ? this._buildTeamEducationSection(t) : '')
      + (this._isTeamDetailSectionVisible(t, 'feed') ? '<div id="team-feed-section">' + this._renderTeamFeed(t.id) + '</div>' : '')
      + (this._isTeamDetailSectionVisible(t, 'info') ? this._buildTeamInfoCard(t) : '')
      + (this._isTeamDetailSectionVisible(t, 'bio') ? this._buildTeamBioCard(t) : '')
      + (this._isTeamDetailSectionVisible(t, 'record') ? this._buildTeamRecordCard(t, totalGames, winRate) : '')
      + (this._isTeamDetailSectionVisible(t, 'history') ? this._buildTeamHistoryCard(t) : '')
      + (this._isTeamDetailSectionVisible(t, 'members') ? this._buildTeamMembersCard(t, canManageMembers, memberEditMode, staffIdentity) : '')
      + '<button type="button" class="td-floating-top-btn" aria-label="回到俱樂部頁面上方" onclick="document.getElementById(\'page-team-detail\')?.scrollIntoView({block:\'start\',behavior:\'smooth\'})">↑ 置頂</button>'
      + '</div>';
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
