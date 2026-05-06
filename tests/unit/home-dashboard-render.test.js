const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const source = fs.readFileSync(
  path.join(__dirname, "../../js/modules/home-dashboard.js"),
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
      homepageOrder: ["premier_league"],
      sources: { premier_league: { label: "英超", enabled: true } },
      homepageMatches: [{ timeLabel: "今晚", dateLabel: "22:00", title: "A vs B", subtitle: "英超", status: "未開賽" }],
    };
    await app.renderHomeScoreboardPreview();
    expect(scoreboard.style.display).toBe("");
    expect(scoreboard.textContent).toContain("英超");
    expect(scoreboard.textContent).toContain("A vs B");
  });
});
