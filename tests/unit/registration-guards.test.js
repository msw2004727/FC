/**
 * T-087 報名檢查強化：functions/registration-guards.js 純函式單元測試。
 * 修正前此檔不存在（伺服器沒有黑名單／minAge／取消時限／同行者 UID 檢查，去重鍵只用 requestId），
 * 所以本檔在修正前整檔無法載入而失敗；行為面的修正前失敗見 registration-callables-hardening.test.js。
 */

const guards = require('../../functions/registration-guards');

const UID = `U${'1'.repeat(32)}`;
const OTHER = `U${'2'.repeat(32)}`;
const TAIPEI_MS = 8 * 60 * 60 * 1000;
// 台北當地時間 → 實際時刻（同 functions/index.js parseEventStartDateInTaipei）
const taipei = (y, m, d, hh = 0, mm = 0) => new Date(Date.UTC(y, m - 1, d, hh, mm) - TAIPEI_MS);

describe('去重鍵與決策', () => {
  test('鍵含函式名與呼叫者；requestId 截 100 字', () => {
    expect(guards.buildRegistrationDedupeDocId('register', UID, 'r1')).toBe(`register_${UID}_r1`);
    expect(guards.buildRegistrationDedupeDocId('cancel', UID, 'r1')).toBe(`cancel_${UID}_r1`);
    const long = 'x'.repeat(150);
    expect(guards.buildRegistrationDedupeDocId('register', UID, long)).toBe(`register_${UID}_${'x'.repeat(100)}`);
  });

  test.each([[undefined], [null], [''], ['.'], ['..'], ['a/b'], [42], [{}]])('不合法 requestId %p → 不建鍵', (requestId) => {
    expect(guards.buildRegistrationDedupeDocId('register', UID, requestId)).toBe('');
  });

  test('未知函式名或呼叫者含斜線 → 不建鍵', () => {
    expect(guards.buildRegistrationDedupeDocId('adjust', UID, 'r1')).toBe('');
    expect(guards.buildRegistrationDedupeDocId('register', 'a/b', 'r1')).toBe('');
    expect(guards.buildRegistrationDedupeDocId('register', '', 'r1')).toBe('');
  });

  test('buildRegistrationDedupeRef 沒有鍵時回 null、不碰 db', () => {
    const db = { collection: jest.fn(() => ({ doc: jest.fn((id) => ({ id })) })) };
    expect(guards.buildRegistrationDedupeRef(db, 'register', UID, '')).toBeNull();
    expect(db.collection).not.toHaveBeenCalled();
    expect(guards.buildRegistrationDedupeRef(db, 'register', UID, 'r1')).toEqual({ id: `register_${UID}_r1` });
    expect(db.collection).toHaveBeenCalledWith('_regDedupe');
  });

  const snap = (data) => ({ exists: data !== null, data: () => data });
  const ctx = { fn: 'register', callerUid: UID, eventId: 'ev1' };
  const own = { schema: guards.DEDUPE_SCHEMA, fn: 'register', callerUid: UID, eventId: 'ev1', result: { confirmed: 1 } };

  test('miss／hit／conflict／foreign', () => {
    expect(guards.decideRegistrationDedupe(null, ctx)).toEqual({ status: 'miss' });
    expect(guards.decideRegistrationDedupe(snap(null), ctx)).toEqual({ status: 'miss' });
    expect(guards.decideRegistrationDedupe(snap(own), ctx)).toEqual({ status: 'hit', result: { confirmed: 1 } });
    expect(guards.decideRegistrationDedupe(snap({ ...own, eventId: 'ev2' }), ctx)).toEqual({ status: 'conflict' });
    // 舊格式（只有 callerUid）、別人的、別的函式的 → 不信任
    expect(guards.decideRegistrationDedupe(snap({ callerUid: UID }), ctx)).toEqual({ status: 'foreign' });
    expect(guards.decideRegistrationDedupe(snap({ ...own, callerUid: OTHER }), ctx)).toEqual({ status: 'foreign' });
    expect(guards.decideRegistrationDedupe(snap({ ...own, fn: 'cancel' }), ctx)).toEqual({ status: 'foreign' });
  });

  test('精簡結果不含活動名單投影', () => {
    const txResult = {
      registrations: [{ id: 'r' }], event: { participants: ['a'] }, confirmed: 1, waitlisted: 0,
      activityRecordDocId: 'ar', eventData: { title: 't' }, earlyBirdCharged: true, earlyBirdCost: 20,
    };
    expect(guards.pickRegisterDedupeResult(txResult)).toEqual({
      registrations: [{ id: 'r' }], confirmed: 1, waitlisted: 0, earlyBirdCharged: true, earlyBirdCost: 20,
    });
    expect(guards.pickCancelDedupeResult({ cancelled: [1], alreadyCancelled: [], promoted: [2], event: {}, eventData: {} }))
      .toEqual({ cancelled: [1], alreadyCancelled: [], promoted: [2] });
  });

  test('去重文件 10 分鐘過期、帶 schema 與函式名', () => {
    const doc = guards.buildRegistrationDedupeDoc({
      fn: 'cancel', callerUid: UID, eventId: 'ev1', result: { cancelled: [] }, nowMs: 1000,
      FieldValue: { serverTimestamp: () => 'TS' }, Timestamp: { fromDate: (d) => d.getTime() },
    });
    expect(doc).toEqual({
      schema: guards.DEDUPE_SCHEMA, fn: 'cancel', callerUid: UID, eventId: 'ev1',
      result: { cancelled: [] }, createdAt: 'TS', expiresAt: 1000 + 10 * 60 * 1000,
    });
  });
});

