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

    await setDoc(doc(db, "expLogs", "expA"), { targetUid: "uidA", amount: 1 });
    await setDoc(doc(db, "expLogs", "expB"), { targetUid: "uidB", amount: 1 });

    await setDoc(doc(db, "teamExpLogs", "teamExpA"), { teamId: "teamA", amount: 1 });
    await setDoc(doc(db, "teamExpLogs", "teamExpB"), { teamId: "teamB", amount: 1 });

    await setDoc(doc(db, "operationLogs", "opA"), { actorUid: "uidA", action: "seed" });
    await setDoc(doc(db, "operationLogs", "opB"), { actorUid: "uidB", action: "seed" });

    await setDoc(doc(db, "errorLogs", "errA"), { message: "errorA" });
    await setDoc(doc(db, "errorLogs", "errB"), { message: "errorB" });

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
});

afterAll(async () => {
  await testEnv.cleanup();
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
});

describe("/registrations/{regId}", () => {
  test("[SECURITY_GAP_FIXED] read: only owner/admin can read registration", async () => {
    await assertByRole(
      ({ db }) => getDoc(doc(db, "registrations", "regB")),
      {
        guest: false,
        memberA: false,
        memberB: true,
        admin: true,
        superAdmin: true,
      }
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
  test("[SECURITY_GAP_FIXED] read: memberA cannot read memberB message", async () => {
    await assertFails(getDoc(doc(memberA(), "messages", "msgB")));
    await assertSucceeds(getDoc(doc(memberB(), "messages", "msgB")));
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

  test("[SECURITY_GAP_FIXED] update: memberA cannot update memberB message", async () => {
    await assertFails(updateDoc(doc(memberA(), "messages", "msgB"), { body: "updated by A" }));
    await assertSucceeds(updateDoc(doc(memberB(), "messages", "msgB"), { body: "updated by B" }));
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
    await assertByRole(({ db }) => getDoc(doc(db, "operationLogs", "opB")), allowAuth);
    await assertByRole(
      ({ db, role }) => setDoc(doc(db, "operationLogs", `op_create_${role}`), { actor: role }),
      allowAuth
    );
    await assertByRole(({ db }) => updateDoc(doc(db, "operationLogs", "opB"), { action: "x" }), denyAll);
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

  test("[SECURITY_GAP] update (current): any authenticated user can update other team", async () => {
    await assertByRole(
      ({ db }) => updateDoc(doc(db, "teams", "teamB"), { name: "updated-by-role" }),
      allowAuth
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

  test("[SECURITY_GAP] update (current): any authenticated user can update other item", async () => {
    await assertByRole(
      ({ db }) => updateDoc(doc(db, "shopItems", "itemB"), { name: "updated-by-role" }),
      allowAuth
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

  test("[USABILITY_BLOCKED] user cannot read received inbox message (toUid=self)", async () => {
    // Blocked by rule: /messages read only checks fromUid ownership.
    await assertFails(getDoc(doc(user(), "messages", "msgCoachToUser")));
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

  test("[SECURITY_GAP_USABILITY] user can update teams without manager/leader role", async () => {
    // SECURITY GAP: /teams update currently allows any authenticated user (isAuth()).
    await assertSucceeds(
      updateDoc(doc(user(), "teams", "teamManagerOwn"), {
        name: "User Updated Manager Team",
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
