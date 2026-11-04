const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  createAutoPromoteTeamRoleHandler,
  getRoleDecision,
  resolveStrictUserIdentity,
} = require('../../functions/team-role-promotion');

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const ROLE_LEVELS = Object.freeze({
  user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5,
});

function fakeDoc(id, data) {
  let value = { ...data };
  return {
    id,
    exists: true,
    data: () => ({ ...value }),
    update: payload => { value = { ...value, ...payload }; },
  };
}

function matches(doc, field, operator, value) {
  const fieldValue = doc.data()?.[field];
  return operator === 'array-contains'
    ? Array.isArray(fieldValue) && fieldValue.includes(value)
    : fieldValue === value;
}

function createFakeDb({ users = [], teams = [] } = {}) {
  const updates = [];
  const queries = [];
  const userDocs = new Map(users.map(doc => [doc.id, doc]));
  const teamDocs = new Map(teams.map(doc => [doc.id, doc]));
  const usersCollection = {
    doc: jest.fn(id => ({
      get: jest.fn(async () => userDocs.get(id) || { id, exists: false, data: () => null }),
      update: jest.fn(async payload => {
        updates.push({ id, payload });
        userDocs.get(id)?.update(payload);
      }),
    })),
    where: jest.fn((field, operator, value) => ({
      limit: jest.fn(limit => ({
        get: jest.fn(async () => {
          queries.push({ collection: 'users', field, operator, value, limit });
          const docs = users.filter(doc => matches(doc, field, operator, value)).slice(0, limit);
          return { docs, empty: docs.length === 0 };
        }),
      })),
    })),
  };
  const teamsCollection = {
    doc: jest.fn(id => ({
      get: jest.fn(async () => teamDocs.get(id) || { id, exists: false, data: () => null }),
    })),
    where: jest.fn((field, operator, value) => {
      const limited = {
        limit: jest.fn(limit => ({
          get: jest.fn(async () => {
            queries.push({ collection: 'teams', field, operator, value, limit });
            const docs = teams.filter(doc => matches(doc, field, operator, value)).slice(0, limit);
            return { docs, empty: docs.length === 0 };
          }),
        })),
      };
      // T-090i：職位掃描明示 orderBy(documentId)；本 stub 資料量小、不分頁，排序直接略過。
      return { ...limited, orderBy: jest.fn(() => limited) };
    }),
  };
  return {
    db: { collection: jest.fn(name => (name === 'users' ? usersCollection : teamsCollection)) },
    queries,
    updates,
  };
}

function access(role = 'admin', permissions = ['team.create']) {
  return {
    role,
    isSuperAdmin: role === 'super_admin',
    hasPermission: code => permissions.includes(code),
  };
}

function createHandler(db, overrides = {}) {
  return createAutoPromoteTeamRoleHandler({
    db,
    HttpsError: FakeHttpsError,
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIME') },
    roleLevels: ROLE_LEVELS,
    normalizeRole: value => (typeof value === 'string' && value.trim() ? value.trim() : 'user'),
    getCallerAccessContext: jest.fn(async () => access()),
    ensureAuthUser: jest.fn(async () => null),
    setRoleClaimMerged: jest.fn(async () => null),
    logger: { info: jest.fn(), error: jest.fn() },
    ...overrides,
  });
}

function callerDoc(uid = 'U-caller', role = 'admin', extra = {}) {
  return fakeDoc(uid, { uid, role, manualRole: role, ...extra });
}

