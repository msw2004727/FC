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

  test('shows pending review tab badge only for non staff with own pending students', () => {
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
        { id: 'planA', name: '週三足球', active: true, endDate: '2099-01-01' },
        { id: 'planB', name: '已繳費課', active: true, endDate: '2099-01-01' },
        { id: 'endedPlan', name: '結束課程', active: true, groupId: 'g1', endDate: '2026-01-01' },
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
