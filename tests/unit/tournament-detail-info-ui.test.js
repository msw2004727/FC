const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

describe('tournament detail info UI', () => {
  beforeEach(() => {
    jest.resetModules();
    global.escapeHTML = value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    global.ApiService = {};
    global.App = {
      _userTag: jest.fn((name, role, options) => '<span class="user-capsule" data-uid="' + global.escapeHTML(options?.uid || '') + '">' + global.escapeHTML(name) + '</span>'),
      _getTournamentMode: jest.fn(() => 'friendly'),
      _renderTournamentDetailToolbar: jest.fn(),
      _syncTournamentDetailTabsForMode: jest.fn(),
    };
  });

  afterEach(() => {
    delete global.App;
    delete global.ApiService;
    delete global.escapeHTML;
    delete global.document;
  });

  test('renders multiple venues as stacked map links with SVG pins', () => {
    const container = { innerHTML: '' };
    global.document = { getElementById: id => (id === 'td-info-section' ? container : null) };
    require('../../js/modules/tournament/tournament-detail.js');

    global.App.renderTournamentInfo({
      id: 'ct_info_ui',
      region: '台北',
      venues: ['第一球場', '第二球場'],
      organizer: '測試主辦俱樂部',
      refereeHead: { uid: 'head_1', name: '王裁判長' },
      referees: [{ uid: 'ref_1', name: '林裁判' }],
    });

    expect(container.innerHTML).toContain('td-venue-list');
    expect((container.innerHTML.match(/td-venue-link/g) || []).length).toBe(2);
    expect(container.innerHTML).toContain('td-venue-pin');
    expect(container.innerHTML).toContain('rel="noopener noreferrer"');
    expect(container.innerHTML).toContain(encodeURIComponent('台北 第一球場'));
    expect(container.innerHTML).not.toContain('↗');
    expect(container.innerHTML).not.toContain('>|</span>');
  });

  test('renders organizer and referee fields with detail-specific UI classes', () => {
    const container = { innerHTML: '' };
    global.document = { getElementById: id => (id === 'td-info-section' ? container : null) };
    require('../../js/modules/tournament/tournament-detail.js');

    global.App.renderTournamentInfo({
      id: 'ct_info_people',
      venues: ['主場'],
      organizer: '測試主辦俱樂部',
      refereeHead: { uid: 'head_1', name: '王裁判長' },
      referees: [
        { uid: 'ref_1', name: '林裁判' },
        { uid: 'ref_2', name: '陳裁判' },
      ],
    });

    expect(container.innerHTML).toContain('td-organizer-pill');
    expect(container.innerHTML).toContain('td-referee-card-head');
    expect(container.innerHTML).toContain('td-referee-card-list');
    expect(container.innerHTML).toContain('td-referee-role-chip');
    expect(container.innerHTML).toContain('賽務判定與裁判協調');
    expect(global.App._userTag).toHaveBeenCalledWith('王裁判長', null, { uid: 'head_1' });
    expect(global.App._userTag).toHaveBeenCalledWith('林裁判', null, { uid: 'ref_1' });
  });

  test('CSS covers venue pin, organizer pill, referee series, and dark theme variants', () => {
    const style = readProjectFile('css/tournament.css');

    expect(style).toContain('.td-venue-list');
    expect(style).toContain('.td-venue-pin');
    expect(style).toContain('color: #ef1b2d;');
    expect(style).toContain('.td-organizer-pill');
    expect(style).toContain('.td-referee-card-head');
    expect(style).toContain('.td-referee-card-list');
    expect(style).toContain('flex-wrap: nowrap;');
    expect(style).toContain('overflow-x: auto;');
    expect(style).toContain('.td-referee-people::-webkit-scrollbar');
    expect(style).not.toContain('@media (max-width: 430px) {\n  .td-referee-card');
    expect(style).toContain('[data-theme="dark"] .td-referee-card-head');
  });
});
