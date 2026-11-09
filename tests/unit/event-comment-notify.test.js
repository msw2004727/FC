"use strict";

// 活動留言通知批 0（計畫書 event-comment-notify-plan-2026-11-09 v3）純函式單元測試。
// 涵蓋計畫書與 Gemini／Opus 審查列出的邊界：收件人與 Rules 一致、Q6 管理者留言跳過、視窗與冪等、
// 每日上限（先篩資格再扣、byAuthor 每則 +1、全數 capped）、_config fail-closed、文案與網址淨化。

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  COMMENT_NOTIFY_FORCED_SOURCE_PREFIX,
  COMMENT_NOTIFY_SOURCE,
  COMMENT_NOTIFY_CATEGORY,
  COMMENT_NOTIFY_WINDOW_MS,
  RECENT_COMMENT_IDS_MAX,
  CONFIG_CACHE_MS,
  LINK_PLACEHOLDER,
  resolveCommentNotifyRecipients,
  precheckComment,
  precheckCommentEvent,
  buildCommentNotifyKeys,
  decideCommentNotify,
  normalizeCommentNotifyConfig,
  readConfigWithFallback,
  filterLineEligibleRecipients,
  decideCommentLineCaps,
  sanitizeCommentText,
  buildCommentNotifyMessages,
} = require("../../functions/event-comment-notify");
const { isValidSourceFormat } = require("../../functions/notification-fields");

const WINDOW = COMMENT_NOTIFY_WINDOW_MS;
const ZWSP = String.fromCharCode(0x200B);
const RLO = String.fromCharCode(0x202E);
const NEL = String.fromCharCode(0x85);
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);

function admin(uid, docId = uid) {
  return { docId, uid };
}

describe("resolveCommentNotifyRecipients：收件人與 Rules isCommentManager 一致", () => {
  test("主辦／擁有者／隊長／委託＋管理員，先活動管理者再管理員", () => {
    const result = resolveCommentNotifyRecipients({
      eventData: { creatorUid: "c1", ownerUid: "o1", captainUid: "k1", delegateUids: ["d1", "d2"] },
      authorUid: "u9",
      adminEntries: [admin("a1"), admin("a2")],
    });
    expect(result.skip).toBeNull();
    expect(result.recipients).toEqual(["c1", "o1", "k1", "d1", "d2", "a1", "a2"]);
    expect(result.managers).toEqual(["c1", "o1", "k1", "d1", "d2"]);
    expect(result.admins).toEqual(["a1", "a2"]);
  });

  test("欄位缺省、非字串值、空字串一律略過；delegateUids 不是陣列時不用", () => {
    const result = resolveCommentNotifyRecipients({
      eventData: { creatorUid: 123, ownerUid: "", captainUid: null, delegateUids: "d1" },
      authorUid: "u9",
      adminEntries: [admin("a1")],
    });
    expect(result.recipients).toEqual(["a1"]);
    const withMixedList = resolveCommentNotifyRecipients({
      eventData: { delegateUids: ["d1", 5, null, "", { uid: "x" }, "d2"] },
      authorUid: "u9",
      adminEntries: [],
    });
    expect(withMixedList.recipients).toEqual(["d1", "d2"]);
  });

  test("不認 delegates[].uid（Rules 不認）", () => {
    const result = resolveCommentNotifyRecipients({
      eventData: { creatorUid: "c1", delegates: [{ uid: "x1" }] },
      authorUid: "x1",
      adminEntries: [],
    });
    expect(result.skip).toBeNull();
    expect(result.recipients).toEqual(["c1"]);
  });

  test("沒有活動資料時只剩管理員", () => {
    const result = resolveCommentNotifyRecipients({ eventData: null, authorUid: "u9", adminEntries: [admin("a1")] });
    expect(result.recipients).toEqual(["a1"]);
  });

  test("重複者去重；管理員同時是本場管理者時只列在 managers", () => {
    const result = resolveCommentNotifyRecipients({
      eventData: { creatorUid: "c1", ownerUid: "c1", delegateUids: ["a1", "c1", "a1"] },
      authorUid: "u9",
      adminEntries: [admin("a1"), admin("a1"), admin("a2")],
    });
    expect(result.recipients).toEqual(["c1", "a1", "a2"]);
    expect(result.managers).toEqual(["c1", "a1"]);
    expect(result.admins).toEqual(["a2"]);
  });

  test.each([
    ["creatorUid", { creatorUid: "me" }],
    ["ownerUid", { ownerUid: "me" }],
    ["captainUid", { captainUid: "me" }],
    ["delegateUids", { delegateUids: ["x", "me"] }],
  ])("Q6：留言者是 %s → 整則不通知任何人", (_field, eventData) => {
    const result = resolveCommentNotifyRecipients({
      eventData: { creatorUid: "c1", ...eventData },
      authorUid: "me",
      adminEntries: [admin("a1")],
    });
    expect(result.skip).toBe("author_is_manager");
    expect(result.recipients).toEqual([]);
  });

  test("Q6：留言者是管理員 → 整則不通知", () => {
    const result = resolveCommentNotifyRecipients({
      eventData: { creatorUid: "c1" },
      authorUid: "a1",
      adminEntries: [admin("a1"), admin("a2")],
    });
    expect(result.skip).toBe("author_is_manager");
    expect(result.recipients).toEqual([]);
  });

  test("docId≠uid 的管理員不收通知並計數；本人（uid 或 docId）留言仍整則跳過", () => {
    const entries = [admin("a1"), { docId: "legacyDoc", uid: "realUid" }];
    const normal = resolveCommentNotifyRecipients({ eventData: { creatorUid: "c1" }, authorUid: "u9", adminEntries: entries });
    expect(normal.recipients).toEqual(["c1", "a1"]);
    expect(normal.adminDocIdMismatch).toBe(1);
    expect(resolveCommentNotifyRecipients({ eventData: {}, authorUid: "realUid", adminEntries: entries }).skip)
      .toBe("author_is_manager");
    expect(resolveCommentNotifyRecipients({ eventData: {}, authorUid: "legacyDoc", adminEntries: entries }).skip)
      .toBe("author_is_manager");
  });

  test("委託人不 trim、不轉型：' u1 ' 不等於 'u1'，'u1' 留言照常通知，帶空白的值不寄送", () => {
    const result = resolveCommentNotifyRecipients({
      eventData: { creatorUid: "c1", delegateUids: [" u1 ", "bad/uid"] },
      authorUid: "u1",
      adminEntries: [],
    });
    expect(result.skip).toBeNull();
    expect(result.recipients).toEqual(["c1"]);
    expect(result.undeliverable).toBe(2);
    // Q6 用原值比對（與 Rules 相同）：完全相等才算管理者
    expect(resolveCommentNotifyRecipients({
      eventData: { delegateUids: [" u1 "] }, authorUid: " u1 ", adminEntries: [],
    }).skip).toBe("author_is_manager");
  });

  test("上限 50，截斷時先保活動管理者", () => {
    const delegates = Array.from({ length: 60 }, (_, i) => `d${i}`);
    const result = resolveCommentNotifyRecipients({
      eventData: { creatorUid: "c1", delegateUids: delegates },
      authorUid: "u9",
      adminEntries: [admin("a1")],
    });
    expect(result.recipients).toHaveLength(50);
    expect(result.recipients[0]).toBe("c1");
    expect(result.recipients).not.toContain("a1");
    expect(result.admins).toEqual([]);
    expect(result.recipientsCapped).toBe(true);
  });

  test("留言者 uid 無效 → invalid_author", () => {
    expect(resolveCommentNotifyRecipients({ eventData: {}, authorUid: "", adminEntries: [] }).skip).toBe("invalid_author");
    expect(resolveCommentNotifyRecipients({ eventData: {}, authorUid: 7, adminEntries: [] }).skip).toBe("invalid_author");
  });
});

