"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  createTransferUserTeamCallable, createTransferUserTeamHandler, buildStaffRemoval, buildDedupeId,
} = require("../../functions/team-transfer");
const { MAX_USER_CREATED_TEAMS } = require("../../functions/user-team-create");

// T-090h transferUserTeam：記憶體版交易模型（同 user-team-create.test.js，非 emulator／真 SDK 驗收）。
// 修正前 functions/team-transfer.js 不存在、index.js 無 transferUserTeam 匯出，本檔全部失敗。
const indexSource = fs.readFileSync(path.join(__dirname, "../../functions/index.js"), "utf8");

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const NOW = 1790000000000;
const TEAM_ID = "tm_1789000000000_abc123";
const TEAM = `teams/${TEAM_ID}`;
const OWNER = "users/owner";
const NEW = "users/newbie";
const call = (data = {}, uid = "owner") => ({ auth: { uid }, data: { teamId: TEAM_ID, newOwnerUid: "newbie", requestId: "req_000000001", ...data } });
const base = () => ({
  [TEAM]: {
    id: TEAM_ID, name: "雷霆隊", createdVia: "user_capability", creatorUid: "owner", ownerUid: "owner", captainUid: "owner",
    captain: "Owner", captainName: "Owner", leader: "", leaderUid: null, leaders: [], leaderUids: [], leaderNames: [],
    coaches: [], coachUids: [], coachNames: [], members: 2,
  },
  [OWNER]: { uid: "owner", role: "user", displayName: "Owner", teamIds: [TEAM_ID], teamNames: ["雷霆隊"], teamId: TEAM_ID, teamName: "雷霆隊" },
  [NEW]: { uid: "newbie", role: "user", displayName: "Newbie", teamIds: ["tm_other", TEAM_ID], teamNames: ["Other", "雷霆隊"], teamId: "tm_other", teamName: "Other" },
});

