const fs = require("fs");
const path = require("path");
const vm = require("vm");

const INDEX_PATH = path.join(__dirname, "../../functions/index.js");

function extractFunctionSource(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`找不到函式 ${name}`);
  let actualStart = start;
  if (start >= 6 && source.slice(start - 6, start) === "async ") {
    actualStart = start - 6;
  }
  // 參數預設值可能含 `= {}`：從參數列結束的 ") {" 開始配對函式本體。
  const paramsEnd = source.indexOf(") {", start);
  if (paramsEnd < 0) throw new Error(`找不到函式 ${name} 的左大括號`);
  const braceStart = paramsEnd + 2;
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(actualStart, i + 1);
    }
  }
  throw new Error(`函式 ${name} 大括號不完整`);
}

function extractConstBlock(source, name) {
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`找不到常數 ${name}`);
  let depth = 0;
  for (let i = start + marker.length; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "[" || ch === "{" || ch === "(") depth += 1;
    else if (ch === "]" || ch === "}" || ch === ")") depth -= 1;
    else if (ch === ";" && depth <= 0) {
      return source.slice(start, i + 1);
    }
  }
  throw new Error(`常數 ${name} 大括號不完整`);
}

// 把指定函式/常數從 index.js 抽出後在 vm sandbox 執行；缺依賴會自動補齊。
function loadModuleSandbox(source, initialFunctions, initialConsts, extraGlobals) {
  const functions = [...initialFunctions];
  const consts = Array.from(new Set(initialConsts || []));
  const extrasAdded = [];

  for (let attempt = 0; attempt < 300; attempt += 1) {
    const sandbox = {
      console,
      Set, Map, WeakMap, WeakSet,
      Object, Array, String, Number, Boolean,
      JSON, Math, Date, RegExp, Error, TypeError, RangeError,
      parseInt, parseFloat, isNaN, isFinite,
      decodeURIComponent, encodeURIComponent,
      Promise, Symbol,
      setTimeout, clearTimeout, setInterval, clearInterval,
      ...(extraGlobals || {}),
    };
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    try {
      const chunks = [];
      consts.forEach((name) => chunks.push(extractConstBlock(source, name)));
      functions.forEach((name) => chunks.push(extractFunctionSource(source, name)));
      const expose = functions.map((name) => `this.${name} = ${name};`).join("\n");
      const code = `${chunks.join("\n")}\n${expose}`;
      vm.runInContext(code, sandbox);
      return { sandbox, functions: [...functions], consts: [...consts], extrasAdded };
    } catch (err) {
      const msg = String((err && err.message) || "");
      const m = msg.match(/([A-Za-z_$][A-Za-z0-9_$]*) is not defined/);
      if (!m) throw err;
      const missing = m[1];
      if (functions.includes(missing) || consts.includes(missing)) throw err;
      let added = false;
      try {
        extractConstBlock(source, missing);
        consts.push(missing);
        extrasAdded.push({ kind: "const", name: missing });
        added = true;
      } catch (_) {}
      if (!added) {
        try {
          extractFunctionSource(source, missing);
          functions.push(missing);
          extrasAdded.push({ kind: "function", name: missing });
          added = true;
        } catch (_) {}
      }
      if (!added) throw err;
    }
  }
  throw new Error("依賴自動補齊超出上限");
}

