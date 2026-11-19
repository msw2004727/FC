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
    getLineUserIdByAccessToken: jest.fn(async () => "Uabcdef123456"),
    getLineProfileApiStatusFromError: jest.fn(() => null),
    isInvalidLineAccessTokenStatus: jest.fn(() => false),
    rememberRejectedLineAccessToken: jest.fn(),
    getLineAccessTokenFingerprint: jest.fn(() => "fp2"),
    writeDedupedAuditEntry: jest.fn(async () => {}),
    ensureAuthUser: jest.fn(async () => {}),
    getUserRoleFromFirestore: jest.fn(async () => "user"),
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

function findChannelCheckLog(sandbox) {
  const call = sandbox.logger.info.mock.calls.find(([message]) => message === "[createCustomToken] channel check");
  return call ? call[1] : null;
}

function stringifyLogCalls(sandbox) {
  const calls = [];
  [
    sandbox.logger.info,
    sandbox.logger.warn,
    sandbox.logger.error,
    sandbox.console.log,
    sandbox.console.warn,
    sandbox.console.error,
  ].forEach((fn) => {
    calls.push(...fn.mock.calls);
  });
  return JSON.stringify(calls);
}

describe("授權強化：createCustomToken channel enforce", () => {
  test("decideLineChannelCheck 真值表", () => {
    const { decide } = loadHandler();

    expect(decide({ clientId: "2009525300" })).toEqual({ decision: "allow", reject: false });
    expect(decide({ clientId: "2009084941" })).toEqual({ decision: "allow", reject: false });
    expect(decide({ clientId: "1234567890" })).toEqual({ decision: "reject_mismatch", reject: true });
    expect(decide({ clientId: "" })).toEqual({ decision: "reject_mismatch", reject: true });

    // Opus 終審 P2：除 400／401／403 外的非 200 都算 LINE 端異常，依開關放行。
    ["timeout", "network", "parse", "http_429", "http_500", "http_503", "http_302", "http_404", "http_405", "http_410", "http_undefined"].forEach((error) => {
      expect(decide({ clientId: "", error }, true)).toEqual({ decision: "allow_verify_error", reject: false });
      expect(decide({ clientId: "", error }, false)).toEqual({ decision: "reject_verify_error", reject: true });
    });

    ["http_400", "http_401", "http_403"].forEach((error) => {
      expect(decide({ clientId: "", error }, true)).toEqual({ decision: "reject_verify_error", reject: true });
    });

    expect(decide({ clientId: "", error: "skipped" })).toEqual({ decision: "reject_verify_error", reject: true });
  });

  test("白名單內 allow 時回傳 customToken 並完成建使用者與簽發", async () => {
    const verifyLineAccessTokenChannel = jest.fn(async () => ({ clientId: "2009525300" }));
    const { handler, sandbox } = loadHandler({ verifyLineAccessTokenChannel });

    const result = await handler(makeRequest("token-allow"));

    expect(result).toEqual({ customToken: "custom-token", role: "user" });
    expect(sandbox.ensureAuthUser).toHaveBeenCalledTimes(1);
    expect(sandbox.setRoleClaimMerged).toHaveBeenCalledTimes(1);
    expect(sandbox.authAdmin.createCustomToken).toHaveBeenCalledTimes(1);
    expect(findChannelCheckLog(sandbox).decision).toBe("allow");
  });

  test("verify 晚到且判定 mismatch 時拒絕，且不建使用者、不簽發、不寫成功稽核", async () => {
    const verifyLineAccessTokenChannel = jest.fn(() => new Promise((resolve) => {
      setTimeout(() => resolve({ clientId: "999" }), 20);
    }));
    const getLineUserIdByAccessToken = jest.fn(async () => "Uabcdef123456");
    const { handler, sandbox } = loadHandler({ verifyLineAccessTokenChannel, getLineUserIdByAccessToken });

    await expect(handler(makeRequest("token-mismatch"))).rejects.toMatchObject({
      code: "unauthenticated",
      message: "LINE 驗證失敗",
    });

    expect(sandbox.ensureAuthUser).not.toHaveBeenCalled();
    expect(sandbox.getUserRoleFromFirestore).not.toHaveBeenCalled();
    expect(sandbox.setRoleClaimMerged).not.toHaveBeenCalled();
    expect(sandbox.authAdmin.createCustomToken).not.toHaveBeenCalled();
    expect(sandbox.writeDedupedAuditEntry).toHaveBeenCalledTimes(1);
    const audit = sandbox.writeDedupedAuditEntry.mock.calls[0][0];
    expect(audit.action).toBe("login_failure");
    expect(audit.meta.reasonCode).toBe("line_channel_mismatch");
    expect(sandbox.writeDedupedAuditEntry.mock.calls.some(([entry]) => entry.result === "success")).toBe(false);
    expect(sandbox.rememberRejectedLineAccessToken).toHaveBeenCalledWith("fp");

    const channelLog = findChannelCheckLog(sandbox);
    expect(channelLog.decision).toBe("reject_mismatch");
    expect(channelLog.channelId).toBe("999");
  });

  test("verify 回 http_401 時拒絕，且不建使用者、不簽發、稽核 reasonCode 正確", async () => {
    const verifyLineAccessTokenChannel = jest.fn(async () => ({ clientId: "", error: "http_401" }));
    const { handler, sandbox } = loadHandler({ verifyLineAccessTokenChannel });

    await expect(handler(makeRequest("token-401"))).rejects.toMatchObject({
      code: "unauthenticated",
      message: "LINE 驗證失敗",
    });

    expect(sandbox.ensureAuthUser).not.toHaveBeenCalled();
    expect(sandbox.getUserRoleFromFirestore).not.toHaveBeenCalled();
    expect(sandbox.setRoleClaimMerged).not.toHaveBeenCalled();
    expect(sandbox.authAdmin.createCustomToken).not.toHaveBeenCalled();
    expect(sandbox.writeDedupedAuditEntry).toHaveBeenCalledTimes(1);
    const audit = sandbox.writeDedupedAuditEntry.mock.calls[0][0];
    expect(audit.action).toBe("login_failure");
    expect(audit.meta.reasonCode).toBe("line_channel_verify_rejected");
    expect(sandbox.rememberRejectedLineAccessToken).toHaveBeenCalledWith("fp");
  });

  test.each(["timeout", "http_429"])("verify 回 %s 時放行簽發且不寫稽核，log 保留 error 供監看", async (error) => {
    const verifyLineAccessTokenChannel = jest.fn(async () => ({ clientId: "", error }));
    const { handler, sandbox } = loadHandler({ verifyLineAccessTokenChannel });

    const result = await handler(makeRequest(`token-${error}`));

    expect(result).toEqual({ customToken: "custom-token", role: "user" });
    expect(sandbox.writeDedupedAuditEntry).not.toHaveBeenCalled();
    const channelLog = findChannelCheckLog(sandbox);
    expect(channelLog.decision).toBe("allow_verify_error");
    expect(channelLog.error).toBe(error);
  });

  test("profile 失敗而 verify allow 時仍拒絕，不簽發 custom token", async () => {
    const verifyLineAccessTokenChannel = jest.fn(async () => ({ clientId: "2009525300" }));
    const getLineUserIdByAccessToken = jest.fn(async () => {
      throw new Error("LINE profile API error: 401");
    });
    const { handler, sandbox } = loadHandler({ verifyLineAccessTokenChannel, getLineUserIdByAccessToken });

    await expect(handler(makeRequest("token-profile-fail"))).rejects.toMatchObject({
      code: "unauthenticated",
      message: "LINE 驗證失敗",
    });

    expect(sandbox.authAdmin.createCustomToken).not.toHaveBeenCalled();
  });

  test("verify 先發、profile 被呼叫時 verify 尚未 resolve", async () => {
    let resolveVerify;
    const verifyLineAccessTokenChannel = jest.fn(() => new Promise((resolve) => {
      resolveVerify = resolve;
    }));
    let profileCalledBeforeVerifyResolved = false;
    const getLineUserIdByAccessToken = jest.fn(async () => {
      expect(verifyLineAccessTokenChannel).toHaveBeenCalledTimes(1);
      profileCalledBeforeVerifyResolved = true;
      setTimeout(() => resolveVerify({ clientId: "2009525300" }), 0);
      return "Uabcdef123456";
    });
    const { handler } = loadHandler({ verifyLineAccessTokenChannel, getLineUserIdByAccessToken });

    const result = await handler(makeRequest("token-concurrent"));

    expect(result).toEqual({ customToken: "custom-token", role: "user" });
    expect(profileCalledBeforeVerifyResolved).toBe(true);
    expect(verifyLineAccessTokenChannel.mock.invocationCallOrder[0])
      .toBeLessThan(getLineUserIdByAccessToken.mock.invocationCallOrder[0]);
  });

  test("trace 欄位由 x-cloud-trace-context、traceparent 取得，缺少時不輸出", async () => {
    {
      const { handler, sandbox } = loadHandler();
      await handler(makeRequest("token-trace-cloud", { "x-cloud-trace-context": "ABC123def/1;o=1" }));
      const channelLog = findChannelCheckLog(sandbox);
      expect(channelLog["logging.googleapis.com/trace"]).toBe("projects/demo-proj/traces/abc123def");
    }

    {
      const { handler, sandbox } = loadHandler();
      await handler(makeRequest("token-trace-parent", {
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      }));
      const channelLog = findChannelCheckLog(sandbox);
      expect(channelLog["logging.googleapis.com/trace"]).toBe("projects/demo-proj/traces/0af7651916cd43dd8448eb211c80319c");
    }

    {
      const { handler, sandbox } = loadHandler();
      await handler(makeRequest("token-trace-none"));
      const channelLog = findChannelCheckLog(sandbox);
      expect(Object.prototype.hasOwnProperty.call(channelLog, "logging.googleapis.com/trace")).toBe(false);
    }

    {
      const { handler, sandbox } = loadHandler({ process: { env: { GCLOUD_PROJECT: "" } } });
      await handler(makeRequest("token-trace-no-project", { "x-cloud-trace-context": "ABC123def/1;o=1" }));
      const channelLog = findChannelCheckLog(sandbox);
      expect(Object.prototype.hasOwnProperty.call(channelLog, "logging.googleapis.com/trace")).toBe(false);
    }
  });

  test("log 不含 accessToken 與完整 lineUserId", async () => {
    const token = "SECRET_ACCESS_TOKEN_FOR_LOG_TEST";
    const lineUserId = "Uabcdef123456";
    let allLogs = "";

    {
      const { handler, sandbox } = loadHandler({
        verifyLineAccessTokenChannel: jest.fn(async () => ({ clientId: "2009525300" })),
        getLineUserIdByAccessToken: jest.fn(async () => lineUserId),
      });
      await handler(makeRequest(token));
      allLogs += stringifyLogCalls(sandbox);
    }

    {
      const { handler, sandbox } = loadHandler({
        verifyLineAccessTokenChannel: jest.fn(async () => ({ clientId: "999" })),
        getLineUserIdByAccessToken: jest.fn(async () => lineUserId),
      });
      await expect(handler(makeRequest(token))).rejects.toMatchObject({ code: "unauthenticated" });
      allLogs += stringifyLogCalls(sandbox);
    }

    {
      const { handler, sandbox } = loadHandler({
        verifyLineAccessTokenChannel: jest.fn(async () => ({ clientId: "", error: "timeout" })),
        getLineUserIdByAccessToken: jest.fn(async () => lineUserId),
      });
      await handler(makeRequest(token));
      allLogs += stringifyLogCalls(sandbox);
    }

    expect(allLogs).not.toContain(token);
    expect(allLogs).not.toContain(lineUserId);
  });

  test("原始碼檢查：先判定才建使用者與簽發，且不再用舊的 console channel check log", () => {
    const { handlerSource } = loadHandler();
    const decisionIndex = handlerSource.indexOf("decideLineChannelCheck(channelCheckResult)");
    const ensureIndex = handlerSource.indexOf("ensureAuthUser(");
    const setRoleIndex = handlerSource.indexOf("setRoleClaimMerged(");
    const createTokenIndex = handlerSource.indexOf("authAdmin.createCustomToken(");

    expect(decisionIndex).toBeGreaterThan(-1);
    expect(ensureIndex).toBeGreaterThan(-1);
    expect(setRoleIndex).toBeGreaterThan(-1);
    expect(createTokenIndex).toBeGreaterThan(-1);
    expect(decisionIndex).toBeLessThan(ensureIndex);
    expect(decisionIndex).toBeLessThan(setRoleIndex);
    expect(decisionIndex).toBeLessThan(createTokenIndex);
    expect(handlerSource).not.toContain('console.log("[createCustomToken] channel check"');
  });
});

