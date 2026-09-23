const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const index = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const guardScript = index.match(/<script id="critical-css-guard-script">([\s\S]*?)<\/script>/)?.[1];

function createBoot(loaded = {}, topbarHeight = '56px') {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div id="critical-css-guard"><p id="critical-css-message">正在載入網站</p>
      <button id="critical-css-retry" type="button">重新載入最新版</button>
      <span id="critical-home-probe"></span>
    </div>
    <header id="top-bar"></header><div id="loading-overlay"></div>
  </body></html>`, { url: 'https://toosterx.test/' });
  const { window } = dom;
  const { document } = window;
  document.documentElement.classList.add('boot-css-pending', 'prod-early');
  window.requestAnimationFrame = (callback) => callback();

  ['base', 'layout', 'home'].forEach((name) => {
    const link = document.createElement('link');
    link.id = `critical-css-${name}`;
    link.rel = 'stylesheet';
    Object.defineProperty(link, 'sheet', { get: () => loaded[name] ? {} : null });
    document.head.appendChild(link);
  });
  const css = document.createElement('style');
  css.textContent = `:root{--topbar-h:${topbarHeight}} #top-bar{position:fixed} #critical-home-probe{position:relative}`;
  document.head.appendChild(css);

  const showRecovery = jest.fn((message, options) => {
    if (window._criticalCssGuard.pending()) {
      return window._criticalCssGuard.showRetry(message, () => {}, !options?.guardTimeout);
    }
    const button = document.createElement('button');
    button.id = '_recovery_btn';
    button.textContent = message;
    document.body.appendChild(button);
    return undefined;
  });
  window.showSportHubAssetRecoveryButton = showRecovery;
  vm.runInNewContext(guardScript, { window, document, setInterval, clearInterval, setTimeout, clearTimeout });
  return { window, document, loaded, showRecovery };
}

describe('critical CSS boot guard', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('is installed before core CSS and the visible app shell', () => {
    expect(guardScript).toBeTruthy();
    expect(index.indexOf("classList.add('boot-css-pending')")).toBeLessThan(index.indexOf('href="css/base.css'));
    expect(index.indexOf('<div id="critical-css-guard"')).toBeLessThan(index.indexOf('<header id="top-bar"'));
    expect(index).not.toMatch(/id="critical-home-probe"[^>]*\bbanner-carousel\b/);
  });

  test('waits for the existing overlay and all three applied stylesheets', () => {
    const loaded = { base: true, layout: true, home: false };
    const { window } = createBoot(loaded);
    window._criticalCssGuard.overlayReady();
    window._criticalCssGuard.check();
    expect(window._criticalCssGuard.pending()).toBe(true);

    loaded.home = true;
    window._criticalCssGuard.check();
    expect(window._criticalCssGuard.pending()).toBe(false);
  });

  test('does not reveal a fully styled shell before the existing overlay starts', () => {
    const { window } = createBoot({ base: true, layout: true, home: true });
    window._criticalCssGuard.check();
    expect(window._criticalCssGuard.pending()).toBe(true);
    window._criticalCssGuard.overlayReady();
    expect(window._criticalCssGuard.pending()).toBe(false);
  });

  test('accepts a valid changed top bar height once critical CSS is applied', () => {
    const { window } = createBoot({ base: true, layout: true, home: true }, '60px');
    window._criticalCssGuard.overlayReady();
    expect(window._criticalCssGuard.pending()).toBe(false);
  });

  test('hands an earlier recovery retry to the normal UI when CSS becomes ready', () => {
    const loaded = { base: true, layout: true, home: false };
    const { window, document, showRecovery } = createBoot(loaded);
    showRecovery('資源載入失敗，點我重新載入最新版');
    expect(document.getElementById('critical-css-guard').classList.contains('critical-css-error')).toBe(true);
    window._criticalCssGuard.overlayReady();
    loaded.home = true;
    window._criticalCssGuard.check();
    expect(window._criticalCssGuard.pending()).toBe(false);
    expect(document.getElementById('_recovery_btn').textContent).toBe('資源載入失敗，點我重新載入最新版');
  });

  test('keeps raw UI covered after the old overlay watchdog and offers a retry on timeout', () => {
    const { window, document, showRecovery } = createBoot({ base: true, layout: false, home: false });
    document.documentElement.classList.remove('prod-early');
    document.getElementById('loading-overlay').style.display = 'none';
    jest.advanceTimersByTime(15000);

    expect(window._criticalCssGuard.pending()).toBe(true);
    expect(showRecovery).toHaveBeenCalledWith('網站樣式載入逾時，點我重新載入最新版', { guardTimeout: true });
    expect(document.getElementById('critical-css-guard').classList.contains('critical-css-error')).toBe(true);
    expect(document.getElementById('critical-css-retry').onclick).toEqual(expect.any(Function));
  });

  test('still offers a retry if the earlier recovery bootstrap is unavailable', () => {
    const { window, document } = createBoot({ base: false, layout: false, home: false });
    delete window.showSportHubAssetRecoveryButton;
    jest.advanceTimersByTime(15000);

    expect(window._criticalCssGuard.pending()).toBe(true);
    expect(document.getElementById('critical-css-guard').classList.contains('critical-css-error')).toBe(true);
    expect(document.getElementById('critical-css-retry').onclick).toEqual(expect.any(Function));
  });
});
