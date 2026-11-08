"use strict";

// 團隊預留自動釋出（計畫 team-reservation-auto-release-plan v2.1 批 1）。
// 活動開始前 N 小時，把各團隊尚未用掉的預留席位歸 0（真釋出：已用的人保留座位），
// 依既有 promoteWaitlistForAvailableSeats 順序遞補候補，並寫釋出終態。
// 純函式不寫 cache、不呼 API、不改輸入（R-REG-004）；Firestore 與 index.js 內的 helper 一律由呼叫端注入。

const TEAM_RESERVATION_RELEASE_HOURS = Object.freeze([0, 3, 6, 12, 24, 48, 72]);
const RELEASE_SCAN_STATUSES = Object.freeze(["open", "full"]);
const RELEASE_MAX_EVENTS_PER_RUN = 20;
const RELEASE_SYSTEM_UID = "system";
const RELEASE_SYSTEM_NAME = "系統自動釋出";
const HOUR_MS = 60 * 60 * 1000;
const TAIPEI_OFFSET_MS = 8 * HOUR_MS;

// 只接受 A／B 表單產生的 `YYYY/M/D H:mm[:ss][~...]`；只有日期、全形「～」、亂字時間都不算（批 0 ⑦）。
const STRICT_EVENT_DATE_RE = /^\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*~.*)?\s*$/;

// 跨 realm（vm／測試沙箱）時 instanceof Date 不可靠，改用內部標籤判斷。
function isValidDate(value) {
  return Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime());
}

function requireFunctions(dependencies, names) {
  for (const name of names) {
    if (typeof dependencies?.[name] !== "function") throw new TypeError(`${name} helper is required`);
  }
}

// 欄位缺省、非數字或不在允許集合一律視為 0（不自動釋出）；伺服器不補預設（計畫 §3.1）。
function normalizeReleaseHours(value) {
  return typeof value === "number" && TEAM_RESERVATION_RELEASE_HOURS.includes(value) ? value : 0;
}

function timestampToMs(value) {
  let ms = NaN;
  if (value && typeof value.toMillis === "function") {
    try { ms = value.toMillis(); } catch (_e) { return null; }
  } else if (isValidDate(value)) {
    ms = value.getTime();
  } else {
    return null;
  }
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

// 比較 summary 項目 updatedAt 與 releasedAt 用；ISO 字串、Timestamp、Date、毫秒數皆可，無法判讀回 NaN。
function looseTimeToMs(value) {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value.toMillis === "function") {
    try { return Number(value.toMillis()); } catch (_e) { return NaN; }
  }
  if (isValidDate(value)) return value.getTime();
  if (typeof value === "object" && typeof value.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
  }
  if (typeof value === "string") return Date.parse(value);
  return NaN;
}

function resolveStartFromDateString(dateStr, parseEventStartDateInTaipei) {
  if (typeof dateStr !== "string") return null;
  const match = STRICT_EVENT_DATE_RE.exec(dateStr);
  if (!match) return null;
  const parsed = parseEventStartDateInTaipei(dateStr);
  if (!isValidDate(parsed)) return null;
  // 月日回推：擋 `2/31` 這類被 Date.UTC 滾到下個月的輸入。
  const taipei = new Date(parsed.getTime() + TAIPEI_OFFSET_MS);
  const [, year, month, day, hours, minutes] = match.map(Number);
  if (
    taipei.getUTCFullYear() !== year
    || taipei.getUTCMonth() + 1 !== month
    || taipei.getUTCDate() !== day
    || taipei.getUTCHours() !== hours
    || taipei.getUTCMinutes() !== minutes
  ) {
    return null;
  }
  return parsed.getTime();
}

