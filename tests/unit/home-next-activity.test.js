const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { escapeJsAttr } = require('../helpers/event-binding');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/home-next-activity.js'),
  'utf8'
);

function runModule(options = {}) {
  const dom = new JSDOM('<!doctype html><section id="home-next-activity"></section>', {
    url: 'https://example.test/',
  });
  const app = {
    showPage: jest.fn(),
    openHomeCreateEvent: jest.fn(),
    addEventToCalendar: jest.fn(),
    showToast: jest.fn(),
    _getEventImageUrl: jest.fn((event, variantKey) => {
      const variants = event?.imageVariants && typeof event.imageVariants === 'object'
        ? event.imageVariants
        : {};
      if (variantKey && variants[variantKey]) return variants[variantKey];
      if (variantKey !== 'cover' && variants.cover) return variants.cover;
      return event?.image || '';
    }),
  };
  const registrations = options.registrations || [];
  const events = options.events || [];
  const currentUser = options.currentUser === undefined
    ? { uid: 'u1', displayName: 'User One' }
    : options.currentUser;
  if (options.storedCache) {
    dom.window.localStorage.setItem(
      `toosterx.homeNextActivity.v1.${options.storedCache.uid}`,
      JSON.stringify(options.storedCache)
    );
  }
  if (options.rawStoredCache) {
    dom.window.localStorage.setItem(
      `toosterx.homeNextActivity.v1.${options.rawStoredCache.keyUid}`,
      JSON.stringify(options.rawStoredCache.record)
    );
  }
  const context = vm.createContext({
    window: dom.window,
    globalThis: dom.window,
    document: dom.window.document,
    console: options.console || console,
    ...(options.db ? { db: options.db } : {}),
    App: app,
    ApiService: {
      getCurrentUser: jest.fn(() => currentUser),
      getRegistrations: jest.fn(() => registrations),
      getEvent: jest.fn(id => events.find(event => event.id === id || event._docId === id) || null),
      getEvents: jest.fn(() => events),
    },
    FirebaseService: {
      _cache: { events: events.slice(), registrations: registrations.slice(), currentUser },
      ...(options.firebaseExtras || {}),
    },
    ScriptLoader: {
      ensureForPage: jest.fn().mockResolvedValue(undefined),
      ensureGroup: jest.fn().mockResolvedValue(undefined),
    },
    escapeHTML: value => String(value ?? ''),
    escapeJsAttr,
  });
  vm.runInContext(options.source || source, context, { filename: 'js/modules/home-next-activity.js' });
  return { app, dom, context };
}

// ── T-034：報名查詢（collectionGroup）相關輔助 ─────────────────────────

