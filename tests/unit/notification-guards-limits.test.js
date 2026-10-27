/**
 * 通知發送授權強化（第 1 批）— 節流與每日上限（functions/notification-guards.js）單元測試。
 * 閾值一律對照 functions/notification-guard-limits.js 的 NOTIFICATION_GUARD_LIMITS。
 */

const fs = require('fs');
const path = require('path');
const fields = require('../../functions/notification-fields');
const { FakeError } = require('./notification-guards-fake-db');
const {
  ROLE_LEVELS, T0, DAY, MINUTE_MS, CALLER, TARGET, OTHER, RATE_LIMITED,
  NOTIFICATION_GUARD_LIMITS: L, COUNTER_COLLECTION,
  createGuardsEnv, seedCounter, sumCounters, repeat,
} = require('./notification-guards-test-helpers');

const enq = (guards, extra = {}) => guards.enforceCallerLimit({
  kind: 'enqueue', callerUid: CALLER, callerRole: 'user', ...extra,
});
const inbox = (guards, extra = {}) => guards.enforceCallerLimit({
  kind: 'inbox', callerUid: CALLER, callerRole: 'user', ...extra,
});
const daily = (guards, extra = {}) => guards.enforceDailyLimits({
  callerUid: CALLER, callerRole: 'user', targetUid: TARGET, ...extra,
});
const gateLogs = (logger, gate) => logger.warns.filter(([msg, data]) => msg === '[notificationGuards] gate triggered' && data.gate === gate);

describe('閾值與角色層級', () => {
  test('閾值對照（暫定值；調整時需同步 docs/tunables.md）', () => {
    expect(L).toMatchObject({
      enqueue: { userPerMinute: 150, staffPerMinute: 2000, userPerDay: 300 },
      inbox: { userPerMinute: 300, staffPerMinute: 2000, userPerDay: 600 },
      targetPerDay: 30,
      callerTargetPerDay: 10,
      globalPerDay: { user: 1000, staff: 2000 },
      dedupeWindowMs: 600000,
    });
    [L, L.enqueue, L.inbox, L.globalPerDay].forEach((group) => expect(Object.isFrozen(group)).toBe(true));
  });

  test('測試用的 ROLE_LEVELS 與 functions/index.js 一致', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'functions', 'index.js'), 'utf8');
    const match = source.match(/const ROLE_LEVELS = Object\.freeze\((\{[^}]*\})\);/);
    expect(match).not.toBeNull();
    // eslint-disable-next-line no-new-func
    expect(new Function(`return ${match[1]};`)()).toEqual(ROLE_LEVELS);
  });

  test('教練以上＝角色等級 ≥ coach；自訂角色、未知角色、髒資料視為一般層', () => {
    const { guards } = createGuardsEnv();
    ['user', ' user ', '', '  ', undefined, null, 5, {}, [], 'custom_staff', 'constructor', '__proto__', 'toString']
      .forEach((role) => expect(guards.isStaffRole(role)).toBe(false));
    ['coach', 'captain', 'venue_owner', 'admin', 'super_admin', ' coach ']
      .forEach((role) => expect(guards.isStaffRole(role)).toBe(true));
  });
});

