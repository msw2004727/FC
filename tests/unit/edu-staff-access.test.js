const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/education/edu-helpers.js'),
  'utf8'
);

function loadEduHelpersContext({ currentUser = null, teams = {}, hasPermission = () => false } = {}) {
  const app = {
    hasPermission: jest.fn(hasPermission),
    _canManageTeamMembers: jest.fn(() => true),
  };
  const api = {
    getTeam: jest.fn(id => teams[id] || null),
    getCurrentUser: jest.fn(() => currentUser),
  };
  const context = {
    App: app,
    ApiService: api,
    Object,
    Array,
    String,
    Number,
    Date,
    Math,
    Set,
    parseInt,
    isNaN,
  };

  vm.runInNewContext(source, context, { filename: 'edu-helpers.js' });
  return { app: context.App, api };
}

describe('education staff access', () => {
  const team = {
    id: 'teamA',
    captainUid: 'captain_uid',
    leaderUid: 'single_leader_uid',
    leaderUids: ['leader_uid'],
    coachUids: ['coach_uid'],
    creatorUid: 'creator_uid',
    ownerUid: 'owner_uid',
  };

  test.each([
    ['captainUid', 'captain_uid'],
    ['leaderUid', 'single_leader_uid'],
    ['leaderUids', 'leader_uid'],
    ['coachUids', 'coach_uid'],
    ['creatorUid', 'creator_uid'],
    ['ownerUid', 'owner_uid'],
  ])('_isEduTeamStaffUid accepts %s', (_label, uid) => {
    const { app } = loadEduHelpersContext();
    expect(app._isEduTeamStaffUid(team, uid)).toBe(true);
  });

  test('_isEduTeamStaffUid rejects unrelated or empty users', () => {
    const { app } = loadEduHelpersContext();
    expect(app._isEduTeamStaffUid(team, 'user_uid')).toBe(false);
    expect(app._isEduTeamStaffUid(team, '')).toBe(false);
    expect(app._isEduTeamStaffUid(null, 'captain_uid')).toBe(false);
  });

  test.each([
    ['captain', 'captain_uid'],
    ['single leader', 'single_leader_uid'],
    ['leader array member', 'leader_uid'],
    ['coach', 'coach_uid'],
    ['creator', 'creator_uid'],
    ['owner', 'owner_uid'],
  ])('isEduClubStaff allows %s through the same staff matrix', (_label, uid) => {
    const { app } = loadEduHelpersContext({ currentUser: { uid, role: 'user' } });
    expect(app.isEduClubStaff(team)).toBe(true);
    expect(app._canManageTeamMembers).not.toHaveBeenCalled();
  });

  test('isEduClubStaff resolves team id through ApiService.getTeam', () => {
    const { app, api } = loadEduHelpersContext({
      currentUser: { uid: 'owner_uid', role: 'user' },
      teams: { teamA: team },
    });

    expect(app.isEduClubStaff('teamA')).toBe(true);
    expect(api.getTeam).toHaveBeenCalledWith('teamA');
  });

  test('admin without team.manage_all is not treated as course staff', () => {
    const { app } = loadEduHelpersContext({ currentUser: { uid: 'admin_uid', role: 'admin' } });

    expect(app.isEduClubStaff(team)).toBe(false);
    expect(app.hasPermission).toHaveBeenCalledWith('team.manage_all');
    expect(app._canManageTeamMembers).not.toHaveBeenCalled();
  });

  test('admin with team.manage_all is treated as course staff', () => {
    const { app } = loadEduHelpersContext({
      currentUser: { uid: 'admin_uid', role: 'admin' },
      hasPermission: code => code === 'team.manage_all',
    });

    expect(app.isEduClubStaff(team)).toBe(true);
  });

  test('current user grant with team.manage_all is treated as course staff', () => {
    const { app } = loadEduHelpersContext({
      currentUser: { uid: 'user_uid', role: 'user' },
      hasPermission: code => code === 'team.manage_all',
    });

    expect(app.isEduClubStaff(team)).toBe(true);
  });

  test('super_admin is treated as course staff', () => {
    const { app } = loadEduHelpersContext({ currentUser: { uid: 'super_uid', role: 'super_admin' } });

    expect(app.isEduClubStaff(team)).toBe(true);
    expect(app.hasPermission).not.toHaveBeenCalled();
  });

  test('regular user and missing team are rejected', () => {
    const { app } = loadEduHelpersContext({ currentUser: { uid: 'user_uid', role: 'user' } });

    expect(app.isEduClubStaff(team)).toBe(false);
    expect(app.isEduClubStaff(null)).toBe(false);
  });
});