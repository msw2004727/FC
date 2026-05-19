const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');

function loadResolver({ user = null, settings = null } = {}) {
  const code = fs.readFileSync(path.join(ROOT, 'js/identity-resolver.js'), 'utf8');
  const sandbox = {
    window: {},
    FirebaseService: { _cache: { currentUser: user, currentUserIdentitySettings: settings } },
    ApiService: { getCurrentUser: () => user },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.IdentityResolver;
}

describe('IdentityResolver', () => {
  const mainUser = {
    uid: 'uidUser',
    displayName: 'Main Name',
    pictureUrl: 'https://example.com/main.png',
    role: 'admin',
  };

  test('returns main identity from Firestore user by default', () => {
    const resolver = loadResolver({ user: mainUser });
    const identity = resolver.getEffectiveIdentity();
    expect(identity).toMatchObject({
      identityId: 'main',
      uid: 'uidUser',
      displayName: 'Main Name',
      pictureUrl: 'https://example.com/main.png',
      source: 'users',
    });
  });

  test('returns enabled active secondary identity without leaking main avatar fallback', () => {
    const resolver = loadResolver({
      user: mainUser,
      settings: {
        profileActiveIdentityId: 'secondary',
        identities: {
          secondary: {
            enabled: true,
            displayName: 'Public Alias',
            avatarUrl: '',
            displayRoleLabel: '一般用戶',
          },
        },
      },
    });
    const identity = resolver.getEffectiveIdentity();
    expect(identity).toMatchObject({
      identityId: 'secondary',
      displayName: 'Public Alias',
      pictureUrl: '',
      source: 'users.identityPrivate.settings',
    });
    expect(identity.avatarCandidates).toEqual([]);
  });

  test('private message surfaces force main identity even when secondary is active', () => {
    const resolver = loadResolver({
      user: mainUser,
      settings: {
        profileActiveIdentityId: 'secondary',
        identities: {
          secondary: {
            enabled: true,
            displayName: 'Public Alias',
            avatarUrl: 'https://example.com/alias.png',
          },
        },
      },
    });
    expect(resolver.getEffectiveIdentity({ surface: 'privateMessage' })).toMatchObject({
      identityId: 'main',
      displayName: 'Main Name',
    });
  });

  test('secondary identity permission gate forces main identity', () => {
    const settings = {
      profileActiveIdentityId: 'secondary',
      identities: {
        secondary: {
          enabled: true,
          displayName: 'Public Alias',
          avatarUrl: 'https://example.com/alias.png',
        },
      },
    };
    const resolver = loadResolver({ user: mainUser, settings });

    expect(resolver.getEffectiveIdentity({ allowSecondaryIdentity: false })).toMatchObject({
      identityId: 'main',
      displayName: 'Main Name',
    });
    expect(resolver.buildPublicSnapshot({
      requestedIdentityId: 'secondary',
      allowSecondaryIdentity: false,
    })).toEqual({
      identityId: 'main',
      displayName: 'Main Name',
      avatarUrl: 'https://example.com/main.png',
    });
  });

  test('falls back to main when secondary is selected but incomplete', () => {
    const resolver = loadResolver({
      user: mainUser,
      settings: {
        profileActiveIdentityId: 'secondary',
        identities: { secondary: { enabled: true, displayName: '' } },
      },
    });
    expect(resolver.getEffectiveIdentity()).toMatchObject({
      identityId: 'main',
      displayName: 'Main Name',
    });
  });

  test('builds public snapshots without root role or permission fields', () => {
    const resolver = loadResolver({
      user: mainUser,
      settings: {
        profileActiveIdentityId: 'main',
        identities: {
          secondary: {
            enabled: true,
            displayName: 'Public Alias',
            avatarUrl: 'https://example.com/alias.png',
          },
        },
      },
    });

    expect(resolver.buildPublicSnapshot({ requestedIdentityId: 'secondary' })).toEqual({
      identityId: 'secondary',
      displayName: 'Public Alias',
      avatarUrl: 'https://example.com/alias.png',
    });
    expect(resolver.buildPublicSnapshot({ requestedIdentityId: 'secondary' })).not.toHaveProperty('role');
    expect(resolver.buildPublicSnapshot({ requestedIdentityId: 'secondary' })).not.toHaveProperty('claims');
    expect(resolver.buildPublicSnapshot({ requestedIdentityId: 'secondary' })).not.toHaveProperty('permissions');
  });

  test('public snapshot falls back to main when secondary is not enabled', () => {
    const resolver = loadResolver({
      user: mainUser,
      settings: {
        identities: {
          secondary: {
            enabled: false,
            displayName: 'Disabled Alias',
            avatarUrl: 'https://example.com/alias.png',
          },
        },
      },
    });

    expect(resolver.buildPublicSnapshot({ requestedIdentityId: 'secondary' })).toEqual({
      identityId: 'main',
      displayName: 'Main Name',
      avatarUrl: 'https://example.com/main.png',
    });
  });
});
