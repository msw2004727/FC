describe('tournament datetime normalization', () => {
  beforeEach(() => {
    jest.resetModules();
    global.App = {};
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.App;
  });

  test('normalizes datetime-local values to ISO strings before saving', () => {
    require('../../js/modules/tournament/tournament-manage-form.js');

    const raw = '2026-04-29T12:32';
    const normalized = global.App._normalizeTournamentDateTimeValue(raw);

    expect(normalized).toBe(new Date(raw).toISOString());
    expect(normalized).toMatch(/Z$/);
  });

  test('immediate registration start uses an absolute ISO timestamp', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T04:32:00.000Z'));
    require('../../js/modules/tournament/tournament-manage-form.js');

    expect(global.App._getTournamentImmediateRegStartValue('')).toBe('2026-04-29T04:32:00.000Z');
  });

  test('converts stored ISO values back to datetime-local input format', () => {
    require('../../js/modules/tournament/tournament-manage-form.js');

    const iso = new Date('2026-04-29T04:32:00.000Z').toISOString();
    const inputValue = global.App._toTournamentDateTimeInputValue(iso);
    const parsed = new Date(iso);
    const expected = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    expect(inputValue).toBe(expected);
  });
});
