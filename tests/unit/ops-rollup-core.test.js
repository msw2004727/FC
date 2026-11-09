"use strict";

const { eventStartMillis, NOSHOW_V2_SINCE } = require("../../functions/noshow-v2-core");
const { computeUserAttendanceStats } = require("../../functions/user-attendance-stats-core");
const {
  applyPreservedUserSnapshot,
  activeSnapshotSubtractingQa,
  buildCost,
  buildDayDocs,
  buildOpsSummaries,
  buildStuckAttention,
  contiguousDateSegments,
  countUnparsableEvents,
  enumerateDateKeys,
  eventDateQueryBounds,
  isStuckEvent,
  occupiedCountFromEvent,
  reconcileDateKeys,
  reconcileMismatch,
  recomputeDateKeys,
  resolveAsOf,
  selectUpcomingLowFill,
  summarizeUserDirectory,
  taipeiStartMs,
  userCreatedDateKey,
} = require("../../functions/ops-rollup-core");

const QA = `U${"0".repeat(28)}0001`;
const DAY = "2026-11-08";
const AS_OF = DAY;

function event(partial) {
  const docId = partial._docId;
  return {
    id: docId,
    status: "ended",
    type: "pickup",
    creatorUid: "host-1",
    creator: "主辦甲",
    title: partial.title || docId,
    sportTag: "football",
    max: 10,
    realCurrent: 1,
    ...partial,
    _docId: docId,
  };
}

function reg(eventId, userId, extra = {}) {
  return { eventId, userId, status: "confirmed", ...extra };
}

function mark(eventId, uid, type, extra = {}) {
  return { eventId, uid, type, status: "active", ...extra };
}

