"use strict";

// 團隊預留自動釋出（計畫 team-reservation-auto-release-plan v2.1 批 1）單元測試。
// 容量／遞補 helper 一律從 functions/index.js 切出真實原始碼執行，不另寫一份；Firestore 用 registration-callable-harness 的記憶體版。

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  TEAM_RESERVATION_RELEASE_HOURS,
  normalizeReleaseHours,
  resolveEventStartMs,
  evaluateReleaseTiming,
  classifyReservedAfterRelease,
  planTeamReservationRelease,
  createReleaseTeamReservationsHandler,
} = require("../../functions/team-reservation-release");
const { maskId } = require("../../functions/team-membership-core");
const {
  createFakeFirestore, FieldValue, FakeTimestamp, loadFunctionsIndex,
} = require("./registration-callable-harness");

const indexSource = fs.readFileSync(path.resolve(__dirname, "../../functions/index.js"), "utf8");

function extractFunction(name) {
  const start = indexSource.search(new RegExp("^(?:async )?function " + name + "\\(", "m"));
  if (start < 0) throw new Error("Missing helper: " + name);
  const end = indexSource.indexOf("\n}", start);
  if (end < 0) throw new Error("Missing helper end: " + name);
  return indexSource.slice(start, end + 2);
}

function loadHelpers() {
  const names = [
    "sanitizeStr", "isCourseLinkedEventData", "isCourseLinkedRegistrationData", "hasCourseLinkedActivityRecordData",
    "getCourseLinkedRegistrationKey", "registrationUniqueKey", "dedupeRegistrations",
    "normalizeTeamReservationSummaries", "registrationTeamReservationTeamId", "sortWaitlistCandidates",
    "promoteWaitlistForAvailableSeats", "rebuildOccupancy", "findActivityRecordForRegistration",
    "parseEventStartDateInTaipei", "settleBestEffortPostCommitOps",
    "findTeamReservationForUser", "applyTeamReservationFields", "decideRegistrationSeat",
  ];
  const sandbox = {
    Date,
    console: { error: () => {}, warn: () => {}, log: () => {} },
    COURSE_LINK_SOURCE_EDU_LESSON: "eduCourseLesson",
    COURSE_LINK_STATE_CREATED_BY_COURSE: "created_by_course",
    COURSE_LINK_STATE_PRIORITY_OVERLAY: "priority_overlay",
    // 報名身分判斷只取 teamIds（職員隊伍另有 helper，與本案無關）。
    getUserTeamIdSetFromData: (userData) => new Set(Array.isArray(userData?.teamIds) ? userData.teamIds : []),
    teamReservationSelectionError: (code) => new Error(code),
  };
  vm.runInNewContext(names.map(extractFunction).join("\n"), sandbox, { filename: "team-reservation-release-helpers.vm.js" });
  return Object.fromEntries(names.map((name) => [name, sandbox[name]]));
}

const helpers = loadHelpers();

// 固定現在：2026-11-20 00:00 台北。活動 11/20 10:00 開始、12 小時前釋出（11/19 22:00）→ 已到點、未開始。
const NOW_MS = Date.UTC(2026, 10, 19, 16, 0);
const START_MS = Date.UTC(2026, 10, 20, 2, 0);
const HOUR = 3600000;

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function reg(id, status, extra = {}) {
  return {
    id, _docId: id, eventId: "evtA", userId: `u_${id}`, userName: `名${id}`,
    participantType: "self", status, registeredAt: `2026-11-01T00:00:${String(id.length).padStart(2, "0")}.000Z`, ...extra,
  };
}

function baseEvent(extra = {}) {
  return {
    id: "evtA", title: "週五夜踢", date: "2026/11/20 10:00~12:00", location: "測試場",
    status: "full", max: 4, teamReservationReleaseHours: 12,
    teamReservationSummaries: [
      { teamId: "teamA", teamName: "A 隊", reservedSlots: 3, usedSlots: 1, updatedAt: "2026-11-01T00:00:00.000Z" },
    ],
    ...extra,
  };
}

// 標準情境：A 隊預留 3 已用 1、一般正取 1、候補 2；max 4 → 釋出前 current 4（滿）。
function standardRegs() {
  return [
    reg("r1", "confirmed", { teamReservationTeamId: "teamA", teamReservationTeamName: "A 隊", teamSeatSource: "reserved", registeredAt: "2026-11-01T01:00:00.000Z" }),
    reg("r2", "confirmed", { registeredAt: "2026-11-01T02:00:00.000Z" }),
    reg("w1", "waitlisted", { registeredAt: "2026-11-02T01:00:00.000Z" }),
    reg("w2", "waitlisted", { registeredAt: "2026-11-02T02:00:00.000Z" }),
    reg("w3", "waitlisted", { registeredAt: "2026-11-02T03:00:00.000Z" }),
  ];
}

describe("normalizeReleaseHours：允許集合外一律視為 0", () => {
  test("允許值原樣回傳", () => {
    expect(TEAM_RESERVATION_RELEASE_HOURS).toEqual([0, 3, 6, 12, 24, 48, 72]);
    TEAM_RESERVATION_RELEASE_HOURS.forEach((h) => expect(normalizeReleaseHours(h)).toBe(h));
  });
  test.each([[5], [-3], ["12"], [NaN], [null], [undefined], [12.5], [Infinity], [{}]])("非法值 %p → 0", (value) => {
    expect(normalizeReleaseHours(value)).toBe(0);
  });
});

