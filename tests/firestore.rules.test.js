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
  writeBatch,
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

const DEFAULT_USER_ACTIVITY_CAPABILITIES = [
  "user.activity.basic_create",
  "user.activity.external_create",
  "user.activity.own_manage_entry",
  "user.activity.own_edit_basic",
  "user.activity.own_cancel",
  "user.activity.site_operate",
  "user.activity.delegate_assign",
];

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

async function seedUserPermissionGrant(uid, permissions = [], overrides = {}) {
  await seedDoc("userPermissionGrants", uid, {
    uid,
    permissions: [...permissions],
    enabled: true,
    ...overrides,
  });
}

async function seedRoleActivityCapabilities(capabilities = DEFAULT_USER_ACTIVITY_CAPABILITIES) {
  await seedDoc("roleActivityCapabilities", "user", {
    capabilities: [...capabilities],
    catalogVersion: "test",
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
      permissions: ["event.edit_all", "team.manage_all", "admin.tournaments.manage_all"],
    });
    await setDoc(doc(db, "rolePermissions", "super_admin"), {
      permissions: ["event.edit_all", "team.manage_all", "admin.tournaments.manage_all", "admin.repair.no_show_adjust"],
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
}, 30000);

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedBaseDocs();
}, 30000);

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

function newUserPayload(uid, overrides = {}) {
  return {
    uid,
    lineUserId: uid,
    displayName: `New ${uid}`,
    pictureUrl: null,
    email: null,
    role: "user",
    exp: 0,
    level: 1,
    gender: null,
    birthday: null,
    region: null,
    sports: null,
    teamId: null,
    teamName: null,
    phone: null,
    titleBig: null,
    titleNormal: null,
    totalGames: 0,
    completedGames: 0,
    attendanceRate: 0,
    badgeCount: 0,
    createdAt: serverTimestamp(),
    lastLogin: serverTimestamp(),
    ...overrides,
  };
}

function identitySettingsPayload(overrides = {}) {
  return {
    profileActiveIdentityId: "main",
    identities: {
      secondary: {
        identityId: "secondary",
        enabled: false,
        displayName: "次身份",
        avatarUrl: null,
        avatarStoragePath: null,
        avatarStorageBucket: null,
        displayRoleLabel: "一般用戶",
        isPrimary: false,
        editable: true,
        updatedAt: serverTimestamp(),
        ...(overrides.secondary || {}),
      },
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== "secondary")
    ),
  };
}

function teamScopedEventPayload(id, creatorUid, teamIds) {
  const normalizedTeamIds = [...teamIds];
  return {
    id,
    title: `Team Scoped ${id}`,
    creatorUid,
    status: "open",
    teamOnly: true,
    isPublic: true,
    creatorTeamId: normalizedTeamIds[0],
    creatorTeamName: `Team ${normalizedTeamIds[0]}`,
    creatorTeamIds: normalizedTeamIds,
    creatorTeamNames: normalizedTeamIds.map((teamId) => `Team ${teamId}`),
  };
}

