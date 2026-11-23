"use strict";

const fs = require("fs");
const path = require("path");
const lateCancel = require("../../functions/late-cancel");
const release = require("../../functions/team-reservation-release");

const NOW = Date.parse("2026-12-01T00:00:00+08:00");
const HOUR = 3600000;
const DAY = 86400000;
const SINCE = 0;

function reg(id, extra = {}) {
  return { _docId: id, id, status: "confirmed", ...extra };
}

function evaluate(overrides = {}) {
  return lateCancel.evaluateLateCancel({
    eventData: {},
    eventStartMs: NOW + HOUR,
    nowMs: NOW,
    cancelReason: "user_cancel",
    targetRegs: [reg("r1")],
    isCourseLinkedReg: () => false,
    sinceMs: SINCE,
    ...overrides,
  });
}

describe("normalizeLateCancelHours", () => {
  test.each([
    [{}, 2],
    [{ lateCancelHours: undefined }, 2],
    [null, 2],
    [undefined, 2],
    [{ lateCancelHours: 0 }, 0],
    [{ lateCancelHours: 2 }, 2],
    [{ lateCancelHours: 3 }, 3],
    [{ lateCancelHours: 6 }, 6],
    [{ lateCancelHours: 12 }, 12],
    [{ lateCancelHours: 24 }, 24],
    [{ lateCancelHours: 48 }, 48],
    [{ lateCancelHours: null }, 0],
    [{ lateCancelHours: "2" }, 0],
    [{ lateCancelHours: NaN }, 0],
    [{ lateCancelHours: -2 }, 0],
    [{ lateCancelHours: 1 }, 0],
    [{ lateCancelHours: 72 }, 0],
    [{ lateCancelHours: 2.5 }, 0],
  ])("%p -> %p", (event, expected) => {
    expect(lateCancel.normalizeLateCancelHours(event)).toBe(expected);
  });

  test("與團隊預留缺值語意不同，且不互相呼叫", () => {
    expect(release.normalizeReleaseHours(undefined)).toBe(0);
    expect(lateCancel.normalizeLateCancelHours({})).toBe(2);
    const source = fs.readFileSync(path.join(__dirname, "../../functions/late-cancel.js"), "utf8");
    expect(source).not.toContain("team-reservation-release");
    expect(source).not.toContain("normalizeReleaseHours");
  });
});

describe("isLateCancelEventEligible", () => {
  test("一般活動", () => {
    expect(lateCancel.isLateCancelEventEligible({})).toBe(true);
  });
  test("hours 0", () => {
    expect(lateCancel.isLateCancelEventEligible({ lateCancelHours: 0 })).toBe(false);
  });
  test("課程連結活動", () => {
    expect(lateCancel.isLateCancelEventEligible({ courseLinkId: "c1" })).toBe(false);
  });
  test("空 courseLinkId 視為一般活動", () => {
    expect(lateCancel.isLateCancelEventEligible({ courseLinkId: "" })).toBe(true);
    expect(lateCancel.isLateCancelEventEligible({ courseLinkId: "   " })).toBe(true);
  });
  test("取消活動", () => {
    expect(lateCancel.isLateCancelEventEligible({ status: "cancelled" })).toBe(false);
  });
});

