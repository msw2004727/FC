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
  ]);
  const {
    HttpsError, rebuildOccupancy, preserveUpcomingEventOccupancyStatus,
    findActivityRecordForRegistration, isCourseLinkedEventData, isCourseLinkedRegistrationData,
  } = dependencies;

  return function planRosterStatus({ action, eventData, registrations, activityRecords, userId, registrationId }) {
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

    // 指定同一主報名者的整組紀錄；不挑下一位、不改席位來源或原始報名時間。
    const targetIds = new Set(targets.map((reg) => reg._docId));
    const regs = registrations.map((reg) => ({
      ...reg,
      registeredAt: reg.registeredAt?.toDate?.()?.toISOString?.() || reg.registeredAt,
      status: targetIds.has(reg._docId) ? nextStatus : reg.status,
    }));
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
      recipientUid: targets[0].userId,
      registrationId: requested?._docId || targets.find((reg) => reg.participantType !== "companion")?._docId || targets[0]._docId,
    };
  };
}

module.exports = { createPlanRosterStatus, requireFunctions };
