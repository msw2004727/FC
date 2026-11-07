/**
 * 2026-11-07 站長定案 F1：名單有空洞（人數＜名額但仍有候補）時，registerForEvent 同交易先把空位依序補給候補，
 * 再判定新報名者。直接跑 functions/index.js 真正的 registerForEvent／cancelRegistration（vm 載入、記憶體版 Firestore）。
 *
 * 修正前應失敗：registerForEvent 只看 current < max，空洞時新報名者直接正取、越過所有候補。
 */

const {
  FakeTimestamp,
  createFakeFirestore,
  loadFunctionsIndex,
} = require('./registration-callable-harness');

const U_SELF = `U${'1'.repeat(32)}`;
const U_OTHER = `U${'2'.repeat(32)}`;
const U_THIRD = `U${'3'.repeat(32)}`;
const U_FOURTH = `U${'4'.repeat(32)}`;
const EVENT_ID = 'ce_1800000000000_abc';

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

function user(uid) {
  return {
    uid, lineUserId: uid, name: `name-${uid.slice(0, 4)}`, displayName: `user-${uid.slice(1, 3)}`,
    gender: 'male', birthday: '1990-01-01', region: 'taipei', role: 'user', exp: 100,
  };
}

function event(extra = {}) {
  return {
    id: EVENT_ID, title: 'F1 event', date: '2099/06/15 10:00~12:00', location: 'field', type: 'play',
    status: 'open', max: 2, current: 0, waitlist: 0, participants: [], waitlistNames: [], ...extra,
  };
}

function reg(docId, data) {
  return {
    id: `reg_${docId}`, eventId: EVENT_ID, participantType: 'self', companionId: null, companionName: null,
    promotionOrder: 0, ...data,
  };
}

function setup(seed = {}) {
  fake = createFakeFirestore({
    [`users/${U_SELF}`]: user(U_SELF),
    [`users/${U_OTHER}`]: user(U_OTHER),
    [`users/${U_THIRD}`]: user(U_THIRD),
    [`users/${U_FOURTH}`]: user(U_FOURTH),
    ...seed,
  });
  harness.current = fake;
  return fake;
}

function register(uid) {
  return fn.registerForEvent({
    auth: { uid, token: {} },
    data: { eventId: EVENT_ID, participants: [{ userId: uid, userName: `n-${uid.slice(1, 3)}` }] },
  });
}

function cancel(uid, registrationIds) {
  return fn.cancelRegistration({ auth: { uid, token: {} }, data: { eventId: EVENT_ID, registrationIds } });
}

function regsOf() {
  return fake.list(`events/${EVENT_ID}/registrations`)
    .map((id) => ({ _docId: id, ...fake.get(`events/${EVENT_ID}/registrations/${id}`) }));
}

function regOfUser(uid) {
  return regsOf().find((r) => r.userId === uid && (r.status === 'confirmed' || r.status === 'waitlisted'));
}

function inboxTitlesFor(uid) {
  return fake.list(`users/${uid}/inbox`).map((id) => fake.get(`users/${uid}/inbox/${id}`).title);
}

