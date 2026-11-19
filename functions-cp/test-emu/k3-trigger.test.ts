/**
 * K3 模擬器：接手稽核、射手榜確認／重置、冠軍名、每事件讀量。
 * 觸發器由測試直接呼叫處理函式。本檔只寫、不在派工時執行。
 */
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { ReadMeter, actorHash } from '../src/cp/context.js';
import { handleCpHost } from '../src/cp/host.js';
import { handleMatchWritten } from '../src/cp/match-trigger.js';
import { handleScorerWritten } from '../src/cp/scorer-trigger.js';
import { summaryEntryOf, summaryShardIdOf } from '../src/cp/summary.js';
import { statsRef, syncMatchStats } from '../src/cp/stats.js';
import { ADMIN, DAY, TESTER, call, makeDeps, ok, resetAll } from './_cp.js';
import { act, generate, later, matchesOf, record, setupComp, type Comp } from './_step3.js';

const CID = 'cp_' + 'c'.repeat(20);
const DVID = 'dv_' + 'd'.repeat(20);
const MT = 'mt_' + 'm'.repeat(20);
const PLA = 'pl_' + 'a'.repeat(20);
const PLB = 'pl_' + 'b'.repeat(20);

function kickoff(): Timestamp {
  return Timestamp.fromMillis(Date.parse('2026-06-01T08:00:00+08:00'));
}

function liveMatch(over: Record<string, unknown> = {}) {
  const kick = kickoff();
  return {
    divisionId: DVID,
    stageId: 'group',
    groupId: 'A',
    matchNo: 1,
    round: 1,
    venueName: 'A場',
    home: { teamId: 'en_' + 'h'.repeat(20), name: '甲' },
    away: { teamId: 'en_' + 'a'.repeat(20), name: '乙' },
    score: { home: 0, away: 0 },
    penaltyScore: null,
    status: 'scheduled',
    rev: 1,
    resetRev: 0,
    walkoverSide: null,
    ...over,
    kickoffAt: (over.kickoffAt as Timestamp | undefined) ?? kick
  };
}

async function seedShard(match: Record<string, unknown>) {
  const kick = kickoff().toMillis();
  const shard = summaryShardIdOf(kick);
  await adminDb().doc(`competitions/${CID}/matches/${MT}`).set(match);
  await adminDb().doc(`competitions/${CID}/summary/${shard}`).set({
    m: { [MT]: summaryEntryOf(match, kick) }
  });
  return shard;
}

