"use strict";

const {
  PROFILE_PRIVATE_FIELDS,
  readField,
  changedProfileFields,
  planProfilePrivatePatch,
  isSafeUserDocId,
  createProfilePrivateMirror,
  _resetFailuresForTest,
} = require("../../functions/profile-private-mirror");

function createFakeDb(initialDocs = {}, options = {}) {
  const store = new Map(Object.entries(initialDocs));
  const writes = [];

  function makeDocRef(path) {
    return {
      path,
      collection(name) {
        return {
          doc(id) {
            return makeDocRef(`${path}/${name}/${id}`);
          },
        };
      },
    };
  }

  const collection = jest.fn((name) => ({
    doc(id) {
      return makeDocRef(`${name}/${id}`);
    },
  }));

  const runTransaction = jest.fn(async (fn) => {
    if (options.transactionError) throw options.transactionError;

    const tx = {
      get: jest.fn(async (ref) => {
        const exists = store.has(ref.path);
        return {
          exists,
          data: () => (exists ? store.get(ref.path) : undefined),
        };
      }),
      set: jest.fn((ref, data, opts) => {
        const merge = Boolean(opts && opts.merge);
        const existing = merge && store.has(ref.path) ? store.get(ref.path) : {};
        const next = merge ? { ...existing, ...data } : data;
        store.set(ref.path, next);
        writes.push({ ref, data, opts });
      }),
    };

    return fn(tx);
  });

  const db = { collection, runTransaction };
  return { db, store, writes, collection, runTransaction };
}

function createMirror(db, logger = { error: jest.fn() }) {
  const FieldValue = { serverTimestamp: jest.fn(() => "__ts__") };
  return {
    mirror: createProfilePrivateMirror({ db, FieldValue, logger }),
    logger,
    FieldValue,
  };
}

beforeEach(() => {
  _resetFailuresForTest();
});

test("只有非四欄變更時不啟動交易", async () => {
  const { db, runTransaction } = createFakeDb({
    "users/uidA": { lastLogin: "b", phone: "p" },
  });
  const { mirror } = createMirror(db);

  const result = await mirror({
    userId: "uidA",
    beforeData: { lastLogin: "a", phone: "p" },
    afterData: { lastLogin: "b", phone: "p" },
  });

  expect(result).toEqual({ outcome: "unchanged" });
  expect(runTransaction).not.toHaveBeenCalled();
});

test("更新 phone 時寫入當下根值，私密文件不存在時補 createdAt", async () => {
  const { db, store, writes } = createFakeDb({
    "users/uidA": { phone: "new-phone", email: "same@example.test" },
  });
  const { mirror } = createMirror(db);

  const result = await mirror({
    userId: "uidA",
    beforeData: { phone: "old-phone", email: "same@example.test" },
    afterData: { phone: "new-phone", email: "same@example.test" },
  });

  expect(result).toEqual({ outcome: "written", fieldCount: 1 });
  expect(writes).toHaveLength(1);
  expect(store.get("users/uidA/profilePrivate/profile")).toEqual({
    phone: "new-phone",
    updatedAt: "__ts__",
    createdAt: "__ts__",
  });
});

test("舊站舊快取整份寫回 companions 時仍以交易內當下根為準", async () => {
  const { db, store } = createFakeDb({
    "users/uidA": { companions: ["A", "B", "C", "D"] },
  });
  const { mirror } = createMirror(db);

  const result = await mirror({
    userId: "uidA",
    beforeData: { companions: ["A", "B", "C"] },
    afterData: { companions: ["A", "B"] },
  });

  expect(result).toEqual({ outcome: "written", fieldCount: 1 });
  expect(store.get("users/uidA/profilePrivate/profile").companions).toEqual([
    "A",
    "B",
    "C",
    "D",
  ]);
});

test("較舊事件晚到且當下根與私密文件已一致時不寫", async () => {
  const { db, store, writes } = createFakeDb({
    "users/uidA": { phone: "new-phone" },
    "users/uidA/profilePrivate/profile": {
      phone: "new-phone",
      updatedAt: "old-ts",
    },
  });
  const { mirror } = createMirror(db);

  const result = await mirror({
    userId: "uidA",
    beforeData: { phone: "old-phone" },
    afterData: { phone: "new-phone" },
  });

  expect(result).toEqual({ outcome: "unchanged" });
  expect(writes).toHaveLength(0);
  expect(store.get("users/uidA/profilePrivate/profile")).toEqual({
    phone: "new-phone",
    updatedAt: "old-ts",
  });
});

