const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function createElement(initial = {}) {
  const classes = new Set();
  return {
    value: '',
    checked: true,
    innerHTML: '',
    textContent: '',
    dataset: {},
    style: {},
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, force) => {
        if (force === true) classes.add(name);
        else if (force === false) classes.delete(name);
        else if (classes.has(name)) classes.delete(name);
        else classes.add(name);
      },
      contains: name => classes.has(name),
    },
    appendChild: jest.fn(),
    querySelector: jest.fn(() => null),
    querySelectorAll: jest.fn(() => []),
    setAttribute: jest.fn(),
    getAttribute: jest.fn(() => null),
    ...initial,
  };
}

function loadTeamForm({
  team,
  users = [],
  currentUser = { uid: 'captain-existing', name: 'Existing Captain' },
  ensureUserDirectoryReady = async () => true,
  verifyUserDirectorySelection = null,
} = {}) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    querySelectorAll: jest.fn(() => []),
    createElement: jest.fn(() => createElement()),
  };
  document.getElementById('ct-team-name').value = team?.name || 'Existing Club';
  document.getElementById('ct-team-name-en').value = team?.nameEn || '';
  document.getElementById('ct-team-nationality').value = team?.nationality || 'TW';
  document.getElementById('ct-team-region').value = team?.region || 'Taipei';
  document.getElementById('ct-team-founded').value = team?.founded || '';
  document.getElementById('ct-team-contact').value = team?.contact || '';
  document.getElementById('ct-team-bio').value = team?.bio || '';
  document.getElementById('ct-team-sport-tag').value = team?.sportTag || 'football';
  document.getElementById('ct-team-type').value = team?.type || 'competitive';

  const showModal = jest.fn(id => document.getElementById(id).classList.add('open'));
  const app = {
    currentPage: 'page-team-detail',
    _canEditTeamByRoleOrCaptain: jest.fn(() => true),
    _getTeamTypeHandler: jest.fn(() => ({ showEduSettings: false })),
    _getTeamContactLinksFormData: jest.fn(() => ({ enabled: false, links: [] })),
    _setTeamContactLinksFormData: jest.fn(),
    hasPermission: jest.fn(() => false),
    showModal,
    showToast: jest.fn(),
  };
  const verifyDirectorySelection = verifyUserDirectorySelection || (async requestedUids => {
    const safeUids = requestedUids.map(value => String(value || '').trim()).filter(Boolean);
    const verifiedUsers = users.filter(user => safeUids.includes(String(user?.uid || user?._docId || '').trim()));
    const verifiedIds = new Set(verifiedUsers.flatMap(user => [user?.uid, user?._docId].filter(Boolean).map(String)));
    const missingUids = safeUids.filter(uid => !verifiedIds.has(uid));
    return { ok: missingUids.length === 0, users: verifiedUsers, missingUids, reason: missingUids.length ? 'missing' : 'ok' };
  });
  const apiService = {
    ensureUserDirectoryReady: jest.fn(ensureUserDirectoryReady),
    getUserDirectory: jest.fn(() => users),
    verifyUserDirectorySelection: jest.fn(verifyDirectorySelection),
    getCurrentUser: jest.fn(() => currentUser),
    getTeam: jest.fn(id => (id === team?.id ? team : null)),
  };
  const context = {
    App: app,
    ApiService: apiService,
    document,
    window: {},
    console,
    Object,
    Array,
    String,
    Number,
    Set,
    Map,
    Promise,
    setTimeout,
    clearTimeout,
    EVENT_SPORT_OPTIONS: [],
    SPORT_ICON_EMOJI: {},
    TW_REGIONS_WITH_OTHER: [],
    escapeHTML: value => String(value ?? ''),
  };
  [
    'js/modules/team/team-form.js',
    'js/modules/team/team-form-init.js',
    'js/modules/team/team-form-search.js',
    'js/modules/team/team-form-validate.js',
  ].forEach(file => {
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context);
  });

  return { app, apiService, document, showModal };
}

