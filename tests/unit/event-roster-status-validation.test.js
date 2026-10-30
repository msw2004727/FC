"use strict";

const { createHarness, registration, expectRejected } = require("./event-roster-status-helpers");
const { createPlanRosterStatus } = require("../../functions/event-roster-status-plan");
const {
  createForceDemoteHandler, createForcePromoteHandler, createForceDemoteCallable, createForcePromoteCallable,
} = require("../../functions/event-roster-status");

describe.each(["demote", "promote"])("%s 輸入與狀態拒絕", (action) => {
  test("U1 未登入在 claim 前拒絕", async () => {
    const h = createHarness({ action });
    await expect(h.invoke({}, null)).rejects.toMatchObject({ code: "unauthenticated", message: "Authentication required" });
    expect(h.deps.claimRequestId).not.toHaveBeenCalled();
    expect(h.fake.state.writes).toEqual([]);
  });

  test.each([
    { eventId: undefined }, { userId: undefined }, { eventId: 1 }, { userId: {} },
    { eventId: "" }, { userId: "  " }, { eventId: "x".repeat(121) }, { userId: "x".repeat(129) },
    { registrationId: 12 }, { registrationId: "x".repeat(121) }, { requestId: "x".repeat(101) },
    { eventId: "a/b" }, { requestId: "a/b" }, { requestId: ".." }, { registrationId: null },
  ])("U2 拒絕非法參數 %j，claim 不先吃 requestId", async (data) => {
    const h = createHarness({ action });
    await expectRejected(h, { requestId: "reqA", ...data }, "invalid-argument", "eventId and userId are required");
    expect(h.deps.claimRequestId).not.toHaveBeenCalled();
  });

  test("U3 活動不存在時回 EVENT_NOT_FOUND", async () => {
    const h = createHarness({ action });
    h.fake.remove("events/evtA");
    await expectRejected(h, {}, "not-found", "EVENT_NOT_FOUND");
  });

  test.each(["evtA", "legacyDoc"])("U3/R-ID-010 %s 解析 canonical 與舊 public ID", async (eventDocId) => {
    const h = createHarness({ action, eventDocId });
    await h.invoke();
    expect(h.fake.state.writes.every((write) => write.path === h.eventPath || write.path.startsWith(h.eventPath + "/"))).toBe(true);
    expect(h.fake.writesTo("registrations/")).toEqual([]);
    expect(h.fake.writesTo("activityRecords/")).toEqual([]);
  });

  test("U3 direct doc 的 id 不相符時走 public ID fallback", async () => {
    const h = createHarness({ action, eventDocId: "legacyDoc", extraSeed: { "events/evtA": { id: "anotherEvent" } } });
    await h.invoke();
    expect(h.fake.writesTo("events/evtA")).toEqual([]);
    expect(h.fake.writesTo("events/legacyDoc").length).toBeGreaterThan(0);
  });

  test("U4 課程連動活動拒絕", async () => {
    const h = createHarness({ action, event: { courseLinked: true, courseLinkSource: "eduCourseLesson" } });
    await expectRejected(h, {}, "failed-precondition", "COURSE_LINKED_USE_MANAGE_CALLABLE");
  });

  test.each([
    { source: "eduCourseLesson" }, { courseLinkSource: "eduCourseLesson" },
    { courseLinkId: "linkA" }, { courseStudentId: "studentA" }, { coursePriority: true },
    { courseLinkState: "created_by_course" }, { courseLinkState: "priority_overlay" },
  ])("U4 課程報名標記 %j 拒絕", async (marker) => {
    const h = createHarness({ action, regs: [registration("regA", action === "demote" ? "confirmed" : "waitlisted", marker)] });
    await expectRejected(h, {}, "failed-precondition", "COURSE_LINKED_USE_MANAGE_CALLABLE");
  });

  test("U4 同組混有課程報名也不得部分提交", async () => {
    const state = action === "demote" ? "confirmed" : "waitlisted";
    const h = createHarness({ action, regs: [registration("regA", state),
      registration("regC", state, { participantType: "companion", companionId: "comp_1", courseStudentId: "studentA" })] });
    await expectRejected(h, {}, "failed-precondition", "COURSE_LINKED_USE_MANAGE_CALLABLE");
  });

  test.each(["cancelled", "removed", action === "demote" ? "waitlisted" : "confirmed"])(
    "U9/U18 狀態 %s 不符合前置條件", async (status) => {
      const h = createHarness({ action, regs: [registration("regA", status)] });
      await expectRejected(h, {}, "failed-precondition", action === "demote" ? "REGISTRATION_NOT_CONFIRMED" : "REGISTRATION_NOT_WAITLISTED");
    },
  );

  test.each([{ userId: "missing" }, { registrationId: "missing" }, { userId: "uidOther", registrationId: "regA" }])(
    "找不到指定主報名或 registrationId 不屬於 userId：%j", async (data) => {
      const h = createHarness({ action });
      await expectRejected(h, data, "not-found", "REG_NOT_FOUND");
    },
  );

  test("registrationId 可用既有 logical id，但寫入仍用真 docId", async () => {
    const h = createHarness({ action, regs: [registration("regA", action === "demote" ? "confirmed" : "waitlisted", { id: "publicRegA" })] });
    await h.invoke({ registrationId: "publicRegA" });
    expect(h.fake.writesTo("events/evtA/registrations")[0].path).toBe("events/evtA/registrations/regA");
  });

  test("無可同步的 AR 不捏造紀錄，錯誤狀態及其他 UID 不碰", async () => {
    const h = createHarness({ action, ars: [
      { _docId: "arA", uid: "uidA", status: "removed" },
      { _docId: "arB", uid: "uidOther", status: action === "demote" ? "registered" : "waitlisted" },
    ] });
    await h.invoke();
    expect(h.fake.writesTo("events/evtA/activityRecords")).toEqual([]);
  });

  test("非 HttpsError 轉 sanitized internal，不把原始訊息回傳", async () => {
    const h = createHarness({ action });
    h.deps.getCallerAccessContext.mockRejectedValue(new Error("sensitive uidA"));
    await expectRejected(h, {}, "internal", action === "demote" ? "FORCE_DEMOTE_FAILED" : "FORCE_PROMOTE_FAILED");
    expect(JSON.stringify(h.deps.logger.error.mock.calls)).not.toContain("uidA");
  });

  test("預期中的拒絕記 warn 不記 error，且錯誤帶 details.code", async () => {
    const h = createHarness({ action });
    h.fake.remove("events/evtA");
    await expect(h.invoke()).rejects.toMatchObject({ code: "not-found", details: { code: "EVENT_NOT_FOUND" } });
    expect(h.deps.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "not-found" }));
    expect(h.deps.logger.error).not.toHaveBeenCalled();
    const unauth = createHarness({ action });
    await expect(unauth.invoke({}, null)).rejects.toMatchObject({ details: { code: "UNAUTHENTICATED" } });
  });

  test("內部錯誤記 error 並附去敏後的錯誤碼，回傳錯誤帶 details.code", async () => {
    const h = createHarness({ action });
    const failure = Object.assign(new Error("sensitive uidA"), { code: "abort/ed 12!" });
    h.deps.getCallerAccessContext.mockRejectedValue(failure);
    const internalCode = action === "demote" ? "FORCE_DEMOTE_FAILED" : "FORCE_PROMOTE_FAILED";
    await expect(h.invoke()).rejects.toMatchObject({ code: "internal", details: { code: internalCode } });
    expect(h.deps.logger.error).toHaveBeenCalledWith(expect.objectContaining({ errorCode: internalCode, cause: "aborted12" }));
    expect(h.deps.logger.warn).not.toHaveBeenCalled();
    expect(JSON.stringify(h.deps.logger.error.mock.calls)).not.toContain("sensitive");
  });

  test("所有工廠相依缺值都 fail-closed", () => {
    const h = createHarness({ action });
    const make = action === "demote" ? createForceDemoteHandler : createForcePromoteHandler;
    for (const key of [
      "HttpsError", "rebuildOccupancy", "preserveUpcomingEventOccupancyStatus", "findActivityRecordForRegistration",
      "isCourseLinkedEventData", "isCourseLinkedRegistrationData", "getCallerAccessContext", "canOperateEventSiteForAccess",
      "canRemoveConfirmedParticipantForAccess", "getEventDocByPublicIdInTransaction", "sanitizeStr", "claimRequestId",
      "maskId", "writeInboxNotification", "writeAuditEntryInternal", "settleBestEffortPostCommitOps", "db", "FieldValue", "logger",
    ]) expect(() => make({ ...h.deps, [key]: undefined })).toThrow(TypeError);
    const callable = action === "demote" ? createForceDemoteCallable : createForcePromoteCallable;
    expect(() => callable({ ...h.deps })).toThrow("onCall helper is required");
    expect(() => createPlanRosterStatus({ ...h.deps, preserveUpcomingEventOccupancyStatus: undefined })).toThrow(TypeError);
  });
});

