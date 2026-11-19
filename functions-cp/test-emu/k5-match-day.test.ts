/**
 * K5 跨午夜比賽日（模擬器，寫好不跑）。PM 跑。不改既有讀取預算斷言。
 * 23:00 與隔天 01:30 同摘要片；整天順延凌晨場跟著搬；
 * 22:00～02:00 可排；單場地把第 15 場擠到 05:00 時被拒；
 * 改官方賽期時凌晨場以比賽日判斷涵蓋。
 */
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { handleCpHost } from '../src/cp/host.js';
import { handleMatchWritten } from '../src/cp/match-trigger.js';
import { addDaysYmd } from '../src/cp/schedule-flex.js';
import { summaryShardIdOf } from '../src/cp/summary.js';
import { matchDayOf } from '../src/engine/index.js';
import { ADMIN, DAY, call, fails, makeDeps, ok, resetAll } from './_cp.js';
import { generate, matchesOf, scheduleInput, setupComp, type Comp, type MatchDoc } from './_step3.js';

const DAY_MS = 86_400_000;

function kickMs(m: MatchDoc): number | null {
  const k = m.kickoffAt as { toMillis?: () => number } | null | undefined;
  return k && typeof k.toMillis === 'function' ? k.toMillis() : null;
}

async function reschedule(c: Comp, m: MatchDoc, kickoffAt: number, venueIdx: number): Promise<void> {
  const before = (await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).data()!;
  await ok(call(handleCpHost, ADMIN, {
    action: 'rescheduleMatch', cid: c.cid, mtId: m.id, expectedRev: m.rev, kickoffAt, venueIdx
  }));
  const after = (await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).data()!;
  await handleMatchWritten(makeDeps(), c.cid, m.id, before, after);
}

