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
import { buildStanding, engineInputsOf, resolveRules, RULE_TEMPLATES, type ResolvedRules } from '../src/engine/index.js';
import { rankingRuleOf } from '../src/cp/schedule-plan.js';
import { ADMIN, DAY, TESTER, TESTER2, call, fails, makeDeps, ok, resetAll, setBannedWords } from './_cp.js';
import {
  LATER, act, generate, later, matchesOf, orderNames, pairing, record, scheduleInput, setupComp, standingOf
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
    expect(audits[0].get('details.changes')).toEqual([{ key: 'points.win', from: 3, to: 2 }]);
    expect(audits[0].get('details.reason')).toBe('勝分改兩分');
    expect(audits[0].get('details.recomputed')).toBe(true);
    const notices = (await adminDb().doc(`competitions/${c.cid}`).get()).get('notices') as Array<{ kind: string; text: string }>;
    const sys = notices.filter(n => n.kind === 'system' && n.text.includes('比賽規則於'));
    expect(sys).toHaveLength(1);
    expect(sys[0].text).toMatch(/^比賽規則於 \d{1,2}\/\d{1,2} 修改：勝一場 3→2 分；原因：勝分改兩分$/);
    expect(sys[0].text).not.toContain('勝和負積分');
    expect(sys[0].text).not.toContain('points.win');
    expect((await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get()).get('rulesChangedAt')).toBeTruthy();
    // 閘門 1＋賽事 1＋組別 1＋確認或棄權聚合 1＋積分 1＋該組場次 1。
    // 聚合是這次退修多出來的 1 讀；原先整組場次一筆查詢時是 5。
    expect(meter.reads).toBe(6);
  });

  it('已有確認比分時改勝分與棄權方積分：公告含兩項改前到改後；空白原因被拒', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    await record(c, '甲', '乙', 1, 0);
    const rules = legacyPayload(r => {
      r.points.win = 2;
      r.walkover.penaltyPoints = -1;
    });
    await fails(call(handleCpHost, ADMIN, rulesCall(c, rules)), 'REASON_REQUIRED');
    await fails(call(handleCpHost, ADMIN, rulesCall(c, rules, { reason: '' })), 'REASON_REQUIRED');
    await fails(call(handleCpHost, ADMIN, rulesCall(c, rules, { reason: '   ' })), 'REASON_REQUIRED');
    await fails(call(handleCpHost, ADMIN, rulesCall(c, rules, { reason: ' \n\t ' })), 'REASON_REQUIRED');
    const res = await ok<{ recomputed: boolean }>(call(
      handleCpHost, ADMIN, rulesCall(c, rules, { reason: '勝分與棄權積分一起改' })
    ));
    expect(res.recomputed).toBe(true);
    const notices = (await adminDb().doc(`competitions/${c.cid}`).get()).get('notices') as Array<{ kind: string; text: string }>;
    const sys = notices.filter(n => n.kind === 'system' && n.text.includes('比賽規則於'));
    expect(sys).toHaveLength(1);
    expect(sys[0].text).toMatch(
      /^比賽規則於 \d{1,2}\/\d{1,2} 修改：勝一場 3→2 分、棄權方得 0→−1 分；原因：勝分與棄權積分一起改$/
    );
    expect(sys[0].text).not.toContain('points.');
    expect(sys[0].text).not.toContain('walkover.');
    const audits = (await adminDb().collection(`competitions/${c.cid}/audits`).get()).docs
      .filter(d => d.get('action') === 'setDivisionRules');
    expect(audits).toHaveLength(1);
    expect(audits[0].get('details.changes')).toEqual([
      { key: 'points.win', from: 3, to: 2 },
      { key: 'walkover.penaltyPoints', from: 0, to: -1 }
    ]);
    expect(audits[0].get('details.reason')).toBe('勝分與棄權積分一起改');
    expect((await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get()).get('rulesChangedAt')).toBeTruthy();
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

  it('先排賽程、尚未登錄比分就改勝分，隊名不變', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    const before = (await standingOf(c))!;
    expect(before.rows.length).toBeGreaterThan(0);
    expect(before.rows.every(r => typeof r.name === 'string' && r.name.length > 0)).toBe(true);
    const names = Object.fromEntries(before.rows.map(r => [r.teamId, r.name]));
    const res = await ok<{ recomputed: boolean }>(call(
      handleCpHost, ADMIN, rulesCall(c, legacyPayload(r => { r.points.win = 2; }))
    ));
    expect(res.recomputed).toBe(true);
    const after = (await standingOf(c))!;
    expect(after.version).toBe(before.version + 1);
    expect(after.rows.map(r => r.teamId)).toEqual(before.rows.map(r => r.teamId));
    for (const row of after.rows) expect(row.name).toBe(names[row.teamId]);
  });

  it('積分榜不在 schedule.groups 裡就拒絕，而且不寫', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    const before = (await standingOf(c))!;
    const dvRef = adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`);
    const schedule = (await dvRef.get()).get('schedule');
    await dvRef.update({ schedule: { ...schedule, groups: [{ groupId: 'B', teamIds: ['x', 'y'] }] } });
    await fails(
      call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(r => { r.points.win = 2; }))),
      'STANDINGS_MISMATCH',
      'failed-precondition'
    );
    const dv = await dvRef.get();
    expect(dv.get('rules')).toBeUndefined();
    expect(dv.get('rulesChangedAt')).toBeUndefined();
    expect((await standingOf(c))!.version).toBe(before.version);
    const audits = (await adminDb().collection(`competitions/${c.cid}/audits`).get()).docs
      .filter(d => d.get('action') === 'setDivisionRules');
    expect(audits).toHaveLength(0);
  });

  it('已有賽程時，時間結構同值可寫', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    await ok(call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(r => { r.time.note = '同值仍可寫'; }))));
    const dv = await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get();
    expect(dv.get('rules.time')).toMatchObject({
      periods: 1, halfMinutes: 20, halftime: { enabled: false, minutes: 0 }, note: '同值仍可寫'
    });
  });

  it('已有棄權時，棄權五欄同值可寫', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    const ms = await matchesOf(c);
    const { m } = pairing(c, ms, '甲', '乙', 0, 0);
    const forfeitSide = m.home.teamId === c.enIdOf['乙'] ? 'home' : 'away';
    await act(c, ADMIN, { action: 'setWalkover', mtId: m.id, expectedRev: m.rev, forfeitSide, reason: '未到場' });
    const before = (await standingOf(c))!;
    await ok(call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(r => { r.walkover.note = '同值仍可寫'; }))));
    const dv = await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get();
    expect(dv.get('rules.walkover')).toMatchObject({
      scoreFor: 2, scoreAgainst: 0, awardPoints: 3, penaltyPoints: 0, countInGoalStats: true, note: '同值仍可寫'
    });
    expect((await standingOf(c))!.version).toBe(before.version);
  });

  it('負分 -1 與和局：場次點數等於積分榜', async () => {
    const loss = await setupComp(['甲', '乙']);
    await generate(loss);
    await ok(call(handleCpHost, ADMIN, rulesCall(loss, legacyPayload(r => { r.points.loss = -1; }))));
    await record(loss, '甲', '乙', 1, 0);
    const played = (await matchesOf(loss)).find(m => m.status === 'confirmed')!;
    const result = played.result as { winner: 'home' | 'away'; homePoints: number; awayPoints: number };
    const winnerId = result.winner === 'home' ? played.home.teamId : played.away.teamId;
    const loserId = result.winner === 'home' ? played.away.teamId : played.home.teamId;
    const winnerPts = result.winner === 'home' ? result.homePoints : result.awayPoints;
    const loserPts = result.winner === 'home' ? result.awayPoints : result.homePoints;
    expect(winnerPts).toBe(3);
    expect(loserPts).toBe(-1);
    const lossRows = Object.fromEntries((await standingOf(loss))!.rows.map(r => [r.teamId, r]));
    expect(lossRows[winnerId].points).toBe(winnerPts);
    expect(lossRows[loserId].points).toBe(loserPts);

    const draw = await setupComp(['丙', '丁']);
    await generate(draw);
    await ok(call(handleCpHost, ADMIN, rulesCall(draw, legacyPayload(r => { r.points.draw = 2; }))));
    await record(draw, '丙', '丁', 1, 1);
    const drawn = (await matchesOf(draw)).find(m => m.status === 'confirmed')!;
    const drawResult = drawn.result as { homePoints: number; awayPoints: number };
    expect(drawResult.homePoints).toBe(2);
    expect(drawResult.awayPoints).toBe(2);
    const drawRows = (await standingOf(draw))!.rows;
    expect(drawRows.every(r => r.points === 2)).toBe(true);
  });

  it('confirmMatchResult 與 setWalkover 成功路徑多讀組別', async () => {
    const confirmed = await setupComp(['甲', '乙']);
    await generate(confirmed);
    const ms = await matchesOf(confirmed);
    const { m, score } = pairing(confirmed, ms, '甲', '乙', 2, 0);
    await ok(call(handleCpHost, ADMIN, {
      action: 'recordResult', cid: confirmed.cid, mtId: m.id, expectedRev: m.rev, score, confirm: false
    }, later()));
    const confirmMeter = new ReadMeter();
    await ok(call(handleCpHost, ADMIN, {
      action: 'confirmMatchResult', cid: confirmed.cid, mtId: m.id, expectedRev: m.rev + 1
    }, makeDeps(LATER, confirmMeter)));
    // 閘門 1＋賽事 1＋場次 1＋timeline 1＋voids 1＋組別 1。組別是這張卡多的那 1 讀。
    expect(confirmMeter.reads).toBe(6);

    const forfeited = await setupComp(['甲', '乙']);
    await generate(forfeited);
    const ms2 = await matchesOf(forfeited);
    const { m: m2 } = pairing(forfeited, ms2, '甲', '乙', 0, 0);
    const forfeitSide = m2.home.teamId === forfeited.enIdOf['乙'] ? 'home' : 'away';
    const walkMeter = new ReadMeter();
    await ok(call(handleCpHost, ADMIN, {
      action: 'setWalkover', cid: forfeited.cid, mtId: m2.id, expectedRev: m2.rev, forfeitSide, reason: '未到場'
    }, makeDeps(LATER, walkMeter)));
    // 閘門 1＋賽事 1＋場次 1＋組別 1。
    expect(walkMeter.reads).toBe(4);
  });

  it('補充說明與原因的禁用詞、原因超過 100 字、未知巢狀鍵', async () => {
    await setBannedWords(['官方']);
    const c = await setupComp(['甲', '乙']);
    const note = await call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(r => { r.squad.note = '這是官方說明'; })));
    expect(note.ok).toBe(false);
    if (!note.ok) {
      expect(note.error.reason).toBe('BANNED_WORD');
      expect(note.error.params).toMatchObject({ field: 'squad.note' });
    }
    const why = await call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(), { reason: '因為官方調整' }));
    expect(why.ok).toBe(false);
    if (!why.ok) {
      expect(why.error.reason).toBe('BANNED_WORD');
      expect(why.error.params).toMatchObject({ field: 'reason' });
    }
    await fails(call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(), { reason: '甲'.repeat(101) })), 'FIELD_LENGTH');
    const rules = legacyPayload();
    (rules.time as unknown as Record<string, unknown>).extra = true;
    const unknown = await call(handleCpHost, ADMIN, rulesCall(c, rules));
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.error.reason).toBe('UNKNOWN_FIELD');
      expect(unknown.error.params).toMatchObject({ field: 'time.extra' });
    }
    const dv = await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get();
    expect(dv.get('rules')).toBeUndefined();
  });

  it('沒有 rules 時，產生賽程的全 0 積分榜與 goalDiffFirst 捷徑相同', async () => {
    const c = await setupComp(['甲', '乙']);
    // 不跑場次觸發器。觸發器會整份重算，蓋掉這張全 0 表上的 rankingRuleId／criteria。
    await ok(call(handleCpHost, ADMIN, scheduleInput(c, { ranking: 'goalDiffFirst' })));
    const st = (await adminDb().doc(`competitions/${c.cid}/standings/${c.dvId}__group__A`).get()).data()!;
    const rule = rankingRuleOf('goalDiffFirst');
    const rows = st.rows as Array<{ teamId: string; name: string }>;
    const expected = buildStanding({
      competitionId: c.cid, divisionId: c.dvId, stageId: 'group', groupId: 'A',
      teamIds: rows.map(r => r.teamId), matches: [], rule,
      opts: { teamMeta: Object.fromEntries(rows.map(r => [r.teamId, { teamId: r.teamId, name: r.name }])) },
      prev: { version: 0 }
    });
    expect(st.rows).toEqual(expected.rows);
    expect(st.version).toBe(expected.version);
    expect(st.hasUnresolvedTie).toBe(expected.hasUnresolvedTie);
    expect(st.rankingRuleId).toBe(rule.rankingRuleId);
    expect(st.criteria).toEqual([...rule.criteria]);
    expect(st.computedBy).toBe('cpHost:generateSchedule');
    const schedule = (await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get()).get('schedule');
    expect(schedule.ranking).toBe('goalDiffFirst');
  });

  it('有 rules 時，產生賽程的全 0 積分榜跟解析結果一致', async () => {
    const c = await setupComp(['甲', '乙']);
    await ok(call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(r => {
      r.tieBreak.criteria = ['points', 'wins', 'manual'];
    }))));
    await ok(call(handleCpHost, ADMIN, scheduleInput(c, { ranking: 'h2hFirst' })));
    const dv = await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get();
    const rule = engineInputsOf(resolveRules(dv.data())).rule;
    const st = (await adminDb().doc(`competitions/${c.cid}/standings/${c.dvId}__group__A`).get()).data()!;
    expect(st.rankingRuleId).toBe(rule.rankingRuleId);
    expect(st.criteria).toEqual([...rule.criteria]);
    expect(st.rankingRuleId).toBe('custom');
    expect(st.criteria).toEqual(['points', 'wins', 'manual']);
    expect(st.computedBy).toBe('cpHost:generateSchedule');
    expect(dv.get('schedule.ranking')).toBe('h2hFirst');
  });

  it('同一組 241 筆場次時改計分回 TOO_MANY_MATCHES，而且不寫', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    const before = (await standingOf(c))!;
    const db = adminDb();
    const batch = db.batch();
    for (let i = 0; i < 241; i++) {
      batch.set(db.doc(`competitions/${c.cid}/matches/mt_k8cap_${String(i).padStart(3, '0')}`), {
        divisionId: c.dvId, stageId: 'group', groupId: 'A'
      });
    }
    await batch.commit();
    const out = await call(handleCpHost, ADMIN, rulesCall(c, legacyPayload(r => { r.points.win = 2; })));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('failed-precondition');
      expect(out.error.reason).toBe('TOO_MANY_MATCHES');
      expect(out.error.params).toMatchObject({ count: 241, max: 240, groupId: 'A' });
    }
    const dv = await db.doc(`competitions/${c.cid}/divisions/${c.dvId}`).get();
    expect(dv.get('rules')).toBeUndefined();
    expect((await standingOf(c))!.version).toBe(before.version);
    const audits = (await db.collection(`competitions/${c.cid}/audits`).get()).docs
      .filter(d => d.get('action') === 'setDivisionRules');
    expect(audits).toHaveLength(0);
  });
});