describe('參與者身分（Q3）', () => {
  test.each([
    ['本人', [{ userId: UID }], true],
    ['本人＋同行者', [{ userId: UID }, { userId: UID, companionId: 'c1' }], true],
    ['只有同行者', [{ userId: UID, companionId: 'c1' }], true],
    ['第 2 位是別人', [{ userId: UID }, { userId: OTHER, companionId: 'c1' }], false],
    ['第 2 位缺 companionId', [{ userId: UID }, { userId: UID }], false],
    ['第 2 位 companionId 空白', [{ userId: UID }, { userId: UID, companionId: '  ' }], false],
    ['第 2 位 companionId 非字串', [{ userId: UID }, { userId: UID, companionId: 5 }], false],
    ['第 1 位是別人', [{ userId: OTHER }], false],
    ['含 null', [{ userId: UID }, null], false],
  ])('%s', (_label, participants, expected) => {
    expect(guards.areParticipantsOwnedByCaller(participants, UID)).toBe(expected);
  });
});

describe('黑名單四態', () => {
  const ev = { blockedUids: [UID] };
  test('未登入 uid、未被擋 → 不擋', () => {
    expect(guards.isEventBlockedForCaller(ev, '', [])).toBe(false);
    expect(guards.isEventBlockedForCaller({ blockedUids: [OTHER] }, UID, [])).toBe(false);
    expect(guards.isEventBlockedForCaller({}, UID, [])).toBe(false);
    expect(guards.isEventBlockedForCaller({ blockedUids: 'x' }, UID, [])).toBe(false);
  });
  test('被擋且沒有紀錄 → 擋', () => {
    expect(guards.isEventBlockedForCaller(ev, UID, [])).toBe(true);
    expect(guards.isEventBlockedForCaller(ev, UID, [{ userId: OTHER, status: 'confirmed' }])).toBe(true);
  });
  test.each([
    ['userId', { userId: UID, status: 'cancelled' }],
    ['uid', { uid: UID, status: 'removed' }],
    ['courseOwnerUids', { userId: 'student', courseOwnerUids: [UID], status: 'cancelled' }],
    ['userId 前後空白', { userId: ` ${UID} `, status: 'confirmed' }],
  ])('被擋但有 %s 紀錄 → 不擋', (_label, history) => {
    expect(guards.isEventBlockedForCaller(ev, UID, [history])).toBe(false);
  });
});