describe("resolveEventStartMs：date 為主、嚴格格式、startTimestamp fallback", () => {
  const parse = helpers.parseEventStartDateInTaipei;
  const ts = (ms) => ({ toMillis: () => ms });
  const FALLBACK_MS = Date.UTC(2026, 10, 20, 11, 0); // 台北 19:00

  test("標準形狀以 date 字串為準（不採 A 裝置時區的 startTimestamp）", () => {
    expect(resolveEventStartMs({ date: "2026/11/20 19:00~21:00", startTimestamp: ts(FALLBACK_MS + 8 * HOUR) }, parse))
      .toBe(FALLBACK_MS);
    expect(resolveEventStartMs({ date: "  2026/11/20   19:00~21:00 " }, parse)).toBe(FALLBACK_MS);
    expect(resolveEventStartMs({ date: "2026/11/20 19:00:30~21:00 (備註)" }, parse)).toBe(FALLBACK_MS);
    expect(resolveEventStartMs({ date: "2026/11/20 19:00" }, parse)).toBe(FALLBACK_MS);
  });

  test("`~` 前後空白：開始時間正確為 19:00，不會變 00:00", () => {
    expect(resolveEventStartMs({ date: "2026/11/20 19:00 ~ 21:00" }, parse)).toBe(FALLBACK_MS);
  });

  test.each([
    ["只有日期", "2026/11/20"],
    ["全形 ～", "2026/11/20 19:00～21:00"],
    ["亂字時間", "2026/11/20 abc"],
    ["2/31 溢位", "2026/02/31 10:00~12:00"],
    ["24 時", "2026/11/20 24:00~25:00"],
    ["- 分隔", "2026-11-20 19:00~21:00"],
  ])("%s：不採當天 00:00，改用 startTimestamp", (_label, date) => {
    const midnight = Date.UTC(2026, 10, 19, 16, 0);
    const result = resolveEventStartMs({ date, startTimestamp: ts(FALLBACK_MS) }, parse);
    expect(result).toBe(FALLBACK_MS);
    expect(result).not.toBe(midnight);
  });

  test("startTimestamp 也接受 Date；兩者皆不可靠回 null", () => {
    expect(resolveEventStartMs({ date: "2026/11/20", startTimestamp: new Date(FALLBACK_MS) }, parse)).toBe(FALLBACK_MS);
    expect(resolveEventStartMs({ date: "2026/11/20" }, parse)).toBeNull();
    expect(resolveEventStartMs({ date: "2026/11/20～", startTimestamp: "2026-11-20T11:00:00Z" }, parse)).toBeNull();
    expect(resolveEventStartMs({ startTimestamp: { toMillis: () => NaN } }, parse)).toBeNull();
    expect(resolveEventStartMs({}, parse)).toBeNull();
    expect(resolveEventStartMs(null, parse)).toBeNull();
  });
});

describe("evaluateReleaseTiming：資格判斷", () => {
  const deps = helpers;
  test("到點且未開始 → due", () => {
    expect(evaluateReleaseTiming(baseEvent(), NOW_MS, deps)).toMatchObject({
      due: true, hours: 12, startMs: START_MS, releaseAtMs: START_MS - 12 * HOUR,
    });
    expect(evaluateReleaseTiming(baseEvent(), START_MS - 12 * HOUR, deps).due).toBe(true);
  });
  test("未到點、已開始都是 not_due", () => {
    expect(evaluateReleaseTiming(baseEvent(), START_MS - 12 * HOUR - 1, deps).reason).toBe("not_due");
    expect(evaluateReleaseTiming(baseEvent(), START_MS, deps).reason).toBe("not_due");
    expect(evaluateReleaseTiming(baseEvent(), START_MS + HOUR, deps).reason).toBe("not_due");
  });
  test("hours 缺省、0、非法 → hours_off", () => {
    [undefined, 0, 5, "12"].forEach((hours) => {
      expect(evaluateReleaseTiming(baseEvent({ teamReservationReleaseHours: hours }), NOW_MS, deps).reason).toBe("hours_off");
    });
  });
  test("非 open／full、課程連動 → invalid_status", () => {
    ["cancelled", "ended", "upcoming", ""].forEach((status) => {
      expect(evaluateReleaseTiming(baseEvent({ status }), NOW_MS, deps).reason).toBe("invalid_status");
    });
    expect(evaluateReleaseTiming(baseEvent({ courseLinked: true, courseLinkSource: "eduCourseLesson" }), NOW_MS, deps).reason)
      .toBe("invalid_status");
  });
  test("開始時間無法判定 → start_unknown", () => {
    expect(evaluateReleaseTiming(baseEvent({ date: "2026/11/20" }), NOW_MS, deps).reason).toBe("start_unknown");
  });
});

