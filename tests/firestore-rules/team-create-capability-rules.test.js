/**
 * T-090a create contract.
 * 顧問裁定（2026-11-04）：一般用戶建俱樂部只走 Callable createUserTeam（Admin SDK，不經 Rules）；
 * Rules 移除能力碼自建分支，一般 user 憑 user.activity.team_create 直接 setDoc 一律拒絕。
 * 取代原「能力碼放行＋M1 欄位／預設值檢查」案例；那些拒絕案例在分支移除後已無對象，改由本檔的「完整合法 payload 也被拒」覆蓋。
 */
const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc } = require('firebase/firestore');
const { CAP, DEFAULTS, BASE_CAPS, team, harness } = require('./t090a-fixtures');
jest.setTimeout(30000);
const h = harness('create');

// The full payload the removed capability branch used to accept (self staff, explicit defaults, fresh tm_ id).
const fullUserPayload = (extra = {}) => team({ ownerUid: 'owner', coachUids: ['owner'], leaderUids: ['owner'], leaderUid: 'owner', ...DEFAULTS, ...extra });

describe('T-090a capability document and role boundaries', () => {
  test('missing capability document no longer lets a user create directly', async () => { await assertFails(h.create()); });
  test('present capability code no longer lets a user create directly', async () => { await h.cap({ capabilities: [CAP] }); await assertFails(h.create()); });
  test.each([[], ['user.activity.basic_create'], null, true, CAP, { [CAP]: true }])('present capabilities %j fails closed', async capabilities => {
    await h.cap({ capabilities }); await assertFails(h.create());
  });
  test('present document missing capabilities fails closed', async () => { await h.cap({}); await assertFails(h.create()); });
  test('super-admin capability toggle never opens direct user create', async () => {
    await setDoc(doc(h.db('super'), 'roleActivityCapabilities', 'user'), { capabilities: [] });
    await assertFails(h.create());
    await setDoc(doc(h.db('super'), 'roleActivityCapabilities', 'user'), { capabilities: [CAP] });
    await assertFails(h.create());
    await setDoc(doc(h.db('super'), 'roleActivityCapabilities', 'user'), { capabilities: [...BASE_CAPS, CAP] });
    await assertFails(h.create());
  });
  test.each(['coach', 'captain', 'venue'])('%s cannot use the user capability', async uid => {
    await h.cap({ capabilities: [CAP] });
    const data = team({ creatorUid: uid, captainUid: uid });
    await assertFails(h.create(data, uid));
    await assertFails(setDoc(doc(h.db(uid, { role: 'user' }), 'teams', data.id), data));
  });
  test('stored user role with forged coach claim still cannot create', async () => {
    const data = team();
    await assertFails(setDoc(doc(h.db('owner', { role: 'coach' }), 'teams', data.id), data));
  });
  test.each(['admin', 'super', 'manager'])('%s keeps privileged create including legacy payload', async uid => {
    await h.cap({ capabilities: [] });
    await assertSucceeds(h.create({ id: 'legacy_' + uid, name: 'Managed', captainUid: 'other', pinned: true, members: 5 }, uid));
  });
  // F3 (advisor ruling): team.create without canManageAnyTeam() no longer accepts legacy ids; fresh tm_ ids keep the free-form payload.
  test('granted team.create keeps legacy payload only with a fresh tm_ id', async () => {
    await h.cap({ capabilities: [] });
    await assertFails(h.create({ id: 'legacy_granted', name: 'Managed', captainUid: 'other', pinned: true, members: 5 }, 'granted'));
    const id = 'tm_' + Date.now() + '_g';
    await assertSucceeds(h.create({ id, name: 'Managed', captainUid: 'other', pinned: true, members: 5 }, 'granted'));
  });
  test('coach granted team.create retains privileged create only with a fresh tm_ id', async () => {
    await h.seed('userPermissionGrants', 'coach', { permissions: ['team.create'], enabled: true });
    await assertFails(h.create({ id: 'legacy_coach', name: 'Managed', captainUid: 'other' }, 'coach'));
    const id = 'tm_' + Date.now() + '_c';
    await assertSucceeds(h.create({ id, name: 'Managed', captainUid: 'other' }, 'coach'));
  });
  test('unauthenticated create denied', async () => { const data = team(); await assertFails(setDoc(doc(h.guest(), 'teams', data.id), data)); });
  test('user cannot grant own capability', async () => { await assertFails(setDoc(doc(h.db(), 'roleActivityCapabilities', 'user'), { capabilities: [CAP] })); });
});

