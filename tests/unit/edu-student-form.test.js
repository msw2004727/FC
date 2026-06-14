const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const source = fs.readFileSync(
  path.join(ROOT, 'js/modules/education/edu-student-form.js'),
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

function loadEduStudentFormApp({ users = [], team = null } = {}) {
  const firebaseService = {
    createEduStudent: jest.fn(async (_teamId, data) => ({ ...data, _docId: data.id })),
    updateEduStudent: jest.fn(async (_teamId, studentId, updates) => ({ id: studentId, ...updates })),
  };
  const app = {
    _eduStudentsCache: {},
    getEduStudents(teamId) {
      return this._eduStudentsCache[teamId] || [];
    },
    getEduGroups() {
      return [{ id: 'g1', name: 'A 組' }];
    },
    _generateEduId: jest.fn(() => 'stu-new'),
    _isUserInTeam: (user, teamId) => Array.isArray(user.teamIds)
      ? user.teamIds.includes(teamId)
      : user.teamId === teamId,
    calcAge: jest.fn(() => null),
    showToast: jest.fn(),
    _updateGroupMemberCounts: jest.fn(),
    renderEduStudentList: jest.fn(),
  };
  const context = {
    App: app,
    ApiService: {
      getAdminUsers: jest.fn(() => users),
      getTeam: jest.fn(() => team),
    },
    FirebaseService: firebaseService,
    document: {
      getElementById: jest.fn(() => null),
    },
    escapeHTML,
    console,
    Date,
    Object,
    Array,
    String,
    Set,
    Map,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'edu-student-form.js' });
  return { app, firebaseService };
}

describe('education group assign student modal', () => {
  test('combines club members and students while excluding people already in the group', () => {
    const users = [
      { uid: 'u-linked', name: 'Linked Member', teamIds: ['teamA'] },
      { uid: 'u-member', name: 'Roster Only', teamIds: ['teamA'] },
      { uid: 'u-coach', name: 'Coach Only' },
      { uid: 'u-in-group', name: 'Already Grouped', teamIds: ['teamA'] },
      { uid: 'u-other', name: 'Other Team', teamIds: ['teamB'] },
    ];
    const { app } = loadEduStudentFormApp({ users, team: { id: 'teamA', coachUids: ['u-coach'] } });
    const students = [
      { id: 'stu-linked', name: 'Linked Student', selfUid: 'u-linked', enrollStatus: 'active', groupIds: [] },
      { id: 'stu-pending', name: 'Pending Student', enrollStatus: 'pending', groupIds: [] },
      { id: 'stu-in-group', name: 'Already Grouped Student', selfUid: 'u-in-group', enrollStatus: 'active', groupIds: ['g1'] },
      { id: 'stu-inactive', name: 'Inactive Student', enrollStatus: 'inactive', groupIds: [] },
    ];

    const candidates = app._buildEduAssignStudentCandidates('teamA', 'g1', students);
    const names = candidates.map(candidate => candidate.name);

    expect(names).toEqual(expect.arrayContaining(['Linked Student', 'Pending Student', 'Roster Only', 'Coach Only']));
    expect(names).not.toContain('Already Grouped');
    expect(names).not.toContain('Already Grouped Student');
    expect(names).not.toContain('Inactive Student');
    expect(names).not.toContain('Other Team');

    const linked = candidates.find(candidate => candidate.id === 'stu-linked');
    expect(linked).toMatchObject({ isStudent: true, isMember: true, sourceType: 'both' });

    const rosterOnly = candidates.find(candidate => candidate.name === 'Roster Only');
    expect(rosterOnly).toMatchObject({ isStudent: false, isMember: true, sourceType: 'member' });
  });

  test('creates a student record before assigning a roster-only member to a group', async () => {
    const { app, firebaseService } = loadEduStudentFormApp({
      users: [{ uid: 'u-member', name: 'Roster Only', teamIds: ['teamA'], gender: 'female' }],
    });
    app._eduStudentsCache.teamA = [];
    const candidates = app._buildEduAssignStudentCandidates('teamA', 'g1', []);
    app._setEduAssignStudentCandidates(candidates);
    const rosterOnly = candidates.find(candidate => candidate.name === 'Roster Only');

    await app._assignStudentToGroup('teamA', rosterOnly.id, 'g1');

    expect(firebaseService.createEduStudent).toHaveBeenCalledWith('teamA', expect.objectContaining({
      id: 'stu-new',
      name: 'Roster Only',
      selfUid: 'u-member',
      gender: 'female',
      enrollStatus: 'active',
      groupIds: ['g1'],
      groupNames: ['A 組'],
    }));
    expect(firebaseService.updateEduStudent).not.toHaveBeenCalled();
    expect(app._eduStudentsCache.teamA[0]).toMatchObject({
      id: 'stu-new',
      selfUid: 'u-member',
      groupIds: ['g1'],
    });
  });
});
