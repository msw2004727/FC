/**
 * Tournament Matches（盃賽/聯賽比賽子集合）rules tests
 *
 * 驗證 tournaments/{id}/matches 子集合：
 * - 賽程建立/刪除/編輯：主辦（creator）、委託人可；一般用戶不可
 * - 比分記錄：裁判長全場次；裁判限被指派場次（未指派時開放賽事裁判名單）
 * - 裁判僅能更新比分相關欄位（meta 欄位拒絕）
 * - 賽事結束後裁判鎖定（管理者仍可）
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
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  setLogLevel,
} = require("firebase/firestore");

const PROJECT_ID = "demo-tournament-match-test";
const RULES_PATH = path.resolve(__dirname, "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

let testEnv;

const TOURNAMENT_ID = "ct_match_tournament_001";
const CREATOR_UID = "creator_uid_001";
const DELEGATE_UID = "delegate_uid_002";
const REFEREE_HEAD_UID = "referee_head_uid_003";
const REFEREE_A_UID = "referee_a_uid_004";
const REFEREE_B_UID = "referee_b_uid_005";
const RANDOM_UID = "random_uid_006";
const HOST_TEAM_ID = "tm_host_team_001";
const MATCH_OPEN_ID = "cm_open_001";      // 未指派裁判
const MATCH_ASSIGNED_ID = "cm_assigned_002"; // 指派 REFEREE_A

const ctx = uid => testEnv.authenticatedContext(uid).firestore();

const baseMatch = {
  stage: "league", round: 1, slot: 0, slotKey: "lr1m0", matchNo: 1,
  homeTeamId: "tm_x", awayTeamId: "tm_y",
  status: "scheduled", scoreHome: null, scoreAway: null,
  venue: "", refereeUids: [], events: [],
};

const scorePatch = {
  status: "finished", scoreHome: 2, scoreAway: 1,
  events: [{ type: "goal", teamId: "tm_x", uid: "player_1", name: "球員一", minute: 10 }],
  recordedByUid: "x", recordedByName: "x", recordedAt: "2026-06-12T10:00:00.000Z",
  updatedAt: "2026-06-12T10:00:00.000Z",
};

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
    await setDoc(doc(db, "teams", HOST_TEAM_ID), {
      id: HOST_TEAM_ID,
      name: "Host Team",
      captainUid: CREATOR_UID,
      leaderUids: [CREATOR_UID],
      coachUids: [],
    });
    await setDoc(doc(db, "tournaments", TOURNAMENT_ID), {
      id: TOURNAMENT_ID,
      name: "League Tournament",
      creatorUid: CREATOR_UID,
      hostTeamId: HOST_TEAM_ID,
      delegateUids: [DELEGATE_UID],
      refereeHeadUid: REFEREE_HEAD_UID,
      refereeUids: [REFEREE_A_UID, REFEREE_B_UID],
      mode: "league",
      ended: false,
    });
    await setDoc(doc(db, "tournaments", TOURNAMENT_ID, "matches", MATCH_OPEN_ID), {
      ...baseMatch, id: MATCH_OPEN_ID,
    });
    await setDoc(doc(db, "tournaments", TOURNAMENT_ID, "matches", MATCH_ASSIGNED_ID), {
      ...baseMatch, id: MATCH_ASSIGNED_ID, slot: 1, slotKey: "lr1m1", matchNo: 2,
      refereeUids: [REFEREE_A_UID],
    });
    for (const uid of [CREATOR_UID, DELEGATE_UID, REFEREE_HEAD_UID, REFEREE_A_UID, REFEREE_B_UID, RANDOM_UID]) {
      await setDoc(doc(db, "users", uid), { uid, role: "user" });
    }
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("matches read / create / delete", () => {
  test("公開可讀", async () => {
    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "tournaments", TOURNAMENT_ID, "matches", MATCH_OPEN_ID)));
  });

  test("主辦可建立賽程比賽；一般用戶與裁判不可", async () => {
    const payload = { ...baseMatch, id: "cm_new_010", slotKey: "lr2m0", round: 2, matchNo: 3 };
    await assertSucceeds(setDoc(doc(ctx(CREATOR_UID), "tournaments", TOURNAMENT_ID, "matches", "cm_new_010"), payload));
    await assertFails(setDoc(doc(ctx(RANDOM_UID), "tournaments", TOURNAMENT_ID, "matches", "cm_new_011"), { ...payload, id: "cm_new_011" }));
    await assertFails(setDoc(doc(ctx(REFEREE_A_UID), "tournaments", TOURNAMENT_ID, "matches", "cm_new_012"), { ...payload, id: "cm_new_012" }));
  });

  test("委託人可刪除；裁判不可刪除", async () => {
    await assertSucceeds(deleteDoc(doc(ctx(DELEGATE_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_OPEN_ID)));
    await assertFails(deleteDoc(doc(ctx(REFEREE_A_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_ASSIGNED_ID)));
  });
});

describe("matches meta 編輯（管理範圍）", () => {
  test("主辦 / 委託可更新場地與裁判指派；一般用戶不可", async () => {
    const metaPatch = { venue: "市立球場", refereeUids: [REFEREE_B_UID], updatedAt: "x" };
    await assertSucceeds(updateDoc(doc(ctx(CREATOR_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_OPEN_ID), metaPatch));
    await assertSucceeds(updateDoc(doc(ctx(DELEGATE_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_ASSIGNED_ID), metaPatch));
    await assertFails(updateDoc(doc(ctx(RANDOM_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_OPEN_ID), metaPatch));
  });
});

describe("matches 比分記錄（裁判）", () => {
  test("裁判長可記錄任何場次比分", async () => {
    await assertSucceeds(updateDoc(doc(ctx(REFEREE_HEAD_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_ASSIGNED_ID), scorePatch));
  });

  test("被指派裁判可記錄；未被指派裁判對指派場次不可", async () => {
    await assertSucceeds(updateDoc(doc(ctx(REFEREE_A_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_ASSIGNED_ID), scorePatch));
    await assertFails(updateDoc(doc(ctx(REFEREE_B_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_ASSIGNED_ID), scorePatch));
  });

  test("未指派場次開放賽事裁判名單內裁判記錄", async () => {
    await assertSucceeds(updateDoc(doc(ctx(REFEREE_B_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_OPEN_ID), scorePatch));
  });

  test("一般用戶不可記錄比分", async () => {
    await assertFails(updateDoc(doc(ctx(RANDOM_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_OPEN_ID), scorePatch));
  });

  test("裁判不可修改 meta 欄位（僅比分相關欄位）", async () => {
    await assertFails(updateDoc(doc(ctx(REFEREE_A_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_ASSIGNED_ID), { ...scorePatch, venue: "偷改場地" }));
    await assertFails(updateDoc(doc(ctx(REFEREE_HEAD_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_OPEN_ID), { homeTeamId: "tm_hack", updatedAt: "x" }));
  });

  test("棄權判定（walkover）欄位裁判可寫", async () => {
    const woPatch = {
      status: "walkover", walkoverWinnerTeamId: "tm_x",
      scoreHome: null, scoreAway: null, events: [],
      recordedByUid: "x", recordedByName: "x", recordedAt: "t", updatedAt: "t",
    };
    await assertSucceeds(updateDoc(doc(ctx(REFEREE_HEAD_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_OPEN_ID), woPatch));
  });

  test("賽事結束後裁判鎖定、主辦仍可更正", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "tournaments", TOURNAMENT_ID), { ended: true });
    });
    await assertFails(updateDoc(doc(ctx(REFEREE_HEAD_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_OPEN_ID), scorePatch));
    await assertFails(updateDoc(doc(ctx(REFEREE_A_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_ASSIGNED_ID), scorePatch));
    await assertSucceeds(updateDoc(doc(ctx(CREATOR_UID), "tournaments", TOURNAMENT_ID, "matches", MATCH_OPEN_ID), scorePatch));
  });
});
