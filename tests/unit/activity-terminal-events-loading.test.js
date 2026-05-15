const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('activity terminal events loading strategy', () => {
  test('front activity page removes ended tab but keeps fallback normalization', () => {
    const activityHtml = readProjectFile('pages/activity.html');
    const activityListSource = readProjectFile('js/modules/event/event-list.js');
    const timelineSource = readProjectFile('js/modules/event/event-list-timeline.js');

    expect(activityHtml).not.toContain('data-atab="ended"');
    expect(activityListSource).toContain("_hiddenActivityTabs: ['ended']");
    expect(activityListSource).toContain("_normalizeActivityTab(tab)");
    expect(timelineSource).toContain("this._normalizeActivityTab(this._activityActiveTab)");
  });

  test('FirebaseService keeps a small terminal preview for front page and lazy-loads history for management', () => {
    const firebaseSource = readProjectFile('js/firebase-service.js');
    const manageSource = readProjectFile('js/modules/event/event-manage.js');

    expect(firebaseSource).toContain('_terminalPreviewLimit: 50');
    expect(firebaseSource).toContain('_terminalHistoryLimit: 10');
    expect(firebaseSource).toContain('async _loadEventsStatic(options = {})');
    expect(firebaseSource).toContain("const requestedTerminalMode = options.terminalMode || 'preview'");
    expect(firebaseSource).toContain('this._fetchTerminalEventsSnapshot(terminalLimit)');
    expect(firebaseSource).toContain('async ensureTerminalEventsLoaded(options = {})');
    expect(firebaseSource).toContain("pageId === 'page-my-activities' ? 'history' : 'preview'");
    expect(firebaseSource).toContain('this._startEventsRealtimeListener({ terminalMode })');

    expect(manageSource).toContain('_ensureManageHistoryEventsLoaded(filter)');
    expect(manageSource).toContain('_myActivityPageSize: 10');
    expect(manageSource).toContain('const visibleEvents = filtered.slice(0, visibleLimit);');
    expect(manageSource).toContain('onclick="App._loadMoreMyActivities()">查看更多</button>');
    expect(manageSource).toContain("if (!['all', 'ended', 'cancelled'].includes(f)) return");
    expect(manageSource).toContain("FirebaseService.ensureTerminalEventsLoaded({ mode: 'history' })");
  });
});
