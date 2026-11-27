const fs = require("fs");
const path = require("path");
const vm = require("vm");

function extractFunctionSource(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`找不到函式 ${name}`);
  const braceStart = source.indexOf("{", start);
  if (braceStart < 0) throw new Error(`找不到函式 ${name} 的左大括號`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`函式 ${name} 大括號不完整`);
}

function extractConstLine(source, name) {
  const re = new RegExp(`^const ${name} = .*;$`, "m");
  const match = source.match(re);
  if (!match) throw new Error(`找不到常數 ${name}`);
  return match[0];
}

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function loadCleanLineDisplayName() {
  const indexPath = path.join(__dirname, "../../functions/index.js");
  const source = fs.readFileSync(indexPath, "utf8");
  const invisible = extractConstLine(source, "LINE_NAME_INVISIBLE_RE");
  const max = extractConstLine(source, "LINE_DISPLAY_NAME_MAX");
  const cleanSource = extractFunctionSource(source, "cleanLineDisplayName");
  const sandbox = { Array, String };
  sandbox.exports = {};
  vm.createContext(sandbox);
  vm.runInContext(
    `${invisible}\n${max}\n${cleanSource}\nthis.cleanLineDisplayName = cleanLineDisplayName;`,
    sandbox
  );
  return sandbox.cleanLineDisplayName;
}

function loadSyncLineDisplayName() {
  const indexPath = path.join(__dirname, "../../functions/index.js");
  const source = fs.readFileSync(indexPath, "utf8");
  const invisible = extractConstLine(source, "LINE_NAME_INVISIBLE_RE");
  const max = extractConstLine(source, "LINE_DISPLAY_NAME_MAX");
  const cleanSource = extractFunctionSource(source, "cleanLineDisplayName");
  const timeoutConst = extractConstLine(source, "LINE_NAME_SYNC_TIMEOUT_MS").replace(/=\s*\d+;/, "= 10;");
  // syncLineDisplayName 是 async function：extractFunctionSource 從 "function" 開始抽，要補回 async。
  const syncSource = `async ${extractFunctionSource(source, "syncLineDisplayName")}`;

  const update = jest.fn(async () => {});
  const doc = jest.fn(() => ({ update }));
  const collection = jest.fn(() => ({ doc }));
  const db = { collection };
  const logger = { warn: jest.fn() };

  const sandbox = {
    db,
    logger,
    setTimeout,
    clearTimeout,
    Promise,
    String,
    Array,
  };
  sandbox.exports = {};
  vm.createContext(sandbox);
  vm.runInContext(
    `${invisible}\n${max}\n${cleanSource}\n${timeoutConst}\n${syncSource}\nthis.syncLineDisplayName = syncLineDisplayName;`,
    sandbox
  );
  return { syncLineDisplayName: sandbox.syncLineDisplayName, db, collection, doc, update, logger };
}

