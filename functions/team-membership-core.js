"use strict";

/**
 * removeTeamMember / deleteTeam 共用的純函式與 Firestore 讀取 helper（T-027 7b(A)）。
 * 只放兩個 Callable 都會用到的東西，權限判斷各自留在 team-member-removal.js / team-deletion.js。
 */

const { countTeamMembers, getUserTeamIds } = require("./team-member-count");

const MAX_ID_LENGTH = 128;
const PAGE_SIZE = 500;
const TEAM_NAME_READ_CHUNK = 50;

// 同時擋掉 Firestore 不允許的文件 id（"."、".."、"__x__"），否則 .doc(id) 會同步拋非 HttpsError 而變成 internal。
function normalizeId(value) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (!id || id.length > MAX_ID_LENGTH || id.includes("/")) return "";
  return id === "." || id === ".." || /^__.*__$/.test(id) ? "" : id;
}

// log 用：不印完整 teamId，只留頭尾供比對。
function maskId(value) {
  const id = String(value || "");
  return id.length <= 8 ? `${id.slice(0, 2)}***` : `${id.slice(0, 4)}...${id.slice(-3)}`;
}

// 以「文件 id」解析 team（審查 P3-1，FC 顧問裁示）：成員歸屬、隊名讀取、「目前在該隊」判斷一律以 team 文件的 ref／文件 id 為準，
// 不使用 team 文件的 id 欄位——owner 可以改寫自己隊伍文件的 id 欄位（firestore.rules teams update 不限欄位），
// 若用它比對就能把別隊的邏輯 id 當成自己的，讓 deleteTeam／removeTeamMember 去動別隊成員。
//  - 以文件 id 命中、但 id 欄位存在且不等於文件 id → TEAM_ID_MISMATCH（不處理）。
//  - 文件 id 查無、但另有文件的 id 欄位等於輸入（舊資料：文件 id ≠ id 欄位）→ 同樣 TEAM_ID_MISMATCH：
//    users.teamIds 存的是邏輯 id，以文件 id 為準就清不到那些成員，與其誤報「查無」，不如明確拒絕（這類舊資料不在本 Callable 支援範圍）。
// team-member-count.js 的 resolveTeamDoc（會退回 where('id','==',…)）沒有 export，這裡不照抄那個退回。
function assertTeamDocIdConsistent(teamSnap, HttpsError) {
  const fieldId = teamSnap.data()?.id;
  if (fieldId !== undefined && fieldId !== null && fieldId !== "" && String(fieldId) !== teamSnap.id) {
    throw new HttpsError("failed-precondition", "TEAM_ID_MISMATCH");
  }
}

async function resolveTeamSnapshot(db, teamId, HttpsError) {
  const direct = await db.collection("teams").doc(teamId).get();
  if (direct && direct.exists) {
    assertTeamDocIdConsistent(direct, HttpsError);
    return direct;
  }
  const legacy = await db.collection("teams").where("id", "==", teamId).limit(1).get();
  if (Array.isArray(legacy?.docs) && legacy.docs.length > 0) {
    throw new HttpsError("failed-precondition", "TEAM_ID_MISMATCH");
  }
  return null;
}

// Firestore 衝突類錯誤（gRPC 數字碼、字串碼或訊息皆可能出現）。
function isFirestoreError(error, name) {
  const numeric = name === "not-found" ? 5 : 9;
  const text = name === "not-found" ? "NOT_FOUND" : "FAILED_PRECONDITION";
  return error?.code === numeric || error?.code === name || String(error?.message || "").includes(text);
}

// 對應 A js/config.js _BASE_ROLES 的 label。
const ROLE_LABELS = Object.freeze({
  user: "一般用戶", coach: "教練", captain: "領隊", venue_owner: "場主", admin: "管理員", super_admin: "總管",
});