// 活動開始時間（epoch ms）：以 date 字串為主（與 Functions 其他「已開始」判斷一致），
// 先嚴格格式＋月日回推，不符才用 startTimestamp；兩者都不可靠回 null。不改共用的 parseEventStartDateInTaipei。
// resolveEventStart 另回傳來源（date／startTimestamp），讓排程在改用 startTimestamp 時記 warn。
function resolveEventStart(eventData, parseEventStartDateInTaipei) {
  if (typeof parseEventStartDateInTaipei !== "function") {
    throw new TypeError("parseEventStartDateInTaipei helper is required");
  }
  const fromDate = resolveStartFromDateString(eventData?.date, parseEventStartDateInTaipei);
  if (fromDate !== null) return { startMs: fromDate, source: "date" };
  const fromTimestamp = timestampToMs(eventData?.startTimestamp);
  if (fromTimestamp !== null) return { startMs: fromTimestamp, source: "startTimestamp" };
  return { startMs: null, source: null };
}

function resolveEventStartMs(eventData, parseEventStartDateInTaipei) {
  return resolveEventStart(eventData, parseEventStartDateInTaipei).startMs;
}

// 釋出資格（掃描粗篩與交易內二次檢查共用）。due 時回 { due:true, hours, startMs, releaseAtMs }。
function evaluateReleaseTiming(eventData, nowMs, deps) {
  const status = String(eventData?.status || "").trim();
  if (!RELEASE_SCAN_STATUSES.includes(status) || deps.isCourseLinkedEventData(eventData)) {
    return { due: false, reason: "invalid_status" };
  }
  const hours = normalizeReleaseHours(eventData?.teamReservationReleaseHours);
  if (hours <= 0) return { due: false, reason: "hours_off" };
  const { startMs, source: startSource } = resolveEventStart(eventData, deps.parseEventStartDateInTaipei);
  if (startMs === null) return { due: false, reason: "start_unknown", hours };
  const releaseAtMs = startMs - hours * HOUR_MS;
  // 已開始的活動不處理（與 adjustTeamReservation 對齊）。
  if (!(releaseAtMs <= nowMs && nowMs < startMs)) {
    return { due: false, reason: "not_due", hours, startMs, releaseAtMs, startSource };
  }
  return { due: true, hours, startMs, releaseAtMs, startSource };
}

function toSlotCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

// 已釋出的活動又出現 reservedSlots>0 的項目時，用只有伺服器能寫的鏡像子文件 events/{id}/teamReservations/{teamId}
// 判斷是誰改的（顧問 11-09 裁定 Opus 批 1 P2-1 (a)；取代原「比 summary 上的 updatedAt」，因舊站 A 會寫裝置時鐘）。
// 手動再預留＝子文件存在、updatedByUid 為真人（非 system）、updatedAt（serverTimestamp）晚於 releasedAt、
// 子文件 reservedSlots >= summary 該項；其餘都視為過期回寫。
// releasedAt 無法判讀時不判斷（invalid＝true），由呼叫端跳過，不做不可逆的釋出。
function classifyReservedAfterRelease(summaries, releasedAt, subDocsByTeamId = {}) {
  const releasedAtMs = looseTimeToMs(releasedAt);
  const reserved = (Array.isArray(summaries) ? summaries : []).filter((item) => toSlotCount(item?.reservedSlots) > 0);
  if (!Number.isFinite(releasedAtMs)) return { stale: [], manual: [], invalid: reserved.length > 0 };
  const stale = [];
  const manual = [];
  reserved.forEach((item) => {
    const sub = subDocsByTeamId?.[item.teamId];
    const updatedByUid = String(sub?.updatedByUid || "").trim();
    const updatedMs = looseTimeToMs(sub?.updatedAt);
    const isManual = !!sub
      && !!updatedByUid && updatedByUid !== RELEASE_SYSTEM_UID
      && Number.isFinite(updatedMs) && updatedMs > releasedAtMs
      && toSlotCount(sub.reservedSlots) >= toSlotCount(item.reservedSlots);
    if (isManual) manual.push({ ...item, restoredReservedSlots: toSlotCount(sub.reservedSlots) });
    else stale.push(item);
  });
  return { stale, manual, invalid: false };
}

