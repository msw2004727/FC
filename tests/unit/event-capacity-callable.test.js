"use strict";

const {
  createPlanCapacityChange,
  createAdjustEventCapacityCallable,
} = require("../../functions/event-capacity");

// ═══════════════════════════════════════════════════════════════════════════
// 測試注入用 Server Helpers（與 server-helpers.js / a-waitlist-capacity.test.js 同構）
// ═══════════════════════════════════════════════════════════════════════════

function sortWaitlistCandidates(regs = []) {
  const sortTime = (reg) => {
    const v = reg && reg.registeredAt;
    if (!v) return Number.POSITIVE_INFINITY;
    if (typeof v.toMillis === "function") {
      try { return v.toMillis(); } catch (_e) { /* ignore */ }
    }
    if (typeof v === "object" && typeof v.seconds === "number") {
      return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1000000);
    }
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  return (Array.isArray(regs) ? regs : []).slice().sort((a, b) => {
    const ta = sortTime(a);
    const tb = sortTime(b);
    if (ta !== tb) return ta - tb;
    const pa = Number(a.promotionOrder || 0);
    const pb = Number(b.promotionOrder || 0);
    if (pa !== pb) return pa - pb;
    return String(a._docId || a.id || "").localeCompare(String(b._docId || b.id || ""));
  });
}

