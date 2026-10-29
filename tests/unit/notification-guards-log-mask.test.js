/**
 * 通知發送授權強化（第 2 批）— 既有 LINE console 遮罩。
 * 切片方式對齊 notification-guards-callables.test.js：從 functions/index.js 切出
 * enqueuePrivilegedLineNotification 與 processLinePushQueue，放進 vm 沙盒。
 * uid 用測試輔助檔的長 uid；遮罩比對呼叫 maskUid，不手寫整段遮罩字串。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { maskUid } = require('../../functions/notification-fields');
const { createNotificationGuards } = require('../../functions/notification-guards');
const { createFakeDb, FieldValue } = require('./notification-guards-fake-db');
const {
  TestHttpsError, ROLE_LEVELS, T0, CALLER, TARGET,
  createRelationSandbox,
} = require('./notification-guards-test-helpers');

const TITLE = 'XQ_TITLE_MARKER';
const BODY = 'XQ_BODY_MARKER';

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

function serializedConsole(consoleImpl) {
  return JSON.stringify([consoleImpl.out.logs, consoleImpl.out.warns, consoleImpl.out.errors]);
}

// 序列化全部 console 呼叫：不含 title／body、完整 uid、uid 中段
function assertNoSecrets(consoleImpl, uids = [CALLER, TARGET]) {
  const serialized = serializedConsole(consoleImpl);
  expect(serialized).not.toContain(TITLE);
  expect(serialized).not.toContain(BODY);
  uids.forEach((uid) => {
    const middle = uid.slice(2, -2);
    expect(middle.length).toBeGreaterThan(4);
    expect(serialized).not.toContain(uid);
    expect(serialized).not.toContain(middle);
  });
  return serialized;
}

function findCall(calls, needle) {
  const hit = calls.filter(([msg]) => String(msg).includes(needle));
  expect(hit).toHaveLength(1);
  return hit[0];
}

function boom(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

describe('enqueuePrivilegedLineNotification log 遮罩', () => {
  const sourceParts = [
    readSourceBetween('const ALLOWED_LINE_NOTIFICATION_CATEGORIES', 'const DEFAULT_NOTIFICATION_TEMPLATES'),
    readSourceBetween('function normalizeLineNotificationCategory(', 'function getDefaultNotificationTemplates'),
    readSourceBetween('function getLineRecipientUidFromUserDoc(', 'function getDisplayNameFromAuthRecord'),
    readSourceBetween('function getLineNotificationSettingsKey(', 'function getLineHttpStatus'),
    readSourceBetween('exports.enqueuePrivilegedLineNotification', '/**\n * processLinePushQueue'),
  ];

  function boundUser(extra = {}) {
    return {
      uid: TARGET,
      lineUserId: TARGET,
      lineNotify: { bound: true, settings: { activity: true, system: true } },
      ...extra,
    };
  }

  function load({ users = { [TARGET]: boundUser() }, roles = {}, clock, faults } = {}) {
    const seed = {};
    Object.entries(users).forEach(([uid, data]) => { seed[`users/${uid}`] = data; });
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
      maskUid,
    };
    vm.runInNewContext(sourceParts.join('\n'), sandbox, { filename: 'enqueue-log-mask.vm.js' });
    const callable = sandbox.exports.enqueuePrivilegedLineNotification;
    return {
      ...env,
      call: (data, uid = CALLER) => callable.handler({ auth: { uid }, data }),
    };
  }

  const payload = (extra = {}) => ({
    uid: TARGET,
    title: TITLE,
    body: BODY,
    category: 'activity',
    source: 'template:event_changed',
    dedupeKey: 'event_changed:e1:u1:h',
    ...extra,
  });

  test('queued log 的 uid 已遮罩', async () => {
    const env = load();
    await expect(env.call(payload())).resolves.toMatchObject({ queued: true, queueId: 'auto_1' });
    const queuedLog = findCall(env.consoleImpl.out.logs, '[enqueuePrivilegedLineNotification] queued');
    expect(queuedLog[1]).toEqual({
      queueId: 'auto_1',
      source: 'template:event_changed',
      requestedByUid: maskUid(CALLER),
      requestedByRole: 'user',
      targetUid: maskUid(TARGET),
      category: 'activity',
    });
    const serialized = assertNoSecrets(env.consoleImpl);
    expect(serialized).toContain(maskUid(CALLER));
    expect(serialized).toContain(maskUid(TARGET));
  });
});

describe('processLinePushQueue log 遮罩', () => {
  const sourceParts = [
    readSourceBetween('exports.processLinePushQueue', '//  Shot Game'),
  ];

  function load({ clock, faults, seed, pushImpl, unbind } = {}) {
    const env = createEnv({ faults, clock, seed });
    class FakeMessagingApiClient {
      async pushMessage(arg) {
        if (pushImpl) await pushImpl(arg);
      }
    }
    const sandbox = {
      db: env.db,
      FieldValue,
      onDocumentCreated: (options, handler) => ({ options, handler }),
      LINE_CHANNEL_ACCESS_TOKEN: { value: () => 'token' },
      getMessagingApi: () => ({ MessagingApiClient: FakeMessagingApiClient }),
      shouldAutoUnbindLineRecipient: async () => unbind || { shouldUnbind: false, reason: 'stub' },
      findUserDocByUidOrLineUserId: async () => null,
      exports: {},
      console: env.consoleImpl,
      notificationGuards: env.guards,
      maskUid,
    };
    vm.runInNewContext(sourceParts.join('\n'), sandbox, { filename: 'process-log-mask.vm.js' });
    const handler = sandbox.exports.processLinePushQueue.handler;
    return {
      ...env,
      async run(id, extra = {}) {
        const ref = env.db.collection('linePushQueue').doc(id);
        await ref.set({
          uid: TARGET,
          title: TITLE,
          body: BODY,
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

  test('缺少必要欄位 log 只留 queueId', async () => {
    const env = load();
    // body 留空才會走進缺欄位；title 與長 uid 仍在文件上，舊 log 會把它們印出來
    const doc = await env.run('q-missing', { body: '' });
    expect(doc).toMatchObject({ status: 'failed', error: '缺少必要欄位 (uid/title/body)' });
    const hit = findCall(env.consoleImpl.out.errors, '缺少必要欄位');
    expect(hit[0]).toBe('[LinePush] 缺少必要欄位: q-missing');
    expect(hit[1]).toEqual({ queueId: 'q-missing' });
    assertNoSecrets(env.consoleImpl);
  });

  test('發送成功 log 的 uid 已遮罩', async () => {
    const env = load();
    const doc = await env.run('q-sent');
    expect(doc.status).toBe('sent');
    const hit = findCall(env.consoleImpl.out.logs, '發送成功');
    expect(hit[0]).toBe('[LinePush] 發送成功: q-sent');
    expect(hit[1]).toEqual({ queueId: 'q-sent', uid: maskUid(TARGET) });
    const serialized = assertNoSecrets(env.consoleImpl);
    expect(serialized).toContain(maskUid(TARGET));
  });

  test('發送失敗 log 只留 queueId 與 code', async () => {
    const env = load({
      pushImpl: async () => { throw boom('PUSH_BOOM_MESSAGE', 'push-boom'); },
    });
    const doc = await env.run('q-fail');
    expect(doc).toMatchObject({ status: 'failed', error: 'PUSH_BOOM_MESSAGE' });
    const hit = findCall(env.consoleImpl.out.errors, '發送失敗');
    expect(hit[0]).toBe('[LinePush] 發送失敗: q-fail');
    expect(hit[1]).toEqual({ queueId: 'q-fail', code: 'push-boom' });
    const serialized = assertNoSecrets(env.consoleImpl);
    expect(serialized).not.toContain('PUSH_BOOM_MESSAGE');
  });

  test('keep binding log 的 uid 已遮罩', async () => {
    const env = load({
      pushImpl: async () => { throw boom('PUSH_BOOM_MESSAGE', 'push-boom'); },
    });
    await env.run('q-keep');
    const hit = findCall(env.consoleImpl.out.logs, 'keep binding after failed push');
    expect(hit[1]).toEqual({
      uid: maskUid(TARGET),
      queueId: 'q-keep',
      reason: 'stub',
      source: 'template:event_changed',
      requestedByUid: maskUid(CALLER),
      requestedByRole: 'user',
    });
    const serialized = assertNoSecrets(env.consoleImpl);
    expect(serialized).toContain(maskUid(CALLER));
    expect(serialized).toContain(maskUid(TARGET));
    expect(serialized).not.toContain('PUSH_BOOM_MESSAGE');
  });

  test('自動解綁成功 log 的 uid 已遮罩', async () => {
    const env = load({
      seed: { [`users/${TARGET}`]: { uid: TARGET, lineNotify: { bound: true } } },
      pushImpl: async () => { throw boom('PUSH_BOOM_MESSAGE', 'push-boom'); },
      unbind: { shouldUnbind: true, reason: 'profile_status_404' },
    });
    await env.run('q-unbind');
    const hit = findCall(env.consoleImpl.out.logs, '已自動解綁用戶推播');
    expect(hit[0]).toBe('[LinePush] 已自動解綁用戶推播');
    expect(hit[1]).toEqual({ queueId: 'q-unbind', uid: maskUid(TARGET) });
    const serialized = assertNoSecrets(env.consoleImpl);
    expect(serialized).toContain(maskUid(TARGET));
    expect(serialized).not.toContain('PUSH_BOOM_MESSAGE');
  });

  test('自動解綁失敗 log 只留 queueId、遮罩 uid 與 code', async () => {
    const env = load({
      seed: { [`users/${TARGET}`]: { uid: TARGET, lineNotify: { bound: true } } },
      pushImpl: async () => { throw boom('PUSH_BOOM_MESSAGE', 'push-boom'); },
      unbind: { shouldUnbind: true, reason: 'profile_status_404' },
      faults: {
        write: ({ op, path }) => {
          if (op === 'update' && path === `users/${TARGET}`) return boom('UNBIND_BOOM_MESSAGE', 'unbind-boom');
          return null;
        },
      },
    });
    await env.run('q-unbind-fail');
    const hit = findCall(env.consoleImpl.out.errors, '自動解綁失敗');
    expect(hit[0]).toBe('[LinePush] 自動解綁失敗');
    expect(hit[1]).toEqual({
      queueId: 'q-unbind-fail',
      uid: maskUid(TARGET),
      code: 'unbind-boom',
    });
    const serialized = assertNoSecrets(env.consoleImpl);
    expect(serialized).toContain(maskUid(TARGET));
    expect(serialized).not.toContain('PUSH_BOOM_MESSAGE');
    expect(serialized).not.toContain('UNBIND_BOOM_MESSAGE');
  });
});
