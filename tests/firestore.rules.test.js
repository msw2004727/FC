const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  setLogLevel,
  serverTimestamp,
} = require("firebase/firestore");

const PROJECT_ID = "demo-rules-test";
const RULES_PATH = path.resolve(__dirname, "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

let testEnv;

function guest() {
  return testEnv.unauthenticatedContext().firestore();
}

function memberA() {
  return testEnv.authenticatedContext("uidA").firestore();
}

function memberB() {
  return testEnv.authenticatedContext("uidB").firestore();
}

function admin() {
  return testEnv
    .authenticatedContext("uidAdmin", { admin: true, role: "admin" })
    .firestore();
}

function superAdmin() {
  return testEnv
    .authenticatedContext("uidSA", { super_admin: true, role: "super_admin" })
    .firestore();
}

function roleContext(uid, role, extraToken = {}) {
  return testEnv.authenticatedContext(uid, { role, ...extraToken }).firestore();
}

function user(uid = "uidUser") {
  return roleContext(uid, "user");
}

function coach(uid = "uidCoach") {
  return roleContext(uid, "coach");
}

function captain(uid = "uidCaptain") {
  return roleContext(uid, "captain");
}

function manager(uid = "uidManager") {
  return roleContext(uid, "manager");
}

function leader(uid = "uidLeader") {
  return roleContext(uid, "leader");
}

function venueOwner(uid = "uidVenue") {
  return roleContext(uid, "venue_owner");
}

const roleDb = {
  guest,
  memberA,
  memberB,
  admin,
  superAdmin,
};

const roles = ["guest", "memberA", "memberB", "admin", "superAdmin"];

const uidByRole = {
  memberA: "uidA",
  memberB: "uidB",
  admin: "uidAdmin",
  superAdmin: "uidSA",
};

const allowAll = {
  guest: true,
  memberA: true,
  memberB: true,
  admin: true,
  superAdmin: true,
};

const allowAuth = {
  guest: false,
  memberA: true,
  memberB: true,
  admin: true,
  superAdmin: true,
};

const allowAdminAndSuper = {
  guest: false,
  memberA: false,
  memberB: false,
  admin: true,
  superAdmin: true,
};

const allowSuperOnly = {
  guest: false,
  memberA: false,
  memberB: false,
  admin: false,
  superAdmin: true,
};

const denyAll = {
  guest: false,
  memberA: false,
  memberB: false,
  admin: false,
  superAdmin: false,
};

async function assertByRole(opFactory, expectedByRole) {
  for (const role of roles) {
    const db = roleDb[role]();
    const op = opFactory({ role, db });
    if (expectedByRole[role]) {
      await assertSucceeds(op);
    } else {
      await assertFails(op);
    }
  }
}

async function seedDoc(collection, id, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collection, id), data);
  });
}

async function seedPath(pathSegments, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...pathSegments), data);
  });
}

async function seedUserDoc(id, overrides = {}) {
  await seedDoc("users", id, {
    uid: id,
    displayName: `User ${id}`,
    role: "user",
    teamId: null,
    teamName: null,
    teamIds: [],
    teamNames: [],
    ...overrides,
  });
}

async function seedRolePermissions(roleKey, permissions = []) {
  await seedDoc("rolePermissions", roleKey, {
    permissions: [...permissions],
  });
}

async function seedBaseDocs() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, "users", "uidA"), {
      uid: "uidA",
      displayName: "Member A",
      role: "user",
    });
    await setDoc(doc(db, "users", "uidB"), {
      uid: "uidB",
      displayName: "Member B",
      role: "user",
    });
    await setDoc(doc(db, "users", "uidAdmin"), {
      uid: "uidAdmin",
      displayName: "Admin User",
      role: "admin",
    });
    await setDoc(doc(db, "users", "uidSA"), {
      uid: "uidSA",
      displayName: "Super Admin User",
      role: "super_admin",
    });
    await setDoc(doc(db, "users", "uidUser"), {
      uid: "uidUser",
      displayName: "General User",
      role: "user",
    });
    await setDoc(doc(db, "users", "uidCoach"), {
      uid: "uidCoach",
      displayName: "Coach User",
      role: "coach",
    });
    await setDoc(doc(db, "users", "uidCaptain"), {
      uid: "uidCaptain",
      displayName: "Captain User",
      role: "captain",
    });
    await setDoc(doc(db, "users", "uidManager"), {
      uid: "uidManager",
      displayName: "Manager User",
      role: "manager",
    });
    await setDoc(doc(db, "users", "uidLeader"), {
      uid: "uidLeader",
      displayName: "Leader User",
      role: "leader",
    });
    await setDoc(doc(db, "users", "uidVenue"), {
      uid: "uidVenue",
      displayName: "Venue Owner User",
      role: "venue_owner",
    });

    await setDoc(doc(db, "events", "eventA"), {
      id: "eventA",
      title: "Event A",
      creatorUid: "uidA",
      ownerUid: "uidA",
      captainUid: "uidA",
      status: "open",
    });
    await setDoc(doc(db, "events", "eventB"), {
      id: "eventB",
      title: "Event B",
      creatorUid: "uidB",
      ownerUid: "uidB",
      captainUid: "uidB",
      status: "open",
    });
    await setDoc(doc(db, "events", "eventCoachOwn"), {
      id: "eventCoachOwn",
      title: "Coach Event",
      creatorUid: "uidCoach",
      ownerUid: "uidCoach",
      captainUid: "uidCoach",
      status: "open",
    });
    await setDoc(doc(db, "events", "eventUserOwn"), {
      id: "eventUserOwn",
      title: "User Event",
      creatorUid: "uidUser",
      ownerUid: "uidUser",
      captainUid: "uidUser",
      status: "open",
    });

    await setDoc(doc(db, "registrations", "regA"), {
      id: "regA",
      eventId: "eventA",
      userId: "uidA",
      status: "confirmed",
    });
    await setDoc(doc(db, "registrations", "regB"), {
      id: "regB",
      eventId: "eventB",
      userId: "uidB",
      status: "confirmed",
    });
    await setDoc(doc(db, "registrations", "regUser"), {
      id: "regUser",
      eventId: "eventA",
      userId: "uidUser",
      status: "confirmed",
    });
    await setDoc(doc(db, "registrations", "regCoach"), {
      id: "regCoach",
      eventId: "eventA",
      userId: "uidCoach",
      status: "confirmed",
    });

    await setDoc(doc(db, "messages", "msgA"), {
      id: "msgA",
      fromUid: "uidA",
      toUid: "uidB",
      body: "hello from A",
    });
    await setDoc(doc(db, "messages", "msgB"), {
      id: "msgB",
      fromUid: "uidB",
      toUid: "uidA",
      body: "hello from B",
    });
    await setDoc(doc(db, "messages", "msgUserSent"), {
      id: "msgUserSent",
      fromUid: "uidUser",
      toUid: "uidCoach",
      body: "hello from user",
    });
    await setDoc(doc(db, "messages", "msgCoachToUser"), {
      id: "msgCoachToUser",
      fromUid: "uidCoach",
      toUid: "uidUser",
      body: "hello to user inbox",
    });

    await setDoc(doc(db, "linePushQueue", "queueA"), {
      uid: "uidA",
      title: "seed",
      body: "seed",
      status: "pending",
    });

    await setDoc(doc(db, "activityRecords", "actA"), {
      uid: "uidA",
      status: "registered",
      eventId: "eventA",
    });
    await setDoc(doc(db, "activityRecords", "actB"), {
      uid: "uidB",
      status: "registered",
      eventId: "eventB",
    });

    await setDoc(doc(db, "attendanceRecords", "attA"), {
      uid: "uidA",
      status: "checkin",
      eventId: "eventA",
    });
    await setDoc(doc(db, "attendanceRecords", "attB"), {
      uid: "uidB",
      status: "checkin",
      eventId: "eventB",
    });

    await setDoc(doc(db, "attendanceRecords", "att_existing"), {
      uid: "uidUser",
      status: "checkin",
      eventId: "eventA",
      type: "play",
      checkInTime: new Date(),
    });

    await setDoc(doc(db, "rolePermissions", "admin"), {
      permissions: ["event.edit_all", "team.manage_all"],
    });
    await setDoc(doc(db, "rolePermissions", "super_admin"), {
      permissions: ["event.edit_all", "team.manage_all", "admin.repair.no_show_adjust"],
    });

    await setDoc(doc(db, "expLogs", "expA"), { targetUid: "uidA", amount: 1 });
    await setDoc(doc(db, "expLogs", "expB"), { targetUid: "uidB", amount: 1 });

    await setDoc(doc(db, "teamExpLogs", "teamExpA"), { teamId: "teamA", amount: 1 });
    await setDoc(doc(db, "teamExpLogs", "teamExpB"), { teamId: "teamB", amount: 1 });

    await setDoc(doc(db, "operationLogs", "opA"), { actorUid: "uidA", action: "seed" });
    await setDoc(doc(db, "operationLogs", "opB"), { actorUid: "uidB", action: "seed" });

    await setDoc(doc(db, "errorLogs", "errA"), { message: "errorA" });
    await setDoc(doc(db, "errorLogs", "errB"), { message: "errorB" });

    await setDoc(doc(db, "auditLogsByDay", "20260309", "auditEntries", "auditA"), {
      actorUid: "uidA",
      action: "login_success",
      result: "success",
    });
    await setDoc(doc(db, "auditLogsByDay", "20260309", "auditEntries", "auditB"), {
      actorUid: "uidB",
      action: "event_signup",
      result: "success",
    });

    await setDoc(doc(db, "teams", "teamA"), {
      id: "teamA",
      name: "Team A",
      captainUid: "uidA",
      creatorUid: "uidA",
      ownerUid: "uidA",
    });
    await setDoc(doc(db, "teams", "teamB"), {
      id: "teamB",
      name: "Team B",
      captainUid: "uidB",
      creatorUid: "uidB",
      ownerUid: "uidB",
    });
    await setDoc(doc(db, "teams", "teamManagerOwn"), {
      id: "teamManagerOwn",
      name: "Manager Team",
      captainUid: "uidManager",
      creatorUid: "uidManager",
      ownerUid: "uidManager",
    });
    await setDoc(doc(db, "teams", "teamLeaderOwn"), {
      id: "teamLeaderOwn",
      name: "Leader Team",
      captainUid: "uidLeader",
      creatorUid: "uidLeader",
      ownerUid: "uidLeader",
    });
    await setDoc(doc(db, "teams", "teamUserOwn"), {
      id: "teamUserOwn",
      name: "User Team",
      captainUid: "uidUser",
      creatorUid: "uidUser",
      ownerUid: "uidUser",
    });

    await setDoc(doc(db, "shopItems", "itemA"), {
      id: "itemA",
      name: "Item A",
      sellerUid: "uidA",
      ownerUid: "uidA",
      creatorUid: "uidA",
      uid: "uidA",
      userId: "uidA",
    });
    await setDoc(doc(db, "shopItems", "itemB"), {
      id: "itemB",
      name: "Item B",
      sellerUid: "uidB",
      ownerUid: "uidB",
      creatorUid: "uidB",
      uid: "uidB",
      userId: "uidB",
    });

    await setDoc(doc(db, "trades", "tradeA"), {
      id: "tradeA",
      fromUid: "uidA",
      ownerUid: "uidA",
      sellerUid: "uidA",
      buyerUid: "uidA",
      creatorUid: "uidA",
      uid: "uidA",
      userId: "uidA",
      status: "open",
    });
    await setDoc(doc(db, "trades", "tradeB"), {
      id: "tradeB",
      fromUid: "uidB",
      ownerUid: "uidB",
      sellerUid: "uidB",
      buyerUid: "uidB",
      creatorUid: "uidB",
      uid: "uidB",
      userId: "uidB",
      status: "open",
    });
  });
}