// ── 從 syncTeamReservationSeatsForUserChange 的原始碼解析參數名稱，方便彈性呼叫 ──
function parseFnParams(fnSource) {
  const parenStart = fnSource.indexOf("(");
  if (parenStart < 0) throw new Error("找不到參數左括號");
  let depth = 0;
  let end = -1;
  for (let i = parenStart + 1; i < fnSource.length; i += 1) {
    const ch = fnSource[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      if (depth === 0) { end = i; break; }
      depth -= 1;
    }
  }
  if (end < 0) throw new Error("參數右括號不完整");
  const raw = fnSource.slice(parenStart + 1, end);
  const parts = [];
  let buf = "";
  let innerDepth = 0;
  for (const ch of raw) {
    if (ch === "{" || ch === "[" || ch === "(") { innerDepth += 1; buf += ch; }
    else if (ch === "}" || ch === "]" || ch === ")") { innerDepth -= 1; buf += ch; }
    else if (ch === "," && innerDepth === 0) { parts.push(buf.trim()); buf = ""; }
    else buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function buildSyncArgs(fnSource, userId, beforeData, afterData) {
  const params = parseFnParams(fnSource);
  const merged = {
    userId, uid: userId,
    beforeData, before: beforeData, oldData: beforeData, prevData: beforeData,
    afterData, after: afterData, userData: afterData, data: afterData, nextData: afterData,
  };

  if (params.length === 1) {
    const raw = params[0].trim();
    if (/^\{/.test(raw)) return [merged];
    const name = raw.replace(/=.*$/, "").trim();
    if (/^(user_?id|uid)$/i.test(name)) return [userId];
    return [merged];
  }

  return params.map((p) => {
    const name = p.replace(/=.*$/, "").trim();
    if (/^(user_?id|uid)$/i.test(name)) return userId;
    if (/^(before|beforeData|oldData|prevData)$/i.test(name)) return beforeData;
    if (/^(after|afterData|newData|nextData|userData|data)$/i.test(name)) return afterData;
    return undefined;
  });
}

// ── classifyUsersChange 專用 ──
const CLASSIFY_CONSTS = [
  "CHANGE_WATCH_TRUSTED_ROLES",
  "CHANGE_WATCH_SYSTEM_ACTOR_TYPES",
  "CHANGE_WATCH_USER_SAFE_PROFILE_FIELDS",
  "CHANGE_WATCH_USER_SAFE_LOGIN_FIELDS",
  "CHANGE_WATCH_USER_TEAM_FIELDS",
  "CHANGE_WATCH_USER_PRIVILEGE_FIELDS",
];

const CLASSIFY_FUNCTIONS = [
  "normalizeRole",
  "normalizeChangeWatchActorType",
  "normalizeChangeWatchActorId",
  "isSystemChangeWatchActor",
  "isTrustedChangeWatchRole",
  "hasOwnField",
  "timestampLikeToIso",
  "normalizeComparableValue",
  "areChangeWatchValuesEqual",
  "getChangedFields",
  "hasOnlyFields",
  "collectFieldNames",
  "pickSensitiveDiff",
  "normalizeStringList",
  "getNumericValue",
  "matchesActorId",
  "getUserTeamIds",
  "hasNonEmptyUserTeamMembership",
  "isUserTeamMembershipShrinkOrClear",
  "isSelfUserDocumentActor",
  "buildChangeWatchResult",
  "classifyUsersChange",
];

function makeUserData(overrides) {
  return {
    uid: "U1",
    lineUserId: "U1",
    displayName: "甲",
    role: "user",
    teamIds: ["t1"],
    teamId: "t1",
    ...(overrides || {}),
  };
}

describe("classifyUsersChange 只改 lineDisplayName 不產生告警", () => {
  let source;
  let classifyUsersChange;
  let extrasAdded;

  beforeAll(() => {
    source = fs.readFileSync(INDEX_PATH, "utf8");
    const loaded = loadModuleSandbox(source, CLASSIFY_FUNCTIONS, CLASSIFY_CONSTS);
    classifyUsersChange = loaded.sandbox.classifyUsersChange;
    extrasAdded = loaded.extrasAdded;
  });

  test("依賴自動補齊情形（僅記錄用）", () => {
    expect(Array.isArray(extrasAdded)).toBe(true);
    // 若未來 index.js 調整依賴，這裡可幫助定位缺漏。
    if (extrasAdded.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        "[users-line-name-change-watch] 自動補齊依賴：",
        extrasAdded.map((item) => `${item.kind}:${item.name}`).join(", ")
      );
    }
  });

  test("案例 1：service_account 新增 lineDisplayName → null", async () => {
    const beforeData = makeUserData();
    const afterData = makeUserData({ lineDisplayName: "甲LINE" });
    const result = await classifyUsersChange({
      changeType: "update",
      beforeData,
      afterData,
      actorType: "service_account",
      actorId: "",
      actorRole: "service_account",
      documentId: "U1",
    });
    expect(result).toBeNull();
  });

  test("案例 2：system 修改 lineDisplayName → null", async () => {
    const beforeData = makeUserData({ lineDisplayName: "甲LINE" });
    const afterData = makeUserData({ lineDisplayName: "甲新" });
    const result = await classifyUsersChange({
      changeType: "update",
      beforeData,
      afterData,
      actorType: "system",
      actorId: "",
      actorRole: "system",
      documentId: "U1",
    });
    expect(result).toBeNull();
  });

  test("案例 3：本人只改 lineDisplayName → null", async () => {
    const beforeData = makeUserData();
    const afterData = makeUserData({ lineDisplayName: "甲LINE" });
    const result = await classifyUsersChange({
      changeType: "update",
      beforeData,
      afterData,
      actorType: "unknown",
      actorId: "U1",
      actorRole: "user",
      documentId: "U1",
    });
    expect(result).toBeNull();
  });

  test("案例 4：別人只改 lineDisplayName → null", async () => {
    const beforeData = makeUserData();
    const afterData = makeUserData({ lineDisplayName: "甲LINE" });
    const result = await classifyUsersChange({
      changeType: "update",
      beforeData,
      afterData,
      actorType: "unknown",
      actorId: "U2",
      actorRole: "user",
      documentId: "U1",
    });
    expect(result).toBeNull();
  });

  test("案例 5：同時改 lineDisplayName 與 role → 非 null，reasonCodes 含 user_role_changed", async () => {
    const beforeData = makeUserData();
    const afterData = makeUserData({ lineDisplayName: "甲LINE", role: "admin" });
    const result = await classifyUsersChange({
      changeType: "update",
      beforeData,
      afterData,
      actorType: "unknown",
      actorId: "U2",
      actorRole: "user",
      documentId: "U1",
    });
    expect(result).not.toBeNull();
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["user_role_changed"]));
  });

  test("案例 6：改 teamIds → 非 null，reasonCodes 含 user_team_membership_changed", async () => {
    const beforeData = makeUserData();
    const afterData = makeUserData({ teamIds: ["t1", "t2"] });
    const result = await classifyUsersChange({
      changeType: "update",
      beforeData,
      afterData,
      actorType: "unknown",
      actorId: "U2",
      actorRole: "user",
      documentId: "U1",
    });
    expect(result).not.toBeNull();
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(["user_team_membership_changed"])
    );
  });
});

