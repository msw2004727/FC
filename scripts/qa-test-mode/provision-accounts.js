"use strict";

// 建立 QA 假帳號與測試俱樂部。不建立 Firebase Auth 使用者（首次簽 token 才會自動建立）。
// 預設 dry-run。

const {
  QA_UID_RE,
  QA_ALLOWED_ROLES,
  QA_DISPLAY_NAME_PREFIX,
  QA_CONFIG_COLLECTION,
  QA_CONFIG_DOC_ID,
  QA_TEAM_NAME,
  QA_UID_RANGE_START,
  QA_UID_RANGE_END,
  parseArgs,
  resolveTarget,
  findDangerousClaimKeys,
  initAdmin,
  buildUserDoc,
  buildTeamDoc,
  shouldJoinPersona,
  maskUid,
  reasonCode,
} = require("./lib");

function printHelp() {
  console.log([
    "建立 QA 假帳號與測試俱樂部（預設 dry-run）。請先執行 setup-config.js。",
    "用法：node scripts/qa-test-mode/provision-accounts.js --project <id> [--execute]",
    "正式環境寫入另需 --production --execute --confirm-project <id>。",
    "不建立 Firebase Auth 使用者。",
  ].join("\n"));
}

function isMissingUser(err) {
  return String(err && err.code || "") === "auth/user-not-found";
}

function checkExistingAuthUser(key, user) {
  const name = user.displayName === undefined || user.displayName === null ? "" : user.displayName;
  if (typeof name !== "string") {
    return { ok: false, message: `Auth 已有 persona ${key} 但顯示名稱不是 QA 前綴，已停止` };
  }
  if (name.startsWith(QA_DISPLAY_NAME_PREFIX)) {
    const dangerousKeys = findDangerousClaimKeys(user.customClaims);
    if (dangerousKeys.length > 0) {
      return { ok: false, message: `Auth 已有 persona ${key} 但 customClaims 含不安全鍵名：${dangerousKeys.join("、")}，已停止` };
    }
    return { ok: true, autoCreated: false };
  }
  if (name !== "") {
    return { ok: false, message: `Auth 已有 persona ${key} 但顯示名稱不是 QA 前綴，已停止` };
  }
  const hasValue = (value) => value !== undefined && value !== null && value !== "";
  if (hasValue(user.email)) {
    return { ok: false, message: `Auth 已有 persona ${key} 但有 email，已停止` };
  }
  if (hasValue(user.phoneNumber)) {
    return { ok: false, message: `Auth 已有 persona ${key} 但有 phoneNumber，已停止` };
  }
  if (user.providerData != null &&
      (!Array.isArray(user.providerData) || user.providerData.length > 0)) {
    return { ok: false, message: `Auth 已有 persona ${key} 但有登入方式，已停止` };
  }
  if (hasValue(user.passwordHash) || hasValue(user.passwordSalt)) {
    return { ok: false, message: `Auth 已有 persona ${key} 但有密碼登入，已停止` };
  }
  const dangerousKeys = findDangerousClaimKeys(user.customClaims);
  if (dangerousKeys.length > 0) {
    return { ok: false, message: `Auth 已有 persona ${key} 但 customClaims 含不安全鍵名：${dangerousKeys.join("、")}，已停止` };
  }
  if (user.customClaims !== undefined && user.customClaims !== null) {
    const claims = user.customClaims;
    const prototype = Object.getPrototypeOf(claims);
    if (Object.prototype.toString.call(claims) !== "[object Object]" ||
        (prototype !== null && prototype !== Object.prototype) ||
        Reflect.ownKeys(claims).length !== 0) {
      return { ok: false, message: `Auth 已有 persona ${key} 但 customClaims 非空，已停止` };
    }
  }
  return { ok: true, autoCreated: true };
}

