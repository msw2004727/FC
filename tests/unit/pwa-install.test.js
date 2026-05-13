const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');

function readProjectFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function loadPwaInstallModule({ standalone = false } = {}) {
  const button = {
    style: { display: 'none' },
    listeners: {},
    removeAttribute: jest.fn(),
    addEventListener: jest.fn((type, handler) => {
      button.listeners[type] = handler;
    }),
  };

  const App = {
    _handlePwaInstallClick: jest.fn(),
  };

  const windowMock = {
    matchMedia: jest.fn(() => ({ matches: standalone })),
    navigator: { standalone },
    addEventListener: jest.fn(),
  };

  const context = {
    App,
    document: {
      getElementById: jest.fn((id) => (id === 'pwa-install-btn' ? button : null)),
      createElement: jest.fn(),
      body: { appendChild: jest.fn() },
    },
    window: windowMock,
    navigator: windowMock.navigator,
    requestAnimationFrame: (fn) => fn(),
    setTimeout,
    clearTimeout,
    console,
  };

  vm.runInNewContext(readProjectFile('js/modules/pwa-install.js'), context, {
    filename: 'js/modules/pwa-install.js',
  });

  return { App, button, windowMock };
}

describe('PWA install drawer button', () => {
  test('stays visible even when the app is already running in standalone PWA mode', () => {
    const { App, button, windowMock } = loadPwaInstallModule({ standalone: true });

    App.initPwaInstall();

    expect(button.style.display).toBe('');
    expect(button.removeAttribute).toHaveBeenCalledWith('aria-disabled');
    expect(button.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    expect(windowMock.addEventListener).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function));

    App._handlePwaInstallClick = jest.fn();
    button.listeners.click({
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    });
    expect(App._handlePwaInstallClick).toHaveBeenCalledTimes(1);
  });
});
