"use strict";

/**
 * T-062 S4：functions/registration-notify.js 單元測試（通道常數、收件人、文字、計數 log 白名單、丟錯處理）。
 * 文字期望值與 registration-notify-characterization.test.js 同一份基準（收斂前 functions/index.js）。
 */

const {
  REGISTRATION_NOTIFY_CHANNELS,
  buildRegistrationNotices,
  dispatchRegistrationNotices,
  notifyRegistrationResult,
} = require("../../functions/registration-notify");

const CALLER = "Ucaller000000000000000000000000000";
const OTHER = "Uother0000000000000000000000000000";
const FOURTH = "Ufourth000000000000000000000000000";
const EVENT_DATA = { title: "通知測試活動", date: "2099/06/15 10:00~12:00", location: "河濱球場", type: "play" };
const TAIL = `活動名稱：${EVENT_DATA.title}\n活動時間：${EVENT_DATA.date}\n活動地點：${EVENT_DATA.location}`;
const PROMOTED_BODY = `恭喜！您已從候補升為正取：\n\n${TAIL}`;

// 計數 log 欄位白名單（顧問 §3.637 c；審查 P2-2 加 cancelledRegs／promotedRegs）：函式名、各類人數、報名筆數、失敗數、通道標籤
const LOG_FIELD_WHITELIST = [
  "cancelled", "cancelledRegs", "channels", "fn", "inboxFailed", "promoted", "promotedRegs", "removed", "signup",
];

function registerResult(extra = {}) {
  return {
    registrations: [
      { userId: CALLER, participantType: "self", status: "confirmed" },
      { userId: CALLER, participantType: "companion", status: "confirmed" },
    ],
    promoted: [],
    eventData: EVENT_DATA,
    earlyBirdCharged: false,
    earlyBirdCost: 0,
    ...extra,
  };
}

function cancelResult(extra = {}) {
  return {
    cancelled: [{ docId: "r1", userId: CALLER }],
    promoted: [],
    eventData: EVENT_DATA,
    ...extra,
  };
}

function makeDeps({ failFor = [] } = {}) {
  const writes = [];
  const logs = [];
  return {
    writes,
    logs,
    deps: {
      writeInboxNotification: jest.fn(async (payload) => {
        writes.push(payload);
        if (failFor.includes(payload.recipientUid)) throw new Error("inbox down");
      }),
      logger: {
        info: (...args) => logs.push(["info", ...args]),
        warn: (...args) => logs.push(["warn", ...args]),
        error: (...args) => logs.push(["error", ...args]),
      },
    },
  };
}

describe("通道常數（Q2）", () => {
  test("inbox 開、line 關，且凍結不可改", () => {
    expect(REGISTRATION_NOTIFY_CHANNELS).toEqual({ inbox: true, line: false });
    expect(Object.isFrozen(REGISTRATION_NOTIFY_CHANNELS)).toBe(true);
  });

  test("模組原始碼沒有任何 LINE 發送呼叫", () => {
    const source = require("fs").readFileSync(require.resolve("../../functions/registration-notify"), "utf8");
    expect(source).not.toMatch(/enqueueLine|linePushQueue|queueLineNotification|pushMessage/);
  });
});

describe("buildRegistrationNotices：registerForEvent", () => {
  test("本人正取：收件人是 callerUid，文字逐字", () => {
    expect(buildRegistrationNotices({ fn: "registerForEvent", result: registerResult(), callerUid: CALLER })).toEqual([
      { kind: "signup", recipientUid: CALLER, title: "報名成功通知", body: `報名結果：正取\n\n${TAIL}` },
    ]);
  });

  test("本人候補＋早鳥：狀態字與早鳥那行", () => {
    const result = registerResult({
      registrations: [{ userId: CALLER, participantType: "self", status: "waitlisted" }],
      earlyBirdCharged: true,
      earlyBirdCost: 30,
    });
    expect(buildRegistrationNotices({ fn: "registerForEvent", result, callerUid: CALLER })[0].body)
      .toBe(`報名結果：候補\n\n早鳥報名扣除：30 積分\n\n${TAIL}`);
  });

  test("沒有 self 那筆就不發 signup", () => {
    const result = registerResult({ registrations: [{ userId: CALLER, participantType: "companion", status: "confirmed" }] });
    expect(buildRegistrationNotices({ fn: "registerForEvent", result, callerUid: CALLER })).toEqual([]);
  });

  test("空洞遞補：每個 uid 一則（同組同行者不另發），收件人是被遞補者不是 caller", () => {
    const result = registerResult({
      promoted: [
        { userId: OTHER, participantType: "self" },
        { userId: OTHER, participantType: "companion" },
        { userId: FOURTH, participantType: "self" },
      ],
    });
    const notices = buildRegistrationNotices({ fn: "registerForEvent", result, callerUid: CALLER });
    expect(notices.filter((x) => x.kind === "promoted")).toEqual([
      { kind: "promoted", recipientUid: OTHER, title: "候補遞補通知", body: PROMOTED_BODY },
      { kind: "promoted", recipientUid: FOURTH, title: "候補遞補通知", body: PROMOTED_BODY },
    ]);
  });
});

