/**
 * 通知發送授權強化（第 1 批）— functions/notification-guards.js、notification-fields.js 單元測試。
 * 用記憶體版 Firestore＋可控時鐘，驗證節流邊界、換日重置、去重視窗與基礎設施失敗行為。
 */

const {
  createNotificationGuards,
  isStaffRole,
  COUNTER_COLLECTION,
  DEDUPE_COLLECTION,
  DEDUPE_WINDOW_MS,
} = require('../../functions/notification-guards');
const fields = require('../../functions/notification-fields');
const { createFakeDb, FieldValue, FakeError } = require('./notification-guards-fake-db');

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// 台北 2026-10-27 12:00（UTC 04:00）
const T0 = Date.UTC(2026, 9, 27, 4, 0, 0);
const CALLER = `U${'c'.repeat(32)}`;
const TARGET = `U${'t'.repeat(32)}`;
const HOUR_MS = 60 * 60 * 1000;

function makeLogger() {
  const logger = { warns: [], errors: [] };
  logger.warn = (...args) => logger.warns.push(args);
  logger.error = (...args) => logger.errors.push(args);
  return logger;
}

function setup({ faults } = {}) {
  const db = createFakeDb({ faults });
  const clock = { t: T0 };
  const logger = makeLogger();
  const guards = createNotificationGuards({
    db,
    FieldValue,
    HttpsError: TestHttpsError,
    now: () => clock.t,
    random: () => 0,
    logger,
  });
  return { db, clock, logger, guards };
}

function sumCounters(db, fragment) {
  return db.paths(`${COUNTER_COLLECTION}/`)
    .filter((path) => path.includes(fragment))
    .reduce((sum, path) => sum + (db.read(path).count || 0), 0);
}

async function repeat(count, fn) {
  for (let i = 0; i < count; i += 1) {
    await fn(i);
  }
}

const RATE_LIMITED = { code: 'resource-exhausted', message: 'RATE_LIMITED' };

describe('每呼叫者節流（enforceCallerLimit）', () => {
  test('一般使用者入列：第 20 次通過、第 21 次 resource-exhausted', async () => {
    const { guards } = setup();
    await repeat(20, () => guards.enforceCallerLimit('enqueue', CALLER, 'user'));
    await expect(guards.enforceCallerLimit('enqueue', CALLER, 'user')).rejects.toMatchObject(RATE_LIMITED);
  });

  test('不同呼叫者各自計數；下一分鐘重置', async () => {
    const { guards, clock } = setup();
    await repeat(20, () => guards.enforceCallerLimit('enqueue', CALLER, 'user'));
    await expect(guards.enforceCallerLimit('enqueue', CALLER, 'user')).rejects.toMatchObject(RATE_LIMITED);
    await expect(guards.enforceCallerLimit('enqueue', `${CALLER}x`, 'user')).resolves.toBeUndefined();
    clock.t += 60 * 1000;
    await expect(guards.enforceCallerLimit('enqueue', CALLER, 'user')).resolves.toBeUndefined();
  });

  test('站內信：一般使用者第 60 次通過、第 61 次拒絕；入列與站內信計數互不影響', async () => {
    const { guards } = setup();
    await repeat(60, () => guards.enforceCallerLimit('inbox', CALLER, 'user'));
    await expect(guards.enforceCallerLimit('inbox', CALLER, 'user')).rejects.toMatchObject(RATE_LIMITED);
    await expect(guards.enforceCallerLimit('enqueue', CALLER, 'user')).resolves.toBeUndefined();
  });

  test('教練以上（批次通知）：超過一般上限仍通過，到各自較高上限才拒絕', async () => {
    const { guards } = setup();
    await repeat(100, () => guards.enforceCallerLimit('enqueue', CALLER, 'admin'));
    await repeat(100, () => guards.enforceCallerLimit('inbox', CALLER, 'coach'));
    await repeat(1900, () => guards.enforceCallerLimit('enqueue', CALLER, 'admin'));
    await expect(guards.enforceCallerLimit('enqueue', CALLER, 'admin')).rejects.toMatchObject(RATE_LIMITED);
  }, 30000);

  test('角色判定：user／空值／非字串為一般使用者；其他（含自訂角色）為教練以上', () => {
    ['user', ' user ', '', '  ', undefined, null, 5, {}].forEach((role) => {
      expect(isStaffRole(role)).toBe(false);
    });
    ['coach', 'captain', 'venue_owner', 'admin', 'super_admin', 'custom_staff'].forEach((role) => {
      expect(isStaffRole(role)).toBe(true);
    });
  });

  test('第一次被拒絕才記一次 warn，且只含遮罩後的呼叫者', async () => {
    const { guards, logger } = setup();
    await repeat(20, () => guards.enforceCallerLimit('enqueue', CALLER, 'user'));
    await repeat(5, () => guards.enforceCallerLimit('enqueue', CALLER, 'user').catch(() => {}));
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0][0]).toBe('[notificationGuards] caller rate limited');
    expect(logger.warns[0][1]).toEqual({
      kind: 'enqueue',
      callerUid: fields.maskUid(CALLER),
      staff: false,
      limit: 20,
    });
    expect(JSON.stringify(logger.warns)).not.toContain(CALLER);
  });

  test('計數基礎設施失敗：回 sanitized internal 並結構化記錄，不洩漏 UID', async () => {
    const { guards, logger } = setup({
      faults: {
        write: ({ path }) => (path.startsWith(`${COUNTER_COLLECTION}/`) ? new FakeError(14, `UNAVAILABLE ${CALLER}`) : null),
      },
    });
    await expect(guards.enforceCallerLimit('enqueue', CALLER, 'user')).rejects.toMatchObject({
      code: 'internal',
      message: 'Failed to verify request limits',
    });
    expect(logger.errors).toEqual([['[notificationGuards] counter failure', { guard: 'caller_enqueue', code: 14 }]]);
    expect(JSON.stringify(logger.errors)).not.toContain(CALLER);
  });
});

