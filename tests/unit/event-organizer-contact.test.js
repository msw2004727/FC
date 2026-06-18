const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function loadProfileCardModule({ users = [], event = null, db = null, openReturn = {} } = {}) {
  const app = {
    showToast: jest.fn(),
    showUserProfile: jest.fn(async () => ({ ok: true, action: 'profile' })),
  };
  const open = jest.fn(() => openReturn);
  const assign = jest.fn();
  const ApiService = {
    getAdminUsers: jest.fn(() => users),
    getEvent: jest.fn(() => event),
  };
  const FirebaseService = {
    _cache: { adminUsers: users },
    _mapUserDoc: jest.fn((data, docId) => ({
      ...data,
      name: data.displayName || data.name || '',
      uid: data.uid || data.lineUserId || docId,
      _docId: docId,
    })),
    _saveToLS: jest.fn(),
  };

  const context = {
    App: app,
    ApiService,
    FirebaseService,
    ScriptLoader: { ensureGroup: jest.fn(async () => {}) },
    db,
    window: { open, location: { assign } },
    Object,
    console,
    encodeURIComponent,
  };
  vm.runInNewContext(readProjectFile('js/modules/profile/profile-card.js'), context, {
    filename: 'js/modules/profile/profile-card.js',
  });
  return { app, ApiService, FirebaseService, open, assign };
}

describe('event organizer contact', () => {
  test('opens organizer LINE link directly when user cache has socialLinks.line', async () => {
    const event = { id: 'event-1', creator: 'Host', creatorUid: 'host-1' };
    const users = [
      { uid: 'host-1', displayName: 'Host', socialLinks: { line: '@hostline' } },
    ];
    const { app, open, assign } = loadProfileCardModule({ users, event });

    const result = await app.contactEventOrganizer({ eventId: event.id });

    expect(result).toEqual({
      ok: true,
      action: 'line',
      url: 'https://line.me/ti/p/hostline',
    });
    expect(open).toHaveBeenCalledWith('https://line.me/ti/p/hostline', 'sporthub_line');
    expect(assign).not.toHaveBeenCalled();
    expect(app.showUserProfile).not.toHaveBeenCalled();
  });

  test('fetches organizer user by uid before falling back to profile card', async () => {
    const event = { id: 'event-2', creator: 'Fetched Host', creatorUid: 'host-2' };
    const directGet = jest.fn(async () => ({
      exists: true,
      id: 'host-2',
      data: () => ({
        uid: 'host-2',
        displayName: 'Fetched Host',
        socialLinks: { line: 'https://line.me/R/ti/p/@fetched-host' },
      }),
    }));
    const doc = jest.fn(() => ({ get: directGet }));
    const where = jest.fn();
    const collection = jest.fn(() => ({ doc, where }));
    const db = { collection };
    const { app, FirebaseService, open, assign } = loadProfileCardModule({
      users: [],
      event,
      db,
      openReturn: null,
    });

    const result = await app.contactEventOrganizer({ eventId: event.id });

    expect(collection).toHaveBeenCalledWith('users');
    expect(doc).toHaveBeenCalledWith('host-2');
    expect(where).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      action: 'line',
      url: 'https://line.me/R/ti/p/@fetched-host',
    });
    expect(open).toHaveBeenCalledWith('https://line.me/R/ti/p/@fetched-host', 'sporthub_line');
    expect(assign).toHaveBeenCalledWith('https://line.me/R/ti/p/@fetched-host');
    expect(FirebaseService._cache.adminUsers).toHaveLength(1);
    expect(app.showUserProfile).not.toHaveBeenCalled();
  });
});
