"use strict";

/**
 * recountTeamMembers — 俱樂部成員人數重算（伺服器端移植自 team-list-stats.js#_calcTeamMemberCountByTeam 與 team-list-helpers.js）
 *
 * 【刻意偏離舊站 A 的項目（R-ID-002 / R-STAT-003）】
 * 1) 舊站 A 的 `_getUserIdentityKey` 在使用者無 `uid` 與 `_docId` 時會退回 `_toNameIdentityKey(user.name || user.displayName)`；
 *    `_buildTeamStaffIdentity` 亦有 `addByName` 分支。伺服器版 **只保留 UID / docId 類型的 identity key**，不以名稱作為去重鍵或反查使用者。
 * 2) 舊站 A 的 `_getTeamStudentIdentityKey` 在學員無 `selfUid`/`uid` 且無 `id`/`_docId`/`studentId` 時會退回 `student-name:${name}`。
 *    伺服器版 **只保留 `uid:${uid}` 與 `student:${studentId}`**，不含名稱無 ID 的學員會被略過，並在回傳的 `notes` 陣列中記錄偏離原因與筆數。
 *
 * 【權限設計取捨說明】
 * 支援俱樂部幹部（captainUid、leaderUids 優先否則 leaderUid、coachUids）、具 `team.manage_all` 權限者，
 * 以及「剛退出俱樂部的本人」。由於成員退出後呼叫此 Callable 時，其 `users/{uid}.teamIds` 已不含該隊，
 * 且本函式所有計算皆由伺服器讀取 Firestore 真相來源決定、完全不受呼叫者傳入參數影響（僅傳入 `teamId`），
 * 因此允許任何已登入使用者觸發重算以涵蓋「剛退隊本人觸發重算」的情境。
 */

const UNCOUNTABLE_STUDENT_STATUSES = new Set([
  "inactive",
  "removed",
  "cancelled",
  "canceled",
  "rejected",
  "pending",
  "review",
  "reviewing",
  "waiting",
  "wait",
  "unapproved",
  "submitted",
  "applied",
  "\u5f85\u5be9\u6838", // 待審核
  "\u5be9\u6838\u4e2d", // 審核中
  "\u5f85\u78ba\u8a8d", // 待確認
]);

function normalizeIdentityValue(val) {
  return String(val || "").trim();
}

function getUserTeamIds(user) {
  if (!user || typeof user !== "object") return [];
  const ids = [];
  const seen = new Set();
  const pushId = (id) => {
    const v = String(id || "").trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    ids.push(v);
  };
  if (Array.isArray(user.teamIds)) user.teamIds.forEach(pushId);
  pushId(user.teamId);
  return ids;
}

function isUserInTeam(user, teamId) {
  if (!user || !teamId) return false;
  return getUserTeamIds(user).includes(String(teamId));
}

/**
 * 取得使用者的唯一識別鍵（刻意排除名稱 fallback：R-ID-002）
 */
function getUserIdentityKey(user) {
  if (!user || typeof user !== "object") return null;
  const uid = normalizeIdentityValue(user.uid || user.lineUserId);
  if (uid) return `uid:${uid}`;
  const docId = normalizeIdentityValue(user._docId || user.id);
  if (docId) return `doc:${docId}`;
  return null;
}

function buildTeamStaffIdentity(team, users = []) {
  const keys = new Set();
  if (!team || typeof team !== "object") return { keys };

  const userList = Array.isArray(users) ? users : [];
  const addByUidLike = (uidLike) => {
    const raw = normalizeIdentityValue(uidLike);
    if (!raw) return;
    const found = userList.find(
      (u) =>
        u && (
          normalizeIdentityValue(u.uid) === raw
          || normalizeIdentityValue(u.lineUserId) === raw
          || normalizeIdentityValue(u._docId) === raw
          || normalizeIdentityValue(u.id) === raw
        )
    );
    const key = found ? getUserIdentityKey(found) : `uid:${raw}`;
    if (key) keys.add(key);
  };

  addByUidLike(team.captainUid);

  const leaderUids = Array.isArray(team.leaderUids)
    ? team.leaderUids
    : (team.leaderUid ? [team.leaderUid] : []);
  leaderUids.forEach(addByUidLike);

  const coachUids = Array.isArray(team.coachUids) ? team.coachUids : [];
  coachUids.forEach(addByUidLike);

  return { keys };
}

function isCountableTeamStudent(student) {
  if (!student || typeof student !== "object") return false;
  const status = String(
    student.enrollStatus || student.status || student.approvalStatus || ""
  )
    .trim()
    .toLowerCase();
  return !UNCOUNTABLE_STUDENT_STATUSES.has(status);
}