describe("precheckComment／precheckCommentEvent：前置過濾", () => {
  test("刪除、空內文、無作者不通知；只有 public 算公開", () => {
    expect(precheckComment(null)).toEqual({ ok: false, reason: "invalid_comment" });
    expect(precheckComment({ deleted: true, body: "x", authorUid: "u" }).reason).toBe("deleted");
    expect(precheckComment({ body: "   ", authorUid: "u" }).reason).toBe("empty_body");
    expect(precheckComment({ body: 3, authorUid: "u" }).reason).toBe("empty_body");
    expect(precheckComment({ body: "x", authorUid: "" }).reason).toBe("invalid_author");
    expect(precheckComment({ body: "x", authorUid: "u", visibility: "public" })).toEqual({ ok: true, isPrivate: false });
    expect(precheckComment({ body: "x", authorUid: "u", visibility: "private" })).toEqual({ ok: true, isPrivate: true });
    expect(precheckComment({ body: "x", authorUid: "u" })).toEqual({ ok: true, isPrivate: true });
  });

  const ts = (ms) => ({ toMillis: () => ms });

  test("活動不存在、取消不通知", () => {
    expect(precheckCommentEvent({ eventData: null }).reason).toBe("event_missing");
    expect(precheckCommentEvent({ eventData: { status: "cancelled" } }).reason).toBe("event_cancelled");
  });

  test("以留言 createdAt 對 endTimestamp：壓線前的留言照常通知", () => {
    const eventData = { endTimestamp: ts(1000) };
    expect(precheckCommentEvent({ eventData, commentCreatedAtMs: 999 })).toEqual({ ok: true, endMs: 1000 });
    expect(precheckCommentEvent({ eventData, commentCreatedAtMs: 1000 }).reason).toBe("event_ended_skip");
  });

  test("endTimestamp 無效時改用 date 經注入的 parseEventEndDateInTaipei；都無法判讀時不擋", () => {
    const parse = jest.fn(() => new Date(5000));
    expect(precheckCommentEvent({
      eventData: { endTimestamp: "bad", date: "2026/11/09 10:00~12:00" },
      commentCreatedAtMs: 6000,
      parseEventEndDateInTaipei: parse,
    }).reason).toBe("event_ended_skip");
    expect(parse).toHaveBeenCalledWith("2026/11/09 10:00~12:00");
    expect(precheckCommentEvent({
      eventData: { date: "亂寫" }, commentCreatedAtMs: 6000, parseEventEndDateInTaipei: () => null,
    })).toEqual({ ok: true, endMs: null });
  });
});

describe("buildCommentNotifyKeys：固定 id（重送冪等）", () => {
  test("站內信 id、dedupeKey、每日文件 id（台北日）", () => {
    // 2026-11-08T16:30:00Z ＝ 台北 11-09 00:30
    const keys = buildCommentNotifyKeys({ eventDocId: "ev1", commentId: "cm1", nowMs: Date.UTC(2026, 10, 8, 16, 30) });
    expect(keys).toEqual({
      stateDocId: "ev1",
      dailyDocId: "_daily_20261109",
      inboxMessageId: "ecn_ev1_cm1",
      dedupeKey: "event_comment:ev1:cm1",
    });
    expect(buildCommentNotifyKeys({ eventDocId: "ev1", commentId: "cm1", nowMs: 0 })).toMatchObject({
      inboxMessageId: keys.inboxMessageId,
      dedupeKey: keys.dedupeKey,
    });
  });

  test("eventDocId 以底線開頭時不給狀態文件 id（避免撞 _config／_daily_）", () => {
    expect(buildCommentNotifyKeys({ eventDocId: "_config", commentId: "c", nowMs: 0 }).stateDocId).toBeNull();
    expect(buildCommentNotifyKeys({ eventDocId: "_daily_20261109", commentId: "c", nowMs: 0 }).stateDocId).toBeNull();
  });

  test("缺值丟錯", () => {
    expect(() => buildCommentNotifyKeys({ eventDocId: "", commentId: "c", nowMs: 0 })).toThrow(TypeError);
    expect(() => buildCommentNotifyKeys({ eventDocId: "e", commentId: "c" })).toThrow(TypeError);
  });

  test("source 符合 isValidSourceFormat、類別為 activity", () => {
    expect(isValidSourceFormat(COMMENT_NOTIFY_SOURCE)).toBe(true);
    expect(COMMENT_NOTIFY_SOURCE).toBe("event_comment:new");
    expect(COMMENT_NOTIFY_CATEGORY).toBe("activity");
  });
});

