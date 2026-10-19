"use strict";

// 舊站表單與 Rules 都沒有人數上限；此處 10000 只是伺服器邊界的防呆（R-EXEC-011），可由工廠參數覆寫。
const DEFAULT_MAX_EVENT_CAPACITY = 10000;

function normalizeNonNegativeInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.floor(num));
}

function normalizeRegisteredAtValue(raw) {
  return raw?.toDate?.()?.toISOString?.() || raw;
}

function defaultFindActivityRecordForRegistration(records = [], reg = {}, requiredStatus = "") {
  if (!reg || reg.participantType === "companion") return null;
  const uid = String(reg.userId || "").trim();
  if (!uid) return null;
  const list = Array.isArray(records) ? records : [];
  return list.find((ar) => {
    if (!ar || String(ar.uid || "").trim() !== uid) return false;
    if (requiredStatus && ar.status !== requiredStatus) return false;
    return true;
  }) || null;
}

function defaultIsCourseLinkedEventData(eventData = {}) {
  if (!eventData || typeof eventData !== "object") return false;
  return Boolean(
    eventData.courseLinkId
    || eventData.coursePlanId
    || eventData.courseSessionId
    || eventData.coursePriority === true
    || eventData.source === "edu_lesson"
    || eventData.courseLinkSource === "edu_lesson"
  );
}

/**
 * 建立純函式 planCapacityChange（強制透過依賴注入重用伺服器既有 helpers，不重寫演算法）
 */
