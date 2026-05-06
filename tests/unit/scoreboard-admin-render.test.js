"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const adminSource = fs.readFileSync(
  path.join(__dirname, "../../js/modules/scoreboard/scoreboard-admin.js"),
  "utf8"
);

function fakeDoc(data) {
  return {
    exists: !!data,
    data: () => data,
  };
}

function runAdmin(stats = {}) {
  const dom = new JSDOM(`<!doctype html><section id="page-admin-scoreboard"></section>`, {
    url: "https://example.test/",
  });
  const catalog = {
    SPORT_CATALOG: [{ key: "football", label: "Football", apiSport: "football", sortOrder: 1 }],
    FEATURED_SOURCE_CATALOG: [],
  };
  const config = {
    schemaVersion: 2,
    homepageEnabled: true,
    publicPageEnabled: true,
    enabledSports: ["football"],
    homepageSports: ["football"],
    liveSports: ["football"],
    scheduleSports: ["football"],
    detailSports: ["football"],
    sportsOrder: ["football"],
    featuredSources: {},
    enabledFeaturedSources: [],
    featuredSourceOrder: [],
    homepageOrder: [],
    sports: {
      football: { enabled: true, sortOrder: 1 },
    },
  };
  const docs = new Map([
    ["scoreboardSnapshots/home", { provider: "sportsapipro", homepageMatches: [] }],
    ["scoreboardTranslationStats/summary", stats],
  ]);
  const db = {
    collection: jest.fn(collection => ({
      doc: jest.fn(id => ({
        get: jest.fn(async () => fakeDoc(docs.get(`${collection}/${id}`))),
      })),
    })),
  };
  const app = {
    _getEffectiveRoleKey: jest.fn(() => "super_admin"),
    hasPermission: jest.fn(() => true),
    loadScoreboardConfig: jest.fn(async () => config),
    _markPageSnapshotReady: jest.fn(),
    goBack: jest.fn(),
    showToast: jest.fn(),
  };
  dom.window.App = app;
  dom.window.ScoreboardConfigUtils = catalog;
  dom.window.escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
  const context = vm.createContext({
    window: dom.window,
    globalThis: dom.window,
    document: dom.window.document,
    console,
    App: app,
    ScoreboardConfigUtils: catalog,
    ApiService: { getCurrentUser: jest.fn(() => ({ role: "super_admin" })) },
    FirebaseService: { _cache: {} },
    db,
  });
  vm.runInContext(adminSource, context);
  return { app, dom, db };
}

describe("scoreboard admin render", () => {
  test("renders translation stats, pending terms and AI prompt", async () => {
    const { app, dom } = runAdmin({
      totals: {
        approved: 5,
        pending: 2,
        keep_original: 1,
        needs_review: 1,
        conflict: 0,
      },
      coverageRate: 62.5,
      bySport: {
        football: { approved: 3, pending: 2, keep_original: 1, coverageRate: 60 },
      },
      topPending: [
        { sourceName: "Team A", sport: "football", type: "team", occurrenceCount: 12 },
      ],
      aiPrompt: "Review docs/scoreboard-translation-workflow-plan.md\nTranslate Team A",
    });

    await app.renderScoreboardAdmin();

    const page = dom.window.document.getElementById("page-admin-scoreboard");
    expect(page.querySelector(".scoreboard-translation-panel")).toBeTruthy();
    expect(page.textContent).toContain("Team A");
    expect(page.textContent).toContain("12");
    expect(page.textContent).toContain("62.5%");
    expect(page.textContent).toContain("docs/scoreboard-translation-workflow-plan.md");
    expect(app._markPageSnapshotReady).toHaveBeenCalledWith("page-admin-scoreboard");
  });
});
