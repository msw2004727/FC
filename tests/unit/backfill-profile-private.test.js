"use strict";

const os = require("os");
const path = require("path");
const {
  parseArgs,
  runBackfill,
  maskId,
  maskPhone,
  maskEmail,
} = require("../../functions/backfill-profile-private");

const FieldValue = {
  serverTimestamp: () => ({ __serverTimestamp: true }),
  delete: () => ({ __delete: true }),
};
const FieldPath = {
  documentId: () => "__name__",
};

// ---------------------------------------------------------------------------
// 假 db：支援分頁、單筆 get、子集合 doc、runTransaction、計數
// ---------------------------------------------------------------------------

function createFakeDb(seed) {
  const seedUsers = (seed.users || []).map((u) => ({ id: u.id, data: { ...u.data } }));
  const freshUsers = seed.freshUsers
    ? seed.freshUsers.map((u) => ({ id: u.id, data: { ...u.data } }))
    : null;
  const privateStore = {};
  for (const [uid, data] of Object.entries(seed.private || {})) {
    privateStore[uid] = { ...data };
  }
  const writes = [];
  const updates = [];
  let reads = 0;
  let writeCount = 0;

  function privateRefFor(userId) {
    return {
      id: PROFILE_DOC_ID,
      path: `users/${userId}/profilePrivate/profile`,
      async get() {
        reads += 1;
        const stored = privateStore[userId];
        if (stored === undefined) {
          return { exists: false, id: PROFILE_DOC_ID, data: () => undefined };
        }
        return { exists: true, id: PROFILE_DOC_ID, data: () => ({ ...stored }) };
      },
    };
  }

  function userRefFor(userId) {
    return {
      id: userId,
      path: `users/${userId}`,
      collection(sub) {
        if (sub !== "profilePrivate") throw new Error("bad sub " + sub);
        return {
          doc(docId) {
            if (docId !== PROFILE_DOC_ID) throw new Error("bad private doc id " + docId);
            return privateRefFor(userId);
          },
        };
      },
      async get() {
        reads += 1;
        const list = freshUsers || seedUsers;
        const found = list.find((u) => u.id === userId);
        if (!found) return { exists: false, id: userId, data: () => undefined };
        return { exists: true, id: found.id, data: () => ({ ...found.data }) };
      },
    };
  }

  return {
    users: seedUsers,
    privateStore,
    writes,
    updates,
    get readCount() { return reads; },
    get writeCount() { return writeCount; },
    collection(name) {
      if (name !== "users") throw new Error("bad collection " + name);
      let cursor = null;
      let limitN = null;
      let ordered = false;
      const api = {
        select() { return api; },
        orderBy() { ordered = true; return api; },
        startAfter(id) { cursor = id; return api; },
        limit(n) { limitN = n; return api; },
        async get() {
          let result = seedUsers.slice();
          if (ordered) result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          if (cursor !== null) result = result.filter((u) => u.id > cursor);
          if (limitN !== null) result = result.slice(0, limitN);
          reads += result.length;
          return {
            size: result.length,
            empty: result.length === 0,
            docs: result.map((u) => ({
              id: u.id,
              exists: true,
              data: () => ({ ...u.data }),
            })),
          };
        },
        doc(id) { return userRefFor(id); },
      };
      return api;
    },
    async runTransaction(fn) {
      const stagedSets = [];
      const stagedUpdates = [];
      const tx = {
        async get(ref) { return ref.get(); },
        set(ref, data, opts) { stagedSets.push({ ref, data, opts: opts || {} }); },
        update(ref, data) { stagedUpdates.push({ ref, data }); },
      };
      const result = await fn(tx);
      for (const op of stagedSets) {
        const m = /^users\/([^/]+)\/profilePrivate\/profile$/.exec(op.ref.path);
        if (!m) throw new Error("bad ref path " + op.ref.path);
        const userId = m[1];
        if (op.opts.merge) {
          privateStore[userId] = { ...(privateStore[userId] || {}), ...op.data };
        } else {
          privateStore[userId] = { ...op.data };
        }
        writes.push({ path: op.ref.path, data: op.data, merge: !!op.opts.merge });
        writeCount += 1;
      }
      for (const op of stagedUpdates) {
        const m = /^users\/([^/]+)$/.exec(op.ref.path);
        if (!m) throw new Error("bad update ref path " + op.ref.path);
        const userId = m[1];
        const list = freshUsers || seedUsers;
        const target = list.find((u) => u.id === userId);
        if (!target) throw new Error("update target missing " + userId);
        for (const [key, value] of Object.entries(op.data)) {
          if (value && value.__delete === true) {
            delete target.data[key];
          } else {
            target.data[key] = value;
          }
        }
        updates.push({ path: op.ref.path, data: op.data });
        writeCount += 1;
      }
      return result;
    },
  };
}