test("根欄位清為 null 或刪除鍵時，私密文件保留鍵並寫 null", async () => {
  const { db, store } = createFakeDb({
    "users/uidA": { phone: null },
    "users/uidA/profilePrivate/profile": {
      phone: "old-phone",
      email: "old@example.test",
      companions: [],
    },
  });
  const { mirror } = createMirror(db);

  const result = await mirror({
    userId: "uidA",
    beforeData: {
      phone: "old-phone",
      email: "old@example.test",
      companions: [],
    },
    afterData: {
      phone: null,
      companions: [],
    },
  });

  expect(result).toEqual({ outcome: "written", fieldCount: 2 });
  const privateData = store.get("users/uidA/profilePrivate/profile");
  expect(privateData.phone).toBeNull();
  expect(privateData.email).toBeNull();
  expect(Object.prototype.hasOwnProperty.call(privateData, "phone")).toBe(true);
  expect(Object.prototype.hasOwnProperty.call(privateData, "email")).toBe(true);
});

test("根文件新建時只補私密文件缺少且根值非 null 的欄位", async () => {
  const { db, store, writes } = createFakeDb({
    "users/uidA": {
      email: "root@example.test",
      companions: ["c1"],
      phone: null,
    },
    "users/uidA/profilePrivate/profile": {
      email: "private@example.test",
    },
  });
  const { mirror } = createMirror(db);

  const first = await mirror({
    userId: "uidA",
    beforeData: null,
    afterData: {
      email: "root@example.test",
      companions: ["c1"],
      phone: null,
    },
  });

  expect(first).toEqual({ outcome: "written", fieldCount: 1 });
  const afterFirst = store.get("users/uidA/profilePrivate/profile");
  expect(afterFirst.email).toBe("private@example.test");
  expect(afterFirst.companions).toEqual(["c1"]);
  expect(Object.prototype.hasOwnProperty.call(afterFirst, "phone")).toBe(false);

  const second = await mirror({
    userId: "uidA",
    beforeData: null,
    afterData: {
      email: "root@example.test",
      companions: ["c1"],
    },
  });

  expect(second).toEqual({ outcome: "unchanged" });
  expect(writes).toHaveLength(1);
});

test("路徑 userId 是唯一目標，不因文件內 uid 或 lineUserId 改寫其他路徑", async () => {
  const { db, store } = createFakeDb({
    "users/uidA": {
      phone: "new-phone",
      uid: "uidX",
      lineUserId: "uidY",
    },
  });
  const { mirror } = createMirror(db);

  const result = await mirror({
    userId: "uidA",
    beforeData: { phone: "old-phone", uid: "uidX", lineUserId: "uidY" },
    afterData: { phone: "new-phone", uid: "uidX", lineUserId: "uidY" },
  });

  expect(result).toEqual({ outcome: "written", fieldCount: 1 });
  expect(store.has("users/uidA/profilePrivate/profile")).toBe(true);
  const keys = [...store.keys()];
  expect(keys.some((key) => key.includes("uidX") || key.includes("uidY"))).toBe(false);
});

test("舊文件內容的 lineUserId 不影響目標，只寫入路徑 legacyDoc1", async () => {
  const { db, store } = createFakeDb({
    "users/legacyDoc1": {
      phone: "new-phone",
      lineUserId: "anotherPerson",
    },
  });
  const { mirror } = createMirror(db);

  const result = await mirror({
    userId: "legacyDoc1",
    beforeData: { phone: "old-phone", lineUserId: "anotherPerson" },
    afterData: { phone: "new-phone", lineUserId: "anotherPerson" },
  });

  expect(result).toEqual({ outcome: "written", fieldCount: 1 });
  expect(store.has("users/legacyDoc1/profilePrivate/profile")).toBe(true);
  const keys = [...store.keys()];
  expect(keys.some((key) => key.includes("anotherPerson"))).toBe(false);
});

test("交易內根文件不存在時回傳 skipped_root_missing 且不寫", async () => {
  const { db, writes } = createFakeDb({});
  const { mirror } = createMirror(db);

  const result = await mirror({
    userId: "uidA",
    beforeData: { phone: "old-phone" },
    afterData: { phone: "new-phone" },
  });

  expect(result).toEqual({ outcome: "skipped_root_missing" });
  expect(writes).toHaveLength(0);
});