describe('K3 接手稽核', () => {
  const uid = 'ScorerPlaintextUID';
  const sid = 'sid-secret-value';
  const ms = 1_700_000_000_000;

  beforeEach(() => resetAll());

  it('建立寫雜湊 id；重送、同一人換 sid、刪除都不另寫；換人寫前一任雜湊', async () => {
    const deps = makeDeps();
    const takenAt = Timestamp.fromMillis(ms);
    const wrote = await handleScorerWritten(deps, CID, MT, null, { uid, sid, takenAt });
    expect(wrote).toBe(true);
    const id = `tk_${ms}_${MT}_${actorHash(CID, uid)}`;
    const snap = await adminDb().doc(`competitions/${CID}/audits/${id}`).get();
    expect(snap.exists).toBe(true);
    expect(snap.id).toMatch(/^tk_\d+_mt_[A-Za-z0-9]{20}_[0-9a-f]{16}$/);
    const data = snap.data()!;
    expect(data).toMatchObject({
      action: 'takeScorer', actor: actorHash(CID, uid), mtId: MT, sidChanged: false, prev: null
    });
    expect(data.takenAt.toMillis()).toBe(ms);
    expect(data.uid).toBeUndefined();
    expect(data.sid).toBeUndefined();
    const packed = JSON.stringify({ id: snap.id, action: data.action, actor: data.actor, mtId: data.mtId, prev: data.prev });
    expect(packed.includes(uid)).toBe(false);
    expect(packed.includes(sid)).toBe(false);

    expect(await handleScorerWritten(deps, CID, MT, { uid, sid, takenAt }, { uid, sid, takenAt })).toBe(false);
    expect(await handleScorerWritten(deps, CID, MT, { uid, sid, takenAt }, { uid, sid: 'other-sid-value', takenAt: Timestamp.fromMillis(ms + 50) })).toBe(false);
    expect((await adminDb().collection(`competitions/${CID}/audits`).get()).size).toBe(1);

    const next = 'NextScorerPlainUID';
    const ms2 = ms + 1000;
    const changed = await handleScorerWritten(
      deps, CID, MT,
      { uid, sid, takenAt },
      { uid: next, sid: 'new-sid-value', takenAt: Timestamp.fromMillis(ms2) }
    );
    expect(changed).toBe(true);
    const nextId = `tk_${ms2}_${MT}_${actorHash(CID, next)}`;
    const nextDoc = (await adminDb().doc(`competitions/${CID}/audits/${nextId}`).get()).data()!;
    expect(nextDoc.prev).toBe(actorHash(CID, uid));
    expect(nextDoc.sidChanged).toBe(true);
    expect(JSON.stringify({ id: nextId, actor: nextDoc.actor, prev: nextDoc.prev }).includes(next)).toBe(false);
    expect(JSON.stringify(nextDoc).includes('new-sid-value')).toBe(false);

    const beforeDelete = (await adminDb().collection(`competitions/${CID}/audits`).get()).size;
    expect(await handleScorerWritten(deps, CID, MT, { uid: next, sid: 'new-sid-value', takenAt: Timestamp.fromMillis(ms2) }, null)).toBe(false);
    expect((await adminDb().collection(`competitions/${CID}/audits`).get()).size).toBe(beforeDelete);

    expect(await handleScorerWritten(deps, CID, MT, null, { uid: '', takenAt })).toBe(false);
  });

  it('同一人同一毫秒接手兩場各寫一筆', async () => {
    const deps = makeDeps();
    const mt2 = 'mt_' + 'n'.repeat(20);
    const takenAt = Timestamp.fromMillis(ms);
    expect(await handleScorerWritten(deps, CID, MT, null, { uid, sid, takenAt })).toBe(true);
    expect(await handleScorerWritten(deps, CID, mt2, null, { uid, sid, takenAt })).toBe(true);
    const hash = actorHash(CID, uid);
    const first = await adminDb().doc(`competitions/${CID}/audits/tk_${ms}_${MT}_${hash}`).get();
    const second = await adminDb().doc(`competitions/${CID}/audits/tk_${ms}_${mt2}_${hash}`).get();
    expect(first.exists).toBe(true);
    expect(second.exists).toBe(true);
    expect(first.get('mtId')).toBe(MT);
    expect(second.get('mtId')).toBe(mt2);
    expect(first.get('actor')).toBe(hash);
    expect(second.get('actor')).toBe(hash);
    expect((await adminDb().collection(`competitions/${CID}/audits`).get()).size).toBe(2);
    expect(JSON.stringify([first.id, second.id, first.get('actor'), second.get('actor')]).includes(uid)).toBe(false);
  });
});

