const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadEventCreateModule(options = {}) {
  const blob = options.blob || { type: 'image/png', size: 1024 };
  const fetchMock = options.fetch || jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    blob: jest.fn().mockResolvedValue(blob),
  });
  const compressMock = options.compress || jest.fn().mockResolvedValue('data:image/webp;base64,DEFAULT_COVER');
  const App = {
    _compressImage: compressMock,
    showToast: jest.fn(),
  };
  const sandbox = {
    App,
    CACHE_VERSION: options.cacheVersion || '0.20260505test',
    fetch: fetchMock,
    document: { baseURI: options.baseURI || 'https://toosterx.com/' },
    window: {
      location: { href: options.baseURI || 'https://toosterx.com/' },
      ...(options.indexVersion
        ? { getSportHubAssetVersion: () => options.indexVersion }
        : {}),
    },
    URL,
    encodeURI,
    encodeURIComponent,
    console: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
  };
  const code = fs.readFileSync(path.join(ROOT, 'js/modules/event/event-create.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'js/modules/event/event-create.js' });
  return { App, fetchMock, compressMock, blob, consoleMock: sandbox.console };
}

describe('event default cover image', () => {
  test('default cover asset exists in LOGO directory', () => {
    expect(fs.existsSync(path.join(ROOT, 'LOGO/Nocoverimage set.png'))).toBe(true);
  });

  test('keeps user selected image without fetching default cover', async () => {
    const { App, fetchMock, compressMock } = loadEventCreateModule();

    await expect(App._resolveEventCoverImage('data:image/webp;base64,USER_IMAGE'))
      .resolves.toBe('data:image/webp;base64,USER_IMAGE');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(compressMock).not.toHaveBeenCalled();
  });

  test('uses the versioned static default cover without fetch, compression, or upload data', async () => {
    const { App, fetchMock, compressMock } = loadEventCreateModule();

    const first = await App._resolveEventCoverImage(null);
    const second = await App._resolveEventCoverImage('');

    expect(first).toBe('https://toosterx.com/LOGO/Nocoverimage%20set.png?v=0.20260505test');
    expect(second).toBe('https://toosterx.com/LOGO/Nocoverimage%20set.png?v=0.20260505test');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(compressMock).not.toHaveBeenCalled();
  });

  test('uses the canonical index version when config is stale', () => {
    const { App } = loadEventCreateModule({
      cacheVersion: '0.old',
      indexVersion: '0.index',
    });

    expect(App._getDefaultEventCoverUrl())
      .toBe('https://toosterx.com/LOGO/Nocoverimage%20set.png?v=0.index');
  });

  test('does not depend on a per-submit fetch of the default cover', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('offline'));
    const { App, compressMock } = loadEventCreateModule({ fetch: fetchMock });

    await expect(App._resolveEventCoverImage(null))
      .resolves.toBe('https://toosterx.com/LOGO/Nocoverimage%20set.png?v=0.20260505test');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(compressMock).not.toHaveBeenCalled();
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('maps create event permission errors to actionable messages', () => {
    const { App } = loadEventCreateModule();

    expect(App._getCreateEventWriteErrorMessage(
      { code: 'permission-denied', message: 'Missing or insufficient permissions.' },
      { teamOnly: true, creatorTeamIds: ['team-1'] },
    )).toBe('俱樂部限定活動需要俱樂部開團權限，請關閉「俱樂部限定」或聯繫管理員');

    expect(App._getCreateEventWriteErrorMessage(
      { code: 'permission-denied', message: 'Missing or insufficient permissions.' },
      { feeEnabled: true, privateEvent: true },
    )).toBe('你目前沒有使用「費用、私密活動」的權限，請關閉相關進階功能後再試');

    expect(App._getCreateEventWriteErrorMessage(
      { code: 'deadline-exceeded', message: 'deadline exceeded' },
      {},
    )).toBe('連線逾時，請檢查網路後再試');
  });
});
