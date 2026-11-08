"use strict";

/**
 * SP3 按鈕加速③：registerForEvent／cancelRegistration 交易內讀取並行。
 *
 * 直接跑 functions/index.js 真正的 handler（vm 載入、記憶體版 Firestore），外面再包一層
 * 「仿 Admin SDK 7.x 懶啟動交易」的排程器：
 *  - 交易第一個讀取（get 或 getAll，一次 RPC）送出後，其餘讀取排隊到它回來才送出（同 SDK withLazyStartedTransaction）。
 *  - 讀取不會自己完成，由測試一輪一輪放行；同一輪放行的讀取＝同時在路上的讀取（一輪＝一次往返）。
 *  - 可指定某個讀取失敗，用來確認「並行後錯誤優先序與改前相同」。
 *
 * 改前（循序）的往返數寫在各測試的註解裡，供對照；改後由本測試鎖定。
 */

const {
  FakeTimestamp,
  createFakeFirestore,
  loadFunctionsIndex,
} = require("./registration-callable-harness");

const U_SELF = `U${"1".repeat(32)}`;
const U_OTHER = `U${"2".repeat(32)}`;
const EVENT_ID = "ce_1800000000000_sp3";
const FUTURE = "2099/06/15 10:00~12:00";

let fn;
let harness;
let fake;

beforeAll(() => {
  const loaded = loadFunctionsIndex();
  fn = loaded.exports;
  harness = loaded.harness;
});

beforeEach(() => {
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  harness.logs.length = 0;
});

function user(uid) {
  return {
    uid, lineUserId: uid, name: `name-${uid.slice(1, 3)}`, displayName: `user-${uid.slice(1, 3)}`,
    gender: "male", birthday: "1990-01-01", region: "taipei", role: "user", exp: 100,
  };
}

function event(extra = {}) {
  return {
    id: EVENT_ID, title: "SP3 event", date: FUTURE, location: "field", type: "play",
    status: "open", max: 2, current: 0, waitlist: 0, participants: [], waitlistNames: [], ...extra,
  };
}

function reg(docId, data) {
  return {
    id: `reg_${docId}`, eventId: EVENT_ID, participantType: "self", companionId: null, companionName: null,
    promotionOrder: 0, ...data,
  };
}

function setup(seed = {}) {
  fake = createFakeFirestore({
    [`users/${U_SELF}`]: user(U_SELF),
    [`users/${U_OTHER}`]: user(U_OTHER),
    ...seed,
  });
  harness.current = fake;
  return fake;
}

function selfPayload(uid, extra = {}) {
  return { eventId: EVENT_ID, participants: [{ userId: uid, userName: `n-${uid.slice(1, 3)}` }], ...extra };
}

function labelOf(target) {
  if (target?._isQuery) {
    const filters = (target._spec?.filters || []).map((f) => `${f.field}${f.op}${f.value}`).join("&");
    return `q:${target._collectionPath}${filters ? `?${filters}` : ""}`;
  }
  return target.path;
}

// 仿 SDK 懶啟動交易＋逐輪放行的排程器。
function instrument(fakeDb, { failRead } = {}) {
  const pending = [];
  const calls = [];
  const original = fakeDb.db.runTransaction;
  fakeDb.db.runTransaction = (callback) => original(async (tx) => {
    let firstRead = null;
    const enqueue = (label, run) => new Promise((resolve, reject) => {
      pending.push({
        label,
        go: async () => {
          calls.push({ kind: "resolve", label });
          const injected = failRead ? failRead(label) : null;
          if (injected) {
            reject(injected);
            return;
          }
          try {
            resolve(await run());
          } catch (error) {
            reject(error);
          }
        },
      });
    });
    const issue = async (label, run) => {
      calls.push({ kind: "read", label });
      if (!firstRead) {
        firstRead = enqueue(label, run);
        return firstRead;
      }
      await firstRead; // 同 SDK：第一個讀取失敗時，排隊的讀取也以同一個錯誤失敗
      return enqueue(label, run);
    };
    const wrapped = {
      get: (target) => issue(labelOf(target), () => tx.get(target)),
      getAll: (...targets) => issue(targets.map(labelOf).join(" + "), () => tx.getAll(...targets)),
    };
    for (const op of ["update", "set", "create", "delete"]) {
      wrapped[op] = (...args) => {
        calls.push({ kind: "write", op, label: args[0].path });
        tx[op](...args);
        return wrapped;
      };
    }
    return callback(wrapped);
  });

  async function drive(promise) {
    let settled = false;
    let value;
    let error;
    promise.then((v) => { settled = true; value = v; }, (e) => { settled = true; error = e; });
    const waves = [];
    for (let i = 0; i < 2000 && !settled; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      if (pending.length) {
        const batch = pending.splice(0);
        waves.push(batch.map((item) => item.label));
        await Promise.all(batch.map((item) => item.go()));
      }
    }
    if (!settled) throw new Error("handler did not settle");
    return { value, error, waves, calls };
  }

  return { drive };
}

