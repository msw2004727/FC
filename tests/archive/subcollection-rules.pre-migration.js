/**
 * Subcollection Security Rules — Pre-migration Validation (archived)
 *
 * Tests the PROPOSED subcollection + collectionGroup security rules
 * from the migration plan (Phase 0) BEFORE they are deployed.
 *
 * Methodology:
 *   1. Read the current firestore.rules
 *   2. Inject proposed subcollection rules into the document
 *   3. Load the combined rules into the Firestore Emulator
 *   4. Test subcollection CRUD permissions
 *   5. Test collectionGroup read permissions
 *
 * REQUIRES: Firestore Emulator running at FIRESTORE_EMULATOR_HOST (default 127.0.0.1:8080)
 * Skip: Tests are auto-skipped if emulator is not running.
 *
 * This file is intentionally archived with a non-.test.js suffix so Jest does
 * not treat it as active CI coverage. It injects proposed Phase 0 rules into
 * the current rules file and is no longer a reliable current-rules test.
 *
 * If the migration plan needs to be audited again, copy this into a temporary
 * scratch test and update it against the current firestore.rules first.
 */

const fs = require("fs");
const path = require("path");
const net = require("net");

const RULES_PATH = path.resolve(__dirname, "..", "..", "firestore.rules");
const PROJECT_ID = "demo-subcol-rules-test";
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

// ═══════════════════════════════════════════════════════════════
//  Proposed subcollection rules to inject (from migration plan Phase 0)
// ═══════════════════════════════════════════════════════════════
const SUBCOLLECTION_RULES = `
    // ═══════════════════════════════════════════════════════════════
    //  [Migration] Subcollection Rules — events/{eventId}/registrations etc.
    //  完整移植自根集合 rules（含 team-split 全部 5 函式）
    // ═══════════════════════════════════════════════════════════════
    match /events/{eventId}/registrations/{regId} {

      // ── 所有權檢查 ──
      function isSubRegOwner() {
        return request.auth != null
          && (resource.data.userId == request.auth.uid || resource.data.uid == request.auth.uid);
      }
      function isSubRegOwnerRequest() {
        return request.auth != null
          && (request.resource.data.userId == request.auth.uid || request.resource.data.uid == request.auth.uid);
      }

      // ── owner 安全更新（含 request.resource 防禦）──
      function isSubRegOwnerSafeUpdate() {
        let changed = request.resource.data.diff(resource.data).affectedKeys();
        return changed.hasOnly(['status', 'cancelledAt', 'updatedAt', 'displayBadges'])
          && isSubRegOwner()
          && isSubRegOwnerRequest()
          && (!changed.hasAny(['status']) || request.resource.data.status == 'cancelled');
      }

      // ── 候補遞補（含 teamKey 值驗證）──
      function isSubWaitlistPromotion() {
        let changed = request.resource.data.diff(resource.data).affectedKeys();
        let baseValid = resource.data.status == 'waitlisted'
          && request.resource.data.status == 'confirmed';
        return baseValid && (
          changed.hasOnly(['status'])
          || (changed.hasOnly(['status', 'teamKey'])
              && (request.resource.data.teamKey == null
                  || request.resource.data.teamKey in ['A', 'B', 'C', 'D']))
        );
      }

      // ── 徽章更新 ──
      function isSubBadgeOnlyUpdate() {
        return request.resource.data.diff(resource.data).affectedKeys().hasOnly(['displayBadges']);
      }

      // ── team-split Rules ──

      function isSubTeamKeyOnlyUpdate() {
        let changed = request.resource.data.diff(resource.data).affectedKeys();
        return changed.hasOnly(['teamKey', 'updatedAt'])
          && (request.resource.data.teamKey == null
              || request.resource.data.teamKey in ['A', 'B', 'C', 'D']);
      }

      function isSubActiveRegistration() {
        return resource.data.status in ['confirmed', 'waitlisted'];
      }

      // 子集合版：直接用 $(eventId)（父文件 doc.id），比根集合版更正確
      function getSubRegEventData() {
        return get(/databases/$(database)/documents/events/$(eventId)).data;
      }

      function isSubEventManagerTeamKeyUpdate() {
        let eventData = getSubRegEventData();
        return eventData != null
          && isAuth()
          && isSubTeamKeyOnlyUpdate()
          && (eventData.creatorUid == request.auth.uid
              || (eventData.delegateUids is list && request.auth.uid in eventData.delegateUids));
      }

      function isSubSelfSelectTeamKeyUpdate() {
        let eventData = getSubRegEventData();
        return eventData != null
          && isSubRegOwner()
          && isSubTeamKeyOnlyUpdate()
          && eventData.teamSplit is map
          && eventData.teamSplit.mode == 'self-select'
          && (eventData.teamSplit.lockAt == null || request.time < eventData.teamSplit.lockAt)
          && eventData.startTimestamp is timestamp
          && request.time < eventData.startTimestamp;
      }

      allow read: if isAuth();
      allow create: if isAdmin() || isSubRegOwnerRequest();
      allow update: if isAdmin()
        || (isSubRegOwner() && isSubRegOwnerRequest() && isSubRegOwnerSafeUpdate())
        || (isAuth() && isSubWaitlistPromotion())
        || (isSubRegOwner() && isSubBadgeOnlyUpdate())
        || (isSubActiveRegistration() && isSubEventManagerTeamKeyUpdate())
        || (isSubActiveRegistration() && isSubSelfSelectTeamKeyUpdate());
      allow delete: if isAdmin() || isSubRegOwner();
    }

    match /events/{eventId}/attendanceRecords/{recId} {
      function isSubAttendanceStatusUpdate() {
        let changed = request.resource.data.diff(resource.data).affectedKeys();
        return changed.hasOnly(['status', 'checkOutTime', 'removedAt', 'removedByUid', 'updatedAt']);
      }

      allow read: if isAuth();
      allow create: if isAuth();
      allow update: if isAuth() && (isAdmin() || isSubAttendanceStatusUpdate());
      allow delete: if false;
    }

    match /events/{eventId}/activityRecords/{recId} {
      function isSubActivityStatusOnly() {
        let changed = request.resource.data.diff(resource.data).affectedKeys();
        return changed.hasOnly(['status', 'updatedAt']);
      }

      allow read: if isAuth();
      allow create: if isAuth();
      allow update: if isAuth()
        && (isUserFieldOwnerResource() || isAdmin() || isSubActivityStatusOnly());
      allow delete: if isAdmin();
    }

    // collectionGroup wildcard rules（僅 read）
    match /{path=**}/registrations/{regId} {
      allow read: if request.auth != null;
    }
    match /{path=**}/attendanceRecords/{recId} {
      allow read: if request.auth != null;
    }
    match /{path=**}/activityRecords/{recId} {
      allow read: if request.auth != null;
    }
`;

