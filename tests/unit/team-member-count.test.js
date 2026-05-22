const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');

function loadTeamCountApp(app = {}) {
  const context = {
    App: app,
    ApiService: {
      getAdminUsers: () => [],
      getCurrentUser: () => ({ uid: 'viewer' }),
      getTeam: () => null,
    },
    console,
    Object,
    Array,
    String,
    Number,
    Set,
    Map,
    URL,
  };
  [
    'js/modules/team/team-list-helpers.js',
    'js/modules/team/team-list-stats.js',
  ].forEach(file => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInNewContext(source, context);
  });
  return app;
}

describe('team member count', () => {
  test('counts active extra students and deduplicates linked user students', () => {
    const app = loadTeamCountApp({
      _eduStudentsCache: {
        teamA: [
          { id: 'stu-cache', name: '快取學員', enrollStatus: 'active' },
          { id: 'stu-linked', name: '正式隊員學員', selfUid: 'member', enrollStatus: 'active' },
          { id: 'stu-pending', name: '待審核學員', enrollStatus: 'pending' },
        ],
      },
    });
    const users = [
      { uid: 'member', name: '正式隊員', teamId: 'teamA' },
      { uid: 'captain', name: '經理' },
    ];
    const team = {
      id: 'teamA',
      captainUid: 'captain',
      students: [
        { id: 'stu-direct', name: '手動新增學員', enrollStatus: 'active' },
        { id: 'stu-removed', name: '移除學員', enrollStatus: 'removed' },
      ],
    };

    expect(app._calcTeamMemberCountByTeam(team, users)).toBe(4);
    expect(app._buildTeamMemberCountMap([team], users).get('teamA')).toBe(4);
  });
});