function harness(seed = base()) {
  const store = new Map(Object.entries(clone(seed)));
  const versions = new Map([...store.keys()].map(key => [key, 1]));
  let serial = 1;
  let autoId = 0;
  const state = { attempts: 0, writes: [], reads: [], inboxWrites: [], beforeCommit: null, commitError: null, inboxError: null };
  const change = (key, patch) => { store.set(key, { ...(store.get(key) || {}), ...clone(patch) }); versions.set(key, ++serial); };
  const snap = key => ({ id: key.split("/").pop(), exists: store.has(key), data: () => clone(store.get(key)) });
  const doc = key => ({
    kind: "doc", path: key, id: key.split("/").pop(),
    collection: sub => ({ doc: id => doc(`${key}/${sub}/${id || "auto" + (autoId++)}`) }),
    create: async data => {
      if (state.inboxError) throw state.inboxError;
      if (store.has(key)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
      change(key, data); state.inboxWrites.push({ path: key, data: clone(data) });
    },
  });
  const query = (name, filters = [], cap = Infinity) => ({
    kind: "query", name, filters, cap,
    where: (field, op, value) => { if (op !== "==") throw new Error("op"); return query(name, [...filters, { field, value }], cap); },
    limit: value => query(name, filters, value),
  });
  const keysFor = q => [...store.keys()].filter(key => key.split("/").slice(0, -1).join("/") === q.name)
    .filter(key => q.filters.every(f => store.get(key)[f.field] === f.value)).sort().slice(0, q.cap);
  const fingerprint = t => t.kind === "doc" ? (versions.get(t.path) || 0) : JSON.stringify(keysFor(t).map(k => [k, versions.get(k)]));
  const db = {
    collection: name => ({ ...query(name), doc: id => doc(name + "/" + id) }),
    runTransaction: jest.fn(async callback => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        state.attempts++;
        const reads = [], writes = [];
        try {
          const tx = {
            get: async target => {
              if (writes.length) throw new Error("Read after write");
              reads.push([target, fingerprint(target)]);
              if (target.kind === "query") {
                const keys = keysFor(target);
                state.reads.push({ attempt, path: `query:${target.name}`, documents: Math.max(1, keys.length), cap: target.cap });
                return { docs: keys.map(snap) };
              }
              state.reads.push({ attempt, path: target.path, documents: 1 });
              return snap(target.path);
            },
            create: (ref, data) => writes.push({ op: "create", path: ref.path, data: clone(data) }),
            update: (ref, data) => writes.push({ op: "update", path: ref.path, data: clone(data), raw: data }),
            set: (ref, data) => writes.push({ op: "set", path: ref.path, data: clone(data), raw: data }),
          };
          const result = await callback(tx);
          await state.beforeCommit?.({ attempt, writes });
          const failure = state.commitError?.(attempt);
          if (failure) throw failure;
          if (reads.some(([t, v]) => fingerprint(t) !== v)) throw Object.assign(new Error("ABORTED private"), { code: 10 });
          if (writes.some(w => w.op === "create" && store.has(w.path))) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
          if (writes.some(w => w.op === "update" && !store.has(w.path))) throw new Error("NOT_FOUND");
          // 模擬 Admin SDK：值為 undefined 的欄位直接拋錯。
          if (writes.some(w => Object.values(w.raw || w.data || {}).some(v => v === undefined))) throw new Error("Cannot use undefined");
          writes.forEach(w => change(w.path, w.data));
          state.writes.push(...writes.map(w => ({ op: w.op, path: w.path, data: w.data, attempt })));
          return result;
        } catch (error) {
          if (error.code !== 10 || attempt === 5) throw error;
        }
      }
    }),
  };
  const logger = { error: jest.fn() };
  const FieldValue = { serverTimestamp: () => "SERVER_TS" };
  const buildOperationLogPayload = ({ operator, type, typeName, content, now }) => ({
    time: "fixed", operator, type, typeName, content, createdAt: "SERVER_TS", nowMs: now.getTime(),
  });
  const dependencies = { db, HttpsError, FieldValue, buildOperationLogPayload, logger, now: () => NOW };
  return {
    handler: createTransferUserTeamHandler(dependencies), dependencies, db, state, logger, change,
    get: k => clone(store.get(k)), keys: () => [...store.keys()],
  };
}

