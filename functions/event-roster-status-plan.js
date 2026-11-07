"use strict";

// 外部 helper 必須明確注入；缺值時不建立可執行的流程。
function requireFunctions(dependencies, names) {
  for (const name of names) {
    if (typeof dependencies?.[name] !== "function") throw new TypeError(`${name} helper is required`);
  }
}

function createPlanRosterStatus(dependencies) {
  requireFunctions(dependencies, [
    "HttpsError", "rebuildOccupancy", "preserveUpcomingEventOccupancyStatus",
    "findActivityRecordForRegistration", "isCourseLinkedEventData", "isCourseLinkedRegistrationData",
    "promoteWaitlistForAvailableSeats",
  ]);
  const {
    HttpsError, rebuildOccupancy, preserveUpcomingEventOccupancyStatus,
    findActivityRecordForRegistration, isCourseLinkedEventData, isCourseLinkedRegistrationData,
    promoteWaitlistForAvailableSeats,
  } = dependencies;

  return function planRosterStatus({ action, eventData, registrations, activityRecords, userId, registrationId, nowMs = Date.now() }) {
    if (!["demote", "promote"].includes(action)) throw new TypeError("Invalid roster action");
    const demote = action === "demote";
    const fromStatus = demote ? "confirmed" : "waitlisted";
    const nextStatus = demote ? "waitlisted" : "confirmed";
    const stateError = demote ? "REGISTRATION_NOT_CONFIRMED" : "REGISTRATION_NOT_WAITLISTED";
    const reject = (message) => { throw new HttpsError("failed-precondition", message, { code: message }); };
    if (isCourseLinkedEventData(eventData)) reject("COURSE_LINKED_USE_MANAGE_CALLABLE");

    const owned = registrations.filter((reg) => reg.userId === userId);
    const requested = registrationId
      ? registrations.find((reg) => reg._docId === registrationId)
        || registrations.find((reg) => reg.id === registrationId)
      : null;
    if (!owned.length || (registrationId && (!requested || requested.userId !== userId))) {
      throw new HttpsError("not-found", "REG_NOT_FOUND", { code: "REG_NOT_FOUND" });
    }
    const targets = owned.filter((reg) => reg.status === fromStatus);
    if ((requested && isCourseLinkedRegistrationData(requested)) || targets.some(isCourseLinkedRegistrationData)) {
      reject("COURSE_LINKED_USE_MANAGE_CALLABLE");
    }
    if (demote && requested?.participantType === "companion") reject("COMPANION_CANNOT_DEMOTE_ALONE");
    if (!targets.length || (requested && requested.status !== fromStatus)) reject(stateError);
    const maxCount = Math.max(0, Number(eventData.max || 0) || 0);
    if (demote && maxCount <= 0) reject("WAITLIST_DISABLED");

    // 指定同一主報名者的整組紀錄；不改席位來源或原始報名時間。
    // 下放（2026-11-07 站長定案 F3）：被下放者另寫 waitlistSortAt 排到候補最後，同交易把空出的名額依序遞補給其他候補。
    const targetIds = new Set(targets.map((reg) => reg._docId));
    const waitlistSortAt = new Date(nowMs).toISOString();
    const regs = registrations.map((reg) => ({
      ...reg,
      registeredAt: reg.registeredAt?.toDate?.()?.toISOString?.() || reg.registeredAt,
      ...(reg.waitlistSortAt ? { waitlistSortAt: reg.waitlistSortAt?.toDate?.()?.toISOString?.() || reg.waitlistSortAt } : {}),
      ...(demote && targetIds.has(reg._docId) ? { waitlistSortAt } : {}),
      status: targetIds.has(reg._docId) ? nextStatus : reg.status,
    }));
    // 被下放者本人的其他紀錄不參與這次遞補，避免下放後立刻被補回或只補回同行者；
    // 已結束／已取消的活動（事後名單更正）不遞補，避免事後多出正取與 EXP。
    const promoted = demote && !["ended", "cancelled"].includes(eventData.status)
      ? promoteWaitlistForAvailableSeats({ ...eventData }, regs.filter((reg) => reg.userId !== userId), {})
      : [];
    const overCapacity = !demote && maxCount > 0
      && regs.filter((reg) => reg.status === "confirmed").length > maxCount;
    const activityRecordUpdates = [];
    const seen = new Set();
    for (const reg of targets) {
      if (reg.participantType === "companion") continue;
      const ar = findActivityRecordForRegistration(activityRecords, reg, demote ? "registered" : "waitlisted");
      if (ar?._docId && !seen.has(ar._docId)) {
        seen.add(ar._docId);
        activityRecordUpdates.push({ docId: ar._docId, status: demote ? "waitlisted" : "registered" });
      }
    }
    for (const reg of promoted) {
      if (reg.participantType === "companion") continue;
      const ar = findActivityRecordForRegistration(activityRecords, reg, "waitlisted");
      if (ar?._docId && !seen.has(ar._docId)) {
        seen.add(ar._docId);
        activityRecordUpdates.push({ docId: ar._docId, status: "registered" });
      }
    }
    const occupancy = preserveUpcomingEventOccupancyStatus(
      eventData,
      rebuildOccupancy({ ...eventData }, regs.filter((reg) => ["confirmed", "waitlisted"].includes(reg.status))),
    );
    const eventUpdate = {
      current: occupancy.current,
      realCurrent: occupancy.realCurrent,
      waitlist: occupancy.waitlist,
      participants: occupancy.participants,
      waitlistNames: occupancy.waitlistNames,
      participantsWithUid: occupancy.participantsWithUid,
      waitlistWithUid: occupancy.waitlistWithUid,
      teamReservationSummaries: occupancy.teamReservationSummaries,
      schemaVersion: 2,
      status: occupancy.status,
    };
    return {
      regs, occupancy, eventUpdate, overCapacity, activityRecordUpdates,
      registrationUpdates: targets.map((reg) => ({ docId: reg._docId, status: nextStatus })),
      promotedUpdates: promoted.map((reg) => {
        const extra = {};
        if (reg.teamSeatSource) extra.teamSeatSource = reg.teamSeatSource;
        if (isCourseLinkedRegistrationData(reg)) {
          extra.courseRosterOverride = "confirmed";
          extra.courseRosterOverrideSource = "capacity";
        }
        return {
          docId: reg._docId, userId: reg.userId, userName: reg.userName || "",
          participantType: reg.participantType || "self", courseLinked: isCourseLinkedRegistrationData(reg), extra,
        };
      }),
      recipientUid: targets[0].userId,
      registrationId: requested?._docId || targets.find((reg) => reg.participantType !== "companion")?._docId || targets[0]._docId,
    };
  };
}

module.exports = { createPlanRosterStatus, requireFunctions };
