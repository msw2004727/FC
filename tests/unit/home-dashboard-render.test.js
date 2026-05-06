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

function runHomeDashboardModule() {
  const dom = new JSDOM(`<!doctype html>
    <div id="home-sport-entry"></div>
    <div id="home-info-meter"></div>
    <section id="home-scoreboard-preview"></section>
  `, { url: "https://example.test/" });
  const app = {
    _markPageSnapshotReady: jest.fn(),
    showPage: jest.fn(),
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
  });
  vm.runInContext(source, context);
  app._homeSummary = {
    counts: { activities: 20, teams: 6, tournaments: 0 },
    activityViews: { total: 311, label: "已記錄瀏覽" },
    sportCounts: [
      { sportTag: "football", count: 19 },
      { sportTag: "dodgeball", count: 1 },
    ],
  };
  return { app, dom };
}

describe("home-dashboard browser binding", () => {
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
});