describe('K5 跨午夜比賽日', () => {
  let c: Comp;

  beforeEach(async () => {
    await resetAll();
    c = await setupComp(['甲', '乙', '丙', '丁']);
    expect(c.days).toHaveLength(2);
  });

  it('23:00 與隔天 01:30 同屬一個比賽日的摘要片', async () => {
    await generate(c);
    const [a, b] = await matchesOf(c);
    const late = Date.parse(`${c.days[0]}T23:00:00+08:00`);
    const early = Date.parse(`${c.days[1]}T01:30:00+08:00`);
    await reschedule(c, a!, late, 0);
    await reschedule(c, b!, early, 1);
    expect(matchDayOf(late)).toBe(c.days[0]);
    expect(matchDayOf(early)).toBe(c.days[0]);
    const shard = summaryShardIdOf(late);
    expect(shard).toBe(summaryShardIdOf(early));
    const m = (await adminDb().doc(`competitions/${c.cid}/summary/${shard}`).get()).get('m');
    expect(m[a!.id]).toBeTruthy();
    expect(m[b!.id]).toBeTruthy();
  });

  it('整天順延把凌晨場一起搬走，時刻只加目標日的日差', async () => {
    await generate(c);
    const [a, b] = await matchesOf(c);
    const late = Date.parse(`${c.days[0]}T23:00:00+08:00`);
    const early = Date.parse(`${c.days[1]}T01:30:00+08:00`);
    await reschedule(c, a!, late, 0);
    await reschedule(c, b!, early, 1);
    const toDate = addDaysYmd(c.days[0], 7)!;
    const before = new Map<string, Record<string, unknown>>();
    for (const m of await matchesOf(c)) {
      before.set(m.id, (await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).get()).data()!);
    }
    await ok(call(handleCpHost, ADMIN, {
      action: 'shiftMatchDay', cid: c.cid, fromDate: c.days[0], toDate, reason: '大雨順延'
    }));
    const afterLate = (await adminDb().doc(`competitions/${c.cid}/matches/${a!.id}`).get()).data()!;
    const afterEarly = (await adminDb().doc(`competitions/${c.cid}/matches/${b!.id}`).get()).data()!;
    await handleMatchWritten(makeDeps(), c.cid, a!.id, before.get(a!.id)!, afterLate);
    await handleMatchWritten(makeDeps(), c.cid, b!.id, before.get(b!.id)!, afterEarly);
    const movedLate = afterLate.kickoffAt.toMillis();
    const movedEarly = afterEarly.kickoffAt.toMillis();
    expect(movedLate - late).toBe(7 * DAY_MS);
    expect(movedEarly - early).toBe(7 * DAY_MS);
    expect(matchDayOf(movedLate)).toBe(toDate);
    expect(matchDayOf(movedEarly)).toBe(toDate);
    const shard = summaryShardIdOf(movedLate);
    expect(shard).toBe(summaryShardIdOf(movedEarly));
    const doc = (await adminDb().doc(`competitions/${c.cid}/summary/${shard}`).get()).get('m');
    expect(doc[a!.id]).toBeTruthy();
    expect(doc[b!.id]).toBeTruthy();
  });

  it('賽程日 22:00～02:00 可排，開賽都早於隔天 02:00 且屬該比賽日', async () => {
    const r = await generate(c, ADMIN, {
      matchMinutes: 20, bufferMinutes: 0, minRestMinutes: 0,
      days: [{ date: c.days[0], start: '22:00', end: '02:00' }],
      venueIdx: [0, 1], seed: 7
    });
    expect(r).toMatchObject({ matchCount: 6, unplacedCount: 0 });
    const start = Date.parse(`${c.days[0]}T22:00:00+08:00`);
    const end = Date.parse(`${c.days[1]}T02:00:00+08:00`);
    const ms = await matchesOf(c);
    expect(ms).toHaveLength(6);
    for (const m of ms) {
      const k = kickMs(m)!;
      expect(k).toBeGreaterThanOrEqual(start);
      expect(k).toBeLessThan(end);
      expect(matchDayOf(k)).toBe(c.days[0]);
    }
  });

  it('改官方賽期時凌晨場以比賽日判斷涵蓋', async () => {
    await generate(c);
    const comp = (await adminDb().doc(`competitions/${c.cid}`).get()).data()!;
    const ms = await matchesOf(c);
    const early = Date.parse(`${c.days[1]}T01:30:00+08:00`);
    const noon = Date.parse(`${c.days[0]}T12:00:00+08:00`);
    for (const m of ms) {
      await adminDb().doc(`competitions/${c.cid}/matches/${m.id}`).update({
        kickoffAt: Timestamp.fromMillis(m.id === ms[0]!.id ? early : noon)
      });
    }
    const regOpenAt = comp.regOpenAt.toMillis();
    const regCloseAt = comp.regCloseAt.toMillis();
    const firstMs = comp.firstMatchAt.toMillis();
    const coverLast = Math.max(firstMs, Date.parse(`${c.days[0]}T18:00:00+08:00`));
    await ok(call(handleCpHost, ADMIN, {
      action: 'update', cid: c.cid, regOpenAt, regCloseAt, firstMatchAt: firstMs, lastMatchAt: coverLast
    }));

    const prev = addDaysYmd(c.days[0], -1)!;
    await fails(call(handleCpHost, ADMIN, {
      action: 'update', cid: c.cid,
      regOpenAt: Date.parse(`${prev}T08:00:00+08:00`) - DAY,
      regCloseAt: Date.parse(`${prev}T10:00:00+08:00`),
      firstMatchAt: Date.parse(`${prev}T12:00:00+08:00`),
      lastMatchAt: Date.parse(`${prev}T18:00:00+08:00`)
    }), 'SCHEDULE_OUT_OF_RANGE');

    await adminDb().doc(`competitions/${c.cid}/matches/${ms[0]!.id}`).update({
      kickoffAt: Timestamp.fromMillis(Date.parse(`${c.days[1]}T05:00:00+08:00`))
    });
    await fails(call(handleCpHost, ADMIN, {
      action: 'update', cid: c.cid, regOpenAt, regCloseAt, firstMatchAt: firstMs, lastMatchAt: coverLast
    }), 'SCHEDULE_OUT_OF_RANGE');
  });
});

describe('K5 開賽 05:00 被拒', () => {
  it('6 隊單場地 22:00～08:00：第 15 場的 05:00 開賽排不進', async () => {
    await resetAll();
    const six = await setupComp(['甲', '乙', '丙', '丁', '戊', '己']);
    const p = await ok<{ dryRun: boolean; matchCount: number; unplacedCount: number }>(call(
      handleCpHost, ADMIN, scheduleInput(six, {
        dryRun: true, matchMinutes: 30, bufferMinutes: 0, minRestMinutes: 0,
        days: [{ date: six.days[0], start: '22:00', end: '08:00' }],
        venueIdx: [0], seed: 1
      })
    ));
    expect(p).toMatchObject({ dryRun: true, matchCount: 15, unplacedCount: 1 });
    expect((await matchesOf(six))).toHaveLength(0);
  });
});
