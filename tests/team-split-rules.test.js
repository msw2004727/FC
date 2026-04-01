/**
 * Team-Split: Firestore Rules — Registration Whitelist & teamKey Validation
 *
 * Tests the new/modified Firestore Rules defined in team-split-plan.md:
 *   - Step 0: isRegistrationOwnerSafeUpdate (whitelist + status constraint)
 *   - Step 2: isTeamKeyOnlyUpdate (value validation)
 *   - Step 2: isEventManagerTeamKeyUpdate (organizer/delegate only)
 *   - Step 2: isSelfSelectTeamKeyUpdate (owner + mode + lock check)
 *   - Step 2: isActiveRegistration (exclude cancelled)
 *   - Modified: isWaitlistPromotion (allow status + teamKey combined write)
 *   - Modified: isBadgeOnlyUpdate (owner-only, not any auth)
 *
 * ⚠️ These tests will FAIL until the corresponding Rules are deployed (Step 0 & Step 2).
 *    Run with: npm run test:rules
 *    Requires: Firebase Emulator (Firestore)
 *
 * Plan reference: docs/team-split-plan.md L383-455
 */

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  setDoc,
  updateDoc,
  setLogLevel,
  Timestamp,
} = require("firebase/firestore");

const PROJECT_ID = "demo-rules-test";
const RULES_PATH = path.resolve(__dirname, "..", "firestore.rules");

let testEnv;

// ─── Auth contexts ───
function guest() { return testEnv.unauthenticatedContext().firestore(); }
function authed(uid) { return testEnv.authenticatedContext(uid, { role: "user" }).firestore(); }
function adminDb() { return testEnv.authenticatedContext("uidAdmin", { admin: true, role: "admin" }).firestore(); }

async function seedDoc(collection, id, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collection, id), data);
  });
}

// ─── Seed data helpers ───
async function seedEvent(eventId, overrides = {}) {
  await seedDoc("events", eventId, {
    id: eventId,
    title: "Test Event",
    creatorUid: "uidOrganizer",
    delegateUids: ["uidDelegate"],
    max: 20,
    status: "open",
    startTimestamp: Timestamp.fromDate(new Date(2026, 5, 1)),
    teamSplit: {
      enabled: true,
      mode: "random",
      balanceCap: true,
      lockAt: null,
      teams: [
        { key: "A", color: "#EF4444", name: "Red" },
        { key: "B", color: "#3B82F6", name: "Blue" },
      ],
    },
    ...overrides,
  });
}

async function seedReg(regId, overrides = {}) {
  await seedDoc("registrations", regId, {
    id: regId,
    eventId: "evt1",
    userId: "uidPlayer",
    status: "confirmed",
    teamKey: null,
    ...overrides,
  });
}

