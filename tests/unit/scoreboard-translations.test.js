"use strict";

const translations = require("../../functions/scoreboard-translations");

function makeTranslationDb(seed = {}) {
  const stores = new Map();
  Object.entries(seed).forEach(([collectionName, docs]) => {
    stores.set(collectionName, new Map(Object.entries(docs || {}).map(([id, data]) => [id, { ...data }])));
  });
  const getStore = (collectionName) => {
    if (!stores.has(collectionName)) stores.set(collectionName, new Map());
    return stores.get(collectionName);
  };
  const writeDoc = (collectionName, id, payload, options = {}) => {
    const store = getStore(collectionName);
    const previous = options?.merge ? (store.get(id) || {}) : {};
    store.set(id, { ...previous, ...payload });
  };
  const db = {
    collection(collectionName) {
      return {
        doc(id) {
          return {
            id,
            collectionName,
            async get() {
              const data = getStore(collectionName).get(id);
              return {
                exists: !!data,
                data: () => data,
              };
            },
            async set(payload, options) {
              writeDoc(collectionName, id, payload, options);
            },
          };
        },
        async get() {
          const entries = Array.from(getStore(collectionName).entries());
          return {
            forEach(callback) {
              entries.forEach(([id, data]) => callback({ id, data: () => data }));
            },
          };
        },
      };
    },
    batch() {
      const operations = [];
      return {
        set(ref, payload, options) {
          operations.push({ ref, payload, options });
        },
        async commit() {
          operations.forEach(({ ref, payload, options }) => writeDoc(ref.collectionName, ref.id, payload, options));
        },
      };
    },
    dump(collectionName) {
      return Object.fromEntries(getStore(collectionName).entries());
    },
  };
  return db;
}

const fakeFieldValue = {
  serverTimestamp: () => "SERVER_TIMESTAMP",
  increment: (value) => ({ __increment: value }),
};

