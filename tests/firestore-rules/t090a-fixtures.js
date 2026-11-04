// T-090a synthetic fixtures. No production project, IDs or data.
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, setDoc, serverTimestamp } = require('firebase/firestore');
const CAP = 'user.activity.team_create';
const ROLES = { owner: 'user', other: 'user', coach: 'coach', captain: 'captain', venue: 'venue_owner', admin: 'admin', super: 'super_admin', granted: 'user', manager: 'user', member: 'user' };
const DEFAULTS = { active: true, pinned: false, pinOrder: 0, attentionEffectEnabled: false, attentionEffectColor: '#fbbf24', teamExp: 0, viewCount: 0, views: 0, members: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, history: [] };
const BASE_CAPS = ['basic_create', 'external_create', 'own_manage_entry', 'own_edit_basic', 'own_cancel', 'site_operate', 'delegate_assign'].map(code => 'user.activity.' + code);
let seq = 0;
function team(overrides = {}) {
  return { id: 'tm_' + Date.now() + '_' + (++seq).toString(36), name: 'Synthetic club', createdVia: 'user_capability', creatorUid: 'owner', captainUid: 'owner', ...overrides };
}
function profile(uid, overrides = {}) {
  return { uid, role: 'user', displayName: 'Synthetic member', teamId: null, teamName: null, teamIds: [], teamNames: [], ...overrides };
}
function event(id = 'ce_t090_budget') {
  return {
    id, clientRequestId: id, title: 'Synthetic activity', type: 'friendly', status: 'open',
    location: 'Test field', date: '2099/01/02 10:00~12:00', max: 20, minAge: 0,
    startTimestamp: new Date('2099-01-02T10:00:00Z'), endTimestamp: new Date('2099-01-02T12:00:00Z'),
    current: 0, waitlist: 0, participants: [], waitlistNames: [],
    creatorUid: 'owner', creator: 'Owner', delegates: [{ uid: 'other', name: 'Other' }], delegateUids: ['other'],
    creatorTeamId: null, creatorTeamName: null, creatorTeamIds: [], creatorTeamNames: [],
    fee: 0, feeEnabled: false, teamOnly: false, isPublic: false, privateEvent: false,
    genderRestrictionEnabled: false, allowedGender: '', socialLinksEnabled: false, socialLinks: [],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
}
function fullEvent() {
  return { ...event(), payloadRevision: 1, payloadDigest: 'v1-' + '1'.repeat(32),
    realCurrent: 0, participantsWithUid: [], waitlistWithUid: [], notes: '', image: 'images/default.jpg',
    sportTag: 'football', regOpenTime: null, contact: '', gradient: '', icon: '', countdown: '',
    regionEnabled: true, region: 'central', cities: ['Test city'],
    earlyBirdEnabled: false, earlyBirdCost: 0, earlyBirdPolicyVersion: null,
    gpsEnabled: false, lat: null, lng: null, mapAddress: null, mapPlaceId: null,
    mapProvider: null, mapLocationConfirmed: false, mapLocationUpdatedAt: null,
  };
}
async function seedBase(env) {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const [uid, role] of Object.entries(ROLES)) await setDoc(doc(db, 'users', uid), profile(uid, { role }));
    for (const role of ['user', 'coach', 'captain', 'venue_owner']) await setDoc(doc(db, 'rolePermissions', role), { permissions: [] });
    await setDoc(doc(db, 'rolePermissions', 'admin'), { permissions: ['team.create', 'team.manage_all'] });
    await setDoc(doc(db, 'userPermissionGrants', 'granted'), { permissions: ['team.create'], enabled: true });
    await setDoc(doc(db, 'userPermissionGrants', 'manager'), { permissions: ['team.manage_all'], enabled: true });
  });
}
function harness(suffix) {
  let env;
  beforeAll(async () => {
    const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-t090a-' + suffix + (process.env.T090_PROJECT_SUFFIX || ''),
      firestore: { host, port: Number(port), rules: fs.readFileSync(process.env.T090_RULES_PATH || path.resolve(__dirname, '../../firestore.rules'), 'utf8') },
    });
  }, 60000);
  beforeEach(async () => { await env.clearFirestore(); await seedBase(env); });
  afterAll(async () => { if (env) await env.cleanup(); });
  const db = (uid = 'owner', claims = {}) => env.authenticatedContext(uid, claims).firestore();
  const seed = async (collection, id, data) => env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), collection, id), data));
  const create = (payload = team(), uid = 'owner', id = payload.id) => setDoc(doc(db(uid), 'teams', id), payload);
  return { db, seed, create, guest: () => env.unauthenticatedContext().firestore(), cap: data => seed('roleActivityCapabilities', 'user', data) };
}
module.exports = { CAP, DEFAULTS, BASE_CAPS, ROLES, team, profile, event, fullEvent, seedBase, harness };
