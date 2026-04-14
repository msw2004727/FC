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
  setLogLevel,
} = require("firebase/firestore");

const PROJECT_ID = "demo-tournament-member-test";
const RULES_PATH = path.resolve(__dirname, "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

let testEnv;

const TOURNAMENT_ID = "ct_test_tournament_001";
const CREATOR_UID = "creator_uid_001";
const DELEGATE_UID = "delegate_uid_002";
const RANDOM_UID = "random_uid_003";
const HOST_TEAM_ID = "tm_host_team_001";
const ENTRY_TEAM_ID = "tm_entry_team_001";
const MEMBER_UID = "member_uid_004";

function guest() {
  return testEnv.unauthenticatedContext().firestore();
}
function creator() {
  return testEnv.authenticatedContext(CREATOR_UID).firestore();
}
function delegate() {
  return testEnv.authenticatedContext(DELEGATE_UID).firestore();
}
function randomUser() {
  return testEnv.authenticatedContext(RANDOM_UID).firestore();
}

beforeAll(async () => {
  setLogLevel("error");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: EMULATOR_HOST,
      port: parseInt(EMULATOR_PORT, 10),
      rules: fs.readFileSync(RULES_PATH, "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    // Host team
    await setDoc(doc(db, "teams", HOST_TEAM_ID), {
      id: HOST_TEAM_ID,
      name: "Host Team",
      captainUid: CREATOR_UID,
      leaderUids: [CREATOR_UID],
      coachUids: [],
    });
    // Tournament
    await setDoc(doc(db, "tournaments", TOURNAMENT_ID), {
      id: TOURNAMENT_ID,
      name: "Test Tournament",
      creatorUid: CREATOR_UID,
      hostTeamId: HOST_TEAM_ID,
      delegateUids: [DELEGATE_UID],
      mode: "friendly",
    });
    // Entry team
    await setDoc(doc(db, "tournaments", TOURNAMENT_ID, "entries", ENTRY_TEAM_ID), {
      teamId: ENTRY_TEAM_ID,
      teamName: "Entry Team",
    });
    // Entry member
    await setDoc(doc(db, "tournaments", TOURNAMENT_ID, "entries", ENTRY_TEAM_ID, "members", MEMBER_UID), {
      uid: MEMBER_UID,
      name: "Test Member",
    });
    // User docs
    await setDoc(doc(db, "users", CREATOR_UID), { uid: CREATOR_UID, role: "captain" });
    await setDoc(doc(db, "users", DELEGATE_UID), { uid: DELEGATE_UID, role: "user" });
    await setDoc(doc(db, "users", RANDOM_UID), { uid: RANDOM_UID, role: "user" });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("Tournament Entries/Members Read Rules (Phase 0)", () => {
  test("7. 未登入用戶不能讀 entries", async () => {
    await assertFails(
      getDoc(doc(guest(), "tournaments", TOURNAMENT_ID, "entries", ENTRY_TEAM_ID))
    );
  });

  test("8. 未登入用戶不能讀 members", async () => {
    await assertFails(
      getDoc(doc(guest(), "tournaments", TOURNAMENT_ID, "entries", ENTRY_TEAM_ID, "members", MEMBER_UID))
    );
  });

  test("9. 登入用戶可讀 entries", async () => {
    await assertSucceeds(
      getDoc(doc(randomUser(), "tournaments", TOURNAMENT_ID, "entries", ENTRY_TEAM_ID))
    );
  });
});

describe("Tournament delegateUids Immutability (Phase 0)", () => {
  test("10. 非管理員委託人不能修改 delegateUids", async () => {
    await assertFails(
      updateDoc(doc(delegate(), "tournaments", TOURNAMENT_ID), {
        delegateUids: [DELEGATE_UID, RANDOM_UID],
      })
    );
  });

  test("11. 建立者可修改 delegateUids", async () => {
    await assertSucceeds(
      updateDoc(doc(creator(), "tournaments", TOURNAMENT_ID), {
        delegateUids: [DELEGATE_UID, RANDOM_UID],
      })
    );
  });

  test("12. 建立者修改 delegateUids 不影響不可變欄位", async () => {
    // Creator can change delegateUids but NOT hostTeamId
    await assertFails(
      updateDoc(doc(creator(), "tournaments", TOURNAMENT_ID), {
        delegateUids: [DELEGATE_UID],
        hostTeamId: "tm_hacked_team",
      })
    );
  });
});
