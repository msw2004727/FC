"use strict";

/**
 * T-087b：在 vm 內載入整份 functions/index.js（firebase-* 套件換成假的），直接跑真正的
 * registerForEvent／cancelRegistration handler，搭配記憶體版 Firestore。
 *
 * 假 Firestore 只實作這兩支 Callable 與其後置操作用得到的子集：
 *  - doc／collection／subcollection、where(==, array-contains, in)＋limit、add、batch(update/set/create/delete)。
 *  - transaction：讀必須在寫之前；commit 時以樂觀並發檢查「本次讀過的文件版本與查詢結果」，
 *    有變動就丟 ABORTED（code 10）並重跑 callback（最多 5 次，與 SDK 預設相同）；
 *    create 撞到既有文件丟 ALREADY_EXISTS（code 6）。
 *  - FieldValue.serverTimestamp／increment／delete／arrayUnion／arrayRemove；Timestamp.now／fromDate。
 * 限制：查詢沒有索引概念、不支援 orderBy 排序（回傳依文件 id）；collectionGroup 不支援。
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

// index.js 以 vm.runInThisContext 在主 realm 執行，jest 測試檔在沙箱 realm；
// 交給 index.js 的 Date 必須是主 realm 的，否則它的 instanceof Date 判斷會失敗。
const MainDate = vm.runInThisContext("Date");

class FakeTimestamp {
  constructor(ms) { this._ms = ms; }
  static now() { return new FakeTimestamp(Date.now()); }
  static fromDate(date) { return new FakeTimestamp(date.getTime()); }
  static fromMillis(ms) { return new FakeTimestamp(ms); }
  toDate() { return new MainDate(this._ms); }
  toMillis() { return this._ms; }
  get seconds() { return Math.floor(this._ms / 1000); }
  get nanoseconds() { return (this._ms % 1000) * 1e6; }
}

class Sentinel {
  constructor(kind, value) { this.kind = kind; this.value = value; }
}

const FieldValue = {
  serverTimestamp: () => new Sentinel("serverTimestamp"),
  increment: (n) => new Sentinel("increment", n),
  delete: () => new Sentinel("delete"),
  arrayUnion: (...items) => new Sentinel("arrayUnion", items),
  arrayRemove: (...items) => new Sentinel("arrayRemove", items),
};

class FakeFirestoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function clone(value) {
  if (value === undefined || value === null) return value;
  if (value instanceof FakeTimestamp) return new FakeTimestamp(value._ms);
  if (value instanceof Sentinel) return value;
  // index.js 在 vm（主 realm）執行，jest 測試檔在沙箱 realm：Date 不能用 instanceof 判斷。
  if (Object.prototype.toString.call(value) === "[object Date]") return new MainDate(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) throw new Error(`undefined field value: ${key}`);
      out[key] = clone(item);
    }
    return out;
  }
  return value;
}

function applyFieldValue(previous, next) {
  if (!(next instanceof Sentinel)) return clone(next);
  if (next.kind === "serverTimestamp") return FakeTimestamp.now();
  if (next.kind === "increment") return (Number(previous) || 0) + next.value;
  if (next.kind === "arrayUnion") {
    const base = Array.isArray(previous) ? [...previous] : [];
    next.value.forEach((item) => { if (!base.includes(item)) base.push(item); });
    return base;
  }
  if (next.kind === "arrayRemove") {
    return (Array.isArray(previous) ? previous : []).filter((item) => !next.value.includes(item));
  }
  return undefined;
}

function mergeData(previous, patch) {
  const out = { ...(previous || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value instanceof Sentinel && value.kind === "delete") {
      delete out[key];
      continue;
    }
    out[key] = applyFieldValue(out[key], value);
  }
  return out;
}

function createFakeFirestore(seed = {}) {
  const store = new Map();
  const versions = new Map();
  let versionCounter = 0;
  let autoId = 0;
  const state = {
    commits: [],
    writes: [],
    transactionAttempts: 0,
    reads: { tx: 0, direct: 0 },
    beforeTransactionCommit: null,
  };
  const bump = (p) => { versionCounter += 1; versions.set(p, versionCounter); };
  for (const [p, data] of Object.entries(seed)) {
    store.set(p, clone(data));
    bump(p);
  }

  const nextId = () => {
    autoId += 1;
    return `auto${String(autoId).padStart(5, "0")}`;
  };

  function snapshot(p) {
    const exists = store.has(p);
    return {
      id: p.split("/").pop(),
      exists,
      ref: docRef(p),
      data: () => (exists ? clone(store.get(p)) : undefined),
    };
  }

  function listChildIds(collectionPath) {
    const prefix = `${collectionPath}/`;
    return [...store.keys()]
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
      .map((key) => key.slice(prefix.length))
      .sort();
  }

  function runQuery(collectionPath, spec) {
    let ids = listChildIds(collectionPath).filter((id) => (spec.filters || []).every(({ field, op, value }) => {
      const fieldValue = store.get(`${collectionPath}/${id}`)?.[field];
      if (op === "==") return fieldValue === value;
      if (op === "array-contains") return Array.isArray(fieldValue) && fieldValue.includes(value);
      if (op === "in") return Array.isArray(value) && value.includes(fieldValue);
      throw new Error(`unsupported operator ${op}`);
    }));
    if (spec.limit) ids = ids.slice(0, spec.limit);
    const docs = ids.map((id) => snapshot(`${collectionPath}/${id}`));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
  }

  function query(collectionPath, spec = {}) {
    const next = (patch) => query(collectionPath, { ...spec, ...patch });
    return {
      _isQuery: true,
      _collectionPath: collectionPath,
      _spec: spec,
      where: (field, op, value) => next({ filters: [...(spec.filters || []), { field, op, value }] }),
      orderBy: () => next({}),
      limit: (count) => next({ limit: count }),
      get: async () => {
        state.reads.direct += 1;
        return runQuery(collectionPath, spec);
      },
    };
  }

  function validateOps(ops) {
    ops.forEach((item) => {
      if (item.op === "update" && !store.has(item.path)) throw new FakeFirestoreError(5, `NOT_FOUND ${item.path}`);
      if (item.op === "create" && store.has(item.path)) throw new FakeFirestoreError(6, `ALREADY_EXISTS ${item.path}`);
    });
  }

  function applyOps(ops, via) {
    validateOps(ops);
    const commitNumber = state.commits.length + 1;
    ops.forEach((item) => {
      if (item.op === "delete") {
        store.delete(item.path);
        versions.delete(item.path);
      } else if (item.op === "update") {
        store.set(item.path, mergeData(store.get(item.path), item.data));
        bump(item.path);
      } else if (item.op === "set" && item.merge) {
        store.set(item.path, mergeData(store.get(item.path), item.data));
        bump(item.path);
      } else {
        store.set(item.path, mergeData({}, item.data));
        bump(item.path);
      }
      state.writes.push({ op: item.op, path: item.path, via, commit: commitNumber });
    });
    state.commits.push({ via, size: ops.length });
  }

  function docRef(p) {
    return {
      id: p.split("/").pop(),
      path: p,
      _isDocRef: true,
      get: async () => {
        state.reads.direct += 1;
        return snapshot(p);
      },
      set: async (data, options) => applyOps([{ op: "set", path: p, data, merge: !!options?.merge }], "direct"),
      update: async (data) => applyOps([{ op: "update", path: p, data }], "direct"),
      create: async (data) => applyOps([{ op: "create", path: p, data }], "direct"),
      delete: async () => applyOps([{ op: "delete", path: p }], "direct"),
      collection: (name) => collectionRef(`${p}/${name}`),
    };
  }

  function collectionRef(p) {
    return {
      ...query(p),
      path: p,
      id: p.split("/").pop(),
      doc: (id) => docRef(`${p}/${id || nextId()}`),
      add: async (data) => {
        const ref = docRef(`${p}/${nextId()}`);
        applyOps([{ op: "create", path: ref.path, data }], "direct");
        return ref;
      },
    };
  }

  function writer(ops, onWrite) {
    return {
      update(ref, data) { onWrite(); ops.push({ op: "update", path: ref.path, data }); return this; },
      set(ref, data, options) { onWrite(); ops.push({ op: "set", path: ref.path, data, merge: !!options?.merge }); return this; },
      create(ref, data) { onWrite(); ops.push({ op: "create", path: ref.path, data }); return this; },
      delete(ref) { onWrite(); ops.push({ op: "delete", path: ref.path }); return this; },
    };
  }

  const db = {
    collection: (name) => collectionRef(name),
    batch: () => {
      const ops = [];
      return { ...writer(ops, () => {}), commit: async () => applyOps(ops, "batch") };
    },
    runTransaction: async (callback) => {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        state.transactionAttempts += 1;
        const ops = [];
        const readChecks = [];
        let wrote = false;
        const tx = {
          ...writer(ops, () => { wrote = true; }),
          get: async (target) => {
            if (wrote) throw new Error("transaction reads must come before writes");
            state.reads.tx += 1;
            // 讓並發的另一個請求有機會在讀與 commit 之間插入。
            await Promise.resolve();
            if (target?._isQuery) {
              const result = runQuery(target._collectionPath, target._spec);
              const signature = result.docs.map((d) => `${d.ref.path}@${versions.get(d.ref.path)}`).join("|");
              readChecks.push(() => runQuery(target._collectionPath, target._spec).docs
                .map((d) => `${d.ref.path}@${versions.get(d.ref.path)}`).join("|") === signature);
              return result;
            }
            const version = versions.get(target.path) || 0;
            readChecks.push(() => (versions.get(target.path) || 0) === version);
            return snapshot(target.path);
          },
        };
        let result;
        try {
          result = await callback(tx);
        } catch (error) {
          if (error?.code === 10 && attempt < 5) continue;
          throw error;
        }
        await Promise.resolve();
        if (state.beforeTransactionCommit) {
          const hook = state.beforeTransactionCommit;
          state.beforeTransactionCommit = null;
          await hook();
        }
        if (!readChecks.every((check) => check())) {
          if (attempt < 5) continue;
          throw new FakeFirestoreError(10, "ABORTED");
        }
        if (ops.length) applyOps(ops, "tx");
        return result;
      }
      throw new FakeFirestoreError(10, "ABORTED");
    },
  };

  return {
    db,
    state,
    get: (p) => (store.has(p) ? clone(store.get(p)) : undefined),
    has: (p) => store.has(p),
    list: (collectionPath) => listChildIds(collectionPath),
    paths: () => [...store.keys()].sort(),
    put: (p, data) => { store.set(p, clone(data)); bump(p); },
    txWrites: () => state.writes.filter((item) => item.via === "tx"),
  };
}

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// 載入整份 functions/index.js；getFirestore() 回傳的 db 會轉給 harness.current（每個測試換一個假 DB）。
function loadFunctionsIndex() {
  const file = path.join(__dirname, "..", "..", "functions", "index.js");
  const source = fs.readFileSync(file, "utf8");
  const realRequire = Module.createRequire(file);
  // 載入時就有模組（例如 user-directory）呼叫 db.collection()，先給一個空的假 DB；測試再換成自己的。
  const harness = { current: createFakeFirestore({}), logs: [] };
  const dbProxy = new Proxy({}, {
    get: (_target, key) => {
      if (!harness.current) throw new Error("harness db not set");
      const value = harness.current.db[key];
      return typeof value === "function" ? value.bind(harness.current.db) : value;
    },
  });
  const inert = () => new Proxy(function inertStub() {}, {
    get: (_t, key) => (key === "then" ? undefined : inert()),
    apply: () => inert(),
    construct: () => inert(),
  });
  const logger = {
    info: (...args) => harness.logs.push(["info", ...args]),
    warn: (...args) => harness.logs.push(["warn", ...args]),
    error: (...args) => harness.logs.push(["error", ...args]),
    log: (...args) => harness.logs.push(["log", ...args]),
    debug: () => {},
  };
  const stubs = {
    "firebase-functions/v2/firestore": {
      onDocumentCreated: (_o, h) => h,
      onDocumentWritten: (_o, h) => h,
      onDocumentWrittenWithAuthContext: (_o, h) => h,
    },
    "firebase-functions/v2/https": {
      onCall: (options, handler) => Object.assign(handler, { __options: options }),
      onRequest: (o, h) => h || o,
      HttpsError,
    },
    "firebase-functions/v2/scheduler": { onSchedule: (_o, h) => h },
    "firebase-functions/params": { defineSecret: () => ({ value: () => "" }) },
    "firebase-admin/app": { initializeApp: () => {} },
    "firebase-admin/firestore": {
      getFirestore: () => dbProxy,
      FieldValue,
      FieldPath: { documentId: () => "__name__" },
      Timestamp: FakeTimestamp,
    },
    "firebase-admin/auth": { getAuth: () => inert() },
    "firebase-functions/logger": logger,
    "firebase-admin/storage": { getStorage: () => inert() },
  };
  const localRequire = (name) => (stubs[name] ? stubs[name] : realRequire(name));
  const consoleProxy = {
    log: (...args) => harness.logs.push(["log", ...args]),
    info: (...args) => harness.logs.push(["info", ...args]),
    warn: (...args) => harness.logs.push(["warn", ...args]),
    error: (...args) => harness.logs.push(["error", ...args]),
    debug: () => {},
  };
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname, console) {${source}\n})`,
    { filename: file }
  );
  const mod = { exports: {} };
  wrapper(mod.exports, localRequire, mod, file, path.dirname(file), consoleProxy);
  return { exports: mod.exports, harness };
}

module.exports = {
  FakeTimestamp,
  FieldValue,
  HttpsError,
  createFakeFirestore,
  loadFunctionsIndex,
};
