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

  test("default config enables core sports and featured sources without nested secrets", () => {
    const cfg = global.ScoreboardConfigUtils.defaultConfig();
    expect(cfg.homepageEnabled).toBe(true);
    expect(global.ScoreboardConfigUtils.SPORT_CATALOG).toHaveLength(35);
    expect(cfg.enabledSports).toEqual(["football", "basketball", "tennis", "baseball", "badminton"]);
    expect(global.ScoreboardConfigUtils.SPORT_CATALOG.map(item => item.key)).toEqual(expect.arrayContaining([
      "boxing",
      "rugby_league",
      "golf",
      "field_hockey",
      "beach_soccer",
      "netball",
      "pesapallo",
      "horse_racing",
      "winter_sports",
      "kabaddi",
    ]));
    expect(cfg.homepageOrder).toContain("premier_league");
    expect(cfg.featuredSources.premier_league.enabled).toBe(true);
    expect(cfg.featuredSources.mlb.enabled).toBe(false);
    expect(global.ScoreboardConfigUtils.toPersistedConfig(cfg).sports).toBeUndefined();
    expect(global.ScoreboardConfigUtils.toPersistedConfig(cfg).featuredSources).toBeUndefined();
  });

  test("normalizeConfig strips unknown sport/source keys and keeps list schema", () => {
    const cfg = global.ScoreboardConfigUtils.normalizeConfig({
      schemaVersion: 2,
      homepageEnabled: false,
      enabledSports: ["football", "pickleball", "golf", "basketball"],
      homepageSports: ["football"],
      liveSports: ["basketball"],
      scheduleSports: ["football", "basketball"],
      detailSports: ["football"],
      sportsOrder: ["basketball", "football", "golf", "unknown"],
      enabledFeaturedSources: ["nba", "bad"],
      featuredSourceOrder: ["nba", "premier_league"],
      homepageOrder: ["nba", "bad", "premier_league"],
    });

    expect(cfg.homepageEnabled).toBe(false);
    expect(cfg.enabledSports).toEqual(["football", "golf", "basketball"]);
    expect(cfg.sports.basketball.sortOrder).toBe(1);
    expect(cfg.sports.golf.sortOrder).toBe(3);
    expect(cfg.sports.football.homepageEnabled).toBe(true);
    expect(cfg.sports.basketball.liveEnabled).toBe(true);
    expect(cfg.enabledFeaturedSources).toEqual(["nba"]);
    expect(cfg.homepageOrder).toEqual(["nba", "premier_league"]);
    expect(global.ScoreboardConfigUtils.toPersistedConfig(cfg)).toMatchObject({
      schemaVersion: 2,
      enabledSports: ["football", "golf", "basketball"],
      enabledFeaturedSources: ["nba"],
    });
  });
});