describe("decideCommentNotify：30 分鐘視窗、私密立即發、冪等", () => {
  function apply(state, input) {
    const result = decideCommentNotify({ state, ...input });
    return { result, state: result.nextState || state };
  }

  test("第一則公開留言立即發", () => {
    const { result } = apply(null, { nowMs: 1000, commentId: "c1", isPrivate: false });
    expect(result).toEqual({
      action: "send_public",
      batchCount: 1,
      nextState: { lastPublicNotifiedAtMs: 1000, pendingPublic: 0, recentCommentIds: ["c1"] },
    });
  });

  test("視窗內累計、跨視窗發送帶累計數並歸零；邊界剛好 30 分鐘算新視窗", () => {
    let step = apply(null, { nowMs: 0, commentId: "c1", isPrivate: false });
    step = apply(step.state, { nowMs: 60000, commentId: "c2", isPrivate: false });
    expect(step.result.action).toBe("accumulate");
    expect(step.state.pendingPublic).toBe(1);
    step = apply(step.state, { nowMs: WINDOW - 1, commentId: "c3", isPrivate: false });
    expect(step.result.action).toBe("accumulate");
    expect(step.state.pendingPublic).toBe(2);
    expect(step.state.lastPublicNotifiedAtMs).toBe(0);
    step = apply(step.state, { nowMs: WINDOW, commentId: "c4", isPrivate: false });
    expect(step.result.action).toBe("send_public");
    expect(step.result.batchCount).toBe(3);
    expect(step.state).toEqual({ lastPublicNotifiedAtMs: WINDOW, pendingPublic: 0, recentCommentIds: ["c1", "c2", "c3", "c4"] });
  });

  test("私密留言在公開視窗內也立即發，且不動公開視窗與累計數", () => {
    let step = apply(null, { nowMs: 0, commentId: "c1", isPrivate: false });
    step = apply(step.state, { nowMs: 1000, commentId: "c2", isPrivate: false });
    step = apply(step.state, { nowMs: 2000, commentId: "p1", isPrivate: true });
    expect(step.result).toMatchObject({ action: "send_private", batchCount: 1 });
    expect(step.state.lastPublicNotifiedAtMs).toBe(0);
    expect(step.state.pendingPublic).toBe(1);
    step = apply(step.state, { nowMs: WINDOW, commentId: "c3", isPrivate: false });
    expect(step.result).toMatchObject({ action: "send_public", batchCount: 2 });
  });

  test("先私密再公開：私密不佔公開視窗，公開首則照常立即發", () => {
    let step = apply(null, { nowMs: 0, commentId: "p1", isPrivate: true });
    expect(step.state.lastPublicNotifiedAtMs).toBeNull();
    step = apply(step.state, { nowMs: 5 * 60000, commentId: "c1", isPrivate: false });
    expect(step.result).toMatchObject({ action: "send_public", batchCount: 1 });
  });

  test("重送冪等：最近 20 筆內任何順序的重送都 skip_duplicate、不寫", () => {
    let step = apply(null, { nowMs: 0, commentId: "c1", isPrivate: false });
    step = apply(step.state, { nowMs: 1000, commentId: "c2", isPrivate: false });
    const before = step.state;
    const resent = decideCommentNotify({ state: before, nowMs: WINDOW + 5, commentId: "c1", isPrivate: false });
    expect(resent).toEqual({ action: "skip_duplicate", nextState: null, batchCount: 0 });
    const resentPrivate = decideCommentNotify({ state: before, nowMs: 2000, commentId: "c2", isPrivate: true });
    expect(resentPrivate.action).toBe("skip_duplicate");
  });

  test("同毫秒兩則（transaction 序列化後依序套用）：一則發、一則累計", () => {
    let step = apply(null, { nowMs: 5000, commentId: "a", isPrivate: false });
    step = apply(step.state, { nowMs: 5000, commentId: "b", isPrivate: false });
    expect(step.result.action).toBe("accumulate");
    expect(step.state).toEqual({ lastPublicNotifiedAtMs: 5000, pendingPublic: 1, recentCommentIds: ["a", "b"] });
  });

  test("時間倒序（較晚的觸發先處理）仍在視窗內累計", () => {
    let step = apply(null, { nowMs: 10000, commentId: "late", isPrivate: false });
    step = apply(step.state, { nowMs: 5000, commentId: "early", isPrivate: false });
    expect(step.result.action).toBe("accumulate");
  });

  test("recentCommentIds 最多 20 筆 FIFO；超過 20 筆後的舊 id 重送會被當新留言（已知限制）", () => {
    let state = null;
    for (let i = 0; i < RECENT_COMMENT_IDS_MAX + 1; i += 1) {
      state = apply(state, { nowMs: i, commentId: `c${i}`, isPrivate: true }).state;
    }
    expect(state.recentCommentIds).toHaveLength(RECENT_COMMENT_IDS_MAX);
    expect(state.recentCommentIds[0]).toBe("c1");
    expect(decideCommentNotify({ state, nowMs: 100, commentId: "c0", isPrivate: true }).action).toBe("send_private");
  });

  test("壞掉的狀態文件正規化後照常判斷", () => {
    const result = decideCommentNotify({
      state: { lastPublicNotifiedAtMs: "x", pendingPublic: -3, recentCommentIds: "nope" },
      nowMs: 1,
      commentId: "c1",
      isPrivate: false,
    });
    expect(result).toMatchObject({ action: "send_public", batchCount: 1 });
    const filtered = decideCommentNotify({
      state: { lastPublicNotifiedAtMs: 0, pendingPublic: 2.5, recentCommentIds: [null, 3, "c0"] },
      nowMs: 1,
      commentId: "c1",
      isPrivate: false,
    });
    expect(filtered.nextState).toEqual({ lastPublicNotifiedAtMs: 0, pendingPublic: 1, recentCommentIds: ["c0", "c1"] });
  });

  test("參數錯誤丟錯", () => {
    expect(() => decideCommentNotify({ state: null, nowMs: 1, commentId: "" })).toThrow(TypeError);
    expect(() => decideCommentNotify({ state: null, nowMs: NaN, commentId: "c" })).toThrow(TypeError);
  });
});