describe("buildRegistrationNotices：cancelRegistration", () => {
  test("user_cancel：取消者與升補者，文字逐字", () => {
    const result = cancelResult({ promoted: [{ userId: OTHER }] });
    expect(buildRegistrationNotices({ fn: "cancelRegistration", result, callerUid: CALLER, cancelReason: "user_cancel" })).toEqual([
      { kind: "cancelled", recipientUid: CALLER, title: "取消報名通知", body: TAIL },
      { kind: "promoted", recipientUid: OTHER, title: "候補遞補通知", body: PROMOTED_BODY },
    ]);
  });

  test("manager_remove：被移除者標題「報名已被管理員移除」，不發給呼叫者", () => {
    const result = cancelResult({ cancelled: [{ docId: "r1", userId: OTHER }] });
    expect(buildRegistrationNotices({ fn: "cancelRegistration", result, callerUid: CALLER, cancelReason: "manager_remove" })).toEqual([
      { kind: "removed", recipientUid: OTHER, title: "報名已被管理員移除", body: TAIL },
    ]);
  });

  test("capacity_change：標題「取消報名通知」", () => {
    const notices = buildRegistrationNotices({ fn: "cancelRegistration", result: cancelResult(), callerUid: CALLER, cancelReason: "capacity_change" });
    expect(notices.map((x) => [x.kind, x.title])).toEqual([["cancelled", "取消報名通知"]]);
  });

  // Q3（顧問 §3.637）：收斂前逐筆 5 則 → 每人 1 則
  test("同一人多筆取消、同一人多筆被遞補：每人一則（Q3）", () => {
    const result = cancelResult({
      cancelled: [{ docId: "r1", userId: CALLER }, { docId: "c1", userId: CALLER }, { docId: "c2", userId: CALLER }],
      promoted: [{ userId: OTHER }, { userId: OTHER }],
    });
    const notices = buildRegistrationNotices({ fn: "cancelRegistration", result, callerUid: CALLER, cancelReason: "user_cancel" });
    expect(notices.map((x) => [x.kind, x.recipientUid])).toEqual([["cancelled", CALLER], ["promoted", OTHER]]);
  });

  test("主辦一次移除多人：每人一則", () => {
    const result = cancelResult({ cancelled: [{ docId: "r1", userId: OTHER }, { docId: "r2", userId: FOURTH }] });
    const notices = buildRegistrationNotices({ fn: "cancelRegistration", result, callerUid: CALLER, cancelReason: "manager_remove" });
    expect(notices.map((x) => x.recipientUid)).toEqual([OTHER, FOURTH]);
  });

  test("沒有要取消的（冪等重送）：0 則", () => {
    const result = cancelResult({ cancelled: [] });
    expect(buildRegistrationNotices({ fn: "cancelRegistration", result, callerUid: CALLER, cancelReason: "user_cancel" })).toEqual([]);
  });
});