/**
 * 取得學員的唯一識別鍵（刻意排除 `student-name:` fallback：R-ID-002）
 */
function getTeamStudentIdentityKey(student) {
  if (!student || typeof student !== "object") return null;
  const uid = normalizeIdentityValue(student.selfUid || student.uid);
  if (uid) return `uid:${uid}`;
  const studentId = normalizeIdentityValue(student.id || student._docId || student.studentId);
  if (studentId) return `student:${studentId}`;
  return null;
}

function collectTeamStaffUids(team = {}) {
  const uids = new Set();
  const push = (v) => {
    const s = normalizeIdentityValue(v);
    if (s) uids.add(s);
  };
  push(team?.captainUid);
  const leaderUids = Array.isArray(team?.leaderUids)
    ? team.leaderUids
    : (team?.leaderUid ? [team.leaderUid] : []);
  leaderUids.forEach(push);
  if (Array.isArray(team?.coachUids)) {
    team.coachUids.forEach(push);
  }
  return Array.from(uids);
}

function isCallerTeamStaff(team, callerUid) {
  const safeUid = normalizeIdentityValue(callerUid);
  if (!safeUid || !team) return false;
  return collectTeamStaffUids(team).includes(safeUid);
}

/**
 * 純函式：計算俱樂部去重成員數
 * @param {{ team: Object, users?: Array, students?: Array }} params
 * @returns {{ members: number, keys: Array<string>, notes: Array<string> }}
 */
function countTeamMembers({ team, users = [], students = [] } = {}) {
  const notes = [];
  if (!team || !team.id) {
    return { members: 0, keys: [], notes };
  }

  const userList = Array.isArray(users) ? users : [];
  const uniqueIdentities = new Set();

  // 1. 幹部 keys
  const staffIdentity = buildTeamStaffIdentity(team, userList);
  staffIdentity.keys.forEach((key) => uniqueIdentities.add(key));

  // 2. users 中屬於該隊者
  let skippedNameOnlyUsers = 0;
  userList.forEach((user) => {
    if (!isUserInTeam(user, team.id)) return;
    const key = getUserIdentityKey(user);
    if (key) {
      uniqueIdentities.add(key);
    } else if (user && (user.name || user.displayName)) {
      skippedNameOnlyUsers += 1;
    }
  });
  if (skippedNameOnlyUsers > 0) {
    notes.push(
      `R-ID-002: skipped ${skippedNameOnlyUsers} user(s) without uid/_docId (name-only identity fallback omitted)`
    );
  }

  // 3. 可計入的課程學員（合併 team 內嵌與傳入的 students 子集合清單）
  const studentSources = [
    team.students,
    team.eduStudents,
    team.educationStudents,
    team.studentList,
    team.eduSettings?.students,
    students,
  ];
  let skippedNameOnlyStudents = 0;
  studentSources.forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((student) => {
      if (!isCountableTeamStudent(student)) return;
      const key = getTeamStudentIdentityKey(student);
      if (key) {
        uniqueIdentities.add(key);
      } else if (student && (student.name || student.studentName || student.displayName)) {
        skippedNameOnlyStudents += 1;
      }
    });
  });
  if (skippedNameOnlyStudents > 0) {
    notes.push(
      `R-ID-002: skipped ${skippedNameOnlyStudents} student(s) without uid/studentId (student-name fallback omitted)`
    );
  }

  return {
    members: uniqueIdentities.size,
    keys: Array.from(uniqueIdentities),
    notes,
  };
}

async function resolveTeamDoc(db, teamId) {
  const directRef = db.collection("teams").doc(teamId);
  const directSnap = await directRef.get();
  if (directSnap && directSnap.exists) {
    return directSnap;
  }
  // ASSUMPTION: 若 docId 與邏輯 team.id 不同，fallback 以 where('id','==',teamId) 查找
  const qSnap = await db.collection("teams").where("id", "==", teamId).limit(1).get();
  if (qSnap && Array.isArray(qSnap.docs) && qSnap.docs.length > 0) {
    return qSnap.docs[0];
  }
  return null;
}