describe('team form directory safety', () => {
  const existingTeam = {
    id: 'team-existing',
    name: 'Existing Club',
    region: 'Taipei',
    sportTag: 'football',
    leaderUids: ['leader-existing'],
    leaderNames: ['Existing Leader'],
    captainUid: 'captain-existing',
    captainName: 'Existing Captain',
    coachUids: ['coach-existing'],
    coachNames: ['Existing Coach'],
  };

  test('waits for the user directory and preserves existing staff UIDs and names when it remains partial', async () => {
    const directoryLoad = deferred();
    const { app, apiService, showModal } = loadTeamForm({
      team: existingTeam,
      users: [{ uid: 'unrelated-user', name: 'Unrelated User' }],
      ensureUserDirectoryReady: () => directoryLoad.promise,
    });

    const opening = app.showTeamForm(existingTeam.id);

    expect(apiService.ensureUserDirectoryReady).toHaveBeenCalledTimes(1);
    expect(app.showToast).toHaveBeenCalledWith('正在載入用戶資料…');
    expect(showModal).not.toHaveBeenCalled();
    expect(app._teamFormState.editId).toBeNull();

    directoryLoad.resolve(false);
    await expect(opening).resolves.toEqual({ ok: true });

    expect(showModal).toHaveBeenCalledWith('create-team-modal');
    expect(app.showToast).toHaveBeenCalledWith('用戶資料載入失敗；表單仍可編輯，若搜尋不到請關閉後重試');
    expect(Array.from(app._teamFormState.leaders)).toEqual(['leader-existing']);
    expect(app._teamFormState.captain).toBe('captain-existing');
    expect(Array.from(app._teamFormState.coaches)).toEqual(['coach-existing']);
    expect({ ...app._teamFormState.staffNameHints }).toEqual({
      'leader-existing': 'Existing Leader',
      'captain-existing': 'Existing Captain',
      'coach-existing': 'Existing Coach',
    });

    const values = app._extractTeamFormValues();
    expect(Array.from(values.realLeaderUids)).toEqual(['leader-existing']);
    expect(Array.from(values.leaderNames)).toEqual(['Existing Leader']);
    expect(values.captainUidForSave).toBe('captain-existing');
    expect(values.captain).toBe('Existing Captain');
    expect(Array.from(values.newCoachUids)).toEqual(['coach-existing']);
    expect(Array.from(values.coaches)).toEqual(['Existing Coach']);
  });

  test('preserves unmatched name-only staff caches until they are explicitly removed or replaced', async () => {
    const nameOnlyTeam = {
      ...existingTeam,
      leaderUids: [],
      leaderNames: ['Legacy Leader'],
      captainUid: '',
      captainName: 'Legacy Captain',
      coachUids: [],
      coachNames: ['Legacy Coach'],
    };
    const { app, document } = loadTeamForm({
      team: nameOnlyTeam,
      users: [{ uid: 'unrelated-user', name: 'Unrelated User' }],
      ensureUserDirectoryReady: async () => false,
    });

    await expect(app.showTeamForm(nameOnlyTeam.id)).resolves.toEqual({ ok: true });

    expect(Array.from(app._teamFormState.leaders)).toEqual([]);
    expect(app._teamFormState.captain).toBeNull();
    expect(Array.from(app._teamFormState.coaches)).toEqual([]);
    expect({
      leaders: Array.from(app._teamFormState.unresolvedStaffNames.leaders),
      captain: app._teamFormState.unresolvedStaffNames.captain,
      coaches: Array.from(app._teamFormState.unresolvedStaffNames.coaches),
    }).toEqual({
      leaders: ['Legacy Leader'],
      captain: 'Legacy Captain',
      coaches: ['Legacy Coach'],
    });
    expect(document.getElementById('ct-leaders-tags').innerHTML).toContain('Legacy Leader');
    expect(document.getElementById('ct-coach-tags').innerHTML).toContain('Legacy Coach');

    let values = app._extractTeamFormValues();
    expect(Array.from(values.realLeaderUids)).toEqual([]);
    expect(Array.from(values.leaderNames)).toEqual(['Legacy Leader']);
    expect(values.captainUidForSave).toBeNull();
    expect(values.captain).toBe('Legacy Captain');
    expect(Array.from(values.newCoachUids)).toEqual([]);
    expect(Array.from(values.coaches)).toEqual(['Legacy Coach']);

    app._removeUnresolvedTeamStaffName('leaders', 0);
    app._removeUnresolvedTeamStaffName('coaches', 0);
    values = app._extractTeamFormValues();
    expect(Array.from(values.leaderNames)).toEqual([]);
    expect(Array.from(values.coaches)).toEqual([]);
  });
  test('does not infer staff UIDs when legacy names match directory users', async () => {
    const sameNameTeam = {
      ...existingTeam,
      leaderUids: [],
      leaderNames: ['Legacy Leader'],
      captainUid: '',
      captainName: 'Legacy Captain',
      coachUids: [],
      coachNames: ['Legacy Coach'],
    };
    const { app } = loadTeamForm({
      team: sameNameTeam,
      users: [
        { uid: 'directory-leader', name: 'Legacy Leader' },
        { uid: 'directory-captain', name: 'Legacy Captain' },
        { uid: 'directory-coach', name: 'Legacy Coach' },
      ],
    });

    await expect(app.showTeamForm(sameNameTeam.id)).resolves.toEqual({ ok: true });

    expect(Array.from(app._teamFormState.leaders)).toEqual([]);
    expect(app._teamFormState.captain).toBeNull();
    expect(Array.from(app._teamFormState.coaches)).toEqual([]);
    expect({
      leaders: Array.from(app._teamFormState.unresolvedStaffNames.leaders),
      captain: app._teamFormState.unresolvedStaffNames.captain,
      coaches: Array.from(app._teamFormState.unresolvedStaffNames.coaches),
    }).toEqual({
      leaders: ['Legacy Leader'],
      captain: 'Legacy Captain',
      coaches: ['Legacy Coach'],
    });

    const values = app._extractTeamFormValues();
    expect(Array.from(values.realLeaderUids)).toEqual([]);
    expect(values.captainUidForSave).toBeNull();
    expect(Array.from(values.newCoachUids)).toEqual([]);

    await app.selectTeamCaptain('directory-captain');
    expect(app._teamFormState.captain).toBe('directory-captain');
    app.clearTeamCaptain();
    expect(app._teamFormState.captain).toBeNull();
    expect(app._teamFormState.unresolvedStaffNames.captain).toBe('Legacy Captain');
  });

  test('rejects cached picker users when fresh verification reports them missing', async () => {
    const cachedUser = { uid: 'cached-staff', name: 'Cached Staff' };
    const { app, apiService } = loadTeamForm({
      team: existingTeam,
      users: [cachedUser],
    });
    await app.showTeamForm(existingTeam.id);
    app.showToast.mockClear();
    apiService.verifyUserDirectorySelection.mockResolvedValue({
      ok: false,
      users: [],
      missingUids: [cachedUser.uid],
      reason: 'missing',
    });

    const initialLeaders = Array.from(app._teamFormState.leaders);
    const initialCaptain = app._teamFormState.captain;
    const initialCoaches = Array.from(app._teamFormState.coaches);
    await expect(app.selectTeamLeader(cachedUser.uid)).resolves.toEqual({ ok: false, reason: 'missing' });
    await expect(app.selectTeamCaptain(cachedUser.uid)).resolves.toEqual({ ok: false, reason: 'missing' });
    await expect(app.selectTeamCoach(cachedUser.uid)).resolves.toEqual({ ok: false, reason: 'missing' });

    expect(apiService.verifyUserDirectorySelection).toHaveBeenCalledTimes(3);
    expect(apiService.verifyUserDirectorySelection).toHaveBeenNthCalledWith(1, [cachedUser.uid]);
    expect(apiService.verifyUserDirectorySelection).toHaveBeenNthCalledWith(2, [cachedUser.uid]);
    expect(apiService.verifyUserDirectorySelection).toHaveBeenNthCalledWith(3, [cachedUser.uid]);
    expect(Array.from(app._teamFormState.leaders)).toEqual(initialLeaders);
    expect(app._teamFormState.captain).toBe(initialCaptain);
    expect(Array.from(app._teamFormState.coaches)).toEqual(initialCoaches);
    expect(app.showToast).toHaveBeenCalledTimes(3);
  });

  test('ignores a late picker verification after the form session becomes stale', async () => {
    const verification = deferred();
    const cachedUser = { uid: 'cached-late', name: 'Cached Late User' };
    const { app, apiService, document } = loadTeamForm({
      team: existingTeam,
      users: [cachedUser],
      verifyUserDirectorySelection: () => verification.promise,
    });
    await app.showTeamForm(existingTeam.id);
    app.showToast.mockClear();

    const selecting = app.selectTeamLeader(cachedUser.uid);
    expect(apiService.verifyUserDirectorySelection).toHaveBeenCalledWith([cachedUser.uid]);
    app._teamFormRequestSeq += 1;
    app._teamFormState.editId = 'team-other';
    document.getElementById('create-team-modal').classList.remove('open');
    verification.resolve({ ok: true, users: [cachedUser], missingUids: [], reason: 'ok' });

    await expect(selecting).resolves.toEqual({ ok: false, reason: 'stale' });
    expect(Array.from(app._teamFormState.leaders)).not.toContain(cachedUser.uid);
    expect(app.showToast).not.toHaveBeenCalled();
  });

  test('keeps staff names aligned with sparse legacy UID arrays', async () => {
    const sparseTeam = {
      ...existingTeam,
      leaderUids: ['', 'leader-existing'],
      leaderNames: ['Wrong Leader', 'Existing Leader'],
      coachUids: ['', 'coach-existing'],
      coachNames: ['Wrong Coach', 'Existing Coach'],
    };
    const { app } = loadTeamForm({
      team: sparseTeam,
      users: [{ uid: 'unrelated-user', name: 'Unrelated User' }],
      ensureUserDirectoryReady: async () => false,
    });

    await expect(app.showTeamForm(sparseTeam.id)).resolves.toEqual({ ok: true });

    expect(Array.from(app._teamFormState.leaders)).toEqual(['leader-existing']);
    expect(Array.from(app._teamFormState.coaches)).toEqual(['coach-existing']);
    expect(app._teamFormState.staffNameHints['leader-existing']).toBe('Existing Leader');
    expect(app._teamFormState.staffNameHints['coach-existing']).toBe('Existing Coach');
    const values = app._extractTeamFormValues();
    expect(Array.from(app._teamFormState.unresolvedStaffNames.leaders)).toEqual(['Wrong Leader']);
    expect(Array.from(app._teamFormState.unresolvedStaffNames.coaches)).toEqual(['Wrong Coach']);
    expect(Array.from(values.leaderNames)).toEqual(['Existing Leader', 'Wrong Leader']);
    expect(Array.from(values.coaches)).toEqual(['Existing Coach', 'Wrong Coach']);
  });
  test('ignores a completed directory load after navigation makes the form request stale', async () => {
    const directoryLoad = deferred();
    const { app, showModal } = loadTeamForm({
      team: existingTeam,
      ensureUserDirectoryReady: () => directoryLoad.promise,
    });

    const opening = app.showTeamForm(existingTeam.id);
    app.currentPage = 'page-home';
    directoryLoad.resolve(true);

    await expect(opening).resolves.toEqual({ ok: false, reason: 'stale' });
    expect(showModal).not.toHaveBeenCalled();
    expect(app._teamFormState.editId).toBeNull();
  });
});