function createPlanCapacityChange({
  promoteWaitlistForAvailableSeats,
  demoteConfirmedRegistrationsToCapacity,
  sortWaitlistCandidates,
  rebuildOccupancy,
  preserveUpcomingEventOccupancyStatus = (_ed, occ) => occ,
  findActivityRecordForRegistration = defaultFindActivityRecordForRegistration,
  normalizeTeamReservationSummaries = (ed) => (
    Array.isArray(ed?.teamReservationSummaries)
      ? ed.teamReservationSummaries.map((item) => ({ ...item }))
      : []
  ),
  registrationTeamReservationTeamId = (reg) => reg?.teamId || reg?.reservationTeamId || null,
} = {}) {
  if (typeof promoteWaitlistForAvailableSeats !== "function") {
    throw new TypeError("promoteWaitlistForAvailableSeats helper is required");
  }
  if (typeof demoteConfirmedRegistrationsToCapacity !== "function") {
    throw new TypeError("demoteConfirmedRegistrationsToCapacity helper is required");
  }
  if (typeof sortWaitlistCandidates !== "function") {
    throw new TypeError("sortWaitlistCandidates helper is required");
  }
  if (typeof rebuildOccupancy !== "function") {
    throw new TypeError("rebuildOccupancy helper is required");
  }

  return function planCapacityChange({
    eventData = {},
    registrations = [],
    activityRecords = [],
    newMax,
  } = {}) {
    const oldMax = normalizeNonNegativeInt(eventData?.max, 0);
    const targetMax = normalizeNonNegativeInt(newMax, 0);
    const wasUnlimited = oldMax <= 0;
    const isUnlimited = targetMax <= 0;
    const capacityIncreased = (!wasUnlimited && isUnlimited)
      || (!wasUnlimited && !isUnlimited && targetMax > oldMax);
    const capacityDecreased = (wasUnlimited && !isUnlimited)
      || (!wasUnlimited && !isUnlimited && targetMax < oldMax);

    // 副本模擬（R-REG-008 / R-REG-009 / R-REG-016）：深拷貝頂層並正規化 registeredAt Timestamp
    const simRegs = (Array.isArray(registrations) ? registrations : [])
      .filter((r) => r && (r.status === "confirmed" || r.status === "waitlisted"))
      .map((r) => ({
        ...r,
        registeredAt: normalizeRegisteredAtValue(r.registeredAt),
      }));

    const arSource = Array.isArray(activityRecords) ? activityRecords : [];
    let eventForRebuild = { ...eventData, max: targetMax, status: eventData?.status };

    const promoted = [];
    const demoted = [];
    const activityRecordUpdates = [];

    if (capacityIncreased) {
      const occupancyBefore = rebuildOccupancy(eventForRebuild, simRegs);
      if (isUnlimited || !occupancyBefore || occupancyBefore.current < targetMax) {
        const promotedSim = promoteWaitlistForAvailableSeats(eventForRebuild, simRegs);
        promoted.push(...promotedSim);
        for (const candidate of promotedSim) {
          // R-REG-007：同行者不動 activityRecord
          if (candidate.participantType !== "companion") {
            const ar = findActivityRecordForRegistration(arSource, candidate, "waitlisted");
            if (ar && ar._docId) {
              activityRecordUpdates.push({
                docId: ar._docId,
                uid: candidate.userId,
                status: "registered",
              });
            }
          }
        }
      }
    } else if (capacityDecreased) {
      const currentSummaries = normalizeTeamReservationSummaries(eventData).map((item) => ({ ...item }));
      eventForRebuild = {
        ...eventForRebuild,
        teamReservationSummaries: currentSummaries,
      };

      const rebuildNow = () => rebuildOccupancy(
        eventForRebuild,
        simRegs.filter((r) => r.status === "confirmed" || r.status === "waitlisted")
      );

      const occupancyBeforeDemote = rebuildNow();
      let overflowSlots = Math.max(0, Number(occupancyBeforeDemote?.current || 0) - targetMax);
      for (const summary of currentSummaries) {
        if (overflowSlots <= 0) break;
        const remaining = Math.max(0, Number(summary.remainingSlots || 0) || 0);
        if (remaining <= 0) continue;
        const reduceBy = Math.min(remaining, overflowSlots);
        summary.reservedSlots = Math.max(0, Number(summary.reservedSlots || 0) - reduceBy);
        summary.remainingSlots = Math.max(0, Number(summary.remainingSlots || 0) - reduceBy);
        summary.occupiedSlots = Math.max(Number(summary.reservedSlots || 0), Number(summary.usedSlots || 0));
        summary.updatedAt = new Date().toISOString();
        overflowSlots -= reduceBy;
      }
      eventForRebuild = {
        ...eventForRebuild,
        teamReservationSummaries: currentSummaries.filter(
          (item) => Number(item.reservedSlots || 0) > 0 || Number(item.usedSlots || 0) > 0
        ),
      };

      let currentOccupancy = rebuildNow();
      if (currentOccupancy && currentOccupancy.current > targetMax) {
        const demotedSim = demoteConfirmedRegistrationsToCapacity(eventForRebuild, simRegs);
        for (const sim of demotedSim) {
          demoted.push(sim);
          // R-REG-007：同行者不動 activityRecord
          if (sim.participantType !== "companion") {
            const ar = findActivityRecordForRegistration(arSource, sim, "registered");
            if (ar && ar._docId) {
              activityRecordUpdates.push({
                docId: ar._docId,
                uid: sim.userId,
                status: "waitlisted",
              });
            }
          }
          const beforeCurrent = currentOccupancy ? currentOccupancy.current : 0;
          currentOccupancy = rebuildNow();
          if (currentOccupancy && currentOccupancy.current >= beforeCurrent) {
            const teamId = registrationTeamReservationTeamId(sim);
            const summary = teamId
              ? eventForRebuild.teamReservationSummaries.find((item) => item.teamId === teamId)
              : null;
            if (summary && Number(summary.reservedSlots || 0) > 0) {
              summary.reservedSlots = Math.max(0, Number(summary.reservedSlots || 0) - 1);
              summary.remainingSlots = Math.max(0, Number(summary.remainingSlots || 0) - 1);
              summary.occupiedSlots = Math.max(Number(summary.reservedSlots || 0), Number(summary.usedSlots || 0));
              summary.updatedAt = new Date().toISOString();
              eventForRebuild.teamReservationSummaries = eventForRebuild.teamReservationSummaries.filter(
                (item) => Number(item.reservedSlots || 0) > 0 || Number(item.usedSlots || 0) > 0
              );
              currentOccupancy = rebuildNow();
            }
          }
        }
      }
    }

    const simActive = simRegs.filter((r) => r.status === "confirmed" || r.status === "waitlisted");
    const rawOccupancy = rebuildOccupancy(eventForRebuild, simActive);
    const occupancy = preserveUpcomingEventOccupancyStatus(eventForRebuild, rawOccupancy);

    const registrationUpdates = [
      ...promoted.map((r) => {
        const update = { status: "confirmed" };
        if (r.teamSeatSource) update.teamSeatSource = r.teamSeatSource;
        return { docId: r._docId, id: r.id, userId: r.userId, update };
      }),
      ...demoted.map((r) => ({
        docId: r._docId,
        id: r.id,
        userId: r.userId,
        update: { status: "waitlisted" },
      })),
    ];

    const eventUpdate = {
      max: targetMax,
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
      capacityIncreased,
      capacityDecreased,
      promoted,
      demoted,
      regs: simRegs,
      registrationUpdates,
      activityRecordUpdates,
      occupancy,
      eventUpdate,
    };
  };
}

