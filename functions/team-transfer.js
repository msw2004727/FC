"use strict";

/**
 * T-090h 自建俱樂部轉移經理 Callable（transferUserTeam）。
 * 顧問裁定（§6.3.16）：只限 createdVia==='user_capability'；呼叫者須為 OWNER_FIELDS 本人；
 * 新經理須為現有成員（users.teamIds 含該隊）且非本人；直接轉移、不需新經理同意；舊經理降為一般成員（保留會籍）。
 * 同一個 transaction（先讀後寫）：去重文件、俱樂部、兩位使用者都在交易內讀，並發轉移只會成功一次。
 * users 形狀比照 reviewTeamJoin：teamIds 不變，teamId／teamName 空才補；不觸發角色自動升級（B5）。
 * 站內信在交易提交後發出，失敗不回滾轉移（R-CF-003）。
 */

const { normalizeId, isUserCreatedTeam, isUserCreatedTeamOwner, ROLE_LABELS } = require("./team-membership-core");
const { buildInboxMessageDoc } = require("./inbox-message-doc");
const { formatTaipeiDateTime } = require("./notification-fields");

// 與 team-member-removal.js／deleteTeam 的 OWNER_FIELDS 相同；轉移後三欄都改為新經理，舊經理才真正失去擁有者身分。
const OWNER_FIELDS = Object.freeze(["captainUid", "creatorUid", "ownerUid"]);
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
// 沿用 _regDedupe（已有 expiresAt TTL）；文件 id 含 callerUid，不同使用者同一 requestId 互不影響。
const DEDUPE_COLLECTION = "_regDedupe";
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

const isPlainObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isBlank = value => value === undefined || value === null || (typeof value === "string" && !value.trim());

function buildDedupeId(callerUid, requestId) {
  return `team_transfer_${callerUid}_${requestId}`;
}

// 寫入 Firestore 前把 undefined 換成 null（Admin SDK 預設遇 undefined 會拋錯）；FieldValue 等物件原樣保留。
function nullifyUndefined(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = value === undefined ? null
      : Array.isArray(value) ? value.map(item => item === undefined ? null : item) : value;
  }
  return out;
}

function hasForeignIdentity(userData, uid) {
  return ["uid", "lineUserId"].some(field => {
    const value = userData[field];
    return value !== undefined && value !== null && value !== "" && value !== uid;
  });
}

function displayNameOf(userData) {
  return String(userData?.displayName || userData?.name || "").trim();
}

// 同 A team-detail.js#_buildTeamStaffRemovalUpdates：依 uid 移除，名字陣列依索引成對移除；只回有變動的欄位。
function buildStaffRemoval(team, uid) {
  const updates = {};
  const removeUid = list => (Array.isArray(list) ? list : []).filter(value => value !== uid);
  const removePaired = (names, uids) => (Array.isArray(names) ? names : [])
    .filter((_, index) => !(Array.isArray(uids) && uids[index] === uid));

  const leaderUids = Array.isArray(team.leaderUids) ? team.leaderUids : [];
  if (leaderUids.includes(uid) || team.leaderUid === uid) {
    const nextLeaderUids = removeUid(leaderUids);
    const leaderNames = Array.isArray(team.leaders) ? team.leaders : (team.leader ? [team.leader] : []);
    const nextLeaderNames = removePaired(leaderNames, leaderUids);
    updates.leaderUids = nextLeaderUids;
    updates.leaders = nextLeaderNames;
    updates.leaderNames = Array.isArray(team.leaderNames)
      ? removePaired(team.leaderNames, leaderUids) : nextLeaderNames;
    if (team.leaderUid === uid || !nextLeaderUids.includes(team.leaderUid)) updates.leaderUid = nextLeaderUids[0] || null;
    if (!team.leader || !nextLeaderNames.includes(team.leader)) updates.leader = nextLeaderNames[0] || "";
  }
  const coachUids = Array.isArray(team.coachUids) ? team.coachUids : [];
  if (coachUids.includes(uid)) {
    const nextCoachNames = removePaired(team.coaches, coachUids);
    updates.coachUids = removeUid(coachUids);
    updates.coaches = nextCoachNames;
    updates.coachNames = Array.isArray(team.coachNames) ? removePaired(team.coachNames, coachUids) : nextCoachNames;
  }
  return updates;
}

// teamIds 不變；teamId 空時補成本隊（主隊），teamId 已是本隊但 teamName 空時只補名字（同 reviewTeamJoin 主隊語意）。
function buildPrimaryTeamFill(userData, teamId, teamName) {
  if (isBlank(userData.teamId)) return { teamId, teamName };
  if (userData.teamId === teamId && isBlank(userData.teamName)) return { teamName };
  return null;
}

function buildTransferNotices({ teamName, oldName, newName }) {
  return {
    newOwner: {
      title: "俱樂部經理轉移",
      body: `「${oldName}」已將「${teamName}」俱樂部的經理轉移給您。`,
    },
    oldOwner: {
      title: "俱樂部經理轉移",
      body: `您已將「${teamName}」俱樂部的經理轉移給「${newName}」，您仍保留一般成員身分。`,
    },
  };
}

