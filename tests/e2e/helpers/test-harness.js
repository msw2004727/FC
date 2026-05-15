// Shared Playwright harness for ToosterX E2E tests.
//
// Keep this file deterministic: no production Firebase, LINE, Storage, or
// third-party sports API calls should be required by tests that use it.

const TEST_USERS = Object.freeze({
  userBasic: {
    id: 'e2e_user_basic',
    uid: 'e2e_user_basic',
    role: 'user',
    displayName: 'E2E Basic User',
  },
  userAdvanced: {
    id: 'e2e_user_advanced',
    uid: 'e2e_user_advanced',
    role: 'user',
    displayName: 'E2E Advanced User',
  },
  owner: {
    id: 'e2e_owner',
    uid: 'e2e_owner',
    role: 'user',
    displayName: 'E2E Owner',
  },
  delegate: {
    id: 'e2e_delegate',
    uid: 'e2e_delegate',
    role: 'user',
    displayName: 'E2E Delegate',
  },
  coach: {
    id: 'e2e_coach',
    uid: 'e2e_coach',
    role: 'coach',
    displayName: 'E2E Coach',
  },
  admin: {
    id: 'e2e_admin',
    uid: 'e2e_admin',
    role: 'admin',
    displayName: 'E2E Admin',
  },
});

const TEST_EVENTS = Object.freeze({
  basicOpen: {
    id: 'e2e_event_basic_open',
    title: 'E2E Basic Open Event',
    creatorUid: TEST_USERS.owner.uid,
    status: 'open',
    privateEvent: false,
  },
  privateOwned: {
    id: 'e2e_event_private_owned',
    title: 'E2E Private Owned Event',
    creatorUid: TEST_USERS.owner.uid,
    status: 'open',
    privateEvent: true,
  },
  delegated: {
    id: 'e2e_event_delegated',
    title: 'E2E Delegated Event',
    creatorUid: TEST_USERS.owner.uid,
    delegateUids: [TEST_USERS.delegate.uid],
    status: 'open',
  },
});

async function clearBrowserState(page) {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function mockOfflineServices(page) {
  const emptyJson = route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  });

  await page.route('**/*.firebaseio.com/**', emptyJson);
  await page.route('**/googleapis.com/**', emptyJson);
  await page.route('**/firestore.googleapis.com/**', emptyJson);
  await page.route('**/api.line.me/**', emptyJson);
  await page.route('**/liff.line.me/**', emptyJson);
  await page.route('**/sportsapipro.com/**', emptyJson);
  await page.route('**/ipwho.is/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, city: 'Taichung', country: 'Taiwan' }),
  }));
}

async function installTestHarness(page, user = TEST_USERS.userBasic) {
  await clearBrowserState(page);
  await mockOfflineServices(page);
  await page.addInitScript(({ currentUser, users, events }) => {
    window.__FORCE_DEMO = true;
    window.__E2E_TEST_HARNESS__ = {
      currentUser,
      users,
      events,
      installedAt: Date.now(),
    };
  }, {
    currentUser: user,
    users: TEST_USERS,
    events: TEST_EVENTS,
  });
}

module.exports = {
  TEST_EVENTS,
  TEST_USERS,
  clearBrowserState,
  installTestHarness,
  mockOfflineServices,
};
