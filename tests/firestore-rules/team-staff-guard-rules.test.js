/** T-090i: user-created team owners cannot list non-members as staff or turn on teaching; legacy and manage_all are unchanged. */
const { assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, updateDoc, setDoc, serverTimestamp, arrayUnion } = require('firebase/firestore');
const { DEFAULTS, team, profile, harness } = require('./t090a-fixtures');
jest.setTimeout(30000);
const h = harness('staffguard');
const ID = 'tm_staffguard';
const write = (patch, uid = 'owner') => updateDoc(doc(h.db(uid), 'teams', ID), patch);
const seedUserCreated = (extra = {}) => h.seed('teams', ID, team({ ...DEFAULTS, id: ID, ownerUid: 'owner', coachUids: ['coach'], leaderUids: ['captain'], leaderUid: 'captain', ...extra }));
const seedLegacy = (extra = {}) => h.seed('teams', ID, { id: ID, name: 'Legacy', captainUid: 'owner', creatorUid: 'owner', coachUids: ['coach'], leaderUids: ['captain'], leaderUid: 'captain', ...extra });
// B buildMemberRoleUpdates shape (one person per write, appended at the end).
const asCoach = (uids) => ({ coachUids: uids, coaches: uids, coachNames: uids, updatedAt: serverTimestamp() });
const asLeader = (uids) => ({ leaderUids: uids, leaders: uids, leaderNames: uids, leaderUid: uids[0] || null, leader: uids[0] || '', updatedAt: serverTimestamp() });

beforeEach(async () => {
  await seedUserCreated();
  await h.seed('users', 'member', profile('member', { teamId: ID, teamIds: [ID] }));
  await h.seed('users', 'member2', profile('member2', { teamIds: ['tm_elsewhere', ID] }));
  await h.seed('users', 'outsider', profile('outsider', { teamId: 'tm_elsewhere', teamIds: ['tm_elsewhere'] }));
});

describe('T-090i user-created staff assignment needs membership', () => {
  test.each([
    ['coachUids', () => asCoach(['coach', 'outsider'])],
    ['leaderUids', () => asLeader(['captain', 'outsider'])],
    ['leaderUid', () => ({ leaderUid: 'outsider' })],
    ['coachUids via arrayUnion', () => ({ coachUids: arrayUnion('outsider') })],
    ['coachUids with an unknown uid', () => asCoach(['coach', 'ghost'])],
  ])('owner cannot list a non-member via %s', async (_label, patch) => {
    await assertFails(write(patch()));
  });

  test.each([
    ['coach (teamId)', () => asCoach(['coach', 'member'])],
    ['coach (teamIds only)', () => asCoach(['coach', 'member2'])],
    ['leader', () => asLeader(['captain', 'member'])],
    ['coach via arrayUnion', () => ({ coachUids: arrayUnion('member') })],
  ])('owner can promote an existing member as %s', async (_label, patch) => {
    await assertSucceeds(write(patch()));
  });

  test('two new staff in one write are rejected even if both are members', async () => {
    await assertFails(write(asCoach(['coach', 'member', 'member2'])));
    await assertSucceeds(write(asCoach(['coach', 'member'])));
    await assertSucceeds(write(asCoach(['coach', 'member', 'member2'])));
  });

  test('a non-member slipped in alongside a member at the tail is rejected', async () => {
    await assertFails(write(asCoach(['outsider', 'coach', 'member'])));
  });

  test('owner may list themselves, keep, reorder, move between existing staff, or remove', async () => {
    await assertSucceeds(write(asCoach(['coach', 'owner'])));
    await assertSucceeds(write({ name: 'Basic edit', coachUids: ['coach', 'owner'] }));
    await assertSucceeds(write({ ...asCoach(['owner', 'coach']), ...asLeader(['captain']) }));
    await assertSucceeds(write({ ...asCoach(['owner']), ...asLeader(['captain', 'coach']) }));
    await assertSucceeds(write({ ...asCoach([]), ...asLeader([]) }));
  });

  test('a non-member inserted at the head while the tail is an existing staff member is rejected', async () => {
    await seedUserCreated({ coachUids: ['member'] });
    await assertFails(write(asCoach(['outsider', 'member'])));
  });

  test('removing a member from teamIds before assignment blocks the assignment', async () => {
    await h.seed('users', 'member', profile('member', { teamId: null, teamIds: [] }));
    await assertFails(write(asCoach(['coach', 'member'])));
  });

  test('outsider cannot self-assign as staff on someone else\'s team', async () => {
    await assertFails(write(asCoach(['coach', 'outsider']), 'outsider'));
  });

  test('staff still cannot touch staff UID fields', async () => {
    await assertFails(write(asCoach(['coach', 'member']), 'coach'));
    await assertFails(write(asLeader(['captain', 'member']), 'captain'));
  });

  test('non-list staff values are rejected', async () => {
    await assertFails(write({ coachUids: 'member' }));
    await assertFails(write({ leaderUids: null }));
  });
});

