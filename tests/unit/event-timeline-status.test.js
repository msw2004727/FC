const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

describe('activity timeline effective status label', () => {
  function loadTimelineModule(app, dom) {
    const context = {
      App: app,
      document: dom.window.document,
      window: dom.window,
      Object,
      console,
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
      Date,
    };
    context.TYPE_CONFIG = { friendly: { label: '友誼' } };
    context.STATUS_CONFIG = {
      open: { label: '報名中', css: 'open' },
      full: { label: '已額滿', css: 'full' },
      ended: { label: '已結束', css: 'ended' },
      upcoming: { label: '即將開放', css: 'upcoming' },
      cancelled: { label: '已取消', css: 'cancelled' },
    };
    context.DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
    context.escapeHTML = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    context.t = () => '請確認「右上角」活動類別，當前沒有活動';

    const source = fs.readFileSync(
      path.join(__dirname, '../../js/modules/event/event-list-timeline.js'),
      'utf8'
    );
    vm.runInNewContext(source, context);
  }

  test('uses effective capacity status instead of stale full root status', () => {
    const dom = new JSDOM(`
      <div id="page-activities"></div>
      <select id="activity-filter-type"></select>
      <input id="activity-filter-keyword" value="">
      <div id="activity-list"></div>
    `);
    const event = {
      id: 'e1',
      title: '週三晚場足球',
      type: 'friendly',
      status: 'full',
      date: '2099/01/02 19:00',
      location: '台中市三村公園',
      current: 19,
      max: 21,
      waitlist: 0,
    };
    const stats = {
      confirmedCount: 19,
      waitlistCount: 0,
      maxCount: 21,
      isCapacityFull: false,
    };
    const app = {
      currentPage: 'page-activities',
      _activityActiveTab: 'normal',
      _autoEndExpiredEvents: jest.fn(),
      _getVisibleEvents: () => [event],
      _filterByRegionTab: (events) => events,
      _filterBySportTag: (events) => events,
      _getEventParticipantStats: jest.fn(() => stats),
      _getEventEffectiveStatus: jest.fn(() => 'open'),
      _hasEventGenderRestriction: () => false,
      _renderEventSportIcon: () => '',
      _favHeartHtml: () => '',
      isEventFavorited: () => false,
      _isUserSignedUp: () => false,
      _isUserOnWaitlist: () => false,
      _bindSwipeTabs: jest.fn(),
      _markPageSnapshotReady: jest.fn(),
    };

    loadTimelineModule(app, dom);
    app._doRenderActivityList();

    const status = dom.window.document.querySelector('.tl-event-status');
    expect(status.textContent).toBe('報名中');
    expect(status.className).toContain('open');
    expect(dom.window.document.querySelector('.tl-event-row').textContent).toContain('19/21人');
  });

  test('clears pending card loading state when returning to activity list', () => {
    const dom = new JSDOM(`
      <div id="activity-list">
        <div class="tl-event-row tl-pending tl-loaded" aria-busy="true" data-tl-opening="1" onclick="App.openTimelineEventDetail('e1', this)">
          <div class="tl-loading-bar"><div class="tl-loading-fill"></div></div>
        </div>
      </div>
    `);
    const interval = setInterval(() => {}, 1000);
    const app = {
      _tlCardLoadingState: { eventId: 'e1', interval },
    };

    loadTimelineModule(app, dom);
    app._clearTimelineCardNavigationState('test');

    const row = dom.window.document.querySelector('.tl-event-row');
    expect(app._tlCardLoadingState).toBe(null);
    expect(row.classList.contains('tl-pending')).toBe(false);
    expect(row.classList.contains('tl-loaded')).toBe(false);
    expect(row.hasAttribute('aria-busy')).toBe(false);
    expect(row.dataset.tlOpening).toBeUndefined();
    expect(row.querySelector('.tl-loading-bar')).toBe(null);
    clearInterval(interval);
  });
});
