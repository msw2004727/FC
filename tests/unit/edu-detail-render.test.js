const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-detail-render.js'),
  'utf8'
);

function escapeHTML(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderWithTeam(team) {
  const bodyEl = { innerHTML: '' };
  const app = {
    _userTag: (name, role) => '<span class="' + role + '">' + escapeHTML(name) + '</span>',
    _teamLeaderTag: (name) => '<span class="user-capsule uc-team-leader">' + escapeHTML(name) + '</span>',
    _renderEduTabContent: jest.fn(),
    _bindSwipeTabs: jest.fn(),
    _loadEduStudents: jest.fn(() => Promise.resolve()),
    _renderEduMemberSection: jest.fn(),
    renderEduGroupList: jest.fn(),
    _updateEduMineBadge: jest.fn(),
    _startEduStudentsListener: jest.fn(),
    switchEduTab: jest.fn(),
  };

  const context = {
    App: app,
    ApiService: {
      getTeam: jest.fn(() => team),
      getCurrentUser: jest.fn(() => null),
    },
    document: {
      getElementById: jest.fn((id) => id === 'team-detail-body' ? bodyEl : null),
    },
    escapeHTML,
    Promise,
  };

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
  context.App.renderEduClubDetail(team.id);

  return bodyEl.innerHTML;
}

describe('renderEduClubDetail info card', () => {
  test('shows education club leaders between manager and coach', () => {
    const html = renderWithTeam({
      id: 'edu-team-1',
      captain: '呂維哲',
      leaders: ['Weiche Lu'],
      coaches: ['Coach A'],
      region: '台中市',
      eduSettings: { acceptingStudents: true },
    });

    expect(html).toContain('<span class="td-card-label">領隊</span>');
    expect(html).toContain('<span class="user-capsule uc-team-leader">Weiche Lu</span>');
    expect(html.indexOf('俱樂部經理')).toBeLessThan(html.indexOf('領隊'));
    expect(html.indexOf('領隊')).toBeLessThan(html.indexOf('教練'));
  });

  test('falls back to not set when education club has no leader', () => {
    const html = renderWithTeam({
      id: 'edu-team-2',
      captain: '呂維哲',
      coaches: [],
      region: '台中市',
      eduSettings: { acceptingStudents: true },
    });

    expect(html).toContain('<span class="td-card-label">領隊</span><span class="td-card-value">未設定</span>');
  });
});
