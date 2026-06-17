/**
 * @jest-environment jsdom
 */

/**
 * 名單加速第一輪（docs/activity-roster-loading-optimization-plan-v0.1.md §7/§8）
 * - P1 rosterProjectionFirst：投影快顯決策 _shouldPaintDetailRosterProjectionFirst
 * - P2 deferAttendanceRecords：出席資料載入決策 _shouldLoadDetailAttendanceData + listener 延後 wiring
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function loadAttendanceModule({
  flags = { rosterProjectionFirst: true, deferAttendanceRecords: true },
  fetchedServerEvents = [],
  hasPermission = () => false,
  canOperateEventSite = null,
} = {}) {
  const app = {};
  const context = {
    App: app,
    ApiService: {
      _fetchedRegistrationServerIds: new Set(fetchedServerEvents),
      getEvent: jest.fn(() => null),
      getRegistrationsByEvent: jest.fn(() => []),
      getAttendanceRecords: jest.fn(() => []),
      getCurrentUser: jest.fn(() => ({ uid: 'user-1' })),
    },
    FirebaseService: {
      requestDetailAttendanceRealtime: jest.fn(),
    },
    shouldUseActivityDetailOptimization: jest.fn((name) => flags[name] === true),
    escapeHTML: (value) => String(value ?? ''),
    isNoShowFeatureEnabled: () => true,
    console,
    document,
    window,
    setTimeout,
    clearTimeout,
    performance,
  };
  vm.runInNewContext(readProjectFile('js/modules/event/event-manage-attendance.js'), context, {
    filename: 'js/modules/event/event-manage-attendance.js',
  });
  if (canOperateEventSite) app._canOperateEventSite = canOperateEventSite;
  app.hasPermission = hasPermission;
  return { app, context };
}

describe('P1 rosterProjectionFirst — projection preview decision', () => {
  const detailOpts = { mode: 'detail' };
  const event = { id: 'evt-1', status: 'open' };

  test('paints projection first on detail container when no per-event server proof exists', () => {
    const { app } = loadAttendanceModule();
    expect(app._shouldPaintDetailRosterProjectionFirst('evt-1', event, 'detail-attendance-table', detailOpts)).toBe(true);
  });

  test('does not paint projection for skipFetch patches (mutation cache priority, plan constraint 10)', () => {
    const { app } = loadAttendanceModule();
    expect(app._shouldPaintDetailRosterProjectionFirst('evt-1', event, 'detail-attendance-table', { mode: 'detail', skipFetch: true })).toBe(false);
  });

  test('does not paint projection once the event has per-event server proof', () => {
    const { app } = loadAttendanceModule({ fetchedServerEvents: ['evt-1'] });
    expect(app._shouldPaintDetailRosterProjectionFirst('evt-1', event, 'detail-attendance-table', detailOpts)).toBe(false);
  });

  test('does not paint projection when the flag is off or container is not the detail roster', () => {
    const { app } = loadAttendanceModule({ flags: { rosterProjectionFirst: false, deferAttendanceRecords: true } });
    expect(app._shouldPaintDetailRosterProjectionFirst('evt-1', event, 'detail-attendance-table', detailOpts)).toBe(false);

    const { app: app2 } = loadAttendanceModule();
    expect(app2._shouldPaintDetailRosterProjectionFirst('evt-1', event, 'attendance-table-container', detailOpts)).toBe(false);
    expect(app2._shouldPaintDetailRosterProjectionFirst('evt-1', event, 'detail-attendance-table', {})).toBe(false);
  });

  test('does not paint projection while the roster is being edited', () => {
    const { app } = loadAttendanceModule();
    app._attendanceEditingEventId = 'evt-1';
    expect(app._shouldPaintDetailRosterProjectionFirst('evt-1', event, 'detail-attendance-table', detailOpts)).toBe(false);
  });
});

describe('P2 deferAttendanceRecords — attendance data load decision', () => {
  test('ongoing event + normal user does not load attendance data on first screen', () => {
    const { app } = loadAttendanceModule();
    expect(app._shouldLoadDetailAttendanceData({ id: 'evt-1', status: 'open' })).toBe(false);
  });

  test('detail attendance on-demand suppresses attendance data until the roster panel is opened', () => {
    const { app } = loadAttendanceModule({
      flags: {
        rosterProjectionFirst: true,
        deferAttendanceRecords: true,
        detailAttendanceOnDemand: true,
      },
      canOperateEventSite: () => true,
    });
    expect(app._shouldLoadDetailAttendanceData({ id: 'evt-1', status: 'ended' })).toBe(false);

    app._detailAttendanceOnDemandEventId = 'evt-1';
    expect(app._shouldLoadDetailAttendanceData({ id: 'evt-1', status: 'ended' })).toBe(true);
  });

  test('ended or cancelled events still load attendance data', () => {
    const { app } = loadAttendanceModule();
    expect(app._shouldLoadDetailAttendanceData({ id: 'evt-1', status: 'ended' })).toBe(true);
    expect(app._shouldLoadDetailAttendanceData({ id: 'evt-1', status: 'cancelled' })).toBe(true);
  });

  test('site managers and no-show permission holders still load attendance data', () => {
    const { app } = loadAttendanceModule({ canOperateEventSite: () => true });
    expect(app._shouldLoadDetailAttendanceData({ id: 'evt-1', status: 'open' })).toBe(true);

    const { app: app2 } = loadAttendanceModule({ hasPermission: (code) => code === 'activity.view_noshow' });
    expect(app2._shouldLoadDetailAttendanceData({ id: 'evt-1', status: 'open' })).toBe(true);
  });

  test('roster editing keeps attendance data loading', () => {
    const { app } = loadAttendanceModule();
    app._attendanceEditingEventId = 'evt-1';
    expect(app._shouldLoadDetailAttendanceData({ id: 'evt-1', status: 'open' })).toBe(true);
  });

  test('flag off restores the legacy always-load behaviour', () => {
    const { app } = loadAttendanceModule({ flags: { rosterProjectionFirst: true, deferAttendanceRecords: false } });
    expect(app._shouldLoadDetailAttendanceData({ id: 'evt-1', status: 'open' })).toBe(true);
  });
});

describe('P1/P2 wiring — source contracts', () => {
  test('config registers both rollout flags default-on', () => {
    const configSource = readProjectFile('js/config.js');
    expect(configSource).toContain('rosterProjectionFirst: true');
    expect(configSource).toContain('deferAttendanceRecords: true');
    expect(configSource).toContain('detailAttendanceOnDemand: false');
  });

  test('attendance table render path consumes both helpers', () => {
    const source = readProjectFile('js/modules/event/event-manage-attendance.js');
    expect(source).toContain('_shouldPaintDetailRosterProjectionFirst?.(eventId, e, cId, options) === true');
    expect(source).toContain("if (this._shouldLoadDetailAttendanceData?.(e) !== false) {");
    expect(source).toContain("key === 'detail-attendance-table'");
    expect(source).toContain('FirebaseService.requestDetailAttendanceRealtime()');
  });

  test('firebase-service defers the detail attendance listener with on-demand start and page-leave reset', () => {
    const source = readProjectFile('js/firebase-service.js');
    expect(source).toContain('_isDetailAttendanceDeferred(pageId, name)');
    expect(source).toContain("needed.has('attendanceRecords') && !this._isDetailAttendanceDeferred(pageId, 'attendanceRecords')");
    expect(source).toContain('requestDetailAttendanceRealtime()');
    expect(source).toContain('this._detailAttendanceRealtimeRequested = false;');
  });
});

describe('Phase A detail attendance on-demand guard', () => {
  test('direct detail table render returns the summary shell while the full roster is closed', async () => {
    const { app } = loadAttendanceModule({
      flags: {
        rosterProjectionFirst: true,
        deferAttendanceRecords: true,
        detailAttendanceOnDemand: true,
      },
    });
    document.body.innerHTML = '<div id="detail-attendance-table"></div>';
    app._shouldRenderDetailAttendanceTable = jest.fn(() => false);
    app._renderDetailAttendanceSummaryShell = jest.fn(() => '<div data-attendance-on-demand="true">summary</div>');

    await expect(app._renderAttendanceTable('evt-1', 'detail-attendance-table', { mode: 'detail' }))
      .resolves.toEqual({ ok: true, reason: 'on-demand-summary' });
    expect(app._renderDetailAttendanceSummaryShell).toHaveBeenCalledWith('evt-1', null, { mode: 'detail' });
    expect(document.getElementById('detail-attendance-table').innerHTML).toContain('summary');
  });
});