test("非法文件 id 直接跳過且不讀取", async () => {
  for (const userId of ["", "a/b", "..", "__x__"]) {
    const collection = jest.fn(() => {
      throw new Error("should not read");
    });
    const db = { collection, runTransaction: jest.fn() };
    const { mirror } = createMirror(db);

    const result = await mirror({
      userId,
      beforeData: { phone: "old-phone" },
      afterData: { phone: "new-phone" },
    });

    expect(result).toEqual({ outcome: "skipped_invalid_id" });
    expect(collection).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
  }
});

test("交易例外時回傳 failed、log 僅含中性欄位，連續失敗會累計", async () => {
  const error = {
    code: "aborted",
    name: "AbortError",
    message: "users/uidA PHONE_SECRET EMAIL_SECRET",
  };
  const { db } = createFakeDb({}, { transactionError: error });
  const logger = { error: jest.fn() };
  const FieldValue = { serverTimestamp: jest.fn(() => "__ts__") };
  const mirror = createProfilePrivateMirror({ db, FieldValue, logger });

  const args = {
    userId: "uidA",
    beforeData: { phone: "PHONE_SECRET" },
    afterData: { phone: "PHONE_SECRET_2" },
  };

  await expect(mirror(args)).resolves.toEqual({ outcome: "failed" });
  await expect(mirror(args)).resolves.toEqual({ outcome: "failed" });

  expect(logger.error).toHaveBeenCalledTimes(2);
  const [label, details] = logger.error.mock.calls[0];
  expect(label).toBe("[profilePrivateMirror]");
  expect(details).toEqual({
    event: "profile_private_mirror",
    outcome: "failed",
    code: "aborted",
    failures: 1,
  });
  expect(Object.keys(details).sort()).toEqual([
    "code",
    "event",
    "failures",
    "outcome",
  ]);
  expect(logger.error.mock.calls[1][1].failures).toBe(2);

  const serialized = JSON.stringify(logger.error.mock.calls);
  expect(serialized).not.toContain("uidA");
  expect(serialized).not.toContain("users/");
  expect(serialized).not.toContain("PHONE_SECRET");
  expect(serialized).not.toContain("EMAIL_SECRET");
});

test("刪除事件不讀取且回傳 unchanged", async () => {
  const { db, collection, runTransaction } = createFakeDb({
    "users/uidA": { phone: "p" },
  });
  const { mirror } = createMirror(db);

  const result = await mirror({
    userId: "uidA",
    beforeData: { phone: "p" },
    afterData: null,
  });

  expect(result).toEqual({ outcome: "unchanged" });
  expect(collection).not.toHaveBeenCalled();
  expect(runTransaction).not.toHaveBeenCalled();
});

test("純函式處理深比較、undefined/null、新建補值與寫 null 的邊界", () => {
  expect(PROFILE_PRIVATE_FIELDS).toEqual([
    "phone",
    "email",
    "companions",
    "eduChildren",
  ]);

  expect(changedProfileFields(
    { companions: [{ id: 1 }] },
    { companions: [{ id: 1 }] },
  )).toEqual([]);

  expect(changedProfileFields(
    { phone: undefined },
    { phone: null },
  )).toEqual([]);

  expect(changedProfileFields(null, {
    phone: null,
    email: "x@example.test",
    companions: [],
    eduChildren: undefined,
  })).toEqual(["email", "companions"]);

  expect(readField({ email: null }, "email")).toBeNull();
  expect(readField({ email: undefined }, "email")).toBeNull();
  expect(readField({}, "email")).toBeNull();
  expect(readField({ phone: "" }, "phone")).toBe("");

  expect(planProfilePrivatePatch({
    isCreate: true,
    fields: ["phone", "email"],
    rootData: { phone: "p", email: null },
    privateData: { email: "old@example.test" },
  })).toEqual({ phone: "p" });

  expect(planProfilePrivatePatch({
    isCreate: false,
    fields: ["phone"],
    rootData: { phone: null },
    privateData: { phone: "old-phone" },
  })).toEqual({ phone: null });

  expect(planProfilePrivatePatch({
    isCreate: false,
    fields: ["phone"],
    rootData: { phone: "same" },
    privateData: { phone: "same" },
  })).toBeNull();

  expect(isSafeUserDocId("uidA")).toBe(true);
  ["", "a/b", "..", "__x__"].forEach((id) => {
    expect(isSafeUserDocId(id)).toBe(false);
  });
});
