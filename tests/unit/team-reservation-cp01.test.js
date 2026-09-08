/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(process.env.CP01_BASELINE_SOURCE || path.join(__dirname, '../../js/modules/event/event-detail-signup.js'), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
let app, eventRecord, staff, service, userId;
const course = () => Object.assign(eventRecord, { courseLinked: true, courseLinkSource: 'eduCourseLesson', courseTeamId: 'tm_fixture', coursePlanId: 'plan_fixture' });
beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = '';
  localStorage.clear();
  eventRecord = { id: 'evt_fixture', max: 10, current: 0, status: 'open' };
  staff = true;
  userId = 'fixture_user';
  service = { adjustTeamReservation: jest.fn().mockResolvedValue({}) };
  app = { currentPage: 'page-activity-detail', _currentDetailEventId: eventRecord.id,
    showToast: jest.fn(), _requireProtectedActionLogin: jest.fn(() => false),
    _isCurrentUserTeamStaff: () => staff, _patchDetailAfterSignup: jest.fn() };
  const api = { getEvent: id => id === eventRecord.id ? eventRecord : null,
    getCurrentUser: () => ({ uid: userId }), getTeams: () => [{ id: 'tm_fixture', name: '測試俱樂部' }] };
  new Function('App', 'ApiService', 'FirebaseService', 'escapeHTML', source)(app, api, service, s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  app._ensureTeamReservationStaffTeamsLoaded = jest.fn(async () => []);
  app._patchDetailAfterSignup = jest.fn();
  app._refreshSignupButton = jest.fn();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); jest.clearAllTimers(); jest.useRealTimers(); });
async function open() { await app.openTeamReservationModal(eventRecord.id); document.getElementById('team-reservation-slots-input').value = '2'; }