describe("scoreboard translation helpers", () => {
  test("normalizes non-English source names for stable matching", () => {
    expect(translations.normalizeSourceName("Bóng đá Huế")).toBe("bong da hue");
    expect(translations.normalizeSourceName("Launceston City (F)")).toBe("launceston city f");
    expect(translations.normalizeSourceName("  Manchester   United  ")).toBe("manchester united");
  });

  test("applies approved translations and preserves source names", () => {
    const lookup = translations.createTranslationLookup([
      {
        provider: "sportsapipro",
        sport: "football",
        type: "team",
        sourceName: "AE Lerou",
        zhTW: "AE Lerou \u4e2d\u6587",
        status: "approved",
      },
      {
        provider: "sportsapipro",
        sport: "football",
        type: "league",
        sourceName: "Premier League",
        zhTW: "\u82f1\u8d85",
        status: "approved",
      },
    ]);
    const match = translations.applyScoreboardTranslationsToMatch({
      id: "m1",
      sport: "football",
      homeTeam: "AE Lerou",
      awayTeam: "Unknown FC",
      league: "Premier League",
      subtitle: "Premier League",
      title: "AE Lerou vs Unknown FC",
      status: "Scheduled",
    }, lookup);

    expect(match.homeTeam).toBe("AE Lerou \u4e2d\u6587");
    expect(match.homeTeamOriginal).toBe("AE Lerou");
    expect(match.league).toBe("\u82f1\u8d85");
    expect(match.leagueOriginal).toBe("Premier League");
    expect(match.awayTeam).toBe("Unknown FC");
    expect(match.title).toBe("AE Lerou \u4e2d\u6587 vs Unknown FC");
  });

  test("does not translate ambiguous Premier League without explicit country context", () => {
    const lookup = translations.createTranslationLookup([]);
    const ambiguous = translations.translateSourceName("Premier League", {
      lookup,
      sport: "football",
      type: "league",
    });
    const explicitEnglish = translations.translateSourceName("English Premier League", {
      lookup,
      sport: "football",
      type: "league",
    });

    expect(ambiguous.value).toBe("Premier League");
    expect(ambiguous.translated).toBe(false);
    expect(explicitEnglish.value).toBe("\u82f1\u8d85");
    expect(explicitEnglish.translated).toBe(true);
  });

  test("keep_original does not translate and does not create pending coverage", () => {
    const lookup = translations.createTranslationLookup([
      {
        provider: "sportsapipro",
        sport: "football",
        type: "team",
        sourceName: "Bóng đá Huế",
        status: "keep_original",
      },
    ]);
    const result = translations.translateSourceName("Bóng đá Huế", {
      lookup,
      sport: "football",
      type: "team",
    });
    expect(result.value).toBe("Bóng đá Huế");
    expect(result.status).toBe("keep_original");
    expect(result.translated).toBe(false);
  });

  test("collects candidates and aggregates by sport/type/status", () => {
    const terms = translations.collectTranslationTermsFromMatches([
      {
        id: "m1",
        sport: "football",
        homeTeam: "AE Lerou",
        awayTeam: "AS Asteras Pastidas",
        league: "A EPS Dodekanisou",
        title: "AE Lerou vs AS Asteras Pastidas",
        status: "Scheduled",
      },
    ]);
    expect(terms.map((item) => item.type)).toEqual(["team", "team", "league", "status"]);

    const lookup = translations.createTranslationLookup([
      {
        provider: "sportsapipro",
        sport: "football",
        type: "team",
        sourceName: "AE Lerou",
        zhTW: "AE Lerou \u4e2d\u6587",
        status: "approved",
      },
    ]);
    const stats = translations.aggregateTranslationStats({
      candidates: [
        { sport: "football", type: "team", sourceName: "AE Lerou", occurrenceCount: 3 },
        { sport: "football", type: "team", sourceName: "AS Asteras Pastidas", occurrenceCount: 2 },
        { sport: "basketball", type: "league", sourceName: "NBA", occurrenceCount: 9 },
      ],
      translations: [{ sourceName: "AE Lerou" }],
      lookup,
    });

    expect(stats.totals.approved).toBe(2);
    expect(stats.totals.pending).toBe(1);
    expect(stats.bySport.football.pending).toBe(1);
    expect(stats.topPending[0].sourceName).toBe("AS Asteras Pastidas");
  });

  test("aggregates needs-review, conflict, ignored, and sport-level coverage", () => {
    const lookup = translations.createTranslationLookup([
      {
        provider: "sportsapipro",
        sport: "football",
        type: "team",
        sourceName: "Known FC",
        zhTW: "Known FC zh",
        status: "approved",
      },
      {
        provider: "sportsapipro",
        sport: "basketball",
        type: "team",
        sourceName: "Local Youth",
        status: "keep_original",
      },
    ]);
    const stats = translations.aggregateTranslationStats({
      candidates: [
        { sport: "football", type: "team", sourceName: "Known FC", status: "pending", occurrenceCount: 5 },
        { sport: "football", type: "team", sourceName: "Needs Human", status: "needs_review", occurrenceCount: 4 },
        { sport: "football", type: "league", sourceName: "Conflicting League", status: "conflict", occurrenceCount: 3 },
        { sport: "basketball", type: "team", sourceName: "Local Youth", status: "pending", occurrenceCount: 2 },
        { sport: "baseball", type: "team", sourceName: "Ignored Club", status: "ignored", occurrenceCount: 1 },
      ],
      translations: [{ sourceName: "Known FC" }, { sourceName: "Local Youth" }],
      lookup,
    });

    expect(stats.totals).toMatchObject({
      total: 5,
      approved: 1,
      keep_original: 1,
      ignored: 1,
      needs_review: 1,
      conflict: 1,
      pending: 0,
    });
    expect(stats.bySport.football).toMatchObject({ total: 3, approved: 1, needs_review: 1, conflict: 1 });
    expect(stats.bySport.basketball.keep_original).toBe(1);
    expect(stats.byType.team.coverageRate).toBe(75);
  });

  test("sorts top pending terms by frequency with stable tie-breaking", () => {
    const stats = translations.aggregateTranslationStats({
      candidates: [
        { sport: "football", type: "team", sourceName: "Zulu FC", occurrenceCount: 10 },
        { sport: "football", type: "team", sourceName: "Alpha FC", occurrenceCount: 10 },
        { sport: "football", type: "team", sourceName: "Beta FC", occurrenceCount: 4 },
      ],
      lookup: translations.createTranslationLookup([]),
    });

    expect(stats.topPending.map((item) => item.sourceName)).toEqual(["Alpha FC", "Zulu FC", "Beta FC"]);
  });

  test("records only terms that still need translation and merges repeated candidates", async () => {
    const db = makeTranslationDb();
    const lookup = translations.createTranslationLookup([
      {
        provider: "sportsapipro",
        sport: "football",
        type: "team",
        sourceName: "Small Local FC",
        status: "keep_original",
      },
    ]);

    const result = await translations.recordTranslationCandidates({
      db,
      FieldValue: fakeFieldValue,
      lookup,
      terms: [
        { sport: "football", type: "team", sourceName: "Small Local FC", normalizedSourceName: "small local fc" },
        { sport: "football", type: "team", sourceName: "New Club", normalizedSourceName: "new club", lastMatchId: "m1" },
        { sport: "football", type: "team", sourceName: "New Club", normalizedSourceName: "new club", lastMatchId: "m2" },
      ],
    });

    const docs = Object.values(db.dump(translations.CANDIDATE_COLLECTION));
    expect(result).toEqual({ ok: true, written: 1 });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      sourceName: "New Club",
      status: "pending",
      occurrenceCount: { __increment: 2 },
    });
  });

  test("upserts approved and review translations without overwriting approved rows by default", async () => {
    const existingId = translations.translationDocId({ sport: "football", type: "team", sourceName: "Manchester United" });
    const db = makeTranslationDb({
      [translations.TRANSLATION_COLLECTION]: {
        [existingId]: {
          provider: "sportsapipro",
          sport: "football",
          type: "team",
          sourceName: "Manchester United",
          normalizedSourceName: "manchester united",
          zhTW: "Existing zh",
          status: "approved",
        },
      },
      [translations.CANDIDATE_COLLECTION]: {
        pending_1: { sport: "football", type: "team", sourceName: "Unknown FC", status: "pending", occurrenceCount: 8 },
      },
    });

    const result = await translations.upsertScoreboardTranslations({
      db,
      FieldValue: fakeFieldValue,
      reviewerUid: "admin-uid",
      items: [
        { sport: "football", type: "team", sourceName: "Manchester United", zhTW: "Overwritten zh", status: "approved" },
        { sport: "football", type: "team", sourceName: "Unknown FC", status: "keep_original" },
        { sport: "basketball", type: "league", sourceName: "Minor League", status: "needs_review" },
        { sport: "baseball", type: "team", sourceName: "Invalid Approved", status: "approved" },
      ],
    });

    const translationDocs = db.dump(translations.TRANSLATION_COLLECTION);
    const statsDoc = db.dump(translations.STATS_COLLECTION)[translations.STATS_DOC];
    expect(result).toMatchObject({ ok: true, written: 2, skipped: 1 });
    expect(translationDocs[existingId].zhTW).toBe("Existing zh");
    expect(Object.values(translationDocs).some((doc) => doc.sourceName === "Unknown FC" && doc.status === "keep_original")).toBe(true);
    expect(Object.values(translationDocs).some((doc) => doc.sourceName === "Minor League" && doc.status === "needs_review")).toBe(true);
    expect(statsDoc).toMatchObject({
      provider: "sportsapipro",
      aiPrompt: translations.AI_PROMPT,
      aiDirectPrompt: translations.AI_DIRECT_PROMPT,
    });
  });

  test("AI maintenance prompts preserve the manual review workflow", () => {
    expect(translations.AI_PROMPT).toContain("docs/scoreboard-translation-workflow-plan.md");
    expect(translations.AI_PROMPT).toContain("Report suggested writes before applying them");
    expect(translations.AI_DIRECT_PROMPT).toContain("Do not overwrite approved translations");
    expect(translations.AI_DIRECT_PROMPT).toContain("After writing, refresh scoreboardTranslationStats");
  });
});
