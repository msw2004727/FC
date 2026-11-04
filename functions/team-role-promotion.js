"use strict";

const { isUserCreatedTeam } = require("./team-membership-core");

const MAX_UID_LENGTH = 128;
const MAX_IDENTITY_MATCHES = 5;
const IDENTITY_QUERY_LIMIT = MAX_IDENTITY_MATCHES + 1;
const AUTO_TEAM_ROLES = new Set(["user", "coach", "captain"]);

function normalizeUid(value) {
  if (typeof value !== "string") return "";
  const uid = value.trim();
  return uid && uid.length <= MAX_UID_LENGTH && !uid.includes("/") ? uid : "";
}

function inspectIdentityDocument(doc, expectedUid) {
  const data = doc?.data?.();
  const documentId = normalizeUid(doc?.id);
  if (!data || typeof data !== "object" || !documentId) {
    return { invalid: true, restricted: false, logicalUid: "", canonical: false };
  }
  const fields = ["uid", "lineUserId"].map((field) => {
    const raw = data[field];
    const present = raw !== undefined && raw !== null
      && !(typeof raw === "string" && raw.trim() === "");
    return { present, value: present ? normalizeUid(raw) : "" };
  });
  const claimedUids = [...new Set(fields.map(field => field.value).filter(Boolean))];
  const invalid = fields.some(field => field.present && !field.value)
    || claimedUids.length > 1;
  const logicalUid = invalid ? "" : (claimedUids[0] || documentId);
  return {
    doc,
    data,
    invalid,
    restricted: data.isRestricted === true || data.restricted === true,
    logicalUid,
    canonical: documentId === expectedUid && logicalUid === expectedUid,
  };
}

async function queryIdentityMatches(userCollection, field, uid) {
  const snapshot = await userCollection
    .where(field, "==", uid)
    .limit(IDENTITY_QUERY_LIMIT)
    .get();
  return snapshot.docs.length >= IDENTITY_QUERY_LIMIT
    ? { overflow: true, docs: [] }
    : { overflow: false, docs: snapshot.docs };
}

async function resolveStrictUserIdentity({ db, targetUid, HttpsError }) {
  const uid = normalizeUid(targetUid);
  if (!uid) throw new HttpsError("invalid-argument", "targetUid is required");

  const userCollection = db.collection("users");
  const [canonical, uidMatches, lineMatches] = await Promise.all([
    userCollection.doc(uid).get(),
    queryIdentityMatches(userCollection, "uid", uid),
    queryIdentityMatches(userCollection, "lineUserId", uid),
  ]);
  if (uidMatches.overflow || lineMatches.overflow) {
    throw new HttpsError("failed-precondition", "Target user identity is ambiguous or unavailable");
  }

  const uniqueDocs = new Map();
  if (canonical?.exists) uniqueDocs.set(canonical.id, canonical);
  uidMatches.docs.forEach(doc => uniqueDocs.set(doc.id, doc));
  lineMatches.docs.forEach(doc => uniqueDocs.set(doc.id, doc));
  if (uniqueDocs.size === 0) throw new HttpsError("not-found", "Target user not found");

  const records = [...uniqueDocs.values()].map(doc => inspectIdentityDocument(doc, uid));
  if (records.some(record => (
    record.invalid || record.restricted || record.logicalUid !== uid
  ))) {
    throw new HttpsError("failed-precondition", "Target user identity is ambiguous or unavailable");
  }

  const canonicalRecord = records.find(record => record.canonical);
  if (!canonicalRecord && records.length !== 1) {
    throw new HttpsError("failed-precondition", "Target user identity is ambiguous or unavailable");
  }
  const selected = canonicalRecord || records[0];
  return { uid, docId: selected.doc.id, data: selected.data };
}

// T-090i：自建俱樂部（createdVia=='user_capability'）的職員欄位由擁有者自填，不算已存職位（取代原本 limit(1)／limit(2) 只看有無一隊）。
// Firestore 無法用 != 篩選（legacy 無 createdVia 會一起被濾掉），改分頁讀回後在記憶體排除；
// 分頁到底是為了不讓大量自建隊的掛名把同一人的 legacy 隊擠出結果而誤降級。
const TEAM_ASSIGNMENT_PAGE_SIZE = 10;

async function hasManagedTeamAssignment(teamCollection, field, operator, uid, excludeTeamDocId = "") {
  let query = teamCollection.where(field, operator, uid).limit(TEAM_ASSIGNMENT_PAGE_SIZE);
  for (;;) {
    const snapshot = await query.get();
    const docs = snapshot.docs || [];
    if (docs.some(doc => doc.id !== excludeTeamDocId && !isUserCreatedTeam(doc.data()))) return true;
    if (docs.length < TEAM_ASSIGNMENT_PAGE_SIZE) return false;
    query = teamCollection.where(field, operator, uid)
      .startAfter(docs[docs.length - 1])
      .limit(TEAM_ASSIGNMENT_PAGE_SIZE);
  }
}

