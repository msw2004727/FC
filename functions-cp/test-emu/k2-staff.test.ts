/**
 * K2 主辦最小指派（模擬器，寫好由 PM 跑）：assignStaff、removeStaff。
 * 接手與記一筆走用戶端 SDK＋asia-main Rules（test-emu 已有 clientDb，同 e2e-step2）。
 * 不改 Rules、不刪 control/scorer。
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { actorHash, ReadMeter } from '../src/cp/context.js';
import { handleCpHost } from '../src/cp/host.js';
import { assignedDataOk } from '../src/cp/staff-host.js';
import { adminDb, assertFails, assertSucceeds, clientDb, closeClients } from '../test-rules/_harness.js';
import { DAY, TESTER, TESTER2, TESTER3, call, createInput, fails, makeDeps, ok, resetAll } from './_cp.js';

const MT = 'mt_' + 'a'.repeat(20);
/** 契約上限：閘門 ≤2＋賽事 1＋主辦判斷 ≤2＋staff 1＋場次 n */
const assignBudget = (n: number) => 2 + 1 + 2 + 1 + n;
/** 閘門 ≤2＋賽事 1＋主辦判斷 ≤2＋staff 1 */
const REMOVE_BUDGET = 2 + 1 + 2 + 1;

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
    await assertSucceeds(setDoc(doc(db, `${base}/control/scorer`), { uid: 'tester', takenAt: serverTimestamp() }));
    const batch = writeBatch(db);
    batch.update(doc(db, base), { rev: 1, status: 'live', updatedAt: serverTimestamp() });
    batch.set(doc(db, `${base}/timeline/e1`), {
      seq: 1, type: 'kickoff', matchSecond: 0, createdAt: serverTimestamp()
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
    await assertFails(setDoc(doc(db, `${base}/control/scorer`), { uid: 'tester', takenAt: serverTimestamp() }));
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
    await adminDb().doc(`competitions/${cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [], expiresAt: null });
    await ok(assign(cid, { uid: 'tester', roles: ['referee'] }, TESTER2));
    expect((await adminDb().doc(`competitions/${cid}/staff/tester`).get()).get('roles')).toEqual(['host', 'referee']);
    expect((await adminDb().doc(`cpMine/tester/items/${cid}`).get()).get('roles')).toEqual(['host', 'referee']);
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

  it('ReadMeter：自己一場 ≤ 契約；共同主辦指派別人用滿主辦判斷＋staff；移除純記分員用滿', async () => {
    const self = new ReadMeter();
    await ok(assign(cid, {}, TESTER, makeDeps(0, self)));
    expect(self.reads).toBe(6);
    expect(self.reads).toBeLessThanOrEqual(assignBudget(1));

    await adminDb().doc(`competitions/${cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [], expiresAt: null });
    const co = new ReadMeter();
    await ok(assign(cid, { uid: 'tester', roles: ['scorer'] }, TESTER2, makeDeps(0, co)));
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
});