const PROFILE_DOC_ID = "profile";

function baseArgs(overrides = {}) {
  return {
    FieldValue,
    FieldPath,
    mode: "apply",
    limit: 20,
    onlyDoc: null,
    startAfter: null,
    writeReport: () => {},
    log: () => {},
    nowMs: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  test("預設 dry-run、limit 20", () => {
    const args = parseArgs(["node", "x"], {});
    expect(args.mode).toBe("dry-run");
    expect(args.limit).toBe(20);
    expect(args.apply).toBe(false);
    expect(args.repair).toBe(false);
    expect(args.verify).toBe(false);
  });

  test("--limit 601 拒絕（LIMIT_EXCEEDS_600）", () => {
    expect(() => parseArgs(["node", "x", "--limit", "601"], {})).toThrow("LIMIT_EXCEEDS_600");
  });

  test("--limit 0 與非整數拒絕", () => {
    expect(() => parseArgs(["node", "x", "--limit", "0"], {})).toThrow("INVALID_LIMIT");
    expect(() => parseArgs(["node", "x", "--limit", "abc"], {})).toThrow("INVALID_LIMIT");
    expect(() => parseArgs(["node", "x", "--limit", "1.5"], {})).toThrow("INVALID_LIMIT");
  });

  test("--verify 與 --apply / --repair 不可併用", () => {
    expect(() => parseArgs(["node", "x", "--verify", "--apply"], {})).toThrow();
    expect(() => parseArgs(["node", "x", "--verify", "--repair"], {})).toThrow();
  });

  test("未知旗標拒絕", () => {
    expect(() => parseArgs(["node", "x", "--bogus"], {})).toThrow("UNKNOWN_FLAG");
  });

  test("GOOGLE_APPLICATION_CREDENTIALS 有值拒絕，且錯誤不含該值", () => {
    const secret = "/something/credentials.json";
    let err = null;
    try {
      parseArgs(["node", "x"], { GOOGLE_APPLICATION_CREDENTIALS: secret });
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(String(err.message)).not.toContain(secret);
    expect(String(err.message)).not.toContain("credentials.json");
    expect(err.code).toBe("KEY_FILE_NOT_ALLOWED");
  });

  test("--out 指向 repo 外拒絕", () => {
    expect(() => parseArgs(["node", "x", "--out", "C:/x"], {})).toThrow("OUT_NOT_LOCAL_ONLY");
    expect(() => parseArgs(["node", "x", "--out", "../x"], {})).toThrow("OUT_NOT_LOCAL_ONLY");
  });

  test("--out 指向 docs 或 tmpdir 接受", () => {
    const docsArgs = parseArgs(["node", "x", "--out", "docs/reports"], {});
    expect(docsArgs.outDir).toContain("docs");
    const tmpDir = os.tmpdir();
    const tmpArgs = parseArgs(["node", "x", "--out", tmpDir], {});
    expect(tmpArgs.outDir).toBe(path.resolve(tmpDir));
  });
});

// ---------------------------------------------------------------------------
// dry-run
// ---------------------------------------------------------------------------

describe("dry-run", () => {
  test("不呼叫任何 set，報告數字正確", async () => {
    const db = createFakeDb({
      users: [
        { id: "u1", data: { phone: "0912345678", email: "a@b.c", companions: [{ name: "x" }] } },
        { id: "u2", data: { phone: "0987654321" } },
        { id: "u3", data: {} },
        { id: "u4", data: { phone: 12345 } },
      ],
      private: {},
    });
    const report = await runBackfill({
      db,
      ...baseArgs({ mode: "dry-run" }),
    });
    expect(db.writeCount).toBe(0);
    expect(report.scanned).toBe(4);
    expect(report.withValue.phone).toBe(2);
    expect(report.withValue.email).toBe(1);
    expect(report.withValue.companions).toBe(1);
    expect(report.noValue).toBe(2); // u3 空、u4 只有型別異常的 phone
    expect(report.typeAnomaly.phone).toBe(1);
    expect(report.wouldWrite).toBe(2);
    expect(report.maxLen.phone).toBe("0912345678".length);
  });

  test("文件數大於 limit 時仍完整掃描：全量統計、wouldWrite 全量、不寫入、stoppedAt 不因 limit 中止", async () => {
    const db = createFakeDb({
      users: [
        { id: "u1", data: { phone: "0900000001", companions: [{ name: "a" }, { name: "b" }, { name: "c" }] } },
        { id: "u2", data: { email: "a@b.c", lineUserId: "missingDoc" } },
        { id: "u3", data: { phone: "0900000003", uid: "otherDoc" } },
        { id: "u4", data: { eduChildren: [{}, {}, {}, {}] } },
        { id: "u5", data: {} },
      ],
      private: {},
    });
    const report = await runBackfill({ db, ...baseArgs({ mode: "dry-run", limit: 1 }) });
    expect(db.writeCount).toBe(0);
    expect(report.scanned).toBe(5);
    expect(report.withValue.phone).toBe(2);
    expect(report.withValue.email).toBe(1);
    expect(report.withValue.companions).toBe(1);
    expect(report.withValue.eduChildren).toBe(1);
    expect(report.idFieldMismatchWithValue).toBe(2);
    expect(report.legacyNoCanonicalWithValue).toBe(1);
    expect(report.maxItems.companions).toBe(3);
    expect(report.maxItems.eduChildren).toBe(4);
    expect(report.wouldWrite).toBe(4);
    expect(report.stoppedAt).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// --apply fill-if-empty
// ---------------------------------------------------------------------------

describe("--apply fill-if-empty", () => {
  test("只補缺鍵；值不同不寫並計 inconsistent；新檔帶 createdAt、都帶 backfilledAt／updatedAt", async () => {
    const db = createFakeDb({
      users: [
        { id: "u1", data: { phone: "0900000001", email: "a@b.c" } },
        { id: "u2", data: { phone: "0900000002" } },
      ],
      private: {
        u1: { phone: "9999999" },
      },
    });
    const report = await runBackfill({ db, ...baseArgs({ mode: "apply" }) });
    expect(report.written).toBe(2);
    expect(report.inconsistent).toBe(1);

    const u1Write = db.writes.find((w) => w.path === "users/u1/profilePrivate/profile");
    expect(u1Write).toBeDefined();
    expect(u1Write.data.phone).toBeUndefined();
    expect(u1Write.data.email).toBe("a@b.c");
    expect(u1Write.data.backfilledAt).toEqual({ __serverTimestamp: true });
    expect(u1Write.data.updatedAt).toEqual({ __serverTimestamp: true });
    expect(u1Write.data.createdAt).toBeUndefined();

    const u2Write = db.writes.find((w) => w.path === "users/u2/profilePrivate/profile");
    expect(u2Write).toBeDefined();
    expect(u2Write.data.phone).toBe("0900000002");
    expect(u2Write.data.backfilledAt).toEqual({ __serverTimestamp: true });
    expect(u2Write.data.createdAt).toEqual({ __serverTimestamp: true });

    expect(db.writes.find((w) => w.path === "users/u1/profilePrivate/profile").data.phone).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// --repair / --repair --apply
// ---------------------------------------------------------------------------

describe("--repair", () => {
  test("無 --apply 不寫，wouldWrite 等於不一致數", async () => {
    const db = createFakeDb({
      users: [
        { id: "u1", data: { phone: "0900000001" } },
        { id: "u2", data: { phone: "0900000002" } },
      ],
      private: {
        u1: { phone: "9999999" },
        u2: { phone: "0900000002" },
      },
    });
    const report = await runBackfill({ db, ...baseArgs({ mode: "repair" }) });
    expect(db.writeCount).toBe(0);
    expect(report.inconsistent).toBe(1);
    expect(report.wouldWrite).toBe(1);
  });

  test("--repair --apply 以根覆寫不一致欄位，相同欄位不寫", async () => {
    const db = createFakeDb({
      users: [
        { id: "u1", data: { phone: "0900000001" } },
        { id: "u2", data: { phone: "0900000002" } },
      ],
      private: {
        u1: { phone: "9999999" },
        u2: { phone: "0900000002" },
      },
    });
    const report = await runBackfill({ db, ...baseArgs({ mode: "repair-apply" }) });
    expect(report.written).toBe(1);
    expect(report.inconsistent).toBe(1);
    const u1Write = db.writes.find((w) => w.path === "users/u1/profilePrivate/profile");
    expect(u1Write).toBeDefined();
    expect(u1Write.data.phone).toBe("0900000001");
    expect(db.writes.find((w) => w.path === "users/u2/profilePrivate/profile")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// --verify
// ---------------------------------------------------------------------------

describe("--verify", () => {
  test("只比對、正確算 inconsistent、不寫", async () => {
    const db = createFakeDb({
      users: [
        { id: "u1", data: { phone: "0900000001" } },
        { id: "u2", data: { phone: "0900000002" } },
      ],
      private: {
        u1: { phone: "9999999" },
        u2: { phone: "0900000002" },
      },
    });
    const report = await runBackfill({ db, ...baseArgs({ mode: "verify" }) });
    expect(db.writeCount).toBe(0);
    expect(report.inconsistent).toBe(1);
    expect(report.written).toBe(0);
    expect(report.wouldWrite).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 目標 = docId
// ---------------------------------------------------------------------------

describe("目標 = docId", () => {
  test("uid、lineUserId 不同時仍只寫 users/uidA", async () => {
    const db = createFakeDb({
      users: [
        { id: "uidA", data: { phone: "0900000001", uid: "uidX", lineUserId: "uidY" } },
      ],
      private: {},
    });
    const report = await runBackfill({ db, ...baseArgs({ mode: "apply" }) });
    expect(report.idFieldMismatch).toBe(1);
    expect(db.writes.find((w) => w.path === "users/uidA/profilePrivate/profile")).toBeDefined();
    expect(db.writes.find((w) => w.path.includes("uidX"))).toBeUndefined();
    expect(db.writes.find((w) => w.path.includes("uidY"))).toBeUndefined();
  });

  test("legacy 文件寫到自己路徑；legacyNoCanonical 只在對應主文件不存在時 +1", async () => {
    const db = createFakeDb({
      users: [
        { id: "uidA", data: { phone: "0900000001" } },
        { id: "legacyDoc1", data: { phone: "0900000002", lineUserId: "uidA" } },
        { id: "orphan", data: { email: "o@x.com", lineUserId: "uidZ" } },
      ],
      private: {},
    });
    const report = await runBackfill({ db, ...baseArgs({ mode: "apply" }) });
    expect(db.writes.find((w) => w.path === "users/legacyDoc1/profilePrivate/profile")).toBeDefined();
    expect(db.writes.find((w) => w.path === "users/orphan/profilePrivate/profile")).toBeDefined();
    expect(db.writes.find((w) => w.path === "users/uidA/profilePrivate/profile")).toBeDefined();
    expect(report.legacyNoCanonical).toBe(1);
    expect(report.idFieldMismatch).toBe(2);
    expect(report.legacyNoCanonicalWithValue).toBe(1);
    expect(report.idFieldMismatchWithValue).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 交易內重讀
// ---------------------------------------------------------------------------

describe("交易內重讀", () => {
  test("交易內讀到的根值與第一輪不同時，寫入交易內的值", async () => {
    const db = createFakeDb({
      users: [{ id: "u1", data: { phone: "0900000001" } }],
      freshUsers: [{ id: "u1", data: { phone: "0900000009" } }],
      private: {},
    });
    await runBackfill({ db, ...baseArgs({ mode: "apply" }) });
    const write = db.writes.find((w) => w.path === "users/u1/profilePrivate/profile");
    expect(write).toBeDefined();
    expect(write.data.phone).toBe("0900000009");
  });
});

// ---------------------------------------------------------------------------
// 硬上限
// ---------------------------------------------------------------------------

describe("硬上限", () => {
  test("--limit 2 + 5 份待寫，只寫 2 份、stoppedAt=limit、nextStartAfter 遮罩、resume 完整", async () => {
    const users = [];
    for (let i = 1; i <= 5; i += 1) users.push({ id: `u${i}`, data: { phone: `090000000${i}` } });
    const db = createFakeDb({ users, private: {} });
    const report = await runBackfill({ db, ...baseArgs({ mode: "apply", limit: 2 }) });
    expect(report.written).toBe(2);
    expect(report.stoppedAt).toBe("limit");
    expect(report.nextStartAfter).toBe(maskId("u2"));
    expect(report.resume.startAfter).toBe("u2");
    expect(db.writeCount).toBe(2);
  });

  test("整批跑完不輸出 resume／nextStartAfter", async () => {
    const users = [
      { id: "u1", data: { phone: "0900000001" } },
      { id: "u2", data: { phone: "0900000002" } },
    ];
    const db = createFakeDb({ users, private: {} });
    const report = await runBackfill({ db, ...baseArgs({ mode: "apply", limit: 10 }) });
    expect(report.written).toBe(2);
    expect(report.stoppedAt).toBe(null);
    expect(report.resume).toBeNull();
    expect(report.nextStartAfter).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 失敗即停
// ---------------------------------------------------------------------------

describe("失敗即停", () => {
  test("第 2 份交易失敗 → 直接停，errorCode 只含代碼，續跑可完成", async () => {
    const users = [];
    for (let i = 1; i <= 5; i += 1) users.push({ id: `u${i}`, data: { phone: `090000000${i}` } });
    const db = createFakeDb({ users, private: {} });
    const origRunTx = db.runTransaction.bind(db);
    let txCount = 0;
    db.runTransaction = async (fn) => {
      txCount += 1;
      if (txCount === 2) {
        const err = new Error("boom");
        err.code = "ABORTED";
        throw err;
      }
      return origRunTx(fn);
    };
    const report = await runBackfill({ db, ...baseArgs({ mode: "apply" }) });
    expect(report.stoppedAt).toBe("error");
    expect(report.errorCode).toBe("ABORTED");
    expect(report.written).toBe(1);
    expect(report.resume.startAfter).toBe("u1");
    expect(db.writeCount).toBe(1);

    // 續跑
    const resumeDb = createFakeDb({ users, private: { u1: { phone: "0900000001" } } });
    const resumeReport = await runBackfill({
      db: resumeDb,
      ...baseArgs({ mode: "apply", startAfter: report.resume.startAfter }),
    });
    expect(resumeReport.written).toBe(4);
    expect(resumeReport.stoppedAt).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// 冪等
// ---------------------------------------------------------------------------

describe("冪等", () => {
  test("同一資料 --apply 跑兩次，第二次 written = 0", async () => {
    const db = createFakeDb({
      users: [{ id: "u1", data: { phone: "0900000001" } }],
      private: {},
    });
    const r1 = await runBackfill({ db, ...baseArgs({ mode: "apply" }) });
    expect(r1.written).toBe(1);
    const r2 = await runBackfill({ db, ...baseArgs({ mode: "apply" }) });
    expect(r2.written).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 遮罩
// ---------------------------------------------------------------------------

describe("遮罩", () => {
  test("maskId / maskPhone / maskEmail 格式", () => {
    expect(maskId("abcdefgh")).toBe("a…efgh");
    expect(maskId("abcd")).toBe("***");
    expect(maskId("12345")).toBe("***");
    expect(maskId("123456")).toBe("1…3456");
    expect(maskId("")).toBe("***");
    expect(maskPhone("0912345678")).toBe("***78");
    expect(maskPhone(null)).toBe("***");
    expect(maskEmail("user@example.com")).toBe("u***@e***");
    expect(maskEmail("bad")).toBe("***");
  });

  test("stdout 與報告檔不含完整敏感值（stoppedAt=limit 時 resume.startAfter 例外）", async () => {
    const db = createFakeDb({
      users: [{
        id: "secretDocId123",
        data: {
          phone: "0912345678",
          email: "user@example.com",
          companions: [{ name: "AliceCompanion" }],
        },
      }, {
        id: "zzzOtherDoc",
        data: { phone: "0900000000" },
      }],
      private: {},
    });
    const logs = [];
    let captured = null;
    await runBackfill({
      db,
      ...baseArgs({
        mode: "apply",
        limit: 1,
        log: (line) => logs.push(line),
        writeReport: (r) => { captured = r; },
      }),
    });
    const stdout = logs.join("\n");
    expect(stdout).not.toContain("secretDocId123");
    expect(stdout).not.toContain("0912345678");
    expect(stdout).not.toContain("user@example.com");
    expect(stdout).not.toContain("AliceCompanion");

    const reportStr = JSON.stringify(captured);
    expect(reportStr).not.toContain("0912345678");
    expect(reportStr).not.toContain("user@example.com");
    expect(reportStr).not.toContain("AliceCompanion");
    // stoppedAt=limit 時，resume.startAfter 是唯一允許放完整 docId 的欄位
    const withoutResume = JSON.stringify({ ...captured, resume: null });
    expect(withoutResume).not.toContain("secretDocId123");
    expect(captured.resume.startAfter).toBe("secretDocId123");
  });
});

// ---------------------------------------------------------------------------
// --only-doc
// ---------------------------------------------------------------------------

describe("--only-doc", () => {
  test("只讀一份文件", async () => {
    const db = createFakeDb({
      users: [
        { id: "u1", data: { phone: "0900000001" } },
        { id: "u2", data: { phone: "0900000002" } },
        { id: "u3", data: { phone: "0900000003" } },
      ],
      private: {},
    });
    const report = await runBackfill({ db, ...baseArgs({ mode: "apply", onlyDoc: "u2" }) });
    expect(report.scanned).toBe(1);
    expect(db.writes.find((w) => w.path === "users/u2/profilePrivate/profile")).toBeDefined();
    expect(db.writes.find((w) => w.path === "users/u1/profilePrivate/profile")).toBeUndefined();
    expect(db.writes.find((w) => w.path === "users/u3/profilePrivate/profile")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 續跑可信度
// ---------------------------------------------------------------------------

describe("legacyNoCanonicalReliable", () => {
  test("帶 startAfter 時 knownIds 不完整，標示不可信且 stdout 有提示", async () => {
    const db = createFakeDb({
      users: [
        { id: "u1", data: { email: "u1@x.com", lineUserId: "missing1" } },
        { id: "u2", data: { email: "u2@x.com", lineUserId: "missing2" } },
        { id: "u3", data: { email: "u3@x.com", lineUserId: "missing3" } },
      ],
      private: {},
    });
    const logs = [];
    const report = await runBackfill({
      db,
      ...baseArgs({ mode: "dry-run", startAfter: "u1", log: (line) => logs.push(line) }),
    });
    expect(report.legacyNoCanonicalReliable).toBe(false);
    expect(logs.join("\n")).toContain("不可信");
  });

  test("全量掃描時 legacyNoCanonicalReliable 為 true", async () => {
    const db = createFakeDb({ users: [{ id: "u1", data: { email: "u1@x.com" } }], private: {} });
    const report = await runBackfill({ db, ...baseArgs({ mode: "dry-run" }) });
    expect(report.legacyNoCanonicalReliable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// --purge-root
// ---------------------------------------------------------------------------

describe("--purge-root", () => {
  test("dry-run 零寫入且計數正確", async () => {
    const db = createFakeDb({
      users: [
        { id: "u1", data: { phone: "0900000001", email: "a@b.c" } },
        { id: "u2", data: { phone: "0900000002" } },
        { id: "u3", data: { phone: "0900000003" } },
        { id: "u4", data: { phone: 12345 } },
        { id: "u5", data: {} },
        { id: "u6", data: { phone: "0900000006", lineUserId: "missingDoc" } },
      ],
      private: {
        u1: { phone: "0900000001", email: "a@b.c" },
        u3: { phone: "9999999999" },
        u6: { phone: "0900000006" },
      },
    });
    const report = await runBackfill({
      db,
      ...baseArgs({ mode: "purge-root", limit: 1 }),
    });
    expect(db.writeCount).toBe(0);
    expect(report.scanned).toBe(6);
    expect(report.alreadyClean).toBe(1);
    expect(report.purgeable).toBe(1);
    expect(report.purged).toBe(0);
    expect(report.skipNoPrivate).toBe(1);
    expect(report.skipMismatch).toBe(1);
    expect(report.skipTypeAnomaly).toBe(1);
    expect(report.skipLegacyNoCanonical).toBe(1);
    expect(report.stoppedAt).toBe(null);
  });

  test("--apply 只清完全一致者，且只刪根上存在的鍵", async () => {
    const db = createFakeDb({
      users: [
        { id: "u1", data: { phone: "0900000001", email: "a@b.c" } },
        { id: "u2", data: { phone: "0900000002" } },
      ],
      private: {
        u1: { phone: "0900000001", email: "a@b.c" },
        u2: { phone: "9999999999" },
      },
    });
    const report = await runBackfill({
      db,
      ...baseArgs({ mode: "purge-root-apply" }),
    });
    expect(report.purged).toBe(1);
    expect(report.skipMismatch).toBe(1);
    expect(db.updates).toHaveLength(1);
    const update = db.updates[0];
    expect(update.path).toBe("users/u1");
    expect(Object.keys(update.data).sort()).toEqual(["email", "phone"]);
    expect(update.data.phone).toEqual({ __delete: true });
    expect(update.data.email).toEqual({ __delete: true });
    expect(update.data.updatedAt).toBeUndefined();
    const u1 = db.users.find((u) => u.id === "u1");
    expect(u1.data.phone).toBeUndefined();
    expect(u1.data.email).toBeUndefined();
  });

  test("交易內變不一致時不清", async () => {
    const db = createFakeDb({
      users: [{ id: "u1", data: { phone: "0900000001" } }],
      freshUsers: [{ id: "u1", data: { phone: "0900000009" } }],
      private: { u1: { phone: "0900000001" } },
    });
    const report = await runBackfill({
      db,
      ...baseArgs({ mode: "purge-root-apply" }),
    });
    expect(report.purged).toBe(0);
    expect(report.skipMismatchAtApply).toBe(1);
    expect(db.updates).toHaveLength(0);
  });

  test("limit 停止與 resume", async () => {
    const users = [];
    for (let i = 1; i <= 4; i += 1) users.push({ id: `u${i}`, data: { phone: `090000000${i}` } });
    const privateData = {};
    for (const u of users) privateData[u.id] = { phone: u.data.phone };
    const db = createFakeDb({ users, private: privateData });
    const report = await runBackfill({
      db,
      ...baseArgs({ mode: "purge-root-apply", limit: 2 }),
    });
    expect(report.purged).toBe(2);
    expect(report.stoppedAt).toBe("limit");
    expect(report.nextStartAfter).toBe(maskId("u2"));
    expect(report.resume.startAfter).toBe("u2");
    expect(db.updates).toHaveLength(2);

    const resumeReport = await runBackfill({
      db,
      ...baseArgs({ mode: "purge-root-apply", startAfter: report.resume.startAfter }),
    });
    expect(resumeReport.purged).toBe(2);
    expect(resumeReport.stoppedAt).toBe(null);
  });

  test("與 --repair、--verify 互斥，且模式解析正確", () => {
    expect(parseArgs(["node", "x", "--purge-root"], {}).mode).toBe("purge-root");
    expect(parseArgs(["node", "x", "--purge-root", "--apply"], {}).mode).toBe("purge-root-apply");
    expect(() => parseArgs(["node", "x", "--purge-root", "--repair"], {})).toThrow();
    expect(() => parseArgs(["node", "x", "--purge-root", "--verify"], {})).toThrow();
  });
});
