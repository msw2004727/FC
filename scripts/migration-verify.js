#!/usr/bin/env node
/**
 * Subcollection Migration Verification Scripts
 *
 * Standalone Node.js scripts that run against LIVE Firestore (Admin SDK)
 * to verify data integrity at each migration phase.
 *
 * Usage:
 *   node scripts/migration-verify.js baseline    — E. 統計基線快照（Phase 0 前執行）
 *   node scripts/migration-verify.js phase1      — F. 雙寫一致性（Phase 1 後執行）
 *   node scripts/migration-verify.js phase2      — G. 遷移完整性（Phase 2 後執行）
 *   node scripts/migration-verify.js phase3      — H. 讀取等價性 + 去重（Phase 3 後執行）
 *   node scripts/migration-verify.js all         — 全部（Phase 3 後執行）
 *
 * Prerequisites:
 *   - GOOGLE_APPLICATION_CREDENTIALS 或 firebase login
 *   - npm install firebase-admin (in functions/ directory)
 *
 * Output:
 *   - Console: PASS/FAIL per check
 *   - File: scripts/migration-baseline.json (baseline command)
 */

const path = require("path");

// ═══════════════════════════════════════════════════════════════
//  Firebase Admin SDK init
// ═══════════════════════════════════════════════════════════════
let admin, db;

function initFirebase() {
  // Try to use functions/ directory's firebase-admin
  try {
    admin = require(path.resolve(__dirname, "../functions/node_modules/firebase-admin"));
  } catch (_e1) {
    try {
      admin = require("firebase-admin");
    } catch (_e2) {
      console.error(
        "❌ firebase-admin not found.\n" +
        "   Run: cd functions && npm install\n" +
        "   Or:  npm install firebase-admin"
      );
      process.exit(1);
    }
  }

  // Check credentials
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_CONFIG && !process.env.GCLOUD_PROJECT) {
    console.warn(
      "⚠️  No GOOGLE_APPLICATION_CREDENTIALS detected.\n" +
      "   The script will use Application Default Credentials.\n" +
      "   If this fails, run: firebase login  OR  set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json\n"
    );
  }

  if (!admin.apps.length) {
    // Read project ID from .firebaserc (ensures correct Firestore project)
    const fs = require("fs");
    const rcPath = path.resolve(__dirname, "../.firebaserc");
    let projectId = null;
    try {
      const rc = JSON.parse(fs.readFileSync(rcPath, "utf-8"));
      projectId = rc.projects && rc.projects.default;
    } catch (_) { /* ignore */ }

    if (projectId) {
      admin.initializeApp({ projectId });
      console.log(`  ℹ️  Using Firebase project: ${projectId}\n`);
    } else {
      admin.initializeApp();
      console.warn("  ⚠️  No .firebaserc found, using default project\n");
    }
  }
  db = admin.firestore();
}

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════
const COLLECTIONS = ["registrations", "attendanceRecords", "activityRecords"];

let passCount = 0;
let failCount = 0;
let warnCount = 0;

