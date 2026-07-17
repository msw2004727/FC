const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('team form save directory safety', () => {
  test('omits members while preserving staff fields when an edit uses a partial directory', async () => {
    const existingTeam = {
      id: 'team-existing',
      name: 'Existing Club',
      captainUid: 'captain-existing',
      leaderUids: ['leader-existing'],
      coachUids: ['coach-existing'],
      members: 42,
    };
    const updateTeamAwait = jest.fn(async () => undefined);
    const verifyUserDirectorySelection = jest.fn(async requestedUids => ({
      ok: true,
      users: requestedUids.map(uid => ({ uid, name: `Verified ${uid}` })),
      missingUids: [],
      reason: 'ok',
    }));
    const values = {
      name: 'Existing Club',
      nameEn: '',
      nationality: 'TW',
      region: 'Taipei',
      founded: '',
      contact: '',
      bio: '',
      contactLinksEnabled: false,
      contactLinks: [],
      oldCaptainUid: 'captain-existing',
      oldCoachUids: ['coach-existing'],
      oldLeaderUids: ['leader-existing'],
      realLeaderUids: ['leader-existing'],
      leaderNames: ['Existing Leader', 'Legacy Name-only Leader'],
      captain: 'Existing Captain',
      captainUidForSave: 'captain-existing',
      coaches: ['Existing Coach', 'Legacy Name-only Coach'],
      newCoachUids: ['coach-existing'],
      users: [{ uid: 'unrelated-user', name: 'Unrelated User' }],
    };
    const elements = {
      'ct-team-sport-tag': { value: 'football' },
      'ct-team-type': { value: 'competitive' },
      'ct-edu-accepting': { checked: true },
      'ct-team-preview': {
        querySelector: () => null,
        style: { backgroundImage: '' },
      },
      'create-team-modal': {
        inert: false,
        classList: { contains: () => true },
        querySelectorAll: () => [],
        setAttribute: jest.fn(),
        removeAttribute: jest.fn(),
      },
    };
    const app = {
      currentPage: 'page-team-list',
      _requireProfileComplete: jest.fn(() => false),
      _extractTeamFormValues: jest.fn(() => values),
      _canEditTeamByRoleOrCaptain: jest.fn(() => true),
      _confirmTeamManagerTransfer: jest.fn(async () => true),
      _confirmTeamRoleDemotions: jest.fn(async () => true),
      _withButtonLoading: jest.fn((_button, _label, run) => run()),
      _applyTeamRoleChangesAfterSave: jest.fn(),
      closeModal: jest.fn(),
      renderTeamList: jest.fn(),
      renderAdminTeams: jest.fn(),
      renderTeamManage: jest.fn(),
      showToast: jest.fn(),
    };
    const apiService = {
      getTeam: jest.fn(() => existingTeam),
      getAdminUsers: jest.fn(() => values.users),
      verifyUserDirectorySelection,
      updateTeamAwait,
      _writeOpLog: jest.fn(),
      _writeErrorLog: jest.fn(),
    };
    const context = {
      App: app,
      ApiService: apiService,
      document: {
        getElementById: id => elements[id] || null,
      },
      firebase: {
        firestore: {
          FieldValue: {
            delete: () => ({ deleteField: true }),
          },
        },
      },
      generateId: () => 'unused',
      console,
      Object,
      Array,
      String,
      Set,
      Map,
    };
    [
      'js/modules/team/team-list-helpers.js',
      'js/modules/team/team-list-stats.js',
      'js/modules/team/team-form.js',
    ].forEach(file => {
      vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context);
    });
    app._canEditTeamByRoleOrCaptain = jest.fn(() => true);
    app._teamFormState.editId = existingTeam.id;
    app._teamFormState.leaders = ['leader-existing'];
    app._teamFormState.captain = 'captain-existing';
    app._teamFormState.coaches = ['coach-existing'];

    // The real production calculator undercounts when only the safe directory
    // subset is available; editing must therefore leave the stored count alone.
    expect(app._calcTeamMemberCountByTeam(existingTeam, values.users)).toBe(3);
    expect(existingTeam.members).toBe(42);

    verifyUserDirectorySelection.mockResolvedValueOnce({
      ok: false,
      users: [
        { uid: 'captain-existing' },
        { uid: 'coach-existing' },
      ],
      missingUids: ['leader-existing'],
      reason: 'missing',
    });
    await expect(app.handleSaveTeam()).resolves.toEqual({ ok: false, reason: 'missing' });
    expect(verifyUserDirectorySelection).toHaveBeenCalledWith([
      'leader-existing',
      'captain-existing',
      'coach-existing',
    ]);
    expect(updateTeamAwait).not.toHaveBeenCalled();
    expect(app.showToast).toHaveBeenCalled();

    const write = deferred();
    updateTeamAwait.mockImplementationOnce(() => write.promise);
    const saving = app.handleSaveTeam();
    for (let attempt = 0; attempt < 20 && updateTeamAwait.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(elements['create-team-modal'].inert).toBe(true);
    write.resolve(undefined);
    await saving;

    expect(elements['create-team-modal'].inert).toBe(false);
    expect(app.closeModal).toHaveBeenCalledWith({ allowSubmitting: true });
    expect(verifyUserDirectorySelection).toHaveBeenCalledTimes(2);
    expect(updateTeamAwait).toHaveBeenCalledTimes(1);
    const [teamId, updates] = updateTeamAwait.mock.calls[0];
    expect(teamId).toBe(existingTeam.id);
    expect(Array.from(updates.leaderUids)).toEqual(['leader-existing']);
    expect(Array.from(updates.leaderNames)).toEqual(['Existing Leader', 'Legacy Name-only Leader']);
    expect(updates.captainUid).toBe('captain-existing');
    expect(updates.captainName).toBe('Existing Captain');
    expect(Array.from(updates.coachUids)).toEqual(['coach-existing']);
    expect(Array.from(updates.coachNames)).toEqual(['Existing Coach', 'Legacy Name-only Coach']);
    expect(Object.prototype.hasOwnProperty.call(updates, 'members')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(updates, 'users')).toBe(false);
  });
});
