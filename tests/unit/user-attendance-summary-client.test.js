const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function loadLeaderboard(summary) {
  const elements = new Map();
  const sandbox = {
    App: {},
    FirebaseService: {
      getUserAttendanceSummary: jest.fn(() => summary),
    },
    ApiService: {
      getEvents: jest.fn(() => { throw new Error('historical events must not load'); }),
    },
    document: {
      getElementById: jest.fn((id) => {
        if (!elements.has(id)) elements.set(id, { textContent: '' });
        return elements.get(id);
      }),
    },
    console,
    Date,
    Map,
    Set,
    Math,
    Number,
    String,
    Object,
    Array,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('js/modules/leaderboard.js'), sandbox);
  return { app: sandbox.App, elements, sandbox };
}

function loadFirebaseServiceForSummary() {
  const sandbox = {
    console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    localStorage: {
      getItem: jest.fn(() => null),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      key: jest.fn(() => null),
      length: 0,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${read('js/firebase-service.js')}\nglobalThis.FirebaseService = FirebaseService;`, sandbox);
  return { service: sandbox.FirebaseService, sandbox };
}


function loadPersonalDashboardForRecords(ensureUserStatsLoaded) {
  const sandbox = {
    App: { currentPage: 'page-personal-dashboard' },
    FirebaseService: { ensureUserStatsLoaded },
    ApiService: { getCurrentUser: jest.fn(() => ({ uid: 'uidA' })) },
    console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('js/modules/dashboard/personal-dashboard.js'), sandbox);
  sandbox.App.renderPersonalDashboard = jest.fn();
  return { app: sandbox.App, sandbox };
}

describe('materialized user attendance summary client', () => {
  test('uses the one-document summary before the historical event fallback', () => {
    const { app, sandbox } = loadLeaderboard({
      expectedCount: 12,
      attendedCount: 10,
      completedCount: 9,
      attendRate: 83,
    });
    expect(app._calcScanStats('uidA')).toEqual({
      expectedCount: 12,
      completedCount: 9,
      attendRate: 83,
    });
    expect(sandbox.ApiService.getEvents).not.toHaveBeenCalled();
  });

  test('renders counts and yyyy/mm/dd hh:mm update time', () => {
    const { app, elements } = loadLeaderboard({
      expectedCount: 4,
      attendedCount: 3,
      completedCount: 2,
      attendRate: 75,
      updatedAt: { toDate: () => new Date(2026, 6, 11, 9, 5, 0) },
    });
    expect(app._renderUserAttendanceSummary('uidA', {
      totalId: 'total',
      doneId: 'done',
      rateId: 'rate',
      updatedId: 'updated',
    })).toBe(true);
    expect(elements.get('total').textContent).toBe(4);
    expect(elements.get('done').textContent).toBe(2);
    expect(elements.get('rate').textContent).toBe('75%');
    expect(elements.get('updated').textContent).toBe('資料更新 2026/07/11 09:05');
  });

  test('shows placeholders until the summary snapshot arrives', () => {
    const { app, elements } = loadLeaderboard(null);
    expect(app._renderUserAttendanceSummary('uidA', {
      totalId: 'total',
      doneId: 'done',
      rateId: 'rate',
      updatedId: 'updated',
    })).toBe(false);
    expect(elements.get('total').textContent).toBe('--');
    expect(elements.get('updated').textContent).toBe('資料更新 --');
  });

  test('profile entry starts only the summary and keeps full records user-triggered', () => {
    const firebaseSource = read('js/firebase-service.js');
    const navigationSource = read('js/core/navigation.js');
    expect(firebaseSource).toContain("'page-profile':            ['teams']");
    expect(firebaseSource).toContain("db.collection('userAttendanceStats').doc(targetUid)");
    expect(firebaseSource).toContain('ensureUserAttendanceSummaryLoaded(auth.currentUser.uid');
    expect(navigationSource).not.toContain("this.renderActivityRecords('all', 1)");
  });

  test('both requested record headers expose update-time targets', () => {
    const profileHtml = read('pages/profile.html');
    const profileCore = read('js/modules/profile/profile-core.js');
    expect(profileHtml).toContain('id="my-records-updated-at"');
    expect(profileCore).toContain('id="uc-records-updated-at"');
  });

  test('stopping the summary listener settles an in-flight first load', async () => {
    const { service, sandbox } = loadFirebaseServiceForSummary();
    const unsubscribe = jest.fn();
    sandbox.db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          onSnapshot: jest.fn(() => unsubscribe),
        })),
      })),
    };

    const pending = service.ensureUserAttendanceSummaryLoaded('uidA', { listen: true });
    service._stopUserAttendanceSummaryListener();

    await expect(pending).resolves.toBeNull();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(service._userAttendanceSummaryUid).toBeNull();
    expect(read('js/modules/profile/profile-core.js')).toContain("this._ucRecordUid !== uid");
    expect(read('js/modules/profile/profile-core.js')).toContain("this._ucRecordUid === uid");
  });

  test('dashboard record loading unlocks after failure so later visits retry', async () => {
    const ensureUserStatsLoaded = jest.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({});
    const { app } = loadPersonalDashboardForRecords(ensureUserStatsLoaded);

    await app._loadPersonalDashboardRecords('uidA');
    expect(app._personalDashboardRecordsLoadUid).toBeNull();
    await app._loadPersonalDashboardRecords('uidA');

    expect(ensureUserStatsLoaded).toHaveBeenCalledTimes(2);
    expect(app.renderPersonalDashboard).toHaveBeenCalledTimes(1);
    expect(app._personalDashboardRecordsLoadUid).toBeNull();
  });
});