async function getSavedTeamRole({ db, uid }) {
  const teams = db.collection("teams");
  const [isCaptain, isCoach, isLegacyLeader, isLeader] = await Promise.all([
    hasManagedTeamAssignment(teams, "captainUid", "==", uid),
    hasManagedTeamAssignment(teams, "coachUids", "array-contains", uid),
    hasManagedTeamAssignment(teams, "leaderUid", "==", uid),
    hasManagedTeamAssignment(teams, "leaderUids", "array-contains", uid),
  ]);
  if (isCaptain) return "captain";
  if (isCoach || isLegacyLeader || isLeader) return "coach";
  return "user";
}

// T-027 7b(A) deleteTeam 專用：與 getSavedTeamRole 相同的四個查詢，但不把即將被刪的那個 team 算進去。
// T-090i：同樣排除自建俱樂部（hasManagedTeamAssignment）。
async function getSavedTeamRoleExcludingTeam({ db, uid, excludeTeamDocId }) {
  const teams = db.collection("teams");
  const [isCaptain, isCoach, isLegacyLeader, isLeader] = await Promise.all([
    hasManagedTeamAssignment(teams, "captainUid", "==", uid, excludeTeamDocId),
    hasManagedTeamAssignment(teams, "coachUids", "array-contains", uid, excludeTeamDocId),
    hasManagedTeamAssignment(teams, "leaderUid", "==", uid, excludeTeamDocId),
    hasManagedTeamAssignment(teams, "leaderUids", "array-contains", uid, excludeTeamDocId),
  ]);
  if (isCaptain) return "captain";
  if (isCoach || isLegacyLeader || isLeader) return "coach";
  return "user";
}

function getTeamIdsFromUser(data = {}) {
  const ids = [];
  if (Array.isArray(data.teamIds)) ids.push(...data.teamIds);
  if (data.teamId) ids.push(data.teamId);
  return new Set(ids.map(normalizeUid).filter(Boolean));
}

function teamSupportsTargetRole(teamData, targetUid, role) {
  if (!teamData || !targetUid) return false;
  if (role === "captain") return normalizeUid(teamData.captainUid) === targetUid;
  if (role !== "coach") return false;
  const coachUids = Array.isArray(teamData.coachUids) ? teamData.coachUids : [];
  const leaderUids = Array.isArray(teamData.leaderUids) ? teamData.leaderUids : [];
  return normalizeUid(teamData.leaderUid) === targetUid
    || coachUids.map(normalizeUid).includes(targetUid)
    || leaderUids.map(normalizeUid).includes(targetUid);
}

function canManageTeamRoles(access) {
  return access.isSuperAdmin
    || access.hasPermission("team.manage_all")
    || access.hasPermission("team.create");
}

function canCallerRecalculateRole({
  access, callerUser, targetUser, decision, roleLevels, teamId, teamData,
}) {
  const currentLevel = roleLevels[decision.currentRole];
  const newLevel = roleLevels[decision.newRole];
  if (newLevel > currentLevel
    && !teamSupportsTargetRole(teamData, targetUser.uid, decision.newRole)) return false;
  if (canManageTeamRoles(access)) return true;
  if (callerUser.uid === targetUser.uid && newLevel < currentLevel) return true;
  if (!teamId || !teamData || roleLevels[access.role] < roleLevels.captain) return false;
  const isKnownMember = getTeamIdsFromUser(callerUser.data).has(teamId);
  const isSavedCaptain = normalizeUid(teamData.captainUid) === callerUser.uid;
  if (!isKnownMember && !isSavedCaptain) return false;
  if (newLevel <= currentLevel) return true;

  // Q7：只看已讀取的建立來源標記；自降與管理權限路徑維持原判斷。
  return !isUserCreatedTeam(teamData);
}

function getRoleDecision({ targetData, savedTeamRole, roleLevels, normalizeRole }) {
  const currentRole = normalizeRole(targetData?.role);
  const currentLevel = roleLevels[currentRole];
  if (!Number.isFinite(currentLevel)) {
    return { skipped: true, reason: "unmanaged_current_role", currentRole };
  }
  if (currentLevel >= roleLevels.venue_owner) {
    return { skipped: true, reason: "role_too_high", currentRole };
  }

  const hasManualRole = typeof targetData?.manualRole === "string"
    && targetData.manualRole.trim() !== "";
  const manualRole = hasManualRole ? normalizeRole(targetData.manualRole) : "user";
  const manualLevel = roleLevels[manualRole];
  if (!Number.isFinite(manualLevel) || manualLevel >= roleLevels.venue_owner) {
    return { skipped: true, reason: "manual_role_protected", currentRole };
  }

  const teamRole = AUTO_TEAM_ROLES.has(savedTeamRole) ? savedTeamRole : "user";
  const newRole = manualLevel > roleLevels[teamRole] ? manualRole : teamRole;
  if (currentRole === newRole) {
    return { skipped: true, reason: "no_change", currentRole };
  }
  return { skipped: false, currentRole, newRole };
}

