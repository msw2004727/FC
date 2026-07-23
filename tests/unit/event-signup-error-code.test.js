const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadSignupModule() {
  const App = {};
  const sandbox = { App, console };
  const code = fs.readFileSync(path.join(ROOT, 'js/modules/event/event-detail-signup.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'event-detail-signup.js' });
  return App;
}

describe('event signup error code handling', () => {
  test('prefers callable PROFILE_INCOMPLETE message over generic functions code', () => {
    const App = loadSignupModule();

    expect(App._getEventRegistrationErrorCode({
      code: 'functions/failed-precondition',
      message: 'PROFILE_INCOMPLETE',
    })).toBe('PROFILE_INCOMPLETE');
  });

  test('normalizes Firebase functions code prefixes for fallback messages', () => {
    const App = loadSignupModule();

    expect(App._getEventRegistrationErrorCode({
      code: 'functions/failed-precondition',
      message: '',
    })).toBe('failed-precondition');
  });

  test('reads callable details.code objects before generic functions code', () => {
    const App = loadSignupModule();

    expect(App._getEventRegistrationErrorCode({
      code: 'functions/failed-precondition',
      message: 'COURSE_LINKED_EVENT_PRIVATE_REGISTRATION',
      details: { code: 'COURSE_LINKED_EVENT_PRIVATE_REGISTRATION' },
    })).toBe('COURSE_LINKED_EVENT_PRIVATE_REGISTRATION');
  });

  test('maps signed-in course cancellation failures to an actionable message', () => {
    const App = loadSignupModule();

    expect(App._getEventRegistrationFriendlyErrorMessage({
      details: { code: 'COURSE_ATTENDANCE_ALREADY_SIGNED_IN' },
    })).toContain('已完成簽到');
  });

  test('never renders callable detail objects as raw object text', () => {
    const App = loadSignupModule();
    const error = {
      code: 'functions/failed-precondition',
      message: '',
      details: { code: 'INVALID_COURSE_LINKED_REGISTRATION' },
    };

    expect(App._getEventRegistrationErrorCode(error)).toBe('INVALID_COURSE_LINKED_REGISTRATION');
    expect(App._getEventRegistrationFriendlyErrorMessage(error)).not.toContain('[object Object]');
    expect(App._getEventRegistrationFriendlyErrorMessage(error)).toContain('課程報名資料');
  });
  test('legacy course-managed errors never direct users back to the course page', () => {
    const App = loadSignupModule();
    const source = fs.readFileSync(path.join(ROOT, 'js/modules/event/event-detail-signup.js'), 'utf8');
    const codes = ['COURSE_LINKED_EVENT_MANAGED_BY_COURSE', 'COURSE_LINKED_REGISTRATION_MANAGED_BY_COURSE'];

    codes.forEach(code => {
      const message = App._getEventRegistrationFriendlyErrorMessage(code);
      expect(message).toContain('重新整理');
      expect(message).not.toContain('課程頁面');
    });
    expect(source).not.toContain('請回到課程頁面操作');
  });
});
