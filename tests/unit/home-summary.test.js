const {
  decodeUtf8Chunks,
  buildHomeSummary,
  isPublicActiveEvent,
  isTournamentEnded,
  parseDateMs,
} = require("../../scripts/inject-hot-events.js");

describe("home summary boot payload", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(new Date(2026, 4, 6, 12, 0).getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("start time passed is treated as ended for homepage active counts", () => {
    expect(isPublicActiveEvent({
      id: "past",
      status: "open",
      date: "2026/05/06 11:59",
    }, Date.now())).toBe(false);

    expect(isPublicActiveEvent({
      id: "future",
      status: "open",
      date: "2026/05/06 12:01",
    }, Date.now())).toBe(true);
  });

  test("excludes private and team-only events from counts and recorded views", () => {
    const summary = buildHomeSummary({
      events: [
        { id: "a", status: "open", date: "2026/05/06 12:01", sportTag: "football", viewCount: 10 },
        { id: "b", status: "open", date: "2026/05/06 12:02", sportTag: "basketball", viewCount: 20, privateEvent: true },
        { id: "c", status: "open", date: "2026/05/06 12:03", sportTag: "dodgeball", viewCount: 30, teamOnly: true },
      ],
      teams: [],
      tournaments: [],
    });

    expect(summary.counts.activities).toBe(1);
    expect(summary.activityViews.total).toBe(10);
    expect(summary.activityViews.label).toBe("已記錄瀏覽");
    expect(summary.sportCounts).toEqual([{ sportTag: "football", count: 1 }]);
  });

  test("tournament matchDates use latest date plus one day as ended threshold", () => {
    expect(isTournamentEnded({ id: "old", matchDates: ["2026-05-04"] }, Date.now())).toBe(true);
    expect(isTournamentEnded({ id: "same", matchDates: ["2026-05-06"] }, Date.now())).toBe(false);
  });

  test("parses slash date with time", () => {
    expect(parseDateMs("2026/05/06 12:30")).toBe(new Date(2026, 4, 6, 12, 30).getTime());
  });

  test("decodes multibyte JSON only after all HTTP chunks are joined", () => {
    const json = '{"name":"台中星期三足球俱樂部"}';
    const bytes = Buffer.from(json, "utf8");
    const finalCharacter = Buffer.from("部", "utf8");
    const splitAt = bytes.indexOf(finalCharacter);
    const chunks = [
      bytes.subarray(0, splitAt + 1),
      bytes.subarray(splitAt + 1, splitAt + 2),
      bytes.subarray(splitAt + 2),
    ];

    const decoded = decodeUtf8Chunks(chunks);

    expect(decoded).toBe(json);
    expect(JSON.parse(decoded)).toEqual({ name: "台中星期三足球俱樂部" });
    expect(decoded).not.toContain("\uFFFD");
  });
});