describe("evaluateLateCancel", () => {
  test("正取、時限內", () => {
    const result = evaluate();
    expect(result).toEqual({ marked: true, markedRegDocIds: ["r1"], hours: 2 });
  });

  test("剛好等於時限算在內，多 1ms 不算", () => {
    expect(evaluate({ eventStartMs: NOW + 2 * HOUR }).marked).toBe(true);
    expect(evaluate({ eventStartMs: NOW + 2 * HOUR + 1 }).marked).toBe(false);
  });

  test("已開始不算", () => {
    expect(evaluate({ eventStartMs: NOW }).marked).toBe(false);
  });

  test("hours 0 不算；hours 6 且開始前 5 小時算", () => {
    expect(evaluate({ eventData: { lateCancelHours: 0 } }).marked).toBe(false);
    expect(evaluate({ eventData: { lateCancelHours: 6 }, eventStartMs: NOW + 5 * HOUR }).marked).toBe(true);
  });

  test("壞值不算", () => {
    expect(evaluate({ eventData: { lateCancelHours: null } }).marked).toBe(false);
    expect(evaluate({ eventData: { lateCancelHours: "6" } }).marked).toBe(false);
  });

  test("候補不算；本人候補＋同行者正取一起取消只收同行者", () => {
    expect(evaluate({ targetRegs: [reg("w", { status: "waitlisted" })] }).marked).toBe(false);
    const result = evaluate({
      targetRegs: [
        reg("w", { status: "waitlisted" }),
        reg("c", { participantType: "companion" }),
      ],
    });
    expect(result.marked).toBe(true);
    expect(result.markedRegDocIds).toEqual(["c"]);
  });

  test("課程連結報名不算", () => {
    expect(evaluate({ isCourseLinkedReg: (r) => r._docId === "r1" }).marked).toBe(false);
  });

  test("課程連結活動不算", () => {
    expect(evaluate({ eventData: { courseLinkId: "c1" } }).marked).toBe(false);
  });

  test("活動 cancelled 不算", () => {
    expect(evaluate({ eventData: { status: "cancelled" } }).marked).toBe(false);
  });

  test("起算點前不算，等於起算點算", () => {
    expect(evaluate({
      eventData: { lateCancelHours: 48 },
      eventStartMs: SINCE - 1,
      nowMs: SINCE - 2,
    }).marked).toBe(false);
    expect(evaluate({
      eventData: { lateCancelHours: 48 },
      eventStartMs: SINCE,
      nowMs: SINCE - 1,
    }).marked).toBe(true);
  });

  test("時限內遞補不算；時限外遞補算；剛好 cutoff 不算；壞值視為一般正取", () => {
    const start = NOW + HOUR;
    const cutoff = start - 2 * HOUR;
    expect(evaluate({ eventStartMs: start, targetRegs: [reg("r1", { promotedAt: { toMillis: () => cutoff } })] }).marked).toBe(false);
    expect(evaluate({ eventStartMs: start, targetRegs: [reg("r1", { promotedAt: { toMillis: () => cutoff + 1 } })] }).marked).toBe(false);
    expect(evaluate({ eventStartMs: start, targetRegs: [reg("r1", { promotedAt: { toMillis: () => cutoff - 1 } })] }).marked).toBe(true);
    expect(evaluate({ eventStartMs: start, targetRegs: [reg("r1", { promotedAt: "bad" })] }).marked).toBe(true);
  });

  test("非 user_cancel 不算", () => {
    expect(evaluate({ cancelReason: "manager_remove" }).marked).toBe(false);
    expect(evaluate({ cancelReason: "capacity_change" }).marked).toBe(false);
  });

  test("只取消同行者仍記同行者那筆", () => {
    const result = evaluate({ targetRegs: [reg("c", { participantType: "companion" })] });
    expect(result.markedRegDocIds).toEqual(["c"]);
  });

  test("NaN 開始時間不算", () => {
    expect(evaluate({ eventStartMs: NaN }).marked).toBe(false);
  });

  test("缺 isCourseLinkedReg 丟 TypeError", () => {
    expect(() => evaluate({ isCourseLinkedReg: undefined })).toThrow(TypeError);
  });

  test("不改輸入", () => {
    const frozen = Object.freeze([Object.freeze(reg("r1"))]);
    expect(() => evaluate({ targetRegs: frozen })).not.toThrow();
  });
});

