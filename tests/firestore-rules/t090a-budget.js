/**
 * rules-budget skill pad probe. Example (use an isolated emulator):
 * node tests/firestore-rules/t090a-budget.js <rules-file> <output.json> [events|users|mixed|all]
 * FIRESTORE_EMULATOR_HOST selects the port; no production network or data is used.
 * Pads wrap the selected allow expression (including every OR branch).
 * Results are maximum successful pads, not exact expression counts (about 3/pad).
 */
const fs = require('fs');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, increment, serverTimestamp, setLogLevel } = require('firebase/firestore');
const { CAP, BASE_CAPS, team, profile, event, fullEvent, seedBase } = require('./t090a-fixtures');
const [rulesPath, outputPath, scope = 'all'] = process.argv.slice(2);
if (!rulesPath || !outputPath) throw Error('Expected rules-file and output.json');
const source = fs.readFileSync(rulesPath, 'utf8');
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
if (!['127.0.0.1', 'localhost'].includes(host)) throw Error('Local emulator required');
const projectId = 'demo-t090a-budget-' + process.pid;
const ID = 'tm_budget';
const specs = [
  ['teams-create-user-present', 'teams/{teamId}', 'create', 'owner', 'team', 'present'],
  ['teams-create-user-missing', 'teams/{teamId}', 'create', 'owner', 'team', 'missing'],
  ['teams-create-admin', 'teams/{teamId}', 'create', 'admin', 'team', 'closed'],
  ['teams-create-super', 'teams/{teamId}', 'create', 'super', 'team', 'closed'],
  ['teams-create-granted', 'teams/{teamId}', 'create', 'granted', 'team', 'closed'],
  ['teams-update-owner', 'teams/{teamId}', 'update', 'owner', 'team-edit'],
  ['teams-update-user-created', 'teams/{teamId}', 'update', 'owner', 'team-edit-user-created'],
  ['teams-update-coach-count', 'teams/{teamId}', 'update', 'coach', 'team-count'],
  ['teams-update-member-count', 'teams/{teamId}', 'update', 'member', 'team-count'],
  ['teams-update-manager', 'teams/{teamId}', 'update', 'manager', 'team-edit'],
  ...['owner', 'coach', 'other'].flatMap(uid => [
    ['teams-view-' + uid + '-legacy', 'teams/{teamId}', 'update', uid, 'team-view'],
    ['teams-view-' + uid + '-user-created', 'teams/{teamId}', 'update', uid, 'team-view-user-created'],
  ]),
  ['events-create-delegate-present', 'events/{eventId}', 'create', 'owner', 'event', 'present'],
  ['events-create-delegate-missing', 'events/{eventId}', 'create', 'owner', 'event', 'missing'],
  ['events-create-full-delegate-present', 'events/{eventId}', 'create', 'owner', 'event-full', 'present'],
  ['events-create-full-delegate-missing', 'events/{eventId}', 'create', 'owner', 'event-full', 'missing'],
  ['users-create', 'users/{userId}', 'create', 'new_user', 'profile'],
  ['users-create-full', 'users/{userId}', 'create', 'new_user', 'profile-full'],
  ['users-update-self', 'users/{userId}', 'update', 'owner', 'profile-edit'],
  ['users-update-review-join', 'users/{userId}', 'update', 'owner', 'join'],
  ['teams-update-owner-role-mix', 'teams/{teamId}', 'update', 'owner', 'team-role-mix'],
  ['teams-update-owner-removal', 'teams/{teamId}', 'update', 'owner', 'team-removal'],
  ['teams-update-managed-role-mix', 'teams/{teamId}', 'update', 'owner', 'team-role-mix-managed'],
  // T-090i: user-created owner adds an existing member as coach (one extra users read).
  ['teams-update-user-created-staff-add', 'teams/{teamId}', 'update', 'owner', 'team-staff-add-user-created'],
  ['coursePlans-create-owner', 'coursePlans/{planId}', 'create', 'owner', 'course'],
  ['coursePlans-create-coach', 'coursePlans/{planId}', 'create', 'coach', 'course'],
  ['coursePlans-create-manager', 'coursePlans/{planId}', 'create', 'manager', 'course'],
].filter(spec => scope === 'all' || (scope === 'mixed' && (spec[4].startsWith('team-role-mix') || spec[4] === 'team-removal' || spec[4].startsWith('team-staff-add'))) || (scope === 'teams' && spec[1] === 'teams/{teamId}' && spec[2] === 'update') || (scope === 'users' && spec[1] === 'users/{userId}' && spec[2] === 'update') || (scope === 'full-events' ? spec[4] === 'event-full' : scope === 'events' ? spec[4].startsWith('event') : scope === 'supplement' && ['team-edit-user-created', 'profile-full'].includes(spec[4])));
function paddedRules(match, action, count) {
  if (!count) return source;
  const start = source.indexOf('match /' + match + ' {');
  if (start < 0) throw Error('Missing match: ' + match);
  const rest = source.slice(start);
  const re = new RegExp('allow ' + action + '(?:, update, delete)?: if (.*?);', 's');
  const found = re.exec(rest);
  if (!found) throw Error('Missing allow: ' + match + '/' + action);
  const balanced = parts => parts.length === 1 ? parts[0] : '(' + balanced(parts.slice(0, Math.floor(parts.length / 2))) + ' && ' + balanced(parts.slice(Math.floor(parts.length / 2))) + ')';
  const pads = balanced(Array.from({ length: count }, (_, k) => "request.resource.data.get('pad" + k + "', " + k + ') == ' + k));
  const next = found[0].replace(found[1], () => '(' + pads + ') && (' + found[1] + ')');
  return source.slice(0, start + found.index) + next + rest.slice(found.index + found[0].length);
}
async function trial(spec, pads) {
  const [, match, action, uid, kind, caps] = spec;
  let env;
  try {
    env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: paddedRules(match, action, pads) } });
    await env.clearFirestore();
    await seedBase(env);
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      const legacy = { id: ID, name: 'Budget team', captainUid: 'owner', coachUids: ['coach'], members: 0 };
      await setDoc(doc(db, 'teams', ID), kind.endsWith('-user-created') ? { ...legacy, creatorUid: 'owner', createdVia: 'user_capability' } : kind.endsWith('-managed') ? { ...legacy, createdVia: 'managed' } : legacy);
      await setDoc(doc(db, 'users', 'member'), profile('member', { teamId: ID, teamIds: [ID] }));
      if (caps !== 'missing') await setDoc(doc(db, 'roleActivityCapabilities', 'user'), { capabilities: caps === 'closed' ? [] : [...BASE_CAPS, CAP] });
      if (kind === 'join') await setDoc(doc(db, 'userPermissionGrants', 'owner'), { permissions: ['team.review_join'], enabled: true });
    });
    const db = env.authenticatedContext(uid).firestore();
    try {
      // P2-1: team.create holders may not carry createdVia 'user_capability', so the granted probe drops the marker to measure its allowed path.
      if (kind === 'team') { const data = team({ creatorUid: uid, captainUid: uid }); if (uid === 'granted') delete data.createdVia; await setDoc(doc(db, 'teams', data.id), data); }
      else if (kind.startsWith('team-edit')) await updateDoc(doc(db, 'teams', ID), { name: 'Edited' });
      else if (kind.startsWith('team-role-mix')) await updateDoc(doc(db, 'teams', ID), { coachUids: ['coach', 'member'], coaches: ['Coach', 'Member'], coachNames: ['Coach', 'Member'], members: 2, updatedAt: serverTimestamp() });
      else if (kind.startsWith('team-staff-add')) await updateDoc(doc(db, 'teams', ID), { coachUids: ['coach', 'member'], coaches: ['Coach', 'Member'], coachNames: ['Coach', 'Member'], updatedAt: serverTimestamp() });
      else if (kind === 'team-removal') await updateDoc(doc(db, 'teams', ID), { coachUids: [], coaches: [], coachNames: [], members: 1, updatedAt: serverTimestamp() });
      else if (kind === 'team-count') await updateDoc(doc(db, 'teams', ID), { members: 1, updatedAt: serverTimestamp() });
      else if (kind.startsWith('team-view')) await updateDoc(doc(db, 'teams', ID), { viewCount: increment(1) });
      else if (kind === 'event') await setDoc(doc(db, 'events', 'ce_t090_budget'), event());
      else if (kind === 'event-full') await setDoc(doc(db, 'events', 'ce_t090_budget'), fullEvent());
      else if (kind === 'profile') await setDoc(doc(db, 'users', uid), profile(uid));
      else if (kind === 'profile-full') await setDoc(doc(db, 'users', uid), profile(uid, { lineUserId: uid, pictureUrl: null, email: null, exp: 0, level: 1, gender: null, birthday: null, region: null, sports: null, phone: null, titleBig: null, titleNormal: null, totalGames: 0, completedGames: 0, attendanceRate: 0, badgeCount: 0, profileCompleted: false, favorites: [], socialLinks: {}, lineNotify: {}, companions: [], eduChildren: [], stealth: false, createdAt: serverTimestamp(), lastLogin: serverTimestamp(), updatedAt: serverTimestamp() }));
      else if (kind === 'profile-edit') await updateDoc(doc(db, 'users', uid), { displayName: 'Edited' });
      else if (kind === 'join') await updateDoc(doc(db, 'users', 'other'), { teamId: ID, teamName: 'Budget team', teamIds: [ID], teamNames: ['Budget team'] });
      else if (kind === 'course') await setDoc(doc(db, 'teams', ID, 'coursePlans', 'plan'), { title: 'Course' });
      return { allowed: true };
    } catch (error) {
      if (error.code !== 'permission-denied') throw error;
      return { allowed: false, error: error.message };
    }
  } finally { if (env) await env.cleanup(); }
}
async function main() {
  setLogLevel('silent');
  const results = [];
  for (const spec of specs) {
    const baseline = await trial(spec, 0);
    let result = { name: spec[0], baseline };
    if (baseline.allowed) {
      let lo = 0, hi = 128;
      while ((await trial(spec, hi)).allowed) { lo = hi; hi *= 2; if (hi > 512) throw Error('Probe upper bound insufficient: ' + spec[0]); }
      while (hi - lo > 1) { const n = Math.floor((hi + lo) / 2); if ((await trial(spec, n)).allowed) lo = n; else hi = n; }
      const last = await trial(spec, hi);
      if (!last.error.includes('maximum of 1000 expressions')) throw Error('Non-budget failure at threshold: ' + spec[0] + ': ' + last.error);
      result = { ...result, maxPassPad: lo, firstFailPad: hi, firstFailError: last.error };
    }
    results.push(result);
    fs.writeFileSync(outputPath, JSON.stringify({ rulesPath, sha256: require('crypto').createHash('sha256').update(source).digest('hex'), projectId, results }, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(result));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
