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

  test('comments support LINE author identity, private visibility, 300 limit, replies, and optimistic likes', () => {
    const comments = readProjectFile('js/modules/event/event-comments.js');
    const actions = readProjectFile('js/modules/event/event-comments-actions.js');
    const css = readProjectFile('css/activity.css');

    expect(comments).toContain('lineProfile?.displayName');
    expect(comments).toContain('lineProfile?.pictureUrl');
    expect(comments).toContain('authorPhoto');
    expect(comments).toContain('maxlength="300"');
    expect(comments).toContain('maxlength="100"');
    expect(comments).toContain('私密留言（僅主辦與委託能見）');
    expect(comments).toContain("visibility === 'private'");
    expect(comments).toContain('replyLocked');
    expect(comments).toContain('_mapEventCommentLikeDoc');
    expect(comments).toContain('_renderEventCommentLikeAvatars');
    expect(comments).toContain('comment.likers');
    expect(actions).toContain('_setEventCommentLikeDoc');
    expect(actions).toContain('_isEventCommentPermissionDenied');
    expect(actions).toContain("authorPhoto: String(author.authorPhoto || '').trim().slice(0, 1200)");
    expect(actions).toContain('existing?.exists');
    expect(actions).toContain('_setEventCommentLikeButtonState(btn, nextLiked, nextCount)');
    expect(actions).toContain('_setEventCommentLikeButtonState(btn, wasLiked, oldCount)');
    expect(actions.indexOf('_setEventCommentLikeButtonState(btn, nextLiked, nextCount)'))
      .toBeLessThan(actions.indexOf('await this._setEventCommentLikeDoc'));
    expect(css).toContain('.event-comment-avatar');
    expect(css).toContain('.event-comment-like-avatars');
    expect(css).toContain('.event-comment-like-avatar');
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
