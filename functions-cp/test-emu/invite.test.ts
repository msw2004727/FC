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
    await fails(create(cid, { roles: ['coHost'] }), 'FIELD_ENUM');
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
    const second = await ok<Created>(create(cid, { roles: ['referee'], matchIds: [MT2, MT] }));
    const r = await ok<{ roles: string[]; matchCount: number }>(accept(cid, second));
    expect(r).toMatchObject({ roles: ['scorer', 'referee'], matchCount: 2 });
    const s = (await staffSnap(cid, 'tester3')).data()!;
    expect(s.roles).toEqual(['scorer', 'referee']);
    expect(s.matchIds).toEqual([MT, MT2]);
    expect(s.expiresAt.toMillis()).toBe(second.expiresAt);
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
