const fs = require('fs');
const path = require('path');
const vm = require('vm');

const groupSource = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-group-list.js'),
  'utf8'
);
const studentSource = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-student-list.js'),
  'utf8'
);

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

describe('education cache-first readonly states', () => {
  test('cached groups stay read only when refresh falls back to cache', async () => {
    const container = { innerHTML: '', closest: jest.fn(() => null) };
    const app = {
      _eduGroupsCache: {
        teamA: [{ id: 'groupA', name: 'Cached Group', active: true }],
      },
      _eduGroupsLoadFailedByTeam: {},
      isEduClubStaff: jest.fn(() => true),
      getEduStudents: jest.fn(() => []),
      getUnmatchedPendingStudents: jest.fn(() => []),
    };
    const context = {
      App: app,
      FirebaseService: {
        listEduGroups: jest.fn(async () => { throw new Error('network down'); }),
      },
      document: {
        getElementById: jest.fn((id) => id === 'edu-group-list' ? container : null),
      },
      escapeHTML,
      console,
      Promise,
    };
    vm.runInNewContext(groupSource, context, { filename: 'edu-group-list.js' });
    context.App._eduGroupsCache = {
      teamA: [{ id: 'groupA', name: 'Cached Group', active: true }],
    };
    context.App._eduGroupsLoadFailedByTeam = {};

    await context.App.renderEduGroupList('teamA');

    expect(container.innerHTML).toContain('Cached Group');
    expect(container.innerHTML).toContain('edu-refresh-status');
    expect(container.innerHTML).toContain('disabled');
    expect(container.innerHTML).not.toContain('App.showEduGroupForm');
    expect(container.innerHTML).not.toContain('App.deleteEduGroup');
  });

  test('cached student list stays read only when refresh falls back to cache', async () => {
    const container = { innerHTML: '' };
    const app = {
      _eduStudentsCache: {
        teamA: [
          { id: 'pendingA', name: 'Pending Student', enrollStatus: 'pending', groupIds: ['groupA'] },
          { id: 'activeA', name: 'Active Student', enrollStatus: 'active', groupIds: ['groupA'] },
        ],
      },
      _eduStudentsLoadFailedByTeam: {},
      _eduStudentListRequestSeq: 0,
      isEduClubStaff: jest.fn(() => true),
      calcAge: jest.fn(() => 10),
      getUnmatchedPendingStudents: jest.fn(() => []),
    };
    const context = {
      App: app,
      FirebaseService: {
        listEduStudents: jest.fn(async () => { throw new Error('network down'); }),
      },
      document: {
        getElementById: jest.fn((id) => id === 'edu-student-list' ? container : null),
      },
      escapeHTML,
      console,
      Promise,
    };
    vm.runInNewContext(studentSource, context, { filename: 'edu-student-list.js' });
    context.App._eduStudentsCache = {
      teamA: [
        { id: 'pendingA', name: 'Pending Student', enrollStatus: 'pending', groupIds: ['groupA'] },
        { id: 'activeA', name: 'Active Student', enrollStatus: 'active', groupIds: ['groupA'] },
      ],
    };
    context.App._eduStudentsLoadFailedByTeam = {};

    await context.App.renderEduStudentList('teamA', 'groupA');

    expect(container.innerHTML).toContain('Pending Student');
    expect(container.innerHTML).toContain('Active Student');
    expect(container.innerHTML).toContain('edu-refresh-status');
    expect(container.innerHTML).toContain('disabled');
    expect(container.innerHTML).not.toContain('App._approveFromList');
    expect(container.innerHTML).not.toContain('App._rejectFromList');
    expect(container.innerHTML).not.toContain('App.showEduAssignStudentModal');
    expect(container.innerHTML).not.toContain('App.showEduStudentForm');
    expect(container.innerHTML).not.toContain('App._removeStudentFromGroup');
  });

  test('cached unmatched student list keeps assignment disabled when refresh fails', async () => {
    const container = { innerHTML: '' };
    const pendingStudent = { id: 'pendingA', name: 'Pending Student', enrollStatus: 'pending', groupIds: [] };
    const app = {
      _eduStudentsCache: { teamA: [pendingStudent] },
      _eduStudentsLoadFailedByTeam: {},
      _eduStudentListRequestSeq: 0,
      isEduClubStaff: jest.fn(() => true),
      calcAge: jest.fn(() => 10),
      getUnmatchedPendingStudents: jest.fn(() => [pendingStudent]),
    };
    const context = {
      App: app,
      FirebaseService: {
        listEduStudents: jest.fn(async () => { throw new Error('network down'); }),
      },
      document: {
        getElementById: jest.fn((id) => id === 'edu-student-list' ? container : null),
      },
      escapeHTML,
      console,
      Promise,
    };
    vm.runInNewContext(studentSource, context, { filename: 'edu-student-list.js' });
    context.App._eduStudentsCache = { teamA: [pendingStudent] };
    context.App._eduStudentsLoadFailedByTeam = {};

    await context.App.renderEduStudentList('teamA', '__unmatched__');

    expect(container.innerHTML).toContain('Pending Student');
    expect(container.innerHTML).toContain('edu-refresh-status');
    expect(container.innerHTML).toContain('disabled');
    expect(container.innerHTML).not.toContain('App.showEduGroupPickerForStudent');
  });
});