describe('K3 每事件讀量與統計讀數', () => {
  beforeEach(() => resetAll());

  it('牌與換人 2 讀 0 寫；進球 2 讀 1 寫，且不寫射手榜', async () => {
    const base = liveMatch();
    const shard = await seedShard(base);
    const ref = adminDb().doc(`competitions/${CID}/matches/${MT}`);

    await ref.update({ rev: 2 });
    const afterCard = (await ref.get()).data()!;
    const cardMeter = new ReadMeter();
    const card = await handleMatchWritten(makeDeps(0, cardMeter), CID, MT, base, afterCard);
    expect(cardMeter.reads).toBe(2);
    expect(card).toEqual({ summary: false, standing: false, ended: null });

    await ref.update({ rev: 3 });
    const afterSub = (await ref.get()).data()!;
    const subMeter = new ReadMeter();
    const sub = await handleMatchWritten(makeDeps(0, subMeter), CID, MT, afterCard, afterSub);
    expect(subMeter.reads).toBe(2);
    expect(sub).toEqual({ summary: false, standing: false, ended: null });

    await ref.update({ rev: 4, score: { home: 1, away: 0 } });
    const afterGoal = (await ref.get()).data()!;
    const goalMeter = new ReadMeter();
    const goal = await handleMatchWritten(makeDeps(0, goalMeter), CID, MT, afterSub, afterGoal);
    expect(goalMeter.reads).toBe(2);
    expect(goal).toEqual({ summary: true, standing: false, ended: null });
    expect((await adminDb().doc(`competitions/${CID}/summary/${shard}`).get()).get('m')[MT].s).toEqual([1, 0]);
    expect((await adminDb().doc(statsRef(CID, DVID)).get()).exists).toBe(false);
  });

  it('確認且沒有事件：統計 4 讀，寫空的 m[mtId]', async () => {
    await adminDb().doc(`competitions/${CID}/matches/${MT}`).set(liveMatch({ status: 'confirmed' }));
    const meter = new ReadMeter();
    const result = await syncMatchStats(makeDeps(0, meter), CID, MT, null);
    expect(result).toBe('set');
    expect(meter.reads).toBe(4);
    expect((await adminDb().doc(statsRef(CID, DVID)).get()).get('m')[MT]).toEqual({});
  });

  it('有事件時讀數＝場次＋timeline＋voids＋名單＋統計文件；超過 22 人不讀名單', async () => {
    const db = adminDb();
    await db.doc(`competitions/${CID}/matches/${MT}`).set(liveMatch({ status: 'confirmed', rev: 2 }));
    const tl = db.collection(`competitions/${CID}/matches/${MT}/timeline`);
    await tl.doc('1').set({ seq: 1, type: 'goal', goalKind: 'normal', plId: PLA });
    await tl.doc('2').set({ seq: 2, type: 'card', cardType: 'yellow', plId: PLB });
    await db.doc(`competitions/${CID}/roster/${PLA}`).set({ displayName: '王大明' });
    await db.doc(`competitions/${CID}/roster/${PLB}`).set({ displayName: '李小華' });
    const meter = new ReadMeter();
    expect(await syncMatchStats(makeDeps(0, meter), CID, MT, null)).toBe('set');
    expect(meter.reads).toBe(1 + 2 + 1 + 2 + 1);
    const row = (await db.doc(statsRef(CID, DVID)).get()).get('m')[MT];
    expect(row[PLA]).toEqual({ n: '王大明', g: 1, y: 0, r: 0 });
    expect(row[PLB]).toEqual({ n: '李小華', g: 0, y: 1, r: 0 });

    const many = 'mt_' + 'n'.repeat(20);
    await db.doc(`competitions/${CID}/matches/${many}`).set(liveMatch({ status: 'confirmed' }));
    const batch = db.batch();
    for (let i = 0; i < 23; i++) {
      const plId = `pl_${String(i).padStart(20, '0')}`;
      batch.set(db.doc(`competitions/${CID}/matches/${many}/timeline/${i + 1}`), {
        seq: i + 1, type: 'goal', goalKind: 'normal', plId
      });
    }
    await batch.commit();
    await db.doc(`competitions/${CID}/roster/pl_${'0'.repeat(20)}`).set({ displayName: '不該出現' });
    const over = new ReadMeter();
    expect(await syncMatchStats(makeDeps(0, over), CID, many, null)).toBe('set');
    expect(over.reads).toBe(1 + 23 + 1 + 1);
    const lines = (await db.doc(statsRef(CID, DVID)).get()).get('m')[many] as Record<string, { n?: string }>;
    expect(Object.keys(lines)).toHaveLength(23);
    expect(Object.values(lines).every(line => line.n == null)).toBe(true);
  });

  it('超過 200 筆事件不更新，舊的 m[mtId] 留著', async () => {
    const db = adminDb();
    await db.doc(`competitions/${CID}/matches/${MT}`).set(liveMatch({ status: 'confirmed' }));
    const kept = { [PLA]: { g: 9, y: 0, r: 0 } };
    await db.doc(statsRef(CID, DVID)).set({ m: { [MT]: kept } });
    const batch = db.batch();
    const tl = `competitions/${CID}/matches/${MT}/timeline`;
    for (let i = 1; i <= 201; i++) {
      batch.set(db.doc(`${tl}/${i}`), { seq: i, type: 'goal', goalKind: 'normal', plId: PLA });
    }
    await batch.commit();
    expect(await syncMatchStats(makeDeps(), CID, MT, null)).toBe('reject');
    expect((await db.doc(statsRef(CID, DVID)).get()).get('m')[MT]).toEqual(kept);
  });
});

