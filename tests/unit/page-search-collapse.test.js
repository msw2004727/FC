const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('public list search collapse UI', () => {
  test('activity page uses a magnifier toggle and collapsed filter panel', () => {
    const activityHtml = readProjectFile('pages/activity.html');
    const layoutCss = readProjectFile('css/layout.css');
    const themeSource = readProjectFile('js/core/theme.js');
    const timelineSource = readProjectFile('js/modules/event/event-list-timeline.js');
    const calendarSource = readProjectFile('js/modules/event/event-list-calendar-build.js');

    expect(activityHtml).toContain('id="filter-toggle"');
    expect(activityHtml).toContain('class="page-search-toggle-btn activity-filter-toggle-btn"');
    expect(activityHtml).toContain('id="filter-bar" hidden');
    expect(activityHtml).toContain('id="activity-filter-keyword"');
    expect(activityHtml).not.toContain('id="activity-filter-search-btn"');
    expect(layoutCss).toContain('.page-search-toggle-btn');
    expect(layoutCss).toContain('.collapsible-search-panel[hidden]');
    expect(themeSource).toContain("keywordInput?.addEventListener('input', _rerenderBoth)");
    expect(timelineSource).toContain('_matchesActivityKeyword(e, keyword)');
    expect(timelineSource).toContain('this._matchesActivityKeyword(e, filterKw)');
    expect(calendarSource).toContain('this._matchesActivityKeyword(e, filterKw)');
  });

  test('tournament page uses a magnifier toggle and collapsed filter panel', () => {
    const tournamentHtml = readProjectFile('pages/tournament.html');
    const tournamentSource = readProjectFile('js/modules/tournament/tournament-render.js');

    expect(tournamentHtml).toContain('id="tc-filter-toggle-btn"');
    expect(tournamentHtml).toContain('onclick="App.toggleTournamentCenterFilterPanel()"');
    expect(tournamentHtml).toContain('id="tc-filter-panel" hidden');
    expect(tournamentHtml).toContain('id="tc-search"');
    expect(tournamentHtml).toContain('id="tc-region-filter"');
    expect(tournamentSource).toContain('toggleTournamentCenterFilterPanel(force)');
    expect(tournamentSource).toContain('_syncTournamentCenterFilterPanelState');
    expect(tournamentSource).toContain('this._syncTournamentCenterFilterPanelState?.();');
  });
});