describe('CP01 unsupported_blocked', () => {
  test('course entry offers an existing course route, not team reservation', () => {
    course();
    document.body.innerHTML = app._renderTeamReservationActionButton(eventRecord);
    expect(document.querySelector('[onclick*="openTeamReservationModal"]')).toBeNull();
    const link = document.querySelector('a');
    expect(link.textContent).toContain('查看課程');
    const url = new URL(link.href);
    expect(url.searchParams.get('team')).toBe('tm_fixture');
    expect(url.searchParams.get('course')).toBe('plan_fixture');
    expect(url.searchParams.get('teamTab')).toBe('courses');
  });
  test('direct open and direct confirm never call service for course events', async () => {
    course(); await app.openTeamReservationModal(eventRecord.id);
    expect(document.querySelector('.team-reservation-overlay.open')).toBeNull();
    await app.confirmTeamReservation(eventRecord.id, 'tm_fixture');
    expect(service.adjustTeamReservation).not.toHaveBeenCalled();
    expect(app.showToast).toHaveBeenCalledWith(expect.stringContaining('課程'));
  });
  test('event becoming course managed while modal is open is blocked', async () => {
    await open(); course(); await app.confirmTeamReservation(eventRecord.id, 'tm_fixture');
    expect(service.adjustTeamReservation).not.toHaveBeenCalled();
  });
  test('missing or unsafe course references do not produce a dead link', () => {
    course(); eventRecord.courseTeamId = "bad/'<";
    document.body.innerHTML = app._renderTeamReservationActionButton(eventRecord);
    expect(document.querySelector('a')).toBeNull();
    expect(document.body.textContent).toContain('主辦');
  });
});
describe('CP01 normal_flow', () => {
  test.each([{ courseLinked: true }, { courseLinkSource: 'eduCourseLesson' }, { courseLinkId: 'legacy' }, {}])('server-compatible ordinary event %j stays available', async fields => {
    Object.assign(eventRecord, fields);
    expect(app._renderTeamReservationActionButton(eventRecord)).toContain('openTeamReservationModal');
    await open(); await app.confirmTeamReservation(eventRecord.id, 'tm_fixture');
    expect(service.adjustTeamReservation).toHaveBeenCalledWith(eventRecord.id, 'tm_fixture', 2);
    expect(app._patchDetailAfterSignup).toHaveBeenCalledWith(eventRecord.id);
  });
  test('non-staff cannot enter or submit', async () => {
    staff = false;
    expect(app._renderTeamReservationActionButton(eventRecord)).toBe('');
    await app.openTeamReservationModal(eventRecord.id); await app.confirmTeamReservation(eventRecord.id, 'tm_fixture');
    expect(service.adjustTeamReservation).not.toHaveBeenCalled();
  });
  test('tampered team identifier is not silently replaced or submitted', async () => {
    await open(); await app.confirmTeamReservation(eventRecord.id, 'tm_other');
    expect(service.adjustTeamReservation).not.toHaveBeenCalled();
  });
  test('login gate also applies to direct confirm', async () => {
    await open(); app._requireProtectedActionLogin.mockReturnValue(true);
    await app.confirmTeamReservation(eventRecord.id, 'tm_fixture');
    expect(service.adjustTeamReservation).not.toHaveBeenCalled();
  });
});
describe('CP01 error_recovery', () => {
  test.each([
    [{ details: { code: 'COURSE_LINKED_EVENT_MANAGED_BY_COURSE' }, message: 'internal' }, '課程'],
    ['COURSE_LINKED_EVENT_MANAGED_BY_COURSE', '課程'],
    [{ details: { reason: 'RESERVED_OVER_CAPACITY' } }, '可用名額'],
    ['RESERVED_BELOW_USED', '已使用人數'],
    [{ code: 'functions/permission-denied' }, '權限'],
    [new Error('network failure'), '重試'],
  ])('normalizes %j and recovers', async (err, text) => {
    await open(); service.adjustTeamReservation.mockRejectedValueOnce(err);
    await app.confirmTeamReservation(eventRecord.id, 'tm_fixture');
    expect(app.showToast).toHaveBeenLastCalledWith(expect.stringContaining(text));
    expect(document.getElementById('team-reservation-confirm-btn').disabled).toBe(false);
    service.adjustTeamReservation.mockResolvedValueOnce({});
    await app.confirmTeamReservation(eventRecord.id, 'tm_fixture');
    const courseRejected = JSON.stringify(err).includes('COURSE_LINKED_EVENT_MANAGED_BY_COURSE');
    expect(service.adjustTeamReservation).toHaveBeenCalledTimes(courseRejected ? 1 : 2);
  });
  test.each([true, false])('stale cache course rejection supplies a usable next step (references=%s)', async hasReferences => {
    if (hasReferences) Object.assign(eventRecord, {courseTeamId:'tm_fixture',coursePlanId:'plan_fixture'});
    await open(); service.adjustTeamReservation.mockRejectedValueOnce({details:{code:'COURSE_LINKED_EVENT_MANAGED_BY_COURSE'}});
    await app.confirmTeamReservation(eventRecord.id, 'tm_fixture');
    expect(document.getElementById('team-reservation-confirm-btn').hidden).toBe(true);
    const link = document.querySelector('#team-reservation-modal a');
    if (hasReferences) {
      expect(link.textContent).toBe('查看課程');
      expect(new URL(link.href).searchParams.get('course')).toBe('plan_fixture');
    } else {
      expect(link).toBeNull();
      expect(document.querySelector('.team-reservation-dialog-body').textContent).toContain('聯絡主辦');
    }
    expect(app._refreshSignupButton).toHaveBeenCalledWith(eventRecord.id);
    app.closeTeamReservationModal(); await app.openTeamReservationModal(eventRecord.id);
    expect(document.querySelector('.team-reservation-overlay.open')).toBeNull();
    await app.confirmTeamReservation(eventRecord.id, 'tm_fixture');
    expect(service.adjustTeamReservation).toHaveBeenCalledTimes(1);
    expect(app._renderTeamReservationActionButton(eventRecord)).not.toContain('openTeamReservationModal');
  });
  test('duplicate calls remain blocked beyond shared busy timeout; then retry is available', async () => {
    await open(); const pending = deferred(); service.adjustTeamReservation.mockReturnValueOnce(pending.promise);
    const first = app.confirmTeamReservation(eventRecord.id, 'tm_fixture');
    jest.advanceTimersByTime(21000);
    await app.confirmTeamReservation(eventRecord.id, 'tm_fixture');
    expect(service.adjustTeamReservation).toHaveBeenCalledTimes(1);
    pending.resolve({}); await first;
    await open(); await app.confirmTeamReservation(eventRecord.id, 'tm_fixture');
    expect(service.adjustTeamReservation).toHaveBeenCalledTimes(2);
  });
  test('closing while loading prevents late modal opening', async () => {
    const pending = deferred(); app._ensureTeamReservationStaffTeamsLoaded.mockReturnValue(pending.promise);
    const opening = app.openTeamReservationModal(eventRecord.id); app.closeTeamReservationModal();
    pending.resolve([]); await opening;
    expect(document.querySelector('.team-reservation-overlay.open')).toBeNull();
  });
  test('leaving event while loading prevents stale modal', async () => {
    const pending = deferred(); app._ensureTeamReservationStaffTeamsLoaded.mockReturnValue(pending.promise);
    const opening = app.openTeamReservationModal(eventRecord.id); app._currentDetailEventId = 'evt_other';
    pending.resolve([]); await opening;
    expect(document.querySelector('.team-reservation-overlay.open')).toBeNull();
  });
  test('old response does not close a reopened modal', async () => {
    await open(); const pending = deferred(); service.adjustTeamReservation.mockReturnValueOnce(pending.promise);
    const first = app.confirmTeamReservation(eventRecord.id, 'tm_fixture');
    app.closeTeamReservationModal(); await open(); pending.resolve({}); await first;
    expect(document.querySelector('.team-reservation-overlay.open')).not.toBeNull();
    expect(document.getElementById('team-reservation-confirm-btn').disabled).toBe(false);
  });
  test.each(['route ABA', 'account changed'])('pending open is discarded after %s', async kind => {
    const pending = deferred(); app._ensureTeamReservationStaffTeamsLoaded.mockReturnValue(pending.promise);
    const opening = app.openTeamReservationModal(eventRecord.id);
    if (kind === 'route ABA') app._eventDetailRequestSeq = 2;
    else userId = 'fixture_other_user';
    pending.resolve([]); await opening;
    expect(document.querySelector('.team-reservation-overlay.open')).toBeNull();
  });
});
