const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-course-enrollment-render.js'),
  'utf8'
);

function loadModule(app, elements) {
  const context = {
    App: app,
    document: {
      getElementById: jest.fn((id) => elements[id] || null),
    },
    window: {},
    localStorage: { getItem: jest.fn(() => null) },
    console,
    Object,
    String,
    Set,
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
});