// Firestore collectionGroup 預設依「完整文件路徑」逐段排序；這裡照做，limit 才會在排序之後才截。
function comparePath(a, b) {
  const pa = a.split('/');
  const pb = b.split('/');
  for (let i = 0; i < Math.min(pa.length, pb.length); i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return pa.length - pb.length;
}

// 假的 db.collectionGroup('registrations')：真的實作 where('==')、where('in')、依文件路徑排序後 limit。
// 不支援的運算子直接丟錯；每個查詢的形狀與回傳筆數記在 db.queries，供測試斷言。
// docs：[{ path, data }]；failUids：userId == 這些值的查詢會 reject（模擬單一 uid 查詢失敗）。
// cacheUids：這些 uid 的查詢回 metadata.fromCache === true（離線時 get() 退回本機快取）；
// noMetadataUids：這些 uid 的查詢快照沒有 metadata。其餘一律 fromCache === false（伺服器結果）。
// 每個文件帶 ref.parent.parent：子集合文件（events/{id}/registrations/{id}）為非 null，舊根文件（registrations/{id}）為 null。
function createFakeDb(docs, { failUids = [], cacheUids = [], noMetadataUids = [] } = {}) {
  const queries = [];
  const registrationSnap = (list, queryUid) => ({
    docs: list.map(item => {
      const segments = item.path.split('/');
      return {
        id: segments[segments.length - 1],
        data: () => ({ ...item.data }),
        ref: {
          path: item.path,
          parent: {
            path: segments.slice(0, -1).join('/'),
            parent: segments.length > 2 ? { path: segments.slice(0, -2).join('/') } : null,
          },
        },
      };
    }),
    size: list.length,
    ...(noMetadataUids.includes(queryUid) ? {} : { metadata: { fromCache: cacheUids.includes(queryUid) } }),
  });
  const emptySnap = { docs: [], size: 0 };
  return {
    queries,
    collectionGroup(name) {
      const query = { collection: name, filters: [], limit: null, returned: null };
      queries.push(query);
      const builder = {
        where(field, op, value) {
          query.filters.push({ field, op, value });
          return builder;
        },
        limit(n) {
          query.limit = n;
          return builder;
        },
        async get() {
          const userFilter = query.filters.find(f => f.field === 'userId' && f.op === '==');
          if (userFilter && failUids.includes(userFilter.value)) throw new Error('fake registration query failure');
          let rows = docs.slice().sort((a, b) => comparePath(a.path, b.path));
          query.filters.forEach(({ field, op, value }) => {
            if (op === '==') rows = rows.filter(row => row.data[field] === value);
            else if (op === 'in') {
              if (!Array.isArray(value)) throw new Error('fake db: "in" needs an array');
              rows = rows.filter(row => value.includes(row.data[field]));
            } else throw new Error(`fake db: unsupported operator ${op}`);
          });
          if (query.limit != null) rows = rows.slice(0, query.limit);
          query.returned = rows.length;
          return registrationSnap(rows, userFilter?.value);
        },
      };
      return builder;
    },
    // 首頁卡片還會查「我主辦／受委託的活動」；測試資料沒有，一律回空。
    collection() {
      const builder = {
        where: () => builder,
        limit: () => builder,
        get: async () => emptySnap,
        doc: () => ({ get: async () => ({ exists: false }) }),
      };
      return builder;
    },
  };
}

function quietConsole() {
  return { log: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() };
}

const pad3 = n => String(n).padStart(3, '0');

// 站長帳號形狀：309 筆（217 筆 cancelled），依文件路徑排序後前 120 筆只有 6 筆有效（外加 1 筆 removed），
// 明天與後天的有效報名排在路徑第 158、159 筆（0 起算 157、158）。這是依 2026-10-25 診斷數字人工排出的壓力資料，
// 不是逐筆重放。另外放 3 筆別人的報名，證明 userId 篩選有真的在跑。
function buildStressRegistrations(uid) {
  const early = new Set([10, 30, 50, 70, 90, 110]);
  const statuses = [];
  for (let i = 0; i < 120; i += 1) statuses.push(early.has(i) ? 'confirmed' : (i === 119 ? 'removed' : 'cancelled'));
  for (let i = 120; i < 157; i += 1) statuses.push('cancelled');
  statuses.push('confirmed', 'waitlisted'); // 157、158：明天、後天的報名
  const tail = Array(150).fill('cancelled');
  for (let j = 0; j < 83; j += 1) {
    tail[Math.round(j * 150 / 83)] = (j === 0 || j === 41) ? 'waitlisted' : (j === 82 ? 'removed' : 'confirmed');
  }
  statuses.push(...tail);
  const docs = statuses.map((status, i) => {
    let eventId = `evt-other-${pad3(i)}`;
    if (i === 157) eventId = 'evt-tomorrow';
    else if (i === 158) eventId = 'evt-day-after';
    else if (early.has(i)) eventId = 'evt-past';
    return {
      path: `events/evt-doc-${pad3(i)}/registrations/reg-${pad3(i)}`,
      data: { userId: uid, eventId, status, participantType: 'self' },
    };
  });
  for (let k = 0; k < 3; k += 1) {
    docs.push({
      path: `events/evt-doc-${pad3(157)}/registrations/reg-someone-else-${k}`,
      data: { userId: 'someone-else', eventId: 'evt-tomorrow', status: 'confirmed', participantType: 'self' },
    });
  }
  return docs;
}

const STRESS_EVENTS = [
  { id: 'evt-past', title: 'Past Match', date: '2000/05/21 20:00~22:00', location: 'Old Center', status: 'open' },
  { id: 'evt-tomorrow', title: 'Tomorrow Match', date: '2099/05/20 18:00~20:00', location: 'Tomorrow Center', status: 'open' },
  { id: 'evt-day-after', title: 'Day After Match', date: '2099/05/21 18:00~20:00', location: 'Day After Center', status: 'open' },
];

function bulkActiveRegistrations(uid, count) {
  return Array.from({ length: count }, (_, i) => ({
    path: `events/evt-bulk-${pad3(i)}/registrations/reg-bulk-${pad3(i)}`,
    data: { userId: uid, eventId: `evt-bulk-${pad3(i)}`, status: 'confirmed', participantType: 'self' },
  }));
}

const STATUS_IN = ['confirmed', 'waitlisted', 'registered'];
const emptyCardText = '你目前還沒有報名活動';

describe('home next activity', () => {
  test('renders the nearest future registered activity from cache', async () => {
    const { app, dom } = runModule({
      registrations: [
        { id: 'r1', eventId: 'evt-late', userId: 'u1', status: 'confirmed' },
        { id: 'r2', eventId: 'evt-next', userId: 'u1', status: 'waitlisted' },
      ],
      events: [
        { id: 'evt-late', title: 'Late Match', date: '2099/05/21 20:00~22:00', location: 'A Center', status: 'open', image: 'late.jpg' },
        { id: 'evt-next', title: 'Next Match', date: '2099/05/20 18:00~20:00', location: 'B Center', status: 'open', image: 'next.jpg' },
      ],
    });

    await app.renderHomeNextActivity({ force: true });

    const host = dom.window.document.getElementById('home-next-activity');
    expect(host.textContent).toContain('我的下一場活動');
    expect(host.textContent).toContain('Next Match');
    expect(host.textContent).toContain('B Center');
    expect(host.textContent).toContain('05/20');
    expect(host.textContent).not.toContain('Late Match');
    expect(host.querySelector('.home-next-cover img')?.getAttribute('src')).toBe('next.jpg');
    expect(host.querySelector('.home-next-status-pill')?.textContent).toBe('候補');
    expect(host.querySelector('.home-next-status-pill')?.classList.contains('home-next-status-waitlisted')).toBe(true);
  });

  test('uses the home next image variant before the legacy cover image', async () => {
    const { app, dom } = runModule({
      registrations: [
        { id: 'r1', eventId: 'evt-next', userId: 'u1', status: 'confirmed' },
      ],
      events: [
        {
          id: 'evt-next',
          title: 'Variant Match',
          date: '2099/05/20 18:00~20:00',
          location: 'Variant Center',
          status: 'open',
          image: 'legacy-cover.jpg',
          imageVariants: { cover: 'wide-cover.jpg', homeNext: 'home-next-4x3.jpg' },
        },
      ],
    });

    await app.renderHomeNextActivity({ force: true });

    const host = dom.window.document.getElementById('home-next-activity');
    expect(host.querySelector('.home-next-cover img')?.getAttribute('src')).toBe('home-next-4x3.jpg');
  });

  test('skips cancelled registrations and already-started events', async () => {
    const { app, dom } = runModule({
      registrations: [
        { id: 'r1', eventId: 'evt-past', userId: 'u1', status: 'confirmed' },
        { id: 'r2', eventId: 'evt-cancelled', userId: 'u1', status: 'cancelled' },
        { id: 'r3', eventId: 'evt-future', userId: 'u1', status: 'registered' },
      ],
      events: [
        { id: 'evt-past', title: 'Past Match', date: '2000/05/21 20:00~22:00', location: 'Old Center', status: 'open' },
        { id: 'evt-cancelled', title: 'Cancelled Match', date: '2099/05/19 20:00~22:00', location: 'Closed Center', status: 'open' },
        { id: 'evt-future', title: 'Future Match', date: '2099/05/22 20:00~22:00', location: 'Future Center', status: 'open' },
      ],
    });

    await app.renderHomeNextActivity({ force: true });

    const host = dom.window.document.getElementById('home-next-activity');
    expect(host.textContent).toContain('Future Match');
    expect(host.textContent).not.toContain('Past Match');
    expect(host.textContent).not.toContain('Cancelled Match');
    expect(host.querySelector('.home-next-status-pill')?.textContent).toBe('正取');
    expect(host.querySelector('.home-next-status-pill')?.classList.contains('home-next-status-confirmed')).toBe(true);
  });

  test('renders empty state when the user has no future registrations', async () => {
    const { app, dom } = runModule({ registrations: [], events: [] });

    await app.renderHomeNextActivity({ force: true });

    const host = dom.window.document.getElementById('home-next-activity');
    expect(host.textContent).toContain('你目前還沒有報名活動');
    expect(host.textContent).toContain('找活動');
    expect(host.textContent).toContain('我要開團');

    expect(host.querySelector('.home-next-ball-art')).toBeNull();

    host.querySelector('[data-home-next-action="find"]').click();
    host.querySelector('[data-home-next-action="create"]').click();
    expect(app.showPage).toHaveBeenCalledWith('page-activities');
    expect(app.openHomeCreateEvent).toHaveBeenCalled();
  });

  test('renders the nearest managed activity when the user has no registrations', async () => {
    const { app, dom } = runModule({
      registrations: [],
      events: [
        { id: 'evt-owner-late', title: 'Owner Late', date: '2099/05/24 20:00~22:00', location: 'Owner Center', status: 'open', creatorUid: 'u1' },
        { id: 'evt-delegate-next', title: 'Delegate Next', date: '2099/05/20 18:00~20:00', location: 'Delegate Center', status: 'open', delegateUids: ['u1'] },
      ],
    });

    await app.renderHomeNextActivity({ force: true });

    const host = dom.window.document.getElementById('home-next-activity');
    expect(host.textContent).toContain('Delegate Next');
    expect(host.textContent).toContain('Delegate Center');
    expect(host.textContent).not.toContain('Owner Late');
    expect(host.querySelector('.home-next-status-pill')?.textContent).toBe('\u59d4\u8a17');
    expect(host.querySelector('.home-next-status-pill')?.classList.contains('home-next-status-delegate')).toBe(true);
  });

  test('chooses the nearest activity across registered and managed candidates', async () => {
    const { app, dom } = runModule({
      registrations: [
        { id: 'r1', eventId: 'evt-registered-late', userId: 'u1', status: 'confirmed' },
      ],
      events: [
        { id: 'evt-registered-late', title: 'Registered Late', date: '2099/05/26 20:00~22:00', location: 'Late Center', status: 'open' },
        { id: 'evt-owner-next', title: 'Owner Next', date: '2099/05/21 19:00~21:00', location: 'Owner Center', status: 'open', creatorUid: 'u1' },
      ],
    });

    await app.renderHomeNextActivity({ force: true });

    const host = dom.window.document.getElementById('home-next-activity');
    expect(host.textContent).toContain('Owner Next');
    expect(host.textContent).not.toContain('Registered Late');
    expect(host.querySelector('.home-next-status-pill')?.textContent).toBe('\u4e3b\u8fa6');
    expect(host.querySelector('.home-next-status-pill')?.classList.contains('home-next-status-owner')).toBe(true);
  });

  test('falls back to a managed activity when a registration points to a missing event', async () => {
    const { app, dom } = runModule({
      registrations: [
        { id: 'r1', eventId: 'stale-event-id', userId: 'u1', status: 'confirmed' },
      ],
      events: [
        { id: 'evt-owned-current', title: 'Owned Current', date: '2099/05/22 18:00~20:00', location: 'Current Center', status: 'open', ownerUid: 'u1' },
      ],
    });

    await app.renderHomeNextActivity({ force: true });

    const host = dom.window.document.getElementById('home-next-activity');
    expect(host.textContent).toContain('Owned Current');
    expect(host.textContent).toContain('Current Center');
    expect(host.querySelector('.home-next-status-pill')?.textContent).toBe('\u4e3b\u8fa6');
  });

  test('view all opens the activity list page', async () => {
    const { app, dom } = runModule({
      registrations: [
        { id: 'r1', eventId: 'evt-next', userId: 'u1', status: 'confirmed' },
      ],
      events: [
        { id: 'evt-next', title: 'Next Match', date: '2099/05/20 18:00~20:00', location: 'B Center', status: 'open' },
      ],
    });

    await app.renderHomeNextActivity({ force: true });
    dom.window.document.querySelector('[data-home-next-action="all"]').click();

    expect(app.showPage).toHaveBeenCalledWith('page-activities');
  });

  test('calendar button lazy-loads the existing activity calendar module path', async () => {
    const { app, dom, context } = runModule({
      registrations: [
        { id: 'r1', eventId: 'evt-next', userId: 'u1', status: 'confirmed' },
      ],
      events: [
        { id: 'evt-next', title: 'Next Match', date: '2099/05/20 18:00~20:00', location: 'B Center', status: 'open' },
      ],
    });

    await app.renderHomeNextActivity({ force: true });
    const calendarButton = dom.window.document.querySelector('[data-home-next-action="calendar"]');
    expect(calendarButton.textContent).toContain('加入行事曆');
    expect(calendarButton.querySelector('svg')).toBeNull();

    dom.window.document.querySelector('[data-home-next-action="calendar"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(context.ScriptLoader.ensureGroup).toHaveBeenCalledWith('activity');
    expect(app.addEventToCalendar).toHaveBeenCalledWith('evt-next');
  });

  test('renders a fresh stored cache without querying registrations', async () => {
    const { app, dom, context } = runModule({
      registrations: [],
      events: [],
      storedCache: {
        uid: 'u1',
        loadedAt: Date.now(),
        next: {
          event: {
            id: 'evt-stored',
            title: 'Stored Match',
            date: '2099/05/20 18:00~20:00',
            location: 'Stored Center',
            status: 'open',
          },
          registration: { status: 'confirmed', eventId: 'evt-stored', userId: 'u1' },
        },
      },
    });
    context.ApiService.getRegistrations.mockClear();

    await app.renderHomeNextActivity({ force: true });

    const host = dom.window.document.getElementById('home-next-activity');
    expect(host.textContent).toContain('Stored Match');
    expect(host.textContent).toContain('Stored Center');
    expect(context.ApiService.getRegistrations).not.toHaveBeenCalled();
  });

  test('does not reuse a stored cache record from another uid even when it is under the current uid key', async () => {
    const { app, dom, context } = runModule({
      registrations: [
        { id: 'r1', eventId: 'evt-live', userId: 'u1', status: 'confirmed' },
      ],
      events: [
        { id: 'evt-live', title: 'Live User Match', date: '2099/05/20 18:00~20:00', location: 'Live Center', status: 'open' },
      ],
      rawStoredCache: {
        keyUid: 'u1',
        record: {
          uid: 'other-user',
          loadedAt: Date.now(),
          next: {
            event: { id: 'evt-other', title: 'Other User Match', date: '2099/05/20 18:00~20:00', status: 'open' },
            registration: { status: 'confirmed', eventId: 'evt-other', userId: 'other-user' },
          },
        },
      },
    });

    await app.renderHomeNextActivity({ force: true });

    const host = dom.window.document.getElementById('home-next-activity');
    expect(host.textContent).toContain('Live User Match');
    expect(host.textContent).not.toContain('Other User Match');
    expect(context.ApiService.getRegistrations).toHaveBeenCalled();
  });

  test('ignores display-expired stored cache and resolves the next activity again', async () => {
    const { app, dom, context } = runModule({
      registrations: [
        { id: 'r1', eventId: 'evt-refreshed', userId: 'u1', status: 'confirmed' },
      ],
      events: [
        { id: 'evt-refreshed', title: 'Refreshed Match', date: '2099/05/20 18:00~20:00', location: 'Refresh Center', status: 'open' },
      ],
      storedCache: {
        uid: 'u1',
        loadedAt: Date.now() - (61 * 60 * 1000),
        next: {
          event: { id: 'evt-expired', title: 'Expired Match', date: '2099/05/20 18:00~20:00', status: 'open' },
          registration: { status: 'confirmed', eventId: 'evt-expired', userId: 'u1' },
        },
      },
    });

    await app.renderHomeNextActivity({ force: true });

    const host = dom.window.document.getElementById('home-next-activity');
    expect(host.textContent).toContain('Refreshed Match');
    expect(host.textContent).not.toContain('Expired Match');
    expect(context.ApiService.getRegistrations).toHaveBeenCalled();
  });

  test('renders displayable stale cache first and refreshes it in the background', async () => {
    const { app, dom, context } = runModule({
      registrations: [
        { id: 'r1', eventId: 'evt-updated', userId: 'u1', status: 'confirmed' },
      ],
      events: [
        { id: 'evt-updated', title: 'Updated Match', date: '2099/05/20 18:00~20:00', location: 'Updated Center', status: 'open' },
      ],
      storedCache: {
        uid: 'u1',
        loadedAt: Date.now() - (11 * 60 * 1000),
        next: {
          event: { id: 'evt-stale', title: 'Stale Match', date: '2099/05/20 18:00~20:00', location: 'Stale Center', status: 'open' },
          registration: { status: 'confirmed', eventId: 'evt-stale', userId: 'u1' },
        },
      },
    });

    await app.renderHomeNextActivity({ force: true });

    const host = dom.window.document.getElementById('home-next-activity');
    expect(host.textContent).toContain('Stale Match');
    expect(host.textContent).not.toContain('Updated Match');

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(host.textContent).toContain('Updated Match');
    expect(host.textContent).not.toContain('Stale Match');
    expect(context.ApiService.getRegistrations).toHaveBeenCalled();
  });

  test('invalidateHomeNextActivityCache clears memory and stored cache', async () => {
    const { app, dom } = runModule({
      storedCache: {
        uid: 'u1',
        loadedAt: Date.now(),
        next: {
          event: {
            id: 'evt-stored',
            title: 'Stored Match',
            date: '2099/05/20 18:00~20:00',
            location: 'Stored Center',
            status: 'open',
          },
          registration: { status: 'confirmed', eventId: 'evt-stored', userId: 'u1' },
        },
      },
    });

    await app.renderHomeNextActivity({ force: true });
    expect(app._homeNextActivityCache?.next?.event?.id).toBe('evt-stored');

    app.invalidateHomeNextActivityCache('u1');

    expect(app._homeNextActivityCache).toBeNull();
    expect(dom.window.localStorage.getItem('toosterx.homeNextActivity.v1.u1')).toBeNull();
  });
});

describe('home next activity registration query (T-034)', () => {
  async function renderWith(options) {
    const result = runModule(options);
    await result.app.renderHomeNextActivity({ force: true });
    return { ...result, host: result.dom.window.document.getElementById('home-next-activity') };
  }

  const registrationQueries = db => db.queries.filter(query => query.collection === 'registrations');
  const hasStatusIn = query => query.filters.some(f => f.field === 'status' && f.op === 'in');

  test('309 registrations (217 cancelled): the status-in query reaches the target the old query truncated', async () => {
    const docs = buildStressRegistrations('u1');
    const mine = docs.filter(d => d.data.userId === 'u1');
    expect(mine).toHaveLength(309);
    expect(mine.filter(d => d.data.status === 'cancelled')).toHaveLength(217);
    expect(mine.filter(d => d.data.status === 'removed')).toHaveLength(2);
    expect(mine.filter(d => STATUS_IN.includes(d.data.status))).toHaveLength(90);
    const db = createFakeDb(docs);

    const { host } = await renderWith({ db, events: STRESS_EVENTS, console: quietConsole() });

    expect(host.textContent).toContain('Tomorrow Match');
    expect(host.textContent).not.toContain(emptyCardText);
    const queries = registrationQueries(db);
    expect(queries).toHaveLength(1);
    expect(queries[0].filters).toEqual([
      { field: 'userId', op: '==', value: 'u1' },
      { field: 'status', op: 'in', value: STATUS_IN },
    ]);
    expect(queries[0].limit).toBe(500);
    expect(queries[0].returned).toBe(90);
  });

  test('the fake db really filters and sorts by document path before limit (guards against a false green)', async () => {
    const docs = buildStressRegistrations('u1');
    const db = createFakeDb(docs);

    const oldShape = await db.collectionGroup('registrations').where('userId', '==', 'u1').limit(120).get();
    const oldIds = oldShape.docs.map(d => d.id);
    expect(oldIds).toHaveLength(120);
    expect(oldIds).not.toContain('reg-157');
    expect(oldIds).not.toContain('reg-158');
    expect(oldShape.docs.filter(d => STATUS_IN.includes(d.data().status))).toHaveLength(6);
    expect(oldShape.docs.filter(d => d.data().status === 'cancelled')).toHaveLength(113);

    const newShape = await db.collectionGroup('registrations')
      .where('userId', '==', 'u1')
      .where('status', 'in', STATUS_IN)
      .limit(500)
      .get();
    expect(newShape.docs).toHaveLength(90);
    expect(newShape.docs.map(d => d.id)).toEqual(expect.arrayContaining(['reg-157', 'reg-158']));
    expect(newShape.docs.every(d => STATUS_IN.includes(d.data().status))).toBe(true);
    expect(newShape.docs.every(d => d.data().userId === 'u1')).toBe(true);

    // 排序來自文件路徑，不是輸入順序：把輸入整個反過來，前 120 筆一樣。
    const reversed = await createFakeDb(docs.slice().reverse())
      .collectionGroup('registrations').where('userId', '==', 'u1').limit(120).get();
    expect(reversed.docs.map(d => d.id)).toEqual(oldIds);

    // 排序是「完整路徑」而不是只排文件 ID：events/a 排在 events/b 前面，即使 b 底下的文件 ID（a）比 a 底下的（z）小。
    const pathVsId = [
      { path: 'events/b/registrations/a', data: { userId: 'u1', status: 'confirmed' } },
      { path: 'events/a/registrations/z', data: { userId: 'u1', status: 'confirmed' } },
    ];
    for (const input of [pathVsId, pathVsId.slice().reverse()]) {
      const first = await createFakeDb(input)
        .collectionGroup('registrations').where('userId', '==', 'u1').limit(1).get();
      expect(first.docs.map(d => d.id)).toEqual(['z']);
    }
  });

  test('the same data truncates the card again when the module is mutated back to the old query', async () => {
    const noStatus = source.replace(/\n\s*\.where\('status', 'in', ACTIVE_REGISTRATION_STATUSES\)/, '');
    expect(noStatus).not.toBe(source);
    const oldQuery = noStatus.replace('REGISTRATION_QUERY_LIMIT = 500', 'REGISTRATION_QUERY_LIMIT = 120');
    expect(oldQuery).not.toBe(noStatus);

    const oldDb = createFakeDb(buildStressRegistrations('u1'));
    const old = await renderWith({ db: oldDb, events: STRESS_EVENTS, console: quietConsole(), source: oldQuery });
    expect(old.host.textContent).toContain(emptyCardText);
    expect(old.host.textContent).not.toContain('Tomorrow Match');
    const [oldQ] = registrationQueries(oldDb);
    expect(hasStatusIn(oldQ)).toBe(false);
    expect(oldQ.returned).toBe(120);

    // 只拿掉 status 條件（上限仍是 500）：查詢回傳全部 309 筆含取消紀錄，證明 status 篩選真的在縮減結果。
    const noStatusDb = createFakeDb(buildStressRegistrations('u1'));
    await renderWith({ db: noStatusDb, events: STRESS_EVENTS, console: quietConsole(), source: noStatus });
    const [noStatusQ] = registrationQueries(noStatusDb);
    expect(hasStatusIn(noStatusQ)).toBe(false);
    expect(noStatusQ.returned).toBe(309);
  });

  test('every uid of the identity gets its own query with the status filter', async () => {
    const docs = [
      ...buildStressRegistrations('u1'),
      {
        path: 'events/evt-doc-line/registrations/reg-line-1',
        data: { userId: 'line-u1', eventId: 'evt-day-after', status: 'confirmed', participantType: 'self' },
      },
    ];
    const db = createFakeDb(docs);

    await renderWith({
      db,
      events: STRESS_EVENTS,
      currentUser: { uid: 'u1', lineUserId: 'line-u1', displayName: 'User One' },
      console: quietConsole(),
    });

    const queries = registrationQueries(db);
    expect(queries.map(q => q.filters.find(f => f.field === 'userId').value).sort()).toEqual(['line-u1', 'u1']);
    queries.forEach(query => {
      expect(query.filters).toContainEqual({ field: 'status', op: 'in', value: STATUS_IN });
      expect(query.limit).toBe(500);
    });
  });

  test.each([
    [499, false],
    [500, true],
    [501, true],
  ])('limit warning with %i active registrations (warned: %s)', async (count, warned) => {
    const uid = 'Uabcdef1234567890';
    const db = createFakeDb(bulkActiveRegistrations(uid, count));
    const logger = quietConsole();

    await renderWith({ db, currentUser: { uid, displayName: 'Heavy User' }, console: logger });

    const limitWarns = logger.warn.mock.calls
      .filter(args => String(args[0]).startsWith('[HomeNextActivity] registration query hit the limit'));
    if (!warned) {
      expect(limitWarns).toHaveLength(0);
      return;
    }
    expect(limitWarns).toHaveLength(1);
    const text = limitWarns[0].map(String).join(' ');
    expect(text).toContain('Uabcde***');
    expect(text).not.toContain('Uabcdef');
    expect(text).not.toContain(uid);
    expect(limitWarns[0]).toContain(500);
  });

  describe('stale cache calibration', () => {
    const events = [
      { id: 'evt-old', title: 'Old Match', date: '2099/05/19 18:00~20:00', location: 'Old Center', status: 'open' },
      { id: 'evt-new', title: 'New Match', date: '2099/05/22 18:00~20:00', location: 'New Center', status: 'open' },
    ];
    const staleCached = { id: 'r-old', eventId: 'evt-old', userId: 'u1', status: 'confirmed' };
    const serverNew = {
      path: 'events/evt-doc-new/registrations/r-new',
      data: { userId: 'u1', eventId: 'evt-new', status: 'confirmed', participantType: 'self' },
    };

    test('drops a cached active registration that a below-limit query no longer returns', async () => {
      const { host } = await renderWith({
        db: createFakeDb([serverNew]),
        events,
        registrations: [staleCached],
        console: quietConsole(),
      });
      expect(host.textContent).toContain('New Match');
      expect(host.textContent).not.toContain('Old Match');

      // 對照：拿掉校正（視同打到上限）舊的那筆就會留著並搶走卡片，證明上面的斷言不是巧合。
      const noCalibration = source.replace('completeUids.has(normalizeString(record?.userId))', 'false');
      expect(noCalibration).not.toBe(source);
      const control = await renderWith({
        db: createFakeDb([serverNew]),
        events,
        registrations: [staleCached],
        console: quietConsole(),
        source: noCalibration,
      });
      expect(control.host.textContent).toContain('Old Match');
    });

    test('drops it even when the server returns nothing at all', async () => {
      const { host } = await renderWith({
        db: createFakeDb([]),
        events,
        registrations: [staleCached],
        console: quietConsole(),
      });
      expect(host.textContent).toContain(emptyCardText);
      expect(host.textContent).not.toContain('Old Match');
    });

    test('keeps a cached active registration that the server still returns (merged, not replaced)', async () => {
      const { host } = await renderWith({
        db: createFakeDb([
          serverNew,
          { path: 'events/evt-doc-old/registrations/r-old', data: { userId: 'u1', eventId: 'evt-old', status: 'confirmed', participantType: 'self' } },
        ]),
        events,
        // managedRole 只存在於快取、伺服器文件沒有；它還在卡片上＝快取紀錄與伺服器列是合併的，沒有被丟掉重來。
        registrations: [{ ...staleCached, managedRole: 'delegate' }],
        console: quietConsole(),
      });
      expect(host.textContent).toContain('Old Match');
      expect(host.querySelector('.home-next-status-pill')?.textContent).toBe('委託');
    });

    test('keeps the cached registration when the query hits the limit (result incomplete, no inference)', async () => {
      const logger = quietConsole();
      const { host } = await renderWith({
        db: createFakeDb(bulkActiveRegistrations('u1', 500)),
        events,
        registrations: [staleCached],
        console: logger,
      });
      expect(host.textContent).toContain('Old Match');
      expect(logger.warn.mock.calls.some(args => String(args[0]).includes('hit the limit'))).toBe(true);
    });

    test('calibrates per uid: a failed query for one uid keeps that uid cache, the other uid is calibrated', async () => {
      const lineEvents = [
        ...events,
        { id: 'evt-line', title: 'Line Match', date: '2099/05/20 18:00~20:00', location: 'Line Center', status: 'open' },
      ];
      const { host } = await renderWith({
        db: createFakeDb([serverNew], { failUids: ['line-u1'] }),
        events: lineEvents,
        registrations: [
          staleCached,
          { id: 'r-line', eventId: 'evt-line', userId: 'line-u1', status: 'confirmed' },
        ],
        currentUser: { uid: 'u1', lineUserId: 'line-u1', displayName: 'User One' },
        console: quietConsole(),
      });
      // u1 查詢完整 → 舊的 Old Match 被丟；line-u1 查詢失敗 → 無法推論，Line Match 留著且比 New Match 近。
      expect(host.textContent).toContain('Line Match');
      expect(host.textContent).not.toContain('Old Match');
    });

    // get() 預設離線時會退回本機快取（snapshot.metadata.fromCache === true），那不是伺服器的完整集合。
    test('does not calibrate from a local-cache snapshot: an empty fromCache result keeps the cached registration', async () => {
      const { host } = await renderWith({
        db: createFakeDb([], { cacheUids: ['u1'] }),
        events,
        registrations: [staleCached],
        console: quietConsole(),
      });
      expect(host.textContent).toContain('Old Match');
      expect(host.textContent).not.toContain(emptyCardText);
    });

    test('does not calibrate from a partial local-cache snapshot either', async () => {
      const { host } = await renderWith({
        db: createFakeDb([serverNew], { cacheUids: ['u1'] }),
        events,
        registrations: [staleCached],
        console: quietConsole(),
      });
      expect(host.textContent).toContain('Old Match');
    });

    test('a snapshot without metadata is treated as incomplete (no calibration)', async () => {
      const { host } = await renderWith({
        db: createFakeDb([serverNew], { noMetadataUids: ['u1'] }),
        events,
        registrations: [staleCached],
        console: quietConsole(),
      });
      expect(host.textContent).toContain('Old Match');
    });

    test('calibrates per snapshot source: fromCache false is calibrated, fromCache true for another uid is kept', async () => {
      const lineEvents = [
        ...events,
        { id: 'evt-line', title: 'Line Match', date: '2099/05/20 18:00~20:00', location: 'Line Center', status: 'open' },
      ];
      const { host } = await renderWith({
        db: createFakeDb([serverNew], { cacheUids: ['line-u1'] }),
        events: lineEvents,
        registrations: [
          staleCached,
          { id: 'r-line', eventId: 'evt-line', userId: 'line-u1', status: 'confirmed' },
        ],
        currentUser: { uid: 'u1', lineUserId: 'line-u1', displayName: 'User One' },
        console: quietConsole(),
      });
      expect(host.textContent).toContain('Line Match');
      expect(host.textContent).not.toContain('Old Match');
    });
  });

  // R-REG-014：collectionGroup 會帶回舊根文件（registrations/{id}），只能收 events/{id}/registrations 子集合。
  describe('legacy root registration documents (R-REG-014)', () => {
    const events = [
      { id: 'evt-root-soon', title: 'Root Soon', date: '2099/05/18 18:00~20:00', location: 'Root Center', status: 'open' },
      { id: 'evt-old', title: 'Old Match', date: '2099/05/19 18:00~20:00', location: 'Old Center', status: 'open' },
      { id: 'evt-new', title: 'New Match', date: '2099/05/22 18:00~20:00', location: 'New Center', status: 'open' },
    ];
    const rootSoon = {
      path: 'registrations/r-root',
      data: { userId: 'u1', eventId: 'evt-root-soon', status: 'confirmed', participantType: 'self' },
    };
    const serverNew = {
      path: 'events/evt-doc-new/registrations/r-new',
      data: { userId: 'u1', eventId: 'evt-new', status: 'confirmed', participantType: 'self' },
    };

    test('an active legacy root registration pointing at the nearest future event does not become the card', async () => {
      const upserted = [];
      const { host } = await renderWith({
        db: createFakeDb([rootSoon, serverNew]),
        events,
        firebaseExtras: { _upsertCanonicalCacheRecord: (name, record) => upserted.push(record._docId) },
        console: quietConsole(),
      });
      expect(host.textContent).toContain('New Match');
      expect(host.textContent).not.toContain('Root Soon');
      // 舊根文件也不寫進 canonical cache
      expect(upserted).toEqual(['r-new']);

      // 對照：拿掉子集合過濾，舊根的報名就會搶走卡片。
      const noFilter = source.replace('.filter(doc => doc.ref.parent.parent !== null)', '');
      expect(noFilter).not.toBe(source);
      const control = await renderWith({
        db: createFakeDb([rootSoon, serverNew]),
        events,
        console: quietConsole(),
        source: noFilter,
      });
      expect(control.host.textContent).toContain('Root Soon');
    });

    test('the limit and completeness are judged on the raw result, before root documents are filtered out', async () => {
      // 500 筆（400 子集合＋100 舊根）正好等於上限；過濾後只剩 400，但伺服器結果可能還有更多，不能當成完整。
      const raw = bulkActiveRegistrations('u1', 400).concat(Array.from({ length: 100 }, (_, i) => ({
        path: `registrations/reg-root-${pad3(i)}`,
        data: { userId: 'u1', eventId: `evt-root-${pad3(i)}`, status: 'confirmed', participantType: 'self' },
      })));
      const logger = quietConsole();
      const db = createFakeDb(raw);
      const { host } = await renderWith({
        db,
        events,
        registrations: [{ id: 'r-old', eventId: 'evt-old', userId: 'u1', status: 'confirmed' }],
        console: logger,
      });
      expect(registrationQueries(db)[0].returned).toBe(500);
      expect(logger.warn.mock.calls.some(args => String(args[0]).includes('hit the limit'))).toBe(true);
      expect(host.textContent).toContain('Old Match');
    });
  });

  test('ACTIVE_REGISTRATION_STATUSES stays in sync with FirebaseService._isActiveRegistrationStatus', async () => {
    // 常數宣告在 home-next-activity.js 的 IIFE 裡不對外匯出，所以從實際送出的查詢取值；
    // FirebaseService 用 canonical-cache.test.js 同樣的方式載入（js/firebase-service.js 是 R-EXEC-016 鎖定檔，只讀）。
    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      Promise,
      Date,
      Math,
      localStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(), key: jest.fn(), get length() { return 0; } },
    };
    vm.createContext(sandbox);
    const firebaseSource = fs.readFileSync(path.join(__dirname, '../../js/firebase-service.js'), 'utf8');
    vm.runInContext(`${firebaseSource}\nglobalThis.FirebaseService = FirebaseService;`, sandbox, { filename: 'js/firebase-service.js' });
    const isActive = status => sandbox.FirebaseService._isActiveRegistrationStatus(status);

    const db = createFakeDb([]);
    await renderWith({ db, console: quietConsole() });
    const statusFilter = registrationQueries(db)[0].filters.find(f => f.field === 'status').value;

    expect(statusFilter.length).toBeGreaterThan(0);
    statusFilter.forEach(status => expect(isActive(status)).toBe(true));
    const probes = [
      'confirmed', 'waitlisted', 'registered', 'cancelled', 'canceled', 'removed', 'deleted', 'rejected',
      'withdrawn', 'pending', 'invited', 'checked_in', 'attended', 'approved', 'no_show', '', 'unknown',
    ];
    probes.forEach(status => expect([status, isActive(status)]).toEqual([status, statusFilter.includes(status)]));
  });
});