function sanitizeReleasedSummary(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item.teamId === "string" && item.teamId.trim()
      && Number.isInteger(item.releasedSlots) && item.releasedSlots >= 0)
    .map((item) => ({
      teamId: item.teamId.trim(),
      teamName: String(item.teamName || item.teamId).trim(),
      releasedSlots: item.releasedSlots,
    }));
}

// 再釋出時把新的釋出量併進既有摘要，維持每隊一筆。過期回寫是把同一批席位還回來，
// 同 teamId 取 max(既有, 本次) 不相加，避免重複計算（批 1 審查 Gemini P2-1／Opus；取代原「相加」）。
function mergeReleasedSummary(existing, added) {
  const merged = sanitizeReleasedSummary(existing);
  (Array.isArray(added) ? added : []).forEach((item) => {
    const found = merged.find((entry) => entry.teamId === item.teamId);
    if (found) found.releasedSlots = Math.max(found.releasedSlots, item.releasedSlots);
    else merged.push({ ...item });
  });
  return merged;
}

/**
 * 純函式：計算一場活動的團隊預留釋出結果。
 * input：{ eventData, registrations（全部報名，內部只取 confirmed／waitlisted 的副本）, nowMs,
 *          targetTeamIds?（再釋出時只歸 0 這些隊）, restoreReservedByTeamId?（再釋出時其餘隊以鏡像子文件名額為準） }
 * helpers：{ rebuildOccupancy, promoteWaitlistForAvailableSeats }（index.js 既有函式，不另寫容量邏輯）
 */
function planTeamReservationRelease(input, helpers) {
  requireFunctions(helpers, ["rebuildOccupancy", "promoteWaitlistForAvailableSeats"]);
  const { rebuildOccupancy, promoteWaitlistForAvailableSeats } = helpers;
  const {
    eventData = {}, registrations = [], nowMs, targetTeamIds = null, restoreReservedByTeamId = null,
  } = input || {};
  const releaseIso = new Date(nowMs).toISOString();
  const targets = targetTeamIds ? new Set(targetTeamIds) : null;
  const isTarget = (teamId) => !targets || targets.has(teamId);

  // R-REG-009：Timestamp 轉 ISO 後才排序；只在副本上模擬（R-REG-008／016）。
  const simRegs = (Array.isArray(registrations) ? registrations : [])
    .filter((reg) => reg && (reg.status === "confirmed" || reg.status === "waitlisted"))
    .map((reg) => ({
      ...reg,
      registeredAt: reg.registeredAt?.toDate?.()?.toISOString?.() || reg.registeredAt,
    }));

  // usedSlots 由實際 confirmed 報名重算，不信活動文件舊值（Gemini P1-1）。
  const occupancyBefore = rebuildOccupancy(eventData, simRegs);
  const beforeSummaries = (occupancyBefore.teamReservationSummaries || []).map((item) => ({ ...item }));

  const releasedSummary = [];
  const releasedTeamIds = [];
  const nextSummaries = [];
  beforeSummaries.forEach((item) => {
    if (!isTarget(item.teamId)) {
      // 再釋出時判為手動再預留的隊：名額以子文件為真相還原（remaining／occupied 由 rebuildOccupancy 重算）。
      const restored = restoreReservedByTeamId && Object.prototype.hasOwnProperty.call(restoreReservedByTeamId, item.teamId)
        ? { reservedSlots: toSlotCount(restoreReservedByTeamId[item.teamId]) }
        : {};
      nextSummaries.push({ ...item, ...restored });
      return;
    }
    releasedTeamIds.push(item.teamId);
    const reservedSlots = Math.max(0, Number(item.reservedSlots || 0) || 0);
    const usedSlots = Math.max(0, Number(item.usedSlots || 0) || 0);
    // 只計實際空著的預留席；超用（used>reserved）為 0，不會負數。
    const releasedSlots = Math.max(0, reservedSlots - usedSlots);
    if (releasedSlots > 0) {
      releasedSummary.push({ teamId: item.teamId, teamName: item.teamName || item.teamId, releasedSlots });
    }
    // 真釋出：reservedSlots 一律歸 0（含已用完的隊），之後預留成員取消時空位回公共池（Fable P1-1、站長 Q8）。
    if (usedSlots > 0) {
      nextSummaries.push({
        ...item,
        reservedSlots: 0,
        usedSlots,
        remainingSlots: 0,
        occupiedSlots: usedSlots,
        updatedAt: releaseIso,
        updatedByUid: RELEASE_SYSTEM_UID,
        updatedByName: RELEASE_SYSTEM_NAME,
      });
    }
  });

  const eventForRebuild = { ...eventData, teamReservationSummaries: nextSummaries };
  const promoted = promoteWaitlistForAvailableSeats(eventForRebuild, simRegs).map((reg) => ({ ...reg }));
  const occupancy = rebuildOccupancy(eventForRebuild, simRegs);

  // 鏡像子文件 events/{id}/teamReservations/{teamId}：比照 adjustTeamReservation，仍有已用席位就 merge，否則刪除。
  const finalById = new Map((occupancy.teamReservationSummaries || []).map((item) => [item.teamId, item]));
  const teamReservationDocOps = { set: [], delete: [] };
  releasedTeamIds.forEach((teamId) => {
    const finalItem = finalById.get(teamId);
    if (finalItem && (finalItem.reservedSlots > 0 || finalItem.usedSlots > 0)) {
      teamReservationDocOps.set.push({
        teamId,
        data: {
          id: teamId,
          teamId,
          teamName: finalItem.teamName || teamId,
          reservedSlots: finalItem.reservedSlots || 0,
          usedSlots: finalItem.usedSlots || 0,
          remainingSlots: finalItem.remainingSlots || 0,
          occupiedSlots: finalItem.occupiedSlots || 0,
          updatedByUid: RELEASE_SYSTEM_UID,
          updatedByName: RELEASE_SYSTEM_NAME,
        },
      });
    } else {
      teamReservationDocOps.delete.push(teamId);
    }
  });

  return { beforeSummaries, nextSummaries, promoted, occupancy, releasedSummary, teamReservationDocOps };
}