describe('每目標與全域每日上限（enforceDailyLimits）', () => {
  test('每目標每日：第 30 次通過、第 31 次拒絕；其他目標不受影響', async () => {
    const { guards } = setup();
    await repeat(30, () => guards.enforceDailyLimits(TARGET));
    await expect(guards.enforceDailyLimits(TARGET)).rejects.toMatchObject(RATE_LIMITED);
    await expect(guards.enforceDailyLimits(`${TARGET}x`)).resolves.toBeUndefined();
  });

  test('台北換日（23:59 → 00:01）後每目標計數重置', async () => {
    const { guards, clock } = setup();
    clock.t = Date.UTC(2026, 9, 27, 15, 59, 0);
    await repeat(30, () => guards.enforceDailyLimits(TARGET));
    await expect(guards.enforceDailyLimits(TARGET)).rejects.toMatchObject(RATE_LIMITED);
    clock.t = Date.UTC(2026, 9, 27, 16, 1, 0);
    await expect(guards.enforceDailyLimits(TARGET)).resolves.toBeUndefined();
  });

  test('被每目標上限擋下的請求不消耗全域額度', async () => {
    const { guards, db } = setup();
    await repeat(30, () => guards.enforceDailyLimits(TARGET));
    await repeat(3, () => guards.enforceDailyLimits(TARGET).catch(() => {}));
    expect(sumCounters(db, '_global_enqueue_s')).toBe(30);
  });

  test('全域每日：第 2000 次通過、第 2001 次拒絕；console.error 只記一次；隔天重置', async () => {
    const { guards, logger, clock } = setup();
    await repeat(2000, (i) => guards.enforceDailyLimits(`${TARGET}${i}`));
    expect(logger.errors).toHaveLength(0);
    await expect(guards.enforceDailyLimits(`${TARGET}over1`)).rejects.toMatchObject(RATE_LIMITED);
    await expect(guards.enforceDailyLimits(`${TARGET}over2`)).rejects.toMatchObject(RATE_LIMITED);
    expect(logger.errors).toEqual([[
      '[notificationGuards] global daily cap reached',
      { kind: 'enqueue', day: '20261027', limit: 2000 },
    ]]);
    clock.t += 24 * HOUR_MS;
    await expect(guards.enforceDailyLimits(`${TARGET}next`)).resolves.toBeUndefined();
  }, 60000);

  test('計數基礎設施失敗：回 sanitized internal', async () => {
    const { guards, logger } = setup({
      faults: { getAll: () => new FakeError(14, 'UNAVAILABLE') },
    });
    await expect(guards.enforceDailyLimits(TARGET)).rejects.toMatchObject({ code: 'internal' });
    expect(logger.errors).toEqual([['[notificationGuards] counter failure', { guard: 'daily_enqueue', code: 14 }]]);
  });
});

