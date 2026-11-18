/**
 * §3.272 F1（模擬器，寫好不跑）：取消單場、最後一場取消自動結束、主辦手動結束、管理員恢復。
 * 讀取預算用 ReadMeter。觸發器由測試直接呼叫，與 step3.test.ts 相同。
 */
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { ReadMeter } from '../src/cp/context.js';
import { handleCpHost } from '../src/cp/host.js';
import { handleMatchWritten } from '../src/cp/match-trigger.js';
import { ADMIN, DAY, TESTER2, call, fails, makeDeps, ok, resetAll, setBannedWords, type Who } from './_cp.js';
import {
  LATER, act, generate, later, matchesOf, pairing, record, setupComp, standingOf, type Comp
} from './_step3.js';

const TEAMS4 = ['甲', '乙', '丙', '丁'];

/** 契約上限。管理員實測路徑更緊，下面的 toBe 鎖住。 */
const READ_BUDGET = {
  cancelMatch: 6,          // 閘門 ≤2＋賽事 1＋主辦判斷 ≤2＋場次 1
  endCompetition: 13,      // 閘門 ≤2＋賽事 1＋主辦判斷 ≤2＋組別 ≤8
  restoreCompetition: 3,   // 閘門 ≤2＋賽事 1
  triggerCancel: 13,       // 場次 1＋摘要 1＋場次重讀 1＋賽事 1＋組別 ≤8＋聚合 1
  triggerCancelEnds: 14    // 上式＋總場次聚合 1
};

async function entryOf(cid: string, mtId: string): Promise<{ st?: string } | undefined> {
  const shards = await adminDb().collection(`competitions/${cid}/summary`).get();
  for (const d of shards.docs) {
    const m = d.get('m') as Record<string, { st?: string }> | undefined;
    if (m?.[mtId]) return m[mtId];
  }
  return undefined;
}

async function auditDetails(cid: string, action: string): Promise<Array<Record<string, unknown>>> {
  const snap = await adminDb().collection(`competitions/${cid}/audits`).get();
  return snap.docs.filter(d => d.get('action') === action).map(d => (d.get('details') ?? {}) as Record<string, unknown>);
}

/** 呼叫單場動作並分開計數動作本身與觸發器。 */
async function runAct(c: Comp, who: Who, data: Record<string, unknown>) {
  const actionMeter = new ReadMeter();
  const triggerMeter = new ReadMeter();
  const mtId = String(data.mtId);
  const ref = adminDb().doc(`competitions/${c.cid}/matches/${mtId}`);
  const before = (await ref.get()).data() ?? null;
  const r = await ok<Record<string, unknown>>(call(handleCpHost, who, { cid: c.cid, ...data }, makeDeps(LATER, actionMeter)));
  const after = (await ref.get()).data() ?? null;
  const trigger = await handleMatchWritten(makeDeps(LATER, triggerMeter), c.cid, mtId, before, after);
  return { r, actionMeter, triggerMeter, trigger, after };
}

function slim(c: Comp) {
  return standingOf(c).then(st => ({
    version: st?.version,
    rows: (st?.rows ?? []).map(r => ({
      name: c.nameOf[r.teamId], played: r.played, points: r.points, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst
    }))
  }));
}