function createReleaseTeamReservationsHandler(deps) {
  requireFunctions(deps, [
    "maskId", "parseEventStartDateInTaipei", "isCourseLinkedEventData", "normalizeTeamReservationSummaries",
    "rebuildOccupancy", "promoteWaitlistForAvailableSeats", "findActivityRecordForRegistration",
    "writeInboxNotification", "adjustExpInternal", "settleBestEffortPostCommitOps", "formatOperationLogTime",
  ]);
  const {
    db, FieldValue, logger, maskId, normalizeTeamReservationSummaries, findActivityRecordForRegistration,
    writeInboxNotification, adjustExpInternal, settleBestEffortPostCommitOps, formatOperationLogTime,
  } = deps;
  requireFunctions(db, ["collection", "runTransaction"]);
  requireFunctions(FieldValue, ["serverTimestamp"]);
  requireFunctions(logger, ["info", "warn", "error"]);
  const now = typeof deps.now === "function" ? deps.now : () => Date.now();
  const maxEventsPerRun = Number.isInteger(deps.maxEventsPerRun) && deps.maxEventsPerRun > 0
    ? deps.maxEventsPerRun
    : RELEASE_MAX_EVENTS_PER_RUN;
  const fn = "releaseTeamReservations";

  async function releaseOneEvent(eventRef) {
    return db.runTransaction(async (transaction) => {
      const txNowMs = now();
      const eventSnap = await transaction.get(eventRef);
      if (!eventSnap.exists) return { outcome: "skipped", reason: "missing" };
      const ed = eventSnap.data() || {};

      // 交易內以最新文件完整重跑資格檢查（Gemini P1-2）：取消、課程、hours 改 0、延期／已開始都不釋出。
      const timing = evaluateReleaseTiming(ed, txNowMs, deps);
      if (!timing.due) return { outcome: "skipped", reason: timing.reason };

      const summaries = normalizeTeamReservationSummaries(ed);
      let targetTeamIds = null;
      let restoreReservedByTeamId = null;
      const rerelease = !!ed.teamReservationReleasedAt;
      if (rerelease) {
        const reservedItems = summaries.filter((item) => item.reservedSlots > 0);
        if (!reservedItems.length) return { outcome: "skipped", reason: "already_released" };
        // 讀這些隊的鏡像子文件（只有 Functions 能寫）判斷手動再預留或過期回寫。
        const subDocsByTeamId = {};
        for (const item of reservedItems) {
          const subSnap = await transaction.get(eventRef.collection("teamReservations").doc(item.teamId));
          if (subSnap.exists) subDocsByTeamId[item.teamId] = subSnap.data() || {};
        }
        const { stale, manual, invalid } = classifyReservedAfterRelease(
          reservedItems, ed.teamReservationReleasedAt, subDocsByTeamId,
        );
        if (invalid) return { outcome: "skipped", reason: "released_at_invalid" };
        if (!stale.length) return { outcome: "skipped", reason: "rereserved_after_release" };
        targetTeamIds = stale.map((item) => item.teamId);
        restoreReservedByTeamId = Object.fromEntries(manual.map((item) => [item.teamId, item.restoredReservedSlots]));
      } else if (!summaries.some((item) => item.reservedSlots > 0)) {
        // 輕量終態：沒有任何預留可釋出，只寫終態，不讀報名子集合、不碰 current 等欄位（Gemini P2-1）。
        transaction.update(eventRef, {
          teamReservationReleasedAt: FieldValue.serverTimestamp(),
          teamReservationReleasedSummary: [],
          teamReservationReleaseCount: 1,
        });
        return { outcome: "lightweight" };
      }

      const regsSnap = await transaction.get(eventRef.collection("registrations"));
      const registrations = regsSnap.docs.map((doc) => ({ ...doc.data(), _docId: doc.id }));
      const plan = planTeamReservationRelease(
        { eventData: ed, registrations, nowMs: txNowMs, targetTeamIds, restoreReservedByTeamId },
        deps,
      );
      // 交易內讀取必須在寫入前；只有真的遞補才讀 activityRecords。
      const arSnap = plan.promoted.length
        ? await transaction.get(eventRef.collection("activityRecords"))
        : null;
      const allArs = arSnap ? arSnap.docs.map((doc) => ({ ...doc.data(), _docId: doc.id })) : [];

      plan.teamReservationDocOps.set.forEach(({ teamId, data }) => {
        transaction.set(eventRef.collection("teamReservations").doc(teamId), {
          ...data,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      plan.teamReservationDocOps.delete.forEach((teamId) => {
        transaction.delete(eventRef.collection("teamReservations").doc(teamId));
      });

      for (const candidate of plan.promoted) {
        const update = {
          status: "confirmed",
          promotedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (candidate.teamSeatSource) update.teamSeatSource = candidate.teamSeatSource;
        transaction.update(eventRef.collection("registrations").doc(candidate._docId), update);
        // R-REG-007：非同行者同步 activityRecord waitlisted → registered。
        if (candidate.participantType !== "companion") {
          const ar = findActivityRecordForRegistration(allArs, candidate, "waitlisted");
          if (ar) transaction.update(eventRef.collection("activityRecords").doc(ar._docId), { status: "registered" });
        }
      }

      const occupancy = plan.occupancy;
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
      if (rerelease) {
        // 再釋出：releasedAt 保留首次時間，摘要併入（同隊取 max）、次數 +1。
        const prevCount = Number.isInteger(ed.teamReservationReleaseCount) && ed.teamReservationReleaseCount > 0
          ? ed.teamReservationReleaseCount
          : 1;
        eventUpdate.teamReservationReleasedSummary = mergeReleasedSummary(ed.teamReservationReleasedSummary, plan.releasedSummary);
        eventUpdate.teamReservationReleaseCount = prevCount + 1;
      } else {
        eventUpdate.teamReservationReleasedAt = FieldValue.serverTimestamp();
        eventUpdate.teamReservationReleasedSummary = plan.releasedSummary;
        eventUpdate.teamReservationReleaseCount = 1;
      }
      transaction.update(eventRef, eventUpdate);

      return {
        outcome: "released",
        rerelease,
        releasedSummary: plan.releasedSummary,
        promoted: plan.promoted.map((item) => ({
          docId: item._docId,
          userId: item.userId,
          userName: item.userName,
          participantType: item.participantType || "self",
        })),
        eventData: { title: ed.title || "", date: ed.date || "", location: ed.location || "" },
      };
    });
  }

  // 交易後置（best-effort，R-CF-003）。照 registerForEvent F1 空洞遞補寫法：同一 uid 只發一次站內信、同行者不加 EXP；
  // 與 adjustTeamReservation「每筆都發、每位含同行者都加分」刻意不同（批 0 ④）。
  async function runPostCommit(eventId, result) {
    const postOps = [];
    const notifiedUids = new Set();
    for (const promoted of result.promoted) {
      const uid = String(promoted.userId || "").trim();
      if (!uid) continue;
      if (!notifiedUids.has(uid)) {
        notifiedUids.add(uid);
        postOps.push(writeInboxNotification({
          recipientUid: uid,
          title: "候補遞補通知",
          body:
            `恭喜！您已從候補名單自動遞補為正式參加者。\n\n` +
            `活動名稱：${result.eventData.title}\n` +
            `活動時間：${result.eventData.date}\n` +
            `活動地點：${result.eventData.location}`,
          category: "activity",
          categoryLabel: "活動",
        }));
      }
      if (promoted.participantType !== "companion") {
        // 不傳 operatorUid，expLogs 由 adjustExpInternal 記為 cloud_function。
        postOps.push(adjustExpInternal({
          targetUid: uid,
          amount: 10,
          reason: `候補遞補報名：${result.eventData.title}`,
          ruleKey: "register_activity",
        }));
      }
    }
    const releasedTotal = result.releasedSummary.reduce((sum, item) => sum + item.releasedSlots, 0);
    const teamText = result.releasedSummary.map((item) => `${item.teamName} ${item.releasedSlots} 席`).join("、") || "無空著的預留席";
    // operationLogs 沒有預設 operator，自填系統身分（批 0 ④）。
    postOps.push(db.collection("operationLogs").add({
      type: "team_reservation_auto_release",
      typeName: "俱樂部席位",
      content: `活動「${result.eventData.title}」團隊預留${result.rerelease ? "再次" : ""}自動釋出：${teamText}，共 ${releasedTotal} 席，遞補 ${result.promoted.length} 人`,
      operator: "系統",
      operatorUid: "cloud_function",
      operatorName: "系統",
      actorUid: "cloud_function",
      meta: {
        eventId: maskId(eventId),
        releasedSummary: result.releasedSummary,
        promotedCount: result.promoted.length,
        rerelease: result.rerelease === true,
      },
      time: formatOperationLogTime(new Date(now())),
      createdAt: FieldValue.serverTimestamp(),
    }));
    return settleBestEffortPostCommitOps(fn, postOps);
  }

  return async function releaseTeamReservationsHandler() {
    const runNowMs = now();
    let snapshot;
    try {
      snapshot = await db.collection("events")
        .where("status", "in", [...RELEASE_SCAN_STATUSES])
        .select(
          "status", "date", "startTimestamp", "courseLinked", "courseLinkSource",
          "teamReservationReleaseHours", "teamReservationReleasedAt", "teamReservationSummaries",
        )
        .get();
    } catch (error) {
      logger.error({ fn, stage: "scan", errorCode: String(error?.code || "unknown"), message: String(error?.message || error).slice(0, 300) });
      throw error;
    }

    // 粗篩：到點且未釋出，或已釋出但又出現 reservedSlots>0（交易內再讀鏡像子文件判斷）。
    const scanSkippedByReason = {};
    const countScanSkip = (reason) => { scanSkippedByReason[reason] = (scanSkippedByReason[reason] || 0) + 1; };
    const due = [];
    snapshot.docs.forEach((doc) => {
      const data = doc.data() || {};
      const timing = evaluateReleaseTiming(data, runNowMs, deps);
      if (!timing.due) {
        countScanSkip(timing.reason);
        if (timing.reason === "start_unknown") {
          logger.warn({ fn, stage: "scan", reason: "start_unknown", eventId: maskId(doc.id) });
        }
        return;
      }
      if (data.teamReservationReleasedAt
        && !normalizeTeamReservationSummaries(data).some((item) => item.reservedSlots > 0)) {
        countScanSkip("already_released");
        return;
      }
      if (timing.startSource === "startTimestamp") {
        // date 字串不合嚴格格式，改用 startTimestamp（A 為裝置時區，可能有時差），留紀錄供人工核對。
        logger.warn({ fn, stage: "scan", reason: "start_fallback_timestamp", eventId: maskId(doc.id) });
      }
      due.push({ doc, releaseAtMs: timing.releaseAtMs });
    });

    due.sort((a, b) => a.releaseAtMs - b.releaseAtMs);
    const batch = due.slice(0, maxEventsPerRun);
    const summary = {
      scannedCount: snapshot.docs.length,
      dueCount: due.length,
      deferredCount: due.length - batch.length,
      releasedCount: 0,
      rereleasedCount: 0,
      lightweightCount: 0,
      promotedCount: 0,
      failedCount: 0,
      postCommitFailureCount: 0,
      skippedByReason: {},
      scanSkippedByReason,
    };
    const outcomes = [];

    // 一場一交易、逐場隔離（R-CF-002）；交易保留 SDK retry（R-CF-004）。
    for (const { doc } of batch) {
      const maskedEventId = maskId(doc.id);
      let committed = null;
      try {
        const result = await releaseOneEvent(doc.ref);
        outcomes.push({ eventId: maskedEventId, ...result });
        if (result.outcome === "skipped") {
          summary.skippedByReason[result.reason] = (summary.skippedByReason[result.reason] || 0) + 1;
          if (result.reason === "rereserved_after_release" || result.reason === "released_at_invalid") {
            logger.warn({ fn, stage: "transaction", reason: result.reason, eventId: maskedEventId });
          }
          continue;
        }
        if (result.outcome === "lightweight") {
          summary.lightweightCount += 1;
          continue;
        }
        summary.releasedCount += 1;
        if (result.rerelease) {
          summary.rereleasedCount += 1;
          logger.warn({ fn, stage: "transaction", reason: "rerelease_stale_writeback", eventId: maskedEventId });
        }
        summary.promotedCount += result.promoted.length;
        committed = result;
      } catch (error) {
        summary.failedCount += 1;
        outcomes.push({ eventId: maskedEventId, outcome: "failed" });
        logger.error({
          fn,
          stage: "transaction",
          eventId: maskedEventId,
          errorCode: String(error?.code || "unknown"),
          message: String(error?.message || error).slice(0, 300),
        });
        continue;
      }
      // 交易已提交；後置失敗只記 post_commit，不算這場釋出失敗（R-CF-003；批 1 審查 Opus P3-2）。
      try {
        const settled = await runPostCommit(doc.id, committed);
        summary.postCommitFailureCount += Number(settled?.failureCount || 0) || 0;
      } catch (error) {
        summary.postCommitFailureCount += 1;
        logger.error({
          fn,
          stage: "post_commit",
          eventId: maskedEventId,
          errorCode: String(error?.code || "unknown"),
          message: String(error?.message || error).slice(0, 300),
        });
      }
    }

    logger.info({ fn, ...summary });
    return { ...summary, outcomes };
  };
}

module.exports = {
  TEAM_RESERVATION_RELEASE_HOURS,
  RELEASE_MAX_EVENTS_PER_RUN,
  normalizeReleaseHours,
  resolveEventStart,
  resolveEventStartMs,
  evaluateReleaseTiming,
  classifyReservedAfterRelease,
  planTeamReservationRelease,
  createReleaseTeamReservationsHandler,
};