function readsBeforeWrites(calls) {
  const firstWrite = calls.findIndex((c) => c.kind === "write");
  const lastRead = calls.map((c) => c.kind).lastIndexOf("read");
  return firstWrite < 0 || lastRead < firstWrite;
}

const dedupePath = (fnName, uid, requestId) => `_regDedupe/${fnName}_${uid}_${requestId}`;

describe("registerForEvent 交易讀取分輪（按鈕加速③）", () => {
  test("一般報名：第 1 輪 getAll(去重＋活動)，第 2 輪全部報名與報名鎖同時送出；讀完才寫", async () => {
    // 改前循序：去重 → 活動 → 全部報名 → 報名鎖 ＝ 4 輪讀取
    setup({ [`events/${EVENT_ID}`]: event() });
    const { drive } = instrument(fake);
    const { value, error, waves, calls } = await drive(fn.registerForEvent({
      auth: { uid: U_SELF, token: {} },
      data: selfPayload(U_SELF, { requestId: "sp3-a" }),
    }));
    expect(error).toBeUndefined();
    expect(value.registrations[0].status).toBe("confirmed");
    expect(waves).toEqual([
      [`${dedupePath("register", U_SELF, "sp3-a")} + events/${EVENT_ID}`],
      [`q:events/${EVENT_ID}/registrations`, `events/${EVENT_ID}/registrationLocks/self_${U_SELF}`],
    ]);
    expect(readsBeforeWrites(calls)).toBe(true);
    expect(calls.filter((c) => c.kind === "write").map((c) => c.op).pop()).toBe("create"); // 去重文件最後寫
    expect(fake.get(`events/${EVENT_ID}`).current).toBe(1);
  });

  test("並行的讀取確實同時在路上：第 2 輪第一個讀取完成前，第二個已送出", async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    const { drive } = instrument(fake);
    const { waves, calls } = await drive(fn.registerForEvent({
      auth: { uid: U_SELF, token: {} },
      data: selfPayload(U_SELF),
    }));
    // 沒帶 requestId：第 1 輪只有活動直讀（getAll 一筆）
    expect(waves[0]).toEqual([`events/${EVENT_ID}`]);
    const [regsLabel, lockLabel] = [`q:events/${EVENT_ID}/registrations`, `events/${EVENT_ID}/registrationLocks/self_${U_SELF}`];
    expect(waves[1]).toEqual([regsLabel, lockLabel]);
    const indexOf = (kind, label) => calls.findIndex((c) => c.kind === kind && c.label === label);
    const firstResolveInWave2 = Math.min(indexOf("resolve", regsLabel), indexOf("resolve", lockLabel));
    expect(indexOf("read", regsLabel)).toBeGreaterThanOrEqual(0);
    expect(indexOf("read", lockLabel)).toBeLessThan(firstResolveInWave2);
    expect(indexOf("read", regsLabel)).toBeLessThan(firstResolveInWave2);
  });

  test("俱樂部名額球隊讀取與全部報名、報名鎖同一輪送出；名額判定結果不變", async () => {
    // 改前循序：去重 → 活動 → 球隊直讀 → 球隊 id 查詢 → 全部報名 → 報名鎖 ＝ 6 輪
    setup({
      [`events/${EVENT_ID}`]: event({
        max: 4,
        teamReservationSummaries: [{ teamId: "t1", teamName: "T1", reservedSlots: 1, usedSlots: 0 }],
      }),
      "teams/teamDoc1": { id: "t1", name: "T1", captainUid: U_SELF },
    });
    const { drive } = instrument(fake);
    const { value, error, waves, calls } = await drive(fn.registerForEvent({
      auth: { uid: U_SELF, token: {} },
      data: selfPayload(U_SELF, { requestId: "sp3-team" }),
    }));
    expect(error).toBeUndefined();
    expect(value.registrations[0]).toMatchObject({
      status: "confirmed", teamReservationTeamId: "t1", teamSeatSource: "reserved",
    });
    expect(waves).toEqual([
      [`${dedupePath("register", U_SELF, "sp3-team")} + events/${EVENT_ID}`],
      ["teams/t1", `q:events/${EVENT_ID}/registrations`, `events/${EVENT_ID}/registrationLocks/self_${U_SELF}`],
      ["q:teams?id==t1"],
    ]);
    expect(readsBeforeWrites(calls)).toBe(true);
  });

  test("舊活動（文件 ID ≠ 活動 id）：直讀不符時照舊走共用 helper 的 id 查詢", async () => {
    // 改前循序：去重 → 直讀 → id 查詢 → 全部報名 → 報名鎖 ＝ 5 輪；改後 4 輪
    setup({ "events/legacyDoc": event() });
    const { drive } = instrument(fake);
    const { value, error, waves } = await drive(fn.registerForEvent({
      auth: { uid: U_SELF, token: {} },
      data: selfPayload(U_SELF, { requestId: "sp3-legacy" }),
    }));
    expect(error).toBeUndefined();
    expect(value.registrations[0].status).toBe("confirmed");
    expect(waves).toEqual([
      [`${dedupePath("register", U_SELF, "sp3-legacy")} + events/${EVENT_ID}`],
      [`events/${EVENT_ID}`],
      [`q:events?id==${EVENT_ID}`],
      ["q:events/legacyDoc/registrations", `events/legacyDoc/registrationLocks/self_${U_SELF}`],
    ]);
    expect(fake.get("events/legacyDoc").current).toBe(1);
  });
});

