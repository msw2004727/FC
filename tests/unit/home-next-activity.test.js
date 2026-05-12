const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

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
  const context = vm.createContext({
    window: dom.window,
    globalThis: dom.window,
    document: dom.window.document,
    console,
    App: app,
    ApiService: {
      getCurrentUser: jest.fn(() => currentUser),
      getRegistrations: jest.fn(() => registrations),
      getEvent: jest.fn(id => events.find(event => event.id === id || event._docId === id) || null),
      getEvents: jest.fn(() => events),
    },
    FirebaseService: {
      _cache: { events: events.slice(), registrations: registrations.slice(), currentUser },
    },
    ScriptLoader: {
      ensureForPage: jest.fn().mockResolvedValue(undefined),
      ensureGroup: jest.fn().mockResolvedValue(undefined),
    },
    escapeHTML: value => String(value ?? ''),
  });
  vm.runInContext(source, context, { filename: 'js/modules/home-next-activity.js' });
  return { app, dom, context };
}

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