describe("planTeamReservationRelease：純函式", () => {
  test("reserved:=0 真釋出、已用保留、空位依序遞補、不改輸入", () => {
    const eventData = deepFreeze(baseEvent());
    const registrations = deepFreeze(standardRegs());
    const plan = planTeamReservationRelease({ eventData, registrations, nowMs: NOW_MS }, helpers);

    expect(plan.beforeSummaries[0]).toMatchObject({ teamId: "teamA", reservedSlots: 3, usedSlots: 1, remainingSlots: 2 });
    expect(plan.releasedSummary).toEqual([{ teamId: "teamA", teamName: "A 隊", releasedSlots: 2 }]);
    expect(plan.nextSummaries[0]).toMatchObject({
      teamId: "teamA", reservedSlots: 0, usedSlots: 1, remainingSlots: 0, occupiedSlots: 1,
      updatedAt: new Date(NOW_MS).toISOString(), updatedByUid: "system", updatedByName: "系統自動釋出",
    });
    expect(plan.promoted.map((item) => item._docId)).toEqual(["w1", "w2"]);
    expect(plan.occupancy).toMatchObject({ realCurrent: 4, current: 4, waitlist: 1, status: "full" });
    expect(plan.occupancy.teamReservationSummaries).toEqual([
      expect.objectContaining({ teamId: "teamA", reservedSlots: 0, usedSlots: 1, remainingSlots: 0, occupiedSlots: 1 }),
    ]);
    expect(registrations.find((item) => item._docId === "w1").status).toBe("waitlisted");
  });

  test("超用（used>reserved）不墊高預留、releasedSlots 不為負", () => {
    const eventData = baseEvent({
      max: 6,
      teamReservationSummaries: [{ teamId: "teamA", teamName: "A 隊", reservedSlots: 2, usedSlots: 2 }],
    });
    const registrations = ["r1", "r2", "r3"].map((id) => reg(id, "confirmed", {
      teamReservationTeamId: "teamA", teamSeatSource: id === "r3" ? "overflow" : "reserved",
    }));
    const plan = planTeamReservationRelease({ eventData, registrations, nowMs: NOW_MS }, helpers);
    expect(plan.beforeSummaries[0]).toMatchObject({ reservedSlots: 2, usedSlots: 3 });
    expect(plan.releasedSummary).toEqual([]);
    expect(plan.occupancy.teamReservationSummaries[0]).toMatchObject({ reservedSlots: 0, usedSlots: 3, remainingSlots: 0, occupiedSlots: 3 });
    expect(plan.teamReservationDocOps.set[0].data).toMatchObject({ reservedSlots: 0, usedSlots: 3 });
  });

  test("teamReservationDocOps：仍有已用席位 set、完全沒用的隊 delete 並從 summaries 移除", () => {
    const eventData = baseEvent({
      max: 8,
      teamReservationSummaries: [
        { teamId: "teamA", teamName: "A 隊", reservedSlots: 2 },
        { teamId: "teamB", teamName: "B 隊", reservedSlots: 3 },
      ],
    });
    const registrations = [reg("r1", "confirmed", { teamReservationTeamId: "teamA" })];
    const plan = planTeamReservationRelease({ eventData, registrations, nowMs: NOW_MS }, helpers);
    expect(plan.releasedSummary).toEqual([
      { teamId: "teamA", teamName: "A 隊", releasedSlots: 1 },
      { teamId: "teamB", teamName: "B 隊", releasedSlots: 3 },
    ]);
    expect(plan.releasedSummary.every((item) => item.releasedSlots >= 0)).toBe(true);
    expect(plan.teamReservationDocOps).toEqual({
      set: [{
        teamId: "teamA",
        data: {
          id: "teamA", teamId: "teamA", teamName: "A 隊", reservedSlots: 0, usedSlots: 1,
          remainingSlots: 0, occupiedSlots: 1, updatedByUid: "system", updatedByName: "系統自動釋出",
        },
      }],
      delete: ["teamB"],
    });
    expect(plan.occupancy.teamReservationSummaries.map((item) => item.teamId)).toEqual(["teamA"]);
    expect(plan.occupancy).toMatchObject({ realCurrent: 1, current: 1, status: "open" });
  });

  test("occupancy 情境：釋出後團隊成員再報名走 overflow，滿了走候補（不再吃預留）", () => {
    const plan = planTeamReservationRelease({ eventData: baseEvent({ max: 5 }), registrations: standardRegs(), nowMs: NOW_MS }, helpers);
    const released = { ...baseEvent({ max: 5 }), teamReservationSummaries: plan.occupancy.teamReservationSummaries };
    const activeAfter = standardRegs().map((item) => (["w1", "w2", "w3"].includes(item._docId) ? { ...item, status: "confirmed" } : item));
    // max 5、正取 5 → 已滿：A 隊成員報名進候補並標隊伍
    const full = { id: "n1", userId: "u_n1", userName: "新A", participantType: "self" };
    const fullDecision = helpers.decideRegistrationSeat(released, activeAfter, full, { teamIds: ["teamA"] });
    expect(fullDecision.status).toBe("waitlisted");
    expect(full).toMatchObject({ teamReservationTeamId: "teamA", teamSeatSource: "waitlist" });
    // 有空位時走 overflow，不是 reserved
    const roomy = { ...released, max: 10 };
    const open = { id: "n2", userId: "u_n2", userName: "新A2", participantType: "self" };
    const openDecision = helpers.decideRegistrationSeat(roomy, activeAfter, open, { teamIds: ["teamA"] });
    expect(openDecision.status).toBe("confirmed");
    expect(open.teamSeatSource).toBe("overflow");
  });

  test("occupancy 情境：預留成員取消後 remaining 仍 0，空位給一般候補（照順序）", () => {
    const plan = planTeamReservationRelease({ eventData: baseEvent(), registrations: standardRegs(), nowMs: NOW_MS }, helpers);
    const afterEvent = { ...baseEvent(), teamReservationSummaries: plan.occupancy.teamReservationSummaries };
    // 釋出後狀態：r1(A隊)、r2、w1、w2 正取，w3 候補；另有 A 隊候補 wa（較晚）
    const regs = standardRegs().map((item) => (["w1", "w2"].includes(item._docId) ? { ...item, status: "confirmed" } : item));
    regs.push(reg("wa", "waitlisted", { teamReservationTeamId: "teamA", teamSeatSource: "waitlist", registeredAt: "2026-11-03T00:00:00.000Z" }));
    const sim = regs.map((item) => (item._docId === "r1" ? { ...item, status: "cancelled" } : { ...item }));
    const before = helpers.rebuildOccupancy(afterEvent, sim.filter((item) => item.status !== "cancelled"));
    expect(before.teamReservationSummaries).toEqual([]);
    const promoted = helpers.promoteWaitlistForAvailableSeats(afterEvent, sim.filter((item) => item.status !== "cancelled"));
    expect(promoted.map((item) => item._docId)).toEqual(["w3"]);
  });

  test("R-REG-006 遞補順序：waitlistSortAt||registeredAt → promotionOrder → docId", () => {
    const eventData = baseEvent({ max: 6, teamReservationSummaries: [{ teamId: "teamA", teamName: "A 隊", reservedSlots: 4 }] });
    const registrations = [
      reg("c1", "confirmed"), reg("c2", "confirmed"),
      reg("wz", "waitlisted", { registeredAt: "2026-11-01T00:00:00.000Z", waitlistSortAt: "2026-11-09T00:00:00.000Z" }),
      reg("wb", "waitlisted", { registeredAt: "2026-11-05T00:00:00.000Z", promotionOrder: 2 }),
      reg("wa", "waitlisted", { registeredAt: "2026-11-05T00:00:00.000Z", promotionOrder: 1 }),
      reg("wc", "waitlisted", { registeredAt: { toDate: () => new Date("2026-11-04T00:00:00.000Z") } }),
      reg("wd", "waitlisted", { registeredAt: "2026-11-05T00:00:00.000Z", promotionOrder: 2 }),
    ];
    const plan = planTeamReservationRelease({ eventData, registrations, nowMs: NOW_MS }, helpers);
    expect(plan.promoted.map((item) => item._docId)).toEqual(["wc", "wa", "wb", "wd"]);
  });

  test("targetTeamIds：只釋出指定隊伍，其他隊保持原樣", () => {
    const eventData = baseEvent({
      max: 10,
      teamReservationSummaries: [
        { teamId: "teamA", teamName: "A 隊", reservedSlots: 2, updatedAt: "2026-11-01T00:00:00.000Z" },
        { teamId: "teamB", teamName: "B 隊", reservedSlots: 2, updatedAt: "2026-11-19T15:00:00.000Z" },
      ],
    });
    const plan = planTeamReservationRelease({ eventData, registrations: [], nowMs: NOW_MS, targetTeamIds: ["teamA"] }, helpers);
    expect(plan.releasedSummary).toEqual([{ teamId: "teamA", teamName: "A 隊", releasedSlots: 2 }]);
    expect(plan.occupancy.teamReservationSummaries).toEqual([
      expect.objectContaining({ teamId: "teamB", reservedSlots: 2, remainingSlots: 2, updatedAt: "2026-11-19T15:00:00.000Z" }),
    ]);
    expect(plan.teamReservationDocOps).toEqual({ set: [], delete: ["teamA"] });
  });
});

