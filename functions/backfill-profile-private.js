"use strict";

// 會員資料讀取強化：私密子文件回填腳本。
// 用途：把既有 users/{docId} 根文件中 phone、email、companions、eduChildren 四欄，
//       一次性回填到 users/{docId}/profilePrivate/profile。
//       目標一律是 doc.id；uid／lineUserId 只用於計數，不決定寫入目標。
//
// 用法（不加旗標＝dry-run，只讀不寫）：
//   node functions/backfill-profile-private.js
//   node functions/backfill-profile-private.js --apply
//   node functions/backfill-profile-private.js --repair
//   node functions/backfill-profile-private.js --repair --apply
//   node functions/backfill-profile-private.js --verify
//   node functions/backfill-profile-private.js --limit 200
//   node functions/backfill-profile-private.js --only-doc <docId>
//   node functions/backfill-profile-private.js --start-after <docId>
//   node functions/backfill-profile-private.js --out <dir>
//
// 預設 dry-run；--apply 與 --repair --apply 屬正式資料寫入，須另裁。
// 只用站長本人登入後的既有 ADC，不得使用金鑰檔。

const fs = require("fs");
const os = require("os");
const path = require("path");
const { isDeepStrictEqual } = require("util");

const {
  PROFILE_PRIVATE_FIELDS,
  PROFILE_PRIVATE_COLLECTION,
  PROFILE_PRIVATE_DOC_ID,
} = require("./profile-private-mirror");

const PROJECT_ID = "fc-football-6c8dc";
const PAGE_SIZE = 300;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 600;

const REPO_ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = path.resolve(REPO_ROOT, "docs");
const DEFAULT_OUT_DIR = path.resolve(DOCS_DIR, "reports", "a3-02-backfill");

const USER_SELECT_FIELDS = [
  "phone",
  "email",
  "companions",
  "eduChildren",
  "uid",
  "lineUserId",
];

// ---------------------------------------------------------------------------
// 遮罩工具（供測試與輸出）
// ---------------------------------------------------------------------------

function maskId(id) {
  if (typeof id !== "string" || id.length === 0) return "***";
  if (id.length <= 5) return "***";
  return id[0] + "…" + id.slice(-4);
}

function maskPhone(value) {
  if (typeof value !== "string" || value.length === 0) return "***";
  return "***" + value.slice(-2);
}

function maskEmail(value) {
  if (typeof value !== "string" || value.length === 0) return "***";
  const at = value.indexOf("@");
  if (at <= 0 || at === value.length - 1) return "***";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return local[0] + "***@" + domain[0] + "***";
}

// ---------------------------------------------------------------------------
// 路徑檢核
// ---------------------------------------------------------------------------

function isPathUnder(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  if (c === p) return true;
  return c.startsWith(p + path.sep);
}

function isOutDirAllowed(resolvedDir) {
  return isPathUnder(resolvedDir, DOCS_DIR) || isPathUnder(resolvedDir, os.tmpdir());
}

// ---------------------------------------------------------------------------
// 旗標解析
// ---------------------------------------------------------------------------

