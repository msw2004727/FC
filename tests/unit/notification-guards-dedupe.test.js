/**
 * 通知發送授權強化（第 1 批）— 推播處理端的去重與全域每日池（checkBeforePush / releaseDedupe）單元測試。
 */

const fields = require('../../functions/notification-fields');
const { FakeError } = require('./notification-guards-fake-db');
const {
  T0, DAY, MINUTE_MS, CALLER, TARGET, OTHER,
  NOTIFICATION_GUARD_LIMITS: L, DEDUPE_COLLECTION, COUNTER_COLLECTION,
  createGuardsEnv, seedCounter, sumCounters, repeat,
} = require('./notification-guards-test-helpers');

const TEN_MIN = 10 * 60 * 1000; // 寫死，不由匯入常數推算
const KEY = 'event_changed:e1:u1:abc';
const OK = { skip: false, reason: '' };
const DUP = { skip: true, reason: 'duplicate' };
const CAP = { skip: true, reason: 'daily_cap' };

const push = (guards, queueId, extra = {}) => guards.checkBeforePush({
  queueId,
  uid: TARGET,
  dedupeKey: KEY,
  requestedByUid: CALLER,
  requestedByRole: 'user',
  source: 'template:event_changed',
  ...extra,
});
const dedupeDocs = (db) => db.paths(`${DEDUPE_COLLECTION}/`);

describe('dedupeKey 去重視窗', () => {
  test('視窗為 10 分鐘', () => {
    expect(L.dedupeWindowMs).toBe(TEN_MIN);
  });

  test('沒有 dedupeKey：不建立去重文件，一律放行', async () => {
    const { guards, db } = createGuardsEnv();
    await expect(push(guards, 'q1', { dedupeKey: '' })).resolves.toEqual(OK);
    await expect(push(guards, 'q2', { dedupeKey: undefined })).resolves.toEqual(OK);
    await expect(push(guards, 'q3', { dedupeKey: 42 })).resolves.toEqual(OK);
    expect(dedupeDocs(db)).toHaveLength(0);
  });

  test('視窗邊界：9:59 為重複；10:01 放行並重新計時', async () => {
    const { guards, clock } = createGuardsEnv();
    await expect(push(guards, 'q1')).resolves.toEqual(OK);
    clock.t = T0 + TEN_MIN - 1000; // 9:59
    await expect(push(guards, 'q2')).resolves.toEqual(DUP);
    clock.t = T0 + TEN_MIN + 1000; // 10:01
    await expect(push(guards, 'q3')).resolves.toEqual(OK);
    clock.t += TEN_MIN - 1000; // q3 之後 9:59
    await expect(push(guards, 'q4')).resolves.toEqual(DUP);
  });

  test('剛好滿 10 分鐘視為視窗外', async () => {
    const { guards, clock } = createGuardsEnv();
    await push(guards, 'q1');
    clock.t = T0 + TEN_MIN;
    await expect(push(guards, 'q2')).resolves.toEqual(OK);
  });

  test('同一收件者、同一內容鍵，隔 30 分鐘與 2 小時照常發送', async () => {
    const { guards, clock } = createGuardsEnv();
    await expect(push(guards, 'q1')).resolves.toEqual(OK);
    clock.t = T0 + 30 * MINUTE_MS;
    await expect(push(guards, 'q2')).resolves.toEqual(OK);
    clock.t = T0 + 120 * MINUTE_MS;
    await expect(push(guards, 'q3')).resolves.toEqual(OK);
  });

  test('同一文件重試（相同 queueId）不算重複', async () => {
    const { guards } = createGuardsEnv();
    await push(guards, 'q1');
    await expect(push(guards, 'q1')).resolves.toEqual(OK);
  });

  test('相同 dedupeKey 但不同收件者各自發送（多收件者共用同一把鍵）', async () => {
    const { guards } = createGuardsEnv();
    await expect(push(guards, 'q1', { uid: `${TARGET}a` })).resolves.toEqual(OK);
    await expect(push(guards, 'q2', { uid: `${TARGET}b` })).resolves.toEqual(OK);
  });

  test('同時到達的兩份文件只有一份放行', async () => {
    const { guards } = createGuardsEnv();
    const results = await Promise.all([push(guards, 'q1'), push(guards, 'q2')]);
    expect(results.filter((r) => r.skip === false)).toHaveLength(1);
    expect(results.filter((r) => r.reason === 'duplicate')).toHaveLength(1);
  });

  test('釋放：持有者釋放後可重送；非持有者釋放無效；沒有 key 時不動作', async () => {
    const { guards, db } = createGuardsEnv();
    await push(guards, 'q1');
    await guards.releaseDedupe({ queueId: 'other', uid: TARGET, dedupeKey: KEY });
    await expect(push(guards, 'q2')).resolves.toEqual(DUP);
    await guards.releaseDedupe({ queueId: 'q1', uid: TARGET, dedupeKey: '' });
    expect(dedupeDocs(db)).toHaveLength(1);
    await guards.releaseDedupe({ queueId: 'q1', uid: TARGET, dedupeKey: KEY });
    expect(dedupeDocs(db)).toHaveLength(0);
    await expect(push(guards, 'q3')).resolves.toEqual(OK);
  });

  test('重複時寫一筆記錄：遮罩呼叫者、source、已過時間與視窗，不含完整 UID', async () => {
    const { guards, logger, clock } = createGuardsEnv();
    await push(guards, 'q1');
    clock.t = T0 + 90 * 1000;
    await push(guards, 'q2');
    await push(guards, 'q3');
    const logs = logger.warns.filter(([msg, data]) => msg === '[notificationGuards] gate triggered' && data.gate === 'dedupe');
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toEqual({
      gate: 'dedupe',
      kind: 'send',
      caller: fields.maskUid(CALLER),
      source: 'template:event_changed',
      count: 90 * 1000,
      limit: TEN_MIN,
    });
    expect(JSON.stringify(logger.warns)).not.toContain(CALLER);
    expect(JSON.stringify(logger.warns)).not.toContain(TARGET);
  });

  test('釋放失敗只記 warn，不拋出', async () => {
    const { guards, logger } = createGuardsEnv({ faults: { transaction: () => new FakeError(14, 'UNAVAILABLE') } });
    await expect(guards.releaseDedupe({ queueId: 'q1', uid: TARGET, dedupeKey: KEY })).resolves.toBeUndefined();
    expect(logger.warns).toEqual([['[notificationGuards] dedupe release failed', { queueId: 'q1', code: 14 }]]);
  });
});

