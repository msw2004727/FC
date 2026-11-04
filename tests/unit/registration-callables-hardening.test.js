/**
 * T-087 報名檢查強化：直接跑 functions/index.js 真正的 registerForEvent／cancelRegistration handler
 * （vm 載入整份 index.js、firebase-* 換成假的、記憶體版 Firestore 有樂觀並發與交易重試）。
 *
 * 「修正前應失敗」的理由寫在每個 describe／test 的註解；修正前的程式＝origin/main 6d97a86c9：
 * 去重在交易外 dedupRef.create()、鍵只用 requestId、伺服器沒有黑名單／minAge／取消時限／同行者 UID 檢查。
 */

const {
  FakeTimestamp,
  createFakeFirestore,
  loadFunctionsIndex,
} = require('./registration-callable-harness');

const U_SELF = `U${'1'.repeat(32)}`;
const U_OTHER = `U${'2'.repeat(32)}`;
const U_THIRD = `U${'3'.repeat(32)}`;
const U_ADMIN = `U${'9'.repeat(32)}`;
const EVENT_ID = 'ce_1800000000000_abc';
const EVENT_ID_2 = 'ce_1800000000001_def';

const MSG = {
  EVENT_UNAVAILABLE: '此活動目前無法報名',
  BIRTHDAY_REQUIRED: '請先補齊生日資料後再報名',
  REQUEST_ID_CONFLICT: '請重新整理後再試',
  CANCEL_ENDED: '活動已開始，無法再取消報名',
  CANCEL_STARTED: '活動已於開始時間結束，無法取消報名',
};