describe('T-090i user-created teaching lock', () => {
  test.each([
    ['type education', { type: 'education' }],
    ['teachingEnabled true', { teachingEnabled: true }],
    ['eduSettings', { eduSettings: { teachingEnabled: true } }],
    ['isTeaching', { isTeaching: true }],
    ['educationTag', { educationTag: true }],
    ['A category save', { type: 'education', teachingEnabled: true, eduSettings: { teachingEnabled: true } }],
  ])('owner cannot switch on %s', async (_label, patch) => {
    await assertFails(write({ ...patch, updatedAt: serverTimestamp() }));
  });

  test('owner can still pick non-teaching categories', async () => {
    await assertSucceeds(write({ type: 'competitive', teachingEnabled: false, updatedAt: serverTimestamp() }));
    await assertSucceeds(write({ type: 'leisure' }));
    await assertSucceeds(write({ type: 'none' }));
  });
});

describe('T-090i legacy and global managers are not affected', () => {
  test('legacy owner may still list a non-member and switch on teaching', async () => {
    await seedLegacy();
    await assertSucceeds(write(asCoach(['coach', 'outsider', 'ghost'])));
    await assertSucceeds(write(asLeader(['outsider'])));
    await assertSucceeds(write({ type: 'education', teachingEnabled: true, eduSettings: { teachingEnabled: true } }));
  });

  test('managed marker behaves as legacy', async () => {
    await seedLegacy({ createdVia: 'managed' });
    await assertSucceeds(write(asCoach(['coach', 'outsider'])));
    await assertSucceeds(write({ type: 'education', teachingEnabled: true }));
  });

  test.each(['admin', 'super', 'manager'])('%s may still assign anyone and enable teaching on a user-created team', async uid => {
    await assertSucceeds(write(asCoach(['coach', 'outsider', 'ghost']), uid));
    await assertSucceeds(write({ leaderUid: 'outsider', type: 'education', teachingEnabled: true }, uid));
  });

  test('team.create alone grants no bypass', async () => {
    await assertFails(write(asCoach(['coach', 'outsider']), 'granted'));
  });

  test('user-created basic edit still works with unchanged staff fields in the payload', async () => {
    await assertSucceeds(write({ name: 'Edited', coachUids: ['coach'], leaderUids: ['captain'], leaderUid: 'captain', updatedAt: serverTimestamp() }));
  });

  test('setDoc replacement keeping provenance follows the same staff guard', async () => {
    const current = team({ ...DEFAULTS, id: ID, ownerUid: 'owner', coachUids: ['coach'], leaderUids: ['captain'], leaderUid: 'captain' });
    await h.seed('teams', ID, current);
    await assertFails(setDoc(doc(h.db(), 'teams', ID), { ...current, coachUids: ['coach', 'outsider'] }));
    await assertSucceeds(setDoc(doc(h.db(), 'teams', ID), { ...current, coachUids: ['coach', 'member'] }));
  });
});
