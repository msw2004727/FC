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
    _isCourseLinkedEvent: eventRecord => !!eventRecord?.courseLinked,
    closeModal: jest.fn(),
    showToast: jest.fn(),
    renderActivityList: jest.fn(),
    renderHotEvents: jest.fn(),
    renderMyActivities: jest.fn(),
  }, options.App || {});
  const sandbox = {
    App,
    ApiService,
    document: documentMock,
    console: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    getSportKeySafe: value => String(value || '').trim(),
    URL,
  };
  const code = fs.readFileSync(path.join(ROOT, 'js/modules/event/event-create.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'js/modules/event/event-create.js' });
  App._editEventId = courseEvent.id;
  return { App, ApiService, courseEvent, documentMock, consoleMock: sandbox.console };
}

function makeSubmitElement() {
  return {
    dataset: {},
    textContent: 'Save',
    disabled: false,
    style: {},
  };
}

describe('course-linked activity edit guard', () => {
  test('writes only visibility fields when saving a converted course activity', async () => {
    const { App, ApiService, courseEvent } = loadEventCreateModule();

    await App._submitCourseLinkedEventVisibilityEdit(courseEvent, false);

    expect(ApiService.updateEventAwait).toHaveBeenCalledWith(courseEvent.id, {
      privateEvent: false,
      isPublic: true,
    });
    const updates = ApiService.updateEventAwait.mock.calls[0][1];
    expect(Object.keys(updates).sort()).toEqual(['isPublic', 'privateEvent']);
    expect(updates).not.toHaveProperty('title');
    expect(updates).not.toHaveProperty('date');
    expect(updates).not.toHaveProperty('max');
  });

  test('skips locked field validation for converted course activities', async () => {
    const elements = {
      'ce-submit-btn': makeSubmitElement(),
      'ce-title': { value: 'A title that is intentionally longer than sixteen characters' },
      'ce-type': { value: 'friendly' },
      'ce-location': { value: '' },
      'ce-date': { value: '' },
      'ce-time-start': { value: '' },
      'ce-time-end': { value: '' },
      'ce-fee-enabled': { checked: false },
      'ce-fee': { value: '0' },
      'ce-max': { value: '0' },
      'ce-min-age': { value: '0' },
      'ce-notes': { value: '' },
      'ce-sport-tag': { value: '' },
      'ce-team-only': { checked: false },
      'ce-gender-restriction-enabled': { checked: false },
      'ce-private-event': { checked: false },
    };
    const { App, courseEvent } = loadEventCreateModule({ elements });
    App._submitCourseLinkedEventVisibilityEdit = jest.fn().mockResolvedValue(true);
    App._getEventSocialLinksFormData = jest.fn(() => {
      throw new Error('locked social link validation should be skipped');
    });

    await App.handleCreateEvent();

    expect(App._submitCourseLinkedEventVisibilityEdit).toHaveBeenCalledWith(courseEvent, false);
    expect(App._getEventSocialLinksFormData).not.toHaveBeenCalled();
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('source and CSS expose locked rows while leaving private visibility editable', () => {
    const createSource = fs.readFileSync(path.join(ROOT, 'js/modules/event/event-create.js'), 'utf8');
    const cssSource = fs.readFileSync(path.join(ROOT, 'css/activity.css'), 'utf8');

    expect(createSource).toContain("_courseLinkedEditUnlockedIds: ['ce-private-event', 'ce-submit-btn']");
    expect(createSource).toContain("'ce-title'");
    expect(createSource).toContain("'ce-location'");
    expect(createSource).toContain("'ce-max'");
    expect(createSource).toContain('if (isCourseLinkedEdit)');
    expect(cssSource).toContain('ce-course-linked-locked-row');
    expect(cssSource).toContain('ce-course-linked-editable-row');
  });
});