describe('F1 registerForEvent 空洞時先遞補候補', () => {
  function seedHole() {
    // max 2、正取 1 人、候補 1 人：有一個空洞（例如舊站 A 調名額未遞補留下的）
    return setup({
      [`events/${EVENT_ID}`]: event({ max: 2, current: 1, waitlist: 1 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg('r1', { userId: U_SELF, userName: 'self', status: 'confirmed', registeredAt: new FakeTimestamp(1000) }),
      [`events/${EVENT_ID}/registrations/r2`]: reg('r2', { userId: U_OTHER, userName: 'other', status: 'waitlisted', registeredAt: new FakeTimestamp(2000) }),
      [`events/${EVENT_ID}/activityRecords/a1`]: { eventId: EVENT_ID, uid: U_SELF, status: 'registered' },
      [`events/${EVENT_ID}/activityRecords/a2`]: { eventId: EVENT_ID, uid: U_OTHER, status: 'waitlisted' },
    });
  }

  test('新報名者排候補，原候補同交易遞補為正取（報名、活動紀錄、佔位、通知、EXP、紀錄）', async () => {
    seedHole();
    const result = await register(U_THIRD);
    expect(result.registrations[0].status).toBe('waitlisted');
    expect(fake.get(`events/${EVENT_ID}/registrations/r2`)).toMatchObject({ status: 'confirmed' });
    expect(fake.get(`events/${EVENT_ID}/registrations/r2`).promotedAt).toBeDefined();
    expect(fake.get(`events/${EVENT_ID}/activityRecords/a2`).status).toBe('registered');
    expect(regOfUser(U_THIRD).status).toBe('waitlisted');
    expect(fake.get(`events/${EVENT_ID}`)).toMatchObject({
      current: 2, waitlist: 1, status: 'full', participants: ['self', 'other'], waitlistNames: ['n-33'],
    });
    expect(inboxTitlesFor(U_OTHER)).toEqual(['候補遞補通知']);
    expect(inboxTitlesFor(U_THIRD)).toEqual(['報名成功通知']);
    expect(fake.get(`users/${U_OTHER}`).exp).toBe(110);
    expect(fake.get(`users/${U_THIRD}`).exp).toBe(100);
    const logs = fake.list('operationLogs').map((id) => fake.get(`operationLogs/${id}`));
    expect(logs.filter((log) => log.type === 'auto_promote')).toHaveLength(1);
  });

  test('空洞多於候補人數：候補全部遞補後，新報名者照常正取', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 3 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg('r1', { userId: U_SELF, userName: 'self', status: 'confirmed', registeredAt: new FakeTimestamp(1000) }),
      [`events/${EVENT_ID}/registrations/r2`]: reg('r2', { userId: U_OTHER, userName: 'other', status: 'waitlisted', registeredAt: new FakeTimestamp(2000) }),
    });
    const result = await register(U_THIRD);
    expect(result.registrations[0].status).toBe('confirmed');
    expect(fake.get(`events/${EVENT_ID}/registrations/r2`).status).toBe('confirmed');
    expect(fake.get(`events/${EVENT_ID}`)).toMatchObject({ current: 3, waitlist: 0, status: 'full' });
  });

  test('沒有空洞（回歸）：不讀活動紀錄、不動既有候補', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 2 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg('r1', { userId: U_SELF, userName: 'self', status: 'confirmed', registeredAt: new FakeTimestamp(1000) }),
    });
    const result = await register(U_THIRD);
    expect(result.registrations[0].status).toBe('confirmed');
    expect(fake.state.writes.some((w) => /registrations\/r1$/.test(w.path))).toBe(false);
  });

  test('正取取消後立刻再報名：取消時遞補第一位候補，再報名者排到候補最後', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 1 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg('r1', { userId: U_SELF, userName: 'self', status: 'confirmed', registeredAt: new FakeTimestamp(1000) }),
      [`events/${EVENT_ID}/registrations/r2`]: reg('r2', { userId: U_OTHER, userName: 'other', status: 'waitlisted', registeredAt: new FakeTimestamp(2000) }),
      [`events/${EVENT_ID}/registrations/r3`]: reg('r3', { userId: U_THIRD, userName: 'third', status: 'waitlisted', registeredAt: new FakeTimestamp(3000) }),
      [`events/${EVENT_ID}/activityRecords/a1`]: { eventId: EVENT_ID, uid: U_SELF, status: 'registered' },
    });
    await cancel(U_SELF, ['r1']);
    expect(fake.get(`events/${EVENT_ID}/registrations/r2`).status).toBe('confirmed');
    const again = await register(U_SELF);
    expect(again.registrations[0].status).toBe('waitlisted');
    expect(fake.get(`events/${EVENT_ID}`)).toMatchObject({
      current: 1, participants: ['other'], waitlistNames: ['third', 'n-11'],
    });
  });

  test('空洞＋候補且新報名者為不同人：遞補依 registeredAt→promotionOrder 順序', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 2 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg('r1', { userId: U_SELF, userName: 'self', status: 'confirmed', registeredAt: new FakeTimestamp(1000) }),
      [`events/${EVENT_ID}/registrations/r3`]: reg('r3', { userId: U_THIRD, userName: 'third', status: 'waitlisted', registeredAt: new FakeTimestamp(3000) }),
      [`events/${EVENT_ID}/registrations/r2`]: reg('r2', { userId: U_OTHER, userName: 'other', status: 'waitlisted', registeredAt: new FakeTimestamp(2000) }),
    });
    await register(U_FOURTH);
    expect(fake.get(`events/${EVENT_ID}/registrations/r2`).status).toBe('confirmed');
    expect(fake.get(`events/${EVENT_ID}/registrations/r3`).status).toBe('waitlisted');
    expect(fake.get(`events/${EVENT_ID}`).waitlistNames).toEqual(['third', 'n-44']);
  });

  test('俱樂部保留名額有剩、候補是該俱樂部成員：以 reserved 遞補並寫入席位來源', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 2, teamReservationSummaries: [{ teamId: 'teamA', teamName: 'A隊', reservedSlots: 1 }] }),
      [`events/${EVENT_ID}/registrations/r1`]: reg('r1', { userId: U_SELF, userName: 'self', status: 'confirmed', registeredAt: new FakeTimestamp(1000) }),
      [`events/${EVENT_ID}/registrations/r2`]: reg('r2', {
        userId: U_OTHER, userName: 'other', status: 'waitlisted', registeredAt: new FakeTimestamp(2000),
        teamReservationTeamId: 'teamA', teamReservationTeamName: 'A隊', teamSeatSource: 'waitlist',
      }),
    });
    const result = await register(U_FOURTH);
    expect(result.registrations[0].status).toBe('waitlisted');
    expect(fake.get(`events/${EVENT_ID}/registrations/r2`)).toMatchObject({ status: 'confirmed', teamSeatSource: 'reserved' });
    expect(fake.get(`events/${EVENT_ID}`)).toMatchObject({ current: 2, realCurrent: 2, waitlist: 1 });
  });

  test('遞補到同組同行者：主報名者只收一封通知、EXP 只加本人一次', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 3 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg('r1', { userId: U_SELF, userName: 'self', status: 'confirmed', registeredAt: new FakeTimestamp(1000) }),
      [`events/${EVENT_ID}/registrations/r2`]: reg('r2', { userId: U_OTHER, userName: 'other', status: 'waitlisted', registeredAt: new FakeTimestamp(2000) }),
      [`events/${EVENT_ID}/registrations/r2c`]: reg('r2c', {
        userId: U_OTHER, userName: 'other', participantType: 'companion', companionId: 'comp_o', companionName: 'other-c',
        status: 'waitlisted', registeredAt: new FakeTimestamp(2000), promotionOrder: 1,
      }),
      [`events/${EVENT_ID}/activityRecords/a2`]: { eventId: EVENT_ID, uid: U_OTHER, status: 'waitlisted' },
    });
    const result = await register(U_THIRD);
    expect(result.registrations[0].status).toBe('waitlisted');
    expect(fake.get(`events/${EVENT_ID}/registrations/r2`).status).toBe('confirmed');
    expect(fake.get(`events/${EVENT_ID}/registrations/r2c`).status).toBe('confirmed');
    expect(fake.get(`events/${EVENT_ID}/activityRecords/a2`).status).toBe('registered');
    expect(inboxTitlesFor(U_OTHER)).toEqual(['候補遞補通知']);
    expect(fake.get(`users/${U_OTHER}`).exp).toBe(110);
    const logs = fake.list('operationLogs').map((id) => fake.get(`operationLogs/${id}`));
    expect(logs.filter((log) => log.type === 'auto_promote')).toHaveLength(2);
  });

  test('被手動下放者（waitlistSortAt）排在下放後仍在候補的人之後', async () => {
    setup({
      [`events/${EVENT_ID}`]: event({ max: 2 }),
      [`events/${EVENT_ID}/registrations/r1`]: reg('r1', { userId: U_SELF, userName: 'self', status: 'confirmed', registeredAt: new FakeTimestamp(1000) }),
      [`events/${EVENT_ID}/registrations/r2`]: reg('r2', { userId: U_OTHER, userName: 'other', status: 'waitlisted', registeredAt: new FakeTimestamp(500), waitlistSortAt: new FakeTimestamp(5000) }),
      [`events/${EVENT_ID}/registrations/r3`]: reg('r3', { userId: U_THIRD, userName: 'third', status: 'waitlisted', registeredAt: new FakeTimestamp(3000) }),
    });
    await register(U_FOURTH);
    expect(fake.get(`events/${EVENT_ID}/registrations/r3`).status).toBe('confirmed');
    expect(fake.get(`events/${EVENT_ID}/registrations/r2`).status).toBe('waitlisted');
    expect(fake.get(`events/${EVENT_ID}`).waitlistNames).toEqual(['other', 'n-44']);
  });
});
