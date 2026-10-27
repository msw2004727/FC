/**
 * 通知發送授權強化（第 1 批）— functions/notification-fields.js 純函式與來源欄位記錄單元測試。
 */

const fields = require('../../functions/notification-fields');
const {
  T0, MINUTE_MS, CALLER, createGuardsEnv,
} = require('./notification-guards-test-helpers');

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
  'team_role_assignment:captain', 'team_role_assignment:leader', 'team_role_assignment:coach', 'team_role_assignment:member',
  'tournament_review:approve', 'tournament_review:reject',
  'tournament_review:broadcast:approve', 'tournament_review:broadcast:reject',
  'edu_student_review:approve', 'edu_student_review:reject',
  'target:individual', 'target:team', 'target:all', 'target:admin', 'target:coach',
  'target:captain', 'target:venue_owner', 'target:coach_up',
];

describe('來源欄位檢查與記錄', () => {
  test('現行前端的 source 全部符合格式且屬已知清單（不記錄）', () => {
    const { guards, logger } = createGuardsEnv();
    REAL_SOURCES.forEach((source) => {
      expect(fields.isValidSourceFormat(source)).toBe(true);
      expect(guards.logUnknownSource({ callerUid: CALLER, source, category: 'system' })).toBe(false);
    });
    expect(logger.warns).toHaveLength(0);
  });

  test('未知 source：只記 warn（遮罩呼叫者、不含 title／body），回傳 true', () => {
    const { guards, logger } = createGuardsEnv();
    ['admin_blast', 'template:unknown_key', 'team_join_review:delete', 'target:ALL', 'team_role_assignment:owner'].forEach((source) => {
      expect(fields.isValidSourceFormat(source)).toBe(true);
      expect(guards.logUnknownSource({ callerUid: CALLER, source, category: 'system' })).toBe(true);
    });
    expect(logger.warns).toHaveLength(5);
    expect(logger.warns[0]).toEqual([
      '[enqueuePrivilegedLineNotification] unknown source',
      { callerUid: fields.maskUid(CALLER), source: 'admin_blast', category: 'system' },
    ]);
    expect(Object.keys(logger.warns[0][1]).sort()).toEqual(['callerUid', 'category', 'source']);
    expect(JSON.stringify(logger.warns)).not.toContain(CALLER);
  });

  test('非法字元一律不符格式', () => {
    ['a b', 'a;b', 'a<b>', '中文', 'a\nb', 'a\\b', 'a"b', "a'b", 'a%20b', '', 'a,b', 'a|b'].forEach((source) => {
      expect(fields.isValidSourceFormat(source)).toBe(false);
    });
    expect(fields.isValidSourceFormat(undefined)).toBe(false);
    expect(fields.isValidSourceFormat(123)).toBe(false);
  });

  test('logSafeSource：格式合格且不超長才原樣輸出，否則 null', () => {
    expect(fields.logSafeSource('template:event_changed')).toBe('template:event_changed');
    expect(fields.logSafeSource('bad source!')).toBeNull();
    expect(fields.logSafeSource('a'.repeat(121))).toBeNull();
    expect(fields.logSafeSource(undefined)).toBeNull();
    expect(fields.logSafeSource(null)).toBeNull();
  });

  test('格式不符的拒絕記錄：每（分鐘, 呼叫者）一筆，source 為 null，不含原始內容', () => {
    const { guards, logger, clock } = createGuardsEnv();
    guards.logSourceFormatRejected({ callerUid: CALLER });
    guards.logSourceFormatRejected({ callerUid: CALLER });
    expect(logger.warns).toEqual([[
      '[notificationGuards] gate triggered',
      { gate: 'source_format', kind: 'enqueue', caller: fields.maskUid(CALLER), source: null, count: null, limit: null },
    ]]);
    clock.t += MINUTE_MS;
    guards.logSourceFormatRejected({ callerUid: CALLER });
    expect(logger.warns).toHaveLength(2);
    expect(JSON.stringify(logger.warns)).not.toContain(CALLER);
  });

  test('maskUid 保留前 2 後 2 碼', () => {
    expect(fields.maskUid('Uabcdef123456')).toBe('Ua*********56');
    expect(fields.maskUid('abcd')).toBe('****');
    expect(fields.maskUid('')).toBe('');
    expect(fields.maskUid(undefined)).toBe('');
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
      const out = fields.resolveInboxDisplayFields({ type, typeName: '客戶端值', time: '任意' }, { callerData, nowMs });
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
    const named = { callerData: { displayName: '王小明' }, nowMs: T0 };
    expect(fields.resolveInboxDisplayFields({ senderName: '系統' }, named).senderName).toBe('系統');
    expect(fields.resolveInboxDisplayFields({ senderName: ' 系統 ' }, named).senderName).toBe('系統');
    expect(fields.resolveInboxDisplayFields({ senderName: '系統管理員' }, named).senderName).toBe('王小明');
    expect(fields.resolveInboxDisplayFields({ senderName: '別人' }, named).senderName).toBe('王小明');
    expect(fields.resolveInboxDisplayFields({}, named).senderName).toBe('王小明');
    expect(fields.resolveInboxDisplayFields({ senderName: '別人' }, { callerData: {}, nowMs: T0 }).senderName).toBe('用戶');
    expect(fields.resolveInboxDisplayFields({ senderName: '別人' }, { nowMs: T0 }).senderName).toBe('用戶');
    expect(fields.resolveInboxDisplayFields({ senderName: '別人' }, { callerData: { name: 'N', lineDisplayName: 'L' }, nowMs: T0 }).senderName).toBe('N');
    expect(fields.resolveInboxDisplayFields({ senderName: '別人' }, { callerData: { lineDisplayName: 'L' }, nowMs: T0 }).senderName).toBe('L');
  });
});
