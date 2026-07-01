const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-detail-render.js'),
  'utf8'
);
const cssSource = fs.readFileSync(
  path.join(__dirname, '../../css/education.css'),
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

  test('refreshes v2 featured courses after async course plans load on direct team detail entry', async () => {
    let resolveCourseRender;
    const courseRenderPromise = new Promise(resolve => { resolveCourseRender = resolve; });
    const tabEl = {
      dataset: { edutab: 'course' },
      classList: { toggle: jest.fn() },
    };
    const app = {
      _bindSwipeTabs: jest.fn(),
      _loadEduStudents: jest.fn(() => new Promise(() => {})),
      _startEduStudentsListener: jest.fn(),
      _refreshTeamDetailV2CourseSummaryFromCache: jest.fn(),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => null),
      },
      document: {
        getElementById: jest.fn(() => null),
        querySelectorAll: jest.fn((selector) => selector === '#edu-detail-tabs .tab' ? [tabEl] : []),
      },
      escapeHTML,
      Promise,
      console,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    context.App._renderEduTabContent = jest.fn(() => courseRenderPromise);
    context.App._initEduClubDetailSection('teamA');

    expect(app._refreshTeamDetailV2CourseSummaryFromCache).not.toHaveBeenCalled();
    resolveCourseRender(true);
    await courseRenderPromise;
    await Promise.resolve();

    expect(app._refreshTeamDetailV2CourseSummaryFromCache).toHaveBeenCalledWith('teamA');
  });

  test('shared student refresh updates the active tab and related education summaries', async () => {
    const courseRender = Promise.resolve();
    const app = {
      isEduClubStaff: jest.fn(() => true),
      getEduStudents: jest.fn(() => []),
      renderEduCoursePlanList: jest.fn(() => courseRender),
      _updateGroupMemberCounts: jest.fn(),
      _updateEduMineBadge: jest.fn(),
      _refreshTeamMembersCardFromCache: jest.fn(),
      _refreshTeamDetailV2CourseSummaryFromCache: jest.fn(),
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
      console,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    context.App._updateEduMineBadge = jest.fn();
    context.App._eduDetailTeamId = 'teamA';
    context.App._eduActiveTab = 'course';

    await context.App._refreshEduDetailStudentState('teamA');

    expect(app.renderEduCoursePlanList).toHaveBeenCalledWith('teamA', true);
    expect(app._updateGroupMemberCounts).toHaveBeenCalledWith('teamA');
    expect(context.App._updateEduMineBadge).toHaveBeenCalledWith('teamA');
    expect(app._refreshTeamMembersCardFromCache).toHaveBeenCalledWith('teamA');
    expect(app._refreshTeamDetailV2CourseSummaryFromCache).toHaveBeenCalledWith('teamA');
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
    expect(app._renderPendingStudentRow).toHaveBeenCalledWith('teamA', '', { id: 'pending-1', name: '小麥', enrollStatus: 'pending' }, { readOnly: true });
  });

  test('course tab keeps add action disabled while cached plans refresh', () => {
    const contentEl = { innerHTML: '', closest: jest.fn(() => null) };
    const app = {
      _eduDetailTeamId: 'teamA',
      _eduActiveTab: 'course',
      _eduCoursePlansCache: { teamA: [{ id: 'planA', name: 'Cached Plan' }] },
      isEduClubStaff: jest.fn(() => true),
      renderEduCoursePlanList: jest.fn(() => Promise.resolve(true)),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => null),
      },
      document: {
        getElementById: jest.fn((id) => id === 'edu-detail-tab-content' ? contentEl : null),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      Promise,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    context.App._eduActiveTab = 'course';
    context.App._renderEduTabContent('teamA');

    expect(contentEl.innerHTML).toContain('id="edu-course-plan-add-teamA"');
    expect(contentEl.innerHTML).toContain('disabled');
    expect(contentEl.innerHTML).not.toContain('onclick="App.showEduCoursePlanForm');
  });

  test('group tab keeps add action disabled while cached groups refresh', () => {
    const contentEl = { innerHTML: '', closest: jest.fn(() => null) };
    const app = {
      _eduDetailTeamId: 'teamA',
      _eduActiveTab: 'group',
      _eduGroupsCache: { teamA: [{ id: 'groupA', name: 'Cached Group' }] },
      isEduClubStaff: jest.fn(() => true),
      renderEduGroupList: jest.fn(() => Promise.resolve(true)),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => null),
      },
      document: {
        getElementById: jest.fn((id) => id === 'edu-detail-tab-content' ? contentEl : null),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      Promise,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    context.App._eduActiveTab = 'group';
    context.App._renderEduTabContent('teamA');

    expect(contentEl.innerHTML).toContain('id="edu-group-add-teamA"');
    expect(contentEl.innerHTML).toContain('disabled');
    expect(contentEl.innerHTML).not.toContain('onclick="App.showEduGroupForm');
  });

  test('active student refresh keeps cached data read only after student refresh fails', () => {
    const app = {
      _eduDetailTeamId: 'teamA',
      _eduActiveTab: 'student',
      isEduClubStaff: jest.fn(() => false),
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
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    context.App._eduActiveTab = 'student';
    context.App._eduStudentsLoadFailedByTeam = { teamA: true };
    context.App._renderEduMemberSection = jest.fn();
    context.App._refreshEduActiveTabContent('teamA');

    expect(context.App._renderEduMemberSection).toHaveBeenCalledWith('teamA', {
      readOnly: true,
      refreshError: true,
    });
  });

  test('student tab renders cached section while fresh students refresh in background', async () => {
    const contentEl = { innerHTML: '', closest: jest.fn(() => null) };
    let resolveLoad;
    const loadPromise = new Promise(resolve => { resolveLoad = resolve; });
    const app = {
      _eduDetailTeamId: 'teamA',
      _eduActiveTab: 'student',
      _eduStudentsCache: { teamA: [{ id: 'cached-student', enrollStatus: 'active' }] },
      isEduClubStaff: jest.fn(() => false),
      getEduStudents: jest.fn(() => [{ id: 'cached-student', enrollStatus: 'active' }]),
      _loadEduStudents: jest.fn(() => loadPromise),
      _refreshEduPendingTabState: jest.fn(),
      _updateEduMineBadge: jest.fn(),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => null),
      },
      document: {
        getElementById: jest.fn((id) => id === 'edu-detail-tab-content' ? contentEl : null),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      Promise,
      console,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    context.App._eduDetailTeamId = 'teamA';
    context.App._eduActiveTab = 'student';
    context.App._refreshEduPendingTabState = jest.fn();
    context.App._updateEduMineBadge = jest.fn();
    context.App._renderEduMemberSection = jest.fn();
    context.App._renderEduTabContent('teamA');

    expect(contentEl.innerHTML).toContain('id="edu-member-section"');
    expect(contentEl.innerHTML).not.toContain('edu-loading');
    expect(context.App._renderEduMemberSection).toHaveBeenNthCalledWith(1, 'teamA', { refreshing: true, readOnly: true });

    resolveLoad([{ id: 'fresh-student', enrollStatus: 'active' }]);
    await loadPromise;
    await Promise.resolve();

    expect(context.App._refreshEduPendingTabState).toHaveBeenCalledWith('teamA');
    expect(context.App._renderEduMemberSection).toHaveBeenNthCalledWith(2, 'teamA', {});
    expect(context.App._updateEduMineBadge).toHaveBeenCalledWith('teamA');
  });

  test('pending tab renders cached section while fresh students refresh in background', async () => {
    const contentEl = { innerHTML: '', closest: jest.fn(() => null) };
    let resolveLoad;
    const loadPromise = new Promise(resolve => { resolveLoad = resolve; });
    const app = {
      _eduDetailTeamId: 'teamA',
      _eduActiveTab: 'pending',
      _eduStudentsCache: { teamA: [{ id: 'cached-pending', enrollStatus: 'pending' }] },
      isEduClubStaff: jest.fn(() => false),
      getEduStudents: jest.fn(() => [{ id: 'cached-pending', enrollStatus: 'pending' }]),
      _loadEduStudents: jest.fn(() => loadPromise),
      _refreshEduPendingTabState: jest.fn(),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => null),
      },
      document: {
        getElementById: jest.fn((id) => id === 'edu-detail-tab-content' ? contentEl : null),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      Promise,
      console,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    context.App._eduDetailTeamId = 'teamA';
    context.App._eduActiveTab = 'pending';
    context.App._refreshEduPendingTabState = jest.fn();
    context.App._renderEduPendingSection = jest.fn();
    context.App._renderEduTabContent('teamA');

    expect(contentEl.innerHTML).toContain('id="edu-pending-section"');
    expect(contentEl.innerHTML).not.toContain('edu-loading');
    expect(context.App._renderEduPendingSection).toHaveBeenNthCalledWith(1, 'teamA', { refreshing: true, readOnly: true });

    resolveLoad([{ id: 'fresh-pending', enrollStatus: 'pending' }]);
    await loadPromise;
    await Promise.resolve();

    expect(context.App._refreshEduPendingTabState).toHaveBeenCalledWith('teamA');
    expect(context.App._renderEduPendingSection).toHaveBeenNthCalledWith(2, 'teamA', {});
  });

  test('filters pending review tab to current viewer students for non staff', () => {
    const contentEl = { innerHTML: '', closest: jest.fn(() => ({})) };
    const app = {
      _eduDetailTeamId: 'teamA',
      _eduActiveTab: 'pending',
      isEduClubStaff: jest.fn(() => false),
      calcAge: jest.fn(() => null),
      getEduStudents: jest.fn(() => [
        { id: 'pending-own', name: '自己的待審核', enrollStatus: 'pending', parentUid: 'viewer', createdAt: '2026-06-12T03:04:05Z' },
        { id: 'pending-other', name: '別人的待審核', enrollStatus: 'pending', parentUid: 'other' },
        { id: 'active-own', name: '自己的已通過', enrollStatus: 'active', parentUid: 'viewer' },
      ]),
      _renderPendingStudentRow: jest.fn((teamId, groupId, student) => '<div class="pending-row"><button>通過</button><button>拒絕</button>' + escapeHTML(student.name) + '</div>'),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => ({ uid: 'viewer' })),
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

    expect(contentEl.innerHTML).toContain('自己的待審核');
    expect(contentEl.innerHTML).toContain('2026/06/12提交中');
    expect(contentEl.innerHTML).not.toContain('別人的待審核');
    expect(contentEl.innerHTML).not.toContain('自己的已通過');
    expect(contentEl.innerHTML).not.toContain('通過');
    expect(contentEl.innerHTML).not.toContain('拒絕');
    expect(app._renderPendingStudentRow).not.toHaveBeenCalled();
  });

  test('shows pending review tab badge for staff and non staff own pending students', () => {
    const app = {
      isEduClubStaff: jest.fn(() => false),
      getEduStudents: jest.fn(() => [
        { id: 'pending-own-1', enrollStatus: 'pending', selfUid: 'viewer' },
        { id: 'pending-own-2', enrollStatus: 'pending', parentUid: 'viewer' },
        { id: 'pending-other', enrollStatus: 'pending', selfUid: 'other' },
      ]),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => ({ uid: 'viewer' })),
      },
      document: {
        getElementById: jest.fn(() => null),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      Promise,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });

    const visibleHtml = context.App._buildEduDetailTabControlsHtml('teamA');
    expect(visibleHtml).toContain('id="edu-pending-tab-wrap" class="edu-tab-mine-wrap"');
    expect(visibleHtml).toContain('id="edu-pending-badge" class="edu-tab-badge" style="display:inline-block">2</span>');

    app.getEduStudents.mockReturnValue([
      { id: 'pending-other', enrollStatus: 'pending', selfUid: 'other' },
      { id: 'active-own', enrollStatus: 'active', selfUid: 'viewer' },
    ]);
    const hiddenHtml = context.App._buildEduDetailTabControlsHtml('teamA');
    expect(hiddenHtml).toContain('id="edu-pending-tab-wrap" class="edu-tab-mine-wrap" style="display:none"');
    expect(hiddenHtml).toContain('id="edu-pending-badge" class="edu-tab-badge"></span>');

    app.isEduClubStaff.mockReturnValue(true);
    app.getEduStudents.mockReturnValue([
      { id: 'pending-student-1', enrollStatus: 'pending', selfUid: 'student-1' },
      { id: 'pending-student-2', enrollStatus: 'pending', selfUid: 'student-2' },
      { id: 'active-student', enrollStatus: 'active', selfUid: 'student-3' },
    ]);
    const staffHtml = context.App._buildEduDetailTabControlsHtml('teamA');
    expect(staffHtml).toContain('id="edu-pending-tab-wrap" class="edu-tab-mine-wrap"');
    expect(staffHtml).not.toContain('id="edu-pending-tab-wrap" class="edu-tab-mine-wrap" style="display:none"');
    expect(staffHtml).toContain('id="edu-pending-badge" class="edu-tab-badge" style="display:inline-block">2</span>');
  });

  test('adds live class to education course tab when current courses exist', () => {
    const app = {
      isEduClubStaff: jest.fn(() => false),
      getEduStudents: jest.fn(() => []),
      _getTeamCourseLiveTabClass: jest.fn(() => ' td-course-tab-live'),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => ({ uid: 'viewer' })),
      },
      document: {
        getElementById: jest.fn(() => null),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      Promise,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });

    const html = context.App._buildEduDetailTabControlsHtml('teamA');

    expect(html).toContain('class="tab active td-course-tab-live" data-edutab="course"');
  });

  test('flattens v2 course tab content without duplicate course containers', () => {
    const contentEl = {
      innerHTML: '',
      closest: jest.fn((selector) => (
        selector === '#edu-detail-section' || selector === '.td-v2-edu-card' ? {} : null
      )),
    };
    const app = {
      _eduDetailTeamId: 'teamA',
      _eduActiveTab: 'course',
      isEduClubStaff: jest.fn(() => true),
      renderEduCoursePlanList: jest.fn(),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => null),
      },
      document: {
        getElementById: jest.fn((id) => id === 'edu-detail-tab-content' ? contentEl : null),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      Promise,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    context.App._renderEduTabContent('teamA');

    expect(contentEl.innerHTML).not.toContain('td-edu-course-toolbar');
    expect(contentEl.innerHTML).toContain('edu-course-plan-list-inline');
    expect(contentEl.innerHTML).not.toContain('td-edu-panel');
    expect(contentEl.innerHTML).not.toContain('td-card-title');
    expect(contentEl.innerHTML).not.toContain('App._showEduInfoPopup');
    expect(contentEl.innerHTML).not.toContain('App.showEduCoursePlanForm');
    expect(app.renderEduCoursePlanList).toHaveBeenCalledWith('teamA', true);
  });

  test('keeps active student attendance and withdraw actions compact inline', () => {
    const contentEl = { innerHTML: '', closest: jest.fn(() => ({})) };
    const app = {
      _eduDetailTeamId: 'teamA',
      _eduActiveTab: 'student',
      isEduClubStaff: jest.fn(() => false),
      getEduStudents: jest.fn(() => [
        { id: 'studentA', name: 'Very Long Student Nickname', enrollStatus: 'active', parentUid: 'viewer', birthday: '2015-01-01' },
      ]),
      getEduCoursePlans: jest.fn(() => []),
      calcAge: jest.fn(() => 11),
      _getEduNextClassForStudent: jest.fn(() => null),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => ({ uid: 'viewer' })),
      },
      document: {
        getElementById: jest.fn((id) => (
          id === 'edu-detail-tab-content' || id === 'edu-member-section' ? contentEl : null
        )),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      Promise,
      Date,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    context.App._renderEduMemberSection('teamA');

    expect(contentEl.innerHTML).toContain('Very Long Student Nickname');
    expect(contentEl.innerHTML).toContain('edu-header-actions edu-member-inline-actions');
    expect(contentEl.innerHTML).toContain('edu-attendance-btn');
    expect(contentEl.innerHTML).toContain('edu-withdraw-btn');
    expect(contentEl.innerHTML.indexOf('Very Long Student Nickname')).toBeLessThan(
      contentEl.innerHTML.indexOf('edu-header-actions edu-member-inline-actions')
    );
    expect(cssSource).toMatch(/\.edu-student-header\s*\{[^}]*flex-wrap: nowrap;[^}]*min-width: 0;/s);
    expect(cssSource).toMatch(/\.edu-student-name\s*\{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/s);
    expect(cssSource).toMatch(/\.edu-member-inline-actions \.edu-attendance-btn,\s*\.edu-member-inline-actions \.edu-withdraw-btn\s*\{[^}]*font-size: \.62rem;/s);
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

  test('renders current-user unpaid reminder tag from grouped course summary', async () => {
    const badgeEl = { textContent: '', style: {} };
    const statusEl = { innerHTML: '', style: {} };
    const app = {
      _courseEnrollCache: {
        'teamA:planA': [
          { id: 'enroll-1', studentId: 'stu1', status: 'approved', paidAt: null },
          { id: 'enroll-2', studentId: 'stu2', status: 'approved', paidAt: '2026-06-01' },
        ],
      },
      _getCourseEnrollCacheKey: (teamId, planId) => teamId + ':' + planId,
      getEduStudents: jest.fn(() => [
        { id: 'stu1', name: '小明', enrollStatus: 'active', parentUid: 'parent-1', groupIds: ['g1'], groupNames: ['幼兒班'] },
        { id: 'stu2', name: '小華', enrollStatus: 'active', parentUid: 'parent-1' },
        { id: 'stu3', name: '小美', enrollStatus: 'active', parentUid: 'other-parent' },
      ]),
      _loadEduCoursePlans: jest.fn(() => Promise.resolve([
        { id: 'planA', name: '週三足球', active: true, endDate: '2099-01-01', price: 1200 },
        { id: 'planB', name: '已繳費課', active: true, endDate: '2099-01-01', price: 1200 },
        { id: 'endedPlan', name: '結束課程', active: true, groupId: 'g1', endDate: '2026-01-01', price: 1200 },
      ])),
      _todayStr: jest.fn(() => '2026-06-10'),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => ({ uid: 'parent-1' })),
      },
      FirebaseService: {
        queryEduAttendance: jest.fn(() => Promise.resolve([{ kind: 'signin' }])),
      },
      document: {
        getElementById: jest.fn((id) => {
          if (id === 'edu-mine-badge') return badgeEl;
          if (id === 'edu-mine-status') return statusEl;
          return null;
        }),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      Promise,
      Date,
      Map,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    await context.App._updateEduMineBadge('teamA');

    expect(badgeEl.textContent).toBe(2);
    expect(statusEl.style.display).toBe('flex');
    expect(statusEl.innerHTML).toContain('class="edu-unpaid-tag"');
    expect(statusEl.innerHTML).toContain('您尚有 <strong>2</strong> 筆未繳費');
    expect(app._eduUnpaidSummaryByTeam.teamA.total).toBe(2);
    expect(app._eduUnpaidSummaryByTeam.teamA.plans.map(p => p.planName)).toEqual(['週三足球', '結束課程']);
    expect(app._eduUnpaidSummaryByTeam.teamA.plans[1].students[0].studentName).toBe('小明');
    expect(context.FirebaseService.queryEduAttendance).toHaveBeenCalledWith({ teamId: 'teamA', coursePlanId: 'endedPlan', studentId: 'stu1' });
  });

  test('unpaid reminder ignores free and unpriced course plans', async () => {
    const app = {
      _courseEnrollCache: {
        'teamA:freePlan': [{ id: 'enroll-free', studentId: 'stu1', status: 'approved', paidAt: null }],
        'teamA:blankPlan': [{ id: 'enroll-blank', studentId: 'stu1', status: 'approved', paidAt: null }],
        'teamA:paidPlan': [{ id: 'enroll-paid-required', studentId: 'stu1', status: 'approved', paidAt: null }],
      },
      _getCourseEnrollCacheKey: (teamId, planId) => teamId + ':' + planId,
      _loadEduCoursePlans: jest.fn(() => Promise.resolve([
        { id: 'freePlan', name: 'Free Plan', active: true, endDate: '2099-01-01', price: 0 },
        { id: 'blankPlan', name: 'Blank Plan', active: true, endDate: '2099-01-01' },
        { id: 'paidPlan', name: 'Paid Plan', active: true, endDate: '2099-01-01', price: '800' },
      ])),
      _todayStr: jest.fn(() => '2026-06-10'),
    };
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => ({ uid: 'parent-1' })),
      },
      FirebaseService: {
        queryEduAttendance: jest.fn(() => Promise.resolve([])),
      },
      document: {
        getElementById: jest.fn(() => null),
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      Promise,
      Date,
      Map,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    const summary = await context.App._collectEduUnpaidSummary('teamA', [
      { id: 'stu1', name: 'Student One', enrollStatus: 'active', parentUid: 'parent-1' },
    ]);

    expect(summary.total).toBe(1);
    expect(summary.plans.map(p => p.planName)).toEqual(['Paid Plan']);
  });

  test('unpaid summary modal groups courses, escapes names, and shows staff payment reminder', () => {
    let appended = null;
    const app = {};
    const context = {
      App: app,
      ApiService: {
        getTeam: jest.fn(),
        getCurrentUser: jest.fn(() => null),
      },
      document: {
        getElementById: jest.fn(() => null),
        createElement: jest.fn(() => ({ id: '', className: '', innerHTML: '' })),
        body: {
          appendChild: jest.fn((node) => { appended = node; }),
        },
        querySelectorAll: jest.fn(() => []),
      },
      escapeHTML,
      Promise,
      Date,
      Number,
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'edu-detail-render.js' });
    context.App._renderEduUnpaidSummaryModal({
      total: 2,
      plans: [{
        planId: 'planA',
        planName: '足球 <基礎>',
        students: [
          { studentId: 'stu1', studentName: '小明 & 小華', groupNames: ['A <班>'] },
          { studentId: 'stu2', studentName: '小美', groupNames: [] },
        ],
      }],
    });

    expect(appended.className).toContain('edu-unpaid-overlay');
    expect(appended.innerHTML).toContain('您尚有 2 筆未繳費');
    expect(appended.innerHTML).toContain('足球 &lt;基礎&gt;');
    expect(appended.innerHTML).toContain('小明 &amp; 小華');
    expect(appended.innerHTML).toContain('A &lt;班&gt;');
    expect(appended.innerHTML).not.toContain('足球 <基礎>');
    expect(appended.innerHTML).toContain('以下是尚未登記繳費的課堂與學員名單。');
    expect(appended.innerHTML).toContain('如果已經繳費，請俱樂部職員協助在課堂名單內勾選已繳費。');
    expect(appended.innerHTML).toContain('edu-unpaid-reflect-note');
  });

  test('unpaid reminder CSS includes tag, dialog, responsive layout, and reflective text', () => {
    expect(cssSource).toContain('.edu-unpaid-tag');
    expect(cssSource).toContain('.edu-unpaid-dialog');
    expect(cssSource).toContain('.edu-unpaid-course-card');
    expect(cssSource).toContain('.edu-unpaid-reflect-note');
    expect(cssSource).toContain('@keyframes eduUnpaidReflect');
    expect(cssSource).toContain('@media (prefers-reduced-motion: reduce)');
    expect(cssSource).toContain('@supports not ((background-clip: text) or (-webkit-background-clip: text))');
    expect(cssSource).toContain('@media (max-width: 560px)');
  });
});
