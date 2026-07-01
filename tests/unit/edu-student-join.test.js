const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-student-join.js'),
  'utf8'
);

function userMatchesUid(user, uid) {
  return [user?.uid, user?.lineUserId, user?._docId, user?.id]
    .map(value => String(value || '').trim())
    .includes(uid);
}

function loadEduStudentJoinContext(options = {}) {
  const student = options.student || {
    id: 'stuA',
    selfUid: 'uidStudent',
    enrollStatus: 'pending',
  };
  const defaultUser = {
    uid: 'uidStudent',
    _docId: 'userDoc',
    teamId: 'oldTeam',
    teamName: 'Old Team',
    teamIds: ['oldTeam'],
    teamNames: ['Old Team'],
  };
  const user = Object.prototype.hasOwnProperty.call(options, 'user') ? options.user : defaultUser;
  const team = options.team || { id: 'teamA', name: 'Club A' };
  const currentUser = options.currentUser || null;
  const userList = options.users || (user ? [user] : []);

  const app = {
    _eduStudentsCache: { teamA: [student] },
    _loadEduStudents: jest.fn(async teamId => app._eduStudentsCache[teamId] || []),
    _updateGroupMemberCounts: jest.fn(),
    _refreshEduDetailStudentState: jest.fn(),
    syncEduChildBinding: jest.fn(async () => {}),
    _calcTeamMemberCount: jest.fn(() => options.memberCount ?? 1),
    showToast: jest.fn(),
  };
  const firebaseService = {
    _ensureAuth: jest.fn(async () => options.authed ?? true),
    updateEduStudent: jest.fn(async () => ({})),
    updateUser: jest.fn(async () => ({})),
  };
  const apiService = {
    getUserByUid: jest.fn(uid => userList.find(candidate => userMatchesUid(candidate, uid)) || null),
    getCurrentUser: jest.fn(() => currentUser),
    getAdminUsers: jest.fn(() => userList),
    getTeam: jest.fn(teamId => (teamId === team.id ? team : null)),
    getTeamAsync: jest.fn(async teamId => (teamId === team.id ? team : null)),
    updateTeam: jest.fn(),
  };
  const dbGet = options.dbGet || jest.fn(async () => ({
    exists: !!options.liveUser,
    data: () => options.liveUser || {},
  }));
  const db = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ get: dbGet })),
    })),
  };
  const context = {
    App: app,
    ApiService: apiService,
    FirebaseService: firebaseService,
    db,
    console,
    Object,
    Array,
    String,
    Number,
    Set,
    Map,
    Date,
    Error,
  };

  vm.runInNewContext(source, context, { filename: 'edu-student-join.js' });
  return { app, firebaseService, apiService, dbGet, user, student };
}

describe('edu student approval membership sync', () => {
  test('approved self student is also added to club membership', async () => {
    const { app, firebaseService, apiService, user, student } = loadEduStudentJoinContext({ memberCount: 2 });

    const result = await app.approveEduStudent('teamA', 'stuA');

    expect(result).toBe(true);
    expect(firebaseService.updateUser).toHaveBeenCalledWith('userDoc', {
      teamId: 'oldTeam',
      teamName: 'Old Team',
      teamIds: ['oldTeam', 'teamA'],
      teamNames: ['Old Team', 'Club A'],
    });
    expect(user.teamIds).toEqual(['oldTeam', 'teamA']);
    expect(firebaseService.updateEduStudent).toHaveBeenCalledWith('teamA', 'stuA', expect.objectContaining({
      enrollStatus: 'active',
    }));
    expect(student.enrollStatus).toBe('active');
    expect(apiService.updateTeam).toHaveBeenCalledWith('teamA', { members: 2 });
    expect(app.syncEduChildBinding).toHaveBeenCalledWith('teamA', 'stuA');
  });

  test('already joined student approval does not duplicate membership write', async () => {
    const user = {
      uid: 'uidStudent',
      _docId: 'userDoc',
      teamId: 'teamA',
      teamName: 'Club A',
      teamIds: ['teamA'],
      teamNames: ['Club A'],
    };
    const { app, firebaseService } = loadEduStudentJoinContext({ user });

    const result = await app.approveEduStudent('teamA', 'stuA');

    expect(result).toBe(true);
    expect(firebaseService.updateUser).not.toHaveBeenCalled();
    expect(firebaseService.updateEduStudent).toHaveBeenCalledWith('teamA', 'stuA', expect.objectContaining({
      enrollStatus: 'active',
    }));
    expect(user.teamIds).toEqual(['teamA']);
  });

  test('parent-owned child approval does not add the parent as player member', async () => {
    const parentUser = { uid: 'parentUid', _docId: 'parentDoc' };
    const childStudent = {
      id: 'stuChild',
      parentUid: 'parentUid',
      enrollStatus: 'pending',
    };
    const { app, firebaseService } = loadEduStudentJoinContext({
      student: childStudent,
      user: parentUser,
    });

    const result = await app.approveEduStudent('teamA', 'stuChild', { applicantUid: 'parentUid' });

    expect(result).toBe(true);
    expect(firebaseService.updateUser).not.toHaveBeenCalled();
    expect(firebaseService._ensureAuth).not.toHaveBeenCalled();
    expect(firebaseService.updateEduStudent).toHaveBeenCalledWith('teamA', 'stuChild', expect.objectContaining({
      enrollStatus: 'active',
    }));
    expect(childStudent.enrollStatus).toBe('active');
  });

  test('self student approval fails before activation when the linked user cannot be found', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { app, firebaseService, student } = loadEduStudentJoinContext({ user: null, users: [] });

      const result = await app.approveEduStudent('teamA', 'stuA');

      expect(result).toBe(false);
      expect(firebaseService.updateUser).not.toHaveBeenCalled();
      expect(firebaseService.updateEduStudent).not.toHaveBeenCalled();
      expect(student.enrollStatus).toBe('pending');
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('legacy self application can use applicant uid fallback when the student lacks selfUid', async () => {
    const legacyStudent = { id: 'stuLegacy', enrollStatus: 'pending' };
    const { app, firebaseService } = loadEduStudentJoinContext({ student: legacyStudent });

    const result = await app.approveEduStudent('teamA', 'stuLegacy', { applicantUid: 'uidStudent', teamName: 'Club A' });

    expect(result).toBe(true);
    expect(firebaseService.updateUser).toHaveBeenCalledWith('userDoc', expect.objectContaining({
      teamIds: ['oldTeam', 'teamA'],
      teamNames: ['Old Team', 'Club A'],
    }));
    expect(firebaseService.updateEduStudent).toHaveBeenCalledWith('teamA', 'stuLegacy', expect.objectContaining({
      enrollStatus: 'active',
    }));
  });
});
