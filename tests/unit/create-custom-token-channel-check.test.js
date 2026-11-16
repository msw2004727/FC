const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { EventEmitter } = require("events");

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

function loadHelpers() {
  const indexPath = path.join(__dirname, "../../functions/index.js");
  const source = fs.readFileSync(indexPath, "utf8");
  const verifySource = extractFunctionSource(source, "verifyLineAccessTokenChannel");
  const maskSource = extractFunctionSource(source, "maskLineUserIdForLog");
  const httpsMock = { request: jest.fn() };
  const sandbox = {
    https: httpsMock,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    encodeURIComponent,
    String,
    JSON,
    console,
  };
  sandbox.exports = {};
  vm.createContext(sandbox);
  vm.runInContext(
    `${verifySource}\n${maskSource}\nthis.verifyLineAccessTokenChannel = verifyLineAccessTokenChannel; this.maskLineUserIdForLog = maskLineUserIdForLog;`,
    sandbox
  );
  return { ...sandbox, httpsMock };
}

function mockRequestOnce(handler) {
  return (options, callback) => {
    const req = new EventEmitter();
    req.end = jest.fn(() => handler(req, callback, options));
    req.destroy = jest.fn(() => {
      req.emit("error", new Error("destroyed"));
    });
    return req;
  };
}

describe("verifyLineAccessTokenChannel", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test("200 且 client_id 在 whitelist 時回傳 clientId，且不 reject", async () => {
    const { verifyLineAccessTokenChannel, httpsMock } = loadHelpers();
    httpsMock.request.mockImplementation(mockRequestOnce((req, callback) => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      res.emit("data", JSON.stringify({ client_id: "2009525300" }));
      res.emit("end");
    }));

    const token = "secret_token_123";
    const result = await verifyLineAccessTokenChannel(token);
    expect(result).toEqual({ clientId: "2009525300" });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  test("200 且 client_id 不在 whitelist 時仍回傳 clientId，且不 reject", async () => {
    const { verifyLineAccessTokenChannel, httpsMock } = loadHelpers();
    httpsMock.request.mockImplementation(mockRequestOnce((req, callback) => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      res.emit("data", JSON.stringify({ client_id: "9999999999" }));
      res.emit("end");
    }));

    const token = "secret_token_not_allowed";
    const result = await verifyLineAccessTokenChannel(token);
    expect(result).toEqual({ clientId: "9999999999" });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  test("401 回傳 http_401，且不 reject、不含 token", async () => {
    const { verifyLineAccessTokenChannel, httpsMock } = loadHelpers();
    httpsMock.request.mockImplementation(mockRequestOnce((req, callback) => {
      const res = new EventEmitter();
      res.statusCode = 401;
      callback(res);
      res.emit("end");
    }));

    const token = "secret_token_401";
    const result = await verifyLineAccessTokenChannel(token);
    expect(result).toEqual({ clientId: "", error: "http_401" });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  test("200 但 JSON 壞掉回傳 parse，且不 reject、不含 token", async () => {
    const { verifyLineAccessTokenChannel, httpsMock } = loadHelpers();
    httpsMock.request.mockImplementation(mockRequestOnce((req, callback) => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      res.emit("data", "{not-json");
      res.emit("end");
    }));

    const token = "secret_token_parse";
    const result = await verifyLineAccessTokenChannel(token);
    expect(result).toEqual({ clientId: "", error: "parse" });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  test("error 事件回傳 network，且不 reject、不含 token", async () => {
    const { verifyLineAccessTokenChannel, httpsMock } = loadHelpers();
    const token = "secret_token_network";
    httpsMock.request.mockImplementation(mockRequestOnce((req) => {
      req.emit("error", new Error(`boom ${token}`));
    }));

    const result = await verifyLineAccessTokenChannel(token);
    expect(result).toEqual({ clientId: "", error: "network" });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  test("逾時回傳 timeout，且不 reject、不含 token", async () => {
    jest.useFakeTimers();
    const { verifyLineAccessTokenChannel, httpsMock } = loadHelpers();
    httpsMock.request.mockImplementation(mockRequestOnce(() => {}));

    const token = "secret_token_timeout";
    const promise = verifyLineAccessTokenChannel(token);
    jest.advanceTimersByTime(3000);
    const result = await promise;
    expect(result).toEqual({ clientId: "", error: "timeout" });
    expect(JSON.stringify(result)).not.toContain(token);
  });
});

describe("maskLineUserIdForLog", () => {
  test("長度足夠時只露前 4 碼與末 2 碼", () => {
    const { maskLineUserIdForLog } = loadHelpers();
    expect(maskLineUserIdForLog("U1234567890abcdef")).toBe("U123***ef");
  });

  test("長度不足 8 時只印 ***", () => {
    const { maskLineUserIdForLog } = loadHelpers();
    expect(maskLineUserIdForLog("U123456")).toBe("***");
    expect(maskLineUserIdForLog("")).toBe("***");
  });
});