describe("computeLateCancelUserPatch", () => {
  test("全新用戶 black", () => {
    const patch = lateCancel.computeLateCancelUserPatch({ userData: {}, attendedCount: 0, nowMs: NOW });
    expect(patch).toEqual({
      lateCancelLevel: "black",
      lateCancelUntilMs: NOW + 7 * DAY,
      lateCancelReleaseAt: 3,
      lateCancelRecentMs: [NOW],
      lateCancelTotal: 1,
    });
  });

  test("黑標生效中再犯累加", () => {
    const patch = lateCancel.computeLateCancelUserPatch({
      userData: {
        lateCancelLevel: "black",
        lateCancelUntil: { toMillis: () => NOW + DAY },
        lateCancelReleaseAt: 5,
        lateCancelTotal: 2,
      },
      attendedCount: 1,
      nowMs: NOW,
    });
    expect(patch.lateCancelUntilMs).toBe(NOW + 8 * DAY);
    expect(patch.lateCancelReleaseAt).toBe(8);
  });

  test("黑標過期重新起算", () => {
    const patch = lateCancel.computeLateCancelUserPatch({
      userData: {
        lateCancelLevel: "black",
        lateCancelUntil: { toMillis: () => NOW - 1 },
        lateCancelReleaseAt: 9,
      },
      attendedCount: 2,
      nowMs: NOW,
    });
    expect(patch.lateCancelUntilMs).toBe(NOW + 7 * DAY);
    expect(patch.lateCancelReleaseAt).toBe(5);
  });

  test("時間未到但出席達標視為解除", () => {
    const patch = lateCancel.computeLateCancelUserPatch({
      userData: {
        lateCancelLevel: "black",
        lateCancelUntil: { toMillis: () => NOW + DAY },
        lateCancelReleaseAt: 1,
      },
      attendedCount: 1,
      nowMs: NOW,
    });
    expect(patch.lateCancelUntilMs).toBe(NOW + 7 * DAY);
    expect(patch.lateCancelReleaseAt).toBe(4);
  });

  test("90 天內第 3 次 red，且不寫 until/releaseAt", () => {
    const patch = lateCancel.computeLateCancelUserPatch({
      userData: {
        lateCancelLevel: "black",
        lateCancelRecent: [NOW - DAY, NOW - 2 * DAY],
        lateCancelUntil: { toMillis: () => NOW + DAY },
        lateCancelReleaseAt: 3,
      },
      attendedCount: 0,
      nowMs: NOW,
    });
    expect(patch.lateCancelLevel).toBe("red");
    expect(patch).not.toHaveProperty("lateCancelUntilMs");
    expect(patch).not.toHaveProperty("lateCancelReleaseAt");
    expect(patch.lateCancelRecentMs).toHaveLength(3);
  });

  test("已是 red 再犯仍 red、total+1", () => {
    const patch = lateCancel.computeLateCancelUserPatch({
      userData: { lateCancelLevel: "red", lateCancelTotal: 3, lateCancelRecent: [NOW - DAY] },
      attendedCount: 0,
      nowMs: NOW,
    });
    expect(patch.lateCancelLevel).toBe("red");
    expect(patch.lateCancelTotal).toBe(4);
  });

  test("91 天前與剛好 90 天前剔除", () => {
    const patch = lateCancel.computeLateCancelUserPatch({
      userData: {
        lateCancelRecent: [NOW - 91 * DAY, NOW - 90 * DAY],
      },
      attendedCount: 0,
      nowMs: NOW,
    });
    expect(patch.lateCancelRecentMs).toEqual([NOW]);
  });

  test("recent 最多 5 筆（含本次）", () => {
    const patch = lateCancel.computeLateCancelUserPatch({
      userData: {
        lateCancelRecent: [NOW - 5 * DAY, NOW - 4 * DAY, NOW - 3 * DAY, NOW - 2 * DAY, NOW - DAY],
      },
      attendedCount: 0,
      nowMs: NOW,
    });
    expect(patch.lateCancelRecentMs).toHaveLength(5);
    expect(patch.lateCancelRecentMs[4]).toBe(NOW);
  });

  test("recent 壞值忽略", () => {
    const patch = lateCancel.computeLateCancelUserPatch({
      userData: { lateCancelRecent: ["bad", null, { sentinel: true }, NOW - DAY] },
      attendedCount: 0,
      nowMs: NOW,
    });
    expect(patch.lateCancelRecentMs).toEqual([NOW - DAY, NOW]);
  });

  test("attendedCount 缺值／負數／字串當 0", () => {
    expect(lateCancel.computeLateCancelUserPatch({ userData: {}, attendedCount: -1, nowMs: NOW }).lateCancelReleaseAt).toBe(3);
    expect(lateCancel.computeLateCancelUserPatch({ userData: {}, attendedCount: "2", nowMs: NOW }).lateCancelReleaseAt).toBe(3);
  });

  test("total 缺值／壞值從 0 起算", () => {
    expect(lateCancel.computeLateCancelUserPatch({ userData: { lateCancelTotal: -1 }, attendedCount: 0, nowMs: NOW }).lateCancelTotal).toBe(1);
    expect(lateCancel.computeLateCancelUserPatch({ userData: { lateCancelTotal: "3" }, attendedCount: 0, nowMs: NOW }).lateCancelTotal).toBe(1);
  });

  test("紅標解除後再犯為 black、total 續加", () => {
    const patch = lateCancel.computeLateCancelUserPatch({
      userData: { lateCancelLevel: null, lateCancelRecent: [], lateCancelTotal: 3 },
      attendedCount: 0,
      nowMs: NOW,
    });
    expect(patch.lateCancelLevel).toBe("black");
    expect(patch.lateCancelTotal).toBe(4);
  });
});

describe("buildLateCancelMarkId", () => {
  test("正常", () => {
    expect(lateCancel.buildLateCancelMarkId("e1", "u1")).toBe("e1_u1");
  });
  test("空字串或非字串回 null", () => {
    expect(lateCancel.buildLateCancelMarkId("", "u1")).toBeNull();
    expect(lateCancel.buildLateCancelMarkId("e1", "")).toBeNull();
    expect(lateCancel.buildLateCancelMarkId(1, "u1")).toBeNull();
  });
});
