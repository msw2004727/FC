"use strict";

// 只列出、不刪除。刪除另需站長點頭，故不在此實作。

const fs = require("fs");
const {
  QA_UID_RE,
  QA_CONFIG_COLLECTION,
  QA_CONFIG_DOC_ID,
  QA_UID_RANGE_START,
  QA_UID_RANGE_END,
  CLEANUP_CATEGORIES,
  parseArgs,
  resolveTarget,
  initAdmin,
  maskPath,
  reasonCode,
} = require("./lib");

const IN_LIMIT = 30;

function printHelp() {
  console.log([
    "只列出 QA 測試資料，不刪除。",
    "用法：node scripts/qa-test-mode/cleanup-report.js --project <id> [--out <path>]",
    "正式環境查詢另需 --production。--execute 也不會刪除任何資料。",
  ].join("\n"));
}

function failureText(err) {
  return `查詢失敗：${reasonCode(err)}`;
}

function dedupe(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (!entry || !entry.path || seen.has(entry.path)) continue;
    seen.add(entry.path);
    out.push({ path: entry.path, warning: entry.warning || "" });
  }
  return out;
}

async function collectWhere(baseQuery, field, op, values) {
  const docs = [];
  const list = (values || []).filter((value) => value != null && value !== "");
  if (list.length === 0) return docs;
  if (op === "array-contains") {
    for (const value of list) {
      const snap = await baseQuery.where(field, "array-contains", value).get();
      snap.forEach((doc) => docs.push(doc));
    }
    return docs;
  }
  for (let index = 0; index < list.length; index += IN_LIMIT) {
    const chunk = list.slice(index, index + IN_LIMIT);
    const snap = chunk.length === 1
      ? await baseQuery.where(field, "==", chunk[0]).get()
      : await baseQuery.where(field, "in", chunk).get();
    snap.forEach((doc) => docs.push(doc));
  }
  return docs;
}

function warningFor(doc, warn, ctx) {
  const data = doc.data() || {};
  if (warn === "event") {
    if (typeof data.creatorUid === "string" && ctx.qaUidSet.has(data.creatorUid)) {
      return "QA 建立，刪除前需站長確認";
    }
    return "非 QA 建立，只清欄位、不刪活動";
  }
  if (warn === "team") {
    if (ctx.qaTeamIds.has(doc.id)) return "設定中的測試俱樂部";
    return "真實俱樂部含 QA UID，只清欄位";
  }
  if (warn === "userTeam") return "使用者指向測試俱樂部";
  return "";
}

async function runDocTree(db, probe, ctx) {
  const entries = [];
  for (const uid of ctx.qaUids) {
    const ref = db.collection(probe.collection).doc(uid);
    const snap = await ref.get();
    if (snap.exists) entries.push({ path: ref.path });
    for (const name of probe.subcollections || []) {
      const sub = await ref.collection(name).get();
      sub.forEach((doc) => entries.push({ path: doc.ref.path }));
    }
    for (const nested of probe.nested || []) {
      const parents = await ref.collection(nested.parent).get();
      for (const parent of parents.docs) {
        entries.push({ path: parent.ref.path });
        const children = await parent.ref.collection(nested.child).get();
        children.forEach((doc) => entries.push({ path: doc.ref.path }));
      }
    }
  }
  return entries;
}

async function runDocId(db, probe, ctx) {
  const entries = [];
  for (const uid of ctx.qaUids) {
    for (const spec of probe.docs || []) {
      const ref = db.collection(spec.collection).doc(uid);
      const snap = await ref.get();
      if (snap.exists) entries.push({ path: ref.path });
      for (const name of spec.subcollections || []) {
        const sub = await ref.collection(name).get();
        sub.forEach((doc) => entries.push({ path: doc.ref.path }));
      }
    }
  }
  return entries;
}

async function runWhere(db, probe, ctx) {
  const base = probe.scope === "collectionGroup"
    ? db.collectionGroup(probe.name)
    : db.collection(probe.name);
  const values = probe.values === "qaTeamIds" ? ctx.qaTeamIdsList : ctx.qaUids;
  let docs = await collectWhere(base, probe.field, probe.op, values);
  if (probe.filterAction) {
    docs = docs.filter((doc) => (doc.data() || {}).actionType === probe.filterAction);
  }
  return docs.map((doc) => ({
    path: doc.ref.path,
    warning: warningFor(doc, probe.warn, ctx),
  }));
}

async function runSubWhere(db, probe, ctx) {
  const entries = [];
  for (const uid of ctx.qaUids) {
    const snap = await db.collection(probe.parent).doc(uid)
      .collection(probe.subcollection)
      .where(probe.field, "==", probe.value)
      .get();
    snap.forEach((doc) => entries.push({ path: doc.ref.path }));
  }
  return entries;
}