/**
 * 預設的 planCapacityChange：若呼叫端直接在 opts 注入 helpers 則使用注入的，
 * 否則要求透過 createPlanCapacityChange 建立或於參數提供 helpers。
 */
function planCapacityChange(params = {}) {
  const {
    helpers = {},
    promoteWaitlistForAvailableSeats,
    demoteConfirmedRegistrationsToCapacity,
    sortWaitlistCandidates,
    rebuildOccupancy,
    preserveUpcomingEventOccupancyStatus,
    findActivityRecordForRegistration,
    normalizeTeamReservationSummaries,
    registrationTeamReservationTeamId,
  } = params;

  const planner = createPlanCapacityChange({
    promoteWaitlistForAvailableSeats: promoteWaitlistForAvailableSeats || helpers.promoteWaitlistForAvailableSeats,
    demoteConfirmedRegistrationsToCapacity: demoteConfirmedRegistrationsToCapacity || helpers.demoteConfirmedRegistrationsToCapacity,
    sortWaitlistCandidates: sortWaitlistCandidates || helpers.sortWaitlistCandidates,
    rebuildOccupancy: rebuildOccupancy || helpers.rebuildOccupancy,
    preserveUpcomingEventOccupancyStatus: preserveUpcomingEventOccupancyStatus || helpers.preserveUpcomingEventOccupancyStatus,
    findActivityRecordForRegistration: findActivityRecordForRegistration || helpers.findActivityRecordForRegistration,
    normalizeTeamReservationSummaries: normalizeTeamReservationSummaries || helpers.normalizeTeamReservationSummaries,
    registrationTeamReservationTeamId: registrationTeamReservationTeamId || helpers.registrationTeamReservationTeamId,
  });

  return planner(params);
}

async function defaultGetEventDocByPublicIdInTransaction(transaction, db, eventId) {
  const query = db.collection("events").where("id", "==", eventId).limit(1);
  const snap = await transaction.get(query);
  if (snap && Array.isArray(snap.docs) && snap.docs.length > 0) {
    return snap.docs[0];
  }
  return null;
}