describe("_config：缺文件或讀取失敗 fail-closed", () => {
  test("缺文件：站內信照寫、LINE 全關、caps 0、站內信上限 30", async () => {
    const config = await readConfigWithFallback({ readConfigDoc: async () => null, nowMs: 0 });
    expect(config).toEqual({
      status: "missing",
      enabled: true,
      lineEnabled: false,
      adminLineEnabled: false,
      caps: { globalPerDay: 0, authorPerDay: 0, recipientPerDay: 0, authorInboxPerDay: 30 },
    });
  });

  test("讀取失敗：fail-closed 並帶回錯誤，不快取（下次重讀）", async () => {
    const cache = {};
    const boom = new Error("unavailable");
    const failing = await readConfigWithFallback({ readConfigDoc: async () => { throw boom; }, nowMs: 0, cache });
    expect(failing).toMatchObject({ status: "error", enabled: true, lineEnabled: false, adminLineEnabled: false, error: boom });
    expect(failing.caps.globalPerDay).toBe(0);
    expect(cache.value).toBeUndefined();
    const reader = jest.fn(async () => ({ lineEnabled: true }));
    await readConfigWithFallback({ readConfigDoc: reader, nowMs: 1, cache });
    expect(reader).toHaveBeenCalledTimes(1);
  });

  test("只有明確 lineEnabled === true 才開；adminLineEnabled 另須 lineEnabled", () => {
    expect(normalizeCommentNotifyConfig({ lineEnabled: "true", adminLineEnabled: true })).toMatchObject({
      status: "ok", lineEnabled: false, adminLineEnabled: false,
    });
    expect(normalizeCommentNotifyConfig({ lineEnabled: true })).toMatchObject({ lineEnabled: true, adminLineEnabled: false });
    expect(normalizeCommentNotifyConfig({ lineEnabled: true, adminLineEnabled: true })).toMatchObject({
      lineEnabled: true, adminLineEnabled: true,
    });
  });

  test("enabled 只有明確 false 才關；非物件文件視為無效並 fail-closed", () => {
    expect(normalizeCommentNotifyConfig({}).enabled).toBe(true);
    expect(normalizeCommentNotifyConfig({ enabled: false }).enabled).toBe(false);
    expect(normalizeCommentNotifyConfig([])).toMatchObject({ status: "invalid", lineEnabled: false });
    expect(normalizeCommentNotifyConfig("x")).toMatchObject({ status: "invalid", lineEnabled: false });
  });

  test("caps：缺值或不合法時 LINE 為 0、站內信 30；小數取整", () => {
    expect(normalizeCommentNotifyConfig({
      lineEnabled: true,
      caps: { globalPerDay: 15.9, authorPerDay: -1, recipientPerDay: "6", authorInboxPerDay: NaN },
    }).caps).toEqual({ globalPerDay: 15, authorPerDay: 0, recipientPerDay: 0, authorInboxPerDay: 30 });
    expect(normalizeCommentNotifyConfig({ caps: { authorInboxPerDay: 0 } }).caps.authorInboxPerDay).toBe(0);
  });

  test("快取 60 秒（含缺文件），過期重讀；回傳物件不可改", async () => {
    const cache = {};
    const reader = jest.fn(async () => null);
    const first = await readConfigWithFallback({ readConfigDoc: reader, nowMs: 1000, cache });
    await readConfigWithFallback({ readConfigDoc: reader, nowMs: 1000 + CONFIG_CACHE_MS - 1, cache });
    expect(reader).toHaveBeenCalledTimes(1);
    reader.mockResolvedValueOnce({ lineEnabled: true, caps: { globalPerDay: 3 } });
    const refreshed = await readConfigWithFallback({ readConfigDoc: reader, nowMs: 1000 + CONFIG_CACHE_MS, cache });
    expect(reader).toHaveBeenCalledTimes(2);
    expect(refreshed).toMatchObject({ status: "ok", lineEnabled: true });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(refreshed.caps)).toBe(true);
  });

  test("沒給 readConfigDoc 也是 fail-closed", async () => {
    expect(await readConfigWithFallback({ nowMs: 0 })).toMatchObject({ status: "error", lineEnabled: false });
  });
});

