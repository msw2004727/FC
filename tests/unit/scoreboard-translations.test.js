"use strict";

const translations = require("../../functions/scoreboard-translations");

describe("scoreboard translation helpers", () => {
  test("normalizes non-English source names for stable matching", () => {
    expect(translations.normalizeSourceName("Bóng đá Huế")).toBe("bong da hue");
    expect(translations.normalizeSourceName("Launceston City (F)")).toBe("launceston city f");
    expect(translations.normalizeSourceName("  Manchester   United  ")).toBe("manchester united");
  });

  test("applies approved translations and preserves source names", () => {
    const lookup = translations.createTranslationLookup([
      {
        provider: "sportsapipro",
        sport: "football",
        type: "team",
        sourceName: "AE Lerou",
        zhTW: "AE Lerou \u4e2d\u6587",
        status: "approved",
      },
      {
        provider: "sportsapipro",
        sport: "football",
        type: "league",
        sourceName: "Premier League",
        zhTW: "\u82f1\u8d85",
        status: "approved",
      },
    ]);
    const match = translations.applyScoreboardTranslationsToMatch({
      id: "m1",
      sport: "football",
      homeTeam: "AE Lerou",
      awayTeam: "Unknown FC",
      league: "Premier League",
      subtitle: "Premier League",
      title: "AE Lerou vs Unknown FC",
      status: "Scheduled",
    }, lookup);

    expect(match.homeTeam).toBe("AE Lerou \u4e2d\u6587");
    expect(match.homeTeamOriginal).toBe("AE Lerou");
    expect(match.league).toBe("\u82f1\u8d85");
    expect(match.leagueOriginal).toBe("Premier League");
    expect(match.awayTeam).toBe("Unknown FC");
    expect(match.title).toBe("AE Lerou \u4e2d\u6587 vs Unknown FC");
  });

  test("keep_original does not translate and does not create pending coverage", () => {
    const lookup = translations.createTranslationLookup([
      {
        provider: "sportsapipro",
        sport: "football",
        type: "team",
        sourceName: "Bóng đá Huế",
        status: "keep_original",
      },
    ]);
    const result = translations.translateSourceName("Bóng đá Huế", {
      lookup,
      sport: "football",
      type: "team",
    });
    expect(result.value).toBe("Bóng đá Huế");
    expect(result.status).toBe("keep_original");
    expect(result.translated).toBe(false);
  });

  test("collects candidates and aggregates by sport/type/status", () => {
    const terms = translations.collectTranslationTermsFromMatches([
      {
        id: "m1",
        sport: "football",
        homeTeam: "AE Lerou",
        awayTeam: "AS Asteras Pastidas",
        league: "A EPS Dodekanisou",
        title: "AE Lerou vs AS Asteras Pastidas",
        status: "Scheduled",
      },
    ]);
    expect(terms.map((item) => item.type)).toEqual(["team", "team", "league", "status"]);

    const lookup = translations.createTranslationLookup([
      {
        provider: "sportsapipro",
        sport: "football",
        type: "team",
        sourceName: "AE Lerou",
        zhTW: "AE Lerou \u4e2d\u6587",
        status: "approved",
      },
    ]);
    const stats = translations.aggregateTranslationStats({
      candidates: [
        { sport: "football", type: "team", sourceName: "AE Lerou", occurrenceCount: 3 },
        { sport: "football", type: "team", sourceName: "AS Asteras Pastidas", occurrenceCount: 2 },
        { sport: "basketball", type: "league", sourceName: "NBA", occurrenceCount: 9 },
      ],
      translations: [{ sourceName: "AE Lerou" }],
      lookup,
    });

    expect(stats.totals.approved).toBe(2);
    expect(stats.totals.pending).toBe(1);
    expect(stats.bySport.football.pending).toBe(1);
    expect(stats.topPending[0].sourceName).toBe("AS Asteras Pastidas");
  });
});