describe('全域每日發送池（處理端）', () => {
  test('一般層池：用滿後一般層 daily_cap（釋放去重標記、error 只記一次）；系統與教練以上不受影響', async () => {
    const { guards, db, logger } = createGuardsEnv();
    await seedCounter(db, `${DAY}_global_send_user_s0`, L.globalPerDay.user);
    await expect(push(guards, 'q1')).resolves.toEqual(CAP);
    await expect(push(guards, 'q2', { uid: OTHER, requestedByUid: OTHER })).resolves.toEqual(CAP);
    expect(dedupeDocs(db)).toHaveLength(0);
    expect(logger.errors).toEqual([[
      '[notificationGuards] global daily cap reached',
      { gate: 'global_pool_user', kind: 'send', day: DAY, limit: L.globalPerDay.user },
    ]]);
    await expect(push(guards, 'q3', { requestedByUid: 'system', requestedByRole: 'system' })).resolves.toEqual(OK);
    await expect(push(guards, 'q4', { uid: OTHER, requestedByRole: 'admin' })).resolves.toEqual(OK);
  });

  test('教練以上＋系統池：用滿後被擋；一般層不受影響', async () => {
    const { guards, db, logger } = createGuardsEnv();
    await seedCounter(db, `${DAY}_global_send_staff_s0`, L.globalPerDay.staff);
    await expect(push(guards, 'q1', { requestedByUid: 'system', requestedByRole: 'system' })).resolves.toEqual(CAP);
    await expect(push(guards, 'q2', { uid: OTHER, requestedByRole: 'coach' })).resolves.toEqual(CAP);
    expect(logger.errors).toEqual([[
      '[notificationGuards] global daily cap reached',
      { gate: 'global_pool_staff', kind: 'send', day: DAY, limit: L.globalPerDay.staff },
    ]]);
    await expect(push(guards, 'q3', { uid: `${OTHER}u` })).resolves.toEqual(OK);
  });

  test('層級無法判斷（缺 requestedBy、自訂角色、髒資料）歸一般層', async () => {
    const { guards, db } = createGuardsEnv();
    await seedCounter(db, `${DAY}_global_send_user_s0`, L.globalPerDay.user);
    await expect(push(guards, 'q1', { uid: 'u1', requestedByUid: undefined, requestedByRole: undefined })).resolves.toEqual(CAP);
    await expect(push(guards, 'q2', { uid: 'u2', requestedByRole: 'custom_staff' })).resolves.toEqual(CAP);
    await expect(push(guards, 'q3', { uid: 'u3', requestedByRole: { admin: true } })).resolves.toEqual(CAP);
  });

  test('一般層池實際累計：上限內放行、超過一筆 daily_cap', async () => {
    const { guards } = createGuardsEnv();
    await repeat(L.globalPerDay.user, (i) => guards.checkBeforePush({ queueId: `q${i}`, uid: `${TARGET}${i}`, dedupeKey: '' }));
    await expect(push(guards, 'qover', { dedupeKey: '' })).resolves.toEqual(CAP);
  }, 60000);

  test('重複的文件不消耗發送額度', async () => {
    const { guards, db } = createGuardsEnv();
    await push(guards, 'q1');
    await repeat(3, (i) => push(guards, `dup${i}`));
    expect(sumCounters(db, `${DAY}_global_send_user_s`)).toBe(1);
  });

  test('已持有認領的文件重試時遇到上限：回 daily_cap 但保留原認領', async () => {
    const { guards, db } = createGuardsEnv();
    await expect(push(guards, 'q1')).resolves.toEqual(OK);
    await seedCounter(db, `${DAY}_global_send_user_s0`, L.globalPerDay.user);
    await expect(push(guards, 'q1')).resolves.toEqual(CAP);
    expect(dedupeDocs(db)).toHaveLength(1);
    await expect(push(guards, 'q2')).resolves.toEqual(DUP);
  });

  test('隔天池子重置', async () => {
    const { guards, db, clock } = createGuardsEnv();
    await seedCounter(db, `${DAY}_global_send_user_s0`, L.globalPerDay.user);
    await expect(push(guards, 'q1', { dedupeKey: '' })).resolves.toEqual(CAP);
    clock.t += 24 * 60 * MINUTE_MS;
    await expect(push(guards, 'q2', { dedupeKey: '' })).resolves.toEqual(OK);
  });
});

describe('處理端計數或去重故障：放行並記錄', () => {
  test('去重 transaction 失敗：放行，error 含 queueId 與錯誤碼', async () => {
    const { guards, logger } = createGuardsEnv({ faults: { transaction: () => new FakeError(14, 'UNAVAILABLE') } });
    await expect(push(guards, 'q1')).resolves.toEqual(OK);
    expect(logger.errors).toEqual([['[notificationGuards] pre-push check failed, allow', { queueId: 'q1', code: 14 }]]);
  });

  test('全域池計數失敗：放行，並以 failOpen 記錄', async () => {
    const { guards, logger } = createGuardsEnv({
      faults: { write: ({ path: docPath }) => (docPath.startsWith(`${COUNTER_COLLECTION}/`) ? new FakeError(14, 'UNAVAILABLE') : null) },
    });
    await expect(push(guards, 'q1', { dedupeKey: '' })).resolves.toEqual(OK);
    expect(logger.errors).toEqual([[
      '[notificationGuards] counter failure',
      { gate: 'global_pool_user', kind: 'send', staff: false, failOpen: true, code: 14 },
    ]]);
  });
});