describe('dedupeKey 24 小時去重與全域每日發送上限（checkBeforePush）', () => {
  const push = (guards, queueId, extra = {}) => guards.checkBeforePush({
    queueId,
    uid: TARGET,
    dedupeKey: 'event_changed:e1:u1:abc',
    ...extra,
  });

  test('沒有 dedupeKey：不建立去重文件，一律放行', async () => {
    const { guards, db } = setup();
    await expect(push(guards, 'q1', { dedupeKey: '' })).resolves.toEqual({ skip: false, reason: '' });
    await expect(push(guards, 'q2', { dedupeKey: undefined })).resolves.toEqual({ skip: false, reason: '' });
    expect(db.paths(`${DEDUPE_COLLECTION}/`)).toHaveLength(0);
  });

  test('視窗邊界：23:59 為重複；24:00 與 24:01 放行並重新計時', async () => {
    const { guards, clock } = setup();
    await expect(push(guards, 'q1')).resolves.toEqual({ skip: false, reason: '' });
    clock.t = T0 + DEDUPE_WINDOW_MS - 60 * 1000;
    await expect(push(guards, 'q2')).resolves.toEqual({ skip: true, reason: 'duplicate' });
    clock.t = T0 + DEDUPE_WINDOW_MS + 60 * 1000;
    await expect(push(guards, 'q3')).resolves.toEqual({ skip: false, reason: '' });
    // q3 重新計時：q3 之後 23:59 內仍是重複
    clock.t += DEDUPE_WINDOW_MS - 60 * 1000;
    await expect(push(guards, 'q4')).resolves.toEqual({ skip: true, reason: 'duplicate' });
  });

  test('剛好滿 24 小時視為視窗外', async () => {
    const { guards, clock } = setup();
    await push(guards, 'q1');
    clock.t = T0 + DEDUPE_WINDOW_MS;
    await expect(push(guards, 'q2')).resolves.toEqual({ skip: false, reason: '' });
  });

  test('同一文件重試（相同 queueId）不算重複', async () => {
    const { guards } = setup();
    await push(guards, 'q1');
    await expect(push(guards, 'q1')).resolves.toEqual({ skip: false, reason: '' });
  });

  test('相同 dedupeKey 但不同收件者各自發送（多收件者廣播共用同一把鍵）', async () => {
    const { guards } = setup();
    await expect(push(guards, 'q1', { uid: `${TARGET}a` })).resolves.toEqual({ skip: false, reason: '' });
    await expect(push(guards, 'q2', { uid: `${TARGET}b` })).resolves.toEqual({ skip: false, reason: '' });
  });

  test('同時到達的兩份文件只有一份放行', async () => {
    const { guards } = setup();
    const results = await Promise.all([push(guards, 'q1'), push(guards, 'q2')]);
    expect(results.filter((r) => r.skip === false)).toHaveLength(1);
    expect(results.filter((r) => r.reason === 'duplicate')).toHaveLength(1);
  });

  test('發送失敗釋放去重標記後，後續重送不被視為重複；非持有者釋放無效', async () => {
    const { guards } = setup();
    await push(guards, 'q1');
    await guards.releaseDedupe({ queueId: 'other', uid: TARGET, dedupeKey: 'event_changed:e1:u1:abc' });
    await expect(push(guards, 'q2')).resolves.toEqual({ skip: true, reason: 'duplicate' });
    await guards.releaseDedupe({ queueId: 'q1', uid: TARGET, dedupeKey: 'event_changed:e1:u1:abc' });
    await expect(push(guards, 'q3')).resolves.toEqual({ skip: false, reason: '' });
  });

  test('全域每日發送上限：第 2000 次放行、第 2001 次 daily_cap（只記一次 error，並釋放去重標記）', async () => {
    const { guards, logger, db } = setup();
    await repeat(2000, (i) => guards.checkBeforePush({ queueId: `q${i}`, uid: `${TARGET}${i}`, dedupeKey: '' }));
    await expect(push(guards, 'qover')).resolves.toEqual({ skip: true, reason: 'daily_cap' });
    await expect(push(guards, 'qover2', { uid: `${TARGET}z` })).resolves.toEqual({ skip: true, reason: 'daily_cap' });
    expect(logger.errors).toEqual([[
      '[notificationGuards] global daily cap reached',
      { kind: 'send', day: '20261027', limit: 2000 },
    ]]);
    expect(db.paths(`${DEDUPE_COLLECTION}/`)).toHaveLength(0);
  }, 60000);

  test('重複的文件不消耗全域發送額度', async () => {
    const { guards, db } = setup();
    await push(guards, 'q1');
    await repeat(3, (i) => push(guards, `dup${i}`));
    expect(sumCounters(db, '_global_send_s')).toBe(1);
  });

  test('計數／去重基礎設施失敗：放行並結構化記錄（次要防線，不因故障漏發）', async () => {
    const { guards, logger } = setup({
      faults: { transaction: () => new FakeError(14, 'UNAVAILABLE') },
    });
    await expect(push(guards, 'q1')).resolves.toEqual({ skip: false, reason: '' });
    expect(logger.errors).toEqual([['[notificationGuards] pre-push check failed, allow', { queueId: 'q1', code: 14 }]]);
  });
});

