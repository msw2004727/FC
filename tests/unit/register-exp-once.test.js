"use strict";

// 報名經驗值「每人每場只發一次」＋本人取消扣回 10（顧問 §3.620；設計 register-cancel-exp-design §8）。
// 用記憶體版 Firestore 跑真的 registerForEvent／cancelRegistration／forceDemote／forcePromote。

const fs = require("fs");
const path = require("path");
const {
  FakeTimestamp,
  createFakeFirestore,
  loadFunctionsIndex,
} = require("./registration-callable-harness");

const U_SELF = `U${"1".repeat(32)}`;
const U_OTHER = `U${"2".repeat(32)}`;
const U_SUPER = `U${"9".repeat(32)}`;
const PUB_ID = "ce_1800000000000_abc";
const DOC_ID = "legacyDoc000111";
const PUB_ID_2 = "ce_1800000000001_def";
const FUTURE = "2099/06/15 10:00~12:00";

let fn;
let harness;
let fake;

beforeAll(() => {
  const loaded = loadFunctionsIndex();
  fn = loaded.exports;
  harness = loaded.harness;
});

function user(uid, extra = {}) {
  return {
    uid, lineUserId: uid, name: "self", displayName: "self", gender: "male",
    birthday: "1990-01-01", region: "taipei", role: "user", exp: 100, ...extra,
  };
}

function event(id, extra = {}) {
  return {
    id, title: "測試活動", date: FUTURE, location: "field", type: "play",
    status: "open", max: 10, current: 0, waitlist: 0, participants: [], waitlistNames: [],
    ...extra,
  };
}

function reg(id, extra = {}) {
  return {
    id, userId: U_SELF, userName: "self", status: "confirmed", participantType: "self",
    registeredAt: new FakeTimestamp(1000), ...extra,
  };
}

function seed(extra = {}) {
  fake = createFakeFirestore({
    [`users/${U_SELF}`]: user(U_SELF),
    [`users/${U_OTHER}`]: user(U_OTHER),
    [`users/${U_SUPER}`]: user(U_SUPER, { role: "super_admin" }),
    [`events/${DOC_ID}`]: event(PUB_ID),
    [`events/${PUB_ID_2}`]: event(PUB_ID_2),
    ...extra,
  });
  harness.current = fake;
  return fake;
}

const expOf = (uid) => fake.get(`users/${uid}`).exp;
const registerSelf = (eventId = PUB_ID, uid = U_SELF) => fn.registerForEvent({
  auth: { uid, token: {} },
  data: { eventId, participants: [{ userId: uid, userName: "self" }] },
});
const cancel = (eventId, registrationIds, uid = U_SELF) => fn.cancelRegistration({
  auth: { uid, token: {} },
  data: { eventId, registrationIds },
});
const activeRegId = (docId, uid = U_SELF) => fake.list(`events/${docId}/registrations`)
  .find((id) => {
    const data = fake.get(`events/${docId}/registrations/${id}`);
    return data.userId === uid && data.participantType !== "companion"
      && (data.status === "confirmed" || data.status === "waitlisted");
  });
// 去重命中要當成正常結果，不能變成後置失敗（後置失敗只記 log、不讓 Callable 失敗，所以要看 log）
const postCommitErrors = () => harness.logs
  .filter((entry) => entry[0] === "error")
  .filter((entry) => JSON.stringify(entry.slice(1)).match(/bestEffortPostCommitOps|POST_COMMIT_FAILED/));
const registerLogs = () => fake.list("expLogs")
  .map((id) => fake.get(`expLogs/${id}`))
  .filter((log) => log.ruleKey === "register_activity");