/**
 * Build combined rules: current rules + injected subcollection rules
 */
function buildCombinedRules() {
  const current = fs.readFileSync(RULES_PATH, "utf-8");
  // Find the LAST closing brace pair (}} that closes the service block)
  // and inject subcollection rules before it
  const lastDoubleClose = current.lastIndexOf("  }");
  if (lastDoubleClose === -1) throw new Error("Cannot find injection point in firestore.rules");
  return (
    current.slice(0, lastDoubleClose) +
    SUBCOLLECTION_RULES +
    "\n" +
    current.slice(lastDoubleClose)
  );
}

// ═══════════════════════════════════════════════════════════════
//  Emulator availability check
// ═══════════════════════════════════════════════════════════════
async function isEmulatorRunning() {
  return new Promise((resolve) => {
    const socket = net.createConnection(
      { host: EMULATOR_HOST, port: Number(EMULATOR_PORT) },
      () => { socket.destroy(); resolve(true); }
    );
    socket.on("error", () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

// ═══════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════

let testEnv;
let emulatorAvailable = false;

beforeAll(async () => {
  emulatorAvailable = await isEmulatorRunning();
  if (!emulatorAvailable) return;

  const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
  const { setLogLevel } = require("firebase/firestore");
  setLogLevel("error");

  const combinedRules = buildCombinedRules();

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: combinedRules,
      host: EMULATOR_HOST,
      port: Number(EMULATOR_PORT),
    },
  });

  // Seed data
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc } = require("firebase/firestore");
    const db = ctx.firestore();

    // Users with roles
    await setDoc(doc(db, "users", "uidAdmin"), { uid: "uidAdmin", role: "admin" });
    await setDoc(doc(db, "users", "uidUser"), { uid: "uidUser", role: "user" });
    await setDoc(doc(db, "users", "uidOther"), { uid: "uidOther", role: "user" });

    // Parent event
    await setDoc(doc(db, "events", "evt1"), {
      id: "ce_111_abc",
      title: "Test Event",
      creatorUid: "uidUser",
      status: "open",
      max: 10,
    });

    // Subcollection registrations
    await setDoc(doc(db, "events", "evt1", "registrations", "reg1"), {
      userId: "uidUser",
      eventId: "ce_111_abc",
      status: "confirmed",
      registeredAt: new Date().toISOString(),
    });
    await setDoc(doc(db, "events", "evt1", "registrations", "reg2"), {
      userId: "uidOther",
      eventId: "ce_111_abc",
      status: "waitlisted",
      registeredAt: new Date().toISOString(),
    });

    // Subcollection attendanceRecords
    await setDoc(doc(db, "events", "evt1", "attendanceRecords", "att1"), {
      uid: "uidUser",
      eventId: "ce_111_abc",
      type: "checkin",
      status: "active",
      createdAt: new Date().toISOString(),
    });

    // Subcollection activityRecords
    await setDoc(doc(db, "events", "evt1", "activityRecords", "act1"), {
      uid: "uidUser",
      eventId: "ce_111_abc",
      status: "registered",
    });
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

/**
 * Guard for each test — skips with a clear message when emulator is down.
 * Using early-return pattern (Jest shows "passed" but with visible console skip).
 *
 * NOTE: We intentionally do NOT use describe.skip because `emulatorAvailable`
 * is set in beforeAll (async), which runs AFTER module-level describe() calls.
 * Using describe.skip at module level would ALWAYS skip. Instead, each test
 * checks the flag at runtime.
 */
function skipWithoutEmulator() {
  if (!emulatorAvailable) return true;
  return false;
}

function authedDb(uid, role) {
  if (role === "admin") {
    return testEnv.authenticatedContext(uid, { role: "admin" }).firestore();
  }
  return testEnv.authenticatedContext(uid).firestore();
}

function guestDb() {
  return testEnv.unauthenticatedContext().firestore();
}

// ─── Subcollection: registrations ───

describe("Subcollection registrations CRUD", () => {
  // Each test uses dedicated doc IDs to avoid state mutation conflicts
  // Runtime skip: emulatorAvailable is set in beforeAll (after module load),
  // so we check it at test execution time, not describe time.

  test("authenticated user can READ subcollection registration", async () => {
    if (!emulatorAvailable) return;
    const { doc, getDoc } = require("firebase/firestore");
    const { assertSucceeds } = require("@firebase/rules-unit-testing");
    await assertSucceeds(getDoc(doc(authedDb("uidUser", "user"), "events", "evt1", "registrations", "reg1")));
  });

  test("guest CANNOT read subcollection registration", async () => {
    if (!emulatorAvailable) return;
    const { doc, getDoc } = require("firebase/firestore");
    const { assertFails } = require("@firebase/rules-unit-testing");
    await assertFails(getDoc(doc(guestDb(), "events", "evt1", "registrations", "reg1")));
  });

  test("owner can cancel their own registration (status → cancelled)", async () => {
    if (!emulatorAvailable) return;
    const { doc, updateDoc, setDoc, serverTimestamp } = require("firebase/firestore");
    const { assertSucceeds } = require("@firebase/rules-unit-testing");
    // Seed a dedicated doc for this test to avoid state conflict
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "events", "evt1", "registrations", "reg_cancel_test"), {
        userId: "uidUser", eventId: "ce_111_abc", status: "confirmed",
      });
    });
    await assertSucceeds(
      updateDoc(doc(authedDb("uidUser", "user"), "events", "evt1", "registrations", "reg_cancel_test"), {
        status: "cancelled", cancelledAt: serverTimestamp(),
      })
    );
  });

  test("owner CANNOT set status to non-cancelled value (e.g. confirmed→open)", async () => {
    if (!emulatorAvailable) return;
    const { doc, updateDoc, setDoc } = require("firebase/firestore");
    const { assertFails } = require("@firebase/rules-unit-testing");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "events", "evt1", "registrations", "reg_bad_status"), {
        userId: "uidUser", eventId: "ce_111_abc", status: "confirmed",
      });
    });
    // Owner tries to set status to "open" — only "cancelled" is allowed
    await assertFails(
      updateDoc(doc(authedDb("uidUser", "user"), "events", "evt1", "registrations", "reg_bad_status"), {
        status: "open",
      })
    );
  });

  test("non-owner CANNOT cancel someone else's registration", async () => {
    if (!emulatorAvailable) return;
    const { doc, updateDoc } = require("firebase/firestore");
    const { assertFails } = require("@firebase/rules-unit-testing");
    await assertFails(
      updateDoc(doc(authedDb("uidOther", "user"), "events", "evt1", "registrations", "reg1"), {
        status: "cancelled",
      })
    );
  });

  test("non-admin CANNOT create registration for someone else", async () => {
    if (!emulatorAvailable) return;
    const { doc, setDoc } = require("firebase/firestore");
    const { assertFails } = require("@firebase/rules-unit-testing");
    await assertFails(
      setDoc(doc(authedDb("uidOther", "user"), "events", "evt1", "registrations", "reg_impersonate"), {
        userId: "uidUser", eventId: "ce_111_abc", status: "confirmed",
      })
    );
  });

  test("waitlist promotion: waitlisted → confirmed is allowed", async () => {
    if (!emulatorAvailable) return;
    const { doc, updateDoc, setDoc } = require("firebase/firestore");
    const { assertSucceeds } = require("@firebase/rules-unit-testing");
    // #3 fix: use dedicated doc to avoid mutating shared reg2
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "events", "evt1", "registrations", "reg_promo_test"), {
        userId: "uidOther", eventId: "ce_111_abc", status: "waitlisted",
        registeredAt: new Date().toISOString(),
      });
    });
    await assertSucceeds(
      updateDoc(doc(authedDb("uidUser", "user"), "events", "evt1", "registrations", "reg_promo_test"), {
        status: "confirmed",
      })
    );
  });

  test("admin can delete a registration", async () => {
    if (!emulatorAvailable) return;
    const { doc, deleteDoc, setDoc } = require("firebase/firestore");
    const { assertSucceeds } = require("@firebase/rules-unit-testing");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "events", "evt1", "registrations", "reg_del_test"), {
        userId: "uidUser", eventId: "ce_111_abc", status: "confirmed",
      });
    });
    await assertSucceeds(
      deleteDoc(doc(authedDb("uidAdmin", "admin"), "events", "evt1", "registrations", "reg_del_test"))
    );
  });

  test("owner can delete their own registration", async () => {
    if (!emulatorAvailable) return;
    const { doc, deleteDoc, setDoc } = require("firebase/firestore");
    const { assertSucceeds } = require("@firebase/rules-unit-testing");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "events", "evt1", "registrations", "reg_owner_del"), {
        userId: "uidUser", eventId: "ce_111_abc", status: "confirmed",
      });
    });
    await assertSucceeds(
      deleteDoc(doc(authedDb("uidUser", "user"), "events", "evt1", "registrations", "reg_owner_del"))
    );
  });

  test("non-owner non-admin CANNOT delete registration", async () => {
    if (!emulatorAvailable) return;
    const { doc, deleteDoc } = require("firebase/firestore");
    const { assertFails } = require("@firebase/rules-unit-testing");
    await assertFails(
      deleteDoc(doc(authedDb("uidOther", "user"), "events", "evt1", "registrations", "reg1"))
    );
  });

  test("owner can update displayBadges only", async () => {
    if (!emulatorAvailable) return;
    const { doc, updateDoc, setDoc } = require("firebase/firestore");
    const { assertSucceeds } = require("@firebase/rules-unit-testing");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "events", "evt1", "registrations", "reg_badge_test"), {
        userId: "uidUser", eventId: "ce_111_abc", status: "confirmed", displayBadges: [],
      });
    });
    await assertSucceeds(
      updateDoc(doc(authedDb("uidUser", "user"), "events", "evt1", "registrations", "reg_badge_test"), {
        displayBadges: ["badge1", "badge2"],
      })
    );
  });

  test("waitlist promotion with invalid teamKey is REJECTED", async () => {
    if (!emulatorAvailable) return;
    const { doc, updateDoc, setDoc } = require("firebase/firestore");
    const { assertFails } = require("@firebase/rules-unit-testing");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "events", "evt1", "registrations", "reg_bad_key"), {
        userId: "uidOther", eventId: "ce_111_abc", status: "waitlisted",
      });
    });
    await assertFails(
      updateDoc(doc(authedDb("uidUser", "user"), "events", "evt1", "registrations", "reg_bad_key"), {
        status: "confirmed", teamKey: "HACKER_TEAM",
      })
    );
  });

  test("waitlist promotion with valid teamKey A is allowed", async () => {
    if (!emulatorAvailable) return;
    const { doc, updateDoc, setDoc } = require("firebase/firestore");
    const { assertSucceeds } = require("@firebase/rules-unit-testing");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "events", "evt1", "registrations", "reg_valid_key"), {
        userId: "uidOther", eventId: "ce_111_abc", status: "waitlisted",
      });
    });
    await assertSucceeds(
      updateDoc(doc(authedDb("uidUser", "user"), "events", "evt1", "registrations", "reg_valid_key"), {
        status: "confirmed", teamKey: "A",
      })
    );
  });

  // ── team-split: event manager teamKey update ──
  // NOTE: These tests require the event doc to have creatorUid/delegateUids/teamSplit
  // and the registration to be active. Full team-split emulator tests require seeding
  // complex event data; basic structural validation is done above via teamKey enum check.
  // Comprehensive team-split integration tests will be added in Phase 0 implementation.
});