describe("registerForEvent 判斷順序與錯誤優先序不變（按鈕加速③）", () => {
  test("去重命中：活動已刪也回原結果；只讀第 1 輪、不寫任何東西", async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    const first = await fn.registerForEvent({ auth: { uid: U_SELF, token: {} }, data: selfPayload(U_SELF, { requestId: "sp3-hit" }) });
    await fake.db.collection("events").doc(EVENT_ID).delete();
    const writesBefore = fake.state.writes.length;
    const { drive } = instrument(fake, {
      failRead: (label) => (label.startsWith("q:") ? new Error("should not read") : null),
    });
    const { value, error, waves, calls } = await drive(fn.registerForEvent({
      auth: { uid: U_SELF, token: {} },
      data: selfPayload(U_SELF, { requestId: "sp3-hit" }),
    }));
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ success: true, deduplicated: true });
    expect(value.registrations).toEqual(first.registrations);
    expect(waves).toHaveLength(1);
    expect(calls.filter((c) => c.kind === "write")).toEqual([]);
    expect(fake.state.writes.length).toBe(writesBefore);
  });

  test("同 requestId 換活動：REQUEST_ID_CONFLICT 先於 EVENT_NOT_FOUND", async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    await fn.registerForEvent({ auth: { uid: U_SELF, token: {} }, data: selfPayload(U_SELF, { requestId: "sp3-c" }) });
    await expect(fn.registerForEvent({
      auth: { uid: U_SELF, token: {} },
      data: { ...selfPayload(U_SELF, { requestId: "sp3-c" }), eventId: "ce_missing_event" },
    })).rejects.toMatchObject({ code: "failed-precondition", details: "REQUEST_ID_CONFLICT" });
  });

  test("活動不存在：EVENT_NOT_FOUND、零寫入", async () => {
    setup({});
    await expect(fn.registerForEvent({
      auth: { uid: U_SELF, token: {} },
      data: selfPayload(U_SELF, { requestId: "sp3-nf" }),
    })).rejects.toMatchObject({ code: "not-found", message: "EVENT_NOT_FOUND" });
    expect(fake.txWrites()).toEqual([]);
  });

  test("活動已結束＋全部報名讀取失敗：仍回 EVENT_ENDED（改前此時還沒讀全部報名）", async () => {
    setup({ [`events/${EVENT_ID}`]: event({ status: "ended" }) });
    const { drive } = instrument(fake, {
      failRead: (label) => (label === `q:events/${EVENT_ID}/registrations` ? new Error("regs read failed") : null),
    });
    const { error } = await drive(fn.registerForEvent({ auth: { uid: U_SELF, token: {} }, data: selfPayload(U_SELF) }));
    expect(error).toMatchObject({ code: "failed-precondition", message: "EVENT_ENDED" });
    expect(fake.txWrites()).toEqual([]);
  });

  test("報名未開放：REG_NOT_OPEN 先於報名鎖讀取失敗", async () => {
    const notOpen = new FakeTimestamp(Date.now() + 24 * 60 * 60 * 1000);
    setup({ [`events/${EVENT_ID}`]: event({ regOpenTime: notOpen, status: "upcoming" }) });
    const { drive } = instrument(fake, {
      failRead: (label) => (label.includes("/registrationLocks/") ? new Error("lock read failed") : null),
    });
    const { error } = await drive(fn.registerForEvent({ auth: { uid: U_SELF, token: {} }, data: selfPayload(U_SELF) }));
    expect(error).toMatchObject({ code: "failed-precondition", message: "REG_NOT_OPEN" });
  });

  test("黑名單擋下＋報名鎖讀取失敗：仍回 EVENT_UNAVAILABLE（改前黑名單判斷在讀鎖之前）", async () => {
    setup({ [`events/${EVENT_ID}`]: event({ blockedUids: [U_SELF] }) });
    const { drive } = instrument(fake, {
      failRead: (label) => (label.includes("/registrationLocks/") ? new Error("lock read failed") : null),
    });
    const { error } = await drive(fn.registerForEvent({ auth: { uid: U_SELF, token: {} }, data: selfPayload(U_SELF) }));
    expect(error).toMatchObject({ code: "failed-precondition", details: "EVENT_UNAVAILABLE" });
    expect(fake.txWrites()).toEqual([]);
  });

  test("正常活動＋全部報名讀取失敗：整筆失敗、零寫入（不吞讀取錯誤）", async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    const { drive } = instrument(fake, {
      failRead: (label) => (label === `q:events/${EVENT_ID}/registrations` ? new Error("regs read failed") : null),
    });
    const { error } = await drive(fn.registerForEvent({ auth: { uid: U_SELF, token: {} }, data: selfPayload(U_SELF) }));
    expect(error).toMatchObject({ code: "internal" });
    expect(fake.txWrites()).toEqual([]);
    expect(fake.list(`events/${EVENT_ID}/registrations`)).toEqual([]);
  });

  test("重複報名：ALREADY_REGISTERED", async () => {
    setup({
      [`events/${EVENT_ID}`]: event(),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", { userId: U_SELF, userName: "a", status: "confirmed" }),
    });
    await expect(fn.registerForEvent({ auth: { uid: U_SELF, token: {} }, data: selfPayload(U_SELF) }))
      .rejects.toMatchObject({ code: "already-exists", message: "ALREADY_REGISTERED" });
  });

  test("只剩報名鎖（無報名文件）：ALREADY_REGISTERED", async () => {
    setup({
      [`events/${EVENT_ID}`]: event(),
      [`events/${EVENT_ID}/registrationLocks/self_${U_SELF}`]: { key: `self_${U_SELF}`, status: "active" },
    });
    await expect(fn.registerForEvent({ auth: { uid: U_SELF, token: {} }, data: selfPayload(U_SELF) }))
      .rejects.toMatchObject({ code: "already-exists", message: "ALREADY_REGISTERED" });
  });

  test("額滿轉候補：候補、人數與活動紀錄同改前", async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 1 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", { userId: U_OTHER, userName: "b", status: "confirmed" }),
    });
    const result = await fn.registerForEvent({ auth: { uid: U_SELF, token: {} }, data: selfPayload(U_SELF) });
    expect(result.registrations[0].status).toBe("waitlisted");
    expect(result.confirmed).toBe(0);
    expect(result.waitlisted).toBe(1);
    expect(fake.get(`events/${EVENT_ID}`)).toMatchObject({ current: 1, waitlist: 1 });
    const ars = fake.list(`events/${EVENT_ID}/activityRecords`).map((id) => fake.get(`events/${EVENT_ID}/activityRecords/${id}`));
    expect(ars).toEqual([expect.objectContaining({ uid: U_SELF, status: "waitlisted" })]);
  });
});