// 站內信 time 欄位：A 用 YYYY/MM/DD HH:mm；台灣固定 UTC+8、無日光節約，不依賴 Intl。
function formatTaipeiDateTime(date) {
  const tw = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${tw.getUTCFullYear()}/${pad(tw.getUTCMonth() + 1)}/${pad(tw.getUTCDate())} ${pad(tw.getUTCHours())}:${pad(tw.getUTCMinutes())}`;
}

// 隊長／領隊（含舊欄位 leaderUid）／教練；比對時一律取聯集（保護面寧寬勿窄）。
function collectStaffUids(team) {
  const uids = new Set();
  const push = (value) => {
    const uid = normalizeId(value);
    if (uid) uids.add(uid);
  };
  push(team?.captainUid);
  push(team?.leaderUid);
  if (Array.isArray(team?.leaderUids)) team.leaderUids.forEach(push);
  if (Array.isArray(team?.coachUids)) team.coachUids.forEach(push);
  return uids;
}

// 操作者名稱對齊 A：operationLogs.operator ＝ displayName || 角色標籤 || '系統'（api-service.js _writeOpLog）；
// 記錄內文用的名稱 ＝ displayName || name || '職員'（team-detail.js actorName）。查不到使用者文件時只用預設值。
async function readActorNames(db, callerUid, role) {
  let data = {};
  try {
    const snap = await db.collection("users").doc(callerUid).get();
    data = snap?.exists ? snap.data() || {} : {};
  } catch (_) {
    data = {};
  }
  const displayName = String(data.displayName || "").trim();
  return {
    operator: displayName || ROLE_LABELS[role] || "系統",
    contentName: displayName || String(data.name || "").trim() || "職員",
  };
}

// 逐隊讀 name（A 的 team-detail.js 也是逐一取 name，查不到就用 id）。
async function readTeamNames(teamIds, readSnapshot) {
  const names = new Map();
  for (let i = 0; i < teamIds.length; i += TEAM_NAME_READ_CHUNK) {
    await Promise.all(teamIds.slice(i, i + TEAM_NAME_READ_CHUNK).map(async (id) => {
      const snap = normalizeId(id) ? await readSnapshot(id) : null;
      const name = snap?.exists ? snap.data()?.name : "";
      names.set(id, typeof name === "string" && name ? name : id);
    }));
  }
  return names;
}

// 把 removedTeamId 從使用者的隊伍欄位扣掉（teamIds ∪ teamId、保序去重）；剩餘第 0 筆為主隊。
function buildNextMembership(userData, removedTeamId, teamNames) {
  const teamIds = getUserTeamIds(userData).filter((id) => id !== removedTeamId);
  const names = teamIds.map((id) => teamNames.get(id) || id);
  return teamIds.length > 0
    ? { teamId: teamIds[0], teamName: names[0], teamIds, teamNames: names }
    : { teamId: null, teamName: null, teamIds: [], teamNames: [] };
}

// 以 documentId 排序分頁讀完整個查詢（使用者數可能上千，不一次 get）。
async function readAllDocs(query, FieldPath) {
  const docs = [];
  let cursor = null;
  for (;;) {
    let page = query.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await page.get();
    docs.push(...snapshot.docs);
    if (snapshot.docs.length < PAGE_SIZE) return docs;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
}

// 與 recountTeamMembers Callable 同資料來源、同一支 countTeamMembers 純函式，結果寫回 teams.members。
async function recountAndWriteTeamMembers({ db, FieldValue, teamRef }) {
  const teamSnap = await teamRef.get();
  if (!teamSnap.exists) return null;
  // 成員歸屬以文件 id 為準（見 resolveTeamSnapshot）；覆寫 id 欄位，countTeamMembers 才不會用被竄改的值比對。
  const teamData = { ...(teamSnap.data() || {}), id: teamRef.id };
  const teamDocId = teamRef.id;

  const [byTeamIds, byTeamId, studentsSnap] = await Promise.all([
    db.collection("users").where("teamIds", "array-contains", teamDocId).get(),
    db.collection("users").where("teamId", "==", teamDocId).get(),
    teamRef.collection("students").get(),
  ]);
  const userByDocId = new Map();
  const collectUser = (doc) => {
    if (!doc || doc.exists === false) return;
    const data = doc.data() || {};
    userByDocId.set(doc.id, { ...data, _docId: doc.id, uid: data.uid || doc.id });
  };
  (byTeamIds?.docs || []).forEach(collectUser);
  (byTeamId?.docs || []).forEach(collectUser);

  const known = new Set();
  userByDocId.forEach((user) => {
    known.add(user._docId);
    known.add(user.uid);
    if (user.lineUserId) known.add(user.lineUserId);
  });
  const missingStaff = [...collectStaffUids(teamData)].filter((uid) => !known.has(uid));
  const staffDocs = await Promise.all(missingStaff.map((uid) => db.collection("users").doc(uid).get()));
  staffDocs.forEach(collectUser);

  const students = (studentsSnap?.docs || []).map((doc) => ({
    ...(doc.data() || {}),
    _docId: doc.id,
    id: doc.data()?.id || doc.id,
  }));
  const { members } = countTeamMembers({ team: teamData, users: [...userByDocId.values()], students });
  await teamRef.update({ members, updatedAt: FieldValue.serverTimestamp() });
  return members;
}

module.exports = {
  ROLE_LABELS,
  assertTeamDocIdConsistent,
  buildNextMembership,
  collectStaffUids,
  formatTaipeiDateTime,
  isFirestoreError,
  maskId,
  normalizeId,
  readActorNames,
  readAllDocs,
  readTeamNames,
  recountAndWriteTeamMembers,
  resolveTeamSnapshot,
};