// ─── Subcollection: attendanceRecords ───

describe("Subcollection attendanceRecords CRUD", () => {
  test("authenticated user can READ", async () => {
    if (!emulatorAvailable) return;
    const { doc, getDoc } = require("firebase/firestore");
    const { assertSucceeds } = require("@firebase/rules-unit-testing");
    await assertSucceeds(getDoc(doc(authedDb("uidUser", "user"), "events", "evt1", "attendanceRecords", "att1")));
  });

  test("authenticated user can CREATE (checkin)", async () => {
    if (!emulatorAvailable) return;
    const { doc, setDoc } = require("firebase/firestore");
    const { assertSucceeds } = require("@firebase/rules-unit-testing");
    await assertSucceeds(
      setDoc(doc(authedDb("uidUser", "user"), "events", "evt1", "attendanceRecords", "att_create_test"), {
        uid: "uidUser", eventId: "ce_111_abc", type: "checkin", status: "active",
      })
    );
  });

  test("updating forbidden fields is rejected", async () => {
    if (!emulatorAvailable) return;
    const { doc, updateDoc } = require("firebase/firestore");
    const { assertFails } = require("@firebase/rules-unit-testing");
    await assertFails(
      updateDoc(doc(authedDb("uidUser", "user"), "events", "evt1", "attendanceRecords", "att1"), {
        uid: "uidHacker", eventId: "e_fake",
      })
    );
  });

  test("DELETE is ALWAYS forbidden (audit trail)", async () => {
    if (!emulatorAvailable) return;
    const { doc, deleteDoc } = require("firebase/firestore");
    const { assertFails } = require("@firebase/rules-unit-testing");
    await assertFails(deleteDoc(doc(authedDb("uidAdmin", "admin"), "events", "evt1", "attendanceRecords", "att1")));
  });
});

