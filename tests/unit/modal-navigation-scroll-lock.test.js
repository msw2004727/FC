/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');

const NAVIGATION_SOURCE = fs.readFileSync(
  path.join(__dirname, '../../js/core/navigation.js'),
  'utf8'
);

function loadNavigationApp() {
  const App = {
    _lazyRouteGateways: {},
    _lazyRoutePreexistingMethods: {},
    _reconcileLazyRouteGateways: jest.fn(),
    _maybeRunDeferredSwReload: jest.fn(),
    showToast: jest.fn(),
  };
  new Function('App', NAVIGATION_SOURCE)(App);
  return App;
}

describe('create event modal navigation scroll lock', () => {
  let App;
  let originalScrollTo;

  beforeEach(() => {
    document.documentElement.className = '';
    document.body.className = '';
    document.body.removeAttribute('style');
    document.body.innerHTML = `
      <div id="modal-overlay" class="modal-overlay"></div>
      <div id="create-event-modal" class="modal" data-no-backdrop-close="1">
        <div class="modal-header">Create</div>
        <div class="modal-body"><button id="modal-child">inside</button></div>
        <div class="modal-actions"></div>
      </div>
      <div id="other-modal" class="modal"><div class="modal-body"></div></div>`;
    Object.defineProperty(window, 'pageYOffset', {
      configurable: true,
      value: 120,
    });
    originalScrollTo = window.scrollTo;
    window.scrollTo = jest.fn();
    App = loadNavigationApp();
  });

  afterEach(() => {
    App?._createEventModalScrollObserver?.disconnect?.();
    window.scrollTo = originalScrollTo;
    document.body.innerHTML = '';
  });

  test('open fixes the body and close restores the exact inline style and scroll position', () => {
    document.body.style.position = 'relative';
    document.body.style.top = '2px';
    document.body.style.left = '3px';
    document.body.style.right = '4px';
    document.body.style.width = '90%';

    App.showModal('create-event-modal');

    expect(document.getElementById('create-event-modal').classList.contains('open')).toBe(true);
    expect(document.documentElement.classList.contains('create-event-modal-open')).toBe(true);
    expect(document.body.classList.contains('create-event-modal-open')).toBe(true);
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-120px');
    expect(document.body.style.left).toBe('0px');
    expect(document.body.style.right).toBe('0px');
    expect(document.body.style.width).toBe('100%');

    App.closeModal();

    expect(document.documentElement.classList.contains('create-event-modal-open')).toBe(false);
    expect(document.body.classList.contains('create-event-modal-open')).toBe(false);
    expect(document.body.style.position).toBe('relative');
    expect(document.body.style.top).toBe('2px');
    expect(document.body.style.left).toBe('3px');
    expect(document.body.style.right).toBe('4px');
    expect(document.body.style.width).toBe('90%');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 120);
  });

  test('submit guard and nested modal-open changes cannot release the create modal lock', () => {
    document.body.classList.add('modal-open');
    App.showModal('create-event-modal');

    document.body.classList.remove('modal-open');
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.classList.contains('create-event-modal-open')).toBe(true);

    App._eventSubmitInFlight = true;
    App.closeModal();

    expect(document.getElementById('create-event-modal').classList.contains('open')).toBe(true);
    expect(document.body.style.position).toBe('fixed');
    expect(App.showToast).toHaveBeenCalledWith('資料儲存中，請稍候');

    document.body.classList.add('modal-open');
    App.closeModal({ allowSubmitting: true });

    expect(document.body.classList.contains('create-event-modal-open')).toBe(false);
    expect(document.body.classList.contains('modal-open')).toBe(true);
    expect(document.body.style.position).toBe('');
  });

  test('opening another shared modal releases only the create modal scroll lock', () => {
    App.showModal('create-event-modal');
    App.showModal('other-modal');

    expect(document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    expect(document.getElementById('other-modal').classList.contains('open')).toBe(true);
    expect(document.getElementById('modal-overlay').classList.contains('open')).toBe(true);
    expect(document.body.classList.contains('create-event-modal-open')).toBe(false);
    expect(document.body.style.position).toBe('');
  });

  test('programmatic class removal is observed and cannot leave the body fixed', async () => {
    const modal = document.getElementById('create-event-modal');
    App.showModal('create-event-modal');

    modal.classList.remove('open');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.body.classList.contains('create-event-modal-open')).toBe(false);
    expect(document.body.style.position).toBe('');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 120);
  });

  test('overlay touch guard binds once, blocks backdrop touch, and permits modal content touch', () => {
    const overlay = document.getElementById('modal-overlay');
    const addEventListenerSpy = jest.spyOn(overlay, 'addEventListener');

    App.showModal('create-event-modal');
    App.toggleModal('create-event-modal');
    App.showModal('create-event-modal');

    const touchBindings = addEventListenerSpy.mock.calls.filter(([type]) => type === 'touchmove');
    expect(touchBindings).toHaveLength(1);
    expect(touchBindings[0][2]).toEqual({ passive: false });

    const dispatchedTouch = new Event('touchmove', { bubbles: true, cancelable: true });
    overlay.dispatchEvent(dispatchedTouch);
    expect(dispatchedTouch.defaultPrevented).toBe(true);

    const outsideTouch = {
      target: overlay,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };
    App._handleModalBackdropTouchMove(outsideTouch);
    expect(outsideTouch.preventDefault).toHaveBeenCalledTimes(1);
    expect(outsideTouch.stopPropagation).toHaveBeenCalledTimes(1);

    const insideTouch = {
      target: document.getElementById('modal-child'),
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };
    App._handleModalBackdropTouchMove(insideTouch);
    expect(insideTouch.preventDefault).not.toHaveBeenCalled();
    expect(insideTouch.stopPropagation).not.toHaveBeenCalled();
  });

  test('a locked shared overlay refuses opening without creating a stale body lock', () => {
    const overlay = document.getElementById('modal-overlay');
    overlay.dataset.locked = '1';

    App.showModal('create-event-modal');

    expect(document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    expect(document.body.classList.contains('create-event-modal-open')).toBe(false);
    expect(document.body.style.position).toBe('');
  });

  test('page-switch cleanup closes only the idle create modal and restores the page scroll lock', () => {
    App.currentPage = 'page-activities';
    document.body.style.position = 'relative';
    document.body.style.top = '2px';
    App.showModal('create-event-modal');

    const result = App._cleanupBeforePageSwitch('page-home');

    expect(result).toBe(true);
    expect(document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    expect(document.getElementById('modal-overlay').classList.contains('open')).toBe(false);
    expect(document.documentElement.classList.contains('create-event-modal-open')).toBe(false);
    expect(document.body.classList.contains('create-event-modal-open')).toBe(false);
    expect(document.body.style.position).toBe('relative');
    expect(document.body.style.top).toBe('2px');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 120);
  });

  test('page-switch cleanup blocks before closing a submitting create modal', () => {
    App.currentPage = 'page-activities';
    App.showModal('create-event-modal');
    App._eventSubmitInFlight = true;

    const result = App._cleanupBeforePageSwitch('page-home');

    expect(result).toBe(false);
    expect(document.getElementById('create-event-modal').classList.contains('open')).toBe(true);
    expect(document.getElementById('modal-overlay').classList.contains('open')).toBe(true);
    expect(document.documentElement.classList.contains('create-event-modal-open')).toBe(true);
    expect(document.body.classList.contains('create-event-modal-open')).toBe(true);
    expect(document.body.style.position).toBe('fixed');
    expect(App.showToast).toHaveBeenCalledWith('資料儲存中，請稍候');
  });

  test('page-switch cleanup preserves another modal and the first-login overlay scroll owner', () => {
    App.currentPage = 'page-activities';
    App.showModal('create-event-modal');
    const overlay = document.getElementById('modal-overlay');
    const otherModal = document.getElementById('other-modal');
    otherModal.classList.add('open');
    overlay.dataset.locked = '1';
    overlay.dataset.profileComplete = '1';
    document.documentElement.classList.add('profile-complete-scroll-lock');
    document.body.classList.add('profile-complete-scroll-lock', 'modal-open');
    App._firstLoginScrollLocked = true;

    const result = App._cleanupBeforePageSwitch('page-home');

    expect(result).toBe(true);
    expect(document.getElementById('create-event-modal').classList.contains('open')).toBe(false);
    expect(otherModal.classList.contains('open')).toBe(true);
    expect(overlay.classList.contains('open')).toBe(true);
    expect(overlay.dataset.locked).toBe('1');
    expect(document.documentElement.classList.contains('profile-complete-scroll-lock')).toBe(true);
    expect(document.body.classList.contains('profile-complete-scroll-lock')).toBe(true);
    expect(document.body.classList.contains('modal-open')).toBe(true);
    expect(document.body.style.position).toBe('fixed');
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
