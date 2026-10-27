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

// team-member-count.js 的 resolveTeamDoc 沒有 export，行為照抄：docId 優先，再 where('id','==',…)。
async function resolveTeamSnapshot(db, teamId) {
  const direct = await db.collection("teams").doc(teamId).get();
  if (direct && direct.exists) return direct;
  const query = await db.collection("teams").where("id", "==", teamId).limit(1).get();
  return query && Array.isArray(query.docs) && query.docs.length > 0 ? query.docs[0] : null;
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

async function readActorName(db, callerUid) {
  try {
    const snap = await db.collection("users").doc(callerUid).get();
    const data = snap?.exists ? snap.data() || {} : {};
    return String(data.displayName || data.name || "").trim() || "職員";
  } catch (_) {
    return "職員";
  }
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
  const raw = teamSnap.data() || {};
  const teamData = { ...raw, id: raw.id || teamRef.id };
  const logicalTeamId = String(teamData.id);

  const [byTeamIds, byTeamId, studentsSnap] = await Promise.all([
    db.collection("users").where("teamIds", "array-contains", logicalTeamId).get(),
    db.collection("users").where("teamId", "==", logicalTeamId).get(),
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
  buildNextMembership,
  collectStaffUids,
  maskId,
  normalizeId,
  readActorName,
  readAllDocs,
  readTeamNames,
  recountAndWriteTeamMembers,
  resolveTeamSnapshot,
};
