"use strict";

// 僅驗證 eduCheckin Callable 與實際 F1 resolver；A 畫面直寫 eduAttendance 不在此驗收範圍。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");
const { FakeHttpsError, FieldValue } = require("./team-callable-fake-db");

const sourcePath = path.join(__dirname, "../../functions/index.js");
const source = fs.readFileSync(sourcePath, "utf8");
const start = source.indexOf("exports.eduCheckin = onCall(");
const end = source.indexOf("\n// T-022:", start);
const resolverImport = source.split("\n").find(line => line.includes('require("./team-membership-core")'));
const TEAM = "tm_checkin";
const CALLER = "U-staff";
const DATE = "2026-11-04";
const record = { studentId: "student_fixture", studentName: "測試學員", date: DATE };

function setup(teams = { [TEAM]: { id: TEAM, captainUid: CALLER } }, existing = []) {
  const writes = [];
  const reads = [];
  const stored = { teams: new Map(Object.entries(teams)), eduAttendance: new Map(existing.map((data, i) => ["existing_" + i, data])) };
  let nextId = 0;
  const snapshot = (name, id) => ({ id, exists: stored[name].has(id), data: () => stored[name].get(id) });
  function collection(name, filters = [], max = Infinity) {
    return {
      doc(id = "generated_" + (++nextId)) {
        return { id, path: name + "/" + id, get: async () => {
          reads.push({ name, id });
          return snapshot(name, id);
        } };
      },
      where: (field, operator, value) => collection(name, [...filters, { field, operator, value }], max),
      limit: value => collection(name, filters, value),
      async get() {
        reads.push({ name, filters, max });
        const docs = [...stored[name]].filter(([, data]) => filters.every(({ field, operator, value }) => {
          if (operator === "==") return data[field] === value;
          if (operator === "in") return value.includes(data[field]);
          throw new Error("Unexpected query operator: " + operator);
        })).slice(0, max).map(([id]) => snapshot(name, id));
        return { docs, empty: docs.length === 0, forEach: callback => docs.forEach(callback) };
      },
    };
  }
  const commit = jest.fn();
  const db = { collection, batch: () => {
    const staged = [];
    return {
      set: (ref, data) => staged.push({ path: ref.path, data }),
      commit: async () => { writes.push(...staged); commit(); },
    };
  } };
  const context = { exports: {}, require: createRequire(sourcePath), db, HttpsError: FakeHttpsError, FieldValue, Date,
    onCall: jest.fn((_options, handler) => handler) };
  if (start < 0 || end < start || !resolverImport) throw new Error("Callable source boundary missing");
  vm.runInNewContext(resolverImport + "\n" + source.slice(start, end), context, { filename: sourcePath });
  const call = (teamId = TEAM, uid = CALLER, records = [record]) => context.exports.eduCheckin({
    auth: uid ? { uid } : undefined, data: { teamId, records },
  });
  return { call, writes, reads, commit, onCall: context.onCall };
}

beforeEach(() => jest.useFakeTimers().setSystemTime(new Date("2026-11-04T04:00:00Z")));
afterEach(() => jest.useRealTimers());

