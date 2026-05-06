"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const configSource = fs.readFileSync(path.join(__dirname, "../../js/modules/scoreboard/scoreboard-config.js"), "utf8");
const publicSource = fs.readFileSync(path.join(__dirname, "../../js/modules/scoreboard/scoreboard-public.js"), "utf8");

function runModules() {
  const dom = new JSDOM(`<!doctype html><section id="scoreboard-public-root"></section>`, { url: "https://example.test/" });
  const app = {
    _markPageSnapshotReady: jest.fn(),
    showPage: jest.fn(),
  };
  const config = {
    schemaVersion: 2,
    publicPageEnabled: true,
    enabledSports: ["football", "basketball"],
    homepageSports: ["football"],
    liveSports: ["football", "basketball"],
    scheduleSports: ["football", "basketball"],
    detailSports: ["football", "basketball"],
    sportsOrder: ["football", "basketball"],
    defaultSportTabs: ["football", "basketball"],
    enabledFeaturedSources: ["premier_league", "nba"],
    featuredSourceOrder: ["premier_league", "nba"],
    homepageOrder: ["premier_league", "nba"],
  };
  const snapshot = {
    liveMatches: [{
      id: "m1",
      sport: "football",
      title: "A vs B",
      league: "Premier League",
      homeTeam: "A",
      awayTeam: "B",
      homeScore: 1,
      awayScore: 0,
      isLive: true,
      detailCacheKey: "football_m1",
    }],
    recentSchedule: [{
      id: "m2",
      sport: "basketball",
      title: "C vs D",
      league: "NBA",
      isLive: false,
      timeLabel: "20:00",
      detailCacheKey: "basketball_m2",
    }],
  };
  const context = vm.createContext({
    window: dom.window,
    globalThis: dom.window,
    document: dom.window.document,
    console,
    App: app,
    escapeHTML: value => String(value ?? ""),
    FirebaseService: {
      getCachedDoc: jest.fn((collection, id) => {
        if (collection === "siteConfig" && id === "scoreboardConfig") return config;
        if (collection === "scoreboardSnapshots" && id === "home") return snapshot;
        return null;
      }),
      ensureSingleDocLoaded: jest.fn(),
      _cache: {},
    },
    ApiService: { getCurrentUser: jest.fn(() => null) },
  });
  vm.runInContext(configSource, context);
  vm.runInContext(publicSource, context);
  return { app, dom };
}

describe("scoreboard public render", () => {
  test("renders sport tabs, live scores, schedule and detail modal fallback", async () => {
    const { app, dom } = runModules();
    await app.renderScoreboardPublic("football");
    const root = dom.window.document.getElementById("scoreboard-public-root");

    expect(root.textContent).toContain("足球");
    expect(root.textContent).toContain("A vs B");
    expect(root.textContent).toContain("即時比分");

    await app.renderScoreboardPublic("basketball");
    expect(root.textContent).toContain("C vs D");
    expect(root.textContent).toContain("最近賽程");

    await app.openScoreboardMatchDetail("basketball", "m2");
    expect(dom.window.document.getElementById("scoreboard-detail-overlay").textContent).toContain("C vs D");
  });
});
