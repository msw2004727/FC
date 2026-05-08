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
  };
  const registrations = options.registrations || [];
  const events = options.events || [];
  const currentUser = options.currentUser === undefined
    ? { uid: 'u1', displayName: 'User One' }
    : options.currentUser;
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
  });

  test('renders empty state when the user has no future registrations', async () => {
    const { app, dom } = runModule({ registrations: [], events: [] });

    await app.renderHomeNextActivity({ force: true });

    const host = dom.window.document.getElementById('home-next-activity');
    expect(host.textContent).toContain('你目前還沒有報名活動');
    expect(host.textContent).toContain('找活動');
    expect(host.textContent).toContain('我要開團');

    host.querySelector('[data-home-next-action="find"]').click();
    host.querySelector('[data-home-next-action="create"]').click();
    expect(app.showPage).toHaveBeenCalledWith('page-activities');
    expect(app.openHomeCreateEvent).toHaveBeenCalled();
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
    dom.window.document.querySelector('[data-home-next-action="calendar"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(context.ScriptLoader.ensureGroup).toHaveBeenCalledWith('activity');
    expect(app.addEventToCalendar).toHaveBeenCalledWith('evt-next');
  });
});