function createAdjustEventCapacityHandler({
  HttpsError,
  db,
  FieldValue,
  getCallerAccessContext,
  canManageSingleEventRosterForAccess,
  getEventDocByPublicIdInTransaction,
  isCourseLinkedEventData = defaultIsCourseLinkedEventData,
  promoteWaitlistForAvailableSeats,
  demoteConfirmedRegistrationsToCapacity,
  sortWaitlistCandidates,
  rebuildOccupancy,
  preserveUpcomingEventOccupancyStatus,
  findActivityRecordForRegistration,
  normalizeTeamReservationSummaries,
  registrationTeamReservationTeamId,
  maxCapacityLimit = DEFAULT_MAX_EVENT_CAPACITY,
  logger = console,
}) {
  const planner = createPlanCapacityChange({
    promoteWaitlistForAvailableSeats,
    demoteConfirmedRegistrationsToCapacity,
    sortWaitlistCandidates,
    rebuildOccupancy,
    preserveUpcomingEventOccupancyStatus,
    findActivityRecordForRegistration,
    normalizeTeamReservationSummaries,
    registrationTeamReservationTeamId,
  });

  return async (request) => {
    if (!request?.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const callerUid = request.auth.uid;
    const { eventId, newMax } = request.data || {};

    if (typeof eventId !== "string" || !eventId.trim()) {
      throw new HttpsError("invalid-argument", "eventId is required");
    }
    const safeEventId = eventId.trim();

    if (
      typeof newMax !== "number"
      || !Number.isInteger(newMax)
      || newMax <= 0
      || newMax > maxCapacityLimit
    ) {
      throw new HttpsError(
        "invalid-argument",
        `newMax must be a positive integer between 1 and ${maxCapacityLimit}`
      );
    }

    const callerAccess = await getCallerAccessContext(request);

    try {
      const txResult = await db.runTransaction(async (transaction) => {
        // T1: 透過 public id 解析活動文件（R-ID-010）
        const eventDoc = typeof getEventDocByPublicIdInTransaction === "function"
          ? await getEventDocByPublicIdInTransaction(transaction, safeEventId)
          : await defaultGetEventDocByPublicIdInTransaction(transaction, db, safeEventId);

        if (!eventDoc || (typeof eventDoc.exists === "boolean" && !eventDoc.exists)) {
          throw new HttpsError("not-found", "EVENT_NOT_FOUND");
        }

        const eventRef = eventDoc.ref;
        const ed = eventDoc.data() || {};

        // 課程連結活動拒絕直接調整容量（照課程連結規則）
        if (isCourseLinkedEventData(ed)) {
          throw new HttpsError("failed-precondition", "COURSE_LINKED_EVENT_CAPACITY_LOCKED");
        }

        // T2: 讀取子集合 registrations & activityRecords（R-REG-014：不讀 root，且所有讀取在寫入前完成）
        const regsSnap = await transaction.get(eventRef.collection("registrations"));
        const allEventRegs = (regsSnap?.docs || []).map((d) => {
          const data = d.data() || {};
          return {
            ...data,
            _docId: d.id,
            registeredAt: normalizeRegisteredAtValue(data.registeredAt),
          };
        });

        const activeRegs = allEventRegs.filter(
          (r) => r.status === "confirmed" || r.status === "waitlisted"
        );

        // 權限檢查：照 cancelRegistration 的 capacity_change 規則使用 canManageSingleEventRosterForAccess
        const hasAccess = canManageSingleEventRosterForAccess(
          callerAccess,
          ed,
          callerUid,
          activeRegs
        );
        if (!hasAccess) {
          throw new HttpsError("permission-denied", "PERMISSION_DENIED");
        }

        const arSnap = await transaction.get(eventRef.collection("activityRecords"));
        const allArs = (arSnap?.docs || []).map((d) => ({
          ...(d.data() || {}),
          _docId: d.id,
        }));

        // T3: 計算變更
        const plan = planner({
          eventData: ed,
          registrations: activeRegs,
          activityRecords: allArs,
          newMax,
        });

        // T4: 一次寫入 registrations、activityRecords、event（max + occupancy 欄位）
        for (const regUpd of plan.registrationUpdates) {
          if (!regUpd.docId) continue;
          const payload = { ...regUpd.update };
          if (FieldValue && typeof FieldValue.serverTimestamp === "function") {
            payload.updatedAt = FieldValue.serverTimestamp();
            if (payload.status === "confirmed") {
              payload.promotedAt = FieldValue.serverTimestamp();
            }
          }
          transaction.update(eventRef.collection("registrations").doc(regUpd.docId), payload);
        }

        for (const arUpd of plan.activityRecordUpdates) {
          if (!arUpd.docId) continue;
          transaction.update(eventRef.collection("activityRecords").doc(arUpd.docId), {
            status: arUpd.status,
          });
        }

        const eventUpdatePayload = { ...plan.eventUpdate };
        Object.keys(eventUpdatePayload).forEach((key) => {
          if (eventUpdatePayload[key] === undefined) {
            delete eventUpdatePayload[key];
          }
        });
        transaction.update(eventRef, eventUpdatePayload);

        return {
          promoted: plan.promoted.length,
          demoted: plan.demoted.length,
          current: plan.occupancy.current,
          waitlist: plan.occupancy.waitlist,
        };
      });

      return {
        success: true,
        promoted: txResult.promoted,
        demoted: txResult.demoted,
        current: txResult.current,
        waitlist: txResult.waitlist,
      };
    } catch (err) {
      if (err instanceof HttpsError) {
        throw err;
      }
      // R-CF-002：結構化錯誤 log（僅含函式名、eventId 與錯誤碼，不印個資）後拋出 sanitized HttpsError
      logger.error(JSON.stringify({
        fn: "adjustEventCapacity",
        eventId: safeEventId,
        errorCode: err?.code || "unknown",
        message: err?.message || "Transaction failed",
      }));
      throw new HttpsError("internal", "CAPACITY_ADJUST_FAILED");
    }
  };
}

function createAdjustEventCapacityCallable({ onCall, ...dependencies }) {
  return onCall(
    { region: "asia-east1", timeoutSeconds: 30 },
    createAdjustEventCapacityHandler(dependencies)
  );
}

module.exports = {
   DEFAULT_MAX_EVENT_CAPACITY,
  createPlanCapacityChange,
  planCapacityChange,
  createAdjustEventCapacityHandler,
  createAdjustEventCapacityCallable,
};
