/**
 * K11 邀請記分員（模擬器）：cpHost createInvite／revokeInvite、cpParticipant acceptInvite。
 * 接受後用用戶端 SDK＋asia-main Rules 驗證只能接手 matchIds 內的場次。
 * 賽事由 TESTER（內部期測試者）建立當個人主辦（現行行為）。
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { ReadMeter, actorHash } from '../src/cp/context.js';
import { handleCpHost } from '../src/cp/host.js';
import { handleCpParticipant } from '../src/cp/participant.js';
import { assignedDataOk } from '../src/cp/staff-host.js';
import { adminDb, assertFails, assertSucceeds, clientDb, closeClients } from '../test-rules/_harness.js';
import {
  ADMIN, DAY, MAIN, STRANGER, TESTER, TESTER2, TESTER3, call, createInput, fails, makeDeps, ok, resetAll, scanAll,
  setBannedWords, type Who
} from './_cp.js';

const MT = 'mt_' + 'a'.repeat(20);
const MT2 = 'mt_' + 'b'.repeat(20);
const SID = 'k11-invite-sid-device1';

function matchBody(mtId: string, dvId: string) {
  return {
    matchId: mtId, divisionId: dvId, stageId: 'group', groupId: 'A', round: 1, matchNo: 1,
    status: 'scheduled', rev: 0, resetRev: 0, score: { home: 0, away: 0 },
    lock: { locked: false },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'pre' },
    home: { teamId: 'en_h', name: '主隊' }, away: { teamId: 'en_a', name: '客隊' },
    teamIds: ['en_h', 'en_a'], finishedAt: null, confirmedAt: null
  };
}

async function setup(over: Record<string, unknown> = {}) {
  const created = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER, createInput(over)));
  const cid = created.cid;
  const dvId = created.dvIds[0]!;
  await ok(call(handleCpHost, TESTER, { action: 'publish', cid }));
  await adminDb().doc(`competitions/${cid}/matches/${MT}`).set(matchBody(MT, dvId));
  await adminDb().doc(`competitions/${cid}/matches/${MT2}`).set(matchBody(MT2, dvId));
  return cid;
}

type Created = { ivId: string; code: string; expiresAt: number };

function create(cid: string, over: Record<string, unknown> = {}, who: Who = TESTER, deps = makeDeps()) {
  return call(handleCpHost, who, { action: 'createInvite', cid, roles: ['scorer'], matchIds: [MT], ...over }, deps);
}
function accept(cid: string, iv: { ivId: string; code: string }, who: Who = TESTER3, deps = makeDeps()) {
  return call(handleCpParticipant, who, { action: 'acceptInvite', cid, ivId: iv.ivId, code: iv.code }, deps);
}
function revoke(cid: string, ivId: string, who: Who = TESTER) {
  return call(handleCpHost, who, { action: 'revokeInvite', cid, ivId });
}
const ivDoc = async (cid: string, ivId: string) => (await adminDb().doc(`competitions/${cid}/invites/${ivId}`).get()).data()!;
const compDoc = async (cid: string) => (await adminDb().doc(`competitions/${cid}`).get()).data()!;
const staffSnap = (cid: string, uid: string) => adminDb().doc(`competitions/${cid}/staff/${uid}`).get();

describe('K11 邀請記分員', () => {
  let cid = '';

  beforeEach(async () => {
    await resetAll();
    cid = await setup();
  });
  afterEach(() => closeClients());

  it('建立：主辦與共同主辦可以；非主辦、被指派記分員、別場主辦 NOT_HOST；內部期一般會員 INTERNAL_PERIOD', async () => {
    const a = await ok<Created>(create(cid));
    expect(a.ivId).toMatch(/^iv_[A-Za-z0-9]{20}$/);
    expect(a.code).toMatch(/^[A-Za-z0-9_-]{22}$/);

    await adminDb().doc(`competitions/${cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [], expiresAt: null });
    await ok(create(cid, { roles: ['referee', 'scorer'] }, TESTER2));

    await fails(create(cid, {}, TESTER3), 'NOT_HOST', 'permission-denied');
    await adminDb().doc(`competitions/${cid}/staff/tester3`).set({ roles: ['scorer'], matchIds: [MT], expiresAt: null });
    await fails(create(cid, {}, TESTER3), 'NOT_HOST', 'permission-denied');
    // 別場賽事的主辦
    const otherCid = (await ok<{ cid: string }>(call(handleCpHost, TESTER2, createInput({ name: '【測試】另一盃' })))).cid;
    await fails(create(otherCid, {}, TESTER), 'NOT_HOST', 'permission-denied');
    await fails(create(cid, {}, STRANGER), 'INTERNAL_PERIOD', 'permission-denied');
    await fails(accept(cid, a, STRANGER), 'INTERNAL_PERIOD', 'permission-denied');

    // 不能邀主辦／共同主辦、多帶鍵、壞場次
    await fails(create(cid, { roles: ['coHost', 'scorer'] }), 'FIELD_ENUM');
    await fails(create(cid, { roles: ['host'] }), 'FIELD_ENUM');
    await fails(create(cid, { uid: 'tester3' }), 'UNKNOWN_FIELD');
    await fails(create(cid, { matchIds: ['x'] }), 'BAD_ID');
    expect((await compDoc(cid)).inviteSeq).toBe(2);
  });

  it('開放後：內部賽事一般會員 INTERNAL_COMPETITION；公開賽事一般會員 NOT_HOST', async () => {
    const iv = await ok<Created>(create(cid));
    await adminDb().doc('cpConfig/launch').set({ isPublic: true }, { merge: true });
    await fails(create(cid, {}, STRANGER), 'INTERNAL_COMPETITION', 'permission-denied');
    await fails(accept(cid, iv, STRANGER), 'INTERNAL_COMPETITION', 'permission-denied');
    const pub = await setup({ name: '【測試】公開盃' });
    expect((await compDoc(pub)).visibility).toBe('public');
    await fails(create(pub, {}, STRANGER), 'NOT_HOST', 'permission-denied');
    // 公開賽事一般會員可以接受
    const pubIv = await ok<Created>(create(pub));
    await ok(accept(pub, pubIv, STRANGER));
    expect((await staffSnap(pub, 'stranger')).get('roles')).toEqual(['scorer']);
  });

  it('邀請文件不含代碼原文與 uid；codeHash＝sha256(code)；預設到期＝末場＋7 天；稽核不含 uid 與代碼', async () => {
    const iv = await ok<Created>(create(cid, { matchIds: [MT, MT2] }));
    const comp = await compDoc(cid);
    expect(iv.expiresAt).toBe(comp.lastMatchAt.toMillis() + 7 * DAY);
    const d = await ivDoc(cid, iv.ivId);
    expect(Object.keys(d).sort()).toEqual(['codeHash', 'createdAt', 'expiresAt', 'matchIds', 'roles', 'status', 'updatedAt']);
    expect(d.codeHash).toBe(createHash('sha256').update(iv.code).digest('hex'));
    expect(d.roles).toEqual(['scorer']);
    expect(d.matchIds).toEqual([MT, MT2]);
    expect(d.status).toBe('open');
    expect(d.expiresAt.toMillis()).toBe(iv.expiresAt);

    await ok(accept(cid, iv));
    const used = await ivDoc(cid, iv.ivId);
    expect(used.status).toBe('used');
    expect(used.usedMemberNo).toBe(2);
    expect(used.usedAt).toBeTruthy();

    const uids = ['tester', 'tester2', 'tester3', 'admin', 'stranger'];
    const hits = await scanAll([`competitions/${cid}/invites`, `competitions/${cid}/audits`], (_k, v) =>
      typeof v === 'string' && (v === iv.code || uids.includes(v) || v.includes(iv.code)));
    expect(hits).toEqual([]);
    const audits = await adminDb().collection(`competitions/${cid}/audits`).get();
    const byAction = Object.fromEntries(audits.docs.map(x => [x.get('action'), x.data()]));
    expect(byAction.createInvite.details).toEqual({ ivId: iv.ivId, roles: ['scorer'], matchCount: 2 });
    expect(byAction.acceptInvite.actor).toBe(actorHash(cid, 'tester3'));
    expect(byAction.acceptInvite.details).toEqual({ target: actorHash(cid, 'tester3'), ivId: iv.ivId, roles: ['scorer'] });
  });

  it('到期：早於現在或晚於末場＋7 天 FIELD_RANGE；可帶較早的到期', async () => {
    const comp = await compDoc(cid);
    const cap = comp.lastMatchAt.toMillis() + 7 * DAY;
    await fails(create(cid, { expiresAt: Date.now() - DAY }), 'FIELD_RANGE', 'invalid-argument');
    await fails(create(cid, { expiresAt: cap + 1 }), 'FIELD_RANGE', 'invalid-argument');
    const early = Date.now() + DAY;
    expect((await ok<Created>(create(cid, { expiresAt: early }))).expiresAt).toBe(early);
    expect((await ok<Created>(create(cid, { expiresAt: cap }))).expiresAt).toBe(cap);
  });

  it('場次不存在 MATCH_NOT_FOUND：不寫邀請、inviteSeq 不變、無稽核', async () => {
    await fails(create(cid, { matchIds: [MT, 'mt_' + 'z'.repeat(20)] }), 'MATCH_NOT_FOUND', 'not-found');
    expect((await compDoc(cid)).inviteSeq).toBeUndefined();
    expect((await adminDb().collection(`competitions/${cid}/invites`).get()).size).toBe(0);
    expect((await adminDb().collection(`competitions/${cid}/audits`).where('action', '==', 'createInvite').get()).size).toBe(0);
    // 空場次可以（之後再由主辦指派）
    await ok(create(cid, { matchIds: [] }));
    expect((await compDoc(cid)).inviteSeq).toBe(1);
  });

  it('額度：第 31 張 INVITE_LIMIT；撤銷不退額度', async () => {
    await adminDb().doc(`competitions/${cid}`).update({ inviteSeq: 28 });
    await ok(create(cid));
    const last = await ok<Created>(create(cid));
    expect((await compDoc(cid)).inviteSeq).toBe(30);
    const out = await create(cid);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatchObject({ code: 'resource-exhausted', reason: 'INVITE_LIMIT', params: { max: 30 } });
    }
    await ok(revoke(cid, last.ivId));
    await fails(create(cid), 'INVITE_LIMIT', 'resource-exhausted');
    expect((await compDoc(cid)).inviteSeq).toBe(30);
    expect((await adminDb().collection(`competitions/${cid}/invites`).get()).size).toBe(2);
  });

  it('接受：staff、cpMine、invite used；Rules 只能接手 matchIds 內的場次', async () => {
    const iv = await ok<Created>(create(cid, { roles: ['scorer', 'referee'] }));
    const r = await ok<{ cid: string; roles: string[]; matchCount: number }>(accept(cid, iv));
    expect(r).toEqual({ cid, roles: ['scorer', 'referee'], matchCount: 1 });

    const s = (await staffSnap(cid, 'tester3')).data()!;
    expect(s.roles).toEqual(['scorer', 'referee']);
    expect(s.matchIds).toEqual([MT]);
    expect(s.expiresAt.toMillis()).toBe(iv.expiresAt);
    expect(s.memberNo).toBe(2);
    expect(s.displayName).toBe('路人丁');
    expect((await compDoc(cid)).staffSeq).toBe(2);
    expect(assignedDataOk({ roles: s.roles, matchIds: s.matchIds, expiresAtMs: s.expiresAt.toMillis() }, MT, Date.now())).toBe(true);
    expect(assignedDataOk({ roles: s.roles, matchIds: s.matchIds, expiresAtMs: s.expiresAt.toMillis() }, MT2, Date.now())).toBe(false);

    const mine = (await adminDb().doc(`cpMine/tester3/items/${cid}`).get()).data()!;
    expect(mine.roles).toEqual(['scorer', 'referee']);
    expect(mine.host).toBe(false);

    const db = clientDb({ uid: 'tester3' });
    await assertSucceeds(setDoc(doc(db, `competitions/${cid}/matches/${MT}/control/scorer`), { uid: 'tester3', takenAt: serverTimestamp(), sid: SID }));
    await assertFails(setDoc(doc(db, `competitions/${cid}/matches/${MT2}/control/scorer`), { uid: 'tester3', takenAt: serverTimestamp(), sid: SID }));
  });

  it('代碼錯、ivId 不存在 INVITE_INVALID（同代碼）；已撤銷、已使用、過期各自錯誤；壞形狀 BAD_ID', async () => {
    const iv = await ok<Created>(create(cid));
    const wrong = iv.code.slice(0, 21) + (iv.code.endsWith('A') ? 'B' : 'A');
    await fails(accept(cid, { ivId: iv.ivId, code: wrong }), 'INVITE_INVALID', 'not-found');
    await fails(accept(cid, { ivId: 'iv_' + 'q'.repeat(20), code: iv.code }), 'INVITE_INVALID', 'not-found');
    await fails(accept(cid, { ivId: iv.ivId, code: 'short' }), 'BAD_ID', 'invalid-argument');
    await fails(accept(cid, { ivId: 'xx', code: iv.code }), 'BAD_ID', 'invalid-argument');
    await fails(call(handleCpParticipant, TESTER3, { action: 'acceptInvite', cid, ivId: iv.ivId, code: iv.code, uid: 'x' }), 'UNKNOWN_FIELD');

    const rv = await ok<Created>(create(cid));
    await ok(revoke(cid, rv.ivId));
    await fails(accept(cid, rv), 'INVITE_REVOKED', 'failed-precondition');
    // 撤銷的邀請代碼錯仍是 INVITE_INVALID（不洩漏狀態）
    await fails(accept(cid, { ivId: rv.ivId, code: wrong }), 'INVITE_INVALID', 'not-found');

    await ok(accept(cid, iv));
    await fails(accept(cid, iv, TESTER2), 'INVITE_USED', 'failed-precondition');
    expect((await staffSnap(cid, 'tester2')).exists).toBe(false);

    const short = await ok<Created>(create(cid, { expiresAt: Date.now() + 3600_000 }));
    await fails(accept(cid, short, TESTER2, makeDeps(2 * 3600_000)), 'INVITE_EXPIRED', 'failed-precondition');
    expect((await ivDoc(cid, short.ivId)).status).toBe('open');
    expect((await staffSnap(cid, 'tester2')).exists).toBe(false);
  });

  it('接受時再檢查：取消、下架、刪除中、已結束（含管理員、寬限內）各自錯誤；staff 不建、invite 仍 open', async () => {
    const iv = await ok<Created>(create(cid));
    const ref = adminDb().doc(`competitions/${cid}`);
    const check = async (reason: string, who: Who = TESTER3) => {
      await fails(accept(cid, iv, who), reason, 'failed-precondition');
      expect((await staffSnap(cid, who.uid)).exists).toBe(false);
      expect((await ivDoc(cid, iv.ivId)).status).toBe('open');
      expect((await adminDb().doc(`cpMine/${who.uid}/items/${cid}`).get()).exists).toBe(false);
    };
    await ref.update({ status: 'cancelled' });
    await check('COMPETITION_CLOSED');
    await ref.update({ status: 'published', hidden: true });
    await check('COMPETITION_HIDDEN');
    await check('COMPETITION_HIDDEN', ADMIN);
    await ref.update({ hidden: false, deletingAt: new Date() });
    await check('COMPETITION_DELETING');
    await ref.update({ deletingAt: null, endedAt: new Date(), endedBy: 'confirm' });
    await check('COMPETITION_ENDED');
    await check('COMPETITION_ENDED', ADMIN);
    await ref.update({ endedAt: null, endedBy: null });
    await ok(accept(cid, iv));
  });

  it('已是記分員再接受另一張：角色與場次合併、memberNo 與 staffSeq 不變；主辦接受自己的邀請保留 host', async () => {
    const first = await ok<Created>(create(cid, { roles: ['scorer'], matchIds: [MT], expiresAt: Date.now() + 2 * DAY }));
    await ok(accept(cid, first));
    expect((await staffSnap(cid, 'tester3')).get('displayName')).toBe('路人丁');
    // 再接受時顯示名更新成主庫最新值（Opus 審：原本沒有斷言）
    await adminDb(MAIN).doc('users/tester3').set({ displayName: '路人丁改名' }, { merge: true });
    const second = await ok<Created>(create(cid, { roles: ['referee'], matchIds: [MT2, MT] }));
    const r = await ok<{ roles: string[]; matchCount: number }>(accept(cid, second));
    expect(r).toMatchObject({ roles: ['scorer', 'referee'], matchCount: 2 });
    const s = (await staffSnap(cid, 'tester3')).data()!;
    expect(s.roles).toEqual(['scorer', 'referee']);
    expect(s.matchIds).toEqual([MT, MT2]);
    // 顧問「已有的不動」（Opus 審 P2）：原本有效的指派到期維持第一張的，不被第二張延長
    expect(s.expiresAt.toMillis()).toBe(first.expiresAt);
    expect(s.displayName).toBe('路人丁改名');
    expect(s.memberNo).toBe(2);
    expect((await compDoc(cid)).staffSeq).toBe(2);
    expect((await ivDoc(cid, second.ivId)).usedMemberNo).toBe(2);
    expect((await adminDb().doc(`cpMine/tester3/items/${cid}`).get()).get('roles')).toEqual(['scorer', 'referee']);

    const own = await ok<Created>(create(cid, { roles: ['scorer'], matchIds: [MT] }));
    await ok(accept(cid, own, TESTER));
    const host = (await staffSnap(cid, 'tester')).data()!;
    expect(host.roles).toEqual(['host', 'scorer']);
    expect(host.memberNo).toBe(1);
    // 主辦建賽時 expiresAt 為 null（不是記分指派），接受後改用邀請到期
    expect(host.expiresAt.toMillis()).toBe(own.expiresAt);
    expect((await compDoc(cid)).staffSeq).toBe(2);
    expect((await ivDoc(cid, own.ivId)).usedMemberNo).toBe(1);
    const mine = (await adminDb().doc(`cpMine/tester/items/${cid}`).get()).data()!;
    expect(mine.roles).toEqual(['host', 'scorer']);
    expect(mine.host).toBe(true);
  });

  it('原本的記分指派已過期：接受新邀請時舊場次不復活，場次與到期只用邀請的（Opus 審 P2）', async () => {
    const first = await ok<Created>(create(cid, { roles: ['scorer'], matchIds: [MT] }));
    await ok(accept(cid, first));
    await adminDb().doc(`competitions/${cid}/staff/tester3`).update({ expiresAt: new Date(Date.now() - 60_000) });
    const second = await ok<Created>(create(cid, { roles: ['referee'], matchIds: [MT2] }));
    const r = await ok<{ roles: string[]; matchCount: number }>(accept(cid, second));
    expect(r).toMatchObject({ roles: ['referee'], matchCount: 1 });
    const st = (await staffSnap(cid, 'tester3')).data()!;
    expect(st.roles).toEqual(['referee']);
    expect(st.matchIds).toEqual([MT2]);
    expect(st.expiresAt.toMillis()).toBe(second.expiresAt);
    expect((await adminDb().doc(`cpMine/tester3/items/${cid}`).get()).get('roles')).toEqual(['referee']);
  });

  it('只有接受邀請會寫顯示名：主辦用 assignStaff 指派自己不寫 displayName', async () => {
    await ok(call(handleCpHost, TESTER, { action: 'assignStaff', cid, uid: 'tester', roles: ['scorer'], matchIds: [MT] }));
    const host = (await staffSnap(cid, 'tester')).data()!;
    expect(host.roles).toEqual(['host', 'scorer']);
    expect('displayName' in host).toBe(false);
  });

  it('已結束的賽事不能建立邀請（管理員也一樣，Opus 審 P3-3）', async () => {
    await adminDb().doc(`competitions/${cid}`).update({ endedAt: new Date(), endedBy: 'confirm' });
    await fails(create(cid, {}, ADMIN), 'COMPETITION_ENDED', 'failed-precondition');
    await fails(create(cid), 'COMPETITION_ENDED', 'failed-precondition');
    expect((await compDoc(cid)).inviteSeq ?? 0).toBe(0);
  });

  it('顯示名含禁用字或空 → displayName null', async () => {
    await setBannedWords(['官方']);
    await adminDb(MAIN).doc('users/tester3').set({ displayName: '官 方記分員' });
    await adminDb(MAIN).doc('users/tester2').set({ displayName: '   ' });
    const a = await ok<Created>(create(cid));
    const b = await ok<Created>(create(cid));
    await ok(accept(cid, a, TESTER3));
    await ok(accept(cid, b, TESTER2));
    expect((await staffSnap(cid, 'tester3')).get('displayName')).toBeNull();
    expect((await staffSnap(cid, 'tester2')).get('displayName')).toBeNull();
    expect((await staffSnap(cid, 'tester2')).get('memberNo')).toBe(3);
  });

  it('撤銷：主辦與共同主辦可撤；非主辦 NOT_HOST；已使用 INVITE_NOT_OPEN；不存在 INVITE_NOT_FOUND；稽核', async () => {
    const a = await ok<Created>(create(cid));
    await fails(revoke(cid, a.ivId, TESTER3), 'NOT_HOST', 'permission-denied');
    const r = await ok<{ ivId: string; status: string }>(revoke(cid, a.ivId));
    expect(r).toEqual({ ivId: a.ivId, status: 'revoked' });
    expect((await ivDoc(cid, a.ivId)).status).toBe('revoked');
    await fails(revoke(cid, a.ivId), 'INVITE_NOT_OPEN', 'failed-precondition');

    await adminDb().doc(`competitions/${cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [], expiresAt: null });
    const b = await ok<Created>(create(cid));
    await ok(revoke(cid, b.ivId, TESTER2));

    const c = await ok<Created>(create(cid));
    await ok(accept(cid, c));
    await fails(revoke(cid, c.ivId), 'INVITE_NOT_OPEN', 'failed-precondition');
    expect((await ivDoc(cid, c.ivId)).status).toBe('used');
    await fails(revoke(cid, 'iv_' + 'n'.repeat(20)), 'INVITE_NOT_FOUND', 'not-found');
    await fails(revoke(cid, 'bad'), 'BAD_ID', 'invalid-argument');

    const audits = await adminDb().collection(`competitions/${cid}/audits`).where('action', '==', 'revokeInvite').get();
    expect(audits.docs.map(x => x.get('details').ivId).sort()).toEqual([a.ivId, b.ivId].sort());
  });

  it('ReadMeter：createInvite＝閘門 2＋賽事 1＋主辦 1＋場次 n；acceptInvite ≤7', async () => {
    const c0 = new ReadMeter();
    await ok(create(cid, { matchIds: [] }, TESTER, makeDeps(0, c0)));
    expect(c0.reads).toBe(4);
    const c2 = new ReadMeter();
    const iv = await ok<Created>(create(cid, { matchIds: [MT, MT2] }, TESTER, makeDeps(0, c2)));
    expect(c2.reads).toBe(6);
    expect(c2.reads).toBeLessThanOrEqual(2 + 1 + 2 + 2);

    const a = new ReadMeter();
    await ok(accept(cid, iv, TESTER3, makeDeps(0, a)));
    expect(a.reads).toBe(7);
    expect(a.reads).toBeLessThanOrEqual(7);

    // 代碼錯：閘門 2＋賽事 1＋邀請 1，不讀 staff／users／cpMine
    const bad = new ReadMeter();
    const iv2 = await ok<Created>(create(cid));
    await fails(accept(cid, { ivId: iv2.ivId, code: 'A'.repeat(22) }, TESTER3, makeDeps(0, bad)), 'INVITE_INVALID');
    expect(bad.reads).toBe(4);

    // 管理員接受：閘門 1
    const adm = new ReadMeter();
    await ok(accept(cid, iv2, ADMIN, makeDeps(0, adm)));
    expect(adm.reads).toBe(6);
  });
});

describe('CP-PO-04 共同主辦邀請', () => {
  let cid = '';

  beforeEach(async () => {
    await resetAll();
    cid = await setup();
  });
  afterEach(() => closeClients());

  const createCoHost = (over: Record<string, unknown> = {}, who: Who = TESTER) =>
    call(handleCpHost, who, { action: 'createInvite', cid, roles: ['coHost'], ...over });

  async function setupClub() {
    const created = await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput({ hostType: 'club', hostTeamId: 'club_a', name: '【測試】俱樂部盃' })));
    const ccid = created.cid;
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid: ccid }));
    // 不切換 isPublic（內部期建立的賽事公開後會被 INTERNAL_COMPETITION 擋）；改把 stranger 登記為測試者
    await adminDb().doc('cpConfig/launch/testers/stranger').set({ addedAt: new Date() });
    return ccid;
  }

  it('主辦建立 coHost 成功、形狀正確、issuer=host；共同主辦 NOT_PRIMARY_HOST；陌生人 NOT_HOST；帶 matchIds FIELD_RANGE；失敗不改 inviteSeq', async () => {
    const iv = await ok<Created>(createCoHost());
    const d = await ivDoc(cid, iv.ivId);
    expect(Object.keys(d).sort()).toEqual(['codeHash', 'createdAt', 'createdBy', 'expiresAt', 'issuer', 'matchIds', 'roles', 'status', 'updatedAt']);
    expect(d.issuer).toBe('host');
    expect(d.roles).toEqual(['coHost']);
    expect(d.matchIds).toEqual([]);
    expect(d.createdBy).toBe(actorHash(cid, 'tester'));

    const seqBefore = (await compDoc(cid)).inviteSeq ?? 0;

    // 共同主辦 → NOT_PRIMARY_HOST
    await adminDb().doc(`competitions/${cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [], expiresAt: null });
    await fails(createCoHost({}, TESTER2), 'NOT_PRIMARY_HOST', 'permission-denied');

    // 沒有 staff 的測試者 → NOT_HOST
    await fails(createCoHost({}, TESTER3), 'NOT_HOST', 'permission-denied');

    // 帶 matchIds → FIELD_RANGE
    await fails(createCoHost({ matchIds: [MT] }), 'FIELD_RANGE');

    // 失敗不改 inviteSeq（成功那次 +1 之後沒再變）
    expect(((await compDoc(cid)).inviteSeq ?? 0)).toBe(seqBefore);
  });

  it('共同主辦撤 coHost 邀請 NOT_PRIMARY_HOST 且仍 open；可撤記分員邀請；主辦可撤 coHost', async () => {
    const coIv = await ok<Created>(createCoHost());
    const scIv = await ok<Created>(create(cid));
    await adminDb().doc(`competitions/${cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [], expiresAt: null });

    await fails(call(handleCpHost, TESTER2, { action: 'revokeInvite', cid, ivId: coIv.ivId }), 'NOT_PRIMARY_HOST', 'permission-denied');
    expect((await ivDoc(cid, coIv.ivId)).status).toBe('open');

    await ok(call(handleCpHost, TESTER2, { action: 'revokeInvite', cid, ivId: scIv.ivId }));
    expect((await ivDoc(cid, scIv.ivId)).status).toBe('revoked');

    await ok(revoke(cid, coIv.ivId));
    expect((await ivDoc(cid, coIv.ivId)).status).toBe('revoked');
  });

  it('一般會員接受：staff roles [coHost]、coHostCount 1、邀請 used、cpMine roles 含 coHost；之後發 coHost 邀請 NOT_PRIMARY_HOST、發記分員邀請成功', async () => {
    const iv = await ok<Created>(createCoHost());
    await ok(accept(cid, iv, TESTER3));

    const s = (await staffSnap(cid, 'tester3')).data()!;
    expect(s.roles).toEqual(['coHost']);
    expect(s.matchIds).toEqual([]);
    expect(s.expiresAt).toBeNull();
    expect(s.memberNo).toBe(2);
    expect(s.displayName).toBe('路人丁');
    expect((await compDoc(cid)).coHostCount).toBe(1);
    expect((await ivDoc(cid, iv.ivId)).status).toBe('used');
    expect((await adminDb().doc(`cpMine/tester3/items/${cid}`).get()).get('roles')).toEqual(['coHost']);

    await fails(createCoHost({}, TESTER3), 'NOT_PRIMARY_HOST', 'permission-denied');
    await ok(create(cid, {}, TESTER3));
  });

  it('主辦 removeStaff roles [coHost]：staff 刪除、coHostCount 0、之後他 createInvite NOT_HOST', async () => {
    const iv = await ok<Created>(createCoHost());
    await ok(accept(cid, iv, TESTER3));
    expect((await staffSnap(cid, 'tester3')).exists).toBe(true);
    expect((await compDoc(cid)).coHostCount).toBe(1);

    await ok(call(handleCpHost, TESTER, { action: 'removeStaff', cid, uid: 'tester3', roles: ['coHost'] }));
    expect((await staffSnap(cid, 'tester3')).exists).toBe(false);
    expect((await compDoc(cid)).coHostCount).toBe(0);

    await fails(createCoHost({}, TESTER3), 'NOT_HOST', 'permission-denied');
  });

  it('同代碼再接受 INVITE_USED；撤銷後 INVITE_REVOKED；錯碼 INVITE_INVALID；都不建 staff、計數不變', async () => {
    const iv = await ok<Created>(createCoHost());
    const wrong = iv.code.slice(0, 21) + (iv.code.endsWith('A') ? 'B' : 'A');
    await fails(call(handleCpParticipant, TESTER2, { action: 'acceptInvite', cid, ivId: iv.ivId, code: wrong }), 'INVITE_INVALID', 'not-found');
    expect((await staffSnap(cid, 'tester2')).exists).toBe(false);
    expect(((await compDoc(cid)).coHostCount ?? 0)).toBe(0);

    const rv = await ok<Created>(createCoHost());
    await ok(revoke(cid, rv.ivId));
    await fails(accept(cid, rv, TESTER2), 'INVITE_REVOKED', 'failed-precondition');
    expect((await staffSnap(cid, 'tester2')).exists).toBe(false);

    const used = await ok<Created>(createCoHost());
    await ok(accept(cid, used, TESTER3));
    await fails(accept(cid, used, TESTER2), 'INVITE_USED', 'failed-precondition');
    expect((await staffSnap(cid, 'tester2')).exists).toBe(false);
    expect((await compDoc(cid)).coHostCount).toBe(1);
  });

  it('主辦本人接受 ALREADY_HOST（邀請仍 open）；管理員接受 ALREADY_HOST', async () => {
    const iv = await ok<Created>(createCoHost());
    await fails(accept(cid, iv, TESTER), 'ALREADY_HOST', 'failed-precondition');
    expect((await ivDoc(cid, iv.ivId)).status).toBe('open');
    await fails(accept(cid, iv, ADMIN), 'ALREADY_HOST', 'failed-precondition');
    expect((await ivDoc(cid, iv.ivId)).status).toBe('open');
  });

  it('已是 coHost 再接受另一張 ALREADY_COHOST，另一張維持 open', async () => {
    const a = await ok<Created>(createCoHost());
    const b = await ok<Created>(createCoHost());
    await ok(accept(cid, a, TESTER3));
    await fails(accept(cid, b, TESTER3), 'ALREADY_COHOST', 'failed-precondition');
    expect((await ivDoc(cid, b.ivId)).status).toBe('open');
    expect((await compDoc(cid)).coHostCount).toBe(1);
  });

  it('記分員（已有 scorer＋matchIds）接受 coHost 邀請：roles [coHost, scorer]、matchIds 不變、memberNo 不動', async () => {
    await adminDb().doc(`competitions/${cid}/staff/tester3`).set({ roles: ['scorer'], matchIds: [MT], expiresAt: null, memberNo: 5 });
    const iv = await ok<Created>(createCoHost());
    const r = await ok<{ roles: string[]; matchCount: number }>(accept(cid, iv, TESTER3));
    expect(r.roles).toEqual(['coHost', 'scorer']);
    expect(r.matchCount).toBe(1);
    const s = (await staffSnap(cid, 'tester3')).data()!;
    expect(s.roles).toEqual(['coHost', 'scorer']);
    expect(s.matchIds).toEqual([MT]);
    expect(s.memberNo).toBe(5);
    expect((await compDoc(cid)).coHostCount).toBe(1);
    expect((await adminDb().doc(`cpMine/tester3/items/${cid}`).get()).get('roles')).toEqual(['coHost', 'scorer']);
  });

  it('三人接受後第 4 人 COHOST_LIMIT、主辦再建立 COHOST_LIMIT；移除一人後可再接受', async () => {
    for (const t of ['stranger', 'extra1']) await adminDb().doc(`cpConfig/launch/testers/${t}`).set({ addedAt: new Date() });
    const EXTRA: Who = { uid: 'extra1' };
    await adminDb(MAIN).doc('users/extra1').set({ displayName: '額外一' });

    const a = await ok<Created>(createCoHost());
    const b = await ok<Created>(createCoHost());
    const c = await ok<Created>(createCoHost());
    const d = await ok<Created>(createCoHost());
    await ok(accept(cid, a, TESTER2));
    await ok(accept(cid, b, TESTER3));
    await ok(accept(cid, c, STRANGER));
    expect((await compDoc(cid)).coHostCount).toBe(3);

    const out = await accept(cid, d, EXTRA);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatchObject({ code: 'resource-exhausted', reason: 'COHOST_LIMIT', params: { max: 3 } });

    await fails(createCoHost(), 'COHOST_LIMIT', 'resource-exhausted');

    await ok(call(handleCpHost, TESTER, { action: 'removeStaff', cid, uid: 'tester2', roles: ['coHost'] }));
    expect((await compDoc(cid)).coHostCount).toBe(2);

    await ok(accept(cid, d, EXTRA));
    expect((await compDoc(cid)).coHostCount).toBe(3);
  });

  it('俱樂部：代表發邀請 issuer=clubRep、第三人接受成功、代表接受 ALREADY_HOST、換代表後舊代表邀請 INVITE_ISSUER_GONE', async () => {
    const ccid = await setupClub();
    const iv = await ok<Created>(call(handleCpHost, TESTER, { action: 'createInvite', cid: ccid, roles: ['coHost'] }));
    const d = await ivDoc(ccid, iv.ivId);
    expect(d.issuer).toBe('clubRep');

    // 第三人接受成功
    await ok(call(handleCpParticipant, TESTER3, { action: 'acceptInvite', cid: ccid, ivId: iv.ivId, code: iv.code }));
    expect((await staffSnap(ccid, 'tester3')).get('roles')).toEqual(['coHost']);
    expect((await adminDb().doc(`competitions/${ccid}`).get()).get('coHostCount')).toBe(1);

    // 代表接受自己的邀請 → ALREADY_HOST
    const iv2 = await ok<Created>(call(handleCpHost, TESTER, { action: 'createInvite', cid: ccid, roles: ['coHost'] }));
    await fails(call(handleCpParticipant, TESTER, { action: 'acceptInvite', cid: ccid, ivId: iv2.ivId, code: iv2.code }), 'ALREADY_HOST', 'failed-precondition');

    // 舊代表發的邀請在換代表後失效
    const iv3 = await ok<Created>(call(handleCpHost, TESTER, { action: 'createInvite', cid: ccid, roles: ['coHost'] }));
    await adminDb().doc('cpClubs/club_a').update({ repUids: ['tester2'] });
    await fails(call(handleCpParticipant, STRANGER, { action: 'acceptInvite', cid: ccid, ivId: iv3.ivId, code: iv3.code }), 'INVITE_ISSUER_GONE', 'failed-precondition');
    expect((await adminDb().doc(`competitions/${ccid}`).get()).get('coHostCount')).toBe(1);
  });

  it('ReadMeter：個人接受 ≤ 7、俱樂部 ≤ 8', async () => {
    const iv = await ok<Created>(createCoHost());
    const m = new ReadMeter();
    await ok(accept(cid, iv, TESTER3, makeDeps(0, m)));
    expect(m.reads).toBeLessThanOrEqual(7);

    const ccid = await setupClub();
    const civ = await ok<Created>(call(handleCpHost, TESTER, { action: 'createInvite', cid: ccid, roles: ['coHost'] }));
    const cm = new ReadMeter();
    await ok(call(handleCpParticipant, TESTER3, { action: 'acceptInvite', cid: ccid, ivId: civ.ivId, code: civ.code }, makeDeps(0, cm)));
    expect(cm.reads).toBeLessThanOrEqual(8);
  });

  it('共同主辦不得刪賽、不得移除另一位共同主辦；非整數 expiresAt → FIELD_RANGE（Opus 審 P3）', async () => {
    await ok(accept(cid, await ok<Created>(createCoHost()), TESTER2));
    await ok(accept(cid, await ok<Created>(createCoHost()), TESTER3));
    expect((await compDoc(cid)).coHostCount).toBe(2);
    await fails(call(handleCpHost, TESTER2, { action: 'delete', cid }), 'NOT_PRIMARY_HOST', 'permission-denied');
    await fails(call(handleCpHost, TESTER2, { action: 'removeStaff', cid, uid: 'tester3', roles: ['coHost'] }), 'FORBIDDEN', 'permission-denied');
    expect((await compDoc(cid)).coHostCount).toBe(2);
    expect((await staffSnap(cid, 'tester3')).get('roles')).toEqual(['coHost']);
    await fails(createCoHost({ expiresAt: 1.5 }), 'FIELD_RANGE');
    await fails(createCoHost({ expiresAt: 'x' }), 'FIELD_RANGE');
  });

  it('coHost＋scorer 的人被移除記分角色：coHost 保留、計數不變、cpMine 仍含 coHost', async () => {
    await adminDb().doc(`competitions/${cid}/staff/tester3`).set({ roles: ['scorer'], matchIds: [MT], expiresAt: null, memberNo: 5 });
    await ok(accept(cid, await ok<Created>(createCoHost()), TESTER3));
    await ok(call(handleCpHost, TESTER, { action: 'removeStaff', cid, uid: 'tester3', roles: ['scorer'] }));
    expect((await staffSnap(cid, 'tester3')).get('roles')).toEqual(['coHost']);
    expect((await compDoc(cid)).coHostCount).toBe(1);
    expect((await adminDb().doc(`cpMine/tester3/items/${cid}`).get()).get('roles')).toEqual(['coHost']);
  });

  it('計數 2 時兩人同時接受：只成功一位、計數 3（交易序列化）', async () => {
    const a = await ok<Created>(createCoHost());
    const b = await ok<Created>(createCoHost());
    await adminDb().doc(`competitions/${cid}`).update({ coHostCount: 2 });
    const [ra, rb] = await Promise.all([accept(cid, a, TESTER2), accept(cid, b, TESTER3)]);
    expect([ra.ok, rb.ok].filter(Boolean).length).toBe(1);
    const failed = ra.ok ? rb : ra;
    if (!failed.ok) expect(failed.error).toMatchObject({ reason: 'COHOST_LIMIT' });
    expect((await compDoc(cid)).coHostCount).toBe(3);
  });
});
