const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const source = fs.readFileSync(
  path.join(__dirname, "../../js/modules/home-dashboard.js"),
  "utf8"
);
const homeCssSource = fs.readFileSync(
  path.join(__dirname, "../../css/home.css"),
  "utf8"
);
const homeHtmlSource = fs.readFileSync(
  path.join(__dirname, "../../pages/home.html"),
  "utf8"
);

function runHomeDashboardModule(options = {}) {
  const dom = new JSDOM(`<!doctype html>
    <div id="home-sport-entry"></div>
    <div id="home-info-meter"></div>
    <section id="home-scoreboard-preview"></section>
    <select id="activity-filter-type"><option value=""></option><option value="watch"></option></select>
    <input id="activity-filter-keyword" value="">
  `, { url: "https://example.test/" });
  const app = {
    _markPageSnapshotReady: jest.fn(),
    showPage: jest.fn(),
    resetActivityTab: jest.fn(),
    renderActivityList: jest.fn(),
    renderTeamList: jest.fn(),
    renderTournamentTimeline: jest.fn(),
    showToast: jest.fn(),
  };
  const context = vm.createContext({
    window: dom.window,
    globalThis: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    console,
    App: app,
    EVENT_SPORT_OPTIONS: [
      { key: "football", label: "足球" },
      { key: "dodgeball", label: "躲避球" },
      { key: "basketball", label: "籃球" },
    ],
    escapeHTML: value => String(value ?? ""),
    getSportIconSvg: key => `<span>${key}</span>`,
    getSportKeySafe: key => key,
    getSportLabelByKey: key => key,
    ScriptLoader: {
      ensureForPage: jest.fn().mockResolvedValue(undefined),
    },
  });
  if (options.firebaseService) {
    context.FirebaseService = options.firebaseService;
  }
  if (options.sports) {
    context.EVENT_SPORT_OPTIONS = options.sports;
  }
  vm.runInContext(source, context);
  app._homeSummary = {
    counts: { activities: 20, teams: 6, tournaments: 0 },
    activityViews: { total: 311, label: "已記錄瀏覽" },
    sportCounts: [
      { sportTag: "football", count: 19 },
      { sportTag: "dodgeball", count: 1 },
    ],
  };
  return { app, dom, context };
}