describe('每呼叫者每分鐘（enforceCallerLimit）', () => {
  test('入列·一般層：上限內通過、超過一筆即 resource-exhausted', async () => {
    const { guards } = createGuardsEnv();
    await repeat(L.enqueue.userPerMinute, () => enq(guards));
    await expect(enq(guards)).rejects.toMatchObject(RATE_LIMITED);
  });

  test('不同呼叫者各自計數；下一分鐘重置', async () => {
    const { guards, clock } = createGuardsEnv();
    await repeat(L.enqueue.userPerMinute, () => enq(guards));
    await expect(enq(guards)).rejects.toMatchObject(RATE_LIMITED);
    await expect(enq(guards, { callerUid: OTHER })).resolves.toBeUndefined();
    clock.t += MINUTE_MS;
    await expect(enq(guards)).resolves.toBeUndefined();
  });

  test('站內信·一般層：上限內通過、超過一筆即拒絕；入列與站內信分開計數', async () => {
    const { guards } = createGuardsEnv();
    await repeat(L.inbox.userPerMinute, () => inbox(guards));
    await expect(inbox(guards)).rejects.toMatchObject(RATE_LIMITED);
    await expect(enq(guards)).resolves.toBeUndefined();
  });

  test('教練以上：超過一般層上限仍通過', async () => {
    const { guards } = createGuardsEnv();
    await repeat(L.enqueue.userPerMinute * 3, () => enq(guards, { callerRole: 'admin' }));
    await repeat(L.inbox.userPerMinute * 2, () => inbox(guards, { callerRole: 'coach' }));
  });

  test('教練以上：到各自的較高上限才拒絕', async () => {
    const { guards } = createGuardsEnv();
    await repeat(L.enqueue.staffPerMinute, () => enq(guards, { callerRole: 'admin' }));
    await expect(enq(guards, { callerRole: 'admin' })).rejects.toMatchObject(RATE_LIMITED);
  }, 30000);

  test('自訂角色視為一般層，適用一般層上限', async () => {
    const { guards } = createGuardsEnv();
    await repeat(L.enqueue.userPerMinute, () => enq(guards, { callerRole: 'custom_staff' }));
    await expect(enq(guards, { callerRole: 'custom_staff' })).rejects.toMatchObject(RATE_LIMITED);
  });

  test('超限記錄：每（閘, 分鐘, 呼叫者）一筆，含遮罩呼叫者、source、計數與上限，不依賴恰好超出一筆', async () => {
    const { guards, logger, clock } = createGuardsEnv();
    const source = 'template:event_changed';
    await repeat(L.enqueue.userPerMinute, () => enq(guards, { source }));
    await repeat(25, () => enq(guards, { source }).catch(() => {}));
    const logs = gateLogs(logger, 'caller_minute');
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toMatchObject({
      gate: 'caller_minute',
      kind: 'enqueue',
      caller: fields.maskUid(CALLER),
      source,
      limit: L.enqueue.userPerMinute,
    });
    expect(logs[0][1].count).toBeGreaterThan(L.enqueue.userPerMinute);
    expect(JSON.stringify(logger.warns)).not.toContain(CALLER);
    clock.t += MINUTE_MS;
    await repeat(L.enqueue.userPerMinute + 3, () => enq(guards, { source }).catch(() => {}));
    expect(gateLogs(logger, 'caller_minute')).toHaveLength(2);
    await repeat(L.enqueue.userPerMinute + 3, () => enq(guards, { callerUid: OTHER }).catch(() => {}));
    expect(gateLogs(logger, 'caller_minute')).toHaveLength(3);
  });

  test('超限記錄的 source 未通過格式驗證時為 null', async () => {
    const { guards, logger } = createGuardsEnv();
    await repeat(L.enqueue.userPerMinute + 1, () => enq(guards, { source: 'bad source!' }).catch(() => {}));
    expect(gateLogs(logger, 'caller_minute')[0][1].source).toBeNull();
  });

  test('25 個同時到達的一般層呼叫：上限內全數通過', async () => {
    const { guards } = createGuardsEnv();
    const results = await Promise.allSettled(Array.from({ length: 25 }, () => enq(guards)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(25);
  });

  test('接近上限時同時到達：至少拒絕超出的筆數（先遞增再讀回，可能多拒，不會少拒）', async () => {
    const { guards } = createGuardsEnv();
    const headroom = 10;
    await repeat(L.enqueue.userPerMinute - headroom, () => enq(guards));
    const results = await Promise.allSettled(Array.from({ length: 25 }, () => enq(guards)));
    const passed = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.length - passed;
    expect(rejected).toBeGreaterThanOrEqual(25 - headroom);
    expect(passed).toBeLessThanOrEqual(headroom);
    results.filter((r) => r.status === 'rejected').forEach((r) => expect(r.reason).toMatchObject(RATE_LIMITED));
  });

  test('計數故障：一般層回 sanitized internal 並記錄；教練以上放行並記錄', async () => {
    const faults = {
      write: ({ path: docPath }) => (docPath.startsWith(`${COUNTER_COLLECTION}/`) ? new FakeError(14, `UNAVAILABLE ${CALLER}`) : null),
    };
    const user = createGuardsEnv({ faults });
    await expect(enq(user.guards)).rejects.toMatchObject({ code: 'internal', message: 'Failed to verify request limits' });
    expect(user.logger.errors).toEqual([[
      '[notificationGuards] counter failure',
      { gate: 'caller_minute', kind: 'enqueue', staff: false, failOpen: false, code: 14 },
    ]]);
    const staff = createGuardsEnv({ faults });
    await expect(enq(staff.guards, { callerRole: 'admin' })).resolves.toBeUndefined();
    expect(staff.logger.errors).toEqual([[
      '[notificationGuards] counter failure',
      { gate: 'caller_minute', kind: 'enqueue', staff: true, failOpen: true, code: 14 },
    ]]);
    expect(JSON.stringify([user.logger.errors, staff.logger.errors])).not.toContain(CALLER);
  });
});

describe('站內信 一般層每日上限', () => {
  async function fillDay(guards, clock) {
    const minutes = Math.ceil(L.inbox.userPerDay / L.inbox.userPerMinute);
    for (let k = 0; k < minutes; k += 1) {
      clock.t = T0 + k * MINUTE_MS;
      await repeat(Math.min(L.inbox.userPerMinute, L.inbox.userPerDay - k * L.inbox.userPerMinute), () => inbox(guards));
    }
    clock.t = T0 + minutes * MINUTE_MS;
  }

  test('每日上限內通過、超過即拒絕並記錄；台北換日後重置', async () => {
    const { guards, clock, logger } = createGuardsEnv();
    await fillDay(guards, clock);
    await expect(inbox(guards)).rejects.toMatchObject(RATE_LIMITED);
    const logs = gateLogs(logger, 'caller_day');
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toMatchObject({ gate: 'caller_day', kind: 'inbox', limit: L.inbox.userPerDay });
    clock.t = Date.UTC(2026, 9, 27, 16, 1, 0);
    await expect(inbox(guards)).resolves.toBeUndefined();
  }, 30000);

  test('教練以上不受每日上限，也不建立每日計數', async () => {
    const { guards, db } = createGuardsEnv();
    await repeat(L.inbox.userPerDay + 50, () => inbox(guards, { callerRole: 'admin' }));
    expect(sumCounters(db, 'caller_day_inbox')).toBe(0);
  }, 30000);
});

describe('每日上限（enforceDailyLimits）', () => {
  test('每（呼叫者, 目標）每日：上限內通過、超過拒絕並記錄；換目標不受影響', async () => {
    const { guards, logger } = createGuardsEnv();
    await repeat(L.callerTargetPerDay, () => daily(guards));
    await expect(daily(guards)).rejects.toMatchObject(RATE_LIMITED);
    expect(gateLogs(logger, 'caller_target_day')).toHaveLength(1);
    await expect(daily(guards, { targetUid: OTHER })).resolves.toBeUndefined();
  });

  test('每目標每日：多位一般層呼叫者合計達上限後，下一位被拒絕並記錄', async () => {
    const { guards, logger } = createGuardsEnv();
    const callers = L.targetPerDay / L.callerTargetPerDay;
    for (let i = 0; i < callers; i += 1) {
      await repeat(L.callerTargetPerDay, () => daily(guards, { callerUid: `${CALLER}${i}` }));
    }
    await expect(daily(guards, { callerUid: `${CALLER}extra` })).rejects.toMatchObject(RATE_LIMITED);
    expect(gateLogs(logger, 'target_day')).toHaveLength(1);
  });

  test('教練以上不計入每目標與每（呼叫者, 目標）上限，也不影響一般層額度', async () => {
    const { guards, db } = createGuardsEnv();
    await repeat(L.targetPerDay + 20, () => daily(guards, { callerRole: 'admin' }));
    expect(sumCounters(db, `${DAY}_target_`)).toBe(0);
    expect(sumCounters(db, 'caller_target_day')).toBe(0);
    await expect(daily(guards)).resolves.toBeUndefined();
    expect(sumCounters(db, `${DAY}_target_`)).toBe(1);
  });

  test('一般層每呼叫者每日：上限內通過（不同目標）、超過拒絕並記錄；教練以上不受限', async () => {
    const { guards, logger, db } = createGuardsEnv();
    await repeat(L.enqueue.userPerDay, (i) => daily(guards, { targetUid: `${TARGET}${i}` }));
    await expect(daily(guards, { targetUid: `${TARGET}over` })).rejects.toMatchObject(RATE_LIMITED);
    const logs = gateLogs(logger, 'caller_day');
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toMatchObject({ gate: 'caller_day', kind: 'enqueue', limit: L.enqueue.userPerDay });
    await repeat(L.enqueue.userPerDay + 20, (i) => daily(guards, { callerRole: 'admin', targetUid: `${TARGET}s${i}` }));
    expect(sumCounters(db, 'caller_day_enqueue')).toBeGreaterThan(0);
  }, 60000);

  test('台北換日（23:59 → 00:01）後各項每日計數重置', async () => {
    const { guards, clock } = createGuardsEnv();
    clock.t = Date.UTC(2026, 9, 27, 15, 59, 0);
    await repeat(L.callerTargetPerDay, () => daily(guards));
    await expect(daily(guards)).rejects.toMatchObject(RATE_LIMITED);
    clock.t = Date.UTC(2026, 9, 27, 16, 1, 0);
    await expect(daily(guards)).resolves.toBeUndefined();
  });

  test('被前面的閘擋下的請求不消耗全域池額度', async () => {
    const { guards, db } = createGuardsEnv();
    await repeat(L.callerTargetPerDay, () => daily(guards));
    await repeat(3, () => daily(guards).catch(() => {}));
    expect(sumCounters(db, `${DAY}_global_enqueue_user_s`)).toBe(L.callerTargetPerDay);
  });
});

describe('全域每日池（入列端）', () => {
  test('一般層池：用滿後一般層被拒絕、error 只記一次；教練以上不受影響', async () => {
    const { guards, db, logger } = createGuardsEnv();
    await seedCounter(db, `${DAY}_global_enqueue_user_s0`, L.globalPerDay.user);
    await expect(daily(guards)).rejects.toMatchObject(RATE_LIMITED);
    await expect(daily(guards, { callerUid: OTHER })).rejects.toMatchObject(RATE_LIMITED);
    expect(logger.errors).toEqual([[
      '[notificationGuards] global daily cap reached',
      { gate: 'global_pool_user', kind: 'enqueue', day: DAY, limit: L.globalPerDay.user },
    ]]);
    expect(gateLogs(logger, 'global_pool_user')).toHaveLength(2);
    await expect(daily(guards, { callerRole: 'admin' })).resolves.toBeUndefined();
  });

  test('教練以上池：用滿後教練以上被拒絕；一般層不受影響', async () => {
    const { guards, db, logger } = createGuardsEnv();
    await seedCounter(db, `${DAY}_global_enqueue_staff_s0`, L.globalPerDay.staff);
    await expect(daily(guards, { callerRole: 'admin' })).rejects.toMatchObject(RATE_LIMITED);
    expect(logger.errors).toEqual([[
      '[notificationGuards] global daily cap reached',
      { gate: 'global_pool_staff', kind: 'enqueue', day: DAY, limit: L.globalPerDay.staff },
    ]]);
    await expect(daily(guards)).resolves.toBeUndefined();
  });

  test('一般層池實際累計：上限內通過、超過一筆被拒絕；隔天重置', async () => {
    const { guards, clock } = createGuardsEnv();
    await repeat(L.globalPerDay.user, (i) => daily(guards, { callerUid: `${CALLER}${i}`, targetUid: `${TARGET}${i}` }));
    await expect(daily(guards, { callerUid: `${CALLER}z`, targetUid: `${TARGET}z` })).rejects.toMatchObject(RATE_LIMITED);
    clock.t += 24 * 60 * MINUTE_MS;
    await expect(daily(guards, { callerUid: `${CALLER}z`, targetUid: `${TARGET}z` })).resolves.toBeUndefined();
  }, 60000);

  test('記錄標記寫入遇到非「已存在」錯誤：記 warn 並仍回 RATE_LIMITED', async () => {
    const { guards, db, logger } = createGuardsEnv({
      faults: { write: ({ path: docPath }) => (docPath.includes('_cap_') ? new FakeError(14, 'UNAVAILABLE') : null) },
    });
    await seedCounter(db, `${DAY}_global_enqueue_user_s0`, L.globalPerDay.user);
    await expect(daily(guards)).rejects.toMatchObject(RATE_LIMITED);
    expect(logger.warns.filter(([msg]) => msg === '[notificationGuards] cap marker failed')).toEqual([[
      '[notificationGuards] cap marker failed',
      { gate: 'global_pool_user', kind: 'enqueue', code: 14 },
    ]]);
    expect(logger.errors).toHaveLength(0);
  });

  test('計數故障：一般層回 sanitized internal；教練以上放行（皆有記錄）', async () => {
    const faults = { getAll: () => new FakeError(14, 'UNAVAILABLE') };
    const user = createGuardsEnv({ faults });
    await expect(daily(user.guards)).rejects.toMatchObject({ code: 'internal', message: 'Failed to verify request limits' });
    expect(user.logger.errors).toEqual([[
      '[notificationGuards] counter failure',
      { gate: 'caller_day', kind: 'enqueue', staff: false, failOpen: false, code: 14 },
    ]]);
    const staff = createGuardsEnv({ faults });
    await expect(daily(staff.guards, { callerRole: 'admin' })).resolves.toBeUndefined();
    expect(staff.logger.errors).toEqual([[
      '[notificationGuards] counter failure',
      { gate: 'global_pool_staff', kind: 'enqueue', staff: true, failOpen: true, code: 14 },
    ]]);
  });
});
