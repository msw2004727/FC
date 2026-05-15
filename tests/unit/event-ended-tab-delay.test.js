const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('activity ended tab delay', () => {
  function loadStatsModule() {
    const app = {};
    const source = fs.readFileSync(
      path.join(__dirname, '../../js/modules/event/event-list-stats.js'),
      'utf8'
    );
    vm.runInNewContext(source, {
      App: app,
      ApiService: {},
      Object,
      console,
      Date,
      Number,
      parseInt,
      Array,
      Set,
      Map,
      Math,
      String,
    });
    return app;
  }

  test('keeps ended events in the active activity tab until six hours after end time', () => {
    const app = loadStatsModule();
    const event = { status: 'ended', date: '2026/05/09 15:00~17:00' };

    expect(app._isEventInActivityEndedTab(event, new Date(2026, 4, 9, 22, 59))).toBe(false);
    expect(app._isEventInActivityEndedTab(event, new Date(2026, 4, 9, 23, 0))).toBe(true);
  });

  test('keeps cancelled events in the active activity tab until six hours after end time', () => {
    const app = loadStatsModule();
    const event = { status: 'cancelled', date: '2026/05/09 15:00~17:00' };

    expect(app._isEventInActivityEndedTab(event, new Date(2026, 4, 9, 22, 59))).toBe(false);
    expect(app._isEventInActivityEndedTab(event, new Date(2026, 4, 9, 23, 0))).toBe(true);
  });
});
