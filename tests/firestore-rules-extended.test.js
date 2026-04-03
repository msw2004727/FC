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

// Context for a user whose role in users doc is "content_manager"
function contentManager(uid = "uidCM") {
  return roleContext(uid, "content_manager");
}

// Context for inventory admin
function invAdmin(uid = "uidInvAdmin") {
  return roleContext(uid, "user");
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
      teamId: "teamA",
      teamIds: ["teamA"],
    });
    await setDoc(doc(db, "users", "uidB"), {
      uid: "uidB",
      displayName: "Member B",
      role: "user",
      teamId: "teamB",
      teamIds: ["teamB"],
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
      teamId: "teamA",
      teamIds: ["teamA"],
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
    await setDoc(doc(db, "users", "uidCM"), {
      uid: "uidCM",
      displayName: "Content Manager",
      role: "content_manager",
    });
    await setDoc(doc(db, "users", "uidInvAdmin"), {
      uid: "uidInvAdmin",
      displayName: "Inventory Admin",
      role: "user",
    });

    // Teams with captain/leader info
    await setDoc(doc(db, "teams", "teamA"), {
      id: "teamA",
      name: "Team A",
      captainUid: "uidCaptain",
      creatorUid: "uidCaptain",
      ownerUid: "uidCaptain",
      leaderUids: ["uidLeader"],
    });
    await setDoc(doc(db, "teams", "teamB"), {
      id: "teamB",
      name: "Team B",
      captainUid: "uidB",
      creatorUid: "uidB",
      ownerUid: "uidB",
    });

    // rolePermissions for admin and super_admin
    await setDoc(doc(db, "rolePermissions", "admin"), {
      permissions: [
        "event.edit_all",
        "team.manage_all",
        "admin.shop.entry",
        "admin.announcements.entry",
        "admin.achievements.entry",
        "admin.banners.entry",
        "admin.themes.entry",
        "admin.auto_exp.entry",
        "admin.games.entry",
        "admin.logs.error_read",
        "admin.logs.error_delete",
        "admin.logs.audit_read",
        "admin.messages.entry",
      ],
    });
    await setDoc(doc(db, "rolePermissions", "super_admin"), {
      permissions: [
        "event.edit_all",
        "team.manage_all",
        "admin.shop.entry",
        "admin.announcements.entry",
        "admin.achievements.entry",
        "admin.banners.entry",
        "admin.themes.entry",
        "admin.auto_exp.entry",
        "admin.games.entry",
        "admin.logs.error_read",
        "admin.logs.error_delete",
        "admin.logs.audit_read",
        "admin.messages.entry",
        "admin.repair.no_show_adjust",
      ],
    });

    // Inventory settings (adminUids includes uidInvAdmin)
    await setDoc(doc(db, "inv_settings", "config"), {
      adminUids: ["uidInvAdmin", "uidSA"],
    });

    // Seed a tournament for subcollection tests
    await setDoc(doc(db, "tournaments", "tourA"), {
      id: "tourA",
      name: "Tournament A",
      hostTeamId: "teamA",
      creatorUid: "uidCaptain",
      mode: "knockout",
      delegateUids: ["uidA"],
    });

    // Seed tournament entry for teamA
    await setDoc(doc(db, "tournaments", "tourA", "entries", "teamA"), {
      teamId: "teamA",
      status: "confirmed",
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

// ═══════════════════════════════════════════════════════════════
//  eventTemplates
// ═══════════════════════════════════════════════════════════════
describe("/eventTemplates/{templateId}", () => {
  test("read: owner can read own template", async () => {
    await seedDoc("eventTemplates", "tmplA", {
      name: "Template A",
      ownerUid: "uidA",
    });
    await assertSucceeds(getDoc(doc(memberA(), "eventTemplates", "tmplA")));
  });

  test("read: non-owner authenticated user cannot read", async () => {
    await seedDoc("eventTemplates", "tmplA", {
      name: "Template A",
      ownerUid: "uidA",
    });
    await assertFails(getDoc(doc(memberB(), "eventTemplates", "tmplA")));
  });

  test("read: admin can read any template", async () => {
    await seedDoc("eventTemplates", "tmplA", {
      name: "Template A",
      ownerUid: "uidA",
    });
    await assertSucceeds(getDoc(doc(admin(), "eventTemplates", "tmplA")));
    await assertSucceeds(getDoc(doc(superAdmin(), "eventTemplates", "tmplA")));
  });

  test("read: guest cannot read", async () => {
    await seedDoc("eventTemplates", "tmplA", {
      name: "Template A",
      ownerUid: "uidA",
    });
    await assertFails(getDoc(doc(guest(), "eventTemplates", "tmplA")));
  });

  test("create: owner can create with valid fields", async () => {
    await assertSucceeds(
      setDoc(doc(memberA(), "eventTemplates", "tmplNew"), {
        name: "My Template",
        ownerUid: "uidA",
      })
    );
  });

  test("create: cannot create with mismatched ownerUid", async () => {
    await assertFails(
      setDoc(doc(memberA(), "eventTemplates", "tmplSpoof"), {
        name: "Spoof Template",
        ownerUid: "uidB",
      })
    );
  });

  test("create: must have name string", async () => {
    await assertFails(
      setDoc(doc(memberA(), "eventTemplates", "tmplNoName"), {
        ownerUid: "uidA",
      })
    );
  });

  test("create: guest cannot create", async () => {
    await assertFails(
      setDoc(doc(guest(), "eventTemplates", "tmplGuest"), {
        name: "Guest Template",
        ownerUid: "guest",
      })
    );
  });

  test("update: owner can update own template (ownerUid must remain same)", async () => {
    await seedDoc("eventTemplates", "tmplA", {
      name: "Template A",
      ownerUid: "uidA",
    });
    await assertSucceeds(
      updateDoc(doc(memberA(), "eventTemplates", "tmplA"), {
        name: "Updated Template A",
        ownerUid: "uidA",
      })
    );
  });

  test("update: owner cannot change ownerUid", async () => {
    await seedDoc("eventTemplates", "tmplA", {
      name: "Template A",
      ownerUid: "uidA",
    });
    await assertFails(
      updateDoc(doc(memberA(), "eventTemplates", "tmplA"), {
        name: "Updated",
        ownerUid: "uidB",
      })
    );
  });

  test("update: non-owner cannot update", async () => {
    await seedDoc("eventTemplates", "tmplA", {
      name: "Template A",
      ownerUid: "uidA",
    });
    await assertFails(
      updateDoc(doc(memberB(), "eventTemplates", "tmplA"), {
        name: "Hacked",
        ownerUid: "uidA",
      })
    );
  });

  test("update: admin can update any template", async () => {
    await seedDoc("eventTemplates", "tmplA", {
      name: "Template A",
      ownerUid: "uidA",
    });
    await assertSucceeds(
      updateDoc(doc(admin(), "eventTemplates", "tmplA"), {
        name: "Admin Updated",
      })
    );
  });

  test("delete: owner can delete own template", async () => {
    await seedDoc("eventTemplates", "tmplA", {
      name: "Template A",
      ownerUid: "uidA",
    });
    await assertSucceeds(deleteDoc(doc(memberA(), "eventTemplates", "tmplA")));
  });

  test("delete: non-owner cannot delete", async () => {
    await seedDoc("eventTemplates", "tmplA", {
      name: "Template A",
      ownerUid: "uidA",
    });
    await assertFails(deleteDoc(doc(memberB(), "eventTemplates", "tmplA")));
  });

  test("delete: admin can delete any template", async () => {
    await seedDoc("eventTemplates", "tmplA", {
      name: "Template A",
      ownerUid: "uidA",
    });
    await assertSucceeds(deleteDoc(doc(admin(), "eventTemplates", "tmplA")));
  });

  test("delete: guest cannot delete", async () => {
    await seedDoc("eventTemplates", "tmplA", {
      name: "Template A",
      ownerUid: "uidA",
    });
    await assertFails(deleteDoc(doc(guest(), "eventTemplates", "tmplA")));
  });
});

// ═══════════════════════════════════════════════════════════════
//  users/{uid}/achievements subcollection
// ═══════════════════════════════════════════════════════════════
describe("/users/{uid}/achievements/{achId}", () => {
  test("read: any authenticated user can read", async () => {
    await seedPath(["users", "uidA", "achievements", "ach1"], {
      name: "First Goal",
      unlockedAt: new Date(),
    });
    await assertSucceeds(
      getDoc(doc(memberA(), "users", "uidA", "achievements", "ach1"))
    );
    await assertSucceeds(
      getDoc(doc(memberB(), "users", "uidA", "achievements", "ach1"))
    );
    await assertSucceeds(
      getDoc(doc(user(), "users", "uidA", "achievements", "ach1"))
    );
    await assertSucceeds(
      getDoc(doc(admin(), "users", "uidA", "achievements", "ach1"))
    );
  });

  test("read: guest cannot read", async () => {
    await seedPath(["users", "uidA", "achievements", "ach1"], {
      name: "First Goal",
    });
    await assertFails(
      getDoc(doc(guest(), "users", "uidA", "achievements", "ach1"))
    );
  });

  test("write: owner can write own achievements", async () => {
    await assertSucceeds(
      setDoc(doc(memberA(), "users", "uidA", "achievements", "ach_new"), {
        name: "New Achievement",
        unlockedAt: new Date(),
      })
    );
  });

  test("write: admin can write any user achievements", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "users", "uidA", "achievements", "ach_admin"), {
        name: "Admin Granted",
      })
    );
    await assertSucceeds(
      setDoc(doc(superAdmin(), "users", "uidB", "achievements", "ach_sa"), {
        name: "SA Granted",
      })
    );
  });

  test("write: non-owner non-admin cannot write", async () => {
    await assertFails(
      setDoc(doc(memberB(), "users", "uidA", "achievements", "ach_hack"), {
        name: "Hacked",
      })
    );
  });

  test("write: guest cannot write", async () => {
    await assertFails(
      setDoc(doc(guest(), "users", "uidA", "achievements", "ach_guest"), {
        name: "Guest",
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  users/{uid}/autoExpTracking subcollection
// ═══════════════════════════════════════════════════════════════
describe("/users/{uid}/autoExpTracking/{ruleKey}", () => {
  test("read: owner can read", async () => {
    await seedPath(["users", "uidA", "autoExpTracking", "rule1"], {
      lastRun: new Date(),
    });
    await assertSucceeds(
      getDoc(doc(memberA(), "users", "uidA", "autoExpTracking", "rule1"))
    );
  });

  test("read: admin can read any user", async () => {
    await seedPath(["users", "uidA", "autoExpTracking", "rule1"], {
      lastRun: new Date(),
    });
    await assertSucceeds(
      getDoc(doc(admin(), "users", "uidA", "autoExpTracking", "rule1"))
    );
  });

  test("read: non-owner non-admin cannot read", async () => {
    await seedPath(["users", "uidA", "autoExpTracking", "rule1"], {
      lastRun: new Date(),
    });
    await assertFails(
      getDoc(doc(memberB(), "users", "uidA", "autoExpTracking", "rule1"))
    );
  });

  test("read: guest cannot read", async () => {
    await seedPath(["users", "uidA", "autoExpTracking", "rule1"], {
      lastRun: new Date(),
    });
    await assertFails(
      getDoc(doc(guest(), "users", "uidA", "autoExpTracking", "rule1"))
    );
  });

  test("write: owner can write", async () => {
    await assertSucceeds(
      setDoc(doc(memberA(), "users", "uidA", "autoExpTracking", "rule_new"), {
        lastRun: new Date(),
        count: 5,
      })
    );
  });

  test("write: admin can write any user", async () => {
    await assertSucceeds(
      setDoc(
        doc(admin(), "users", "uidA", "autoExpTracking", "rule_admin"),
        { lastRun: new Date() }
      )
    );
  });

  test("write: non-owner non-admin cannot write", async () => {
    await assertFails(
      setDoc(
        doc(memberB(), "users", "uidA", "autoExpTracking", "rule_hack"),
        { lastRun: new Date() }
      )
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  users/{uid}/game subcollection (private game saves)
// ═══════════════════════════════════════════════════════════════
describe("/users/{uid}/game/{docId}", () => {
  const validGameData = {
    version: 1,
    savedAt: serverTimestamp(),
    character: { name: "whiteCat" },
    lifetime: { days: 10 },
    scene: { current: "home" },
  };

  test("read: owner can read own game save", async () => {
    await seedPath(["users", "uidA", "game", "save1"], {
      version: 1,
      savedAt: new Date(),
      character: { name: "whiteCat" },
      lifetime: { days: 10 },
      scene: { current: "home" },
    });
    await assertSucceeds(
      getDoc(doc(memberA(), "users", "uidA", "game", "save1"))
    );
  });

  test("read: non-owner cannot read (even admin)", async () => {
    await seedPath(["users", "uidA", "game", "save1"], {
      version: 1,
      savedAt: new Date(),
      character: { name: "whiteCat" },
      lifetime: { days: 10 },
      scene: { current: "home" },
    });
    await assertFails(
      getDoc(doc(memberB(), "users", "uidA", "game", "save1"))
    );
    await assertFails(
      getDoc(doc(admin(), "users", "uidA", "game", "save1"))
    );
  });

  test("read: guest cannot read", async () => {
    await seedPath(["users", "uidA", "game", "save1"], {
      version: 1,
      savedAt: new Date(),
      character: {},
      lifetime: {},
      scene: {},
    });
    await assertFails(
      getDoc(doc(guest(), "users", "uidA", "game", "save1"))
    );
  });

  test("write: owner can write with valid schema", async () => {
    await assertSucceeds(
      setDoc(doc(memberA(), "users", "uidA", "game", "save_new"), validGameData)
    );
  });

  test("write: owner cannot write without required fields", async () => {
    await assertFails(
      setDoc(doc(memberA(), "users", "uidA", "game", "save_bad1"), {
        version: 1,
        savedAt: serverTimestamp(),
        character: { name: "whiteCat" },
        // missing lifetime and scene
      })
    );
  });

  test("write: owner cannot write with version=0", async () => {
    await assertFails(
      setDoc(doc(memberA(), "users", "uidA", "game", "save_bad2"), {
        version: 0,
        savedAt: serverTimestamp(),
        character: {},
        lifetime: {},
        scene: {},
      })
    );
  });

  test("write: owner cannot write with non-int version", async () => {
    await assertFails(
      setDoc(doc(memberA(), "users", "uidA", "game", "save_bad3"), {
        version: "1",
        savedAt: serverTimestamp(),
        character: {},
        lifetime: {},
        scene: {},
      })
    );
  });

  test("write: owner cannot write with non-map character", async () => {
    await assertFails(
      setDoc(doc(memberA(), "users", "uidA", "game", "save_bad4"), {
        version: 1,
        savedAt: serverTimestamp(),
        character: "notamap",
        lifetime: {},
        scene: {},
      })
    );
  });

  test("write: non-owner cannot write", async () => {
    await assertFails(
      setDoc(doc(memberB(), "users", "uidA", "game", "save_hack"), validGameData)
    );
  });

  test("write: admin cannot write other user game", async () => {
    await assertFails(
      setDoc(doc(admin(), "users", "uidA", "game", "save_admin"), validGameData)
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  users/{uid}/gamePublic subcollection
// ═══════════════════════════════════════════════════════════════
describe("/users/{uid}/gamePublic/{docId}", () => {
  test("read: any authenticated user can read", async () => {
    await seedPath(["users", "uidA", "gamePublic", "pub1"], {
      characterName: "whiteCat",
      level: 5,
    });
    await assertSucceeds(
      getDoc(doc(memberB(), "users", "uidA", "gamePublic", "pub1"))
    );
    await assertSucceeds(
      getDoc(doc(user(), "users", "uidA", "gamePublic", "pub1"))
    );
    await assertSucceeds(
      getDoc(doc(admin(), "users", "uidA", "gamePublic", "pub1"))
    );
  });

  test("read: guest cannot read", async () => {
    await seedPath(["users", "uidA", "gamePublic", "pub1"], { level: 5 });
    await assertFails(
      getDoc(doc(guest(), "users", "uidA", "gamePublic", "pub1"))
    );
  });

  test("write: owner can write", async () => {
    await assertSucceeds(
      setDoc(doc(memberA(), "users", "uidA", "gamePublic", "pub_new"), {
        characterName: "whiteCat",
        level: 3,
      })
    );
  });

  test("write: non-owner cannot write", async () => {
    await assertFails(
      setDoc(doc(memberB(), "users", "uidA", "gamePublic", "pub_hack"), {
        level: 99,
      })
    );
  });

  test("write: admin cannot write other user gamePublic", async () => {
    await assertFails(
      setDoc(doc(admin(), "users", "uidA", "gamePublic", "pub_admin"), {
        level: 99,
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  users/{uid}/gameInbox subcollection
// ═══════════════════════════════════════════════════════════════
describe("/users/{uid}/gameInbox/{msgId}", () => {
  test("read: owner can read", async () => {
    await seedPath(["users", "uidA", "gameInbox", "msg1"], {
      fromUid: "uidB",
      body: "hello",
    });
    await assertSucceeds(
      getDoc(doc(memberA(), "users", "uidA", "gameInbox", "msg1"))
    );
  });

  test("read: non-owner cannot read", async () => {
    await seedPath(["users", "uidA", "gameInbox", "msg1"], {
      fromUid: "uidB",
      body: "hello",
    });
    await assertFails(
      getDoc(doc(memberB(), "users", "uidA", "gameInbox", "msg1"))
    );
    await assertFails(
      getDoc(doc(admin(), "users", "uidA", "gameInbox", "msg1"))
    );
  });

  test("create: any authenticated user can create (send message to another user)", async () => {
    await assertSucceeds(
      setDoc(doc(memberB(), "users", "uidA", "gameInbox", "msg_from_b"), {
        fromUid: "uidB",
        body: "gift",
      })
    );
    await assertSucceeds(
      setDoc(doc(user(), "users", "uidA", "gameInbox", "msg_from_user"), {
        fromUid: "uidUser",
        body: "hi",
      })
    );
  });

  test("create: guest cannot create", async () => {
    await assertFails(
      setDoc(doc(guest(), "users", "uidA", "gameInbox", "msg_guest"), {
        fromUid: "guest",
        body: "spam",
      })
    );
  });

  test("delete: owner can delete", async () => {
    await seedPath(["users", "uidA", "gameInbox", "msg_del"], {
      fromUid: "uidB",
      body: "delete me",
    });
    await assertSucceeds(
      deleteDoc(doc(memberA(), "users", "uidA", "gameInbox", "msg_del"))
    );
  });

  test("delete: non-owner cannot delete", async () => {
    await seedPath(["users", "uidA", "gameInbox", "msg_del2"], {
      fromUid: "uidB",
      body: "dont delete",
    });
    await assertFails(
      deleteDoc(doc(memberB(), "users", "uidA", "gameInbox", "msg_del2"))
    );
  });

  test("update: always denied", async () => {
    await seedPath(["users", "uidA", "gameInbox", "msg_upd"], {
      fromUid: "uidB",
      body: "original",
    });
    await assertFails(
      updateDoc(doc(memberA(), "users", "uidA", "gameInbox", "msg_upd"), {
        body: "modified",
      })
    );
    await assertFails(
      updateDoc(doc(admin(), "users", "uidA", "gameInbox", "msg_upd"), {
        body: "admin modified",
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  users/{uid}/inbox subcollection
// ═══════════════════════════════════════════════════════════════
describe("/users/{uid}/inbox/{msgId}", () => {
  test("create: always denied (only Cloud Function can write)", async () => {
    await assertFails(
      setDoc(doc(memberA(), "users", "uidA", "inbox", "inb1"), {
        title: "Hello",
        body: "world",
      })
    );
    await assertFails(
      setDoc(doc(admin(), "users", "uidA", "inbox", "inb2"), {
        title: "Admin",
        body: "msg",
      })
    );
    await assertFails(
      setDoc(doc(superAdmin(), "users", "uidA", "inbox", "inb3"), {
        title: "SA",
        body: "msg",
      })
    );
  });

  test("read: owner can read", async () => {
    await seedPath(["users", "uidA", "inbox", "inb1"], {
      title: "Notification",
      body: "You have a new message",
      read: false,
    });
    await assertSucceeds(
      getDoc(doc(memberA(), "users", "uidA", "inbox", "inb1"))
    );
  });

  test("read: non-owner cannot read", async () => {
    await seedPath(["users", "uidA", "inbox", "inb1"], {
      title: "Notification",
      body: "secret",
      read: false,
    });
    await assertFails(
      getDoc(doc(memberB(), "users", "uidA", "inbox", "inb1"))
    );
  });

  test("update: owner can update only read/readAt fields", async () => {
    await seedPath(["users", "uidA", "inbox", "inb_upd"], {
      title: "Notification",
      body: "content",
      read: false,
    });
    await assertSucceeds(
      updateDoc(doc(memberA(), "users", "uidA", "inbox", "inb_upd"), {
        read: true,
        readAt: new Date(),
      })
    );
  });

  test("update: owner cannot update title or body", async () => {
    await seedPath(["users", "uidA", "inbox", "inb_upd2"], {
      title: "Original",
      body: "original content",
      read: false,
    });
    await assertFails(
      updateDoc(doc(memberA(), "users", "uidA", "inbox", "inb_upd2"), {
        title: "Hacked",
      })
    );
  });

  test("update: admin can update any field", async () => {
    await seedPath(["users", "uidA", "inbox", "inb_upd3"], {
      title: "Original",
      body: "original",
      read: false,
    });
    await assertSucceeds(
      updateDoc(doc(admin(), "users", "uidA", "inbox", "inb_upd3"), {
        title: "Admin Updated",
      })
    );
  });

  test("delete: owner can delete non-pending action message", async () => {
    await seedPath(["users", "uidA", "inbox", "inb_del"], {
      title: "Delete me",
      body: "content",
      read: true,
    });
    await assertSucceeds(
      deleteDoc(doc(memberA(), "users", "uidA", "inbox", "inb_del"))
    );
  });

  test("delete: owner cannot delete pending action message", async () => {
    await seedPath(["users", "uidA", "inbox", "inb_del_pending"], {
      title: "Action Required",
      body: "Please approve",
      actionType: "team_join_request",
      actionStatus: "pending",
    });
    await assertFails(
      deleteDoc(doc(memberA(), "users", "uidA", "inbox", "inb_del_pending"))
    );
  });

  test("delete: admin can delete any inbox message including pending", async () => {
    await seedPath(["users", "uidA", "inbox", "inb_del_admin"], {
      title: "Pending",
      actionType: "team_join_request",
      actionStatus: "pending",
    });
    await assertSucceeds(
      deleteDoc(doc(admin(), "users", "uidA", "inbox", "inb_del_admin"))
    );
  });

  test("delete: non-owner cannot delete", async () => {
    await seedPath(["users", "uidA", "inbox", "inb_del_other"], {
      title: "Private",
      body: "content",
    });
    await assertFails(
      deleteDoc(doc(memberB(), "users", "uidA", "inbox", "inb_del_other"))
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  tournaments
// ═══════════════════════════════════════════════════════════════
describe("/tournaments/{tournamentId}", () => {
  test("read: public (all can read)", async () => {
    await assertByRole(
      ({ db }) => getDoc(doc(db, "tournaments", "tourA")),
      allowAll
    );
  });

  test("create: captain of hostTeam can create", async () => {
    await assertSucceeds(
      setDoc(doc(captain(), "tournaments", "tourNew"), {
        name: "New Tournament",
        hostTeamId: "teamA",
        creatorUid: "uidCaptain",
        mode: "league",
      })
    );
  });

  test("create: admin can create", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "tournaments", "tourAdmin"), {
        name: "Admin Tournament",
        hostTeamId: "teamA",
        creatorUid: "uidAdmin",
        mode: "knockout",
      })
    );
  });

  test("create: regular user cannot create", async () => {
    await assertFails(
      setDoc(doc(user(), "tournaments", "tourUser"), {
        name: "User Tournament",
        hostTeamId: "teamA",
        creatorUid: "uidUser",
        mode: "knockout",
      })
    );
  });

  test("create: guest cannot create", async () => {
    await assertFails(
      setDoc(doc(guest(), "tournaments", "tourGuest"), {
        name: "Guest Tournament",
        hostTeamId: "teamA",
        creatorUid: "nobody",
        mode: "knockout",
      })
    );
  });

  test("update: admin can update", async () => {
    await assertSucceeds(
      updateDoc(doc(admin(), "tournaments", "tourA"), {
        name: "Updated Tournament",
        hostTeamId: "teamA",
        creatorUid: "uidCaptain",
        mode: "knockout",
      })
    );
  });

  test("update: delegate can update (preserving immutable fields)", async () => {
    // uidA is in delegateUids
    await assertSucceeds(
      updateDoc(doc(memberA(), "tournaments", "tourA"), {
        name: "Delegate Updated",
        hostTeamId: "teamA",
        creatorUid: "uidCaptain",
        mode: "knockout",
      })
    );
  });

  test("update: host team captain can update", async () => {
    await assertSucceeds(
      updateDoc(doc(captain(), "tournaments", "tourA"), {
        name: "Captain Updated",
        hostTeamId: "teamA",
        creatorUid: "uidCaptain",
        mode: "knockout",
      })
    );
  });

  test("update: random user cannot update", async () => {
    await assertFails(
      updateDoc(doc(user(), "tournaments", "tourA"), {
        name: "User Updated",
        hostTeamId: "teamA",
        creatorUid: "uidCaptain",
        mode: "knockout",
      })
    );
  });

  test("update: non-admin delegate cannot change immutable fields", async () => {
    // admin bypasses immutable check by design; use delegate to test field lock
    const delegateDb = testEnv.authenticatedContext("uidDelegate", { role: "coach" }).firestore();
    await seedDoc("tournaments", "tourA", {
      name: "Cup", hostTeamId: "teamA", creatorUid: "uidCaptain", mode: "friendly",
      delegateUids: ["uidDelegate"],
    });
    await assertFails(
      updateDoc(doc(delegateDb, "tournaments", "tourA"), {
        name: "Changed",
        hostTeamId: "teamB",
        creatorUid: "uidCaptain",
        mode: "knockout",
      })
    );
  });

  test("delete: only admin can delete", async () => {
    await seedDoc("tournaments", "tourDel", {
      name: "Delete Me",
      hostTeamId: "teamA",
      creatorUid: "uidCaptain",
      mode: "knockout",
    });
    await assertFails(deleteDoc(doc(memberA(), "tournaments", "tourDel")));
    await assertFails(deleteDoc(doc(captain(), "tournaments", "tourDel")));
    await assertSucceeds(deleteDoc(doc(admin(), "tournaments", "tourDel")));
  });
});

// ═══════════════════════════════════════════════════════════════
//  tournaments/{id}/applications
// ═══════════════════════════════════════════════════════════════
describe("/tournaments/{id}/applications/{appId}", () => {
  test("read: scope manager (delegate) can read", async () => {
    await seedPath(["tournaments", "tourA", "applications", "app1"], {
      teamId: "teamB",
      status: "pending",
    });
    // uidA is delegate
    await assertSucceeds(
      getDoc(doc(memberA(), "tournaments", "tourA", "applications", "app1"))
    );
  });

  test("read: team member of applicant team can read own application", async () => {
    await seedPath(["tournaments", "tourA", "applications", "app_teamB"], {
      teamId: "teamB",
      status: "pending",
    });
    // uidB is in teamB
    await assertSucceeds(
      getDoc(doc(memberB(), "tournaments", "tourA", "applications", "app_teamB"))
    );
  });

  test("read: unrelated user cannot read", async () => {
    await seedPath(["tournaments", "tourA", "applications", "app_secret"], {
      teamId: "teamB",
      status: "pending",
    });
    await assertFails(
      getDoc(doc(user(), "tournaments", "tourA", "applications", "app_secret"))
    );
  });

  test("create: captain of team can apply", async () => {
    await assertSucceeds(
      setDoc(
        doc(captain(), "tournaments", "tourA", "applications", "app_teamA"),
        { teamId: "teamA", status: "pending" }
      )
    );
  });

  test("create: non-captain cannot apply", async () => {
    await assertFails(
      setDoc(
        doc(user(), "tournaments", "tourA", "applications", "app_userTeam"),
        { teamId: "teamA", status: "pending" }
      )
    );
  });

  test("update: scope manager can update", async () => {
    await seedPath(["tournaments", "tourA", "applications", "app_upd"], {
      teamId: "teamB",
      status: "pending",
    });
    await assertSucceeds(
      updateDoc(
        doc(memberA(), "tournaments", "tourA", "applications", "app_upd"),
        { status: "approved" }
      )
    );
  });

  test("delete: scope manager can delete", async () => {
    await seedPath(["tournaments", "tourA", "applications", "app_del"], {
      teamId: "teamB",
      status: "rejected",
    });
    await assertSucceeds(
      deleteDoc(
        doc(admin(), "tournaments", "tourA", "applications", "app_del")
      )
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  tournaments/{id}/entries and entries/{id}/members
// ═══════════════════════════════════════════════════════════════
describe("/tournaments/{id}/entries/{teamId}", () => {
  test("read: public", async () => {
    await assertByRole(
      ({ db }) =>
        getDoc(doc(db, "tournaments", "tourA", "entries", "teamA")),
      allowAll
    );
  });

  test("create: scope manager can create", async () => {
    await assertSucceeds(
      setDoc(
        doc(admin(), "tournaments", "tourA", "entries", "teamB"),
        { teamId: "teamB", status: "confirmed" }
      )
    );
  });

  test("create: non-scope cannot create", async () => {
    await assertFails(
      setDoc(
        doc(user(), "tournaments", "tourA", "entries", "teamB"),
        { teamId: "teamB", status: "confirmed" }
      )
    );
  });

  test("update: scope manager can update", async () => {
    await assertSucceeds(
      updateDoc(
        doc(memberA(), "tournaments", "tourA", "entries", "teamA"),
        { status: "eliminated" }
      )
    );
  });

  test("delete: scope manager can delete", async () => {
    await seedPath(["tournaments", "tourA", "entries", "teamDel"], {
      teamId: "teamDel",
      status: "confirmed",
    });
    await assertSucceeds(
      deleteDoc(doc(admin(), "tournaments", "tourA", "entries", "teamDel"))
    );
  });
});

describe("/tournaments/{id}/entries/{teamId}/members/{memberUid}", () => {
  test("read: public", async () => {
    await seedPath(
      ["tournaments", "tourA", "entries", "teamA", "members", "uidA"],
      { name: "Member A", joinedAt: new Date() }
    );
    await assertSucceeds(
      getDoc(
        doc(guest(), "tournaments", "tourA", "entries", "teamA", "members", "uidA")
      )
    );
    await assertSucceeds(
      getDoc(
        doc(user(), "tournaments", "tourA", "entries", "teamA", "members", "uidA")
      )
    );
  });

  test("create: scope manager can add member", async () => {
    await assertSucceeds(
      setDoc(
        doc(admin(), "tournaments", "tourA", "entries", "teamA", "members", "uidNew"),
        { name: "New Member" }
      )
    );
  });

  test("create: self-join by team member with entry existing", async () => {
    // uidA is in teamA, teamA entry exists
    await assertSucceeds(
      setDoc(
        doc(memberA(), "tournaments", "tourA", "entries", "teamA", "members", "uidA"),
        { name: "Self Join" }
      )
    );
  });

  test("create: non-team-member cannot self-join", async () => {
    // uidUser is not in teamA
    await assertFails(
      setDoc(
        doc(user(), "tournaments", "tourA", "entries", "teamA", "members", "uidUser"),
        { name: "Hack Join" }
      )
    );
  });

  test("delete: scope manager can remove member", async () => {
    await seedPath(
      ["tournaments", "tourA", "entries", "teamA", "members", "uidDel"],
      { name: "Del Member" }
    );
    await assertSucceeds(
      deleteDoc(
        doc(admin(), "tournaments", "tourA", "entries", "teamA", "members", "uidDel")
      )
    );
  });

  test("delete: self can leave", async () => {
    await seedPath(
      ["tournaments", "tourA", "entries", "teamA", "members", "uidA"],
      { name: "Leave Member" }
    );
    await assertSucceeds(
      deleteDoc(
        doc(memberA(), "tournaments", "tourA", "entries", "teamA", "members", "uidA")
      )
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  announcements
// ═══════════════════════════════════════════════════════════════
describe("/announcements/{annId}", () => {
  test("read: public", async () => {
    await seedDoc("announcements", "ann1", {
      title: "Announcement 1",
      body: "Hello World",
    });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "announcements", "ann1")),
      allowAll
    );
  });

  test("create: admin/superAdmin can create", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "announcements", "ann_admin"), {
        title: "Admin Ann",
      })
    );
    await assertSucceeds(
      setDoc(doc(superAdmin(), "announcements", "ann_sa"), {
        title: "SA Ann",
      })
    );
  });

  test("create: regular user cannot create", async () => {
    await assertFails(
      setDoc(doc(user(), "announcements", "ann_user"), {
        title: "User Ann",
      })
    );
    await assertFails(
      setDoc(doc(guest(), "announcements", "ann_guest"), {
        title: "Guest Ann",
      })
    );
  });

  test("update: admin can update", async () => {
    await seedDoc("announcements", "ann_upd", { title: "Original" });
    await assertSucceeds(
      updateDoc(doc(admin(), "announcements", "ann_upd"), {
        title: "Updated",
      })
    );
  });

  test("delete: admin can delete", async () => {
    await seedDoc("announcements", "ann_del", { title: "Delete Me" });
    await assertSucceeds(
      deleteDoc(doc(admin(), "announcements", "ann_del"))
    );
  });

  test("CUD: user with admin.announcements.entry perm can write", async () => {
    await seedRolePermissions("content_manager", [
      "admin.announcements.entry",
    ]);
    await assertSucceeds(
      setDoc(doc(contentManager(), "announcements", "ann_cm"), {
        title: "CM Ann",
      })
    );
    await assertSucceeds(
      updateDoc(doc(contentManager(), "announcements", "ann_cm"), {
        title: "CM Updated",
      })
    );
    await assertSucceeds(
      deleteDoc(doc(contentManager(), "announcements", "ann_cm"))
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  achievements (top-level) and badges
// ═══════════════════════════════════════════════════════════════
describe("/achievements/{achId}", () => {
  test("read: public", async () => {
    await seedDoc("achievements", "ach1", { name: "First Goal" });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "achievements", "ach1")),
      allowAll
    );
  });

  test("write: admin/superAdmin can write", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "achievements", "ach_admin"), { name: "Admin Ach" })
    );
    await assertSucceeds(
      setDoc(doc(superAdmin(), "achievements", "ach_sa"), { name: "SA Ach" })
    );
  });

  test("write: user cannot write", async () => {
    await assertFails(
      setDoc(doc(user(), "achievements", "ach_user"), { name: "User Ach" })
    );
  });

  test("write: hasPerm user can write", async () => {
    await seedRolePermissions("content_manager", [
      "admin.achievements.entry",
    ]);
    await assertSucceeds(
      setDoc(doc(contentManager(), "achievements", "ach_cm"), { name: "CM Ach" })
    );
  });
});

describe("/badges/{badgeId}", () => {
  test("read: public", async () => {
    await seedDoc("badges", "badge1", { name: "Gold Badge" });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "badges", "badge1")),
      allowAll
    );
  });

  test("write: admin can write", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "badges", "badge_admin"), { name: "Admin Badge" })
    );
  });

  test("write: user cannot write", async () => {
    await assertFails(
      setDoc(doc(user(), "badges", "badge_user"), { name: "User Badge" })
    );
  });

  test("write: hasPerm(admin.achievements.entry) can write", async () => {
    await seedRolePermissions("content_manager", [
      "admin.achievements.entry",
    ]);
    await assertSucceeds(
      setDoc(doc(contentManager(), "badges", "badge_cm"), { name: "CM Badge" })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  banners / floatingAds / sponsors (no delete)
// ═══════════════════════════════════════════════════════════════
describe("/banners/{bannerId}", () => {
  test("read: public", async () => {
    await seedDoc("banners", "ban1", { title: "Banner 1" });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "banners", "ban1")),
      allowAll
    );
  });

  test("create/update: admin can", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "banners", "ban_admin"), { title: "Admin Banner" })
    );
    await assertSucceeds(
      updateDoc(doc(admin(), "banners", "ban_admin"), { title: "Updated" })
    );
  });

  test("create/update: user cannot", async () => {
    await assertFails(
      setDoc(doc(user(), "banners", "ban_user"), { title: "User Banner" })
    );
  });

  test("delete: always denied", async () => {
    await seedDoc("banners", "ban_del", { title: "Delete" });
    await assertFails(deleteDoc(doc(admin(), "banners", "ban_del")));
    await assertFails(deleteDoc(doc(superAdmin(), "banners", "ban_del")));
  });

  test("hasPerm(admin.banners.entry) can create/update", async () => {
    await seedRolePermissions("content_manager", ["admin.banners.entry"]);
    await assertSucceeds(
      setDoc(doc(contentManager(), "banners", "ban_cm"), { title: "CM Banner" })
    );
    await assertSucceeds(
      updateDoc(doc(contentManager(), "banners", "ban_cm"), {
        title: "CM Updated",
      })
    );
  });
});

describe("/floatingAds/{adId}", () => {
  test("read: public", async () => {
    await seedDoc("floatingAds", "fad1", { title: "FloatingAd 1" });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "floatingAds", "fad1")),
      allowAll
    );
  });

  test("create/update: admin can", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "floatingAds", "fad_admin"), { title: "Admin" })
    );
  });

  test("create/update: user cannot", async () => {
    await assertFails(
      setDoc(doc(user(), "floatingAds", "fad_user"), { title: "User" })
    );
  });

  test("delete: always denied", async () => {
    await seedDoc("floatingAds", "fad_del", { title: "Del" });
    await assertFails(deleteDoc(doc(admin(), "floatingAds", "fad_del")));
    await assertFails(deleteDoc(doc(superAdmin(), "floatingAds", "fad_del")));
  });

  test("hasPerm(admin.banners.entry) can create/update", async () => {
    await seedRolePermissions("content_manager", ["admin.banners.entry"]);
    await assertSucceeds(
      setDoc(doc(contentManager(), "floatingAds", "fad_cm"), { title: "CM" })
    );
  });
});

describe("/sponsors/{sponsorId}", () => {
  test("read: public", async () => {
    await seedDoc("sponsors", "sp1", { name: "Sponsor 1" });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "sponsors", "sp1")),
      allowAll
    );
  });

  test("create/update: admin can", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "sponsors", "sp_admin"), { name: "Admin Sponsor" })
    );
  });

  test("delete: always denied", async () => {
    await seedDoc("sponsors", "sp_del", { name: "Del" });
    await assertFails(deleteDoc(doc(admin(), "sponsors", "sp_del")));
  });

  test("hasPerm(admin.banners.entry) can create/update", async () => {
    await seedRolePermissions("content_manager", ["admin.banners.entry"]);
    await assertSucceeds(
      setDoc(doc(contentManager(), "sponsors", "sp_cm"), { name: "CM Sponsor" })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  popupAds
// ═══════════════════════════════════════════════════════════════
describe("/popupAds/{adId}", () => {
  test("read: public", async () => {
    await seedDoc("popupAds", "pop1", { title: "Popup 1" });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "popupAds", "pop1")),
      allowAll
    );
  });

  test("write: admin can write (including delete)", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "popupAds", "pop_admin"), { title: "Admin Popup" })
    );
    await assertSucceeds(
      updateDoc(doc(admin(), "popupAds", "pop_admin"), { title: "Updated" })
    );
    await assertSucceeds(deleteDoc(doc(admin(), "popupAds", "pop_admin")));
  });

  test("write: user cannot write", async () => {
    await assertFails(
      setDoc(doc(user(), "popupAds", "pop_user"), { title: "User Popup" })
    );
  });

  test("write: hasPerm(admin.banners.entry) can write", async () => {
    await seedRolePermissions("content_manager", ["admin.banners.entry"]);
    await assertSucceeds(
      setDoc(doc(contentManager(), "popupAds", "pop_cm"), { title: "CM Popup" })
    );
    await assertSucceeds(
      deleteDoc(doc(contentManager(), "popupAds", "pop_cm"))
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  newsArticles (public read, no client write)
// ═══════════════════════════════════════════════════════════════
describe("/newsArticles/{articleId}", () => {
  test("read: public", async () => {
    await seedDoc("newsArticles", "news1", {
      title: "Sports News",
      body: "Content",
    });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "newsArticles", "news1")),
      allowAll
    );
  });

  test("write: denied for all (only Cloud Function)", async () => {
    await assertByRole(
      ({ db, role }) =>
        setDoc(doc(db, "newsArticles", `news_create_${role}`), {
          title: "New",
        }),
      denyAll
    );
  });

  test("update: denied for all", async () => {
    await seedDoc("newsArticles", "news_upd", { title: "Original" });
    await assertByRole(
      ({ db }) =>
        updateDoc(doc(db, "newsArticles", "news_upd"), { title: "Updated" }),
      denyAll
    );
  });

  test("delete: denied for all", async () => {
    await seedDoc("newsArticles", "news_del", { title: "Delete" });
    await assertByRole(
      async ({ db, role }) => {
        const id = `news_del_${role}`;
        await seedDoc("newsArticles", id, { title: "Seed" });
        return deleteDoc(doc(db, "newsArticles", id));
      },
      denyAll
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  siteThemes (public read, admin/hasPerm write, no delete)
// ═══════════════════════════════════════════════════════════════
describe("/siteThemes/{themeId}", () => {
  test("read: public", async () => {
    await seedDoc("siteThemes", "theme1", { name: "Dark" });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "siteThemes", "theme1")),
      allowAll
    );
  });

  test("create/update: admin can", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "siteThemes", "theme_admin"), { name: "Admin Theme" })
    );
    await assertSucceeds(
      updateDoc(doc(admin(), "siteThemes", "theme_admin"), {
        name: "Updated",
      })
    );
  });

  test("create/update: user cannot", async () => {
    await assertFails(
      setDoc(doc(user(), "siteThemes", "theme_user"), { name: "User Theme" })
    );
  });

  test("delete: always denied", async () => {
    await seedDoc("siteThemes", "theme_del", { name: "Del" });
    await assertFails(deleteDoc(doc(admin(), "siteThemes", "theme_del")));
    await assertFails(deleteDoc(doc(superAdmin(), "siteThemes", "theme_del")));
  });

  test("hasPerm(admin.themes.entry) can create/update", async () => {
    await seedRolePermissions("content_manager", ["admin.themes.entry"]);
    await assertSucceeds(
      setDoc(doc(contentManager(), "siteThemes", "theme_cm"), { name: "CM" })
    );
    await assertSucceeds(
      updateDoc(doc(contentManager(), "siteThemes", "theme_cm"), {
        name: "CM Updated",
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  siteConfig (auth read, admin/hasPerm write, no delete)
// ═══════════════════════════════════════════════════════════════
describe("/siteConfig/{docId}", () => {
  test("read: authenticated only", async () => {
    await seedDoc("siteConfig", "autoExp", { rules: [] });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "siteConfig", "autoExp")),
      allowAuth
    );
  });

  test("create/update: admin can", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "siteConfig", "cfg_admin"), { setting: true })
    );
    await assertSucceeds(
      updateDoc(doc(admin(), "siteConfig", "cfg_admin"), { setting: false })
    );
  });

  test("create/update: user cannot", async () => {
    await assertFails(
      setDoc(doc(user(), "siteConfig", "cfg_user"), { setting: true })
    );
  });

  test("delete: always denied", async () => {
    await seedDoc("siteConfig", "cfg_del", { setting: true });
    await assertFails(deleteDoc(doc(admin(), "siteConfig", "cfg_del")));
    await assertFails(deleteDoc(doc(superAdmin(), "siteConfig", "cfg_del")));
  });

  test("hasPerm(admin.auto_exp.entry) can create/update only autoExpRules", async () => {
    await seedRolePermissions("content_manager", ["admin.auto_exp.entry"]);
    await assertSucceeds(
      setDoc(doc(contentManager(), "siteConfig", "autoExpRules"), { setting: true })
    );
    await assertSucceeds(
      updateDoc(doc(contentManager(), "siteConfig", "autoExpRules"), { setting: false })
    );
  });

  test("hasPerm(admin.auto_exp.entry) cannot write featureFlags or other siteConfig docs", async () => {
    await seedRolePermissions("content_manager", ["admin.auto_exp.entry"]);
    await assertFails(
      setDoc(doc(contentManager(), "siteConfig", "featureFlags"), {
        notificationToggles: { category_activity: false },
      })
    );
    await assertFails(
      setDoc(doc(contentManager(), "siteConfig", "bootBrand"), { setting: true })
    );
  });

  test("hasPerm(admin.notif.toggle) can create featureFlags.notificationToggles only", async () => {
    await seedRolePermissions("content_manager", ["admin.notif.toggle"]);
    await assertSucceeds(
      setDoc(
        doc(contentManager(), "siteConfig", "featureFlags"),
        { notificationToggles: { category_activity: false, type_signup_success: true } },
        { merge: true }
      )
    );
  });

  test("hasPerm(admin.notif.toggle) can update only notificationToggles on featureFlags", async () => {
    await seedRolePermissions("content_manager", ["admin.notif.toggle"]);
    await seedDoc("siteConfig", "featureFlags", {
      useServerRegistration: true,
      notificationToggles: { category_activity: true },
    });
    await assertSucceeds(
      updateDoc(doc(contentManager(), "siteConfig", "featureFlags"), {
        notificationToggles: { category_activity: false, type_welcome: false },
      })
    );
  });

  test("hasPerm(admin.notif.toggle) cannot write other siteConfig docs", async () => {
    await seedRolePermissions("content_manager", ["admin.notif.toggle"]);
    await assertFails(
      setDoc(doc(contentManager(), "siteConfig", "bootBrand"), {
        notificationToggles: { category_activity: false },
      })
    );
  });

  test("hasPerm(admin.notif.toggle) cannot create featureFlags with extra fields", async () => {
    await seedRolePermissions("content_manager", ["admin.notif.toggle"]);
    await assertFails(
      setDoc(doc(contentManager(), "siteConfig", "featureFlags"), {
        notificationToggles: { category_activity: false },
        useServerRegistration: true,
      })
    );
  });

  test("hasPerm(admin.notif.toggle) cannot update other fields on featureFlags", async () => {
    await seedRolePermissions("content_manager", ["admin.notif.toggle"]);
    await seedDoc("siteConfig", "featureFlags", {
      useServerRegistration: true,
      notificationToggles: { category_activity: true },
    });
    await assertFails(
      updateDoc(doc(contentManager(), "siteConfig", "featureFlags"), {
        useServerRegistration: false,
      })
    );
  });

  test("hasPerm(admin.notif.toggle) rejects unknown notification toggle keys", async () => {
    await seedRolePermissions("content_manager", ["admin.notif.toggle"]);
    await assertFails(
      setDoc(doc(contentManager(), "siteConfig", "featureFlags"), {
        notificationToggles: { debug_mode: true },
      })
    );
  });

  test("hasPerm(admin.notif.toggle) rejects non-boolean notification toggle values", async () => {
    await seedRolePermissions("content_manager", ["admin.notif.toggle"]);
    await assertFails(
      setDoc(doc(contentManager(), "siteConfig", "featureFlags"), {
        notificationToggles: { category_activity: "false" },
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  gameConfigs (public read, admin/hasPerm write, no delete)
// ═══════════════════════════════════════════════════════════════
describe("/gameConfigs/{configId}", () => {
  test("read: public", async () => {
    await seedDoc("gameConfigs", "gc1", { enabled: true });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "gameConfigs", "gc1")),
      allowAll
    );
  });

  test("create/update: admin can", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "gameConfigs", "gc_admin"), { enabled: true })
    );
    await assertSucceeds(
      updateDoc(doc(admin(), "gameConfigs", "gc_admin"), { enabled: false })
    );
  });

  test("create/update: user cannot", async () => {
    await assertFails(
      setDoc(doc(user(), "gameConfigs", "gc_user"), { enabled: true })
    );
  });

  test("delete: always denied", async () => {
    await seedDoc("gameConfigs", "gc_del", { enabled: true });
    await assertFails(deleteDoc(doc(admin(), "gameConfigs", "gc_del")));
    await assertFails(deleteDoc(doc(superAdmin(), "gameConfigs", "gc_del")));
  });

  test("hasPerm(admin.games.entry) can create/update", async () => {
    await seedRolePermissions("content_manager", ["admin.games.entry"]);
    await assertSucceeds(
      setDoc(doc(contentManager(), "gameConfigs", "gc_cm"), { enabled: true })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  notifTemplates (auth read, admin write, no delete)
// ═══════════════════════════════════════════════════════════════
describe("/notifTemplates/{templateId}", () => {
  test("read: authenticated only", async () => {
    await seedDoc("notifTemplates", "nt1", { title: "Welcome" });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "notifTemplates", "nt1")),
      allowAuth
    );
  });

  test("create/update: admin can", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "notifTemplates", "nt_admin"), { title: "Admin" })
    );
    await assertSucceeds(
      updateDoc(doc(admin(), "notifTemplates", "nt_admin"), {
        title: "Updated",
      })
    );
  });

  test("create/update: user cannot", async () => {
    await assertFails(
      setDoc(doc(user(), "notifTemplates", "nt_user"), { title: "User" })
    );
  });

  test("delete: always denied", async () => {
    await seedDoc("notifTemplates", "nt_del", { title: "Del" });
    await assertFails(deleteDoc(doc(admin(), "notifTemplates", "nt_del")));
    await assertFails(deleteDoc(doc(superAdmin(), "notifTemplates", "nt_del")));
  });

  test("hasPerm does not bypass admin-only write", async () => {
    await seedRolePermissions("content_manager", [
      "admin.announcements.entry",
    ]);
    await assertFails(
      setDoc(doc(contentManager(), "notifTemplates", "nt_cm"), {
        title: "CM",
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  adminMessages
// ═══════════════════════════════════════════════════════════════
describe("/adminMessages/{msgId}", () => {
  test("read: authenticated only", async () => {
    await seedDoc("adminMessages", "am1", { title: "Broadcast" });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "adminMessages", "am1")),
      allowAuth
    );
  });

  test("write: admin can write", async () => {
    await assertSucceeds(
      setDoc(doc(admin(), "adminMessages", "am_admin"), { title: "Admin" })
    );
    await assertSucceeds(
      updateDoc(doc(admin(), "adminMessages", "am_admin"), {
        title: "Updated",
      })
    );
    await assertSucceeds(
      deleteDoc(doc(admin(), "adminMessages", "am_admin"))
    );
  });

  test("write: user cannot write", async () => {
    await assertFails(
      setDoc(doc(user(), "adminMessages", "am_user"), { title: "User" })
    );
  });

  test("hasPerm(admin.messages.entry) can write", async () => {
    await seedRolePermissions("content_manager", ["admin.messages.entry"]);
    await assertSucceeds(
      setDoc(doc(contentManager(), "adminMessages", "am_cm"), { title: "CM" })
    );
    await assertSucceeds(
      deleteDoc(doc(contentManager(), "adminMessages", "am_cm"))
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  matches / standings
// ═══════════════════════════════════════════════════════════════
describe("/matches/{matchId}", () => {
  test("read: public", async () => {
    await seedDoc("matches", "match1", { teamA: "a", teamB: "b" });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "matches", "match1")),
      allowAll
    );
  });

  test("write: admin only", async () => {
    await assertByRole(
      ({ db, role }) =>
        setDoc(doc(db, "matches", `match_create_${role}`), { score: "1-0" }),
      allowAdminAndSuper
    );
  });

  test("update: admin only", async () => {
    await seedDoc("matches", "match_upd", { score: "0-0" });
    await assertFails(
      updateDoc(doc(user(), "matches", "match_upd"), { score: "1-0" })
    );
    await assertSucceeds(
      updateDoc(doc(admin(), "matches", "match_upd"), { score: "1-0" })
    );
  });

  test("delete: admin only", async () => {
    await seedDoc("matches", "match_del", { score: "1-1" });
    await assertFails(deleteDoc(doc(user(), "matches", "match_del")));
    await assertSucceeds(deleteDoc(doc(admin(), "matches", "match_del")));
  });
});

describe("/standings/{standingId}", () => {
  test("read: public", async () => {
    await seedDoc("standings", "st1", { team: "teamA", points: 3 });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "standings", "st1")),
      allowAll
    );
  });

  test("write: admin only", async () => {
    await assertByRole(
      ({ db, role }) =>
        setDoc(doc(db, "standings", `st_create_${role}`), { points: 0 }),
      allowAdminAndSuper
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  shotGameScores / shotGameRankings
// ═══════════════════════════════════════════════════════════════
describe("/shotGameScores/{uid}/attempts/{attemptId}", () => {
  test("read: owner can read own attempts", async () => {
    await seedPath(["shotGameScores", "uidA", "attempts", "att1"], {
      score: 100,
      createdAt: new Date(),
    });
    await assertSucceeds(
      getDoc(doc(memberA(), "shotGameScores", "uidA", "attempts", "att1"))
    );
  });

  test("read: admin can read any user attempts", async () => {
    await seedPath(["shotGameScores", "uidA", "attempts", "att1"], {
      score: 100,
    });
    await assertSucceeds(
      getDoc(doc(admin(), "shotGameScores", "uidA", "attempts", "att1"))
    );
    await assertSucceeds(
      getDoc(doc(superAdmin(), "shotGameScores", "uidA", "attempts", "att1"))
    );
  });

  test("read: non-owner non-admin cannot read", async () => {
    await seedPath(["shotGameScores", "uidA", "attempts", "att1"], {
      score: 100,
    });
    await assertFails(
      getDoc(doc(memberB(), "shotGameScores", "uidA", "attempts", "att1"))
    );
    await assertFails(
      getDoc(doc(user(), "shotGameScores", "uidA", "attempts", "att1"))
    );
  });

  test("read: guest cannot read", async () => {
    await seedPath(["shotGameScores", "uidA", "attempts", "att1"], {
      score: 100,
    });
    await assertFails(
      getDoc(doc(guest(), "shotGameScores", "uidA", "attempts", "att1"))
    );
  });

  test("write: denied for all (Cloud Function only)", async () => {
    await assertFails(
      setDoc(
        doc(memberA(), "shotGameScores", "uidA", "attempts", "att_hack"),
        { score: 999 }
      )
    );
    await assertFails(
      setDoc(
        doc(admin(), "shotGameScores", "uidA", "attempts", "att_admin"),
        { score: 999 }
      )
    );
    await assertFails(
      setDoc(
        doc(superAdmin(), "shotGameScores", "uidA", "attempts", "att_sa"),
        { score: 999 }
      )
    );
  });
});

describe("/shotGameRankings/{periodBucket}/entries/{entryUid}", () => {
  test("read: authenticated can read", async () => {
    await seedPath(
      ["shotGameRankings", "weekly_2026w13", "entries", "uidA"],
      { bestScore: 150, displayName: "A" }
    );
    await assertSucceeds(
      getDoc(
        doc(memberA(), "shotGameRankings", "weekly_2026w13", "entries", "uidA")
      )
    );
    await assertSucceeds(
      getDoc(
        doc(memberB(), "shotGameRankings", "weekly_2026w13", "entries", "uidA")
      )
    );
  });

  test("read: guest cannot read", async () => {
    await seedPath(
      ["shotGameRankings", "weekly_2026w13", "entries", "uidA"],
      { bestScore: 150 }
    );
    await assertFails(
      getDoc(
        doc(guest(), "shotGameRankings", "weekly_2026w13", "entries", "uidA")
      )
    );
  });

  test("write: denied for all", async () => {
    await assertFails(
      setDoc(
        doc(admin(), "shotGameRankings", "weekly_2026w13", "entries", "uidHack"),
        { bestScore: 999 }
      )
    );
    await assertFails(
      setDoc(
        doc(
          superAdmin(),
          "shotGameRankings",
          "weekly_2026w13",
          "entries",
          "uidHack"
        ),
        { bestScore: 999 }
      )
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  kickGameScores / kickGameRankings
// ═══════════════════════════════════════════════════════════════
describe("/kickGameScores/{uid}/attempts/{attemptId}", () => {
  test("read: owner can read own attempts", async () => {
    await seedPath(["kickGameScores", "uidA", "attempts", "att1"], {
      score: 50,
    });
    await assertSucceeds(
      getDoc(doc(memberA(), "kickGameScores", "uidA", "attempts", "att1"))
    );
  });

  test("read: admin can read any", async () => {
    await seedPath(["kickGameScores", "uidA", "attempts", "att1"], {
      score: 50,
    });
    await assertSucceeds(
      getDoc(doc(admin(), "kickGameScores", "uidA", "attempts", "att1"))
    );
  });

  test("read: non-owner non-admin cannot read", async () => {
    await seedPath(["kickGameScores", "uidA", "attempts", "att1"], {
      score: 50,
    });
    await assertFails(
      getDoc(doc(memberB(), "kickGameScores", "uidA", "attempts", "att1"))
    );
  });

  test("write: denied for all", async () => {
    await assertFails(
      setDoc(
        doc(memberA(), "kickGameScores", "uidA", "attempts", "att_hack"),
        { score: 999 }
      )
    );
    await assertFails(
      setDoc(
        doc(admin(), "kickGameScores", "uidA", "attempts", "att_admin"),
        { score: 999 }
      )
    );
  });
});

describe("/kickGameRankings/{periodBucket}/entries/{entryUid}", () => {
  test("read: authenticated can read", async () => {
    await seedPath(
      ["kickGameRankings", "weekly_2026w13", "entries", "uidA"],
      { bestScore: 80 }
    );
    await assertSucceeds(
      getDoc(
        doc(memberA(), "kickGameRankings", "weekly_2026w13", "entries", "uidA")
      )
    );
  });

  test("read: guest cannot read", async () => {
    await seedPath(
      ["kickGameRankings", "weekly_2026w13", "entries", "uidA"],
      { bestScore: 80 }
    );
    await assertFails(
      getDoc(
        doc(guest(), "kickGameRankings", "weekly_2026w13", "entries", "uidA")
      )
    );
  });

  test("write: denied for all", async () => {
    await assertFails(
      setDoc(
        doc(admin(), "kickGameRankings", "weekly_2026w13", "entries", "uidHack"),
        { bestScore: 999 }
      )
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  eduAttendance (auth read/write)
// ═══════════════════════════════════════════════════════════════
describe("/eduAttendance/{recordId}", () => {
  test("read: authenticated can read", async () => {
    await seedDoc("eduAttendance", "edu1", {
      uid: "uidA",
      status: "present",
    });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "eduAttendance", "edu1")),
      allowAuth
    );
  });

  test("create: authenticated can create", async () => {
    await assertByRole(
      ({ db, role }) =>
        setDoc(doc(db, "eduAttendance", `edu_create_${role}`), {
          uid: role,
          status: "present",
        }),
      allowAuth
    );
  });

  test("update: authenticated can update", async () => {
    await seedDoc("eduAttendance", "edu_upd", {
      uid: "uidA",
      status: "present",
    });
    await assertFails(
      updateDoc(doc(guest(), "eduAttendance", "edu_upd"), {
        status: "absent",
      })
    );
    await assertSucceeds(
      updateDoc(doc(memberA(), "eduAttendance", "edu_upd"), {
        status: "absent",
      })
    );
  });

  test("delete: authenticated can delete", async () => {
    await seedDoc("eduAttendance", "edu_del", { uid: "uidA", status: "x" });
    await assertFails(deleteDoc(doc(guest(), "eduAttendance", "edu_del")));
    await assertSucceeds(
      deleteDoc(doc(memberA(), "eduAttendance", "edu_del"))
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  usageMetrics (super_admin read, no client write)
// ═══════════════════════════════════════════════════════════════
describe("/usageMetrics/{dateKey}", () => {
  test("read: super_admin only", async () => {
    await seedDoc("usageMetrics", "20260330", {
      reads: 1000,
      writes: 500,
    });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "usageMetrics", "20260330")),
      allowSuperOnly
    );
  });

  test("write: denied for all", async () => {
    await assertByRole(
      ({ db, role }) =>
        setDoc(doc(db, "usageMetrics", `metrics_${role}`), { reads: 0 }),
      denyAll
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  Inventory system (inv_products, inv_transactions, inv_stocktakes, inv_settings, inv_announcements)
// ═══════════════════════════════════════════════════════════════
describe("/inv_products/{docId}", () => {
  test("read/write: inventory admin can read and write", async () => {
    await assertSucceeds(
      setDoc(doc(invAdmin(), "inv_products", "prod1"), {
        name: "Product 1",
        qty: 10,
      })
    );
    await assertSucceeds(
      getDoc(doc(invAdmin(), "inv_products", "prod1"))
    );
    await assertSucceeds(
      updateDoc(doc(invAdmin(), "inv_products", "prod1"), { qty: 20 })
    );
    await assertSucceeds(
      deleteDoc(doc(invAdmin(), "inv_products", "prod1"))
    );
  });

  test("read/write: super_admin can read and write", async () => {
    await assertSucceeds(
      setDoc(doc(superAdmin(), "inv_products", "prod_sa"), {
        name: "SA Product",
      })
    );
    await assertSucceeds(
      getDoc(doc(superAdmin(), "inv_products", "prod_sa"))
    );
  });

  test("read/write: non-inventory user cannot", async () => {
    await seedDoc("inv_products", "prod_secret", { name: "Secret" });
    await assertFails(getDoc(doc(user(), "inv_products", "prod_secret")));
    await assertFails(
      setDoc(doc(user(), "inv_products", "prod_user"), { name: "User" })
    );
  });

  test("read/write: admin (non-inventory) cannot", async () => {
    await seedDoc("inv_products", "prod_admin_test", { name: "Test" });
    await assertFails(
      getDoc(doc(admin(), "inv_products", "prod_admin_test"))
    );
  });
});

describe("/inv_transactions/{docId}", () => {
  test("read: inventory admin can read", async () => {
    await seedDoc("inv_transactions", "txn1", {
      type: "in",
      quantity: 5,
      operatorUid: "uidInvAdmin",
    });
    await assertSucceeds(
      getDoc(doc(invAdmin(), "inv_transactions", "txn1"))
    );
  });

  test("create: inventory admin with valid data (uid + delta)", async () => {
    await assertSucceeds(
      setDoc(doc(invAdmin(), "inv_transactions", "txn_new"), {
        type: "in",
        delta: 10,
        uid: "uidInvAdmin",
      })
    );
  });

  test("create: inventory admin with valid data (uid + quantity)", async () => {
    await assertSucceeds(
      setDoc(doc(invAdmin(), "inv_transactions", "txn_new_q"), {
        type: "out",
        quantity: 5,
        uid: "uidInvAdmin",
      })
    );
  });

  test("create: inventory admin with valid types", async () => {
    const validTypes = ["in", "out", "return", "adjust", "void", "waste", "gift"];
    for (const t of validTypes) {
      await assertSucceeds(
        setDoc(doc(invAdmin(), "inv_transactions", `txn_${t}`), {
          type: t,
          delta: 1,
          uid: "uidInvAdmin",
        })
      );
    }
  });

  test("create: rejected with invalid type", async () => {
    await assertFails(
      setDoc(doc(invAdmin(), "inv_transactions", "txn_bad_type"), {
        type: "invalid",
        delta: 1,
        uid: "uidInvAdmin",
      })
    );
  });

  test("create: rejected with wrong uid", async () => {
    await assertFails(
      setDoc(doc(invAdmin(), "inv_transactions", "txn_bad_op"), {
        type: "in",
        delta: 1,
        uid: "uidOther",
      })
    );
  });

  test("create: rejected with non-int delta", async () => {
    await assertFails(
      setDoc(doc(invAdmin(), "inv_transactions", "txn_bad_qty"), {
        type: "in",
        delta: 1.5,
        uid: "uidInvAdmin",
      })
    );
  });

  test("update: always denied", async () => {
    await seedDoc("inv_transactions", "txn_upd", {
      type: "in",
      quantity: 5,
      operatorUid: "uidInvAdmin",
    });
    await assertFails(
      updateDoc(doc(invAdmin(), "inv_transactions", "txn_upd"), {
        quantity: 10,
      })
    );
    await assertFails(
      updateDoc(doc(superAdmin(), "inv_transactions", "txn_upd"), {
        quantity: 10,
      })
    );
  });

  test("delete: always denied", async () => {
    await seedDoc("inv_transactions", "txn_del", {
      type: "out",
      quantity: 1,
      operatorUid: "uidInvAdmin",
    });
    await assertFails(
      deleteDoc(doc(invAdmin(), "inv_transactions", "txn_del"))
    );
    await assertFails(
      deleteDoc(doc(superAdmin(), "inv_transactions", "txn_del"))
    );
  });
});

describe("/inv_stocktakes/{docId}", () => {
  test("read/write: inventory admin can", async () => {
    await assertSucceeds(
      setDoc(doc(invAdmin(), "inv_stocktakes", "stk1"), {
        date: "2026-03-30",
        items: [],
      })
    );
    await assertSucceeds(
      getDoc(doc(invAdmin(), "inv_stocktakes", "stk1"))
    );
    await assertSucceeds(
      updateDoc(doc(invAdmin(), "inv_stocktakes", "stk1"), {
        items: [{ id: "p1", qty: 5 }],
      })
    );
    await assertSucceeds(
      deleteDoc(doc(invAdmin(), "inv_stocktakes", "stk1"))
    );
  });

  test("read/write: non-inventory user cannot", async () => {
    await seedDoc("inv_stocktakes", "stk_secret", { date: "2026-03-30" });
    await assertFails(getDoc(doc(user(), "inv_stocktakes", "stk_secret")));
    await assertFails(
      setDoc(doc(user(), "inv_stocktakes", "stk_user"), { date: "x" })
    );
  });
});

describe("/inv_settings/{docId}", () => {
  test("get: any authenticated user can get", async () => {
    // The config doc already exists from seedBaseDocs
    await assertSucceeds(getDoc(doc(user(), "inv_settings", "config")));
    await assertSucceeds(getDoc(doc(memberA(), "inv_settings", "config")));
  });

  test("get: guest cannot get", async () => {
    await assertFails(getDoc(doc(guest(), "inv_settings", "config")));
  });

  test("write: inventory admin can write", async () => {
    await assertSucceeds(
      setDoc(doc(invAdmin(), "inv_settings", "prefs"), {
        theme: "dark",
      })
    );
    await assertSucceeds(
      updateDoc(doc(invAdmin(), "inv_settings", "prefs"), {
        theme: "light",
      })
    );
  });

  test("write: non-inventory user cannot write", async () => {
    await assertFails(
      setDoc(doc(user(), "inv_settings", "prefs"), { theme: "hack" })
    );
  });
});

describe("/inv_announcements/{docId}", () => {
  test("read: any authenticated user can read", async () => {
    await seedDoc("inv_announcements", "ia1", { title: "Notice" });
    await assertSucceeds(
      getDoc(doc(memberA(), "inv_announcements", "ia1"))
    );
    await assertSucceeds(getDoc(doc(user(), "inv_announcements", "ia1")));
  });

  test("read: guest cannot read", async () => {
    await seedDoc("inv_announcements", "ia2", { title: "Notice" });
    await assertFails(getDoc(doc(guest(), "inv_announcements", "ia2")));
  });

  test("CUD: inventory admin can", async () => {
    await assertSucceeds(
      setDoc(doc(invAdmin(), "inv_announcements", "ia_new"), {
        title: "New",
      })
    );
    await assertSucceeds(
      updateDoc(doc(invAdmin(), "inv_announcements", "ia_new"), {
        title: "Updated",
      })
    );
    await assertSucceeds(
      deleteDoc(doc(invAdmin(), "inv_announcements", "ia_new"))
    );
  });

  test("CUD: non-inventory user cannot", async () => {
    await assertFails(
      setDoc(doc(user(), "inv_announcements", "ia_user"), { title: "User" })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  teams/{teamId}/feed
// ═══════════════════════════════════════════════════════════════
describe("/teams/{teamId}/feed/{postId}", () => {
  test("read: authenticated can read", async () => {
    await seedPath(["teams", "teamA", "feed", "post1"], {
      body: "Hello team",
      authorUid: "uidA",
    });
    await assertSucceeds(
      getDoc(doc(memberA(), "teams", "teamA", "feed", "post1"))
    );
    await assertSucceeds(
      getDoc(doc(user(), "teams", "teamA", "feed", "post1"))
    );
  });

  test("read: guest cannot read", async () => {
    await seedPath(["teams", "teamA", "feed", "post1"], { body: "Hello" });
    await assertFails(
      getDoc(doc(guest(), "teams", "teamA", "feed", "post1"))
    );
  });

  test("CUD: authenticated can create/update/delete", async () => {
    await assertSucceeds(
      setDoc(doc(memberA(), "teams", "teamA", "feed", "post_new"), {
        body: "New post",
      })
    );
    await assertSucceeds(
      updateDoc(doc(memberA(), "teams", "teamA", "feed", "post_new"), {
        body: "Updated",
      })
    );
    await assertSucceeds(
      deleteDoc(doc(memberA(), "teams", "teamA", "feed", "post_new"))
    );
  });

  test("CUD: guest cannot create", async () => {
    await assertFails(
      setDoc(doc(guest(), "teams", "teamA", "feed", "post_guest"), {
        body: "Guest post",
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  teams/{teamId}/groups
// ═══════════════════════════════════════════════════════════════
describe("/teams/{teamId}/groups/{groupId}", () => {
  test("read: public", async () => {
    await seedPath(["teams", "teamA", "groups", "grp1"], {
      name: "Group A",
    });
    await assertSucceeds(
      getDoc(doc(guest(), "teams", "teamA", "groups", "grp1"))
    );
    await assertSucceeds(
      getDoc(doc(user(), "teams", "teamA", "groups", "grp1"))
    );
  });

  test("CUD: captain/leader can manage", async () => {
    await assertSucceeds(
      setDoc(doc(captain(), "teams", "teamA", "groups", "grp_new"), {
        name: "New Group",
      })
    );
    await assertSucceeds(
      updateDoc(doc(captain(), "teams", "teamA", "groups", "grp_new"), {
        name: "Updated",
      })
    );
    await assertSucceeds(
      deleteDoc(doc(captain(), "teams", "teamA", "groups", "grp_new"))
    );
  });

  test("CUD: leader (in leaderUids) can manage", async () => {
    await assertSucceeds(
      setDoc(doc(leader(), "teams", "teamA", "groups", "grp_leader"), {
        name: "Leader Group",
      })
    );
  });

  test("CUD: regular user cannot manage", async () => {
    await assertFails(
      setDoc(doc(user(), "teams", "teamA", "groups", "grp_user"), {
        name: "User Group",
      })
    );
  });

  test("CUD: non-team captain cannot manage other team groups", async () => {
    await assertFails(
      setDoc(doc(captain(), "teams", "teamB", "groups", "grp_cross"), {
        name: "Cross Team",
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  teams/{teamId}/coursePlans and enrollments
// ═══════════════════════════════════════════════════════════════
describe("/teams/{teamId}/coursePlans/{planId}", () => {
  test("read: public", async () => {
    await seedPath(["teams", "teamA", "coursePlans", "plan1"], {
      name: "Football 101",
    });
    await assertSucceeds(
      getDoc(doc(guest(), "teams", "teamA", "coursePlans", "plan1"))
    );
  });

  test("CUD: captain/leader/admin can manage", async () => {
    await assertSucceeds(
      setDoc(doc(captain(), "teams", "teamA", "coursePlans", "plan_new"), {
        name: "New Plan",
      })
    );
    await assertSucceeds(
      updateDoc(doc(captain(), "teams", "teamA", "coursePlans", "plan_new"), {
        name: "Updated",
      })
    );
    await assertSucceeds(
      deleteDoc(doc(captain(), "teams", "teamA", "coursePlans", "plan_new"))
    );

    // Admin can too
    await assertSucceeds(
      setDoc(doc(admin(), "teams", "teamA", "coursePlans", "plan_admin"), {
        name: "Admin Plan",
      })
    );
  });

  test("CUD: regular user cannot manage", async () => {
    await assertFails(
      setDoc(doc(user(), "teams", "teamA", "coursePlans", "plan_user"), {
        name: "User Plan",
      })
    );
  });
});

describe("/teams/{teamId}/coursePlans/{planId}/enrollments/{enrollId}", () => {
  beforeEach(async () => {
    await seedPath(["teams", "teamA", "coursePlans", "plan1"], {
      name: "Football 101",
    });
  });

  test("read: authenticated can read", async () => {
    await seedPath(
      [
        "teams",
        "teamA",
        "coursePlans",
        "plan1",
        "enrollments",
        "enr1",
      ],
      { studentUid: "uidA", status: "enrolled" }
    );
    await assertSucceeds(
      getDoc(
        doc(
          memberA(),
          "teams",
          "teamA",
          "coursePlans",
          "plan1",
          "enrollments",
          "enr1"
        )
      )
    );
  });

  test("read: guest cannot read", async () => {
    await seedPath(
      [
        "teams",
        "teamA",
        "coursePlans",
        "plan1",
        "enrollments",
        "enr1",
      ],
      { studentUid: "uidA" }
    );
    await assertFails(
      getDoc(
        doc(
          guest(),
          "teams",
          "teamA",
          "coursePlans",
          "plan1",
          "enrollments",
          "enr1"
        )
      )
    );
  });

  test("create: authenticated can create", async () => {
    await assertSucceeds(
      setDoc(
        doc(
          memberA(),
          "teams",
          "teamA",
          "coursePlans",
          "plan1",
          "enrollments",
          "enr_new"
        ),
        { studentUid: "uidA", status: "enrolled" }
      )
    );
  });

  test("update: captain/leader/admin can update", async () => {
    await seedPath(
      [
        "teams",
        "teamA",
        "coursePlans",
        "plan1",
        "enrollments",
        "enr_upd",
      ],
      { studentUid: "uidA", status: "enrolled" }
    );
    await assertSucceeds(
      updateDoc(
        doc(
          captain(),
          "teams",
          "teamA",
          "coursePlans",
          "plan1",
          "enrollments",
          "enr_upd"
        ),
        { status: "completed" }
      )
    );
  });

  test("update: regular user cannot update", async () => {
    await seedPath(
      [
        "teams",
        "teamA",
        "coursePlans",
        "plan1",
        "enrollments",
        "enr_upd2",
      ],
      { studentUid: "uidUser", status: "enrolled" }
    );
    await assertFails(
      updateDoc(
        doc(
          user(),
          "teams",
          "teamA",
          "coursePlans",
          "plan1",
          "enrollments",
          "enr_upd2"
        ),
        { status: "completed" }
      )
    );
  });

  test("delete: captain/leader/admin can delete", async () => {
    await seedPath(
      [
        "teams",
        "teamA",
        "coursePlans",
        "plan1",
        "enrollments",
        "enr_del",
      ],
      { studentUid: "uidA" }
    );
    await assertSucceeds(
      deleteDoc(
        doc(
          admin(),
          "teams",
          "teamA",
          "coursePlans",
          "plan1",
          "enrollments",
          "enr_del"
        )
      )
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  teams/{teamId}/students
// ═══════════════════════════════════════════════════════════════
describe("/teams/{teamId}/students/{studentId}", () => {
  test("read: authenticated can read", async () => {
    await seedPath(["teams", "teamA", "students", "stu1"], {
      name: "Student 1",
      enrollStatus: "active",
    });
    await assertSucceeds(
      getDoc(doc(memberA(), "teams", "teamA", "students", "stu1"))
    );
    await assertSucceeds(
      getDoc(doc(user(), "teams", "teamA", "students", "stu1"))
    );
  });

  test("read: guest cannot read", async () => {
    await seedPath(["teams", "teamA", "students", "stu1"], {
      name: "Student 1",
    });
    await assertFails(
      getDoc(doc(guest(), "teams", "teamA", "students", "stu1"))
    );
  });

  test("create: authenticated can create with pending status", async () => {
    await assertSucceeds(
      setDoc(doc(user(), "teams", "teamA", "students", "stu_pending"), {
        name: "New Student",
        enrollStatus: "pending",
      })
    );
  });

  test("create: captain/leader can create with any status", async () => {
    await assertSucceeds(
      setDoc(doc(captain(), "teams", "teamA", "students", "stu_active"), {
        name: "Active Student",
        enrollStatus: "active",
      })
    );
  });

  test("create: regular user cannot create with active status", async () => {
    await assertFails(
      setDoc(doc(user(), "teams", "teamA", "students", "stu_active_user"), {
        name: "Active Student",
        enrollStatus: "active",
      })
    );
  });

  test("create: must have name", async () => {
    await assertFails(
      setDoc(doc(user(), "teams", "teamA", "students", "stu_noname"), {
        enrollStatus: "pending",
      })
    );
  });

  test("update: captain/leader can update", async () => {
    await seedPath(["teams", "teamA", "students", "stu_upd"], {
      name: "Student",
      enrollStatus: "pending",
    });
    await assertSucceeds(
      updateDoc(doc(captain(), "teams", "teamA", "students", "stu_upd"), {
        enrollStatus: "active",
      })
    );
  });

  test("update: self (selfUid) can set inactive", async () => {
    await seedPath(["teams", "teamA", "students", "stu_self"], {
      name: "Self Student",
      enrollStatus: "active",
      selfUid: "uidUser",
    });
    await assertSucceeds(
      updateDoc(doc(user(), "teams", "teamA", "students", "stu_self"), {
        enrollStatus: "inactive",
      })
    );
  });

  test("update: parentUid can set inactive", async () => {
    await seedPath(["teams", "teamA", "students", "stu_parent"], {
      name: "Child Student",
      enrollStatus: "active",
      parentUid: "uidA",
    });
    await assertSucceeds(
      updateDoc(doc(memberA(), "teams", "teamA", "students", "stu_parent"), {
        enrollStatus: "inactive",
      })
    );
  });

  test("update: unrelated user cannot update", async () => {
    await seedPath(["teams", "teamA", "students", "stu_unrelated"], {
      name: "Unrelated Student",
      enrollStatus: "active",
      selfUid: "uidOther",
      parentUid: "uidOther",
    });
    await assertFails(
      updateDoc(doc(user(), "teams", "teamA", "students", "stu_unrelated"), {
        enrollStatus: "inactive",
      })
    );
  });

  test("delete: captain/leader/admin can delete", async () => {
    await seedPath(["teams", "teamA", "students", "stu_del"], {
      name: "Del Student",
    });
    await assertSucceeds(
      deleteDoc(doc(captain(), "teams", "teamA", "students", "stu_del"))
    );

    await seedPath(["teams", "teamA", "students", "stu_del2"], {
      name: "Del Student 2",
    });
    await assertSucceeds(
      deleteDoc(doc(admin(), "teams", "teamA", "students", "stu_del2"))
    );
  });

  test("delete: regular user cannot delete", async () => {
    await seedPath(["teams", "teamA", "students", "stu_del3"], {
      name: "Del Student 3",
    });
    await assertFails(
      deleteDoc(doc(user(), "teams", "teamA", "students", "stu_del3"))
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  customRoles and permissions
// ═══════════════════════════════════════════════════════════════
describe("/customRoles/{roleId}", () => {
  test("read: authenticated can read", async () => {
    await seedDoc("customRoles", "cr1", { name: "custom_role" });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "customRoles", "cr1")),
      allowAuth
    );
  });

  test("write: super_admin only", async () => {
    await assertSucceeds(
      setDoc(doc(superAdmin(), "customRoles", "cr_new"), {
        name: "new_role",
      })
    );
    await assertFails(
      setDoc(doc(admin(), "customRoles", "cr_admin"), { name: "admin_role" })
    );
    await assertFails(
      setDoc(doc(user(), "customRoles", "cr_user"), { name: "user_role" })
    );
  });

  test("delete: super_admin only", async () => {
    await seedDoc("customRoles", "cr_del", { name: "del_role" });
    await assertFails(deleteDoc(doc(admin(), "customRoles", "cr_del")));
    await assertSucceeds(
      deleteDoc(doc(superAdmin(), "customRoles", "cr_del"))
    );
  });
});

describe("/permissions/{permId}", () => {
  test("read: authenticated can read", async () => {
    await seedDoc("permissions", "perm1", { code: "event.edit_all" });
    await assertByRole(
      ({ db }) => getDoc(doc(db, "permissions", "perm1")),
      allowAuth
    );
  });

  test("write: super_admin only", async () => {
    await assertSucceeds(
      setDoc(doc(superAdmin(), "permissions", "perm_new"), {
        code: "new.perm",
      })
    );
    await assertFails(
      setDoc(doc(admin(), "permissions", "perm_admin"), { code: "admin" })
    );
    await assertFails(
      setDoc(doc(user(), "permissions", "perm_user"), { code: "user" })
    );
  });

  test("delete: super_admin only", async () => {
    await seedDoc("permissions", "perm_del", { code: "del" });
    await assertFails(deleteDoc(doc(admin(), "permissions", "perm_del")));
    await assertSucceeds(
      deleteDoc(doc(superAdmin(), "permissions", "perm_del"))
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  hasPerm() permission codes — cross-collection integration tests
// ═══════════════════════════════════════════════════════════════
describe("hasPerm() permission codes integration", () => {
  // Seed a content_manager role with specific permissions
  // Verify access to collections guarded by those permissions
  // Verify NO access to collections guarded by OTHER permissions

  test("content_manager with admin.announcements.entry can write announcements but NOT banners", async () => {
    await seedRolePermissions("content_manager", [
      "admin.announcements.entry",
    ]);

    // CAN write announcements
    await assertSucceeds(
      setDoc(doc(contentManager(), "announcements", "ann_perm_test"), {
        title: "Perm Test",
      })
    );

    // CANNOT write banners (requires admin.banners.entry)
    await assertFails(
      setDoc(doc(contentManager(), "banners", "ban_perm_test"), {
        title: "No Access",
      })
    );

    // CANNOT write siteThemes (requires admin.themes.entry)
    await assertFails(
      setDoc(doc(contentManager(), "siteThemes", "theme_perm_test"), {
        name: "No Access",
      })
    );

    // CANNOT write gameConfigs (requires admin.games.entry)
    await assertFails(
      setDoc(doc(contentManager(), "gameConfigs", "gc_perm_test"), {
        enabled: true,
      })
    );
  });

  test("content_manager with admin.banners.entry can write banners/floatingAds/sponsors/popupAds but NOT announcements", async () => {
    await seedRolePermissions("content_manager", ["admin.banners.entry"]);

    await assertSucceeds(
      setDoc(doc(contentManager(), "banners", "ban_perm"), { title: "OK" })
    );
    await assertSucceeds(
      setDoc(doc(contentManager(), "floatingAds", "fad_perm"), { title: "OK" })
    );
    await assertSucceeds(
      setDoc(doc(contentManager(), "sponsors", "sp_perm"), { name: "OK" })
    );
    await assertSucceeds(
      setDoc(doc(contentManager(), "popupAds", "pop_perm"), { title: "OK" })
    );

    // CANNOT write announcements
    await assertFails(
      setDoc(doc(contentManager(), "announcements", "ann_no"), {
        title: "No",
      })
    );
  });

  test("content_manager with admin.themes.entry can write siteThemes but NOT siteConfig", async () => {
    await seedRolePermissions("content_manager", ["admin.themes.entry"]);

    await assertSucceeds(
      setDoc(doc(contentManager(), "siteThemes", "theme_perm"), { name: "OK" })
    );

    // CANNOT write siteConfig (requires admin.auto_exp.entry)
    await assertFails(
      setDoc(doc(contentManager(), "siteConfig", "cfg_no"), { setting: true })
    );
  });

  test("content_manager with admin.auto_exp.entry can write only autoExpRules but NOT other siteConfig docs or siteThemes", async () => {
    await seedRolePermissions("content_manager", ["admin.auto_exp.entry"]);

    await assertSucceeds(
      setDoc(doc(contentManager(), "siteConfig", "autoExpRules"), {
        setting: true,
      })
    );

    await assertFails(
      setDoc(doc(contentManager(), "siteConfig", "featureFlags"), {
        notificationToggles: { category_system: false },
      })
    );
    await assertFails(
      setDoc(doc(contentManager(), "siteConfig", "bootBrand"), { setting: true })
    );

    await assertFails(
      setDoc(doc(contentManager(), "siteThemes", "theme_no"), { name: "No" })
    );
  });

  test("content_manager with admin.notif.toggle can write only featureFlags.notificationToggles", async () => {
    await seedRolePermissions("content_manager", ["admin.notif.toggle"]);

    await assertSucceeds(
      setDoc(doc(contentManager(), "siteConfig", "featureFlags"), {
        notificationToggles: { category_system: false, type_welcome: false },
      })
    );

    await assertFails(
      setDoc(doc(contentManager(), "siteConfig", "cfg_no"), { setting: true })
    );
    await assertFails(
      setDoc(doc(contentManager(), "siteThemes", "theme_no"), { name: "No" })
    );
  });

  test("content_manager with admin.games.entry can write gameConfigs but NOT siteConfig", async () => {
    await seedRolePermissions("content_manager", ["admin.games.entry"]);

    await assertSucceeds(
      setDoc(doc(contentManager(), "gameConfigs", "gc_perm"), {
        enabled: true,
      })
    );

    await assertFails(
      setDoc(doc(contentManager(), "siteConfig", "cfg_no"), { setting: true })
    );
  });

  test("content_manager with admin.achievements.entry can write achievements/badges but NOT announcements", async () => {
    await seedRolePermissions("content_manager", [
      "admin.achievements.entry",
    ]);

    await assertSucceeds(
      setDoc(doc(contentManager(), "achievements", "ach_perm"), { name: "OK" })
    );
    await assertSucceeds(
      setDoc(doc(contentManager(), "badges", "badge_perm"), { name: "OK" })
    );

    await assertFails(
      setDoc(doc(contentManager(), "announcements", "ann_no"), {
        title: "No",
      })
    );
  });

  test("content_manager with admin.messages.entry can write adminMessages but NOT announcements", async () => {
    await seedRolePermissions("content_manager", ["admin.messages.entry"]);

    await assertSucceeds(
      setDoc(doc(contentManager(), "adminMessages", "am_perm"), {
        title: "OK",
      })
    );

    await assertFails(
      setDoc(doc(contentManager(), "announcements", "ann_no"), {
        title: "No",
      })
    );
  });

  test("content_manager with admin.logs.error_read can read errorLogs", async () => {
    await seedRolePermissions("content_manager", ["admin.logs.error_read"]);
    await seedDoc("errorLogs", "err_perm", { message: "test error" });

    await assertSucceeds(
      getDoc(doc(contentManager(), "errorLogs", "err_perm"))
    );
  });

  test("content_manager with admin.logs.error_delete can delete errorLogs", async () => {
    await seedRolePermissions("content_manager", ["admin.logs.error_delete"]);
    await seedDoc("errorLogs", "err_perm_del", { message: "test error" });

    await assertSucceeds(
      deleteDoc(doc(contentManager(), "errorLogs", "err_perm_del"))
    );
  });

  test("content_manager with admin.logs.error_delete but NOT error_read cannot read errorLogs", async () => {
    await seedRolePermissions("content_manager", ["admin.logs.error_delete"]);
    await seedDoc("errorLogs", "err_no_read", { message: "secret" });

    await assertFails(
      getDoc(doc(contentManager(), "errorLogs", "err_no_read"))
    );
  });

  test("content_manager with admin.logs.audit_read can read auditLogsByDay", async () => {
    await seedRolePermissions("content_manager", ["admin.logs.audit_read"]);
    await seedPath(
      ["auditLogsByDay", "20260330", "auditEntries", "audit_perm"],
      { actorUid: "uidA", action: "test" }
    );

    await assertSucceeds(
      getDoc(
        doc(
          contentManager(),
          "auditLogsByDay",
          "20260330",
          "auditEntries",
          "audit_perm"
        )
      )
    );
  });

  test("content_manager without admin.logs.audit_read cannot read auditLogsByDay", async () => {
    await seedRolePermissions("content_manager", [
      "admin.announcements.entry",
    ]);
    await seedPath(
      ["auditLogsByDay", "20260330", "auditEntries", "audit_no"],
      { actorUid: "uidA", action: "test" }
    );

    await assertFails(
      getDoc(
        doc(
          contentManager(),
          "auditLogsByDay",
          "20260330",
          "auditEntries",
          "audit_no"
        )
      )
    );
  });

  test("content_manager with event.edit_all can update events", async () => {
    await seedRolePermissions("content_manager", ["event.edit_all"]);
    await seedDoc("events", "evt_perm", {
      title: "Perm Event",
      creatorUid: "uidOther",
      ownerUid: "uidOther",
    });

    await assertSucceeds(
      updateDoc(doc(contentManager(), "events", "evt_perm"), {
        status: "closed",
      })
    );
  });

  test("content_manager with team.manage_all can update teams", async () => {
    await seedRolePermissions("content_manager", ["team.manage_all"]);

    await assertSucceeds(
      updateDoc(doc(contentManager(), "teams", "teamA"), {
        name: "CM Updated Team",
      })
    );
  });

  test("content_manager with admin.shop.entry can update/delete shopItems", async () => {
    await seedRolePermissions("content_manager", ["admin.shop.entry"]);
    await seedDoc("shopItems", "item_perm", {
      name: "Perm Item",
      ownerUid: "uidOther",
    });

    await assertSucceeds(
      updateDoc(doc(contentManager(), "shopItems", "item_perm"), {
        name: "Updated",
      })
    );
    await assertSucceeds(
      deleteDoc(doc(contentManager(), "shopItems", "item_perm"))
    );
  });

  test("user role is always ignored by hasPerm even if rolePermissions doc exists for user", async () => {
    // hasPerm() requires role != 'user'
    await seedRolePermissions("user", [
      "admin.announcements.entry",
      "admin.banners.entry",
      "admin.themes.entry",
    ]);

    await assertFails(
      setDoc(doc(user(), "announcements", "ann_user_perm"), { title: "No" })
    );
    await assertFails(
      setDoc(doc(user(), "banners", "ban_user_perm"), { title: "No" })
    );
    await assertFails(
      setDoc(doc(user(), "siteThemes", "theme_user_perm"), { name: "No" })
    );
  });

  test("content_manager with multiple permissions can access all granted collections", async () => {
    await seedRolePermissions("content_manager", [
      "admin.announcements.entry",
      "admin.banners.entry",
      "admin.themes.entry",
      "admin.games.entry",
      "admin.messages.entry",
    ]);

    await assertSucceeds(
      setDoc(doc(contentManager(), "announcements", "ann_multi"), {
        title: "OK",
      })
    );
    await assertSucceeds(
      setDoc(doc(contentManager(), "banners", "ban_multi"), { title: "OK" })
    );
    await assertSucceeds(
      setDoc(doc(contentManager(), "siteThemes", "theme_multi"), {
        name: "OK",
      })
    );
    await assertSucceeds(
      setDoc(doc(contentManager(), "gameConfigs", "gc_multi"), {
        enabled: true,
      })
    );
    await assertSucceeds(
      setDoc(doc(contentManager(), "adminMessages", "am_multi"), {
        title: "OK",
      })
    );

    // Still CANNOT access siteConfig (requires admin.auto_exp.entry)
    await assertFails(
      setDoc(doc(contentManager(), "siteConfig", "cfg_multi"), {
        setting: true,
      })
    );
  });
});