describe("filterLineEligibleRecipients：先篩 LINE 資格再扣額度（Gemini 複審 P1-①）", () => {
  const onConfig = { lineEnabled: true, adminLineEnabled: true };

  test("用 activity 類別與 event_comment:new 呼叫解析；跳過原因分類計數", async () => {
    const outcomes = {
      c1: { found: {}, targetUid: "c1" },
      d1: { skipped: "not_bound" },
      d2: { skipped: "category_disabled" },
      d3: { skipped: "notification_toggle_disabled" },
      d4: { skipped: "target_not_found" },
      a1: { found: {}, targetUid: "a1" },
    };
    const resolveRecipient = jest.fn(async ({ uid }) => outcomes[uid]);
    const result = await filterLineEligibleRecipients({
      recipients: Object.keys(outcomes), admins: ["a1"], config: onConfig, resolveRecipient,
    });
    expect(resolveRecipient).toHaveBeenCalledWith({ uid: "c1", category: "activity", source: "event_comment:new" });
    expect(result.lineCandidates).toEqual(["c1", "a1"]);
    expect(result.shadowEligible).toBe(2);
    expect(result.skipped).toEqual({ not_bound: 1, category_disabled: 1, notification_toggle_disabled: 1, target_not_found: 1 });
  });

  test("lineEnabled 關：不給候選，但 shadow 照算", async () => {
    const result = await filterLineEligibleRecipients({
      recipients: ["c1", "a1"], admins: ["a1"], config: { lineEnabled: false, adminLineEnabled: true },
      resolveRecipient: async () => ({ found: {} }),
    });
    expect(result.lineCandidates).toEqual([]);
    expect(result.shadowEligible).toBe(2);
    expect(result.skipped).toEqual({ line_disabled: 2 });
  });

  test("adminLineEnabled 關：只排除管理員，活動管理者照發", async () => {
    const result = await filterLineEligibleRecipients({
      recipients: ["c1", "a1"], admins: ["a1"], config: { lineEnabled: true, adminLineEnabled: false },
      resolveRecipient: async () => ({ found: {} }),
    });
    expect(result.lineCandidates).toEqual(["c1"]);
    expect(result.skipped).toEqual({ admin_line_off: 1 });
  });

  test("解析丟錯或回傳異常：該收件人不發 LINE（fail-closed）並回報錯誤", async () => {
    const boom = new Error("read failed");
    const result = await filterLineEligibleRecipients({
      recipients: ["c1", "c2", "c3", "c4"], admins: [], config: onConfig,
      resolveRecipient: async ({ uid }) => {
        if (uid === "c1") throw boom;
        if (uid === "c2") return null;
        if (uid === "c3") return { skipped: "weird" };
        return { found: {} };
      },
    });
    expect(result.lineCandidates).toEqual(["c4"]);
    expect(result.skipped).toEqual({ resolve_error: 2, resolver_other: 1 });
    expect(result.resolveErrors).toEqual([{ uid: "c1", error: boom }]);
  });

  test("缺 _config（fallback）時沒有任何候選", async () => {
    const config = await readConfigWithFallback({ readConfigDoc: async () => null, nowMs: 0 });
    const result = await filterLineEligibleRecipients({
      recipients: ["c1"], admins: [], config, resolveRecipient: async () => ({ found: {} }),
    });
    expect(result.lineCandidates).toEqual([]);
  });
});

describe("decideCommentLineCaps：站內信上限＋LINE 每日上限", () => {
  const caps = { globalPerDay: 15, authorPerDay: 3, recipientPerDay: 6, authorInboxPerDay: 30 };

  test("byAuthor 每則留言只 +1；global／byRecipient 依實際通過人數", () => {
    const result = decideCommentLineCaps({ daily: null, authorUid: "u1", lineCandidates: ["c1", "a1", "a2"], caps });
    expect(result).toMatchObject({ inboxAllowed: true, lineRecipients: ["c1", "a1", "a2"], lineCapped: [], shouldWrite: true, reason: null });
    expect(result.nextDaily).toEqual({
      global: 3,
      byAuthor: { u1: 1 },
      byRecipient: { c1: 1, a1: 1, a2: 1 },
      inboxByAuthor: { u1: 1 },
    });
  });

  test("沒有 LINE 候選（未綁定或 LINE 關）：不碰 LINE 額度，只記站內信次數", () => {
    const result = decideCommentLineCaps({
      daily: { global: 2, byAuthor: { u1: 1 } }, authorUid: "u1", lineCandidates: [], caps,
    });
    expect(result.lineRecipients).toEqual([]);
    expect(result.reason).toBeNull();
    expect(result.nextDaily).toEqual({ global: 2, byAuthor: { u1: 1 }, byRecipient: {}, inboxByAuthor: { u1: 1 } });
  });

  test("作者已達 authorPerDay：整則 LINE capped，LINE 計數不動", () => {
    const daily = { global: 5, byAuthor: { u1: 3 }, byRecipient: { c1: 1 }, inboxByAuthor: { u1: 3 } };
    const result = decideCommentLineCaps({ daily, authorUid: "u1", lineCandidates: ["c1", "a1"], caps });
    expect(result.lineRecipients).toEqual([]);
    expect(result.lineCapped).toEqual([{ uid: "c1", reason: "author_cap" }, { uid: "a1", reason: "author_cap" }]);
    expect(result.reason).toBe("comment_cap");
    expect(result.nextDaily).toEqual({ global: 5, byAuthor: { u1: 3 }, byRecipient: { c1: 1 }, inboxByAuthor: { u1: 4 } });
    expect(daily.inboxByAuthor.u1).toBe(3);
  });

  test("全站只剩 1 則：依候選順序給第一位（活動管理者優先）", () => {
    const result = decideCommentLineCaps({ daily: { global: 14 }, authorUid: "u1", lineCandidates: ["c1", "a1", "a2"], caps });
    expect(result.lineRecipients).toEqual(["c1"]);
    expect(result.lineCapped).toEqual([{ uid: "a1", reason: "global_cap" }, { uid: "a2", reason: "global_cap" }]);
    expect(result.nextDaily.global).toBe(15);
    expect(result.nextDaily.byAuthor).toEqual({ u1: 1 });
  });

  test("單一收件人達上限只擋他", () => {
    const result = decideCommentLineCaps({
      daily: { byRecipient: { a1: 6 } }, authorUid: "u1", lineCandidates: ["c1", "a1"], caps,
    });
    expect(result.lineRecipients).toEqual(["c1"]);
    expect(result.lineCapped).toEqual([{ uid: "a1", reason: "recipient_cap" }]);
  });

  test("LINE 全數 capped（caps 0 的 fallback）：LINE 計數一律不寫，只記站內信次數", () => {
    const result = decideCommentLineCaps({
      daily: { global: 0 }, authorUid: "u1", lineCandidates: ["c1", "a1"], caps: undefined,
    });
    expect(result.lineRecipients).toEqual([]);
    expect(result.reason).toBe("comment_cap");
    expect(result.nextDaily).toEqual({ global: 0, byAuthor: {}, byRecipient: {}, inboxByAuthor: { u1: 1 } });
  });

  test("作者站內信達 30：整則連站內信都不寫、_daily_ 零寫入", () => {
    const daily = { global: 1, inboxByAuthor: { u1: 30 } };
    const result = decideCommentLineCaps({ daily, authorUid: "u1", lineCandidates: ["c1"], caps });
    expect(result).toEqual({
      inboxAllowed: false,
      lineRecipients: [],
      lineCapped: [{ uid: "c1", reason: "inbox_author_capped" }],
      reason: "inbox_author_capped",
      shouldWrite: false,
      nextDaily: null,
    });
  });

  test("私密連發灌站內信：第 31 則起整則停", () => {
    let daily = null;
    let allowed = 0;
    for (let i = 0; i < 35; i += 1) {
      const result = decideCommentLineCaps({ daily, authorUid: "spam", lineCandidates: [], caps });
      if (result.inboxAllowed) allowed += 1;
      if (result.shouldWrite) daily = result.nextDaily;
    }
    expect(allowed).toBe(30);
    expect(daily.inboxByAuthor.spam).toBe(30);
  });

  test("壞資料正規化、候選去重；uid 為 __proto__ 也是自有屬性", () => {
    const result = decideCommentLineCaps({
      daily: { global: "x", byAuthor: [], byRecipient: { c1: -2, c2: "3" } },
      authorUid: "__proto__",
      lineCandidates: ["c1", "c1", "", null],
      caps,
    });
    expect(result.lineRecipients).toEqual(["c1"]);
    expect(result.nextDaily.global).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(result.nextDaily.byAuthor, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result.nextDaily.byAuthor)).toBe(Object.prototype);
    expect(Object.keys(result.nextDaily.inboxByAuthor)).toEqual(["__proto__"]);
  });

  test("缺作者丟錯", () => {
    expect(() => decideCommentLineCaps({ daily: null, authorUid: "", lineCandidates: [], caps })).toThrow(TypeError);
  });
});

