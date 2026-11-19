/**
 * K2 主辦最小指派（模擬器，寫好由 PM 跑）：assignStaff、removeStaff。
 * 接手與記一筆走用戶端 SDK＋asia-main Rules（test-emu 已有 clientDb，同 e2e-step2）。
 * 不改 Rules、不刪 control/scorer。
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { actorHash, ReadMeter } from '../src/cp/context.js';
import { handleCpHost } from '../src/cp/host.js';
import { assignedDataOk } from '../src/cp/staff-host.js';
import { adminDb, assertFails, assertSucceeds, clientDb, closeClients } from '../test-rules/_harness.js';
import { ADMIN, DAY, TESTER, TESTER2, TESTER3, call, createInput, fails, makeDeps, ok, resetAll } from './_cp.js';

const MT = 'mt_' + 'a'.repeat(20);
/** 契約上限：閘門 ≤2＋賽事 1＋主辦判斷 ≤2＋對象 staff 1＋cpMine 1＋場次 n。
 * K10 staffSeq 用已讀的賽事文件，+0 讀，這個上限與下面的實測讀數都不變。 */
const assignBudget = (n: number) => 2 + 1 + 2 + 1 + 1 + n;
/** 閘門 ≤2＋賽事 1＋主辦判斷 ≤2＋對象 staff 1＋cpMine 1。K10 不改這個上限。 */
const REMOVE_BUDGET = 2 + 1 + 2 + 1 + 1;

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

async function setup() {
  const created = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER, createInput()));
  const cid = created.cid;
  const dvId = created.dvIds[0];
  await ok(call(handleCpHost, TESTER, { action: 'publish', cid }));
  await adminDb().doc(`competitions/${cid}/matches/${MT}`).set(matchBody(MT, dvId));
  return { cid, dvId };
}

function assign(cid: string, over: Record<string, unknown> = {}, who = TESTER, deps = makeDeps()) {
  return call(handleCpHost, who, {
    action: 'assignStaff', cid, uid: who.uid, roles: ['scorer'], matchIds: [MT], ...over
  }, deps);
}