function parseArgs(argv, env) {
  if (env && typeof env.GOOGLE_APPLICATION_CREDENTIALS === "string"
      && env.GOOGLE_APPLICATION_CREDENTIALS.length > 0) {
    const err = new Error("KEY_FILE_NOT_ALLOWED");
    err.code = "KEY_FILE_NOT_ALLOWED";
    throw err;
  }

  const tokens = Array.isArray(argv) ? argv.slice(2) : [];
  let apply = false;
  let repair = false;
  let verify = false;
  let limit = DEFAULT_LIMIT;
  let onlyDoc = null;
  let startAfter = null;
  let outDirRaw = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--apply") {
      apply = true;
    } else if (token === "--repair") {
      repair = true;
    } else if (token === "--verify") {
      verify = true;
    } else if (token === "--limit") {
      const value = tokens[i + 1];
      if (typeof value === "undefined" || value === "") throw new Error("MISSING_LIMIT");
      i += 1;
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) throw new Error("INVALID_LIMIT");
      if (n > MAX_LIMIT) throw new Error("LIMIT_EXCEEDS_600");
      limit = n;
    } else if (token === "--only-doc") {
      const value = tokens[i + 1];
      if (!value) throw new Error("MISSING_ONLY_DOC");
      onlyDoc = value;
      i += 1;
    } else if (token === "--start-after") {
      const value = tokens[i + 1];
      if (!value) throw new Error("MISSING_START_AFTER");
      startAfter = value;
      i += 1;
    } else if (token === "--out") {
      const value = tokens[i + 1];
      if (!value) throw new Error("MISSING_OUT");
      outDirRaw = value;
      i += 1;
    } else {
      throw new Error("UNKNOWN_FLAG");
    }
  }

  if (verify && apply) throw new Error("VERIFY_CONFLICTS_APPLY");
  if (verify && repair) throw new Error("VERIFY_CONFLICTS_REPAIR");

  let mode;
  if (verify) mode = "verify";
  else if (repair && apply) mode = "repair-apply";
  else if (repair) mode = "repair";
  else if (apply) mode = "apply";
  else mode = "dry-run";

  const outDir = outDirRaw
    ? path.resolve(outDirRaw)
    : DEFAULT_OUT_DIR;
  if (outDirRaw && !isOutDirAllowed(outDir)) {
    throw new Error("OUT_NOT_LOCAL_ONLY");
  }

  return { mode, limit, onlyDoc, startAfter, outDir, apply, repair, verify };
}

// ---------------------------------------------------------------------------
// 值萃取與判斷
// ---------------------------------------------------------------------------

function isFieldTypeValid(field, raw) {
  if (field === "phone" || field === "email") {
    return raw === null || raw === undefined || typeof raw === "string";
  }
  return raw === null || raw === undefined || Array.isArray(raw);
}

function isFieldValuePresent(field, raw) {
  if (field === "phone" || field === "email") {
    return typeof raw === "string" && raw.trim() !== "";
  }
  return Array.isArray(raw) && raw.length > 0;
}

function readPresentValues(data) {
  const values = {};
  for (const field of PROFILE_PRIVATE_FIELDS) {
    const raw = (data === null || typeof data !== "object") ? null : data[field];
    if (isFieldValuePresent(field, raw)) values[field] = raw;
  }
  return values;
}

function evaluatePrivate({ rootValues, privateData, privateExists }) {
  const missing = [];
  const diff = [];
  for (const field of Object.keys(rootValues)) {
    const hasOwn = privateExists
      && privateData !== null
      && (typeof privateData === "object")
      && Object.prototype.hasOwnProperty.call(privateData, field);
    if (!hasOwn) {
      missing.push(field);
    } else if (!isDeepStrictEqual(privateData[field], rootValues[field])) {
      diff.push(field);
    }
  }
  return { missing, diff };
}

// ---------------------------------------------------------------------------
// 讀取 users 目錄（分頁 300）
// ---------------------------------------------------------------------------

async function readAllUsers(db, FieldPath, onlyDoc, startAfter) {
  if (onlyDoc) {
    const snap = await db.collection("users").doc(onlyDoc).get();
    if (!snap.exists) return [];
    return [{ id: snap.id, data: snap.data() || {} }];
  }

  const orderField = (FieldPath && typeof FieldPath.documentId === "function")
    ? FieldPath.documentId()
    : "__name__";

  const results = [];
  let cursor = startAfter || null;
  let guard = 0;
  while (true) {
    guard += 1;
    if (guard > 1000) throw Object.assign(new Error("PAGINATION_RUNBOOK_LIMIT"), { code: "PAGINATION_LIMIT" });
    let query = db.collection("users")
      .select(...USER_SELECT_FIELDS)
      .orderBy(orderField);
    if (cursor) query = query.startAfter(cursor);
    query = query.limit(PAGE_SIZE);
    const snap = await query.get();
    const docs = snap.docs || [];
    for (const ds of docs) {
      results.push({ id: ds.id, data: ds.data() || {} });
    }
    if (docs.length < PAGE_SIZE) break;
    cursor = docs[docs.length - 1].id;
  }
  return results;
}

