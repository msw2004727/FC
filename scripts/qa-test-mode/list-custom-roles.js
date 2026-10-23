"use strict";

// 唯讀腳本：列出 customRoles 並依位置推導 level。預設只對 emulator。
// 正式環境需站長放行。結果只供裁定，不會修改白名單，也不寫入任何資料。

const fs = require("fs");
const {
  parseArgs,
  resolveTarget,
  initAdmin,
} = require("./lib");

// 集合名稱是 customRoles，不是 roles。A 站寫入時文件 id 即 key；推導以文件內 key 為準（與 A 執行期一致），不一致時如實標出。沒有 level 欄位，level 由位置推導。
const CUSTOM_ROLES_COLLECTION = "customRoles";
const ADMIN_LEVEL = 4;
const NOTE = "僅供裁定；本腳本不會修改白名單；此推導以 js/config.js 演算法為準，若該檔演算法改動需同步";

// 以下推導移植 A 站 js/config.js：BUILTIN_ROLE_KEYS、_BASE_ROLE_LEVEL_MAP、
// _normalizeRuntimeCustomRoles、getRuntimeRoleSequence、_buildRuntimeRoleLevelMap、getRuntimeRoleLevel。
const BUILTIN_ROLE_KEYS = ["user", "coach", "captain", "venue_owner", "admin", "super_admin"];
const BASE_ROLE_LEVEL_MAP = {
  user: 0,
  coach: 1,
  captain: 2,
  venue_owner: 3,
  admin: 4,
  super_admin: 5,
};

function normalizeRuntimeCustomRoles(customRoles) {
  return (customRoles || [])
    .filter((role) => role && typeof role.key === "string" && role.key.trim())
    .map((role) => ({
      key: role.key,
      label: role.label || role.key,
      color: role.color || "#6366f1",
      afterRole: role.afterRole || "captain",
    }));
}

function getRuntimeRoleSequence(customRoles) {
  const roles = normalizeRuntimeCustomRoles(customRoles);
  const children = new Map();

  roles.forEach((role) => {
    const parent = role.afterRole || "captain";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(role);
  });

  const result = [];
  const visited = new Set();

  const appendRole = (roleKey) => {
    result.push(roleKey);
    const childRoles = children.get(roleKey) || [];
    childRoles.forEach((child) => {
      if (visited.has(child.key)) return;
      visited.add(child.key);
      appendRole(child.key);
    });
  };

  BUILTIN_ROLE_KEYS.forEach(appendRole);

  roles.forEach((role) => {
    if (visited.has(role.key)) return;
    visited.add(role.key);
    result.push(role.key);
  });

  return result;
}

function buildRuntimeRoleLevelMap(customRoles) {
  const levels = { ...BASE_ROLE_LEVEL_MAP };
  const sequence = getRuntimeRoleSequence(customRoles);

  for (let index = 0; index < BUILTIN_ROLE_KEYS.length - 1; index += 1) {
    const startKey = BUILTIN_ROLE_KEYS[index];
    const endKey = BUILTIN_ROLE_KEYS[index + 1];
    const startIndex = sequence.indexOf(startKey);
    const endIndex = sequence.indexOf(endKey);
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex + 1) continue;

    const between = sequence.slice(startIndex + 1, endIndex);
    const step = (BASE_ROLE_LEVEL_MAP[endKey] - BASE_ROLE_LEVEL_MAP[startKey]) / (between.length + 1);
    between.forEach((roleKey, roleIndex) => {
      levels[roleKey] = BASE_ROLE_LEVEL_MAP[startKey] + step * (roleIndex + 1);
    });
  }

  const superAdminIndex = sequence.indexOf("super_admin");
  if (superAdminIndex >= 0 && superAdminIndex < sequence.length - 1) {
    const deferredRoles = sequence.slice(superAdminIndex + 1);
    const step = (BASE_ROLE_LEVEL_MAP.super_admin - BASE_ROLE_LEVEL_MAP.admin) / (deferredRoles.length + 1);
    deferredRoles.forEach((roleKey, roleIndex) => {
      levels[roleKey] = BASE_ROLE_LEVEL_MAP.admin + (step * (roleIndex + 1));
    });
  }

  return levels;
}

function getRuntimeRoleLevel(roleKey, customRoles) {
  if (!roleKey) return 0;
  const levels = buildRuntimeRoleLevelMap(customRoles);
  return levels[roleKey] ?? 0;
}

function deriveCustomRoleLevels(customRoles) {
  const normalized = normalizeRuntimeCustomRoles(customRoles);
  const sequence = getRuntimeRoleSequence(customRoles);
  const byKey = new Map();
  normalized.forEach((role) => {
    if (!byKey.has(role.key)) byKey.set(role.key, role);
  });

  const emitted = new Set();
  const output = [];
  sequence.forEach((key) => {
    const role = byKey.get(key);
    if (!role || emitted.has(key)) return;
    emitted.add(key);
    const derivedLevel = getRuntimeRoleLevel(role.key, customRoles);
    output.push({
      key: role.key,
      label: role.label,
      afterRole: role.afterRole,
      derivedLevel,
      belowAdmin: derivedLevel < ADMIN_LEVEL,
    });
  });
  return output;
}