describe("home-dashboard browser binding", () => {
  test("home hero action row keeps watch party and create buttons under the shortened banner", () => {
    expect(homeCssSource).toMatch(/\.banner-slide\s*\{[\s\S]*aspect-ratio:\s*3\.3\s*\/\s*1/);
    expect(homeHtmlSource).toContain("home-watch-party-card");
    expect(homeHtmlSource).toContain("App.openHomeWatchParty()");
    expect(homeHtmlSource).toContain("home-create-event-btn");
  });

  test("scoreboard preview has a divider from the current info section only when populated", () => {
    expect(homeCssSource).toMatch(/\.home-scoreboard-preview:not\(:empty\)\s*\{[\s\S]*border-top:\s*1px solid var\(--border\)/);
  });

  test("attaches to lexical App and renders homepage cards when window.App is empty", async () => {
    const { app, dom } = runHomeDashboardModule();

    expect(dom.window.App).toBe(app);
    expect(typeof app.renderHomeDashboard).toBe("function");
    expect(typeof app.renderHomeScoreboardPreview).toBe("function");

    app.renderHomeDashboard();
    await app.renderHomeScoreboardPreview();

    const sportEntry = dom.window.document.getElementById("home-sport-entry");
    expect(sportEntry.children).toHaveLength(3);
    expect(sportEntry.textContent).toContain("19 活動");
    expect(sportEntry.textContent).toContain("查看更多");
    expect(sportEntry.textContent).not.toContain("0 活動");
    expect(sportEntry.querySelector(".home-sport-chip-more")?.getAttribute("onclick")).toBe("App.selectHomeSport('all')");
    expect(sportEntry.textContent).not.toContain("足球");
    expect(sportEntry.querySelector('[data-home-sport="football"]')?.getAttribute("aria-label")).toContain("足球");
    expect(sportEntry.querySelector(".home-sport-chip-mark")?.innerHTML).toContain("football");
    expect(dom.window.document.getElementById("home-info-meter").children).toHaveLength(3);
    expect(dom.window.document.getElementById("home-info-meter").textContent).toContain("已開放活動");
    expect(dom.window.document.getElementById("home-info-meter").textContent).toContain("已成立俱樂部");
    expect(dom.window.document.getElementById("home-info-meter").textContent).toContain("正舉辦賽事");
    expect(dom.window.document.getElementById("home-info-meter").textContent).not.toContain("活動數");
    expect(dom.window.document.getElementById("home-info-meter").textContent).not.toContain("預留");
    expect(dom.window.document.getElementById("home-info-meter").textContent).toContain("811");
    expect(dom.window.document.querySelectorAll(".home-stat-views")).toHaveLength(1);

    const scoreboard = dom.window.document.getElementById("home-scoreboard-preview");
    expect(scoreboard.style.display).toBe("none");

    app._scoreboardConfig = {
      homepageEnabled: true,
      homepageSports: ["football", "basketball"],
      defaultSportTabs: ["football", "basketball"],
      featuredSources: { premier_league: { enabled: true }, nba: { enabled: true } },
    };
    app._scoreboardSnapshot = {
      generatedAt: { toMillis: () => Date.parse("2026-05-06T10:00:00Z") },
      homepageSections: {
        featured: {
          updatedAt: { toMillis: () => Date.parse("2026-05-06T10:00:00Z") },
          matches: [
            { id: "m1", sport: "football", sourceId: "premier_league", timeLabel: "今晚", dateLabel: "22:00", title: "A vs B", subtitle: "英超", status: "未開賽" },
            { id: "m2", sport: "basketball", sourceId: "nba", timeLabel: "明晚", dateLabel: "21:00", title: "C vs D", subtitle: "NBA", status: "Scheduled" },
          ],
        },
        live: {
          updatedAt: { toMillis: () => Date.parse("2026-05-06T10:01:00Z") },
          matches: [
            { id: "live1", sport: "football", isLive: true, timeLabel: "進行中", dateLabel: "05/06", title: "Live A vs Live B", subtitle: "英超", homeScore: 1, awayScore: 0 },
          ],
        },
        schedule: {
          updatedAt: { toMillis: () => Date.parse("2026-05-06T10:02:00Z") },
          matches: [
            { id: "up1", sport: "football", startsAt: "2026-05-06T12:00:00.000Z", timeLabel: "20:00", dateLabel: "05/06", title: "Soon A vs Soon B", subtitle: "歐冠", status: "Scheduled" },
          ],
        },
      },
    };
    await app.renderHomeScoreboardPreview();
    expect(scoreboard.style.display).toBe("");
    expect(scoreboard.querySelectorAll(".home-scoreboard-section-tab")).toHaveLength(3);
    expect(scoreboard.querySelector(".home-scoreboard-section-tab.active")?.getAttribute("onclick")).toContain("featured");
    expect(scoreboard.querySelector(".home-scoreboard-note")).not.toBeNull();
    expect(scoreboard.textContent).toContain("更新頻率仍在測試");
    expect(scoreboard.textContent).not.toContain("點擊可看更多賽事");
    expect(scoreboard.textContent).toContain("A vs B");
    expect(scoreboard.textContent).not.toContain("C vs D");

    app.selectHomeScoreboardSport("basketball");
    expect(scoreboard.textContent).toContain("C vs D");
    expect(scoreboard.textContent).not.toContain("A vs B");

    app.selectHomeScoreboardSection("live");
    expect(scoreboard.querySelector(".home-scoreboard-section-tab.active")?.getAttribute("onclick")).toContain("live");
    expect(scoreboard.textContent).toContain("Live A vs Live B");
    expect(scoreboard.querySelector(".home-scoreboard-note")).not.toBeNull();

    app.selectHomeScoreboardSection("schedule");
    expect(scoreboard.querySelector(".home-scoreboard-section-tab.active")?.getAttribute("onclick")).toContain("schedule");
    expect(scoreboard.textContent).toContain("Soon A vs Soon B");
    expect(scoreboard.querySelector(".home-scoreboard-note")).not.toBeNull();

    app.selectHomeScoreboardSection("featured");
    expect(scoreboard.querySelector(".home-scoreboard-section-tab.active")?.getAttribute("onclick")).toContain("featured");
    expect(scoreboard.querySelector(".home-scoreboard-note")).not.toBeNull();
  });

  test("refreshes stale sport quick entry from cached public events", async () => {
    const firebaseService = {
      _cache: {
        events: [
          { id: "a", status: "open", date: "2099/05/06 12:01", sportTag: "football", viewCount: 10 },
          { id: "b", status: "open", date: "2099/05/06 12:02", sportTag: "basketball", viewCount: 20 },
          { id: "c", status: "open", date: "2099/05/06 12:03", sportTag: "dodgeball", viewCount: 40, privateEvent: true },
        ],
      },
      _loadEventsStatic: jest.fn(),
    };
    const { app, dom } = runHomeDashboardModule({
      firebaseService,
      sports: [
        { key: "football", label: "Football" },
        { key: "basketball", label: "Basketball" },
        { key: "dodgeball", label: "Dodgeball" },
      ],
    });

    await app._refreshHomeSummaryFromEvents();

    const sportEntry = dom.window.document.getElementById("home-sport-entry");
    expect(firebaseService._loadEventsStatic).not.toHaveBeenCalled();
    expect(firebaseService._cache.homeSummary.counts.activities).toBe(2);
    expect(firebaseService._cache.homeSummary.activityViews.total).toBe(30);
    expect(firebaseService._cache.homeSummary.sportCounts).toEqual([
      { sportTag: "basketball", count: 1 },
      { sportTag: "football", count: 1 },
    ]);
    expect(sportEntry.querySelector('[data-home-sport="basketball"]')).not.toBeNull();
    expect(sportEntry.querySelector('[data-home-sport="football"]')).not.toBeNull();
    expect(sportEntry.querySelector('[data-home-sport="dodgeball"]')).toBeNull();
    expect(dom.window.document.getElementById("home-info-meter").textContent).toContain("530");
  });

  test("watch party shortcut opens activities with the restaurant sport filter", async () => {
    const { app, dom, context } = runHomeDashboardModule();
    dom.window.document.getElementById("activity-filter-type").value = "watch";
    dom.window.document.getElementById("activity-filter-keyword").value = "leftover";

    await app.openHomeWatchParty();

    expect(app.showPage).toHaveBeenCalledWith("page-activities");
    expect(context.ScriptLoader.ensureForPage).toHaveBeenCalledWith("page-activities");
    expect(app.resetActivityTab).toHaveBeenCalledWith({ render: false });
    expect(app._activeSport).toBe("restaurant");
    expect(dom.window.localStorage.getItem("sporthub_active_sport")).toBe("restaurant");
    expect(dom.window.document.getElementById("activity-filter-type").value).toBe("");
    expect(dom.window.document.getElementById("activity-filter-keyword").value).toBe("");
    expect(app.renderActivityList).toHaveBeenCalled();
  });
});
