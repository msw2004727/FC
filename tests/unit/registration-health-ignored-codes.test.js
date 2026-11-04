const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', '..', 'functions', 'index.js'), 'utf8');

function extract(regex, label) {
  const match = SOURCE.match(regex);
  if (!match) throw new Error(`cannot extract ${label} from functions/index.js`);
  return match[0];
}

// 從 functions/index.js 抽出健康告警判斷所需的常數與函式，在 vm 內實際執行
function loadHealthFilter() {
  const parts = [
    'REGISTRATION_CALLABLE_NAMES',
    'REGISTRATION_ERROR_LOG_CONTEXTS',
    'REGISTRATION_ERROR_LOG_ACTIONS',
  ].map((name) => extract(new RegExp(`const ${name} = Object\\.freeze\\(\\[[\\s\\S]*?\\]\\);`), name));
  parts.push(extract(/const REGISTRATION_IGNORED_ERROR_CODES = new Set\(\[[\s\S]*?\]\);/, 'REGISTRATION_IGNORED_ERROR_CODES'));
  parts.push(extract(/function parseErrorLogContext\(value\) \{[\s\S]*?\n\}/, 'parseErrorLogContext'));
  parts.push(extract(/function normalizeRegistrationErrorCode\(logData, contextData\) \{[\s\S]*?\n\}/, 'normalizeRegistrationErrorCode'));
  parts.push(extract(/function isRegistrationCallableErrorLog\(logData = \{\}\) \{[\s\S]*?\n\}/, 'isRegistrationCallableErrorLog'));
  const sandbox = {};
  vm.runInNewContext(`${parts.join('\n')}\nthis.REGISTRATION_IGNORED_ERROR_CODES = REGISTRATION_IGNORED_ERROR_CODES;\nthis.isRegistrationCallableErrorLog = isRegistrationCallableErrorLog;`, sandbox);
  return sandbox;
}

function logFor(fn, errCode) {
  return { errorCode: errCode, context: JSON.stringify({ fn, errCode }) };
}

describe('watchRegistrationCallableHealth ignored error codes (T-087e)', () => {
  const { REGISTRATION_IGNORED_ERROR_CODES, isRegistrationCallableErrorLog } = loadHealthFilter();

  const NEWLY_IGNORED = [
    'EVENT_STARTED',
    'EVENT_UNAVAILABLE',
    'AGE_RESTRICTED',
    'BIRTHDAY_REQUIRED',
    'GENDER_RESTRICTED',
    'TEAM_RESTRICTED',
  ];
  const STILL_ALERTED = ['REQUEST_ID_CONFLICT', 'PARTICIPANT_NOT_ALLOWED'];

  test.each(NEWLY_IGNORED)('%s is ignored by the health alert', (code) => {
    expect(REGISTRATION_IGNORED_ERROR_CODES.has(code)).toBe(true);
    expect(isRegistrationCallableErrorLog(logFor('registerForEvent', code))).toBe(false);
    expect(isRegistrationCallableErrorLog(logFor('cancelRegistration', code))).toBe(false);
  });

  test.each(STILL_ALERTED)('%s still counts toward the health alert', (code) => {
    expect(REGISTRATION_IGNORED_ERROR_CODES.has(code)).toBe(false);
    expect(isRegistrationCallableErrorLog(logFor('registerForEvent', code))).toBe(true);
    expect(isRegistrationCallableErrorLog(logFor('cancelRegistration', code))).toBe(true);
  });

  test('existing ignored codes are kept', () => {
    for (const code of ['PROFILE_INCOMPLETE', 'ALREADY_REGISTERED', 'ALREADY_CANCELLED']) {
      expect(REGISTRATION_IGNORED_ERROR_CODES.has(code)).toBe(true);
    }
  });
});
