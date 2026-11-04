/**
 * T-090g 顧問裁定（方案 A）：enqueuePrivilegedLineNotification 抽出的共用段與伺服器內部路徑 enqueueLineFromServer。
 * 作法同 notification-guards-callables.test.js：從 functions/index.js 切出實際原始碼放進 vm 沙盒，
 * 搭配記憶體版 Firestore 與真實 notification-guards／關係檢查。
 * 修正前：index.js 沒有 enqueueLineFromServer，本檔的伺服器路徑測試全部失敗（函式不存在）。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createNotificationGuards } = require('../../functions/notification-guards');
const { createFakeDb, FieldValue } = require('./notification-guards-fake-db');
const {
  TestHttpsError, ROLE_LEVELS, T0, DAY, CALLER, TARGET, COUNTER_COLLECTION, createRelationSandbox,
} = require('./notification-guards-test-helpers');

function readSourceBetween(startNeedle, endNeedle) {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'functions', 'index.js'), 'utf8')
    .replace(/\r\n/g, '\n');
  const start = source.indexOf(startNeedle);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const sourceParts = () => [
  readSourceBetween('const ALLOWED_LINE_NOTIFICATION_CATEGORIES', 'const DEFAULT_NOTIFICATION_TEMPLATES'),
  readSourceBetween('function normalizeLineNotificationCategory(', 'function getDefaultNotificationTemplates'),
  readSourceBetween('function getLineRecipientUidFromUserDoc(', 'function getDisplayNameFromAuthRecord'),
  readSourceBetween('function getLineNotificationSettingsKey(', 'function getLineHttpStatus'),
  readSourceBetween('exports.enqueuePrivilegedLineNotification', '/**\n * processLinePushQueue'),
];

const boundUser = (extra = {}) => ({
  uid: TARGET, lineUserId: TARGET, lineNotify: { bound: true, settings: { activity: true, system: true } }, ...extra,
});

function load({ users = { [TARGET]: boundUser() }, roles = {}, flags = null } = {}) {
  const seed = {};
  Object.entries(users).forEach(([uid, data]) => { seed[`users/${uid}`] = data; });
  if (flags) seed['siteConfig/featureFlags'] = flags;
  const db = createFakeDb({ seed });
  const out = { logs: [], warns: [], errors: [] };
  const consoleImpl = {
    log: (...args) => out.logs.push(args), info: () => {},
    warn: (...args) => out.warns.push(args), error: (...args) => out.errors.push(args),
  };
  const guards = createNotificationGuards({
    db, FieldValue, HttpsError: TestHttpsError, roleLevels: ROLE_LEVELS, now: () => T0, random: () => 0, logger: consoleImpl,
  });
  const relation = createRelationSandbox({ db, guards });
  const check = jest.fn(relation.notificationRelation.check);
  const sandbox = {
    db, HttpsError: TestHttpsError, onCall: (options, handler) => ({ options, handler }), FieldValue,
    exports: {}, console: consoleImpl, notificationGuards: guards,
    ...relation, notificationRelation: { ...relation.notificationRelation, check },
    getCallerRoleWithFallback: async (request) => roles[request.auth.uid] || 'user',
    findUserDocByUidOrLineUserId: async (uid) => {
      const snap = await db.collection('users').doc(uid).get();
      return snap.exists ? { docId: snap.id, data: snap.data() } : null;
    },
  };
  vm.runInNewContext(sourceParts().join('\n'), sandbox, { filename: 'enqueue-line-from-server.vm.js' });
  return {
    db, out, check,
    enqueueLineFromServer: sandbox.enqueueLineFromServer,
    call: (data, uid = CALLER) => sandbox.exports.enqueuePrivilegedLineNotification.handler({ auth: { uid }, data }),
  };
}

const queued = (db) => db.paths('linePushQueue/').map((p) => db.read(p));
const dailyCounters = (db) => db.paths(`${COUNTER_COLLECTION}/`).filter((p) => p.includes(DAY));
const serverInput = (extra = {}) => ({
  uid: TARGET, category: 'system', title: '俱樂部申請通過', body: '恭喜！您已成功加入「FC」俱樂部，審核人：R。',
  source: 'team_join_review:approve', dedupeKey: 'team_join_review:tjr_1700000000000_test',
  requestedByUid: CALLER, requestedByRole: 'user', ...extra,
});

describe('enqueueLineFromServer（伺服器內部路徑）', () => {
  test.each([['user', 'user'], ['captain', 'staff'], ['admin', 'staff']])('角色 %s：入列、寫明 requestedBy 與 pool=%s，不經關係守門', async (role, pool) => {
    const env = load();
    await expect(env.enqueueLineFromServer(serverInput({ requestedByRole: role })))
      .resolves.toEqual({ queued: true, skipped: false, queueId: expect.any(String) });
    expect(queued(env.db)).toEqual([expect.objectContaining({
      uid: TARGET, targetDocId: TARGET, category: 'system', status: 'pending', source: 'team_join_review:approve',
      requestedByUid: CALLER, requestedByRole: role, pool, dedupeKey: 'team_join_review:tjr_1700000000000_test',
    })]);
    expect(env.check).not.toHaveBeenCalled();
    expect(env.out.logs.some(([msg]) => msg === '[enqueueLineFromServer] queued')).toBe(true);
  });

  test('每日上限沿用客戶端路徑：一般層審核人計入呼叫者／目標計數', async () => {
    const env = load();
    await env.enqueueLineFromServer(serverInput());
    const scopes = dailyCounters(env.db).join('\n');
    expect(scopes).toMatch(/caller_day_enqueue/);
    expect(scopes).toMatch(/caller_target_day/);
    expect(scopes).toMatch(/global_enqueue_user/);
  });

  test.each([
    ['未綁定', { users: { [TARGET]: boundUser({ lineNotify: { bound: false } }) } }, 'not_bound'],
    ['個人關閉系統類', { users: { [TARGET]: boundUser({ lineNotify: { bound: true, settings: { system: false } } }) } }, 'category_disabled'],
    ['全站關閉系統類', { flags: { notificationToggles: { category_system: false } } }, 'notification_toggle_disabled'],
    ['查無收件者', { users: {} }, 'target_not_found'],
  ])('%s：不入列、不扣每日額度', async (_name, options, reason) => {
    const env = load(options);
    await expect(env.enqueueLineFromServer(serverInput())).resolves.toEqual({ queued: false, skipped: true, reason });
    expect(queued(env.db)).toHaveLength(0);
    expect(dailyCounters(env.db)).toHaveLength(0);
  });

  test.each([
    { uid: '' }, { title: '' }, { body: 'x'.repeat(2001) }, { category: 'unknown' }, { source: 'bad source!' },
    { requestedByUid: '' }, { requestedByUid: null },
  ])('不合格輸入直接拋錯、不入列：%j', async (patch) => {
    const env = load();
    await expect(env.enqueueLineFromServer(serverInput(patch))).rejects.toThrow('INVALID_SERVER_LINE_NOTIFICATION');
    expect(queued(env.db)).toHaveLength(0);
  });
});

describe('enqueuePrivilegedLineNotification（客戶端 Callable）等價重構', () => {
  const clientPayload = (extra = {}) => ({
    uid: TARGET, title: '標題', body: '內文', category: 'system', source: 'client:line-push', ...extra,
  });

  test('客戶端偽造伺服器欄位無法繞過守門：仍跑關係檢查，requestedBy／pool 由伺服器決定', async () => {
    const env = load();
    await expect(env.call(clientPayload({
      source: 'template:event_changed', category: 'activity',
      requestedByUid: 'system', requestedByRole: 'super_admin', pool: 'staff',
      serverInternal: true, skipRelation: true, internal: true,
    }))).resolves.toMatchObject({ queued: true, skipped: false });
    expect(env.check).toHaveBeenCalledTimes(1);
    expect(env.check.mock.calls[0][0]).toMatchObject({ kind: 'enqueue', callerUid: CALLER, recipientUid: TARGET });
    expect(queued(env.db)).toEqual([expect.objectContaining({ requestedByUid: CALLER, requestedByRole: 'user', pool: 'user' })]);
    expect(env.out.logs.some(([msg]) => msg === '[enqueuePrivilegedLineNotification] queued')).toBe(true);
  });

  test.each([
    ['未綁定', { users: { [TARGET]: boundUser({ lineNotify: { bound: false } }) } }, 'not_bound'],
    ['個人關閉', { users: { [TARGET]: boundUser({ lineNotify: { bound: true, settings: { system: false } } }) } }, 'category_disabled'],
    ['全站關閉', { flags: { notificationToggles: { category_system: false } } }, 'notification_toggle_disabled'],
    ['查無收件者', { users: {} }, 'target_not_found'],
  ])('%s：回傳形狀不變，且在關係檢查之前略過', async (_name, options, reason) => {
    const env = load(options);
    await expect(env.call(clientPayload())).resolves.toEqual({ queued: false, skipped: true, reason });
    expect(env.check).not.toHaveBeenCalled();
    expect(queued(env.db)).toHaveLength(0);
  });
});