describe('未知 source 記錄與格式驗證', () => {
  // 現行 A／B 前端實際送出的 source 字面值
  const REAL_SOURCES = [
    'client:line-push', 'client:unknown', 'team_join_request', 'tournament_register_request',
    'edu_checkin', 'edu_reminder', 'edu_report', 'event_cancel_signup:legacy',
    'template:welcome', 'template:signup_success', 'template:cancel_signup', 'template:waitlist_promoted',
    'template:waitlist_demoted', 'template:event_cancelled', 'template:role_upgrade', 'template:role_application',
    'template:role_application:admins', 'template:event_changed', 'template:event_relisted',
    'template:tournament_friendly_host_opened', 'template:tournament_friendly_team_apply_host',
    'template:tournament_friendly_team_approved_applicant', 'template:tournament_friendly_team_rejected_applicant',
    'template:tournament_friendly_team_approved_broadcast',
    'team_join_review:approve', 'team_join_review:reject',
    'team_join_review:broadcast:approve', 'team_join_review:broadcast:reject',
    'team_role_assignment:captain', 'team_role_assignment:leader', 'team_role_assignment:coach',
    'tournament_review:approve', 'tournament_review:reject',
    'tournament_review:broadcast:approve', 'tournament_review:broadcast:reject',
    'edu_student_review:approve', 'edu_student_review:reject',
    'target:individual', 'target:team', 'target:all', 'target:admin', 'target:coach',
    'target:captain', 'target:venue_owner', 'target:coach_up',
  ];

  test('現行前端的 source 全部符合格式且屬已知清單（不記 log）', () => {
    const { guards, logger } = setup();
    REAL_SOURCES.forEach((source) => {
      expect(fields.isValidSourceFormat(source)).toBe(true);
      expect(guards.logUnknownSource({ callerUid: CALLER, source, category: 'system' })).toBe(false);
    });
    expect(logger.warns).toHaveLength(0);
  });

  test('未知 source：只記 warn（遮罩呼叫者、不含 title／body），回傳 true', () => {
    const { guards, logger } = setup();
    ['admin_blast', 'template:unknown_key', 'team_join_review:delete', 'target:ALL'].forEach((source) => {
      expect(fields.isValidSourceFormat(source)).toBe(true);
      expect(guards.logUnknownSource({ callerUid: CALLER, source, category: 'system' })).toBe(true);
    });
    expect(logger.warns).toHaveLength(4);
    expect(logger.warns[0]).toEqual([
      '[enqueuePrivilegedLineNotification] unknown source',
      { callerUid: fields.maskUid(CALLER), source: 'admin_blast', category: 'system' },
    ]);
    expect(Object.keys(logger.warns[0][1]).sort()).toEqual(['callerUid', 'category', 'source']);
    expect(JSON.stringify(logger.warns)).not.toContain(CALLER);
  });

  test('source 非法字元一律不符格式', () => {
    ['a b', 'a;b', 'a<b>', '中文', 'a\nb', 'a\\b', 'a"b', "a'b", 'a%20b', '', 'a,b', 'a|b'].forEach((source) => {
      expect(fields.isValidSourceFormat(source)).toBe(false);
    });
    expect(fields.isValidSourceFormat(undefined)).toBe(false);
    expect(fields.isValidSourceFormat(123)).toBe(false);
  });

  test('maskUid 保留前 2 後 2 碼', () => {
    expect(fields.maskUid('Uabcdef123456')).toBe('Ua*********56');
    expect(fields.maskUid('abcd')).toBe('****');
    expect(fields.maskUid('')).toBe('');
    expect(fields.maskUid(CALLER)).not.toContain('cccc');
  });
});

