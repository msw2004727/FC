/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadEventCreateModule(options = {}) {
  const courseEvent = options.event || {
    id: 'ce_course_1',
    courseLinked: true,
    courseLinkSource: 'eduCourseLesson',
    courseLinkId: 'link_1',
    privateEvent: true,
    isPublic: false,
  };
  const elements = options.elements || {};
  const documentMock = options.document || {
    getElementById: id => elements[id] || null,
    createElement: tag => ({
      tagName: String(tag || '').toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      classList: { add: jest.fn(), remove: jest.fn(), contains: jest.fn(() => false) },
      dataset: {},
      insertBefore: jest.fn(),
      querySelector: jest.fn(() => null),
      querySelectorAll: jest.fn(() => []),
      setAttribute: jest.fn(),
      removeAttribute: jest.fn(),
    }),
  };
  const ApiService = options.ApiService || {
    getEvent: jest.fn(() => courseEvent),
    updateEventAwait: jest.fn().mockResolvedValue({ id: courseEvent.id }),
  };
  const FirebaseService = options.FirebaseService || {
    _cache: { registrations: [] },
    _saveToLS: jest.fn(),
  };
  const App = Object.assign({
    _editEventId: courseEvent.id,
    _eventSubmitInFlight: false,
    _ensureActivityRoleCapabilitiesReady: jest.fn().mockResolvedValue(undefined),
    _canEditOwnActivityBasic: jest.fn(() => true),
    _canCreateBasicActivity: jest.fn(() => true),
    _requireProfileComplete: jest.fn(() => false),
    _formatCreateTimeValue: value => String(value || ''),
    _getEventRegOpenTimeValue: jest.fn(() => ''),
    _getEventMinAgeFormValue: jest.fn(() => 0),
    _getAllowedGenderValue: jest.fn(() => ''),
    _delegates: options.delegates || [],
    _isCourseLinkedEvent: eventRecord => !!eventRecord?.courseLinked,
    _canOperatePrivateEvent: jest.fn(() => true),
    _isEventOwner: jest.fn(() => true),
    _canManageEventDelegates: jest.fn(() => false),
    _canManageScopedActivity: jest.fn(() => true),
    _canManageAllActivities: jest.fn(() => false),
    closeModal: jest.fn(),
    showToast: jest.fn(),
    renderActivityList: jest.fn(),
    renderHotEvents: jest.fn(),
    renderMyActivities: jest.fn(),
  }, options.App || {});
  const sandbox = {
    App,
    ApiService,
    FirebaseService,
    document: documentMock,
    console: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    getSportKeySafe: value => String(value || '').trim(),
    URL,
  };
  const code = fs.readFileSync(path.join(ROOT, 'js/modules/event/event-create.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'js/modules/event/event-create.js' });
  App._editEventId = courseEvent.id;
  return { App, ApiService, FirebaseService, courseEvent, documentMock, consoleMock: sandbox.console };
}

function makeSubmitElement() {
  return {
    dataset: {},
    textContent: 'Save',
    disabled: false,
    style: {},
  };
}

function loadEventListStatsModule({ event, registrations, user }) {
  const App = {};
  const ApiService = {
    getCurrentUser: jest.fn(() => user),
    getRegistrationsByEvent: jest.fn(id => (id === event.id ? registrations : [])),
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'js/modules/event/event-list-stats.js'), 'utf8'),
    {
      App,
      ApiService,
      auth: { currentUser: user ? { uid: user.uid } : null },
      Object,
      Array,
      String,
      Number,
      Date,
      Math,
      Map,
      Set,
      console,
    },
    { filename: 'js/modules/event/event-list-stats.js' }
  );
  return App;
}

