"use strict";

const { createHarness, registration, expectRejected } = require("./event-roster-status-helpers");
const { SERVER_TS } = require("./team-callable-fake-db");
const { createPlanRosterStatus } = require("../../functions/event-roster-status-plan");
const { planAttendanceConfirm, computeCompleteActivityTargets } = require("../../functions/event-attendance-confirm");

describe("T-070 名單交易與投影", () => {
  test("U5 降級三處原子寫入、時間欄位與完整投影", async () => {
    const h = createHarness();
    const result = await h.invoke();
    expect(result).toEqual({
      success: true, demoted: 1, current: 0, waitlist: 1, status: "open",
      event: {
        current: 0, realCurrent: 0, waitlist: 1, status: "open",
        participants: [], waitlistNames: ["測試甲"], participantsWithUid: [],
        waitlistWithUid: [{
          uid: "uidA", name: "測試甲", teamKey: null, teamReservationTeamId: null,
          teamReservationTeamName: null, teamSeatSource: null,
        }], teamReservationSummaries: [],
      },
    });
    expect(h.fake.get("events/evtA/registrations/regA")).toEqual({
      ...registration(), status: "waitlisted", demotedAt: SERVER_TS, updatedAt: SERVER_TS, waitlistSortAt: SERVER_TS,
    });
    expect(h.fake.get("events/evtA/activityRecords/arA").status).toBe("waitlisted");
    expect(h.fake.get("events/evtA")).toEqual({ ...h.seed["events/evtA"], ...result.event, schemaVersion: 2 });
    expect(h.fake.state.writes).toHaveLength(3);
    expect(h.fake.state.writes.every((write) => write.via === "tx" && write.commit === 1)).toBe(true);
  });

  test("U5-atomic 第二筆寫入失敗時所有名單與投影回滾", async () => {
    const h = createHarness();
    h.fake.state.failCommit = ({ ops }) => ops.length >= 2 ? new Error("second write failed") : null;
    await expectRejected(h, {}, "internal", "FORCE_DEMOTE_FAILED");
    for (const [path, data] of Object.entries(h.seed)) expect(h.fake.get(path)).toEqual(data);
    expect(h.fake.state.commits).toEqual([{ size: 3, ok: false }]);
  });

  test.each(["demote", "promote"])("U6/U16 %s 同組同行者全改、AR 只查及改本人", async (action) => {
    const status = action === "demote" ? "confirmed" : "waitlisted";
    const next = action === "demote" ? "waitlisted" : "confirmed";
    const h = createHarness({
      action, event: { max: 3 }, regs: [
        registration("regA", status),
        registration("regC1", status, { participantType: "companion", companionId: "comp_1", companionName: "同行甲" }),
        registration("regC2", status, { participantType: "companion", companionId: "comp_2", companionName: "同行乙" }),
      ],
      ars: [{ _docId: "arA", uid: "uidA", status: action === "demote" ? "registered" : "waitlisted" },
        { _docId: "arOther", uid: "uidOther", status: "registered" }],
    });
    h.deps.findActivityRecordForRegistration = jest.fn(h.helpers.findActivityRecordForRegistration);
    const result = await h.invoke(action === "promote" ? { registrationId: "regC1" } : {});
    expect(result[action === "demote" ? "demoted" : "promoted"]).toBe(3);
    for (const id of ["regA", "regC1", "regC2"]) {
      expect(h.fake.get("events/evtA/registrations/" + id).status).toBe(next);
    }
    expect(h.deps.findActivityRecordForRegistration).toHaveBeenCalledTimes(1);
    expect(h.fake.writesTo("events/evtA/activityRecords")).toHaveLength(1);
    expect(h.fake.get("events/evtA/activityRecords/arOther").status).toBe("registered");
    expect(h.deps.writeInboxNotification).toHaveBeenCalledTimes(1);
  });

  // 測試同步更新（2026-11-07 站長定案 F3）：原 U10「降級保留空位、不自動遞補」改為下放同交易遞補下一位、被下放者排候補最後。
  test("U10 降級同交易遞補下一位候補，被下放者排候補最後且不改原報名時間", async () => {
    const h = createHarness({ regs: [
      registration(),
      registration("regB", "waitlisted", { userId: "uidOther", userName: "測試乙", registeredAt: "2026-10-02T00:00:00.000Z" }),
    ], ars: [
      { _docId: "arA", uid: "uidA", status: "registered" },
      { _docId: "arB", uid: "uidOther", status: "waitlisted" },
    ] });
    const result = await h.invoke();
    expect(result).toMatchObject({ demoted: 1, current: 1, waitlist: 1, status: "full" });
    expect(result.event).toMatchObject({ participants: ["測試乙"], waitlistNames: ["測試甲"] });
    expect(h.fake.get("events/evtA/registrations/regA")).toMatchObject({
      status: "waitlisted", waitlistSortAt: SERVER_TS, registeredAt: "2026-10-01T00:00:00.000Z",
    });
    expect(h.fake.get("events/evtA/registrations/regB")).toMatchObject({
      status: "confirmed", promotedAt: SERVER_TS, updatedAt: SERVER_TS, registeredAt: "2026-10-02T00:00:00.000Z",
    });
    expect(h.fake.get("events/evtA/registrations/regB").waitlistSortAt).toBeUndefined();
    expect(h.fake.get("events/evtA/activityRecords/arA").status).toBe("waitlisted");
    expect(h.fake.get("events/evtA/activityRecords/arB").status).toBe("registered");
    expect(h.fake.state.writes.every((write) => write.via === "tx" && write.commit === 1)).toBe(true);
    expect(h.deps.writeInboxNotification).toHaveBeenCalledTimes(2);
    expect(h.deps.writeInboxNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUid: "uidOther", title: "候補遞補通知",
    }));
    expect(h.deps.adjustExpInternal).toHaveBeenCalledTimes(1);
    expect(h.deps.adjustExpInternal).toHaveBeenCalledWith(expect.objectContaining({
      targetUid: "uidOther", amount: 10, ruleKey: "register_activity", operatorUid: "uidB",
    }));
    expect(h.deps.writeAuditEntryInternal).toHaveBeenCalledWith(expect.objectContaining({
      meta: { registrationId: "regA", promotedRegistrationIds: ["regB"] },
    }));
  });

  test("F3 下放後遞補順序：先補原候補，被下放者排在下放前已在候補的人之後", () => {
    const h = createHarness();
    const regs = [
      registration("regA", "confirmed"),
      registration("regB", "waitlisted", { userId: "uidB2", userName: "測試乙", registeredAt: "2026-10-02T00:00:00.000Z" }),
      registration("regC", "waitlisted", { userId: "uidC", userName: "測試丙", registeredAt: "2026-10-03T00:00:00.000Z" }),
    ];
    const plan = createPlanRosterStatus(h.deps)({
      action: "demote", eventData: { id: "evtA", status: "full", max: 1 }, registrations: regs,
      activityRecords: [], userId: "uidA", nowMs: Date.parse("2026-10-05T00:00:00.000Z"),
    });
    expect(plan.promotedUpdates.map((item) => item.docId)).toEqual(["regB"]);
    expect(plan.occupancy.waitlistNames).toEqual(["測試丙", "測試甲"]);
    const demoted = plan.regs.find((reg) => reg._docId === "regA");
    expect(demoted).toMatchObject({ registeredAt: "2026-10-01T00:00:00.000Z", waitlistSortAt: "2026-10-05T00:00:00.000Z" });
    // 之後有人取消釋出一個名額：先遞補丙，被下放的甲排在丙之後
    const afterCancel = plan.regs.map((reg) => (reg._docId === "regB" ? { ...reg, status: "cancelled" } : { ...reg }));
    expect(h.helpers.promoteWaitlistForAvailableSeats({ max: 1 }, afterCancel).map((reg) => reg._docId)).toEqual(["regC"]);
    // 下放後才報名的人仍排在被下放者之後
    const late = registration("regD", "waitlisted", { userId: "uidD", userName: "測試丁", registeredAt: "2026-10-06T00:00:00.000Z" });
    const withLate = [...afterCancel.filter((reg) => reg._docId !== "regC"), late];
    expect(h.helpers.promoteWaitlistForAvailableSeats({ max: 1 }, withLate).map((reg) => reg._docId)).toEqual(["regA"]);
  });

  test("F3 沒有其他候補時名額空著，被下放者本人與其同行者不會立刻被補回", async () => {
    const h = createHarness({ event: { max: 2 }, regs: [
      registration("regA", "confirmed"),
      registration("regC1", "waitlisted", { participantType: "companion", companionId: "comp_1", companionName: "同行甲" }),
    ] });
    const result = await h.invoke();
    expect(result).toMatchObject({ current: 0, waitlist: 2 });
    expect(h.fake.get("events/evtA/registrations/regC1").status).toBe("waitlisted");
    expect(h.deps.adjustExpInternal).not.toHaveBeenCalled();
    expect(h.deps.writeInboxNotification).toHaveBeenCalledTimes(1);
  });

  test("F3 已結束活動的事後下放不遞補", async () => {
    const h = createHarness({ event: { status: "ended" }, regs: [
      registration(), registration("regB", "waitlisted", { userId: "uidOther", userName: "測試乙" }),
    ] });
    await h.invoke();
    expect(h.fake.get("events/evtA/registrations/regB").status).toBe("waitlisted");
    expect(h.deps.adjustExpInternal).not.toHaveBeenCalled();
  });

  test("F3 只空一席時遞補本人、同行者留候補；通知與 EXP 不重複", async () => {
    const h = createHarness({ event: { max: 3 }, regs: [
      registration("regA", "confirmed"),
      registration("regX", "confirmed", { userId: "uidX", userName: "測試戊" }),
      registration("regY", "confirmed", { userId: "uidY", userName: "測試己" }),
      registration("regB", "waitlisted", { userId: "uidOther", userName: "測試乙", registeredAt: "2026-10-02T00:00:00.000Z" }),
      registration("regB1", "waitlisted", {
        userId: "uidOther", userName: "測試乙", participantType: "companion", companionId: "comp_b", companionName: "同行乙",
        registeredAt: "2026-10-02T00:00:00.000Z", promotionOrder: 1,
      }),
    ] });
    // 只空出一席：遞補本人，同行者留在候補
    await h.invoke();
    expect(h.fake.get("events/evtA/registrations/regB").status).toBe("confirmed");
    expect(h.fake.get("events/evtA/registrations/regB1").status).toBe("waitlisted");
    expect(h.deps.writeInboxNotification).toHaveBeenCalledTimes(2);
    expect(h.deps.adjustExpInternal).toHaveBeenCalledTimes(1);
  });

  test("U11/U17 強制正取重建完整投影、不自動挑人、不發 EXP、不改 teamSeatSource", async () => {
    const h = createHarness({ action: "promote", regs: [registration("regA", "waitlisted", { teamSeatSource: "reserved" })] });
    const result = await h.invoke();
    expect(result).toMatchObject({ success: true, promoted: 1, current: 1, waitlist: 0, status: "full", overCapacity: false });
    expect(result.event).toMatchObject({
      participants: ["測試甲"], waitlistNames: [], realCurrent: 1,
      participantsWithUid: [expect.objectContaining({ uid: "uidA", name: "測試甲", teamSeatSource: "reserved" })],
      waitlistWithUid: [], teamReservationSummaries: [],
    });
    expect(h.fake.get("events/evtA/registrations/regA")).toMatchObject({
      status: "confirmed", promotedAt: SERVER_TS, updatedAt: SERVER_TS, teamSeatSource: "reserved",
    });
    expect(h.fake.writesTo("events/evtA/registrations")[0].data).toEqual({
      status: "confirmed", promotedAt: SERVER_TS, updatedAt: SERVER_TS,
    });
    expect(h.fake.get("events/evtA/activityRecords/arA").status).toBe("registered");
    expect(h.fake.get("events/evtA")).toEqual({ ...h.seed["events/evtA"], ...result.event, schemaVersion: 2 });
    expect(h.fake.state.writes.every((write) => write.via === "tx" && write.commit === 1)).toBe(true);
    expect(h.deps.promoteWaitlistForAvailableSeats).not.toHaveBeenCalled();
    expect(h.deps.adjustExpInternal).not.toHaveBeenCalled();
  });

  test("U14 明確允許且具權限才可超收", async () => {
    const h = createHarness({ action: "promote", regs: [
      registration("regA", "waitlisted"), registration("regB", "confirmed", { userId: "uidOther", userName: "測試乙" }),
    ] });
    expect(await h.invoke({ allowOverCapacity: true })).toMatchObject({ current: 2, overCapacity: true, status: "full" });
  });

  test.each([0, -1])("U15 max=%s 無上限正取不做超收限制", async (max) => {
    const h = createHarness({ action: "promote", event: { max } });
    expect(await h.invoke()).toMatchObject({ promoted: 1, current: 1, overCapacity: false, status: "open" });
  });

  test.each(["demote", "promote"])("U27/U28 %s 保持 upcoming／ended／cancelled", async (action) => {
    for (const status of ["upcoming", "ended", "cancelled"]) {
      const h = createHarness({ action, event: { status } });
      expect(await h.invoke()).toMatchObject({ status, event: { status } });
      expect(h.fake.get("events/evtA").status).toBe(status);
    }
  });

  test("U25/U26 Timestamp 正規化排序，副本模擬不改原始資料", () => {
    const h = createHarness();
    const timestamp = { toDate: () => new Date("2026-10-02T00:00:00.000Z") };
    const regs = [registration("regA", "confirmed", { registeredAt: timestamp }),
      registration("regB", "waitlisted", { userId: "uidOther", userName: "測試乙" })];
    const event = { id: "evtA", status: "full", max: 1, teamReservationSummaries: [] };
    const ars = [{ _docId: "arA", uid: "uidA", status: "registered" }];
    Object.freeze(event.teamReservationSummaries);
    [event, ...regs, ...ars, regs, ars].forEach(Object.freeze);
    const plan = createPlanRosterStatus(h.deps)({
      action: "demote", eventData: event, registrations: regs, activityRecords: ars, userId: "uidA",
    });
    expect(plan.regs[0].registeredAt).toBe("2026-10-02T00:00:00.000Z");
    // 測試同步更新（F3）：下放同交易遞補乙，甲排候補
    expect(plan.occupancy.participants).toEqual(["測試乙"]);
    expect(plan.occupancy.waitlistNames).toEqual(["測試甲"]);
    expect(regs[0].registeredAt).toBe(timestamp);
    expect(regs[0].status).toBe("confirmed");
    expect(ars[0].status).toBe("registered");
    expect(event.status).toBe("full");
  });

  test("§16.1(a) 降級後確認出席的 people/adds/removes/EXP 都排除該人", async () => {
    const h = createHarness();
    await h.invoke();
    const regs = [h.fake.get("events/evtA/registrations/regA")];
    const currentRecords = [{ _docId: "attA", uid: "uidA", type: "checkin" },
      { _docId: "attB", uid: "uidA", type: "checkout" }];
    for (const checkin of [true, false]) {
      const plan = planAttendanceConfirm({
        eventData: h.fake.get("events/evtA"), registrations: regs, currentRecords,
        desired: { uidA: { checkin, checkout: checkin } }, nowMs: 1, timeStr: "2026/11/01 10:00",
      });
      expect(plan).toMatchObject({ people: [], adds: [], removes: [], expTargets: [], skipped: [] });
      expect(computeCompleteActivityTargets(plan.people, currentRecords, plan)).toEqual([]);
    }
  });

  test("§16.1(b)(c) 已簽到的 ended 活動降級，出席與鎖定紀錄零寫入", async () => {
    const extraSeed = {
      "events/evtA/attendanceRecords/attA": { uid: "uidA", type: "checkin", status: "active" },
      "events/evtA/registrationLocks/self_uidA": { registrationId: "regA" },
      "users/uidA": { completedEvents: 4 },
    };
    const h = createHarness({ event: { status: "ended" }, extraSeed });
    expect(await h.invoke()).toMatchObject({ status: "ended" });
    for (const [path, data] of Object.entries(extraSeed)) expect(h.fake.get(path)).toEqual(data);
    expect(h.fake.state.writes.map((write) => write.path).sort()).toEqual([
      "events/evtA", "events/evtA/activityRecords/arA", "events/evtA/registrations/regA",
    ]);
  });

  test("團隊保留席位由真 helper 保留，不以手動人數覆蓋", async () => {
    const h = createHarness({ event: { max: 3, teamReservationSummaries: [{ teamId: "teamA", reservedSlots: 2 }] } });
    const result = await h.invoke();
    expect(result).toMatchObject({ current: 2, waitlist: 1, event: { realCurrent: 0 } });
    expect(result.event.teamReservationSummaries).toEqual([
      expect.objectContaining({ teamId: "teamA", reservedSlots: 2, usedSlots: 0, remainingSlots: 2 }),
    ]);
  });

  test("SDK ABORTED 重試後只提交一次，通知與 audit 各一次", async () => {
    const h = createHarness();
    h.fake.state.abortTransactions = 1;
    await h.invoke();
    expect(h.fake.state.transactionAttempts).toBe(2);
    expect(h.fake.state.writes).toHaveLength(3);
    expect(h.deps.writeInboxNotification).toHaveBeenCalledTimes(1);
    expect(h.deps.writeAuditEntryInternal).toHaveBeenCalledTimes(1);
  });
});
