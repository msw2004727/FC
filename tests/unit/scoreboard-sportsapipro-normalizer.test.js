"use strict";

const utils = require("../../functions/scoreboard-sportsapipro-utils");
const scoreboard = require("../../functions/scoreboard-sportsapipro").__test;

describe("SportsAPI Pro scoreboard normalizer", () => {
  test("builds V2 base URLs from supported sport catalog", () => {
    expect(utils.SUPPORTED_SPORTS).toHaveLength(35);
    expect(utils.sportsApiBaseUrl("football")).toBe("https://v2.football.sportsapipro.com");
    expect(utils.sportsApiBaseUrl("badminton")).toBe("https://v2.badminton.sportsapipro.com");
    expect(utils.sportsApiBaseUrl("golf")).toBe("https://v2.golf.sportsapipro.com");
    expect(utils.sportsApiBaseUrl("horse_racing")).toBe("https://v2.horse-racing.sportsapipro.com");
    expect(utils.SUPPORTED_SPORTS.map((item) => item.key)).toEqual(expect.arrayContaining([
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
    expect(utils.sportsApiBaseUrl("unknown")).toBeNull();
  });

  test("normalizes events and data.events response shapes", () => {
    const flat = utils.normalizeMatches({
      events: [{
        id: 1,
        tournament: { name: "Premier League" },
        homeTeam: { name: "A" },
        awayTeam: { name: "B" },
        homeScore: 2,
        awayScore: 1,
        status: "In progress",
        startTimestamp: 1778068800,
      }],
    }, { sport: "football", kind: "live" });

    const nested = utils.normalizeMatches({
      data: {
        events: [{
          matchId: "m2",
          league: "NBA",
          home: "C",
          away: "D",
          homeScore: { current: 100 },
          awayScore: { display: "98" },
          status: { description: "Scheduled", code: 0 },
          date: "2026-05-06T12:00:00Z",
        }],
      },
    }, { sport: "basketball", kind: "today" });

    expect(flat[0]).toMatchObject({
      id: "1",
      sport: "football",
      homeTeam: "A",
      awayTeam: "B",
      homeScore: 2,
      awayScore: 1,
      isLive: true,
      sourceId: "premier_league",
    });
    expect(nested[0]).toMatchObject({
      id: "m2",
      sport: "basketball",
      homeTeam: "C",
      awayTeam: "D",
      homeScore: 100,
      awayScore: "98",
      isLive: false,
    });
  });

  test("plans only enabled sports and uses Taipei date for request metadata", () => {
    const cfg = utils.normalizeScoreboardConfig({
      sports: {
        football: { enabled: true, sortOrder: 2 },
        basketball: { enabled: false },
        tennis: { enabled: false },
        baseball: { enabled: false },
        badminton: { enabled: false },
      },
    });
    const requests = utils.planRequests(cfg, new Date("2026-05-05T16:30:00.000Z"));
    expect(requests.map((item) => item.path)).toEqual([
      "/api/live?timezoneName=Asia%2FTaipei",
      "/api/today?timezoneName=Asia%2FTaipei",
      "/api/schedule/2026-05-07?timezoneName=Asia%2FTaipei",
      "/status",
    ]);
    expect(requests[0]).toMatchObject({ sport: "football", date: "2026-05-06" });
  });

  test("builds homepage sections for upcoming, featured, and score tabs", () => {
    const fakeTimestamp = { fromMillis: (ms) => ({ ms, toMillis: () => ms }) };
    const fakeFieldValue = { serverTimestamp: () => "SERVER_TIMESTAMP" };
    const now = new Date("2026-05-06T00:00:00.000Z");
    const config = utils.normalizeScoreboardConfig({
      enabledSports: ["football"],
      homepageSports: ["football"],
      liveSports: ["football"],
      scheduleSports: ["football"],
    });
    const snapshot = scoreboard.snapshotFromResults({
      config,
      liveMatches: [{
        id: "live1",
        sport: "football",
        sourceId: "premier_league",
        title: "Live A vs Live B",
        startsAt: "2026-05-05T23:30:00.000Z",
        isLive: true,
      }],
      scheduleMatches: [{
        id: "up1",
        sport: "football",
        sourceId: "premier_league",
        title: "Soon A vs Soon B",
        startsAt: "2026-05-06T12:00:00.000Z",
      }, {
        id: "late1",
        sport: "football",
        sourceId: "football",
        title: "Late A vs Late B",
        startsAt: "2026-05-08T12:00:00.000Z",
      }],
      errors: [],
      statusPayload: null,
      fetchedAtBySport: { football: "2026-05-06T00:00:00.000Z" },
      now,
      Timestamp: fakeTimestamp,
      FieldValue: fakeFieldValue,
    });

    expect(snapshot.homepageSections.upcoming24h.matches.map((item) => item.id)).toEqual(["up1"]);
    expect(snapshot.homepageSections.featured.matches.map((item) => item.id)).toEqual(["live1", "up1"]);
    expect(snapshot.homepageSections.scores.matches.map((item) => item.id)).toContain("live1");
    expect(snapshot.homepageSections.scores.updatedAt).toEqual(snapshot.generatedAt);
  });

  test("sanitizes status payload without account secrets", () => {
    const status = utils.sanitizeStatusPayload({
      account: { plan: "free", email: "hidden@example.test" },
      usage: { daily_limit: 100, remaining: 90, requests_today: 10, reset_at: "2026-05-07T00:00:00Z" },
    }, {
      "x-ratelimit-limit": "100",
      "x-ratelimit-remaining": "90",
    });

    expect(status).toEqual({
      provider: "sportsapipro",
      account: { plan: "free" },
      usage: { dailyLimit: 100, remaining: 90, requestsToday: 10, resetAt: "2026-05-07T00:00:00Z" },
      rateLimitHeaders: { limit: "100", remaining: "90", reset: null },
    });
    expect(JSON.stringify(status)).not.toContain("hidden@example.test");
  });

  test("detail sanitizer omits raw response and betting data", () => {
    const fakeTimestamp = { fromMillis: (ms) => ({ ms, toMillis: () => ms }) };
    const fakeFieldValue = { serverTimestamp: () => "SERVER_TIMESTAMP" };
    const detail = scoreboard.sanitizeDetailPayload({
      sport: "football",
      matchId: "abc",
      matchPayload: {
        event: {
          id: "abc",
          homeTeam: { name: "A" },
          awayTeam: { name: "B" },
          tournament: { name: "League" },
          odds: { home: 1.5 },
        },
      },
      statisticsPayload: { statistics: [{ name: "Possession", home: "60%", away: "40%" }] },
      incidentsPayload: { incidents: [{ type: "goal", playerName: "A1" }] },
      lineupsPayload: { lineups: { home: { team: { name: "A" }, players: [1, 2] } } },
      unavailable: [],
      now: new Date("2026-05-06T00:00:00.000Z"),
      Timestamp: fakeTimestamp,
      FieldValue: fakeFieldValue,
    });

    expect(detail.summary.title).toBe("A vs B");
    expect(detail.statistics).toHaveLength(1);
    expect(detail.incidents).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain("odds");
    expect(JSON.stringify(detail)).not.toContain("betting");
  });

  test("compact match keeps translated display values and original source names", () => {
    const compact = scoreboard.compactMatch({
      id: "m1",
      sport: "football",
      sourceId: "premier_league",
      league: "\u82f1\u8d85",
      leagueOriginal: "Premier League",
      title: "\u66fc\u806f vs Liverpool",
      titleOriginal: "Manchester United vs Liverpool",
      homeTeam: "\u66fc\u806f",
      homeTeamOriginal: "Manchester United",
      awayTeam: "Liverpool",
      status: "\u9032\u884c\u4e2d",
      statusOriginal: "Live",
      detailCacheKey: "football_m1",
      translationStatus: { homeTeam: "approved", status: "approved" },
    });

    expect(compact.homeTeam).toBe("\u66fc\u806f");
    expect(compact.homeTeamOriginal).toBe("Manchester United");
    expect(compact.leagueOriginal).toBe("Premier League");
    expect(compact.statusOriginal).toBe("Live");
    expect(compact.translationStatus).toEqual({ homeTeam: "approved", status: "approved" });
  });
});