describe('文字清理與站內信顯示欄位（純函式）', () => {
  test('stripControlChars：移除 NUL 與其他 C0 控制字元，保留換行與定位', () => {
    const c = (n) => String.fromCharCode(n);
    const dirty = `a${c(0)}b${c(1)}c${c(8)}d${c(11)}e${c(12)}f${c(14)}g${c(31)}h\ni\tj${c(13)}k`;
    expect(fields.stripControlChars(dirty)).toBe('abcdefgh\ni\tjk');
    expect(fields.stripControlChars('正常\n文字')).toBe('正常\n文字');
    expect(fields.stripControlChars(undefined)).toBeUndefined();
    expect(fields.stripControlChars(42)).toBe(42);
  });

  test('台北時間格式：換日與跨年', () => {
    expect(fields.formatTaipeiDateTime(Date.UTC(2026, 9, 27, 4, 5))).toBe('2026/10/27 12:05');
    expect(fields.formatTaipeiDateTime(Date.UTC(2026, 9, 27, 15, 59))).toBe('2026/10/27 23:59');
    expect(fields.formatTaipeiDateTime(Date.UTC(2026, 9, 27, 16, 0))).toBe('2026/10/28 00:00');
    expect(fields.formatTaipeiDateTime(Date.UTC(2026, 11, 31, 16, 30))).toBe('2027/01/01 00:30');
    expect(fields.taipeiDayKey(Date.UTC(2026, 9, 27, 15, 59))).toBe('20261027');
    expect(fields.taipeiDayKey(Date.UTC(2026, 9, 27, 16, 0))).toBe('20261028');
  });

  test('resolveInboxDisplayFields：type 白名單、typeName 對照、時間由伺服器產生', () => {
    const callerData = { displayName: '王小明' };
    const nowMs = Date.UTC(2026, 9, 27, 4, 5);
    ['system', 'activity', 'tournament', 'private'].forEach((type) => {
      const out = fields.resolveInboxDisplayFields({ type, typeName: '偽造', time: '任意' }, { callerData, nowMs });
      expect(out.type).toBe(type);
      expect(out.typeName).toBe(fields.INBOX_TYPE_NAMES[type]);
      expect(out.time).toBe('2026/10/27 12:05');
    });
    ['任意', '', undefined, null, 5, '__proto__', 'constructor', 'toString'].forEach((type) => {
      const out = fields.resolveInboxDisplayFields({ type }, { callerData, nowMs });
      expect(out.type).toBe('private');
      expect(out.typeName).toBe('私訊');
    });
  });

  test('resolveInboxDisplayFields：senderName 只沿用「系統」，其餘為呼叫者名稱，查不到用「用戶」', () => {
    const nowMs = T0;
    const named = { callerData: { displayName: '王小明' }, nowMs };
    expect(fields.resolveInboxDisplayFields({ senderName: '系統' }, named).senderName).toBe('系統');
    expect(fields.resolveInboxDisplayFields({ senderName: ' 系統 ' }, named).senderName).toBe('系統');
    expect(fields.resolveInboxDisplayFields({ senderName: '系統管理員' }, named).senderName).toBe('王小明');
    expect(fields.resolveInboxDisplayFields({ senderName: '別人' }, named).senderName).toBe('王小明');
    expect(fields.resolveInboxDisplayFields({}, named).senderName).toBe('王小明');
    expect(fields.resolveInboxDisplayFields({ senderName: '別人' }, { callerData: {}, nowMs }).senderName).toBe('用戶');
    expect(fields.resolveInboxDisplayFields({ senderName: '別人' }, { nowMs }).senderName).toBe('用戶');
    expect(fields.resolveInboxDisplayFields({ senderName: '別人' }, { callerData: { name: 'N', lineDisplayName: 'L' }, nowMs }).senderName).toBe('N');
    expect(fields.resolveInboxDisplayFields({ senderName: '別人' }, { callerData: { lineDisplayName: 'L' }, nowMs }).senderName).toBe('L');
  });
});
