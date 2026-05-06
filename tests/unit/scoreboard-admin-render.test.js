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
  dom.window.document.execCommand = jest.fn(() => true);
  const catalog = {
    SPORT_CATALOG: [{ key: "football", label: "Football", icon: "⚽", apiSport: "football", sortOrder: 1 }],
    FEATURED_SOURCE_CATALOG: [{ id: "nba", label: "NBA", sport: "basketball", sortOrder: 1 }],
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
    featuredSources: {
      nba: { enabled: true, sortOrder: 1, sport: "basketball", label: "NBA" },
    },
    enabledFeaturedSources: ["nba"],
    featuredSourceOrder: ["nba"],
    homepageOrder: ["nba"],
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
    closeModal: jest.fn(),
    renderHomeScoreboardPreview: jest.fn(),
    saveScoreboardConfig: jest.fn(async payload => ({
      ...config,
      ...payload,
      sports: {
        football: {
          enabled: payload.enabledSports.includes("football"),
          homepageEnabled: payload.homepageSports.includes("football"),
          liveEnabled: payload.liveSports.includes("football"),
          scheduleEnabled: payload.scheduleSports.includes("football"),
          detailEnabled: payload.detailSports.includes("football"),
          sortOrder: 7,
        },
      },
      featuredSources: config.featuredSources,
    })),
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
    expect(page.querySelector(".scoreboard-copy-btn").textContent).toBe("一鍵複製");
    expect(page.querySelectorAll(".scoreboard-meter-card .scoreboard-info-btn")).toHaveLength(0);
    expect(page.querySelectorAll(".scoreboard-translation-panel .scoreboard-subtitle .scoreboard-info-btn")).toHaveLength(0);
    expect(page.querySelector(".scoreboard-translation-panel h3 .scoreboard-info-btn")).toBeTruthy();

    await app.copyScoreboardAiPrompt(page.querySelector(".scoreboard-copy-btn"));
    expect(dom.window.document.execCommand).toHaveBeenCalledWith("copy");
    expect(app.showToast).toHaveBeenCalledWith("已複製 AI 翻譯指引");

    app.showScoreboardInfo("translationTotal");
    const infoBody = dom.window.document.querySelector(".scoreboard-info-dialog-body");
    expect(infoBody.textContent).toContain("待翻譯");
    expect(infoBody.textContent).toContain("AI 翻譯指引");
    expect(app._markPageSnapshotReady).toHaveBeenCalledWith("page-admin-scoreboard");
  });

  test("renders compact sport cards, edits sport modal settings and keeps save payload lists", async () => {
    const { app, dom } = runAdmin();

    await app.renderScoreboardAdmin();

    const page = dom.window.document.getElementById("page-admin-scoreboard");
    expect(page.querySelector(".scoreboard-sport-card")).toBeTruthy();
    expect(page.querySelector(".scoreboard-feature-row")).toBeTruthy();
    expect(page.querySelectorAll(".scoreboard-admin-switches .scoreboard-info-btn")).toHaveLength(0);
    expect(page.querySelectorAll(".scoreboard-admin-switches .scoreboard-switch")).toHaveLength(2);
    expect(page.querySelector("#scoreboard-homepage-enabled").checked).toBe(true);
    expect(page.querySelector("#scoreboard-public-enabled").checked).toBe(true);
    expect(page.querySelectorAll(".scoreboard-meter-card .scoreboard-info-btn")).toHaveLength(0);
    expect(page.querySelector("#scoreboard-refresh-btn").classList.contains("scoreboard-refresh-action")).toBe(true);
    expect(page.querySelector("#scoreboard-refresh-btn").textContent).toBe("手動刷新");

    app.showScoreboardInfo("usage");
    const infoBody = dom.window.document.querySelector(".scoreboard-info-dialog-body");
    expect(infoBody.textContent).toContain("今日 requests");
    expect(infoBody.textContent).toContain("額度歸零");
    expect(infoBody.textContent).toContain("08:00");
    expect(infoBody.textContent).toContain("手動刷新");

    app.openScoreboardSportSettings("football");
    const overlay = dom.window.document.querySelector(".scoreboard-config-overlay");
    expect(overlay).toBeTruthy();

    overlay.querySelector(".scoreboard-modal-homepage").checked = false;
    overlay.querySelector(".scoreboard-modal-schedule").checked = false;
    overlay.querySelector(".scoreboard-modal-order").value = "7";
    app.applyScoreboardSportSettings("football");

    const row = page.querySelector('.scoreboard-sport-row[data-sport="football"]');
    expect(row.querySelector(".scoreboard-sport-homepage").checked).toBe(false);
    expect(row.querySelector(".scoreboard-sport-schedule").checked).toBe(false);
    expect(row.querySelector(".scoreboard-sport-order").value).toBe("7");
    expect(row.querySelector("[data-sport-summary]").textContent).toContain("#7");

    await app.saveScoreboardAdminConfig();
    expect(app.saveScoreboardConfig).toHaveBeenCalledWith(expect.objectContaining({
      enabledSports: ["football"],
      homepageSports: [],
      liveSports: ["football"],
      scheduleSports: [],
      detailSports: ["football"],
      sportsOrder: ["football"],
      enabledFeaturedSources: ["nba"],
      featuredSourceOrder: ["nba"],
    }));
  });
});
