const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('scheduled activity auto-end timing', () => {
  function loadAutoEndHelpers() {
    const source = fs.readFileSync(path.join(__dirname, '../../functions/index.js'), 'utf8');
    const names = [
      'parseEventStartDateInTaipei',
      'parseEventEndDateInTaipei',
      'parseEventRegOpenTimeInTaipei',
      'isEventRegistrationNotOpen',
      'shouldAutoEndEvent',
    ];
    const helperSource = names.map(name => {
      const start = source.indexOf(`function ${name}`);
      if (start < 0) throw new Error(`missing helper ${name}`);
      const next = names
        .map(other => source.indexOf(`function ${other}`, start + 1))
        .filter(index => index > start)
        .sort((a, b) => a - b)[0] || source.indexOf('async function autoEndStartedEventsBatch', start);
      return source.slice(start, next);
    }).join('\n');

    const sandbox = { Date, Number, String };
    vm.runInNewContext(`${helperSource}; result = { shouldAutoEndEvent, parseEventEndDateInTaipei };`, sandbox);
    return sandbox.result;
  }

  test('does not mark an event ended before its end time', () => {
    const { shouldAutoEndEvent } = loadAutoEndHelpers();
    const event = { status: 'open', date: '2026/05/10 08:00~10:00' };

    expect(shouldAutoEndEvent(event, new Date('2026-05-10T01:59:59.000Z'))).toBe(false);
    expect(shouldAutoEndEvent(event, new Date('2026-05-10T02:00:00.000Z'))).toBe(true);
  });

  test('supports late-night events that cross midnight', () => {
    const { shouldAutoEndEvent, parseEventEndDateInTaipei } = loadAutoEndHelpers();
    const event = { status: 'full', date: '2026/05/10 23:00~01:00' };

    expect(parseEventEndDateInTaipei(event.date).toISOString()).toBe('2026-05-10T17:00:00.000Z');
    expect(shouldAutoEndEvent(event, new Date('2026-05-10T16:59:59.000Z'))).toBe(false);
    expect(shouldAutoEndEvent(event, new Date('2026-05-10T17:00:00.000Z'))).toBe(true);
  });
});
