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
const indexSource = fs.readFileSync(
  path.join(__dirname, "../../index.html"),
  "utf8"
);
const apiServiceSource = fs.readFileSync(
  path.join(__dirname, "../../js/api-service.js"),
  "utf8"
);
const eventListHomeSource = fs.readFileSync(
  path.join(__dirname, "../../js/modules/event/event-list-home.js"),
  "utf8"
);
const homeGameRankPreviewSource = fs.readFileSync(
  path.join(__dirname, "../../js/modules/home-game-rank-preview.js"),
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
    <span class="home-stat-views home-sport-views" id="home-sport-views"></span>
    <div id="home-sport-entry"></div>
    <section class="home-dashboard-section home-info-dashboard-section">
      <div id="home-info-meter"></div>
    </section>
    <button class="home-watch-party-card" type="button">
      <span class="home-watch-party-copy">一起找人看比賽</span>
    </button>
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
    trackAdClick: jest.fn(),
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
    const infoSectionRule = homeCssSource.match(/\.home-info-dashboard-section\s*\{([\s\S]*?)\}/)?.[1] || "";
    expect(infoSectionRule).not.toContain("border-top");
    expect(infoSectionRule).not.toContain("padding-top");
    expect(infoSectionRule).toContain("display: flex");
    expect(infoSectionRule).toContain("align-items: center");
    expect(homeCssSource).toMatch(/\.home-info-meter\s*\{[\s\S]*align-items:\s*center/);
    expect(homeCssSource).toMatch(/\.home-info-meter\s*\{[\s\S]*flex-wrap:\s*nowrap/);
    expect(homeCssSource).toMatch(/\.home-info-meter\s*\{[\s\S]*padding-right:\s*0/);
    expect(homeCssSource).toMatch(/\.home-info-meter\s*\{[\s\S]*white-space:\s*nowrap/);
    expect(homeCssSource).toMatch(/\.home-info-meter\s*\{[\s\S]*overflow:\s*hidden/);
    expect(homeCssSource).toMatch(/\.home-stat-label\s*\{[\s\S]*text-overflow:\s*ellipsis/);
    expect(homeCssSource).toContain(".home-sport-views");
    expect(homeCssSource).toContain(".home-dashboard-section.is-hidden");
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
    expect(homeCssSource).toContain(".home-watch-party-card.is-hidden");
    expect(homeCssSource).toContain(".home-hero-actions.is-empty");
    expect(homeCssSource).toMatch(/\.home-hero-actions \.home-create-event-btn\s*\{[\s\S]*display:\s*none/);
    expect(homeCssSource).toMatch(/\.banner-create-event-btn\s*\{[\s\S]*box-shadow:/);
    expect(adManageBannerSource).toContain("banner-input-subtitle");
    expect(adManageBannerSource).toContain("titleColor");
    expect(adManageBannerSource).toContain("outputWidth: 1200");
    expect(bannerSource).toContain("_ensureBannerFixedOverlay(banners)");
    expect(bannerSource).toContain("banner-content banner-fixed-content");
    expect(homeHtmlSource).toContain("home-watch-party-card");
    expect(homeHtmlSource).toContain("home-watch-party-card is-hidden");
    expect(homeHtmlSource).toContain("App.openHomeWatchParty()");
    expect(homeHtmlSource).not.toContain("home-watch-party-action");
    expect(homeHtmlSource).not.toContain("home-watch-party-title");
    expect(homeHtmlSource).toContain("home-watch-party-copy");
    expect(homeHtmlSource).toContain("home-sport-views");
    expect(homeHtmlSource).toContain("home-game-divider");
    expect(homeHtmlSource).toContain("home-game-heading");
    expect(homeHtmlSource).toContain("home-game-rank-shot");
    expect(homeHtmlSource).toContain("home-game-rank-kick");
    expect(homeHtmlSource).not.toContain("home-watch-party-art");
    expect(homeCssSource).toContain(".home-game-rank-pill");
    expect(homeCssSource).toContain(".home-game-rank-month");
    expect(eventListHomeSource).toContain("_scheduleHomeGameRankPreview");
    expect(homeGameRankPreviewSource).toContain("_scheduleHomeGameRankPreview");
    expect(homeGameRankPreviewSource).toContain("getShotGameLeaderboard");
    expect(homeGameRankPreviewSource).toContain("getKickGameLeaderboard");
    expect(homeGameRankPreviewSource).toContain("monthly_");
    expect(indexSource).toContain("js/modules/home-game-rank-preview.js");
    expect(apiServiceSource).toContain("getKickGameLeaderboard");
    expect(apiServiceSource).toContain("kickGameRankings");
    expect(homeCssSource).toContain("banner-create-event-btn");
  });

  test("watch party background is a managed special banner slot outside the carousel", () => {
    expect(apiServiceSource).toMatch(/getBanners\(\)\s*\{[\s\S]*type !== 'watchParty'/);
    expect(apiServiceSource).toMatch(/getBanners\(\)\s*\{[\s\S]*type !== 'homeInfo'/);
    expect(apiServiceSource).toMatch(/getBanners\(\)\s*\{[\s\S]*type !== 'homeLayout'/);
    expect(apiServiceSource).toMatch(/getBanners\(\)\s*\{[\s\S]*slot !== 'home-info'/);
    expect(apiServiceSource).toContain("getWatchPartyBg()");
    expect(adminContentSource).toContain("watch-party-bg-manage-list");
    expect(adminContentSource).toContain("watch-party-bg-preview");
    expect(adminContentSource).toContain("watch-party-bg-title");
    expect(adminContentSource).toContain("watch-party-bg-link-type");
    expect(adminContentSource).toContain("watch-party-bg-link-url");
    expect(adManageBannerSource).toContain("renderWatchPartyBgManage()");
    expect(adManageBannerSource).toContain("_normalizeWatchPartyLinkType");
    expect(adManageBannerSource).toContain("linkType");
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
        getWatchPartyBg: () => ({ status: "active", title: "看球聚會", image: "https://cdn.test/watch-party.webp" }),
      },
    });

    app.renderHomeWatchPartyCard();
    const card = dom.window.document.querySelector(".home-watch-party-card");
    expect(card.classList.contains("is-hidden")).toBe(false);
    expect(card.classList.contains("has-bg")).toBe(true);
    expect(card.textContent).toContain("看球聚會");
    expect(card.getAttribute("aria-label")).toBe("看球聚會");
    expect(card.style.getPropertyValue("--home-watch-party-bg")).toContain("watch-party.webp");
  });

  test("hides watch party shortcut when the managed slot is not active", () => {
    const { app, dom } = runHomeDashboardModule({
      apiService: {
        getWatchPartyBg: () => ({ status: "expired", title: "下架聚會", image: "https://cdn.test/watch-party.webp" }),
      },
    });

    app.renderHomeWatchPartyCard();
    const card = dom.window.document.querySelector(".home-watch-party-card");
    expect(card.classList.contains("is-hidden")).toBe(true);
    expect(card.classList.contains("has-bg")).toBe(false);
  });

  test("sport quick entry uses icon plus two-line text layout", () => {
    expect(homeCssSource).toMatch(/\.home-sport-chip\s*\{[\s\S]*grid-template-columns:\s*30px minmax\(0,\s*1fr\)/);
    expect(homeCssSource).toMatch(/\.home-sport-chip-text\s*\{[\s\S]*grid-template-rows:\s*1fr 1fr/);
  });

  test("attaches to lexical App and renders homepage cards when window.App is empty", async () => {
    const { app, dom, context } = runHomeDashboardModule({
      apiService: {
        getWatchPartyBg: () => ({ id: "watch-party-bg", status: "active", linkType: "activities" }),
        getHomeInfoSettings: () => ({ id: "home-info", status: "active" }),
        updateWatchPartyBg: jest.fn(),
      },
    });

    expect(dom.window.App).toBe(app);
    expect(typeof app.renderHomeDashboard).toBe("function");

    app.renderHomeDashboard();

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
    expect(dom.window.document.querySelectorAll("#home-info-meter .home-stat-card")).toHaveLength(3);
    expect(dom.window.document.getElementById("home-info-meter").textContent).toContain("即時資訊");
    expect(dom.window.document.getElementById("home-info-meter").textContent).toContain("已開放活動");
    expect(dom.window.document.getElementById("home-info-meter").textContent).toContain("俱樂部數");
    expect(dom.window.document.getElementById("home-info-meter").textContent).not.toContain("已成立俱樂部");
    expect(dom.window.document.getElementById("home-info-meter").textContent).toContain("正舉辦賽事");
    expect(dom.window.document.getElementById("home-info-meter").textContent).not.toContain("活動數");
    expect(dom.window.document.getElementById("home-info-meter").textContent).not.toContain("預留");
    expect(dom.window.document.getElementById("home-info-meter").textContent).not.toContain("811");
    expect(dom.window.document.getElementById("home-sport-views").textContent).toContain("811");
    expect(dom.window.document.querySelectorAll(".home-stat-views")).toHaveLength(1);
    expect(dom.window.document.querySelectorAll(".home-sport-views")).toHaveLength(1);
    expect(dom.window.document.querySelectorAll(".home-info-views")).toHaveLength(0);
    expect(dom.window.document.querySelector('[data-stat="activities"] .home-stat-views')).toBeNull();
  });

  test("orders sport quick entry by active count and uses configured order for ties", () => {
    const { app, dom } = runHomeDashboardModule({
      sports: [
        { key: "football", label: "足球" },
        { key: "restaurant", label: "餐廳(觀賽)" },
        { key: "escape_room", label: "密室逃脫" },
        { key: "baseball_softball", label: "棒壘球" },
      ],
    });
    app._homeSummary = {
      counts: { activities: 7, teams: 0, tournaments: 0 },
      activityViews: { total: 0, label: "已記錄瀏覽" },
      sportCounts: [
        { sportTag: "football", count: 0 },
        { sportTag: "baseball_softball", count: 2 },
        { sportTag: "escape_room", count: 2 },
        { sportTag: "restaurant", count: 3 },
      ],
    };

    app.renderHomeDashboard();

    const chips = Array.from(dom.window.document.querySelectorAll("#home-sport-entry [data-home-sport]"))
      .map(el => el.getAttribute("data-home-sport"));
    expect(chips).toEqual(["restaurant", "escape_room", "baseball_softball"]);
    expect(dom.window.document.querySelector('[data-home-sport="football"]')).toBeNull();
    expect(dom.window.document.querySelector(".home-sport-chip-more")?.textContent).toContain("查看更多");
  });

  test("keeps home info hidden until the managed visibility setting is loaded", () => {
    const { app, dom } = runHomeDashboardModule();

    app.renderHomeDashboard();

    const section = dom.window.document.querySelector(".home-info-dashboard-section");
    expect(section.classList.contains("is-hidden")).toBe(true);
    expect(dom.window.document.getElementById("home-info-meter").innerHTML).toBe("");
  });

  test("applies editable home info labels, colors, font size, and visibility", () => {
    const { app, dom } = runHomeDashboardModule({
      apiService: {
        getHomeInfoSettings: () => ({
          status: "active",
          labels: {
            activities: "Open events",
            teams: "Clubs",
            tournaments: "Tournaments",
          },
          fontSize: 16,
          labelColor: "#123456",
          numberColor: "#abcdef",
        }),
      },
    });

    app.renderHomeDashboard();

    const section = dom.window.document.querySelector(".home-info-dashboard-section");
    const meter = dom.window.document.getElementById("home-info-meter");
    expect(meter.textContent).toContain("Open events");
    expect(meter.textContent).toContain("Clubs");
    expect(meter.textContent).toContain("Tournaments");
    expect(section.classList.contains("is-hidden")).toBe(false);
    expect(section.classList.contains("has-custom-info-font")).toBe(true);
    expect(section.classList.contains("has-custom-info-label-color")).toBe(true);
    expect(section.classList.contains("has-custom-info-number-color")).toBe(true);
    expect(section.style.getPropertyValue("--home-info-font-size")).toBe("16px");
    expect(section.style.getPropertyValue("--home-info-label-color")).toBe("#123456");
    expect(section.style.getPropertyValue("--home-info-number-color")).toBe("#abcdef");
  });

  test("hides the editable home info container when the ad slot is down", () => {
    const { app, dom } = runHomeDashboardModule({
      apiService: {
        getHomeInfoSettings: () => ({ status: "expired" }),
      },
    });

    app.renderHomeDashboard();

    const section = dom.window.document.querySelector(".home-info-dashboard-section");
    expect(section.classList.contains("is-hidden")).toBe(true);
    expect(dom.window.document.getElementById("home-info-meter").innerHTML).toBe("");
    expect(dom.window.document.getElementById("home-sport-views").textContent).toContain("811");
  });

  test("applies managed homepage layout order to section containers", () => {
    const dom = new JSDOM(`<!doctype html>
      <section id="page-home">
        <div class="banner-carousel" id="banner-section"></div>
        <div class="home-hero-actions" id="hero-actions"></div>
        <div id="announce-marquee-wrap"></div>
        <div id="announce-detail-modal"></div>
        <section id="home-next-activity"></section>
        <section class="home-dashboard-section" id="sport-section"><div id="home-sport-entry"></div></section>
        <section class="home-dashboard-section home-info-dashboard-section" id="info-section"><div id="home-info-meter"></div></section>
        <hr id="home-game-divider">
        <div id="home-game-heading"></div>
        <button id="home-game-card-shot"></button>
        <button id="home-game-card-kick"></button>
        <hr id="sponsor-divider">
        <div id="sponsor-grid"></div>
        <hr id="news-divider">
        <div id="news-section-title"></div>
        <div id="news-tabs"></div>
        <div id="news-card-list"></div>
        <div id="floating-ads"></div>
      </section>
    `, { url: "https://example.test/" });
    const context = vm.createContext({
      window: dom.window,
      globalThis: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      console,
      App: {},
      ApiService: {
        getHomeLayoutSettings: () => ({ order: ["infoMeter", "banner", "sponsors"] }),
      },
    });

    vm.runInContext(source, context);
    context.window.HomeDashboardUtils.applyHomeLayoutOrder();

    const order = Array.from(dom.window.document.getElementById("page-home").children)
      .map(el => el.id || el.className);
    expect(order.slice(0, 4)).toEqual(["info-section", "banner-section", "sponsor-divider", "sponsor-grid"]);
    expect(order).toContain("floating-ads");
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
    expect(dom.window.document.getElementById("home-info-meter").textContent).not.toContain("530");
    expect(dom.window.document.getElementById("home-sport-views").textContent).toContain("530");
  });

  test("watch party shortcut opens activities with the restaurant sport filter", async () => {
    const { app, dom, context } = runHomeDashboardModule({
      apiService: {
        getWatchPartyBg: () => ({ id: "watch-party-bg", status: "active", linkType: "activities" }),
        updateWatchPartyBg: jest.fn(),
      },
    });
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
    expect(app.trackAdClick).toHaveBeenCalledWith("watchparty", "watch-party-bg");
  });

  test("watch party shortcut can route to configured pages", async () => {
    const { app, context } = runHomeDashboardModule({
      apiService: {
        getWatchPartyBg: () => ({ id: "watch-party-bg", status: "active", linkType: "tournaments" }),
      },
    });

    await app.openHomeWatchParty();

    expect(app.showPage).toHaveBeenCalledWith("page-tournaments");
    expect(context.ScriptLoader.ensureForPage).toHaveBeenCalledWith("page-tournaments");
  });
});
