describe("ScoreboardConfigUtils", () => {
  beforeEach(() => {
    jest.resetModules();
    global.App = {};
    global.FirebaseService = {};
    global.db = null;
    require("../../js/modules/scoreboard/scoreboard-config.js");
  });

  afterEach(() => {
    delete global.App;
    delete global.ScoreboardConfigUtils;
    delete global.FirebaseService;
    delete global.db;
  });

  test("default config enables football sources and keeps future sources available", () => {
    const cfg = global.ScoreboardConfigUtils.defaultConfig();
    expect(cfg.homepageEnabled).toBe(true);
    expect(cfg.homepageOrder).toContain("premier_league");
    expect(cfg.sources.premier_league.enabled).toBe(true);
    expect(cfg.sources.nba.enabled).toBe(false);
  });

  test("normalizeConfig strips unknown source keys and keeps safe source fields", () => {
    const cfg = global.ScoreboardConfigUtils.normalizeConfig({
      homepageEnabled: false,
      homepageOrder: ["world_cup", "unknown", "premier_league"],
      sources: {
        premier_league: {
          enabled: true,
          label: "Premier League",
          sport: "ignored",
          sourceKey: "football_epl",
          apiKey: "should-strip",
          sortOrder: 2,
          secret: "bad",
        },
        unknown: { enabled: true },
      },
    });

    expect(cfg.homepageEnabled).toBe(false);
    expect(cfg.homepageOrder.slice(0, 2)).toEqual(["world_cup", "premier_league"]);
    expect(cfg.sources.unknown).toBeUndefined();
    expect(cfg.sources.premier_league).toMatchObject({
      enabled: true,
      label: "Premier League",
      sport: "football",
      sourceKey: "football_epl",
      sortOrder: 2,
    });
    expect(cfg.sources.premier_league.secret).toBeUndefined();
    expect(cfg.sources.premier_league.apiKey).toBeUndefined();
  });
});