async function runPmPeer(db, ctx) {
  const entries = [];
  const idRe = /^pm_(U[0-9a-fA-F]{32})_(U[0-9a-fA-F]{32})$/;
  for (const uid of ctx.qaUids) {
    const threads = await db.collection("users").doc(uid).collection("pmThreads").get();
    for (const doc of threads.docs) {
      const matched = idRe.exec(doc.id);
      if (!matched) continue;
      const peers = [matched[1], matched[2]].filter((peer) => peer && peer !== uid);
      for (const peer of peers) {
        const peerSnap = await db.collection("users").doc(peer).collection("pmThreads").doc(doc.id).get();
        if (!peerSnap.exists) continue;
        const warning = ctx.qaUidSet.has(peer) ? "" : "真人側副本，需人工確認";
        entries.push({ path: peerSnap.ref.path, warning });
      }
    }
  }
  return entries;
}

async function runAuthUsers(auth, ctx) {
  const entries = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      if (QA_UID_RE.test(user.uid) || ctx.qaUidSet.has(user.uid)) {
        entries.push({ path: `authUsers/${user.uid}` });
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return entries;
}

async function runProbe(db, auth, probe, ctx) {
  if (probe.type === "docTree") return runDocTree(db, probe, ctx);
  if (probe.type === "docId") return runDocId(db, probe, ctx);
  if (probe.type === "where") return runWhere(db, probe, ctx);
  if (probe.type === "subWhere") return runSubWhere(db, probe, ctx);
  if (probe.type === "pmPeer") return runPmPeer(db, ctx);
  if (probe.type === "authUsers") return runAuthUsers(auth, ctx);
  throw Object.assign(new Error("unknown probe"), { code: "unknown-probe" });
}

async function loadContext(db, config, FieldPath) {
  const qaUidSet = new Set();
  const personas = config.personas && typeof config.personas === "object" ? config.personas : {};
  for (const persona of Object.values(personas)) {
    if (persona && QA_UID_RE.test(persona.uid)) qaUidSet.add(persona.uid);
  }
  const rangeSnap = await db.collection("users")
    .where(FieldPath.documentId(), ">=", QA_UID_RANGE_START)
    .where(FieldPath.documentId(), "<=", QA_UID_RANGE_END)
    .get();
  rangeSnap.forEach((doc) => {
    if (QA_UID_RE.test(doc.id)) qaUidSet.add(doc.id);
  });
  const qaTeamIds = new Set();
  const teams = config.teams && typeof config.teams === "object" ? config.teams : {};
  for (const team of Object.values(teams)) {
    if (team && typeof team.teamId === "string" && team.teamId.trim()) {
      qaTeamIds.add(team.teamId.trim());
    }
  }
  return {
    qaUids: [...qaUidSet],
    qaUidSet,
    qaTeamIds,
    qaTeamIdsList: [...qaTeamIds],
  };
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

  let target;
  try {
    target = resolveTarget({ args, env: process.env });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const admin = initAdmin(target.projectId);
  const db = admin.firestore();
  const auth = admin.auth();
  let config = { personas: {}, teams: {} };
  const preamble = [];
  try {
    const snap = await db.collection(QA_CONFIG_COLLECTION).doc(QA_CONFIG_DOC_ID).get();
    if (snap.exists) config = snap.data() || config;
    else preamble.push("設定文件不存在，只依 QA UID 範圍列出");
  } catch (err) {
    preamble.push(failureText(err));
  }

  let ctx;
  try {
    ctx = await loadContext(db, config, admin.firestore.FieldPath);
  } catch (err) {
    preamble.push(failureText(err));
    ctx = {
      qaUids: Object.values(config.personas || {})
        .map((persona) => persona && persona.uid)
        .filter((uid) => QA_UID_RE.test(uid)),
      qaUidSet: new Set(),
      qaTeamIds: new Set(),
      qaTeamIdsList: [],
    };
    ctx.qaUids.forEach((uid) => ctx.qaUidSet.add(uid));
  }

  console.log(`目標：${target.mode} 專案 ${target.projectId} 只讀`);
  for (const line of preamble) console.log(line);

  const categories = [];
  for (const category of CLEANUP_CATEGORIES) {
    const found = [];
    const failures = [];
    for (const probe of category.probes || []) {
      try {
        const entries = await runProbe(db, auth, probe, ctx);
        found.push(...entries);
      } catch (err) {
        failures.push(failureText(err));
      }
    }
    const paths = dedupe(found).map((entry) => ({
      path: maskPath(entry.path, ctx.qaUidSet),
      warning: entry.warning,
    }));
    const item = {
      key: category.key,
      label: category.label,
      kind: category.kind,
      count: paths.length,
      failures,
      paths,
    };
    if (category.matches) item.matches = category.matches;
    if (category.note) item.note = category.note;
    categories.push(item);

    const head = `[${category.key}] ${category.label}：${paths.length} 筆`;
    console.log(failures.length ? `${head}；${failures.join("；")}` : head);
    if (category.matches) console.log(`  matches 裁判欄位：${category.matches}`);
    for (const entry of paths.slice(0, 20)) {
      console.log(entry.warning ? `  ${entry.path}（${entry.warning}）` : `  ${entry.path}`);
    }
  }

  const report = {
    projectId: target.projectId,
    mode: target.mode,
    generatedAt: new Date().toISOString(),
    qaUids: ctx.qaUids,
    qaTeamIds: ctx.qaTeamIdsList,
    preamble,
    categories,
  };
  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2), { encoding: "utf8" });
    console.log(`已寫出報告：${args.out}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : "執行失敗");
    process.exit(1);
  });
}

module.exports = { main };