describe('K3 確認、重置、再確認與冠軍名', () => {
  beforeEach(() => resetAll());

  it('確認寫入進球與牌；重置刪掉 m[mtId]；再確認只算重置線之後', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    const db = adminDb();
    const m = (await matchesOf(c))[0]!;
    await db.doc(`competitions/${c.cid}/roster/${PLA}`).set({ displayName: '王大明' });
    const tl = db.collection(`competitions/${c.cid}/matches/${m.id}/timeline`);
    const batch = db.batch();
    batch.set(tl.doc('1'), { seq: 1, type: 'goal', goalKind: 'normal', plId: PLA });
    batch.set(tl.doc('2'), { seq: 2, type: 'goal', goalKind: 'normal', plId: PLA });
    batch.set(db.doc(`competitions/${c.cid}/matches/${m.id}/voids/2`), { seq: 3 });
    batch.set(tl.doc('4'), { seq: 4, type: 'goal', goalKind: 'penalty', plId: PLA });
    batch.set(tl.doc('5'), { seq: 5, type: 'pk', plId: PLA, scored: true });
    batch.set(tl.doc('6'), { seq: 6, type: 'goal', goalKind: 'own', plId: PLA });
    batch.set(tl.doc('7'), { seq: 7, type: 'card', cardType: 'yellow', plId: PLB });
    batch.set(tl.doc('8'), { seq: 8, type: 'card', cardType: 'second_yellow', plId: PLB, refSeq: 7 });
    await batch.commit();
    await db.doc(`competitions/${c.cid}/matches/${m.id}`).update({ rev: 8 });

    await act(c, ADMIN, { action: 'recordResult', mtId: m.id, expectedRev: 8, score: { home: 2, away: 0 }, confirm: true });
    const first = (await db.doc(statsRef(c.cid, c.dvId)).get()).get('m')[m.id];
    expect(first[PLA]).toEqual({ n: '王大明', g: 2, y: 0, r: 0 });
    expect(first[PLB]).toEqual({ g: 0, y: 1, r: 1 });
    expect(first[PLB].n).toBeUndefined();
    expect((await db.doc(`competitions/${c.cid}/rosterPrivate/${PLA}`).get()).exists).toBe(false);

    await act(c, ADMIN, { action: 'resetMatch', mtId: m.id, expectedRev: 9, reason: '更正' });
    expect((await db.doc(statsRef(c.cid, c.dvId)).get()).get('m')?.[m.id]).toBeUndefined();

    await tl.doc('11').set({ seq: 11, type: 'goal', goalKind: 'normal', plId: PLA });
    await act(c, ADMIN, { action: 'recordResult', mtId: m.id, expectedRev: 10, score: { home: 1, away: 0 }, confirm: true });
    const again = (await db.doc(statsRef(c.cid, c.dvId)).get()).get('m')[m.id];
    expect(again[PLA]).toEqual({ n: '王大明', g: 1, y: 0, r: 0 });
    expect(again[PLB]).toBeUndefined();
  });

  it('棄權不寫射手榜，仍可依積分寫冠軍名', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    const m = (await matchesOf(c))[0]!;
    await act(c, ADMIN, { action: 'setWalkover', mtId: m.id, expectedRev: 0, forfeitSide: 'home', reason: '未到場' });
    expect((await adminDb().doc(statsRef(c.cid, c.dvId)).get()).exists).toBe(false);
    expect((await adminDb().doc(`competitions/${c.cid}`).get()).get('champions')).toEqual([{ dv: c.dvId, n: m.away.name }]);
  });

  it('分出勝負寫冠軍；平手寫空陣列；重置刪欄；再確認寫回', async () => {
    const drawn = await setupComp(['甲', '乙']);
    await generate(drawn);
    await record(drawn, '甲', '乙', 0, 0);
    const drawDoc = (await adminDb().doc(`competitions/${drawn.cid}`).get()).data()!;
    expect(drawDoc.endedBy).toBe('confirm');
    expect(drawDoc.champions).toEqual([]);

    const c = await setupComp(['甲', '乙']);
    await generate(c);
    await record(c, '甲', '乙', 1, 0);
    const win = (await adminDb().doc(`competitions/${c.cid}`).get()).data()!;
    expect(win.champions).toEqual([{ dv: c.dvId, n: '甲' }]);
    expect(Object.keys(win.champions[0])).toEqual(['dv', 'n']);

    const m = (await matchesOf(c))[0]!;
    await act(c, ADMIN, { action: 'resetMatch', mtId: m.id, expectedRev: m.rev, reason: '更正' });
    const cleared = (await adminDb().doc(`competitions/${c.cid}`).get()).data()!;
    expect(cleared.endedAt).toBeNull();
    expect(cleared.champions).toBeUndefined();

    await act(c, ADMIN, { action: 'recordResult', mtId: m.id, expectedRev: m.rev + 1, score: { home: m.home.name === '甲' ? 1 : 0, away: m.away.name === '甲' ? 1 : 0 }, confirm: true });
    expect((await adminDb().doc(`competitions/${c.cid}`).get()).get('champions')).toEqual([{ dv: c.dvId, n: '甲' }]);
  });

  it('兩組只寫已分開的第 1 名；手動結束不寫冠軍；重排清掉冠軍名', async () => {
    const c = await setupComp(['甲', '乙']);
    const db = adminDb();
    const dv2 = 'dv_' + 'B'.repeat(20);
    await db.doc(`competitions/${c.cid}/divisions/${dv2}`).set({
      name: '青年組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 10, order: 1
    });
    for (const [i, name] of ['子', '丑'].entries()) {
      await db.doc(`competitions/${c.cid}/entries/en_${String(i).repeat(20)}`).set({
        dvId: dv2, teamId: `club_x${i}`, name, status: 'approved', rosterCount: 1, rosterConfirmed: true
      });
    }
    const c2: Comp = {
      ...c,
      dvId: dv2,
      enIdOf: { 子: 'en_' + '0'.repeat(20), 丑: 'en_' + '1'.repeat(20) },
      nameOf: { ['en_' + '0'.repeat(20)]: '子', ['en_' + '1'.repeat(20)]: '丑' }
    };
    await generate(c);
    await generate(c2);
    await record(c, '甲', '乙', 1, 0);
    expect((await db.doc(`competitions/${c.cid}`).get()).get('endedAt') ?? null).toBeNull();
    await record(c2, '子', '丑', 0, 0);
    expect((await db.doc(`competitions/${c.cid}`).get()).get('champions')).toEqual([{ dv: c.dvId, n: '甲' }]);

    const manual = await setupComp(['甲', '乙']);
    await generate(manual);
    await ok(call(handleCpHost, ADMIN, { action: 'endCompetition', cid: manual.cid, reason: '提前收場' }, later()));
    const hostEnded = (await db.doc(`competitions/${manual.cid}`).get()).data()!;
    expect(hostEnded.endedBy).toBe('host');
    expect(hostEnded.champions).toBeUndefined();

    // 已有結果的組別不能重排（RESULTS_EXIST，已驗收，不改守門）。
    // 真實情境：兩個組別同時存在，只排並確認第一組；第二組尚未排賽程。
    // 末場確認要求每個組別都已有 schedule，所以不會寫 endedAt／champions。
    // 接著為第二組 generateSchedule 不會碰到 RESULTS_EXIST，也沒有可刪的冠軍欄。
    const again = await setupComp(['甲', '乙']);
    const dvB = 'dv_' + 'C'.repeat(20);
    await db.doc(`competitions/${again.cid}/divisions/${dvB}`).set({
      name: '少年組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 10, order: 1
    });
    for (const [i, name] of ['寅', '卯'].entries()) {
      await db.doc(`competitions/${again.cid}/entries/en_${String(i + 2).repeat(20)}`).set({
        dvId: dvB, teamId: `club_y${i}`, name, status: 'approved', rosterCount: 1, rosterConfirmed: true
      });
    }
    await generate(again);
    await record(again, '甲', '乙', 1, 0);
    const done = await matchesOf(again);
    expect(done).toHaveLength(1);
    expect(done[0]!.status).toBe('confirmed');
    const afterFirst = (await db.doc(`competitions/${again.cid}`).get()).data()!;
    expect(afterFirst.endedAt ?? null).toBeNull();
    expect(afterFirst.champions).toBeUndefined();

    const pending: Comp = {
      ...again,
      dvId: dvB,
      enIdOf: { 寅: 'en_' + '2'.repeat(20), 卯: 'en_' + '3'.repeat(20) },
      nameOf: { ['en_' + '2'.repeat(20)]: '寅', ['en_' + '3'.repeat(20)]: '卯' }
    };
    await generate(pending);
    const rescheduled = (await db.doc(`competitions/${again.cid}`).get()).data()!;
    expect(rescheduled.endedAt ?? null).toBeNull();
    expect(rescheduled.champions).toBeUndefined();
    expect((await db.doc(`competitions/${again.cid}/divisions/${dvB}`).get()).get('schedule')).toBeTruthy();
    expect((await matchesOf(pending))).toHaveLength(1);
    expect((await matchesOf(again))[0]!.status).toBe('confirmed');
  });

  it('確認後的 stats 序列化不含 rosterPrivate 的值與 uid', async () => {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    const db = adminDb();
    const m = (await matchesOf(c))[0]!;
    const uid = 'uid_plain_9f3a7c';
    const priv = {
      uid,
      realName: '林真實甲',
      birthday: '1988-07-19',
      phone: '0912000111',
      teamId: 'club_secret_zz',
      addedByUid: 'uid_rep_added_zz'
    };
    await db.doc(`competitions/${c.cid}/roster/${PLA}`).set({ displayName: '王大明', number: 9 });
    await db.doc(`competitions/${c.cid}/rosterPrivate/${PLA}`).set(priv);
    await db.doc(`competitions/${c.cid}/matches/${m.id}/timeline/1`).set({
      seq: 1, type: 'goal', goalKind: 'normal', plId: PLA
    });
    await record(c, '甲', '乙', 1, 0);

    const stored = (await db.doc(`competitions/${c.cid}/rosterPrivate/${PLA}`).get()).data()!;
    expect(stored).toMatchObject(priv);
    const data = (await db.doc(statsRef(c.cid, c.dvId)).get()).data()!;
    expect(Object.keys(data).sort()).toEqual(['m', 'updatedAt']);
    expect(Object.keys(data.m[m.id][PLA]).sort()).toEqual(['g', 'n', 'r', 'y']);
    expect(data.m[m.id][PLA]).toEqual({ n: '王大明', g: 1, y: 0, r: 0 });
    const packed = JSON.stringify(data);
    expect(packed.includes('王大明')).toBe(true);
    for (const value of Object.values(stored)) {
      expect(typeof value).toBe('string');
      expect(packed.includes(String(value))).toBe(false);
    }
    expect(packed.includes(uid)).toBe(false);
  });
});

