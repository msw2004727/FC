/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function loadEventCommentsModule({ eventRecord, currentUser } = {}) {
  const app = {
    currentPage: 'page-activity-detail',
    _currentDetailEventId: eventRecord?.id || 'event-1',
    _logEventCommentPerf: jest.fn(),
  };
  const context = {
    App: app,
    ApiService: {
      getEvent: jest.fn(() => eventRecord || { id: 'event-1', _docId: 'doc-1' }),
      getCurrentUser: jest.fn(() => currentUser || { uid: 'user-1', displayName: 'User' }),
    },
    IdentityResolver: {
      getMainIdentity: jest.fn(user => user || {}),
      buildPublicSnapshot: jest.fn(() => ({ displayName: 'User' })),
    },
    ROLE_LEVEL_MAP: { admin: 100, user: 0 },
    ROLES: {},
    document,
    window,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Promise,
    Object,
    escapeHTML: (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
  };
  vm.runInNewContext(readProjectFile('js/modules/event/event-comments.js'), context, {
    filename: 'js/modules/event/event-comments.js',
  });
  app._renderEventCommentsHtml = jest.fn(() => '<div class="loaded-comments">Loaded comments</div>');
  app._hydrateEventCommentLikeState = jest.fn();
  return { app, context };
}

describe('activity detail comments source contracts', () => {
  test('activity detail loads comment modules and renders a comments mount point', () => {
    const loader = readProjectFile('js/core/script-loader.js');
    const detail = readProjectFile('js/modules/event/event-detail.js');
    const comments = readProjectFile('js/modules/event/event-comments.js');

    expect(loader).toContain('js/modules/event/event-comments.js');
    expect(loader).toContain('js/modules/event/event-comments-actions.js');
    expect(loader.indexOf('js/modules/event/event-detail-companion.js'))
      .toBeLessThan(loader.indexOf('js/modules/event/event-comments.js'));
    expect(loader).toContain('activityComments: [');
    expect(detail).toContain('id="detail-comments-container"');
    expect(detail).toContain('this._renderDetailComments(id');
    expect(detail).toContain("ScriptLoader.ensureGroup('activityComments')");
    expect(detail).toContain("_shouldUseActivityDetailOptimization('commentsNonBlocking')");
    expect(detail).toContain('_renderDetailCommentsLoadFailure');
    expect(detail).toContain('detailRequestSeq: requestSeq');
    expect(detail).toContain('detailRenderToken: renderToken');
    expect(detail).toContain('const requestSeq = ++this._eventDetailRequestSeq;');
    expect(comments).toContain('const requestSeq = ++this._eventCommentLoadSeq;');
  });

  test('late comments load does not patch DOM after user leaves activity detail', async () => {
    document.body.innerHTML = '<div id="detail-comments-container" data-detail-event-id="event-1" data-detail-request-seq="7" data-detail-render-token="rt-7">initial</div>';
    const { app } = loadEventCommentsModule({
      eventRecord: { id: 'event-1', _docId: 'doc-1' },
      currentUser: { uid: 'user-1', displayName: 'User' },
    });
    let resolveLoad;
    const loadPromise = new Promise(resolve => { resolveLoad = resolve; });
    app._loadEventComments = jest.fn(() => loadPromise);

    const renderPromise = app._renderEventComments('event-1', {
      detailRequestSeq: 7,
      detailRenderToken: 'rt-7',
    });
    await Promise.resolve();
    expect(document.getElementById('detail-comments-container').textContent).toContain('留言載入中');

    app.currentPage = 'page-home';
    resolveLoad({ eventDocId: 'doc-1', comments: [{ id: 'comment-1', body: 'late' }] });
    await renderPromise;

    expect(app._renderEventCommentsHtml).not.toHaveBeenCalled();
    expect(document.getElementById('detail-comments-container').innerHTML).toContain('留言載入中');
  });

  test('secondary identity avatars show official crown while main identity does not', () => {
    const { app } = loadEventCommentsModule({
      eventRecord: { id: 'event-1', _docId: 'doc-1' },
      currentUser: { uid: 'user-1', displayName: 'User' },
    });
    const secondarySnapshot = { identityId: 'secondary', displayName: 'Alias', avatarUrl: '' };
    const mainAvatar = app._renderEventCommentAvatar('Main', '', { identityId: 'main', displayName: 'Main', avatarUrl: '' });
    const secondaryAvatar = app._renderEventCommentAvatar('Alias', '', secondarySnapshot);

    expect(mainAvatar).not.toContain('identity-crown');
    expect(secondaryAvatar).toContain('event-comment-avatar-wrap is-official-identity');
    expect(secondaryAvatar).toContain('identity-crown-shine');
    expect(secondaryAvatar).toContain('identity-crown-body');
    expect(secondaryAvatar).toContain('viewBox="0 0 24 24"');

    const cardHtml = app._renderEventCommentCard({ id: 'event-1' }, {
      id: 'comment-1',
      authorUid: 'uid-official',
      authorName: 'Alias',
      authorPhoto: '',
      identitySnapshot: secondarySnapshot,
      body: 'official note',
      visibility: 'public',
      replyLocked: false,
      deleted: false,
      createdAt: null,
      replies: [{
        id: 'reply-1',
        authorName: 'Alias',
        authorPhoto: '',
        identitySnapshot: secondarySnapshot,
        body: 'official reply',
        deleted: false,
        createdAt: null,
        likeCount: 0,
        likers: [],
      }],
      likeCount: 0,
      likedByMe: false,
      likers: [],
    }, { closed: false, canManage: false });

    expect((cardHtml.match(/class="identity-crown"/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(cardHtml).toContain('event-comment-author-static');
    expect(cardHtml).not.toContain("showUserProfile('Alias'");
    expect(cardHtml).toContain('ToosterX官方認證');
    expect((cardHtml.match(/event-comment-official-badge/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(cardHtml).toContain('event-comment-reply-badge-line');
  });

  test('comments support resolved author identity, private visibility, 300 limit, replies, and optimistic likes', () => {
    const comments = readProjectFile('js/modules/event/event-comments.js');
    const actions = readProjectFile('js/modules/event/event-comments-actions.js');
    const timeline = readProjectFile('js/modules/event/event-list-timeline.js');
    const css = readProjectFile('css/activity.css');

    expect(comments).toContain("ApiService.getCurrentIdentity?.('comment')");
    expect(comments).not.toContain('_renderEventCommentIdentityPicker');
    expect(comments).not.toContain('event-comment-identity-picker');
    expect(comments).toContain('IdentityResolver.buildPublicSnapshot');
    expect(comments).toContain('identitySnapshot');
    expect(comments).toContain('_renderEventCommentOfficialCrown');
    expect(comments).toContain("identitySnapshot?.identityId !== 'secondary'");
    expect(comments).toContain('is-official-identity');
    expect(comments).toContain('event-comment-author-static');
    expect(comments).toContain('_renderEventCommentAuditTrace');
    expect(comments).toContain('rootAuthorName');
    expect(comments).toContain('event-comment-audit-trace');
    expect(comments).toContain('event-comment-official-badge');
    expect(comments).toContain('ToosterX官方認證');
    expect(comments).toContain('event-comment-reply-badge-line');
    expect(comments).not.toContain('event-comment-audit-uid');
    expect(comments).toContain('authorPhoto');
    expect(comments).toContain('maxlength="300"');
    expect(comments).toContain('maxlength="100"');
    expect(comments).toContain('私密留言（僅主辦與委託能見）');
    expect(comments).toContain("visibility === 'private'");
    expect(comments).toContain('replyLocked');
    expect(comments).toContain('_mapEventCommentLikeDoc');
    expect(comments).toContain('_renderEventCommentLikeAvatars');
    expect(comments).toContain('comment.likers');
    expect(comments).toContain('reply.likers');
    expect(comments).toContain('data-uid="${safeUid}"');
    expect(comments).toContain('data-reply-id="${safeReplyId}"');
    expect(comments).toContain('event-comment-reply-like');
    expect(comments).toContain('_patchEventCommentReplyLikeUi');
    expect(comments).toContain("collection('replies').doc(reply.id).collection('likes')");
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
    expect(comments).toContain('_bindEventCommentInputAutosize?.(container)');
    expect(comments).toContain('_resizeEventCommentInput');
    expect(comments).toContain('rows="1"');
    expect(comments).toContain('Promise.all([');
    expect(comments).not.toContain("cRef.collection('likes').limit(500)");
    expect(comments).not.toContain("cRef.collection('replies').limit(20)");
    expect(actions).toContain('_setEventCommentLikeDoc');
    expect(actions).toContain('identitySnapshot: author.identitySnapshot');
    expect(actions).toContain('_writeEventCommentLikeWithSummary');
    expect(actions).toContain('_syncEventCommentLikeAvatars');
    expect(actions).toContain('_readEventCommentLikeAvatarsFromDom');
    expect(actions).toContain('_toggleEventCommentReplyLike');
    expect(actions).toContain("replyRef.collection('likes').doc(author.uid)");
    expect(actions).toContain('if (safeReplyId) likePayload.replyId = safeReplyId');
    expect(actions).toContain('if (safeReplyId) base.replyId = safeReplyId');
    expect(actions).toContain('_isEventCommentPermissionDenied');
    expect(actions).toContain('_normalizePublicIdentitySnapshot?.(author?.identitySnapshot)');
    expect(actions).toContain('identitySnapshot?.avatarUrl || author?.authorPhoto');
    expect(actions).toContain('authorName: summaryLiker.authorName');
    expect(actions).toContain('authorPhoto: summaryLiker.authorPhoto');
    expect(actions).toContain('existing?.exists');
    expect(actions).toContain('_setEventCommentLikeButtonState(btn, nextLiked, nextCount)');
    expect(actions).toContain('_setEventCommentLikeButtonState(btn, wasLiked, oldCount)');
    expect(actions).toContain('_clearEventCommentsCacheForEvent?.(eventId)');
    expect(actions).toContain('_clearActivityCommentBadgeCacheForEvent?.(eventId)');
    expect(actions).toContain('this._renderEventComments?.(eventId, { forceRefresh: true })');
    expect(actions).toContain('_resizeEventCommentInput?.(input)');
    expect(actions).toContain("_requireEventCommentUser(requestedIdentityId = '')");
    expect(actions).toContain('const author = this._requireEventCommentUser();');
    expect(actions).not.toContain('_getEventCommentIdentityChoice');
    expect(actions.indexOf('_setEventCommentLikeButtonState(btn, nextLiked, nextCount)'))
      .toBeLessThan(actions.indexOf('await this._writeEventCommentLikeWithSummary'));
    expect(actions.indexOf('await this._writeEventCommentLikeWithSummary'))
      .toBeLessThan(actions.indexOf('this._syncEventCommentLikeAvatars(card, author, nextLiked, nextCount)'));
    expect(timeline).toContain('_scheduleActivityCommentBadges(events)');
    expect(timeline).toContain('tl-event-status-stack');
    expect(timeline).toContain('requestIdleCallback(run, { timeout: 1800 })');
    expect(timeline).toContain('new IntersectionObserver');
    expect(timeline).toContain('_activityCommentBadgeMaxConcurrent: 2');
    expect(timeline).toContain("_activityActiveTab !== 'normal'");
    expect(timeline).toContain("commentsRef.where('visibility', '==', 'public').limit(Math.min(limit, 60)).get()");
    expect(timeline).toContain("commentsRef.where('authorUid', '==', uid).limit(Math.min(limit, 30)).get()");
    expect(timeline).toContain('replyCount');
    expect(timeline).not.toContain("collection('likes').limit");
    expect(timeline).not.toContain("collection('replies').limit");
    const baseCss = readProjectFile('css/base.css');
    expect(css).toContain('min-height:2.25rem;height:2.25rem');
    expect(css).toContain('resize:none');
    expect(css).toContain('overflow-y:hidden');
    expect(css).toContain('.event-comment-avatar');
    expect(css).toContain('.event-comment-avatar-wrap');
    expect(css).toContain('.event-comment-avatar-wrap .identity-crown');
    expect(css).toContain('--identity-crown-size:18px');
    expect(css).toContain('--identity-crown-size:16px');
    expect(baseCss).toContain('@keyframes identity-crown-shine');
    expect(baseCss).toContain('identity-crown-shine 2.4s');
    expect(baseCss).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('.event-comment-like-avatars');
    expect(css).toContain('.event-comment-like-avatar');
    expect(css).toContain('.event-comment-reply-actions');
    expect(css).toContain('.event-comment-reply-like');
    expect(css).toContain('.event-comments-load-state');
    expect(css).toContain('.event-comment-retry-btn');
    expect(css).not.toContain('.event-comment-identity-picker');
    expect(css).toContain('.event-comment-author-static');
    expect(css).toContain('.event-comment-audit-trace');
    expect(css).toContain('.event-comment-official-check');
    expect(css).toContain('.event-comment-reply-badge-line');
    expect(css).toContain('[data-theme="dark"] .event-comment-body');
    expect(css).toContain('[data-theme="dark"] .event-comment-card');
    expect(css).toContain('.tl-event-status-stack');
    expect(css).toContain('.tl-comment-badge');
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
