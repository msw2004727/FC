/** T-090a M2: user-created scoped edits are guarded; legacy owner behavior is retained. */
const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, updateDoc, setDoc, getDoc, deleteDoc, increment, deleteField, serverTimestamp } = require('firebase/firestore');
const { DEFAULTS, team, profile, harness } = require('./t090a-fixtures');
jest.setTimeout(30000);
const h = harness('update');
const ID = 'tm_scoped';
const write = (patch, uid = 'owner') => updateDoc(doc(h.db(uid), 'teams', ID), patch);
beforeEach(async () => {
  await h.seed('teams', ID, team({ ...DEFAULTS, id: ID, ownerUid: 'owner', coachUids: ['coach'], leaderUids: ['captain'] }));
  await h.seed('users', 'member', profile('member', { teamId: ID, teamIds: [ID] }));
});

describe('T-090a update privilege and identity boundaries', () => {
  test('owner can edit basic fields', async () => { await assertSucceeds(write({ name: 'Edited', bio: 'Edited', updatedAt: serverTimestamp() })); });
  test('outsider cannot edit even by forging ownership', async () => { await assertFails(write({ name: 'Hijacked', creatorUid: 'other', captainUid: 'other' }, 'other')); });
  test.each(['id', 'creatorUid', 'ownerUid', 'createdVia', 'captainUid'])('%s cannot change or disappear on user-created teams', async key => {
    await assertFails(write({ [key]: 'forged' }));
    await assertFails(write({ [key]: deleteField() }));
  });
  test.each(['id', 'creatorUid', 'ownerUid', 'createdVia'])('legacy %s cannot be changed/added/deleted', async key => {
    await h.seed('teams', ID, { id: ID, name: 'Legacy', captainUid: 'owner', creatorUid: 'owner', ownerUid: 'owner' });
    await assertFails(write({ [key]: key === 'createdVia' ? 'user_capability' : 'other' }));
    if (key !== 'createdVia') await assertFails(write({ [key]: deleteField() }));
    await h.seed('teams', ID, { name: 'Legacy missing keys', captainUid: 'owner' });
    await assertFails(write({ [key]: key === 'createdVia' ? 'user_capability' : 'owner' }));
  });
  test('user-created captain lock depends on marker, not current creator role', async () => {
    await h.seed('users', 'owner', profile('owner', { role: 'coach' }));
    await assertFails(write({ captainUid: 'other' }));
  });
  test('legacy captain transfer remains allowed', async () => {
    await h.seed('teams', ID, { id: ID, name: 'Legacy', captainUid: 'owner' });
    await assertSucceeds(write({ captainUid: 'other' }));
    await assertFails(write({ name: 'Old captain lost access' }));
    await assertSucceeds(write({ name: 'New captain' }, 'other'));
  });
  test('rewriting identical protected values with a basic edit is allowed', async () => { await assertSucceeds(write({ ...DEFAULTS, id: ID, createdVia: 'user_capability', captainUid: 'owner', creatorUid: 'owner', ownerUid: 'owner', name: 'New' })); });
  test('setDoc replacement cannot omit provenance', async () => { await assertFails(setDoc(doc(h.db(), 'teams', ID), { id: ID, name: 'Replacement', captainUid: 'owner' })); });
  test.each(['admin', 'super', 'manager'])('%s retains global management override', async uid => {
    await assertSucceeds(write({ id: 'legacy_new', creatorUid: 'other', ownerUid: 'other', createdVia: 'managed', captainUid: 'other', pinned: true, viewCount: 9, members: 9 }, uid));
  });
  test('team.create alone grants no global update override', async () => {
    await h.seed('teams', ID, team({ id: ID, captainUid: 'granted', creatorUid: 'granted' }));
    await assertFails(write({ pinned: true }, 'granted'));
    await assertSucceeds(write({ name: 'Own edit' }, 'granted'));
  });
});

