"use strict";

/**
 * 俱樂部 Callable 共用的純函式與 Firestore 讀取 helper。
 * 各 Callable 的動作權限判斷留在各自模組。
 */

const { countTeamMembers, getUserTeamIds } = require("./team-member-count");

const MAX_ID_LENGTH = 128;
const PAGE_SIZE = 500;
const TEAM_NAME_READ_CHUNK = 50;

// T-090 共用標記定義；legacy 無欄位視為管理端建立，不查創建者目前資格。
function isUserCreatedTeam(teamData) {
  return teamData?.createdVia === "user_capability";
}

// OWNER_FIELDS 與 deleteTeam／removeTeamMember 相同；只接受文件內的本人 UID。
function isUserCreatedTeamOwner(teamData, uid) {
  return isUserCreatedTeam(teamData) && typeof uid === "string" && uid.length > 0
    && ["captainUid", "creatorUid", "ownerUid"].some((field) => teamData[field] === uid);
}

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

// 保留舊的一致性檢查 export；刪隊／剔除改由 resolver 與安全別名檢查處理舊格式。
function assertTeamDocIdConsistent(teamSnap, HttpsError) {
  const fieldId = teamSnap.data()?.id;
  if (fieldId !== undefined && fieldId !== null && fieldId !== "" && String(fieldId) !== teamSnap.id) {
    throw new HttpsError("failed-precondition", "TEAM_ID_MISMATCH");
  }
}

// 文件 id 優先；查無時才接受唯一的舊邏輯 id，避免任選同名文件。
async function resolveTeamSnapshot(db, teamId, HttpsError, readSnapshot = (ref) => ref.get()) {
  // T-090f：共用邊界只收 normalizeId 原樣通過的單一路徑段；巢狀路徑（tm/students/x）會把子集合文件當俱樂部。
  // 不合格視為查無、零讀取；F1 入口已先 normalizeId，合法 id 行為不變。
  if (typeof teamId !== "string" || !teamId || normalizeId(teamId) !== teamId) return null;
  const direct = await readSnapshot(db.collection("teams").doc(teamId));
  if (direct && direct.exists) {
    return direct;
  }
  const legacy = await readSnapshot(db.collection("teams").where("id", "==", teamId).limit(2));
  if (legacy.docs.length > 1) {
    throw new HttpsError("failed-precondition", "TEAM_ID_AMBIGUOUS");
  }
  return legacy.docs[0] || null;
}

// owner 可改寫 id 欄位；只有沒有其他隊伍占用的舊 id 才能用於清理成員。
// readSnapshot 可傳 tx.get，讓剔除的別名檢查與 users 更新處於同一交易。
async function resolveMembershipTeamIds(db, teamSnap, readSnapshot = (ref) => ref.get()) {
  const ids = [teamSnap.id];
  const fieldId = teamSnap.data()?.id;
  // 不把不合法或帶空白的欄位轉成另一個有效 id，避免擴大清理範圍。
  if (!fieldId || normalizeId(fieldId) !== fieldId || fieldId === teamSnap.id) return ids;
  const teams = db.collection("teams");
  const direct = await readSnapshot(teams.doc(fieldId));
  if (direct.exists) return ids;
  const aliases = await readSnapshot(teams.where("id", "==", fieldId).limit(2));
  if (aliases.docs.some((doc) => doc.id !== teamSnap.id)) return ids;
  ids.push(fieldId);
  return ids;
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
  const membershipTeamIds = await resolveMembershipTeamIds(db, teamSnap);

  const [userSnapshots, studentsSnap] = await Promise.all([
    Promise.all(membershipTeamIds.flatMap((id) => [
      db.collection("users").where("teamIds", "array-contains", id).get(),
      db.collection("users").where("teamId", "==", id).get(),
    ])),
    teamRef.collection("students").get(),
  ]);
  const userByDocId = new Map();
  const collectUser = (doc) => {
    if (!doc || doc.exists === false) return;
    const data = doc.data() || {};
    // 只在計數副本中把安全別名對齊文件 id，保留 countTeamMembers 的文件 id 比對語意。
    const teamIds = getUserTeamIds(data).map((id) => membershipTeamIds.includes(id) ? teamDocId : id);
    // 舊格式文件沒有 uid 欄位時以 lineUserId 當身分鍵，與正本算同一人（健檢 C1-03）。
    userByDocId.set(doc.id, { ...data, teamIds, _docId: doc.id, uid: data.uid || data.lineUserId || doc.id });
  };
  userSnapshots.forEach((snapshot) => (snapshot?.docs || []).forEach(collectUser));

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
  isUserCreatedTeam,
  isUserCreatedTeamOwner,
  maskId,
  normalizeId,
  readActorNames,
  readAllDocs,
  readTeamNames,
  recountAndWriteTeamMembers,
  resolveMembershipTeamIds,
  resolveTeamSnapshot,
};