describe("sanitizeCommentText：壓平換行、網址換成〔連結〕、依字元截斷", () => {
  test.each([
    ["請點 https://evil.com/x 領獎", `請點 ${LINK_PLACEHOLDER} 領獎`],
    ["HTTPS://EVIL.COM/LOGIN", LINK_PLACEHOLDER],
    ["加我好友：bit.ly", `加我好友：${LINK_PLACEHOLDER}`],
    ["請看 bit.ly/abc 謝謝", `請看 ${LINK_PLACEHOLDER} 謝謝`],
    ["加 LINE.ME/ti/p/xxx", `加 ${LINK_PLACEHOLDER}`],
    ["line://ti/p/xxx", LINK_PLACEHOLDER],
    ["LINE://TI/P/XXX", LINK_PLACEHOLDER],
    ["打 tel:0912345678", `打 ${LINK_PLACEHOLDER}`],
    ["mailto:a@b.com", LINK_PLACEHOLDER],
    ["寄 a.b+c@mail.example.com", `寄 ${LINK_PLACEHOLDER}`],
    ["sub.evil.com 是官網", `${LINK_PLACEHOLDER} 是官網`],
    ["www.x.y", LINK_PLACEHOLDER],
    ["http://1.2.3.4/a 或 1.2.3.4", `${LINK_PLACEHOLDER} 或 ${LINK_PLACEHOLDER}`],
    ["ｂｉｔ．ｌｙ", LINK_PLACEHOLDER],
    ["ｈｔｔｐｓ：／／ｅｖｉｌ．ｃｏｍ", LINK_PLACEHOLDER],
    ["bit。ly/abc", LINK_PLACEHOLDER],
    [`bit${ZWSP}.ly`, LINK_PLACEHOLDER],
  ])("網址：%s", (input, expected) => {
    expect(sanitizeCommentText(input, 40)).toBe(expected);
  });

  test.each([
    "明天 19:00 集合，記得帶水。",
    "比分 3.5 分，版本 v1.0",
    "好的。明天見",
    "OK。好",
    "你好！（下雨照踢）",
  ])("一般文字不誤判：%s", (input) => {
    expect(sanitizeCommentText(input, 40)).toBe(input);
  });

  test("換行、tab、連續空白、全形空白、NEL 壓成一個空格並去頭尾", () => {
    expect(sanitizeCommentText(`  a\nb\r\nc\t\t d${IDEOGRAPHIC_SPACE}e${NEL}f  `, 40)).toBe("a b c d e f");
  });

  test("控制字元、零寬與雙向控制字元移除", () => {
    expect(sanitizeCommentText(`a${String.fromCharCode(1)}b${RLO}c${ZWSP}d`, 40)).toBe("abcd");
  });

  test("全形英數轉半形，其餘全形標點保留", () => {
    expect(sanitizeCommentText("ＡＢＣ１２３，你好！", 40)).toBe("ABC123，你好！");
  });

  test("依字元截斷加「…」，不切半 emoji", () => {
    const longText = "一二三四五六七八九十".repeat(5);
    expect(sanitizeCommentText(longText, 40)).toBe(`${"一二三四五六七八九十".repeat(4)}…`);
    const emoji = String.fromCodePoint(0x1F600);
    const out = sanitizeCommentText(emoji.repeat(45), 40);
    expect(Array.from(out)).toHaveLength(41);
    expect(out.endsWith(`${emoji}…`)).toBe(true);
    expect(sanitizeCommentText("剛好", 2)).toBe("剛好");
  });

  test("截斷不會切開〔連結〕", () => {
    expect(sanitizeCommentText(`${"x".repeat(37)} bit.ly`, 40)).toBe(`${"x".repeat(37)}…`);
    expect(sanitizeCommentText(`${"x".repeat(35)} bit.ly`, 40)).toBe(`${"x".repeat(35)} ${LINK_PLACEHOLDER}`);
    // 英數緊貼網域時整串視為網域
    expect(sanitizeCommentText(`${"x".repeat(38)}bit.ly`, 40)).toBe(LINK_PLACEHOLDER);
  });

  test("非字串與純空白回空字串", () => {
    expect(sanitizeCommentText(null, 40)).toBe("");
    expect(sanitizeCommentText(" \n ", 40)).toBe("");
  });
});