describe('T-090a protected update fields and count-only branch', () => {
  test.each(Object.entries(DEFAULTS).filter(([key]) => key !== 'members'))('%s cannot be changed, deleted or added by an owner', async (key, value) => {
    const bad = typeof value === 'boolean' ? !value : typeof value === 'number' ? 9 : typeof value === 'string' ? '#000000' : ['forged'];
    await assertFails(write({ [key]: bad }));
    await assertFails(write({ [key]: deleteField() }));
    await h.seed('teams', ID, team({ id: ID }));
    await assertFails(write({ [key]: value }));
  });
  test.each(['owner', 'coach', 'captain', 'member'])('%s retains members-only count update', async uid => { await assertSucceeds(write({ members: 2, updatedAt: serverTimestamp() }, uid)); });
  test.each(['owner', 'coach', 'captain', 'member', 'other'])('%s cannot mix count and other fields', async uid => { await assertFails(write({ members: 2, feed: [] }, uid)); });
  test('outsider cannot update members alone', async () => { await assertFails(write({ members: 2 }, 'other')); });
  test('staff may edit existing staff-only fields without members', async () => { await assertSucceeds(write({ coaches: ['Coach label'], memberActivityData: {}, updatedAt: serverTimestamp() }, 'coach')); });
  test('staff cannot escape whitelist with basic data or identity', async () => { await assertFails(write({ name: 'Forged' }, 'coach')); await assertFails(write({ id: 'other' }, 'captain')); });
  test('owner cannot mix a viewCount increment with an otherwise allowed basic edit', async () => { await assertFails(write({ viewCount: 1, name: 'Edited' })); });
});

// The pre-T-090a path compares affectedKeys, not every key in the wire payload.
// Test real value changes for every denied mixed write; keep the root legacy tests intact.
// Test synchronization: the legacy/managed owner bypass is restored by the current ruling.
describe.each(['legacy', 'managed', 'user_capability'])('viewCount-only contract: %s team', marker => {
  beforeEach(async () => {
    const data = { id: ID, name: 'Club', captainUid: 'owner', creatorUid: 'owner', coachUids: ['coach'], leaderUids: ['captain'], members: 2, viewCount: 3 };
    if (marker !== 'legacy') data.createdVia = marker;
    await h.seed('teams', ID, data);
  });

  test.each(['owner', 'coach', 'captain', 'member', 'other'])('%s can increment exactly one with a literal or A frontend transform', async uid => {
    await assertSucceeds(write({ viewCount: 4 }, uid));
    await assertSucceeds(write({ viewCount: increment(1) }, uid));
    expect((await getDoc(doc(h.db(uid), 'teams', ID))).data().viewCount).toBe(5);
  });

  test.each(marker === 'user_capability' ? ['owner', 'coach', 'captain', 'member', 'other'] : ['coach', 'captain', 'member', 'other'])('%s cannot jump, decrement, delete or replace viewCount with a non-number', async uid => {
    for (const value of [9, 2, deleteField(), '4', null, increment(2), increment(-1)]) {
      await assertFails(write({ viewCount: value }, uid));
    }
  });

  test.each(marker === 'user_capability' ? ['owner', 'coach', 'captain', 'member', 'other'] : ['coach', 'captain', 'member', 'other'])('%s cannot mix +1 with any other changed field', async uid => {
    for (const extra of [
      { name: 'Edited' }, { feed: [] }, { members: 3 }, { updatedAt: serverTimestamp() },
      { captainUid: 'other' }, { createdVia: marker === 'managed' ? 'user_capability' : 'managed' }, { teamExp: 1 },
    ]) {
      await assertFails(write({ viewCount: increment(1), ...extra }, uid));
    }
    await assertFails(setDoc(doc(h.db(uid), 'teams', ID), { viewCount: 4, bio: 'Edited' }, { merge: true }));
  });

  test('missing viewCount retains the existing zero-to-one behavior', async () => {
    const data = { id: ID, name: 'No count', captainUid: 'owner' };
    if (marker !== 'legacy') data.createdVia = marker;
    await h.seed('teams', ID, data);
    await assertSucceeds(write({ viewCount: increment(1) }, 'other'));
    expect((await getDoc(doc(h.db(), 'teams', ID))).data().viewCount).toBe(1);
  });

  test('signed-in visitor needs neither membership nor a users document', async () => {
    await assertSucceeds(write({ viewCount: increment(1) }, 'unprofiled_visitor'));
  });

  test('guest still cannot increment', async () => {
    await assertFails(updateDoc(doc(h.guest(), 'teams', ID), { viewCount: increment(1) }));
  });

  test('unchanged extra values preserve affectedKeys semantics', async () => {
    await assertSucceeds(write({ viewCount: 4, name: 'Club' }, 'other'));
  });

  test('A role/count mix is allowed only for legacy/managed owners; unchanged count works for both', async () => {
    // _buildTeamRoleLevelUpdates returns these eight fields; its caller adds members.
    const roles = { leaderUids: ['captain'], leaders: ['Leader'], leaderNames: ['Leader'], leaderUid: 'captain', leader: 'Leader', coachUids: ['coach', 'member'], coaches: ['Coach', 'Member'], coachNames: ['Coach', 'Member'], updatedAt: serverTimestamp() };
    await (marker === 'user_capability' ? assertFails : assertSucceeds)(write({ ...roles, members: 3 }));
    await assertSucceeds(write({ ...roles, members: marker === 'user_capability' ? 2 : 3 }));
    await assertSucceeds(write({ ...roles, members: 3 }, 'manager'));
  });

  test('A staff/count removal is allowed for legacy/managed owners and every global manager', async () => {
    // js/modules/team/team-detail.js: _removeTeamStaffRosterRow + _buildTeamStaffRemovalUpdates.
    // FirebaseService.updateTeam adds updatedAt. M2 applies only to user-created teams.
    const removal = { coachUids: [], coaches: [], coachNames: [], members: 1, updatedAt: serverTimestamp() };
    await (marker === 'user_capability' ? assertFails : assertSucceeds)(write(removal));
    await assertSucceeds(write(removal, 'manager'));
  });
});