describe("dispatchRegistrationNotices：寫站內信與計數 log", () => {
  test("逐則呼叫注入的 writeInboxNotification，category 固定活動", async () => {
    const { deps, writes } = makeDeps();
    const notices = buildRegistrationNotices({
      fn: "cancelRegistration", result: cancelResult({ promoted: [{ userId: OTHER }] }), callerUid: CALLER, cancelReason: "user_cancel",
    });
    await dispatchRegistrationNotices("cancelRegistration", notices, { cancelledRegs: 1, promotedRegs: 1 }, deps);
    expect(writes).toEqual([
      { recipientUid: CALLER, title: "取消報名通知", body: TAIL, category: "activity", categoryLabel: "活動" },
      { recipientUid: OTHER, title: "候補遞補通知", body: PROMOTED_BODY, category: "activity", categoryLabel: "活動" },
    ]);
  });

  test("計數 log：每次一行，欄位只在白名單內、值只有數字或列舉，不含 uid、活動代號、標題、內文", async () => {
    const { deps, logs } = makeDeps();
    const result = registerResult({ promoted: [{ userId: OTHER, participantType: "self" }] });
    const notices = buildRegistrationNotices({ fn: "registerForEvent", result, callerUid: CALLER });
    await dispatchRegistrationNotices("registerForEvent", notices, { cancelledRegs: 0, promotedRegs: 1 }, deps);
    expect(logs).toHaveLength(1);
    const [level, message, payload] = logs[0];
    expect(level).toBe("info");
    expect(message).toBe("[registrationNotify] dispatched");
    expect(Object.keys(payload).sort()).toEqual(LOG_FIELD_WHITELIST);
    expect(payload).toEqual({
      fn: "registerForEvent", signup: 1, promoted: 1, cancelled: 0, removed: 0,
      cancelledRegs: 0, promotedRegs: 1, inboxFailed: 0, channels: "inbox",
    });
    for (const [key, value] of Object.entries(payload)) {
      if (key === "fn") expect(["registerForEvent", "cancelRegistration"]).toContain(value);
      else if (key === "channels") expect(value).toBe("inbox");
      else expect(Number.isInteger(value)).toBe(true);
    }
    const serialized = JSON.stringify(logs);
    for (const secret of [CALLER, OTHER, EVENT_DATA.title, EVENT_DATA.location, "報名成功通知", "恭喜"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("單則寫入失敗：其餘照寫、計入 inboxFailed、改 warn，不往外丟", async () => {
    const { deps, writes, logs } = makeDeps({ failFor: [CALLER] });
    const notices = buildRegistrationNotices({
      fn: "cancelRegistration", result: cancelResult({ promoted: [{ userId: OTHER }] }), callerUid: CALLER, cancelReason: "user_cancel",
    });
    const summary = await dispatchRegistrationNotices("cancelRegistration", notices, { cancelledRegs: 1, promotedRegs: 1 }, deps);
    expect(writes.map((w) => w.recipientUid)).toEqual([CALLER, OTHER]);
    expect(summary).toMatchObject({ cancelled: 1, promoted: 1, inboxFailed: 1 });
    expect(logs.map((entry) => entry[0])).toEqual(["warn"]);
    expect(Object.keys(logs[0][2]).sort()).toEqual(LOG_FIELD_WHITELIST);
  });

  test("writeInboxNotification 同步丟錯也只計入 inboxFailed", async () => {
    const { deps } = makeDeps();
    deps.writeInboxNotification = () => { throw new Error("sync boom"); };
    const notices = buildRegistrationNotices({ fn: "registerForEvent", result: registerResult(), callerUid: CALLER });
    await expect(dispatchRegistrationNotices("registerForEvent", notices, { cancelledRegs: 0, promotedRegs: 0 }, deps)).resolves.toMatchObject({ signup: 1, inboxFailed: 1 });
  });
});

describe("notifyRegistrationResult：index.js 的唯一呼叫點", () => {
  test("Regs 是交易結果的報名筆數，人數是去重後（Q3 後人數 ≤ 筆數）", async () => {
    const { deps } = makeDeps();
    const result = cancelResult({
      cancelled: [{ docId: "r1", userId: CALLER }, { docId: "c1", userId: CALLER }, { docId: "c2", userId: CALLER }],
      promoted: [{ userId: OTHER }, { userId: OTHER }],
    });
    await expect(notifyRegistrationResult({ fn: "cancelRegistration", result, callerUid: CALLER, cancelReason: "user_cancel" }, deps))
      .resolves.toMatchObject({ cancelled: 1, cancelledRegs: 3, promoted: 1, promotedRegs: 2 });
    const registered = registerResult({ promoted: [{ userId: OTHER }, { userId: OTHER }] });
    await expect(notifyRegistrationResult({ fn: "registerForEvent", result: registered, callerUid: CALLER }, deps))
      .resolves.toMatchObject({ signup: 1, cancelledRegs: 0, promoted: 1, promotedRegs: 2 });
  });

  test("正常：build＋dispatch，回傳計數", async () => {
    const { deps, writes } = makeDeps();
    await expect(notifyRegistrationResult({ fn: "registerForEvent", result: registerResult(), callerUid: CALLER }, deps))
      .resolves.toMatchObject({ fn: "registerForEvent", signup: 1 });
    expect(writes).toHaveLength(1);
  });

  test("交易結果缺欄位（build 同步丟錯）：回 rejected promise，不同步丟錯（R-CF-003）", async () => {
    const { deps, writes } = makeDeps();
    let returned;
    expect(() => {
      returned = notifyRegistrationResult({ fn: "cancelRegistration", result: { eventData: EVENT_DATA }, callerUid: CALLER }, deps);
    }).not.toThrow();
    await expect(returned).rejects.toThrow();
    expect(writes).toEqual([]);
  });

  test("回傳的 rejected promise 沒被 await 也不會變成 unhandled rejection（後置程式在 settle 前丟錯時不拖垮行程）", async () => {
    const { deps } = makeDeps();
    const seen = [];
    const onUnhandled = (reason) => seen.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      notifyRegistrationResult({ fn: "other", result: registerResult(), callerUid: CALLER }, deps);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(seen).toEqual([]);
  });

  test("未知 fn：回 rejected promise", async () => {
    const { deps } = makeDeps();
    await expect(notifyRegistrationResult({ fn: "other", result: registerResult(), callerUid: CALLER }, deps))
      .rejects.toThrow("REGISTRATION_NOTIFY_UNKNOWN_FN");
  });
});
