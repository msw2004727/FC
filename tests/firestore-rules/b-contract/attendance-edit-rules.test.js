/**
 * 契約測試：活動名單編輯模式的簽到紀錄寫入（Rules）。
 *
 * FC-B 名單編輯（A `_writeInstantAttendance` → `batchWriteAttendance`）寫入
 * `events/{eventDocId}/attendanceRecords`：新增紀錄、以 status='removed' 軟刪除。
 * B 不寫 A 快取用的 `_path`／`_parentPath`／`_sourceKind`／`_sourceCollection`。
 *
 * 驗證範圍（Rules emulator）：
 *   - allow：活動主辦（coach）新增 A 形狀紀錄；軟刪除只帶 status／removedAt／removedByUid。
 *   - deny：軟刪除夾帶其他欄位（備註、內部欄位）；非主辦的一般用戶新增；刪除文件。
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
  deleteDoc,
  setLogLevel,
  serverTimestamp,
} = require("firebase/firestore");

const PROJECT_ID = "demo-b-contract-attendance-edit";
const RULES_PATH = path.resolve(__dirname, "..", "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

jest.setTimeout(20000);

let testEnv;

const COACH_UID = "uid_coach_owner";
const USER_UID = "uid_plain_user";
const PLAYER_UID = "uid_player";

// public id 與文件 ID 不同（R-ID-008／009）：紀錄的 eventId 存 public id。
const EVENT_DOC_ID = "doc_att_edit_1";
const EVENT_PUBLIC_ID = "ce_att_edit_public";
const RECORD_ID = "rec_existing_checkin";

function authAs(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function recordPath(db, recordId) {
  return doc(db, "events", EVENT_DOC_ID, "attendanceRecords", recordId);
}

/** 與 A `_buildAttendanceBaseRecord`＋`_collectAttendanceOps` 新增簽到相同的欄位。 */
function buildCheckinRecord(overrides = {}) {
  return {
    id: "att_1760000000000_ab12",
    eventId: EVENT_PUBLIC_ID,
    uid: PLAYER_UID,
    userName: "球員甲",
    participantType: "self",
    type: "checkin",
    time: "2026/10/19 14:00",
    status: "active",
    createdAt: serverTimestamp(),
    ...overrides,
  };
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
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", COACH_UID), { uid: COACH_UID, role: "coach" });
    await setDoc(doc(db, "users", USER_UID), { uid: USER_UID, role: "user" });
    await setDoc(doc(db, "users", PLAYER_UID), { uid: PLAYER_UID, role: "user" });
    await setDoc(doc(db, "roleActivityCapabilities", "user"), { capabilities: [] });
    await setDoc(doc(db, "events", EVENT_DOC_ID), {
      id: EVENT_PUBLIC_ID,
      title: "名單編輯測試",
      status: "open",
      creatorUid: COACH_UID,
      privateEvent: false,
      max: 10,
      current: 1,
    });
    await setDoc(recordPath(db, RECORD_ID), {
      ...buildCheckinRecord({ id: "att_existing_0001" }),
      createdAt: new Date("2026-10-19T06:00:00.000Z"),
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("名單編輯：新增簽到紀錄", () => {
  test("allow：活動主辦新增 A 形狀的簽到紀錄（eventId 為 public id）", async () => {
    const db = authAs(COACH_UID);
    await assertSucceeds(setDoc(recordPath(db, "new_checkin"), buildCheckinRecord()));
  });

  test("allow：活動主辦新增備註紀錄", async () => {
    const db = authAs(COACH_UID);
    await assertSucceeds(
      setDoc(
        recordPath(db, "new_note"),
        buildCheckinRecord({ id: "att_note_1760000000001", type: "note", note: "遲到" }),
      ),
    );
  });

  test("deny：非主辦的一般用戶新增", async () => {
    const db = authAs(USER_UID);
    await assertFails(setDoc(recordPath(db, "intruder"), buildCheckinRecord()));
  });
});

describe("名單編輯：軟刪除", () => {
  test("allow：只帶 status／removedAt／removedByUid", async () => {
    const db = authAs(COACH_UID);
    await assertSucceeds(
      updateDoc(recordPath(db, RECORD_ID), {
        status: "removed",
        removedAt: serverTimestamp(),
        removedByUid: COACH_UID,
      }),
    );
  });

  test("deny：軟刪除夾帶備註欄位", async () => {
    const db = authAs(COACH_UID);
    await assertFails(
      updateDoc(recordPath(db, RECORD_ID), {
        status: "removed",
        removedAt: serverTimestamp(),
        removedByUid: COACH_UID,
        note: "改備註",
      }),
    );
  });

  test("deny：軟刪除夾帶 A 快取內部欄位 _path", async () => {
    const db = authAs(COACH_UID);
    await assertFails(
      updateDoc(recordPath(db, RECORD_ID), {
        status: "removed",
        removedAt: serverTimestamp(),
        removedByUid: COACH_UID,
        _path: `events/${EVENT_DOC_ID}/attendanceRecords/${RECORD_ID}`,
      }),
    );
  });

  test("deny：刪除文件", async () => {
    const db = authAs(COACH_UID);
    await assertFails(deleteDoc(recordPath(db, RECORD_ID)));
  });
});
