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

  test('skips unchanged cards but rerenders when timeline date or location changes', () => {
    const dom = new JSDOM(`
      <div id="page-activities"></div>
      <select id="activity-filter-type"></select>
      <input id="activity-filter-keyword" value="">
      <div id="activity-list"></div>
    `);
    const event = {
      id: 'e1',
      title: 'Cached Timeline Event',
      type: 'friendly',
      status: 'open',
      date: '2099/01/02 19:00',
      location: 'Main Field',
      current: 2,
      max: 10,
      waitlist: 0,
    };
    const app = {
      currentPage: 'page-activities',
      _activityActiveTab: 'normal',
      _autoEndExpiredEvents: jest.fn(),
      _getVisibleEvents: () => [event],
      _filterByRegionTab: events => events,
      _filterBySportTag: events => events,
      _getEventParticipantStats: jest.fn(() => ({
        confirmedCount: 2,
        waitlistCount: 0,
        maxCount: 10,
        occupiedCount: 2,
        reservedRemainingCount: 0,
        isCapacityFull: false,
      })),
      _getEventEffectiveStatus: () => 'open',
      _hasEventGenderRestriction: () => false,
      _renderEventSportIcon: jest.fn(() => ''),
      _favHeartHtml: () => '',
      isEventFavorited: () => false,
      _isUserSignedUp: () => false,
      _isUserOnWaitlist: () => false,
      _bindSwipeTabs: jest.fn(),
      _markPageSnapshotReady: jest.fn(),
    };

    loadTimelineModule(app, dom);
    app._scheduleActivityCommentBadges = jest.fn();
    app._doRenderActivityList();
    app._doRenderActivityList();

    expect(app._renderEventSportIcon).toHaveBeenCalledTimes(1);
    expect(app._getEventParticipantStats).toHaveBeenCalledTimes(2);
    expect(dom.window.document.querySelectorAll('.tl-event-row')).toHaveLength(1);

    event.viewCount = 99;
    event.updatedAt = '2099-01-01T00:00:00Z';
    app._doRenderActivityList();
    expect(app._renderEventSportIcon).toHaveBeenCalledTimes(1);
    expect(app._getEventParticipantStats).toHaveBeenCalledTimes(3);

    event.location = 'Updated Field';
    app._doRenderActivityList();
    expect(dom.window.document.querySelector('.tl-event-meta').textContent).toContain('Updated Field');

    event.date = '2099/02/03 20:30';
    app._doRenderActivityList();
    expect(dom.window.document.querySelector('.tl-month-header').textContent).toContain('2099 年 2 月');
    expect(dom.window.document.querySelector('.tl-day-num').textContent).toBe('3');
    expect(dom.window.document.querySelector('.tl-event-meta').textContent).toContain('20:30');
    expect(app._renderEventSportIcon).toHaveBeenCalledTimes(3);
    expect(app._getEventParticipantStats).toHaveBeenCalledTimes(5);
  });

  test('debounced timeline render does not run after navigation leaves the list', () => {
    jest.useFakeTimers();
    try {
      const dom = new JSDOM('<div id="activity-list"></div>');
      const app = {
        currentPage: 'page-activities',
        _syncActivityFemaleTheme: jest.fn(),
        _syncActivityMapEntry: jest.fn(),
        _refreshActivityCreateButton: jest.fn(),
      };

      loadTimelineModule(app, dom);
      app._doRenderActivityList = jest.fn();
      app.renderActivityList();
      app.currentPage = 'page-activity-detail';
      jest.advanceTimersByTime(100);

      expect(app._doRenderActivityList).not.toHaveBeenCalled();
      expect(app._activityListRenderTimer).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('renders activity card comment badge and updates count without opening comments', () => {
    const dom = new JSDOM(`
      <div id="page-activities"></div>
      <select id="activity-filter-type"></select>
      <input id="activity-filter-keyword" value="">
      <div id="activity-list"></div>
    `);
    const event = {
      id: 'e1',
      title: 'Morning Match',
      type: 'friendly',
      status: 'open',
      date: '2099/01/02 19:00',
      location: 'Main Field',
      current: 2,
      max: 10,
      waitlist: 0,
    };
    const app = {
      currentPage: 'page-activities',
      _activityActiveTab: 'normal',
      _autoEndExpiredEvents: jest.fn(),
      _getVisibleEvents: () => [event],
      _filterByRegionTab: (events) => events,
      _filterBySportTag: (events) => events,
      _getEventParticipantStats: jest.fn(() => ({
        confirmedCount: 2,
        waitlistCount: 0,
        maxCount: 10,
        isCapacityFull: false,
      })),
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

    const row = dom.window.document.querySelector('.tl-event-row');
    expect(row.dataset.eventId).toBe('e1');
    const statusStack = row.querySelector('.tl-event-status-stack');
    expect(statusStack).not.toBe(null);
    expect(statusStack.querySelector('.tl-event-status')).not.toBe(null);
    const badge = statusStack.querySelector('.tl-comment-badge');
    expect(badge).not.toBe(null);
    expect(badge.hidden).toBe(true);
    expect(badge.querySelector('svg')).not.toBe(null);
    expect(row.querySelector('.tl-event-icons .tl-comment-badge')).toBe(null);

    app._setActivityCommentBadgeCount(row, 'e1', 4);

    expect(badge.hidden).toBe(false);
    expect(badge.querySelector('.tl-comment-badge-count').textContent).toBe('4');
    expect(badge.getAttribute('aria-label')).toBe('4 則留言');
  });

  test('sums visible comment badge count with replies while skipping duplicate and deleted docs', () => {
    const dom = new JSDOM('<div></div>');
    const app = {};
    loadTimelineModule(app, dom);
    const doc = (id, data) => ({ id, data: () => data });

    const total = app._sumActivityCommentBadgeSnapshot({
      docs: [
        doc('c1', { replyCount: 2 }),
        doc('c2', { replyCount: '1' }),
        doc('c1', { replyCount: 9 }),
        doc('c3', { deleted: true, replyCount: 5 }),
      ],
    });

    expect(total).toBe(5);
  });

  test('comment badge row queue can refresh on a newer render sequence', () => {
    const dom = new JSDOM('<div class="tl-event-row" data-event-id="e1"></div>');
    const app = {};
    loadTimelineModule(app, dom);
    app._drainActivityCommentBadgeQueue = jest.fn();
    const row = dom.window.document.querySelector('.tl-event-row');

    app._queueActivityCommentBadgeRow(row, 1);
    app._queueActivityCommentBadgeRow(row, 1);
    app._queueActivityCommentBadgeRow(row, 2);

    expect(app._activityCommentBadgeQueue.map(item => item.seq)).toEqual([1, 2]);
    expect(app._drainActivityCommentBadgeQueue).toHaveBeenCalledTimes(2);
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

  test('activity keyword search supports fuzzy multi-field matching', () => {
    const dom = new JSDOM('<div></div>');
    const app = {};
    loadTimelineModule(app, dom);
    const event = {
      title: '週五晚間足球友誼賽',
      location: '台中市西屯足球場',
      date: '2026/05/22 20:00',
      hostName: '金小麥',
      sportTag: 'football',
    };

    expect(app._matchesActivityKeyword(event, '西屯')).toBe(true);
    expect(app._matchesActivityKeyword(event, '週五 金小麥')).toBe(true);
    expect(app._matchesActivityKeyword(event, '晚足')).toBe(true);
    expect(app._matchesActivityKeyword(event, '台南')).toBe(false);
  });
});