// ─── Subcollection: activityRecords ───

describe("Subcollection activityRecords CRUD", () => {
  test("authenticated user can READ and CREATE", async () => {
    if (!emulatorAvailable) return;
    const { doc, getDoc, setDoc } = require("firebase/firestore");
    const { assertSucceeds } = require("@firebase/rules-unit-testing");
    const db = authedDb("uidUser", "user");
    await assertSucceeds(getDoc(doc(db, "events", "evt1", "activityRecords", "act1")));
    await assertSucceeds(
      setDoc(doc(db, "events", "evt1", "activityRecords", "act_create_test"), {
        uid: "uidUser", eventId: "ce_111_abc", status: "registered",
      })
    );
  });

  test("admin can DELETE activityRecords", async () => {
    if (!emulatorAvailable) return;
    const { doc, deleteDoc, setDoc } = require("firebase/firestore");
    const { assertSucceeds } = require("@firebase/rules-unit-testing");
    // Seed a dedicated doc to delete
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "events", "evt1", "activityRecords", "act_del_test"), {
        uid: "uidUser", eventId: "ce_111_abc", status: "registered",
      });
    });
    await assertSucceeds(deleteDoc(doc(authedDb("uidAdmin", "admin"), "events", "evt1", "activityRecords", "act_del_test")));
  });

  test("non-admin non-owner CANNOT delete", async () => {
    if (!emulatorAvailable) return;
    const { doc, deleteDoc } = require("firebase/firestore");
    const { assertFails } = require("@firebase/rules-unit-testing");
    await assertFails(deleteDoc(doc(authedDb("uidOther", "user"), "events", "evt1", "activityRecords", "act1")));
  });
});

// ─── CollectionGroup wildcard rules ───

describe("CollectionGroup wildcard read rules", () => {
  test("combined rules file with subcollection rules is syntactically valid", () => {
    if (!emulatorAvailable) return;
    expect(testEnv).toBeDefined();
  });
});
