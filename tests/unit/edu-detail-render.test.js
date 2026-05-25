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
  test('uses unified team detail layout when the shared builder is available', () => {
    const bodyEl = { innerHTML: '' };
    const contentEl = { innerHTML: '', closest: jest.fn(() => ({})) };
    const tabEl = {
      dataset: { edutab: 'course' },
      classList: { toggle: jest.fn() },
    };
    const team = {
      id: 'edu-unified-1',
      type: 'education',
      name: 'Unified Edu Club',
      coaches: [],
    };
    const app = {
      _buildTeamDetailBodyHtml: jest.fn(() => '<div class="td-detail-shell"><div id="edu-detail-tabs"><button class="tab" data-edutab="course"></button></div><div id="edu-detail-tab-content"></div></div>'),
      _canManageTeamMembers: jest.fn(() => false),
      _getTeamStaffIdentity: jest.fn(() => ({ keys: new Set(), names: new Set() })),
      _teamMemberEditModeByTeam: {},
      isEduClubStaff: jest.fn(() => false),
      renderEduCoursePlanList: jest.fn(),
      renderEduGroupList: jest.fn(),
      _loadEduStudents: jest.fn(() => Promise.resolve()),
      _startEduStudentsListener: jest.fn(),
      _updateEduMineBadge: jest.fn(),
      _bindSwipeTabs: jest.fn(),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(() => team),
        getCurrentUser: jest.fn(() => null),
      },
      document: {
        getElementById: jest.fn((id) => {
          if (id === 'team-detail-body') return bodyEl;
          if (id === 'edu-detail-tab-content') return contentEl;
          return null;
        }),
        querySelectorAll: jest.fn((selector) => selector === '#edu-detail-tabs .tab' ? [tabEl] : []),
      },
      escapeHTML,
      Promise,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    context.App.renderEduClubDetail(team.id);

    expect(app._buildTeamDetailBodyHtml).toHaveBeenCalledWith(
      team,
      false,
      false,
      { keys: expect.any(Set), names: expect.any(Set) },
      0,
      0
    );
    expect(bodyEl.innerHTML).toContain('td-detail-shell');
    expect(contentEl.innerHTML).toContain('edu-course-plan-list');
    expect(app._startEduStudentsListener).toHaveBeenCalledWith(team.id);
  });

  test('refreshes active education tab and shared member list after async students load', async () => {
    const bodyEl = { innerHTML: '' };
    const contentEl = { innerHTML: '', closest: jest.fn(() => ({})) };
    const tabEl = {
      dataset: { edutab: 'course' },
      classList: { toggle: jest.fn() },
    };
    const team = {
      id: 'edu-unified-students',
      type: 'education',
      name: 'Unified Edu Club',
      coaches: [],
    };
    const app = {
      _buildTeamDetailBodyHtml: jest.fn(() => '<div class="td-detail-shell"><div id="edu-detail-tabs"><button class="tab" data-edutab="course"></button></div><div id="edu-detail-tab-content"></div><div id="team-members-section"></div></div>'),
      _canManageTeamMembers: jest.fn(() => false),
      _getTeamStaffIdentity: jest.fn(() => ({ keys: new Set(), names: new Set() })),
      _teamMemberEditModeByTeam: {},
      isEduClubStaff: jest.fn(() => false),
      renderEduCoursePlanList: jest.fn(),
      renderEduGroupList: jest.fn(),
      _renderEduMemberSection: jest.fn(),
      _loadEduStudents: jest.fn(() => Promise.resolve([{ id: 'student-1', name: '小麥', enrollStatus: 'active' }])),
      _startEduStudentsListener: jest.fn(),
      _updateEduMineBadge: jest.fn(),
      _bindSwipeTabs: jest.fn(),
      _refreshTeamMembersCardFromCache: jest.fn(),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(() => team),
        getCurrentUser: jest.fn(() => null),
      },
      document: {
        getElementById: jest.fn((id) => {
          if (id === 'team-detail-body') return bodyEl;
          if (id === 'edu-detail-tab-content') return contentEl;
          return null;
        }),
        querySelectorAll: jest.fn((selector) => selector === '#edu-detail-tabs .tab' ? [tabEl] : []),
      },
      escapeHTML,
      Promise,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    context.App._renderEduMemberSection = jest.fn();
    context.App._updateEduMineBadge = jest.fn();
    context.App.renderEduClubDetail(team.id);
    expect(app._refreshTeamMembersCardFromCache).not.toHaveBeenCalled();

    await Promise.resolve();

    expect(app.renderEduCoursePlanList).toHaveBeenCalledWith(team.id, false);
    expect(app._renderEduMemberSection).not.toHaveBeenCalled();
    expect(app.renderEduGroupList).not.toHaveBeenCalled();
    expect(app._updateEduMineBadge).toHaveBeenCalledWith(team.id);
    expect(app._refreshTeamMembersCardFromCache).toHaveBeenCalledWith(team.id);
  });

  test('renders renamed education tabs and pending review tab content', () => {
    const contentEl = { innerHTML: '', closest: jest.fn(() => ({})) };
    const app = {
      _eduDetailTeamId: 'teamA',
      _eduActiveTab: 'pending',
      isEduClubStaff: jest.fn(() => true),
      getEduStudents: jest.fn(() => [
        { id: 'pending-1', name: '小麥', enrollStatus: 'pending' },
        { id: 'active-1', name: '已通過', enrollStatus: 'active' },
      ]),
      _renderPendingStudentRow: jest.fn((teamId, groupId, student) => '<div class="pending-row">' + escapeHTML(student.name) + '</div>'),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => null),
      },
      document: {
        getElementById: jest.fn((id) => id === 'edu-detail-tab-content' || id === 'edu-pending-section' ? contentEl : null),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      Promise,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    context.App._eduActiveTab = 'pending';
    context.App._renderEduTabContent('teamA');

    expect(contentEl.innerHTML).toContain('待審核名單');
    expect(contentEl.innerHTML).toContain('小麥');
    expect(contentEl.innerHTML).not.toContain('已通過');
    expect(app._renderPendingStudentRow).toHaveBeenCalledWith('teamA', '', { id: 'pending-1', name: '小麥', enrollStatus: 'pending' });
  });

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

  test('derives my next class from approved weekly course enrollment', () => {
    const app = {
      _courseEnrollCache: {
        'teamA:planA': [{ studentId: 'studentA', status: 'approved' }],
      },
      _getCourseEnrollCacheKey: (teamId, planId) => teamId + ':' + planId,
      _getCoursePlanNextWeeklyOccurrence: jest.fn(() => ({
        label: '2099-01-05 09:00',
        timestamp: new Date('2099-01-05T09:00:00').getTime(),
      })),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => null),
      },
      document: {
        getElementById: jest.fn(() => null),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      Promise,
      Date,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });

    const next = context.App._getEduNextClassForStudent('teamA', {
      id: 'studentA',
      enrollStatus: 'active',
    }, [{
      id: 'planA',
      name: 'Weekly Plan',
      planType: 'weekly',
      active: true,
      location: 'Center A',
      coachName: 'Coach A',
    }]);

    expect(next.planName).toBe('Weekly Plan');
    expect(next.dateLabel).toBe('2099-01-05 09:00');
    expect(next.location).toBe('Center A');
    expect(next.coachName).toBe('Coach A');
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
