const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('team feed submit feedback', () => {
  function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function loadTeamFeed(app, apiOverrides = {}, elements = {}) {
    const api = {
      getTeam: () => ({ id: 'teamA' }),
      getCurrentUser: () => ({ uid: 'uidA', displayName: 'Alice' }),
      getTeamFeed: jest.fn(() => []),
      createTeamFeedPost: jest.fn(() => Promise.resolve()),
      ...apiOverrides,
    };
    const context = {
      App: app,
      ApiService: api,
      I18N: {
        t: (key) => ({
          'teamDetail.publish': '發佈',
          'teamDetail.publishing': '發布中',
        }[key] || key),
      },
      document: {
        getElementById: (id) => elements[id] || null,
      },
      generateId: () => 'fp_test',
      console,
      Object,
      Date,
      Promise,
      String,
      Array,
    };
    const source = fs.readFileSync(
      path.join(__dirname, '../../js/modules/team/team-feed.js'),
      'utf8'
    );
    vm.runInNewContext(source, context);
    return api;
  }

  function makeApp() {
    return {
      _teamFeedPage: {},
      _isTeamMember: () => true,
      _formatDateTime: () => '2026/04/30 22:00',
      showToast: jest.fn(),
      hasPermission: () => false,
      _canManageTeamMembers: () => false,
      _grantAutoExp: jest.fn(),
      _renderTeamFeed: jest.fn(() => '<section>feed</section>'),
    };
  }

  test('sets the clicked publish button to publishing while the post is pending', async () => {
    const pendingCreate = createDeferred();
    const app = makeApp();
    const button = { disabled: false, textContent: '發佈' };
    const api = loadTeamFeed(
      app,
      { createTeamFeedPost: jest.fn(() => pendingCreate.promise) },
      {
        'team-feed-input': { value: 'Hello team' },
        'team-feed-public': { checked: true },
        'team-feed-section': { innerHTML: '' },
      }
    );

    const submitPromise = app.submitTeamPost('teamA', button);

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('發布中');
    expect(api.createTeamFeedPost).toHaveBeenCalledTimes(1);

    pendingCreate.resolve();
    await submitPromise;

    expect(app._renderTeamFeed).toHaveBeenCalledWith('teamA');
  });

  test('restores the publish button if posting fails', async () => {
    const app = makeApp();
    const button = { disabled: false, textContent: '發佈' };
    loadTeamFeed(
      app,
      { createTeamFeedPost: jest.fn(() => Promise.reject(new Error('denied'))) },
      {
        'team-feed-input': { value: 'Hello team' },
        'team-feed-public': { checked: true },
        'team-feed-section': { innerHTML: '' },
      }
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await app.submitTeamPost('teamA', button);

    errorSpy.mockRestore();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('發佈');
    expect(app._renderTeamFeed).not.toHaveBeenCalled();
  });
});
