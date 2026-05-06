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

    expect(dom.window.document.getElementById("home-sport-entry").children).toHaveLength(2);
    expect(dom.window.document.getElementById("home-info-meter").children).toHaveLength(3);
    expect(dom.window.document.getElementById("home-info-meter").textContent).toContain("活動數");
    expect(dom.window.document.getElementById("home-info-meter").textContent).toContain("311");
    expect(dom.window.document.getElementById("home-scoreboard-preview").textContent).toContain("英超");
  });
});