beforeAll(async () => {
  setLogLevel("error");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: EMULATOR_HOST,
      port: Number(EMULATOR_PORT),
      rules: fs.readFileSync(RULES_PATH, "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedBaseDocs();
}, 30000);

afterAll(async () => {
  await testEnv.cleanup();
});

describe("/users/{userId}", () => {
  test("[SECURITY_HARDENED] own profile update requires server timestamp for updatedAt when provided", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        displayName: "General User Updated",
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        displayName: "General User Spoofed",
        updatedAt: new Date("2000-01-01T00:00:00.000Z"),
      })
    );
  });

  test("[SECURITY_HARDENED] lastLogin only allowed in login-shaped update", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        displayName: "General User Login",
        pictureUrl: "https://example.com/avatar.png",
        lastLogin: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        phone: "0912345678",
        updatedAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
      })
    );
  });

  test("[SECURITY_HARDENED] user cannot self-assign new team membership", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        teamId: "teamA",
        teamName: "Team A",
        teamIds: ["teamA"],
        teamNames: ["Team A"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("[SECURITY_HARDENED] user can clear all own team fields", async () => {
    await seedUserDoc("uidUser", {
      displayName: "General User",
      teamId: "teamA",
      teamName: "Team A",
      teamIds: ["teamA"],
      teamNames: ["Team A"],
    });

    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        teamId: null,
        teamName: null,
        teamIds: [],
        teamNames: [],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("[SECURITY_HARDENED] user can shrink own multi-team membership to subset", async () => {
    await seedUserDoc("uidUser", {
      displayName: "General User",
      teamId: "teamA",
      teamName: "Team A",
      teamIds: ["teamA", "teamB"],
      teamNames: ["Team A", "Team B"],
    });

    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        teamId: "teamB",
        teamName: "Team B",
        teamIds: ["teamB"],
        teamNames: ["Team B"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("[SECURITY_HARDENED] user cannot fake shrink to unrelated team or reorder same-size list", async () => {
    await seedUserDoc("uidUser", {
      displayName: "General User",
      teamId: "teamA",
      teamName: "Team A",
      teamIds: ["teamA", "teamB"],
      teamNames: ["Team A", "Team B"],
    });

    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        teamId: "teamX",
        teamName: "Team X",
        teamIds: ["teamX"],
        teamNames: ["Team X"],
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        teamId: "teamB",
        teamName: "Team B",
        teamIds: ["teamB", "teamA"],
        teamNames: ["Team B", "Team A"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("[SECURITY_HARDENED] coach/staff path still works with server timestamp but rejects spoofed timestamp", async () => {
    await assertSucceeds(
      updateDoc(doc(coach(), "users", "uidUser"), {
        teamId: "teamA",
        teamName: "Team A",
        teamIds: ["teamA"],
        teamNames: ["Team A"],
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(doc(coach(), "users", "uidUser"), {
        teamId: "teamB",
        teamName: "Team B",
        teamIds: ["teamB"],
        teamNames: ["Team B"],
        updatedAt: new Date("2000-01-01T00:00:00.000Z"),
      })
    );
  });

  test("[SECURITY_HARDENED] user cannot self-edit role/manualRole/claims/isAdmin", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        role: "admin",
        manualRole: "admin",
        claims: { role: "admin" },
        isAdmin: true,
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("[SECURITY_HARDENED] admin cannot raw update another user's profile or privilege fields", async () => {
    await assertFails(
      updateDoc(doc(admin(), "users", "uidUser"), {
        phone: "0912345678",
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(doc(admin(), "users", "uidUser"), {
        role: "coach",
        manualRole: "coach",
        claims: { role: "coach" },
        isAdmin: false,
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("[SECURITY_HARDENED] super_admin can directly update another user's profile and role", async () => {
    await assertSucceeds(
      updateDoc(doc(superAdmin(), "users", "uidUser"), {
        phone: "0912345678",
        role: "coach",
        manualRole: "coach",
        claims: { role: "coach" },
        isAdmin: false,
        updatedAt: serverTimestamp(),
      })
    );
  });
});

describe("/events/{eventId}", () => {
  test("read (current): guest/memberA/memberB/admin/superAdmin", async () => {
    await assertByRole(
      ({ db }) => getDoc(doc(db, "events", "eventA")),
      allowAll
    );
  });

  test("write-create (current): guest deny; authenticated allow", async () => {
    await assertByRole(
      ({ db, role }) =>
        setDoc(doc(db, "events", `event_create_${role}`), { title: "created" }),
      allowAuth
    );
  });

  test("[SECURITY_GAP] write-update (current): any authenticated user can update others' event", async () => {
    await assertByRole(
      ({ db }) => updateDoc(doc(db, "events", "eventB"), { status: "closed" }),
      allowAuth
    );
  });

  test("write-delete (current): only admin/superAdmin", async () => {
    // (recommended) Keep strict delete; optionally owner delete with strict predicates.
    await assertByRole(
      async ({ db, role }) => {
        const id = `event_del_${role}`;
        await seedDoc("events", id, { title: "tmp" });
        return deleteDoc(doc(db, "events", id));
      },
      allowAdminAndSuper
    );
  });

  test("delete uses users.role when token claim is stale user after promotion", async () => {
    await seedUserDoc("uidPromotedAdmin", {
      displayName: "Promoted Admin",
      role: "admin",
    });
    await seedDoc("events", "event_promoted_admin_delete", {
      title: "Promoted Admin Delete",
    });

    const promotedAdminDb = testEnv
      .authenticatedContext("uidPromotedAdmin", { role: "user" })
      .firestore();

    await assertSucceeds(
      deleteDoc(doc(promotedAdminDb, "events", "event_promoted_admin_delete"))
    );
  });

  test("delete rejects stale admin token after users.role was demoted", async () => {
    await seedUserDoc("uidDemotedUser", {
      displayName: "Demoted User",
      role: "user",
    });
    await seedDoc("events", "event_demoted_user_delete", {
      title: "Demoted User Delete",
    });

    const demotedUserDb = testEnv
      .authenticatedContext("uidDemotedUser", { role: "admin" })
      .firestore();

    await assertFails(
      deleteDoc(doc(demotedUserDb, "events", "event_demoted_user_delete"))
    );
  });
});

describe("/events/{eventId}/registrationLocks/{lockId}", () => {
  test("owner can create and delete own active registration lock", async () => {
    const lockId = "self_uidA";
    const ref = doc(memberA(), "events", "eventA", "registrationLocks", lockId);
    await assertSucceeds(
      setDoc(ref, {
        key: lockId,
        eventId: "eventA",
        userId: "uidA",
        participantType: "self",
        companionId: null,
        registrationDocId: "regA",
        status: "active",
      })
    );
    await assertSucceeds(deleteDoc(ref));
  });

  test("member cannot create another user's registration lock", async () => {
    await assertFails(
      setDoc(doc(memberA(), "events", "eventA", "registrationLocks", "self_uidB"), {
        key: "self_uidB",
        eventId: "eventA",
        userId: "uidB",
        participantType: "self",
        companionId: null,
        registrationDocId: "regB",
        status: "active",
      })
    );
  });

  test("admin can delete registration lock", async () => {
    await seedPath(["events", "eventA", "registrationLocks", "self_uidA_admin_delete"], {
      key: "self_uidA_admin_delete",
      eventId: "eventA",
      userId: "uidA",
      participantType: "self",
      registrationDocId: "regA",
      status: "active",
    });
    await assertSucceeds(deleteDoc(doc(admin(), "events", "eventA", "registrationLocks", "self_uidA_admin_delete")));
  });
});

describe("/registrations/{regId}", () => {
  test("read: any authenticated user can read registration", async () => {
    await assertByRole(
      ({ db }) => getDoc(doc(db, "registrations", "regB")),
      allowAuth
    );
  });

  test("[SECURITY_GAP_FIXED] create: member can create own registration but cannot spoof userId", async () => {
    await assertByRole(
      ({ db, role }) =>
        setDoc(doc(db, "registrations", `reg_create_${role}`), {
          eventId: "eventA",
          userId: uidByRole[role] || "uidA",
        }),
      allowAuth
    );
    await assertFails(
      setDoc(doc(memberA(), "registrations", "reg_spoof_by_A"), {
        eventId: "eventB",
        userId: "uidB",
      })
    );
    await assertSucceeds(
      setDoc(doc(memberA(), "registrations", "reg_self_by_A"), {
        eventId: "eventA",
        userId: "uidA",
      })
    );
  });

  test("[SECURITY_GAP_FIXED] update: member cannot update others' registration", async () => {
    await assertByRole(
      ({ db }) => updateDoc(doc(db, "registrations", "regB"), { status: "cancelled" }),
      {
        guest: false,
        memberA: false,
        memberB: true,
        admin: true,
        superAdmin: true,
      }
    );
    await assertFails(
      updateDoc(doc(memberB(), "registrations", "regA"), { status: "cancelled" })
    );
  });

  test("[SECURITY_GAP_FIXED] delete: member cannot delete others' registration", async () => {
    await assertFails(deleteDoc(doc(guest(), "registrations", "regB")));
    await assertFails(deleteDoc(doc(memberA(), "registrations", "regB")));
    await seedDoc("registrations", "regB", { eventId: "eventB", userId: "uidB", status: "confirmed" });
    await assertSucceeds(deleteDoc(doc(memberB(), "registrations", "regB")));
    await seedDoc("registrations", "regB", { eventId: "eventB", userId: "uidB", status: "confirmed" });
    await assertFails(deleteDoc(doc(memberB(), "registrations", "regA")));
    await seedDoc("registrations", "regA", { eventId: "eventA", userId: "uidA", status: "confirmed" });
    await assertSucceeds(deleteDoc(doc(admin(), "registrations", "regA")));
    await seedDoc("registrations", "regA", { eventId: "eventA", userId: "uidA", status: "confirmed" });
    await assertSucceeds(deleteDoc(doc(superAdmin(), "registrations", "regA")));
  });
});

describe("/messages/{msgId}", () => {
  test("[SECURITY_GAP_FIXED] read: only sender/recipient/admin can read message", async () => {
    await assertFails(getDoc(doc(guest(), "messages", "msgB")));
    await assertSucceeds(getDoc(doc(memberA(), "messages", "msgB")));
    await assertSucceeds(getDoc(doc(memberB(), "messages", "msgB")));
    await assertFails(getDoc(doc(user(), "messages", "msgB")));
    await assertSucceeds(getDoc(doc(admin(), "messages", "msgB")));
    await assertSucceeds(getDoc(doc(superAdmin(), "messages", "msgB")));
  });

  test("[SECURITY_GAP_FIXED] create: member can create own message but cannot spoof sender", async () => {
    await assertByRole(
      ({ db, role }) =>
        setDoc(doc(db, "messages", `msg_create_${role}`), {
          fromUid: uidByRole[role] || "uidA",
          toUid: "uidA",
          body: "x",
        }),
      allowAuth
    );
    await assertFails(
      setDoc(doc(memberA(), "messages", "msg_spoof_by_A"), {
        fromUid: "uidB",
        toUid: "uidA",
        body: "x",
      })
    );
    await assertSucceeds(
      setDoc(doc(memberA(), "messages", "msg_self_by_A"), {
        fromUid: "uidA",
        toUid: "uidB",
        body: "x",
      })
    );
  });

  test("[SECURITY_GAP_FIXED] update: participants can only update message metadata", async () => {
    await assertFails(updateDoc(doc(memberA(), "messages", "msgB"), { body: "updated by A" }));
    await assertFails(updateDoc(doc(memberB(), "messages", "msgB"), { body: "updated by B" }));
    await assertFails(updateDoc(doc(user(), "messages", "msgB"), { hiddenBy: ["uidUser"] }));
    await assertSucceeds(
      updateDoc(doc(memberA(), "messages", "msgB"), {
        unread: false,
        updatedAt: new Date(),
        readBy: ["uidA"],
      })
    );
    await assertSucceeds(
      updateDoc(doc(memberB(), "messages", "msgB"), {
        updatedAt: new Date(),
        hiddenBy: ["uidB"],
      })
    );
    await assertSucceeds(updateDoc(doc(admin(), "messages", "msgB"), { body: "updated by admin" }));
    await assertSucceeds(
      updateDoc(doc(superAdmin(), "messages", "msgB"), { body: "updated by super admin" })
    );
  });

  test("[SECURITY_GAP_FIXED] delete: member cannot delete others' message unless sender", async () => {
    await assertFails(deleteDoc(doc(guest(), "messages", "msgB")));
    await assertFails(deleteDoc(doc(memberA(), "messages", "msgB")));
    await seedDoc("messages", "msgB", { fromUid: "uidB", toUid: "uidA", body: "restored" });
    await assertSucceeds(deleteDoc(doc(memberB(), "messages", "msgB")));
    await seedDoc("messages", "msgB", { fromUid: "uidB", toUid: "uidA", body: "restored" });
    await assertFails(deleteDoc(doc(memberB(), "messages", "msgA")));
    await seedDoc("messages", "msgA", { fromUid: "uidA", toUid: "uidB", body: "restored" });
    await assertSucceeds(deleteDoc(doc(admin(), "messages", "msgA")));
    await seedDoc("messages", "msgA", { fromUid: "uidA", toUid: "uidB", body: "restored" });
    await assertSucceeds(deleteDoc(doc(superAdmin(), "messages", "msgA")));
  });
});

describe("/linePushQueue/{docId}", () => {
  test("read (current): denied for all roles", async () => {
    await assertByRole(
      ({ db }) => getDoc(doc(db, "linePushQueue", "queueA")),
      denyAll
    );
  });

  test("[SECURITY_GAP_FIXED] create: only admin/superAdmin can enqueue push", async () => {
    await assertByRole(
      ({ db, role }) =>
        setDoc(doc(db, "linePushQueue", `queue_create_${role}`), {
          uid: "uidB",
          title: `push by ${role}`,
          body: "payload",
          status: "pending",
        }),
      allowAdminAndSuper
    );
  });

  test("update (current): denied for all roles", async () => {
    await assertByRole(
      ({ db }) => updateDoc(doc(db, "linePushQueue", "queueA"), { status: "sent" }),
      denyAll
    );
  });

  test("delete (current): denied for all roles", async () => {
    await assertByRole(
      ({ db }) => deleteDoc(doc(db, "linePushQueue", "queueA")),
      denyAll
    );
  });
});

describe("logs/records high-risk matrix", () => {
  test("[SECURITY_GAP] /activityRecords: read/create/update are auth-wide; delete admin/super only", async () => {
    await assertByRole(({ db }) => getDoc(doc(db, "activityRecords", "actB")), allowAuth);
    await assertByRole(
      ({ db, role }) => setDoc(doc(db, "activityRecords", `act_create_${role}`), { uid: role }),
      allowAuth
    );
    await assertByRole(
      ({ db }) => updateDoc(doc(db, "activityRecords", "actB"), { status: "updated" }),
      allowAuth
    );
    await assertByRole(
      async ({ db, role }) => {
        const id = `act_del_${role}`;
        await seedDoc("activityRecords", id, { uid: "uidA", status: "seed" });
        return deleteDoc(doc(db, "activityRecords", id));
      },
      allowAdminAndSuper
    );
  });

  test("[SECURITY_GAP] /attendanceRecords: read/create/update are auth-wide; delete denied for all", async () => {
    await assertByRole(({ db }) => getDoc(doc(db, "attendanceRecords", "attB")), allowAuth);
    await assertByRole(
      ({ db, role }) => setDoc(doc(db, "attendanceRecords", `att_create_${role}`), { uid: role }),
      allowAuth
    );
    await assertByRole(
      ({ db }) => updateDoc(doc(db, "attendanceRecords", "attB"), { status: "updated" }),
      allowAuth
    );
    await assertByRole(
      async ({ db, role }) => {
        const id = `att_del_${role}`;
        await seedDoc("attendanceRecords", id, { uid: "uidA", status: "seed" });
        return deleteDoc(doc(db, "attendanceRecords", id));
      },
      denyAll
    );
  });

  test("[SECURITY_GAP] /expLogs: read/create are auth-wide; update/delete denied for all", async () => {
    await assertByRole(({ db }) => getDoc(doc(db, "expLogs", "expB")), allowAuth);
    await assertByRole(
      ({ db, role }) => setDoc(doc(db, "expLogs", `exp_create_${role}`), { actor: role }),
      allowAuth
    );
    await assertByRole(({ db }) => updateDoc(doc(db, "expLogs", "expB"), { amount: 99 }), denyAll);
    await assertByRole(
      async ({ db, role }) => {
        const id = `exp_del_${role}`;
        await seedDoc("expLogs", id, { amount: 1 });
        return deleteDoc(doc(db, "expLogs", id));
      },
      denyAll
    );
  });

  test("[SECURITY_GAP] /teamExpLogs: read/create are auth-wide; update/delete denied for all", async () => {
    await assertByRole(({ db }) => getDoc(doc(db, "teamExpLogs", "teamExpB")), allowAuth);
    await assertByRole(
      ({ db, role }) => setDoc(doc(db, "teamExpLogs", `team_exp_create_${role}`), { actor: role }),
      allowAuth
    );
    await assertByRole(
      ({ db }) => updateDoc(doc(db, "teamExpLogs", "teamExpB"), { amount: 99 }),
      denyAll
    );
    await assertByRole(
      async ({ db, role }) => {
        const id = `team_exp_del_${role}`;
        await seedDoc("teamExpLogs", id, { amount: 1 });
        return deleteDoc(doc(db, "teamExpLogs", id));
      },
      denyAll
    );
  });

  test("[SECURITY_GAP] /operationLogs: read/create are auth-wide; update/delete denied for all", async () => {
    const roleUidMap = { guest: '', memberA: 'uidA', memberB: 'uidB', admin: 'uidAdmin', superAdmin: 'uidSA' };
    await assertByRole(({ db }) => getDoc(doc(db, "operationLogs", "opB")), allowAuth);
    await assertByRole(
      ({ db, role }) => setDoc(doc(db, "operationLogs", `op_create_${role}`), { uid: roleUidMap[role] || role, action: "test" }),
      allowAuth
    );
    // opB.actorUid = "uidB" → memberB is owner → can update; admin/superAdmin always can
    await assertByRole(({ db }) => updateDoc(doc(db, "operationLogs", "opB"), { action: "x" }), {
      guest: false, memberA: false, memberB: true, admin: true, superAdmin: true,
    });
    await assertByRole(
      async ({ db, role }) => {
        const id = `op_del_${role}`;
        await seedDoc("operationLogs", id, { action: "seed" });
        return deleteDoc(doc(db, "operationLogs", id));
      },
      denyAll
    );
  });

  test("[SECURITY_GAP] /errorLogs: create is auth-wide; read/delete only superAdmin", async () => {
    await assertByRole(({ db }) => getDoc(doc(db, "errorLogs", "errA")), allowSuperOnly);
    await assertByRole(
      ({ db, role }) => setDoc(doc(db, "errorLogs", `err_create_${role}`), { actor: role }),
      allowAuth
    );
    await assertByRole(({ db }) => updateDoc(doc(db, "errorLogs", "errA"), { message: "u" }), denyAll);
    await assertByRole(
      async ({ db, role }) => {
        const id = `err_del_${role}`;
        await seedDoc("errorLogs", id, { message: "seed" });
        return deleteDoc(doc(db, "errorLogs", id));
      },
      allowSuperOnly
    );
  });

  test("[LOCKED_DOWN] /auditLogsByDay/{dayKey}/auditEntries: read only superAdmin; client writes denied", async () => {
    await assertByRole(
      ({ db }) => getDoc(doc(db, "auditLogsByDay", "20260309", "auditEntries", "auditB")),
      allowSuperOnly
    );
    await assertByRole(
      ({ db, role }) =>
        setDoc(doc(db, "auditLogsByDay", "20260309", "auditEntries", `audit_create_${role}`), {
          actorUid: uidByRole[role] || "uidA",
          action: "logout",
          result: "success",
        }),
      denyAll
    );
    await assertByRole(
      ({ db }) =>
        updateDoc(doc(db, "auditLogsByDay", "20260309", "auditEntries", "auditB"), {
          result: "failure",
        }),
      denyAll
    );
    await assertByRole(
      async ({ db, role }) => {
        const id = `audit_del_${role}`;
        await seedPath(
          ["auditLogsByDay", "20260309", "auditEntries", id],
          { actorUid: "uidA", action: "logout", result: "success" }
        );
        return deleteDoc(doc(db, "auditLogsByDay", "20260309", "auditEntries", id));
      },
      denyAll
    );
  });
});

describe("/userCorrections/{uid}", () => {
  test("super_admin can manage no-show corrections without rolePermissions doc", async () => {
    await assertSucceeds(
      setDoc(doc(superAdmin(), "userCorrections", "uidUser"), {
        uid: "uidUser",
        noShow: {
          adjustment: -2,
          targetCount: 1,
          baseRawCount: 3,
          updatedByUid: "uidSA",
        },
      })
    );

    await assertSucceeds(
      updateDoc(doc(superAdmin(), "userCorrections", "uidUser"), {
        "noShow.adjustment": -1,
      })
    );

    await assertSucceeds(
      deleteDoc(doc(superAdmin(), "userCorrections", "uidUser"))
    );
  });

  test("admin requires explicit permission to manage no-show corrections", async () => {
    await assertFails(
      setDoc(doc(admin(), "userCorrections", "uidUser"), {
        uid: "uidUser",
        noShow: {
          adjustment: -2,
          targetCount: 1,
          baseRawCount: 3,
          updatedByUid: "uidAdmin",
        },
      })
    );

    await seedRolePermissions("admin", ["admin.repair.no_show_adjust"]);

    await assertSucceeds(
      setDoc(doc(admin(), "userCorrections", "uidUser"), {
        uid: "uidUser",
        noShow: {
          adjustment: -2,
          targetCount: 1,
          baseRawCount: 3,
          updatedByUid: "uidAdmin",
        },
      })
    );
  });

  test("user role cannot manage no-show corrections even if rolePermissions doc exists", async () => {
    await seedRolePermissions("user", ["admin.repair.no_show_adjust"]);

    await assertFails(
      setDoc(doc(user(), "userCorrections", "uidUser"), {
        uid: "uidUser",
        noShow: {
          adjustment: -1,
          targetCount: 0,
          baseRawCount: 1,
          updatedByUid: "uidUser",
        },
      })
    );
  });
});

describe("/teams/{teamId}", () => {
  test("read (current): allow all", async () => {
    await assertByRole(({ db }) => getDoc(doc(db, "teams", "teamA")), allowAll);
  });

  test("create (current): guest deny; authenticated allow with name", async () => {
    await assertByRole(
      ({ db, role }) => setDoc(doc(db, "teams", `team_create_${role}`), { name: "Team X" }),
      allowAuth
    );
  });

  test("update: owner or hasPerm('team.manage_all') can update, others cannot", async () => {
    await assertFails(updateDoc(doc(guest(), "teams", "teamB"), { name: "guest-update" }));
    await assertFails(updateDoc(doc(memberA(), "teams", "teamB"), { name: "updated-by-a" }));
    await assertSucceeds(updateDoc(doc(memberB(), "teams", "teamB"), { name: "updated-by-b" }));
    // admin has team.manage_all from seeded rolePermissions
    await assertSucceeds(updateDoc(doc(admin(), "teams", "teamB"), { name: "updated-by-admin" }));
    await assertSucceeds(updateDoc(doc(superAdmin(), "teams", "teamB"), { name: "updated-by-super-admin" }));
  });

  test("delete (current): owner or admin/superAdmin", async () => {
    await assertFails(deleteDoc(doc(guest(), "teams", "teamA")));

    await seedDoc("teams", "team_own_A", {
      name: "Team Own A",
      captainUid: "uidA",
      creatorUid: "uidA",
      ownerUid: "uidA",
    });
    await assertSucceeds(deleteDoc(doc(memberA(), "teams", "team_own_A")));

    await seedDoc("teams", "team_other_for_A", {
      name: "Team Other A",
      captainUid: "uidB",
      creatorUid: "uidB",
      ownerUid: "uidB",
    });
    await assertFails(deleteDoc(doc(memberA(), "teams", "team_other_for_A")));

    await seedDoc("teams", "team_own_B", {
      name: "Team Own B",
      captainUid: "uidB",
      creatorUid: "uidB",
      ownerUid: "uidB",
    });
    await assertSucceeds(deleteDoc(doc(memberB(), "teams", "team_own_B")));

    await seedDoc("teams", "team_other_for_B", {
      name: "Team Other B",
      captainUid: "uidA",
      creatorUid: "uidA",
      ownerUid: "uidA",
    });
    await assertFails(deleteDoc(doc(memberB(), "teams", "team_other_for_B")));

    await seedDoc("teams", "team_admin_del", { name: "Admin Del", ownerUid: "uidA" });
    await assertSucceeds(deleteDoc(doc(admin(), "teams", "team_admin_del")));

    await seedDoc("teams", "team_sa_del", { name: "SA Del", ownerUid: "uidB" });
    await assertSucceeds(deleteDoc(doc(superAdmin(), "teams", "team_sa_del")));
  });
});

describe("/shopItems/{itemId}", () => {
  test("read (current): allow all", async () => {
    await assertByRole(({ db }) => getDoc(doc(db, "shopItems", "itemA")), allowAll);
  });

  test("create (current): guest deny; authenticated allow", async () => {
    await assertByRole(
      ({ db, role }) => setDoc(doc(db, "shopItems", `item_create_${role}`), { name: "Item X" }),
      allowAuth
    );
  });

  test("[SECURITY_GAP_FIXED] update: only owner or admin can update item", async () => {
    await assertFails(updateDoc(doc(guest(), "shopItems", "itemB"), { name: "guest-update" }));
    await assertFails(updateDoc(doc(memberA(), "shopItems", "itemB"), { name: "updated-by-a" }));
    await assertSucceeds(updateDoc(doc(memberB(), "shopItems", "itemB"), { name: "updated-by-b" }));
    await assertSucceeds(updateDoc(doc(admin(), "shopItems", "itemB"), { name: "updated-by-admin" }));
    await assertSucceeds(
      updateDoc(doc(superAdmin(), "shopItems", "itemB"), { name: "updated-by-super-admin" })
    );
  });

  test("delete (current): owner or admin/superAdmin", async () => {
    await assertFails(deleteDoc(doc(guest(), "shopItems", "itemA")));

    await seedDoc("shopItems", "item_own_A", { name: "ownA", ownerUid: "uidA", sellerUid: "uidA" });
    await assertSucceeds(deleteDoc(doc(memberA(), "shopItems", "item_own_A")));

    await seedDoc("shopItems", "item_other_for_A", { name: "otherA", ownerUid: "uidB", sellerUid: "uidB" });
    await assertFails(deleteDoc(doc(memberA(), "shopItems", "item_other_for_A")));

    await seedDoc("shopItems", "item_own_B", { name: "ownB", ownerUid: "uidB", sellerUid: "uidB" });
    await assertSucceeds(deleteDoc(doc(memberB(), "shopItems", "item_own_B")));

    await seedDoc("shopItems", "item_other_for_B", { name: "otherB", ownerUid: "uidA", sellerUid: "uidA" });
    await assertFails(deleteDoc(doc(memberB(), "shopItems", "item_other_for_B")));

    await seedDoc("shopItems", "item_admin_del", { name: "admin", ownerUid: "uidA" });
    await assertSucceeds(deleteDoc(doc(admin(), "shopItems", "item_admin_del")));

    await seedDoc("shopItems", "item_sa_del", { name: "sa", ownerUid: "uidB" });
    await assertSucceeds(deleteDoc(doc(superAdmin(), "shopItems", "item_sa_del")));
  });
});

describe("/trades/{tradeId}", () => {
  test("read (current): guest deny; authenticated allow", async () => {
    await assertByRole(({ db }) => getDoc(doc(db, "trades", "tradeA")), allowAuth);
  });

  test("[SECURITY_GAP] create (current): any authenticated user can create spoofed ownership fields", async () => {
    await assertByRole(
      ({ db, role }) =>
        setDoc(doc(db, "trades", `trade_create_${role}`), { ownerUid: role, fromUid: role }),
      allowAuth
    );
    await assertSucceeds(
      setDoc(doc(memberA(), "trades", "trade_spoof_by_A"), {
        ownerUid: "uidB",
        fromUid: "uidB",
        sellerUid: "uidB",
      })
    );
  });

  test("update (current): owner or admin/superAdmin", async () => {
    await assertFails(updateDoc(doc(guest(), "trades", "tradeA"), { status: "x" }));
    await assertSucceeds(updateDoc(doc(memberA(), "trades", "tradeA"), { status: "x" }));
    await assertFails(updateDoc(doc(memberA(), "trades", "tradeB"), { status: "x" }));
    await assertSucceeds(updateDoc(doc(memberB(), "trades", "tradeB"), { status: "x" }));
    await assertFails(updateDoc(doc(memberB(), "trades", "tradeA"), { status: "x" }));
    await assertSucceeds(updateDoc(doc(admin(), "trades", "tradeA"), { status: "x" }));
    await assertSucceeds(updateDoc(doc(superAdmin(), "trades", "tradeB"), { status: "x" }));
  });

  test("delete (current): owner or admin/superAdmin", async () => {
    await assertFails(deleteDoc(doc(guest(), "trades", "tradeA")));

    await seedDoc("trades", "trade_own_A", { ownerUid: "uidA", fromUid: "uidA" });
    await assertSucceeds(deleteDoc(doc(memberA(), "trades", "trade_own_A")));
    await seedDoc("trades", "trade_other_for_A", { ownerUid: "uidB", fromUid: "uidB" });
    await assertFails(deleteDoc(doc(memberA(), "trades", "trade_other_for_A")));

    await seedDoc("trades", "trade_own_B", { ownerUid: "uidB", fromUid: "uidB" });
    await assertSucceeds(deleteDoc(doc(memberB(), "trades", "trade_own_B")));
    await seedDoc("trades", "trade_other_for_B", { ownerUid: "uidA", fromUid: "uidA" });
    await assertFails(deleteDoc(doc(memberB(), "trades", "trade_other_for_B")));

    await seedDoc("trades", "trade_admin_del", { ownerUid: "uidA", fromUid: "uidA" });
    await assertSucceeds(deleteDoc(doc(admin(), "trades", "trade_admin_del")));
    await seedDoc("trades", "trade_sa_del", { ownerUid: "uidB", fromUid: "uidB" });
    await assertSucceeds(deleteDoc(doc(superAdmin(), "trades", "trade_sa_del")));
  });
});

describe("Role usability smoke tests", () => {
  test("user can create own registration", async () => {
    await assertSucceeds(
      setDoc(doc(user(), "registrations", "reg_user_smoke_create"), {
        eventId: "eventA",
        userId: "uidUser",
        status: "confirmed",
      })
    );
  });

  test("user can update own registration", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "registrations", "regUser"), {
        status: "cancelled",
      })
    );
  });

  test("user can delete own registration", async () => {
    await assertSucceeds(deleteDoc(doc(user(), "registrations", "regUser")));
  });

  test("user cannot update another user's registration", async () => {
    await assertFails(
      updateDoc(doc(user(), "registrations", "regCoach"), {
        status: "cancelled-by-user",
      })
    );
  });

  test("user cannot delete another user's registration", async () => {
    await assertFails(deleteDoc(doc(user(), "registrations", "regCoach")));
  });

  test("user can create message with fromUid=self", async () => {
    await assertSucceeds(
      setDoc(doc(user(), "messages", "msg_user_smoke_create"), {
        fromUid: "uidUser",
        toUid: "uidCoach",
        body: "hello coach",
      })
    );
  });

  test("user can delete own sent message", async () => {
    await assertSucceeds(deleteDoc(doc(user(), "messages", "msgUserSent")));
  });

  test("user cannot delete another user's message", async () => {
    await assertFails(deleteDoc(doc(user(), "messages", "msgCoachToUser")));
  });

  test("user can read received inbox message (toUid=self)", async () => {
    await assertSucceeds(getDoc(doc(user(), "messages", "msgCoachToUser")));
  });

  test("coach can update own created event", async () => {
    await assertSucceeds(
      updateDoc(doc(coach(), "events", "eventCoachOwn"), {
        status: "closed",
      })
    );
  });

  test("[SECURITY_GAP_USABILITY] non-coach user can update event", async () => {
    // SECURITY GAP: /events update currently allows any authenticated user (isAuth()).
    await assertSucceeds(
      updateDoc(doc(user(), "events", "eventCoachOwn"), {
        status: "user-updated",
      })
    );
  });

  test("manager/leader can update teams", async () => {
    await assertSucceeds(
      updateDoc(doc(manager(), "teams", "teamManagerOwn"), {
        name: "Manager Team Updated",
      })
    );
    await assertSucceeds(
      updateDoc(doc(leader(), "teams", "teamLeaderOwn"), {
        name: "Leader Team Updated",
      })
    );
  });

  test("[SECURITY_GAP_FIXED] user cannot update teams without owner/manager context", async () => {
    await assertFails(
      updateDoc(doc(user(), "teams", "teamManagerOwn"), {
        name: "User Updated Manager Team",
      })
    );
  });

  test("user can read own attendance record", async () => {
    await assertSucceeds(getDoc(doc(user(), "attendanceRecords", "attA")));
  });

  test("user can create attendance record", async () => {
    await assertSucceeds(
      setDoc(doc(user(), "attendanceRecords", "att_user_smoke"), {
        uid: "uidUser",
        status: "checkin",
        eventId: "eventA",
      })
    );
  });

  test("user cannot create line push queue job", async () => {
    await assertFails(
      setDoc(doc(user(), "linePushQueue", "queue_user_smoke"), {
        uid: "uidUser",
        title: "push",
        body: "payload",
        status: "pending",
      })
    );
  });

  test("admin/superAdmin can create line push queue job", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "linePushQueue", "queue_admin_smoke"), {
        uid: "uidUser",
        title: "admin push",
        body: "payload",
        status: "pending",
      })
    );
    await assertSucceeds(
      setDoc(doc(superAdmin(), "linePushQueue", "queue_sa_smoke"), {
        uid: "uidUser",
        title: "super admin push",
        body: "payload",
        status: "pending",
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  attendanceRecords comprehensive tests
// ═══════════════════════════════════════════════════════════════
describe("/attendanceRecords/{recordId}", () => {
  test("any authenticated user can read", async () => {
    await assertByRole(
      ({ db }) => getDoc(doc(db, "attendanceRecords", "attA")),
      allowAuth
    );
  });

  test("guest cannot read", async () => {
    await assertFails(getDoc(doc(guest(), "attendanceRecords", "attA")));
  });

  test("any authenticated user can create", async () => {
    await assertByRole(
      ({ db, role }) =>
        setDoc(doc(db, "attendanceRecords", `att_cr_${role}`), {
          uid: role,
          status: "checkin",
          eventId: "eventA",
        }),
      allowAuth
    );
  });

  test("guest cannot create", async () => {
    await assertFails(
      setDoc(doc(guest(), "attendanceRecords", "att_cr_guest"), {
        uid: "nobody",
        status: "checkin",
        eventId: "eventA",
      })
    );
  });

  test("admin can update any field", async () => {
    await assertSucceeds(
      updateDoc(doc(admin(), "attendanceRecords", "att_existing"), {
        status: "checkout",
        eventId: "eventB",
        type: "friendly",
        checkOutTime: new Date(),
      })
    );
  });

  test("non-admin can update status fields only (isAttendanceStatusUpdate)", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "attendanceRecords", "att_existing"), {
        status: "checkout",
        checkOutTime: new Date(),
        updatedAt: new Date(),
      })
    );
  });

  test("non-admin can update removedAt and removedByUid status fields", async () => {
    await assertSucceeds(
      updateDoc(doc(memberA(), "attendanceRecords", "att_existing"), {
        status: "removed",
        removedAt: new Date(),
        removedByUid: "uidA",
        updatedAt: new Date(),
      })
    );
  });

  test("non-admin cannot update non-status fields like eventId or type", async () => {
    await assertFails(
      updateDoc(doc(user(), "attendanceRecords", "att_existing"), {
        eventId: "eventB",
      })
    );
    await assertFails(
      updateDoc(doc(memberA(), "attendanceRecords", "att_existing"), {
        type: "friendly",
      })
    );
    await assertFails(
      updateDoc(doc(user(), "attendanceRecords", "att_existing"), {
        uid: "uidOther",
      })
    );
  });

  test("non-admin cannot update status + non-status fields together", async () => {
    await assertFails(
      updateDoc(doc(user(), "attendanceRecords", "att_existing"), {
        status: "checkout",
        eventId: "eventB",
      })
    );
  });

  test("nobody can delete (allow delete: if false)", async () => {
    await assertByRole(
      async ({ db, role }) => {
        const id = `att_del_check_${role}`;
        await seedDoc("attendanceRecords", id, {
          uid: "uidA",
          status: "checkin",
          eventId: "eventA",
        });
        return deleteDoc(doc(db, "attendanceRecords", id));
      },
      denyAll
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  users self-update security boundaries
// ═══════════════════════════════════════════════════════════════
describe("/users/{userId} self-update security boundaries", () => {
  // --- isSafeSelfProfileUpdate path ---
  test("owner can update safe profile fields (displayName, phone, gender, etc.)", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        displayName: "New Name",
        phone: "0912345678",
        gender: "male",
        birthday: "1990-01-01",
        region: "Taipei",
        sports: "football",
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("owner can update photoURL, pictureUrl, favorites, socialLinks", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        photoURL: "https://example.com/photo.png",
        pictureUrl: "https://example.com/pic.png",
        favorites: { team: "teamA" },
        socialLinks: { line: "myline" },
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("owner can update titleBig, titleNormal, lineNotify, companions", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        titleBig: "MVP",
        titleNormal: "Player",
        lineNotify: { enabled: true },
        companions: [{ name: "Friend" }],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("owner can set nullable profile fields to null", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        phone: null,
        gender: null,
        birthday: null,
        photoURL: null,
        pictureUrl: null,
        region: null,
        sports: null,
        favorites: null,
        socialLinks: null,
        titleBig: null,
        titleNormal: null,
        lineNotify: null,
        companions: null,
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("owner CANNOT update role", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        role: "admin",
      })
    );
  });

  test("owner CANNOT update exp", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        exp: 9999,
      })
    );
  });

  test("owner CANNOT update level", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        level: 99,
      })
    );
  });

  test("owner CANNOT update uid", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        uid: "uidHacked",
      })
    );
  });

  test("owner CANNOT update isAdmin", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        isAdmin: true,
      })
    );
  });

  test("owner CANNOT update createdAt", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        createdAt: new Date(),
      })
    );
  });

  test("owner CANNOT update claims or manualRole", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        claims: { role: "admin" },
      })
    );
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        manualRole: "admin",
      })
    );
  });

  test("owner CANNOT update lineUserId", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        lineUserId: "Ufake123",
      })
    );
  });

  test("owner CANNOT update teamId/teamName via normal profile update", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        displayName: "Updated",
        teamId: "teamA",
        teamName: "Team A",
        updatedAt: serverTimestamp(),
      })
    );
  });

  // --- isTeamFieldShrinkOrClear path ---
  test("owner CAN do team field shrink (remove from teamIds)", async () => {
    await seedUserDoc("uidUser", {
      displayName: "General User",
      teamId: "teamA",
      teamName: "Team A",
      teamIds: ["teamA", "teamB", "teamC"],
      teamNames: ["Team A", "Team B", "Team C"],
    });

    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        teamId: "teamA",
        teamName: "Team A",
        teamIds: ["teamA", "teamB"],
        teamNames: ["Team A", "Team B"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("owner CAN clear all team fields", async () => {
    await seedUserDoc("uidUser", {
      displayName: "General User",
      teamId: "teamA",
      teamName: "Team A",
      teamIds: ["teamA"],
      teamNames: ["Team A"],
    });

    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        teamId: null,
        teamName: null,
        teamIds: [],
        teamNames: [],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("owner CAN clear team fields using null for teamIds/teamNames", async () => {
    await seedUserDoc("uidUser", {
      displayName: "General User",
      teamId: "teamA",
      teamName: "Team A",
      teamIds: ["teamA"],
      teamNames: ["Team A"],
    });

    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        teamId: null,
        teamName: null,
        teamIds: null,
        teamNames: null,
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("owner CANNOT add new team via team shrink path", async () => {
    await seedUserDoc("uidUser", {
      displayName: "General User",
      teamId: "teamA",
      teamName: "Team A",
      teamIds: ["teamA"],
      teamNames: ["Team A"],
    });

    // Trying to add a new team that wasn't in original teamIds
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        teamId: "teamX",
        teamName: "Team X",
        teamIds: ["teamX"],
        teamNames: ["Team X"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("owner CANNOT replace team list with different team of same size", async () => {
    await seedUserDoc("uidUser", {
      displayName: "General User",
      teamId: "teamA",
      teamName: "Team A",
      teamIds: ["teamA"],
      teamNames: ["Team A"],
    });

    // Same size but different team — not a shrink, not a clear
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        teamId: "teamX",
        teamName: "Team X",
        teamIds: ["teamX"],
        teamNames: ["Team X"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  // --- isSafeLoginUpdate path ---
  test("login update: can update displayName + pictureUrl + lastLogin", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        displayName: "Login Updated Name",
        pictureUrl: "https://example.com/new-avatar.png",
        lastLogin: serverTimestamp(),
      })
    );
  });

  test("login update: can update only lastLogin with server timestamp", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        lastLogin: serverTimestamp(),
      })
    );
  });

  test("login update: can update displayName + lastLogin without pictureUrl", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        displayName: "Just Name Update",
        lastLogin: serverTimestamp(),
      })
    );
  });

  test("login update: lastLogin must equal request.time (serverTimestamp)", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        displayName: "Spoofed Login",
        pictureUrl: "https://example.com/pic.png",
        lastLogin: new Date("2020-01-01T00:00:00.000Z"),
      })
    );
  });

  test("login update: cannot include other fields like phone", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        displayName: "Login Name",
        pictureUrl: "https://example.com/pic.png",
        lastLogin: serverTimestamp(),
        phone: "0912345678",
      })
    );
  });

  test("login update: cannot include updatedAt (not in login shape)", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        displayName: "Login Name",
        lastLogin: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  // --- Cross-path: non-owner cannot use self-update paths ---
  test("non-owner cannot update another user's profile even with safe fields", async () => {
    await assertFails(
      updateDoc(doc(memberA(), "users", "uidUser"), {
        displayName: "Hacked Name",
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("non-owner cannot use login update path on another user", async () => {
    await assertFails(
      updateDoc(doc(memberA(), "users", "uidUser"), {
        displayName: "Hacked Login",
        lastLogin: serverTimestamp(),
      })
    );
  });

  // --- delete always denied ---
  test("nobody can delete a user document", async () => {
    await assertByRole(
      async ({ db, role }) => {
        const id = `user_del_${role}`;
        await seedUserDoc(id, { displayName: `Del ${role}` });
        return deleteDoc(doc(db, "users", id));
      },
      denyAll
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  rolePermissions collection tests
// ═══════════════════════════════════════════════════════════════
describe("/rolePermissions/{roleKey}", () => {
  test("any authenticated user can read", async () => {
    await assertByRole(
      ({ db }) => getDoc(doc(db, "rolePermissions", "admin")),
      allowAuth
    );
  });

  test("guest cannot read", async () => {
    await assertFails(getDoc(doc(guest(), "rolePermissions", "admin")));
  });

  test("superAdmin can create new rolePermissions doc", async () => {
    await assertSucceeds(
      setDoc(doc(superAdmin(), "rolePermissions", "coach"), {
        permissions: ["event.edit_all"],
      })
    );
  });

  test("superAdmin can update existing rolePermissions doc", async () => {
    await assertSucceeds(
      updateDoc(doc(superAdmin(), "rolePermissions", "admin"), {
        permissions: ["event.edit_all", "team.manage_all", "admin.shop.entry"],
      })
    );
  });

  test("superAdmin can delete rolePermissions doc", async () => {
    await seedDoc("rolePermissions", "rp_del_test", {
      permissions: ["some.perm"],
    });
    await assertSucceeds(
      deleteDoc(doc(superAdmin(), "rolePermissions", "rp_del_test"))
    );
  });

  test("admin cannot create rolePermissions", async () => {
    await assertFails(
      setDoc(doc(admin(), "rolePermissions", "captain"), {
        permissions: ["event.edit_all"],
      })
    );
  });

  test("admin cannot update rolePermissions", async () => {
    await assertFails(
      updateDoc(doc(admin(), "rolePermissions", "admin"), {
        permissions: ["event.edit_all", "team.manage_all", "admin.shop.entry"],
      })
    );
  });

  test("admin cannot delete rolePermissions", async () => {
    await assertFails(
      deleteDoc(doc(admin(), "rolePermissions", "admin"))
    );
  });

  test("regular user cannot create rolePermissions", async () => {
    await assertFails(
      setDoc(doc(user(), "rolePermissions", "user"), {
        permissions: ["event.edit_all"],
      })
    );
  });

  test("regular user cannot update rolePermissions", async () => {
    await assertFails(
      updateDoc(doc(user(), "rolePermissions", "admin"), {
        permissions: [],
      })
    );
  });

  test("regular user cannot delete rolePermissions", async () => {
    await assertFails(
      deleteDoc(doc(user(), "rolePermissions", "admin"))
    );
  });

  test("memberA cannot write rolePermissions", async () => {
    await assertFails(
      setDoc(doc(memberA(), "rolePermissions", "memberA_test"), {
        permissions: ["event.edit_all"],
      })
    );
    await assertFails(
      updateDoc(doc(memberA(), "rolePermissions", "admin"), {
        permissions: [],
      })
    );
  });

  test("guest cannot write rolePermissions", async () => {
    await assertFails(
      setDoc(doc(guest(), "rolePermissions", "guest_test"), {
        permissions: [],
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Phase 4: hasPerm() 權限碼授予 → 存取控制矩陣
// ═══════════════════════════════════════════════════════════════

describe("Phase 4: hasPerm() permission-grant access control", () => {
  // --- errorLogs: requires admin.logs.error_read ---
  describe("errorLogs — hasPerm('admin.logs.error_read')", () => {
    test("coach with admin.logs.error_read can read errorLogs", async () => {
      await seedRolePermissions("coach", ["admin.logs.error_read"]);
      await seedDoc("errorLogs", "log1", { message: "test error", createdAt: new Date() });
      await assertSucceeds(getDoc(doc(coach(), "errorLogs", "log1")));
    });

    test("coach without admin.logs.error_read cannot read errorLogs", async () => {
      await seedRolePermissions("coach", []);
      await assertFails(getDoc(doc(coach(), "errorLogs", "log1")));
    });

    test("superAdmin always reads errorLogs (bypasses hasPerm)", async () => {
      await assertSucceeds(getDoc(doc(superAdmin(), "errorLogs", "log1")));
    });

    test("user cannot read errorLogs even with permission in doc", async () => {
      await seedRolePermissions("user", ["admin.logs.error_read"]);
      await assertFails(getDoc(doc(user(), "errorLogs", "log1")));
    });
  });

  // --- errorLogs delete: requires admin.logs.error_delete ---
  describe("errorLogs delete — hasPerm('admin.logs.error_delete')", () => {
    test("admin with admin.logs.error_delete can delete", async () => {
      await seedRolePermissions("admin", ["admin.logs.error_delete"]);
      await seedDoc("errorLogs", "log_del", { message: "to delete" });
      await assertSucceeds(deleteDoc(doc(admin(), "errorLogs", "log_del")));
    });

    test("admin without admin.logs.error_delete cannot delete", async () => {
      await seedRolePermissions("admin", []);
      await seedDoc("errorLogs", "log_del2", { message: "to delete" });
      await assertFails(deleteDoc(doc(admin(), "errorLogs", "log_del2")));
    });
  });

  // --- announcements: requires admin.announcements.entry ---
  describe("announcements — hasPerm('admin.announcements.entry')", () => {
    test("coach with perm can create announcement", async () => {
      await seedRolePermissions("coach", ["admin.announcements.entry"]);
      await assertSucceeds(
        setDoc(doc(coach(), "announcements", "ann1"), {
          title: "Test", body: "Hello", createdAt: new Date(),
        })
      );
    });

    test("coach without perm cannot create announcement", async () => {
      await seedRolePermissions("coach", []);
      await assertFails(
        setDoc(doc(coach(), "announcements", "ann2"), {
          title: "Test", body: "Hello", createdAt: new Date(),
        })
      );
    });
  });

  // --- Permission revoke takes effect immediately ---
  describe("real-time permission revoke", () => {
    test("grant perm → access OK → revoke → access denied", async () => {
      await seedRolePermissions("coach", ["admin.logs.error_read"]);
      await seedDoc("errorLogs", "log_rt", { message: "realtime test" });
      await assertSucceeds(getDoc(doc(coach(), "errorLogs", "log_rt")));

      // Revoke
      await seedRolePermissions("coach", []);
      await assertFails(getDoc(doc(coach(), "errorLogs", "log_rt")));
    });
  });

  // --- rolePermissions missing doc → fail closed ---
  describe("missing rolePermissions document → fail closed", () => {
    test("venue_owner with no rolePermissions doc cannot read errorLogs", async () => {
      // Do NOT seed rolePermissions for venue_owner
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await deleteDoc(doc(ctx.firestore(), "rolePermissions", "venue_owner")).catch(() => {});
      });
      await assertFails(getDoc(doc(venueOwner(), "errorLogs", "log1")));
    });
  });

  // --- seoSnapshots: requires isAdmin || isSuperAdmin || admin.seo.entry ---
  describe("seoSnapshots — admin/super_admin or admin.seo.entry", () => {
    test("admin can read seoSnapshots (via isAdmin)", async () => {
      await seedDoc("seoSnapshots", "2026-04-22", { impressions: 100, clicks: 25 });
      await assertSucceeds(getDoc(doc(admin(), "seoSnapshots", "2026-04-22")));
    });

    test("super_admin can read seoSnapshots (via isSuperAdmin)", async () => {
      await assertSucceeds(getDoc(doc(superAdmin(), "seoSnapshots", "2026-04-22")));
    });

    test("coach with admin.seo.entry can read seoSnapshots", async () => {
      await seedRolePermissions("coach", ["admin.seo.entry"]);
      await assertSucceeds(getDoc(doc(coach(), "seoSnapshots", "2026-04-22")));
    });

    test("coach without admin.seo.entry cannot read seoSnapshots", async () => {
      await seedRolePermissions("coach", []);
      await assertFails(getDoc(doc(coach(), "seoSnapshots", "2026-04-22")));
    });

    test("user cannot read seoSnapshots even with permission in doc", async () => {
      await seedRolePermissions("user", ["admin.seo.entry"]);
      await assertFails(getDoc(doc(user(), "seoSnapshots", "2026-04-22")));
    });

    test("no one can write seoSnapshots via client SDK (write=false)", async () => {
      await assertFails(
        setDoc(doc(superAdmin(), "seoSnapshots", "2026-04-23"), { impressions: 0 })
      );
      await assertFails(
        setDoc(doc(admin(), "seoSnapshots", "2026-04-23"), { impressions: 0 })
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Phase 4: User basic features NOT blocked by permissions
// ═══════════════════════════════════════════════════════════════

describe("Phase 4: user basic features always allowed (no perm required)", () => {
  test("user can read events (public)", async () => {
    await seedDoc("events", "evt1", { title: "Test Event", status: "open" });
    await assertSucceeds(getDoc(doc(user(), "events", "evt1")));
  });

  test("user can create own registration", async () => {
    await assertSucceeds(
      setDoc(doc(user(), "registrations", "reg1"), {
        eventId: "evt1", userId: "uidUser", uid: "uidUser",
        status: "confirmed", registeredAt: new Date(),
      })
    );
  });

  test("user can read teams (public)", async () => {
    await seedDoc("teams", "team1", { name: "Test Team", active: true });
    await assertSucceeds(getDoc(doc(user(), "teams", "team1")));
  });

  test("user can read own profile", async () => {
    await seedUserDoc("uidUser");
    await assertSucceeds(getDoc(doc(user(), "users", "uidUser")));
  });

  test("user can read own inbox", async () => {
    await seedPath(["users", "uidUser", "inbox", "msg1"], {
      body: "test", from: "system", to: "uidUser",
    });
    await assertSucceeds(
      getDoc(doc(user(), "users", "uidUser", "inbox", "msg1"))
    );
  });

  test("guest can read events (public)", async () => {
    await assertSucceeds(getDoc(doc(guest(), "events", "evt1")));
  });

  test("guest can read teams (public)", async () => {
    await assertSucceeds(getDoc(doc(guest(), "teams", "team1")));
  });
});
