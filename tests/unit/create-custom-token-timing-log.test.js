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

describe("createCustomToken timing log", () => {
  test("成功登入：timing log 只有毫秒數且回傳正確", async () => {
    const { handler, sandbox } = loadHandler();
    const result = await handler(makeRequest("token-abc"));
    expect(result).toEqual({ customToken: "custom-token", role: "user" });
    const timingCall = sandbox.logger.info.mock.calls.find(([message]) => message === "[createCustomToken] timing");
    expect(timingCall).toBeTruthy();
    const timing = timingCall[1];
    expect(Object.keys(timing).sort()).toEqual([
      "channelWaitMs",
      "claimsMs",
      "ensureUserMs",
      "lineMs",
      "roleMs",
      "signMs",
      "totalMs",
    ]);
    for (const key of Object.keys(timing)) {
      expect(Number.isInteger(timing[key])).toBe(true);
      expect(timing[key]).toBeGreaterThanOrEqual(0);
    }
  });

  test("role 耗時 30ms：roleMs >= 25 且 totalMs >= roleMs", async () => {
    const { handler, sandbox } = loadHandler({
      getUserRoleFromFirestore: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return "user";
      }),
    });
    const result = await handler(makeRequest("token-abc"));
    expect(result).toEqual({ customToken: "custom-token", role: "user" });
    const timingCall = sandbox.logger.info.mock.calls.find(([message]) => message === "[createCustomToken] timing");
    expect(timingCall).toBeTruthy();
    const timing = timingCall[1];
    expect(timing.roleMs).toBeGreaterThanOrEqual(25);
    expect(timing.totalMs).toBeGreaterThanOrEqual(timing.roleMs);
  });

  test("timing log 不含個資/trace", async () => {
    const { handler, sandbox } = loadHandler();
    await handler(makeRequest("token-abc"));
    const timingCall = sandbox.logger.info.mock.calls.find(([message]) => message === "[createCustomToken] timing");
    const serialized = JSON.stringify(timingCall[1]);
    expect(serialized).not.toContain("Uabcdef123456");
    expect(serialized).not.toContain("token-");
    expect(serialized).not.toContain("user");
    expect(serialized).not.toContain("2009525300");
    expect(serialized).not.toContain("trace");
  });

  test("channel mismatch 拒絕時沒有 timing log", async () => {
    const { handler, sandbox } = loadHandler({
      verifyLineAccessTokenChannel: jest.fn(async () => ({ clientId: "999" })),
    });
    await expect(handler(makeRequest("token-abc"))).rejects.toMatchObject({ code: "unauthenticated" });
    const timingCall = sandbox.logger.info.mock.calls.find(([message]) => message === "[createCustomToken] timing");
    expect(timingCall).toBeUndefined();
  });

  test("timing log 拋錯不影響回傳", async () => {
    const loggerInfo = jest.fn((message) => {
      if (message === "[createCustomToken] timing") throw new Error("boom");
    });
    const { handler } = loadHandler({
      logger: { info: loggerInfo, warn: jest.fn(), error: jest.fn() },
    });
    const result = await handler(makeRequest("token-abc"));
    expect(result).toEqual({ customToken: "custom-token", role: "user" });
    expect(loggerInfo.mock.calls.some(([message]) => message === "[createCustomToken] timing")).toBe(true);
  });
});
