/**
 * K8 組別規則（模擬器，寫好不跑）：舊賽事計分不變、登錄與棄權改讀同一份設定、鎖定、透明條件、權限、讀取預算。
 * setDivisionRules 不走 act()：act 會再跑觸發器，看不出同交易重算。
 * 已排賽程、尚未寫 rules 的解析時間是一節 20 分、沒有中場（賽程 matchMinutes），不是五人制範本的上下半場。
 */
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { ReadMeter } from '../src/cp/context.js';
import { handleCpHost } from '../src/cp/host.js';
import { RULE_TEMPLATES, type ResolvedRules } from '../src/engine/rules.js';
import { ADMIN, DAY, TESTER, TESTER2, call, fails, makeDeps, ok, resetAll } from './_cp.js';
import {
  LATER, act, generate, later, matchesOf, orderNames, pairing, record, setupComp, standingOf
} from './_step3.js';

type Row = [string, string, number, number];

/** 與缺 rules 的已排組別解析結果相同，再覆寫要測的欄位。 */
function legacyPayload(patch?: (r: ResolvedRules) => void): ResolvedRules {
  const r = structuredClone(RULE_TEMPLATES.five);
  r.playersOnField = 5;
  r.time = { periods: 1, halfMinutes: 20, halftime: { enabled: false, minutes: 0 }, note: null };
  patch?.(r);
  return r;
}

function rulesCall(c: { cid: string; dvId: string }, rules: ResolvedRules, extra: Record<string, unknown> = {}) {
  return { action: 'setDivisionRules', cid: c.cid, dvId: c.dvId, rules, ...extra };
}

async function play(teams: string[], rows: Row[]) {
  const c = await setupComp(teams);
  await generate(c);
  for (const [h, a, hs, as] of rows) await record(c, h, a, hs, as);
  return c;
}