// ── syncTeamReservationSeatsForUserChange 專用 ──
const SYNC_FUNCTIONS = [
  "syncTeamReservationSeatsForUserChange",
  "getUserReservationMembershipTeamIds",
  "areStringSetsEqual",
  "unionStringSets",
  "buildUserReservationUidCandidates",
  "getUserTeamIdSetFromData",
  "addStaffTeamIdsForReservation",
  "isTeamStaffForReservationUser",
];

describe("syncTeamReservationSeatsForUserChange 隊伍欄位沒變", () => {
  let source;
  let syncSource;
  let syncFn;
  let dbCollection;
  let syncExtrasAdded;

  beforeAll(() => {
    source = fs.readFileSync(INDEX_PATH, "utf8");
    syncSource = extractFunctionSource(source, "syncTeamReservationSeatsForUserChange");
    dbCollection = jest.fn(() => {
      throw new Error("不應讀 events");
    });
    const loaded = loadModuleSandbox(source, SYNC_FUNCTIONS, [], {
      db: { collection: dbCollection },
    });
    syncFn = loaded.sandbox.syncTeamReservationSeatsForUserChange;
    syncExtrasAdded = loaded.extrasAdded;
  });

  test("依賴自動補齊情形（僅記錄用）", () => {
    expect(Array.isArray(syncExtrasAdded)).toBe(true);
    if (syncExtrasAdded.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        "[users-line-name-change-watch] sync 自動補齊依賴：",
        syncExtrasAdded.map((item) => `${item.kind}:${item.name}`).join(", ")
      );
    }
  });

  test("案例 7：只差 lineDisplayName → 回 0 且不呼叫 db.collection", async () => {
    const beforeData = makeUserData();
    const afterData = makeUserData({ lineDisplayName: "甲LINE" });
    const args = buildSyncArgs(syncSource, "U1", beforeData, afterData);
    const result = await syncFn(...args);
    expect(result).toEqual({
      scannedEvents: 0,
      updatedEvents: 0,
      updatedRegistrations: 0,
      promoted: 0,
    });
    expect(dbCollection).not.toHaveBeenCalled();
  });
});
