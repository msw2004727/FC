/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const navigationSource = fs.readFileSync(path.join(__dirname, '../../js/core/navigation.js'), 'utf8');
const profilePageSource = fs.readFileSync(path.join(__dirname, '../../pages/profile.html'), 'utf8');

function createProfileNavigation() {
  document.body.innerHTML = profilePageSource;
  const scene = {
    isUnlocked: jest.fn(() => false),
    requestUnlock: jest.fn(() => false),
  };
  const browserWindow = {
    ColorCatScene: scene,
    requestIdleCallback: callback => callback(),
  };
  const ScriptLoader = { ensureGroup: jest.fn(async () => {}) };
  const App = {
    currentPage: 'page-profile',
    _profileDeferredSeq: 1,
    _reconcileLazyRouteGateways: jest.fn(),
    _prepareCreateEventModalForPageSwitch: jest.fn(() => true),
    renderProfileData: jest.fn(),
    renderProfileFavorites: jest.fn(),
    showToast: jest.fn(),
  };
  vm.runInNewContext(navigationSource, {
    App,
    window: browserWindow,
    document,
    ScriptLoader,
    setTimeout,
    console,
  });
  return { App, scene, ScriptLoader, browserWindow };
}

describe('profile scene on-demand loading', () => {
  test('opening the profile keeps its Coming soon preview without loading the scene group', async () => {
    const { App, ScriptLoader } = createProfileNavigation();
    const preview = document.getElementById('profile-slot-banner');
    expect(preview.querySelector('.profile-scene-key').getAttribute('onclick')).toBe('App._requestProfileScene()');
    expect(preview.textContent).toContain('Coming soon.');

    App._renderPageContent('page-profile');
    await Promise.resolve();

    expect(ScriptLoader.ensureGroup).toHaveBeenCalledWith('achievementProfile');
    expect(ScriptLoader.ensureGroup).not.toHaveBeenCalledWith('profileScene');
  });

  test('one key press requests the scene once and ignores a concurrent press', async () => {
    const { App, scene, ScriptLoader } = createProfileNavigation();
    let finishLoad;
    ScriptLoader.ensureGroup.mockImplementation(() => new Promise(resolve => { finishLoad = resolve; }));

    const first = App._requestProfileScene();
    const second = await App._requestProfileScene();
    expect(second.ok).toBe(false);
    expect(ScriptLoader.ensureGroup).toHaveBeenCalledTimes(1);
    expect(ScriptLoader.ensureGroup).toHaveBeenCalledWith('profileScene');
    expect(scene.requestUnlock).not.toHaveBeenCalled();

    finishLoad();
    await first;
    expect(scene.requestUnlock).toHaveBeenCalledTimes(1);
    expect(scene.requestUnlock).toHaveBeenCalledWith('profile-slot-banner');
  });

  test('a same-page profile refresh does not cancel an explicit scene request', async () => {
    const { App, scene, ScriptLoader } = createProfileNavigation();
    let finishSceneLoad;
    ScriptLoader.ensureGroup.mockImplementation(group => group === 'profileScene'
      ? new Promise(resolve => { finishSceneLoad = resolve; })
      : Promise.resolve());

    const pending = App._requestProfileScene();
    App._renderPageContent('page-profile');
    finishSceneLoad();

    expect((await pending).ok).toBe(false);
    expect(scene.requestUnlock).toHaveBeenCalledTimes(1);
  });

  test('failed script loading retains the key and allows retry', async () => {
    const { App, scene, ScriptLoader } = createProfileNavigation();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      ScriptLoader.ensureGroup.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce();
      const first = await App._requestProfileScene();
      const key = document.querySelector('.profile-scene-key');
      expect(first.reason).toBe('load_failed');
      expect(key.disabled).toBe(false);
      expect(key.hasAttribute('aria-busy')).toBe(false);
      expect(document.getElementById('profile-slot-banner').textContent).toContain('Coming soon.');
      expect(scene.requestUnlock).not.toHaveBeenCalled();

      await App._requestProfileScene();
      expect(ScriptLoader.ensureGroup).toHaveBeenCalledTimes(2);
      expect(scene.requestUnlock).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('scene initialization failure restores the static preview', async () => {
    const { App, scene } = createProfileNavigation();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    scene.destroy = jest.fn();
    scene.requestUnlock.mockImplementation(() => {
      document.getElementById('profile-slot-banner').innerHTML = '<canvas></canvas>';
      throw new Error('canvas unavailable');
    });
    try {
      const result = await App._requestProfileScene();
      expect(result.reason).toBe('load_failed');
      expect(scene.destroy).toHaveBeenCalledTimes(1);
      expect(document.querySelector('#profile-slot-banner .profile-scene-key')).not.toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  test('a scene load finishing after leaving profile cannot open the unlock prompt', async () => {
    const { App, scene, ScriptLoader } = createProfileNavigation();
    let finishLoad;
    ScriptLoader.ensureGroup.mockImplementation(() => new Promise(resolve => { finishLoad = resolve; }));

    const pending = App._requestProfileScene();
    App._cleanupBeforePageSwitch('page-home');
    App.currentPage = 'page-home';
    finishLoad();
    const result = await pending;

    expect(result.reason).toBe('stale');
    expect(scene.requestUnlock).not.toHaveBeenCalled();
  });

  test('leaving an unopened preview does not remove it, but cleans up an active scene', () => {
    const { App, scene } = createProfileNavigation();
    App._destroyProfileScene = jest.fn();
    App._cleanupBeforePageSwitch('page-home');
    expect(App._destroyProfileScene).not.toHaveBeenCalled();
    expect(document.getElementById('profile-slot-banner').textContent).toContain('Coming soon.');

    scene.isActive = jest.fn(() => true);
    App._cleanupBeforePageSwitch('page-home');
    expect(App._destroyProfileScene).toHaveBeenCalledTimes(1);
  });

  test('returning after an explicit unlock resumes the already loaded scene', () => {
    const { App, scene, ScriptLoader } = createProfileNavigation();
    scene.isUnlocked.mockReturnValue(true);
    scene.isActive = jest.fn(() => false);
    App._initProfileScene = jest.fn();

    App._renderPageContent('page-profile');

    expect(App._initProfileScene).toHaveBeenCalledTimes(1);
    expect(ScriptLoader.ensureGroup).not.toHaveBeenCalledWith('profileScene');

    scene.isActive.mockReturnValue(true);
    App._renderPageContent('page-profile');
    expect(App._initProfileScene).toHaveBeenCalledTimes(1);
  });
});