// 交易提交後執行；失敗只記錄並反映在回傳摘要（不含 UID），不拋出。
async function sendTransferNotices({ db, FieldValue, logger, now }, notices) {
  const outcomes = await Promise.allSettled(notices.map(async ({ recipientUid, title, body, fromUid }) => {
    const ref = db.collection("users").doc(recipientUid).collection("inbox").doc();
    const doc = buildInboxMessageDoc({
      id: ref.id,
      title,
      body,
      preview: body.length > 40 ? body.slice(0, 40) + "..." : body,
      type: "system",
      typeName: "系統",
      time: formatTaipeiDateTime(now()),
      senderName: "系統",
      fromUid,
    }, { createdAt: FieldValue.serverTimestamp() });
    await ref.create(doc);
    return "written";
  }));
  const summary = {};
  notices.forEach(({ kind }, index) => {
    const outcome = outcomes[index];
    summary[kind] = outcome.status === "fulfilled" ? outcome.value : "failed";
    if (outcome.status === "rejected") {
      const code = outcome.reason?.code;
      logger.error("[transferUserTeam] notification failed", {
        function: "transferUserTeam", stage: "notify", kind,
        code: typeof code === "string" || typeof code === "number" ? code : null,
      });
    }
  });
  return summary;
}

function createTransferUserTeamHandler({
  db, HttpsError, FieldValue, buildOperationLogPayload, logger = console, now = Date.now,
}) {
  return async function transferUserTeamHandler(request) {
    let stage = "input";
    let attempts = 0;
    let committed = null;
    // 只有本模組固定的原因碼可以回給前端；SDK／底層錯誤一律不外洩。
    const safeErrors = new Set();
    const fail = (code, reason) => {
      const error = new HttpsError(code, reason);
      safeErrors.add(error);
      throw error;
    };
    try {
      const callerUid = request?.auth?.uid;
      if (typeof callerUid !== "string" || !callerUid) fail("unauthenticated", "AUTH_REQUIRED");
      if (normalizeId(callerUid) !== callerUid) fail("invalid-argument", "INVALID_CALLER_UID");
      const input = request?.data;
      if (!isPlainObject(input)) fail("invalid-argument", "TRANSFER_USER_TEAM_INVALID_INPUT");
      if (!Object.keys(input).every(key => ["teamId", "newOwnerUid", "requestId"].includes(key))) {
        fail("invalid-argument", "TRANSFER_USER_TEAM_UNKNOWN_FIELD");
      }
      const teamId = normalizeId(input.teamId);
      const newOwnerUid = normalizeId(input.newOwnerUid);
      // 只收原樣通過 normalizeId 的單一路徑段（不 trim 成另一個 id）。
      if (!teamId || teamId !== input.teamId || !newOwnerUid || newOwnerUid !== input.newOwnerUid) {
        fail("invalid-argument", "TRANSFER_USER_TEAM_INVALID_INPUT");
      }
      if (typeof input.requestId !== "string" || !REQUEST_ID_RE.test(input.requestId)) {
        fail("invalid-argument", "TRANSFER_USER_TEAM_INVALID_REQUEST_ID");
      }
      const requestId = input.requestId;
      if (newOwnerUid === callerUid) fail("invalid-argument", "TRANSFER_TO_SELF");

      const dedupeRef = db.collection(DEDUPE_COLLECTION).doc(buildDedupeId(callerUid, requestId));
      const teamRef = db.collection("teams").doc(teamId);
      const callerRef = db.collection("users").doc(callerUid);
      const newOwnerRef = db.collection("users").doc(newOwnerUid);
      const issuedAt = new Date(now());
      const opRef = db.collection("operationLogs")
        .doc(`op_${issuedAt.getTime()}_${Math.random().toString(36).slice(2, 8)}`);

      // 保留 SDK retry：交易內不得把 ABORTED 轉成 HttpsError。
      committed = await db.runTransaction(async tx => {
        attempts += 1;
        // 先全部讀（固定 4 讀），再寫。
        stage = "dedupe";
        const dedupe = await tx.get(dedupeRef);
        // 冪等先於權限：已成功的請求重送時呼叫者已不是擁有者，仍回同一結果、不重寫、不重發通知。
        if (dedupe.exists) {
          const prior = dedupe.data() || {};
          if (prior.callerUid !== callerUid || prior.teamId !== teamId || prior.newOwnerUid !== newOwnerUid) {
            fail("failed-precondition", "TRANSFER_REQUEST_ID_CONFLICT");
          }
          return { response: { ok: true, teamId, newOwnerUid, deduplicated: true }, notices: null };
        }
        stage = "team";
        const teamSnap = await tx.get(teamRef);
        if (!teamSnap.exists) fail("not-found", "TEAM_NOT_FOUND");
        const team = teamSnap.data() || {};
        // legacy（無 createdVia）與管理端建立的俱樂部一律拒絕；createdVia 由 createUserTeam 寫入、Rules 不可改。
        if (!isUserCreatedTeam(team)) fail("failed-precondition", "TEAM_NOT_USER_CREATED");
        stage = "authorization";
        if (!isUserCreatedTeamOwner(team, callerUid)) fail("permission-denied", "TEAM_TRANSFER_DENIED");

        stage = "users";
        const callerSnap = await tx.get(callerRef);
        const newOwnerSnap = await tx.get(newOwnerRef);
        const callerData = callerSnap.exists ? callerSnap.data() || {} : {};
        if (hasForeignIdentity(callerData, callerUid)) fail("failed-precondition", "USER_IDENTITY_MISMATCH");
        if (!newOwnerSnap.exists) fail("not-found", "NEW_OWNER_NOT_FOUND");
        const newOwnerData = newOwnerSnap.data() || {};
        if (hasForeignIdentity(newOwnerData, newOwnerUid)) fail("failed-precondition", "NEW_OWNER_IDENTITY_MISMATCH");
        // 會籍只認 users.teamIds（自建俱樂部文件 id 即公開 id）。
        if (!Array.isArray(newOwnerData.teamIds) || !newOwnerData.teamIds.includes(teamSnap.id)) {
          fail("failed-precondition", "NEW_OWNER_NOT_MEMBER");
        }

        const teamName = typeof team.name === "string" && team.name.trim() ? team.name.trim() : teamSnap.id;
        const newName = displayNameOf(newOwnerData);
        const oldName = displayNameOf(callerData) || "經理";
        const role = typeof callerData.role === "string" ? callerData.role.trim() : "";
        const operator = String(callerData.displayName || "").trim() || ROLE_LABELS[role] || "系統";

        // 舊經理降為一般成員：三個擁有者欄位與經理名字改為新經理，舊經理若在領隊／教練名單一併移除。
        const teamUpdate = {
          ...buildStaffRemoval(team, callerUid),
          ...Object.fromEntries(OWNER_FIELDS.map(field => [field, newOwnerUid])),
          captain: newName,
          captainName: newName,
          updatedAt: FieldValue.serverTimestamp(),
        };

        stage = "commit";
        tx.update(teamRef, nullifyUndefined(teamUpdate));
        const newOwnerFill = buildPrimaryTeamFill(newOwnerData, teamSnap.id, teamName);
        if (newOwnerFill) tx.update(newOwnerRef, nullifyUndefined(newOwnerFill));
        const callerTeamIds = Array.isArray(callerData.teamIds) ? callerData.teamIds : [];
        const callerFill = callerSnap.exists && callerTeamIds.includes(teamSnap.id)
          ? buildPrimaryTeamFill(callerData, teamSnap.id, teamName) : null;
        if (callerFill) tx.update(callerRef, nullifyUndefined(callerFill));
        tx.set(opRef, nullifyUndefined({
          ...buildOperationLogPayload({
            operator,
            type: "team_transfer",
            typeName: "轉移俱樂部經理",
            content: `${oldName} 將「${teamName}」的經理轉移給「${newName || "成員"}」`,
            now: issuedAt,
          }),
          actorUid: callerUid,
          targetUid: newOwnerUid,
          teamId: teamSnap.id,
          source: "callable",
        }));
        tx.create(dedupeRef, nullifyUndefined({
          callerUid,
          kind: "team_transfer",
          teamId,
          newOwnerUid,
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: new Date(now() + DEDUPE_TTL_MS),
        }));

        const text = buildTransferNotices({ teamName, oldName, newName: newName || "成員" });
        return {
          response: { ok: true, teamId: teamSnap.id, newOwnerUid, deduplicated: false },
          notices: [
            { kind: "newOwner", recipientUid: newOwnerUid, fromUid: callerUid, ...text.newOwner },
            { kind: "oldOwner", recipientUid: callerUid, fromUid: callerUid, ...text.oldOwner },
          ],
        };
      });
    } catch (error) {
      const aborted = error?.code === 10 || error?.code === "aborted" || error?.code === "ABORTED";
      const known = safeErrors.has(error);
      const code = known ? error.code : (aborted ? "aborted" : "internal");
      const reason = known ? error.message : (aborted ? "TRANSFER_USER_TEAM_RETRY" : "TRANSFER_USER_TEAM_FAILED");
      // 結構化 log 只留固定欄位，不寫 UID、teamId、requestId 或底層錯誤訊息。
      logger.error("[transferUserTeam] failed", { function: "transferUserTeam", stage, attempts, code, reason });
      throw new HttpsError(code, reason);
    }
    // 交易已提交：通知在 try 之外，失敗不會變成轉移失敗。
    const notification = committed.notices
      ? await sendTransferNotices({ db, FieldValue, logger, now }, committed.notices)
      : null;
    return { ...committed.response, notification };
  };
}

function createTransferUserTeamCallable({ onCall, ...dependencies }) {
  return onCall({ region: "asia-east1" }, createTransferUserTeamHandler(dependencies));
}

module.exports = {
  createTransferUserTeamCallable,
  createTransferUserTeamHandler,
  buildStaffRemoval,
  buildDedupeId,
  OWNER_FIELDS,
};
