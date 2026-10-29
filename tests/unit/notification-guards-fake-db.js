"use strict";

/**
 * 通知發送授權強化測試共用的記憶體版 Firestore（以路徑為鍵）。
 * 只實作用得到的子集：doc／collection／subcollection、get／set(merge)／update／create／delete、add、
 * where(==、array-contains)＋collection.get、getAll、batch(set/create/commit)、runTransaction。
 *
 * 限制（不要假裝它有）：
 *  - runTransaction 以序列佇列執行（模擬 Firestore 對同一文件交易的序列化），不模擬 ABORTED 重試。
 *  - FieldValue.increment 只在 set(merge)／update／交易內 set 生效；日期一律轉 ISO 字串。
 *  - faults 可讓指定寫入／讀取拋錯，用來驗證基礎設施失敗時的行為。
 */

const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

const FieldValue = {
  increment: (n) => ({ __op: "increment", n }),
  serverTimestamp: () => "__ts__",
};

class FakeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function applyData(existing, data, merge) {
  const next = merge ? { ...(existing || {}) } : {};
  Object.entries(data).forEach(([key, value]) => {
    if (value && typeof value === "object" && value.__op === "increment") {
      next[key] = (Number(next[key]) || 0) + value.n;
    } else if (value instanceof Date) {
      next[key] = value.toISOString();
    } else {
      next[key] = clone(value);
    }
  });
  return next;
}

function createFakeDb({ seed = {}, faults = {} } = {}) {
  const store = new Map(Object.entries(seed).map(([path, data]) => [path, clone(data)]));
  const state = { writes: [], autoIds: 0, transactionCalls: 0, getAllCalls: 0 };
  let txQueue = Promise.resolve();

  const snapshot = (path) => ({
    id: path.split("/").pop(),
    exists: store.has(path),
    ref: docRef(path),
    data: () => clone(store.get(path)),
  });

  function write(op, path, data, options) {
    const failure = faults.write ? faults.write({ op, path }) : null;
    if (failure) throw failure;
    if (op === "create" && store.has(path)) throw new FakeError(6, `6 ALREADY_EXISTS: ${path}`);
    if (op === "update" && !store.has(path)) throw new FakeError(5, `5 NOT_FOUND: ${path}`);
    if (op === "delete") {
      store.delete(path);
    } else {
      const merge = op === "update" || (op === "set" && !!options?.merge);
      store.set(path, applyData(store.get(path), data, merge));
    }
    state.writes.push({ op, path, data: clone(data) });
  }

  function docRef(path) {
    return {
      id: path.split("/").pop(),
      path,
      get: async () => {
        if (faults.read) {
          const failure = faults.read({ op: "get", path });
          if (failure) throw failure;
        }
        return snapshot(path);
      },
      set: async (data, options) => write("set", path, data, options),
      create: async (data) => write("create", path, data),
      update: async (data) => write("update", path, data),
      delete: async () => write("delete", path),
      collection: (name) => collectionRef(`${path}/${name}`),
    };
  }

  function childPaths(path) {
    const prefix = `${path}/`;
    return [...store.keys()]
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
      .sort();
  }

  function query(path, filters = []) {
    return {
      where: (field, op, value) => query(path, [...filters, { field, op, value }]),
      get: async () => {
        const docs = childPaths(path)
          .filter((childPath) => filters.every(({ field, op, value }) => {
            const actual = store.get(childPath)?.[field];
            return op === "array-contains" ? Array.isArray(actual) && actual.includes(value) : actual === value;
          }))
          .map(snapshot);
        return { docs, size: docs.length, empty: docs.length === 0, forEach: (cb) => docs.forEach(cb) };
      },
    };
  }

  function collectionRef(path) {
    return {
      ...query(path),
      path,
      doc: (id) => docRef(`${path}/${id || `auto_${++state.autoIds}`}`),
      add: async (data) => {
        const ref = docRef(`${path}/auto_${++state.autoIds}`);
        await ref.set(data);
        return ref;
      },
    };
  }

  return {
    state,
    collection: (name) => collectionRef(name),
    getAll: async (...refs) => {
      state.getAllCalls += 1;
      const failure = faults.getAll ? faults.getAll({ refs }) : null;
      if (failure) throw failure;
      return refs.map((ref) => snapshot(ref.path));
    },
    batch: () => {
      const ops = [];
      return {
        set: (ref, data, options) => ops.push({ op: "set", path: ref.path, data, options }),
        create: (ref, data) => ops.push({ op: "create", path: ref.path, data }),
        commit: async () => {
          const failure = faults.commit ? faults.commit() : null;
          if (failure) throw failure;
          if (ops.some((item) => item.op === "create" && store.has(item.path))) {
            throw new FakeError(6, "6 ALREADY_EXISTS: Document already exists");
          }
          ops.forEach((item) => write(item.op, item.path, item.data, item.options));
        },
      };
    },
    runTransaction: (callback) => {
      state.transactionCalls += 1;
      const run = async () => {
        const failure = faults.transaction ? faults.transaction() : null;
        if (failure) throw failure;
        const pending = [];
        const tx = {
          get: async (ref) => snapshot(ref.path),
          set: (ref, data, options) => pending.push({ op: "set", path: ref.path, data, options }),
          delete: (ref) => pending.push({ op: "delete", path: ref.path }),
        };
        const result = await callback(tx);
        pending.forEach((item) => write(item.op, item.path, item.data, item.options));
        return result;
      };
      const next = txQueue.then(run, run);
      txQueue = next.catch(() => {});
      return next;
    },
    read: (path) => clone(store.get(path)),
    has: (path) => store.has(path),
    paths: (prefix = "") => [...store.keys()].filter((key) => key.startsWith(prefix)).sort(),
  };
}

module.exports = { createFakeDb, FieldValue, FakeError };