describe('course-linked activity edit flow', () => {
  test('clears legacy course locks so every standard form control can be edited', () => {
    const lockedControl = {
      disabled: true,
      dataset: {
        courseLinkedPrevDisabled: '0',
        courseLinkedLockControl: '1',
      },
      removeAttribute: jest.fn(),
    };
    const lockedRow = {
      dataset: { courseLinkedLockRow: '1' },
      classList: { remove: jest.fn() },
    };
    const editableRow = {
      dataset: { courseLinkedEditableRow: '1' },
      classList: { remove: jest.fn() },
    };
    const modal = {
      classList: {
        contains: jest.fn(() => true),
        remove: jest.fn(),
      },
      querySelectorAll: jest.fn(selector => {
        if (selector.includes('lock-control')) return [lockedControl];
        if (selector.includes('lock-row')) return [lockedRow];
        if (selector.includes('editable-row')) return [editableRow];
        return [];
      }),
    };
    const valueSection = { open: true };
    const documentMock = {
      getElementById: id => ({
        'create-event-modal': modal,
        'ce-value-section': valueSection,
      }[id] || null),
      createElement: jest.fn(),
    };
    const { App } = loadEventCreateModule({ document: documentMock });

    App._applyCourseLinkedEditLockState();

    expect(lockedControl.disabled).toBe(false);
    expect(lockedControl.dataset).not.toHaveProperty('courseLinkedPrevDisabled');
    expect(lockedControl.dataset).not.toHaveProperty('courseLinkedLockControl');
    expect(lockedControl.removeAttribute).toHaveBeenCalledWith('aria-disabled');
    expect(lockedRow.classList.remove).toHaveBeenCalledWith('ce-course-linked-locked-row');
    expect(editableRow.classList.remove).toHaveBeenCalledWith('ce-course-linked-editable-row');
    expect(valueSection.open).toBe(false);
  });

  test('uses a 120-character title limit only while editing course activities', () => {
    document.body.innerHTML = '<input id="ce-title" maxlength="16">';
    const { App, courseEvent } = loadEventCreateModule({ document });

    App._setEventTitleInputLimit(courseEvent);
    expect(document.getElementById('ce-title').maxLength).toBe(120);
    expect(App._getEventTitleInputLimit(courseEvent)).toBe(120);

    App._editEventId = null;
    App._setEventTitleInputLimit(null);
    expect(document.getElementById('ce-title').maxLength).toBe(16);
    expect(App._getEventTitleInputLimit(null)).toBe(16);
  });

  test('adds the legacy course type only for that edit session and removes it for create mode', () => {
    document.body.innerHTML = [
      '<select id="ce-type">',
      '<option value="friendly">友誼賽</option>',
      '<option value="play">我要開團</option>',
      '</select>',
    ].join('');
    const { App, courseEvent } = loadEventCreateModule({ document });

    App._syncCourseLinkedTypeEditOption({ ...courseEvent, type: 'course' });
    const courseOption = document.querySelector('#ce-type option[value="course"]');
    expect(courseOption).not.toBeNull();
    expect(courseOption.dataset.courseLinkedTransient).toBe('1');
    expect(document.getElementById('ce-type').value).toBe('course');

    App._editEventId = null;
    App._removeCourseLinkedTypeEditOption();
    expect(document.querySelector('#ce-type option[value="course"]')).toBeNull();
  });

  test('keeps unchanged legacy course values out of the callable diff, including max zero', () => {
    const { App } = loadEventCreateModule();
    const existing = {
      title: '完整課程活動名稱',
      type: 'course',
      location: '',
      sportTag: '',
      max: 0,
    };
    const unchanged = App._pruneUnchangedCourseLinkedEventFields({
      title: existing.title,
      type: existing.type,
      location: existing.location,
      sportTag: existing.sportTag,
      max: 0,
      notes: 'changed',
    }, existing);
    expect(unchanged).toEqual({ notes: 'changed' });

    const changed = App._pruneUnchangedCourseLinkedEventFields({
      title: '新課程名稱',
      type: 'training',
      location: '新球場',
      sportTag: 'football',
      max: 12,
    }, existing);
    expect(changed).toEqual({
      title: '新課程名稱',
      type: 'training',
      location: '新球場',
      sportTag: 'football',
      max: 12,
    });
  });

  test('patches only the exact promoted or demoted course registration in local cache', () => {
    const registrations = [
      { eventId: 'ce_course_1', userId: 'same-user', _docId: 'course-a', status: 'waitlisted' },
      { eventId: 'ce_course_1', userId: 'same-user', _docId: 'course-b', status: 'waitlisted' },
    ];
    const FirebaseService = {
      _cache: { registrations },
      _saveToLS: jest.fn(),
    };
    const { App } = loadEventCreateModule({ FirebaseService });

    expect(App._applyCourseLinkedRosterUpdateResult('ce_course_1', {
      promoted: [{ docId: 'course-b' }],
    })).toBe(1);
    expect(registrations.map(reg => reg.status)).toEqual(['waitlisted', 'confirmed']);

    expect(App._applyCourseLinkedRosterUpdateResult('ce_course_1', {
      demoted: [{ docId: 'course-a' }],
    })).toBe(0);
    expect(FirebaseService._saveToLS).toHaveBeenCalledTimes(1);
  });

  test('event registration state treats courseOwnerUids as self ownership without admitting companions', () => {
    const event = { id: 'course-event' };
    const user = { uid: 'parent-1' };
    const parentOwned = {
      eventId: event.id,
      userId: 'child-a',
      courseOwnerUids: ['parent-1'],
      participantType: 'self',
      status: 'waitlisted',
    };
    let App = loadEventListStatsModule({
      event,
      registrations: [parentOwned],
      user,
    });
    expect(App._getCurrentUserEventRegistrationState(event)).toEqual({
      signedUp: true,
      onWaitlist: true,
    });

    App = loadEventListStatsModule({
      event,
      registrations: [{ ...parentOwned, participantType: 'companion', companionId: 'guest-1' }],
      user,
    });
    expect(App._getCurrentUserEventRegistrationState(event)).toEqual({
      signedUp: false,
      onWaitlist: false,
    });

    App = loadEventListStatsModule({
      event,
      registrations: [{
        eventId: event.id,
        userId: 'parent-1',
        participantType: 'self',
        status: 'confirmed',
      }],
      user,
    });
    expect(App._getCurrentUserEventRegistrationState(event)).toEqual({
      signedUp: true,
      onWaitlist: false,
    });
  });

  test('guards stale async course edits and serializes nested team split timestamps', () => {
    const createSource = fs.readFileSync(path.join(ROOT, 'js/modules/event/event-create.js'), 'utf8');
    const lifecycleSource = fs.readFileSync(path.join(ROOT, 'js/modules/event/event-manage-lifecycle.js'), 'utf8');
    const handleStart = createSource.indexOf('async handleCreateEvent()');
    const handleEnd = createSource.indexOf('/** 同步活動計數至 Firebase */', handleStart);
    const handleSource = createSource.slice(handleStart, handleEnd);
    const sdkAwait = handleSource.indexOf("const functionsSdk = await ensureFirebaseFunctionsSdk('asia-east1')");
    const sdkGuard = handleSource.indexOf('if (!isSubmitCurrent()) return;', sdkAwait);
    const callable = handleSource.indexOf("functionsSdk.httpsCallable('updateCourseLinkedEvent')", sdkAwait);
    const result = handleSource.indexOf('courseLinkedUpdateResult = cfResult?.data || {}', callable);
    const resultGuard = handleSource.indexOf('if (!isSubmitSessionCurrent()) return;', result);
    const cacheMutation = handleSource.indexOf('_applyCourseLinkedRosterUpdateResult', result);

    expect(sdkAwait).toBeGreaterThan(-1);
    expect(sdkGuard).toBeGreaterThan(sdkAwait);
    expect(sdkGuard).toBeLessThan(callable);
    expect(resultGuard).toBeGreaterThan(result);
    expect(resultGuard).toBeLessThan(cacheMutation);
    expect(handleSource).toContain('teamSplitLockAt.toDate().toISOString()');
    expect(handleSource).toContain('teamSplitLockAt.toISOString()');
    expect(handleSource).toContain("gradient: isCourseLinkedEdit && type === String(existingEvent?.type || '')");
    expect(handleSource).toContain('const max = Number.isFinite(parsedMax) ? parsedMax : 20;');
    expect(handleSource).toContain('&& max > 0 && max < (Number(existingEvent?.current || 0) || 0)');
    expect(handleSource).not.toContain('_submitCourseLinkedEventVisibilityEdit(');
    expect(lifecycleSource).toContain("document.getElementById('ce-max').value = e.max ?? 20;");
  });
});
