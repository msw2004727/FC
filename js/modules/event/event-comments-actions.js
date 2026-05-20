/* ================================================
   ToosterX Activity Comment Actions
   Firestore writes for comments, replies, likes, locks, deletes
   ================================================ */

Object.assign(App, {
  _eventCommentWriteBusy: false,

  _eventCommentServerTimestamp() {
    return firebase.firestore.FieldValue.serverTimestamp();
  },

  async _getEventCommentRefs(eventId, commentId, replyId) {
    const eventRecord = ApiService.getEvent?.(eventId);
    const eventDocId = await this._resolveEventCommentsDocId(eventRecord || eventId);
    if (!eventDocId) throw new Error('event_doc_missing');
    const eventRef = db.collection('events').doc(eventDocId);
    const commentsRef = eventRef.collection('comments');
    const commentRef = commentId ? commentsRef.doc(commentId) : null;
    const replyRef = commentRef && replyId ? commentRef.collection('replies').doc(replyId) : null;
    return { eventRecord, eventDocId, eventRef, commentsRef, commentRef, replyRef };
  },

  _requireEventCommentUser(requestedIdentityId = '') {
    const author = this._getEventCommentAuthor?.(requestedIdentityId);
    if (!author?.uid) {
      this.showToast?.('請先登入');
      return null;
    }
    return author;
  },

  async _submitEventComment(eventId) {
    if (this._eventCommentWriteBusy) {
      this.showToast?.('系統已在處理中');
      return;
    }
    const author = this._requireEventCommentUser();
    if (!author) return;
    const eventRecord = ApiService.getEvent?.(eventId);
    if (this._isEventCommentsClosed(eventRecord)) {
      this.showToast?.('活動已結束，無法新增留言');
      return;
    }
    const input = document.getElementById('event-comment-input');
    const privateInput = document.getElementById('event-comment-private');
    const body = String(input?.value || '').trim();
    if (!body) { this.showToast?.('請輸入留言'); return; }
    if (body.length > 300) { this.showToast?.('留言最多 300 字'); return; }
    const btn = document.querySelector('.event-comment-submit');
    this._eventCommentWriteBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = '送出中'; }
    try {
      const { commentsRef, eventRecord: currentEvent } = await this._getEventCommentRefs(eventId);
      const commentPayload = {
        eventId: currentEvent?.id || eventId,
        authorUid: author.uid,
        authorName: author.authorName,
        authorPhoto: author.authorPhoto || '',
        identitySnapshot: author.identitySnapshot,
        body,
        visibility: privateInput?.checked ? 'private' : 'public',
        replyLocked: false,
        deleted: false,
        replyCount: 0,
        likeCount: 0,
        recentLikers: [],
        createdAt: this._eventCommentServerTimestamp(),
        updatedAt: this._eventCommentServerTimestamp(),
      };
      try {
        await commentsRef.add(commentPayload);
      } catch (err) {
        if (!this._isEventCommentPermissionDenied(err)) throw err;
        const { replyCount, likeCount, recentLikers, ...legacyPayload } = commentPayload;
        await commentsRef.add(legacyPayload);
      }
      if (input) input.value = '';
      if (privateInput) privateInput.checked = false;
      this.showToast?.('留言已送出');
      this._clearEventCommentsCacheForEvent?.(eventId);
      await this._renderEventComments?.(eventId, { forceRefresh: true });
    } catch (err) {
      console.error('[event-comments] submit failed', err);
      this.showToast?.('留言送出失敗，請稍後再試');
    } finally {
      this._eventCommentWriteBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = '送出'; }
    }
  },

  async _submitEventCommentReply(eventId, commentId) {
    if (this._eventCommentWriteBusy) {
      this.showToast?.('系統已在處理中');
      return;
    }
    const author = this._requireEventCommentUser();
    if (!author) return;
    const eventRecord = ApiService.getEvent?.(eventId);
    if (this._isEventCommentsClosed(eventRecord)) {
      this.showToast?.('活動已結束，無法新增回覆');
      return;
    }
    const form = document.getElementById('event-comment-reply-' + commentId);
    const input = form?.querySelector('input');
    const body = String(input?.value || '').trim();
    if (!body) { this.showToast?.('請輸入回覆'); return; }
    if (body.length > 100) { this.showToast?.('回覆最多 100 字'); return; }
    const btn = form?.querySelector('button');
    this._eventCommentWriteBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = '送出中'; }
    try {
      const { commentRef, eventRecord: currentEvent } = await this._getEventCommentRefs(eventId, commentId);
      await commentRef.collection('replies').add({
        eventId: currentEvent?.id || eventId,
        commentId,
        authorUid: author.uid,
        authorName: author.authorName,
        authorPhoto: author.authorPhoto || '',
        identitySnapshot: author.identitySnapshot,
        body,
        deleted: false,
        createdAt: this._eventCommentServerTimestamp(),
        updatedAt: this._eventCommentServerTimestamp(),
      });
      if (input) input.value = '';
      if (form) form.hidden = true;
      this.showToast?.('回覆已送出');
      this._clearEventCommentsCacheForEvent?.(eventId);
      await this._renderEventComments?.(eventId, { forceRefresh: true });
    } catch (err) {
      console.error('[event-comments] reply failed', err);
      this.showToast?.('回覆送出失敗，請稍後再試');
    } finally {
      this._eventCommentWriteBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = '送出'; }
    }
  },

  _setEventCommentLikeButtonState(btn, liked, count) {
    if (!btn) return;
    btn.classList.toggle('active', liked);
    btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
    const span = btn.querySelector('span');
    if (span) span.textContent = '+' + Math.max(0, count);
  },

  _buildEventCommentLikerSummary(author) {
    const identitySnapshot = this._normalizePublicIdentitySnapshot?.(author?.identitySnapshot) || null;
    const fallbackName = '\u7528\u6236';
    const displayName = identitySnapshot?.displayName || author?.authorName || fallbackName;
    const displayPhoto = identitySnapshot?.avatarUrl || author?.authorPhoto || '';
    return {
      uid: String(author?.uid || '').trim(),
      authorName: String(displayName).trim().slice(0, 80) || fallbackName,
      authorPhoto: String(displayPhoto).trim().slice(0, 1200),
    };
  },

  _normalizeEventCommentLikeCount(value, fallback = 0) {
    const count = Number(value);
    if (!Number.isFinite(count)) return Math.max(0, Math.floor(Number(fallback) || 0));
    return Math.max(0, Math.floor(count));
  },

  async _writeEventCommentLikeWithSummary(commentRef, likeRef, eventId, commentId, author, liked) {
    const serverTimestamp = this._eventCommentServerTimestamp();
    const summaryLiker = this._buildEventCommentLikerSummary(author);
    await db.runTransaction(async tx => {
      const commentSnap = await tx.get(commentRef);
      if (!commentSnap.exists) throw new Error('comment_missing');
      const likeSnap = await tx.get(likeRef);
      const commentData = commentSnap.data() || {};
      const currentLikers = this._normalizeEventCommentLikers?.(commentData.recentLikers) || [];
      const currentCount = this._normalizeEventCommentLikeCount(commentData.likeCount, currentLikers.length);
      let nextLikers = currentLikers.filter(liker => liker.uid !== author.uid);
      let nextCount = currentCount;

      if (liked) {
        if (!likeSnap.exists) {
          tx.set(likeRef, {
            eventId,
            commentId,
            uid: author.uid,
            authorName: summaryLiker.authorName,
            authorPhoto: summaryLiker.authorPhoto,
            createdAt: serverTimestamp,
          });
          nextCount += 1;
        } else if (nextCount === 0) {
          nextCount = 1;
        }
        nextLikers.unshift(summaryLiker);
      } else if (likeSnap.exists) {
        tx.delete(likeRef);
        nextCount = Math.max(0, nextCount - 1);
      } else {
        return;
      }

      tx.update(commentRef, {
        likeCount: nextCount,
        recentLikers: nextLikers.slice(0, 32),
        updatedAt: serverTimestamp,
      });
    });
  },

  _readEventCommentLikeAvatarsFromDom(stack) {
    return Array.from(stack?.querySelectorAll('.event-comment-like-avatar') || [])
      .map(el => ({
        uid: String(el.dataset.uid || '').trim(),
        authorName: String(el.getAttribute('title') || el.getAttribute('alt') || el.textContent || '用戶').trim(),
        authorPhoto: String(el.dataset.authorPhoto || (el.tagName === 'IMG' ? el.getAttribute('src') : '') || '').trim(),
      }))
      .filter(liker => liker.uid);
  },

  _syncEventCommentLikeAvatars(card, author, liked, count) {
    if (!card || typeof this._renderEventCommentLikeAvatars !== 'function') return;
    const btn = card.querySelector('.event-comment-like');
    if (!btn) return;
    const uid = String(author?.uid || '').trim();
    const stack = card.querySelector('.event-comment-like-avatars');
    let likers = this._readEventCommentLikeAvatarsFromDom(stack)
      .filter(liker => liker.uid !== uid);
    if (liked && uid) {
      const summaryLiker = this._buildEventCommentLikerSummary(author);
      likers.unshift({ ...summaryLiker, uid });
    }
    likers = likers.slice(0, 32);
    const safeCount = Math.max(0, Number(count) || 0);
    const html = this._renderEventCommentLikeAvatars({ likers, likeCount: safeCount });
    if (stack) {
      if (html) stack.outerHTML = html;
      else stack.remove();
    } else if (html) {
      btn.insertAdjacentHTML('afterend', html);
    }
  },

  _isEventCommentPermissionDenied(err) {
    const code = String(err?.code || '').toLowerCase();
    const msg = String(err?.message || '').toLowerCase();
    return code === 'permission-denied' || msg.includes('permission') || msg.includes('insufficient');
  },

  async _setEventCommentLikeDoc(likeRef, eventId, commentId, author) {
    const summaryLiker = this._buildEventCommentLikerSummary(author);
    const base = {
      eventId,
      commentId,
      uid: author.uid,
    };
    const snapshotPayload = {
      ...base,
      authorName: summaryLiker.authorName,
      authorPhoto: summaryLiker.authorPhoto,
      createdAt: this._eventCommentServerTimestamp(),
    };
    try {
      await likeRef.set(snapshotPayload);
    } catch (err) {
      if (!this._isEventCommentPermissionDenied(err)) throw err;
      await likeRef.set({
        ...base,
        createdAt: this._eventCommentServerTimestamp(),
      });
    }
  },

  async _toggleEventCommentLike(eventId, commentId) {
    const author = this._requireEventCommentUser();
    if (!author) return;
    const key = eventId + ':' + commentId;
    if (this._eventCommentLikeBusy.has(key)) return;
    const card = Array.from(document.querySelectorAll('.event-comment-card'))
      .find(el => el.getAttribute('data-comment-id') === commentId);
    const btn = card?.querySelector('.event-comment-like') || null;
    const wasLiked = btn?.classList.contains('active') || false;
    const countText = btn?.querySelector('span')?.textContent || '+0';
    const oldCount = parseInt(countText.replace(/[^\d]/g, ''), 10) || 0;
    const nextLiked = !wasLiked;
    const nextCount = oldCount + (nextLiked ? 1 : -1);
    this._setEventCommentLikeButtonState(btn, nextLiked, nextCount);
    this._eventCommentLikeBusy.add(key);
    let likeRef = null;
    try {
      const { commentRef, eventRecord } = await this._getEventCommentRefs(eventId, commentId);
      likeRef = commentRef.collection('likes').doc(author.uid);
      try {
        await this._writeEventCommentLikeWithSummary(commentRef, likeRef, eventRecord?.id || eventId, commentId, author, nextLiked);
      } catch (err) {
        if (!this._isEventCommentPermissionDenied(err)) throw err;
        if (nextLiked) {
          await this._setEventCommentLikeDoc(likeRef, eventRecord?.id || eventId, commentId, author);
        } else {
          await likeRef.delete();
        }
      }
      this._syncEventCommentLikeAvatars(card, author, nextLiked, nextCount);
      this._clearEventCommentsCacheForEvent?.(eventId);
    } catch (err) {
      if (nextLiked && likeRef && this._isEventCommentPermissionDenied(err)) {
        const existing = await likeRef.get().catch(() => null);
        if (existing?.exists) {
          this._syncEventCommentLikeAvatars(card, author, true, nextCount);
          return;
        }
      }
      console.error('[event-comments] like failed', err);
      this._setEventCommentLikeButtonState(btn, wasLiked, oldCount);
      this.showToast?.('按讚更新失敗，請稍後再試');
    } finally {
      this._eventCommentLikeBusy.delete(key);
    }
  },

  async _setEventCommentReplyLocked(eventId, commentId, locked) {
    const eventRecord = ApiService.getEvent?.(eventId);
    if (!this._canManageEventComments(eventRecord)) { this.showToast?.('權限不足'); return; }
    try {
      const { commentRef } = await this._getEventCommentRefs(eventId, commentId);
      await commentRef.update({ replyLocked: !!locked, updatedAt: this._eventCommentServerTimestamp() });
      this.showToast?.(locked ? '已鎖定回覆' : '已解除鎖定');
      this._clearEventCommentsCacheForEvent?.(eventId);
      await this._renderEventComments?.(eventId, { forceRefresh: true });
    } catch (err) {
      console.error('[event-comments] lock failed', err);
      this.showToast?.('更新失敗，請稍後再試');
    }
  },

  async _deleteEventComment(eventId, commentId) {
    const eventRecord = ApiService.getEvent?.(eventId);
    if (!this._canManageEventComments(eventRecord)) { this.showToast?.('權限不足'); return; }
    if (!confirm('確定刪除此留言？')) return;
    try {
      const { commentRef } = await this._getEventCommentRefs(eventId, commentId);
      await commentRef.update({
        deleted: true,
        deletedByUid: ApiService.getCurrentUser?.()?.uid || '',
        deletedAt: this._eventCommentServerTimestamp(),
        updatedAt: this._eventCommentServerTimestamp(),
      });
      this.showToast?.('留言已刪除');
      this._clearEventCommentsCacheForEvent?.(eventId);
      await this._renderEventComments?.(eventId, { forceRefresh: true });
    } catch (err) {
      console.error('[event-comments] delete failed', err);
      this.showToast?.('刪除失敗，請稍後再試');
    }
  },

  async _deleteEventCommentReply(eventId, commentId, replyId) {
    const eventRecord = ApiService.getEvent?.(eventId);
    if (!this._canManageEventComments(eventRecord)) { this.showToast?.('權限不足'); return; }
    if (!confirm('確定刪除此回覆？')) return;
    try {
      const { replyRef } = await this._getEventCommentRefs(eventId, commentId, replyId);
      await replyRef.update({
        deleted: true,
        deletedByUid: ApiService.getCurrentUser?.()?.uid || '',
        deletedAt: this._eventCommentServerTimestamp(),
        updatedAt: this._eventCommentServerTimestamp(),
      });
      this.showToast?.('回覆已刪除');
      this._clearEventCommentsCacheForEvent?.(eventId);
      await this._renderEventComments?.(eventId, { forceRefresh: true });
    } catch (err) {
      console.error('[event-comments] delete reply failed', err);
      this.showToast?.('刪除失敗，請稍後再試');
    }
  },
});
