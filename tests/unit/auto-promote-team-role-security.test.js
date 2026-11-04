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
    where: jest.fn((field, operator, value) => ({
      limit: jest.fn(limit => ({
        get: jest.fn(async () => {
          queries.push({ collection: 'teams', field, operator, value, limit });
          const docs = teams.filter(doc => matches(doc, field, operator, value)).slice(0, limit);
          return { docs, empty: docs.length === 0 };
        }),
      })),
    })),
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
// 讀取 production 的創建者身分／權限 helper；不把 users.permissions 當有效權限。
const { parse } = require('@babel/parser');
const { createFakeFirestore } = require('./team-callable-fake-db');
const indexPath = path.join(__dirname, '../../functions/index.js');
const indexSource = fs.readFileSync(indexPath, 'utf8');
const creatorReaderNames = new Set([
  'VALID_ROLES', 'DISABLED_PERMISSION_CODES', 'LEGACY_PERMISSION_CODE_REPLACEMENTS',
  'SECONDARY_IDENTITY_PERMISSION', 'ROLE_LEVELS', 'DEFAULT_ROLE_ENTRY_PERMISSION_RULES',
  'DEFAULT_ADMIN_PERMISSION_CODES', 'USER_PERMISSION_GRANT_ALLOWED_CODES',
  'normalizeRole', 'normalizeBuiltInRole', 'normalizePermissionCode',
  'sanitizePermissionCodeList', 'sanitizeUserPermissionGrantCodeList', 'getDefaultRolePermissions',
  'findUserDocByUidOrLineUserId', 'getRolePermissionsFromFirestore', 'getUserPermissionGrantsFromFirestore',
]);
const indexAst = parse(indexSource, { sourceType: 'script' });
const readerSource = indexAst.program.body.filter(node => (
  node.type === 'FunctionDeclaration' && creatorReaderNames.has(node.id.name)
) || (node.type === 'VariableDeclaration' && node.declarations.some(d => creatorReaderNames.has(d.id.name))))
  .map(node => indexSource.slice(node.start, node.end)).join('\n');
function loadCreatorReaders(db) {
  const context = vm.createContext({ db });
  vm.runInContext(readerSource + '\nthis.readers = { findUserDocByUidOrLineUserId, getRolePermissionsFromFirestore, getUserPermissionGrantsFromFirestore };', context);
  return context.readers;
}

function creatorReadDb(db, reads) {
  function wrap(ref, label) {
    return {
      doc: id => wrap(ref.doc(id), label + '/' + id),
      where: (...args) => wrap(ref.where(...args), label + '?' + args.join(':')),
      limit: n => wrap(ref.limit(n), label + ':limit=' + n),
      get: async () => { reads.push(label); return ref.get(); },
    };
  }
  return { collection: name => wrap(db.collection(name), name) };
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
  const creatorReads = [];
  const readers = loadCreatorReaders(creatorReadDb(fake.db, creatorReads));
  const setRoleClaimMerged = jest.fn(async () => null);
  const handler = createHandler(fake.db, {
    ...readers, setRoleClaimMerged,
    getCallerAccessContext: jest.fn(async () => access(callerRole, callerPermissions)),
  });
  const call = (overrides = {}) => handler({ auth: { uid: callerUid }, data: { targetUid, teamId: 'tm-real', ...overrides } });
  return { call, fake, creatorReads, setRoleClaimMerged, callerUid, targetUid };
}

