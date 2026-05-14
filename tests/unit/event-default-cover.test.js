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
    window: { location: { href: options.baseURI || 'https://toosterx.com/' } },
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

  test('fetches default cover, compresses it, and caches the result', async () => {
    const { App, fetchMock, compressMock, blob } = loadEventCreateModule();

    const first = await App._resolveEventCoverImage(null);
    const second = await App._resolveEventCoverImage('');

    expect(first).toBe('data:image/webp;base64,DEFAULT_COVER');
    expect(second).toBe('data:image/webp;base64,DEFAULT_COVER');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://toosterx.com/LOGO/Nocoverimage%20set.png?v=0.20260505test');
    expect(fetchMock.mock.calls[0][1]).toEqual({ cache: 'force-cache' });
    expect(compressMock).toHaveBeenCalledTimes(1);
    expect(compressMock).toHaveBeenCalledWith(blob, 1200, 0.9, 'image/webp');
  });

  test('shows a clear toast when default cover cannot be loaded', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      blob: jest.fn(),
    });
    const { App, compressMock, consoleMock } = loadEventCreateModule({ fetch: fetchMock });

    await expect(App._resolveEventCoverImage(null)).rejects.toThrow('DEFAULT_EVENT_COVER_NOT_FOUND:404');

    expect(compressMock).not.toHaveBeenCalled();
    expect(App.showToast).toHaveBeenCalledWith('預設活動封面載入失敗，請重新整理後再試');
    expect(consoleMock.error).toHaveBeenCalled();
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
