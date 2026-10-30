"use strict";

const vm = require("vm");
const { createHarness, access, indexSource } = require("./event-roster-status-helpers");
const { FieldValue } = require("./team-callable-fake-db");
const {
  createRosterRequestClaim, createForceDemoteCallable, createForcePromoteCallable,
} = require("../../functions/event-roster-status");

describe.each(["demote", "promote"])("%s 冪等與後置操作", (action) => {
  test("U19 同 requestId 第二次零寫入、零通知、零 audit", async () => {
    const h = createHarness({ action });
    await h.invoke({ requestId: "reqA" });
    const before = h.fake.state.writes.length;
    expect(await h.invoke({ requestId: "reqA" })).toEqual({ success: true, deduplicated: true });
    expect(h.fake.state.writes).toHaveLength(before);
    expect(h.fake.state.transactionAttempts).toBe(1);
    expect(h.deps.writeInboxNotification).toHaveBeenCalledTimes(1);
    expect(h.deps.writeAuditEntryInternal).toHaveBeenCalledTimes(1);
  });

  test("U20 已知限制：授權失敗仍吃掉 requestId，重送只回 deduplicated", async () => {
    const h = createHarness({ action, actor: access("user"), event: { creatorUid: "uidOther" } });
    await expect(h.invoke({ requestId: "reqA" })).rejects.toMatchObject({ code: "permission-denied" });
    h.deps.getCallerAccessContext.mockResolvedValue(access());
    expect(await h.invoke({ requestId: "reqA" })).toEqual({ success: true, deduplicated: true });
    expect(h.fake.state.writes).toEqual([]);
    expect(h.deps.writeInboxNotification).not.toHaveBeenCalled();
  });

  // 此案只驗向外 reject／throw 的 helper；既有內部吞錯與 raw log 的限制另列交付報告。
  test("U22 注入通知與 audit 外拋失敗不影響已提交結果，wrapper log 無原始個資", async () => {
    const h = createHarness({ action });
    const privateText = "uidA uidB 測試甲 secret-token";
    h.deps.writeInboxNotification.mockRejectedValue(Object.assign(new Error(privateText), { code: privateText }));
    h.deps.writeAuditEntryInternal.mockImplementation(() => { throw new Error(privateText); });
    expect(await h.invoke()).toMatchObject({ success: true });
    expect(h.deps.settleBestEffortPostCommitOps).toHaveBeenCalledTimes(1);
    expect(h.deps.logger.error).toHaveBeenCalled();
    const logs = JSON.stringify(h.deps.logger.error.mock.calls);
    for (const value of ["uidA", "uidB", "測試甲", "secret-token"]) expect(logs).not.toContain(value);
    expect(h.fake.state.writes).toHaveLength(3);
  });

  test("U22 settle helper 自身拋錯仍收齊 promises 並回成功", async () => {
    const h = createHarness({ action });
    h.deps.writeInboxNotification.mockRejectedValue(new Error("private"));
    h.deps.settleBestEffortPostCommitOps.mockRejectedValue(new Error("inspection failed"));
    expect(await h.invoke()).toMatchObject({ success: true });
    expect(h.deps.logger.error).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "POST_COMMIT_FAILED" }));
  });

  test("U23/U24 通知收件人由報名決定，模板與稽核形狀固定且只各一次", async () => {
    const h = createHarness({ action });
    await h.invoke({ recipientUid: "attacker", actorUid: "attacker", registrationId: "regA" });
    const fn = action === "demote" ? "forceDemoteToWaitlist" : "forcePromoteWaitlist";
    const details = "活動名稱：測試活動\n活動時間：2026/11/01\n活動地點：測試場地";
    const body = action === "demote"
      ? `因活動名額調整，您目前已改為候補狀態。\n\n${details}\n\n若後續有名額釋出，系統會再通知您。`
      : `恭喜！由於有人取消報名，您已從候補名單自動遞補為正式參加者。\n\n${details}\n\n請準時出席！`;
    expect(h.deps.writeInboxNotification).toHaveBeenCalledTimes(1);
    expect(h.deps.writeInboxNotification).toHaveBeenCalledWith({
      recipientUid: "uidA", title: action === "demote" ? "候補降級通知" : "候補遞補通知",
      body, category: "activity", categoryLabel: "活動",
    });
    expect(h.deps.writeAuditEntryInternal).toHaveBeenCalledTimes(1);
    expect(h.deps.writeAuditEntryInternal).toHaveBeenCalledWith({
      action: action === "demote" ? "event_waitlist_demote" : "event_waitlist_promote",
      targetType: "event", targetId: "evtA", targetLabel: "測試活動",
      result: "success", source: "cloud_function", meta: { registrationId: "regA" }, actorUid: "uidB",
    });
    expect(h.deps.settleBestEffortPostCommitOps).toHaveBeenCalledWith(fn, expect.any(Array));
    expect(h.fake.state.writes.some((write) => /operationLogs|linePushQueue|expLogs|attendanceRecords/.test(write.path))).toBe(false);
    expect(h.deps.logger.info).toHaveBeenCalledWith({
      fn, eventId: "ev***", errorCode: "OK", count: 1,
    });
  });

  test("U19 無 requestId 的第二次呼叫以狀態前置條件拒絕", async () => {
    const h = createHarness({ action });
    await h.invoke();
    await expect(h.invoke()).rejects.toMatchObject({
      code: "failed-precondition", message: action === "demote" ? "REGISTRATION_NOT_CONFIRMED" : "REGISTRATION_NOT_WAITLISTED",
    });
    expect(h.fake.state.writes).toHaveLength(3);
    expect(h.deps.writeAuditEntryInternal).toHaveBeenCalledTimes(1);
  });
});

