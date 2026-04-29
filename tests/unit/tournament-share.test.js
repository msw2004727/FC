describe('tournament share feedback', () => {
  beforeEach(() => {
    jest.resetModules();
    global.ApiService = {
      getFriendlyTournamentRecord: jest.fn(() => null),
      getTournament: jest.fn(() => null),
      getTournamentAsync: jest.fn(() => Promise.resolve(null)),
    };
    global.App = {
      _shareInProgress: false,
      showToast: jest.fn(),
    };
  });

  afterEach(() => {
    delete global.ApiService;
    delete global.App;
    delete global.LineAuth;
    delete global.navigator;
  });

  test('shows a toast when tournament data is unavailable', async () => {
    require('../../js/modules/tournament/tournament-share.js');

    await global.App.shareTournament('ct_missing');

    expect(global.ApiService.getTournamentAsync).toHaveBeenCalledWith('ct_missing');
    expect(global.App.showToast).toHaveBeenCalledWith('找不到賽事資料，請重新整理後再試');
  });

  test('uses button loading feedback while preparing share', async () => {
    const button = { textContent: '分享賽事' };
    const loadingResult = { ok: true };
    global.App._withButtonLoading = jest.fn(() => loadingResult);

    require('../../js/modules/tournament/tournament-share.js');

    const result = await global.App.shareTournament('ct_test', button);

    expect(result).toBe(loadingResult);
    expect(global.App._withButtonLoading).toHaveBeenCalledWith(
      button,
      '分享中...',
      expect.any(Function),
    );
  });

  test('prevents duplicate share taps with visible feedback', async () => {
    global.App._shareInProgress = true;
    require('../../js/modules/tournament/tournament-share.js');

    await global.App.shareTournament('ct_test');

    expect(global.App.showToast).toHaveBeenCalledWith('分享準備中，請稍候');
  });
});
