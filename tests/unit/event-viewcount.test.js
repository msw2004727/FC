const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * 活動瀏覽數（viewCount）— unit tests
 *
 * 驗證 event detail 使用受驗證 callable、後端回傳權威數字、
 * 同一頁併發去重，以及跨活動與登入身分切換時不誤更新畫面。
 */

describe('ViewCount server idempotency contract', () => {
  test('client uses the callable without a localStorage marker or direct Firestore increment', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../js/modules/event/event-detail.js'),
      'utf8'
    );
    const methodStart = source.indexOf('  async _incrementEventViewCount(eventId, options = {}) {');
    const methodEnd = source.indexOf('\n\n  _renderEventLogButton', methodStart);
    const methodSource = source.slice(methodStart, methodEnd);

    expect(methodSource).toContain("httpsCallable?.('incrementEventViewCount')");
    expect(methodSource).not.toContain('localStorage');
    expect(methodSource).not.toContain('FieldValue.increment');
  });
});

describe('ViewCount callable event detail flow', () => {
  function createHarness() {
    const order = [];
    const event = { id: 'event-1', _docId: 'event-doc-1', viewCount: 3 };
    const events = new Map([
      ['event-1', event],
      ['event-2', { id: 'event-2', _docId: 'event-doc-2', viewCount: 12 }],
    ]);
    const viewCountSpan = { textContent: '' };
    const ensureAuthReadyForWrite = jest.fn(async () => {
      order.push('auth');
      return true;
    });
    const authState = { currentUser: { uid: 'viewer-1' } };
    const callable = jest.fn(async () => {
      order.push('callable');
      return {
        data: {
          incremented: true,
          viewCount: event.viewCount + 1,
        },
      };
    });
    const httpsCallable = jest.fn(name => (
      name === 'incrementEventViewCount' ? callable : null
    ));
    const ensureFirebaseFunctionsSdk = jest.fn(async () => ({ httpsCallable }));
    const storage = new Map();
    const localStorage = {
      getItem: jest.fn(key => storage.get(key) || null),
      setItem: jest.fn((key, value) => {
        order.push('cache');
        storage.set(key, value);
      }),
    };
    const warn = jest.fn();
    const context = {
      App: {
        currentPage: 'page-activity-detail',
        _currentDetailEventId: 'event-1',
        _eventDetailRequestSeq: 1,
      },
      ApiService: { getEvent: jest.fn(eventId => events.get(eventId) || null) },
      FirebaseService: { ensureAuthReadyForWrite },
      ensureFirebaseFunctionsSdk,
      firebase: { auth: () => authState },
      localStorage,
      document: {
        getElementById: jest.fn(id => (
          id === 'detail-view-count-num' ? viewCountSpan : null
        )),
      },
      console: { warn },
      Date,
      Map,
      Set,
      String,
      Object,
      Number,
      Error,
    };
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../js/modules/event/event-detail.js'),
      'utf8'
    );
    const methodStart = source.indexOf(
      '  async _incrementEventViewCount(eventId, options = {}) {'
    );
    const methodEnd = source.indexOf('\n\n  _renderEventLogButton', methodStart);
    expect(methodStart).toBeGreaterThan(-1);
    expect(methodEnd).toBeGreaterThan(methodStart);
    vm.createContext(context);
    vm.runInContext(
      'Object.assign(App, {\n' + source.slice(methodStart, methodEnd) + '\n});',
      context
    );
    return {
      App: context.App,
      authState,
      callable,
      ensureAuthReadyForWrite,
      ensureFirebaseFunctionsSdk,
      event,
      events,
      httpsCallable,
      localStorage,
      order,
      viewCountSpan,
      warn,
    };
  }

  test('starts only after the final detail guard and forwards requestSeq', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../js/modules/event/event-detail.js'),
      'utf8'
    );
    const showStart = source.indexOf('  async showEventDetail(id, options = {}) {');
    const showEnd = source.indexOf('\n\n  _renderGroupedWaitlistSection', showStart);
    const showSource = source.slice(showStart, showEnd);
    const finalGuardIndex = showSource.indexOf(
      'const finalDetailGuard = this._isCurrentEventDetailPatch'
    );
    const incrementIndex = showSource.indexOf(
      'this._incrementEventViewCount?.(id, { requestSeq });'
    );

    expect(showStart).toBeGreaterThan(-1);
    expect(showEnd).toBeGreaterThan(showStart);
    expect(finalGuardIndex).toBeGreaterThan(-1);
    expect(incrementIndex).toBeGreaterThan(finalGuardIndex);
    expect(showSource.slice(finalGuardIndex, incrementIndex))
      .toContain('if (!finalDetailGuard.ok)');
  });

  test('uses the authenticated callable and applies the authoritative count without a client marker', async () => {
    const harness = createHarness();

    await harness.App._incrementEventViewCount('event-1');

    expect(harness.ensureAuthReadyForWrite).toHaveBeenCalledWith('viewer-1');
    expect(harness.ensureFirebaseFunctionsSdk).toHaveBeenCalledWith('asia-east1');
    expect(harness.httpsCallable).toHaveBeenCalledWith('incrementEventViewCount');
    expect(harness.callable).toHaveBeenCalledWith({
      eventId: 'event-1',
      docId: 'event-doc-1',
    });
    expect(harness.order).toEqual(['auth', 'callable']);
    expect(harness.localStorage.setItem).not.toHaveBeenCalled();
    expect(harness.event.viewCount).toBe(4);
    expect(harness.viewCountSpan.textContent).toBe('4');
  });

  test('always asks the server for the authoritative idempotent count', async () => {
    const harness = createHarness();
    harness.localStorage.getItem.mockReturnValue('1');
    harness.callable.mockResolvedValueOnce({
      data: { incremented: false, viewCount: 9 },
    });

    await harness.App._incrementEventViewCount('event-1');

    expect(harness.callable).toHaveBeenCalledTimes(1);
    expect(harness.event.viewCount).toBe(9);
    expect(harness.viewCountSpan.textContent).toBe('9');
  });

  test('repeated completed calls can refresh the server-idempotent count', async () => {
    const harness = createHarness();

    harness.callable
      .mockResolvedValueOnce({ data: { incremented: true, viewCount: 4 } })
      .mockResolvedValueOnce({ data: { incremented: false, viewCount: 4 } });

    await harness.App._incrementEventViewCount('event-1');
    await harness.App._incrementEventViewCount('event-1');

    expect(harness.callable).toHaveBeenCalledTimes(2);
    expect(harness.event.viewCount).toBe(4);
    expect(harness.warn).not.toHaveBeenCalled();
  });
  test('does not call the backend when auth readiness fails', async () => {
    const harness = createHarness();
    harness.ensureAuthReadyForWrite.mockResolvedValue(false);

    await harness.App._incrementEventViewCount('event-1');

    expect(harness.callable).not.toHaveBeenCalled();
    expect(harness.localStorage.setItem).not.toHaveBeenCalled();
    expect(harness.event.viewCount).toBe(3);
  });

  test('does not call the backend when the signed-in uid changes while auth settles', async () => {
    const harness = createHarness();
    harness.ensureAuthReadyForWrite.mockImplementation(async () => {
      harness.authState.currentUser = { uid: 'viewer-2' };
      return true;
    });

    await harness.App._incrementEventViewCount('event-1');

    expect(harness.callable).not.toHaveBeenCalled();
    expect(harness.localStorage.setItem).not.toHaveBeenCalled();
  });

  test('failed or invalid callable responses can retry without client-side suppression', async () => {
    const harness = createHarness();
    harness.callable
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ data: { incremented: 'yes', viewCount: 4 } });

    await harness.App._incrementEventViewCount('event-1');
    await harness.App._incrementEventViewCount('event-1');

    expect(harness.localStorage.setItem).not.toHaveBeenCalled();
    expect(harness.event.viewCount).toBe(3);

    harness.callable.mockImplementationOnce(async () => ({
      data: { incremented: true, viewCount: 4 },
    }));
    await harness.App._incrementEventViewCount('event-1');

    expect(harness.callable).toHaveBeenCalledTimes(3);
    expect(harness.localStorage.setItem).not.toHaveBeenCalled();
    expect(harness.event.viewCount).toBe(4);
  });

  test('does not patch event B when event A callable resolves late', async () => {
    const harness = createHarness();
    let resolveCallable;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    harness.callable.mockImplementation(() => new Promise(resolve => {
      harness.order.push('callable');
      resolveCallable = resolve;
      markStarted();
    }));

    const incrementA = harness.App._incrementEventViewCount(
      'event-1',
      { requestSeq: 1 }
    );
    await started;

    harness.App._eventDetailRequestSeq = 2;
    harness.App._currentDetailEventId = 'event-2';
    harness.viewCountSpan.textContent = '12';
    resolveCallable({ data: { incremented: true, viewCount: 4 } });
    await incrementA;

    expect(harness.event.viewCount).toBe(4);
    expect(harness.events.get('event-2').viewCount).toBe(12);
    expect(harness.viewCountSpan.textContent).toBe('12');
  });

  test('deduplicates concurrent calls for the same viewer and event', async () => {
    const harness = createHarness();
    let resolveAuth;
    harness.ensureAuthReadyForWrite.mockImplementation(() => new Promise(resolve => {
      resolveAuth = resolve;
    }));

    const first = harness.App._incrementEventViewCount('event-1');
    const second = harness.App._incrementEventViewCount('event-1');
    expect(harness.ensureAuthReadyForWrite).toHaveBeenCalledTimes(1);

    resolveAuth(true);
    await Promise.all([first, second]);

    expect(harness.callable).toHaveBeenCalledTimes(1);
    expect(harness.localStorage.setItem).not.toHaveBeenCalled();
  });

  test('A to B to A lets the newest A request patch the shared result', async () => {
    const harness = createHarness();
    let resolveCallable;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    harness.callable.mockImplementation(() => new Promise(resolve => {
      harness.order.push('callable');
      resolveCallable = resolve;
      markStarted();
    }));

    const firstA = harness.App._incrementEventViewCount(
      'event-1',
      { requestSeq: 1 }
    );
    await started;

    harness.App._currentDetailEventId = 'event-2';
    harness.App._eventDetailRequestSeq = 2;
    harness.App._currentDetailEventId = 'event-1';
    harness.App._eventDetailRequestSeq = 3;
    harness.viewCountSpan.textContent = '3';

    const latestA = harness.App._incrementEventViewCount(
      'event-1',
      { requestSeq: 3 }
    );
    resolveCallable({ data: { incremented: true, viewCount: 4 } });
    await Promise.all([firstA, latestA]);

    expect(harness.callable).toHaveBeenCalledTimes(1);
    expect(harness.event.viewCount).toBe(4);
    expect(harness.viewCountSpan.textContent).toBe('4');
  });

  test('uses separate server identities after the signed-in viewer changes', async () => {
    const harness = createHarness();

    await harness.App._incrementEventViewCount('event-1');
    harness.authState.currentUser = { uid: 'viewer-2' };
    await harness.App._incrementEventViewCount('event-1');

    expect(harness.callable).toHaveBeenCalledTimes(2);
    expect(harness.localStorage.setItem).not.toHaveBeenCalled();
    expect(harness.event.viewCount).toBe(5);
  });
});
