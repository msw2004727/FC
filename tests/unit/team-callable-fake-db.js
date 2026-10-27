"use strict";

/**
 * team Callable 單元測試共用的記憶體版 Firestore（T-027 7b(A)）。
 * 只實作用得到的子集：doc／collection／subcollection、where(==, array-contains)、orderBy(documentId)＋limit＋startAfter、
 * batch（單批上限 500）、transaction（讀必須在寫之前、ABORTED 會重跑 callback）、
 * 文件 updateTime＋update 的 lastUpdateTime 前置條件、delete 的 exists 前置條件。
 *
 * 限制（不要假裝它有）：
 *  - 不模擬 transaction 隔離：交易內讀到的永遠是「目前值」，不會因為別人並發寫入而自動 ABORT；
 *    並發行為要用 state.beforeCommit 在 commit 前手動插入外部寫入（fake.touch／fake.remove）來模擬前置條件衝突。
 *  - 查詢沒有索引概念，orderBy 一律視為依文件 id 升冪；不支援其他運算子。
 *  - 寫入全部記在 state.writes（含 via＝direct／batch／tx 與 commit 序號），供測試斷言「碰了哪些路徑、是否同一次提交」。
 */

class FakeFirestoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const SERVER_TS = "SERVER_TS";
const FieldValue = { serverTimestamp: () => SERVER_TS };
const FieldPath = { documentId: () => "__name__" };
const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

