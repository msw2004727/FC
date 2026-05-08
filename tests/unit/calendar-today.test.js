describe('calendar today marker', () => {
  beforeEach(() => {
    jest.resetModules();
    global.App = {};
  });

  afterEach(() => {
    delete global.App;
    delete global.ApiService;
    delete global.toDateKey;
    delete global.escapeHTML;
  });

  test('marks only the real in-month day as today', () => {
    require('../../js/modules/event/event-list-calendar-build.js');

    expect(global.App._isCalendarCellToday('2026-04-28', false, '2026-04-28')).toBe(true);
    expect(global.App._isCalendarCellToday('2026-04-28', true, '2026-04-28')).toBe(false);
    expect(global.App._isCalendarCellToday('2026-04-29', false, '2026-04-28')).toBe(false);
  });

  test('marks a registered date once even when user has multiple events that day', () => {
    global.toDateKey = (date) => {
      const [ymd] = String(date || '').split(' ');
      const [y, m, d] = ymd.split('/').map(Number);
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };
    global.ApiService = {
      getCurrentUser: () => ({ uid: 'user-1' }),
      getEvents: () => [],
    };
    global.escapeHTML = (value) => String(value ?? '');
    require('../../js/modules/event/event-list-calendar-build.js');

    global.App._getVisibleEvents = () => [
      { id: 'e1', date: '2026/05/09 19:00~21:00' },
      { id: 'e2', date: '2026/05/09 21:00~23:00' },
      { id: 'e3', date: '2026/05/10 19:00~21:00' },
    ];
    global.App._getCurrentUserEventRegistrationState = (event) => ({
      signedUp: event.id === 'e1' || event.id === 'e2',
      onWaitlist: false,
    });

    const keys = global.App._getCalendarUserRegisteredDateKeys();
    expect(Array.from(keys)).toEqual(['2026-05-09']);

    const html = global.App._buildDayCellHTML({
      dateKey: '2026-05-09',
      dayNum: 9,
      isOutside: false,
      isToday: false,
      isUserRegisteredDay: keys.has('2026-05-09'),
      isPast: false,
      events: [],
      weekRow: 1,
      weekCol: 6,
    });
    expect(html).toContain('data-user-registered="1"');
    expect((html.match(/evt-cal-user-day-check/g) || []).length).toBe(1);
  });
});