describe('組別比賽規則', () => {
  beforeEach(() => resetAll());

  it('舊賽事 T05 名次與積分不變', async () => {
    const c = await play(['A', 'B', 'C', 'D'], [
      ['A', 'B', 1, 0], ['C', 'A', 2, 0], ['A', 'D', 1, 0], ['B', 'C', 2, 0], ['B', 'D', 3, 0], ['D', 'C', 1, 0]
    ]);
    const st = await standingOf(c);
    expect(orderNames(c, st!.rows)).toEqual(['A', 'B', 'D', 'C']);
    const by = Object.fromEntries(st!.rows.map(r => [c.nameOf[r.teamId], r]));
    expect([by.A.points, by.B.points, by.A.goalDiff, by.B.goalDiff]).toEqual([6, 6, 0, 4]);
  });

  it('舊賽事 T06、T07、T09 與現在相同', async () => {
    const t06 = await play(['A', 'B', 'C', 'D'], [
      ['A', 'B', 3, 0], ['B', 'C', 1, 0], ['C', 'A', 1, 0], ['A', 'D', 1, 0], ['B', 'D', 5, 0], ['C', 'D', 1, 0]
    ]);
    expect(orderNames(t06, (await standingOf(t06))!.rows)).toEqual(['A', 'C', 'B', 'D']);

    const t07 = await play(['A', 'B', 'C', 'D', 'E'], [
      ['A', 'B', 5, 0], ['A', 'C', 1, 0], ['B', 'C', 2, 2], ['A', 'D', 0, 0], ['E', 'A', 1, 0],
      ['B', 'D', 6, 0], ['B', 'E', 6, 0], ['C', 'D', 1, 0], ['C', 'E', 1, 0], ['D', 'E', 1, 0]
    ]);
    const st = await standingOf(t07);
    expect(orderNames(t07, st!.rows).slice(0, 3)).toEqual(['A', 'B', 'C']);

    const t09 = await setupComp(['A', 'B', 'C']);
    await generate(t09);
    const ms = await matchesOf(t09);
    const { m } = pairing(t09, ms, 'A', 'B', 0, 0);
    const forfeitSide = m.home.teamId === t09.enIdOf.B ? 'home' : 'away';
    await act(t09, ADMIN, { action: 'setWalkover', mtId: m.id, expectedRev: 0, forfeitSide, reason: '逾時未出場' });
    await record(t09, 'A', 'C', 1, 1);
    await record(t09, 'B', 'C', 2, 0);
    const by = Object.fromEntries((await standingOf(t09))!.rows.map(r => [t09.nameOf[r.teamId], r]));
    expect(by.A).toMatchObject({ win: 1, points: 4, goalsFor: 3 });
    expect(by.B).toMatchObject({ loss: 1, goalsAgainst: 2 });
  });

  it('勝分改 2 後，場次點數等於積分榜增量', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    await ok(call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(r => { r.points.win = 2; }))));
    await record(c, '甲', '乙', 1, 0);
    const ms = await matchesOf(c);
    const played = ms.find(m => m.status === 'confirmed')!;
    const result = played.result as { winner: 'home' | 'away'; homePoints: number; awayPoints: number };
    const winnerId = result.winner === 'home' ? played.home.teamId : played.away.teamId;
    const winnerPts = result.winner === 'home' ? result.homePoints : result.awayPoints;
    const loserPts = result.winner === 'home' ? result.awayPoints : result.homePoints;
    const row = (await standingOf(c))!.rows.find(r => r.teamId === winnerId);
    expect(winnerPts).toBe(2);
    expect(loserPts).toBe(0);
    expect(row!.points).toBe(winnerPts);
  });

  it('棄權 3:0、勝方 3、負方 -1，場次與積分榜一致', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    await ok(call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(r => {
      r.walkover.scoreFor = 3;
      r.walkover.scoreAgainst = 0;
      r.walkover.awardPoints = 3;
      r.walkover.penaltyPoints = -1;
    }))));
    const ms = await matchesOf(c);
    const { m } = pairing(c, ms, '甲', '乙', 0, 0);
    const forfeitSide = m.home.teamId === c.enIdOf['乙'] ? 'home' : 'away';
    await act(c, ADMIN, { action: 'setWalkover', mtId: m.id, expectedRev: m.rev, forfeitSide, reason: '未到場' });
    const snap = (await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).data()!;
    const score = snap.score as { home: number; away: number };
    const result = snap.result as { winner: 'home' | 'away'; homePoints: number; awayPoints: number };
    const winSide = forfeitSide === 'home' ? 'away' : 'home';
    expect(result.winner).toBe(winSide);
    expect(score[winSide]).toBe(3);
    expect(score[winSide === 'home' ? 'away' : 'home']).toBe(0);
    expect(result[winSide === 'home' ? 'homePoints' : 'awayPoints']).toBe(3);
    expect(result[winSide === 'home' ? 'awayPoints' : 'homePoints']).toBe(-1);
    const by = Object.fromEntries((await standingOf(c))!.rows.map(r => [c.nameOf[r.teamId], r]));
    expect(by['甲']).toMatchObject({ points: 3, goalsFor: 3 });
    expect(by['乙']).toMatchObject({ points: -1, goalsAgainst: 3 });
  });

  it('已有報名鎖人數；同值可寫', async () => {
    const c = await setupComp(['甲', '乙']);
    const denied = await call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(r => { r.playersOnField = 7; })));
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.reason).toBe('RULES_LOCKED');
      expect(denied.error.params).toMatchObject({ field: 'playersOnField' });
    }
    await ok(call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(r => { r.squad.note = '人數不變'; }))));
    const dv = await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get();
    expect(dv.get('playersOnField')).toBe(5);
    expect(dv.get('rules.squad.note')).toBe('人數不變');
  });

  it('已有賽程改半場分鐘被拒', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    const out = await call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(r => { r.time.halfMinutes = 25; })));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.params).toMatchObject({ field: 'time.halfMinutes' });
    if (!out.ok) expect(out.error.reason).toBe('RULES_LOCKED');
  });

  it('已有棄權改棄權比分被拒', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    const ms = await matchesOf(c);
    const { m } = pairing(c, ms, '甲', '乙', 0, 0);
    const forfeitSide = m.home.teamId === c.enIdOf['乙'] ? 'home' : 'away';
    await act(c, ADMIN, { action: 'setWalkover', mtId: m.id, expectedRev: m.rev, forfeitSide, reason: '未到場' });
    const out = await call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(r => { r.walkover.scoreFor = 3; })));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.reason).toBe('RULES_LOCKED');
      expect(out.error.params).toMatchObject({ field: 'walkover.scoreFor' });
    }
  });

  it('已有確認比分改勝分：沒原因被拒；有原因同交易重算', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    await record(c, '甲', '乙', 1, 0);
    const before = (await standingOf(c))!;
    const rules = legacyPayload(r => { r.points.win = 2; });
    await fails(call(handleCpHost, ADMIN, rulesCall(c, rules)), 'REASON_REQUIRED');
    await fails(call(handleCpHost, ADMIN, rulesCall(c, rules, { reason: '   ' })), 'REASON_REQUIRED');
    await fails(call(handleCpHost, ADMIN, rulesCall(c, rules, { reason: '好' })), 'FIELD_LENGTH');
    const meter = new ReadMeter();
    const res = await ok<{ recomputed: boolean }>(call(
      handleCpHost, ADMIN, rulesCall(c, rules, { reason: '勝分改兩分' }), makeDeps(0, meter)
    ));
    expect(res.recomputed).toBe(true);
    const after = (await standingOf(c))!;
    expect(after.version).toBe(before.version + 1);
    const winnerId = before.rows.find(r => r.points === 3)!.teamId;
    expect(after.rows.find(r => r.teamId === winnerId)!.points).toBe(2);
    const audits = (await adminDb().collection(`competitions/${c.cid}/audits`).get()).docs
      .filter(d => d.get('action') === 'setDivisionRules');
    expect(audits).toHaveLength(1);
    expect(audits[0].get('details.changed')).toContain('points.win');
    expect(audits[0].get('details.reason')).toBe('勝分改兩分');
    expect(audits[0].get('details.recomputed')).toBe(true);
    const notices = (await adminDb().doc(`competitions/${c.cid}`).get()).get('notices') as Array<{ kind: string; text: string }>;
    const sys = notices.filter(n => n.kind === 'system' && n.text.includes('比賽規則於'));
    expect(sys).toHaveLength(1);
    expect(sys[0].text).toContain('勝和負積分');
    expect(sys[0].text).toContain('原因：勝分改兩分');
    expect((await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get()).get('rulesChangedAt')).toBeTruthy();
    expect(meter.reads).toBe(5);
    expect(meter.reads).toBeLessThanOrEqual(6 + 240 + 1);
  });

  it('只改補充說明不重算', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    await record(c, '甲', '乙', 1, 0);
    const before = (await standingOf(c))!;
    const meter = new ReadMeter();
    const res = await ok<{ recomputed: boolean }>(call(
      handleCpHost, ADMIN,
      rulesCall(c, legacyPayload(r => { r.time.note = '補時由主辦看錶'; })),
      makeDeps(0, meter)
    ));
    expect(res.recomputed).toBe(false);
    expect((await standingOf(c))!.version).toBe(before.version);
    const dv = await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get();
    expect(dv.get('rulesChangedAt')).toBeUndefined();
    const notices = (await adminDb().doc(`competitions/${c.cid}`).get()).get('notices') as Array<{ text?: string }> | undefined;
    expect((notices ?? []).some(n => String(n.text ?? '').includes('比賽規則於'))).toBe(false);
    expect(meter.reads).toBe(3);
    expect(meter.reads).toBeLessThanOrEqual(6);
  });

  it('非主辦、寬限外主辦、已取消都不能改', async () => {
    const hosted = await setupComp(['甲', '乙']);
    await fails(call(handleCpHost, TESTER2, rulesCall(hosted, legacyPayload())), 'NOT_HOST');

    const mine = await setupComp(['甲', '乙'], { host: TESTER });
    await adminDb().doc(`competitions/${mine.cid}`).update({
      endedAt: Timestamp.fromMillis(Date.now() + LATER - 4 * DAY),
      endedBy: 'confirm'
    });
    const note = legacyPayload(r => { r.squad.note = '寬限外'; });
    await fails(call(handleCpHost, TESTER, rulesCall(mine, note), later()), 'COMPETITION_ENDED');
    await ok(call(handleCpHost, ADMIN, rulesCall(mine, note), later()));

    const cancelled = await setupComp(['甲', '乙']);
    await adminDb().doc(`competitions/${cancelled.cid}`).update({ status: 'cancelled' });
    await fails(call(handleCpHost, ADMIN, rulesCall(cancelled, legacyPayload())), 'COMPETITION_CLOSED');
  });
});
