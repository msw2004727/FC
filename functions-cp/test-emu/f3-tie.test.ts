/**
 * §3.272 F3（模擬器，寫好不跑）：同分裁定、撤銷、逐項查詢、拒絕路徑。
 * 三隊互平會落到 manual，賽事也會因全部確認而結束。
 * 寬限用測試時鐘：+2 天仍可裁定，+4 天超過 3 天寬限。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { ReadMeter } from '../src/cp/context.js';
import { handleCpHost } from '../src/cp/host.js';
import { ADMIN, DAY, TESTER, TESTER2, TESTER3, call, fails, makeDeps, ok, resetAll, setBannedWords } from './_cp.js';
import { generate, record, setupComp, type Comp } from './_step3.js';

const TEAMS = ['甲', '乙', '丙'];
/** 閘門 ≤2＋賽事 1＋主辦判斷 ≤2＋組別 1＋積分 1＋該組場次（3 場＝3） */
const READ_BUDGET = 10;

async function tiedComp(): Promise<Comp> {
  const c = await setupComp(TEAMS, { host: TESTER });
  await generate(c, TESTER);
  await record(c, '甲', '乙', 1, 1);
  await record(c, '甲', '丙', 1, 1);
  await record(c, '乙', '丙', 1, 1);
  await adminDb().doc(`competitions/${c.cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [] });
  return c;
}

function standingDoc(c: Comp) {
  return adminDb().doc(`competitions/${c.cid}/standings/${c.dvId}__group__A`).get().then(s => s.data()!);
}

async function auditActions(c: Comp): Promise<string[]> {
  const snap = await adminDb().collection(`competitions/${c.cid}/audits`).get();
  return snap.docs.map(d => String(d.get('action')));
}

describe('§3.272 F3 同分裁定與查詢', () => {
  let c: Comp;
  beforeEach(async () => { await resetAll(); c = await tiedComp(); });

  it('共同主辦在寬限內裁定：名次、標記、雜湊、稽核、查詢不寫入、讀取預算', async () => {
    const before = await standingDoc(c);
    expect(before.hasUnresolvedTie).toBe(true);
    const order = [c.enIdOf['丙'], c.enIdOf['甲'], c.enIdOf['乙']];
    const reason = '抽籤後登錄';
    const meter = new ReadMeter();
    const r = await ok<{ version: number; hasUnresolvedTie: boolean; rows: Array<{ teamId: string; decidedBy: string | null }> }>(
      call(handleCpHost, TESTER2, {
        action: 'resolveTie', cid: c.cid, dvId: c.dvId, order, method: 'host', reason, expectedVersion: before.version
      }, makeDeps(2 * DAY, meter))
    );
    expect(meter.reads).toBe(9);
    expect(meter.reads).toBeLessThanOrEqual(READ_BUDGET);
    expect(r.version).toBe(before.version + 1);
    expect(r.hasUnresolvedTie).toBe(false);
    expect(r.rows.map(row => row.teamId)).toEqual(order);
    expect(r.rows.every(row => row.decidedBy === 'host')).toBe(true);

    const st = await standingDoc(c);
    expect(st.manualOverride).toMatchObject({ enabled: true, method: 'host', reason, order });
    expect(st.manualOverride.by).toMatch(/^[0-9a-f]{16}$/);
    expect(st.manualOverride.decidedAt).toBeTruthy();
    expect(st.manualOverride.at).toBeTruthy();
    expect(st.rows.map((row: { decidedBy?: string }) => row.decidedBy)).toEqual(['host', 'host', 'host']);
    const blob = JSON.stringify(st);
    expect(blob).not.toContain('tester2');
    expect(blob).not.toContain(TESTER.uid);

    const audits = await adminDb().collection(`competitions/${c.cid}/audits`).where('action', '==', 'resolveTie').get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0]!.get('details')).toMatchObject({ method: 'host', reason, order, groupId: 'A' });
    expect(JSON.stringify(audits.docs[0]!.data())).not.toContain('tester2');

    const beforeN = (await auditActions(c)).length;
    const qMeter = new ReadMeter();
    const q = await ok<{
      pending: boolean; pendingCriterion: string | null;
      decision: { active: boolean; method: string; reason: string } | null;
      matchIds: string[]; steps: Array<{ criterion: string; values: Array<{ value: number | null }> }>;
      marks: Array<{ decidedBy: string | null }>;
    }>(call(handleCpHost, ADMIN, {
      action: 'explainTie', cid: c.cid, dvId: c.dvId, teamIds: order
    }, makeDeps(2 * DAY, qMeter)));
    expect(qMeter.reads).toBe(7);
    expect(qMeter.reads).toBeLessThanOrEqual(READ_BUDGET);
    expect(q.pending).toBe(true);
    expect(q.pendingCriterion).toBe('manual');
    expect(q.decision).toMatchObject({ active: true, method: 'host', reason });
    expect(q.matchIds).toHaveLength(3);
    expect(q.marks.every(m => m.decidedBy === 'host')).toBe(true);
    const points = q.steps.find(s => s.criterion === 'points');
    expect(points!.values.map(v => v.value)).toEqual([2, 2, 2]);
    expect((await auditActions(c)).length).toBe(beforeN);
  });

  it('同組兩群同分：另一群裁定仍生效時不能覆蓋（TIE_DECISION_EXISTS）；同一群可重新裁定（Opus 終審 P2）', async () => {
    await resetAll();
    const c2 = await setupComp(['甲', '乙', '丙', '丁'], { host: TESTER });
    await generate(c2, TESTER);
    await record(c2, '甲', '乙', 1, 1);
    await record(c2, '丙', '丁', 1, 1);
    await record(c2, '甲', '丙', 1, 0);
    await record(c2, '甲', '丁', 1, 0);
    await record(c2, '乙', '丙', 1, 0);
    await record(c2, '乙', '丁', 1, 0);
    const top = [c2.enIdOf['乙'], c2.enIdOf['甲']];
    const bottom = [c2.enIdOf['丁'], c2.enIdOf['丙']];
    let v = (await standingDoc(c2)).version as number;
    await ok(call(handleCpHost, TESTER, {
      action: 'resolveTie', cid: c2.cid, dvId: c2.dvId, order: top, method: 'host', reason: '依報名先後', expectedVersion: v
    }, makeDeps(2 * DAY)));
    v = (await standingDoc(c2)).version as number;
    await fails(call(handleCpHost, TESTER, {
      action: 'resolveTie', cid: c2.cid, dvId: c2.dvId, order: bottom, method: 'drawLots', reason: '抽籤', expectedVersion: v
    }, makeDeps(2 * DAY)), 'TIE_DECISION_EXISTS');
    const st = await standingDoc(c2);
    expect(st.manualOverride.order).toEqual(top);
    await ok(call(handleCpHost, TESTER, {
      action: 'resolveTie', cid: c2.cid, dvId: c2.dvId, order: [...top].reverse(), method: 'host', reason: '改判', expectedVersion: v
    }, makeDeps(2 * DAY)));
    expect((await standingDoc(c2)).manualOverride.order).toEqual([...top].reverse());
  });

  it('逐項比較只收積分相同的隊伍；積分不同回 TIE_NOT_SAME_POINTS（Flash 初審 P2）', async () => {
    await resetAll();
    const c2 = await setupComp(TEAMS, { host: TESTER });
    await generate(c2, TESTER);
    await record(c2, '甲', '乙', 2, 0);
    await fails(call(handleCpHost, TESTER, {
      action: 'explainTie', cid: c2.cid, dvId: c2.dvId, teamIds: [c2.enIdOf['甲'], c2.enIdOf['乙']]
    }, makeDeps(2 * DAY)), 'TIE_NOT_SAME_POINTS');
  });

  it('撤銷後回到隊號順序，標記與紀錄清掉，稽核有原因', async () => {
    const order = [c.enIdOf['丙'], c.enIdOf['甲'], c.enIdOf['乙']];
    const v = (await standingDoc(c)).version as number;
    await ok(call(handleCpHost, TESTER, {
      action: 'resolveTie', cid: c.cid, dvId: c.dvId, order, method: 'drawLots', reason: '抽籤', expectedVersion: v
    }, makeDeps(2 * DAY)));
    const mid = await standingDoc(c);
    expect(mid.rows.map((row: { decidedBy?: string }) => row.decidedBy)).toEqual(['drawLots', 'drawLots', 'drawLots']);

    const cleared = await ok<{ rows: Array<{ teamId: string; decidedBy: string | null }> }>(call(handleCpHost, TESTER2, {
      action: 'clearTieDecision', cid: c.cid, dvId: c.dvId, reason: '改回自動', expectedVersion: mid.version
    }, makeDeps(2 * DAY)));
    const natural = [...order].sort((a, b) => a.localeCompare(b));
    expect(cleared.rows.map(row => row.teamId)).toEqual(natural);
    expect(cleared.rows.every(row => row.decidedBy == null)).toBe(true);
    const st = await standingDoc(c);
    expect(st.manualOverride).toMatchObject({ enabled: false, method: null, order: null, reason: null, by: null });
    expect(st.hasUnresolvedTie).toBe(true);
    const audits = await adminDb().collection(`competitions/${c.cid}/audits`).where('action', '==', 'clearTieDecision').get();
    expect(audits.docs[0]!.get('details')).toMatchObject({ reason: '改回自動', groupId: 'A' });
  });

  it('拒絕：非主辦、非待裁定群、成員不符、缺原因、太長、禁用詞、版本不符、超過寬限', async () => {
    const st = await standingDoc(c);
    const order = [c.enIdOf['丙'], c.enIdOf['甲'], c.enIdOf['乙']];
    const base = {
      action: 'resolveTie', cid: c.cid, dvId: c.dvId, order, method: 'host', reason: '裁定', expectedVersion: st.version
    };
    await fails(call(handleCpHost, TESTER3, base, makeDeps(2 * DAY)), 'NOT_HOST');
    await fails(call(handleCpHost, TESTER, {
      ...base, order: [c.enIdOf['甲'], c.enIdOf['乙']]
    }, makeDeps(2 * DAY)), 'TIE_NOT_PENDING');
    await fails(call(handleCpHost, TESTER, {
      ...base, order: [c.enIdOf['甲'], c.enIdOf['乙'], 'en_' + 'b'.repeat(20)]
    }, makeDeps(2 * DAY)), 'TIE_NOT_PENDING');
    await fails(call(handleCpHost, TESTER, {
      action: 'resolveTie', cid: c.cid, dvId: c.dvId, order, method: 'host', expectedVersion: st.version
    }, makeDeps(2 * DAY)), 'FIELD_REQUIRED');
    await fails(call(handleCpHost, TESTER, { ...base, reason: '名'.repeat(201) }, makeDeps(2 * DAY)), 'FIELD_LENGTH');
    await setBannedWords();
    await fails(call(handleCpHost, TESTER, { ...base, reason: '官方裁定' }, makeDeps(2 * DAY)), 'BANNED_WORD');
    await fails(call(handleCpHost, TESTER, { ...base, expectedVersion: st.version + 1 }, makeDeps(2 * DAY)), 'REV_CONFLICT');
    await fails(call(handleCpHost, TESTER, base, makeDeps(4 * DAY)), 'COMPETITION_ENDED');
    expect((await standingDoc(c)).version).toBe(st.version);
  });
});