describe('minAge', () => {
  const now = taipei(2026, 11, 4, 12);
  const check = (minAge, birthday, eventStart = taipei(2030, 6, 15, 10)) => (
    guards.evaluateMinAgeRestriction({ minAge, userData: birthday === null ? null : { birthday }, eventStart, now })
  );

  test.each([[0], [undefined], [null], [''], ['abc'], [-3], [0.5]])('minAge=%p 不檢查', (minAge) => {
    expect(check(minAge, '')).toBeNull();
  });

  test('活動開始日剛好滿齡通過、差一天未滿', () => {
    expect(check(18, '2012-06-15')).toBeNull();
    expect(check(18, '2012-06-16')).toEqual({ code: 'AGE_RESTRICTED', message: '此活動限 18 歲以上報名' });
  });

  test('minAge 取整（18.9 視為 18）', () => {
    expect(check(18.9, '2012-06-15')).toBeNull();
  });

  test('台北日界：台北 06/15 00:30（UTC 06/14 16:30）以台北日期計算', () => {
    const start = taipei(2030, 6, 15, 0, 30);
    expect(start.toISOString()).toBe('2030-06-14T16:30:00.000Z');
    expect(check(18, '2012-06-15', start)).toBeNull();
    // 台北 06/14 23:59 → 還差一天
    expect(check(18, '2012-06-15', taipei(2030, 6, 14, 23, 59))).toEqual({ code: 'AGE_RESTRICTED', message: '此活動限 18 歲以上報名' });
  });

  test('活動日期解析失敗（null）→ 以現在（台北日期）計算', () => {
    expect(check(18, '2008-11-04', null)).toBeNull();
    expect(check(18, '2008-11-05', null)).toEqual({ code: 'AGE_RESTRICTED', message: '此活動限 18 歲以上報名' });
  });

  test.each([
    ['缺', ''],
    ['格式錯', '04/11/1990'],
    ['不存在的日期 2/30', '1990-02-30'],
    ['月份 13', '1990-13-01'],
    ['未來生日（年齡為負）', '2031-01-01'],
    ['130 歲以上', '1890-01-01'],
  ])('生日%s → BIRTHDAY_REQUIRED', (_label, birthday) => {
    expect(check(12, birthday)).toEqual({ code: 'BIRTHDAY_REQUIRED', message: '請先補齊生日資料後再報名' });
  });

  test('沒有 users 文件 → BIRTHDAY_REQUIRED', () => {
    expect(check(12, null)).toEqual({ code: 'BIRTHDAY_REQUIRED', message: '請先補齊生日資料後再報名' });
  });

  test('生日格式同 A：斜線與單位數月日、後面帶時間都可', () => {
    expect(guards.parseBirthdayParts('2012/6/5')).toEqual({ year: 2012, month: 6, day: 5 });
    expect(guards.parseBirthdayParts('2012-06-05T00:00:00.000Z')).toEqual({ year: 2012, month: 6, day: 5 });
    expect(guards.parseBirthdayParts('2012-02-29')).toEqual({ year: 2012, month: 2, day: 29 });
    expect(guards.parseBirthdayParts('2013-02-29')).toBeNull();
  });
});