describe('autoPromoteTeamRole server authority', () => {
  test('ignores a client role claim and derives captain from saved team UID fields', async () => {
    const targetUid = 'U-target';
    const { db, queries, updates } = createFakeDb({
      users: [
        callerDoc(),
        fakeDoc(targetUid, { uid: targetUid, role: 'user', manualRole: 'user' }),
      ],
      teams: [fakeDoc('tm-real', { captainUid: targetUid })],
    });
    const ensureAuthUser = jest.fn(async () => null);
    const setRoleClaimMerged = jest.fn(async () => null);
    const handler = createHandler(db, { ensureAuthUser, setRoleClaimMerged });

    await expect(handler({
      auth: { uid: 'U-caller' },
      data: { targetUid, teamId: 'tm-real', newRole: 'super_admin' },
    })).resolves.toMatchObject({ oldRole: 'user', newRole: 'captain' });

    expect(updates).toEqual([{ id: targetUid, payload: { role: 'captain', updatedAt: 'SERVER_TIME' } }]);
    expect(setRoleClaimMerged).toHaveBeenCalledWith(targetUid, 'captain');
    expect(ensureAuthUser).toHaveBeenCalledWith(targetUid);
    expect(queries.filter(query => query.collection === 'teams').map(query => [query.field, query.operator]))
      .toEqual(expect.arrayContaining([
        ['captainUid', '=='], ['coachUids', 'array-contains'],
        ['leaderUid', '=='], ['leaderUids', 'array-contains'],
      ]));
  });

  test('uses a supported manual role as the floor when no team role remains', async () => {
    const targetUid = 'U-manual';
    const { db, updates } = createFakeDb({
      users: [callerDoc(), fakeDoc(targetUid, { uid: targetUid, role: 'captain', manualRole: 'coach' })],
    });
    const handler = createHandler(db);
    await expect(handler({ auth: { uid: 'U-caller' }, data: { targetUid } }))
      .resolves.toMatchObject({ oldRole: 'captain', newRole: 'coach' });
    expect(updates[0].payload.role).toBe('coach');
  });

  test.each([
    [{ role: 'venue_owner', manualRole: 'user' }, 'role_too_high'],
    [{ role: 'captain', manualRole: 'admin' }, 'manual_role_protected'],
    [{ role: 'custom_role', manualRole: 'user' }, 'unmanaged_current_role'],
  ])('never overwrites protected higher or unmanaged roles', (targetData, reason) => {
    expect(getRoleDecision({
      targetData,
      savedTeamRole: 'user',
      roleLevels: ROLE_LEVELS,
      normalizeRole: value => value || 'user',
    })).toMatchObject({ skipped: true, reason });
  });

  test('rejects callers below coach before resolving a target', async () => {
    const { db, updates } = createFakeDb();
    const handler = createHandler(db, {
      getCallerAccessContext: jest.fn(async () => access('user', [])),
    });
    await expect(handler({ auth: { uid: 'U-caller' }, data: { targetUid: 'U-target' } }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(updates).toEqual([]);
  });

  test('blocks a coach from using a forged team document to promote themselves', async () => {
    const uid = 'U-coach';
    const { db, updates } = createFakeDb({
      users: [callerDoc(uid, 'coach')],
      teams: [fakeDoc('tm-forged', { captainUid: uid })],
    });
    const handler = createHandler(db, {
      getCallerAccessContext: jest.fn(async () => access('coach', [])),
    });
    await expect(handler({ auth: { uid }, data: { targetUid: uid, teamId: 'tm-forged' } }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(updates).toEqual([]);
  });

  test('allows a real captain to sync a saved staff assignment in their own team', async () => {
    const callerUid = 'U-captain';
    const targetUid = 'U-staff';
    const { db, updates } = createFakeDb({
      users: [
        callerDoc(callerUid, 'captain'),
        fakeDoc(targetUid, { uid: targetUid, role: 'user', manualRole: 'user' }),
      ],
      teams: [fakeDoc('tm-real', { captainUid: callerUid, coachUids: [targetUid] })],
    });
    const handler = createHandler(db, {
      getCallerAccessContext: jest.fn(async () => access('captain', [])),
    });
    await expect(handler({ auth: { uid: callerUid }, data: { targetUid, teamId: 'tm-real' } }))
      .resolves.toMatchObject({ oldRole: 'user', newRole: 'coach' });
    expect(updates[0].payload.role).toBe('coach');
  });

  test('an unrelated forged captain assignment cannot override the authorized context team role', async () => {
    const targetUid = 'U-target';
    const { db, updates } = createFakeDb({
      users: [callerDoc(), fakeDoc(targetUid, { uid: targetUid, role: 'user', manualRole: 'user' })],
      teams: [
        fakeDoc('tm-forged', { captainUid: targetUid }),
        fakeDoc('tm-real', { coachUids: [targetUid] }),
      ],
    });
    const handler = createHandler(db);
    await expect(handler({ auth: { uid: 'U-caller' }, data: { targetUid, teamId: 'tm-real' } }))
      .resolves.toMatchObject({ oldRole: 'user', newRole: 'coach' });
    expect(updates[0].payload.role).toBe('coach');
  });

  test('a retry reconciles Auth claims after Firestore succeeded but claim sync failed', async () => {
    const targetUid = 'U-target';
    const { db, updates } = createFakeDb({
      users: [callerDoc(), fakeDoc(targetUid, { uid: targetUid, role: 'user', manualRole: 'user' })],
      teams: [fakeDoc('tm-real', { captainUid: targetUid })],
    });
    const setRoleClaimMerged = jest.fn()
      .mockRejectedValueOnce(new Error('claim write failed'))
      .mockResolvedValueOnce(null);
    const handler = createHandler(db, { setRoleClaimMerged });
    const request = { auth: { uid: 'U-caller' }, data: { targetUid, teamId: 'tm-real' } };

    await expect(handler(request)).rejects.toMatchObject({ code: 'internal' });
    await expect(handler(request)).resolves.toMatchObject({
      skipped: true, reason: 'no_change', claimReconciled: true,
    });
    expect(updates).toHaveLength(1);
    expect(setRoleClaimMerged).toHaveBeenCalledTimes(2);
  });
});

describe('strict target identity resolution', () => {
  test('fails closed when canonical uid fields disagree', async () => {
    const uid = 'U-mismatch';
    const { db } = createFakeDb({ users: [fakeDoc(uid, { uid, lineUserId: 'U-other', role: 'user' })] });
    await expect(resolveStrictUserIdentity({ db, targetUid: uid, HttpsError: FakeHttpsError }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  test('fails closed when any exact alias is restricted', async () => {
    const uid = 'U-restricted';
    const { db } = createFakeDb({
      users: [fakeDoc(uid, { uid, role: 'user' }), fakeDoc('legacy', { lineUserId: uid, role: 'user', isRestricted: true })],
    });
    await expect(resolveStrictUserIdentity({ db, targetUid: uid, HttpsError: FakeHttpsError }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  test('fails closed for multiple legacy documents without one canonical document', async () => {
    const uid = 'U-ambiguous';
    const { db } = createFakeDb({
      users: [fakeDoc('legacy-a', { uid, role: 'user' }), fakeDoc('legacy-b', { lineUserId: uid, role: 'user' })],
    });
    await expect(resolveStrictUserIdentity({ db, targetUid: uid, HttpsError: FakeHttpsError }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  test('accepts one exact legacy identity and returns its canonical auth UID', async () => {
    const uid = 'U-legacy';
    const { db } = createFakeDb({ users: [fakeDoc('legacy-doc', { lineUserId: uid, role: 'user' })] });
    await expect(resolveStrictUserIdentity({ db, targetUid: uid, HttpsError: FakeHttpsError }))
      .resolves.toMatchObject({ uid, docId: 'legacy-doc' });
  });
});

describe('frontend team role recomputation', () => {
  test('uses canonical UIDs and the saved team context without adminUsers', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../js/modules/team/team-form-roles.js'), 'utf8');
    const promoteUserByUid = jest.fn(async () => ({ success: true }));
    const App = {};
    const context = {
      App,
      ApiService: {
        getUserDirectory: () => [], getAdminUsers: () => [], promoteUserByUid,
        _writeOpLog: jest.fn(),
      },
      ROLE_LEVEL_MAP: ROLE_LEVELS,
      ROLES: { user: { label: 'User' }, coach: { label: 'Coach' }, captain: { label: 'Captain' } },
      console,
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    Object.assign(App, { _sendNotifFromTemplate: jest.fn(), _deliverMessageWithLinePush: jest.fn() });

    await expect(App._applyTeamRoleChangesAfterSave({
      editId: 'tm-team', teamId: 'tm-team', oldCaptainUid: 'U-old-captain',
      oldCoachUids: ['U-old-coach'], oldLeaderUids: ['U-old-leader'],
      realLeaderUids: ['U-new-leader'], newCoachUids: ['U-new-coach'],
      captainUid: 'U-new-captain', coachUids: ['U-new-coach'],
    }, 'Test Team')).resolves.toMatchObject({ ok: true });

    expect(new Set(promoteUserByUid.mock.calls.map(call => call[0]))).toEqual(new Set([
      'U-new-captain', 'U-new-leader', 'U-new-coach',
      'U-old-captain', 'U-old-coach', 'U-old-leader',
    ]));
    promoteUserByUid.mock.calls.forEach(call => expect(call[1]).toEqual({ teamId: 'tm-team' }));
  });

  test('ApiService sends UID plus team context and retries only transient claim-sync failures', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../js/api-service.js'), 'utf8');
    const start = source.indexOf('async promoteUserByUid(uid,');
    const method = source.slice(start, source.indexOf('\n  promoteUser(name', start));
    expect(method).toContain('FirebaseService.updateUserRole(safeUid, { teamId: safeTeamId })');
    expect(method).toContain('attempt < 2');
    expect(method).not.toContain("_src('adminUsers')");
  });

  test('callable wrapper sends no client role and custom-role deletion stays privileged', () => {
    const crudSource = fs.readFileSync(path.join(__dirname, '../../js/firebase-crud.js'), 'utf8');
    const start = crudSource.indexOf('async updateUserRole(uid,');
    const autoRoleMethod = crudSource.slice(start, crudSource.indexOf('\n  //', start));
    expect(autoRoleMethod).toContain('const payload = { targetUid: uid };');
    expect(autoRoleMethod).toContain('payload.teamId = safeTeamId');
    expect(autoRoleMethod).not.toContain('payload.newRole');
    expect(autoRoleMethod).not.toContain('newRole:');

    const adminRoleSource = fs.readFileSync(path.join(__dirname, '../../js/modules/user-admin/user-admin-roles.js'), 'utf8');
    expect(adminRoleSource).toContain(
      "FirebaseService.manageAdminUser(u._docId, { role: 'user', manualRole: 'user' })",
    );
  });

  test('team save awaits role synchronization before showing the final result', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../js/modules/team/team-form.js'), 'utf8');
    expect(source).toContain(
      'const roleSyncResult = await this._applyTeamRoleChangesAfterSave(roleChangeContext, name);',
    );
    expect(source).toContain('teamId: nextTeamId');
  });
});
// 測試同步更新：§6.3 以 createdVia 取代創建者資格，Q7 不再增加讀取。
const { parse } = require('@babel/parser');
const { createFakeFirestore } = require('./team-callable-fake-db');
const { isUserCreatedTeam } = require('../../functions/team-membership-core');
const indexSource = fs.readFileSync(path.join(__dirname, '../../functions/index.js'), 'utf8');

function trackReads(db, reads) {
  function wrap(ref, label) {
    return new Proxy(ref, {
      get(target, key) {
        if (key === 'get') return async () => { reads.push(label); return target.get(); };
        // T-090i：職位掃描加了 orderBy／startAfter，一併包裝才不會漏計 get。
        if (['doc', 'where', 'limit', 'orderBy', 'startAfter'].includes(key)) {
          return (...args) => wrap(target[key](...args), label + '/' + key + ':' + args.join(':'));
        }
        return target[key];
      },
    });
  }
  return { ...db, collection: name => wrap(db.collection(name), name) };
}

function q7Setup({ creator = { role: 'admin' }, teamExtra = {}, callerRole = 'captain', callerPermissions = [], extraDocs = {}, knownMember = false } = {}) {
  const callerUid = 'U-captain';
  const targetUid = 'U-staff';
  const creatorUid = 'U-creator';
  const fake = createFakeFirestore({
    ['users/' + callerUid]: { uid: callerUid, role: callerRole, ...(knownMember ? { teamIds: ['tm-real'] } : {}) },
    ['users/' + targetUid]: { uid: targetUid, role: 'user', manualRole: 'user' },
    ...(creator ? { ['users/' + creatorUid]: { uid: creatorUid, ...creator } } : {}),
    'teams/tm-real': { creatorUid, captainUid: callerUid, coachUids: [targetUid], ...teamExtra },
    ...extraDocs,
  });
  const reads = [];
  const obsoleteReaders = Object.fromEntries([
    'findUserDocByUidOrLineUserId', 'getRolePermissionsFromFirestore', 'getUserPermissionGrantsFromFirestore',
  ].map(name => [name, jest.fn(() => { throw new Error('Unexpected creator read: ' + name); })]));
  const setRoleClaimMerged = jest.fn(async () => null);
  const handler = createHandler(trackReads(fake.db, reads), {
    ...obsoleteReaders, setRoleClaimMerged,
    getCallerAccessContext: jest.fn(async () => access(callerRole, callerPermissions)),
  });
  const call = (overrides = {}) => handler({ auth: { uid: callerUid }, data: { targetUid, teamId: 'tm-real', ...overrides } });
  return { call, fake, reads, obsoleteReaders, setRoleClaimMerged, callerUid, targetUid };
}

function expectNoQ7Reads(context, self = false) {
  // 既有 identity 3 次 × 1/2 人 + context team 1 次 + 已存職位 4 次；不含注入的 caller access。
  expect(context.reads).toHaveLength(self ? 8 : 11);
  expect(context.reads.filter(label => label.startsWith('users/'))).toHaveLength(self ? 3 : 6);
  expect(context.reads.filter(label => label.startsWith('teams/'))).toHaveLength(5);
  expect(context.reads.some(label => /U-creator|rolePermissions|userPermissionGrants/.test(label))).toBe(false);
  Object.values(context.obsoleteReaders).forEach(reader => expect(reader).not.toHaveBeenCalled());
}

describe('T-090b Q7 createdVia definition', () => {
  test.each([
    [undefined, false], [null, false], [{}, false],
    [{ createdVia: 'user_capability' }, true],
    ...[null, '', 'admin', ' user_capability', 'user_capability ', 'USER_CAPABILITY', 123, ['user_capability']]
      .map(createdVia => [{ createdVia }, false]),
  ])('shared helper uses the exact marker: %j', (team, expected) => {
    expect(isUserCreatedTeam(team)).toBe(expected);
  });

  // T-090i：自建俱樂部的職員欄位不再算已存職位，被掛名者的已存職位為 user → 不升級（no_change、無寫入），
  // 取代原本「算進已存職位後再由 contextRole 守衛 permission-denied」；安全性質（不升級、不寫 role）不變。
  function expectNoPromotion(ctx, result, role = 'user') {
    expect(result).toMatchObject({ skipped: true, reason: 'no_change', currentRole: role });
    expect(ctx.fake.state.writes).toHaveLength(0);
    expect(ctx.fake.get('users/U-staff').role).toBe(role);
    // no_change 只會把 claim 對齊成原本角色，不得出現其他角色。
    ctx.setRoleClaimMerged.mock.calls.forEach(([, claimRole]) => expect(claimRole).toBe(role));
  }

  test.each(['user', 'coach', 'admin', 'super_admin', null])(
    'user-created blocks team-local promotion regardless of creator role %s or deletion', async role => {
      const ctx = q7Setup({ creator: role ? { role } : null, teamExtra: { createdVia: 'user_capability' } });
      expectNoPromotion(ctx, await ctx.call());
      expectNoQ7Reads(ctx);
    },
  );

  test.each([false, true])('user-created blocks captain and known-member routes (knownMember=%s)', async knownMember => {
    const ctx = q7Setup({ knownMember, teamExtra: {
      createdVia: 'user_capability', ...(knownMember ? { captainUid: 'U-other' } : {}),
    } });
    expectNoPromotion(ctx, await ctx.call());
    expectNoQ7Reads(ctx);
  });

  test.each(['role', 'grant'])('creator team.create from %s never overrides the user-created marker', async source => {
    const extraDocs = source === 'role'
      ? { 'rolePermissions/coach': { permissions: ['team.create'] } }
      : { 'userPermissionGrants/U-creator': { permissions: ['team.create'], enabled: true } };
    const ctx = q7Setup({ creator: { role: 'coach' }, extraDocs, teamExtra: { createdVia: 'user_capability' } });
    expectNoPromotion(ctx, await ctx.call());
    expectNoQ7Reads(ctx);
  });

  test('blocked contextRole cannot turn coach-to-captain promotion into demotion or claim sync', async () => {
    // T-090i：U-staff 另有 legacy 隊教練職位時，自建隊的 captainUid 掛名不升 captain、也不降級。
    const ctx = q7Setup({ teamExtra: { createdVia: 'user_capability', captainUid: 'U-staff' }, knownMember: true,
      extraDocs: {
        'users/U-staff': { uid: 'U-staff', role: 'coach', manualRole: 'user' },
        'teams/tm-legacy': { coachUids: ['U-staff'] },
      } });
    expectNoPromotion(ctx, await ctx.call(), 'coach');
    expectNoQ7Reads(ctx);
  });

  test('T-090i: coach backed only by a user-created assignment is recalculated down to user', async () => {
    const ctx = q7Setup({ teamExtra: { createdVia: 'user_capability', captainUid: 'U-staff' }, knownMember: true,
      extraDocs: { 'users/U-staff': { uid: 'U-staff', role: 'coach', manualRole: 'user' } } });
    await expect(ctx.call()).resolves.toMatchObject({ oldRole: 'coach', newRole: 'user' });
    expect(ctx.fake.get('users/U-staff').role).toBe('user');
    expectNoQ7Reads(ctx);
  });

  // T-090i（Grok 交叉審查 P2）：管理權限呼叫者傳自建隊 teamId，不得用該隊 captainUid 把 legacy 教練抬成全域 captain。
  describe.each([
    ['super_admin', []], ['captain', ['team.manage_all']], ['captain', ['team.create']],
  ])('privileged %s/%j with a user-created teamId', (callerRole, callerPermissions) => {
    const setup = (staffRole) => q7Setup({ callerRole, callerPermissions,
      teamExtra: { createdVia: 'user_capability', captainUid: 'U-staff' },
      extraDocs: {
        'users/U-staff': { uid: 'U-staff', role: staffRole, manualRole: 'user' },
        'teams/tm-legacy': { coachUids: ['U-staff'] },
      } });

    test('legacy coach stays coach (no_change, no write)', async () => {
      const ctx = setup('coach');
      expectNoPromotion(ctx, await ctx.call(), 'coach');
      expectNoQ7Reads(ctx);
    });

    test('user is capped at the scanned coach role, never captain', async () => {
      const ctx = setup('user');
      await expect(ctx.call()).resolves.toMatchObject({ oldRole: 'user', newRole: 'coach' });
      expect(ctx.fake.get('users/U-staff').role).toBe('coach');
      expect(ctx.setRoleClaimMerged).not.toHaveBeenCalledWith('U-staff', 'captain');
    });

    test('legacy teamId keeps the original captain promotion', async () => {
      const ctx = q7Setup({ callerRole, callerPermissions,
        extraDocs: {
          'users/U-staff': { uid: 'U-staff', role: 'coach', manualRole: 'user' },
          'teams/tm-legacy': { captainUid: 'U-staff' },
        } });
      await expect(ctx.call({ teamId: 'tm-legacy' })).resolves.toMatchObject({ oldRole: 'coach', newRole: 'captain' });
      expect(ctx.fake.get('users/U-staff').role).toBe('captain');
    });
  });

  test('T-090i: many user-created assignments cannot hide a legacy assignment (paged scan)', async () => {
    const forged = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [
      'teams/tm-a' + String(i).padStart(2, '0'), { createdVia: 'user_capability', coachUids: ['U-staff'] },
    ]));
    const ctx = q7Setup({ teamExtra: { createdVia: 'user_capability' },
      extraDocs: { ...forged, 'teams/tm-z-legacy': { captainUid: 'U-captain', coachUids: ['U-staff'] } } });
    await expect(ctx.call({ teamId: 'tm-z-legacy' })).resolves.toMatchObject({ newRole: 'coach' });
    expect(ctx.fake.get('users/U-staff').role).toBe('coach');
  });

  test('user-created manual-role floor cannot bypass the promotion guard', async () => {
    const ctx = q7Setup({ teamExtra: { createdVia: 'user_capability' },
      extraDocs: { 'users/U-staff': { uid: 'U-staff', role: 'user', manualRole: 'coach' } } });
    await expect(ctx.call()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(ctx.fake.state.writes).toHaveLength(0);
    expectNoQ7Reads(ctx);
  });

  test('general user still fails the coach entry gate before any Q7 reads', async () => {
    const ctx = q7Setup({ callerRole: 'user', teamExtra: { createdVia: 'user_capability', creatorUid: 'U-captain' } });
    await expect(ctx.call({ targetUid: 'U-captain' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(ctx.reads).toHaveLength(0);
    expect(ctx.fake.state.writes).toHaveLength(0);
  });

  test.each(['user', 'coach', 'admin', 'super_admin', null])(
    'legacy without createdVia stays management-created regardless of creator role %s or deletion', async role => {
      const ctx = q7Setup({ creator: role ? { role } : null });
      await expect(ctx.call()).resolves.toMatchObject({ newRole: 'coach' });
      expect(ctx.fake.state.writes).toHaveLength(1);
      expectNoQ7Reads(ctx);
    },
  );

  test.each([undefined, null, '', ' ', 123, 'bad/path'])('legacy creatorUid=%j does not affect classification', async creatorUid => {
    const ctx = q7Setup({ teamExtra: { creatorUid } });
    await expect(ctx.call()).resolves.toMatchObject({ newRole: 'coach' });
    expectNoQ7Reads(ctx);
  });

  test.each([{}, { createdVia: 'admin' }])('known-member route remains available for management-created %j', async teamExtra => {
    const ctx = q7Setup({ knownMember: true, teamExtra: { ...teamExtra, captainUid: 'U-other' } });
    await expect(ctx.call()).resolves.toMatchObject({ newRole: 'coach' });
    expectNoQ7Reads(ctx);
  });

  test.each([
    ['super_admin', []], ['captain', ['team.manage_all']], ['captain', ['team.create']],
  ])('privileged %s/%j no longer auto-promotes from a user-created assignment (T-090i)', async (callerRole, callerPermissions) => {
    // T-090i：取代原「管理權限可在自建隊內自動升級」；自建隊不算已存職位，管理端要升級改用手動角色（manualRole）。
    const ctx = q7Setup({ callerRole, callerPermissions, teamExtra: { createdVia: 'user_capability' } });
    expectNoPromotion(ctx, await ctx.call());
    expectNoQ7Reads(ctx);
  });

  test.each([
    [{}, 'coach'],
    // T-090i：自建隊的教練掛名不算已存職位，自降結果為 user（原為 coach）。
    [{ createdVia: 'user_capability' }, 'user'],
  ])('self-demotion for %j recalculates to %s', async (teamExtra, expectedRole) => {
    const ctx = q7Setup({ teamExtra: { ...teamExtra, captainUid: 'U-other', coachUids: ['U-captain'] } });
    await expect(ctx.call({ targetUid: 'U-captain' })).resolves.toMatchObject({ oldRole: 'captain', newRole: expectedRole });
    expect(ctx.fake.state.writes).toHaveLength(1);
    expectNoQ7Reads(ctx, true);
  });

  test('a forged user-created assignment cannot increase the management-created context role', async () => {
    const ctx = q7Setup({ extraDocs: { 'teams/tm-forged': { createdVia: 'user_capability', captainUid: 'U-staff' } } });
    await expect(ctx.call()).resolves.toMatchObject({ newRole: 'coach' });
    expectNoQ7Reads(ctx);
  });

  test.each([false, true])('context recalculation preserves self-demotion or no_change despite another captain assignment (coach=%s)', async remainsCoach => {
    const ctx = q7Setup({ callerRole: 'coach', teamExtra: {
      createdVia: 'user_capability', captainUid: 'U-other', coachUids: remainsCoach ? ['U-captain'] : [],
    }, extraDocs: { 'teams/tm-other': { captainUid: 'U-captain' } } });
    if (remainsCoach) {
      await expect(ctx.call({ targetUid: 'U-captain' })).resolves.toMatchObject({ skipped: true, reason: 'no_change' });
      expect(ctx.fake.state.writes).toHaveLength(0);
    } else {
      await expect(ctx.call({ targetUid: 'U-captain' })).resolves.toMatchObject({ oldRole: 'coach', newRole: 'user' });
      expect(ctx.fake.state.writes).toHaveLength(1);
    }
    expect(ctx.setRoleClaimMerged).toHaveBeenCalledWith('U-captain', remainsCoach ? 'coach' : 'user');
    expectNoQ7Reads(ctx, true);
  });

  test('production callable wiring no longer injects creator readers', () => {
    const ast = parse(indexSource, { sourceType: 'script' });
    const binding = ast.program.body.find(node => node.type === 'ExpressionStatement'
      && node.expression.type === 'AssignmentExpression'
      && indexSource.slice(node.expression.left.start, node.expression.left.end) === 'exports.autoPromoteTeamRole');
    const captured = jest.fn();
    vm.runInNewContext(indexSource.slice(binding.start, binding.end), {
      exports: {}, createAutoPromoteTeamRoleCallable: captured, onCall: () => {},
      HttpsError: FakeHttpsError, db: {}, FieldValue: {}, ROLE_LEVELS,
      normalizeRole: () => {}, getCallerAccessContext: () => {}, ensureAuthUser: () => {}, setRoleClaimMerged: () => {},
    });
    for (const name of ['findUserDocByUidOrLineUserId', 'getRolePermissionsFromFirestore', 'getUserPermissionGrantsFromFirestore']) {
      expect(captured.mock.calls[0][0]).not.toHaveProperty(name);
    }
  });
});
