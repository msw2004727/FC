"use strict";

/**
 * deleteTeam Phase 1：查出成員集合並分批清除隊伍欄位（T-027 7b(A)）。
 * 可重入：已清過的人不再符合查詢條件；每筆更新帶 lastUpdateTime 前置條件，讀與寫之間若成員自己的隊伍欄位又被改過
 * （例如剛退出別隊、或入隊審核剛加一隊），該批會因 FAILED_PRECONDITION 失敗，這裡重讀該批文件後重算並有上限地重試，
 * 不會把併發的變更蓋掉；仍失敗就拋出，由呼叫端轉成 TEAM_DELETE_FAILED（team 文件此時仍在，使用者可再試）。
 */

const { getUserTeamIds, isUserInTeam } = require("./team-member-count");
const {
  buildNextMembership,
  collectStaffUids,
  isFirestoreError,
  readAllDocs,
  readTeamNames,
} = require("./team-membership-core");

const BATCH_LIMIT = 450;
const MAX_ATTEMPTS = 3;

// 兩組查詢（teamIds array-contains、舊 teamId ==）分頁讀完並依 docId 去重；
// 再補上幹部 UID 的 users 文件（例如 teamIds 元素帶空白、查詢比對不到的舊資料），去重後只留「實際含本隊」者。
async function listTeamMemberDocs({ db, FieldPath, logicalTeamId, teamData }) {
  const users = db.collection("users");
  const [byTeamIds, byTeamId] = await Promise.all([
    readAllDocs(users.where("teamIds", "array-contains", logicalTeamId), FieldPath),
    readAllDocs(users.where("teamId", "==", logicalTeamId), FieldPath),
  ]);
  const byDocId = new Map();
  [...byTeamIds, ...byTeamId].forEach((doc) => byDocId.set(doc.id, doc));

  const known = new Set();
  byDocId.forEach((doc) => {
    const data = doc.data() || {};
    [doc.id, data.uid, data.lineUserId].forEach((value) => value && known.add(String(value)));
  });
  const missingStaff = [...collectStaffUids(teamData)].filter((uid) => !known.has(uid));
  const staffDocs = await Promise.all(missingStaff.map((uid) => users.doc(uid).get()));
  staffDocs.forEach((doc) => {
    if (doc?.exists) byDocId.set(doc.id, doc);
  });
  return [...byDocId.values()].filter((doc) => isUserInTeam(doc.data() || {}, logicalTeamId));
}

async function rereadStillInTeam(chunk, logicalTeamId) {
  const snaps = await Promise.all(chunk.map((doc) => doc.ref.get()));
  return snaps.filter((snap) => snap.exists && isUserInTeam(snap.data() || {}, logicalTeamId));
}

// 依每位成員「目前文件」重算四欄；回傳實際寫入的人數。
async function cleanMemberships({ db, FieldValue, memberDocs, logicalTeamId, logger, ctx }) {
  const nameCache = new Map();
  const namesFor = async (ids) => {
    const missing = ids.filter((id) => !nameCache.has(id));
    if (missing.length > 0) {
      (await readTeamNames(missing, (id) => db.collection("teams").doc(id).get()))
        .forEach((name, id) => nameCache.set(id, name));
    }
    return nameCache;
  };

  let cleaned = 0;
  for (let i = 0; i < memberDocs.length; i += BATCH_LIMIT) {
    let chunk = memberDocs.slice(i, i + BATCH_LIMIT);
    for (let attempt = 1; chunk.length > 0; attempt += 1) {
      const remainingIds = new Set();
      chunk.forEach((doc) => getUserTeamIds(doc.data() || {}).forEach((id) => {
        if (id !== logicalTeamId) remainingIds.add(id);
      }));
      const names = await namesFor([...remainingIds]);
      const batch = db.batch();
      chunk.forEach((doc) => {
        batch.update(
          doc.ref,
          { ...buildNextMembership(doc.data() || {}, logicalTeamId, names), updatedAt: FieldValue.serverTimestamp() },
          { lastUpdateTime: doc.updateTime },
        );
      });
      try {
        await batch.commit();
        cleaned += chunk.length;
        break;
      } catch (error) {
        const conflict = isFirestoreError(error, "failed-precondition") || isFirestoreError(error, "not-found");
        if (!conflict || attempt >= MAX_ATTEMPTS) throw error;
        logger.warn?.("[deleteTeam] member batch conflicted with a concurrent write, re-reading", {
          ...ctx,
          attempt,
          code: String(error?.code || "unknown"),
        });
        chunk = await rereadStillInTeam(chunk, logicalTeamId);
      }
    }
  }
  return cleaned;
}

module.exports = { cleanMemberships, listTeamMemberDocs };