// ---------------------------------------------------------------------------
// 單份文件的寫入/比對
// ---------------------------------------------------------------------------

async function applyOneDoc({ db, FieldValue, mode, docId, report, samples }) {
  const rootRef = db.collection("users").doc(docId);
  const privateRef = rootRef.collection(PROFILE_PRIVATE_COLLECTION).doc(PROFILE_PRIVATE_DOC_ID);

  await db.runTransaction(async (tx) => {
    const rootSnap = await tx.get(rootRef);
    report.reads += 1;
    if (!rootSnap.exists) return;
    const privateSnap = await tx.get(privateRef);
    report.reads += 1;

    const rootData = rootSnap.data() || {};
    const rootValues = readPresentValues(rootData);
    if (Object.keys(rootValues).length === 0) return;

    const privateData = privateSnap.exists ? (privateSnap.data() || {}) : null;
    const { missing, diff } = evaluatePrivate({
      rootValues,
      privateData,
      privateExists: privateSnap.exists,
    });

    let writeFields;
    let isInconsistent;
    if (mode === "apply") {
      writeFields = missing.slice();
      isInconsistent = diff.length > 0;
    } else {
      writeFields = missing.concat(diff);
      isInconsistent = writeFields.length > 0;
    }

    if (isInconsistent) report.inconsistent += 1;

    if (writeFields.length === 0) {
      if (samples.length < 5) {
        samples.push({ docId: maskId(docId), outcome: isInconsistent ? "inconsistent" : "unchanged" });
      }
      return;
    }

    const payload = {};
    for (const field of writeFields) payload[field] = rootValues[field];
    payload.backfilledAt = FieldValue.serverTimestamp();
    payload.updatedAt = FieldValue.serverTimestamp();
    if (!privateSnap.exists) payload.createdAt = FieldValue.serverTimestamp();

    tx.set(privateRef, payload, { merge: true });
    report.writes += 1;
    report.written += 1;
    if (samples.length < 5) {
      samples.push({ docId: maskId(docId), outcome: "written", fieldsWritten: writeFields.slice() });
    }
  });
}

async function readOneDoc({ db, mode, docId, report, samples }) {
  const rootRef = db.collection("users").doc(docId);
  const privateRef = rootRef.collection(PROFILE_PRIVATE_COLLECTION).doc(PROFILE_PRIVATE_DOC_ID);

  const rootSnap = await rootRef.get();
  report.reads += 1;
  if (!rootSnap.exists) return;

  const privateSnap = await privateRef.get();
  report.reads += 1;

  const rootValues = readPresentValues(rootSnap.data() || {});
  if (Object.keys(rootValues).length === 0) return;

  const privateData = privateSnap.exists ? (privateSnap.data() || {}) : null;
  const { missing, diff } = evaluatePrivate({
    rootValues,
    privateData,
    privateExists: privateSnap.exists,
  });

  if (mode === "verify") {
    if (missing.length > 0 || diff.length > 0) {
      report.inconsistent += 1;
      if (samples.length < 5) samples.push({ docId: maskId(docId), outcome: "inconsistent" });
    } else if (samples.length < 5) {
      samples.push({ docId: maskId(docId), outcome: "unchanged" });
    }
  } else if (mode === "repair") {
    if (missing.length > 0 || diff.length > 0) {
      report.inconsistent += 1;
      report.wouldWrite += 1;
      if (samples.length < 5) samples.push({ docId: maskId(docId), outcome: "wouldWrite" });
    } else if (samples.length < 5) {
      samples.push({ docId: maskId(docId), outcome: "unchanged" });
    }
  } else {
    // dry-run (fill-if-empty)
    if (diff.length > 0) report.inconsistent += 1;
    if (missing.length > 0) {
      report.wouldWrite += 1;
      if (samples.length < 5) samples.push({ docId: maskId(docId), outcome: "wouldWrite" });
    } else if (diff.length > 0 && samples.length < 5) {
      samples.push({ docId: maskId(docId), outcome: "inconsistent" });
    } else if (samples.length < 5) {
      samples.push({ docId: maskId(docId), outcome: "unchanged" });
    }
  }
}