function docKey(doc) {
  const data = doc && typeof doc.data === "function" ? doc.data() : null;
  const raw = data && typeof data === "object" ? data : {};
  const rawKey = typeof raw.key === "string" ? raw.key : "";
  const docId = String((doc && doc.id) || "");
  // 非空才採用文件內 key。空白字串視為缺失，改用文件 id，且不算不一致。
  const hasOwnKey = rawKey.trim() !== "";
  const key = hasOwnKey ? raw.key : docId;
  return {
    key,
    label: raw.label,
    color: raw.color,
    afterRole: raw.afterRole,
    docId,
    keyMismatch: hasOwnKey && raw.key !== docId,
  };
}

async function listCustomRoles(db) {
  const snap = await db.collection(CUSTOM_ROLES_COLLECTION).get();
  const docs = snap && Array.isArray(snap.docs) ? snap.docs : [];
  const entries = docs.map(docKey);
  const firstByKey = new Map();
  const keyCounts = new Map();
  entries.forEach((entry) => {
    if (!firstByKey.has(entry.key)) firstByKey.set(entry.key, entry);
    keyCounts.set(entry.key, (keyCounts.get(entry.key) || 0) + 1);
  });

  // docId／keyMismatch 在推導後補上。同 key 多份文件時取陣列中的第一份。
  const roles = deriveCustomRoleLevels(entries).map((role) => {
    const source = firstByKey.get(role.key);
    return {
      ...role,
      docId: source ? source.docId : "",
      keyMismatch: Boolean(source && source.keyMismatch),
    };
  });
  const duplicateKeys = [...keyCounts.keys()]
    .filter((key) => keyCounts.get(key) >= 2)
    .sort();
  const keyMismatchCount = entries.filter((entry) => entry.keyMismatch).length;

  return {
    roles,
    documentCount: docs.length,
    duplicateKeys,
    keyMismatchCount,
  };
}

function resolveListTarget({ args, env } = {}) {
  const flags = args && typeof args === "object" ? args : {};
  // 正式環境即使唯讀也要 confirm。先拿掉 confirm，避免 lib 把「未寫入所以可不 confirm」放行。
  const target = resolveTarget({
    args: { ...flags, execute: false, confirmProject: "" },
    env,
  });
  if (target.mode === "production") {
    const confirm = typeof flags.confirmProject === "string" ? flags.confirmProject.trim() : "";
    if (!confirm || confirm !== target.projectId) {
      throw new Error("正式環境即使唯讀也必須同時提供 --production 與 --confirm-project，且值必須與專案 ID 相同");
    }
  }
  return { mode: target.mode, projectId: target.projectId };
}

function printHelp() {
  console.log([
    "唯讀列出 Firestore customRoles，並依 js/config.js 的位置演算法推導 level。",
    "不修改白名單，也不寫入任何資料。結果只供站長裁定。",
    "用法：node scripts/qa-test-mode/list-custom-roles.js --project <id> [--out <path>]",
    "預設只對 emulator，必須同時設定 FIRESTORE_EMULATOR_HOST 與 FIREBASE_AUTH_EMULATOR_HOST。",
    "正式環境即使唯讀也必須 --production --confirm-project <id>，且須站長放行。",
    "--execute 無意義，會被忽略。",
  ].join("\n"));
}

function summaryCount(roles) {
  return roles.filter((role) => role.belowAdmin).length;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.help) {
    printHelp();
    return;
  }
  if (args.execute === true) {
    console.warn("本腳本唯讀，忽略 --execute");
  }

  let target;
  try {
    target = resolveListTarget({ args, env: process.env });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const admin = initAdmin(target.projectId);
  const db = admin.firestore();
  const listed = await listCustomRoles(db);
  const roles = listed.roles;
  const belowAdmin = summaryCount(roles);
  const duplicateKeyCount = listed.duplicateKeys.length;

  console.log(`目標：${target.mode} 專案 ${target.projectId} 唯讀`);
  roles.forEach((role) => {
    console.log(
      `key=${role.key} label=${role.label} afterRole=${role.afterRole} derivedLevel=${role.derivedLevel} belowAdmin=${role.belowAdmin} docId=${role.docId} keyMismatch=${role.keyMismatch}`,
    );
  });
  console.log(
    `文件數：${listed.documentCount}；去重後角色數：${roles.length}；belowAdmin：${belowAdmin}；key 與文件 id 不一致：${listed.keyMismatchCount}；重複 key：${duplicateKeyCount}（${listed.duplicateKeys.join("、")}）`,
  );
  const warnings = [];
  if (listed.keyMismatchCount > 0 || duplicateKeyCount > 0) {
    warnings.push("有 key 異常，請人工核對 Firestore 內容再裁定");
    console.log(warnings[0]);
  }
  console.log(NOTE);

  if (args.out) {
    const payload = {
      mode: target.mode,
      projectId: target.projectId,
      roles,
      total: roles.length,
      belowAdmin,
      documentCount: listed.documentCount,
      duplicateKeys: listed.duplicateKeys,
      keyMismatchCount: listed.keyMismatchCount,
      warnings,
      note: NOTE,
    };
    fs.writeFileSync(args.out, JSON.stringify(payload, null, 2), { encoding: "utf8" });
    console.log(`已寫出：${args.out}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : "執行失敗");
    process.exit(1);
  });
}

module.exports = {
  deriveCustomRoleLevels,
  listCustomRoles,
  resolveListTarget,
};
