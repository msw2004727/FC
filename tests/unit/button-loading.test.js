describe('button loading helper', () => {
  beforeEach(() => {
    jest.resetModules();
    global.App = {};
  });

  afterEach(() => {
    delete global.App;
  });

  test('toggles signup glow loading state while async action runs', async () => {
    require('../../js/core/button-loading.js');
    const classes = new Set();
    const glowWrap = {
      isConnected: true,
      classList: {
        add: jest.fn(name => classes.add(name)),
        remove: jest.fn(name => classes.delete(name)),
      },
    };
    const button = {
      dataset: {},
      textContent: '參加賽事',
      disabled: false,
      style: { opacity: '' },
      isConnected: true,
      closest: jest.fn(selector => (selector === '.signup-glow-wrap' ? glowWrap : null)),
      getAttribute: jest.fn(() => null),
      setAttribute: jest.fn(),
      removeAttribute: jest.fn(),
    };

    let sawLoadingState = false;
    await global.App._withButtonLoading(button, '報名中...', async () => {
      sawLoadingState = classes.has('loading')
        && button.dataset.btnLoading === '1'
        && button.textContent === '報名中...'
        && button.disabled === true
        && button.style.opacity === '';
    });

    expect(sawLoadingState).toBe(true);
    expect(classes.has('loading')).toBe(false);
    expect(button.dataset.btnLoading).toBe('');
    expect(button.textContent).toBe('參加賽事');
    expect(button.disabled).toBe(false);
    expect(button.setAttribute).toHaveBeenCalledWith('aria-busy', 'true');
    expect(button.removeAttribute).toHaveBeenCalledWith('aria-busy');
  });
});