describe('advisor ruling: user direct setDoc with a complete legal user_capability payload is denied', () => {
  const CAP_STATES = [
    ['missing capability document (old fallback default)', null],
    ['capability document with only team_create', [CAP]],
    ['capability document with every user code', [...BASE_CAPS, CAP]],
  ];
  const PAYLOADS = [
    ['minimal', () => team()],
    ['self staff and explicit defaults', () => fullUserPayload()],
    ['empty staff lists', () => fullUserPayload({ coachUids: [], leaderUids: [], leaderUid: null })],
    ['timestamp -2 days', () => fullUserPayload({ id: 'tm_' + (Date.now() - 2 * 86400000) + '_m2' })],
    ['timestamp +2 days', () => fullUserPayload({ id: 'tm_' + (Date.now() + 2 * 86400000) + '_p2' })],
  ];
  test.each(CAP_STATES.flatMap(([capLabel, caps]) => PAYLOADS.map(([payloadLabel, make]) => [capLabel, payloadLabel, caps, make])))('%s / %s denied', async (_capLabel, _payloadLabel, caps, make) => {
    if (caps) await h.cap({ capabilities: caps });
    await assertFails(h.create(make()));
  });
  test('another plain user with the code is denied as well', async () => {
    await h.cap({ capabilities: [CAP] });
    await assertFails(h.create(fullUserPayload({ creatorUid: 'other', captainUid: 'other', ownerUid: 'other', coachUids: ['other'], leaderUids: ['other'], leaderUid: 'other' }), 'other'));
  });
});

describe('team.create holders keep fresh-id create (unchanged by the ruling)', () => {
  // P2-1: holder payloads no longer carry the user_capability marker (Admin SDK only); see the P2-1 describe below.
  const holderPayload = (uid, extra = {}) => {
    const data = team({ creatorUid: uid, captainUid: uid, ownerUid: uid, coachUids: [uid], leaderUids: [uid], leaderUid: uid, ...DEFAULTS, ...extra });
    if (!('createdVia' in extra)) delete data.createdVia;
    return data;
  };
  test.each([
    ['missing capability document', null],
    ['closed capability document', []],
    ['capability document with team_create', [CAP]],
  ])('granted user with %s creates under a fresh tm_ id', async (_label, caps) => {
    if (caps) await h.cap({ capabilities: caps });
    await assertSucceeds(h.create(holderPayload('granted'), 'granted'));
  });
  test('granted user holder payload still needs a fresh tm_ id', async () => {
    await assertFails(h.create(holderPayload('granted', { id: 'legacy_marked' }), 'granted'));
    await assertFails(h.create(holderPayload('granted', { id: 'tm_' + (Date.now() + 4 * 86400000) + '_late' }), 'granted'));
  });
  test('role-based team.create holder creates under a fresh tm_ id', async () => {
    await h.seed('rolePermissions', 'coach', { permissions: ['team.create'] });
    await assertSucceeds(h.create(holderPayload('coach', { createdVia: 'managed' }), 'coach'));
  });
});

// T-090a P2-1: createUserTeam counts creatorUid == caller && createdVia == 'user_capability' for the per-user cap of 3.
// Non-canManageAnyTeam() creates must not forge that marker nor attribute the team to someone else.
describe('T-090a P2-1 team.create holders cannot forge user_capability provenance', () => {
  const HOLDERS = ['granted', 'coach-role', 'coach-grant'];
  async function holder(kind) {
    await h.cap({ capabilities: [CAP] });
    if (kind === 'coach-role') { await h.seed('rolePermissions', 'coach', { permissions: ['team.create'] }); return 'coach'; }
    if (kind === 'coach-grant') { await h.seed('userPermissionGrants', 'coach', { permissions: ['team.create'], enabled: true }); return 'coach'; }
    return kind;
  }
  const payload = (uid, extra = {}) => {
    const data = team({ creatorUid: uid, captainUid: uid, ownerUid: uid, ...DEFAULTS, ...extra });
    if (!('createdVia' in extra)) delete data.createdVia;
    return data;
  };

  test.each(HOLDERS)('%s with createdVia user_capability (self creator) is denied', async kind => {
    const uid = await holder(kind);
    await assertFails(h.create(payload(uid, { createdVia: 'user_capability' }), uid));
  });
  test.each(HOLDERS)('%s with createdVia user_capability and no creatorUid is denied', async kind => {
    const uid = await holder(kind);
    const data = payload(uid, { createdVia: 'user_capability' }); delete data.creatorUid;
    await assertFails(h.create(data, uid));
  });
  test.each(HOLDERS)('%s with creatorUid of another user is denied', async kind => {
    const uid = await holder(kind);
    await assertFails(h.create(payload(uid, { creatorUid: 'owner' }), uid));
  });
  test.each(HOLDERS)('%s filling a victim quota (marker + victim creatorUid) is denied', async kind => {
    const uid = await holder(kind);
    await assertFails(h.create(payload(uid, { createdVia: 'user_capability', creatorUid: 'owner', captainUid: 'owner', ownerUid: 'owner' }), uid));
  });
  test.each(HOLDERS.flatMap(kind => [123, null, ''].map(value => [kind, value])))('%s with non-auth creatorUid %j is denied', async (kind, value) => {
    const uid = await holder(kind);
    await assertFails(h.create(payload(uid, { creatorUid: value }), uid));
  });

  test.each(HOLDERS)('%s with self creatorUid and no marker is allowed', async kind => {
    const uid = await holder(kind);
    await assertSucceeds(h.create(payload(uid), uid));
  });
  test.each(HOLDERS)('%s without creatorUid and without marker is allowed', async kind => {
    const uid = await holder(kind);
    const data = payload(uid); delete data.creatorUid;
    await assertSucceeds(h.create(data, uid));
  });
  test.each(HOLDERS)('%s with a non-user_capability marker is allowed', async kind => {
    const uid = await holder(kind);
    await assertSucceeds(h.create(payload(uid, { createdVia: 'managed' }), uid));
  });

  test.each(['admin', 'super', 'manager'])('%s (canManageAnyTeam) is not restricted, marker and other creatorUid included', async uid => {
    await h.cap({ capabilities: [] });
    await assertSucceeds(h.create(team({ creatorUid: 'owner', captainUid: 'owner' }), uid));
    await assertSucceeds(h.create(team({ creatorUid: uid, captainUid: uid }), uid));
    await assertSucceeds(h.create({ id: 'legacy_marked_' + uid, name: 'Managed', createdVia: 'user_capability', creatorUid: 'other' }, uid));
  });
});