function loadHandler(overrides = {}) {
  const indexPath = path.join(__dirname, "../../functions/index.js");
  const source = fs.readFileSync(indexPath, "utf8");
  const constants = [
    extractConstLine(source, "LINE_LOGIN_ALLOWED_CHANNEL_IDS"),
    extractConstLine(source, "LINE_CHANNEL_VERIFY_FAIL_OPEN"),
    extractConstLine(source, "LINE_CHANNEL_VERIFY_INVALID_TOKEN_ERRORS"),
  ].join("\n").replace(
    "LINE_CHANNEL_VERIFY_FAIL_OPEN = true;",
    overrides.failOpen === false ? "LINE_CHANNEL_VERIFY_FAIL_OPEN = false;" : "LINE_CHANNEL_VERIFY_FAIL_OPEN = true;",
  );
  const decideSource = extractFunctionSource(source, "decideLineChannelCheck");
  const traceIdSource = extractFunctionSource(source, "getRequestTraceId");
  const traceFieldSource = extractFunctionSource(source, "buildLogTraceField");
  const headerSource = extractFunctionSource(source, "getCallableRequestHeader");
  const handlerStart = source.indexOf("exports.createCustomToken = onCall(");
  const handlerEnd = source.indexOf("exports.issueQaTestToken = ");
  if (handlerStart < 0 || handlerEnd < 0) throw new Error("找不到 createCustomToken handler 區塊");
  const handlerSource = source.slice(handlerStart, handlerEnd);

  const sandbox = {
    onCall: (opts, fn) => fn,
    HttpsError,
    isLocalDevelopmentCreateCustomTokenRequest: jest.fn(() => false),
    getCreateCustomTokenRequestContext: jest.fn(() => ({})),
    assertLineAccessTokenNotRecentlyRejected: jest.fn(() => "fp"),
    verifyLineAccessTokenChannel: jest.fn(async () => ({ clientId: "2009525300" })),
    getLineProfileByAccessToken: jest.fn(async () => ({ userId: "Uabcdef123456", displayName: "" })),
    getLineProfileApiStatusFromError: jest.fn(() => null),
    isInvalidLineAccessTokenStatus: jest.fn(() => false),
    rememberRejectedLineAccessToken: jest.fn(),
    getLineAccessTokenFingerprint: jest.fn(() => "fp2"),
    writeDedupedAuditEntry: jest.fn(async () => {}),
    ensureAuthUser: jest.fn(async () => {}),
    findUserDocForLogin: jest.fn(async () => ({ role: "user", docId: null, lineDisplayName: null })),
    syncLineDisplayName: jest.fn(async () => "skipped"),
    setRoleClaimMerged: jest.fn(async () => {}),
    authAdmin: { createCustomToken: jest.fn(async () => "custom-token") },
    maskLineUserIdForLog: jest.fn(() => "U123***ab"),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    process: { env: { GCLOUD_PROJECT: "demo-proj" } },
    Object,
    String,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
    ...overrides,
  };
  sandbox.exports = {};
  vm.createContext(sandbox);
  vm.runInContext(
    `${constants}\n${decideSource}\n${traceIdSource}\n${traceFieldSource}\n${headerSource}\n${handlerSource}\nthis.decideLineChannelCheck = decideLineChannelCheck;`,
    sandbox
  );
  return {
    handler: sandbox.exports.createCustomToken,
    decide: sandbox.decideLineChannelCheck,
    sandbox,
    handlerSource,
  };
}

function makeRequest(accessToken, headers = {}) {
  return { data: { accessToken }, rawRequest: { headers } };
}

describe("cleanLineDisplayName", () => {
  test("一般名字原樣、去前後空白、連續空白壓成一個", () => {
    const clean = loadCleanLineDisplayName();
    expect(clean("阿傑")).toBe("阿傑");
    expect(clean("  阿傑  ")).toBe("阿傑");
    expect(clean("阿    傑")).toBe("阿 傑");
  });

  test.each([
    ["\u202A", "U+202A"],
    ["\u202B", "U+202B"],
    ["\u202C", "U+202C"],
    ["\u202D", "U+202D"],
    ["\u202E", "U+202E"],
    ["\u2066", "U+2066"],
    ["\u2067", "U+2067"],
    ["\u2068", "U+2068"],
    ["\u2069", "U+2069"],
    ["\u200B", "U+200B"],
    ["\uFEFF", "U+FEFF"],
    ["\n", "newline"],
    ["\t", "tab"],
    ["\u0007", "U+0007"],
  ])("移除不可見字元 %s", (ch) => {
    const clean = loadCleanLineDisplayName();
    expect(clean(`阿${ch}傑`)).toBe("阿傑");
  });

  test("25 個中文字只留 20 個", () => {
    const clean = loadCleanLineDisplayName();
    expect(clean("傑".repeat(25))).toBe("傑".repeat(20));
  });

  test("emoji 以 code point 計算只留 20 個", () => {
    const clean = loadCleanLineDisplayName();
    expect(clean("⚽".repeat(25))).toBe("⚽".repeat(20));
  });

  test("非字串回空字串", () => {
    const clean = loadCleanLineDisplayName();
    expect(clean(undefined)).toBe("");
    expect(clean(null)).toBe("");
    expect(clean(123)).toBe("");
  });

  test("只有看不見字元時回空字串", () => {
    const clean = loadCleanLineDisplayName();
    expect(clean("\u200B\u202A\uFEFF")).toBe("");
  });

  test("全形英數經 NFKC 轉半形", () => {
    const clean = loadCleanLineDisplayName();
    expect(clean("ＡＢＣ")).toBe("ABC");
  });
});

