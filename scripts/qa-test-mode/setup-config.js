"use strict";

// 建立或更新 qaTestMode/config。預設 dry-run，且預設不開啟總開關。

const {
  QA_CONFIG_COLLECTION,
  QA_CONFIG_DOC_ID,
  parseArgs,
  resolveTarget,
  initAdmin,
  defaultPersonas,
  buildConfigDoc,
  generateId,
  maskUid,
  QA_UID_RE,
} = require("./lib");

function printHelp() {
  console.log([
    "建立或更新 qaTestMode/config（預設 dry-run、預設 enabled=false）。",
    "用法：node scripts/qa-test-mode/setup-config.js --project <id> [--execute] [--enable]",
    "正式環境寫入另需 --production --execute --confirm-project <id>。",
    "emulator 必須同時設定 FIRESTORE_EMULATOR_HOST 與 FIREBASE_AUTH_EMULATOR_HOST。",
  ].join("\n"));
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
  const ref = db.collection(QA_CONFIG_COLLECTION).doc(QA_CONFIG_DOC_ID);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() || {}) : null;
  const existingTeamId = existing && existing.teams && existing.teams.main
    ? String(existing.teams.main.teamId || "").trim() : "";
  const generated = !existingTeamId;
  const teamId = existingTeamId || generateId("tm_");
  const doc = buildConfigDoc({
    existing,
    enable: args.enable === true,
    personas: defaultPersonas(),
    teamId,
  });

  console.log(`目標：${target.mode} 專案 ${target.projectId} ${target.write ? "寫入" : "dry-run"}`);
  for (const [key, persona] of Object.entries(doc.personas || {})) {
    if (!persona || typeof persona.uid !== "string" || !QA_UID_RE.test(persona.uid)) {
      console.log(`警告：既有 persona ${key} 的 UID 不符合 QA 區段（${maskUid(persona && persona.uid)}），已原樣保留`);
    }
  }
  console.log(JSON.stringify(doc, null, 2));
  if (generated && !target.write) {
    console.log("teams.main.teamId 為本次預覽，尚未寫入；下次執行會再產生");
  }
  if (!target.write) {
    console.log("DRY-RUN：未寫入");
    return;
  }
  await ref.set(doc);
  console.log("已寫入 qaTestMode/config");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : "執行失敗");
    process.exit(1);
  });
}