describe("classifyReservedAfterRelease：過期回寫偵測", () => {
  const releasedAt = FakeTimestamp.fromMillis(NOW_MS - HOUR);
  test("updatedAt 早於 releasedAt（或缺）→ stale；晚於 → fresh；reserved 0 不算", () => {
    const { stale, fresh } = classifyReservedAfterRelease([
      { teamId: "old", reservedSlots: 2, updatedAt: new Date(NOW_MS - 2 * HOUR).toISOString() },
      { teamId: "missing", reservedSlots: 1, updatedAt: null },
      { teamId: "manual", reservedSlots: 2, updatedAt: new Date(NOW_MS).toISOString() },
      { teamId: "released", reservedSlots: 0, usedSlots: 3, updatedAt: null },
    ], releasedAt);
    expect(stale.map((item) => item.teamId)).toEqual(["old", "missing"]);
    expect(fresh.map((item) => item.teamId)).toEqual(["manual"]);
  });
  test("releasedAt 無法判讀時一律視為 fresh（不自動釋出）", () => {
    const { stale, fresh } = classifyReservedAfterRelease([{ teamId: "x", reservedSlots: 1, updatedAt: null }], "garbage");
    expect(stale).toEqual([]);
    expect(fresh).toHaveLength(1);
  });
});

