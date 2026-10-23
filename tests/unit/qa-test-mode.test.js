const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const requestStore = new AsyncLocalStorage();

const {
  QA_PUBLIC_ERROR_MESSAGE,
  QA_UID_RE,
  hashQaIp,
  matchQaPassword,
  normalizeQaConfig,
  parseQaSecret,
  resolveQaClientIp,
  resolveQaPersona,
} = require('../../functions/qa-test-mode-core');
const {
  createIssueQaTestTokenCallable,
  createIssueQaTestTokenHandler,
} = require('../../functions/qa-test-mode');

const NOW = Date.parse('2026-10-24T00:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const PUBLIC_MESSAGE = '無法進入測試模式';
const TOKEN = 'fake-custom-token-001';
const CLIENT_IP = '203.0.113.9';
const FORGED_IP = '1.1.1.1';
const FALLBACK_IP = '198.51.100.20';
const PASSWORDS = {
  alpha: 'Fake-Pw-Alpha-001',
  beta: 'Fake-Pw-Beta-0002',
  gamma: 'Fake-Pw-Gamma-003',
  delta: 'Fake-Pw-Delta-004',
  wrong: 'Fake-Pw-Wrong-999',
  colon: 'Fake:Pw:Alpha-001',
};
const FUTURE = NOW + 48 * HOUR_MS;
const REAL_UID = `U${'0123456789abcdef'.repeat(2)}`;
const SECRET_STRINGS = [
  PASSWORDS.alpha,
  PASSWORDS.beta,
  PASSWORDS.gamma,
  PASSWORDS.delta,
  PASSWORDS.wrong,
  PASSWORDS.colon,
  TOKEN,
  FORGED_IP,
  '203.0.113.',
  '198.51.100.',
  '2001:db8::',
];

const rejectionCodes = [];

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function qaUid(suffix) {
  return `U${'0'.repeat(28)}${String(suffix).padStart(4, '0')}`;
}

const PLAYER_UID = qaUid(1);
const COACH_UID = qaUid(2);
const CAPTAIN_UID = qaUid(3);

function clone(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function secretLine(agentId, password, expiresAtMs, personas) {
  const stamp = new Date(expiresAtMs).toISOString();
  const base = `${agentId}:${password}|${stamp}`;
  return personas === undefined ? base : `${base}|${personas}`;
}

function boom(label) {
  return new Error(`${label} ${PASSWORDS.alpha} ${PASSWORDS.beta} ${CLIENT_IP} ${FORGED_IP} ${TOKEN}`);
}

function expectNoSecrets(text) {
  for (const secret of SECRET_STRINGS) {
    expect(text).not.toContain(secret);
  }
}

function defaultConfig(overrides = {}) {
  const config = {
    enabled: true,
    sessionCapHours: 12,
    maxFutureHours: 168,
    throttle: {
      perIp: { maxFailures: 5, windowSec: 600, lockSec: 900 },
      global: { maxFailures: 100, windowSec: 600, lockSec: 300 },
    },
    personas: {
      player: {
        uid: PLAYER_UID,
        displayName: 'QA測試-球員A',
        role: 'user',
        teamKey: 'alpha',
        enabled: true,
      },
      coach: {
        uid: COACH_UID,
        displayName: 'QA測試-教練B',
        role: 'coach',
        teamKey: 'alpha',
        enabled: true,
      },
    },
    teams: {
      alpha: { teamId: 'team-alpha', name: 'QA Alpha' },
    },
  };
  const next = { ...config, ...overrides };
  if (overrides.throttle) {
    next.throttle = {
      perIp: { ...config.throttle.perIp, ...(overrides.throttle.perIp || {}) },
      global: { ...config.throttle.global, ...(overrides.throttle.global || {}) },
    };
  }
  if (overrides.personas) next.personas = overrides.personas;
  if (overrides.teams) next.teams = overrides.teams;
  return next;
}

function defaultUsers() {
  return {
    [PLAYER_UID]: {
      uid: PLAYER_UID,
      displayName: 'QA測試-球員A',
      role: 'user',
    },
    [COACH_UID]: {
      uid: COACH_UID,
      displayName: 'QA測試-教練B',
      role: 'coach',
    },
  };
}

function defaultRawRequest() {
  return {
    headers: { 'x-forwarded-for': `${FORGED_IP}, ${CLIENT_IP}` },
    ip: FALLBACK_IP,
  };
}

function rawWithIp(ip) {
  return {
    headers: { 'x-forwarded-for': `${FORGED_IP}, ${ip}` },
    ip: FALLBACK_IP,
  };
}

function createMemoryDb(controls) {
  const docs = new Map();

  function snapshot(docPath) {
    if (!docs.has(docPath)) {
      return { exists: false, data: () => undefined };
    }
    const data = docs.get(docPath);
    return { exists: true, data: () => clone(data) };
  }

  function makeRef(collectionName, id) {
    const docPath = `${collectionName}/${id}`;
    return {
      path: docPath,
      collectionName,
      id,
      async get() {
        if (collectionName === 'qaTestMode' && controls.failConfigRead) throw boom('config read');
        if (collectionName === 'users' && controls.failUsersRead) throw boom('users read');
        return snapshot(docPath);
      },
      async delete() {
        docs.delete(docPath);
      },
    };
  }

  // 互斥鎖把並行 runTransaction 排成一列，模擬 Firestore 樂觀衝突重試後的提交順序。
  // 下一筆交易看得到上一筆已提交的預占。beforeTransaction 若要停住結算，必須在取鎖之前等待。
  let queue = Promise.resolve();
  const api = {
    docs,
    transactionCount: 0,
    collection(collectionName) {
      return {
        doc(id) {
          return makeRef(collectionName, id);
        },
      };
    },
    async runTransaction(fn) {
      if (controls.failTransaction) throw boom('transaction');
      if (typeof controls.beforeTransaction === 'function') {
        await controls.beforeTransaction(new Error().stack || '');
      }
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const previous = queue;
      queue = gate;
      await previous;
      const ordinal = api.transactionCount;
      api.transactionCount += 1;
      try {
        const writes = [];
        const tx = {
          async get(ref) {
            if (controls.failThrottleRead && ref.collectionName === 'qaTestAuthThrottle') {
              throw boom('throttle read');
            }
            return snapshot(ref.path);
          },
          set(ref, data, options) {
            // 測試同步更新：預占寫入失敗會改走 qa_throttle_read_failed。
            // 此開關只讓第一筆交易之後的寫入（結算）失敗。
            if (controls.failThrottleWrite && ordinal > 0
              && ref.collectionName === 'qaTestAuthThrottle') {
              throw boom('throttle write');
            }
            writes.push({
              path: ref.path,
              data: clone(data),
              merge: Boolean(options && options.merge),
            });
          },
        };
        const result = await fn(tx);
        writes.forEach((write) => {
          if (write.merge && docs.has(write.path)) {
            docs.set(write.path, { ...clone(docs.get(write.path)), ...write.data });
          } else {
            docs.set(write.path, write.data);
          }
        });
        return result;
      } finally {
        release();
      }
    },
    seed(collectionName, id, data) {
      docs.set(`${collectionName}/${id}`, clone(data));
    },
    read(collectionName, id) {
      const docPath = `${collectionName}/${id}`;
      return docs.has(docPath) ? clone(docs.get(docPath)) : undefined;
    },
  };
  return api;
}

function createHarness({
  config,
  configExists = true,
  users,
  secretText = secretLine('qa01', PASSWORDS.alpha, FUTURE),
  secretMode = 'ok',
  controls: controlOverrides = {},
} = {}) {
  const controls = {
    failConfigRead: false,
    failThrottleRead: false,
    failUsersRead: false,
    failTransaction: false,
    failThrottleWrite: false,
    failSuccessAudit: false,
    failFailureAudit: false,
    failToken: false,
    ...controlOverrides,
  };
  const db = createMemoryDb(controls);
  if (configExists) db.seed('qaTestMode', 'config', config || defaultConfig());
  const userDocs = users === undefined ? defaultUsers() : users;
  Object.entries(userDocs).forEach(([uid, data]) => {
    db.seed('users', uid, data);
  });

  let currentNow = NOW;
  const audits = [];
  const deduped = [];
  const logger = { warn: jest.fn(), error: jest.fn() };
  const secret = {
    value() {
      if (secretMode === 'throw') throw boom('secret missing');
      if (secretMode === 'empty') return '';
      if (secretMode === 'nonstring') return 12345;
      if (secretMode === 'null') return null;
      return secretText;
    },
  };
  const authAdmin = {
    createCustomToken: jest.fn(async () => {
      if (controls.failToken) throw boom('token sign');
      return TOKEN;
    }),
  };
  const handler = createIssueQaTestTokenHandler({
    HttpsError: FakeHttpsError,
    db,
    authAdmin,
    secret,
    writeAuditEntry: async (entry) => {
      if (controls.failSuccessAudit) throw boom('success audit');
      audits.push(clone(entry));
    },
    writeDedupedAuditEntry: async (entry, key) => {
      if (controls.failFailureAudit) throw boom('failure audit');
      deduped.push({ entry: clone(entry), key });
    },
    logger,
    now: () => currentNow,
  });

  return {
    handler,
    db,
    controls,
    logger,
    authAdmin,
    secret,
    audits,
    deduped,
    setNow(value) {
      currentNow = value;
    },
  };
}

function invoke(harness, data, rawRequest) {
  const request = { data };
  if (rawRequest !== false) {
    request.rawRequest = rawRequest === undefined ? defaultRawRequest() : rawRequest;
  }
  return harness.handler(request);
}

function throttleIds(harness) {
  return [...harness.db.docs.keys()]
    .filter((key) => key.startsWith('qaTestAuthThrottle/'))
    .map((key) => key.slice('qaTestAuthThrottle/'.length));
}

function expectBothThrottle(harness, expectedCount, ipHash = hashQaIp(CLIENT_IP)) {
  [`ip_${ipHash}`, 'global'].forEach((id) => {
    const doc = harness.db.read('qaTestAuthThrottle', id);
    expect(doc).toBeDefined();
    expect(doc.count).toBe(expectedCount);
    expect(doc.lockedUntilMs || 0).toBe(0);
    expect(doc.reservations).toEqual([]);
  });
}

// 測試同步更新：預占之後的 neutral 出口會留下節流文件，但不得累計失敗或留下 reservation。
function expectNeutralThrottle(harness) {
  const ids = throttleIds(harness);
  expect(ids.length).toBeGreaterThan(0);
  ids.forEach((id) => {
    const doc = harness.db.read('qaTestAuthThrottle', id);
    expect(doc.count).toBe(0);
    expect(doc.lockedUntilMs || 0).toBe(0);
    expect(doc.reservations).toEqual([]);
  });
}

// handler 同步呼叫 secret.value()，無法在 value() 裡面 await 還把字串交回去。
// barrier 掛在 secret.value() 回傳之後、settle 取得互斥鎖之前，停住已預占的請求。
async function burstWrongPasswords(harness, total, rawForIndex) {
  let arrived = 0;
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  let reservationsAtGate = null;
  const signal = () => {
    arrived += 1;
    if (arrived === total) {
      reservationsAtGate = throttleIds(harness).map((id) => {
        const doc = harness.db.read('qaTestAuthThrottle', id);
        return {
          id,
          count: doc.count,
          reservations: Array.isArray(doc.reservations) ? doc.reservations.length : -1,
        };
      });
      release();
    }
  };
  harness.controls.beforeTransaction = async (stack) => {
    if (stack.includes('settleAttempt')) await barrier;
  };
  let secretCalls = 0;
  const original = harness.secret.value.bind(harness.secret);
  harness.secret.value = () => {
    const store = requestStore.getStore();
    if (!store) throw new Error('secret.value outside request store');
    store.calledSecret = true;
    secretCalls += 1;
    signal();
    return original();
  };

  const codes = await Promise.all(Array.from({ length: total }, (_unused, index) => {
    const store = { calledSecret: false };
    return requestStore.run(store, async () => {
      try {
        await invoke(harness, { password: PASSWORDS.wrong }, rawForIndex(index));
        return 'ok';
      } catch (error) {
        if (error && typeof error.code === 'string') rejectionCodes.push(error.code);
        return error && error.code;
      } finally {
        if (!store.calledSecret) signal();
      }
    });
  }));
  return { secretCalls, codes, reservationsAtGate };
}

async function expectDenied(promise, {
  code,
  reasonCode,
  harness,
  tokenCalls = 0,
  ipHash = hashQaIp(CLIENT_IP),
  extraMeta,
  absentMetaKeys = [],
  expectAudit = true,
}) {
  const tokensBefore = harness.authAdmin.createCustomToken.mock.calls.length;
  let caught;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(FakeHttpsError);
  expect(caught.code).toBe(code);
  expect(caught.message).toBe(PUBLIC_MESSAGE);
  rejectionCodes.push(caught.code);
  expectNoSecrets(`${caught.message}\n${JSON.stringify(caught)}`);
  expect(harness.authAdmin.createCustomToken).toHaveBeenCalledTimes(tokensBefore + tokenCalls);
  expect(harness.audits).toHaveLength(0);
  expectNoSecrets(JSON.stringify(harness.logger.warn.mock.calls));
  expectNoSecrets(JSON.stringify(harness.logger.error.mock.calls));

  if (expectAudit) {
    const recorded = harness.deduped[harness.deduped.length - 1];
    expect(recorded.entry).toMatchObject({
      action: 'login_failure',
      actorRole: 'user',
      targetType: 'system',
      targetLabel: 'QA login',
      result: 'failure',
      source: 'cloud_function',
    });
    expect(recorded.entry.actorUid).toBeUndefined();
    expect(recorded.entry.meta.reasonCode).toBe(reasonCode);
    expect(recorded.entry.meta.ipHash).toBe(ipHash);
    expect(recorded.key).toBe(`qa_${reasonCode}_${ipHash || 'noip'}`);
    if (extraMeta) expect(recorded.entry.meta).toMatchObject(extraMeta);
    absentMetaKeys.forEach((key) => {
      expect(recorded.entry.meta[key]).toBeUndefined();
    });
    expectNoSecrets(JSON.stringify(recorded));
  } else {
    expect(harness.logger.warn).toHaveBeenCalledWith(
      '[issueQaTestToken] denied',
      expect.objectContaining({ reasonCode, ipHash }),
    );
  }
  return caught;
}

function expectIssued(harness, result, {
  qaExp,
  uid = PLAYER_UID,
  persona = 'player',
  role = 'user',
  displayName = 'QA測試-球員A',
  teamId = 'team-alpha',
  agentId = 'qa01',
} = {}) {
  expect(result).toEqual({
    customToken: TOKEN,
    agentId,
    persona: { key: persona, displayName, role },
    qaExp,
  });
  expect(harness.authAdmin.createCustomToken).toHaveBeenCalledTimes(1);
  const call = harness.authAdmin.createCustomToken.mock.calls[0];
  expect(call).toHaveLength(2);
  const [issuedUid, claims] = call;
  expect(issuedUid).toBe(uid);
  expect(Object.keys(claims).sort()).toEqual(['qa', 'qaAgent', 'qaExp', 'qaPersona', 'qaTeamId']);
  expect(claims).toEqual({
    qa: true,
    qaTeamId: teamId,
    qaExp,
    qaAgent: agentId,
    qaPersona: persona,
  });
  expect(claims).not.toHaveProperty('role');
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function extractBraced(source, startNeedle) {
  const start = source.indexOf(startNeedle);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(brace, index + 1);
    }
  }
  throw new Error(`找不到 ${startNeedle} 的物件結尾`);
}

describe('QA 測試模式', () => {
  test('對外錯誤訊息常數是統一文字', () => {
    expect(QA_PUBLIC_ERROR_MESSAGE).toBe(PUBLIC_MESSAGE);
    expect(QA_UID_RE.test(PLAYER_UID)).toBe(true);
    expect(QA_UID_RE.test(REAL_UID)).toBe(false);
  });

  describe('parseQaSecret', () => {
    test('解析單筆、混用換行與分號的多筆、persona 去重並忽略空白行', () => {
      const single = parseQaSecret(secretLine('qa01', PASSWORDS.alpha, FUTURE), {
        nowMs: NOW,
        maxFutureHours: 168,
      });
      expect(single).toEqual({
        entries: [{
          agentId: 'qa01',
          password: PASSWORDS.alpha,
          expiresAtMs: FUTURE,
          allowedPersonas: null,
        }],
        invalidCount: 0,
      });

      const offset = '2026-10-25T08:00:00+08:00';
      const text = [
        secretLine('qa01', PASSWORDS.alpha, FUTURE, 'player,player,coach'),
        '',
        secretLine('qa02', PASSWORDS.beta, FUTURE),
      ].join('\r\n') + `; \nqa03:${PASSWORDS.gamma}|${offset}`;
      const parsed = parseQaSecret(text, { nowMs: NOW, maxFutureHours: 168 });

      expect(parsed.invalidCount).toBe(0);
      expect(parsed.entries).toEqual([
        {
          agentId: 'qa01',
          password: PASSWORDS.alpha,
          expiresAtMs: FUTURE,
          allowedPersonas: ['player', 'coach'],
        },
        {
          agentId: 'qa02',
          password: PASSWORDS.beta,
          expiresAtMs: FUTURE,
          allowedPersonas: null,
        },
        {
          agentId: 'qa03',
          password: PASSWORDS.gamma,
          expiresAtMs: Date.parse(offset),
          allowedPersonas: null,
        },
      ]);
    });

    test.each([
      ['缺時區的 ISO', `qa01:${PASSWORDS.alpha}|2026-10-25T00:00:00`],
      ['欄數只有 1', `qa01:${PASSWORDS.alpha}`],
      ['欄數有 4', `qa01:${PASSWORDS.alpha}|${new Date(FUTURE).toISOString()}|player|extra`],
      ['密碼只有 5 字', `qa01:${'x'.repeat(5)}|${new Date(FUTURE).toISOString()}`],
      ['密碼有 65 字', `qa01:${'y'.repeat(65)}|${new Date(FUTURE).toISOString()}`],
      ['密碼含空白', `qa01:Fake Pw Alpha|${new Date(FUTURE).toISOString()}`],
      ['密碼含直線', `qa01:Fake|Pw-Alpha-001|${new Date(FUTURE).toISOString()}`],
      ['專員代號含大寫', `QA01:${PASSWORDS.alpha}|${new Date(FUTURE).toISOString()}`],
      ['專員代號超過 24 字', `${'a'.repeat(25)}:${PASSWORDS.alpha}|${new Date(FUTURE).toISOString()}`],
      ['persona 含非法 key', `qa01:${PASSWORDS.alpha}|${new Date(FUTURE).toISOString()}|bad.key`],
      ['persona 清單含空字串', `qa01:${PASSWORDS.alpha}|${new Date(FUTURE).toISOString()}|player,`],
    ])('%s 只讓該筆無效', (_label, badLine) => {
      const text = `${badLine}\n${secretLine('qaok', PASSWORDS.beta, FUTURE)}`;
      const parsed = parseQaSecret(text, { nowMs: NOW, maxFutureHours: 168 });
      expect(parsed.invalidCount).toBe(1);
      expect(parsed.entries.map((entry) => entry.agentId)).toEqual(['qaok']);
    });

    test('兩筆密碼相同時兩筆都無效，其他密碼仍有效', () => {
      const text = [
        secretLine('qa01', PASSWORDS.alpha, FUTURE),
        secretLine('qa02', PASSWORDS.alpha, FUTURE),
        secretLine('qa03', PASSWORDS.beta, FUTURE),
      ].join(';');
      const parsed = parseQaSecret(text, { nowMs: NOW, maxFutureHours: 168 });
      expect(parsed.invalidCount).toBe(2);
      expect(parsed.entries.map((entry) => entry.agentId)).toEqual(['qa03']);
    });

    test('專員代號重複時後者無效、先者有效', () => {
      const text = [
        secretLine('qa01', PASSWORDS.alpha, FUTURE),
        secretLine('qa01', PASSWORDS.beta, FUTURE + HOUR_MS),
      ].join('\n');
      const parsed = parseQaSecret(text, { nowMs: NOW, maxFutureHours: 168 });
      expect(parsed.invalidCount).toBe(1);
      expect(parsed.entries).toEqual([{
        agentId: 'qa01',
        password: PASSWORDS.alpha,
        expiresAtMs: FUTURE,
        allowedPersonas: null,
      }]);
    });

    test('超過 maxFutureHours 的到期無效，已過期與剛好等於現在的筆仍有效', () => {
      const tooFar = secretLine('qa01', PASSWORDS.alpha, NOW + 25 * HOUR_MS);
      const within = secretLine('qa02', PASSWORDS.beta, NOW + 23 * HOUR_MS);
      const parsed = parseQaSecret(`${tooFar}\n${within}`, { nowMs: NOW, maxFutureHours: 24 });
      expect(parsed.invalidCount).toBe(1);
      expect(parsed.entries.map((entry) => entry.agentId)).toEqual(['qa02']);

      const exactLimit = parseQaSecret(
        secretLine('qa01', PASSWORDS.alpha, NOW + 24 * HOUR_MS),
        { nowMs: NOW, maxFutureHours: 24 },
      );
      expect(exactLimit.invalidCount).toBe(0);
      expect(exactLimit.entries[0].expiresAtMs - NOW).toBe(24 * HOUR_MS);

      const past = parseQaSecret(secretLine('qa01', PASSWORDS.alpha, NOW - HOUR_MS), {
        nowMs: NOW,
        maxFutureHours: 168,
      });
      expect(past.entries[0].expiresAtMs).toBe(NOW - HOUR_MS);
      expect(past.invalidCount).toBe(0);

      const equalNow = parseQaSecret(secretLine('qa01', PASSWORDS.alpha, NOW), {
        nowMs: NOW,
        maxFutureHours: 168,
      });
      expect(equalNow.entries[0].expiresAtMs).toBe(NOW);
      expect(equalNow.entries[0].expiresAtMs <= NOW).toBe(true);
    });

    test('非字串、空字串與全部無效都回空 entries，密碼可含冒號', () => {
      [undefined, null, 0, 1, true, {}, [], '' , '  \n\t'].forEach((value) => {
        expect(parseQaSecret(value, { nowMs: NOW, maxFutureHours: 168 })).toEqual({
          entries: [],
          invalidCount: 0,
        });
      });

      const allBad = parseQaSecret('not-a-secret\nQA01:also-bad', {
        nowMs: NOW,
        maxFutureHours: 168,
      });
      expect(allBad.entries).toEqual([]);
      expect(allBad.invalidCount).toBe(2);

      const withColon = parseQaSecret(secretLine('qa01', PASSWORDS.colon, FUTURE), {
        nowMs: NOW,
        maxFutureHours: 168,
      });
      expect(withColon.entries[0]).toMatchObject({
        agentId: 'qa01',
        password: PASSWORDS.colon,
      });
    });

    test.each([
      ['2026-02-30T00:00:00Z'],
      ['2026-10-24T24:00:00Z'],
      ['2026-13-01T00:00:00Z'],
      ['2026-10-24T10:00:60Z'],
      ['2026-10-24T10:00:00+24:00'],
    ])('%s 是無效條目', (expiry) => {
      const parsed = parseQaSecret(`qa01:${PASSWORDS.alpha}|${expiry}`, {
        nowMs: NOW,
        maxFutureHours: 168,
      });
      expect(parsed.entries).toEqual([]);
      expect(parsed.invalidCount).toBe(1);
    });

    test('2028-02-29 閏日在預設 maxFutureHours 內有效', () => {
      const leapNow = Date.parse('2028-02-28T00:00:00Z');
      const parsed = parseQaSecret(`qa01:${PASSWORDS.alpha}|2028-02-29T12:00:00Z`, {
        nowMs: leapNow,
      });
      expect(parsed.invalidCount).toBe(0);
      expect(parsed.entries).toEqual([{
        agentId: 'qa01',
        password: PASSWORDS.alpha,
        expiresAtMs: Date.parse('2028-02-29T12:00:00Z'),
        allowedPersonas: null,
      }]);
    });
  });

  describe('matchQaPassword', () => {
    const entries = [
      { agentId: 'qa01', password: PASSWORDS.alpha, expiresAtMs: FUTURE, allowedPersonas: null },
      { agentId: 'qa02', password: PASSWORDS.beta, expiresAtMs: FUTURE, allowedPersonas: null },
      { agentId: 'qa03', password: PASSWORDS.gamma, expiresAtMs: FUTURE, allowedPersonas: null },
    ];

    test('命中回傳該筆，沒命中或 entries 為空回 null', () => {
      expect(matchQaPassword(entries, PASSWORDS.beta)).toBe(entries[1]);
      expect(matchQaPassword(entries, PASSWORDS.wrong)).toBeNull();
      expect(matchQaPassword([], PASSWORDS.alpha)).toBeNull();
    });

    test('第一筆已經命中時 timingSafeEqual 仍被呼叫 3 次', () => {
      const spy = jest.spyOn(crypto, 'timingSafeEqual');
      try {
        const matched = matchQaPassword(entries, PASSWORDS.alpha);
        expect(matched).toBe(entries[0]);
        expect(spy).toHaveBeenCalledTimes(3);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('normalizeQaConfig', () => {
    test.each([
      ['null', null],
      ['空物件', {}],
      ['enabled 為字串 true', { enabled: 'true' }],
      ['enabled 為數字 1', { enabled: 1 }],
    ])('%s 時關閉', (_label, raw) => {
      expect(normalizeQaConfig(raw).enabled).toBe(false);
    });

    test('只有 enabled 嚴格為 true 才開啟', () => {
      expect(normalizeQaConfig({ enabled: true }).enabled).toBe(true);
      expect(normalizeQaConfig({ enabled: false }).enabled).toBe(false);
    });

    test('數值超出範圍或型別錯誤時回預設，範圍內的值保留', () => {
      expect(normalizeQaConfig({
        enabled: true,
        sessionCapHours: '12',
        maxFutureHours: 721,
        throttle: {
          perIp: { maxFailures: 1.5, windowSec: '600', lockSec: 0 },
          global: { maxFailures: 1001, windowSec: 86401, lockSec: null },
        },
      })).toMatchObject({
        sessionCapHours: 12,
        maxFutureHours: 168,
        throttle: {
          perIp: { maxFailures: 5, windowSec: 600, lockSec: 900 },
          global: { maxFailures: 100, windowSec: 600, lockSec: 300 },
        },
      });

      const kept = normalizeQaConfig({
        enabled: true,
        sessionCapHours: 720,
        maxFutureHours: 1,
        throttle: {
          perIp: { maxFailures: 1000, windowSec: 1, lockSec: 86400 },
          global: { maxFailures: 1, windowSec: 86400, lockSec: 1 },
        },
      });
      expect(kept.sessionCapHours).toBe(720);
      expect(kept.maxFutureHours).toBe(1);
      expect(kept.throttle.perIp).toEqual({ maxFailures: 1000, windowSec: 1, lockSec: 86400 });
      expect(kept.throttle.global).toEqual({ maxFailures: 1, windowSec: 86400, lockSec: 1 });
    });

    test('非法 persona 與缺 teamId 的 team 丟棄，停用 persona 保留', () => {
      const normalized = normalizeQaConfig({
        enabled: true,
        personas: {
          player: {
            uid: PLAYER_UID,
            displayName: 'QA測試-球員A',
            role: 'user',
            teamKey: 'alpha',
            enabled: true,
          },
          coach: {
            uid: COACH_UID,
            displayName: 'QA測試-教練B',
            role: 'coach',
            teamKey: 'alpha',
          },
          captain: {
            uid: CAPTAIN_UID,
            displayName: 'QA測試-隊長C',
            role: 'captain',
            teamKey: 'alpha',
            enabled: true,
          },
          paused: {
            uid: qaUid(4),
            displayName: 'QA測試-暫停D',
            role: 'user',
            teamKey: 'alpha',
            enabled: false,
          },
          realPerson: {
            uid: REAL_UID,
            displayName: 'QA測試-真人',
            role: 'user',
            teamKey: 'alpha',
            enabled: true,
          },
          admin: {
            uid: qaUid(5),
            displayName: 'QA測試-管理',
            role: 'admin',
            teamKey: 'alpha',
            enabled: true,
          },
          superAdmin: {
            uid: qaUid(6),
            displayName: 'QA測試-超管',
            role: 'super_admin',
            teamKey: 'alpha',
            enabled: true,
          },
          owner: {
            uid: qaUid(7),
            displayName: 'QA測試-場館',
            role: 'venue_owner',
            teamKey: 'alpha',
            enabled: true,
          },
          badName: {
            uid: qaUid(8),
            displayName: '沒有前綴',
            role: 'user',
            teamKey: 'alpha',
            enabled: true,
          },
          noTeam: {
            uid: qaUid(9),
            displayName: 'QA測試-無隊',
            role: 'user',
            enabled: true,
          },
          blankTeam: {
            uid: qaUid(10),
            displayName: 'QA測試-空隊',
            role: 'user',
            teamKey: '   ',
            enabled: true,
          },
        },
        teams: {
          alpha: { teamId: 'team-alpha', name: 'QA Alpha' },
          missing: { name: '沒有 teamId' },
          blank: { teamId: '   ', name: '空白 teamId' },
          tooLong: { teamId: 't'.repeat(121), name: '過長' },
          boundary: { teamId: 't'.repeat(120), name: '邊界' },
        },
      });

      expect(Object.keys(normalized.personas).sort()).toEqual(['captain', 'coach', 'paused', 'player']);
      expect(normalized.personas.paused.enabled).toBe(false);
      expect(normalized.personas.player.enabled).toBe(true);
      expect(normalized.personas.coach.enabled).toBe(true);
      expect(Object.keys(normalized.teams).sort()).toEqual(['alpha', 'boundary']);
      expect(normalized.teams.boundary.teamId).toHaveLength(120);
    });

    test('clientIpXffFromRight 只接受 1 到 5 的整數', () => {
      expect(normalizeQaConfig({ clientIpXffFromRight: 0 }).clientIpXffFromRight).toBe(1);
      expect(normalizeQaConfig({ clientIpXffFromRight: 6 }).clientIpXffFromRight).toBe(1);
      expect(normalizeQaConfig({ clientIpXffFromRight: '2' }).clientIpXffFromRight).toBe(1);
      expect(normalizeQaConfig({ clientIpXffFromRight: 1.5 }).clientIpXffFromRight).toBe(1);
      expect(normalizeQaConfig({ clientIpXffFromRight: 2 }).clientIpXffFromRight).toBe(2);
      expect(normalizeQaConfig({}).clientIpXffFromRight).toBe(1);
    });
  });

  describe('客戶端 IP', () => {
    test('x-forwarded-for 取最右段，不取第一段偽造值', () => {
      expect(resolveQaClientIp({
        headers: { 'x-forwarded-for': `${FORGED_IP}, ${CLIENT_IP}` },
        ip: FALLBACK_IP,
      })).toBe(CLIENT_IP);
    });

    test('只有一段時取該段', () => {
      expect(resolveQaClientIp({
        headers: { 'x-forwarded-for': CLIENT_IP },
        ip: FALLBACK_IP,
      })).toBe(CLIENT_IP);
    });

    test.each([
      ['header 缺漏', { ip: FALLBACK_IP }],
      ['段數不足', { headers: { 'x-forwarded-for': ',' }, ip: FALLBACK_IP }],
      ['格式不符', { headers: { 'x-forwarded-for': 'not-an-ip' }, ip: FALLBACK_IP }],
    ])('%s 時退回 rawRequest.ip', (_label, rawRequest) => {
      expect(resolveQaClientIp(rawRequest)).toBe(FALLBACK_IP);
    });

    test('header 與 rawRequest.ip 都不可用時回空字串', () => {
      expect(resolveQaClientIp(undefined)).toBe('');
      expect(resolveQaClientIp({})).toBe('');
      expect(resolveQaClientIp({
        headers: { 'x-forwarded-for': 'not-an-ip' },
        ip: 'not-an-ip',
      })).toBe('');
    });

    test('IPv6 可通過', () => {
      expect(resolveQaClientIp({
        headers: { 'x-forwarded-for': '2001:db8::1' },
        ip: FALLBACK_IP,
      })).toBe('2001:db8::1');
      expect(resolveQaClientIp({
        headers: { 'x-forwarded-for': 'not-an-ip' },
        ip: '2001:db8::2',
      })).toBe('2001:db8::2');
    });

    test('hashQaIp 空字串為空，非空為 16 位十六進位且不含原 IP', () => {
      expect(hashQaIp('')).toBe('');
      const first = hashQaIp(CLIENT_IP);
      const second = hashQaIp('203.0.113.10');
      const independent = crypto.createHash('sha256').update(CLIENT_IP, 'utf8').digest('hex').slice(0, 16);
      expect(first).toBe(independent);
      expect(first).toMatch(/^[0-9a-f]{16}$/);
      expect(first).toBe(hashQaIp(CLIENT_IP));
      expect(first).not.toBe(second);
      expect(first).not.toContain(CLIENT_IP);
      expect(second).not.toContain('203.0.113.10');
    });

    test('四種 IPv4-mapped 表示得到同一個 hash', () => {
      const forms = [
        '192.0.2.1',
        '::ffff:192.0.2.1',
        '0:0:0:0:0:ffff:192.0.2.1',
        '::FFFF:c000:201',
      ];
      const resolved = forms.map((form) => resolveQaClientIp({
        headers: { 'x-forwarded-for': form },
        ip: FALLBACK_IP,
      }));
      expect(resolved).toEqual(['192.0.2.1', '192.0.2.1', '192.0.2.1', '192.0.2.1']);
      const hashes = resolved.map((ip) => hashQaIp(ip));
      expect(new Set(hashes).size).toBe(1);
      expect(hashes[0]).toBe(hashQaIp('192.0.2.1'));
    });

    test('XFF 長度 2100 時忽略 header 改走 rawRequest.ip', () => {
      const header = `${'x'.repeat(2090)},192.0.2.1`;
      expect(header).toHaveLength(2100);
      const resolved = resolveQaClientIp({
        headers: { 'x-forwarded-for': header },
        ip: FALLBACK_IP,
      });
      expect(resolved).toBe(FALLBACK_IP);
      expect(hashQaIp(resolved)).toBe(hashQaIp(FALLBACK_IP));
      expect(hashQaIp(resolved)).not.toBe(hashQaIp('192.0.2.1'));
    });

    test('xffFromRight 為 2 時取由右數第 2 段', () => {
      expect(resolveQaClientIp({
        headers: { 'x-forwarded-for': `${FORGED_IP}, ${CLIENT_IP}, ${FALLBACK_IP}` },
        ip: '203.0.113.77',
      }, { xffFromRight: 2 })).toBe(CLIENT_IP);
    });

    test('xffFromRight 段數不足時退回 rawRequest.ip', () => {
      expect(resolveQaClientIp({
        headers: { 'x-forwarded-for': CLIENT_IP },
        ip: FALLBACK_IP,
      }, { xffFromRight: 2 })).toBe(FALLBACK_IP);
    });

    test('含 %eth0 區域 ID 的 IPv6 不被接受', () => {
      expect(resolveQaClientIp({
        headers: { 'x-forwarded-for': 'fe80::1%eth0' },
        ip: FALLBACK_IP,
      })).toBe(FALLBACK_IP);
      expect(resolveQaClientIp({
        headers: { 'x-forwarded-for': 'fe80::1%eth0' },
        ip: 'not-an-ip',
      })).toBe('');
    });
  });

  describe('resolveQaPersona', () => {
    function configOf(personas, teams) {
      return normalizeQaConfig({
        enabled: true,
        personas,
        teams: teams || { alpha: { teamId: 'team-alpha', name: 'QA Alpha' } },
      });
    }

    const player = {
      uid: PLAYER_UID,
      displayName: 'QA測試-球員A',
      role: 'user',
      teamKey: 'alpha',
      enabled: true,
    };
    const coach = {
      uid: COACH_UID,
      displayName: 'QA測試-教練B',
      role: 'coach',
      teamKey: 'alpha',
      enabled: true,
    };
    const paused = { ...player, uid: qaUid(4), displayName: 'QA測試-暫停D', enabled: false };

    test('指定 persona 且在允許清單內時成功', () => {
      const config = configOf({ player, coach });
      const explicit = resolveQaPersona({
        config,
        agent: { allowedPersonas: ['player'] },
        requestedPersona: 'player',
      });
      expect(explicit.ok).toBe(true);
      expect(explicit.personaKey).toBe('player');
      expect(explicit.teamId).toBe('team-alpha');
      expect(explicit.persona.uid).toBe(PLAYER_UID);

      const allEnabled = resolveQaPersona({
        config,
        agent: { allowedPersonas: null },
        requestedPersona: 'coach',
      });
      expect(allEnabled).toMatchObject({ ok: true, personaKey: 'coach', teamId: 'team-alpha' });
    });

    test('persona 不在設定或已停用時為 qa_persona_unknown', () => {
      const config = configOf({ player, paused });
      expect(resolveQaPersona({
        config,
        agent: { allowedPersonas: null },
        requestedPersona: 'missing',
      })).toEqual({ ok: false, reasonCode: 'qa_persona_unknown' });
      expect(resolveQaPersona({
        config,
        agent: { allowedPersonas: null },
        requestedPersona: 'paused',
      })).toEqual({ ok: false, reasonCode: 'qa_persona_unknown' });
    });

    test('在設定中但不在專員第三欄時為 qa_persona_not_allowed', () => {
      const config = configOf({ player, coach });
      expect(resolveQaPersona({
        config,
        agent: { allowedPersonas: ['coach'] },
        requestedPersona: 'player',
      })).toEqual({ ok: false, reasonCode: 'qa_persona_not_allowed' });
    });

    test('未指定 persona 時，可用恰一筆就用它，零筆或兩筆以上不允許', () => {
      const one = resolveQaPersona({
        config: configOf({ player, paused }),
        agent: { allowedPersonas: null },
      });
      expect(one).toMatchObject({ ok: true, personaKey: 'player', teamId: 'team-alpha' });

      expect(resolveQaPersona({
        config: configOf({ paused }),
        agent: { allowedPersonas: null },
      })).toEqual({ ok: false, reasonCode: 'qa_persona_not_allowed' });

      expect(resolveQaPersona({
        config: configOf({ player, coach }),
        agent: { allowedPersonas: null },
      })).toEqual({ ok: false, reasonCode: 'qa_persona_not_allowed' });
    });

    test('team 不存在時為 qa_persona_unprovisioned', () => {
      const config = configOf(
        { player: { ...player, teamKey: 'ghost' } },
        { alpha: { teamId: 'team-alpha', name: 'QA Alpha' } },
      );
      expect(resolveQaPersona({
        config,
        agent: { allowedPersonas: null },
        requestedPersona: 'player',
      })).toEqual({ ok: false, reasonCode: 'qa_persona_unprovisioned' });
    });
  });

  describe('handler 成功路徑', () => {
    test('正確密碼與 persona 簽發五個 claim 且沒有 role', async () => {
      const harness = createHarness();
      const qaExp = NOW + 12 * HOUR_MS;
      const result = await invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      });

      expectIssued(harness, result, { qaExp });
      expect(result.qaExp).toBeLessThan(FUTURE);
    });

    test('夾帶 uid、role 與 claims 不影響簽發內容', async () => {
      const harness = createHarness();
      const result = await invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
        uid: REAL_UID,
        role: 'super_admin',
        claims: { role: 'super_admin', admin: true },
      });

      expectIssued(harness, result, { qaExp: NOW + 12 * HOUR_MS });
      expect(harness.authAdmin.createCustomToken.mock.calls[0][0]).not.toBe(REAL_UID);
    });

    test('專員到期較早時 qaExp 用專員到期', async () => {
      const expiresAtMs = NOW + 2 * HOUR_MS;
      expect(Date.parse(new Date(expiresAtMs).toISOString())).toBe(expiresAtMs);
      const harness = createHarness({
        secretText: secretLine('qa01', PASSWORDS.alpha, expiresAtMs),
      });
      const result = await invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      });
      expect(result.qaExp).toBe(expiresAtMs);
      expect(harness.authAdmin.createCustomToken.mock.calls[0][1].qaExp).toBe(expiresAtMs);
    });

    test('12 小時上限較早時 qaExp 用現在加 sessionCapHours', async () => {
      const expiresAtMs = NOW + 48 * HOUR_MS;
      const harness = createHarness({
        secretText: secretLine('qa01', PASSWORDS.alpha, expiresAtMs),
        config: defaultConfig({ sessionCapHours: 12 }),
      });
      const result = await invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      });
      const cap = NOW + 12 * HOUR_MS;
      expect(result.qaExp).toBe(cap);
      expect(cap).toBeLessThan(expiresAtMs);
    });

    test('成功稽核恰一次，序列化後不含密碼、完整 IP 與 customToken', async () => {
      const harness = createHarness();
      await invoke(harness, { password: PASSWORDS.alpha, persona: 'player' });

      expect(harness.audits).toHaveLength(1);
      expect(harness.deduped).toHaveLength(0);
      expect(harness.audits[0]).toEqual({
        action: 'login_success',
        actorUid: PLAYER_UID,
        actorName: 'QA測試-球員A',
        actorRole: 'user',
        targetType: 'system',
        targetLabel: 'QA login',
        result: 'success',
        source: 'cloud_function',
        meta: {
          reasonCode: 'qa_success',
          qaAgentId: 'qa01',
          qaPersona: 'player',
          ipHash: hashQaIp(CLIENT_IP),
        },
      });
      expect(harness.audits[0].meta.ipHash).not.toBe(hashQaIp(FORGED_IP));
      expectNoSecrets(JSON.stringify(harness.audits));
      expectNoSecrets(JSON.stringify(harness.logger.warn.mock.calls));
    });

    test('成功後保留 IP 與全域節流計數，只清掉自己的 reservation', async () => {
      // 測試同步更新：成功登入不再刪除 IP 節流文件，也不把 count 歸零。
      const harness = createHarness();
      const ipHash = hashQaIp(CLIENT_IP);
      harness.db.seed('qaTestAuthThrottle', `ip_${ipHash}`, {
        count: 2,
        windowStartMs: NOW,
        lockedUntilMs: 0,
      });
      harness.db.seed('qaTestAuthThrottle', 'global', {
        count: 7,
        windowStartMs: NOW,
        lockedUntilMs: 0,
      });

      await invoke(harness, { password: PASSWORDS.alpha, persona: 'player' });

      expect(harness.db.read('qaTestAuthThrottle', `ip_${ipHash}`)).toMatchObject({
        count: 2,
        windowStartMs: NOW,
        lockedUntilMs: 0,
        reservations: [],
      });
      expect(harness.db.read('qaTestAuthThrottle', 'global')).toMatchObject({
        count: 7,
        windowStartMs: NOW,
        lockedUntilMs: 0,
        reservations: [],
      });
    });
  });

  describe('handler 拒絕路徑', () => {
    test('密碼錯誤為 permission-denied，IP 與全域 count 都為 1', async () => {
      const harness = createHarness();
      await expectDenied(invoke(harness, { password: PASSWORDS.wrong }), {
        code: 'permission-denied',
        reasonCode: 'qa_password_mismatch',
        harness,
        absentMetaKeys: ['qaAgentId', 'qaPersona'],
      });
      const ipHash = hashQaIp(CLIENT_IP);
      expect(harness.db.read('qaTestAuthThrottle', `ip_${ipHash}`).count).toBe(1);
      expect(harness.db.read('qaTestAuthThrottle', 'global').count).toBe(1);
      expect(harness.db.read('qaTestAuthThrottle', `ip_${ipHash}`).lockedUntilMs > NOW).toBe(false);
    });

    test('密碼正確但已到期為 qa_password_expired，meta 帶 qaAgentId 並計節流', async () => {
      const harness = createHarness({
        secretText: secretLine('qa01', PASSWORDS.alpha, NOW),
      });
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }), {
        code: 'permission-denied',
        reasonCode: 'qa_password_expired',
        harness,
        extraMeta: { qaAgentId: 'qa01', qaPersona: 'player' },
      });
      expect(harness.db.read('qaTestAuthThrottle', `ip_${hashQaIp(CLIENT_IP)}`).count).toBe(1);
      expect(harness.db.read('qaTestAuthThrottle', 'global').count).toBe(1);
    });

    test.each([
      ['enabled 缺漏', () => {
        const config = defaultConfig();
        delete config.enabled;
        return { config };
      }],
      ['enabled 為 false', () => ({ config: defaultConfig({ enabled: false }) })],
      ['config 文件不存在', () => ({ configExists: false })],
    ])('%s 時為 qa_disabled 且不計節流', async (_label, build) => {
      const harness = createHarness(build());
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }), {
        code: 'permission-denied',
        reasonCode: 'qa_disabled',
        harness,
      });
      expect(throttleIds(harness)).toEqual([]);
    });

    test.each([
      ['value 丟錯', { secretMode: 'throw' }],
      ['value 回空字串', { secretMode: 'empty' }],
      ['value 回數字', { secretMode: 'nonstring' }],
      ['value 回 null', { secretMode: 'null' }],
      ['全部條目格式錯誤', { secretText: `qa01:${PASSWORDS.alpha}` }],
    ])('Secret %s 時為 qa_secret_invalid 且不計節流', async (_label, options) => {
      const harness = createHarness(options);
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }), {
        code: 'permission-denied',
        reasonCode: 'qa_secret_invalid',
        harness,
      });
      // 測試同步更新：Secret 無效發生在預占之後，文件留著但 count 為 0。
      expectNeutralThrottle(harness);
    });

    test('persona 不在設定時為 qa_persona_unknown 並計節流', async () => {
      const harness = createHarness();
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'not-there',
      }), {
        code: 'permission-denied',
        reasonCode: 'qa_persona_unknown',
        harness,
        extraMeta: { qaAgentId: 'qa01', qaPersona: 'not-there' },
      });
      expect(harness.db.read('qaTestAuthThrottle', `ip_${hashQaIp(CLIENT_IP)}`).count).toBe(1);
      expect(harness.db.read('qaTestAuthThrottle', 'global').count).toBe(1);
    });

    test('persona 不在專員第三欄時為 qa_persona_not_allowed 並計節流', async () => {
      const harness = createHarness({
        secretText: secretLine('qa01', PASSWORDS.alpha, FUTURE, 'coach'),
      });
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }), {
        code: 'permission-denied',
        reasonCode: 'qa_persona_not_allowed',
        harness,
        extraMeta: { qaAgentId: 'qa01', qaPersona: 'player' },
      });
      expect(harness.db.read('qaTestAuthThrottle', `ip_${hashQaIp(CLIENT_IP)}`).count).toBe(1);
      expect(harness.db.read('qaTestAuthThrottle', 'global').count).toBe(1);
    });

    test('停用的 persona 視為 unknown 並計節流', async () => {
      const config = defaultConfig();
      config.personas.player = { ...config.personas.player, enabled: false };
      const harness = createHarness({
        config,
        secretText: secretLine('qa01', PASSWORDS.alpha, FUTURE, 'coach'),
      });
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }), {
        code: 'permission-denied',
        reasonCode: 'qa_persona_unknown',
        harness,
      });
      expect(harness.db.read('qaTestAuthThrottle', 'global').count).toBe(1);
    });

    test.each([
      ['真人格式 UID', {
        intruder: {
          uid: REAL_UID,
          displayName: 'QA測試-真人',
          role: 'user',
          teamKey: 'alpha',
          enabled: true,
        },
      }, 'intruder'],
      ['role 為 admin', {
        boss: {
          uid: qaUid(8),
          displayName: 'QA測試-管理',
          role: 'admin',
          teamKey: 'alpha',
          enabled: true,
        },
      }, 'boss'],
    ])('persona 設定為%s 時被丟棄並回 qa_persona_unknown', async (_label, personas, persona) => {
      const harness = createHarness({
        config: defaultConfig({ personas }),
      });
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona,
      }), {
        code: 'permission-denied',
        reasonCode: 'qa_persona_unknown',
        harness,
        extraMeta: { qaPersona: persona },
      });
      expect(harness.authAdmin.createCustomToken).not.toHaveBeenCalled();
    });

    test('team 不存在時為 qa_persona_unprovisioned 且不計節流、不簽 token', async () => {
      const harness = createHarness({
        config: defaultConfig({
          personas: {
            player: {
              uid: PLAYER_UID,
              displayName: 'QA測試-球員A',
              role: 'user',
              teamKey: 'ghost',
              enabled: true,
            },
          },
        }),
      });
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }), {
        code: 'permission-denied',
        reasonCode: 'qa_persona_unprovisioned',
        harness,
      });
      // 測試同步更新：team 缺失是預占後的 neutral，不再要求完全沒有節流文件。
      expectNeutralThrottle(harness);
    });

    test.each([
      ['文件不存在', {}],
      ['uid 欄位不符', {
        [PLAYER_UID]: { uid: qaUid(99), displayName: 'QA測試-球員A', role: 'user' },
      }],
      ['displayName 被改掉前綴', {
        [PLAYER_UID]: { uid: PLAYER_UID, displayName: '已改名的人', role: 'user' },
      }],
      ['role 與設定不一致', {
        [PLAYER_UID]: { uid: PLAYER_UID, displayName: 'QA測試-球員A', role: 'captain' },
      }],
    ])('users %s 時為 qa_persona_unprovisioned，不計節流也不簽 token', async (_label, users) => {
      const harness = createHarness({ users });
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }), {
        code: 'permission-denied',
        reasonCode: 'qa_persona_unprovisioned',
        harness,
      });
      // 測試同步更新：users 不符是預占後的 neutral，count 維持 0 且 reservations 清空。
      expectNeutralThrottle(harness);
    });

    test.each([
      ['password 不是字串', { password: 12345, persona: 'player' }],
      ['password 為 null', { password: null, persona: 'player' }],
      ['password 空字串', { password: '', persona: 'player' }],
      ['password 超過 128', { password: 'p'.repeat(129), persona: 'player' }],
      ['persona 型別錯誤', { password: PASSWORDS.alpha, persona: 1 }],
      ['persona 含非法字元', { password: PASSWORDS.alpha, persona: 'bad key' }],
      ['persona 空字串', { password: PASSWORDS.alpha, persona: '' }],
      ['data 為 null', null],
      ['data 為陣列', ['password']],
      ['data 為字串', 'password'],
    ])('%s 時為 invalid-argument 且不計節流', async (_label, data) => {
      // 測試同步更新：bad request 在預占前已用預設跳數算出 ipHash，且完全沒有節流文件。
      const harness = createHarness();
      await expectDenied(invoke(harness, data), {
        code: 'invalid-argument',
        reasonCode: 'qa_bad_request',
        harness,
        ipHash: hashQaIp(CLIENT_IP),
        absentMetaKeys: ['qaAgentId'],
      });
      expect(throttleIds(harness)).toEqual([]);
    });

    test('password 長度剛好 128 仍進入密碼比對', async () => {
      const harness = createHarness();
      await expectDenied(invoke(harness, {
        password: 'p'.repeat(128),
        persona: 'player',
      }), {
        code: 'permission-denied',
        reasonCode: 'qa_password_mismatch',
        harness,
      });
    });
  });

  describe('節流', () => {
    function throttleHarness(throttle) {
      return createHarness({
        config: defaultConfig({ throttle }),
      });
    }

    test('同一 IP 連續達到 maxFailures 後，下一次即使密碼正確也被鎖定且不簽 token', async () => {
      const harness = throttleHarness({
        perIp: { maxFailures: 3, windowSec: 600, lockSec: 900 },
        global: { maxFailures: 100, windowSec: 600, lockSec: 300 },
      });
      const ip = '203.0.113.21';
      const ipHash = hashQaIp(ip);
      for (let count = 0; count < 3; count += 1) {
        await expectDenied(invoke(harness, { password: PASSWORDS.wrong }, rawWithIp(ip)), {
          code: 'permission-denied',
          reasonCode: 'qa_password_mismatch',
          harness,
          ipHash,
        });
      }

      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, rawWithIp(ip)), {
        code: 'resource-exhausted',
        reasonCode: 'qa_throttled',
        harness,
        ipHash,
      });
      expect(harness.authAdmin.createCustomToken).not.toHaveBeenCalled();
    });

    test('另一個 IP 同時不受該 IP 鎖定影響', async () => {
      const harness = throttleHarness({
        perIp: { maxFailures: 3, windowSec: 600, lockSec: 900 },
        global: { maxFailures: 100, windowSec: 600, lockSec: 300 },
      });
      const lockedIp = '203.0.113.22';
      const otherIp = '203.0.113.23';
      for (let count = 0; count < 3; count += 1) {
        await expectDenied(
          invoke(harness, { password: PASSWORDS.wrong }, rawWithIp(lockedIp)),
          {
            code: 'permission-denied',
            reasonCode: 'qa_password_mismatch',
            harness,
            ipHash: hashQaIp(lockedIp),
          },
        );
      }

      const result = await invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, rawWithIp(otherIp));
      expectIssued(harness, result, { qaExp: NOW + 12 * HOUR_MS });
      expect(harness.db.read('qaTestAuthThrottle', `ip_${hashQaIp(lockedIp)}`)).toBeDefined();
    });

    test('全域失敗次數達到上限後，第四個 IP 即使密碼正確也被鎖定', async () => {
      const harness = throttleHarness({
        perIp: { maxFailures: 10, windowSec: 600, lockSec: 900 },
        global: { maxFailures: 3, windowSec: 600, lockSec: 300 },
      });
      const ips = ['203.0.113.31', '203.0.113.32', '203.0.113.33', '203.0.113.34'];
      for (let index = 0; index < 3; index += 1) {
        await expectDenied(
          invoke(harness, { password: PASSWORDS.wrong }, rawWithIp(ips[index])),
          {
            code: 'permission-denied',
            reasonCode: 'qa_password_mismatch',
            harness,
            ipHash: hashQaIp(ips[index]),
          },
        );
      }
      const globalBefore = harness.db.read('qaTestAuthThrottle', 'global').count;

      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, rawWithIp(ips[3])), {
        code: 'resource-exhausted',
        reasonCode: 'qa_throttled',
        harness,
        ipHash: hashQaIp(ips[3]),
      });
      expect(harness.authAdmin.createCustomToken).not.toHaveBeenCalled();
      expect(harness.db.read('qaTestAuthThrottle', 'global').count).toBe(globalBefore);
      expect(harness.db.read('qaTestAuthThrottle', `ip_${hashQaIp(ips[3])}`)).toBeUndefined();
    });

    test('鎖定時間過後可以再成功', async () => {
      const lockSec = 900;
      const harness = throttleHarness({
        perIp: { maxFailures: 3, windowSec: 600, lockSec },
        global: { maxFailures: 100, windowSec: 600, lockSec: 300 },
      });
      const ip = '203.0.113.41';
      for (let count = 0; count < 3; count += 1) {
        await expectDenied(invoke(harness, { password: PASSWORDS.wrong }, rawWithIp(ip)), {
          code: 'permission-denied',
          reasonCode: 'qa_password_mismatch',
          harness,
          ipHash: hashQaIp(ip),
        });
      }
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, rawWithIp(ip)), {
        code: 'resource-exhausted',
        reasonCode: 'qa_throttled',
        harness,
        ipHash: hashQaIp(ip),
      });

      harness.setNow(NOW + lockSec * 1000 + 1);
      const result = await invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, rawWithIp(ip));
      expect(result.customToken).toBe(TOKEN);
      expect(result.agentId).toBe('qa01');
      expect(harness.authAdmin.createCustomToken).toHaveBeenCalledTimes(1);
    });

    test('視窗過期後失敗計數從 1 重新起算', async () => {
      const windowSec = 600;
      const harness = throttleHarness({
        perIp: { maxFailures: 5, windowSec, lockSec: 900 },
        global: { maxFailures: 100, windowSec, lockSec: 300 },
      });
      const ip = '203.0.113.42';
      const ipHash = hashQaIp(ip);
      await expectDenied(invoke(harness, { password: PASSWORDS.wrong }, rawWithIp(ip)), {
        code: 'permission-denied',
        reasonCode: 'qa_password_mismatch',
        harness,
        ipHash,
      });
      expect(harness.db.read('qaTestAuthThrottle', `ip_${ipHash}`).count).toBe(1);

      const nextNow = NOW + windowSec * 1000 + 1;
      harness.setNow(nextNow);
      await expectDenied(invoke(harness, { password: PASSWORDS.wrong }, rawWithIp(ip)), {
        code: 'permission-denied',
        reasonCode: 'qa_password_mismatch',
        harness,
        ipHash,
      });
      expect(harness.db.read('qaTestAuthThrottle', `ip_${ipHash}`)).toMatchObject({
        count: 1,
        windowStartMs: nextNow,
      });
      expect(harness.db.read('qaTestAuthThrottle', 'global')).toMatchObject({
        count: 1,
        windowStartMs: nextNow,
      });
    });

    test('鎖定中的呼叫不再累加，且密碼正確也不會簽 token', async () => {
      const harness = throttleHarness({
        perIp: { maxFailures: 3, windowSec: 600, lockSec: 900 },
        global: { maxFailures: 100, windowSec: 600, lockSec: 300 },
      });
      const ip = '203.0.113.43';
      const ipHash = hashQaIp(ip);
      for (let count = 0; count < 3; count += 1) {
        await expectDenied(invoke(harness, { password: PASSWORDS.wrong }, rawWithIp(ip)), {
          code: 'permission-denied',
          reasonCode: 'qa_password_mismatch',
          harness,
          ipHash,
        });
      }
      const lockedCount = harness.db.read('qaTestAuthThrottle', `ip_${ipHash}`).count;
      const globalCount = harness.db.read('qaTestAuthThrottle', 'global').count;

      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, rawWithIp(ip)), {
        code: 'resource-exhausted',
        reasonCode: 'qa_throttled',
        harness,
        ipHash,
      });
      await expectDenied(invoke(harness, { password: PASSWORDS.wrong }, rawWithIp(ip)), {
        code: 'resource-exhausted',
        reasonCode: 'qa_throttled',
        harness,
        ipHash,
      });

      expect(harness.db.read('qaTestAuthThrottle', `ip_${ipHash}`).count).toBe(lockedCount);
      expect(harness.db.read('qaTestAuthThrottle', 'global').count).toBe(globalCount);
      expect(harness.authAdmin.createCustomToken).not.toHaveBeenCalled();
    });

    test('沒有可信 IP 時只套用全域節流，不產生 ip 文件，meta.ipHash 為空字串', async () => {
      const harness = throttleHarness({
        perIp: { maxFailures: 3, windowSec: 600, lockSec: 900 },
        global: { maxFailures: 3, windowSec: 600, lockSec: 300 },
      });
      await expectDenied(invoke(harness, { password: PASSWORDS.wrong }, false), {
        code: 'permission-denied',
        reasonCode: 'qa_password_mismatch',
        harness,
        ipHash: '',
        absentMetaKeys: ['qaAgentId', 'qaPersona'],
      });
      expect(throttleIds(harness).some((id) => id.startsWith('ip_'))).toBe(false);
      expect(harness.db.read('qaTestAuthThrottle', 'global').count).toBe(1);
      expect(harness.deduped[0].entry.meta.ipHash).toBe('');
      expect(harness.deduped[0].key.endsWith('_noip')).toBe(true);

      for (let count = 0; count < 2; count += 1) {
        await expectDenied(invoke(harness, { password: PASSWORDS.wrong }, false), {
          code: 'permission-denied',
          reasonCode: 'qa_password_mismatch',
          harness,
          ipHash: '',
        });
      }
      const globalCount = harness.db.read('qaTestAuthThrottle', 'global').count;
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, false), {
        code: 'resource-exhausted',
        reasonCode: 'qa_throttled',
        harness,
        ipHash: '',
      });
      expect(harness.db.read('qaTestAuthThrottle', 'global').count).toBe(globalCount);
      expect(throttleIds(harness).some((id) => id.startsWith('ip_'))).toBe(false);
      expect(harness.authAdmin.createCustomToken).not.toHaveBeenCalled();
    });
  });

  describe('fail-closed', () => {
    test.each([
      ['讀 config 丟錯', { failConfigRead: true }, 'qa_config_read_failed', 0],
      ['讀節流交易丟錯', { failThrottleRead: true }, 'qa_throttle_read_failed', 0],
      ['節流交易本身丟錯', { failTransaction: true }, 'qa_throttle_read_failed', 0],
      ['讀 users 丟錯', { failUsersRead: true }, 'qa_user_read_failed', 0],
      ['createCustomToken 丟錯', { failToken: true }, 'qa_token_sign_failed', 1],
    ])('%s 時回 internal 且不回 token', async (_label, controls, reasonCode, tokenCalls) => {
      const harness = createHarness({ controls });
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }), {
        code: 'internal',
        reasonCode,
        harness,
        tokenCalls,
      });
      if (reasonCode === 'qa_config_read_failed') {
        expect(throttleIds(harness)).toEqual([]);
      }
    });

    test('成功稽核寫入失敗時回 internal 且不回 token', async () => {
      const harness = createHarness({ controls: { failSuccessAudit: true } });
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }), {
        code: 'internal',
        reasonCode: 'qa_success_audit_failed',
        harness,
        tokenCalls: 1,
      });
      expect(harness.audits).toHaveLength(0);
    });

    test('失敗稽核丟錯時仍回原本的 permission-denied', async () => {
      const harness = createHarness({ controls: { failFailureAudit: true } });
      await expectDenied(invoke(harness, { password: PASSWORDS.wrong }), {
        code: 'permission-denied',
        reasonCode: 'qa_password_mismatch',
        harness,
        expectAudit: false,
      });
      expect(harness.db.read('qaTestAuthThrottle', 'global').count).toBe(1);
    });

    test('節流寫入交易丟錯時仍回原本的 permission-denied', async () => {
      // 測試同步更新：只讓結算寫入失敗。預占已留下 count 0 與 reservation，對外仍是密碼錯。
      const harness = createHarness({ controls: { failThrottleWrite: true } });
      await expectDenied(invoke(harness, { password: PASSWORDS.wrong }), {
        code: 'permission-denied',
        reasonCode: 'qa_password_mismatch',
        harness,
      });
      const ipDoc = harness.db.read('qaTestAuthThrottle', `ip_${hashQaIp(CLIENT_IP)}`);
      const globalDoc = harness.db.read('qaTestAuthThrottle', 'global');
      expect(ipDoc.count).toBe(0);
      expect(globalDoc.count).toBe(0);
      expect(ipDoc.reservations).toHaveLength(1);
      expect(globalDoc.reservations).toHaveLength(1);
      expect(ipDoc.lockedUntilMs || 0).toBe(0);
      expect(globalDoc.lockedUntilMs || 0).toBe(0);
      expect(harness.logger.warn).toHaveBeenCalledWith(
        '[issueQaTestToken] denied',
        expect.objectContaining({ reasonCode: 'qa_throttle_write_failed' }),
      );
    });
  });

  describe('不外洩', () => {
    test('成功、密碼錯、過期與內部錯誤的日誌、稽核與例外都不含秘密', async () => {
      const blobs = [];

      async function capture(factory, data, rawRequest) {
        const harness = factory();
        let error = null;
        let result;
        try {
          result = await invoke(harness, data, rawRequest);
        } catch (caught) {
          error = caught;
          if (caught && caught.code) rejectionCodes.push(caught.code);
        }
        blobs.push(JSON.stringify(harness.logger.warn.mock.calls));
        blobs.push(JSON.stringify(harness.logger.error.mock.calls));
        blobs.push(JSON.stringify(harness.audits));
        blobs.push(JSON.stringify(harness.deduped));
        if (error) {
          blobs.push(error.message);
          blobs.push(JSON.stringify(error));
          expect(error.message).toBe(PUBLIC_MESSAGE);
        }
        return { harness, error, result };
      }

      const success = await capture(
        () => createHarness(),
        { password: PASSWORDS.alpha, persona: 'player' },
      );
      expect(success.result.customToken).toBe(TOKEN);
      expect(success.error).toBeNull();

      await capture(
        () => createHarness(),
        { password: PASSWORDS.wrong },
      );
      await capture(
        () => createHarness({ secretText: secretLine('qa01', PASSWORDS.alpha, NOW) }),
        { password: PASSWORDS.alpha, persona: 'player' },
      );
      await capture(
        () => createHarness({ secretText: `qa01:${PASSWORDS.alpha}\n${secretLine('qa02', PASSWORDS.beta, FUTURE)}` }),
        { password: PASSWORDS.beta, persona: 'player' },
      );
      await capture(
        () => createHarness({ controls: { failConfigRead: true } }),
        { password: PASSWORDS.alpha, persona: 'player' },
      );
      await capture(
        () => createHarness({ controls: { failThrottleRead: true } }),
        { password: PASSWORDS.alpha, persona: 'player' },
      );
      await capture(
        () => createHarness({ controls: { failUsersRead: true } }),
        { password: PASSWORDS.alpha, persona: 'player' },
      );
      await capture(
        () => createHarness({ controls: { failToken: true } }),
        { password: PASSWORDS.alpha, persona: 'player' },
      );
      await capture(
        () => createHarness({ controls: { failSuccessAudit: true } }),
        { password: PASSWORDS.alpha, persona: 'player' },
      );
      await capture(
        () => createHarness({ controls: { failFailureAudit: true } }),
        { password: PASSWORDS.wrong },
      );
      await capture(
        () => createHarness({ controls: { failThrottleWrite: true } }),
        { password: PASSWORDS.wrong },
      );

      expectNoSecrets(blobs.join('\n'));
    });
  });

  describe('Callable 工廠', () => {
    test('onCall 收到的 options 恰為 region、timeoutSeconds 與 secrets', () => {
      const onCall = jest.fn((options, handler) => ({ options, handler }));
      const secret = { value: () => PASSWORDS.alpha };
      const callable = createIssueQaTestTokenCallable({
        onCall,
        secret,
        HttpsError: FakeHttpsError,
        db: {},
        authAdmin: {},
        writeAuditEntry: async () => {},
        writeDedupedAuditEntry: async () => {},
      });

      expect(onCall).toHaveBeenCalledTimes(1);
      expect(onCall.mock.calls[0][0]).toEqual({
        region: 'asia-east1',
        timeoutSeconds: 15,
        secrets: [secret],
      });
      expect(onCall.mock.calls[0][0].secrets[0]).toBe(secret);
      expect(typeof onCall.mock.calls[0][1]).toBe('function');
      expect(callable.handler).toBe(onCall.mock.calls[0][1]);
    });

    test('缺少 onCall 或 secret 時丟 TypeError', () => {
      const onCall = jest.fn();
      const secret = { value: () => PASSWORDS.alpha };
      expect(() => createIssueQaTestTokenCallable({ secret })).toThrow(TypeError);
      expect(() => createIssueQaTestTokenCallable({ onCall })).toThrow(TypeError);
      expect(() => createIssueQaTestTokenCallable({ onCall, secret: null })).toThrow(TypeError);
      expect(() => createIssueQaTestTokenCallable({ onCall, secret: {} })).toThrow(TypeError);
    });
  });

  describe('靜態檢查', () => {
    test('createCustomToken 區塊雜湊不變，且不含 qa 識別字', () => {
      const source = readSource('functions/index.js');
      const start = source.indexOf('exports.createCustomToken = onCall(');
      const end = source.indexOf('exports.issueQaTestToken = ');
      const block = source.slice(start, end).trim();
      const hash = crypto.createHash('sha256').update(block, 'utf8').digest('hex');

      // 刻意修改 LINE 登入時才更新此雜湊。
      expect(hash).toBe('fa59aa3d2c1272697a266e22eb7a72e7da58b33f1ad310298bc7e1919f96a582');
      expect(block).toContain('authAdmin.createCustomToken(lineUserId)');
      expect(block).not.toMatch(/\bqa[A-Za-z]*\b/);
    });

    test('QA_TEST_PASSWORD 只在頂層宣告一次，且早於 issueQaTestToken 與其他使用', () => {
      const source = readSource('functions/index.js');
      const statement = 'const QA_TEST_PASSWORD = defineSecret("QA_TEST_PASSWORD");';
      expect(source.split(statement).length - 1).toBe(1);
      const declarationAt = source.indexOf(statement);
      expect(source[declarationAt - 1]).toBe('\n');
      const exportAt = source.indexOf('exports.issueQaTestToken = createIssueQaTestTokenCallable({');
      expect(declarationAt).toBeGreaterThanOrEqual(0);
      expect(declarationAt).toBeLessThan(exportAt);

      const laterUses = [];
      let searchFrom = declarationAt + statement.length;
      while (searchFrom < source.length) {
        const found = source.indexOf('QA_TEST_PASSWORD', searchFrom);
        if (found < 0) break;
        laterUses.push(found);
        searchFrom = found + 'QA_TEST_PASSWORD'.length;
      }
      expect(laterUses.length).toBeGreaterThan(0);
      laterUses.forEach((position) => {
        expect(position).toBeGreaterThan(exportAt);
      });

      const blockEnd = source.indexOf('});', exportAt);
      const block = source.slice(exportAt, blockEnd);
      expect(block).toContain('secret: QA_TEST_PASSWORD');
      expect(block).toContain('writeAuditEntry');
      expect(block).toContain('writeDedupedAuditEntry');
    });

    test('稽核白名單保留 qaAgentId、qaPersona、ipHash，並丟掉 password 與 ip', () => {
      const source = readSource('functions/index.js');
      const setStart = source.indexOf('const ALLOWED_AUDIT_META_KEYS = new Set([');
      const setEnd = source.indexOf(']);', setStart) + 3;
      const fnStart = source.indexOf('function sanitizeAuditMeta(');
      const fnBody = extractBraced(source, 'function sanitizeAuditMeta(');
      const fnCode = source.slice(fnStart, fnStart + 'function sanitizeAuditMeta('.length) + fnBody.slice(1);
      // extractBraced returns the brace block. Rebuild the function from its keyword.
      const functionSource = `${source.slice(fnStart, source.indexOf('{', fnStart))}${fnBody}`;
      const sandbox = vm.runInNewContext(
        `${source.slice(setStart, setEnd)}\n${functionSource}\n({ sanitizeAuditMeta, ALLOWED_AUDIT_META_KEYS })`,
        {},
      );

      expect(sandbox.ALLOWED_AUDIT_META_KEYS.has('qaAgentId')).toBe(true);
      expect(sandbox.ALLOWED_AUDIT_META_KEYS.has('qaPersona')).toBe(true);
      expect(sandbox.ALLOWED_AUDIT_META_KEYS.has('ipHash')).toBe(true);
      const sanitized = sandbox.sanitizeAuditMeta({
        qaAgentId: 'qa01',
        qaPersona: 'player',
        ipHash: '0123456789abcdef',
        reasonCode: 'qa_success',
        password: PASSWORDS.alpha,
        ip: CLIENT_IP,
        customToken: TOKEN,
      });
      expect(sanitized.qaAgentId).toBe('qa01');
      expect(sanitized.qaPersona).toBe('player');
      expect(sanitized.ipHash).toBe('0123456789abcdef');
      expect(sanitized.password).toBeUndefined();
      expect(sanitized.ip).toBeUndefined();
      expect(sanitized.customToken).toBeUndefined();
      expect(fnCode).toContain('function sanitizeAuditMeta');
    });

    test('qa 模組不讀 process.env、不 require firebase，簽章物件不含 role', () => {
      ['functions/qa-test-mode-core.js', 'functions/qa-test-mode.js'].forEach((relativePath) => {
        const source = readSource(relativePath);
        expect(source).not.toContain('process.env');
        expect(source).not.toMatch(/require\(\s*['"]firebase-admin['"]\s*\)/);
        expect(source).not.toMatch(/require\(\s*['"]firebase-functions/);
      });

      const handlerSource = readSource('functions/qa-test-mode.js');
      const literal = extractBraced(handlerSource, 'createCustomToken(');
      expect(literal).not.toMatch(/\brole\b/);
      expect(literal).toContain('qa: true');
      expect(literal).toContain('qaPersona: personaKey');
    });
  });

  describe('核心退修補測', () => {
    function limitedHarness(perIpMax, globalMax, extra = {}) {
      return createHarness({
        ...extra,
        config: defaultConfig({
          ...(extra.config || {}),
          throttle: {
            perIp: { maxFailures: perIpMax, windowSec: 600, lockSec: 900 },
            global: { maxFailures: globalMax, windowSec: 600, lockSec: 300 },
          },
        }),
      });
    }

    test('同一 IP 並行 50 次密碼錯，進入比對者不超過 5', async () => {
      const harness = limitedHarness(5, 100);
      const ip = '203.0.113.80';
      const { secretCalls, codes, reservationsAtGate } = await burstWrongPasswords(
        harness,
        50,
        () => rawWithIp(ip),
      );
      expect(secretCalls).toBeLessThanOrEqual(5);
      expect(secretCalls).toBe(5);
      expect(codes.filter((code) => code === 'permission-denied')).toHaveLength(secretCalls);
      expect(codes.filter((code) => code === 'resource-exhausted')).toHaveLength(50 - secretCalls);
      expect(codes).toHaveLength(50);
      const reasons = harness.deduped.map((item) => item.entry.meta.reasonCode);
      expect(reasons.filter((reason) => reason === 'qa_password_mismatch')).toHaveLength(5);
      expect(reasons.filter((reason) => reason === 'qa_throttled')).toHaveLength(45);
      const ipRow = reservationsAtGate.find((row) => row.id === `ip_${hashQaIp(ip)}`);
      const globalRow = reservationsAtGate.find((row) => row.id === 'global');
      expect(ipRow).toMatchObject({ count: 0, reservations: 5 });
      expect(globalRow).toMatchObject({ count: 0, reservations: 5 });
      throttleIds(harness).forEach((id) => {
        expect(harness.db.read('qaTestAuthThrottle', id).reservations).toEqual([]);
      });
      expect(harness.authAdmin.createCustomToken).not.toHaveBeenCalled();
    });

    test('50 個不同 IP 並行，進入全域比對者不超過 3', async () => {
      const harness = limitedHarness(100, 3);
      const { secretCalls, codes, reservationsAtGate } = await burstWrongPasswords(
        harness,
        50,
        (index) => rawWithIp(`203.0.113.${index + 1}`),
      );
      expect(secretCalls).toBeLessThanOrEqual(3);
      expect(secretCalls).toBe(3);
      expect(codes.filter((code) => code === 'permission-denied')).toHaveLength(3);
      expect(codes.filter((code) => code === 'resource-exhausted')).toHaveLength(47);
      const reasons = harness.deduped.map((item) => item.entry.meta.reasonCode);
      expect(reasons.filter((reason) => reason === 'qa_password_mismatch')).toHaveLength(3);
      expect(reasons.filter((reason) => reason === 'qa_throttled')).toHaveLength(47);
      const globalRow = reservationsAtGate.find((row) => row.id === 'global');
      expect(globalRow).toMatchObject({ count: 0, reservations: 3 });
      const ipRows = reservationsAtGate.filter((row) => row.id.startsWith('ip_'));
      expect(ipRows).toHaveLength(3);
      expect(ipRows.reduce((sum, row) => sum + row.reservations, 0)).toBe(3);
      throttleIds(harness).forEach((id) => {
        expect(harness.db.read('qaTestAuthThrottle', id).reservations).toEqual([]);
      });
    });

    test('未來的 reservations 占滿名額時 resource-exhausted', async () => {
      const harness = limitedHarness(5, 100);
      const ip = '203.0.113.70';
      const ipHash = hashQaIp(ip);
      const reservations = [1, 2, 3, 4, 5].map((step) => NOW + step * 1000);
      harness.db.seed('qaTestAuthThrottle', `ip_${ipHash}`, {
        count: 0,
        windowStartMs: NOW,
        lockedUntilMs: 0,
        reservations,
      });
      let secretCalls = 0;
      const original = harness.secret.value.bind(harness.secret);
      harness.secret.value = () => {
        secretCalls += 1;
        return original();
      };
      await expectDenied(invoke(harness, { password: PASSWORDS.wrong }, rawWithIp(ip)), {
        code: 'resource-exhausted',
        reasonCode: 'qa_throttled',
        harness,
        ipHash,
      });
      expect(secretCalls).toBe(0);
      expect(harness.db.read('qaTestAuthThrottle', `ip_${ipHash}`).reservations).toEqual(reservations);
      expect(harness.db.read('qaTestAuthThrottle', 'global')).toBeUndefined();
    });

    test('過期的 reservations 被忽略並從文件過濾掉', async () => {
      const harness = limitedHarness(5, 100);
      const ip = '203.0.113.71';
      const ipHash = hashQaIp(ip);
      const reservations = [1, 2, 3, 4, 5].map((step) => NOW - step * 1000);
      harness.db.seed('qaTestAuthThrottle', `ip_${ipHash}`, {
        count: 0,
        windowStartMs: NOW,
        lockedUntilMs: 0,
        reservations,
      });
      const result = await invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, rawWithIp(ip));
      expect(result.customToken).toBe(TOKEN);
      const doc = harness.db.read('qaTestAuthThrottle', `ip_${ipHash}`);
      expect(doc.reservations).toEqual([]);
      reservations.forEach((stamp) => {
        expect(doc.reservations).not.toContain(stamp);
      });
    });

    test.each([
      ['qa_password_mismatch', 'permission-denied', 1, {}, { password: PASSWORDS.wrong }, 0],
      ['qa_password_expired', 'permission-denied', 1, {
        secretText: secretLine('qa01', PASSWORDS.alpha, NOW),
      }, { password: PASSWORDS.alpha, persona: 'player' }, 0],
      ['qa_persona_unknown', 'permission-denied', 1, {}, {
        password: PASSWORDS.alpha,
        persona: 'not-there',
      }, 0],
      ['qa_persona_not_allowed', 'permission-denied', 1, {
        secretText: secretLine('qa01', PASSWORDS.alpha, FUTURE, 'coach'),
      }, { password: PASSWORDS.alpha, persona: 'player' }, 0],
      ['qa_secret_invalid', 'permission-denied', 0, { secretMode: 'empty' }, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, 0],
      ['qa_persona_unprovisioned', 'permission-denied', 0, {
        config: defaultConfig({
          personas: {
            player: {
              uid: PLAYER_UID,
              displayName: 'QA測試-球員A',
              role: 'user',
              teamKey: 'ghost',
              enabled: true,
            },
          },
        }),
      }, { password: PASSWORDS.alpha, persona: 'player' }, 0],
      ['qa_user_read_failed', 'internal', 0, { controls: { failUsersRead: true } }, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, 0],
      ['qa_token_sign_failed', 'internal', 0, { controls: { failToken: true } }, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, 1],
      ['qa_success_audit_failed', 'internal', 0, { controls: { failSuccessAudit: true } }, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, 1],
    ])('%s 結算恰一次且 reservations 清空', async (
      reasonCode,
      code,
      expectedCount,
      options,
      data,
      tokenCalls,
    ) => {
      const harness = createHarness(options);
      await expectDenied(invoke(harness, data), {
        code,
        reasonCode,
        harness,
        tokenCalls,
      });
      expect(harness.db.transactionCount).toBe(2);
      expectBothThrottle(harness, expectedCount);
    });

    test('成功登入不重置視窗內的失敗計數', async () => {
      const harness = createHarness();
      const ipHash = hashQaIp(CLIENT_IP);
      const windowStartMs = NOW - 1000;
      const lockedUntilMs = 0;
      harness.db.seed('qaTestAuthThrottle', `ip_${ipHash}`, {
        count: 2,
        windowStartMs,
        lockedUntilMs,
        reservations: [],
      });
      await invoke(harness, { password: PASSWORDS.alpha, persona: 'player' });
      const doc = harness.db.read('qaTestAuthThrottle', `ip_${ipHash}`);
      expect(doc.count).toBe(2);
      expect(doc.windowStartMs).toBe(windowStartMs);
      expect(doc.lockedUntilMs).toBe(lockedUntilMs);
      expect(doc.reservations).toEqual([]);
    });

    test('鎖定週期結束即放行，結束前仍 resource-exhausted', async () => {
      const lockSec = 300;
      const windowSec = 600;
      const harness = createHarness({
        config: defaultConfig({
          throttle: {
            perIp: { maxFailures: 10, windowSec, lockSec: 900 },
            global: { maxFailures: 3, windowSec, lockSec },
          },
        }),
      });
      const ips = ['203.0.113.61', '203.0.113.62', '203.0.113.63'];
      for (const ip of ips) {
        await expectDenied(invoke(harness, { password: PASSWORDS.wrong }, rawWithIp(ip)), {
          code: 'permission-denied',
          reasonCode: 'qa_password_mismatch',
          harness,
          ipHash: hashQaIp(ip),
        });
      }
      expect(harness.db.read('qaTestAuthThrottle', 'global')).toMatchObject({
        count: 3,
        lockedUntilMs: NOW + lockSec * 1000,
      });

      const blockedIp = '203.0.113.64';
      harness.setNow(NOW + (lockSec - 1) * 1000);
      await expectDenied(invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, rawWithIp(blockedIp)), {
        code: 'resource-exhausted',
        reasonCode: 'qa_throttled',
        harness,
        ipHash: hashQaIp(blockedIp),
      });
      expect(harness.db.read('qaTestAuthThrottle', 'global').count).toBe(3);
      expect(harness.db.read('qaTestAuthThrottle', `ip_${hashQaIp(blockedIp)}`)).toBeUndefined();

      harness.setNow(NOW + lockSec * 1000);
      const result = await invoke(harness, {
        password: PASSWORDS.alpha,
        persona: 'player',
      }, rawWithIp(blockedIp));
      expect(result.customToken).toBe(TOKEN);
      expect(harness.db.read('qaTestAuthThrottle', 'global').count).toBe(0);
      expect(harness.db.read('qaTestAuthThrottle', 'global').reservations).toEqual([]);
    });

    test('未來的 windowStartMs 視為有效視窗，失敗計數不歸零', async () => {
      const harness = createHarness();
      harness.db.seed('qaTestAuthThrottle', 'global', {
        count: 2,
        windowStartMs: NOW + 5000,
        lockedUntilMs: 0,
        reservations: [],
      });
      await expectDenied(invoke(harness, { password: PASSWORDS.wrong }), {
        code: 'permission-denied',
        reasonCode: 'qa_password_mismatch',
        harness,
      });
      expect(harness.db.read('qaTestAuthThrottle', 'global')).toMatchObject({
        count: 3,
        windowStartMs: NOW + 5000,
        reservations: [],
      });
    });

    test('clientIpXffFromRight 改變 ip_ 節流文件鍵', async () => {
      const raw = {
        headers: { 'x-forwarded-for': '203.0.113.10, 203.0.113.20' },
        ip: FALLBACK_IP,
      };
      const defaultKey = `ip_${hashQaIp('203.0.113.20')}`;
      const shiftedKey = `ip_${hashQaIp('203.0.113.10')}`;
      expect(defaultKey).not.toBe(shiftedKey);

      const harnessDefault = createHarness();
      await expectDenied(invoke(harnessDefault, { password: PASSWORDS.wrong }, raw), {
        code: 'permission-denied',
        reasonCode: 'qa_password_mismatch',
        harness: harnessDefault,
        ipHash: hashQaIp('203.0.113.20'),
      });
      expect(harnessDefault.db.read('qaTestAuthThrottle', defaultKey)).toBeDefined();
      expect(harnessDefault.db.read('qaTestAuthThrottle', shiftedKey)).toBeUndefined();

      const harnessShifted = createHarness({
        config: defaultConfig({ clientIpXffFromRight: 2 }),
      });
      await expectDenied(invoke(harnessShifted, { password: PASSWORDS.wrong }, raw), {
        code: 'permission-denied',
        reasonCode: 'qa_password_mismatch',
        harness: harnessShifted,
        ipHash: hashQaIp('203.0.113.10'),
      });
      expect(harnessShifted.db.read('qaTestAuthThrottle', shiftedKey)).toBeDefined();
      expect(harnessShifted.db.read('qaTestAuthThrottle', defaultKey)).toBeUndefined();
    });
  });

  describe('緊急手動上鎖', () => {
    const lockedUntilMs = NOW + 600000;
    const manualLock = {
      count: 0,
      windowStartMs: NOW,
      lockedUntilMs,
      reservations: [],
    };
    const successData = { password: PASSWORDS.alpha, persona: 'player' };

    function watchSecret(harness) {
      let secretCalls = 0;
      const original = harness.secret.value.bind(harness.secret);
      harness.secret.value = () => {
        secretCalls += 1;
        return original();
      };
      return () => secretCalls;
    }

    test('測試補強：緊急手動上鎖（per-IP）時 count 為 0 仍 resource-exhausted，鎖過期後同請求成功', async () => {
      const harness = createHarness();
      const ip = '203.0.113.91';
      const ipHash = hashQaIp(ip);
      harness.db.seed('qaTestAuthThrottle', `ip_${ipHash}`, manualLock);
      const secretCalls = watchSecret(harness);

      await expectDenied(invoke(harness, successData, rawWithIp(ip)), {
        code: 'resource-exhausted',
        reasonCode: 'qa_throttled',
        harness,
        ipHash,
      });
      expect(secretCalls()).toBe(0);
      expect(harness.authAdmin.createCustomToken).not.toHaveBeenCalled();
      expect(harness.db.read('qaTestAuthThrottle', `ip_${ipHash}`)).toMatchObject(manualLock);
      expect(harness.db.read('qaTestAuthThrottle', 'global')).toBeUndefined();

      harness.setNow(NOW + 600001);
      const result = await invoke(harness, successData, rawWithIp(ip));
      expect(result.customToken).toBe(TOKEN);
      expect(result.agentId).toBe('qa01');
      expect(harness.authAdmin.createCustomToken).toHaveBeenCalledTimes(1);
    });

    test('測試補強：緊急手動上鎖（global）時 count 為 0 仍 resource-exhausted，鎖過期後同請求成功', async () => {
      const harness = createHarness();
      const ip = '203.0.113.92';
      const ipHash = hashQaIp(ip);
      harness.db.seed('qaTestAuthThrottle', 'global', manualLock);
      const secretCalls = watchSecret(harness);

      await expectDenied(invoke(harness, successData, rawWithIp(ip)), {
        code: 'resource-exhausted',
        reasonCode: 'qa_throttled',
        harness,
        ipHash,
      });
      expect(secretCalls()).toBe(0);
      expect(harness.authAdmin.createCustomToken).not.toHaveBeenCalled();
      expect(harness.db.read('qaTestAuthThrottle', 'global')).toMatchObject(manualLock);
      expect(harness.db.read('qaTestAuthThrottle', `ip_${ipHash}`)).toBeUndefined();

      harness.setNow(NOW + 600001);
      const result = await invoke(harness, successData, rawWithIp(ip));
      expect(result.customToken).toBe(TOKEN);
      expect(result.agentId).toBe('qa01');
      expect(harness.authAdmin.createCustomToken).toHaveBeenCalledTimes(1);
    });

    test('測試補強：鎖定中不累加，錯誤密碼被擋後 count 與 lockedUntilMs 不變且 reservations 為空', async () => {
      const harness = createHarness();
      const ip = '203.0.113.93';
      const ipHash = hashQaIp(ip);
      harness.db.seed('qaTestAuthThrottle', `ip_${ipHash}`, {
        count: 1,
        windowStartMs: NOW,
        lockedUntilMs,
        reservations: [],
      });

      await expectDenied(invoke(harness, { password: PASSWORDS.wrong }, rawWithIp(ip)), {
        code: 'resource-exhausted',
        reasonCode: 'qa_throttled',
        harness,
        ipHash,
      });

      expect(harness.db.read('qaTestAuthThrottle', `ip_${ipHash}`)).toMatchObject({
        count: 1,
        lockedUntilMs,
        reservations: [],
      });
    });
  });

  // 必須放在檔案最後，才收得到前面每一個拒絕案例的 code。
  test('整個檔案的拒絕 code 只包含四種且沒有 failed-precondition', () => {
    expect(rejectionCodes.length).toBeGreaterThan(0);
    expect(rejectionCodes).not.toContain('failed-precondition');
    expect([...new Set(rejectionCodes)].sort()).toEqual([
      'internal',
      'invalid-argument',
      'permission-denied',
      'resource-exhausted',
    ]);
  });
});