function rebuildOccupancy(event, registrations) {
  const confirmed = registrations.filter((r) => r.status === "confirmed");
  const waitlisted = registrations.filter((r) => r.status === "waitlisted");

  const regSortTime = (r) => {
    const v = r && r.registeredAt;
    if (!v) return Number.POSITIVE_INFINITY;
    if (typeof v.toMillis === "function") {
      try { return v.toMillis(); } catch (_e) { /* ignore */ }
    }
    if (typeof v === "object" && typeof v.seconds === "number") {
      return (v.seconds * 1000) + Math.floor((v.nanoseconds || 0) / 1000000);
    }
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  const regSort = (a, b) => {
    const ta = regSortTime(a);
    const tb = regSortTime(b);
    if (ta !== tb) return ta - tb;
    return String(a._docId || a.id || "").localeCompare(String(b._docId || b.id || ""));
  };
  confirmed.sort(regSort);
  waitlisted.sort(regSort);

  const participants = confirmed.map((r) =>
    r.participantType === "companion"
      ? String(r.companionName || r.userName || "").trim()
      : String(r.userName || "").trim()
  ).filter(Boolean);

  const waitlistNames = waitlisted.map((r) =>
    r.participantType === "companion"
      ? String(r.companionName || r.userName || "").trim()
      : String(r.userName || "").trim()
  ).filter(Boolean);

  const current = participants.length;
  const waitlist = waitlistNames.length;

  const maxCount = Math.max(0, Number(event?.max || 0) || 0);
  let status = event?.status || "open";
  if (status !== "ended" && status !== "cancelled") {
    status = maxCount > 0 && current >= maxCount ? "full" : "open";
  }
  return {
    participants,
    waitlistNames,
    participantsWithUid: confirmed.map((r) => ({ uid: r.userId, name: r.userName })),
    waitlistWithUid: waitlisted.map((r) => ({ uid: r.userId, name: r.userName })),
    teamReservationSummaries: event?.teamReservationSummaries || [],
    current,
    realCurrent: current,
    waitlist,
    status,
  };
}

function promoteWaitlistForAvailableSeats(eventData, simRegs = []) {
  const promoted = [];
  const maxCount = Math.max(0, Number(eventData?.max || 0) || 0);
  const unlimited = maxCount <= 0;

  while (true) {
    const activeRegs = simRegs.filter((r) => r.status === "confirmed" || r.status === "waitlisted");
    const occupancy = rebuildOccupancy(eventData, activeRegs);
    const waitlisted = sortWaitlistCandidates(activeRegs.filter((r) => r.status === "waitlisted"));

    let candidateToPromote = null;
    if (unlimited || occupancy.current < maxCount) {
      candidateToPromote = waitlisted[0] || null;
    }
    if (!candidateToPromote) break;
    candidateToPromote.status = "confirmed";
    promoted.push(candidateToPromote);
  }
  return promoted;
}

function demoteConfirmedRegistrationsToCapacity(eventData = {}, simRegs = []) {
  const maxCount = Math.max(0, Number(eventData.max || 0) || 0);
  const demoted = [];
  if (maxCount <= 0) return demoted;

  const regMillis = (r) => {
    const v = r?.registeredAt;
    if (!v) return Number.NEGATIVE_INFINITY;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };
  const compareDesc = (a, b) => {
    const td = regMillis(b) - regMillis(a);
    if (td) return td;
    const pd = Number(b.promotionOrder || 0) - Number(a.promotionOrder || 0);
    if (pd) return pd;
    return String(b._docId || b.id || "").localeCompare(String(a._docId || a.id || ""));
  };

  while (simRegs.filter((reg) => reg.status === "confirmed").length > maxCount) {
    const candidate = simRegs
      .filter((reg) => reg.status === "confirmed")
      .slice()
      .sort(compareDesc)[0] || null;
    if (!candidate) break;
    candidate.status = "waitlisted";
    demoted.push(candidate);
  }
  return demoted;
}

function preserveUpcomingEventOccupancyStatus(eventData, occupancy) {
  if (eventData?.status === "upcoming" && !["ended", "cancelled"].includes(occupancy?.status)) {
    return { ...(occupancy || {}), status: "upcoming" };
  }
  return occupancy;
}

const planCapacityChange = createPlanCapacityChange({
  promoteWaitlistForAvailableSeats,
  demoteConfirmedRegistrationsToCapacity,
  sortWaitlistCandidates,
  rebuildOccupancy,
  preserveUpcomingEventOccupancyStatus,
});

function runGoldenPlan(regs, oldMax, newMax, activityRecords = []) {
  return planCapacityChange({
    eventData: { id: "e1", max: oldMax, status: "open" },
    registrations: regs,
    activityRecords,
    newMax,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 1: Golden Tests（1:1 對應 a-waitlist-capacity.test.js 所有情境）
// ═══════════════════════════════════════════════════════════════════════════

describe("planCapacityChange — Golden Decision Logic (from a-waitlist-capacity.test.js)", () => {
  describe("Capacity increase (promotion)", () => {
    test("waitlisted candidates get promoted when capacity increases", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:01:00Z", promotionOrder: 0 },
        { id: "r3", _docId: "r3", userId: "u3", userName: "C", status: "waitlisted", participantType: "self", registeredAt: "2026-03-10T08:02:00Z", promotionOrder: 0 },
      ];
      const result = runGoldenPlan(regs, 2, 3);
      expect(result.promoted).toHaveLength(1);
      expect(result.promoted[0].userId).toBe("u3");
      expect(result.promoted[0].status).toBe("confirmed");
      expect(result.occupancy.current).toBe(3);
      expect(result.occupancy.waitlist).toBe(0);
    });

    test("promotes in registeredAt ASC order (earliest first)", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "waitlisted", participantType: "self", registeredAt: "2026-03-10T10:00:00Z", promotionOrder: 0 },
        { id: "r3", _docId: "r3", userId: "u3", userName: "C", status: "waitlisted", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 0 },
      ];
      const result = runGoldenPlan(regs, 1, 2);
      expect(result.promoted).toHaveLength(1);
      expect(result.promoted[0].userId).toBe("u3"); // 09:00 < 10:00
    });

    test("promotion tiebreaker: promotionOrder ASC", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "waitlisted", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 2 },
        { id: "r3", _docId: "r3", userId: "u3", userName: "C", status: "waitlisted", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 1 },
      ];
      const result = runGoldenPlan(regs, 1, 2);
      expect(result.promoted).toHaveLength(1);
      expect(result.promoted[0].userId).toBe("u3"); // promotionOrder 1 < 2
    });

    test("increase by more than waitlist count → all waitlisted promoted", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "waitlisted", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 0 },
        { id: "r3", _docId: "r3", userId: "u3", userName: "C", status: "waitlisted", participantType: "self", registeredAt: "2026-03-10T10:00:00Z", promotionOrder: 0 },
      ];
      const result = runGoldenPlan(regs, 1, 10);
      expect(result.promoted).toHaveLength(2);
      expect(result.occupancy.current).toBe(3);
      expect(result.occupancy.waitlist).toBe(0);
    });

    test("no promotion when already enough confirmed slots", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
      ];
      const result = runGoldenPlan(regs, 2, 3);
      expect(result.promoted).toHaveLength(0);
    });

    test("increase does not promote if slotsAvailable <= 0", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:01:00Z", promotionOrder: 0 },
        { id: "r3", _docId: "r3", userId: "u3", userName: "C", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:02:00Z", promotionOrder: 0 },
        { id: "r4", _docId: "r4", userId: "u4", userName: "D", status: "waitlisted", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 0 },
      ];
      const result = runGoldenPlan(regs, 2, 3);
      expect(result.promoted).toHaveLength(0);
    });
  });

  describe("Unlimited capacity transitions", () => {
    test("changing a limited event to max=0 promotes every waitlisted registration", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", registeredAt: "2026-03-10T08:00:00Z" },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "waitlisted", registeredAt: "2026-03-10T09:00:00Z" },
        { id: "r3", _docId: "r3", userId: "u3", userName: "C", status: "waitlisted", registeredAt: "2026-03-10T10:00:00Z" },
      ];
      const result = runGoldenPlan(regs, 1, 0);
      expect(result.promoted.map((reg) => reg.id)).toEqual(["r2", "r3"]);
      expect(result.demoted).toHaveLength(0);
      expect(result.occupancy).toMatchObject({ current: 3, waitlist: 0, status: "open" });
    });

    test("changing unlimited capacity to a finite max demotes only the excess", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", registeredAt: "2026-03-10T08:00:00Z" },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "confirmed", registeredAt: "2026-03-10T09:00:00Z" },
        { id: "r3", _docId: "r3", userId: "u3", userName: "C", status: "confirmed", registeredAt: "2026-03-10T10:00:00Z" },
      ];
      const result = runGoldenPlan(regs, 0, 2);
      expect(result.promoted).toHaveLength(0);
      expect(result.demoted.map((reg) => reg.id)).toEqual(["r3"]);
      expect(result.occupancy).toMatchObject({ current: 2, waitlist: 1, status: "full" });
    });
  });

  describe("Capacity decrease (demotion)", () => {
    test("latest confirmed get demoted when capacity decreases", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:01:00Z", promotionOrder: 0 },
        { id: "r3", _docId: "r3", userId: "u3", userName: "C", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:02:00Z", promotionOrder: 0 },
      ];
      const result = runGoldenPlan(regs, 3, 2);
      expect(result.demoted).toHaveLength(1);
      expect(result.demoted[0].userId).toBe("u3");
      expect(result.demoted[0].status).toBe("waitlisted");
      expect(result.occupancy.current).toBe(2);
      expect(result.occupancy.waitlist).toBe(1);
    });

    test("demotes in registeredAt DESC order (latest first)", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T10:00:00Z", promotionOrder: 0 },
        { id: "r3", _docId: "r3", userId: "u3", userName: "C", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 0 },
      ];
      const result = runGoldenPlan(regs, 3, 1);
      expect(result.demoted).toHaveLength(2);
      expect(result.demoted[0].userId).toBe("u2"); // 10:00 (latest)
      expect(result.demoted[1].userId).toBe("u3"); // 09:00
    });

    test("demotion tiebreaker: promotionOrder DESC", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 1 },
        { id: "r3", _docId: "r3", userId: "u3", userName: "C", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 3 },
        { id: "r4", _docId: "r4", userId: "u4", userName: "D", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 2 },
      ];
      const result = runGoldenPlan(regs, 4, 2);
      expect(result.demoted).toHaveLength(2);
      expect(result.demoted[0].userId).toBe("u3"); // promotionOrder 3
      expect(result.demoted[1].userId).toBe("u4"); // promotionOrder 2
    });

    test("decrease below current confirmed count demotes excess", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:01:00Z", promotionOrder: 0 },
        { id: "r3", _docId: "r3", userId: "u3", userName: "C", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:02:00Z", promotionOrder: 0 },
      ];
      const result = runGoldenPlan(regs, 3, 1);
      expect(result.demoted).toHaveLength(2);
      expect(result.occupancy.current).toBe(1);
      expect(result.occupancy.waitlist).toBe(2);
    });

    test("no demotion when confirmed count is within new capacity", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
      ];
      const result = runGoldenPlan(regs, 5, 3);
      expect(result.demoted).toHaveLength(0);
    });
  });

  describe("Capacity unchanged", () => {
    test("no changes when newMax equals oldMax", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "waitlisted", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 0 },
      ];
      const result = runGoldenPlan(regs, 1, 1);
      expect(result.promoted).toHaveLength(0);
      expect(result.demoted).toHaveLength(0);
    });
  });

  describe("Edge cases & R-REG-007 / R-REG-009", () => {
    test("empty registrations — increase does nothing", () => {
      const result = runGoldenPlan([], 2, 5);
      expect(result.promoted).toHaveLength(0);
      expect(result.demoted).toHaveLength(0);
    });

    test("empty registrations — decrease does nothing", () => {
      const result = runGoldenPlan([], 5, 2);
      expect(result.promoted).toHaveLength(0);
      expect(result.demoted).toHaveLength(0);
    });

    test("does not mutate original registrations array", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "waitlisted", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 0 },
      ];
      const originalStatus = regs[1].status;
      runGoldenPlan(regs, 1, 2);
      expect(regs[1].status).toBe(originalStatus);
    });

    test("companion registrations are included in promotion, but excluded from activityRecordUpdates (R-REG-007)", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u1", userName: "A", status: "waitlisted", participantType: "companion", companionName: "Comp", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 1 },
        { id: "r3", _docId: "r3", userId: "u2", userName: "B", status: "waitlisted", participantType: "self", registeredAt: "2026-03-10T08:05:00Z", promotionOrder: 0 },
      ];
      const ars = [
        { _docId: "ar_u1", uid: "u1", status: "waitlisted" },
        { _docId: "ar_u2", uid: "u2", status: "waitlisted" },
      ];
      const result = runGoldenPlan(regs, 1, 3, ars);
      expect(result.promoted).toHaveLength(2);
      expect(result.promoted[0].participantType).toBe("companion");
      expect(result.activityRecordUpdates).toEqual([
        { docId: "ar_u2", uid: "u2", status: "registered" },
      ]);
    });

    test("companion registrations are included in demotion, but excluded from activityRecordUpdates (R-REG-007)", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u1", userName: "A", status: "confirmed", participantType: "companion", companionName: "Comp", registeredAt: "2026-03-10T08:01:00Z", promotionOrder: 1 },
      ];
      const ars = [{ _docId: "ar_u1", uid: "u1", status: "registered" }];
      const result = runGoldenPlan(regs, 2, 1, ars);
      expect(result.demoted).toHaveLength(1);
      expect(result.demoted[0].participantType).toBe("companion");
      expect(result.activityRecordUpdates).toHaveLength(0);
    });

    test("occupancy status reflects full when at capacity after promotion", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "waitlisted", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 0 },
      ];
      const result = runGoldenPlan(regs, 1, 2);
      expect(result.occupancy.status).toBe("full");
      expect(result.occupancy.current).toBe(2);
    });

    test("occupancy status reflects full when at capacity after demotion", () => {
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:01:00Z", promotionOrder: 0 },
      ];
      const result = runGoldenPlan(regs, 2, 1);
      expect(result.occupancy.status).toBe("full");
      expect(result.occupancy.current).toBe(1);
      expect(result.occupancy.waitlist).toBe(1);
    });

    test("Firestore Timestamp registeredAt is converted to ISO before sorting (R-REG-009)", () => {
      const makeTs = (iso) => ({ toDate: () => new Date(iso) });
      const regs = [
        { id: "r1", _docId: "r1", userId: "u1", userName: "A", status: "confirmed", participantType: "self", registeredAt: makeTs("2026-03-10T08:00:00Z"), promotionOrder: 0 },
        { id: "r2", _docId: "r2", userId: "u2", userName: "B", status: "waitlisted", participantType: "self", registeredAt: makeTs("2026-03-10T10:00:00Z"), promotionOrder: 0 },
        { id: "r3", _docId: "r3", userId: "u3", userName: "C", status: "waitlisted", participantType: "self", registeredAt: makeTs("2026-03-10T09:00:00Z"), promotionOrder: 0 },
      ];
      const result = runGoldenPlan(regs, 1, 2);
      expect(result.promoted).toHaveLength(1);
      expect(result.promoted[0].userId).toBe("u3");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 2: Callable Tests（權限、eventId 解析、課程連結拒絕、newMax 驗證、Transaction 寫入）
// ═══════════════════════════════════════════════════════════════════════════

class MockHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function buildFakeEnvironment({
  eventDocId = "event_doc_123",
  eventData = { id: "ce_public_1", title: "Test Event", max: 2, status: "open" },
  registrations = [],
  activityRecords = [],
  hasRosterAccess = true,
  isCourseLinked = false,
} = {}) {
  const updates = [];
  const reads = [];

  const makeDocRef = (path) => ({
    path,
    collection: (subName) => ({
      path: `${path}/${subName}`,
      doc: (subDocId) => makeDocRef(`${path}/${subName}/${subDocId}`),
    }),
  });

  const eventRef = makeDocRef(`events/${eventDocId}`);
  const eventDoc = eventData
    ? {
        id: eventDocId,
        exists: true,
        ref: eventRef,
        data: () => ({ ...eventData }),
      }
    : null;

  const transaction = {
    get: jest.fn(async (target) => {
      reads.push(target.path || "query");
      if (target.path === `events/${eventDocId}/registrations`) {
        return {
          docs: registrations.map((r) => ({
            id: r._docId || r.id,
            data: () => ({ ...r }),
          })),
        };
      }
      if (target.path === `events/${eventDocId}/activityRecords`) {
        return {
          docs: activityRecords.map((a) => ({
            id: a._docId || a.id,
            data: () => ({ ...a }),
          })),
        };
      }
      throw new Error(`Unexpected transaction.get path: ${target.path}`);
    }),
    update: jest.fn((ref, data) => {
      updates.push({ path: ref.path, data });
    }),
  };

  const db = {
    runTransaction: jest.fn(async (fn) => fn(transaction)),
  };

  const getEventDocByPublicIdInTransaction = jest.fn(async (_tx, publicId) => {
    reads.push(`events?id==${publicId}`);
    if (!eventDoc || eventData.id !== publicId) return null;
    return eventDoc;
  });

  let capturedOptions = null;
  const onCall = (opts, handler) => {
    capturedOptions = opts;
    return handler;
  };

  const callable = createAdjustEventCapacityCallable({
    onCall,
    HttpsError: MockHttpsError,
    db,
    FieldValue: { serverTimestamp: () => "SERVER_TS" },
    getCallerAccessContext: jest.fn(async () => ({ role: "coach", isSuperAdmin: false })),
    canManageSingleEventRosterForAccess: jest.fn(() => hasRosterAccess),
    getEventDocByPublicIdInTransaction,
    isCourseLinkedEventData: jest.fn(() => isCourseLinked),
    promoteWaitlistForAvailableSeats,
    demoteConfirmedRegistrationsToCapacity,
    sortWaitlistCandidates,
    rebuildOccupancy,
    preserveUpcomingEventOccupancyStatus,
    logger: { error: jest.fn() },
  });

  return {
    callable,
    capturedOptions,
    updates,
    reads,
    getEventDocByPublicIdInTransaction,
  };
}

describe("adjustEventCapacity Callable", () => {
  test("configures asia-east1 region", () => {
    const { capturedOptions } = buildFakeEnvironment();
    expect(capturedOptions).toMatchObject({ region: "asia-east1" });
  });

  test("rejects unauthenticated caller", async () => {
    const { callable } = buildFakeEnvironment();
    await expect(callable({ auth: null, data: { eventId: "ce_public_1", newMax: 5 } }))
      .rejects.toMatchObject({ code: "unauthenticated" });
  });

  test("validates eventId and newMax (positive integer within bounds)", async () => {
    const { callable } = buildFakeEnvironment();
    const auth = { uid: "u_admin" };

    await expect(callable({ auth, data: { eventId: "", newMax: 5 } }))
      .rejects.toMatchObject({ code: "invalid-argument" });
    await expect(callable({ auth, data: { eventId: "ce_public_1", newMax: 0 } }))
      .rejects.toMatchObject({ code: "invalid-argument" });
    await expect(callable({ auth, data: { eventId: "ce_public_1", newMax: -3 } }))
      .rejects.toMatchObject({ code: "invalid-argument" });
    await expect(callable({ auth, data: { eventId: "ce_public_1", newMax: 2.5 } }))
      .rejects.toMatchObject({ code: "invalid-argument" });
    await expect(callable({ auth, data: { eventId: "ce_public_1", newMax: 999999 } }))
      .rejects.toMatchObject({ code: "invalid-argument" });
  });

  test("resolves eventId via public id and throws not-found if missing (R-ID-010)", async () => {
    const { callable, getEventDocByPublicIdInTransaction } = buildFakeEnvironment();
    await expect(
      callable({ auth: { uid: "u_admin" }, data: { eventId: "non_existent", newMax: 5 } })
    ).rejects.toMatchObject({ code: "not-found" });
    expect(getEventDocByPublicIdInTransaction).toHaveBeenCalledWith(expect.anything(), "non_existent");
  });

  test("rejects course-linked events", async () => {
    const { callable } = buildFakeEnvironment({ isCourseLinked: true });
    await expect(
      callable({ auth: { uid: "u_admin" }, data: { eventId: "ce_public_1", newMax: 5 } })
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  test("rejects caller without roster management permission (permission-denied)", async () => {
    const { callable } = buildFakeEnvironment({ hasRosterAccess: false });
    await expect(
      callable({ auth: { uid: "u_normal" }, data: { eventId: "ce_public_1", newMax: 5 } })
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("promotes waitlisted in transaction and writes subcollection registrations, activityRecords, and event occupancy", async () => {
    const registrations = [
      { _docId: "reg_1", id: "r1", userId: "u1", userName: "Alice", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
      { _docId: "reg_2", id: "r2", userId: "u2", userName: "Bob", status: "waitlisted", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 0 },
      { _docId: "reg_3", id: "r3", userId: "u2", userName: "Bob", companionName: "BobJr", status: "waitlisted", participantType: "companion", registeredAt: "2026-03-10T09:01:00Z", promotionOrder: 1 },
    ];
    const activityRecords = [
      { _docId: "ar_1", uid: "u1", status: "registered" },
      { _docId: "ar_2", uid: "u2", status: "waitlisted" },
    ];

    const { callable, updates, reads } = buildFakeEnvironment({
      eventDocId: "doc_abc",
      eventData: { id: "ce_public_1", title: "Match", max: 1, status: "full" },
      registrations,
      activityRecords,
    });

    const response = await callable({
      auth: { uid: "u_coach" },
      data: { eventId: "ce_public_1", newMax: 3 },
    });

    expect(response).toEqual({
      success: true,
      promoted: 2,
      demoted: 0,
      current: 3,
      waitlist: 0,
    });

    // R-REG-014：只讀子集合，不讀 root registrations / activityRecords
    expect(reads).toEqual([
      "events?id==ce_public_1",
      "events/doc_abc/registrations",
      "events/doc_abc/activityRecords",
    ]);

    // 寫入檢查：2 筆 registrations、1 筆 activityRecord（同行者不寫）、1 筆 event
    expect(updates).toEqual([
      {
        path: "events/doc_abc/registrations/reg_2",
        data: { status: "confirmed", updatedAt: "SERVER_TS", promotedAt: "SERVER_TS" },
      },
      {
        path: "events/doc_abc/registrations/reg_3",
        data: { status: "confirmed", updatedAt: "SERVER_TS", promotedAt: "SERVER_TS" },
      },
      {
        path: "events/doc_abc/activityRecords/ar_2",
        data: { status: "registered" },
      },
      {
        path: "events/doc_abc",
        data: {
          max: 3,
          current: 3,
          realCurrent: 3,
          waitlist: 0,
          participants: ["Alice", "Bob", "BobJr"],
          waitlistNames: [],
          participantsWithUid: [
            { uid: "u1", name: "Alice" },
            { uid: "u2", name: "Bob" },
            { uid: "u2", name: "Bob" },
          ],
          waitlistWithUid: [],
          teamReservationSummaries: [],
          schemaVersion: 2,
          status: "full",
        },
      },
    ]);
  });

  test("demotes excess confirmed in transaction when capacity decreases", async () => {
    const registrations = [
      { _docId: "reg_1", id: "r1", userId: "u1", userName: "Alice", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T08:00:00Z", promotionOrder: 0 },
      { _docId: "reg_2", id: "r2", userId: "u2", userName: "Bob", status: "confirmed", participantType: "self", registeredAt: "2026-03-10T09:00:00Z", promotionOrder: 0 },
    ];
    const activityRecords = [
      { _docId: "ar_1", uid: "u1", status: "registered" },
      { _docId: "ar_2", uid: "u2", status: "registered" },
    ];

    const { callable, updates } = buildFakeEnvironment({
      eventDocId: "doc_xyz",
      eventData: { id: "ce_public_1", title: "Match", max: 2, status: "full" },
      registrations,
      activityRecords,
    });

    const response = await callable({
      auth: { uid: "u_coach" },
      data: { eventId: "ce_public_1", newMax: 1 },
    });

    expect(response).toEqual({
      success: true,
      promoted: 0,
      demoted: 1,
      current: 1,
      waitlist: 1,
    });

    expect(updates).toEqual([
      {
        path: "events/doc_xyz/registrations/reg_2",
        data: { status: "waitlisted", updatedAt: "SERVER_TS" },
      },
      {
        path: "events/doc_xyz/activityRecords/ar_2",
        data: { status: "waitlisted" },
      },
      {
        path: "events/doc_xyz",
        data: expect.objectContaining({
          max: 1,
          current: 1,
          waitlist: 1,
          participants: ["Alice"],
          waitlistNames: ["Bob"],
          schemaVersion: 2,
          status: "full",
        }),
      },
    ]);
  });
});
