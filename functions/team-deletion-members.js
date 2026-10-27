"use strict";

/**
 * deleteTeam Phase 1：查出成員集合並分批清除隊伍欄位（T-027 7b(A)）。
 * 成員歸屬一律以 team 文件 id（teamDocId）為準，不用 team 文件內可被 owner 改寫的 id 欄位。
 * 可重入：已清過的人不再符合查詢條件。每筆更新帶 lastUpdateTime 前置條件，讀與寫之間若成員自己的隊伍欄位又被改過
 * （例如剛退出別隊、或入隊審核剛加一隊），不會把併發的變更蓋掉（寫回別隊退出的值是資料損壞，不能當已知限制）：
 *  1. 整批以前置條件提交；衝突（FAILED_PRECONDITION／NOT_FOUND）時重讀該批、略過已不在本隊者、重算後重試，最多 3 次。
 *  2. 仍衝突時改為逐位處理（一位的衝突不拖累其他人），每位最多 3 次。
 *  3. 仍失敗的成員記 structured log（遮罩 UID）並回報給呼叫端；呼叫端見到未清成員時必須回 partial、不得刪 team 文件。
 * 非衝突類的錯誤（網路、權限…）直接拋出，由呼叫端轉成 TEAM_DELETE_FAILED。
 */

const { getUserTeamIds, isUserInTeam } = require("./team-member-count");
const {
  buildNextMembership,
  collectStaffUids,
  isFirestoreError,
  maskId,
  readAllDocs,
  readTeamNames,
} = require("./team-membership-core");

const BATCH_LIMIT = 450;
const MAX_ATTEMPTS = 3;
const MAX_RECHECKS = 3;

const isConflict = (error) => isFirestoreError(error, "failed-precondition") || isFirestoreError(error, "not-found");