// F3 (advisor ruling): all non-canManageAnyTeam() creates need id == doc id, ^tm_[0-9]{13}_[a-z0-9]{1,8}$ and +-3 day freshness.
describe('T-090a F3 team.create holders need a fresh tm_ id', () => {
  const freshId = (offsetMs = 0, suffix = 'f3') => 'tm_' + (Date.now() + offsetMs) + '_' + suffix;
  const managed = (id, extra = {}) => ({ id, name: 'Managed', captainUid: 'other', pinned: true, members: 5, ...extra });
  // Role-based (rolePermissions) and per-user grant holders; none has team.manage_all.
  const HOLDERS = ['coach', 'captain', 'granted', 'coach-grant'];
  async function holder(kind) {
    await h.cap({ capabilities: [] });
    if (kind === 'coach-grant') {
      await h.seed('userPermissionGrants', 'coach', { permissions: ['team.create'], enabled: true });
      return 'coach';
    }
    if (kind !== 'granted') await h.seed('rolePermissions', kind, { permissions: ['team.create'] });
    return kind;
  }

  test.each(HOLDERS)('%s with a fresh matching tm_ id is allowed', async kind => {
    const uid = await holder(kind);
    const id = freshId();
    await assertSucceeds(h.create(managed(id), uid));
  });
  test.each(HOLDERS)('%s with id field different from document id is denied', async kind => {
    const uid = await holder(kind);
    await assertFails(h.create(managed(freshId(0, 'a')), uid, freshId(0, 'b')));
  });
  test.each(HOLDERS)('%s without id field is denied', async kind => {
    const uid = await holder(kind);
    const payload = managed('unused'); delete payload.id;
    await assertFails(h.create(payload, uid, freshId()));
  });
  test.each(HOLDERS.flatMap(kind => ['legacy_x', 'tm_old', 'team_TIME_a', 'tm_TIME', 'tm_TIME_ABC', 'tm_TIME_abcdefghi', 'tm_TIME0_a', 'tm_TIME_a_b'].map(t => [kind, t])))('%s with invalid format %s is denied', async (kind, template) => {
    const uid = await holder(kind);
    const id = template.replace('TIME', String(Date.now()));
    await assertFails(h.create(managed(id), uid));
  });
  test.each(HOLDERS.flatMap(kind => [-4, 4].map(days => [kind, days])))('%s with timestamp %i days from now is denied', async (kind, days) => {
    const uid = await holder(kind);
    await assertFails(h.create(managed(freshId(days * 86400000)), uid));
  });
  test.each(HOLDERS.flatMap(kind => [-2, 2].map(days => [kind, days])))('%s with timestamp %i days from now is allowed', async (kind, days) => {
    const uid = await holder(kind);
    await assertSucceeds(h.create(managed(freshId(days * 86400000)), uid));
  });

  test.each(['admin', 'super', 'manager'])('%s (canManageAnyTeam) keeps legacy, stale, mismatched and missing ids', async uid => {
    await h.cap({ capabilities: [] });
    await assertSucceeds(h.create(managed('legacy_' + uid), uid));
    await assertSucceeds(h.create(managed('tm_old'), uid));
    await assertSucceeds(h.create(managed(freshId(-30 * 86400000, 'old')), uid));
    await assertSucceeds(h.create(managed(freshId(0, 'x')), uid, 'legacy_mismatch_' + uid));
    const noId = managed('unused'); delete noId.id;
    await assertSucceeds(h.create(noId, uid, 'legacy_noid_' + uid));
  });
});