function sameList(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function sameUserShape(current, expected) {
  if (!current) return false;
  const keys = ["uid", "lineUserId", "displayName", "role", "exp", "level", "teamId", "teamName"];
  for (const key of keys) {
    if (current[key] !== expected[key]) return false;
  }
  if (!sameList(current.teamIds, expected.teamIds)) return false;
  if (!sameList(current.teamNames, expected.teamNames)) return false;
  if (Object.prototype.hasOwnProperty.call(current, "lineNotify")) return false;
  return true;
}

function sameTeamShape(current, expected) {
  if (!current) return false;
  return current.id === expected.id &&
    current.name === expected.name &&
    current.captainUid === expected.captainUid &&
    current.members === expected.members &&
    sameList(current.coachUids, expected.coachUids);
}

function userSummary(action, doc) {
  const teamText = doc.teamId == null ? "null" : doc.teamId;
  return `${action} users/${doc.uid} role=${doc.role} displayName=${doc.displayName} teamId=${teamText} teamIds=${doc.teamIds.length}`;
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
  const configRef = db.collection(QA_CONFIG_COLLECTION).doc(QA_CONFIG_DOC_ID);
  const configSnap = await configRef.get();
  if (!configSnap.exists) {
    console.error("找不到 qaTestMode/config，請先執行 setup-config.js");
    process.exit(1);
  }
  const config = configSnap.data() || {};
  const personas = config.personas && typeof config.personas === "object" ? config.personas : {};
  const entries = Object.keys(personas).map((key) => [key, personas[key]]);
  if (entries.length === 0) {
    console.error("設定文件沒有 persona，請先執行 setup-config.js");
    process.exit(1);
  }

  const personaUids = new Set();
  for (const [key, persona] of entries) {
    const uid = persona && persona.uid;
    if (!QA_UID_RE.test(uid)) {
      console.error(`persona ${key} 的 UID 不符合 QA 區段（${maskUid(uid)}），已停止`);
      process.exit(1);
    }
    if (typeof persona.displayName !== "string" ||
        !persona.displayName.startsWith(QA_DISPLAY_NAME_PREFIX)) {
      console.error(`persona ${key} 的顯示名稱缺少前綴，已停止`);
      process.exit(1);
    }
    if (!QA_ALLOWED_ROLES.has(persona.role)) {
      console.error(`persona ${key} 的 role 不在允許清單，已停止`);
      process.exit(1);
    }
    personaUids.add(uid);
  }

  const team = config.teams && config.teams.main ? config.teams.main : {};
  const teamId = typeof team.teamId === "string" ? team.teamId.trim() : "";
  if (!teamId) {
    console.error("設定文件缺少 teams.main.teamId，請先執行 setup-config.js");
    process.exit(1);
  }
  const teamName = typeof team.name === "string" && team.name ? team.name : QA_TEAM_NAME;
  const teamRef = { teamId, name: teamName };

  let rangeSnap;
  try {
    rangeSnap = await db.collection("users")
      .where(admin.firestore.FieldPath.documentId(), ">=", QA_UID_RANGE_START)
      .where(admin.firestore.FieldPath.documentId(), "<=", QA_UID_RANGE_END)
      .get();
  } catch (err) {
    console.error(`查詢 QA UID 範圍失敗：${reasonCode(err)}`);
    process.exit(1);
  }
  for (const doc of rangeSnap.docs) {
    if (!personaUids.has(doc.id)) {
      console.error(`QA UID 範圍內存在不屬於 persona 的文件：${doc.id}，已停止`);
      process.exit(1);
    }
  }

  for (const [key, persona] of entries) {
    try {
      const user = await auth.getUser(persona.uid);
      const result = checkExistingAuthUser(key, user);
      if (!result.ok) {
        console.error(result.message);
        process.exit(1);
      }
      if (result.ok && result.autoCreated) {
        console.log(`Auth 帳號 ${key} 為登入時自動建立（無 email／無登入方式／無 claims）`);
      }
    } catch (err) {
      if (!isMissingUser(err)) {
        console.error(`讀取 Auth 使用者失敗：${reasonCode(err)}`);
        process.exit(1);
      }
    }
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const joining = entries.filter(([key, persona]) => shouldJoinPersona(key, { ...persona, key }));
  const userPlans = [];
  for (const [key, persona] of entries) {
    const joins = shouldJoinPersona(key, { ...persona, key });
    const expected = buildUserDoc({
      persona: { ...persona, key },
      team: joins ? teamRef : null,
      now,
    });
    const currentSnap = await db.collection("users").doc(persona.uid).get();
    if (currentSnap.exists && sameUserShape(currentSnap.data() || {}, expected)) {
      userPlans.push({ action: "skip", ref: currentSnap.ref, doc: expected });
    } else if (currentSnap.exists) {
      userPlans.push({ action: "overwrite", ref: currentSnap.ref, doc: expected });
    } else {
      userPlans.push({ action: "create", ref: currentSnap.ref, doc: expected });
    }
  }

  const teamDoc = buildTeamDoc({
    teamId,
    name: teamName,
    personas,
    memberCount: joining.length,
    now,
  });
  const teamSnap = await db.collection("teams").doc(teamId).get();
  let teamAction = "create";
  if (teamSnap.exists && sameTeamShape(teamSnap.data() || {}, teamDoc)) teamAction = "skip";
  else if (teamSnap.exists) teamAction = "overwrite";

  console.log(`目標：${target.mode} 專案 ${target.projectId} ${target.write ? "寫入" : "dry-run"}`);
  for (const plan of userPlans) {
    if (plan.action === "skip") console.log(userSummary("已建立，略過", plan.doc));
    else if (plan.action === "overwrite") console.log(userSummary("形狀不符，將覆寫", plan.doc));
    else console.log(userSummary("將建立", plan.doc));
  }
  const teamLabel = teamAction === "skip"
    ? "已建立，略過"
    : (teamAction === "overwrite" ? "形狀不符，將覆寫" : "將建立");
  console.log(`${teamLabel} teams/${teamId} name=${teamDoc.name} captainUid=${teamDoc.captainUid} coachUids=${teamDoc.coachUids.join(",")} members=${teamDoc.members}`);

  if (!target.write) {
    console.log("DRY-RUN：未寫入");
    return;
  }

  const batch = db.batch();
  let writes = 0;
  for (const plan of userPlans) {
    if (plan.action === "skip") continue;
    batch.set(plan.ref, plan.doc);
    writes += 1;
  }
  if (teamAction !== "skip") {
    batch.set(db.collection("teams").doc(teamId), teamDoc);
    writes += 1;
  }
  if (writes === 0) {
    console.log("無需寫入");
    return;
  }
  await batch.commit();
  console.log(`已寫入 ${writes} 筆`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : "執行失敗");
    process.exit(1);
  });
}

module.exports = { checkExistingAuthUser };