describe('K2 assignStaff／removeStaff', () => {
  let cid = '';

  beforeEach(async () => {
    await resetAll();
    cid = (await setup()).cid;
  });
  afterEach(() => closeClients());

  it('主辦指派自己為記分員：staff、cpMine、稽核；用戶端可接手並記開賽', async () => {
    const r = await ok<{ roles: string[]; matchCount: number; expiresAt: number }>(assign(cid));
    expect(r).toMatchObject({ roles: ['host', 'scorer'], matchCount: 1 });
    const comp = (await adminDb().doc(`competitions/${cid}`).get()).data()!;
    expect(r.expiresAt).toBe(comp.lastMatchAt.toMillis() + 7 * DAY);

    const staff = (await adminDb().doc(`competitions/${cid}/staff/tester`).get()).data()!;
    expect(staff.roles).toEqual(['host', 'scorer']);
    expect(staff.matchIds).toEqual([MT]);
    expect(staff.expiresAt.toMillis()).toBe(r.expiresAt);
    expect(assignedDataOk({
      roles: staff.roles, matchIds: staff.matchIds, expiresAtMs: staff.expiresAt.toMillis()
    }, MT, Date.now())).toBe(true);

    const mine = (await adminDb().doc(`cpMine/tester/items/${cid}`).get()).data()!;
    expect(mine.roles).toEqual(['host', 'scorer']);
    expect(mine.host).toBe(true);

    const audits = await adminDb().collection(`competitions/${cid}/audits`).where('action', '==', 'assignStaff').get();
    expect(audits.size).toBe(1);
    const audit = audits.docs[0].data();
    expect(audit.actor).toBe(actorHash(cid, 'tester'));
    expect(audit.details).toEqual({ target: actorHash(cid, 'tester'), roles: ['scorer'], matchCount: 1 });
    expect(audit.details.target).not.toBe('tester');

    const db = clientDb({ uid: 'tester' });
    const base = `competitions/${cid}/matches/${MT}`;
    // 整合分支（K1 Rules）：接手要帶 sid，記分事件要帶 sid、op（K1 事件形狀）
    const SID = 'k2-integ-sid-device01';
    await assertSucceeds(setDoc(doc(db, `${base}/control/scorer`), { uid: 'tester', takenAt: serverTimestamp(), sid: SID }));
    const batch = writeBatch(db);
    batch.update(doc(db, base), { rev: 1, status: 'live', updatedAt: serverTimestamp() });
    batch.set(doc(db, `${base}/timeline/e1`), {
      seq: 1, type: 'kickoff', matchSecond: 0, createdAt: serverTimestamp(), sid: SID, op: 'op-k2-0001'
    });
    await assertSucceeds(batch.commit());
    expect((await adminDb().doc(`${base}/timeline/e1`).get()).get('type')).toBe('kickoff');
    expect((await adminDb().doc(`${base}`).get()).get('status')).toBe('live');

    // 改成只留裁判：scorer 拿掉，host 還在
    await ok(assign(cid, { roles: ['referee'] }));
    expect((await adminDb().doc(`competitions/${cid}/staff/tester`).get()).get('roles')).toEqual(['host', 'referee']);
    expect((await adminDb().doc(`cpMine/tester/items/${cid}`).get()).get('roles')).toEqual(['host', 'referee']);

    // 空場次＝取消所有場次指派，接手被 Rules 拒絕
    await ok(assign(cid, { roles: ['scorer'], matchIds: [] }));
    const cleared = (await adminDb().doc(`competitions/${cid}/staff/tester`).get()).data()!;
    expect(cleared.roles).toEqual(['host', 'scorer']);
    expect(cleared.matchIds).toEqual([]);
    expect(assignedDataOk({
      roles: cleared.roles, matchIds: cleared.matchIds, expiresAtMs: cleared.expiresAt.toMillis()
    }, MT, Date.now())).toBe(false);
    // 帶齊 sid：被拒的原因只剩「沒有本場指派」
    await assertFails(setDoc(doc(db, `${base}/control/scorer`), { uid: 'tester', takenAt: serverTimestamp(), sid: SID }));
  });

  it('指派不存在的 uid、別場賽事的場次、多帶鍵、壞角色、過期、超過 100 場被拒', async () => {
    await fails(assign(cid, { uid: 'nobody' }), 'STAFF_NOT_FOUND', 'not-found');
    const other = await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput({ name: '【測試】另一盃' })));
    const foreign = 'mt_' + 'c'.repeat(20);
    await adminDb().doc(`competitions/${other.cid}/matches/${foreign}`).set({ status: 'scheduled', rev: 0 });
    await fails(assign(cid, { matchIds: [foreign] }), 'MATCH_NOT_FOUND', 'not-found');
    await fails(assign(cid, { note: 'x' }), 'UNKNOWN_FIELD');
    await fails(assign(cid, { roles: ['host'] }), 'FIELD_ENUM');
    await fails(assign(cid, { roles: ['scorer', 'scorer'] }), 'FIELD_DUPLICATE');
    await fails(assign(cid, { matchIds: [MT, MT] }), 'FIELD_DUPLICATE');
    await fails(assign(cid, { expiresAt: Date.now() - DAY }), 'FIELD_RANGE');
    const tooMany = Array.from({ length: 101 }, (_, i) => 'mt_' + String(i).padStart(20, 'b'));
    await fails(assign(cid, { matchIds: tooMany }), 'FIELD_RANGE');
    await fails(call(handleCpHost, TESTER, { action: 'removeStaff', cid, uid: 'tester', extra: 1 }), 'UNKNOWN_FIELD');
  });

  it('共同主辦可指派既有 staff；非主辦被拒', async () => {
    // 對象是純記分員。主辦與其他共同主辦由記分守門擋下，不在這條。
    await adminDb().doc(`competitions/${cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [], expiresAt: null });
    await adminDb().doc(`competitions/${cid}/staff/tester3`).set({ roles: ['scorer'], matchIds: [], expiresAt: null });
    await ok(assign(cid, { uid: 'tester3', roles: ['referee'] }, TESTER2));
    expect((await adminDb().doc(`competitions/${cid}/staff/tester3`).get()).get('roles')).toEqual(['referee']);
    expect((await adminDb().doc(`cpMine/tester3/items/${cid}`).get()).get('roles')).toEqual(['referee']);
    await fails(assign(cid, { uid: 'tester3' }, TESTER3), 'NOT_HOST', 'permission-denied');
  });

  it('取消、下架、結束後主辦不能指派', async () => {
    const db = adminDb();
    await db.doc(`competitions/${cid}`).update({ status: 'cancelled' });
    await fails(assign(cid), 'COMPETITION_CLOSED', 'failed-precondition');
    await db.doc(`competitions/${cid}`).update({ status: 'published', hidden: true });
    await fails(assign(cid), 'COMPETITION_HIDDEN', 'failed-precondition');
    await db.doc(`competitions/${cid}`).update({ hidden: false, endedAt: new Date(), endedBy: 'host' });
    await fails(assign(cid), 'COMPETITION_ENDED', 'failed-precondition');
  });

  it('removeStaff：純記分員文件與 cpMine 刪除；主辦角色受保護；共同主辦不能移除共同主辦；不刪 control/scorer', async () => {
    const db = adminDb();
    await ok(assign(cid));
    await db.doc(`competitions/${cid}/matches/${MT}/control/scorer`).set({ uid: 'tester', takenAt: new Date() });
    await ok(call(handleCpHost, TESTER, { action: 'removeStaff', cid, uid: 'tester' }));
    const hostStaff = (await db.doc(`competitions/${cid}/staff/tester`).get()).data()!;
    expect(hostStaff.roles).toEqual(['host']);
    expect(hostStaff.matchIds).toEqual([]);
    expect(hostStaff.expiresAt).toBeNull();
    expect((await db.doc(`cpMine/tester/items/${cid}`).get()).get('roles')).toEqual(['host']);
    expect((await db.doc(`competitions/${cid}/matches/${MT}/control/scorer`).get()).exists).toBe(true);

    await fails(call(handleCpHost, TESTER, { action: 'removeStaff', cid, uid: 'tester', roles: ['host'] }), 'STAFF_PROTECTED', 'failed-precondition');
    expect((await db.doc(`competitions/${cid}/staff/tester`).get()).get('roles')).toEqual(['host']);

    await db.doc(`competitions/${cid}/staff/tester3`).set({ roles: ['scorer'], matchIds: [MT], expiresAt: null });
    await db.doc(`cpMine/tester3/items/${cid}`).set({
      cid, name: '【測試】週末盃', roles: ['scorer'], host: false, entryIds: [], plIds: [], category: 'league',
      firstMatchAt: new Date()
    });
    const removed = await ok<{ deleted: boolean; roles: string[] }>(
      call(handleCpHost, TESTER, { action: 'removeStaff', cid, uid: 'tester3' })
    );
    expect(removed).toMatchObject({ deleted: true, roles: [] });
    expect((await db.doc(`competitions/${cid}/staff/tester3`).get()).exists).toBe(false);
    expect((await db.doc(`cpMine/tester3/items/${cid}`).get()).exists).toBe(false);
    const rmAudits = await db.collection(`competitions/${cid}/audits`).where('action', '==', 'removeStaff').get();
    const targets = rmAudits.docs.map(d => d.get('details').target as string);
    expect(targets).toContain(actorHash(cid, 'tester3'));
    expect(targets.every(t => t !== 'tester3' && t !== 'tester')).toBe(true);

    await db.doc(`competitions/${cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [], expiresAt: null });
    await fails(
      call(handleCpHost, TESTER2, { action: 'removeStaff', cid, uid: 'tester2', roles: ['coHost'] }),
      'FORBIDDEN',
      'permission-denied'
    );
    expect((await db.doc(`competitions/${cid}/staff/tester2`).get()).exists).toBe(true);
    await ok(call(handleCpHost, TESTER, { action: 'removeStaff', cid, uid: 'tester2', roles: ['coHost'] }));
    expect((await db.doc(`competitions/${cid}/staff/tester2`).get()).exists).toBe(false);
  });

  it('ReadMeter：個人主辦指派自己、共同主辦指派別人、移除純記分員', async () => {
    const self = new ReadMeter();
    await ok(assign(cid, {}, TESTER, makeDeps(0, self)));
    expect(self.reads).toBe(6);
    expect(self.reads).toBeLessThanOrEqual(assignBudget(1));

    await adminDb().doc(`competitions/${cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [], expiresAt: null });
    // 對象是純記分員。指派主辦會被守門拒絕，成功路徑的讀數仍是 7。
    await adminDb().doc(`competitions/${cid}/staff/tester3`).set({ roles: ['scorer'], matchIds: [], expiresAt: null });
    const co = new ReadMeter();
    await ok(assign(cid, { uid: 'tester3', roles: ['scorer'] }, TESTER2, makeDeps(0, co)));
    expect(co.reads).toBe(7);
    expect(co.reads).toBeLessThanOrEqual(assignBudget(1));

    await adminDb().doc(`competitions/${cid}/staff/tester3`).set({ roles: ['referee'], matchIds: [MT], expiresAt: null });
    const rm = new ReadMeter();
    await ok(call(handleCpHost, TESTER, { action: 'removeStaff', cid, uid: 'tester3' }, makeDeps(0, rm)));
    expect(rm.reads).toBe(6);
    expect(rm.reads).toBeLessThanOrEqual(REMOVE_BUDGET);
  });

  it('俱樂部代表指派自己後移除，staff 與 cpMine 一起刪', async () => {
    const created = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER, createInput({
      name: '【測試】俱樂部盃', hostType: 'club', hostTeamId: 'club_a'
    })));
    const clubCid = created.cid;
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid: clubCid }));
    const mtId = 'mt_' + 'd'.repeat(20);
    await adminDb().doc(`competitions/${clubCid}/matches/${mtId}`).set(matchBody(mtId, created.dvIds[0]));
    const meter = new ReadMeter();
    await ok(call(handleCpHost, TESTER, {
      action: 'assignStaff', cid: clubCid, uid: 'tester', roles: ['scorer'], matchIds: [mtId]
    }, makeDeps(0, meter)));
    expect(meter.reads).toBe(7);
    expect(meter.reads).toBeLessThanOrEqual(assignBudget(1));
    expect((await adminDb().doc(`competitions/${clubCid}/staff/tester`).get()).get('roles')).toEqual(['scorer']);
    expect((await adminDb().doc(`cpMine/tester/items/${clubCid}`).get()).get('roles')).toEqual(['scorer']);

    const rm = new ReadMeter();
    await ok(call(handleCpHost, TESTER, { action: 'removeStaff', cid: clubCid, uid: 'tester' }, makeDeps(0, rm)));
    expect(rm.reads).toBe(6);
    expect(rm.reads).toBeLessThanOrEqual(REMOVE_BUDGET);
    expect((await adminDb().doc(`competitions/${clubCid}/staff/tester`).get()).exists).toBe(false);
    expect((await adminDb().doc(`cpMine/tester/items/${clubCid}`).get()).exists).toBe(false);
  });

  it('俱樂部共同主辦（非代表）指派另一個已有 staff 的人：scorer、改成只有 referee、移除後刪 cpMine', async () => {
    const created = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER, createInput({
      name: '【測試】共同主辦指派', hostType: 'club', hostTeamId: 'club_a'
    })));
    const clubCid = created.cid;
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid: clubCid }));
    const mtId = 'mt_' + 'e'.repeat(20);
    await adminDb().doc(`competitions/${clubCid}/matches/${mtId}`).set(matchBody(mtId, created.dvIds[0]));
    // tester 是目前代表。tester2 只靠 coHost 進來。tester3 已有 staff，沒有 host／報隊／球員索引。
    await adminDb().doc(`competitions/${clubCid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [], expiresAt: null });
    await adminDb().doc(`competitions/${clubCid}/staff/tester3`).set({ roles: [], matchIds: [], expiresAt: null });

    const asScorer = new ReadMeter();
    await ok(call(handleCpHost, TESTER2, {
      action: 'assignStaff', cid: clubCid, uid: 'tester3', roles: ['scorer'], matchIds: [mtId]
    }, makeDeps(0, asScorer)));
    expect(asScorer.reads).toBe(8);
    expect(asScorer.reads).toBeLessThanOrEqual(assignBudget(1));
    const scored = (await adminDb().doc(`cpMine/tester3/items/${clubCid}`).get()).data()!;
    expect(scored.roles).toEqual(['scorer']);
    expect(scored.host).toBe(false);

    const asRef = new ReadMeter();
    await ok(call(handleCpHost, TESTER2, {
      action: 'assignStaff', cid: clubCid, uid: 'tester3', roles: ['referee'], matchIds: [mtId]
    }, makeDeps(0, asRef)));
    expect(asRef.reads).toBe(8);
    expect(asRef.reads).toBeLessThanOrEqual(assignBudget(1));
    expect((await adminDb().doc(`cpMine/tester3/items/${clubCid}`).get()).get('roles')).toEqual(['referee']);
    expect((await adminDb().doc(`competitions/${clubCid}/staff/tester3`).get()).get('roles')).toEqual(['referee']);

    const rm = new ReadMeter();
    await ok(call(handleCpHost, TESTER2, { action: 'removeStaff', cid: clubCid, uid: 'tester3' }, makeDeps(0, rm)));
    expect(rm.reads).toBe(7);
    expect(rm.reads).toBeLessThanOrEqual(REMOVE_BUDGET);
    expect((await adminDb().doc(`cpMine/tester3/items/${clubCid}`).get()).exists).toBe(false);
    expect((await adminDb().doc(`competitions/${clubCid}/staff/tester3`).get()).exists).toBe(false);
  });

  it('共同主辦不得改主辦或其他共同主辦；主辦可以；管理員超過寬限仍可；守門不加讀', async () => {
    const db = adminDb();
    await ok(assign(cid, { roles: ['scorer', 'referee'], expiresAt: Date.now() + 10 * DAY }));
    const hostBefore = (await db.doc(`competitions/${cid}/staff/tester`).get()).data()!;

    await db.doc(`competitions/${cid}/staff/tester2`).set({
      roles: ['coHost', 'scorer'], matchIds: [], expiresAt: null
    });
    await db.doc(`competitions/${cid}/staff/tester3`).set({
      roles: ['coHost'], matchIds: [], expiresAt: null
    });

    const forbidAssign = new ReadMeter();
    await fails(
      assign(cid, { uid: 'tester', roles: ['referee'], matchIds: [] }, TESTER2, makeDeps(0, forbidAssign)),
      'FORBIDDEN',
      'permission-denied'
    );
    // 閘門 2＋賽事 1＋自己的 staff 1＋對象 staff 1。守門不再讀場次與 cpMine。
    expect(forbidAssign.reads).toBe(5);
    expect(forbidAssign.reads).toBeLessThanOrEqual(assignBudget(1));

    const forbidRemove = new ReadMeter();
    await fails(
      call(handleCpHost, TESTER2, { action: 'removeStaff', cid, uid: 'tester' }, makeDeps(0, forbidRemove)),
      'FORBIDDEN',
      'permission-denied'
    );
    expect(forbidRemove.reads).toBe(5);
    expect(forbidRemove.reads).toBeLessThanOrEqual(REMOVE_BUDGET);

    // 要移除 host 仍先 STAFF_PROTECTED，不是新守門的 FORBIDDEN。
    await fails(
      call(handleCpHost, TESTER2, { action: 'removeStaff', cid, uid: 'tester', roles: ['host'] }),
      'STAFF_PROTECTED',
      'failed-precondition'
    );

    const hostAfter = (await db.doc(`competitions/${cid}/staff/tester`).get()).data()!;
    expect(hostAfter.roles).toEqual(hostBefore.roles);
    expect(hostAfter.matchIds).toEqual(hostBefore.matchIds);
    expect(hostAfter.expiresAt.toMillis()).toBe(hostBefore.expiresAt.toMillis());
    expect(hostAfter.updatedAt.toMillis()).toBe(hostBefore.updatedAt.toMillis());

    await fails(
      assign(cid, { uid: 'tester3', roles: ['scorer'], matchIds: [MT] }, TESTER2),
      'FORBIDDEN',
      'permission-denied'
    );
    expect((await db.doc(`competitions/${cid}/staff/tester3`).get()).get('roles')).toEqual(['coHost']);
    expect((await db.doc(`competitions/${cid}/staff/tester3`).get()).get('matchIds')).toEqual([]);

    // 共同主辦改自己的記分指派仍可：coHost 留下，記分角色換成 referee。
    await ok(assign(cid, { uid: 'tester2', roles: ['referee'], matchIds: [MT] }, TESTER2));
    expect((await db.doc(`competitions/${cid}/staff/tester2`).get()).get('roles')).toEqual(['coHost', 'referee']);
    expect((await db.doc(`competitions/${cid}/staff/tester2`).get()).get('matchIds')).toEqual([MT]);

    await ok(assign(cid, { uid: 'tester3', roles: ['scorer'], matchIds: [MT] }, TESTER));
    const coHostB = (await db.doc(`competitions/${cid}/staff/tester3`).get()).data()!;
    expect(coHostB.roles).toEqual(['coHost', 'scorer']);
    expect(coHostB.matchIds).toEqual([MT]);

    await db.doc(`competitions/${cid}`).update({
      endedAt: new Date(Date.now() - 4 * DAY),
      endedBy: 'confirm'
    });
    await fails(assign(cid, { roles: ['referee'] }, TESTER), 'COMPETITION_ENDED', 'failed-precondition');
    await ok(assign(cid, { uid: 'tester', roles: ['referee'], matchIds: [MT] }, ADMIN));
    const hostByAdmin = (await db.doc(`competitions/${cid}/staff/tester`).get()).data()!;
    expect(hostByAdmin.roles).toEqual(['host', 'referee']);
    expect(hostByAdmin.matchIds).toEqual([MT]);
  });

  it('成員固定編號：主辦 1、新成員 2、移除後下一位 3、重指派不變', async () => {
    const db = adminDb();
    expect((await db.doc(`competitions/${cid}`).get()).get('staffSeq')).toBe(1);
    expect((await db.doc(`competitions/${cid}/staff/tester`).get()).get('memberNo')).toBe(1);

    // 已存在的主辦重指派：號碼不變，staffSeq 不前進，讀數仍是 6。
    const again = new ReadMeter();
    await ok(assign(cid, { roles: ['scorer', 'referee'] }, TESTER, makeDeps(0, again)));
    expect(again.reads).toBe(6);
    expect(again.reads).toBeLessThanOrEqual(assignBudget(1));
    expect((await db.doc(`competitions/${cid}/staff/tester`).get()).get('memberNo')).toBe(1);
    expect((await db.doc(`competitions/${cid}`).get()).get('staffSeq')).toBe(1);

    // 管理員指派自己：新文件。閘門 1＋賽事 1＋主辦 0＋staff 1＋cpMine 1＋場次 1＝5，仍在原上限內。
    const created = new ReadMeter();
    await ok(assign(cid, { uid: 'admin', roles: ['referee'] }, ADMIN, makeDeps(0, created)));
    expect(created.reads).toBe(5);
    expect(created.reads).toBeLessThanOrEqual(assignBudget(1));
    expect((await db.doc(`competitions/${cid}/staff/admin`).get()).get('memberNo')).toBe(2);
    expect((await db.doc(`competitions/${cid}`).get()).get('staffSeq')).toBe(2);

    const retouch = new ReadMeter();
    await ok(assign(cid, { uid: 'admin', roles: ['scorer'] }, ADMIN, makeDeps(0, retouch)));
    expect(retouch.reads).toBe(5);
    expect((await db.doc(`competitions/${cid}/staff/admin`).get()).get('memberNo')).toBe(2);
    expect((await db.doc(`competitions/${cid}`).get()).get('staffSeq')).toBe(2);

    await ok(call(handleCpHost, TESTER, { action: 'removeStaff', cid, uid: 'admin' }));
    expect((await db.doc(`competitions/${cid}/staff/admin`).get()).exists).toBe(false);
    expect((await db.doc(`competitions/${cid}`).get()).get('staffSeq')).toBe(2);

    await ok(assign(cid, { uid: 'admin', roles: ['scorer'] }, ADMIN));
    expect((await db.doc(`competitions/${cid}/staff/admin`).get()).get('memberNo')).toBe(3);
    expect((await db.doc(`competitions/${cid}`).get()).get('staffSeq')).toBe(3);
    expect((await db.doc(`competitions/${cid}/staff/tester`).get()).get('memberNo')).toBe(1);
  });

  it('缺 staffSeq 的舊賽事：新成員為 2；已存在的主辦重指派不補號', async () => {
    const db = adminDb();
    await db.doc(`competitions/${cid}`).update({ staffSeq: FieldValue.delete() });
    await db.doc(`competitions/${cid}/staff/tester`).update({ memberNo: FieldValue.delete() });

    const hostAgain = new ReadMeter();
    await ok(assign(cid, {}, TESTER, makeDeps(0, hostAgain)));
    expect(hostAgain.reads).toBe(6);
    expect(hostAgain.reads).toBeLessThanOrEqual(assignBudget(1));
    expect((await db.doc(`competitions/${cid}/staff/tester`).get()).get('memberNo')).toBeUndefined();
    expect((await db.doc(`competitions/${cid}`).get()).get('staffSeq')).toBeUndefined();

    const meter = new ReadMeter();
    await ok(assign(cid, { uid: 'admin', roles: ['referee'] }, ADMIN, makeDeps(0, meter)));
    expect(meter.reads).toBe(5);
    expect(meter.reads).toBeLessThanOrEqual(assignBudget(1));
    expect((await db.doc(`competitions/${cid}/staff/admin`).get()).get('memberNo')).toBe(2);
    expect((await db.doc(`competitions/${cid}`).get()).get('staffSeq')).toBe(2);
    expect((await db.doc(`competitions/${cid}/staff/tester`).get()).get('memberNo')).toBeUndefined();
  });

  it('俱樂部建賽 staffSeq 為 1、沒有主辦 staff；代表新建自己的 staff 為 2，讀數仍是 7', async () => {
    const created = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER, createInput({
      name: '【測試】編號俱樂部', hostType: 'club', hostTeamId: 'club_a'
    })));
    const clubCid = created.cid;
    expect((await adminDb().doc(`competitions/${clubCid}`).get()).get('staffSeq')).toBe(1);
    expect((await adminDb().doc(`competitions/${clubCid}/staff/tester`).get()).exists).toBe(false);
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid: clubCid }));
    const mtId = 'mt_' + 'f'.repeat(20);
    await adminDb().doc(`competitions/${clubCid}/matches/${mtId}`).set(matchBody(mtId, created.dvIds[0]!));
    const meter = new ReadMeter();
    await ok(call(handleCpHost, TESTER, {
      action: 'assignStaff', cid: clubCid, uid: 'tester', roles: ['scorer'], matchIds: [mtId]
    }, makeDeps(0, meter)));
    expect(meter.reads).toBe(7);
    expect(meter.reads).toBeLessThanOrEqual(assignBudget(1));
    expect((await adminDb().doc(`competitions/${clubCid}/staff/tester`).get()).get('memberNo')).toBe(2);
    expect((await adminDb().doc(`competitions/${clubCid}`).get()).get('staffSeq')).toBe(2);
  });
});