// ─── Setup / Teardown ───
beforeAll(async () => {
  setLogLevel("error");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

// ═══════════════════════════════════════════════
// Step 0: isRegistrationOwnerSafeUpdate
// ═══════════════════════════════════════════════

describe("Step 0: Registration owner update whitelist", () => {

  describe("cancel registration (status + cancelledAt)", () => {
    test("owner can cancel own registration", async () => {
      await seedReg("reg1", { userId: "uidA", status: "confirmed" });
      await assertSucceeds(
        updateDoc(doc(authed("uidA"), "registrations", "reg1"), {
          status: "cancelled",
          cancelledAt: Timestamp.now(),
        })
      );
    });

    test("owner CANNOT set status to arbitrary value (e.g. 'hacked')", async () => {
      await seedReg("reg1", { userId: "uidA", status: "confirmed" });
      await assertFails(
        updateDoc(doc(authed("uidA"), "registrations", "reg1"), {
          status: "hacked",
        })
      );
    });

    test("owner CANNOT set cancelled registration back to confirmed", async () => {
      await seedReg("reg1", { userId: "uidA", status: "cancelled" });
      await assertFails(
        updateDoc(doc(authed("uidA"), "registrations", "reg1"), {
          status: "confirmed",
        })
      );
    });

    test("owner CANNOT change userId", async () => {
      await seedReg("reg1", { userId: "uidA", status: "confirmed" });
      await assertFails(
        updateDoc(doc(authed("uidA"), "registrations", "reg1"), {
          userId: "uidHacker",
        })
      );
    });

    test("owner CANNOT change registeredAt", async () => {
      await seedReg("reg1", { userId: "uidA", status: "confirmed" });
      await assertFails(
        updateDoc(doc(authed("uidA"), "registrations", "reg1"), {
          registeredAt: Timestamp.now(),
        })
      );
    });

    test("owner CANNOT change eventId", async () => {
      await seedReg("reg1", { userId: "uidA", status: "confirmed" });
      await assertFails(
        updateDoc(doc(authed("uidA"), "registrations", "reg1"), {
          eventId: "evt_other",
        })
      );
    });
  });

  describe("badge update (displayBadges)", () => {
    test("owner can update own displayBadges", async () => {
      await seedReg("reg1", { userId: "uidA" });
      await assertSucceeds(
        updateDoc(doc(authed("uidA"), "registrations", "reg1"), {
          displayBadges: [{ id: "b1", name: "Badge", image: "url" }],
        })
      );
    });

    test("non-owner CANNOT update others displayBadges", async () => {
      await seedReg("reg1", { userId: "uidA" });
      await assertFails(
        updateDoc(doc(authed("uidB"), "registrations", "reg1"), {
          displayBadges: [{ id: "fake", name: "Fake", image: "url" }],
        })
      );
    });

    test("admin CAN update anyone displayBadges", async () => {
      await seedReg("reg1", { userId: "uidA" });
      await assertSucceeds(
        updateDoc(doc(adminDb(), "registrations", "reg1"), {
          displayBadges: [{ id: "b1", name: "Badge", image: "url" }],
        })
      );
    });
  });

  describe("waitlist promotion", () => {
    test("any auth user can promote waitlisted to confirmed (status only)", async () => {
      await seedReg("reg1", { userId: "uidA", status: "waitlisted" });
      await assertSucceeds(
        updateDoc(doc(authed("uidB"), "registrations", "reg1"), {
          status: "confirmed",
        })
      );
    });

    test("promotion with teamKey (combined write) succeeds", async () => {
      await seedReg("reg1", { userId: "uidA", status: "waitlisted" });
      await assertSucceeds(
        updateDoc(doc(authed("uidB"), "registrations", "reg1"), {
          status: "confirmed",
          teamKey: "A",
        })
      );
    });

    test("promotion with invalid teamKey rejected", async () => {
      await seedReg("reg1", { userId: "uidA", status: "waitlisted" });
      await assertFails(
        updateDoc(doc(authed("uidB"), "registrations", "reg1"), {
          status: "confirmed",
          teamKey: "HACKED",
        })
      );
    });

    test("cannot promote confirmed to confirmed", async () => {
      await seedReg("reg1", { userId: "uidA", status: "confirmed" });
      await assertFails(
        updateDoc(doc(authed("uidB"), "registrations", "reg1"), {
          status: "confirmed",
        })
      );
    });
  });
});

// ═══════════════════════════════════════════════
// Step 2: teamKey write rules
// ═══════════════════════════════════════════════

describe("Step 2: teamKey write validation", () => {

  describe("isTeamKeyOnlyUpdate — value validation", () => {
    test("organizer can set teamKey to valid value A", async () => {
      await seedEvent("evt1", { creatorUid: "uidOrganizer" });
      await seedReg("reg1", { eventId: "evt1", userId: "uidPlayer" });
      await assertSucceeds(
        updateDoc(doc(authed("uidOrganizer"), "registrations", "reg1"), {
          teamKey: "A",
        })
      );
    });

    test("organizer can set teamKey to null (unassign)", async () => {
      await seedEvent("evt1");
      await seedReg("reg1", { eventId: "evt1", teamKey: "A" });
      await assertSucceeds(
        updateDoc(doc(authed("uidOrganizer"), "registrations", "reg1"), {
          teamKey: null,
        })
      );
    });

    test("organizer CANNOT set teamKey to invalid value", async () => {
      await seedEvent("evt1");
      await seedReg("reg1", { eventId: "evt1" });
      await assertFails(
        updateDoc(doc(authed("uidOrganizer"), "registrations", "reg1"), {
          teamKey: "HACKED",
        })
      );
    });

    test("organizer CANNOT set teamKey to 'E' (max 4 teams)", async () => {
      await seedEvent("evt1");
      await seedReg("reg1", { eventId: "evt1" });
      await assertFails(
        updateDoc(doc(authed("uidOrganizer"), "registrations", "reg1"), {
          teamKey: "E",
        })
      );
    });

    test("organizer CANNOT set teamKey to number", async () => {
      await seedEvent("evt1");
      await seedReg("reg1", { eventId: "evt1" });
      await assertFails(
        updateDoc(doc(authed("uidOrganizer"), "registrations", "reg1"), {
          teamKey: 1,
        })
      );
    });
  });

  describe("isEventManagerTeamKeyUpdate — permission check", () => {
    test("delegate can assign teamKey", async () => {
      await seedEvent("evt1", { delegateUids: ["uidDelegate"] });
      await seedReg("reg1", { eventId: "evt1" });
      await assertSucceeds(
        updateDoc(doc(authed("uidDelegate"), "registrations", "reg1"), {
          teamKey: "B",
        })
      );
    });

    test("random user CANNOT assign teamKey on others registration", async () => {
      await seedEvent("evt1");
      await seedReg("reg1", { eventId: "evt1", userId: "uidPlayer" });
      await assertFails(
        updateDoc(doc(authed("uidRandom"), "registrations", "reg1"), {
          teamKey: "A",
        })
      );
    });

    test("organizer CANNOT change status via teamKey path", async () => {
      await seedEvent("evt1");
      await seedReg("reg1", { eventId: "evt1" });
      await assertFails(
        updateDoc(doc(authed("uidOrganizer"), "registrations", "reg1"), {
          teamKey: "A",
          status: "cancelled",
        })
      );
    });
  });

  describe("isActiveRegistration — exclude cancelled", () => {
    test("CANNOT assign teamKey to cancelled registration", async () => {
      await seedEvent("evt1");
      await seedReg("reg1", { eventId: "evt1", status: "cancelled" });
      await assertFails(
        updateDoc(doc(authed("uidOrganizer"), "registrations", "reg1"), {
          teamKey: "A",
        })
      );
    });

    test("CAN assign teamKey to waitlisted registration", async () => {
      await seedEvent("evt1");
      await seedReg("reg1", { eventId: "evt1", status: "waitlisted" });
      await assertSucceeds(
        updateDoc(doc(authed("uidOrganizer"), "registrations", "reg1"), {
          teamKey: "A",
        })
      );
    });
  });

  describe("isSelfSelectTeamKeyUpdate — user self-select", () => {
    test("owner can select own team in self-select mode", async () => {
      await seedEvent("evt1", {
        teamSplit: {
          enabled: true,
          mode: "self-select",
          lockAt: Timestamp.fromDate(new Date(2099, 0, 1)), // far future
          teams: [
            { key: "A", color: "#EF4444", name: "Red" },
            { key: "B", color: "#3B82F6", name: "Blue" },
          ],
        },
        startTimestamp: Timestamp.fromDate(new Date(2099, 0, 2)),
      });
      await seedReg("reg1", { eventId: "evt1", userId: "uidPlayer" });
      await assertSucceeds(
        updateDoc(doc(authed("uidPlayer"), "registrations", "reg1"), {
          teamKey: "B",
        })
      );
    });

    test("owner CANNOT select team in random mode", async () => {
      await seedEvent("evt1", {
        teamSplit: { enabled: true, mode: "random", lockAt: null,
          teams: [{ key: "A", color: "#EF4444", name: "Red" }, { key: "B", color: "#3B82F6", name: "Blue" }] },
        startTimestamp: Timestamp.fromDate(new Date(2099, 0, 2)),
      });
      await seedReg("reg1", { eventId: "evt1", userId: "uidPlayer" });
      await assertFails(
        updateDoc(doc(authed("uidPlayer"), "registrations", "reg1"), {
          teamKey: "A",
        })
      );
    });

    test("owner CANNOT select team after lock time", async () => {
      await seedEvent("evt1", {
        teamSplit: {
          enabled: true,
          mode: "self-select",
          lockAt: Timestamp.fromDate(new Date(2020, 0, 1)), // past
          teams: [{ key: "A", color: "#EF4444", name: "Red" }, { key: "B", color: "#3B82F6", name: "Blue" }],
        },
        startTimestamp: Timestamp.fromDate(new Date(2099, 0, 2)),
      });
      await seedReg("reg1", { eventId: "evt1", userId: "uidPlayer" });
      await assertFails(
        updateDoc(doc(authed("uidPlayer"), "registrations", "reg1"), {
          teamKey: "A",
        })
      );
    });

    test("owner CANNOT select invalid teamKey in self-select", async () => {
      await seedEvent("evt1", {
        teamSplit: {
          enabled: true,
          mode: "self-select",
          lockAt: Timestamp.fromDate(new Date(2099, 0, 1)),
          teams: [{ key: "A", color: "#EF4444", name: "Red" }, { key: "B", color: "#3B82F6", name: "Blue" }],
        },
        startTimestamp: Timestamp.fromDate(new Date(2099, 0, 2)),
      });
      await seedReg("reg1", { eventId: "evt1", userId: "uidPlayer" });
      await assertFails(
        updateDoc(doc(authed("uidPlayer"), "registrations", "reg1"), {
          teamKey: "HACKED",
        })
      );
    });
  });
});