function pass(msg) { passCount++; console.log(`  ✅ PASS: ${msg}`); }
function fail(msg) { failCount++; console.log(`  ❌ FAIL: ${msg}`); }
function warn(msg) { warnCount++; console.log(`  ⚠️  WARN: ${msg}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }
function header(msg) { console.log(`\n${"═".repeat(60)}\n  ${msg}\n${"═".repeat(60)}`); }

async function getCollectionCount(ref) {
  const snap = await ref.select().get();
  return snap.size;
}

// ═══════════════════════════════════════════════════════════════
//  E. 統計基線快照
// ═══════════════════════════════════════════════════════════════
async function runBaseline() {
  header("E. Statistics Baseline Snapshot");
  info("Recording pre-migration statistics for later comparison...");

  const baseline = {
    timestamp: new Date().toISOString(),
    collections: {},
    sampleUsers: [],
  };

  // Collection counts
  for (const col of COLLECTIONS) {
    const count = await getCollectionCount(db.collection(col));
    baseline.collections[col] = count;
    info(`${col}: ${count} documents`);
  }

  // Sample user statistics (first 5 users with registrations)
  const regsSnap = await db.collection("registrations")
    .where("status", "==", "confirmed")
    .limit(50)
    .select("userId", "eventId")
    .get();

  const userIds = [...new Set(regsSnap.docs.map(d => d.data().userId).filter(Boolean))].slice(0, 5);

  for (const uid of userIds) {
    const [regCount, attCount, actCount] = await Promise.all([
      getCollectionCount(db.collection("registrations").where("userId", "==", uid)),
      getCollectionCount(db.collection("attendanceRecords").where("uid", "==", uid)),
      getCollectionCount(db.collection("activityRecords").where("uid", "==", uid)),
    ]);

    baseline.sampleUsers.push({
      uid,
      registrations: regCount,
      attendanceRecords: attCount,
      activityRecords: actCount,
    });

    info(`User ${uid.slice(0, 8)}...: regs=${regCount}, att=${attCount}, act=${actCount}`);
  }

  // Save to file
  const fs = require("fs");
  const outPath = path.resolve(__dirname, "migration-baseline.json");
  fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2), "utf-8");
  pass(`Baseline saved to ${outPath}`);
  info(`Total: ${Object.values(baseline.collections).reduce((a, b) => a + b, 0)} documents across 3 collections`);
}

// ═══════════════════════════════════════════════════════════════
//  F. Phase 1 雙寫一致性驗證
// ═══════════════════════════════════════════════════════════════
async function runPhase1() {
  header("F. Phase 1 — Dual-Write Consistency Check");
  info("Comparing root collection vs subcollection for recently written documents...");

  // Build event data.id → doc.id mapping
  const eventsSnap = await db.collection("events").select("id").get();
  const eventMap = new Map(); // data.id → doc.id
  eventsSnap.docs.forEach(d => {
    const dataId = d.data().id;
    if (dataId) eventMap.set(dataId, d.id);
  });
  info(`Loaded ${eventMap.size} events for ID mapping`);

  let totalChecked = 0;
  let totalMissing = 0;
  let totalMismatch = 0;

  for (const col of COLLECTIONS) {
    const uidField = col === "registrations" ? "userId" : "uid";

    // Get recent root documents (last 50)
    const rootSnap = await db.collection(col).limit(50).get();

    for (const rootDoc of rootSnap.docs) {
      const data = rootDoc.data();
      const eventId = data.eventId;
      if (!eventId) continue;

      const eventDocId = eventMap.get(eventId);
      if (!eventDocId) {
        warn(`${col}/${rootDoc.id}: eventId "${eventId}" has no matching event (orphan)`);
        continue;
      }

      // Check subcollection
      const subRef = db.collection("events").doc(eventDocId).collection(col).doc(rootDoc.id);
      const subDoc = await subRef.get();

      totalChecked++;

      if (!subDoc.exists) {
        totalMissing++;
        if (totalMissing <= 5) {
          fail(`${col}/${rootDoc.id} exists in root but NOT in subcollection events/${eventDocId}/${col}/`);
        }
        continue;
      }

      // Compare key fields (including UID field name presence check)
      const subData = subDoc.data();
      const fieldsToCompare = ["status", "eventId", uidField].filter(f => data[f] !== undefined);
      for (const field of fieldsToCompare) {
        if (String(data[field]) !== String(subData[field])) {
          totalMismatch++;
          if (totalMismatch <= 5) {
            fail(`${col}/${rootDoc.id}: field "${field}" differs — root="${data[field]}" vs sub="${subData[field]}"`);
          }
        }
      }

      // Verify UID field name exists (catch userId vs uid migration bugs)
      if (uidField && data[uidField] && !subData[uidField]) {
        totalMismatch++;
        if (totalMismatch <= 5) {
          fail(`${col}/${rootDoc.id}: uid field "${uidField}" exists in root but MISSING in subcollection`);
        }
      }
    }
  }

  // Reverse check: sample subcollection docs and verify root counterpart exists
  info("\nReverse check: subcollection → root...");
  let reverseChecked = 0;
  let reverseMissing = 0;
  const sampleEvents = [...eventMap.entries()].slice(0, 5);
  for (const [, eventDocId] of sampleEvents) {
    for (const col of COLLECTIONS) {
      const subSnap = await db.collection("events").doc(eventDocId).collection(col).limit(10).get();
      for (const subDoc of subSnap.docs) {
        reverseChecked++;
        const rootDoc = await db.collection(col).doc(subDoc.id).get();
        if (!rootDoc.exists) {
          reverseMissing++;
          if (reverseMissing <= 3) {
            warn(`${col}/${subDoc.id} exists in subcollection but NOT in root (orphan subcollection doc)`);
          }
        }
      }
    }
  }
  if (reverseMissing === 0 && reverseChecked > 0) pass(`Reverse check: ${reverseChecked} subcollection docs all have root counterparts`);
  else if (reverseMissing > 0) warn(`Reverse check: ${reverseMissing}/${reverseChecked} subcollection docs missing from root`);

  info(`\nForward check: ${totalChecked} documents`);
  if (totalMissing === 0) pass("All root documents have matching subcollection documents");
  else fail(`${totalMissing} documents missing from subcollections`);
  if (totalMismatch === 0) pass("All compared fields match between root and subcollection");
  else fail(`${totalMismatch} field mismatches detected`);
}

// ═══════════════════════════════════════════════════════════════
//  G. Phase 2 遷移完整性驗證
// ═══════════════════════════════════════════════════════════════
async function runPhase2() {
  header("G. Phase 2 — Migration Completeness Check");
  info("Verifying ALL root documents have been copied to subcollections...");

  const eventsSnap = await db.collection("events").select("id").get();
  const eventMap = new Map();
  eventsSnap.docs.forEach(d => {
    const dataId = d.data().id;
    if (dataId) eventMap.set(dataId, d.id);
  });

  for (const col of COLLECTIONS) {
    info(`\nChecking ${col}...`);

    const uidField = col === "registrations" ? "userId" : "uid";
    const rootSnap = await db.collection(col).get();
    let missing = 0;
    let orphan = 0;
    let matched = 0;
    let fieldMismatch = 0;

    for (const rootDoc of rootSnap.docs) {
      const rootData = rootDoc.data();
      const eventId = rootData.eventId;
      if (!eventId) { orphan++; continue; }

      const eventDocId = eventMap.get(eventId);
      if (!eventDocId) { orphan++; continue; }

      const subDoc = await db.collection("events").doc(eventDocId).collection(col).doc(rootDoc.id).get();
      if (!subDoc.exists) { missing++; continue; }

      matched++;

      // Field-level verification (catch migration script bugs)
      const subData = subDoc.data();
      const criticalFields = ["status", "eventId", uidField].filter(f => rootData[f] !== undefined);
      for (const f of criticalFields) {
        if (String(rootData[f]) !== String(subData[f])) {
          fieldMismatch++;
          if (fieldMismatch <= 3) {
            fail(`${col}/${rootDoc.id}: field "${f}" — root="${rootData[f]}" vs sub="${subData[f]}"`);
          }
        }
      }
    }

    info(`  Total: ${rootSnap.size} | Matched: ${matched} | Missing: ${missing} | Orphan: ${orphan} | Field mismatch: ${fieldMismatch}`);

    if (missing === 0) pass(`${col}: all non-orphan documents migrated`);
    else fail(`${col}: ${missing} documents NOT migrated`);
    if (fieldMismatch === 0 && matched > 0) pass(`${col}: all ${matched} matched documents have correct field values`);
    else if (fieldMismatch > 0) fail(`${col}: ${fieldMismatch} field mismatches in migrated data`);

    if (orphan > 0) warn(`${col}: ${orphan} orphan documents (eventId has no matching event)`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  H. Phase 3 讀取等價性 + 去重驗證
// ═══════════════════════════════════════════════════════════════
async function runPhase3() {
  header("H. Phase 3 — Read Equivalence + Dedup Verification");

  // Part 1: Per-event query equivalence
  info("Part 1: Comparing root query vs subcollection query for sample events...");

  const eventsSnap = await db.collection("events").select("id").limit(10).get();

  for (const eventDoc of eventsSnap.docs) {
    const eventId = eventDoc.data().id;
    if (!eventId) continue;

    for (const col of COLLECTIONS) {
      const rootSnap = await db.collection(col).where("eventId", "==", eventId).get();
      const subSnap = await db.collection("events").doc(eventDoc.id).collection(col).get();

      const rootCount = rootSnap.size;
      const subCount = subSnap.size;

      if (rootCount === subCount) {
        pass(`${col} for event ${eventId.slice(0, 15)}...: root=${rootCount} === sub=${subCount}`);
      } else {
        // sub >= root is OK (Phase 1 dual-write may have added extra)
        if (subCount >= rootCount) {
          warn(`${col} for event ${eventId.slice(0, 15)}...: sub(${subCount}) > root(${rootCount}) — likely from dual-write`);
        } else {
          fail(`${col} for event ${eventId.slice(0, 15)}...: sub(${subCount}) < root(${rootCount}) — MISSING DATA`);
        }
      }
    }
  }

  // Part 2: CollectionGroup dedup verification
  info("\nPart 2: CollectionGroup dedup verification...");

  for (const col of COLLECTIONS) {
    const cgSnap = await db.collectionGroup(col).limit(500).get();
    const allDocs = cgSnap.docs;

    const rootDocs = allDocs.filter(d => {
      // Root collection: path is "collectionName/docId" (2 segments)
      const segments = d.ref.path.split("/");
      return segments.length === 2;
    });

    const subDocs = allDocs.filter(d => {
      const segments = d.ref.path.split("/");
      return segments.length > 2;
    });

    info(`${col} collectionGroup: total=${allDocs.length}, root=${rootDocs.length}, subcollection=${subDocs.length}`);

    if (rootDocs.length > 0 && subDocs.length > 0) {
      // Check for duplicates: same docId in both root and subcollection
      const rootIds = new Set(rootDocs.map(d => d.id));
      const dupes = subDocs.filter(d => rootIds.has(d.id));

      if (dupes.length > 0) {
        warn(`${col}: ${dupes.length} documents exist in BOTH root and subcollection — dedup filter is REQUIRED`);
      } else {
        pass(`${col}: no duplicate docIds between root and subcollection`);
      }
    }

    // After Phase 4c (root deleted), root should be 0
    if (rootDocs.length === 0) {
      pass(`${col}: root collection is empty (Phase 4c completed)`);
    }
  }

  // Part 3: Compare with baseline if available
  info("\nPart 3: Comparing with pre-migration baseline...");
  const fs = require("fs");
  const baselinePath = path.resolve(__dirname, "migration-baseline.json");

  if (!fs.existsSync(baselinePath)) {
    warn("No baseline file found. Run 'node scripts/migration-verify.js baseline' before migration.");
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));

  for (const col of COLLECTIONS) {
    const currentCount = await getCollectionCount(db.collectionGroup(col));
    const baselineCount = baseline.collections[col] || 0;

    // After migration with dual-write, collectionGroup count ≈ 2x baseline (root + sub)
    // After Phase 4c, count ≈ 1x baseline (sub only)
    info(`${col}: baseline=${baselineCount}, collectionGroup now=${currentCount}`);

    if (currentCount < baselineCount) {
      fail(`${col}: current count (${currentCount}) LESS than baseline (${baselineCount}) — possible data loss!`);
    } else if (currentCount > baselineCount * 2.5) {
      fail(`${col}: current count (${currentCount}) is ${(currentCount / baselineCount).toFixed(1)}x baseline (${baselineCount}) — possible duplicate data! Expected ~1x (after Phase 4c) or ~2x (during dual-write)`);
    } else {
      pass(`${col}: count OK — current=${currentCount}, baseline=${baselineCount}, ratio=${(currentCount / baselineCount).toFixed(1)}x`);
    }
  }

  // Sample user statistics comparison
  for (const user of baseline.sampleUsers || []) {
    const uid = user.uid;
    // Use collectionGroup to count user's data across all subcollections
    const [regCount, attCount, actCount] = await Promise.all([
      getCollectionCount(db.collectionGroup("registrations").where("userId", "==", uid)),
      getCollectionCount(db.collectionGroup("attendanceRecords").where("uid", "==", uid)),
      getCollectionCount(db.collectionGroup("activityRecords").where("uid", "==", uid)),
    ]);

    // During dual-write: counts ≈ 2x. After Phase 4c: counts ≈ 1x
    // Key check: counts should NOT be less than baseline
    const checks = [
      { col: "registrations", baseline: user.registrations, current: regCount },
      { col: "attendanceRecords", baseline: user.attendanceRecords, current: attCount },
      { col: "activityRecords", baseline: user.activityRecords, current: actCount },
    ];

    for (const c of checks) {
      if (c.current < c.baseline) {
        fail(`User ${uid.slice(0, 8)}... ${c.col}: current(${c.current}) < baseline(${c.baseline})`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════════════
async function main() {
  const command = process.argv[2] || "help";

  if (command === "help") {
    console.log(`
Migration Verification Scripts
Usage: node scripts/migration-verify.js <command>

Commands:
  baseline    Record pre-migration statistics (run BEFORE Phase 1)
  phase1      Verify dual-write consistency (run AFTER Phase 1)
  phase2      Verify migration completeness (run AFTER Phase 2)
  phase3      Verify read equivalence + dedup (run AFTER Phase 3)
  all         Run phase1 + phase2 + phase3
`);
    return;
  }

  initFirebase();
  console.log(`\n🔍 Migration Verification — ${command.toUpperCase()}\n`);

  try {
    switch (command) {
      case "baseline": await runBaseline(); break;
      case "phase1": await runPhase1(); break;
      case "phase2": await runPhase2(); break;
      case "phase3": await runPhase3(); break;
      case "all":
        await runPhase1();
        await runPhase2();
        await runPhase3();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (err) {
    console.error("\n💥 Script error:", err.message);
    process.exit(1);
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ✅ ${passCount} passed | ❌ ${failCount} failed | ⚠️  ${warnCount} warnings`);
  console.log(`${"─".repeat(60)}\n`);

  if (failCount > 0) {
    console.log("❌ VERIFICATION FAILED — Do NOT proceed to next phase until all failures are resolved.");
    process.exit(1);
  } else {
    console.log("✅ VERIFICATION PASSED — Safe to proceed.");
    process.exit(0);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
