/**
 * 契約測試：B（FC-B）第 3 段兩個新寫入路徑在現行 Rules 下的 allow / deny。
 *
 * 涵蓋：
 *   A. eventTemplates（新增範本 / 讀 / 刪 / 更新）
 *   B. 多日期批次建立（同一個 runTransaction 內 set 多筆 events/{id}）
 *
 * ⚠️  B 與 A 共用同一份 `firestore.rules`；寫入格式必須是 Rules 允許的 A 格式。
 *      本檔只驗證現行 Rules 的行為，不改 Rules、不改 payload 去湊。
 *      結果與預期不同時照實寫並在該案例加註解（A 落差），不修改 Rules。
 *
 * 相關規則：
 *   - eventTemplates：allow read / create / update / delete 的 ownerUid 檢查
 *   - events create：coach 的 hasActivityManageEntry、user 的 basic_create＋addons_use
 *
 * 執行：
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     npx jest --runInBand tests/firestore-rules/b-contract/event-templates-multidate-rules.test.js
 *
 * 註意 seed：role 放 custom claim（admin 另帶 admin:true），
 * 並 seed rolePermissions/{role}（permissions）、roleActivityCapabilities/user
 * （catalogVersion + capabilities）、完整 users/{uid}；
 * 任一項缺都會出現「maximum of 1000 expressions」或「Property permissions is undefined」的假拒絕。
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
  addDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  deleteDoc,
  updateDoc,
  runTransaction,
  setLogLevel,
  serverTimestamp,
} = require("firebase/firestore");

const PROJECT_ID = "demo-b-contract-event-tplmd";
const RULES_PATH = path.resolve(__dirname, "..", "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

jest.setTimeout(30000);

let testEnv;

// ── 固定識別碼 ────────────────────────────────────

const USER_UID = "uid_user_tplmd";
const COACH_UID = "uid_coach_tplmd";
const ADMIN_UID = "uid_admin_tplmd";
const OTHER_COACH_UID = "uid_other_coach_tplmd";

const BATCH_GROUP_ID = "batch_test_1";

function authAs(uid, role, isAdmin = false) {
  const claims = { role };
  if (isAdmin) claims.admin = true;
  return testEnv.authenticatedContext(uid, claims).firestore();
}

/**
 * eventTemplates 範本欄位集，依 A `_buildCurrentTemplate`：
 *   id（'tpl_…'）、name、title、type、location、fee、feeEnabled、max、minAge、notes、
 *   sportTag、genderRestrictionEnabled、allowedGender、privateEvent、socialLinksEnabled、
 *   socialLinks、earlyBirdEnabled、earlyBirdCost、regionEnabled、region、cities、image、
 *   updatedAt（ISO 字串）、ownerUid、ownerName、createdAt（serverTimestamp）。
 */
function templatePayload(overrides = {}) {
  return {
    id: "tpl_default",
    name: "我的範本",
    title: "週末練球",
    type: "friendly",
    location: "台北市大安運動中心",
    fee: 0,
    feeEnabled: false,
    max: 20,
    minAge: 0,
    notes: "",
    sportTag: "basketball",
    genderRestrictionEnabled: false,
    allowedGender: "",
    privateEvent: false,
    socialLinksEnabled: false,
    socialLinks: [],
    earlyBirdEnabled: false,
    earlyBirdCost: 0,
    regionEnabled: false,
    region: "",
    cities: [],
    image: "https://example.com/cover.jpg",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ownerUid: USER_UID,
    ownerName: "小明",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedTemplate(templateId, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const payload = templatePayload({ id: templateId, ...overrides });
    await setDoc(doc(ctx.firestore(), "eventTemplates", templateId), payload);
  });
}

/**
 * events 建立 payload 依 FC-B `buildCreateEventPayload` 的完整欄位集：
 *   - 不帶 payloadRevision / payloadDigest（B 不寫）
 *   - id === docId、clientRequestId === id、current/waitlist = 0
 *   - 額外寫入 batchGroupId（多日期批次用）
 *   - createdAt / updatedAt 用 serverTimestamp()
 */