describe("buildCommentNotifyMessages：文案（公開、N 則、私密）", () => {
  test("公開 1 則", () => {
    expect(buildCommentNotifyMessages({
      eventTitle: "週六友誼賽", authorName: "小明", body: "明天\n會下雨嗎", isPrivate: false, batchCount: 1,
    })).toEqual({ title: "【活動留言】週六友誼賽", body: "小明：明天 會下雨嗎" });
  });

  test("公開 N 則（視窗後的下一則）", () => {
    expect(buildCommentNotifyMessages({
      eventTitle: "週六友誼賽", authorName: "小華", body: "+1", isPrivate: false, batchCount: 3,
    }).body).toBe("新增 3 則留言，最新 小華：+1");
  });

  test("私密一律單則，帶淨化後前 40 字；不存在公開私密混合批次", () => {
    expect(buildCommentNotifyMessages({
      eventTitle: "週六友誼賽", authorName: "小美", body: "我要請假 line.me/ti/p/abc", isPrivate: true, batchCount: 1,
    }).body).toBe(`小美（私密）：我要請假 ${LINK_PLACEHOLDER}`);
    expect(buildCommentNotifyMessages({
      eventTitle: "週六友誼賽", authorName: "小美", body: "請假", isPrivate: true, batchCount: 4,
    }).body).toBe("小美（私密）：請假");
  });

  test("活動名 30 字、留言者 20 字截斷；留言者名稱也淨化", () => {
    const result = buildCommentNotifyMessages({
      eventTitle: "長".repeat(35),
      authorName: "ToosterX 客服\nhttps://evil.com",
      body: "x".repeat(50),
      isPrivate: false,
      batchCount: 1,
    });
    expect(result.title).toBe(`【活動留言】${"長".repeat(30)}…`);
    expect(result.body).toBe(`ToosterX 客服 ${LINK_PLACEHOLDER}：${"x".repeat(40)}…`);
  });

  test("活動名或留言者空白時用預設；batchCount 不合法當 1", () => {
    expect(buildCommentNotifyMessages({ eventTitle: "", authorName: " ", body: "hi", isPrivate: false, batchCount: "3" }))
      .toEqual({ title: "【活動留言】活動", body: "用戶：hi" });
  });
});