beforeEach(() => {
  harness.logs.length = 0;
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("報名 +10 每人每場只發一次", () => {
  test("去重鍵用公開 data.id，不是文件 ID；寫在 _expDedupe", async () => {
    seed();
    await registerSelf();
    expect(expOf(U_SELF)).toBe(110);
    expect(fake.get(`_expDedupe/regexp_${U_SELF}_${PUB_ID}`)).toMatchObject({ ruleKey: "register_activity" });
    expect(fake.get(`_expDedupe/regexp_${U_SELF}_${DOC_ID}`)).toBeUndefined();
  });

  test("取消再報名三輪：只第一次 +10，每次本人取消 −10，經驗值永遠不超過第一次報名後", async () => {
    seed();
    const history = [];
    for (let round = 0; round < 3; round += 1) {
      await registerSelf();
      history.push(expOf(U_SELF));
      await cancel(PUB_ID, [activeRegId(DOC_ID)]);
      history.push(expOf(U_SELF));
    }
    // +10 → −10 → 再報名不加（淨 0）→ 之後每輪只剩取消 −10
    expect(history).toEqual([110, 100, 100, 90, 90, 80]);
    expect(registerLogs()).toHaveLength(1);
    expect(postCommitErrors()).toEqual([]);
  });

  test("降再升：forceDemote 後 forcePromote，第二次進入正取不加分", async () => {
    seed();
    await registerSelf();
    expect(expOf(U_SELF)).toBe(110);
    const regId = activeRegId(DOC_ID);
    for (let round = 0; round < 3; round += 1) {
      await fn.forceDemoteToWaitlist({ auth: { uid: U_SUPER }, data: { eventId: PUB_ID, userId: U_SELF, registrationId: regId } });
      expect(fake.get(`events/${DOC_ID}/registrations/${regId}`).status).toBe("waitlisted");
      await fn.forcePromoteWaitlist({ auth: { uid: U_SUPER }, data: { eventId: PUB_ID, userId: U_SELF, registrationId: regId } });
      expect(fake.get(`events/${DOC_ID}/registrations/${regId}`).status).toBe("confirmed");
    }
    expect(expOf(U_SELF)).toBe(110);
    expect(registerLogs()).toHaveLength(1);
    expect(postCommitErrors()).toEqual([]);
  });

  test("候補遞補與本人報名共用同一把鍵：先候補被遞補 +10，之後取消再報名正取不加", async () => {
    seed({
      [`events/${DOC_ID}`]: event(PUB_ID, { max: 1 }),
    });
    await registerSelf(PUB_ID, U_OTHER);
    await registerSelf(PUB_ID, U_SELF);
    expect(fake.get(`events/${DOC_ID}/registrations/${activeRegId(DOC_ID, U_SELF)}`).status).toBe("waitlisted");
    expect(expOf(U_SELF)).toBe(100);
    await cancel(PUB_ID, [activeRegId(DOC_ID, U_OTHER)], U_OTHER);
    expect(fake.get(`events/${DOC_ID}/registrations/${activeRegId(DOC_ID, U_SELF)}`).status).toBe("confirmed");
    expect(expOf(U_SELF)).toBe(110);
    expect(fake.get(`_expDedupe/regexp_${U_SELF}_${PUB_ID}`)).toBeTruthy();
    await cancel(PUB_ID, [activeRegId(DOC_ID, U_SELF)]);
    expect(expOf(U_SELF)).toBe(100);
    await registerSelf(PUB_ID, U_SELF);
    expect(expOf(U_SELF)).toBe(100);
  });

  test("不同場各自發一次", async () => {
    seed();
    await registerSelf(PUB_ID);
    await registerSelf(PUB_ID_2);
    expect(expOf(U_SELF)).toBe(120);
    expect(registerLogs()).toHaveLength(2);
  });
});

describe("本人取消扣回（user_cancel）", () => {
  test("同行者一起取消：只扣本人那筆 10，同行者不扣", async () => {
    seed({
      [`events/${DOC_ID}/registrations/r1`]: reg("r1"),
      [`events/${DOC_ID}/registrations/c1`]: reg("c1", { participantType: "companion", companionId: "cmp1", userName: "c1" }),
      [`events/${DOC_ID}/registrations/c2`]: reg("c2", { participantType: "companion", companionId: "cmp2", userName: "c2" }),
    });
    await cancel(PUB_ID, ["r1", "c1", "c2"]);
    expect(expOf(U_SELF)).toBe(90);
    const cancelLogs = fake.list("expLogs").map((id) => fake.get(`expLogs/${id}`))
      .filter((log) => log.ruleKey === "cancel_registration");
    expect(cancelLogs).toHaveLength(1);
    expect(cancelLogs[0].amount).toBe("-10");
  });

  test("候補取消不扣", async () => {
    seed({ [`events/${DOC_ID}/registrations/r1`]: reg("r1", { status: "waitlisted" }) });
    await cancel(PUB_ID, ["r1"]);
    expect(fake.get(`events/${DOC_ID}/registrations/r1`).status).toBe("cancelled");
    expect(expOf(U_SELF)).toBe(100);
  });

  test("早鳥正取取消不扣", async () => {
    seed({ [`events/${DOC_ID}/registrations/r1`]: reg("r1", { earlyBird: true, earlyBirdCost: 20 }) });
    await cancel(PUB_ID, ["r1"]);
    expect(fake.get(`events/${DOC_ID}/registrations/r1`).status).toBe("cancelled");
    expect(expOf(U_SELF)).toBe(100);
  });

  test("沒有 participantType 的舊正取報名照本人扣 10；扣分不帶去重鍵，兩場各扣一次", async () => {
    const legacy = reg("r1");
    delete legacy.participantType;
    seed({
      [`events/${DOC_ID}/registrations/r1`]: legacy,
      [`events/${PUB_ID_2}/registrations/r2`]: reg("r2"),
    });
    await cancel(PUB_ID, ["r1"]);
    await cancel(PUB_ID_2, ["r2"]);
    expect(expOf(U_SELF)).toBe(80);
    expect(fake.list("_expDedupe").filter((id) => id.startsWith("regexp_"))).toEqual([]);
  });

  test("扣回判斷不進回傳值與取消去重文件", async () => {
    seed({ [`events/${DOC_ID}/registrations/r1`]: reg("r1") });
    const result = await fn.cancelRegistration({
      auth: { uid: U_SELF, token: {} },
      data: { eventId: PUB_ID, registrationIds: ["r1"], requestId: "req-refund-1" },
    });
    expect(result).not.toHaveProperty("expRefundDocIds");
    const dedupeDocs = fake.list("_regDedupe").map((id) => fake.get(`_regDedupe/${id}`));
    expect(dedupeDocs).toHaveLength(1);
    expect(JSON.stringify(dedupeDocs)).toContain("r1");
    expect(JSON.stringify(dedupeDocs)).not.toContain("expRefundDocIds");
  });
});

describe("呼叫點契約", () => {
  test("functions 內每個 register_activity 的 adjustExpInternal 呼叫都帶 regexp_ 去重鍵", () => {
    const dir = path.join(__dirname, "..", "..", "functions");
    const files = ["index.js", "event-roster-status.js", "team-reservation-release.js"];
    let calls = 0;
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      const re = /adjustExpInternal\(\{([\s\S]*?)\}\)/g;
      let m;
      while ((m = re.exec(source))) {
        if (!m[1].includes('"register_activity"')) continue;
        calls += 1;
        expect(`${file}: ${m[1]}`).toMatch(/dedupKey: `regexp_\$\{[^}]+\}_\$\{[^}]+\}`/);
      }
    }
    expect(calls).toBe(7);
  });
});
