const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('event registration open status', () => {
  test('detail signup button refresh normalizes stale upcoming status', () => {
    const source = readProjectFile('js/modules/event/event-detail-signup.js');
    const refreshSource = sliceBetween(
      source,
      '_refreshSignupButton(eventId)',
      'actionZone.innerHTML = html;'
    );

    expect(refreshSource).toContain('e = this._syncEventEffectiveStatus?.(e) || e;');
    expect(refreshSource.indexOf('e = this._syncEventEffectiveStatus?.(e) || e;'))
      .toBeLessThan(refreshSource.indexOf("var isUpcoming = e.status === 'upcoming';"));
  });

  test('registerForEvent checks regOpenTime before stale upcoming status blocks signup', () => {
    const source = readProjectFile('functions/index.js');
    const registerSource = sliceBetween(
      source,
      'exports.registerForEvent',
      'exports.cancelRegistration'
    );

    expect(source).toContain('function parseEventRegOpenTimeInTaipei(value)');
    expect(source).toContain('function isEventRegistrationNotOpen(data, now = new Date())');
    expect(registerSource).toContain('const registrationNotOpen = isEventRegistrationNotOpen(ed, now);');
    expect(registerSource).toContain('if (!registrationNotOpen && ed.status === "upcoming")');
    expect(registerSource.indexOf('const registrationNotOpen = isEventRegistrationNotOpen(ed, now);'))
      .toBeLessThan(registerSource.indexOf('if (!registrationNotOpen && ed.status === "upcoming")'));
    expect(registerSource).not.toContain('if (ed.status === "upcoming") throw new HttpsError("failed-precondition", "REG_NOT_OPEN");');
  });
});