function createRecountTeamMembersHandler({
  HttpsError,
  db,
  FieldValue,
  getCallerAccessContext,
  logger = console,
}) {
  if (typeof HttpsError !== "function") {
    throw new TypeError("HttpsError is required");
  }
  if (!db || typeof db.collection !== "function") {
    throw new TypeError("db is required");
  }

  return async (request) => {
    if (!request?.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const callerUid = request.auth.uid;
    const { teamId } = request.data || {};

    if (typeof teamId !== "string" || !teamId.trim()) {
      throw new HttpsError("invalid-argument", "teamId is required");
    }
    const safeTeamId = teamId.trim();

    try {
      const teamDoc = await resolveTeamDoc(db, safeTeamId);
      if (!teamDoc || (typeof teamDoc.exists === "boolean" && !teamDoc.exists)) {
        throw new HttpsError("not-found", "TEAM_NOT_FOUND");
      }

      const teamData = { ...(teamDoc.data() || {}), id: teamDoc.data()?.id || safeTeamId };

      // 權限檢查：幹部、具 team.manage_all、或任何已登入者（涵蓋剛退隊本人觸發重算；計算完全由伺服器資料決定）
      let callerAuthorized = isCallerTeamStaff(teamData, callerUid);
      if (!callerAuthorized && typeof getCallerAccessContext === "function") {
        const access = await getCallerAccessContext(request);
        if (access && (access.isSuperAdmin || access.hasPermission?.("team.manage_all"))) {
          callerAuthorized = true;
        }
      }
      // 允許剛退出的本人（無法從當前 teamIds 驗證時，允許已登入者觸發伺服器權威重算）
      if (!callerAuthorized && Boolean(callerUid)) {
        callerAuthorized = true;
      }

      const logicalTeamId = String(teamData.id || safeTeamId);

      // 讀取 1: users where teamIds array-contains logicalTeamId
      // 讀取 2: legacy users where teamId == logicalTeamId
      // 讀取 3: teams/{teamDocId}/students
      const [teamIdsSnap, legacyTeamIdSnap, studentsSnap] = await Promise.all([
        db.collection("users").where("teamIds", "array-contains", logicalTeamId).get(),
        db.collection("users").where("teamId", "==", logicalTeamId).get(),
        teamDoc.ref.collection("students").get(),
      ]);

      const userByDocId = new Map();
      const collectUserDoc = (d) => {
        if (!d || (typeof d.exists === "boolean" && !d.exists)) return;
        const data = d.data() || {};
        userByDocId.set(d.id, { ...data, _docId: d.id, uid: data.uid || d.id });
      };

      (teamIdsSnap?.docs || []).forEach(collectUserDoc);
      (legacyTeamIdSnap?.docs || []).forEach(collectUserDoc);

      // 讀取 4: 幹部 uid 的 users 文件（若尚未在成員查詢結果中）
      const staffUids = collectTeamStaffUids(teamData);
      const missingStaffUids = staffUids.filter((uid) => {
        if (userByDocId.has(uid)) return false;
        for (const u of userByDocId.values()) {
          if (u.uid === uid || u.lineUserId === uid) return false;
        }
        return true;
      });

      if (missingStaffUids.length > 0) {
        const staffDocs = await Promise.all(
          missingStaffUids.map((uid) => db.collection("users").doc(uid).get())
        );
        staffDocs.forEach(collectUserDoc);
      }

      const students = (studentsSnap?.docs || []).map((d) => ({
        ...(d.data() || {}),
        _docId: d.id,
        id: d.data()?.id || d.id,
      }));

      const calcResult = countTeamMembers({
        team: teamData,
        users: Array.from(userByDocId.values()),
        students,
      });

      // 只寫 teams/{teamId}.members 與 updatedAt
      const updatePayload = {
        members: calcResult.members,
      };
      if (FieldValue && typeof FieldValue.serverTimestamp === "function") {
        updatePayload.updatedAt = FieldValue.serverTimestamp();
      }
      await teamDoc.ref.update(updatePayload);

      const response = {
        success: true,
        members: calcResult.members,
      };
      if (calcResult.notes.length > 0) {
        response.notes = calcResult.notes;
      }
      return response;
    } catch (err) {
      if (err instanceof HttpsError) {
        throw err;
      }
      logger.error(JSON.stringify({
        fn: "recountTeamMembers",
        teamId: safeTeamId,
        errorCode: err?.code || "unknown",
        message: err?.message || "Recount failed",
      }));
      throw new HttpsError("internal", "TEAM_RECOUNT_FAILED");
    }
  };
}

function createRecountTeamMembersCallable({ onCall, ...dependencies }) {
  return onCall(
    { region: "asia-east1", timeoutSeconds: 30 },
    createRecountTeamMembersHandler(dependencies)
  );
}

module.exports = {
  getUserTeamIds,
  isUserInTeam,
  getUserIdentityKey,
  buildTeamStaffIdentity,
  isCountableTeamStudent,
  getTeamStudentIdentityKey,
  countTeamMembers,
  createRecountTeamMembersHandler,
  createRecountTeamMembersCallable,
};
