describe('calendar today marker', () => {
  beforeEach(() => {
    jest.resetModules();
    global.App = {};
  });

  afterEach(() => {
    delete global.App;
  });

  test('marks only the real in-month day as today', () => {
    require('../../js/modules/event/event-list-calendar-build.js');

    expect(global.App._isCalendarCellToday('2026-04-28', false, '2026-04-28')).toBe(true);
    expect(global.App._isCalendarCellToday('2026-04-28', true, '2026-04-28')).toBe(false);
    expect(global.App._isCalendarCellToday('2026-04-29', false, '2026-04-28')).toBe(false);
  });
});