describe('K3 確認結束後裁定同分補冠軍名', () => {
  beforeEach(() => resetAll());

  it('末場確認時未裁定的組不在 champions；裁定後寫入；撤銷後拿掉', async () => {
    const c = await setupComp(['甲', '乙', '丙'], { host: TESTER });
    await generate(c, TESTER);
    await record(c, '甲', '乙', 1, 1);
    await record(c, '甲', '丙', 1, 1);
    await record(c, '乙', '丙', 1, 1);

    const compRef = adminDb().doc(`competitions/${c.cid}`);
    const ended = (await compRef.get()).data()!;
    expect(ended.endedBy).toBe('confirm');
    expect(ended.champions).toEqual([]);

    const standing = await adminDb().doc(`competitions/${c.cid}/standings/${c.dvId}__group__A`).get();
    const order = [c.enIdOf['丙'], c.enIdOf['甲'], c.enIdOf['乙']];
    const resolved = await ok<{ hasUnresolvedTie: boolean; rows: Array<{ teamId: string }> }>(call(handleCpHost, TESTER, {
      action: 'resolveTie', cid: c.cid, dvId: c.dvId, order, method: 'host', reason: '抽籤後登錄', expectedVersion: standing.get('version')
    }, makeDeps(2 * DAY)));
    expect(resolved.hasUnresolvedTie).toBe(false);
    expect(resolved.rows.map(row => row.teamId)).toEqual(order);

    const after = (await compRef.get()).data()!;
    expect(after.endedBy).toBe('confirm');
    expect(after.endedAt).toBeTruthy();
    expect(after.champions).toEqual([{ dv: c.dvId, n: '丙' }]);

    const mid = await adminDb().doc(`competitions/${c.cid}/standings/${c.dvId}__group__A`).get();
    const cleared = await ok<{ hasUnresolvedTie: boolean }>(call(handleCpHost, TESTER, {
      action: 'clearTieDecision', cid: c.cid, dvId: c.dvId, reason: '改回自動', expectedVersion: mid.get('version')
    }, makeDeps(2 * DAY)));
    expect(cleared.hasUnresolvedTie).toBe(true);

    const back = (await compRef.get()).data()!;
    expect(back.endedBy).toBe('confirm');
    expect(back.endedAt).toBeTruthy();
    expect(back.champions).toEqual([]);
  });
});

