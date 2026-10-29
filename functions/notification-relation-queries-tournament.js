"use strict";

/**
 * 通知發送授權強化（第 2 批）：R8 賽事關係查詢。
 * 賽事先 tournaments/{id} 直取，沒有再 where("id","==").limit(1)（同 getDeliverInboxTournament）。
 * 每個函式 async (ctx) => boolean；讀取失敗直接丟出，由決策層轉 deny。
 */

const { normalizeId } = require("./team-membership-core");
const {
  str,
  memoByCtx,
  recipientIdentities,
  readTeamByDocId,
  userDataInTeam,
} = require("./notification-relation-queries-shared");

// 申請人送出申請：呼叫者必須是 applications/ta_{teamId}.requestedByUid；收件者是主辦人與委託人。
const APPLICANT_SOURCES = new Set([
  "tournament_register_request",
  "template:tournament_friendly_team_apply_host",
]);
// 主辦方審核後通知申請人：收件者是 requestedByUid。
const TO_APPLICANT_SOURCES = new Set([
  "tournament_review:approve",
  "tournament_review:reject",
  "template:tournament_friendly_team_approved_applicant",
  "template:tournament_friendly_team_rejected_applicant",
]);
const REVIEW_BROADCAST_RE = /^tournament_review:broadcast:(approve|reject)$/;
const HOST_OPENED_SOURCE = "template:tournament_friendly_host_opened";
const APPROVED_BROADCAST_SOURCE = "template:tournament_friendly_team_approved_broadcast";

function trimmedList(value) {
  return Array.isArray(value) ? value.map(str).filter(Boolean) : [];
}

// 主辦人 + 委託人（delegateUids 與 delegates[].uid 聯集，同 getTournamentDelegateUidSet）。
function managerUidSet(tournament) {
  const delegates = Array.isArray(tournament?.delegates) ? tournament.delegates.map((item) => str(item?.uid)) : [];
  return new Set([str(tournament?.creatorUid), ...trimmedList(tournament?.delegateUids), ...delegates].filter(Boolean));
}

function createTournamentQueries({ db, helpers }) {
  const loadTournament = memoByCtx(async (ctx) => {
    const tournamentId = str(ctx?.keys?.tournamentId);
    if (!tournamentId) return null;
    const directId = normalizeId(tournamentId);
    if (directId) {
      const direct = await db.collection("tournaments").doc(directId).get();
      if (direct && direct.exists) return { docId: direct.id || directId, data: direct.data() || {} };
    }
    const found = await db.collection("tournaments").where("id", "==", tournamentId).limit(1).get();
    const doc = Array.isArray(found?.docs) ? found.docs[0] : null;
    return doc ? { docId: doc.id, data: doc.data() || {} } : null;
  });

  async function readApplication(ctx, tournament) {
    const teamId = normalizeId(ctx?.keys?.teamId);
    if (!teamId) return null;
    const snap = await db.collection("tournaments").doc(tournament.docId)
      .collection("applications").doc(`ta_${teamId}`).get();
    return snap && snap.exists ? (snap.data() || {}) : null;
  }

  // 沿用 canManageTournamentDataInTransaction 的事實：admin 以上、建立者、委託人、主辦隊 officer。
  async function callerCanManage(ctx, tournament) {
    const caller = str(ctx?.callerUid);
    const role = str(ctx?.callerRole);
    if (!caller) return false;
    if (role === "admin" || role === "super_admin") return true;
    if (managerUidSet(tournament.data).has(caller)) return true;
    const hostTeamId = str(tournament.data.hostTeamId);
    if (!hostTeamId) return false;
    const hostTeam = await readTeamByDocId(db, hostTeamId);
    return !!hostTeam && helpers.isTournamentTeamOfficerForData(hostTeam.data, caller) === true;
  }

  // 收件者是該隊成員：users.teamId == 隊文件 id，或 users.teamIds 含它。
  // 直接檢查收件者的 user 文件（LINE 用已取得的 found.data），避免廣播時每位收件者都掃全隊。
  async function recipientInTeam(ctx, teamDocId) {
    const found = ctx?.recipientFound;
    if (found && typeof found === "object") return userDataInTeam(found.data, teamDocId);
    const uid = normalizeId(ctx?.recipientUid);
    if (!uid) return false;
    const snap = await db.collection("users").doc(uid).get();
    return !!snap && !!snap.exists && userDataInTeam(snap.data(), teamDocId);
  }

  return {
    async callerMatchesTournamentSource(ctx) {
      const caller = str(ctx?.callerUid);
      if (!caller) return false;
      const tournament = await loadTournament(ctx);
      if (!tournament) return false;
      const source = ctx?.source;
      if (APPLICANT_SOURCES.has(source)) {
        const application = await readApplication(ctx, tournament);
        return !!application && str(application.requestedByUid) === caller;
      }
      if (source === HOST_OPENED_SOURCE) return str(tournament.data.creatorUid) === caller;
      return callerCanManage(ctx, tournament);
    },

    async recipientInTournamentAudience(ctx) {
      const identities = recipientIdentities(ctx);
      if (identities.length === 0) return false;
      const tournament = await loadTournament(ctx);
      if (!tournament) return false;
      const source = ctx?.source;
      const managers = managerUidSet(tournament.data);
      if (APPLICANT_SOURCES.has(source)) return identities.some((uid) => managers.has(uid));
      if (typeof source === "string" && REVIEW_BROADCAST_RE.test(source)) {
        const caller = str(ctx?.callerUid);
        if (!caller || identities.includes(caller)) return false;
        return identities.some((uid) => managers.has(uid));
      }
      if (TO_APPLICANT_SOURCES.has(source)) {
        // 有 teamId：讀 ta_{teamId} 的 requestedByUid；沒有：該賽事任一申請的 requestedByUid 等於收件者。
        if (normalizeId(ctx?.keys?.teamId)) {
          const application = await readApplication(ctx, tournament);
          return !!application && identities.includes(str(application.requestedByUid));
        }
        const applications = db.collection("tournaments").doc(tournament.docId).collection("applications");
        for (const uid of identities) {
          const snap = await applications.where("requestedByUid", "==", uid).limit(1).get();
          if (Array.isArray(snap?.docs) && snap.docs.length > 0) return true;
        }
        return false;
      }
      if (source === APPROVED_BROADCAST_SOURCE) {
        const team = await readTeamByDocId(db, ctx?.keys?.teamId);
        return !!team && recipientInTeam(ctx, team.docId);
      }
      if (source === HOST_OPENED_SOURCE) {
        const hostTeam = await readTeamByDocId(db, tournament.data.hostTeamId);
        return !!hostTeam && recipientInTeam(ctx, hostTeam.docId);
      }
      return false;
    },
  };
}

module.exports = { createTournamentQueries };
