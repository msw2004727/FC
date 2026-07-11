/**
 * @jest-environment jsdom
 */

const path = require('path');

function touchEvent(type, x = 20, y = 30) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    configurable: true,
    value: type === 'touchend' || type === 'touchcancel'
      ? []
      : [{ clientX: x, clientY: y }],
  });
  return event;
}

describe('floating banner touch listeners', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <div id="floating-ads"><a class="float-ad"></a></div>
      <div id="sponsor-grid"></div>
    `;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    window.requestAnimationFrame = jest.fn(() => 1);
    global.requestAnimationFrame = window.requestAnimationFrame;
    global.App = {};
    global.ApiService = { getBanners: jest.fn(() => []) };
    global.escapeHTML = value => String(value ?? '');
    require(path.resolve(__dirname, '../../js/modules/banner.js'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.App;
    delete global.ApiService;
    delete global.escapeHTML;
    delete global.requestAnimationFrame;
  });

  test('non-passive document touchmove exists only during an active drag gesture', () => {
    const floatingAds = document.getElementById('floating-ads');
    Object.defineProperty(floatingAds, 'offsetHeight', { configurable: true, value: 120 });
    floatingAds.getBoundingClientRect = jest.fn(() => ({
      left: 240, top: 260, width: 120, height: 120,
    }));
    const addSpy = jest.spyOn(document, 'addEventListener');
    const removeSpy = jest.spyOn(document, 'removeEventListener');

    App.bindFloatingAds();

    expect(addSpy.mock.calls.some(([type]) => type === 'touchmove')).toBe(false);

    floatingAds.dispatchEvent(touchEvent('touchstart'));
    const touchMoveCall = addSpy.mock.calls.find(([type]) => type === 'touchmove');
    expect(touchMoveCall).toBeDefined();
    expect(touchMoveCall[2]).toEqual({ passive: false });

    document.dispatchEvent(touchEvent('touchcancel'));
    expect(removeSpy.mock.calls.some(([type]) => type === 'touchmove')).toBe(true);
    expect(removeSpy.mock.calls.some(([type]) => type === 'touchcancel')).toBe(true);
  });
});