describe('T-090b Q7 management-created teams', () => {
  test.each(['admin', 'super_admin'])('creator currently %s allows the captain to assign a coach with exactly one extra read', async role => {
    const { call, fake, creatorReads } = q7Setup({ creator: { role } });
    await expect(call()).resolves.toMatchObject({ oldRole: 'user', newRole: 'coach' });
    expect(fake.get('users/U-staff').role).toBe('coach');
    expect(creatorReads).toEqual(['users/U-creator']);
  });

  test.each([false, true])('ordinary creator blocks forged captain or known-member upgrade (knownMember=%s)', async knownMember => {
    const { call, fake, creatorReads, setRoleClaimMerged } = q7Setup({ creator: { role: 'user' }, knownMember,
      teamExtra: knownMember ? { captainUid: 'U-someone-else' } : {} });
    await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fake.state.writes).toHaveLength(0);
    expect(setRoleClaimMerged).not.toHaveBeenCalled();
    expect(creatorReads).toEqual(['users/U-creator', 'userPermissionGrants/U-creator']);
  });

  test('a general creator cannot promote themselves and stays user', async () => {
    const { call, fake, creatorReads } = q7Setup({ callerRole: 'user', creator: { role: 'user' }, teamExtra: { creatorUid: 'U-captain' } });
    await expect(call({ targetUid: 'U-captain' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fake.get('users/U-captain').role).toBe('user');
    expect(fake.state.writes).toHaveLength(0);
    expect(creatorReads).toHaveLength(0);
  });

  test('missing creatorUid remains legacy without extra reads', async () => {
    const { call, fake, creatorReads } = q7Setup();
    const team = fake.get('teams/tm-real');
    delete team.creatorUid;
    fake.remove('teams/tm-real');
    fake.touch('teams/tm-real', team);
    await expect(call()).resolves.toMatchObject({ newRole: 'coach' });
    expect(creatorReads).toHaveLength(0);
  });

  test.each([null, '', ' ', 123, 'bad/path'])('present but invalid creatorUid=%j is not legacy', async creatorUid => {
    const { call, fake, creatorReads } = q7Setup({ teamExtra: { creatorUid } });
    await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fake.state.writes).toHaveLength(0);
    expect(creatorReads).toHaveLength(0);
  });

  test('deleted creator is not treated as legacy', async () => {
    const { call, fake, creatorReads } = q7Setup({ creator: null });
    await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fake.state.writes).toHaveLength(0);
    expect(creatorReads).toHaveLength(3);
  });

  test('known-member route also works for a management-created team', async () => {
    const { call } = q7Setup({ knownMember: true, teamExtra: { captainUid: 'U-other' } });
    await expect(call()).resolves.toMatchObject({ newRole: 'coach' });
  });

  test.each(['role', 'grant'])('creator with active team.create from %s can authorize team-local promotion', async source => {
    const extraDocs = source === 'role'
      ? { 'rolePermissions/coach': { permissions: ['team.create'] } }
      : { 'userPermissionGrants/U-creator': { permissions: ['team.create'], enabled: true } };
    const { call, creatorReads } = q7Setup({ creator: { role: 'coach' }, extraDocs });
    await expect(call()).resolves.toMatchObject({ newRole: 'coach' });
    expect(creatorReads).toHaveLength(3);
  });

  test('user creator holding an individual team.create grant follows the explicit permission exception', async () => {
    const { call, creatorReads } = q7Setup({ creator: { role: 'user' }, extraDocs: {
      'userPermissionGrants/U-creator': { permissions: ['team.create'] },
    } });
    await expect(call()).resolves.toMatchObject({ newRole: 'coach' });
    expect(creatorReads).toHaveLength(2);
  });

  test.each([
    { 'userPermissionGrants/U-creator': { permissions: ['team.create'], enabled: false } },
    { 'rolePermissions/user': { permissions: ['team.create'] } },
  ])('inactive grant or user role permission cannot authorize creator', async extraDocs => {
    const { call, fake } = q7Setup({ creator: { role: 'user', permissions: ['team.create'] }, extraDocs });
    await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fake.state.writes).toHaveLength(0);
  });

  test('creator demoted from admin is evaluated using the current role', async () => {
    const { call, fake } = q7Setup();
    fake.touch('users/U-creator', { role: 'user' });
    await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fake.state.writes).toHaveLength(0);
  });

  test('legacy creator identity resolution plus role/grant checks costs at most five extra reads', async () => {
    const { call, creatorReads } = q7Setup({ creator: null, extraDocs: {
      'users/legacy-creator': { lineUserId: 'U-creator', role: 'coach' },
      'rolePermissions/coach': { permissions: ['team.create'] },
    } });
    await expect(call()).resolves.toMatchObject({ newRole: 'coach' });
    expect(creatorReads).toHaveLength(5);
  });

  test.each([
    ['super_admin', []], ['captain', ['team.manage_all']], ['captain', ['team.create']],
  ])('existing privileged path %s/%j bypasses creator checks', async (callerRole, callerPermissions) => {
    const { call, creatorReads } = q7Setup({ callerRole, callerPermissions, creator: { role: 'user' } });
    await expect(call()).resolves.toMatchObject({ newRole: 'coach' });
    expect(creatorReads).toHaveLength(0);
  });

  test('self-demotion in a user-created team is unchanged and reads no creator', async () => {
    const { call, fake, creatorReads } = q7Setup({ creator: { role: 'user' },
      teamExtra: { captainUid: 'U-other', coachUids: ['U-captain'] } });
    await expect(call({ targetUid: 'U-captain' })).resolves.toMatchObject({ oldRole: 'captain', newRole: 'coach' });
    expect(fake.get('users/U-captain').role).toBe('coach');
    expect(creatorReads).toHaveLength(0);
  });

  test('creator lookup failure fails closed before writing role or claims', async () => {
    const fake = createFakeFirestore({
      'users/U-captain': { uid: 'U-captain', role: 'captain' },
      'users/U-staff': { uid: 'U-staff', role: 'user' },
      'teams/tm-real': { creatorUid: 'U-creator', captainUid: 'U-captain', coachUids: ['U-staff'] },
    });
    const setRoleClaimMerged = jest.fn();
    const handler = createHandler(fake.db, {
      getCallerAccessContext: async () => access('captain', []),
      findUserDocByUidOrLineUserId: async () => { throw new Error('unavailable'); },
      setRoleClaimMerged,
    });
    await expect(handler({ auth: { uid: 'U-captain' }, data: { targetUid: 'U-staff', teamId: 'tm-real' } }))
      .rejects.toMatchObject({ code: 'internal' });
    expect(fake.state.writes).toHaveLength(0);
    expect(setRoleClaimMerged).not.toHaveBeenCalled();
  });

  test('production callable wiring passes the real creator readers', () => {
    const binding = indexAst.program.body.find(node => node.type === 'ExpressionStatement'
      && node.expression.type === 'AssignmentExpression'
      && indexSource.slice(node.expression.left.start, node.expression.left.end) === 'exports.autoPromoteTeamRole');
    const captured = jest.fn();
    vm.runInNewContext(indexSource.slice(binding.start, binding.end), {
      exports: {}, createAutoPromoteTeamRoleCallable: captured, onCall: () => {},
      HttpsError: FakeHttpsError, db: {}, FieldValue: {}, ROLE_LEVELS,
      normalizeRole: () => {}, getCallerAccessContext: () => {}, ensureAuthUser: () => {}, setRoleClaimMerged: () => {},
      ...loadCreatorReaders({}),
    });
    for (const name of ['findUserDocByUidOrLineUserId', 'getRolePermissionsFromFirestore', 'getUserPermissionGrantsFromFirestore']) {
      expect(captured.mock.calls[0][0][name]).toEqual(expect.any(Function));
    }
  });
});