describe("ops-rollup-core", () => {
  const startA = eventStartMillis("2026/11/08 23:30~01:00");

  function sharedFixture() {
    const events = [
      event({ _docId: "eventA", date: "2026/11/08 23:30~01:00", title: "夜場", realCurrent: 4, max: 10 }),
      event({ _docId: "eventB", date: "2026/11/08 10:00~12:00", title: "早場", realCurrent: 1, max: 8 }),
      event({ _docId: "eventCancel", date: "2026/11/08 09:00~10:00", status: "cancelled", title: "取消場" }),
      event({ _docId: "eventOld", date: "2026/11/06 19:00~21:00", title: "起算日前" }),
      event({ _docId: "eventBad", date: "not-a-date", title: "壞日期" }),
    ];
    const registrationsByDocId = {
      eventA: [
        reg("eventA", "u1"),
        reg("eventA", "u1"),
        reg("eventA", "u2"),
        reg("eventA", "u3"),
        reg("eventA", "u4", { promotedAt: startA + 1 }),
        reg("eventA", "u6"),
        reg("eventA", "u1", { companionId: "c1", participantType: "companion" }),
      ],
      eventB: [reg("eventB", "u1")],
      eventCancel: [reg("eventCancel", "u1")],
      eventOld: [reg("eventOld", "u2")],
      eventBad: [reg("eventBad", "u1")],
    };
    const attendanceByDocId = {
      eventA: [
        mark("eventA", "u1", "checkin"),
        mark("eventA", "u1", "checkout"),
        mark("eventA", "u3", "checkin", { status: "removed" }),
        mark("eventA", "u6", "checkin"),
        mark("eventA", "u1", "checkin", { companionId: "c1", participantType: "companion" }),
        mark("eventA", "walker", "checkin"),
      ],
      eventB: [mark("eventB", "u1", "checkin")],
      eventOld: [],
    };
    const flagsByDocId = { eventA: true, eventB: false, eventOld: true, eventCancel: true, eventBad: true };
    return { events, registrationsByDocId, attendanceByDocId, flagsByDocId };
  }

  function day(dateKey, fixture, extra = {}) {
    return buildDayDocs({
      dateKey,
      ...fixture,
      asOf: AS_OF,
      runId: "daily-20261109",
      nowMs: Date.UTC(2026, 10, 9, -8, 0, 0),
      since: NOSHOW_V2_SINCE,
      ...extra,
    });
  }

  test("同一組假資料的計入、完成、放鴿子加總等於 computeUserAttendanceStats", () => {
    const fixture = sharedFixture();
    const day08 = day(DAY, fixture);
    const day06 = day("2026-11-06", fixture);
    const rollup = ["counted", "completed", "noShow"].reduce((sum, key) => {
      sum[key] = day08.daily.attend[key] + day06.daily.attend[key];
      return sum;
    }, {});

    const flags = new Map(Object.entries(fixture.flagsByDocId));
    const registrations = Object.values(fixture.registrationsByDocId).flat();
    const attendanceRecords = Object.values(fixture.attendanceByDocId).flat();
    const oracle = { counted: 0, completed: 0, noShow: 0 };
    ["u1", "u2", "u3", "u4", "u6", "walker"].forEach((uid) => {
      const stats = computeUserAttendanceStats({
        uid,
        events: fixture.events,
        registrations,
        activityRecords: [],
        attendanceRecords,
        attendanceFlags: flags,
        since: NOSHOW_V2_SINCE,
      });
      oracle.counted += stats.countedCount;
      oracle.completed += stats.countedCompletedCount;
      oracle.noShow += stats.countedNoShowCount;
    });

    expect(rollup).toEqual(oracle);
    expect(oracle).toEqual({ counted: 4, completed: 1, noShow: 2 });
    expect(day08.daily.attend.incomplete).toBe(1);
    expect(day08.daily.attend.countedEvents).toBe(1);
    expect(day06.daily.attend.countedEvents).toBe(0);
    expect(day06.daily.events.held).toBe(1);
  });

  test("已取消、同行者、重複報名、removed 簽到、沒有有效簽退、起算日前、壞日期、23:30 歸屬日", () => {
    const fixture = sharedFixture();
    const built = day(DAY, fixture, { unparsableCount: countUnparsableEvents(fixture.events) });
    expect(built.daily.dateKey).toBe("2026-11-08");
    expect(built.daily.events).toEqual({ held: 2, cancelled: 1, external: 0, unparsable: 1 });
    expect(day("2026-11-09", fixture).daily.events.held).toBe(0);
    expect(built.daily.regs).toEqual({ confirmed: 6, companions: 1 });
    expect(built.daily.legacy).toEqual({ expected: 6, attended: 3 });
    const night = built.participant.events.find((item) => item.docId === "eventA");
    expect(night.checkedInUids).toEqual(["u1", "u6", "walker"]);
    expect(countUnparsableEvents(fixture.events)).toBe(1);
    expect(day("2026-11-06", fixture).daily.attend).toMatchObject({ counted: 0, noShow: 0, countedEvents: 0 });
  });

  test("QA 報名與 QA 主辦整場排除；外部活動不進舉辦、報名、出席與參與索引", () => {
    const events = [
      event({ _docId: "qaReg", date: "2026/11/08 19:00~21:00" }),
      event({ _docId: "qaHost", date: "2026/11/08 19:00~21:00", creatorUid: QA, title: "QA 場" }),
      event({ _docId: "ext", date: "2026/11/08 19:00~21:00", type: "external", title: "外部" }),
    ];
    const registrationsByDocId = {
      qaReg: [reg("qaReg", QA), reg("qaReg", "u1")],
      qaHost: [reg("qaHost", "u1")],
      ext: [reg("ext", "u1")],
    };
    const attendanceByDocId = {
      qaReg: [mark("qaReg", QA, "checkin"), mark("qaReg", "u1", "checkout"), mark("qaReg", "u1", "checkin")],
      qaHost: [mark("qaHost", "u1", "checkin")],
      ext: [mark("ext", "u1", "checkin")],
    };
    const flagsByDocId = { qaReg: true, qaHost: true, ext: true };
    const built = buildDayDocs({
      dateKey: DAY,
      events,
      registrationsByDocId,
      attendanceByDocId,
      flagsByDocId,
      since: NOSHOW_V2_SINCE,
    });
    expect(built.daily.events.held).toBe(1);
    expect(built.daily.events.external).toBe(1);
    expect(built.daily.regs.confirmed).toBe(1);
    expect(built.daily.attend).toMatchObject({ counted: 1, completed: 1, noShow: 0 });
    expect(built.participant.events.map((item) => item.docId)).toEqual(["qaReg"]);
    expect(built.participant.events[0].checkedInUids).toEqual(["u1"]);

    const qaStats = computeUserAttendanceStats({
      uid: QA,
      events,
      registrations: registrationsByDocId.qaReg,
      activityRecords: [],
      attendanceRecords: attendanceByDocId.qaReg,
      attendanceFlags: new Map([["qaReg", true]]),
      since: NOSHOW_V2_SINCE,
    });
    expect(qaStats.countedCount).toBe(1);
    expect(qaStats.countedCompletedCount).toBe(0);
    expect(qaStats.countedNoShowCount).toBe(0);
    expect(qaStats.countedIncompleteCount).toBe(1);
    expect(built.daily.attend.counted).toBe(1);
  });

  test("lastLogin 正好等於 asOfEnd 不算活躍；joinDate 候補與未知註冊日", () => {
    const asOfEnd = taipeiStartMs("2026-11-09");
    const facts = summarizeUserDirectory([
      { id: "edge", lastLogin: asOfEnd, createdAt: "2026/11/08 00:00" },
      { id: "inside", lastLogin: asOfEnd - 1, createdAt: "2026/11/07 23:30" },
      { id: QA, uid: QA, lastLogin: asOfEnd - 1, createdAt: "2026/11/08 12:00" },
      { id: "joinOnly", joinDate: "2026/11/08" },
      { id: "unknown" },
    ], AS_OF);
    expect(facts.snapshot.d7).toBe(1);
    expect(facts.snapshot.d30).toBe(1);
    expect(facts.qaUsers).toBe(1);
    expect(facts.totalUsers).toBe(4);
    expect(facts.unknownCreated).toBe(1);
    expect(facts.newUsersByDate["2026-11-08"]).toBe(2);
    expect(facts.newUsersByDate["2026-11-07"]).toBe(1);

    const lateMs = Date.UTC(2026, 10, 8, 15, 59, 0);
    const midnightMs = Date.UTC(2026, 10, 8, 16, 0, 0);
    expect(userCreatedDateKey({ createdAt: { toMillis: () => lateMs } })).toBe("2026-11-08");
    expect(userCreatedDateKey({
      createdAt: { seconds: Math.floor(midnightMs / 1000), nanoseconds: 0 },
    })).toBe("2026-11-09");
    const boundary = summarizeUserDirectory([
      { id: "late", createdAt: { seconds: Math.floor(lateMs / 1000), nanoseconds: 0 } },
      { id: "midnight", createdAt: { toMillis: () => midnightMs } },
    ], AS_OF);
    expect(boundary.newUsersByDate["2026-11-08"]).toBe(1);
    expect(boundary.newUsersByDate["2026-11-09"]).toBe(1);

    const fromCounts = activeSnapshotSubtractingQa(
      { d7: 2, d30: 2, d90: 2, d365: 2, total: 5 },
      [{ id: QA, lastLogin: asOfEnd - 1 }],
      AS_OF,
    );
    expect(fromCounts.snapshot.d7).toBe(1);
    expect(fromCounts.totalUsers).toBe(4);
    expect(fromCounts.qaUsers).toBe(1);
  });

  test("交易保留既有快照；asOf 尚無快照才寫入", () => {
    const userFacts = summarizeUserDirectory([{ id: "inside", lastLogin: taipeiStartMs(AS_OF), createdAt: AS_OF }], AS_OF);
    const older = buildDayDocs({
      dateKey: "2026-11-01",
      events: [],
      asOf: AS_OF,
      writeSnapshot: true,
      userFacts,
    }).daily;
    const kept = applyPreservedUserSnapshot(older, {
      users: { activeSnapshot: { d7: 3, d30: 3, d90: 3, d365: 3 }, totalUsers: 9, qaUsers: 1 },
    }, { dateKey: "2026-11-01", asOf: AS_OF });
    expect(kept.users.activeSnapshot.d7).toBe(3);
    expect(kept.users.totalUsers).toBe(9);
    expect(kept.users.qaUsers).toBe(1);

    const asOfDay = buildDayDocs({
      dateKey: AS_OF,
      events: [],
      asOf: AS_OF,
      writeSnapshot: true,
      userFacts,
    }).daily;
    const first = applyPreservedUserSnapshot(asOfDay, { users: { activeSnapshot: null, totalUsers: null, qaUsers: null } }, {
      dateKey: AS_OF,
      asOf: AS_OF,
    });
    expect(first.users.activeSnapshot.d7).toBe(1);
    const manual = applyPreservedUserSnapshot(asOfDay, {
      users: { activeSnapshot: { d7: 8, d30: 8, d90: 8, d365: 8 }, totalUsers: 20, qaUsers: 2 },
    }, { dateKey: AS_OF, asOf: AS_OF });
    expect(manual.users.activeSnapshot.d7).toBe(8);
    expect(manual.users.totalUsers).toBe(20);
  });

  test("卡住解除後把歸屬日加入重算；仍卡住的不另加", () => {
    const keys = recomputeDateKeys({
      asOf: AS_OF,
      previousAttention: [
        { kind: "stuck_event", refId: "old", dateKey: "2026-08-01" },
        { kind: "stuck_event", refId: "still", dateKey: "2026-07-01" },
      ],
      stuckRefIds: new Set(["still"]),
    });
    expect(keys).toContain("2026-08-01");
    expect(keys).not.toContain("2026-07-01");
    expect(keys).toContain("2026-10-26");
    expect(keys).toContain(AS_OF);
    expect(keys.filter((key) => key >= "2026-10-26" && key <= AS_OF)).toHaveLength(14);
    const reconcile = reconcileDateKeys(AS_OF);
    expect(reconcile).toHaveLength(22);
    expect(reconcile.some((key) => keys.includes(key))).toBe(false);
  });

  test("A2 卡住：過 1 小時、日期無法解析、外部可列、QA 主辦不列", () => {
    const nowMs = Date.UTC(2026, 10, 8, 4, 0, 0);
    const overdue = event({ _docId: "late", status: "open", date: "2026/11/08 10:00~11:00" });
    const recent = event({ _docId: "fresh", status: "full", date: "2026/11/08 11:30~12:30" });
    const bad = event({ _docId: "bad", status: "upcoming", date: "??" });
    const external = event({ _docId: "ext", status: "open", type: "external", date: "2026/11/08 08:00~09:00" });
    const qaHost = event({ _docId: "qa", status: "open", creatorUid: QA, date: "2026/11/08 08:00~09:00" });
    expect(isStuckEvent(overdue, nowMs)).toBe(true);
    expect(isStuckEvent(recent, nowMs)).toBe(false);
    const attention = buildStuckAttention([overdue, recent, bad, external, qaHost], nowMs);
    expect(attention.map((item) => item.refId)).toEqual(["bad", "ext", "late"]);
    expect(attention.find((item) => item.refId === "bad").dateKey).toBeUndefined();
    expect(attention.find((item) => item.refId === "ext").kind).toBe("stuck_event");
  });

  test("upcomingLowFill 超過 40 記 overflow，50% 與外部、QA、已額滿不進候選", () => {
    const nowMs = Date.UTC(2026, 10, 9, 1, 0, 0);
    const events = [];
    for (let i = 0; i < 41; i += 1) {
      const start = new Date(nowMs + (i + 1) * 60 * 1000);
      const taipei = new Date(start.getTime() + 8 * 60 * 60 * 1000);
      const date = `${taipei.getUTCFullYear()}/${taipei.getUTCMonth() + 1}/${taipei.getUTCDate()} ${String(taipei.getUTCHours()).padStart(2, "0")}:${String(taipei.getUTCMinutes()).padStart(2, "0")}~23:00`;
      events.push(event({
        _docId: `low-${String(i).padStart(2, "0")}`,
        status: "open",
        date,
        max: 10,
        realCurrent: 0,
      }));
    }
    const selected = selectUpcomingLowFill(events, nowMs);
    expect(selected.upcomingLowFill).toHaveLength(40);
    expect(selected.upcomingLowFillOverflow).toBe(1);
    expect(selected.upcomingLowFill.map((item) => item.docId)).not.toContain("low-40");
    expect(selected.upcomingLowFill[0].docId).toBe("low-00");

    const half = event({
      _docId: "half",
      status: "open",
      date: "2026/11/09 12:00~13:00",
      max: 10,
      realCurrent: 3,
      teamReservationSummaries: [{ remainingSlots: 2 }],
    });
    const under = event({
      _docId: "under",
      status: "upcoming",
      date: "2026/11/09 12:00~13:00",
      max: 10,
      realCurrent: 3,
      teamReservationSummaries: [{ remainingSlots: 1 }],
    });
    const filtered = [
      half,
      under,
      event({ _docId: "ext", status: "open", type: "external", date: "2026/11/09 12:00~13:00", max: 10, realCurrent: 0 }),
      event({ _docId: "qa", status: "open", creatorUid: QA, date: "2026/11/09 12:00~13:00", max: 10, realCurrent: 0 }),
      event({ _docId: "full", status: "full", date: "2026/11/09 12:00~13:00", max: 10, realCurrent: 0 }),
    ];
    expect(occupiedCountFromEvent(half)).toBe(5);
    expect(occupiedCountFromEvent(under)).toBe(4);
    const narrow = selectUpcomingLowFill(filtered, nowMs);
    expect(narrow.upcomingLowFill.map((item) => item.docId)).toEqual(["under"]);
    expect(narrow.upcomingLowFillOverflow).toBe(0);
  });

  test("彙總期間、排行、放鴿子主辦、費用門檻與月初不估算", () => {
    const briefsA = {
      docId: "a",
      title: "甲",
      creatorUid: "host-a",
      creator: "甲主辦",
      max: 10,
      occupied: 9,
      confirmed: 9,
      counted: 20,
      completed: 10,
      noShow: 10,
    };
    const briefsB = {
      docId: "b",
      title: "乙",
      creatorUid: "host-b",
      creator: "乙主辦",
      max: 5,
      occupied: 5,
      confirmed: 4,
      counted: 80,
      completed: 80,
      noShow: 0,
    };
    const dailyByDate = {
      [AS_OF]: {
        users: { newUsers: 2, activeSnapshot: { d7: 4, d30: 9, d90: 9, d365: 11 }, totalUsers: 40, qaUsers: 2 },
        events: { held: 2, cancelled: 0, external: 0, unparsable: 0 },
        regs: { confirmed: 13 },
        attend: { countedEvents: 2, counted: 100, completed: 90, incomplete: 0, noShow: 10 },
        eventsBrief: [briefsA, briefsB],
      },
      "2026-11-07": {
        users: { newUsers: 1, activeSnapshot: { d7: 3, d30: 8, d90: 8, d365: 10 }, totalUsers: 39, qaUsers: 2 },
        events: { held: 0 },
        regs: { confirmed: 0 },
        attend: { countedEvents: 0, counted: 0, completed: 0, incomplete: 0, noShow: 0 },
        eventsBrief: [],
      },
    };
    const cost = buildCost({
      todayKey: "2026-11-09",
      monthToDate: 80,
      currency: "USD",
      month: "2026-11",
      sourceDateKey: "2026-11-08",
      prevMonthTotal: 200,
    });
    expect(cost.projected).toBe(300);
    expect(buildCost({ todayKey: "2026-11-02", monthToDate: 10, sourceDateKey: "2026-11-01", prevMonthTotal: 1 }).projected).toBeNull();
    const { latest, noshow } = buildOpsSummaries({
      asOf: AS_OF,
      nowMs: 1,
      dailyByDate,
      stuckAttention: [{ kind: "stuck_event", refId: "late", title: "未結束", dateKey: "2026-11-01" }],
      lowFill: { upcomingLowFill: [{ docId: "soon", title: "soon", startMs: 1, max: 10, occupiedAtRun: 1 }], upcomingLowFillOverflow: 0 },
      cost,
      integrity: { lastReconcileAt: null, lastMismatchDays: ["2026-10-01"] },
    });
    expect(latest.periods.d7.complete).toBe(false);
    expect(latest.periods.d7.kpi.newUsers.cur).toBe(3);
    expect(latest.periods.d7.kpi.newUsers.prev).toBeNull();
    expect(latest.periods.d7.kpi.activeUsers).toEqual({ cur: 4, prev: null });
    expect(latest.periods.d7.kpi.eventsHeld.cur).toBe(2);
    expect(latest.periods.d7.topEvents[0].docId).toBe("b");
    expect(latest.periods.d7.topHosts[0]).toMatchObject({ uid: "host-a", events: 1, registrations: 9 });
    expect(latest.attention.map((item) => item.kind)).toEqual(["stuck_event", "cost_high", "reconcile_mismatch"]);
    expect(latest.lineQuota).toBeNull();
    expect(latest.trend.daily).toHaveLength(90);
    expect(latest.trend.monthly).toHaveLength(13);
    expect(latest.users).toEqual({ totalUsers: 40, qaUsers: 2 });
    expect(noshow.periods.d30).toMatchObject({ noShow: 10, counted: 100 });
    expect(noshow.attention).toEqual([
      { kind: "host_noshow_high", uid: "host-a", name: "甲主辦", noShow: 10, counted: 20 },
    ]);
    expect(resolveAsOf(Date.UTC(2026, 10, 8, 19, 0, 0))).toBe("2026-11-08");
    expect(enumerateDateKeys("2026-11-01", "2026-11-03")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
  });

  test("對帳比對簽到 UID；日期前綴涵蓋未補零月份", () => {
    const next = day(DAY, sharedFixture());
    expect(reconcileMismatch(next.daily, next.daily, next.participant, next.participant)).toBe(false);
    const changed = {
      ...next.participant,
      events: next.participant.events.map((item) => (
        item.docId === "eventA" ? { ...item, checkedInUids: ["u1"] } : item
      )),
    };
    expect(reconcileMismatch(next.daily, next.daily, next.participant, changed)).toBe(true);
    const bounds = eventDateQueryBounds("2026-11-01", "2026-11-08").map((item) => item.start);
    expect(bounds).toContain("2026/11/");
    expect(bounds).toContain("2026-11-");
    expect(eventDateQueryBounds("2026-09-01", "2026-09-02").map((item) => item.start)).toEqual(
      expect.arrayContaining(["2026/9/", "2026/09/", "2026-9-", "2026-09-"]),
    );
  });

  test("重算日有缺口時只切成連續區段，月份前綴不含中間月份", () => {
    expect(contiguousDateSegments(["2026-11-03", "2026-11-01", "2026-11-02", "2025-03-01", "2026-11-01"])).toEqual([
      { start: "2025-03-01", end: "2025-03-01" },
      { start: "2026-11-01", end: "2026-11-03" },
    ]);
    expect(contiguousDateSegments([])).toEqual([]);
    const keys = recomputeDateKeys({
      asOf: AS_OF,
      previousAttention: [{ kind: "stuck_event", refId: "old", dateKey: "2025-03-01" }],
      stuckRefIds: new Set(),
    });
    const segments = contiguousDateSegments(keys);
    expect(segments).toEqual([
      { start: "2025-03-01", end: "2025-03-01" },
      { start: "2026-10-26", end: "2026-11-08" },
    ]);
    const starts = segments.flatMap((segment) => eventDateQueryBounds(segment.start, segment.end).map((item) => item.start));
    expect(starts.some((start) => start.startsWith("2025/7") || start.startsWith("2025-7") || start.startsWith("2026/6"))).toBe(false);
    expect(starts).toEqual(expect.arrayContaining(["2025/3/", "2025/03/", "2026/10/", "2026/11/"]));
  });
});