// ---------------------------------------------------------------------------
// 報告
// ---------------------------------------------------------------------------

function initReport(mode) {
  return {
    mode,
    scanned: 0,
    withValue: { phone: 0, email: 0, companions: 0, eduChildren: 0 },
    totalWithValue: 0,
    noValue: 0,
    typeAnomaly: { phone: 0, email: 0, companions: 0, eduChildren: 0 },
    idFieldMismatch: 0,
    legacyNoCanonical: 0,
    idFieldMismatchWithValue: 0,
    legacyNoCanonicalWithValue: 0,
    inconsistent: 0,
    wouldWrite: 0,
    written: 0,
    maxLen: { phone: 0, email: 0 },
    maxItems: { companions: 0, eduChildren: 0 },
    stoppedAt: null,
    nextStartAfter: null,
    reads: 0,
    writes: 0,
    samples: [],
    resume: {},
  };
}

function summarizeForStdout(report) {
  return {
    mode: report.mode,
    scanned: report.scanned,
    withValue: { ...report.withValue },
    totalWithValue: report.totalWithValue,
    noValue: report.noValue,
    typeAnomaly: { ...report.typeAnomaly },
    idFieldMismatch: report.idFieldMismatch,
    legacyNoCanonical: report.legacyNoCanonical,
    idFieldMismatchWithValue: report.idFieldMismatchWithValue,
    legacyNoCanonicalWithValue: report.legacyNoCanonicalWithValue,
    inconsistent: report.inconsistent,
    wouldWrite: report.wouldWrite,
    written: report.written,
    maxLen: { ...report.maxLen },
    maxItems: { ...report.maxItems },
    stoppedAt: report.stoppedAt,
    nextStartAfter: report.nextStartAfter,
    reads: report.reads,
    writes: report.writes,
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function runBackfill({
  db,
  FieldValue,
  FieldPath,
  mode,
  limit,
  onlyDoc,
  startAfter,
  writeReport,
  log,
  nowMs,
}) {
  const report = initReport(mode);
  const samples = [];
  const applyMode = mode === "apply" || mode === "repair-apply";
  let resumeDocId = null;

  try {
    const userDocs = await readAllUsers(db, FieldPath, onlyDoc, startAfter);
    report.reads += userDocs.length;
    const knownIds = new Set(userDocs.map((d) => d.id));

    for (const entry of userDocs) {
      const currentCount = applyMode ? report.written : report.wouldWrite;
      if (currentCount >= limit) {
        report.stoppedAt = "limit";
        break;
      }

      report.scanned += 1;
      const docId = entry.id;
      const data = entry.data || {};

      const presentValues = {};
      let hasAny = false;
      for (const field of PROFILE_PRIVATE_FIELDS) {
        const raw = data[field];
        if (!isFieldTypeValid(field, raw)) {
          report.typeAnomaly[field] += 1;
          continue;
        }
        if (!isFieldValuePresent(field, raw)) continue;
        presentValues[field] = raw;
        hasAny = true;
        report.withValue[field] += 1;
        if (field === "phone" || field === "email") {
          if (raw.length > report.maxLen[field]) report.maxLen[field] = raw.length;
        } else if (raw.length > report.maxItems[field]) {
          report.maxItems[field] = raw.length;
        }
      }

      const uid = data.uid;
      const lineUserId = data.lineUserId;
      const uidMismatch = typeof uid === "string" && uid.length > 0 && uid !== docId;
      const lineMismatch = typeof lineUserId === "string" && lineUserId.length > 0 && lineUserId !== docId;
      const idMismatch = uidMismatch || lineMismatch;
      if (idMismatch) report.idFieldMismatch += 1;

      let legacyMissing = false;
      if (typeof lineUserId === "string" && lineUserId.length > 0 && lineUserId !== docId) {
        if (!knownIds.has(lineUserId)) {
          legacyMissing = true;
          report.legacyNoCanonical += 1;
        }
      }

      if (hasAny) {
        if (idMismatch || legacyMissing) report.idFieldMismatchWithValue += 1;
        if (legacyMissing) report.legacyNoCanonicalWithValue += 1;
      }

      if (!hasAny) {
        report.noValue += 1;
        continue;
      }
      report.totalWithValue += 1;

      try {
        if (applyMode) {
          await applyOneDoc({ db, FieldValue, mode, docId, report, samples });
        } else {
          await readOneDoc({ db, mode, docId, report, samples });
        }
        resumeDocId = docId;
      } catch (err) {
        report.stoppedAt = "error";
        let rawCode = "unknown";
        if (err && (err.code || err.name)) rawCode = String(err.code || err.name);
        report.errorCode = rawCode.slice(0, 40);
        break;
      }

      const afterCount = applyMode ? report.written : report.wouldWrite;
      if (afterCount >= limit) {
        report.stoppedAt = "limit";
        break;
      }
    }
  } catch (err) {
    report.stoppedAt = "error";
    let rawCode = "unknown";
    if (err && (err.code || err.name)) rawCode = String(err.code || err.name);
    report.errorCode = rawCode.slice(0, 40);
  }

  if (resumeDocId) {
    report.nextStartAfter = maskId(resumeDocId);
    report.resume = { startAfter: resumeDocId };
  }
  report.samples = samples.slice(0, 5);

  const summary = summarizeForStdout(report);
  if (typeof log === "function") {
    log(JSON.stringify(summary, null, 2));
  }

  if (typeof writeReport === "function") {
    try {
      await writeReport({
        ...summary,
        samples: report.samples,
        resume: report.resume,
      });
    } catch (err) {
      // 報告檔寫入失敗不應覆蓋主結果；僅輸出到 stderr。
      // eslint-disable-next-line no-console
      console.error("[backfill-profile-private] writeReport failed:", String(err && (err.message || err)));
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const nowMs = Date.now();
  const args = parseArgs(process.argv, process.env);

  const { getApps, initializeApp } = require("firebase-admin/app");
  const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });

  const db = getFirestore();
  const reportDir = args.outDir;
  const mode = args.mode;

  const writeReport = (reportObj) => {
    fs.mkdirSync(reportDir, { recursive: true });
    const fileName = `backfill-${mode}-${nowMs}.json`;
    const filePath = path.join(reportDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(reportObj, null, 2), "utf8");
  };

  const report = await runBackfill({
    db,
    FieldValue,
    FieldPath,
    mode: args.mode,
    limit: args.limit,
    onlyDoc: args.onlyDoc,
    startAfter: args.startAfter,
    writeReport,
    log: (line) => process.stdout.write(line + "\n"),
    nowMs,
  });

  if (report.stoppedAt === "error") process.exit(1);
}

if (require.main === module) {
  main()
    .then(() => { process.exit(0); })
    .catch((err) => {
      const code = err && (err.code || err.name) ? String(err.code || err.name) : "unknown";
      console.error("[backfill-profile-private]", code);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  runBackfill,
  maskId,
  maskPhone,
  maskEmail,
};
