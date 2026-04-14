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

const PROJECT_ID = "demo-team-feed-test";
const RULES_PATH = path.resolve(__dirname, "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

let testEnv;

const TEAM_ID = "tm_test_team_001";
const CAPTAIN_UID = "captain_uid_001";
const MEMBER_UID = "member_uid_002";
const OUTSIDER_UID = "outsider_uid_003";
const POST_ID = "fp_test_post_001";

function guest() {
  return testEnv.unauthenticatedContext().firestore();
}
function captain() {
  return testEnv.authenticatedContext(CAPTAIN_UID).firestore();
}
function member() {
  return testEnv.authenticatedContext(MEMBER_UID).firestore();
}
function outsider() {
  return testEnv.authenticatedContext(OUTSIDER_UID).firestore();
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
    // Create team with captain
    await setDoc(doc(db, "teams", TEAM_ID), {
      id: TEAM_ID,
      name: "Test Team",
      captainUid: CAPTAIN_UID,
      leaderUids: [CAPTAIN_UID],
      coachUids: [],
      active: true,
    });
    // Create user docs with team membership
    await setDoc(doc(db, "users", CAPTAIN_UID), {
      uid: CAPTAIN_UID,
      teamId: TEAM_ID,
      teamIds: [TEAM_ID],
    });
    await setDoc(doc(db, "users", MEMBER_UID), {
      uid: MEMBER_UID,
      teamId: TEAM_ID,
      teamIds: [TEAM_ID],
    });
    await setDoc(doc(db, "users", OUTSIDER_UID), {
      uid: OUTSIDER_UID,
      teamId: "other_team",
      teamIds: ["other_team"],
    });
    // Create a feed post by member
    await setDoc(doc(db, "teams", TEAM_ID, "feed", POST_ID), {
      uid: MEMBER_UID,
      content: "Hello from member",
      createdAt: new Date().toISOString(),
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("Team Feed Rules (Phase 0 + Phase 3)", () => {
  test("1. 登入用戶可讀 feed", async () => {
    await assertSucceeds(
      getDoc(doc(member(), "teams", TEAM_ID, "feed", POST_ID))
    );
  });

  test("2. 成員可建立貼文", async () => {
    await assertSucceeds(
      setDoc(doc(member(), "teams", TEAM_ID, "feed", "fp_new_post"), {
        uid: MEMBER_UID,
        content: "New post",
        createdAt: new Date().toISOString(),
      })
    );
  });

  test("3. 貼文作者可 update 自己的貼文", async () => {
    await assertSucceeds(
      updateDoc(doc(member(), "teams", TEAM_ID, "feed", POST_ID), {
        content: "Updated by author",
      })
    );
  });

  test("4. 非作者非幹部不能 update 他人貼文", async () => {
    await assertFails(
      updateDoc(doc(outsider(), "teams", TEAM_ID, "feed", POST_ID), {
        content: "Hacked by outsider",
      })
    );
  });

  test("5. 非作者非幹部不能 delete 他人貼文", async () => {
    await assertFails(
      deleteDoc(doc(outsider(), "teams", TEAM_ID, "feed", POST_ID))
    );
  });

  test("6. 俱樂部隊長可 delete 任何貼文", async () => {
    await assertSucceeds(
      deleteDoc(doc(captain(), "teams", TEAM_ID, "feed", POST_ID))
    );
  });
});
