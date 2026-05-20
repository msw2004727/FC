const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('activity detail comments source contracts', () => {
  test('activity detail loads comment modules and renders a comments mount point', () => {
    const loader = readProjectFile('js/core/script-loader.js');
    const detail = readProjectFile('js/modules/event/event-detail.js');

    expect(loader).toContain('js/modules/event/event-comments.js');
    expect(loader).toContain('js/modules/event/event-comments-actions.js');
    expect(loader.indexOf('js/modules/event/event-detail-companion.js'))
      .toBeLessThan(loader.indexOf('js/modules/event/event-comments.js'));
    expect(detail).toContain('id="detail-comments-container"');
    expect(detail).toContain('this._renderEventComments?.(id)');
  });

  test('comments support resolved author identity, private visibility, 300 limit, replies, and optimistic likes', () => {
    const comments = readProjectFile('js/modules/event/event-comments.js');
    const actions = readProjectFile('js/modules/event/event-comments-actions.js');
    const css = readProjectFile('css/activity.css');

    expect(comments).toContain("ApiService.getCurrentIdentity?.('comment')");
    expect(comments).not.toContain('_renderEventCommentIdentityPicker');
    expect(comments).not.toContain('event-comment-identity-picker');
    expect(comments).toContain('IdentityResolver.buildPublicSnapshot');
    expect(comments).toContain('identitySnapshot');
    expect(comments).toContain('event-comment-author-static');
    expect(comments).toContain('_renderEventCommentAuditTrace');
    expect(comments).toContain('ApiService.getAdminUsers');
    expect(comments).toContain('rootAuthorName');
    expect(comments).toContain('ROLES[roleKey]');
    expect(comments).toContain('event-comment-audit-trace');
    expect(comments).toContain('authorPhoto');
    expect(comments).toContain('maxlength="300"');
    expect(comments).toContain('maxlength="100"');
    expect(comments).toContain('私密留言（僅主辦與委託能見）');
    expect(comments).toContain("visibility === 'private'");
    expect(comments).toContain('replyLocked');
    expect(comments).toContain('_mapEventCommentLikeDoc');
    expect(comments).toContain('_renderEventCommentLikeAvatars');
    expect(comments).toContain('comment.likers');
    expect(comments).toContain('data-uid="${safeUid}"');
    expect(comments).toContain('_hydrateEventCommentLikeState');
    expect(comments).toContain('_loadEventCommentRepliesForList');
    expect(comments).toContain('_eventCommentRepliesPerComment: 20');
    expect(comments).toContain('_eventCommentReplyFetchBatchSize: 8');
    expect(comments).not.toContain('event-comment-load-replies');
    expect(comments).not.toContain('查看回覆');
    expect(comments).toContain('recentLikers');
    expect(comments).toContain('_eventCommentLoadTimeoutMs: 9000');
    expect(comments).toContain('_eventCommentRetryDelaysMs: [3000, 15000]');
    expect(comments).toContain('_eventCommentHardStopMs: 45000');
    expect(comments).toContain('_eventCommentCacheTtlMs: 120000');
    expect(comments).toContain('_getEventCommentsCachedState');
    expect(comments).toContain('_clearEventCommentsCacheForEvent');
    expect(comments).toContain('_eventCommentCacheInvalidatedAt');
    expect(comments).toContain('_perfCommentLog');
    expect(comments).toContain('_waitForEventCommentsLoad');
    expect(comments).toContain("err.code = 'event-comments-timeout'");
    expect(comments).toContain('_renderEventCommentsLoadIssue');
    expect(comments).toContain('_scheduleEventCommentAutoRetry');
    expect(comments).toContain('_retryEventComments');
    expect(comments).toContain('Promise.all([');
    expect(comments).not.toContain("cRef.collection('likes').limit(500)");
    expect(comments).not.toContain("cRef.collection('replies').limit(20)");
    expect(actions).toContain('_setEventCommentLikeDoc');
    expect(actions).toContain('identitySnapshot: author.identitySnapshot');
    expect(actions).toContain('_writeEventCommentLikeWithSummary');
    expect(actions).toContain('_syncEventCommentLikeAvatars');
    expect(actions).toContain('_readEventCommentLikeAvatarsFromDom');
    expect(actions).toContain('_isEventCommentPermissionDenied');
    expect(actions).toContain("authorPhoto: String(author.authorPhoto || '').trim().slice(0, 1200)");
    expect(actions).toContain('existing?.exists');
    expect(actions).toContain('_setEventCommentLikeButtonState(btn, nextLiked, nextCount)');
    expect(actions).toContain('_setEventCommentLikeButtonState(btn, wasLiked, oldCount)');
    expect(actions).toContain('_clearEventCommentsCacheForEvent?.(eventId)');
    expect(actions).toContain('this._renderEventComments?.(eventId, { forceRefresh: true })');
    expect(actions).toContain("_requireEventCommentUser(requestedIdentityId = '')");
    expect(actions).toContain('const author = this._requireEventCommentUser();');
    expect(actions).not.toContain('_getEventCommentIdentityChoice');
    expect(actions.indexOf('_setEventCommentLikeButtonState(btn, nextLiked, nextCount)'))
      .toBeLessThan(actions.indexOf('await this._writeEventCommentLikeWithSummary'));
    expect(actions.indexOf('await this._writeEventCommentLikeWithSummary'))
      .toBeLessThan(actions.indexOf('this._syncEventCommentLikeAvatars(card, author, nextLiked, nextCount)'));
    expect(css).toContain('.event-comment-avatar');
    expect(css).toContain('.event-comment-like-avatars');
    expect(css).toContain('.event-comment-like-avatar');
    expect(css).toContain('.event-comments-load-state');
    expect(css).toContain('.event-comment-retry-btn');
    expect(css).not.toContain('.event-comment-identity-picker');
    expect(css).toContain('.event-comment-author-static');
    expect(css).toContain('.event-comment-audit-trace');
    expect(css).toContain('[data-theme="dark"] .event-comment-body');
    expect(css).toContain('[data-theme="dark"] .event-comment-card');
  });

  test('create/edit events persist start and end timestamps for rule-level close checks', () => {
    const create = readProjectFile('js/modules/event/event-create.js');
    const multi = readProjectFile('js/modules/event/event-create-multidate.js');
    const rules = readProjectFile('firestore.rules');

    expect(create).toContain('const startTimestamp = new Date(`${dateVal}T${tStart}`)');
    expect(create).toContain('const endTimestamp = new Date(`${dateVal}T${tEnd}`)');
    expect(create).toContain('date: fullDate, startTimestamp, endTimestamp');
    expect(multi).toContain("const endTimestamp = new Date(dateStr + 'T' + tEnd)");
    expect(rules).toContain("'startTimestamp', 'endTimestamp'");
    expect(rules).toContain('request.time < data.endTimestamp');
  });
});
