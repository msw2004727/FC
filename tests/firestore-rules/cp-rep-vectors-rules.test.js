/**
 * 俱樂部代表共用向量（tests/fixtures/cp-rep-vectors.json）對主站 firestore.rules 實跑（G4，顧問 §3.372）。
 *
 * 代表＝isCurrentUserTeamCaptainOrLeader。teams/{teamId}/groups/{groupId} 的 create 只由這個 helper 決定，
 * 用它當探針：向量的 reps 必須能建立、nonReps 必須被拒。與 tests/unit/cp-club-mirror.test.js（同一份向量跑
 * functions/cp-club-mirror.js repUidsFromTeam，並比對 Rules 原文欄位）一起鎖住三處實作的同一定義。不改 Rules。
 */
const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { doc, setDoc, setLogLevel } = require("firebase/firestore");

const PROJECT_ID = "demo-rules-test";
const RULES_PATH = path.resolve(__dirname, "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
const VECTORS = require("../fixtures/cp-rep-vectors.json").vectors;

let testEnv;

jest.setTimeout(60000);

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

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("cp-rep-vectors：Rules isCurrentUserTeamCaptainOrLeader 與共用向量一致", () => {
  test.each(VECTORS.map((v, i) => [v.name, v, i]))("%s", async (_name, v, i) => {
    const teamId = `tm_cp_rep_vec_${i}`;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "teams", teamId), v.team);
    });
    for (const uid of v.reps) {
      const db = testEnv.authenticatedContext(uid).firestore();
      await assertSucceeds(setDoc(doc(db, "teams", teamId, "groups", "g_probe"), { name: "probe" }));
    }
    for (const uid of v.nonReps) {
      const db = testEnv.authenticatedContext(uid).firestore();
      await assertFails(setDoc(doc(db, "teams", teamId, "groups", "g_probe"), { name: "probe" }));
    }
  });
});