describe("真實 dedupe create 契約（不擴充共用 fake db）", () => {
  function build(create = jest.fn(async () => undefined)) {
    const h = createHarness();
    const doc = jest.fn(() => ({ create }));
    const collection = jest.fn(() => ({ doc }));
    const fromDate = jest.fn((date) => ({ millis: date.getTime() }));
    const dependencies = { db: { collection }, FieldValue, Timestamp: { fromDate }, now: () => 1000, logger: h.deps.logger };
    return { claim: createRosterRequestClaim(dependencies), dependencies, collection, doc, create, fromDate };
  }

  test("requestId 先 create，TTL 十分鐘且操作者取登入者", async () => {
    const h = build();
    expect(await h.claim({ requestId: "reqA", callerUid: "uidB", fn: "forceDemoteToWaitlist" })).toBe(true);
    expect(h.collection).toHaveBeenCalledWith("_regDedupe");
    expect(h.doc).toHaveBeenCalledWith("reqA");
    expect(h.create).toHaveBeenCalledWith({
      callerUid: "uidB", createdAt: "SERVER_TS", expiresAt: { millis: 601000 },
    });
  });

  test.each([6, "already-exists"])("重複碼 %s 回 false", async (code) => {
    const h = build(jest.fn(async () => { throw { code }; }));
    expect(await h.claim({ requestId: "reqA", callerUid: "uidB", fn: "forcePromoteWaitlist" })).toBe(false);
  });

  test("其他 create 失敗沿用既有語意繼續，warn 只有函式名與固定碼", async () => {
    const h = build(jest.fn(async () => { throw new Error("uidA private"); }));
    expect(await h.claim({ requestId: "reqA", callerUid: "uidB", fn: "forceDemoteToWaitlist" })).toBe(true);
    expect(h.dependencies.logger.warn).toHaveBeenCalledWith({ fn: "forceDemoteToWaitlist", errorCode: "DEDUPE_CREATE_FAILED" });
  });

  test("沒帶 requestId 不建立無去重效果的文件", async () => {
    const h = build();
    expect(await h.claim({ requestId: "", callerUid: "uidB", fn: "forceDemoteToWaitlist" })).toBe(true);
    expect(h.collection).not.toHaveBeenCalled();
  });

  test("doc.create 缺依賴時 fail-closed，不當成一般儲存失敗繼續", async () => {
    const h = build();
    const claim = createRosterRequestClaim({
      ...h.dependencies, db: { collection: () => ({ doc: () => ({}) }) },
    });
    await expect(claim({ requestId: "reqA", callerUid: "uidB", fn: "forceDemoteToWaitlist" })).rejects.toThrow(TypeError);
    expect(h.dependencies.logger.warn).not.toHaveBeenCalled();
  });

  test("claim 工廠依賴缺值拒絕建立", () => {
    const h = build();
    for (const key of ["db", "FieldValue", "Timestamp", "now", "logger"]) {
      expect(() => createRosterRequestClaim({ ...h.dependencies, [key]: undefined })).toThrow();
    }
  });
});

test("index.js 兩支註冊確實注入真 helper，region/timeout 與既有 Callable 一致", () => {
  const h = createHarness();
  const onCall = jest.fn((options, handler) => ({ options, handler }));
  const sandbox = {
    ...h.deps, onCall, exports: {}, Date, Timestamp: { fromDate: (date) => date },
    maskRosterId: h.deps.maskId, createRosterRequestClaim: jest.fn(() => h.deps.claimRequestId),
    createForceDemoteCallable: jest.fn(createForceDemoteCallable),
    createForcePromoteCallable: jest.fn(createForcePromoteCallable),
  };
  for (const [name, factory] of [
    ["forceDemoteToWaitlist", "createForceDemoteCallable"],
    ["forcePromoteWaitlist", "createForcePromoteCallable"],
  ]) {
    const start = indexSource.indexOf("exports." + name + " = ");
    expect(start).toBeGreaterThan(-1);
    const block = indexSource.slice(start, indexSource.indexOf("\n});", start) + 4);
    vm.runInNewContext(block, sandbox);
    expect(sandbox.exports[name].options).toEqual({ region: "asia-east1", timeoutSeconds: 30 });
    const deps = sandbox[factory].mock.calls[0][0];
    for (const key of [
      "getCallerAccessContext", "getEventDocByPublicIdInTransaction", "canOperateEventSiteForAccess",
      "canRemoveConfirmedParticipantForAccess", "isCourseLinkedEventData", "isCourseLinkedRegistrationData",
      "rebuildOccupancy", "preserveUpcomingEventOccupancyStatus", "findActivityRecordForRegistration",
      "writeInboxNotification", "writeAuditEntryInternal", "settleBestEffortPostCommitOps", "sanitizeStr",
    ]) expect(deps[key]).toBe(h.deps[key]);
    expect(deps.maskId).toBe(h.deps.maskId);
    expect(deps.claimRequestId).toBe(h.deps.claimRequestId);
  }
  expect(onCall).toHaveBeenCalledTimes(2);
  expect(indexSource).toContain('require("./event-roster-status")');
  expect(indexSource).toContain('require("./team-membership-core")');
  expect(indexSource).toContain('"event_waitlist_demote"');
  expect(indexSource).toContain('"event_waitlist_promote"');
});

test("M19 claim 只能在登入與參數驗證後，且在交易之前", async () => {
  const h = createHarness();
  h.deps.claimRequestId.mockImplementation(async () => {
    expect(h.fake.state.transactionAttempts).toBe(0);
    return true;
  });
  await h.invoke({ requestId: "reqA" });
  expect(h.deps.claimRequestId).toHaveBeenCalledTimes(1);
});
