"use strict";

const utils = require("../../functions/scoreboard-sportsapipro-utils");
const scoreboard = require("../../functions/scoreboard-sportsapipro").__test;

describe("SportsAPI Pro scoreboard normalizer", () => {
  test("builds V2 base URLs from supported sport catalog", () => {
    expect(utils.sportsApiBaseUrl("football")).toBe("https://v2.football.sportsapipro.com");
    expect(utils.sportsApiBaseUrl("badminton")).toBe("https://v2.badminton.sportsapipro.com");
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
    expect(requests.map((item) => item.path)).toEqual(["/api/live", "/api/today", "/status"]);
    expect(requests[0]).toMatchObject({ sport: "football", date: "2026-05-06" });
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
});