test.each([0, -1, undefined])("U7 max=%s 降級拒絕", async (max) => {
  await expectRejected(createHarness({ event: { max } }), {}, "failed-precondition", "WAITLIST_DISABLED");
});

test("U8 同行者 registrationId 不可單獨降級", async () => {
  const h = createHarness({ regs: [registration(), registration("regC", "confirmed", {
    participantType: "companion", companionId: "comp_1",
  })] });
  await expectRejected(h, { registrationId: "regC" }, "failed-precondition", "COMPANION_CANNOT_DEMOTE_ALONE");
});

test.each([undefined, false])("U12 超收 allowOverCapacity=%s 拒絕（不信 event.current）", async (allowOverCapacity) => {
  const h = createHarness({ action: "promote", event: { current: 0 }, regs: [
    registration("regA", "waitlisted"), registration("regB", "confirmed", { userId: "uidOther" }),
  ] });
  await expectRejected(h, { allowOverCapacity }, "failed-precondition", "CAPACITY_EXCEEDED");
});

test.each(["true", 1, null])("U2 allowOverCapacity=%j 型別錯誤", async (allowOverCapacity) => {
  const h = createHarness({ action: "promote" });
  await expectRejected(h, { allowOverCapacity }, "invalid-argument", "eventId and userId are required");
});

test("名額恰好填滿可成功，已有取消或移除不佔位", async () => {
  const h = createHarness({ action: "promote", regs: [
    registration("regA", "waitlisted"), registration("regB", "cancelled", { userId: "uidOther" }),
    registration("regC", "removed", { userId: "uidThird" }),
  ] });
  expect(await h.invoke()).toMatchObject({ current: 1, overCapacity: false });
});