describe("syncLineDisplayName", () => {
  test("docId 為 null 回 skipped，且不呼叫 update", async () => {
    const { syncLineDisplayName, update } = loadSyncLineDisplayName();
    await expect(syncLineDisplayName({ docId: null, lineDisplayName: null }, "阿傑")).resolves.toBe("skipped");
    expect(update).not.toHaveBeenCalled();
  });

  test("清理後名字為空回 skipped，且不呼叫 update", async () => {
    const { syncLineDisplayName, update } = loadSyncLineDisplayName();
    await expect(syncLineDisplayName({ docId: "doc1", lineDisplayName: null }, " \u200B \n")).resolves.toBe("skipped");
    expect(update).not.toHaveBeenCalled();
  });

  test("現值相同回 same，且不呼叫 update", async () => {
    const { syncLineDisplayName, update } = loadSyncLineDisplayName();
    await expect(syncLineDisplayName({ docId: "doc1", lineDisplayName: "阿傑" }, " 阿傑 ")).resolves.toBe("same");
    expect(update).not.toHaveBeenCalled();
  });

  test("名字不同時寫入清理後的名字並回 written", async () => {
    const { syncLineDisplayName, collection, doc, update } = loadSyncLineDisplayName();
    await expect(syncLineDisplayName({ docId: "doc1", lineDisplayName: null }, "  阿   傑 ")).resolves.toBe("written");
    expect(collection).toHaveBeenCalledWith("users");
    expect(doc).toHaveBeenCalledWith("doc1");
    expect(update).toHaveBeenCalledWith({ lineDisplayName: "阿 傑" });
  });

  test("update reject 回 error，log 不含名字也不含 docId", async () => {
    const { syncLineDisplayName, update, logger } = loadSyncLineDisplayName();
    update.mockImplementation(async () => {
      const err = new Error("nope");
      err.code = "permission-denied";
      throw err;
    });
    await expect(syncLineDisplayName({ docId: "doc-secret-id", lineDisplayName: null }, "阿傑")).resolves.toBe("error");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const args = logger.warn.mock.calls[0];
    expect(args[1]).toEqual({ result: "error", code: "permission-denied" });
    const serialized = JSON.stringify(args);
    expect(serialized).not.toContain("阿傑");
    expect(serialized).not.toContain("doc-secret-id");
  });

  test("update 永遠不 resolve 回 timeout", async () => {
    const { syncLineDisplayName, update, logger } = loadSyncLineDisplayName();
    update.mockImplementation(() => new Promise(() => {}));
    await expect(syncLineDisplayName({ docId: "doc1", lineDisplayName: null }, "阿傑")).resolves.toBe("timeout");
    expect(logger.warn).toHaveBeenCalledWith("[createCustomToken] lineName sync", { result: "timeout" });
  });

  test("logger.warn 拋錯也不 throw", async () => {
    const { syncLineDisplayName, update, logger } = loadSyncLineDisplayName();
    update.mockImplementation(async () => {
      throw new Error("boom");
    });
    logger.warn.mockImplementation(() => {
      throw new Error("log boom");
    });
    await expect(syncLineDisplayName({ docId: "doc1", lineDisplayName: null }, "阿傑")).resolves.toBe("error");
  });
});

