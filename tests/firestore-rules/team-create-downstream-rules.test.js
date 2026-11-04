/** T-090a B2/B8/B9 and unchanged R-U2 scope. */
const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc } = require('firebase/firestore');
const { team, profile, event, fullEvent, BASE_CAPS, harness } = require('./t090a-fixtures');
jest.setTimeout(30000);
const h = harness('boundaries');
const ID = 'tm_scope';
beforeEach(async () => { await h.seed('teams', ID, team({ id: ID, coachUids: ['coach'], leaderUids: ['captain'] })); });

describe('B2 coursePlans and B8 tournaments', () => {
  test.each(['owner', 'coach', 'captain', 'admin', 'super', 'manager'])('user-created course create denied for %s', async uid => {
    await assertFails(setDoc(doc(h.db(uid), 'teams', ID, 'coursePlans', 'new'), { title: 'Course', createdVia: 'managed' }));
  });
  test.each(['owner', 'coach', 'captain', 'admin', 'super', 'manager'])('managed-created course create retained for %s', async uid => {
    await h.seed('teams', ID, { id: ID, captainUid: 'owner', coachUids: ['coach'], leaderUids: ['captain'] });
    await assertSucceeds(setDoc(doc(h.db(uid), 'teams', ID, 'coursePlans', 'new'), { title: 'Course' }));
  });
  test('outsider cannot create managed course', async () => {
    await h.seed('teams', ID, { id: ID, captainUid: 'owner' });
    await assertFails(setDoc(doc(h.db('other'), 'teams', ID, 'coursePlans', 'new'), { title: 'Course' }));
  });
  test.each(['user_capability', null])('all direct tournament create stays denied, team marker=%j', async marker => {
    const data = team({ id: ID }); if (marker === null) delete data.createdVia;
    await h.seed('teams', ID, data);
    for (const uid of ['owner', 'coach', 'admin', 'super', 'manager']) await assertFails(setDoc(doc(h.db(uid), 'tournaments', 'ct_new'), { id: 'ct_new', hostTeamId: ID, creatorUid: uid, name: 'Tournament', mode: 'friendly' }));
  });
});

describe('B9 users create starts with no team membership', () => {
  test.each([false, true])('teamId null with teamIds empty or absent (%s) accepted', async omit => {
    const data = profile('new_user'); if (omit) delete data.teamIds;
    await assertSucceeds(setDoc(doc(h.db('new_user'), 'users', 'new_user'), data));
  });
  test.each(['missing', '', ID, 1, []])('teamId=%j denied', async value => {
    const data = profile('new_user'); if (value === 'missing') delete data.teamId; else data.teamId = value;
    await assertFails(setDoc(doc(h.db('new_user'), 'users', 'new_user'), data));
  });
  test.each([null, ID, [ID], {}, [null]])('teamIds=%j denied', async value => { await assertFails(setDoc(doc(h.db('new_user'), 'users', 'new_user'), profile('new_user', { teamIds: value }))); });
  test('cannot create another user or elevate own role', async () => {
    await assertFails(setDoc(doc(h.db(), 'users', 'new_user'), profile('new_user')));
    await assertFails(setDoc(doc(h.db('new_user'), 'users', 'new_user'), profile('new_user', { role: 'coach' })));
  });
});

describe('R-U2 retains grant requirement and one managed team scope', () => {
  const join = (ids = [ID], names = ['Club']) => ({ teamId: ids[0], teamName: names[0], teamIds: ids, teamNames: names });
  test('user-created owner without team.review_join still cannot add another user', async () => { await assertFails(updateDoc(doc(h.db(), 'users', 'other'), join())); });
  test('explicit review grant allows appending own team only', async () => {
    await h.seed('userPermissionGrants', 'owner', { permissions: ['team.review_join'], enabled: true });
    await assertSucceeds(updateDoc(doc(h.db(), 'users', 'other'), join()));
  });
  test('grant does not allow an unmanaged team, mixed profile changes or two teams', async () => {
    await h.seed('userPermissionGrants', 'owner', { permissions: ['team.review_join'], enabled: true });
    await h.seed('teams', 'tm_foreign', { id: 'tm_foreign', captainUid: 'other' });
    await assertFails(updateDoc(doc(h.db(), 'users', 'other'), join(['tm_foreign'])));
    await assertFails(updateDoc(doc(h.db(), 'users', 'other'), { ...join(), displayName: 'Spoofed' }));
    await assertFails(updateDoc(doc(h.db(), 'users', 'other'), join([ID, 'tm_foreign'], ['Club', 'Foreign'])));
  });
  test('grant cannot rewrite existing membership prefix', async () => {
    await h.seed('users', 'other', profile('other', join(['tm_old'], ['Old'])));
    await h.seed('userPermissionGrants', 'owner', { permissions: ['team.review_join'], enabled: true });
    await assertFails(updateDoc(doc(h.db(), 'users', 'other'), join([ID, 'tm_old'], ['Club', 'Old'])));
    await assertSucceeds(updateDoc(doc(h.db(), 'users', 'other'), join(['tm_old', ID], ['Old', 'Club'])));
  });
  test('own ordinary profile update remains allowed', async () => { await assertSucceeds(updateDoc(doc(h.db(), 'users', 'owner'), { displayName: 'Edited name' })); });
});

describe('shared capability fallback regression: events with delegates', () => {
  test('missing capability document retains delegated event create', async () => { await assertSucceeds(setDoc(doc(h.db(), 'events', 'ce_t090_budget'), event())); });
  test('full frontend-shaped delegated event works with missing capability document', async () => { await assertSucceeds(setDoc(doc(h.db(), 'events', 'ce_t090_budget'), fullEvent())); });
  test('full frontend-shaped delegated event works with existing capability document', async () => { await h.cap({ capabilities: BASE_CAPS }); await assertSucceeds(setDoc(doc(h.db(), 'events', 'ce_t090_budget'), fullEvent())); });
  test('existing capability list retains delegated event create', async () => { await h.cap({ capabilities: BASE_CAPS }); await assertSucceeds(setDoc(doc(h.db(), 'events', 'ce_t090_budget'), event())); });
});
