/* ================================================
   ToosterX Activity Comments
   Detail-page comments, replies, private visibility, likes
   ================================================ */

Object.assign(App, {
  _eventCommentLikeBusy: new Set(),
  _eventCommentLoadSeq: 0,
  _eventCommentRetryTimer: null,
  _eventCommentLoadTimeoutMs: 9000,
  _eventCommentRetryDelaysMs: [3000, 15000],
  _eventCommentHardStopMs: 45000,
  _eventCommentCacheTtlMs: 120000,
  _eventCommentCacheMaxEntries: 20,
  _eventCommentCache: new Map(),
  _eventCommentActiveLoads: new Map(),
  _eventCommentCacheInvalidatedAt: new Map(),

  _getEventCommentIdentityChoice(selectId = 'event-comment-identity') {
    const value = String(document.getElementById(selectId)?.value || 'main').trim();
    return value === 'secondary' ? 'secondary' : 'main';
  },

  _renderEventCommentIdentityPicker(selectId = 'event-comment-identity') {
    if (typeof IdentityResolver === 'undefined') return '';
    const user = ApiService.getCurrentUser?.() || null;
    const settings = ApiService.getCurrentIdentitySettings?.() || null;
    const secondary = IdentityResolver.getSecondaryIdentity(user, settings);
    if (!secondary?.displayName) return '';
    const safeId = escapeHTML(selectId);
    return `<label class="event-comment-identity-picker"><span>身份</span><select id="${safeId}"><option value="main" selected>主身份</option><option value="secondary">${escapeHTML(secondary.displayName)}</option></select></label>`;
  },

  _getEventCommentAuthor(requestedIdentityId = 'main') {
    const user = ApiService.getCurrentUser?.() || {};
    const uid = String(user.uid || user.lineUserId || '').trim();
    const rootIdentity = (typeof IdentityResolver !== 'undefined')
      ? IdentityResolver.getMainIdentity(user)
      : null;
    const snapshot = (typeof IdentityResolver !== 'undefined')
      ? IdentityResolver.buildPublicSnapshot({ user, requestedIdentityId })
      : null;
    const rootName = String(rootIdentity?.displayName || user.displayName || user.name || '用戶').trim();
    const rootPhoto = String(rootIdentity?.pictureUrl || user.pictureUrl || user.photoURL || '').trim();
    return {
      uid,
      authorName: rootName || '用戶',
      authorPhoto: rootPhoto,
      identitySnapshot: snapshot || {
        identityId: 'main',
        displayName: rootName || '用戶',
        avatarUrl: rootPhoto,
      },
    };
  },

  _normalizePublicIdentitySnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const identityId = value.identityId === 'secondary' ? 'secondary' : (value.identityId === 'main' ? 'main' : '');
    const displayName = String(value.displayName || '').trim();
    const avatarUrl = String(value.avatarUrl || '').trim();
    if (!identityId || !displayName) return null;
    return {
      identityId,
      displayName,
      avatarUrl,
    };
  },

  _resolveEventCommentDisplay(data) {
    const identitySnapshot = this._normalizePublicIdentitySnapshot(data?.identitySnapshot);
    const displayName = String(identitySnapshot?.displayName || data?.authorName || '用戶').trim() || '用戶';
    const displayPhoto = String(identitySnapshot ? identitySnapshot.avatarUrl : (data?.authorPhoto || '')).trim();
    return {
      identitySnapshot,
      displayName,
      displayPhoto,
      rootAuthorName: String(data?.authorName || '').trim(),
      rootAuthorPhoto: String(data?.authorPhoto || '').trim(),
    };
  },

  _findEventCommentRootUser(authorUid, rootAuthorName = '') {
    const uid = String(authorUid || '').trim();
    const rootName = String(rootAuthorName || '').trim();
    const users = (typeof ApiService !== 'undefined' && typeof ApiService.getAdminUsers === 'function')
      ? (ApiService.getAdminUsers() || [])
      : [];
    return users.find(user => {
      const userUid = String(user?.uid || user?._docId || user?.lineUserId || '').trim();
      if (uid && userUid === uid) return true;
      const userName = String(user?.displayName || user?.name || '').trim();
      return !uid && rootName && userName === rootName;
    }) || null;
  },

  _renderEventCommentAuditTrace(comment, ctx = {}) {
    if (!ctx?.canManage || comment?.identitySnapshot?.identityId !== 'secondary') return '';
    const rootUser = this._findEventCommentRootUser(comment.authorUid, comment.rootAuthorName);
    const rootUid = String(comment.authorUid || rootUser?.uid || rootUser?._docId || rootUser?.lineUserId || '').trim();
    const rootName = String(rootUser?.displayName || rootUser?.name || comment.rootAuthorName || rootUid || 'unknown').trim();
    const roleKey = String(rootUser?.role || '').trim();
    const roleLabel = (typeof ROLES !== 'undefined' && roleKey && ROLES[roleKey]?.label)
      ? ROLES[roleKey].label
      : (roleKey || 'unknown');
    const title = `Root: ${rootName} / ${roleLabel} / ${rootUid || 'unknown'}`;
    return `<span class="event-comment-audit-trace" title="${escapeHTML(title)}"><span class="event-comment-audit-label">&#20027;&#24115;&#34399;</span><span>${escapeHTML(rootName)}</span><span>${escapeHTML(roleLabel)}</span><span class="event-comment-audit-uid">${escapeHTML(rootUid || 'unknown')}</span></span>`;
  },

  _isEventCommentsClosed(eventRecord) {
    if (!eventRecord || eventRecord.status === 'cancelled') return true;
    const end = this._parseEventEndDate?.(eventRecord.date) || this._parseEventStartDate?.(eventRecord.date);
    return end instanceof Date && !Number.isNaN(end.getTime()) && end <= new Date();
  },

  _canManageEventComments(eventRecord) {
    const user = ApiService.getCurrentUser?.();
    if (!user?.uid || !eventRecord) return false;
    const role = this._getCurrentActivityRoleKey?.() || this.currentRole || user.role || 'user';
    const level = (typeof ROLE_LEVEL_MAP !== 'undefined' && ROLE_LEVEL_MAP[role]) || 0;
    if (level >= ROLE_LEVEL_MAP.admin) return true;
    if (eventRecord.creatorUid && eventRecord.creatorUid === user.uid) return true;
    if (eventRecord.ownerUid && eventRecord.ownerUid === user.uid) return true;
    if (Array.isArray(eventRecord.delegateUids) && eventRecord.delegateUids.includes(user.uid)) return true;
    if (Array.isArray(eventRecord.delegates) && eventRecord.delegates.some(d => d?.uid === user.uid)) return true;
    return false;
  },

  async _resolveEventCommentsDocId(eventRecordOrId) {
    const eventRecord = typeof eventRecordOrId === 'object' ? eventRecordOrId : ApiService.getEvent?.(eventRecordOrId);
    const eventId = eventRecord?.id || eventRecordOrId;
    if (eventRecord?._docId || eventRecord?.docId) return eventRecord._docId || eventRecord.docId;
    return await FirebaseService._getEventDocIdAsync(eventId);
  },

  _eventCommentTimeLabel(value) {
    const ms = this._eventCommentTimeMs(value);
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  },

  _eventCommentTimeMs(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') {
      try { return value.toMillis(); } catch (_) { return 0; }
    }
    if (typeof value === 'object' && typeof value.seconds === 'number') {
      return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
    }
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
  },

  _renderEventCommentAvatar(name, photo) {
    const safeName = escapeHTML(name || '用戶');
    const safePhoto = String(photo || '').trim();
    if (safePhoto) {
      return `<img class="event-comment-avatar" src="${escapeHTML(safePhoto)}" alt="${safeName}" referrerpolicy="no-referrer" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'event-comment-avatar event-comment-avatar-fallback',textContent:'${escapeHTML(String(name || '?').trim().charAt(0) || '?')}' }))">`;
    }
    return `<span class="event-comment-avatar event-comment-avatar-fallback">${escapeHTML(String(name || '?').trim().charAt(0) || '?')}</span>`;
  },

  _normalizeEventCommentLikers(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value
      .map(liker => ({
        uid: String(liker?.uid || '').trim(),
        authorName: String(this._displayNameOrUidFallback?.(liker?.authorName || liker?.displayName || liker?.name, liker?.uid, '用戶') || '用戶').trim(),
        authorPhoto: String(liker?.authorPhoto || liker?.pictureUrl || liker?.photoURL || '').trim(),
      }))
      .filter(liker => {
        if (!liker.uid || seen.has(liker.uid)) return false;
        seen.add(liker.uid);
        return true;
      })
      .slice(0, 32);
  },

  _mapEventCommentDoc(docSnap) {
    const data = docSnap.data() || {};
    const recentLikers = this._normalizeEventCommentLikers(data.recentLikers);
    const rawLikeCount = Number(data.likeCount);
    const rawReplyCount = Number(data.replyCount);
    const user = ApiService.getCurrentUser?.();
    const display = this._resolveEventCommentDisplay(data);
    return {
      id: docSnap.id,
      eventId: data.eventId || '',
      authorUid: data.authorUid || '',
      authorName: display.displayName,
      authorPhoto: display.displayPhoto,
      rootAuthorName: display.rootAuthorName,
      rootAuthorPhoto: display.rootAuthorPhoto,
      identitySnapshot: display.identitySnapshot,
      body: data.body || '',
      visibility: data.visibility === 'private' ? 'private' : 'public',
      replyLocked: data.replyLocked === true,
      deleted: data.deleted === true,
      createdAt: data.createdAt || null,
      replies: [],
      repliesLoaded: false,
      replyCount: Number.isFinite(rawReplyCount) ? Math.max(0, Math.floor(rawReplyCount)) : 0,
      likeCount: Number.isFinite(rawLikeCount) ? Math.max(0, Math.floor(rawLikeCount)) : recentLikers.length,
      likedByMe: !!user?.uid && recentLikers.some(liker => liker.uid === user.uid),
      likers: recentLikers,
      hasLikeSummary: Object.prototype.hasOwnProperty.call(data, 'likeCount') || Array.isArray(data.recentLikers),
    };
  },

  _mapEventCommentReplyDoc(docSnap) {
    const data = docSnap.data() || {};
    const display = this._resolveEventCommentDisplay(data);
    return {
      id: docSnap.id,
      authorUid: data.authorUid || '',
      authorName: display.displayName,
      authorPhoto: display.displayPhoto,
      rootAuthorName: display.rootAuthorName,
      rootAuthorPhoto: display.rootAuthorPhoto,
      identitySnapshot: display.identitySnapshot,
      body: data.body || '',
      deleted: data.deleted === true,
      createdAt: data.createdAt || null,
    };
  },

  _mapEventCommentLikeDoc(docSnap) {
    const data = docSnap.data() || {};
    const uid = String(data.uid || docSnap.id || '').trim();
    const authorName = String(this._displayNameOrUidFallback?.(data.authorName || data.displayName || data.name, uid, '用戶') || '用戶').trim();
    return {
      uid,
      authorName: authorName || '用戶',
      authorPhoto: String(data.authorPhoto || data.pictureUrl || data.photoURL || '').trim(),
      createdAt: data.createdAt || null,
    };
  },

  _isEventCommentPerfLogEnabled() {
    return !!(typeof window !== 'undefined'
      && (window._perfCommentLog || (typeof localStorage !== 'undefined' && localStorage.getItem('_perfCommentLog'))));
  },

  _eventCommentPerfNow() {
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  },

  _logEventCommentPerf(label, payload = {}) {
    if (!this._isEventCommentPerfLogEnabled?.()) return;
    console.info('[event-comments:perf]', label, payload);
  },

  _getEventCommentsCacheKey(eventRecord) {
    const user = ApiService.getCurrentUser?.();
    if (!user?.uid || !eventRecord) return '';
    const eventKey = String(eventRecord._docId || eventRecord.docId || eventRecord.id || '').trim();
    if (!eventKey) return '';
    const role = String(this._getCurrentActivityRoleKey?.() || this.currentRole || user.role || 'user').trim() || 'user';
    const scope = this._canManageEventComments(eventRecord) ? 'manage' : 'member';
    return [eventKey, user.uid, role, scope].join('|');
  },

  _cloneEventCommentsState(state) {
    return {
      eventDocId: String(state?.eventDocId || ''),
      comments: Array.isArray(state?.comments)
        ? state.comments.map(comment => ({
          ...comment,
          replies: Array.isArray(comment.replies) ? comment.replies.map(reply => ({ ...reply })) : [],
          likers: Array.isArray(comment.likers) ? comment.likers.map(liker => ({ ...liker })) : [],
        }))
        : [],
    };
  },

  _getEventCommentsCachedState(cacheKey) {
    if (!cacheKey || !(this._eventCommentCache instanceof Map)) return null;
    const entry = this._eventCommentCache.get(cacheKey);
    const ttl = Math.max(0, Number(this._eventCommentCacheTtlMs) || 0);
    const invalidatedAt = Math.max(
      Number(this._eventCommentCacheInvalidatedAt?.get(entry?.eventId) || 0),
      Number(this._eventCommentCacheInvalidatedAt?.get(entry?.eventDocId) || 0),
    );
    if (!entry || !ttl || (Date.now() - entry.cachedAt) > ttl || (invalidatedAt && entry.cachedAt <= invalidatedAt)) {
      if (entry) this._eventCommentCache.delete(cacheKey);
      return null;
    }
    return this._cloneEventCommentsState(entry.state);
  },

  _setEventCommentsCacheState(cacheKey, eventRecord, state) {
    if (!cacheKey || !(this._eventCommentCache instanceof Map)) return;
    this._eventCommentCache.set(cacheKey, {
      cachedAt: Date.now(),
      eventId: String(eventRecord?.id || ''),
      eventDocId: String(state?.eventDocId || eventRecord?._docId || eventRecord?.docId || ''),
      state: this._cloneEventCommentsState(state),
    });
    const maxEntries = Math.max(1, Number(this._eventCommentCacheMaxEntries) || 20);
    while (this._eventCommentCache.size > maxEntries) {
      const oldestKey = this._eventCommentCache.keys().next().value;
      this._eventCommentCache.delete(oldestKey);
    }
  },

  _clearEventCommentsCacheForEvent(eventId) {
    const target = String(eventId || '').trim();
    if (!target) return;
    if (this._eventCommentCacheInvalidatedAt instanceof Map) {
      this._eventCommentCacheInvalidatedAt.set(target, Date.now());
    }
    if (this._eventCommentCache instanceof Map) {
      for (const [key, entry] of this._eventCommentCache.entries()) {
        if (key.startsWith(target + '|') || entry?.eventId === target || entry?.eventDocId === target) {
          this._eventCommentCache.delete(key);
        }
      }
    }
    if (this._eventCommentActiveLoads instanceof Map) {
      for (const key of this._eventCommentActiveLoads.keys()) {
        if (key.startsWith(target + '|')) this._eventCommentActiveLoads.delete(key);
      }
    }
  },

  async _fetchEventComments(eventRecord) {
    const user = ApiService.getCurrentUser?.();
    if (!user?.uid) return { eventDocId: '', comments: [] };
    const eventDocId = await this._resolveEventCommentsDocId(eventRecord);
    if (!eventDocId) return { eventDocId: '', comments: [] };
    const commentsRef = db.collection('events').doc(eventDocId).collection('comments');
    const canManage = this._canManageEventComments(eventRecord);
    const snaps = [];
    if (canManage) {
      snaps.push(await commentsRef.limit(80).get());
    } else {
      const [publicSnap, ownSnap] = await Promise.all([
        commentsRef.where('visibility', '==', 'public').limit(60).get(),
        commentsRef.where('authorUid', '==', user.uid).limit(30).get(),
      ]);
      snaps.push(publicSnap, ownSnap);
    }
    const byId = new Map();
    snaps.forEach(snap => snap.docs.forEach(docSnap => byId.set(docSnap.id, this._mapEventCommentDoc(docSnap))));
    const comments = Array.from(byId.values())
      .sort((a, b) => this._eventCommentTimeMs(b.createdAt) - this._eventCommentTimeMs(a.createdAt))
      .slice(0, 80);
    return { eventDocId, comments };
  },

  async _loadEventComments(eventRecord, options = {}) {
    const cacheKey = this._getEventCommentsCacheKey(eventRecord);
    const forceRefresh = options?.forceRefresh === true;
    if (!forceRefresh) {
      const cached = this._getEventCommentsCachedState(cacheKey);
      if (cached) return { ...cached, fromCache: true };
      const activeLoad = this._eventCommentActiveLoads instanceof Map
        ? this._eventCommentActiveLoads.get(cacheKey)
        : null;
      if (activeLoad) return activeLoad;
    }

    const startedAt = this._eventCommentPerfNow();
    const startedWallAt = Date.now();
    const loadPromise = this._fetchEventComments(eventRecord)
      .then(state => {
        const invalidatedAt = Math.max(
          Number(this._eventCommentCacheInvalidatedAt?.get(eventRecord?.id) || 0),
          Number(this._eventCommentCacheInvalidatedAt?.get(eventRecord?._docId) || 0),
          Number(this._eventCommentCacheInvalidatedAt?.get(eventRecord?.docId) || 0),
          Number(this._eventCommentCacheInvalidatedAt?.get(state?.eventDocId) || 0),
        );
        if (!invalidatedAt || invalidatedAt <= startedWallAt) {
          this._setEventCommentsCacheState(cacheKey, eventRecord, state);
        }
        this._logEventCommentPerf('fetch', {
          eventId: eventRecord?.id || '',
          forceRefresh,
          comments: state.comments?.length || 0,
          ms: +(this._eventCommentPerfNow() - startedAt).toFixed(1),
        });
        return state;
      })
      .finally(() => {
        if (!forceRefresh && cacheKey && this._eventCommentActiveLoads instanceof Map) {
          this._eventCommentActiveLoads.delete(cacheKey);
        }
      });

    if (!forceRefresh && cacheKey && this._eventCommentActiveLoads instanceof Map) {
      this._eventCommentActiveLoads.set(cacheKey, loadPromise);
    }
    return loadPromise;
  },

  _isCurrentEventCommentLoad(eventId, requestSeq) {
    return requestSeq === this._eventCommentLoadSeq
      && this.currentPage === 'page-activity-detail'
      && this._currentDetailEventId === eventId;
  },

  _clearEventCommentRetryTimer() {
    if (this._eventCommentRetryTimer) {
      clearTimeout(this._eventCommentRetryTimer);
      this._eventCommentRetryTimer = null;
    }
  },

  _waitForEventCommentsLoad(loadPromise, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(`event comments timeout after ${timeoutMs}ms`);
        err.code = 'event-comments-timeout';
        reject(err);
      }, timeoutMs);
      loadPromise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        err => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  },

  _renderLoadedEventComments(eventId, eventRecord, requestSeq, state, options = {}) {
    if (!this._isCurrentEventCommentLoad(eventId, requestSeq)) return false;
    const container = document.getElementById('detail-comments-container');
    if (!container) return false;
    this._clearEventCommentRetryTimer();
    container.innerHTML = this._renderEventCommentsHtml(eventRecord, state?.comments || []);
    if (options.hydrateLikes !== false) {
      this._hydrateEventCommentLikeState?.(eventId, state?.eventDocId || '', state?.comments || []);
    }
    return true;
  },

  _renderEventCommentsLoadIssue(eventId, options = {}) {
    const container = document.getElementById('detail-comments-container');
    if (!container) return;
    const final = options.final === true;
    const safeEventId = escapeHTML(eventId || '');
    const title = final
      ? '\u7559\u8a00\u66ab\u6642\u7121\u6cd5\u8f09\u5165'
      : '\u7559\u8a00\u8f09\u5165\u8f03\u4e45';
    const note = final
      ? '\u53ef\u4ee5\u5148\u700f\u89bd\u6d3b\u52d5\u8cc7\u8a0a\uff0c\u7a0d\u5f8c\u518d\u91cd\u65b0\u8f09\u5165\u7559\u8a00\u3002'
      : '\u7db2\u8def\u53ef\u80fd\u8f03\u6162\uff0c\u7cfb\u7d71\u6703\u5728\u80cc\u666f\u518d\u8a66\u4e00\u6b21\u3002';
    container.innerHTML = `<div class="detail-section event-comments-section">
      <div class="detail-section-title">\u7559\u8a00</div>
      <div class="event-comments-empty event-comments-load-state">
        <div class="event-comments-load-title">${title}</div>
        <div class="event-comments-load-note">${note}</div>
        <div class="event-comments-load-actions">
          <button type="button" class="event-comment-retry-btn" onclick="App._retryEventComments('${safeEventId}')">\u91cd\u65b0\u8f09\u5165\u7559\u8a00</button>
        </div>
      </div>
    </div>`;
  },

  _scheduleEventCommentAutoRetry(eventId, requestSeq, attempt, startedAt) {
    const delays = Array.isArray(this._eventCommentRetryDelaysMs) ? this._eventCommentRetryDelaysMs : [];
    const hardStopMs = Number(this._eventCommentHardStopMs) || 45000;
    const elapsed = Date.now() - startedAt;
    if (attempt >= delays.length || elapsed >= hardStopMs) {
      if (this._isCurrentEventCommentLoad(eventId, requestSeq)) {
        this._renderEventCommentsLoadIssue(eventId, { final: true });
      }
      return;
    }
    this._clearEventCommentRetryTimer();
    const remaining = Math.max(0, hardStopMs - elapsed);
    const delay = Math.min(Math.max(0, Number(delays[attempt]) || 0), remaining);
    this._eventCommentRetryTimer = setTimeout(() => {
      this._eventCommentRetryTimer = null;
      if (!this._isCurrentEventCommentLoad(eventId, requestSeq)) return;
      if ((Date.now() - startedAt) >= hardStopMs) {
        this._renderEventCommentsLoadIssue(eventId, { final: true });
        return;
      }
      this._renderEventComments(eventId, {
        autoRetryAttempt: attempt + 1,
        startedAt,
      });
    }, delay);
  },

  _retryEventComments(eventId) {
    this._clearEventCommentRetryTimer();
    return this._renderEventComments(eventId, { manualRetry: true });
  },

  async _renderEventComments(eventId, options = {}) {
    const container = document.getElementById('detail-comments-container');
    const eventRecord = ApiService.getEvent?.(eventId);
    if (!container || !eventRecord) return;
    const requestSeq = ++this._eventCommentLoadSeq;
    this._clearEventCommentRetryTimer();
    const user = ApiService.getCurrentUser?.();
    if (!user?.uid) {
      container.innerHTML = '<div class="detail-section event-comments-section"><div class="detail-section-title">留言</div><div class="event-comments-empty">登入後可查看與留言</div></div>';
      return;
    }
    const retryAttempt = Math.max(0, Number(options?.autoRetryAttempt) || 0);
    const startedAt = Number(options?.startedAt) || Date.now();
    const forceRefresh = options?.forceRefresh === true || retryAttempt > 0 || options?.manualRetry === true;
    const cacheKey = this._getEventCommentsCacheKey(eventRecord);
    const cachedState = forceRefresh ? null : this._getEventCommentsCachedState(cacheKey);
    if (cachedState) {
      this._renderLoadedEventComments(eventId, eventRecord, requestSeq, cachedState, { hydrateLikes: false });
      this._logEventCommentPerf('cache-hit', {
        eventId,
        comments: cachedState.comments?.length || 0,
      });
      const refreshPromise = Promise.resolve().then(() => this._loadEventComments(eventRecord, { forceRefresh: true }));
      try {
        const freshState = await this._waitForEventCommentsLoad(refreshPromise, Number(this._eventCommentLoadTimeoutMs) || 9000);
        this._renderLoadedEventComments(eventId, eventRecord, requestSeq, freshState);
      } catch (err) {
        if (!this._isCurrentEventCommentLoad(eventId, requestSeq)) return;
        if (err?.code === 'event-comments-timeout') {
          console.warn('[event-comments] background refresh timeout', {
            eventId,
            timeoutMs: this._eventCommentLoadTimeoutMs,
          });
          refreshPromise.then(
            state => this._renderLoadedEventComments(eventId, eventRecord, requestSeq, state),
            lateErr => console.error('[event-comments] late background refresh failed', lateErr),
          );
          return;
        }
        console.warn('[event-comments] background refresh failed', err);
      }
      return;
    }
    const loadingText = retryAttempt > 0 || options?.manualRetry
      ? '\u7559\u8a00\u91cd\u65b0\u8f09\u5165\u4e2d...'
      : '\u7559\u8a00\u8f09\u5165\u4e2d...';
    container.innerHTML = `<div class="detail-section event-comments-section"><div class="detail-section-title">\u7559\u8a00</div><div class="reg-loading">${loadingText}</div></div>`;
    const loadPromise = Promise.resolve().then(() => this._loadEventComments(eventRecord, { forceRefresh }));
    try {
      const state = await this._waitForEventCommentsLoad(loadPromise, Number(this._eventCommentLoadTimeoutMs) || 9000);
      this._renderLoadedEventComments(eventId, eventRecord, requestSeq, state);
    } catch (err) {
      if (!this._isCurrentEventCommentLoad(eventId, requestSeq)) return;
      if (err?.code === 'event-comments-timeout') {
        console.warn('[event-comments] load timeout', {
          eventId,
          attempt: retryAttempt,
          timeoutMs: this._eventCommentLoadTimeoutMs,
        });
        this._renderEventCommentsLoadIssue(eventId);
        loadPromise.then(
          state => this._renderLoadedEventComments(eventId, eventRecord, requestSeq, state),
          lateErr => console.error('[event-comments] late load failed', lateErr),
        );
        this._scheduleEventCommentAutoRetry(eventId, requestSeq, retryAttempt, startedAt);
        return;
      }
      console.error('[event-comments] render failed', err);
      this._renderEventCommentsLoadIssue(eventId, { final: true });
    }
  },

  _patchEventCommentLikeUi(commentId, likedByMe, likeCount, likers) {
    const card = Array.from(document.querySelectorAll('.event-comment-card'))
      .find(el => el.getAttribute('data-comment-id') === commentId);
    if (!card) return;
    const btn = card.querySelector('.event-comment-like');
    const safeCount = Math.max(0, Number(likeCount) || 0);
    this._setEventCommentLikeButtonState?.(btn, !!likedByMe, safeCount);

    const normalizedLikers = this._normalizeEventCommentLikers(likers);
    const stack = card.querySelector('.event-comment-like-avatars');
    const html = this._renderEventCommentLikeAvatars({ likers: normalizedLikers, likeCount: safeCount });
    if (stack) {
      if (html) stack.outerHTML = html;
      else stack.remove();
    } else if (html && btn) {
      btn.insertAdjacentHTML('afterend', html);
    }
  },

  async _hydrateEventCommentLikeState(eventId, eventDocId, comments) {
    const user = ApiService.getCurrentUser?.();
    if (!user?.uid || !eventDocId || !Array.isArray(comments) || !comments.length) return;
    const commentsRef = db.collection('events').doc(eventDocId).collection('comments');
    const targets = comments.slice(0, 80);

    for (let i = 0; i < targets.length; i += 8) {
      if (this.currentPage !== 'page-activity-detail' || this._currentDetailEventId !== eventId) return;
      const batch = targets.slice(i, i + 8);
      await Promise.all(batch.map(async comment => {
        const likeRef = commentsRef.doc(comment.id).collection('likes');
        let likedByMe = !!comment.likedByMe;
        let likers = Array.isArray(comment.likers) ? comment.likers : [];
        let likeCount = Math.max(0, Number(comment.likeCount) || 0);

        const ownLikePromise = likedByMe
          ? Promise.resolve(null)
          : likeRef.doc(user.uid).get().catch(() => null);
        const legacyLikesPromise = comment.hasLikeSummary
          ? Promise.resolve(null)
          : likeRef.orderBy('createdAt', 'desc').limit(32).get()
            .catch(() => likeRef.limit(32).get().catch(() => null));

        const [ownLikeSnap, legacyLikeSnap] = await Promise.all([ownLikePromise, legacyLikesPromise]);
        if (ownLikeSnap?.exists) likedByMe = true;
        if (legacyLikeSnap?.docs?.length) {
          likers = legacyLikeSnap.docs
            .map(d => this._mapEventCommentLikeDoc(d))
            .filter(liker => liker.uid);
          likeCount = Math.max(likeCount, likers.length);
        }
        if (likedByMe) likeCount = Math.max(likeCount, 1);
        this._patchEventCommentLikeUi(comment.id, likedByMe, likeCount, likers);
      }));
    }
  },

  _renderEventCommentsHtml(eventRecord, comments) {
    const closed = this._isEventCommentsClosed(eventRecord);
    const canManage = this._canManageEventComments(eventRecord);
    const eventId = escapeHTML(eventRecord.id || '');
    const identityPicker = this._renderEventCommentIdentityPicker?.() || '';
    const inputHtml = closed ? '<div class="event-comments-closed">活動已結束，留言輸入已關閉</div>' : `
      <form class="event-comment-form" onsubmit="App._submitEventComment('${eventId}');return false;">
        <textarea id="event-comment-input" maxlength="300" rows="3" placeholder="輸入留言，最多 300 字"></textarea>
        <div class="event-comment-form-foot">
          ${identityPicker}
          <label class="event-comment-private-toggle"><input type="checkbox" id="event-comment-private"> 私密留言（僅主辦與委託能見）</label>
          <button type="submit" class="event-comment-submit">送出</button>
        </div>
      </form>`;
    const listHtml = comments.length
      ? comments.map(c => this._renderEventCommentCard(eventRecord, c, { closed, canManage })).join('')
      : '<div class="event-comments-empty">尚無留言</div>';
    return `<div class="detail-section event-comments-section">
      <div class="detail-section-title">留言</div>
      ${inputHtml}
      <div class="event-comments-list">${listHtml}</div>
    </div>`;
  },

  _renderEventCommentLikeAvatars(comment) {
    const likers = Array.isArray(comment?.likers) ? comment.likers.slice(0, 32) : [];
    if (!likers.length) return '';
    const stacked = likers.length > 6;
    const step = stacked ? 8 : 26;
    const stackWidth = 24 + Math.max(0, likers.length - 1) * step;
    const countLabel = comment.likeCount || likers.length;
    const avatars = likers.map((liker, index) => {
      const safeUid = escapeHTML(liker.uid || '');
      const safeName = escapeHTML(liker.authorName || '用戶');
      const safePhoto = String(liker.authorPhoto || '').trim();
      const safePhotoAttr = escapeHTML(safePhoto);
      const initial = escapeHTML(String(liker.authorName || '?').trim().charAt(0) || '?');
      const style = `--i:${index};z-index:${80 - index}`;
      if (safePhoto) {
        return `<img class="event-comment-like-avatar" data-uid="${safeUid}" data-author-photo="${safePhotoAttr}" src="${safePhotoAttr}" alt="${safeName}" title="${safeName}" referrerpolicy="no-referrer" loading="lazy" decoding="async" style="${style}" onerror="var s=document.createElement('span');s.className='event-comment-like-avatar event-comment-like-avatar-fallback';s.textContent='${initial}';s.setAttribute('title','${safeName}');s.setAttribute('data-uid','${safeUid}');s.setAttribute('style','${style}');this.replaceWith(s)">`;
      }
      return `<span class="event-comment-like-avatar event-comment-like-avatar-fallback" data-uid="${safeUid}" title="${safeName}" style="${style}">${initial}</span>`;
    }).join('');
    return `<div class="event-comment-like-avatars" aria-label="${escapeHTML(countLabel + ' likes')}" style="--stack-width:${stackWidth}px;--step:${step}px">${avatars}</div>`;
  },

  _renderEventCommentCard(eventRecord, comment, ctx) {
    const safeEventId = escapeHTML(eventRecord.id || '');
    const safeCommentId = escapeHTML(comment.id);
    const privateBadge = comment.visibility === 'private' ? '<span class="event-comment-badge private">私密</span>' : '';
    const lockedBadge = comment.replyLocked ? '<span class="event-comment-badge locked">已鎖回覆</span>' : '';
    const bodyHtml = comment.deleted
      ? '<div class="event-comment-deleted">留言已刪除</div>'
      : `<div class="event-comment-body">${escapeHTML(comment.body)}</div>`;
    const manageHtml = ctx.canManage ? `
      <button type="button" class="event-comment-mini-btn" onclick="App._setEventCommentReplyLocked('${safeEventId}','${safeCommentId}',${comment.replyLocked ? 'false' : 'true'})">${comment.replyLocked ? '解鎖' : '鎖回覆'}</button>
      <button type="button" class="event-comment-mini-btn danger" onclick="App._deleteEventComment('${safeEventId}','${safeCommentId}')">刪除</button>` : '';
    const replyBtn = (!ctx.closed && !comment.replyLocked && !comment.deleted)
      ? `<button type="button" class="event-comment-action" onclick="App._toggleEventCommentReplyBox('${safeCommentId}')">回覆</button>`
      : '';
    const replyCount = Math.max(0, Number(comment.replyCount) || 0);
    const loadRepliesBtn = !comment.deleted && !comment.repliesLoaded
      ? `<button type="button" class="event-comment-action event-comment-load-replies" onclick="App._loadEventCommentReplies('${safeEventId}','${safeCommentId}')">${replyCount ? `查看 ${replyCount} 則回覆` : '查看回覆'}</button>`
      : '';
    const replyForm = (!ctx.closed && !comment.replyLocked && !comment.deleted)
      ? `<form class="event-comment-reply-form" id="event-comment-reply-${safeCommentId}" onsubmit="App._submitEventCommentReply('${safeEventId}','${safeCommentId}');return false;" hidden><input maxlength="100" placeholder="回覆留言，最多 100 字"><button type="submit">送出</button></form>`
      : '';
    const isSecondarySnapshot = comment.identitySnapshot?.identityId === 'secondary';
    const authorHtml = isSecondarySnapshot
      ? `<span class="event-comment-author event-comment-author-static">${escapeHTML(comment.authorName)}</span>`
      : `<button type="button" class="event-comment-author" onclick="App.showUserProfile('${escapeHTML(comment.authorName)}',{uid:'${escapeHTML(comment.authorUid)}',allowGuest:true})">${escapeHTML(comment.authorName)}</button>`;
    const auditTraceHtml = this._renderEventCommentAuditTrace(comment, ctx);
    return `<article class="event-comment-card" data-comment-id="${safeCommentId}">
      <div class="event-comment-head">
        ${this._renderEventCommentAvatar(comment.authorName, comment.authorPhoto)}
        ${authorHtml}
        <span class="event-comment-time">${escapeHTML(this._eventCommentTimeLabel(comment.createdAt))}</span>
        ${privateBadge}${lockedBadge}${auditTraceHtml}
        <span class="event-comment-manage">${manageHtml}</span>
      </div>
      ${bodyHtml}
      <div class="event-comment-actions">
        <button type="button" class="event-comment-action event-comment-like${comment.likedByMe ? ' active' : ''}" onclick="App._toggleEventCommentLike('${safeEventId}','${safeCommentId}')" aria-pressed="${comment.likedByMe ? 'true' : 'false'}">${this._eventCommentLikeIcon()}<span>+${comment.likeCount || 0}</span></button>
        ${this._renderEventCommentLikeAvatars(comment)}
        ${replyBtn}
        ${loadRepliesBtn}
      </div>
      ${replyForm}
      ${this._renderEventCommentReplies(eventRecord, comment, ctx)}
    </article>`;
  },

  _renderEventCommentReplies(eventRecord, comment, ctx) {
    if (!comment.replies?.length) return '';
    const eventId = escapeHTML(eventRecord.id || '');
    const commentId = escapeHTML(comment.id);
    return `<div class="event-comment-replies">${comment.replies.map(r => {
      const del = r.deleted ? '<span class="event-comment-deleted">回覆已刪除</span>' : escapeHTML(r.body);
      const manage = ctx.canManage && !r.deleted ? `<button type="button" class="event-comment-mini-btn danger" onclick="App._deleteEventCommentReply('${eventId}','${commentId}','${escapeHTML(r.id)}')">刪除</button>` : '';
      return `<div class="event-comment-reply">${this._renderEventCommentAvatar(r.authorName, r.authorPhoto)}<div class="event-comment-reply-main"><div class="event-comment-reply-meta"><span>${escapeHTML(r.authorName)}</span><small>${escapeHTML(this._eventCommentTimeLabel(r.createdAt))}</small>${manage}</div><div class="event-comment-reply-body">${del}</div></div></div>`;
    }).join('')}</div>`;
  },

  async _loadEventCommentReplies(eventId, commentId) {
    const card = Array.from(document.querySelectorAll('.event-comment-card'))
      .find(el => el.getAttribute('data-comment-id') === commentId);
    if (!card || card.dataset.repliesLoaded === 'true') return;
    const btn = card.querySelector('.event-comment-load-replies');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '載入回覆中...';
    }
    try {
      const { commentRef, eventRecord } = await this._getEventCommentRefs(eventId, commentId);
      const snap = await commentRef.collection('replies').limit(20).get();
      const replies = snap.docs.map(d => this._mapEventCommentReplyDoc(d))
        .sort((a, b) => this._eventCommentTimeMs(a.createdAt) - this._eventCommentTimeMs(b.createdAt));
      const comment = { id: commentId, replies };
      const html = this._renderEventCommentReplies(eventRecord || ApiService.getEvent?.(eventId) || { id: eventId }, comment, {
        canManage: this._canManageEventComments(eventRecord || ApiService.getEvent?.(eventId)),
      });
      card.querySelector('.event-comment-replies')?.remove();
      if (html) card.insertAdjacentHTML('beforeend', html);
      card.dataset.repliesLoaded = 'true';
      btn?.remove();
    } catch (err) {
      console.error('[event-comments] load replies failed', err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = '查看回覆';
      }
      this.showToast?.('回覆載入失敗，請稍後再試');
    }
  },

  _eventCommentLikeIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3v11Zm3 0h7.1a2 2 0 0 0 2-1.6l1.2-6.4A2 2 0 0 0 18.3 11H14l.8-4.3a3 3 0 0 0-.8-2.7L13 3l-5 8v10a1 1 0 0 0 1 1Z"/></svg>';
  },

  _toggleEventCommentReplyBox(commentId) {
    const form = document.getElementById('event-comment-reply-' + commentId);
    if (!form) return;
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('input')?.focus();
  },
});