function createFakeFirestore(seed = {}) {
  const store = new Map(Object.entries(seed).map(([path, data]) => [path, clone(data)]));
  const versions = new Map([...store.keys()].map((path) => [path, 1]));
  let versionCounter = 1;
  const bump = (path) => {
    versionCounter += 1;
    versions.set(path, versionCounter);
  };
  const state = {
    writes: [],
    commits: [],
    queryPages: 0,
    transactionAttempts: 0,
    abortTransactions: 0,
    failCommit: null, // ({ ops, commitNumber }) => Error | null
    failWrite: null, // ({ op, path }) => Error | null（只作用於 ref.update／ref.set 直接寫入）
    beforeCommit: null, // ({ ops, commitNumber }) => void，可在 commit 前呼叫 fake.touch／fake.remove 模擬並發寫入
  };

  function snapshot(path) {
    const exists = store.has(path);
    return {
      id: path.split("/").pop(),
      exists,
      ref: docRef(path),
      updateTime: exists ? versions.get(path) : undefined,
      data: () => (exists ? clone(store.get(path)) : undefined),
    };
  }

  function validate(ops) {
    ops.forEach((item) => {
      if (item.op === "update" && !store.has(item.path)) throw new FakeFirestoreError(5, `NOT_FOUND ${item.path}`);
      if (item.op === "update" && item.precondition?.lastUpdateTime !== undefined
        && versions.get(item.path) !== item.precondition.lastUpdateTime) {
        throw new FakeFirestoreError(9, `FAILED_PRECONDITION lastUpdateTime ${item.path}`);
      }
      if (item.op === "delete" && item.precondition?.exists === true && !store.has(item.path)) {
        throw new FakeFirestoreError(5, `NOT_FOUND ${item.path}`);
      }
    });
  }

  function applyOps(ops, meta) {
    validate(ops);
    ops.forEach((item) => {
      if (item.op === "update") store.set(item.path, { ...store.get(item.path), ...clone(item.data) });
      else if (item.op === "set") {
        store.set(item.path, item.merge ? { ...(store.get(item.path) || {}), ...clone(item.data) } : clone(item.data));
      } else store.delete(item.path);
      if (item.op === "delete") versions.delete(item.path);
      else bump(item.path);
      state.writes.push({ op: item.op, path: item.path, data: clone(item.data), via: meta.via, commit: meta.commit });
    });
  }

  function commitOps(ops, via) {
    if (ops.length > 500) throw new FakeFirestoreError(3, "INVALID_ARGUMENT: maximum 500 writes per commit");
    const commitNumber = state.commits.length + 1;
    if (state.beforeCommit) state.beforeCommit({ ops, commitNumber });
    const failure = state.failCommit ? state.failCommit({ ops, commitNumber }) : null;
    let outcome = failure;
    if (!outcome) {
      try {
        applyOps(ops, { via, commit: commitNumber });
      } catch (error) {
        outcome = error;
      }
    }
    state.commits.push({ size: ops.length, ok: !outcome });
    if (outcome) throw outcome;
  }

  function docRef(path) {
    const direct = (op) => async (data, options) => {
      const failure = state.failWrite ? state.failWrite({ op, path }) : null;
      if (failure) throw failure;
      applyOps([{ op, path, data, merge: !!options?.merge }], { via: "direct", commit: null });
    };
    return {
      id: path.split("/").pop(),
      path,
      _isDocRef: true,
      get: async () => snapshot(path),
      update: direct("update"),
      set: direct("set"),
      delete: async () => applyOps([{ op: "delete", path }], { via: "direct", commit: null }),
      collection: (name) => collectionRef(`${path}/${name}`),
    };
  }

  function listIds(path) {
    const prefix = `${path}/`;
    return [...store.keys()]
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
      .map((key) => key.slice(prefix.length))
      .sort();
  }

  function query(path, spec = {}) {
    const next = (patch) => query(path, { ...spec, ...patch });
    return {
      _isQuery: true,
      where: (field, operator, value) => next({ filters: [...(spec.filters || []), { field, operator, value }] }),
      orderBy: () => next({ ordered: true }),
      limit: (count) => next({ limit: count }),
      startAfter: (cursor) => next({ after: typeof cursor === "string" ? cursor : cursor.id }),
      get: async () => {
        state.queryPages += 1;
        let ids = listIds(path).filter((id) => (spec.filters || []).every(({ field, operator, value }) => {
          const fieldValue = store.get(`${path}/${id}`)?.[field];
          return operator === "array-contains"
            ? Array.isArray(fieldValue) && fieldValue.includes(value)
            : fieldValue === value;
        }));
        if (spec.after) ids = ids.filter((id) => id > spec.after);
        if (spec.limit) ids = ids.slice(0, spec.limit);
        const docs = ids.map((id) => snapshot(`${path}/${id}`));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
  }

  function collectionRef(path) {
    return { ...query(path), path, doc: (id) => docRef(`${path}/${id}`) };
  }

  function writer(ops, beforeWrite = () => {}) {
    return {
      update: (ref, data, precondition) => {
        beforeWrite();
        ops.push({ op: "update", path: ref.path, data, precondition });
      },
      set: (ref, data, options) => {
        beforeWrite();
        ops.push({ op: "set", path: ref.path, data, merge: !!options?.merge });
      },
      delete: (ref, precondition) => {
        beforeWrite();
        ops.push({ op: "delete", path: ref.path, precondition });
      },
    };
  }

  const db = {
    collection: (name) => collectionRef(name),
    batch: () => {
      const ops = [];
      return { ...writer(ops), commit: async () => commitOps(ops, "batch") };
    },
    runTransaction: async (callback) => {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        state.transactionAttempts += 1;
        const ops = [];
        let wrote = false;
        const tx = {
          ...writer(ops, () => { wrote = true; }),
          get: async (target) => {
            if (wrote) throw new Error("transaction reads must come before writes");
            return target.get();
          },
        };
        let result;
        try {
          result = await callback(tx);
        } catch (error) {
          if (error?.code === 10 && attempt < 5) continue;
          throw error;
        }
        if (state.abortTransactions > 0) {
          state.abortTransactions -= 1;
          continue;
        }
        commitOps(ops, "tx");
        return result;
      }
      throw new FakeFirestoreError(10, "ABORTED");
    },
  };

  return {
    db,
    state,
    get: (path) => clone(store.get(path)),
    has: (path) => store.has(path),
    list: (collectionPath) => listIds(collectionPath),
    writesTo: (prefix) => state.writes.filter((item) => item.path.startsWith(prefix)),
    // 模擬「別人」在讀與寫之間的並發寫入／刪除：不記在 state.writes，但會改變文件版本。
    touch: (path, patch) => {
      store.set(path, { ...(store.get(path) || {}), ...clone(patch) });
      bump(path);
    },
    remove: (path) => {
      store.delete(path);
      versions.delete(path);
    },
  };
}

function createAccess({ role = "captain", permissions = [] } = {}) {
  return {
    role,
    isSuperAdmin: role === "super_admin",
    hasPermission: (code) => role === "super_admin" || permissions.includes(code),
  };
}

function buildOperationLogPayload({ operator, type, typeName, content }) {
  return { time: "01/01 00:00", operator, type, typeName, content, createdAt: SERVER_TS };
}

const ROLE_LEVELS = Object.freeze({
  user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5,
});

const normalizeRole = (role) => (typeof role === "string" && role.trim() ? role.trim() : "user");

function createLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

module.exports = {
  FakeFirestoreError,
  FakeHttpsError,
  FieldPath,
  FieldValue,
  ROLE_LEVELS,
  SERVER_TS,
  buildOperationLogPayload,
  createAccess,
  createFakeFirestore,
  createLogger,
  normalizeRole,
};
