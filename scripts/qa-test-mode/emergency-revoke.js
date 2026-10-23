"use strict";

// 緊急下線：關閉總開關，並撤銷 persona 的 refresh token。預設 dry-run。

const {
  QA_UID_RE,
  QA_CONFIG_COLLECTION,
  QA_CONFIG_DOC_ID,
  parseArgs,
  resolveTarget,
  initAdmin,
  maskUid,
  reasonCode,
} = require("./lib");

function printHelp() {
  console.log([
    "緊急下線：qaTestMode/config.enabled=false，並對 persona 呼叫 revokeRefreshTokens。",
    "用法：node scripts/qa-test-mode/emergency-revoke.js --project <id> [--execute]",
    "正式環境寫入另需 --production --execute --confirm-project <id>。",
    "預設 dry-run，只列出將執行的動作。",
  ].join("\n"));
}

function isMissingUser(err) {
  return String(err && err.code || "") === "auth/user-not-found";
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
  const ref = db.collection(QA_CONFIG_COLLECTION).doc(QA_CONFIG_DOC_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error("qaTestMode/config 不存在，沒有可關閉的開關");
    process.exit(1);
  }
  const config = snap.data() || {};
  const personas = config.personas && typeof config.personas === "object" ? config.personas : {};
  const validUids = [];
  console.log(`目標：${target.mode} 專案 ${target.projectId} ${target.write ? "寫入" : "dry-run"}`);
  console.log("將更新 qaTestMode/config enabled=false");
  for (const [key, persona] of Object.entries(personas)) {
    const uid = persona && persona.uid;
    if (!QA_UID_RE.test(uid)) {
      console.log(`略過不符合 QA 區段的 persona ${key}：${maskUid(uid)}`);
      continue;
    }
    validUids.push(uid);
    console.log(`將呼叫 revokeRefreshTokens：${uid}`);
  }

  if (!target.write) {
    console.log("DRY-RUN：未寫入");
    return;
  }

  await ref.update({ enabled: false });
  console.log("已關閉 qaTestMode/config.enabled");
  let failed = 0;
  for (const uid of validUids) {
    try {
      await auth.revokeRefreshTokens(uid);
      console.log(`已撤銷：${uid}`);
    } catch (err) {
      if (isMissingUser(err)) {
        console.log(`Auth 使用者不存在，略過：${uid}`);
      } else {
        failed += 1;
        console.error(`撤銷失敗：${uid} ${reasonCode(err)}`);
      }
    }
  }
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : "執行失敗");
    process.exit(1);
  });
}