// ─── 排程 handler（依賴注入＋記憶體 Firestore） ───

function createHarness(seed, { nowMs = NOW_MS, afterScan = null, extraDeps = {} } = {}) {
  const fake = createFakeFirestore(seed);
  let scanned = false;
  // 包一層 events 查詢：掃描完、進交易前可插入「主辦人剛好改了活動」的並發寫入。
  const db = {
    ...fake.db,
    collection: (name) => {
      const ref = fake.db.collection(name);
      if (name !== "events") return ref;
      return {
        ...ref,
        where: (...args) => {
          const query = ref.where(...args);
          return {
            ...query,
            select: (...fields) => {
              const selected = query.select(...fields);
              return {
                ...selected,
                get: async () => {
                  const raw = await selected.get();
                  // 假 DB 的 snapshot.data() 是讀當下值；真實查詢結果是掃描當時的快照，先固定下來。
                  const docs = raw.docs.map((doc) => {
                    const data = doc.data();
                    return { id: doc.id, ref: doc.ref, exists: doc.exists, data: () => data };
                  });
                  const result = { ...raw, docs, size: docs.length };
                  if (afterScan && !scanned) {
                    scanned = true;
                    afterScan(fake);
                  }
                  return result;
                },
              };
            },
          };
        },
      };
    },
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const deps = {
    ...helpers,
    db,
    FieldValue,
    logger,
    maskId,
    now: () => nowMs,
    writeInboxNotification: jest.fn(async () => undefined),
    adjustExpInternal: jest.fn(async () => undefined),
    settleBestEffortPostCommitOps: jest.fn(helpers.settleBestEffortPostCommitOps),
    formatOperationLogTime: jest.fn(() => "11/20 00:00"),
    ...extraDeps,
  };
  const handler = createReleaseTeamReservationsHandler(deps);
  return { fake, deps, logger, run: () => handler({}) };
}

function seedEvent(docId, event, regs = [], ars = []) {
  return {
    [`events/${docId}`]: event,
    ...Object.fromEntries(regs.map((item) => [`events/${docId}/registrations/${item._docId}`, item])),
    ...Object.fromEntries(ars.map((item) => [`events/${docId}/activityRecords/${item._docId}`, item])),
  };
}

function standardArs() {
  return [
    { _docId: "ar_r1", uid: "u_r1", status: "registered" },
    { _docId: "ar_w1", uid: "u_w1", status: "waitlisted" },
    { _docId: "ar_w2", uid: "u_w2", status: "waitlisted" },
    { _docId: "ar_w3", uid: "u_w3", status: "waitlisted" },
  ];
}

describe("releaseTeamReservations handler", () => {
  test("到點：同一交易內歸 0、遞補、AR 同步、鏡像子文件、終態欄位", async () => {
    const h = createHarness(seedEvent("evtA", baseEvent(), standardRegs(), standardArs()));
    const summary = await h.run();

    expect(summary).toMatchObject({
      scannedCount: 1, dueCount: 1, releasedCount: 1, lightweightCount: 0, promotedCount: 2, failedCount: 0,
    });
    const event = h.fake.get("events/evtA");
    expect(event.teamReservationReleasedAt).toBeInstanceOf(FakeTimestamp);
    expect(event.teamReservationReleasedSummary).toEqual([{ teamId: "teamA", teamName: "A 隊", releasedSlots: 2 }]);
    expect(event.teamReservationSummaries).toEqual([
      expect.objectContaining({ teamId: "teamA", reservedSlots: 0, usedSlots: 1, remainingSlots: 0, updatedByUid: "system" }),
    ]);
    expect(event).toMatchObject({ current: 4, realCurrent: 4, waitlist: 1, status: "full", schemaVersion: 2 });
    expect(event.teamReservationReleaseCount).toBeUndefined();
    expect(h.fake.get("events/evtA/registrations/w1")).toMatchObject({ status: "confirmed" });
    expect(h.fake.get("events/evtA/registrations/w1").promotedAt).toBeInstanceOf(FakeTimestamp);
    expect(h.fake.get("events/evtA/registrations/w3").status).toBe("waitlisted");
    expect(h.fake.get("events/evtA/activityRecords/ar_w1").status).toBe("registered");
    expect(h.fake.get("events/evtA/activityRecords/ar_w3").status).toBe("waitlisted");
    expect(h.fake.get("events/evtA/teamReservations/teamA")).toMatchObject({ reservedSlots: 0, usedSlots: 1, remainingSlots: 0 });
    // R-REG-003：所有寫入同一次交易提交
    const txWrites = h.fake.txWrites();
    expect(new Set(txWrites.map((item) => item.commit)).size).toBe(1);
    expect(txWrites.map((item) => item.path).sort()).toEqual([
      "events/evtA",
      "events/evtA/activityRecords/ar_w1",
      "events/evtA/activityRecords/ar_w2",
      "events/evtA/registrations/w1",
      "events/evtA/registrations/w2",
      "events/evtA/teamReservations/teamA",
    ]);
  });

  test("後置照 F1：同 uid 只發一次站內信、同行者不加 EXP、operationLogs 自填系統身分", async () => {
    const regs = [
      reg("r1", "confirmed", { teamReservationTeamId: "teamA", registeredAt: "2026-11-01T01:00:00.000Z" }),
      reg("w1", "waitlisted", { userId: "u_main", registeredAt: "2026-11-02T01:00:00.000Z" }),
      reg("w1c", "waitlisted", {
        userId: "u_main", participantType: "companion", companionId: "c1", companionName: "同行", registeredAt: "2026-11-02T01:00:01.000Z",
      }),
    ];
    const ars = [{ _docId: "ar_main", uid: "u_main", status: "waitlisted" }];
    const event = baseEvent({ max: 3, teamReservationSummaries: [{ teamId: "teamA", teamName: "A 隊", reservedSlots: 2 }] });
    const h = createHarness(seedEvent("evtLongId123", event, regs, ars));
    const summary = await h.run();

    expect(summary.promotedCount).toBe(2);
    expect(h.fake.get("events/evtLongId123/registrations/w1c").status).toBe("confirmed");
    expect(h.fake.get("events/evtLongId123/activityRecords/ar_main").status).toBe("registered");
    const arWrites = h.fake.txWrites().filter((item) => item.path.includes("/activityRecords/"));
    expect(arWrites).toHaveLength(1);

    expect(h.deps.writeInboxNotification).toHaveBeenCalledTimes(1);
    expect(h.deps.writeInboxNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUid: "u_main", title: "候補遞補通知", category: "activity",
    }));
    expect(h.deps.adjustExpInternal).toHaveBeenCalledTimes(1);
    const expArgs = h.deps.adjustExpInternal.mock.calls[0][0];
    expect(expArgs).toMatchObject({ targetUid: "u_main", amount: 10, ruleKey: "register_activity" });
    expect(expArgs.operatorUid).toBeUndefined();
    expect(h.deps.settleBestEffortPostCommitOps).toHaveBeenCalledWith("releaseTeamReservations", expect.any(Array));
    expect(h.deps.settleBestEffortPostCommitOps.mock.calls[0][1]).toHaveLength(3);

    const logIds = h.fake.list("operationLogs");
    expect(logIds).toHaveLength(1);
    const log = h.fake.get(`operationLogs/${logIds[0]}`);
    expect(log).toMatchObject({
      type: "team_reservation_auto_release", typeName: "俱樂部席位", operator: "系統",
      operatorUid: "cloud_function", operatorName: "系統", actorUid: "cloud_function", time: "11/20 00:00",
      meta: { eventId: maskId("evtLongId123"), releasedSummary: [{ teamId: "teamA", teamName: "A 隊", releasedSlots: 1 }], promotedCount: 2, rerelease: false },
    });
    expect(log.meta.eventId).not.toContain("evtLongId123");
  });

  test("後置失敗不影響已提交的釋出（allSettled 記錄失敗數）", async () => {
    const h = createHarness(seedEvent("evtA", baseEvent(), standardRegs(), standardArs()), {
      extraDeps: { adjustExpInternal: jest.fn(async () => { throw Object.assign(new Error("exp down"), { code: "unavailable" }); }) },
    });
    const summary = await h.run();
    expect(summary).toMatchObject({ releasedCount: 1, failedCount: 0, postCommitFailureCount: 2 });
    expect(h.fake.get("events/evtA").teamReservationReleasedSummary).toHaveLength(1);
  });

  test("冪等：第二輪看到終態就跳過，不再寫入", async () => {
    const h = createHarness(seedEvent("evtA", baseEvent(), standardRegs(), standardArs()));
    await h.run();
    const writesAfterFirst = h.fake.state.writes.length;
    const attemptsAfterFirst = h.fake.state.transactionAttempts;
    const second = await h.run();
    expect(second).toMatchObject({ dueCount: 0, releasedCount: 0, scanSkippedByReason: { already_released: 1 } });
    expect(h.fake.state.writes.length).toBe(writesAfterFirst);
    expect(h.fake.state.transactionAttempts).toBe(attemptsAfterFirst);
  });

  test.each([
    ["主辦剛取消活動", { status: "cancelled" }, "invalid_status"],
    ["改成課程連動", { courseLinked: true, courseLinkSource: "eduCourseLesson" }, "invalid_status"],
    ["hours 改成 0", { teamReservationReleaseHours: 0 }, "hours_off"],
    ["活動延期", { date: "2026/11/25 10:00~12:00" }, "not_due"],
    ["已被別輪釋出", { teamReservationReleasedAt: FakeTimestamp.fromMillis(NOW_MS - 1000), teamReservationSummaries: [] }, "already_released"],
  ])("交易內二次檢查：%s → skip %s，不寫入", async (_label, patch, reason) => {
    const h = createHarness(seedEvent("evtA", baseEvent(), standardRegs(), standardArs()), {
      afterScan: (fake) => fake.put("events/evtA", { ...fake.get("events/evtA"), ...patch }),
    });
    const summary = await h.run();
    expect(summary.dueCount).toBe(1);
    expect(summary.skippedByReason).toEqual({ [reason]: 1 });
    expect(summary.releasedCount).toBe(0);
    expect(h.fake.state.writes).toHaveLength(0);
    expect(h.deps.writeInboxNotification).not.toHaveBeenCalled();
  });

  test("輕量終態：沒有任何預留時只寫終態，不讀報名子集合、不碰 current", async () => {
    const event = baseEvent({ current: 7, teamReservationSummaries: [] });
    const h = createHarness(seedEvent("evtA", event, standardRegs(), standardArs()));
    const summary = await h.run();
    expect(summary).toMatchObject({ lightweightCount: 1, releasedCount: 0 });
    expect(h.fake.state.reads.tx).toBe(1);
    const writes = h.fake.txWrites();
    expect(writes).toEqual([expect.objectContaining({ op: "update", path: "events/evtA" })]);
    const stored = h.fake.get("events/evtA");
    expect(stored.teamReservationReleasedAt).toBeInstanceOf(FakeTimestamp);
    expect(stored.teamReservationReleasedSummary).toEqual([]);
    expect(stored.current).toBe(7);
    expect(h.fake.list("operationLogs")).toHaveLength(0);
  });

  test("預留已用完（reserved=used）仍走完整路徑把 reserved 歸 0，摘要為空", async () => {
    const event = baseEvent({ max: 3, teamReservationSummaries: [{ teamId: "teamA", teamName: "A 隊", reservedSlots: 2, usedSlots: 2 }] });
    const regs = [
      reg("r1", "confirmed", { teamReservationTeamId: "teamA" }),
      reg("r2", "confirmed", { teamReservationTeamId: "teamA" }),
    ];
    const h = createHarness(seedEvent("evtA", event, regs));
    const summary = await h.run();
    expect(summary).toMatchObject({ releasedCount: 1, lightweightCount: 0, promotedCount: 0 });
    const stored = h.fake.get("events/evtA");
    expect(stored.teamReservationSummaries[0]).toMatchObject({ reservedSlots: 0, usedSlots: 2, remainingSlots: 0 });
    expect(stored.teamReservationReleasedSummary).toEqual([]);
  });

  test("已開始、未到點、hours 非法、時間無法判定：不進交易", async () => {
    const h = createHarness({
      ...seedEvent("started", baseEvent({ date: "2026/11/19 23:00~23:59" })),
      ...seedEvent("early", baseEvent({ date: "2026/11/21 10:00~12:00" })),
      ...seedEvent("badHours", baseEvent({ teamReservationReleaseHours: 5 })),
      ...seedEvent("unknown", baseEvent({ date: "2026/11/20" })),
      ...seedEvent("upcoming", baseEvent({ status: "upcoming" })),
    });
    const summary = await h.run();
    expect(summary.scannedCount).toBe(4); // upcoming 不在掃描集合
    expect(summary.dueCount).toBe(0);
    expect(summary.scanSkippedByReason).toEqual({ not_due: 2, hours_off: 1, start_unknown: 1 });
    expect(h.fake.state.transactionAttempts).toBe(0);
    expect(h.fake.state.writes).toHaveLength(0);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "start_unknown", eventId: maskId("unknown") }));
  });

  test("每輪上限 20 場：先處理最早到點的，其餘留到下一輪", async () => {
    const seed = {};
    for (let i = 0; i < 22; i += 1) {
      // i 越大越早開始 → 越早到點
      const hour = 10 - Math.floor(i / 3);
      const minute = (i % 3) * 10;
      seed[`events/e${String(i).padStart(2, "0")}`] = baseEvent({
        id: `e${i}`, teamReservationSummaries: [],
        date: `2026/11/20 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}~12:00`,
      });
    }
    const h = createHarness(seed);
    const summary = await h.run();
    expect(summary).toMatchObject({ dueCount: 22, deferredCount: 2, lightweightCount: 20 });
    const untouched = Object.keys(seed).filter((p) => !h.fake.get(p).teamReservationReleasedAt).sort();
    expect(untouched).toEqual(["events/e01", "events/e02"]); // 10:10、10:20 開始的最晚到點
  });

  test("單場交易失敗只記錄並繼續下一場", async () => {
    const seed = {
      ...seedEvent("evtA", baseEvent({ teamReservationSummaries: [] })),
      ...seedEvent("evtB", baseEvent({ teamReservationSummaries: [] })),
    };
    const h = createHarness(seed);
    const realRun = h.deps.db.runTransaction;
    let calls = 0;
    h.deps.db.runTransaction = async (cb) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("boom"), { code: 13 });
      return realRun(cb);
    };
    const handler = createReleaseTeamReservationsHandler(h.deps);
    const summary = await handler({});
    expect(summary).toMatchObject({ failedCount: 1, lightweightCount: 1 });
    expect(h.logger.error).toHaveBeenCalledWith(expect.objectContaining({
      fn: "releaseTeamReservations", stage: "transaction", eventId: maskId("evtA"), errorCode: "13",
    }));
    expect(h.fake.get("events/evtB").teamReservationReleasedAt).toBeInstanceOf(FakeTimestamp);
  });
});

