const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

describe('tournament loading performance contract', () => {
  test('public tournament list uses the list-only script group', () => {
    const source = readProjectFile('js/core/script-loader.js');
    const listGroup = source.match(/tournamentList:\s*\[([\s\S]*?)\],/);
    const detailGroup = source.match(/tournamentDetail:\s*\[([\s\S]*?)\],/);

    expect(source).toContain("'page-tournaments':        ['tournamentList']");
    expect(source).toContain("'page-tournament-detail':  ['tournamentDetail']");
    expect(listGroup).not.toBeNull();
    expect(detailGroup).not.toBeNull();
    expect(listGroup[1]).toContain('tournament-render.js');
    expect(listGroup[1]).not.toContain('tournament-detail.js');
    expect(listGroup[1]).not.toContain('tournament-friendly-roster.js');
    expect(detailGroup[1]).toContain('tournament-detail.js');
  });

  test('boot HTML includes tournament so stale-first can activate immediately', () => {
    const source = readProjectFile('js/core/page-loader.js');
    const normalized = source.replace(/\r\n/g, '\n');
    expect(normalized).toContain("_bootPages: ['home', 'activity', 'team', 'message', 'profile', 'tournament']");
    expect(normalized).toContain("_deferredPages: [\n    'scan', 'shop',");
  });

  test('public tournament list waits only for tournament realtime data', () => {
    const source = readProjectFile('js/firebase-service.js');
    expect(source).toContain("'page-tournaments':       ['tournaments']");
    expect(source).toContain("'page-tournament-detail': ['tournaments', 'standings', 'matches']");
  });

  test('create tournament lazily loads host teams without slowing the list page', () => {
    const manageSource = readProjectFile('js/modules/tournament/tournament-manage.js');
    const hostSource = readProjectFile('js/modules/tournament/tournament-manage-host.js');
    const coreSource = readProjectFile('js/modules/tournament/tournament-core.js');
    const loaderSource = readProjectFile('js/core/script-loader.js');

    expect(hostSource).toContain('_ensureTournamentHostTeamsLoaded');
    expect(hostSource).toContain("ensureStaticCollectionsLoaded(['teams'])");
    expect(manageSource).toContain('await this._ensureTournamentHostTeamsLoaded?.()');
    expect(coreSource).toContain("button.textContent = '載入中...'");
    expect(hostSource).toContain('this._isTournamentGlobalAdmin?.(currentUser)');
    expect(loaderSource).toContain('js/modules/tournament/tournament-manage-people.js');
  });

  test('tournament realtime render is deferred and realtime starts immediately on activation', () => {
    const firebaseSource = readProjectFile('js/firebase-service.js');
    const navigationSource = readProjectFile('js/core/navigation.js');

    expect(firebaseSource).toContain("setTimeout(() => {");
    expect(firebaseSource).toContain("App.currentPage === 'page-tournaments'");
    expect(firebaseSource).toContain('App.renderTournamentTimeline?.();');
    expect(navigationSource).toContain("_canActivateBeforeCloud(pageId)");
    expect(navigationSource).toContain("return pageId === 'page-tournaments'");
    expect(navigationSource).toContain("pageId === 'page-tournaments' ? { delayMs: 0 } : undefined");
  });

  test('core page preload is network hints only', () => {
    const source = readProjectFile('js/core/script-loader.js');
    const body = source.match(/preloadCorePages\(\) \{([\s\S]*?)\n  \},/);

    expect(body).not.toBeNull();
    expect(body[1]).toContain('network hints only');
    expect(body[1]).not.toContain('await this.ensureForPage(pageId)');
  });
});

describe('team loading performance contract', () => {
  test('public club list activates shell before cloud like other public list pages', () => {
    const source = readProjectFile('js/core/navigation.js');

    expect(source).toContain("pageId === 'page-tournaments'");
    expect(source).toContain("|| pageId === 'page-activities'");
    expect(source).toContain("|| pageId === 'page-teams'");
  });

  test('public club list uses lean list-only script group', () => {
    const source = readProjectFile('js/core/script-loader.js');
    const listGroup = source.match(/teamList:\s*\[([\s\S]*?)\],\s*teamDetail:/);
    const detailGroup = source.match(/teamDetail:\s*\[([\s\S]*?)\],\s*teamForm:/);
    const formGroup = source.match(/teamForm:\s*\[([\s\S]*?)\],\s*team:/);

    expect(source).toContain("'page-teams':              ['teamList']");
    expect(source).toContain("'page-team-detail':        ['teamList', 'teamDetail', 'education']");
    expect(source).toContain("'page-team-manage':        ['teamList', 'teamForm']");
    expect(listGroup).not.toBeNull();
    expect(detailGroup).not.toBeNull();
    expect(formGroup).not.toBeNull();
    expect(listGroup[1]).toContain('team-list-render.js');
    expect(listGroup[1]).not.toContain('team-detail.js');
    expect(listGroup[1]).not.toContain('team-form.js');
    expect(listGroup[1]).not.toContain('team-share.js');
    expect(detailGroup[1]).toContain('team-detail.js');
    expect(detailGroup[1]).toContain('team-form-join.js');
    expect(formGroup[1]).toContain('team-form-init.js');
    expect(formGroup[1]).toContain('team-form.js');
  });

  test('club list render uses a per-render member count map', () => {
    const renderSource = readProjectFile('js/modules/team/team-list-render.js');
    const listSource = readProjectFile('js/modules/team/team-list.js');
    const statsSource = readProjectFile('js/modules/team/team-list-stats.js');

    expect(statsSource).toContain('_buildTeamMemberCountMap');
    expect(renderSource).toContain('memberCountByTeam');
    expect(renderSource).toContain('this._teamCardHTML(t, { memberCountByTeam })');
    expect(listSource).toContain('this._teamCardHTML(t, { memberCountByTeam })');
  });

  test('club cards show pending feedback before lazy detail navigation completes', () => {
    const renderSource = readProjectFile('js/modules/team/team-list-render.js');
    const styleSource = readProjectFile('css/team.css');

    expect(renderSource).toContain('onclick="App.openTeamDetailFromCard(this, this.dataset.teamId)"');
    expect(renderSource).toContain('_markTeamCardPending?.(cardEl, safeTeamId)');
    expect(renderSource).toContain('return await this.showTeamDetail(safeTeamId, options)');
    expect(renderSource).toContain('finally');
    expect(renderSource).toContain('_clearTeamCardPending?.(cardEl, 650)');
    expect(styleSource).toContain('linear-gradient(90deg, var(--primary), #60a5fa)');
  });
});