describe("createCustomToken LINE 暱稱同步", () => {
  test("簽發 token 後才同步，參數帶 login 與原始 displayName", async () => {
    const login = { role: "user", docId: "Uabcdef123456", lineDisplayName: null };
    const findUserDocForLogin = jest.fn(async () => login);
    const getLineProfileByAccessToken = jest.fn(async () => ({ userId: "Uabcdef123456", displayName: "阿傑" }));
    const syncLineDisplayName = jest.fn(async () => "written");
    const { handler, sandbox } = loadHandler({ findUserDocForLogin, getLineProfileByAccessToken, syncLineDisplayName });

    await expect(handler(makeRequest("token-abc"))).resolves.toEqual({ customToken: "custom-token", role: "user" });

    expect(syncLineDisplayName).toHaveBeenCalledTimes(1);
    expect(syncLineDisplayName).toHaveBeenCalledWith(login, "阿傑");
    expect(syncLineDisplayName.mock.invocationCallOrder[0])
      .toBeGreaterThan(sandbox.authAdmin.createCustomToken.mock.invocationCallOrder[0]);
  });

  test.each(["error", "timeout"])("sync 回 %s 時仍回傳登入結果", async (syncResult) => {
    const { handler } = loadHandler({
      syncLineDisplayName: jest.fn(async () => syncResult),
    });
    await expect(handler(makeRequest("token-abc"))).resolves.toEqual({ customToken: "custom-token", role: "user" });
  });

  test("timing log 有 nameSyncMs 且為數字", async () => {
    const { handler, sandbox } = loadHandler();
    await handler(makeRequest("token-abc"));
    const timingCall = sandbox.logger.info.mock.calls.find(([message]) => message === "[createCustomToken] timing");
    expect(timingCall).toBeTruthy();
    expect(typeof timingCall[1].nameSyncMs).toBe("number");
    expect(timingCall[1].nameSyncMs).toBeGreaterThanOrEqual(0);
    // totalMs 只算到簽好 token（舊口徑）；totalWithNameSyncMs＝totalMs＋nameSyncMs（含存 LINE 暱稱）。
    expect(timingCall[1].totalWithNameSyncMs).toBe(timingCall[1].totalMs + timingCall[1].nameSyncMs);
  });
});

describe("findUserDocForLogin", () => {
  function loadFind(found) {
    const source = fs.readFileSync(path.join(__dirname, "../../functions/index.js"), "utf8");
    const sandbox = { findUserDocByUidOrLineUserId: jest.fn(async () => found), String };
    vm.createContext(sandbox);
    vm.runInContext(
      `${extractFunctionSource(source, "normalizeRole")}\nasync ${extractFunctionSource(source, "findUserDocForLogin")}\nthis.findUserDocForLogin = findUserDocForLogin;`,
      sandbox,
    );
    return sandbox.findUserDocForLogin;
  }

  test("正式文件（文件 id＝uid）：回 docId 與現值", async () => {
    const find = loadFind({ docId: "U1", data: { role: "admin", lineDisplayName: "甲LINE" } });
    await expect(find("U1")).resolves.toEqual({ role: "admin", docId: "U1", lineDisplayName: "甲LINE" });
  });

  test("舊帳號文件（文件 id≠uid、尚未遷移）：角色照用，但 docId 為 null，不寫入", async () => {
    const find = loadFind({ docId: "legacyDoc", data: { role: "coach", lineDisplayName: "甲LINE" } });
    await expect(find("U1")).resolves.toEqual({ role: "coach", docId: null, lineDisplayName: "甲LINE" });
  });

  test("找不到文件：user、docId null", async () => {
    const find = loadFind(null);
    await expect(find("U1")).resolves.toEqual({ role: "user", docId: null, lineDisplayName: null });
  });
});
