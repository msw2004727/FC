/** Replay the same A payloads against candidate and origin/main via T090_RULES_PATH. */
const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, updateDoc, deleteField, serverTimestamp } = require('firebase/firestore');
const { DEFAULTS, profile, harness } = require('./t090a-fixtures');
jest.setTimeout(30000);
const h = harness('legacy-compat');
const ID = 'tm_legacy_compat';
const roles = { leaderUids: ['leader'], leaders: ['Leader'], leaderNames: ['Leader'], leaderUid: 'leader', leader: 'Leader', coachUids: ['coach'], coaches: ['Coach'], coachNames: ['Coach'] };
const cases = [
  ['promote member to coach', { ...roles, coachUids: ['coach', 'member'], coaches: ['Coach', 'Member'], coachNames: ['Coach', 'Member'], members: 3 }],
  ['demote leader to coach', { ...roles, leaderUids: [], leaders: [], leaderNames: [], leaderUid: null, leader: '', coachUids: ['coach', 'leader'], coaches: ['Coach', 'Leader'], coachNames: ['Coach', 'Leader'], members: 3 }],
  ['remove coach', { coachUids: [], coaches: [], coachNames: [], members: 1 }],
  ['remove leader', { leaderUids: [], leaders: [], leaderNames: [], leaderUid: null, leader: '', members: 1 }],
  ['owner admin fields', { active: false, pinned: true, pinOrder: 2, attentionEffectEnabled: true, attentionEffectColor: '#123456', teamExp: 9, viewCount: 9, views: 9, wins: 9, draws: 9, losses: 9, gf: 9, ga: 9, history: ['changed'], members: 3 }],
];

for (const marker of ['legacy', 'managed', 'user_capability']) {
  const label = marker === 'user_capability' ? 'user-created restrictions' : 'origin/main compatibility: ' + marker;
  describe(label, () => {
    const seedTeam = async (ownerField = 'captainUid') => {
      const data = { ...DEFAULTS, ...roles, id: ID, name: 'Club', members: 2, [ownerField]: 'owner' };
      if (marker !== 'legacy') data.createdVia = marker;
      await h.seed('teams', ID, data);
    };
    beforeEach(async () => { await seedTeam(); });
    describe.each(['captainUid', 'creatorUid', 'ownerUid'])('strict owner via %s', ownerField => {
      test.each(cases)('%s with changed members', async (_, patch) => {
        await seedTeam(ownerField);
        const write = updateDoc(doc(h.db(), 'teams', ID), { ...patch, updatedAt: serverTimestamp() });
        await (marker === 'user_capability' ? assertFails : assertSucceeds)(write);
      });
      test('owner admin fields may be deleted or added only on legacy/managed teams', async () => {
        await seedTeam(ownerField);
        const check = marker === 'user_capability' ? assertFails : assertSucceeds;
        await check(updateDoc(doc(h.db(), 'teams', ID), { pinned: deleteField(), history: deleteField(), viewCount: deleteField() }));
        await seedTeam(ownerField);
        await h.seed('teams', ID, { id: ID, name: 'Club', [ownerField]: 'owner', ...(marker === 'legacy' ? {} : { createdVia: marker }) });
        await check(updateDoc(doc(h.db(), 'teams', ID), { pinned: false, history: [], viewCount: 9 }));
      });
    });
    test('ordinary staff keeps the original whitelist; members mixing is restricted only on user-created teams', async () => {
      await h.seed('users', 'coach', profile('coach'));
      const write = updateDoc(doc(h.db('coach'), 'teams', ID), { coaches: ['Updated coach label'], feed: [], members: 3, updatedAt: serverTimestamp() });
      await (marker === 'user_capability' ? assertFails : assertSucceeds)(write);
      await assertFails(updateDoc(doc(h.db('coach'), 'teams', ID), { name: 'Not staff-whitelisted' }));
    });
    test.each(['member', 'other'])('%s cannot use owner mixed-write privileges', async uid => {
      await h.seed('users', 'member', profile('member', { teamId: ID, teamIds: [ID] }));
      await assertFails(updateDoc(doc(h.db(uid), 'teams', ID), { ...cases[0][1], updatedAt: serverTimestamp() }));
    });
  });
}

describe.each(['legacy', 'managed'])('immutable identity/provenance exceptions: %s', marker => {
  test.each(['id', 'creatorUid', 'ownerUid', 'createdVia'])('%s cannot change, disappear or be added', async key => {
    const data = { id: ID, name: 'Club', captainUid: 'owner', creatorUid: 'owner', ownerUid: 'owner' };
    if (marker !== 'legacy') data.createdVia = marker;
    await h.seed('teams', ID, data);
    await assertFails(updateDoc(doc(h.db(), 'teams', ID), { [key]: 'forged' }));
    if (key in data) await assertFails(updateDoc(doc(h.db(), 'teams', ID), { [key]: deleteField() }));
    delete data[key];
    await h.seed('teams', ID, data);
    await assertFails(updateDoc(doc(h.db(), 'teams', ID), { [key]: key === 'createdVia' ? 'managed' : 'owner' }));
  });
});