const opLogs = h => h.state.writes.filter(w => w.path.startsWith("operationLogs/"));
async function denied(h, req, code, reason) {
  const before = { team: h.get(TEAM), owner: h.get(OWNER), newbie: h.get(NEW) };
  await expect(h.handler(req)).rejects.toMatchObject({ code, message: reason });
  expect({ team: h.get(TEAM), owner: h.get(OWNER), newbie: h.get(NEW) }).toEqual(before);
  expect(h.state.writes).toEqual([]);
  expect(h.state.inboxWrites).toEqual([]);
  expect(h.logger.error).toHaveBeenCalledWith("[transferUserTeam] failed", expect.objectContaining({ function: "transferUserTeam", code, reason }));
  expect(JSON.stringify(h.logger.error.mock.calls)).not.toMatch(/owner"|newbie|tm_1789|req_000000001/);
}

describe("transferUserTeam 正常轉移", () => {
  test("三個擁有者欄位改為新經理、舊經理降為一般成員、單一交易", async () => {
    const h = harness();
    const result = await h.handler(call());
    expect(result).toEqual({
      ok: true, teamId: TEAM_ID, newOwnerUid: "newbie", deduplicated: false,
      notification: { newOwner: "written", oldOwner: "written" },
    });
    expect(h.get(TEAM)).toMatchObject({
      captainUid: "newbie", creatorUid: "newbie", ownerUid: "newbie", captain: "Newbie", captainName: "Newbie",
      createdVia: "user_capability", leaderUids: [], coachUids: [], updatedAt: "SERVER_TS", members: 2,
    });
    // 舊經理保留會籍、users 不變；新經理 teamIds 不變、teamId 已有值不補。
    expect(h.get(OWNER)).toEqual(base()[OWNER]);
    expect(h.get(NEW)).toEqual(base()[NEW]);
    expect(new Set(h.state.writes.map(w => w.attempt)).size).toBe(1);
    expect(h.state.writes.map(w => `${w.op}:${w.path.split("/")[0]}`).sort())
      .toEqual(["create:_regDedupe", "set:operationLogs", "update:teams"]);
    // 不觸發角色升級：users 沒有 role 寫入。
    expect(h.state.writes.some(w => w.path.startsWith("users/"))).toBe(false);
  });

  test("讀 5 次（去重＋俱樂部＋兩位使用者＋新經理自建上限查詢），查詢在所有寫入之前", async () => {
    const h = harness();
    await h.handler(call());
    expect(h.state.reads.map(r => r.path)).toEqual([
      `_regDedupe/${buildDedupeId("owner", "req_000000001")}`, TEAM, OWNER, NEW, "query:teams",
    ]);
    expect(h.state.reads[4].cap).toBe(MAX_USER_CREATED_TEAMS + 1);
  });

  test("最壞計費讀取：4 份單文件＋上限查詢回傳 MAX-1 份（再多就被拒）", async () => {
    const h = harness();
    for (let i = 0; i < MAX_USER_CREATED_TEAMS - 1; i++) h.change(`teams/tm_n${i}`, { creatorUid: "newbie", createdVia: "user_capability" });
    await h.handler(call());
    expect(h.state.reads.reduce((s, r) => s + r.documents, 0)).toBe(4 + (MAX_USER_CREATED_TEAMS - 1));
  });

  test("新經理已有 MAX-1 隊自建俱樂部：可轉移", async () => {
    const h = harness();
    for (let i = 0; i < MAX_USER_CREATED_TEAMS - 1; i++) h.change(`teams/tm_n${i}`, { creatorUid: "newbie", createdVia: "user_capability" });
    await expect(h.handler(call())).resolves.toMatchObject({ ok: true, deduplicated: false });
    expect(h.get(TEAM).creatorUid).toBe("newbie");
  });

  test("新經理在教練／領隊名單時也移出，只剩經理身分", async () => {
    const h = harness();
    h.change(TEAM, {
      leader: "Newbie", leaderUid: "newbie", leaders: ["Newbie", "L2"], leaderUids: ["newbie", "l2"], leaderNames: ["Newbie", "L2"],
      coaches: ["Owner", "Newbie", "C1"], coachUids: ["owner", "newbie", "c1"], coachNames: ["Owner", "Newbie", "C1"],
    });
    await h.handler(call());
    expect(h.get(TEAM)).toMatchObject({
      captainUid: "newbie", leader: "L2", leaderUid: "l2", leaders: ["L2"], leaderUids: ["l2"], leaderNames: ["L2"],
      coaches: ["C1"], coachUids: ["c1"], coachNames: ["C1"],
    });
  });

  test("舊經理 teamIds 不含本隊時不寫他的 users 文件（即使 teamId 空）", async () => {
    const h = harness();
    h.change(OWNER, { teamIds: ["tm_other"], teamNames: ["Other"], teamId: null, teamName: null });
    await expect(h.handler(call())).resolves.toMatchObject({ ok: true });
    expect(h.state.writes.some(w => w.path === OWNER)).toBe(false);
    expect(h.get(OWNER)).toMatchObject({ teamIds: ["tm_other"], teamId: null });
  });

  test("舊經理原本也在領隊／教練名單時一併清掉，名字陣列成對移除", async () => {
    const h = harness();
    h.change(TEAM, {
      leader: "Owner", leaderUid: "owner", leaders: ["Owner", "L2"], leaderUids: ["owner", "l2"], leaderNames: ["Owner", "L2"],
      coaches: ["C1", "Owner"], coachUids: ["c1", "owner"], coachNames: ["C1", "Owner"],
    });
    await h.handler(call());
    expect(h.get(TEAM)).toMatchObject({
      leader: "L2", leaderUid: "l2", leaders: ["L2"], leaderUids: ["l2"], leaderNames: ["L2"],
      coaches: ["C1"], coachUids: ["c1"], coachNames: ["C1"],
    });
  });

  test("buildStaffRemoval 舊經理不在幹部名單時不動任何欄位", () => {
    expect(buildStaffRemoval({ leaderUids: ["x"], coachUids: ["y"], leaderUid: "x" }, "owner")).toEqual({});
  });

  test("teamId／teamName 空才補，teamIds 不變", async () => {
    const h = harness();
    h.change(NEW, { teamId: null, teamName: "" });
    h.change(OWNER, { teamName: "" });
    await h.handler(call());
    expect(h.get(NEW)).toMatchObject({ teamId: TEAM_ID, teamName: "雷霆隊", teamIds: ["tm_other", TEAM_ID] });
    expect(h.get(OWNER)).toMatchObject({ teamId: TEAM_ID, teamName: "雷霆隊", teamIds: [TEAM_ID] });
    const userWrites = h.state.writes.filter(w => w.path.startsWith("users/"));
    expect(userWrites.map(w => w.data)).toEqual(expect.arrayContaining([{ teamId: TEAM_ID, teamName: "雷霆隊" }, { teamName: "雷霆隊" }]));
    userWrites.forEach(w => expect(Object.keys(w.data).every(k => ["teamId", "teamName"].includes(k))).toBe(true));
  });

  test("轉移後新經理可再轉回（舊經理已無擁有者身分，不能再轉）", async () => {
    const h = harness();
    await h.handler(call());
    const writes = h.state.writes.length;
    await expect(h.handler(call({ requestId: "req_000000002", newOwnerUid: "newbie" })))
      .rejects.toMatchObject({ code: "permission-denied", message: "TEAM_TRANSFER_DENIED" });
    expect(h.state.writes).toHaveLength(writes);
    await expect(h.handler(call({ requestId: "req_back00001", newOwnerUid: "owner" }, "newbie"))).resolves.toMatchObject({ ok: true });
    expect(h.get(TEAM)).toMatchObject({ captainUid: "owner", creatorUid: "owner", ownerUid: "owner" });
  });
});

describe("transferUserTeam 稽核與通知", () => {
  test("operationLogs type team_transfer，內容不含 UID 以外的秘密", async () => {
    const h = harness();
    await h.handler(call());
    const [log] = opLogs(h);
    expect(log.op).toBe("set");
    expect(log.path).toMatch(new RegExp(`^operationLogs/op_${NOW}_[a-z0-9]+$`));
    expect(log.data).toEqual({
      time: "fixed", operator: "Owner", type: "team_transfer", typeName: "轉移俱樂部經理",
      content: "Owner 將「雷霆隊」的經理轉移給「Newbie」", createdAt: "SERVER_TS", nowMs: NOW,
      actorUid: "owner", targetUid: "newbie", teamId: TEAM_ID, source: "callable",
    });
  });

  test("operator 無 displayName 時用角色標籤", async () => {
    const h = harness(); h.change(OWNER, { displayName: "" , name: "本名" });
    await h.handler(call());
    expect(opLogs(h)[0].data).toMatchObject({ operator: "一般用戶", content: "本名 將「雷霆隊」的經理轉移給「Newbie」" });
  });

  test("兩封站內信：收件人、文案、系統寄件", async () => {
    const h = harness();
    await h.handler(call());
    expect(h.state.inboxWrites).toHaveLength(2);
    const byUser = Object.fromEntries(h.state.inboxWrites.map(w => [w.path.split("/")[1], w]));
    expect(byUser.newbie.path).toMatch(/^users\/newbie\/inbox\//);
    expect(byUser.newbie.data).toMatchObject({
      title: "俱樂部經理轉移", body: "「Owner」已將「雷霆隊」俱樂部的經理轉移給您。",
      type: "system", typeName: "系統", senderName: "系統", fromUid: "owner", read: false, createdAt: "SERVER_TS",
    });
    expect(byUser.newbie.data.id).toBe(byUser.newbie.path.split("/").pop());
    expect(byUser.owner.data).toMatchObject({
      title: "俱樂部經理轉移", body: "您已將「雷霆隊」俱樂部的經理轉移給「Newbie」，您仍保留一般成員身分。",
    });
  });

  test("通知失敗不回滾轉移，只記錄", async () => {
    const h = harness();
    h.state.inboxError = Object.assign(new Error("secret newbie"), { code: "unavailable" });
    const result = await h.handler(call());
    expect(result).toMatchObject({ ok: true, notification: { newOwner: "failed", oldOwner: "failed" } });
    expect(h.get(TEAM).captainUid).toBe("newbie");
    expect(h.logger.error).toHaveBeenCalledWith("[transferUserTeam] notification failed", expect.objectContaining({ stage: "notify", code: "unavailable" }));
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toMatch(/secret|newbie/);
  });
});

describe("transferUserTeam 拒絕條件", () => {
  test("未登入", async () => {
    await expect(harness().handler({ data: call().data })).rejects.toMatchObject({ code: "unauthenticated", message: "AUTH_REQUIRED" });
  });
  test("非擁有者（一般成員）不能轉", async () => {
    const h = harness(); h.change("users/member", { uid: "member", teamIds: [TEAM_ID] });
    await denied(h, call({}, "member"), "permission-denied", "TEAM_TRANSFER_DENIED");
  });
  test("隊內教練／領隊（非 OWNER_FIELDS）不能轉", async () => {
    const h = harness(); h.change(TEAM, { coachUids: ["coachy"], leaderUids: ["leady"] });
    await denied(h, call({}, "coachy"), "permission-denied", "TEAM_TRANSFER_DENIED");
    await denied(h, call({}, "leady"), "permission-denied", "TEAM_TRANSFER_DENIED");
  });
  test("新經理不是成員", async () => {
    const h = harness(); h.change(NEW, { teamIds: ["tm_other"], teamId: "tm_other" });
    await denied(h, call(), "failed-precondition", "NEW_OWNER_NOT_MEMBER");
  });
  test("只有 teamId 單值、teamIds 不含本隊也視為非成員", async () => {
    const h = harness(); h.change(NEW, { teamIds: [], teamId: TEAM_ID });
    await denied(h, call(), "failed-precondition", "NEW_OWNER_NOT_MEMBER");
  });
  test("新經理文件不存在／身分不符", async () => {
    const seed = base(); delete seed[NEW];
    await denied(harness(seed), call(), "not-found", "NEW_OWNER_NOT_FOUND");
    const h = harness(); h.change(NEW, { uid: "someone" });
    await denied(h, call(), "failed-precondition", "NEW_OWNER_IDENTITY_MISMATCH");
  });
  test("新經理自建俱樂部已達上限（MAX 隊）拒絕；legacy 與他人的隊不計", async () => {
    const seed = base();
    for (let i = 0; i < MAX_USER_CREATED_TEAMS; i++) seed[`teams/tm_n${i}`] = { creatorUid: "newbie", createdVia: "user_capability" };
    await denied(harness(seed), call(), "resource-exhausted", "NEW_OWNER_TEAM_LIMIT");
    delete seed["teams/tm_n0"];
    seed["teams/tm_legacy"] = { creatorUid: "newbie" };
    seed["teams/tm_others"] = { creatorUid: "third", createdVia: "user_capability" };
    await expect(harness(seed).handler(call())).resolves.toMatchObject({ ok: true });
  });
  test("新經理在交易期間自建到上限：重試時重讀查詢而拒絕", async () => {
    const seed = base();
    for (let i = 0; i < MAX_USER_CREATED_TEAMS - 1; i++) seed[`teams/tm_n${i}`] = { creatorUid: "newbie", createdVia: "user_capability" };
    const h = harness(seed);
    h.state.beforeCommit = ({ attempt }) => { if (attempt === 1) h.change("teams/tm_race", { creatorUid: "newbie", createdVia: "user_capability" }); };
    await expect(h.handler(call())).rejects.toMatchObject({ code: "resource-exhausted", message: "NEW_OWNER_TEAM_LIMIT" });
    expect(h.state.attempts).toBe(2);
    expect(h.get(TEAM).captainUid).toBe("owner");
  });
  test("新經理＝自己", async () => {
    await denied(harness(), call({ newOwnerUid: "owner" }), "invalid-argument", "TRANSFER_TO_SELF");
  });
  test.each([
    ["無 createdVia（legacy）", undefined],
    ["管理端標記", "admin"],
    ["大小寫變體", "USER_CAPABILITY"],
    ["含空白變體", "user_capability "],
  ])("非自建俱樂部必拒：%s", async (_label, createdVia) => {
    const seed = base();
    if (createdVia === undefined) delete seed[TEAM].createdVia; else seed[TEAM].createdVia = createdVia;
    await denied(harness(seed), call(), "failed-precondition", "TEAM_NOT_USER_CREATED");
  });
  test("俱樂部不存在", async () => {
    await denied(harness(), call({ teamId: "tm_1789000000000_zzzzzz" }), "not-found", "TEAM_NOT_FOUND");
  });
  test.each([
    [{ createdVia: "user_capability" }], [{ captainUid: "x" }], [{ ownerUid: "owner" }], [{ team: {} }],
  ])("請求帶額外欄位（含偽造 createdVia／擁有者）一律拒絕：%j", async patch => {
    await denied(harness(), call(patch), "invalid-argument", "TRANSFER_USER_TEAM_UNKNOWN_FIELD");
  });
  test.each([
    [{ teamId: "" }], [{ teamId: `teams/${TEAM_ID}` }], [{ teamId: ` ${TEAM_ID}` }], [{ teamId: ".." }],
    [{ newOwnerUid: "" }], [{ newOwnerUid: "a/b" }], [{ newOwnerUid: 5 }], [{ newOwnerUid: " newbie" }],
  ])("不合格 id 拒絕：%j", async patch => {
    await denied(harness(), call(patch), "invalid-argument", "TRANSFER_USER_TEAM_INVALID_INPUT");
  });
  test.each([undefined, "", "short", "a/b/c/d/e", "x".repeat(65)])("不合格 requestId %p 拒絕", async requestId => {
    await denied(harness(), call({ requestId }), "invalid-argument", "TRANSFER_USER_TEAM_INVALID_REQUEST_ID");
  });
});

describe("transferUserTeam 提權攻擊", () => {
  test("轉給非成員（拉外人進來當經理）被拒", async () => {
    const h = harness(); h.change("users/outsider", { uid: "outsider", role: "user", teamIds: ["tm_other"] });
    await denied(h, call({ newOwnerUid: "outsider" }), "failed-precondition", "NEW_OWNER_NOT_MEMBER");
  });
  test("轉走他人的自建俱樂部被拒（即使自己是該隊成員）", async () => {
    const seed = base();
    seed[TEAM] = { ...seed[TEAM], creatorUid: "victim", ownerUid: "victim", captainUid: "victim" };
    seed["users/victim"] = { uid: "victim" };
    const h = harness(seed);
    await denied(h, call(), "permission-denied", "TEAM_TRANSFER_DENIED");
    // 另一位成員也不能把他人的隊轉給別人。
    await denied(h, call({ newOwnerUid: "owner" }, "newbie"), "permission-denied", "TEAM_TRANSFER_DENIED");
  });
  test("legacy 俱樂部的隊長也不能用本 Callable 轉移", async () => {
    const seed = base(); delete seed[TEAM].createdVia;
    await denied(harness(seed), call(), "failed-precondition", "TEAM_NOT_USER_CREATED");
  });
  test("呼叫者 users 文件身分不符時 fail-closed", async () => {
    const h = harness(); h.change(OWNER, { lineUserId: "other" });
    await denied(h, call(), "failed-precondition", "USER_IDENTITY_MISMATCH");
  });
});

describe("transferUserTeam 冪等與並發", () => {
  test("同一 requestId 重送：回同一結果、不再寫、不再通知", async () => {
    const h = harness();
    await h.handler(call());
    const writes = h.state.writes.length;
    const second = await h.handler(call());
    expect(second).toEqual({ ok: true, teamId: TEAM_ID, newOwnerUid: "newbie", deduplicated: true, notification: null });
    expect(h.state.writes).toHaveLength(writes);
    expect(h.state.inboxWrites).toHaveLength(2);
    expect(h.get(`_regDedupe/${buildDedupeId("owner", "req_000000001")}`)).toMatchObject({
      callerUid: "owner", kind: "team_transfer", teamId: TEAM_ID, newOwnerUid: "newbie", createdAt: "SERVER_TS",
    });
  });
  test("同一 requestId 換參數重送被拒", async () => {
    const h = harness(); await h.handler(call());
    h.change("users/third", { uid: "third", teamIds: [TEAM_ID] });
    await expect(h.handler(call({ newOwnerUid: "third" }))).rejects.toMatchObject({ code: "failed-precondition", message: "TRANSFER_REQUEST_ID_CONFLICT" });
    expect(h.get(TEAM).captainUid).toBe("newbie");
  });
  test("去重 key 含 callerUid：他人同 requestId 不會撞到", () => {
    expect(buildDedupeId("a", "req_000000001")).not.toBe(buildDedupeId("b", "req_000000001"));
  });
  test("報名路徑刻意以同 id 種的去重文件（無 kind、callerUid 為他人）不會被當成已轉移", async () => {
    const h = harness();
    // registerForEvent 的 _regDedupe 文件形狀：{ callerUid, createdAt, expiresAt }，id＝客戶端 requestId。
    h.change(`_regDedupe/${buildDedupeId("owner", "req_000000001")}`, { callerUid: "attacker", createdAt: "x" });
    await denied(h, call(), "failed-precondition", "TRANSFER_REQUEST_ID_CONFLICT");
    h.change(`_regDedupe/${buildDedupeId("owner", "req_000000001")}`, { callerUid: "owner", teamId: TEAM_ID, newOwnerUid: "newbie" });
    await expect(h.handler(call())).rejects.toMatchObject({ message: "TRANSFER_REQUEST_ID_CONFLICT" });
  });
  test("並發兩次轉移（不同 requestId、不同新經理）只成功一次", async () => {
    const h = harness();
    h.change("users/third", { uid: "third", displayName: "Third", teamIds: [TEAM_ID] });
    // 第一個請求讀完、提交前，另一個轉移已先提交（交易內重讀 team 版本不同 → ABORTED → 重試時已非擁有者）。
    h.state.beforeCommit = ({ attempt }) => {
      if (attempt === 1) {
        h.state.beforeCommit = null;
        h.change(TEAM, { captainUid: "third", creatorUid: "third", ownerUid: "third" });
      }
    };
    await expect(h.handler(call())).rejects.toMatchObject({ code: "permission-denied", message: "TEAM_TRANSFER_DENIED" });
    expect(h.state.attempts).toBe(2);
    expect(h.get(TEAM)).toMatchObject({ captainUid: "third", ownerUid: "third", creatorUid: "third" });
    expect(opLogs(h)).toEqual([]);
  });
  test("並發同一 requestId：重試時看到去重文件，回 deduplicated", async () => {
    const h = harness();
    const dedupeKey = `_regDedupe/${buildDedupeId("owner", "req_000000001")}`;
    h.state.beforeCommit = ({ attempt }) => {
      if (attempt === 1) h.change(dedupeKey, { callerUid: "owner", kind: "team_transfer", teamId: TEAM_ID, newOwnerUid: "newbie" });
    };
    await expect(h.handler(call())).resolves.toMatchObject({ deduplicated: true, notification: null });
    expect(h.state.writes).toEqual([]);
  });
  test("新經理在交易期間離隊：重試時重讀而拒絕", async () => {
    const h = harness();
    h.state.beforeCommit = ({ attempt }) => { if (attempt === 1) h.change(NEW, { teamIds: ["tm_other"] }); };
    await expect(h.handler(call())).rejects.toMatchObject({ code: "failed-precondition", message: "NEW_OWNER_NOT_MEMBER" });
    expect(h.get(TEAM).captainUid).toBe("owner");
  });
});

describe("transferUserTeam undefined 寫入與錯誤遮罩", () => {
  test("缺 displayName／leader 欄位不寫出 undefined", async () => {
    const seed = base();
    seed[NEW] = { uid: "newbie", teamIds: [TEAM_ID] };
    seed[TEAM] = { name: "雷霆隊", createdVia: "user_capability", captainUid: "owner", leaderUids: ["owner"], leaders: ["Owner"] };
    const h = harness(seed);
    await expect(h.handler(call())).resolves.toMatchObject({ ok: true });
    const update = h.state.writes.find(w => w.path === TEAM).data;
    expect(update).toMatchObject({ captain: "", captainName: "", leaderUids: [], leaders: [], leaderNames: [], leaderUid: null, leader: "" });
    expect(h.get(NEW)).toMatchObject({ teamId: TEAM_ID, teamName: "雷霆隊" });
    expect(opLogs(h)[0].data.content).toBe("Owner 將「雷霆隊」的經理轉移給「成員」");
  });
  test("呼叫者 users 文件不存在仍可轉，不寫呼叫者文件", async () => {
    const seed = base(); delete seed[OWNER];
    const h = harness(seed);
    await expect(h.handler(call())).resolves.toMatchObject({ ok: true });
    expect(h.state.writes.some(w => w.path === OWNER)).toBe(false);
    expect(opLogs(h)[0].data).toMatchObject({ operator: "系統", content: "經理 將「雷霆隊」的經理轉移給「Newbie」" });
  });
  test("ABORTED 用盡回固定 aborted", async () => {
    const h = harness(); h.state.commitError = () => Object.assign(new Error("secret owner"), { code: 10 });
    await denied(h, call(), "aborted", "TRANSFER_USER_TEAM_RETRY");
    expect(h.state.attempts).toBe(5);
  });
  test("非預期錯誤回 internal 不外洩", async () => {
    const h = harness(); h.state.commitError = () => new HttpsError("private-code", "private details");
    await denied(h, call(), "internal", "TRANSFER_USER_TEAM_FAILED");
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toMatch(/private/);
  });
});

describe("transferUserTeam 匯出", () => {
  test("index 匯出走 factory 與既有 region", () => {
    const h = harness(), onCall = jest.fn((options, handler) => ({ options, handler }));
    const callable = createTransferUserTeamCallable({ onCall, ...h.dependencies });
    expect(callable.options).toEqual({ region: "asia-east1" });
    expect(indexSource).toContain('const { createTransferUserTeamCallable } = require("./team-transfer");');
    const scope = { exports: {}, createTransferUserTeamCallable: jest.fn(() => "callable"), onCall, ...h.dependencies };
    const start = indexSource.indexOf("exports.transferUserTeam =");
    vm.runInNewContext(indexSource.slice(start, indexSource.indexOf(");", start) + 2), scope);
    expect(scope.exports.transferUserTeam).toBe("callable");
    expect(scope.createTransferUserTeamCallable).toHaveBeenCalledWith(expect.objectContaining({
      onCall, HttpsError, db: h.db, FieldValue: h.dependencies.FieldValue,
      buildOperationLogPayload: h.dependencies.buildOperationLogPayload, logger: h.logger,
    }));
  });
});
