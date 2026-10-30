"use strict";

const { createHarness, registration, access } = require("./event-roster-status-helpers");

const SITE = "user.activity.site_operate";
const owner = { creatorUid: "uidB" };
const delegate = { creatorUid: "uidOther", delegateUids: ["uidB"] };
const outsider = { creatorUid: "uidOther", delegateUids: [] };
const matrix = [
  ["user 非 owner/delegate", access("user"), outsider, [false, false, false]],
  ["user owner 有 site_operate", access("user", [], [SITE]), owner, [true, true, true]],
  ["user owner 無 site_operate", access("user"), owner, [false, false, false]],
  ["user delegate 有 site_operate", access("user", [], [SITE]), delegate, [true, true, true]],
  ["user delegate 無 site_operate", access("user"), delegate, [false, true, false]],
  ["coach owner", access("coach"), owner, [true, true, true]],
  ["coach delegate", access("coach"), delegate, [true, true, true]],
  ["captain owner", access("captain"), owner, [true, true, true]],
  ["captain delegate", access("captain"), delegate, [true, true, true]],
  ["coach 非 owner/delegate", access("coach"), outsider, [false, false, false]],
  ["captain 非 owner/delegate", access("captain"), outsider, [false, false, false]],
  ["持 event.edit_all", access("user", ["event.edit_all"]), outsider, [true, true, true]],
  ["admin 有既有 event.edit_all", access("admin", ["event.edit_all"]), outsider, [true, true, true]],
  ["super_admin", access("super_admin"), outsider, [true, true, true]],
  ["私密活動非主辦 coach 即使有 edit_all", access("coach", ["event.edit_all"]), { ...outsider, privateEvent: true }, [false, false, false]],
  ["私密活動 admin 有 edit_all", access("admin", ["event.edit_all"]), { ...outsider, privateEvent: true }, [true, true, true]],
  ["entry 單獨不授予跨活動操作", access("user", ["activity.manage.entry"]), outsider, [false, false, false]],
  ["admin 無 edit_all 且非 scoped 仍拒絕（現行 helper）", access("admin"), outsider, [false, false, false]],
  ["scoped 只有 event.scan", access("user", ["event.scan"]), owner, [false, true, false]],
];

describe.each([
  ["demote", false, 0], ["promote", false, 1], ["promote", true, 2],
])("身分矩陣 action=%s overCapacity=%s", (action, overCapacity, column) => {
  test.each(matrix)("%s", async (_label, actor, event, expected) => {
    const regs = [registration("regA", action === "demote" ? "confirmed" : "waitlisted")];
    if (overCapacity) regs.push(registration("regB", "confirmed", { userId: "uidOther", userName: "測試乙" }));
    const h = createHarness({ action, actor, event, regs });
    if (expected[column]) {
      expect(await h.invoke({ allowOverCapacity: overCapacity })).toMatchObject({ success: true });
      expect(h.fake.state.writes.length).toBeGreaterThan(0);
    } else {
      await expect(h.invoke({ allowOverCapacity: overCapacity })).rejects.toMatchObject({
        code: "permission-denied", message: "PERMISSION_DENIED",
      });
      expect(h.fake.state.writes).toEqual([]);
      expect(h.deps.writeInboxNotification).not.toHaveBeenCalled();
      expect(h.deps.writeAuditEntryInternal).not.toHaveBeenCalled();
    }
  });
});

test.each(["user.activity.own_edit_basic", "user.activity.own_cancel"])(
  "編輯或取消 capability %s 不額外授予降級／超收", async (capability) => {
    for (const event of [owner, delegate]) {
      const h = createHarness({ actor: access("user", [], [capability]), event });
      await expect(h.invoke()).rejects.toMatchObject({ code: "permission-denied" });
      expect(h.fake.state.writes).toEqual([]);
    }
  },
);

test("U13 delegate 現場操作 fallback 可正取，但不足以超收", async () => {
  const h = createHarness({ action: "promote", actor: access("user"), event: delegate, regs: [
    registration("regA", "waitlisted"), registration("regB", "confirmed", { userId: "uidOther" }),
  ] });
  await expect(h.invoke({ allowOverCapacity: true })).rejects.toMatchObject({ code: "permission-denied" });
  expect(h.fake.state.writes).toEqual([]);
});

test.each(["demote", "promote"])("U21 %s 每次交易重驗最新 delegate 名單", async (action) => {
  const h = createHarness({
    action, actor: access("user", [], [SITE]), event: { ...delegate, max: 2 },
    regs: [registration("regA", action === "demote" ? "confirmed" : "waitlisted"),
      registration("regB", action === "demote" ? "confirmed" : "waitlisted", { userId: "uidOther" })],
  });
  await h.invoke();
  const count = h.fake.state.writes.length;
  h.fake.touch("events/evtA", { delegateUids: [] });
  await expect(h.invoke({ userId: "uidOther" })).rejects.toMatchObject({ code: "permission-denied" });
  expect(h.fake.state.writes).toHaveLength(count);
});

test("U21 角色脈絡取得後、交易讀取前撤銷 delegate 也拒絕", async () => {
  const h = createHarness({ actor: access("user", [], [SITE]), event: delegate });
  h.deps.getCallerAccessContext.mockImplementation(async () => {
    h.fake.touch("events/evtA", { delegateUids: [] });
    return access("user", [], [SITE]);
  });
  await expect(h.invoke()).rejects.toMatchObject({ code: "permission-denied" });
  expect(h.fake.state.writes).toEqual([]);
});
