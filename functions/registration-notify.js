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

// 依首次出現順序去掉重複的 userId（同一人本人＋同行者只算一次）
function uniqueUserIds(regs) {
  return [...new Set(regs.map((reg) => reg.userId))];
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
    for (const uid of uniqueUserIds(result.promoted || [])) {
      notices.push(promotedNotice(uid, result.eventData));
    }
    return notices;
  }
  if (fn === "cancelRegistration") {
    const kind = cancelReason === "manager_remove" ? "removed" : "cancelled";
    const title = cancelReason === "manager_remove" ? "報名已被管理員移除" : "取消報名通知";
    // 顧問 §3.637 Q3：本人＋同行者多筆取消或一組被遞補時每人一則，對齊 F1（取代收斂前的逐筆發送）
    for (const uid of uniqueUserIds(result.cancelled)) {
      notices.push({ kind, recipientUid: uid, title, body: eventLines(result.eventData) });
    }
    for (const uid of uniqueUserIds(result.promoted)) {
      notices.push(promotedNotice(uid, result.eventData));
    }
    return notices;
  }
  throw new Error("REGISTRATION_NOTIFY_UNKNOWN_FN");
}

// 逐則寫站內信，全部結束後寫一行只計數的 log；單則失敗只計入 inboxFailed，不往外丟。
// 注意 inboxFailed 只算「被拒絕的 promise」：正式的 writeInboxNotification 會自己 catch、不 reject，
// 所以正式環境這欄幾乎恆為 0；實際的寫入失敗要看 [writeInboxNotification] 的 ERROR 數（審查 P2-1）
// cancelledRegs／promotedRegs 是報名筆數（與 audit 的 cancelledCount／promotedCount 同口徑）；
// cancelled／removed／promoted 是去重後的人數（Q3 後人數 ≤ 筆數，審查 P2-2）
async function dispatchRegistrationNotices(fn, notices, { cancelledRegs, promotedRegs }, { writeInboxNotification, logger }) {
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
    cancelledRegs,
    promotedRegs,
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

// 交易結果的報名筆數（取消含管理員移除；遞補含同行者）
function countRegistrationRows({ fn, result }) {
  return {
    cancelledRegs: fn === "cancelRegistration" ? result.cancelled.length : 0,
    promotedRegs: (result.promoted || []).length,
  };
}

// index.js 唯一呼叫點：同步丟錯（例如交易結果缺欄位）也轉成 rejected promise，交給 settleBestEffortPostCommitOps，
// 不讓已成功的交易變成失敗（R-CF-003）
function notifyRegistrationResult(input, deps) {
  let pending;
  try {
    const notices = buildRegistrationNotices(input);
    pending = dispatchRegistrationNotices(input.fn, notices, countRegistrationRows(input), deps);
  } catch (error) {
    pending = Promise.reject(error);
  }
  // 先掛處理器：若後面的後置程式在 settle 之前同步丟錯，這個 rejection 也不會變成 unhandled rejection；
  // settle 拿到的仍是同一個 promise，照樣記錄失敗
  pending.catch(() => {});
  return pending;
}

module.exports = {
  REGISTRATION_NOTIFY_CHANNELS,
  buildRegistrationNotices,
  dispatchRegistrationNotices,
  notifyRegistrationResult,
};