describe('§3.272 取消單場、手動結束、管理員恢復', () => {
  let c: Comp;
  beforeEach(async () => { await resetAll(); c = await setupComp(TEAMS4); await generate(c); });

  it('取消 scheduled／postponed／finished：不計積分、摘要 cancelled、稽核有原因、讀取預算', async () => {
    const reason = '雨'.repeat(100);
    await record(c, '甲', '乙', 2, 1);
    const played = await slim(c);
    expect(played.rows.find(r => r.name === '甲')).toMatchObject({ played: 1, points: 3 });

    let ms = await matchesOf(c);
    const confirmed = pairing(c, ms, '甲', '乙', 0, 0).m;
    const rest = ms.filter(m => m.id !== confirmed.id);
    const mSched = rest[0];
    const mPost = rest[1];
    const mFin = rest[2];
    const mCo = rest[3];

    const cancelled = await runAct(c, ADMIN, { action: 'cancelMatch', mtId: mSched.id, expectedRev: mSched.rev, reason });
    expect(cancelled.r).toMatchObject({ status: 'cancelled', rev: mSched.rev + 1 });
    expect(cancelled.actionMeter.reads).toBe(3);
    expect(cancelled.actionMeter.reads).toBeLessThanOrEqual(READ_BUDGET.cancelMatch);
    expect(cancelled.triggerMeter.reads).toBe(6);
    expect(cancelled.triggerMeter.reads).toBeLessThanOrEqual(READ_BUDGET.triggerCancel);
    expect(cancelled.trigger).toMatchObject({ summary: true, standing: false, ended: null });
    expect(cancelled.after).toMatchObject({ status: 'cancelled', cancelReason: reason, rev: mSched.rev + 1 });
    expect(cancelled.after?.cancelledAt).toBeTruthy();
    expect((await entryOf(c.cid, mSched.id))?.st).toBe('cancelled');
    expect(await auditDetails(c.cid, 'cancelMatch')).toEqual(
      expect.arrayContaining([expect.objectContaining({ mtId: mSched.id, from: 'scheduled', reason })])
    );

    await act(c, ADMIN, { action: 'rescheduleMatch', mtId: mPost.id, expectedRev: mPost.rev, kickoffAt: null, venueIdx: null });
    const post = await runAct(c, ADMIN, { action: 'cancelMatch', mtId: mPost.id, expectedRev: mPost.rev + 1, reason: '改期待定後取消' });
    expect(post.after).toMatchObject({ status: 'cancelled', cancelReason: '改期待定後取消' });
    expect((await entryOf(c.cid, mPost.id))?.st).toBe('cancelled');

    await act(c, ADMIN, { action: 'recordResult', mtId: mFin.id, expectedRev: 0, score: { home: 1, away: 0 }, confirm: false });
    const fin = await runAct(c, ADMIN, { action: 'cancelMatch', mtId: mFin.id, expectedRev: 1, reason: '待確認後取消' });
    expect(fin.after?.status).toBe('cancelled');
    expect((await entryOf(c.cid, mFin.id))?.st).toBe('cancelled');
    expect(await slim(c)).toEqual(played);

    const restored = await runAct(c, ADMIN, { action: 'resetMatch', mtId: mPost.id, expectedRev: mPost.rev + 2, reason: '恢復未賽' });
    expect(restored.r).toMatchObject({ status: 'postponed' });
    expect(restored.after?.cancelReason).toBeUndefined();
    expect(restored.after?.cancelledAt).toBeUndefined();
    expect(restored.after?.status).toBe('postponed');
    expect((await entryOf(c.cid, mPost.id))?.st).toBe('postponed');
    expect(await auditDetails(c.cid, 'resetMatch')).toEqual(
      expect.arrayContaining([expect.objectContaining({ mtId: mPost.id, from: 'cancelled', reason: '恢復未賽' })])
    );
    expect(await slim(c)).toEqual(played);

    await adminDb().doc(`competitions/${c.cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [] });
    const byCo = await runAct(c, TESTER2, { action: 'cancelMatch', mtId: mCo.id, expectedRev: mCo.rev, reason: '共同主辦取消' });
    expect(byCo.actionMeter.reads).toBe(5);
    expect(byCo.actionMeter.reads).toBeLessThanOrEqual(READ_BUDGET.cancelMatch);
    expect(byCo.after?.status).toBe('cancelled');
    expect(await slim(c)).toEqual(played);
  });

  it('最後一場被取消也會自動結束；重置回未賽時清掉 confirm 結束', async () => {
    await resetAll();
    const c2 = await setupComp(['甲', '乙']);
    await generate(c2);
    const v0 = (await standingOf(c2))!.version;
    const m = (await matchesOf(c2))[0];
    const cancelled = await runAct(c2, ADMIN, { action: 'cancelMatch', mtId: m.id, expectedRev: 0, reason: '場地淹水' });
    expect(cancelled.trigger.ended).toBe('set');
    expect(cancelled.trigger.standing).toBe(false);
    expect(cancelled.triggerMeter.reads).toBe(7);
    expect(cancelled.triggerMeter.reads).toBeLessThanOrEqual(READ_BUDGET.triggerCancelEnds);
    expect(cancelled.actionMeter.reads).toBe(3);
    const ended = (await adminDb().doc(`competitions/${c2.cid}`).get()).data()!;
    expect(ended.endedBy).toBe('confirm');
    expect(ended.endedAt).toBeTruthy();
    expect((await standingOf(c2))!.version).toBe(v0);
    expect((await standingOf(c2))!.rows.every(r => r.played === 0)).toBe(true);
    expect((await entryOf(c2.cid, m.id))?.st).toBe('cancelled');

    const restored = await runAct(c2, ADMIN, { action: 'resetMatch', mtId: m.id, expectedRev: 1, reason: '改期再戰' });
    expect(restored.trigger.ended).toBe('cleared');
    expect(restored.after).toMatchObject({ status: 'scheduled', rev: 2, resetRev: 2 });
    expect(restored.after?.cancelReason).toBeUndefined();
    expect(restored.after?.cancelledAt).toBeUndefined();
    const comp = (await adminDb().doc(`competitions/${c2.cid}`).get()).data()!;
    expect(comp.endedAt).toBeNull();
    expect(comp.endedBy).toBeNull();
    expect((await entryOf(c2.cid, m.id))?.st).toBe('scheduled');
  });

  it('手動結束後寬限內共同主辦也不能登錄；管理員仍可；恢復後共同主辦可以', async () => {
    await adminDb().doc(`competitions/${c.cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [] });
    const before = (await adminDb().doc(`competitions/${c.cid}`).get()).get('stateVersion');
    const meter = new ReadMeter();
    const ended = await ok<{ endedBy: string }>(call(handleCpHost, ADMIN, {
      action: 'endCompetition', cid: c.cid, reason: '本季提前結束'
    }, makeDeps(LATER, meter)));
    expect(ended.endedBy).toBe('host');
    expect(meter.reads).toBe(3);
    expect(meter.reads).toBeLessThanOrEqual(READ_BUDGET.endCompetition);
    let comp = (await adminDb().doc(`competitions/${c.cid}`).get()).data()!;
    expect(comp.endedBy).toBe('host');
    expect(comp.endReason).toBe('本季提前結束');
    expect(comp.endedAt).toBeTruthy();
    expect(comp.stateVersion).toBe(before + 1);
    expect(comp.status).toBe('published');
    expect((await matchesOf(c)).every(m => m.status === 'scheduled')).toBe(true);
    expect(await auditDetails(c.cid, 'endCompetition')).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: '本季提前結束' })])
    );

    // 對齊測試時鐘的 1 天前：若誤給 host 寬限，共同主辦會通過。
    await adminDb().doc(`competitions/${c.cid}`).update({ endedAt: Timestamp.fromMillis(Date.now() + LATER - DAY) });
    const m = (await matchesOf(c))[0];
    await fails(call(handleCpHost, TESTER2, {
      action: 'recordResult', cid: c.cid, mtId: m.id, expectedRev: m.rev, score: { home: 1, away: 0 }, confirm: true
    }, later()), 'COMPETITION_ENDED');
    await fails(call(handleCpHost, TESTER2, {
      action: 'cancelMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev, reason: '想取消'
    }, later()), 'COMPETITION_ENDED');
    expect((await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).get('status')).toBe('scheduled');

    await record(c, '甲', '乙', 1, 0);
    const afterAdmin = await slim(c);
    expect(afterAdmin.rows.find(r => r.name === '甲')).toMatchObject({ played: 1, points: 3 });

    const restoreMeter = new ReadMeter();
    const restored = await ok<{ restored: boolean }>(call(handleCpHost, ADMIN, {
      action: 'restoreCompetition', cid: c.cid, reason: '恢復續賽'
    }, makeDeps(LATER, restoreMeter)));
    expect(restored.restored).toBe(true);
    expect(restoreMeter.reads).toBe(2);
    expect(restoreMeter.reads).toBeLessThanOrEqual(READ_BUDGET.restoreCompetition);
    comp = (await adminDb().doc(`competitions/${c.cid}`).get()).data()!;
    expect(comp.endedAt).toBeNull();
    expect(comp.endedBy).toBeNull();
    expect(comp.endReason).toBeNull();
    expect(comp.stateVersion).toBe(before + 2);
    expect(await auditDetails(c.cid, 'restoreCompetition')).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: '恢復續賽', from: 'host' })])
    );

    const left = (await matchesOf(c)).find(x => x.status === 'scheduled')!;
    await act(c, TESTER2, { action: 'recordResult', mtId: left.id, expectedRev: left.rev, score: { home: 0, away: 0 }, confirm: true });
    expect((await adminDb().doc(`competitions/${c.cid}/matches/${left.id}`).get()).get('status')).toBe('confirmed');
  });

  it('endedBy auto 可由管理員恢復', async () => {
    const before = (await adminDb().doc(`competitions/${c.cid}`).get()).get('stateVersion');
    await adminDb().doc(`competitions/${c.cid}`).update({
      endedAt: Timestamp.fromMillis(Date.now()), endedBy: 'auto', endReason: '逾期未賽'
    });
    const meter = new ReadMeter();
    await ok(call(handleCpHost, ADMIN, { action: 'restoreCompetition', cid: c.cid, reason: '補賽再開' }, makeDeps(LATER, meter)));
    expect(meter.reads).toBe(2);
    expect(meter.reads).toBeLessThanOrEqual(READ_BUDGET.restoreCompetition);
    const comp = (await adminDb().doc(`competitions/${c.cid}`).get()).data()!;
    expect(comp.endedAt).toBeNull();
    expect(comp.endedBy).toBeNull();
    expect(comp.endReason).toBeNull();
    expect(comp.stateVersion).toBe(before + 1);
    expect(await auditDetails(c.cid, 'restoreCompetition')).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: 'auto', reason: '補賽再開' })])
    );
  });

  it('沒有賽程不能結束；至少一個組別有賽程就可以；不是 published 不行', async () => {
    await resetAll();
    const bare = await setupComp(TEAMS4);
    await fails(call(handleCpHost, ADMIN, { action: 'endCompetition', cid: bare.cid, reason: '想結束' }, later()), 'SCHEDULE_REQUIRED');
    await generate(bare);
    await adminDb().doc(`competitions/${bare.cid}`).update({ status: 'draft' });
    await fails(call(handleCpHost, ADMIN, { action: 'endCompetition', cid: bare.cid, reason: '想結束' }, later()), 'STATUS_NOT_EDITABLE');
    await adminDb().doc(`competitions/${bare.cid}`).update({ status: 'published' });
    const dv2 = 'dv_' + 'C'.repeat(20);
    await adminDb().doc(`competitions/${bare.cid}/divisions/${dv2}`).set({ name: '加賽組', playersOnField: 5 });
    const meter = new ReadMeter();
    await ok(call(handleCpHost, ADMIN, { action: 'endCompetition', cid: bare.cid, reason: '只打一組' }, makeDeps(LATER, meter)));
    expect(meter.reads).toBe(4);
    expect(meter.reads).toBeLessThanOrEqual(READ_BUDGET.endCompetition);
    const comp = (await adminDb().doc(`competitions/${bare.cid}`).get()).data()!;
    expect(comp.endedBy).toBe('host');
    expect(comp.endReason).toBe('只打一組');
    expect((await matchesOf(bare)).every(m => m.status === 'scheduled')).toBe(true);
  });

  it('拒絕路徑', async () => {
    const m0 = (await matchesOf(c))[0];
    await fails(call(handleCpHost, ADMIN, { action: 'restoreCompetition', cid: c.cid, reason: '還沒結束' }, later()), 'COMPETITION_NOT_ENDED');
    await fails(call(handleCpHost, TESTER2, { action: 'cancelMatch', cid: c.cid, mtId: m0.id, expectedRev: 0, reason: '非主辦' }, later()), 'NOT_HOST');
    await fails(call(handleCpHost, TESTER2, { action: 'endCompetition', cid: c.cid, reason: '非主辦' }, later()), 'NOT_HOST');

    await fails(call(handleCpHost, ADMIN, { action: 'cancelMatch', cid: c.cid, mtId: m0.id, expectedRev: 0 }, later()), 'FIELD_REQUIRED');
    await fails(call(handleCpHost, ADMIN, { action: 'cancelMatch', cid: c.cid, mtId: m0.id, expectedRev: 0, reason: '' }, later()), 'FIELD_REQUIRED');
    await fails(call(handleCpHost, ADMIN, { action: 'cancelMatch', cid: c.cid, mtId: m0.id, expectedRev: 0, reason: '   ' }, later()), 'FIELD_REQUIRED');
    await fails(call(handleCpHost, ADMIN, { action: 'endCompetition', cid: c.cid }, later()), 'FIELD_REQUIRED');
    await fails(call(handleCpHost, ADMIN, { action: 'restoreCompetition', cid: c.cid, reason: '' }, later()), 'FIELD_REQUIRED');
    await fails(call(handleCpHost, ADMIN, { action: 'cancelMatch', cid: c.cid, mtId: m0.id, expectedRev: 0, reason: '雨' }, later()), 'FIELD_LENGTH');
    await fails(call(handleCpHost, ADMIN, { action: 'endCompetition', cid: c.cid, reason: '雨'.repeat(101) }, later()), 'FIELD_LENGTH');
    await fails(call(handleCpHost, ADMIN, { action: 'cancelMatch', cid: c.cid, mtId: m0.id, expectedRev: 0, reason: '場地淹水', extra: 1 }, later()), 'UNKNOWN_FIELD');
    await fails(call(handleCpHost, ADMIN, { action: 'cancelMatch', cid: c.cid, mtId: m0.id, expectedRev: 9, reason: '場地淹水' }, later()), 'REV_CONFLICT');

    await setBannedWords();
    await fails(call(handleCpHost, ADMIN, { action: 'cancelMatch', cid: c.cid, mtId: m0.id, expectedRev: 0, reason: '這是官方決定' }, later()), 'BANNED_WORD');
    await fails(call(handleCpHost, ADMIN, { action: 'endCompetition', cid: c.cid, reason: '官方結束' }, later()), 'BANNED_WORD');
    await fails(call(handleCpHost, ADMIN, { action: 'restoreCompetition', cid: c.cid, reason: '官方恢復' }, later()), 'BANNED_WORD');

    await record(c, '甲', '乙', 1, 0);
    const confirmed = pairing(c, await matchesOf(c), '甲', '乙', 0, 0).m;
    await fails(call(handleCpHost, ADMIN, {
      action: 'cancelMatch', cid: c.cid, mtId: confirmed.id, expectedRev: confirmed.rev, reason: '想取消已確認'
    }, later()), 'MATCH_STATE');
    expect((await adminDb().doc(`competitions/${c.cid}/matches/${confirmed.id}`).get()).get('status')).toBe('confirmed');

    const wo = (await matchesOf(c)).find(m => m.status === 'scheduled')!;
    await act(c, ADMIN, { action: 'setWalkover', mtId: wo.id, expectedRev: wo.rev, forfeitSide: 'home', reason: '未到場' });
    await fails(call(handleCpHost, ADMIN, {
      action: 'cancelMatch', cid: c.cid, mtId: wo.id, expectedRev: wo.rev + 1, reason: '想取消棄權'
    }, later()), 'MATCH_STATE');
    expect((await adminDb().doc(`competitions/${c.cid}/matches/${wo.id}`).get()).get('status')).toBe('walkover');

    const live = (await matchesOf(c)).find(m => m.status === 'scheduled')!;
    await adminDb().doc(`competitions/${c.cid}/matches/${live.id}`).update({ status: 'live' });
    await fails(call(handleCpHost, ADMIN, {
      action: 'cancelMatch', cid: c.cid, mtId: live.id, expectedRev: live.rev, reason: '進行中'
    }, later()), 'MATCH_STATE');

    await ok(call(handleCpHost, ADMIN, { action: 'endCompetition', cid: c.cid, reason: '收工' }, later()));
    await fails(call(handleCpHost, ADMIN, { action: 'endCompetition', cid: c.cid, reason: '再收一次' }, later()), 'COMPETITION_ENDED');
    await fails(call(handleCpHost, TESTER2, { action: 'restoreCompetition', cid: c.cid, reason: '共同主辦想恢復' }, later()), 'NOT_ADMIN');
    await adminDb().doc(`competitions/${c.cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [] });
    await fails(call(handleCpHost, TESTER2, { action: 'restoreCompetition', cid: c.cid, reason: '共同主辦想恢復' }, later()), 'NOT_ADMIN');
    expect((await adminDb().doc(`competitions/${c.cid}`).get()).get('endedBy')).toBe('host');
  });

  it('不能恢復末場確認造成的結束，也不能在確認結束後再手動結束', async () => {
    await resetAll();
    const c2 = await setupComp(['甲', '乙']);
    await generate(c2);
    const m = (await matchesOf(c2))[0];
    await act(c2, ADMIN, { action: 'recordResult', mtId: m.id, expectedRev: 0, score: { home: 1, away: 0 }, confirm: true });
    expect((await adminDb().doc(`competitions/${c2.cid}`).get()).get('endedBy')).toBe('confirm');
    await fails(call(handleCpHost, ADMIN, { action: 'restoreCompetition', cid: c2.cid, reason: '還想改' }, later()), 'RESTORE_NOT_ALLOWED');
    await fails(call(handleCpHost, ADMIN, { action: 'endCompetition', cid: c2.cid, reason: '改成手動' }, later()), 'COMPETITION_ENDED');
    expect((await adminDb().doc(`competitions/${c2.cid}`).get()).get('endedBy')).toBe('confirm');
  });
});
