/* ================================================
   ToosterX Activity Comments
   Detail-page comments, replies, private visibility, likes
   ================================================ */

Object.assign(App, {
  _eventCommentLikeBusy: new Set(),

  _getEventCommentAuthor() {
    const user = ApiService.getCurrentUser?.() || {};
    const lineProfile = (typeof LineAuth !== 'undefined' && LineAuth.getProfile)
      ? LineAuth.getProfile()
      : null;
    const uid = String(user.uid || user.lineUserId || lineProfile?.userId || '').trim();
    const authorName = String(lineProfile?.displayName || user.displayName || user.name || '用戶').trim();
    const authorPhoto = String(lineProfile?.pictureUrl || user.pictureUrl || user.photoURL || '').trim();
    return { uid, authorName: authorName || '用戶', authorPhoto };
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

  _mapEventCommentDoc(docSnap) {
    const data = docSnap.data() || {};
    return {
      id: docSnap.id,
      eventId: data.eventId || '',
      authorUid: data.authorUid || '',
      authorName: data.authorName || '用戶',
      authorPhoto: data.authorPhoto || '',
      body: data.body || '',
      visibility: data.visibility === 'private' ? 'private' : 'public',
      replyLocked: data.replyLocked === true,
      deleted: data.deleted === true,
      createdAt: data.createdAt || null,
      replies: [],
      likeCount: 0,
      likedByMe: false,
    };
  },

  _mapEventCommentReplyDoc(docSnap) {
    const data = docSnap.data() || {};
    return {
      id: docSnap.id,
      authorUid: data.authorUid || '',
      authorName: data.authorName || '用戶',
      authorPhoto: data.authorPhoto || '',
      body: data.body || '',
      deleted: data.deleted === true,
      createdAt: data.createdAt || null,
    };
  },

  async _loadEventComments(eventRecord) {
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
      snaps.push(await commentsRef.where('visibility', '==', 'public').limit(60).get());
      snaps.push(await commentsRef.where('authorUid', '==', user.uid).limit(30).get());
    }
    const byId = new Map();
    snaps.forEach(snap => snap.docs.forEach(docSnap => byId.set(docSnap.id, this._mapEventCommentDoc(docSnap))));
    const comments = Array.from(byId.values())
      .sort((a, b) => this._eventCommentTimeMs(b.createdAt) - this._eventCommentTimeMs(a.createdAt))
      .slice(0, 80);
    await Promise.all(comments.map(async c => {
      const cRef = commentsRef.doc(c.id);
      const [replySnap, likeSnap] = await Promise.all([
        cRef.collection('replies').limit(20).get().catch(() => ({ docs: [] })),
        cRef.collection('likes').limit(500).get().catch(() => ({ docs: [] })),
      ]);
      c.replies = replySnap.docs.map(d => this._mapEventCommentReplyDoc(d))
        .sort((a, b) => this._eventCommentTimeMs(a.createdAt) - this._eventCommentTimeMs(b.createdAt));
      c.likeCount = likeSnap.docs.length;
      c.likedByMe = likeSnap.docs.some(d => d.id === user.uid || d.data()?.uid === user.uid);
    }));
    return { eventDocId, comments };
  },

  async _renderEventComments(eventId) {
    const container = document.getElementById('detail-comments-container');
    const eventRecord = ApiService.getEvent?.(eventId);
    if (!container || !eventRecord) return;
    const user = ApiService.getCurrentUser?.();
    if (!user?.uid) {
      container.innerHTML = '<div class="detail-section event-comments-section"><div class="detail-section-title">留言</div><div class="event-comments-empty">登入後可查看與留言</div></div>';
      return;
    }
    container.innerHTML = '<div class="detail-section event-comments-section"><div class="detail-section-title">留言</div><div class="reg-loading">留言載入中...</div></div>';
    try {
      const state = await this._loadEventComments(eventRecord);
      if (this.currentPage !== 'page-activity-detail' || this._currentDetailEventId !== eventId) return;
      container.innerHTML = this._renderEventCommentsHtml(eventRecord, state.comments);
    } catch (err) {
      console.error('[event-comments] render failed', err);
      container.innerHTML = '<div class="detail-section event-comments-section"><div class="detail-section-title">留言</div><div class="event-comments-empty">留言載入失敗，請重新整理後再試</div></div>';
    }
  },

  _renderEventCommentsHtml(eventRecord, comments) {
    const closed = this._isEventCommentsClosed(eventRecord);
    const canManage = this._canManageEventComments(eventRecord);
    const eventId = escapeHTML(eventRecord.id || '');
    const inputHtml = closed ? '<div class="event-comments-closed">活動已結束，留言輸入已關閉</div>' : `
      <form class="event-comment-form" onsubmit="App._submitEventComment('${eventId}');return false;">
        <textarea id="event-comment-input" maxlength="300" rows="3" placeholder="輸入留言，最多 300 字"></textarea>
        <div class="event-comment-form-foot">
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
    const replyForm = (!ctx.closed && !comment.replyLocked && !comment.deleted)
      ? `<form class="event-comment-reply-form" id="event-comment-reply-${safeCommentId}" onsubmit="App._submitEventCommentReply('${safeEventId}','${safeCommentId}');return false;" hidden><input maxlength="100" placeholder="回覆留言，最多 100 字"><button type="submit">送出</button></form>`
      : '';
    return `<article class="event-comment-card" data-comment-id="${safeCommentId}">
      <div class="event-comment-head">
        ${this._renderEventCommentAvatar(comment.authorName, comment.authorPhoto)}
        <button type="button" class="event-comment-author" onclick="App.showUserProfile('${escapeHTML(comment.authorName)}',{uid:'${escapeHTML(comment.authorUid)}',allowGuest:true})">${escapeHTML(comment.authorName)}</button>
        <span class="event-comment-time">${escapeHTML(this._eventCommentTimeLabel(comment.createdAt))}</span>
        ${privateBadge}${lockedBadge}
        <span class="event-comment-manage">${manageHtml}</span>
      </div>
      ${bodyHtml}
      <div class="event-comment-actions">
        <button type="button" class="event-comment-action event-comment-like${comment.likedByMe ? ' active' : ''}" onclick="App._toggleEventCommentLike('${safeEventId}','${safeCommentId}')" aria-pressed="${comment.likedByMe ? 'true' : 'false'}">${this._eventCommentLikeIcon()}<span>+${comment.likeCount || 0}</span></button>
        ${replyBtn}
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