describe("M3 eduCheckin Callable only: F1 team resolver", () => {
  test("canonical 文件優先，保留 asia-east1 與職員簽到寫入", async () => {
    const { call, writes, reads, onCall } = setup();
    await expect(call()).resolves.toMatchObject({ success: true, count: 1 });
    expect(onCall).toHaveBeenCalledWith({ region: "asia-east1", timeoutSeconds: 30 }, expect.any(Function));
    expect(reads.filter(r => r.name === "teams")).toEqual([{ name: "teams", id: TEAM }]);
    expect(writes).toHaveLength(1);
    expect(writes[0].data).toMatchObject({ teamId: TEAM, checkedInByUid: CALLER, studentId: record.studentId, status: "active" });
  });

  // 五組合成舊格式 fixture；不代表曾讀取或實測正式環境的五個俱樂部。
  test.each([1, 2, 3, 4, 5])("舊格式 fixture %s：唯一 id 欄位橋接可簽到", async (i) => {
    const logicalId = "tm_legacy_" + i;
    const { call, writes, reads } = setup({ ["legacy_doc_" + i]: { id: logicalId, captainUid: CALLER } });
    await expect(call(logicalId)).resolves.toMatchObject({ success: true, count: 1 });
    expect(writes[0].data.teamId).toBe(logicalId);
    expect(reads.filter(r => r.name === "teams")).toEqual([
      { name: "teams", id: logicalId },
      { name: "teams", filters: [{ field: "id", operator: "==", value: logicalId }], max: 2 },
    ]);
  });

  test.each([undefined, "tm_other"])("直讀文件的 id=%s 仍可用文件 id 簽到", async (id) => {
    const { call } = setup({ [TEAM]: { id, ownerUid: CALLER } });
    await expect(call()).resolves.toMatchObject({ success: true, count: 1 });
  });

  test("攻擊者偽造 id 不可取代真實文件的職員授權", async () => {
    const { call, writes, reads } = setup({
      [TEAM]: { id: TEAM, captainUid: "U-victim" },
      tm_impostor: { id: TEAM, captainUid: CALLER },
    });
    await expect(call()).rejects.toMatchObject({ code: "permission-denied" });
    expect(writes).toHaveLength(0);
    expect(reads).toEqual([{ name: "teams", id: TEAM }]);
  });

  test("合法職員使用直接文件，不受其他兩份同名 id 影響", async () => {
    const { call, reads } = setup({
      [TEAM]: { captainUid: CALLER },
      impostor_one: { id: TEAM }, impostor_two: { id: TEAM },
    });
    await expect(call()).resolves.toMatchObject({ count: 1 });
    expect(reads.filter(r => r.name === "teams")).toHaveLength(1);
  });

  test("只有舊 id 且多筆命中 → TEAM_ID_AMBIGUOUS，零寫入", async () => {
    const { call, writes, commit } = setup({
      legacy_one: { id: TEAM, captainUid: CALLER },
      legacy_two: { id: TEAM, captainUid: CALLER },
    });
    await expect(call()).rejects.toMatchObject({ code: "failed-precondition", message: "TEAM_ID_AMBIGUOUS" });
    expect(writes).toHaveLength(0);
    expect(commit).not.toHaveBeenCalled();
  });

  test("查無俱樂部 → not-found，零寫入", async () => {
    const { call, writes } = setup({});
    await expect(call()).rejects.toMatchObject({ code: "not-found" });
    expect(writes).toHaveLength(0);
  });

  test.each(["captainUid", "creatorUid", "ownerUid", "leaderUid", "leaderUids", "coachUids"])("原職員欄位 %s 授權保留", async (field) => {
    const { call } = setup({ [TEAM]: { id: TEAM, [field]: field.endsWith("Uids") ? [CALLER] : CALLER } });
    await expect(call()).resolves.toMatchObject({ count: 1 });
  });

  test("舊 id 橋接後，非職員仍拒絕", async () => {
    const { call, writes } = setup({ legacy: { id: TEAM, captainUid: "U-other" } });
    await expect(call()).rejects.toMatchObject({ code: "permission-denied" });
    expect(writes).toHaveLength(0);
  });

  test("去重保留：已存在的紀錄與批次內重複均不重寫", async () => {
    const { call, writes } = setup(undefined, [{ ...record, teamId: TEAM, status: "active" }]);
    await expect(call(TEAM, CALLER, [record, record, { ...record, studentId: "student_new" }]))
      .resolves.toMatchObject({ count: 1 });
    expect(writes).toHaveLength(1);
    expect(writes[0].data.studentId).toBe("student_new");
  });

  test("未登入與超過 100 筆在讀取前拒絕", async () => {
    const { call, reads, writes } = setup();
    await expect(call(TEAM, null)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(call(TEAM, CALLER, Array(101).fill(record))).rejects.toMatchObject({ code: "invalid-argument" });
    expect(reads).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });
});


describe("M3 invalid team IDs fail before reads", () => {
  test.each(["tm_target/students/synthetic", "tm_target/child", ".", "..", "__reserved__", "x".repeat(129), " tm_checkin ", "", "   ", null, 123])(
    "invalid teamId %j cannot provide a nested document as authority", async (teamId) => {
      const { call, reads, writes } = setup({
        "tm_target/students/synthetic": { captainUid: CALLER },
      });
      await expect(call(teamId)).rejects.toMatchObject({ code: "invalid-argument" });
      expect(reads).toHaveLength(0);
      expect(writes).toHaveLength(0);
    },
  );
});
