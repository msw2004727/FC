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
      ...registration(), status: "waitlisted", demotedAt: SERVER_TS, updatedAt: SERVER_TS,
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

  test("U10 降級保留空位，不自動遞補既有候補", async () => {
    const h = createHarness({ regs: [
      registration(), registration("regB", "waitlisted", { userId: "uidOther", userName: "測試乙" }),
    ] });
    const result = await h.invoke();
    expect(result).toMatchObject({ current: 0, waitlist: 2 });
    expect(h.fake.get("events/evtA/registrations/regB").status).toBe("waitlisted");
    expect(h.fake.writesTo("events/evtA/registrations")).toHaveLength(1);
    expect(h.deps.promoteWaitlistForAvailableSeats).not.toHaveBeenCalled();
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
    expect(plan.occupancy.waitlistNames).toEqual(["測試乙", "測試甲"]);
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
