"use strict";

const BUILTIN_LEVELS = Object.freeze({
  user: 0,
  coach: 1,
  captain: 2,
  venue_owner: 3,
  admin: 4,
  super_admin: 5,
});
const BUILTIN_ROLE_KEYS = Object.keys(BUILTIN_LEVELS);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function compareDocumentIds(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function normalizeCustomRoleDocs(docs) {
  if (!Array.isArray(docs)) {
    throw new TypeError("Custom role documents must be an array");
  }

  const validRoles = [];
  const invalidKeys = [];
  const seen = new Set();

  docs.forEach((doc, index) => {
    const id = doc?.id;
    const data = doc?.data;
    const key = data?.key;
    const invalid = typeof id !== "string"
      || !id.trim()
      || !isPlainObject(data)
      || typeof key !== "string"
      || !key.trim()
      || key !== id
      || hasOwn(BUILTIN_LEVELS, key)
      || (data.afterRole !== undefined && typeof data.afterRole !== "string")
      || seen.has(key);

    if (invalid) {
      invalidKeys.push(
        typeof id === "string" && id ? id : `<document:${index}>`
      );
      return;
    }

    seen.add(key);
    validRoles.push({
      id,
      key,
      afterRole: data.afterRole || "captain",
    });
  });

  validRoles.sort(compareDocumentIds);
  return { validRoles, invalidKeys };
}

function buildRoleSequence(validRoles) {
  const sortedRoles = [...validRoles].sort(compareDocumentIds);
  const children = new Map();

  sortedRoles.forEach(role => {
    const parent = role.afterRole || "captain";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(role);
  });

  const sequence = [];
  const visited = new Set();

  BUILTIN_ROLE_KEYS.forEach(builtinKey => {
    sequence.push(builtinKey);
    const stack = [...(children.get(builtinKey) || [])].reverse();

    while (stack.length) {
      const role = stack.pop();
      if (visited.has(role.key)) continue;
      visited.add(role.key);
      sequence.push(role.key);

      const descendants = children.get(role.key) || [];
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        stack.push(descendants[index]);
      }
    }
  });

  return {
    sequence,
    unreachable: sortedRoles
      .filter(role => !visited.has(role.key))
      .map(role => role.key),
  };
}

function buildRoleLevelMap(sequence) {
  const levels = Object.assign(Object.create(null), BUILTIN_LEVELS);

  for (let index = 0; index < BUILTIN_ROLE_KEYS.length - 1; index += 1) {
    const startKey = BUILTIN_ROLE_KEYS[index];
    const endKey = BUILTIN_ROLE_KEYS[index + 1];
    const startIndex = sequence.indexOf(startKey);
    const endIndex = sequence.indexOf(endKey);
    if (startIndex < 0 || endIndex <= startIndex + 1) continue;

    const between = sequence.slice(startIndex + 1, endIndex);
    const step = (BUILTIN_LEVELS[endKey] - BUILTIN_LEVELS[startKey])
      / (between.length + 1);

    between.forEach((key, offset) => {
      if (!hasOwn(BUILTIN_LEVELS, key)) {
        levels[key] = BUILTIN_LEVELS[startKey] + step * (offset + 1);
      }
    });
  }

  return levels;
}

function resolveRoleGraph(docs) {
  const { validRoles, invalidKeys } = normalizeCustomRoleDocs(docs);
  const built = buildRoleSequence(validRoles);
  const levels = buildRoleLevelMap(built.sequence);

  // super_admin 後方沒有合法插值區間：掛在其後的角色拿不到層級，視為不可達並令整圖無效（fail-closed，不沿用前端 (4,5) 尾端映射）。
  // buildRoleSequence 保留實際遍歷結果；此處將無法取得層級的節點納入診斷。
  const unresolved = validRoles
    .filter(role => !hasOwn(levels, role.key))
    .map(role => role.key);
  const unreachable = [...new Set([...built.unreachable, ...unresolved])];

  return {
    ok: invalidKeys.length === 0 && unreachable.length === 0,
    levels,
    invalidKeys,
    unreachable,
  };
}

function createRoleGraphLoader({ db }) {
  return async function loadRoleGraph() {
    const snapshot = await db.collection("customRoles").get();
    return resolveRoleGraph(snapshot.docs.map(doc => ({
      id: doc.id,
      data: doc.data(),
    })));
  };
}

module.exports = {
  normalizeCustomRoleDocs,
  buildRoleSequence,
  buildRoleLevelMap,
  resolveRoleGraph,
  createRoleGraphLoader,
  BUILTIN_LEVELS,
};
