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
const apiServiceSource = fs.readFileSync(
  path.join(__dirname, "../../js/api-service.js"),
  "utf8"
);
const adminContentSource = fs.readFileSync(
  path.join(__dirname, "../../pages/admin-content.html"),
  "utf8"
);
const adManageBannerSource = fs.readFileSync(
  path.join(__dirname, "../../js/modules/ad-manage/ad-manage-banner.js"),
  "utf8"
);
const bannerSource = fs.readFileSync(
  path.join(__dirname, "../../js/modules/banner.js"),
  "utf8"
);
const navigationSource = fs.readFileSync(
  path.join(__dirname, "../../js/core/navigation.js"),
  "utf8"
);

function runHomeDashboardModule(options = {}) {
  const dom = new JSDOM(`<!doctype html>
    <div id="home-sport-entry"></div>
    <div id="home-info-meter"></div>
    <section id="home-scoreboard-preview"></section>
    <button class="home-watch-party-card" type="button"></button>
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
  if (options.apiService) {
    context.ApiService = options.apiService;
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
  test("home banner restores original height and owns activity search/create actions", () => {
    expect(homeCssSource).toMatch(/\.banner-slide\s*\{[\s\S]*aspect-ratio:\s*2\.2\s*\/\s*1/);
    expect(homeCssSource).toContain(".banner-fixed-content");
    expect(homeCssSource).toMatch(/\.banner-dots\s*\{[\s\S]*right:\s*\.72rem[\s\S]*left:\s*auto[\s\S]*transform:\s*none/);
    expect(homeCssSource).toContain(".banner-region-control");
    expect(homeCssSource).toContain(".banner-find-btn");
    expect(homeCssSource).toContain(".home-activity-search-overlay");
    expect(homeCssSource).toMatch(/\.home-hero-actions\s*\{[\s\S]*margin:\s*0 0 \.6rem/);
    expect(homeCssSource).toMatch(/\.home-hero-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)[\s\S]*align-items:\s*stretch/);
    expect(homeCssSource).toMatch(/\.home-next-activity-section\s*\{[\s\S]*margin:\s*\.78rem 0 0/);
    expect(homeCssSource).toMatch(/\.home-dashboard-section\s*\{[\s\S]*margin:\s*\.75rem 0 0[\s\S]*border:\s*1px solid var\(--border\)[\s\S]*border-radius:\s*14px/);
    expect(homeCssSource).toMatch(/\.home-scoreboard-preview\s*\{[\s\S]*margin:\s*\.75rem 0 0/);
    const infoSectionRule = homeCssSource.match(/\.home-info-dashboard-section\s*\{([\s\S]*?)\}/)?.[1] || "";
    expect(infoSectionRule).not.toContain("border-top");
    expect(infoSectionRule).not.toContain("padding-top");
    expect(homeCssSource).toMatch(/\.home-watch-party-card\s*\{[\s\S]*height:\s*40px/);
    expect(homeCssSource).toMatch(/\.home-watch-party-card\s*\{[\s\S]*border:\s*1px solid var\(--border\)[\s\S]*grid-template-columns:\s*auto/);
    expect(homeCssSource).toMatch(/\.home-watch-party-card\.has-bg\s*\{[\s\S]*--home-watch-party-bg:\s*none[\s\S]*background-image:/);
    expect(homeCssSource).toMatch(/\.home-watch-party-card\.has-bg\s*\{[\s\S]*rgba\(255,\s*255,\s*255,\s*\.56\)[\s\S]*rgba\(255,\s*255,\s*255,\s*\.49\)/);
    expect(homeCssSource).toMatch(/\.home-watch-party-card::after\s*\{[\s\S]*transparent 18%[\s\S]*transparent 82%/);
    expect(homeCssSource).toMatch(/\.home-watch-party-card::after\s*\{[\s\S]*animation:\s*homeWatchPartyShine 6s/);
    expect(homeCssSource).toMatch(/@keyframes\s+homeWatchPartyShine/);
    expect(homeCssSource).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.home-watch-party-card::after\s*\{[\s\S]*animation:\s*none/);
    expect(homeCssSource).toMatch(/\.home-watch-party-copy\s*\{[\s\S]*width:\s*max-content[\s\S]*padding:\s*0 \.36rem[\s\S]*text-overflow:\s*ellipsis/);
    expect(homeCssSource).toMatch(/\.home-watch-party-copy\s*\{[\s\S]*background:\s*linear-gradient/);
    expect(homeCssSource).toMatch(/\.home-hero-actions \.home-create-event-btn\s*\{[\s\S]*display:\s*none/);
    expect(homeCssSource).toMatch(/\.banner-create-event-btn\s*\{[\s\S]*box-shadow:/);
    expect(adManageBannerSource).toContain("banner-input-subtitle");
    expect(adManageBannerSource).toContain("titleColor");
    expect(adManageBannerSource).toContain("outputWidth: 1200");
    expect(bannerSource).toContain("_ensureBannerFixedOverlay(banners)");
    expect(bannerSource).toContain("banner-content banner-fixed-content");
    expect(homeHtmlSource).toContain("home-watch-party-card");
    expect(homeHtmlSource).toContain("App.openHomeWatchParty()");
    expect(homeHtmlSource).not.toContain("home-watch-party-action");
    expect(homeHtmlSource).not.toContain("home-watch-party-title");
    expect(homeHtmlSource).toContain("home-watch-party-copy");
    expect(homeHtmlSource).not.toContain("home-watch-party-art");
    expect(homeCssSource).toContain("banner-create-event-btn");
  });

  test("watch party background is a managed special banner slot outside the carousel", () => {
    expect(apiServiceSource).toMatch(/getBanners\(\)\s*\{[\s\S]*type !== 'watchParty'/);
    expect(apiServiceSource).toContain("getWatchPartyBg()");
    expect(adminContentSource).toContain("watch-party-bg-manage-list");
    expect(adminContentSource).toContain("watch-party-bg-preview");
    expect(adManageBannerSource).toContain("renderWatchPartyBgManage()");
    expect(adManageBannerSource).toContain("bindImageUpload('watch-party-bg-image', 'watch-party-bg-preview'");
    expect(adManageBannerSource).toContain("aspectRatio: 5");
  });

  test("bottom home tab resets sport and region filters without touching activity page state", () => {
    expect(navigationSource).toContain("if (page === 'page-home') this.resetHomeEntryFilters?.();");
    const { app, dom } = runHomeDashboardModule();
    app.currentPage = "page-activities";
    app.switchRegionTab = jest.fn();

    app.setActiveSportFilter("football", { render: false });
    app.setHomeBannerRegion("北部", { persist: true, syncActivities: false });
    app.resetHomeEntryFilters();

    expect(app._activeSport).toBe("all");
    expect(dom.window.localStorage.getItem("sporthub_active_sport")).toBe("all");
    expect(app.getHomeBannerRegion()).toBe("全部");
    expect(dom.window.localStorage.getItem("toosterx_home_activity_region")).toBe("全部");
    expect(app.switchRegionTab).not.toHaveBeenCalled();
  });

  test("renders active watch party background onto the home card", () => {
    const { app, dom } = runHomeDashboardModule({
      apiService: {
        getWatchPartyBg: () => ({ status: "active", image: "https://cdn.test/watch-party.webp" }),
      },
    });

    app.renderHomeWatchPartyCard();
    const card = dom.window.document.querySelector(".home-watch-party-card");
    expect(card.classList.contains("has-bg")).toBe(true);
    expect(card.style.getPropertyValue("--home-watch-party-bg")).toContain("watch-party.webp");
  });

  test("scoreboard preview has a divider from the current info section only when populated", () => {
    expect(homeCssSource).toMatch(/\.home-scoreboard-preview:not\(:empty\)\s*\{[\s\S]*border-top:\s*1px solid var\(--border\)/);
  });

  test("sport quick entry uses icon plus two-line text layout", () => {
    expect(homeCssSource).toMatch(/\.home-sport-chip\s*\{[\s\S]*grid-template-columns:\s*30px minmax\(0,\s*1fr\)/);
    expect(homeCssSource).toMatch(/\.home-sport-chip-text\s*\{[\s\S]*grid-template-rows:\s*1fr 1fr/);
  });

  test("attaches to lexical App and renders homepage cards when window.App is empty", async () => {
    const { app, dom, context } = runHomeDashboardModule();

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
    const footballChip = sportEntry.querySelector('[data-home-sport="football"]');
    expect(footballChip?.querySelector(".home-sport-chip-label")?.textContent).toBe(context.EVENT_SPORT_OPTIONS[0].label);
    expect(footballChip?.querySelector(".home-sport-chip-count")?.textContent).toContain("19 活動");
    expect(footballChip?.getAttribute("aria-label")).toContain("足球");
    expect(footballChip?.querySelector(".home-sport-chip-mark")?.innerHTML).toContain("football");
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