// T-090a P2 (advisor ruling): user-created teams are deleted only through the deleteTeam Callable or by global managers.
describe('T-090a P2 team delete boundary', () => {
  const remove = (uid = 'owner') => deleteDoc(doc(h.db(uid), 'teams', ID));
  const seedOwned = (ownerField, marker) => {
    const data = { id: ID, name: 'Club', coachUids: ['coach'], leaderUids: ['captain'], [ownerField]: 'owner' };
    if (marker) data.createdVia = marker;
    return h.seed('teams', ID, data);
  };
  test.each(['captainUid', 'creatorUid', 'ownerUid'])('user-created owner via %s cannot delete directly', async ownerField => {
    await seedOwned(ownerField, 'user_capability');
    await assertFails(remove());
  });
  test('user-created owner with every owner field set cannot delete directly', async () => { await assertFails(remove()); });
  test('user-created owner holding team.create still cannot delete directly', async () => {
    await h.seed('teams', ID, team({ id: ID, captainUid: 'granted', creatorUid: 'granted', ownerUid: 'granted' }));
    await assertFails(remove('granted'));
  });
  test.each(['coach', 'captain', 'member', 'other'])('user-created %s cannot delete', async uid => { await assertFails(remove(uid)); });
  test.each(['admin', 'super', 'manager'])('%s can delete a user-created team', async uid => { await assertSucceeds(remove(uid)); });
  test.each(['legacy', 'managed'].flatMap(marker => ['captainUid', 'creatorUid', 'ownerUid'].map(field => [marker, field])))('%s owner via %s keeps direct delete', async (marker, ownerField) => {
    await seedOwned(ownerField, marker === 'legacy' ? null : marker);
    await assertSucceeds(remove());
  });
  test.each(['legacy', 'managed'])('%s outsider and staff still cannot delete', async marker => {
    await seedOwned('captainUid', marker === 'legacy' ? null : marker);
    for (const uid of ['other', 'coach', 'captain', 'member']) await assertFails(remove(uid));
  });
  test('guest cannot delete', async () => { await assertFails(deleteDoc(doc(h.guest(), 'teams', ID))); });
});
