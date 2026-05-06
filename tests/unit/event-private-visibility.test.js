const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadEventHelpers() {
  const App = {};
  const ApiService = {
    getCurrentUser: () => null,
    getEvents: () => [],
    getAdminUsers: () => [],
    hasRoleActivityCapability: () => false,
  };
  const context = {
    App,
    ApiService,
    ROLES: {
      user: { label: 'User' },
      coach: { label: 'Coach' },
      captain: { label: 'Captain' },
      venue_owner: { label: 'Venue Owner' },
      admin: { label: 'Admin' },
      super_admin: { label: 'Super Admin' },
      custom_manager: { label: 'Custom Manager' },
    },
    ROLE_LEVEL_MAP: {
      user: 0,
      coach: 1,
      captain: 2,
      venue_owner: 3,
      custom_manager: 3,
      admin: 4,
      super_admin: 5,
    },
    LineAuth: { isLoggedIn: () => false },
    console,
    Object,
    Array,
    String,
    Set,
  };
  const source = fs.readFileSync(
    path.join(__dirname, '../../js/modules/event/event-list-helpers.js'),
    'utf8'
  );
  vm.runInNewContext(source, context, { filename: 'js/modules/event/event-list-helpers.js' });
  return { App, ApiService };
}

function makeRuntime({ role = 'user', uid = 'viewer', perms = [], events = [] } = {}) {
  const { App, ApiService } = loadEventHelpers();
  const app = Object.create(App);
  app.currentRole = role;
  app.hasPermission = (code) => perms.includes(code);
  app._canViewEventByTeamScope = () => true;
  app._isEventVisibleToUser = () => true;
  ApiService.getCurrentUser = () => ({ uid, role, displayName: uid });
  ApiService.getEvents = () => events;
  ApiService.hasRoleActivityCapability = () => false;
  return app;
}

describe('private activity visibility for admin-below managers', () => {
  const privateOther = {
    id: 'private-other',
    title: 'Private Other',
    privateEvent: true,
    creatorUid: 'owner',
    status: 'open',
  };
  const privateOwn = {
    id: 'private-own',
    title: 'Private Own',
    privateEvent: true,
    creatorUid: 'viewer',
    status: 'open',
  };
  const privateDelegated = {
    id: 'private-delegated',
    title: 'Private Delegated',
    privateEvent: true,
    creatorUid: 'owner',
    delegateUids: ['viewer'],
    status: 'open',
  };
  const publicOther = {
    id: 'public-other',
    title: 'Public Other',
    creatorUid: 'owner',
    status: 'open',
  };

  test.each(['coach', 'captain', 'venue_owner'])(
    '%s cannot list or manage non-owned private activities',
    (role) => {
      const app = makeRuntime({ role });

      expect(app._canListPrivateEvent(privateOther)).toBe(false);
      expect(app._canManageEvent(privateOther)).toBe(false);
    }
  );

  test('custom admin-below activity.manage.entry role cannot list or manage non-owned private activities', () => {
    const app = makeRuntime({
      role: 'custom_manager',
      perms: ['activity.manage.entry', 'event.edit_all'],
    });

    expect(app._canListPrivateEvent(privateOther)).toBe(false);
    expect(app._canManageEvent(privateOther)).toBe(false);
  });

  test.each(['admin', 'super_admin'])('%s can list and manage private activities', (role) => {
    const app = makeRuntime({ role });

    expect(app._canListPrivateEvent(privateOther)).toBe(true);
    expect(app._canManageEvent(privateOther)).toBe(true);
  });

  test('admin-below owner can list and manage own private activities', () => {
    const app = makeRuntime({ role: 'coach' });

    expect(app._canListPrivateEvent(privateOwn)).toBe(true);
    expect(app._canManageEvent(privateOwn)).toBe(true);
  });

  test('delegate can operate direct-linked private activity but does not get list discovery', () => {
    const app = makeRuntime({ role: 'coach' });

    expect(app._canListPrivateEvent(privateDelegated)).toBe(false);
    expect(app._canManageEvent(privateDelegated)).toBe(true);
  });

  test('_getVisibleEvents hides non-owned private activities but keeps public and own private activities', () => {
    const events = [privateOther, privateOwn, privateDelegated, publicOther];
    const app = makeRuntime({ role: 'coach', events });

    expect(app._getVisibleEvents().map(e => e.id)).toEqual(['private-own', 'public-other']);
  });
});
