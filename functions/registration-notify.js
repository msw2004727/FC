"use strict";

/**
 * T-062 S4：報名類站內信的單一發送點，只給 registerForEvent、cancelRegistration 在交易成功後呼叫。
 * - 收件人只取自交易結果（result.registrations／result.cancelled／result.promoted），不讀 request.data。
 * - 文字與收斂前 functions/index.js 的四段 writeInboxNotification 逐字相同（顧問 §3.637 Q7）。
 * - LINE 固定不發（Q2）：打開要改這個常數、重部署並另送裁定；這裡沒有任何 LINE 呼叫。
 * - 只計數的 log：欄位白名單見 dispatchRegistrationNotices，不含 uid、活動代號、標題、內文。
 */

const REGISTRATION_NOTIFY_CHANNELS = Object.freeze({ inbox: true, line: false });

const CHANNELS_LABEL = Object.entries(REGISTRATION_NOTIFY_CHANNELS)
  .filter(([, enabled]) => enabled === true)
  .map(([channel]) => channel)
  .join("+");

const PROMOTED_TITLE = "候補遞補通知";

function eventLines(eventData) {
  return `活動名稱：${eventData.title}\n` +
    `活動時間：${eventData.date}\n` +
    `活動地點：${eventData.location}`;
}

function promotedNotice(recipientUid, eventData) {
  return {
    kind: "promoted",
    recipientUid,
    title: PROMOTED_TITLE,
    body: `恭喜！您已從候補升為正取：\n\n` + eventLines(eventData),
  };
}

// 純函式：交易結果 → [{ kind, recipientUid, title, body }]
function buildRegistrationNotices({ fn, result, callerUid, cancelReason }) {
  const notices = [];
  if (fn === "registerForEvent") {
    const selfReg = result.registrations.find((r) => r.participantType === "self");
    if (selfReg) {
      const statusLabel = selfReg.status === "waitlisted" ? "候補" : "正取";
      notices.push({
        kind: "signup",
        recipientUid: callerUid,
        title: "報名成功通知",
        body:
          `報名結果：${statusLabel}\n\n` +
          (result.earlyBirdCharged ? `早鳥報名扣除：${result.earlyBirdCost} 積分\n\n` : "") +
          eventLines(result.eventData),
      });
    }
    // F1 空洞遞補：同組同行者只通知主報名者一次
    const notifiedPromotedUids = new Set();
    for (const promoted of result.promoted || []) {
      if (notifiedPromotedUids.has(promoted.userId)) continue;
      notifiedPromotedUids.add(promoted.userId);
      notices.push(promotedNotice(promoted.userId, result.eventData));
    }
    return notices;
  }
  if (fn === "cancelRegistration") {
    const kind = cancelReason === "manager_remove" ? "removed" : "cancelled";
    const title = cancelReason === "manager_remove" ? "報名已被管理員移除" : "取消報名通知";
    for (const reg of result.cancelled) {
      notices.push({ kind, recipientUid: reg.userId, title, body: eventLines(result.eventData) });
    }
    for (const candidate of result.promoted) {
      notices.push(promotedNotice(candidate.userId, result.eventData));
    }
    return notices;
  }
  throw new Error("REGISTRATION_NOTIFY_UNKNOWN_FN");
}

// 逐則寫站內信，全部結束後寫一行只計數的 log；單則失敗只計入 inboxFailed，不往外丟
async function dispatchRegistrationNotices(fn, notices, { writeInboxNotification, logger }) {
  const outcomes = await Promise.allSettled(notices.map(async (notice) => writeInboxNotification({
    recipientUid: notice.recipientUid,
    title: notice.title,
    body: notice.body,
    category: "activity",
    categoryLabel: "活動",
  })));
  const countOf = (kind) => notices.filter((notice) => notice.kind === kind).length;
  const summary = {
    fn,
    signup: countOf("signup"),
    promoted: countOf("promoted"),
    cancelled: countOf("cancelled"),
    removed: countOf("removed"),
    inboxFailed: outcomes.filter((outcome) => outcome.status === "rejected").length,
    channels: CHANNELS_LABEL,
  };
  if (summary.inboxFailed > 0) {
    logger.warn("[registrationNotify] dispatched", summary);
  } else {
    logger.info("[registrationNotify] dispatched", summary);
  }
  return summary;
}

// index.js 唯一呼叫點：同步丟錯（例如交易結果缺欄位）也轉成 rejected promise，交給 settleBestEffortPostCommitOps，
// 不讓已成功的交易變成失敗（R-CF-003）
function notifyRegistrationResult(input, deps) {
  try {
    const notices = buildRegistrationNotices(input);
    return dispatchRegistrationNotices(input.fn, notices, deps);
  } catch (error) {
    return Promise.reject(error);
  }
}

module.exports = {
  REGISTRATION_NOTIFY_CHANNELS,
  buildRegistrationNotices,
  dispatchRegistrationNotices,
  notifyRegistrationResult,
};
