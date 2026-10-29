/**
 * 通知發送授權強化（第 1 批）— 三個入口的整合測試。
 * 與 cloud-functions.test.js 相同作法：從 functions/index.js 切出實際原始碼放進 vm 沙盒執行，
 * 搭配記憶體版 Firestore 與真實的 notification-guards（可控時鐘）。閾值一律對照 NOTIFICATION_GUARD_LIMITS。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fields = require('../../functions/notification-fields');
const { createNotificationGuards } = require('../../functions/notification-guards');
const { createFakeDb, FieldValue, FakeError } = require('./notification-guards-fake-db');
const {
  TestHttpsError, ROLE_LEVELS, T0, DAY, MINUTE_MS, CALLER, TARGET, OTHER, RATE_LIMITED,
  NOTIFICATION_GUARD_LIMITS: L, COUNTER_COLLECTION, DEDUPE_COLLECTION, repeat, seedCounter,
  createRelationSandbox,
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
const relationWarns = (consoleImpl) => consoleImpl.out.warns
  .filter(([msg, data]) => msg === '[notificationGuards] gate triggered' && String(data.gate).startsWith('relation_'));
// 與 notification-guards.js 的計數器文件 id 規則相同（用來把某個計數器預先設到上限）
const hashId = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
const minuteCounterId = (clockMs, scope, subject) => `m${Math.floor(clockMs / 60000)}_${scope}_${hashId(subject)}_s0`;

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

  function load({ users = { [TARGET]: boundUser() }, roles = {}, flags = null, clock, faults, extraSeed = {} } = {}) {
    const seed = { ...extraSeed };
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
      ...createRelationSandbox({ db: env.db, guards: env.guards }),
      getCallerRoleWithFallback: async (request) => roles[request.auth.uid] || 'user',
      findUserDocByUidOrLineUserId: async (uid) => {
        const snap = await env.db.collection('users').doc(uid).get();
        if (snap.exists) return { docId: snap.id, data: snap.data() };
        const byLine = await env.db.collection('users').where('lineUserId', '==', uid).get();
        return byLine.docs.length > 0 ? { docId: byLine.docs[0].id, data: byLine.docs[0].data() } : null;
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
      pool: 'user', // 測試同步更新（第 2 批）：入列文件新增伺服器寫的 pool，其餘欄位不變
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

  // 測試同步更新（第 2 批）：這兩個 source 缺關聯鍵，會多一筆 relation_missing_key log；斷言改成「沒有 unknown source 那一筆」
  test('已知 source 不記未知 source log', async () => {
    const env = load();
    await env.call(payload({ source: 'template:event_changed' }));
    await env.call(payload({ source: 'team_join_request', uid: `${TARGET}b` }));
    expect(env.consoleImpl.out.warns.filter(([msg]) => msg === '[enqueuePrivilegedLineNotification] unknown source')).toHaveLength(0);
    expect(relationWarns(env.consoleImpl).every(([, data]) => data.gate === 'relation_missing_key')).toBe(true);
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
  describe('關係檢查', () => {
    const eventSeed = (eventExtra = {}, regExtra = {}) => ({
      'events/e1': { id: 'e1', creatorUid: CALLER, ...eventExtra },
      'events/e1/registrations/r1': { userId: TARGET, status: 'confirmed', ...regExtra },
    });
    const dayCounters = (db) => counterPaths(db).filter((p) => p.includes(DAY));
    const minuteCounters = (db) => counterPaths(db).filter((p) => p.includes('_caller_enqueue_'));

    test('R0 本人通過：入列並寫 pool user', async () => {
      const env = load();
      await expect(env.call(payload({ source: 'template:welcome', dedupeKey: '' }), TARGET)).resolves.toMatchObject({ queued: true });
      expect(env.db.read('linePushQueue/auto_1')).toMatchObject({ requestedByUid: TARGET, pool: 'user' });
      expect(relationWarns(env.consoleImpl)).toHaveLength(0);
    });

    test('R0 佇列 uid 是 lineUserId 時，只要 user 文件屬於本人仍通過', async () => {
      const lineId = `U${'l'.repeat(32)}`;
      const env = load({ users: { [TARGET]: boundUser({ lineUserId: lineId }) } });
      await expect(env.call(payload({ source: 'template:welcome', uid: lineId }), TARGET)).resolves.toMatchObject({ queued: true });
      expect(env.db.read('linePushQueue/auto_1')).toMatchObject({ uid: lineId, targetDocId: TARGET });
    });

    test('R0 他人拒絕：permission-denied／NOT_ALLOWED，不入列；caller_day 與任何 global 計數不變，分鐘計數可增加', async () => {
      const env = load();
      await expect(env.call(payload({ source: 'template:welcome' }))).rejects.toMatchObject({
        code: 'permission-denied',
        message: 'NOT_ALLOWED',
      });
      expect(queued(env.db)).toHaveLength(0);
      expect(dayCounters(env.db)).toHaveLength(0); // caller_day／caller_target_day／target／global_* 全為每日計數
      expect(minuteCounters(env.db)).toHaveLength(1);
      const logs = relationWarns(env.consoleImpl);
      expect(logs).toHaveLength(1);
      expect(logs[0][1]).toMatchObject({
        gate: 'relation_denied',
        kind: 'enqueue',
        caller: fields.maskUid(CALLER),
        source: 'template:welcome',
        relation: 'R0',
      });
    });

    test('略過判斷仍在關係檢查之前：未綁定的他人目標回 not_bound，不是 permission-denied', async () => {
      const env = load({ users: { [OTHER]: boundUser({ uid: OTHER, lineUserId: OTHER, lineNotify: { bound: false } }) } });
      await expect(env.call(payload({ source: 'template:welcome', uid: OTHER }))).resolves.toEqual({
        queued: false,
        skipped: true,
        reason: 'not_bound',
      });
      expect(relationWarns(env.consoleImpl)).toHaveLength(0);
    });

    test('R7 收件者 role 不是 admin／super_admin：拒絕；是 admin 則入列', async () => {
      const source = 'template:role_application:admins';
      const denied = load({ users: { [TARGET]: boundUser({ role: 'user' }) } });
      await expect(denied.call(payload({ source }))).rejects.toMatchObject({ code: 'permission-denied', message: 'NOT_ALLOWED' });
      expect(queued(denied.db)).toHaveLength(0);
      expect(relationWarns(denied.consoleImpl)[0][1]).toMatchObject({ gate: 'relation_denied', relation: 'R7' });
      const allowed = load({ users: { [TARGET]: boundUser({ role: 'admin' }) } });
      await expect(allowed.call(payload({ source }))).resolves.toMatchObject({ queued: true });
    });

    test('R1 缺 eventId：仍入列並記 relation_missing_key，且仍計入 caller_day', async () => {
      const env = load();
      await expect(env.call(payload())).resolves.toMatchObject({ queued: true });
      const logs = relationWarns(env.consoleImpl);
      expect(logs).toHaveLength(1);
      expect(logs[0][1]).toMatchObject({
        gate: 'relation_missing_key',
        kind: 'enqueue',
        source: 'template:event_changed',
        relation: 'R1',
        hasEventId: false,
      });
      expect(env.db.read(`${COUNTER_COLLECTION}/${DAY}_caller_day_enqueue_${hashId(CALLER)}_s0`).count).toBe(1);
    });

    test('R1 鍵齊：活動管理者＋有效報名者通過；取消報名或非管理者拒絕', async () => {
      const ok = load({ extraSeed: eventSeed() });
      await expect(ok.call(payload({ eventId: 'e1' }))).resolves.toMatchObject({ queued: true });
      expect(ok.db.read('linePushQueue/auto_1').pool).toBe('user');
      const cancelled = load({ extraSeed: eventSeed({}, { status: 'cancelled' }) });
      await expect(cancelled.call(payload({ eventId: 'e1' }))).rejects.toMatchObject({ code: 'permission-denied' });
      const notManager = load({ extraSeed: eventSeed({ creatorUid: OTHER }) });
      await expect(notManager.call(payload({ eventId: 'e1' }))).rejects.toMatchObject({ code: 'permission-denied' });
      expect(queued(notManager.db)).toHaveLength(0);
      expect(dayCounters(notManager.db)).toHaveLength(0);
    });

    test('client:unknown 且收件者不是本人：只記錄（clientUnknown）並放行，仍計入每日', async () => {
      const env = load();
      await expect(env.call(payload({ source: '' }))).resolves.toMatchObject({ queued: true });
      expect(relationWarns(env.consoleImpl)[0][1]).toMatchObject({
        gate: 'relation_missing_key',
        relation: 'client_unknown',
        clientUnknown: true,
      });
      expect(env.db.read(`${COUNTER_COLLECTION}/${DAY}_caller_day_enqueue_${hashId(CALLER)}_s0`).count).toBe(1);
    });

    test('payload 的 mode／enforcement／relationMode 無效：R0 仍拒絕、R1 缺 eventId 仍只記錄', async () => {
      const env = load();
      await expect(env.call(payload({ source: 'template:welcome', mode: 'log', enforcement: 'log', relationMode: 'log' })))
        .rejects.toMatchObject({ code: 'permission-denied' });
      await expect(env.call(payload({ mode: 'enforce', enforcement: 'enforce', relationMode: 'enforce' })))
        .resolves.toMatchObject({ queued: true });
    });

    test('payload 的 pool 無效：一般層送 pool staff／event，文件上仍是 user', async () => {
      const env = load();
      await env.call(payload({ pool: 'staff' }));
      await env.call(payload({ pool: 'event', dedupeKey: 'k2' }));
      expect(env.db.read('linePushQueue/auto_1').pool).toBe('user');
      expect(env.db.read('linePushQueue/auto_2').pool).toBe('user');
      expect(env.db.read(`${COUNTER_COLLECTION}/${DAY}_global_enqueue_user_s0`).count).toBe(2);
      expect(env.db.has(`${COUNTER_COLLECTION}/${DAY}_global_enqueue_staff_s0`)).toBe(false);
      expect(counterPaths(env.db).some((p) => p.includes('global_enqueue_event'))).toBe(false);
    });

    test('教練以上入列寫 pool staff（客戶端送 pool user 也一樣）', async () => {
      const env = load({ roles: { [CALLER]: 'admin' } });
      await env.call(payload({ pool: 'user' }));
      expect(env.db.read('linePushQueue/auto_1').pool).toBe('staff');
    });

    test('每分鐘閘擋下時：不出現 relation log、不讀 events、不扣每日', async () => {
      const reads = [];
      const faults = { read: ({ path: docPath }) => { reads.push(docPath); return null; } };
      const env = load({ faults, extraSeed: eventSeed() });
      await seedCounter(env.db, minuteCounterId(T0, 'caller_enqueue', CALLER), L.enqueue.userPerMinute);
      await expect(env.call(payload({ eventId: 'e1' }))).rejects.toMatchObject(RATE_LIMITED);
      expect(relationWarns(env.consoleImpl)).toHaveLength(0);
      expect(reads.filter((p) => p.startsWith('events/'))).toHaveLength(0);
      expect(dayCounters(env.db)).toHaveLength(0);
    });

    test('關係 log 不含 title／body／完整 uid／關聯鍵的值', async () => {
      const env = load();
      await env.call(payload({ source: 'template:welcome' })).catch(() => {});
      await env.call(payload({ eventId: 'eventSecretValue' })).catch(() => {});
      await env.call(payload({ source: 'team_join_request', teamId: 'teamSecretValue' })).catch(() => {});
      expect(relationWarns(env.consoleImpl).length).toBeGreaterThanOrEqual(3);
      const serialized = JSON.stringify(env.consoleImpl.out.warns);
      [CALLER, TARGET, '標題', '內文', 'eventSecretValue', 'teamSecretValue'].forEach((text) => {
        expect(serialized).not.toContain(text);
      });
    });

    test('未知 source 不額外加 relation log（只有第 1 批的 unknown source）', async () => {
      const env = load();
      await env.call(payload({ source: 'brand_new_source' }));
      expect(relationWarns(env.consoleImpl)).toHaveLength(0);
    });

    test('同一呼叫者同一分鐘同一類別的 relation log 只寫一筆；換分鐘再寫', async () => {
      const env = load();
      await env.call(payload({ dedupeKey: '' }));
      await env.call(payload({ dedupeKey: '' }));
      expect(relationWarns(env.consoleImpl)).toHaveLength(1);
      env.clock.t += MINUTE_MS;
      await env.call(payload({ dedupeKey: '' }));
      expect(relationWarns(env.consoleImpl)).toHaveLength(2);
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
      maskUid: fields.maskUid,
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
    // 測試同步更新（第 2 批）：沒有 pool 一律歸一般層（不看 requestedByRole），system 仍 staff；pool:'staff' 才扣 staff 池
    expect((await env.run('q3', { requestedByUid: 'system', requestedByRole: 'system' })).status).toBe('sent');
    expect(await env.run('q4', { requestedByRole: 'admin' })).toMatchObject({ status: 'skipped', reason: 'daily_cap' });
    expect((await env.run('q5', { requestedByRole: 'admin', pool: 'staff' })).status).toBe('sent');
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
      ...createRelationSandbox({ db: env.db, guards: env.guards }),
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

  describe('關係檢查', () => {
    const dayInboxPaths = (db) => counterPaths(db).filter((p) => p.includes('caller_day_inbox'));
    const dayInboxCount = (db) => dayInboxPaths(db).reduce((sum, p) => sum + db.read(p).count, 0);
    const minuteInboxPaths = (db) => counterPaths(db).filter((p) => p.includes('_caller_inbox_'));

    test('站內信 R0 他人拒絕：permission-denied／NOT_ALLOWED，一筆 inbox 都不寫，不增加 caller_day_inbox（分鐘計數可增加）', async () => {
      const env = load({ users: baseUsers() });
      await expect(env.call({ message: msg({ source: 'template:welcome' }), targetUid: TARGET })).rejects.toMatchObject({
        code: 'permission-denied',
        message: 'NOT_ALLOWED',
      });
      expect(env.db.paths('users/').filter((p) => p.includes('/inbox/'))).toHaveLength(0);
      expect(dayInboxPaths(env.db)).toHaveLength(0);
      expect(minuteInboxPaths(env.db)).toHaveLength(1);
      const logs = relationWarns(env.consoleImpl);
      expect(logs).toHaveLength(1);
      expect(logs[0][1]).toMatchObject({
        gate: 'relation_denied',
        kind: 'inbox',
        caller: fields.maskUid(CALLER),
        source: 'template:welcome',
        relation: 'R0',
      });
    });

    test('站內信 R0 本人通過：投遞並計入 caller_day_inbox', async () => {
      const env = load({ users: baseUsers() });
      await expect(env.call({ message: msg({ source: 'template:welcome' }), targetUid: CALLER })).resolves.toEqual({
        success: true,
        delivered: 1,
      });
      expect(dayInboxCount(env.db)).toBe(1);
      expect(relationWarns(env.consoleImpl)).toHaveLength(0);
    });

    test('沒有 source 的訊息（現行前端）：不歸類、不記 relation log、不拒絕，仍計入 caller_day_inbox', async () => {
      const env = load({ users: baseUsers() });
      await expect(env.call({ message: msg(), targetUid: TARGET })).resolves.toEqual({ success: true, delivered: 1 });
      expect(relationWarns(env.consoleImpl)).toHaveLength(0);
      expect(dayInboxCount(env.db)).toBe(1);
    });

    test('source 格式不合格（logSafeSource 為 null）視同沒有 source', async () => {
      const env = load({ users: baseUsers() });
      await expect(env.call({ message: msg({ source: 'bad source!' }), targetUid: TARGET })).resolves.toEqual({
        success: true,
        delivered: 1,
      });
      expect(relationWarns(env.consoleImpl)).toHaveLength(0);
    });

    test('有 actionType 的審核類訊息不套關係檢查（即使帶了會被 R0 拒絕的 source）', async () => {
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
          source: 'template:welcome',
          actionType: 'team_join_request',
          actionStatus: 'pending',
          meta: { teamId: 'tJoin', teamName: '北區俱樂部', applicantUid: CALLER, applicantName: '王小明', groupId: 'tjr_1729650000000_ab3d' },
        }),
        targetUid: CAPTAIN,
      })).resolves.toEqual({ success: true, delivered: 1 });
      expect(relationWarns(env.consoleImpl)).toHaveLength(0);
    });

    test('R7 廣播：一般使用者→管理員投遞；targetRoles 含其他角色的整筆拒絕（admin 呼叫者）', async () => {
      const source = 'template:role_application:admins';
      const user = load({
        users: { [CALLER]: { role: 'user', displayName: '王小明' }, [OTHER]: { role: 'admin' } },
      });
      await expect(user.call({ message: msg({ source }), ...adminRoles })).resolves.toEqual({ success: true, delivered: 1 });
      const admin = load({
        users: { [CALLER]: { role: 'admin', displayName: '管理員' }, [TARGET]: { role: 'coach' } },
      });
      await expect(admin.call({ message: msg({ source }), targetRoles: ['admin', 'coach'], targetType: 'role' }))
        .rejects.toMatchObject({ code: 'permission-denied', message: 'NOT_ALLOWED' });
      expect(admin.db.has(`users/${TARGET}/inbox/msg_1`)).toBe(false);
    });

    // 顧問裁定（R7 合成收件者的三個前提）：(a) targetRoles 空／未帶不得通過 (b) 只有 R7 能靠這段通過 (c) 不逐人補發
    test('R7 廣播前提：沒有 targetRoles（全體廣播）整筆拒絕；非 R7 的 source 不能靠廣播的合成收件者通過', async () => {
      const source = 'template:role_application:admins';
      const admin = load({
        users: { [CALLER]: { role: 'admin', displayName: '管理員' }, [TARGET]: { role: 'admin' } },
      });
      await expect(admin.call({ message: msg({ source }), targetType: 'all' }))
        .rejects.toMatchObject({ code: 'permission-denied', message: 'NOT_ALLOWED' });
      await expect(admin.call({ message: msg({ source }), targetRoles: [], targetType: 'role' }))
        .rejects.toMatchObject({ code: 'permission-denied', message: 'NOT_ALLOWED' });
      // R0 的 source 對 admin 角色廣播：合成的 role 不會讓「收件者是本人」成立
      await expect(admin.call({ message: msg({ source: 'template:welcome' }), ...adminRoles }))
        .rejects.toMatchObject({ code: 'permission-denied', message: 'NOT_ALLOWED' });
      expect(admin.db.has(`users/${TARGET}/inbox/msg_1`)).toBe(false);
    });

    test('R7 廣播前提：同時帶 targetTeamId（實際送達隊員）即使 targetRoles 全是 admin 也整筆拒絕', async () => {
      const source = 'template:role_application:admins';
      const admin = load({
        users: { [CALLER]: { role: 'admin', displayName: '管理員' }, [TARGET]: { role: 'admin', teamId: 'tm_x', teamIds: ['tm_x'] } },
      });
      await expect(admin.call({ message: msg({ source }), targetRoles: ['admin'], targetType: 'team', targetTeamId: 'tm_x' }))
        .rejects.toMatchObject({ code: 'permission-denied', message: 'NOT_ALLOWED' });
      await expect(admin.call({ message: msg({ source }), targetRoles: ['admin'], targetType: 'role', targetTeamId: 'tm_x' }))
        .rejects.toMatchObject({ code: 'permission-denied', message: 'NOT_ALLOWED' });
      expect(admin.db.has(`users/${TARGET}/inbox/msg_1`)).toBe(false);
    });

    test('既有廣播權限檢查先返回：文案不變、不進關係表、不增加 caller_day_inbox', async () => {
      const env = load({ users: baseUsers() });
      await expect(env.call({
        message: msg({ source: 'template:welcome' }),
        targetRoles: ['coach'],
        targetType: 'role',
      })).rejects.toMatchObject({ code: 'permission-denied', message: 'Only admins can broadcast to roles or all users' });
      expect(relationWarns(env.consoleImpl)).toHaveLength(0);
      expect(dayInboxPaths(env.db)).toHaveLength(0);
    });

    test('每分鐘閘擋下時：不出現 relation log、不扣每日', async () => {
      const env = load({ users: baseUsers() });
      await seedCounter(env.db, minuteCounterId(T0, 'caller_inbox', CALLER), L.inbox.userPerMinute);
      await expect(env.call({ message: msg({ source: 'template:welcome' }), targetUid: TARGET })).rejects.toMatchObject(RATE_LIMITED);
      expect(relationWarns(env.consoleImpl)).toHaveLength(0);
      expect(dayInboxPaths(env.db)).toHaveLength(0);
    });

    test('每日閘在關係檢查之後：每日用滿時，他人 R0 先被關係檢查拒絕（permission-denied），本人則被每日閘拒絕', async () => {
      const env = load({ users: baseUsers() });
      await seedCounter(env.db, `${DAY}_caller_day_inbox_${hashId(CALLER)}_s0`, L.inbox.userPerDay);
      await expect(env.call({ message: msg({ source: 'template:welcome' }), targetUid: TARGET })).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(env.call({ message: msg({ source: 'template:welcome' }), targetUid: CALLER })).rejects.toMatchObject(RATE_LIMITED);
    });

    test('關係 log 不含 title／body／完整 uid', async () => {
      const env = load({ users: baseUsers() });
      await env.call({ message: msg({ source: 'template:welcome' }), targetUid: TARGET }).catch(() => {});
      expect(relationWarns(env.consoleImpl)).toHaveLength(1);
      const serialized = JSON.stringify(env.consoleImpl.out.warns);
      [CALLER, TARGET, '標題', '內文'].forEach((text) => expect(serialized).not.toContain(text));
    });
  });
});
