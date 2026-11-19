/**
 * 第 3 步 cpHost（模擬器）：排賽程、改期、主辦登錄比分、確認、棄權、重置、積分（觸發器）、末場自動結束。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { handleCpEntry } from '../src/cp/entry.js';
import { handleCpHost } from '../src/cp/host.js';
import { handleMatchWritten } from '../src/cp/match-trigger.js';
import { ReadMeter } from '../src/cp/context.js';
import { ADMIN, DAY, STRANGER, TESTER, TESTER2, call, fails, makeDeps, ok, resetAll } from './_cp.js';
import {
  LATER, act, generate, later, matchesOf, orderNames, pairing, record, scheduleInput, setupComp, standingOf, type Comp
} from './_step3.js';

const TEAMS4 = ['甲', '乙', '丙', '丁'];

describe('排賽程 generateSchedule／clearSchedule', () => {
  let c: Comp;
  beforeEach(async () => { await resetAll(); c = await setupComp(TEAMS4); });

  it('dryRun 只回預覽不寫入；正式產生寫場次、摘要片、全 0 積分榜、組別設定', async () => {
    const p = await ok<Record<string, unknown>>(call(handleCpHost, ADMIN, scheduleInput(c, { dryRun: true })));
    expect(p).toMatchObject({ dryRun: true, matchCount: 6, unplacedCount: 0, perTeam: 3, teamCount: 4, seed: 7 });
    expect((await matchesOf(c)).length).toBe(0);

    const r = await generate(c);
    expect(r).toMatchObject({ dryRun: false, matchCount: 6, seed: 7 });
    const ms = await matchesOf(c);
    expect(ms.length).toBe(6);
    for (const m of ms) {
      expect(m.id).toMatch(/^mt_[A-Za-z0-9]{20}$/);
      expect(m).toMatchObject({ status: 'scheduled', rev: 0, resetRev: 0, lock: { locked: false }, stageId: 'group', groupId: 'A' });
      expect(Object.keys(m)).not.toEqual(expect.arrayContaining(['createdBy']));
      expect(JSON.stringify(m)).not.toMatch(/tester|admin/);
    }
    const shards = await adminDb().collection(`competitions/${c.cid}/summary`).get();
    const entries = shards.docs.flatMap(d => Object.keys(d.get('m')));
    expect(entries.sort()).toEqual(ms.map(m => m.id).sort());
    const st = await standingOf(c);
    expect(st!.rows.length).toBe(4);
    expect(st!.rows.every(r => r.played === 0)).toBe(true);
    const dv = (await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get()).get('schedule');
    expect(dv).toMatchObject({ format: 'roundRobin', legs: 1, ranking: 'h2hFirst', matchCount: 6, version: 1 });
  });

  it('同 seed 預覽與正式產生的場數一致；重新產生會換掉舊場次（版本 +1）', async () => {
    await generate(c);
    const first = (await matchesOf(c)).map(m => m.id);
    await generate(c, ADMIN, { legs: 2 });
    const second = await matchesOf(c);
    expect(second.length).toBe(12);
    expect(second.some(m => first.includes(m.id))).toBe(false);
    const dv = (await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get()).get('schedule');
    expect(dv.version).toBe(2);
    const shards = await adminDb().collection(`competitions/${c.cid}/summary`).get();
    expect(shards.docs.flatMap(d => Object.keys(d.get('m'))).length).toBe(12);
  });

  it('前提與輸入拒絕', async () => {
    await fails(call(handleCpHost, TESTER2, scheduleInput(c)), 'NOT_HOST');
    await fails(call(handleCpHost, STRANGER, scheduleInput(c)), 'INTERNAL_PERIOD');
    await fails(call(handleCpHost, ADMIN, scheduleInput(c, { legs: 3 })), 'FIELD_RANGE');
    await fails(call(handleCpHost, ADMIN, scheduleInput(c, { groupCount: 2 })), 'UNKNOWN_FIELD');
    await fails(call(handleCpHost, ADMIN, scheduleInput(c, { venueIdx: [5] })), 'FIELD_RANGE');
    await fails(call(handleCpHost, ADMIN, scheduleInput(c, { days: [{ date: '2020-01-01', start: '08:00', end: '20:00' }] })), 'SCHEDULE_OUT_OF_RANGE');
    await fails(call(handleCpHost, ADMIN, scheduleInput(c, { days: [{ date: c.days[0], start: '8:00', end: '20:00' }] })), 'FIELD_FORMAT');
    // 一天一小時一個場地排不下 6 場 → 不寫
    await fails(call(handleCpHost, ADMIN, scheduleInput(c, { days: [{ date: c.days[0], start: '08:00', end: '09:00' }], venueIdx: [0] })), 'SCHEDULE_UNPLACED');
    expect((await matchesOf(c)).length).toBe(0);
  });

  it('名單未鎖不能排；已排賽程時不能解鎖名單；有結果後不能重排或清除', async () => {
    await ok(call(handleCpEntry, ADMIN, { action: 'unlockRosters', cid: c.cid, reason: '補登球員' }));
    await fails(call(handleCpHost, ADMIN, scheduleInput(c)), 'ROSTERS_NOT_LOCKED');
    await ok(call(handleCpEntry, ADMIN, { action: 'lockRosters', cid: c.cid }));
    await generate(c);
    await fails(call(handleCpEntry, ADMIN, { action: 'unlockRosters', cid: c.cid, reason: '補登球員' }), 'SCHEDULE_EXISTS');
    await record(c, '甲', '乙', 1, 0);
    await fails(call(handleCpHost, ADMIN, scheduleInput(c)), 'RESULTS_EXIST');
    await fails(call(handleCpHost, ADMIN, { action: 'clearSchedule', cid: c.cid, dvId: c.dvId }), 'RESULTS_EXIST');
  });

  it('clearSchedule 刪場次、摘要條目、積分榜、組別設定', async () => {
    await generate(c);
    await ok(call(handleCpHost, ADMIN, { action: 'clearSchedule', cid: c.cid, dvId: c.dvId }));
    expect((await matchesOf(c)).length).toBe(0);
    expect((await adminDb().collection(`competitions/${c.cid}/summary`).get()).size).toBe(0);
    expect(await standingOf(c)).toBeUndefined();
    expect((await adminDb().doc(`competitions/${c.cid}/divisions/${c.dvId}`).get()).get('schedule')).toBeUndefined();
  });

  it('俱樂部代表主辦的賽事：目前代表可排，非代表不行', async () => {
    await resetAll();
    const db = adminDb();
    await db.doc('cpClubs/club_host').set({ repUids: ['tester'], name: '主辦俱樂部', srcUpdatedAt: new Date() });
    const cc = await setupComp(TEAMS4);
    await db.doc(`competitions/${cc.cid}`).update({ hostType: 'club', hostTeamId: 'club_host' });
    await generate(cc, TESTER);
    await fails(call(handleCpHost, TESTER2, scheduleInput(cc)), 'NOT_HOST');
  });
});

describe('登錄比分、確認、棄權、重置、改期', () => {
  let c: Comp;
  beforeEach(async () => { await resetAll(); c = await setupComp(TEAMS4); await generate(c); });

  it('登錄並確認 → 積分榜重算；rev 只增', async () => {
    const r = await record(c, '甲', '乙', 2, 1);
    expect(r).toMatchObject({ status: 'confirmed', rev: 1 });
    const st = await standingOf(c);
    const by = Object.fromEntries(st!.rows.map(x => [c.nameOf[x.teamId], x]));
    expect(by['甲']).toMatchObject({ played: 1, win: 1, points: 3, goalsFor: 2, goalsAgainst: 1 });
    expect(by['乙']).toMatchObject({ played: 1, loss: 1, points: 0 });
    expect(by['甲'].name).toBe('甲');
    expect(orderNames(c, st!.rows)[0]).toBe('甲');
  });

  it('先登錄稍後確認：待確認不計積分；確認後才計', async () => {
    const ms = await matchesOf(c);
    const { m, score } = pairing(c, ms, '甲', '乙', 3, 0);
    await act(c, ADMIN, { action: 'recordResult', mtId: m.id, expectedRev: 0, score, confirm: false });
    expect((await standingOf(c))!.rows.every(x => x.played === 0)).toBe(true);
    await act(c, ADMIN, { action: 'confirmMatchResult', mtId: m.id, expectedRev: 1 });
    expect((await standingOf(c))!.rows.filter(x => x.played === 1).length).toBe(2);
  });

  it('輸入與狀態拒絕：版本衝突、未開賽、比分越界、PK、未知鍵、已確認不能再登錄', async () => {
    const ms = await matchesOf(c);
    const m = ms[0];
    const base = { action: 'recordResult', cid: c.cid, mtId: m.id, expectedRev: 0, score: { home: 1, away: 0 }, confirm: true };
    await fails(call(handleCpHost, ADMIN, base), 'MATCH_NOT_STARTED');
    await fails(call(handleCpHost, ADMIN, { ...base, expectedRev: 3 }, later()), 'REV_CONFLICT');
    await fails(call(handleCpHost, ADMIN, { ...base, score: { home: 100, away: 0 } }, later()), 'FIELD_RANGE');
    await fails(call(handleCpHost, ADMIN, { ...base, score: { home: 1, away: 0, pk: 3 } }, later()), 'UNKNOWN_FIELD');
    await fails(call(handleCpHost, ADMIN, { ...base, penaltyScore: { home: 4, away: 3 } }, later()), 'UNKNOWN_FIELD');
    await fails(call(handleCpHost, TESTER2, base, later()), 'NOT_HOST');
    await act(c, ADMIN, { action: 'recordResult', mtId: m.id, expectedRev: 0, score: { home: 1, away: 0 }, confirm: true });
    await fails(call(handleCpHost, ADMIN, { ...base, expectedRev: 1 }, later()), 'MATCH_STATE');
    await fails(call(handleCpHost, ADMIN, { action: 'confirmMatchResult', cid: c.cid, mtId: m.id, expectedRev: 1 }, later()), 'MATCH_STATE');
  });

  it('比分對帳：事件明細與場次比分不符時拒絕確認；作廢與重置前的事件不計；主辦登錄視為裁定', async () => {
    const ms = await matchesOf(c);
    const m = ms[1];
    const ref = adminDb().doc(`competitions/${c.cid}/matches/${m.id}`);
    // 模擬第 4 步記分員直寫：重置前的舊事件 e1（resetRev=1）、e2 主隊進球、e3 客隊進球、e4 作廢 e3；場次比分 2:0（錯）
    const now = new Date();
    await ref.collection('timeline').doc('e1').set({ seq: 1, type: 'goal', side: 'away', matchSecond: 10, createdAt: now });
    await ref.collection('timeline').doc('e2').set({ seq: 2, type: 'goal', side: 'home', matchSecond: 20, createdAt: now });
    await ref.collection('timeline').doc('e3').set({ seq: 3, type: 'goal', side: 'away', matchSecond: 30, createdAt: now });
    await ref.update({ status: 'finished', score: { home: 2, away: 0 }, rev: 3, resetRev: 1, lock: { locked: true }, finishedAt: now });
    await fails(call(handleCpHost, ADMIN, { action: 'confirmMatchResult', cid: c.cid, mtId: m.id, expectedRev: 3 }, later()), 'SCORE_MISMATCH');
    // 作廢 e3 → 有效 1:0，仍與 2:0 不符
    await ref.collection('voids').doc('3').set({ seq: 4, createdAt: now });
    await fails(call(handleCpHost, ADMIN, { action: 'confirmMatchResult', cid: c.cid, mtId: m.id, expectedRev: 3 }, later()), 'SCORE_MISMATCH');
    await ref.update({ score: { home: 1, away: 0 } });
    await act(c, ADMIN, { action: 'confirmMatchResult', mtId: m.id, expectedRev: 3 });
    expect((await ref.get()).get('status')).toBe('confirmed');
    // 主辦重置後改登錄 3:3（與事件不符，但 resultSource=host）可直接確認
    await act(c, ADMIN, { action: 'resetMatch', mtId: m.id, expectedRev: 4, reason: '記分錯誤' });
    await ref.collection('timeline').doc('e6').set({ seq: 6, type: 'goal', side: 'home', matchSecond: 5, createdAt: now });
    await act(c, ADMIN, { action: 'recordResult', mtId: m.id, expectedRev: 5, score: { home: 3, away: 3 }, confirm: false });
    await act(c, ADMIN, { action: 'confirmMatchResult', mtId: m.id, expectedRev: 6 });
    expect((await ref.get()).get('score')).toEqual({ home: 3, away: 3 });
  });

  it('PK 對帳：有 pk 事件時與 penaltyScore 不符拒絕；沒進與作廢不計；null 不同於 0:0；主辦登錄略過', async () => {
    const ms = await matchesOf(c);
    const now = new Date();
    const finish = async (m: (typeof ms)[number], patch: Record<string, unknown>) => {
      await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).update({
        status: 'finished', score: { home: 1, away: 1 }, rev: 4, resetRev: 0,
        lock: { locked: true }, finishedAt: now, ...patch
      });
    };
    const m = ms[1];
    const ref = adminDb().doc(`competitions/${c.cid}/matches/${m.id}`);
    await ref.collection('timeline').doc('e1').set({ seq: 1, type: 'pkStart', matchSecond: 10, createdAt: now });
    await ref.collection('timeline').doc('e2').set({ seq: 2, type: 'pk', side: 'home', scored: true, matchSecond: 20, createdAt: now });
    await ref.collection('timeline').doc('e3').set({ seq: 3, type: 'pk', side: 'away', scored: false, matchSecond: 30, createdAt: now });
    await ref.collection('timeline').doc('e4').set({ seq: 4, type: 'pk', side: 'away', scored: true, matchSecond: 40, createdAt: now });
    await finish(m, { penaltyScore: { home: 1, away: 0 } });
    await fails(call(handleCpHost, ADMIN, { action: 'confirmMatchResult', cid: c.cid, mtId: m.id, expectedRev: 4 }, later()), 'PENALTY_MISMATCH');
    await ref.collection('voids').doc('4').set({ seq: 5, createdAt: now });
    await act(c, ADMIN, { action: 'confirmMatchResult', mtId: m.id, expectedRev: 4 });
    expect((await ref.get()).get('status')).toBe('confirmed');

    const miss = ms[2];
    const missRef = adminDb().doc(`competitions/${c.cid}/matches/${miss.id}`);
    await missRef.collection('timeline').doc('e1').set({ seq: 1, type: 'pkStart', matchSecond: 5, createdAt: now });
    await missRef.collection('timeline').doc('e2').set({ seq: 2, type: 'pk', side: 'home', scored: false, matchSecond: 10, createdAt: now });
    await finish(miss, { penaltyScore: null });
    await fails(call(handleCpHost, ADMIN, { action: 'confirmMatchResult', cid: c.cid, mtId: miss.id, expectedRev: 4 }, later()), 'PENALTY_MISMATCH');
    await missRef.update({ penaltyScore: { home: 0, away: 0 } });
    await act(c, ADMIN, { action: 'confirmMatchResult', mtId: miss.id, expectedRev: 4 });

    const old = ms[3];
    const oldRef = adminDb().doc(`competitions/${c.cid}/matches/${old.id}`);
    await oldRef.collection('timeline').doc('e1').set({ seq: 1, type: 'pk', side: 'home', scored: true, matchSecond: 10, createdAt: now });
    await oldRef.collection('timeline').doc('e6').set({ seq: 6, type: 'pkStart', matchSecond: 15, createdAt: now });
    await oldRef.collection('timeline').doc('e7').set({ seq: 7, type: 'pk', side: 'away', scored: true, matchSecond: 20, createdAt: now });
    await finish(old, { rev: 7, resetRev: 5, penaltyScore: { home: 0, away: 1 } });
    await act(c, ADMIN, { action: 'confirmMatchResult', mtId: old.id, expectedRev: 7 });

    const host = ms[4];
    const hostRef = adminDb().doc(`competitions/${c.cid}/matches/${host.id}`);
    await hostRef.collection('timeline').doc('e1').set({ seq: 1, type: 'pkStart', matchSecond: 5, createdAt: now });
    await hostRef.collection('timeline').doc('e2').set({ seq: 2, type: 'pk', side: 'home', scored: true, matchSecond: 10, createdAt: now });
    await hostRef.collection('timeline').doc('e3').set({ seq: 3, type: 'goal', side: 'home', matchSecond: 15, createdAt: now });
    await finish(host, { penaltyScore: { home: 0, away: 0 }, resultSource: 'host' });
    await act(c, ADMIN, { action: 'confirmMatchResult', mtId: host.id, expectedRev: 4 });
    expect((await hostRef.get()).get('status')).toBe('confirmed');

    const none = ms[5];
    await finish(none, { penaltyScore: { home: 9, away: 9 } });
    await act(c, ADMIN, { action: 'confirmMatchResult', mtId: none.id, expectedRev: 4 });

    // 沒有 pkStart 的 pk 不對帳（shots 為 0），即使 penaltyScore 對不上也確認。
    const stray = ms[0];
    const strayRef = adminDb().doc(`competitions/${c.cid}/matches/${stray.id}`);
    await strayRef.collection('timeline').doc('e2').set({ seq: 2, type: 'pk', side: 'home', scored: true, matchSecond: 10, createdAt: now });
    await finish(stray, { penaltyScore: null });
    await act(c, ADMIN, { action: 'confirmMatchResult', mtId: stray.id, expectedRev: 4 });
  });

  it('顧問 §3.335 P2：主辦登錄非平手清掉 PK 比分、平手保留', async () => {
    const ms = await matchesOf(c);
    const now = new Date();
    const finish = async (m: (typeof ms)[number]) => {
      await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).update({
        status: 'finished', score: { home: 1, away: 1 }, rev: 4, resetRev: 0,
        lock: { locked: true }, finishedAt: now, penaltyScore: { home: 4, away: 3 }
      });
    };
    const win = ms[1];
    const winRef = adminDb().doc(`competitions/${c.cid}/matches/${win.id}`);
    await finish(win);
    await act(c, ADMIN, { action: 'recordResult', mtId: win.id, expectedRev: 4, score: { home: 2, away: 1 }, confirm: false });
    expect((await winRef.get()).get('penaltyScore')).toBeNull();
    expect((await winRef.get()).get('score')).toEqual({ home: 2, away: 1 });

    const tie = ms[2];
    const tieRef = adminDb().doc(`competitions/${c.cid}/matches/${tie.id}`);
    await finish(tie);
    await act(c, ADMIN, { action: 'recordResult', mtId: tie.id, expectedRev: 4, score: { home: 2, away: 2 }, confirm: false });
    expect((await tieRef.get()).get('penaltyScore')).toEqual({ home: 4, away: 3 });
    expect((await tieRef.get()).get('score')).toEqual({ home: 2, away: 2 });
  });

  it('pkStart 之後的一般 goal 一律 SCORE_MISMATCH；比分相同、已作廢也拒；主辦裁定略過', async () => {
    const ms = await matchesOf(c);
    const now = new Date();
    const finish = async (m: (typeof ms)[number], patch: Record<string, unknown>) => {
      await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).update({
        status: 'finished', score: { home: 1, away: 0 }, rev: 4, resetRev: 0,
        lock: { locked: true }, finishedAt: now, ...patch
      });
    };
    const matched = ms[0];
    const matchedRef = adminDb().doc(`competitions/${c.cid}/matches/${matched.id}`);
    await matchedRef.collection('timeline').doc('e1').set({ seq: 1, type: 'pkStart', matchSecond: 10, createdAt: now });
    await matchedRef.collection('timeline').doc('e2').set({ seq: 2, type: 'goal', side: 'home', matchSecond: 20, createdAt: now });
    await finish(matched, {});
    await fails(call(handleCpHost, ADMIN, { action: 'confirmMatchResult', cid: c.cid, mtId: matched.id, expectedRev: 4 }, later()), 'SCORE_MISMATCH');

    const voided = ms[1];
    const voidedRef = adminDb().doc(`competitions/${c.cid}/matches/${voided.id}`);
    await voidedRef.collection('timeline').doc('e1').set({ seq: 1, type: 'pkStart', matchSecond: 10, createdAt: now });
    await voidedRef.collection('timeline').doc('e2').set({ seq: 2, type: 'goal', side: 'home', matchSecond: 20, createdAt: now });
    await voidedRef.collection('voids').doc('2').set({ seq: 3, createdAt: now });
    await finish(voided, { score: { home: 0, away: 0 } });
    await fails(call(handleCpHost, ADMIN, { action: 'confirmMatchResult', cid: c.cid, mtId: voided.id, expectedRev: 4 }, later()), 'SCORE_MISMATCH');

    const before = ms[2];
    const beforeRef = adminDb().doc(`competitions/${c.cid}/matches/${before.id}`);
    await beforeRef.collection('timeline').doc('e1').set({ seq: 1, type: 'goal', side: 'home', matchSecond: 10, createdAt: now });
    await beforeRef.collection('timeline').doc('e2').set({ seq: 2, type: 'pkStart', matchSecond: 20, createdAt: now });
    await finish(before, {});
    await act(c, ADMIN, { action: 'confirmMatchResult', mtId: before.id, expectedRev: 4 });

    const host = ms[3];
    const hostRef = adminDb().doc(`competitions/${c.cid}/matches/${host.id}`);
    await hostRef.collection('timeline').doc('e1').set({ seq: 1, type: 'pkStart', matchSecond: 10, createdAt: now });
    await hostRef.collection('timeline').doc('e2').set({ seq: 2, type: 'goal', side: 'home', matchSecond: 20, createdAt: now });
    await finish(host, { resultSource: 'host' });
    await act(c, ADMIN, { action: 'confirmMatchResult', mtId: host.id, expectedRev: 4 });
    expect((await hostRef.get()).get('status')).toBe('confirmed');
  });

  it('確認對帳：timeline、voids 各 200 筆可確認；第 201 筆 TIMELINE_TOO_LONG', async () => {
    const ms = await matchesOf(c);
    const now = new Date();
    const fill = async (m: (typeof ms)[number], kind: 'timeline' | 'voids', n: number) => {
      const col = adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).collection(kind);
      const batch = adminDb().batch();
      for (let i = 1; i <= n; i++) {
        if (kind === 'timeline') batch.set(col.doc(`e${i}`), { seq: i, type: 'clock', matchSecond: i, createdAt: now });
        else batch.set(col.doc(String(i)), { seq: i, createdAt: now });
      }
      await batch.commit();
      await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).update({
        status: 'finished', score: { home: 0, away: 0 }, rev: n, resetRev: 0,
        lock: { locked: true }, finishedAt: now
      });
    };
    await fill(ms[0], 'timeline', 200);
    const meter = new ReadMeter();
    const deps = later();
    deps.meter = meter;
    await ok(call(handleCpHost, ADMIN, { action: 'confirmMatchResult', cid: c.cid, mtId: ms[0].id, expectedRev: 200 }, deps));
    // 閘門 1＋賽事 1＋場次 1＋timeline 200＋空 voids 查詢 1。
    expect(meter.reads).toBe(1 + 1 + 1 + 200 + 1);

    await fill(ms[1], 'timeline', 201);
    const overTl = new ReadMeter();
    const depsTl = later();
    depsTl.meter = overTl;
    await fails(call(handleCpHost, ADMIN, { action: 'confirmMatchResult', cid: c.cid, mtId: ms[1].id, expectedRev: 201 }, depsTl), 'TIMELINE_TOO_LONG');
    // 查詢多讀 1 筆才判斷超限：timeline 201＋空 voids 1。
    expect(overTl.reads).toBe(1 + 1 + 1 + 201 + 1);

    await fill(ms[2], 'voids', 201);
    const overVd = new ReadMeter();
    const depsVd = later();
    depsVd.meter = overVd;
    await fails(call(handleCpHost, ADMIN, { action: 'confirmMatchResult', cid: c.cid, mtId: ms[2].id, expectedRev: 201 }, depsVd), 'TIMELINE_TOO_LONG');
    expect(overVd.reads).toBe(1 + 1 + 1 + 1 + 201);
  });

  it('確認對帳：重置線以下的作廢標記不計入上限（K1 P3-2）', async () => {
    const ms = await matchesOf(c);
    const m = ms[3];
    const now = new Date();
    const ref = adminDb().doc(`competitions/${c.cid}/matches/${m.id}`);
    // 重置前累積 150 筆作廢標記（seq 1～150），重置線 150；重置後 60 筆事件、其中 60 筆作廢標記（seq 151～210）。
    // 舊查詢（不過濾）會讀到 210 筆標記而 TIMELINE_TOO_LONG；新查詢只讀重置線以上的 60 筆。
    const b1 = adminDb().batch();
    for (let i = 1; i <= 150; i++) b1.set(ref.collection('voids').doc(String(i)), { seq: i, createdAt: now });
    await b1.commit();
    const b2 = adminDb().batch();
    for (let i = 151; i <= 210; i++) {
      b2.set(ref.collection('timeline').doc(`e${i}`), { seq: i, type: 'clock', matchSecond: i - 150, createdAt: now });
      b2.set(ref.collection('voids').doc(String(i)), { seq: i, createdAt: now });
    }
    await b2.commit();
    await ref.update({ status: 'finished', score: { home: 0, away: 0 }, rev: 210, resetRev: 150, lock: { locked: true }, finishedAt: now });
    const meter = new ReadMeter();
    const deps = later();
    deps.meter = meter;
    await ok(call(handleCpHost, ADMIN, { action: 'confirmMatchResult', cid: c.cid, mtId: m.id, expectedRev: 210 }, deps));
    // 閘門 1＋賽事 1＋場次 1＋timeline 60＋voids 60（重置線以上）。
    expect(meter.reads).toBe(1 + 1 + 1 + 60 + 60);
  });

  it('棄權：判 0:2、不做比分對帳、原因必填且不進公開場次', async () => {
    const ms = await matchesOf(c);
    const { m } = pairing(c, ms, '甲', '乙', 0, 0);
    const forfeitSide = m.home.teamId === c.enIdOf['乙'] ? 'home' : 'away';
    await fails(call(handleCpHost, ADMIN, { action: 'setWalkover', cid: c.cid, mtId: m.id, expectedRev: 0, forfeitSide }, later()), 'FIELD_REQUIRED');
    await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).update({ penaltyScore: { home: 4, away: 3 } });
    await act(c, ADMIN, { action: 'setWalkover', mtId: m.id, expectedRev: 0, forfeitSide, reason: '乙隊人數不足' });
    const doc = (await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).data()!;
    expect(doc.status).toBe('walkover');
    expect(doc.penaltyScore).toBeNull();
    expect(doc.walkoverSide).toBe(forfeitSide);
    expect(JSON.stringify(doc)).not.toContain('人數不足');
    const by = Object.fromEntries((await standingOf(c))!.rows.map(x => [c.nameOf[x.teamId], x]));
    expect(by['甲']).toMatchObject({ points: 3, goalsFor: 2, goalsAgainst: 0 });
    expect(by['乙']).toMatchObject({ points: 0, loss: 1 });
  });

  it('重置：回未賽、比分歸 0、rev+1 且 resetRev＝新 rev、刪接手文件、積分移除這場', async () => {
    await record(c, '甲', '乙', 2, 0);
    const ms = await matchesOf(c);
    const { m } = pairing(c, ms, '甲', '乙', 0, 0);
    await adminDb().doc(`competitions/${c.cid}/matches/${m.id}/control/scorer`).set({ uid: 'tester', takenAt: new Date() });
    await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).update({ penaltyScore: { home: 4, away: 3 } });
    await fails(call(handleCpHost, ADMIN, { action: 'resetMatch', cid: c.cid, mtId: m.id, expectedRev: 1 }, later()), 'FIELD_REQUIRED');
    const r = await act(c, ADMIN, { action: 'resetMatch', mtId: m.id, expectedRev: 1, reason: '比分登錄錯誤' });
    expect(r).toMatchObject({ status: 'scheduled', rev: 2 });
    const doc = (await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).data()!;
    expect(doc).toMatchObject({ score: { home: 0, away: 0 }, penaltyScore: null, rev: 2, resetRev: 2, lock: { locked: false }, result: null, finishedAt: null });
    // resetMatch 一定把 resetRev 寫成新 rev。規則「缺值當 0」只適用於伺服器建立賽程時寫 0 的資料。
    expect(doc.resetRev).toBe(doc.rev);
    expect(doc.clockBase).toEqual({ startedAt: null, pausedSec: 0, running: false, period: 'pre' });
    expect((await adminDb().doc(`competitions/${c.cid}/matches/${m.id}/control/scorer`).get()).exists).toBe(false);
    expect((await standingOf(c))!.rows.every(x => x.played === 0)).toBe(true);
    await fails(call(handleCpHost, ADMIN, { action: 'resetMatch', cid: c.cid, mtId: m.id, expectedRev: 2, reason: '再一次' }, later()), 'NOTHING_TO_RESET');
  });

  it('改期：待定（null）→ postponed 並移到 tbd 摘要片；再排回時間 → scheduled', async () => {
    const m = (await matchesOf(c))[0];
    await act(c, ADMIN, { action: 'rescheduleMatch', mtId: m.id, expectedRev: 0, kickoffAt: null, venueIdx: null }, makeDeps());
    const tbd = await adminDb().doc(`competitions/${c.cid}/summary/tbd`).get();
    expect(Object.keys(tbd.get('m'))).toEqual([m.id]);
    const others = await adminDb().collection(`competitions/${c.cid}/summary`).get();
    expect(others.docs.filter(d => d.id !== 'tbd').flatMap(d => Object.keys(d.get('m')))).not.toContain(m.id);
    const comp = (await adminDb().doc(`competitions/${c.cid}`).get()).data()!;
    const k = comp.firstMatchAt.toMillis() + 3600_000;
    // F2：原末場後 60 天內可以延後。加 70 天仍超過上限。
    await fails(call(handleCpHost, ADMIN, { action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: 1, kickoffAt: k + 70 * DAY, venueIdx: 1 }), 'SCHEDULE_OUT_OF_RANGE');
    // 排回首場日 06:00（賽程從 08:00 起），新的撞期檢查不會擋下「再排回時間」。
    const first = comp.firstMatchAt.toMillis();
    const back = first - (first + 8 * 3600_000) % DAY + 6 * 3600_000;
    await act(c, ADMIN, { action: 'rescheduleMatch', mtId: m.id, expectedRev: 1, kickoffAt: back, venueIdx: 1 }, makeDeps());
    const doc = (await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).data()!;
    expect(doc).toMatchObject({ status: 'scheduled', venueName: 'B 場', rev: 2 });
    expect((await adminDb().doc(`competitions/${c.cid}/summary/tbd`).get()).exists).toBe(false);
  });

  it('末場確認自動結束（endedBy confirm）；重置任一場清除；寬限過後主辦不能改、管理員可以', async () => {
    const pairs: Array<[string, string]> = [['甲', '乙'], ['甲', '丙'], ['甲', '丁'], ['乙', '丙'], ['乙', '丁'], ['丙', '丁']];
    for (const [h, a] of pairs) await record(c, h, a, 1, 0);
    let comp = (await adminDb().doc(`competitions/${c.cid}`).get()).data()!;
    expect(comp.endedBy).toBe('confirm');
    expect(comp.endedAt).toBeTruthy();
    const ms = await matchesOf(c);
    await act(c, ADMIN, { action: 'resetMatch', mtId: ms[0].id, expectedRev: ms[0].rev, reason: '更正' });
    comp = (await adminDb().doc(`competitions/${c.cid}`).get()).data()!;
    expect(comp.endedAt).toBeNull();
    await record(c, c.nameOf[ms[0].home.teamId], c.nameOf[ms[0].away.teamId], 0, 0);
    expect((await adminDb().doc(`competitions/${c.cid}`).get()).get('endedBy')).toBe('confirm');
    // 寬限 3 天後：測試者（非管理員主辦）被擋、管理員可改
    await adminDb().doc(`competitions/${c.cid}/staff/tester`).set({ roles: ['coHost'], matchIds: [] });
    const m0 = (await matchesOf(c))[0];
    const afterGrace = makeDeps(LATER + 4 * DAY);
    await fails(call(handleCpHost, TESTER, { action: 'resetMatch', cid: c.cid, mtId: m0.id, expectedRev: m0.rev, reason: '更正' }, afterGrace), 'COMPETITION_ENDED');
    await act(c, ADMIN, { action: 'resetMatch', mtId: m0.id, expectedRev: m0.rev, reason: '更正' }, afterGrace);
  });

  it('共同主辦可登錄；下架中主辦不能改；延期中的賽事不能登錄', async () => {
    await adminDb().doc(`competitions/${c.cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [] });
    await record(c, '甲', '乙', 1, 1, true, TESTER2);
    const m = (await matchesOf(c)).find(x => x.status === 'scheduled')!;
    await adminDb().doc(`competitions/${c.cid}`).update({ hidden: true });
    await fails(call(handleCpHost, TESTER2, { action: 'recordResult', cid: c.cid, mtId: m.id, expectedRev: 0, score: { home: 1, away: 0 }, confirm: true }, later()), 'COMPETITION_HIDDEN');
    await adminDb().doc(`competitions/${c.cid}`).update({ hidden: false, status: 'postponed' });
    await fails(call(handleCpHost, TESTER2, { action: 'recordResult', cid: c.cid, mtId: m.id, expectedRev: 0, score: { home: 1, away: 0 }, confirm: true }, later()), 'STATUS_NOT_EDITABLE');
  });
});

describe('觸發器：增量＝全量、冪等、亂序', () => {
  beforeEach(() => resetAll());

  it('6 隊隨機結果：每場確認後增量積分 ＝ recalcStandings 全量重算（名次與數字）', async () => {
    const teams = ['一', '二', '三', '四', '五', '六'];
    const c = await setupComp(teams);
    await generate(c);
    const ms = await matchesOf(c);
    let s = 11;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) % 4;
    for (const m of ms.slice(0, 12)) {
      await act(c, ADMIN, { action: 'recordResult', mtId: m.id, expectedRev: 0, score: { home: rnd(), away: rnd() }, confirm: true });
    }
    const inc = await standingOf(c);
    await ok(call(handleCpHost, ADMIN, { action: 'recalcStandings', cid: c.cid, dvId: c.dvId }, later()));
    const full = await standingOf(c);
    const strip = (rows: typeof inc.rows) => rows.map(({ teamId, played, win, draw, loss, goalsFor, goalsAgainst, goalDiff, points, rank }) =>
      ({ teamId, played, win, draw, loss, goalsFor, goalsAgainst, goalDiff, points, rank }));
    expect(strip(full!.rows)).toEqual(strip(inc!.rows));
    expect(full!.version).toBe(inc!.version + 1);
  });

  it('同一事件重送兩次結果相同；用過期的 before 重跑也收斂到目前狀態', async () => {
    const c = await setupComp(TEAMS4);
    await generate(c);
    const m = (await matchesOf(c))[0];
    const before = (await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).data()!;
    await ok(call(handleCpHost, ADMIN, { action: 'recordResult', cid: c.cid, mtId: m.id, expectedRev: 0, score: { home: 4, away: 1 }, confirm: true }, later()));
    // 觸發器還沒跑之前又被重置（亂序：重置的事件先到）
    await ok(call(handleCpHost, ADMIN, { action: 'resetMatch', cid: c.cid, mtId: m.id, expectedRev: 1, reason: '更正' }, later()));
    const deps = later();
    await handleMatchWritten(deps, c.cid, m.id, { ...before, status: 'confirmed' }, null);
    await handleMatchWritten(deps, c.cid, m.id, before, null);
    await handleMatchWritten(deps, c.cid, m.id, before, null);
    const st = await standingOf(c);
    expect(st!.rows.every(x => x.played === 0)).toBe(true);
  });

  it('只改時鐘等非監聽欄位時不處理（§6.4）', async () => {
    const c = await setupComp(TEAMS4);
    await generate(c);
    const m = (await matchesOf(c))[0];
    const before = (await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).data()!;
    const r = await handleMatchWritten(later(), c.cid, m.id, before, { ...before, clockBase: { ...before.clockBase, pausedSec: 30 } });
    expect(r).toEqual({ summary: false, standing: false, ended: null });
  });

  it('只改 penaltyScore 會重寫摘要 p；清回 null 後 p 消失', async () => {
    const c = await setupComp(TEAMS4);
    await generate(c);
    const m = (await matchesOf(c))[0];
    const ref = adminDb().doc(`competitions/${c.cid}/matches/${m.id}`);
    const before = (await ref.get()).data()!;
    const entryOf = async () => {
      const shards = await adminDb().collection(`competitions/${c.cid}/summary`).get();
      return shards.docs.map(d => d.get('m')?.[m.id]).find(Boolean) as { p?: [number, number] };
    };
    expect((await entryOf()).p).toBeUndefined();
    await ref.update({ penaltyScore: { home: 4, away: 3 } });
    const wrote = await handleMatchWritten(later(), c.cid, m.id, before, { ...before, penaltyScore: { home: 4, away: 3 } });
    expect(wrote.summary).toBe(true);
    expect((await entryOf()).p).toEqual([4, 3]);
    const withPk = (await ref.get()).data()!;
    await ref.update({ penaltyScore: null });
    await handleMatchWritten(later(), c.cid, m.id, withPk, { ...withPk, penaltyScore: null });
    expect((await entryOf()).p).toBeUndefined();
  });
});

describe('Opus 終審補測：多組別結束、棄權結束、寬限內主辦、拒絕路徑', () => {
  beforeEach(() => resetAll());

  it('P1-1 兩個組別：只有一組打完不判結束；兩組都排完打完才結束；寬限過後主辦仍能登錄另一組', async () => {
    const c = await setupComp(TEAMS4);
    // 第二個組別（直接種：2 隊已核准，名單已鎖）
    const db = adminDb();
    const dv2 = 'dv_' + 'B'.repeat(20);
    await db.doc(`competitions/${c.cid}/divisions/${dv2}`).set({ name: '青年組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 10, order: 1 });
    for (const [i, name] of ['子', '丑'].entries()) {
      await db.doc(`competitions/${c.cid}/entries/en_${String(i).repeat(20)}`).set({ dvId: dv2, teamId: `club_x${i}`, name, status: 'approved', rosterCount: 1, rosterConfirmed: true });
    }
    await generate(c);
    for (const [h, a] of [['甲', '乙'], ['甲', '丙'], ['甲', '丁'], ['乙', '丙'], ['乙', '丁'], ['丙', '丁']]) await record(c, h, a, 1, 0);
    expect((await db.doc(`competitions/${c.cid}`).get()).get('endedAt') ?? null).toBeNull();
    const c2 = { ...c, dvId: dv2, enIdOf: { 子: 'en_' + '0'.repeat(20), 丑: 'en_' + '1'.repeat(20) }, nameOf: { ['en_' + '0'.repeat(20)]: '子', ['en_' + '1'.repeat(20)]: '丑' } };
    await adminDb().doc(`competitions/${c.cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [] });
    await generate(c2, TESTER2, {}, makeDeps(LATER + 4 * DAY));
    await record(c2, '子', '丑', 2, 0, true, TESTER2);
    const comp = (await db.doc(`competitions/${c.cid}`).get()).data()!;
    expect(comp.endedBy).toBe('confirm');
  });

  it('棄權讓最後一場計入時也會結束；寬限內主辦（共同主辦）可重置', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    const m = (await matchesOf(c))[0];
    await act(c, ADMIN, { action: 'setWalkover', mtId: m.id, expectedRev: 0, forfeitSide: 'home', reason: '未到場' });
    expect((await adminDb().doc(`competitions/${c.cid}`).get()).get('endedBy')).toBe('confirm');
    // 測試時鐘：伺服器 endedAt 是真實時間、動作用 +25 天的時鐘；把 endedAt 對齊到測試時鐘的「1 天前」
    const { Timestamp } = await import('firebase-admin/firestore');
    await adminDb().doc(`competitions/${c.cid}`).update({ endedAt: Timestamp.fromMillis(Date.now() + LATER - DAY) });
    await adminDb().doc(`competitions/${c.cid}/staff/tester2`).set({ roles: ['coHost'], matchIds: [] });
    await act(c, TESTER2, { action: 'resetMatch', mtId: m.id, expectedRev: 1, reason: '判錯隊' });
    expect((await adminDb().doc(`competitions/${c.cid}`).get()).get('endedAt')).toBeNull();
  });

  it('拒絕路徑：recalcStandings 非主辦、沒賽程；已確認不能棄權；待確認／已確認不能改期', async () => {
    const c = await setupComp(TEAMS4);
    await fails(call(handleCpHost, ADMIN, { action: 'recalcStandings', cid: c.cid, dvId: c.dvId }), 'SCHEDULE_REQUIRED');
    await generate(c);
    await fails(call(handleCpHost, TESTER2, { action: 'recalcStandings', cid: c.cid, dvId: c.dvId }), 'NOT_HOST');
    await fails(call(handleCpHost, STRANGER, { action: 'recalcStandings', cid: c.cid, dvId: c.dvId }), 'INTERNAL_PERIOD');
    const ms = await matchesOf(c);
    await act(c, ADMIN, { action: 'recordResult', mtId: ms[0].id, expectedRev: 0, score: { home: 1, away: 0 }, confirm: true });
    await act(c, ADMIN, { action: 'recordResult', mtId: ms[1].id, expectedRev: 0, score: { home: 1, away: 0 }, confirm: false });
    await fails(call(handleCpHost, ADMIN, { action: 'setWalkover', cid: c.cid, mtId: ms[0].id, expectedRev: 1, forfeitSide: 'home', reason: '測試' }, later()), 'MATCH_STATE');
    for (const m of [ms[0], ms[1]]) {
      await fails(call(handleCpHost, ADMIN, { action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: 1, kickoffAt: null, venueIdx: null }), 'MATCH_STATE');
    }
  });

  it('重排沿用積分榜版本（不倒退）', async () => {
    const c = await setupComp(TEAMS4);
    await generate(c);
    const v1 = (await standingOf(c))!.version;
    await ok(call(handleCpHost, ADMIN, { action: 'recalcStandings', cid: c.cid, dvId: c.dvId }));
    const v2 = (await standingOf(c))!.version;
    await generate(c);
    expect(v2).toBeGreaterThan(v1);
    expect((await standingOf(c))!.version).toBe(v2 + 1);
  });
});

describe('Grok 審查補測', () => {
  beforeEach(() => resetAll());

  it('主辦登錄（先登錄）後清掉目前記分者，記分員不能撤回主辦結果', async () => {
    const c = await setupComp(TEAMS4);
    await generate(c);
    const m = (await matchesOf(c))[0];
    const ctl = adminDb().doc(`competitions/${c.cid}/matches/${m.id}/control/scorer`);
    await ctl.set({ uid: 'tester', takenAt: new Date() });
    await act(c, ADMIN, { action: 'recordResult', mtId: m.id, expectedRev: 0, score: { home: 1, away: 0 }, confirm: false });
    expect((await ctl.get()).exists).toBe(false);
  });

  it('改期把場次散到很多天後直接重排：寫入數超過上限時失敗關閉（不寫），先清除再排可以', async () => {
    const teams = Array.from({ length: 14 }, (_, k) => `隊${k + 1}`);
    const c = await setupComp(teams);
    const big = { legs: 2, matchMinutes: 5, bufferMinutes: 0, days: c.days.map(date => ({ date, start: '06:00', end: '23:55' })) };
    await generate(c, ADMIN, big);
    const ms = await matchesOf(c);
    expect(ms.length).toBe(182);
    // 模擬改期：把 182 場散到 182 個不同日期（直接改文件，等同逐場 rescheduleMatch 的結果）
    const db = adminDb();
    const base = (await db.doc(`competitions/${c.cid}`).get()).get('firstMatchAt').toMillis();
    for (let k = 0; k < ms.length; k += 400) {
      const b = db.batch();
      ms.slice(k, k + 400).forEach((m, n) => b.update(db.doc(`competitions/${c.cid}/matches/${m.id}`), { kickoffAt: new Date(base + (k + n) * 86400_000) }));
      await b.commit();
    }
    await fails(call(handleCpHost, ADMIN, scheduleInput(c, big)), 'SCHEDULE_REPLACE_TOO_LARGE');
    expect((await matchesOf(c)).map(m => m.id).sort()).toEqual(ms.map(m => m.id).sort());
    await ok(call(handleCpHost, ADMIN, { action: 'clearSchedule', cid: c.cid, dvId: c.dvId }));
    await generate(c, ADMIN, big);
    expect((await matchesOf(c)).length).toBe(182);
  }, 120_000);
});
