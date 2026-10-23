"use strict";

// 只在 emulator 檢查 custom token 的 qa* claims 能否熬過刷新，以及撤銷後 refresh 是否失敗。
// 預設 dry-run，不呼叫 Admin 或 Auth REST。不印出 token。

const http = require("http");
const {
  QA_UID_RE,
  parseArgs,
  resolveTarget,
  initAdmin,
} = require("./lib");

const CHECK_UID = "U" + "0".repeat(28) + "9999";
const REVOKE_TIMING_NOTE = "emulator 是否強制執行撤銷僅供參考；正式環境行為以 Firebase 文件為準";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printHelp() {
  console.log([
    "只允許 emulator。簽發測試 UID 的 custom token，換 idToken 後再 refresh，最後撤銷。",
    "用法：node scripts/qa-test-mode/emulator-claims-check.js --project <id> [--execute]",
    "未帶 --execute 為 dry-run，不呼叫 Admin 或 Auth REST。",
    "必須同時設定 FIRESTORE_EMULATOR_HOST 與 FIREBASE_AUTH_EMULATOR_HOST。",
  ].join("\n"));
}

function authOrigin(env) {
  const raw = String(env.FIREBASE_AUTH_EMULATOR_HOST || "").trim().replace(/\/$/, "");
  const host = raw.replace(/^https?:\/\//, "");
  return `http://${host}`;
}

function httpPost(urlString, payload, contentType) {
  const target = new URL(urlString);
  const body = Buffer.from(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "Content-Length": body.length,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode || 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function readIdToken(parsed) {
  if (!parsed || typeof parsed !== "object") return "";
  return parsed.idToken || parsed.id_token || "";
}

function readRefreshToken(parsed) {
  if (!parsed || typeof parsed !== "object") return "";
  return parsed.refreshToken || parsed.refresh_token || "";
}

function decodePayload(idToken) {
  const part = String(idToken || "").split(".")[1] || "";
  if (!part) return null;
  const pad = part.length % 4 === 0 ? "" : "=".repeat(4 - (part.length % 4));
  const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
  return parseJson(json);
}

function pickClaims(payload) {
  const claims = {};
  if (!payload || typeof payload !== "object") {
    return { iss: false, aud: false };
  }
  for (const key of Object.keys(payload)) {
    if (key.startsWith("qa")) claims[key] = payload[key];
  }
  claims.iss = Object.prototype.hasOwnProperty.call(payload, "iss");
  claims.aud = Object.prototype.hasOwnProperty.call(payload, "aud");
  return claims;
}

function qaEqual(left, right) {
  const keys = (claims) => Object.keys(claims || {}).filter((key) => key.startsWith("qa")).sort();
  const a = keys(left);
  const b = keys(right);
  if (a.length !== b.length) return false;
  return a.every((key, index) => key === b[index] && left[key] === right[key]);
}

async function exchange(origin, customToken) {
  return httpPost(
    `${origin}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    JSON.stringify({ token: customToken, returnSecureToken: true }),
    "application/json"
  );
}

async function refresh(origin, refreshToken) {
  const form = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
  return httpPost(
    `${origin}/securetoken.googleapis.com/v1/token?key=fake-api-key`,
    form,
    "application/x-www-form-urlencoded"
  );
}

function printReport(report) {
  console.log(JSON.stringify(report));
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
  if (target.mode !== "emulator") {
    console.error("此腳本只允許在 emulator 執行");
    process.exit(2);
  }
  if (!QA_UID_RE.test(CHECK_UID)) {
    console.error("測試 UID 不符合 QA 區段");
    process.exit(1);
  }
  if (target.write !== true) {
    console.log("DRY-RUN：將簽發測試 token、換 idToken、refresh、撤銷並再 refresh（不影響任何資料以外狀態）");
    return;
  }

  const empty = {
    claimsAfterSignIn: null,
    claimsAfterRefresh: null,
    preservedAfterRefresh: false,
    refreshFailsAfterRevoke: true,
    note: REVOKE_TIMING_NOTE,
  };
  const admin = initAdmin(target.projectId);
  const auth = admin.auth();
  const origin = authOrigin(process.env);
  const qaExp = Date.now() + 60 * 60 * 1000;
  let customToken = "";
  try {
    customToken = await auth.createCustomToken(CHECK_UID, {
      qa: true,
      qaTeamId: "tm_check",
      qaExp,
      qaAgent: "check",
      qaPersona: "captain",
    });
  } catch (err) {
    console.error("簽發 custom token 失敗");
    printReport(empty);
    process.exit(1);
  }

  let signed;
  try {
    signed = await exchange(origin, customToken);
  } catch (err) {
    console.error("換 idToken 失敗");
    printReport(empty);
    process.exit(1);
  }
  customToken = "";
  const signInJson = signed.status === 200 ? parseJson(signed.body) : null;
  const idToken = readIdToken(signInJson);
  let refreshToken = readRefreshToken(signInJson);
  if (!idToken || !refreshToken) {
    console.error(`登入 custom token 失敗：HTTP ${signed.status}`);
    printReport(empty);
    process.exit(1);
  }

  const claimsAfterSignIn = pickClaims(decodePayload(idToken));
  let claimsAfterRefresh = null;
  try {
    const refreshed = await refresh(origin, refreshToken);
    const refreshJson = refreshed.status === 200 ? parseJson(refreshed.body) : null;
    const nextId = readIdToken(refreshJson);
    const rotated = readRefreshToken(refreshJson);
    if (rotated) refreshToken = rotated;
    if (nextId) claimsAfterRefresh = pickClaims(decodePayload(nextId));
  } catch (err) {
    claimsAfterRefresh = null;
  }

  let refreshFailsAfterRevoke = true;
  try {
    // validSince 以秒為單位；與簽發落在同一秒時，舊 token 不會被視為已撤銷。
    await sleep(1500);
    await auth.revokeRefreshTokens(CHECK_UID);
    await sleep(1500);
    const after = await refresh(origin, refreshToken);
    const afterJson = after.status === 200 ? parseJson(after.body) : null;
    refreshFailsAfterRevoke = !(after.status === 200 && readIdToken(afterJson));
  } catch (err) {
    refreshFailsAfterRevoke = true;
  }

  printReport({
    claimsAfterSignIn,
    claimsAfterRefresh,
    preservedAfterRefresh: qaEqual(claimsAfterSignIn, claimsAfterRefresh),
    refreshFailsAfterRevoke,
    note: REVOKE_TIMING_NOTE,
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : "執行失敗");
    process.exit(1);
  });
}
