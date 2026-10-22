/**
 * M-093：與 FC-B event-comments.ts payload builders 逐欄同步。
 * 使用 emulator；不修改 Rules、不連正式資料。
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
  getDoc,
  getDocs,
  collection,
  query,
  where,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  setLogLevel,
} = require("firebase/firestore");

const PROJECT_ID = "demo-b-contract-event-comments";
const RULES_PATH = path.resolve(__dirname, "..", "..", "..", "firestore.rules");
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
const PUBLIC_ID = "ce_comments_public";
const DOCUMENT_ID = "comments_document";
const MEMBER = "uid_member";
const OTHER = "uid_other";
const HOST_UID = "uid_host";
const DELEGATE = "uid_delegate";
const ADMIN = "uid_admin";
const CAPTAIN = "uid_captain";
const OBJECT_DELEGATE = "uid_object_delegate";
let env;

jest.setTimeout(20000);

function dbAs(uid) {
  return env.authenticatedContext(uid).firestore();
}

function commentRef(db, id = "comment") {
  return doc(db, "events", DOCUMENT_ID, "comments", id);
}

function replyRef(db, id = "reply", parent = "comment") {
  return doc(db, "events", DOCUMENT_ID, "comments", parent, "replies", id);
}

function likeRef(db, uid, reply = false) {
  return reply
    ? doc(replyRef(db), "likes", uid)
    : doc(commentRef(db), "likes", uid);
}

function author(uid = MEMBER) {
  return {
    authorUid: uid,
    authorName: "小明",
    authorPhoto: "",
    identitySnapshot: { identityId: "main", displayName: "小明", avatarUrl: "" },
  };
}

function commentPayload(overrides = {}) {
  return {
    eventId: PUBLIC_ID,
    ...author(),
    body: "留言",
    visibility: "public",
    replyLocked: false,
    deleted: false,
    replyCount: 0,
    likeCount: 0,
    recentLikers: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function replyPayload(overrides = {}) {
  return {
    eventId: PUBLIC_ID,
    commentId: "comment",
    ...author(),
    body: "回覆",
    deleted: false,
    likeCount: 0,
    recentLikers: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function likePayload(uid = MEMBER, reply = false, legacy = false) {
  return {
    eventId: PUBLIC_ID,
    commentId: "comment",
    ...(reply ? { replyId: "reply" } : {}),
    uid,
    ...(!legacy ? { authorName: "小明", authorPhoto: "" } : {}),
    createdAt: serverTimestamp(),
  };
}

function deletionPayload(uid) {
  return {
    deleted: true,
    deletedByUid: uid,
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function seedComment(id = "comment", overrides = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(commentRef(ctx.firestore(), id), commentPayload(overrides));
  });
}

beforeAll(async () => {
  setLogLevel("error");
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: HOST,
      port: Number(PORT),
      rules: fs.readFileSync(RULES_PATH, "utf8"),
    },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const uid of [MEMBER, OTHER, HOST_UID, DELEGATE, ADMIN, CAPTAIN, OBJECT_DELEGATE]) {
      // ASSUMPTION: 未附身份驗證 helper 全文；seed 主身份名稱／照片與 B payload 一致。
      await setDoc(doc(db, "users", uid), {
        uid,
        role: uid === ADMIN ? "admin" : "user",
        displayName: "小明",
        pictureUrl: "",
      });
    }
    await setDoc(doc(db, "events", DOCUMENT_ID), {
      id: PUBLIC_ID,
      status: "open",
      creatorUid: HOST_UID,
      ownerUid: HOST_UID,
      captainUid: CAPTAIN,
      delegateUids: [DELEGATE],
      delegates: [{ uid: DELEGATE }, { uid: OBJECT_DELEGATE }],
      endTimestamp: new Date("2099-01-01T00:00:00Z"),
    });
    await setDoc(commentRef(db), commentPayload());
    await setDoc(replyRef(db), replyPayload());
  });
});

afterAll(async () => {
  if (env) await env.cleanup();
});

describe("M-093 留言建立", () => {
  test.each(["public", "private"])("%s 留言完整 B payload allow", async (visibility) => {
    await assertSucceeds(setDoc(commentRef(dbAs(MEMBER), "new"), commentPayload({ visibility })));
  });

  test("legacy payload 去除三個摘要欄位 allow", async () => {
    const payload = commentPayload();
    delete payload.replyCount;
    delete payload.likeCount;
    delete payload.recentLikers;
    await assertSucceeds(setDoc(commentRef(dbAs(MEMBER), "legacy"), payload));
  });

  test("額外欄位 deny", async () => {
    await assertFails(setDoc(commentRef(dbAs(MEMBER), "extra"), commentPayload({ extra: true })));
  });

  test.each([
    "eventId", "authorUid", "authorName", "authorPhoto", "body", "visibility",
    "replyLocked", "deleted", "createdAt", "updatedAt",
  ])("缺少必要欄位 %s deny", async (field) => {
    const payload = commentPayload();
    delete payload[field];
    await assertFails(setDoc(commentRef(dbAs(MEMBER), "missing"), payload));
  });

  test("冒用 authorUid deny", async () => {
    await assertFails(setDoc(commentRef(dbAs(MEMBER), "spoof"), commentPayload({ authorUid: OTHER })));
  });

  test("body 300 allow；301 deny", async () => {
    await assertSucceeds(setDoc(commentRef(dbAs(MEMBER), "max"), commentPayload({ body: "字".repeat(300) })));
    await assertFails(setDoc(commentRef(dbAs(MEMBER), "over"), commentPayload({ body: "字".repeat(301) })));
  });

  test("空白名稱與過長根作者欄位 deny，不擅改 A payload", async () => {
    await assertFails(setDoc(commentRef(dbAs(MEMBER), "empty-name"), commentPayload({ authorName: "" })));
    await assertFails(setDoc(commentRef(dbAs(MEMBER), "long-name"), commentPayload({ authorName: "名".repeat(81) })));
    await assertFails(setDoc(commentRef(dbAs(MEMBER), "long-photo"), commentPayload({ authorPhoto: "p".repeat(1201) })));
  });

  test("取消／已過 endTimestamp 活動 deny", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "events", DOCUMENT_ID), { status: "cancelled" });
    });
    await assertFails(setDoc(commentRef(dbAs(MEMBER), "cancelled"), commentPayload()));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "events", DOCUMENT_ID), {
        status: "open", endTimestamp: new Date("2000-01-01T00:00:00Z"),
      });
    });
    await assertFails(setDoc(commentRef(dbAs(MEMBER), "ended"), commentPayload()));
  });
});

describe("M-093 回覆", () => {
  test("一般登入者完整 B payload allow", async () => {
    await assertSucceeds(setDoc(replyRef(dbAs(MEMBER), "new"), replyPayload()));
  });

  test("legacy payload 去除 likeCount／recentLikers allow", async () => {
    const payload = replyPayload();
    delete payload.likeCount;
    delete payload.recentLikers;
    await assertSucceeds(setDoc(replyRef(dbAs(MEMBER), "legacy"), payload));
  });

  test("100 字 allow；101 字 deny", async () => {
    await assertSucceeds(setDoc(replyRef(dbAs(MEMBER), "max"), replyPayload({ body: "字".repeat(100) })));
    await assertFails(setDoc(replyRef(dbAs(MEMBER), "over"), replyPayload({ body: "字".repeat(101) })));
  });

  test.each(["replyLocked", "deleted"])("父留言 %s=true deny", async (field) => {
    await seedComment("comment", { [field]: true });
    await assertFails(setDoc(replyRef(dbAs(MEMBER), "blocked"), replyPayload()));
  });

  test("冒用作者／錯 commentId／額外欄位 deny", async () => {
    for (const overrides of [{ authorUid: OTHER }, { commentId: "wrong" }, { extra: true }]) {
      await assertFails(setDoc(replyRef(dbAs(MEMBER), "invalid"), replyPayload(overrides)));
    }
  });
});

describe("M-093 讚與摘要", () => {
  test.each([false, true])("reply=%s：本人 like create allow，他人路徑 deny", async (reply) => {
    const db = dbAs(MEMBER);
    await assertSucceeds(setDoc(likeRef(db, MEMBER, reply), likePayload(MEMBER, reply)));
    await assertFails(setDoc(likeRef(db, OTHER, reply), likePayload(MEMBER, reply)));
    await assertFails(setDoc(likeRef(db, MEMBER, reply), likePayload(MEMBER, reply)));
  });

  test.each([false, true])("reply=%s：legacy like create allow", async (reply) => {
    await assertSucceeds(setDoc(likeRef(dbAs(MEMBER), MEMBER, reply), likePayload(MEMBER, reply, true)));
  });

  test.each([false, true])("reply=%s：與 B transaction 相同摘要形狀 allow", async (reply) => {
    const db = dbAs(MEMBER);
    const target = reply ? replyRef(db) : commentRef(db);
    const ownLike = likeRef(db, MEMBER, reply);
    const add = writeBatch(db);
    add.set(ownLike, likePayload(MEMBER, reply));
    add.update(target, {
      likeCount: 1,
      recentLikers: [{ uid: MEMBER, authorName: "小明", authorPhoto: "" }],
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(add.commit());

    const remove = writeBatch(db);
    remove.delete(ownLike);
    remove.update(target, {
      likeCount: 0, recentLikers: [], updatedAt: serverTimestamp(),
    });
    await assertSucceeds(remove.commit());
  });

  test.each([false, true])("reply=%s：未建立 like 卻加摘要 deny", async (reply) => {
    const db = dbAs(MEMBER);
    await assertFails(updateDoc(reply ? replyRef(db) : commentRef(db), {
      likeCount: 1,
      recentLikers: [{ uid: MEMBER, authorName: "小明", authorPhoto: "" }],
      updatedAt: serverTimestamp(),
    }));
  });

  test("他人不得取消本人的讚", async () => {
    await assertSucceeds(setDoc(likeRef(dbAs(MEMBER), MEMBER), likePayload()));
    await assertFails(deleteDoc(likeRef(dbAs(OTHER), MEMBER)));
    await assertSucceeds(deleteDoc(likeRef(dbAs(MEMBER), MEMBER)));
  });
});

describe("M-093 讀取", () => {
  beforeEach(async () => {
    await seedComment("private", { visibility: "private" });
  });

  test.each([MEMBER, HOST_UID, DELEGATE, ADMIN])("%s 可讀私密留言", async (uid) => {
    await assertSucceeds(getDoc(commentRef(dbAs(uid), "private")));
  });

  test("其他一般使用者不可讀私密，但可讀公開留言", async () => {
    await assertFails(getDoc(commentRef(dbAs(OTHER), "private")));
    await assertSucceeds(getDoc(commentRef(dbAs(OTHER))));
  });

  test("匿名連公開留言也 deny，記錄需求與現行 Rules 衝突", async () => {
    await assertFails(getDoc(commentRef(env.unauthenticatedContext().firestore())));
  });

  test("一般使用者公開＋本人查詢 allow，無條件集合查詢 deny", async () => {
    const db = dbAs(MEMBER);
    const ref = collection(db, "events", DOCUMENT_ID, "comments");
    await assertSucceeds(getDocs(query(ref, where("visibility", "==", "public"))));
    await assertSucceeds(getDocs(query(ref, where("authorUid", "==", MEMBER))));
    await assertFails(getDocs(ref));
  });

  test("主辦無條件讀取留言 allow", async () => {
    await assertSucceeds(getDocs(collection(dbAs(HOST_UID), "events", DOCUMENT_ID, "comments")));
  });
});

describe("M-093 管理與軟刪除", () => {
  test.each([HOST_UID, DELEGATE, ADMIN])("%s 鎖定／解鎖與軟刪除 allow", async (uid) => {
    const db = dbAs(uid);
    await assertSucceeds(updateDoc(commentRef(db), {
      replyLocked: true, updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(commentRef(db), {
      replyLocked: false, updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(replyRef(db), deletionPayload(uid)));
    await assertSucceeds(updateDoc(commentRef(db), deletionPayload(uid)));
  });

  test.each([MEMBER, OTHER])("%s 即使是留言作者也不可管理", async (uid) => {
    const db = dbAs(uid);
    await assertFails(updateDoc(commentRef(db), { replyLocked: true, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(commentRef(db), deletionPayload(uid)));
    await assertFails(updateDoc(replyRef(db), deletionPayload(uid)));
    await assertFails(deleteDoc(commentRef(db)));
    await assertFails(deleteDoc(replyRef(db)));
  });

  test("記錄 A helper／Rules 差異：captainUid Rules allow", async () => {
    await assertSucceeds(updateDoc(commentRef(dbAs(CAPTAIN)), {
      replyLocked: true, updatedAt: serverTimestamp(),
    }));
  });

  test("記錄 A helper／Rules 差異：只有 delegates[].uid 而不在 delegateUids 時 deny", async () => {
    await assertFails(updateDoc(commentRef(dbAs(OBJECT_DELEGATE)), {
      replyLocked: true, updatedAt: serverTimestamp(),
    }));
  });

  test("管理者不可藉軟刪除改寫留言本文", async () => {
    await assertFails(updateDoc(commentRef(dbAs(HOST_UID)), {
      ...deletionPayload(HOST_UID), body: "被改寫",
    }));
  });
});