function createAutoPromoteTeamRoleHandler({
  db,
  HttpsError,
  FieldValue,
  roleLevels,
  normalizeRole,
  getCallerAccessContext,
  ensureAuthUser,
  setRoleClaimMerged,
  logger = console,
}) {
  return async function autoPromoteTeamRoleHandler(request) {
    let callerRole = "user";
    let targetUid = "";
    try {
      if (!request?.auth?.uid) {
        throw new HttpsError("unauthenticated", "Authentication required");
      }
      const access = await getCallerAccessContext(request);
      callerRole = access.role;
      if ((roleLevels[callerRole] ?? 0) < roleLevels.coach) {
        throw new HttpsError("permission-denied", "Coach or above required");
      }

      targetUid = request?.data?.targetUid;
      const targetUser = await resolveStrictUserIdentity({ db, targetUid, HttpsError });
      const callerUser = targetUser.uid === request.auth.uid
        ? targetUser
        : await resolveStrictUserIdentity({ db, targetUid: request.auth.uid, HttpsError });
      const teamId = normalizeUid(request?.data?.teamId);
      const teamSnapshot = teamId ? await db.collection("teams").doc(teamId).get() : null;
      const teamData = teamSnapshot?.exists ? (teamSnapshot.data() || {}) : null;
      const savedTeamRole = await getSavedTeamRole({ db, uid: targetUser.uid });
      let decision = getRoleDecision({ targetData: targetUser.data, savedTeamRole, roleLevels, normalizeRole });
      if (!decision.skipped
        && roleLevels[decision.newRole] > roleLevels[decision.currentRole]) {
        const contextRole = teamData && normalizeUid(teamData.captainUid) === targetUser.uid
          ? "captain"
          : (teamSupportsTargetRole(teamData, targetUser.uid, "coach") ? "coach" : "user");
        decision = getRoleDecision({
          targetData: targetUser.data,
          savedTeamRole: contextRole,
          roleLevels,
          normalizeRole,
        });
        // 只阻擋 contextRole 的實際升級；不把職位強制降成 user，也不攔既有自降／no_change。
        if (!decision.skipped
          && roleLevels[decision.newRole] > roleLevels[decision.currentRole]
          && isUserCreatedTeam(teamData) && !canManageTeamRoles(access)) {
          throw new HttpsError("permission-denied", "Not allowed to recalculate this team role");
        }
      }
      if (decision.skipped) {
        if (decision.reason === "no_change") {
          await ensureAuthUser(targetUser.uid);
          await setRoleClaimMerged(targetUser.uid, decision.currentRole);
          return { success: true, skipped: true, claimReconciled: true, ...decision };
        }
        return { success: true, skipped: true, ...decision };
      }

      const authorized = canCallerRecalculateRole({
        access,
        callerUser,
        targetUser,
        decision,
        roleLevels,
        teamId,
        teamData,
      });
      if (!authorized) {
        throw new HttpsError("permission-denied", "Not allowed to recalculate this team role");
      }

      await db.collection("users").doc(targetUser.docId).update({
        role: decision.newRole,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await ensureAuthUser(targetUser.uid);
      await setRoleClaimMerged(targetUser.uid, decision.newRole);
      logger.info?.("[autoPromoteTeamRole] role recalculated", {
        callerUid: request.auth.uid,
        callerRole,
        targetUid: targetUser.uid,
        targetDocId: targetUser.docId,
        oldRole: decision.currentRole,
        newRole: decision.newRole,
      });
      return {
        success: true,
        targetUid: targetUser.uid,
        targetDocId: targetUser.docId,
        oldRole: decision.currentRole,
        newRole: decision.newRole,
      };
    } catch (error) {
      logger.error?.("[autoPromoteTeamRole] failed", {
        callerUid: request?.auth?.uid || "",
        callerRole,
        targetUid: normalizeUid(targetUid),
        code: error?.code || "internal",
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Unable to recalculate team role");
    }
  };
}

function createAutoPromoteTeamRoleCallable({ onCall, ...dependencies }) {
  return onCall(
    { region: "asia-east1", timeoutSeconds: 15 },
    createAutoPromoteTeamRoleHandler(dependencies),
  );
}

module.exports = {
  createAutoPromoteTeamRoleCallable,
  createAutoPromoteTeamRoleHandler,
  getRoleDecision,
  getSavedTeamRoleExcludingTeam,
  resolveStrictUserIdentity,
};
