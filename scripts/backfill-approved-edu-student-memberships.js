#!/usr/bin/env node
"use strict";

/**
 * Backfill approved education students into club membership.
 *
 * Default mode is dry-run. Use --apply to write.
 *
 * The production approval flow treats an approved self student as a team
 * member by adding the student's user record to teamIds/teamNames. Parent-only
 * student records are intentionally skipped; a parent account is not the
 * player/member.
 */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const DEFAULT_PROJECT_ID = readDefaultProjectId();

function readDefaultProjectId() {
  try {
    const rc = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, ".firebaserc"), "utf8"));
    return rc && rc.projects && rc.projects.default ? String(rc.projects.default) : null;
  } catch (_) {
    return null;
  }
}

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: true,
    projectId: DEFAULT_PROJECT_ID,
    teamId: "",
    maxUpdates: 1000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
      args.dryRun = false;
    } else if (arg === "--dry-run") {
      args.apply = false;
      args.dryRun = true;
    } else if (arg === "--project") {
      args.projectId = argv[++i] || "";
    } else if (arg === "--team") {
      args.teamId = argv[++i] || "";
    } else if (arg === "--max-updates") {
      args.maxUpdates = Number(argv[++i] || "");
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.projectId = cleanString(args.projectId);
  args.teamId = cleanString(args.teamId);
  if (!args.projectId) throw new Error("Missing Firebase project id. Use --project <projectId>.");
  if (!Number.isFinite(args.maxUpdates) || args.maxUpdates < 1) {
    throw new Error("--max-updates must be a positive number.");
  }
  return args;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/backfill-approved-edu-student-memberships.js [--dry-run]
  node scripts/backfill-approved-edu-student-memberships.js --apply

Options:
  --project <id>       Firebase project id. Defaults to .firebaserc default.
  --team <teamId>      Limit scan/apply to one team id.
  --max-updates <n>    Abort apply when planned writes exceed n. Default: 1000.

Rules:
  - Only active students are eligible.
  - Only students with selfUid are eligible.
  - Parent-only records are skipped.
  - User matching is by users/{uid}, user.uid, user.lineUserId, or user.id.
  - Ambiguous or missing user matches are skipped and reported.
`);
}

function loadFirebaseAdmin() {
  try {
    return require(path.join(ROOT_DIR, "functions", "node_modules", "firebase-admin"));
  } catch (_) {
    try {
      return require("firebase-admin");
    } catch (err) {
      throw new Error("firebase-admin not found. Run npm install in functions/ or root before using this script.");
    }
  }
}

function initFirebase(projectId) {
  const admin = loadFirebaseAdmin();
  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }
  return { admin, db: admin.firestore() };
}

function cleanString(value) {
  return String(value == null ? "" : value).trim();
}

function lower(value) {
  return cleanString(value).toLowerCase();
}


function normalizeMembership(user) {
  const ids = [];
  const names = [];
  const seen = new Set();
  const pushMember = (id, name) => {
    const text = cleanString(id);
    if (!text || seen.has(text)) return;
    seen.add(text);
    ids.push(text);
    names.push(cleanString(name));
  };

  if (Array.isArray(user && user.teamIds)) {
    user.teamIds.forEach((id, index) => {
      const name = Array.isArray(user.teamNames) ? user.teamNames[index] : "";
      pushMember(id, name);
    });
  }
  pushMember(user && user.teamId, user && user.teamName);
  return { ids, names };
}

function buildMembershipUpdates(user, teamId, teamName) {
  const membership = normalizeMembership(user);
  if (membership.ids.includes(teamId)) {
    return { alreadyMember: true, membership };
  }

  membership.ids.push(teamId);
  membership.names.push(teamName || teamId);
  return {
    alreadyMember: false,
    membership,
    updates: {
      teamId: membership.ids[0] || null,
      teamName: membership.names[0] || "",
      teamIds: membership.ids,
      teamNames: membership.names,
    },
  };
}

function addIndexEntry(index, key, entry, matchedBy) {
  const safeKey = cleanString(key);
  if (!safeKey) return;
  if (!index.has(safeKey)) index.set(safeKey, new Map());
  const byPath = index.get(safeKey);
  if (!byPath.has(entry.path)) {
    byPath.set(entry.path, { ...entry, matchedBy: new Set() });
  }
  byPath.get(entry.path).matchedBy.add(matchedBy);
}

function buildUserIndex(userDocs) {
  const index = new Map();
  userDocs.forEach((doc) => {
    const data = doc.data() || {};
    const entry = {
      path: doc.ref.path,
      ref: doc.ref,
      docId: doc.id,
      data,
    };
    addIndexEntry(index, doc.id, entry, "doc-id");
    addIndexEntry(index, data.uid, entry, "uid");
    addIndexEntry(index, data.lineUserId, entry, "lineUserId");
    addIndexEntry(index, data.id, entry, "id");
  });
  return index;
}

function findUsersByIdentity(userIndex, uid) {
  const matches = Array.from(userIndex.get(cleanString(uid))?.values() || []);
  return matches.map((match) => ({
    ...match,
    matchedBy: Array.from(match.matchedBy || []),
  }));
}

function serializableUserFields(user) {
  return {
    uid: user.uid || null,
    lineUserId: user.lineUserId || null,
    displayName: user.displayName || null,
    name: user.name || null,
    teamId: user.teamId || null,
    teamName: user.teamName || null,
    teamIds: Array.isArray(user.teamIds) ? user.teamIds : null,
    teamNames: Array.isArray(user.teamNames) ? user.teamNames : null,
  };
}

function createEmptyReport(args) {
  return {
    script: path.basename(__filename),
    mode: args.apply ? "apply" : "dry-run",
    projectId: args.projectId,
    teamFilter: args.teamId || null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    totals: {
      teamsScanned: 0,
      usersScanned: 0,
      studentDocsScanned: 0,
      activeStudents: 0,
      plannedUpdates: 0,
      plannedStudentLinks: 0,
      appliedUpdates: 0,
      alreadyMembers: 0,
      coveredByPlannedUpdate: 0,
      skippedNonActive: 0,
      skippedNoSelfUid: 0,
      skippedMissingUser: 0,
      skippedAmbiguousUser: 0,
      verifyFailures: 0,
    },
    statusCounts: {},
    planned: [],
    skipped: [],
    verification: [],
  };
}

function addSkip(report, reason, info) {
  if (reason === "non-active") report.totals.skippedNonActive += 1;
  if (reason === "no-self-uid") report.totals.skippedNoSelfUid += 1;
  if (reason === "missing-user") report.totals.skippedMissingUser += 1;
  if (reason === "ambiguous-user") report.totals.skippedAmbiguousUser += 1;
  report.skipped.push({ reason, ...info });
}

async function planBackfill(db, args, report) {
  const [usersSnap, teamsSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("teams").get(),
  ]);
  report.totals.usersScanned = usersSnap.size;
  const userIndex = buildUserIndex(usersSnap.docs);
  const plannedByUserPath = new Map();

  for (const teamDoc of teamsSnap.docs) {
    const teamData = teamDoc.data() || {};
    const teamId = cleanString(teamData.id || teamDoc.id);
    const teamName = cleanString(teamData.name || teamData.teamName || teamId);
    if (!teamId) continue;
    if (args.teamId && args.teamId !== teamId && args.teamId !== teamDoc.id) continue;

    report.totals.teamsScanned += 1;
    const studentsSnap = await teamDoc.ref.collection("students").get();
    for (const studentDoc of studentsSnap.docs) {
      const student = studentDoc.data() || {};
      const studentId = cleanString(student.id || studentDoc.id);
      const studentName = cleanString(student.name || student.studentName || student.displayName);
      const status = lower(student.enrollStatus || student.status || student.approvalStatus);
      const selfUid = cleanString(student.selfUid || student.uid);
      const parentUid = cleanString(student.parentUid);
      report.totals.studentDocsScanned += 1;
      report.statusCounts[status || "(blank)"] = (report.statusCounts[status || "(blank)"] || 0) + 1;

      const baseInfo = {
        teamId,
        teamDocId: teamDoc.id,
        teamName,
        studentId,
        studentDocId: studentDoc.id,
        studentName,
        status: status || null,
        selfUid: selfUid || null,
        parentUid: parentUid || null,
      };

      if (status !== "active") {
        addSkip(report, "non-active", baseInfo);
        continue;
      }
      report.totals.activeStudents += 1;

      if (!selfUid) {
        addSkip(report, "no-self-uid", baseInfo);
        continue;
      }

      const matchedUsers = findUsersByIdentity(userIndex, selfUid);
      if (matchedUsers.length === 0) {
        addSkip(report, "missing-user", baseInfo);
        continue;
      }
      if (matchedUsers.length > 1) {
        addSkip(report, "ambiguous-user", {
          ...baseInfo,
          matchedUserDocs: matchedUsers.map((user) => ({
            docId: user.docId,
            path: user.path,
            matchedBy: user.matchedBy,
            user: serializableUserFields(user.data),
          })),
        });
        continue;
      }

      const user = matchedUsers[0];
      const existingPlan = plannedByUserPath.get(user.path);
      const sourceUser = existingPlan
        ? { ...user.data, ...existingPlan.updates }
        : user.data;
      const membership = buildMembershipUpdates(sourceUser, teamId, teamName);
      if (membership.alreadyMember) {
        if (existingPlan && existingPlan.teamIdsToAdd.includes(teamId)) {
          report.totals.coveredByPlannedUpdate += 1;
          existingPlan.students.push({ ...baseInfo, coveredByExistingPlannedUpdate: true });
        } else {
          report.totals.alreadyMembers += 1;
        }
        continue;
      }

      if (existingPlan) {
        existingPlan.teamIdsToAdd.push(teamId);
        existingPlan.students.push(baseInfo);
        existingPlan.updates = membership.updates;
      } else {
        plannedByUserPath.set(user.path, {
          userDocId: user.docId,
          userPath: user.path,
          matchedBy: user.matchedBy,
          beforeUser: serializableUserFields(user.data),
          teamIdsToAdd: [teamId],
          students: [baseInfo],
          updates: membership.updates,
        });
      }
    }
  }

  report.planned = Array.from(plannedByUserPath.values());
  report.totals.plannedUpdates = report.planned.length;
  report.totals.plannedStudentLinks = report.planned.reduce((sum, item) => sum + item.students.length, 0);
}

async function applyBackfill(admin, db, report, args) {
  if (report.planned.length > args.maxUpdates) {
    throw new Error(`Planned updates (${report.planned.length}) exceed --max-updates (${args.maxUpdates}).`);
  }
  if (!report.planned.length) return;

  const byPath = new Map(report.planned.map((item) => [item.userPath, item]));
  let batch = db.batch();
  let opCount = 0;
  let total = 0;

  for (const item of report.planned) {
    const ref = db.doc(item.userPath);
    batch.update(ref, {
      ...item.updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    opCount += 1;
    total += 1;
    if (opCount >= 400) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }
  if (opCount > 0) await batch.commit();
  report.totals.appliedUpdates = total;

  for (const [userPath, item] of byPath.entries()) {
    const snap = await db.doc(userPath).get();
    const data = snap.data() || {};
    const after = normalizeMembership(data);
    const expectedTeamIds = Array.isArray(item.teamIdsToAdd) ? item.teamIdsToAdd : [];
    const missingTeamIds = expectedTeamIds.filter((teamId) => !after.ids.includes(teamId));
    const ok = missingTeamIds.length === 0;
    if (!ok) report.totals.verifyFailures += 1;
    report.verification.push({
      userPath,
      expectedTeamIds,
      missingTeamIds,
      ok,
      afterTeamIds: after.ids,
    });
  }
}

function writeReport(report) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  report.completedAt = new Date().toISOString();
  const stamp = report.completedAt.replace(/[-:.]/g, "").replace("T", "-").slice(0, 15);
  const name = `edu-student-membership-backfill-${report.mode}-${stamp}.json`;
  const outPath = path.join(OUTPUT_DIR, name);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  return outPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { admin, db } = initFirebase(args.projectId);
  const report = createEmptyReport(args);

  console.log(`Project: ${args.projectId}`);
  console.log(`Mode: ${report.mode}`);
  if (args.teamId) console.log(`Team filter: ${args.teamId}`);

  await planBackfill(db, args, report);

  console.log(`Teams scanned: ${report.totals.teamsScanned}`);
  console.log(`Users scanned: ${report.totals.usersScanned}`);
  console.log(`Student docs scanned: ${report.totals.studentDocsScanned}`);
  console.log(`Active students: ${report.totals.activeStudents}`);
  console.log(`Already members: ${report.totals.alreadyMembers}`);
  console.log(`Covered by planned update: ${report.totals.coveredByPlannedUpdate}`);
  console.log(`Planned user updates: ${report.totals.plannedUpdates}`);
  console.log(`Planned student links: ${report.totals.plannedStudentLinks}`);
  console.log(`Skipped no selfUid: ${report.totals.skippedNoSelfUid}`);
  console.log(`Skipped missing user: ${report.totals.skippedMissingUser}`);
  console.log(`Skipped ambiguous user: ${report.totals.skippedAmbiguousUser}`);

  if (args.apply) {
    await applyBackfill(admin, db, report, args);
    console.log(`Applied updates: ${report.totals.appliedUpdates}`);
    console.log(`Verify failures: ${report.totals.verifyFailures}`);
  } else {
    console.log("Dry-run only. Re-run with --apply to write changes.");
  }

  const outPath = writeReport(report);
  console.log(`Report: ${outPath}`);

  if (report.totals.verifyFailures > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("FATAL:", err && err.stack ? err.stack : err);
  process.exit(1);
});