describe("過期回寫偵測（已釋出後又出現預留）", () => {
  const RELEASED_AT_MS = NOW_MS - HOUR;

  test("項目 updatedAt 早於 releasedAt（舊站快取回寫）→ 再釋出，releasedAt 不變、摘要併入、次數 +1", async () => {
    const event = baseEvent({
      teamReservationReleasedAt: FakeTimestamp.fromMillis(RELEASED_AT_MS),
      teamReservationReleasedSummary: [{ teamId: "teamA", teamName: "A 隊", releasedSlots: 2 }],
      teamReservationSummaries: [
        { teamId: "teamA", teamName: "A 隊", reservedSlots: 3, usedSlots: 1, updatedAt: "2026-11-01T00:00:00.000Z" },
      ],
    });
    const h = createHarness(seedEvent("evtA", event, standardRegs(), standardArs()));
    const summary = await h.run();
    expect(summary).toMatchObject({ releasedCount: 1, rereleasedCount: 1, promotedCount: 2 });
    const stored = h.fake.get("events/evtA");
    expect(stored.teamReservationReleasedAt.toMillis()).toBe(RELEASED_AT_MS);
    expect(stored.teamReservationReleasedSummary).toEqual([{ teamId: "teamA", teamName: "A 隊", releasedSlots: 4 }]);
    expect(stored.teamReservationReleaseCount).toBe(2);
    expect(stored.teamReservationSummaries[0]).toMatchObject({ reservedSlots: 0, usedSlots: 1 });
    expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "rerelease_stale_writeback" }));
    const log = h.fake.get(`operationLogs/${h.fake.list("operationLogs")[0]}`);
    expect(log.meta.rerelease).toBe(true);
  });

  test("項目 updatedAt 晚於 releasedAt（釋出後手動再預留）→ 只 warn、不進交易、不寫入", async () => {
    const event = baseEvent({
      teamReservationReleasedAt: FakeTimestamp.fromMillis(RELEASED_AT_MS),
      teamReservationReleasedSummary: [{ teamId: "teamA", teamName: "A 隊", releasedSlots: 2 }],
      teamReservationSummaries: [
        { teamId: "teamA", teamName: "A 隊", reservedSlots: 3, usedSlots: 1, updatedAt: new Date(RELEASED_AT_MS + 60000).toISOString() },
      ],
    });
    const h = createHarness(seedEvent("evtA", event, standardRegs(), standardArs()));
    const summary = await h.run();
    expect(summary).toMatchObject({ dueCount: 0, releasedCount: 0, scanSkippedByReason: { rereserved_after_release: 1 } });
    expect(h.fake.state.transactionAttempts).toBe(0);
    expect(h.fake.state.writes).toHaveLength(0);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({
      reason: "rereserved_after_release", eventIds: [maskId("evtA")], count: 1,
    }));
  });

  test("掃描時是過期回寫、交易前被手動再預留蓋掉 → 交易內 skip 並 warn", async () => {
    const event = baseEvent({
      teamReservationReleasedAt: FakeTimestamp.fromMillis(RELEASED_AT_MS),
      teamReservationSummaries: [{ teamId: "teamA", teamName: "A 隊", reservedSlots: 3, usedSlots: 1, updatedAt: "2026-11-01T00:00:00.000Z" }],
    });
    const h = createHarness(seedEvent("evtA", event, standardRegs(), standardArs()), {
      afterScan: (fake) => fake.put("events/evtA", {
        ...fake.get("events/evtA"),
        teamReservationSummaries: [{ teamId: "teamA", teamName: "A 隊", reservedSlots: 3, usedSlots: 1, updatedAt: new Date(NOW_MS).toISOString() }],
      }),
    });
    const summary = await h.run();
    expect(summary.skippedByReason).toEqual({ rereserved_after_release: 1 });
    expect(h.fake.state.writes).toHaveLength(0);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ stage: "transaction", reason: "rereserved_after_release" }));
  });
});