// Opus 終審 P2／P3 補測。
describe("createCustomToken LINE 端異常的處理（Opus 終審）", () => {
  test("verify 回 404（端點變動）時預設放行，不記入拒絕快取", async () => {
    const verifyLineAccessTokenChannel = jest.fn(async () => ({ clientId: "", error: "http_404" }));
    const { handler, sandbox } = loadHandler({ verifyLineAccessTokenChannel });
    await expect(handler(makeRequest("token-404"))).resolves.toMatchObject({ customToken: "custom-token" });
    expect(sandbox.rememberRejectedLineAccessToken).not.toHaveBeenCalled();
    expect(findChannelCheckLog(sandbox)).toMatchObject({ decision: "allow_verify_error", error: "http_404" });
  });

  test("關閉放行時 LINE 端異常被拒，但不記入拒絕快取（合法 token 可立即重試）", async () => {
    const verifyLineAccessTokenChannel = jest.fn(async () => ({ clientId: "", error: "timeout" }));
    const { handler, sandbox } = loadHandler({ verifyLineAccessTokenChannel, failOpen: false });
    await expect(handler(makeRequest("token-timeout"))).rejects.toMatchObject({ code: "unauthenticated" });
    expect(sandbox.rememberRejectedLineAccessToken).not.toHaveBeenCalled();
    expect(sandbox.authAdmin.createCustomToken).not.toHaveBeenCalled();
    expect(findChannelCheckLog(sandbox)).toMatchObject({ decision: "reject_verify_error", error: "timeout" });
  });

  test("LINE 明確回 403 時拒絕並記入拒絕快取", async () => {
    const verifyLineAccessTokenChannel = jest.fn(async () => ({ clientId: "", error: "http_403" }));
    const { handler, sandbox } = loadHandler({ verifyLineAccessTokenChannel });
    await expect(handler(makeRequest("token-403"))).rejects.toMatchObject({ code: "unauthenticated" });
    expect(sandbox.rememberRejectedLineAccessToken).toHaveBeenCalledWith("fp");
  });

  test("拒絕時稽核寫入失敗仍回 unauthenticated", async () => {
    const verifyLineAccessTokenChannel = jest.fn(async () => ({ clientId: "999" }));
    const writeDedupedAuditEntry = jest.fn(async () => { throw new Error("audit down"); });
    const { handler, sandbox } = loadHandler({ verifyLineAccessTokenChannel, writeDedupedAuditEntry });
    await expect(handler(makeRequest("token-audit"))).rejects.toMatchObject({ code: "unauthenticated", message: "LINE 驗證失敗" });
    expect(sandbox.authAdmin.createCustomToken).not.toHaveBeenCalled();
  });
});
