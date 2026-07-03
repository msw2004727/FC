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
});