// 顧問 §3.29：source 前綴 event_comment: 由批 1 加進 LINE_NOTIFICATION_FORCED_SOURCES。
// 這裡直接切 functions/index.js 的真實原始碼執行 resolveLineNotificationRecipient（不另寫一份），
// 以「現況常數＋批 1 要加的一行前綴」模擬，釘住：forced 只跳過全站開關，個人設定、_config 與每日上限照常。
describe("forced 前綴（§3.29）：只跳過全站開關，個人設定、_config 與每日上限照常", () => {
  const indexSource = fs.readFileSync(path.resolve(__dirname, "../../functions/index.js"), "utf8");

  function extractFunction(name) {
    const start = indexSource.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
    if (start < 0) throw new Error(`Missing helper: ${name}`);
    const end = indexSource.indexOf("\n}", start);
    return indexSource.slice(start, end + 2);
  }

  function extractConstAsVar(name) {
    const start = indexSource.search(new RegExp(`^const ${name} = `, "m"));
    if (start < 0) throw new Error(`Missing const: ${name}`);
    const end = indexSource.indexOf("]);", start);
    return `var${indexSource.slice(start + "const".length, end + 3)}`;
  }

  // 正式 featureFlags.notificationToggles 現況：9 個 key 全 false（計畫 §12.9）。
  const ALL_TOGGLES_OFF = {
    category_activity: false, category_system: false, category_tournament: false,
    type_signup_success: false, type_cancel_signup: false, type_waitlist_demoted: false,
    type_event_relisted: false, type_role_upgrade: false, type_welcome: false,
  };

  function loadResolver({ users, toggles = ALL_TOGGLES_OFF, withCommentForcedPrefix }) {
    const featureFlagReads = { count: 0 };
    const context = {
      console: { log() {}, warn() {} },
      // 批 1 把前綴加進 index.js 後，「未列 forced」情境改由移除它來模擬，兩個情境都不受常數是否已改影響。
      EXTRA_FORCED: withCommentForcedPrefix ? [COMMENT_NOTIFY_FORCED_SOURCE_PREFIX] : [],
      STRIP_FORCED: withCommentForcedPrefix ? [] : [COMMENT_NOTIFY_FORCED_SOURCE_PREFIX],
      findUserDocByUidOrLineUserId: async (uid) => (users[uid] ? { docId: uid, data: users[uid] } : null),
      db: {
        collection: () => ({
          doc: () => ({
            get: async () => {
              featureFlagReads.count += 1;
              return { exists: true, data: () => ({ notificationToggles: toggles }) };
            },
          }),
        }),
      },
    };
    const code = [
      extractConstAsVar("LINE_NOTIFICATION_FORCED_SOURCES"),
      "LINE_NOTIFICATION_FORCED_SOURCES = Object.freeze([...new Set([...LINE_NOTIFICATION_FORCED_SOURCES, ...EXTRA_FORCED])]"
        + ".filter((prefix) => !STRIP_FORCED.includes(prefix)));",
      extractConstAsVar("LINE_NOTIFICATION_TOGGLE_ALLOWED_KEYS"),
      ...[
        "getLineRecipientUidFromUserDoc", "getLineNotificationSettingsKey", "isForcedLineNotificationSource",
        "normalizeNotificationToggles", "shouldSkipLineNotificationByToggles",
        "getNotificationTogglesFromFeatureFlags", "getNotificationTogglesWithFallback",
        "resolveLineNotificationRecipient",
      ].map(extractFunction),
    ].join("\n\n");
    vm.createContext(context);
    vm.runInContext(code, context);
    return { resolveRecipient: context.resolveLineNotificationRecipient, context, featureFlagReads };
  }

  const users = {
    c1: { lineNotify: { bound: true } },
    a1: { lineNotify: { bound: true, settings: { activity: true } } },
    off: { lineNotify: { bound: true, settings: { activity: false } } },
    nobind: { lineNotify: { bound: false } },
  };
  const lineOn = { lineEnabled: true, adminLineEnabled: true };
  const caps = { globalPerDay: 15, authorPerDay: 3, recipientPerDay: 6, authorInboxPerDay: 30 };

  test("source 帶 forced 前綴，且不借 target:／template: 前綴", () => {
    expect(COMMENT_NOTIFY_FORCED_SOURCE_PREFIX).toBe("event_comment:");
    expect(COMMENT_NOTIFY_SOURCE.startsWith(COMMENT_NOTIFY_FORCED_SOURCE_PREFIX)).toBe(true);
    expect(COMMENT_NOTIFY_SOURCE.startsWith("target:")).toBe(false);
    expect(COMMENT_NOTIFY_SOURCE.startsWith("template:")).toBe(false);
  });

  test("未列 forced（批 0 時的 main 現況）時全站 category_activity=false 會擋下留言 LINE：批 1 的常數改動是必要的", async () => {
    const { resolveRecipient } = loadResolver({ users, withCommentForcedPrefix: false });
    const result = await filterLineEligibleRecipients({ recipients: ["c1"], admins: [], config: lineOn, resolveRecipient });
    expect(result.lineCandidates).toEqual([]);
    expect(result.skipped).toEqual({ notification_toggle_disabled: 1 });
  });

  test("加前綴後跳過全站開關、不讀 featureFlags；其他來源仍受全站開關", async () => {
    const { resolveRecipient, context, featureFlagReads } = loadResolver({ users, withCommentForcedPrefix: true });
    const result = await filterLineEligibleRecipients({ recipients: ["c1", "a1"], admins: ["a1"], config: lineOn, resolveRecipient });
    expect(result.lineCandidates).toEqual(["c1", "a1"]);
    expect(featureFlagReads.count).toBe(0);
    expect(context.isForcedLineNotificationSource("template:signup_success")).toBe(false);
    expect(await resolveRecipient({ uid: "c1", category: "activity", source: "template:signup_success" }))
      .toEqual({ skipped: "notification_toggle_disabled" });
  });

  test("個人 settings.activity 關閉或未綁定時不發 LINE（forced 不跳過個人設定）", async () => {
    const { resolveRecipient } = loadResolver({ users, withCommentForcedPrefix: true });
    const result = await filterLineEligibleRecipients({
      recipients: ["off", "nobind", "c1"], admins: [], config: lineOn, resolveRecipient,
    });
    expect(result.lineCandidates).toEqual(["c1"]);
    expect(result.skipped).toEqual({ category_disabled: 1, not_bound: 1 });
  });

  test("_config 缺漏時即使 forced 也不發 LINE（全站開關由 _config fail-closed 承擔）", async () => {
    const { resolveRecipient } = loadResolver({ users, withCommentForcedPrefix: true });
    const config = await readConfigWithFallback({ readConfigDoc: async () => null, nowMs: 0 });
    const eligible = await filterLineEligibleRecipients({ recipients: ["c1", "a1"], admins: ["a1"], config, resolveRecipient });
    expect(eligible.lineCandidates).toEqual([]);
    expect(eligible.shadowEligible).toBe(2);
    const capsDecision = decideCommentLineCaps({ daily: null, authorUid: "u1", lineCandidates: eligible.lineCandidates, caps: config.caps });
    expect(capsDecision.lineRecipients).toEqual([]);
    expect(capsDecision.inboxAllowed).toBe(true);
  });

  test("forced 不會讓每日上限失效：全站、作者、收件人上限照擋", async () => {
    const { resolveRecipient } = loadResolver({ users, withCommentForcedPrefix: true });
    const { lineCandidates } = await filterLineEligibleRecipients({ recipients: ["c1", "a1"], admins: ["a1"], config: lineOn, resolveRecipient });
    expect(lineCandidates).toEqual(["c1", "a1"]);
    expect(decideCommentLineCaps({ daily: { global: 15 }, authorUid: "u1", lineCandidates, caps }).lineRecipients).toEqual([]);
    expect(decideCommentLineCaps({ daily: { byAuthor: { u1: 3 } }, authorUid: "u1", lineCandidates, caps }).lineRecipients).toEqual([]);
    expect(decideCommentLineCaps({ daily: { byRecipient: { c1: 6 } }, authorUid: "u1", lineCandidates, caps }).lineRecipients)
      .toEqual(["a1"]);
    expect(decideCommentLineCaps({ daily: null, authorUid: "u1", lineCandidates, caps: undefined }).lineRecipients).toEqual([]);
  });
});