describe("cancelRegistration 交易讀取分輪與錯誤優先序（按鈕加速③）", () => {
  function seed(extra = {}) {
    return setup({
      [`events/${EVENT_ID}`]: event({ max: 1, ...extra }),
      [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
        userId: U_SELF, userName: "a", status: "confirmed", registeredAt: new FakeTimestamp(1000),
      }),
      [`events/${EVENT_ID}/registrations/r2`]: reg("r2", {
        userId: U_OTHER, userName: "b", status: "waitlisted", registeredAt: new FakeTimestamp(2000),
      }),
      [`events/${EVENT_ID}/registrationLocks/self_${U_SELF}`]: { key: `self_${U_SELF}`, status: "active" },
      [`events/${EVENT_ID}/activityRecords/a1`]: { eventId: EVENT_ID, uid: U_SELF, status: "registered" },
      [`events/${EVENT_ID}/activityRecords/a2`]: { eventId: EVENT_ID, uid: U_OTHER, status: "waitlisted" },
    });
  }

  test("取消正取：第 1 輪 getAll(去重＋活動)，第 2 輪全部報名與 activityRecords 同時送出；遞補結果不變", async () => {
    // 改前循序：去重 → 活動 → 全部報名 → activityRecords ＝ 4 輪讀取
    seed();
    const { drive } = instrument(fake);
    const { value, error, waves, calls } = await drive(fn.cancelRegistration({
      auth: { uid: U_SELF, token: {} },
      data: { eventId: EVENT_ID, registrationIds: ["r1"], reason: "user_cancel", requestId: "sp3-x" },
    }));
    expect(error).toBeUndefined();
    expect(waves).toEqual([
      [`${dedupePath("cancel", U_SELF, "sp3-x")} + events/${EVENT_ID}`],
      [`q:events/${EVENT_ID}/registrations`, `q:events/${EVENT_ID}/activityRecords`],
    ]);
    expect(readsBeforeWrites(calls)).toBe(true);
    expect(value.cancelled.map((r) => r.docId)).toEqual(["r1"]);
    expect(value.promoted.map((r) => r.docId)).toEqual(["r2"]);
    expect(fake.get(`events/${EVENT_ID}/registrations/r1`).status).toBe("cancelled");
    expect(fake.get(`events/${EVENT_ID}/registrations/r2`).status).toBe("confirmed");
    expect(fake.has(`events/${EVENT_ID}/registrationLocks/self_${U_SELF}`)).toBe(false);
    expect(fake.get(`events/${EVENT_ID}/activityRecords/a1`).status).toBe("cancelled");
    expect(fake.get(`events/${EVENT_ID}/activityRecords/a2`).status).toBe("registered");
    expect(fake.get(`events/${EVENT_ID}`)).toMatchObject({ current: 1, waitlist: 0 });
  });

  test("去重命中：活動已刪也回原結果；只讀第 1 輪、不寫任何東西", async () => {
    seed();
    const cancelData = { eventId: EVENT_ID, registrationIds: ["r1"], reason: "user_cancel", requestId: "sp3-y" };
    const first = await fn.cancelRegistration({ auth: { uid: U_SELF, token: {} }, data: cancelData });
    await fake.db.collection("events").doc(EVENT_ID).delete();
    const { drive } = instrument(fake);
    const { value, error, waves, calls } = await drive(fn.cancelRegistration({ auth: { uid: U_SELF, token: {} }, data: cancelData }));
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ success: true, deduplicated: true });
    expect(value.cancelled).toEqual(first.cancelled);
    expect(waves).toHaveLength(1);
    expect(calls.filter((c) => c.kind === "write")).toEqual([]);
  });

  test("取消別人的報名＋activityRecords 讀取失敗：仍回 PERMISSION_DENIED", async () => {
    seed();
    const { drive } = instrument(fake, {
      failRead: (label) => (label.endsWith("/activityRecords") ? new Error("ar read failed") : null),
    });
    const { error } = await drive(fn.cancelRegistration({
      auth: { uid: U_SELF, token: {} },
      data: { eventId: EVENT_ID, registrationIds: ["r2"], reason: "user_cancel" },
    }));
    expect(error).toMatchObject({ code: "permission-denied", message: "PERMISSION_DENIED" });
    expect(fake.txWrites()).toEqual([]);
  });

  test("報名不存在＋activityRecords 讀取失敗：仍回 REG_NOT_FOUND", async () => {
    seed();
    const { drive } = instrument(fake, {
      failRead: (label) => (label.endsWith("/activityRecords") ? new Error("ar read failed") : null),
    });
    const { error } = await drive(fn.cancelRegistration({
      auth: { uid: U_SELF, token: {} },
      data: { eventId: EVENT_ID, registrationIds: ["nope"], reason: "user_cancel" },
    }));
    expect(error).toMatchObject({ code: "not-found", message: "REG_NOT_FOUND" });
  });

  test("活動已開始＋activityRecords 讀取失敗：仍回取消時限（EVENT_STARTED）、零寫入", async () => {
    seed({ date: "2000/01/01 10:00~12:00" });
    const { drive } = instrument(fake, {
      failRead: (label) => (label.endsWith("/activityRecords") ? new Error("ar read failed") : null),
    });
    const { error } = await drive(fn.cancelRegistration({
      auth: { uid: U_SELF, token: {} },
      data: { eventId: EVENT_ID, registrationIds: ["r1"], reason: "user_cancel" },
    }));
    expect(error).toMatchObject({ code: "failed-precondition", details: "EVENT_STARTED" });
    expect(fake.txWrites()).toEqual([]);
  });

  test("正常取消＋activityRecords 讀取失敗：整筆失敗、零寫入（不吞讀取錯誤）", async () => {
    seed();
    const { drive } = instrument(fake, {
      failRead: (label) => (label.endsWith("/activityRecords") ? new Error("ar read failed") : null),
    });
    const { error } = await drive(fn.cancelRegistration({
      auth: { uid: U_SELF, token: {} },
      data: { eventId: EVENT_ID, registrationIds: ["r1"], reason: "user_cancel" },
    }));
    expect(error).toMatchObject({ code: "internal" });
    expect(fake.txWrites()).toEqual([]);
    expect(fake.get(`events/${EVENT_ID}/registrations/r1`).status).toBe("confirmed");
  });

  test("活動不存在：EVENT_NOT_FOUND", async () => {
    setup({});
    await expect(fn.cancelRegistration({
      auth: { uid: U_SELF, token: {} },
      data: { eventId: EVENT_ID, registrationIds: ["r1"], reason: "user_cancel", requestId: "sp3-z" },
    })).rejects.toMatchObject({ code: "not-found", message: "EVENT_NOT_FOUND" });
  });
});