const TAIPEI_MS = 8 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');
// 以台北時間輸出 A 的活動日期格式 YYYY/MM/DD HH:mm~HH:mm
function taipeiEventDate(ms, endHour = '23:59') {
  const d = new Date(ms + TAIPEI_MS);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}~${endHour}`;
}
const FUTURE_DATE = '2099/06/15 10:00~12:00';

let fn;
let harness;
let fake;

beforeAll(() => {
  const loaded = loadFunctionsIndex();
  fn = loaded.exports;
  harness = loaded.harness;
});

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  harness.logs.length = 0;
});

function user(uid, extra = {}) {
  return {
    uid,
    lineUserId: uid,
    name: `name-${uid.slice(0, 4)}`,
    displayName: `user-${uid.slice(1, 3)}`,
    gender: 'male',
    birthday: '1990-01-01',
    region: 'taipei',
    role: 'user',
    exp: 100,
    ...extra,
  };
}

function event(extra = {}) {
  const defined = Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined));
  return {
    id: EVENT_ID,
    title: 'T087 event',
    date: FUTURE_DATE,
    location: 'field',
    type: 'play',
    status: 'open',
    max: 2,
    current: 0,
    waitlist: 0,
    participants: [],
    waitlistNames: [],
    ...defined,
  };
}

function reg(docId, data) {
  return {
    id: `reg_${docId}`,
    eventId: EVENT_ID,
    participantType: 'self',
    companionId: null,
    companionName: null,
    promotionOrder: 0,
    ...data,
  };
}

function setup(seed = {}) {
  fake = createFakeFirestore({
    [`users/${U_SELF}`]: user(U_SELF),
    [`users/${U_OTHER}`]: user(U_OTHER),
    [`users/${U_THIRD}`]: user(U_THIRD),
    [`users/${U_ADMIN}`]: user(U_ADMIN, { role: 'super_admin' }),
    ...seed,
  });
  harness.current = fake;
  return fake;
}

function register(uid, data) {
  return fn.registerForEvent({ auth: { uid, token: {} }, data });
}

function selfPayload(uid, extra = {}) {
  return { eventId: EVENT_ID, participants: [{ userId: uid, userName: `n-${uid.slice(1, 3)}` }], ...extra };
}

function cancel(uid, data) {
  return fn.cancelRegistration({ auth: { uid, token: {} }, data });
}

function regsOf(eventDocId = EVENT_ID) {
  return fake.list(`events/${eventDocId}/registrations`).map((id) => ({ _docId: id, ...fake.get(`events/${eventDocId}/registrations/${id}`) }));
}

function dedupeDocs() {
  return fake.list('_regDedupe');
}

function inboxWritesFor(uid) {
  return fake.state.writes.filter((w) => w.path.startsWith(`users/${uid}/inbox/`));
}

async function expectHttpsError(promise, { code, message, details }) {
  let caught;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(caught.constructor.name).toBe('HttpsError');
  if (code) expect(caught.code).toBe(code);
  if (message !== undefined) expect(caught.message).toBe(message);
  if (details !== undefined) expect(caught.details).toBe(details);
  return caught;
}

// ═══════════════════════════════════════════════════════════════
//  去重（方案②）
// ═══════════════════════════════════════════════════════════════

describe('registerForEvent 交易內去重', () => {
  test('同 requestId 重送：回同一份精簡結果、零寫入、不發第二封站內信、不加第二次 EXP', async () => {
    // 修正前：重送雖回 deduplicated，但只有 { success, deduplicated }，沒有原結果（registrations 為 undefined）。
    setup({ [`events/${EVENT_ID}`]: event() });
    const first = await register(U_SELF, selfPayload(U_SELF, { requestId: 'req-1' }));
    expect(first.success).toBe(true);
    expect(first.registrations).toHaveLength(1);
    expect(first.registrations[0].status).toBe('confirmed');
    expect(inboxWritesFor(U_SELF)).toHaveLength(1);
    expect(fake.get(`users/${U_SELF}`).exp).toBe(110);

    const writesBefore = fake.state.writes.length;
    const second = await register(U_SELF, selfPayload(U_SELF, { requestId: 'req-1' }));
    expect(second).toEqual({
      success: true,
      deduplicated: true,
      registrations: first.registrations,
      confirmed: 1,
      waitlisted: 0,
      earlyBirdCharged: false,
      earlyBirdCost: 0,
    });
    expect(second.event).toBeUndefined();
    expect(fake.state.writes.length).toBe(writesBefore);
    expect(inboxWritesFor(U_SELF)).toHaveLength(1);
    expect(fake.get(`users/${U_SELF}`).exp).toBe(110);
    expect(regsOf()).toHaveLength(1);
  });

  test('去重文件鍵含函式名與呼叫者、只存精簡結果（不存活動名單投影）', async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    await register(U_SELF, selfPayload(U_SELF, { requestId: 'req-key' }));
    expect(dedupeDocs()).toEqual([`register_${U_SELF}_req-key`]);
    const stored = fake.get(`_regDedupe/register_${U_SELF}_req-key`);
    expect(stored).toMatchObject({ schema: 'registration_dedupe_v2', fn: 'register', callerUid: U_SELF, eventId: EVENT_ID });
    expect(Object.keys(stored.result).sort()).toEqual(['confirmed', 'earlyBirdCharged', 'earlyBirdCost', 'registrations', 'waitlisted']);
    expect(stored.result.event).toBeUndefined();
    expect(stored.expiresAt).toBeInstanceOf(FakeTimestamp);
    // 去重文件與報名同一次 commit
    const commitOfDedupe = fake.state.writes.find((w) => w.path.startsWith('_regDedupe/')).commit;
    const commitOfReg = fake.state.writes.find((w) => w.path.includes('/registrations/')).commit;
    expect(commitOfDedupe).toBe(commitOfReg);
  });

  test('交易失敗（未開放）後同 requestId 重送會真的重做；失敗時零寫入', async () => {
    // 修正前：第一次在交易外已 create 去重文件，交易失敗後文件仍在，重送回 { deduplicated:true } 卻沒報名。
    const notOpen = new FakeTimestamp(Date.now() + 24 * 60 * 60 * 1000);
    setup({ [`events/${EVENT_ID}`]: event({ regOpenTime: notOpen }) });
    await expectHttpsError(register(U_SELF, selfPayload(U_SELF, { requestId: 'req-retry' })), {
      code: 'failed-precondition',
      message: 'REG_NOT_OPEN',
    });
    expect(fake.state.writes).toEqual([]);
    expect(dedupeDocs()).toEqual([]);

    fake.put(`events/${EVENT_ID}`, event({ regOpenTime: new FakeTimestamp(Date.now() - 60 * 1000) }));
    const retried = await register(U_SELF, selfPayload(U_SELF, { requestId: 'req-retry' }));
    expect(retried.deduplicated).toBeUndefined();
    expect(retried.registrations).toHaveLength(1);
    expect(regsOf()).toHaveLength(1);
  });

  test('requestId 被他人先用：受害者照常報名，不會拿到別人的結果', async () => {
    // 修正前：鍵只用 requestId，他人先呼叫後受害者被當成重複，回 deduplicated 而沒報名。
    setup({ [`events/${EVENT_ID}`]: event() });
    await register(U_OTHER, selfPayload(U_OTHER, { requestId: 'guessable' }));
    const victim = await register(U_SELF, selfPayload(U_SELF, { requestId: 'guessable' }));
    expect(victim.deduplicated).toBeUndefined();
    expect(victim.registrations[0].userId).toBe(U_SELF);
    expect(regsOf().map((r) => r.userId).sort()).toEqual([U_SELF, U_OTHER].sort());
  });

  test('他人經其他 Callable 先佔同名去重文件（例如 adjustTeamReservation 以原始 requestId 當鍵）：不信任、不覆寫、照常報名', async () => {
    // adjustTeamReservation 在任何權限檢查前就以原始 requestId create _regDedupe 文件，任何登入者都能先佔。
    // 修正前：先佔 _regDedupe/planted（舊鍵）就讓受害者回 deduplicated 而沒報名。
    setup({
      [`events/${EVENT_ID}`]: event(),
      '_regDedupe/planted': { callerUid: U_OTHER },
      [`_regDedupe/register_${U_SELF}_planted`]: { callerUid: U_OTHER },
    });
    const victim = await register(U_SELF, selfPayload(U_SELF, { requestId: 'planted' }));
    expect(victim.deduplicated).toBeUndefined();
    expect(victim.registrations[0].userId).toBe(U_SELF);
    expect(fake.get(`_regDedupe/register_${U_SELF}_planted`)).toEqual({ callerUid: U_OTHER });
  });

  test('同呼叫者同 requestId 換活動 → REQUEST_ID_CONFLICT，零寫入', async () => {
    setup({
      [`events/${EVENT_ID}`]: event(),
      [`events/${EVENT_ID_2}`]: event({ id: EVENT_ID_2 }),
    });
    await register(U_SELF, selfPayload(U_SELF, { requestId: 'req-x' }));
    const writesBefore = fake.state.writes.length;
    await expectHttpsError(register(U_SELF, { ...selfPayload(U_SELF, { requestId: 'req-x' }), eventId: EVENT_ID_2 }), {
      code: 'failed-precondition',
      message: MSG.REQUEST_ID_CONFLICT,
      details: 'REQUEST_ID_CONFLICT',
    });
    expect(fake.state.writes.length).toBe(writesBefore);
    expect(regsOf(EVENT_ID_2)).toEqual([]);
  });

  test.each([
    ['沒帶', undefined],
    ['空字串', ''],
    ['含斜線', 'a/b'],
    ['點', '.'],
    ['非字串', 12345],
  ])('requestId %s → 不建去重文件，照常報名', async (_label, requestId) => {
    // 修正前：缺 requestId 時用含 Date.now() 的鍵 create（多一次寫入且沒有去重作用）；含斜線時 doc() 直接丟錯。
    setup({ [`events/${EVENT_ID}`]: event() });
    const result = await register(U_SELF, selfPayload(U_SELF, requestId === undefined ? {} : { requestId }));
    expect(result.registrations).toHaveLength(1);
    expect(dedupeDocs()).toEqual([]);
  });

  test('並發重送（同 requestId 同時兩個請求）：只有一筆報名，一個回原結果', async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    const [a, b] = await Promise.all([
      register(U_SELF, selfPayload(U_SELF, { requestId: 'race' })),
      register(U_SELF, selfPayload(U_SELF, { requestId: 'race' })),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.deduplicated === true)).toHaveLength(1);
    const original = results.find((r) => !r.deduplicated);
    const replay = results.find((r) => r.deduplicated);
    expect(replay.registrations).toEqual(original.registrations);
    expect(regsOf()).toHaveLength(1);
    expect(fake.list(`events/${EVENT_ID}/activityRecords`)).toHaveLength(1);
    expect(fake.get(`events/${EVENT_ID}`).current).toBe(1);
    expect(fake.state.transactionAttempts).toBeGreaterThanOrEqual(3);
  });

  test('並發不同 requestId 同一人：只有一筆，另一個 ALREADY_REGISTERED（既有交易內重複檢查，回歸）', async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    const outcomes = await Promise.allSettled([
      register(U_SELF, selfPayload(U_SELF, { requestId: 'r-a' })),
      register(U_SELF, selfPayload(U_SELF, { requestId: 'r-b' })),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === 'rejected');
    expect(rejected.reason.code).toBe('already-exists');
    expect(rejected.reason.message).toBe('ALREADY_REGISTERED');
    expect(regsOf()).toHaveLength(1);
  });

  test('早鳥：交易重試與同 requestId 重送都只扣一次點數', async () => {
    const notOpen = new FakeTimestamp(Date.now() + 24 * 60 * 60 * 1000);
    setup({ [`events/${EVENT_ID}`]: event({ regOpenTime: notOpen, earlyBirdEnabled: true, earlyBirdCost: 20, status: 'upcoming' }) });
    // 第一次 commit 前插入別人的寫入（碰活動文件）→ 交易 ABORTED 重跑
    fake.state.beforeTransactionCommit = async () => {
      fake.put(`events/${EVENT_ID}`, { ...fake.get(`events/${EVENT_ID}`), viewCount: 1 });
    };
    const payload = selfPayload(U_SELF, { requestId: 'eb-1', earlyBirdAccepted: true, earlyBirdExpectedCost: 20 });
    const first = await register(U_SELF, payload);
    expect(first.earlyBirdCharged).toBe(true);
    expect(fake.state.transactionAttempts).toBe(2);
    expect(fake.get(`users/${U_SELF}`).exp).toBe(80);
    const replay = await register(U_SELF, payload);
    expect(replay).toMatchObject({ deduplicated: true, earlyBirdCharged: true, earlyBirdCost: 20 });
    expect(fake.get(`users/${U_SELF}`).exp).toBe(80);
    expect(fake.list('expLogs')).toHaveLength(1);
  });

  test('讀寫次數：有 requestId 比沒有多 1 次交易內讀取、多 1 筆交易內寫入；交易外不再寫去重文件', async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    await register(U_SELF, selfPayload(U_SELF));
    const noIdReads = fake.state.reads.tx;
    const noIdTxWrites = fake.txWrites().length;

    setup({ [`events/${EVENT_ID}`]: event() });
    await register(U_SELF, selfPayload(U_SELF, { requestId: 'count' }));
    expect(fake.state.reads.tx).toBe(noIdReads + 1);
    expect(fake.txWrites().length).toBe(noIdTxWrites + 1);
    expect(fake.state.writes.filter((w) => w.path.startsWith('_regDedupe/') && w.via !== 'tx')).toEqual([]);
  });
});

describe('cancelRegistration 交易內去重', () => {
  function seedConfirmedAndWaitlisted() {
    return setup({
      [`events/${EVENT_ID}`]: event({ max: 1 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg('r1', { userId: U_SELF, userName: 'self', status: 'confirmed', registeredAt: new FakeTimestamp(1000) }),
      [`events/${EVENT_ID}/registrations/r2`]: reg('r2', { userId: U_OTHER, userName: 'other', status: 'waitlisted', registeredAt: new FakeTimestamp(2000) }),
      [`events/${EVENT_ID}/registrations/r3`]: reg('r3', { userId: U_THIRD, userName: 'third', status: 'waitlisted', registeredAt: new FakeTimestamp(3000) }),
      [`events/${EVENT_ID}/activityRecords/a1`]: { eventId: EVENT_ID, uid: U_SELF, status: 'registered' },
      [`events/${EVENT_ID}/activityRecords/a2`]: { eventId: EVENT_ID, uid: U_OTHER, status: 'waitlisted' },
      [`events/${EVENT_ID}/activityRecords/a3`]: { eventId: EVENT_ID, uid: U_THIRD, status: 'waitlisted' },
    });
  }

  test('正取取消 → 最早候補遞補（registeredAt ASC）、activityRecord 同步、occupancy 重建；重送回原結果且零寫入', async () => {
    // 修正前：重送只回 { success, deduplicated }，沒有 cancelled／promoted。
    seedConfirmedAndWaitlisted();
    const first = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ['r1'], requestId: 'c-1' });
    expect(first.cancelled.map((r) => r.docId)).toEqual(['r1']);
    expect(first.promoted.map((r) => r.docId)).toEqual(['r2']);
    expect(fake.get(`events/${EVENT_ID}/registrations/r1`).status).toBe('cancelled');
    expect(fake.get(`events/${EVENT_ID}/registrations/r2`).status).toBe('confirmed');
    expect(fake.get(`events/${EVENT_ID}/registrations/r3`).status).toBe('waitlisted');
    expect(fake.get(`events/${EVENT_ID}/activityRecords/a1`).status).toBe('cancelled');
    expect(fake.get(`events/${EVENT_ID}/activityRecords/a2`).status).toBe('registered');
    expect(fake.get(`events/${EVENT_ID}`)).toMatchObject({ current: 1, waitlist: 1 });
    expect(dedupeDocs()).toEqual([`cancel_${U_SELF}_c-1`]);
    const expAfterFirst = fake.get(`users/${U_SELF}`).exp;

    const writesBefore = fake.state.writes.length;
    const replay = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ['r1'], requestId: 'c-1' });
    expect(replay).toEqual({
      success: true,
      deduplicated: true,
      cancelled: first.cancelled,
      alreadyCancelled: first.alreadyCancelled,
      promoted: first.promoted,
    });
    expect(fake.state.writes.length).toBe(writesBefore);
    expect(fake.get(`users/${U_SELF}`).exp).toBe(expAfterFirst);
  });

  test('取消失敗後不留去重文件', async () => {
    // 修正前：交易外先 create，REG_NOT_FOUND 後文件仍在。
    seedConfirmedAndWaitlisted();
    await expectHttpsError(cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ['nope'], requestId: 'c-fail' }), {
      code: 'not-found',
      message: 'REG_NOT_FOUND',
    });
    expect(fake.state.writes).toEqual([]);
  });

  test('他人先用同 requestId 取消自己的報名，不影響受害者', async () => {
    seedConfirmedAndWaitlisted();
    await cancel(U_THIRD, { eventId: EVENT_ID, registrationIds: ['r3'], requestId: 'shared' });
    const victim = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ['r1'], requestId: 'shared' });
    expect(victim.deduplicated).toBeUndefined();
    expect(victim.cancelled.map((r) => r.docId)).toEqual(['r1']);
  });
});

// ═══════════════════════════════════════════════════════════════
//  黑名單（R-EVT-011／013／014）
// ═══════════════════════════════════════════════════════════════

describe('registerForEvent 黑名單四態（伺服器端）', () => {
  // 修正前：functions/ 全檔不看 blockedUids，被擋者可直接呼叫 Callable 報名。
  test('被擋且沒有任何報名紀錄 → 拒絕（文案精確）、零寫入', async () => {
    setup({ [`events/${EVENT_ID}`]: event({ blockedUids: [U_SELF] }) });
    await expectHttpsError(register(U_SELF, selfPayload(U_SELF, { requestId: 'b-1' })), {
      code: 'failed-precondition',
      message: MSG.EVENT_UNAVAILABLE,
      details: 'EVENT_UNAVAILABLE',
    });
    expect(fake.state.writes).toEqual([]);
  });

  test.each([
    ['已取消', { status: 'cancelled' }],
    ['已移除', { status: 'removed' }],
  ])('被擋但有%s紀錄 → 可報名（尊重歷史）', async (_label, history) => {
    setup({
      [`events/${EVENT_ID}`]: event({ blockedUids: [U_SELF] }),
      [`events/${EVENT_ID}/registrations/old`]: reg('old', { userId: U_SELF, userName: 'self', registeredAt: new FakeTimestamp(1000), ...history }),
    });
    const result = await register(U_SELF, selfPayload(U_SELF));
    expect(result.registrations).toHaveLength(1);
  });

  test('被擋但有 courseOwnerUids 含本人的紀錄 → 可報名（擁有判斷照 A _isRegistrationOwnedByUser）', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ blockedUids: [U_SELF] }),
      [`events/${EVENT_ID}/registrations/old`]: reg('old', { userId: 'student-x', courseOwnerUids: [U_SELF], status: 'cancelled', registeredAt: new FakeTimestamp(1000) }),
    });
    const result = await register(U_SELF, selfPayload(U_SELF));
    expect(result.registrations).toHaveLength(1);
  });

  test('被擋者只報同行者也擋（只看 operator）', async () => {
    setup({ [`events/${EVENT_ID}`]: event({ blockedUids: [U_SELF] }) });
    await expectHttpsError(register(U_SELF, {
      eventId: EVENT_ID,
      participants: [{ userId: U_SELF, userName: 's', companionId: 'c1', companionName: 'c1' }],
    }), { details: 'EVENT_UNAVAILABLE' });
  });

  test('operator 未被擋，同行者 id 即使出現在黑名單也不擋（R-EVT-014）', async () => {
    setup({ [`events/${EVENT_ID}`]: event({ blockedUids: [U_OTHER, 'c-blocked'] , max: 5 }) });
    const result = await register(U_SELF, {
      eventId: EVENT_ID,
      participants: [
        { userId: U_SELF, userName: 's' },
        { userId: U_SELF, userName: 's', companionId: 'c-blocked', companionName: 'blocked friend' },
      ],
    });
    expect(result.registrations).toHaveLength(2);
  });

  test('管理員被擋也照擋（四態沒有角色豁免）', async () => {
    setup({ [`events/${EVENT_ID}`]: event({ blockedUids: [U_ADMIN] }) });
    await expectHttpsError(register(U_ADMIN, selfPayload(U_ADMIN)), { details: 'EVENT_UNAVAILABLE' });
  });

  test('被擋者取消自己的報名不受影響', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ blockedUids: [U_SELF] }),
      [`events/${EVENT_ID}/registrations/r1`]: reg('r1', { userId: U_SELF, userName: 's', status: 'confirmed', registeredAt: new FakeTimestamp(1000) }),
    });
    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ['r1'] });
    expect(result.cancelled).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
//  minAge（只檢查本人，台北時區活動開始日）
// ═══════════════════════════════════════════════════════════════

describe('registerForEvent minAge（伺服器端）', () => {
  // 修正前：伺服器只存 minAge 欄位，不檢查；未滿齡可直接呼叫 Callable 報名。
  test('未滿齡 → AGE_RESTRICTED、文案照 A、零寫入', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ minAge: 18, date: '2030/06/15 10:00~12:00' }),
      [`users/${U_SELF}`]: user(U_SELF, { birthday: '2012-06-16' }),
    });
    await expectHttpsError(register(U_SELF, selfPayload(U_SELF)), {
      code: 'failed-precondition',
      message: '此活動限 18 歲以上報名',
      details: 'AGE_RESTRICTED',
    });
    expect(fake.state.writes).toEqual([]);
  });

  test('活動開始日剛好滿齡 → 可報名', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ minAge: 18, date: '2030/06/15 10:00~12:00' }),
      [`users/${U_SELF}`]: user(U_SELF, { birthday: '2012-06-15' }),
    });
    const result = await register(U_SELF, selfPayload(U_SELF));
    expect(result.registrations).toHaveLength(1);
  });

  test('台北日界：活動台北 06/15 00:30（UTC 仍是 06/14）以台北日期計算 → 生日 06/15 當天滿齡', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ minAge: 18, date: '2030/06/15 00:30~02:00' }),
      [`users/${U_SELF}`]: user(U_SELF, { birthday: '2012/06/15' }),
    });
    const result = await register(U_SELF, selfPayload(U_SELF));
    expect(result.registrations).toHaveLength(1);
  });

  test.each([
    ['格式錯', 'June 1 1990'],
    ['不存在的日期 2/30', '1990-02-30'],
  ])('生日%s → BIRTHDAY_REQUIRED', async (_label, birthday) => {
    setup({
      [`events/${EVENT_ID}`]: event({ minAge: 12 }),
      [`users/${U_SELF}`]: user(U_SELF, { birthday }),
    });
    await expectHttpsError(register(U_SELF, selfPayload(U_SELF)), {
      message: MSG.BIRTHDAY_REQUIRED,
      details: 'BIRTHDAY_REQUIRED',
    });
  });

  test('找不到 users 文件且 minAge>0 → BIRTHDAY_REQUIRED', async () => {
    setup({ [`events/${EVENT_ID}`]: event({ minAge: 12 }) });
    const ghost = `U${'7'.repeat(32)}`;
    await expectHttpsError(register(ghost, selfPayload(ghost)), { details: 'BIRTHDAY_REQUIRED' });
  });

  test.each([[0], [undefined], ['abc']])('minAge=%p → 不檢查', async (minAge) => {
    setup({
      [`events/${EVENT_ID}`]: event({ minAge }),
      [`users/${U_SELF}`]: user(U_SELF, { birthday: '2025-01-01' }),
    });
    const result = await register(U_SELF, selfPayload(U_SELF));
    expect(result.registrations).toHaveLength(1);
  });

  test('只帶同行者（不含本人）→ 不檢查年齡', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ minAge: 18 }),
      [`users/${U_SELF}`]: user(U_SELF, { birthday: '2020-01-01' }),
    });
    const result = await register(U_SELF, {
      eventId: EVENT_ID,
      participants: [{ userId: U_SELF, userName: 's', companionId: 'c1', companionName: 'kid' }],
    });
    expect(result.registrations).toHaveLength(1);
    expect(result.registrations[0].participantType).toBe('companion');
  });
});

// ═══════════════════════════════════════════════════════════════
//  同行者參與者身分（Q3）
// ═══════════════════════════════════════════════════════════════

describe('registerForEvent 參與者身分', () => {
  // 修正前：只檢查 participants[0]，第 2 位可塞別人的 UID，會替別人建「同行者報名」。
  test('第 2 位 userId 不是本人 → permission-denied、零寫入', async () => {
    setup({ [`events/${EVENT_ID}`]: event({ max: 5 }) });
    await expectHttpsError(register(U_SELF, {
      eventId: EVENT_ID,
      participants: [
        { userId: U_SELF, userName: 's' },
        { userId: U_OTHER, userName: 'victim', companionId: 'c1', companionName: 'x' },
      ],
    }), { code: 'permission-denied', details: 'PARTICIPANT_NOT_ALLOWED' });
    expect(fake.state.writes).toEqual([]);
  });

  test('第 2 位缺 companionId → permission-denied', async () => {
    setup({ [`events/${EVENT_ID}`]: event({ max: 5 }) });
    await expectHttpsError(register(U_SELF, {
      eventId: EVENT_ID,
      participants: [{ userId: U_SELF, userName: 's' }, { userId: U_SELF, userName: 's' }],
    }), { code: 'permission-denied', details: 'PARTICIPANT_NOT_ALLOWED' });
    expect(fake.state.writes).toEqual([]);
  });

  test('正常同行者報名（A／B 形狀）照常', async () => {
    setup({ [`events/${EVENT_ID}`]: event({ max: 5 }) });
    const result = await register(U_SELF, {
      eventId: EVENT_ID,
      participants: [
        { userId: U_SELF, userName: 's' },
        { userId: U_SELF, userName: 's', companionId: 'c1', companionName: 'friend' },
      ],
      requestId: 'comp-ok',
    });
    expect(result.registrations.map((r) => r.participantType)).toEqual(['self', 'companion']);
  });
});

// ═══════════════════════════════════════════════════════════════
//  取消時限（只套 user_cancel）
// ═══════════════════════════════════════════════════════════════

describe('cancelRegistration 取消時限（伺服器端）', () => {
  // 修正前：cancelRegistration 交易內不看 status 與開始時間，開始後仍可取消並觸發遞補。
  function seedStarted({ status = 'open', date } = {}) {
    return setup({
      [`events/${EVENT_ID}`]: event({ max: 1, status, date: date || taipeiEventDate(Date.now() - 60 * 1000) }),
      [`events/${EVENT_ID}/registrations/r1`]: reg('r1', { userId: U_SELF, userName: 's', status: 'confirmed', registeredAt: new FakeTimestamp(1000) }),
      [`events/${EVENT_ID}/registrations/r1c`]: reg('r1c', { userId: U_SELF, userName: 's', participantType: 'companion', companionId: 'c1', companionName: 'f', status: 'waitlisted', registeredAt: new FakeTimestamp(1500) }),
      [`events/${EVENT_ID}/registrations/r2`]: reg('r2', { userId: U_OTHER, userName: 'o', status: 'waitlisted', registeredAt: new FakeTimestamp(2000) }),
      [`events/${EVENT_ID}/activityRecords/a1`]: { eventId: EVENT_ID, uid: U_SELF, status: 'registered' },
      [`events/${EVENT_ID}/activityRecords/a2`]: { eventId: EVENT_ID, uid: U_OTHER, status: 'waitlisted' },
    });
  }

  test('開始時間已過 1 分鐘：user_cancel → EVENT_STARTED、零寫入（不取消、不遞補、不改 occupancy、不建去重）', async () => {
    seedStarted();
    await expectHttpsError(cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ['r1'], requestId: 'late' }), {
      code: 'failed-precondition',
      message: MSG.CANCEL_STARTED,
      details: 'EVENT_STARTED',
    });
    expect(fake.state.writes).toEqual([]);
    expect(fake.get(`events/${EVENT_ID}/registrations/r2`).status).toBe('waitlisted');
  });

  test('開始前 2 分鐘：user_cancel 照常', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 1, date: taipeiEventDate(Date.now() + 2 * 60 * 1000) }),
      [`events/${EVENT_ID}/registrations/r1`]: reg('r1', { userId: U_SELF, userName: 's', status: 'confirmed', registeredAt: new FakeTimestamp(1000) }),
    });
    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ['r1'] });
    expect(result.cancelled).toHaveLength(1);
  });

  test.each([['ended'], ['cancelled']])('status=%s（開始時間未到）→ EVENT_ENDED', async (status) => {
    seedStarted({ status, date: FUTURE_DATE });
    await expectHttpsError(cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ['r1'] }), {
      message: MSG.CANCEL_ENDED,
      details: 'EVENT_ENDED',
    });
    expect(fake.state.writes).toEqual([]);
  });

  test('companion_toggle（正規化為 user_cancel）也擋', async () => {
    seedStarted();
    await expectHttpsError(cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ['r1c'], reason: 'companion_toggle' }), {
      details: 'EVENT_STARTED',
    });
  });

  test('A10 同行者多選取消（本人＋同行者一次送）開始後也擋（Q1）', async () => {
    seedStarted();
    await expectHttpsError(cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ['r1', 'r1c'] }), {
      details: 'EVENT_STARTED',
    });
    expect(fake.state.writes).toEqual([]);
  });

  test.each([['manager_remove'], ['capacity_change']])('%s 不套時限（開始後仍可操作並遞補）', async (reason) => {
    seedStarted();
    const result = await cancel(U_ADMIN, { eventId: EVENT_ID, registrationIds: ['r1'], reason });
    expect(result.cancelled.map((r) => r.docId)).toEqual(['r1']);
    expect(result.promoted.length).toBeGreaterThan(0);
  });

  test('全部已取消的重送（alreadyCancelled 路徑）開始後照常回 alreadyCancelled', async () => {
    seedStarted();
    fake.put(`events/${EVENT_ID}/registrations/r1`, { ...fake.get(`events/${EVENT_ID}/registrations/r1`), status: 'cancelled' });
    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ['r1'] });
    expect(result.cancelled).toEqual([]);
    expect(result.alreadyCancelled.map((r) => r.docId)).toEqual(['r1']);
  });

  test('課程連動報名的家長請假（user_cancel）開始後也擋（Q2）、零寫入', async () => {
    const teamId = 'tm_1800000000000_abcdef';
    const courseLinkId = 'link-1';
    setup({
      [`events/${EVENT_ID}`]: event({
        max: 1,
        date: taipeiEventDate(Date.now() - 60 * 1000),
        courseLinked: true,
        courseLinkSource: 'eduCourseLesson',
        courseLinkId,
        courseTeamId: teamId,
        coursePlanId: 'plan-1',
        courseSessionId: 'sess-1',
      }),
      [`events/${EVENT_ID}/registrations/rc`]: reg('rc', {
        userId: 'student-a',
        userName: 'kid',
        status: 'confirmed',
        registeredAt: new FakeTimestamp(1000),
        source: 'eduCourseLesson',
        courseLinkId,
        courseTeamId: teamId,
        coursePlanId: 'plan-1',
        courseSessionId: 'sess-1',
        courseStudentId: 'student-a',
      }),
      [`teams/${teamId}`]: { id: teamId, name: 'team' },
      [`teams/${teamId}/coursePlans/plan-1`]: { id: 'plan-1' },
      [`teams/${teamId}/coursePlans/plan-1/sessions/sess-1`]: { id: 'sess-1', date: '2026/01/01' },
      [`teams/${teamId}/coursePlans/plan-1/sessionEventLinks/sess-1`]: { eventId: EVENT_ID, courseLinkId },
      [`teams/${teamId}/students/student-a`]: { id: 'student-a', name: 'kid', parentUid: U_SELF },
    });
    await expectHttpsError(cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ['rc'] }), {
      details: 'EVENT_STARTED',
    });
    expect(fake.state.writes).toEqual([]);
  });

  test('課程連動報名的家長請假開始前照常（回歸：課程情境讀取仍可用）', async () => {
    const teamId = 'tm_1800000000000_abcdef';
    const courseLinkId = 'link-1';
    setup({
      [`events/${EVENT_ID}`]: event({
        max: 1,
        courseLinked: true,
        courseLinkSource: 'eduCourseLesson',
        courseLinkId,
        courseTeamId: teamId,
        coursePlanId: 'plan-1',
        courseSessionId: 'sess-1',
      }),
      [`events/${EVENT_ID}/registrations/rc`]: reg('rc', {
        userId: 'student-a',
        userName: 'kid',
        status: 'confirmed',
        registeredAt: new FakeTimestamp(1000),
        source: 'eduCourseLesson',
        courseLinkId,
        courseTeamId: teamId,
        coursePlanId: 'plan-1',
        courseSessionId: 'sess-1',
        courseStudentId: 'student-a',
      }),
      [`teams/${teamId}`]: { id: teamId, name: 'team' },
      [`teams/${teamId}/coursePlans/plan-1`]: { id: 'plan-1' },
      [`teams/${teamId}/coursePlans/plan-1/sessions/sess-1`]: { id: 'sess-1', date: '2099/06/15' },
      [`teams/${teamId}/coursePlans/plan-1/sessionEventLinks/sess-1`]: { eventId: EVENT_ID, courseLinkId },
      [`teams/${teamId}/students/student-a`]: { id: 'student-a', name: 'kid', parentUid: U_SELF },
    });
    const result = await cancel(U_SELF, { eventId: EVENT_ID, registrationIds: ['rc'] });
    expect(result.cancelled.map((r) => r.docId)).toEqual(['rc']);
    expect(fake.get(`events/${EVENT_ID}/registrations/rc`).courseAttendanceKind).toBe('leave');
  });
});

// ═══════════════════════════════════════════════════════════════
//  錯誤邊界（R-CF-002）
// ═══════════════════════════════════════════════════════════════

describe('registration callables 錯誤邊界', () => {
  test('非 HttpsError 的底層錯誤 → internal／INTERNAL，不露原始訊息；log 不含 UID 與 requestId', async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    const original = fake.db.runTransaction;
    fake.db.runTransaction = async () => { throw new Error(`boom ${U_SELF} secret-request`); };
    const error = await expectHttpsError(register(U_SELF, selfPayload(U_SELF, { requestId: 'secret-request' })), {
      code: 'internal',
      message: 'INTERNAL',
    });
    expect(error.details).toBeUndefined();
    fake.db.runTransaction = original;
    const logged = JSON.stringify(console.error.mock.calls);
    expect(logged).toContain('registerForEvent');
    expect(logged).not.toContain(U_SELF);
    expect(logged).not.toContain('secret-request');
    expect(logged).not.toContain('boom');
  });

  test('交易重試用盡（ABORTED）→ internal，交易內沒有把 ABORTED 轉成 HttpsError（SDK 重試 5 次）', async () => {
    setup({ [`events/${EVENT_ID}`]: event() });
    let attempts = 0;
    const realRun = fake.db.runTransaction;
    fake.db.runTransaction = async (callback) => realRun(async (tx) => {
      attempts += 1;
      const value = await callback(tx);
      const error = new Error('contention');
      error.code = 10;
      throw error;
      // eslint-disable-next-line no-unreachable
      return value;
    });
    await expectHttpsError(register(U_SELF, selfPayload(U_SELF, { requestId: 'abort' })), { code: 'internal' });
    expect(attempts).toBe(5);
    expect(fake.state.writes).toEqual([]);
  });
});
