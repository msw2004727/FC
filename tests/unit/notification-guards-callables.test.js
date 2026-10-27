/**
 * 通知發送授權強化（第 1 批）— 三個入口的整合測試。
 * 與 cloud-functions.test.js 相同作法：從 functions/index.js 切出實際原始碼放進 vm 沙盒執行，
 * 搭配記憶體版 Firestore 與真實的 notification-guards（可控時鐘）。閾值一律對照 NOTIFICATION_GUARD_LIMITS。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fields = require('../../functions/notification-fields');
const { createNotificationGuards } = require('../../functions/notification-guards');
const { createFakeDb, FieldValue, FakeError } = require('./notification-guards-fake-db');
const {
  TestHttpsError, ROLE_LEVELS, T0, DAY, MINUTE_MS, CALLER, TARGET, OTHER, RATE_LIMITED,
  NOTIFICATION_GUARD_LIMITS: L, COUNTER_COLLECTION, DEDUPE_COLLECTION, repeat, seedCounter,
} = require('./notification-guards-test-helpers');

function readSourceBetween(startNeedle, endNeedle) {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'functions', 'index.js'), 'utf8')
    .replace(/\r\n/g, '\n');
  const start = source.indexOf(startNeedle);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = endNeedle ? source.indexOf(endNeedle, start + startNeedle.length) : -1;
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function makeConsole() {
  const out = { logs: [], warns: [], errors: [] };
  return {
    out,
    log: (...args) => out.logs.push(args),
    info: () => {},
    warn: (...args) => out.warns.push(args),
    error: (...args) => out.errors.push(args),
  };
}

function createEnv({ seed = {}, faults, clock = { t: T0 } } = {}) {
  const db = createFakeDb({ seed, faults });
  const consoleImpl = makeConsole();
  const guards = createNotificationGuards({
    db,
    FieldValue,
    HttpsError: TestHttpsError,
    roleLevels: ROLE_LEVELS,
    now: () => clock.t,
    random: () => 0,
    logger: consoleImpl,
  });
  return { db, consoleImpl, guards, clock };
}

const counterPaths = (db) => db.paths(`${COUNTER_COLLECTION}/`);
const gateWarns = (consoleImpl, gate) => consoleImpl.out.warns
  .filter(([msg, data]) => msg === '[notificationGuards] gate triggered' && data.gate === gate);

// ───────────────────────── enqueuePrivilegedLineNotification ─────────────────────────
describe('enqueuePrivilegedLineNotification 防護', () => {
  const sourceParts = [
    readSourceBetween('const ALLOWED_LINE_NOTIFICATION_CATEGORIES', 'const DEFAULT_NOTIFICATION_TEMPLATES'),
    readSourceBetween('function normalizeLineNotificationCategory(', 'function getDefaultNotificationTemplates'),
    readSourceBetween('function getLineRecipientUidFromUserDoc(', 'function getDisplayNameFromAuthRecord'),
    readSourceBetween('function getLineNotificationSettingsKey(', 'function getLineHttpStatus'),
    readSourceBetween('exports.enqueuePrivilegedLineNotification', '/**\n * processLinePushQueue'),
  ];

  function boundUser(extra = {}) {
    return { uid: TARGET, lineUserId: TARGET, lineNotify: { bound: true, settings: { activity: true, system: true } }, ...extra };
  }

  function load({ users = { [TARGET]: boundUser() }, roles = {}, flags = null, clock, faults } = {}) {
    const seed = {};
    Object.entries(users).forEach(([uid, data]) => { seed[`users/${uid}`] = data; });
    if (flags) seed['siteConfig/featureFlags'] = flags;
    const env = createEnv({ seed, faults, clock });
    const sandbox = {
      db: env.db,
      HttpsError: TestHttpsError,
      onCall: (options, handler) => ({ options, handler }),
      FieldValue,
      exports: {},
      console: env.consoleImpl,
      notificationGuards: env.guards,
      getCallerRoleWithFallback: async (request) => roles[request.auth.uid] || 'user',
      findUserDocByUidOrLineUserId: async (uid) => {
        const snap = await env.db.collection('users').doc(uid).get();
        return snap.exists ? { docId: snap.id, data: snap.data() } : null;
      },
    };
    vm.runInNewContext(sourceParts.join('\n'), sandbox, { filename: 'enqueue-guards.vm.js' });
    const callable = sandbox.exports.enqueuePrivilegedLineNotification;
    return {
      ...env,
      options: callable.options,
      handler: callable.handler,
      call: (data, uid = CALLER) => callable.handler({ auth: { uid }, data }),
    };
  }

  const payload = (extra = {}) => ({
    uid: TARGET,
    title: '標題',
    body: '內文',
    category: 'activity',
    source: 'template:event_changed',
    dedupeKey: 'event_changed:e1:u1:h',
    ...extra,
  });
  const queued = (db) => db.paths('linePushQueue/');
  const userCounters = (db) => counterPaths(db).filter((p) => p.includes(`${DAY}_target_`) || p.includes('_global_'));

  test('合法情境不變：回傳形狀、入列欄位、region 與逾時設定', async () => {
    const env = load();
    expect(env.options).toEqual({ region: 'asia-east1', timeoutSeconds: 15 });
    await expect(env.call(payload())).resolves.toEqual({ queued: true, skipped: false, queueId: 'auto_1' });
    expect(env.db.read('linePushQueue/auto_1')).toEqual({
      uid: TARGET,
      targetDocId: TARGET,
      title: '標題',
      body: '內文',
      category: 'activity',
      status: 'pending',
      createdAt: '__ts__',
      source: 'template:event_changed',
      requestedByUid: CALLER,
      requestedByRole: 'user',
      dedupeKey: 'event_changed:e1:u1:h',
    });
  });

  test('未登入仍回 unauthenticated，且不碰任何計數', async () => {
    const env = load();
    await expect(env.handler({ data: payload() })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(counterPaths(env.db)).toHaveLength(0);
  });

  test('既有略過情境不變，且不消耗每目標與全域額度', async () => {
    const env = load({
      users: {
        [TARGET]: boundUser(),
        [OTHER]: boundUser({ lineUserId: OTHER, lineNotify: { bound: false } }),
        [`${OTHER}b`]: boundUser({ lineUserId: `${OTHER}b`, lineNotify: { bound: true, settings: { activity: false } } }),
      },
      flags: { notificationToggles: { category_activity: false } },
    });
    await expect(env.call(payload({ uid: `${TARGET}zz` }))).resolves.toEqual({ queued: false, skipped: true, reason: 'target_not_found' });
    await expect(env.call(payload({ uid: OTHER }))).resolves.toEqual({ queued: false, skipped: true, reason: 'not_bound' });
    await expect(env.call(payload({ uid: `${OTHER}b` }))).resolves.toEqual({ queued: false, skipped: true, reason: 'category_disabled' });
    await expect(env.call(payload({ source: 'client:line-push' }))).resolves.toEqual({
      queued: false,
      skipped: true,
      reason: 'notification_toggle_disabled',
    });
    expect(queued(env.db)).toHaveLength(0);
    expect(userCounters(env.db)).toHaveLength(0);
    expect(counterPaths(env.db).filter((p) => p.includes('caller_day') || p.includes('caller_target'))).toHaveLength(0);
  });

  test('一般層每呼叫者每分鐘：上限內處理、超過一筆 resource-exhausted，隔分鐘重置', async () => {
    const env = load();
    await repeat(L.enqueue.userPerMinute, (i) => env.call(payload({ uid: `${TARGET}x${i}` })));
    await expect(env.call(payload({ uid: `${TARGET}over` }))).rejects.toMatchObject(RATE_LIMITED);
    env.clock.t += MINUTE_MS;
    await expect(env.call(payload())).resolves.toMatchObject({ queued: true });
    expect(queued(env.db)).toHaveLength(1);
  });

  test('節流以呼叫者為單位：另一位呼叫者不受影響', async () => {
    const env = load();
    await repeat(L.enqueue.userPerMinute, (i) => env.call(payload({ uid: `${TARGET}x${i}` })));
    await expect(env.call(payload({ uid: `${TARGET}over` }))).rejects.toMatchObject(RATE_LIMITED);
    await expect(env.call(payload(), OTHER)).resolves.toMatchObject({ queued: true });
  });

  test('一般層每（呼叫者, 目標）每日：上限內入列、超過拒絕且不入列；換日重置', async () => {
    const clock = { t: Date.UTC(2026, 9, 27, 15, 59, 0) };
    const env = load({ clock });
    await repeat(L.callerTargetPerDay, () => env.call(payload()));
    await expect(env.call(payload())).rejects.toMatchObject(RATE_LIMITED);
    expect(queued(env.db)).toHaveLength(L.callerTargetPerDay);
    expect(gateWarns(env.consoleImpl, 'caller_target_day')).toHaveLength(1);
    clock.t = Date.UTC(2026, 9, 27, 16, 1, 0);
    await expect(env.call(payload())).resolves.toMatchObject({ queued: true });
  });

  test('教練以上（批次通知）：不受一般層分鐘上限與每目標上限，仍計入 staff 全域池', async () => {
    const env = load({ roles: { [CALLER]: 'admin' } });
    await repeat(L.targetPerDay + 5, () => env.call(payload()));
    expect(queued(env.db)).toHaveLength(L.targetPerDay + 5);
    expect(counterPaths(env.db).filter((p) => p.includes(`${DAY}_target_`))).toHaveLength(0);
    expect(env.db.read(`${COUNTER_COLLECTION}/${DAY}_global_enqueue_staff_s0`).count).toBe(L.targetPerDay + 5);
  });

  test('全域池：一般層池用滿後一般層被拒絕並記一筆 error；教練以上照常入列', async () => {
    const env = load({ roles: { [OTHER]: 'admin' } });
    await seedCounter(env.db, `${DAY}_global_enqueue_user_s0`, L.globalPerDay.user);
    await expect(env.call(payload())).rejects.toMatchObject(RATE_LIMITED);
    await expect(env.call(payload())).rejects.toMatchObject(RATE_LIMITED);
    expect(queued(env.db)).toHaveLength(0);
    expect(env.consoleImpl.out.errors).toEqual([[
      '[notificationGuards] global daily cap reached',
      { gate: 'global_pool_user', kind: 'enqueue', day: DAY, limit: L.globalPerDay.user },
    ]]);
    await expect(env.call(payload(), OTHER)).resolves.toMatchObject({ queued: true });
  });

  test('source 含非法字元：invalid-argument 並記錄，不入列、不消耗每日額度', async () => {
    const env = load();
    await expect(env.call(payload({ source: 'bad source!' }))).rejects.toMatchObject({
      code: 'invalid-argument',
      message: 'invalid source',
    });
    await expect(env.call(payload({ source: '中文來源' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(queued(env.db)).toHaveLength(0);
    expect(userCounters(env.db)).toHaveLength(0);
    expect(gateWarns(env.consoleImpl, 'source_format')).toHaveLength(1);
    expect(gateWarns(env.consoleImpl, 'source_format')[0][1]).toMatchObject({ kind: 'enqueue', source: null });
    expect(JSON.stringify(env.consoleImpl.out.warns)).not.toContain('bad source');
  });

  test('超長 source 沿用既有行為（視為 client:unknown）', async () => {
    const env = load();
    await env.call(payload({ source: `a${'b'.repeat(130)}` }));
    expect(env.db.read('linePushQueue/auto_1').source).toBe('client:unknown');
  });

  test('未知 source 照常處理，只記遮罩後的 warn（不含 title／body／完整 UID）', async () => {
    const env = load();
    await expect(env.call(payload({ source: 'brand_new_source' }))).resolves.toMatchObject({ queued: true });
    expect(env.db.read('linePushQueue/auto_1').source).toBe('brand_new_source');
    expect(env.consoleImpl.out.warns).toEqual([[
      '[enqueuePrivilegedLineNotification] unknown source',
      { callerUid: fields.maskUid(CALLER), source: 'brand_new_source', category: 'activity' },
    ]]);
    const serialized = JSON.stringify(env.consoleImpl.out.warns);
    expect(serialized).not.toContain(CALLER);
    expect(serialized).not.toContain('標題');
    expect(serialized).not.toContain('內文');
  });

  test('已知 source 不記未知 source log', async () => {
    const env = load();
    await env.call(payload({ source: 'template:event_changed' }));
    await env.call(payload({ source: 'team_join_request', uid: `${TARGET}b` }));
    expect(env.consoleImpl.out.warns).toHaveLength(0);
  });

  test('title／body 移除 NUL 與其他 C0 控制字元，保留換行與定位', async () => {
    const env = load();
    const c = (n) => String.fromCharCode(n);
    await env.call(payload({ title: `標${c(0)}題${c(7)}`, body: `第一行\n第${c(13)}二\t行${c(27)}` }));
    const doc = env.db.read('linePushQueue/auto_1');
    expect(doc.title).toBe('標題');
    expect(doc.body).toBe('第一行\n第二\t行');
  });

  test('清理後為空或超長仍視為缺少必要欄位（既有行為）', async () => {
    const env = load();
    const nul = String.fromCharCode(0);
    await expect(env.call(payload({ title: `${nul}${nul}` }))).rejects.toMatchObject({
      code: 'invalid-argument',
      message: 'uid/title/body/category are required',
    });
    await expect(env.call(payload({ title: 'x'.repeat(201) }))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(env.call(payload({ body: 'x'.repeat(2001) }))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(queued(env.db)).toHaveLength(0);
  });

  test('計數故障：一般層回 sanitized internal 不入列；教練以上照常入列並記錄', async () => {
    const faults = { getAll: () => new FakeError(14, 'UNAVAILABLE') };
    const user = load({ faults });
    await expect(user.call(payload())).rejects.toMatchObject({ code: 'internal', message: 'Failed to verify request limits' });
    expect(queued(user.db)).toHaveLength(0);
    const staff = load({ faults, roles: { [CALLER]: 'admin' } });
    await expect(staff.call(payload())).resolves.toMatchObject({ queued: true });
    expect(staff.consoleImpl.out.errors.length).toBeGreaterThan(0);
    staff.consoleImpl.out.errors.forEach(([msg, data]) => {
      expect(msg).toBe('[notificationGuards] counter failure');
      expect(data).toMatchObject({ staff: true, failOpen: true, code: 14 });
    });
  });
});

// ───────────────────────── processLinePushQueue ─────────────────────────
describe('processLinePushQueue 防護', () => {
  const sourceParts = [
    readSourceBetween('exports.processLinePushQueue', '//  Shot Game'),
  ];

  function load({ clock, faults, pushImpl } = {}) {
    const env = createEnv({ faults, clock });
    const pushed = [];
    class FakeMessagingApiClient {
      async pushMessage(arg) {
        if (pushImpl) await pushImpl(arg);
        pushed.push(arg);
      }
    }
    const sandbox = {
      db: env.db,
      FieldValue,
      onDocumentCreated: (options, handler) => ({ options, handler }),
      LINE_CHANNEL_ACCESS_TOKEN: { value: () => 'token' },
      getMessagingApi: () => ({ MessagingApiClient: FakeMessagingApiClient }),
      shouldAutoUnbindLineRecipient: async () => ({ shouldUnbind: false, reason: 'stub' }),
      findUserDocByUidOrLineUserId: async () => null,
      exports: {},
      console: env.consoleImpl,
      notificationGuards: env.guards,
    };
    vm.runInNewContext(sourceParts.join('\n'), sandbox, { filename: 'process-guards.vm.js' });
    const handler = sandbox.exports.processLinePushQueue.handler;
    return {
      ...env,
      pushed,
      async run(id, extra = {}) {
        const ref = env.db.collection('linePushQueue').doc(id);
        await ref.set({
          uid: TARGET,
          title: '標題',
          body: '內文',
          category: 'activity',
          status: 'pending',
          source: 'template:event_changed',
          requestedByUid: CALLER,
          requestedByRole: 'user',
          ...extra,
        });
        await handler({ data: { id, ref, data: () => env.db.read(`linePushQueue/${id}`) } });
        return env.db.read(`linePushQueue/${id}`);
      },
    };
  }

  const KEY = { dedupeKey: 'event_changed:e1:u1:h' };
  const TEN_MIN = 10 * 60 * 1000;

  test('沒有 dedupeKey：行為不變（發送並標記 sent，不建立去重文件）', async () => {
    const env = load();
    const doc = await env.run('q1');
    expect(doc.status).toBe('sent');
    expect(env.pushed).toEqual([{ to: TARGET, messages: [{ type: 'text', text: '標題\n內文' }] }]);
    expect(env.db.paths(`${DEDUPE_COLLECTION}/`)).toHaveLength(0);
  });

  test('同一收件者＋同一 dedupeKey：後到者標記 skipped／duplicate，不發送', async () => {
    const env = load();
    expect((await env.run('q1', KEY)).status).toBe('sent');
    const second = await env.run('q2', KEY);
    expect(second).toMatchObject({ status: 'skipped', reason: 'duplicate', processedAt: '__ts__' });
    expect(env.pushed).toHaveLength(1);
  });

  test('10 分鐘視窗邊界：9:59 為重複，10:01 重新發送；隔 30 分鐘與 2 小時照常發送', async () => {
    const env = load();
    await env.run('q1', KEY);
    env.clock.t = T0 + TEN_MIN - 1000;
    expect((await env.run('q2', KEY)).status).toBe('skipped');
    env.clock.t = T0 + TEN_MIN + 1000;
    expect((await env.run('q3', KEY)).status).toBe('sent');
    env.clock.t += 30 * MINUTE_MS;
    expect((await env.run('q4', KEY)).status).toBe('sent');
    env.clock.t += 120 * MINUTE_MS;
    expect((await env.run('q5', KEY)).status).toBe('sent');
    expect(env.pushed).toHaveLength(4);
  });

  test('多收件者共用同一把 dedupeKey 各自發送', async () => {
    const env = load();
    expect((await env.run('q1', { ...KEY, uid: TARGET })).status).toBe('sent');
    expect((await env.run('q2', { ...KEY, uid: OTHER })).status).toBe('sent');
    expect(env.pushed).toHaveLength(2);
  });

  test('發送失敗：標記 failed 並釋放去重標記，之後同 dedupeKey 可重送', async () => {
    let attempts = 0;
    const env = load({
      pushImpl: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('push boom');
      },
    });
    const failed = await env.run('q1', KEY);
    expect(failed).toMatchObject({ status: 'failed', error: 'push boom' });
    expect(env.db.paths(`${DEDUPE_COLLECTION}/`)).toHaveLength(0);
    expect((await env.run('q2', KEY)).status).toBe('sent');
  });

  test('全域池：一般層池用滿後 skipped／daily_cap 不發送；系統與教練以上文件照常發送', async () => {
    const env = load();
    await seedCounter(env.db, `${DAY}_global_send_user_s0`, L.globalPerDay.user);
    expect(await env.run('q1', KEY)).toMatchObject({ status: 'skipped', reason: 'daily_cap' });
    expect(await env.run('q2')).toMatchObject({ status: 'skipped', reason: 'daily_cap' });
    expect(env.pushed).toHaveLength(0);
    expect(env.db.paths(`${DEDUPE_COLLECTION}/`)).toHaveLength(0);
    expect(env.consoleImpl.out.errors).toEqual([[
      '[notificationGuards] global daily cap reached',
      { gate: 'global_pool_user', kind: 'send', day: DAY, limit: L.globalPerDay.user },
    ]]);
    expect((await env.run('q3', { requestedByUid: 'system', requestedByRole: 'system' })).status).toBe('sent');
    expect((await env.run('q4', { requestedByRole: 'admin' })).status).toBe('sent');
    expect(env.pushed).toHaveLength(2);
  });

  test('非 pending、缺少必要欄位維持既有處理，且不碰計數', async () => {
    const env = load();
    expect((await env.run('q1', { status: 'sent' })).status).toBe('sent');
    const missing = await env.run('q2', { body: '' });
    expect(missing).toMatchObject({ status: 'failed', error: '缺少必要欄位 (uid/title/body)' });
    expect(env.pushed).toHaveLength(0);
    expect(counterPaths(env.db)).toHaveLength(0);
  });

  test('計數／去重故障：仍發送並結構化記錄', async () => {
    const env = load({ faults: { transaction: () => new FakeError(14, 'UNAVAILABLE') } });
    expect((await env.run('q1', KEY)).status).toBe('sent');
    expect(env.pushed).toHaveLength(1);
    expect(env.consoleImpl.out.errors).toEqual([[
      '[notificationGuards] pre-push check failed, allow',
      { queueId: 'q1', code: 14 },
    ]]);
  });
});

// ───────────────────────── deliverToInbox ─────────────────────────
describe('deliverToInbox 防護（顯示欄位由伺服器決定與節流）', () => {
  const sourceParts = [
    readSourceBetween('function normalizeRole(', 'function normalizeBuiltInRole'),
    readSourceBetween('async function getTeamDocByTeamId(', 'function isRoleAdminOrAbove'),
    readSourceBetween('function isRoleAdminOrAbove', 'function getEduCourseRosterAgentUids'),
    readSourceBetween('function getTournamentDelegateUidSet', 'function buildRegisteredTeamIdsFromEntries'),
    readSourceBetween('// T-022: deliverToInbox actionType', 'async function assertCallerCanReviewGroupActionDocs'),
  ];

  function load({ users, extraSeed = {}, clock, faults } = {}) {
    const seed = { ...extraSeed };
    Object.entries(users || {}).forEach(([uid, data]) => { seed[`users/${uid}`] = data; });
    const env = createEnv({ seed, clock, faults });
    const sandbox = {
      db: env.db,
      HttpsError: TestHttpsError,
      onCall: (options, handler) => ({ options, handler }),
      FieldValue,
      exports: {},
      console: env.consoleImpl,
      notificationGuards: env.guards,
    };
    vm.runInNewContext(sourceParts.join('\n'), sandbox, { filename: 'deliver-guards.vm.js' });
    const callable = sandbox.exports.deliverToInbox;
    return {
      ...env,
      call: (data, uid = CALLER) => callable.handler({ auth: { uid }, data }),
      inbox: (uid, id) => env.db.read(`users/${uid}/inbox/${id}`),
    };
  }

  const baseUsers = () => ({
    [CALLER]: { role: 'user', displayName: '王小明' },
    [TARGET]: { role: 'user' },
  });
  const msg = (extra = {}) => ({
    id: 'msg_1',
    title: '標題',
    body: '內文',
    type: 'system',
    typeName: '系統',
    senderName: '系統',
    time: '2026/10/23 12:00',
    ...extra,
  });
  const adminRoles = { targetRoles: ['admin', 'super_admin'], targetType: 'role' };

  test('客戶端傳入的 senderName／type／typeName／time 一律由伺服器值取代', async () => {
    const env = load({ users: baseUsers() });
    await expect(env.call({
      message: msg({ senderName: '系統管理員', type: '任意', typeName: '客戶端值', time: '任意' }),
      targetUid: TARGET,
    })).resolves.toEqual({ success: true, delivered: 1 });
    expect(env.inbox(TARGET, 'msg_1')).toMatchObject({
      type: 'private',
      typeName: '私訊',
      senderName: '王小明',
      time: '2026/10/27 12:00',
      fromUid: CALLER,
      title: '標題',
      body: '內文',
      actionType: null,
    });
  });

  test('合法的範本／提醒訊息：沿用「系統」發送者與合法 type，typeName 由伺服器對照', async () => {
    const env = load({ users: baseUsers() });
    await env.call({ message: msg({ type: 'activity', typeName: '客戶端值', senderName: '系統' }), targetUid: TARGET });
    expect(env.inbox(TARGET, 'msg_1')).toMatchObject({
      type: 'activity',
      typeName: '活動',
      senderName: '系統',
      time: '2026/10/27 12:00',
    });
  });

  test('四種合法 type 的 typeName 對照', async () => {
    const env = load({ users: baseUsers() });
    const expected = { system: '系統', activity: '活動', tournament: '賽事', private: '私訊' };
    let n = 0;
    for (const [type, typeName] of Object.entries(expected)) {
      n += 1;
      await env.call({ message: msg({ id: `msg_t${n}`, type, typeName: 'x' }), targetUid: TARGET });
      expect(env.inbox(TARGET, `msg_t${n}`)).toMatchObject({ type, typeName });
    }
  });

  test('呼叫者無個人資料時，非系統發送者顯示為「用戶」', async () => {
    const env = load({ users: { [TARGET]: { role: 'user' } } });
    await env.call({ message: msg({ senderName: '別人' }), targetUid: TARGET });
    expect(env.inbox(TARGET, 'msg_1').senderName).toBe('用戶');
  });

  test('admin 的廣播（已有角色檢查）不改顯示欄位', async () => {
    const env = load({
      users: {
        [CALLER]: { role: 'admin', displayName: '管理員' },
        [TARGET]: { role: 'coach' },
      },
    });
    await expect(env.call({
      message: msg({ type: 'activity', typeName: '自訂', senderName: '管理員', time: '2026/10/01 08:00' }),
      targetRoles: ['coach'],
      targetType: 'role',
    })).resolves.toEqual({ success: true, delivered: 1 });
    expect(env.inbox(TARGET, 'msg_1')).toMatchObject({
      type: 'activity',
      typeName: '自訂',
      senderName: '管理員',
      time: '2026/10/01 08:00',
    });
  });

  test('非 admin 的廣播（使用者→管理員）：顯示欄位由伺服器決定', async () => {
    const env = load({
      users: {
        [CALLER]: { role: 'user', displayName: '王小明' },
        [OTHER]: { role: 'admin' },
      },
    });
    await expect(env.call({
      message: msg({ senderName: '系統管理員', type: '任意', typeName: '客戶端值', time: '任意' }),
      ...adminRoles,
    })).resolves.toEqual({ success: true, delivered: 1 });
    expect(env.inbox(OTHER, 'msg_1')).toMatchObject({
      type: 'private',
      typeName: '私訊',
      senderName: '王小明',
      time: '2026/10/27 12:00',
      fromUid: CALLER,
    });
  });

  test('合法的「使用者→管理員」範本通知顯示不變（system／系統／系統，時間為伺服器時間）', async () => {
    const env = load({
      users: {
        [CALLER]: { role: 'user', displayName: '王小明' },
        [OTHER]: { role: 'admin' },
      },
    });
    await env.call({
      message: msg({ title: '有用戶欲申請身分權限', body: '通知有用戶 王小明 欲申請相關權限' }),
      ...adminRoles,
    });
    expect(env.inbox(OTHER, 'msg_1')).toMatchObject({
      type: 'system',
      typeName: '系統',
      senderName: '系統',
      time: '2026/10/27 12:00',
      title: '有用戶欲申請身分權限',
    });
  });

  test('非 admin 的俱樂部廣播（本俱樂部成員）：顯示欄位同樣由伺服器決定', async () => {
    const env = load({
      users: {
        [CALLER]: { role: 'captain', displayName: '隊長', teamId: 't1' },
        [TARGET]: { role: 'user', teamId: 't1' },
      },
    });
    await expect(env.call({
      message: msg({ type: '任意', senderName: '別人', typeName: '客戶端值' }),
      targetTeamId: 't1',
      targetType: 'team',
    })).resolves.toEqual({ success: true, delivered: 2 });
    expect(env.inbox(TARGET, 'msg_1')).toMatchObject({ type: 'private', typeName: '私訊', senderName: '隊長' });
  });

  test('有 actionType 的審核類訊息不套用顯示欄位覆寫（維持現行逐類檢查）', async () => {
    const CAPTAIN = `U${'k'.repeat(32)}`;
    const env = load({
      users: {
        [CALLER]: { role: 'user', displayName: '王小明' },
        [CAPTAIN]: { role: 'captain' },
      },
      extraSeed: { 'teams/tJoin': { id: 'tJoin', name: '北區俱樂部', captainUid: CAPTAIN, coachUids: [] } },
    });
    await expect(env.call({
      message: msg({
        id: 'msg_join',
        type: 'system',
        typeName: '客戶端值',
        senderName: '申請人自訂',
        time: '客戶端時間',
        actionType: 'team_join_request',
        actionStatus: 'pending',
        meta: {
          teamId: 'tJoin',
          teamName: '北區俱樂部',
          applicantUid: CALLER,
          applicantName: '王小明',
          groupId: 'tjr_1729650000000_ab3d',
        },
      }),
      targetUid: CAPTAIN,
    })).resolves.toEqual({ success: true, delivered: 1 });
    expect(env.inbox(CAPTAIN, 'msg_join')).toMatchObject({
      actionType: 'team_join_request',
      typeName: '客戶端值',
      senderName: '申請人自訂',
      time: '客戶端時間',
    });
  });

  test('重複的 message id 仍回 already-exists（既有行為）', async () => {
    const env = load({ users: baseUsers() });
    await env.call({ message: msg(), targetUid: TARGET });
    await expect(env.call({ message: msg(), targetUid: TARGET })).rejects.toMatchObject({
      code: 'already-exists',
      message: 'MESSAGE_ID_ALREADY_EXISTS',
    });
  });

  test('點對點一般層每分鐘：上限內投遞、超過一筆 resource-exhausted 且不寫入', async () => {
    const env = load({ users: baseUsers() });
    await repeat(L.inbox.userPerMinute, (i) => env.call({ message: msg({ id: `msg_${i}` }), targetUid: TARGET }));
    await expect(env.call({ message: msg({ id: 'msg_over' }), targetUid: TARGET })).rejects.toMatchObject(RATE_LIMITED);
    expect(env.db.has(`users/${TARGET}/inbox/msg_over`)).toBe(false);
    env.clock.t += MINUTE_MS;
    await expect(env.call({ message: msg({ id: 'msg_next' }), targetUid: TARGET })).resolves.toEqual({ success: true, delivered: 1 });
  });

  test('廣播（使用者→管理員）同樣受一般層每分鐘上限', async () => {
    const env = load({
      users: {
        [CALLER]: { role: 'user', displayName: '王小明' },
        [OTHER]: { role: 'admin' },
      },
    });
    const broadcast = (id) => env.call({ message: msg({ id }), ...adminRoles });
    await repeat(L.inbox.userPerMinute, (i) => broadcast(`msg_${i}`));
    await expect(broadcast('msg_over')).rejects.toMatchObject(RATE_LIMITED);
    expect(env.db.has(`users/${OTHER}/inbox/msg_over`)).toBe(false);
  });

  test('教練以上的批次投遞（活動異動逐人通知）不受一般層上限影響', async () => {
    const env = load({
      users: {
        [CALLER]: { role: 'coach', displayName: '教練' },
        [TARGET]: { role: 'user' },
      },
    });
    const total = L.inbox.userPerMinute + 20;
    await repeat(total, (i) => env.call({ message: msg({ id: `msg_${i}` }), targetUid: TARGET }));
    expect(env.db.has(`users/${TARGET}/inbox/msg_${total - 1}`)).toBe(true);
  });

  test('讀取呼叫者文件失敗：回 sanitized internal、記錄錯誤碼、不寫入', async () => {
    const env = load({
      users: baseUsers(),
      faults: { read: ({ path: docPath }) => (docPath === `users/${CALLER}` ? new FakeError(14, `UNAVAILABLE ${CALLER}`) : null) },
    });
    await expect(env.call({ message: msg(), targetUid: TARGET })).rejects.toMatchObject({
      code: 'internal',
      message: 'Failed to deliver to inbox',
    });
    expect(env.consoleImpl.out.errors).toEqual([['[deliverToInbox] caller lookup failed', { code: 14 }]]);
    expect(JSON.stringify(env.consoleImpl.out.errors)).not.toContain(CALLER);
    expect(env.db.has(`users/${TARGET}/inbox/msg_1`)).toBe(false);
    expect(counterPaths(env.db)).toHaveLength(0);
  });

  test('計數故障：一般層回 sanitized internal 不寫入；教練以上照常投遞並記錄', async () => {
    const faults = { getAll: () => new FakeError(14, 'UNAVAILABLE') };
    const user = load({ users: baseUsers(), faults });
    await expect(user.call({ message: msg(), targetUid: TARGET })).rejects.toMatchObject({
      code: 'internal',
      message: 'Failed to verify request limits',
    });
    expect(user.db.has(`users/${TARGET}/inbox/msg_1`)).toBe(false);
    const staff = load({ users: { ...baseUsers(), [CALLER]: { role: 'coach', displayName: '教練' } }, faults });
    await expect(staff.call({ message: msg(), targetUid: TARGET })).resolves.toEqual({ success: true, delivered: 1 });
    expect(staff.consoleImpl.out.errors[0]).toEqual([
      '[notificationGuards] counter failure',
      { gate: 'caller_minute', kind: 'inbox', staff: true, failOpen: true, code: 14 },
    ]);
  });
});
