const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-enrollment-render.js'),
  'utf8'
);
const educationPage = fs.readFileSync(
  path.join(__dirname, '../../pages/education.html'),
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

function loadModule(app, elements) {
  const context = {
    App: app,
    ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'viewer' })) },
    document: {
      getElementById: jest.fn((id) => elements[id] || null),
    },
    window: {},
    localStorage: { getItem: jest.fn(() => null) },
    escapeHTML,
    console,
    Object,
    String,
    Set,
    Date,
  };
  vm.runInNewContext(source, context, { filename: 'edu-course-enrollment-render.js' });
  return context.App;
}

describe('edu course enrollment render', () => {
  test('session course roster opens the shared enrollment list, not the session board', async () => {
    const elements = {
      'edu-ce-list': { innerHTML: '' },
      'edu-ce-title': { textContent: '' },
      'edu-ce-subtitle': { textContent: '' },
      'edu-ce-staff-actions': { style: { display: 'none' } },
    };
    const app = {
      currentPage: '',
      showPage: jest.fn(async function showPage(page) {
        this.currentPage = page;
      }),
      getEduCoursePlans: jest.fn(() => [{
        id: 'sessionA',
        name: 'Session Course',
        planType: 'session',
        totalSessions: 8,
      }]),
      isEduClubStaff: jest.fn(() => true),
    };
    const loaded = loadModule(app, elements);
    loaded._updateEnrollSubtitle = jest.fn();
    loaded._renderCourseEnrollmentList = jest.fn(async () => {});
    loaded._renderCourseSessionBoard = jest.fn(async () => {});

    await loaded.showCourseEnrollmentList('teamA', 'sessionA');

    expect(elements['edu-ce-title'].textContent).toBe('Session Course');
    expect(elements['edu-ce-staff-actions'].style.display).toBe('');
    expect(loaded._renderCourseEnrollmentList).toHaveBeenCalledWith('teamA', 'sessionA', expect.any(Number));
    expect(loaded._renderCourseSessionBoard).not.toHaveBeenCalled();
  });

  test('course roster page does not expose check-in action buttons', () => {
    const enrollmentSection = educationPage.slice(
      educationPage.indexOf('id="page-edu-course-enrollment"'),
      educationPage.indexOf('id="page-edu-checkin"')
    );

    expect(enrollmentSection).not.toContain('showEduCheckin(App._ceTeamId, App._cePlanId)');
    expect(enrollmentSection).not.toContain('_showCourseAttendanceInfo(App._ceTeamId, App._cePlanId)');
    expect(enrollmentSection).not.toContain('手動簽到');
    expect(enrollmentSection).not.toContain('現場簽到');
    expect(enrollmentSection).not.toContain('簽到資訊');
  });

  test('render list can use optimistic enrollment cache without reloading', async () => {
    const elements = {
      'edu-ce-list': { innerHTML: '' },
      'edu-ce-subtitle': { textContent: '' },
    };
    const app = {
      _courseEnrollCache: {
        'teamA:planA': [{ id: 'enrA', studentId: 'stuA', studentName: '小明', status: 'pending' }],
      },
      _getCourseEnrollCacheKey: jest.fn((teamId, planId) => teamId + ':' + planId),
      _loadCourseEnrollments: jest.fn(async () => []),
      getEduCoursePlans: jest.fn(() => [{ id: 'planA', name: 'Plan A', planType: 'weekly' }]),
      getEduStudents: jest.fn(() => [{ id: 'stuA', name: '小明' }]),
      isEduClubStaff: jest.fn(() => true),
      calcAge: jest.fn(() => null),
      _updateEnrollSubtitle: jest.fn(),
    };
    const loaded = loadModule(app, elements);

    await loaded._renderCourseEnrollmentList('teamA', 'planA', { useCache: true });

    expect(app._loadCourseEnrollments).not.toHaveBeenCalled();
    expect(elements['edu-ce-list'].innerHTML).toContain('小明');
    expect(elements['edu-ce-list'].innerHTML).toContain('edu-ce-card-pending');
  });

  test('approved enrollment card uses compact paid and 15-char note controls without attendance', () => {
    const app = {
      calcAge: jest.fn(() => 10),
    };
    const loaded = loadModule(app, {});

    const cardHtml = loaded._renderApprovedEnrollmentCard({
      id: 'enrA',
      studentId: 'stuA',
      studentName: '小客',
      paidAt: null,
      coachNotes: 'abcdefghijklmnop',
    }, {
      planType: 'session',
      totalSessions: 8,
    }, [{
      id: 'stuA',
      birthday: '2016-01-01',
      gender: 'female',
      groupNames: ['U10'],
    }], 'teamA', 'planA', true);

    expect(cardHtml).toContain('※繳費打勾');
    expect(cardHtml).not.toContain('未繳費');
    expect(cardHtml).not.toContain('出勤');
    expect(cardHtml).not.toContain('edu-ce-expand');
    expect(cardHtml).not.toContain('_toggleEnrollExpand');
    expect(cardHtml).toContain('edu-ce-note-side');
    expect(cardHtml).toContain('edu-ce-note-actions');
    expect(cardHtml).toContain('id="ce-note-trigger-enrA"');
    expect(cardHtml).toContain("_toggleEnrollNoteEditor('ce-note-panel-enrA','ce-note-trigger-enrA')");
    expect(cardHtml).toContain("App._removeApprovedCourseEnrollment('teamA','planA','enrA',this)");
    expect(cardHtml).toContain('class="edu-ce-remove-approved-btn"');
    expect(cardHtml).not.toContain('edu-ce-card-main');
    expect(cardHtml).toContain('maxlength="15"');
    expect(cardHtml).toContain('abcdefghijklmno');
    expect(cardHtml).not.toContain('abcdefghijklmnop');
  });

  test('approved paid card uses setting button instead of pencil icon', () => {
    const app = {
      calcAge: jest.fn(() => 10),
    };
    const loaded = loadModule(app, {});

    const cardHtml = loaded._renderApprovedEnrollmentCard({
      id: 'enrPaid',
      studentId: 'stuA',
      studentName: '小客',
      paidAt: '2099-01-02',
      coachNotes: '',
    }, {}, [{ id: 'stuA', birthday: '2016-01-01' }], 'teamA', 'planA', true);

    expect(cardHtml).toContain('已繳費 2099-01-02');
    expect(cardHtml).toContain('class="edu-ce-paid-edit"');
    expect(cardHtml).toContain('>設定</button>');
    expect(cardHtml).not.toContain('✏️');
  });
});