describe("functions/index.js 接線", () => {
  test("releaseTeamReservations 以真實 index.js helper 執行一輪並釋出", async () => {
    const { exports: fnExports, harness } = loadFunctionsIndex();
    expect(typeof fnExports.releaseTeamReservations).toBe("function");
    // 以真實時鐘排一場 6 小時後開始、12 小時前釋出的活動（台北時間字串）。
    const startTaipei = new Date(Date.now() + 6 * HOUR + 8 * HOUR);
    const pad = (n) => String(n).padStart(2, "0");
    const date = `${startTaipei.getUTCFullYear()}/${pad(startTaipei.getUTCMonth() + 1)}/${pad(startTaipei.getUTCDate())} `
      + `${pad(startTaipei.getUTCHours())}:${pad(startTaipei.getUTCMinutes())}~23:59`;
    harness.current = createFakeFirestore(seedEvent("evtA", baseEvent({ date }), standardRegs(), standardArs()));
    await fnExports.releaseTeamReservations({});
    const stored = harness.current.get("events/evtA");
    expect(stored.teamReservationReleasedSummary).toEqual([{ teamId: "teamA", teamName: "A 隊", releasedSlots: 2 }]);
    expect(harness.current.get("events/evtA/registrations/w2").status).toBe("confirmed");
    expect(harness.current.list("operationLogs")).toHaveLength(1);
  });
});