function basePayload(overrides = {}) {
  const base = {
    id: "ce_default",
    clientRequestId: "ce_default",
    title: "多日期練球",
    type: "friendly",
    status: "open",
    location: "台北市大安運動中心",
    date: "2026/05/15 15:00~17:00",
    startTimestamp: new Date("2026-05-15T15:00:00.000Z"),
    endTimestamp: new Date("2026-05-15T17:00:00.000Z"),
    max: 20,
    minAge: 0,
    notes: "",
    sportTag: "basketball",
    regOpenTime: null,
    image: "https://example.com/cover.jpg",
    gradient: "linear-gradient(135deg,#0d9488,#065f46)",
    current: 0,
    waitlist: 0,
    participants: [],
    waitlistNames: [],
    contact: "",
    icon: "",
    countdown: "即將開始",
    creator: "小明",
    creatorUid: USER_UID,
    delegates: [],
    delegateUids: [],
    regionEnabled: false,
    region: "",
    cities: [],
    feeEnabled: false,
    fee: 0,
    teamOnly: false,
    isPublic: false,
    creatorTeamId: null,
    creatorTeamName: null,
    creatorTeamIds: [],
    creatorTeamNames: [],
    genderRestrictionEnabled: false,
    allowedGender: "",
    privateEvent: false,
    socialLinksEnabled: false,
    socialLinks: [],
    earlyBirdEnabled: false,
    earlyBirdCost: 0,
    earlyBirdPolicyVersion: null,
    batchGroupId: BATCH_GROUP_ID,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
  return { ...base, ...overrides };
}

function batchCreateEvents(authDb, payloads) {
  return runTransaction(authDb, async (tx) => {
    for (const p of payloads) {
      tx.set(doc(authDb, "events", p.id), p);
    }
  });
}

async function eventDocExists(eventId) {
  let exists = false;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), "events", eventId));
    exists = snap.exists();
  });
  return exists;
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

    // 完整 users/{uid}
    await setDoc(doc(db, "users", USER_UID), {
      uid: USER_UID, role: "user", name: "小明", email: "user@example.com",
    });
    await setDoc(doc(db, "users", COACH_UID), {
      uid: COACH_UID, role: "coach", name: "王教練", email: "coach@example.com",
    });
    await setDoc(doc(db, "users", ADMIN_UID), {
      uid: ADMIN_UID, role: "admin", name: "李管理員", email: "admin@example.com",
    });
    await setDoc(doc(db, "users", OTHER_COACH_UID), {
      uid: OTHER_COACH_UID, role: "coach", name: "其他教練", email: "other@example.com",
    });

    // rolePermissions（避免「Property permissions is undefined」）
    await setDoc(doc(db, "rolePermissions", "user"), { permissions: [] });
    await setDoc(doc(db, "rolePermissions", "coach"), { permissions: [] });
    await setDoc(doc(db, "rolePermissions", "admin"), {
      permissions: ["event.edit_all", "activity.manage.entry"],
    });

    // roleActivityCapabilities/user 預設：basic_create + own_edit_basic（不含 addons_use）
    await setDoc(doc(db, "roleActivityCapabilities", "user"), {
      catalogVersion: 1,
      capabilities: [
        "user.activity.basic_create",
        "user.activity.own_edit_basic",
      ],
    });
    await setDoc(doc(db, "roleActivityCapabilities", "coach"), {
      catalogVersion: 1, capabilities: [],
    });
    await setDoc(doc(db, "roleActivityCapabilities", "admin"), {
      catalogVersion: 1, capabilities: [],
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

/* ──────────────────────────────────────────────────
 * A. eventTemplates
 * ────────────────────────────────────────────────── */

describe("A. eventTemplates", () => {
  test("1. 本人（一般 user）addDoc 建立 ownerUid＝自己 → 允許", async () => {
    const db = authAs(USER_UID, "user");
    const payload = templatePayload({ id: "tpl_self_create", ownerUid: USER_UID });
    await assertSucceeds(addDoc(collection(db, "eventTemplates"), payload));
  });

  test("2. ownerUid 是別人 → 拒", async () => {
    const db = authAs(USER_UID, "user");
    const payload = templatePayload({ id: "tpl_bad_owner", ownerUid: OTHER_COACH_UID });
    await assertFails(addDoc(collection(db, "eventTemplates"), payload));
  });

  test("3. 缺 name → 拒", async () => {
    const db = authAs(USER_UID, "user");
    const payload = templatePayload({ id: "tpl_no_name", ownerUid: USER_UID });
    delete payload.name;
    await assertFails(addDoc(collection(db, "eventTemplates"), payload));
  });

  test("4. 未登入 → 拒", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const payload = templatePayload({ id: "tpl_anon", ownerUid: USER_UID });
    await assertFails(addDoc(collection(db, "eventTemplates"), payload));
  });

  test("5. 本人讀自己的範本（getDoc 與 where(ownerUid==uid) 查詢）→ 允許", async () => {
    await seedTemplate("tpl_own", { ownerUid: USER_UID });
    const db = authAs(USER_UID, "user");
    await assertSucceeds(getDoc(doc(db, "eventTemplates", "tpl_own")));
    await assertSucceeds(
      getDocs(query(
        collection(db, "eventTemplates"),
        where("ownerUid", "==", USER_UID)
      ))
    );
  });

  test("6. 讀別人的 → 拒", async () => {
    await seedTemplate("tpl_other", { ownerUid: OTHER_COACH_UID });
    const db = authAs(USER_UID, "user");
    await assertFails(getDoc(doc(db, "eventTemplates", "tpl_other")));
  });

  test("7. admin 讀別人的 → 允許", async () => {
    await seedTemplate("tpl_other", { ownerUid: OTHER_COACH_UID });
    const db = authAs(ADMIN_UID, "admin", true);
    await assertSucceeds(getDoc(doc(db, "eventTemplates", "tpl_other")));
  });

  test("8. 本人刪除自己的 → 允許", async () => {
    await seedTemplate("tpl_own", { ownerUid: USER_UID });
    const db = authAs(USER_UID, "user");
    await assertSucceeds(deleteDoc(doc(db, "eventTemplates", "tpl_own")));
  });

  test("9. 刪別人的 → 拒", async () => {
    await seedTemplate("tpl_other", { ownerUid: OTHER_COACH_UID });
    const db = authAs(USER_UID, "user");
    await assertFails(deleteDoc(doc(db, "eventTemplates", "tpl_other")));
  });

  test("10. 本人更新自己的（改 name）→ 允許", async () => {
    await seedTemplate("tpl_own", { ownerUid: USER_UID });
    const db = authAs(USER_UID, "user");
    // 現行 Rules 於 update 只比對 affectedKeys 是否含 ownerUid 變更；
    // 只改 name 時 request.resource.data.ownerUid 仍等於舊值 → allow。
    await assertSucceeds(updateDoc(doc(db, "eventTemplates", "tpl_own"), {
      name: "更新後的範本",
    }));
  });

  test("11. 把 ownerUid 改成別人 → 拒", async () => {
    await seedTemplate("tpl_own", { ownerUid: USER_UID });
    const db = authAs(USER_UID, "user");
    // Rules: resource.data.ownerUid == request.auth.uid
    //        且 request.resource.data.ownerUid == resource.data.ownerUid。
    // 改成 OTHER_COACH_UID 使後者不成立 → 拒。
    await assertFails(updateDoc(doc(db, "eventTemplates", "tpl_own"), {
      ownerUid: OTHER_COACH_UID,
    }));
  });
});

/* ──────────────────────────────────────────────────
 * B. 多日期批次建立（同一個 runTransaction 內 set 多筆 events/{id}）
 * ────────────────────────────────────────────────── */

describe("B. 多日期批次建立（同一個 runTransaction 內 set 多筆 events/{id}）", () => {
  test("12. 教練一次建立 2 場 → 允許", async () => {
    const db = authAs(COACH_UID, "coach");
    const payloads = [
      basePayload({
        id: "ce_mlt_coach_1",
        clientRequestId: "ce_mlt_coach_1",
        creatorUid: COACH_UID,
        creator: "王教練",
        date: "2026/06/01 10:00~12:00",
        startTimestamp: new Date("2026-06-01T10:00:00.000Z"),
        endTimestamp: new Date("2026-06-01T12:00:00.000Z"),
      }),
      basePayload({
        id: "ce_mlt_coach_2",
        clientRequestId: "ce_mlt_coach_2",
        creatorUid: COACH_UID,
        creator: "王教練",
        date: "2026/06/02 10:00~12:00",
        startTimestamp: new Date("2026-06-02T10:00:00.000Z"),
        endTimestamp: new Date("2026-06-02T12:00:00.000Z"),
      }),
    ];
    await assertSucceeds(batchCreateEvents(db, payloads));
    expect(await eventDocExists("ce_mlt_coach_1")).toBe(true);
    expect(await eventDocExists("ce_mlt_coach_2")).toBe(true);
  });

  test("13. 一般 user（basic_create）一次建立 3 場 → 允許", async () => {
    const db = authAs(USER_UID, "user");
    const payloads = [
      basePayload({
        id: "ce_mlt_user_1",
        clientRequestId: "ce_mlt_user_1",
        creatorUid: USER_UID,
        creator: "小明",
        date: "2026/06/10 10:00~12:00",
        startTimestamp: new Date("2026-06-10T10:00:00.000Z"),
        endTimestamp: new Date("2026-06-10T12:00:00.000Z"),
      }),
      basePayload({
        id: "ce_mlt_user_2",
        clientRequestId: "ce_mlt_user_2",
        creatorUid: USER_UID,
        creator: "小明",
        date: "2026/06/11 10:00~12:00",
        startTimestamp: new Date("2026-06-11T10:00:00.000Z"),
        endTimestamp: new Date("2026-06-11T12:00:00.000Z"),
      }),
      basePayload({
        id: "ce_mlt_user_3",
        clientRequestId: "ce_mlt_user_3",
        creatorUid: USER_UID,
        creator: "小明",
        date: "2026/06/12 10:00~12:00",
        startTimestamp: new Date("2026-06-12T10:00:00.000Z"),
        endTimestamp: new Date("2026-06-12T12:00:00.000Z"),
      }),
    ];
    await assertSucceeds(batchCreateEvents(db, payloads));
    expect(await eventDocExists("ce_mlt_user_1")).toBe(true);
    expect(await eventDocExists("ce_mlt_user_2")).toBe(true);
    expect(await eventDocExists("ce_mlt_user_3")).toBe(true);
  });

  test("14. 一般 user 批次中有一筆 clientRequestId 與 id 不同 → 整筆 transaction 拒（2 筆都不存在）", async () => {
    const db = authAs(USER_UID, "user");
    const payloads = [
      basePayload({
        id: "ce_mlt_user_bad_1",
        clientRequestId: "ce_mlt_user_bad_1",
        creatorUid: USER_UID,
        creator: "小明",
        date: "2026/06/15 10:00~12:00",
        startTimestamp: new Date("2026-06-15T10:00:00.000Z"),
        endTimestamp: new Date("2026-06-15T12:00:00.000Z"),
      }),
      basePayload({
        id: "ce_mlt_user_bad_2",
        clientRequestId: "ce_mlt_user_bad_2_mismatch",
        creatorUid: USER_UID,
        creator: "小明",
        date: "2026/06/16 10:00~12:00",
        startTimestamp: new Date("2026-06-16T10:00:00.000Z"),
        endTimestamp: new Date("2026-06-16T12:00:00.000Z"),
      }),
    ];
    // 實測（2026-10-22，T-013）：Rules 檢查 clientRequestId 與 id 一致，整筆 transaction 拒、一筆都不寫。
    await assertFails(batchCreateEvents(db, payloads));
    expect(await eventDocExists("ce_mlt_user_bad_1")).toBe(false);
    expect(await eventDocExists("ce_mlt_user_bad_2")).toBe(false);
  });

  test("15. 一般 user 無 addons_use、批次中一筆帶 privateEvent: true → 整筆拒", async () => {
    const db = authAs(USER_UID, "user");
    const payloads = [
      basePayload({
        id: "ce_mlt_user_prv_1",
        clientRequestId: "ce_mlt_user_prv_1",
        creatorUid: USER_UID,
        creator: "小明",
        date: "2026/06/20 10:00~12:00",
        startTimestamp: new Date("2026-06-20T10:00:00.000Z"),
        endTimestamp: new Date("2026-06-20T12:00:00.000Z"),
      }),
      basePayload({
        id: "ce_mlt_user_prv_2",
        clientRequestId: "ce_mlt_user_prv_2",
        creatorUid: USER_UID,
        creator: "小明",
        date: "2026/06/21 10:00~12:00",
        startTimestamp: new Date("2026-06-21T10:00:00.000Z"),
        endTimestamp: new Date("2026-06-21T12:00:00.000Z"),
        privateEvent: true,
      }),
    ];
    // 依 R-CAP-004：一般 user 無 addons_use 時事件加值欄位必須全關。
    // 任一筆帶 privateEvent: true → 該筆 deny，transaction 全部 rollback。
    await assertFails(batchCreateEvents(db, payloads));
    expect(await eventDocExists("ce_mlt_user_prv_1")).toBe(false);
    expect(await eventDocExists("ce_mlt_user_prv_2")).toBe(false);
  });

  test("16. 教練一次建立 30 場 → 記錄實況（A 落差警語：Rules 每筆各自評估）", async () => {
    const db = authAs(COACH_UID, "coach");
    const payloads = [];
    for (let i = 1; i <= 30; i++) {
      const day = String(i).padStart(2, "0");
      const id = `ce_mlt_coach_batch30_${day}`;
      payloads.push(basePayload({
        id,
        clientRequestId: id,
        creatorUid: COACH_UID,
        creator: "王教練",
        date: `2026/07/${day} 10:00~12:00`,
        startTimestamp: new Date(`2026-07-${day}T10:00:00.000Z`),
        endTimestamp: new Date(`2026-07-${day}T12:00:00.000Z`),
      }));
    }
    // 預期：教練（coach）具 hasActivityManageEntry，且 Rules 對交易內每筆 write 各自評估；
    // 各筆都是基本 create payload（無 addon 欄位），理當全部通過 → allow。
    //
    // 實測（2026-10-22，T-013）：30 筆同一 transaction 允許（每筆各自評估），無 A 落差。
    await assertSucceeds(batchCreateEvents(db, payloads));
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDocs(collection(ctx.firestore(), "events"));
      expect(snap.size).toBe(30);
    });
  });
});
