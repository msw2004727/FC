const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/event/event-detail-signup.js'),
  'utf8'
);

function loadSignupModule({ userIdDocs = [], uidDocs = [] } = {}) {
  const queryCalls = [];
  const cachedRegistrations = [];
  const event = { id: 'evt-1', _docId: 'event-doc-1', status: 'open' };

  const makeSnap = docs => ({
    empty: docs.length === 0,
    docs: docs.map((data, index) => ({
      id: data.id || `reg-${index + 1}`,
      data: () => data,
    })),
  });

  const context = {
    console: { ...console, warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    setTimeout,
    clearTimeout,
    escapeHTML: value => String(value || ''),
    document: {
      getElementById: jest.fn(() => null),
      querySelector: jest.fn(() => null),
    },
    App: {
      currentPage: 'page-activity-detail',
      _currentDetailEventId: 'evt-1',
      _flipAnimating: false,
      _refreshSignupButton: jest.fn(),
      _getCurrentUserEventRegistrationState: () => ({
        signedUp: cachedRegistrations.some(reg =>
          reg.eventId === 'evt-1'
          && reg.userId === 'user-1'
          && reg.status !== 'cancelled'
          && reg.status !== 'removed'
        ),
      }),
    },
    ApiService: {
      getCurrentUser: jest.fn(() => ({ uid: 'user-1', displayName: 'Test User' })),
      getEvent: jest.fn(() => event),
      fetchRegistrationsIfMissing: jest.fn(() => Promise.resolve({ ok: true })),
      _withFirestoreFetchTimeout: jest.fn(promise => promise),
    },
    FirebaseService: {
      ensureAuthReadyForWrite: jest.fn(() => Promise.resolve(true)),
      _mapSubcollectionDoc: jest.fn((doc) => ({ ...doc.data(), _docId: doc.id, id: doc.id })),
      _upsertCanonicalCacheRecord: jest.fn((collection, reg) => {
        if (collection === 'registrations') cachedRegistrations.push(reg);
      }),
      _registrationsServerSnapshotReceived: false,
      _registrationListenerKey: '',
    },
    db: {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            where: (field, op, value) => ({
              limit: limit => ({
                get: options => {
                  queryCalls.push({ field, op, value, limit, options });
                  return Promise.resolve(makeSnap(field === 'userId' ? userIdDocs : uidDocs));
                },
              }),
            }),
          })),
        })),
      })),
    },
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return { app: context.App, context, event, queryCalls, cachedRegistrations };
}

describe('event signup registration hydrate', () => {
  test('cold unsigned user proof is user-scoped and does not fetch the whole roster', async () => {
    const { app, context, event, queryCalls } = loadSignupModule();

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await app._eventSignupRegistrationHydrateState.promise;
    await Promise.resolve();

    expect(context.ApiService.fetchRegistrationsIfMissing).not.toHaveBeenCalled();
    expect(context.FirebaseService.ensureAuthReadyForWrite).toHaveBeenCalledWith('user-1');
    expect(queryCalls.map(call => call.field)).toEqual(['userId', 'uid']);
    expect(queryCalls.every(call => call.options?.source === 'server')).toBe(true);
    expect(app._eventSignupRegistrationHydrateState).toBe(null);
    expect(app._shouldHoldSignupActionsForEventRegistrations(event)).toBe(false);
  });

  test('active self registration is inserted into canonical cache before releasing the button', async () => {
    const { app, context, event, cachedRegistrations } = loadSignupModule({
      userIdDocs: [{ eventId: 'evt-1', userId: 'user-1', status: 'registered', participantType: 'self' }],
    });

    expect(app._ensureEventSignupRegistrationStateLoaded(event)).toBe(true);
    await app._eventSignupRegistrationHydrateState.promise;
    await Promise.resolve();

    expect(context.FirebaseService._upsertCanonicalCacheRecord).toHaveBeenCalledWith(
      'registrations',
      expect.objectContaining({ eventId: 'evt-1', userId: 'user-1', status: 'registered' })
    );
    expect(cachedRegistrations).toHaveLength(1);
    expect(app._eventSignupRegistrationHydrateState).toBe(null);
    expect(app._shouldHoldSignupActionsForEventRegistrations(event)).toBe(false);
  });
});