// 兩組查詢（teamIds array-contains、舊 teamId ==）分頁讀完並依 docId 去重；
// 再補上幹部 UID 的 users 文件（例如 teamIds 元素帶空白、查詢比對不到的舊資料），去重後只留「實際含本隊」者。
async function listTeamMemberDocs({ db, FieldPath, teamDocId, teamData }) {
  const users = db.collection("users");
  const [byTeamIds, byTeamId] = await Promise.all([
    readAllDocs(users.where("teamIds", "array-contains", teamDocId), FieldPath),
    readAllDocs(users.where("teamId", "==", teamDocId), FieldPath),
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
  return [...byDocId.values()].filter((doc) => isUserInTeam(doc.data() || {}, teamDocId));
}

async function rereadStillInTeam(docs, teamDocId) {
  const snaps = await Promise.all(docs.map((doc) => doc.ref.get()));
  return snaps.filter((snap) => snap.exists && isUserInTeam(snap.data() || {}, teamDocId));
}

// 依每位成員「目前文件」重算四欄；回傳 { failed }（遮罩後的成員識別清單）。
// 已寫入的人數逐筆累加到呼叫端傳入的 progress.cleanedMembers（每次 commit／update 成功就加），所以中途拋出非衝突錯誤時，
// 呼叫端的失敗 log 看到的是「已成功清掉的人數」而不是 0。
// 口徑：cleanedMembers 只計「本次呼叫實際寫入隊伍欄位」的人；重讀後發現已自行退出本隊或文件已不存在（gone）者
// 既不計入 cleanedMembers 也不計入 failed（他們不需要、也沒有被我們寫）。
async function cleanMemberships({ db, FieldValue, memberDocs, teamDocId, logger, ctx, progress }) {
  const nameCache = new Map();
  const namesFor = async (docs) => {
    const missing = new Set();
    docs.forEach((doc) => getUserTeamIds(doc.data() || {}).forEach((id) => {
      if (id !== teamDocId && !nameCache.has(id)) missing.add(id);
    }));
    if (missing.size > 0) {
      (await readTeamNames([...missing], (id) => db.collection("teams").doc(id).get()))
        .forEach((name, id) => nameCache.set(id, name));
    }
    return nameCache;
  };
  const updatesFor = (doc, names) => ({
    ...buildNextMembership(doc.data() || {}, teamDocId, names),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const precondition = (doc) => ({ lastUpdateTime: doc.updateTime });

  // 逐位處理：回傳 "cleaned"｜"gone"（已不在本隊，不必寫）｜"failed"
  const cleanOne = async (first) => {
    let current = first;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const names = await namesFor([current]);
      try {
        await current.ref.update(updatesFor(current, names), precondition(current));
        return "cleaned";
      } catch (error) {
        if (!isConflict(error)) throw error;
        [current] = await rereadStillInTeam([current], teamDocId);
        if (!current) return "gone";
      }
    }
    logger.error?.("[deleteTeam] member cleanup exhausted retries", {
      ...ctx,
      memberId: maskId(first.data()?.uid || first.id),
      attempts: MAX_ATTEMPTS,
    });
    return "failed";
  };

  const failed = [];
  for (let i = 0; i < memberDocs.length; i += BATCH_LIMIT) {
    let pending = memberDocs.slice(i, i + BATCH_LIMIT);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && pending.length > 0; attempt += 1) {
      const names = await namesFor(pending);
      const batch = db.batch();
      pending.forEach((doc) => batch.update(doc.ref, updatesFor(doc, names), precondition(doc)));
      try {
        await batch.commit();
        progress.cleanedMembers += pending.length;
        pending = [];
      } catch (error) {
        if (!isConflict(error)) throw error;
        logger.warn?.("[deleteTeam] member batch conflicted with a concurrent write, re-reading", {
          ...ctx,
          attempt,
          code: String(error?.code || "unknown"),
        });
        pending = await rereadStillInTeam(pending, teamDocId);
      }
    }
    for (const doc of pending) {
      const outcome = await cleanOne(doc);
      if (outcome === "cleaned") progress.cleanedMembers += 1;
      else if (outcome === "failed") failed.push(maskId(doc.data()?.uid || doc.id));
    }
  }
  return { failed };
}

// Phase 1＋「最後一批前再查人」的收斂迴圈（審查 F-6，FC 顧問裁示 (b)）：
// 清完一輪後以同一組查詢（兩組查詢＋幹部補齊、以文件 id 為準）再查一次「仍含本隊」的人（recheck）；
// 有人（Phase 1 之後才加入本隊的成員）就再清一輪，最多共 3 次 recheck（Phase 1 一輪＋最多 2 輪補清）；
// 某次 recheck＝0 才算收斂。3 次 recheck 仍 >0（有人持續加入）→ 記 log（帶 remaining）並拋 TEAM_MEMBERS_CHURNING，
// 此時 team 與所有角色都還沒動，呼叫者可重試。任何一輪清理有成員衝突耗盡 → 回傳 { failed }（呼叫端回 partial）。
// 註：Callable 無狀態，「連續 3 次」以同一次呼叫內的輪數計，不跨呼叫計數（見報告 §12）。
async function settleTeamMembers({ db, FieldValue, FieldPath, HttpsError, teamDocId, teamData, logger, ctx, progress }) {
  let memberDocs = await listTeamMemberDocs({ db, FieldPath, teamDocId, teamData });
  for (let round = 1; ; round += 1) {
    const { failed } = await cleanMemberships({ db, FieldValue, memberDocs, teamDocId, logger, ctx, progress });
    if (failed.length > 0) return { failed };
    memberDocs = await listTeamMemberDocs({ db, FieldPath, teamDocId, teamData }); // recheck
    if (memberDocs.length === 0) return { failed: [] };
    if (round >= MAX_RECHECKS) {
      logger.error?.("[deleteTeam] members keep joining, giving up after rechecks", {
        ...ctx,
        ...progress,
        rechecks: round,
        remaining: memberDocs.length,
      });
      throw new HttpsError("failed-precondition", "TEAM_MEMBERS_CHURNING");
    }
    logger.warn?.("[deleteTeam] members joined during deletion, cleaning again", {
      ...ctx,
      round,
      remaining: memberDocs.length,
    });
  }
}

module.exports = { cleanMemberships, listTeamMemberDocs, settleTeamMembers };