describe("/users/{userId}", () => {

  test("[SECONDARY_IDENTITY] root create permits only login/profile seed fields", async () => {
    await assertSucceeds(
      setDoc(
        doc(user("uidCreate"), "users", "uidCreate"),
        newUserPayload("uidCreate")
      )
    );

    await assertFails(
      setDoc(
        doc(user("uidCreateIdentities"), "users", "uidCreateIdentities"),
        newUserPayload("uidCreateIdentities", {
          identities: { secondary: { displayName: "leak" } },
        })
      )
    );

    await assertFails(
      setDoc(
        doc(user("uidCreateActiveIdentity"), "users", "uidCreateActiveIdentity"),
        newUserPayload("uidCreateActiveIdentity", {
          profileActiveIdentityId: "secondary",
        })
      )
    );

    await assertFails(
      setDoc(
        doc(user("uidCreateClaims"), "users", "uidCreateClaims"),
        newUserPayload("uidCreateClaims", {
          claims: { role: "admin" },
        })
      )
    );
  });

  test("[SECONDARY_IDENTITY] root create cannot self-assign privilege-shaped fields", async () => {
    await assertFails(
      setDoc(
        doc(user("uidCreateRole"), "users", "uidCreateRole"),
        newUserPayload("uidCreateRole", { role: "admin" })
      )
    );

    await assertFails(
      setDoc(
        doc(user("uidCreateExp"), "users", "uidCreateExp"),
        newUserPayload("uidCreateExp", { exp: 9999 })
      )
    );

    await assertFails(
      setDoc(
        doc(user("uidCreateManualRole"), "users", "uidCreateManualRole"),
        newUserPayload("uidCreateManualRole", { manualRole: "admin" })
      )
    );
  });

  test("[SECONDARY_IDENTITY] identityPrivate settings are owner/admin readable only", async () => {
    await seedRolePermissions("coach", ["profile.secondary_identity"]);
    const ownerRef = doc(coach(), "users", "uidCoach", "identityPrivate", "settings");
    await assertSucceeds(setDoc(ownerRef, identitySettingsPayload()));

    await assertSucceeds(getDoc(ownerRef));
    await assertSucceeds(
      getDoc(doc(admin(), "users", "uidCoach", "identityPrivate", "settings"))
    );
    await assertFails(
      getDoc(doc(memberA(), "users", "uidCoach", "identityPrivate", "settings"))
    );
  });

  test("[SECONDARY_IDENTITY] identityPrivate settings reject cross-user writes and invalid activation", async () => {
    await seedRolePermissions("coach", ["profile.secondary_identity"]);
    await assertFails(
      setDoc(
        doc(memberA(), "users", "uidCoach", "identityPrivate", "settings"),
        identitySettingsPayload()
      )
    );

    await assertFails(
      setDoc(
        doc(user(), "users", "uidUser", "identityPrivate", "settings"),
        identitySettingsPayload()
      )
    );

    await assertFails(
      setDoc(
        doc(coach(), "users", "uidCoach", "identityPrivate", "settings"),
        identitySettingsPayload({
          profileActiveIdentityId: "secondary",
          secondary: { enabled: false },
        })
      )
    );

    await assertSucceeds(
      setDoc(
        doc(coach(), "users", "uidCoach", "identityPrivate", "settings"),
        identitySettingsPayload({
          profileActiveIdentityId: "secondary",
          secondary: { enabled: true },
        })
      )
    );
  });

  test("[SECONDARY_IDENTITY] regular user with individual grant can write own settings", async () => {
    await seedUserPermissionGrant("uidUser", ["profile.secondary_identity"]);
    const ownerRef = doc(user(), "users", "uidUser", "identityPrivate", "settings");

    await assertSucceeds(
      setDoc(
        ownerRef,
        identitySettingsPayload({
          profileActiveIdentityId: "secondary",
          secondary: { enabled: true },
        })
      )
    );
  });

  test("[SECONDARY_IDENTITY] client cannot directly commit non-null avatar metadata", async () => {
    await seedRolePermissions("coach", ["profile.secondary_identity"]);
    await assertFails(
      setDoc(
        doc(coach(), "users", "uidCoach", "identityPrivate", "settings"),
        identitySettingsPayload({
          secondary: {
            enabled: true,
            avatarUrl: "https://firebasestorage.googleapis.com/v0/b/demo/o/avatar.png?alt=media",
          },
        })
      )
    );

    await assertFails(
      setDoc(
        doc(coach(), "users", "uidCoach", "identityPrivate", "settings"),
        identitySettingsPayload({
          secondary: {
            enabled: true,
            avatarStoragePath: "images/users/uidCoach/identities/secondary/avatar.png",
          },
        })
      )
    );
  });

  test("[SECONDARY_IDENTITY] client can preserve server-committed avatar metadata but cannot change it", async () => {
    await seedRolePermissions("coach", ["profile.secondary_identity"]);
    await seedPath(["users", "uidCoach", "identityPrivate", "settings"], {
      profileActiveIdentityId: "secondary",
      identities: {
        secondary: {
          identityId: "secondary",
          enabled: true,
          displayName: "次身份",
          avatarUrl: "https://firebasestorage.googleapis.com/v0/b/demo-project.firebasestorage.app/o/images%2Fusers%2FuidCoach%2Fidentities%2Fsecondary%2Fa.png?alt=media",
          avatarStoragePath: "images/users/uidCoach/identities/secondary/a.png",
          avatarStorageBucket: "demo-project.firebasestorage.app",
          displayRoleLabel: "一般用戶",
          isPrimary: false,
          editable: true,
          updatedAt: new Date(),
        },
      },
      updatedAt: new Date(),
    });

    await assertSucceeds(
      updateDoc(doc(coach(), "users", "uidCoach", "identityPrivate", "settings"), {
        "identities.secondary.displayName": "新次身份",
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      setDoc(
        doc(coach(), "users", "uidCoach", "identityPrivate", "settings"),
        {
          profileActiveIdentityId: "secondary",
          identities: {
            secondary: {
              identityId: "secondary",
              enabled: true,
              displayName: "Alias",
              displayRoleLabel: "User",
              isPrimary: false,
              editable: true,
              updatedAt: serverTimestamp(),
            },
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    );

    await assertFails(
      updateDoc(doc(coach(), "users", "uidCoach", "identityPrivate", "settings"), {
        "identities.secondary.avatarUrl": "https://firebasestorage.googleapis.com/v0/b/demo-project.firebasestorage.app/o/images%2Fusers%2FuidCoach%2Fidentities%2Fsecondary%2Fb.png?alt=media",
        updatedAt: serverTimestamp(),
      })
    );
  });

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

  test("viewCount direct updates and private markers stay server-only", async () => {
    await seedDoc("events", "event_view_server_only", {
      id: "event_view_server_only",
      title: "View Server Only",
      creatorUid: "uidA",
      ownerUid: "uidA",
      status: "open",
      viewCount: 3,
    });

    for (const role of roles) {
      const db = roleDb[role]();
      await assertFails(
        updateDoc(doc(db, "events", "event_view_server_only"), { viewCount: 4 })
      );
      await assertFails(
        getDoc(doc(db, "eventViewCountMarkers", `marker_${role}`))
      );
      await assertFails(
        setDoc(doc(db, "eventViewCountMarkers", `marker_${role}`), {
          eventId: "event_view_server_only",
          dayKey: "2026-07-17",
        })
      );
    }
  });
  test("write-create: guest denied; authenticated roles allowed through scoped capabilities", async () => {
    await assertByRole(
      ({ db, role }) =>
        setDoc(doc(db, "events", `event_create_${role}`), {
          title: "created",
          creatorUid: uidByRole[role] || "uidA",
        }),
      allowAuth
    );
  });

  test("coach can create a team-scoped event only for one team they staff", async () => {
    await seedDoc("teams", "teamCoachOwn", {
      id: "teamCoachOwn",
      name: "Coach Team",
      coachUids: ["uidCoach"],
    });

    await assertSucceeds(
      setDoc(
        doc(coach(), "events", "event_coach_team_own"),
        teamScopedEventPayload("event_coach_team_own", "uidCoach", ["teamCoachOwn"])
      )
    );
    await assertFails(
      setDoc(
        doc(coach(), "events", "event_coach_team_unrelated"),
        teamScopedEventPayload("event_coach_team_unrelated", "uidCoach", ["teamA"])
      )
    );
    await assertFails(
      setDoc(
        doc(coach(), "events", "event_coach_team_multiple"),
        teamScopedEventPayload("event_coach_team_multiple", "uidCoach", ["teamCoachOwn", "teamA"])
      )
    );
  });

  test("admin needs event.edit_all to create events for arbitrary team scopes", async () => {
    await seedRolePermissions("admin", []);
    await assertFails(
      setDoc(
        doc(admin(), "events", "event_admin_team_without_broad"),
        teamScopedEventPayload("event_admin_team_without_broad", "uidAdmin", ["teamA", "teamB"])
      )
    );

    await seedRolePermissions("admin", ["event.edit_all"]);
    await assertSucceeds(
      setDoc(
        doc(admin(), "events", "event_admin_team_with_broad"),
        teamScopedEventPayload("event_admin_team_with_broad", "uidAdmin", ["teamA", "teamB"])
      )
    );
  });

  test("activity entry alone cannot grant team scope; team.create_event still requires staff scope", async () => {
    await seedRoleActivityCapabilities([
      ...DEFAULT_USER_ACTIVITY_CAPABILITIES,
      "user.activity.addons_use",
    ]);
    await seedUserPermissionGrant("uidUser", ["activity.manage.entry"]);

    await assertFails(
      setDoc(
        doc(user(), "events", "event_user_entry_team_own"),
        teamScopedEventPayload("event_user_entry_team_own", "uidUser", ["teamUserOwn"])
      )
    );

    await seedUserPermissionGrant("uidUser", [
      "activity.manage.entry",
      "team.create_event",
    ]);
    await assertSucceeds(
      setDoc(
        doc(user(), "events", "event_user_scoped_team_own"),
        teamScopedEventPayload("event_user_scoped_team_own", "uidUser", ["teamUserOwn"])
      )
    );
    await assertFails(
      setDoc(
        doc(user(), "events", "event_user_scoped_team_unrelated"),
        teamScopedEventPayload("event_user_scoped_team_unrelated", "uidUser", ["teamA"])
      )
    );
  });

  test("write-update: non-owner user cannot update another user's event", async () => {
    await assertByRole(
      ({ db }) => updateDoc(doc(db, "events", "eventB"), { status: "closed" }),
      {
        guest: false,
        memberA: false,
        memberB: false,
        admin: true,
        superAdmin: true,
      }
    );
  });

  test("user activity capabilities can be read by authenticated users and written only by super_admin", async () => {
    await seedRoleActivityCapabilities();
    await assertFails(getDoc(doc(guest(), "roleActivityCapabilities", "user")));
    await assertSucceeds(getDoc(doc(user(), "roleActivityCapabilities", "user")));
    await assertFails(
      setDoc(doc(user(), "roleActivityCapabilities", "user"), {
        capabilities: [],
      })
    );
    await assertFails(
      setDoc(doc(admin(), "roleActivityCapabilities", "user"), {
        capabilities: [],
      })
    );
    await assertSucceeds(
      setDoc(doc(superAdmin(), "roleActivityCapabilities", "user"), {
        capabilities: DEFAULT_USER_ACTIVITY_CAPABILITIES,
      })
    );
  });

  test("user can create own basic event but cannot enable add-on fields", async () => {
    await assertSucceeds(
      setDoc(doc(user(), "events", "event_user_basic_create"), {
        title: "User Basic",
        creatorUid: "uidUser",
        status: "open",
      })
    );

    await assertFails(
      setDoc(doc(user(), "events", "event_user_addon_create"), {
        title: "User Add-on",
        creatorUid: "uidUser",
        feeEnabled: true,
        fee: 500,
      })
    );
    await assertFails(
      setDoc(doc(user(), "events", "event_user_social_addon_create"), {
        title: "User Social Add-on",
        creatorUid: "uidUser",
        socialLinksEnabled: true,
        socialLinks: [{ url: "https://line.me/R/ti/p/test", platform: "line", label: "LINE" }],
      })
    );
    await assertFails(
      setDoc(doc(user(), "events", "event_user_early_bird_addon_create"), {
        title: "User Early Bird Add-on",
        creatorUid: "uidUser",
        status: "upcoming",
        regOpenTime: "2099-01-01T10:00",
        earlyBirdEnabled: true,
        earlyBirdCost: 100,
      })
    );
    await assertFails(
      setDoc(doc(user(), "events", "event_user_gps_addon_create"), {
        title: "User GPS Add-on",
        creatorUid: "uidUser",
        gpsEnabled: true,
      })
    );
  });

  test("user can create upcoming and add-on events only when matching capabilities allow it", async () => {
    await assertSucceeds(
      setDoc(doc(user(), "events", "event_user_upcoming_create"), {
        title: "User Upcoming",
        creatorUid: "uidUser",
        status: "upcoming",
        regOpenTime: "2099-01-01T10:00",
      })
    );

    await seedRoleActivityCapabilities([
      ...DEFAULT_USER_ACTIVITY_CAPABILITIES,
      "user.activity.addons_use",
    ]);

    await assertSucceeds(
      setDoc(doc(user(), "events", "event_user_addon_allowed_create"), {
        title: "User Add-on Allowed",
        creatorUid: "uidUser",
        status: "open",
        feeEnabled: true,
        fee: 500,
        genderRestrictionEnabled: true,
        allowedGender: "女",
        privateEvent: true,
        socialLinksEnabled: true,
        socialLinks: [{ url: "https://line.me/R/ti/p/test", platform: "line", label: "LINE" }],
        earlyBirdEnabled: true,
        earlyBirdCost: 120,
        earlyBirdPolicyVersion: 1,
        gpsEnabled: true,
        lat: 25.026,
        lng: 121.543,
        mapAddress: "Test Field",
        mapProvider: "manual",
        mapLocationConfirmed: true,
        mapLocationUpdatedAt: "2026-05-18T00:00:00.000Z",
      })
    );

    await assertFails(
      setDoc(doc(user(), "events", "event_user_early_bird_cost_low"), {
        title: "User Early Bird Low Cost",
        creatorUid: "uidUser",
        status: "upcoming",
        regOpenTime: "2099-01-01T10:00",
        earlyBirdEnabled: true,
        earlyBirdCost: 5,
      })
    );

    await assertFails(
      setDoc(doc(user(), "events", "event_user_early_bird_cost_high"), {
        title: "User Early Bird High Cost",
        creatorUid: "uidUser",
        status: "upcoming",
        regOpenTime: "2099-01-01T10:00",
        earlyBirdEnabled: true,
        earlyBirdCost: 501,
      })
    );

    await assertFails(
      setDoc(doc(user(), "events", "event_user_team_scope_addon_denied"), {
        title: "User Team Scope Denied",
        creatorUid: "uidUser",
        status: "open",
        teamOnly: true,
        isPublic: true,
        creatorTeamId: "teamA",
        creatorTeamIds: ["teamA"],
      })
    );
  });

  test("user can create full frontend-shaped own event payload", async () => {
    await assertSucceeds(
      setDoc(doc(user(), "events", "ce_test_full_payload"), {
        id: "ce_test_full_payload",
        title: "Full Payload",
        type: "friendly",
        status: "open",
        location: "Test Field",
        date: "2099/01/02 10:00~12:00",
        startTimestamp: new Date("2099-01-02T10:00:00.000Z"),
        endTimestamp: new Date("2099-01-02T12:00:00.000Z"),
        fee: 0,
        feeEnabled: false,
        max: 20,
        current: 0,
        realCurrent: 0,
        waitlist: 0,
        minAge: 0,
        notes: "",
        image: "images/default.jpg",
        sportTag: "football",
        regOpenTime: null,
        creator: "General User",
        creatorUid: "uidUser",
        contact: "",
        gradient: "linear-gradient(135deg,#0d9488,#14b8a6)",
        icon: "",
        countdown: "",
        participants: [],
        waitlistNames: [],
        participantsWithUid: [],
        waitlistWithUid: [],
        teamOnly: false,
        isPublic: false,
        genderRestrictionEnabled: false,
        allowedGender: "",
        privateEvent: false,
        socialLinksEnabled: false,
        socialLinks: [],
        regionEnabled: true,
        region: "中部",
        cities: ["台中市"],
        creatorTeamId: null,
        creatorTeamName: null,
        creatorTeamIds: [],
        creatorTeamNames: [],
        delegates: [],
        delegateUids: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("event map fields require add-on capability and confirmed numeric coordinates", async () => {
    await assertFails(
      setDoc(doc(user(), "events", "event_user_map_create_without_addon"), {
        title: "User Map No Add-on",
        creatorUid: "uidUser",
        status: "open",
        location: "Test Field",
        gpsEnabled: true,
        lat: 25.026,
        lng: 121.543,
        mapAddress: "Test Field",
        mapProvider: "manual",
        mapLocationConfirmed: true,
        mapLocationUpdatedAt: "2026-05-18T00:00:00.000Z",
      })
    );

    await seedRoleActivityCapabilities([
      ...DEFAULT_USER_ACTIVITY_CAPABILITIES,
      "user.activity.addons_use",
    ]);

    await assertSucceeds(
      setDoc(doc(user(), "events", "event_user_map_create"), {
        title: "User Map",
        creatorUid: "uidUser",
        status: "open",
        location: "Test Field",
        gpsEnabled: true,
        lat: 25.026,
        lng: 121.543,
        mapAddress: "Test Field",
        mapProvider: "manual",
        mapLocationConfirmed: true,
        mapLocationUpdatedAt: "2026-05-18T00:00:00.000Z",
      })
    );

    await assertFails(
      setDoc(doc(user(), "events", "event_user_map_bad_lat"), {
        title: "Bad Lat",
        creatorUid: "uidUser",
        status: "open",
        gpsEnabled: true,
        lat: "25.026",
        lng: 121.543,
        mapLocationConfirmed: true,
      })
    );

    await assertFails(
      setDoc(doc(user(), "events", "event_user_map_missing_lng"), {
        title: "Missing Lng",
        creatorUid: "uidUser",
        status: "open",
        gpsEnabled: true,
        lat: 25.026,
        mapLocationConfirmed: true,
      })
    );

    await assertSucceeds(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        gpsEnabled: true,
        lat: 25.026,
        lng: 121.543,
        mapAddress: "Test Field",
        mapProvider: "manual",
        mapLocationConfirmed: true,
        mapLocationUpdatedAt: "2026-05-18T00:00:00.000Z",
      })
    );

    await assertFails(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        gpsEnabled: true,
        lat: 91,
        lng: 121.543,
        mapLocationConfirmed: true,
      })
    );

    await assertFails(
      updateDoc(doc(admin(), "events", "eventB"), {
        gpsEnabled: true,
        lat: 25.026,
        lng: 121.543,
        mapProvider: "unknown",
        mapLocationConfirmed: true,
      })
    );

    await assertSucceeds(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        gpsEnabled: false,
        lat: null,
        lng: null,
        mapAddress: null,
        mapPlaceId: null,
        mapProvider: null,
        mapLocationConfirmed: false,
        mapLocationUpdatedAt: null,
      })
    );
  });

  test("user can create full frontend-shaped private add-on event payload when add-ons capability is enabled", async () => {
    await seedRoleActivityCapabilities([
      ...DEFAULT_USER_ACTIVITY_CAPABILITIES,
      "user.activity.addons_use",
    ]);

    await assertSucceeds(
      setDoc(doc(user(), "events", "ce_test_full_private_addon_payload"), {
        id: "ce_test_full_private_addon_payload",
        title: "Private Payload",
        type: "friendly",
        status: "open",
        location: "Test Field",
        date: "2099/01/02 10:00~12:00",
        startTimestamp: new Date("2099-01-02T10:00:00.000Z"),
        endTimestamp: new Date("2099-01-02T12:00:00.000Z"),
        fee: 0,
        feeEnabled: false,
        max: 20,
        current: 0,
        realCurrent: 0,
        waitlist: 0,
        minAge: 0,
        notes: "",
        image: "images/default.jpg",
        sportTag: "football",
        regOpenTime: null,
        creator: "General User",
        creatorUid: "uidUser",
        contact: "",
        gradient: "linear-gradient(135deg,#0d9488,#14b8a6)",
        icon: "",
        countdown: "",
        participants: [],
        waitlistNames: [],
        participantsWithUid: [],
        waitlistWithUid: [],
        teamOnly: false,
        isPublic: false,
        genderRestrictionEnabled: false,
        allowedGender: "",
        privateEvent: true,
        socialLinksEnabled: false,
        socialLinks: [],
        regionEnabled: true,
        region: "central",
        cities: ["taichung"],
        creatorTeamId: null,
        creatorTeamName: null,
        creatorTeamIds: [],
        creatorTeamNames: [],
        delegates: [],
        delegateUids: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("user can create full frontend-shaped fee add-on event payload when add-ons capability is enabled", async () => {
    await seedRoleActivityCapabilities([
      ...DEFAULT_USER_ACTIVITY_CAPABILITIES,
      "user.activity.addons_use",
    ]);

    await assertSucceeds(
      setDoc(doc(user(), "events", "ce_test_full_fee_addon_payload"), {
        id: "ce_test_full_fee_addon_payload",
        title: "Fee Payload",
        type: "friendly",
        status: "open",
        location: "Test Field",
        date: "2099/01/02 10:00~12:00",
        startTimestamp: new Date("2099-01-02T10:00:00.000Z"),
        endTimestamp: new Date("2099-01-02T12:00:00.000Z"),
        fee: 200,
        feeEnabled: true,
        max: 20,
        current: 0,
        realCurrent: 0,
        waitlist: 0,
        minAge: 0,
        notes: "",
        image: "images/default.jpg",
        sportTag: "football",
        regOpenTime: null,
        creator: "General User",
        creatorUid: "uidUser",
        contact: "",
        gradient: "linear-gradient(135deg,#0d9488,#14b8a6)",
        icon: "",
        countdown: "",
        participants: [],
        waitlistNames: [],
        participantsWithUid: [],
        waitlistWithUid: [],
        teamOnly: false,
        isPublic: false,
        genderRestrictionEnabled: false,
        allowedGender: "",
        privateEvent: false,
        socialLinksEnabled: false,
        socialLinks: [],
        regionEnabled: true,
        region: "central",
        cities: ["taichung"],
        creatorTeamId: null,
        creatorTeamName: null,
        creatorTeamIds: [],
        creatorTeamNames: [],
        delegates: [],
        delegateUids: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("user can create full frontend-shaped gender add-on event payload when add-ons capability is enabled", async () => {
    await seedRoleActivityCapabilities([
      ...DEFAULT_USER_ACTIVITY_CAPABILITIES,
      "user.activity.addons_use",
    ]);

    await assertSucceeds(
      setDoc(doc(user(), "events", "ce_test_full_gender_addon_payload"), {
        id: "ce_test_full_gender_addon_payload",
        title: "Gender Payload",
        type: "friendly",
        status: "open",
        location: "Test Field",
        date: "2099/01/02 10:00~12:00",
        startTimestamp: new Date("2099-01-02T10:00:00.000Z"),
        endTimestamp: new Date("2099-01-02T12:00:00.000Z"),
        fee: 0,
        feeEnabled: false,
        max: 20,
        current: 0,
        realCurrent: 0,
        waitlist: 0,
        minAge: 0,
        notes: "",
        image: "images/default.jpg",
        sportTag: "football",
        regOpenTime: null,
        creator: "General User",
        creatorUid: "uidUser",
        contact: "",
        gradient: "linear-gradient(135deg,#0d9488,#14b8a6)",
        icon: "",
        countdown: "",
        participants: [],
        waitlistNames: [],
        participantsWithUid: [],
        waitlistWithUid: [],
        teamOnly: false,
        isPublic: false,
        genderRestrictionEnabled: true,
        allowedGender: "female",
        privateEvent: false,
        socialLinksEnabled: false,
        socialLinks: [],
        regionEnabled: true,
        region: "central",
        cities: ["taichung"],
        creatorTeamId: null,
        creatorTeamName: null,
        creatorTeamIds: [],
        creatorTeamNames: [],
        delegates: [],
        delegateUids: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("user can create full frontend-shaped team split add-on event payload when add-ons capability is enabled", async () => {
    await seedRoleActivityCapabilities([
      ...DEFAULT_USER_ACTIVITY_CAPABILITIES,
      "user.activity.addons_use",
    ]);

    await assertSucceeds(
      setDoc(doc(user(), "events", "ce_test_full_team_split_addon_payload"), {
        id: "ce_test_full_team_split_addon_payload",
        title: "Split Payload",
        type: "friendly",
        status: "open",
        location: "Test Field",
        date: "2099/01/02 10:00~12:00",
        startTimestamp: new Date("2099-01-02T10:00:00.000Z"),
        endTimestamp: new Date("2099-01-02T12:00:00.000Z"),
        fee: 0,
        feeEnabled: false,
        max: 20,
        current: 0,
        realCurrent: 0,
        waitlist: 0,
        minAge: 0,
        notes: "",
        image: "images/default.jpg",
        sportTag: "football",
        regOpenTime: null,
        creator: "General User",
        creatorUid: "uidUser",
        contact: "",
        gradient: "linear-gradient(135deg,#0d9488,#14b8a6)",
        icon: "",
        countdown: "",
        participants: [],
        waitlistNames: [],
        participantsWithUid: [],
        waitlistWithUid: [],
        teamOnly: false,
        isPublic: false,
        genderRestrictionEnabled: false,
        allowedGender: "",
        privateEvent: false,
        teamSplit: {
          enabled: true,
          mode: "random",
          balanceCap: true,
          selfSelectLockHours: 0,
          lockAt: null,
          teams: [
            { key: "A", color: "#ef4444", name: "Red" },
            { key: "B", color: "#3b82f6", name: "Blue" },
          ],
        },
        socialLinksEnabled: false,
        socialLinks: [],
        regionEnabled: true,
        region: "central",
        cities: ["taichung"],
        creatorTeamId: null,
        creatorTeamName: null,
        creatorTeamIds: [],
        creatorTeamNames: [],
        delegates: [],
        delegateUids: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("user can create full frontend-shaped combined non-team add-ons payload when add-ons capability is enabled", async () => {
    await seedRoleActivityCapabilities([
      ...DEFAULT_USER_ACTIVITY_CAPABILITIES,
      "user.activity.addons_use",
    ]);

    await assertSucceeds(
      setDoc(doc(user(), "events", "ce_test_full_combined_addons_payload"), {
        id: "ce_test_full_combined_addons_payload",
        title: "Combined Payload",
        type: "friendly",
        status: "open",
        location: "Test Field",
        date: "2099/01/02 10:00~12:00",
        startTimestamp: new Date("2099-01-02T10:00:00.000Z"),
        endTimestamp: new Date("2099-01-02T12:00:00.000Z"),
        fee: 200,
        feeEnabled: true,
        max: 20,
        current: 0,
        realCurrent: 0,
        waitlist: 0,
        minAge: 0,
        notes: "",
        image: "images/default.jpg",
        sportTag: "football",
        regOpenTime: null,
        creator: "General User",
        creatorUid: "uidUser",
        contact: "",
        gradient: "linear-gradient(135deg,#0d9488,#14b8a6)",
        icon: "",
        countdown: "",
        participants: [],
        waitlistNames: [],
        participantsWithUid: [],
        waitlistWithUid: [],
        teamOnly: false,
        isPublic: false,
        genderRestrictionEnabled: true,
        allowedGender: "female",
        privateEvent: true,
        teamSplit: {
          enabled: true,
          mode: "random",
          balanceCap: true,
          selfSelectLockHours: 0,
          lockAt: null,
          teams: [
            { key: "A", color: "#ef4444", name: "Red" },
            { key: "B", color: "#3b82f6", name: "Blue" },
          ],
        },
        socialLinksEnabled: true,
        socialLinks: [
          { url: "https://line.me/R/ti/p/test", platform: "line", label: "LINE" },
          { url: "https://instagram.com/toosterx", platform: "instagram", label: "Instagram" },
        ],
        regionEnabled: true,
        region: "central",
        cities: ["taichung"],
        creatorTeamId: null,
        creatorTeamName: null,
        creatorTeamIds: [],
        creatorTeamNames: [],
        delegates: [],
        delegateUids: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("user basic event creation requires safe initial status and empty projection fields", async () => {
    await assertFails(
      setDoc(doc(user(), "events", "event_user_bad_status_create"), {
        title: "Bad Status",
        creatorUid: "uidUser",
        status: "cancelled",
      })
    );
    await assertFails(
      setDoc(doc(user(), "events", "event_user_bad_projection_create"), {
        title: "Bad Projection",
        creatorUid: "uidUser",
        current: 9,
        participants: ["spoofed"],
      })
    );
  });

  test("user create delegate fields require delegate_assign when non-empty", async () => {
    await seedRoleActivityCapabilities(
      DEFAULT_USER_ACTIVITY_CAPABILITIES.filter((code) => code !== "user.activity.delegate_assign")
    );
    await assertSucceeds(
      setDoc(doc(user(), "events", "event_user_empty_delegates_create"), {
        title: "Empty Delegates",
        creatorUid: "uidUser",
        delegates: [],
        delegateUids: [],
      })
    );
    await assertFails(
      setDoc(doc(user(), "events", "event_user_delegates_denied_create"), {
        title: "Delegates Denied",
        creatorUid: "uidUser",
        delegates: [{ uid: "uidDelegate" }],
        delegateUids: ["uidDelegate"],
      })
    );
  });

  test("user external activity creation follows roleActivityCapabilities", async () => {
    await assertSucceeds(
      setDoc(doc(user(), "events", "event_user_external_create"), {
        title: "External OK",
        creatorUid: "uidUser",
        type: "external",
      })
    );

    await seedRoleActivityCapabilities(
      DEFAULT_USER_ACTIVITY_CAPABILITIES.filter((code) => code !== "user.activity.external_create")
    );
    await assertFails(
      setDoc(doc(user(), "events", "event_user_external_denied"), {
        title: "External Denied",
        creatorUid: "uidUser",
        type: "external",
      })
    );
  });

  test("user owner can edit basic fields and cancel own event, but cannot update add-ons without add-ons capability", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        title: "User Event Updated",
      })
    );
    await assertSucceeds(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        image: "https://cdn.example.com/events/eventUserOwn_cover.webp",
        imageVariants: {
          cover: "https://cdn.example.com/events/eventUserOwn_cover.webp",
          homeNext: "https://cdn.example.com/events/eventUserOwn_home_next.webp",
        },
      })
    );
    await assertSucceeds(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        status: "cancelled",
      })
    );
    await assertFails(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        feeEnabled: true,
      })
    );
    await assertFails(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        teamSplit: { enabled: true, mode: "random" },
      })
    );
    await assertFails(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        socialLinksEnabled: true,
        socialLinks: [{ url: "https://instagram.com/toosterx", platform: "instagram", label: "Instagram" }],
      })
    );
  });

  test("user owner can edit non-team add-ons when add-ons capability is enabled", async () => {
    await seedRoleActivityCapabilities([
      ...DEFAULT_USER_ACTIVITY_CAPABILITIES,
      "user.activity.addons_use",
    ]);
    await seedDoc("events", "event_user_addon_edit_allowed", {
      id: "event_user_addon_edit_allowed",
      title: "User Add-on Edit",
      creatorUid: "uidUser",
      ownerUid: "uidUser",
      captainUid: "uidUser",
      status: "open",
      current: 0,
      max: 20,
      teamOnly: false,
      isPublic: false,
      creatorTeamId: null,
      creatorTeamName: null,
      creatorTeamIds: [],
      creatorTeamNames: [],
    });

    await assertSucceeds(
      updateDoc(doc(user(), "events", "event_user_addon_edit_allowed"), {
        feeEnabled: true,
        fee: 200,
        genderRestrictionEnabled: true,
        allowedGender: "female",
        privateEvent: true,
        teamSplit: {
          enabled: true,
          mode: "random",
          balanceCap: true,
          selfSelectLockHours: 0,
          lockAt: null,
          teams: [
            { key: "A", color: "#ef4444", name: "Red" },
            { key: "B", color: "#3b82f6", name: "Blue" },
          ],
        },
        socialLinksEnabled: true,
        socialLinks: [{ url: "https://instagram.com/toosterx", platform: "instagram", label: "Instagram" }],
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(doc(user(), "events", "event_user_addon_edit_allowed"), {
        teamOnly: true,
        isPublic: true,
        creatorTeamId: "teamA",
        creatorTeamIds: ["teamA"],
      })
    );
  });

  test("user delegate cannot edit add-ons even when add-ons capability is enabled", async () => {
    await seedRoleActivityCapabilities([
      ...DEFAULT_USER_ACTIVITY_CAPABILITIES,
      "user.activity.addons_use",
    ]);
    await seedDoc("events", "event_user_delegate_addon_denied", {
      id: "event_user_delegate_addon_denied",
      title: "Delegate Add-on Denied",
      creatorUid: "uidOwner",
      ownerUid: "uidOwner",
      captainUid: "uidOwner",
      delegateUids: ["uidUser"],
      delegates: [{ uid: "uidUser", name: "General User" }],
      status: "open",
    });

    await assertSucceeds(
      updateDoc(doc(user(), "events", "event_user_delegate_addon_denied"), {
        title: "Delegate Basic Updated",
      })
    );
    await assertFails(
      updateDoc(doc(user(), "events", "event_user_delegate_addon_denied"), {
        feeEnabled: true,
        fee: 200,
      })
    );
  });

  test("user delegate can manage assigned event basics and cancel but cannot change delegate list", async () => {
    await seedDoc("events", "event_user_delegate_manage", {
      id: "event_user_delegate_manage",
      title: "Delegate Managed",
      creatorUid: "uidOwner",
      ownerUid: "uidOwner",
      captainUid: "uidOwner",
      delegateUids: ["uidDelegate"],
      delegates: [{ uid: "uidDelegate", name: "Delegate" }],
      status: "open",
      current: 1,
      max: 3,
    });

    await assertSucceeds(
      updateDoc(doc(roleContext("uidDelegate", "user"), "events", "event_user_delegate_manage"), {
        title: "Delegate Updated",
      })
    );
    await assertSucceeds(
      updateDoc(doc(roleContext("uidDelegate", "user"), "events", "event_user_delegate_manage"), {
        status: "cancelled",
      })
    );
    await assertFails(
      updateDoc(doc(roleContext("uidDelegate", "user"), "events", "event_user_delegate_manage"), {
        delegates: [{ uid: "uidDelegate" }, { uid: "uidRandom" }],
        delegateUids: ["uidDelegate", "uidRandom"],
      })
    );
    await assertFails(
      updateDoc(doc(roleContext("uidRandom", "user"), "events", "event_user_delegate_manage"), {
        title: "Random Updated",
      })
    );
  });

  test("user owner cannot lower capacity below current participant count", async () => {
    await seedDoc("events", "eventUserOwn", {
      id: "eventUserOwn",
      title: "User Event",
      creatorUid: "uidUser",
      ownerUid: "uidUser",
      captainUid: "uidUser",
      status: "open",
      current: 5,
      max: 8,
    });

    await assertFails(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        max: 4,
      })
    );
    await assertFails(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        max: "5",
      })
    );
    await assertSucceeds(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        max: 5,
      })
    );
  });

  test("user owner can edit externalUrl and combine basic edit with delegate assignment when allowed", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        title: "User Event With Delegate",
        externalUrl: "https://example.com/activity",
        delegates: [{ uid: "uidDelegate" }],
        delegateUids: ["uidDelegate"],
      })
    );
  });

  test("user owner basic edit can be disabled through roleActivityCapabilities", async () => {
    await seedRoleActivityCapabilities(
      DEFAULT_USER_ACTIVITY_CAPABILITIES.filter((code) => code !== "user.activity.own_edit_basic")
    );
    await assertFails(
      updateDoc(doc(user(), "events", "eventUserOwn"), {
        title: "Denied Update",
      })
    );
  });

  test("user owner needs site_operate but explicit delegate can promote waitlisted registrations", async () => {
    await seedDoc("events", "event_user_operator", {
      id: "event_user_operator",
      title: "User Operator",
      creatorUid: "uidUser",
      delegateUids: ["uidDelegate"],
      status: "open",
    });
    await seedDoc("registrations", "reg_wait_owner", {
      id: "reg_wait_owner",
      eventId: "event_user_operator",
      userId: "uidA",
      status: "waitlisted",
    });
    await assertSucceeds(
      updateDoc(doc(user(), "registrations", "reg_wait_owner"), {
        status: "confirmed",
      })
    );

    await seedDoc("registrations", "reg_wait_delegate", {
      id: "reg_wait_delegate",
      eventId: "event_user_operator",
      userId: "uidB",
      status: "waitlisted",
    });
    await assertSucceeds(
      updateDoc(doc(roleContext("uidDelegate", "user"), "registrations", "reg_wait_delegate"), {
        status: "confirmed",
      })
    );

    await seedDoc("registrations", "reg_wait_random", {
      id: "reg_wait_random",
      eventId: "event_user_operator",
      userId: "uidB",
      status: "waitlisted",
    });
    await assertFails(
      updateDoc(doc(roleContext("uidRandom", "user"), "registrations", "reg_wait_random"), {
        status: "confirmed",
      })
    );

    await seedRoleActivityCapabilities(
      DEFAULT_USER_ACTIVITY_CAPABILITIES.filter((code) => code !== "user.activity.site_operate")
    );
    await seedDoc("registrations", "reg_wait_cap_disabled", {
      id: "reg_wait_cap_disabled",
      eventId: "event_user_operator",
      userId: "uidA",
      status: "waitlisted",
    });
    await assertFails(
      updateDoc(doc(user(), "registrations", "reg_wait_cap_disabled"), {
        status: "confirmed",
      })
    );
    await seedDoc("registrations", "reg_wait_delegate_cap_disabled", {
      id: "reg_wait_delegate_cap_disabled",
      eventId: "event_user_operator",
      userId: "uidB",
      status: "waitlisted",
    });
    await assertSucceeds(
      updateDoc(doc(roleContext("uidDelegate", "user"), "registrations", "reg_wait_delegate_cap_disabled"), {
        status: "confirmed",
      })
    );
  });

  test("user owner/delegate can demote and remove registrations only when assigned site_operate is enabled", async () => {
    await seedDoc("events", "event_user_roster_delegate", {
      id: "event_user_roster_delegate",
      title: "Roster Delegate",
      creatorUid: "uidUser",
      delegateUids: ["uidDelegate"],
      status: "open",
    });
    await seedPath(["events", "event_user_roster_delegate", "registrations", "reg_confirmed"], {
      id: "reg_confirmed",
      eventId: "event_user_roster_delegate",
      userId: "uidA",
      status: "confirmed",
    });
    await seedPath(["events", "event_user_roster_delegate", "registrations", "reg_waitlisted"], {
      id: "reg_waitlisted",
      eventId: "event_user_roster_delegate",
      userId: "uidB",
      status: "waitlisted",
    });
    await seedPath(["events", "event_user_roster_delegate", "registrations", "reg_random_confirmed"], {
      id: "reg_random_confirmed",
      eventId: "event_user_roster_delegate",
      userId: "uidC",
      status: "confirmed",
    });

    await assertSucceeds(
      updateDoc(doc(roleContext("uidDelegate", "user"), "events", "event_user_roster_delegate", "registrations", "reg_confirmed"), {
        status: "waitlisted",
      })
    );
    await assertSucceeds(
      updateDoc(doc(roleContext("uidDelegate", "user"), "events", "event_user_roster_delegate", "registrations", "reg_waitlisted"), {
        status: "removed",
        removedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(roleContext("uidRandom", "user"), "events", "event_user_roster_delegate", "registrations", "reg_random_confirmed"), {
        status: "removed",
        removedAt: serverTimestamp(),
      })
    );

    await seedRoleActivityCapabilities(
      DEFAULT_USER_ACTIVITY_CAPABILITIES.filter((code) => code !== "user.activity.site_operate")
    );
    await seedPath(["events", "event_user_roster_delegate", "registrations", "reg_disabled_confirmed"], {
      id: "reg_disabled_confirmed",
      eventId: "event_user_roster_delegate",
      userId: "uidD",
      status: "confirmed",
    });
    await assertFails(
      updateDoc(doc(roleContext("uidDelegate", "user"), "events", "event_user_roster_delegate", "registrations", "reg_disabled_confirmed"), {
        status: "waitlisted",
      })
    );
  });

  test("user owner attendance writes require site_operate but explicit delegate can write attendance", async () => {
    await seedDoc("events", "event_user_attendance", {
      id: "event_user_attendance",
      title: "User Attendance",
      creatorUid: "uidUser",
      delegateUids: ["uidDelegate"],
      status: "open",
    });
    await seedPath(["events", "event_user_attendance", "attendanceRecords", "att_existing"], {
      eventId: "event_user_attendance",
      uid: "uidA",
      type: "checkin",
      status: "active",
    });

    await assertSucceeds(
      setDoc(doc(user(), "events", "event_user_attendance", "attendanceRecords", "att_owner"), {
        eventId: "event_user_attendance",
        uid: "uidA",
        type: "checkin",
      })
    );
    await assertSucceeds(
      setDoc(doc(roleContext("uidDelegate", "user"), "events", "event_user_attendance", "attendanceRecords", "att_delegate"), {
        eventId: "event_user_attendance",
        uid: "uidB",
        type: "checkout",
      })
    );
    await assertSucceeds(
      updateDoc(doc(user(), "events", "event_user_attendance", "attendanceRecords", "att_existing"), {
        status: "removed",
      })
    );
    await assertFails(
      setDoc(doc(roleContext("uidRandom", "user"), "events", "event_user_attendance", "attendanceRecords", "att_random"), {
        eventId: "event_user_attendance",
        uid: "uidA",
        type: "checkin",
      })
    );
    await assertFails(
      setDoc(doc(user(), "events", "event_user_attendance", "attendanceRecords", "att_wrong_event"), {
        eventId: "other_event",
        uid: "uidA",
        type: "checkin",
      })
    );

    await seedRoleActivityCapabilities(
      DEFAULT_USER_ACTIVITY_CAPABILITIES.filter((code) => code !== "user.activity.site_operate")
    );
    await assertFails(
      setDoc(doc(user(), "events", "event_user_attendance", "attendanceRecords", "att_owner_disabled"), {
        eventId: "event_user_attendance",
        uid: "uidA",
        type: "checkin",
      })
    );
    await assertSucceeds(
      setDoc(doc(roleContext("uidDelegate", "user"), "events", "event_user_attendance", "attendanceRecords", "att_delegate_disabled"), {
        eventId: "event_user_attendance",
        uid: "uidB",
        type: "checkout",
      })
    );
    await assertFails(
      updateDoc(doc(user(), "events", "event_user_attendance", "attendanceRecords", "att_existing"), {
        status: "removed",
      })
    );
    await assertSucceeds(
      updateDoc(doc(roleContext("uidDelegate", "user"), "events", "event_user_attendance", "attendanceRecords", "att_existing"), {
        status: "removed",
      })
    );
    await assertFails(
      setDoc(doc(coach(), "events", "event_user_attendance", "attendanceRecords", "att_coach"), {
        eventId: "event_user_attendance",
        uid: "uidCoach",
        type: "checkin",
      })
    );
  });

  test("admin-below activity managers cannot operate non-owned private events", async () => {
    await seedDoc("events", "event_private_other", {
      id: "event_private_other",
      title: "Private Other",
      creatorUid: "uidA",
      privateEvent: true,
      status: "open",
    });
    await seedDoc("events", "event_private_coach_own", {
      id: "event_private_coach_own",
      title: "Private Coach Own",
      creatorUid: "uidCoach",
      privateEvent: true,
      status: "open",
    });
    await seedDoc("events", "event_private_owner_uid_only", {
      id: "event_private_owner_uid_only",
      title: "Private Owner UID",
      creatorUid: "uidA",
      ownerUid: "uidCoach",
      privateEvent: true,
      status: "open",
    });
    await seedDoc("events", "event_private_captain_uid_only", {
      id: "event_private_captain_uid_only",
      title: "Private Captain UID",
      creatorUid: "uidA",
      captainUid: "uidCoach",
      privateEvent: true,
      status: "open",
    });
    await seedDoc("events", "event_private_delegated", {
      id: "event_private_delegated",
      title: "Private Delegated",
      creatorUid: "uidA",
      delegateUids: ["uidCoach"],
      privateEvent: true,
      status: "open",
    });
    await seedRolePermissions("manager", ["activity.manage.entry", "event.edit_all"]);

    const belowAdminManagers = [
      ["coach", coach()],
      ["captain", captain()],
      ["venue_owner", venueOwner()],
      ["manager", manager()],
    ];

    for (const [role, db] of belowAdminManagers) {
      await assertFails(
        updateDoc(doc(db, "events", "event_private_other"), {
          title: `Private Other Updated By ${role}`,
        })
      );
      await assertFails(
        setDoc(doc(db, "events", "event_private_other", "attendanceRecords", `att_${role}`), {
          eventId: "event_private_other",
          uid: `uid_${role}`,
          type: "checkin",
        })
      );
    }

    await assertFails(
      updateDoc(doc(coach(), "events", "eventA"), {
        privateEvent: true,
      })
    );
    await assertFails(
      updateDoc(doc(coach(), "events", "eventB"), {
        title: "Public Other Updated By Coach",
      })
    );
    await assertSucceeds(
      updateDoc(doc(coach(), "events", "event_private_coach_own"), {
        title: "Private Coach Own Updated",
      })
    );
    await assertSucceeds(
      updateDoc(doc(coach(), "events", "event_private_owner_uid_only"), {
        title: "Private Owner UID Updated",
      })
    );
    await assertSucceeds(
      updateDoc(doc(coach(), "events", "event_private_captain_uid_only"), {
        title: "Private Captain UID Updated",
      })
    );
    await assertSucceeds(
      updateDoc(doc(coach(), "events", "event_private_delegated"), {
        title: "Private Delegated Updated",
      })
    );
    await assertSucceeds(
      setDoc(doc(coach(), "events", "event_private_coach_own", "attendanceRecords", "att_coach_own_private"), {
        eventId: "event_private_coach_own",
        uid: "uidA",
        type: "checkin",
      })
    );
    await assertSucceeds(
      setDoc(doc(coach(), "events", "event_private_owner_uid_only", "attendanceRecords", "att_owner_uid_private"), {
        eventId: "event_private_owner_uid_only",
        uid: "uidA",
        type: "checkin",
      })
    );
    await assertSucceeds(
      setDoc(doc(coach(), "events", "event_private_captain_uid_only", "attendanceRecords", "att_captain_uid_private"), {
        eventId: "event_private_captain_uid_only",
        uid: "uidA",
        type: "checkin",
      })
    );
    await assertSucceeds(
      setDoc(doc(coach(), "events", "event_private_delegated", "attendanceRecords", "att_coach_delegate_private"), {
        eventId: "event_private_delegated",
        uid: "uidB",
        type: "checkin",
      })
    );
    await assertSucceeds(
      updateDoc(doc(admin(), "events", "event_private_other"), {
        title: "Private Other Updated By Admin",
      })
    );
    await assertSucceeds(
      setDoc(doc(admin(), "events", "event_private_other", "attendanceRecords", "att_admin_private"), {
        eventId: "event_private_other",
        uid: "uidAdmin",
        type: "checkin",
      })
    );
  });

  test("subcollection activity record writes are limited to participant owner or event operator", async () => {
    await seedDoc("events", "event_user_activity_record", {
      id: "event_user_activity_record",
      title: "User Activity Record",
      creatorUid: "uidUser",
      delegateUids: ["uidDelegate"],
      status: "open",
    });
    await seedPath(["events", "event_user_activity_record", "activityRecords", "act_existing"], {
      eventId: "event_user_activity_record",
      uid: "uidA",
      status: "registered",
    });

    await assertSucceeds(
      setDoc(doc(memberA(), "events", "event_user_activity_record", "activityRecords", "act_self"), {
        eventId: "event_user_activity_record",
        uid: "uidA",
        status: "registered",
      })
    );
    await assertFails(
      setDoc(doc(memberB(), "events", "event_user_activity_record", "activityRecords", "act_spoof"), {
        eventId: "event_user_activity_record",
        uid: "uidA",
        status: "registered",
      })
    );
    await assertSucceeds(
      setDoc(doc(user(), "events", "event_user_activity_record", "activityRecords", "act_operator"), {
        eventId: "event_user_activity_record",
        uid: "uidB",
        status: "registered",
      })
    );
    await assertFails(
      updateDoc(doc(roleContext("uidRandom", "user"), "events", "event_user_activity_record", "activityRecords", "act_existing"), {
        status: "removed",
      })
    );
    await assertSucceeds(
      updateDoc(doc(user(), "events", "event_user_activity_record", "activityRecords", "act_existing"), {
        status: "removed",
      })
    );

    await seedRoleActivityCapabilities(
      DEFAULT_USER_ACTIVITY_CAPABILITIES.filter((code) => code !== "user.activity.site_operate")
    );
    await seedPath(["events", "event_user_activity_record", "activityRecords", "act_disabled"], {
      eventId: "event_user_activity_record",
      uid: "uidB",
      status: "registered",
    });
    await assertFails(
      updateDoc(doc(user(), "events", "event_user_activity_record", "activityRecords", "act_disabled"), {
        status: "removed",
      })
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

  test("private course-linked events allow ordinary client-owned registration locks", async () => {
    await seedDoc("events", "event_course_private", {
      id: "event_course_private",
      title: "Course Private",
      creatorUid: "uidA",
      privateEvent: true,
      courseLinked: true,
      courseLinkSource: "eduCourseLesson",
      courseLinkId: "opaque_link_1",
      status: "open",
    });

    await assertSucceeds(
      setDoc(doc(memberA(), "events", "event_course_private", "registrationLocks", "self_uidA"), {
        key: "self_uidA",
        eventId: "event_course_private",
        userId: "uidA",
        participantType: "self",
        companionId: null,
        registrationDocId: "regA",
        status: "active",
      })
    );

    await seedPath(["events", "event_course_private", "registrationLocks", "self_uidA"], {
      key: "self_uidA",
      eventId: "event_course_private",
      userId: "uidA",
      participantType: "self",
      companionId: null,
      registrationDocId: "regA",
      status: "active",
    });
    await assertSucceeds(deleteDoc(doc(memberA(), "events", "event_course_private", "registrationLocks", "self_uidA")));
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

  test("root course-linked registrations cannot be client-created, cancelled, or deleted", async () => {
    await seedDoc("events", "event_course_public", {
      id: "event_course_public",
      title: "Course Public",
      creatorUid: "uidA",
      privateEvent: false,
      courseLinked: true,
      courseLinkSource: "eduCourseLesson",
      courseLinkId: "opaque_link_2",
      status: "open",
    });

    await assertFails(
      setDoc(doc(memberA(), "registrations", "reg_course_create"), {
        eventId: "event_course_public",
        userId: "uidA",
        status: "confirmed",
        source: "eduCourseLesson",
        courseLinkState: "created_by_course",
      })
    );

    await seedDoc("registrations", "reg_course_existing", {
      eventId: "event_course_public",
      userId: "uidA",
      status: "confirmed",
      courseLinkState: "created_by_course",
      coursePriority: true,
    });
    await assertFails(
      updateDoc(doc(memberA(), "registrations", "reg_course_existing"), {
        status: "cancelled",
      })
    );
    await assertFails(deleteDoc(doc(memberA(), "registrations", "reg_course_existing")));
  });

  test("private course-linked events allow ordinary root registration writes without provenance fields", async () => {
    await seedDoc("events", "event_course_private", {
      id: "event_course_private",
      title: "Course Private",
      creatorUid: "uidA",
      privateEvent: true,
      courseLinked: true,
      courseLinkSource: "eduCourseLesson",
      courseLinkId: "opaque_link_3",
      status: "open",
    });

    await assertSucceeds(
      setDoc(doc(memberA(), "registrations", "reg_course_private_create"), {
        eventId: "event_course_private",
        userId: "uidA",
        status: "confirmed",
      })
    );
    await assertFails(
      setDoc(doc(memberA(), "registrations", "reg_course_private_course_owned"), {
        eventId: "event_course_private",
        userId: "uidA",
        status: "confirmed",
        source: "eduCourseLesson",
        courseLinkState: "created_by_course",
      })
    );

    await seedDoc("registrations", "reg_course_private_existing", {
      eventId: "event_course_private",
      userId: "uidA",
      status: "confirmed",
    });
    await assertSucceeds(
      updateDoc(doc(memberA(), "registrations", "reg_course_private_existing"), {
        status: "cancelled",
      })
    );
    await seedDoc("registrations", "reg_course_private_existing", {
      eventId: "event_course_private",
      userId: "uidA",
      status: "confirmed",
    });
    await assertSucceeds(deleteDoc(doc(memberA(), "registrations", "reg_course_private_existing")));
  });
});

describe("course-linked event direct write guards", () => {
  test("clients cannot create course-linked event roots directly", async () => {
    await assertFails(
      setDoc(doc(user(), "events", "event_course_fake_user"), {
        title: "Fake Course Event",
        creatorUid: "uidUser",
        status: "open",
        courseLinked: true,
        courseLinkSource: "eduCourseLesson",
        courseLinkId: "fake_link_user",
      })
    );
    await assertFails(
      setDoc(doc(admin(), "events", "event_course_fake_admin"), {
        title: "Fake Course Event Admin",
        creatorUid: "uidAdmin",
        status: "open",
        courseLinked: true,
        courseLinkId: "fake_link_admin",
      })
    );
    await assertFails(
      setDoc(doc(superAdmin(), "events", "event_course_fake_super"), {
        title: "Fake Course Event Super",
        creatorUid: "uidSA",
        status: "open",
        courseLinked: true,
      })
    );
    await assertFails(
      setDoc(doc(superAdmin(), "events", "event_course_fake_link_only"), {
        title: "Fake Course Event Link Only",
        creatorUid: "uidSA",
        status: "open",
        courseLinkSource: "eduCourseLesson",
        courseLinkId: "fake_link_only",
      })
    );
  });

  test("single-event scan permission matches callable and UI event scope", async () => {
    await seedRoleActivityCapabilities([]);
    await seedUserPermissionGrant("uidA", ["event.scan"]);
    await seedDoc("events", "event_scan_grant_owned_private", {
      id: "event_scan_grant_owned_private",
      title: "Scan Grant Owned Private",
      creatorUid: "uidOther",
      ownerUid: "uidA",
      privateEvent: true,
      status: "open",
    });
    await seedDoc("events", "event_scan_grant_unrelated", {
      id: "event_scan_grant_unrelated",
      title: "Scan Grant Unrelated",
      creatorUid: "uidOther",
      ownerUid: "uidOther",
      privateEvent: false,
      status: "open",
    });

    await assertSucceeds(
      setDoc(doc(memberA(), "events", "event_scan_grant_owned_private", "attendanceRecords", "att_scan_owned"), {
        eventId: "event_scan_grant_owned_private",
        uid: "uidB",
        type: "checkin",
      })
    );
    await assertFails(
      setDoc(doc(memberA(), "events", "event_scan_grant_unrelated", "attendanceRecords", "att_scan_unrelated"), {
        eventId: "event_scan_grant_unrelated",
        uid: "uidB",
        type: "checkin",
      })
    );
  });

  test("course-linked event owner staff can toggle visibility fields only", async () => {
    await seedDoc("events", "event_course_visibility", {
      id: "event_course_visibility",
      title: "Course Visibility",
      type: "friendly",
      location: "Course Court",
      date: "2099/01/02 10:00~12:00",
      startTimestamp: new Date("2099-01-02T02:00:00.000Z"),
      endTimestamp: new Date("2099-01-02T04:00:00.000Z"),
      fee: 0,
      feeEnabled: false,
      max: 10,
      minAge: 0,
      notes: "",
      image: null,
      sportTag: "football",
      regOpenTime: null,
      gradient: "linear-gradient(135deg,#0d9488,#065f46)",
      teamOnly: false,
      genderRestrictionEnabled: false,
      allowedGender: "",
      privateEvent: true,
      isPublic: false,
      socialLinksEnabled: false,
      socialLinks: [],
      earlyBirdEnabled: false,
      earlyBirdCost: 0,
      earlyBirdPolicyVersion: null,
      regionEnabled: false,
      region: "",
      cities: [],
      creatorTeamId: null,
      creatorTeamName: null,
      creatorTeamIds: [],
      creatorTeamNames: [],
      delegates: [],
      delegateUids: [],
      gpsEnabled: false,
      lat: null,
      lng: null,
      mapAddress: null,
      mapPlaceId: null,
      mapProvider: null,
      mapLocationConfirmed: false,
      mapLocationUpdatedAt: null,
      creatorUid: "uidCoach",
      ownerUid: "uidCoach",
      courseLinked: true,
      courseLinkSource: "eduCourseLesson",
      courseLinkId: "opaque_link_visibility",
      status: "open",
    });
    const editModalVisibilityPayload = {
      title: "Course Visibility",
      type: "friendly",
      location: "Course Court",
      date: "2099/01/02 10:00~12:00",
      startTimestamp: new Date("2099-01-02T02:00:00.000Z"),
      endTimestamp: new Date("2099-01-02T04:00:00.000Z"),
      fee: 0,
      feeEnabled: false,
      max: 10,
      minAge: 0,
      notes: "",
      image: null,
      sportTag: "football",
      regOpenTime: null,
      gradient: "linear-gradient(135deg,#0d9488,#065f46)",
      teamOnly: false,
      genderRestrictionEnabled: false,
      allowedGender: "",
      privateEvent: false,
      isPublic: true,
      socialLinksEnabled: false,
      socialLinks: [],
      earlyBirdEnabled: false,
      earlyBirdCost: 0,
      earlyBirdPolicyVersion: null,
      regionEnabled: false,
      region: "",
      cities: [],
      creatorTeamId: null,
      creatorTeamName: null,
      creatorTeamIds: [],
      creatorTeamNames: [],
      delegates: [],
      delegateUids: [],
      gpsEnabled: false,
      lat: null,
      lng: null,
      mapAddress: null,
      mapPlaceId: null,
      mapProvider: null,
      mapLocationConfirmed: false,
      mapLocationUpdatedAt: null,
      updatedAt: serverTimestamp(),
    };

    const delegatePayload = {
      delegates: [{ uid: "uidDelegate", name: "Delegate" }],
      delegateUids: ["uidDelegate"],
      updatedAt: serverTimestamp(),
    };
    await assertSucceeds(
      updateDoc(doc(coach(), "events", "event_course_visibility"), delegatePayload)
    );
    await assertFails(
      updateDoc(doc(memberA(), "events", "event_course_visibility"), {
        delegates: [{ uid: "uidA", name: "Member A" }],
        delegateUids: ["uidA"],
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(user("uidDelegate"), "events", "event_course_visibility"), {
        delegates: [{ uid: "uidDelegate", name: "Delegate" }, { uid: "uidRandom", name: "Random" }],
        delegateUids: ["uidDelegate", "uidRandom"],
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(coach(), "events", "event_course_visibility"), {
        ...delegatePayload,
        courseLinkId: "tampered_link",
      })
    );

    await assertFails(
      updateDoc(doc(memberA(), "events", "event_course_visibility"), editModalVisibilityPayload)
    );
    await assertSucceeds(
      updateDoc(doc(superAdmin(), "events", "event_course_visibility"), editModalVisibilityPayload)
    );
    await assertSucceeds(
      updateDoc(doc(coach(), "events", "event_course_visibility"), editModalVisibilityPayload)
    );
    await assertFails(
      updateDoc(doc(coach(), "events", "event_course_visibility"), {
        isPublic: false,
        courseLinkId: "tampered_link",
      })
    );
  });
  test("clients cannot edit course-linked events directly; managers can cancel and authorized roles can delete", async () => {
    await seedDoc("events", "event_course_lifecycle", {
      id: "event_course_lifecycle",
      title: "Course Lifecycle",
      creatorUid: "uidUser",
      ownerUid: "uidUser",
      privateEvent: false,
      courseLinked: true,
      courseLinkSource: "eduCourseLesson",
      courseLinkId: "opaque_link_5",
      status: "open",
      current: 0,
      realCurrent: 0,
      waitlist: 0,
      max: 10,
      participants: [],
      waitlistNames: [],
      participantsWithUid: [],
      waitlistWithUid: [],
    });
    await seedDoc("events", "event_course_scoped", {
      id: "event_course_scoped",
      title: "Course Scoped",
      creatorUid: "uidCoach",
      ownerUid: "uidCoach",
      privateEvent: false,
      courseLinked: true,
      courseLinkSource: "eduCourseLesson",
      courseLinkId: "opaque_link_5_scoped",
      status: "open",
    });
    await seedDoc("events", "event_plain_self_to_course", {
      id: "event_plain_self_to_course",
      title: "Plain Self",
      creatorUid: "uidUser",
      ownerUid: "uidUser",
      status: "open",
    });
    await seedDoc("events", "event_plain_broad_to_course", {
      id: "event_plain_broad_to_course",
      title: "Plain Broad",
      creatorUid: "uidA",
      ownerUid: "uidA",
      status: "open",
    });

    await seedRoleActivityCapabilities();
    await seedRolePermissions("coach", ["activity.manage.entry"]);
    await seedUserPermissionGrant("uidUser", ["event.edit_self"]);
    await assertFails(
      updateDoc(doc(user(), "events", "event_course_lifecycle"), {
        status: "cancelled",
      })
    );
    await assertFails(
      updateDoc(doc(user(), "events", "event_course_lifecycle"), {
        title: "Course Lifecycle User Edited",
      })
    );
    await assertSucceeds(
      updateDoc(doc(memberA(), "events", "event_course_lifecycle"), {
        current: 10,
        realCurrent: 10,
        participants: ["Member A"],
        status: "full",
      })
    );
    await assertFails(
      updateDoc(doc(superAdmin(), "events", "event_course_lifecycle"), {
        title: "Course Lifecycle Edited",
      })
    );
    await assertSucceeds(
      updateDoc(doc(superAdmin(), "events", "event_course_lifecycle"), {
        status: "cancelled",
      })
    );
    await assertFails(
      updateDoc(doc(superAdmin(), "events", "event_course_lifecycle"), {
        status: "cancelled",
        courseLinkId: "tampered_link",
      })
    );
    await assertFails(
      updateDoc(doc(coach(), "events", "event_course_scoped"), {
        title: "Course Scoped Edited",
      })
    );
    await assertSucceeds(
      updateDoc(doc(coach(), "events", "event_course_scoped"), {
        status: "cancelled",
      })
    );
    await assertFails(
      updateDoc(doc(coach(), "events", "event_course_scoped"), {
        status: "ended",
      })
    );
    await assertFails(
      updateDoc(doc(user(), "events", "event_plain_self_to_course"), {
        courseLinked: true,
        courseLinkSource: "eduCourseLesson",
        courseLinkId: "fake_self_upgrade",
      })
    );
    await assertFails(
      updateDoc(doc(superAdmin(), "events", "event_plain_broad_to_course"), {
        courseLinked: true,
        courseLinkSource: "eduCourseLesson",
        courseLinkId: "fake_broad_upgrade",
      })
    );
    await assertFails(
      updateDoc(doc(superAdmin(), "events", "event_plain_broad_to_course"), {
        courseLinkId: "fake_broad_link_only",
      })
    );

    await assertFails(deleteDoc(doc(memberA(), "events", "event_course_lifecycle")));
    await assertSucceeds(deleteDoc(doc(superAdmin(), "events", "event_course_lifecycle")));
  });

  test("subcollection course-linked registration provenance is immutable to clients", async () => {
    await seedDoc("events", "event_course_public_sub", {
      id: "event_course_public_sub",
      title: "Course Public Sub",
      creatorUid: "uidA",
      privateEvent: false,
      courseLinked: true,
      courseLinkSource: "eduCourseLesson",
      courseLinkId: "opaque_link_6",
      status: "open",
    });
    await seedPath(["events", "event_course_public_sub", "registrations", "reg_course_sub"], {
      eventId: "event_course_public_sub",
      userId: "uidA",
      status: "confirmed",
      source: "eduCourseLesson",
      courseLinkState: "created_by_course",
    });
    await seedPath(["events", "event_course_public_sub", "registrations", "reg_ordinary_sub"], {
      eventId: "event_course_public_sub",
      userId: "uidA",
      status: "confirmed",
      source: "manual",
    });

    await assertFails(
      updateDoc(doc(memberA(), "events", "event_course_public_sub", "registrations", "reg_course_sub"), {
        status: "cancelled",
      })
    );
    await assertFails(deleteDoc(doc(memberA(), "events", "event_course_public_sub", "registrations", "reg_course_sub")));
    await assertFails(
      setDoc(doc(memberA(), "events", "event_course_public_sub", "registrations", "reg_fake_override"), {
        eventId: "event_course_public_sub",
        userId: "uidA",
        status: "confirmed",
        courseRosterOverride: "confirmed",
        courseRosterOverrideSource: "manual",
      })
    );
    await assertFails(
      setDoc(doc(memberA(), "events", "event_course_public_sub", "registrations", "reg_fake_owner"), {
        eventId: "event_course_public_sub",
        userId: "uidA",
        status: "confirmed",
        source: "manual",
        courseOwnerUids: ["uidB"],
      })
    );
    await assertFails(
      updateDoc(
        doc(memberA(), "events", "event_course_public_sub", "registrations", "reg_ordinary_sub"),
        {
          courseOwnerUids: ["uidB"],
        }
      )
    );
  });

  test("private course-linked events allow ordinary subcollection registrations and activity side effects", async () => {
    await seedDoc("events", "event_course_private_sub", {
      id: "event_course_private_sub",
      title: "Course Private Sub",
      creatorUid: "uidA",
      privateEvent: true,
      courseLinked: true,
      courseLinkSource: "eduCourseLesson",
      courseLinkId: "opaque_link_7",
      status: "open",
    });

    await assertSucceeds(
      updateDoc(doc(memberA(), "events", "event_course_private_sub"), {
        current: 1,
        realCurrent: 1,
        participants: ["Member A"],
        status: "open",
      })
    );
    await assertSucceeds(
      setDoc(doc(memberA(), "events", "event_course_private_sub", "registrations", "reg_private_sub"), {
        eventId: "event_course_private_sub",
        userId: "uidA",
        status: "confirmed",
      })
    );
    await assertSucceeds(
      setDoc(doc(memberA(), "events", "event_course_private_sub", "activityRecords", "act_private_sub"), {
        eventId: "event_course_private_sub",
        uid: "uidA",
        status: "registered",
      })
    );
    await assertFails(
      setDoc(doc(memberA(), "events", "event_course_private_sub", "activityRecords", "act_private_course_owned"), {
        eventId: "event_course_private_sub",
        uid: "uidA",
        status: "registered",
        source: "eduCourseLesson",
        courseLinkState: "created_by_course",
      })
    );
  });

  test("private course-linked events allow site operators to manage attendance records only", async () => {
    await seedDoc("events", "event_course_private_attendance", {
      id: "event_course_private_attendance",
      title: "Course Private Attendance",
      creatorUid: "uidCoach",
      ownerUid: "uidCoach",
      privateEvent: true,
      courseLinked: true,
      courseLinkSource: "eduCourseLesson",
      courseLinkId: "opaque_link_attendance",
      status: "open",
    });
    await seedPath(["events", "event_course_private_attendance", "attendanceRecords", "att_existing"], {
      eventId: "event_course_private_attendance",
      uid: "uidA",
      type: "checkin",
      status: "active",
    });

    await assertSucceeds(
      setDoc(doc(coach(), "events", "event_course_private_attendance", "attendanceRecords", "att_operator_checkin"), {
        eventId: "event_course_private_attendance",
        uid: "uidA",
        type: "checkin",
        status: "active",
      })
    );
    await assertSucceeds(
      setDoc(doc(coach(), "events", "event_course_private_attendance", "attendanceRecords", "att_operator_note"), {
        eventId: "event_course_private_attendance",
        uid: "uidA",
        type: "note",
        note: "arrived",
        status: "active",
      })
    );
    await assertSucceeds(
      updateDoc(doc(coach(), "events", "event_course_private_attendance", "attendanceRecords", "att_existing"), {
        status: "removed",
        removedAt: serverTimestamp(),
        removedByUid: "uidCoach",
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      setDoc(doc(memberA(), "events", "event_course_private_attendance", "attendanceRecords", "att_random"), {
        eventId: "event_course_private_attendance",
        uid: "uidA",
        type: "checkin",
        status: "active",
      })
    );
    await assertFails(
      setDoc(doc(coach(), "events", "event_course_private_attendance", "attendanceRecords", "att_course_owned"), {
        eventId: "event_course_private_attendance",
        uid: "uidA",
        type: "checkin",
        status: "active",
        source: "eduCourseLesson",
        courseLinkState: "created_by_course",
      })
    );
  });

  test("course-linked activity records cannot be client-mutated after event is public", async () => {
    await seedDoc("events", "event_course_activity_public", {
      id: "event_course_activity_public",
      title: "Course Activity Public",
      creatorUid: "uidA",
      privateEvent: false,
      courseLinked: true,
      courseLinkSource: "eduCourseLesson",
      courseLinkId: "opaque_link_8",
      status: "open",
    });
    await seedPath(["events", "event_course_activity_public", "activityRecords", "act_course"], {
      eventId: "event_course_activity_public",
      uid: "uidA",
      status: "registered",
      source: "eduCourseLesson",
      courseLinkState: "created_by_course",
    });

    await assertFails(
      updateDoc(doc(memberA(), "events", "event_course_activity_public", "activityRecords", "act_course"), {
        status: "removed",
      })
    );
    await assertFails(deleteDoc(doc(admin(), "events", "event_course_activity_public", "activityRecords", "act_course")));
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
  test("userPermissionGrants(admin.messages.delete) cannot hard delete root messages", async () => {
    await seedUserPermissionGrant("uidUser", ["admin.messages.delete"]);
    await seedDoc("messages", "msgGrantDeleteBlocked", {
      fromUid: "uidA",
      toUid: "uidB",
      body: "protected",
    });

    await assertFails(deleteDoc(doc(user(), "messages", "msgGrantDeleteBlocked")));
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

  test("create: requires explicit team.create or global team management permission", async () => {
    await assertByRole(
      ({ db, role }) => setDoc(doc(db, "teams", `team_create_${role}`), { name: "Team X" }),
      allowAdminAndSuper
    );

    await assertFails(setDoc(doc(user(), "teams", "team_forged_captain"), {
      name: "Forged Team",
      captainUid: "uidUser",
    }));
    await seedUserPermissionGrant("uidUser", ["team.create"]);
    await assertSucceeds(setDoc(doc(user(), "teams", "team_granted_create"), {
      name: "Granted Team",
      captainUid: "uidUser",
    }));
  });

  test("update: owner or hasPerm('team.manage_all') can update, others cannot", async () => {
    await assertFails(updateDoc(doc(guest(), "teams", "teamB"), { name: "guest-update" }));
    await assertFails(updateDoc(doc(memberA(), "teams", "teamB"), { name: "updated-by-a" }));
    await assertSucceeds(updateDoc(doc(memberB(), "teams", "teamB"), { name: "updated-by-b" }));
    // admin has team.manage_all from seeded rolePermissions
    await assertSucceeds(updateDoc(doc(admin(), "teams", "teamB"), { name: "updated-by-admin" }));
    await assertSucceeds(updateDoc(doc(superAdmin(), "teams", "teamB"), { name: "updated-by-super-admin" }));
  });

  test("update: non-staff cannot update team member/feed/coaches whitelist on another team", async () => {
    await assertFails(updateDoc(doc(user(), "teams", "teamA"), { members: 99 }));
    await assertFails(updateDoc(doc(user(), "teams", "teamA"), { coaches: ["uidUser"] }));
    await assertFails(updateDoc(doc(user(), "teams", "teamA"), { feed: [] }));
  });

  test("update: club staff can update club-scoped member data fields only", async () => {
    await seedDoc("teams", "team_member_data", {
      id: "team_member_data",
      name: "Member Data Team",
      captainUid: "uidA",
      creatorUid: "uidA",
      ownerUid: "uidA",
      leaderUids: ["uidLeader"],
      coachUids: ["uidCoach"],
      memberMatchData: {},
      memberActivityData: {},
    });

    await assertFails(
      updateDoc(doc(user(), "teams", "team_member_data"), {
        memberMatchData: { uidB: { jerseyNumber: "10", position: "ST", notes: "blocked" } },
      })
    );
    await assertSucceeds(
      updateDoc(doc(coach(), "teams", "team_member_data"), {
        memberMatchData: { uidB: { jerseyNumber: "10", position: "ST", notes: "starter" } },
      })
    );
    await assertSucceeds(
      updateDoc(doc(leader(), "teams", "team_member_data"), {
        memberActivityData: { uidB: { notes: "attends weekends" } },
      })
    );
    await assertFails(
      updateDoc(doc(coach(), "teams", "team_member_data"), {
        name: "Coach renamed club",
        memberCourseData: { uidB: { notes: "not allowed with root edit" } },
      })
    );
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

  test("delete: admin without team.manage_all cannot delete another club", async () => {
    await seedRolePermissions("admin", []);
    await seedDoc("teams", "team_admin_no_manage_del", { name: "Admin No Manage Del", ownerUid: "uidB" });
    await assertFails(deleteDoc(doc(admin(), "teams", "team_admin_no_manage_del")));
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
        status: "ended",
      })
    );
  });

  test("[SECURITY_HARDENED] non-owner user cannot update coach event", async () => {
    await assertFails(
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
        email: "member@example.com",
        gender: "male",
        birthday: "1990-01-01",
        region: "Taipei",
        sports: "football",
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("owner can record profile modal legal consent", async () => {
    await assertSucceeds(
      updateDoc(doc(user(), "users", "uidUser"), {
        termsAcceptedAt: "2026-05-19T12:00:00.000Z",
        privacyAcceptedAt: "2026-05-19T12:00:00.000Z",
        termsVersion: "2026-05-19",
        privacyVersion: "2026-05-19",
        legalAcceptedSource: "profile_completion_submit",
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("owner CANNOT spoof unsupported legal policy versions", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        termsAcceptedAt: "2026-05-19T12:00:00.000Z",
        privacyAcceptedAt: "2026-05-19T12:00:00.000Z",
        termsVersion: "2099-01-01",
        privacyVersion: "2026-05-19",
        legalAcceptedSource: "profile_completion_submit",
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
        email: null,
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

  test("owner CANNOT update email to a non-string value", async () => {
    await assertFails(
      updateDoc(doc(user(), "users", "uidUser"), {
        email: 123,
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

describe("/userPermissionGrants/{uid}", () => {
  test("owner and superAdmin can read grant document only for allowed scope", async () => {
    await seedUserPermissionGrant("uidA", ["profile.secondary_identity"]);

    await assertSucceeds(getDoc(doc(memberA(), "userPermissionGrants", "uidA")));
    await assertSucceeds(getDoc(doc(superAdmin(), "userPermissionGrants", "uidA")));
    await assertFails(getDoc(doc(memberB(), "userPermissionGrants", "uidA")));
    await assertFails(getDoc(doc(guest(), "userPermissionGrants", "uidA")));
  });

  test("only superAdmin can write minimal public grant shape", async () => {
    const ref = doc(superAdmin(), "userPermissionGrants", "uidA");
    await assertSucceeds(setDoc(ref, {
      uid: "uidA",
      permissions: ["profile.secondary_identity"],
      enabled: true,
      updatedAt: serverTimestamp(),
    }));

    await assertFails(setDoc(doc(admin(), "userPermissionGrants", "uidA"), {
      uid: "uidA",
      permissions: ["profile.secondary_identity"],
      enabled: true,
    }));
    await assertFails(setDoc(doc(memberA(), "userPermissionGrants", "uidA"), {
      uid: "uidA",
      permissions: ["profile.secondary_identity"],
      enabled: true,
    }));
  });

  test("grant document rejects internal metadata and uid mismatch", async () => {
    await assertFails(setDoc(doc(superAdmin(), "userPermissionGrants", "uidA"), {
      uid: "uidA",
      permissions: [],
      enabled: true,
      updatedByUid: "uidSA",
    }));

    await assertFails(setDoc(doc(superAdmin(), "userPermissionGrants", "uidA"), {
      uid: "uidB",
      permissions: [],
      enabled: true,
    }));
  });

  test("grant document accepts enabled catalog permission codes", async () => {
    await assertSucceeds(setDoc(doc(superAdmin(), "userPermissionGrants", "uidA"), {
      uid: "uidA",
      permissions: [
        "profile.secondary_identity",
        "admin.tournaments.delete",
        "admin.seo.entry",
        "activity.view_noshow",
      ],
      enabled: true,
    }));
  });

  test("grant document rejects disabled, legacy, unknown, and non-string permission values", async () => {
    await assertFails(setDoc(doc(superAdmin(), "userPermissionGrants", "uidA"), {
      uid: "uidA",
      permissions: ["admin.roles.entry"],
      enabled: true,
    }));

    await assertFails(setDoc(doc(superAdmin(), "userPermissionGrants", "uidA"), {
      uid: "uidA",
      permissions: ["event.edit_own"],
      enabled: true,
    }));

    await assertFails(setDoc(doc(superAdmin(), "userPermissionGrants", "uidA"), {
      uid: "uidA",
      permissions: ["unknown.permission"],
      enabled: true,
    }));

    await assertFails(setDoc(doc(superAdmin(), "userPermissionGrants", "uidA"), {
      uid: "uidA",
      permissions: [{ code: "profile.secondary_identity" }],
      enabled: true,
    }));
  });

  test("audit entries are superAdmin only and hidden from target user", async () => {
    await seedPath(["userPermissionGrantAudit", "uidA", "entries", "entry1"], {
      action: "update",
      actorUid: "uidSA",
      note: "internal",
    });

    await assertSucceeds(getDoc(doc(superAdmin(), "userPermissionGrantAudit", "uidA", "entries", "entry1")));
    await assertFails(getDoc(doc(memberA(), "userPermissionGrantAudit", "uidA", "entries", "entry1")));
    await assertFails(getDoc(doc(admin(), "userPermissionGrantAudit", "uidA", "entries", "entry1")));

    await assertSucceeds(setDoc(doc(superAdmin(), "userPermissionGrantAudit", "uidA", "entries", "entry2"), {
      action: "update",
      actorUid: "uidSA",
    }));
    await assertFails(setDoc(doc(admin(), "userPermissionGrantAudit", "uidA", "entries", "entry3"), {
      action: "update",
      actorUid: "uidAdmin",
    }));
  });
});

// ═══════════════════════════════════════════════════════════════
// Phase 4: hasPerm() 權限碼授予 → 存取控制矩陣
// ═══════════════════════════════════════════════════════════════

describe("event comments subcollections", () => {
  const futureDate = () => new Date(Date.now() + 60 * 60 * 1000);
  const pastDate = () => new Date(Date.now() - 60 * 60 * 1000);

  async function seedCommentEvent(id, overrides = {}) {
    await seedDoc("events", id, {
      id,
      title: "Comment Event",
      creatorUid: "uidA",
      delegateUids: ["uidCaptain"],
      status: "open",
      endTimestamp: futureDate(),
      ...overrides,
    });
  }

  function commentData(eventId, authorUid = "uidUser", body = "hello") {
    return {
      eventId,
      authorUid,
      authorName: "LINE User",
      authorPhoto: "https://example.com/a.png",
      body,
      visibility: "public",
      replyLocked: false,
      deleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  }

  function replyData(eventId, commentId, authorUid = "uidB", body = "reply") {
    return {
      eventId,
      commentId,
      authorUid,
      authorName: "Reply User",
      authorPhoto: "",
      body,
      deleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  }

  async function seedSecondaryIdentity(uid, overrides = {}) {
    await seedPath(["users", uid, "identityPrivate", "settings"], {
      profileActiveIdentityId: "main",
      identities: {
        secondary: {
          identityId: "secondary",
          enabled: true,
          displayName: "Comment Alias",
          avatarUrl: "",
          displayRoleLabel: "Public",
          isPrimary: false,
          editable: true,
          ...overrides,
        },
      },
      updatedAt: new Date(),
    });
  }

  test("authenticated user can create a 300-character public comment before event end", async () => {
    await seedCommentEvent("commentFuture");
    await assertSucceeds(
      setDoc(doc(user(), "events", "commentFuture", "comments", "c1"), {
        ...commentData("commentFuture", "uidUser", "x".repeat(300)),
      })
    );
  });

  test("comment create and likes can maintain lightweight summary fields", async () => {
    await seedCommentEvent("commentSummary");
    await assertSucceeds(
      setDoc(doc(user(), "events", "commentSummary", "comments", "c1"), {
        ...commentData("commentSummary", "uidUser", "summary"),
        replyCount: 0,
        likeCount: 0,
        recentLikers: [],
      })
    );

    const dbB = memberB();
    const batch = writeBatch(dbB);
    batch.set(doc(dbB, "events", "commentSummary", "comments", "c1", "likes", "uidB"), {
      eventId: "commentSummary",
      commentId: "c1",
      uid: "uidB",
      authorName: "Reply User",
      authorPhoto: "https://example.com/reply.png",
      createdAt: serverTimestamp(),
    });
    batch.update(doc(dbB, "events", "commentSummary", "comments", "c1"), {
      likeCount: 1,
      recentLikers: [{
        uid: "uidB",
        authorName: "Reply User",
        authorPhoto: "https://example.com/reply.png",
      }],
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());

    await assertFails(
      updateDoc(doc(memberB(), "events", "commentSummary", "comments", "c1"), {
        likeCount: 9,
        recentLikers: [],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("[SECONDARY_IDENTITY] comment identitySnapshot is verified and public-only", async () => {
    await seedCommentEvent("commentIdentitySnapshot");
    await seedRolePermissions("coach", ["profile.secondary_identity"]);
    await seedSecondaryIdentity("uidCoach");

    await assertSucceeds(
      setDoc(doc(coach(), "events", "commentIdentitySnapshot", "comments", "c1"), {
        ...commentData("commentIdentitySnapshot", "uidCoach", "secondary"),
        identitySnapshot: {
          identityId: "secondary",
          displayName: "Comment Alias",
          avatarUrl: "",
        },
      })
    );

    await assertFails(
      setDoc(doc(coach(), "events", "commentIdentitySnapshot", "comments", "fakeName"), {
        ...commentData("commentIdentitySnapshot", "uidCoach", "fake"),
        identitySnapshot: {
          identityId: "secondary",
          displayName: "Forged Alias",
          avatarUrl: "",
        },
      })
    );

    await assertFails(
      setDoc(doc(user(), "events", "commentIdentitySnapshot", "comments", "leaky"), {
        ...commentData("commentIdentitySnapshot", "uidUser", "leaky"),
        identitySnapshot: {
          identityId: "main",
          displayName: "General User",
          avatarUrl: "",
          role: "admin",
        },
      })
    );

    await seedSecondaryIdentity("uidUser");
    await assertFails(
      setDoc(doc(user(), "events", "commentIdentitySnapshot", "comments", "noPermission"), {
        ...commentData("commentIdentitySnapshot", "uidUser", "no permission"),
        identitySnapshot: {
          identityId: "secondary",
          displayName: "Comment Alias",
          avatarUrl: "",
        },
      })
    );
  });

  test("[SECONDARY_IDENTITY] comment identitySnapshot is immutable after create", async () => {
    await seedCommentEvent("commentIdentityImmutable");
    await seedPath(["events", "commentIdentityImmutable", "comments", "c1"], {
      ...commentData("commentIdentityImmutable", "uidUser", "snapshot"),
      identitySnapshot: {
        identityId: "main",
        displayName: "General User",
        avatarUrl: "",
      },
    });

    await assertFails(
      updateDoc(doc(memberA(), "events", "commentIdentityImmutable", "comments", "c1"), {
        deleted: true,
        deletedByUid: "uidA",
        deletedAt: serverTimestamp(),
        identitySnapshot: {
          identityId: "secondary",
          displayName: "Changed",
          avatarUrl: "",
        },
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("comment create rejects over 300 characters and ended events", async () => {
    await seedCommentEvent("commentFuture");
    await assertFails(
      setDoc(doc(user(), "events", "commentFuture", "comments", "tooLong"), {
        ...commentData("commentFuture", "uidUser", "x".repeat(301)),
      })
    );

    await seedCommentEvent("commentPast", { endTimestamp: pastDate() });
    await assertFails(
      setDoc(doc(user(), "events", "commentPast", "comments", "late"), {
        ...commentData("commentPast", "uidUser", "late"),
      })
    );
  });

  test("private comments are visible only to author, host/delegate, and admin", async () => {
    await seedCommentEvent("commentPrivate");
    await seedPath(["events", "commentPrivate", "comments", "private1"], {
      ...commentData("commentPrivate", "uidUser", "secret"),
      visibility: "private",
    });

    await assertSucceeds(getDoc(doc(user(), "events", "commentPrivate", "comments", "private1")));
    await assertSucceeds(getDoc(doc(memberA(), "events", "commentPrivate", "comments", "private1")));
    await assertSucceeds(getDoc(doc(captain(), "events", "commentPrivate", "comments", "private1")));
    await assertSucceeds(getDoc(doc(admin(), "events", "commentPrivate", "comments", "private1")));
    await assertFails(getDoc(doc(memberB(), "events", "commentPrivate", "comments", "private1")));
  });

  test("only host/delegate/admin can lock or soft-delete comments", async () => {
    await seedCommentEvent("commentManage");
    await seedPath(["events", "commentManage", "comments", "c1"], commentData("commentManage"));

    await assertFails(
      updateDoc(doc(memberB(), "events", "commentManage", "comments", "c1"), {
        replyLocked: true,
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      updateDoc(doc(memberA(), "events", "commentManage", "comments", "c1"), {
        replyLocked: true,
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      updateDoc(doc(captain(), "events", "commentManage", "comments", "c1"), {
        deleted: true,
        deletedByUid: "uidCaptain",
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("replies respect parent reply lock and likes are per-user documents", async () => {
    await seedCommentEvent("commentReply");
    await seedPath(["events", "commentReply", "comments", "c1"], commentData("commentReply"));

    await assertSucceeds(
      setDoc(doc(memberB(), "events", "commentReply", "comments", "c1", "replies", "r1"), {
        ...replyData("commentReply", "c1", "uidB"),
        likeCount: 0,
        recentLikers: [],
      })
    );
    await assertSucceeds(
      setDoc(doc(memberB(), "events", "commentReply", "comments", "c1", "replies", "r100"), {
        ...replyData("commentReply", "c1", "uidB", "x".repeat(100)),
      })
    );
    await assertFails(
      setDoc(doc(memberB(), "events", "commentReply", "comments", "c1", "replies", "r101"), {
        ...replyData("commentReply", "c1", "uidB", "x".repeat(101)),
      })
    );
    await assertSucceeds(
      setDoc(doc(memberB(), "events", "commentReply", "comments", "c1", "likes", "uidB"), {
        eventId: "commentReply",
        commentId: "c1",
        uid: "uidB",
        authorName: "Reply User",
        authorPhoto: "https://example.com/reply.png",
        createdAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      setDoc(doc(memberA(), "events", "commentReply", "comments", "c1", "likes", "uidA"), {
        eventId: "commentReply",
        commentId: "c1",
        uid: "uidA",
        createdAt: serverTimestamp(),
      })
    );
    await assertFails(
      setDoc(doc(user("uidLong"), "events", "commentReply", "comments", "c1", "likes", "uidLong"), {
        eventId: "commentReply",
        commentId: "c1",
        uid: "uidLong",
        authorName: "x".repeat(81),
        authorPhoto: "",
        createdAt: serverTimestamp(),
      })
    );

    const replyLikeDb = memberB();
    const replyLikeBatch = writeBatch(replyLikeDb);
    replyLikeBatch.set(doc(replyLikeDb, "events", "commentReply", "comments", "c1", "replies", "r1", "likes", "uidB"), {
      eventId: "commentReply",
      commentId: "c1",
      replyId: "r1",
      uid: "uidB",
      authorName: "Reply User",
      authorPhoto: "https://example.com/reply.png",
      createdAt: serverTimestamp(),
    });
    replyLikeBatch.update(doc(replyLikeDb, "events", "commentReply", "comments", "c1", "replies", "r1"), {
      likeCount: 1,
      recentLikers: [{
        uid: "uidB",
        authorName: "Reply User",
        authorPhoto: "https://example.com/reply.png",
      }],
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(replyLikeBatch.commit());

    await assertFails(
      updateDoc(doc(memberB(), "events", "commentReply", "comments", "c1", "replies", "r1"), {
        likeCount: 9,
        recentLikers: [],
        updatedAt: serverTimestamp(),
      })
    );

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "events", "commentReply", "comments", "c1"), { replyLocked: true });
    });
    await assertFails(
      setDoc(doc(memberB(), "events", "commentReply", "comments", "c1", "replies", "r2"), {
        ...replyData("commentReply", "c1", "uidB", "locked"),
      })
    );
  });
});

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

    test("regular user with individual grant can create announcement", async () => {
      await seedUserPermissionGrant("uidUser", ["admin.announcements.entry"]);
      await assertSucceeds(
        setDoc(doc(user(), "announcements", "ann_user_grant"), {
          title: "User Grant", body: "Hello", createdAt: new Date(),
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