describe('K3 確認與重置亂序', () => {
  beforeEach(() => resetAll());

  async function confirmedGoal(): Promise<{ c: Comp; id: string; confirmed: Record<string, unknown> }> {
    const c = await setupComp(['甲', '乙']);
    await generate(c);
    const db = adminDb();
    const m = (await matchesOf(c))[0]!;
    await db.doc(`competitions/${c.cid}/roster/${PLA}`).set({ displayName: '王大明' });
    await db.doc(`competitions/${c.cid}/matches/${m.id}/timeline/1`).set({
      seq: 1, type: 'goal', goalKind: 'normal', plId: PLA, side: 'home'
    });
    await record(c, '甲', '乙', 1, 0);
    const confirmed = (await db.doc(`competitions/${c.cid}/matches/${m.id}`).get()).data();
    if (!confirmed) throw new Error('確認後的場次不存在');
    return { c, id: m.id, confirmed };
  }

  function resetShape(confirmed: Record<string, unknown>): Record<string, unknown> {
    return {
      ...confirmed,
      status: 'scheduled',
      score: { home: 0, away: 0 },
      result: null,
      confirmedAt: null,
      lock: { locked: false }
    };
  }

  /** 依重讀後的場次狀態斷言。不看最後一個事件 hint。 */
  async function assertFollowsReread(c: Comp, mtId: string): Promise<string> {
    const cur = (await adminDb().doc(`competitions/${c.cid}/matches/${mtId}`).get()).data()!;
    const comp = (await adminDb().doc(`competitions/${c.cid}`).get()).data()!;
    const stats = await adminDb().doc(statsRef(c.cid, c.dvId)).get();
    const line = stats.exists ? (stats.get('m') as Record<string, unknown> | undefined)?.[mtId] : undefined;
    if (cur.status === 'confirmed') {
      expect(line).toEqual({ [PLA]: { n: '王大明', g: 1, y: 0, r: 0 } });
      expect(comp.endedAt).toBeTruthy();
      expect(comp.endedBy).toBe('confirm');
      expect(comp.champions).toEqual([{ dv: c.dvId, n: '甲' }]);
    } else {
      expect(line).toBeUndefined();
      expect(comp.endedAt ?? null).toBeNull();
      expect(comp.endedBy ?? null).toBeNull();
      expect(comp.champions).toBeUndefined();
    }
    return String(cur.status);
  }

  it('重置的事件先到、確認的事件後到：實際已是重置，不以確認 hint 寫回', async () => {
    const { c, id, confirmed } = await confirmedGoal();
    await adminDb().doc(`competitions/${c.cid}/matches/${id}`).set(resetShape(confirmed));
    const resetNow = (await adminDb().doc(`competitions/${c.cid}/matches/${id}`).get()).data()!;
    const deps = makeDeps();
    await handleMatchWritten(deps, c.cid, id, confirmed, resetNow);
    await handleMatchWritten(deps, c.cid, id, resetNow, confirmed);
    expect(await assertFollowsReread(c, id)).toBe('scheduled');
  });

  it('確認的事件先到、重置的事件後到：實際仍是確認，不以重置 hint 清掉', async () => {
    const { c, id, confirmed } = await confirmedGoal();
    const resetHint = resetShape(confirmed);
    await adminDb().doc(statsRef(c.cid, c.dvId)).delete();
    const deps = makeDeps();
    await handleMatchWritten(deps, c.cid, id, resetHint, confirmed);
    await handleMatchWritten(deps, c.cid, id, confirmed, resetHint);
    expect(await assertFollowsReread(c, id)).toBe('confirmed');
  });
});