describe('取消時限', () => {
  const now = new Date(Date.UTC(2026, 10, 4, 4, 0));
  test.each([['ended'], ['cancelled']])('status=%s → EVENT_ENDED', (status) => {
    expect(guards.evaluateUserCancelDeadline({ eventData: { status }, eventStart: null, now }))
      .toEqual({ code: 'EVENT_ENDED', message: '活動已開始，無法再取消報名' });
  });
  test('開始時間＝現在或已過 → EVENT_STARTED；未到 → 通過', () => {
    const started = { code: 'EVENT_STARTED', message: '活動已於開始時間結束，無法取消報名' };
    expect(guards.evaluateUserCancelDeadline({ eventData: { status: 'open' }, eventStart: new Date(now.getTime()), now })).toEqual(started);
    expect(guards.evaluateUserCancelDeadline({ eventData: { status: 'full' }, eventStart: new Date(now.getTime() - 60000), now })).toEqual(started);
    expect(guards.evaluateUserCancelDeadline({ eventData: { status: 'open' }, eventStart: new Date(now.getTime() + 60000), now })).toBeNull();
  });
  test('活動日期解析失敗 → 只看 status', () => {
    expect(guards.evaluateUserCancelDeadline({ eventData: { status: 'open' }, eventStart: null, now })).toBeNull();
    expect(guards.evaluateUserCancelDeadline({ eventData: { status: 'open' }, eventStart: new Date('bad'), now })).toBeNull();
  });
});

describe('錯誤邊界', () => {
  class HttpsError extends Error {
    constructor(code, message, details) { super(message); this.code = code; this.details = details; }
  }
  const logger = () => ({ info: jest.fn(), error: jest.fn() });

  test('成功結果原樣回傳', async () => {
    const handler = guards.withRegistrationErrorBoundary({ fn: 'registerForEvent', HttpsError, logger: logger() }, async () => ({ ok: 1 }));
    await expect(handler({})).resolves.toEqual({ ok: 1 });
  });

  test('HttpsError 原樣重拋，log 只記代碼', async () => {
    const log = logger();
    const original = new HttpsError('failed-precondition', '此活動目前無法報名', 'EVENT_UNAVAILABLE');
    const handler = guards.withRegistrationErrorBoundary({ fn: 'registerForEvent', HttpsError, logger: log }, async () => { throw original; });
    await expect(handler({})).rejects.toBe(original);
    expect(log.info).toHaveBeenCalledWith('[registrationCallable] rejected', {
      function: 'registerForEvent', code: 'failed-precondition', reason: 'EVENT_UNAVAILABLE',
    });
  });

  test('HttpsError 的 details 物件代碼也記；訊息不是代碼形狀時不記', async () => {
    const log = logger();
    const handler = guards.withRegistrationErrorBoundary({ fn: 'cancelRegistration', HttpsError, logger: log }, async () => {
      throw new HttpsError('failed-precondition', 'x', { code: 'COURSE_ATTENDANCE_ALREADY_SIGNED_IN', studentId: 's1' });
    });
    await expect(handler({})).rejects.toBeInstanceOf(HttpsError);
    expect(log.info.mock.calls[0][1]).toEqual({ function: 'cancelRegistration', code: 'failed-precondition', reason: 'COURSE_ATTENDANCE_ALREADY_SIGNED_IN' });

    const log2 = logger();
    const handler2 = guards.withRegistrationErrorBoundary({ fn: 'registerForEvent', HttpsError, logger: log2 }, async () => {
      throw new HttpsError('invalid-argument', `bad ${UID}`);
    });
    await expect(handler2({})).rejects.toBeInstanceOf(HttpsError);
    expect(JSON.stringify(log2.info.mock.calls)).not.toContain(UID);
  });

  test('非 HttpsError → internal／INTERNAL，log 不含原始訊息', async () => {
    const log = logger();
    const handler = guards.withRegistrationErrorBoundary({ fn: 'registerForEvent', HttpsError, logger: log }, async () => {
      const error = new Error(`leak ${UID}`);
      error.code = 10;
      throw error;
    });
    const thrown = await handler({}).catch((e) => e);
    expect(thrown).toBeInstanceOf(HttpsError);
    expect(thrown.code).toBe('internal');
    expect(thrown.message).toBe('INTERNAL');
    expect(log.error).toHaveBeenCalledWith('[registrationCallable] failed', { function: 'registerForEvent', code: '10', errorType: 'Error' });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('leak');
  });
});
